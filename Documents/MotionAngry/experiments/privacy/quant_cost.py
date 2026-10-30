"""Phase 5 백로그: 특징 양자화(재식별 완화책)의 정확도 비용. 기본 모델(LightGBM 50×3, LOSO)을 원값 / 소수 1자리 / 정수 반올림 특징으로 학습·평가.
출력: results/privacy/quant_cost.csv
"""
import sys
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT))
from experiments.common.eval import boot_ci_users, safe_auc, user_auc  # noqa: E402
from s7_cumulative import DEPLOY, load  # noqa: E402

RES = ROOT / "results" / "privacy"


def main():
    d, feats = load()
    rows = []
    for task in ("arousal", "valence"):
        y = (d[task] > 0).astype(int).to_numpy()
        ref = None
        for name, dec in (("raw32", None), ("quant_1dp", 1), ("quant_0dp", 0)):
            X = d[feats].to_numpy(float)
            if dec is not None:
                X = np.round(X, dec)
            p = np.zeros(len(d))
            for pc in d.pcode.unique():
                te = (d.pcode == pc).to_numpy()
                m = lgb.LGBMClassifier(**DEPLOY, random_state=0).fit(X[~te], y[~te])
                p[te] = m.predict_proba(X[te])[:, 1]
            df = pd.DataFrame({"pcode": d.pcode, "y": y, "p": p})
            ua = user_auc(df, "y", "p", min_n=20)
            if ref is None:
                ref = ua
            dm, lo, hi = boot_ci_users(ua, ref) if name != "raw32" else (np.nan, np.nan, np.nan)
            rows.append({"task": task, "features": name, "pooled_auc": safe_auc(y, p), "user_mean_auc": float(ua.mean()),
                         "n_users": int(ua.notna().sum()), "diff_vs_raw": dm, "ci_lo": lo, "ci_hi": hi})
            print(rows[-1], flush=True)
    pd.DataFrame(rows).to_csv(RES / "quant_cost.csv", index=False)


if __name__ == "__main__":
    main()
