import assert from 'node:assert/strict';
import { test } from 'node:test';

import { USER_AGENT } from '../lib/app';
import {
  assertOpen,
  buildFacetsUrl,
  buildSearchUrl,
  childAgency,
  clip,
  fetchRuleText,
  getDocument,
  httpsUrl,
  searchOpenRules,
  toOpenRule,
  type FetchLike,
  type FrDocument,
} from './fr';
import { HttpError } from './http';
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

// ---------------------------------------------------------------------------
// Document detail, raw-text retry policy, XML fallback (4.1 items 3 and 4)
// ---------------------------------------------------------------------------

const DOC: FrDocument = {
  document_number: '2026-17902',
  title: 'Bicycle Use in Park Areas',
  type: 'Proposed Rule',
  comments_close_on: '2026-11-02',
  html_url: 'https://www.federalregister.gov/d/2026-17902',
  raw_text_url:
    'https://www.federalregister.gov/documents/full_text/text/2026/09/01/2026-17902.txt',
  full_text_xml_url:
    'https://www.federalregister.gov/documents/full_text/xml/2026/09/01/2026-17902.xml',
};

function fetchScript(responses: Array<() => Response>): FetchLike & { calls: string[] } {
  const calls: string[] = [];
  const fn = (async (url: string, init?: RequestInit) => {
    calls.push(url);
    const ua = new Headers(init?.headers).get('user-agent');
    assert.equal(ua, USER_AGENT, 'every FR request carries the product User-Agent');
    const next = responses.shift();
    if (!next) throw new Error(`unexpected fetch ${url}`);
    return next();
  }) as FetchLike & { calls: string[] };
  fn.calls = calls;
  return fn;
}

const GOOD_TXT = '<html><body><pre>[Pages 1-2]\nHello.\n\n[FR Doc. X Filed]\n</pre></body></html>';

test('fetchRuleText: a 404 and a 200 without [FR Doc are transient; third attempt wins', async () => {
  const fetchImpl = fetchScript([
    () => new Response('x'.repeat(4600), { status: 404 }),
    () => new Response('<pre>partial</pre>', { status: 200 }),
    () => new Response(GOOD_TXT, { status: 200 }),
  ]);
  const r = await fetchRuleText(DOC, fetchImpl, []);
  assert.equal(r.kind, 'txt');
  assert.equal(r.source_url, DOC.raw_text_url);
  assert.equal(r.raw, GOOD_TXT);
  assert.equal(fetchImpl.calls.length, 3);
  assert.ok(fetchImpl.calls.every(u => u === DOC.raw_text_url));
});

test('fetchRuleText: after three failed txt attempts the XML is used', async () => {
  const xml = '<RULE><PRTPAGE P="2"/><P>Hello.</P></RULE>';
  const fetchImpl = fetchScript([
    () => new Response('nope', { status: 500 }),
    () => {
      throw new Error('network');
    },
    () => new Response('nope', { status: 404 }),
    () => new Response(xml, { status: 200 }),
  ]);
  const r = await fetchRuleText(DOC, fetchImpl, []);
  assert.equal(r.kind, 'xml');
  assert.equal(r.source_url, DOC.full_text_xml_url);
  assert.equal(fetchImpl.calls.length, 4);
});

test('fetchRuleText: txt and XML both failing is RULE_UNAVAILABLE with html_url', async () => {
  const fetchImpl = fetchScript([
    () => new Response('', { status: 404 }),
    () => new Response('', { status: 404 }),
    () => new Response('', { status: 404 }),
    () => new Response('', { status: 404 }),
  ]);
  await assert.rejects(fetchRuleText(DOC, fetchImpl, []), (err: unknown) => {
    assert.ok(err instanceof HttpError);
    assert.equal(err.status, 502);
    assert.equal(err.body.error, 'RULE_UNAVAILABLE');
    assert.equal(err.body.html_url, DOC.html_url);
    return true;
  });
  const noUrls = fetchScript([]);
  await assert.rejects(
    fetchRuleText({ ...DOC, raw_text_url: null, full_text_xml_url: null }, noUrls, []),
    (err: unknown) => err instanceof HttpError && err.body.error === 'RULE_UNAVAILABLE',
  );
});

test('getDocument: 404 is NOT_FOUND; assertOpen rejects non-proposed and closed rules', async () => {
  const env = { DB: fakeDb() };
  await assert.rejects(
    getDocument(env, '2026-99999', fetchScript([() => new Response('{}', { status: 404 })])),
    (err: unknown) =>
      err instanceof HttpError && err.status === 404 && err.body.error === 'NOT_FOUND',
  );
  await assert.rejects(
    getDocument(env, 'not-a-number', fetchScript([])),
    (err: unknown) => err instanceof HttpError && err.body.error === 'NOT_FOUND',
  );
  const doc = await getDocument(
    env,
    '2026-17902',
    fetchScript([() => Response.json({ ...DOC, type: 'Rule' })]),
  );
  assert.equal(doc.document_number, '2026-17902');
  assert.throws(
    () => assertOpen(doc, '2026-09-03'),
    (err: unknown) =>
      err instanceof HttpError && err.status === 409 && err.body.error === 'NOT_OPEN',
  );
  assert.throws(
    () => assertOpen({ ...DOC, comments_close_on: '2026-09-01' }, '2026-09-03'),
    (err: unknown) => err instanceof HttpError && err.body.error === 'NOT_OPEN',
  );
  assert.throws(
    () => assertOpen({ ...DOC, comments_close_on: null }, '2026-09-03'),
    (err: unknown) => err instanceof HttpError && err.body.error === 'NOT_OPEN',
  );
  assert.doesNotThrow(() => assertOpen(DOC, '2026-09-03'));
  assert.doesNotThrow(() => assertOpen(DOC, '2026-11-02'), 'closing day is still open');
});

test('searchOpenRules: a document-number or exact-title query puts that row first with matched_by', async () => {
  const other: FrDocument = {
    document_number: '2026-15406',
    title: 'First State National Historical Park; Bicycling',
    comments_close_on: '2026-09-28',
    html_url: 'https://www.federalregister.gov/d/2026-15406',
    page_length: 5,
  };
  const body = (count: number, results?: FrDocument[]) =>
    new Response(JSON.stringify(results ? { count, results } : { count }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  const fetchImpl = async (url: string) => {
    if (url.includes('per_page=1&')) return body(191);
    if (url.includes('facets'))
      return Response.json({
        'national-park-service': { count: 2, name: 'National Park Service' },
      });
    return body(2, [other, DOC]);
  };
  const byNumber = await searchOpenRules({ DB: fakeDb() }, { query: '2026-17902' }, fetchImpl);
  assert.equal(byNumber.rules[0].document_number, '2026-17902');
  assert.equal(byNumber.rules[0].matched_by, 'document_number');
  assert.equal(byNumber.rules[1].matched_by, undefined);
  assert.equal(byNumber.open_total, 191);

  const byTitle = await searchOpenRules(
    { DB: fakeDb() },
    { query: 'bicycle use in park areas' },
    fetchImpl,
  );
  assert.equal(byTitle.rules[0].document_number, '2026-17902');
  assert.equal(byTitle.rules[0].matched_by, 'title');

  const plain = await searchOpenRules({ DB: fakeDb() }, { query: 'bicycle', limit: 1 }, fetchImpl);
  assert.equal(plain.rules.length, 1);
  assert.equal(plain.rules[0].document_number, '2026-15406');
  assert.equal(plain.count, 2);
  assert.ok(plain.refine, 'count > limit with a query offers the agency facet');
  assert.equal(plain.refine?.options[0].agency_slug, 'national-park-service');
});
