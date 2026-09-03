// Anchor verifier (PLAN.md 4.2, P2 item 3). Minimal but real; lane A refines nearest() and
// readPassages() against the fixture numbers. Signatures are frozen:
//   locate(text, pages, first_page, quote)            → Anchor | null
//   nearest(text, pages, first_page, quote, k = 3)    → NearestPassage[]
//   readPassages(text, pages, first_page, options)    → ReadResult

import { normalizeQuote } from './normalize';
import type {
  Anchor,
  NearestPassage,
  Occurrence,
  PageMark,
  Passage,
  ReadOptions,
  ReadResult,
} from './types';

export const MAX_OCCURRENCES = 5;
export const NEAREST_TEXT_CHARS = 240;
export const NEAREST_MIN_CANDIDATE_CHARS = 40;
export const READ_WINDOW_DEFAULT = 1200;
export const READ_WINDOW_MIN = 200;
export const READ_WINDOW_MAX = 1500;
export const READ_MAX_PASSAGES = 5;
export const READ_TOTAL_CHARS = 4500;

/** Federal Register page containing normalized offset `offset` (4.2 pages). */
export function pageAt(pages: readonly PageMark[], first_page: number, offset: number): number {
  let page = first_page;
  for (const mark of pages) {
    if (mark.offset <= offset) page = mark.page;
    else break;
  }
  return page;
}

/**
 * Exact substring search after normalizeQuote (4.2). Returns the first occurrence, whether it
 * is unique, and up to MAX_OCCURRENCES occurrences; null when the quote is empty or absent.
 */
export function locate(
  text: string,
  pages: readonly PageMark[],
  first_page: number,
  quote: string,
): Anchor | null {
  const q = normalizeQuote(quote);
  if (!q) return null;
  const occurrences: Occurrence[] = [];
  let from = 0;
  while (occurrences.length < MAX_OCCURRENCES) {
    const at = text.indexOf(q, from);
    if (at < 0) break;
    occurrences.push({ start: at, end: at + q.length, page: pageAt(pages, first_page, at) });
    from = at + 1;
  }
  if (occurrences.length === 0) return null;
  const first = occurrences[0];
  return { ...first, unique: occurrences.length === 1, occurrences };
}

/** Abbreviations after which the sentence splitter must not split (4.2). */
const NO_SPLIT_AFTER = ['Sec.', 'U.S.C.', 'No.', 'Pub.', 'L.', 'E.O.'];

export interface SentenceCandidate {
  start: number;
  end: number;
  text: string;
}

/**
 * Sentence candidates for nearest(): `/.+?(?:[.;:](?=\s)|$)/g`, merged across the abbreviation
 * list, then TRIMMED so offsets point at the first real character (the off-by-one fix in 4.2).
 */
export function sentenceCandidates(
  text: string,
  minChars = NEAREST_MIN_CANDIDATE_CHARS,
): SentenceCandidate[] {
  const raw: Array<{ start: number; end: number }> = [];
  const re = /.+?(?:[.;:](?=\s)|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    const piece = { start: m.index, end: m.index + m[0].length };
    const prev = raw[raw.length - 1];
    if (prev && endsWithAbbreviation(text.slice(prev.start, prev.end))) {
      prev.end = piece.end;
    } else {
      raw.push(piece);
    }
  }
  const out: SentenceCandidate[] = [];
  for (const piece of raw) {
    const slice = text.slice(piece.start, piece.end);
    const leading = slice.length - slice.trimStart().length;
    const trimmed = slice.trim();
    if (trimmed.length < minChars) continue;
    const start = piece.start + leading;
    out.push({ start, end: start + trimmed.length, text: trimmed });
  }
  return out;
}

/** True when the last token of `s` (leading '(' or quotes dropped) is one of NO_SPLIT_AFTER. */
function endsWithAbbreviation(s: string): boolean {
  const t = s.trimEnd();
  const lastToken = t.slice(t.lastIndexOf(' ') + 1).replace(/^["'(]+/, '');
  return NO_SPLIT_AFTER.includes(lastToken);
}

/** Lowercase word set over `[a-z0-9']+` (4.2). */
export function wordSet(s: string): Set<string> {
  return new Set(s.toLowerCase().match(/[a-z0-9']+/g) ?? []);
}

/** Jaccard similarity of two word sets (4.2). */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * The k sentence candidates most similar to the (normalized) quote, best first; ties keep
 * document order. `text` is cut to NEAREST_TEXT_CHARS with markers verbatim (4.2).
 */
export function nearest(
  text: string,
  pages: readonly PageMark[],
  first_page: number,
  quote: string,
  k = 3,
): NearestPassage[] {
  const q = wordSet(normalizeQuote(quote));
  const scored = sentenceCandidates(text).map((c, index) => ({
    index,
    score: jaccard(q, wordSet(c.text)),
    c,
  }));
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.slice(0, Math.max(0, k)).map(({ score, c }) => ({
    score: Math.round(score * 1000) / 1000,
    start: c.start,
    end: c.end,
    page: pageAt(pages, first_page, c.start),
    text: c.text.length > NEAREST_TEXT_CHARS ? c.text.slice(0, NEAREST_TEXT_CHARS) : c.text,
  }));
}

/**
 * Passages for read_rule (section 3 tool 3, P2 item 3). With `query`: case-insensitive matches,
 * each passage starting at max(0, match − floor(window/3)), de-duplicated by overlap, at most
 * `max_passages`, total ≤ READ_TOTAL_CHARS; `matches_total` counts every match. With `start`:
 * one window from `start`. Neither: one window from 0.
 */
export function readPassages(
  text: string,
  pages: readonly PageMark[],
  first_page: number,
  options: ReadOptions = {},
): ReadResult {
  const window = clamp(
    Math.trunc(options.window ?? READ_WINDOW_DEFAULT),
    READ_WINDOW_MIN,
    READ_WINDOW_MAX,
  );
  const maxPassages = clamp(Math.trunc(options.max_passages ?? 1), 1, READ_MAX_PASSAGES);
  const query = options.query?.trim() ?? '';

  if (query.length === 0) {
    const start = clamp(Math.trunc(options.start ?? 0), 0, Math.max(0, text.length));
    if (text.length === 0) return { passages: [], matches_total: 0 };
    return {
      passages: [makePassage(text, pages, first_page, start, start + window)],
      matches_total: 0,
    };
  }

  const haystack = text.toLowerCase();
  const needle = normalizeQuote(query).toLowerCase();
  if (!needle) return { passages: [], matches_total: 0 };
  const matches: number[] = [];
  let from = 0;
  while (true) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) break;
    matches.push(at);
    from = at + 1;
  }

  const passages: Passage[] = [];
  let total = 0;
  const lead = Math.floor(window / 3);
  for (const at of matches) {
    if (passages.length >= maxPassages) break;
    const start = Math.max(0, at - lead);
    const last = passages[passages.length - 1];
    if (last && start < last.end) continue; // overlaps the previous passage
    let end = Math.min(text.length, start + window);
    if (total + (end - start) > READ_TOTAL_CHARS) {
      end = start + Math.max(0, READ_TOTAL_CHARS - total);
      if (end <= start) break;
    }
    const passage = makePassage(text, pages, first_page, start, end);
    passages.push(passage);
    total += passage.end - passage.start;
  }
  return { passages, matches_total: matches.length };
}

function makePassage(
  text: string,
  pages: readonly PageMark[],
  first_page: number,
  start: number,
  end: number,
): Passage {
  const s = Math.max(0, Math.min(start, text.length));
  const e = Math.max(s, Math.min(end, text.length));
  return { start: s, end: e, page: pageAt(pages, first_page, s), text: text.slice(s, e) };
}

function clamp(n: number, lo: number, hi: number): number {
  if (Number.isNaN(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}
