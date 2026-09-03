import assert from 'node:assert/strict';
import { test } from 'node:test';

import { renderToStaticMarkup } from 'react-dom/server';

import { EMPTY_RAIL_STATUS, type RailStatus, ToolRail, modeBadge } from './rail';

const status: RailStatus = {
  ...EMPTY_RAIL_STATUS,
  mode: 'static',
  detected: true,
  hostLabel:
    'ChatGPT browser: all tools registered; gates enforced in execute (rail shows what would succeed now)',
  now: ['find_open_rules', 'read_rule', 'propose_claim', 'get_letter', 'ask_person_to_file'],
  notNow: [
    { name: 'open_rule', reason: 'letter is bound to 2026-17902' },
    { name: 'propose_edit', reason: 'no accepted claim yet' },
    { name: 'draft_my_impact', reason: 'sign in with ChatGPT to draft for yourself' },
  ],
  registered: ['find_open_rules'],
  busy: true,
  last: {
    seq: 1,
    tool: 'read_rule',
    input: '{query:"30 days"}',
    result_summary: '3 passages',
    ok: true,
    ms: 212,
    at: '2026-09-03T14:03:00.000Z',
  },
};

test('the rail prints now / not now / mode / last call per 2.4 as text nodes', () => {
  const html = renderToStaticMarkup(<ToolRail status={status} />);
  assert.match(
    html,
    /Agent can call now: <\/span><span class="pr-now">find_open_rules · read_rule · propose_claim · get_letter · ask_person_to_file<\/span>/,
  );
  assert.match(
    html,
    /Not now: <\/span><span class="pr-not">open_rule \(letter is bound to 2026-17902\) · propose_edit \(no accepted claim yet\) · draft_my_impact \(sign in with ChatGPT to draft for yourself\)<\/span>/,
  );
  assert.match(html, /read_rule\(\{query:&quot;30 days&quot;\}\) → 3 passages \(212 ms\)/);
  assert.match(html, /data-busy="true"/);
  assert.match(html, /ChatGPT browser: all tools registered/);
  assert.match(html, /height:40px/);
  assert.ok(!html.includes('dangerouslySetInnerHTML'));
});

test('untrusted text in a reason or call line is escaped, not rendered as markup', () => {
  const hostile: RailStatus = {
    ...status,
    notNow: [{ name: 'open_rule', reason: '<img src=x onerror=alert(1)>' }],
    last: { ...status.last!, input: '{query:"<script>alert(1)</script>"}' },
  };
  const html = renderToStaticMarkup(<ToolRail status={hostile} />);
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('<script>'));
  assert.match(html, /&lt;img src=x/);
});

test('before detection the rail says so and shows the gate view', () => {
  const html = renderToStaticMarkup(
    <ToolRail status={{ ...EMPTY_RAIL_STATUS, now: ['get_letter'] }} />,
  );
  assert.match(html, /detecting host/);
  assert.match(html, /get_letter/);
  assert.equal(modeBadge({ mode: 'none', detected: true }), 'no host');
  assert.equal(modeBadge({ mode: 'dynamic', detected: true }), 'dynamic');
});
