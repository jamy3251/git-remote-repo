"""StudentLife: PAM 라벨 + EMA 직전 윈도우의 모션/폰사용 특징 생성.

PAM 채점 (Pollak 2011 학위논문 Fig 4.2): 4x4 그리드, 행 우선(위→아래) 번호 가정.
  valence: 열 왼→오 = -2,-1,+1,+2 / arousal: 행 위→아래 = 4,3,2,1
  picture_idx 번호가 행 우선이라는 점은 데이터셋 문서로 재확인 필요.
"""
from pathlib import Path

import numpy as np
import pandas as pd
import pyreadr

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw" / "dataset_rds"
OUT = ROOT / "data" / "processed"

VAL = np.array([-2, -1, 1, 2])
WINDOWS_MIN = (30, 60, 120)
ACT_NAMES = ["stationary", "walking", "running", "unknown"]


def read(rel):
    return next(iter(pyreadr.read_r(RAW / rel).values()))


def load_pam():
    p = read("EMA/PAM.Rds").dropna(subset=["picture_idx"])
    i = p.picture_idx.astype(int) - 1
    p = p.assign(valence=VAL[i % 4], arousal=4 - i // 4, uid=p.uid.astype(str))
    return p[["uid", "timestamp", "valence", "arousal"]].sort_values(["uid", "timestamp"])


def activity_features(act, t, w):
    """act: 한 사용자의 정렬된 (ts, cls). t: EMA 시각 배열. w: 초."""
    ts, cls = act
    lo = np.searchsorted(ts, t - w)
    hi = np.searchsorted(ts, t)
    n = hi - lo
    feats = {f"n_samples": n}
    safe = np.maximum(n, 1)
    for k, name in enumerate(ACT_NAMES):
        cum = np.concatenate([[0], np.cumsum(cls == k)])
        feats[f"frac_{name}"] = (cum[hi] - cum[lo]) / safe
    change =np.concatenate([[0], np.cumsum(np.r_[0, np.diff(cls) != 0])])
    feats["transitions_per_100"] = (change[hi] - change[lo]) / safe * 100
    moving = (cls == 1) | (cls == 2)
    cum_m = np.concatenate([[0], np.cumsum(moving)])
    feats["frac_moving"] = (cum_m[hi] - cum_m[lo]) / safe
    feats = {f"act{w // 60}_{k}": v for k, v in feats.items()}
    for k in list(feats):
        if k.endswith("n_samples"):
            continue
        feats[k] = np.where(n > 0, feats[k], np.nan)
    return feats


def lock_features(locks, t, w):
    """잠금 구간과 윈도우 겹침: 잠금 시간 비율, 잠금 횟수(=잠금 해제 근사)."""
    s, e = locks
    out_frac, out_cnt = [], []
    for ti in t:
        a, b = ti - w, ti
        m = (e > a) & (s < b)
        overlap = (np.minimum(e[m], b) - np.maximum(s[m], a)).sum()
        out_frac.append(overlap / w)
        out_cnt.append(m.sum())
    return {f"lock{w // 60}_frac": np.array(out_frac), f"lock{w // 60}_count": np.array(out_cnt)}


def build():
    OUT.mkdir(parents=True, exist_ok=True)
    pam = load_pam()
    act = read("sensing/activity.Rds")
    act = act.assign(uid=act.uid.astype(str)).sort_values(["uid", "timestamp"])
    lock = read("sensing/phonelock.Rds")
    lock = lock.assign(uid=lock.uid.astype(str))

    rows = []
    for uid, g in pam.groupby("uid"):
        t = g.timestamp.to_numpy()
        a = act[act.uid == uid]
        l = lock[lock.uid == uid]
        f = {}
        for wm in WINDOWS_MIN:
            w = wm * 60
            f |= activity_features((a.timestamp.to_numpy(), a.activity_inference.to_numpy()), t, w)
            f |= lock_features((l.start_timestamp.to_numpy(), l.end_timestamp.to_numpy()), t, w)
        rows.append(g.reset_index(drop=True).join(pd.DataFrame(f)))
    df = pd.concat(rows, ignore_index=True)
    local = pd.to_datetime(df.timestamp, unit="s", utc=True).dt.tz_convert("US/Eastern")
    df["hour"] = local.dt.hour + local.dt.minute / 60
    df["weekday"] = local.dt.weekday
    df.to_parquet(OUT / "pam_features.parquet")
    return df


if __name__ == "__main__":
    d = build()
    print(d.shape)
    print(d.describe().T.to_string())
