"""L5 기술 성숙도 — 공개 진척 데이터(Epoch AI 벤치마크 허브).

벤치마크마다 '그 달까지 공개된 모델의 최고 점수'(SOTA) 월별 시계열을 만든다(denom none, 0~1).
점수 열·척도·만점(score_ceiling)·무작위 기준선은 zip에 든 benchmark_metadata.csv를 따른다. 값 범위로 척도를
추측하지 않는다(속도 배수·상금 같은 점수가 백분율로 오인됨) — 메타데이터에 없는 벤치마크는 건너뛴다.
항목 1개 = 벤치마크 1개: 현재 SOTA, 최근 12개월 개선폭, 만점까지 남은 폭('사람 수준'이 아니라 벤치마크 만점).
라이브 프로브·한계 문장은 LLM 단계라 여기 없다(link.py·프로브 러너). Papers with Code 아카이브(동결)는
과제 일치 규칙이 정해지면 붙인다.
"""
from __future__ import annotations

import csv
import io
import zipfile

from .sources import FetchResult, SeriesPoint, SignalItem, SignalSource, SourceError, last_full_month, register, shift_month

EPOCH_ZIP = "https://epoch.ai/data/benchmark_data.zip"
METADATA = "benchmark_metadata.csv"


def _float(v) -> float | None:
    try:
        return float(str(v).strip().rstrip("%"))
    except (TypeError, ValueError):
        return None


def sota_series(rows: list[dict], score_column: str, scale: float) -> dict[str, float]:
    """{YYYY-MM: 그 달까지 공개된 모델 최고 점수 × scale}. 공개일(Release date)·점수가 없는 행은 뺀다."""
    best_by_month: dict[str, float] = {}
    for r in rows:
        m, v = (r.get("Release date") or "").strip()[:7], _float(r.get(score_column))
        if len(m) == 7 and v is not None:
            best_by_month[m] = max(best_by_month.get(m, v * scale), v * scale)
    out, run = {}, None
    if not best_by_month:
        return out
    m, last = min(best_by_month), max(best_by_month)
    while m <= last:
        if m in best_by_month:
            run = best_by_month[m] if run is None else max(run, best_by_month[m])
        out[m] = run
        m = shift_month(m, 1)
    return out


@register
class EpochBenchmarks(SignalSource):
    name = "epoch_benchmarks"
    layer = 5

    def fetch(self, query: dict) -> FetchResult:
        r = self.request("GET", query.get("url") or EPOCH_ZIP)
        try:
            z = zipfile.ZipFile(io.BytesIO(r.content))
            meta = list(csv.DictReader(io.StringIO(z.read(METADATA).decode("utf-8", "replace"))))
        except (zipfile.BadZipFile, KeyError) as e:
            raise SourceError(f"epoch_benchmarks: zip 또는 {METADATA} 없음(형식 변경?)") from e
        names = set(z.namelist())
        end = last_full_month(self.today)
        items, series, latest = [], [], None     # latest = 가장 늦은 모델 공개일
        for b in meta:
            f, col, scale = b.get("source_file", ""), b.get("score_column", ""), _float(b.get("scale"))
            if f not in names or not col or not scale:
                continue
            rows = list(csv.DictReader(io.StringIO(z.read(f).decode("utf-8", "replace"))))
            sota = {m: v for m, v in sota_series(rows, col, scale).items() if m <= end}
            if not sota:
                continue
            bench = f[:-4]
            ceiling = _float(b.get("score_ceiling")) or 1.0
            series += [SeriesPoint(f"bench:{bench}", 5, "sota", m, round(v, 4), None, "none") for m, v in sota.items()]
            last_m = max(sota)
            now, ago = sota[last_m], sota.get(shift_month(last_m, -12))
            rd = max((x.get("Release date") or "")[:10] for x in rows if (x.get("Release date") or "")[:7] <= end)
            latest = max(latest or rd, rd)
            items.append(SignalItem(
                id=f"epoch_benchmarks:{bench}", layer=5, source=self.name, kind="sota", title=b.get("benchmark") or bench,
                url="https://epoch.ai/benchmarks", published_at=last_m + "-01",
                metrics={"sota": round(now, 4), "improvement_12m": None if ago is None else round(now - ago, 4),
                         "ceiling": ceiling, "remaining": round(max(0.0, ceiling - now), 4),
                         "random_baseline": _float(b.get("random_baseline")), "n_models": len(rows),
                         "superseded_by": b.get("superseded_by") or None,
                         "note": "만점까지 남은 폭(사람 수준 아님)"}))
        if not items:
            raise SourceError("epoch_benchmarks: 메타데이터와 맞는 벤치마크 0개(형식 변경?)")
        return FetchResult(items=items, series=series, latest_data_at=latest)
