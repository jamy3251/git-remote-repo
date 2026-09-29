"""일일 증분 수집 배치 (Windows 작업 스케줄러에서 `python -m painpointer collect`).

- 락 파일(data/collect.lock, 6h 만료): 중복 실행이면 즉시 종료.
- watch_list의 (source, board)마다: 마지막 status='ok' 실행일 − 1일 이후 글을 페이지 단위로 수집(회수, 유실 없음).
  이전 ok 실행이 없으면 최대 COLLECT_MAX_PAGES까지 백필.
- collection_runs(status: ok|failed|partial|suspect|missed). ParserDriftError → failed.
  최근 7일 일별 신규 중앙값(ok·suspect 실행 포함) ≥ SUSPECT_MIN_RATE인데 오늘 0건 → suspect.
  하루 0~3건인 저빈도 갤러리는 0건이 정상이라 의심하지 않는다. 평균 대신 중앙값: 백필한 날의
  수백 건 스파이크가 일주일 내내 기준을 부풀리지 않게.
- 같은 소스 2일 연속 실패/의심이면 웹훅(토큰은 .env). 전송 실패는 로그만.
- 수집 후 post_embeddings 배치 → source_candidates 갱신(하루 1회, 실패해도 배치는 성공).
"""
from __future__ import annotations

import json
import os
import re
import statistics
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import httpx

from dccrawler.models import Post, parse_day
from dccrawler.sources import EmptyResponseError, ParserDriftError, get_source
from dccrawler.storage import Store

from . import config, db
from .embed import Embedder, embed_missing_posts
from .log import log_event

SUSPECT_MIN_RATE = 3.0
SUSPECT_MIN_DAYS = 4


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def send_webhook(url: str, text: str, *, client=None) -> bool:
    if not url:
        return False
    try:
        c = client or httpx.Client(timeout=10)
        if "api.telegram.org" in url:
            chat_id = os.getenv("PP_WEBHOOK_CHAT_ID", "")
            r = c.post(url, json={"chat_id": chat_id, "text": text})
        else:
            r = c.post(url, json={"content": text, "text": text})
        r.raise_for_status()
        return True
    except Exception as e:  # noqa: BLE001
        log_event("webhook_failed", error=str(e))
        return False


class Lock:
    def __init__(self, path: Path, ttl_hours: int = config.LOCK_TTL_HOURS):
        self.path, self.ttl = Path(path), ttl_hours * 3600

    def acquire(self) -> bool:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if self.path.exists():
            age = time.time() - self.path.stat().st_mtime
            if age < self.ttl:
                return False
            self.path.unlink()
        self.path.write_text(f"{os.getpid()} {_now()}", encoding="utf-8")
        return True

    def release(self) -> None:
        try:
            self.path.unlink()
        except FileNotFoundError:
            pass


class Collector:
    def __init__(self, db_path: str | Path | None = None, *, embedder: Embedder | None = None,
                 source_factory=get_source, webhook=send_webhook, today: date | None = None,
                 max_pages: int = config.COLLECT_MAX_PAGES, delay: float = 1.0, lock_path: Path | None = None,
                 fetch_body: bool = True):
        self.db_path = Path(db_path or config.DB_PATH)
        self.embedder = embedder
        self.source_factory = source_factory
        self.webhook = webhook
        self.today = today or date.today()
        self.max_pages = max_pages
        self.delay = delay
        self.lock = Lock(lock_path or config.LOCK_PATH)
        self.fetch_body = fetch_body

    # ---- 실행 기록 ----
    def _last_ok(self, conn, source, board) -> str | None:
        r = conn.execute("SELECT run_date FROM collection_runs WHERE source=? AND board=? AND status='ok' ORDER BY run_date DESC LIMIT 1",
                         (source, board)).fetchone()
        return r["run_date"] if r else None

    def _recent_rate(self, conn, source, board) -> float:
        """최근 7일 일별 신규 건수의 중앙값. 0건 날(suspect)도 실제 관측이므로 포함한다."""
        since = (self.today - timedelta(days=7)).isoformat()
        rows = conn.execute("SELECT run_date, SUM(n_new) AS n FROM collection_runs WHERE source=? AND board=?"
                            " AND status IN ('ok','suspect') AND run_date >= ? AND run_date < ? GROUP BY run_date",
                            (source, board, since, self.today.isoformat())).fetchall()
        if len(rows) < SUSPECT_MIN_DAYS:   # 이력이 짧으면 판단하지 않는다(백필 직후 1~2일)
            return 0.0
        return statistics.median([r["n"] for r in rows])

    def _prev_bad(self, conn, source, board) -> bool:
        r = conn.execute("SELECT status FROM collection_runs WHERE source=? AND board=? AND run_date < ? ORDER BY run_date DESC, id DESC LIMIT 1",
                         (source, board, self.today.isoformat())).fetchone()
        return bool(r and r["status"] in ("failed", "suspect"))

    def _record(self, conn, source, board, status, *, n_new=0, error=None, started=None):
        with conn:
            conn.execute("INSERT INTO collection_runs(source, board, run_date, status, error, n_new, started_at, finished_at)"
                         " VALUES (?,?,?,?,?,?,?,?)",
                         (source, board, self.today.isoformat(), status, error, n_new, started or _now(), _now()))

    # ---- 소스 하나 ----
    def collect_one(self, source: str, board: str, *, progress=None) -> dict:
        say = progress or (lambda *_: None)
        started = _now()
        wconn = db.open_write(self.db_path)
        try:
            last_ok = self._last_ok(wconn, source, board)
        finally:
            wconn.close()
        since_day = (date.fromisoformat(last_ok) - timedelta(days=1)).isoformat() if last_ok else None
        store = Store(self.db_path)
        src = self.source_factory(source)
        status, error, n_new = "ok", None, 0
        try:
            for page in range(1, self.max_pages + 1):
                posts = src.crawl(board, page, page, fetch_body=self.fetch_body, delay=self.delay, progress=None)
                if not posts:
                    break
                keys = [p.key for p in posts]
                existing = set()
                for i in range(0, len(keys), 500):
                    chunk = keys[i:i + 500]
                    existing.update(r["post_key"] for r in store.conn.execute(
                        "SELECT post_key FROM posts WHERE post_key IN (%s)" % ",".join("?" * len(chunk)), chunk))
                store.upsert_posts(posts)
                n_new += sum(1 for k in keys if k not in existing)
                say(f"[{source}/{board}] {page}p {len(posts)}건 (신규 누적 {n_new})")
                if since_day:
                    days = [parse_day(p.created_at, p.crawled_at) for p in posts]
                    if all(d is not None and d < since_day for d in days):
                        break
        except ParserDriftError as e:
            status, error = "failed", f"ParserDriftError: {e}"
        except EmptyResponseError as e:
            status, error = "failed", f"EmptyResponseError: {e}"
        except KeyboardInterrupt:
            status, error = "partial", "중단됨"
        except (httpx.HTTPError, Exception) as e:  # noqa: BLE001
            status, error = "failed", f"{type(e).__name__}: {e}"[:300]
        finally:
            store.close()
        wconn = db.open_write(self.db_path)
        try:
            rate = self._recent_rate(wconn, source, board) if status == "ok" and n_new == 0 else 0.0
            if rate >= SUSPECT_MIN_RATE:
                status = "suspect"
                error = f"최근 7일 일별 중앙값 {rate:g}건인데 오늘 0건"
            prev_bad = self._prev_bad(wconn, source, board)
            self._record(wconn, source, board, status, n_new=n_new, error=error, started=started)
        finally:
            wconn.close()
        log_event("collect", run_id=started, source=source, board=board, status=status, n_new=n_new, error=error)
        if status in ("failed", "suspect") and prev_bad:
            self.webhook(config.WEBHOOK_URL, f"[PainPointer] {source}/{board} 2일 연속 {status}: {error}")
        return {"source": source, "board": board, "status": status, "n_new": n_new, "error": error}

    # ---- 전체 ----
    def run(self, only_source: str | None = None, *, progress=None) -> list[dict]:
        if not self.lock.acquire():
            log_event("collect_skipped", reason="lock")
            if progress:
                progress("다른 수집 배치가 실행 중(락 파일). 종료.")
            return []
        try:
            db.init_db(self.db_path)
            conn = db.open_read(self.db_path)
            try:
                watch = [dict(r) for r in conn.execute("SELECT source, board FROM watch_list WHERE enabled=1 ORDER BY id")]
            finally:
                conn.close()
            if only_source:
                watch = [w for w in watch if w["source"] == only_source or f"{w['source']}:{w['board']}" == only_source]
            results = [self.collect_one(w["source"], w["board"], progress=progress) for w in watch]
            if self.embedder is not None:
                try:
                    n = embed_missing_posts(self.db_path, self.embedder, progress=progress)
                    log_event("embed", n=n)
                except Exception as e:  # noqa: BLE001
                    log_event("embed_failed", error=str(e))
            try:
                self.refresh_candidates(progress=progress)
            except Exception as e:  # noqa: BLE001
                log_event("candidates_failed", error=str(e))
            return results
        finally:
            self.lock.release()

    # ---- 8f 후보 목록 ----
    def refresh_candidates(self, keywords: list[str] | None = None, *, client=None, progress=None) -> int:
        keywords = keywords if keywords is not None else [k.strip() for k in os.getenv("PP_CANDIDATE_KEYWORDS", "").split(",") if k.strip()]
        if not keywords:
            return 0
        c = client or httpx.Client(timeout=15, headers={"User-Agent": "Mozilla/5.0"}, follow_redirects=True)
        found: list[tuple[str, str, str, str]] = []
        for kw in keywords:
            try:
                r = c.get(f"https://search.dcinside.com/gallery/q/{kw}")
                r.raise_for_status()
            except Exception as e:  # noqa: BLE001
                log_event("candidates_fetch_failed", keyword=kw, error=str(e))
                continue
            for m in re.finditer(r'href="(https?://gall\.dcinside\.com/(?:mgallery/|mini/)?board/lists/?\?id=([A-Za-z0-9_]+))"[^>]*>([^<]{1,60})<', r.text):
                found.append(("dcgallery", m.group(3).strip() or m.group(2), m.group(1), kw))
        if not found:
            return 0
        conn = db.open_write(self.db_path)
        try:
            with conn:
                conn.executemany("INSERT INTO source_candidates(kind, name, ref, keyword, fetched_at) VALUES (?,?,?,?,?)"
                                 " ON CONFLICT(kind, ref) DO UPDATE SET name=excluded.name, keyword=excluded.keyword, fetched_at=excluded.fetched_at",
                                 [(k, n, ref, kw, _now()) for k, n, ref, kw in found])
        finally:
            conn.close()
        if progress:
            progress(f"후보 갤러리 {len(found)}건 갱신")
        return len(found)
