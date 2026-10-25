"""S4: K-EmoPhone(일상 7일, 77명)에서 모션 해상도와 정서 추정.

질문: WESAD의 결과가 실험실 프로토콜 교란이 아니라면, 일상 환경에서도 손목 원시 가속도가
OS 수준 활동 범주보다 정서 정보를 더 담고 있어야 한다.

각 ESM 응답 직전 PRE_MIN분 동안
- phone_act : 폰 구글 활동인식 신뢰도 평균 + 활동 전이 횟수 (OS 수준, StudentLife와 같은 층위)
- coarse    : 손목 가속도를 초 단위 3범주(정지/약/걷기)로 뭉갠 비율·전이
- raw{8,4,2}: 손목 가속도 방향무관 원시 특징(s1b_wesad.raw_feats)을 60초 창마다 계산해 중앙값·IQR로 요약
- intensity : 움직임 세기 하나(sec_std_mean의 중앙값) — 강도만으로 얼마나 되는지 기준
라벨: valence/arousal/stress > 0 (절대) 및 사용자 평균 초과(사용자 내). 평가는 LOSO.
"""
import warnings
import zipfile
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd
from scipy import signal as sps
from sklearn.metrics import f1_score, roc_auc_score

import s1b_wesad as W

warnings.filterwarnings("ignore")
ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw" / "kemophone"
OUT = ROOT / "data" / "processed" / "kemophone_esm_features.parquet"
FS = 8
PRE_MIN = 30
MIN_COVER = 0.5  # 직전 구간의 손목 데이터가 이 비율 이상 있어야 사용
GAP_MS = 1000
ACT_COLS = ["confidenceStill", "confidenceUnknown", "confidenceOnFoot", "confidenceWalking",
            "confidenceInVehicle", "confidenceOnBicycle", "confidenceRunning", "confidenceTilting"]


def uniform(acc_t, acc_xyz, t0, t1):
    """[t0,t1) 구간을 8Hz 격자로 선형 보간. 1초 넘는 공백 구간은 NaN."""
    grid = np.arange(t0, t1, 1000 / FS)
    if len(acc_t) < 2:
        return grid, np.full((len(grid), 3), np.nan)
    out = np.column_stack([np.interp(grid, acc_t, acc_xyz[:, d]) for d in range(3)])
    idx = np.searchsorted(acc_t, grid)
    prev = acc_t[np.clip(idx - 1, 0, len(acc_t) - 1)]
    nxt = acc_t[np.clip(idx, 0, len(acc_t) - 1)]
    bad = (idx == 0) | (idx >= len(acc_t)) | (nxt - prev > GAP_MS)
    out[bad] = np.nan
    return grid, out


def summarize(rows, prefix):
    df = pd.DataFrame(rows)
    med = df.median().add_prefix(f"{prefix}_med_")
    iqr = (df.quantile(0.75) - df.quantile(0.25)).add_prefix(f"{prefix}_iqr_")
    return {**med.to_dict(), **iqr.to_dict()}


def participant(pcode):
    z = zipfile.ZipFile(RAW / f"{pcode}.zip")
    acc = pd.read_csv(z.open("Acceleration.csv")).sort_values("timestamp").drop_duplicates("timestamp")
    act = pd.read_csv(z.open("ActivityEvent.csv")).sort_values("timestamp")
    tr = pd.read_csv(z.open("ActivityTransition.csv")).sort_values("timestamp")
    esm = ESM[ESM.pcode == pcode]
    at, ax = acc.timestamp.to_numpy(np.float64), acc[["x", "y", "z"]].to_numpy()
    rows = []
    for _, e in esm.iterrows():
        t1 = float(e.responseTime)
        t0 = t1 - PRE_MIN * 60_000
        r = {"pcode": pcode, "t": t1, "valence": e.valence, "arousal": e.arousal, "stress": e.stress}
        # 폰 활동 (OS 수준)
        a = act[(act.timestamp >= t0) & (act.timestamp < t1)]
        for c in ACT_COLS:
            r[f"phone_{c}"] = a[c].mean() if len(a) else np.nan
        r["phone_n_events"] = len(a)
        r["phone_n_trans"] = int(((tr.timestamp >= t0) & (tr.timestamp < t1)).sum())
        # 손목 원시 가속도
        lo, hi = np.searchsorted(at, t0 - GAP_MS), np.searchsorted(at, t1 + GAP_MS)
        _, u = uniform(at[lo:hi], ax[lo:hi], t0, t1)
        cover = np.mean(~np.isnan(u[:, 0]))
        r["wrist_cover"] = cover
        if cover >= MIN_COVER:
            per = {8: [], 4: [], 2: [], "coarse": []}
            for s in range(PRE_MIN):
                w = u[s * 60 * FS:(s + 1) * 60 * FS]
                if np.isnan(w).any():
                    continue
                per[8].append(W.raw_feats(w, 8, orient=False))
                per["coarse"].append(W.coarse_feats(w, 8))
                for fs in (4, 2):
                    wd = sps.decimate(w, 8 // fs, axis=0, zero_phase=True)
                    per[fs].append(W.raw_feats(wd, fs, orient=False))
            if len(per[8]) >= 5:
                r["n_win"] = len(per[8])
                for k, v in per.items():
                    r |= summarize(v, f"raw{k}" if k != "coarse" else "coarse")
        rows.append(r)
    return rows


ESM = pd.read_csv(zipfile.ZipFile(RAW / "SubjData.zip").open("EsmResponse.csv"))


def build():
    codes = sorted(p.stem for p in RAW.glob("P*.zip"))
    rows = []
    with ProcessPoolExecutor(max_workers=6) as ex:
        for pc, rs in zip(codes, ex.map(participant, codes)):
            rows += rs
            print(pc, len(rs), "esm,", sum("n_win" in r for r in rs), "with wrist", flush=True)
    df = pd.DataFrame(rows)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(OUT)
    return df


def loso(df, feats, y):
    probs = np.full(len(df), np.nan)
    for p in df.pcode.unique():
        te = (df.pcode == p).to_numpy()
        if y[~te].nunique() < 2:
            continue
        m = lgb.LGBMClassifier(**W.PARAMS, random_state=0).fit(df.loc[~te, feats], y[~te])
        probs[te] = m.predict_proba(df.loc[te, feats])[:, 1]
    ok = ~np.isnan(probs)
    users = [roc_auc_score(y[idx], probs[idx]) for _, idx in df[ok].groupby("pcode").groups.items()
             if y[idx].nunique() == 2 and len(idx) >= 20]
    return {"auroc": roc_auc_score(y[ok], probs[ok]),
            "macro_f1": f1_score(y[ok], probs[ok] >= 0.5, average="macro"),
            "user_auroc_median": float(np.median(users)), "n_users": len(users)}


def main():
    df = pd.read_parquet(OUT) if OUT.exists() else build()
    print(len(df), "ESM total;", df.n_win.notna().sum(), "with >=5 wrist windows")
    d = df[df.n_win.notna()].reset_index(drop=True)
    cols = lambda p: [c for c in d if c.startswith(p)]
    sets = {
        "phone_act(OS)": cols("phone_"),
        "intensity": ["raw8_med_sec_std_mean"],
        "coarse(wrist 3범주)": cols("coarse_"),
        "raw 2Hz": cols("raw2_"), "raw 4Hz": cols("raw4_"), "raw 8Hz": cols("raw8_"),
        "raw 8Hz + phone": cols("raw8_") + cols("phone_"),
    }
    res = []
    for task in ("valence", "arousal", "stress"):
        for lab, y in (("abs>0", (d[task] > 0).astype(int)),
                       ("user_mean", (d[task] > d.groupby("pcode")[task].transform("mean")).astype(int))):
            for name, feats in sets.items():
                r = loso(d, feats, y)
                res.append({"task": task, "label": lab, "features": name, "pos_rate": y.mean(), **r})
                print(task, lab, f"{name:20s}", {k: round(v, 3) for k, v in r.items()})
    out = pd.DataFrame(res)
    out.to_csv(ROOT / "results" / "s4_kemophone.csv", index=False)
    print(out.pivot_table(index=["task", "label"], columns="features", values="auroc").round(3).to_string())


if __name__ == "__main__":
    main()
