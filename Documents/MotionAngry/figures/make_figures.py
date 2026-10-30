"""SCI 초안 그림·표 생성 (손으로 적는 수치 없음). 모든 입력은 results/ 의 스크립트 출력 파일.

python figures/make_figures.py            # 전부
python figures/make_figures.py density    # 하나만 (density | guard | timecourse | selection | window | tables)
출력: figures/*.pdf + *.png, figures/tables/*.md
"""
import os
import sys
import tempfile
from pathlib import Path

import matplotlib
import numpy as np
import pandas as pd

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
RES = ROOT / "results"
FIG = ROOT / "figures"
TAB = FIG / "tables"
TAB.mkdir(exist_ok=True, parents=True)
plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 9, "axes.spines.top": False, "axes.spines.right": False})
C = {"base": "#444444", "seed_model": "#999999", "student": "#d62728", "student_a0.3": "#ff7f0e", "esm_ft": "#1f77b4",
     "esm_sk": "#17becf", "guard": "#2ca02c", "platt": "#9467bd", "oracle": "#8c564b"}
LBL = {"base": "Global base (LightGBM)", "seed_model": "Seed logistic (no update)", "student": "Self-training student (teacher labels)",
       "student_a0.3": "Student + L2 anchor (λ=0.3)", "esm_ft": "ESM fine-tune (same learner)", "esm_sk": "ESM logistic (L2, C=0.1)",
       "guard": "Student + performance guard", "platt": "Base + per-user Platt"}


def save(fig, name):
    for ext in ("pdf", "png"):
        tmp = tempfile.NamedTemporaryFile(suffix="." + ext, delete=False, dir=FIG)
        tmp.close()
        fig.savefig(tmp.name, dpi=200 if ext == "png" else None, bbox_inches="tight")
        os.replace(tmp.name, FIG / f"{name}.{ext}")
    plt.close(fig)
    print("saved", name)


def summary():
    s = pd.read_csv(RES / "loop_sim" / "summary.csv")
    return s[~s.oracle], s[s.oracle]


# ---------- RQ2 대표 그림: (p, d) 지도 ----------
def fig_density():
    s, orc = summary()
    tasks = ("arousal", "valence")
    fig, axes = plt.subplots(2, 2, figsize=(7.2, 5.6), sharex=True, sharey=True)
    for i, task in enumerate(tasks):
        for j, b in enumerate(sorted(s.b.unique())):
            ax = axes[i, j]
            ps, ds = sorted(s.p.unique()), sorted(s.d.unique())
            M = np.full((len(ds), len(ps)), np.nan)
            SIG = np.zeros_like(M, bool)
            for a_, d in enumerate(ds):
                for b_, p in enumerate(ps):
                    g = s[(s.task == task) & (s.b == b) & (s.p == p) & (s.d == d)]
                    st = g[g.cond == "student"]
                    M[a_, b_] = st.diff_vs_esm_ft.mean()
                    SIG[a_, b_] = (st.wilcoxon_p_vs_esm_ft < 0.05).sum() >= 2 and (np.sign(st.diff_vs_esm_ft).nunique() == 1)
            im = ax.imshow(M, cmap="RdBu", vmin=-0.08, vmax=0.08, origin="lower", aspect="auto")
            for a_ in range(len(ds)):
                for b_ in range(len(ps)):
                    ax.text(b_, a_, f"{M[a_, b_]:+.3f}" + ("*" if SIG[a_, b_] else ""), ha="center", va="center", fontsize=8,
                            color="black")
            ax.set_xticks(range(len(ps)), [f"{p:.1f}" for p in ps])
            ax.set_yticks(range(len(ds)), [f"{d:.1f}" for d in ds])
            ax.set_title(f"{task}, teacher bias b={b:.1f}", fontsize=9)
            if i == 1:
                ax.set_xlabel("teacher accuracy p")
            if j == 0:
                ax.set_ylabel("teacher density d")
    cb = fig.colorbar(im, ax=axes, shrink=0.8, pad=0.02)
    cb.set_label("Δ within-user AUROC: dense noisy student − sparse ESM fine-tune\n(mean of 3 seeds; * Wilcoxon p<0.05 in ≥2 seeds, same sign)")
    save(fig, "fig_density_noise_map")


def fig_conditions():
    """조건별 사용자별 AUROC 평균(p=0.8, d=0.5, b=0, 3 seed 평균) + 오라클·기본 모델."""
    s, orc = summary()
    conds = ["base", "seed_model", "esm_ft", "esm_sk", "platt", "student", "student_a0.3", "guard"]
    fig, axes = plt.subplots(1, 2, figsize=(7.2, 3.0), sharey=True)
    for ax, task in zip(axes, ("arousal", "valence")):
        g = s[(s.task == task) & (s.p == 0.8) & (s.d == 0.5) & (s.b == 0.0)]
        o = orc[orc.task == task]
        vals = [g[g.cond == c].user_mean_auc.mean() for c in conds]
        lo = [g[g.cond == c].user_mean_auc.min() for c in conds]
        hi = [g[g.cond == c].user_mean_auc.max() for c in conds]
        ax.barh(range(len(conds)), vals, color=[C.get(c, "#777") for c in conds], xerr=[np.array(vals) - np.array(lo), np.array(hi) - np.array(vals)],
                error_kw=dict(lw=0.8))
        ax.axvline(o[o.cond == "student"].user_mean_auc.mean(), color=C["oracle"], ls="--", lw=1, label="oracle student (p=1, d=1)")
        ax.axvline(0.5, color="#bbbbbb", lw=0.8)
        ax.set_yticks(range(len(conds)), [LBL[c] for c in conds])
        ax.set_xlim(0.45, 0.70)
        ax.set_title(f"{task} (p=0.8, d=0.5, b=0)", fontsize=9)
        ax.legend(loc="lower right", fontsize=7, frameon=False)
    fig.supxlabel("within-user AUROC, mean over users (error bars: range over 3 seeds)", fontsize=9)
    save(fig, "fig_conditions")


# ---------- 시간 경과(순차 예측: 모든 응답은 그 응답의 라벨을 쓰기 전 예측) ----------
def fig_timecourse():
    files = sorted((RES / "loop_sim").glob("preds_p0.8_d0.5_b0.0_s*.parquet"))
    allp = pd.concat([pd.read_parquet(f) for f in files])
    conds = ["base", "seed_model", "esm_ft", "student", "student_a0.3", "guard"]
    fig, axes = plt.subplots(1, 2, figsize=(7.2, 3.0), sharey=True)
    from experiments.common.eval import user_auc
    for ax, task in zip(axes, ("arousal", "valence")):
        g = allp[allp.task == task]
        days = sorted(g.day.unique())
        for c in conds:
            ys = []
            for dd in days:
                sub = g[g.day <= dd]
                ua = sub.groupby("seed").apply(lambda q: user_auc(q, "y", c, min_n=10).mean(), include_groups=False)
                ys.append(ua.mean())
            ax.plot([d_ + 1 for d_ in days], ys, marker="o", ms=3, color=C[c], label=LBL[c])
        ax.set_title(task, fontsize=9)
        ax.set_ylim(0.45, 0.70)
    axes[0].set_ylabel("within-user AUROC (mean over users)")
    axes[0].legend(fontsize=6.5, frameon=False, loc="lower left")
    fig.supxlabel("days since first response (cumulative prequential evaluation, p=0.8, d=0.5, 3 seeds)", fontsize=9)
    save(fig, "fig_timecourse")


# ---------- RQ3 가드 ----------
def fig_guard():
    g = pd.read_csv(RES / "guard_sim" / "guard_sim.csv")
    g = g[g.q0 == 0.6]
    fig, axes = plt.subplots(1, 3, figsize=(7.4, 2.6))
    names = {"fixed": "fixed threshold (current: −0.10/+0.05, n≥15)", "sprt": "SPRT on discordant probes (α=β=0.05)",
             "bayes": "Beta-binomial posterior (P>0.95)", "pairedci": "paired 95% CI"}
    for name, sub in g.groupby("guard"):
        sub = sub.sort_values("delta")
        axes[0].plot(sub.delta, sub.revert_14d, marker="o", ms=3, label=names[name])
        axes[1].plot(sub.delta, sub.delay_median_days, marker="o", ms=3)
        axes[2].plot(sub.delta, sub.switches_mean, marker="o", ms=3)
    axes[0].set_ylabel("P(revert to base within 14 d)")
    axes[1].set_ylabel("median days to revert")
    axes[2].set_ylabel("switches per 28 d")
    for ax in axes:
        ax.set_xlabel("student − base accuracy (Δ)")
        ax.axvline(0, color="#bbbbbb", lw=0.8)
    axes[0].legend(fontsize=6, frameon=False, loc="upper center", bbox_to_anchor=(1.7, -0.25), ncol=4)
    fig.suptitle("Guard behaviour, base accuracy 0.60, 3 random probes/day (10,000 runs)", fontsize=9)
    save(fig, "fig_guard")


# ---------- RQ4 선택 편향 ----------
def fig_selection():
    r = pd.read_csv(RES / "loop_sim" / "rq4_selection.csv")
    r["thresh"] = r["thresh"].astype(str)
    order = ["0.15", "0.25", "q75", "q90"]
    fig, axes = plt.subplots(1, 2, figsize=(7.2, 2.9))
    for ax, task in zip(axes, ("arousal", "valence")):
        x = np.arange(len(order))
        for sub, mk, off, lbl in (("A", "o", -0.15, "A: triggered by change since last prompt"), ("all", "^", 0.15, "all responses (random B)")):
            q = r[(r.task == task) & (r.subset == sub)].set_index("thresh").reindex(order)
            ax.errorbar(x + off, q.pooled_auc, fmt=mk + "-", ms=4, label=lbl + ", pooled")
            ax.plot(x + off, q.user_mean_auc, mk, mfc="none", ms=6, label=lbl + ", within-user")
            if sub == "A":
                for xi, (n, nu, fr) in enumerate(zip(q.n, q.n_users, q.frac)):
                    ax.text(xi - 0.15, 0.50, "n=%d\n(%.0f%%)\nusers=%d" % (int(n), 100 * fr, int(nu)), ha="center", fontsize=6)
        ax.set_xticks(x, ["%s\n(%.2f)" % (t, v) for t, v in zip(order, r[(r.task == task) & (r.subset == "A")].set_index("thresh").reindex(order).thresh_value)])
        ax.set_ylim(0.48, 0.72)
        ax.set_title(task, fontsize=9)
    axes[0].set_ylabel("AUROC of the population model")
    axes[1].legend(fontsize=6, frameon=False, loc="upper left")
    fig.supxlabel("arm-A trigger threshold on |estimate − estimate at last prompt| (value)", fontsize=9)
    save(fig, "fig_selection_bias")


# ---------- RQ1 창 길이 (S13 + S14 CI) ----------
def fig_window():
    w = pd.read_csv(RES / "s13_window.csv")
    fig, ax = plt.subplots(figsize=(3.6, 2.6))
    for task, col in (("arousal", "#d62728"), ("valence", "#1f77b4")):
        q = w[w.task == task].sort_values("window_min")
        ycol = "auroc_user_mean"
        ax.plot(q.window_min, q[ycol], marker="o", ms=3, color=col, label=task)
    ax.set_xscale("log")
    ax.set_xticks([1, 5, 10, 15, 30, 60], ["1", "5", "10", "15", "30", "60"])
    ax.set_xlabel("summary window before response (min)")
    ax.set_ylabel("within-user AUROC (mean over users)")
    ax.legend(frameon=False, fontsize=8)
    save(fig, "fig_window_ablation")


def tables():
    s, orc = summary()
    conds = ["base", "seed_model", "esm_ft", "esm_sk", "platt", "student", "student_a0.1", "student_a0.3", "student_a1.0", "guard"]
    lines = ["| condition | arousal within-user AUROC (3-seed mean) | Δ vs base [95% CI, seed 0] | valence | Δ vs base |", "|---|---|---|---|---|"]
    for c in conds:
        row = f"| {LBL.get(c, c)} |"
        for task in ("arousal", "valence"):
            g = s[(s.task == task) & (s.p == 0.8) & (s.d == 0.5) & (s.b == 0.0) & (s.cond == c)]
            g0 = g[g.seed == 0]
            row += f" {g.user_mean_auc.mean():.3f} (n={int(g.n_users.mean())}) |"
            row += " – |" if c == "base" else f" {g0.diff_vs_base.iloc[0]:+.3f} [{g0.ci_lo.iloc[0]:+.3f}, {g0.ci_hi.iloc[0]:+.3f}] |"
        lines.append(row)
    for task in ("arousal", "valence"):
        o = orc[(orc.task == task) & (orc.cond == "student")]
        lines.append(f"| oracle student (p=1, d=1), {task} | {o.user_mean_auc.mean():.3f} | | | |")
    (TAB / "tab_conditions.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    g = pd.read_csv(RES / "guard_sim" / "guard_sim.csv")
    g6 = g[g.q0 == 0.6]
    lines = ["| guard | power (Δ=−0.10, 14 d) | power (Δ=−0.20, 14 d) | false revert (Δ=0, 14 d) | false revert (Δ=0, 28 d) | median delay (Δ=−0.10) | switches/28 d (Δ=0) |", "|---|---|---|---|---|---|---|"]
    for name in ("fixed", "sprt", "bayes", "pairedci"):
        q = g6[g6.guard == name].set_index("delta")
        lines.append(f"| {name} | {q.loc[-0.1, 'revert_14d']:.2f} | {q.loc[-0.2, 'revert_14d']:.2f} | {q.loc[0.0, 'revert_14d']:.2f} | {q.loc[0.0, 'revert_28d']:.2f} | {q.loc[-0.1, 'delay_median_days']:.1f} d | {q.loc[0.0, 'switches_mean']:.2f} |")
    (TAB / "tab_guard.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("tables written")


def main():
    sys.path.insert(0, str(ROOT))
    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    todo = {"density": fig_density, "conditions": fig_conditions, "timecourse": fig_timecourse, "guard": fig_guard,
            "selection": fig_selection, "window": fig_window, "tables": tables}
    for k, f in todo.items():
        if which in ("all", k):
            try:
                f()
            except Exception as e:  # 입력 파일이 아직 없으면 건너뜀
                print(f"[{k}] skipped: {type(e).__name__}: {e}")


if __name__ == "__main__":
    main()
