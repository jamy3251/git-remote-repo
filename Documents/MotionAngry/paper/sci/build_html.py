"""paper/sci/main.md + references.bib + figures/ -> paper/sci/build/main.html (IEEE Access two-column style)
-> paper/sci/main.pdf (headless Chrome) -> paper/sci/build/page-*.png (visual check).

Usage: python paper/sci/build_html.py [--no-pdf] [--dpi 110]
Everything in the PDF comes from main.md; this script only re-typesets (citation numbers, IEEE reference
format, figure/table placement). It prints a numeric audit: numbers that appear in main.md but not in the HTML
text and vice versa, so no value can silently change in typesetting.
"""
import html
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCI = ROOT / "paper" / "sci"
BUILD = SCI / "build"
FIG = ROOT / "figures"
BUILD.mkdir(exist_ok=True)

# ---------------------------------------------------------------- front matter (journal fields not in main.md)
INDEX_TERMS = ("Affective computing, on-device learning, self-training, mobile sensing, experience sampling, "
               "performance guard, privacy, smartphone accelerometer")
AUTHORS = [
    {"name": "JEONGMO KANG", "sup": "1", "orcid": "[ORCID TO FILL]"},
    {"name": "WANTAE KIM", "sup": "1", "orcid": "[ORCID TO FILL]"},
]
AFFIL = {"1": "Department of Information and Communication Engineering, Seoil University, Seoul 02192, Republic of Korea"}
CORRESPONDING = "Corresponding author: Jeongmo Kang (e-mail: [TO FILL])."
FUNDING = "[Funding statement TO FILL, or: This work received no external funding.]"
RUNNING_HEAD = "J. Kang, W. Kim: When Does On-Device Self-Training Help?"

# Figures: number -> (file, caption, span two columns?). Captions are typeset here; main.md keeps the references.
FIGURES = {
    1: ("fig_window_ablation.png",
        "Summary window length and within-user AUROC of the population model (mean over users, participant-bootstrap "
        "95 % CI; leave-one-subject-out on K-EmoPhone). One minute is worse than 30 minutes for arousal and 5 to 10 "
        "minutes are worse for valence; 15, 30 and 60 minutes are indistinguishable. Source: results/benchmark/summary.csv.",
        False),
    2: ("fig_density_noise_map.png",
        "Pre-registered comparison (H2): difference in within-user AUROC between the self-trained student (dense, noisy "
        "teacher) and the seed fine-tuned on previous ESM answers (sparse, accurate) over teacher accuracy p and density "
        "d, for bias b = 0 and b = 0.2 (mean of three seeds). No cell is positive. Source: results/loop_sim/summary.csv.",
        False),
    3: ("fig_conditions.png",
        "Within-user AUROC by condition at p = 0.8, d = 0.5, b = 0 (mean over users; error bars: range over three "
        "seeds; dashed line: oracle student with p = 1, d = 1). Every updated model is below the population model and "
        "the untouched seed. Source: results/loop_sim/summary.csv.",
        True),
    4: ("fig_timecourse.png",
        "Cumulative prequential within-user AUROC by day since each user's first response (p = 0.8, d = 0.5, three "
        "seeds). The updated models fall on day 2, when training starts, and do not recover within the week. Source: "
        "results/loop_sim/preds_*.parquet.",
        True, 60),
    5: ("fig_guard.png",
        "Guard behaviour against the student-minus-base accuracy difference Δ: probability of reverting to the "
        "population model within 14 days, median days to revert, and switches per 28 days (base accuracy 0.60, three "
        "random probes per day, 10,000 runs). Source: results/guard_sim/guard_sim.csv.",
        True),
    6: ("fig_selection_bias.png",
        "Selection bias of model-triggered prompts (arm A): pooled and within-user AUROC of the population model on "
        "responses flagged by the arm-A rule against all responses, for four trigger thresholds (value in "
        "parentheses); n, fraction flagged and number of users with at least ten flagged responses are printed. "
        "Source: results/loop_sim/rq4_selection.csv.",
        True),
}
FIGURES_KO = {   # same files and layout; Korean captions (paper/sci/main_ko.md)
    1: ("fig_window_ablation.png",
        "요약 창 길이와 모집단 모델의 사용자 안 AUROC(사용자 평균, 참가자 부트스트랩 95 % CI; K-EmoPhone에서 피험자 하나 제외). "
        "각성에서 1분은 30분보다 나쁘고 정서가에서 5~10분이 나쁘며, 15·30·60분은 구분되지 않는다. 출처: results/benchmark/summary.csv.",
        True, 46),   # two-column placement: a one-column figure here leaves the left column of page 5 half empty
    2: ("fig_density_noise_map.png",
        "사전등록 비교(H2): 교사 정확도 p와 밀도 d에 대한, 자기 학습 학생(조밀한 잡음 교사)과 이전 ESM 답에 미세 조정한 시드(희소, 정확)의 "
        "사용자 안 AUROC 차이. 편향 b = 0과 b = 0.2(시드 셋 평균). 양인 셀은 없다. 출처: results/loop_sim/summary.csv.",
        False),
    3: ("fig_conditions.png",
        "p = 0.8, d = 0.5, b = 0에서 조건별 사용자 안 AUROC(사용자 평균; 오차 막대: 시드 셋의 범위; 점선: p = 1, d = 1의 오라클 학생). "
        "갱신된 모든 모델이 모집단 모델과 손대지 않은 시드 아래다. 출처: results/loop_sim/summary.csv.",
        True),
    4: ("fig_timecourse.png",
        "각 사용자의 첫 응답 이후 날짜별 누적 prequential 사용자 안 AUROC(p = 0.8, d = 0.5, 시드 셋). 갱신 모델은 학습이 시작되는 "
        "2일째에 떨어지고 그 주 안에 회복되지 않는다. 출처: results/loop_sim/preds_*.parquet.",
        True, 60),
    5: ("fig_guard.png",
        "학생−기본 정확도 차이 Δ에 대한 가드의 행동: 14일 안에 모집단 모델로 되돌릴 확률, 되돌리기까지의 중앙값 일수, 28일당 전환 횟수"
        "(기본 정확도 0.60, 하루 세 번 무작위 프로브, 10,000회). 출처: results/guard_sim/guard_sim.csv.",
        True),
    6: ("fig_selection_bias.png",
        "모델 촉발 질문(A군)의 선택 편향: 네 촉발 임계(괄호 안 값)에 대해, A군 규칙이 표시한 응답과 전체 응답에서 모집단 모델의 전체·사용자 안 "
        "AUROC. n, 표시 비율, 표시 응답 열 개 이상인 사용자 수를 적었다. 출처: results/loop_sim/rq4_selection.csv.",
        True),
}
WIDE_TABLES = {2, 3, 4}  # tables that span both columns (Table 1, implementation, stays in one column)
ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"]

# Language-dependent strings. The layout (IEEE Access two-column) is identical; only words, fonts and file names differ.
LANGS = {
    "en": dict(md="main.md", html="main.html", pdf="main.pdf", html_lang="en", figures=FIGURES,
               fig_word="Figure", tab_word="Table", fig_label="FIGURE", tab_label="TABLE",
               abstract_h="Abstract", refs_h="References", abstract_lbl="ABSTRACT", terms_lbl="INDEX TERMS",
               refs_lbl="REFERENCES", bio_lbl="AUTHOR BIOGRAPHIES", author_join=" AND ",
               index_terms=INDEX_TERMS, authors=AUTHORS, affil=AFFIL, corresponding=CORRESPONDING, funding=FUNDING,
               running_head=RUNNING_HEAD, head_font=None, defer={},
               firstbar="Received [TO FILL]; accepted [TO FILL]; date of publication [TO FILL]; date of current version [TO FILL].",
               serif='"Times New Roman", Times, serif', sans="Arial, Helvetica, sans-serif",
               bios=[("JEONGMO KANG", "is an undergraduate student in the Department of Information and Communication Engineering, "
                      "Seoil University, Seoul, Republic of Korea.", "[Biography TO FILL: degree year, research interests.]"),
                     ("WANTAE KIM", "is with the Department of Information and Communication Engineering, Seoil University, Seoul, "
                      "Republic of Korea.", "[Biography TO FILL: position, degrees, research interests.]")]),
    "ko": dict(md="main_ko.md", html="main_ko.html", pdf="main_ko.pdf", html_lang="ko", figures=FIGURES_KO,
               fig_word="그림", tab_word="표", fig_label="그림", tab_label="표",
               abstract_h="초록", refs_h="참고문헌", abstract_lbl="초록", terms_lbl="색인어",
               refs_lbl="참고문헌", bio_lbl="저자 소개", author_join=", ",
               index_terms="감성 컴퓨팅, 온디바이스 학습, 자기 학습, 모바일 센싱, 경험 표집, 성능 가드, 프라이버시, 스마트폰 가속도계",
               authors=[{"name": "강정모", "sup": "1", "orcid": "[ORCID TO FILL]"}, {"name": "김완태", "sup": "1", "orcid": "[ORCID TO FILL]"}],
               affil={"1": "서일대학교 정보통신공학과, 서울 02192"},
               corresponding="교신저자: 강정모 (e-mail: [TO FILL]).",
               funding="[연구비 지원 문구 TO FILL. 없으면: 이 연구는 외부 연구비 지원을 받지 않았다.]",
               running_head="강정모, 김완태: 온디바이스 자기 학습은 언제 도움이 되는가?",
               head_font=r"C:\Windows\Fonts\malgun.ttf",
               defer={},
               firstbar="접수 [TO FILL]; 게재 확정 [TO FILL]; 발행 [TO FILL]; 현재 판 [TO FILL].",
               serif='"Times New Roman", "Batang", "바탕", serif', sans='Arial, "Malgun Gothic", "맑은 고딕", sans-serif',
               bios=[("강정모", "서일대학교 정보통신공학과 학부생이다.", "[약력 TO FILL: 학위 연도, 연구 관심사.]"),
                     ("김완태", "서일대학교 정보통신공학과에 재직 중이다.", "[약력 TO FILL: 직위, 학위, 연구 관심사.]")]),
}
L = LANGS["en"]


def configure(lang):
    global L
    L = LANGS[lang]


def section_refs(s):
    """'Section 6.2' -> 'Section VI-B', 'Section 7' -> 'Section VII'; Korean '6.2절' -> 'VI-B절', '7절' -> 'VII절'."""
    s = re.sub(r"Section (\d)\.(\d)", lambda m: f"Section {ROMAN[int(m.group(1)) - 1]}-{chr(64 + int(m.group(2)))}", s)
    s = re.sub(r"Section (\d)(?!\.\d)", lambda m: f"Section {ROMAN[int(m.group(1)) - 1]}", s)
    s = re.sub(r"(?<![\d.])(\d)\.(\d)절", lambda m: f"{ROMAN[int(m.group(1)) - 1]}-{chr(64 + int(m.group(2)))}절", s)
    s = re.sub(r"(?<![\d.])(\d)절", lambda m: f"{ROMAN[int(m.group(1)) - 1]}절", s)
    return s


# ---------------------------------------------------------------- bib
def parse_bib(text):
    entries = {}
    for m in re.finditer(r"@(\w+)\{(\w+),", text):
        kind, key = m.group(1).lower(), m.group(2)
        i = m.end()
        depth = 1
        j = i
        while depth and j < len(text):
            if text[j] == "{":
                depth += 1
            elif text[j] == "}":
                depth -= 1
            j += 1
        body = text[i:j - 1]
        fields = {}
        for fm in re.finditer(r"(\w+)\s*=\s*", body):
            name = fm.group(1).lower()
            k = fm.end()
            if body[k] == "{":
                d, q = 1, k + 1
                while d:
                    if body[q] == "{":
                        d += 1
                    elif body[q] == "}":
                        d -= 1
                    q += 1
                val = body[k + 1:q - 1]
            elif body[k] == '"':
                q = body.index('"', k + 1)
                val = body[k + 1:q]
            else:
                q = re.search(r"[,\n]", body[k:])
                val = body[k:k + q.start()] if q else body[k:]
            fields[name] = val.strip()
        fields["_kind"] = kind
        entries[key] = fields
    return entries


ACCENTS = {r'{\"o}': "ö", r'{\"u}': "ü", r"{\'e}": "é", r"{\^i}": "î", r"{\'a}": "á", r'{\"a}': "ä", r"{\~n}": "ñ",
           r'\"o': "ö", r'\"u': "ü", r"\'e": "é", r"\^i": "î"}


def delatex(s):
    for k, v in ACCENTS.items():
        s = s.replace(k, v)
    s = s.replace("--", "–").replace("~", " ")
    s = re.sub(r"[{}]", "", s)
    return s


def fmt_author(a):
    a = a.strip()
    if a.startswith("{") and a.endswith("}"):
        return delatex(a)
    if "," in a:
        last, first = [x.strip() for x in a.split(",", 1)]
    else:
        parts = a.split()
        last, first = parts[-1], " ".join(parts[:-1])
    first = delatex(first)
    initials = " ".join(p[0] + "." for p in re.split(r"[\s-]+", first) if p)
    return f"{initials} {delatex(last)}".strip()


def fmt_authors(field):
    names = [fmt_author(x) for x in re.split(r"\s+and\s+", field)]
    if len(names) > 6:
        return names[0] + " et al."
    if len(names) == 1:
        return names[0]
    if len(names) == 2:
        return " and ".join(names)
    return ", ".join(names[:-1]) + ", and " + names[-1]


def fmt_pages(p):
    p = delatex(p)
    return ("pp. " + p) if "–" in p else ("Art. no. " + p)


def fmt_ref(e):
    au = fmt_authors(e["author"])
    ti = delatex(e["title"])
    yr = e.get("year", "")
    doi = e.get("doi")
    url = e.get("url")
    k = e["_kind"]
    if k == "article":
        parts = [f"<i>{delatex(e['journal'])}</i>"]
        if "volume" in e:
            parts.append("vol. " + e["volume"])
        if "number" in e:
            parts.append("no. " + delatex(e["number"]))
        if "pages" in e:
            parts.append(fmt_pages(e["pages"]))
        parts.append(yr)
        s = f"{au}, “{ti},” " + ", ".join(parts)
    elif k == "inproceedings":
        parts = [f"in <i>{delatex(e['booktitle'])}</i>", yr]
        if "pages" in e:
            parts.append(fmt_pages(e["pages"]))
        s = f"{au}, “{ti},” " + ", ".join(parts)
    else:  # misc
        if e.get("archiveprefix", "").lower() == "arxiv":
            s = f"{au}, “{ti},” {yr}, <i>arXiv:{e['eprint']}</i>"
        else:
            s = f"{au}, “{ti},” {delatex(e.get('howpublished', ''))}, {yr}"
    if doi:
        s += f", doi: {doi}."
    elif url:
        s += f". [Online]. Available: {url}"
    else:
        s += "."
    return s


# ---------------------------------------------------------------- inline markdown + math
GREEK = {"lambda": "λ", "Delta": "Δ", "theta": "θ", "sigma": "σ", "nabla": "∇", "alpha": "α", "beta": "β", "eta": "η",
         "mu": "μ", "pi": "π"}


def math_to_html(m):
    s = m
    s = s.replace(r"\mathbb{R}", "ℝ").replace(r"\Pr", "Pr").replace(r"\in", "∈").replace(r"\le", "≤").replace(r"\ge", "≥")
    s = s.replace(r"\times", "×").replace(r"\{", "{").replace(r"\}", "}").replace(r"\mathbf{1}", "<b>1</b>")
    s = s.replace(r"^\top", "<sup>⊤</sup>").replace(r"\tilde y", "ỹ")
    s = re.sub(r"\\sqrt\{([^}]*)\}", r"√<span style='text-decoration:overline'>\1</span>", s)
    for k, v in GREEK.items():
        s = re.sub(r"\\" + k + r"(?![a-zA-Z])", v, s)
    s = re.sub(r"\^\{([^}]*)\}", r"<sup>\1</sup>", s)
    s = re.sub(r"\^(\S)", r"<sup>\1</sup>", s)
    s = re.sub(r"_\{([^}]*)\}", r"<sub>\1</sub>", s)
    s = re.sub(r"_(\S)", r"<sub>\1</sub>", s)
    # italicise single latin letters that are variables (not inside tags, not 'Pr')
    out, i = [], 0
    for tok in re.split(r"(<[^>]+>|Pr)", s):
        if tok.startswith("<") or tok == "Pr":
            out.append(tok)
        else:
            out.append(re.sub(r"(?<![A-Za-z])([A-Za-z])(?![A-Za-z])", r"<i>\1</i>", tok))
    s = "".join(out)
    s = s.replace(" = ", " = ").replace("-", "−")
    return f"<span class='m'>{s}</span>"


def inline(s, cites):
    """markdown inline -> html. cites: ordered dict key->number (filled on first use)."""
    # protect code and math first
    holders = []

    def hold(h):
        holders.append(h)
        return f"\x00{len(holders) - 1}\x00"

    s = re.sub(r"`([^`]+)`", lambda m: hold("<code>" + html.escape(m.group(1)).replace("/", "/<wbr>").replace("_", "_<wbr>") + "</code>"), s)
    s = re.sub(r"\$([^$]+)\$", lambda m: hold(math_to_html(html.escape(m.group(1), quote=False))), s)
    s = html.escape(section_refs(s), quote=False)
    s = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", s)
    s = re.sub(r"(?<![*\w])\*([^*]+?)\*(?![*\w])", r"<i>\1</i>", s)

    def cite(m):
        key = m.group(1)
        if key not in cites:
            cites[key] = len(cites) + 1
        return f"[{cites[key]}]"

    s = re.sub(r"\[([A-Za-z]+\d{4})\]", cite, s)
    s = re.sub(r"\x00(\d+)\x00", lambda m: holders[int(m.group(1))], s)
    return s


def strip_fig_paths(s):
    """'(`figures/x.pdf`)' and ', `figures/x.pdf`' -> removed (figure numbers remain)."""
    s = re.sub(r",?\s*`figures/[^`]+`", "", s)
    s = re.sub(r"\s*\(\)", "", s)
    return s


# ---------------------------------------------------------------- block parsing
def roman(n):
    return ROMAN[n - 1]


def build():
    FIGURES = L["figures"]
    FW, TW = L["fig_word"], L["tab_word"]
    md = (SCI / L["md"]).read_text(encoding="utf-8")
    bib = parse_bib((SCI / "references.bib").read_text(encoding="utf-8"))
    meta, body = md.split("\n---\n", 1)
    title = re.search(r'title:\s*"(.*)"', meta).group(1)
    body = re.sub(r"<!--.*?-->", "", body, flags=re.S)
    lines = body.split("\n")

    cites = {}
    out = []          # html chunks
    abstract = None
    section_no = 0
    sub_no = 0
    figs_done = set()
    i = 0
    in_abstract = False
    in_refs = False
    tables_seen = 0

    pending = {}      # figure number -> paragraphs still to wait (L["defer"])

    def emit_fig(n):
        f, cap, wide, *w = FIGURES[n]
        style = f" style='width:{w[0]}%'" if w else ""
        out.append(f"<figure class='{'wide' if wide else ''}'><img src='{f}' alt='Figure {n}'{style}>"
                   f"<figcaption><b>{L['fig_label']} {n}.</b> {html.escape(cap)}</figcaption></figure>")

    def flush_fig(text):
        """emit figure elements for first mentions of 'Figure n' in this paragraph (or defer by L['defer'][n] paragraphs)."""
        for n in list(pending):
            pending[n] -= 1
            if pending[n] <= 0:
                del pending[n]
                emit_fig(n)
        for n in sorted({int(x) for x in re.findall(FW + r" (\d)", text)}):
            if n in FIGURES and n not in figs_done:
                figs_done.add(n)
                if L["defer"].get(n):
                    pending[n] = L["defer"][n]
                else:
                    emit_fig(n)

    while i < len(lines):
        ln = lines[i]
        if ln.startswith("# "):
            h = ln[2:].strip()
            if h == L["abstract_h"]:
                in_abstract = True
                i += 1
                continue
            if h == L["refs_h"]:
                in_refs = True
                i += 1
                continue
            in_abstract = False
            section_no += 1
            sub_no = 0
            name = re.sub(r"^\d+\s+", "", h)
            out.append(f"<h2>{roman(section_no)}. {html.escape(name.upper())}</h2>")
            i += 1
            continue
        if ln.startswith("## "):
            sub_no += 1
            name = re.sub(r"^\d+\.\d+\s+", "", ln[3:].strip())
            out.append(f"<h3>{chr(64 + sub_no)}. {html.escape(name.upper())}</h3>")
            i += 1
            continue
        if ln.startswith("|"):
            rows = []
            while i < len(lines) and lines[i].startswith("|"):
                rows.append([c.strip() for c in lines[i].strip().strip("|").split("|")])
                i += 1
            rows = [r for r in rows if not all(re.fullmatch(r":?-+:?", c) for c in r)]
            # caption paragraph follows (Table n. ...)
            cap = ""
            j = i
            while j < len(lines) and not lines[j].strip():
                j += 1
            if j < len(lines) and lines[j].startswith(TW + " "):
                cap = lines[j].strip()
                i = j + 1
            tables_seen += 1
            m = re.match(TW + r" (\d+)\.\s*(.*)", cap)
            tno = int(m.group(1)) if m else tables_seen
            captext = m.group(2) if m else ""
            # a trailing 'Figure 5. ...' sentence inside a table caption belongs to the figure (typeset there)
            captext = re.sub(r"\s*" + FW + r" \d\..*$", "", captext)
            wide = tno in WIDE_TABLES
            kind = "num" if len(rows[0]) > 2 else "text"
            th = "".join(f"<th>{inline(c, cites)}</th>" for c in rows[0])
            trs = "".join("<tr>" + "".join(f"<td>{inline(c, cites)}</td>" for c in r) + "</tr>" for r in rows[1:])
            out.append(f"<div class='tbl {'wide' if wide else ''} {kind}'><div class='tcap'><b>{L['tab_label']} {tno}.</b> "
                       f"{inline(captext, cites)}</div><table><thead><tr>{th}</tr></thead><tbody>{trs}</tbody></table></div>")
            continue
        if ln.startswith("- "):
            items = []
            while i < len(lines) and lines[i].startswith("- "):
                items.append(lines[i][2:].strip())
                i += 1
            out.append("<ul>" + "".join(f"<li>{inline(x, cites)}</li>" for x in items) + "</ul>")
            continue
        if not ln.strip():
            i += 1
            continue
        # paragraph (possibly multi-line)
        para = [ln]
        i += 1
        while i < len(lines) and lines[i].strip() and not re.match(r"^(#|\||- )", lines[i]):
            para.append(lines[i])
            i += 1
        text = " ".join(para).strip()
        if re.match("^" + FW + r" \d\.", text):   # stand-alone figure caption paragraphs: captions are in FIGURES
            flush_fig(text)
            continue
        if in_abstract:
            abstract = inline(text, cites)
            continue
        if in_refs:
            continue
        text = strip_fig_paths(text)
        out.append(f"<p>{inline(text, cites)}</p>")
        flush_fig(text)

    for n in list(pending):   # deferred past the last paragraph
        emit_fig(n)
    missing = set(FIGURES) - figs_done
    assert not missing, f"figures never mentioned: {missing}"
    refs = "".join(f"<li value='{n}'>{fmt_ref(bib[k])}</li>" for k, n in cites.items())
    unused = set(bib) - set(cites)

    spans = [f"<span class='au'>{a['name']}<sup>{a['sup']}</sup></span>" for a in L["authors"]]
    aj = L["author_join"]
    authors_html = (aj.join(spans) if len(spans) == 2 else ", ".join(spans[:-1]) + "," + aj + spans[-1])
    affil_html = "".join(f"<div class='aff'><sup>{k}</sup>{html.escape(v)}</div>" for k, v in L["affil"].items())
    bios_html = "".join(f"<p class='bio'><b>{html.escape(n)}</b> {html.escape(t)} <span class='todo'>{html.escape(todo)}</span></p>"
                        for n, t, todo in L["bios"])
    SERIF, SANS = L["serif"], L["sans"]

    page = f"""<!doctype html>
<html lang="{L['html_lang']}"><head><meta charset="utf-8"><title>{html.escape(title)}</title>
<style>
@page {{ size: 8.5in 11in; margin: 0.9in 0.62in 0.8in 0.62in; }}
html, body {{ margin: 0; padding: 0; }}
body {{ font-family: {SERIF}; font-size: 9.5pt; line-height: 1.22; color: #000; }}
.firstbar {{ font: 7pt {SANS}; color: #333; margin: 0 0 10px 0; line-height: 1.35; }}
.firstbar .doi {{ margin-top: 3px; }}
h1 {{ font: bold 19pt {SANS}; line-height: 1.15; margin: 4px 0 8px 0; color: #000; }}
.authors {{ font: bold 9.5pt {SANS}; margin: 0 0 4px 0; }}
.aff {{ font: 7.5pt {SANS}; margin: 1px 0; }}
.corr, .fund {{ font: 7.5pt {SANS}; margin: 5px 0 0 0; }}
.abstract {{ margin: 12px 0 6px 0; font-family: {SANS}; font-size: 8.8pt; line-height: 1.3; text-align: justify; }}
.abstract b.lbl, .terms b.lbl {{ font-family: {SANS}; font-weight: bold; }}
.terms {{ font-family: {SANS}; font-size: 8.8pt; margin: 4px 0 10px 0; }}
.rule {{ border-top: 1.5px solid #1b4f9c; margin: 8px 0 12px 0; }}
.cols {{ column-count: 2; column-gap: 0.2in; column-fill: auto; text-align: justify; hyphens: auto; }}
h2 {{ font: bold 9.5pt {SANS}; margin: 11px 0 4px 0; break-after: avoid; letter-spacing: 0.2px; }}
h3 {{ font: bold 9pt {SANS}; margin: 8px 0 3px 0; break-after: avoid; }}
p {{ margin: 0 0 5px 0; text-indent: 0; orphans: 2; widows: 2; }}
p + p {{ text-indent: 1.2em; }}
ul {{ margin: 2px 0 6px 0; padding-left: 1.2em; }}
li {{ margin-bottom: 3px; }}
code {{ font-family: "Courier New", monospace; font-size: 7.8pt; overflow-wrap: anywhere; }}
.m {{ font-family: {SERIF}; }}
figure {{ margin: 8px 0 10px 0; break-inside: avoid; }}
figure img {{ width: 100%; display: block; }}
figure.wide, .tbl.wide {{ column-span: all; }}
figure.wide {{ margin: 10px 0 12px 0; }}
figure.wide img {{ width: 78%; margin: 0 auto; }}
figure.wide.full img {{ width: 100%; }}
figcaption, .tcap {{ font: 7.5pt {SANS}; line-height: 1.3; text-align: left; margin-top: 5px; }}
.tbl {{ margin: 8px 0 10px 0; break-inside: avoid; }}
.tbl .tcap {{ margin: 0 0 4px 0; }}
table {{ border-collapse: collapse; width: 100%; font: 7.5pt {SANS}; line-height: 1.25; }}
th, td {{ padding: 2px 5px; text-align: left; vertical-align: top; }}
th {{ border-top: 1.2px solid #000; border-bottom: 0.8px solid #000; font-weight: bold; }}
tbody tr:last-child td {{ border-bottom: 1.2px solid #000; }}
.tbl.num td:not(:first-child), .tbl.num th:not(:first-child) {{ text-align: center; white-space: nowrap; }}
.tbl.wide table {{ width: 100%; }}
.tbl.wide td:first-child {{ white-space: nowrap; }}
.tbl.text td:first-child {{ white-space: nowrap; font-weight: bold; }}
.tbl.text td {{ overflow-wrap: anywhere; }}
ol.refs {{ font-size: 8pt; padding-left: 1.8em; margin: 0; line-height: 1.25; text-align: justify; overflow-wrap: anywhere; }}
ol.refs li {{ margin-bottom: 3px; padding-left: 0.2em; }}
.bio {{ font-size: 8.5pt; text-align: justify; margin: 6px 0; }}
.bio b {{ font-family: {SANS}; }}
.todo {{ color: #b00020; }}
</style></head><body>
<div class="firstbar">{html.escape(L['firstbar'])}
<div class="doi">Digital Object Identifier 10.1109/ACCESS.2026.[TO FILL]</div></div>
<h1>{html.escape(title)}</h1>
<div class="authors">{authors_html}</div>
{affil_html}
<div class="corr">{html.escape(L['corresponding'])}</div>
<div class="fund">{html.escape(L['funding'])}</div>
<div class="abstract"><b class="lbl">{L['abstract_lbl']}</b> {abstract}</div>
<div class="terms"><b class="lbl">{L['terms_lbl']}</b> {html.escape(L['index_terms'])}.</div>
<div class="rule"></div>
<div class="cols">
{''.join(out)}
<h2>{L['refs_lbl']}</h2>
<ol class="refs">{refs}</ol>
<h2>{L['bio_lbl']}</h2>
{bios_html}
</div>
</body></html>
"""
    (BUILD / L["html"]).write_text(page, encoding="utf-8")
    import fitz
    for f, *_ in FIGURES.values():   # figures/*.pdf -> build/*.png at 300 dpi (re-rendered when the pdf is newer)
        src = FIG / (f[:-4] + ".pdf")
        if not (BUILD / f).exists() or src.stat().st_mtime > (BUILD / f).stat().st_mtime:
            fitz.open(src)[0].get_pixmap(dpi=300, alpha=False).save(str(BUILD / f))
    print(f"html written: {len(cites)} references cited in order; unused bib keys: {sorted(unused)}")

    # numeric audit: every number token in the md body must survive into the html text
    md_text = body_numbers_text(body, FW)
    html_text = re.sub(r"<[^>]+>", " ", page.split("<div class=\"cols\">")[1].split(f"<h2>{L['refs_lbl']}</h2>")[0])
    html_text = html.unescape(html_text)
    from collections import Counter
    a, b = Counter(nums(md_text)), Counter(nums(html_text))
    lost = {k: v for k, v in (a - b).items()}
    print("numeric audit — in md body but not in html:", lost or "none")
    return page


def nums(t):
    return re.findall(r"(?<![A-Za-z0-9_.])[−+-]?\d+(?:[.,]\d+)*(?:\s?%)?", t)


def body_numbers_text(body, fig_word):
    """Body text of a manuscript with the tokens that are renumbered on purpose removed (headings, section refs, captions)."""
    t = re.split(r"^# 1 .*$", body, maxsplit=1, flags=re.M)[1]
    t = re.split(r"^# (References|참고문헌)\s*$", t, flags=re.M)[0]
    t = re.sub(r"<!--.*?-->", "", t, flags=re.S)
    t = re.sub(r"`figures/[^`]+`", "", t)
    t = re.sub("^" + fig_word + r" \d\..*$", "", t, flags=re.M)
    t = re.sub(r"Section \d(\.\d)?|\d(\.\d)?절|^#+ .*$", "", t, flags=re.M)   # renumbered on purpose (roman / letters)
    t = t.replace("$-", "$−").replace("= -", "= −").replace("^{-", "^{−")   # math minus is typeset as U+2212
    return t


def cross_language_audit():
    """Numbers in main.md vs main_ko.md (body only). Expected differences are listed so a translation cannot drop a value."""
    from collections import Counter
    en = (SCI / "main.md").read_text(encoding="utf-8").split("\n---\n", 1)[1]
    ko = (SCI / "main_ko.md").read_text(encoding="utf-8").split("\n---\n", 1)[1]
    a = Counter(nums(body_numbers_text(en, "Figure")))
    b = Counter(nums(body_numbers_text(ko, "그림")))
    print("cross-language audit — in main.md but not in main_ko.md:", dict(a - b) or "none")
    print("cross-language audit — in main_ko.md but not in main.md:", dict(b - a) or "none")


def to_pdf(dpi):
    chrome = None
    for c in (r"C:\Program Files\Google\Chrome\Application\chrome.exe",
              r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"):
        if os.path.exists(c):
            chrome = c
            break
    pdf = SCI / L["pdf"]
    cmd = [chrome, "--headless=new", "--disable-gpu", "--no-pdf-header-footer", "--no-margins",
           f"--print-to-pdf={pdf}", "--virtual-time-budget=4000", (BUILD / L["html"]).as_uri()]
    subprocess.run(cmd, check=True, capture_output=True)
    import fitz
    doc = fitz.open(pdf)
    blue = (0.106, 0.31, 0.612)
    head = L["running_head"]
    if L["head_font"]:   # non-Latin running head needs an embedded font
        hf = fitz.Font(fontfile=L["head_font"])
        hw = hf.text_length(head, fontsize=7)
    else:
        hw = fitz.get_text_length(head, fontsize=7, fontname="helv")
    for k, pg in enumerate(doc):
        r = pg.rect
        x0, x1 = r.x0 + 44.6, r.x1 - 44.6            # 0.62 in margins
        # running head (IEEE Access style): wordmark left, author/title right, rule below
        pg.insert_text((x0, 40), "IEEE Access", fontsize=10 if k else 15, fontname="hebo", color=blue)
        if k:
            if L["head_font"]:
                pg.insert_text((x1 - hw, 40), head, fontsize=7, fontname="runhead", fontfile=L["head_font"], color=(0.2, 0.2, 0.2))
            else:
                pg.insert_text((x1 - hw, 40), head, fontsize=7, fontname="helv", color=(0.2, 0.2, 0.2))
        pg.draw_line((x0, 45), (x1, 45), color=blue, width=1.2)
        pg.insert_text((x0, r.y1 - 30), "VOLUME XX, 2026", fontsize=7, fontname="helv", color=(0.2, 0.2, 0.2))
        pg.insert_text((x1 - 12, r.y1 - 30), str(k + 1), fontsize=7, fontname="helv", color=(0.2, 0.2, 0.2))
    doc.save(str(pdf), incremental=True, encryption=fitz.PDF_ENCRYPT_KEEP)
    tag = "page" if L is LANGS["en"] else f"page-{L['html_lang']}"
    for old in BUILD.glob(f"{tag}-*.png"):
        old.unlink()
    for k, pg in enumerate(fitz.open(pdf)):
        pg.get_pixmap(dpi=dpi, alpha=False).save(str(BUILD / f"{tag}-{k + 1}.png"))
    print(f"pdf: {pdf} ({len(doc)} pages, {doc[0].rect.width:.0f}x{doc[0].rect.height:.0f} pt); page PNGs {tag}-*.png in {BUILD}")


if __name__ == "__main__":
    dpi = int(sys.argv[sys.argv.index("--dpi") + 1]) if "--dpi" in sys.argv else 110
    lang = sys.argv[sys.argv.index("--lang") + 1] if "--lang" in sys.argv else "en"
    configure(lang)
    build()
    if lang != "en":
        cross_language_audit()
    if "--no-pdf" not in sys.argv:
        to_pdf(dpi)
