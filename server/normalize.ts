import type { PageMark, TocEntry } from './types';

// Normalizer norm-1 (PLAN.md 4.2). Lane A adds normalizeRule() here and must reuse
// the shared mapping helpers below so the rule side and the quote side never drift.

/** `` '' “ ” → "  and  ‘ ’ → '  (4.2, both sides). */
export function mapQuotes(s: string): string {
  return s
    .replace(/``/g, '"')
    .replace(/''/g, '"')
    .replace(/[“”„‟]/g, '"')
    .replace(/[‘’‚‛]/g, "'");
}

/** NBSP (and the other Unicode spaces) → ordinary space (4.2, both sides). */
export function mapSpaces(s: string): string {
  return s.replace(/[\u00A0\u1680\u2000-\u200B\u202F\u205F\u3000\uFEFF]/g, ' ');
}

/** Collapse every whitespace run to one space and trim (4.2, both sides). */
export function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * normalizeQuote (4.2, quote side only): the shared quote/NBSP/whitespace mapping plus
 * em/en dash → `--`, `§` → `Sec.`, and footnote markers `\1\` stripped. The rule side keeps
 * `--`, `Sec.` and the markers verbatim, so a quote typed with '—' or '§' still locates.
 */
export function normalizeQuote(quote: string): string {
  let s = String(quote ?? '');
  s = mapSpaces(mapQuotes(s));
  s = s.replace(/[—–‒―]/g, '--');
  s = s.replace(/§\s*/g, 'Sec. ');
  s = s.replace(/\\\d+\\/g, '');
  return collapseWhitespace(s);
}

// ---------------------------------------------------------------------------
// normalizeRule (4.2, rule side): the <pre> body or the full-text XML → normalized text with
// page marks, paragraph breaks and a table of contents. Offsets are exact: every anchor in
// PLAN.md Appendix A is reproduced by server/normalize.test.ts against the shipped fixture.
// ---------------------------------------------------------------------------

/** Sentinels are private-use code points so they can never occur in Federal Register text. */
const PAGE_SENTINEL = '';
const PARA_SENTINEL = '';

export interface NormalizedRule {
  text: string;
  first_page: number;
  pages: PageMark[];
  /** Offsets at which a paragraph starts (sorted, unique, never 0). */
  breaks: number[];
  toc: TocEntry[];
}

const ENTITY_MAP: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  sect: '§',
  para: '¶',
  mdash: '—',
  ndash: '–',
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
};

/** Minimal HTML entity decoder (named subset + numeric). */
export function unescapeHtml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
    if (entity[0] === '#') {
      const code =
        entity[1] === 'x' || entity[1] === 'X'
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole;
    }
    return ENTITY_MAP[entity.toLowerCase()] ?? whole;
  });
}

const LABELED_HEADINGS = [
  'SUMMARY',
  'DATES',
  'ADDRESSES',
  'FOR FURTHER INFORMATION CONTACT',
  'SUPPLEMENTARY INFORMATION',
] as const;

export const TOC_MAX = 16;

/** Raw HTML wrapper (`txt` kind) → the text between <pre> tags with the cf-email span replaced. */
function preBody(raw: string): string {
  const m = raw.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
  let s = m ? m[1] : raw;
  s = s.replace(/<span[^>]*__cf_email__[^>]*>[\s\S]*?<\/span>/gi, '[email]');
  s = s.replace(/<[^>]+>/g, '');
  return unescapeHtml(s);
}

/**
 * Normalizer norm-1 (4.2). `kind` 'txt' is the federalregister.gov full_text/text wrapper;
 * 'xml' is full_text_xml_url (<PRTPAGE P="N"/> page breaks, </P> paragraph ends). 'seed' is
 * the shipped snapshot of the txt form.
 */
export function normalizeRule(raw: string, kind: 'txt' | 'xml' | 'seed' = 'txt'): NormalizedRule {
  let s: string;
  let first_page = 0;
  if (kind === 'xml') {
    s = String(raw ?? '');
    const fp = s.match(/<PRTPAGE\s+P="(\d+)"/i);
    s = s.replace(
      /<PRTPAGE\s+P="(\d+)"\s*\/?>/gi,
      (_, n: string) => ` ${PAGE_SENTINEL}${n}${PAGE_SENTINEL} `,
    );
    s = s.replace(
      /<\/(P|HD|FP|EXTRACT|GPOTABLE|SIG|NOTE|AMDPAR|SECTION|SUBJECT|HEAD)>/gi,
      ` ${PARA_SENTINEL} `,
    );
    s = s.replace(/<[^>]+>/g, '');
    s = unescapeHtml(s);
    // In XML the first PRTPAGE marks the *second* page; the first page is one less.
    first_page = fp ? Number(fp[1]) - 1 : 0;
  } else {
    s = preBody(String(raw ?? ''));
    const fp = s.match(/\[Pages (\d+)-(\d+)\]/);
    first_page = fp ? Number(fp[1]) : 0;
    s = s.replace(
      /\[\[Page (\d+)\]\]/g,
      (_, n: string) => ` ${PAGE_SENTINEL}${n}${PAGE_SENTINEL} `,
    );
    s = s.replace(/\n[ \t]*\n(?:[ \t]*\n)*/g, ` ${PARA_SENTINEL} `);
  }
  // Paragraph chunks are inspected for headings before whitespace collapses the line structure.
  const chunks = s.split(PARA_SENTINEL);
  const headingByParagraph = new Map<number, string>();
  let afterSummary = false;
  chunks.forEach((chunk, index) => {
    const clean = chunk.replace(new RegExp(`${PAGE_SENTINEL}\\d+${PAGE_SENTINEL}`, 'g'), '').trim();
    if (!clean) return;
    const collapsed = collapseWhitespace(mapSpaces(mapQuotes(clean)));
    for (const label of LABELED_HEADINGS) {
      if (collapsed.startsWith(`${label}:`)) {
        headingByParagraph.set(index, label);
        if (label === 'SUMMARY') afterSummary = true;
        return;
      }
    }
    if (/^List of Subjects/.test(collapsed)) {
      headingByParagraph.set(index, collapsed.length > 70 ? collapsed.slice(0, 70) : collapsed);
      return;
    }
    if (/^PART \d+/.test(collapsed)) {
      headingByParagraph.set(index, collapsed.length > 70 ? collapsed.slice(0, 70) : collapsed);
      return;
    }
    if (!afterSummary) return;
    if (clean.includes('\n')) return;
    if (collapsed.length < 4 || collapsed.length > 70) return;
    if (collapsed.startsWith('[')) return;
    if (/[.,]$/.test(collapsed)) return;
    if (/^[-=]+$/.test(collapsed)) return;
    headingByParagraph.set(index, collapsed);
  });

  s = mapSpaces(mapQuotes(s));
  s = collapseWhitespace(s);

  const pages: PageMark[] = [];
  const breaks: number[] = [];
  const paragraphStarts: number[] = [0];
  let out = '';
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === PAGE_SENTINEL) {
      const j = s.indexOf(PAGE_SENTINEL, i + 1);
      const page = Number(s.slice(i + 1, j));
      i = j + 1;
      if (s[i] === ' ') i++;
      pages.push({ offset: out.length, page });
      continue;
    }
    if (c === PARA_SENTINEL) {
      i++;
      if (s[i] === ' ') i++;
      breaks.push(out.length);
      paragraphStarts.push(out.length);
      continue;
    }
    out += c;
    i++;
  }
  // Residual double spaces (a sentinel that had a space on both sides) collapse; offsets shift
  // by the number of removed spaces before them, so the marks are re-mapped through the same
  // pass instead of collapsed blindly.
  const { text, map } = collapseDoubleSpaces(out);
  const remap = (offset: number) => map(offset);
  const finalPages = pages.map(p => ({ offset: remap(p.offset), page: p.page }));
  const finalBreaks = uniqueSorted(breaks.map(remap).filter(b => b > 0 && b < text.length));
  const finalParagraphStarts = paragraphStarts.map(remap);

  let toc: TocEntry[] = [];
  for (const [index, heading] of headingByParagraph) {
    const start = finalParagraphStarts[index];
    if (start === undefined || start >= text.length) continue;
    toc.push({ heading, start });
  }
  toc.sort((a, b) => a.start - b.start);
  toc = trimToc(toc);

  // Page marks are unique per offset (a page break that coincides with a paragraph break keeps
  // the later page number).
  const pageMarks: PageMark[] = [];
  for (const p of finalPages) {
    const last = pageMarks[pageMarks.length - 1];
    if (last && last.offset === p.offset) last.page = p.page;
    else pageMarks.push(p);
  }

  return { text, first_page, pages: pageMarks, breaks: finalBreaks, toc };
}

/**
 * Cap the TOC at TOC_MAX (4.2): drop the "(E.O. NNNNN)" boilerplate subsections first, then any
 * other Executive Order heading, then truncate. Mirrors trim_toc in scripts/fixture-numbers.py.
 */
export function trimToc(toc: TocEntry[]): TocEntry[] {
  let out = toc;
  if (out.length > TOC_MAX) out = out.filter(t => !/\bE\.O\./.test(t.heading));
  if (out.length > TOC_MAX) out = out.filter(t => !/Executive Order/i.test(t.heading));
  return out.length > TOC_MAX ? out.slice(0, TOC_MAX) : out;
}

/** Collapse runs of spaces to one, trim, and return a map from old offsets to new offsets. */
function collapseDoubleSpaces(input: string): { text: string; map: (offset: number) => number } {
  const removedBefore: number[] = new Array(input.length + 1);
  let removed = 0;
  let out = '';
  let lead = 0;
  while (lead < input.length && input[lead] === ' ') lead++;
  for (let i = 0; i < input.length; i++) {
    removedBefore[i] = removed;
    const c = input[i];
    if (c === ' ' && (i < lead || out.endsWith(' '))) {
      removed++;
      continue;
    }
    out += c;
  }
  removedBefore[input.length] = removed;
  const trailing = out.length - out.trimEnd().length;
  const text = out.trimEnd();
  return {
    text,
    map: (offset: number) => {
      const o = Math.max(0, Math.min(offset, input.length));
      const mapped = o - (removedBefore[o] ?? removed);
      return Math.min(mapped, text.length + (trailing > 0 ? 0 : 0));
    },
  };
}

function uniqueSorted(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}
