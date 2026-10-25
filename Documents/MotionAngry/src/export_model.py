"""S3 준비: WESAD 방향무관 특징(2/8/16/32Hz)으로 LightGBM을 학습해 앱 assets로 내보낸다.

출력 (android/app/src/main/assets/)
- model{fs}.txt   : 트리 평탄화 텍스트 (앱의 Java 추론기가 읽음)
- selftest{fs}.txt: WESAD 원시 창 몇 개 + Python이 계산한 특징·확률 (앱 내 일치 검증용)
"""
import pickle
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd
from scipy import signal as sps

import s1b_wesad as W

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "android" / "app" / "src" / "main" / "assets"
N_SELFTEST = 5
FS_ALL = (2, 8, 16, 32)


def dec(a, fs):
    """32Hz → fs. 2Hz는 K-EmoPhone 분석과 같게 8Hz를 거쳐 4배씩 두 번 줄인다."""
    if fs == 32:
        return a
    if fs == 2:
        a = sps.decimate(a, 4, axis=0, zero_phase=True)
        return sps.decimate(a, 4, axis=0, zero_phase=True)
    return sps.decimate(a, 32 // fs, axis=0, zero_phase=True)


def add_noori2(df):
    """wesad_windows.parquet에는 2Hz 열이 없으므로 같은 창 위치에서 계산해 붙인다."""
    rows = []
    for uid, g in df.groupby("uid", sort=False):
        data = pickle.load(open(W.RAW / uid / f"{uid}.pkl", "rb"), encoding="latin1")
        acc = data["signal"]["wrist"]["ACC"] / 64.0
        for i, t0 in g.t0.items():
            a = acc[int(t0 * W.FS_ACC): int((t0 + W.WIN_S) * W.FS_ACC)]
            rows.append(pd.Series({f"noori2_{k}": v for k, v in W.raw_feats(dec(a, 2), 2, orient=False).items()}, name=i))
    return df.join(pd.DataFrame(rows))


def flatten(tree):
    """dump_model 트리 → 노드 목록. 내부 노드: split 특징·임계값·좌우 인덱스, 잎: 값."""
    nodes = []

    def walk(t):
        i = len(nodes)
        nodes.append(None)
        if "leaf_value" in t:
            nodes[i] = ("L", t["leaf_value"])
        else:
            assert t["decision_type"] == "<=", t["decision_type"]
            l, r = walk(t["left_child"]), walk(t["right_child"])
            nodes[i] = ("N", t["split_feature"], t["threshold"], int(t["default_left"]), l, r)
        return i

    walk(tree["tree_structure"])
    return nodes


def export(fs, df):
    feats = [c for c in df if c.startswith(f"noori{fs}_")]
    m = lgb.LGBMClassifier(**W.PARAMS, random_state=0).fit(df[feats], df.y)
    dump = m.booster_.dump_model()
    lines = [f"features {len(feats)} " + " ".join(f.split("_", 1)[1] for f in feats), f"trees {len(dump['tree_info'])}"]
    for t in dump["tree_info"]:
        nodes = flatten(t)
        lines.append(f"tree {len(nodes)}")
        for n in nodes:
            lines.append("L %.17g" % n[1] if n[0] == "L" else "N %d %.17g %d %d %d" % n[1:])
    (ASSETS / f"model{fs}.txt").write_text("\n".join(lines) + "\n")
    return m, feats


def selftest(fs, model, feats):
    """S2 피험자의 원시 창 N개를 fs로 만들어 기대 특징·확률과 함께 저장."""
    data = pickle.load(open(W.RAW / "S2" / "S2.pkl", "rb"), encoding="latin1")
    acc = data["signal"]["wrist"]["ACC"] / 64.0
    out = [f"cases {N_SELFTEST}"]
    for k in range(N_SELFTEST):
        t0 = 600 + k * 300  # 10분부터 5분 간격
        a = acc[t0 * 32:(t0 + 60) * 32]
        a = dec(a, fs)
        f = W.raw_feats(a, fs, orient=False)
        x = np.array([[f[c.split("_", 1)[1]] for c in feats]])
        p = model.predict_proba(pd.DataFrame(x, columns=feats))[0, 1]
        out.append(f"case {len(a)}")
        out += ["%.17g %.17g %.17g" % tuple(r) for r in a]
        out.append("feat " + " ".join("%.17g" % v for v in x[0]))
        out.append("prob %.17g" % p)
    (ASSETS / f"selftest{fs}.txt").write_text("\n".join(out) + "\n")


def main():
    ASSETS.mkdir(parents=True, exist_ok=True)
    df = add_noori2(pd.read_parquet(W.OUT))
    for fs in FS_ALL:
        m, feats = export(fs, df)
        selftest(fs, m, feats)
        print(fs, "Hz:", len(feats), "features,", m.booster_.num_trees(), "trees")


if __name__ == "__main__":
    main()
