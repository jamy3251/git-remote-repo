"""Phase 2 자기 학습 루프 시뮬레이터 (PREREG RQ2·RQ4, docs/PREREG.md에 고정된 설계).

입력: data/processed/loop_summaries.parquet (응답 전 1~30분째 각 분의 직전 30분 요약 32특징),
      data/processed/kemophone_2hz_block.parquet (응답·라벨; offset 1 요약과 동일)
조건: a base(LightGBM LOSO 고정) | b esm_ft(씨앗 + 선행 ESM 파인튜닝, 같은 학습식) | b2 esm_sk(선행 ESM, sklearn L2 로지스틱 C=0.1)
      c platt(base + 사용자별 Platt) | d student(씨앗 + 교사 의사 라벨) | e guard(d + 성능 가드 → 학생 또는 base) | f oracle(p=1,d=1,b=0)
학생 학습식 = 단말 OnDeviceTrainer/head.tflite: 표준화(전체 mu/sd) → 로지스틱, 전체 배치 GD lr 0.05, 호출당 100 스텝, 최근 2000 표본, 표본 ≥50.
사용: python experiments/loop_sim/sim.py --p 0.8 --d 0.5 --b 0 --seed 0 [--workers 20]
      python experiments/loop_sim/sim.py --grid   (PREREG 격자 전체, 이미 있는 결과 파일은 건너뜀 = resume)
출력: results/loop_sim/preds_p{p}_d{d}_b{b}_s{seed}.parquet (응답별 조건별 확률), results/loop_sim/summary.csv
"""
import argparse
import itertools
import sys
import time
import zlib
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT))
from experiments.common.eval import boot_ci_users, safe_auc, user_auc, wilcoxon_paired  # noqa: E402

RES = ROOT / "results" / "loop_sim"
RES.mkdir(parents=True, exist_ok=True)
PROC = ROOT / "data" / "processed"
SUMM = PROC / "loop_summaries.parquet"
BLOCK = PROC / "kemophone_2hz_block.parquet"
BASE_OOF = PROC / "loop_base_oof.parquet"
SEEDS = PROC / "loop_seed_weights.parquet"
MUSD = PROC / "loop_musd.parquet"

LR, STEPS, MIN_SAMPLES, MAX_SAMPLES = 0.05, 100, 50, 2000
GUARD_WINDOW_MS, GUARD_MIN_N, DROP, RECOVER = 14 * 24 * 3_600_000, 15, 0.10, 0.05
TRAIN_FRAC = 0.6
MIN_EVAL = 10
TASKS = ("arousal", "valence")
GRID = dict(p=(0.6, 0.7, 0.8, 0.9), d=(0.2, 0.5), b=(0.0, 0.2), seed=(0, 1, 2))
ANCHORS = (0.1, 0.3, 1.0)   # 2.7 학생 개선: 씨앗으로 향하는 L2 앵커 λ
COND = ("base", "seed_model", "esm_ft", "esm_sk", "platt", "student", "guard") + tuple(f"student_a{l}" for l in ANCHORS) + tuple(f"esm_a{l}" for l in ANCHORS)


# ---------- 학생(단말 학습식의 numpy 재구현) ----------
def gd_steps(w, b, Z, y, steps=STEPS, lr=LR, lam=0.0, w0=None):
    """head.tflite train 시그니처와 같은 전체 배치 경사하강(Z는 이미 표준화됨).
    lam>0이면 씨앗 가중치 w0로 향하는 L2 앵커(2.7 학생 개선안; 단말에서도 닫힌 식으로 추가 가능): grad += lam·(w − w0)."""
    n = len(y)
    for _ in range(steps):
        p = 1 / (1 + np.exp(-(Z @ w + b)))
        g = p - y
        gw = (Z.T @ g) / n
        if lam > 0:
            gw = gw + lam * (w - w0)
        w = w - lr * gw
        b = b - lr * g.sum() / n
    return w, b


def sigmoid_logit(Z, w, b):
    return 1 / (1 + np.exp(-(Z @ w + b)))


# ---------- 준비(캐시) ----------
def prepare():
    import lightgbm as lgb
    from sklearn.linear_model import LogisticRegression
    from s7_cumulative import DEPLOY, load
    d, feats = load()
    if not BASE_OOF.exists():
        rows = {"pcode": d.pcode, "t": d.t}
        for task in TASKS:
            y = (d[task] > 0).astype(int).to_numpy()
            p = np.zeros(len(d))
            for pc in d.pcode.unique():
                te = (d.pcode == pc).to_numpy()
                m = lgb.LGBMClassifier(**DEPLOY, random_state=0).fit(d.loc[~te, feats], y[~te])
                p[te] = m.predict_proba(d.loc[te, feats])[:, 1]
            rows[f"base_{task}"] = p
        pd.DataFrame(rows).to_parquet(BASE_OOF)
        print("base OOF cached", flush=True)
    if not SEEDS.exists():
        X = d[feats].to_numpy(float)
        mu, sd = X.mean(0), X.std(0)
        sd = np.where(sd == 0, 1, sd)
        Z = (X - mu) / sd
        out = []
        for pc in d.pcode.unique():
            te = (d.pcode == pc).to_numpy()
            for task in TASKS:
                y = (d[task] > 0).astype(int).to_numpy()
                m = LogisticRegression(C=0.1, class_weight="balanced", max_iter=1000).fit(Z[~te], y[~te])
                out.append({"pcode": pc, "task": task, "b": float(m.intercept_[0]),
                            **{f"w{i}": v for i, v in enumerate(m.coef_[0])}})
        pd.DataFrame(out).to_parquet(SEEDS)
        pd.DataFrame({"feat": feats, "mu": mu, "sd": sd}).to_parquet(MUSD)
        print("seed weights cached", flush=True)


# ---------- 가드(DriftGuard.java와 같은 규칙) ----------
class Guard:
    def __init__(self, active=False):
        self.active = active
        self.hits = []
        self.switches = []

    def score(self, t, y, p_ship, p_stu):
        if np.isnan(p_stu):
            return
        self.hits.append((t, int((p_ship >= 0.5) == y), int((p_stu >= 0.5) == y)))
        self.hits = [h for h in self.hits if t - h[0] <= GUARD_WINDOW_MS]
        n = len(self.hits)
        if n < GUARD_MIN_N:
            return
        ship = sum(h[1] for h in self.hits) / n
        stu = sum(h[2] for h in self.hits) / n
        if self.active and stu < ship - DROP:
            self.active = False
            self.switches.append((t, "to_ship", n, ship, stu))
        elif not self.active and stu >= ship + RECOVER:
            self.active = True
            self.switches.append((t, "to_student", n, ship, stu))


def _fit_logit(X, y, C):
    from sklearn.linear_model import LogisticRegression
    return LogisticRegression(C=C, class_weight="balanced" if C < 1 else None, max_iter=500).fit(X, y)


# ---------- 사용자 1명 재생 ----------
def replay_user(args):
    pc, task, p_teach, dens, bias, seed, oracle = args
    summ = pd.read_parquet(SUMM, filters=[("pcode", "==", pc)])
    blk = pd.read_parquet(BLOCK, filters=[("pcode", "==", pc)]).sort_values("t")
    oof = pd.read_parquet(BASE_OOF, filters=[("pcode", "==", pc)]).set_index("t")
    musd = pd.read_parquet(MUSD)
    feats, mu, sd = musd.feat.tolist(), musd.mu.to_numpy(), musd.sd.to_numpy()
    seeds = pd.read_parquet(SEEDS)
    sr = seeds[(seeds.pcode == pc) & (seeds.task == task)].iloc[0]
    w_seed = np.array([sr[f"w{i}"] for i in range(len(feats))])
    b_seed = float(sr["b"])
    rng = np.random.default_rng(seed * 100003 + zlib.crc32(pc.encode()) % 10007)

    y_all = (blk[task] > 0).astype(int).to_numpy()
    ts = blk.t.to_numpy()
    T0, T1 = ts[0], ts[-1]
    split = T0 + TRAIN_FRAC * (T1 - T0)
    hours = np.arange(T0 + 3_600_000, T1 + 1, 3_600_000)
    z_by_t = {}
    for t, g in summ.groupby("t"):
        g = g.sort_values("offset")
        z_by_t[t] = ((g[feats].to_numpy() - mu) / sd, g.offset.to_numpy())

    w_stu, b_stu = w_seed.copy(), b_seed
    w_esm, b_esm = w_seed.copy(), b_seed
    anc = {l: [w_seed.copy(), b_seed, w_seed.copy(), b_seed] for l in ANCHORS}   # λ → [w_stu, b_stu, w_esm, b_esm]
    buf_x, buf_y = [], []          # 교사 표본(표준화된 32특징, 의사 라벨)
    esm_x, esm_y, esm_pb = [], [], []   # ESM 표본(offset 1 요약, 진실, base 확률)
    guard = Guard(active=False)
    out = []
    hi = 0
    n_train_calls = 0
    flips = 0
    n_teach = 0
    for i, t in enumerate(ts):
        # 1) 이 응답 전까지의 정시 학습
        while hi < len(hours) and hours[hi] < t:
            if len(buf_y) >= MIN_SAMPLES:
                X = np.array(buf_x[-MAX_SAMPLES:])
                Y = np.array(buf_y[-MAX_SAMPLES:], float)
                w_stu, b_stu = gd_steps(w_stu, b_stu, X, Y)
                for l in ANCHORS:
                    anc[l][0], anc[l][1] = gd_steps(anc[l][0], anc[l][1], X, Y, lam=l, w0=w_seed)
                n_train_calls += 1
            if len(esm_y) >= 2 and len(set(esm_y)) == 2:
                EX, EY = np.array(esm_x), np.array(esm_y, float)
                w_esm, b_esm = gd_steps(w_esm, b_esm, EX, EY)
                for l in ANCHORS:
                    anc[l][2], anc[l][3] = gd_steps(anc[l][2], anc[l][3], EX, EY, lam=l, w0=w_seed)
            hi += 1
        # 2) 예측(이 응답의 교사 표본을 넣기 전 가중치)
        Z, offs = z_by_t.get(t, (None, None))
        if Z is None or offs[0] != 1:
            continue
        z1 = Z[0]
        p_base = float(oof.loc[t, f"base_{task}"])
        p_stu = float(sigmoid_logit(z1, w_stu, b_stu)) if n_train_calls > 0 else np.nan
        p_seed = float(sigmoid_logit(z1, w_seed, b_seed))
        extra = {}
        for l in ANCHORS:
            extra[f"student_a{l}"] = float(sigmoid_logit(z1, anc[l][0], anc[l][1])) if n_train_calls > 0 else np.nan
            extra[f"esm_a{l}"] = float(sigmoid_logit(z1, anc[l][2], anc[l][3])) if len(esm_y) >= 2 else np.nan
        p_esm = float(sigmoid_logit(z1, w_esm, b_esm)) if len(esm_y) >= 2 else np.nan
        p_sk = np.nan
        p_platt = p_base
        if len(esm_y) >= 10 and len(set(esm_y)) == 2:
            EX = np.array(esm_x)
            EY = np.array(esm_y)
            m2, s2 = EX.mean(0), EX.std(0)
            s2[s2 == 0] = 1
            p_sk = float(_fit_logit((EX - m2) / s2, EY, 0.1).predict_proba(((z1 - m2) / s2)[None])[0, 1])
            lb = np.log(np.array(esm_pb) / (1 - np.array(esm_pb)))[:, None]
            pb_c = min(max(p_base, 1e-4), 1 - 1e-4)
            p_platt = float(_fit_logit(lb, EY, 1e4).predict_proba([[np.log(pb_c / (1 - pb_c))]])[0, 1])
        active_before = guard.active
        p_guard = p_stu if (guard.active and not np.isnan(p_stu)) else p_base
        y = int(y_all[i])
        out.append({"pcode": pc, "task": task, "t": t, "y": y, "eval": bool(t > split),
                    "day": int((t - T0) // 86_400_000),
                    "base": p_base, "seed_model": p_seed, **extra, "esm_ft": p_esm, "esm_sk": p_sk, "platt": p_platt, "student": p_stu, "guard": p_guard,
                    "guard_active": active_before, "n_teach": n_teach, "n_esm": len(esm_y), "n_train_calls": n_train_calls})
        # 3) 가드 채점(프로브 B = 모든 응답)
        guard.score(t, y, p_base, p_stu)
        # 4) 표본 추가: ESM 1건 + 교사 분들
        esm_x.append(z1)
        esm_y.append(y)
        esm_pb.append(min(max(p_base, 1e-4), 1 - 1e-4))
        for zrow in Z:
            if not oracle and rng.random() >= dens:
                continue
            if oracle:
                lab = y
            else:
                flip_p = (1 - p_teach) * ((1 + bias) if y == 0 else (1 - bias))
                flip = rng.random() < flip_p
                lab = 1 - y if flip else y
                flips += int(flip)
            buf_x.append(zrow)
            buf_y.append(lab)
            n_teach += 1
    df = pd.DataFrame(out)
    df["switches"] = len(guard.switches)
    df["flip_rate"] = flips / max(n_teach, 1)
    return df, [(pc, task, *s) for s in guard.switches]


def cell_tag(p, d, b, oracle):
    return "oracle" if oracle else f"p{p}_d{d}_b{b}"


def run_cell(p, d, b, seed, workers, oracle=False, resume=True):
    tag = cell_tag(p, d, b, oracle)
    out = RES / f"preds_{tag}_s{seed}.parquet"
    if resume and out.exists():
        return pd.read_parquet(out)
    blk = pd.read_parquet(BLOCK, columns=["pcode"])
    jobs = [(pc, task, p, d, b, seed, oracle) for pc in sorted(blk.pcode.unique()) for task in TASKS]
    t0 = time.time()
    parts, sw = [], []
    with ProcessPoolExecutor(max_workers=workers) as ex:
        for df, s in ex.map(replay_user, jobs, chunksize=2):
            parts.append(df)
            sw += s
    allp = pd.concat(parts, ignore_index=True)
    for k, v in (("p", p), ("d", d), ("b", b), ("seed", seed), ("oracle", oracle)):
        allp[k] = v
    allp.to_parquet(out)
    pd.DataFrame(sw, columns=["pcode", "task", "t", "to", "n", "ship", "student"]).to_csv(
        RES / f"guard_switches_{tag}_s{seed}.csv", index=False)
    print(f"[{tag} s{seed}] {len(allp)} preds in {time.time() - t0:.0f}s", flush=True)
    return allp


def summarize(allp):
    rows = []
    ev = allp[allp["eval"]]
    for (task, p, d, b, seed, oracle), g in ev.groupby(["task", "p", "d", "b", "seed", "oracle"]):
        uas = {c: user_auc(g, "y", c, min_n=MIN_EVAL) for c in COND}
        for c in COND:
            ua = uas[c].dropna()
            pw, r, n = wilcoxon_paired(uas[c], uas["base"]) if c != "base" else (np.nan, np.nan, 0)
            pw2, r2, _ = wilcoxon_paired(uas[c], uas["esm_ft"]) if c not in ("base", "esm_ft") else (np.nan, np.nan, 0)
            mean, lo, hi = boot_ci_users(uas[c], uas["base"]) if c != "base" else (np.nan, np.nan, np.nan)
            mean2, lo2, hi2 = boot_ci_users(uas[c], uas["esm_ft"]) if c not in ("base", "esm_ft") else (np.nan, np.nan, np.nan)
            gt = (uas[c] > uas["base"]).reindex(ua.index).mean() if (c != "base" and len(ua)) else np.nan
            rows.append({"task": task, "p": p, "d": d, "b": b, "seed": seed, "oracle": oracle, "cond": c,
                         "user_mean_auc": float(ua.mean()) if len(ua) else np.nan, "n_users": int(len(ua)),
                         "pooled_auc": safe_auc(g.y, g[c]),
                         "diff_vs_base": mean, "ci_lo": lo, "ci_hi": hi, "wilcoxon_p_vs_base": pw, "effect_r_vs_base": r,
                         "diff_vs_esm_ft": mean2, "ci_lo_esm": lo2, "ci_hi_esm": hi2,
                         "wilcoxon_p_vs_esm_ft": pw2, "effect_r_vs_esm_ft": r2,
                         "frac_users_gt_base": float(gt) if gt == gt else np.nan,
                         "n_eval": int(len(g)), "mean_n_teach": float(g.n_teach.mean()), "flip_rate": float(g.flip_rate.mean()),
                         "guard_active_frac": float(g.guard_active.mean()),
                         "switches_per_user": float(g.groupby("pcode").switches.first().mean())})
    return pd.DataFrame(rows)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--p", type=float)
    ap.add_argument("--d", type=float)
    ap.add_argument("--b", type=float, default=0.0)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--workers", type=int, default=20)
    ap.add_argument("--grid", action="store_true")
    ap.add_argument("--oracle", action="store_true")
    ap.add_argument("--no-resume", action="store_true")
    ap.add_argument("--summary-only", action="store_true")
    a = ap.parse_args()
    prepare()
    if not a.summary_only:
        if a.grid:
            for seed in GRID["seed"]:
                run_cell(1.0, 1.0, 0.0, seed, a.workers, oracle=True, resume=not a.no_resume)
            for p, d, b, seed in itertools.product(GRID["p"], GRID["d"], GRID["b"], GRID["seed"]):
                run_cell(p, d, b, seed, a.workers, resume=not a.no_resume)
        elif a.oracle:
            run_cell(1.0, 1.0, 0.0, a.seed, a.workers, oracle=True, resume=not a.no_resume)
        else:
            run_cell(a.p, a.d, a.b, a.seed, a.workers, resume=not a.no_resume)
    files = sorted(RES.glob("preds_*.parquet"))
    allp = pd.concat([pd.read_parquet(f) for f in files], ignore_index=True)
    s = summarize(allp)
    s.to_csv(RES / "summary.csv", index=False)
    pd.set_option("display.width", 250)
    cols = ["task", "p", "d", "b", "seed", "oracle", "cond", "user_mean_auc", "n_users", "pooled_auc",
            "diff_vs_base", "ci_lo", "ci_hi", "diff_vs_esm_ft", "ci_lo_esm", "ci_hi_esm", "wilcoxon_p_vs_esm_ft"]
    print(s[cols].to_string(index=False))


if __name__ == "__main__":
    main()
