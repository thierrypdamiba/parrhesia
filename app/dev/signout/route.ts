// GET /dev/signout → clears docket_dev_identity and redirects to /. 404 unless
// env.DEV_IDENTITY === '1' (PLAN.md P1).
import { getEnv } from '@/server/env';
import { DEV_COOKIE, clearCookie, devIdentityEnabled, safeReturnPath } from '@/server/identity';

export async function GET(request: Request): Promise<Response> {
  if (!devIdentityEnabled(getEnv())) return new Response('Not found', { status: 404 });
  const url = new URL(request.url);
  const headers = new Headers({
    location: safeReturnPath(url.searchParams.get('return_to')) ?? '/',
    'cache-control': 'no-store',
  });
  headers.append('set-cookie', clearCookie(DEV_COOKIE, url.protocol === 'https:'));
  return new Response(null, { status: 302, headers });
}
