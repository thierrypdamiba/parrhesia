// Judge path (PLAN.md 2.2 item 9, P6): fork a private letter from the shipped seed so every
// judge sees the same deterministic contents without an agent. The rule text is the snapshot
// in seed/2026-17902.txt (source_kind 'seed'); the letter's rule_sha256 is pinned to it.
// No Workers import: routes pass `env`, so node:test can exercise the pure parts.

import seedDetailRaw from '../seed/2026-17902.detail.json?raw';
import seedSpec from '../seed/2026-17902.json';
import seedText from '../seed/2026-17902.txt?raw';
import { locate, nearest } from './anchor';
import type { DbEnv } from './envvars';
import { getCachedRule, storeRule, type FrDocument } from './fr';
import { sha256Hex } from './identity';
import {
  actorLabel,
  bindRule,
  createLetter,
  createProposal,
  loadClaims,
  loadLetter,
  loadSigners,
  newId,
  shortRev,
  writeRevision,
} from './letter';
import { normalizeRule } from './normalize';
import type {
  Actor,
  Anchor,
  Claim,
  Letter,
  NearestPassage,
  Position,
  RuleCacheParsed,
  Viewer,
} from './types';

// ---------------------------------------------------------------------------
// The seed, typed
// ---------------------------------------------------------------------------

export interface SeedClaim {
  quote: string;
  position: Position;
  assertion: string;
  requested_change: string;
}
export interface SeedPending extends SeedClaim {
  kind: 'claim';
}
export interface SeedSpec {
  document_number: string;
  claims: SeedClaim[];
  pending: SeedPending[];
}

export const SEED: SeedSpec = seedSpec as SeedSpec;
export const SEED_DOCUMENT_NUMBER = SEED.document_number;
/** The day the snapshot was taken from federalregister.gov (README, judge banner). */
export const SEED_SNAPSHOT_DATE = '2026-09-03';
export const SEED_SOURCE_URL =
  'https://www.federalregister.gov/documents/full_text/text/2026/09/01/2026-17902.txt';
/** Actor stamped on the seeded pending proposal (P6). */
export const JUDGE_AGENT_ACTOR: Actor = 'agent-of:Judge demo';

/** Expected anchors for the seed (PLAN.md Appendix A); drift is logged, never hidden. */
export const SEED_EXPECTED = {
  claim1: { start: 40935, end: 41136, page: 56101 },
  claim2: { start: 20073, end: 20230, page: 56098 },
  pending: { start: 28833, end: 29088, page: 56099 },
  bad_nearest_start: 20073,
  text_length: 44458,
  sha256_prefix: 'fc22cd12737d1979',
} as const;

export function seedDetail(): FrDocument {
  return JSON.parse(seedDetailRaw) as FrDocument;
}

export function seedRawText(): string {
  return seedText;
}

/** The normalized seed snapshot (pure; what rules_cache will hold). */
export function normalizeSeed() {
  return normalizeRule(seedText, 'seed');
}

// ---------------------------------------------------------------------------
// rules_cache: the seed row, pinned
// ---------------------------------------------------------------------------

/**
 * Ensure rules_cache holds 2026-17902 from the shipped snapshot. An existing row whose text
 * hashes to the seed's sha256 is kept as-is (live fetch and seed agree); any other row is
 * replaced by the seed so the judge anchors stay deterministic (2.2 item 9 "pinned").
 */
export async function ensureSeedRule(env: DbEnv): Promise<RuleCacheParsed> {
  const seedSha = await sha256Hex(normalizeSeed().text);
  const cached = await getCachedRule(env, SEED_DOCUMENT_NUMBER);
  if (cached && cached.text_sha256 === seedSha) return cached;
  return storeRule(env, seedDetail(), seedText, 'seed', SEED_SOURCE_URL);
}

// ---------------------------------------------------------------------------
// Seed verdicts (pure)
// ---------------------------------------------------------------------------

export interface SeedVerdict {
  claim: SeedClaim;
  anchor: Anchor | null;
  nearest: NearestPassage[];
}

/** Locate every seed claim against a rule text; unverified ones carry the nearest passages. */
export function seedVerdicts(rule: RuleCacheParsed, claims: readonly SeedClaim[]): SeedVerdict[] {
  return claims.map(claim => {
    const anchor = locate(rule.text, rule.pages, rule.first_page, claim.quote);
    return {
      claim,
      anchor,
      nearest: anchor ? [] : nearest(rule.text, rule.pages, rule.first_page, claim.quote, 3),
    };
  });
}

function wordCount(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

/** The activity line for a refused quote (2.2 item 7 wording). */
export function refusalSummary(quote: string, near: readonly NearestPassage[]): string {
  const list = near.map(n => `p. ${n.page} ${n.start}–${n.end} (${n.score.toFixed(3)})`).join(', ');
  return `ANCHOR_NOT_FOUND refused a ${wordCount(quote)}-word quote; ${near.length} nearest passages returned: ${list}`;
}

// ---------------------------------------------------------------------------
// Fork
// ---------------------------------------------------------------------------

export interface ForkResult {
  letter: Letter;
  reused: boolean;
}

/** The judge letter named by the cookie, if it still exists and is a judge copy. */
export async function findJudgeLetter(
  env: DbEnv,
  letter_id: string | undefined,
): Promise<Letter | null> {
  if (!letter_id || !/^l_[a-z0-9]{8}$/.test(letter_id)) return null;
  try {
    const letter = await loadLetter(env, letter_id);
    return letter.is_judge_copy === 1 ? letter : null;
  } catch {
    return null;
  }
}

/**
 * Create a judge letter for `viewer`: bind the seed rule, insert claims 1–3 (1 and 2 anchored,
 * 3 unverified with its nearest passages in activity), seed one pending agent proposal, and
 * write explanatory activity lines. Returns the letter at its final revision.
 */
export async function forkSeedLetter(env: DbEnv, viewer: Viewer, actor: Actor): Promise<Letter> {
  const rule = await ensureSeedRule(env);
  const created = await createLetter(env, viewer, actor, { is_judge_copy: true });
  await bindRule(env, created, rule, actor);
  let letter = await loadLetter(env, created.id);

  // Claims 1–3 in one revision; every claim is accepted by the judge (the letter's owner).
  const verdicts = seedVerdicts(rule, SEED.claims);
  const now = new Date().toISOString();
  const claims: Claim[] = verdicts.map((v, i) => ({
    id: newId('c_'),
    letter_id: letter.id,
    ord: i + 1,
    quote: v.claim.quote,
    anchor_start: v.anchor?.start ?? null,
    anchor_end: v.anchor?.end ?? null,
    page: v.anchor?.page ?? null,
    anchor_status: v.anchor ? 'anchored' : 'unverified',
    position: v.claim.position,
    assertion: v.claim.assertion,
    requested_change: v.claim.requested_change,
    evidence: '',
    proposed_by: JUDGE_AGENT_ACTOR,
    accepted_by: actor,
    accepted_at: now,
    created_at: now,
    updated_at: now,
  }));
  warnOnDrift(claims);

  const extra: D1PreparedStatement[] = [];
  const activityStmt = (kind: string, summary: string, by: Actor = actor) =>
    env.DB.prepare(
      'INSERT INTO activity (letter_id, actor, kind, summary, created_at) VALUES (?, ?, ?, ?, ?)',
    ).bind(letter.id, by, kind, summary.slice(0, 200), now);

  extra.push(
    activityStmt(
      'judge',
      `Judge letter: a private copy for you. Rule text is the snapshot from ${SEED_SNAPSHOT_DATE} (source seed); the rule itself is live and closes ${rule.comments_close_on ?? 'later'}.`,
    ),
  );
  claims.forEach((c, i) => {
    const v = verdicts[i];
    extra.push(insertClaim(env, c));
    if (v.anchor) {
      extra.push(
        activityStmt(
          'claim',
          `Judge demo's agent proposed claim ${i + 1} (${c.position}) · anchored p. ${c.page} · ${c.anchor_start}–${c.anchor_end} · verifier norm-1; accepted by ${actorLabel(actor)}`,
          JUDGE_AGENT_ACTOR,
        ),
      );
    } else {
      extra.push(activityStmt('refusal', refusalSummary(c.quote, v.nearest), JUDGE_AGENT_ACTOR));
      extra.push(
        activityStmt(
          'claim-unverified',
          `Claim ${i + 1} is seeded on purpose with a paraphrase that is not in the rule text, so the refusal card and its three nearest passages are visible without an agent.`,
        ),
      );
    }
  });

  await writeRevision(env, {
    letter,
    actor,
    action: 'seed claims',
    activity: {
      kind: 'seed',
      summary: `${claims.length} claims seeded: ${claims.filter(c => c.anchor_status === 'anchored').length} anchored, ${claims.filter(c => c.anchor_status !== 'anchored').length} unverified`,
    },
    claims,
    signers: await loadSigners(env, letter.id),
    statements: extra,
  });
  letter = await loadLetter(env, letter.id);

  // One pending proposal by the demo agent, bound to the current revision, for a held Accept.
  for (const p of SEED.pending) {
    await createProposal(env, letter, rule, viewer, JUDGE_AGENT_ACTOR, shortRev(letter.rev_hash), {
      kind: 'claim',
      input: {
        quote: p.quote,
        position: p.position,
        assertion: p.assertion,
        requested_change: p.requested_change,
        evidence: '',
      },
    });
  }
  await env.DB.prepare(
    'INSERT INTO activity (letter_id, actor, kind, summary, created_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(
      letter.id,
      actor,
      'judge',
      'Press and hold Accept on the pending card to apply it (a click does nothing on purpose); there is no accept tool. Try an unverified quote in the box below the claims.',
      new Date().toISOString(),
    )
    .run();
  return loadLetter(env, letter.id);
}

/**
 * Reuse the judge letter named by the cookie unless `reset`; otherwise fork a fresh one.
 * The route sets the docket_judge cookie from `letter.id` and grants the share code.
 */
export async function forkOrReuse(
  env: DbEnv,
  viewer: Viewer,
  actor: Actor,
  opts: { reset: boolean; cookie_letter_id?: string },
): Promise<ForkResult> {
  if (!opts.reset) {
    const existing = await findJudgeLetter(env, opts.cookie_letter_id);
    if (existing) return { letter: existing, reused: true };
  }
  return { letter: await forkSeedLetter(env, viewer, actor), reused: false };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function insertClaim(env: DbEnv, c: Claim): D1PreparedStatement {
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

function sameAnchor(c: Claim, e: { start: number; end: number; page: number }): boolean {
  return c.anchor_start === e.start && c.anchor_end === e.end && c.page === e.page;
}

/** Appendix A numbers are the contract; log loudly if the normalizer drifted. */
function warnOnDrift(claims: readonly Claim[]): void {
  const [c1, c2, c3] = claims;
  if (c1 && !sameAnchor(c1, SEED_EXPECTED.claim1)) {
    console.warn(
      'judge seed drift: claim 1 anchored at',
      c1.anchor_start,
      c1.anchor_end,
      c1.page,
      'expected',
      SEED_EXPECTED.claim1,
    );
  }
  if (c2 && !sameAnchor(c2, SEED_EXPECTED.claim2)) {
    console.warn(
      'judge seed drift: claim 2 anchored at',
      c2.anchor_start,
      c2.anchor_end,
      c2.page,
      'expected',
      SEED_EXPECTED.claim2,
    );
  }
  if (c3 && c3.anchor_status !== 'unverified') {
    console.warn(
      'judge seed drift: claim 3 was expected to be unverified but anchored at',
      c3.anchor_start,
    );
  }
}

/** Fetch-free access to loadClaims for the route's response summary. */
export { loadClaims as loadJudgeClaims };
