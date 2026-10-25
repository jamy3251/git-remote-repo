"""S7: 사용자 데이터가 시간순으로 쌓일수록 단말 모델이 좋아지는가 (K-EmoPhone, 단말과 같은 2Hz 블록 특징).

설정은 단말 탑재 모델과 같다(50트리×잎3). 각 사용자를 '새 사용자'로 두고
  base  : 다른 사용자 전체로 학습한 출하 모델(LOSO) — 단말에 처음 깔린 상태
  own   : 그 사용자의 처음 k개 응답만으로 학습한 작은 모델(로지스틱, 자기 데이터로 표준화) — 단말에서 학습 가능한 수준
  blend : base와 own 확률의 평균
평가는 k번째 이후 응답(같은 집합)에서 base / own / blend를 비교한다. k = 0이면 base만 있다.
지표: 전체 AUROC(사용자 합침)와 사용자별 AUROC 평균(검증 구간에 두 부류가 다 있는 사용자만).
출력: results/s7_cumulative.csv, results/s7_log.txt
"""
import warnings
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score

warnings.filterwarnings("ignore")
ROOT = Path(__file__).resolve().parents[1]
RES = ROOT / "results"
TASKS = ("arousal", "valence")
KS = (0, 5, 10, 15, 20, 30)
DEPLOY = dict(n_estimators=50, learning_rate=0.05, num_leaves=3, min_child_samples=20, subsample=0.8,
              subsample_freq=1, class_weight="balanced", verbose=-1)
META = {"pcode", "t", "valence", "arousal", "stress", "n_win"}


def load():
    d = pd.read_parquet(ROOT / "data" / "processed" / "kemophone_2hz_block.parquet")
    d = d.sort_values(["pcode", "t"]).reset_index(drop=True)
    feats = [c for c in d if c not in META]
    d["rank"] = d.groupby("pcode").cumcount()
    return d, feats


def base_loso(d, feats, y):
    p = np.zeros(len(d))
    for pc in d.pcode.unique():
        te = (d.pcode == pc).to_numpy()
        m = lgb.LGBMClassifier(**DEPLOY, random_state=0).fit(d.loc[~te, feats], y[~te])
        p[te] = m.predict_proba(d.loc[te, feats])[:, 1]
    return p


def own_model(tr_x, tr_y, te_x):
    """자기 데이터 k개로만: 자기 평균·표준편차로 표준화한 뒤 L2 로지스틱. 단말에서 수 ms에 학습 가능한 크기."""
    if tr_y.nunique() < 2:
        return None
    mu, sd = tr_x.mean(), tr_x.std().replace(0, 1).fillna(1)
    m = LogisticRegression(C=0.1, class_weight="balanced", max_iter=500).fit((tr_x - mu) / sd, tr_y)
    return m.predict_proba((te_x - mu) / sd)[:, 1]


def safe_auc(y, p):
    return roc_auc_score(y, p) if y.nunique() == 2 and len(y) >= 5 else np.nan


def main():
    d, feats = load()
    log = [f"{len(d)} responses, {d.pcode.nunique()} users, {len(feats)} features, deploy={DEPLOY['n_estimators']}x{DEPLOY['num_leaves']}"]
    rows = []
    for task in TASKS:
        y = (d[task] > 0).astype(int)
        pb = base_loso(d, feats, y.to_numpy())
        d["_base"] = pb
        for k in KS:
            test_mask = d["rank"] >= k
            per_user = {"base": [], "own": [], "blend": []}
            pooled = {"base": [], "own": [], "blend": []}
            ys = []
            n_users = 0
            for pc, g in d[test_mask].groupby("pcode"):
                tr = d[(d.pcode == pc) & (d["rank"] < k)]
                po = own_model(tr[feats], y[tr.index], g[feats]) if k > 0 else None
                if k > 0 and po is None:
                    continue  # 처음 k개에 한 부류뿐 → 그 사용자는 이 k에서 제외(모든 방법 동일 집합)
                n_users += 1
                pbase = g["_base"].to_numpy()
                pown = po if po is not None else pbase
                pbl = (pbase + pown) / 2 if po is not None else pbase
                yg = y[g.index]
                ys.append(yg)
                for name, p in (("base", pbase), ("own", pown), ("blend", pbl)):
                    pooled[name].append(p)
                    per_user[name].append(safe_auc(yg, p))
            yy = pd.concat(ys)
            for name in ("base", "own", "blend"):
                pp = np.concatenate(pooled[name])
                pu = np.array(per_user[name], dtype=float)
                rows.append({"task": task, "k": k, "method": name, "n_users": n_users, "n_test": len(yy),
                             "auc_pooled": roc_auc_score(yy, pp), "auc_user_mean": np.nanmean(pu),
                             "n_users_scored": int(np.sum(~np.isnan(pu))),
                             "frac_users_improved_vs_base": np.nan if name == "base" else
                             float(np.nanmean(pu > np.array(per_user["base"], dtype=float)))})
            r = [x for x in rows if x["task"] == task and x["k"] == k]
            log.append(f"[{task}] k={k:2d} users={n_users} test={len(yy)} | " + " | ".join(
                f"{x['method']} pooled {x['auc_pooled']:.3f} user-mean {x['auc_user_mean']:.3f}" for x in r))
            print(log[-1])
    out = pd.DataFrame(rows)
    out.to_csv(RES / "s7_cumulative.csv", index=False)
    (RES / "s7_log.txt").write_text("\n".join(log) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
