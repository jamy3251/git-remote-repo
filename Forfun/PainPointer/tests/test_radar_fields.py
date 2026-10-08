"""레이더 분야(T8): 배타 배정, IT 신기술 D4(L2 상위 10% / L2 없으면 L4 목록), 디지털트윈 점유율 규칙,
중심 벡터 분야 배정, 혼합 묶음 D6, 정의 이력, 토픽 원천 질의."""
import json
from datetime import date
from urllib.parse import parse_qs, urlparse

import httpx
import numpy as np
import pytest

from painpointer import config
from painpointer.embed import EmbeddingMismatch, HashEmbedder
from painpointer.radar import radar_db, sources
from painpointer.radar.fields import (assign_field, build_fields, bundle_field, emerging_from_l2, exclusive,
                                      topic_queries)

TODAY = date(2026, 10, 9)


def T(tid, name, sf, fld, desc=""):
    return {"id": f"https://openalex.org/{tid}", "display_name": name, "description": desc or name,
            "subfield": {"id": f"https://openalex.org/subfields/{sf}"}, "field": {"id": f"https://openalex.org/fields/{fld}"}}


UNIVERSE = {
    "T1": T("T1", "Topic Modeling", 1702, 17, "latent topics in text corpora"),
    "T2": T("T2", "Cryptography and Data Security", 1702, 17, "encryption schemes"),
    "T3": T("T3", "Neural Network Training", 1702, 17, "gradient optimization"),
    "T4": T("T4", "Image Recognition", 1707, 17, "visual classification"),
    "T5": T("T5", "Usability Studies", 1709, 17, "user interface evaluation"),
    "T6": T("T6", "Network Protocols", 1705, 17, "routing protocols"),
    "T7": T("T7", "Network Security and Intrusion Detection", 1705, 17, "intrusion detection systems"),
    "T8": T("T8", "Advanced Wireless Communication Techniques", 2208, 22, "MIMO channels"),
    "T10": T("T10", "Food Security", 1100, 11, "nutrition"),
    "T11": T("T11", "Smart Grid Security", 2207, 22, "grid attacks"),
    "T12": T("T12", "Digital Transformation in Industry", 2209, 22, "industry 4.0 digital twin"),
}
SEARCH = {"security": ["T2", "T7", "T10", "T11"], "wireless": ["T8"], "privacy": ["T2"]}
# (최근 12개월, 직전 12개월) — T1이 압도적으로 성장
COUNTS = {"T1": (900, 300), "T2": (400, 380), "T3": (1000, 1000), "T4": (800, 790), "T5": (300, 290),
          "T6": (500, 520), "T7": (600, 590), "T8": (450, 440), "T11": (250, 240), "T12": (8000, 7000)}
DT = {"T12": 800, "T6": 30}


def handler_factory(universe=UNIVERSE, fail_counts=False):
    def handler(req):
        p = {k: v[0] for k, v in parse_qs(urlparse(str(req.url)).query, keep_blank_values=True).items()}
        path = urlparse(str(req.url)).path
        f = p.get("filter", "")
        if path == "/topics":
            if f.startswith("subfield.id:"):
                sf = f.split(":")[1]
                res = [t for t in universe.values() if t["subfield"]["id"].endswith("/" + sf)]
            elif f.startswith("ids.openalex:"):
                res = [universe[i] for i in f.split(":")[1].split("|") if i in universe]
            else:
                res = [universe[i] for i in SEARCH.get(p.get("search"), []) if i in universe]
            return httpx.Response(200, json={"meta": {"count": len(res)}, "results": res})
        if path == "/works" and p.get("group_by") == "primary_topic.id":
            if "title_and_abstract.search" in f:
                return httpx.Response(200, json={"meta": {}, "group_by": [
                    {"key": f"https://openalex.org/{k}", "count": v} for k, v in DT.items()]})
            if fail_counts and "to_publication_date:2026-10-09" not in f:   # L2 창만 실패
                return httpx.Response(400, text="bad filter")
            ids = f.split("primary_topic.id:")[1].split(",")[0].split("|")
            peer = "primary_location.source.type:journal|conference" in f
            assert peer != ("to_publication_date:2026-10-09" in f)       # L2 창은 학술지·학회만, 디지털트윈 분모는 전체
            if "to_publication_date:2026-10-09" in f:            # 디지털트윈 창(2년) 토픽 전체 수
                n = {"T12": 8000, "T6": 5000}
            elif "from_publication_date:2025-10-01" in f:
                n = {k: v[0] for k, v in COUNTS.items()}
            else:
                n = {k: v[1] for k, v in COUNTS.items()}
            return httpx.Response(200, json={"meta": {}, "group_by": [
                {"key": f"https://openalex.org/{i}", "count": n[i]} for i in ids if i in n]})
        return httpx.Response(404)
    return handler


def oa(handler):
    return sources.get("openalex_topics", http=httpx.Client(transport=httpx.MockTransport(handler)), today=TODAY,
                       sleep=lambda *_: None, env={})


def fields_of():
    conn = radar_db.open_read()
    try:
        return {fid: sorted(r[0] for r in conn.execute("SELECT id FROM topics WHERE field_id=?", (fid,)))
                for (fid,) in conn.execute("SELECT id FROM radar_fields").fetchall()}
    finally:
        conn.close()


@pytest.fixture
def built(monkeypatch):
    monkeypatch.setattr(config, "EMERGING_MIN_WORKS", 200)
    return build_fields(oa(handler_factory()), HashEmbedder())


def test_exclusive_assignment_and_rules(built):
    f = fields_of()
    assert set(f) == {"ai", "security", "hci", "telecom", "emerging", "digital_twin"}
    assert "T2" in f["security"] and "T2" not in f["ai"]               # AI subfield지만 보안이 우선
    assert "T7" in f["security"] and "T7" not in f["telecom"]
    assert "T11" in f["security"] and "T10" not in sum(f.values(), [])  # 식량 안보는 컴퓨터·공학 분야 밖
    assert f["telecom"] == ["T6", "T8"] and f["hci"] == ["T5"]
    assert f["digital_twin"] == ["T12"]                                # 10% 언급 → 포함, T6 0.6% → 제외
    all_ids = sum(f.values(), [])
    assert len(all_ids) == len(set(all_ids))                           # 한 토픽은 한 분야


def test_emerging_from_l2_is_top_10pct_and_removed_from_origin(built):
    f = fields_of()
    assert f["emerging"] == ["T1"] and "T1" not in f["ai"]
    assert built["_emerging_source"].startswith("L2")
    conn = radar_db.open_read()
    try:
        row = conn.execute("SELECT definition_source, definition_json FROM radar_fields WHERE id='emerging'").fetchone()
        basis = json.loads(row["definition_json"])["basis"]
        assert row["definition_source"].startswith("L2") and basis["n_candidates"] == 10 and "T1" in basis["growth"]
        s = conn.execute("SELECT value, denom, denom_kind FROM topic_series WHERE topic_id='T3' AND period='2026-09'").fetchone()
        assert tuple(s) == (1000, 1000 + 800, "total")                 # 분모 = 레이더 분야(AI: T3+T4) 합
    finally:
        conn.close()


def test_emerging_l2_rule_unit():
    # 분야 점유율: 최근 합 750, 직전 합 410. 후보(최근 ≥ 120편) = a(300/100), d(150/10)
    counts = {"a": (300, 100), "b": (100, 100), "c": (100, 100), "d": (150, 10), "e": (100, 100)}
    picked, basis = emerging_from_l2(counts, {"x": {"a", "b", "c", "d", "e"}}, top_pct=0.2, min_works=120)
    assert basis["n_candidates"] == 2 and picked == {"d"}            # ceil(2×0.2)=1개, 증가율 8.2 > 1.64
    picked, _ = emerging_from_l2(counts, {"x": {"a", "b", "c", "d", "e"}}, top_pct=1.0, min_works=120)
    assert picked == {"a", "d"}


def _l4_entries(titles):
    radar_db.init_radar_db()
    conn = radar_db.open_write()
    with conn:
        for i, t in enumerate(titles):
            conn.execute("INSERT INTO signal_items(id, layer, source, kind, title, metrics_json, snapshot_date)"
                         " VALUES (?,4,'official_lists','list_entry',?,?,'2026-10-09')",
                         (f"list:mit_tr10:2026:{i + 1}", t,
                          json.dumps({"field": "emerging", "current": True, "list_id": "mit_tr10", "edition": "2026"})))
    conn.close()


def test_emerging_without_l2_uses_l4_list_mentions(monkeypatch):
    monkeypatch.setattr(config, "EMERGING_MATCH_MIN", 0.7)          # 해시 임베더는 토큰 충돌이 있어 높게
    _l4_entries(["Image Recognition", "Sodium-ion batteries"])
    r = build_fields(oa(handler_factory()), HashEmbedder(), use_l2=False)
    f = fields_of()
    assert f["emerging"] == ["T4"] and "T4" not in f["ai"]             # 목록이 언급한 토픽만
    assert r["_emerging_source"].startswith("L4: mit_tr10 2026")


def test_l2_failure_falls_back_to_l4(monkeypatch):
    monkeypatch.setattr(config, "EMERGING_MATCH_MIN", 0.7)
    _l4_entries(["Usability Studies"])
    msgs = []
    r = build_fields(oa(handler_factory(fail_counts=True)), HashEmbedder(), progress=msgs.append)
    assert r["_emerging_source"].startswith("L4") and fields_of()["emerging"] == ["T5"]
    assert any("L2 수치 조회 실패" in m for m in msgs)


def test_rebuild_with_changed_topics_keeps_history(built, monkeypatch):
    smaller = {k: v for k, v in UNIVERSE.items() if k != "T6"}
    build_fields(oa(handler_factory(smaller)), HashEmbedder())
    conn = radar_db.open_read()
    try:
        h = conn.execute("SELECT topic_ids_json FROM radar_field_history WHERE field_id='telecom'").fetchall()
        assert [json.loads(x[0]) for x in h] == [["T6", "T8"]]          # 바뀌기 전 소속이 남는다
        assert conn.execute("SELECT COUNT(*) FROM radar_field_history WHERE field_id='hci'").fetchone()[0] == 0
    finally:
        conn.close()


def test_assign_field_nearest_centroid_or_unassigned(built):
    emb = HashEmbedder()
    conn = radar_db.open_read()
    try:
        fid, score = assign_field(conn, emb.encode(["Usability Studies: user interface evaluation"])[0], emb.model_name)
        assert fid == "hci" and score > 0.9
        fid, score = assign_field(conn, emb.encode(["서류 제출 기한이 너무 짧다"])[0], emb.model_name)
        assert fid is None and score < config.FIELD_ASSIGN_MIN           # 생활·행정 페인은 분야 미정
        with pytest.raises(EmbeddingMismatch, match="재계산 필요"):
            assign_field(conn, np.ones(64), "other-model")
    finally:
        conn.close()


def test_bundle_field_d6_majority_community_else_centroid(built):
    emb = HashEmbedder()
    conn = radar_db.open_write()
    with conn:
        conn.execute("INSERT INTO community_fields VALUES ('dcinside', 'security_gall', 'security')")
    rep = emb.encode(["Usability Studies: user interface evaluation"])[0]
    sec, other = ("dcinside", "security_gall"), ("dcinside", "startup")
    assert bundle_field(conn, [sec] * 6 + [other] * 4, rep, emb.model_name) == ("security", "community")
    assert bundle_field(conn, [sec] * 4 + [other] * 6, rep, emb.model_name) == ("hci", "centroid")
    conn.close()


def test_topic_queries_for_field_sources(built):
    conn = radar_db.open_read()
    try:
        qs = topic_queries(conn, "telecom")
    finally:
        conn.close()
    by = {}
    for s, q in qs:
        by.setdefault(s, []).append(q)
    assert set(by) == {"openalex", "semantic_scholar", "arxiv", "gdelt", "hackernews"} and len(by["openalex"]) == 2
    assert by["openalex"][0]["field_filter"] == ["primary_topic.id:T6|T8"]
    assert by["arxiv"][0]["denom_search"].startswith("cat:cs.NI") and by["gdelt"][0]["query"] == '"Network Protocols"'


def test_exclusive_priority_order():
    out = exclusive({"ai": {"x", "y"}, "security": {"x"}, "emerging": {"y"}})
    assert out["ai"] == set() and out["security"] == {"x"} and out["emerging"] == {"y"}
