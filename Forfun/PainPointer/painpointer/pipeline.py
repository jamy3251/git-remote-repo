"""리포트 생성 오케스트레이터 — CLI·jobs 공용.

expand(사용자 확인 후) → search → sample → classify → aggregate → cluster(+name) → quotes
→ attempts → coach → source_status/candidates → diff → render → reports 저장.

posts는 읽기 전용 연결로만 읽고, judgments/llm_calls/reports는 짧은 쓰기 연결로 기록한다.
"""
from __future__ import annotations

import json
import secrets
import sqlite3
from collections import Counter
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from pathlib import Path

from dccrawler.models import Post
from dccrawler.sources import list_sources
from dccrawler.storage import Store

from . import config, db
from .aggregate import aggregate, month_of, window_months, window_since
from .classify import classify, stratified_sample
from .cluster import cluster_posts, name_clusters
from .coach import coach, report_gaps
from .diff import diff_reports, load_previous
from .embed import Embedder, load_post_embeddings, similar_attempts
from .llm import LLM
from .log import Timer, log_event
from .models import Judgment, LLMCallRef, Query, Quote, Report, SourceStatus
from .render import render_report
from .search import DEDUP_RULES_TEXT, search_corpus
from .textnorm import NORM_VERSION, mask_author, query_hash


class DBBusy(RuntimeError):
    """수집 배치가 DB를 잠근 상태. 사용자 메시지: 'N분 후 재시도'."""


@dataclass
class GenerateRequest:
    pain: str
    target: str
    terms: list[str]
    sources: list[str] = field(default_factory=list)
    generated_terms: list[str] = field(default_factory=list)
    user_edited: bool = False
    expansion_status: str = "ok"
    mode: str = "contest"

    def to_query(self) -> Query:
        return Query(pain=self.pain, target=self.target, terms=list(self.terms),
                     generated_terms=list(self.generated_terms), user_edited=self.user_edited,
                     mode=self.mode, expansion_status=self.expansion_status, sources=list(self.sources))


def select_quotes(clusters, judgments: list[Judgment], posts_by_key: dict[str, Post], *,
                  max_quotes: int = config.MAX_QUOTES, per_author: int = config.MAX_QUOTES_PER_AUTHOR) -> tuple[list[Quote], int]:
    """후보 풀 = 강도 ≥ 2 & verified 인용. 군집 라운드로빈 → 강도 3 우선 → 다른 월·소스 우선 → 작성자 최대 2건."""
    jmap = {j.post_id: j for j in judgments if j.status == "ok" and j.relevant and j.intensity >= 2 and j.quotes}
    cluster_of: dict[str, str] = {}
    for c in clusters:
        for k in c.post_ids:
            cluster_of[k] = c.id
    pool_size = sum(len([q for q in j.quotes if q.verified]) for j in jmap.values())
    per_cluster: dict[str, list[tuple[Post, Judgment]]] = {}
    for k, j in jmap.items():
        p = posts_by_key.get(k)
        if not p:
            continue
        per_cluster.setdefault(cluster_of.get(k, "c_none"), []).append((p, j))
    order = [c.id for c in clusters if c.id in per_cluster] + [cid for cid in per_cluster if cid not in {c.id for c in clusters}]
    out: list[Quote] = []
    author_count: Counter = Counter()
    used_ms: set[tuple[str, str]] = set()
    while len(out) < max_quotes and any(per_cluster.get(cid) for cid in order):
        for cid in order:
            cands = per_cluster.get(cid) or []
            if not cands or len(out) >= max_quotes:
                continue
            def rank(item):
                p, j = item
                ms = (month_of(p) or "", p.source)
                return (-j.intensity, 1 if ms in used_ms else 0, p.created_at or "", p.key)
            cands.sort(key=rank)
            picked = None
            for i, (p, j) in enumerate(cands):
                akey = (p.author_id_kind, p.author_id) if p.author_id and p.author_id_kind != "none" else None
                if akey and author_count[akey] >= per_author:
                    continue
                picked = i
                break
            if picked is None:
                per_cluster[cid] = []
                continue
            p, j = cands.pop(picked)
            akey = (p.author_id_kind, p.author_id) if p.author_id and p.author_id_kind != "none" else None
            if akey:
                author_count[akey] += 1
            used_ms.add((month_of(p) or "", p.source))
            qc = next(q for q in j.quotes if q.verified)
            out.append(Quote(
                post_id=p.key, cluster_id=cid, text=qc.text, source=p.source, board=p.board,
                created_at=(month_of(p) and (p.created_at[:10] if len(p.created_at) >= 10 else p.created_at)) or p.created_at,
                author_masked=mask_author(p.author), url=p.url, source_ref=p.source_ref,
                crawled_at=(p.crawled_at or "")[:10], dead_link=False, context_excerpt=qc.context_excerpt,
                intensity=j.intensity,
            ))
    return out, pool_size


def source_status(conn: sqlite3.Connection, today: date) -> list[SourceStatus]:
    kinds = {s["name"]: s["author_id_kind"] for s in list_sources()}
    out: list[SourceStatus] = []
    try:
        watch = conn.execute("SELECT source, board FROM watch_list WHERE enabled=1 ORDER BY id").fetchall()
    except sqlite3.OperationalError:
        return out
    for w in watch:
        last = conn.execute(
            "SELECT run_date FROM collection_runs WHERE source=? AND board=? AND status='ok' ORDER BY run_date DESC LIMIT 1",
            (w["source"], w["board"]),
        ).fetchone()
        last_ok = last["run_date"] if last else None
        stale = (today - date.fromisoformat(last_ok)).days if last_ok else None
        recent = conn.execute(
            "SELECT status FROM collection_runs WHERE source=? AND board=? ORDER BY run_date DESC, id DESC LIMIT 1",
            (w["source"], w["board"]),
        ).fetchone()
        out.append(SourceStatus(source=w["source"], board=w["board"], last_ok=last_ok, days_stale=stale,
                                suspect=bool(recent and recent["status"] == "suspect"),
                                author_id_kind=kinds.get(w["source"], "none")))
    return out


def candidates(conn: sqlite3.Connection, today: date, limit: int = 8) -> tuple[list[dict], int | None]:
    try:
        rows = conn.execute("SELECT kind, name, ref, keyword, fetched_at FROM source_candidates ORDER BY fetched_at DESC, id LIMIT ?", (limit,)).fetchall()
    except sqlite3.OperationalError:
        return [], None
    if not rows:
        return [], None
    latest = max(r["fetched_at"][:10] for r in rows)
    stale = (today - date.fromisoformat(latest)).days
    return [dict(r) for r in rows], stale


def generate_report(req: GenerateRequest, *, db_path: str | Path | None = None, llm: LLM | None,
                    embedder: Embedder | None, today: date | None = None, job_id: str | None = None,
                    progress=None, flags: dict | None = None) -> tuple[Report, str]:
    db_path = Path(db_path or config.DB_PATH)
    today = today or date.today()
    flags = {"SHOW_CASES": config.SHOW_CASES, "SHOW_ATTEMPTS": config.SHOW_ATTEMPTS, **(flags or {})}
    q = req.to_query()
    qh = query_hash(q.pain, q.target)
    since = window_since(today)
    months_set = set(window_months(today))
    say = progress or (lambda *_: None)
    llm_refs: list[LLMCallRef] = []
    degraded: list[str] = []

    try:
        store = Store(db_path, readonly=True)
    except sqlite3.OperationalError as e:
        if db.is_locked_error(e):
            raise DBBusy("수집 배치 진행 중 — 5분 후 재시도하세요") from e
        raise
    try:
        conn = store.conn
        with Timer() as t:
            sr = search_corpus(store, q.terms, sources=q.sources or None, since_day=since)
        log_event("stage", job_id=job_id, stage="search", elapsed_ms=t.ms, n_raw=sr.n_raw, n=len(sr.posts))
        say(f"검색 적중 {sr.n_raw}건 → 중복 제거 후 {len(sr.posts)}건")
        hits = sr.posts
        sample, sampled = stratified_sample(hits, config.SAMPLE_MAX, seed=qh)
        say(f"판정 표본 {len(sample)}건{' (층화 표본)' if sampled else ' (전수)'}")

        if llm is None:
            judgments = []
            n_cached = n_new = n_injection = 0
            degraded.append("판정: LLM 미사용(수치 미산출)")
        else:
            with Timer() as t:
                cr = classify(sample, q.pain, q.target, qh, llm, db_path=db_path, job_id=job_id, progress=say)
            log_event("stage", job_id=job_id, stage="classify", elapsed_ms=t.ms, cached=cr.n_cached, new=cr.n_new, failed=cr.n_failed)
            judgments, n_cached, n_new, n_injection = cr.judgments, cr.n_cached, cr.n_new, cr.n_injection
            llm_refs.append(LLMCallRef(stage="classify", model=cr.model, prompt_hash=cr.prompt_hash,
                                       warning=config.model_warning(cr.model)))
        posts_by_key = {p.key: p for p in sample}
        metrics = aggregate(hits=hits, sample=sample, sampled=sampled, judgments=judgments, conn=conn, today=today,
                            sources=q.sources or None, merged=sr.merged, n_cached=n_cached, n_new=n_new,
                            n_injection=n_injection)
        say(f"관련 {metrics.n_relevant}건 / 페인 신호 {metrics.n_pain}건" + (" — 근거 부족" if metrics.insufficient else ""))

        rel_posts = [posts_by_key[j.post_id] for j in judgments if j.status == "ok" and j.relevant and j.post_id in posts_by_key]
        emb = load_post_embeddings(conn, [p.key for p in rel_posts]) if rel_posts else {}
        if rel_posts and len(emb) < len(rel_posts):
            degraded.append(f"임베딩 미계산 글 {len(rel_posts) - len(emb)}건 → '기타' 군집으로(수집 배치의 임베딩 단계 필요)")
        clusters, reps = cluster_posts(rel_posts, emb, config.CLUSTER_PARAMS, months_set) if rel_posts else ([], {})
        if clusters and llm is not None:
            from .cluster import OTHER_ID
            named = [c for c in clusters if c.id != OTHER_ID]
            if named:
                degraded += name_clusters(clusters, reps, posts_by_key, llm, job_id=job_id)
                from .llm import load_prompt
                from .textnorm import prompt_hash as _ph
                llm_refs.append(LLMCallRef(stage="cluster_name", model=config.MODEL_COACH,
                                           prompt_hash=_ph(load_prompt("cluster_name")),
                                           warning=config.model_warning(config.MODEL_COACH)))
        quotes, pool = select_quotes(clusters, judgments, posts_by_key)

        attempts = None
        if flags["SHOW_ATTEMPTS"]:
            if embedder is None:
                degraded.append("유사 시도 미계산 — 임베더 없음")
            else:
                vec = embedder.encode([q.pain])[0]
                attempts = similar_attempts(conn, vec)
                if attempts is None:
                    degraded.append("유사 시도 미계산 — 사전 계산 배치 필요(attempt_embeddings 비어 있음)")

        summary = report_gaps(metrics, clusters, attempts)
        questions, d2 = coach(q.pain, q.target, summary, llm, job_id=job_id)
        degraded += d2
        if llm is not None:
            from .llm import load_prompt
            from .textnorm import prompt_hash as _ph
            llm_refs.append(LLMCallRef(stage="coach", model=config.MODEL_COACH, prompt_hash=_ph(load_prompt("coach")),
                                       warning=config.model_warning(config.MODEL_COACH)))
        if q.expansion_status == "ok" and q.generated_terms:
            from .llm import load_prompt
            from .textnorm import prompt_hash as _ph
            llm_refs.insert(0, LLMCallRef(stage="expand", model=config.MODEL_CLASSIFY, prompt_hash=_ph(load_prompt("expand")),
                                          warning=config.model_warning(config.MODEL_CLASSIFY)))

        status = source_status(conn, today)
        cands, cand_stale = ([], None)
        if metrics.insufficient:
            cands, cand_stale = candidates(conn, today)
            if cand_stale is not None and cand_stale >= config.CANDIDATES_STALE_DAYS:
                cands = []
        prev = load_previous(conn, qh)
    finally:
        store.close()

    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    rid = secrets.token_urlsafe(16)
    sources_used = sorted(q.sources or {row.source for row in metrics.monthly})
    diff = diff_reports(prev, metrics.to_dict(), q.terms, sources_used, since) if prev else None
    report = Report(
        id=rid, query=q, metrics=metrics, clusters=clusters, quotes=quotes, attempts=attempts,
        cases=None, questions=questions, flags=flags, llm_calls=llm_refs, degraded=degraded,
        cluster_params=dict(config.CLUSTER_PARAMS), source_status=status, candidates=cands,
        candidates_stale_days=cand_stale, diff=diff, created_at=now, quotes_pool_size=pool,
        dedup_rules=DEDUP_RULES_TEXT, norm_version=NORM_VERSION,
    )
    html = render_report(report)
    wconn = db.open_write(db_path)
    try:
        with wconn:
            wconn.execute(
                "INSERT INTO reports(id, query_hash, query_json, metrics_json, report_json, html, terms_json, sources_json,"
                " since, created_at, snapshot_date) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                (rid, qh, json.dumps(q.to_dict(), ensure_ascii=False), json.dumps(metrics.to_dict(), ensure_ascii=False),
                 json.dumps(report.to_dict(), ensure_ascii=False, default=str), html,
                 json.dumps(q.terms, ensure_ascii=False), json.dumps(sources_used, ensure_ascii=False),
                 since, now, metrics.snapshot_date),
            )
    finally:
        wconn.close()
    log_event("report", job_id=job_id, report_id=rid, query_hash=qh, n_relevant=metrics.n_relevant,
              insufficient=metrics.insufficient, degraded=len(degraded))
    return report, html


def load_report_html(db_path: str | Path, report_id: str) -> str | None:
    conn = db.open_read(db_path)
    try:
        r = conn.execute("SELECT html FROM reports WHERE id=?", (report_id,)).fetchone()
        return r["html"] if r else None
    finally:
        conn.close()
