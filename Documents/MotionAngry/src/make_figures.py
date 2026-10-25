"""논문 그림: results/*.csv → paper/figures/*.png"""
from pathlib import Path

import matplotlib.pyplot as plt
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
FIG = ROOT / "paper" / "figures"
FIG.mkdir(parents=True, exist_ok=True)
plt.rcParams.update({"font.family": "Malgun Gothic", "font.size": 9, "axes.unicode_minus": False,
                     "axes.spines.top": False, "axes.spines.right": False})
INK, MUTED, ACCENT, PHYS = "#222222", "#9a9a9a", "#1f5fa8", "#c2622d"


def resolution_curve():
    s1 = pd.read_csv(ROOT / "results" / "s1_affect.csv")
    s1b = pd.read_csv(ROOT / "results" / "s1b_wesad.csv").set_index("features").auroc
    still = pd.read_csv(ROOT / "results" / "s1b_wesad_still.csv")
    st = still[still.task == "stress vs baseline"].set_index("still>=")

    fig, (a, b) = plt.subplots(1, 2, figsize=(6.8, 2.6), gridspec_kw={"width_ratios": [1.15, 1]})
    # (a) 해상도: 거친 범주 → 4/8/16/32Hz (WESAD, 전체 창)
    labels = ["3범주", "4Hz", "8Hz", "16Hz", "32Hz"]
    keys = [k for k in s1b.index if k.startswith("coarse")] + ["noori 4Hz", "noori 8Hz", "noori 16Hz"] + \
           [k for k in s1b.index if k.startswith("noori 32Hz")]
    a.plot(range(5), [s1b[k] for k in keys], "-o", color=ACCENT, ms=4, label="실험실 손목 가속도 (스트레스)")
    sl = s1[(s1["mode"] == "loso") & (s1.features == "motion")].auroc.mean()
    a.axhline(sl, color=MUTED, ls="--", lw=1)
    a.text(0, sl + 0.015, f"일상 데이터 OS 활동 판정의 정서 추정 ({sl:.2f})", ha="left", color=MUTED, fontsize=7.5)
    a.axhline(0.5, color=INK, lw=0.6)
    a.set_xticks(range(5), labels)
    a.set_ylim(0.45, 0.95)
    a.set_ylabel("AUROC (LOSO)")
    a.set_title("(a) 측정 빈도", fontsize=9, loc="left")
    a.legend(frameon=False, fontsize=7.5, loc="upper left")

    # (b) 움직임 강도 통제 후: 정지 비율 기준별
    x = range(len(st))
    w = 0.26
    for i, (col, name, c) in enumerate([("coarse", "3범주", MUTED), ("noori32", "원시 미세 움직임", ACCENT),
                                        ("phys", "생리 신호(참조)", PHYS)]):
        bars = b.bar([j + (i - 1) * w for j in x], st[col], w, color=c, label=name)
        b.bar_label(bars, fmt="%.2f", fontsize=6.5, padding=1)
    b.axhline(0.5, color=INK, lw=0.6)
    b.set_xticks(list(x), [f"≥{t:.2f}".rstrip("0") for t in st.index])
    b.set_xlabel("가만히 있는 시간 비율 기준 (움직임 강도 통제)")
    b.set_ylim(0.3, 1.02)
    b.set_title("(b) 강도 통제 후 스트레스 판별", fontsize=9, loc="left")
    b.legend(frameon=False, fontsize=7, loc="upper center", ncol=3, handlelength=1, columnspacing=0.8)
    fig.tight_layout()
    fig.savefig(FIG / "fig_resolution.png", dpi=300)
    print("saved", FIG / "fig_resolution.png")


def wild_bars():
    """K-EmoPhone(일상): 과제별 특징 세트 AUROC와 참가자 단위 부트스트랩 95% CI."""
    bs = pd.read_csv(ROOT / "results" / "s4_kemophone_bootstrap.csv")
    ci = bs.ci95.str.findall(r"[-\d.]+\)").apply(lambda v: [float(x.rstrip(")")) for x in v])
    bs["lo"], bs["hi"] = ci.str[0], ci.str[1]
    bs = bs.set_index(["task", "cmp"])
    sets = [("phone", "OS 활동 판정(폰)", MUTED), ("intensity", "손목 세기 1개", "#7fa7d4"),
            ("coarse", "손목 3범주", "#4f83bf"), ("raw2", "손목 원시 2Hz", ACCENT), ("raw8", "손목 원시 8Hz", "#0d3b70")]
    tasks = [("valence", "정서가"), ("arousal", "각성"), ("stress", "스트레스")]
    fig, ax = plt.subplots(figsize=(6.8, 2.4))
    w = 0.16
    for i, (key, name, c) in enumerate(sets):
        xs = [j + (i - 2) * w for j in range(len(tasks))]
        r = [bs.loc[(t, key)] for t, _ in tasks]
        y = [v.auroc for v in r]
        err = [[v.auroc - v.lo for v in r], [v.hi - v.auroc for v in r]]
        ax.bar(xs, y, w, color=c, label=name, yerr=err, error_kw={"lw": 0.7, "capsize": 1.5, "ecolor": INK})
    ax.axhline(0.5, color=INK, lw=0.6)
    ax.set_xticks(range(len(tasks)), [n for _, n in tasks])
    ax.set_ylim(0.45, 0.66)
    ax.set_ylabel("AUROC (LOSO)")
    ax.legend(frameon=False, fontsize=7, ncol=5, loc="upper center", bbox_to_anchor=(0.5, 1.13),
              handlelength=1, columnspacing=0.8)
    fig.tight_layout()
    fig.savefig(FIG / "fig_wild.png", dpi=300)
    print("saved", FIG / "fig_wild.png")


def system_diagram():
    """그림 1: 단말 내부 처리 흐름 (실선=구현, 점선=향후)."""
    from matplotlib.patches import FancyBboxPatch
    fig, ax = plt.subplots(figsize=(6.8, 2.5))
    ax.set_xlim(0, 100)
    ax.set_ylim(0, 40)
    ax.axis("off")
    ax.add_patch(FancyBboxPatch((1, 1), 98, 38, boxstyle="round,pad=0,rounding_size=1.5", fc="none", ec=MUTED, lw=0.8, ls="--"))
    ax.text(3, 36.2, "재귀 학습 회로 — 스마트폰 내부 (인터넷 권한 없음)", fontsize=7.5, color=MUTED)

    def box(x, y, w, h, t, c=ACCENT, fill="#eaf1f9"):
        ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0,rounding_size=1", fc=fill, ec=c, lw=0.9))
        ax.text(x + w / 2, y + h / 2, t, ha="center", va="center", fontsize=7.2, color=INK, linespacing=1.25)

    def arrow(x0, y0, x1, y1, ls="-", c=INK):
        ax.annotate("", (x1, y1), (x0, y0), arrowprops=dict(arrowstyle="-|>", lw=0.8, color=c, ls=ls, shrinkA=0, shrinkB=0))

    box(3, 22, 15, 10, "가속도 50Hz\n상시 수집")
    box(22, 22, 16, 10, "8Hz 보간·4개 평균\n(2Hz)")
    box(42, 22, 17, 10, "1분 특징 16개\n30분 요약 32개")
    box(63, 22, 15, 10, "트리 50개 모델\n각성·기분 확률")
    box(82, 22, 14, 10, "알림 표시\n기록")
    for a, b in ((18, 22), (38, 42), (59, 63), (78, 82)):
        arrow(a, 27, b, 27)
    # 기록 흐름(정답 수집): 표정·앱/곡·좋아/별로 → 일상 기록 ← 감정 격자(질문 알림 두 경로)
    box(3, 5, 13, 10, "앞카메라\n초당 2장", PHYS, "#f8ece4")
    box(19, 5, 16, 10, "표정 계수 52개\n(영상 미저장)", PHYS, "#f8ece4")
    box(38, 5, 16, 10, "사용 앱·곡 제목\n좋아/별로 입력", PHYS, "#f8ece4")
    box(57, 5, 17, 10, "일상 기록\n(사용자 정답)", PHYS, "#f8ece4")
    box(79, 5, 17, 10, "감정 격자 입력\n(정서가·각성·세기)", PHYS, "#f8ece4")
    for a, b in ((16, 19), (35, 38), (54, 57)):
        arrow(a, 10, b, 10)
    arrow(79, 10, 74, 10)                       # 격자 → 일상 기록
    arrow(89, 22, 89, 15)                       # 알림 → 격자 (급변·무작위 두 경로, 구현)
    ax.text(87.8, 18.2, "질문 알림\n(급변·무작위 2경로)", fontsize=6.2, color=INK, ha="right", va="center", linespacing=1.1)
    arrow(66, 15, 70, 22, ls=(0, (3, 2)), c=PHYS)
    ax.text(66.5, 18.6, "재학습(향후)", fontsize=6.8, color=PHYS, ha="right", va="center")
    fig.tight_layout(pad=0.2)
    fig.savefig(FIG / "fig_system.png", dpi=300)
    print("saved", FIG / "fig_system.png")


def loop_diagram():
    """그림(2번째 논문): 단말 내 자기 학습 구조 — 추정·정답 수집·학습·가드의 순환. 실선=구현·검증, 점선=향후."""
    from matplotlib.patches import FancyBboxPatch
    fig, ax = plt.subplots(figsize=(6.8, 3.0))
    ax.set_xlim(0, 100)
    ax.set_ylim(0, 48)
    ax.axis("off")
    ax.add_patch(FancyBboxPatch((1, 1), 98, 46, boxstyle="round,pad=0,rounding_size=1.5", fc="none", ec=MUTED, lw=0.8, ls="--"))
    ax.text(3, 44.2, "재귀 학습 회로 — 스마트폰 내부 (인터넷 권한 없음)", fontsize=7.5, color=MUTED)

    def box(x, y, w, h, t, c=ACCENT, fill="#eaf1f9", fs=7.0):
        ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0,rounding_size=1", fc=fill, ec=c, lw=0.9))
        ax.text(x + w / 2, y + h / 2, t, ha="center", va="center", fontsize=fs, color=INK, linespacing=1.25)

    def arrow(x0, y0, x1, y1, ls="-", c=INK):
        ax.annotate("", (x1, y1), (x0, y0), arrowprops=dict(arrowstyle="-|>", lw=0.8, color=c, ls=ls, shrinkA=0, shrinkB=0))

    # 위: 추정
    box(3, 31, 17, 10, "가속도 50Hz\n→ 2Hz 특징 16개")
    box(24, 31, 18, 10, "30분 요약 32개\n(폰이 몸에 없으면 보류)")
    box(46, 31, 20, 10, "기본 모델(트리 50개)\n학생 모델(가중치 33개)")
    box(70, 31, 26, 10, "쓸 모델 고르기\n→ 알림 표시·질문할 때 결정")
    for a, b in ((20, 24), (42, 46), (66, 70)):
        arrow(a, 36, b, 36)
    # 아래: 정답 수집
    box(3, 5, 17, 10, "앞카메라 표정\n계수 52개", PHYS, "#f8ece4")
    box(24, 5, 18, 10, "표정 → 임시 정답\n(웃음·입 벌림 기준)", PHYS, "#f8ece4")
    box(46, 5, 20, 10, "질문 알림\n급변 때(A) / 무작위 시각(B)", PHYS, "#f8ece4")
    box(70, 5, 26, 10, "감정 격자 입력\n정서가·각성·세기", PHYS, "#f8ece4")
    arrow(20, 10, 24, 10)
    arrow(66, 10, 70, 10)
    arrow(83, 31, 56, 15)                    # 트리거 → 질문 알림
    ax.text(63.5, 21.5, "질문", fontsize=6.5, color=INK, ha="right")
    # 학습 루프(가운데)
    box(24, 18, 18, 8, "학생 학습\n1시간마다 100스텝", "#2a7f3f", "#e8f3ea")
    arrow(33, 15, 33, 18)                     # 교사 라벨 → 학습
    arrow(42, 22, 56, 31)                     # 학습 → 학생 모델
    ax.text(47.5, 26.5, "가중치 갱신", fontsize=6.5, color=INK, ha="center")
    box(70, 18, 26, 8, "성능 가드\n무작위(B) 응답으로 두 모델 채점", "#2a7f3f", "#e8f3ea", 6.6)
    arrow(83, 15, 83, 18)                     # 격자 응답 → 가드
    arrow(83, 26, 83, 31)                     # 가드 → 활성 모델
    fig.tight_layout(pad=0.2)
    fig.savefig(FIG / "fig_loop.png", dpi=300)
    print("saved", FIG / "fig_loop.png")


def s7_chart():
    """그림(2번째 논문): 자기 응답 누적(k)에 따른 전체 AUROC vs 사용자별 평균 — 기본/섞음. results/s7_cumulative.csv."""
    df = pd.read_csv(ROOT / "results" / "s7_cumulative.csv")
    fig, axes = plt.subplots(1, 2, figsize=(6.8, 2.5), sharey=True)
    for ax, task, name in zip(axes, ["arousal", "valence"], ["각성", "정서가"]):
        d = df[df.task == task]
        for method, label, c in (("base", "기본 모델", MUTED), ("blend", "기본+개인 섞음", ACCENT)):
            m = d[d.method == method].sort_values("k")
            if method == "blend":
                m = m[m.k > 0]
            ax.plot(m.k, m.auc_pooled, "-o", color=c, ms=3.5, lw=1.2, label=f"{label} · 전체")
            ax.plot(m.k, m.auc_user_mean, "--s", color=c, ms=3.5, lw=1.2, label=f"{label} · 사용자별 평균")
        ax.set_xticks([0, 5, 10, 15, 20, 30])
        ax.set_xlabel("자기 응답 수 k")
        ax.set_title(f"({'ab'[axes.tolist().index(ax)]}) {name}", fontsize=9, loc="left")
        ax.set_ylim(0.50, 0.68)
    axes[0].set_ylabel("AUROC (0.5=우연)")
    axes[0].legend(frameon=False, fontsize=6.6, loc="lower right", ncol=1)
    fig.tight_layout(pad=0.3)
    fig.savefig(FIG / "fig_s7.png", dpi=300)
    print("saved", FIG / "fig_s7.png")


def _grid_color(v, a):
    """AffectGridActivity.colorAt()의 Python 재현(HSV)."""
    import colorsys
    import math
    r = min(1.0, math.hypot(v, a))
    theta = math.degrees(math.atan2(a, v)) % 360
    anchors = [55, 25, 0, -60, -90, -140, -170, -230, -305]
    k = int(theta / 45)
    f = theta / 45 - k
    hue = anchors[k] + (anchors[min(k + 1, 8)] - anchors[k]) * f
    hue = (hue % 360 + 360) % 360
    sat = 0.12 + 0.78 * r
    val = 0.97 - 0.22 * r * ((1 - 0.5 * (a + 1)) if a < 0 else 0.3)
    return colorsys.hsv_to_rgb(hue / 360, sat, val)


def app_example():
    """그림(2번째 논문): 실제 기록 예 — (a) 감정 격자와 저자가 누른 입력 3건(events.csv affect), (b) 10-24 무작위 질문(B) 예약 기록(ask_sched)."""
    import numpy as np
    from matplotlib.patches import FancyBboxPatch
    fig, (a, b) = plt.subplots(1, 2, figsize=(6.8, 2.9), gridspec_kw={"width_ratios": [1, 1.25]})
    # (a) 격자
    n = 96
    img = np.zeros((n, n, 3))
    for y in range(n):
        for x in range(n):
            img[y, x] = _grid_color((x + 0.5) / n * 2 - 1, 1 - (y + 0.5) / n * 2)
    a.imshow(img, extent=(-1, 1, -1, 1), interpolation="bilinear")
    a.axhline(0, color="k", lw=0.6, alpha=0.3)
    a.axvline(0, color="k", lw=0.6, alpha=0.3)
    names = ["설렘", "기쁨", "평온", "나른", "지루", "슬픔", "불안", "짜증"]
    pos = [(0.55, 0.75), (0.8, 0.3), (0.7, -0.6), (0.2, -0.85), (-0.5, -0.7), (-0.8, -0.3), (-0.6, 0.6), (-0.35, 0.85)]
    for nm, (x, y) in zip(names, pos):
        a.text(x, y, nm, ha="center", va="center", fontsize=7, color="#1e1e1e", alpha=0.8)
    for s, x, y, ha, va in (("흥분", 0, 0.95, "center", "top"), ("차분", 0, -0.95, "center", "bottom"),
                            ("불쾌", -0.95, 0.04, "left", "bottom"), ("유쾌", 0.95, 0.04, "right", "bottom")):
        a.text(x, y, s, ha=ha, va=va, fontsize=6.5, color="#1e1e1e", alpha=0.8)
    # 실제 입력 3건 (data/raw/life/2026-10-24/events_today.csv type=affect)
    taps = [(0.634, -0.540, "10-23 22:02 평온"), (0.242, -0.377, "10-24 00:26 나른"), (0.442, 0.000, "10-24 18:17 기쁨")]
    for i, (v, ar, lab) in enumerate(taps, 1):
        a.plot(v, ar, "o", ms=9, mfc="white", mec="black", mew=1.1)
        a.text(v, ar, str(i), ha="center", va="center", fontsize=6.5, color="black", fontweight="bold")
    a.set_xlim(-1, 1)
    a.set_ylim(-1, 1)
    a.set_xticks([])
    a.set_yticks([])
    for sp in a.spines.values():
        sp.set_visible(True)
        sp.set_color(MUTED)
    a.set_title("(a) 감정 격자와 실제 입력 3건", fontsize=9, loc="left")
    a.set_xlabel("  ".join(f"{i} {lab}" for i, (_, _, lab) in enumerate(taps, 1)), fontsize=6.3, color=INK, labelpad=3)
    # (b) 10-24 무작위 질문(B) 예약: 09~23시, 난수 3개, 서비스 시작 18:13
    b.set_xlim(8.5, 23.5)
    b.set_ylim(0, 3)
    b.axhspan(1.2, 1.8, xmin=(9 - 8.5) / 15, xmax=(23 - 8.5) / 15, color="#eaf1f9")
    b.text(9.05, 1.95, "질문 가능 시간 09~23시", fontsize=6.8, color=MUTED, va="bottom")
    sched = [(16 + 40 / 60, "16:40", False), (17 + 52 / 60, "17:52", False), (22 + 15 / 60, "22:15", True)]
    for t, lab, future in sched:
        b.plot(t, 1.5, "v" if future else "x", ms=8 if future else 7, color=ACCENT if future else MUTED, mew=1.6)
        b.text(t, 0.95, lab, ha="center", va="top", fontsize=7, color=ACCENT if future else MUTED)
    b.axvline(18 + 13 / 60, color=PHYS, lw=1.0, ls="--")
    b.text(18 + 13 / 60 - 0.15, 2.85, "서비스 시작 18:13\n앞의 두 시각은 이미 지남\n→ 누락으로 기록", fontsize=6.5, color=PHYS, va="top", ha="right")
    b.text(22.25, 2.0, "예약됨\n(알람 등록)", ha="center", fontsize=6.5, color=ACCENT, va="bottom")
    b.set_xticks(range(9, 24, 2))
    b.set_xticklabels([f"{h}시" for h in range(9, 24, 2)], fontsize=7)
    b.set_yticks([])
    b.spines["left"].set_visible(False)
    b.set_title("(b) 10-24 무작위 질문(B) 예약 기록", fontsize=9, loc="left")
    fig.tight_layout(pad=0.3)
    fig.savefig(FIG / "fig_app.png", dpi=300)
    print("saved", FIG / "fig_app.png")


def screens():
    """그림(2번째 논문): 실제 단말 화면. paper/figures/shots/ 의 PNG(파일명 순)를 가로로 나란히 붙여 fig_screens.png.
    예상 파일: 01_notification.png(추정 알림), 02_grid.png(감정 격자), 03_ask.png(질문 알림). 캡션 글자는 파일명의 번호 뒤 이름."""
    from PIL import Image
    shots = sorted((FIG / "shots").glob("*.png"))
    if not shots:
        print("no shots in", FIG / "shots")
        return
    # 왼쪽 엣지 패널 손잡이(14px)와 하단 내비게이션 바(y>2080)를 잘라낸다(1080x2220 기준)
    ims = [Image.open(s).convert("RGB") for s in shots]
    ims = [im.crop((14, 0, im.width, min(im.height, 2080))) for im in ims]
    h = 1400
    ims = [im.resize((int(im.width * h / im.height), h)) for im in ims]
    gap = 40
    w = sum(im.width for im in ims) + gap * (len(ims) - 1)
    canvas = Image.new("RGB", (w, h), "white")
    x = 0
    for im in ims:
        canvas.paste(im, (x, 0))
        x += im.width + gap
    canvas.save(FIG / "fig_screens.png")
    print("saved", FIG / "fig_screens.png", [s.name for s in shots])


if __name__ == "__main__":
    resolution_curve()
    wild_bars()
    system_diagram()
    loop_diagram()
    s7_chart()
    app_example()
