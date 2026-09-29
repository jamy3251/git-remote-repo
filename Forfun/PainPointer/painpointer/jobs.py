"""jobs 테이블 + 백그라운드 실행 + in-flight 락.

- 같은 query_hash의 running 잡이 있으면 새로 만들지 않고 그 잡에 합류한다.
- 브라우저가 이탈해도 스레드는 끝까지 실행하고 reports에 저장한다(작업 페이지 3초 폴링).
- 서버 재시작 시 running으로 남은 잡은 failed(서버 재시작)로 정리한다(recover).
"""
from __future__ import annotations

import json
import secrets
import threading
import traceback
from datetime import datetime, timezone
from pathlib import Path

from . import config, db
from .llm import DailyLimitExceeded
from .log import log_event
from .pipeline import DBBusy, GenerateRequest, generate_report
from .textnorm import query_hash


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class JobManager:
    def __init__(self, db_path: str | Path | None = None, *, llm_factory=None, embedder_factory=None):
        self.db_path = Path(db_path or config.DB_PATH)
        self.llm_factory = llm_factory
        self.embedder_factory = embedder_factory
        self._lock = threading.Lock()
        self._inflight: dict[str, str] = {}   # query_hash → job_id
        self._threads: dict[str, threading.Thread] = {}

    # ---- 조회 ----
    def status(self, job_id: str) -> dict | None:
        conn = db.open_read(self.db_path)
        try:
            r = conn.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
            return dict(r) if r else None
        finally:
            conn.close()

    def _update(self, job_id: str, **fields) -> None:
        fields["updated_at"] = _now()
        cols = ", ".join(f"{k}=?" for k in fields)
        conn = db.open_write(self.db_path)
        try:
            with conn:
                conn.execute(f"UPDATE jobs SET {cols} WHERE id=?", [*fields.values(), job_id])
        finally:
            conn.close()

    def recover(self) -> int:
        conn = db.open_write(self.db_path)
        try:
            with conn:
                cur = conn.execute("UPDATE jobs SET status='failed', error='서버 재시작으로 중단됨', updated_at=? "
                                   "WHERE status IN ('queued','running')", (_now(),))
                return cur.rowcount
        finally:
            conn.close()

    # ---- 제출 ----
    def submit(self, req: GenerateRequest) -> tuple[str, bool]:
        """반환 (job_id, joined). joined=True면 기존 running 잡에 합류."""
        qh = query_hash(req.pain, req.target)
        with self._lock:
            jid = self._inflight.get(qh)
            if jid:
                st = self.status(jid)
                if st and st["status"] in ("queued", "running"):
                    return jid, True
                self._inflight.pop(qh, None)
            jid = secrets.token_urlsafe(12)
            conn = db.open_write(self.db_path)
            try:
                with conn:
                    conn.execute(
                        "INSERT INTO jobs(id, query_hash, status, stage, progress, request_json, created_at, updated_at)"
                        " VALUES (?,?,?,?,?,?,?,?)",
                        (jid, qh, "queued", "queued", "", json.dumps(req.__dict__, ensure_ascii=False), _now(), _now()),
                    )
            finally:
                conn.close()
            self._inflight[qh] = jid
            t = threading.Thread(target=self._run, args=(jid, qh, req), daemon=True, name=f"job-{jid}")
            self._threads[jid] = t
            t.start()
        log_event("job_submit", job_id=jid, query_hash=qh)
        return jid, False

    def _run(self, job_id: str, qh: str, req: GenerateRequest) -> None:
        self._update(job_id, status="running", stage="search", progress="시작")
        lines: list[str] = []

        def progress(msg: str) -> None:
            lines.append(msg)
            self._update(job_id, progress="\n".join(lines[-12:]), stage=msg[:40])

        try:
            llm = self.llm_factory() if self.llm_factory else None
            embedder = self.embedder_factory() if self.embedder_factory else None
            report, _html = generate_report(req, db_path=self.db_path, llm=llm, embedder=embedder,
                                            job_id=job_id, progress=progress)
            self._update(job_id, status="done", stage="done", report_id=report.id)
            log_event("job_done", job_id=job_id, report_id=report.id)
        except DailyLimitExceeded as e:
            self._update(job_id, status="failed", stage="failed", error=f"일일 한도 도달: {e}")
            log_event("job_failed", job_id=job_id, error=str(e))
        except DBBusy as e:
            self._update(job_id, status="failed", stage="failed", error=str(e))
            log_event("job_failed", job_id=job_id, error=str(e))
        except Exception as e:  # noqa: BLE001
            self._update(job_id, status="failed", stage="failed", error=f"{type(e).__name__}: {e}"[:500])
            log_event("job_failed", job_id=job_id, error=str(e), trace=traceback.format_exc()[-2000:])
        finally:
            with self._lock:
                if self._inflight.get(qh) == job_id:
                    self._inflight.pop(qh, None)
                self._threads.pop(job_id, None)

    def wait(self, job_id: str, timeout: float | None = None) -> None:
        t = self._threads.get(job_id)
        if t:
            t.join(timeout)
