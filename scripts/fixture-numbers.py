#!/usr/bin/env python3
"""Reference implementation of norm-1 + locate + nearest + readPassages (docs/PLAN.md 4.2, P2).

Reads test/fixtures/2026-17902.txt (the raw federalregister.gov full-text response saved on
2026-09-03) and writes test/fixtures/2026-17902.expected.json. server/normalize.test.ts asserts
that the TypeScript port (server/normalize.ts, server/anchor.ts) reproduces every value in that
file, and that the file itself still carries the numbers pinned in PLAN.md Appendix A.

    python3 scripts/fixture-numbers.py            # rewrite the expected file
    python3 scripts/fixture-numbers.py --stdout   # print the JSON instead (used by the test)

Python 3.9+, standard library only. Every regular expression below is written to match the
JavaScript semantics used by the TypeScript port (in particular JS `\\s`, which the port
pre-maps through mapSpaces so the two agree).
"""

import hashlib
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIXTURE_TXT = os.path.join(ROOT, "test", "fixtures", "2026-17902.txt")
EXPECTED_JSON = os.path.join(ROOT, "test", "fixtures", "2026-17902.expected.json")

# Sentinels are private-use code points that never occur in Federal Register text.
PAGE_SENTINEL = "\ue000"
PARA_SENTINEL = "\ue001"

# JS `\s` as an explicit set (the port collapses whitespace with /\s+/ after mapSpaces).
JS_WS_CHARS = (
    "\t\n\x0b\x0c\r \u00a0\u1680"
    + "".join(chr(c) for c in range(0x2000, 0x200B))
    + "\u2028\u2029\u202f\u205f\u3000\ufeff"
)
JS_WS_CLASS = "[" + re.escape(JS_WS_CHARS) + "]"
WS_RUN = re.compile(JS_WS_CLASS + "+")
# mapSpaces: NBSP and the other Unicode spaces -> ordinary space (both sides).
UNICODE_SPACES = re.compile("[\u00a0\u1680\u2000-\u200b\u202f\u205f\u3000\ufeff]")

TOC_MAX = 16
LABELED_HEADINGS = [
    "SUMMARY",
    "DATES",
    "ADDRESSES",
    "FOR FURTHER INFORMATION CONTACT",
    "SUPPLEMENTARY INFORMATION",
]

MAX_OCCURRENCES = 5
NEAREST_TEXT_CHARS = 240
NEAREST_MIN_CANDIDATE_CHARS = 40
NO_SPLIT_AFTER = ["Sec.", "U.S.C.", "No.", "Pub.", "L.", "E.O."]
READ_WINDOW_DEFAULT = 1200
READ_WINDOW_MIN = 200
READ_WINDOW_MAX = 1500
READ_MAX_PASSAGES = 5
READ_TOTAL_CHARS = 4500

# The same named entities the TypeScript decoder knows (plus numeric references).
ENTITY_MAP = {
    "amp": "&",
    "lt": "<",
    "gt": ">",
    "quot": '"',
    "apos": "'",
    "nbsp": " ",
    "sect": "§",
    "para": "¶",
    "mdash": "—",
    "ndash": "–",
    "ldquo": "“",
    "rdquo": "”",
    "lsquo": "‘",
    "rsquo": "’",
}


# ---------------------------------------------------------------------------
# Shared mapping helpers (4.2, both sides)
# ---------------------------------------------------------------------------


def map_quotes(s):
    s = s.replace("``", '"').replace("''", '"')
    s = re.sub("[“”„‟]", '"', s)
    s = re.sub("[‘’‚‛]", "'", s)
    return s


def map_spaces(s):
    return UNICODE_SPACES.sub(" ", s)


def collapse_whitespace(s):
    return WS_RUN.sub(" ", s).strip(JS_WS_CHARS)


def unescape_html(s):
    def repl(m):
        entity = m.group(1)
        if entity[0] == "#":
            try:
                code = int(entity[2:], 16) if entity[1] in "xX" else int(entity[1:], 10)
            except ValueError:
                return m.group(0)
            if 0 < code <= 0x10FFFF:
                return chr(code)
            return m.group(0)
        return ENTITY_MAP.get(entity.lower(), m.group(0))

    return re.sub(r"&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);", repl, s)


def normalize_quote(q):
    """normalizeQuote (4.2, quote side only)."""
    s = map_spaces(map_quotes(str(q or "")))
    s = re.sub("[—–‒―]", "--", s)
    s = re.sub("§" + JS_WS_CLASS + "*", "Sec. ", s)
    s = re.sub(r"\\\d+\\", "", s)
    return collapse_whitespace(s)


# ---------------------------------------------------------------------------
# normalizeRule (4.2, rule side), txt kind
# ---------------------------------------------------------------------------


def pre_body(raw):
    m = re.search(r"<pre[^>]*>([\s\S]*?)</pre>", raw, re.I)
    s = m.group(1) if m else raw
    s = re.sub(r"<span[^>]*__cf_email__[^>]*>[\s\S]*?</span>", "[email]", s, flags=re.I)
    s = re.sub(r"<[^>]+>", "", s)
    return unescape_html(s)


def collapse_double_spaces(inp):
    """Collapse runs of spaces to one, trim, and return (text, offset_map)."""
    removed_before = [0] * (len(inp) + 1)
    removed = 0
    out = []
    lead = 0
    while lead < len(inp) and inp[lead] == " ":
        lead += 1
    for i, c in enumerate(inp):
        removed_before[i] = removed
        if c == " " and (i < lead or (out and out[-1] == " ")):
            removed += 1
            continue
        out.append(c)
    removed_before[len(inp)] = removed
    text = "".join(out).rstrip(" ")

    def offset_map(offset):
        o = max(0, min(offset, len(inp)))
        return min(o - removed_before[o], len(text))

    return text, offset_map


def heading_for_chunk(index, chunk, state):
    """The TOC heading a paragraph chunk contributes, or None (4.2 TOC rules)."""
    clean = re.sub(PAGE_SENTINEL + r"\d+" + PAGE_SENTINEL, "", chunk).strip(JS_WS_CHARS)
    if not clean:
        return None
    collapsed = collapse_whitespace(map_spaces(map_quotes(clean)))
    for label in LABELED_HEADINGS:
        if collapsed.startswith(label + ":"):
            if label == "SUMMARY":
                state["after_summary"] = True
            return label
    if re.match(r"^List of Subjects", collapsed):
        return collapsed[:70] if len(collapsed) > 70 else collapsed
    if re.match(r"^PART \d+", collapsed):
        return collapsed[:70] if len(collapsed) > 70 else collapsed
    if not state["after_summary"]:
        return None
    if "\n" in clean:
        return None
    if len(collapsed) < 4 or len(collapsed) > 70:
        return None
    if collapsed.startswith("["):
        return None
    if re.search(r"[.,]$", collapsed):
        return None
    if re.match(r"^[-=]+$", collapsed):
        return None
    return collapsed


def trim_toc(toc):
    """Cap 16: drop the '(E.O. …)' boilerplate subsections first, then other Executive Order
    headings, then truncate."""
    if len(toc) > TOC_MAX:
        toc = [t for t in toc if not re.search(r"\bE\.O\.", t["heading"])]
    if len(toc) > TOC_MAX:
        toc = [t for t in toc if not re.search(r"Executive Order", t["heading"], re.I)]
    return toc[:TOC_MAX]


def normalize_rule_txt(raw):
    s = pre_body(raw)
    fp = re.search(r"\[Pages (\d+)-(\d+)\]", s)
    first_page = int(fp.group(1)) if fp else 0
    s = re.sub(r"\[\[Page (\d+)\]\]", lambda m: " " + PAGE_SENTINEL + m.group(1) + PAGE_SENTINEL + " ", s)
    s = re.sub(r"\n[ \t]*\n(?:[ \t]*\n)*", " " + PARA_SENTINEL + " ", s)

    chunks = s.split(PARA_SENTINEL)
    heading_by_paragraph = {}
    state = {"after_summary": False}
    for index, chunk in enumerate(chunks):
        h = heading_for_chunk(index, chunk, state)
        if h is not None:
            heading_by_paragraph[index] = h

    s = collapse_whitespace(map_spaces(map_quotes(s)))

    pages = []
    breaks = []
    paragraph_starts = [0]
    out = []
    i = 0
    n = len(s)
    while i < n:
        c = s[i]
        if c == PAGE_SENTINEL:
            j = s.index(PAGE_SENTINEL, i + 1)
            page = int(s[i + 1 : j])
            i = j + 1
            if i < n and s[i] == " ":
                i += 1
            pages.append({"offset": len(out), "page": page})
            continue
        if c == PARA_SENTINEL:
            i += 1
            if i < n and s[i] == " ":
                i += 1
            breaks.append(len(out))
            paragraph_starts.append(len(out))
            continue
        out.append(c)
        i += 1

    text, remap = collapse_double_spaces("".join(out))
    final_pages = [{"offset": remap(p["offset"]), "page": p["page"]} for p in pages]
    final_breaks = sorted({remap(b) for b in breaks if 0 < remap(b) < len(text)})
    final_paragraph_starts = [remap(p) for p in paragraph_starts]

    toc = []
    for index, heading in heading_by_paragraph.items():
        if index >= len(final_paragraph_starts):
            continue
        start = final_paragraph_starts[index]
        if start >= len(text):
            continue
        toc.append({"heading": heading, "start": start})
    toc.sort(key=lambda t: t["start"])
    toc = trim_toc(toc)

    page_marks = []
    for p in final_pages:
        if page_marks and page_marks[-1]["offset"] == p["offset"]:
            page_marks[-1]["page"] = p["page"]
        else:
            page_marks.append(p)

    return {
        "text": text,
        "first_page": first_page,
        "pages": page_marks,
        "breaks": final_breaks,
        "toc": toc,
    }


# ---------------------------------------------------------------------------
# anchor: locate, nearest, readPassages
# ---------------------------------------------------------------------------


def page_at(pages, first_page, offset):
    page = first_page
    for mark in pages:
        if mark["offset"] <= offset:
            page = mark["page"]
        else:
            break
    return page


def locate(text, pages, first_page, quote):
    q = normalize_quote(quote)
    if not q:
        return None
    occurrences = []
    frm = 0
    while len(occurrences) < MAX_OCCURRENCES:
        at = text.find(q, frm)
        if at < 0:
            break
        occurrences.append({"start": at, "end": at + len(q), "page": page_at(pages, first_page, at)})
        frm = at + 1
    if not occurrences:
        return None
    first = occurrences[0]
    return {
        "start": first["start"],
        "end": first["end"],
        "page": first["page"],
        "unique": len(occurrences) == 1,
        "occurrences": occurrences,
    }


def ends_with_abbreviation(s):
    t = s.rstrip(JS_WS_CHARS)
    return any(t.endswith(a) for a in NO_SPLIT_AFTER)


def sentence_candidates(text, min_chars=NEAREST_MIN_CANDIDATE_CHARS):
    # JS: /.+?(?:[.;:](?=\s)|$)/g ; the normalized text has no newlines so `.` and `$` agree.
    raw = []
    for m in re.finditer(r".+?(?:[.;:](?=" + JS_WS_CLASS + ")|$)", text):
        if m.end() == m.start():
            continue
        piece = {"start": m.start(), "end": m.end()}
        if raw and ends_with_abbreviation(text[raw[-1]["start"] : raw[-1]["end"]]):
            raw[-1]["end"] = piece["end"]
        else:
            raw.append(piece)
    out = []
    for piece in raw:
        sl = text[piece["start"] : piece["end"]]
        stripped = sl.strip(JS_WS_CHARS)
        if len(stripped) < min_chars:
            continue
        leading = len(sl) - len(sl.lstrip(JS_WS_CHARS))
        start = piece["start"] + leading
        out.append({"start": start, "end": start + len(stripped), "text": stripped})
    return out


def word_set(s):
    return set(re.findall(r"[a-z0-9']+", s.lower()))


def jaccard(a, b):
    if not a and not b:
        return 0.0
    inter = len(a & b)
    union = len(a) + len(b) - inter
    return 0.0 if union == 0 else inter / union


def js_round3(x):
    # JS Math.round(x*1000)/1000 rounds halves toward +infinity.
    import math

    return math.floor(x * 1000 + 0.5) / 1000


def nearest(text, pages, first_page, quote, k=3):
    q = word_set(normalize_quote(quote))
    scored = []
    for index, c in enumerate(sentence_candidates(text)):
        scored.append((jaccard(q, word_set(c["text"])), index, c))
    scored.sort(key=lambda t: (-t[0], t[1]))
    out = []
    for score, _index, c in scored[: max(0, k)]:
        out.append(
            {
                "score": js_round3(score),
                "start": c["start"],
                "end": c["end"],
                "page": page_at(pages, first_page, c["start"]),
                "text": c["text"][:NEAREST_TEXT_CHARS],
            }
        )
    return out


def clamp(n, lo, hi):
    return min(hi, max(lo, n))


def make_passage(text, pages, first_page, start, end):
    s = max(0, min(start, len(text)))
    e = max(s, min(end, len(text)))
    return {"start": s, "end": e, "page": page_at(pages, first_page, s), "text": text[s:e]}


def read_passages(text, pages, first_page, query=None, start=None, window=None, max_passages=None):
    window = clamp(int(window if window is not None else READ_WINDOW_DEFAULT), READ_WINDOW_MIN, READ_WINDOW_MAX)
    max_passages = clamp(int(max_passages if max_passages is not None else 1), 1, READ_MAX_PASSAGES)
    query = (query or "").strip()
    if not query:
        st = clamp(int(start or 0), 0, max(0, len(text)))
        if not text:
            return {"passages": [], "matches_total": 0}
        return {"passages": [make_passage(text, pages, first_page, st, st + window)], "matches_total": 0}
    haystack = text.lower()
    needle = normalize_quote(query).lower()
    if not needle:
        return {"passages": [], "matches_total": 0}
    matches = []
    frm = 0
    while True:
        at = haystack.find(needle, frm)
        if at < 0:
            break
        matches.append(at)
        frm = at + 1
    passages = []
    total = 0
    lead = window // 3
    for at in matches:
        if len(passages) >= max_passages:
            break
        st = max(0, at - lead)
        if passages and st < passages[-1]["end"]:
            continue
        end = min(len(text), st + window)
        if total + (end - st) > READ_TOTAL_CHARS:
            end = st + max(0, READ_TOTAL_CHARS - total)
            if end <= st:
                break
        p = make_passage(text, pages, first_page, st, end)
        passages.append(p)
        total += p["end"] - p["start"]
    return {"passages": passages, "matches_total": len(matches)}


# ---------------------------------------------------------------------------
# Expected values for the fixture
# ---------------------------------------------------------------------------

Q1 = (
    "Written determinations for existing trails and for new trails within developed areas "
    "must be published in the Federal Register for 30 days of public comment."
)
Q2_PREFIX = "The superintendent would have authority"
Q2_SUFFIX = "in two circumstances."
Q3 = (
    "The use of bicycles and electric bicycles is allowed in other locations designated by the "
    "superintendent after notice is provided using one or more of the methods described in "
    "Sec. 1.7 of this chapter."
)
BAD = (
    "Written determinations for existing trails must be published in the Federal Register "
    "for 60 days of public comment."
)


def anchor_summary(a):
    if a is None:
        return None
    return {"start": a["start"], "end": a["end"], "page": a["page"], "unique": a["unique"]}


def passages_summary(r):
    return {
        "matches_total": r["matches_total"],
        "passages": [{"start": p["start"], "end": p["end"], "page": p["page"]} for p in r["passages"]],
    }


def build_expected(raw):
    rule = normalize_rule_txt(raw)
    text, pages, first_page = rule["text"], rule["pages"], rule["first_page"]

    # Q2 is pinned by offsets in the plan; recover the sentence from the text so the expected
    # file carries the quote as well.
    q2_start = text.find(Q2_PREFIX)
    q2_end = text.find(Q2_SUFFIX, q2_start) + len(Q2_SUFFIX)
    q2 = text[q2_start:q2_end]

    quotes = {
        "Q1": Q1,
        "Q1_doubled_spaces": Q1.replace(" ", "  "),
        "curly_quotes": "“Making America Beautiful Again by Improving Our National Parks.”",
        "backtick_quotes": "``Making America Beautiful Again by Improving Our National Parks.''",
        "Q2": q2,
        "Q3": Q3,
        "Q3_section_sign": Q3.replace("Sec. 1.7", "§ 1.7"),
        "Q3_nbsp": Q3.replace("Sec. 1.7", "Sec. 1.7"),
        "em_dash": "NEPA—both",
    }
    anchors = {}
    for key, quote in quotes.items():
        a = locate(text, pages, first_page, quote)
        anchors[key] = {"quote": quote, "normalized": normalize_quote(quote), "anchor": anchor_summary(a)}

    bad_locate = locate(text, pages, first_page, BAD)
    near = nearest(text, pages, first_page, BAD, 3)

    return {
        "$comment": (
            "Generated by scripts/fixture-numbers.py from test/fixtures/2026-17902.txt; "
            "do not edit by hand. server/normalize.test.ts asserts the TypeScript port "
            "reproduces every value here."
        ),
        "document_number": "2026-17902",
        "raw": {
            "chars": len(raw),
            "bytes": len(raw.encode("utf-8")),
            "sha256": hashlib.sha256(raw.encode("utf-8")).hexdigest(),
        },
        "text": {
            "length": len(text),
            "first_page": first_page,
            "pages": pages,
            "sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
            "head": text[:80],
            "tail": text[-80:],
        },
        "breaks": rule["breaks"],
        "toc": rule["toc"],
        "anchors": anchors,
        "bad": {
            "quote": BAD,
            "anchor": anchor_summary(bad_locate),
            "nearest": near,
        },
        "read": {
            "30_days_default": passages_summary(read_passages(text, pages, first_page, query="30 days")),
            "30_days_max5": passages_summary(
                read_passages(text, pages, first_page, query="30 days", max_passages=5)
            ),
            "start_20000_window_300": passages_summary(
                read_passages(text, pages, first_page, start=20000, window=300)
            ),
            "superintendent_window_400_max5": passages_summary(
                read_passages(text, pages, first_page, query="superintendent", window=400, max_passages=5)
            ),
            "nothing": passages_summary(read_passages(text, pages, first_page)),
        },
        "sentence_candidates": len(sentence_candidates(text)),
    }


def main(argv):
    with open(FIXTURE_TXT, encoding="utf-8") as f:
        raw = f.read()
    expected = build_expected(raw)
    payload = json.dumps(expected, indent=2, ensure_ascii=False) + "\n"
    if "--stdout" in argv:
        sys.stdout.write(payload)
        return 0
    with open(EXPECTED_JSON, "w", encoding="utf-8") as f:
        f.write(payload)
    t = expected["text"]
    print(
        "wrote %s: length %d, first_page %d, sha256 %s, toc %d, breaks %d"
        % (
            os.path.relpath(EXPECTED_JSON, ROOT),
            t["length"],
            t["first_page"],
            t["sha256"][:16],
            len(expected["toc"]),
            len(expected["breaks"]),
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
