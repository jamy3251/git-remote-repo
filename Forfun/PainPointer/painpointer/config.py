"""환경 설정. .env → 환경변수 → 기본값 순.

모델 ID는 별칭 금지(설계 제약) — 재현성을 위해 특정 모델을 고정하는 ID만 허용한다.
`-latest` 같은 이동 별칭이면 경고를 기록하고 리포트 0번 박스에 그대로 노출한다.
현재 세대(claude-sonnet-5, claude-haiku-4-5 등)는 날짜 접미사 없는 ID가 정식·완결 ID이고,
구세대 날짜 스냅샷(-YYYYMMDD)도 고정 ID다. `python -m painpointer models`로 /v1/models 목록을 확인한다.
실제 응답 모델은 `llm_calls.response_model`에 기록되어 드리프트를 사후 확인할 수 있다.
"""
from __future__ import annotations

import os
import re
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

TEMPLATES_DIR = ROOT / "templates"
PROMPTS_DIR = ROOT / "prompts"
DATA_DIR = Path(os.getenv("PP_DATA_DIR", ROOT / "data"))
DB_PATH = Path(os.getenv("PP_DB", DATA_DIR / "painpointer.db"))
LOG_DIR = Path(os.getenv("PP_LOG_DIR", DATA_DIR / "logs"))
LOCK_PATH = DATA_DIR / "collect.lock"
HANCRAWLER_DATA = Path(os.getenv("PP_HANCRAWLER_DATA", ROOT.parent.parent / "Data" / "HanCrawler" / "data"))

MODEL_CLASSIFY = os.getenv("PP_MODEL_CLASSIFY", "").strip()
MODEL_COACH = os.getenv("PP_MODEL_COACH", "").strip()
DAILY_LLM_LIMIT = int(os.getenv("PP_DAILY_LLM_LIMIT", "5000"))
LLM_CONCURRENCY = int(os.getenv("PP_LLM_CONCURRENCY", "8"))
# 비용 가드(2026-09-29). 일일 호출 상한과 별개로 달러 예산을 건다. 5000회 상한만으로는 최악 하루 ~$40.
DAILY_BUDGET_USD = float(os.getenv("PP_DAILY_BUDGET_USD", "3"))
LLM_TIMEOUT_S = float(os.getenv("PP_LLM_TIMEOUT_S", "120"))
# 모델별 ($/1M 입력, $/1M 출력). 표에 없는 모델은 호출을 거부한다(비싼 모델 오설정 방지). 캐시 2026-09-25.
PRICES: dict[str, tuple[float, float]] = {
    "claude-haiku-4-5": (1.0, 5.0),
    "claude-sonnet-5": (2.0, 10.0),
    "claude-sonnet-5-5": (2.0, 10.0),
    "claude-sonnet-4-6": (3.0, 15.0),
    "claude-opus-5-5": (4.0, 20.0),
    "claude-opus-5": (5.0, 25.0),
}
CLASSIFY_BATCH = int(os.getenv("PP_CLASSIFY_BATCH", "5"))   # 한 호출에 묶는 글 수(시스템 프롬프트 상각). 1이면 글당 1호출

SHOW_CASES = os.getenv("PP_SHOW_CASES", "0") == "1"
SHOW_ATTEMPTS = os.getenv("PP_SHOW_ATTEMPTS", "1") == "1"

SAMPLE_MAX = 800
MIN_RELEVANT = 30
MIN_MONTHS = 3
WINDOW_MONTHS = 12
FAILED_WARN_RATIO = 0.05
QUOTE_MAX_CHARS = 120
MAX_QUOTES = 20
MAX_QUOTES_PER_AUTHOR = 2
TITLE_SIM_THRESHOLD = 0.9
# 하이브리드 검색: 페인 지도 추출 문장 ↔ 페인 문장 유사도. 0.4 실측(2026-10-05, 손라벨 14건 중 9건 회수·+53건),
# 0.5는 5건. 글 전체 임베딩 채널은 추가 회수 0이라 없음.
SEMANTIC_SEARCH = os.getenv("PP_SEMANTIC", "1") == "1"
SEMANTIC_THRESHOLD = float(os.getenv("PP_SEMANTIC_THRESHOLD", "0.4"))
SEMANTIC_CAP = int(os.getenv("PP_SEMANTIC_CAP", "150"))     # 판정 비용 상한(의미 검색으로 더하는 최대 글 수)

CLUSTER_PARAMS = {
    "distance_threshold": float(os.getenv("PP_CLUSTER_DISTANCE", "0.35")),
    "max_clusters": 12,
    "min_size": 3,
    "linkage": "average",
    "metric": "cosine",
}
# 페인 지도: 불편 문장 임베딩 군집. 처음엔 원래 공간 0.55(2026-10-04)였으나 2위 묶음 섞임 → 평균 벡터를 뺀(center_vectors) 공간의 거리. 실측(2026-10-05, 불편 문장 160): 0.6 깨끗하지만 묶임 62건,
# 0.65 묶음 20개·묶임 81건·섞임 없음, 0.7은 지원금 묶음에 무관한 문장 섞임. complete 연결은 원래 공간에서 섞임 남음.
DISCOVER_CLUSTER = {"distance_threshold": float(os.getenv("PP_DISCOVER_DIST", "0.65")), "metric": "cosine", "linkage": "average"}
DISCOVER_MIN_SIZE = 3          # 이보다 작은 묶음은 지도에 올리지 않는다(나머지 = 기타)
DISCOVER_WEAK = 5              # 이보다 작으면 "약한 신호" 라벨
DISCOVER_DAYS = int(os.getenv("PP_DISCOVER_DAYS", "120"))
# 일일 수집 배치의 불편 추출(의미 검색 풀 유지). 하루 상한: 300건 ≈ $0.15(Haiku 4.5, 실측 632건 $0.33).
# 프롬프트가 바뀌면 창 안 글이 전부 미추출이 되므로 상한이 며칠에 나눠 다시 채운다(최신 글부터).
COLLECT_EXTRACT = os.getenv("PP_COLLECT_EXTRACT", "1") == "1"
COLLECT_EXTRACT_MAX = int(os.getenv("PP_COLLECT_EXTRACT_MAX", "300"))
EMBED_MODEL = os.getenv("PP_EMBED_MODEL", "jhgan/ko-sroberta-multitask")
SIM_THRESHOLD = float(os.getenv("PP_SIM_THRESHOLD", "0.5"))   # 설계 고정값 0.5. 실측(ko-sroberta, 페인 문장 vs 프로젝트 제목)은 0.35~0.45가 의미 있는 상위권 — 첫 코퍼스에서 재확인
SIM_HIGH = float(os.getenv("PP_SIM_HIGH", "0.65"))

WEBHOOK_URL = os.getenv("PP_WEBHOOK_URL", "").strip()
FEEDBACK_MAILTO = os.getenv("PP_FEEDBACK_MAILTO", "").strip()
FEEDBACK_FORM_URL = os.getenv("PP_FEEDBACK_FORM_URL", "").strip()
CONTACT_EMAIL = os.getenv("PP_CONTACT_EMAIL", "").strip()
CANDIDATES_STALE_DAYS = 3
SOURCE_STALE_DAYS = 3
COLLECT_MAX_PAGES = int(os.getenv("PP_COLLECT_MAX_PAGES", "30"))
LOCK_TTL_HOURS = 6

HOST = os.getenv("PP_HOST", "127.0.0.1")
PORT = int(os.getenv("PP_PORT", "8765"))

_ALIAS_RE = re.compile(r"-latest$", re.IGNORECASE)   # 이동 별칭. 날짜 접미사 유무는 판정 기준이 아님(2026-09-22)


class ConfigError(RuntimeError):
    pass


def model_warning(model_id: str) -> str | None:
    """이동 별칭(-latest)이거나 미설정이면 경고 문구, 고정 ID면 None."""
    if not model_id:
        return "모델 ID 미설정"
    if _ALIAS_RE.search(model_id):
        return f"{model_id}: 이동 별칭(-latest) — 재현성을 위해 고정 ID를 쓰세요 (`python -m painpointer models`로 확인)"
    return None


def require_models() -> None:
    missing = [k for k, v in (("PP_MODEL_CLASSIFY", MODEL_CLASSIFY), ("PP_MODEL_COACH", MODEL_COACH)) if not v]
    if missing:
        raise ConfigError(
            "모델 ID가 설정되지 않았습니다: " + ", ".join(missing)
            + " — .env에 고정 모델 ID를 넣으세요 (`python -m painpointer models`로 목록 확인)."
        )
