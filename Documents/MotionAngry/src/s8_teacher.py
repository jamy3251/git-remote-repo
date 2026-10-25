"""S8 교사(설계 1단계, 결정 R3·R5): affect.csv v2의 분 단위 표정 집계(smile_mean, jaw_mean, face_rate)로 의사 라벨을 만든다.

조정/평가 분리(R3): 처음 k일(k=3,5,7)만으로 임계값을 정한다. 조정 기간에 팔 B 격자 탭이 충분하면(≥MIN_N, 두 부류)
탭 직전 분의 표정값과 v>0 / a>0 의 일치율이 최대가 되는 임계값을, 아니면 조정 기간 표정값의 70번째 백분위를 쓴다.
  정서가 교사: smile_mean ≥ θ_v → 1
  각성 교사  : smile_mean + jaw_mean(얼굴 활동) ≥ θ_a → 1
신뢰도 = face_rate(그 분의 얼굴 검출률). 출력:
  results/s8_teacher_k{k}.csv  : t_ns, wall_ms, day, label_v, label_a, conf, tuning_day
  results/s8_teacher_params.csv: k, theta_v, theta_a, how, n_tuning_minutes, tuning_tap_wall_ms
"""
import sys

import numpy as np
import pandas as pd

import s8_common as C

KS = (3, 5, 7)
CONF_MIN = 0.3   # 얼굴 검출률 이 미만인 분은 교사에서 제외
PCT = 70


def choose_threshold(x_at_taps, y01, fallback_values):
    """탭 직전 표정값 x와 이진 라벨 y의 일치율을 최대화하는 θ. 탭이 부족하면 백분위."""
    y = np.asarray(y01, dtype=float)
    ok = ~np.isnan(y)
    if ok.sum() >= C.MIN_N and len(set(y[ok])) == 2:
        xs = np.asarray(x_at_taps, dtype=float)[ok]
        ys = y[ok]
        cands = np.unique(xs)
        best, best_acc = cands[0], -1
        for t in cands:
            acc = np.mean((xs >= t) == (ys == 1))
            if acc > best_acc:
                best, best_acc = t, acc
        return float(best), "tuned_on_taps(acc=%.2f,n=%d)" % (best_acc, ok.sum())
    return float(np.nanpercentile(fallback_values, PCT)), "percentile%d" % PCT


def build(affect, taps, k):
    days = sorted(affect["day"].unique())
    tuning_days = days[:k]
    face = affect[(affect["face_frames"] > 0) & (affect["face_rate"] >= CONF_MIN)].copy()
    face["act"] = face["smile_mean"].fillna(0) + face["jaw_mean"].fillna(0)
    tune = face[face["day"].isin(tuning_days)]
    # 조정 기간 팔 B 탭 → 직전 분의 표정값
    xs_v, xs_a, yv, ya, used = [], [], [], [], []
    if not taps.empty:
        tb = taps[(taps.arm == "B") & taps.day.isin(tuning_days)]
        for _, t in tb.iterrows():
            i = C.row_before_tap(face, t.wall_ms)
            if i is None:
                continue
            r = face.iloc[i]
            xs_v.append(r.smile_mean); xs_a.append(r.act)
            yv.append(C.binarize([t.v])[0]); ya.append(C.binarize([t.a])[0])
            used.append(int(t.wall_ms))
    theta_v, how_v = choose_threshold(xs_v, yv, tune["smile_mean"].to_numpy() if len(tune) else [np.nan])
    theta_a, how_a = choose_threshold(xs_a, ya, tune["act"].to_numpy() if len(tune) else [np.nan])
    lab = face[["t_ns", "wall_ms", "day"]].copy()
    lab["label_v"] = (face["smile_mean"] >= theta_v).astype(int)
    lab["label_a"] = (face["act"] >= theta_a).astype(int)
    lab["conf"] = face["face_rate"]
    lab["tuning_day"] = face["day"].isin(tuning_days).astype(int)
    params = {"k": k, "theta_v": theta_v, "theta_a": theta_a, "how_v": how_v, "how_a": how_a,
              "n_tuning_minutes": int(len(tune)), "n_days": len(days), "tuning_days": "|".join(tuning_days),
              "tuning_tap_wall_ms": "|".join(map(str, used))}
    return lab, params


def main():
    affect = C.load_affect()
    if affect.empty:
        print("affect.csv v2 없음 — 폰 로그를 data/raw/life/<날짜>/ 에 복사했는지 확인")
        sys.exit(1)
    events = C.load_events()
    taps = C.grid_taps(events) if not events.empty else pd.DataFrame(columns=["arm", "day", "wall_ms", "v", "a"])
    rows = []
    for k in KS:
        lab, params = build(affect, taps, k)
        lab.to_csv(C.RES / f"s8_teacher_k{k}.csv", index=False)
        rows.append(params)
        print(f"k={k}: days={params['n_days']} tuning_minutes={params['n_tuning_minutes']} "
              f"theta_v={params['theta_v']:.3f}({params['how_v']}) theta_a={params['theta_a']:.3f}({params['how_a']}) "
              f"labels={len(lab)} pos_v={lab.label_v.mean():.2f} pos_a={lab.label_a.mean():.2f}")
    pd.DataFrame(rows).to_csv(C.RES / "s8_teacher_params.csv", index=False)


if __name__ == "__main__":
    main()
