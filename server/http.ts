// Route plumbing shared by every /api handler (docs/API.md conventions): typed errors, the
// catch-all, closed-key body validation, rate limits and the client IP. No Workers import.

import type { DbEnv } from './envvars';
import type { ApiError, ErrorCode } from './types';

/** An error that becomes `{error, hint, ...extra}` with an HTTP status. */
export class HttpError extends Error {
  readonly status: number;
  readonly body: ApiError & Record<string, unknown>;
  constructor(status: number, error: ErrorCode, hint: string, extra: Record<string, unknown> = {}) {
    super(`${error}: ${hint}`);
    this.status = status;
    this.body = { error, hint, ...extra };
  }
}

export function fail(
  status: number,
  error: ErrorCode,
  hint: string,
  extra: Record<string, unknown> = {},
): never {
  throw new HttpError(status, error, hint, extra);
}

export function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has('cache-control')) headers.set('cache-control', 'no-store');
  return Response.json(body, { ...init, headers });
}

/** Run a handler; HttpError → its status/body, anything else → 500 INTERNAL without a stack. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof HttpError) return json(err.body, { status: err.status });
    const hint = err instanceof Error ? err.message.slice(0, 200) : 'unexpected error';
    console.error('INTERNAL', err);
    return json({ error: 'INTERNAL', hint }, { status: 500 });
  }
}

/**
 * Parse a JSON body against a closed key set. Unknown keys → 400 UNKNOWN_FIELD naming the key
 * (docs/API.md: no body ever carries a signer name, display name, user id or email).
 */
export async function readBody<K extends string>(
  request: Request,
  allowed: readonly K[],
  required: readonly K[] = [],
): Promise<Partial<Record<K, unknown>>> {
  let raw: unknown = {};
  const text = await request.text();
  if (text.trim()) {
    try {
      raw = JSON.parse(text);
    } catch {
      fail(400, 'INVALID', 'body must be a JSON object');
    }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    fail(400, 'INVALID', 'body must be a JSON object');
  }
  const body = raw as Record<string, unknown>;
  for (const key of Object.keys(body)) {
    if (!(allowed as readonly string[]).includes(key)) {
      fail(400, 'UNKNOWN_FIELD', `${key} is not accepted`);
    }
  }
  for (const key of required) {
    if (body[key] === undefined || body[key] === null) fail(400, 'INVALID', `${key}: required`);
  }
  return body as Partial<Record<K, unknown>>;
}

/** Validate a string field's length; returns the trimmed value (or '' when absent and optional). */
export function stringField(
  body: Record<string, unknown>,
  key: string,
  opts: {
    min?: number;
    max: number;
    required?: boolean;
    pattern?: RegExp;
    enum?: readonly string[];
  },
): string {
  const v = body[key];
  if (v === undefined || v === null) {
    if (opts.required) fail(400, 'INVALID', `${key}: required`);
    return '';
  }
  if (typeof v !== 'string') fail(400, 'INVALID', `${key}: must be a string`);
  const s = v.trim();
  if (opts.enum && !opts.enum.includes(s)) {
    fail(400, 'INVALID', `${key}: must be one of ${opts.enum.join(', ')}`);
  }
  if (opts.required && s.length === 0) fail(400, 'INVALID', `${key}: required`);
  if (opts.min !== undefined && s.length > 0 && s.length < opts.min) {
    fail(400, 'INVALID', `${key}: at least ${opts.min} chars`);
  }
  if (s.length > opts.max) fail(400, 'INVALID', `${key}: at most ${opts.max} chars`);
  if (opts.pattern && s.length > 0 && !opts.pattern.test(s)) {
    fail(400, 'INVALID', `${key}: does not match ${opts.pattern.source}`);
  }
  return s;
}

export function intField(
  value: unknown,
  key: string,
  opts: { min: number; max: number; fallback?: number },
): number {
  if (value === undefined || value === null || value === '') {
    if (opts.fallback !== undefined) return opts.fallback;
    fail(400, 'INVALID', `${key}: required`);
  }
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n))
    fail(400, 'INVALID', `${key}: must be a number`);
  const i = Math.trunc(n);
  if (i < opts.min || i > opts.max) {
    fail(400, 'INVALID', `${key}: must be between ${opts.min} and ${opts.max}`);
  }
  return i;
}

/** Client IP for rate buckets. */
export function clientIp(request: Request): string {
  return (
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'local'
  );
}

/**
 * Per-hour per-IP rate limit via the single-statement upsert in PLAN.md 4.3. Throws 429
 * RATE_LIMITED when the bucket exceeds `limit`.
 */
export async function rateLimit(
  env: DbEnv,
  name: string,
  request: Request,
  limit: number,
): Promise<void> {
  const hour = new Date().toISOString().slice(0, 13);
  const bucket = `${name}:${clientIp(request)}:${hour}`;
  const row = await env.DB.prepare(
    'INSERT INTO ratelimit (bucket, count) VALUES (?, 1) ON CONFLICT(bucket) DO UPDATE SET count = count + 1 RETURNING count',
  )
    .bind(bucket)
    .first<{ count: number }>();
  if ((row?.count ?? 0) > limit) {
    fail(429, 'RATE_LIMITED', `${name}: more than ${limit} per hour from this address`);
  }
}

/** Query-string integer with bounds and fallback. */
export function queryInt(
  url: URL,
  key: string,
  opts: { min: number; max: number; fallback?: number },
): number | undefined {
  const raw = url.searchParams.get(key);
  if (raw === null || raw === '') return opts.fallback;
  return intField(raw, key, opts);
}
