import json
import threading
import time
from datetime import date

import pytest
from dccrawler.models import Post
from dccrawler.storage import Store

from painpointer import config, db
from painpointer.embed import HashEmbedder, embed_missing_posts, precompute_attempts
from painpointer.expand import expand_query, preview_hits
from painpointer.llm import LLM
from painpointer.pipeline import GenerateRequest, generate_report, load_report_html

from conftest import TODAY, FakeClient, expected_judgment, golden_posts

TERMS = ["배달 지연", "배달 늦음", "늦게 옴", "배달"]


def _req(**kw):
    base = dict(pain="배달이 늦게 온다", target="20대 자취생", terms=TERMS, generated_terms=TERMS[:3])
    base.update(kw)
    return GenerateRequest(**base)


def _expected_counts(posts):
    """가짜 LLM 규칙으로 독립 재계산: FTS 적중 여부는 '배달' 토큰 포함 = 검색어 '배달'과 동일."""
    hits = [p for p in posts if "배달" in p.body]
    rel = [p for p in hits if expected_judgment(p.body)[0]]
    pain = [p for p in rel if expected_judgment(p.body)[1] >= 2]
    return len(hits), len(rel), len(pain)


def test_golden_report_end_to_end(golden_db, fake_client):
    llm = LLM(golden_db, client=fake_client, sleep=lambda *_: None)
    precompute_attempts(golden_db, HashEmbedder(), [
        {"id": "a1", "title": "배달 지연 알림 서비스", "text": "배달 지연 늦음 알림", "year": 2024, "source": "hanium_award", "url": "u", "result": "대상"},
        {"id": "a2", "title": "주식 분석 도구", "text": "주식 차트 분석", "year": 2023, "source": "hanium_public", "url": "u", "result": None},
    ])
    report, html = generate_report(_req(), db_path=golden_db, llm=llm, embedder=HashEmbedder(), today=TODAY)
    m = report.metrics
    n_hit, n_rel, n_pain = _expected_counts(golden_posts())
    assert m.n_hit_total == n_hit and m.sampled is False and m.n_judged == n_hit
    assert m.n_relevant == n_rel and m.n_pain == n_pain and m.n_failed == 0
    assert m.pain_rate == pytest.approx(n_pain / n_rel)
    assert m.insufficient is False and m.months_present == 12 and m.months_covered == 12
    assert m.unique_authors_strong is not None and m.distinct_ip_bands_weak is not None
    # 월별 행은 소스별 분리, 합산 없음
    assert {row.source for row in m.monthly} == {"dcinside", "googleplay"}
    assert sum(r.relevant for r in m.monthly) == n_rel
    assert all(r.corpus_total >= r.hit >= r.judged >= r.relevant or r.judged == 0 for r in m.monthly)
    # 군집·인용·질문·유사 시도
    assert report.clusters and not any(c.name_failed for c in report.clusters)
    assert 1 <= len(report.quotes) <= 20 and report.quotes_pool_size >= len(report.quotes)
    assert all("***" in (q.author_masked or "***") for q in report.quotes)
    assert len(report.questions) == 5
    assert report.attempts and report.attempts["count"] >= 0 and report.attempts["n_pool"] == 2
    assert report.degraded == []
    assert [c.stage for c in report.llm_calls] == ["expand", "classify", "cluster_name", "coach"]
    # 저장·렌더
    assert load_report_html(golden_db, report.id) == html
    assert "noindex" in html and "@media print" in html and "forms.new" in html
    assert f"{m.n_pain}/{m.n_relevant}" in html.replace(",", "")
    assert "표본 기준" not in html.split("<h2>1.")[1].split("<h2>2.")[0]


def test_insufficient_gate_boundary_29_vs_30(tmp_db, fake_client):
    llm = LLM(tmp_db, client=fake_client, sleep=lambda *_: None)

    def build(n_rel):
        st = Store(tmp_db)
        st.conn.execute("DELETE FROM posts"); st.conn.commit()
        posts = []
        for i in range(n_rel):
            posts.append(Post(source="dcinside", board="g", post_id=str(i), title=f"글{i}", body=f"배달 지연돼서 음식이 식었음 (글 {i})",
                              author_id=f"u{i}", author_id_kind="strong", created_at=f"2026-{(i % 6) + 3:02d}-10 10:00:00"))
        st.upsert_posts(posts); st.close()
        embed_missing_posts(tmp_db, HashEmbedder())

    build(29)
    r29, h29 = generate_report(_req(), db_path=tmp_db, llm=llm, embedder=None, today=TODAY)
    assert r29.metrics.n_relevant == 29 and r29.metrics.insufficient is True
    assert "근거 부족" in h29 and "1. 핵심 수치" not in h29
    assert r29.metrics.pain_rate is not None          # 값은 계산해 보관
    assert len(r29.questions) == 5                    # 코칭은 그대로
    build(30)
    r30, h30 = generate_report(_req(), db_path=tmp_db, llm=llm, embedder=None, today=TODAY)
    assert r30.metrics.n_relevant == 30 and r30.metrics.insufficient is False
    assert "1. 핵심 수치" in h30


def test_insufficient_when_months_below_3(tmp_db, fake_client):
    llm = LLM(tmp_db, client=fake_client, sleep=lambda *_: None)
    st = Store(tmp_db)
    st.upsert_posts([Post(source="dcinside", board="g", post_id=str(i), title=f"글{i}", body=f"배달 늦음 최악 (글 {i})",
                          created_at=f"2026-0{(i % 2) + 7}-10 10:00:00") for i in range(40)])
    st.close()
    r, h = generate_report(_req(), db_path=tmp_db, llm=llm, embedder=None, today=TODAY)
    assert r.metrics.n_relevant == 40 and r.metrics.months_present == 2 and r.metrics.insufficient


def test_sampled_report_labels_and_seeded_sample(tmp_db, fake_client):
    llm = LLM(tmp_db, client=fake_client, sleep=lambda *_: None)
    st = Store(tmp_db); st.upsert_posts(golden_posts(2400)); st.close()
    r, h = generate_report(_req(), db_path=tmp_db, llm=llm, embedder=None, today=TODAY)
    assert r.metrics.sampled and r.metrics.n_judged == 800
    assert "표본 기준 최소값" in h
    assert r.metrics.n_cached == 0 and r.metrics.n_new == 800
    r2, _ = generate_report(_req(), db_path=tmp_db, llm=llm, embedder=None, today=TODAY)
    assert r2.metrics.n_cached == 800 and r2.metrics.n_new == 0   # 같은 시드 → 같은 표본 → 전부 캐시
    assert r2.diff and r2.diff["count_note"] and "표본" in r2.diff["count_note"]


def test_degrade_paths(golden_db):
    # 군집 이름: 없는 id → 강등 / 코칭·확장 실패 → 강등 / attempts 비어있음 → 미계산
    def fail_aux(req, n):
        keys = set(req["output_config"]["format"]["schema"]["properties"])
        return "questions" in keys
    c = FakeClient(bad_cluster_ids=True, fail_predicate=fail_aux)
    llm = LLM(golden_db, client=c, sleep=lambda *_: None)
    r, h = generate_report(_req(), db_path=golden_db, llm=llm, embedder=HashEmbedder(), today=TODAY)
    assert any("군집 이름 생성 실패" in d for d in r.degraded)
    assert all(c_.name_failed for c_ in r.clusters if c_.id != "c_other")
    assert r.questions == [] and any("인터뷰 질문 생성 실패" in d for d in r.degraded)
    assert r.attempts is None and any("유사 시도 미계산" in d for d in r.degraded)
    assert "이름 생성 실패" in h and "미계산" in h
    # 수치는 유지
    assert r.metrics.n_relevant > 0


def test_render_escapes_script_in_quote(tmp_db, fake_client):
    llm = LLM(tmp_db, client=fake_client, sleep=lambda *_: None)
    st = Store(tmp_db)
    st.upsert_posts([Post(source="dcinside", board="g", post_id=str(i), title="<b>t</b>",
                          body=f"<script>alert(1)</script> 배달 늦음 최악 (글 {i})", author=f"<img src=x onerror=alert(1)>",
                          created_at=f"2026-{(i % 6) + 3:02d}-10 10:00:00") for i in range(40)])
    st.close()
    r, h = generate_report(_req(), db_path=tmp_db, llm=llm, embedder=None, today=TODAY)
    assert r.quotes
    assert "<script>alert(1)</script>" not in h and "&lt;script&gt;" in h
    assert "onerror=" not in h.split("<footer>")[0].split("<h2>4.")[1]


def test_expand_fallback_and_preview(tmp_db, golden_db):
    def fail_expand(req, n):
        return "terms" in req["output_config"]["format"]["schema"]["properties"]
    c = FakeClient(fail_predicate=fail_expand)
    llm = LLM(golden_db, client=c, sleep=lambda *_: None)
    q = expand_query("배달이 늦게 온다", "20대", llm)
    assert q.expansion_status.startswith("failed(") and q.generated_terms == []
    assert q.terms == ["배달이 늦게 온다"]
    assert c.n_stage("terms") == 2           # 재시도 2회
    ok = expand_query("배달이 늦게 온다", "20대", LLM(golden_db, client=FakeClient(), sleep=lambda *_: None))
    assert ok.expansion_status == "ok" and "배달 지연" in ok.terms and ok.terms[0] == "배달이 늦게 온다"
    st = Store(golden_db, readonly=True)
    pv = preview_hits(st, ["배달", "!!!", "배달 늦음"], sources=None, since_day="2025-10-01")
    st.close()
    assert pv.empty_terms == ["!!!"] and pv.per_term[0][0] == "배달" and pv.n_dedup <= pv.n_raw_union
    r, h = generate_report(_req(expansion_status="failed(x)"), db_path=golden_db, llm=llm, embedder=None, today=TODAY)
    assert "자동 검색어 확장 실패" in h


def test_diff_between_two_reports_with_term_change(golden_db, fake_client):
    llm = LLM(golden_db, client=fake_client, sleep=lambda *_: None)
    r1, _ = generate_report(_req(), db_path=golden_db, llm=llm, embedder=None, today=TODAY)
    assert r1.diff is None
    r2, h2 = generate_report(_req(terms=TERMS + ["환불"]), db_path=golden_db, llm=llm, embedder=None, today=TODAY)
    assert r2.diff and r2.diff["prev_id"] == r1.id and r2.diff["terms_added"] == ["환불"]
    assert "검색어 변경됨" in h2


def test_concurrent_batch_write_during_report(golden_db, fake_client):
    """수집 배치 쓰기 중 리포트 생성 1개 동시 실행 — 둘 다 성공해야 한다."""
    llm = LLM(golden_db, client=fake_client, sleep=lambda *_: None)
    stop = threading.Event()
    errors: list[str] = []

    def writer():
        st = Store(golden_db)
        i = 0
        try:
            while not stop.is_set():
                st.upsert_posts([Post(source="natepann", board="t", post_id=f"w{i}", title="잡담", body=f"새 글 {i}", created_at="2026-09-20")])
                i += 1
        except Exception as e:  # noqa: BLE001
            errors.append(str(e))
        finally:
            st.close()

    t = threading.Thread(target=writer); t.start()
    try:
        r, _ = generate_report(_req(), db_path=golden_db, llm=llm, embedder=None, today=TODAY)
    finally:
        stop.set(); t.join(5)
    assert not errors and r.metrics.n_relevant > 0


def test_app_flow(golden_db, fake_client):
    from fastapi.testclient import TestClient
    from painpointer.app import create_app
    llm = LLM(golden_db, client=fake_client, sleep=lambda *_: None)
    app = create_app(golden_db, llm_factory=lambda: llm, embedder_factory=lambda: HashEmbedder())
    c = TestClient(app)
    assert c.get("/").status_code == 200
    r = c.post("/expand", data={"pain": "배달이 늦게 온다", "target": "20대"})
    assert r.status_code == 200 and "중복 제거 후" in r.text
    form = {"pain": "배달이 늦게 온다", "target": "20대", "terms": "\n".join(TERMS), "generated": "\n".join(TERMS[:3]),
            "expansion_status": "ok", "user_edited": "0"}
    r = c.post("/generate", data=form, follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"].startswith("/jobs/")
    jid = r.headers["location"].split("/jobs/")[1]
    # 같은 요청 동시 제출 → 합류(판정은 1회)
    r2 = c.post("/generate", data=form, follow_redirects=False)
    assert r2.headers["location"].split("?")[0] == f"/jobs/{jid}" or "joined=1" in r2.headers["location"]
    app.state.jobs.wait(jid, 30)
    for _ in range(50):
        st = c.get(f"/jobs/{jid}/status").json()
        if st["status"] in ("done", "failed"):
            break
        time.sleep(0.1)
    assert st["status"] == "done", st
    rep = c.get(f"/r/{st['report_id']}")
    assert rep.status_code == 200 and rep.headers["x-robots-tag"].startswith("noindex")
    assert c.get(f"/r/{st['report_id']}/download").headers["content-disposition"].startswith("attachment")
    assert c.get("/r/nope").status_code == 404
    n_hit = _expected_counts(golden_posts())[0]
    assert fake_client.n_stage("judgments") == n_hit   # 두 번 제출했지만 판정은 1회


def test_report_row_and_llm_calls_persisted(golden_db, fake_client):
    llm = LLM(golden_db, client=fake_client, sleep=lambda *_: None)
    r, _ = generate_report(_req(), db_path=golden_db, llm=llm, embedder=None, today=TODAY)
    conn = db.open_read(golden_db)
    row = conn.execute("SELECT * FROM reports WHERE id=?", (r.id,)).fetchone()
    n_llm = conn.execute("SELECT COUNT(*) FROM llm_calls").fetchone()[0]
    conn.close()
    assert row and json.loads(row["terms_json"]) == TERMS and row["since"] == "2025-10-01"
    assert json.loads(row["sources_json"]) == ["dcinside", "googleplay"]
    assert n_llm == len(fake_client.calls)
