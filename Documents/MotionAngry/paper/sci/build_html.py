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
WIDE_TABLES = {2, 3, 4}  # tables that span both columns (Table 1, implementation, stays in one column)
ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"]


def section_refs(s):
    """'Section 6.2' -> 'Section VI-B', 'Section 7' -> 'Section VII' (IEEE cross-reference style)."""
    s = re.sub(r"Section (\d)\.(\d)", lambda m: f"Section {ROMAN[int(m.group(1)) - 1]}-{chr(64 + int(m.group(2)))}", s)
    s = re.sub(r"Section (\d)(?!\.\d)", lambda m: f"Section {ROMAN[int(m.group(1)) - 1]}", s)
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
    md = (SCI / "main.md").read_text(encoding="utf-8")
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

    def flush_fig(text):
        """emit figure elements for first mentions of 'Figure n' in this paragraph."""
        for n in sorted({int(x) for x in re.findall(r"Figure (\d)", text)}):
            if n in FIGURES and n not in figs_done:
                figs_done.add(n)
                f, cap, wide, *w = FIGURES[n]
                style = f" style='width:{w[0]}%'" if w else ""
                out.append(f"<figure class='{'wide' if wide else ''}'><img src='{f}' alt='Figure {n}'{style}>"
                           f"<figcaption><b>FIGURE {n}.</b> {html.escape(cap)}</figcaption></figure>")

    while i < len(lines):
        ln = lines[i]
        if ln.startswith("# "):
            h = ln[2:].strip()
            if h == "Abstract":
                in_abstract = True
                i += 1
                continue
            if h == "References":
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
            if j < len(lines) and lines[j].startswith("Table "):
                cap = lines[j].strip()
                i = j + 1
            tables_seen += 1
            m = re.match(r"Table (\d+)\.\s*(.*)", cap)
            tno = int(m.group(1)) if m else tables_seen
            captext = m.group(2) if m else ""
            # a trailing 'Figure 5. ...' sentence inside a table caption belongs to the figure (typeset there)
            captext = re.sub(r"\s*Figure \d\..*$", "", captext)
            wide = tno in WIDE_TABLES
            kind = "num" if len(rows[0]) > 2 else "text"
            th = "".join(f"<th>{inline(c, cites)}</th>" for c in rows[0])
            trs = "".join("<tr>" + "".join(f"<td>{inline(c, cites)}</td>" for c in r) + "</tr>" for r in rows[1:])
            out.append(f"<div class='tbl {'wide' if wide else ''} {kind}'><div class='tcap'><b>TABLE {tno}.</b> "
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
        if re.match(r"^Figure \d\.", text):   # stand-alone figure caption paragraphs: captions are in FIGURES
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

    missing = set(FIGURES) - figs_done
    assert not missing, f"figures never mentioned: {missing}"
    refs = "".join(f"<li value='{n}'>{fmt_ref(bib[k])}</li>" for k, n in cites.items())
    unused = set(bib) - set(cites)

    spans = [f"<span class='au'>{a['name']}<sup>{a['sup']}</sup></span>" for a in AUTHORS]
    authors_html = (" AND ".join(spans) if len(spans) == 2 else ", ".join(spans[:-1]) + ", AND " + spans[-1])
    affil_html = "".join(f"<div class='aff'><sup>{k}</sup>{html.escape(v)}</div>" for k, v in AFFIL.items())

    page = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>{html.escape(title)}</title>
<style>
@page {{ size: 8.5in 11in; margin: 0.9in 0.62in 0.8in 0.62in; }}
html, body {{ margin: 0; padding: 0; }}
body {{ font-family: "Times New Roman", Times, serif; font-size: 9.5pt; line-height: 1.22; color: #000; }}
.firstbar {{ font: 7pt Arial, sans-serif; color: #333; margin: 0 0 10px 0; line-height: 1.35; }}
.firstbar .doi {{ margin-top: 3px; }}
h1 {{ font: bold 19pt Arial, Helvetica, sans-serif; line-height: 1.15; margin: 4px 0 8px 0; color: #000; }}
.authors {{ font: bold 9.5pt Arial, sans-serif; margin: 0 0 4px 0; }}
.aff {{ font: 7.5pt Arial, sans-serif; margin: 1px 0; }}
.corr, .fund {{ font: 7.5pt Arial, sans-serif; margin: 5px 0 0 0; }}
.abstract {{ margin: 12px 0 6px 0; font-family: Arial, sans-serif; font-size: 8.8pt; line-height: 1.3; text-align: justify; }}
.abstract b.lbl, .terms b.lbl {{ font-family: Arial, sans-serif; font-weight: bold; }}
.terms {{ font-family: Arial, sans-serif; font-size: 8.8pt; margin: 4px 0 10px 0; }}
.rule {{ border-top: 1.5px solid #1b4f9c; margin: 8px 0 12px 0; }}
.cols {{ column-count: 2; column-gap: 0.2in; column-fill: auto; text-align: justify; hyphens: auto; }}
h2 {{ font: bold 9.5pt Arial, sans-serif; margin: 11px 0 4px 0; break-after: avoid; letter-spacing: 0.2px; }}
h3 {{ font: bold 9pt Arial, sans-serif; margin: 8px 0 3px 0; break-after: avoid; }}
p {{ margin: 0 0 5px 0; text-indent: 0; orphans: 2; widows: 2; }}
p + p {{ text-indent: 1.2em; }}
ul {{ margin: 2px 0 6px 0; padding-left: 1.2em; }}
li {{ margin-bottom: 3px; }}
code {{ font-family: "Courier New", monospace; font-size: 7.8pt; overflow-wrap: anywhere; }}
.m {{ font-family: "Times New Roman", serif; }}
figure {{ margin: 8px 0 10px 0; break-inside: avoid; }}
figure img {{ width: 100%; display: block; }}
figure.wide, .tbl.wide {{ column-span: all; }}
figure.wide {{ margin: 10px 0 12px 0; }}
figure.wide img {{ width: 78%; margin: 0 auto; }}
figure.wide.full img {{ width: 100%; }}
figcaption, .tcap {{ font: 7.5pt Arial, sans-serif; line-height: 1.3; text-align: left; margin-top: 5px; }}
.tbl {{ margin: 8px 0 10px 0; break-inside: avoid; }}
.tbl .tcap {{ margin: 0 0 4px 0; }}
table {{ border-collapse: collapse; width: 100%; font: 7.5pt Arial, sans-serif; line-height: 1.25; }}
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
.bio b {{ font-family: Arial, sans-serif; }}
.todo {{ color: #b00020; }}
</style></head><body>
<div class="firstbar">Received [TO FILL]; accepted [TO FILL]; date of publication [TO FILL]; date of current version [TO FILL].
<div class="doi">Digital Object Identifier 10.1109/ACCESS.2026.[TO FILL]</div></div>
<h1>{html.escape(title)}</h1>
<div class="authors">{authors_html}</div>
{affil_html}
<div class="corr">{html.escape(CORRESPONDING)}</div>
<div class="fund">{html.escape(FUNDING)}</div>
<div class="abstract"><b class="lbl">ABSTRACT</b> {abstract}</div>
<div class="terms"><b class="lbl">INDEX TERMS</b> {html.escape(INDEX_TERMS)}.</div>
<div class="rule"></div>
<div class="cols">
{''.join(out)}
<h2>REFERENCES</h2>
<ol class="refs">{refs}</ol>
<h2>AUTHOR BIOGRAPHIES</h2>
<p class="bio"><b>JEONGMO KANG</b> is an undergraduate student in the Department of Information and Communication Engineering,
Seoil University, Seoul, Republic of Korea. <span class="todo">[Biography TO FILL: degree year, research interests.]</span></p>
<p class="bio"><b>WANTAE KIM</b> is with the Department of Information and Communication Engineering, Seoil University, Seoul,
Republic of Korea. <span class="todo">[Biography TO FILL: position, degrees, research interests.]</span></p>
</div>
</body></html>
"""
    (BUILD / "main.html").write_text(page, encoding="utf-8")
    import fitz
    for f, *_ in FIGURES.values():   # figures/*.pdf -> build/*.png at 300 dpi (re-rendered when the pdf is newer)
        src = FIG / (f[:-4] + ".pdf")
        if not (BUILD / f).exists() or src.stat().st_mtime > (BUILD / f).stat().st_mtime:
            fitz.open(src)[0].get_pixmap(dpi=300, alpha=False).save(str(BUILD / f))
    print(f"html written: {len(cites)} references cited in order; unused bib keys: {sorted(unused)}")

    # numeric audit: every number token in the md body must survive into the html text
    def nums(t):
        return re.findall(r"(?<![\w.])[−+-]?\d+(?:[.,]\d+)*(?:\s?%)?", t)
    md_text = body.split("# 1 Introduction", 1)[1].split("# References")[0]
    md_text = re.sub(r"`figures/[^`]+`", "", md_text)
    md_text = re.sub(r"^Figure \d\..*$", "", md_text, flags=re.M)
    md_text = re.sub(r"Section \d(\.\d)?|^#+ .*$", "", md_text, flags=re.M)   # renumbered on purpose (roman / letters)
    md_text = md_text.replace("$-", "$−").replace("= -", "= −").replace("^{-", "^{−")   # math minus is typeset as U+2212
    html_text = re.sub(r"<[^>]+>", " ", page.split("<div class=\"cols\">")[1].split("<h2>REFERENCES</h2>")[0])
    html_text = html.unescape(html_text)
    from collections import Counter
    a, b = Counter(nums(md_text)), Counter(nums(html_text))
    lost = {k: v for k, v in (a - b).items()}
    print("numeric audit — in md body but not in html:", lost or "none")
    return page


def to_pdf(dpi):
    chrome = None
    for c in (r"C:\Program Files\Google\Chrome\Application\chrome.exe",
              r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"):
        if os.path.exists(c):
            chrome = c
            break
    pdf = SCI / "main.pdf"
    cmd = [chrome, "--headless=new", "--disable-gpu", "--no-pdf-header-footer", "--no-margins",
           f"--print-to-pdf={pdf}", "--virtual-time-budget=4000", (BUILD / "main.html").as_uri()]
    subprocess.run(cmd, check=True, capture_output=True)
    import fitz
    doc = fitz.open(pdf)
    blue = (0.106, 0.31, 0.612)
    for k, pg in enumerate(doc):
        r = pg.rect
        x0, x1 = r.x0 + 44.6, r.x1 - 44.6            # 0.62 in margins
        # running head (IEEE Access style): wordmark left, author/title right, rule below
        pg.insert_text((x0, 40), "IEEE Access", fontsize=10 if k else 15, fontname="hebo", color=blue)
        if k:
            w = fitz.get_text_length(RUNNING_HEAD, fontsize=7, fontname="helv")
            pg.insert_text((x1 - w, 40), RUNNING_HEAD, fontsize=7, fontname="helv", color=(0.2, 0.2, 0.2))
        pg.draw_line((x0, 45), (x1, 45), color=blue, width=1.2)
        pg.insert_text((x0, r.y1 - 30), "VOLUME XX, 2026", fontsize=7, fontname="helv", color=(0.2, 0.2, 0.2))
        pg.insert_text((x1 - 12, r.y1 - 30), str(k + 1), fontsize=7, fontname="helv", color=(0.2, 0.2, 0.2))
    doc.save(str(pdf), incremental=True, encryption=fitz.PDF_ENCRYPT_KEEP)
    for old in BUILD.glob("page-*.png"):
        old.unlink()
    for k, pg in enumerate(fitz.open(pdf)):
        pg.get_pixmap(dpi=dpi, alpha=False).save(str(BUILD / f"page-{k + 1}.png"))
    print(f"pdf: {pdf} ({len(doc)} pages, {doc[0].rect.width:.0f}x{doc[0].rect.height:.0f} pt); page PNGs in {BUILD}")


if __name__ == "__main__":
    dpi = int(sys.argv[sys.argv.index("--dpi") + 1]) if "--dpi" in sys.argv else 110
    build()
    if "--no-pdf" not in sys.argv:
        to_pdf(dpi)
