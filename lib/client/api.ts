// Browser-side client for the HTTP contract in docs/API.md. Every write sends
// `x-docket-actor: human` unless the caller (a tool execute, src/webmcp/tools.ts) passes
// actor:'agent'.

import { ACTOR_HEADER } from '@/lib/app';
import type {
  Anchor,
  ApiError,
  Claim,
  ClaimField,
  NearestPassage,
  OpenRule,
  Position,
  ProposalKind,
  RuleHeader,
  StateResponse,
  StateSigner,
  TocEntry,
  WordDiff,
} from '@/server/types';

export type Actor = 'human' | 'agent';

/** A non-2xx response, carrying the `{error, hint, ...extra}` body. */
export class ApiFailure extends Error {
  readonly status: number;
  readonly body: ApiError & Record<string, unknown>;
  constructor(status: number, body: ApiError & Record<string, unknown>) {
    super(`${body.error}: ${body.hint}`);
    this.status = status;
    this.body = body;
  }
  get code(): string {
    return this.body.error;
  }
  get hint(): string {
    return this.body.hint;
  }
}

export function isFailure(err: unknown, code?: string): err is ApiFailure {
  return err instanceof ApiFailure && (code === undefined || err.code === code);
}

export function describeError(err: unknown): string {
  if (err instanceof ApiFailure) return `${err.code}: ${err.hint}`;
  if (err instanceof Error) return err.message;
  return 'unexpected error';
}

export interface FetchOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  actor?: Actor;
  signal?: AbortSignal;
}

export async function apiFetch<T>(path: string, opts: FetchOptions = {}): Promise<T> {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = { accept: 'application/json' };
  if (method !== 'GET') {
    headers['content-type'] = 'application/json';
    headers[ACTOR_HEADER] = opts.actor ?? 'human';
  }
  const res = await fetch(path, {
    method,
    headers,
    body: method === 'GET' ? undefined : JSON.stringify(opts.body ?? {}),
    credentials: 'same-origin',
    signal: opts.signal,
  });
  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  if (!res.ok) {
    const body =
      parsed && typeof parsed === 'object' && 'error' in parsed
        ? (parsed as ApiError & Record<string, unknown>)
        : {
            error: res.status === 404 ? 'NOT_FOUND' : 'INTERNAL',
            hint: `HTTP ${res.status} from ${path}`,
          };
    throw new ApiFailure(res.status, body as ApiError & Record<string, unknown>);
  }
  return parsed as T;
}

// ---------------------------------------------------------------------------
// Response shapes (docs/API.md)
// ---------------------------------------------------------------------------

export interface MeResponse {
  signed_in: boolean;
  display_name: string;
  user_id: string | null;
  return_to?: string;
}

export interface RulesResponse {
  as_of: string;
  open_total: number;
  count: number;
  rules: OpenRule[];
  refine?: {
    question: string;
    facet: 'agency';
    options: Array<{ agency_slug: string; name: string; count: number }>;
  };
  stale?: true;
}

export interface RuleMeta {
  document_number: string;
  total_chars: number;
  first_page: number;
  pages: Array<{ offset: number; page: number }>;
  breaks: number[];
  toc: TocEntry[];
  text_sha256: string;
  source_kind: 'txt' | 'xml' | 'seed';
  fetched_at: string;
}

export interface CreateLetterResult {
  letter_id: string;
  share_code: string;
  public_token: string;
  rev: string;
  rev_no: number;
  rule: RuleHeader | null;
  toc: TocEntry[];
}

export interface ResolveResult {
  letter_id: string;
  can_edit: boolean;
}

export interface VerifyResult {
  anchor: Anchor;
  normalized_quote: string;
}

export interface ProposalResult {
  proposal_id: string;
  status: 'pending';
  base_rev: string;
  kind: ProposalKind;
  claim_id?: string;
  field?: ClaimField;
  anchor?: Anchor;
  diff?: WordDiff;
  payload: unknown;
  pending_count: number;
}

export interface DecideResult {
  proposal_id: string;
  status: 'accepted' | 'rejected';
  rev: string;
  rev_no: number;
  claim_id?: string;
}

export interface ClaimWriteResult {
  claim: Claim;
  rev: string;
  rev_no: number;
  nearest?: NearestPassage[];
}

export interface RevResult {
  rev: string;
  rev_no: number;
}

export interface SignersResult {
  signers: StateSigner[];
  rev: string;
  rev_no: number;
}

export interface JudgeForkResult {
  letter_id: string;
  share_code: string;
  reused: boolean;
}

export interface ClaimBody {
  quote: string;
  position: Position;
  assertion: string;
  requested_change?: string;
  evidence?: string;
}

export type ProposalBody =
  | ({ kind: 'claim' } & ClaimBody)
  | { kind: 'edit'; claim_id: string; field: ClaimField; text: string }
  | { kind: 'impact'; text: string };

/** Everything the pages need from the server (docs/API.md). */
export interface LettersApi {
  me(): Promise<MeResponse>;
  rules(params: { query?: string; limit?: number }): Promise<RulesResponse>;
  ruleHeader(document_number: string): Promise<RuleHeader>;
  ruleMeta(document_number: string): Promise<RuleMeta>;
  ruleText(document_number: string): Promise<string>;

  createLetter(document_number?: string): Promise<CreateLetterResult>;
  resolveShare(share_code: string): Promise<ResolveResult>;
  resolvePublic(public_token: string): Promise<ResolveResult>;
  state(letter_id: string, rev?: string | null): Promise<StateResponse>;
  verify(letter_id: string, quote: string): Promise<VerifyResult>;
  propose(
    letter_id: string,
    base_rev: string,
    body: ProposalBody,
    actor?: Actor,
  ): Promise<ProposalResult>;
  decide(
    letter_id: string,
    proposal_id: string,
    decision: 'accept' | 'reject',
    hold_ms?: number,
  ): Promise<DecideResult>;
  addClaim(letter_id: string, base_rev: string, body: ClaimBody): Promise<ClaimWriteResult>;
  patchClaim(
    letter_id: string,
    claim_id: string,
    base_rev: string,
    field: ClaimField,
    text: string,
  ): Promise<ClaimWriteResult>;
  deleteClaim(
    letter_id: string,
    claim_id: string,
    base_rev: string,
    hold_ms: number,
  ): Promise<RevResult>;
  addSigner(letter_id: string, base_rev: string): Promise<SignersResult>;
  setImpact(letter_id: string, base_rev: string, impact_text: string): Promise<SignersResult>;
  setDisplayName(letter_id: string, base_rev: string, display_name: string): Promise<SignersResult>;
  sign(letter_id: string, base_rev: string, hold_ms: number): Promise<SignersResult>;
  undo(letter_id: string, base_rev: string, hold_ms: number): Promise<RevResult>;
  exportText(letter_id: string): Promise<string>;
  exportUrl(letter_id: string): string;
  judgeFork(reset: boolean): Promise<JudgeForkResult>;
}

const q = (params: Record<string, string | number | undefined>): string => {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params))
    if (v !== undefined && v !== '') usp.set(k, String(v));
  const s = usp.toString();
  return s ? `?${s}` : '';
};

const enc = encodeURIComponent;

export const httpApi: LettersApi = {
  me: () => apiFetch('/api/me'),
  rules: params => apiFetch(`/api/rules${q(params)}`),
  ruleHeader: n => apiFetch(`/api/rules/${enc(n)}`),
  ruleMeta: n => apiFetch(`/api/rules/${enc(n)}/meta`),
  ruleText: async n => {
    const res = await fetch(`/api/rules/${enc(n)}/text`, { credentials: 'same-origin' });
    if (!res.ok) {
      let body: ApiError & Record<string, unknown> = {
        error: 'RULE_UNAVAILABLE',
        hint: `HTTP ${res.status}`,
      };
      try {
        body = (await res.json()) as ApiError & Record<string, unknown>;
      } catch {
        /* text/plain error */
      }
      throw new ApiFailure(res.status, body);
    }
    return res.text();
  },

  createLetter: document_number =>
    apiFetch('/api/letters', { method: 'POST', body: document_number ? { document_number } : {} }),
  resolveShare: code => apiFetch(`/api/letters/by-share/${enc(code)}`),
  resolvePublic: token => apiFetch(`/api/letters/by-public/${enc(token)}`),
  state: (id, rev) => apiFetch(`/api/letters/${enc(id)}/state${q({ rev: rev ?? undefined })}`),
  verify: (id, quote) =>
    apiFetch(`/api/letters/${enc(id)}/verify`, { method: 'POST', body: { quote } }),
  propose: (id, base_rev, body, actor) =>
    apiFetch(`/api/letters/${enc(id)}/proposals`, {
      method: 'POST',
      body: { base_rev, ...body },
      actor,
    }),
  decide: (id, pid, decision, hold_ms) =>
    apiFetch(`/api/letters/${enc(id)}/proposals/${enc(pid)}/decide`, {
      method: 'POST',
      body: hold_ms === undefined ? { decision } : { decision, hold_ms },
    }),
  addClaim: (id, base_rev, body) =>
    apiFetch(`/api/letters/${enc(id)}/claims`, { method: 'POST', body: { base_rev, ...body } }),
  patchClaim: (id, cid, base_rev, field, text) =>
    apiFetch(`/api/letters/${enc(id)}/claims/${enc(cid)}`, {
      method: 'PATCH',
      body: { base_rev, field, text },
    }),
  deleteClaim: (id, cid, base_rev, hold_ms) =>
    apiFetch(`/api/letters/${enc(id)}/claims/${enc(cid)}`, {
      method: 'DELETE',
      body: { base_rev, hold_ms },
    }),
  addSigner: (id, base_rev) =>
    apiFetch(`/api/letters/${enc(id)}/signers/me`, { method: 'POST', body: { base_rev } }),
  setImpact: (id, base_rev, impact_text) =>
    apiFetch(`/api/letters/${enc(id)}/signers/me`, {
      method: 'PATCH',
      body: { base_rev, impact_text },
    }),
  setDisplayName: (id, base_rev, display_name) =>
    apiFetch(`/api/letters/${enc(id)}/signers/me/display_name`, {
      method: 'PATCH',
      body: { base_rev, display_name },
    }),
  sign: (id, base_rev, hold_ms) =>
    apiFetch(`/api/letters/${enc(id)}/signers/me/sign`, {
      method: 'POST',
      body: { base_rev, hold_ms },
    }),
  undo: (id, base_rev, hold_ms) =>
    apiFetch(`/api/letters/${enc(id)}/undo`, { method: 'POST', body: { base_rev, hold_ms } }),
  exportText: async id => {
    const res = await fetch(`/api/letters/${enc(id)}/export.txt`, { credentials: 'same-origin' });
    if (!res.ok)
      throw new ApiFailure(res.status, { error: 'NO_LETTER', hint: `HTTP ${res.status}` });
    return res.text();
  },
  exportUrl: id => `/api/letters/${enc(id)}/export.txt`,
  judgeFork: reset =>
    apiFetch('/api/judge/fork', { method: 'POST', body: reset ? { reset: true } : {} }),
};

/**
 * The API the pages use. Kept async so every caller stays on one code path; the letters routes
 * (P3) are real now, so this is always the HTTP client.
 */
export async function getApi(): Promise<LettersApi> {
  return httpApi;
}
