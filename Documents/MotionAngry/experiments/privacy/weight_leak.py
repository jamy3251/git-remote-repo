"""Phase 5 (RQ6) 학생 가중치 유출 — 단말이 내보낼 수 있는 학생 가중치 33개만으로 사용자를 식별할 수 있는가.

입력: results/loop_sim/weights_<tag>_s<seed>.parquet (sim.py --save-weights 가 쓴 사용자별 최종 가중치; 열 pcode, task, cond, seed, b, w0..w31)
공격: seed 0·1의 가중치를 등록(학습), seed 2의 가중치로 질의 → 가장 가까운 등록 사용자(코사인·유클리드, 표준화) = 본인인가(77-way top-1·top-5).
      같은 사용자의 가중치는 교사 라벨의 난수 뒤집기만 다르므로, 식별률이 높으면 가중치가 그 사람의 움직임-정서 구조를 담고 있다는 뜻.
      대조: 씨앗(seed_model, 사용자별 LOSO 씨앗)의 가중치 — 그 사용자 데이터를 빼고 배운 것이므로 '그 사용자' 정보가 없어야 함(우연 수준 기대).
완화: 가중치에 가우시안 잡음(σ ∈ {0.01, 0.05, 0.1, 0.3} × 가중치 표준편차)을 더했을 때의 식별률과 그때의 예측 변화(해당 셀 평가 응답의 사용자별 AUROC 손실).
출력: results/privacy/weight_leak.csv, weight_leak_log.txt
사용: python experiments/privacy/weight_leak.py --tag p0.8_d0.5_b0.0
"""
import argparse
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
RES = ROOT / "results" / "privacy"
RES.mkdir(parents=True, exist_ok=True)
LS = ROOT / "results" / "loop_sim"


def nearest_id(reg, qry, metric):
    """reg, qry: DataFrame(index=pcode) 같은 열. 질의마다 가장 가까운 등록 사용자 → top1/top5."""
    R, Q = reg.to_numpy(float), qry.to_numpy(float)
    mu, sd = R.mean(0), R.std(0)
    sd[sd == 0] = 1
    R, Q = (R - mu) / sd, (Q - mu) / sd
    if metric == "cosine":
        Rn = R / (np.linalg.norm(R, axis=1, keepdims=True) + 1e-12)
        Qn = Q / (np.linalg.norm(Q, axis=1, keepdims=True) + 1e-12)
        D = -(Qn @ Rn.T)
    else:
        D = ((Q[:, None, :] - R[None, :, :]) ** 2).sum(-1)
    order = np.argsort(D, axis=1)
    reg_ids = reg.index.to_numpy()
    q_ids = qry.index.to_numpy()
    top1 = float(np.mean(reg_ids[order[:, 0]] == q_ids))
    top5 = float(np.mean([q in reg_ids[o[:5]] for q, o in zip(q_ids, order)]))
    return top1, top5


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tag", default="p0.8_d0.5_b0.0")
    ap.add_argument("--seed", type=int, default=0)
    a = ap.parse_args()
    files = sorted(LS.glob(f"weights_{a.tag}_s*.parquet"))
    if len(files) < 3:
        print("need weights for 3 seeds; run sim.py --save-weights", file=sys.stderr)
        sys.exit(1)
    W = pd.concat([pd.read_parquet(f) for f in files], ignore_index=True)
    wcols = [c for c in W.columns if c.startswith("w")] + ["b"]
    rng = np.random.default_rng(a.seed)
    rows, log = [], []
    for task in sorted(W.task.unique()):
        for cond in sorted(W.cond.unique()):
            sub = W[(W.task == task) & (W.cond == cond)]
            seeds = sorted(sub.seed.unique())
            if len(seeds) < 2:
                continue
            reg = sub[sub.seed.isin(seeds[:-1])].groupby("pcode")[wcols].mean()
            qry = sub[sub.seed == seeds[-1]].set_index("pcode")[wcols].reindex(reg.index).dropna()
            reg = reg.loc[qry.index]
            n = len(qry)
            for metric in ("cosine", "euclid"):
                t1, t5 = nearest_id(reg, qry, metric)
                rows.append({"task": task, "cond": cond, "metric": metric, "noise_sigma_rel": 0.0, "n_users": n, "top1": t1, "top5": t5,
                             "chance": 1 / n, "top1_over_chance": t1 * n})
                log.append(f"[{task}] {cond:14s} {metric:7s} n={n} top1 {t1:.3f} ({t1 * n:.1f}x chance) top5 {t5:.3f}")
                print(log[-1], flush=True)
            # 잡음 완화(코사인)
            sdw = qry.to_numpy(float).std(0)
            for rel in (0.01, 0.05, 0.1, 0.3, 1.0):
                qn = qry + rng.standard_normal(qry.shape) * sdw * rel
                t1, t5 = nearest_id(reg, qn, "cosine")
                rows.append({"task": task, "cond": cond, "metric": "cosine", "noise_sigma_rel": rel, "n_users": n, "top1": t1, "top5": t5,
                             "chance": 1 / n, "top1_over_chance": t1 * n})
                log.append(f"[{task}] {cond:14s} noise σ={rel:.2f}·sd top1 {t1:.3f} top5 {t5:.3f}")
    pd.DataFrame(rows).to_csv(RES / "weight_leak.csv", index=False)
    (RES / "weight_leak_log.txt").write_text("\n".join(log) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
