"""I15·I21: 원형 이동 순열검정의 r0와 이동량 정합(2026-10-23 FFT 인덱스 방향 버그의 회귀 테스트)."""
import sys
from pathlib import Path

import numpy as np
from scipy.stats import spearmanr, rankdata

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from s5_life import circ_perm_p  # noqa: E402


def test_r0_equals_spearman_and_shift_direction():
    rng = np.random.default_rng(0)
    x = rng.normal(size=300)
    y = 0.3 * x + rng.normal(size=300)
    r0, p = circ_perm_p(x, y)
    assert abs(r0 - spearmanr(x, y).statistic) < 1e-12
    assert 0 < p < 0.05
    # 내부 FFT 상관이 np.roll(y, s)와 같은 방향인지(버그 재발 방지)
    rx, ry = rankdata(x), rankdata(y)
    rx = (rx - rx.mean()) / rx.std(); ry = (ry - ry.mean()) / ry.std()
    a = np.fft.ifft(np.fft.fft(rx) * np.conj(np.fft.fft(ry))).real / 300
    for s in (5, 77):
        assert abs(a[s] - spearmanr(x, np.roll(y, s)).statistic) < 1e-9


def test_constant_input_gives_nan():
    r, p = circ_perm_p(np.ones(50), np.arange(50))
    assert np.isnan(r) and np.isnan(p)
