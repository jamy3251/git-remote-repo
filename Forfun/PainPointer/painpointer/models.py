"""부록 JSON 스키마에 대응하는 데이터 클래스. 모든 파이프라인 단계의 입출력."""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass
class Query:
    pain: str
    target: str
    terms: list[str] = field(default_factory=list)
    generated_terms: list[str] = field(default_factory=list)
    user_edited: bool = False
    mode: str = "contest"                 # "contest" | "pm" (pm은 2단계 예약)
    expansion_status: str = "ok"          # "ok" | "failed(reason)"
    sources: list[str] = field(default_factory=list)   # 조회 소스 집합(빈 목록 = 전체)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "Query":
        return cls(**{k: d.get(k, v) for k, v in _defaults(cls).items()})


@dataclass
class QuoteCandidate:
    text: str
    verified: bool
    context_excerpt: str | None = None


@dataclass
class Judgment:
    post_id: str
    relevant: bool
    intensity: int
    quotes: list[QuoteCandidate] = field(default_factory=list)
    model: str = ""
    prompt_hash: str = ""
    pain_hash: str = ""
    status: str = "ok"                    # "ok" | "failed"
    injection_flag: bool = False
    cached: bool = False
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class MonthlyRow:
    month: str
    source: str
    relevant: int
    hit: int
    judged: int
    corpus_total: int
    missed_days: int = 0


@dataclass
class Metrics:
    snapshot_date: str
    n_hit_total: int
    n_judged: int
    sampled: bool
    n_failed: int
    n_relevant: int
    n_pain: int
    pain_rate: float | None
    unique_authors_strong: int | None
    distinct_ip_bands_weak: int | None
    months_covered: int
    months_present: int
    monthly: list[MonthlyRow]
    merged_duplicates: int
    insufficient: bool
    sample_min_labels: bool
    n_cached: int = 0
    n_new: int = 0
    n_injection: int = 0
    pattern_hits: int = 0
    merged_detail: dict[str, int] = field(default_factory=dict)
    failed_warn: bool = False
    since: str = ""
    window_months: int = 12

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class Cluster:
    id: str
    name: str
    post_ids: list[str]
    n_posts: int
    unique_authors_strong: int | None
    distinct_ip_bands_weak: int | None
    months_present: int
    sources: list[str]
    name_failed: bool = False


@dataclass
class Quote:
    post_id: str
    cluster_id: str
    text: str
    source: str
    board: str
    created_at: str
    author_masked: str | None
    url: str | None
    source_ref: str
    crawled_at: str
    dead_link: bool = False
    context_excerpt: str | None = None
    intensity: int = 2


@dataclass
class Attempt:
    year: int | None
    title: str
    similarity: float
    label: str                            # "high" | "mid"
    result: str | None
    url: str | None


@dataclass
class Question:
    text: str
    gap: str


@dataclass
class LLMCallRef:
    stage: str
    model: str
    prompt_hash: str
    response_model: str | None = None
    warning: str | None = None


@dataclass
class SourceStatus:
    source: str
    board: str
    last_ok: str | None
    days_stale: int | None
    suspect: bool
    author_id_kind: str


@dataclass
class Report:
    id: str
    query: Query
    metrics: Metrics
    clusters: list[Cluster]
    quotes: list[Quote]
    attempts: dict | None
    cases: list | None
    questions: list[Question]
    flags: dict
    llm_calls: list[LLMCallRef]
    degraded: list[str] = field(default_factory=list)
    cluster_params: dict = field(default_factory=dict)
    source_status: list[SourceStatus] = field(default_factory=list)
    candidates: list[dict] = field(default_factory=list)
    candidates_stale_days: int | None = None
    diff: dict | None = None
    created_at: str = ""
    quotes_pool_size: int = 0
    dedup_rules: str = ""
    norm_version: str = ""
    adjacent: dict | None = None      # 근거 부족일 때 같은 소스 페인 지도의 상위 불편

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _defaults(cls) -> dict:
    import dataclasses
    out = {}
    for f in dataclasses.fields(cls):
        if f.default is not dataclasses.MISSING:
            out[f.name] = f.default
        elif f.default_factory is not dataclasses.MISSING:  # type: ignore[misc]
            out[f.name] = f.default_factory()  # type: ignore[misc]
        else:
            out[f.name] = None
    return out
