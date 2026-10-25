"""S1b: WESAD 손목 원시 가속도(32Hz)로 스트레스 vs 비스트레스 이진 분류.

질문: S1(StudentLife)에서 거친 활동 추론은 우연 수준이었다. 같은 사람의 원시 IMU에는 신호가 있는가?
해상도 곡선: 원시 32Hz → 다운샘플(16/8/4Hz) → OS식 활동 범주 비율(정지/약한움직임/걷기)
교란 점검: TSST(스트레스)는 서서, 기준선은 앉아서 진행 → 중력 방향(자세) 정보를 뺀 '방향무관' 세트 별도 평가
참조 상한: 손목 EDA·BVP·TEMP 생리 신호
라벨: 1 baseline, 3 amusement → 0 / 2 stress → 1. 평가는 LOSO(15명).
"""
import pickle
import warnings
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd
from scipy import signal as sps
from sklearn.metrics import f1_score, roc_auc_score

warnings.filterwarnings("ignore")
ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw" / "WESAD"
OUT = ROOT / "data" / "processed" / "wesad_windows.parquet"
FS_ACC, FS_LABEL = 32, 700
WIN_S, STEP_S = 60, 15
LABEL_MAP = {1: 0, 3: 0, 2: 1}
PARAMS = dict(n_estimators=200, learning_rate=0.05, num_leaves=15, min_child_samples=20,
              subsample=0.8, subsample_freq=1, colsample_bytree=0.8, class_weight="balanced", verbose=-1)


def stats(x, p):
    return {f"{p}_mean": x.mean(), f"{p}_std": x.std(), f"{p}_p10": np.percentile(x, 10),
            f"{p}_p90": np.percentile(x, 90), f"{p}_iqr": np.subtract(*np.percentile(x, [75, 25]))}


def spectral(x, fs, p):
    f, pxx = sps.welch(x - x.mean(), fs=fs, nperseg=min(len(x), fs * 8))
    tot = pxx.sum() + 1e-12
    out = {f"{p}_domf": f[pxx.argmax()], f"{p}_sent": -(pxx / tot * np.log(pxx / tot + 1e-12)).sum()}
    for lo, hi in ((0.1, 1), (1, 3), (3, 8), (8, 16)):
        if lo < fs / 2:
            out[f"{p}_bp{lo}-{hi}"] = pxx[(f >= lo) & (f < hi)].sum() / tot
    return out


def raw_feats(acc, fs, orient=True):
    """acc: (n,3) 단위 g. orient=False면 중력 방향(축별 평균·기울기)을 쓰지 않는다."""
    mag = np.linalg.norm(acc, axis=1)
    hp = mag - sps.medfilt(mag, fs * 2 + 1)  # 느린 성분 제거 → 순수 움직임
    f = {}
    f |= stats(hp, "hp") | spectral(hp, fs, "hp")
    jerk = np.diff(mag) * fs
    f |= stats(np.abs(jerk), "jerk")
    sec = hp[: len(hp) // fs * fs].reshape(-1, fs).std(axis=1)  # 초 단위 움직임 강도
    f |= {"sec_std_mean": sec.mean(), "sec_std_cv": sec.std() / (sec.mean() + 1e-9),
          "still_frac": (sec < 0.01).mean()}
    if orient:
        for i, ax in enumerate("xyz"):
            f |= stats(acc[:, i], ax)
        g = acc.mean(axis=0)
        f |= {"pitch": np.arctan2(g[0], np.hypot(g[1], g[2])), "roll": np.arctan2(g[1], g[2])}
    return f


def coarse_feats(acc, fs):
    """OS 활동 추론 흉내: 초 단위로 정지/약한움직임/걷기 이상 3범주만 남긴다(S1과 같은 해상도)."""
    mag = np.linalg.norm(acc, axis=1)
    sec = mag[: len(mag) // fs * fs].reshape(-1, fs).std(axis=1)
    cls = np.digitize(sec, [0.01, 0.1])
    frac = {f"act{k}_frac": (cls == k).mean() for k in range(3)}
    return frac | {"act_trans": (np.diff(cls) != 0).mean()}


def physio_feats(w, t0, t1):
    f = {}
    for name, fs in (("EDA", 4), ("BVP", 64), ("TEMP", 4)):
        x = w[name][int(t0 * fs): int(t1 * fs)].ravel()
        f |= stats(x, name)
        if name == "EDA":
            f["EDA_slope"] = np.polyfit(np.arange(len(x)) / fs, x, 1)[0]
    return f


def build():
    rows = []
    for d in sorted(RAW.glob("S*")):
        pk = d / f"{d.name}.pkl"
        if not pk.exists():
            continue
        with open(pk, "rb") as fh:
            data = pickle.load(fh, encoding="latin1")
        w, lab = data["signal"]["wrist"], data["label"].ravel()
        acc = w["ACC"] / 64.0  # Empatica E4: 1/64 g
        n_s = len(acc) / FS_ACC
        for t0 in np.arange(0, n_s - WIN_S, STEP_S):
            t1 = t0 + WIN_S
            seg_lab = lab[int(t0 * FS_LABEL): int(t1 * FS_LABEL)]
            vals, cnt = np.unique(seg_lab, return_counts=True)
            top = vals[cnt.argmax()]
            if top not in LABEL_MAP or cnt.max() < 0.9 * len(seg_lab):
                continue
            a = acc[int(t0 * FS_ACC): int(t1 * FS_ACC)]
            r = {"uid": d.name, "t0": t0, "cond": int(top), "y": LABEL_MAP[top]}
            r |= {f"raw32_{k}": v for k, v in raw_feats(a, 32).items()}
            r |= {f"noori32_{k}": v for k, v in raw_feats(a, 32, orient=False).items()}
            for fs in (16, 8, 4):
                ad = sps.decimate(a, 32 // fs, axis=0, zero_phase=True)
                r |= {f"noori{fs}_{k}": v for k, v in raw_feats(ad, fs, orient=False).items()}
            r |= {f"coarse_{k}": v for k, v in coarse_feats(a, 32).items()}
            r |= {f"phys_{k}": v for k, v in physio_feats(w, t0, t1).items()}
            rows.append(r)
        print(d.name, sum(r["uid"] == d.name for r in rows), "windows")
    df = pd.DataFrame(rows)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(OUT)
    return df


def loso(df, feats):
    probs = np.zeros(len(df))
    for uid in df.uid.unique():
        te = (df.uid == uid).to_numpy()
        m = lgb.LGBMClassifier(**PARAMS, random_state=0).fit(df.loc[~te, feats], df.y[~te])
        probs[te] = m.predict_proba(df.loc[te, feats])[:, 1]
    users = [roc_auc_score(g.y, probs[g.index]) for _, g in df.groupby("uid") if g.y.nunique() == 2]
    return {"auroc": roc_auc_score(df.y, probs), "macro_f1": f1_score(df.y, probs >= 0.5, average="macro"),
            "user_auroc_median": float(np.median(users)), "n_feats": len(feats)}


def main():
    df = pd.read_parquet(OUT) if OUT.exists() else build()
    print(len(df), "windows,", df.uid.nunique(), "subjects, stress rate", round(df.y.mean(), 3))
    cols = lambda p: [c for c in df if c.startswith(p)]
    sets = {
        "coarse(OS활동범주)": cols("coarse_"),
        "noori 4Hz": cols("noori4_"), "noori 8Hz": cols("noori8_"), "noori 16Hz": cols("noori16_"),
        "noori 32Hz(방향무관)": cols("noori32_"),
        "raw 32Hz(방향포함)": cols("raw32_"),
        "physio(EDA·BVP·TEMP)": cols("phys_"),
        "raw32+physio": cols("raw32_") + cols("phys_"),
    }
    res = []
    for name, feats in sets.items():
        r = loso(df, feats)
        res.append({"features": name, **r})
        print(f"{name:24s}", {k: round(v, 3) for k, v in r.items()})
    out = pd.DataFrame(res)
    out.to_csv(ROOT / "results" / "s1b_wesad.csv", index=False)
    print(out.round(3).to_string())


if __name__ == "__main__":
    main()
