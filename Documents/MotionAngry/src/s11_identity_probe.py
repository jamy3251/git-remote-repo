"""S11 (side probe, 논문 외): 움직임·정서 패턴이 '사람을 식별하는 ID'가 될 수 있는가.

K-EmoPhone 2Hz 블록 특징(3,771 응답창 × 77명)으로
  A. 신원 식별: 30분 움직임 요약 32개 → 누구인가 (77-way). 시간순 분할(각 사용자 앞 60% 학습, 뒤 40% 검증).
     우연 = 1/77 = 1.3%. top-1·top-5 정확도, 창을 k개 묶었을 때(다수결)의 정확도.
  B. 정서 서명: 사용자별 '각성 ~ 움직임' 대응(파라미터별 스피어만 ρ 벡터)이 사람마다 얼마나 다른가.
     앞 60% 응답으로 만든 서명 벡터와 뒤 40%로 만든 서명 벡터를 짝지어, 같은 사람끼리의 거리 vs 다른 사람과의 거리로
     식별 정확도(가장 가까운 서명 = 본인?)를 잰다.
  C. 정서를 '빼고' 남는 움직임 서명(정서 응답 없이도 되는가): A와 같되 특징에서 사용자 평균을 빼지 않은 원값 그대로 — A가 이미 그것.
     보너스: 사용자 평균 제거 후(개인차 제거) 식별 정확도 → 식별 정보가 '평균 수준'에 있는지 '패턴'에 있는지.
출력: results/s11_identity.csv, results/S11_NOTES.md 에 요약.
"""
import warnings
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd
from scipy.stats import spearmanr
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

warnings.filterwarnings("ignore")
ROOT = Path(__file__).resolve().parents[1]
RES = ROOT / "results"
META = {"pcode", "t", "valence", "arousal", "stress", "n_win"}


def load():
    d = pd.read_parquet(ROOT / "data" / "processed" / "kemophone_2hz_block.parquet")
    d = d.sort_values(["pcode", "t"]).reset_index(drop=True)
    feats = [c for c in d if c not in META]
    d["rank"] = d.groupby("pcode").cumcount()
    d["n"] = d.groupby("pcode")["t"].transform("size")
    d["train"] = d["rank"] < 0.6 * d["n"]
    return d, feats


def topk(proba, classes, y, k):
    idx = np.argsort(-proba, axis=1)[:, :k]
    hit = [y[i] in classes[idx[i]] for i in range(len(y))]
    return float(np.mean(hit))


def identify(d, feats, label, demean=False):
    X = d[feats].to_numpy().astype(float)
    if demean:
        # 누출 방지: 사용자별 평균·표준편차를 학습 창(앞 60%)에서만 계산해 전체에 적용
        trn = d[d["train"]]
        mu = trn.groupby("pcode")[feats].mean()
        sd = trn.groupby("pcode")[feats].std()
        mu = mu.reindex(d["pcode"]).to_numpy()
        sd = sd.reindex(d["pcode"]).to_numpy()
        X = (X - mu) / (sd + 1e-9)
    tr, te = d["train"].to_numpy(), ~d["train"].to_numpy()
    y = d["pcode"].to_numpy()
    sc = StandardScaler().fit(X[tr])
    rows = []
    for name, model in (("logistic", LogisticRegression(C=1.0, max_iter=2000)),
                        ("lgbm", lgb.LGBMClassifier(n_estimators=300, learning_rate=0.05, num_leaves=15,
                                                    min_child_samples=5, verbose=-1, random_state=0))):
        model.fit(sc.transform(X[tr]), y[tr])
        p = model.predict_proba(sc.transform(X[te]))
        cls = model.classes_
        r = {"setting": label, "model": name, "n_test": int(te.sum()), "top1": topk(p, cls, y[te], 1),
             "top5": topk(p, cls, y[te], 5)}
        # 창 k개 다수결(같은 사용자의 검증 창을 시간순으로 k개씩 묶어 확률 평균)
        te_df = d[te].copy()
        te_df["_i"] = np.arange(te.sum())
        for k in (5, 10):
            hits = []
            for pc, g in te_df.groupby("pcode"):
                ii = g["_i"].to_numpy()
                for s in range(0, len(ii) - k + 1, k):
                    pm = p[ii[s:s + k]].mean(axis=0)
                    hits.append(cls[np.argmax(pm)] == pc)
            r[f"top1_vote{k}"] = float(np.mean(hits)) if hits else np.nan
            r[f"n_vote{k}"] = len(hits)
        rows.append(r)
        print(r)
    return rows


def affect_signature(d, feats):
    """사용자별 '각성 ~ 특징' 스피어만 ρ 벡터(32차원)를 앞/뒤 분할로 각각 만들어, 뒤 서명이 앞 서명 중 본인과 가장 가까운가."""
    sig = {}
    for pc, g in d.groupby("pcode"):
        for part, gg in (("a", g[g["train"]]), ("b", g[~g["train"]])):
            if gg["arousal"].nunique() < 2 or len(gg) < 10:
                continue
            v = []
            for f in feats:
                v.append(spearmanr(gg[f], gg["arousal"]).statistic if gg[f].nunique() > 1 else 0.0)
            sig[(pc, part)] = np.nan_to_num(np.array(v))
    users = sorted({pc for pc, part in sig if (pc, "a") in sig and (pc, "b") in sig})
    A = np.stack([sig[(u, "a")] for u in users])
    B = np.stack([sig[(u, "b")] for u in users])
    # 코사인 거리
    An = A / (np.linalg.norm(A, axis=1, keepdims=True) + 1e-9)
    Bn = B / (np.linalg.norm(B, axis=1, keepdims=True) + 1e-9)
    S = Bn @ An.T
    top1 = float(np.mean(np.argmax(S, axis=1) == np.arange(len(users))))
    rank = [int(np.sum(S[i] > S[i, i])) + 1 for i in range(len(users))]
    # 서명이 사람마다 얼마나 비슷한가: 같은 사람 a-b 유사도 vs 다른 사람 평균 유사도
    same = np.mean(np.diag(S))
    other = np.mean((S.sum(axis=1) - np.diag(S)) / (len(users) - 1))
    r = {"setting": "affect_signature(rho vector, cosine)", "model": "nearest", "n_test": len(users), "top1": top1,
         "top5": float(np.mean(np.array(rank) <= 5)), "same_sim": float(same), "other_sim": float(other),
         "median_rank": float(np.median(rank))}
    print(r)
    return [r]


def main():
    d, feats = load()
    print(len(d), "windows,", d.pcode.nunique(), "users, chance top1 =", round(1 / d.pcode.nunique(), 4))
    rows = []
    rows += identify(d, feats, "raw features (level + pattern)")
    # 주의: 사용자별 통계로 검증 창을 정규화하는 변형은 식별 과제에서 라벨 누출(정답 사용자의 통계 사용) → 제외(2026-10-24 확인: 트리 87%는 누출 산물)
    # 라벨 순열 대조: 사용자 라벨을 섞으면 우연 수준이어야 함
    dz = d.copy(); rng = np.random.default_rng(0); dz["pcode"] = rng.permutation(dz["pcode"].to_numpy()); dz = dz.sort_values(["pcode","t"]).reset_index(drop=True); dz["rank"]=dz.groupby("pcode").cumcount(); dz["n"]=dz.groupby("pcode")["t"].transform("size"); dz["train"]=dz["rank"]<0.6*dz["n"]
    rows += identify(dz, feats, "label-shuffled control (raw)")
    rows += affect_signature(d, feats)
    pd.DataFrame(rows).to_csv(RES / "s11_identity.csv", index=False)


if __name__ == "__main__":
    main()
