// Pure client helpers: the inline word diff and the presentation formatters (PLAN.md P4).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { inlineDiff } from './diff';
import { actorLabel, clock, cx, deadline, shortDate } from './format';

describe('inlineDiff', () => {
  it('marks removed and added words in place and keeps common words', () => {
    const tokens = inlineDiff('publish the notice within 30 days', 'publish the notice within 60 days online');
    assert.deepEqual(tokens, [
      { kind: 'same', text: 'publish the notice within' },
      { kind: 'removed', text: '30' },
      { kind: 'added', text: '60' },
      { kind: 'same', text: 'days' },
      { kind: 'added', text: 'online' },
    ]);
  });

  it('handles an empty before (all added) and identical strings (all same)', () => {
    assert.deepEqual(inlineDiff('', 'a b'), [{ kind: 'added', text: 'a b' }]);
    assert.deepEqual(inlineDiff('a b', 'a b'), [{ kind: 'same', text: 'a b' }]);
  });
});

describe('format', () => {
  it('labels actors like the server does', () => {
    assert.equal(actorLabel('agent-of:Maya Chen'), "Maya Chen's agent");
    assert.equal(actorLabel('human:Maya Chen'), 'Maya Chen');
    assert.equal(actorLabel('agent-of:anon'), 'an agent');
    assert.equal(actorLabel('human:anon'), 'someone');
    assert.equal(actorLabel(null), 'someone');
  });

  it('renders deadline chips with the amber/red thresholds', () => {
    assert.deepEqual(deadline('2026-11-02', 60), { text: 'closes Nov 2 · 60 days left', tone: 'plain' });
    assert.equal(deadline('2026-11-02', 14).tone, 'amber');
    assert.equal(deadline('2026-11-02', 3).tone, 'red');
    assert.equal(deadline('2026-11-02', 0).text, 'closes Nov 2 · closes today');
    assert.equal(deadline('2026-11-02', -1).tone, 'closed');
  });

  it('formats clocks in America/New_York and short dates in UTC', () => {
    assert.equal(clock('2026-09-03T18:02:00.000Z'), '14:02');
    assert.equal(clock(null), '');
    assert.equal(shortDate('2026-11-02'), 'Nov 2');
  });

  it('cx joins class names and skips falsy parts', () => {
    assert.equal(cx('card', false && 'x', null, undefined, 'card-stale'), 'card card-stale');
  });
});
