"""S18: 개인화 베이스라인 공정 비교 — 움직임 모델이 사소한 개인 사전확률·최근성·시각 베이스라인을 넘는가.

리뷰어 지적(M6): "설문 누적으로 개인화가 안 된다"가 32차원 개인 로지스틱의 과적합 때문인지 라벨의 한계인지 구분되지 않고,
움직임 모델이 개인 사전확률 같은 베이스라인을 넘는지도 보인 적이 없다.
설정: K-EmoPhone 2Hz 블록 특징, 기본 모델(LOSO 50×3) OOF 확률 p. 각 사용자의 처음 k개 응답(k=10·20·30)을 '개인 자료'로 쓰고
k번째 이후 응답에서 평가. 방법:
  base      기본 모델 확률 그대로
  prior     처음 k개의 평균 라벨(상수; 사용자 안 AUROC 정의 불가)
  carry     직전 응답 라벨을 점수로(최근성)
  hour      시각(sin·cos)만으로 개인 로지스틱
  offset    base + (평균 라벨 − 평균 확률) (S16)
  feat1     저크 평균 중앙값 1개로 개인 로지스틱
  own32     32특징 개인 로지스틱(S7 own)
  blend     (base + own32)/2 (S7 blend)
  base+hour base 확률과 시각을 넣은 개인 로지스틱
지표: 전체 AUROC, 사용자별 AUROC 평균(평가 응답 20건 이상·두 부류). 사용자별 차이(방법 − base)는 참가자 부트스트랩 500회 95% CI.
출력: results/s18_baselines.csv, results/S18 노트는 별도 작성.
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score

sys.path.insert(0, str(Path(__file__).resolve().parent))
from s7_cumulative import load, base_loso, own_model  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
RES = ROOT / "results"
KS = (10, 20, 30)
MIN_N = 20
NBOOT = 500
rng = np.random.default_rng(0)
FEAT1 = "b2_med_jerk_mean"


def logit(xtr, ytr, xte):
    if len(np.unique(ytr)) < 2:
        return None
    mu, sd = xtr.mean(0), xtr.std(0)
    sd[sd == 0] = 1
    m = LogisticRegression(C=0.1, class_weight="balanced", max_iter=500).fit((xtr - mu) / sd, ytr)
    return m.predict_proba((xte - mu) / sd)[:, 1]


def main():
    d, feats = load()
    hour = pd.to_datetime(d["t"], unit="ms", utc=True).dt.tz_convert("Asia/Seoul").dt.hour.to_numpy()
    d["hs"], d["hc"] = np.sin(2 * np.pi * hour / 24), np.cos(2 * np.pi * hour / 24)
    rows = []
    for task in ("arousal", "valence"):
        y = (d[task] > 0).astype(int)
        d["p"] = base_loso(d, feats, y.to_numpy())
        for k in KS:
            per = {}
            pooled = {}
            ys = []
            for pc, g in d.groupby("pcode"):
                tr, te = g[g["rank"] < k], g[g["rank"] >= k]
                if len(te) == 0 or y[tr.index].nunique() < 2:
                    continue
                ytr, yte = y[tr.index].to_numpy(), y[te.index]
                pb = te["p"].to_numpy()
                scores = {"base": pb}
                scores["prior"] = np.full(len(te), ytr.mean())
                prev = np.concatenate([[ytr[-1]], yte.to_numpy()[:-1]])
                scores["carry"] = prev.astype(float)
                scores["hour"] = logit(tr[["hs", "hc"]].to_numpy(), ytr, te[["hs", "hc"]].to_numpy())
                scores["offset"] = np.clip(pb + (ytr.mean() - tr["p"].mean()), 0, 1)
                scores["feat1"] = logit(tr[[FEAT1]].to_numpy(), ytr, te[[FEAT1]].to_numpy())
                po = own_model(tr[feats], y[tr.index], te[feats])
                scores["own32"] = po
                scores["blend"] = (pb + po) / 2 if po is not None else None
                scores["base+hour"] = logit(tr[["p", "hs", "hc"]].to_numpy(), ytr, te[["p", "hs", "hc"]].to_numpy())
                ys.append(yte)
                for name, sc in scores.items():
                    if sc is None:
                        sc = np.full(len(te), np.nan)
                    pooled.setdefault(name, []).append(sc)
                    ok = len(yte) >= MIN_N and yte.nunique() == 2 and not np.isnan(sc).any() and np.ptp(sc) > 0
                    per.setdefault(name, {})[pc] = roc_auc_score(yte, sc) if ok else np.nan
            yy = pd.concat(ys).to_numpy()
            base_per = per["base"]
            for name in pooled:
                pp = np.concatenate(pooled[name])
                m = ~np.isnan(pp)
                pooled_auc = roc_auc_score(yy[m], pp[m]) if m.sum() > 0 and len(np.unique(yy[m])) == 2 else np.nan
                vals = np.array([v for v in per[name].values() if not np.isnan(v)])
                users = [u for u in per[name] if not np.isnan(per[name][u]) and not np.isnan(base_per.get(u, np.nan))]
                diff = np.array([per[name][u] - base_per[u] for u in users])
                if len(users) >= 5 and name != "base":
                    bs = [diff[rng.integers(0, len(users), len(users))].mean() for _ in range(NBOOT)]
                    lo, hi = np.percentile(bs, [2.5, 97.5])
                else:
                    lo = hi = np.nan
                rows.append({"task": task, "k": k, "method": name, "pooled": pooled_auc,
                             "user_mean": float(vals.mean()) if len(vals) else np.nan, "n_users": len(vals),
                             "diff_vs_base": float(diff.mean()) if len(users) else np.nan, "ci_lo": lo, "ci_hi": hi})
            line = f"[{task}] k={k} " + " | ".join(
                f"{r['method']} {r['pooled']:.3f}/{r['user_mean']:.3f}" for r in rows if r["task"] == task and r["k"] == k)
            print(line, flush=True)
    pd.DataFrame(rows).to_csv(RES / "s18_baselines.csv", index=False)


if __name__ == "__main__":
    main()
