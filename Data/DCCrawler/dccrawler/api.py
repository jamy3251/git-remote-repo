"""FastAPI 웹 플랫폼: 소스+페이지범위 입력 → 글 수집 + 페인포인트 분석 대시보드."""
from __future__ import annotations

from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel

from .service import crawl_and_analyze, cross_analyze
from .sources import list_sources

load_dotenv()

app = FastAPI(title="DCCrawler", description="커뮤니티 페인포인트 분석 크롤러")
_TEMPLATE = Path(__file__).resolve().parent.parent / "web" / "index.html"


class CrawlReq(BaseModel):
    source: str
    board: str
    start_page: int = 1
    end_page: int = 3
    fetch_body: bool = False
    delay: float = 0.8
    use_llm: bool = True


class Target(BaseModel):
    source: str
    board: str


class CrossReq(BaseModel):
    targets: list[Target]
    start_page: int = 1
    end_page: int = 2
    fetch_body: bool = False
    delay: float = 0.8
    use_llm: bool = True


@app.get("/", response_class=HTMLResponse)
def index() -> str:
    return _TEMPLATE.read_text(encoding="utf-8")


@app.get("/api/sources")
def sources() -> JSONResponse:
    return JSONResponse(list_sources())


@app.post("/api/crawl")
def crawl(req: CrawlReq) -> JSONResponse:
    try:
        out = crawl_and_analyze(
            req.source, req.board, req.start_page, req.end_page,
            fetch_body=req.fetch_body, delay=req.delay, use_llm=req.use_llm,
        )
        # 응답 경량화: 글 본문은 빼고 목록 메타만
        out["crawl"]["posts"] = [
            {"title": p["title"], "url": p["url"], "comment_count": p["comment_count"],
             "views": p["views"], "author": p["author"], "created_at": p["created_at"]}
            for p in out["crawl"]["posts"]
        ]
        return JSONResponse(out)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=400)


@app.post("/api/cross")
def cross(req: CrossReq) -> JSONResponse:
    try:
        targets = [(t.source, t.board) for t in req.targets]
        out = cross_analyze(
            targets, req.start_page, req.end_page,
            fetch_body=req.fetch_body, delay=req.delay, use_llm=req.use_llm,
        )
        # per_source 원자료(글 본문)는 응답에서 제외(경량화)
        out.pop("per_source", None)
        return JSONResponse(out)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=400)
