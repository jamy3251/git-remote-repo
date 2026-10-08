"""L1 페인 — 공식 사건 피드(핵심: CISA KEV · NVD CVE · AI Incident Database).

공식 사건 축 = 매핑된 범주의 건수 / 같은 피드 전체 건수(denom total), 최근 6개월 vs 직전 6개월 비율.
범주×월 시계열은 저장된 항목 전체로 다시 계산한다(sources.feed_category_series). 리포트 M·K와 섞지 않는다.

커뮤니티·앱 리뷰(L1의 나머지)는 기존 상시 수집(dccrawler 소스 → painpointer.db posts)으로 들어간다.
앱스토어 리뷰는 dccrawler.sources.appstore. 선택 피드(1372·권익위·방통위·개인정보·KISA)는 공개 범위 확인 전이라 없다.
"""
from __future__ import annotations

import csv
import io
from datetime import date, timedelta
from pathlib import Path

from .sources import FetchResult, SignalItem, SignalSource, SourceError, SourceUnavailable, register

KEV_URL = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json"
NVD_URL = "https://services.nvd.nist.gov/rest/json/cves/2.0"
NVD_MAX_DAYS = 120          # NVD API: pubStartDate~pubEndDate 최대 120일
NVD_PAGE = 2000


@register
class CisaKev(SignalSource):
    """CISA 악용 확인 취약점 목록(전체 JSON 1개). 범주 = CWE. 날짜 = 목록 등재일(dateAdded)."""
    name = "cisa_kev"
    layer = 1

    def fetch(self, query: dict) -> FetchResult:
        data = self.get_json(query.get("url") or KEV_URL)
        vulns = data.get("vulnerabilities") if isinstance(data, dict) else None
        if not vulns:
            raise SourceError("cisa_kev: vulnerabilities 없음(형식 변경?)")
        items = []
        for v in vulns:
            cve = (v.get("cveID") or "").strip()
            if not cve:
                continue
            items.append(SignalItem(
                id=f"cisa_kev:{cve}", layer=1, source=self.name, kind="incident",
                title=" ".join(f"{v.get('vendorProject', '')} {v.get('product', '')} — {v.get('vulnerabilityName', '')}".split()),
                url=f"https://nvd.nist.gov/vuln/detail/{cve}", published_at=v.get("dateAdded"),
                metrics={"categories": [c for c in v.get("cwes") or [] if c],
                         "ransomware": v.get("knownRansomwareCampaignUse") == "Known"}))
        return FetchResult(items=items, latest_data_at=(data.get("dateReleased") or "")[:10] or None,
                           feed_categories="kev")


def _nvd_cwes(cve: dict) -> list[str]:
    """Primary 출처 CWE 우선, 없으면 Secondary. NVD-CWE-Other·noinfo는 범주에서 뺀다."""
    best: dict[str, list[str]] = {"Primary": [], "Secondary": []}
    for w in cve.get("weaknesses") or []:
        vals = [d.get("value", "") for d in w.get("description") or [] if d.get("lang") == "en"]
        best.setdefault(w.get("type", "Secondary"), []).extend(v for v in vals if v.startswith("CWE-"))
    return sorted(set(best.get("Primary") or best.get("Secondary") or []))


def _nvd_score(cve: dict) -> float | None:
    for key in ("cvssMetricV40", "cvssMetricV31", "cvssMetricV30"):
        for m in (cve.get("metrics") or {}).get(key) or []:
            s = (m.get("cvssData") or {}).get("baseScore")
            if s is not None:
                return float(s)
    return None


@register
class Nvd(SignalSource):
    """NVD CVE 2.0. 기본 = 최근 3일(매일 실행), --since로 백필. 키(PP_NVD_KEY)가 있으면 요청 간격이 짧아진다."""
    name = "nvd"
    layer = 1
    key_env = ("PP_NVD_KEY",)
    key_optional = True

    @property
    def min_interval(self) -> float:          # 키 없음: 30초에 5회 / 키: 30초에 50회
        return 0.7 if self.env.get("PP_NVD_KEY") else 6.5

    def fetch(self, query: dict) -> FetchResult:
        until = date.fromisoformat(query["until"]) if query.get("until") else self.today
        since = date.fromisoformat(query["since"]) if query.get("since") else until - timedelta(days=3)
        headers = {"apiKey": self.env["PP_NVD_KEY"]} if self.env.get("PP_NVD_KEY") else {}
        items: list[SignalItem] = []
        start = since
        while start <= until:
            end = min(start + timedelta(days=NVD_MAX_DAYS - 1), until)
            idx = 0
            while True:
                data = self.get_json(NVD_URL, headers=headers, params={
                    "pubStartDate": f"{start.isoformat()}T00:00:00.000", "pubEndDate": f"{end.isoformat()}T23:59:59.999",
                    "resultsPerPage": NVD_PAGE, "startIndex": idx})
                if "vulnerabilities" not in data:
                    raise SourceError("nvd: vulnerabilities 없음(형식 변경?)")
                for v in data["vulnerabilities"]:
                    c = v.get("cve") or {}
                    if not c.get("id") or c.get("vulnStatus") == "Rejected":
                        continue
                    desc = next((d.get("value", "") for d in c.get("descriptions") or [] if d.get("lang") == "en"), "")
                    items.append(SignalItem(
                        id=f"nvd:{c['id']}", layer=1, source=self.name, kind="incident", title=desc[:200],
                        url=f"https://nvd.nist.gov/vuln/detail/{c['id']}", published_at=(c.get("published") or "")[:10],
                        metrics={"categories": _nvd_cwes(c), "cvss": _nvd_score(c), "status": c.get("vulnStatus")}))
                idx += int(data.get("resultsPerPage") or 0)
                if not data.get("resultsPerPage") or idx >= int(data.get("totalResults") or 0):
                    break
            start = end + timedelta(days=1)
        return FetchResult(items=items, feed_categories="nvd")

    @staticmethod
    def label(query: dict) -> str:
        return "backfill" if query.get("since") else "daily"


@register
class AiidSnapshot(SignalSource):
    """AI Incident Database. 공개 API는 허가된 도메인만 받으므로(403 Invalid origin) 주간 스냅샷 CSV를 읽는다.

    준비: incidentdatabase.ai/research/snapshots 에서 받은 incidents.csv 경로를 PP_AIID_SNAPSHOT에 넣는다.
    범주 열이 없으므로 피드 전체 시계열만 만들고, 사건 범주 매핑(link.py)은 사건 제목으로 한다.
    """
    name = "aiid"
    layer = 1

    def fetch(self, query: dict) -> FetchResult:
        path = query.get("path") or self.env.get("PP_AIID_SNAPSHOT", "")
        if not path or not Path(path).exists():
            raise SourceUnavailable("AIID 스냅샷 파일 없음(PP_AIID_SNAPSHOT에 incidents.csv 경로)")
        text = Path(path).read_text(encoding="utf-8-sig")
        rows = list(csv.DictReader(io.StringIO(text)))
        if rows and not {"incident_id", "date", "title"} <= set(rows[0]):
            raise SourceError(f"aiid: 열 이름이 다름 {sorted(rows[0])[:8]}")
        items = []
        for r in rows:
            iid = (r.get("incident_id") or "").strip()
            if not iid:
                continue
            items.append(SignalItem(
                id=f"aiid:{iid}", layer=1, source=self.name, kind="incident", title=(r.get("title") or "")[:200],
                url=f"https://incidentdatabase.ai/cite/{iid}", published_at=(r.get("date") or "")[:10] or None,
                metrics={"categories": []}))
        return FetchResult(items=items, feed_categories="aiid")
