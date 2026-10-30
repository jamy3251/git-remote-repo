"""Phase 1 오프라인 벤치마크 (PREREG RQ1·H1a·H1b; 프로토콜 = experiments/common/eval.py).

데이터: K-EmoPhone 3,771 응답(기본 모델 집합). 라벨 >0. 평가 LOSO(사용자 1명 제외 학습, 전 응답 OOF 예측).
1.2 베이스라인: majority(상수) · hour(시각 sin/cos만, LightGBM) · user_mean(사용자 평균 라벨 = 개인 간 차이의 상한, 전체 AUROC만)
               · activity(OS 활동 범주 phone_*, LightGBM) · coarse(손목 3범주, LightGBM) · movement32(기본 모델) · movement32+hour
1.3 Ablation: 특징군(magnitude=hp_*, abruptness=jerk_*, stillness=sec_std_*·still_frac; 각 med+iqr) · 모델(LightGBM 50×3 / 로지스틱 / MLP 16) ·
               이진화(>0 vs 사용자 중앙값 초과; 평가도 같은 라벨) · 창 길이(s14_window_oof.parquet 재사용, 1/5/10/15/30/60분)
지표: 전체 AUROC, 사용자별 AUROC 평균(평가 응답 ≥20·두 부류) + 참가자 부트스트랩 95% CI, base 대비 차이 CI·Wilcoxon, AUPRC·MCC·Brier·ECE.
사용: python experiments/benchmark/benchmark.py [--workers 4] [--seed 0]   (OOF 캐시 results/benchmark/oof_*.parquet 가 있으면 건너뜀)
출력: results/benchmark/summary.csv, results/benchmark/benchmark_log.txt
"""
import argparse
import sys
import warnings
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.neural_network import MLPClassifier

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT))
from experiments.common.eval import boot_ci_users, metrics, safe_auc, user_auc, wilcoxon_paired  # noqa: E402

warnings.filterwarnings("ignore")
PROC = ROOT / "data" / "processed"
RES = ROOT / "results" / "benchmark"
RES.mkdir(parents=True, exist_ok=True)
DEPLOY = dict(n_estimators=50, learning_rate=0.05, num_leaves=3, min_child_samples=20, subsample=0.8,
              subsample_freq=1, class_weight="balanced", verbose=-1)
TASKS = ("arousal", "valence")
MIN_N = 20
NBOOT = 1000


def load():
    d = pd.read_parquet(PROC / "kemophone_2hz_block.parquet").sort_values(["pcode", "t"]).reset_index(drop=True)
    e = pd.read_parquet(PROC / "kemophone_esm_features.parquet")
    act = [c for c in e.columns if c.startswith("phone_")]
    coarse = [c for c in e.columns if c.startswith("coarse_")]
    d = d.merge(e[["pcode", "t"] + act + coarse], on=["pcode", "t"], how="left")
    hour = pd.to_datetime(d["t"], unit="ms", utc=True).dt.tz_convert("Asia/Seoul").dt.hour.to_numpy()
    d["hs"], d["hc"] = np.sin(2 * np.pi * hour / 24), np.cos(2 * np.pi * hour / 24)
    mv = [c for c in d.columns if c.startswith("b2_")]
    groups = {
        "movement32": mv,
        "hour": ["hs", "hc"],
        "activity": act,
        "coarse": coarse,
        "movement32+hour": mv + ["hs", "hc"],
        "magnitude": [c for c in mv if "_hp_" in c],
        "abruptness": [c for c in mv if "_jerk_" in c],
        "stillness": [c for c in mv if "sec_std" in c or "still_frac" in c],
        "median16": [c for c in mv if c.startswith("b2_med_")],
        "iqr16": [c for c in mv if c.startswith("b2_iqr_")],
    }
    return d, groups


def make_model(kind, seed):
    if kind == "lgbm":
        return lgb.LGBMClassifier(**DEPLOY, random_state=seed)
    if kind == "logit":
        from sklearn.pipeline import make_pipeline
        from sklearn.preprocessing import StandardScaler
        return make_pipeline(StandardScaler(), LogisticRegression(C=0.1, class_weight="balanced", max_iter=1000))
    if kind == "mlp":
        from sklearn.pipeline import make_pipeline
        from sklearn.preprocessing import StandardScaler
        return make_pipeline(StandardScaler(), MLPClassifier(hidden_layer_sizes=(16,), alpha=1e-2, max_iter=500, random_state=seed))
    raise ValueError(kind)


def loso_job(args):
    name, feats, kind, task, label_rule, seed = args
    d, _ = load()
    out = RES / f"oof_{name}_{kind}_{task}_{label_rule}_s{seed}.parquet"
    if out.exists():
        return name, kind, task, label_rule, seed, out
    if label_rule == "gt0":
        y = (d[task] > 0).astype(int).to_numpy()
    else:  # user median
        med = d.groupby("pcode")[task].transform("median")
        y = (d[task] > med).astype(int).to_numpy()
    X = d[feats].to_numpy(float)
    X = np.nan_to_num(X, nan=0.0)
    p = np.zeros(len(d))
    for pc in d.pcode.unique():
        te = (d.pcode == pc).to_numpy()
        if len(np.unique(y[~te])) < 2:
            p[te] = 0.5
            continue
        m = make_model(kind, seed).fit(X[~te], y[~te])
        p[te] = m.predict_proba(X[te])[:, 1]
    pd.DataFrame({"pcode": d.pcode, "t": d.t, "y": y, "p": p}).to_parquet(out)
    return name, kind, task, label_rule, seed, out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--seed", type=int, default=0)
    a = ap.parse_args()
    d, groups = load()
    jobs = []
    for task in TASKS:
        for name in ("movement32", "hour", "activity", "coarse", "movement32+hour", "magnitude", "abruptness", "stillness", "median16", "iqr16"):
            jobs.append((name, groups[name], "lgbm", task, "gt0", a.seed))
        for kind in ("logit", "mlp"):
            jobs.append(("movement32", groups["movement32"], kind, task, "gt0", a.seed))
        jobs.append(("movement32", groups["movement32"], "lgbm", task, "umed", a.seed))
    with ProcessPoolExecutor(max_workers=a.workers) as ex:
        done = list(ex.map(loso_job, jobs))
    rows, log = [], []
    for task in TASKS:
        y0 = (d[task] > 0).astype(int)
        base = pd.read_parquet(RES / f"oof_movement32_lgbm_{task}_gt0_s{a.seed}.parquet")
        ua_base = user_auc(base, "y", "p", min_n=MIN_N)

        def add(label, df, ua_ref=ua_base, note=""):
            ua = user_auc(df, "y", "p", min_n=MIN_N)
            mean, lo, hi = boot_ci_users(ua, n=NBOOT)
            dm, dlo, dhi = boot_ci_users(ua, ua_ref, n=NBOOT) if label != "movement32 lgbm gt0" else (np.nan, np.nan, np.nan)
            pw, r, n = wilcoxon_paired(ua, ua_ref) if label != "movement32 lgbm gt0" else (np.nan, np.nan, 0)
            m = metrics(df.y, df.p)
            rows.append({"task": task, "model": label, "note": note, **m, "user_mean_auc": mean, "user_ci_lo": lo, "user_ci_hi": hi,
                         "n_users": int(ua.notna().sum()), "diff_vs_base": dm, "diff_ci_lo": dlo, "diff_ci_hi": dhi,
                         "wilcoxon_p": pw, "effect_r": r})
            log.append(f"[{task}] {label:32s} pooled {m['auroc']:.3f} | user-mean {mean:.3f} [{lo:.3f}, {hi:.3f}] (n={rows[-1]['n_users']}) | "
                       f"Δbase {dm:+.3f} [{dlo:+.3f}, {dhi:+.3f}] p={pw:.3g} | AUPRC {m['auprc']:.3f} MCC {m['mcc']:.3f} Brier {m['brier']:.3f} ECE {m['ece']:.3f}")
            print(log[-1], flush=True)

        for name, kind, t_, rule, s_, path in done:
            if t_ != task:
                continue
            df = pd.read_parquet(path)
            if rule == "umed":
                # 이진화 ablation: 사용자 중앙값 라벨로 학습·평가. base 비교는 같은 라벨로 평가한 base OOF와.
                ref = base.copy()
                ref["y"] = df["y"].to_numpy()
                add(f"{name} {kind} {rule}", df, user_auc(ref, "y", "p", min_n=MIN_N), note="label=user-median; Δ vs base scored on same labels")
                add("movement32 lgbm gt0 scored on umed", ref, user_auc(ref, "y", "p", min_n=MIN_N), note="base model (trained >0) evaluated with user-median labels")
            else:
                add(f"{name} {kind} {rule}", df)
        # 상수·사용자 평균 베이스라인(사용자 안 AUROC 정의 불가 → 전체만)
        maj = base.copy()
        maj["p"] = 0.5
        um = base.copy()
        um["p"] = um.groupby("pcode").y.transform("mean")
        for label, df in (("majority (constant)", maj), ("user_mean label (between-user ceiling)", um)):
            m = metrics(df.y, df.p)
            rows.append({"task": task, "model": label, "note": "within-user AUROC undefined", **m})
            log.append(f"[{task}] {label:32s} pooled {m['auroc']:.3f}")
        # 창 길이(s14 OOF 재사용)
        w = pd.read_parquet(PROC / "s14_window_oof.parquet")
        ua30 = user_auc(w.rename(columns={f"y_{task}": "y", f"p_{task}_w30": "p"}), "y", "p", min_n=MIN_N)
        for win in (1, 5, 10, 15, 30, 60):
            df = w.rename(columns={f"y_{task}": "y", f"p_{task}_w{win}": "p"})[["pcode", "t", "y", "p"]]
            ua = user_auc(df, "y", "p", min_n=MIN_N)
            mean, lo, hi = boot_ci_users(ua, n=NBOOT)
            dm, dlo, dhi = boot_ci_users(ua, ua30, n=NBOOT)
            pw, r, n = wilcoxon_paired(ua, ua30)
            m = metrics(df.y, df.p)
            rows.append({"task": task, "model": f"window {win} min (s14 OOF, n=3160)", "note": "Δ vs 30-min window", **m, "user_mean_auc": mean,
                         "user_ci_lo": lo, "user_ci_hi": hi, "n_users": int(ua.notna().sum()), "diff_vs_base": dm, "diff_ci_lo": dlo,
                         "diff_ci_hi": dhi, "wilcoxon_p": pw, "effect_r": r})
            log.append(f"[{task}] window {win:2d} min pooled {m['auroc']:.3f} | user-mean {mean:.3f} [{lo:.3f}, {hi:.3f}] | Δ30 {dm:+.3f} [{dlo:+.3f}, {dhi:+.3f}] p={pw:.3g}")
            print(log[-1], flush=True)
    pd.DataFrame(rows).to_csv(RES / "summary.csv", index=False)
    (RES / "benchmark_log.txt").write_text("\n".join(log) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
