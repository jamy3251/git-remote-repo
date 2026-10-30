"""공용 평가 프로토콜 (Phase 1.1). Phase 1·2·5가 모두 이 함수를 쓴다.

- user_auc(df): 사용자별 AUROC (평가 응답 ≥ min_n, 두 부류). NaN이면 제외.
- user_mean(df): 사용자별 AUROC 평균과 사용자 수.
- boot_ci_users(values_a, values_b=None, n=1000, seed=0): 참가자 부트스트랩 95% CI (평균 또는 쌍대 차이의 평균).
- wilcoxon_paired(a, b): 쌍대 Wilcoxon 부호순위 검정(양측) p값과 효과 크기 r = Z/sqrt(n).
- metrics(y, p): AUROC, AUPRC, MCC(0.5 임계), Brier, ECE(10구간).
"""
import numpy as np
import pandas as pd
from scipy import stats
from sklearn.metrics import average_precision_score, brier_score_loss, matthews_corrcoef, roc_auc_score


def safe_auc(y, p, min_n=1):
    y = np.asarray(y)
    p = np.asarray(p)
    ok = ~np.isnan(p)
    y, p = y[ok], p[ok]
    if len(y) < min_n or len(np.unique(y)) < 2 or np.ptp(p) == 0:
        return np.nan
    return roc_auc_score(y, p)


def user_auc(df, y="y", p="p", user="pcode", min_n=10):
    """사용자별 AUROC Series(index=user). 조건 미달은 NaN."""
    return df.groupby(user).apply(lambda g: safe_auc(g[y], g[p], min_n), include_groups=False)


def user_mean(df, y="y", p="p", user="pcode", min_n=10):
    ua = user_auc(df, y, p, user, min_n).dropna()
    return float(ua.mean()) if len(ua) else np.nan, int(len(ua))


def boot_ci_users(a, b=None, n=1000, seed=0, level=0.95):
    """참가자 부트스트랩: a(사용자별 값) 평균 또는 (a−b) 평균의 CI. a, b는 같은 index의 Series."""
    rng = np.random.default_rng(seed)
    if b is not None:
        both = pd.concat([a, b], axis=1).dropna()
        v = (both.iloc[:, 0] - both.iloc[:, 1]).to_numpy()
    else:
        v = pd.Series(a).dropna().to_numpy()
    if len(v) == 0:
        return np.nan, np.nan, np.nan
    idx = rng.integers(0, len(v), (n, len(v)))
    m = v[idx].mean(axis=1)
    q = (1 - level) / 2
    return float(v.mean()), float(np.quantile(m, q)), float(np.quantile(m, 1 - q))


def wilcoxon_paired(a, b):
    both = pd.concat([a, b], axis=1).dropna()
    d = (both.iloc[:, 0] - both.iloc[:, 1]).to_numpy()
    d = d[d != 0]
    if len(d) < 6:
        return np.nan, np.nan, len(d)
    res = stats.wilcoxon(d, alternative="two-sided", method="approx")
    n = len(d)
    # 효과 크기 r = Z/sqrt(n), Z는 p에서 역산(양측)
    z = stats.norm.isf(res.pvalue / 2)
    return float(res.pvalue), float(np.sign(d.mean()) * z / np.sqrt(n)), n


def ece(y, p, bins=10):
    y = np.asarray(y, float)
    p = np.asarray(p, float)
    edges = np.linspace(0, 1, bins + 1)
    e = 0.0
    for lo, hi in zip(edges[:-1], edges[1:]):
        m = (p >= lo) & (p < hi) if hi < 1 else (p >= lo) & (p <= hi)
        if m.any():
            e += m.mean() * abs(y[m].mean() - p[m].mean())
    return float(e)


def metrics(y, p):
    y = np.asarray(y)
    p = np.asarray(p, float)
    ok = ~np.isnan(p)
    y, p = y[ok], p[ok]
    out = {"n": int(len(y)), "auroc": safe_auc(y, p)}
    if len(np.unique(y)) == 2:
        out["auprc"] = float(average_precision_score(y, p))
        out["mcc"] = float(matthews_corrcoef(y, (p >= 0.5).astype(int)))
        out["brier"] = float(brier_score_loss(y, np.clip(p, 0, 1)))
        out["ece"] = ece(y, np.clip(p, 0, 1))
    else:
        out.update({"auprc": np.nan, "mcc": np.nan, "brier": np.nan, "ece": np.nan})
    return out
