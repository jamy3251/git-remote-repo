"""S8 공용: 폰 일상 로그(affect.csv v2, events.csv) 읽기, 격자 라벨 파싱·이진화(R2), 팔 처리(R1/R11),
학생 모델(표준화+로지스틱, s7 own_model과 동일) 학습·내보내기(StudentModel.java 형식).

입력 디렉터리: data/raw/life/<날짜>/ (앱 files/life를 그대로 복사). 여러 날짜 폴더를 합친다.
"""
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw" / "life"
RES = ROOT / "results"
TZ = "Asia/Seoul"
MIN_N = 20            # R2: 분할당 팔 B 탭 최소 수
TAP_WINDOW_MIN = 5    # 탭 직전 affect 행 허용 간격(분)


# ---------- 읽기 ----------
def load_csvs(pattern):
    fs = sorted(RAW.glob(f"*/{pattern}"))
    parts = []
    for f in fs:
        try:
            parts.append(pd.read_csv(f))
        except Exception:
            continue
    return pd.concat(parts, ignore_index=True) if parts else pd.DataFrame()


def load_affect():
    """affect.csv v2만(열 'v' 있음). 중복 행 제거, 시간순."""
    d = load_csvs("affect*.csv")
    if d.empty or "v" not in d:
        return pd.DataFrame()
    d = d[d["v"] >= 2].drop_duplicates(["t_ns", "wall_ms"]).sort_values("wall_ms").reset_index(drop=True)
    d["day"] = day_of(d["wall_ms"])
    return d


def load_events():
    d = load_csvs("events*.csv")
    if d.empty:
        return d
    d = d.drop_duplicates(["t_ns", "wall_ms", "type"]).sort_values("wall_ms").reset_index(drop=True)
    d["day"] = day_of(d["wall_ms"])
    return d


def day_of(wall_ms):
    return pd.to_datetime(wall_ms, unit="ms", utc=True).dt.tz_convert(TZ).dt.strftime("%Y-%m-%d")


# ---------- 격자 라벨 ----------
def parse_kv(value):
    out = {}
    for part in str(value).split(";"):
        if "=" in part:
            k, v = part.split("=", 1)
            out[k] = v
    return out


def grid_taps(events):
    """events type=affect → 표: wall_ms, t_ns, day, v, a, i, e, j, arm(A|B|manual), src."""
    rows = []
    for _, r in events[events["type"] == "affect"].iterrows():
        kv = parse_kv(r["value"])
        src = kv.get("src", "")
        arm = "A" if src == "ask_A" else "B" if src == "ask_B" else "manual"
        rows.append({"wall_ms": r["wall_ms"], "t_ns": r["t_ns"], "day": r["day"],
                     "v": float(kv.get("v", "nan")), "a": float(kv.get("a", "nan")), "i": float(kv.get("i", "nan")),
                     "e": kv.get("e", ""), "j": kv.get("j", ""), "arm": arm, "src": src,
                     "pa": float(kv.get("pa") or "nan"), "pv": float(kv.get("pv") or "nan")})
    return pd.DataFrame(rows)


def binarize(x):
    """R2: >0 양성(1), <0 음성(0), ==0·NaN 제외(NaN)."""
    x = np.asarray(x, dtype=float)
    out = np.full(len(x), np.nan)
    out[x > 0] = 1
    out[x < 0] = 0
    return out


def enough(n):
    return n >= MIN_N


# ---------- 팔 ----------
def subsample_a_to_b(taps, rng):
    """R1: 분석에서 A를 B 횟수만큼 무작위 부표본 추출."""
    b = taps[taps.arm == "B"]
    a = taps[taps.arm == "A"]
    if len(a) > len(b):
        a = a.sample(n=len(b), random_state=rng)
    return pd.concat([a, b], ignore_index=True)


def missed_rate(events):
    """R11: ask_sched(future=1) 대비 실제 ask(arm=B) 발화 비율. {scheduled, fired, missed_rate}"""
    sched = events[(events["type"] == "ask_sched") & events["value"].astype(str).str.contains("future=1")]
    fired = events[(events["type"] == "ask") & events["value"].astype(str).str.contains("arm=B")]
    n_s, n_f = len(sched), len(fired)
    return {"scheduled": n_s, "fired": n_f, "missed_rate": (n_s - n_f) / n_s if n_s else np.nan}


# ---------- 특징 ----------
def feature_cols(affect):
    return [c for c in affect.columns if c.startswith("s_med_") or c.startswith("s_iqr_")]


def minute_cols(affect):
    return [c for c in affect.columns if c.startswith("m_")]


def row_before_tap(affect, wall_ms, window_min=TAP_WINDOW_MIN):
    """탭 직전(허용 간격 안) affect 행 인덱스, 없으면 None."""
    w = affect["wall_ms"].to_numpy()
    i = np.searchsorted(w, wall_ms, side="right") - 1
    if i < 0 or wall_ms - w[i] > window_min * 60_000:
        return None
    return int(i)


# ---------- 학생 모델 ----------
class Student:
    """표준화(학습 데이터 평균·표준편차) + L2 로지스틱(C=0.1). s7_cumulative.own_model과 같다."""

    def __init__(self, names, C=0.1):
        self.names = list(names)
        self.C = C
        self.mu = self.sd = self.w = None
        self.b = 0.0

    def fit(self, X, y):
        X = np.asarray(X, dtype=float)
        self.mu = X.mean(axis=0)
        self.sd = X.std(axis=0)
        self.sd = np.where(self.sd == 0, 1.0, self.sd)
        m = LogisticRegression(C=self.C, class_weight="balanced", max_iter=1000).fit((X - self.mu) / self.sd, y)
        self.w = m.coef_[0]
        self.b = float(m.intercept_[0])
        return self

    def predict(self, X):
        z = ((np.asarray(X, dtype=float) - self.mu) / self.sd) @ self.w + self.b
        return 1 / (1 + np.exp(-z))

    def write(self, path):
        write_logistic(path, self.names, self.mu, self.sd, self.w, self.b)


def write_logistic(path, names, mu, sd, w, b):
    """StudentModel.java 형식."""
    lines = [f"logistic {len(names)} " + " ".join(names),
             "mu " + " ".join("%.17g" % v for v in mu),
             "sd " + " ".join("%.17g" % v for v in sd),
             "w " + " ".join("%.17g" % v for v in w),
             "b %.17g" % b]
    Path(path).write_text("\n".join(lines) + "\n")


def read_logistic(path):
    t = Path(path).read_text().strip().split("\n")
    h = t[0].split()
    n = int(h[1])
    names = h[2:2 + n]
    vec = lambda line: np.array([float(x) for x in line.split()[1:]])
    return names, vec(t[1]), vec(t[2]), vec(t[3]), float(t[4].split()[1])
