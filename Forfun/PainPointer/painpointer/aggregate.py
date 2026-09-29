"""4단계 aggregate: 지표 정의(설계 고정) 전부를 파이썬 산술로 계산한다. LLM 개입 없음.

- 근거 부족 게이트: 관련 글 M < 30 또는 등장 월 < 3 → insufficient=True (표시 여부만, 계산은 항상).
- 표본일 때 고유 작성자·등장 월은 "표본 기준 최소값" 라벨(sample_min_labels).
- 월별 추이는 소스별 분리(합산 분모 금지): relevant / judged (괄호: 그 달·소스 전체 수집 글 수).
"""
from __future__ import annotations

import re
import sqlite3
from collections import Counter, defaultdict
from datetime import date

from dccrawler.analysis.keywords import PAIN_PATTERNS
from dccrawler.models import Post, parse_day

from . import config
from .models import Judgment, Metrics, MonthlyRow

_PAIN_RE = [re.compile(v, re.IGNORECASE) for v in PAIN_PATTERNS.values()]


def month_of(p: Post) -> str | None:
    d = parse_day(p.created_at, p.crawled_at)
    return d[:7] if d else None


def window_since(today: date, months: int = config.WINDOW_MONTHS) -> str:
    """조회 창 시작일(YYYY-MM-01): 생성일 기준 months개월 전의 1일."""
    y, m = today.year, today.month - (months - 1)
    while m <= 0:
        m += 12
        y -= 1
    return f"{y:04d}-{m:02d}-01"


def window_months(today: date, months: int = config.WINDOW_MONTHS) -> list[str]:
    out = []
    y, m = today.year, today.month
    for _ in range(months):
        out.append(f"{y:04d}-{m:02d}")
        m -= 1
        if m == 0:
            m = 12
            y -= 1
    return list(reversed(out))


def corpus_monthly_totals(conn: sqlite3.Connection, since_day: str, sources: list[str] | None) -> dict[tuple[str, str], int]:
    """(source, month) → 그 달·그 소스 전체 수집 글 수."""
    sql = "SELECT source, substr(created_day,1,7) AS m, COUNT(*) AS n FROM posts WHERE created_day >= ?"
    args: list = [since_day]
    if sources:
        sql += " AND source IN (%s)" % ",".join("?" * len(sources))
        args.extend(sources)
    sql += " GROUP BY source, m"
    return {(r["source"], r["m"]): int(r["n"]) for r in conn.execute(sql, args).fetchall() if r["m"]}


def missed_days(conn: sqlite3.Connection, since_day: str) -> dict[tuple[str, str], int]:
    """(source, month) → 영구 유실 확정 일수(collection_runs.status='missed')."""
    out: Counter = Counter()
    try:
        rows = conn.execute(
            "SELECT source, missed_from, missed_to FROM collection_runs WHERE status='missed' AND missed_to >= ?",
            (since_day,),
        ).fetchall()
    except sqlite3.OperationalError:
        return {}
    for r in rows:
        try:
            a = date.fromisoformat(r["missed_from"]); b = date.fromisoformat(r["missed_to"])
        except (TypeError, ValueError):
            continue
        d = a
        while d <= b:
            out[(r["source"], d.strftime("%Y-%m"))] += 1
            d = d.fromordinal(d.toordinal() + 1)
    return dict(out)


def pattern_hits(posts: list[Post]) -> int:
    n = 0
    for p in posts:
        t = p.index_text()
        if any(r.search(t) for r in _PAIN_RE):
            n += 1
    return n


def aggregate(*, hits: list[Post], sample: list[Post], sampled: bool, judgments: list[Judgment],
              conn: sqlite3.Connection, today: date, sources: list[str] | None,
              merged: dict[str, int], n_cached: int = 0, n_new: int = 0, n_injection: int = 0) -> Metrics:
    since = window_since(today)
    months = window_months(today)
    month_set = set(months)
    by_key = {p.key: p for p in sample}
    jmap = {j.post_id: j for j in judgments}

    ok = [j for j in judgments if j.status == "ok"]
    failed = [j for j in judgments if j.status != "ok"]
    relevant = [j for j in ok if j.relevant]
    pain = [j for j in relevant if j.intensity >= 2]
    rel_posts = [by_key[j.post_id] for j in relevant if j.post_id in by_key]

    strong = {p.author_id for p in rel_posts if p.author_id_kind == "strong" and p.author_id}
    weak = {p.author_id for p in rel_posts if p.author_id_kind == "weak" and p.author_id}
    has_strong = any(p.author_id_kind == "strong" for p in sample)
    has_weak = any(p.author_id_kind == "weak" for p in sample)

    totals = corpus_monthly_totals(conn, since, sources)
    missed = missed_days(conn, since)
    covered = {m for (_s, m) in totals if m in month_set}
    present = {month_of(p) for p in rel_posts} & month_set

    hit_c: Counter = Counter((p.source, month_of(p)) for p in hits)
    judged_c: Counter = Counter((by_key[j.post_id].source, month_of(by_key[j.post_id]))
                                for j in ok if j.post_id in by_key)
    rel_c: Counter = Counter((p.source, month_of(p)) for p in rel_posts)
    src_set = sorted({p.source for p in hits} | {s for (s, _m) in totals})
    monthly: list[MonthlyRow] = []
    for s in src_set:
        for m in months:
            monthly.append(MonthlyRow(
                month=m, source=s, relevant=rel_c.get((s, m), 0), hit=hit_c.get((s, m), 0),
                judged=judged_c.get((s, m), 0), corpus_total=totals.get((s, m), 0),
                missed_days=missed.get((s, m), 0),
            ))

    n_rel, n_pain = len(relevant), len(pain)
    n_judged = len(judgments)
    return Metrics(
        snapshot_date=today.isoformat(),
        n_hit_total=len(hits), n_judged=n_judged, sampled=sampled, n_failed=len(failed),
        n_relevant=n_rel, n_pain=n_pain, pain_rate=(n_pain / n_rel) if n_rel else None,
        unique_authors_strong=len(strong) if has_strong else None,
        distinct_ip_bands_weak=len(weak) if has_weak else None,
        months_covered=min(config.WINDOW_MONTHS, len(covered)), months_present=len(present),
        monthly=monthly, merged_duplicates=sum(merged.values()),
        insufficient=(n_rel < config.MIN_RELEVANT or len(present) < config.MIN_MONTHS),
        sample_min_labels=sampled, n_cached=n_cached, n_new=n_new, n_injection=n_injection,
        pattern_hits=pattern_hits(rel_posts), merged_detail=dict(merged),
        failed_warn=(n_judged > 0 and len(failed) / n_judged > config.FAILED_WARN_RATIO),
        since=since, window_months=config.WINDOW_MONTHS,
    )


def cluster_stats(posts: list[Post], months_set: set[str] | None = None) -> dict:
    strong = {p.author_id for p in posts if p.author_id_kind == "strong" and p.author_id}
    weak = {p.author_id for p in posts if p.author_id_kind == "weak" and p.author_id}
    ms = {month_of(p) for p in posts if month_of(p)}
    if months_set is not None:
        ms &= months_set
    return {
        "unique_authors_strong": len(strong) if any(p.author_id_kind == "strong" for p in posts) else None,
        "distinct_ip_bands_weak": len(weak) if any(p.author_id_kind == "weak" for p in posts) else None,
        "months_present": len(ms),
        "sources": sorted({p.source for p in posts}),
    }
