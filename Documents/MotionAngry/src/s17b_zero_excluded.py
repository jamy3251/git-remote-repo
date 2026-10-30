"""S17b: 응답 0(중립)을 제외한 이진화 — 리뷰어 지적(M4): 0 응답이 각성 16%, 정서가 22%인데 전부 음성으로 넣었다.
0을 제외하고(양성 >0, 음성 <0) 기본 모델을 다시 LOSO 학습·평가하여 전체·사용자별 AUROC를 0-포함 기준과 비교한다.
출력: results/s17b_zero_excluded.csv
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score

sys.path.insert(0, str(Path(__file__).resolve().parent))
from s7_cumulative import load, base_loso  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
RES = ROOT / "results"
MIN_N = 20


def user_mean(d, y, p):
    vals = []
    for pc, g in d.groupby("pcode"):
        yy, pp = y[g.index], p[g.index]
        if len(yy) >= MIN_N and yy.nunique() == 2:
            vals.append(roc_auc_score(yy, pp))
    return float(np.mean(vals)), len(vals)


def main():
    d, feats = load()
    rows = []
    for task in ("arousal", "valence"):
        x = d[task]
        zero = float((x == 0).mean())
        keep = x != 0
        dz = d[keep].reset_index(drop=True)
        yz = (x[keep] > 0).astype(int).reset_index(drop=True)
        pz = pd.Series(base_loso(dz, feats, yz.to_numpy()), index=dz.index)
        um, nu = user_mean(dz, yz, pz)
        rows.append({"task": task, "zero_frac": zero, "n": len(dz), "pooled": roc_auc_score(yz, pz), "user_mean": um, "n_users": nu,
                     "pos_rate": float(yz.mean())})
        print(f"[{task}] zero={zero:.3f} n={len(dz)} pooled={rows[-1]['pooled']:.3f} user-mean={um:.3f} users={nu} pos={rows[-1]['pos_rate']:.2f}", flush=True)
    pd.DataFrame(rows).to_csv(RES / "s17b_zero_excluded.csv", index=False)


if __name__ == "__main__":
    main()
