import assert from 'node:assert/strict';
import { test } from 'node:test';

import { bucketKey } from './ratelimit';
import { RATE_LIMITS } from './types';

test('bucket key is name:ip:hour so a bucket rolls over every hour', () => {
  const at = new Date('2026-09-03T14:59:59.000Z');
  assert.equal(bucketKey('letters', '203.0.113.9', at), 'letters:203.0.113.9:2026-09-03T14');
  const next = new Date('2026-09-03T15:00:00.000Z');
  assert.notEqual(
    bucketKey('letters', '203.0.113.9', at),
    bucketKey('letters', '203.0.113.9', next),
  );
  assert.notEqual(bucketKey('letters', '1.1.1.1', at), bucketKey('proposals', '1.1.1.1', at));
});

test('the buckets in PLAN.md 4.4 exist with their limits', () => {
  assert.deepEqual(RATE_LIMITS, {
    judge_forks: 30,
    letters: 60,
    proposals: 120,
    binds: 60,
    reads: 600,
  });
});
