"""임베딩(ko-sroberta) — 배치 사전 계산 + 조회. 리포트 생성 시 모델 상주 없음.

- post_embeddings: 수집 배치가 새 글마다 계산해 저장. 군집화는 이 테이블만 조회.
- attempt_embeddings: 한이음 공개 프로젝트·수상작을 CLI로 사전 계산.
- pain 문장 임베딩은 리포트 생성 시 1회 계산(Embedder.encode). 테스트는 가짜 Embedder 주입.
"""
from __future__ import annotations

import json
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from . import config, db
from .models import Attempt

_HANGUL = re.compile(r"[가-힣]{2,}")


class Embedder:
    """sentence-transformers 래퍼. encode(texts) → (n, d) float32, L2 정규화."""

    def __init__(self, model_name: str = config.EMBED_MODEL):
        self.model_name = model_name
        self._model = None

    def _load(self):
        if self._model is None:
            import os
            # 리포트 생성 시 외부 요청 0회: 로컬 캐시만 사용(최초 1회는 PP_HF_ONLINE=1로 내려받는다)
            if os.getenv("PP_HF_ONLINE", "") != "1":
                os.environ.setdefault("HF_HUB_OFFLINE", "1")
                os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
            from sentence_transformers import SentenceTransformer
            self._model = SentenceTransformer(self.model_name)
        return self._model

    def encode(self, texts: list[str]) -> np.ndarray:
        if not texts:
            return np.zeros((0, 0), dtype=np.float32)
        m = self._load()
        v = m.encode(texts, batch_size=32, convert_to_numpy=True, normalize_embeddings=True,
                     show_progress_bar=False)
        return np.asarray(v, dtype=np.float32)


class HashEmbedder(Embedder):
    """테스트·오프라인용 결정적 가짜 임베딩(토큰 해시 기반 bag-of-words). 실제 의미 유사도 아님."""

    def __init__(self, dim: int = 64):
        super().__init__(model_name="hash-embedder-test")
        self.dim = dim

    def encode(self, texts: list[str]) -> np.ndarray:
        from .textnorm import tokenize
        out = np.zeros((len(texts), self.dim), dtype=np.float32)
        for i, t in enumerate(texts):
            for tok in tokenize(t):
                h = int.from_bytes(tok.encode("utf-8")[:8].ljust(8, b"\0"), "little")
                out[i, h % self.dim] += 1.0
            n = np.linalg.norm(out[i])
            if n:
                out[i] /= n
        return out


def _blob(v: np.ndarray) -> bytes:
    return np.asarray(v, dtype=np.float32).tobytes()


def _unblob(b: bytes) -> np.ndarray:
    return np.frombuffer(b, dtype=np.float32)


def load_post_embeddings(conn: sqlite3.Connection, keys: list[str]) -> dict[str, np.ndarray]:
    out: dict[str, np.ndarray] = {}
    for i in range(0, len(keys), 500):
        chunk = keys[i:i + 500]
        rows = conn.execute(
            "SELECT post_key, vector FROM post_embeddings WHERE post_key IN (%s)" % ",".join("?" * len(chunk)), chunk
        ).fetchall()
        for r in rows:
            out[r["post_key"]] = _unblob(r["vector"])
    return out


def embed_missing_posts(db_path: str | Path, embedder: Embedder, *, limit: int | None = None,
                        progress=None) -> int:
    """post_embeddings에 없는 글을 배치로 계산해 저장. 반환: 계산 건수."""
    conn = db.open_write(db_path)
    try:
        sql = ("SELECT p.post_key, p.title, p.body FROM posts p LEFT JOIN post_embeddings e ON e.post_key = p.post_key "
               "WHERE e.post_key IS NULL AND (p.body != '' OR p.title IS NOT NULL) ORDER BY p.id")
        if limit:
            sql += f" LIMIT {int(limit)}"
        rows = conn.execute(sql).fetchall()
        n = 0
        now = datetime.now(timezone.utc).isoformat(timespec="seconds")
        for i in range(0, len(rows), 256):
            chunk = rows[i:i + 256]
            texts = [((r["title"] or "") + "\n" + (r["body"] or "")).strip() for r in chunk]
            vecs = embedder.encode(texts)
            with conn:
                conn.executemany(
                    "INSERT OR REPLACE INTO post_embeddings(post_key, vector, model, computed_at) VALUES (?,?,?,?)",
                    [(r["post_key"], _blob(v), embedder.model_name, now) for r, v in zip(chunk, vecs)],
                )
            n += len(chunk)
            if progress:
                progress(f"임베딩 {n}/{len(rows)}")
        return n
    finally:
        conn.close()


# ---- 한이음 유사 시도 ----

def load_hanium_projects(data_dir: str | Path = config.HANCRAWLER_DATA) -> list[dict]:
    """HanCrawler JSON에서 공개 프로젝트·수상작을 읽어 {id, title, text, year, source, url, result} 목록으로."""
    data_dir = Path(data_dir)
    out: list[dict] = []
    pub = data_dir / "public_projects.json"
    if pub.exists():
        for i, item in enumerate(json.loads(pub.read_text(encoding="utf-8"))):
            title = (item.get("title") or "").strip()
            if len(title) < 4 or not _HANGUL.search(title):
                continue
            text = " ".join(x for x in (title, item.get("field", ""), item.get("topic", ""), item.get("raw_text", "")) if x)
            out.append({"id": f"public:{i}:{title[:40]}", "title": title, "text": text[:600], "year": None,
                        "source": "hanium_public", "url": "https://www.hanium.or.kr/portal/project/projectList.do",
                        "result": item.get("status") or None})
    # 디렉토리북 PDF 추출본(award_projects.json)은 페이지 텍스트 조각이라 제목이 아님 → 사용하지 않는다.
    # 2024 수상작 목록(JSON, {contest, grade, team, title})만 수상작으로 쓴다.
    aw = data_dir / "2024_수상작_목록.json"
    if aw.exists():
        for i, item in enumerate(json.loads(aw.read_text(encoding="utf-8"))):
            title = " ".join((item.get("title") or "").split())
            if len(title) < 4 or not _HANGUL.search(title):
                continue
            grade = (item.get("grade") or "").strip() or None
            contest = (item.get("contest") or "").strip()
            out.append({"id": f"award2024:{i}:{title[:40]}", "title": title[:80],
                        "text": " ".join(x for x in (title, contest) if x)[:600], "year": 2024, "source": "hanium_award",
                        "url": "https://www.hanium.or.kr/portal/index.do", "result": grade})
    return out


def precompute_attempts(db_path: str | Path, embedder: Embedder, projects: list[dict] | None = None,
                        progress=None) -> int:
    projects = projects if projects is not None else load_hanium_projects()
    if not projects:
        return 0
    conn = db.open_write(db_path)
    try:
        now = datetime.now(timezone.utc).isoformat(timespec="seconds")
        n = 0
        for i in range(0, len(projects), 256):
            chunk = projects[i:i + 256]
            vecs = embedder.encode([p["text"] for p in chunk])
            with conn:
                conn.executemany(
                    "INSERT OR REPLACE INTO attempt_embeddings(project_id, title, year, source, url, result, vector,"
                    " model, computed_at) VALUES (?,?,?,?,?,?,?,?,?)",
                    [(p["id"], p["title"], p["year"], p["source"], p["url"], p["result"], _blob(v),
                      embedder.model_name, now) for p, v in zip(chunk, vecs)],
                )
            n += len(chunk)
            if progress:
                progress(f"한이음 임베딩 {n}/{len(projects)}")
        return n
    finally:
        conn.close()


def similar_attempts(conn: sqlite3.Connection, pain_vec: np.ndarray, *, threshold: float = config.SIM_THRESHOLD,
                     high: float = config.SIM_HIGH, top: int = 5) -> dict | None:
    """{count, top5, model} 또는 테이블이 비어 있으면 None(강등 대상)."""
    rows = conn.execute("SELECT project_id, title, year, source, url, result, vector, model FROM attempt_embeddings").fetchall()
    if not rows:
        return None
    M = np.stack([_unblob(r["vector"]) for r in rows])
    q = np.asarray(pain_vec, dtype=np.float32)
    q = q / (np.linalg.norm(q) or 1)
    Mn = M / np.maximum(np.linalg.norm(M, axis=1, keepdims=True), 1e-9)
    sims = Mn @ q
    idx = np.argsort(-sims)
    count = int((sims >= threshold).sum())
    top5 = []
    for j in idx[:top]:
        s = float(sims[j])
        if s < threshold:
            break
        r = rows[int(j)]
        top5.append(Attempt(year=r["year"], title=r["title"], similarity=round(s, 3),
                            label="high" if s >= high else "mid", result=r["result"], url=r["url"]))
    return {"count": count, "top5": [a.__dict__ for a in top5], "model": rows[0]["model"],
            "threshold": threshold, "high": high, "n_pool": len(rows)}
