"""Phase 6 검정력 분석 — 현장 연구 참가자 수.

효과 크기의 출처: 루프 시뮬레이터(p=0.8, d=0.5, b=0, seed 0~2)의 사용자별 within-user AUROC 쌍대 차이(학생−기본, 가드−기본)의 표준편차.
질문: 하루 3회 무작위 질문 B를 4주(약 84건, 응답률 70% → ~59건) 모을 때, 사용자별 AUROC 차이 δ ∈ {0.03, 0.05, 0.10}을
      쌍대 검정(양측 α=0.05)으로 검정력 0.8·0.9로 검출하기 위한 참가자 수. 정규 근사 n = ((z_{1-α/2}+z_{power})·σ_d/δ)^2,
      Wilcoxon은 정규 대비 점근 효율 3/π ≈ 0.955 → n/0.955.
또한 시뮬레이터 평가 응답 수(~20건/사용자)보다 4주 현장(~59건)에서는 사용자별 AUROC의 표본 분산이 줄어 σ_d가 작아질 것이므로,
σ_d를 응답 수에 비례해 축소한 보정값(σ_d·sqrt(n_sim/n_field))도 함께 보고한다.
출력: results/field/power.csv, power_log.txt
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import norm

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from experiments.common.eval import user_auc  # noqa: E402

RES = ROOT / "results" / "field"
RES.mkdir(parents=True, exist_ok=True)
N_FIELD = 3 * 28 * 0.7


def main():
    files = sorted((ROOT / "results" / "loop_sim").glob("preds_p0.8_d0.5_b0.0_s*.parquet"))
    allp = pd.concat([pd.read_parquet(f) for f in files])
    ev = allp[allp["eval"]]
    rows, log = [], []
    for task in ("arousal", "valence"):
        for cond in ("student", "guard", "student_a0.3"):
            sds, n_eval = [], []
            for seed, g in ev[ev.task == task].groupby("seed"):
                ua = user_auc(g, "y", cond, min_n=10)
                ub = user_auc(g, "y", "base", min_n=10)
                d = (ua - ub).dropna()
                sds.append(d.std(ddof=1))
                n_eval.append(g.groupby("pcode").size().median())
            sd = float(np.mean(sds))
            n_sim = float(np.median(n_eval))
            sd_field = sd * np.sqrt(n_sim / N_FIELD)
            for delta in (0.03, 0.05, 0.10):
                for power in (0.8, 0.9):
                    z = norm.ppf(0.975) + norm.ppf(power)
                    n_raw = (z * sd / delta) ** 2
                    n_adj = (z * sd_field / delta) ** 2
                    rows.append({"task": task, "cond": cond, "sd_diff_sim": sd, "n_eval_sim_median": n_sim, "sd_diff_field_adj": sd_field,
                                 "delta": delta, "power": power, "n_paired_t": int(np.ceil(n_raw)), "n_wilcoxon": int(np.ceil(n_raw / 0.955)),
                                 "n_paired_t_fieldadj": int(np.ceil(n_adj)), "n_wilcoxon_fieldadj": int(np.ceil(n_adj / 0.955))})
            log.append(f"[{task}] {cond}: σ_d(sim, ~{n_sim:.0f} eval/user) = {sd:.3f}; field-adjusted (~{N_FIELD:.0f} responses) = {sd_field:.3f}")
            print(log[-1])
    df = pd.DataFrame(rows)
    df.to_csv(RES / "power.csv", index=False)
    pd.set_option("display.width", 200)
    print(df[(df.power == 0.8)][["task", "cond", "delta", "n_wilcoxon", "n_wilcoxon_fieldadj"]].to_string(index=False))
    (RES / "power_log.txt").write_text("\n".join(log) + "\n" + df.to_string(index=False) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
