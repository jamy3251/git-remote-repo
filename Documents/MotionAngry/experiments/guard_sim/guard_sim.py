"""Phase 2.5 (RQ3) 성능 가드 베르누이 시뮬레이션. 실제 데이터 없이 가드 규칙만 비교한다.

설정(docs/PREREG.md RQ3): 기본(출하) 모델 정답률 q0 ∈ {0.55, 0.60, 0.65}, 학생 정답률 q1 = q0 + Δ, Δ ∈ {−0.20, …, +0.20}(0.05 간격).
하루 3회 프로브(무작위 질문 B), 28일 시뮬레이션(가드 창 14일 = 42 프로브), 반복 R회(기본 10,000). 두 모델의 정답 여부는 독립 베르누이.
학생은 처음에 활성 상태로 시작한다(가장 위험한 상태: 나쁜 학생이 적용돼 있음).
가드:
  fixed   : 현행 DriftGuard — 창 안 n≥15, 학생 정답률 < 출하 − 0.10 → 복귀, 복귀 뒤 학생 ≥ 출하 + 0.05 → 재적용
  sprt    : 불일치 프로브(한 모델만 맞음)에 대한 SPRT. H0: 학생이 이길 확률 π=0.5, H1: π=π1(Δ=−0.10에 해당, q0별 계산), α=β=0.05.
            H1 채택 → 복귀 후 통계 리셋, H0 채택 → 리셋. 복귀 상태에서는 대칭 검정(π=0.5 대 1−π1)으로 재적용.
  bayes   : 창 안 두 정답률에 Beta(1,1) 사후 → 정규 근사. P(q_stu < q_ship − 0.05) > 0.95 → 복귀, P(q_stu > q_ship) > 0.95 → 재적용. n≥15.
  pairedci: 창 안 쌍대 차이(학생−출하)의 95% CI(정규 근사, n≥15). 상한 < 0 → 복귀, 하한 > 0 → 재적용.
지표: 14일·28일 안 복귀 확률, 복귀 지연 중앙값(일), 28일 전환 횟수 평균, 학생 활성 시간 비율.
사용: python experiments/guard_sim/guard_sim.py [--reps 10000] [--seed 0]
출력: results/guard_sim/guard_sim.csv, results/guard_sim/guard_sim_log.txt
"""
import argparse
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
RES = ROOT / "results" / "guard_sim"
RES.mkdir(parents=True, exist_ok=True)

PER_DAY = 3
WIN_DAYS = 14
DAYS = 28
WIN = PER_DAY * WIN_DAYS
N_PROBES = PER_DAY * DAYS
MIN_N = 15
DROP, RECOVER = 0.10, 0.05
Q0S = (0.55, 0.60, 0.65)
DELTAS = np.round(np.arange(-0.20, 0.2001, 0.05), 2)


def pi1_for(q0, delta=-0.10):
    q1 = q0 + delta
    a, b = q1 * (1 - q0), q0 * (1 - q1)
    return a / (a + b)


def simulate(q0, q1, reps, rng):
    ship = rng.random((reps, N_PROBES)) < q0
    stu = rng.random((reps, N_PROBES)) < q1
    out = {}
    for name in ("fixed", "sprt", "bayes", "pairedci"):
        active = np.ones(reps, bool)
        first_revert = np.full(reps, -1)
        switches = np.zeros(reps, int)
        active_time = np.zeros(reps, int)
        # SPRT 상태
        llr = np.zeros(reps)
        pi1 = pi1_for(q0)
        A, B = np.log(0.95 / 0.05), np.log(0.05 / 0.95)
        for k in range(N_PROBES):
            active_time += active
            lo = max(0, k - WIN + 1)
            n = k - lo + 1
            if name == "sprt":
                s_ok, h_ok = stu[:, k], ship[:, k]
                disc = s_ok != h_ok
                stu_win = disc & s_ok
                # 활성: H1(π1<0.5, 학생이 나쁨) 대 H0(0.5); 비활성: H1'(1−π1, 학생이 좋음) 대 H0
                p1 = np.where(active, pi1, 1 - pi1)
                inc = np.where(stu_win, np.log(p1 / 0.5), np.log((1 - p1) / 0.5))
                llr = np.where(disc, llr + inc, llr)
                accept_h1 = llr >= A
                accept_h0 = llr <= B
                to_ship = active & accept_h1
                to_stu = (~active) & accept_h1
                reset = accept_h1 | accept_h0
                llr = np.where(reset, 0.0, llr)
            else:
                if n < MIN_N:
                    continue
                ws = ship[:, lo:k + 1]
                wu = stu[:, lo:k + 1]
                ms, mu = ws.mean(1), wu.mean(1)
                if name == "fixed":
                    to_ship = active & (mu < ms - DROP)
                    to_stu = (~active) & (mu >= ms + RECOVER)
                elif name == "bayes":
                    a_s, b_s = 1 + ws.sum(1), 1 + n - ws.sum(1)
                    a_u, b_u = 1 + wu.sum(1), 1 + n - wu.sum(1)
                    m_s, v_s = a_s / (n + 2), a_s * b_s / ((n + 2) ** 2 * (n + 3))
                    m_u, v_u = a_u / (n + 2), a_u * b_u / ((n + 2) ** 2 * (n + 3))
                    md, sd = m_u - m_s, np.sqrt(v_s + v_u)
                    from scipy.stats import norm
                    p_worse = norm.cdf((-0.05 - md) / sd)
                    p_better = 1 - norm.cdf((0 - md) / sd)
                    to_ship = active & (p_worse > 0.95)
                    to_stu = (~active) & (p_better > 0.95)
                else:  # pairedci
                    diff = wu.astype(float) - ws.astype(float)
                    md = diff.mean(1)
                    se = diff.std(1, ddof=1) / np.sqrt(n)
                    se = np.where(se == 0, 1e-9, se)
                    to_ship = active & (md + 1.96 * se < 0)
                    to_stu = (~active) & (md - 1.96 * se > 0)
            newly = to_ship & (first_revert < 0)
            first_revert[newly] = k
            switches += to_ship | to_stu
            active = np.where(to_ship, False, np.where(to_stu, True, active))
        fr = first_revert
        out[name] = {
            "revert_14d": float(((fr >= 0) & (fr < PER_DAY * 14)).mean()),
            "revert_28d": float((fr >= 0).mean()),
            "delay_median_days": float(np.median(fr[fr >= 0]) / PER_DAY) if (fr >= 0).any() else np.nan,
            "switches_mean": float(switches.mean()),
            "student_active_frac": float(active_time.mean() / N_PROBES),
        }
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--reps", type=int, default=10000)
    ap.add_argument("--seed", type=int, default=0)
    a = ap.parse_args()
    rng = np.random.default_rng(a.seed)
    rows = []
    for q0 in Q0S:
        for dlt in DELTAS:
            q1 = q0 + dlt
            res = simulate(q0, q1, a.reps, rng)
            for g, m in res.items():
                rows.append({"q0": q0, "delta": float(dlt), "q1": round(q1, 3), "guard": g, **m})
            print(f"q0={q0} Δ={dlt:+.2f} " + " | ".join(f"{g}: 14d {m['revert_14d']:.2f} 28d {m['revert_28d']:.2f} sw {m['switches_mean']:.2f}" for g, m in res.items()), flush=True)
    df = pd.DataFrame(rows)
    df["reps"] = a.reps
    df["seed"] = a.seed
    df.to_csv(RES / f"guard_sim_seed{a.seed}.csv", index=False)
    df.to_csv(RES / "guard_sim.csv", index=False)
    # 요약: 검정력(Δ=−0.10, 14일) 과 오복귀율(Δ=0, 14일·28일)
    lines = []
    for q0 in Q0S:
        for g in ("fixed", "sprt", "bayes", "pairedci"):
            s = df[(df.q0 == q0) & (df.guard == g)].set_index("delta")
            lines.append(f"q0={q0} {g:8s} power(Δ=-0.10,14d)={s.loc[-0.1, 'revert_14d']:.3f} power(Δ=-0.20,14d)={s.loc[-0.2, 'revert_14d']:.3f} "
                         f"false_revert(Δ=0,14d)={s.loc[0.0, 'revert_14d']:.3f} (28d)={s.loc[0.0, 'revert_28d']:.3f} "
                         f"delay_med(Δ=-0.10)={s.loc[-0.1, 'delay_median_days']:.1f}d switches(Δ=0)={s.loc[0.0, 'switches_mean']:.2f}")
    (RES / "guard_sim_log.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
