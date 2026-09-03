import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildFacetsUrl,
  buildSearchUrl,
  childAgency,
  clip,
  httpsUrl,
  searchOpenRules,
  toOpenRule,
} from './fr';
import { daysLeft, addDays, isClosed } from './time';

test('URL builder emits literal brackets and encodes values only', () => {
  const url = buildSearchUrl({
    query: 'bicycle park trails',
    per_page: 5,
    today: '2026-09-03',
    closing_within_days: 30,
  });
  assert.ok(url.includes('conditions[type][]=PRORULE'));
  assert.ok(url.includes('conditions[comment_date][gte]=2026-09-03'));
  assert.ok(url.includes('conditions[comment_date][lte]=2026-10-03'));
  assert.ok(url.includes('conditions[term]=bicycle%20park%20trails'));
  assert.ok(url.includes('fields[]=title'));
  assert.ok(url.includes('fields[]=regulations_dot_gov_info'));
  assert.ok(url.includes('order=relevance'));
  assert.ok(
    buildFacetsUrl('bicycle', '2026-09-03').includes(
      'facets/agency.json?conditions[type][]=PRORULE',
    ),
  );
});

test('days_left / addDays / isClosed', () => {
  assert.equal(daysLeft('2026-11-02', '2026-09-03'), 60);
  assert.equal(daysLeft('2026-09-01', '2026-09-03'), -2);
  assert.equal(addDays('2026-12-30', 3), '2027-01-02');
  assert.equal(isClosed('2026-09-02', '2026-09-03'), true);
  assert.equal(isClosed('2026-09-03', '2026-09-03'), false);
});

test('row mapping: child agency, https upgrade, clipping', () => {
  const rule = toOpenRule(
    {
      document_number: '2026-17902',
      title: 'Bicycle Use in Park Areas',
      agencies: [
        { name: 'Interior Department', slug: 'interior-department', parent_id: null },
        { name: 'National Park Service', slug: 'national-park-service', parent_id: 253 },
      ],
      comments_close_on: '2026-11-02',
      comment_url: 'http://www.regulations.gov/commenton/NPS-2026-0166-0001',
      docket_ids: ['NPS-WASO-DTS#NPS0042897'],
      page_length: 7,
      html_url: 'https://www.federalregister.gov/d/2026-17902',
      regulations_dot_gov_info: { docket_id: 'NPS-2026-0166', document_id: 'NPS-2026-0166-0001' },
    },
    '2026-09-03',
  );
  assert.equal(rule.agency, 'National Park Service');
  assert.equal(rule.agency_slug, 'national-park-service');
  assert.equal(rule.comment_url, 'https://www.regulations.gov/commenton/NPS-2026-0166-0001');
  assert.equal(rule.docket_id, 'NPS-2026-0166');
  assert.equal(rule.days_left, 60);
  assert.equal(childAgency(undefined), null);
  assert.equal(httpsUrl(null), null);
  assert.equal(clip('x'.repeat(100), 90).length, 90);
});

/** A minimal D1 stand-in for fr_cache: prepare().bind().first()/run(). */
function fakeDb(): D1Database {
  const cache = new Map<string, { body: string; fetched_at: string }>();
  const db = {
    prepare(sql: string) {
      let args: unknown[] = [];
      const stmt = {
        bind(...a: unknown[]) {
          args = a;
          return stmt;
        },
        async first() {
          if (sql.startsWith('SELECT body')) return cache.get(String(args[0])) ?? null;
          return null;
        },
        async run() {
          if (sql.startsWith('INSERT INTO fr_cache')) {
            cache.set(String(args[0]), { body: String(args[1]), fetched_at: String(args[2]) });
          }
          return { success: true };
        },
        async all() {
          return { results: [] };
        },
      };
      return stmt;
    },
  };
  return db as unknown as D1Database;
}

test('a {"count":0} body (results absent) yields [] without throwing', async () => {
  const env = { DB: fakeDb() };
  const fetchImpl = async (url: string) =>
    new Response(JSON.stringify(url.includes('per_page=1&') ? { count: 191 } : { count: 0 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  const r = await searchOpenRules(env, { query: 'zzz' }, fetchImpl);
  assert.equal(r.count, 0);
  assert.deepEqual(r.rules, []);
  assert.equal(r.open_total, 191);
  assert.equal(r.refine, undefined);
});
