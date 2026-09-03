// Letter domain (PLAN.md 4.3, 4.4, P3): ids, canonical snapshot + rev_hash, the revisions-first
// atomic D1 batch, STALE_REVISION attribution, proposals, claims, signers, undo, checklist,
// state and export. Routes under app/api/letters are thin wrappers over this module.

import { locate, nearest } from './anchor';
import type { DbEnv } from './envvars';
import { getCachedRule, ruleHeader } from './fr';
import { fail } from './http';
import { randomToken, sanitizeDisplayName, sha256Hex } from './identity';
import { clockNY, daysLeft, isClosed, todayNY } from './time';
import {
  LIMITS,
  type Actor,
  type ActivityLine,
  type Anchor,
  type ChangedSince,
  type Claim,
  type ClaimField,
  type ClaimProposalPayload,
  type EditProposalPayload,
  type ImpactProposalPayload,
  type Letter,
  type LetterState,
  type NearestPassage,
  type Occurrence,
  type PendingProposal,
  type Position,
  type Proposal,
  type Revision,
  type RuleCacheParsed,
  type Signer,
  type Snapshot,
  type SnapshotClaim,
  type SnapshotSigner,
  type StateSigner,
  type Viewer,
  type WordDiff,
} from './types';

// ---------------------------------------------------------------------------
// Ids and tokens
// ---------------------------------------------------------------------------

export function newId(prefix: 'l_' | 'c_' | 'p_'): string {
  return prefix + randomToken(8);
}

/** 22-char base32 (a-z2-7) via crypto.getRandomValues (P3). */
export function newLinkToken(length = 22): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += alphabet[b % 32];
  return out;
}

// ---------------------------------------------------------------------------
// Canonical snapshot and revision hash (4.4)
// ---------------------------------------------------------------------------

export function snapshotClaim(c: Claim): SnapshotClaim {
  return {
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
  };
}

export function snapshotSigner(s: Signer): SnapshotSigner {
  return {
    user_id: s.user_id,
    display_name: s.display_name,
    impact_text: s.impact_text,
    signed_at: s.signed_at,
  };
}

/** Claims sorted by ord then id, signers by user_id; keys in the contract order. */
export function buildSnapshot(
  document_number: string | null,
  claims: readonly Claim[],
  signers: readonly Signer[],
): Snapshot {
  return {
    document_number,
    claims: [...claims]
      .sort((a, b) => a.ord - b.ord || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map(snapshotClaim),
    signers: [...signers]
      .sort((a, b) => (a.user_id < b.user_id ? -1 : a.user_id > b.user_id ? 1 : 0))
      .map(snapshotSigner),
  };
}

export function canonicalJson(snapshot: Snapshot): string {
  return JSON.stringify(snapshot);
}

export function hashSnapshot(snapshot: Snapshot): Promise<string> {
  return sha256Hex(canonicalJson(snapshot));
}

export function shortRev(hash: string): string {
  return hash.slice(0, 12);
}

export function isRev(s: unknown): s is string {
  return typeof s === 'string' && /^[a-f0-9]{12}$/.test(s);
}

// ---------------------------------------------------------------------------
// Word-level diff (LCS) for edit proposals (P3)
// ---------------------------------------------------------------------------

export function wordDiff(before: string, after: string): WordDiff {
  const a = before.split(/\s+/).filter(Boolean);
  const b = after.split(/\s+/).filter(Boolean);
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const removed: string[] = [];
  const added: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      removed.push(a[i++]);
    } else {
      added.push(b[j++]);
    }
  }
  while (i < n) removed.push(a[i++]);
  while (j < m) added.push(b[j++]);
  return { removed, added };
}

// ---------------------------------------------------------------------------
// Actors and permissions
// ---------------------------------------------------------------------------

export function actorFor(viewer: Viewer, isAgent: boolean): Actor {
  const name = viewer.signed_in ? viewer.display_name : 'anon';
  return `${isAgent ? 'agent-of' : 'human'}:${name}`;
}

/** 'Maya's agent' / 'Maya' / 'an agent' / 'someone' for prose. */
export function actorLabel(actor: Actor): string {
  const [kind, name] = actor.split(':', 2);
  const who = name && name !== 'anon' ? name : null;
  if (kind === 'agent-of') return who ? `${who}'s agent` : 'an agent';
  return who ?? 'someone';
}

export async function ownerHash(owner_token: string): Promise<string> {
  return sha256Hex(`owner:${owner_token}`);
}

/** Owner only (not the share-code path): the creator's cookie hash or user id. */
export async function isOwner(letter: Letter, viewer: Viewer): Promise<boolean> {
  if (viewer.user_id && letter.owner_user_id === viewer.user_id) return true;
  return (
    !!letter.owner_token_hash && letter.owner_token_hash === (await ownerHash(viewer.owner_token))
  );
}

export async function canEditLetter(
  letter: Letter,
  viewer: Viewer,
  shareCodes: readonly string[],
): Promise<boolean> {
  if (shareCodes.includes(letter.share_code)) return true;
  if (viewer.user_id && letter.owner_user_id === viewer.user_id) return true;
  if (letter.owner_token_hash && letter.owner_token_hash === (await ownerHash(viewer.owner_token)))
    return true;
  return false;
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

export async function loadLetter(env: DbEnv, id: string): Promise<Letter> {
  const row = await env.DB.prepare('SELECT * FROM letters WHERE id = ?').bind(id).first<Letter>();
  if (!row) fail(404, 'NO_LETTER', `no letter ${id}`);
  return row;
}

export async function findLetterBy(
  env: DbEnv,
  column: 'share_code' | 'public_token',
  value: string,
): Promise<Letter> {
  const row = await env.DB.prepare(`SELECT * FROM letters WHERE ${column} = ?`)
    .bind(value)
    .first<Letter>();
  if (!row) fail(404, 'NO_LETTER', 'no letter for this link');
  return row;
}

export async function loadClaims(env: DbEnv, letter_id: string): Promise<Claim[]> {
  const r = await env.DB.prepare('SELECT * FROM claims WHERE letter_id = ? ORDER BY ord, id')
    .bind(letter_id)
    .all<Claim>();
  return r.results ?? [];
}

export async function loadSigners(env: DbEnv, letter_id: string): Promise<Signer[]> {
  const r = await env.DB.prepare(
    'SELECT * FROM signers WHERE letter_id = ? ORDER BY added_at, user_id',
  )
    .bind(letter_id)
    .all<Signer>();
  return r.results ?? [];
}

export async function loadProposals(
  env: DbEnv,
  letter_id: string,
  statuses: readonly string[] = ['pending', 'stale'],
): Promise<Proposal[]> {
  const marks = statuses.map(() => '?').join(', ');
  const r = await env.DB.prepare(
    `SELECT * FROM proposals WHERE letter_id = ? AND status IN (${marks}) ORDER BY created_at, id`,
  )
    .bind(letter_id, ...statuses)
    .all<Proposal>();
  return r.results ?? [];
}

export async function loadProposal(env: DbEnv, letter_id: string, pid: string): Promise<Proposal> {
  const row = await env.DB.prepare('SELECT * FROM proposals WHERE id = ? AND letter_id = ?')
    .bind(pid, letter_id)
    .first<Proposal>();
  if (!row) fail(404, 'UNKNOWN_PROPOSAL', `no proposal ${pid} on this letter`);
  return row;
}

export async function loadActivity(env: DbEnv, letter_id: string, limit = LIMITS.activity_lines) {
  const r = await env.DB.prepare(
    'SELECT id, actor, kind, summary, created_at FROM activity WHERE letter_id = ? ORDER BY id DESC LIMIT ?',
  )
    .bind(letter_id, limit)
    .all<ActivityLine>();
  return r.results ?? [];
}

export async function loadRevisions(env: DbEnv, letter_id: string): Promise<Revision[]> {
  const r = await env.DB.prepare('SELECT * FROM revisions WHERE letter_id = ? ORDER BY rev_no')
    .bind(letter_id)
    .all<Revision>();
  return r.results ?? [];
}

export async function loadRule(env: DbEnv, letter: Letter): Promise<RuleCacheParsed | null> {
  if (!letter.document_number) return null;
  return getCachedRule(env, letter.document_number);
}

// ---------------------------------------------------------------------------
// STALE_REVISION attribution (4.4)
// ---------------------------------------------------------------------------

export function diffSnapshots(before: Snapshot, after: Snapshot, by: Actor): ChangedSince[] {
  const out: ChangedSince[] = [];
  const bClaims = new Map(before.claims.map(c => [c.id, c]));
  const aClaims = new Map(after.claims.map(c => [c.id, c]));
  for (const [id, c] of aClaims) {
    const prev = bClaims.get(id);
    if (!prev) {
      out.push({ claim_id: id, field: 'claim', by, summary: `added claim ${id}` });
      continue;
    }
    for (const field of [
      'quote',
      'assertion',
      'requested_change',
      'evidence',
      'position',
    ] as const) {
      if (prev[field] !== c[field]) {
        out.push({ claim_id: id, field, by, summary: `changed ${field} on claim ${id}` });
      }
    }
  }
  for (const id of bClaims.keys()) {
    if (!aClaims.has(id))
      out.push({ claim_id: id, field: 'claim', by, summary: `deleted claim ${id}` });
  }
  const bSigners = new Map(before.signers.map(s => [s.user_id, s]));
  const aSigners = new Map(after.signers.map(s => [s.user_id, s]));
  for (const [uid, s] of aSigners) {
    const prev = bSigners.get(uid);
    if (!prev) {
      out.push({
        claim_id: null,
        field: 'signer',
        by,
        summary: `${s.display_name} joined as a signer`,
      });
      continue;
    }
    if (prev.impact_text !== s.impact_text) {
      out.push({
        claim_id: null,
        field: 'impact',
        by,
        summary: `${s.display_name} changed their impact statement`,
      });
    }
    if (prev.signed_at !== s.signed_at) {
      out.push({
        claim_id: null,
        field: 'signature',
        by,
        summary: `${s.display_name} ${s.signed_at ? 'signed' : 'unsigned'}`,
      });
    }
  }
  for (const [uid, s] of bSigners) {
    if (!aSigners.has(uid))
      out.push({
        claim_id: null,
        field: 'signer',
        by,
        summary: `${s.display_name} was removed as a signer`,
      });
  }
  return out;
}

/** What changed between base_rev and the current revision, attributed per intervening revision. */
export async function changedSince(
  env: DbEnv,
  letter: Letter,
  base_rev: string,
): Promise<ChangedSince[]> {
  const revisions = await loadRevisions(env, letter.id);
  const baseIndex = revisions.findIndex(r => r.rev_hash.startsWith(base_rev));
  if (baseIndex < 0) {
    return [
      {
        claim_id: null,
        field: 'claim',
        by: 'human:unknown',
        summary: `base_rev ${base_rev} is not a revision of this letter`,
      },
    ];
  }
  const out: ChangedSince[] = [];
  for (let i = baseIndex + 1; i < revisions.length; i++) {
    const before = JSON.parse(revisions[i - 1].snapshot_json) as Snapshot;
    const after = JSON.parse(revisions[i].snapshot_json) as Snapshot;
    out.push(...diffSnapshots(before, after, revisions[i].actor));
  }
  return out.slice(0, 20);
}

export async function assertBaseRev(
  env: DbEnv,
  letter: Letter,
  base_rev: unknown,
): Promise<string> {
  if (!isRev(base_rev)) fail(400, 'INVALID', 'base_rev: 12 hex chars from get_letter');
  if (!letter.rev_hash.startsWith(base_rev)) {
    fail(
      409,
      'STALE_REVISION',
      `letter is at ${shortRev(letter.rev_hash)} (rev ${letter.rev_no}); re-read and retry`,
      {
        current_rev: shortRev(letter.rev_hash),
        changed_since: await changedSince(env, letter, base_rev),
      },
    );
  }
  return base_rev;
}

// ---------------------------------------------------------------------------
// The atomic write (4.4)
// ---------------------------------------------------------------------------

export interface WriteInput {
  letter: Letter;
  actor: Actor;
  action: string;
  /** Activity kind + summary (≤200) written in the same batch. */
  activity: { kind: string; summary: string };
  /** The full post-write claim and signer sets (the snapshot is hashed from these). */
  claims: readonly Claim[];
  signers: readonly Signer[];
  /** Content statements, run after the guarded letters UPDATE. */
  statements: D1PreparedStatement[];
  /** Extra columns to set on letters in the same UPDATE (binding). */
  letterColumns?: Record<string, string | number | null>;
}

export interface WriteResult {
  rev_hash: string;
  rev: string;
  rev_no: number;
}

/**
 * One env.DB.batch whose FIRST statement inserts the next revisions row; a concurrent writer
 * collides on the PK and D1 rolls the whole batch back. Then the rev_no-guarded letters
 * UPDATE, the content statements, the activity row.
 */
export async function writeRevision(env: DbEnv, input: WriteInput): Promise<WriteResult> {
  const { letter } = input;
  const snapshot = buildSnapshot(
    input.letterColumns?.document_number !== undefined
      ? (input.letterColumns.document_number as string | null)
      : letter.document_number,
    input.claims,
    input.signers,
  );
  const rev_hash = await hashSnapshot(snapshot);
  const rev_no = letter.rev_no + 1;
  const now = new Date().toISOString();
  const extraCols = Object.entries(input.letterColumns ?? {});
  const setClause = [
    'rev_no = ?',
    'rev_hash = ?',
    'updated_at = ?',
    ...extraCols.map(([k]) => `${k} = ?`),
  ].join(', ');
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      'INSERT INTO revisions (letter_id, rev_no, rev_hash, snapshot_json, actor, action, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).bind(letter.id, rev_no, rev_hash, canonicalJson(snapshot), input.actor, input.action, now),
    env.DB.prepare(`UPDATE letters SET ${setClause} WHERE id = ? AND rev_no = ?`).bind(
      rev_no,
      rev_hash,
      now,
      ...extraCols.map(([, v]) => v),
      letter.id,
      letter.rev_no,
    ),
    ...input.statements,
    env.DB.prepare(
      'INSERT INTO activity (letter_id, actor, kind, summary, created_at) VALUES (?, ?, ?, ?, ?)',
    ).bind(letter.id, input.actor, input.activity.kind, input.activity.summary.slice(0, 200), now),
  ];
  try {
    await env.DB.batch(statements);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/UNIQUE|constraint|PRIMARY KEY/i.test(msg)) {
      const fresh = await loadLetter(env, letter.id);
      fail(
        409,
        'STALE_REVISION',
        `another change landed first; letter is now at ${shortRev(fresh.rev_hash)}`,
        {
          current_rev: shortRev(fresh.rev_hash),
          changed_since: await changedSince(env, fresh, shortRev(letter.rev_hash)),
        },
      );
    }
    throw err;
  }
  return { rev_hash, rev: shortRev(rev_hash), rev_no };
}

/** Activity-only write (reads, refusals): no revision. */
export async function logActivity(
  env: DbEnv,
  letter_id: string,
  actor: Actor,
  kind: string,
  summary: string,
) {
  await env.DB.prepare(
    'INSERT INTO activity (letter_id, actor, kind, summary, created_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(letter_id, actor, kind, summary.slice(0, 200), new Date().toISOString())
    .run();
}

// ---------------------------------------------------------------------------
// Create / bind
// ---------------------------------------------------------------------------

export async function createLetter(
  env: DbEnv,
  viewer: Viewer,
  actor: Actor,
  opts: { is_judge_copy?: boolean; rule?: RuleCacheParsed | null } = {},
): Promise<Letter> {
  const now = new Date().toISOString();
  // With a rule, the letter is born bound at rev_no 1 (POST /api/letters {document_number}).
  const header = opts.rule ? ruleHeader(opts.rule) : null;
  const snapshot = buildSnapshot(header?.document_number ?? null, [], []);
  const letter: Letter = {
    id: newId('l_'),
    document_number: header?.document_number ?? null,
    title: header?.title ?? null,
    agency: header?.agency ?? null,
    agency_slug: header?.agency_slug ?? null,
    docket_id: header?.docket_id ?? null,
    regs_document_id: header?.document_id ?? null,
    comment_url: header?.comment_url ?? null,
    html_url: header?.html_url ?? null,
    publication_date: header?.publication_date ?? null,
    comments_close_on: header?.comments_close_on ?? null,
    rule_sha256: opts.rule?.text_sha256 ?? null,
    rev_no: 1,
    rev_hash: await hashSnapshot(snapshot),
    owner_user_id: viewer.user_id,
    owner_token_hash: await ownerHash(viewer.owner_token),
    share_code: newLinkToken(),
    public_token: newLinkToken(),
    is_judge_copy: opts.is_judge_copy ? 1 : 0,
    created_at: now,
    updated_at: now,
  };
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO letters (id, document_number, title, agency, agency_slug, docket_id, regs_document_id, comment_url, html_url, publication_date, comments_close_on, rule_sha256, rev_no, rev_hash, owner_user_id, owner_token_hash, share_code, public_token, is_judge_copy, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      letter.id,
      letter.document_number,
      letter.title,
      letter.agency,
      letter.agency_slug,
      letter.docket_id,
      letter.regs_document_id,
      letter.comment_url,
      letter.html_url,
      letter.publication_date,
      letter.comments_close_on,
      letter.rule_sha256,
      letter.rev_hash,
      letter.owner_user_id,
      letter.owner_token_hash,
      letter.share_code,
      letter.public_token,
      letter.is_judge_copy,
      now,
      now,
    ),
    env.DB.prepare(
      'INSERT INTO revisions (letter_id, rev_no, rev_hash, snapshot_json, actor, action, created_at) VALUES (?, 1, ?, ?, ?, ?, ?)',
    ).bind(
      letter.id,
      letter.rev_hash,
      canonicalJson(snapshot),
      actor,
      header ? `create bound to ${header.document_number}` : 'create',
      now,
    ),
    env.DB.prepare(
      'INSERT INTO activity (letter_id, actor, kind, summary, created_at) VALUES (?, ?, ?, ?, ?)',
    ).bind(
      letter.id,
      actor,
      'create',
      opts.is_judge_copy
        ? 'Judge letter forked from the shipped seed'
        : header
          ? `${actorLabel(actor)} started a letter on ${header.document_number} (${header.title})`
          : 'Letter created',
      now,
    ),
  ]);
  return letter;
}

/** Bind a rule (rules_cache row) to an unbound letter: a new revision with the header columns. */
export async function bindRule(
  env: DbEnv,
  letter: Letter,
  rule: RuleCacheParsed,
  actor: Actor,
): Promise<WriteResult> {
  if (letter.document_number) {
    fail(409, 'ALREADY_BOUND', `letter is bound to ${letter.document_number}`, {
      document_number: letter.document_number,
    });
  }
  const header = ruleHeader(rule);
  const claims = await loadClaims(env, letter.id);
  const signers = await loadSigners(env, letter.id);
  return writeRevision(env, {
    letter,
    actor,
    action: `bind ${rule.document_number}`,
    activity: {
      kind: 'bind',
      summary: `${actorLabel(actor)} attached ${rule.document_number} (${header.title})`,
    },
    claims,
    signers,
    statements: [],
    letterColumns: {
      document_number: rule.document_number,
      title: header.title,
      agency: header.agency,
      agency_slug: header.agency_slug ?? null,
      docket_id: header.docket_id,
      regs_document_id: header.document_id,
      comment_url: header.comment_url,
      html_url: header.html_url,
      publication_date: header.publication_date ?? null,
      comments_close_on: header.comments_close_on,
      rule_sha256: rule.text_sha256,
    },
  });
}

// ---------------------------------------------------------------------------
// Verification helpers
// ---------------------------------------------------------------------------

export interface Verdict {
  anchor: Anchor | null;
  nearest: NearestPassage[];
}

/**
 * How a hand-typed quote resolved: `anchor` only when it locates exactly once. A quote that
 * occurs more than once is stored unverified with its occurrences, so the card can say where
 * the copies are instead of silently anchoring the first one (2.2 item 3).
 */
export interface HandVerdict {
  anchor: Anchor | null;
  nearest: NearestPassage[];
  occurrences: Occurrence[];
}

export function verifyHandQuote(rule: RuleCacheParsed, quote: string): HandVerdict {
  const v = verifyQuote(rule, quote);
  if (v.anchor && !v.anchor.unique) {
    return { anchor: null, nearest: [], occurrences: v.anchor.occurrences };
  }
  return { anchor: v.anchor, nearest: v.nearest, occurrences: [] };
}

/** The unverified half of the activity summary and the card's reason (2.2 item 3). */
function unverifiedReason(v: HandVerdict): string {
  return v.occurrences.length > 0
    ? `UNVERIFIED: the quote occurs ${v.occurrences.length} times; quote a longer span`
    : `UNVERIFIED: quote not in rule text; ${v.nearest.length} nearest passages shown`;
}

export function verifyQuote(rule: RuleCacheParsed, quote: string): Verdict {
  const anchor = locate(rule.text, rule.pages, rule.first_page, quote);
  if (anchor) return { anchor, nearest: [] };
  return { anchor: null, nearest: nearest(rule.text, rule.pages, rule.first_page, quote, 3) };
}

/** Throws the 422 anchor errors (tools 4/5) or returns a unique anchor. */
export function requireAnchor(rule: RuleCacheParsed, quote: string): Anchor {
  const v = verifyQuote(rule, quote);
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

export function requireOpen(letter: Letter): void {
  if (isClosed(letter.comments_close_on)) {
    fail(409, 'COMMENTS_CLOSED', `comment period closed ${letter.comments_close_on}`, {
      comments_close_on: letter.comments_close_on,
    });
  }
}

export function requireRule(letter: Letter, rule: RuleCacheParsed | null): RuleCacheParsed {
  if (!letter.document_number || !rule)
    fail(404, 'NO_RULE', 'no rule is attached to this letter; call open_rule first');
  return rule;
}

export function requireHold(hold_ms: unknown): number {
  const n = typeof hold_ms === 'number' ? hold_ms : Number(hold_ms);
  // A consistency check for the held gesture, not a security boundary (4.4).
  if (!Number.isFinite(n) || n < LIMITS.hold_ms) {
    fail(
      400,
      'HOLD_REQUIRED',
      `accepting needs a held gesture of at least ${LIMITS.hold_ms} ms (got ${Number.isFinite(n) ? n : 'none'})`,
    );
  }
  return n;
}

// ---------------------------------------------------------------------------
// Claims
// ---------------------------------------------------------------------------

export interface ClaimInput {
  quote: string;
  position: Position;
  assertion: string;
  requested_change: string;
  evidence: string;
}

function claimRow(
  letter_id: string,
  ord: number,
  input: ClaimInput,
  anchor: Anchor | null,
  proposed_by: Actor | null,
  accepted_by: Actor | null,
): Claim {
  const now = new Date().toISOString();
  return {
    id: newId('c_'),
    letter_id,
    ord,
    quote: input.quote,
    anchor_start: anchor?.start ?? null,
    anchor_end: anchor?.end ?? null,
    page: anchor?.page ?? null,
    anchor_status: anchor ? 'anchored' : 'unverified',
    position: input.position,
    assertion: input.assertion,
    requested_change: input.requested_change,
    evidence: input.evidence,
    proposed_by,
    accepted_by,
    accepted_at: accepted_by ? now : null,
    created_at: now,
    updated_at: now,
  };
}

function insertClaimStmt(env: DbEnv, c: Claim): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO claims (id, letter_id, ord, quote, anchor_start, anchor_end, page, anchor_status, position, assertion, requested_change, evidence, proposed_by, accepted_by, accepted_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    c.id,
    c.letter_id,
    c.ord,
    c.quote,
    c.anchor_start,
    c.anchor_end,
    c.page,
    c.anchor_status,
    c.position,
    c.assertion,
    c.requested_change,
    c.evidence,
    c.proposed_by,
    c.accepted_by,
    c.accepted_at,
    c.created_at,
    c.updated_at,
  );
}

/** Human "Add claim by hand": verified the same way; unverified allowed and flagged. */
export async function addClaimByHand(
  env: DbEnv,
  letter: Letter,
  rule: RuleCacheParsed,
  actor: Actor,
  input: ClaimInput,
): Promise<{
  claim: Claim;
  nearest: NearestPassage[];
  occurrences: Occurrence[];
  write: WriteResult;
}> {
  const claims = await loadClaims(env, letter.id);
  if (claims.length >= LIMITS.claims_per_letter)
    fail(409, 'LIMIT', `a letter holds at most ${LIMITS.claims_per_letter} claims`);
  const signers = await loadSigners(env, letter.id);
  const v = verifyHandQuote(rule, input.quote);
  const anchor = v.anchor;
  const claim = claimRow(letter.id, (claims.at(-1)?.ord ?? 0) + 1, input, anchor, null, actor);
  const n = claims.length + 1;
  const summary = anchor
    ? `${actorLabel(actor)} added claim ${n} by hand · anchored p. ${anchor.page} · ${anchor.start}–${anchor.end}`
    : `${actorLabel(actor)} added claim ${n} by hand · ${unverifiedReason(v)}`;
  const write = await writeRevision(env, {
    letter,
    actor,
    action: `add claim ${claim.id}`,
    activity: { kind: anchor ? 'claim' : 'claim-unverified', summary },
    claims: [...claims, claim],
    signers,
    statements: [insertClaimStmt(env, claim)],
  });
  return { claim, nearest: v.nearest, occurrences: v.occurrences, write };
}

/** Human inline edit of one field; quote edits re-verified; stale-marks pending edit proposals. */
export async function editClaimField(
  env: DbEnv,
  letter: Letter,
  rule: RuleCacheParsed,
  actor: Actor,
  cid: string,
  field: ClaimField,
  text: string,
): Promise<{
  claim: Claim;
  nearest: NearestPassage[];
  occurrences: Occurrence[];
  write: WriteResult;
}> {
  const claims = await loadClaims(env, letter.id);
  const idx = claims.findIndex(c => c.id === cid);
  if (idx < 0) fail(404, 'UNKNOWN_CLAIM', `no claim ${cid} on this letter`);
  const signers = await loadSigners(env, letter.id);
  const before = claims[idx];
  const updated: Claim = { ...before, updated_at: new Date().toISOString() };
  let nearestOut: NearestPassage[] = [];
  let occurrencesOut: Occurrence[] = [];
  let unverifiedNote = '';
  if (field === 'quote') {
    const v = verifyHandQuote(rule, text);
    updated.quote = text;
    updated.anchor_start = v.anchor?.start ?? null;
    updated.anchor_end = v.anchor?.end ?? null;
    updated.page = v.anchor?.page ?? null;
    updated.anchor_status = v.anchor ? 'anchored' : 'unverified';
    nearestOut = v.nearest;
    occurrencesOut = v.occurrences;
    unverifiedNote = v.anchor ? '' : ` · ${unverifiedReason(v)}`;
  } else if (field === 'position') {
    updated.position = text as Position;
  } else {
    updated[field] = text;
  }
  const next = [...claims];
  next[idx] = updated;
  const n = idx + 1;
  const now = new Date().toISOString();
  // Pending edit proposals on this field become stale, attributed to this human (2.2 item 4).
  const stale = (await loadProposals(env, letter.id, ['pending'])).filter(
    p => p.kind === 'edit' && p.claim_id === cid && p.field === field,
  );
  const staleStmts = stale.map(p => {
    const payload = JSON.parse(p.payload_json) as EditProposalPayload & { stale?: unknown };
    payload.stale = { field, by: actor, at: now };
    return env.DB.prepare('UPDATE proposals SET status = ?, payload_json = ? WHERE id = ?').bind(
      'stale',
      JSON.stringify(payload),
      p.id,
    );
  });
  const write = await writeRevision(env, {
    letter,
    actor,
    action: `edit ${field} ${cid}`,
    activity: {
      kind: 'edit',
      summary: `${actorLabel(actor)} changed ${field.replace('_', ' ')} on claim ${n}${
        field === 'quote'
          ? updated.anchor_status === 'anchored'
            ? ` · anchored p. ${updated.page}`
            : unverifiedNote
          : ''
      }${stale.length ? ` · ${stale.length} pending proposal${stale.length > 1 ? 's' : ''} now stale` : ''}`,
    },
    claims: next,
    signers,
    statements: [
      env.DB.prepare(
        'UPDATE claims SET quote = ?, anchor_start = ?, anchor_end = ?, page = ?, anchor_status = ?, position = ?, assertion = ?, requested_change = ?, evidence = ?, updated_at = ? WHERE id = ?',
      ).bind(
        updated.quote,
        updated.anchor_start,
        updated.anchor_end,
        updated.page,
        updated.anchor_status,
        updated.position,
        updated.assertion,
        updated.requested_change,
        updated.evidence,
        updated.updated_at,
        cid,
      ),
      ...staleStmts,
    ],
  });
  return { claim: updated, nearest: nearestOut, occurrences: occurrencesOut, write };
}

export async function deleteClaim(
  env: DbEnv,
  letter: Letter,
  actor: Actor,
  cid: string,
): Promise<WriteResult> {
  const claims = await loadClaims(env, letter.id);
  const idx = claims.findIndex(c => c.id === cid);
  if (idx < 0) fail(404, 'UNKNOWN_CLAIM', `no claim ${cid} on this letter`);
  const signers = await loadSigners(env, letter.id);
  const next = claims.filter(c => c.id !== cid);
  return writeRevision(env, {
    letter,
    actor,
    action: `delete claim ${cid}`,
    activity: { kind: 'delete', summary: `${actorLabel(actor)} deleted claim ${idx + 1}` },
    claims: next,
    signers,
    statements: [
      env.DB.prepare('DELETE FROM claims WHERE id = ?').bind(cid),
      env.DB.prepare(
        "UPDATE proposals SET status = 'stale' WHERE letter_id = ? AND claim_id = ? AND status = 'pending'",
      ).bind(letter.id, cid),
    ],
  });
}

// ---------------------------------------------------------------------------
// Proposals
// ---------------------------------------------------------------------------

export type ProposalInput =
  | { kind: 'claim'; input: ClaimInput }
  | { kind: 'edit'; claim_id: string; field: ClaimField; text: string }
  | { kind: 'impact'; text: string };

export interface CreatedProposal {
  proposal: Proposal;
  payload: ClaimProposalPayload | EditProposalPayload | ImpactProposalPayload;
  diff: WordDiff | null;
  anchor: Anchor | null;
  pending_count: number;
}

export async function createProposal(
  env: DbEnv,
  letter: Letter,
  rule: RuleCacheParsed,
  viewer: Viewer,
  actor: Actor,
  base_rev: string,
  input: ProposalInput,
): Promise<CreatedProposal> {
  requireOpen(letter);
  const pending = await loadProposals(env, letter.id, ['pending']);
  if (pending.length >= LIMITS.pending_per_letter) {
    fail(
      429,
      'PENDING_LIMIT',
      `${pending.length} proposals are waiting for a person; ask them to accept or reject first`,
    );
  }
  const claims = await loadClaims(env, letter.id);
  const now = new Date().toISOString();
  let payload: ClaimProposalPayload | EditProposalPayload | ImpactProposalPayload;
  let diff: WordDiff | null = null;
  let anchor: Anchor | null = null;
  let claim_id: string | null = null;
  let field: ClaimField | null = null;
  let proposed_for_user_id: string | null = null;
  let summary: string;

  if (input.kind === 'claim') {
    if (claims.length >= LIMITS.claims_per_letter)
      fail(409, 'LIMIT', `a letter holds at most ${LIMITS.claims_per_letter} claims`);
    anchor = requireAnchor(rule, input.input.quote);
    payload = { ...input.input, anchor };
    summary = `${actorLabel(actor)} proposed a ${input.input.position} claim · anchored p. ${anchor.page} · ${anchor.start}–${anchor.end} (against ${base_rev})`;
  } else if (input.kind === 'edit') {
    const claim = claims.find(c => c.id === input.claim_id);
    if (!claim) fail(404, 'UNKNOWN_CLAIM', `no claim ${input.claim_id} on this letter`);
    const was = claim[input.field];
    if (was === input.text) fail(409, 'NO_CHANGE', `${input.field} already equals that text`);
    if (input.field === 'quote') anchor = requireAnchor(rule, input.text);
    if (input.field === 'position' && !['support', 'oppose', 'modify'].includes(input.text)) {
      fail(400, 'INVALID', 'text: position must be support, oppose or modify');
    }
    claim_id = claim.id;
    field = input.field;
    diff = wordDiff(was, input.text);
    payload = { field, text: input.text, was, anchor };
    summary = `${actorLabel(actor)} proposed an edit to ${field.replace('_', ' ')} on claim ${claims.indexOf(claim) + 1} (against ${base_rev})`;
  } else {
    if (!viewer.signed_in || !viewer.user_id) {
      fail(
        401,
        'NOT_SIGNED_IN',
        'sign in with ChatGPT; an impact statement can be drafted only for the signed-in person',
      );
    }
    const already = pending.find(
      p => p.kind === 'impact' && p.proposed_for_user_id === viewer.user_id,
    );
    if (already)
      fail(
        409,
        'ALREADY_PENDING',
        `${viewer.display_name} already has a pending impact draft (${already.id})`,
      );
    proposed_for_user_id = viewer.user_id;
    // The display name rides in payload_json (never in the API body) so the 403 hint and the
    // state card can name the person without exposing a user id; toPending strips it.
    payload = { text: input.text, for_display_name: viewer.display_name } as ImpactProposalPayload;
    summary = `${actorLabel(actor)} drafted an impact statement for ${viewer.display_name} (against ${base_rev})`;
  }

  const proposal: Proposal = {
    id: newId('p_'),
    letter_id: letter.id,
    base_rev,
    kind: input.kind,
    claim_id,
    field,
    payload_json: JSON.stringify(payload),
    diff_json: diff ? JSON.stringify(diff) : null,
    status: 'pending',
    proposed_by: actor,
    proposed_for_user_id,
    decided_by: null,
    decided_at: null,
    created_at: now,
  };
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO proposals (id, letter_id, base_rev, kind, claim_id, field, payload_json, diff_json, status, proposed_by, proposed_for_user_id, decided_by, decided_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, NULL, NULL, ?)`,
    ).bind(
      proposal.id,
      proposal.letter_id,
      proposal.base_rev,
      proposal.kind,
      proposal.claim_id,
      proposal.field,
      proposal.payload_json,
      proposal.diff_json,
      proposal.proposed_by,
      proposal.proposed_for_user_id,
      proposal.created_at,
    ),
    env.DB.prepare(
      'INSERT INTO activity (letter_id, actor, kind, summary, created_at) VALUES (?, ?, ?, ?, ?)',
    ).bind(letter.id, actor, 'proposal', summary.slice(0, 200), now),
  ]);
  return { proposal, payload, diff, anchor, pending_count: pending.length + 1 };
}

export interface DecideResult {
  status: 'accepted' | 'rejected';
  rev: string;
  rev_no: number;
  claim_id?: string;
}

export async function decideProposal(
  env: DbEnv,
  letter: Letter,
  viewer: Viewer,
  actor: Actor,
  pid: string,
  decision: 'accept' | 'reject',
): Promise<DecideResult> {
  const proposal = await loadProposal(env, letter.id, pid);
  if (proposal.status !== 'pending' && proposal.status !== 'stale') {
    fail(409, 'NO_CHANGE', `proposal ${pid} is already ${proposal.status}`);
  }
  const now = new Date().toISOString();
  const claims = await loadClaims(env, letter.id);
  const signers = await loadSigners(env, letter.id);
  const claimIndex = proposal.claim_id ? claims.findIndex(c => c.id === proposal.claim_id) : -1;
  const describe =
    proposal.kind === 'claim'
      ? 'a new claim'
      : proposal.kind === 'edit'
        ? `an edit to ${proposal.field?.replace('_', ' ')} on claim ${claimIndex + 1}`
        : 'an impact draft';

  if (decision === 'reject') {
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE proposals SET status = 'rejected', decided_by = ?, decided_at = ? WHERE id = ?",
      ).bind(actor, now, pid),
      env.DB.prepare(
        'INSERT INTO activity (letter_id, actor, kind, summary, created_at) VALUES (?, ?, ?, ?, ?)',
      ).bind(
        letter.id,
        actor,
        'reject',
        `${actorLabel(actor)} rejected ${describe} proposed by ${actorLabel(proposal.proposed_by)}`,
        now,
      ),
    ]);
    return { status: 'rejected', rev: shortRev(letter.rev_hash), rev_no: letter.rev_no };
  }

  if (proposal.kind === 'impact' && proposal.proposed_for_user_id !== viewer.user_id) {
    const forName = (JSON.parse(proposal.payload_json) as { for_display_name?: string })
      .for_display_name;
    const who =
      signers.find(s => s.user_id === proposal.proposed_for_user_id)?.display_name ??
      forName ??
      'the person it is for';
    fail(403, 'FORBIDDEN', `Only ${who} can accept this`);
  }
  requireOpen(letter);
  const decided = env.DB.prepare(
    "UPDATE proposals SET status = 'accepted', decided_by = ?, decided_at = ? WHERE id = ?",
  ).bind(actor, now, pid);

  if (proposal.kind === 'claim') {
    if (claims.length >= LIMITS.claims_per_letter)
      fail(409, 'LIMIT', `a letter holds at most ${LIMITS.claims_per_letter} claims`);
    const payload = JSON.parse(proposal.payload_json) as ClaimProposalPayload;
    const claim = claimRow(
      letter.id,
      (claims.at(-1)?.ord ?? 0) + 1,
      payload,
      payload.anchor,
      proposal.proposed_by,
      actor,
    );
    const write = await writeRevision(env, {
      letter,
      actor,
      action: `accept claim ${claim.id}`,
      activity: {
        kind: 'accept',
        summary: `${actorLabel(actor)} accepted claim ${claims.length + 1} proposed by ${actorLabel(proposal.proposed_by)} · p. ${claim.page}`,
      },
      claims: [...claims, claim],
      signers,
      statements: [insertClaimStmt(env, claim), decided],
    });
    return { status: 'accepted', ...write, claim_id: claim.id };
  }

  if (proposal.kind === 'edit') {
    const payload = JSON.parse(proposal.payload_json) as EditProposalPayload & {
      stale?: { by: Actor };
    };
    if (claimIndex < 0) fail(404, 'UNKNOWN_CLAIM', `claim ${proposal.claim_id} no longer exists`);
    const claim = claims[claimIndex];
    const field = payload.field;
    const current = claim[field];
    if (current !== payload.was || proposal.status === 'stale') {
      const changes = await changedSince(env, letter, proposal.base_rev);
      const by =
        changes.find(c => c.claim_id === claim.id && c.field === field)?.by ??
        payload.stale?.by ??
        'human:unknown';
      await env.DB.batch([
        env.DB.prepare("UPDATE proposals SET status = 'stale' WHERE id = ?").bind(pid),
        env.DB.prepare(
          'INSERT INTO activity (letter_id, actor, kind, summary, created_at) VALUES (?, ?, ?, ?, ?)',
        ).bind(
          letter.id,
          actor,
          'stale',
          `Stale proposal: ${actorLabel(by)} changed ${field.replace('_', ' ')} on claim ${claimIndex + 1} after it was proposed`,
          now,
        ),
      ]);
      fail(
        409,
        'STALE_PROPOSAL',
        `${actorLabel(by)} changed ${field} on claim ${claimIndex + 1} after this was proposed`,
        {
          field,
          was: payload.was,
          now: current,
          by,
        },
      );
    }
    const updated: Claim = { ...claim, updated_at: now };
    if (field === 'quote') {
      updated.quote = payload.text;
      updated.anchor_start = payload.anchor?.start ?? null;
      updated.anchor_end = payload.anchor?.end ?? null;
      updated.page = payload.anchor?.page ?? null;
      updated.anchor_status = payload.anchor ? 'anchored' : 'unverified';
    } else if (field === 'position') {
      updated.position = payload.text as Position;
    } else {
      updated[field] = payload.text;
    }
    const next = [...claims];
    next[claimIndex] = updated;
    const write = await writeRevision(env, {
      letter,
      actor,
      action: `accept edit ${claim.id} ${field}`,
      activity: {
        kind: 'accept',
        summary: `${actorLabel(actor)} accepted ${actorLabel(proposal.proposed_by)}'s edit to ${field.replace('_', ' ')} on claim ${claimIndex + 1}`,
      },
      claims: next,
      signers,
      statements: [
        env.DB.prepare(
          'UPDATE claims SET quote = ?, anchor_start = ?, anchor_end = ?, page = ?, anchor_status = ?, position = ?, assertion = ?, requested_change = ?, evidence = ?, updated_at = ? WHERE id = ?',
        ).bind(
          updated.quote,
          updated.anchor_start,
          updated.anchor_end,
          updated.page,
          updated.anchor_status,
          updated.position,
          updated.assertion,
          updated.requested_change,
          updated.evidence,
          now,
          claim.id,
        ),
        decided,
      ],
    });
    return { status: 'accepted', ...write, claim_id: claim.id };
  }

  // impact
  const payload = JSON.parse(proposal.payload_json) as ImpactProposalPayload;
  const uid = proposal.proposed_for_user_id as string;
  const existing = signers.find(s => s.user_id === uid);
  const signer: Signer = existing
    ? { ...existing, impact_text: payload.text }
    : {
        letter_id: letter.id,
        user_id: uid,
        display_name: viewer.display_name,
        impact_text: payload.text,
        signed_at: null,
        added_at: now,
      };
  if (!existing && signers.length >= LIMITS.signers_per_letter)
    fail(409, 'SIGNER_LIMIT', `a letter holds at most ${LIMITS.signers_per_letter} signers`);
  const nextSigners = existing
    ? signers.map(s => (s.user_id === uid ? signer : s))
    : [...signers, signer];
  const write = await writeRevision(env, {
    letter,
    actor,
    action: `accept impact ${uid.slice(0, 8)}`,
    activity: {
      kind: 'accept',
      summary: `${signer.display_name} accepted the impact statement drafted by ${actorLabel(proposal.proposed_by)}`,
    },
    claims,
    signers: nextSigners,
    statements: [
      existing
        ? env.DB.prepare(
            'UPDATE signers SET impact_text = ? WHERE letter_id = ? AND user_id = ?',
          ).bind(payload.text, letter.id, uid)
        : env.DB.prepare(
            'INSERT INTO signers (letter_id, user_id, display_name, impact_text, signed_at, added_at) VALUES (?, ?, ?, ?, NULL, ?)',
          ).bind(letter.id, uid, signer.display_name, payload.text, now),
      decided,
    ],
  });
  return { status: 'accepted', ...write };
}

// ---------------------------------------------------------------------------
// Signers (all for the session user only)
// ---------------------------------------------------------------------------

export function requireSignedIn(viewer: Viewer): string {
  if (!viewer.signed_in || !viewer.user_id)
    fail(401, 'NOT_SIGNED_IN', 'sign in with ChatGPT to sign on');
  return viewer.user_id;
}

export async function addSelfAsSigner(
  env: DbEnv,
  letter: Letter,
  viewer: Viewer,
  actor: Actor,
): Promise<WriteResult> {
  const uid = requireSignedIn(viewer);
  const claims = await loadClaims(env, letter.id);
  const signers = await loadSigners(env, letter.id);
  if (signers.some(s => s.user_id === uid))
    fail(409, 'ALREADY_SIGNER', `${viewer.display_name} is already a signer`);
  if (signers.length >= LIMITS.signers_per_letter)
    fail(409, 'SIGNER_LIMIT', `a letter holds at most ${LIMITS.signers_per_letter} signers`);
  const now = new Date().toISOString();
  const signer: Signer = {
    letter_id: letter.id,
    user_id: uid,
    display_name: viewer.display_name,
    impact_text: null,
    signed_at: null,
    added_at: now,
  };
  return writeRevision(env, {
    letter,
    actor,
    action: `add signer ${uid.slice(0, 8)}`,
    activity: { kind: 'signer', summary: `${viewer.display_name} added themselves as a signer` },
    claims,
    signers: [...signers, signer],
    statements: [
      env.DB.prepare(
        'INSERT INTO signers (letter_id, user_id, display_name, impact_text, signed_at, added_at) VALUES (?, ?, ?, NULL, NULL, ?)',
      ).bind(letter.id, uid, viewer.display_name, now),
    ],
  });
}

export async function updateSelfSigner(
  env: DbEnv,
  letter: Letter,
  viewer: Viewer,
  actor: Actor,
  change: { impact_text?: string; display_name?: string; sign?: true; remove?: true },
): Promise<WriteResult> {
  const uid = requireSignedIn(viewer);
  const claims = await loadClaims(env, letter.id);
  const signers = await loadSigners(env, letter.id);
  const me = signers.find(s => s.user_id === uid);
  if (!me) fail(404, 'NOT_SIGNER', `${viewer.display_name} is not a signer yet`);
  const now = new Date().toISOString();
  if (change.remove) {
    return writeRevision(env, {
      letter,
      actor,
      action: `remove signer ${uid.slice(0, 8)}`,
      activity: { kind: 'signer', summary: `${me.display_name} removed themselves as a signer` },
      claims,
      signers: signers.filter(s => s.user_id !== uid),
      statements: [
        env.DB.prepare('DELETE FROM signers WHERE letter_id = ? AND user_id = ?').bind(
          letter.id,
          uid,
        ),
      ],
    });
  }
  const updated: Signer = { ...me };
  let action = '';
  let summary = '';
  if (change.impact_text !== undefined) {
    updated.impact_text = change.impact_text || null;
    action = `impact ${uid.slice(0, 8)}`;
    summary = `${me.display_name} ${change.impact_text ? 'wrote' : 'cleared'} their impact statement`;
  }
  if (change.display_name !== undefined) {
    updated.display_name = sanitizeDisplayName(change.display_name);
    action = `display_name ${uid.slice(0, 8)}`;
    summary = `A signer set their public display name to ${updated.display_name}`;
  }
  if (change.sign) {
    if (me.display_name === 'Signer')
      fail(400, 'INVALID', 'display_name: set your public display name before signing');
    updated.signed_at = now;
    action = `sign ${uid.slice(0, 8)}`;
    summary = `${me.display_name} signed the letter`;
  }
  return writeRevision(env, {
    letter,
    actor,
    action,
    activity: { kind: 'signer', summary },
    claims,
    signers: signers.map(s => (s.user_id === uid ? updated : s)),
    statements: [
      env.DB.prepare(
        'UPDATE signers SET display_name = ?, impact_text = ?, signed_at = ? WHERE letter_id = ? AND user_id = ?',
      ).bind(updated.display_name, updated.impact_text, updated.signed_at, letter.id, uid),
    ],
  });
}

/** Owner removes a signer (P8). */
export async function removeSigner(
  env: DbEnv,
  letter: Letter,
  actor: Actor,
  user_id: string,
): Promise<WriteResult> {
  const claims = await loadClaims(env, letter.id);
  const signers = await loadSigners(env, letter.id);
  const gone = signers.find(s => s.user_id === user_id);
  if (!gone) fail(404, 'NOT_SIGNER', 'no such signer on this letter');
  return writeRevision(env, {
    letter,
    actor,
    action: `remove signer ${user_id.slice(0, 8)}`,
    activity: {
      kind: 'signer',
      summary: `${actorLabel(actor)} removed ${gone.display_name} as a signer`,
    },
    claims,
    signers: signers.filter(s => s.user_id !== user_id),
    statements: [
      env.DB.prepare('DELETE FROM signers WHERE letter_id = ? AND user_id = ?').bind(
        letter.id,
        user_id,
      ),
    ],
  });
}

// ---------------------------------------------------------------------------
// Undo (4.4): a new revision equal to snapshot N−1
// ---------------------------------------------------------------------------

export async function undoLast(env: DbEnv, letter: Letter, actor: Actor): Promise<WriteResult> {
  if (letter.rev_no <= 1) fail(409, 'NO_CHANGE', 'nothing to undo');
  const prev = await env.DB.prepare('SELECT * FROM revisions WHERE letter_id = ? AND rev_no = ?')
    .bind(letter.id, letter.rev_no - 1)
    .first<Revision>();
  if (!prev) fail(409, 'NO_CHANGE', 'previous revision is missing');
  const snapshot = JSON.parse(prev.snapshot_json) as Snapshot;
  const claims = await loadClaims(env, letter.id);
  const signers = await loadSigners(env, letter.id);
  const now = new Date().toISOString();
  const byId = new Map(claims.map(c => [c.id, c]));
  const restoredClaims: Claim[] = snapshot.claims.map(sc => {
    const c = byId.get(sc.id);
    return {
      ...(c ?? {
        letter_id: letter.id,
        proposed_by: null,
        accepted_by: null,
        accepted_at: null,
        created_at: now,
      }),
      ...sc,
      letter_id: letter.id,
      updated_at: now,
    } as Claim;
  });
  const bySigner = new Map(signers.map(s => [s.user_id, s]));
  const restoredSigners: Signer[] = snapshot.signers.map(ss => ({
    letter_id: letter.id,
    added_at: bySigner.get(ss.user_id)?.added_at ?? now,
    ...ss,
  }));
  const statements: D1PreparedStatement[] = [
    env.DB.prepare('DELETE FROM claims WHERE letter_id = ?').bind(letter.id),
    ...restoredClaims.map(c => insertClaimStmt(env, c)),
    env.DB.prepare('DELETE FROM signers WHERE letter_id = ?').bind(letter.id),
    ...restoredSigners.map(s =>
      env.DB.prepare(
        'INSERT INTO signers (letter_id, user_id, display_name, impact_text, signed_at, added_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).bind(s.letter_id, s.user_id, s.display_name, s.impact_text, s.signed_at, s.added_at),
    ),
  ];
  return writeRevision(env, {
    letter,
    actor,
    action: `undo to rev ${prev.rev_no}`,
    activity: {
      kind: 'undo',
      summary: `${actorLabel(actor)} undid the last change (restored rev ${prev.rev_no} as rev ${letter.rev_no + 1})`,
    },
    claims: restoredClaims,
    signers: restoredSigners,
    statements,
    letterColumns: { document_number: snapshot.document_number ?? letter.document_number },
  });
}

// ---------------------------------------------------------------------------
// Checklist and state (export lives in server/export.ts)
// ---------------------------------------------------------------------------

export function computeMissing(
  letter: Letter,
  claims: readonly Claim[],
  signers: readonly Signer[],
): string[] {
  const missing: string[] = [];
  if (!letter.document_number) missing.push('attach a rule');
  if (claims.length === 0) missing.push('at least one claim');
  claims.forEach((c, i) => {
    if (c.anchor_status !== 'anchored')
      missing.push(`claim ${i + 1} quote is not in the rule text`);
    if (!c.requested_change.trim()) missing.push(`claim ${i + 1} has no requested change`);
  });
  if (signers.length === 0) missing.push('no signer yet (optional: sign in and add yourself)');
  for (const s of signers) if (!s.signed_at) missing.push(`${s.display_name} has not signed`);
  if (isClosed(letter.comments_close_on))
    missing.push(`comment period closed ${letter.comments_close_on}`);
  return missing;
}

/** Signers as the API returns them: no user ids, only the viewer's own membership flag. */
export function stateSigners(signers: readonly Signer[], viewer: Viewer): StateSigner[] {
  return signers.map<StateSigner>(s => ({
    display_name: s.display_name,
    impact_text: s.impact_text,
    signed_at: s.signed_at,
    added_at: s.added_at,
    is_viewer: s.user_id === viewer.user_id,
  }));
}

export function toPending(p: Proposal, signers: readonly Signer[]): PendingProposal {
  const payload = JSON.parse(p.payload_json) as PendingProposal['payload'] & {
    stale?: PendingProposal['stale'];
    for_display_name?: string;
  };
  const { stale, for_display_name, ...rest } = payload;
  const out: PendingProposal = {
    proposal_id: p.id,
    kind: p.kind,
    claim_id: p.claim_id,
    field: p.field,
    base_rev: p.base_rev,
    payload: rest as PendingProposal['payload'],
    diff: p.diff_json ? (JSON.parse(p.diff_json) as WordDiff) : null,
    by: p.proposed_by,
    proposed_for_user_id: null,
    created_at: p.created_at,
    stale:
      p.status === 'stale'
        ? (stale ?? {
            field: (p.field ?? 'assertion') as ClaimField,
            by: 'human:unknown',
            at: p.created_at,
          })
        : null,
  };
  if (p.kind === 'impact') {
    out.for_display_name =
      signers.find(s => s.user_id === p.proposed_for_user_id)?.display_name ?? for_display_name;
  }
  return out;
}

export async function buildState(
  env: DbEnv,
  letter: Letter,
  rule: RuleCacheParsed | null,
  viewer: Viewer,
  can_edit: boolean,
): Promise<LetterState> {
  const [claims, signers, proposals, activity] = await Promise.all([
    loadClaims(env, letter.id),
    loadSigners(env, letter.id),
    loadProposals(env, letter.id),
    loadActivity(env, letter.id),
  ]);
  const pending = proposals.map(p => {
    const pp = toPending(p, signers);
    if (p.kind === 'impact' && p.proposed_for_user_id === viewer.user_id)
      pp.proposed_for_user_id = 'me';
    if (p.kind === 'impact' && !pp.for_display_name && p.proposed_for_user_id === viewer.user_id)
      pp.for_display_name = viewer.display_name;
    return pp;
  });
  const state: LetterState = {
    letter: {
      id: letter.id,
      share_code: can_edit ? letter.share_code : '',
      public_token: letter.public_token,
      rev: shortRev(letter.rev_hash),
      rev_hash: letter.rev_hash,
      rev_no: letter.rev_no,
      is_judge_copy: letter.is_judge_copy === 1,
      created_at: letter.created_at,
      updated_at: letter.updated_at,
      rule_sha256: letter.rule_sha256,
    },
    rule: rule ? ruleHeader(rule) : null,
    claims,
    signers: stateSigners(signers, viewer),
    pending,
    missing: computeMissing(letter, claims, signers),
    activity,
    viewer: {
      signed_in: viewer.signed_in,
      display_name: viewer.display_name,
      is_signer: signers.some(s => s.user_id === viewer.user_id),
      can_edit,
    },
    closed: isClosed(letter.comments_close_on),
    days_left: letter.comments_close_on ? daysLeft(letter.comments_close_on) : null,
  };
  if (!can_edit) {
    // docs/API.md: share_code is omitted (not blanked) when the caller cannot edit.
    delete (state.letter as { share_code?: string }).share_code;
  }
  return state;
}

/** 'HH:MM' NY clock for attribution footers. */
export const clock = clockNY;
export const today = todayNY;
