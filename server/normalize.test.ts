// Fixture-pinned numbers from PLAN.md 4.2 / Appendix A. If the paragraph sentinel changes the
// length, the sentinel removal is wrong — fix it, do not loosen the test.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { locate, nearest, readPassages } from './anchor';
import { normalizeRule } from './normalize';

const raw = readFileSync(new URL('../test/fixtures/2026-17902.txt', import.meta.url), 'utf8');
const rule = normalizeRule(raw, 'txt');
const { text, pages, first_page } = rule;

export const Q1 =
  'Written determinations for existing trails and for new trails within developed areas must be published in the Federal Register for 30 days of public comment.';
export const Q3 =
  'The use of bicycles and electric bicycles is allowed in other locations designated by the superintendent after notice is provided using one or more of the methods described in Sec. 1.7 of this chapter.';
export const BAD =
  'Written determinations for existing trails must be published in the Federal Register for 60 days of public comment.';

test('fixture: length, first page, page marks, sha256 prefix', () => {
  assert.equal(raw.length, 46328);
  assert.equal(text.length, 44458);
  assert.equal(first_page, 56095);
  assert.deepEqual(pages, [
    { offset: 559, page: 56096 },
    { offset: 8007, page: 56097 },
    { offset: 15592, page: 56098 },
    { offset: 24699, page: 56099 },
    { offset: 32421, page: 56100 },
    { offset: 39700, page: 56101 },
  ]);
  assert.equal(createHash('sha256').update(text).digest('hex').slice(0, 16), 'fc22cd12737d1979');
});

test('fixture: anchors Q1, Q2, Q3 (also with doubled spaces, curly quotes, — and §)', () => {
  const q1 = locate(text, pages, first_page, Q1);
  assert.deepEqual(q1 && [q1.start, q1.end, q1.page, q1.unique], [20073, 20230, 56098, true]);
  const q1b = locate(text, pages, first_page, Q1.replace(/ /g, '  ').replace('30', '30'));
  assert.equal(q1b?.start, 20073);
  const q2 = locate(text, pages, first_page, text.slice(28833, 29088));
  assert.deepEqual(q2 && [q2.start, q2.end, q2.page], [28833, 29088, 56099]);
  assert.ok(text.slice(28833, 29088).startsWith('The superintendent would have authority'));
  assert.ok(text.slice(28833, 29088).endsWith('in two circumstances.'));
  const q3 = locate(text, pages, first_page, Q3);
  assert.deepEqual(q3 && [q3.start, q3.end, q3.page, q3.unique], [40935, 41136, 56101, true]);
  const q3b = locate(text, pages, first_page, Q3.replace('Sec. 1.7', '§ 1.7'));
  assert.equal(q3b?.start, 40935);
  const dash = locate(text, pages, first_page, 'NEPA—both');
  assert.ok(dash, 'em dash quote locates against -- in the text');
});

test('fixture: BAD is not found; nearest passages use trimmed candidates', () => {
  assert.equal(locate(text, pages, first_page, BAD), null);
  const near = nearest(text, pages, first_page, BAD, 3);
  assert.equal(near.length, 3);
  assert.deepEqual([near[0].start, near[0].end, near[0].page], [20073, 20230, 56098]);
  assert.ok(Math.abs(near[0].score - 0.696) <= 0.01, `score ${near[0].score}`);
  assert.equal(near[1].start, 41137);
  assert.equal(near[2].start, 19987);
  assert.equal(near[0].text, Q1);
});

test('fixture: readPassages 30 days', () => {
  const r = readPassages(text, pages, first_page, { query: '30 days' });
  assert.equal(r.matches_total, 5);
  assert.deepEqual(
    [r.passages[0].start, r.passages[0].end, r.passages[0].page],
    [6921, 8121, 56096],
  );
});

test('fixture: toc and breaks', () => {
  const headings = rule.toc.map(t => t.heading);
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
  assert.ok(rule.toc.length <= 16);
  for (const t of rule.toc) {
    const label = t.heading.replace(/--/g, '--');
    assert.ok(
      text.slice(t.start).startsWith(label.split(':')[0]),
      `${t.heading} starts at ${t.start}: ${text.slice(t.start, t.start + 40)}`,
    );
  }
  assert.ok(rule.breaks.length > 40);
  for (const b of rule.breaks) {
    assert.ok(b > 0 && b < text.length);
    assert.notEqual(text[b], ' ');
    assert.equal(text[b - 1], ' ', `break ${b} follows a space`);
  }
  const sorted = [...rule.breaks].sort((a, b) => a - b);
  assert.deepEqual(rule.breaks, sorted);
  assert.equal(new Set(rule.breaks).size, rule.breaks.length);
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
