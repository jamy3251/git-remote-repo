"""소스 어댑터 레지스트리."""
from __future__ import annotations

from .base import BaseSource, EmptyResponseError, ParserDriftError
from .dcinside import DcinsideSource
from .fmkorea import FmkoreaSource
from .fourchan import FourchanSource
from .googleplay import GooglePlaySource
from .natepann import NatepannSource
from .reddit import RedditSource
from .todayhumor import TodayhumorSource
from .youtube import YoutubeSource

_REGISTRY: dict[str, type[BaseSource]] = {
    cls.name: cls
    for cls in (
        DcinsideSource, TodayhumorSource, FmkoreaSource, NatepannSource,
        GooglePlaySource, RedditSource, FourchanSource, YoutubeSource,
    )
}

# 자격증명/키 없이도 바로 동작하는 소스(UI 표기에 사용)
WORKING = {"dcinside", "todayhumor", "fmkorea", "natepann", "fourchan", "googleplay"}
# 키/자격증명 필요(있으면 동작)
NEEDS_AUTH = {"reddit", "youtube"}

__all__ = ["BaseSource", "EmptyResponseError", "ParserDriftError", "get_source", "list_sources", "WORKING", "NEEDS_AUTH"]


def get_source(name: str) -> BaseSource:
    name = name.lower().strip()
    if name not in _REGISTRY:
        raise KeyError(f"알 수 없는 소스: {name}. 사용 가능: {', '.join(_REGISTRY)}")
    return _REGISTRY[name]()


def list_sources() -> list[dict]:
    return [
        {"name": n, "working": n in WORKING or n in NEEDS_AUTH,
         "needs_auth": n in NEEDS_AUTH, "needs_board": cls.needs_board,
         "author_id_kind": cls.author_id_kind}
        for n, cls in _REGISTRY.items()
    ]
