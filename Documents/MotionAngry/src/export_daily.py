"""S6 단말 배포: 일상 데이터(K-EmoPhone)로 학습한 각성·정서가 모델(작은 트리)과 단말 자체 검사 자료를 내보낸다.

단말 계산 경로(앱 DailyEngine.java)와 똑같이 만든다.
  8Hz 격자 30분 신호 → 60초 창 30개(결측 창 제외) → 4개 평균으로 2Hz → raw_feats(fs=2) 16개
  → 창들의 중앙값(med_)·사분위 범위(iqr_) 32개 → 트리 50개·잎 3개 모델 → 확률
출력 (android/app/src/main/assets/)
- daily_arousal.txt, daily_valence.txt : 평탄화 모델 (export_model.flatten 형식)
- selftest_daily.txt : 실제 응답 직전 30분 신호 몇 개 + Python이 계산한 32개 특징·두 확률
"""
import zipfile

import lightgbm as lgb
import numpy as np
import pandas as pd

import export_model as E
import s1b_wesad as W
import s4_kemophone as S4
from s6_build_2hz import OUT as FEAT, block2

PARAMS = dict(n_estimators=50, learning_rate=0.05, num_leaves=3, min_child_samples=20, subsample=0.8,
              subsample_freq=1, colsample_bytree=1.0, class_weight="balanced", verbose=-1)
N_CASES = 3


def summarize(per):
    df = pd.DataFrame(per)
    med = df.median().add_prefix("med_")
    iqr = (df.quantile(0.75) - df.quantile(0.25)).add_prefix("iqr_")
    return {**med.to_dict(), **iqr.to_dict()}


def train(d, task):
    feats = [c for c in d if c.startswith("b2_")]
    m = lgb.LGBMClassifier(**PARAMS, random_state=0).fit(d[feats], (d[task] > 0).astype(int))
    names = [f[3:] for f in feats]  # "b2_med_hp_iqr" -> "med_hp_iqr"
    dump = m.booster_.dump_model()
    lines = [f"features {len(names)} " + " ".join(names), f"trees {len(dump['tree_info'])}"]
    for t in dump["tree_info"]:
        nodes = E.flatten(t)
        lines.append(f"tree {len(nodes)}")
        for n in nodes:
            lines.append("L %.17g" % n[1] if n[0] == "L" else "N %d %.17g %d %d %d" % n[1:])
    text = "\n".join(lines) + "\n"
    (E.ASSETS / f"daily_{task}.txt").write_text(text)
    print(task, len(feats), "features,", m.booster_.num_trees(), "trees,", len(text.encode()), "bytes")
    return m, feats


def selftest(models):
    """서로 다른 참가자의 실제 응답 직전 30분 신호. 소수 6자리로 반올림한 값으로 Python도 다시 계산한다."""
    out = [f"cases {N_CASES}"]
    picked = 0
    for pcode in ("P01", "P10", "P20", "P30", "P40"):
        if picked == N_CASES:
            break
        z = zipfile.ZipFile(S4.RAW / f"{pcode}.zip")
        acc = pd.read_csv(z.open("Acceleration.csv")).sort_values("timestamp").drop_duplicates("timestamp")
        at, ax = acc.timestamp.to_numpy(np.float64), acc[["x", "y", "z"]].to_numpy()
        for _, e in S4.ESM[S4.ESM.pcode == pcode].iterrows():
            t1 = float(e.responseTime)
            t0 = t1 - S4.PRE_MIN * 60_000
            lo, hi = np.searchsorted(at, t0 - S4.GAP_MS), np.searchsorted(at, t1 + S4.GAP_MS)
            _, u = S4.uniform(at[lo:hi], ax[lo:hi], t0, t1)
            if np.mean(~np.isnan(u[:, 0])) < 0.9:
                continue
            u = np.round(u, 6)
            per = []
            for s in range(S4.PRE_MIN):
                w = u[s * 60 * S4.FS:(s + 1) * 60 * S4.FS]
                if not np.isnan(w).any():
                    per.append(W.raw_feats(block2(w), 2, orient=False))
            f = summarize(per)
            out.append(f"case {len(u)}")
            out += ["nan nan nan" if np.isnan(r).any() else "%.6f %.6f %.6f" % tuple(r) for r in u]
            for task, (m, feats) in models.items():
                x = pd.DataFrame([[f[c[3:]] for c in feats]], columns=feats)
                out.append(f"feat_{task} " + " ".join("%.17g" % v for v in x.iloc[0]))
                out.append(f"prob_{task} %.17g" % m.predict_proba(x)[0, 1])
            picked += 1
            break
    (E.ASSETS / "selftest_daily.txt").write_text("\n".join(out) + "\n")
    print("selftest cases", picked)


def student(d):
    """학생 모델 씨앗(설계 R4(d), T4): K-EmoPhone 전체로 학습한 표준화+로지스틱을 StudentModel.java 형식으로 내보내고,
    단말 일치 검사용 픽스처(selftest_student.txt: 특징 벡터 3개 + Python 확률)를 쓴다. 단말의 files/models/에 넣으면
    출하 트리 대신(또는 나란히) 읽힌다. 실제 개인 학생은 s8_student.py가 폰 로그로 다시 학습한다."""
    import s8_common as C
    feats = [c for c in d if c.startswith("b2_")]
    names = [f[3:] for f in feats]
    out = ["cases 3"]
    for task in ("arousal", "valence"):
        st = C.Student(names).fit(d[feats].to_numpy(), (d[task] > 0).astype(int).to_numpy())
        st.write(E.ASSETS / f"student_{task}.txt")
        p = st.predict(d[feats].to_numpy()[:3])
        for i in range(3):
            out.append(f"feat_{task} " + " ".join("%.17g" % v for v in d[feats].to_numpy()[i]))
            out.append(f"prob_{task} %.17g" % p[i])
        print("student", task, "AUROC(train, 참고)", "%.3f" % __import__("sklearn.metrics", fromlist=["roc_auc_score"])
              .roc_auc_score((d[task] > 0).astype(int), st.predict(d[feats].to_numpy())))
    (E.ASSETS / "selftest_student.txt").write_text("\n".join(out) + "\n")


def main(student_only=False):
    d = pd.read_parquet(FEAT)
    if student_only:
        student(d)
        return
    models = {task: train(d, task) for task in ("arousal", "valence")}
    selftest(models)
    student(d)


if __name__ == "__main__":
    import sys
    main(student_only="--student" in sys.argv)
