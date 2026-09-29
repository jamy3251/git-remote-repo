"""멀티소스 교차 분석.

여러 (소스/보드)의 글을 비교해:
- 공통 키워드(2개 이상 소스에 등장) → 같은 언어권 공통 화제
- 페인 카테고리 매트릭스(카테고리×소스) → 언어 무관 비교
- 소스 고유 키워드 → 커뮤니티별 차별 관심사
- (선택) LLM 교차 종합 → 교차검증된 수요 / 커뮤니티 간 차이
"""
from __future__ import annotations

from collections import defaultdict

from . import painpoints


def build(per_source: list[dict], *, use_llm: bool = True) -> dict:
    """per_source: [{"source","board","posts":list[Post],"keywords":dict}, ...]"""
    targets: list[dict] = []
    word_src: dict[str, dict[str, int]] = defaultdict(dict)   # word -> {key: count}
    cat_matrix: dict[str, dict[str, int]] = defaultdict(dict)  # category -> {key: count}
    per_out: dict[str, dict] = {}

    for ps in per_source:
        key = f"{ps['source']}/{ps['board']}"
        kw = ps["keywords"]
        targets.append({
            "source": ps["source"], "board": ps["board"], "key": key,
            "count": kw["post_count"], "pain_count": kw["pain"]["post_count"],
            "pain_ratio": kw["pain"]["ratio"],
        })
        for k in kw["top_keywords"]:
            word_src[k["word"]][key] = k["count"]
        for c in kw["pain"]["by_category"]:
            cat_matrix[c["category"]][key] = c["count"]
        per_out[key] = kw

    keys = [t["key"] for t in targets]

    shared: list[dict] = []
    unique: dict[str, list] = defaultdict(list)
    for word, srcmap in word_src.items():
        if len(srcmap) >= 2:
            shared.append({"word": word, "sources": srcmap,
                           "source_count": len(srcmap), "total": sum(srcmap.values())})
        else:
            k = next(iter(srcmap))
            unique[k].append({"word": word, "count": srcmap[k]})
    shared.sort(key=lambda x: (x["source_count"], x["total"]), reverse=True)
    for k in list(unique):
        unique[k] = sorted(unique[k], key=lambda x: x["count"], reverse=True)[:12]

    pain_matrix = [
        {"category": cat, "by_source": srcmap, "total": sum(srcmap.values())}
        for cat, srcmap in cat_matrix.items()
    ]
    pain_matrix.sort(key=lambda x: x["total"], reverse=True)

    llm = painpoints.analyze_cross(per_source) if use_llm else {
        "available": False, "reason": "비활성화됨"}

    return {
        "targets": targets,
        "keys": keys,
        "total_posts": sum(t["count"] for t in targets),
        "shared_keywords": shared[:30],
        "unique_keywords": dict(unique),
        "pain_matrix": pain_matrix,
        "per_source": per_out,
        "llm": llm,
    }
