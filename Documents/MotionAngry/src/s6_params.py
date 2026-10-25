"""S6: 일상 데이터(K-EmoPhone)에서 정서와 대응하는 움직임 파라미터를 찾고, 단말에 넣을 작은 모델을 정한다.

A. 파라미터별 단변량 관계 — 전체 AUROC(방향 무관)와 사람 안 상관(사용자 평균을 뺀 값끼리 스피어만), 사용자별 방향 일치율
B. 중첩 전진 선택 — 바깥 참가자 5겹(평가), 안쪽 참가자 3겹(선택). 선택에 쓴 사람은 평가에 쓰지 않으므로 선택 편향이 없다.
C. 개인 기준선 보정 — 각 사용자의 '이전 응답들'의 특징 평균·표준편차로 현재 특징을 표준화(과거만 사용 → 단말에서 그대로 계산 가능)
D. 모델 크기 — 트리 수·잎 수에 따른 LOSO AUROC와 평탄화 모델 크기
출력: results/s6_*.csv
"""
import warnings
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd
from scipy.stats import spearmanr
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import GroupKFold

warnings.filterwarnings("ignore")
ROOT = Path(__file__).resolve().parents[1]
RES = ROOT / "results"
TASKS = ("arousal", "valence", "stress")
SMALL = dict(n_estimators=100, learning_rate=0.05, num_leaves=7, min_child_samples=20, subsample=0.8,
             subsample_freq=1, colsample_bytree=1.0, class_weight="balanced", verbose=-1)


def load():
    d = pd.read_parquet(ROOT / "data" / "processed" / "kemophone_esm_features.parquet")
    d = d[d.n_win.notna()].sort_values(["pcode", "t"]).reset_index(drop=True)
    feats = [c for c in d if c.startswith("raw2_")] + [c for c in d if c.startswith("coarse_")]
    return d, feats


def fit_pred(tr, te, feats, y, params=SMALL):
    m = lgb.LGBMClassifier(**params, random_state=0).fit(tr[feats], y[tr.index])
    return m.predict_proba(te[feats])[:, 1], m


def loso_auc(d, feats, y, params=SMALL):
    p = np.zeros(len(d))
    for pc in d.pcode.unique():
        te = d.pcode == pc
        p[te.to_numpy()], _ = fit_pred(d[~te], d[te], feats, y, params)
    return roc_auc_score(y, p)


def univariate(d, feats):
    rows = []
    for task in TASKS:
        y = (d[task] > 0).astype(int)
        yc = d[task] - d.groupby("pcode")[task].transform("mean")
        for f in feats:
            x = d[f]
            auc = roc_auc_score(y, x)
            xc = x - d.groupby("pcode")[f].transform("mean")
            rho = spearmanr(xc, yc).statistic
            signs = []
            for _, g in d.groupby("pcode"):
                if g[task].nunique() > 1 and g[f].nunique() > 1 and len(g) >= 20:
                    signs.append(np.sign(spearmanr(g[f], g[task]).statistic))
            signs = np.array(signs)
            agree = (signs == np.sign(rho)).mean() if len(signs) else np.nan
            rows.append({"task": task, "feature": f, "auc_pooled": max(auc, 1 - auc),
                         "direction": "+" if auc >= 0.5 else "-", "rho_within": rho, "user_sign_agree": agree,
                         "n_users": len(signs)})
    return pd.DataFrame(rows)


def nested_forward(d, feats, task, kmax=5):
    y = (d[task] > 0).astype(int)
    outer = GroupKFold(5)
    out_rows, chosen = [], []
    p_by_k = {k: np.zeros(len(d)) for k in range(1, kmax + 1)}
    for fold, (tr_i, te_i) in enumerate(outer.split(d, y, d.pcode)):
        tr, te = d.iloc[tr_i], d.iloc[te_i]
        sel = []
        for k in range(1, kmax + 1):
            best, best_auc = None, -1
            for f in feats:
                if f in sel:
                    continue
                cand = sel + [f]
                pin = np.zeros(len(tr))
                for a, b in GroupKFold(3).split(tr, y[tr.index], tr.pcode):
                    pin[b], _ = fit_pred(tr.iloc[a], tr.iloc[b], cand, y)
                auc = roc_auc_score(y[tr.index], pin)
                if auc > best_auc:
                    best, best_auc = f, auc
            sel.append(best)
            p_by_k[k][te_i], _ = fit_pred(tr, te, sel, y)
            out_rows.append({"task": task, "fold": fold, "k": k, "added": best, "inner_auc": best_auc})
        chosen.append(sel)
    res = pd.DataFrame(out_rows)
    outer_auc = {k: roc_auc_score(y, p) for k, p in p_by_k.items()}
    return res, outer_auc


def personal_baseline(d, feats, min_prev=5):
    """각 사용자 안에서 시간순으로, 그 이전 응답들의 평균·표준편차로 표준화 (과거만 사용)."""
    z = pd.DataFrame(index=d.index)
    for f in feats:
        g = d.groupby("pcode")[f]
        mu = g.transform(lambda s: s.shift(1).expanding(min_prev).mean())
        sd = g.transform(lambda s: s.shift(1).expanding(min_prev).std())
        z[f + "_z"] = (d[f] - mu) / (sd + 1e-9)
    return z


def tree_bytes(model):
    """export_model.py와 같은 평탄화 형식의 대략 크기: 노드당 한 줄."""
    dump = model.booster_.dump_model()
    n = 0
    for t in dump["tree_info"]:
        stack = [t["tree_structure"]]
        while stack:
            s = stack.pop()
            n += 1
            if "left_child" in s:
                stack += [s["left_child"], s["right_child"]]
    return n * 32  # 노드 한 줄 약 32바이트(텍스트)


def main():
    d, feats = load()
    print(len(d), "responses,", d.pcode.nunique(), "users,", len(feats), "candidate parameters")

    uni = univariate(d, feats)
    uni.to_csv(RES / "s6_univariate.csv", index=False)
    for task in TASKS:
        print(f"\n[A] {task}: top parameters")
        print(uni[uni.task == task].sort_values("auc_pooled", ascending=False).head(6).round(3).to_string(index=False))

    sel_rows, auc_rows = [], []
    for task in TASKS:
        res, outer = nested_forward(d, feats, task)
        sel_rows.append(res)
        y = (d[task] > 0).astype(int)
        full = loso_auc(d, feats, y)
        inten = loso_auc(d, ["raw2_med_sec_std_mean"], y)
        auc_rows.append({"task": task, **{f"k{k}": v for k, v in outer.items()}, "all_params_loso": full,
                         "intensity_only_loso": inten})
        print(f"\n[B] {task}: outer AUROC by k", {k: round(v, 3) for k, v in outer.items()},
              "| all", round(full, 3), "| intensity", round(inten, 3))
        print(res.groupby("added").size().sort_values(ascending=False).head(8).to_string())
    pd.concat(sel_rows).to_csv(RES / "s6_selection.csv", index=False)
    pd.DataFrame(auc_rows).to_csv(RES / "s6_selection_auc.csv", index=False)

    # C. 개인 기준선 보정
    z = personal_baseline(d, feats)
    dz = pd.concat([d, z], axis=1)
    zf = list(z.columns)
    rows = []
    for task in TASKS:
        y = (d[task] > 0).astype(int)
        for name, fs in (("raw", feats), ("baseline_z", zf), ("raw+z", feats + zf)):
            rows.append({"task": task, "features": name, "loso_auc": loso_auc(dz, fs, y)})
            print("[C]", task, name, round(rows[-1]["loso_auc"], 3))
    pd.DataFrame(rows).to_csv(RES / "s6_baseline.csv", index=False)

    # D. 모델 크기 (각성, 전체 파라미터와 개인 보정 포함 세트)
    rows = []
    y = (d.arousal > 0).astype(int)
    for fs_name, fs in (("raw", feats), ("raw+z", feats + zf)):
        for nt in (10, 25, 50, 100, 200):
            for nl in (3, 7, 15):
                prm = dict(SMALL, n_estimators=nt, num_leaves=nl)
                auc = loso_auc(dz, fs, y, prm)
                m = lgb.LGBMClassifier(**prm, random_state=0).fit(dz[fs], y)
                rows.append({"features": fs_name, "trees": nt, "leaves": nl, "loso_auc": auc, "model_bytes": tree_bytes(m)})
        print("[D] done", fs_name)
    size = pd.DataFrame(rows)
    size.to_csv(RES / "s6_model_size.csv", index=False)
    print(size.round(3).to_string(index=False))


if __name__ == "__main__":
    main()
