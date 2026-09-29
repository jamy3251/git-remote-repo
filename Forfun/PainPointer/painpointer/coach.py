"""8단계 coach: 리포트 빈틈을 읽고 인터뷰 질문 5개 생성. 실패 시 강등(빈 목록 + degraded)."""
from __future__ import annotations

import json

from . import config
from .llm import LLM, LLMError, load_prompt
from .models import Cluster, Metrics, Question
from .textnorm import prompt_hash

COACH_SCHEMA = {
    "type": "object",
    "properties": {
        "questions": {
            "type": "array", "minItems": 5, "maxItems": 5,
            "items": {
                "type": "object",
                "properties": {"text": {"type": "string"}, "gap": {"type": "string"}},
                "required": ["text", "gap"], "additionalProperties": False,
            },
        }
    },
    "required": ["questions"],
    "additionalProperties": False,
}


def report_gaps(metrics: Metrics, clusters: list[Cluster], attempts: dict | None) -> dict:
    """LLM에 넘길 리포트 요약(수치 + 자동 감지한 빈틈)."""
    gaps: list[str] = []
    if metrics.insufficient:
        gaps.append(f"근거 부족: 관련 글 {metrics.n_relevant}건(필요 {config.MIN_RELEVANT}), "
                    f"등장 월 {metrics.months_present}(필요 {config.MIN_MONTHS})")
    if metrics.n_relevant and metrics.n_relevant < 100:
        gaps.append(f"분모 작음: 관련 글 {metrics.n_relevant}건")
    if metrics.sampled:
        gaps.append("표본 판정: 고유 작성자·등장 월은 최소값")
    if metrics.unique_authors_strong is None and metrics.distinct_ip_bands_weak is None:
        gaps.append("작성자 식별 불가 소스만 있음: 반복 인원 미확인")
    gaps += ["금액·지불의향 미확인", "현재 대안(어떻게 버티는지) 분포 미확인", "타깃 비중 미확인"]
    return {
        "metrics": {
            "n_relevant": metrics.n_relevant, "n_pain": metrics.n_pain, "pain_rate": metrics.pain_rate,
            "unique_authors_strong": metrics.unique_authors_strong,
            "distinct_ip_bands_weak": metrics.distinct_ip_bands_weak,
            "months_present": metrics.months_present, "months_covered": metrics.months_covered,
            "sampled": metrics.sampled, "insufficient": metrics.insufficient,
        },
        "clusters": [{"name": c.name, "n": c.n_posts} for c in clusters[:6]],
        "attempts_count": (attempts or {}).get("count"),
        "gaps": gaps,
    }


def coach(pain: str, target: str, summary: dict, llm: LLM | None, *, model: str | None = None,
          job_id: str | None = None) -> tuple[list[Question], list[str]]:
    if llm is None:
        return [], ["인터뷰 질문 생성 실패(LLM 미사용)"]
    system = load_prompt("coach")
    ph = prompt_hash(system)
    user = f"페인: {pain}\n타깃: {target}\n\n리포트 요약:\n{json.dumps(summary, ensure_ascii=False, separators=(',', ':'))}"
    try:
        data = llm.call("coach", model or config.MODEL_COACH, system, user, schema=COACH_SCHEMA,
                        prompt_hash=ph, max_tokens=700, retries=2, job_id=job_id, required=("questions",))
        qs = [Question(text=str(q.get("text", "")).strip(), gap=str(q.get("gap", "")).strip())
              for q in (data.get("questions") or [])]
        qs = [q for q in qs if q.text][:5]
        if len(qs) < 5:
            raise LLMError(f"질문 {len(qs)}개(5개 필요)")
        return qs, []
    except LLMError as e:
        return [], [f"인터뷰 질문 생성 실패({e})"[:200]]
