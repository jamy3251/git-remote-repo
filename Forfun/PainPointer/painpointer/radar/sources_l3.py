"""L3 대중 반응 — GDELT(대표값) · Hacker News · 네이버 뉴스·데이터랩 · 잡지 RSS(선택).

| 원천 | 분모 |
| GDELT DOC 2.0 timelinevolraw | total: 같은 날 GDELT가 모니터링한 전체 기사 수(norm). 타임라인은 최대 1년 |
| HN Algolia | total: 같은 기간 점수 2 이상 전체 스토리 수(빈 검색어 nbHits). 0~1점 스팸 급증 제외 |
| 네이버 뉴스 검색 | none: 쿼리 총건수만. 스냅샷을 쌓아 자체 비교(2기간 후) |
| 네이버 데이터랩 | none: 상대 지수 그대로('상대 지수' 표시) |
| 잡지 RSS | self_accumulated: 수집 시작 이후 매체별 누적 항목 수 |
"""
from __future__ import annotations

import hashlib
import xml.etree.ElementTree as ET
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

from ..guard import screen_doc
from .sources import (FetchResult, SeriesPoint, SignalItem, SignalSource, SourceError, content_hash, last_full_month,
                      month_bounds, register, shift_month, windows_12m)

GDELT = "https://api.gdeltproject.org/api/v2/doc/doc"
HN_BY_DATE = "https://hn.algolia.com/api/v1/search_by_date"
HN_SEARCH = "https://hn.algolia.com/api/v1/search"
# 점수 2 이상 스토리만 센다(분자·분모 같게). 2026년 일부 달은 0~1점 스토리가 달 200만 건 넘게 색인돼
# 전체 수가 열 배 이상 튄다(2026-10-09 실측: 2025-09 2.5만 → 2026-09 217만, 2점 이상은 2.0만 → 2.3만).
HN_MIN_POINTS = 2
NAVER_NEWS = "https://openapi.naver.com/v1/search/news.json"
NAVER_DATALAB = "https://openapi.naver.com/v1/datalab/search"

MAGAZINES = {
    "mit_tr": "https://www.technologyreview.com/feed/",
    "nature_news": "https://www.nature.com/nature.rss",
    "ieee_spectrum": "https://spectrum.ieee.org/feeds/feed.rss",
    "wired": "https://www.wired.com/feed/rss",
    "zdnet_kr": "https://feeds.feedburner.com/zdkorea",
    "etnews": "https://rss.etnews.com/Section901.xml",
}


def _epoch(d: str) -> int:
    return int(datetime.fromisoformat(d).replace(tzinfo=timezone.utc).timestamp())


@register
class Gdelt(SignalSource):
    """질의 {topic_id, query}: 최근 1년 일별 기사 수 → 월 합계 / 같은 달 전체 모니터링 기사 수.
    조회 시작일보다 앞서 시작하는 달·이번 달은 덜 찼으므로 뺀다(빠진 날이 있어도 범위 안의 달은 쓴다)."""
    name = "gdelt"
    layer = 3
    min_interval = 6.0          # GDELT 안내: 5초에 1회
    needs_query = True

    def fetch(self, query: dict) -> FetchResult:
        end = last_full_month(self.today)
        start = self.today - timedelta(days=364)
        data = self.get_json(GDELT, params={
            "query": query["query"], "mode": "timelinevolraw", "format": "json",
            "startdatetime": start.strftime("%Y%m%d") + "000000", "enddatetime": self.today.strftime("%Y%m%d") + "000000"})
        tl = data.get("timeline") if isinstance(data, dict) else None
        if tl is None:
            raise SourceError("gdelt: timeline 없음(형식 변경?)")
        val: dict[str, float] = defaultdict(float)
        norm: dict[str, float] = defaultdict(float)
        for s in tl:
            for p in s.get("data") or []:
                d = str(p.get("date", ""))[:8]
                if len(d) != 8:
                    continue
                ym = f"{d[:4]}-{d[4:6]}"
                val[ym] += float(p.get("value") or 0)
                norm[ym] += float(p.get("norm") or 0)
        series = [SeriesPoint(query["topic_id"], 3, "articles", ym, val[ym], norm[ym], "total")
                  for ym in sorted(val) if f"{ym}-01" >= start.isoformat() and ym <= end and norm[ym]]
        last = max((d for s in tl for d in (str(p.get("date", ""))[:8] for p in s.get("data") or []) if len(d) == 8),
                   default=None)
        return FetchResult(series=series, latest_data_at=f"{last[:4]}-{last[4:6]}-{last[6:8]}" if last else None)


@register
class HackerNews(SignalSource):
    """질의 {topic_id, query, top?}: 최근·직전 12개월 스토리 수 / 같은 기간 전체 스토리 수 + 점수 상위 스토리."""
    name = "hackernews"
    layer = 3
    min_interval = 0.3
    needs_query = True
    _denom_cache: dict = {}

    def hits(self, q: str, a: str, b: str) -> int:
        data = self.get_json(HN_BY_DATE, params={
            "query": q, "tags": "story", "hitsPerPage": 0,
            "numericFilters": f"created_at_i>={_epoch(a)},created_at_i<{_epoch(b) + 86400},points>={HN_MIN_POINTS}"})
        if "nbHits" not in data:
            raise SourceError("hackernews: nbHits 없음(형식 변경?)")
        return int(data["nbHits"])

    def window(self, q: str, end_month: str) -> int:
        """12개월 합 = 달별 nbHits 합. 1년 범위 한 번에 물으면 Algolia 추정치가 열 배까지 틀린다
        (2026-10-09 실측: 달별 합 약 28만 vs 1년 한 번 259만)."""
        total = 0
        for k in range(12):
            a, b = month_bounds(shift_month(end_month, -k))
            if q == "":
                if (a, b) not in self._denom_cache:      # 분모(전체 스토리)는 토픽마다 같으므로 한 번만
                    self._denom_cache[(a, b)] = self.hits("", a, b)
                total += self._denom_cache[(a, b)]
            else:
                total += self.hits(q, a, b)
        return total

    def fetch(self, query: dict) -> FetchResult:
        (c0, _), _, end = windows_12m(self.today)
        series = []
        for period in (end, shift_month(end, -12)):
            n, d = self.window(query["query"], period), self.window("", period)
            if d:
                series.append(SeriesPoint(query["topic_id"], 3, "stories_12m", period, n, d, "total"))
        items = []
        top = int(query.get("top", 10))
        if top:
            data = self.get_json(HN_SEARCH, params={
                "query": query["query"], "tags": "story", "hitsPerPage": top,
                "numericFilters": f"created_at_i>={_epoch(c0)},points>=10"})
            for h in data.get("hits") or []:
                items.append(SignalItem(
                    id=f"hackernews:{h['objectID']}", layer=3, source=self.name, kind="story",
                    title=(h.get("title") or "")[:300],
                    url=h.get("url") or f"https://news.ycombinator.com/item?id={h['objectID']}",
                    published_at=(h.get("created_at") or "")[:10] or None,
                    metrics={"topic_id": query["topic_id"], "points": h.get("points") or 0,
                             "comments": h.get("num_comments") or 0},
                    injection_flag=int(screen_doc(h.get("title")))))
        return FetchResult(items=items, series=series)


class _Naver(SignalSource):
    layer = 3
    key_env = ("PP_NAVER_CLIENT_ID", "PP_NAVER_CLIENT_SECRET")
    min_interval = 0.15
    needs_query = True

    def headers(self) -> dict:
        return {"X-Naver-Client-Id": self.env["PP_NAVER_CLIENT_ID"],
                "X-Naver-Client-Secret": self.env["PP_NAVER_CLIENT_SECRET"]}


@register
class NaverNews(_Naver):
    """질의 {topic_id, query}: 뉴스 총건수 스냅샷(이번 달). 전체 기사 수가 없어 분모 없음."""
    name = "naver_news"

    def fetch(self, query: dict) -> FetchResult:
        data = self.get_json(NAVER_NEWS, headers=self.headers(), params={"query": query["query"], "display": 1})
        if "total" not in data:
            raise SourceError("naver_news: total 없음(형식 변경?)")
        period = f"{self.today.year:04d}-{self.today.month:02d}"
        return FetchResult(series=[SeriesPoint(query["topic_id"], 3, "news_total", period, int(data["total"]), None, "none")])


@register
class NaverDatalab(_Naver):
    """질의 {topic_id, keywords}: 최근 24개월 월별 검색어 상대 지수(최댓값 100). 지수 자체가 기간 비교."""
    name = "naver_datalab"

    def fetch(self, query: dict) -> FetchResult:
        end = last_full_month(self.today)
        start = shift_month(end, -23)
        kws = query["keywords"] if isinstance(query["keywords"], list) else [query["keywords"]]
        r = self.request("POST", NAVER_DATALAB, headers=self.headers(), json={
            "startDate": f"{start}-01", "endDate": f"{end}-28", "timeUnit": "month",
            "keywordGroups": [{"groupName": str(query["topic_id"]), "keywords": kws[:20]}]})
        data = r.json()
        res = data.get("results")
        if not res:
            raise SourceError("naver_datalab: results 없음(형식 변경?)")
        series = [SeriesPoint(query["topic_id"], 3, "search_index", p["period"][:7], float(p["ratio"]), None, "none")
                  for p in res[0].get("data") or [] if p.get("period")]
        return FetchResult(series=series)


_NS = {"atom": "http://www.w3.org/2005/Atom", "rss1": "http://purl.org/rss/1.0/",
       "dc": "http://purl.org/dc/elements/1.1/"}


def _date(s: str | None) -> str | None:
    s = (s or "").strip()
    if not s:
        return None
    try:
        return parsedate_to_datetime(s).date().isoformat()        # RFC 822(RSS 2.0)
    except (TypeError, ValueError):
        pass
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).date().isoformat()   # ISO(Atom·dc:date)
    except ValueError:
        return None


def parse_feed(xml_text: str) -> list[dict]:
    """RSS 2.0 · RSS 1.0(RDF) · Atom → [{title, link, date, summary}]."""
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as e:
        raise SourceError("rss: XML 파싱 실패") from e
    out = []
    for it in root.iter("item"):                                          # RSS 2.0
        out.append({"title": it.findtext("title"), "link": it.findtext("link"),
                    "date": _date(it.findtext("pubDate") or it.findtext("dc:date", namespaces=_NS)),
                    "summary": it.findtext("description") or ""})
    for it in root.iter("{http://purl.org/rss/1.0/}item"):                # RSS 1.0
        out.append({"title": it.findtext("rss1:title", namespaces=_NS), "link": it.findtext("rss1:link", namespaces=_NS),
                    "date": _date(it.findtext("dc:date", namespaces=_NS)),
                    "summary": it.findtext("rss1:description", namespaces=_NS) or ""})
    for it in root.iter("{http://www.w3.org/2005/Atom}entry"):            # Atom
        link = it.find("atom:link", _NS)
        out.append({"title": it.findtext("atom:title", namespaces=_NS), "link": link.get("href") if link is not None else None,
                    "date": _date(it.findtext("atom:published", namespaces=_NS) or it.findtext("atom:updated", namespaces=_NS)),
                    "summary": it.findtext("atom:summary", namespaces=_NS) or ""})
    return [o for o in out if o["link"]]


@register
class MagazineRss(SignalSource):
    """잡지·전문지 RSS(선택). 피드 하나가 실패해도 나머지는 저장하고, 전부 실패하면 실패로 기록."""
    name = "magazine_rss"
    layer = 3
    tier = "optional"
    min_interval = 0.5

    def fetch(self, query: dict) -> FetchResult:
        feeds = query.get("feeds") or MAGAZINES
        items, errors = [], []
        for feed, url in feeds.items():
            try:
                entries = parse_feed(self.request("GET", url, retries=1).text)
            except SourceError as e:
                errors.append(f"{feed}: {e}")
                continue
            for e in entries:
                key = hashlib.sha256(e["link"].encode()).hexdigest()[:16]
                items.append(SignalItem(
                    id=f"magazine_rss:{feed}:{key}", layer=3, source=self.name, kind="article",
                    title=" ".join((e["title"] or "").split())[:300], url=e["link"], published_at=e["date"],
                    metrics={"feed": feed}, content_hash=content_hash(e["summary"]),
                    injection_flag=int(screen_doc((e["title"] or "") + " " + e["summary"]))))
        if errors and not items:
            raise SourceError("; ".join(errors)[:300])
        return FetchResult(items=items, self_accumulated="rss")
