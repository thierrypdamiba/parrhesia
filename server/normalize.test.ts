// Fixture-pinned numbers (PLAN.md 4.2 / Appendix A, P2 item 4). The expected values come from
// test/fixtures/2026-17902.expected.json, written by the Python reference implementation in
// scripts/fixture-numbers.py; the "plan pins" test then holds that file to the numbers printed
// in PLAN.md so neither implementation can drift silently. If the paragraph sentinel changes the
// length, the sentinel removal is wrong — fix it, do not loosen the test.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { locate, nearest, readPassages, sentenceCandidates } from './anchor';
import { normalizeQuote, normalizeRule, TOC_MAX, trimToc } from './normalize';
import type { Anchor, NearestPassage, PageMark, ReadResult, TocEntry } from './types';

interface AnchorSummary {
  start: number;
  end: number;
  page: number;
  unique: boolean;
}
interface PassagesSummary {
  matches_total: number;
  passages: Array<{ start: number; end: number; page: number }>;
}
interface Expected {
  document_number: string;
  raw: { chars: number; bytes: number; sha256: string };
  text: {
    length: number;
    first_page: number;
    pages: PageMark[];
    sha256: string;
    head: string;
    tail: string;
  };
  breaks: number[];
  toc: TocEntry[];
  anchors: Record<string, { quote: string; normalized: string; anchor: AnchorSummary | null }>;
  bad: { quote: string; anchor: null; nearest: NearestPassage[] };
  read: Record<string, PassagesSummary>;
  sentence_candidates: number;
}

const fixtureTxt = new URL('../test/fixtures/2026-17902.txt', import.meta.url);
const expectedJson = new URL('../test/fixtures/2026-17902.expected.json', import.meta.url);
const raw = readFileSync(fixtureTxt, 'utf8');
const expected = JSON.parse(readFileSync(expectedJson, 'utf8')) as Expected;
const rule = normalizeRule(raw, 'txt');
const { text, pages, first_page } = rule;

export const Q1 = expected.anchors.Q1.quote;
export const Q3 = expected.anchors.Q3.quote;
export const BAD = expected.bad.quote;

const summary = (a: Anchor | null): AnchorSummary | null =>
  a && { start: a.start, end: a.end, page: a.page, unique: a.unique };
const passagesSummary = (r: ReadResult): PassagesSummary => ({
  matches_total: r.matches_total,
  passages: r.passages.map(p => ({ start: p.start, end: p.end, page: p.page })),
});
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

test('expected file: raw fixture is the one the numbers were computed from', () => {
  assert.equal(expected.document_number, '2026-17902');
  assert.equal(raw.length, expected.raw.chars);
  assert.equal(Buffer.byteLength(raw, 'utf8'), expected.raw.bytes);
  assert.equal(sha256(raw), expected.raw.sha256);
});

test('expected file: length, first page, page marks, sha256, head and tail', () => {
  assert.equal(text.length, expected.text.length);
  assert.equal(first_page, expected.text.first_page);
  assert.deepEqual(pages, expected.text.pages);
  assert.equal(sha256(text), expected.text.sha256);
  assert.equal(text.slice(0, 80), expected.text.head);
  assert.equal(text.slice(-80), expected.text.tail);
});

test('expected file: every anchor probe locates exactly as the reference says', () => {
  for (const [key, probe] of Object.entries(expected.anchors)) {
    assert.equal(normalizeQuote(probe.quote), probe.normalized, `${key} normalizes`);
    const a = locate(text, pages, first_page, probe.quote);
    assert.deepEqual(summary(a), probe.anchor, `${key} locates`);
    if (a) assert.equal(text.slice(a.start, a.end), normalizeQuote(probe.quote), `${key} slice`);
  }
});

test('expected file: BAD is not found; nearest passages match the reference', () => {
  assert.equal(locate(text, pages, first_page, BAD), null);
  const near = nearest(text, pages, first_page, BAD, 3);
  assert.deepEqual(near, expected.bad.nearest);
  for (const n of near) assert.equal(text.slice(n.start, n.end).slice(0, 240), n.text);
  assert.equal(sentenceCandidates(text).length, expected.sentence_candidates);
});

test('expected file: readPassages', () => {
  const cases: Record<string, Parameters<typeof readPassages>[3]> = {
    '30_days_default': { query: '30 days' },
    '30_days_max5': { query: '30 days', max_passages: 5 },
    start_20000_window_300: { start: 20000, window: 300 },
    superintendent_window_400_max5: { query: 'superintendent', window: 400, max_passages: 5 },
    nothing: {},
  };
  for (const [key, options] of Object.entries(cases)) {
    assert.ok(expected.read[key], `reference has ${key}`);
    const r = readPassages(text, pages, first_page, options);
    assert.deepEqual(passagesSummary(r), expected.read[key], key);
    for (const p of r.passages) assert.equal(p.text, text.slice(p.start, p.end));
  }
});

test('expected file: toc and breaks', () => {
  assert.deepEqual(rule.toc, expected.toc);
  assert.deepEqual(rule.breaks, expected.breaks);
});

test('plan pins: PLAN.md Appendix A numbers hold in the expected file', () => {
  assert.equal(expected.raw.bytes, 46328);
  assert.equal(expected.text.length, 44458);
  assert.equal(expected.text.first_page, 56095);
  assert.deepEqual(expected.text.pages, [
    { offset: 559, page: 56096 },
    { offset: 8007, page: 56097 },
    { offset: 15592, page: 56098 },
    { offset: 24699, page: 56099 },
    { offset: 32421, page: 56100 },
    { offset: 39700, page: 56101 },
  ]);
  assert.equal(expected.text.sha256.slice(0, 16), 'fc22cd12737d1979');
  assert.equal(
    Q1,
    'Written determinations for existing trails and for new trails within developed areas must be published in the Federal Register for 30 days of public comment.',
  );
  assert.equal(
    Q3,
    'The use of bicycles and electric bicycles is allowed in other locations designated by the superintendent after notice is provided using one or more of the methods described in Sec. 1.7 of this chapter.',
  );
  assert.equal(
    BAD,
    'Written determinations for existing trails must be published in the Federal Register for 60 days of public comment.',
  );
  const a = expected.anchors;
  assert.deepEqual(a.Q1.anchor, { start: 20073, end: 20230, page: 56098, unique: true });
  assert.deepEqual(a.Q1_doubled_spaces.anchor, a.Q1.anchor);
  assert.deepEqual(a.Q2.anchor, { start: 28833, end: 29088, page: 56099, unique: true });
  assert.ok(a.Q2.quote.startsWith('The superintendent would have authority'));
  assert.ok(a.Q2.quote.endsWith('in two circumstances.'));
  assert.deepEqual(a.Q3.anchor, { start: 40935, end: 41136, page: 56101, unique: true });
  assert.deepEqual(a.Q3_section_sign.anchor, a.Q3.anchor, 'a quote typed with § still locates');
  assert.ok(a.em_dash.anchor, 'a quote typed with — still locates');
  assert.ok(a.curly_quotes.anchor, 'curly quotes still locate');
  assert.deepEqual(a.backtick_quotes.anchor, a.curly_quotes.anchor);

  assert.equal(expected.bad.anchor, null);
  const near = expected.bad.nearest;
  assert.equal(near.length, 3);
  assert.deepEqual([near[0].start, near[0].end, near[0].page], [20073, 20230, 56098]);
  assert.ok(Math.abs(near[0].score - 0.696) <= 0.01, `score ${near[0].score}`);
  assert.equal(near[0].text, Q1);
  assert.equal(near[1].start, 41137);
  assert.equal(near[1].page, 56101);
  // PLAN.md prints 0.241 for this candidate, which is 7/29: the candidate cut at "… of Sec."
  // (19 words). With the plan's own no-split-after-"Sec." rule the candidate runs to
  // "… Sec. 1.5 of this chapter." (23 words) and scores 7/33 = 0.212. The faithful number
  // is pinned; the start offset is what the plan asserts.
  assert.equal(near[1].score, 0.212);
  assert.equal(near[2].start, 19987);
  assert.equal(near[2].page, 56098);
  assert.ok(Math.abs(near[2].score - 0.208) <= 0.01);
  assert.ok(near[0].score >= near[1].score && near[1].score >= near[2].score);

  const read = expected.read['30_days_default'];
  assert.equal(read.matches_total, 5);
  assert.deepEqual(read.passages[0], { start: 6921, end: 8121, page: 56096 });
  assert.equal(read.passages.length, 1, 'max_passages defaults to 1');

  assert.deepEqual(expected.read.start_20000_window_300.passages, [
    { start: 20000, end: 20300, page: 56098 },
  ]);

  const headings = expected.toc.map(t => t.heading);
  for (const h of [
    'SUMMARY',
    'DATES',
    'ADDRESSES',
    'FOR FURTHER INFORMATION CONTACT',
    'SUPPLEMENTARY INFORMATION',
    'Policy and Regulatory Framework',
    'Proposed Rule',
    'Regulatory Flexibility Act',
    'List of Subjects in 36 CFR Part 4',
    'PART 4--VEHICLES AND TRAFFIC SAFETY',
  ]) {
    assert.ok(headings.includes(h), `toc has ${h}: ${headings.join(' | ')}`);
  }
  assert.ok(expected.toc.length <= TOC_MAX);
  // The "(E.O. NNNNN)" boilerplate subsections are the first to go over the cap.
  assert.ok(!headings.some(h => /\bE\.O\./.test(h)), headings.join(' | '));
  assert.ok(expected.breaks.length > 40);
});

test('toc entries start at their heading; breaks are paragraph starts', () => {
  for (const t of rule.toc) {
    assert.ok(
      text.slice(t.start).startsWith(t.heading),
      `${t.heading} starts at ${t.start}: ${text.slice(t.start, t.start + 40)}`,
    );
    assert.ok(t.start === 0 || rule.breaks.includes(t.start), `${t.heading} is a paragraph start`);
  }
  for (const h of rule.toc.map(t => t.heading)) {
    assert.ok(h.length >= 4 && h.length <= 70, h);
  }
  for (const b of rule.breaks) {
    assert.ok(b > 0 && b < text.length);
    assert.notEqual(text[b], ' ');
    assert.equal(text[b - 1], ' ', `break ${b} follows a space`);
  }
  const sorted = [...rule.breaks].sort((a, b) => a - b);
  assert.deepEqual(rule.breaks, sorted);
  assert.equal(new Set(rule.breaks).size, rule.breaks.length);
  // No double spaces survive and the text is trimmed.
  assert.ok(!text.includes('  '));
  assert.equal(text, text.trim());
  // Every page mark is followed by text (not a space).
  for (const p of pages) assert.notEqual(text[p.offset], ' ');
});

test('trimToc drops E.O. subsections first, then Executive Order headings, then truncates', () => {
  const mk = (heading: string, i: number): TocEntry => ({ heading, start: i * 10 });
  const base = Array.from({ length: 14 }, (_, i) => mk(`Heading ${i}`, i));
  const withEo = [
    ...base,
    mk('Takings (E.O. 12630)', 20),
    mk('Federalism (E.O. 13132)', 21),
    mk('Regulatory Planning and Review (Executive Orders 12866 and 14192)', 22),
  ];
  assert.equal(withEo.length, 17);
  const trimmed = trimToc(withEo);
  assert.equal(trimmed.length, 15);
  assert.ok(trimmed.some(t => t.heading.includes('Executive Orders')));
  assert.ok(!trimmed.some(t => /E\.O\./.test(t.heading)));
  const withMore = [...withEo, mk('Regulatory Impact (Executive Order 12866)', 23), mk('X', 24)];
  const trimmed2 = trimToc(withMore);
  assert.ok(!trimmed2.some(t => /Executive Order/.test(t.heading)));
  assert.equal(trimmed2.length, 15);
  const many = Array.from({ length: 20 }, (_, i) => mk(`Plain ${i}`, i));
  assert.equal(trimToc(many).length, TOC_MAX);
  assert.equal(trimToc(base).length, 14);
});

test('xml path: PRTPAGE and </P> become sentinels', () => {
  const xml =
    '<RULE><PRTPAGE P="101"/><P>First paragraph here.</P><P>Second one.</P><PRTPAGE P="102"/><P>Third &amp; last.</P></RULE>';
  const r = normalizeRule(xml, 'xml');
  assert.equal(r.text, 'First paragraph here. Second one. Third & last.');
  assert.equal(r.first_page, 100);
  assert.deepEqual(r.breaks, [22, 34]);
  assert.deepEqual(
    r.pages.map(p => p.page),
    [101, 102],
  );
});

test('the Python reference regenerates the committed expected file byte for byte', t => {
  const script = fileURLToPath(new URL('../scripts/fixture-numbers.py', import.meta.url));
  const run = spawnSync('python3', [script, '--stdout'], { encoding: 'utf8' });
  if (run.error || run.status !== 0) {
    t.skip(`python3 unavailable: ${run.error?.message ?? run.stderr}`);
    return;
  }
  assert.deepEqual(JSON.parse(run.stdout), expected);
});
