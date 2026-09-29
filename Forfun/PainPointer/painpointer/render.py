"""9단계 render: Jinja2(autoescape) → 자체 포함 단일 HTML. 인라인 SVG는 파이썬이 좌표를 계산하고 템플릿이 그린다.

- `|safe` 금지. 외부 JS/CSS/이미지 없음. @media print에서 details 펼침.
- 0번 박스 2층: 한 줄 퍼널 + <details> 상세.
"""
from __future__ import annotations

from datetime import date
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape

from . import config
from .models import Report

_env: Environment | None = None


def env() -> Environment:
    global _env
    if _env is None:
        _env = Environment(
            loader=FileSystemLoader(str(config.TEMPLATES_DIR)),
            autoescape=select_autoescape(default=True, default_for_string=True),
            trim_blocks=True, lstrip_blocks=True,
        )
        _env.filters["pct"] = lambda v: "—" if v is None else f"{v * 100:.0f}%"
        _env.filters["num"] = lambda v: "—" if v is None else f"{v:,}"
        _env.filters["short"] = lambda s, n=80: (s or "")[:n]
    return _env


def chart_data(report: Report, *, bar_w: int = 22, gap: int = 8, height: int = 120) -> list[dict]:
    """소스별 월별 막대 차트 좌표. 값 = 관련 글 수, 라벨 = 관련/판정 (전체 수집)."""
    by_src: dict[str, list] = {}
    for row in report.metrics.monthly:
        by_src.setdefault(row.source, []).append(row)
    charts = []
    for src, rows in by_src.items():
        rows = sorted(rows, key=lambda r: r.month)
        vmax = max([r.relevant for r in rows] + [1])
        bars = []
        for i, r in enumerate(rows):
            h = int(round(height * r.relevant / vmax)) if r.relevant else 0
            bars.append({
                "month": r.month, "label": r.month[2:].replace("-", "/"), "relevant": r.relevant,
                "judged": r.judged, "hit": r.hit, "total": r.corpus_total, "missed": r.missed_days,
                "x": i * (bar_w + gap), "y": height - h, "h": h,
                "ratio": (r.relevant / r.judged) if r.judged else None,
            })
        charts.append({"source": src, "bars": bars, "width": len(rows) * (bar_w + gap), "height": height,
                       "bar_w": bar_w, "vmax": vmax})
    return charts


def author_kind_table(report: Report) -> list[dict]:
    from dccrawler.sources import list_sources
    kinds = {s["name"]: s["author_id_kind"] for s in list_sources()}
    srcs = sorted({row.source for row in report.metrics.monthly} | set(report.query.sources))
    desc = {
        "strong": "고정닉 = 닉/UID (동일인 판정 가능, 하한으로 표기)",
        "weak": "유동닉 = IP 앞 2옥텟 (통신사 대역 공유, '명' 단위 미사용)",
        "none": "익명/스토어 닉네임 (동일인 판정 불가)",
    }
    out = []
    for s in srcs:
        k = kinds.get(s, "none")
        if s == "dcinside":
            out.append({"source": s, "kind": "strong/weak 혼재", "desc": desc["strong"] + " / " + desc["weak"]})
        else:
            out.append({"source": s, "kind": k, "desc": desc.get(k, "")})
    return out


def render_report(report: Report, *, template: str = "report.html") -> str:
    t = env().get_template(template)
    return t.render(
        r=report, m=report.metrics, q=report.query, charts=chart_data(report),
        author_table=author_kind_table(report), cfg=config,
        min_relevant=config.MIN_RELEVANT, min_months=config.MIN_MONTHS,
        quote_max=config.QUOTE_MAX_CHARS, max_quotes=config.MAX_QUOTES,
        today=date.today().isoformat(),
    )


def render_page(template: str, **ctx) -> str:
    return env().get_template(template).render(cfg=config, **ctx)


def save_html(html: str, path: str | Path) -> Path:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(html, encoding="utf-8")
    return p
