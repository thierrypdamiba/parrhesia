import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { migrate, resetMigrationFlagForTests, splitSql } from './db';
import { MIGRATIONS } from './migrations';

const initSql = readFileSync(
  path.resolve(import.meta.dirname, '../migrations/0001_init.sql'),
  'utf8',
);

const EXPECTED_TABLES = [
  '_migrations',
  'letters',
  'rules_cache',
  'fr_cache',
  'claims',
  'proposals',
  'signers',
  'revisions',
  'activity',
  'ratelimit',
];

const EXPECTED_INDEXES = [
  'idx_letters_share_code',
  'idx_letters_public_token',
  'idx_letters_document_number',
  'idx_claims_letter_ord',
  'idx_proposals_letter_status',
  'idx_proposals_letter_kind_for',
  'idx_activity_letter',
];

test('splitSql splits on ; outside strings and drops -- comments', () => {
  const sql = `
    -- leading comment; with a semicolon
    CREATE TABLE IF NOT EXISTS a (x TEXT); -- trailing; comment
    INSERT INTO a VALUES ('semi;colon -- not a comment');
    ;;
    SELECT 1
  `;
  assert.deepEqual(splitSql(sql), [
    'CREATE TABLE IF NOT EXISTS a (x TEXT)',
    "INSERT INTO a VALUES ('semi;colon -- not a comment')",
    'SELECT 1',
  ]);
});

test('0001_init.sql is bundled verbatim and contains exactly the 4.3 tables and indexes', () => {
  assert.equal(MIGRATIONS[0].name, '0001_init');
  assert.equal(MIGRATIONS[0].sql, initSql);
  const statements = splitSql(initSql);
  assert.ok(statements.length > 0);
  for (const s of statements) {
    assert.match(
      s,
      /^CREATE (TABLE|INDEX) IF NOT EXISTS /,
      `every statement uses IF NOT EXISTS: ${s.slice(0, 40)}`,
    );
  }
  const tables = statements
    .map(s => /^CREATE TABLE IF NOT EXISTS (\w+)/.exec(s)?.[1])
    .filter((t): t is string => Boolean(t));
  const indexes = statements
    .map(s => /^CREATE INDEX IF NOT EXISTS (\w+)/.exec(s)?.[1])
    .filter((t): t is string => Boolean(t));
  assert.deepEqual(tables.sort(), [...EXPECTED_TABLES].sort());
  assert.deepEqual(indexes.sort(), [...EXPECTED_INDEXES].sort());
  // Columns the plan calls out by name (P1).
  assert.match(initSql, /rule_sha256 TEXT/);
  assert.match(initSql, /breaks_json TEXT NOT NULL/);
  assert.match(initSql, /ON proposals \(letter_id, kind, proposed_for_user_id\)/);
  assert.match(initSql, /PRIMARY KEY \(letter_id, rev_no\)/);
  assert.match(initSql, /PRIMARY KEY \(letter_id, user_id\)/);
});

interface FakeStatement {
  sql: string;
  args: unknown[];
}

function fakeDb() {
  const batches: FakeStatement[][] = [];
  const runs: string[] = [];
  const recorded = new Set<string>();
  const prepare = (sql: string) => {
    const stmt = {
      sql,
      args: [] as unknown[],
      bind(...args: unknown[]) {
        stmt.args = args;
        return stmt;
      },
      async run() {
        runs.push(sql);
        return { success: true };
      },
      async all() {
        return { results: [...recorded].map(name => ({ name })), success: true };
      },
      async first() {
        return null;
      },
    };
    return stmt;
  };
  const db = {
    prepare,
    async batch(statements: FakeStatement[]) {
      batches.push(statements);
      for (const s of statements) {
        if (s.sql.startsWith('INSERT OR IGNORE INTO _migrations')) recorded.add(String(s.args[0]));
      }
      return statements.map(() => ({ success: true }));
    },
    exec() {
      throw new Error('exec() must never be used');
    },
  };
  return { db: db as unknown as D1Database, batches, runs, recorded };
}

test('migrate batches every statement once, records the name, and caches the flag', async () => {
  resetMigrationFlagForTests();
  const fake = fakeDb();
  const env = { DB: fake.db };
  const first = await migrate(env);
  assert.deepEqual(first.applied, ['0001_init']);
  assert.deepEqual(first.recorded, ['0001_init']);
  assert.equal(fake.batches.length, 1);
  const batch = fake.batches[0];
  assert.equal(batch.length, splitSql(initSql).length + 1);
  assert.ok(
    batch.every(s => !s.sql.includes(';')),
    'no statement carries a semicolon',
  );
  assert.match(batch[batch.length - 1].sql, /^INSERT OR IGNORE INTO _migrations/);
  assert.ok(fake.runs.some(r => r.startsWith('CREATE TABLE IF NOT EXISTS _migrations')));

  const second = await migrate(env);
  assert.deepEqual(second.applied, []);
  assert.equal(fake.batches.length, 1, 'module-level flag prevents a second run');

  // A fresh isolate with an already-migrated database applies nothing.
  resetMigrationFlagForTests();
  const third = await migrate(env);
  assert.deepEqual(third.applied, []);
  assert.equal(fake.batches.length, 1);
  resetMigrationFlagForTests();
});

test('migrate shares one in-flight promise between concurrent callers', async () => {
  resetMigrationFlagForTests();
  const fake = fakeDb();
  const env = { DB: fake.db };
  const [a, b] = await Promise.all([migrate(env), migrate(env)]);
  assert.deepEqual(a, b);
  assert.equal(fake.batches.length, 1);
  resetMigrationFlagForTests();
});
