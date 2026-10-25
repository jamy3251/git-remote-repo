"""S1: 모션(활동 추론) 특징만으로 정서가/각성 이진 분류.

설정
- LOSO: 사용자 단위로 테스트 분리 (일반화 모델)
- PERS: 대상 사용자의 앞 50% 시간 구간을 학습에 추가 (개인화 보정)
비교: 다수클래스, 시간(hour/weekday), 모션, 폰잠금, 모션+잠금, 전체
"""
import json
import warnings
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.metrics import f1_score, roc_auc_score

warnings.filterwarnings("ignore")
ROOT = Path(__file__).resolve().parents[1]
df = pd.read_parquet(ROOT / "data" / "processed" / "pam_features.parquet")
df = df.drop_duplicates(["uid", "timestamp"]).reset_index(drop=True)
lock_cols = [c for c in df if c.startswith("lock")]
# 잠금 구간이 중복 기록된 경우가 있어 비율을 1로 자름
df[[c for c in lock_cols if c.endswith("_frac")]] = df[[c for c in lock_cols if c.endswith("_frac")]].clip(upper=1)

TASKS = {"valence": (df.valence > 0).astype(int), "arousal": (df.arousal >= 3).astype(int)}
MOTION = [c for c in df if c.startswith("act") and not c.endswith("n_samples")]
LOCK = lock_cols
TIME = ["hour", "weekday"]
SETS = {"time": TIME, "motion": MOTION, "lock": LOCK, "motion+lock": MOTION + LOCK, "all": MOTION + LOCK + TIME}
PARAMS = dict(n_estimators=200, learning_rate=0.05, num_leaves=15, min_child_samples=20,
              subsample=0.8, subsample_freq=1, colsample_bytree=0.8, class_weight="balanced", verbose=-1)


def evaluate(y_true, prob):
    pred = (prob >= 0.5).astype(int)
    return {"macro_f1": f1_score(y_true, pred, average="macro"), "auroc": roc_auc_score(y_true, prob)}


def split_masks(mode):
    for uid in df.uid.unique():
        target = (df.uid == uid).to_numpy()
        if mode == "loso":
            yield ~target, target
        else:
            t = df.timestamp.where(target)
            cut = t.quantile(0.5)
            first = target & (df.timestamp <= cut).to_numpy()
            yield ~target | first, target & ~first


def run(mode, feats, y):
    probs = np.full(len(df), np.nan)
    for tr, te in split_masks(mode):
        if te.sum() == 0:
            continue
        m = lgb.LGBMClassifier(**PARAMS, random_state=0)
        m.fit(df.loc[tr, feats], y[tr])
        probs[te] = m.predict_proba(df.loc[te, feats])[:, 1]
    ok = ~np.isnan(probs)
    return evaluate(y[ok], probs[ok]) | per_user(y, probs)


def per_user(y, probs):
    aucs = []
    for uid, idx in df.groupby("uid").groups.items():
        idx = np.array([i for i in idx if not np.isnan(probs[i])])
        if len(idx) >= 20 and y[idx].nunique() == 2:
            aucs.append(roc_auc_score(y[idx], probs[idx]))
    return {"user_auroc_median": float(np.median(aucs)), "n_users": len(aucs)}


def main():
    res = []
    for task, y in TASKS.items():
        y = y.reset_index(drop=True)
        maj = np.full(len(y), int(y.mean() >= 0.5))
        res.append({"task": task, "mode": "-", "features": "majority",
                    "macro_f1": f1_score(y, maj, average="macro"), "auroc": 0.5, "pos_rate": y.mean()})
        for mode in ("loso", "pers"):
            for name, feats in SETS.items():
                r = run(mode, feats, y)
                res.append({"task": task, "mode": mode, "features": name, **r})
                print(task, mode, name, {k: round(v, 3) for k, v in r.items()})
    out = pd.DataFrame(res)
    (ROOT / "results").mkdir(exist_ok=True)
    out.to_csv(ROOT / "results" / "s1_affect.csv", index=False)
    print(out.round(3).to_string())


if __name__ == "__main__":
    main()
