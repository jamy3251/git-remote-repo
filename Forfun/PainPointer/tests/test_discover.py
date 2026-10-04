"""페인 지도: 보드 최근 글 → 불편 추출(캐시) → 문장 군집 → 순위(파이썬 수치) → 검증 연결."""
import json

import pytest

from painpointer import db
from painpointer.discover import DiscoverRequest, adjacent_pains, discover, parse_boards
from painpointer.embed import HashEmbedder
from painpointer.llm import DailyLimitExceeded, LLM
from painpointer.pipeline import GenerateRequest, generate_report

from conftest import TODAY, FakeClient, golden_posts

BOARDS = ["dcinside:g1", "googleplay:com.app"]


def _run(golden_db, client, **kw):
    llm = LLM(golden_db, client=client, sleep=lambda *_: None)
    req = DiscoverRequest(boards=BOARDS, target="20대 자취생", days=400)
    return discover(req, db_path=golden_db, llm=llm, embedder=HashEmbedder(), today=TODAY, **kw)


def test_pain_map_ranks_real_sentences_with_denominators(golden_db, fake_client):
    pm, html = _run(golden_db, fake_client)
    posts = golden_posts()
    late = sum(1 for p in posts if "늦" in p.body)
    delayed = sum(1 for p in posts if "지연" in p.body and "늦" not in p.body)
    assert pm.n_sample == len(posts)                       # 200건 전수
    assert pm.n_with_pain == late + delayed
    names = [it.pain for it in pm.items]
    assert names[0] == "배달이 늦게 온다" and "고객센터 연결이 안 된다" in names   # 이름 = 실제 추출 문장
    assert pm.items[0].n_posts == late                       # 건수는 파이썬 집계
    assert pm.n_grouped + pm.n_other == pm.n_with_pain
    assert "%" not in html.split("<h1>페인 지도</h1>")[1].split("<details>")[0]   # 지도 본문에 비율 없음
    assert all(q.text and q.text in html for it in pm.items for q in it.quotes)
    authors = [(q.author_masked, q.source) for q in pm.items[0].quotes]
    assert len(pm.items[0].quotes) <= 3
    assert 'action="http://127.0.0.1:8765/expand"' in html and "이 페인 검증하기" in html
    conn = db.open_read(golden_db)
    try:
        assert conn.execute("SELECT COUNT(*) FROM pain_maps").fetchone()[0] == 1
    finally:
        conn.close()


def test_extracts_are_cached_per_post(golden_db, fake_client):
    _run(golden_db, fake_client)
    n = len(fake_client.calls)
    pm2, _ = _run(golden_db, fake_client)
    assert len(fake_client.calls) == n and pm2.n_calls == 0


def test_fabricated_quotes_dropped_but_pain_kept(golden_db):
    pm, _ = _run(golden_db, FakeClient(fabricate=True))
    assert pm.items and all(not it.quotes for it in pm.items)


def test_budget_blocks_pain_map_before_any_call(golden_db, fake_client):
    llm = LLM(golden_db, client=fake_client, budget_usd=0.00001, sleep=lambda *_: None)
    with pytest.raises(DailyLimitExceeded):
        discover(DiscoverRequest(boards=BOARDS, days=400), db_path=golden_db, llm=llm,
                 embedder=HashEmbedder(), today=TODAY)
    assert fake_client.calls == []


def test_parse_boards_requires_source_board():
    assert parse_boards(["dcinside:modu"]) == [("dcinside", "modu")]
    with pytest.raises(ValueError):
        parse_boards(["modu"])


def test_insufficient_report_points_to_map_pains(golden_db, fake_client):
    _run(golden_db, fake_client)
    llm = LLM(golden_db, client=fake_client, sleep=lambda *_: None)
    report, html = generate_report(
        GenerateRequest(pain="음식이 식어서 온다", target="20대", terms=["카메라 렌즈"]),
        db_path=golden_db, llm=llm, embedder=HashEmbedder(), today=TODAY)
    assert report.metrics.insufficient
    assert report.adjacent and report.adjacent["pains"][0] == "배달이 늦게 온다"
    assert "다른 가설 후보" in html
    block = html.split("다른 가설 후보")[1].split("</div>")[0]
    assert "건" not in block.replace("검증", "") and "%" not in block   # 지도 수치가 리포트에 섞이지 않음


def test_adjacent_skips_same_pain_and_stale_maps(golden_db, fake_client):
    _run(golden_db, fake_client)
    conn = db.open_read(golden_db)
    try:
        adj = adjacent_pains(conn, ["dcinside"], exclude_pain="배달이 늦게 온다", today=TODAY)
        assert adj and "배달이 늦게 온다" not in adj["pains"]
        from datetime import timedelta
        assert adjacent_pains(conn, ["dcinside"], today=TODAY + timedelta(days=400)) is None
        assert adjacent_pains(conn, ["fmkorea"], today=TODAY) is None
    finally:
        conn.close()


def test_web_discover_job_redirects_to_map(golden_db, fake_client):
    from fastapi.testclient import TestClient
    from painpointer.app import create_app
    llm = LLM(golden_db, client=fake_client, sleep=lambda *_: None)
    app = create_app(golden_db, llm_factory=lambda: llm, embedder_factory=lambda: HashEmbedder())
    c = TestClient(app)
    assert "페인 지도 만들기" in c.get("/").text
    r = c.post("/discover", data={"boards": BOARDS, "target": "20대", "days": "400"}, follow_redirects=False)
    assert r.status_code == 303
    jid = r.headers["location"].split("/jobs/")[1].split("?")[0]
    app.state.jobs.wait(jid, timeout=60)
    r2 = c.get(f"/jobs/{jid}", follow_redirects=False)
    assert r2.status_code == 303 and r2.headers["location"].startswith("/m/")
    page = c.get(r2.headers["location"])
    assert page.status_code == 200 and "페인 지도" in page.text
    assert c.post("/discover", data={"target": "x"}).status_code == 400
