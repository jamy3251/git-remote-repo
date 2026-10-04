"""FastAPI 앱(127.0.0.1 전용). 입력 → 검색어 확인(8a 미리보기) → 잡 생성 → 3초 폴링 → 리포트.

/r/{id}는 X-Robots-Tag: noindex. 리포트 HTML 다운로드는 /r/{id}/download.
"""
from __future__ import annotations

import json
from pathlib import Path

from fastapi import FastAPI, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response

from dccrawler.sources import list_sources
from dccrawler.storage import Store

from . import config, db
from .aggregate import window_since
from .discover import DiscoverRequest, load_map_html
from .embed import Embedder
from .expand import clean_terms, expand_query, preview_hits
from .jobs import JobManager
from .llm import LLM
from .pipeline import GenerateRequest, load_report_html
from .render import render_page
from .textnorm import term_tokens


def create_app(db_path: str | Path | None = None, *, llm_factory=None, embedder_factory=None) -> FastAPI:
    db_path = Path(db_path or config.DB_PATH)
    db.init_db(db_path)
    if llm_factory is None:
        llm_factory = lambda: LLM(db_path)  # noqa: E731
    if embedder_factory is None:
        _emb = Embedder()
        embedder_factory = lambda: _emb  # noqa: E731
    jobs = JobManager(db_path, llm_factory=llm_factory, embedder_factory=embedder_factory)
    jobs.recover()
    app = FastAPI(title="PainPointer", docs_url=None, redoc_url=None)
    app.state.jobs = jobs
    app.state.db_path = db_path

    def _sources_in_db() -> list[dict]:
        st = Store(db_path, readonly=True)
        try:
            rows = st.conn.execute("SELECT source, board, COUNT(*) AS n, MAX(created_day) AS d FROM posts GROUP BY source, board ORDER BY n DESC").fetchall()
            return [dict(r) for r in rows]
        finally:
            st.close()

    @app.get("/", response_class=HTMLResponse)
    def index():
        return render_page("index.html", sources=_sources_in_db(), model_warnings=[
            w for w in (config.model_warning(config.MODEL_CLASSIFY), config.model_warning(config.MODEL_COACH)) if w])

    @app.post("/expand", response_class=HTMLResponse)
    def expand(pain: str = Form(...), target: str = Form(""), sources: list[str] = Form([])):
        pain = pain.strip()
        if not pain:
            raise HTTPException(400, "페인 문장이 비어 있습니다")
        try:
            config.require_models()
            llm = llm_factory()
        except Exception:  # noqa: BLE001
            llm = None
        q = expand_query(pain, target, llm)
        return _confirm_page(q.pain, q.target, q.terms, q.generated_terms, q.expansion_status, sources, user_edited=False)

    def _confirm_page(pain, target, terms, generated, status, sources, *, user_edited, error=None):
        from datetime import date
        st = Store(db_path, readonly=True)
        try:
            pv = preview_hits(st, terms, sources=sources or None, since_day=window_since(date.today()))
        finally:
            st.close()
        return render_page("confirm.html", pain=pain, target=target, terms=terms, generated=generated,
                           expansion_status=status, sources=sources, preview=pv, user_edited=user_edited,
                           error=error, all_sources=_sources_in_db())

    @app.post("/preview", response_class=HTMLResponse)
    def preview(pain: str = Form(...), target: str = Form(""), terms: str = Form(""), generated: str = Form(""),
                expansion_status: str = Form("ok"), sources: list[str] = Form([])):
        tlist = clean_terms([t for t in terms.splitlines() if t.strip()])
        empty = [t for t in terms.splitlines() if t.strip() and not term_tokens(t)]
        err = f"토큰이 없는 검색어는 쓸 수 없습니다: {', '.join(empty)}" if empty else None
        return _confirm_page(pain, target, tlist, [g for g in generated.split("\n") if g], expansion_status, sources,
                             user_edited=True, error=err)

    @app.post("/generate")
    def generate(pain: str = Form(...), target: str = Form(""), terms: str = Form(""), generated: str = Form(""),
                 expansion_status: str = Form("ok"), user_edited: str = Form("0"), sources: list[str] = Form([])):
        tlist = clean_terms([t for t in terms.splitlines() if t.strip()])
        if not tlist:
            raise HTTPException(400, "유효한 검색어가 없습니다(형태소 토큰 0개)")
        try:
            config.require_models()
        except config.ConfigError as e:
            raise HTTPException(400, str(e))
        req = GenerateRequest(pain=pain.strip(), target=target.strip(), terms=tlist, sources=list(sources),
                              generated_terms=[g for g in generated.split("\n") if g],
                              user_edited=user_edited == "1", expansion_status=expansion_status)
        jid, joined = jobs.submit(req)
        return RedirectResponse(f"/jobs/{jid}" + ("?joined=1" if joined else ""), status_code=303)

    @app.get("/jobs/{job_id}", response_class=HTMLResponse)
    def job_page(job_id: str, request: Request):
        st = jobs.status(job_id)
        if not st:
            raise HTTPException(404)
        if st["status"] == "done" and st.get("report_id"):
            kind = "m" if "boards" in json.loads(st.get("request_json") or "{}") else "r"
            return RedirectResponse(f"/{kind}/{st['report_id']}", status_code=303)
        return render_page("job.html", job=st, joined=request.query_params.get("joined") == "1")

    @app.get("/jobs/{job_id}/status")
    def job_status(job_id: str):
        st = jobs.status(job_id)
        if not st:
            raise HTTPException(404)
        return JSONResponse({k: st.get(k) for k in ("id", "status", "stage", "progress", "error", "report_id", "updated_at")})

    @app.get("/r/{report_id}", response_class=HTMLResponse)
    def report(report_id: str):
        html = load_report_html(db_path, report_id)
        if html is None:
            raise HTTPException(404)
        return HTMLResponse(html, headers={"X-Robots-Tag": "noindex, nofollow"})

    @app.get("/r/{report_id}/download")
    def report_download(report_id: str):
        html = load_report_html(db_path, report_id)
        if html is None:
            raise HTTPException(404)
        return Response(html, media_type="text/html; charset=utf-8",
                        headers={"Content-Disposition": f'attachment; filename="painpointer-{report_id}.html"',
                                 "X-Robots-Tag": "noindex, nofollow"})

    @app.post("/discover")
    def discover_submit(boards: list[str] = Form([]), target: str = Form(""), days: int = Form(config.DISCOVER_DAYS)):
        if not boards:
            raise HTTPException(400, "보드를 하나 이상 고르세요")
        try:
            config.require_models()
        except config.ConfigError as e:
            raise HTTPException(400, str(e))
        jid, joined = jobs.submit(DiscoverRequest(boards=list(boards), target=target.strip(), days=max(7, min(days, 365))))
        return RedirectResponse(f"/jobs/{jid}" + ("?joined=1" if joined else ""), status_code=303)

    @app.get("/m/{map_id}", response_class=HTMLResponse)
    def pain_map(map_id: str):
        html = load_map_html(db_path, map_id)
        if html is None:
            raise HTTPException(404)
        return HTMLResponse(html, headers={"X-Robots-Tag": "noindex, nofollow"})

    @app.get("/health")
    def health():
        return {"ok": True, "db": str(db_path), "sources": [s["name"] for s in list_sources()]}

    return app


app = None


def get_app() -> FastAPI:
    global app
    if app is None:
        app = create_app()
    return app
