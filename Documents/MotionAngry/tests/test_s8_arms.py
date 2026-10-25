import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
import s8_common as C  # noqa: E402


def test_subsample_a_to_b_count():
    taps = pd.DataFrame({"arm": ["A"] * 10 + ["B"] * 3, "a": np.arange(13.0)})
    sub = C.subsample_a_to_b(taps, np.random.default_rng(1))
    assert (sub.arm == "A").sum() == 3 and (sub.arm == "B").sum() == 3
    taps2 = pd.DataFrame({"arm": ["A"] * 2 + ["B"] * 5, "a": np.arange(7.0)})
    sub2 = C.subsample_a_to_b(taps2, np.random.default_rng(1))
    assert (sub2.arm == "A").sum() == 2  # A가 더 적으면 그대로


def test_missed_rate_from_sched_and_fired():
    ev = pd.DataFrame({"type": ["ask_sched", "ask_sched", "ask_sched", "ask", "ask", "ask"],
                       "value": ["arm=B;idx=0;at=1;future=1", "arm=B;idx=1;at=2;future=1", "arm=B;idx=2;at=0;future=0",
                                 "arm=B;pa=;pv=", "arm=A;pa=0.5;pv=0.5", "arm=B;pa=;pv="]})
    m = C.missed_rate(ev)
    assert m["scheduled"] == 2 and m["fired"] == 2 and m["missed_rate"] == 0
    ev2 = ev.iloc[:3]
    m2 = C.missed_rate(ev2)
    assert m2["fired"] == 0 and m2["missed_rate"] == 1.0


def test_row_before_tap_window():
    affect = pd.DataFrame({"wall_ms": [0, 60_000, 120_000]})
    assert C.row_before_tap(affect, 125_000) == 2
    assert C.row_before_tap(affect, 120_000 + 6 * 60_000) is None
    assert C.row_before_tap(affect, -1) is None


def test_logistic_roundtrip(tmp_path):
    names = [f"f{i}" for i in range(4)]
    rng = np.random.default_rng(0)
    X = rng.normal(size=(200, 4)); y = (X[:, 0] + 0.5 * X[:, 1] > 0).astype(int)
    st = C.Student(names).fit(X, y)
    st.write(tmp_path / "m.txt")
    n2, mu, sd, w, b = C.read_logistic(tmp_path / "m.txt")
    assert n2 == names
    z = ((X - mu) / sd) @ w + b
    assert np.allclose(1 / (1 + np.exp(-z)), st.predict(X), atol=1e-12)
