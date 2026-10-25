"""S8 학생(설계 1단계 게이트, 결정 R1·R2·R3·R5·R11):
교사 라벨(처음 k일)로 학생(표준화+로지스틱, 32개 요약 특징)을 학습하고, k일 이후의 팔 B 격자 탭으로
출하 모델 / 학생 / 블렌드를 within-user AUROC로 비교한다.

  라벨: 탭의 a(각성)·v(정서가) >0 양성, <0 음성, 0 제외 (R2). 분할당 n<MIN_N이면 'n 부족'.
  보조: 스피어만 ρ + 원형 이동 순열검정(s5_life.circ_perm_p). j(맞아요/아니에요)는 팔별 일치율만.
  자세 분리: 탭 직전 분의 held(1) vs 나머지 (R5).  팔 A는 B 횟수만큼 부표본(R1). 누락률(R11).
  누출 검사: 조정에 쓴 탭·조정 날 ∩ 평가 탭·평가 날 = ∅ 단언 (R3).
출력: results/s8_student.csv(지표), results/s8_student_taps_k{k}.csv(탭별 확률), results/models/student_{task}_k{k}.txt(단말용)
"""
import sys

import numpy as np
import pandas as pd
from scipy.stats import spearmanr
from sklearn.metrics import roc_auc_score

import s8_common as C
from s5_life import circ_perm_p

KS = (3, 5, 7)
TASKS = {"arousal": ("a", "label_a", "p_arousal"), "valence": ("v", "label_v", "p_valence")}
MIN_TRAIN = 30


def auroc_or_na(y, p):
    y = np.asarray(y, dtype=float); p = np.asarray(p, dtype=float)
    ok = ~np.isnan(y) & ~np.isnan(p)
    if not C.enough(ok.sum()) or len(set(y[ok])) < 2:
        return np.nan, int(ok.sum()), "n 부족" if not C.enough(ok.sum()) else "한 부류"
    return roc_auc_score(y[ok], p[ok]), int(ok.sum()), ""


def evaluate(affect, taps, events, k, rng):
    days = sorted(affect["day"].unique())
    if len(days) <= k:
        return [], None
    train_days, eval_days = days[:k], days[k:]
    teacher = pd.read_csv(C.RES / f"s8_teacher_k{k}.csv")
    params = pd.read_csv(C.RES / "s8_teacher_params.csv")
    params = params[params.k == k].iloc[0]
    tuning_taps = set(int(x) for x in str(params.tuning_tap_wall_ms).split("|") if x and x != "nan")
    fcols = C.feature_cols(affect)

    # 학생 학습: 조정 날의 교사 라벨 분(요약 특징이 있는 행)
    tr = teacher[(teacher.tuning_day == 1) & (teacher.conf >= 0.3)].merge(affect[["t_ns", "wall_ms"] + fcols], on=["t_ns", "wall_ms"])
    tr = tr.dropna(subset=fcols)
    students = {}
    for task, (_, lab, _) in TASKS.items():
        y = tr[lab].to_numpy()
        students[task] = C.Student(fcols).fit(tr[fcols].to_numpy(), y) if len(tr) >= MIN_TRAIN and len(set(y)) == 2 else None

    # 평가 탭: k일 이후 팔 B(+ A 부표본·수동은 참고)
    ev = taps[taps.day.isin(eval_days)].copy()
    assert not (set(ev.wall_ms.astype(int)) & tuning_taps), "누출: 조정에 쓴 탭이 평가에 있음"
    assert not (set(train_days) & set(eval_days)), "누출: 조정 날이 평가 날에 있음"
    rows_tap = []
    for _, t in ev.iterrows():
        i = C.row_before_tap(affect, t.wall_ms)
        if i is None:
            continue
        r = affect.iloc[i]
        x = r[fcols].to_numpy(dtype=float)
        rec = {"k": k, "wall_ms": t.wall_ms, "day": t.day, "arm": t.arm, "held": int(r.held) if not np.isnan(r.held) else -1,
               "a": t.a, "v": t.v, "j": t.j}
        for task, (col, _, pship) in TASKS.items():
            rec[f"ship_{task}"] = r[pship]
            st = students[task]
            rec[f"student_{task}"] = float(st.predict(x[None, :])[0]) if st is not None and not np.isnan(x).any() else np.nan
            rec[f"blend_{task}"] = np.nanmean([rec[f"ship_{task}"], rec[f"student_{task}"]]) if not np.isnan(rec[f"student_{task}"]) else np.nan
        rows_tap.append(rec)
    tp = pd.DataFrame(rows_tap)
    tp.to_csv(C.RES / f"s8_student_taps_k{k}.csv", index=False)
    out = []
    if tp.empty:
        return out, students
    B = tp[tp.arm == "B"]
    splits = {"all": B, "held": B[B.held == 1], "other": B[B.held != 1]}
    for task, (col, _, _) in TASKS.items():
        for sname, S in splits.items():
            y = C.binarize(S[col]) if len(S) else np.array([])
            for model in ("ship", "student", "blend"):
                p = S[f"{model}_{task}"].to_numpy() if len(S) else np.array([])
                auc, n, note = auroc_or_na(y, p)
                rho = pperm = np.nan
                if n >= C.MIN_N:
                    ok = ~np.isnan(S[col].to_numpy()) & ~np.isnan(p)
                    rho, pperm = circ_perm_p(p[ok], S[col].to_numpy()[ok])
                out.append({"k": k, "task": task, "split": sname, "model": model, "n": n, "auroc": auc,
                            "spearman": rho, "p_perm": pperm, "note": note, "train_minutes": len(tr),
                            "student_trained": students[task] is not None})
    # j 일치율(팔별), A 부표본 비교
    for arm in ("A", "B"):
        g = tp[(tp.arm == arm) & tp.j.isin(["yes", "no"])]
        out.append({"k": k, "task": "judge", "split": arm, "model": "agree_rate", "n": len(g),
                    "auroc": (g.j == "yes").mean() if len(g) else np.nan, "note": "" if len(g) else "n 부족"})
    sub = C.subsample_a_to_b(tp, rng)
    for arm in ("A", "B"):
        g = sub[sub.arm == arm]
        auc, n, note = auroc_or_na(C.binarize(g.a) if len(g) else [], g.ship_arousal if len(g) else [])
        out.append({"k": k, "task": "arousal", "split": f"arm_{arm}_matched", "model": "ship", "n": n, "auroc": auc, "note": note})
    return out, students


def main():
    affect = C.load_affect()
    events = C.load_events()
    if affect.empty or events.empty:
        print("로그 없음")
        sys.exit(1)
    taps = C.grid_taps(events)
    rng = np.random.default_rng(0)
    rows = []
    (C.RES / "models").mkdir(exist_ok=True)
    for k in KS:
        out, students = evaluate(affect, taps, events, k, rng)
        rows += out
        if students:
            for task, st in students.items():
                if st is not None:
                    st.write(C.RES / "models" / f"student_{task}_k{k}.txt")
    mr = C.missed_rate(events)
    rows.append({"k": -1, "task": "armB", "split": "missed", "model": "sched_vs_fired", "n": mr["scheduled"], "auroc": mr["missed_rate"],
                 "note": f"scheduled={mr['scheduled']} fired={mr['fired']}"})
    res = pd.DataFrame(rows)
    res.to_csv(C.RES / "s8_student.csv", index=False)
    print(f"days={affect.day.nunique()} affect_rows={len(affect)} taps={len(taps)} (B={int((taps.arm=='B').sum()) if len(taps) else 0}) {mr}")
    if not res.empty:
        print(res.round(3).to_string(index=False))


if __name__ == "__main__":
    main()
