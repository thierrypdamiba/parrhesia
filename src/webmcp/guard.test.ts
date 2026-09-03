import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CallLog,
  compactInput,
  fitBudget,
  formatCall,
  jsonLength,
  parseInput,
  preview,
} from './guard';
import { TOOLS } from './schema';

test('parseInput tolerates JSON strings, applies defaults, rejects unknown keys', () => {
  const schema = TOOLS.read_rule.inputSchema;
  const ok = parseInput(schema, '{"query":"30 days"}');
  assert.ok(ok.ok);
  if (ok.ok) assert.deepEqual(ok.value, { query: '30 days', window: 1200, max_passages: 1 });

  const empty = parseInput(TOOLS.get_letter.inputSchema, undefined);
  assert.ok(empty.ok);

  const unknown = parseInput(schema, { query: '30 days', signer: 'Maya' });
  assert.ok(!unknown.ok);
  if (!unknown.ok)
    assert.deepEqual(unknown.error, { error: 'UNKNOWN_FIELD', hint: 'signer is not accepted' });

  const bad = parseInput(schema, '{not json');
  assert.ok(!bad.ok && bad.error.error === 'INVALID');

  const list = parseInput(schema, [1, 2]);
  assert.ok(!list.ok && list.error.error === 'INVALID');
});

test('parseInput enforces required, enum, length, pattern and integer ranges', () => {
  const schema = TOOLS.propose_claim.inputSchema;
  const missing = parseInput(schema, { quote: 'x'.repeat(30) });
  assert.ok(!missing.ok && missing.error.hint === 'base_rev: required');
  const badRev = parseInput(schema, {
    base_rev: 'ZZZ',
    quote: 'x'.repeat(30),
    position: 'support',
    assertion: 'y'.repeat(30),
  });
  assert.ok(!badRev.ok && /base_rev/.test(badRev.error.hint));
  const badEnum = parseInput(schema, {
    base_rev: 'abcdef012345',
    quote: 'x'.repeat(30),
    position: 'agree',
    assertion: 'y'.repeat(30),
  });
  assert.ok(
    !badEnum.ok && /position: must be one of support, oppose, modify/.test(badEnum.error.hint),
  );
  const short = parseInput(schema, {
    base_rev: 'abcdef012345',
    quote: 'short',
    position: 'support',
    assertion: 'y'.repeat(30),
  });
  assert.ok(!short.ok && short.error.hint === 'quote: at least 20 chars');
  const range = parseInput(TOOLS.read_rule.inputSchema, { window: 5000 });
  assert.ok(!range.ok && range.error.hint === 'window: at most 1500');
  const str = parseInput(TOOLS.read_rule.inputSchema, { start: '20000' });
  assert.ok(str.ok);
  if (str.ok) assert.equal(str.value.start, 20000);
});

test('fitBudget pops arrays first, then shortens previews, and marks truncated', () => {
  const big = {
    rules: Array.from({ length: 40 }, (_, i) => ({
      document_number: `2026-${10000 + i}`,
      title: 'A rule about trails and bicycles in parks',
    })),
    note: 'short',
    next: 'n',
  };
  const fitted = fitBudget(big, 800);
  assert.ok(jsonLength(fitted) <= 800);
  assert.equal(fitted.truncated, true);
  assert.ok(fitted.rules.length < 40 && fitted.rules.length >= 1);
  assert.equal(fitted.rules[0].title, big.rules[0].title, 'arrays shrink before previews');
  assert.equal(big.rules.length, 40, 'input untouched');

  const longText = { passages: [{ start: 0, end: 3000, text: 'word '.repeat(600) }], next: 'x' };
  const cut = fitBudget(longText, 1000);
  assert.ok(jsonLength(cut) <= 1000);
  assert.equal(cut.truncated, true);
  assert.ok(cut.passages[0].text.length < 3000);

  const small = { a: 1 };
  assert.equal(fitBudget(small, 100), small, 'under budget returns the same object');
});

test('preview, compactInput and formatCall are bounded one-liners', () => {
  assert.equal(preview('  a  b\n c ', 60), 'a b c');
  assert.equal(preview('word '.repeat(50), 20).length <= 20, true);
  assert.ok(preview('word '.repeat(50), 20).endsWith('…'));
  const line = formatCall({
    tool: 'read_rule',
    input: compactInput({ query: '30 days' }),
    result_summary: '3 passages',
    ms: 212,
  });
  assert.equal(line, 'read_rule({query:"30 days"}) → 3 passages (212 ms)');
  assert.ok(compactInput({ quote: 'x'.repeat(500) }).length <= 80);
});

test('CallLog is a ring buffer with listeners', () => {
  const log = new CallLog(3);
  const seen: number[] = [];
  const stop = log.subscribe(entries => seen.push(entries.length));
  for (let i = 0; i < 5; i++)
    log.push({ tool: 'get_letter', input: '{}', result_summary: 'ok', ok: true, ms: 1 });
  assert.equal(log.list().length, 3);
  assert.equal(log.last()?.seq, 5);
  assert.deepEqual(seen, [1, 2, 3, 3, 3]);
  stop();
  log.push({ tool: 'get_letter', input: '{}', result_summary: 'ok', ok: true, ms: 1 });
  assert.equal(seen.length, 5);
});
