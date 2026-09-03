import assert from 'node:assert/strict';
import { test } from 'node:test';

import { APP_NAME } from '../lib/app';
import { CLAIMANT, NOT_VERIFIED, claimLine, disclosureFooter, exportText } from './export';
import type { Claim, Letter, RuleCacheParsed, Signer } from './types';

const NOW = '2026-09-03T14:05:00.000Z';

function letter(over: Partial<Letter> = {}): Letter {
  return {
    id: 'l_abcdefgh',
    document_number: '2026-17902',
    title: 'Bicycle Use in Park Areas',
    agency: 'National Park Service',
    agency_slug: 'national-park-service',
    docket_id: 'NPS-2026-0166',
    regs_document_id: 'NPS-2026-0166-0001',
    comment_url: null,
    html_url: null,
    publication_date: '2026-09-01',
    comments_close_on: '2026-11-02',
    rule_sha256: null,
    rev_no: 3,
    rev_hash: 'f'.repeat(64),
    owner_user_id: null,
    owner_token_hash: null,
    share_code: 'a'.repeat(22),
    public_token: 'b'.repeat(22),
    is_judge_copy: 0,
    created_at: NOW,
    updated_at: NOW,
    ...over,
  };
}

function claim(over: Partial<Claim> = {}): Claim {
  return {
    id: 'c_00000001',
    letter_id: 'l_abcdefgh',
    ord: 1,
    quote: 'The use of bicycles and electric bicycles is allowed in other locations.',
    anchor_start: 40935,
    anchor_end: 41136,
    page: 56101,
    anchor_status: 'anchored',
    position: 'modify',
    assertion: 'Notice can be a bulletin-board posting.',
    requested_change: 'Add a 30-day minimum interval.',
    evidence: '',
    proposed_by: 'agent-of:anon',
    accepted_by: 'human:anon',
    accepted_at: NOW,
    created_at: NOW,
    updated_at: NOW,
    ...over,
  };
}

const signer: Signer = {
  letter_id: 'l_abcdefgh',
  user_id: 'u1',
  display_name: 'Maya Chen',
  impact_text: 'Our club rides these trails.',
  signed_at: '2026-09-03T14:20:00.000Z',
  added_at: NOW,
};

test('claim line: position, page citation, claimant labels, optional evidence', () => {
  const line = claimLine(claim(), 1);
  assert.equal(
    line,
    `1. [Modify] Quoting page 56101: "The use of bicycles and electric bicycles is allowed in other locations." — ${CLAIMANT} Notice can be a bulletin-board posting. Requested change: ${CLAIMANT} Add a 30-day minimum interval.`,
  );
  const withEvidence = claimLine(claim({ evidence: 'Park bulletin, 2025.' }), 2);
  assert.ok(withEvidence.startsWith('2. [Modify]'));
  assert.ok(withEvidence.endsWith(`(Evidence: ${CLAIMANT} Park bulletin, 2025.)`));
  const bare = claimLine(claim({ requested_change: '  ', position: 'support' }), 3);
  assert.ok(bare.startsWith('3. [Support]'));
  assert.ok(!bare.includes('Requested change'));
});

test('unverified quotes are marked and never cite a page', () => {
  const line = claimLine(claim({ anchor_status: 'unverified', page: null, position: 'oppose' }), 1);
  assert.ok(line.includes(`Quoting ${NOT_VERIFIED}:`));
  assert.ok(!line.includes('page'));
});

test('export: header, numbered claims, signers with times and impact, disclosure footer', () => {
  const rule = { fetched_at: '2026-09-03T14:02:00.000Z' } as RuleCacheParsed;
  const text = exportText(letter(), [claim(), claim({ id: 'c_00000002', ord: 2 })], [signer], rule);
  const lines = text.split('\n');
  assert.deepEqual(lines.slice(0, 5), [
    'Public comment on Bicycle Use in Park Areas',
    'Federal Register document 2026-17902',
    'Agency: National Park Service',
    'Docket: NPS-2026-0166',
    'Comments close: 2026-11-02',
  ]);
  assert.ok(lines.some(l => l.startsWith('1. [Modify] Quoting page 56101')));
  assert.ok(lines.some(l => l.startsWith('2. [Modify] Quoting page 56101')));
  assert.ok(lines.includes('Signed by:'));
  assert.ok(lines.includes('- Maya Chen (signed 2026-09-03T14:20:00.000Z)'));
  assert.ok(lines.includes('  Impact: Our club rides these trails.'));
  assert.equal(
    lines.at(-2),
    `Quotes verified against Federal Register document 2026-17902 text fetched 2026-09-03. Prepared with ${APP_NAME}, an agent-assisted drafting tool; filed by a person.`,
  );
  assert.equal(disclosureFooter('2026-17902', '2026-09-03'), lines.at(-2));
  assert.ok(text.endsWith('\n'));
});

test('export: empty letter says so and falls back to the letter date', () => {
  const text = exportText(
    letter({ title: null, document_number: null, docket_id: null }),
    [],
    [],
    null,
  );
  assert.ok(text.includes('Public comment on a rule the government wants to change'));
  assert.ok(text.includes('(no rule attached)'));
  assert.ok(text.includes('(no claims yet)'));
  assert.ok(text.includes('(no signers yet)'));
  assert.ok(text.includes('text fetched 2026-09-03.'));
  assert.ok(text.includes('- Maya (not yet signed)') === false);
});
