"""S16: 누적 학습의 '전체 AUROC 상승'이 사용자별 오프셋 보정만으로 설명되는가.

사용자 안 AUROC는 사용자별 단조 변환(오프셋·스케일)에 불변이므로, 개인화가 올린 것이 전체 AUROC뿐이라면
그 상승은 '사용자별 수준 차이 보정'일 가능성이 크다. 이를 직접 보이기 위해 개인 모델을 전혀 쓰지 않고
기본 모델 확률에서 그 사용자의 처음 k개 응답에서 본 평균 확률과 평균 라벨의 차이만큼 오프셋을 더한
단순 보정(offset)을 베이스라인으로 두고 k=10·20·30에서 base / blend / offset 의 전체 AUROC를 비교한다.
사용자별 평균 AUROC는 정의상 base와 offset이 같다(불변).
출력: results/s16_offset_baseline.csv, results/s16_offset_log.txt
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score

sys.path.insert(0, str(Path(__file__).resolve().parent))
from s7_cumulative import load, base_loso, own_model, safe_auc  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
RES = ROOT / "results"
KS = (10, 20, 30)


def main():
    d, feats = load()
    rows, log = [], []
    for task in ("arousal", "valence"):
        y = (d[task] > 0).astype(int)
        d["p"] = base_loso(d, feats, y.to_numpy())
        for k in KS:
            ys, P = [], {"base": [], "blend": [], "offset": []}
            per = {"base": [], "blend": [], "offset": []}
            for pc, g in d.groupby("pcode"):
                tr, te = g[g["rank"] < k], g[g["rank"] >= k]
                if len(te) == 0:
                    continue
                po = own_model(tr[feats], y[tr.index], te[feats])
                if po is None:
                    continue
                pb = te["p"].to_numpy()
                # 오프셋: 처음 k개에서 (평균 라벨 − 평균 확률)만큼 더해 그 사용자의 수준만 맞춘다
                off = float(y[tr.index].mean() - tr["p"].mean())
                pof = np.clip(pb + off, 0, 1)
                pbl = (pb + po) / 2
                yg = y[te.index]
                ys.append(yg)
                for name, p in (("base", pb), ("blend", pbl), ("offset", pof)):
                    P[name].append(p)
                    per[name].append(safe_auc(yg, p))
            yy = pd.concat(ys)
            r = {"task": task, "k": k, "n_users": len(per["base"]), "n_test": len(yy)}
            for name in P:
                r[f"pooled_{name}"] = roc_auc_score(yy, np.concatenate(P[name]))
                r[f"user_mean_{name}"] = float(np.nanmean(per[name]))
            rows.append(r)
            log.append(f"[{task}] k={k} users={r['n_users']} pooled base/blend/offset = {r['pooled_base']:.3f}/{r['pooled_blend']:.3f}/{r['pooled_offset']:.3f} | "
                       f"user-mean base/blend/offset = {r['user_mean_base']:.3f}/{r['user_mean_blend']:.3f}/{r['user_mean_offset']:.3f}")
            print(log[-1], flush=True)
    pd.DataFrame(rows).to_csv(RES / "s16_offset_baseline.csv", index=False)
    (RES / "s16_offset_log.txt").write_text("\n".join(log) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
