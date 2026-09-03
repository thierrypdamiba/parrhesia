import assert from 'node:assert/strict';
import { test } from 'node:test';

import { APP_NAME } from '../lib/app';
import { TOOL_ORDER } from '../src/webmcp/schema';
import {
  CANNOT_DO,
  SAMPLE_PROMPT,
  firstSentence,
  renderStateMachineMarkdown,
  renderToolTableMarkdown,
  renderToolsDoc,
  toolTableRows,
  toolsForState,
} from './agents-doc';

test('the tool table lists exactly the eight tools in rail order with both hints and reasons', () => {
  const rows = toolTableRows();
  assert.deepEqual(
    rows.map(r => r.name),
    TOOL_ORDER,
  );
  for (const r of rows) {
    assert.equal(typeof r.read_only.value, 'boolean');
    assert.equal(typeof r.untrusted.value, 'boolean');
    assert.ok(r.read_only.reason.length > 10, `${r.name} read-only reason`);
    assert.ok(r.untrusted.reason.length > 10, `${r.name} untrusted reason`);
    assert.ok(r.purpose.endsWith('.'), `${r.name} purpose is a sentence`);
    assert.ok(r.errors.length >= 1);
  }
  const md = renderToolTableMarkdown();
  assert.equal(md.split('\n').length, 2 + 8);
  for (const name of TOOL_ORDER) assert.ok(md.includes(`\`${name}\``));
});

test('firstSentence stops at the first period followed by whitespace', () => {
  assert.equal(firstSentence('One. Two.'), 'One.');
  assert.equal(firstSentence('e.g. 2026-17902 attaches. Then more.'), 'e.g.');
  assert.equal(firstSentence('No period here'), 'No period here');
});

test('state machine: unbound → 3 tools; bound → 5; accepted+signed-in → 7; closed removes writes; public → 2', () => {
  const base = {
    closed: false,
    can_edit: true,
    is_public: false,
    accepted_claim: false,
    signed_in: false,
  };
  assert.deepEqual(toolsForState({ ...base, bound: false }).now, [
    'find_open_rules',
    'open_rule',
    'get_letter',
  ]);

  const bound = toolsForState({ ...base, bound: true, document_number: '2026-17902' });
  assert.deepEqual(bound.now, [
    'find_open_rules',
    'read_rule',
    'propose_claim',
    'get_letter',
    'ask_person_to_file',
  ]);
  assert.deepEqual(
    bound.not_now.map(n => [n.name, n.reason]),
    [
      ['open_rule', 'letter is bound to 2026-17902'],
      ['propose_edit', 'no accepted claim yet'],
      ['draft_my_impact', 'sign in with ChatGPT to draft for yourself'],
    ],
  );

  const full = toolsForState({ ...base, bound: true, accepted_claim: true, signed_in: true });
  assert.equal(full.now.length, 7);
  assert.deepEqual(
    full.not_now.map(n => n.name),
    ['open_rule'],
  );

  const closed = toolsForState({
    ...base,
    bound: true,
    closed: true,
    accepted_claim: true,
    signed_in: true,
    comments_close_on: '2026-11-02',
  });
  assert.deepEqual(closed.now, [
    'find_open_rules',
    'read_rule',
    'get_letter',
    'ask_person_to_file',
  ]);
  for (const n of closed.not_now.filter(x => x.name !== 'open_rule')) {
    assert.equal(n.reason, 'comment period closed 2026-11-02');
  }

  const pub = toolsForState({
    ...base,
    bound: true,
    is_public: true,
    can_edit: false,
    accepted_claim: true,
  });
  assert.deepEqual(pub.now, ['read_rule', 'get_letter']);
  assert.ok(pub.not_now.every(n => n.reason === 'read-only public view: no writes at all'));
});

test('the rendered doc carries the intro, the cannot-do list, the sample prompt and the product name', () => {
  const doc = renderToolsDoc();
  assert.ok(doc.includes('document.modelContext.registerTool'));
  assert.ok(doc.includes(SAMPLE_PROMPT));
  assert.ok(doc.includes(APP_NAME));
  assert.ok(!doc.includes('Docket'), 'the product name comes from APP_NAME only');
  for (const c of CANNOT_DO) assert.ok(doc.includes(c.what));
  assert.ok(CANNOT_DO.some(c => c.what.includes('file on regulations.gov')));
  assert.ok(renderStateMachineMarkdown().includes('`open_rule` (letter is bound to 2026-17902)'));
});
