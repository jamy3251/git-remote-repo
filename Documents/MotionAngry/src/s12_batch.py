"""S12: 배치 수집 ABAB 실험 분석 (T15). 폰 events.csv의 batch_plan_seg / sensor_mode / imu_stats 를 읽어
구간별(연속·배치) 수신 표본 수·유효 Hz·배터리 소모를 정리하고, 화면 꺼짐·비충전 5분 창만 골라 모드별 소모율을 비교한다.

사용: python src/s12_batch.py data/raw/life/2026-10-25/life/events.csv
출력: results/s12_batch_segments.csv, results/s12_batch_windows.csv, results/s12_batch_log.txt
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
RES = ROOT / "results"


def kv(s):
    out = {}
    for part in str(s).split(";"):
        if "=" in part:
            k, v = part.split("=", 1)
            out[k] = v
    return out


def main(path):
    e = pd.read_csv(path, engine="python", on_bad_lines="skip")
    e = e[e.wall_ms.astype(str).str.isdigit()].copy()
    e["ms"] = e.wall_ms.astype("int64")
    e["t"] = pd.to_datetime(e.ms, unit="ms") + pd.Timedelta(hours=9)
    seg = e[e.type == "batch_plan_seg"].copy()
    end = e[e.type == "batch_plan_end"]
    if seg.empty:
        print("no batch_plan_seg")
        return
    seg["mode"] = seg.value.map(lambda v: kv(v).get("mode"))
    bounds = list(seg.ms) + [int(end.ms.iloc[0]) if len(end) else int(e.ms.max())]
    st = e[e.type == "imu_stats"].copy()
    for k in ("n", "eff_hz", "max_gap_ms", "batched", "screen", "charging", "level", "charge_uah"):
        st[k] = st.value.map(lambda v, k=k: float(kv(v).get(k, "nan")))
    st = st.sort_values("ms").reset_index(drop=True)
    # 창 소모율: 직전 imu_stats와의 차이
    st["dt_min"] = st.ms.diff() / 60_000
    st["d_uah"] = -st.charge_uah.diff()
    st["d_level"] = -st.level.diff()
    st["prev_screen"] = st.screen.shift()
    st["prev_charging"] = st.charging.shift()
    st["prev_batched"] = st.batched.shift()
    log = []
    rows = []
    for i, (a, b) in enumerate(zip(bounds[:-1], bounds[1:])):
        mode = seg["mode"].iloc[i]
        w = st[(st.ms > a) & (st.ms <= b)]
        lv0 = st[st.ms <= a].level.iloc[-1] if (st.ms <= a).any() else np.nan
        uah0 = st[st.ms <= a].charge_uah.iloc[-1] if (st.ms <= a).any() else np.nan
        r = {"idx": i, "mode": mode, "start": pd.to_datetime(a, unit="ms") + pd.Timedelta(hours=9),
             "minutes": (b - a) / 60_000, "windows": len(w), "samples": w.n.sum(),
             "eff_hz_mean": w.eff_hz.mean(), "eff_hz_min": w.eff_hz.min(), "max_gap_s": w.max_gap_ms.max() / 1000,
             "screen_on_windows": int((w.screen > 0).sum()), "charging_windows": int((w.charging > 0).sum()),
             "level_start": lv0, "level_end": w.level.iloc[-1] if len(w) else np.nan,
             "mAh_used": (uah0 - w.charge_uah.iloc[-1]) / 1000 if len(w) else np.nan}
        rows.append(r)
        log.append(f"seg{i} {mode:5s} {r['start']:%m-%d %H:%M} {r['minutes']:.0f}min windows={r['windows']} "
                   f"samples={r['samples']:.0f} eff_hz mean={r['eff_hz_mean']:.1f} min={r['eff_hz_min']:.1f} "
                   f"max_gap={r['max_gap_s']:.0f}s screen_on={r['screen_on_windows']} charging={r['charging_windows']} "
                   f"level {r['level_start']:.0f}->{r['level_end']:.0f} used={r['mAh_used']:.0f}mAh")
    segs = pd.DataFrame(rows)
    segs.to_csv(RES / "s12_batch_segments.csv", index=False)
    # 통제된 창: 창의 양 끝 모두 화면 꺼짐·비충전, 창 길이 4~6분
    ok = st[(st.screen == 0) & (st.prev_screen == 0) & (st.charging == 0) & (st.prev_charging == 0)
            & (st.batched == st.prev_batched) & st.dt_min.between(4, 6) & (st.ms > bounds[0]) & (st.ms <= bounds[-1])]
    ok = ok.assign(mAh_per_h=ok.d_uah / 1000 / (ok.dt_min / 60))
    ok[["t", "batched", "n", "eff_hz", "max_gap_ms", "level", "d_level", "mAh_per_h"]].to_csv(RES / "s12_batch_windows.csv", index=False)
    log.append("")
    log.append("screen-off, not charging, same-mode 5-min windows (mAh/h = charge counter drop per hour):")
    for bt, g in ok.groupby("batched"):
        log.append(f"  batched={int(bt)} windows={len(g)} eff_hz median={g.eff_hz.median():.1f} (min {g.eff_hz.min():.1f}, max {g.eff_hz.max():.1f}) "
                   f"samples/5min median={g.n.median():.0f} mAh/h median={g.mAh_per_h.median():.0f} mean={g.mAh_per_h.mean():.0f} "
                   f"IQR=[{g.mAh_per_h.quantile(.25):.0f}, {g.mAh_per_h.quantile(.75):.0f}] level drop/5min mean={g.d_level.mean():.2f}")
    # 배치 구간에서 센서가 실제로 낮은 빈도로 돌았는지: eff_hz<10인 창 비율
    b = ok[ok.batched == 1]
    if len(b):
        log.append(f"  batched windows with eff_hz<10: {(b.eff_hz < 10).sum()}/{len(b)}; with max_gap>60s: {(b.max_gap_ms > 60_000).sum()}/{len(b)}")
    # 화면 켜짐 창의 소모율(참고)
    on = st[(st.screen > 0) & (st.charging == 0) & (st.prev_charging == 0) & st.dt_min.between(4, 6)]
    if len(on):
        log.append(f"  screen-on, not charging windows={len(on)} mAh/h median={(on.d_uah / 1000 / (on.dt_min / 60)).median():.0f}")
    txt = "\n".join(log)
    (RES / "s12_batch_log.txt").write_text(txt, encoding="utf-8")
    print(txt)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ROOT / "data" / "raw" / "life" / "2026-10-25" / "life" / "events.csv")
