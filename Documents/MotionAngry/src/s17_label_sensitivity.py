"""S17: 라벨 이진화 기준 민감도 — '0 초과' 대신 '그 사용자의 중앙값 초과'로 나누면 결과가 달라지는가.

리뷰어 예상 질문: −3~+3 응답을 0 기준으로 이진화하면 사람마다 양성 비율이 크게 달라(각성 39%, 정서가 58%)
사용자 안 판별이 라벨 기준에 좌우될 수 있다. 사용자별 중앙값 기준(그 사람 안에서 높은 편/낮은 편)으로 다시 이진화해
기본 모델(LOSO 50×3)의 전체 AUROC·사용자별 평균 AUROC를 비교한다. 중앙값과 같은 응답은 제외.
출력: results/s17_label_sensitivity.csv, results/s17_label_log.txt
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score

sys.path.insert(0, str(Path(__file__).resolve().parent))
from s7_cumulative import load, base_loso  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
RES = ROOT / "results"
MIN_N = 20


def user_mean(d, y, p):
    vals = []
    for pc, g in d.groupby("pcode"):
        yy, pp = y[g.index], p[g.index]
        if len(yy) >= MIN_N and yy.nunique() == 2:
            vals.append(roc_auc_score(yy, pp))
    return float(np.mean(vals)), len(vals)


def main():
    d, feats = load()
    rows, log = [], []
    for task in ("arousal", "valence"):
        x = d[task]
        y0 = (x > 0).astype(int)
        p0 = pd.Series(base_loso(d, feats, y0.to_numpy()), index=d.index)
        um0, nu0 = user_mean(d, y0, p0)
        # 사용자 중앙값 기준 라벨(동률 제외), 모델은 그 라벨로 다시 LOSO 학습
        med = x.groupby(d.pcode).transform("median")
        keep = x != med
        dm = d[keep].reset_index(drop=True)
        ym = (x[keep] > med[keep]).astype(int).reset_index(drop=True)
        pm = pd.Series(base_loso(dm, feats, ym.to_numpy()), index=dm.index)
        umm, num = user_mean(dm, ym, pm)
        # 0 기준으로 학습한 모델을 중앙값 라벨로 평가(모델 고정, 라벨만 교체)
        p0k = p0[keep].reset_index(drop=True)
        umx, nux = user_mean(dm, ym, p0k)
        r = {"task": task,
             "gt0_pooled": roc_auc_score(y0, p0), "gt0_user_mean": um0, "gt0_users": nu0, "gt0_pos_rate": float(y0.mean()),
             "median_pooled": roc_auc_score(ym, pm), "median_user_mean": umm, "median_users": num, "median_n": len(dm),
             "gt0model_medianlabel_pooled": roc_auc_score(ym, p0k), "gt0model_medianlabel_user_mean": umx}
        rows.append(r)
        log.append(f"[{task}] gt0: pooled {r['gt0_pooled']:.3f} user-mean {um0:.3f} (users {nu0}, pos {r['gt0_pos_rate']:.2f}) | "
                   f"user-median label (n={len(dm)}): pooled {r['median_pooled']:.3f} user-mean {umm:.3f} (users {num}) | "
                   f"gt0-model on median-label: pooled {r['gt0model_medianlabel_pooled']:.3f} user-mean {umx:.3f}")
        print(log[-1], flush=True)
    pd.DataFrame(rows).to_csv(RES / "s17_label_sensitivity.csv", index=False)
    (RES / "s17_label_log.txt").write_text("\n".join(log) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
