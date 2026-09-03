// The eight tools (PLAN.md section 3, 2.3, P5): gates as a pure function of page state, titles
// rendered from the bound rule and the viewer, and one execute per tool over the HTTP API in
// docs/API.md. Every execute: gate → input parsing → the call → plain object → output budget →
// ring-buffer log. propose_* verify the quote through POST /verify, then the page-side
// read-range allowlist, then POST /proposals with `x-docket-actor: agent`. open_rule navigates
// with history.pushState. Nothing here accepts, deletes, signs or files.

import { ACTOR_HEADER, APP_NAME } from '../../lib/app';
import type {
  ApiError,
  AskPersonToFileOutput,
  DraftMyImpactOutput,
  FindOpenRulesOutput,
  GetLetterOutput,
  LetterState,
  NearestPassage,
  OpenRuleOutput,
  Passage,
  ProposeClaimOutput,
  ProposeEditOutput,
  ReadRuleOutput,
  RuleHeader,
  TocEntry,
  ToolName,
} from '../../server/types';
import type { ToolMode } from './host';
import {
  CallLog,
  type CallLogEntry,
  compactInput,
  fitBudget,
  isToolError,
  jsonLength,
  parseInput,
  preview,
  summarizeResult,
  type ToolError,
  toolError,
} from './guard';
import { ReadRanges, readCallFor } from './readRanges';
import type { ToolSpec } from './registry';
import {
  NEEDS_HUMAN_ACCEPT,
  NEEDS_HUMAN_FILE,
  NOT_NOW_REASONS,
  OUTPUT_BUDGETS,
  TOOLS,
  TOOL_ORDER,
  type Gate,
  renderReason,
  renderTitle,
} from './schema';

// ---------------------------------------------------------------------------
// Page state → gates (2.3)
// ---------------------------------------------------------------------------

export interface LetterRef {
  letter_id: string;
  share_code?: string | null;
  public_token?: string | null;
  rev: string;
  rev_no?: number;
}

/** What the page tells the WebMCP layer. Everything else is fetched fresh per call. */
export interface PageState {
  /** The letter on this page, if one exists yet (home has none until open_rule). */
  letter?: LetterRef | null;
  /** The bound rule's header (bound = rule present unless `bound` says otherwise). */
  rule?: RuleHeader | null;
  bound?: boolean;
  /** comments_close_on < today in America/New_York (2.3). */
  closed?: boolean;
  claimsAccepted: number;
  signedIn: boolean;
  /** Sanitized display name of the viewer ('Signer' when the sign-in has no name). */
  viewerName: string;
  canEdit: boolean;
  /** /r/{public_token}: only get_letter and read_rule, no writes at all. */
  isPublicView: boolean;
}

export interface ToolAvailability {
  name: ToolName;
  available: boolean;
  /** The rail reason when unavailable (also the NOT_AVAILABLE hint). */
  reason: string | null;
}

/** The two tools the public page registers (2.2 item 8). */
export const PUBLIC_VIEW_TOOLS: readonly ToolName[] = ['read_rule', 'get_letter'];

function isBound(state: PageState): boolean {
  return state.bound ?? !!state.rule;
}

function gateReason(gate: Gate, state: PageState): string | null {
  switch (gate) {
    case 'unbound':
      return isBound(state)
        ? renderReason(NOT_NOW_REASONS.bound, {
            document_number: state.rule?.document_number ?? 'a rule',
          })
        : null;
    case 'bound':
      return isBound(state) ? null : NOT_NOW_REASONS.unbound;
    case 'open':
      return state.closed
        ? renderReason(NOT_NOW_REASONS.closed, {
            comments_close_on: state.rule?.comments_close_on ?? '',
          }).trim()
        : null;
    case 'can_edit':
      return state.canEdit ? null : NOT_NOW_REASONS.cannot_edit;
    case 'not_public':
      return state.isPublicView ? NOT_NOW_REASONS.read_only : null;
    case 'accepted_claim':
      return state.claimsAccepted >= 1 ? null : NOT_NOW_REASONS.no_accepted_claim;
    case 'signed_in':
      return state.signedIn ? null : NOT_NOW_REASONS.not_signed_in;
  }
}

/** Availability of every tool in rail order, with the printed reason (2.3, 2.4). Pure. */
export function evaluateGates(state: PageState): ToolAvailability[] {
  return TOOL_ORDER.map(name => {
    if (state.isPublicView && !PUBLIC_VIEW_TOOLS.includes(name)) {
      return { name, available: false, reason: NOT_NOW_REASONS.read_only };
    }
    for (const gate of TOOLS[name].gates) {
      const reason = gateReason(gate, state);
      if (reason) return { name, available: false, reason };
    }
    return { name, available: true, reason: null };
  });
}

export function toolsNow(state: PageState): ToolName[] {
  return evaluateGates(state)
    .filter(t => t.available)
    .map(t => t.name);
}

export function toolsNotNow(state: PageState): Array<{ name: ToolName; reason: string }> {
  return evaluateGates(state)
    .filter(t => !t.available)
    .map(t => ({ name: t.name, reason: t.reason ?? '' }));
}

/** The set a static host registers once at load for this route (P5). */
export function staticSetFor(state: PageState): ToolName[] {
  return state.isPublicView ? [...PUBLIC_VIEW_TOOLS] : [...TOOL_ORDER];
}

/** Title with the document number / size / display name rendered (section 3). */
export function titleFor(name: ToolName, state: PageState): string {
  const template = TOOLS[name].title;
  if (name === 'read_rule') {
    const rule = state.rule;
    if (!rule) return 'Read passages of the attached rule';
    return renderTitle(template, {
      document_number: rule.document_number,
      total_chars: rule.total_chars,
      first_page: rule.pages.first,
      last_page: rule.pages.last,
    });
  }
  if (name === 'draft_my_impact') {
    return renderTitle(template, { display_name: state.viewerName || 'you' });
  }
  return template;
}

// ---------------------------------------------------------------------------
// Execute context
// ---------------------------------------------------------------------------

export interface ToolContext {
  getState: () => PageState;
  mode: ToolMode;
  readRanges: ReadRanges;
  log: CallLog;
  /** Injected for tests; defaults to globalThis.fetch. */
  fetch?: typeof fetch;
  /** Site origin for share_url / export_url; defaults to location.origin. */
  origin?: string;
  /** SPA navigation after open_rule (history.pushState by default). */
  navigate?: (path: string) => void;
  /** The page re-fetches state so cards render immediately (2.6). */
  onLetterChanged?: () => void;
  /** Every finished call (rail + toasts). */
  onCall?: (entry: CallLogEntry) => void;
  onBusy?: (busy: boolean) => void;
}

type Json = Record<string, unknown>;

interface ApiResult {
  status: number;
  body: Json;
}

async function api(
  ctx: ToolContext,
  method: 'GET' | 'POST',
  path: string,
  body?: Json,
): Promise<ApiResult> {
  const doFetch = ctx.fetch ?? globalThis.fetch;
  const headers: Record<string, string> = { accept: 'application/json', [ACTOR_HEADER]: 'agent' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  let res: Response;
  try {
    res = await doFetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    });
  } catch (err) {
    return {
      status: 0,
      body: toolError(
        'UPSTREAM_UNAVAILABLE',
        `could not reach the page API (${err instanceof Error ? err.message : 'network error'})`,
      ),
    };
  }
  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    return {
      status: res.status,
      body: toolError('INTERNAL', `HTTP ${res.status} without a JSON body`),
    };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { status: res.status, body: toolError('INTERNAL', `HTTP ${res.status}: not an object`) };
  }
  const obj = parsed as Json;
  if (!res.ok && !isToolError(obj)) {
    return {
      status: res.status,
      body: toolError('INTERNAL', `HTTP ${res.status}: ${preview(String(obj.error ?? ''), 80)}`),
    };
  }
  return { status: res.status, body: obj };
}

function origin(ctx: ToolContext): string {
  if (ctx.origin) return ctx.origin;
  try {
    return typeof location !== 'undefined' ? location.origin : '';
  } catch {
    return '';
  }
}

function currentPath(): string {
  try {
    return typeof location !== 'undefined' ? location.pathname : '';
  } catch {
    return '';
  }
}

/** Default SPA navigation: pushState + popstate so the router re-renders without a reload. */
export function pushStateNavigate(path: string): void {
  if (typeof history === 'undefined' || typeof window === 'undefined') return;
  try {
    history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
  } catch {
    // A host without History: the person can follow the share_url by hand.
  }
}

// ---------------------------------------------------------------------------
// The execute wrapper (P5: gate → input → call → plain object → budget → log)
// ---------------------------------------------------------------------------

type Impl = (input: Json, state: PageState) => Promise<Json>;

function wrap(ctx: ToolContext, name: ToolName, impl: Impl): ToolSpec['execute'] {
  return async (raw: unknown): Promise<Json> => {
    const started = Date.now();
    ctx.onBusy?.(true);
    let result: Json;
    let inputText = '{}';
    try {
      const state = ctx.getState();
      const gate = evaluateGates(state).find(t => t.name === name);
      const parsed = parseInput(TOOLS[name].inputSchema, raw);
      if (parsed.ok) inputText = compactInput(parsed.value);
      if (gate && !gate.available) {
        result = toolError('NOT_AVAILABLE', gate.reason ?? 'not available now');
      } else if (!parsed.ok) {
        result = parsed.error;
      } else {
        result = await impl(parsed.value, state);
      }
    } catch (err) {
      result = toolError(
        'INTERNAL',
        err instanceof Error ? err.message.slice(0, 200) : 'unexpected error',
      );
    }
    let bounded: Json;
    try {
      bounded = fitBudget(result, OUTPUT_BUDGETS[name]);
    } catch {
      bounded = toolError('INTERNAL', 'result could not be serialized');
    }
    const ms = Date.now() - started;
    const entry = ctx.log.push({
      tool: name,
      input: inputText,
      result_summary: summarizeResult(name, bounded),
      ok: !isToolError(bounded),
      ms,
    });
    try {
      ctx.onCall?.(entry);
    } catch {
      // listeners never break a tool result
    }
    ctx.onBusy?.(false);
    return bounded;
  };
}

// ---------------------------------------------------------------------------
// Implementations
// ---------------------------------------------------------------------------

function letterId(state: PageState): string | null {
  return state.letter?.letter_id ?? null;
}

function noRule(): ToolError {
  return toolError('NO_RULE', 'No rule is attached to this letter; call open_rule first.');
}

function findOpenRules(ctx: ToolContext): Impl {
  return async (input, state) => {
    const params = new URLSearchParams();
    for (const key of ['query', 'agency_slug', 'closing_within_days', 'limit'] as const) {
      const v = input[key];
      if (v !== undefined && v !== '') params.set(key, String(v));
    }
    const { body } = await api(ctx, 'GET', `/api/rules?${params.toString()}`);
    if (isToolError(body)) return body;
    const rules = Array.isArray(body.rules) ? (body.rules as Json[]) : [];
    const query = typeof input.query === 'string' ? input.query : '';
    if (rules.length === 0) {
      return toolError(
        'NO_MATCH',
        query
          ? `No open rules match "${query}". Try fewer words.`
          : 'No open rules match these filters. Try without agency_slug or closing_within_days.',
      );
    }
    const bound = isBound(state) && state.rule ? state.rule.document_number : null;
    const refine = body.refine as
      { question: string; facet: 'agency'; options: Json[] } | undefined;
    const out: FindOpenRulesOutput = {
      as_of: String(body.as_of ?? ''),
      open_total: Number(body.open_total ?? 0),
      count: Number(body.count ?? rules.length),
      rules: rules.map(r => ({
        document_number: String(r.document_number ?? ''),
        title: preview(String(r.title ?? ''), 90),
        agency: preview(String(r.agency ?? ''), 40),
        comments_close_on: String(r.comments_close_on ?? ''),
        days_left: Number(r.days_left ?? 0),
        pages: Number(r.pages ?? 0),
        ...(r.matched_by ? { matched_by: r.matched_by as 'document_number' | 'title' } : {}),
      })),
      ...(refine && Array.isArray(refine.options)
        ? {
            refine: {
              question: String(refine.question ?? 'Which agency?'),
              facet: 'agency' as const,
              options: refine.options.slice(0, 6).map(o => ({
                agency_slug: String(o.agency_slug ?? ''),
                name: preview(String(o.name ?? ''), 40),
                count: Number(o.count ?? 0),
              })),
            },
          }
        : {}),
      letter: bound ? { bound: true, document_number: bound } : { bound: false },
      next: bound
        ? `This letter is already bound to ${bound}; read_rule({query}) reads it. A person can start a new letter for another rule.`
        : state.isPublicView
          ? 'This is the read-only public view; a person can start a letter from the home page.'
          : `open_rule({document_number:"${rules[0]?.document_number ?? ''}"}) attaches that rule to this letter (one time).`,
    };
    return out as unknown as Json;
  };
}

function openRule(ctx: ToolContext): Impl {
  return async (input, state) => {
    const document_number = String(input.document_number);
    const id = letterId(state);
    const { body } = id
      ? await api(ctx, 'POST', `/api/letters/${encodeURIComponent(id)}/bind`, { document_number })
      : await api(ctx, 'POST', '/api/letters', { document_number });
    if (isToolError(body)) return body;
    const rule = (body.rule ?? null) as RuleHeader | null;
    if (!rule)
      return toolError('RULE_UNAVAILABLE', 'the letter was created but no rule header came back', {
        html_url: null,
      });
    const share_code = String(body.share_code ?? state.letter?.share_code ?? '');
    const toc = (Array.isArray(body.toc) ? (body.toc as TocEntry[]) : []).slice(0, 16);
    const out: OpenRuleOutput = {
      letter_id: String(body.letter_id ?? id ?? ''),
      share_url: `${origin(ctx)}/l/${share_code}`,
      rev: String(body.rev ?? ''),
      rule: {
        document_number: rule.document_number,
        title: preview(rule.title, 90),
        agency: preview(rule.agency, 40),
        docket_id: rule.docket_id,
        document_id: rule.document_id,
        comment_url: rule.comment_url,
        comments_close_on: rule.comments_close_on,
        days_left: rule.days_left,
        pages: rule.pages,
        total_chars: rule.total_chars,
        fetched_at: rule.fetched_at,
      },
      toc: toc.map(t => ({ heading: preview(t.heading, 70), start: t.start })),
      next: 'read_rule({query}) or read_rule({start,window}); quote verbatim; then propose_claim with base_rev=rev',
    };
    ctx.readRanges.reset();
    const target = `/l/${share_code}`;
    if (share_code && currentPath() !== target) (ctx.navigate ?? pushStateNavigate)(target);
    ctx.onLetterChanged?.();
    return out as unknown as Json;
  };
}

/** Keep read_rule under its 4,500-char budget without breaking passage offsets. */
function fitPassages(out: ReadRuleOutput, budget: number): ReadRuleOutput {
  const result: ReadRuleOutput = { ...out, passages: out.passages.map(p => ({ ...p })) };
  let guard = 0;
  while (jsonLength(result) > budget && guard++ < 50) {
    if (result.passages.length > 1) {
      result.passages.pop();
      result.truncated = true;
      continue;
    }
    const p = result.passages[0];
    if (!p || p.text.length <= 200) break;
    const over = jsonLength(result) - budget;
    const target = Math.max(200, p.text.length - over);
    p.text = p.text.slice(0, target);
    p.end = p.start + p.text.length;
    result.truncated = true;
  }
  return result;
}

function readRule(ctx: ToolContext): Impl {
  return async (input, state) => {
    const id = letterId(state);
    if (!id) return noRule();
    const body: Json = {};
    for (const key of ['query', 'start', 'window', 'max_passages'] as const) {
      if (input[key] !== undefined && input[key] !== '') body[key] = input[key];
    }
    if (state.isPublicView) body.readonly = true;
    const res = await api(ctx, 'POST', `/api/letters/${encodeURIComponent(id)}/read`, body);
    if (isToolError(res.body)) return res.body;
    const passages = (Array.isArray(res.body.passages) ? (res.body.passages as Passage[]) : []).map(
      p => ({ start: p.start, end: p.end, page: p.page, text: p.text }),
    );
    const rev = String(res.body.rev ?? state.letter?.rev ?? '');
    const out = fitPassages(
      {
        document_number: String(res.body.document_number ?? state.rule?.document_number ?? ''),
        rev,
        total_chars: Number(res.body.total_chars ?? state.rule?.total_chars ?? 0),
        matches_total: Number(res.body.matches_total ?? 0),
        passages,
        read_ranges_recorded: 0,
        next: state.isPublicView
          ? 'Read-only public view: get_letter reads the letter; nothing here can be changed.'
          : `Copy a quote verbatim from a passage, then propose_claim({base_rev:"${rev}", quote, position, assertion, requested_change}).`,
      },
      OUTPUT_BUDGETS.read_rule,
    );
    // Only what was actually served counts as read (4.4): record after fitting the budget.
    ctx.readRanges.addPassages(out.passages);
    out.read_ranges_recorded = ctx.readRanges.count;
    ctx.onLetterChanged?.();
    return out as unknown as Json;
  };
}

interface VerifiedAnchor {
  start: number;
  end: number;
  page: number;
  unique: boolean;
}

/** POST /verify, then the read-range allowlist (4.4). Returns the anchor or a tool error. */
async function verifyQuote(
  ctx: ToolContext,
  id: string,
  quote: string,
): Promise<{ anchor: VerifiedAnchor } | { error: ToolError }> {
  const { body } = await api(ctx, 'POST', `/api/letters/${encodeURIComponent(id)}/verify`, {
    quote,
  });
  if (isToolError(body)) {
    if (body.error === 'ANCHOR_NOT_FOUND') {
      const nearest = (Array.isArray(body.nearest) ? (body.nearest as NearestPassage[]) : [])
        .slice(0, 3)
        .map(n => ({
          start: n.start,
          end: n.end,
          page: n.page,
          text: n.text.length > 240 ? n.text.slice(0, 240) : n.text,
          score: n.score,
        }));
      return {
        error: toolError(
          'ANCHOR_NOT_FOUND',
          `The quote is not in the rule text (verifier norm-1). Copy one of the ${nearest.length} nearest passages verbatim, or read_rule({start}) around it.`,
          { nearest },
        ),
      };
    }
    return { error: body };
  }
  const a = body.anchor as VerifiedAnchor | undefined;
  if (!a || typeof a.start !== 'number') {
    return { error: toolError('INTERNAL', 'verify returned no anchor') };
  }
  const anchor: VerifiedAnchor = { start: a.start, end: a.end, page: a.page, unique: a.unique };
  if (!ctx.readRanges.covers(anchor.start, anchor.end)) {
    const call = readCallFor(anchor);
    return {
      error: toolError(
        'ANCHOR_NOT_READ',
        `Call read_rule({start:${call.start},window:${call.window}}) then retry`,
        { anchor, read_rule: call },
      ),
    };
  }
  return { anchor };
}

function proposeClaim(ctx: ToolContext): Impl {
  return async (input, state) => {
    const id = letterId(state);
    if (!id) return noRule();
    const quote = String(input.quote);
    const verified = await verifyQuote(ctx, id, quote);
    if ('error' in verified) return verified.error;
    const payload: Json = {
      base_rev: input.base_rev,
      kind: 'claim',
      quote,
      position: input.position,
      assertion: input.assertion,
    };
    if (input.requested_change !== undefined) payload.requested_change = input.requested_change;
    if (input.evidence !== undefined) payload.evidence = input.evidence;
    const { body } = await api(
      ctx,
      'POST',
      `/api/letters/${encodeURIComponent(id)}/proposals`,
      payload,
    );
    if (isToolError(body)) return body;
    const anchor = (body.anchor as VerifiedAnchor | undefined) ?? verified.anchor;
    const out: ProposeClaimOutput = {
      proposal_id: String(body.proposal_id ?? ''),
      status: 'pending',
      base_rev: String(body.base_rev ?? input.base_rev),
      anchor: { start: anchor.start, end: anchor.end, page: anchor.page, unique: anchor.unique },
      card: {
        position: input.position as ProposeClaimOutput['card']['position'],
        assertion: preview(String(input.assertion), 120),
        requested_change: preview(String(input.requested_change ?? ''), 120),
      },
      needs_human: NEEDS_HUMAN_ACCEPT,
      pending_count: Number(body.pending_count ?? 1),
      next: 'The card is on the page. A person must hold Accept; keep using the same base_rev until get_letter shows a new rev.',
    };
    ctx.onLetterChanged?.();
    return out as unknown as Json;
  };
}

function proposeEdit(ctx: ToolContext): Impl {
  return async (input, state) => {
    const id = letterId(state);
    if (!id) return noRule();
    const field = String(input.field);
    const text = String(input.text);
    let anchor: VerifiedAnchor | undefined;
    if (field === 'quote') {
      if (text.length < 20) return toolError('INVALID', 'text: a quote needs at least 20 chars');
      const verified = await verifyQuote(ctx, id, text);
      if ('error' in verified) return verified.error;
      anchor = verified.anchor;
    }
    if (field === 'position' && !['support', 'oppose', 'modify'].includes(text)) {
      return toolError('INVALID', 'text: position must be support, oppose or modify');
    }
    const { body } = await api(ctx, 'POST', `/api/letters/${encodeURIComponent(id)}/proposals`, {
      base_rev: input.base_rev,
      kind: 'edit',
      claim_id: input.claim_id,
      field,
      text,
    });
    if (isToolError(body)) return body;
    const diff = (body.diff as { removed?: string[]; added?: string[] } | null | undefined) ?? {};
    const out: ProposeEditOutput = {
      proposal_id: String(body.proposal_id ?? ''),
      status: 'pending',
      claim_id: String(input.claim_id),
      field: field as ProposeEditOutput['field'],
      diff: {
        removed: Array.isArray(diff.removed) ? diff.removed : [],
        added: Array.isArray(diff.added) ? diff.added : [],
      },
      ...(anchor ? { anchor } : {}),
      needs_human: NEEDS_HUMAN_ACCEPT,
      next: 'The diff is on the card. A person must hold Accept; if they edit that field first the proposal goes stale.',
    };
    ctx.onLetterChanged?.();
    return out as unknown as Json;
  };
}

function draftMyImpact(ctx: ToolContext): Impl {
  return async (input, state) => {
    const id = letterId(state);
    if (!id) return noRule();
    const text = String(input.text);
    const { body } = await api(ctx, 'POST', `/api/letters/${encodeURIComponent(id)}/proposals`, {
      base_rev: input.base_rev,
      kind: 'impact',
      text,
    });
    if (isToolError(body)) return body;
    const name = state.viewerName || 'The signed-in person';
    const out: DraftMyImpactOutput = {
      proposal_id: String(body.proposal_id ?? ''),
      status: 'pending',
      for: name,
      preview: preview(text, 120),
      needs_human: `${name} must hold Accept, then Sign`,
      next: `${name} reviews the draft on their own signer block; only they can accept it.`,
    };
    ctx.onLetterChanged?.();
    return out as unknown as Json;
  };
}

/** Gate view of a fresh server state, for get_letter's tools_now / tools_not_now. */
function gateStateFrom(fresh: LetterState, page: PageState): PageState {
  return {
    letter: { letter_id: fresh.letter.id, rev: fresh.letter.rev, rev_no: fresh.letter.rev_no },
    rule: fresh.rule,
    bound: !!fresh.rule,
    closed: fresh.closed,
    claimsAccepted: fresh.claims.length,
    signedIn: fresh.viewer.signed_in,
    viewerName: fresh.viewer.display_name,
    canEdit: fresh.viewer.can_edit,
    isPublicView: page.isPublicView,
  };
}

async function fetchState(ctx: ToolContext, id: string): Promise<LetterState | ToolError> {
  const { body } = await api(ctx, 'GET', `/api/letters/${encodeURIComponent(id)}/state`);
  if (isToolError(body)) return body;
  if (!body.letter || !body.viewer) return toolError('INTERNAL', 'state response is incomplete');
  return body as unknown as LetterState;
}

function getLetter(ctx: ToolContext): Impl {
  return async (_input, state) => {
    const id = letterId(state);
    if (!id) {
      return toolError(
        'NO_LETTER',
        'No letter exists yet. find_open_rules, then open_rule({document_number}) creates one; a person can also click "Start a letter".',
        { tools_now: toolsNow(state), tools_not_now: toolsNotNow(state) },
      );
    }
    const fresh = await fetchState(ctx, id);
    if (isToolError(fresh)) return fresh;
    const gates = gateStateFrom(fresh, state);
    const claims = fresh.claims.slice(0, 6).map((c, i) => ({
      id: c.id,
      order: i + 1,
      status: c.anchor_status,
      position: c.position,
      page: c.page,
      quote_preview: preview(c.quote, 60),
      assertion_preview: preview(c.assertion, 60),
      has_requested_change: c.requested_change.trim().length > 0,
    }));
    const pending = fresh.pending.map(p => ({
      proposal_id: p.proposal_id,
      kind: p.kind,
      ...(p.claim_id ? { claim_id: p.claim_id } : {}),
      by: p.by,
    }));
    const rev = fresh.letter.rev;
    const next = !fresh.rule
      ? 'find_open_rules({query}) then open_rule({document_number}) attaches a rule.'
      : fresh.closed
        ? `Comments closed ${fresh.rule.comments_close_on}; reading and export still work. A person can start a new letter on an open rule.`
        : pending.length > 0
          ? `${pending.length} pending card(s) wait for a person to hold Accept. Use base_rev "${rev}" for new proposals.`
          : `read_rule({query}) then propose_claim with base_rev "${rev}".`;
    const out: GetLetterOutput = {
      letter_id: fresh.letter.id,
      rev,
      rev_no: fresh.letter.rev_no,
      rule: fresh.rule
        ? {
            document_number: fresh.rule.document_number,
            title: preview(fresh.rule.title, 90),
            agency: preview(fresh.rule.agency, 40),
            comments_close_on: fresh.rule.comments_close_on,
            days_left: fresh.rule.days_left,
            closed: fresh.closed,
          }
        : null,
      claims,
      ...(fresh.claims.length > 6 ? { more_claims: `+${fresh.claims.length - 6} more` } : {}),
      signers: fresh.signers.map(s => ({
        display_name: s.display_name,
        signed: !!s.signed_at,
        has_impact: !!(s.impact_text && s.impact_text.trim()),
      })),
      pending,
      missing: fresh.missing,
      viewer: {
        signed_in: fresh.viewer.signed_in,
        ...(fresh.viewer.signed_in ? { display_name: fresh.viewer.display_name } : {}),
        is_signer: fresh.viewer.is_signer,
      },
      tools_now: toolsNow(gates),
      tools_not_now: toolsNotNow(gates),
      next,
    };
    // Claims are the first array to give way (section 3 budgets), keeping '+N more' honest.
    while (jsonLength(out) > OUTPUT_BUDGETS.get_letter && out.claims.length > 1) {
      out.claims.pop();
      out.more_claims = `+${fresh.claims.length - out.claims.length} more`;
    }
    return out as unknown as Json;
  };
}

const MAIL_FALLBACK = 'this rule takes comments by mail or email; see ADDRESSES';

function askPersonToFile(ctx: ToolContext): Impl {
  return async (_input, state) => {
    const id = letterId(state);
    if (!id) return noRule();
    const fresh = await fetchState(ctx, id);
    if (isToolError(fresh)) return fresh;
    const rule = fresh.rule;
    if (!rule) return noRule();
    const required = fresh.missing.filter(m => !/\(optional/i.test(m));
    const out: AskPersonToFileOutput = {
      needs_human: true,
      reason: NEEDS_HUMAN_FILE,
      comment_url: rule.comment_url,
      fallback_url: rule.html_url,
      ...(rule.comment_url ? {} : { fallback_reason: MAIL_FALLBACK }),
      export_url: `${origin(ctx)}/api/letters/${encodeURIComponent(fresh.letter.id)}/export.txt`,
      comments_close_on: rule.comments_close_on,
      days_left: rule.days_left,
      missing: fresh.missing,
      ready: required.length === 0 && !fresh.closed,
    };
    return {
      ...out,
      next: `${APP_NAME} never files. Tell the person what is missing, then point them to comment_url (opens in their browser).`,
    };
  };
}

// ---------------------------------------------------------------------------
// Building the specs
// ---------------------------------------------------------------------------

const IMPLS: Record<ToolName, (ctx: ToolContext) => Impl> = {
  find_open_rules: findOpenRules,
  open_rule: openRule,
  read_rule: readRule,
  propose_claim: proposeClaim,
  propose_edit: proposeEdit,
  draft_my_impact: draftMyImpact,
  get_letter: getLetter,
  ask_person_to_file: askPersonToFile,
};

export type ToolExecutes = Record<ToolName, ToolSpec['execute']>;

/** One wrapped execute per tool. Built once per page; each call reads ctx.getState(). */
export function buildExecutes(ctx: ToolContext): ToolExecutes {
  const out = {} as ToolExecutes;
  for (const name of TOOL_ORDER) out[name] = wrap(ctx, name, IMPLS[name](ctx));
  return out;
}

/** A registerTool-ready spec with the title rendered for the current state. */
export function specFor(name: ToolName, state: PageState, executes: ToolExecutes): ToolSpec {
  const t = TOOLS[name];
  return {
    name,
    title: titleFor(name, state),
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: { ...t.annotations },
    execute: executes[name],
  };
}

/** Dynamic mode: exactly the tools whose gates pass now (2.3). */
export function desiredTools(state: PageState, executes: ToolExecutes): ToolSpec[] {
  return toolsNow(state).map(name => specFor(name, state, executes));
}

/** Static mode: the whole set for the route, registered once (P5). */
export function staticTools(state: PageState, executes: ToolExecutes): ToolSpec[] {
  return staticSetFor(state).map(name => specFor(name, state, executes));
}

/** Convenience for tests and the rail: is `value` a `{error, hint}`? */
export function isError(value: unknown): value is ApiError {
  return isToolError(value);
}
