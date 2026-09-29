from datetime import datetime

import pytest

from dccrawler.sources.base import EmptyResponseError, ParserDriftError
from dccrawler.sources.dcinside import DcinsideSource, parse_author_id
from dccrawler.sources.googleplay import review_to_post

LIST_HTML = """
<html><body><table class="gall_list"><tbody>
<tr class="ub-content us-post">
  <td class="gall_num">공지</td><td class="gall_tit"><a href="/board/view/?id=g&no=0">공지글</a></td>
</tr>
<tr class="ub-content us-post">
  <td class="gall_num">101</td>
  <td class="gall_tit ub-word"><a href="/mgallery/board/view/?id=g&no=101">배달 늦음</a>
    <a class="reply_numbox" href="#"><span class="reply_num">[3]</span></a></td>
  <td class="gall_writer ub-writer" data-nick="고정닉A" data-uid="uid_abc" data-ip="">고정닉A</td>
  <td class="gall_date" title="2026-09-17 12:34:56">12:34</td>
  <td class="gall_count">120</td><td class="gall_recommend">4</td>
</tr>
<tr class="ub-content us-post">
  <td class="gall_num">102</td>
  <td class="gall_tit ub-word"><a href="/mgallery/board/view/?id=g&no=102">환불 안됨</a></td>
  <td class="gall_writer ub-writer" data-nick="ㅇㅇ" data-uid="" data-ip="121.135">ㅇㅇ(121.135)</td>
  <td class="gall_date" title="2026-09-16 01:00:00">09.16</td>
  <td class="gall_count">1.2k</td><td class="gall_recommend">-</td>
</tr>
<tr class="ub-content us-post">
  <td class="gall_num">103</td>
  <td class="gall_tit ub-word"><a href="/mgallery/board/view/?id=g&no=103">닉만 있음</a></td>
  <td class="gall_writer ub-writer">ㅇㅇ(59.10)</td>
  <td class="gall_date">09.15</td>
  <td class="gall_count">0</td><td class="gall_recommend">0</td>
</tr>
</tbody></table></body></html>
"""


def test_parse_rows_author_kinds():
    src = DcinsideSource.__new__(DcinsideSource)  # 네트워크 클라이언트 없이
    rows = src._parse_rows(LIST_HTML, "mgallery", "g")
    assert [p.post_id for p in rows] == ["101", "102", "103"]
    a, b, c = rows
    assert a.author_id == "uid_abc" and a.author_id_kind == "strong"
    assert a.title == "배달 늦음" and a.comment_count == 3 and a.views == 120 and a.likes == 4
    assert a.created_at == "2026-09-17 12:34:56"
    assert a.url == "https://gall.dcinside.com/mgallery/board/view/?id=g&no=101"
    assert b.author_id == "121.135" and b.author_id_kind == "weak" and b.views == 1200
    assert c.author_id == "59.10" and c.author_id_kind == "weak"


@pytest.mark.parametrize("nick,uid,ip,expected", [
    ("닉", "u1", "", ("u1", "strong")),
    ("닉", "", "121.135", ("121.135", "weak")),
    ("닉", "", "121.135.7.9", ("121.135", "weak")),
    ("ㅇㅇ(59.10)", "", "", ("59.10", "weak")),
    ("ㅇㅇ", "", "", (None, "none")),
    (None, None, None, (None, "none")),
])
def test_parse_author_id(nick, uid, ip, expected):
    assert parse_author_id(nick, uid, ip) == expected


class _Resp:
    def __init__(self, text, status=200):
        self.text, self.status_code, self.encoding = text, status, None


class _Client:
    def __init__(self, text):
        self._text = text

    def get(self, url):
        return _Resp(self._text)


def test_parser_drift_raises_on_200_without_rows():
    src = DcinsideSource.__new__(DcinsideSource)
    src.client = _Client("<html><body>" + "x" * 5000 + "</body></html>")
    src._type_cache = {"g": "main"}
    with pytest.raises(ParserDriftError):
        src.crawl("g", 1, 1, delay=0)


def test_no_drift_on_short_body():
    src = DcinsideSource.__new__(DcinsideSource)
    src.client = _Client("<html></html>")
    src._type_cache = {"g": "main"}
    assert src.crawl("g", 1, 1, delay=0) == []


def test_empty_200_response_raises():
    src = DcinsideSource.__new__(DcinsideSource)
    src.client = _Client("")
    src._type_cache = {"g": "main"}
    with pytest.raises(EmptyResponseError):
        src.crawl("g", 1, 1, delay=0)


def test_review_to_post():
    p = review_to_post("com.app", {
        "reviewId": "gp:abc", "userName": "홍길동", "content": "환불이 안 돼요",
        "score": 1, "thumbsUpCount": 7, "at": datetime(2026, 7, 10, 9, 0, 0),
    }, crawled_at="2026-09-20T00:00:00+00:00")
    assert p.key == "googleplay:com.app:gp:abc"
    assert p.title is None and p.url is None
    assert p.rating == 1 and p.likes == 7 and p.author_id_kind == "none"
    assert p.created_at == "2026-07-10T09:00:00"
    assert "reviewId=gp:abc" in p.source_ref and "play.google.com" in p.source_ref
