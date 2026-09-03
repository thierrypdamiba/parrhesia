// GET /dev/signin?name=Maya[&return_to=/l/…] → sets docket_dev_identity and redirects.
// 404 unless env.DEV_IDENTITY === '1' (PLAN.md P1). Never enabled in production (P7).
import { getEnv } from '@/server/env';
import {
  DEV_COOKIE,
  devIdentityEnabled,
  safeReturnPath,
  sanitizeDisplayName,
  serializeCookie,
} from '@/server/identity';

export async function GET(request: Request): Promise<Response> {
  if (!devIdentityEnabled(getEnv())) return new Response('Not found', { status: 404 });
  const url = new URL(request.url);
  const name = sanitizeDisplayName(url.searchParams.get('name'));
  const headers = new Headers({
    location: safeReturnPath(url.searchParams.get('return_to')) ?? '/',
    'cache-control': 'no-store',
  });
  headers.append(
    'set-cookie',
    serializeCookie(DEV_COOKIE, name, { maxAge: 24 * 3600, secure: url.protocol === 'https:' }),
  );
  return new Response(null, { status: 302, headers });
}
