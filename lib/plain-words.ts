// The plain-words writing check (docs/PLAIN-WORDS.md). Pure, deterministic, no LLM, no DOM:
// the page, the export, the tools and node:test all import this one module.
//
// Every rule below is derived from `docs/unslop-SKILL.md` (unslop by Lauren Tan (poteto), from
// Cursor's pstack plugin, MIT). The word lists are the skill's own, copied from its numbered
// patterns; each rule cites the pattern number in `source` and carries the skill's own example
// in `example` (lib/plain-words.test.ts fires every rule on it). Only the mechanically
// detectable patterns are here (7, 8, 9, 13, 14, 19, 20, 22, 23, 24, 26, 30, 31); the ones that
// need judgment stay advice in PLAIN_WORDS_GUIDE, the README and docs/unslop-SKILL.md.
//
// Two invariants the product depends on:
//   1. Text inside double quotes (straight or curly) is never flagged, so a verbatim rule quote
//      is never touched (docs/PLAIN-WORDS.md "What ships" 1).
//   2. Flags are suggestions. Nothing here blocks, rewrites or refuses anything.

export interface PlainWordsCredit {
  name: string;
  author: string;
  url: string;
  license: string;
}

/** Credit for the source skill. Rendered on the page, in the README and in docs/TOOLS.md. */
export const CREDIT: PlainWordsCredit = {
  name: 'unslop',
  author: 'Lauren Tan (poteto)',
  url: 'https://github.com/cursor/plugins/blob/main/pstack/skills/unslop/SKILL.md',
  license: 'MIT',
};

/** The one credit sentence, used verbatim everywhere the check appears. */
export const CREDIT_LINE = `Writing check adapted from ${CREDIT.name} by ${CREDIT.author}, ${CREDIT.license}.`;

/** A span of the checked text. */
export interface PlainWordsMatch {
  start: number;
  end: number;
}

export type PlainWordsPattern = RegExp | ((text: string) => PlainWordsMatch[]);

export interface PlainWordsRule {
  /** Stable id; appears in flags, so keep it stable across releases. */
  id: string;
  title: string;
  /** Run against the text with quoted spans blanked out (see maskQuotedSpans). */
  pattern: PlainWordsPattern;
  /** What to do instead, in the skill's words. */
  fix: string;
  /** The skill section this comes from, e.g. 'unslop §23'. */
  source: string;
  /** The skill's own example of the pattern; the test asserts the rule fires on it. */
  example: string;
}

export interface PlainWordsFlag {
  rule_id: string;
  title: string;
  start: number;
  end: number;
  /** A short window of the person's own text around the match (never HTML). */
  excerpt: string;
  fix: string;
  source: string;
}

export interface PlainWordsResult {
  flags: PlainWordsFlag[];
  /** Flags per 100 words, one decimal. 0 is clean. */
  score: number;
}

// ---------------------------------------------------------------------------
// Pattern helpers
// ---------------------------------------------------------------------------

function escapeForRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `\b(?:a|b|c)\b`, case-insensitive. Multi-word entries work as written. */
function anyWord(list: readonly string[]): RegExp {
  return new RegExp(`\\b(?:${list.map(escapeForRegExp).join('|')})\\b`, 'gi');
}

/** Merge the matches of several regexes, in text order. */
function anyOf(...patterns: readonly RegExp[]): (text: string) => PlainWordsMatch[] {
  return (text: string) => {
    const out: PlainWordsMatch[] = [];
    for (const re of patterns) out.push(...matchAll(re, text));
    return out.sort((a, b) => a.start - b.start || a.end - b.end);
  };
}

function matchAll(re: RegExp, text: string): PlainWordsMatch[] {
  const global = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  const out: PlainWordsMatch[] = [];
  let m: RegExpExecArray | null;
  while ((m = global.exec(text)) !== null) {
    if (m[0].length === 0) {
      global.lastIndex++;
      continue;
    }
    out.push({ start: m.index, end: m.index + m[0].length });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Word lists, copied from docs/unslop-SKILL.md
// ---------------------------------------------------------------------------

/** §7 "AI vocabulary", verbatim. 'landscape' and 'tapestry' are the abstract uses. */
export const AI_VOCABULARY: readonly string[] = [
  'additionally',
  'crucial',
  'delve',
  'enduring',
  'enhance',
  'fostering',
  'garner',
  'interplay',
  'intricate',
  'landscape',
  'pivotal',
  'showcase',
  'tapestry',
  'testament',
  'underscore',
  'vibrant',
];

/** §8 fancy ways to say "is". 'features' needs a following object to be the verb, not a noun. */
export const FANCY_IS: readonly string[] = [
  'serves as',
  'serve as',
  'served as',
  'serving as',
  'stands as',
  'stand as',
  'stood as',
  'standing as',
  'boasts',
  'boasted',
  'boasting',
];

/** §23 filler phrases, verbatim. */
export const FILLER_PHRASES: readonly string[] = [
  'in order to',
  'due to the fact that',
  'it is important to note that',
];

/** §24 hedges, from the skill's stacked example. One is fine; two in a clause is the tell. */
export const HEDGE_WORDS: readonly string[] = [
  'could',
  'may',
  'might',
  'potentially',
  'possibly',
  'be argued that',
];

/** §26 abstract metaphor nouns the skill lists without a qualifier. */
export const METAPHOR_NOUNS: readonly string[] = [
  'substrate',
  'wedge',
  'vector',
  'locus',
  'vantage',
  'nexus',
  'bedrock',
  'scaffolding',
  'modality',
  'paradigm',
  'gold-plating',
  'north star',
  'flywheel',
  'endgame',
];

/** §30 the adverbs this product checks (docs/PLAIN-WORDS.md names the short list). */
export const WEAK_ADVERBS: readonly string[] = [
  'quickly',
  'significantly',
  'seamlessly',
  'effectively',
  'truly',
  'really',
  'very',
];

/** §31 plain-word swaps, verbatim, with the inflections of each verb. */
export const PLAIN_SWAPS: readonly string[] = [
  'utilize',
  'utilizes',
  'utilized',
  'utilizing',
  'leverage',
  'leverages',
  'leveraged',
  'leveraging',
  'facilitate',
  'facilitates',
  'facilitated',
  'facilitating',
  'numerous',
  'in the event that',
];

// ---------------------------------------------------------------------------
// The mechanical rules that need more than a word list
// ---------------------------------------------------------------------------

/** True at a sentence end (§14 and §24 stay inside one sentence). */
function isSentenceBreak(ch: string): boolean {
  return ch === '.' || ch === '!' || ch === '?' || ch === '\n';
}

/**
 * §14 colon overuse: a colon used as a mid-sentence connector. Deterministic reading of the
 * skill's example ("If you're coming from traditional automation: instead of…"): at least four
 * words into its sentence and followed by a lower-case word. A short lead-in label ("Add to
 * 4.30(b): a designation takes effect…") and a clock time (14:02) are left alone.
 */
function midSentenceColons(text: string): PlainWordsMatch[] {
  const out: PlainWordsMatch[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== ':') continue;
    if (/\d/.test(text[i - 1] ?? '') && /\d/.test(text[i + 1] ?? '')) continue;
    const after = text.slice(i + 1).match(/^\s+([a-z])/);
    if (!after) continue;
    let start = 0;
    for (let j = i - 1; j >= 0; j--) {
      if (isSentenceBreak(text[j])) {
        start = j + 1;
        break;
      }
    }
    const before = text.slice(start, i).match(/\S+/g) ?? [];
    if (before.length < 4) continue;
    out.push({ start: i, end: i + 1 });
  }
  return out;
}

/** §24 excessive hedging: two or more hedges inside one clause (≤40 chars apart, no break). */
function stackedHedges(text: string): PlainWordsMatch[] {
  const hedges = matchAll(anyWord(HEDGE_WORDS), text);
  const out: PlainWordsMatch[] = [];
  let group: PlainWordsMatch[] = [];
  const flush = () => {
    if (group.length >= 2) {
      out.push({ start: group[0].start, end: group[group.length - 1].end });
    }
    group = [];
  };
  for (const h of hedges) {
    const last = group[group.length - 1];
    const between = last ? text.slice(last.end, h.start) : '';
    if (last && (h.start - last.end > 40 || [...between].some(isSentenceBreak))) flush();
    group.push(h);
  }
  flush();
  return out;
}

// ---------------------------------------------------------------------------
// The rule table
// ---------------------------------------------------------------------------

export const PLAIN_WORDS_RULES: readonly PlainWordsRule[] = [
  {
    id: 'ai-vocabulary',
    title: 'AI vocabulary',
    pattern: anyWord(AI_VOCABULARY),
    fix: 'Replace with a plain word.',
    source: 'unslop §7',
    example: 'Additionally, the pivotal interplay underscores a vibrant landscape.',
  },
  {
    id: 'fancy-is',
    title: 'Fancy way to say "is"',
    pattern: anyOf(anyWord(FANCY_IS), /\bfeatures?\s+(?:a|an|the|its|their|over|\d)\b/gi),
    fix: 'Just say "is" or "has".',
    source: 'unslop §8',
    example: 'The rule serves as a reminder and boasts wide support.',
  },
  {
    id: 'not-just-but',
    title: '"Not just X, but Y"',
    pattern: /\bnot just\b[^.!?\n]{0,120}?\bbut\b/gi,
    fix: 'State the point directly.',
    source: 'unslop §9',
    example: 'This is not just a trail closure, but a loss of access.',
  },
  {
    id: 'dash-as-connector',
    title: 'Em dash, en dash or hyphen used as a dash',
    pattern: /—|–|\s-{1,2}\s|-{2,}/g,
    fix: 'End the sentence or use a comma. No parentheses, en dashes or double hyphens either.',
    source: 'unslop §13',
    example: 'The trail closes at dusk — and the notice went up that morning.',
  },
  {
    id: 'mid-sentence-colon',
    title: 'Colon used as a mid-sentence connector',
    pattern: midSentenceColons,
    fix: 'Let the point stand on its own; keep colons for a list or an example.',
    source: 'unslop §14',
    example:
      "If you're coming from traditional automation: instead of registering event handlers, you describe conditions.",
  },
  {
    id: 'curly-quotes',
    title: 'Curly quotes',
    pattern: /[‘’“”]/g,
    fix: 'Replace with straight quotes.',
    source: 'unslop §19',
    example: '“The superintendent’s notice” went up on a bulletin board.',
  },
  {
    id: 'chatbot-phrase',
    title: 'Chatbot phrase',
    pattern: anyOf(
      /\bI hope this helps\b/gi,
      /\bLet me know if\b/gi,
      /\bOf course[!,]/gi,
      /\bCertainly[!,]/gi,
      /\bFound the smoking gun\b/gi,
    ),
    fix: 'Remove it.',
    source: 'unslop §20',
    example: 'I hope this helps! Let me know if you need anything else.',
  },
  {
    id: 'sycophancy',
    title: 'Sycophantic tone',
    pattern: anyOf(/\bGreat question\b/gi, /\byou(?:'|’)?re absolutely right\b/gi),
    fix: 'Say the thing directly.',
    source: 'unslop §22',
    example: "Great question! You're absolutely right about the notice period.",
  },
  {
    id: 'filler-phrase',
    title: 'Filler phrase',
    pattern: anyWord(FILLER_PHRASES),
    fix: '"In order to" becomes "To"; "due to the fact that" becomes "Because"; "it is important to note that" gets deleted.',
    source: 'unslop §23',
    example:
      'It is important to note that in order to ride, riders wait due to the fact that notice is slow.',
  },
  {
    id: 'excessive-hedging',
    title: 'Excessive hedging',
    pattern: stackedHedges,
    fix: 'One hedge at most: "may".',
    source: 'unslop §24',
    example: 'It could potentially possibly be argued that it might close the trail.',
  },
  {
    id: 'metaphor-noun',
    title: 'Abstract metaphor noun',
    pattern: anyOf(
      anyWord(METAPHOR_NOUNS),
      // The four entries the skill qualifies, kept to the qualified sense.
      /\b(?:a|an|the|these|those|our|its|new)\s+primitives?\b/gi,
      /\bharness(?:es|ing|ed)?\s+the\b/gi,
      /\b(?:api|tool|schema|attack|interface|type|data)\s+surface\b/gi,
      /\bratchet(?:s|ing|ed)?\s+(?:up|down)\b/gi,
    ),
    fix: 'Pick the concrete word: "substrate" becomes "base", "wedge in" becomes "add", "vector" becomes "way".',
    source: 'unslop §26',
    example: 'The substrate is a wedge, and the nexus of the paradigm is our north star.',
  },
  {
    id: 'weak-adverb',
    title: 'Adverb propping up a weak verb',
    pattern: anyWord(WEAK_ADVERBS),
    fix: 'Use a stronger verb or the number: "runs quickly" becomes "is fast" or the measured time.',
    source: 'unslop §30',
    example: 'The notice significantly improves access and the page loads quickly.',
  },
  {
    id: 'plain-word',
    title: 'Fancier synonym where the plain word works',
    pattern: anyWord(PLAIN_SWAPS),
    fix: 'Use the plain word: use (not utilize or leverage), help (not facilitate), many (not numerous), if (not in the event that).',
    source: 'unslop §31',
    example: 'We utilize the trail and leverage numerous routes in the event that it closes.',
  },
];

// ---------------------------------------------------------------------------
// The check
// ---------------------------------------------------------------------------

/**
 * Blank the inside of every double-quoted span (straight or curly) with spaces, keeping every
 * offset. The delimiters themselves stay visible so §19 still sees a curly quote. An unclosed
 * opening quote blanks the rest of the text: while someone is typing a long quotation, silence
 * is the safe answer. Never flags inside a quoted span (docs/PLAIN-WORDS.md).
 */
export function maskQuotedSpans(text: string): string {
  const chars = [...text];
  const blank = (from: number, to: number) => {
    for (let i = from; i < to && i < chars.length; i++) {
      if (chars[i] !== '\n') chars[i] = ' ';
    }
  };
  let open = -1;
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] !== '"') continue;
    if (open < 0) open = i;
    else {
      blank(open + 1, i);
      open = -1;
    }
  }
  if (open >= 0) blank(open + 1, chars.length);
  let curly = -1;
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] === '“') curly = i;
    else if (chars[i] === '”' && curly >= 0) {
      blank(curly + 1, i);
      curly = -1;
    }
  }
  if (curly >= 0) blank(curly + 1, chars.length);
  return chars.join('');
}

/** How much of the person's own text a flag shows on either side of the match. */
const EXCERPT_CONTEXT = 24;

/** How far the window may grow to land on whitespace before it just cuts a long token. */
const EXCERPT_SLACK = 12;

/** A short window of the original text around a match, on whitespace, with … when cut. */
export function excerptAround(text: string, start: number, end: number): string {
  let from = Math.max(0, start - EXCERPT_CONTEXT);
  let to = Math.min(text.length, end + EXCERPT_CONTEXT);
  const floor = Math.max(0, from - EXCERPT_SLACK);
  const ceil = Math.min(text.length, to + EXCERPT_SLACK);
  while (from > floor && /\S/.test(text[from - 1])) from--;
  while (to < ceil && /\S/.test(text[to])) to++;
  const body = text.slice(from, to).replace(/\s+/g, ' ').trim();
  return `${from > 0 ? '…' : ''}${body}${to < text.length ? '…' : ''}`;
}

/** Flags per text, capped so a pathological paste cannot grow an unbounded list. */
export const MAX_FLAGS = 40;

function runPattern(pattern: PlainWordsPattern, masked: string): PlainWordsMatch[] {
  return typeof pattern === 'function' ? pattern(masked) : matchAll(pattern, masked);
}

/**
 * Check one claimant field. Case-insensitive, on word boundaries, never inside a quoted span.
 * Deterministic: same text in, same flags out. Never throws.
 */
export function checkPlainWords(text: string | null | undefined): PlainWordsResult {
  const source = typeof text === 'string' ? text : '';
  if (source.trim() === '') return { flags: [], score: 0 };
  const masked = maskQuotedSpans(source);
  const flags: PlainWordsFlag[] = [];
  const seen = new Set<string>();
  for (const rule of PLAIN_WORDS_RULES) {
    for (const m of runPattern(rule.pattern, masked)) {
      const key = `${rule.id}:${m.start}:${m.end}`;
      if (seen.has(key)) continue;
      seen.add(key);
      flags.push({
        rule_id: rule.id,
        title: rule.title,
        start: m.start,
        end: m.end,
        excerpt: excerptAround(source, m.start, m.end),
        fix: rule.fix,
        source: rule.source,
      });
    }
  }
  flags.sort((a, b) => a.start - b.start || a.end - b.end || a.rule_id.localeCompare(b.rule_id));
  const kept = flags.slice(0, MAX_FLAGS);
  const words = (source.match(/\S+/g) ?? []).length;
  const score = words === 0 ? 0 : Math.round((kept.length / words) * 1000) / 10;
  return { flags: kept, score };
}

/** Flags across several claimant fields. Offsets are relative to the field they came from. */
export function checkPlainWordsFields(
  fields: readonly (string | null | undefined)[],
): PlainWordsFlag[] {
  const out: PlainWordsFlag[] = [];
  for (const field of fields) out.push(...checkPlainWords(field).flags);
  return out.slice(0, MAX_FLAGS);
}

/** The export line under a claim whose fields still have suggestions (docs/PLAIN-WORDS.md 2). */
export function plainWordsExportLine(count: number): string {
  return `[plain words: ${count} suggestions not applied]`;
}

// ---------------------------------------------------------------------------
// The agent-facing guide (docs/PLAIN-WORDS.md 1: ≤600 chars)
// ---------------------------------------------------------------------------

export const PLAIN_WORDS_GUIDE_MAX_CHARS = 600;

/**
 * What an agent should know before drafting a claimant field, from the skill's "Adding soul"
 * and "Plain speech" sections. Kept under 600 chars so it fits in a tool result.
 */
export const PLAIN_WORDS_GUIDE =
  'Write like the person, not a press release. Use "I" when it fits; vary sentence length; ' +
  'one idea per sentence (unslop, Adding soul, §28). Say what the rule does to you, with a ' +
  'number or a place, and name the mechanism, not the feeling (§27). No em dashes, en dashes ' +
  'or " - " (§13). No "not just X, but Y" (§9). Cut filler: "in order to", "it is important ' +
  'to note that" (§23). Plain words: use, not utilize; many, not numerous (§31). One hedge at ' +
  'most (§24). Never change the quote field.';
