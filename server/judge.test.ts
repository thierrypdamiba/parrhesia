import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { locate } from './anchor';
import { sha256Hex } from './identity';
import {
  JUDGE_AGENT_ACTOR,
  SEED,
  SEED_DOCUMENT_NUMBER,
  SEED_EXPECTED,
  normalizeSeed,
  refusalSummary,
  seedDetail,
  seedRawText,
  seedVerdicts,
} from './judge';
import type { RuleCacheParsed } from './types';

function seedRule(): RuleCacheParsed {
  const n = normalizeSeed();
  return {
    document_number: SEED_DOCUMENT_NUMBER,
    title: 'Bicycle Use in Park Areas',
    agency: 'National Park Service',
    comments_close_on: '2026-11-02',
    text: n.text,
    text_sha256: '',
    first_page: n.first_page,
    pages: n.pages,
    breaks: n.breaks,
    toc: n.toc,
    source_url: null,
    source_kind: 'seed',
    fetched_at: '2026-09-03T00:00:00.000Z',
    detail_json: null,
  };
}

test('seed spec has the P6 shape: 3 claims (modify, support, oppose) and 1 pending claim', () => {
  assert.equal(SEED.document_number, '2026-17902');
  assert.equal(SEED.claims.length, 3);
  assert.deepEqual(
    SEED.claims.map(c => c.position),
    ['modify', 'support', 'oppose'],
  );
  assert.equal(SEED.claims[2].requested_change, '');
  assert.equal(SEED.pending.length, 1);
  assert.equal(SEED.pending[0].kind, 'claim');
  assert.equal(SEED.pending[0].position, 'support');
  for (const c of [...SEED.claims, ...SEED.pending]) {
    assert.ok(c.quote.length >= 20 && c.quote.length <= 600, 'quote within tool limits');
    assert.ok(c.assertion.length >= 20 && c.assertion.length <= 600, 'assertion within limits');
    assert.ok(c.requested_change.length <= 400);
  }
  assert.equal(JUDGE_AGENT_ACTOR, 'agent-of:Judge demo');
});

test('seed snapshot is the fixture byte-for-byte and normalizes to the Appendix A numbers', async () => {
  const fixtureTxt = readFileSync(
    new URL('../test/fixtures/2026-17902.txt', import.meta.url),
    'utf8',
  );
  assert.equal(seedRawText(), fixtureTxt);
  const fixtureJson = JSON.parse(
    readFileSync(new URL('../test/fixtures/2026-17902.json', import.meta.url), 'utf8'),
  );
  assert.deepEqual(seedDetail(), fixtureJson);
  assert.equal(seedDetail().document_number, '2026-17902');
  const n = normalizeSeed();
  assert.equal(n.text.length, SEED_EXPECTED.text_length);
  assert.equal(n.first_page, 56095);
  assert.equal((await sha256Hex(n.text)).slice(0, 16), SEED_EXPECTED.sha256_prefix);
});

test('seed claims anchor exactly where the judge banner says (1: p.56101, 2: p.56098, 3: refused)', () => {
  const rule = seedRule();
  const [c1, c2, c3] = seedVerdicts(rule, SEED.claims);
  assert.deepEqual(
    { start: c1.anchor?.start, end: c1.anchor?.end, page: c1.anchor?.page },
    SEED_EXPECTED.claim1,
  );
  assert.equal(c1.anchor?.unique, true);
  assert.deepEqual(
    { start: c2.anchor?.start, end: c2.anchor?.end, page: c2.anchor?.page },
    SEED_EXPECTED.claim2,
  );
  assert.equal(c2.anchor?.unique, true);
  assert.equal(c3.anchor, null);
  assert.equal(c3.nearest.length, 3);
  assert.equal(c3.nearest[0].start, SEED_EXPECTED.bad_nearest_start);
  assert.equal(c3.nearest[0].page, 56098);
  assert.ok(Math.abs(c3.nearest[0].score - 0.696) < 0.01);
  assert.equal(c3.nearest[1].start, 41137);
  assert.equal(c3.nearest[2].start, 19987);
});

test('the pending seed proposal anchors at 28833–29088 p. 56099', () => {
  const rule = seedRule();
  const a = locate(rule.text, rule.pages, rule.first_page, SEED.pending[0].quote);
  assert.ok(a);
  assert.deepEqual({ start: a.start, end: a.end, page: a.page }, SEED_EXPECTED.pending);
  assert.equal(a.unique, true);
});

test('refusalSummary names the word count and the three nearest passages', () => {
  const rule = seedRule();
  const [, , c3] = seedVerdicts(rule, SEED.claims);
  const s = refusalSummary(c3.claim.quote, c3.nearest);
  assert.match(
    s,
    /^ANCHOR_NOT_FOUND refused a \d+-word quote; 3 nearest passages returned: p\. 56098 20073–20230/,
  );
  assert.ok(s.length <= 200, `activity summary fits the 200-char column (${s.length})`);
});
