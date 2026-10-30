"""Phase 2.1 준비: 자기 학습 루프 시뮬레이터용 분 단위 데이터.

각 ESM 응답(기본 모델과 같은 응답 집합: 직전 30분 커버리지 ≥50%, 완전한 1분 창 ≥5개)에 대해
응답 직전 60분의 1분 특징 16개(s6_build_2hz와 동일: 8Hz 격자 보간 → 4개 평균 2Hz → raw_feats)를 만들고,
단말이 매 분 계산하는 '직전 30분 요약 32개'(중앙값·IQR)를 응답 전 1~30분째 각 분에 대해 만든다.
  offset m 의 요약 = 응답 전 m..m+29분째 1분 특징들의 중앙값·IQR (완전한 분 ≥5개일 때만)
  offset 1 의 요약 = kemophone_2hz_block.parquet 의 b2_* 와 같아야 한다(일치 검사 출력).
출력: data/processed/loop_minutes.parquet   (pcode, t, offset[1..60], 16 특징)
      data/processed/loop_summaries.parquet (pcode, t, offset[1..30], n_win, b2_* 32 특징)
사용: python experiments/loop_sim/build_minutes.py [--workers N]
"""
import argparse
import sys
import zipfile
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src"))
import s4_kemophone as S4  # noqa: E402
import s1b_wesad as W  # noqa: E402
from s6_build_2hz import block2  # noqa: E402

PRE = 60
WIN = 30
MIN_WIN = 5
OUT_MIN = ROOT / "data" / "processed" / "loop_minutes.parquet"
OUT_SUM = ROOT / "data" / "processed" / "loop_summaries.parquet"


def participant(pcode):
    z = zipfile.ZipFile(S4.RAW / f"{pcode}.zip")
    acc = pd.read_csv(z.open("Acceleration.csv")).sort_values("timestamp").drop_duplicates("timestamp")
    at, ax = acc.timestamp.to_numpy(np.float64), acc[["x", "y", "z"]].to_numpy()
    rows = []
    for _, e in S4.ESM[S4.ESM.pcode == pcode].iterrows():
        t1 = float(e.responseTime)
        t0 = t1 - PRE * 60_000
        lo, hi = np.searchsorted(at, t0 - S4.GAP_MS), np.searchsorted(at, t1 + S4.GAP_MS)
        _, u = S4.uniform(at[lo:hi], ax[lo:hi], t0, t1)
        last30 = u[(PRE - WIN) * 60 * S4.FS:]
        if np.mean(~np.isnan(last30[:, 0])) < S4.MIN_COVER:
            continue
        per = {}
        for s in range(PRE):
            w = u[s * 60 * S4.FS:(s + 1) * 60 * S4.FS]
            if np.isnan(w).any():
                continue
            per[PRE - s] = W.raw_feats(block2(w), 2, orient=False)
        if sum(1 for m in per if m <= WIN) < MIN_WIN:
            continue
        for m, f in per.items():
            rows.append({"pcode": pcode, "t": t1, "offset": m, **f})
    return rows


def summaries(mins):
    feats = [c for c in mins.columns if c not in ("pcode", "t", "offset")]
    out = []
    for (pc, t), g in mins.groupby(["pcode", "t"], sort=False):
        g = g.set_index("offset")
        for m in range(1, WIN + 1):
            sel = g.loc[(g.index >= m) & (g.index <= m + WIN - 1), feats]
            if len(sel) < MIN_WIN:
                continue
            med = sel.median().add_prefix("b2_med_")
            iqr = (sel.quantile(0.75) - sel.quantile(0.25)).add_prefix("b2_iqr_")
            out.append({"pcode": pc, "t": t, "offset": m, "n_win": len(sel), **med.to_dict(), **iqr.to_dict()})
    return pd.DataFrame(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--workers", type=int, default=12)
    ap.add_argument("--resume", action="store_true")
    a = ap.parse_args()
    if a.resume and OUT_MIN.exists():
        mins = pd.read_parquet(OUT_MIN)
    else:
        codes = sorted(p.stem for p in S4.RAW.glob("P*.zip"))
        rows = []
        with ProcessPoolExecutor(max_workers=a.workers) as ex:
            for pc, rs in zip(codes, ex.map(participant, codes)):
                rows += rs
                print(pc, len(rs), flush=True)
        mins = pd.DataFrame(rows)
        mins.to_parquet(OUT_MIN)
    print("minutes", mins.shape, "esm", mins.groupby(["pcode", "t"]).ngroups, flush=True)
    summ = summaries(mins)
    summ.to_parquet(OUT_SUM)
    print("summaries", summ.shape, flush=True)
    # 일치 검사: offset 1 요약 vs 기본 모델 입력
    blk = pd.read_parquet(ROOT / "data" / "processed" / "kemophone_2hz_block.parquet")
    s1 = summ[summ.offset == 1].merge(blk[["pcode", "t"]], on=["pcode", "t"])
    both = s1.merge(blk, on=["pcode", "t"], suffixes=("", "_blk"))
    feats = [c for c in blk.columns if c.startswith("b2_")]
    diff = max(np.nanmax(np.abs(both[f].to_numpy() - both[f + "_blk"].to_numpy())) for f in feats)
    print(f"offset-1 summaries matched {len(both)}/{len(blk)} block rows; max |diff| = {diff:.2e}", flush=True)


if __name__ == "__main__":
    main()
