"""레이더 신호 원천 공통 틀(SignalSource) + 등록부 + 실행 기록.

원천 하나 = SignalSource 하위 클래스. fetch(query)는 HTTP 응답을 파싱해 FetchResult(행 목록)만 돌려주고,
저장·실패 기록은 run_source가 한 곳에서 한다.

- 저장: radar.db signal_items(같은 id는 지표만 갱신) · topic_series(같은 칸은 교체) · source_freshness ·
  prestige_venues · topics. 원문은 저장하지 않는다(content_hash + guard 플래그만).
- 실패 기록: painpointer.db collection_runs(source='radar:<이름>', board=질의 라벨)를 상시 수집과 같이 쓴다.
  같은 원천·라벨이 2일 연속 실패하면 웹훅. 키가 없으면 실패가 아니라 source_freshness.status='no_key'(화면 배너 1개).
- 분모 종류(denom_kind): total(전체 대비) / self_accumulated(수집 시작 이후 자체 누적) / none(분모 없음).
- 원천 등급(tier): core(카드 축 계산에 쓰임) / optional(표시만, 막히면 건너뜀).
"""
from __future__ import annotations

import hashlib
import json
import os
import time
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from pathlib import Path

import httpx

from .. import config, db
from ..log import log_event
from . import radar_db

USER_AGENT = "PainPointer-radar/0.1 (+https://github.com/jamy3251; research use)"
DENOM_KINDS = ("total", "self_accumulated", "none")


class SourceUnavailable(RuntimeError):
    """키·스냅샷 파일 등 준비물이 없어 실행하지 않음(실패로 세지 않는다)."""


class SourceError(RuntimeError):
    """원천 응답이 예상과 다름(형식 변경·빈 응답). 실패로 기록한다."""


@dataclass
class SignalItem:
    id: str                      # '<source>:<원천 id>'
    layer: int
    source: str
    kind: str
    title: str = ""
    url: str | None = None
    published_at: str | None = None
    metrics: dict = field(default_factory=dict)
    content_hash: str | None = None
    injection_flag: int = 0


@dataclass
class SeriesPoint:
    topic_id: str
    layer: int
    metric: str
    period: str                  # YYYY-MM 또는 YYYY
    value: float
    denom: float | None
    denom_kind: str

    def __post_init__(self):
        if self.denom_kind not in DENOM_KINDS:
            raise ValueError(f"denom_kind: {self.denom_kind}")
        if self.denom_kind == "total" and not self.denom:
            raise ValueError("denom_kind=total이면 분모가 있어야 한다")


@dataclass
class FetchResult:
    items: list[SignalItem] = field(default_factory=list)
    series: list[SeriesPoint] = field(default_factory=list)
    latest_data_at: str | None = None
    frozen_at: str | None = None
    venues: list[dict] = field(default_factory=list)     # prestige_venues 행
    topics: list[dict] = field(default_factory=list)     # topics 행(분야 배정은 fields.py)
    feed_categories: str | None = None                   # 피드 원천: 저장 뒤 범주×월 시계열을 다시 계산할 접두어
    self_accumulated: str | None = None                  # 매체 원천: 저장 뒤 매체×월 건수 / 자체 누적 건수 시계열 접두어


def content_hash(text: str | None) -> str | None:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:32] if text else None


def month_of(ts: str | None) -> str | None:
    return ts[:7] if ts and len(ts) >= 7 and ts[4] == "-" else None


def shift_month(ym: str, n: int) -> str:
    y, m = int(ym[:4]), int(ym[5:7])
    k = y * 12 + (m - 1) + n
    return f"{k // 12:04d}-{k % 12 + 1:02d}"


def last_full_month(today: date) -> str:
    return shift_month(f"{today.year:04d}-{today.month:02d}", -1)


def month_bounds(ym: str) -> tuple[str, str]:
    """'2026-09' → ('2026-09-01', '2026-09-30')."""
    nxt = shift_month(ym, 1)
    last = date.fromisoformat(nxt + "-01").toordinal() - 1
    return ym + "-01", date.fromordinal(last).isoformat()


def windows_12m(today: date) -> tuple[tuple[str, str], tuple[str, str], str]:
    """(최근 12개월 시작·끝일, 직전 12개월 시작·끝일, 최근 창 끝 달). 이번 달은 덜 찼으므로 지난달까지."""
    end = last_full_month(today)
    cur = (month_bounds(shift_month(end, -11))[0], month_bounds(end)[1])
    prev = (month_bounds(shift_month(end, -23))[0], month_bounds(shift_month(end, -12))[1])
    return cur, prev, end


class SignalSource:
    name: str = "base"
    layer: int = 0
    tier: str = "core"
    key_env: tuple[str, ...] = ()        # 필요한 환경 변수(전부 있어야 실행)
    key_optional: bool = False           # 키가 있으면 쓰고 없어도 실행(요청 간격만 길어짐)
    min_interval: float = 0.0            # 같은 원천 요청 사이 최소 간격(초)
    needs_query: bool = False            # 토픽 질의가 필요한 원천(피드 원천은 False)

    def __init__(self, *, http: httpx.Client | None = None, today: date | None = None, sleep=time.sleep,
                 env: dict | None = None):
        self.http = http or httpx.Client(timeout=60, headers={"User-Agent": USER_AGENT}, follow_redirects=True)
        self.today = today or date.today()
        self.sleep = sleep
        self.env = env if env is not None else os.environ
        self._last = 0.0

    # ---- 준비물 ----
    def keys(self) -> dict[str, str]:
        return {k: self.env.get(k, "") for k in self.key_env}

    def missing_keys(self) -> list[str]:
        return [] if self.key_optional else [k for k, v in self.keys().items() if not v]

    # ---- HTTP ----
    def _wait(self, interval: float) -> None:
        if interval > 0 and self._last:
            gap = time.monotonic() - self._last
            if gap < interval:
                self.sleep(interval - gap)
        self._last = time.monotonic()

    def request(self, method: str, url: str, *, retries: int = 3, interval: float | None = None,
                **kw) -> httpx.Response:
        """429·5xx는 물러섰다 재시도. 그 밖의 4xx는 바로 SourceError."""
        delay = max(self.min_interval if interval is None else interval, 1.0)
        for attempt in range(retries + 1):
            self._wait(self.min_interval if interval is None else interval)
            try:
                r = self.http.request(method, url, **kw)
            except httpx.TransportError as e:
                if attempt == retries:
                    raise SourceError(f"{self.name}: 연결 실패 {type(e).__name__}") from e
                self.sleep(delay * (2 ** attempt))
                continue
            if r.status_code == 429 or r.status_code >= 500:
                if attempt == retries:
                    raise SourceError(f"{self.name}: HTTP {r.status_code} (재시도 {retries}회 후)")
                ra = r.headers.get("retry-after", "")
                self.sleep(float(ra) if ra.isdigit() else delay * (2 ** attempt))
                continue
            if r.status_code >= 400:
                raise SourceError(f"{self.name}: HTTP {r.status_code} {r.text[:200]}")
            return r
        raise SourceError(f"{self.name}: 요청 실패")   # pragma: no cover

    def get_json(self, url: str, **kw):
        r = self.request("GET", url, **kw)
        try:
            return r.json()
        except ValueError as e:
            raise SourceError(f"{self.name}: JSON 아님 ({r.text[:120]!r})") from e

    # ---- 원천별 구현 ----
    def fetch(self, query: dict) -> FetchResult:
        raise NotImplementedError

    @staticmethod
    def label(query: dict) -> str:
        return str(query.get("label") or query.get("topic_id") or "all")


REGISTRY: dict[str, type[SignalSource]] = {}


def register(cls: type[SignalSource]) -> type[SignalSource]:
    REGISTRY[cls.name] = cls
    return cls


def get(name: str, **kw) -> SignalSource:
    _load_all()
    if name not in REGISTRY:
        raise KeyError(f"알 수 없는 레이더 원천: {name}. 사용 가능: {', '.join(sorted(REGISTRY))}")
    return REGISTRY[name](**kw)


def all_sources() -> dict[str, type[SignalSource]]:
    _load_all()
    return dict(REGISTRY)


def _load_all() -> None:
    from . import sources_l1, sources_l2, sources_l3, sources_l4, sources_l5  # noqa: F401  (등록)


# ---- 저장 ----
def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _save(conn, src: SignalSource, res: FetchResult, snapshot: str) -> tuple[int, int]:
    """반환: (새 항목 수, 저장한 시계열 칸 수)."""
    n_new = 0
    with conn:
        if res.items:
            ids = [it.id for it in res.items]
            have: set[str] = set()
            for i in range(0, len(ids), 500):
                chunk = ids[i:i + 500]
                have.update(r[0] for r in conn.execute(
                    "SELECT id FROM signal_items WHERE id IN (%s)" % ",".join("?" * len(chunk)), chunk))
            n_new = len(set(ids) - have)
            conn.executemany(
                "INSERT INTO signal_items(id, layer, source, kind, title, url, published_at, metrics_json, origin,"
                " snapshot_date, content_hash, injection_flag) VALUES (?,?,?,?,?,?,?,?, 'batch', ?,?,?)"
                " ON CONFLICT(id) DO UPDATE SET title=excluded.title, url=excluded.url,"
                " published_at=excluded.published_at, metrics_json=excluded.metrics_json,"
                " snapshot_date=excluded.snapshot_date, content_hash=excluded.content_hash,"
                " injection_flag=MAX(signal_items.injection_flag, excluded.injection_flag)",
                [(it.id, it.layer, it.source, it.kind, it.title or "", it.url, it.published_at,
                  json.dumps(it.metrics, ensure_ascii=False, sort_keys=True), snapshot, it.content_hash,
                  int(it.injection_flag)) for it in res.items])
        series = list(res.series)
        if res.feed_categories:
            series += feed_category_series(conn, src.name, src.layer, res.feed_categories)
        if res.self_accumulated:
            series += self_accumulated_series(conn, src.name, src.layer, res.self_accumulated)
        if series:
            conn.executemany(
                "INSERT OR REPLACE INTO topic_series(topic_id, layer, metric, period, value, denom, denom_kind,"
                " snapshot_date) VALUES (?,?,?,?,?,?,?,?)",
                [(s.topic_id, s.layer, s.metric, s.period, s.value, s.denom, s.denom_kind, snapshot) for s in series])
        for v in res.venues:
            conn.execute("INSERT OR REPLACE INTO prestige_venues(radar_field_id, source_id, tier, basis, snapshot_date)"
                         " VALUES (?,?,?,?,?)", (v["radar_field_id"], v["source_id"], v["tier"], v["basis"], snapshot))
        for t in res.topics:
            conn.execute("INSERT INTO topics(id, name, description, updated_at) VALUES (?,?,?,?)"
                         " ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description,"
                         " updated_at=excluded.updated_at", (t["id"], t["name"], t.get("description", ""), _now()))
    return n_new, len(series)


def feed_category_series(conn, source: str, layer: int, prefix: str) -> list[SeriesPoint]:
    """피드 원천(KEV·NVD·AIID): 저장된 항목 전체에서 범주×월 건수 / 같은 달 피드 전체 건수(total).

    항목 metrics.categories(리스트)를 범주로 쓴다. '<prefix>:*' = 피드 전체(분모 자신).
    매번 저장된 행 전체로 다시 계산하므로 증분 수집·백필 순서와 무관하게 같은 값이 나온다.
    """
    total: dict[str, int] = defaultdict(int)
    by_cat: dict[tuple[str, str], int] = defaultdict(int)
    for pub, metrics in conn.execute("SELECT published_at, metrics_json FROM signal_items WHERE source=?", (source,)):
        ym = month_of(pub)
        if not ym:
            continue
        total[ym] += 1
        for c in set(json.loads(metrics or "{}").get("categories") or []):
            by_cat[(c, ym)] += 1
    out = [SeriesPoint(f"{prefix}:*", layer, "incidents", ym, n, n, "total") for ym, n in total.items()]
    out += [SeriesPoint(f"{prefix}:{c}", layer, "incidents", ym, n, total[ym], "total") for (c, ym), n in by_cat.items()]
    return out


def self_accumulated_series(conn, source: str, layer: int, prefix: str) -> list[SeriesPoint]:
    """분모 없는 매체 원천(잡지 RSS): 매체(metrics.feed)×월 항목 수 / 그 달까지 수집한 그 매체 누적 항목 수.

    수집 시작 전 기사는 피드에 남아 있던 만큼만 보이므로 처음 두 달은 비교에 쓰지 않는다(화면: '자체 누적 2기간 후')."""
    by: dict[tuple[str, str], int] = defaultdict(int)
    for pub, metrics in conn.execute("SELECT published_at, metrics_json FROM signal_items WHERE source=?", (source,)):
        ym, feed = month_of(pub), json.loads(metrics or "{}").get("feed")
        if ym and feed:
            by[(feed, ym)] += 1
    out, cum = [], defaultdict(int)
    for (feed, ym) in sorted(by, key=lambda k: (k[0], k[1])):
        cum[feed] += by[(feed, ym)]
        out.append(SeriesPoint(f"{prefix}:{feed}", layer, "items", ym, by[(feed, ym)], cum[feed], "self_accumulated"))
    return out


def _freshness(conn, src: SignalSource, *, status: str, error: str | None = None,
               latest: str | None = None, frozen: str | None = None) -> None:
    with conn:
        conn.execute(
            "INSERT INTO source_freshness(source, tier, latest_data_at, frozen_at, checked_at, status, error)"
            " VALUES (?,?,?,?,?,?,?) ON CONFLICT(source) DO UPDATE SET tier=excluded.tier,"
            " latest_data_at=COALESCE(excluded.latest_data_at, source_freshness.latest_data_at),"
            " frozen_at=COALESCE(excluded.frozen_at, source_freshness.frozen_at),"
            " checked_at=excluded.checked_at, status=excluded.status, error=excluded.error",
            (src.name, src.tier, latest, frozen, _now(), status, error))


def _record_run(db_path, src: SignalSource, label: str, status: str, *, n_new: int, error: str | None,
                started: str, today: date, webhook) -> None:
    source = f"radar:{src.name}"
    conn = db.open_write(db_path)
    try:
        prev = conn.execute("SELECT status FROM collection_runs WHERE source=? AND board=? AND run_date < ?"
                            " ORDER BY run_date DESC, id DESC LIMIT 1", (source, label, today.isoformat())).fetchone()
        with conn:
            conn.execute("INSERT INTO collection_runs(source, board, run_date, status, error, n_new, started_at,"
                         " finished_at) VALUES (?,?,?,?,?,?,?,?)",
                         (source, label, today.isoformat(), status, error, n_new, started, _now()))
    finally:
        conn.close()
    if status == "failed" and prev and prev["status"] in ("failed", "suspect") and webhook:
        webhook(config.WEBHOOK_URL, f"[PainPointer 레이더] {src.name}/{label} 2일 연속 실패: {error}")


def run_source(src: SignalSource, query: dict | None = None, *, radar_path=None, db_path=None,
               webhook=None, progress=None) -> dict:
    """원천 하나 실행 → 저장·기록. 반환 {source, label, status(ok|failed|no_key), n_items, n_new, n_series, error}."""
    from ..collect_daily import send_webhook
    query = dict(query or {})
    label = src.label(query)
    db_path = Path(db_path or config.DB_PATH)
    webhook = send_webhook if webhook is None else webhook
    radar_db.init_radar_db(radar_path)
    started = _now()
    out = {"source": src.name, "label": label, "status": "ok", "n_items": 0, "n_new": 0, "n_series": 0, "error": None}
    rconn = radar_db.open_write(radar_path)
    try:
        missing = src.missing_keys()
        try:
            if missing:
                raise SourceUnavailable(f"키 없음: {', '.join(missing)}")
            res = src.fetch(query)
        except SourceUnavailable as e:
            _freshness(rconn, src, status="no_key", error=str(e))
            out.update(status="no_key", error=str(e))
            log_event("radar_source", **out)
            return out
        except Exception as e:  # noqa: BLE001 — 원천 하나의 실패가 배치를 멈추지 않게
            err = f"{type(e).__name__}: {e}"[:300]
            _freshness(rconn, src, status="failed", error=err)
            out.update(status="failed", error=err)
            _record_run(db_path, src, label, "failed", n_new=0, error=err, started=started, today=src.today,
                        webhook=webhook)
            log_event("radar_source", **out)
            return out
        snapshot = src.today.isoformat()
        out["n_new"], out["n_series"] = _save(rconn, src, res, snapshot)
        out["n_items"] = len(res.items)
        latest = res.latest_data_at or max((it.published_at for it in res.items if it.published_at), default=None)
        _freshness(rconn, src, status="ok", latest=latest, frozen=res.frozen_at)
    finally:
        rconn.close()
    _record_run(db_path, src, label, "ok", n_new=out["n_new"], error=None, started=started, today=src.today,
                webhook=webhook)
    log_event("radar_source", **out)
    if progress:
        progress(f"[{src.name}/{label}] 항목 {out['n_items']}건(새 {out['n_new']}) · 시계열 {out['n_series']}칸")
    return out
