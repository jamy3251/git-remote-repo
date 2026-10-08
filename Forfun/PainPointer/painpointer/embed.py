"""임베딩(ko-sroberta) — 배치 사전 계산 + 조회. 리포트 생성 시 모델 상주 없음.

- post_embeddings: 수집 배치가 새 글마다 계산해 저장. 군집화는 이 테이블만 조회.
- attempt_embeddings: 한이음 공개 프로젝트·수상작을 CLI로 사전 계산.
- pain 문장 임베딩은 리포트 생성 시 1회 계산(Embedder.encode). 테스트는 가짜 Embedder 주입.
- 두 테이블 모두 (키, model) 단위로 저장하고 읽을 때 모델로 거른다. 모델 교체는 reembed로 새 모델 행을
  다 채운 뒤 옛 모델 행을 지우고 PP_EMBED_MODEL을 바꾼다(교체 중에도 옛 모델로 리포트가 돈다).
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


class EmbeddingMismatch(RuntimeError):
    """저장된 벡터와 질의 벡터의 차원이 다름 — 같은 모델 이름으로 다른 모델 벡터가 저장된 경우."""


def _check_dim(stored: int, query: int, table: str, model: str) -> None:
    if stored != query:
        raise EmbeddingMismatch(
            f"재임베딩 필요: {table}의 {model} 벡터는 {stored}차원인데 질의 벡터는 {query}차원입니다. "
            f"python -m painpointer reembed --model {model} 로 다시 계산하세요.")


def load_post_embeddings(conn: sqlite3.Connection, keys: list[str], model: str | None = None) -> dict[str, np.ndarray]:
    """model(기본 config.EMBED_MODEL)로 계산된 행만 읽는다. 다른 모델 행은 없는 것으로 본다."""
    model = model or config.EMBED_MODEL
    out: dict[str, np.ndarray] = {}
    for i in range(0, len(keys), 500):
        chunk = keys[i:i + 500]
        rows = conn.execute(
            "SELECT post_key, vector FROM post_embeddings WHERE model = ? AND post_key IN (%s)" % ",".join("?" * len(chunk)),
            [model, *chunk],
        ).fetchall()
        for r in rows:
            out[r["post_key"]] = _unblob(r["vector"])
    dims = {v.shape[0] for v in out.values()}
    if len(dims) > 1:
        raise EmbeddingMismatch(f"재임베딩 필요: post_embeddings의 {model} 벡터 차원이 섞여 있습니다({sorted(dims)}).")
    return out


def embed_missing_posts(db_path: str | Path, embedder: Embedder, *, limit: int | None = None,
                        progress=None) -> int:
    """embedder 모델의 post_embeddings 행이 없는 글을 배치로 계산해 저장. 반환: 계산 건수."""
    conn = db.open_write(db_path)
    try:
        sql = ("SELECT p.post_key, p.title, p.body FROM posts p "
               "LEFT JOIN post_embeddings e ON e.post_key = p.post_key AND e.model = ? "
               "WHERE e.post_key IS NULL AND (p.body != '' OR p.title IS NOT NULL) ORDER BY p.id")
        if limit:
            sql += f" LIMIT {int(limit)}"
        rows = conn.execute(sql, (embedder.model_name,)).fetchall()
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
                     high: float = config.SIM_HIGH, top: int = 5, model: str | None = None) -> dict | None:
    """{count, top5, model} 또는 그 모델 행이 없으면 None(강등 대상)."""
    model = model or config.EMBED_MODEL
    rows = conn.execute("SELECT project_id, title, year, source, url, result, vector, model FROM attempt_embeddings "
                        "WHERE model = ?", (model,)).fetchall()
    if not rows:
        return None
    vecs = [_unblob(r["vector"]) for r in rows]
    q = np.asarray(pain_vec, dtype=np.float32)
    for v in vecs:
        _check_dim(v.shape[0], q.shape[0], "attempt_embeddings", model)
    M = np.stack(vecs)
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


# ---- 모델 교체 ----

def reembed(db_path: str | Path, embedder: Embedder, *, projects: list[dict] | None = None,
            delete_old: bool = True, progress=None) -> dict:
    """embedder 모델로 글·한이음 임베딩을 빠짐없이 채운 뒤(빠진 것이 없을 때만) 다른 모델 행을 지운다.

    한이음 원문은 HanCrawler 데이터에서 다시 읽고, 데이터에 없는 기존 항목은 저장된 제목으로 계산한다.
    추출 문장(pain_extracts)은 의미 검색 때 즉시 계산하므로 저장된 벡터가 없다.
    반환: {model, posts, attempts, missing, deleted_posts, deleted_attempts}
    """
    model = embedder.model_name
    n_posts = embed_missing_posts(db_path, embedder, progress=progress)

    conn = db.open_read(db_path)
    try:
        old = conn.execute("SELECT project_id, title, year, source, url, result FROM attempt_embeddings "
                           "WHERE model != ? AND project_id NOT IN "
                           "(SELECT project_id FROM attempt_embeddings WHERE model = ?)", (model, model)).fetchall()
    finally:
        conn.close()
    projects = projects if projects is not None else load_hanium_projects()
    known = {p["id"] for p in projects}
    todo = list(projects)
    for r in old:
        if r["project_id"] not in known:
            todo.append({"id": r["project_id"], "title": r["title"], "text": r["title"], "year": r["year"],
                         "source": r["source"], "url": r["url"], "result": r["result"]})
    n_att = precompute_attempts(db_path, embedder, todo, progress=progress) if todo else 0

    conn = db.open_write(db_path)
    try:
        missing = conn.execute(
            "SELECT COUNT(*) FROM posts p LEFT JOIN post_embeddings e ON e.post_key = p.post_key AND e.model = ? "
            "WHERE e.post_key IS NULL AND (p.body != '' OR p.title IS NOT NULL)", (model,)).fetchone()[0]
        missing += conn.execute(
            "SELECT COUNT(DISTINCT project_id) FROM attempt_embeddings WHERE project_id NOT IN "
            "(SELECT project_id FROM attempt_embeddings WHERE model = ?)", (model,)).fetchone()[0]
        dp = da = 0
        if delete_old and not missing:
            with conn:
                dp = conn.execute("DELETE FROM post_embeddings WHERE model != ?", (model,)).rowcount
                da = conn.execute("DELETE FROM attempt_embeddings WHERE model != ?", (model,)).rowcount
    finally:
        conn.close()
    return {"model": model, "posts": n_posts, "attempts": n_att, "missing": missing,
            "deleted_posts": dp, "deleted_attempts": da}
