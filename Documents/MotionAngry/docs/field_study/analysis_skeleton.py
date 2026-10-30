"""현장 연구 분석 뼈대 (docs/field_study/PREREGISTRATION_FIELD.md 6절의 코드판).

사전등록 시점에 함수 서명·docstring을 고정하고, 자료 회수 후 TODO만 채운다.
입력: data/raw/field/F01/, F02/ … (각 폴더 = 단말 files/ 복사본: life/affect*.csv, life/events.csv, models/)
출력: results/field_primary.csv, field_secondary.csv, field_guard.csv, field_exclusions.csv

실행 예:  python docs/field_study/analysis_skeleton.py --root data/raw/field --out results
의존: experiments/common/eval.py (user_auc, boot_ci_users, wilcoxon_paired), src/s8_common.py (parse_kv, binarize, row_before_tap, subsample_a_to_b)
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT))
from experiments.common.eval import boot_ci_users, user_auc, wilcoxon_paired  # noqa: E402

# 사전등록 상수 (PREREGISTRATION_FIELD 5~7절). 등록 후 변경 금지.
MIN_B_RESPONSES = 20       # 1차 분석 참가자 포함 조건
MIN_B_SENSITIVITY = 10     # 민감도 (a)
TAP_WINDOW_MIN = 5         # 응답 직전 분 행 탐색 창
BASELINE_DAYS = 7          # D0~D6 기준선
STUDY_DAYS = 28
GUARD_WINDOW_DAYS = 14     # DriftGuard.WINDOW_MS
BOOT_N, BOOT_SEED = 1000, 0
MIN_ROWS_PER_DAY = 720     # 24h affect 행 절반 미만인 날 제외


# ---------- 로드 ----------
def list_participants(root: Path) -> list[str]:
    """root 아래 `F\\d\\d` 폴더 이름을 정렬해 돌려준다. 그 외 폴더는 무시하고 경고."""
    # TODO
    raise NotImplementedError


def load_participant(root: Path, code: str) -> dict:
    """한 참가자의 affect(v>=3, affect_old_* 포함 병합), events, consent/phase 정보를 dict로.

    반환 키: affect(DataFrame), events(DataFrame), code, install_ms(log_start 첫 wall_ms),
    student_enabled_ms(phase 이벤트 또는 install_ms + 7일), media_plain(bool), app_version(str).
    s8_common.load_affect/load_events는 고정 경로를 읽으므로 여기서는 glob을 직접 돈다.
    """
    # TODO
    raise NotImplementedError


# ---------- 응답 → 분석 행 ----------
def responses(part: dict) -> pd.DataFrame:
    """events `type=affect`를 응답 단위 표로.

    열: code, wall_ms, day(설치일 기준 0부터), phase(baseline|student), arm(A|B|manual, src에서),
        a, v, i, e, j, pa, pv(단말이 그때 보여준 값), psa, psv, y_a, y_v(binarize: >0→1, <0→0, ==0→NaN).
    같은 `ask` 발화에 대한 중복 응답은 첫 번째만 남긴다(사전등록 6.2).
    """
    # TODO
    raise NotImplementedError


def join_minute_row(resp: pd.DataFrame, affect: pd.DataFrame) -> pd.DataFrame:
    """각 응답에 직전 TAP_WINDOW_MIN분 안 가장 가까운 affect 행의
    p_arousal, p_valence, p_student_a, p_student_v, held, contact, smile_mean, jaw_mean, face_rate를 붙인다.
    없으면 NaN(이후 제외 사유 'no_minute_row'). s8_common.row_before_tap 재사용.
    """
    # TODO
    raise NotImplementedError


def teacher_labels(resp: pd.DataFrame, affect: pd.DataFrame, params: dict) -> pd.DataFrame:
    """응답 직전 5분 분 행들의 표정 집계로 TeacherRule 판정을 붙인다.

    params = {theta_v, theta_a, conf_min} (단말 files/models/teacher_params.txt 값, 전 참가자 공통 고정).
    teacher_v = mean(smile_mean) >= theta_v, teacher_a = mean(smile_mean + jaw_mean) >= theta_a,
    face_rate 평균 < conf_min 이면 NaN.
    """
    # TODO
    raise NotImplementedError


# ---------- 제외 규칙 ----------
def daily_coverage(affect: pd.DataFrame, install_ms: int) -> pd.Series:
    """day → affect 행 수. MIN_ROWS_PER_DAY 미만인 날은 그 날 응답을 제외(사전등록 7절)."""
    # TODO
    raise NotImplementedError


def apply_exclusions(resp: pd.DataFrame, coverage: pd.Series) -> tuple[pd.DataFrame, pd.DataFrame]:
    """응답 단위 제외: day==0, a==0(y_a NaN), 분 행 없음, 커버리지 미달 날, arm!=B(1차용 플래그).

    반환: (남은 응답, 제외 로그 DataFrame[code, wall_ms, reason]).
    """
    # TODO
    raise NotImplementedError


def eligible_users(resp_b_student: pd.DataFrame, min_n: int = MIN_B_RESPONSES) -> pd.Series:
    """참가자별 (유효 팔 B 응답 수 ≥ min_n) ∧ (y_a 두 부류 존재) 불리언 Series. 미달 사유는 별도 표로."""
    # TODO
    raise NotImplementedError


# ---------- 1차 지표 ----------
def primary_auroc(resp: pd.DataFrame, task: str = "a", min_n: int = MIN_B_RESPONSES) -> pd.DataFrame:
    """학생 활성 기간·팔 B 응답에서 참가자별 AUROC(출하) vs AUROC(학생).

    task 'a': y_a vs (p_arousal, p_student_a); 'v': y_v vs (p_valence, p_student_v).
    eval.user_auc(df, y=..., p=..., user='code', min_n=min_n)를 두 번 호출.
    반환 열: code, n, auc_base, auc_student, diff.
    """
    # TODO
    raise NotImplementedError


def compare_paired(per_user: pd.DataFrame) -> dict:
    """사전등록 6.3: Wilcoxon 부호순위(양측) + 참가자 부트스트랩 CI.

    eval.wilcoxon_paired(per_user.auc_student, per_user.auc_base) → (p, r, n_nonzero)
    eval.boot_ci_users(per_user.auc_student, per_user.auc_base, n=BOOT_N, seed=BOOT_SEED) → (mean_diff, lo, hi)
    반환: {n_users, mean_diff, ci_lo, ci_hi, median_diff, wilcoxon_p, effect_r, n_nonzero,
           success(bool: p<0.05 and ci_lo>0)}.
    """
    # TODO
    raise NotImplementedError


def sensitivity(resp_all: pd.DataFrame) -> pd.DataFrame:
    """민감도 (a) min_n=10 (b) 기준선 포함 (c) held==1 vs 그 외 (d) 가드 복귀 기간 제외 (e) leave-one-user-out 부호.
    각 행 = 변형 이름 + compare_paired 결과."""
    # TODO
    raise NotImplementedError


def offline_baselines(part: dict, resp: pd.DataFrame) -> pd.DataFrame:
    """추가 비교군(사전등록 6.5): (b) 씨앗 + 선행 팔 B 응답 파인튜닝, (c) 출하 + 참가자별 Platt 보정.
    시간순으로만(응답 t의 예측에는 t 이전 응답만). 학생 식과 같은 표준화·로지스틱(experiments/loop_sim/sim.py 참조).
    반환: 응답별 p_ft, p_platt 열을 붙인 DataFrame.
    """
    # TODO
    raise NotImplementedError


# ---------- 2차 지표 ----------
def guard_transitions(events: pd.DataFrame, code: str) -> pd.DataFrame:
    """`type=guard` 행 → code, wall_ms, to(ship|student), n, acc_ship, acc_student, since_prev_days,
    oscillation(이전 전환과 반대 방향이고 간격 < GUARD_WINDOW_DAYS)."""
    # TODO
    raise NotImplementedError


def guard_summary(trans_all: pd.DataFrame, codes: list[str]) -> dict:
    """H-F2: 참가자별 전환 수 중앙값, 진동 발생 참가자 비율 + Wilson 95% CI."""
    # TODO
    raise NotImplementedError


def teacher_agreement(resp: pd.DataFrame) -> pd.DataFrame:
    """H-F3: 참가자별 (teacher_a == y_a) 비율, (teacher_v == y_v) 비율, n, 스피어만 ρ(smile_mean vs v).
    평균과 boot_ci_users(단일 Series) CI는 호출 측에서."""
    # TODO
    raise NotImplementedError


def response_rates(events: pd.DataFrame, code: str) -> dict:
    """팔별 응답률 = affect(src=ask_X) / ask(arm=X); fire_miss_B = 1 − ask(arm=B)/ask_sched;
    응답 지연 중앙값(분); ask_delay 수."""
    # TODO
    raise NotImplementedError


def battery_rate(events: pd.DataFrame, code: str) -> dict:
    """`type=imu_stats`(5분)에서 화면 꺼짐·비충전 연속 창의 배터리 수준 변화율(%/h) 중앙값·IQR, 창 수.
    s12_batch.py의 창 선택 규칙 재사용."""
    # TODO
    raise NotImplementedError


def selection_bias(resp: pd.DataFrame, rng: np.random.Generator) -> dict:
    """E1: 팔 A 응답을 팔 B 수만큼 1,000회 부표본(s8_common.subsample_a_to_b) → 출하 AUROC(A) − AUROC(B) 분포,
    |p−0.5| 평균 비교."""
    # TODO
    raise NotImplementedError


def posture_split(resp: pd.DataFrame) -> pd.DataFrame:
    """held==1(들고 있음) vs 그 외에서 primary_auroc 반복. n<MIN_B_RESPONSES 분할은 'n 부족' 표기."""
    # TODO
    raise NotImplementedError


# ---------- 보고 ----------
def write_outputs(out: Path, primary: dict, per_user: pd.DataFrame, secondary: pd.DataFrame,
                  guard: pd.DataFrame, exclusions: pd.DataFrame) -> None:
    """results/field_primary.csv, field_per_user.csv, field_secondary.csv, field_guard.csv, field_exclusions.csv.
    모두 encoding='utf-8'. 참가자 코드 외 식별 정보 없음(DMP 4절)."""
    # TODO
    raise NotImplementedError


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--root", type=Path, default=ROOT / "data" / "raw" / "field")
    ap.add_argument("--out", type=Path, default=ROOT / "results")
    ap.add_argument("--teacher-params", type=Path, default=ROOT / "results" / "models" / "teacher_params.txt")
    ap.add_argument("--min-n", type=int, default=MIN_B_RESPONSES)
    args = ap.parse_args(argv)

    # TODO: 순서
    # 1. codes = list_participants(args.root)
    # 2. 참가자마다 load_participant → responses → join_minute_row → teacher_labels → daily_coverage → apply_exclusions
    # 3. 학생 활성·팔 B만 모아 eligible_users → primary_auroc('a') → compare_paired  (1차)
    # 4. primary_auroc('v'), sensitivity, offline_baselines, posture_split, selection_bias
    # 5. guard_transitions/guard_summary, teacher_agreement, response_rates, battery_rate
    # 6. write_outputs; 콘솔에는 숫자만(Windows cp949 주의, REPO_MAP 함정 12)
    raise NotImplementedError("자료 회수 후 TODO를 채운다. 사전등록 상수는 바꾸지 않는다.")


if __name__ == "__main__":
    sys.exit(main())
