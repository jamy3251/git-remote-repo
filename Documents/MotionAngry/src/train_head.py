"""T11 (설계 R10): LiteRT 온디바이스 학습 프로브용 모델.

32개 요약 특징 → 표준화 → 로지스틱(가중치 32 + 편향 1). TFLite 시그니처:
  infer(x[N,32]) → p[N,1]
  train(x[N,32], y[N,1]) → loss  (SGD 한 스텝, lr 고정)
  save(checkpoint_path) / restore(checkpoint_path)
표준화 상수(mu, sd)는 모델 상수로 넣는다(K-EmoPhone 전체 통계). 가중치 초기값 0, 편향 0.
출력:
  android/app/src/main/assets/head.tflite
  android/app/src/main/assets/probe_head.txt : 고정 배치(x 64×32, y 64) + 100 스텝 뒤 Python 기준 확률(처음 8개 샘플) + 최종 손실
단말(MainActivity cmd litert_probe)은 같은 배치로 100 스텝을 돌려 시간·메모리·확률 차이를 기록한다.
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "android" / "app" / "src" / "main" / "assets"
N_FEAT = 32
BATCH = 64
STEPS = 100
LR = 0.05


def build_and_export():
    import tensorflow as tf
    d = pd.read_parquet(ROOT / "data" / "processed" / "kemophone_2hz_block.parquet")
    feats = [c for c in d if c.startswith("b2_")]
    assert len(feats) == N_FEAT
    X = d[feats].to_numpy(np.float32)
    y = (d["arousal"] > 0).astype(np.float32).to_numpy()
    mu = X.mean(axis=0)
    sd = X.std(axis=0)
    sd = np.where(sd == 0, 1, sd).astype(np.float32)

    class Head(tf.Module):
        def __init__(self):
            super().__init__()
            self.mu = tf.constant(mu)
            self.sd = tf.constant(sd)
            self.w = tf.Variable(tf.zeros([N_FEAT, 1]), name="w")
            self.b = tf.Variable(tf.zeros([1]), name="b")

        def _logit(self, x):
            z = (x - self.mu) / self.sd
            return tf.matmul(z, self.w) + self.b

        @tf.function(input_signature=[tf.TensorSpec([None, N_FEAT], tf.float32)])
        def infer(self, x):
            return {"p": tf.sigmoid(self._logit(x))}

        @tf.function(input_signature=[tf.TensorSpec([None, N_FEAT], tf.float32), tf.TensorSpec([None, 1], tf.float32)])
        def train(self, x, y):
            # 로지스틱 기울기를 닫힌 식으로 계산한다(GradientTape가 만드는 BroadcastGradientArgs는 TFLite 내장 연산자가 아님).
            z = (x - self.mu) / self.sd
            logit = tf.matmul(z, self.w) + self.b           # [N,1]
            p = tf.sigmoid(logit)
            loss = tf.reduce_mean(tf.nn.sigmoid_cross_entropy_with_logits(labels=y, logits=logit))
            g = p - y                                        # [N,1]
            n = tf.cast(tf.shape(x)[0], tf.float32)
            gw = tf.matmul(z, g, transpose_a=True) / n       # [32,1]
            gb = tf.reduce_sum(g, axis=0) / n                # [1]
            self.w.assign_sub(LR * gw)
            self.b.assign_sub(LR * gb)
            return {"loss": loss}

        @tf.function(input_signature=[tf.TensorSpec([1], tf.float32)])
        def get_weights(self, dummy):
            """체크포인트 대용(내장 연산자만): Java가 w,b를 읽어 StudentModel 텍스트로 저장한다.
            TFLite Java runSignature는 빈 입력을 거부하므로 더미 입력 하나를 둔다."""
            return {"w": tf.reshape(self.w, [N_FEAT]) + 0 * dummy[0], "b": self.b, "mu": self.mu, "sd": self.sd}

        @tf.function(input_signature=[tf.TensorSpec([N_FEAT], tf.float32), tf.TensorSpec([1], tf.float32)])
        def set_weights(self, w, b):
            self.w.assign(tf.reshape(w, [N_FEAT, 1]))
            self.b.assign(b)
            return {"ok": tf.constant(1.0)}

        @tf.function(input_signature=[tf.TensorSpec(shape=[], dtype=tf.string)])
        def save(self, path):
            tf.raw_ops.Save(filename=path, tensor_names=["w", "b"], data=[self.w, self.b])
            return {"path": path}

        @tf.function(input_signature=[tf.TensorSpec(shape=[], dtype=tf.string)])
        def restore(self, path):
            w = tf.raw_ops.Restore(file_pattern=path, tensor_name="w", dt=tf.float32)
            b = tf.raw_ops.Restore(file_pattern=path, tensor_name="b", dt=tf.float32)
            self.w.assign(tf.reshape(w, [N_FEAT, 1]))
            self.b.assign(tf.reshape(b, [1]))
            return {"w": self.w, "b": self.b}

    head = Head()
    # 고정 배치: 앞 64개 응답(결정적)
    xb = X[:BATCH]
    yb = y[:BATCH].reshape(-1, 1)
    losses = []
    for _ in range(STEPS):
        losses.append(float(head.train(tf.constant(xb), tf.constant(yb))["loss"]))
    p = head.infer(tf.constant(xb[:8]))["p"].numpy().ravel()
    # numpy 참조(같은 SGD)로 교차 확인
    w = np.zeros(N_FEAT); b = 0.0
    z = (xb - mu) / sd
    for _ in range(STEPS):
        pr = 1 / (1 + np.exp(-(z @ w + b)))
        g = pr - yb.ravel()
        w -= LR * (z.T @ g) / BATCH
        b -= LR * g.mean()
    p_np = 1 / (1 + np.exp(-(z[:8] @ w + b)))
    assert np.max(np.abs(p - p_np)) < 1e-4, np.max(np.abs(p - p_np))

    # 내보내기 전 가중치를 0으로 되돌린다(단말은 같은 초기값에서 100 스텝을 돌려 비교)
    head.w.assign(tf.zeros([N_FEAT, 1]))
    head.b.assign(tf.zeros([1]))
    # 1) head.tflite: infer+train만, 내장 연산자만(표준 런타임으로 로드 가능해야 함) — 1차 프로브 대상
    # 2) head_ckpt.tflite: save/restore 포함(Save/Restore는 TF 선택 연산자 → flex 위임 필요) — 2차 프로브 대상
    saved_dir = ROOT / "data" / "processed" / "head_saved"
    tf.saved_model.save(head, str(saved_dir), signatures={
        "infer": head.infer.get_concrete_function(),
        "train": head.train.get_concrete_function(),
        "get_weights": head.get_weights.get_concrete_function(),
        "set_weights": head.set_weights.get_concrete_function(),
    })
    conv = tf.lite.TFLiteConverter.from_saved_model(str(saved_dir))
    conv.target_spec.supported_ops = [tf.lite.OpsSet.TFLITE_BUILTINS]
    conv.experimental_enable_resource_variables = True
    tfl = conv.convert()
    (ASSETS / "head.tflite").write_bytes(tfl)
    saved_dir2 = ROOT / "data" / "processed" / "head_saved_ckpt"
    tf.saved_model.save(head, str(saved_dir2), signatures={
        "infer": head.infer.get_concrete_function(),
        "train": head.train.get_concrete_function(),
        "save": head.save.get_concrete_function(),
        "restore": head.restore.get_concrete_function(),
    })
    conv2 = tf.lite.TFLiteConverter.from_saved_model(str(saved_dir2))
    conv2.target_spec.supported_ops = [tf.lite.OpsSet.TFLITE_BUILTINS, tf.lite.OpsSet.SELECT_TF_OPS]
    conv2.experimental_enable_resource_variables = True
    try:
        tfl2 = conv2.convert()
        (ASSETS / "head_ckpt.tflite").write_bytes(tfl2)
        print("head_ckpt.tflite bytes", len(tfl2))
    except Exception as e:
        print("head_ckpt convert failed:", type(e).__name__, str(e)[:200])
    lines = [f"batch {BATCH} feats {N_FEAT} steps {STEPS} lr {LR}"]
    for i in range(BATCH):
        lines.append("x " + " ".join("%.9g" % v for v in xb[i]) + " y %d" % int(yb[i, 0]))
    lines.append("p8 " + " ".join("%.9g" % v for v in p))
    lines.append("loss_final %.9g" % losses[-1])
    lines.append("loss_first %.9g" % losses[0])
    (ASSETS / "probe_head.txt").write_text("\n".join(lines) + "\n")
    print("tflite bytes", len(tfl), "| loss", losses[0], "->", losses[-1], "| p8", np.round(p, 4))
    # PC에서 TFLite 인터프리터로 같은 학습이 되는지(변환 자체 검증)
    try:
        it = tf.lite.Interpreter(model_content=tfl)
        it.allocate_tensors()
        tr = it.get_signature_runner("train")
        inf = it.get_signature_runner("infer")
        for _ in range(STEPS):
            tr(x=xb, y=yb)
        p2 = inf(x=xb[:8])["p"].ravel()
        print("tflite(PC) max |dp| vs TF:", np.max(np.abs(p2 - p)))
    except Exception as e:
        print("tflite(PC) run failed:", type(e).__name__, str(e)[:200])


if __name__ == "__main__":
    build_and_export()
