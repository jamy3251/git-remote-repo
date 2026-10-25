"""S9 접촉 게이팅 규칙 검증(설계 2단계 ContactGate, 결정 D2): K-EmoPhone의 폰 맥락(화면·충전·앱 전경)으로
"폰(또는 기기)이 몸에 있는가"를 판정하는 규칙이 정서 추정에 도움이 되는지 본다.

K-EmoPhone은 움직임이 손목 기기라 '폰이 몸에 있는가'의 직접 정답은 없다. 대신 같은 규칙으로 30분 창을 나누었을 때
  (a) 창의 분포(충전 중·화면 꺼짐 비율) (b) 각성 AUROC가 접촉 판정 창에서 더 높은가 (c) 게이팅으로 버리는 창 비율
을 보고한다. 규칙(초안, ContactGate.java와 동일):
  contact = 충전 중 비율 < 0.5 이고 (화면 켜짐 비율 > 0 또는 정지 비율 still_frac 중앙값 < 0.9)
출력: results/s9_contact.csv, results/S9_NOTES.md
"""
import zipfile

import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score

import s4_kemophone as S4

ROOT = S4.RAW.parents[2]
RES = ROOT / "results"
FEAT = ROOT / "data" / "processed" / "kemophone_2hz_block.parquet"
DEPLOY = dict(n_estimators=50, learning_rate=0.05, num_leaves=3, min_child_samples=20, subsample=0.8,
              subsample_freq=1, class_weight="balanced", verbose=-1)


def intervals(ev, on_values, off_values, t0, t1):
    """이벤트 열(timestamp, type)에서 [t0,t1) 안 'on' 상태 비율."""
    ev = ev.sort_values("timestamp")
    before = ev[ev.timestamp <= t0]
    state = None
    if len(before):
        last = before.iloc[-1]["type"]
        state = last in on_values
    inside = ev[(ev.timestamp > t0) & (ev.timestamp < t1)]
    t = t0
    on_ms = 0
    for _, r in inside.iterrows():
        if state:
            on_ms += r.timestamp - t
        t = r.timestamp
        state = r["type"] in on_values if (r["type"] in on_values or r["type"] in off_values) else state
    if state:
        on_ms += t1 - t
    return on_ms / (t1 - t0) if state is not None or len(inside) else np.nan


def context(pcode):
    z = zipfile.ZipFile(S4.RAW / f"{pcode}.zip")
    def rd(name):
        f = [x for x in z.namelist() if x.endswith(name)]
        return pd.read_csv(z.open(f[0])) if f else pd.DataFrame(columns=["timestamp", "type"])
    screen, charge, apps = rd("ScreenEvent.csv"), rd("ChargeEvent.csv"), rd("AppUsageEvent.csv")
    rows = []
    for _, e in S4.ESM[S4.ESM.pcode == pcode].iterrows():
        t1 = float(e.responseTime); t0 = t1 - S4.PRE_MIN * 60_000
        rows.append({"pcode": pcode, "t": t1,
                     "screen_on": intervals(screen, {"ON", "UNLOCK"}, {"OFF"}, t0, t1),
                     "charging": intervals(charge, {"CONNECTED"}, {"DISCONNECTED"}, t0, t1),
                     "app_events": int(((apps.timestamp > t0) & (apps.timestamp < t1)).sum()) if len(apps) else 0})
    return pd.DataFrame(rows)


def loso_auc(d, feats, y):
    p = np.zeros(len(d))
    for pc in d.pcode.unique():
        te = (d.pcode == pc).to_numpy()
        m = lgb.LGBMClassifier(**DEPLOY, random_state=0).fit(d.loc[~te, feats], y[~te])
        p[te] = m.predict_proba(d.loc[te, feats])[:, 1]
    return p


def main():
    feat = pd.read_parquet(FEAT)
    ctx = pd.concat([context(pc) for pc in sorted(feat.pcode.unique())], ignore_index=True)
    d = feat.merge(ctx, on=["pcode", "t"], how="left")
    fcols = [c for c in d if c.startswith("b2_")]
    still = d["b2_med_still_frac"] if "b2_med_still_frac" in d else d[[c for c in fcols if "still" in c][0]]
    d["contact"] = ((d.charging.fillna(0) < 0.5) & ((d.screen_on.fillna(0) > 0) | (still < 0.9))).astype(int)
    y = (d.arousal > 0).astype(int).to_numpy()
    p = loso_auc(d, fcols, y)
    rows = [{"subset": "all", "n": len(d), "auroc": roc_auc_score(y, p),
             "charging_mean": d.charging.mean(), "screen_on_mean": d.screen_on.mean()}]
    for name, mask in (("contact=1", d.contact == 1), ("contact=0", d.contact == 0),
                       ("charging<0.5", d.charging.fillna(0) < 0.5), ("charging>=0.5", d.charging.fillna(0) >= 0.5),
                       ("screen_on>0", d.screen_on.fillna(0) > 0), ("screen_on=0", d.screen_on.fillna(0) == 0)):
        m = mask.to_numpy()
        rows.append({"subset": name, "n": int(m.sum()),
                     "auroc": roc_auc_score(y[m], p[m]) if m.sum() > 50 and len(set(y[m])) == 2 else np.nan,
                     "charging_mean": d.charging[m].mean(), "screen_on_mean": d.screen_on[m].mean()})
    out = pd.DataFrame(rows)
    out.to_csv(RES / "s9_contact.csv", index=False)
    print(out.round(3).to_string(index=False))
    print("dropped by gate:", round(1 - d.contact.mean(), 3))


if __name__ == "__main__":
    main()
