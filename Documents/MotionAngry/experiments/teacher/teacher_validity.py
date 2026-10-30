"""Phase 3.1 (RQ5) 교사 타당성 — 저자 앱 로그에서 표정 계수와 기분 지도 응답의 일치.

입력: data/raw/life/*/affect.csv(분 단위: smile_mean, jaw_mean, face_rate), events.csv(type=affect 탭: v, a, src).
방법: 탭 직전 5분 안의 affect 행(s8_common.row_before_tap)에서 smile_mean(정서가 교사), smile_mean+jaw_mean(각성 교사)을 가져와
  (1) 스피어만 상관(표정 계수 vs 응답 v/a), (2) 이진 라벨(>0)에 대한 AUROC, (3) 교사 임계(results/models/teacher_params.txt)로 만든 의사 라벨의 일치율.
표본이 작으면 작은 대로 보고한다(n, 얼굴 검출된 탭 수).
출력: results/teacher/teacher_validity.csv, teacher_validity_log.txt
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import spearmanr

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT))
import s8_common as C  # noqa: E402
from experiments.common.eval import safe_auc  # noqa: E402

RES = ROOT / "results" / "teacher"
RES.mkdir(parents=True, exist_ok=True)


def teacher_params():
    p = ROOT / "results" / "models" / "teacher_params.txt"
    out = {}
    if p.exists():
        for ln in p.read_text().splitlines():
            parts = ln.replace("=", " ").split()
            if len(parts) == 2:
                out[parts[0]] = float(parts[1])
    return out


def main():
    aff = C.load_affect()
    ev = C.load_events()
    taps = C.grid_taps(ev)
    tp = teacher_params()
    rows, log = [], []
    log.append(f"affect minutes={len(aff)} (face_rate>=0.3: {(aff.face_rate >= 0.3).sum()}), taps={len(taps)} "
               f"(A={int((taps.arm == 'A').sum())}, B={int((taps.arm == 'B').sum())}, manual={int((taps.arm == 'manual').sum())}), teacher_params={tp}")
    rec = []
    for _, t in taps.iterrows():
        i = C.row_before_tap(aff, t.wall_ms)
        if i is None:
            continue
        r = aff.iloc[i]
        rec.append({"wall_ms": t.wall_ms, "arm": t.arm, "v": t.v, "a": t.a, "smile": r.smile_mean, "jaw": r.jaw_mean, "face_rate": r.face_rate,
                    "gap_min": (t.wall_ms - r.wall_ms) / 60_000})
    rec = pd.DataFrame(rec)
    rec.to_csv(RES / "teacher_validity_taps.csv", index=False)
    face = rec[rec.face_rate >= 0.3] if len(rec) else rec
    log.append(f"taps with affect row within 5 min: {len(rec)}; with face detected (face_rate>=0.3): {len(face)}")
    for task, lab, feat in (("valence", "v", "smile"), ("arousal", "a", "act")):
        if len(face) == 0:
            rows.append({"task": task, "n": 0, "note": "no taps with face"})
            continue
        x = face["smile"] if feat == "smile" else face["smile"] + face["jaw"]
        y = face[lab]
        rho = spearmanr(x, y).statistic if len(face) >= 3 else np.nan
        yb = (y > 0).astype(int)
        auc = safe_auc(yb, x) if len(face) >= 5 else np.nan
        th = tp.get("theta_v" if task == "valence" else "theta_a")
        agree = float(((x >= th).astype(int) == yb).mean()) if th is not None else np.nan
        rows.append({"task": task, "n": len(face), "spearman_rho": rho, "auroc": auc, "teacher_agree": agree, "theta": th})
        log.append(f"[{task}] n={len(face)} rho={rho} AUROC={auc} agree(theta={th})={agree}")
    pd.DataFrame(rows).to_csv(RES / "teacher_validity.csv", index=False)
    (RES / "teacher_validity_log.txt").write_text("\n".join(log) + "\n", encoding="utf-8")
    print("\n".join(log))


if __name__ == "__main__":
    main()
