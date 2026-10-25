"""S10 외부 데이터셋(설계 3단계 T17): 손목 원시 가속도가 32Hz인 공개 데이터로 "8Hz 상한" 한계를 보강하고,
s11(신원 식별)과 같은 특징 파이프라인을 재사용한다.

지원 형식
  1) Empatica E4 내보내기(간호사 스트레스 데이터셋, Zenodo 5514277 / Dryad 5hqbzkh6f): 세션 폴더마다 ACC.csv
     - 1행: 시작 UNIX 시각(초), 2행: 샘플링 주파수(32), 이후 x,y,z (1/64 g 단위)
     - 라벨: SurveyResults.xlsx(간호사별 스트레스 사건 시작/종료·수준) — 열 이름은 데이터셋 설명서에 따라 조정
  2) DAPPER(Synapse): 승인 뒤 형식을 보고 loader 추가 【미구현】
사용: python src/s10_external.py --root data/raw/nurse  (ACC.csv를 재귀 탐색)
출력: data/processed/nurse_windows.parquet (창 특징: 2Hz 블록 16개 요약 32개 + 32Hz 원시 특징, 창=5분), results/S10_NOTES.md 갱신은 수동.
【미검증】 2026-10-24 현재 데이터 미입수. 파일 형식은 Empatica 공개 문서 기준이며 실제 파일로 확인 필요.
"""
import argparse
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
import s1b_wesad as W  # raw_feats(acc, fs, orient=False)
from s6_build_2hz import block2

WIN_S = 300      # 5분 창
STEP_S = 300


def read_e4_acc(path):
    """Empatica ACC.csv → (t0_s, fs, xyz[g])"""
    with open(path) as f:
        t0 = float(f.readline().split(",")[0])
        fs = float(f.readline().split(",")[0])
    xyz = pd.read_csv(path, skiprows=2, header=None).to_numpy(float) / 64.0
    return t0, fs, xyz


def to_8hz(xyz, fs):
    """32Hz → 8Hz: 4개 평균(DailyEngine의 보간·평균과 같은 역할)."""
    k = int(round(fs / 8))
    n = len(xyz) // k
    return xyz[:n * k].reshape(n, k, 3).mean(axis=1)


def windows(path):
    t0, fs, xyz = read_e4_acc(path)
    x8 = to_8hz(xyz, fs)
    rows = []
    for s in range(0, len(x8) - WIN_S * 8 + 1, STEP_S * 8):
        w8 = x8[s:s + WIN_S * 8]
        per = []
        for m in range(WIN_S // 60):
            per.append(W.raw_feats(block2(w8[m * 480:(m + 1) * 480]), 2, orient=False))
        df = pd.DataFrame(per)
        feat = {**df.median().add_prefix("b2_med_").to_dict(), **(df.quantile(.75) - df.quantile(.25)).add_prefix("b2_iqr_").to_dict()}
        raw32 = W.raw_feats(xyz[s * 4:(s + WIN_S * 8) * 4], int(fs), orient=False)
        feat.update({f"r32_{k}": v for k, v in raw32.items()})
        feat.update({"file": str(path), "t_start": t0 + s / 8, "subject": path.parent.parent.name if path.parent.parent != path.parent else path.parent.name})
        rows.append(feat)
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=str(ROOT / "data" / "raw" / "nurse"))
    a = ap.parse_args()
    files = sorted(Path(a.root).rglob("ACC.csv"))
    if not files:
        print("ACC.csv 없음:", a.root, "— 간호사 E4 데이터셋을 data/raw/nurse/ 에 풀어 주세요")
        sys.exit(1)
    rows = []
    for f in files:
        try:
            rows += windows(f)
        except Exception as e:
            print("skip", f, type(e).__name__, e)
    d = pd.DataFrame(rows)
    out = ROOT / "data" / "processed" / "nurse_windows.parquet"
    d.to_parquet(out)
    print(len(d), "windows from", len(files), "files →", out)


if __name__ == "__main__":
    main()
