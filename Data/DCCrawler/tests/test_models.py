from dccrawler.models import Post, parse_day


def test_empty_title_url_become_none():
    p = Post(source="dcinside", board="g", post_id="1", title="", url="", author_id="")
    assert p.title is None and p.url is None and p.author_id is None
    assert p.author_id_kind == "none"


def test_author_kind_requires_id():
    p = Post(source="dcinside", board="g", post_id="1", author_id=None, author_id_kind="strong")
    assert p.author_id_kind == "none"
    p2 = Post(source="dcinside", board="g", post_id="1", author_id="u1", author_id_kind="strong")
    assert p2.author_id_kind == "strong"


def test_key_and_index_text():
    p = Post(source="s", board="b", post_id="9", title="제목", body="본문", comments=["댓글"])
    assert p.key == "s:b:9"
    assert p.index_text() == "제목\n본문"
    assert p.text_for_analysis() == "제목\n본문\n댓글"
    assert p.to_dict()["key"] == "s:b:9"


def test_parse_day_formats():
    assert parse_day("2026-09-17 12:34:56") == "2026-09-17"
    assert parse_day("2026.09.17") == "2026-09-17"
    assert parse_day("2026-09-17T03:00:00+00:00") == "2026-09-17"
    assert parse_day("25.12.31") == "2025-12-31"
    assert parse_day("26/06/02 23:56") == "2026-06-02"          # 오유
    assert parse_day("04/25/25(Fri)16:47:07") == "2025-04-25"   # 4chan(미국식)
    # 올해 글 "MM.DD" → 수집일 연도
    assert parse_day("09.17", "2026-09-20T01:00:00+00:00") == "2026-09-17"
    # 연초 수집한 작년 12월 글
    assert parse_day("12.30", "2026-01-02T01:00:00+00:00") == "2025-12-30"
    # 오늘 글 "HH:MM" → 수집일(KST 보정)
    assert parse_day("23:10", "2026-09-20T16:00:00+00:00") == "2026-09-21"
    assert parse_day("", "2026-09-20T01:00:00+00:00") is None
    assert parse_day("어제") is None
    assert parse_day("2026-13-40") is None
