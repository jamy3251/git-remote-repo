"""한국어 키워드 + 페인포인트 시그널 통계 분석 (LLM/외부 API 불필요).

kiwipiepy가 있으면 형태소 분석으로 명사를 추출하고, 없으면 정규식 폴백.
'페인 시그널'(질문/불만/비용/도움요청 패턴)을 탐지해 어떤 키워드가 문제와
함께 등장하는지 상관을 잡아낸다.
"""
from __future__ import annotations

import re
from collections import Counter

from ..models import Post

# ---- 페인포인트 신호 패턴 (카테고리별, 한/영) ----
PAIN_PATTERNS = {
    "질문/정보부족": r"어케|어떻게|어디서|어디로|어디임|어디야|뭐임|뭐냐|뭔가요|방법|알려|모르겠|모름|궁금|질문|문의|해야|할까요|하나요|되나요|가능한가|가능함|how\s+(do|to|can)|where\s+(do|can)|what\s+is|anyone\s+know|\bhelp\b|question|confused|recommend",
    "불만/고장": r"안됨|안돼|안되|않됨|고장|불편|문제|힘들|짜증|최악|별로|에러|오류|막힘|막혔|안나|버벅|느[림리]|터짐|먹통|망했|개같|빡친|화남|싫[다어]|broken|doesn'?t\s+work|not\s+working|error|bug|crash|fail|issue|problem|hate|annoying|stuck|terrible|worst|sucks",
    "비용/금전": r"비싸|비쌈|돈\b|가격|월급|얼마|싸게|호구|손해|부담|비용|수수료|싼곳|expensive|\bcost\b|price|salary|cheap|\bpay\b|\$|afford|budget|money",
    "도움요청": r"도와|도움|부탁|살려|구해|추천\s*좀|봐주|해결|please\s+help|need\s+help|any\s+advice|how\s+do\s+i\s+fix",
}
_PAIN_RE = {k: re.compile(v, re.IGNORECASE) for k, v in PAIN_PATTERNS.items()}

# ---- 불용어 ----
STOPWORDS = set(
    """것 거 게 수 때 점 분 곳 등 더 좀 안 못 잘 또 막 딱 왜 뭐 줄 데 적 중 후 전 간 형 님 형님 ㅋㅋ ㅎㅎ ㅠㅠ ㅜㅜ
    질문 정보 사람 생각 정도 경우 이거 저거 그거 요즘 진짜 그냥 정말 완전 약간 이건 근데 그리고 하지만 그래서 입니다
    이번 저번 다음 오늘 내일 어제 지금 가지 부분 자체 관련 문의 추천 도움 도와 부탁 가능 정리 시작 사용 위해 통해 대한
    있는 없는 하는 되는 같은 보는 라고 으로 에서 에게 한테 부터 까지 처럼 만큼 보다 이라 라는""".split()
)

_KO_RE = re.compile(r"[가-힣]{2,}")
_EN_RE = re.compile(r"[a-zA-Z]{3,}")
EN_STOPWORDS = set(
    """the and for are but not you all any can has had how its our out who get got why was were will with
    this that these those they them their there here what when where which while have your you're don't
    just like very much more most some such only than then over into about after before from your yours
    been being does did doing would could should also even still ever never always going gonna wanna
    one two thing things people guy guys really actually probably maybe kinda sorta lol imo tldr edit""".split()
)
_kiwi = None


def _get_kiwi():
    global _kiwi
    if _kiwi is None:
        try:
            from kiwipiepy import Kiwi
            _kiwi = Kiwi()
        except Exception:
            _kiwi = False
    return _kiwi


def extract_nouns(text: str) -> list[str]:
    """한국어 명사 + 영어 단어를 함께 추출(이중 언어)."""
    out: list[str] = []
    # 한국어 형태소 명사
    kiwi = _get_kiwi()
    if kiwi:
        for tok in kiwi.tokenize(text):
            if tok.tag in ("NNG", "NNP") and len(tok.form) >= 2 and tok.form not in STOPWORDS:
                out.append(tok.form)
    else:
        out += [w for w in _KO_RE.findall(text) if w not in STOPWORDS]
    # 영어 단어
    for w in _EN_RE.findall(text):
        lw = w.lower()
        if lw not in EN_STOPWORDS:
            out.append(lw)
    return out


def _pain_categories(text: str) -> list[str]:
    return [cat for cat, rx in _PAIN_RE.items() if rx.search(text)]


def analyze(posts: list[Post], top_n: int = 30) -> dict:
    noun_counter: Counter[str] = Counter()
    bigram_counter: Counter[str] = Counter()
    pain_cat_counter: Counter[str] = Counter()
    pain_keyword: Counter[str] = Counter()
    pain_posts: list[dict] = []

    for p in posts:
        text = p.text_for_analysis()
        nouns = extract_nouns(text)
        noun_counter.update(nouns)
        for a, b in zip(nouns, nouns[1:]):
            bigram_counter[f"{a} {b}"] += 1
        cats = _pain_categories(text)
        if cats:
            pain_cat_counter.update(cats)
            for n in set(nouns):
                pain_keyword[n] += 1
            pain_posts.append({"title": p.title, "url": p.url, "categories": cats,
                               "comment_count": p.comment_count, "views": p.views})

    n_posts = len(posts)
    n_pain = len(pain_posts)
    # 화제성(댓글많은) 순으로 페인 글 예시 정렬
    pain_posts.sort(key=lambda x: (x["comment_count"], x["views"]), reverse=True)

    return {
        "post_count": n_posts,
        "top_keywords": [{"word": w, "count": c} for w, c in noun_counter.most_common(top_n)],
        "top_bigrams": [{"phrase": w, "count": c} for w, c in bigram_counter.most_common(15) if c > 1],
        "pain": {
            "post_count": n_pain,
            "ratio": round(n_pain / n_posts, 3) if n_posts else 0,
            "by_category": [{"category": k, "count": v} for k, v in pain_cat_counter.most_common()],
            "top_pain_keywords": [{"word": w, "count": c} for w, c in pain_keyword.most_common(20)
                                  if c > 1],
            "examples": pain_posts[:15],
        },
    }
