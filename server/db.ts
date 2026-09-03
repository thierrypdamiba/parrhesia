// D1 access and migrations (PLAN.md 4.3, P1).
// - migrate(env): splits each migrations/*.sql on ';' (ignoring '--' comments), runs
//   env.DB.batch(statements.map(prepare)), records the name in _migrations, and caches a
//   module-level flag so it runs once per isolate. Never exec() (it splits on newlines).
// - getDb(env): the D1 binding with a clear error when it is missing.

import { MIGRATIONS, type Migration } from './migrations';
import type { DbEnv } from './envvars';

/**
 * Split SQL into statements on ';' outside string literals, dropping '--' line comments
 * (outside string literals) and empty statements. Pure; unit tested.
 */
export function splitSql(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inString = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (inString) {
      current += ch;
      if (ch === "'") {
        // '' inside a string is an escaped quote.
        if (sql[i + 1] === "'") {
          current += "'";
          i++;
        } else {
          inString = false;
        }
      }
      continue;
    }
    if (ch === "'") {
      inString = true;
      current += ch;
      continue;
    }
    if (ch === '-' && sql[i + 1] === '-') {
      // Skip to end of line; keep the newline as whitespace.
      while (i < sql.length && sql[i] !== '\n') i++;
      current += '\n';
      continue;
    }
    if (ch === ';') {
      const trimmed = current.trim();
      if (trimmed) statements.push(trimmed);
      current = '';
      continue;
    }
    current += ch;
  }
  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
}

/** The D1 binding, or a thrown Error naming the missing binding (never a silent undefined). */
export function getDb(env: Partial<DbEnv>): D1Database {
  const db = env.DB;
  if (!db) {
    throw new Error('D1 binding DB is missing; check .openai/hosting.json and vite.config.ts');
  }
  return db;
}

let migrated = false;
let migrating: Promise<MigrateResult> | null = null;

export interface MigrateResult {
  /** Names applied by this call (empty when everything was already recorded). */
  applied: string[];
  /** Every name recorded in _migrations after the call. */
  recorded: string[];
}

const MIGRATIONS_TABLE =
  'CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)';

/**
 * Apply every migration not yet recorded in _migrations. Safe to call on every request:
 * after the first success it returns immediately; concurrent first calls share one promise.
 */
export function migrate(
  env: Partial<DbEnv>,
  migrations: readonly Migration[] = MIGRATIONS,
): Promise<MigrateResult> {
  if (migrated) return Promise.resolve({ applied: [], recorded: migrations.map(m => m.name) });
  if (!migrating) {
    migrating = runMigrations(getDb(env), migrations)
      .then(result => {
        migrated = true;
        return result;
      })
      .finally(() => {
        migrating = null;
      });
  }
  return migrating;
}

/** Test hook: forget the module-level flag (node:test only). */
export function resetMigrationFlagForTests(): void {
  migrated = false;
  migrating = null;
}

async function runMigrations(
  db: D1Database,
  migrations: readonly Migration[],
): Promise<MigrateResult> {
  await db.prepare(MIGRATIONS_TABLE).run();
  const existing = await db.prepare('SELECT name FROM _migrations').all<{ name: string }>();
  const recorded = new Set((existing.results ?? []).map(r => r.name));
  const applied: string[] = [];
  for (const migration of migrations) {
    if (recorded.has(migration.name)) continue;
    const statements = splitSql(migration.sql).map(s => db.prepare(s));
    statements.push(
      db
        .prepare('INSERT OR IGNORE INTO _migrations (name, applied_at) VALUES (?, ?)')
        .bind(migration.name, new Date().toISOString()),
    );
    await db.batch(statements);
    recorded.add(migration.name);
    applied.push(migration.name);
  }
  return { applied, recorded: [...recorded] };
}
