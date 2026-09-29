import pytest

from dccrawler.textnorm import fts_match, normalize, normalize_ws, term_tokens, text_hash, tokenize

GOLDEN = [
    # (입력, normalize 결과)
    ("배달이 너무 늦어요!!", "배달이너무늦어요"),
    ("  공백   여러개  ", "공백여러개"),
    ("ＡＢＣ１２３", "abc123"),                      # 전각 → 반각(NFKC) + 소문자
    ("한글·중점·기호", "한글중점기호"),
    ("줄\n바꿈\t탭", "줄바꿈탭"),
    ("(괄호) [대괄호] {중괄호}", "괄호대괄호중괄호"),
    ("이모지😭제거", "이모지제거"),
    ("English Mixed 문장 123", "englishmixed문장123"),
    ("", ""),
]


@pytest.mark.parametrize("raw,expected", GOLDEN)
def test_normalize_golden(raw, expected):
    assert normalize(raw) == expected


def test_jamo_kept():
    import unicodedata
    out = normalize("ㅋㅋㅋ ㅠㅠ")
    assert len(out) == 5 and " " not in out  # 자모는 남고(NFKC 호환 자모→표준 자모) 공백만 제거
    assert normalize("ㅋㅋㅋ ㅠㅠ") == normalize("ㅋㅋㅋ  ㅠㅠ!!")


def test_normalize_ws():
    assert normalize_ws("  배달   너무\n늦어요 ") == "배달 너무 늦어요"
    assert normalize_ws("ＡＢ") == "AB"
    assert normalize_ws(None) == ""


def test_text_hash_stable_across_formatting():
    assert text_hash("배달이 너무 늦어요!!") == text_hash("배달이너무 늦어요")
    assert text_hash("a") != text_hash("b")
    assert len(text_hash("x")) == 64


def test_tokenize_drops_particles():
    toks = tokenize("배달이 너무 늦어서 짜증나요")
    assert "배달" in toks
    assert "이" not in toks and "서" not in toks
    assert tokenize("") == [] and tokenize(None) == []


FUZZ = ['"', "'", "*", "(", ")", "OR", "AND NOT", "^", ":", "{}", "-", "배달 OR (", '"배달"', "배달*", "NEAR(a b)"]


@pytest.mark.parametrize("bad", FUZZ)
def test_fts_match_never_leaks_operators(bad):
    m = fts_match([bad])
    if m is None:
        return
    # 모든 토큰은 큰따옴표로 감싸져 있고, 연산자 문자는 따옴표 밖에 없어야 한다
    outside = []
    inside = False
    i = 0
    while i < len(m):
        c = m[i]
        if c == '"':
            if inside and i + 1 < len(m) and m[i + 1] == '"':
                i += 2
                continue
            inside = not inside
        elif not inside:
            outside.append(c)
        i += 1
    tail = "".join(outside)
    assert tail.replace("OR", "").replace("NEAR(", "").replace(", 10)", "").strip(" ") == ""


def test_fts_match_shapes():
    assert fts_match(["배달"]) == '"배달"'
    m = fts_match(["배달 지연"])
    assert m.startswith("NEAR(") and '"배달"' in m and '"지연"' in m
    assert " OR " in fts_match(["배달", "환불"])
    assert fts_match(["!!!"]) is None
    assert term_tokens("...") == []
