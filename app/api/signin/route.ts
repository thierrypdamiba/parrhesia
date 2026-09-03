// GET /api/signin?return_to=<path> → sets docket_return, 302 to /signin-with-chatgpt
// (PLAN.md 4.4 Identity, P1). Only same-origin paths are accepted for return_to.
import { RETURN_COOKIE, safeReturnPath, serializeCookie } from '@/server/identity';

export const SIGNIN_WITH_CHATGPT_PATH = '/signin-with-chatgpt';

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const returnTo = safeReturnPath(url.searchParams.get('return_to')) ?? '/';
  // The cookie covers hosts that ignore return_to; the query covers hosts that honour it
  // (the Sites dev shim does). PROBE.md records which the hosted runtime supports.
  const location = `${SIGNIN_WITH_CHATGPT_PATH}?return_to=${encodeURIComponent(returnTo)}`;
  const headers = new Headers({ location, 'cache-control': 'no-store' });
  headers.append(
    'set-cookie',
    serializeCookie(RETURN_COOKIE, returnTo, { maxAge: 600, secure: url.protocol === 'https:' }),
  );
  return new Response(null, { status: 302, headers });
}
