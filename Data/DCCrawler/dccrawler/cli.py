"""DCCrawler CLI.

예시:
  python -m dccrawler crawl dcinside joonjangbee --from 1 --to 5
  python -m dccrawler crawl reddit Construction --from 1 --to 2 --no-llm
  python -m dccrawler sources
  python -m dccrawler serve
  python -m dccrawler migrate --db ../../Forfun/PainPointer/data/painpointer.db
"""
from __future__ import annotations

import argparse
import json
import sys

from dotenv import load_dotenv

from .service import crawl_and_analyze, cross_analyze
from .sources import list_sources
from .storage import DEFAULT_DB, migrate

load_dotenv()


def _print(s: str) -> None:
    sys.stdout.buffer.write((s + "\n").encode("utf-8", "replace"))
    sys.stdout.flush()


def cmd_sources(_args) -> None:
    for s in list_sources():
        flag = "🔑 키 필요" if s.get("needs_auth") else "✅ 동작"
        _print(f"  {s['name']:<12} {flag}  (board 필요: {s['needs_board']})")


def cmd_crawl(args) -> None:
    out = crawl_and_analyze(
        args.source, args.board, args.from_page, args.to_page,
        fetch_body=args.body, delay=args.delay, use_llm=not args.no_llm,
        progress=_print, db_path=args.db,
    )
    kw = out["analysis"]["keywords"]
    llm = out["analysis"]["llm"]

    _print(f"\n{'='*60}\n수집 {kw['post_count']}건  |  소스 {args.source}/{args.board}\n{'='*60}")
    _print("\n[상위 키워드]")
    _print("  " + ", ".join(f"{k['word']}({k['count']})" for k in kw["top_keywords"][:20]))

    pain = kw["pain"]
    _print(f"\n[페인 시그널] 글 중 {pain['post_count']}건({pain['ratio']*100:.0f}%)에서 문제 신호 감지")
    for c in pain["by_category"]:
        _print(f"  - {c['category']}: {c['count']}건")
    _print("\n[화제 페인 글 TOP]")
    for ex in pain["examples"][:8]:
        _print(f"  · ({'/'.join(ex['categories'])}) {ex['title']}  [댓글 {ex['comment_count']}]")

    if llm.get("available"):
        _print(f"\n[LLM 분석 — {llm.get('model','')}]\n  요약: {llm.get('summary','')}")
        bp = llm.get("biggest_problem", {})
        if bp:
            _print(f"\n  ★ 지금 가장 큰 문제: {bp.get('title','')}")
            _print(f"     이유: {bp.get('why','')}")
            _print(f"     기회: {bp.get('opportunity','')}")
        _print("\n  [페인포인트]")
        for pp in llm.get("pain_points", []):
            _print(f"   - [{pp.get('severity','?')}/5, {pp.get('frequency','')}] {pp.get('title','')}: {pp.get('description','')}")
        _print("\n  [아이디어 기회]")
        for idea in llm.get("idea_opportunities", []):
            _print(f"   ▸ {idea.get('idea','')} — {idea.get('rationale','')}")
    else:
        _print(f"\n[LLM 분석 미사용] {llm.get('reason','')}")

    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False, indent=2)
        _print(f"\nJSON 저장: {args.json}")


def cmd_cross(args) -> None:
    targets = []
    for t in args.targets:
        if ":" not in t:
            _print(f"⚠ 무시: '{t}' (형식은 source:board, 예 dcinside:joonjangbee)")
            continue
        s, b = t.split(":", 1)
        targets.append((s.strip(), b.strip()))
    if not targets:
        _print("교차 분석할 대상이 없습니다. 예: dccrawler cross dcinside:joonjangbee fmkorea:best")
        return
    out = cross_analyze(targets, args.from_page, args.to_page,
                        fetch_body=args.body, delay=args.delay,
                        use_llm=not args.no_llm, progress=_print, db_path=args.db)
    if out.get("error"):
        _print(f"❌ {out['error']}")
        return

    _print(f"\n{'='*64}\n교차 분석 · {len(out['targets'])}개 소스 · 총 {out['total_posts']}건\n{'='*64}")
    for t in out["targets"]:
        _print(f"  {t['key']:<28} {t['count']:>4}건  페인 {int(t['pain_ratio']*100):>3}%")

    _print("\n[🔗 공통 키워드 — 여러 소스에 동시 등장]")
    for s in out["shared_keywords"][:18]:
        dist = " ".join(f"{k.split('/')[0]}:{v}" for k, v in s["sources"].items())
        _print(f"  {s['word']:<12} ({s['source_count']}소스, 합 {s['total']})  [{dist}]")
    if not out["shared_keywords"]:
        _print("  (공통 키워드 없음 — 언어/주제가 다른 소스들일 수 있음. 아래 페인 매트릭스로 비교)")

    _print("\n[🔥 페인 카테고리 매트릭스]")
    keys = out["keys"]
    _print("  " + " " * 14 + "  ".join(k.split('/')[0][:8].rjust(8) for k in keys))
    for row in out["pain_matrix"]:
        cells = "  ".join(str(row["by_source"].get(k, 0)).rjust(8) for k in keys)
        _print(f"  {row['category']:<12}{cells}")

    _print("\n[🧭 소스별 고유 키워드]")
    for k, words in out["unique_keywords"].items():
        top = ", ".join(w["word"] for w in words[:8])
        _print(f"  {k}: {top}")

    llm = out["llm"]
    if llm.get("available"):
        _print(f"\n[🤖 LLM 교차 종합 — {llm.get('model','')}]\n  {llm.get('summary','')}")
        sd = llm.get("strongest_demand", {})
        if sd:
            _print(f"\n  ★ 가장 강한 수요: {sd.get('title','')}")
            _print(f"     교차검증: {sd.get('cross_validation','')}")
            _print(f"     기회: {sd.get('opportunity','')}")
        _print("\n  [공통 페인 (교차검증)]")
        for sp in llm.get("shared_pains", []):
            _print(f"   - {sp.get('pain','')}  ←{', '.join(sp.get('sources',[]))}")
            _print(f"       {sp.get('why_strong','')}")
        _print("\n  [커뮤니티별 차이]")
        for dv in llm.get("divergences", []):
            _print(f"   · {dv.get('source','')}: {dv.get('unique_focus','')}")
    else:
        _print(f"\n[LLM 교차 종합 미사용] {llm.get('reason','')}")

    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False, indent=2)
        _print(f"\nJSON 저장: {args.json}")


def cmd_migrate(args) -> None:
    info = migrate(args.db, log=_print)
    _print(f"schema: {info['from'] or '없음'} → v{info['to']} (변경: {info['changed']})")


def cmd_serve(args) -> None:
    import uvicorn
    uvicorn.run("dccrawler.api:app", host=args.host, port=args.port, reload=args.reload)


def main(argv=None) -> None:
    p = argparse.ArgumentParser(prog="dccrawler", description="커뮤니티 페인포인트 분석 크롤러")
    p.add_argument("--db", default=DEFAULT_DB, help="SQLite 경로(기본: data/dccrawler.db)")
    sub = p.add_subparsers(dest="cmd", required=True)

    c = sub.add_parser("crawl", help="크롤링 + 분석")
    c.add_argument("source", help="소스명 (dcinside, reddit, fourchan, youtube ...)")
    c.add_argument("board", help="갤러리ID/서브레딧/보드/영상ID")
    c.add_argument("--from", dest="from_page", type=int, default=1)
    c.add_argument("--to", dest="to_page", type=int, default=3)
    c.add_argument("--body", action="store_true", help="본문까지 수집(느림)")
    c.add_argument("--delay", type=float, default=1.0, help="요청 간 지연(초)")
    c.add_argument("--no-llm", action="store_true", help="LLM 분석 생략")
    c.add_argument("--json", help="결과 JSON 저장 경로")
    c.set_defaults(func=cmd_crawl)

    cr = sub.add_parser("cross", help="멀티소스 교차 분석")
    cr.add_argument("targets", nargs="+", help="source:board 목록 (예: dcinside:joonjangbee fmkorea:best)")
    cr.add_argument("--from", dest="from_page", type=int, default=1)
    cr.add_argument("--to", dest="to_page", type=int, default=2)
    cr.add_argument("--body", action="store_true")
    cr.add_argument("--delay", type=float, default=1.0)
    cr.add_argument("--no-llm", action="store_true")
    cr.add_argument("--json", help="결과 JSON 저장 경로")
    cr.set_defaults(func=cmd_cross)

    s = sub.add_parser("sources", help="소스 목록")
    s.set_defaults(func=cmd_sources)

    mg = sub.add_parser("migrate", help="스키마 마이그레이션(멱등, 자동 백업)")
    mg.set_defaults(func=cmd_migrate)

    sv = sub.add_parser("serve", help="웹 플랫폼 실행")
    sv.add_argument("--host", default="127.0.0.1")
    sv.add_argument("--port", type=int, default=8000)
    sv.add_argument("--reload", action="store_true")
    sv.set_defaults(func=cmd_serve)

    args = p.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
