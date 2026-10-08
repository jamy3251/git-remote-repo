"""PainPointer CLI.

  python -m painpointer init                      # DB 생성/마이그레이션
  python -m painpointer serve                     # 127.0.0.1:8765
  python -m painpointer watch add dcinside <갤러리ID> [--label ...]
  python -m painpointer watch add googleplay <패키지ID>   (앱스토어: watch add appstore <앱 숫자 ID>)
  python -m painpointer watch list | rm <source> <board>
  python -m painpointer collect [--source dcinside|dcinside:board] [--no-embed] [--no-body] [--no-extract]
  python -m painpointer embed-posts               # 임베딩 미계산 글 배치
  python -m painpointer precompute-attempts       # 한이음 임베딩 사전 계산
  python -m painpointer models                    # /v1/models 목록(스냅샷 ID 확인)
  python -m painpointer report --pain "..." --target "..." [--term ...] [--source ...] [--out r.html] [--no-expand]
  python -m painpointer status
  python -m painpointer radar-collect [--source cisa_kev] [--layer 1] [--query '{"topic_id": "T10028"}'] [--since 2026-01-01]
  python -m painpointer radar-sources            # 레이더 원천 등급·키·최신 시점
  python -m painpointer radar-fields build|show|venues   # 레이더 분야 6개 정의 · 분야별 명망지
  python -m painpointer radar-fields community --source dcinside --board <갤러리> --field security
  python -m painpointer radar-collect --field ai [--source openalex] [--limit 10]
  python -m painpointer radar-link --report <리포트 id> --field ai [--limit 10] [--no-gap]   # 연결층(LLM, 레이더 예산)
"""
from __future__ import annotations

import argparse
import sys
from datetime import date, datetime, timezone
from pathlib import Path

from . import config


def _print(s: str = "") -> None:
    sys.stdout.buffer.write((s + "\n").encode("utf-8", "replace"))
    sys.stdout.flush()


def cmd_init(a):
    from . import db
    from .radar.radar_db import init_radar_db
    p = db.init_db(a.db)
    _print(f"DB 준비됨: {p}")
    _print(f"레이더 DB 준비됨: {init_radar_db()}")


def cmd_serve(a):
    import uvicorn
    from .app import create_app
    app = create_app(a.db)
    uvicorn.run(app, host=config.HOST, port=a.port or config.PORT, log_level="info")


def cmd_watch(a):
    from . import db
    db.init_db(a.db)
    conn = db.open_write(a.db)
    try:
        if a.action == "add":
            with conn:
                conn.execute("INSERT INTO watch_list(source, board, label, enabled, added_at) VALUES (?,?,?,1,?)"
                             " ON CONFLICT(source, board) DO UPDATE SET enabled=1, label=excluded.label",
                             (a.source, a.board, a.label or "", datetime.now(timezone.utc).isoformat(timespec="seconds")))
            _print(f"추가: {a.source}/{a.board}")
        elif a.action == "rm":
            with conn:
                conn.execute("UPDATE watch_list SET enabled=0 WHERE source=? AND board=?", (a.source, a.board))
            _print(f"비활성화: {a.source}/{a.board}")
        else:
            for r in conn.execute("SELECT * FROM watch_list ORDER BY id"):
                _print(f"  {'on ' if r['enabled'] else 'off'} {r['source']:<12} {r['board']:<30} {r['label']}")
    finally:
        conn.close()


def cmd_collect(a):
    from .collect_daily import Collector
    from .embed import Embedder
    import os
    from . import config
    llm = None
    if config.COLLECT_EXTRACT and not a.no_extract:
        if os.getenv("ANTHROPIC_API_KEY"):
            from .llm import LLM
            llm = LLM(a.db)
        else:
            _print("불편 추출 건너뜀 — ANTHROPIC_API_KEY 없음(.env)")
    c = Collector(a.db, embedder=None if a.no_embed else Embedder(), fetch_body=not a.no_body, delay=a.delay, llm=llm)
    res = c.run(a.source, progress=_print)
    for r in res:
        _print(f"  {r['source']}/{r['board']}: {r['status']} 신규 {r['n_new']}" + (f" — {r['error']}" if r['error'] else ""))


def cmd_embed_posts(a):
    from .embed import Embedder, embed_missing_posts
    n = embed_missing_posts(a.db, Embedder(), progress=_print)
    _print(f"임베딩 계산 {n}건")


def cmd_precompute(a):
    from .embed import Embedder, load_hanium_projects, precompute_attempts
    projects = load_hanium_projects(a.data_dir or config.HANCRAWLER_DATA)
    _print(f"한이음 프로젝트 {len(projects)}건 로드")
    n = precompute_attempts(a.db, Embedder(), projects, progress=_print)
    _print(f"attempt_embeddings 저장 {n}건")


def cmd_reembed(a):
    from . import db
    from .embed import Embedder, load_hanium_projects, reembed
    db.init_db(a.db)
    projects = load_hanium_projects(a.data_dir or config.HANCRAWLER_DATA)
    _print(f"{a.model}로 재임베딩 — 글 + 한이음 {len(projects)}건 + 불편 추출 문장 (옛 모델 행은 다 채운 뒤 삭제)")
    r = reembed(a.db, Embedder(a.model), projects=projects, delete_old=not a.keep_old, progress=_print)
    _print(f"글 {r['posts']}건 · 한이음 {r['attempts']}건 · 추출 문장 {r['extracts']}건 계산, "
           f"옛 모델 행 삭제 글 {r['deleted_posts']} · 한이음 {r['deleted_attempts']} · 추출 문장 {r['deleted_extracts']}")
    if r["missing"]:
        _print(f"⚠ 아직 {r['missing']}건이 새 모델로 계산되지 않아 옛 모델 행을 지우지 않았습니다. 다시 실행하세요.")
    if a.model != config.EMBED_MODEL:
        _print(f".env에 PP_EMBED_MODEL={a.model} 을 넣어야 리포트가 새 모델을 씁니다(지금은 {config.EMBED_MODEL}).")


def cmd_models(a):
    from .llm import list_models
    for m in list_models():
        _print(f"  {m['id']:<40} {m['display_name']:<28} {m['created_at'][:10]}")
    _print("\n설정된 모델: classify=%s / coach=%s" % (config.MODEL_CLASSIFY or "(없음)", config.MODEL_COACH or "(없음)"))
    for w in (config.model_warning(config.MODEL_CLASSIFY), config.model_warning(config.MODEL_COACH)):
        if w:
            _print("  ⚠ " + w)


def cmd_report(a):
    from . import db
    from .embed import Embedder
    from .expand import clean_terms, expand_query
    from .llm import LLM
    from .pipeline import GenerateRequest, generate_report
    from .render import save_html
    db.init_db(a.db)
    config.require_models()
    llm = LLM(a.db)
    if a.no_expand:
        terms = clean_terms(a.term or [a.pain])
        req = GenerateRequest(pain=a.pain, target=a.target, terms=terms, sources=a.source or [],
                              expansion_status="failed(사용자가 확장 생략)")
    else:
        q = expand_query(a.pain, a.target, llm)
        terms = clean_terms(q.terms[:1] + (a.term or []) + q.terms[1:])   # 사용자 지정 검색어가 12개 상한에 잘리지 않게 앞에
        req = GenerateRequest(pain=q.pain, target=q.target, terms=terms, sources=a.source or [],
                              generated_terms=q.generated_terms, user_edited=bool(a.term),
                              expansion_status=q.expansion_status)
    _print("검색어: " + ", ".join(req.terms))
    report, html = generate_report(req, db_path=a.db, llm=llm, embedder=Embedder(), progress=_print)
    out = Path(a.out) if a.out else config.DATA_DIR / "reports" / f"{report.id}.html"
    save_html(html, out)
    _print(f"리포트 {report.id} → {out}")


def cmd_discover(a):
    from . import db
    from .discover import DiscoverRequest, discover
    from .embed import Embedder
    from .llm import LLM
    from .render import save_html
    db.init_db(a.db)
    config.require_models()
    req = DiscoverRequest(boards=a.board, target=a.target, days=a.days)
    pm, html = discover(req, db_path=a.db, llm=LLM(a.db), embedder=Embedder(), progress=_print)
    out = Path(a.out) if a.out else config.DATA_DIR / "reports" / f"map-{pm.id}.html"
    save_html(html, out)
    for it in pm.items[:10]:
        _print(f"  {it.rank:>2}. {it.pain}  — 후보 신호 {it.n_posts}건{' (약한 신호)' if it.weak else ''}")
    _print(f"페인 지도 {pm.id} → {out}  (가설 후보 — 근거 수치는 report로 검증)")


def cmd_radar_collect(a):
    """레이더 신호 원천 실행. 피드 원천은 질의 없이, 토픽 원천은 --query JSON(토픽 목록은 T8 분야 정의에서)."""
    import json as _json
    from .radar import sources
    if a.field:                                  # 분야 토픽마다 토픽 원천(T8 분야 정의 필요)
        from .radar import fields, radar_db
        radar_db.init_radar_db()
        conn = radar_db.open_read()
        try:
            qs = fields.topic_queries(conn, a.field, tuple(a.source or fields.TOPIC_SOURCES), limit=a.limit)
        finally:
            conn.close()
        if not qs:
            raise SystemExit(f"{a.field} 분야 토픽 없음 — 먼저 python -m painpointer radar-fields build")
        objs: dict = {}
        bad = 0
        for name, q in qs:
            src = objs.setdefault(name, sources.get(name))      # 원천 객체 재사용(요청 간격·분모 캐시)
            r = sources.run_source(src, q, db_path=a.db, progress=_print)
            bad += r["status"] == "failed"
            if r["status"] != "ok":
                _print(f"[{name}/{r['label']}] {r['status']}: {r['error']}")
        _print(f"{a.field}: 질의 {len(qs)}개, 실패 {bad}개")
        return
    names = a.source or [n for n, c in sources.all_sources().items()
                         if not c.needs_query and (not a.layer or c.layer in a.layer)]
    query = _json.loads(a.query) if a.query else {}
    if a.since:
        query["since"] = a.since
    bad = 0
    for name in names:
        src = sources.get(name)
        if src.needs_query and not query:
            _print(f"[{name}] 건너뜀 — 토픽 질의가 필요한 원천(--query '{{\"topic_id\": ...}}')")
            continue
        r = sources.run_source(src, query, db_path=a.db, progress=_print)
        if r["status"] != "ok":
            bad += r["status"] == "failed"
            _print(f"[{name}/{r['label']}] {r['status']}: {r['error']}")
    _print(f"원천 {len(names)}개 실행, 실패 {bad}개")


def cmd_radar_fields(a):
    from .embed import Embedder
    from .radar import fields, radar_db, sources
    radar_db.init_radar_db()
    if a.action == "build":
        fields.build_fields(sources.get("openalex_topics"), Embedder(), use_l2=not a.no_l2, progress=_print)
    elif a.action == "venues":
        conn = radar_db.open_read()
        try:
            qs = [fields.venue_query(conn, f) for f in fields.FIELD_ORDER]
        finally:
            conn.close()
        for q in filter(None, qs):
            r = sources.run_source(sources.get("openalex_venues"), q, db_path=a.db)
            _print(f"[{q['radar_field_id']}] {r['status']} {r['error'] or ''}")
    elif a.action == "community":
        if not (a.source and a.board and a.field):
            raise SystemExit("radar-fields community --source dcinside --board <갤러리> --field security")
        conn = radar_db.open_write()
        with conn:
            conn.execute("INSERT OR REPLACE INTO community_fields VALUES (?,?,?)", (a.source, a.board, a.field))
        conn.close()
        _print(f"{a.source}/{a.board} → {a.field}")
    conn = radar_db.open_read()
    try:
        for r in conn.execute("SELECT f.id, f.name, f.definition_source, f.updated_at, COUNT(t.id) n FROM radar_fields f"
                              " LEFT JOIN topics t ON t.field_id = f.id GROUP BY f.id ORDER BY f.id"):
            _print(f"  {r['id']:<13} {r['name']:<8} 토픽 {r['n']:>4}  {r['updated_at'][:10]}  {r['definition_source']}")
        for r in conn.execute("SELECT * FROM community_fields"):
            _print(f"  커뮤니티 {r['source']}/{r['board']} → {r['field_id']}")
    finally:
        conn.close()


def cmd_radar_link(a):
    """리포트 1건 ↔ 분야 논문: 필요·능력·한계 추출 → 토픽·사건 매핑 → 간선 → 왜-지금 → 빈자리. LLM은 레이더 예산."""
    import json as _json
    from datetime import date as _date
    from . import db as _db
    from .embed import Embedder
    from .llm import LLM
    from .radar import link, radar_db, sources
    radar_db.init_radar_db()
    emb, llm, oa = Embedder(), LLM(a.db), sources.get("openalex_topics")
    pp = _db.open_read(a.db)
    try:
        doc, months = link.report_doc(pp, a.report)
    finally:
        pp.close()
    _print(f"필요 추출: {link.extract('need', [doc], llm, progress=_print)}")
    conn = radar_db.open_read()
    try:
        works = [r[0] for r in conn.execute(
            "SELECT s.id FROM signal_items s JOIN topics t ON t.id = json_extract(s.metrics_json, '$.topic_id')"
            " WHERE s.source='openalex' AND s.kind='work' AND s.injection_flag=0 AND t.field_id=?"
            " ORDER BY s.published_at DESC LIMIT ?", (a.field, a.limit))]
    finally:
        conn.close()
    docs = link.openalex_docs(oa, works)
    _print(f"{a.field} 논문 {len(works)}건 중 초록 있는 {len(docs)}건")
    for kind in ("capability", "limit"):
        _print(f"{kind} 추출: {link.extract(kind, docs, llm, progress=_print)}")
    conn = radar_db.open_read()
    try:
        needs = link.extracts(conn, "need", refs=[doc.ref])
        caps = link.extracts(conn, "capability", refs=[d.ref for d in docs])
        topics = link.topic_matrix(conn, emb)
        native = {c["item_ref"]: link.native_topic(conn, c["item_ref"]) for c in caps}
    finally:
        conn.close()
    for ref in sorted({c["item_ref"] for c in caps}):
        if native[ref]:                              # OpenAlex 논문은 원천 주 토픽을 쓴다(매핑 LLM 없음)
            continue
        text = " / ".join(f"{c['text']} ({c['search_en']})" for c in caps if c["item_ref"] == ref)
        _print(f"  토픽 {ref}: {link.map_topics(2, ref, text, embedder=emb, llm=llm, topics=topics)}")
    for n in needs:
        _print(f"필요 #{n['id']} {n['text']}")
        hits = link.map_incidents(n["id"], n["text"], embedder=emb, llm=llm)
        _print(f"  사건 범주: {hits or '없음'}")
    _print(f"간선: {link.build_edges([n['id'] for n in needs], embedder=emb, llm=llm, progress=_print)}")
    conn = radar_db.open_read()
    try:
        _print(f"  공식 사건 축: {_json.dumps(link.incident_axis(conn, [n['id'] for n in needs], _date.today()), ensure_ascii=False)[:300]}")
        edges = [dict(r) for r in conn.execute(
            "SELECT e.id, e.need_id, e.capability_id, n.text AS need, c.text AS cap FROM need_capability_edges e"
            " JOIN radar_extracts n ON n.id = e.need_id JOIN radar_extracts c ON c.id = e.capability_id"
            f" WHERE e.judgment='yes' AND e.need_id IN ({','.join('?' * len(needs)) or 'NULL'})",
            [n["id"] for n in needs])]
    finally:
        conn.close()
    supply = None if a.no_gap else link.default_supply(db_path=a.db, embedder=emb, oa_source=oa)
    for e in edges:
        _print(f"간선 #{e['id']}: {e['need']} ← {e['cap']}")
        w = link.why_now_for_edge(e["id"], pain_months=months, embedder=emb, llm=llm)
        _print(f"  왜-지금 {w.strength}: " + ", ".join(f"{k}={v['status']}" for k, v in w.conditions.items())
               + f" · 관심·준비도 {w.readiness}")
        if supply:
            conn = radar_db.open_read()
            try:
                need = dict(conn.execute("SELECT * FROM radar_extracts WHERE id=?", (e["need_id"],)).fetchone())
                cap = dict(conn.execute("SELECT * FROM radar_extracts WHERE id=?", (e["capability_id"],)).fetchone())
            finally:
                conn.close()
            g = link.gap_search(need, cap, sources=supply, embedder=emb)
            _print(f"  빈자리 {g.status} {g.gap_count if g.gap_count is not None else ''} "
                   + ", ".join(f"{k}:{v['status']}/{v['n_similar']}" for k, v in g.sources.items()))


def cmd_radar_sources(a):
    from .radar import radar_db, sources
    radar_db.init_radar_db()
    conn = radar_db.open_read()
    try:
        fresh = {r["source"]: dict(r) for r in conn.execute("SELECT * FROM source_freshness")}
    finally:
        conn.close()
    for name, c in sorted(sources.all_sources().items(), key=lambda kv: (kv[1].layer, kv[0])):
        f = fresh.get(name) or {}
        keys = ",".join(c.key_env) + ("(선택)" if c.key_optional else "") if c.key_env else "-"
        _print(f"  L{c.layer} {name:<18} {c.tier:<8} 키 {keys:<44} {f.get('status', '미실행'):<7} "
               f"최신 {f.get('latest_data_at') or '-'} 확인 {(f.get('checked_at') or '-')[:16]} {(f.get('error') or '')[:60]}")


def cmd_status(a):
    from . import db
    db.init_db(a.db)
    conn = db.open_read(a.db)
    try:
        _print(f"DB: {a.db}")
        _print("\n[코퍼스]")
        for r in conn.execute("SELECT source, board, COUNT(*) n, MIN(created_day) a, MAX(created_day) b FROM posts GROUP BY source, board ORDER BY n DESC"):
            _print(f"  {r['source']:<12} {r['board']:<28} {r['n']:>7}건  {r['a']} ~ {r['b']}")
        m = config.EMBED_MODEL
        ne = conn.execute("SELECT COUNT(*) FROM posts p LEFT JOIN post_embeddings e ON e.post_key=p.post_key AND e.model=? WHERE e.post_key IS NULL", (m,)).fetchone()[0]
        na = conn.execute("SELECT COUNT(*) FROM attempt_embeddings WHERE model=?", (m,)).fetchone()[0]
        _print(f"  임베딩 모델 {m}: 미계산 글 {ne}건 · 한이음 임베딩 {na}건")
        try:
            nx = conn.execute("SELECT COUNT(*) FROM extract_embeddings WHERE model=?", (m,)).fetchone()[0]
            _print(f"  추출 문장 임베딩 캐시 {nx}건")
        except Exception:  # noqa: BLE001
            pass
        for r in conn.execute("SELECT model, COUNT(*) n FROM post_embeddings WHERE model != ? GROUP BY model", (m,)):
            _print(f"  다른 모델 행: {r['model']} 글 {r['n']}건 (reembed 진행 중이면 정상)")
        _print("\n[상시 수집]")
        today = date.today()
        for w in conn.execute("SELECT source, board FROM watch_list WHERE enabled=1 ORDER BY id"):
            last = conn.execute("SELECT run_date, status, n_new, error FROM collection_runs WHERE source=? AND board=? ORDER BY run_date DESC, id DESC LIMIT 1", (w["source"], w["board"])).fetchone()
            ok = conn.execute("SELECT run_date FROM collection_runs WHERE source=? AND board=? AND status='ok' ORDER BY run_date DESC LIMIT 1", (w["source"], w["board"])).fetchone()
            stale = (today - date.fromisoformat(ok["run_date"])).days if ok else None
            flag = " ⚠ suspect" if last and last["status"] == "suspect" else (" ⚠ failed" if last and last["status"] == "failed" else "")
            _print(f"  {w['source']}/{w['board']}: 마지막 {last['run_date'] if last else '없음'} {last['status'] if last else ''} 신규 {last['n_new'] if last else 0} · 마지막 성공 {ok['run_date'] if ok else '없음'} ({'—' if stale is None else str(stale) + '일 전'}){flag}")
        cand = conn.execute("SELECT MAX(fetched_at) m, COUNT(*) n FROM source_candidates").fetchone()
        _print(f"  후보 목록 {cand['n']}건, 갱신 {cand['m'][:10] if cand['m'] else '없음'}")
        day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        n_today = conn.execute("SELECT COUNT(*) FROM llm_calls WHERE ts >= ?", (day,)).fetchone()[0]
        tok = conn.execute("SELECT COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0) FROM llm_calls WHERE ts >= ?", (day,)).fetchone()
        from .llm import cost_usd
        spent = sum(cost_usd(r[0], r[1] or 0, r[2] or 0) for r in conn.execute(
            "SELECT model, SUM(input_tokens), SUM(output_tokens) FROM llm_calls WHERE ts >= ? GROUP BY model", (day,)))
        _print(f"\n[LLM] 오늘 ${spent:.2f} / 예산 ${config.DAILY_BUDGET_USD:.2f} (PP_DAILY_BUDGET_USD)")
        _print(f"  오늘 {n_today}/{config.DAILY_LLM_LIMIT}회 ({n_today * 100 // max(1, config.DAILY_LLM_LIMIT)}%) · 입력 {tok[0]:,} / 출력 {tok[1]:,} 토큰 · 묶음 {config.CLASSIFY_BATCH}건/호출 · classify={config.MODEL_CLASSIFY or '(없음)'} coach={config.MODEL_COACH or '(없음)'}")
        _print("\n[최근 잡]")
        for r in conn.execute("SELECT id, status, stage, report_id, created_at, error FROM jobs ORDER BY created_at DESC LIMIT 5"):
            _print(f"  {r['id']} {r['status']:<8} {r['created_at']} {r['report_id'] or ''} {(r['error'] or '')[:60]}")
        _print("\n[최근 리포트]")
        for r in conn.execute("SELECT id, query_hash, created_at FROM reports ORDER BY created_at DESC LIMIT 5"):
            _print(f"  {r['id']} q={r['query_hash']} {r['created_at']}")
    finally:
        conn.close()


def main(argv=None):
    p = argparse.ArgumentParser(prog="painpointer")
    p.add_argument("--db", default=str(config.DB_PATH))
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("init").set_defaults(func=cmd_init)
    s = sub.add_parser("serve"); s.add_argument("--port", type=int); s.set_defaults(func=cmd_serve)
    w = sub.add_parser("watch"); w.add_argument("action", choices=["add", "rm", "list"]); w.add_argument("source", nargs="?"); w.add_argument("board", nargs="?"); w.add_argument("--label"); w.set_defaults(func=cmd_watch)
    c = sub.add_parser("collect"); c.add_argument("--source"); c.add_argument("--no-embed", action="store_true"); c.add_argument("--no-body", action="store_true"); c.add_argument("--no-extract", action="store_true"); c.add_argument("--delay", type=float, default=1.0); c.set_defaults(func=cmd_collect)
    sub.add_parser("embed-posts").set_defaults(func=cmd_embed_posts)
    pa = sub.add_parser("precompute-attempts"); pa.add_argument("--data-dir"); pa.set_defaults(func=cmd_precompute)
    re_ = sub.add_parser("reembed", help="임베딩 모델 교체: 새 모델로 글·한이음·추출 문장 벡터를 채운 뒤 옛 모델 행 삭제")
    re_.add_argument("--model", required=True); re_.add_argument("--data-dir"); re_.add_argument("--keep-old", action="store_true")
    re_.set_defaults(func=cmd_reembed)
    sub.add_parser("models").set_defaults(func=cmd_models)
    r = sub.add_parser("report"); r.add_argument("--pain", required=True); r.add_argument("--target", default="")
    r.add_argument("--term", action="append"); r.add_argument("--source", action="append"); r.add_argument("--out"); r.add_argument("--no-expand", action="store_true"); r.set_defaults(func=cmd_report)
    d = sub.add_parser("discover", help="페인 지도: 보드의 최근 글에서 반복 불편 찾기")
    d.add_argument("--board", action="append", required=True, help="source:board (여러 번)")
    d.add_argument("--target", default=""); d.add_argument("--days", type=int, default=config.DISCOVER_DAYS)
    d.add_argument("--out"); d.set_defaults(func=cmd_discover)
    sub.add_parser("status").set_defaults(func=cmd_status)
    rc = sub.add_parser("radar-collect", help="레이더 신호 원천 수집(기본: 질의가 필요 없는 피드 원천 전부)")
    rc.add_argument("--source", action="append", help="원천 이름(여러 번)"); rc.add_argument("--layer", type=int, action="append")
    rc.add_argument("--query", help="토픽 원천 질의 JSON"); rc.add_argument("--since", help="NVD 백필 시작일 YYYY-MM-DD")
    rc.add_argument("--field", help="레이더 분야 id: 그 분야 토픽마다 토픽 원천 실행"); rc.add_argument("--limit", type=int)
    rc.set_defaults(func=cmd_radar_collect)
    sub.add_parser("radar-sources", help="레이더 원천 목록·키·최신 시점").set_defaults(func=cmd_radar_sources)
    rf = sub.add_parser("radar-fields", help="레이더 분야 6개 정의(OpenAlex 토픽)·명망지·분야 커뮤니티")
    rf.add_argument("action", choices=["build", "show", "venues", "community"]); rf.add_argument("--no-l2", action="store_true")
    rf.add_argument("--source"); rf.add_argument("--board"); rf.add_argument("--field")
    rf.set_defaults(func=cmd_radar_fields)
    rl = sub.add_parser("radar-link", help="연결층: 리포트 ↔ 분야 논문 추출·매핑·간선·왜-지금·빈자리(LLM)")
    rl.add_argument("--report", required=True); rl.add_argument("--field", required=True)
    rl.add_argument("--limit", type=int, default=10); rl.add_argument("--no-gap", action="store_true")
    rl.set_defaults(func=cmd_radar_link)
    a = p.parse_args(argv)
    a.db = Path(a.db)
    a.func(a)


if __name__ == "__main__":
    main()
