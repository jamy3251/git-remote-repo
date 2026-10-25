"""S13: 요약 창 길이(응답 직전 몇 분을 요약할지)가 일상 정서 추정 성능에 미치는 영향.

질문: 설문 응답은 "그 순간"의 기분인데 왜 직전 30분을 요약하는가? 창을 1·5·10·15·30·60분으로 바꾸며
같은 응답 집합에서 기본 모델(LOSO, 50트리×잎3)의 전체 AUROC와 사용자별 평균 AUROC를 비교한다.
계산은 s6_build_2hz와 같다(8Hz 격자 보간 → 4개 평균 2Hz → 60초 창 16개 특징 → 창 안 분들의 중앙값·사분위 범위).
응답 집합은 "직전 60분 커버리지 ≥50% 이고 직전 5분 안에 완전한 1분 창이 3개 이상"으로 고정해 창 길이 간 비교를 같은 응답으로 한다.
출력: results/s13_window.csv, results/s13_window_log.txt
"""
import sys
import zipfile
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score

sys.path.insert(0, str(Path(__file__).resolve().parent))
import s1b_wesad as W  # noqa: E402
import s4_kemophone as S4  # noqa: E402
from s6_build_2hz import block2  # noqa: E402
from s7_cumulative import DEPLOY  # noqa: E402

ROOT = S4.ROOT
RES = ROOT / "results"
PRE = 60
WINDOWS = (1, 5, 10, 15, 30, 60)
MIN_FRAC = 0.5  # 창 안 완전한 1분 수가 창 길이의 절반 이상(1분 창은 1개)


def participant(pcode):
    z = zipfile.ZipFile(S4.RAW / f"{pcode}.zip")
    acc = pd.read_csv(z.open("Acceleration.csv")).sort_values("timestamp").drop_duplicates("timestamp")
    at, ax = acc.timestamp.to_numpy(np.float64), acc[["x", "y", "z"]].to_numpy()
    rows = []
    for _, e in S4.ESM[S4.ESM.pcode == pcode].iterrows():
        t1 = float(e.responseTime)
        t0 = t1 - PRE * 60_000
        lo, hi = np.searchsorted(at, t0 - S4.GAP_MS), np.searchsorted(at, t1 + S4.GAP_MS)
        _, u = S4.uniform(at[lo:hi], ax[lo:hi], t0, t1)
        if np.mean(~np.isnan(u[:, 0])) < S4.MIN_COVER:
            continue
        per = {}  # 응답 전 몇 분째(1=직전 1분) → 특징
        for s in range(PRE):
            w = u[s * 60 * S4.FS:(s + 1) * 60 * S4.FS]
            if np.isnan(w).any():
                continue
            per[PRE - s] = W.raw_feats(block2(w), 2, orient=False)
        if sum(1 for m in per if m <= 5) < 3:
            continue
        r = {"pcode": pcode, "t": t1, "valence": e.valence, "arousal": e.arousal, "stress": e.stress}
        for win in WINDOWS:
            sel = [per[m] for m in per if m <= win]
            r[f"n_{win}"] = len(sel)
            if len(sel) < max(1, int(np.ceil(win * MIN_FRAC))):
                continue
            if win == 1:
                r |= {f"w1_{k}": v for k, v in sel[0].items()}
            else:
                r |= S4.summarize(sel, f"w{win}")
        rows.append(r)
    return rows


def loso(d, feats, y):
    p = np.zeros(len(d))
    for pc in d.pcode.unique():
        te = (d.pcode == pc).to_numpy()
        m = lgb.LGBMClassifier(**DEPLOY, random_state=0).fit(d.loc[~te, feats], y[~te])
        p[te] = m.predict_proba(d.loc[te, feats])[:, 1]
    return p


def user_mean_auc(d, y, p):
    out = []
    for pc, g in d.groupby("pcode"):
        yy, pp = y[g.index], p[g.index]
        if len(yy) >= 20 and len(np.unique(yy)) == 2:
            out.append(roc_auc_score(yy, pp))
    return float(np.mean(out)), len(out)


def main():
    feat_path = ROOT / "data" / "processed" / "kemophone_window_sweep.parquet"
    if feat_path.exists():
        df = pd.read_parquet(feat_path)
    else:
        codes = sorted(p.stem for p in S4.RAW.glob("P*.zip"))
        rows = []
        with ProcessPoolExecutor(max_workers=8) as ex:
            for rs in ex.map(participant, codes):
                rows += rs
        df = pd.DataFrame(rows)
        df.to_parquet(feat_path)
    # 모든 창 길이에서 특징이 있는 응답만(같은 응답 집합)
    ok = np.ones(len(df), bool)
    for win in WINDOWS:
        ok &= df[[c for c in df if c.startswith(f"w{win}_")]].notna().all(axis=1).to_numpy()
    d = df[ok].sort_values(["pcode", "t"]).reset_index(drop=True)
    log = [f"{len(df)} responses with >=60min coverage, {len(d)} usable at all windows, {d.pcode.nunique()} users"]
    out = []
    for task in ("arousal", "valence", "stress"):
        y = (d[task] > 0).astype(int).to_numpy()
        for win in WINDOWS:
            feats = [c for c in d if c.startswith(f"w{win}_")]
            p = loso(d, feats, y)
            pooled = roc_auc_score(y, p)
            um, nu = user_mean_auc(d, y, p)
            out.append({"task": task, "window_min": win, "n_feats": len(feats), "n": len(d),
                        "auroc_pooled": pooled, "auroc_user_mean": um, "n_users": nu})
            log.append(f"[{task}] win={win:2d}min feats={len(feats):2d} pooled={pooled:.3f} user-mean={um:.3f} (users={nu})")
            print(log[-1], flush=True)
    pd.DataFrame(out).to_csv(RES / "s13_window.csv", index=False)
    (RES / "s13_window_log.txt").write_text("\n".join(log), encoding="utf-8")
    print("\n".join(log[:1]))


if __name__ == "__main__":
    main()
