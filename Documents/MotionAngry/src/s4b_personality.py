"""S4b: 성격(Big Five)에 따라 손목 움직임 기반 정서 추정이 잘 되는 사람이 다른가.

s4_kemophone의 LOSO 확률로 사용자별 AUROC를 구하고, UserInfo의 Big Five·PSS·PHQ와 스피어만 상관을 본다.
"""
import zipfile

import numpy as np
import pandas as pd
from scipy.stats import spearmanr
from sklearn.metrics import roc_auc_score
import lightgbm as lgb

import s1b_wesad as W
from s4_kemophone import OUT, RAW, ROOT

TRAITS = ["openness", "conscientiousness", "neuroticism", "extraversion", "agreeableness", "PSS", "PHQ"]


def loso_probs(d, feats, y):
    probs = np.full(len(d), np.nan)
    for p in d.pcode.unique():
        te = (d.pcode == p).to_numpy()
        m = lgb.LGBMClassifier(**W.PARAMS, random_state=0).fit(d.loc[~te, feats], y[~te])
        probs[te] = m.predict_proba(d.loc[te, feats])[:, 1]
    return probs


def main():
    d = pd.read_parquet(OUT)
    d = d[d.n_win.notna()].reset_index(drop=True)
    info = pd.read_csv(zipfile.ZipFile(RAW / "SubjData.zip").open("UserInfo.csv")).set_index("pcode")
    cols = lambda p: [c for c in d if c.startswith(p)]
    res = []
    for task, feats in (("arousal", cols("raw2_")), ("valence", cols("raw2_")), ("stress", cols("raw8_"))):
        y = (d[task] > 0).astype(int)
        d["p"] = loso_probs(d, feats, y)
        users = {}
        for pc, g in d.groupby("pcode"):
            yy = y[g.index]
            if yy.nunique() == 2 and len(g) >= 20:
                users[pc] = roc_auc_score(yy, g.p)
        u = pd.Series(users, name="auroc")
        j = info.join(u, how="inner")
        for t in TRAITS:
            rho, p = spearmanr(j[t], j.auroc, nan_policy="omit")
            res.append({"task": task, "trait": t, "n": len(j), "rho": rho, "p": p})
    out = pd.DataFrame(res)
    out["p_bonf"] = (out.p * len(out)).clip(upper=1)
    out.to_csv(ROOT / "results" / "s4b_personality.csv", index=False)
    print(out.round(3).to_string())


if __name__ == "__main__":
    main()
