// Federal Register adapter and rule cache (PLAN.md 4.1, P2 item 1). Every federalregister.gov
// request leaves from the Worker with the product User-Agent (browsers cannot preflight the
// API: OPTIONS answers 404). Search/facets go through fr_cache (15 min, stale on failure);
// documents and normalized text live in rules_cache forever.

import { USER_AGENT } from '../lib/app';
import type { DbEnv } from './envvars';
import { fail } from './http';
import { sha256Hex } from './identity';
import { normalizeRule } from './normalize';
import { addDays, daysLeft, todayNY } from './time';
import {
  LIMITS,
  type OpenRule,
  type RuleCache,
  type RuleCacheParsed,
  type RuleHeader,
  type SourceKind,
  type TocEntry,
} from './types';

export const FR_API = 'https://www.federalregister.gov/api/v1';
const SEARCH_FIELDS = [
  'title',
  'document_number',
  'comments_close_on',
  'comment_url',
  'agencies',
  'docket_ids',
  'page_length',
  'publication_date',
  'raw_text_url',
  'html_url',
  'abstract',
  'regulations_dot_gov_info',
];

export interface FrAgency {
  name: string;
  slug: string;
  parent_id: number | null;
  id?: number;
}

/** The subset of a federalregister.gov document we read (4.1 items 1 and 3). */
export interface FrDocument {
  document_number: string;
  title: string;
  type?: string;
  agencies?: FrAgency[];
  comments_close_on?: string | null;
  comment_url?: string | null;
  docket_ids?: string[];
  page_length?: number;
  publication_date?: string;
  raw_text_url?: string | null;
  full_text_xml_url?: string | null;
  html_url: string;
  start_page?: number;
  end_page?: number;
  regulations_dot_gov_info?: {
    docket_id?: string | null;
    document_id?: string | null;
  } | null;
}

export interface SearchOptions {
  query?: string;
  agency_slug?: string;
  closing_within_days?: number;
  limit?: number;
  order?: 'relevance' | 'newest';
}

export interface SearchResult {
  as_of: string;
  open_total: number;
  count: number;
  rules: OpenRule[];
  refine?: {
    question: string;
    facet: 'agency';
    options: Array<{ agency_slug: string; name: string; count: number }>;
  };
  stale?: true;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Build the documents.json URL with literal brackets; only values are encoded (4.1 item 1). */
export function buildSearchUrl(opts: SearchOptions & { per_page: number; today?: string }): string {
  const today = opts.today ?? todayNY();
  const parts = [
    `per_page=${opts.per_page}`,
    'conditions[type][]=PRORULE',
    `conditions[comment_date][gte]=${today}`,
  ];
  if (opts.query) parts.push(`conditions[term]=${encodeURIComponent(opts.query)}`);
  if (opts.agency_slug)
    parts.push(`conditions[agencies][]=${encodeURIComponent(opts.agency_slug)}`);
  if (opts.closing_within_days) {
    parts.push(`conditions[comment_date][lte]=${addDays(today, opts.closing_within_days)}`);
  }
  parts.push(`order=${opts.order ?? (opts.query ? 'relevance' : 'newest')}`);
  for (const f of SEARCH_FIELDS) parts.push(`fields[]=${f}`);
  return `${FR_API}/documents.json?${parts.join('&')}`;
}

export function buildFacetsUrl(query: string | undefined, today: string = todayNY()): string {
  const parts = ['conditions[type][]=PRORULE', `conditions[comment_date][gte]=${today}`];
  if (query) parts.push(`conditions[term]=${encodeURIComponent(query)}`);
  return `${FR_API}/documents/facets/agency.json?${parts.join('&')}`;
}

export function frFetch(url: string, init: RequestInit = {}, fetchImpl: FetchLike = fetch) {
  const headers = new Headers(init.headers);
  headers.set('user-agent', USER_AGENT);
  headers.set(
    'accept',
    init.headers ? (headers.get('accept') ?? '*/*') : 'application/json, text/plain, */*',
  );
  return fetchImpl(url, { ...init, headers, redirect: 'follow' });
}

// ---------------------------------------------------------------------------
// fr_cache
// ---------------------------------------------------------------------------

async function cachedJson<T>(
  env: DbEnv,
  url: string,
  fetchImpl: FetchLike,
): Promise<{ body: T; stale: boolean; fetched_at: string }> {
  const row = await env.DB.prepare('SELECT body, fetched_at FROM fr_cache WHERE key = ?')
    .bind(url)
    .first<{ body: string; fetched_at: string }>();
  const now = Date.now();
  if (row && now - Date.parse(row.fetched_at) < LIMITS.fr_cache_ttl_ms) {
    return { body: JSON.parse(row.body) as T, stale: false, fetched_at: row.fetched_at };
  }
  try {
    const res = await frFetch(url, {}, fetchImpl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const body = JSON.parse(text) as T;
    const fetched_at = new Date().toISOString();
    await env.DB.prepare(
      'INSERT INTO fr_cache (key, body, fetched_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET body = excluded.body, fetched_at = excluded.fetched_at',
    )
      .bind(url, text, fetched_at)
      .run();
    return { body, stale: false, fetched_at };
  } catch (err) {
    if (row) return { body: JSON.parse(row.body) as T, stale: true, fetched_at: row.fetched_at };
    throw err;
  }
}

/** Prune fr_cache rows older than 24 h (4.3). Best effort. */
export async function pruneFrCache(env: DbEnv): Promise<void> {
  const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  await env.DB.prepare('DELETE FROM fr_cache WHERE fetched_at < ?').bind(cutoff).run();
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

export function clip(s: string | null | undefined, max: number): string {
  const t = (s ?? '').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** Child agency (has a parent) when present, else the first agency. */
export function childAgency(agencies: FrAgency[] | undefined): FrAgency | null {
  if (!agencies || agencies.length === 0) return null;
  return agencies.find(a => a.parent_id !== null && a.parent_id !== undefined) ?? agencies[0];
}

export function httpsUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return url.replace(/^http:\/\//i, 'https://');
}

export function toOpenRule(doc: FrDocument, today: string = todayNY()): OpenRule {
  const agency = childAgency(doc.agencies);
  const regs = doc.regulations_dot_gov_info ?? null;
  return {
    document_number: doc.document_number,
    title: clip(doc.title, 90),
    agency: clip(agency?.name ?? 'Unknown agency', 40),
    agency_slug: agency?.slug ?? null,
    comments_close_on: doc.comments_close_on ?? '',
    days_left: daysLeft(doc.comments_close_on ?? null, today),
    docket_id: regs?.docket_id ?? doc.docket_ids?.[0] ?? null,
    document_id: regs?.document_id ?? null,
    comment_url: httpsUrl(doc.comment_url),
    pages: doc.page_length ?? 0,
    html_url: doc.html_url,
  };
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

interface FrSearchBody {
  count: number;
  results?: FrDocument[];
}
type FrFacetsBody = Record<string, { count: number; name: string }>;

export function isDocumentNumber(q: string): boolean {
  return /^\d{4}-\d{4,6}$/.test(q.trim());
}

export async function searchOpenRules(
  env: DbEnv,
  opts: SearchOptions,
  fetchImpl: FetchLike = fetch,
): Promise<SearchResult> {
  const today = todayNY();
  const limit = Math.min(8, Math.max(1, opts.limit ?? 5));
  const query = opts.query?.trim() || undefined;
  let stale = false;
  let search: { body: FrSearchBody; fetched_at: string };
  try {
    const r = await cachedJson<FrSearchBody>(
      env,
      buildSearchUrl({ ...opts, query, per_page: Math.max(limit, 8), today }),
      fetchImpl,
    );
    stale = stale || r.stale;
    search = r;
  } catch (err) {
    fail(
      503,
      'UPSTREAM_UNAVAILABLE',
      `federalregister.gov did not answer (${String(err).slice(0, 80)})`,
    );
  }
  const results = search.body.results ?? []; // absent when count is 0 (4.1 item 1)
  let rules = results.map(d => toOpenRule(d, today));
  if (query) {
    const q = query.toLowerCase();
    const idx = rules.findIndex(
      r => (isDocumentNumber(query) && r.document_number === query) || r.title.toLowerCase() === q,
    );
    if (idx >= 0) {
      const [hit] = rules.splice(idx, 1);
      hit.matched_by = isDocumentNumber(query) ? 'document_number' : 'title';
      rules = [hit, ...rules];
    } else if (isDocumentNumber(query)) {
      // The term search may not index the number itself; ask for the document directly.
      try {
        const doc = await getDocument(env, query, fetchImpl);
        if (doc.comments_close_on && daysLeft(doc.comments_close_on, today) >= 0) {
          rules = [{ ...toOpenRule(doc, today), matched_by: 'document_number' }, ...rules];
        }
      } catch {
        /* not found; fall through */
      }
    }
  }
  rules = rules.slice(0, limit);

  let open_total = search.body.count;
  try {
    const total = await cachedJson<FrSearchBody>(
      env,
      buildSearchUrl({ per_page: 1, today }),
      fetchImpl,
    );
    open_total = total.body.count;
    stale = stale || total.stale;
  } catch {
    /* keep the search count */
  }

  const out: SearchResult = {
    as_of: search.fetched_at,
    open_total,
    count: search.body.count,
    rules,
  };
  if (query && search.body.count > limit) {
    try {
      const facets = await cachedJson<FrFacetsBody>(env, buildFacetsUrl(query, today), fetchImpl);
      const options = Object.entries(facets.body)
        .map(([agency_slug, v]) => ({ agency_slug, name: clip(v.name, 40), count: v.count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 6);
      if (options.length > 0) {
        out.refine = { question: 'Which agency?', facet: 'agency', options };
      }
    } catch {
      /* omit the refine card on failure (4.1 item 2) */
    }
  }
  if (stale) out.stale = true;
  return out;
}

// ---------------------------------------------------------------------------
// Document detail and text
// ---------------------------------------------------------------------------

export async function getDocument(
  env: DbEnv,
  document_number: string,
  fetchImpl: FetchLike = fetch,
): Promise<FrDocument> {
  if (!isDocumentNumber(document_number))
    fail(404, 'NOT_FOUND', `${document_number} is not a Federal Register document number`);
  const cached = await env.DB.prepare(
    'SELECT detail_json FROM rules_cache WHERE document_number = ?',
  )
    .bind(document_number)
    .first<{ detail_json: string | null }>();
  if (cached?.detail_json) return JSON.parse(cached.detail_json) as FrDocument;
  const url = `${FR_API}/documents/${encodeURIComponent(document_number)}.json`;
  let res: Response;
  try {
    res = await frFetch(url, {}, fetchImpl);
  } catch (err) {
    fail(
      502,
      'RULE_UNAVAILABLE',
      `federalregister.gov did not answer (${String(err).slice(0, 80)})`,
      { html_url: null },
    );
  }
  if (res.status === 404) fail(404, 'NOT_FOUND', `No Federal Register document ${document_number}`);
  if (!res.ok)
    fail(502, 'RULE_UNAVAILABLE', `federalregister.gov answered HTTP ${res.status}`, {
      html_url: null,
    });
  return (await res.json()) as FrDocument;
}

/** Require an open proposed rule (4.1 item 3). */
export function assertOpen(doc: FrDocument, today: string = todayNY()): void {
  if (doc.type !== 'Proposed Rule') {
    fail(
      409,
      'NOT_OPEN',
      `${doc.document_number} is a ${doc.type ?? 'document'}, not a proposed rule`,
    );
  }
  if (!doc.comments_close_on) {
    fail(409, 'NOT_OPEN', `${doc.document_number} has no comment period`);
  }
  if (daysLeft(doc.comments_close_on, today) < 0) {
    fail(409, 'NOT_OPEN', `comments on ${doc.document_number} closed ${doc.comments_close_on}`, {
      comments_close_on: doc.comments_close_on,
    });
  }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Raw text with the retry policy in 4.1 item 4, then the XML fallback. */
export async function fetchRuleText(
  doc: FrDocument,
  fetchImpl: FetchLike = fetch,
  delays: number[] = [500, 1500],
): Promise<{ raw: string; kind: SourceKind; source_url: string }> {
  if (doc.raw_text_url) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await frFetch(
          doc.raw_text_url,
          { headers: { accept: 'text/plain, */*' } },
          fetchImpl,
        );
        const body = await res.text();
        if (res.ok && body.includes('[FR Doc')) {
          if (body.length > 4 * LIMITS.rule_text_chars) {
            fail(413, 'RULE_TOO_LARGE', `${doc.document_number} raw text is ${body.length} bytes`);
          }
          return { raw: body, kind: 'txt', source_url: doc.raw_text_url };
        }
      } catch (err) {
        if (err instanceof Error && err.message.startsWith('RULE_TOO_LARGE')) throw err;
      }
      if (attempt < delays.length) await sleep(delays[attempt]);
    }
  }
  if (doc.full_text_xml_url) {
    try {
      const res = await frFetch(
        doc.full_text_xml_url,
        { headers: { accept: 'application/xml, text/xml, */*' } },
        fetchImpl,
      );
      if (res.ok) {
        const body = await res.text();
        if (body.includes('<PRTPAGE') || body.includes('</P>')) {
          return { raw: body, kind: 'xml', source_url: doc.full_text_xml_url };
        }
      }
    } catch {
      /* fall through */
    }
  }
  return fail(
    502,
    'RULE_UNAVAILABLE',
    `Could not load rule text for ${doc.document_number} from federalregister.gov`,
    {
      html_url: doc.html_url ?? null,
    },
  );
}

export function parseRuleRow(row: RuleCache): RuleCacheParsed {
  const { pages_json, breaks_json, toc_json, ...rest } = row;
  return {
    ...rest,
    pages: JSON.parse(pages_json),
    breaks: JSON.parse(breaks_json),
    toc: JSON.parse(toc_json) as TocEntry[],
  };
}

export async function getCachedRule(
  env: DbEnv,
  document_number: string,
): Promise<RuleCacheParsed | null> {
  const row = await env.DB.prepare('SELECT * FROM rules_cache WHERE document_number = ?')
    .bind(document_number)
    .first<RuleCache>();
  return row ? parseRuleRow(row) : null;
}

/** Insert or replace a rules_cache row from raw text (used by ensureRule and the judge seed). */
export async function storeRule(
  env: DbEnv,
  doc: FrDocument,
  raw: string,
  kind: SourceKind,
  source_url: string | null,
): Promise<RuleCacheParsed> {
  const n = normalizeRule(raw, kind === 'xml' ? 'xml' : 'txt');
  if (n.text.length > LIMITS.rule_text_chars) {
    fail(
      413,
      'RULE_TOO_LARGE',
      `${doc.document_number} normalizes to ${n.text.length} chars (cap ${LIMITS.rule_text_chars})`,
    );
  }
  if (n.text.length < 200) {
    fail(502, 'RULE_UNAVAILABLE', `rule text for ${doc.document_number} came back empty`, {
      html_url: doc.html_url ?? null,
    });
  }
  const first_page = n.first_page || doc.start_page || 0;
  const agency = childAgency(doc.agencies);
  const row: RuleCache = {
    document_number: doc.document_number,
    title: doc.title,
    agency: agency?.name ?? null,
    comments_close_on: doc.comments_close_on ?? null,
    text: n.text,
    text_sha256: await sha256Hex(n.text),
    first_page,
    pages_json: JSON.stringify(n.pages),
    breaks_json: JSON.stringify(n.breaks),
    toc_json: JSON.stringify(n.toc),
    source_url,
    source_kind: kind,
    fetched_at: new Date().toISOString(),
    detail_json: JSON.stringify(doc),
  };
  await env.DB.prepare(
    `INSERT INTO rules_cache (document_number, title, agency, comments_close_on, text, text_sha256, first_page, pages_json, breaks_json, toc_json, source_url, source_kind, fetched_at, detail_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(document_number) DO UPDATE SET title=excluded.title, agency=excluded.agency, comments_close_on=excluded.comments_close_on, text=excluded.text, text_sha256=excluded.text_sha256, first_page=excluded.first_page, pages_json=excluded.pages_json, breaks_json=excluded.breaks_json, toc_json=excluded.toc_json, source_url=excluded.source_url, source_kind=excluded.source_kind, fetched_at=excluded.fetched_at, detail_json=excluded.detail_json`,
  )
    .bind(
      row.document_number,
      row.title,
      row.agency,
      row.comments_close_on,
      row.text,
      row.text_sha256,
      row.first_page,
      row.pages_json,
      row.breaks_json,
      row.toc_json,
      row.source_url,
      row.source_kind,
      row.fetched_at,
      row.detail_json,
    )
    .run();
  return parseRuleRow(row);
}

/** rules_cache row for a document, fetching + normalizing on a miss. Throws the P2 errors. */
export async function ensureRule(
  env: DbEnv,
  document_number: string,
  fetchImpl: FetchLike = fetch,
): Promise<RuleCacheParsed> {
  const cached = await getCachedRule(env, document_number);
  if (cached) return cached;
  const doc = await getDocument(env, document_number, fetchImpl);
  assertOpen(doc);
  const { raw, kind, source_url } = await fetchRuleText(doc, fetchImpl);
  return storeRule(env, doc, raw, kind, source_url);
}

/** RuleHeader (section 3 tool 2) from a cache row. */
export function ruleHeader(rule: RuleCacheParsed, today: string = todayNY()): RuleHeader {
  const doc = (rule.detail_json ? JSON.parse(rule.detail_json) : {}) as Partial<FrDocument>;
  const agency = childAgency(doc.agencies);
  const regs = doc.regulations_dot_gov_info ?? null;
  const lastMark = rule.pages[rule.pages.length - 1];
  return {
    document_number: rule.document_number,
    title: rule.title ?? doc.title ?? rule.document_number,
    agency: rule.agency ?? agency?.name ?? 'Unknown agency',
    agency_slug: agency?.slug ?? null,
    docket_id: regs?.docket_id ?? doc.docket_ids?.[0] ?? null,
    document_id: regs?.document_id ?? null,
    comment_url: httpsUrl(doc.comment_url),
    html_url: doc.html_url ?? `https://www.federalregister.gov/d/${rule.document_number}`,
    publication_date: doc.publication_date ?? null,
    comments_close_on: rule.comments_close_on ?? '',
    days_left: daysLeft(rule.comments_close_on, today),
    pages: { first: rule.first_page, last: doc.end_page ?? lastMark?.page ?? rule.first_page },
    total_chars: rule.text.length,
    fetched_at: rule.fetched_at,
    source_kind: rule.source_kind,
    text_sha256: rule.text_sha256,
  };
}
