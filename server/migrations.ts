// The ordered list of SQL migrations bundled into the Worker (PLAN.md 4.3, P1).
// Vite inlines each file as a string via `?raw`; node:test gets the same through
// scripts/raw-loader.mjs. Add new files here in order; names must be unique.

import init from '../migrations/0001_init.sql?raw';

export interface Migration {
  /** Recorded in `_migrations.name`. */
  name: string;
  /** Raw SQL; split on ';' by server/db.ts splitSql. */
  sql: string;
}

export const MIGRATIONS: readonly Migration[] = [{ name: '0001_init', sql: init }];
