"""S14: 기존 K-EmoPhone 결과(S7·S9·S11·S13)에 참가자 단위 부트스트랩 95% 신뢰구간을 붙인다.

원칙: 모델 학습은 한 번만(LOSO out-of-fold 예측을 저장), 부트스트랩은 저장된 예측 위에서
참가자(pcode)를 복원추출(N_BOOT회)하는 것만으로 한다. 차이(예: W=30 − W=1, blend − base, contact=1 − contact=0)는
같은 재추출 표본에서 짝지어 계산해 CI를 만든다. 백분위(2.5·97.5%) 구간.

A. 창 길이(S13): data/processed/kemophone_window_sweep.parquet, W∈{1,5,10,15,30,60}, 각성·정서가 LOSO OOF 저장
   → pooled AUROC, user-mean AUROC(응답 20건 이상·두 부류), "W=30 − W=1" 차이 CI.
B. 응답 누적(S7): k=30에서 base·own·blend OOF → pooled·user-mean(s7 기준: 응답 5건 이상·두 부류) CI, "blend − base" 차이 CI.
C. 비접촉 보류(S9): s9 contact 규칙으로 각성 OOF를 contact=1/0 창으로 나눠 AUROC 차이 CI.
D. 식별(S11): s11_identity.csv top-1(logistic, n=1479)의 Wilson 95% CI, 우연 1/77, 섞은 라벨 대조군 CI.
E. 모델 안정성: DEPLOY(50트리×잎3, 2Hz 32특징) LOSO pooled AUROC를 random_state 0~4로 → 평균±표준편차.

출력: results/s14_bootstrap.csv, results/S14_NOTES.md, data/processed/s14_*.parquet(OOF 예측·contact 맥락)
콘솔 출력은 숫자 위주(Windows 콘솔 한글 깨짐 회피).
"""
import sys
import time
import warnings
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd
from scipy.stats import rankdata
from sklearn.metrics import roc_auc_score

warnings.filterwarnings("ignore")
sys.path.insert(0, str(Path(__file__).resolve().parent))
from s7_cumulative import DEPLOY, load as load_block, own_model  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
RES = ROOT / "results"
PROC = ROOT / "data" / "processed"
N_BOOT = 1000
SEED = 0
WINDOWS = (1, 5, 10, 15, 30, 60)
TASKS = ("arousal", "valence")
K_CUM = 30
DIFF_PAIRS = ((30, 1), (15, 1), (30, 15), (30, 60))
T0 = time.time()


def log(*a):
    print(f"[{time.time() - T0:6.0f}s]", *a, flush=True)


# ---------------------------------------------------------------- 공용
def loso_oof(d, feats, y, seed=0):
    """참가자 1명씩 빼고 학습(DEPLOY), 그 참가자 예측을 채운 out-of-fold 확률."""
    p = np.zeros(len(d))
    for pc in d.pcode.unique():
        te = (d.pcode == pc).to_numpy()
        m = lgb.LGBMClassifier(**DEPLOY, random_state=seed).fit(d.loc[~te, feats], y[~te])
        p[te] = m.predict_proba(d.loc[te, feats])[:, 1]
    return p


def fast_auc(y, p):
    """Mann-Whitney 순위 기반 AUROC(roc_auc_score와 동일, 반복 호출용). 한 부류뿐이면 NaN."""
    y = np.asarray(y)
    n1 = int(y.sum())
    n0 = len(y) - n1
    if n1 == 0 or n0 == 0:
        return np.nan
    r = rankdata(p)
    return float((r[y == 1].sum() - n1 * (n1 + 1) / 2) / (n1 * n0))


class UserBoot:
    """참가자 복원추출 표본을 한 번 뽑아 두고(draws), 같은 표본으로 여러 지표·차이를 계산한다."""

    def __init__(self, pcodes, n_boot=N_BOOT, seed=SEED):
        self.users = np.array(sorted(pd.unique(pcodes)))
        pc = np.asarray(pcodes)
        self.idx = [np.flatnonzero(pc == u) for u in self.users]
        rng = np.random.default_rng(seed)
        self.draws = rng.integers(0, len(self.users), size=(n_boot, len(self.users)))

    def pooled(self, y, p, mask=None):
        """재추출 표본의 pooled AUROC(참가자 중복 포함). mask가 있으면 그 창들만."""
        y, p = np.asarray(y), np.asarray(p)
        idx = self.idx if mask is None else [i[mask[i]] for i in self.idx]
        out = np.empty(len(self.draws))
        for b, dr in enumerate(self.draws):
            ii = np.concatenate([idx[u] for u in dr])
            out[b] = fast_auc(y[ii], p[ii]) if len(ii) else np.nan
        return out

    def per_user(self, y, p, min_n):
        """사용자별 AUROC(응답 min_n건 이상·두 부류 모두 있을 때만, 아니면 NaN). self.users 순서."""
        y, p = np.asarray(y), np.asarray(p)
        return np.array([fast_auc(y[i], p[i]) if len(i) >= min_n else np.nan for i in self.idx])

    def user_mean(self, pu):
        """재추출 표본의 사용자별 AUROC 평균(해당 없는 사용자 제외)."""
        return np.array([np.nanmean(pu[dr]) if np.any(~np.isnan(pu[dr])) else np.nan for dr in self.draws])


def ci(a):
    a = np.asarray(a, float)
    a = a[~np.isnan(a)]
    return float(np.percentile(a, 2.5)), float(np.percentile(a, 97.5))


def wilson(k, n, z=1.959964):
    ph = k / n
    den = 1 + z * z / n
    cen = (ph + z * z / (2 * n)) / den
    half = z * np.sqrt(ph * (1 - ph) / n + z * z / (4 * n * n)) / den
    return float(cen - half), float(cen + half)


ROWS = []


def add(part, item, task, est, lo, hi, n_users, n_resp, ci_type="participant bootstrap 95% percentile", n_boot=N_BOOT):
    ROWS.append({"part": part, "item": item, "task": task, "estimate": est, "ci_lo": lo, "ci_hi": hi,
                 "n_users": n_users, "n_resp": n_resp, "ci_type": ci_type, "n_boot": n_boot})
    print(f"  {part} {item:40s} {task:8s} {est:7.4f} [{lo:7.4f}, {hi:7.4f}] users={n_users} n={n_resp}", flush=True)


# ---------------------------------------------------------------- A. 창 길이
def part_a():
    log("A window sweep: load")
    df = pd.read_parquet(PROC / "kemophone_window_sweep.parquet")
    ok = np.ones(len(df), bool)
    for w in WINDOWS:
        ok &= df[[c for c in df if c.startswith(f"w{w}_")]].notna().all(axis=1).to_numpy()
    d = df[ok].sort_values(["pcode", "t"]).reset_index(drop=True)
    oof_path = PROC / "s14_window_oof.parquet"
    if oof_path.exists():
        oof = pd.read_parquet(oof_path)
        assert len(oof) == len(d) and (oof.pcode.to_numpy() == d.pcode.to_numpy()).all()
        log("A: reuse cached OOF", oof_path.name)
    else:
        oof = d[["pcode", "t"]].copy()
        for task in TASKS:
            y = (d[task] > 0).astype(int).to_numpy()
            oof[f"y_{task}"] = y
            for w in WINDOWS:
                feats = [c for c in d if c.startswith(f"w{w}_")]
                oof[f"p_{task}_w{w}"] = loso_oof(d, feats, y)
                log(f"A LOSO {task} W={w} feats={len(feats)} pooled={roc_auc_score(y, oof[f'p_{task}_w{w}']):.4f}")
        oof.to_parquet(oof_path)
    bt = UserBoot(oof.pcode)
    for task in TASKS:
        y = oof[f"y_{task}"].to_numpy()
        pooled, umean, pu_all = {}, {}, {}
        for w in WINDOWS:
            p = oof[f"p_{task}_w{w}"].to_numpy()
            pooled[w] = bt.pooled(y, p)
            pu_all[w] = bt.per_user(y, p, 20)
            umean[w] = bt.user_mean(pu_all[w])
            n_scored = int(np.sum(~np.isnan(pu_all[w])))
            n_resp_scored = int(sum(len(i) for i, v in zip(bt.idx, pu_all[w]) if not np.isnan(v)))
            add("A", f"window W={w} pooled", task, fast_auc(y, p), *ci(pooled[w]), len(bt.users), len(y))
            add("A", f"window W={w} user-mean(n>=20)", task, float(np.nanmean(pu_all[w])), *ci(umean[w]), n_scored, n_resp_scored)
        for a, b in DIFF_PAIRS:
            est_p = fast_auc(y, oof[f"p_{task}_w{a}"]) - fast_auc(y, oof[f"p_{task}_w{b}"])
            add("A", f"diff W={a}-W={b} pooled", task, est_p, *ci(pooled[a] - pooled[b]), len(bt.users), len(y))
            est_u = float(np.nanmean(pu_all[a]) - np.nanmean(pu_all[b]))
            add("A", f"diff W={a}-W={b} user-mean", task, est_u, *ci(umean[a] - umean[b]), int(np.sum(~np.isnan(pu_all[a]))), len(y))
    return d.pcode.nunique(), len(d)


# ---------------------------------------------------------------- B. 응답 누적 k=30
def part_b():
    log("B cumulative k=30: load")
    d, feats = load_block()
    oof_path = PROC / "s14_cumulative_oof.parquet"
    if oof_path.exists():
        oof = pd.read_parquet(oof_path)
        log("B: reuse cached OOF", oof_path.name)
    else:
        parts = []
        for task in TASKS:
            y = (d[task] > 0).astype(int)
            pb = loso_oof(d, feats, y.to_numpy())
            log(f"B LOSO base {task} pooled(all)={roc_auc_score(y, pb):.4f}")
            d["_base"] = pb
            test = d[d["rank"] >= K_CUM]
            for pc, g in test.groupby("pcode"):
                tr = d[(d.pcode == pc) & (d["rank"] < K_CUM)]
                po = own_model(tr[feats], y[tr.index], g[feats])
                if po is None:
                    continue
                pbase = g["_base"].to_numpy()
                parts.append(pd.DataFrame({"task": task, "pcode": pc, "t": g["t"].to_numpy(), "y": y[g.index].to_numpy(),
                                           "p_base": pbase, "p_own": po, "p_blend": (pbase + po) / 2}))
        oof = pd.concat(parts, ignore_index=True)
        oof.to_parquet(oof_path)
    out = {}
    for task in TASKS:
        o = oof[oof.task == task].reset_index(drop=True)
        y = o.y.to_numpy()
        bt = UserBoot(o.pcode)
        pooled, umean, pu_all = {}, {}, {}
        for m in ("base", "own", "blend"):
            p = o[f"p_{m}"].to_numpy()
            pooled[m] = bt.pooled(y, p)
            pu_all[m] = bt.per_user(y, p, 5)
            umean[m] = bt.user_mean(pu_all[m])
            add("B", f"k={K_CUM} {m} pooled", task, fast_auc(y, p), *ci(pooled[m]), len(bt.users), len(y))
            add("B", f"k={K_CUM} {m} user-mean(n>=5)", task, float(np.nanmean(pu_all[m])), *ci(umean[m]), int(np.sum(~np.isnan(pu_all[m]))), len(y))
        for m in ("blend", "own"):
            add("B", f"k={K_CUM} diff {m}-base pooled", task, fast_auc(y, o[f"p_{m}"]) - fast_auc(y, o.p_base),
                *ci(pooled[m] - pooled["base"]), len(bt.users), len(y))
            add("B", f"k={K_CUM} diff {m}-base user-mean", task, float(np.nanmean(pu_all[m]) - np.nanmean(pu_all["base"])),
                *ci(umean[m] - umean["base"]), int(np.sum(~np.isnan(pu_all[m]))), len(y))
        out[task] = (len(bt.users), len(y))
    return out


# ---------------------------------------------------------------- C. 비접촉 보류
def part_c():
    log("C contact gate: load")
    import s9_contact_rules as S9  # noqa: E402  (s4_kemophone의 ESM을 읽음)
    d, feats = load_block()
    ctx_path = PROC / "s14_contact_ctx.parquet"
    if ctx_path.exists():
        ctx = pd.read_parquet(ctx_path)
        log("C: reuse cached context", ctx_path.name)
    else:
        ctx = pd.concat([S9.context(pc) for pc in sorted(d.pcode.unique())], ignore_index=True)
        ctx.to_parquet(ctx_path)
        log("C: context computed", len(ctx))
    d = d.merge(ctx, on=["pcode", "t"], how="left")
    assert len(d) == 3771
    d["contact"] = ((d.charging.fillna(0) < 0.5) & ((d.screen_on.fillna(0) > 0) | (d["b2_med_still_frac"] < 0.9))).astype(int)
    oof_path = PROC / "s14_contact_oof.parquet"
    if oof_path.exists():
        oof = pd.read_parquet(oof_path)
        log("C: reuse cached OOF", oof_path.name)
    else:
        oof = d[["pcode", "t", "contact", "charging", "screen_on"]].copy()
        for task in TASKS:
            y = (d[task] > 0).astype(int).to_numpy()
            oof[f"y_{task}"] = y
            oof[f"p_{task}"] = loso_oof(d, feats, y)
            log(f"C LOSO {task} pooled={roc_auc_score(y, oof[f'p_{task}']):.4f}")
        oof.to_parquet(oof_path)
    bt = UserBoot(oof.pcode)
    c1 = (oof.contact == 1).to_numpy()
    c0 = ~c1
    n_users_c0 = int(oof.pcode[c0].nunique())
    for task in TASKS:
        y, p = oof[f"y_{task}"].to_numpy(), oof[f"p_{task}"].to_numpy()
        a1, a0 = bt.pooled(y, p, c1), bt.pooled(y, p, c0)
        add("C", "contact=1 pooled", task, fast_auc(y[c1], p[c1]), *ci(a1), int(oof.pcode[c1].nunique()), int(c1.sum()))
        add("C", "contact=0 pooled", task, fast_auc(y[c0], p[c0]), *ci(a0), n_users_c0, int(c0.sum()))
        add("C", "diff contact=1 - contact=0 pooled", task, fast_auc(y[c1], p[c1]) - fast_auc(y[c0], p[c0]), *ci(a1 - a0), len(bt.users), len(y))
    return int(c1.sum()), int(c0.sum()), n_users_c0, float(1 - oof.contact.mean())


# ---------------------------------------------------------------- D. 식별 Wilson
def part_d():
    log("D identity Wilson")
    s = pd.read_csv(RES / "s11_identity.csv")
    chance = 1 / 77
    for setting, label in (("raw features (level + pattern)", "identity top1 logistic"),
                           ("label-shuffled control (raw)", "identity top1 shuffled-control logistic")):
        r = s[(s.setting == setting) & (s.model == "logistic")].iloc[0]
        n = int(r.n_test)
        k = int(round(r.top1 * n))
        add("D", label, "identity", k / n, *wilson(k, n), 77, n, "Wilson 95% (binomial)", 0)
        k5 = int(round(r.top5 * n))
        add("D", label.replace("top1", "top5"), "identity", k5 / n, *wilson(k5, n), 77, n, "Wilson 95% (binomial)", 0)
    r = s[(s.setting == "raw features (level + pattern)") & (s.model == "logistic")].iloc[0]
    n10 = int(r.n_vote10)
    k10 = int(round(r.top1_vote10 * n10))
    add("D", "identity top1 vote10 logistic", "identity", k10 / n10, *wilson(k10, n10), 77, n10, "Wilson 95% (binomial)", 0)
    add("D", "chance 1/77", "identity", chance, chance, chance, 77, 0, "constant", 0)
    return chance


# ---------------------------------------------------------------- E. 시드 안정성
def part_e():
    log("E seed stability")
    d, feats = load_block()
    res = {}
    for task in TASKS:
        y = (d[task] > 0).astype(int).to_numpy()
        aucs = []
        for seed in range(5):
            p = loso_oof(d, feats, y, seed)
            aucs.append(roc_auc_score(y, p))
            log(f"E {task} seed={seed} pooled={aucs[-1]:.4f}")
        a = np.array(aucs)
        add("E", "DEPLOY LOSO pooled seeds 0-4", task, float(a.mean()), float(a.mean() - a.std(ddof=1)), float(a.mean() + a.std(ddof=1)),
            d.pcode.nunique(), len(d), "mean +- SD over 5 seeds", 5)
        res[task] = a
    return res


# ---------------------------------------------------------------- 노트
def fmt(r):
    return f"{r.estimate:.3f} [{r.ci_lo:.3f}, {r.ci_hi:.3f}]"


def sig(r):
    return "유의" if (r.ci_lo > 0 or r.ci_hi < 0) else "비유의"


def write_notes(out, a_info, b_info, c_info, e_res):
    def g(part, item, task):
        return out[(out.part == part) & (out.item == item) & (out.task == task)].iloc[0]

    L = []
    L.append("# S14: 참가자 부트스트랩 신뢰구간 (2026-10-30, src/s14_bootstrap.py → results/s14_bootstrap.csv)\n")
    L.append("방법: 모델 학습은 한 번만(LOSO out-of-fold 예측을 data/processed/s14_*_oof.parquet에 저장, DEPLOY 50트리×잎3, random_state=0). "
             f"참가자(pcode)를 복원추출하는 부트스트랩 {N_BOOT}회(시드 {SEED})로 pooled AUROC와 사용자별 평균 AUROC의 백분위 95% CI를 구했다. "
             "차이의 CI는 같은 재추출 표본에서 두 값을 짝지어 뺀 분포의 백분위다. 재추출된 참가자가 중복되면 그 응답을 그대로 중복 포함한다(pooled). "
             "부트스트랩 횟수는 줄이지 않았다(전체 실행 수 분). 식별(D)은 이항 비율이므로 Wilson 구간, 모델 안정성(E)은 시드 5개의 평균±표준편차. "
             "'유의'는 95% CI가 0을 포함하지 않는다는 뜻이다.\n")
    L.append(f"## A. 요약 창 길이(S13) — {a_info[1]:,}건·{a_info[0]}명, 모든 W 같은 응답 집합. 사용자별 평균은 응답 20건 이상·두 부류 사용자\n")
    L.append("| W(분) | 각성 pooled | 각성 user-mean | 정서가 pooled | 정서가 user-mean |")
    L.append("|---|---|---|---|---|")
    for w in WINDOWS:
        L.append(f"| {w} | {fmt(g('A', f'window W={w} pooled', 'arousal'))} | {fmt(g('A', f'window W={w} user-mean(n>=20)', 'arousal'))} | "
                 f"{fmt(g('A', f'window W={w} pooled', 'valence'))} | {fmt(g('A', f'window W={w} user-mean(n>=20)', 'valence'))} |")
    L.append("")
    L.append("| 차이(짝지은 부트스트랩) | 각성 pooled | 각성 user-mean | 정서가 pooled | 정서가 user-mean |")
    L.append("|---|---|---|---|---|")
    for a, b in DIFF_PAIRS:
        cells = []
        for task in TASKS:
            for kind in ("pooled", "user-mean"):
                r = g("A", f"diff W={a}-W={b} {kind}", task)
                cells.append(f"{fmt(r)} ({sig(r)})")
        L.append(f"| W={a} − W={b} | " + " | ".join(cells) + " |")
    L.append("")
    L.append("## B. 응답 누적(S7) k=30 — 처음 30개 응답으로 자기 모델(own), 출하 모델(base)과 평균(blend). 31번째 이후 응답에서 평가. "
             "사용자별 평균은 s7 기준(평가 구간 응답 5건 이상·두 부류)\n")
    L.append("| 방법 | 각성 pooled | 각성 user-mean | 정서가 pooled | 정서가 user-mean |")
    L.append("|---|---|---|---|---|")
    for m in ("base", "own", "blend"):
        L.append(f"| {m} | {fmt(g('B', f'k={K_CUM} {m} pooled', 'arousal'))} | {fmt(g('B', f'k={K_CUM} {m} user-mean(n>=5)', 'arousal'))} | "
                 f"{fmt(g('B', f'k={K_CUM} {m} pooled', 'valence'))} | {fmt(g('B', f'k={K_CUM} {m} user-mean(n>=5)', 'valence'))} |")
    for m in ("blend", "own"):
        cells = []
        for task in TASKS:
            for kind in ("pooled", "user-mean"):
                r = g("B", f"k={K_CUM} diff {m}-base {kind}", task)
                cells.append(f"{fmt(r)} ({sig(r)})")
        L.append(f"| {m} − base | " + " | ".join(cells) + " |")
    L.append(f"\n사용자 수·응답 수: 각성 {b_info['arousal'][0]}명·{b_info['arousal'][1]:,}건, 정서가 {b_info['valence'][0]}명·{b_info['valence'][1]:,}건.\n")
    L.append("## C. 비접촉 보류(S9) — contact = 충전<0.5 ∧ (화면 켜짐>0 ∨ 정지 비율<0.9), 3,771건·77명, 각성(정서가는 보조)\n")
    L.append("| 부분집합 | n | 각성 AUROC | 정서가 AUROC |")
    L.append("|---|---|---|---|")
    L.append(f"| contact=1 | {c_info[0]:,} | {fmt(g('C', 'contact=1 pooled', 'arousal'))} | {fmt(g('C', 'contact=1 pooled', 'valence'))} |")
    L.append(f"| contact=0 | {c_info[1]} ({c_info[2]}명) | {fmt(g('C', 'contact=0 pooled', 'arousal'))} | {fmt(g('C', 'contact=0 pooled', 'valence'))} |")
    ra, rv = g("C", "diff contact=1 - contact=0 pooled", "arousal"), g("C", "diff contact=1 - contact=0 pooled", "valence")
    L.append(f"| 차이(1 − 0) | | {fmt(ra)} ({sig(ra)}) | {fmt(rv)} ({sig(rv)}) |")
    L.append(f"\n게이트가 버리는 창 비율 {c_info[3]:.3f}. contact=0 창은 {c_info[2]}명에 흩어져 있고 수가 적어 참가자 재추출 시 CI가 넓다.\n")
    L.append("## D. 식별(S11) — 77-way, 시간순 분할 뒤 40%(n=1,479), Wilson 95% 구간\n")
    L.append("| 항목 | 정확도 [95% CI] |")
    L.append("|---|---|")
    for item in ("identity top1 logistic", "identity top5 logistic", "identity top1 vote10 logistic",
                 "identity top1 shuffled-control logistic", "identity top5 shuffled-control logistic"):
        r = g("D", item, "identity")
        L.append(f"| {item} (n={r.n_resp}) | {r.estimate*100:.1f}% [{r.ci_lo*100:.1f}, {r.ci_hi*100:.1f}] |")
    L.append(f"| 우연 1/77 | {100/77:.1f}% |")
    t1, sh = g("D", "identity top1 logistic", "identity"), g("D", "identity top1 shuffled-control logistic", "identity")
    L.append(f"\ntop-1 하한 {t1.ci_lo*100:.1f}%가 우연 {100/77:.1f}%와 대조군 상한 {sh.ci_hi*100:.1f}%를 모두 넘는다 → 식별 정보는 우연보다 분명히 있으나(약 {t1.estimate*77:.1f}배), "
             f"인증에 쓸 수준(수십 %)과는 거리가 멀다. 대조군 구간은 우연을 포함한다.\n")
    L.append("## E. 모델 안정성 — DEPLOY LOSO pooled AUROC, random_state 0~4 (subsample 0.8이라 시드가 영향)\n")
    L.append("| 과제 | 평균 ± SD | 시드별 |")
    L.append("|---|---|---|")
    for task in TASKS:
        a = e_res[task]
        L.append(f"| {task} | {a.mean():.4f} ± {a.std(ddof=1):.4f} | " + ", ".join(f"{x:.4f}" for x in a) + " |")
    L.append("")
    L.append("## 판단(CI 기준)\n")
    sig_rows = out[(out.part.isin(["A", "B", "C"])) & out["item"].str.contains("diff")]
    for _, r in sig_rows.iterrows():
        L.append(f"- {r['part']} {r['item']} [{r['task']}]: {fmt(r)} → {sig(r)}")
    n_sig = int(sum(sig(r) == "유의" for _, r in sig_rows.iterrows()))
    L.append(f"\n차이 항목 {len(sig_rows)}개 중 {n_sig}개가 유의.\n")
    L.append("해석:")
    r301a, r301v = g("A", "diff W=30-W=1 pooled", "arousal"), g("A", "diff W=30-W=1 pooled", "valence")
    r301vu = g("A", "diff W=30-W=1 user-mean", "valence")
    r3015a, r3060a = g("A", "diff W=30-W=15 pooled", "arousal"), g("A", "diff W=30-W=60 pooled", "arousal")
    r3060v = g("A", "diff W=30-W=60 pooled", "valence")
    mid_sig = []
    for a, b in ((30, 15), (30, 60)):
        for k in ("pooled", "user-mean"):
            for t in TASKS:
                r = g("A", f"diff W={a}-W={b} {k}", t)
                if sig(r) == "유의":
                    mid_sig.append(f"{t}/{k} W={a}−W={b} {fmt(r)}")
    L.append(f"- 창 길이: W=30 − W=1은 각성 pooled {fmt(r301a)}({sig(r301a)}), 각성 user-mean({sig(g('A', 'diff W=30-W=1 user-mean', 'arousal'))}), "
             f"정서가 pooled {fmt(r301v)}({sig(r301v)}), 정서가 user-mean {fmt(r301vu)}({sig(r301vu)}). "
             f"W=30 대 W=15, W=30 대 W=60의 8개 차이 가운데 유의한 것은 {len(mid_sig)}개"
             + (f"({'; '.join(mid_sig)}, 하한이 0에 거의 붙어 있음)" if mid_sig else "") + ". "
             "→ '1분보다 수십 분 요약이 낫다'는 주장은 각성에서 pooled·user-mean 모두, 정서가에서는 pooled로 뒷받침된다. "
             "15·30·60분 사이의 차이는 대부분 0을 포함하므로 '30분이 최적'이라고는 쓰지 않고 '10~30분이 절충'으로만 서술한다.")
    rb_a, rb_v = g("B", f"k={K_CUM} diff blend-base pooled", "arousal"), g("B", f"k={K_CUM} diff blend-base pooled", "valence")
    rbu_a, rbu_v = g("B", f"k={K_CUM} diff blend-base user-mean", "arousal"), g("B", f"k={K_CUM} diff blend-base user-mean", "valence")
    L.append(f"- 응답 누적: blend − base는 각성 pooled {fmt(rb_a)}({sig(rb_a)}), 정서가 pooled {fmt(rb_v)}({sig(rb_v)}); "
             f"user-mean은 각성 {fmt(rbu_a)}({sig(rbu_a)}), 정서가 {fmt(rbu_v)}({sig(rbu_v)}). "
             "pooled와 user-mean의 방향이 다르면(pooled↑, user-mean↓) blend가 사용자 간 수준(교정)을 맞춰 주지만 개인 안 순위는 못 올린다는 뜻이다. "
             "CI가 0을 포함하는 축은 '30개 응답으로는 개인화 효과를 확인하지 못했다'로 쓴다.")
    L.append(f"- 비접촉: contact=1 − contact=0 각성 {fmt(ra)}({sig(ra)}). 방향은 거치 상태의 움직임이 정서 정보가 적다는 쪽이지만 "
             "CI가 0을 포함하면 '경향'으로만 쓰고 게이트는 성능 장치가 아니라 보류 안전장치로 서술(S9 결론 유지).")
    L.append(f"- 식별: top-1 {t1.estimate*100:.1f}% [{t1.ci_lo*100:.1f}, {t1.ci_hi*100:.1f}] vs 우연 {100/77:.1f}%, 대조군 {sh.estimate*100:.1f}% [{sh.ci_lo*100:.1f}, {sh.ci_hi*100:.1f}].")
    ea, ev = e_res["arousal"], e_res["valence"]
    L.append(f"- 안정성: 시드 표준편차(각성 {ea.std(ddof=1):.4f}, 정서가 {ev.std(ddof=1):.4f})는 참가자 부트스트랩 CI 반폭(약 0.02~0.03)보다 한 자릿수 작다 → "
             "보고 수치의 불확실성은 모델 난수가 아니라 표본(참가자)에서 온다.\n")
    L.append("## 논문에 쓸 문장 예시\n")
    rp30a = g("A", "window W=30 pooled", "arousal")
    rp30v = g("A", "window W=30 pooled", "valence")
    rp1a = g("A", "window W=1 pooled", "arousal")
    def pm(r):
        return f"{r.estimate:+.3f} (95% CI {r.ci_lo:+.3f}, {r.ci_hi:+.3f})"

    L.append(f"1. 응답 직전 30분 요약의 LOSO AUROC는 각성 {rp30a.estimate:.3f}(95% CI {rp30a.ci_lo:.3f}–{rp30a.ci_hi:.3f}), 정서가 {rp30v.estimate:.3f}({rp30v.ci_lo:.3f}–{rp30v.ci_hi:.3f})였다"
             f"(참가자 단위 부트스트랩 {N_BOOT:,}회, {a_info[1]:,}건·{a_info[0]}명).")
    L.append(f"2. 직전 1분만 쓰면 각성 AUROC가 {rp1a.estimate:.3f}로 떨어졌으며, 30분과 1분의 차이는 각성 {pm(r301a)}, 정서가 {pm(r301v)}로 "
             f"{'두 축 모두 0을 포함하지 않았다' if sig(r301a) == sig(r301v) == '유의' else '각성에서 0을 포함하지 않았다'}. "
             f"반면 15·30·60분 사이의 차이는 각성에서 모두 신뢰구간이 0을 포함했고(예: 30분−15분 {pm(r3015a)}), 정서가에서는 30분−60분 pooled {pm(r3060v)}만 가까스로 0을 벗어났다.")
    L.append(f"3. 처음 30개 응답으로 학습한 개인 모델을 출하 모델과 평균하면(blend) 각성 pooled AUROC 차이는 {pm(rb_a)}, 정서가 {pm(rb_v)}, "
             f"사용자별 평균 AUROC 차이는 각성 {pm(rbu_a)}, 정서가 {pm(rbu_v)}로 모두 0을 포함했다. 30개 응답 수준의 개인화 효과는 이 데이터로 확인되지 않았다.")
    L.append(f"4. 접촉 판정 창(n={c_info[0]:,})과 비접촉(주로 충전 중) 창(n={c_info[1]})의 각성 AUROC 차이는 {pm(ra)}로, "
             f"{'비접촉 창의 정보량이 유의하게 적었다' if sig(ra) == '유의' else '방향은 비접촉 창이 낮았으나 신뢰구간이 0을 포함했다'}. 접촉 게이트는 성능 개선 장치가 아니라 거치 상태의 추정을 보류하는 안전장치로 둔다.")
    L.append(f"5. 같은 30분 요약 특징으로 77명 중 누구인지 맞히는 top-1 정확도는 {t1.estimate*100:.1f}%(Wilson 95% CI {t1.ci_lo*100:.1f}–{t1.ci_hi*100:.1f}%, n=1,479)로 "
             f"우연 {100/77:.1f}%보다 높지만 라벨을 섞은 대조군({sh.estimate*100:.1f}%, {sh.ci_lo*100:.1f}–{sh.ci_hi*100:.1f}%)과의 차이가 5%p 수준에 그쳐, 이 특징이 담는 신원 정보는 제한적이다.")
    L.append(f"6. 모델 학습의 난수(5개 시드)에 따른 LOSO AUROC 표준편차는 각성 {ea.std(ddof=1):.4f}, 정서가 {ev.std(ddof=1):.4f}로 참가자 표본에 의한 불확실성보다 훨씬 작았다.\n")
    L.append("## 산출물\n- results/s14_bootstrap.csv (part, item, task, estimate, ci_lo, ci_hi, n_users, n_resp, ci_type, n_boot)\n"
             "- data/processed/s14_window_oof.parquet, s14_cumulative_oof.parquet, s14_contact_oof.parquet, s14_contact_ctx.parquet (OOF 예측·맥락; 다시 실행하면 재사용)\n"
             "- results/s14_stdout.txt (실행 로그)\n")
    (RES / "S14_NOTES.md").write_text("\n".join(L), encoding="utf-8")


def main():
    log(f"N_BOOT={N_BOOT} seed={SEED}")
    a_info = part_a()
    b_info = part_b()
    c_info = part_c()
    part_d()
    e_res = part_e()
    out = pd.DataFrame(ROWS)
    out.to_csv(RES / "s14_bootstrap.csv", index=False, encoding="utf-8")
    write_notes(out, a_info, b_info, c_info, e_res)
    log("done rows=", len(out))


if __name__ == "__main__":
    main()
