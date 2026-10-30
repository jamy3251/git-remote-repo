"""루프 시뮬레이터의 numpy 학생 학습식이 단말 head.tflite(train_head.py 기준 픽스처 probe_head.txt)와 일치하는지."""
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[1]
PROBE = ROOT / "android" / "app" / "src" / "main" / "assets" / "probe_head.txt"
BLOCK = ROOT / "data" / "processed" / "kemophone_2hz_block.parquet"


@pytest.mark.skipif(not (PROBE.exists() and BLOCK.exists()), reason="probe fixture or data missing")
def test_numpy_student_matches_tflite_probe():
    sys.path.insert(0, str(ROOT))
    from experiments.loop_sim.sim import gd_steps, sigmoid_logit
    lines = PROBE.read_text().splitlines()
    head = lines[0].split()
    batch, nfeat, steps, lr = int(head[1]), int(head[3]), int(head[5]), float(head[7])
    xs, ys = [], []
    for ln in lines[1:1 + batch]:
        parts = ln.split()
        xs.append([float(v) for v in parts[1:1 + nfeat]])
        ys.append(float(parts[-1]))
    p8 = np.array([float(v) for v in [ln for ln in lines if ln.startswith("p8 ")][0].split()[1:]])
    d = pd.read_parquet(BLOCK)
    feats = [c for c in d if c.startswith("b2_")]
    X = d[feats].to_numpy(np.float32)
    mu, sd = X.mean(0), X.std(0)
    sd = np.where(sd == 0, 1, sd)
    Z = ((np.array(xs, np.float32) - mu) / sd).astype(float)
    w, b = gd_steps(np.zeros(nfeat), 0.0, Z, np.array(ys), steps=steps, lr=lr)
    p = sigmoid_logit(Z[:8], w, b)
    assert np.max(np.abs(p - p8)) < 1e-4


def test_guard_hysteresis():
    sys.path.insert(0, str(ROOT))
    from experiments.loop_sim.sim import Guard
    g = Guard(active=True)
    # 15건: 출하 전부 정답, 학생 전부 오답 → 복귀
    for i in range(15):
        g.score(i * 3_600_000, 1, 0.9, 0.1)
    assert g.active is False and g.switches[-1][1] == "to_ship"
    # 이후 학생이 계속 맞으면(14일 창 안 누적) 재적용
    for i in range(15, 60):
        g.score(i * 3_600_000, 1, 0.1, 0.9)
    assert g.active is True
