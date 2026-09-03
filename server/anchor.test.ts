import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  jaccard,
  locate,
  nearest,
  pageAt,
  readPassages,
  sentenceCandidates,
  wordSet,
} from './anchor';
import { normalizeQuote } from './normalize';
import type { PageMark } from './types';

const P1 =
  'Written determinations for existing trails must be published in the Federal Register for 30 days of public comment.';
const P2 = 'The superintendent would have authority to designate routes in two circumstances.';
const P3 =
  'The use of bicycles is allowed in other locations designated by the superintendent after notice is provided using one or more of the methods described in Sec. 1.7 of this chapter.';
const TEXT = `An opening sentence about parks and trails that is long enough. ${P1} ${P2} See 16 U.S.C. 1 and Sec. 4.30 for details. ${P3} Comments close soon.`;
const PAGES: PageMark[] = [
  { offset: TEXT.indexOf(P2), page: 56098 },
  { offset: TEXT.indexOf(P3), page: 56099 },
];
const FIRST_PAGE = 56097;

test('pageAt walks the page marks', () => {
  assert.equal(pageAt(PAGES, FIRST_PAGE, 0), 56097);
  assert.equal(pageAt(PAGES, FIRST_PAGE, TEXT.indexOf(P2)), 56098);
  assert.equal(pageAt(PAGES, FIRST_PAGE, TEXT.length - 1), 56099);
  assert.equal(pageAt([], FIRST_PAGE, 500), FIRST_PAGE);
});

test('normalizeQuote maps quotes, spaces, dashes, § and footnote markers', () => {
  assert.equal(normalizeQuote('  “Hello”  ‘there’ —  now '), '"Hello" \'there\' -- now');
  assert.equal(normalizeQuote("``quoted'' text"), '"quoted" text');
  assert.equal(normalizeQuote('see §1.7 and § 4.30'), 'see Sec. 1.7 and Sec. 4.30');
  assert.equal(normalizeQuote('marker\\1\\ here'), 'marker here');
  assert.equal(normalizeQuote('a\n\n  b\tc'), 'a b c');
});

test('locate finds exact substrings after normalization, with page and uniqueness', () => {
  const a = locate(TEXT, PAGES, FIRST_PAGE, P1);
  assert.ok(a);
  assert.equal(a.start, TEXT.indexOf(P1));
  assert.equal(a.end, a.start + P1.length);
  assert.equal(a.page, 56097);
  assert.equal(a.unique, true);
  assert.equal(a.occurrences.length, 1);

  const curly = locate(TEXT, PAGES, FIRST_PAGE, 'described in §  1.7 of this   chapter');
  assert.ok(curly);
  assert.equal(TEXT.slice(curly.start, curly.end), 'described in Sec. 1.7 of this chapter');
  assert.equal(curly.page, 56099);

  assert.equal(locate(TEXT, PAGES, FIRST_PAGE, 'for 60 days of public comment'), null);
  assert.equal(locate(TEXT, PAGES, FIRST_PAGE, '   '), null);

  const dup = locate('ab ab ab ab ab ab ab', [], 1, 'ab');
  assert.ok(dup);
  assert.equal(dup.unique, false);
  assert.equal(dup.occurrences.length, 5, 'occurrences capped at 5');
});

test('sentenceCandidates trims, honours the abbreviation list and the minimum length', () => {
  const cands = sentenceCandidates(TEXT);
  for (const c of cands) {
    assert.equal(TEXT.slice(c.start, c.end), c.text);
    assert.ok(c.text.length >= 40);
    assert.ok(!/^\s/.test(c.text) && !/\s$/.test(c.text));
  }
  const merged = cands.find(c => c.text.includes('U.S.C. 1 and Sec. 4.30'));
  assert.ok(merged, 'no split after U.S.C. or Sec.');
  assert.ok(cands.some(c => c.text === P1));
});

test('nearest ranks the closest sentence first with a 3dp Jaccard score', () => {
  const bad =
    'Written determinations for existing trails must be published in the Federal Register for 60 days of public comment.';
  const near = nearest(TEXT, PAGES, FIRST_PAGE, bad, 3);
  assert.equal(near.length, 3);
  assert.equal(near[0].start, TEXT.indexOf(P1));
  assert.equal(near[0].end, TEXT.indexOf(P1) + P1.length);
  assert.equal(near[0].page, 56097);
  assert.ok(near[0].score > 0.8 && near[0].score < 1);
  assert.equal(near[0].score, Math.round(near[0].score * 1000) / 1000);
  assert.ok(near[0].score >= near[1].score && near[1].score >= near[2].score);
  assert.equal(jaccard(wordSet('a b c'), wordSet('b c d')), 0.5);
  assert.equal(jaccard(new Set(), new Set()), 0);
});

test('readPassages by query: lead of floor(window/3), overlap de-dup, matches_total', () => {
  const r = readPassages(TEXT, PAGES, FIRST_PAGE, {
    query: 'SUPERINTENDENT',
    window: 300,
    max_passages: 5,
  });
  assert.equal(r.matches_total, 2);
  assert.equal(r.passages.length, 1, 'second match overlaps the first window');
  const first = r.passages[0];
  assert.equal(first.start, Math.max(0, TEXT.toLowerCase().indexOf('superintendent') - 100));
  assert.equal(first.end, Math.min(TEXT.length, first.start + 300));
  assert.equal(first.text, TEXT.slice(first.start, first.end));

  const one = readPassages(TEXT, PAGES, FIRST_PAGE, {
    query: 'superintendent',
    window: 200,
    max_passages: 1,
  });
  assert.equal(one.passages.length, 1);
  assert.equal(one.matches_total, 2);

  const none = readPassages(TEXT, PAGES, FIRST_PAGE, { query: 'zzz not here' });
  assert.deepEqual(none, { passages: [], matches_total: 0 });
});

test('readPassages by start and by nothing', () => {
  const byStart = readPassages(TEXT, PAGES, FIRST_PAGE, { start: 10, window: 200 });
  assert.equal(byStart.passages.length, 1);
  assert.equal(byStart.passages[0].start, 10);
  assert.equal(byStart.passages[0].end, Math.min(TEXT.length, 210));
  assert.equal(byStart.matches_total, 0);

  const fromZero = readPassages(TEXT, PAGES, FIRST_PAGE);
  assert.equal(fromZero.passages[0].start, 0);
  assert.equal(fromZero.passages[0].end, Math.min(TEXT.length, 1200));

  // window is clamped to 200..1500 and total text to 4500 chars.
  const big = 'word '.repeat(3000);
  const many = readPassages(big, [], 1, { query: 'word', window: 5000, max_passages: 5 });
  const total = many.passages.reduce((n, p) => n + (p.end - p.start), 0);
  assert.ok(total <= 4500);
  assert.ok(many.passages.every(p => p.end - p.start <= 1500));
});

test('sentenceCandidates: the abbreviation list is matched as whole tokens', () => {
  const caps =
    'THIS HEADING IS ALL CAPS AND ENDS IN FEDERAL. The next sentence stands on its own here.';
  const c1 = sentenceCandidates(caps);
  assert.equal(c1.length, 2, 'FEDERAL. is not the abbreviation L.');
  assert.equal(c1[0].text, 'THIS HEADING IS ALL CAPS AND ENDS IN FEDERAL.');

  const eo =
    'The order is described in Takings (E.O. 12630) and it applies to every park unit here.';
  const c2 = sentenceCandidates(eo);
  assert.equal(c2.length, 1, 'no split after (E.O.');
  assert.equal(c2[0].text, eo);

  const pubL =
    'This was enacted by Pub. L. 116-152 and it changed the statute in several ways here.';
  assert.equal(sentenceCandidates(pubL).length, 1, 'no split after Pub. or L.');
});
