"""5단계 cluster: (5a) post_embeddings 조회 → 파이썬 AgglomerativeClustering → (5b) LLM 이름만 생성.

- 파라미터 초기값: 코사인 거리 0.35 / 상한 12(초과분은 '기타'로 병합) / 최소 크기 3(미만은 '기타').
- Cluster.post_ids는 파이썬이 채운다. LLM 출력에 없는 id가 있으면 그 콜을 실패 처리(강등).
- 강등: "군집 N (이름 생성 실패)" + 수치 유지 + Report.degraded[]에 기록.
"""
from __future__ import annotations

import numpy as np
from dccrawler.models import Post

from . import config
from .aggregate import cluster_stats
from .llm import LLM, LLMError, load_prompt
from .models import Cluster
from .textnorm import prompt_hash

NAME_SCHEMA = {
    "type": "object",
    "properties": {
        "names": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"cluster_id": {"type": "string"}, "name": {"type": "string"}},
                "required": ["cluster_id", "name"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["names"],
    "additionalProperties": False,
}
OTHER_ID = "c_other"


def _labels(vectors: np.ndarray, params: dict) -> np.ndarray:
    n = vectors.shape[0]
    if n == 1:
        return np.zeros(1, dtype=int)
    from sklearn.cluster import AgglomerativeClustering
    model = AgglomerativeClustering(
        n_clusters=None, distance_threshold=params["distance_threshold"],
        metric=params.get("metric", "cosine"), linkage=params.get("linkage", "average"),
    )
    return model.fit_predict(vectors)


def cluster_posts(posts: list[Post], embeddings: dict[str, np.ndarray], params: dict | None = None,
                  months_set: set[str] | None = None) -> tuple[list[Cluster], dict[str, list[str]]]:
    """반환: (군집 목록, 군집 id → 대표 post_key 5개). 임베딩 없는 글은 '기타'로."""
    params = dict(params or config.CLUSTER_PARAMS)
    have = [p for p in posts if p.key in embeddings]
    missing = [p for p in posts if p.key not in embeddings]
    groups: dict[int, list[Post]] = {}
    reps: dict[str, list[str]] = {}
    if have:
        X = np.stack([embeddings[p.key] for p in have]).astype(np.float32)
        norms = np.linalg.norm(X, axis=1, keepdims=True)
        X = X / np.where(norms == 0, 1, norms)
        labels = _labels(X, params)
        for p, l in zip(have, labels):
            groups.setdefault(int(l), []).append(p)
    ordered = sorted(groups.values(), key=lambda g: (-len(g), g[0].key))
    keep: list[list[Post]] = []
    other: list[Post] = list(missing)
    for g in ordered:
        if len(g) >= params["min_size"] and len(keep) < params["max_clusters"] - 1:
            keep.append(g)
        else:
            other.extend(g)
    clusters: list[Cluster] = []
    for i, g in enumerate(keep, 1):
        cid = f"c{i}"
        st = cluster_stats(g, months_set)
        clusters.append(Cluster(id=cid, name=f"군집 {i}", post_ids=[p.key for p in g], n_posts=len(g), **st))
        # 대표 문장: 중심에 가까운 순 5개
        X = np.stack([embeddings[p.key] for p in g]).astype(np.float32)
        c = X.mean(axis=0)
        d = X @ c / (np.linalg.norm(X, axis=1) * (np.linalg.norm(c) or 1) + 1e-9)
        idx = np.argsort(-d)[:3]
        reps[cid] = [g[int(j)].key for j in idx]
    if other:
        st = cluster_stats(other, months_set)
        clusters.append(Cluster(id=OTHER_ID, name="기타(소규모·미분류)", post_ids=[p.key for p in other],
                                n_posts=len(other), **st))
    return clusters, reps


def _rep_text(p: Post) -> str:
    t = (p.title or "").strip()
    b = " ".join((p.body or "").split())[:100]
    return (t + " — " + b) if t else b


def name_clusters(clusters: list[Cluster], reps: dict[str, list[str]], posts_by_key: dict[str, Post],
                  llm: LLM | None, *, model: str | None = None, job_id: str | None = None) -> list[str]:
    """LLM으로 군집 이름 생성. 실패 시 강등 문구를 넣고 degraded 목록을 반환."""
    degraded: list[str] = []
    targets = [c for c in clusters if c.id != OTHER_ID]
    if not targets:
        return degraded
    if llm is None:
        for c in targets:
            c.name = f"{c.name} (이름 생성 실패)"; c.name_failed = True
        degraded.append("군집 이름: LLM 미사용")
        return degraded
    system = load_prompt("cluster_name")
    ph = prompt_hash(system)
    blocks = []
    for c in targets:
        lines = "\n".join("- " + _rep_text(posts_by_key[k]) for k in reps.get(c.id, []) if k in posts_by_key)
        blocks.append(f'<cluster id="{c.id}">\n{lines}\n</cluster>')
    user = "\n\n".join(blocks)
    try:
        data = llm.call("cluster_name", model or config.MODEL_COACH, system, user, schema=NAME_SCHEMA,
                        prompt_hash=ph, max_tokens=60 * len(targets) + 40, retries=2, job_id=job_id, required=("names",))
        valid = {c.id for c in targets}
        got = {}
        for item in data.get("names") or []:
            cid, name = str(item.get("cluster_id", "")), str(item.get("name", "")).strip()
            if cid not in valid:
                raise LLMError(f"존재하지 않는 군집 id: {cid}")
            if name:
                got[cid] = name[:24]
        if set(got) != valid:
            raise LLMError("일부 군집 이름 누락")
        for c in targets:
            c.name = got[c.id]
    except LLMError as e:
        for c in targets:
            c.name = f"{c.name} (이름 생성 실패)"; c.name_failed = True
        degraded.append(f"군집 이름 생성 실패: {e}"[:200])
    return degraded
