// GET /api/health → {ok, db, migrations, fr_api, now} (PLAN.md P1, P0).
import { getDb, migrate } from '@/server/db';
import { getEnv } from '@/server/env';
import { FR_API, frFetch } from '@/server/fr';

export async function GET(): Promise<Response> {
  const env = getEnv();
  let dbOk = false;
  let migrations: string[] = [];
  try {
    const result = await migrate(env);
    migrations = result.recorded;
    const row = await getDb(env).prepare('SELECT 1 AS one').first<{ one: number }>();
    dbOk = row?.one === 1;
  } catch {
    dbOk = false;
  }
  let fr_api: number | null = null;
  try {
    const res = await frFetch(`${FR_API}/documents.json?per_page=1&conditions[type][]=PRORULE`, {
      signal: AbortSignal.timeout(8000),
    });
    fr_api = res.status;
  } catch {
    fr_api = null;
  }
  return Response.json({ ok: true, db: dbOk, migrations, fr_api, now: new Date().toISOString() });
}
