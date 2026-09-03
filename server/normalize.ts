// Normalizer norm-1, quote side (PLAN.md 4.2). Lane A adds normalizeRule() here and must reuse
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
