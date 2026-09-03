// Identity (PLAN.md 4.4 Identity, P1). Derives the viewer from the Sign in with ChatGPT headers,
// the HMAC session cookie fallback, or the dev sign-in cookie; always carries an anonymous
// docket_owner cookie. The email is never stored, returned, logged or shown.

import type { DocketEnv } from './envvars';
import { envVar } from './envvars';
import { LIMITS, type Viewer } from './types';

export const EMAIL_HEADER = 'oai-authenticated-user-email';
export const FULL_NAME_HEADER = 'oai-authenticated-user-full-name';
/** When this header is 'percent-encoded-utf-8', FULL_NAME_HEADER is percent-encoded (Sites dev shim emits it). */
export const FULL_NAME_ENCODING_HEADER = 'oai-authenticated-user-full-name-encoding';
/** Emitted by the Sites dev shim; not documented for production (4.1 item 6). Not used for user_id until PROBE.md confirms it. */
export const USER_ID_HEADER = 'oai-authenticated-user-id';
export const SESSION_COOKIE = 'docket_session';
export const DEV_COOKIE = 'docket_dev_identity';
export const OWNER_COOKIE = 'docket_owner';
export const RETURN_COOKIE = 'docket_return';
export const DEFAULT_DISPLAY_NAME = 'Signer';
export const SESSION_TTL_SECONDS = 7 * 24 * 3600;
export const OWNER_TTL_SECONDS = 365 * 24 * 3600;

const enc = new TextEncoder();

/** Lowercase hex sha256 of a UTF-8 string (crypto.subtle). */
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(input));
  return hex(new Uint8Array(digest));
}

function hex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

/** user_id = hex(sha256(lower(trim(email)))) (4.4 Identity). */
export function userIdFromEmail(email: string): Promise<string> {
  return sha256Hex(email.trim().toLowerCase());
}

/** user_id for the dev sign-in cookie; namespaced so it can never collide with a real email hash. */
export function userIdFromDevName(name: string): Promise<string> {
  return sha256Hex(`dev:${name.trim().toLowerCase()}`);
}

/**
 * Display name: ≤40 chars, single line, only [A-Za-z0-9 .'-]; anything else is dropped and
 * whitespace is collapsed. Empty → 'Signer'. Never derived from the email local part.
 */
export function sanitizeDisplayName(raw: string | null | undefined): string {
  if (typeof raw !== 'string') return DEFAULT_DISPLAY_NAME;
  const cleaned = raw
    .replace(/[^A-Za-z0-9 .'-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, LIMITS.display_name_chars)
    .trim();
  return cleaned.length > 0 ? cleaned : DEFAULT_DISPLAY_NAME;
}

/** Full name from the headers, percent-decoded when the encoding header says so, then sanitized. */
export function displayNameFromHeaders(headers: Headers): string {
  const raw = headers.get(FULL_NAME_HEADER);
  if (raw === null) return DEFAULT_DISPLAY_NAME;
  const encoding = headers.get(FULL_NAME_ENCODING_HEADER)?.trim().toLowerCase();
  if (encoding === 'percent-encoded-utf-8') {
    try {
      return sanitizeDisplayName(decodeURIComponent(raw));
    } catch {
      return sanitizeDisplayName(raw);
    }
  }
  return sanitizeDisplayName(raw);
}

/** Parse a Cookie header into a name → value map (first occurrence wins). */
export function parseCookies(header: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (!name || name in out) continue;
    let value = part.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      out[name] = value;
    }
  }
  return out;
}

export interface CookieOptions {
  maxAge?: number;
  httpOnly?: boolean;
  secure?: boolean;
  path?: string;
  sameSite?: 'Lax' | 'Strict' | 'None';
}

/** Serialize a Set-Cookie value. httpOnly and SameSite=Lax by default (4.4 Identity). */
export function serializeCookie(name: string, value: string, opts: CookieOptions = {}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${opts.path ?? '/'}`);
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${Math.max(0, Math.trunc(opts.maxAge))}`);
  if (opts.httpOnly !== false) parts.push('HttpOnly');
  parts.push(`SameSite=${opts.sameSite ?? 'Lax'}`);
  if (opts.secure) parts.push('Secure');
  return parts.join('; ');
}

/** A Set-Cookie value that deletes `name`. */
export function clearCookie(name: string, secure = false): string {
  return serializeCookie(name, '', { maxAge: 0, secure });
}

/** 32 random [a-z0-9] chars (P1 docket_owner; also used for ids by lane B). */
export function randomToken(length = 32): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

// ---------------------------------------------------------------------------
// HMAC session cookie (fallback when the oai headers ride only on navigations; 4.4 Identity)
// ---------------------------------------------------------------------------

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return hex(new Uint8Array(sig));
}

function b64url(s: string): string {
  return btoa(unescape(encodeURIComponent(s)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
function unb64url(s: string): string | null {
  try {
    const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
    return decodeURIComponent(escape(atob(padded)));
  } catch {
    return null;
  }
}

/** docket_session value: base64url(`${user_id}|${display_name}|${exp}`) + '.' + HMAC-SHA256 hex. */
export async function signSession(
  secret: string,
  user_id: string,
  display_name: string,
  exp: number,
): Promise<string> {
  const payload = `${user_id}|${display_name}|${exp}`;
  return `${b64url(payload)}.${await hmacHex(secret, payload)}`;
}

/** Verify a docket_session value; null when malformed, tampered or expired. */
export async function verifySession(
  secret: string,
  value: string | undefined,
  now = Date.now(),
): Promise<{ user_id: string; display_name: string } | null> {
  if (!value) return null;
  const dot = value.lastIndexOf('.');
  if (dot <= 0) return null;
  const payload = unb64url(value.slice(0, dot));
  if (!payload) return null;
  const expected = await hmacHex(secret, payload);
  if (!timingSafeEqual(expected, value.slice(dot + 1))) return null;
  const [user_id, display_name, expRaw] = payload.split('|');
  const exp = Number(expRaw);
  if (!/^[a-f0-9]{64}$/.test(user_id ?? '') || !Number.isFinite(exp) || exp * 1000 < now)
    return null;
  return { user_id, display_name: sanitizeDisplayName(display_name) };
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---------------------------------------------------------------------------
// getViewer
// ---------------------------------------------------------------------------

export interface ViewerResult extends Viewer {
  /** Set-Cookie values the route must append (owner cookie on first visit; session when issued). */
  set_cookies: string[];
  /** Which source produced the identity; never returned to clients as-is except in dev. */
  source: 'headers' | 'session' | 'dev' | 'anonymous';
}

/** True when `/dev/signin` is enabled (P1: env.DEV_IDENTITY === '1'). */
export function devIdentityEnabled(env: Partial<DocketEnv>): boolean {
  return envVar(env, 'DEV_IDENTITY') === '1';
}

/**
 * Derive the viewer (4.4 Identity). Precedence: oai headers → docket_session cookie (when a
 * secret is configured) → docket_dev_identity cookie (when DEV_IDENTITY==='1') → anonymous.
 * Always reads or mints the docket_owner cookie.
 */
export async function getViewer(request: Request, env: Partial<DocketEnv>): Promise<ViewerResult> {
  const cookies = parseCookies(request.headers.get('cookie'));
  const secure = new URL(request.url).protocol === 'https:';
  const set_cookies: string[] = [];

  let owner_token = cookies[OWNER_COOKIE];
  if (!owner_token || !/^[a-z0-9]{32}$/.test(owner_token)) {
    owner_token = randomToken(32);
    set_cookies.push(
      serializeCookie(OWNER_COOKIE, owner_token, { maxAge: OWNER_TTL_SECONDS, secure }),
    );
  }

  const secret = envVar(env, 'DOCKET_SESSION_SECRET');

  const email = request.headers.get(EMAIL_HEADER);
  if (email && email.trim()) {
    const user_id = await userIdFromEmail(email);
    const display_name = displayNameFromHeaders(request.headers);
    if (secret) {
      const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
      set_cookies.push(
        serializeCookie(SESSION_COOKIE, await signSession(secret, user_id, display_name, exp), {
          maxAge: SESSION_TTL_SECONDS,
          secure,
        }),
      );
    }
    return { user_id, display_name, signed_in: true, owner_token, set_cookies, source: 'headers' };
  }

  if (secret) {
    const session = await verifySession(secret, cookies[SESSION_COOKIE]);
    if (session) {
      return { ...session, signed_in: true, owner_token, set_cookies, source: 'session' };
    }
  }

  if (devIdentityEnabled(env)) {
    const devName = cookies[DEV_COOKIE];
    if (devName) {
      const display_name = sanitizeDisplayName(devName);
      const user_id = await userIdFromDevName(display_name);
      return { user_id, display_name, signed_in: true, owner_token, set_cookies, source: 'dev' };
    }
  }

  return {
    user_id: null,
    display_name: DEFAULT_DISPLAY_NAME,
    signed_in: false,
    owner_token,
    set_cookies,
    source: 'anonymous',
  };
}

/** Append Set-Cookie headers to a response (Response headers are immutable after Response.json). */
export function withCookies(response: Response, cookies: readonly string[]): Response {
  if (cookies.length === 0) return response;
  const headers = new Headers(response.headers);
  for (const c of cookies) headers.append('set-cookie', c);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** Only same-origin paths are accepted as return targets (no '//', no scheme). */
export function safeReturnPath(raw: string | null | undefined): string | null {
  if (!raw || raw.length > 512) return null;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return null;
  if (/[\r\n]/.test(raw)) return null;
  return raw;
}
