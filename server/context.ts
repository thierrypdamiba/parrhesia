// Per-request context for /api routes: env, viewer, actor, cookies to set, share-code
// relationships, and the letter + rule + can_edit resolution (docs/API.md conventions).
// Only route files import this (it pulls in cloudflare:workers through ./env).

import { ACTOR_HEADER } from '../lib/app';
import { migrate } from './db';
import { getEnv, type DocketEnv } from './env';
import { getCachedRule } from './fr';
import { json } from './http';
import { getViewer, parseCookies, serializeCookie, withCookies, type ViewerResult } from './identity';
import { actorFor, canEditLetter, loadLetter } from './letter';
import type { Actor, Letter, RuleCacheParsed } from './types';

export const SHARE_COOKIE = 'docket_share';
export const JUDGE_COOKIE = 'docket_judge';
const SHARE_MAX = 20;

export interface ApiContext {
  env: DocketEnv;
  request: Request;
  viewer: ViewerResult;
  actor: Actor;
  isAgent: boolean;
  cookies: string[];
  shareCodes: string[];
  secure: boolean;
}

export async function apiContext(request: Request): Promise<ApiContext> {
  const env = getEnv();
  await migrate(env);
  const viewer = await getViewer(request, env);
  const isAgent = request.headers.get(ACTOR_HEADER)?.trim().toLowerCase() === 'agent';
  const shareCodes = (parseCookies(request.headers.get('cookie'))[SHARE_COOKIE] ?? '')
    .split(',')
    .filter(Boolean);
  return {
    env,
    request,
    viewer,
    actor: actorFor(viewer, isAgent),
    isAgent,
    cookies: [...viewer.set_cookies],
    shareCodes,
    secure: new URL(request.url).protocol === 'https:',
  };
}

/** Remember a share code in the httpOnly share cookie (grants can_edit on later requests). */
export function grantShare(ctx: ApiContext, share_code: string): void {
  if (!ctx.shareCodes.includes(share_code)) {
    ctx.shareCodes = [...ctx.shareCodes.slice(-(SHARE_MAX - 1)), share_code];
  }
  ctx.cookies.push(
    serializeCookie(SHARE_COOKIE, ctx.shareCodes.join(','), {
      maxAge: 365 * 24 * 3600,
      secure: ctx.secure,
    }),
  );
}

export interface LetterContext extends ApiContext {
  letter: Letter;
  rule: RuleCacheParsed | null;
  can_edit: boolean;
}

export async function letterContext(request: Request, id: string): Promise<LetterContext> {
  const ctx = await apiContext(request);
  const letter = await loadLetter(ctx.env, id);
  const rule = letter.document_number ? await getCachedRule(ctx.env, letter.document_number) : null;
  const can_edit = await canEditLetter(letter, ctx.viewer, ctx.shareCodes);
  return { ...ctx, letter, rule, can_edit };
}

export function respond(ctx: ApiContext, body: unknown, init: ResponseInit = {}): Response {
  return withCookies(json(body, init), ctx.cookies);
}

export function requireEdit(ctx: LetterContext): void {
  if (!ctx.can_edit) {
    throw Object.assign(new Error('FORBIDDEN'), {
      status: 403,
      body: { error: 'FORBIDDEN', hint: 'this view cannot edit the letter; open the co-writing link' },
    });
  }
}
