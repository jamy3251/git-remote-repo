"""LLM 기반 페인포인트 군집화 + '지금 가장 큰 문제' 추론 (선택 기능).

ANTHROPIC_API_KEY가 있으면 Claude로 글 목록을 분석해 구조화된 인사이트를
만든다. 키/SDK가 없으면 available=False로 폴백한다.
"""
from __future__ import annotations

import json
import os
import re

from ..models import Post

_MODEL = os.getenv("DCCRAWLER_LLM_MODEL", "claude-haiku-4-5-20251001")

PROMPT = """너는 온라인 커뮤니티의 글을 분석해 '현실 수요'와 '페인포인트'를 발굴하는 리서처다.
아래는 '{source}/{board}' 커뮤니티에서 수집한 글 제목(+일부 본문) {n}건이다.

이 데이터를 분석해서 다음을 한국어 JSON으로만 출력해라(설명/마크다운 없이 JSON만):
{{
  "summary": "이 커뮤니티에서 사람들이 주로 무엇을 겪고 있는지 2~3문장 요약",
  "pain_points": [
    {{"title": "페인포인트 짧은 제목", "description": "구체적 설명",
      "evidence": ["근거가 된 글 제목 1~3개"], "severity": 1~5 정수, "frequency": "high|medium|low"}}
  ],
  "biggest_problem": {{"title": "지금 가장 큰 문제", "why": "왜 가장 큰 문제인지",
      "opportunity": "이 문제를 풀면 생기는 기회"}},
  "idea_opportunities": [
    {{"idea": "제품/서비스 아이디어", "rationale": "어떤 페인포인트를 어떻게 해결하는지"}}
  ]
}}
pain_points는 5개 이내, idea_opportunities는 3개 이내. 데이터에 실제로 근거가 있는 것만 써라.

[글 목록]
{titles}
"""


def _extract_json(text: str) -> dict:
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if not m:
        raise ValueError("JSON을 찾지 못함")
    return json.loads(m.group())


def analyze(posts: list[Post], source: str, board: str, max_items: int = 120) -> dict:
    key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    if not key:
        return {"available": False,
                "reason": "ANTHROPIC_API_KEY가 없어 LLM 분석을 건너뜀(키워드 통계만 제공)."}
    try:
        import anthropic
    except ImportError:
        return {"available": False, "reason": "anthropic SDK 미설치."}

    sample = posts[:max_items]
    titles = "\n".join(
        f"- {p.title}" + (f" (댓글 {p.comment_count})" if p.comment_count else "")
        + (f" :: {p.body[:120]}" if p.body else "")
        for p in sample
    )
    prompt = PROMPT.format(source=source, board=board, n=len(sample), titles=titles)

    return _call(prompt)


CROSS_PROMPT = """너는 여러 온라인 커뮤니티의 글을 '교차 비교'해 검증된 현실 수요를 찾는 리서처다.
같은 시기에 서로 다른 커뮤니티에서 수집한 데이터를 비교한다. 여러 커뮤니티에서 공통으로
나타나는 페인은 '교차검증된 수요'로 신뢰도가 높고, 한 곳에만 있는 건 그 커뮤니티 특성이다.

아래는 커뮤니티별 상위 키워드와 대표 글이다.
{blocks}

다음을 한국어 JSON으로만 출력해라(설명/마크다운 없이):
{{
  "shared_pains": [
    {{"pain": "여러 커뮤니티 공통 페인", "sources": ["공통으로 보인 커뮤니티 key들"],
      "evidence": ["근거 글 제목 1~3개"], "why_strong": "교차검증되어 강한 수요인 이유"}}
  ],
  "divergences": [
    {{"source": "커뮤니티 key", "unique_focus": "이 커뮤니티만의 관심사", "note": "해석"}}
  ],
  "strongest_demand": {{"title": "가장 강한(가장 널리 검증된) 수요",
      "cross_validation": "어느 커뮤니티들에서 확인되는지", "opportunity": "해결 시 기회"}},
  "summary": "커뮤니티 간 공통점/차이 2~3문장 요약"
}}
shared_pains는 5개 이내. 실제 근거가 있는 것만 써라."""


def analyze_cross(per_source: list[dict], per_source_titles: int = 12) -> dict:
    key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    if not key:
        return {"available": False,
                "reason": "ANTHROPIC_API_KEY가 없어 LLM 교차 종합을 건너뜀(통계 비교만 제공)."}
    try:
        import anthropic  # noqa: F401
    except ImportError:
        return {"available": False, "reason": "anthropic SDK 미설치."}

    blocks = []
    for ps in per_source:
        k = f"{ps['source']}/{ps['board']}"
        kw = ps["keywords"]
        top = ", ".join(w["word"] for w in kw["top_keywords"][:15])
        ex = "\n".join(f"    - {e['title']} ({'/'.join(e['categories'])})"
                       for e in kw["pain"]["examples"][:per_source_titles])
        blocks.append(f"[{k}] (글 {kw['post_count']}건, 페인 {int(kw['pain']['ratio']*100)}%)\n"
                      f"  상위 키워드: {top}\n  대표 페인 글:\n{ex}")
    prompt = CROSS_PROMPT.format(blocks="\n\n".join(blocks))
    return _call(prompt)


def _call(prompt: str) -> dict:
    import anthropic
    try:
        client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY", "").strip())
        resp = client.messages.create(
            model=_MODEL, max_tokens=2000,
            messages=[{"role": "user", "content": prompt}],
        )
        text = "".join(b.text for b in resp.content if getattr(b, "type", "") == "text")
        result = _extract_json(text)
        result["available"] = True
        result["model"] = _MODEL
        return result
    except Exception as e:  # pragma: no cover
        return {"available": False, "reason": f"LLM 호출 실패: {e}"}
