"""재현: '저크와 각성의 양의 관계가 사용자 87.5%에서 동일' (S6_NOTES, s6_univariate_block.csv; 생성 코드 없음 → 여기서 재계산).
각 사용자(응답 ≥10)에서 b2_med_jerk_mean 과 각성 라벨(>0)의 스피어만 ρ 부호가 전체 방향(+)과 같은 비율."""
from pathlib import Path
import numpy as np, pandas as pd
from scipy.stats import spearmanr
from sklearn.metrics import roc_auc_score
d = pd.read_parquet(Path(__file__).resolve().parents[2] / "data/processed/kemophone_2hz_block.parquet")
f = "b2_med_jerk_mean"
y = (d.arousal > 0).astype(int)
print("pooled AUROC", round(roc_auc_score(y, d[f]), 3))
signs = []
for pc, g in d.groupby("pcode"):
    if len(g) >= 10 and g.arousal.nunique() > 1:
        r = spearmanr(g[f], g.arousal).statistic
        if not np.isnan(r): signs.append(np.sign(r))
signs = np.array(signs)
print(f"users={len(signs)} agree(+)={np.mean(signs > 0):.3f}")
# 사용자 평균을 뺀 값끼리의 사람 안 상관
dm = d.copy(); dm[f] -= dm.groupby("pcode")[f].transform("mean"); dm["a"] = dm.arousal - dm.groupby("pcode").arousal.transform("mean")
print("rho_within", round(spearmanr(dm[f], dm["a"]).statistic, 3))
