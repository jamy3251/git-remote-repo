"""R3: 조정 탭·조정 날과 평가 탭·평가 날의 교집합이 0이어야 한다. 합성 로그로 s8_teacher → s8_student 경로를 돈다."""
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
import s8_common as C  # noqa: E402
import s8_student as S  # noqa: E402
import s8_teacher as T  # noqa: E402


def synth(tmp_path, days=9, taps_per_day=6, seed=0):
    rng = np.random.default_rng(seed)
    fcols = [f"s_med_f{i}" for i in range(16)] + [f"s_iqr_f{i}" for i in range(16)]
    rows, ev = [], []
    base = pd.Timestamp("2026-10-01", tz=C.TZ).value // 10**6
    for d in range(days):
        day0 = base + d * 86_400_000
        for m in range(60 * 10):  # 하루 10시간, 1분 간격
            wall = day0 + 9 * 3_600_000 + m * 60_000
            x = rng.normal(size=32)
            smile = rng.uniform(0, 0.8)
            rows.append({"t_ns": wall * 10**6, "wall_ms": wall, "minutes": 30, "p_arousal": 1 / (1 + np.exp(-x[0])),
                         "p_valence": 1 / (1 + np.exp(-x[1])), "v": 2, "held": int(rng.random() < 0.5),
                         "face_frames": 100, "face_rate": 0.8, "smile_mean": smile, "jaw_mean": rng.uniform(0, 0.3),
                         **dict(zip(fcols, x))})
        for t in range(taps_per_day):
            wall = day0 + 10 * 3_600_000 + t * 80 * 60_000 + 30_000
            ev.append({"t_ns": wall * 10**6, "wall_ms": wall, "type": "affect", "app": "", "media": "",
                       "value": f"v={rng.uniform(-1,1):.3f};a={rng.uniform(-1,1):.3f};i=0.5;e=;j=yes;pa=0.5;pv=0.5;src=ask_B"})
        ev.append({"t_ns": (day0 + 1) * 10**6, "wall_ms": day0 + 1, "type": "ask_sched", "app": "", "media": "", "value": "arm=B;idx=0;at=1;future=1"})
    affect = pd.DataFrame(rows)
    affect["day"] = C.day_of(affect["wall_ms"])
    events = pd.DataFrame(ev)
    events["day"] = C.day_of(events["wall_ms"])
    return affect, events


def test_no_leak_between_tuning_and_eval(tmp_path, monkeypatch):
    affect, events = synth(tmp_path)
    monkeypatch.setattr(C, "RES", tmp_path)
    monkeypatch.setattr(S.C, "RES", tmp_path)
    taps = C.grid_taps(events)
    params_rows = []
    for k in (3, 5, 7):
        lab, params = T.build(affect, taps, k)
        lab.to_csv(tmp_path / f"s8_teacher_k{k}.csv", index=False)
        params_rows.append(params)
    pd.DataFrame(params_rows).to_csv(tmp_path / "s8_teacher_params.csv", index=False)
    rng = np.random.default_rng(0)
    for k in (3, 5, 7):
        out, students = S.evaluate(affect, taps, events, k, rng)  # 내부 assert가 누출을 잡는다
        days = sorted(affect.day.unique())
        tp = pd.read_csv(tmp_path / f"s8_student_taps_k{k}.csv")
        assert set(tp.day) <= set(days[k:])
        used = set(int(x) for x in str(params_rows[[p["k"] for p in params_rows].index(k)]["tuning_tap_wall_ms"]).split("|") if x)
        assert not (used & set(tp.wall_ms.astype(int)))
        assert any(r["model"] == "student" for r in out)


def test_leak_is_detected():
    affect, events = synth(None, days=4)
    taps = C.grid_taps(events)
    # 평가 탭에 조정 탭을 억지로 섞으면 단언이 깨져야 한다
    with pytest.raises(AssertionError):
        days = sorted(affect.day.unique())
        ev = taps.copy()
        ev["day"] = days[-1]  # 모든 탭을 마지막 날로 → 조정 탭(wall_ms)이 평가 집합에 포함
        lab, params = T.build(affect, taps, 3)
        tuning_taps = set(int(x) for x in str(params["tuning_tap_wall_ms"]).split("|") if x)
        assert tuning_taps, "조정 탭이 없으면 이 테스트는 무의미"
        assert not (set(ev.wall_ms.astype(int)) & tuning_taps), "누출"
