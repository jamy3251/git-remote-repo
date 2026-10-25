"""R13 회귀 계약 — 보존 (4): s5_life.py가 10-20 로그 1시간 발췌(tests/golden/life)에서 기록된 결과(tests/golden/expected)를 재현한다.
특징 계산·순열검정·곡 단위 비교가 바뀌면 깨진다. 의도된 변경이면 expected를 다시 생성한다:
  MA_LIFE_RAW=tests/golden/life MA_RESULTS=tests/golden/expected python src/s5_life.py
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
GOLD = ROOT / "tests" / "golden"
FILES = ["s5_life_summary.csv", "s5_life_corr.csv", "s5_life_rates.csv", "s5_life_rate_cmp.csv"]


@pytest.mark.skipif(not (GOLD / "expected" / "s5_life_corr.csv").exists(), reason="golden expected not generated")
def test_s5_reproduces_golden(tmp_path, monkeypatch):
    import s5_life as S
    monkeypatch.setattr(S, "RAW", GOLD / "life")
    monkeypatch.setattr(S, "RES", tmp_path)
    S.rng = np.random.default_rng(0)
    S.main()
    for name in FILES:
        got = pd.read_csv(tmp_path / name)
        exp = pd.read_csv(GOLD / "expected" / name)
        assert list(got.columns) == list(exp.columns), name
        assert len(got) == len(exp), name
        for c in exp.columns:
            if exp[c].dtype.kind in "fi":
                assert np.allclose(got[c].to_numpy(float), exp[c].to_numpy(float), rtol=1e-9, atol=1e-12, equal_nan=True), (name, c)
            else:
                assert got[c].astype(str).tolist() == exp[c].astype(str).tolist(), (name, c)


def test_events_parser_golden():
    """보존 (2): events.csv 기존 type·열 순서. 발췌 파일의 type 집합과 열이 그대로여야 한다."""
    ev = pd.read_csv(GOLD / "life" / "2026-10-20" / "events_golden.csv")
    assert list(ev.columns) == ["t_ns", "wall_ms", "type", "app", "media", "value"]
    assert {"app", "media", "screen_on", "screen_off", "rate", "log_start"} <= set(ev["type"])
