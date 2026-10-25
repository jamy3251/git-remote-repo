"""S6 준비: 단말에서 그대로 재현할 수 있는 방식으로 일상 데이터(K-EmoPhone)의 2Hz 특징을 다시 만든다.

s4는 scipy decimate(IIR 필터+양방향 필터링)로 8Hz→2Hz를 만들었는데, 이는 단말 Java로 똑같이 옮기기 어렵다.
여기서는 8Hz 격자 신호를 4개씩 평균(블록 평균)하여 2Hz로 만든다. 단말도 같은 계산을 한다:
  센서 원신호 → 8Hz 격자 선형 보간 → 4개 평균 → 2Hz → raw_feats(fs=2, orient=False)
60초 창마다 계산한 뒤 응답 직전 30분의 중앙값·사분위 범위로 요약하는 것은 s4와 같다.
출력: data/processed/kemophone_2hz_block.parquet
"""
import zipfile
from concurrent.futures import ProcessPoolExecutor

import numpy as np
import pandas as pd

import s1b_wesad as W
import s4_kemophone as S4

OUT = S4.ROOT / "data" / "processed" / "kemophone_2hz_block.parquet"


def block2(w):
    """8Hz (n,3) → 2Hz: 연속 4개 평균."""
    n = len(w) // 4 * 4
    return w[:n].reshape(-1, 4, 3).mean(axis=1)


def participant(pcode):
    z = zipfile.ZipFile(S4.RAW / f"{pcode}.zip")
    acc = pd.read_csv(z.open("Acceleration.csv")).sort_values("timestamp").drop_duplicates("timestamp")
    at, ax = acc.timestamp.to_numpy(np.float64), acc[["x", "y", "z"]].to_numpy()
    rows = []
    for _, e in S4.ESM[S4.ESM.pcode == pcode].iterrows():
        t1 = float(e.responseTime)
        t0 = t1 - S4.PRE_MIN * 60_000
        lo, hi = np.searchsorted(at, t0 - S4.GAP_MS), np.searchsorted(at, t1 + S4.GAP_MS)
        _, u = S4.uniform(at[lo:hi], ax[lo:hi], t0, t1)
        if np.mean(~np.isnan(u[:, 0])) < S4.MIN_COVER:
            continue
        per = []
        for s in range(S4.PRE_MIN):
            w = u[s * 60 * S4.FS:(s + 1) * 60 * S4.FS]
            if np.isnan(w).any():
                continue
            per.append(W.raw_feats(block2(w), 2, orient=False))
        if len(per) >= 5:
            r = {"pcode": pcode, "t": t1, "valence": e.valence, "arousal": e.arousal, "stress": e.stress,
                 "n_win": len(per)}
            r |= S4.summarize(per, "b2")
            rows.append(r)
    return rows


def main():
    codes = sorted(p.stem for p in S4.RAW.glob("P*.zip"))
    rows = []
    with ProcessPoolExecutor(max_workers=6) as ex:
        for pc, rs in zip(codes, ex.map(participant, codes)):
            rows += rs
    df = pd.DataFrame(rows)
    df.to_parquet(OUT)
    print(len(df), "responses,", df.pcode.nunique(), "users ->", OUT)


if __name__ == "__main__":
    main()
