from datetime import date

import pytest
from dccrawler.models import Post

from painpointer import config
from painpointer.aggregate import window_months, window_since
from painpointer.classify import stratified_sample
from painpointer.diff import diff_reports
from painpointer.search import dedup
from painpointer.textnorm import excerpt_context, locate_quote, mask_author, query_hash, verify_quote

from conftest import golden_posts


# ---- textnorm ----
def test_query_hash_normalizes_whitespace_and_width():
    a = query_hash("배달이  늦어요", "20대")
    assert a == query_hash("배달이 늦어요 ", " 20대") == query_hash("배달이\n늦어요", "２０대")
    assert len(a) == 16
    assert a != query_hash("배달이 늦어요", "30대")


def test_verify_quote_rules():
    body = "배달이 진짜 너무 늦게 와요!! 최악."
    assert verify_quote("너무 늦게와요", body)          # 공백·기호 무시
    assert verify_quote("배달이 진짜", body)
    assert not verify_quote("배달이 빨리", body)
    assert not verify_quote("", body) and not verify_quote(None, body)


def test_excerpt_context_contains_quote_and_fits():
    body = "앞부분 " * 30 + "핵심 문장은 배달이 너무 늦게 와요 여기" + " 뒷부분" * 30
    q = "배달이 너무 늦게 와요"
    ctx = excerpt_context(body, q, 120)
    assert ctx and len(ctx) <= 120
    assert verify_quote(q, ctx) and verify_quote(ctx, body)
    assert excerpt_context(body, "x" * 121, 120) is None
    assert excerpt_context(body, "없는 문장", 120) is None
    s, e = locate_quote(body, q)
    assert body[s:e] == q


def test_mask_author():
    assert mask_author("홍길동") == "홍길***"
    assert mask_author("ㅇㅇ") == "ㅇㅇ***"
    assert mask_author("") is None and mask_author(None) is None


# ---- window ----
def test_window():
    assert window_since(date(2026, 9, 21)) == "2025-10-01"
    ms = window_months(date(2026, 9, 21))
    assert ms[0] == "2025-10" and ms[-1] == "2026-09" and len(ms) == 12
    assert window_since(date(2026, 1, 15)) == "2025-02-01"


# ---- sampling ----
@pytest.mark.parametrize("n,expect_sampled,expect_n", [(799, False, 799), (800, False, 800), (801, True, 800), (2400, True, 800)])
def test_sample_boundaries(n, expect_sampled, expect_n):
    posts = golden_posts(n)
    s, sampled = stratified_sample(posts, 800, seed="abc")
    assert sampled is expect_sampled and len(s) == expect_n
    assert len({p.key for p in s}) == len(s)


def test_sample_deterministic_and_proportional():
    posts = golden_posts(2400)
    s1, _ = stratified_sample(posts, 800, seed="q1")
    s2, _ = stratified_sample(posts, 800, seed="q1")
    s3, _ = stratified_sample(posts, 800, seed="q2")
    assert [p.key for p in s1] == [p.key for p in s2]
    assert [p.key for p in s1] != [p.key for p in s3]
    from collections import Counter
    from painpointer.aggregate import month_of
    all_c = Counter((p.source, month_of(p)) for p in posts)
    smp_c = Counter((p.source, month_of(p)) for p in s1)
    for k, v in all_c.items():
        assert abs(smp_c[k] - v * 800 / 2400) <= 1.5


def test_sample_small_stratum_takes_all():
    posts = golden_posts(1000)
    # 아주 작은 층 하나 추가(3건) → 전수 포함
    tiny = [Post(source="natepann", board="t", post_id=str(i), title="x", body="배달 늦음", created_at="2026-05-01") for i in range(3)]
    s, sampled = stratified_sample(posts + tiny, 800, seed="s")
    assert sampled and len(s) == 800
    assert sum(1 for p in s if p.source == "natepann") == 3


# ---- dedup ----
def test_dedup_five_pairs():
    base = dict(source="dcinside", board="g", created_at="2026-05-01 10:00:00", crawled_at="2026-09-01T00:00:00+00:00")
    posts = [
        Post(post_id="1", title="배달 늦음", body="본문 A", url="https://x/1", author_id="u1", author_id_kind="strong", **base),
        Post(post_id="2", title="다른 글", body="다른 본문", url="https://x/1", author_id="u2", author_id_kind="strong", **base),   # (1) URL 동일
        Post(post_id="3", title="배달 늦음!!", body="본문 A", url="https://x/3", author_id="u3", author_id_kind="strong", **base),  # (2) 본문 해시 동일(제목 포함 정규화)
        Post(post_id="4", title="배달 늦음", body="본문 B", url="https://x/4", author_id="u1", author_id_kind="strong", **base),    # (3) 작성자+일자+제목 유사
        Post(post_id="5", title="배달 늦음", body="본문 C", url="https://x/5", author_id="u1", author_id_kind="strong",
             source="dcinside", board="g", created_at="2026-05-02 10:00:00", crawled_at=base["crawled_at"]),        # 다른 날 → 유지
        Post(post_id="6", title="배달 늦음", body="본문 D", url="https://x/6", author_id="121.1", author_id_kind="weak", **base),   # 다른 작성자 → 유지
        Post(post_id="7", title="배달 늦음", body="본문 E", url="https://x/7", author_id="121.1", author_id_kind="weak", **base),   # (3) weak 동일 대역 병합
        Post(source="googleplay", board="a", post_id="r1", title=None, body="본문 F", created_at="2026-05-01T10:00:00"),
        Post(source="googleplay", board="a", post_id="r2", title=None, body="본문 G", created_at="2026-05-01T10:00:00"),          # title None → (3) 건너뜀
    ]
    d = dedup(posts)
    keys = {p.post_id for p in d.posts}
    assert d.merged == {"url": 1, "body": 1, "author_title": 2}
    assert keys == {"1", "5", "6", "r1", "r2"}


# ---- diff ----
def _m(**kw):
    base = {"pain_rate": 0.5, "n_hit_total": 100, "n_relevant": 50, "n_pain": 25, "unique_authors_strong": 10,
            "distinct_ip_bands_weak": None, "months_present": 6, "sampled": False, "window_months": 12,
            "monthly": [{"source": "dcinside", "relevant": 50}]}
    base.update(kw)
    return base


def test_diff_rules():
    prev = {"id": "p1", "created_at": "2026-09-01", "metrics": _m(), "terms": ["a", "b"], "sources": ["dcinside"], "since": "2025-10-01"}
    d = diff_reports(prev, _m(pain_rate=0.6, n_relevant=60), ["a", "b"], ["dcinside"], "2025-10-01")
    assert d["counts"]["n_relevant"]["delta"] == 10 and not d["warnings"]
    assert abs(d["pain_rate"]["delta"] - 0.1) < 1e-9
    # 검색어 변경 → 경고 + 비율 배지
    d = diff_reports(prev, _m(), ["a", "c"], ["dcinside"], "2025-10-01")
    assert d["terms_changed"] and d["terms_added"] == ["c"] and d["pain_rate"]["flag"]
    # 소스 변경 → 건수 비교 불가, 공통 소스만 per_source
    d = diff_reports(prev, _m(monthly=[{"source": "dcinside", "relevant": 40}, {"source": "googleplay", "relevant": 9}]),
                     ["a", "b"], ["dcinside", "googleplay"], "2025-10-01")
    assert d["counts"] is None and "비교 불가" in d["count_note"]
    assert [p["source"] for p in d["per_source"]] == ["dcinside"]
    # 표본 → 절대 건수 비교 불가
    d = diff_reports(prev, _m(sampled=True), ["a", "b"], ["dcinside"], "2025-10-01")
    assert d["counts"] is None and "표본" in d["count_note"]


def test_config_model_warning():
    # 고정 ID: 현재 세대(날짜 접미사 없음)와 구세대 날짜 스냅샷 모두 허용
    assert config.model_warning("claude-haiku-4-5-20251001") is None
    assert config.model_warning("claude-sonnet-5") is None
    assert config.model_warning("claude-haiku-4-5") is None
    # 이동 별칭·미설정만 경고
    assert config.model_warning("claude-3-5-sonnet-latest") is not None
    assert config.model_warning("") is not None
