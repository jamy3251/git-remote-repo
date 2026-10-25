import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
import s8_common as C  # noqa: E402
import s8_student as S  # noqa: E402


def test_binarize_rules():
    out = C.binarize([0.3, -0.1, 0.0, np.nan, 1.0])
    assert out[0] == 1 and out[1] == 0
    assert np.isnan(out[2]) and np.isnan(out[3])
    assert out[4] == 1


def test_n_gate_blocks_small_samples():
    y = [1, 0] * 9  # 18 < MIN_N
    p = np.linspace(0, 1, 18)
    auc, n, note = S.auroc_or_na(y, p)
    assert np.isnan(auc) and n == 18 and note == "n 부족"
    y = [1, 0] * 10
    p = np.r_[np.ones(10), np.zeros(10)]
    # 라벨이 번갈아 있어도 n=20이면 수치 산출
    auc, n, note = S.auroc_or_na(y, np.r_[np.linspace(0.5, 1, 10), np.linspace(0, 0.49, 10)][np.argsort(np.argsort(np.arange(20)))])
    assert n == 20 and note == ""


def test_judge_is_not_a_label_and_arm_parsed():
    ev = pd.DataFrame({
        "t_ns": [1, 2, 3], "wall_ms": [1000, 2000, 3000], "type": ["affect"] * 3, "app": "", "media": "",
        "value": ["v=0.5;a=-0.2;i=0.5;e=평온;j=yes;pa=0.6;pv=0.4;src=ask_B",
                  "v=-0.5;a=0.0;i=0.5;e=지루;j=no;pa=;pv=;src=ask_A",
                  "v=0.1;a=0.1;i=0.1;e=;j=;pa=;pv=;src=overlay"],
    })
    ev["day"] = "2026-10-24"
    taps = C.grid_taps(ev)
    assert list(taps.arm) == ["B", "A", "manual"]
    assert list(taps.j) == ["yes", "no", ""]
    assert np.isnan(taps.pa.iloc[1])
    # j는 이진화 입력이 아니다: 라벨은 a/v에서만
    assert C.binarize(taps.a)[1] != C.binarize(taps.a)[1]  # a==0 → NaN
