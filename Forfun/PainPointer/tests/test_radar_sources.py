"""레이더 신호 원천(T7): 고정 응답 파일로 원천별 행 변환 · denom_kind · 실패 기록.

고정 응답은 2026-10-09 실제 응답을 잘라 만들었다(GDELT·arXiv·네이버·AIID는 문서 형식으로 손으로 작성 —
GDELT 429·arXiv 503·네이버 키 없음·AIID API 도메인 제한으로 실응답을 받지 못함).
"""
import json
from datetime import date
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import httpx
import pytest

from painpointer import db
from painpointer.radar import radar_db, sources
from painpointer.radar.sources import SeriesPoint, run_source

FX = Path(__file__).parent / "fixtures" / "radar"
TODAY = date(2026, 10, 9)


def fx(name: str):
    p = FX / name
    return json.loads(p.read_text(encoding="utf-8")) if p.suffix == ".json" else p.read_bytes()


def client(handler) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


def make(name, handler=None, env=None, today=TODAY):
    return sources.get(name, http=client(handler or (lambda r: httpx.Response(404))), today=today,
                       sleep=lambda *_: None, env=env or {})


def q(request) -> dict:
    return {k: v[0] for k, v in parse_qs(urlparse(str(request.url)).query, keep_blank_values=True).items()}


def rows(sql, args=()):
    conn = radar_db.open_read()
    try:
        return [dict(r) for r in conn.execute(sql, args)]
    finally:
        conn.close()


def runs(tmp_db):
    conn = db.open_read(tmp_db)
    try:
        return [dict(r) for r in conn.execute("SELECT source, board, run_date, status, error, n_new FROM collection_runs")]
    finally:
        conn.close()


def series(topic_prefix):
    return rows("SELECT * FROM topic_series WHERE topic_id LIKE ? ORDER BY topic_id, metric, period", (topic_prefix + "%",))


@pytest.fixture
def run(tmp_db):
    def _run(src, query=None, **kw):
        return run_source(src, query, db_path=tmp_db, webhook=kw.pop("webhook", lambda *a: None), **kw)
    return _run


# ---- 등록부 ----
def test_registry_has_every_layer_and_valid_tiers():
    allsrc = sources.all_sources()
    assert {c.layer for c in allsrc.values()} == {1, 2, 3, 4, 5}
    assert all(c.tier in ("core", "optional") for c in allsrc.values())
    assert allsrc["magazine_rss"].tier == "optional" and allsrc["cisa_kev"].tier == "core"
    with pytest.raises(ValueError):
        SeriesPoint("t", 2, "m", "2026-09", 3, None, "total")       # 전체 대비인데 분모 없음


# ---- L1 ----
def test_kev_rows_and_category_share_series(run, tmp_db):
    r = run(make("cisa_kev", lambda req: httpx.Response(200, json=fx("kev.json"))))
    assert r["status"] == "ok" and r["n_items"] == r["n_new"] == 8
    item = rows("SELECT * FROM signal_items WHERE source='cisa_kev' ORDER BY published_at DESC LIMIT 1")[0]
    assert item["id"].startswith("cisa_kev:CVE-") and item["kind"] == "incident" and item["layer"] == 1
    assert json.loads(item["metrics_json"])["categories"]
    tot = {s["period"]: s for s in series("kev:*")}
    assert sum(s["value"] for s in tot.values()) == 8
    assert all(s["denom_kind"] == "total" and s["denom"] == s["value"] for s in tot.values())
    cat = [s for s in series("kev:CWE-") if s["topic_id"] != "kev:*"]
    assert cat and all(s["denom"] == tot[s["period"]]["value"] and s["value"] <= s["denom"] for s in cat)
    assert rows("SELECT status, latest_data_at FROM source_freshness WHERE source='cisa_kev'")[0] == \
        {"status": "ok", "latest_data_at": "2026-10-08"}
    assert runs(tmp_db)[0]["source"] == "radar:cisa_kev" and runs(tmp_db)[0]["status"] == "ok"
    again = run(make("cisa_kev", lambda req: httpx.Response(200, json=fx("kev.json"))))
    assert again["n_new"] == 0 and sum(s["value"] for s in series("kev:*")) == 8   # 다시 받아도 이중 계상 없음


def test_nvd_paginates_prefers_primary_cwe_and_skips_rejected(run):
    page = fx("nvd_page1.json")
    v0 = page["vulnerabilities"][0]["cve"]
    v0["weaknesses"].append({"source": "nvd@nist.gov", "type": "Primary", "description": [{"lang": "en", "value": "CWE-22"}]})
    rejected = json.loads(json.dumps(page["vulnerabilities"][1]))
    rejected["cve"].update(id="CVE-2026-0000", vulnStatus="Rejected")
    calls = []

    def handler(req):
        p = q(req)
        calls.append(p)
        assert p["pubStartDate"].startswith("2026-10-06") and p["pubEndDate"].startswith("2026-10-09")
        if p["startIndex"] == "0":
            return httpx.Response(200, json={**page, "totalResults": 3, "resultsPerPage": 2})
        return httpx.Response(200, json={**page, "vulnerabilities": [rejected], "totalResults": 3,
                                         "startIndex": 2, "resultsPerPage": 1})
    r = run(make("nvd", handler))
    assert r["status"] == "ok" and r["label"] == "daily" and len(calls) == 2 and r["n_items"] == 2
    got = {x["id"]: json.loads(x["metrics_json"]) for x in rows("SELECT id, metrics_json FROM signal_items WHERE source='nvd'")}
    assert got[f"nvd:{v0['id']}"]["categories"] == ["CWE-22"]           # Primary 우선
    assert "nvd:CVE-2026-0000" not in got
    assert all(s["denom_kind"] == "total" for s in series("nvd:"))


def test_nvd_backfill_splits_into_120_day_windows(run):
    seen = []

    def handler(req):
        seen.append((q(req)["pubStartDate"][:10], q(req)["pubEndDate"][:10]))
        return httpx.Response(200, json={"resultsPerPage": 0, "startIndex": 0, "totalResults": 0, "vulnerabilities": []})
    r = run(make("nvd", handler), {"since": "2026-01-01", "until": "2026-09-30"})
    assert r["label"] == "backfill" and seen == [("2026-01-01", "2026-04-30"), ("2026-05-01", "2026-08-28"),
                                                 ("2026-08-29", "2026-09-30")]


def test_aiid_without_snapshot_is_no_key_not_failure(run, tmp_db, tmp_path):
    r = run(make("aiid"))
    assert r["status"] == "no_key" and "PP_AIID_SNAPSHOT" in r["error"]
    assert rows("SELECT status FROM source_freshness WHERE source='aiid'")[0]["status"] == "no_key"
    assert runs(tmp_db) == []                                         # 실패로 세지 않는다(웹훅 없음)
    r2 = run(make("aiid", env={"PP_AIID_SNAPSHOT": str(FX / "aiid_incidents.csv")}))
    assert r2["status"] == "ok" and r2["n_items"] == 3
    assert {s["period"]: s["value"] for s in series("aiid:*")} == {"2026-08": 1, "2026-09": 2}


# ---- L2 ----
def _openalex(injected=False):
    works = fx("openalex_works.json")
    if injected:
        works["results"][1]["abstract_inverted_index"] = {"Ignore": [0], "all": [1], "previous": [2], "instructions": [3]}

    def handler(req):
        p = q(req)
        path = urlparse(str(req.url)).path
        if path == "/works" and "sort" in p:
            return httpx.Response(200, json=works)
        if path == "/works":
            f = p["filter"]
            assert f.endswith(",primary_location.source.type:journal|conference")   # 학술지·학회만 센다
            cur = "2025-10-01" in f
            if "primary_location.source.id" in f:
                n = 30 if cur else 10
            elif "primary_topic.id" in f:
                n = 300 if cur else 200
            else:
                n = 10000 if cur else 8000
            return httpx.Response(200, json={"meta": {"count": n}, "results": []})
        return httpx.Response(404)
    return handler


def test_openalex_share_series_prestige_and_top_works(run):
    r = run(make("openalex", _openalex()), {"topic_id": "https://openalex.org/T10028", "venues": ["S1", "S2"], "top": 2})
    assert r["status"] == "ok" and r["label"] == "https://openalex.org/T10028"
    got = {(s["metric"], s["period"]): (s["value"], s["denom"], s["denom_kind"]) for s in series("T10028")}
    assert got[("works_12m", "2026-09")] == (300, 10000, "total")
    assert got[("works_12m", "2025-09")] == (200, 8000, "total")
    assert got[("prestige_works_12m", "2026-09")] == (30, 300, "total")
    items = rows("SELECT * FROM signal_items WHERE source='openalex'")
    assert len(items) == 2 and all(i["content_hash"] and i["kind"] == "work" for i in items)
    assert all(i["injection_flag"] == 0 for i in items)


def test_openalex_injected_abstract_is_flagged(run):
    run(make("openalex", _openalex(injected=True)), {"topic_id": "T10028", "top": 2})
    flags = sorted(i["injection_flag"] for i in rows("SELECT injection_flag FROM signal_items WHERE source='openalex'"))
    assert flags == [0, 1]


def test_openalex_key_is_sent_when_present(run):
    seen = []

    def handler(req):
        seen.append(q(req).get("api_key"))
        return _openalex()(req)
    run(make("openalex", handler, env={"PP_OPENALEX_KEY": "k"}), {"topic_id": "T10028", "top": 0})
    assert seen and set(seen) == {"k"}


def test_openalex_topics_and_venues(run):
    r = run(make("openalex_topics", lambda req: httpx.Response(200, json=fx("openalex_topics.json"))), {"subfield": "1702"})
    assert r["status"] == "ok"
    want = {t["id"].rsplit("/", 1)[-1] for t in fx("openalex_topics.json")["results"]}
    assert {t["id"] for t in rows("SELECT id FROM topics")} == want and "T10126" in want

    conn = radar_db.open_write()
    with conn:
        conn.execute("INSERT INTO radar_fields(id, name, updated_at) VALUES ('ai', 'AI', 'now')")
    conn.close()
    group = fx("openalex_group_sources.json")
    group["group_by"] += [{"key": "https://openalex.org/S4210191458", "count": 900},
                          {"key": "https://openalex.org/S199944782", "count": 800}]

    def handler(req):
        if urlparse(str(req.url)).path == "/works":
            return httpx.Response(200, json=group)
        return httpx.Response(200, json=fx("openalex_sources.json"))
    r = run(make("openalex_venues", handler), {"radar_field_id": "ai", "filter": "primary_topic.subfield.id:1702"})
    assert r["status"] == "ok"
    v = rows("SELECT * FROM prestige_venues")
    assert len(v) == 1 and v[0]["tier"] == "openalex_top25" and "2yr_mean_citedness" in v[0]["basis"]


def test_semantic_scholar_velocity_is_sample_mean_without_total_denominator(run):
    r = run(make("semantic_scholar", lambda req: httpx.Response(200, json=fx("s2_bulk.json"))),
            {"topic_id": "T10028", "terms": "digital twin"})
    s = series("T10028")[0]
    assert r["status"] == "ok" and s["metric"] == "citation_velocity" and s["denom_kind"] == "none"
    assert s["denom"] == len([p for p in fx("s2_bulk.json")["data"] if p.get("publicationDate")]) and s["value"] >= 0


def test_arxiv_counts_against_denominator(run):
    tmpl = fx("arxiv_total.xml").decode()

    def handler(req):
        sq = q(req)["search_query"]
        n = (40 if "202510" in sq else 25) if "digital" in sq else (4000 if "202510" in sq else 3000)
        return httpx.Response(200, text=tmpl.replace("{n}", str(n)))
    run(make("arxiv", handler), {"topic_id": "T1", "search": 'all:"digital twin"', "denom_search": "cat:cs.AI"})
    got = {s["period"]: (s["value"], s["denom"], s["denom_kind"]) for s in series("T1")}
    assert got == {"2026-09": (40, 4000, "total"), "2025-09": (25, 3000, "total")}


# ---- L3 ----
def test_gdelt_monthly_share_drops_partial_months(run):
    seen = []

    def handler(req):
        seen.append(q(req))
        return httpx.Response(200, json=fx("gdelt_timelinevolraw.json"))
    run(make("gdelt", handler), {"topic_id": "T1", "query": '"digital twin"'})
    assert seen[0]["mode"] == "timelinevolraw"
    got = {s["period"]: s for s in series("T1")}
    assert "2025-10" not in got and "2026-10" not in got             # 덜 찬 첫 달·이번 달 제외
    assert got["2026-09"]["value"] == 60 and got["2026-09"]["denom"] == 3_000_000
    assert got["2026-07"]["value"] == 31 and all(s["denom_kind"] == "total" for s in got.values())


def test_hackernews_counts_share_denominator_and_items(run):
    calls = []

    def handler(req):
        p = q(req)
        calls.append(p.get("query"))
        if "search_by_date" in str(req.url):
            assert p["numericFilters"].endswith(",points>=2")            # 0~1점 스팸 급증 제외
        if urlparse(str(req.url)).path.endswith("/search"):
            return httpx.Response(200, json=fx("hn_search.json"))
        return httpx.Response(200, json={"nbHits": 900 if p["query"] == "" else 9, "hits": []})
    sources.REGISTRY["hackernews"]._denom_cache.clear()
    run(make("hackernews", handler), {"topic_id": "T1", "query": "digital twin", "top": 2})
    run(make("hackernews", handler), {"topic_id": "T2", "query": "edge ai", "top": 0})
    assert calls.count("") == 24                                      # 분모는 달마다 한 번(두 토픽이 공유)
    assert calls.count("digital twin") == 24 + 1                      # 달별 24회 + 상위 스토리 1회
    assert {(s["topic_id"], s["value"], s["denom"]) for s in series("T")} == {("T1", 108, 10800), ("T2", 108, 10800)}
    assert len(rows("SELECT * FROM signal_items WHERE source='hackernews'")) == 2


def test_naver_needs_both_keys_and_has_no_denominator(run, tmp_db):
    assert run(make("naver_news"), {"topic_id": "T1", "query": "디지털 트윈"})["status"] == "no_key"
    env = {"PP_NAVER_CLIENT_ID": "i", "PP_NAVER_CLIENT_SECRET": "s"}

    def handler(req):
        assert req.headers["X-Naver-Client-Id"] == "i"
        path = urlparse(str(req.url)).path
        return httpx.Response(200, json=fx("naver_news.json" if path.endswith("news.json") else "naver_datalab.json"))
    run(make("naver_news", handler, env=env), {"topic_id": "T1", "query": "디지털 트윈"})
    run(make("naver_datalab", handler, env=env), {"topic_id": "T1", "keywords": ["디지털 트윈"]})
    got = {(s["metric"], s["period"]): (s["value"], s["denom"], s["denom_kind"]) for s in series("T1")}
    assert got[("news_total", "2026-10")] == (48211, None, "none")
    assert got[("search_index", "2026-09")] == (100, None, "none")
    assert all(r["status"] == "ok" for r in runs(tmp_db))


def test_magazine_rss_partial_feed_failure_and_self_accumulated_series(run, tmp_db):
    def handler(req):
        if "nature" in str(req.url):
            return httpx.Response(200, content=fx("rss_nature_news.xml"))
        if "technologyreview" in str(req.url):
            return httpx.Response(200, content=fx("rss_mit_tr.xml"))
        return httpx.Response(500)
    feeds = {"mit_tr": "https://www.technologyreview.com/feed/", "nature_news": "https://www.nature.com/nature.rss",
             "wired": "https://www.wired.com/feed/rss"}
    r = run(make("magazine_rss", handler), {"feeds": feeds})
    assert r["status"] == "ok" and r["n_items"] == 5                   # wired 실패해도 나머지 저장
    got = {s["topic_id"]: s for s in series("rss:")}
    assert got["rss:mit_tr"]["value"] == 3 and got["rss:mit_tr"]["denom_kind"] == "self_accumulated"
    r2 = run(make("magazine_rss", lambda req: httpx.Response(500)), {"feeds": {"wired": feeds["wired"]}})
    assert r2["status"] == "failed"
    assert rows("SELECT tier, status FROM source_freshness WHERE source='magazine_rss'")[0] == {"tier": "optional", "status": "failed"}


# ---- L4 ----
def test_official_lists_snapshot_rows_and_required_fields(run, tmp_path):
    r = run(make("official_lists"))
    assert r["status"] == "ok" and r["n_items"] == 10 + 10 + 10 + 25 + 8 + 4 + 10
    top = rows("SELECT * FROM signal_items WHERE id='list:owasp_llm_top10:2025:1'")[0]
    m = json.loads(top["metrics_json"])
    assert top["title"] == "LLM01:2025 Prompt Injection" and m["current"] and m["field"] == "security"

    old = json.loads((Path(__file__).parents[1] / "painpointer/radar/lists/owasp_top10.json").read_text(encoding="utf-8"))
    (tmp_path / "a.json").write_text(json.dumps({**old, "edition": "2021", "checked_at": "2021-09-24"}), encoding="utf-8")
    (tmp_path / "b.json").write_text(json.dumps(old), encoding="utf-8")
    run(make("official_lists"), {"dir": str(tmp_path)})
    cur = {r["id"].split(":")[2]: json.loads(r["metrics_json"])["current"]
           for r in rows("SELECT id, metrics_json FROM signal_items WHERE id LIKE 'list:owasp_top10:%:1'")}
    assert cur == {"2021": False, "2025": True}                      # 같은 목록은 늦게 확인한 판이 현행

    (tmp_path / "c.json").write_text(json.dumps({"list_id": "x", "entries": []}), encoding="utf-8")
    assert run(make("official_lists"), {"dir": str(tmp_path)})["status"] == "failed"


# ---- L5 ----
def test_epoch_sota_series_is_running_max(run):
    r = run(make("epoch_benchmarks", lambda req: httpx.Response(200, content=fx("epoch_benchmarks.zip"))))
    assert r["status"] == "ok" and r["n_items"] == 3                 # algotune(속도 배수)은 메타데이터 없음 → 건너뜀
    assert not rows("SELECT id FROM signal_items WHERE id LIKE '%algotune%'")
    for bench in ("bench:gpqa_diamond", "bench:swe_bench_verified", "bench:aider_polyglot_external"):
        vals = [s["value"] for s in series(bench)]
        assert vals == sorted(vals) and all(0 <= v <= 1 for v in vals)  # 최고 점수는 줄지 않는다
        assert all(s["denom_kind"] == "none" and s["period"] <= "2026-09" for s in series(bench))
    m = json.loads(rows("SELECT metrics_json FROM signal_items WHERE id='epoch_benchmarks:gpqa_diamond'")[0]["metrics_json"])
    assert m["sota"] == max(s["value"] for s in series("bench:gpqa_diamond"))
    assert m["remaining"] == round(m["ceiling"] - m["sota"], 4) and m["random_baseline"] == 0.25
    aider = [s["value"] for s in series("bench:aider_polyglot_external")]
    assert max(aider) <= 1 and max(aider) > 0.5                       # 백분율 × 0.01


# ---- 실패 기록 ----
def test_failure_recorded_and_webhook_on_second_consecutive_day(run, tmp_db):
    hooks = []
    bad = lambda req: httpx.Response(503)
    r1 = run(make("cisa_kev", bad, today=date(2026, 10, 8)), webhook=lambda url, text: hooks.append(text))
    assert r1["status"] == "failed" and "503" in r1["error"] and hooks == []
    r2 = run(make("cisa_kev", bad), webhook=lambda url, text: hooks.append(text))
    assert r2["status"] == "failed" and len(hooks) == 1 and "2일 연속" in hooks[0]
    assert [x["status"] for x in runs(tmp_db)] == ["failed", "failed"]
    fr = rows("SELECT status, error FROM source_freshness WHERE source='cisa_kev'")[0]
    assert fr["status"] == "failed" and "503" in fr["error"]


def test_format_drift_is_failure_not_empty_success(run):
    r = run(make("cisa_kev", lambda req: httpx.Response(200, json={"title": "x", "count": 0})))
    assert r["status"] == "failed" and "형식 변경" in r["error"]
    r = run(make("openalex", lambda req: httpx.Response(200, text="<html>maintenance</html>")), {"topic_id": "T1"})
    assert r["status"] == "failed" and "JSON 아님" in r["error"]


def test_retry_after_429_then_success(run):
    n = {"i": 0}

    def handler(req):
        n["i"] += 1
        return httpx.Response(429) if n["i"] == 1 else httpx.Response(200, json=fx("kev.json"))
    assert run(make("cisa_kev", handler))["status"] == "ok" and n["i"] == 2


# ---- 앱스토어 리뷰(L1 커뮤니티, dccrawler 소스) ----
def test_appstore_reviews_become_posts():
    from dccrawler.sources.appstore import AppStoreSource, parse_feed
    data = fx("appstore_reviews.json")
    posts = parse_feed("362057947", data, "2026-10-09T00:00:00+00:00")
    assert len(posts) == 3 and all(p.rating in range(1, 6) and p.author_id_kind == "none" for p in posts)
    assert posts[0].key.startswith("appstore:362057947:") and posts[0].url is None
    assert "apps.apple.com/kr/app/id362057947#reviewId=" in posts[0].source_ref

    src = AppStoreSource(client=client(lambda req: httpx.Response(200, json=data if "page=1/" in str(req.url)
                                                                   else {"feed": {"entry": []}})))
    got = src.crawl("362057947", 1, 3, delay=0)
    assert len(got) == 3




def test_epoch_uses_metadata_scale_and_skips_unknown_benchmarks():
    from painpointer.radar.sources_l5 import sota_series
    rows = [{"Release date": "2026-01-05", "Percent correct": "40"}, {"Release date": "2026-03-01", "Percent correct": "88"}]
    assert sota_series(rows, "Percent correct", 0.01) == {"2026-01": 0.4, "2026-02": 0.4, "2026-03": 0.88}


def test_gdelt_keeps_month_with_missing_day(run):
    data = fx("gdelt_timelinevolraw.json")
    data["timeline"][0]["data"] = [p for p in data["timeline"][0]["data"] if not p["date"].startswith("20260701")]
    run(make("gdelt", lambda req: httpx.Response(200, json=data)), {"topic_id": "T1", "query": "x"})
    got = {s["period"]: s["value"] for s in series("T1")}
    assert got["2026-07"] == 30 and "2025-10" not in got              # 빠진 하루가 있어도 범위 안의 달은 쓴다
