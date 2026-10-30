"""Phase 5 (RQ6) 재식별 공격 강화 — 32개 움직임 요약 특징으로 '누구인가'를 맞히는 공격자를 더 강하게 한다.

설정(S11과 같은 분할): 각 사용자의 응답을 시간순으로 앞 60% 학습, 뒤 40% 검증. 우연 = 1/후보 수.
공격자: 로지스틱(S11 기준), kNN(k=5, 표준화), LightGBM(300×15), 그리고 창 시퀀스(연속 k=1·5·10개 창의 확률 평균 다수결).
후보 집합 크기: 77 → 20 → 10 (무작위 부분집합 20회 평균, 각 부분집합 안에서 학습·검증).
완화책: 특징 양자화(소수 1자리·정수 반올림 후 공격), 특징 수 축소(상위 8개만).
출력: results/privacy/reident.csv, reident_log.txt
사용: python experiments/privacy/reident.py [--seed 0] [--subsets 20]
"""
import argparse
import sys
import warnings
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.neighbors import KNeighborsClassifier
from sklearn.preprocessing import StandardScaler

ROOT = Path(__file__).resolve().parents[2]
RES = ROOT / "results" / "privacy"
RES.mkdir(parents=True, exist_ok=True)
warnings.filterwarnings("ignore")


def load():
    d = pd.read_parquet(ROOT / "data" / "processed" / "kemophone_2hz_block.parquet").sort_values(["pcode", "t"]).reset_index(drop=True)
    feats = [c for c in d.columns if c.startswith("b2_")]
    d["rank"] = d.groupby("pcode").cumcount()
    d["n"] = d.groupby("pcode")["t"].transform("size")
    d["train"] = d["rank"] < 0.6 * d["n"]
    return d, feats


def attack(d, feats, model, seed, votes=(1, 5, 10)):
    tr, te = d[d.train], d[~d.train]
    sc = StandardScaler().fit(tr[feats])
    Xtr, Xte = sc.transform(tr[feats]), sc.transform(te[feats])
    if model == "logistic":
        m = LogisticRegression(C=1.0, max_iter=3000)
    elif model == "knn":
        m = KNeighborsClassifier(n_neighbors=5)
    else:
        m = lgb.LGBMClassifier(n_estimators=300, learning_rate=0.05, num_leaves=15, verbose=-1, random_state=seed)
    m.fit(Xtr, tr.pcode)
    P = m.predict_proba(Xte)
    classes = np.array(m.classes_)
    y = te.pcode.to_numpy()
    out = {"top1": float((classes[P.argmax(1)] == y).mean()),
           "top5": float(np.mean([yy in classes[np.argsort(-p)[:5]] for p, yy in zip(P, y)]))}
    # 창 시퀀스 다수결: 같은 사용자의 연속 k창 확률 평균
    te2 = te.reset_index(drop=True)
    for k in votes:
        if k == 1:
            out[f"top1_vote{k}"] = out["top1"]
            continue
        hits, n = 0, 0
        for pc, idx in te2.groupby("pcode").indices.items():
            for s in range(0, len(idx) - k + 1, k):
                pm = P[idx[s:s + k]].mean(0)
                hits += int(classes[pm.argmax()] == pc)
                n += 1
        out[f"top1_vote{k}"] = hits / n if n else np.nan
        out[f"n_vote{k}"] = n
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--subsets", type=int, default=20)
    a = ap.parse_args()
    rng = np.random.default_rng(a.seed)
    d, feats = load()
    rows, log = [], []
    users = sorted(d.pcode.unique())
    # 1) 후보 77명, 공격자 3종, 완화책
    variants = {"raw32": (d, feats)}
    dq = d.copy(); dq[feats] = dq[feats].round(1); variants["quant_1dp"] = (dq, feats)
    dq0 = d.copy(); dq0[feats] = dq0[feats].round(0); variants["quant_0dp"] = (dq0, feats)
    # 상위 8개: 학습 구간에서 사용자 분산 비(F값) 큰 특징
    from sklearn.feature_selection import f_classif
    tr = d[d.train]
    F, _ = f_classif(tr[feats].fillna(0), tr.pcode)
    top8 = [f for _, f in sorted(zip(F, feats), reverse=True)[:8]]
    variants["top8"] = (d, top8)
    for vname, (dd, ff) in variants.items():
        for model in ("logistic", "knn", "lgbm"):
            r = attack(dd, ff, model, a.seed)
            rows.append({"candidates": len(users), "variant": vname, "model": model, "chance": 1 / len(users), **r,
                         "top1_over_chance": r["top1"] * len(users)})
            log.append(f"[77] {vname:9s} {model:8s} top1 {r['top1']:.3f} ({r['top1'] * len(users):.1f}x chance) top5 {r['top5']:.3f} vote5 {r.get('top1_vote5', np.nan):.3f} vote10 {r.get('top1_vote10', np.nan):.3f}")
            print(log[-1], flush=True)
    # 2) 후보 수 축소 20·10 (무작위 부분집합, 로지스틱·LightGBM)
    for k in (20, 10):
        for model in ("logistic", "lgbm"):
            acc = []
            for _ in range(a.subsets):
                sub = rng.choice(users, k, replace=False)
                r = attack(d[d.pcode.isin(sub)], feats, model, a.seed, votes=(1, 5, 10))
                acc.append(r)
            mean = {kk: float(np.nanmean([x.get(kk, np.nan) for x in acc])) for kk in ("top1", "top5", "top1_vote5", "top1_vote10")}
            rows.append({"candidates": k, "variant": "raw32", "model": model, "chance": 1 / k, **mean, "top1_over_chance": mean["top1"] * k,
                         "subsets": a.subsets})
            log.append(f"[{k}] raw32 {model:8s} top1 {mean['top1']:.3f} ({mean['top1'] * k:.1f}x chance) top5 {mean['top5']:.3f} vote5 {mean['top1_vote5']:.3f} vote10 {mean['top1_vote10']:.3f}")
            print(log[-1], flush=True)
    pd.DataFrame(rows).to_csv(RES / "reident.csv", index=False)
    (RES / "reident_log.txt").write_text("\n".join(log) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
