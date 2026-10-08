"""L2 학계 열기 — OpenAlex(논문 수·명망지·토픽 목록) · Semantic Scholar(인용 속도) · arXiv(프리프린트 수).

지표(분모 total): topic 논문 수 / 레이더 분야 전체 논문 수, 최근 12개월 vs 직전 12개월(이번 달 제외).
토픽 배정은 primary_topic 기준(한 논문이 여러 토픽에 이중 계상되지 않게). 분야 분모 필터는 질의가 준다
(fields.py가 레이더 분야별로 정한다). KCI는 키 발급 후 응답 형식을 확인해 붙인다.
"""
from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from datetime import date

from ..guard import screen_doc
from .sources import (FetchResult, SeriesPoint, SignalItem, SignalSource, SourceError, content_hash, register,
                      shift_month, windows_12m)

OPENALEX = "https://api.openalex.org"
S2_BULK = "https://api.semanticscholar.org/graph/v1/paper/search/bulk"
ARXIV = "https://export.arxiv.org/api/query"
DEFAULT_FIELD_FILTER = "primary_topic.field.id:17"      # Computer Science
REPOSITORY_TYPES = {"repository", "ebook platform", "metadata"}


def short_id(oa_id: str | None) -> str:
    return (oa_id or "").rsplit("/", 1)[-1]


def abstract_text(inv: dict | None) -> str:
    """OpenAlex abstract_inverted_index → 본문(해시·인젝션 검사용, 저장하지 않음)."""
    if not inv:
        return ""
    pos = sorted((i, w) for w, idx in inv.items() for i in idx)
    return " ".join(w for _, w in pos)


class _OpenAlex(SignalSource):
    layer = 2
    key_env = ("PP_OPENALEX_KEY",)
    key_optional = True                 # 키 없이도 응답한다(비용 한도만 작다). 키가 있으면 api_key로 보낸다
    min_interval = 0.15

    def oa(self, path: str, params: dict) -> dict:
        params = {k: v for k, v in params.items() if v is not None}
        if self.env.get("PP_OPENALEX_KEY"):
            params["api_key"] = self.env["PP_OPENALEX_KEY"]
        data = self.get_json(f"{OPENALEX}/{path}", params=params)
        if not isinstance(data, dict) or "meta" not in data:
            raise SourceError(f"{self.name}: meta 없음(형식 변경?)")
        return data

    def count(self, flt: str) -> int:
        return int(self.oa("works", {"filter": flt, "per_page": 1, "select": "id"})["meta"]["count"])


@register
class OpenAlexWorks(_OpenAlex):
    """질의 {topic_id, field_filter?, venues?, top?}: 토픽 논문 수·분야 대비 점유율·명망지 점유율 + 인용 상위 논문."""
    name = "openalex"
    needs_query = True

    def fetch(self, query: dict) -> FetchResult:
        tid = short_id(query["topic_id"])
        field_filter = query.get("field_filter") or DEFAULT_FIELD_FILTER
        (c0, c1), (p0, p1), end = windows_12m(self.today)
        win = {end: (c0, c1), shift_month(end, -12): (p0, p1)}
        series = []
        for period, (a, b) in win.items():
            dates = f"from_publication_date:{a},to_publication_date:{b}"
            n_topic = self.count(f"primary_topic.id:{tid},{dates}")
            n_field = self.count(f"{field_filter},{dates}")
            if n_field:
                series.append(SeriesPoint(tid, 2, "works_12m", period, n_topic, n_field, "total"))
            venues = [short_id(v) for v in query.get("venues") or []][:100]
            if venues and n_topic:
                n_pres = self.count(f"primary_topic.id:{tid},{dates},primary_location.source.id:{'|'.join(venues)}")
                series.append(SeriesPoint(tid, 2, "prestige_works_12m", period, n_pres, n_topic, "total"))
        items = []
        top = int(query.get("top", 20))
        if top:
            data = self.oa("works", {
                "filter": f"primary_topic.id:{tid},from_publication_date:{c0},to_publication_date:{c1}",
                "sort": "cited_by_count:desc", "per_page": min(top, 200),
                "select": "id,doi,title,publication_date,cited_by_count,primary_location,abstract_inverted_index"})
            for w in data.get("results") or []:
                abstract = abstract_text(w.get("abstract_inverted_index"))
                src = ((w.get("primary_location") or {}).get("source") or {})
                items.append(SignalItem(
                    id=f"openalex:{short_id(w.get('id'))}", layer=2, source=self.name, kind="work",
                    title=(w.get("title") or "")[:300], url=w.get("doi") or w.get("id"),
                    published_at=w.get("publication_date"),
                    metrics={"topic_id": tid, "cited_by_count": w.get("cited_by_count") or 0,
                             "venue_id": short_id(src.get("id")) or None, "has_abstract": bool(abstract)},
                    content_hash=content_hash(abstract), injection_flag=int(screen_doc(abstract))))
        return FetchResult(items=items, series=series, latest_data_at=max(
            (i.published_at for i in items if i.published_at and i.published_at <= self.today.isoformat()), default=None))


@register
class OpenAlexTopics(_OpenAlex):
    """질의 {subfield}: 그 subfield의 OpenAlex 토픽 목록 → topics 표(분야 배정은 fields.py)."""
    name = "openalex_topics"
    needs_query = True

    def fetch(self, query: dict) -> FetchResult:
        sf = str(query["subfield"])
        topics, page = [], 1
        while True:
            data = self.oa("topics", {"filter": f"subfield.id:{sf}", "per_page": 200, "page": page,
                                      "select": "id,display_name,description,works_count"})
            res = data.get("results") or []
            topics += [{"id": short_id(t["id"]), "name": t.get("display_name") or "", "description": t.get("description") or ""}
                       for t in res if t.get("id")]
            if len(res) < 200:
                break
            page += 1
        if not topics:
            raise SourceError(f"openalex_topics: subfield {sf} 토픽 0개")
        return FetchResult(topics=topics)

    @staticmethod
    def label(query: dict) -> str:
        return f"subfield:{query.get('subfield')}"


@register
class OpenAlexVenues(_OpenAlex):
    """질의 {radar_field_id, filter, top_k?}: 분야 논문이 많이 실린 학술지·학회(최근 2년) 중
    2yr_mean_citedness 상위 25%를 명망지로 기록. 저장소(arXiv·Zenodo 등)는 뺀다. basis에 근거 수치."""
    name = "openalex_venues"
    needs_query = True

    def fetch(self, query: dict) -> FetchResult:
        fid, flt = query["radar_field_id"], query["filter"]
        top_k = int(query.get("top_k", 60))
        since = f"{self.today.year - 2:04d}-{self.today.month:02d}-01"
        data = self.oa("works", {"filter": f"{flt},from_publication_date:{since}",
                                 "group_by": "primary_location.source.id", "per_page": 200})
        groups = [g for g in data.get("group_by") or [] if g.get("key") and "unknown" not in str(g.get("key"))]
        groups = sorted(groups, key=lambda g: -int(g.get("count") or 0))[:top_k]
        stats = {}
        ids = [short_id(g["key"]) for g in groups]
        for i in range(0, len(ids), 50):
            d = self.oa("sources", {"filter": "ids.openalex:" + "|".join(ids[i:i + 50]), "per_page": 50,
                                    "select": "id,display_name,summary_stats,type"})
            for s in d.get("results") or []:
                stats[short_id(s["id"])] = s
        cand = []
        for g in groups:
            s = stats.get(short_id(g["key"]))
            if not s or (s.get("type") or "") in REPOSITORY_TYPES:
                continue
            ss = s.get("summary_stats") or {}
            if ss.get("2yr_mean_citedness") is None:
                continue
            cand.append((float(ss["2yr_mean_citedness"]), int(ss.get("h_index") or 0), s, int(g["count"])))
        if not cand:
            raise SourceError(f"openalex_venues: {fid} 후보 학술지 0개")
        cand.sort(key=lambda c: (-c[0], -c[1]))
        k = max(1, len(cand) // 4)
        venues = [{"radar_field_id": fid, "source_id": short_id(s["id"]), "tier": "openalex_top25",
                   "basis": (f"{s.get('display_name', '')}: 2yr_mean_citedness {cit:.2f}, h_index {h}, "
                             f"분야 논문 {n}건 — 후보 {len(cand)}곳 중 상위 25%")}
                  for cit, h, s, n in cand[:k]]
        return FetchResult(venues=venues)

    @staticmethod
    def label(query: dict) -> str:
        return f"venues:{query.get('radar_field_id')}"


@register
class SemanticScholar(SignalSource):
    """질의 {topic_id, terms}: 최근 12개월 논문(최대 1000편 표본)의 인용 속도 = 편당 월평균 인용.

    분모가 '전체 대비'가 아니라 표본 평균이므로 denom_kind none, denom 칸에 표본 수를 둔다."""
    name = "semantic_scholar"
    layer = 2
    key_env = ("PP_S2_KEY",)
    key_optional = True
    min_interval = 1.1
    needs_query = True

    def fetch(self, query: dict) -> FetchResult:
        (c0, c1), _, end = windows_12m(self.today)
        headers = {"x-api-key": self.env["PP_S2_KEY"]} if self.env.get("PP_S2_KEY") else {}
        data = self.get_json(S2_BULK, headers=headers, params={
            "query": query["terms"], "publicationDateOrYear": f"{c0}:{c1}",
            "fields": "citationCount,publicationDate,title"})
        if "data" not in data:
            raise SourceError("semantic_scholar: data 없음(형식 변경?)")
        end_d = date.fromisoformat(c1)
        rates = []
        for p in data["data"] or []:
            pd = p.get("publicationDate")
            if not pd:
                continue
            months = max(1.0, (end_d - date.fromisoformat(pd)).days / 30.44)
            rates.append((p.get("citationCount") or 0) / months)
        series = []
        if rates:
            series.append(SeriesPoint(query["topic_id"], 2, "citation_velocity", end,
                                      round(sum(rates) / len(rates), 4), len(rates), "none"))
        return FetchResult(series=series)


_TOTAL_RE = re.compile(r"<opensearch:totalResults[^>]*>(\d+)</opensearch:totalResults>")


@register
class Arxiv(SignalSource):
    """질의 {topic_id, search, denom_search}: 최근·직전 12개월 프리프린트 수 / 같은 기간 분모 검색 수(total)."""
    name = "arxiv"
    layer = 2
    min_interval = 3.1          # arXiv API 안내: 3초에 1회
    needs_query = True

    def total(self, search: str, a: str, b: str) -> int:
        q = f"({search}) AND submittedDate:[{a.replace('-', '')}0000 TO {b.replace('-', '')}2359]"
        r = self.request("GET", ARXIV, params={"search_query": q, "start": 0, "max_results": 0})
        m = _TOTAL_RE.search(r.text)
        if not m:
            try:
                ET.fromstring(r.text)
            except ET.ParseError as e:
                raise SourceError("arxiv: Atom XML 아님") from e
            raise SourceError("arxiv: totalResults 없음(형식 변경?)")
        return int(m.group(1))

    def fetch(self, query: dict) -> FetchResult:
        (c0, c1), (p0, p1), end = windows_12m(self.today)
        series = []
        for period, (a, b) in {end: (c0, c1), shift_month(end, -12): (p0, p1)}.items():
            n = self.total(query["search"], a, b)
            d = self.total(query["denom_search"], a, b)
            if d:
                series.append(SeriesPoint(query["topic_id"], 2, "preprints_12m", period, n, d, "total"))
        return FetchResult(series=series)
