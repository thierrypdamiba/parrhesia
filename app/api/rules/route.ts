// GET /api/rules?query=&agency_slug=&closing_within_days=&limit= (docs/API.md Rules).
import { migrate } from '@/server/db';
import { getEnv } from '@/server/env';
import { searchOpenRules } from '@/server/fr';
import { handle, json, queryInt, rateLimit } from '@/server/http';
import { RATE_LIMITS } from '@/server/types';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const env = getEnv();
    await migrate(env);
    await rateLimit(env, 'reads', request, RATE_LIMITS.reads);
    const url = new URL(request.url);
    const query = url.searchParams.get('query')?.trim().slice(0, 120) || undefined;
    const agency_slug = url.searchParams.get('agency_slug')?.trim() || undefined;
    if (agency_slug && !/^[a-z0-9-]{1,60}$/.test(agency_slug)) {
      return json(
        { error: 'INVALID', hint: 'agency_slug: lowercase letters, digits and dashes' },
        { status: 400 },
      );
    }
    const result = await searchOpenRules(env, {
      query,
      agency_slug,
      closing_within_days: queryInt(url, 'closing_within_days', { min: 1, max: 120 }),
      limit: queryInt(url, 'limit', { min: 1, max: 8, fallback: 5 }),
    });
    return json(result, { headers: { 'cache-control': 'public, max-age=60' } });
  });
}
