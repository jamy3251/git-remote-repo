"""리포트 diff: 같은 query_hash의 직전 리포트 대비 변화.

규칙(CEO 플랜 Accepted Scope):
- 검색어 집합이 다르면 "검색어 변경됨(추가 X / 제거 Y)" 경고.
- 소스 집합 또는 조회 창 길이가 다르면 절대 건수·고유 작성자 diff 미표시("소스/기간 변경됨 — 건수 비교 불가"),
  공통 소스에 한해 소스별 건수 diff만 표시. 문제제기율에도 같은 경고 배지.
- 비율(문제제기율)과 전수 판정(N ≤ 800) 케이스만 변화량 표시. 표본 리포트의 절대 건수 diff는 "표본 재추출로 비교 불가".
"""
from __future__ import annotations

import sqlite3
from typing import Any


def load_previous(conn: sqlite3.Connection, query_hash: str, before_created_at: str | None = None,
                  exclude_id: str | None = None) -> dict | None:
    import json
    sql = "SELECT id, created_at, metrics_json, terms_json, sources_json, since FROM reports WHERE query_hash=?"
    args: list[Any] = [query_hash]
    if before_created_at:
        sql += " AND created_at < ?"; args.append(before_created_at)
    if exclude_id:
        sql += " AND id != ?"; args.append(exclude_id)
    sql += " ORDER BY created_at DESC LIMIT 1"
    r = conn.execute(sql, args).fetchone()
    if not r:
        return None
    return {"id": r["id"], "created_at": r["created_at"], "metrics": json.loads(r["metrics_json"]),
            "terms": json.loads(r["terms_json"]), "sources": json.loads(r["sources_json"]), "since": r["since"]}


def _delta(a, b):
    if a is None or b is None:
        return None
    return b - a


def diff_reports(prev: dict, cur_metrics: dict, cur_terms: list[str], cur_sources: list[str], cur_since: str) -> dict:
    pm = prev["metrics"]
    warnings: list[str] = []
    added = sorted(set(cur_terms) - set(prev["terms"]))
    removed = sorted(set(prev["terms"]) - set(cur_terms))
    terms_changed = bool(added or removed)
    if terms_changed:
        warnings.append(f"검색어 변경됨(추가 {len(added)} / 제거 {len(removed)}) — 건수 변화에 검색어 변경 효과가 섞여 있음")
    prev_src, cur_src = set(prev["sources"]), set(cur_sources)
    scope_changed = (prev_src != cur_src) or (pm.get("window_months") != cur_metrics.get("window_months"))
    if scope_changed:
        warnings.append("소스/기간 변경됨 — 건수 비교 불가")
    sampled_any = bool(pm.get("sampled") or cur_metrics.get("sampled"))
    counts_ok = (not scope_changed) and (not sampled_any)
    out: dict[str, Any] = {
        "prev_id": prev["id"], "prev_created_at": prev["created_at"],
        "terms_added": added, "terms_removed": removed, "terms_changed": terms_changed,
        "scope_changed": scope_changed, "sampled_any": sampled_any, "warnings": warnings,
        "pain_rate": {"prev": pm.get("pain_rate"), "cur": cur_metrics.get("pain_rate"),
                      "delta": _delta(pm.get("pain_rate"), cur_metrics.get("pain_rate")),
                      "flag": scope_changed or terms_changed},
        "counts": None, "count_note": None, "per_source": [],
    }
    if counts_ok:
        out["counts"] = {
            k: {"prev": pm.get(k), "cur": cur_metrics.get(k), "delta": _delta(pm.get(k), cur_metrics.get(k))}
            for k in ("n_hit_total", "n_relevant", "n_pain", "unique_authors_strong", "distinct_ip_bands_weak", "months_present")
        }
    elif sampled_any and not scope_changed:
        out["count_note"] = "표본 재추출로 비교 불가(절대 건수·고유 작성자)"
    else:
        out["count_note"] = "소스/기간 변경됨 — 건수 비교 불가"
    # 소스별 관련 글 수 diff (공통 소스만)
    def per_source(m):
        acc: dict[str, int] = {}
        for row in m.get("monthly", []):
            acc[row["source"]] = acc.get(row["source"], 0) + int(row.get("relevant", 0))
        return acc
    ps, cs = per_source(pm), per_source(cur_metrics)
    for s in sorted(prev_src & cur_src):
        out["per_source"].append({"source": s, "prev": ps.get(s, 0), "cur": cs.get(s, 0),
                                  "delta": cs.get(s, 0) - ps.get(s, 0), "sampled": sampled_any})
    return out
