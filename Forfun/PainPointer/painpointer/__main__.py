"""PainPointer CLI.

  python -m painpointer init                      # DB 생성/마이그레이션
  python -m painpointer serve                     # 127.0.0.1:8765
  python -m painpointer watch add dcinside <갤러리ID> [--label ...]
  python -m painpointer watch add googleplay <패키지ID>
  python -m painpointer watch list | rm <source> <board>
  python -m painpointer collect [--source dcinside|dcinside:board] [--no-embed] [--no-body]
  python -m painpointer embed-posts               # 임베딩 미계산 글 배치
  python -m painpointer precompute-attempts       # 한이음 임베딩 사전 계산
  python -m painpointer models                    # /v1/models 목록(스냅샷 ID 확인)
  python -m painpointer report --pain "..." --target "..." [--term ...] [--source ...] [--out r.html] [--no-expand]
  python -m painpointer status
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
    p = db.init_db(a.db)
    _print(f"DB 준비됨: {p}")


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
    c = Collector(a.db, embedder=None if a.no_embed else Embedder(), fetch_body=not a.no_body, delay=a.delay)
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


def cmd_status(a):
    from . import db
    db.init_db(a.db)
    conn = db.open_read(a.db)
    try:
        _print(f"DB: {a.db}")
        _print("\n[코퍼스]")
        for r in conn.execute("SELECT source, board, COUNT(*) n, MIN(created_day) a, MAX(created_day) b FROM posts GROUP BY source, board ORDER BY n DESC"):
            _print(f"  {r['source']:<12} {r['board']:<28} {r['n']:>7}건  {r['a']} ~ {r['b']}")
        ne = conn.execute("SELECT COUNT(*) FROM posts p LEFT JOIN post_embeddings e ON e.post_key=p.post_key WHERE e.post_key IS NULL").fetchone()[0]
        na = conn.execute("SELECT COUNT(*) FROM attempt_embeddings").fetchone()[0]
        _print(f"  임베딩 미계산 글 {ne}건 · 한이음 임베딩 {na}건")
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
    c = sub.add_parser("collect"); c.add_argument("--source"); c.add_argument("--no-embed", action="store_true"); c.add_argument("--no-body", action="store_true"); c.add_argument("--delay", type=float, default=1.0); c.set_defaults(func=cmd_collect)
    sub.add_parser("embed-posts").set_defaults(func=cmd_embed_posts)
    pa = sub.add_parser("precompute-attempts"); pa.add_argument("--data-dir"); pa.set_defaults(func=cmd_precompute)
    sub.add_parser("models").set_defaults(func=cmd_models)
    r = sub.add_parser("report"); r.add_argument("--pain", required=True); r.add_argument("--target", default="")
    r.add_argument("--term", action="append"); r.add_argument("--source", action="append"); r.add_argument("--out"); r.add_argument("--no-expand", action="store_true"); r.set_defaults(func=cmd_report)
    d = sub.add_parser("discover", help="페인 지도: 보드의 최근 글에서 반복 불편 찾기")
    d.add_argument("--board", action="append", required=True, help="source:board (여러 번)")
    d.add_argument("--target", default=""); d.add_argument("--days", type=int, default=config.DISCOVER_DAYS)
    d.add_argument("--out"); d.set_defaults(func=cmd_discover)
    sub.add_parser("status").set_defaults(func=cmd_status)
    a = p.parse_args(argv)
    a.db = Path(a.db)
    a.func(a)


if __name__ == "__main__":
    main()
