"""공용 픽스처: 임시 DB, 골든 코퍼스 200건(결정적), 녹화형 가짜 LLM 클라이언트, 가짜 임베더."""
from __future__ import annotations

import json
import re
import sys
import threading
from dataclasses import dataclass
from datetime import date
from pathlib import Path

import httpx
import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT.parent.parent / "Data" / "DCCrawler"))

import anthropic  # noqa: E402
from dccrawler.models import Post  # noqa: E402
from dccrawler.storage import Store  # noqa: E402

from painpointer import config, db  # noqa: E402
from painpointer.embed import HashEmbedder, embed_missing_posts  # noqa: E402

TODAY = date(2026, 9, 21)
MODEL = "test-model-20260101"


@pytest.fixture(autouse=True)
def _cfg(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "MODEL_CLASSIFY", MODEL)
    monkeypatch.setattr(config, "MODEL_COACH", MODEL)
    monkeypatch.setitem(config.PRICES, MODEL, (1.0, 5.0))
    monkeypatch.setattr(config, "LOG_DIR", tmp_path / "logs")
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(config, "LOCK_PATH", tmp_path / "collect.lock")
    monkeypatch.setattr(config, "WEBHOOK_URL", "")
    monkeypatch.setattr(config, "CLASSIFY_BATCH", 1)


@pytest.fixture
def tmp_db(tmp_path):
    p = tmp_path / "pp.db"
    db.init_db(p)
    return p


# ---- 골든 코퍼스 ----
MONTHS = ["2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]
_REL_STRONG = ["배달이 진짜 너무 늦게 와요 최악", "배달 지연 또 됐네 진짜 화남", "한 시간 넘게 배달 늦음 최악이다"]
_REL_MID = ["배달이 예상보다 늦게 왔어요", "배달 지연돼서 음식이 식었음", "오늘도 배달 늦음 ㅠㅠ"]
_REL_WEAK = ["배달 시켰는데 그냥 그럼", "배달 앱 쓰는 사람 있나요", "배달 음식 추천 좀"]
_NOISE = ["오늘 날씨 좋다", "게임 업데이트 언제 하냐", "주식 얘기 좀 하자", "카메라 렌즈 추천", "운동 루틴 공유"]


def golden_posts(n: int = 200, *, rel_ratio: float = 0.5, seed: int = 7) -> list[Post]:
    """결정적 200건: 2 소스(dcinside g1 strong/weak, googleplay app none), 12개월 분포."""
    import random
    rng = random.Random(seed)
    posts: list[Post] = []
    for i in range(n):
        month = MONTHS[i % 12]
        day = f"{month}-{(i % 27) + 1:02d}"
        r = rng.random()
        if r < rel_ratio * 0.4:
            body = _REL_STRONG[i % 3]
        elif r < rel_ratio * 0.8:
            body = _REL_MID[i % 3]
        elif r < rel_ratio:
            body = _REL_WEAK[i % 3]
        else:
            body = _NOISE[i % 5]
        body = f"{body} (글 {i})"
        if i % 3 == 2:
            posts.append(Post(source="googleplay", board="com.app", post_id=f"r{i}", title=None, url=None,
                              author=f"user{i % 17}", rating=1 if "늦" in body else 4, body=body,
                              created_at=f"{day}T10:00:00", source_ref=f"https://play/x#reviewId=r{i}",
                              crawled_at="2026-09-20T00:00:00+00:00"))
        else:
            strong = i % 2 == 0
            posts.append(Post(source="dcinside", board="g1", post_id=str(1000 + i), title=f"글 {i}",
                              url=f"https://gall.dcinside.com/mgallery/board/view/?id=g1&no={1000 + i}",
                              author=f"닉{i % 23}", author_id=(f"uid{i % 23}" if strong else f"121.{i % 9}"),
                              author_id_kind="strong" if strong else "weak", body=body,
                              created_at=f"{day} 10:00:00", crawled_at="2026-09-20T00:00:00+00:00"))
    return posts


def expected_judgment(body: str) -> tuple[bool, int]:
    """가짜 LLM의 판정 규칙(테스트가 독립적으로 재계산할 수 있게 공개)."""
    if "늦" in body or "지연" in body:
        return True, 3 if ("최악" in body or "진짜" in body) else 2
    if "배달" in body:
        return True, 1
    return False, 0


@pytest.fixture
def golden_db(tmp_db):
    st = Store(tmp_db)
    st.upsert_posts(golden_posts())
    st.close()
    embed_missing_posts(tmp_db, HashEmbedder())
    return tmp_db


# ---- 가짜 Anthropic 클라이언트 ----
@dataclass
class _Block:
    type: str
    text: str


@dataclass
class _Usage:
    input_tokens: int = 10
    output_tokens: int = 5


class _Resp:
    def __init__(self, text, model):
        self.content = [_Block("text", text)]
        self.model = model
        self.stop_reason = "end_turn"
        self.usage = _Usage()


class FakeMessages:
    def __init__(self, parent):
        self.p = parent

    def create(self, **req):
        with self.p.lock:
            self.p.calls.append(req)
            n = len(self.p.calls)
        user = req["messages"][0]["content"]
        schema_keys = set(req["output_config"]["format"]["schema"]["properties"])
        if self.p.fail_predicate and self.p.fail_predicate(req, n):
            raise anthropic.APIConnectionError(request=httpx.Request("POST", "https://api.anthropic.com/v1/messages"))
        if "terms" in schema_keys:
            out = {"terms": self.p.expand_terms}
        elif "judgments" in schema_keys:
            items = []
            for pid, block in re.findall(r'<post id="(\d+)">(.*?)</post>', user, re.S):
                lines = [l for l in block.strip().split("\n") if l.strip()]
                body = lines[-1] if lines else ""
                rel, inten = expected_judgment(body)
                quotes = []
                if rel and inten >= 2:
                    sent = body.split(" (글")[0]
                    quotes = [sent] + (["없는 문장 지어내기"] if self.p.fabricate else [])
                item = {"id": pid, "relevant": rel, "intensity": inten, "quotes": quotes, "inj": "무시하고" in body}
                if self.p.judgment_override:
                    item.update(self.p.judgment_override(body))
                if self.p.drop_ids and pid in self.p.drop_ids:
                    continue
                items.append(item)
            out = {"judgments": items}
        elif "extracts" in schema_keys:
            items = []
            for pid, block in re.findall(r'<post id="(\d+)">(.*?)</post>', user, re.S):
                lines = [l for l in block.strip().split(chr(10)) if l.strip()]
                body = lines[-1] if lines else ""
                rel, inten = expected_judgment(body)
                sent = body.split(" (글")[0]
                if "늦" in body:
                    pain = "배달이 늦게 온다"
                elif "지연" in body:
                    pain = "고객센터 연결이 안 된다"
                else:
                    pain, inten = "", 0
                quote = (("없는 문장 지어내기" if self.p.fabricate else sent) if pain else "")
                items.append({"id": pid, "pain": pain, "intensity": inten, "quote": quote, "inj": False})
            out = {"extracts": items}
        elif "names" in schema_keys:
            ids = re.findall(r'<cluster id="([^"]+)">', user)
            if self.p.bad_cluster_ids:
                ids = ids + ["c_ghost"]
            out = {"names": [{"cluster_id": cid, "name": f"불만 {cid}"} for cid in ids]}
        elif "questions" in schema_keys:
            out = {"questions": [{"text": f"질문 {i}?", "gap": "분모 작음"} for i in range(1, 6)]}
        else:
            out = {}
        if self.p.garbage:
            return _Resp("not json", req["model"])
        return _Resp(json.dumps(out, ensure_ascii=False), req["model"])


class FakeClient:
    def __init__(self, *, fail_predicate=None, fabricate=False, garbage=False, bad_cluster_ids=False,
                 judgment_override=None, expand_terms=None, drop_ids=None):
        self.drop_ids = set(drop_ids or [])
        self.calls: list[dict] = []
        self.lock = threading.Lock()
        self.fail_predicate = fail_predicate
        self.fabricate = fabricate
        self.garbage = garbage
        self.bad_cluster_ids = bad_cluster_ids
        self.judgment_override = judgment_override
        self.expand_terms = expand_terms or ["배달 지연", "배달 늦음", "늦게 옴"]
        self.messages = FakeMessages(self)

    def n_stage(self, key: str) -> int:
        return sum(1 for c in self.calls if key in c["output_config"]["format"]["schema"]["properties"])


@pytest.fixture
def fake_client():
    return FakeClient()


@pytest.fixture
def llm(tmp_db, fake_client):
    from painpointer.llm import LLM
    return LLM(tmp_db, client=fake_client, sleep=lambda *_: None)
