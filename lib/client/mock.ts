// DEV-ONLY in-browser implementation of the letters contract (docs/API.md P3 + P6), enabled by
// NEXT_PUBLIC_DOCKET_MOCK=1. It exists so lane C can exercise the workspace before lane B's
// routes land; it is never bundled otherwise (lazy import in lib/client/api.ts). Rules, meta and
// text come from the real /api/rules routes; identity from the real /api/me; verification runs
// the real server/anchor.ts (pure). State lives in localStorage.

import { locate, nearest } from '@/server/anchor';
import type {
  ActivityLine,
  Anchor,
  Claim,
  ClaimField,
  ClaimProposalPayload,
  EditProposalPayload,
  ImpactProposalPayload,
  LetterState,
  NearestPassage,
  PendingProposal,
  Position,
  ProposalKind,
  ProposalStatus,
  RuleHeader,
  StateResponse,
  StateSigner,
  WordDiff,
} from '@/server/types';
import { LIMITS } from '@/server/types';
import { daysLeft, isClosed } from '@/server/time';
import { APP_NAME } from '@/lib/app';

import {
  ApiFailure,
  httpApi,
  type ClaimBody,
  type LettersApi,
  type MeResponse,
  type RuleMeta,
} from './api';
import { actorLabel } from './format';

const STORE_KEY = 'docket_mock_v1';

interface MockSigner {
  user_id: string;
  display_name: string;
  impact_text: string | null;
  signed_at: string | null;
  added_at: string;
}

interface MockProposal {
  id: string;
  base_rev: string;
  kind: ProposalKind;
  claim_id: string | null;
  field: ClaimField | null;
  payload: ClaimProposalPayload | EditProposalPayload | ImpactProposalPayload;
  diff: WordDiff | null;
  status: ProposalStatus;
  proposed_by: string;
  proposed_for_user_id: string | null;
  created_at: string;
  stale?: { field: ClaimField; by: string; at: string } | null;
}

interface MockRevision {
  rev_no: number;
  rev_hash: string;
  snapshot: string;
  actor: string;
  action: string;
  created_at: string;
}

interface MockLetter {
  id: string;
  document_number: string | null;
  header: RuleHeader | null;
  rule_sha256: string | null;
  rev_no: number;
  rev_hash: string;
  share_code: string;
  public_token: string;
  is_judge_copy: boolean;
  created_at: string;
  updated_at: string;
  claims: Claim[];
  signers: MockSigner[];
  proposals: MockProposal[];
  revisions: MockRevision[];
  activity: ActivityLine[];
}

interface Store {
  letters: Record<string, MockLetter>;
  judge: string | null;
  seq: number;
}

function load(): Store {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw) as Store;
  } catch {
    /* fresh */
  }
  return { letters: {}, judge: null, seq: 1 };
}

function save(store: Store): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    /* quota */
  }
}

function fail(
  status: number,
  error: string,
  hint: string,
  extra: Record<string, unknown> = {},
): never {
  throw new ApiFailure(status, { error: error as ApiFailure['body']['error'], hint, ...extra });
}

function token(len: number, alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

async function sha256(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
}

function snapshotOf(letter: MockLetter): string {
  return JSON.stringify({
    document_number: letter.document_number,
    claims: [...letter.claims]
      .sort((a, b) => a.ord - b.ord || a.id.localeCompare(b.id))
      .map(c => ({
        id: c.id,
        ord: c.ord,
        quote: c.quote,
        anchor_start: c.anchor_start,
        anchor_end: c.anchor_end,
        page: c.page,
        anchor_status: c.anchor_status,
        position: c.position,
        assertion: c.assertion,
        requested_change: c.requested_change,
        evidence: c.evidence,
      })),
    signers: [...letter.signers]
      .sort((a, b) => a.user_id.localeCompare(b.user_id))
      .map(s => ({
        user_id: s.user_id,
        display_name: s.display_name,
        impact_text: s.impact_text,
        signed_at: s.signed_at,
      })),
  });
}

// ---------------------------------------------------------------------------
// Rule and identity caches (from the real routes)
// ---------------------------------------------------------------------------

interface RuleBundle {
  header: RuleHeader;
  meta: RuleMeta;
  text: string;
}

const rules = new Map<string, Promise<RuleBundle>>();

function rule(document_number: string): Promise<RuleBundle> {
  let p = rules.get(document_number);
  if (!p) {
    p = Promise.all([
      httpApi.ruleHeader(document_number),
      httpApi.ruleMeta(document_number),
      httpApi.ruleText(document_number),
    ]).then(([header, meta, text]) => ({ header, meta, text }));
    rules.set(document_number, p);
    p.catch(() => rules.delete(document_number));
  }
  return p;
}

let meCache: { at: number; value: MeResponse } | null = null;

async function me(): Promise<MeResponse> {
  if (meCache && Date.now() - meCache.at < 5000) return meCache.value;
  const value = await httpApi.me();
  meCache = { at: Date.now(), value };
  return value;
}

function actorOf(viewer: MeResponse, agent: boolean): string {
  return `${agent ? 'agent-of' : 'human'}:${viewer.signed_in ? viewer.display_name : 'anon'}`;
}

// ---------------------------------------------------------------------------
// Verification and diff (same rules as server/letter.ts)
// ---------------------------------------------------------------------------

function verify(
  bundle: RuleBundle,
  quote: string,
): { anchor: Anchor | null; nearest: NearestPassage[] } {
  const anchor = locate(bundle.text, bundle.meta.pages, bundle.meta.first_page, quote);
  if (anchor) return { anchor, nearest: [] };
  return {
    anchor: null,
    nearest: nearest(bundle.text, bundle.meta.pages, bundle.meta.first_page, quote, 3),
  };
}

function requireAnchor(bundle: RuleBundle, quote: string): Anchor {
  const v = verify(bundle, quote);
  if (!v.anchor) {
    fail(
      422,
      'ANCHOR_NOT_FOUND',
      'the quote is not in the rule text; copy one of the nearest passages verbatim',
      {
        nearest: v.nearest,
      },
    );
  }
  if (!v.anchor.unique) {
    fail(
      422,
      'ANCHOR_AMBIGUOUS',
      `the quote occurs ${v.anchor.occurrences.length} times; quote a longer span`,
      {
        occurrences: v.anchor.occurrences,
      },
    );
  }
  return v.anchor;
}

function wordDiff(before: string, after: string): WordDiff {
  const a = before.split(/\s+/).filter(Boolean);
  const b = after.split(/\s+/).filter(Boolean);
  const setA = new Set(a);
  const setB = new Set(b);
  return { removed: a.filter(w => !setB.has(w)), added: b.filter(w => !setA.has(w)) };
}

// ---------------------------------------------------------------------------
// Store helpers
// ---------------------------------------------------------------------------

const publicViews = new Set<string>();

function getLetter(store: Store, id: string): MockLetter {
  const l = store.letters[id];
  if (!l) fail(404, 'NO_LETTER', `no letter ${id}`);
  return l;
}

function requireRev(letter: MockLetter, base_rev: string): void {
  if (!/^[a-f0-9]{12}$/.test(base_rev))
    fail(400, 'INVALID', 'base_rev: 12 hex chars from get_letter');
  if (!letter.rev_hash.startsWith(base_rev)) {
    const baseIdx = letter.revisions.findIndex(r => r.rev_hash.startsWith(base_rev));
    const changed_since = letter.revisions.slice(baseIdx + 1).map(r => ({
      claim_id: null,
      field: 'claim',
      by: r.actor,
      summary: r.action,
    }));
    fail(
      409,
      'STALE_REVISION',
      `letter is at ${letter.rev_hash.slice(0, 12)} (rev ${letter.rev_no}); re-read and retry`,
      {
        current_rev: letter.rev_hash.slice(0, 12),
        changed_since,
      },
    );
  }
}

function requireHold(hold_ms: unknown): void {
  const n = Number(hold_ms);
  if (!Number.isFinite(n) || n < LIMITS.hold_ms) {
    fail(
      400,
      'HOLD_REQUIRED',
      `accepting needs a held gesture of at least ${LIMITS.hold_ms} ms (got ${Number.isFinite(n) ? n : 'none'})`,
    );
  }
}

function requireOpen(letter: MockLetter): void {
  const close = letter.header?.comments_close_on;
  if (isClosed(close))
    fail(409, 'COMMENTS_CLOSED', `comment period closed ${close}`, { comments_close_on: close });
}

async function requireBundle(letter: MockLetter): Promise<RuleBundle> {
  if (!letter.document_number)
    fail(404, 'NO_RULE', 'no rule is attached to this letter; call open_rule first');
  return rule(letter.document_number);
}

function activity(
  store: Store,
  letter: MockLetter,
  actor: string,
  kind: string,
  summary: string,
): void {
  letter.activity.unshift({
    id: store.seq++,
    actor,
    kind,
    summary: summary.slice(0, 200),
    created_at: new Date().toISOString(),
  });
  letter.activity = letter.activity.slice(0, 50);
}

async function commit(
  store: Store,
  letter: MockLetter,
  actor: string,
  action: string,
  kind: string,
  summary: string,
): Promise<{ rev: string; rev_no: number }> {
  const snapshot = snapshotOf(letter);
  const rev_hash = await sha256(snapshot);
  const now = new Date().toISOString();
  letter.rev_no += 1;
  letter.rev_hash = rev_hash;
  letter.updated_at = now;
  letter.revisions.push({
    rev_no: letter.rev_no,
    rev_hash,
    snapshot,
    actor,
    action,
    created_at: now,
  });
  activity(store, letter, actor, kind, summary);
  save(store);
  return { rev: rev_hash.slice(0, 12), rev_no: letter.rev_no };
}

function claimRow(
  letter_id: string,
  ord: number,
  input: ClaimBody,
  anchor: Anchor | null,
  proposed_by: string | null,
  accepted_by: string | null,
): Claim {
  const now = new Date().toISOString();
  return {
    id: `c_${token(8)}`,
    letter_id,
    ord,
    quote: input.quote,
    anchor_start: anchor?.start ?? null,
    anchor_end: anchor?.end ?? null,
    page: anchor?.page ?? null,
    anchor_status: anchor ? 'anchored' : 'unverified',
    position: input.position,
    assertion: input.assertion,
    requested_change: input.requested_change ?? '',
    evidence: input.evidence ?? '',
    proposed_by,
    accepted_by,
    accepted_at: accepted_by ? now : null,
    created_at: now,
    updated_at: now,
  };
}

async function newLetter(
  store: Store,
  viewer: MeResponse,
  actor: string,
  judge = false,
): Promise<MockLetter> {
  const now = new Date().toISOString();
  const letter: MockLetter = {
    id: `l_${token(8)}`,
    document_number: null,
    header: null,
    rule_sha256: null,
    rev_no: 1,
    rev_hash: '',
    share_code: token(22, 'abcdefghijklmnopqrstuvwxyz234567'),
    public_token: token(22, 'abcdefghijklmnopqrstuvwxyz234567'),
    is_judge_copy: judge,
    created_at: now,
    updated_at: now,
    claims: [],
    signers: [],
    proposals: [],
    revisions: [],
    activity: [],
  };
  const snapshot = snapshotOf(letter);
  letter.rev_hash = await sha256(snapshot);
  letter.revisions.push({
    rev_no: 1,
    rev_hash: letter.rev_hash,
    snapshot,
    actor,
    action: 'create',
    created_at: now,
  });
  activity(
    store,
    letter,
    actor,
    'create',
    judge ? 'Judge letter forked from the shipped seed' : 'Letter created',
  );
  store.letters[letter.id] = letter;
  void viewer;
  return letter;
}

async function bind(store: Store, letter: MockLetter, document_number: string, actor: string) {
  if (letter.document_number)
    fail(409, 'ALREADY_BOUND', `letter is bound to ${letter.document_number}`, {
      document_number: letter.document_number,
    });
  const b = await rule(document_number);
  letter.document_number = document_number;
  letter.header = b.header;
  letter.rule_sha256 = b.meta.text_sha256;
  return commit(
    store,
    letter,
    actor,
    `bind ${document_number}`,
    'bind',
    `${actorLabel(actor)} attached ${document_number} (${b.header.title})`,
  );
}

function missingFor(letter: MockLetter): string[] {
  const missing: string[] = [];
  if (!letter.document_number) missing.push('attach a rule');
  if (letter.claims.length === 0) missing.push('at least one claim');
  letter.claims.forEach((c, i) => {
    if (c.anchor_status !== 'anchored')
      missing.push(`claim ${i + 1} quote is not in the rule text`);
    if (!c.requested_change.trim()) missing.push(`claim ${i + 1} has no requested change`);
  });
  if (letter.signers.length === 0)
    missing.push('no signer yet (optional: sign in and add yourself)');
  for (const s of letter.signers)
    if (!s.signed_at) missing.push(`${s.display_name} has not signed`);
  if (letter.header && isClosed(letter.header.comments_close_on))
    missing.push(`comment period closed ${letter.header.comments_close_on}`);
  return missing;
}

function toPending(p: MockProposal, letter: MockLetter, viewer: MeResponse): PendingProposal {
  const out: PendingProposal = {
    proposal_id: p.id,
    kind: p.kind,
    claim_id: p.claim_id,
    field: p.field,
    base_rev: p.base_rev,
    payload: p.payload,
    diff: p.diff,
    by: p.proposed_by,
    proposed_for_user_id:
      p.kind === 'impact' && p.proposed_for_user_id === viewer.user_id ? 'me' : null,
    created_at: p.created_at,
    stale:
      p.status === 'stale'
        ? (p.stale ?? { field: p.field ?? 'assertion', by: 'human:unknown', at: p.created_at })
        : null,
  };
  if (p.kind === 'impact') {
    out.for_display_name =
      letter.signers.find(s => s.user_id === p.proposed_for_user_id)?.display_name ??
      (p.proposed_for_user_id === viewer.user_id ? viewer.display_name : 'Signer');
  }
  return out;
}

function buildState(letter: MockLetter, viewer: MeResponse, can_edit: boolean): LetterState {
  const header = letter.header
    ? { ...letter.header, days_left: daysLeft(letter.header.comments_close_on) }
    : null;
  return {
    letter: {
      id: letter.id,
      share_code: can_edit ? letter.share_code : '',
      public_token: letter.public_token,
      rev: letter.rev_hash.slice(0, 12),
      rev_hash: letter.rev_hash,
      rev_no: letter.rev_no,
      is_judge_copy: letter.is_judge_copy,
      created_at: letter.created_at,
      updated_at: letter.updated_at,
      rule_sha256: letter.rule_sha256,
    },
    rule: header,
    claims: letter.claims,
    signers: letter.signers.map<StateSigner>(s => ({
      display_name: s.display_name,
      impact_text: s.impact_text,
      signed_at: s.signed_at,
      added_at: s.added_at,
      is_viewer: s.user_id === viewer.user_id,
    })),
    pending: letter.proposals
      .filter(p => p.status === 'pending' || p.status === 'stale')
      .map(p => toPending(p, letter, viewer)),
    missing: missingFor(letter),
    activity: letter.activity.slice(0, 20),
    viewer: {
      signed_in: viewer.signed_in,
      display_name: viewer.display_name,
      is_signer: letter.signers.some(s => s.user_id === viewer.user_id),
      can_edit,
    },
    closed: header ? isClosed(header.comments_close_on) : false,
    days_left: header ? daysLeft(header.comments_close_on) : null,
  };
}

// ---------------------------------------------------------------------------
// Judge seed (PLAN.md P6 item 1)
// ---------------------------------------------------------------------------

const SEED_DOC = '2026-17902';
const Q3 =
  'The use of bicycles and electric bicycles is allowed in other locations designated by the superintendent after notice is provided using one or more of the methods described in Sec. 1.7 of this chapter.';
const Q1 =
  'Written determinations for existing trails and for new trails within developed areas must be published in the Federal Register for 30 days of public comment.';
const Q2 =
  'The superintendent would have authority to designate other locations, including administrative roads and trails, for bicycle and e-bike use except that rulemaking in the Federal Register would be required to allow bicycles or e-bikes in two circumstances.';
const BAD =
  'Written determinations for existing trails must be published in the Federal Register for 60 days of public comment.';

async function seedJudge(store: Store, viewer: MeResponse): Promise<MockLetter> {
  const actor = actorOf(viewer, false);
  const letter = await newLetter(store, viewer, actor, true);
  await bind(store, letter, SEED_DOC, actor);
  const b = await rule(SEED_DOC);
  const seeds: ClaimBody[] = [
    {
      quote: Q3,
      position: 'modify',
      assertion:
        'Sec. 1.7 notice can be a bulletin-board posting; nothing in proposed 4.30(b) sets a minimum interval between notice and a designation taking effect.',
      requested_change:
        'Add to 4.30(b): a designation takes effect no sooner than 30 days after notice, and the notice is also posted on the park website.',
    },
    {
      quote: Q1,
      position: 'support',
      assertion:
        'Today existing-trail designations get a 30-day Federal Register comment period; that interval is how groups like ours learn about trail changes.',
      requested_change:
        'Keep a minimum notice interval for existing-trail designations under the new process.',
    },
    {
      quote: BAD,
      position: 'oppose',
      assertion:
        'Seeded on purpose with a paraphrase that is not in the rule, so the refusal path is visible without an agent.',
      requested_change: '',
    },
  ];
  const demo = 'agent-of:Judge demo';
  for (const [i, s] of seeds.entries()) {
    const v = verify(b, s.quote);
    letter.claims.push(claimRow(letter.id, i + 1, s, v.anchor, demo, actor));
    await commit(
      store,
      letter,
      actor,
      `add claim ${i + 1}`,
      v.anchor ? 'claim' : 'claim-unverified',
      v.anchor
        ? `Judge demo accepted claim ${i + 1} · anchored p. ${v.anchor.page} · ${v.anchor.start}–${v.anchor.end}`
        : `ANCHOR_NOT_FOUND refused a ${s.quote.split(/\s+/).length}-word quote; ${v.nearest.length} nearest passages returned (claim ${i + 1} kept as unverified on purpose)`,
    );
  }
  const anchor = requireAnchor(b, Q2);
  letter.proposals.push({
    id: `p_${token(8)}`,
    base_rev: letter.rev_hash.slice(0, 12),
    kind: 'claim',
    claim_id: null,
    field: null,
    payload: {
      quote: Q2,
      position: 'support',
      assertion:
        'Superintendent-level designation of administrative roads and trails would let parks open connector routes without a full rulemaking.',
      requested_change:
        'Publish each superintendent designation on the park website within 30 days.',
      evidence: '',
      anchor,
    },
    diff: null,
    status: 'pending',
    proposed_by: demo,
    proposed_for_user_id: null,
    created_at: new Date().toISOString(),
  });
  activity(
    store,
    letter,
    demo,
    'proposal',
    `Judge demo's agent proposed a support claim · anchored p. ${anchor.page} · ${anchor.start}–${anchor.end} · waiting for a person to hold Accept`,
  );
  store.judge = letter.id;
  save(store);
  return letter;
}

// ---------------------------------------------------------------------------
// The API
// ---------------------------------------------------------------------------

export const mockApi: LettersApi = {
  me: () => httpApi.me(),
  rules: p => httpApi.rules(p),
  ruleHeader: n => httpApi.ruleHeader(n),
  ruleMeta: n => httpApi.ruleMeta(n),
  ruleText: n => httpApi.ruleText(n),

  async createLetter(document_number) {
    const store = load();
    const viewer = await me();
    const actor = actorOf(viewer, false);
    const letter = await newLetter(store, viewer, actor);
    if (document_number) await bind(store, letter, document_number, actor);
    save(store);
    const b = letter.document_number ? await rule(letter.document_number) : null;
    return {
      letter_id: letter.id,
      share_code: letter.share_code,
      public_token: letter.public_token,
      rev: letter.rev_hash.slice(0, 12),
      rev_no: letter.rev_no,
      rule: b?.header ?? null,
      toc: b?.meta.toc ?? [],
    };
  },

  async resolveShare(code) {
    const store = load();
    const letter = Object.values(store.letters).find(l => l.share_code === code);
    if (!letter) fail(404, 'NO_LETTER', 'no letter for this link');
    publicViews.delete(letter.id);
    return { letter_id: letter.id, can_edit: true };
  },

  async resolvePublic(tok) {
    const store = load();
    const letter = Object.values(store.letters).find(l => l.public_token === tok);
    if (!letter) fail(404, 'NO_LETTER', 'no letter for this link');
    publicViews.add(letter.id);
    return { letter_id: letter.id, can_edit: false };
  },

  async state(id, rev): Promise<StateResponse> {
    const store = load();
    const letter = getLetter(store, id);
    if (rev && letter.rev_hash.startsWith(rev) && !letter.proposals.some(p => p.status === 'stale'))
      return { unchanged: true };
    const viewer = await me();
    return buildState(letter, viewer, !publicViews.has(id));
  },

  async verify(id, quote) {
    const store = load();
    const letter = getLetter(store, id);
    const b = await requireBundle(letter);
    const anchor = requireAnchor(b, quote);
    return { anchor, normalized_quote: quote };
  },

  async propose(id, base_rev, body, actor = 'agent') {
    const store = load();
    const letter = getLetter(store, id);
    const viewer = await me();
    const who = actorOf(viewer, actor === 'agent');
    const b = await requireBundle(letter);
    requireOpen(letter);
    requireRev(letter, base_rev);
    const pending = letter.proposals.filter(p => p.status === 'pending');
    if (pending.length >= LIMITS.pending_per_letter)
      fail(429, 'PENDING_LIMIT', `${pending.length} proposals are waiting for a person`);
    const p: MockProposal = {
      id: `p_${token(8)}`,
      base_rev,
      kind: body.kind,
      claim_id: null,
      field: null,
      payload: { text: '' },
      diff: null,
      status: 'pending',
      proposed_by: who,
      proposed_for_user_id: null,
      created_at: new Date().toISOString(),
    };
    let summary: string;
    let anchor: Anchor | undefined;
    if (body.kind === 'claim') {
      if (letter.claims.length >= LIMITS.claims_per_letter)
        fail(409, 'LIMIT', 'a letter holds at most 40 claims');
      anchor = requireAnchor(b, body.quote);
      p.payload = {
        quote: body.quote,
        position: body.position,
        assertion: body.assertion,
        requested_change: body.requested_change ?? '',
        evidence: body.evidence ?? '',
        anchor,
      };
      summary = `${actorLabel(who)} proposed a ${body.position} claim · anchored p. ${anchor.page} · ${anchor.start}–${anchor.end} (against ${base_rev})`;
    } else if (body.kind === 'edit') {
      const claim = letter.claims.find(c => c.id === body.claim_id);
      if (!claim) fail(404, 'UNKNOWN_CLAIM', `no claim ${body.claim_id} on this letter`);
      const was = claim[body.field];
      if (was === body.text) fail(409, 'NO_CHANGE', `${body.field} already equals that text`);
      if (body.field === 'quote') anchor = requireAnchor(b, body.text);
      p.claim_id = claim.id;
      p.field = body.field;
      p.payload = { field: body.field, text: body.text, was, anchor: anchor ?? null };
      p.diff = wordDiff(was, body.text);
      const n = letter.claims.indexOf(claim) + 1;
      summary = `${actorLabel(who)} proposed an edit to ${body.field.replace('_', ' ')} on claim ${n} (against ${base_rev})`;
    } else {
      if (!viewer.signed_in || !viewer.user_id)
        fail(
          401,
          'NOT_SIGNED_IN',
          'sign in with ChatGPT to draft an impact statement for yourself',
        );
      if (
        letter.proposals.some(
          q =>
            q.status === 'pending' &&
            q.kind === 'impact' &&
            q.proposed_for_user_id === viewer.user_id,
        )
      )
        fail(409, 'ALREADY_PENDING', 'an impact draft is already waiting for you');
      p.proposed_for_user_id = viewer.user_id;
      p.payload = { text: body.text };
      summary = `${actorLabel(who)} drafted an impact statement for ${viewer.display_name} (against ${base_rev})`;
    }
    letter.proposals.push(p);
    activity(store, letter, who, 'proposal', summary);
    save(store);
    return {
      proposal_id: p.id,
      status: 'pending',
      base_rev,
      kind: p.kind,
      claim_id: p.claim_id ?? undefined,
      field: p.field ?? undefined,
      anchor,
      diff: p.diff ?? undefined,
      payload: p.payload,
      pending_count: pending.length + 1,
    };
  },

  async decide(id, pid, decision, hold_ms) {
    const store = load();
    const letter = getLetter(store, id);
    const viewer = await me();
    const actor = actorOf(viewer, false);
    const p = letter.proposals.find(x => x.id === pid);
    if (!p) fail(404, 'UNKNOWN_PROPOSAL', `no proposal ${pid} on this letter`);
    if (p.status !== 'pending' && !(p.status === 'stale' && decision === 'reject'))
      fail(409, 'NO_CHANGE', `proposal is already ${p.status}`);
    if (decision === 'reject') {
      p.status = 'rejected';
      activity(
        store,
        letter,
        actor,
        'reject',
        `${actorLabel(actor)} rejected ${actorLabel(p.proposed_by)}'s proposal`,
      );
      save(store);
      return {
        proposal_id: pid,
        status: 'rejected',
        rev: letter.rev_hash.slice(0, 12),
        rev_no: letter.rev_no,
      };
    }
    requireHold(hold_ms);
    let claim_id: string | undefined;
    let summary: string;
    if (p.kind === 'claim') {
      const payload = p.payload as ClaimProposalPayload;
      const c = claimRow(
        letter.id,
        (letter.claims.at(-1)?.ord ?? 0) + 1,
        payload,
        payload.anchor,
        p.proposed_by,
        actor,
      );
      letter.claims.push(c);
      claim_id = c.id;
      summary = `${actorLabel(actor)} accepted claim ${letter.claims.length} (proposed by ${actorLabel(p.proposed_by)})`;
    } else if (p.kind === 'edit') {
      const payload = p.payload as EditProposalPayload;
      const claim = letter.claims.find(c => c.id === p.claim_id);
      if (!claim) fail(404, 'UNKNOWN_CLAIM', 'the claim was deleted');
      const now = claim[payload.field];
      if (now !== payload.was) {
        p.status = 'stale';
        save(store);
        fail(409, 'STALE_PROPOSAL', `${payload.field} changed since the proposal`, {
          field: payload.field,
          was: payload.was,
          now,
          by: 'human:unknown',
        });
      }
      if (payload.field === 'position') claim.position = payload.text as Position;
      else if (payload.field === 'quote') {
        claim.quote = payload.text;
        claim.anchor_start = payload.anchor?.start ?? null;
        claim.anchor_end = payload.anchor?.end ?? null;
        claim.page = payload.anchor?.page ?? null;
        claim.anchor_status = payload.anchor ? 'anchored' : 'unverified';
      } else claim[payload.field] = payload.text;
      claim.updated_at = new Date().toISOString();
      claim_id = claim.id;
      summary = `${actorLabel(actor)} accepted ${actorLabel(p.proposed_by)}'s edit to ${payload.field.replace('_', ' ')} on claim ${letter.claims.indexOf(claim) + 1}`;
    } else {
      if (p.proposed_for_user_id !== viewer.user_id) {
        const name =
          letter.signers.find(s => s.user_id === p.proposed_for_user_id)?.display_name ??
          'the signer';
        fail(403, 'FORBIDDEN', `Only ${name} can accept this`);
      }
      const payload = p.payload as ImpactProposalPayload;
      let s = letter.signers.find(x => x.user_id === viewer.user_id);
      if (!s) {
        s = {
          user_id: viewer.user_id!,
          display_name: viewer.display_name,
          impact_text: null,
          signed_at: null,
          added_at: new Date().toISOString(),
        };
        letter.signers.push(s);
      }
      s.impact_text = payload.text;
      summary = `${viewer.display_name} accepted their drafted impact statement`;
    }
    p.status = 'accepted';
    const w = await commit(store, letter, actor, `accept ${pid}`, 'accept', summary);
    return { proposal_id: pid, status: 'accepted', ...w, claim_id };
  },

  async addClaim(id, base_rev, body) {
    const store = load();
    const letter = getLetter(store, id);
    const viewer = await me();
    const actor = actorOf(viewer, false);
    const b = await requireBundle(letter);
    requireRev(letter, base_rev);
    const v = verify(b, body.quote);
    const claim = claimRow(
      letter.id,
      (letter.claims.at(-1)?.ord ?? 0) + 1,
      body,
      v.anchor,
      null,
      actor,
    );
    letter.claims.push(claim);
    const n = letter.claims.length;
    const w = await commit(
      store,
      letter,
      actor,
      `add claim ${claim.id}`,
      v.anchor ? 'claim' : 'claim-unverified',
      v.anchor
        ? `${actorLabel(actor)} added claim ${n} by hand · anchored p. ${v.anchor.page} · ${v.anchor.start}–${v.anchor.end}`
        : `${actorLabel(actor)} added claim ${n} by hand · UNVERIFIED: quote not in rule text; ${v.nearest.length} nearest passages shown`,
    );
    return { claim, ...w, nearest: v.nearest.length ? v.nearest : undefined };
  },

  async patchClaim(id, cid, base_rev, field, text) {
    const store = load();
    const letter = getLetter(store, id);
    const viewer = await me();
    const actor = actorOf(viewer, false);
    const b = await requireBundle(letter);
    requireRev(letter, base_rev);
    const claim = letter.claims.find(c => c.id === cid);
    if (!claim) fail(404, 'UNKNOWN_CLAIM', `no claim ${cid} on this letter`);
    let nearestOut: NearestPassage[] = [];
    if (field === 'quote') {
      const v = verify(b, text);
      claim.quote = text;
      claim.anchor_start = v.anchor?.start ?? null;
      claim.anchor_end = v.anchor?.end ?? null;
      claim.page = v.anchor?.page ?? null;
      claim.anchor_status = v.anchor ? 'anchored' : 'unverified';
      nearestOut = v.nearest;
    } else if (field === 'position') claim.position = text as Position;
    else claim[field] = text;
    claim.updated_at = new Date().toISOString();
    const stale = letter.proposals.filter(
      p => p.status === 'pending' && p.kind === 'edit' && p.claim_id === cid && p.field === field,
    );
    for (const p of stale) {
      p.status = 'stale';
      p.stale = { field, by: actor, at: claim.updated_at };
    }
    const n = letter.claims.indexOf(claim) + 1;
    const w = await commit(
      store,
      letter,
      actor,
      `edit ${field} ${cid}`,
      'edit',
      `${actorLabel(actor)} changed ${field.replace('_', ' ')} on claim ${n}${field === 'quote' ? (claim.anchor_status === 'anchored' ? ` · anchored p. ${claim.page}` : ' · UNVERIFIED') : ''}${stale.length ? ` · ${stale.length} pending proposal${stale.length > 1 ? 's' : ''} now stale` : ''}`,
    );
    return { claim, ...w, nearest: nearestOut.length ? nearestOut : undefined };
  },

  async deleteClaim(id, cid, base_rev, hold_ms) {
    const store = load();
    const letter = getLetter(store, id);
    const viewer = await me();
    const actor = actorOf(viewer, false);
    requireRev(letter, base_rev);
    requireHold(hold_ms);
    const idx = letter.claims.findIndex(c => c.id === cid);
    if (idx < 0) fail(404, 'UNKNOWN_CLAIM', `no claim ${cid} on this letter`);
    letter.claims.splice(idx, 1);
    for (const p of letter.proposals)
      if (p.status === 'pending' && p.claim_id === cid) p.status = 'stale';
    return commit(
      store,
      letter,
      actor,
      `delete claim ${cid}`,
      'delete',
      `${actorLabel(actor)} deleted claim ${idx + 1}`,
    );
  },

  async addSigner(id, base_rev) {
    const store = load();
    const letter = getLetter(store, id);
    const viewer = await me();
    if (!viewer.signed_in || !viewer.user_id)
      fail(401, 'NOT_SIGNED_IN', 'sign in with ChatGPT to sign on');
    requireRev(letter, base_rev);
    if (letter.signers.some(s => s.user_id === viewer.user_id))
      fail(409, 'ALREADY_SIGNER', 'you are already a signer');
    letter.signers.push({
      user_id: viewer.user_id,
      display_name: viewer.display_name,
      impact_text: null,
      signed_at: null,
      added_at: new Date().toISOString(),
    });
    const w = await commit(
      store,
      letter,
      actorOf(viewer, false),
      'add signer',
      'signer',
      `${viewer.display_name} joined as a signer`,
    );
    return { signers: buildState(letter, viewer, true).signers, ...w };
  },

  async setImpact(id, base_rev, impact_text) {
    const store = load();
    const letter = getLetter(store, id);
    const viewer = await me();
    if (!viewer.signed_in) fail(401, 'NOT_SIGNED_IN', 'sign in with ChatGPT');
    requireRev(letter, base_rev);
    const s = letter.signers.find(x => x.user_id === viewer.user_id);
    if (!s) fail(404, 'NOT_SIGNER', 'add yourself as a signer first');
    s.impact_text = impact_text.trim() ? impact_text : null;
    const w = await commit(
      store,
      letter,
      actorOf(viewer, false),
      'impact',
      'impact',
      `${s.display_name} wrote their impact statement`,
    );
    return { signers: buildState(letter, viewer, true).signers, ...w };
  },

  async setDisplayName(id, base_rev, display_name) {
    const store = load();
    const letter = getLetter(store, id);
    const viewer = await me();
    if (!viewer.signed_in) fail(401, 'NOT_SIGNED_IN', 'sign in with ChatGPT');
    requireRev(letter, base_rev);
    const s = letter.signers.find(x => x.user_id === viewer.user_id);
    if (!s) fail(404, 'NOT_SIGNER', 'add yourself as a signer first');
    const clean = display_name
      .replace(/[^A-Za-z0-9 .'-]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 40);
    if (!clean) fail(400, 'INVALID', "display_name: letters, digits, spaces, . ' - only");
    s.display_name = clean;
    const w = await commit(
      store,
      letter,
      actorOf(viewer, false),
      'display_name',
      'signer',
      `A signer set their public display name to ${clean}`,
    );
    return { signers: buildState(letter, viewer, true).signers, ...w };
  },

  async sign(id, base_rev, hold_ms) {
    const store = load();
    const letter = getLetter(store, id);
    const viewer = await me();
    if (!viewer.signed_in) fail(401, 'NOT_SIGNED_IN', 'sign in with ChatGPT');
    requireRev(letter, base_rev);
    requireHold(hold_ms);
    const s = letter.signers.find(x => x.user_id === viewer.user_id);
    if (!s) fail(404, 'NOT_SIGNER', 'add yourself as a signer first');
    s.signed_at = new Date().toISOString();
    const w = await commit(
      store,
      letter,
      actorOf(viewer, false),
      'sign',
      'sign',
      `${s.display_name} signed`,
    );
    return { signers: buildState(letter, viewer, true).signers, ...w };
  },

  async undo(id, base_rev, hold_ms) {
    const store = load();
    const letter = getLetter(store, id);
    const viewer = await me();
    requireRev(letter, base_rev);
    requireHold(hold_ms);
    if (letter.rev_no <= 1) fail(409, 'NO_CHANGE', 'nothing to undo');
    const prev = letter.revisions[letter.revisions.length - 2];
    const snap = JSON.parse(prev.snapshot) as { claims: Claim[]; signers: MockSigner[] };
    const byId = new Map(letter.claims.map(c => [c.id, c]));
    letter.claims = snap.claims.map(c => ({
      ...(byId.get(c.id) ?? {
        ...c,
        letter_id: letter.id,
        proposed_by: null,
        accepted_by: null,
        accepted_at: null,
        created_at: prev.created_at,
        updated_at: prev.created_at,
      }),
      ...c,
    }));
    const sById = new Map(letter.signers.map(s => [s.user_id, s]));
    letter.signers = snap.signers.map(s => ({
      ...(sById.get(s.user_id) ?? { added_at: prev.created_at }),
      ...s,
    }));
    return commit(
      store,
      letter,
      actorOf(viewer, false),
      `undo to rev ${prev.rev_no}`,
      'undo',
      `${actorLabel(actorOf(viewer, false))} undid the last change (back to rev ${prev.rev_no}, as a new revision)`,
    );
  },

  async exportText(id) {
    const store = load();
    const letter = getLetter(store, id);
    const h = letter.header;
    const lines: string[] = [];
    lines.push(`Public comment on ${h?.title ?? 'a proposed rule'}`);
    lines.push(`Federal Register document ${letter.document_number ?? '(no rule attached)'}`);
    if (h?.agency) lines.push(`Agency: ${h.agency}`);
    if (h?.docket_id) lines.push(`Docket: ${h.docket_id}`);
    if (h?.comments_close_on) lines.push(`Comments close: ${h.comments_close_on}`);
    lines.push('');
    const label: Record<Position, string> = {
      support: 'Support',
      oppose: 'Oppose',
      modify: 'Modify',
    };
    if (letter.claims.length === 0) lines.push('(no claims yet)');
    letter.claims.forEach((c, i) => {
      const pageLabel =
        c.anchor_status === 'anchored' ? `Quoting page ${c.page}` : 'Quoting [QUOTE NOT VERIFIED]';
      let line = `${i + 1}. [${label[c.position]}] ${pageLabel}: "${c.quote}" — [claimant's words] ${c.assertion}`;
      if (c.requested_change.trim())
        line += ` Requested change: [claimant's words] ${c.requested_change}`;
      if (c.evidence.trim()) line += ` (Evidence: [claimant's words] ${c.evidence})`;
      lines.push(line, '');
    });
    lines.push('Signed by:');
    if (letter.signers.length === 0) lines.push('(no signers yet)');
    for (const s of letter.signers) {
      lines.push(
        `- ${s.display_name}${s.signed_at ? ` (signed ${s.signed_at})` : ' (not yet signed)'}`,
      );
      if (s.impact_text) lines.push(`  Impact: ${s.impact_text}`);
    }
    lines.push('');
    lines.push(
      `Quotes verified against Federal Register document ${letter.document_number ?? '(none)'} text fetched ${(h?.fetched_at ?? letter.updated_at).slice(0, 10)}. Prepared with ${APP_NAME}, an agent-assisted drafting tool; filed by a person.`,
    );
    return lines.join('\n');
  },

  exportUrl: id => `/api/letters/${encodeURIComponent(id)}/export.txt`,

  async judgeFork(reset) {
    const store = load();
    const viewer = await me();
    if (!reset && store.judge && store.letters[store.judge]) {
      const l = store.letters[store.judge];
      return { letter_id: l.id, share_code: l.share_code, reused: true };
    }
    const l = await seedJudge(store, viewer);
    return { letter_id: l.id, share_code: l.share_code, reused: false };
  },
};
