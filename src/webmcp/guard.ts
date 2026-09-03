// Execute wrapper pieces shared by every tool (PLAN.md P5, section 3 budgets): input parsing
// against the closed schema (JSON strings tolerated, unknown keys → UNKNOWN_FIELD), output
// budgets (arrays truncate first, then previews, then `truncated:true`), and the ring-buffer
// call log the rail prints. All pure; no DOM.

import type { ApiError } from '../../server/types';
import type { SchemaProp, ToolInputSchema } from './schema';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type ToolError = ApiError & Record<string, unknown>;

export function toolError(
  error: ApiError['error'],
  hint: string,
  extra: Record<string, unknown> = {},
): ToolError {
  return { error, hint, ...extra };
}

export function isToolError(value: unknown): value is ToolError {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as { error?: unknown }).error === 'string' &&
    typeof (value as { hint?: unknown }).hint === 'string'
  );
}

// ---------------------------------------------------------------------------
// Input parsing
// ---------------------------------------------------------------------------

/**
 * Parse tool input against a closed schema. A JSON string is tolerated (some hosts pass the
 * arguments serialized); anything else that is not a plain object is INVALID. Unknown keys →
 * UNKNOWN_FIELD naming the key; type, length, range, pattern and enum violations → INVALID.
 */
export function parseInput(
  schema: ToolInputSchema,
  raw: unknown,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: ToolError } {
  let input: unknown = raw;
  if (typeof input === 'string') {
    const text = input.trim();
    if (text === '') input = {};
    else {
      try {
        input = JSON.parse(text);
      } catch {
        return { ok: false, error: toolError('INVALID', 'input must be a JSON object') };
      }
    }
  }
  if (input === undefined || input === null) input = {};
  if (typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: toolError('INVALID', 'input must be a JSON object') };
  }
  const obj = input as Record<string, unknown>;
  const value: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    if (!(key in schema.properties)) {
      return { ok: false, error: toolError('UNKNOWN_FIELD', `${key} is not accepted`) };
    }
  }
  for (const [key, prop] of Object.entries(schema.properties)) {
    const v = obj[key];
    if (v === undefined || v === null) {
      if (schema.required?.includes(key)) {
        return { ok: false, error: toolError('INVALID', `${key}: required`) };
      }
      if (prop.type === 'integer' && prop.default !== undefined) value[key] = prop.default;
      continue;
    }
    const problem = checkProp(key, prop, v);
    if (problem) return { ok: false, error: toolError('INVALID', problem) };
    value[key] = prop.type === 'integer' ? Math.trunc(Number(v)) : String(v).trim();
  }
  return { ok: true, value };
}

function checkProp(key: string, prop: SchemaProp, v: unknown): string | null {
  if (prop.type === 'integer') {
    const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
    if (typeof n !== 'number' || !Number.isFinite(n)) return `${key}: must be an integer`;
    const i = Math.trunc(n);
    if (prop.minimum !== undefined && i < prop.minimum) return `${key}: at least ${prop.minimum}`;
    if (prop.maximum !== undefined && i > prop.maximum) return `${key}: at most ${prop.maximum}`;
    return null;
  }
  if (typeof v !== 'string') return `${key}: must be a string`;
  const s = v.trim();
  if (prop.enum && !prop.enum.includes(s)) return `${key}: must be one of ${prop.enum.join(', ')}`;
  if (prop.minLength !== undefined && s.length < prop.minLength) {
    return `${key}: at least ${prop.minLength} chars`;
  }
  if (prop.maxLength !== undefined && s.length > prop.maxLength) {
    return `${key}: at most ${prop.maxLength} chars`;
  }
  if (prop.pattern && !new RegExp(prop.pattern).test(s)) {
    return `${key}: does not match ${prop.pattern}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Output budget
// ---------------------------------------------------------------------------

/** Strings shorter than this are never cut. */
const PREVIEW_FLOOR = 48;

export function jsonLength(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

type Plain = Record<string, unknown>;

function isPlain(v: unknown): v is Plain {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Deep clone through JSON so budgets never mutate the caller's object and the result is plain. */
function plainClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function longestArray(node: unknown, best: { arr: unknown[] | null }): void {
  if (Array.isArray(node)) {
    if (node.length > 1 && (!best.arr || node.length > best.arr.length)) best.arr = node;
    for (const item of node) longestArray(item, best);
  } else if (isPlain(node)) {
    for (const v of Object.values(node)) longestArray(v, best);
  }
}

function longestString(
  node: unknown,
  best: { holder: Plain | unknown[] | null; key: string | number; len: number },
): void {
  if (Array.isArray(node)) {
    node.forEach((item, i) => {
      if (typeof item === 'string') {
        if (item.length > best.len) Object.assign(best, { holder: node, key: i, len: item.length });
      } else longestString(item, best);
    });
  } else if (isPlain(node)) {
    for (const [k, v] of Object.entries(node)) {
      if (typeof v === 'string') {
        if (v.length > best.len) Object.assign(best, { holder: node, key: k, len: v.length });
      } else longestString(v, best);
    }
  }
}

/**
 * Fit a result under `budget` JSON chars (section 3): pop from the longest array first (down
 * to one element), then shorten the longest string (never below PREVIEW_FLOOR), and mark
 * `truncated:true`. Errors are budgeted the same way so refusals stay bounded too.
 */
export function fitBudget<T extends object>(result: T, budget: number): T & { truncated?: true } {
  if (jsonLength(result) <= budget) return result;
  const out = plainClone(result) as T & { truncated?: true };
  out.truncated = true;
  for (let guard = 0; guard < 10_000 && jsonLength(out) > budget; guard++) {
    const arr: { arr: unknown[] | null } = { arr: null };
    longestArray(out, arr);
    if (arr.arr) {
      arr.arr.pop();
      continue;
    }
    const str = { holder: null as Plain | unknown[] | null, key: '' as string | number, len: 0 };
    longestString(out, str);
    if (!str.holder || str.len <= PREVIEW_FLOOR) break;
    const over = jsonLength(out) - budget;
    const target = Math.max(PREVIEW_FLOOR, Math.min(str.len - over, Math.floor(str.len * 0.7)));
    const cut = cutAtWord(
      (str.holder as Record<string | number, unknown>)[str.key] as string,
      target,
    );
    (str.holder as Record<string | number, unknown>)[str.key] = cut;
  }
  return out;
}

/** Cut a string to ≤ max chars at a word boundary (no marker: `truncated:true` says so). */
export function cutAtWord(s: string, max: number): string {
  if (s.length <= max) return s;
  const head = s.slice(0, max);
  const space = head.lastIndexOf(' ');
  return (space > max * 0.6 ? head.slice(0, space) : head).trimEnd();
}

/** A preview of `s` for cards and get_letter (≤ max chars, word boundary, marker added). */
export function preview(s: string | null | undefined, max: number): string {
  const one = (s ?? '').replace(/\s+/g, ' ').trim();
  if (one.length <= max) return one;
  return cutAtWord(one, max - 1) + '…';
}

// ---------------------------------------------------------------------------
// Ring-buffer call log (rail + activity)
// ---------------------------------------------------------------------------

export interface CallLogEntry {
  seq: number;
  tool: string;
  /** Compact printable input, e.g. `{query:"30 days"}`. */
  input: string;
  /** One line, e.g. `3 passages` or `ANCHOR_NOT_FOUND`. */
  result_summary: string;
  ok: boolean;
  ms: number;
  at: string;
}

export const CALL_LOG_SIZE = 20;

export class CallLog {
  private entries: CallLogEntry[] = [];
  private seq = 0;
  private listeners = new Set<(entries: readonly CallLogEntry[]) => void>();

  constructor(private readonly size: number = CALL_LOG_SIZE) {}

  push(entry: Omit<CallLogEntry, 'seq' | 'at'>): CallLogEntry {
    const full: CallLogEntry = { ...entry, seq: ++this.seq, at: new Date().toISOString() };
    this.entries = [...this.entries, full].slice(-this.size);
    for (const l of this.listeners) l(this.entries);
    return full;
  }

  list(): readonly CallLogEntry[] {
    return this.entries;
  }

  last(): CallLogEntry | undefined {
    return this.entries[this.entries.length - 1];
  }

  subscribe(listener: (entries: readonly CallLogEntry[]) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

/** `read_rule({query:"30 days"}) → 3 passages (212 ms)` (2.4). */
export function formatCall(
  e: Pick<CallLogEntry, 'tool' | 'input' | 'result_summary' | 'ms'>,
): string {
  return `${e.tool}(${e.input}) → ${e.result_summary} (${e.ms} ms)`;
}

/** Compact, unquoted-key rendering of an input object for the rail (bounded). */
export function compactInput(input: Record<string, unknown>, max = 80): string {
  const parts = Object.entries(input)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}:${typeof v === 'string' ? JSON.stringify(preview(v, 40)) : String(v)}`);
  const s = `{${parts.join(',')}}`;
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/** One-line summary of a result for the log. */
export function summarizeResult(tool: string, result: unknown): string {
  if (isToolError(result)) return result.error;
  if (!isPlain(result)) return 'ok';
  const r = result as Plain;
  switch (tool) {
    case 'find_open_rules':
      return `${Array.isArray(r.rules) ? r.rules.length : 0} of ${r.count ?? '?'} rules`;
    case 'open_rule':
      return `bound ${(r.rule as Plain | undefined)?.document_number ?? ''} rev ${r.rev ?? ''}`.trim();
    case 'read_rule': {
      const n = Array.isArray(r.passages) ? r.passages.length : 0;
      return `${n} passage${n === 1 ? '' : 's'}`;
    }
    case 'propose_claim':
    case 'propose_edit':
    case 'draft_my_impact':
      return `pending ${r.proposal_id ?? ''}`.trim();
    case 'get_letter':
      return `rev ${r.rev ?? ''} · ${Array.isArray(r.claims) ? r.claims.length : 0} claims`;
    case 'ask_person_to_file':
      return 'needs_human';
    default:
      return 'ok';
  }
}
