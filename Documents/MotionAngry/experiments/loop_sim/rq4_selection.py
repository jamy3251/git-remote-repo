"""Phase 2.6 (RQ4) 급변 질문 A의 선택 편향 — 시뮬레이터 데이터 위에서 측정 (docs/PREREG.md RQ4).

단말의 팔 A는 1분마다 갱신되는 각성 추정이 '마지막 질문 시점의 추정' 대비 ≥0.25 변하면 질문한다(AskScheduler.onEstimate: |pa − askedPa| ≥ ASK_DELTA, 30분 간격).
여기서는 각 응답 직전 30분의 분별 '직전 30분 요약'에 기본 모델(LOSO LightGBM 50×3)을 적용해 분별 각성 추정을 만들고,
  (주) since-last-ask: 창 안 분별 추정과 '직전 응답 시각의 추정'의 최대 차가 임계 이상 → A 표본 (단말 규칙과 같은 정의; 직전 응답이 마지막 질문)
  (보조) consecutive: 연속한 두 분 사이 변화의 최대값이 임계 이상
임계: 절대 0.15/0.25(단말) + 분위 q75/q90.
비교: A 표본만 / A가 아닌 표본 / 전체(=무작위 질문 B에 해당)에서 전체 AUROC·사용자별 AUROC 평균(≥10건), 확률 극단성 |p−0.5| 평균,
A 표본의 사용자별 AUROC − 전체의 사용자별 AUROC(참가자 부트스트랩 95% CI). IPW 보정: P(A | 사용자, 시각대)로 역가중한 전체 AUROC.
출력: data/processed/loop_minute_base.parquet (분별 기본 모델 확률, 캐시), results/loop_sim/rq4_selection.csv, rq4_selection_log.txt
"""
import os
import sys
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT))
from experiments.common.eval import boot_ci_users, safe_auc, user_auc  # noqa: E402
from s7_cumulative import DEPLOY, load  # noqa: E402

PROC = ROOT / "data" / "processed"
RES = ROOT / "results" / "loop_sim"
CACHE = PROC / "loop_minute_base.parquet"
THRESH = (0.15, 0.25, "q75", "q90")
DEF = "since_last_ask"   # 또는 "consecutive"   # 절대 임계(단말 0.25) + 분위 임계(사전등록 임계가 거의 발화하지 않아 추가, docs/ASSUMPTIONS A8)
TASKS = ("arousal", "valence")


def minute_base():
    if CACHE.exists():
        return pd.read_parquet(CACHE)
    d, feats = load()
    summ = pd.read_parquet(PROC / "loop_summaries.parquet")
    out = summ[["pcode", "t", "offset"]].copy()
    for task in TASKS:
        y = (d[task] > 0).astype(int).to_numpy()
        p = np.full(len(summ), np.nan)
        for pc in d.pcode.unique():
            te = (d.pcode == pc).to_numpy()
            m = lgb.LGBMClassifier(**DEPLOY, random_state=0).fit(d.loc[~te, feats], y[~te])
            ms = (summ.pcode == pc).to_numpy()
            p[ms] = m.predict_proba(summ.loc[ms, feats])[:, 1]
        out[f"p_{task}"] = p
        print(task, "minute predictions done", flush=True)
    out.to_parquet(CACHE)
    return out


def main():
    global DEF
    DEF = os.environ.get("RQ4_DEF", DEF)
    mb = minute_base()
    d, _ = load()
    rows, log = [], []
    for task in TASKS:
        y = (d[task] > 0).astype(int)
        df = d[["pcode", "t"]].copy()
        df["y"] = y.to_numpy()
        # 응답별: offset 1 확률(= 응답 시각 추정), 창 안 최대 연속 변화
        g = mb.sort_values(["pcode", "t", "offset"]).groupby(["pcode", "t"])
        p1 = mb[mb.offset == 1].set_index(["pcode", "t"])[f"p_{task}"]
        jump_consec = g[f"p_{task}"].apply(lambda s: np.nanmax(np.abs(np.diff(s.to_numpy()))) if len(s) > 1 else np.nan)
        # since-last-ask: 직전 응답(같은 사용자, 시간순)의 offset-1 추정 대비 창 안 최대 차
        p1s = mb[mb.offset == 1].sort_values(["pcode", "t"]).copy()
        p1s["prev_p"] = p1s.groupby("pcode")[f"p_{task}"].shift(1)
        prev = p1s.set_index(["pcode", "t"])["prev_p"]
        mx = g[f"p_{task}"].max()
        mn = g[f"p_{task}"].min()
        jump_since = pd.concat([(mx - prev).abs(), (mn - prev).abs()], axis=1).max(axis=1)
        jump = jump_since if DEF == "since_last_ask" else jump_consec
        n_jumps = {}
        thv = {}
        for th in THRESH:
            thv[th] = float(np.nanquantile(jump, int(th[1:]) / 100)) if isinstance(th, str) else th
            n_jumps[th] = g[f"p_{task}"].apply(lambda s, v=thv[th]: int((np.abs(np.diff(s.to_numpy())) >= v).sum()))
        df = df.set_index(["pcode", "t"])
        df["p"] = p1
        df["jump"] = jump
        df = df.reset_index()
        n_min = int(g.size().sum())
        base_user = user_auc(df, "y", "p")
        for th in THRESH:
            a = (df.jump >= thv[th])
            nj = n_jumps[th].reindex(pd.MultiIndex.from_frame(df[["pcode", "t"]])).to_numpy()
            fire_per_hour = nj.sum() / (n_min / 60)   # 분당 발화 → 시간당(30분당 1회 제한 전)
            sub = {"A": df[a], "notA": df[~a], "all": df}
            for name, s in sub.items():
                um, nu = (float(user_auc(s, "y", "p").dropna().mean()), int(user_auc(s, "y", "p").notna().sum())) if len(s) else (np.nan, 0)
                rows.append({"task": task, "thresh": th, "thresh_value": thv[th], "subset": name, "n": int(len(s)), "frac": len(s) / len(df),
                             "pos_rate": float(s.y.mean()) if len(s) else np.nan,
                             "pooled_auc": safe_auc(s.y, s.p) if len(s) else np.nan, "user_mean_auc": um, "n_users": nu,
                             "extremity": float((s.p - 0.5).abs().mean()) if len(s) else np.nan,
                             "fires_per_hour_unlimited": fire_per_hour})
            if a.sum() < 10:
                log.append(f"[{task}] thresh={th}: A={a.sum()} (too few)")
                continue
            ua_A = user_auc(df[a], "y", "p")
            mean, lo, hi = boot_ci_users(ua_A, base_user)
            # IPW: P(A | 사용자) 로 역가중 → 전체 AUROC (A 표본만 가지고 전체를 추정)
            pa = df.assign(a=a).groupby("pcode").a.transform("mean").to_numpy()
            w = np.where(a, 1 / np.clip(pa, 1e-3, 1), 0.0)
            ipw_auc = roc_auc_score(df.y[a], df.p[a], sample_weight=w[a]) if a.sum() > 10 and df.y[a].nunique() == 2 else np.nan
            rows.append({"task": task, "thresh": th, "thresh_value": thv[th], "subset": "A_minus_all_userauc", "n": int(a.sum()), "frac": float(a.mean()),
                         "pooled_auc": ipw_auc, "user_mean_auc": mean, "ci_lo": lo, "ci_hi": hi, "n_users": int(ua_A.notna().sum())})
            log.append(f"[{task}] thresh={th}({thv[th]:.3f}): A={a.sum()} ({a.mean():.1%}) pooled A {safe_auc(df.y[a], df.p[a]):.3f} vs all {safe_auc(df.y, df.p):.3f} | "
                       f"user-mean A {rows[-4]['user_mean_auc']:.3f} ({rows[-4]['n_users']}) vs all {rows[-2]['user_mean_auc']:.3f} ({rows[-2]['n_users']}) | "
                       f"extremity A {rows[-4]['extremity']:.3f} vs all {rows[-2]['extremity']:.3f} | A−all user AUROC {mean:+.3f} [{lo:+.3f}, {hi:+.3f}] | "
                       f"IPW pooled {ipw_auc:.3f} | fires/h(unlimited) {fire_per_hour:.2f}")
            print(log[-1], flush=True)
    pd.DataFrame(rows).to_csv(RES / "rq4_selection.csv", index=False)
    (RES / "rq4_selection_log.txt").write_text("\n".join(log) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
