"""S15: 선택 편향 실증 — 모델이 고른 순간(급변 질문 A)에서만 평가하면 점수가 어떻게 달라지는가.

설계 근거 검증: 본 시스템은 모델이 좋아졌는지를 무작위 시각(B) 응답으로만 잰다. 급변 때(A) 응답으로 재면
모델이 눈에 띄게 반응한 순간만 모이므로 점수가 실제(무작위 표본)와 달라질 것이라는 가정을 공개 데이터로 확인한다.

방법(K-EmoPhone 2Hz 블록 특징, 3,771건·77명):
  1) 기본 모델(DEPLOY, LOSO)의 out-of-fold 확률 p_t를 응답마다 구한다(각성·정서가).
  2) 사용자 안에서 시간순 연속 응답 간 |p_t − p_{t−1}| ≥ δ 인 응답을 "급변(A) 표본", 같은 수를 무작위로 뽑은 응답을 "무작위(B) 표본"으로 둔다.
     δ는 앱 규칙(0.25)과 함께 0.10·0.15·0.20도 본다(ESM 간격이 수 시간이라 확률 변화 분포가 앱의 1분 단위와 다름).
  3) A·B 표본에서 pooled AUROC, 사용자별 AUROC 평균(응답 20건 이상·두 부류 있는 사용자), 양성 비율, 확률의 극단성(|p−0.5| 평균)을 비교.
     B는 무작위 추출이라 200회 반복 평균. 사용자 부트스트랩(1,000회)으로 A−B 차이의 95% CI.
  4) k=30 누적 학습의 '개선폭'(blend − base, 사용자별 AUROC)을 A 표본과 B 표본에서 각각 재어, 평가 표본 선택이 개선폭 판단을 바꾸는지 본다.
출력: results/s15_selection_bias.csv, results/s15_selection_bias_log.txt
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score

sys.path.insert(0, str(Path(__file__).resolve().parent))
from s7_cumulative import load, base_loso, own_model  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
RES = ROOT / "results"
DELTAS = (0.10, 0.15, 0.20, 0.25)
import os
MIN_N = int(os.environ.get("S15_MIN_N", "20"))
NBOOT = 1000
NRAND = 200
rng = np.random.default_rng(0)


def user_mean_auc(df, ycol, pcol):
    out = {}
    for pc, g in df.groupby("pcode"):
        if len(g) >= MIN_N and g[ycol].nunique() == 2:
            out[pc] = roc_auc_score(g[ycol], g[pcol])
    return out


def pooled(df, ycol, pcol):
    return roc_auc_score(df[ycol], df[pcol]) if df[ycol].nunique() == 2 else np.nan


def summarize(df, ycol, pcol):
    um = user_mean_auc(df, ycol, pcol)
    return {"n": len(df), "pos_rate": float(df[ycol].mean()), "extremity": float((df[pcol] - 0.5).abs().mean()),
            "pooled": pooled(df, ycol, pcol), "user_mean": float(np.mean(list(um.values()))) if um else np.nan,
            "n_users": len(um), "per_user": um}


def random_like(d, a_mask):
    """A 표본과 사용자별 같은 수를 무작위로 뽑는다(A에 포함 여부와 무관, 각 사용자의 전체 응답에서)."""
    idx = []
    for pc, g in d.groupby("pcode"):
        n = int(a_mask[g.index].sum())
        if n > 0:
            idx.extend(rng.choice(g.index.to_numpy(), size=n, replace=False))
    return d.loc[idx]


def boot_diff(per_a, per_b_list):
    """사용자별 AUROC의 A − B(무작위 반복 평균) 차이를 사용자 부트스트랩."""
    users = sorted(set(per_a) & set.intersection(*[set(b) for b in per_b_list]))
    if len(users) < 5:
        return np.nan, np.nan, np.nan, len(users)
    a = np.array([per_a[u] for u in users])
    b = np.array([np.mean([pb[u] for pb in per_b_list]) for u in users])
    diff = a - b
    bs = [np.mean(diff[rng.integers(0, len(users), len(users))]) for _ in range(NBOOT)]
    return float(diff.mean()), float(np.percentile(bs, 2.5)), float(np.percentile(bs, 97.5)), len(users)


def main():
    d, feats = load()
    rows, log = [], []
    for task in ("arousal", "valence"):
        y = (d[task] > 0).astype(int)
        d["y"] = y.to_numpy()
        d["p"] = base_loso(d, feats, y.to_numpy())
        # 연속 응답 간 확률 변화(사용자 안, 시간순)
        d["dp"] = d.groupby("pcode")["p"].diff().abs()
        log.append(f"[{task}] |dp| quantiles: " + ", ".join(f"q{q}={d.dp.quantile(q):.3f}" for q in (0.5, 0.75, 0.9)))
        # k=30 blend 확률(누적 학습 개선폭 평가용)
        d["pbl"] = np.nan
        for pc, g in d.groupby("pcode"):
            tr = g[g["rank"] < 30]
            te = g[g["rank"] >= 30]
            if len(te) == 0:
                continue
            po = own_model(tr[feats], y[tr.index], te[feats])
            if po is None:
                continue
            d.loc[te.index, "pbl"] = (te["p"].to_numpy() + po) / 2
        for delta in DELTAS:
            a_mask = d["dp"] >= delta
            A = d[a_mask]
            if A.empty:
                continue
            sa = summarize(A, "y", "p")
            sb_list = [summarize(random_like(d, a_mask), "y", "p") for _ in range(NRAND)]
            sb = {k: float(np.nanmean([s[k] for s in sb_list])) for k in ("pos_rate", "extremity", "pooled", "user_mean")}
            diff, lo, hi, nu = boot_diff(sa["per_user"], [s["per_user"] for s in sb_list[:50]])
            row = {"task": task, "delta": delta, "n_A": sa["n"], "frac_A": sa["n"] / len(d),
                   "pos_rate_A": sa["pos_rate"], "pos_rate_B": sb["pos_rate"],
                   "extremity_A": sa["extremity"], "extremity_B": sb["extremity"],
                   "pooled_A": sa["pooled"], "pooled_B": sb["pooled"],
                   "user_mean_A": sa["user_mean"], "user_mean_B": sb["user_mean"],
                   "user_diff_A_minus_B": diff, "ci_lo": lo, "ci_hi": hi, "n_users_diff": nu}
            # k=30 개선폭(blend − base, 사용자별 평균)을 A·B 표본에서
            T = d[d["pbl"].notna()]
            TA = T[a_mask[T.index]]
            if len(TA):
                ua_b, ua_bl = user_mean_auc(TA, "y", "p"), user_mean_auc(TA, "y", "pbl")
                com = set(ua_b) & set(ua_bl)
                row["k30_gain_A"] = float(np.mean([ua_bl[u] - ua_b[u] for u in com])) if com else np.nan
                row["k30_users_A"] = len(com)
                gains = []
                for _ in range(50):
                    TB = random_like(T, a_mask[T.index])
                    ub_b, ub_bl = user_mean_auc(TB, "y", "p"), user_mean_auc(TB, "y", "pbl")
                    c2 = set(ub_b) & set(ub_bl)
                    if c2:
                        gains.append(np.mean([ub_bl[u] - ub_b[u] for u in c2]))
                row["k30_gain_B"] = float(np.mean(gains)) if gains else np.nan
            rows.append(row)
            log.append(f"[{task}] delta={delta:.2f} A n={sa['n']} ({sa['n']/len(d):.1%}) pos A/B={sa['pos_rate']:.3f}/{sb['pos_rate']:.3f} "
                       f"extremity A/B={sa['extremity']:.3f}/{sb['extremity']:.3f} pooled A/B={sa['pooled']:.3f}/{sb['pooled']:.3f} "
                       f"user-mean A/B={sa['user_mean']:.3f}/{sb['user_mean']:.3f} diff={diff:+.3f} [{lo:+.3f},{hi:+.3f}] users={nu} "
                       f"k30 gain A/B={row.get('k30_gain_A', np.nan):+.3f}/{row.get('k30_gain_B', np.nan):+.3f}")
            print(log[-1], flush=True)
    pd.DataFrame(rows).to_csv(RES / f"s15_selection_bias_min{MIN_N}.csv", index=False)
    (RES / f"s15_selection_bias_min{MIN_N}_log.txt").write_text("\n".join(log) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
