"""L4 공적 권위 목록 — 판·연도·순위 스냅샷.

API가 없는 목록은 판이 나올 때 손으로 스냅샷을 만든다: painpointer/radar/lists/<list_id>.json
{list_id, name, edition, field, url, checked_at, entries:[{rank, title}]}. 출처 URL·판·확인일이 필수다.
추가 목록 폴더는 PP_RADAR_LISTS_DIR(같은 형식). 같은 list_id가 여러 판이면 checked_at이 가장 늦은 판이 현행 판.

공적 권위 축(링크 단계에서 계산) = 매핑된 토픽·능력을 언급하는 현행 판 목록 수.
지금 들어 있는 목록(2026-10-09 확인): OWASP Top 10:2025 · OWASP LLM Top 10 2025 · OWASP API Top 10 2023 ·
CWE Top 25 2025 · EU AI Act Annex III · NIST AI RMF 1.0. 나머지(MITRE ATT&CK·ATLAS·ENISA·NIST CSF·AI Index·
WCAG·3GPP·WEF·KISTEP 등)와 NTIS 과제는 아직 없다(절단 순서상 선택 목록·NTIS가 먼저 빠진다).
"""
from __future__ import annotations

import json
from pathlib import Path

from .sources import FetchResult, SignalItem, SignalSource, SourceError, register

LISTS_DIR = Path(__file__).with_name("lists")
REQUIRED = {"list_id", "name", "edition", "field", "url", "checked_at", "entries"}


def load_lists(dirs: list[Path]) -> list[dict]:
    docs = []
    for d in dirs:
        for p in sorted(Path(d).glob("*.json")):
            try:
                doc = json.loads(p.read_text(encoding="utf-8"))
            except ValueError as e:
                raise SourceError(f"official_lists: {p.name} JSON 오류") from e
            miss = REQUIRED - set(doc)
            if miss:
                raise SourceError(f"official_lists: {p.name}에 {sorted(miss)} 없음(출처·판·확인일 필수)")
            docs.append(doc)
    return docs


@register
class OfficialLists(SignalSource):
    name = "official_lists"
    layer = 4

    def fetch(self, query: dict) -> FetchResult:
        dirs = [Path(query.get("dir") or LISTS_DIR)]
        extra = self.env.get("PP_RADAR_LISTS_DIR", "")
        if extra and not query.get("dir"):
            dirs.append(Path(extra))
        docs = load_lists(dirs)
        if not docs:
            raise SourceError("official_lists: 목록 스냅샷 0개")
        current = {}
        for doc in docs:
            if doc["list_id"] not in current or doc["checked_at"] > current[doc["list_id"]]["checked_at"]:
                current[doc["list_id"]] = doc
        items = []
        for doc in docs:
            is_current = current[doc["list_id"]] is doc
            for e in doc["entries"]:
                items.append(SignalItem(
                    id=f"list:{doc['list_id']}:{doc['edition']}:{e['rank']}", layer=4, source=self.name,
                    kind="list_entry", title=e["title"], url=doc["url"], published_at=doc["checked_at"],
                    metrics={"list_id": doc["list_id"], "list_name": doc["name"], "edition": doc["edition"],
                             "field": doc["field"], "rank": e["rank"], "current": is_current}))
        return FetchResult(items=items, latest_data_at=max(d["checked_at"] for d in docs))
