"""JSONL 구조화 로그. data/logs/YYYY-MM-DD.jsonl 에 한 줄씩 추가.

필드: ts, event, (job_id|run_id), stage, elapsed_ms, 그 외 임의 키.
"""
from __future__ import annotations

import json
import threading
from datetime import datetime, timezone
from pathlib import Path

from . import config

_lock = threading.Lock()


def _path(log_dir: Path | None = None) -> Path:
    d = Path(log_dir or config.LOG_DIR)
    d.mkdir(parents=True, exist_ok=True)
    return d / (datetime.now().strftime("%Y-%m-%d") + ".jsonl")


def log_event(event: str, *, log_dir: Path | None = None, **fields) -> dict:
    rec = {"ts": datetime.now(timezone.utc).isoformat(timespec="milliseconds"), "event": event}
    rec.update({k: v for k, v in fields.items() if v is not None})
    line = json.dumps(rec, ensure_ascii=False, default=str)
    with _lock:
        with open(_path(log_dir), "a", encoding="utf-8") as f:
            f.write(line + "\n")
    return rec


class Timer:
    """with Timer() as t: ... ; t.ms"""

    def __enter__(self):
        import time
        self._t0 = time.perf_counter()
        self.ms = 0
        return self

    def __exit__(self, *exc):
        import time
        self.ms = int((time.perf_counter() - self._t0) * 1000)
        return False
