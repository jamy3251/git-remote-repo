"""S5: 1인 일상 기록(콘텐츠 이용 중 손 움직임·표정·좋아/별로) 분석.

입력: data/raw/life/<날짜>/{imu_*.csv.gz, face_*.csv, events_*.csv}  (앱 LifeLogService 출력)
1초 단위로 손 움직임 지표와 표정 지표를 맞춘 뒤,
(1) 표정 지표 ↔ 움직임 지표 순위 상관 — 자기상관을 고려해 원형 이동 순열 검정(1,000회)
(2) 좋아/별로 입력 직전 [-10,-2)초의 움직임·표정을 곡 단위로 묶어 좋아 vs 별로 비교(만-휘트니)
출력: results/s5_life_summary.csv, s5_life_corr.csv, s5_life_rates.csv, s5_life_rate_cmp.csv(곡 단위 좋아/별로 비교)
모든 시각은 elapsedRealtime ns(센서 timestamp와 같은 시계).
"""
import io
import zlib
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import signal as sps
from scipy.stats import mannwhitneyu, rankdata, spearmanr

import os

ROOT = Path(__file__).resolve().parents[1]
# 골든 회귀 테스트(설계 R13)용 덮어쓰기: MA_LIFE_RAW(입력 폴더), MA_RESULTS(출력 폴더)
RAW = Path(os.environ.get("MA_LIFE_RAW", ROOT / "data" / "raw" / "life"))
RES = Path(os.environ.get("MA_RESULTS", ROOT / "results"))
FS = 50
FACE = {"smile": [44, 45], "frown": [30, 31], "brow_down": [1, 2], "brow_inner_up": [3], "jaw_open": [25],
        "cheek_squint": [7, 8], "eye_squint": [19, 20], "blink": [9, 10]}
N_PERM = 1000
rng = np.random.default_rng(0)


def read_gz_partial(path):
    """기록 중인(닫히지 않은) gzip도 끝까지 풀린 만큼 읽는다. 마지막 잘린 줄은 버린다."""
    d = zlib.decompressobj(16 + zlib.MAX_WBITS)
    raw = d.decompress(path.read_bytes())
    text = raw.decode("utf-8", "ignore")
    if not text.endswith("\n"):
        text = text[: text.rfind("\n") + 1]
    return pd.read_csv(io.StringIO(text))


def load(pattern, **kw):
    fs = sorted(RAW.glob(f"*/{pattern}"))
    rd = (lambda f: read_gz_partial(f)) if pattern.endswith(".gz") else (lambda f: pd.read_csv(f, **kw))
    return pd.concat([rd(f) for f in fs], ignore_index=True) if fs else pd.DataFrame()


def motion_seconds(imu):
    """센서별 50Hz 격자 보간 → 1초 창 지표."""
    out = {}
    for s, g in imu.groupby("sensor"):
        g = g.sort_values("t_ns").drop_duplicates("t_ns")
        t = g.t_ns.to_numpy(np.float64)
        grid = np.arange(np.ceil(t[0] / 1e9) * 1e9, t[-1], 1e9 / FS)
        xyz = np.column_stack([np.interp(grid, t, g[c]) for c in "xyz"])
        gap = np.diff(t).max(initial=0)
        mag = np.linalg.norm(xyz, axis=1)
        sec = (grid // 1e9).astype(np.int64)
        # 1초 넘게 빈 구간은 버림
        idx = np.searchsorted(t, grid)
        bad = (idx == 0) | (idx >= len(t)) | (t[np.clip(idx, 0, len(t) - 1)] - t[np.clip(idx - 1, 0, len(t) - 1)] > 1e9)
        df = pd.DataFrame({"sec": sec, "mag": mag, "bad": bad})
        rows = {}
        for k, w in df.groupby("sec"):
            if len(w) < FS or w.bad.any():
                continue
            m = w.mag.to_numpy()[:FS]
            if s == "a":
                hp = m - m.mean()
                f, p = sps.periodogram(hp, fs=FS)
                tot = p.sum() + 1e-12
                rows[k] = {"acc_std": hp.std(), "acc_jerk": np.abs(np.diff(m)).mean() * FS,
                           "acc_bp_0_3": p[(f > 0) & (f < 3)].sum() / tot, "acc_bp_3_8": p[(f >= 3) & (f < 8)].sum() / tot,
                           "acc_bp_8_15": p[(f >= 8) & (f < 15)].sum() / tot}
            else:
                f, p = sps.periodogram(m - m.mean(), fs=FS)
                tot = p.sum() + 1e-12
                rows[k] = {"gyr_mean": m.mean(), "gyr_std": m.std(), "gyr_bp_3_8": p[(f >= 3) & (f < 8)].sum() / tot}
        out[s] = pd.DataFrame.from_dict(rows, orient="index")
    return out["a"].join(out["g"], how="inner")


def face_seconds(face):
    f = face[face.face == 1].copy()
    f["sec"] = (f.t_ns // 1e9).astype(np.int64)
    for k, cols in FACE.items():
        f[k] = f[[f"bs{c}" for c in cols]].mean(axis=1)
    agg = f.groupby("sec").agg(app=("clip", "last"), **{k: (k, "mean") for k in FACE})
    return agg


def circ_perm_p(x, y, n=None):
    """원형 이동으로 자기상관을 보존한 순열 검정 (양측).
    무작위 표본 대신 허용되는 모든 이동량(양끝 10% 제외)의 정확 분포를 FFT로 한 번에 계산한다.
    순위를 먼저 매기므로 각 이동에서의 피어슨 = 스피어만."""
    if np.ptp(x) == 0 or np.ptp(y) == 0:
        return np.nan, np.nan
    L = len(x)
    rx = rankdata(x); ry = rankdata(y)
    rx = (rx - rx.mean()) / rx.std(); ry = (ry - ry.mean()) / ry.std()
    # all_r[s] = corr(x, np.roll(y, s))
    all_r = np.fft.ifft(np.fft.fft(rx) * np.conj(np.fft.fft(ry))).real / L
    r0 = all_r[0]
    shifts = np.arange(L // 10, L - L // 10) if L > 20 else np.arange(1, L)
    null = all_r[shifts]
    return r0, (np.sum(np.abs(null) >= abs(r0) - 1e-12) + 1) / (len(null) + 1)


def main():
    imu = load("imu_*.csv.gz")
    face = load("face_*.csv")
    ev = load("events_*.csv")
    mot = motion_seconds(imu)
    fac = face_seconds(face)
    d = mot.join(fac, how="inner").dropna()
    mcols = [c for c in mot if c in d]
    summary = {"imu_hours": len(mot) / 3600, "face_frames": len(face), "face_detect_rate": face.face.mean(),
               "seconds_with_face_and_motion": len(d),
               "n_like": int(((ev.type == "rate") & (ev.value == "like")).sum()),
               "n_dislike": int(((ev.type == "rate") & (ev.value == "dislike")).sum()),
               "media_titles": int(ev[ev.type == "media"].media.fillna("").str.len().gt(0).sum())}
    print(summary)
    print(face.groupby("clip").face.agg(["size", "mean"]).round(2))
    pd.Series(summary).to_csv(RES / "s5_life_summary.csv", header=["value"])

    res = []
    for fk in FACE:
        for mk in mcols:
            r, p = circ_perm_p(d[mk].to_numpy(), d[fk].to_numpy())
            res.append({"face": fk, "motion": mk, "rho": r, "p_perm": p, "n_sec": len(d)})
    corr = pd.DataFrame(res)
    corr = corr.dropna(subset=["rho"])
    corr["p_bonf"] = (corr.p_perm * len(corr)).clip(upper=1)
    corr = corr.sort_values("p_perm")
    corr.to_csv(RES / "s5_life_corr.csv", index=False)
    print(corr.head(10).round(3).to_string(index=False))

    # 좋아/별로 직전 구간: 버튼을 누르려고 손을 뻗고 화면을 보는 직전 2초는 빼고 [-10, -2)초
    rates = ev[ev.type == "rate"].copy()
    rates["sec"] = (rates.t_ns // 1e9).astype(np.int64)
    rates["song"] = rates.media.fillna("").str.split("|").str[1].fillna("").replace("", np.nan)
    rates["song"] = rates.song.fillna(rates.app)
    rows = []
    for _, r in rates.iterrows():
        w = d.loc[(d.index >= r.sec - 10) & (d.index < r.sec - 2)]
        if len(w):
            rows.append({"value": r.value, "song": r.song, "app": r.app, "n_sec": len(w),
                         **w[mcols + list(FACE)].mean().to_dict()})
    rr = pd.DataFrame(rows)
    rr.to_csv(RES / "s5_life_rates.csv", index=False)
    if len(rr) and rr.value.nunique() == 2:
        # 같은 곡에서 여러 번 누른 것은 곡 단위 평균으로 묶어 의사반복을 줄인다
        song = rr.groupby(["song", "value"])[mcols + list(FACE)].mean().reset_index()
        out = []
        for c in mcols + list(FACE):
            a_, b_ = song[song.value == "like"][c].dropna(), song[song.value == "dislike"][c].dropna()
            if len(a_) > 1 and len(b_) > 1:
                out.append({"feature": c, "like_med": a_.median(), "dislike_med": b_.median(),
                            "p_mwu": mannwhitneyu(a_, b_).pvalue, "n_like_song": len(a_), "n_dislike_song": len(b_)})
        cmp_ = pd.DataFrame(out).sort_values("p_mwu")
        cmp_["p_bonf"] = (cmp_.p_mwu * len(cmp_)).clip(upper=1)
        cmp_.to_csv(RES / "s5_life_rate_cmp.csv", index=False)
        print("rate presses with data:", rr.value.value_counts().to_dict(), "| song-level:", song.value.value_counts().to_dict())
        print(cmp_.round(4).head(8).to_string(index=False))


if __name__ == "__main__":
    main()
