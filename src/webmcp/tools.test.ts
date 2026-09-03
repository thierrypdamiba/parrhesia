// Every execute against mocked page state and a mocked HTTP API (PLAN.md P5 tests): results are
// plain objects within budget, every error has {error, hint}, gates return NOT_AVAILABLE in
// static mode, the read-range allowlist refuses unread anchors, and no schema names a person.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { LetterState, RuleHeader, ToolName } from '../../server/types';
import { CallLog, isToolError, jsonLength } from './guard';
import { ReadRanges } from './readRanges';
import {
  DESCRIPTION_MAX_CHARS,
  FORBIDDEN_PROPERTY_NAMES,
  OUTPUT_BUDGETS,
  TOOLS,
  TOOL_ORDER,
  schemaPropertyNames,
} from './schema';
import {
  buildExecutes,
  desiredTools,
  evaluateGates,
  type PageState,
  staticSetFor,
  staticTools,
  titleFor,
  type ToolContext,
  toolsNotNow,
  toolsNow,
} from './tools';

// ---------------------------------------------------------------------------
// Fixtures (Appendix A numbers)
// ---------------------------------------------------------------------------

const RULE: RuleHeader = {
  document_number: '2026-17902',
  title: 'Bicycle Use in Park Areas',
  agency: 'National Park Service',
  agency_slug: 'national-park-service',
  docket_id: 'NPS-2026-0166',
  document_id: 'NPS-2026-0166-0001',
  comment_url: 'https://www.regulations.gov/commenton/NPS-2026-0166-0001',
  html_url:
    'https://www.federalregister.gov/documents/2026/09/01/2026-17902/bicycle-use-in-park-areas',
  publication_date: '2026-09-01',
  comments_close_on: '2026-11-02',
  days_left: 60,
  pages: { first: 56095, last: 56101 },
  total_chars: 44458,
  fetched_at: '2026-09-03T14:02:00.000Z',
  source_kind: 'txt',
  text_sha256: 'fc22cd12737d1979',
};

const Q3 =
  'The use of bicycles and electric bicycles is allowed in other locations designated by the superintendent after notice is provided using one or more of the methods described in Sec. 1.7 of this chapter.';
const Q3_ANCHOR = { start: 40935, end: 41136, page: 56101, unique: true, occurrences: [] };
const BAD =
  'Written determinations for existing trails must be published in the Federal Register for 60 days of public comment.';
const NEAREST = [
  {
    score: 0.696,
    start: 20073,
    end: 20230,
    page: 56098,
    text: 'Written determinations for existing trails and for new trails within developed areas must be published in the Federal Register for 30 days of public comment.',
  },
  { score: 0.241, start: 41137, end: 41273, page: 56101, text: 'x'.repeat(300) },
  { score: 0.208, start: 19987, end: 20072, page: 56098, text: 'y'.repeat(100) },
];
const REV = 'abcdef012345';

const unbound: PageState = {
  letter: null,
  rule: null,
  claimsAccepted: 0,
  signedIn: false,
  viewerName: 'Signer',
  canEdit: true,
  isPublicView: false,
};
const bound: PageState = {
  ...unbound,
  letter: { letter_id: 'l_abcd1234', share_code: 'sharecode', rev: REV, rev_no: 1 },
  rule: RULE,
};
const boundAccepted: PageState = { ...bound, claimsAccepted: 1 };
const signedIn: PageState = { ...boundAccepted, signedIn: true, viewerName: 'Maya' };
const closed: PageState = { ...signedIn, closed: true };
const publicView: PageState = { ...bound, canEdit: false, isPublicView: true };

function letterState(over: Partial<LetterState> = {}): LetterState {
  return {
    letter: {
      id: 'l_abcd1234',
      share_code: 'sharecode',
      public_token: 'pubtoken',
      rev: REV,
      rev_hash: REV + '0'.repeat(52),
      rev_no: 2,
      is_judge_copy: false,
      created_at: '2026-09-03T14:00:00.000Z',
      updated_at: '2026-09-03T14:05:00.000Z',
      rule_sha256: 'fc22',
    },
    rule: RULE,
    claims: Array.from({ length: 8 }, (_, i) => ({
      id: `c_clm0000${i}`,
      letter_id: 'l_abcd1234',
      ord: i,
      quote: Q3,
      anchor_start: 40935,
      anchor_end: 41136,
      page: 56101,
      anchor_status: 'anchored' as const,
      position: 'modify' as const,
      assertion:
        'Sec. 1.7 notice can be a bulletin-board posting; nothing sets a minimum interval.',
      requested_change: i === 1 ? '' : 'Add a 30-day minimum interval after notice.',
      evidence: '',
      proposed_by: 'agent-of:Thierry',
      accepted_by: 'human:Thierry',
      accepted_at: '2026-09-03T14:05:00.000Z',
      created_at: '2026-09-03T14:04:00.000Z',
      updated_at: '2026-09-03T14:05:00.000Z',
    })),
    signers: [
      {
        display_name: 'Maya',
        impact_text: 'I ride these trails weekly.',
        signed_at: '2026-09-03T14:20:00.000Z',
        added_at: '2026-09-03T14:10:00.000Z',
        is_viewer: true,
      },
    ],
    pending: [
      {
        proposal_id: 'p_pend0001',
        kind: 'claim',
        claim_id: null,
        field: null,
        base_rev: REV,
        payload: { text: 'x' },
        diff: null,
        by: 'agent-of:Thierry',
        proposed_for_user_id: null,
        created_at: '2026-09-03T14:06:00.000Z',
      },
    ],
    missing: [
      'claim 2 has no requested change',
      'no signer yet (optional: sign in and add yourself)',
    ],
    activity: [],
    viewer: { signed_in: true, display_name: 'Maya', is_signer: true, can_edit: true },
    closed: false,
    days_left: 60,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Mock API
// ---------------------------------------------------------------------------

interface Call {
  method: string;
  path: string;
  body: unknown;
  headers: Record<string, string>;
}

function mockApi(
  overrides: Partial<Record<string, (call: Call) => { status: number; body: unknown }>> = {},
) {
  const calls: Call[] = [];
  const route = (call: Call): { status: number; body: unknown } => {
    const key = `${call.method} ${call.path.split('?')[0]}`;
    const custom = overrides[key];
    if (custom) return custom(call);
    switch (key) {
      case 'GET /api/rules': {
        const q = new URL(call.path, 'http://x').searchParams.get('query') ?? '';
        if (q === 'zzz')
          return { status: 200, body: { as_of: 't', open_total: 191, count: 0, rules: [] } };
        return {
          status: 200,
          body: {
            as_of: '2026-09-03T14:02:00.000Z',
            open_total: 191,
            count: 4,
            rules: Array.from({ length: 4 }, (_, i) => ({
              document_number: i === 1 ? '2026-17902' : `2026-1540${i}`,
              title:
                'Bicycle Use in Park Areas and a very long title that keeps going and going beyond ninety characters',
              agency: 'National Park Service',
              comments_close_on: '2026-11-02',
              days_left: 60,
              pages: 7,
              html_url: RULE.html_url,
              ...(i === 1 ? { matched_by: 'title' } : {}),
            })),
            refine: {
              question: 'Which agency?',
              facet: 'agency',
              options: Array.from({ length: 9 }, (_, i) => ({
                agency_slug: `a-${i}`,
                name: `Agency ${i}`,
                count: i,
              })),
            },
          },
        };
      }
      case 'POST /api/letters':
      case 'POST /api/letters/l_abcd1234/bind':
        return {
          status: 201,
          body: {
            letter_id: 'l_abcd1234',
            share_code: 'sharecode',
            public_token: 'pubtoken',
            rev: REV,
            rev_no: 1,
            rule: RULE,
            toc: Array.from({ length: 20 }, (_, i) => ({
              heading: `Heading ${i}`,
              start: i * 100,
            })),
          },
        };
      case 'POST /api/letters/l_abcd1234/read': {
        const b = call.body as {
          query?: string;
          start?: number;
          window?: number;
          max_passages?: number;
        };
        if (b.query === 'nothing here')
          return {
            status: 404,
            body: {
              error: 'NO_MATCH',
              hint: 'no passage matches "nothing here"; headings: SUMMARY, DATES',
            },
          };
        const n = b.max_passages ?? 1;
        const w = b.window ?? 1200;
        const start = b.start ?? 6921;
        return {
          status: 200,
          body: {
            document_number: '2026-17902',
            rev: REV,
            total_chars: 44458,
            matches_total: 5,
            passages: Array.from({ length: n }, (_, i) => ({
              start: start + i * w,
              end: start + (i + 1) * w,
              page: 56096,
              text: 'w'.repeat(w),
            })),
          },
        };
      }
      case 'POST /api/letters/l_abcd1234/verify': {
        const { quote } = call.body as { quote: string };
        if (quote === BAD)
          return {
            status: 422,
            body: { error: 'ANCHOR_NOT_FOUND', hint: 'not in rule', nearest: NEAREST },
          };
        return { status: 200, body: { anchor: Q3_ANCHOR, normalized_quote: quote } };
      }
      case 'POST /api/letters/l_abcd1234/proposals': {
        const b = call.body as { kind: string; base_rev: string; claim_id?: string };
        if (b.base_rev === 'aaaaaaaaaaaa') {
          return {
            status: 409,
            body: {
              error: 'STALE_REVISION',
              hint: 'changed',
              current_rev: REV,
              changed_since: [
                {
                  claim_id: 'c_clm00000',
                  field: 'assertion',
                  by: 'human:Thierry',
                  summary: 'assertion edited',
                },
              ],
            },
          };
        }
        return {
          status: 201,
          body: {
            proposal_id: 'p_new00001',
            status: 'pending',
            base_rev: b.base_rev,
            kind: b.kind,
            anchor: b.kind === 'claim' ? Q3_ANCHOR : undefined,
            diff: b.kind === 'edit' ? { removed: ['old'], added: ['new'] } : undefined,
            pending_count: 2,
          },
        };
      }
      case 'GET /api/letters/l_abcd1234/state':
        return { status: 200, body: letterState() };
      default:
        return { status: 404, body: { error: 'NOT_FOUND', hint: `no route ${key}` } };
    }
  };
  const fetchImpl: typeof fetch = async (input, init) => {
    const path =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const headers = Object.fromEntries(
      Object.entries((init?.headers as Record<string, string>) ?? {}),
    );
    const call: Call = {
      method: init?.method ?? 'GET',
      path,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      headers,
    };
    calls.push(call);
    const { status, body } = route(call);
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { calls, fetch: fetchImpl };
}

function harness(state: PageState, mode: 'dynamic' | 'static' = 'static', api = mockApi()) {
  let current = state;
  const navigations: string[] = [];
  let changed = 0;
  const readRanges = new ReadRanges();
  const log = new CallLog();
  const ctx: ToolContext = {
    getState: () => current,
    mode,
    readRanges,
    log,
    fetch: api.fetch,
    origin: 'https://parrhesia.example',
    navigate: p => navigations.push(p),
    onLetterChanged: () => {
      changed++;
    },
  };
  const executes = buildExecutes(ctx);
  return {
    executes,
    readRanges,
    log,
    api,
    navigations,
    changed: () => changed,
    setState: (s: PageState) => {
      current = s;
    },
  };
}

const VALID_INPUT: Record<ToolName, unknown> = {
  find_open_rules: { query: 'bicycle' },
  open_rule: { document_number: '2026-17902' },
  read_rule: { query: '30 days', max_passages: 5, window: 1500 },
  propose_claim: {
    base_rev: REV,
    quote: Q3,
    position: 'modify',
    assertion: 'Sec. 1.7 notice can be a bulletin-board posting.',
    requested_change: 'Add a 30-day minimum interval.',
  },
  propose_edit: {
    base_rev: REV,
    claim_id: 'c_clm00000',
    field: 'assertion',
    text: 'A sharper assertion about the notice interval.',
  },
  draft_my_impact: {
    base_rev: REV,
    text: 'I ride these trails every week with my kids and a notice interval would let us plan.',
  },
  get_letter: {},
  ask_person_to_file: {},
};

// ---------------------------------------------------------------------------
// Gates (2.3)
// ---------------------------------------------------------------------------

test('desired set is a pure function of page state per 2.3', () => {
  assert.deepEqual(toolsNow(unbound), ['find_open_rules', 'open_rule', 'get_letter']);
  assert.deepEqual(toolsNow(bound), [
    'find_open_rules',
    'read_rule',
    'propose_claim',
    'get_letter',
    'ask_person_to_file',
  ]);
  assert.deepEqual(toolsNotNow(bound), [
    { name: 'open_rule', reason: 'letter is bound to 2026-17902' },
    { name: 'propose_edit', reason: 'no accepted claim yet' },
    { name: 'draft_my_impact', reason: 'sign in with ChatGPT to draft for yourself' },
  ]);
  assert.ok(toolsNow(boundAccepted).includes('propose_edit'));
  assert.ok(toolsNow(signedIn).includes('draft_my_impact'));
  assert.deepEqual(toolsNow(closed), [
    'find_open_rules',
    'read_rule',
    'get_letter',
    'ask_person_to_file',
  ]);
  for (const t of toolsNotNow(closed).filter(
    t => t.name.startsWith('propose') || t.name === 'draft_my_impact',
  )) {
    assert.equal(t.reason, 'comment period closed 2026-11-02');
  }
  assert.deepEqual(toolsNow(publicView), ['read_rule', 'get_letter']);
  for (const t of toolsNotNow(publicView))
    assert.equal(t.reason, 'read-only public view: no writes at all');
  assert.deepEqual(
    toolsNotNow(unbound).find(t => t.name === 'propose_claim')?.reason,
    'Requires a bound letter; call open_rule first',
  );
  assert.deepEqual(staticSetFor(unbound), [...TOOL_ORDER]);
  assert.deepEqual(staticSetFor(publicView), ['read_rule', 'get_letter']);
  assert.equal(evaluateGates(unbound).length, 8);
});

test('titles are rewritten with the document number, size and display name', () => {
  assert.equal(
    titleFor('read_rule', bound),
    'Read passages of 2026-17902 (44,458 chars, pp. 56095-56101)',
  );
  assert.equal(titleFor('read_rule', unbound), 'Read passages of the attached rule');
  assert.equal(titleFor('draft_my_impact', signedIn), 'Draft an impact statement for Maya');
  const h = harness(signedIn, 'dynamic');
  const specs = desiredTools(signedIn, h.executes);
  assert.deepEqual(
    specs.map(s => s.name),
    toolsNow(signedIn),
  );
  assert.equal(staticTools(unbound, h.executes).length, 8);
  for (const s of specs) {
    assert.equal(s.inputSchema.additionalProperties, false);
    assert.equal(typeof s.annotations.readOnlyHint, 'boolean');
    assert.equal(typeof s.annotations.untrustedContentHint, 'boolean');
    assert.ok(s.description.length <= DESCRIPTION_MAX_CHARS);
    for (const forbidden of FORBIDDEN_PROPERTY_NAMES)
      assert.ok(!schemaPropertyNames(s.inputSchema).includes(forbidden));
  }
});

// ---------------------------------------------------------------------------
// Every execute: plain object, in budget, errors carry {error, hint}
// ---------------------------------------------------------------------------

test('every execute returns a plain object within its budget on a fully enabled letter', async () => {
  const h = harness(signedIn);
  // read first so propose_claim's anchor is covered
  await h.executes.read_rule({ start: 40735, window: 601 });
  for (const name of TOOL_ORDER) {
    if (name === 'open_rule') continue; // gated: letter is bound
    const result = await h.executes[name](VALID_INPUT[name]);
    assert.equal(Object.getPrototypeOf(result), Object.prototype, `${name} returns a plain object`);
    assert.ok(
      jsonLength(result) <= OUTPUT_BUDGETS[name],
      `${name} is ${jsonLength(result)} chars, budget ${OUTPUT_BUDGETS[name]}`,
    );
    assert.ok(!isToolError(result), `${name} succeeded: ${JSON.stringify(result).slice(0, 200)}`);
  }
  const openRule = await h.executes.open_rule(VALID_INPUT.open_rule);
  assert.deepEqual(openRule, { error: 'NOT_AVAILABLE', hint: 'letter is bound to 2026-17902' });
  assert.equal(h.log.list().length, 9, 'read + 7 tools + the gated open_rule');
  for (const call of h.api.calls) assert.equal(call.headers['x-docket-actor'], 'agent');
});

test('static-mode gates return NOT_AVAILABLE with the rail reason, out of order', async () => {
  const h = harness(unbound, 'static');
  const claim = await h.executes.propose_claim(VALID_INPUT.propose_claim);
  assert.deepEqual(claim, {
    error: 'NOT_AVAILABLE',
    hint: 'Requires a bound letter; call open_rule first',
  });
  const read = await h.executes.read_rule({ query: '30 days' });
  assert.equal((read as { error: string }).error, 'NOT_AVAILABLE');
  const edit = await h.executes.propose_edit(VALID_INPUT.propose_edit);
  assert.equal((edit as { error: string }).error, 'NOT_AVAILABLE');
  h.setState(bound);
  const impact = await h.executes.draft_my_impact(VALID_INPUT.draft_my_impact);
  assert.deepEqual(impact, {
    error: 'NOT_AVAILABLE',
    hint: 'sign in with ChatGPT to draft for yourself',
  });
  const edit2 = await h.executes.propose_edit(VALID_INPUT.propose_edit);
  assert.deepEqual(edit2, { error: 'NOT_AVAILABLE', hint: 'no accepted claim yet' });
  h.setState(publicView);
  const file = await h.executes.ask_person_to_file({});
  assert.deepEqual(file, {
    error: 'NOT_AVAILABLE',
    hint: 'read-only public view: no writes at all',
  });
  assert.equal(h.api.calls.length, 0, 'gated calls never reach the API');
  for (const e of h.log.list()) assert.equal(e.ok, false);
});

test('input handling: JSON strings tolerated, unknown keys refused, errors before any HTTP', async () => {
  const h = harness(bound);
  const ok = await h.executes.read_rule('{"start": 6921, "window": 300}');
  assert.ok(!isToolError(ok));
  const unknown = await h.executes.read_rule({ query: '30 days', display_name: 'Maya' });
  assert.deepEqual(unknown, { error: 'UNKNOWN_FIELD', hint: 'display_name is not accepted' });
  const invalid = await h.executes.propose_claim({
    ...(VALID_INPUT.propose_claim as object),
    position: 'agree',
  });
  assert.equal((invalid as { error: string }).error, 'INVALID');
  assert.equal(h.api.calls.length, 1);
});

// ---------------------------------------------------------------------------
// Tool specifics
// ---------------------------------------------------------------------------

test('find_open_rules: bounded rows, refine ≤6, NO_MATCH copy, letter binding', async () => {
  const h = harness(unbound);
  const out = (await h.executes.find_open_rules({ query: 'bicycle' })) as Record<string, unknown>;
  assert.equal(out.count, 4);
  const rules = out.rules as Array<Record<string, unknown>>;
  assert.equal(rules.length, 4);
  assert.ok((rules[0].title as string).length <= 90);
  assert.equal(rules[1].matched_by, 'title');
  assert.equal((out.refine as { options: unknown[] }).options.length, 6);
  assert.deepEqual(out.letter, { bound: false });
  assert.match(String(out.next), /open_rule\(\{document_number:"2026-15400"\}\)/);
  const none = await h.executes.find_open_rules({ query: 'zzz' });
  assert.deepEqual(none, {
    error: 'NO_MATCH',
    hint: 'No open rules match "zzz". Try fewer words.',
  });
  h.setState(bound);
  const again = (await h.executes.find_open_rules({ query: 'bicycle' })) as Record<string, unknown>;
  assert.deepEqual(again.letter, { bound: true, document_number: '2026-17902' });
});

test('open_rule creates the letter, caps toc at 16, navigates with the share code, resets ranges', async () => {
  const h = harness(unbound);
  h.readRanges.add(0, 100);
  const out = (await h.executes.open_rule({ document_number: '2026-17902' })) as Record<
    string,
    unknown
  >;
  assert.equal(out.letter_id, 'l_abcd1234');
  assert.equal(out.share_url, 'https://parrhesia.example/l/sharecode');
  assert.equal(out.rev, REV);
  assert.equal((out.toc as unknown[]).length, 16);
  assert.equal(
    out.next,
    'read_rule({query}) or read_rule({start,window}); quote verbatim; then propose_claim with base_rev=rev',
  );
  assert.deepEqual(h.navigations, ['/l/sharecode']);
  assert.ok(h.readRanges.isEmpty);
  assert.equal(h.changed(), 1);
  assert.equal(h.api.calls[0].path, '/api/letters');
  // With an existing unbound letter the bind route is used.
  const h2 = harness({ ...unbound, letter: { letter_id: 'l_abcd1234', rev: REV } });
  await h2.executes.open_rule({ document_number: '2026-17902' });
  assert.equal(h2.api.calls[0].path, '/api/letters/l_abcd1234/bind');
  // RULE_UNAVAILABLE passes through with html_url.
  const h3 = harness(
    unbound,
    'static',
    mockApi({
      'POST /api/letters': () => ({
        status: 502,
        body: { error: 'RULE_UNAVAILABLE', hint: 'HTTP 404', html_url: RULE.html_url },
      }),
    }),
  );
  const err = await h3.executes.open_rule({ document_number: '2026-17902' });
  assert.deepEqual(err, { error: 'RULE_UNAVAILABLE', hint: 'HTTP 404', html_url: RULE.html_url });
  assert.deepEqual(h3.navigations, []);
});

test('read_rule records ranges, stays under 4,500 chars with consistent offsets, passes NO_MATCH', async () => {
  const h = harness(bound);
  const out = (await h.executes.read_rule({
    query: '30 days',
    max_passages: 5,
    window: 1500,
  })) as Record<string, unknown>;
  assert.ok(jsonLength(out) <= 4500);
  assert.equal(out.truncated, true);
  const passages = out.passages as Array<{ start: number; end: number; text: string }>;
  for (const p of passages)
    assert.equal(p.end - p.start, p.text.length, 'offsets match the text served');
  assert.ok(h.readRanges.covers(passages[0].start, passages[0].end));
  assert.equal(out.read_ranges_recorded, passages.length);
  assert.match(String(out.next), /propose_claim\(\{base_rev:"abcdef012345"/);
  const none = await h.executes.read_rule({ query: 'nothing here' });
  assert.equal((none as { error: string }).error, 'NO_MATCH');
  assert.match((none as { hint: string }).hint, /headings: SUMMARY/);
  // Public view sends readonly:true and a read-only next.
  const pub = harness(publicView);
  const r = (await pub.executes.read_rule({ start: 0 })) as Record<string, unknown>;
  assert.equal((pub.api.calls[0].body as { readonly?: boolean }).readonly, true);
  assert.match(String(r.next), /Read-only public view/);
});

test('propose_claim: ANCHOR_NOT_READ before read_rule, pending after, ANCHOR_NOT_FOUND with 3 nearest', async () => {
  const h = harness(bound);
  const unread = (await h.executes.propose_claim(VALID_INPUT.propose_claim)) as Record<
    string,
    unknown
  >;
  assert.equal(unread.error, 'ANCHOR_NOT_READ');
  assert.equal(unread.hint, 'Call read_rule({start:40735,window:601}) then retry');
  assert.deepEqual(unread.read_rule, { start: 40735, window: 601 });
  assert.deepEqual(unread.anchor, { start: 40935, end: 41136, page: 56101, unique: true });
  assert.equal(
    h.api.calls.filter(c => c.path.endsWith('/proposals')).length,
    0,
    'no proposal posted',
  );

  await h.executes.read_rule({ start: 40735, window: 601 });
  const pending = (await h.executes.propose_claim(VALID_INPUT.propose_claim)) as Record<
    string,
    unknown
  >;
  assert.equal(pending.status, 'pending');
  assert.equal(pending.proposal_id, 'p_new00001');
  assert.deepEqual(pending.anchor, { start: 40935, end: 41136, page: 56101, unique: true });
  assert.equal(
    pending.needs_human,
    'A person must hold Accept on the card; proposals never apply on their own.',
  );
  assert.equal(pending.pending_count, 2);
  assert.ok(jsonLength(pending) <= 1500);
  const posted = h.api.calls.find(c => c.path.endsWith('/proposals'))!;
  assert.equal(posted.headers['x-docket-actor'], 'agent');
  assert.deepEqual(posted.body, {
    base_rev: REV,
    kind: 'claim',
    quote: Q3,
    position: 'modify',
    assertion: 'Sec. 1.7 notice can be a bulletin-board posting.',
    requested_change: 'Add a 30-day minimum interval.',
  });

  const bad = (await h.executes.propose_claim({
    ...(VALID_INPUT.propose_claim as object),
    quote: BAD,
  })) as Record<string, unknown>;
  assert.equal(bad.error, 'ANCHOR_NOT_FOUND');
  const nearest = bad.nearest as Array<{ start: number; text: string }>;
  assert.equal(nearest.length, 3);
  assert.equal(nearest[0].start, 20073);
  assert.ok(nearest[1].text.length <= 240);
  assert.ok(jsonLength(bad) <= 1500);

  const stale = (await h.executes.propose_claim({
    ...(VALID_INPUT.propose_claim as object),
    base_rev: 'aaaaaaaaaaaa',
  })) as Record<string, unknown>;
  assert.equal(stale.error, 'STALE_REVISION');
  assert.equal(stale.current_rev, REV);
  assert.equal((stale.changed_since as unknown[]).length, 1);
});

test('propose_edit verifies quotes, validates position, returns the diff', async () => {
  const h = harness(boundAccepted);
  const edit = (await h.executes.propose_edit(VALID_INPUT.propose_edit)) as Record<string, unknown>;
  assert.equal(edit.status, 'pending');
  assert.deepEqual(edit.diff, { removed: ['old'], added: ['new'] });
  assert.equal(edit.field, 'assertion');
  assert.equal(edit.anchor, undefined);
  const quoteUnread = (await h.executes.propose_edit({
    ...(VALID_INPUT.propose_edit as object),
    field: 'quote',
    text: Q3,
  })) as Record<string, unknown>;
  assert.equal(quoteUnread.error, 'ANCHOR_NOT_READ');
  await h.executes.read_rule({ start: 40735, window: 601 });
  const quoteOk = (await h.executes.propose_edit({
    ...(VALID_INPUT.propose_edit as object),
    field: 'quote',
    text: Q3,
  })) as Record<string, unknown>;
  assert.deepEqual(quoteOk.anchor, { start: 40935, end: 41136, page: 56101, unique: true });
  const badPos = await h.executes.propose_edit({
    ...(VALID_INPUT.propose_edit as object),
    field: 'position',
    text: 'agree',
  });
  assert.equal((badPos as { error: string }).error, 'INVALID');
});

test('draft_my_impact is bound to the session identity and names the person', async () => {
  const h = harness(signedIn);
  const out = (await h.executes.draft_my_impact(VALID_INPUT.draft_my_impact)) as Record<
    string,
    unknown
  >;
  assert.equal(out.for, 'Maya');
  assert.equal(out.needs_human, 'Maya must hold Accept, then Sign');
  assert.ok((out.preview as string).length <= 120);
  const posted = h.api.calls.find(c => c.path.endsWith('/proposals'))!;
  assert.deepEqual(Object.keys(posted.body as object).sort(), ['base_rev', 'kind', 'text']);
});

test('get_letter: previews, 6 claims then +N more, tools now/not now, NO_LETTER on home', async () => {
  const h = harness(signedIn);
  const out = (await h.executes.get_letter({})) as Record<string, unknown>;
  assert.ok(jsonLength(out) <= 1800);
  const claims = out.claims as Array<Record<string, unknown>>;
  assert.ok(claims.length >= 1 && claims.length <= 6, `claims capped at 6, got ${claims.length}`);
  assert.equal(out.more_claims, `+${8 - claims.length} more`);
  assert.equal(out.truncated, undefined, 'claims give way before the generic truncation');
  assert.ok((claims[0].quote_preview as string).length <= 60);
  assert.equal(claims[1].has_requested_change, false);
  assert.deepEqual(out.signers, [{ display_name: 'Maya', signed: true, has_impact: true }]);
  assert.deepEqual(out.pending, [
    { proposal_id: 'p_pend0001', kind: 'claim', by: 'agent-of:Thierry' },
  ]);
  assert.deepEqual(out.viewer, { signed_in: true, display_name: 'Maya', is_signer: true });
  assert.deepEqual(out.tools_now, [
    'find_open_rules',
    'read_rule',
    'propose_claim',
    'propose_edit',
    'draft_my_impact',
    'get_letter',
    'ask_person_to_file',
  ]);
  assert.deepEqual(out.tools_not_now, [
    { name: 'open_rule', reason: 'letter is bound to 2026-17902' },
  ]);
  assert.match(String(out.next), /1 pending card/);
  const home = harness(unbound);
  const none = (await home.executes.get_letter({})) as Record<string, unknown>;
  assert.equal(none.error, 'NO_LETTER');
  assert.deepEqual(none.tools_now, ['find_open_rules', 'open_rule', 'get_letter']);
});

test('ask_person_to_file always needs a human and falls back to the FR page without a form', async () => {
  const h = harness(bound);
  const out = (await h.executes.ask_person_to_file({})) as Record<string, unknown>;
  assert.equal(out.needs_human, true);
  assert.equal(
    out.reason,
    'Filing happens on regulations.gov by a person; Parrhesia has no filing capability.',
  );
  assert.equal(out.comment_url, RULE.comment_url);
  assert.equal(out.fallback_reason, undefined);
  assert.equal(out.export_url, 'https://parrhesia.example/api/letters/l_abcd1234/export.txt');
  assert.equal(out.ready, false);
  assert.deepEqual(out.missing, [
    'claim 2 has no requested change',
    'no signer yet (optional: sign in and add yourself)',
  ]);
  const noForm = harness(
    bound,
    'static',
    mockApi({
      'GET /api/letters/l_abcd1234/state': () => ({
        status: 200,
        body: letterState({
          rule: { ...RULE, comment_url: null },
          missing: ['no signer yet (optional: sign in and add yourself)'],
        }),
      }),
    }),
  );
  const fb = (await noForm.executes.ask_person_to_file({})) as Record<string, unknown>;
  assert.equal(fb.comment_url, null);
  assert.equal(fb.fallback_url, RULE.html_url);
  assert.equal(fb.fallback_reason, 'this rule takes comments by mail or email; see ADDRESSES');
  assert.equal(fb.ready, true);
});

test('network failures and non-JSON bodies become {error, hint}, never throws', async () => {
  const failing = harness(bound, 'static', {
    calls: [],
    fetch: async () => {
      throw new Error('offline');
    },
  });
  const out = await failing.executes.get_letter({});
  assert.deepEqual(out, {
    error: 'UPSTREAM_UNAVAILABLE',
    hint: 'could not reach the page API (offline)',
  });
  const html = harness(bound, 'static', {
    calls: [],
    fetch: async () => new Response('<html>', { status: 500 }),
  });
  const out2 = await html.executes.get_letter({});
  assert.deepEqual(out2, { error: 'INTERNAL', hint: 'HTTP 500 without a JSON body' });
  const throwing = harness(bound, 'static', {
    calls: [],
    fetch: (() => {
      throw new TypeError('sync boom');
    }) as unknown as typeof fetch,
  });
  const out3 = await throwing.executes.get_letter({});
  assert.equal((out3 as { error: string }).error, 'UPSTREAM_UNAVAILABLE');
});

test('the tool table still has eight entries and the log records every call', () => {
  assert.equal(Object.keys(TOOLS).length, 8);
  const h = harness(bound);
  assert.equal(h.log.list().length, 0);
});
