// Frozen domain and tool contract types. Every lane builds against these.
// Section references are to docs/PLAN.md.

// ---------------------------------------------------------------------------
// Primitive aliases
// ---------------------------------------------------------------------------

/** ISO-8601 UTC timestamp, e.g. '2026-09-03T14:02:11.000Z' (4.3). */
export type IsoDateTime = string;
/** Calendar date 'YYYY-MM-DD' (4.1 item 3, comments_close_on). */
export type IsoDate = string;
/** Full 64-hex sha256 of the canonical letter JSON (4.4). */
export type RevHash = string;
/** First 12 hex chars of RevHash; what tools and the API call `base_rev` / `rev` (section 3 header, 4.4). */
export type Rev = string;
/** 'l_' + 8 [a-z0-9] (4.3, P3). */
export type LetterId = string;
/** 'c_' + 8 [a-z0-9] (4.3, P3). */
export type ClaimId = string;
/** 'p_' + 8 [a-z0-9] (4.3, P3). */
export type ProposalId = string;
/** hex sha256 of the lowercased sign-in email; never the email itself (4.4 Identity). */
export type UserId = string;
/** 'agent-of:<display_name|anon>' or 'human:<display_name|anon>' (P3). */
export type Actor = string;

/** Claim position enum shared by tools, API and DB (section 3 tool 4). */
export type Position = 'support' | 'oppose' | 'modify';
export const POSITIONS: readonly Position[] = ['support', 'oppose', 'modify'] as const;

/** Editable claim fields (section 3 tool 5). */
export type ClaimField = 'quote' | 'assertion' | 'requested_change' | 'evidence' | 'position';
export const CLAIM_FIELDS: readonly ClaimField[] = [
  'quote',
  'assertion',
  'requested_change',
  'evidence',
  'position',
] as const;

/** Anchor verdict stored on a claim (4.3 claims). */
export type AnchorStatus = 'anchored' | 'unverified';
/** Proposal kinds (4.3 proposals). */
export type ProposalKind = 'claim' | 'edit' | 'impact';
/** Proposal lifecycle (4.3 proposals, 4.4 Proposal rules). */
export type ProposalStatus = 'pending' | 'accepted' | 'rejected' | 'stale';
/** Where the rule text came from (4.3 rules_cache). */
export type SourceKind = 'txt' | 'xml' | 'seed';

// ---------------------------------------------------------------------------
// D1 rows (4.3) — column names are the row keys
// ---------------------------------------------------------------------------

/** letters row (4.3). Never carries the rule text. */
export interface Letter {
  id: LetterId;
  document_number: string | null;
  title: string | null;
  agency: string | null;
  agency_slug: string | null;
  docket_id: string | null;
  regs_document_id: string | null;
  comment_url: string | null;
  html_url: string | null;
  publication_date: IsoDate | null;
  comments_close_on: IsoDate | null;
  /** sha256 of the rules_cache text the anchors were verified against (4.3, P8 re-verification). */
  rule_sha256: string | null;
  rev_no: number;
  rev_hash: RevHash;
  owner_user_id: UserId | null;
  /** sha256 of the anonymous docket_owner cookie value (4.4 Identity). */
  owner_token_hash: string | null;
  /** 22-char base32; /l/{share_code} grants edit (4.4 Links). */
  share_code: string;
  /** 22-char base32; /r/{public_token} is read-only (4.4 Links). */
  public_token: string;
  is_judge_copy: 0 | 1;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

/** Page marker: normalized offset at which Federal Register page `page` begins (4.2). */
export interface PageMark {
  offset: number;
  page: number;
}

/** TOC entry: heading text and its normalized offset (4.2 TOC, tool 2 `toc`). */
export interface TocEntry {
  heading: string;
  start: number;
}

/** rules_cache row (4.3). JSON columns are stored as strings; RuleCacheParsed decodes them. */
export interface RuleCache {
  document_number: string;
  title: string | null;
  agency: string | null;
  comments_close_on: IsoDate | null;
  /** Normalized norm-1 text, ≤ 900,000 chars, always bound as a parameter (4.3). */
  text: string;
  text_sha256: string;
  first_page: number;
  pages_json: string;
  breaks_json: string;
  toc_json: string;
  source_url: string | null;
  source_kind: SourceKind;
  fetched_at: IsoDateTime;
  /** Raw federalregister.gov document detail JSON (4.1 item 3). */
  detail_json: string | null;
}

/** RuleCache with the JSON columns decoded (what server code passes around). */
export interface RuleCacheParsed extends Omit<
  RuleCache,
  'pages_json' | 'breaks_json' | 'toc_json'
> {
  pages: PageMark[];
  breaks: number[];
  toc: TocEntry[];
}

/** fr_cache row: 15-minute cache of federalregister.gov JSON keyed by full URL (4.1 item 1, 4.3). */
export interface FrCache {
  key: string;
  body: string;
  fetched_at: IsoDateTime;
}

/** claims row (4.3). */
export interface Claim {
  id: ClaimId;
  letter_id: LetterId;
  ord: number;
  quote: string;
  anchor_start: number | null;
  anchor_end: number | null;
  page: number | null;
  anchor_status: AnchorStatus;
  position: Position;
  assertion: string;
  requested_change: string;
  evidence: string;
  proposed_by: Actor | null;
  accepted_by: Actor | null;
  accepted_at: IsoDateTime | null;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

/** Word-level diff for edit proposals (section 3 tool 5, P3 `diff_json`). */
export interface WordDiff {
  removed: string[];
  added: string[];
}

/** Payload of a `claim` proposal (section 3 tool 4). */
export interface ClaimProposalPayload {
  quote: string;
  position: Position;
  assertion: string;
  requested_change: string;
  evidence: string;
  anchor: Anchor | null;
}
/** Payload of an `edit` proposal (section 3 tool 5). */
export interface EditProposalPayload {
  field: ClaimField;
  text: string;
  /** The field's value at base_rev; the accept re-check compares against it (4.4 Proposal rules). */
  was: string;
  anchor?: Anchor | null;
}
/** Payload of an `impact` proposal (section 3 tool 6). */
export interface ImpactProposalPayload {
  text: string;
}
export type ProposalPayload = ClaimProposalPayload | EditProposalPayload | ImpactProposalPayload;

/** proposals row (4.3). */
export interface Proposal {
  id: ProposalId;
  letter_id: LetterId;
  base_rev: Rev;
  kind: ProposalKind;
  claim_id: ClaimId | null;
  field: ClaimField | null;
  payload_json: string;
  diff_json: string | null;
  status: ProposalStatus;
  proposed_by: Actor;
  /** Only for kind 'impact': the signed-in user the draft is for (4.4 Identity). */
  proposed_for_user_id: UserId | null;
  decided_by: Actor | null;
  decided_at: IsoDateTime | null;
  created_at: IsoDateTime;
}

/** signers row (4.3); max 25 per letter. */
export interface Signer {
  letter_id: LetterId;
  user_id: UserId;
  display_name: string;
  impact_text: string | null;
  signed_at: IsoDateTime | null;
  added_at: IsoDateTime;
}

/** revisions row (4.3); one per content change, PK (letter_id, rev_no) is the concurrency guard (4.4). */
export interface Revision {
  letter_id: LetterId;
  rev_no: number;
  rev_hash: RevHash;
  snapshot_json: string;
  actor: Actor;
  action: string;
  created_at: IsoDateTime;
}

/** activity row (4.3); summary ≤ 200 chars. */
export interface Activity {
  id: number;
  letter_id: LetterId;
  actor: Actor;
  kind: string;
  summary: string;
  created_at: IsoDateTime;
}

/** ratelimit row (4.3). */
export interface RateLimitRow {
  bucket: string;
  count: number;
}

// ---------------------------------------------------------------------------
// Canonical snapshot hashed into rev_hash (4.4) — key order is the contract
// ---------------------------------------------------------------------------

/** Claim as it appears in the canonical snapshot (4.4 rev_hash). Keys in exactly this order. */
export interface SnapshotClaim {
  id: ClaimId;
  ord: number;
  quote: string;
  anchor_start: number | null;
  anchor_end: number | null;
  page: number | null;
  anchor_status: AnchorStatus;
  position: Position;
  assertion: string;
  requested_change: string;
  evidence: string;
}
/** Signer as it appears in the canonical snapshot (4.4 rev_hash). Keys in exactly this order. */
export interface SnapshotSigner {
  user_id: UserId;
  display_name: string;
  impact_text: string | null;
  signed_at: IsoDateTime | null;
}
/** Canonical JSON hashed into rev_hash; claims sorted by ord then id, signers by user_id (4.4). */
export interface Snapshot {
  document_number: string | null;
  claims: SnapshotClaim[];
  signers: SnapshotSigner[];
}

// ---------------------------------------------------------------------------
// Anchoring (4.2, section 3 tools 3–5)
// ---------------------------------------------------------------------------

/** One exact occurrence of a normalized quote in the rule text (server/anchor.ts locate). */
export interface Occurrence {
  start: number;
  end: number;
  page: number;
}
/** Result of locate(): the first occurrence plus uniqueness (section 3 tool 4 `anchor`). */
export interface Anchor extends Occurrence {
  unique: boolean;
  /** All occurrences found, capped at 5 (P2 item 3). */
  occurrences: Occurrence[];
}
/** One nearest-passage candidate returned with ANCHOR_NOT_FOUND (section 3 tool 4, 4.2). */
export interface NearestPassage {
  /** Jaccard similarity, 3 decimal places. */
  score: number;
  start: number;
  end: number;
  page: number;
  /** ≤ 240 chars, markers verbatim. */
  text: string;
}
/** One passage served by read_rule (section 3 tool 3). */
export interface Passage {
  start: number;
  end: number;
  page: number;
  text: string;
}
/** Options for readPassages (P2 item 3). */
export interface ReadOptions {
  query?: string;
  start?: number;
  /** 200..1500, default 1200. */
  window?: number;
  /** 1..5, default 1. */
  max_passages?: number;
}
/** Result of readPassages (P2 item 3). */
export interface ReadResult {
  passages: Passage[];
  matches_total: number;
}

// ---------------------------------------------------------------------------
// Identity (4.4 Identity, P1)
// ---------------------------------------------------------------------------

/** What getViewer() derives from a request. The email is never stored, returned or shown. */
export interface Viewer {
  /** null when anonymous. */
  user_id: UserId | null;
  /** Sanitized full-name header, else 'Signer' (never the email local part). */
  display_name: string;
  signed_in: boolean;
  /** Value of the httpOnly docket_owner cookie (32 random chars); letters store its sha256. */
  owner_token: string;
}

/** GET /api/me response (P1). */
export interface MeResponse {
  signed_in: boolean;
  display_name: string;
  user_id: UserId | null;
  /** Present once after /api/signin?return_to=…; the page navigates there (4.4 Identity). */
  return_to?: string;
}

// ---------------------------------------------------------------------------
// Rule search rows (4.1 item 1, P2 item 1) — what the Worker returns for open rules
// ---------------------------------------------------------------------------

/** One open proposed rule as returned by GET /api/rules and find_open_rules (P2 item 1). */
export interface OpenRule {
  document_number: string;
  /** ≤ 90 chars. */
  title: string;
  /** Child agency name, ≤ 40 chars. */
  agency: string;
  agency_slug: string | null;
  comments_close_on: IsoDate;
  /** Calendar days from today in America/New_York; negative when closed. */
  days_left: number;
  docket_id: string | null;
  document_id: string | null;
  /** https regulations.gov comment form, or null when the rule has none (4.1 item 5). */
  comment_url: string | null;
  pages: number;
  html_url: string;
  matched_by?: 'document_number' | 'title';
}

/** Rule header stored on a letter and returned by open_rule / state (section 3 tool 2). */
export interface RuleHeader {
  document_number: string;
  title: string;
  agency: string;
  agency_slug?: string | null;
  docket_id: string | null;
  document_id: string | null;
  comment_url: string | null;
  html_url: string;
  publication_date?: IsoDate | null;
  comments_close_on: IsoDate;
  days_left: number;
  pages: { first: number; last: number };
  total_chars: number;
  fetched_at: IsoDateTime;
  source_kind: SourceKind;
  text_sha256: string;
}

// ---------------------------------------------------------------------------
// Letter state as returned by GET /api/letters/:id/state (P3) — never embeds rule text
// ---------------------------------------------------------------------------

/** One pending proposal with its payload and diff, for rendering proposal cards (P3 state). */
export interface PendingProposal {
  proposal_id: ProposalId;
  kind: ProposalKind;
  claim_id: ClaimId | null;
  field: ClaimField | null;
  base_rev: Rev;
  payload: ProposalPayload;
  diff: WordDiff | null;
  by: Actor;
  proposed_for_user_id: UserId | null;
  /** Display name of the person an impact draft is for (impact only); never a user id. */
  for_display_name?: string;
  created_at: IsoDateTime;
  /** Set when the server or client detected a human change to the target field (2.2 item 4). */
  stale?: { field: ClaimField; by: Actor; at: IsoDateTime } | null;
}

/** Activity feed line (2.2 item 7). */
export interface ActivityLine {
  id: number;
  actor: Actor;
  kind: string;
  summary: string;
  created_at: IsoDateTime;
}

/** Viewer block of the state response (P3). */
export interface StateViewer {
  signed_in: boolean;
  display_name: string;
  is_signer: boolean;
  can_edit: boolean;
}

/** Signer as rendered in state: no user ids leave the server except the viewer's own membership flag. */
export interface StateSigner {
  display_name: string;
  impact_text: string | null;
  signed_at: IsoDateTime | null;
  added_at: IsoDateTime;
  /** true when this row belongs to the viewer (so the UI knows which block is editable). */
  is_viewer: boolean;
}

/** Full letter state; `{unchanged:true}` is returned instead when ?rev= matches (P3). */
export interface LetterState {
  letter: {
    id: LetterId;
    share_code: string;
    public_token: string;
    rev: Rev;
    rev_hash: RevHash;
    rev_no: number;
    is_judge_copy: boolean;
    created_at: IsoDateTime;
    updated_at: IsoDateTime;
    rule_sha256: string | null;
  };
  rule: RuleHeader | null;
  claims: Claim[];
  signers: StateSigner[];
  pending: PendingProposal[];
  /** Checklist lines shown under 'Missing before filing' (2.2 item 6). */
  missing: string[];
  /** Last 20 activity lines, newest first (2.2 item 7). */
  activity: ActivityLine[];
  viewer: StateViewer;
  /** comments_close_on < today in America/New_York (2.3). */
  closed: boolean;
  days_left: number | null;
}
export interface UnchangedState {
  unchanged: true;
}
export type StateResponse = LetterState | UnchangedState;

/** Attribution for STALE_REVISION: what changed between base_rev and current (4.4 Atomic write). */
export interface ChangedSince {
  claim_id: ClaimId | null;
  field: ClaimField | 'claim' | 'signer' | 'impact' | 'signature';
  by: Actor;
  summary: string;
}

// ---------------------------------------------------------------------------
// Errors (section 3 header, 3 budgets, P1)
// ---------------------------------------------------------------------------

/** Every tool and API error. Extra keys (nearest, anchor, current_rev, …) ride alongside. */
export interface ApiError {
  error: ErrorCode;
  hint: string;
}

export type ErrorCode =
  | 'INTERNAL'
  | 'UNKNOWN_FIELD'
  | 'INVALID'
  | 'NOT_AVAILABLE'
  | 'NO_MATCH'
  | 'UPSTREAM_UNAVAILABLE'
  | 'RATE_LIMITED'
  | 'ALREADY_BOUND'
  | 'NOT_FOUND'
  | 'NOT_OPEN'
  | 'RULE_UNAVAILABLE'
  | 'RULE_TOO_LARGE'
  | 'FORBIDDEN'
  | 'NO_RULE'
  | 'NO_LETTER'
  | 'OUT_OF_RANGE'
  | 'ANCHOR_NOT_FOUND'
  | 'ANCHOR_NOT_READ'
  | 'ANCHOR_AMBIGUOUS'
  | 'STALE_REVISION'
  | 'STALE_PROPOSAL'
  | 'COMMENTS_CLOSED'
  | 'PENDING_LIMIT'
  | 'LIMIT'
  | 'UNKNOWN_CLAIM'
  | 'UNKNOWN_PROPOSAL'
  | 'NO_CHANGE'
  | 'NOT_SIGNED_IN'
  | 'ALREADY_PENDING'
  | 'ALREADY_SIGNER'
  | 'NOT_SIGNER'
  | 'HOLD_REQUIRED'
  | 'SIGNER_LIMIT'
  | 'NOT_IMPLEMENTED';

/** ANCHOR_NOT_FOUND carries the three nearest passages (section 3 tool 4). */
export interface AnchorNotFoundError extends ApiError {
  error: 'ANCHOR_NOT_FOUND';
  nearest: NearestPassage[];
}
/** ANCHOR_NOT_READ carries the anchor and the exact read_rule call (section 3 tool 4, 4.4). */
export interface AnchorNotReadError extends ApiError {
  error: 'ANCHOR_NOT_READ';
  anchor: Anchor;
  read_rule: { start: number; window: number };
}
/** ANCHOR_AMBIGUOUS lists the occurrences (section 3 tool 4). */
export interface AnchorAmbiguousError extends ApiError {
  error: 'ANCHOR_AMBIGUOUS';
  occurrences: Occurrence[];
}
/** STALE_REVISION names what changed since base_rev (section 3 tool 4, 4.4). */
export interface StaleRevisionError extends ApiError {
  error: 'STALE_REVISION';
  current_rev: Rev;
  changed_since: ChangedSince[];
}
/** STALE_PROPOSAL from decide when an edit's target field moved (4.4 Proposal rules). */
export interface StaleProposalError extends ApiError {
  error: 'STALE_PROPOSAL';
  field: ClaimField;
  was: string;
  now: string;
  by: Actor;
}
/** RULE_UNAVAILABLE carries the FR html_url so a person can still read the rule (section 3 tool 2). */
export interface RuleUnavailableError extends ApiError {
  error: 'RULE_UNAVAILABLE';
  html_url: string | null;
}

// ---------------------------------------------------------------------------
// Tool inputs and outputs (section 3) — one pair per tool
// ---------------------------------------------------------------------------

export type ToolName =
  | 'find_open_rules'
  | 'open_rule'
  | 'read_rule'
  | 'propose_claim'
  | 'propose_edit'
  | 'draft_my_impact'
  | 'get_letter'
  | 'ask_person_to_file';

/** Common trailer: every success carries a `next` hint; truncated outputs say so (section 3 budgets). */
export interface ToolOutputBase {
  next: string;
  truncated?: true;
}

/** Tool 1 input. */
export interface FindOpenRulesInput {
  query?: string;
  agency_slug?: string;
  closing_within_days?: number;
  limit?: number;
}
/** Tool 1 output (budget 1800). */
export interface FindOpenRulesOutput extends ToolOutputBase {
  as_of: IsoDateTime;
  open_total: number;
  count: number;
  rules: Array<{
    document_number: string;
    title: string;
    agency: string;
    comments_close_on: IsoDate;
    days_left: number;
    pages: number;
    matched_by?: 'document_number' | 'title';
  }>;
  refine?: {
    question: string;
    facet: 'agency';
    options: Array<{ agency_slug: string; name: string; count: number }>;
  };
  letter: { bound: false } | { bound: true; document_number: string };
}

/** Tool 2 input. */
export interface OpenRuleInput {
  document_number: string;
}
/** Tool 2 output (budget 1500). */
export interface OpenRuleOutput extends ToolOutputBase {
  letter_id: LetterId;
  share_url: string;
  rev: Rev;
  rule: {
    document_number: string;
    title: string;
    agency: string;
    docket_id: string | null;
    document_id: string | null;
    comment_url: string | null;
    comments_close_on: IsoDate;
    days_left: number;
    pages: { first: number; last: number };
    total_chars: number;
    fetched_at: IsoDateTime;
  };
  toc: TocEntry[];
}

/** Tool 3 input. */
export interface ReadRuleInput {
  query?: string;
  start?: number;
  window?: number;
  max_passages?: number;
}
/** Tool 3 output (budget 4500). */
export interface ReadRuleOutput extends ToolOutputBase {
  document_number: string;
  rev: Rev;
  total_chars: number;
  matches_total: number;
  passages: Passage[];
  read_ranges_recorded: number;
}

/**
 * The plain-words check on the claimant's own fields (docs/PLAIN-WORDS.md 4). Suggestions only:
 * nothing here blocks a proposal, and the quote field is never checked.
 */
export interface PlainWordsSuggestion {
  title: string;
  excerpt: string;
  fix: string;
}
export interface PlainWordsSummary {
  flags: number;
  /** The first three flags, so an agent can fix its own draft on the next proposal. */
  top: PlainWordsSuggestion[];
}

/** Tool 4 input. */
export interface ProposeClaimInput {
  base_rev: Rev;
  quote: string;
  position: Position;
  assertion: string;
  requested_change?: string;
  evidence?: string;
}
/** Tool 4 output (budget 1500). */
export interface ProposeClaimOutput extends ToolOutputBase {
  proposal_id: ProposalId;
  status: 'pending';
  base_rev: Rev;
  anchor: { start: number; end: number; page: number; unique: boolean };
  card: { position: Position; assertion: string; requested_change: string };
  needs_human: string;
  pending_count: number;
  plain_words: PlainWordsSummary;
}

/** Tool 5 input. */
export interface ProposeEditInput {
  base_rev: Rev;
  claim_id: ClaimId;
  field: ClaimField;
  text: string;
}
/** Tool 5 output (budget 1500). */
export interface ProposeEditOutput extends ToolOutputBase {
  proposal_id: ProposalId;
  status: 'pending';
  claim_id: ClaimId;
  field: ClaimField;
  diff: WordDiff;
  anchor?: { start: number; end: number; page: number; unique: boolean };
  needs_human: string;
}

/** Tool 6 input (no name field, by design: 4.4 Identity). */
export interface DraftMyImpactInput {
  base_rev: Rev;
  text: string;
}
/** Tool 6 output (budget 1500). */
export interface DraftMyImpactOutput extends ToolOutputBase {
  proposal_id: ProposalId;
  status: 'pending';
  for: string;
  preview: string;
  needs_human: string;
  plain_words: PlainWordsSummary;
}

/** Tool 7 input. */
export type GetLetterInput = Record<never, never>;
/** Tool 7 output (budget 1800). */
export interface GetLetterOutput extends ToolOutputBase {
  letter_id: LetterId;
  rev: Rev;
  rev_no: number;
  rule: {
    document_number: string;
    title: string;
    agency: string;
    comments_close_on: IsoDate;
    days_left: number;
    closed: boolean;
  } | null;
  claims: Array<{
    id: ClaimId;
    order: number;
    status: AnchorStatus;
    position: Position;
    page: number | null;
    quote_preview: string;
    assertion_preview: string;
    has_requested_change: boolean;
    /** Flags on this claim's assertion, requested change and evidence (never the quote). */
    plain_words: { flags: number };
  }>;
  /** '+N more' when claims were truncated to 6. */
  more_claims?: string;
  signers: Array<{ display_name: string; signed: boolean; has_impact: boolean }>;
  pending: Array<{ proposal_id: ProposalId; kind: ProposalKind; claim_id?: ClaimId; by: Actor }>;
  missing: string[];
  viewer: { signed_in: boolean; display_name?: string; is_signer: boolean };
  tools_now: ToolName[];
  tools_not_now: Array<{ name: ToolName; reason: string }>;
  /** PLAIN_WORDS_GUIDE, once per letter (docs/PLAIN-WORDS.md 4). */
  writing_guide: string;
}

/** Tool 8 input. */
export type AskPersonToFileInput = Record<never, never>;
/** Tool 8 output (budget 1500). Always needs_human:true. */
export interface AskPersonToFileOutput {
  needs_human: true;
  reason: string;
  comment_url: string | null;
  fallback_url: string;
  fallback_reason?: string;
  export_url: string;
  comments_close_on: IsoDate;
  days_left: number;
  missing: string[];
  ready: boolean;
}

/** Map from tool name to its input/output pair, for the registry's typing. */
export interface ToolIO {
  find_open_rules: { input: FindOpenRulesInput; output: FindOpenRulesOutput };
  open_rule: { input: OpenRuleInput; output: OpenRuleOutput };
  read_rule: { input: ReadRuleInput; output: ReadRuleOutput };
  propose_claim: { input: ProposeClaimInput; output: ProposeClaimOutput };
  propose_edit: { input: ProposeEditInput; output: ProposeEditOutput };
  draft_my_impact: { input: DraftMyImpactInput; output: DraftMyImpactOutput };
  get_letter: { input: GetLetterInput; output: GetLetterOutput };
  ask_person_to_file: { input: AskPersonToFileInput; output: AskPersonToFileOutput };
}

/** Every tool returns either its output or an ApiError (never throws) (P5). */
export type ToolResult<N extends ToolName> = ToolIO[N]['output'] | ApiError;

// ---------------------------------------------------------------------------
// Limits (section 3, 4.3, 4.4)
// ---------------------------------------------------------------------------

export const LIMITS = {
  /** Pending proposals per letter (section 3 tool 4 PENDING_LIMIT). */
  pending_per_letter: 5,
  /** Claims per letter (section 3 tool 4 LIMIT). */
  claims_per_letter: 40,
  /** Signers per letter (4.3). */
  signers_per_letter: 25,
  /** Minimum hold for accept/sign/delete/undo, ms (4.4; a consistency check, not security). */
  hold_ms: 700,
  /** Rule text cap in normalized chars (4.1 item 4). */
  rule_text_chars: 900_000,
  /** Activity lines returned in state (2.2 item 7). */
  activity_lines: 20,
  /** Display name length (4.4 Identity). */
  display_name_chars: 40,
  /** fr_cache TTL in ms (4.1 item 1). */
  fr_cache_ttl_ms: 15 * 60 * 1000,
} as const;

/** Rate-limit buckets per hour per IP (4.4 Links). */
export const RATE_LIMITS = {
  judge_forks: 30,
  letters: 60,
  proposals: 120,
  binds: 60,
  reads: 600,
} as const;
