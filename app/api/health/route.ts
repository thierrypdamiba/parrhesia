// GET /api/health → {ok, db, migrations, now} (PLAN.md P1). Lane A adds fr_api.
import { getDb, migrate } from '@/server/db';
import { getEnv } from '@/server/env';

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
  return Response.json({ ok: true, db: dbOk, migrations, now: new Date().toISOString() });
}
