// Pure-module tests for the letter domain (PLAN.md P3): hash determinism, canonical ordering,
// word diff, changed_since attribution, validators. D1 routes are exercised by
// scripts/api-walkthrough.sh against a dev server.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { HttpError } from './http';
import {
  actorFor,
  actorLabel,
  buildSnapshot,
  canonicalJson,
  computeMissing,
  diffSnapshots,
  hashSnapshot,
  isRev,
  newId,
  newLinkToken,
  requireAnchor,
  requireHold,
  requireOpen,
  shortRev,
  wordDiff,
} from './letter';
import type { Claim, Letter, RuleCacheParsed, Signer, Snapshot, Viewer } from './types';

const NOW = '2026-09-03T14:05:00.000Z';

function claim(over: Partial<Claim>): Claim {
  return {
    id: 'c_aaaaaaaa',
    letter_id: 'l_x',
    ord: 1,
    quote: 'q'.repeat(20),
    anchor_start: 1,
    anchor_end: 21,
    page: 56095,
    anchor_status: 'anchored',
    position: 'support',
    assertion: 'a'.repeat(20),
    requested_change: 'change it',
    evidence: '',
    proposed_by: null,
    accepted_by: null,
    accepted_at: null,
    created_at: NOW,
    updated_at: NOW,
    ...over,
  };
}
function signer(over: Partial<Signer>): Signer {
  return {
    letter_id: 'l_x',
    user_id: 'u',
    display_name: 'Signer',
    impact_text: null,
    signed_at: null,
    added_at: NOW,
    ...over,
  };
}
function letter(over: Partial<Letter> = {}): Letter {
  return {
    id: 'l_x',
    document_number: '2026-17902',
    title: 't',
    agency: 'a',
    agency_slug: null,
    docket_id: null,
    regs_document_id: null,
    comment_url: null,
    html_url: null,
    publication_date: null,
    comments_close_on: '2999-01-01',
    rule_sha256: null,
    rev_no: 1,
    rev_hash: 'f'.repeat(64),
    owner_user_id: null,
    owner_token_hash: null,
    share_code: 's',
    public_token: 'p',
    is_judge_copy: 0,
    created_at: NOW,
    updated_at: NOW,
    ...over,
  };
}

test('ids and link tokens have the contract shapes', () => {
  assert.match(newId('l_'), /^l_[a-z0-9]{8}$/);
  assert.match(newId('c_'), /^c_[a-z0-9]{8}$/);
  assert.match(newId('p_'), /^p_[a-z0-9]{8}$/);
  assert.match(newLinkToken(), /^[a-z2-7]{22}$/);
  assert.notEqual(newLinkToken(), newLinkToken());
});

test('canonical snapshot: exact key order, claims by ord then id, signers by user_id', () => {
  const snap = buildSnapshot(
    '2026-17902',
    [
      claim({ id: 'c_bbbbbbbb', ord: 2, proposed_by: 'agent-of:anon' }),
      claim({ id: 'c_zzzzzzzz', ord: 1 }),
      claim({ id: 'c_aaaaaaaa', ord: 1 }),
    ],
    [
      signer({ user_id: 'u2', display_name: 'Zed' }),
      signer({ user_id: 'u1', display_name: 'Amy' }),
    ],
  );
  assert.deepEqual(Object.keys(snap), ['document_number', 'claims', 'signers']);
  assert.deepEqual(
    snap.claims.map(c => c.id),
    ['c_aaaaaaaa', 'c_zzzzzzzz', 'c_bbbbbbbb'],
  );
  assert.deepEqual(Object.keys(snap.claims[0]), [
    'id',
    'ord',
    'quote',
    'anchor_start',
    'anchor_end',
    'page',
    'anchor_status',
    'position',
    'assertion',
    'requested_change',
    'evidence',
  ]);
  assert.deepEqual(
    snap.signers.map(s => s.user_id),
    ['u1', 'u2'],
  );
  assert.deepEqual(Object.keys(snap.signers[0]), [
    'user_id',
    'display_name',
    'impact_text',
    'signed_at',
  ]);
  // Row-only columns (proposed_by, accepted_at, letter_id, added_at) never reach the hash.
  assert.ok(!canonicalJson(snap).includes('proposed_by'));
  assert.ok(!canonicalJson(snap).includes('added_at'));
});

test('rev_hash is deterministic, order-independent, 64 hex; base_rev is its 12-hex prefix', async () => {
  const a = buildSnapshot(
    '2026-17902',
    [claim({ id: 'c_1', ord: 1 }), claim({ id: 'c_2', ord: 2 })],
    [],
  );
  const b = buildSnapshot(
    '2026-17902',
    [claim({ id: 'c_2', ord: 2 }), claim({ id: 'c_1', ord: 1 })],
    [],
  );
  const ha = await hashSnapshot(a);
  const hb = await hashSnapshot(b);
  assert.equal(ha, hb);
  assert.match(ha, /^[a-f0-9]{64}$/);
  assert.equal(shortRev(ha).length, 12);
  assert.ok(isRev(shortRev(ha)));
  assert.ok(!isRev(ha));
  assert.ok(!isRev('ABCDEF012345'));
  const empty = await hashSnapshot(buildSnapshot(null, [], []));
  assert.equal(empty, await hashSnapshot(buildSnapshot(null, [], [])));
  assert.notEqual(empty, ha);
  const edited = await hashSnapshot(
    buildSnapshot(
      '2026-17902',
      [claim({ id: 'c_1', ord: 1, assertion: 'b'.repeat(20) }), claim({ id: 'c_2', ord: 2 })],
      [],
    ),
  );
  assert.notEqual(edited, ha);
});

test('word diff is an LCS: removed and added words only', () => {
  assert.deepEqual(wordDiff('keep a 30 day interval', 'keep a 60 day minimum interval'), {
    removed: ['30'],
    added: ['60', 'minimum'],
  });
  assert.deepEqual(wordDiff('same text', 'same text'), { removed: [], added: [] });
  assert.deepEqual(wordDiff('', 'new words'), { removed: [], added: ['new', 'words'] });
  assert.deepEqual(wordDiff('gone', ''), { removed: ['gone'], added: [] });
});

test('changed_since attribution names claim, field and the revision actor', () => {
  const before: Snapshot = buildSnapshot(
    '2026-17902',
    [claim({ id: 'c_1', ord: 1 })],
    [signer({ user_id: 'u1', display_name: 'Maya' })],
  );
  const after: Snapshot = buildSnapshot(
    '2026-17902',
    [claim({ id: 'c_1', ord: 1, assertion: 'z'.repeat(20) }), claim({ id: 'c_2', ord: 2 })],
    [
      signer({ user_id: 'u1', display_name: 'Maya', impact_text: 'x', signed_at: NOW }),
      signer({ user_id: 'u2', display_name: 'Sam' }),
    ],
  );
  const changes = diffSnapshots(before, after, 'human:Maya');
  assert.deepEqual(
    changes.map(c => [c.claim_id, c.field, c.by]),
    [
      ['c_1', 'assertion', 'human:Maya'],
      ['c_2', 'claim', 'human:Maya'],
      [null, 'impact', 'human:Maya'],
      [null, 'signature', 'human:Maya'],
      [null, 'signer', 'human:Maya'],
    ],
  );
  assert.equal(changes[1].summary, 'added claim c_2');
  assert.equal(changes[4].summary, 'Sam joined as a signer');
  const deleted = diffSnapshots(after, before, 'agent-of:Maya');
  assert.ok(deleted.some(c => c.summary === 'deleted claim c_2'));
  assert.ok(deleted.some(c => c.summary === 'Sam was removed as a signer'));
  assert.deepEqual(diffSnapshots(before, before, 'human:anon'), []);
});

test('actors: agent-of vs human, anon when signed out; labels for prose', () => {
  const maya: Viewer = { user_id: 'u1', display_name: 'Maya', signed_in: true, owner_token: 't' };
  const anon: Viewer = {
    user_id: null,
    display_name: 'Signer',
    signed_in: false,
    owner_token: 't',
  };
  assert.equal(actorFor(maya, true), 'agent-of:Maya');
  assert.equal(actorFor(maya, false), 'human:Maya');
  assert.equal(actorFor(anon, true), 'agent-of:anon');
  assert.equal(actorFor(anon, false), 'human:anon');
  assert.equal(actorLabel('agent-of:Maya'), "Maya's agent");
  assert.equal(actorLabel('human:Maya'), 'Maya');
  assert.equal(actorLabel('agent-of:anon'), 'an agent');
  assert.equal(actorLabel('human:anon'), 'someone');
});

function throws(fn: () => unknown, status: number, error: string): HttpError {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof HttpError, 'HttpError expected');
    assert.equal(err.status, status);
    assert.equal(err.body.error, error);
    return err;
  }
  assert.fail('expected a throw');
}

test('validators: hold ≥ 700 ms, comment period open', () => {
  assert.equal(requireHold(700), 700);
  assert.equal(requireHold('812'), 812);
  throws(() => requireHold(699), 400, 'HOLD_REQUIRED');
  throws(() => requireHold(undefined), 400, 'HOLD_REQUIRED');
  requireOpen(letter({ comments_close_on: '2999-01-01' }));
  const err = throws(
    () => requireOpen(letter({ comments_close_on: '2020-01-01' })),
    409,
    'COMMENTS_CLOSED',
  );
  assert.equal(err.body.comments_close_on, '2020-01-01');
});

test('requireAnchor: exact substring, ANCHOR_NOT_FOUND with 3 nearest, ANCHOR_AMBIGUOUS', () => {
  const s1 =
    'Written determinations for existing trails must be published for 30 days of public comment.';
  const s2 = 'The superintendent would have authority to designate routes in two circumstances.';
  const dup = 'This exact sentence appears twice in the rule text for the test.';
  const text = `${s1} ${s2} ${dup} Some other filler sentence that is long enough to count. ${dup}`;
  const rule = { text, pages: [], first_page: 56095 } as unknown as RuleCacheParsed;
  const anchor = requireAnchor(
    rule,
    '  Written  determinations for existing trails must be published for 30 days of public comment. ',
  );
  assert.deepEqual(
    [anchor.start, anchor.end, anchor.page, anchor.unique],
    [0, s1.length, 56095, true],
  );
  const nf = throws(
    () =>
      requireAnchor(
        rule,
        'Written determinations for existing trails must be published for 60 days of public comment.',
      ),
    422,
    'ANCHOR_NOT_FOUND',
  );
  const nearest = nf.body.nearest as Array<{ start: number; score: number }>;
  assert.equal(nearest.length, 3);
  assert.equal(nearest[0].start, 0);
  assert.ok(nearest[0].score > nearest[1].score);
  const amb = throws(() => requireAnchor(rule, dup), 422, 'ANCHOR_AMBIGUOUS');
  assert.equal((amb.body.occurrences as unknown[]).length, 2);
});

test('missing-before-filing checklist', () => {
  assert.deepEqual(computeMissing(letter({ document_number: null }), [], []), [
    'attach a rule',
    'at least one claim',
    'no signer yet (optional: sign in and add yourself)',
  ]);
  const m = computeMissing(
    letter(),
    [claim({ anchor_status: 'unverified' }), claim({ id: 'c_2', ord: 2, requested_change: '' })],
    [signer({ display_name: 'Maya' })],
  );
  assert.deepEqual(m, [
    'claim 1 quote is not in the rule text',
    'claim 2 has no requested change',
    'Maya has not signed',
  ]);
  assert.deepEqual(
    computeMissing(letter(), [claim({})], [signer({ display_name: 'Maya', signed_at: NOW })]),
    [],
  );
  assert.ok(
    computeMissing(letter({ comments_close_on: '2020-01-01' }), [claim({})], []).some(x =>
      x.startsWith('comment period closed'),
    ),
  );
});
