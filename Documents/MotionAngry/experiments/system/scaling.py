"""Phase 4 (RQ7) 학습 비용 스케일링 — PC에서 학생 모델의 파라미터 수·배치 크기에 따른 100스텝 학습 시간.

두 구현을 잰다:
  numpy  : 시뮬레이터와 같은 닫힌 식 GD(experiments/loop_sim/sim.py gd_steps)
  tflite : train_head.py와 같은 구조를 TFLite로 변환해 PC 인터프리터(단일 스레드)에서 train 시그니처 100회 — 단말 LiteRT와 같은 그래프.
          (tensorflow 미설치·변환 실패 시 numpy만 기록)
파라미터 수: 특징 32 → 로지스틱 33 / 특징 329(=32×~10 가상 확장) → 330 / 3,299 → 3,300. 배치: 64 / 640 / 2,000.
입력은 난수(표준정규)로 생성(시간은 데이터 값과 무관). 각 조건 5회 반복의 중앙값(ms).
주의: CPU가 다른 작업으로 바쁠 때 재면 과대평가된다. 실행 시 nproc 부하를 함께 기록한다.
사용: python experiments/system/scaling.py
출력: results/system/scaling_pc.csv
"""
import os
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
RES = ROOT / "results" / "system"
RES.mkdir(parents=True, exist_ok=True)
N_PARAMS = (33, 330, 3300)
BATCHES = (64, 640, 2000)
STEPS, LR, REPS = 100, 0.05, 5


def numpy_time(nf, n):
    from experiments.loop_sim.sim import gd_steps
    rng = np.random.default_rng(0)
    Z = rng.standard_normal((n, nf)).astype(np.float32).astype(float)
    y = (rng.random(n) < 0.4).astype(float)
    ts = []
    for _ in range(REPS):
        t0 = time.perf_counter()
        gd_steps(np.zeros(nf), 0.0, Z, y, steps=STEPS, lr=LR)
        ts.append((time.perf_counter() - t0) * 1000)
    return float(np.median(ts))


def tflite_time(nf, n):
    try:
        import tensorflow as tf
    except Exception as e:  # noqa: BLE001
        return np.nan, f"no tensorflow: {type(e).__name__}"

    class Head(tf.Module):
        def __init__(self):
            super().__init__()
            self.w = tf.Variable(tf.zeros([nf, 1]), name="w")
            self.b = tf.Variable(tf.zeros([1]), name="b")

        @tf.function(input_signature=[tf.TensorSpec([None, nf], tf.float32), tf.TensorSpec([None, 1], tf.float32)])
        def train(self, x, y):
            logit = tf.matmul(x, self.w) + self.b
            p = tf.sigmoid(logit)
            loss = tf.reduce_mean(tf.nn.sigmoid_cross_entropy_with_logits(labels=y, logits=logit))
            g = p - y
            m = tf.cast(tf.shape(x)[0], tf.float32)
            self.w.assign_sub(LR * tf.matmul(x, g, transpose_a=True) / m)
            self.b.assign_sub(LR * tf.reduce_sum(g, axis=0) / m)
            return {"loss": loss}

    try:
        head = Head()
        conv = tf.lite.TFLiteConverter.from_concrete_functions([head.train.get_concrete_function()], head)
        conv.target_spec.supported_ops = [tf.lite.OpsSet.TFLITE_BUILTINS]
        conv.experimental_enable_resource_variables = True
        tfl = conv.convert()
        it = tf.lite.Interpreter(model_content=tfl, num_threads=1)
        it.allocate_tensors()
        inp = it.get_input_details()
        out = it.get_output_details()
        rng = np.random.default_rng(0)
        x = rng.standard_normal((n, nf)).astype(np.float32)
        y = (rng.random((n, 1)) < 0.4).astype(np.float32)
        for d_ in inp:
            it.resize_tensor_input(d_["index"], x.shape if d_["shape"][-1] == nf else y.shape)
        it.allocate_tensors()
        xi = [d_ for d_ in inp if d_["shape"][-1] == nf][0]["index"]
        yi = [d_ for d_ in inp if d_["shape"][-1] == 1][0]["index"]
        ts = []
        for _ in range(REPS):
            t0 = time.perf_counter()
            for _ in range(STEPS):
                it.set_tensor(xi, x)
                it.set_tensor(yi, y)
                it.invoke()
            ts.append((time.perf_counter() - t0) * 1000)
        return float(np.median(ts)), f"tflite {len(tfl)} bytes"
    except Exception as e:  # noqa: BLE001
        return np.nan, f"tflite failed: {type(e).__name__}: {str(e)[:120]}"


def main():
    load = os.getloadavg()[0] if hasattr(os, "getloadavg") else np.nan
    rows = []
    for npar in N_PARAMS:
        nf = npar - 1
        for n in BATCHES:
            t_np = numpy_time(nf, n)
            t_tf, note = tflite_time(nf, n)
            rows.append({"n_params": npar, "batch": n, "steps": STEPS, "numpy_ms": t_np, "tflite_pc_ms": t_tf, "note": note, "cpu_load": load})
            print(f"params={npar:5d} batch={n:5d}: numpy {t_np:8.1f} ms | tflite(PC,1 thread) {t_tf:8.1f} ms  {note}", flush=True)
    pd.DataFrame(rows).to_csv(RES / "scaling_pc.csv", index=False)


if __name__ == "__main__":
    main()
