// The plain-words check (docs/PLAIN-WORDS.md "What ships" 1 and "Acceptance"). Every rule fires
// on the example the source skill gives for it, every rule is silent on clean prose, and the
// quote exemption holds so a verbatim rule quote is never touched.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  CREDIT,
  CREDIT_LINE,
  MAX_FLAGS,
  PLAIN_WORDS_GUIDE,
  PLAIN_WORDS_GUIDE_MAX_CHARS,
  PLAIN_WORDS_RULES,
  checkPlainWords,
  checkPlainWordsFields,
  excerptAround,
  maskQuotedSpans,
  plainWordsExportLine,
} from './plain-words';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Plain prose with no tell in it; every rule must stay silent here. */
const CLEAN =
  'The trail closes at dusk. I ride it home. Sec. 1.7 notice can be a bulletin-board posting, ' +
  'and nothing in proposed 4.30(b) sets a minimum interval between notice and a designation.';

test('every rule fires on the example the skill gives for it', () => {
  for (const rule of PLAIN_WORDS_RULES) {
    const { flags } = checkPlainWords(rule.example);
    assert.ok(
      flags.some(f => f.rule_id === rule.id),
      `${rule.id} (${rule.source}) did not fire on its own example: ${rule.example}`,
    );
  }
});

test('every rule is silent on a clean sentence', () => {
  const { flags, score } = checkPlainWords(CLEAN);
  assert.deepEqual(flags, [], `clean prose flagged: ${flags.map(f => f.rule_id).join(', ')}`);
  assert.equal(score, 0);
});

test('the rule table is derived from the skill and cites it', () => {
  const mechanical = [7, 8, 9, 13, 14, 19, 20, 22, 23, 24, 26, 30, 31];
  assert.equal(PLAIN_WORDS_RULES.length, mechanical.length);
  const ids = PLAIN_WORDS_RULES.map(r => r.id);
  assert.equal(new Set(ids).size, ids.length, 'rule ids are unique');
  const sections = PLAIN_WORDS_RULES.map(r => {
    const m = r.source.match(/^unslop §(\d+)$/);
    assert.ok(m, `${r.id} must cite the skill as "unslop §N", got "${r.source}"`);
    assert.ok(r.title.length > 0 && r.fix.length > 0 && r.example.length > 0, r.id);
    return Number(m[1]);
  });
  assert.deepEqual(
    [...sections].sort((a, b) => a - b),
    mechanical,
  );
});

test('the word lists come from docs/unslop-SKILL.md verbatim', () => {
  const skill = readFileSync(path.join(root, 'docs', 'unslop-SKILL.md'), 'utf8').toLowerCase();
  const listed = [
    'additionally',
    'crucial',
    'delve',
    'testament',
    'vibrant',
    'serves as',
    'stands as',
    'boasts',
    'in order to',
    'due to the fact that',
    'it is important to note that',
    'substrate',
    'wedge',
    'nexus',
    'north star',
    'flywheel',
    'utilize',
    'leverage',
    'facilitate',
    'numerous',
    'in the event that',
  ];
  for (const word of listed) assert.ok(skill.includes(word), `${word} must be in the skill`);
});

test('acceptance: the slop sentence flags ≥4 with §7 and §8; the plain one flags nothing', () => {
  const slop = checkPlainWords(
    'Additionally, this serves as a testament to the vibrant landscape.',
  );
  assert.ok(slop.flags.length >= 4, `expected ≥4 flags, got ${slop.flags.length}`);
  const sources = new Set(slop.flags.map(f => f.source));
  assert.ok(sources.has('unslop §7'));
  assert.ok(sources.has('unslop §8'));
  assert.equal(checkPlainWords('The trail closes at dusk. I ride it home.').flags.length, 0);
});

test('quoted spans are never flagged, straight or curly', () => {
  const straight = checkPlainWords(
    'The rule says "this serves as a testament to the vibrant landscape" and I disagree.',
  );
  assert.deepEqual(straight.flags, []);

  const curly = checkPlainWords('The rule says “a testament to the vibrant landscape” today.');
  assert.deepEqual(
    curly.flags.map(f => f.rule_id),
    ['curly-quotes', 'curly-quotes'],
    'the curly delimiters are still flagged (§19); the text between them is not',
  );

  // An unclosed quote silences the rest: someone is still typing the quotation.
  assert.deepEqual(checkPlainWords('He wrote "a testament to the landscape').flags, []);

  // Masking keeps every offset, so flags outside the span still point at the right characters.
  const text = 'A "testament" is utilized here.';
  const masked = maskQuotedSpans(text);
  assert.equal(masked.length, text.length);
  const flag = checkPlainWords(text).flags[0];
  assert.equal(flag.rule_id, 'plain-word');
  assert.equal(text.slice(flag.start, flag.end), 'utilized');
});

test('flag offsets index the original text and the excerpt shows the person their words', () => {
  const text = 'It is important to note that the trail closes at dusk, quickly and without notice.';
  const { flags } = checkPlainWords(text);
  for (const f of flags) {
    assert.ok(f.start >= 0 && f.end <= text.length && f.start < f.end);
    assert.ok(f.excerpt.includes(text.slice(f.start, f.end)), f.excerpt);
  }
  assert.deepEqual(
    flags.map(f => text.slice(f.start, f.end).toLowerCase()),
    ['it is important to note that', 'quickly'],
  );
  assert.equal(excerptAround('one two three', 4, 7), 'one two three');
  assert.ok(excerptAround(`${'x'.repeat(80)} testament ${'y'.repeat(80)}`, 81, 90).startsWith('…'));
});

test('score is flags per 100 words and 0 is clean', () => {
  // Ten words, one flag.
  const { flags, score } = checkPlainWords('I utilize the trail every day of the week now');
  assert.equal(flags.length, 1);
  assert.equal(score, 10);
  assert.equal(checkPlainWords('').score, 0);
  assert.equal(checkPlainWords(null).flags.length, 0);
  assert.equal(checkPlainWords(undefined).flags.length, 0);
});

test('the check is deterministic and bounded', () => {
  const text = 'Additionally, the vibrant landscape is a testament to the intricate interplay.';
  assert.deepEqual(checkPlainWords(text), checkPlainWords(text));
  const flood = checkPlainWords('testament vibrant landscape '.repeat(40));
  assert.equal(flood.flags.length, MAX_FLAGS);
  assert.ok(checkPlainWordsFields(Array(20).fill(text)).length <= MAX_FLAGS);
});

test('the colon rule catches connectors, not short labels or clock times', () => {
  const connector = checkPlainWords(
    "If you're coming from traditional automation: instead of registering event handlers, you describe conditions.",
  );
  assert.ok(connector.flags.some(f => f.rule_id === 'mid-sentence-colon'));
  for (const ok of [
    'Add to 4.30(b): a designation takes effect no sooner than 30 days after notice.',
    'The notice went up at 14:02 on a bulletin board.',
    'Do this: post the notice, then wait 30 days.',
  ]) {
    assert.deepEqual(
      checkPlainWords(ok).flags.filter(f => f.rule_id === 'mid-sentence-colon'),
      [],
      ok,
    );
  }
});

test('hedging needs a stack, one hedge is fine', () => {
  assert.deepEqual(checkPlainWords('The designation may take effect in June.').flags, []);
  const stacked = checkPlainWords('It could potentially possibly be argued that it might close.');
  assert.deepEqual(
    stacked.flags.map(f => f.rule_id),
    ['excessive-hedging'],
  );
});

test('dashes: em, en and spaced or doubled hyphens; a hyphenated word is fine', () => {
  for (const bad of ['a — b', 'a – b', 'a - b', 'a--b']) {
    assert.ok(
      checkPlainWords(`The trail closes ${bad} and I ride home`).flags.some(
        f => f.rule_id === 'dash-as-connector',
      ),
      bad,
    );
  }
  assert.deepEqual(checkPlainWords('A bulletin-board posting is not notice.').flags, []);
});

test('checkPlainWordsFields counts every claimant field', () => {
  const flags = checkPlainWordsFields([
    'Additionally the trail closes.',
    null,
    'We utilize it.',
    '',
  ]);
  assert.deepEqual(
    flags.map(f => f.rule_id),
    ['ai-vocabulary', 'plain-word'],
  );
});

test('the judge seed reads like a person (docs/PLAIN-WORDS.md acceptance)', () => {
  const seed = JSON.parse(readFileSync(path.join(root, 'seed', '2026-17902.json'), 'utf8')) as {
    claims: Array<{ assertion: string; requested_change: string }>;
  };
  assert.ok(seed.claims[0].assertion.startsWith('Sec. 1.7 notice'));
  assert.ok(
    checkPlainWords(seed.claims[0].assertion).flags.length <= 1,
    'claim 1 assertion must be clean or have at most one flag',
  );
  for (const c of seed.claims) {
    assert.ok(checkPlainWordsFields([c.assertion, c.requested_change]).length <= 2);
  }
});

test('the agent guide fits its budget and the credit names the author', () => {
  assert.ok(
    PLAIN_WORDS_GUIDE.length <= PLAIN_WORDS_GUIDE_MAX_CHARS,
    `guide is ${PLAIN_WORDS_GUIDE.length} chars`,
  );
  assert.ok(PLAIN_WORDS_GUIDE.length > 200);
  assert.ok(!PLAIN_WORDS_GUIDE.includes('—'), 'the guide follows its own §13 rule');
  assert.equal(CREDIT.author, 'Lauren Tan (poteto)');
  assert.equal(CREDIT.license, 'MIT');
  assert.ok(CREDIT.url.includes('cursor/plugins'));
  assert.equal(CREDIT_LINE, 'Writing check adapted from unslop by Lauren Tan (poteto), MIT.');
});

test('the export line names the count and says nothing was applied', () => {
  assert.equal(plainWordsExportLine(2), '[plain words: 2 suggestions not applied]');
});
