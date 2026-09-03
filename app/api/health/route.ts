import { env } from 'cloudflare:workers';

type Env = { DB?: { prepare(query: string): { first<T>(): Promise<T | null> } } };

export async function GET(): Promise<Response> {
  const db = (env as Env).DB;
  let dbOk = false;
  try {
    const row = await db?.prepare('SELECT 1 AS one').first<{ one: number }>();
    dbOk = row?.one === 1;
  } catch {
    dbOk = false;
  }
  return Response.json({ ok: true, db: dbOk, now: new Date().toISOString() });
}
