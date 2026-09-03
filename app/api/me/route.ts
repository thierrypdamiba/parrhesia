// GET /api/me → {signed_in, display_name, user_id, return_to?} (PLAN.md P1, 4.4 Identity).
// Never echoes the email. Clears the docket_return cookie once it has been reported.
import { getEnv } from '@/server/env';
import {
  RETURN_COOKIE,
  clearCookie,
  getViewer,
  parseCookies,
  safeReturnPath,
  withCookies,
} from '@/server/identity';
import type { MeResponse } from '@/server/types';

export async function GET(request: Request): Promise<Response> {
  const viewer = await getViewer(request, getEnv());
  const body: MeResponse = {
    signed_in: viewer.signed_in,
    display_name: viewer.display_name,
    user_id: viewer.user_id,
  };
  const cookies = [...viewer.set_cookies];
  const returnTo = safeReturnPath(parseCookies(request.headers.get('cookie'))[RETURN_COOKIE]);
  if (returnTo) {
    body.return_to = returnTo;
    cookies.push(clearCookie(RETURN_COOKIE, new URL(request.url).protocol === 'https:'));
  }
  return withCookies(Response.json(body, { headers: { 'cache-control': 'no-store' } }), cookies);
}
