import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ReadRanges, readCallFor } from './readRanges';

test('nothing is pre-covered; ranges merge and cover exact sub-ranges', () => {
  const r = new ReadRanges();
  assert.equal(r.covers(0, 1), false);
  assert.ok(r.isEmpty);
  r.add(100, 300);
  r.add(250, 400); // overlap
  r.add(400, 450); // touching
  r.add(900, 1000); // disjoint
  assert.deepEqual(r.merged(), [
    [100, 450],
    [900, 1000],
  ]);
  assert.equal(r.count, 4);
  assert.ok(r.covers(100, 450));
  assert.ok(r.covers(120, 130));
  assert.ok(!r.covers(99, 130));
  assert.ok(!r.covers(440, 460));
  assert.ok(!r.covers(500, 600));
  assert.ok(!r.covers(300, 300), 'empty range is never covered');
  r.add(450, 900); // bridges the gap
  assert.deepEqual(r.merged(), [[100, 1000]]);
  r.reset();
  assert.ok(r.isEmpty);
  assert.equal(r.count, 0);
});

test('addPassages records read_rule output and ignores junk', () => {
  const r = new ReadRanges();
  r.addPassages([
    { start: 6921, end: 8121 },
    { start: 20000, end: 20300 },
  ]);
  r.add(Number.NaN, 5);
  r.add(10, 5);
  assert.equal(r.count, 2);
  assert.ok(r.covers(20073, 20230), 'Q1 inside the second passage');
  assert.ok(!r.covers(40935, 41136), 'Q3 not read yet');
});

test('readCallFor is the exact call from PLAN 4.4: start-200, window min(1500, len+400)', () => {
  assert.deepEqual(readCallFor({ start: 40935, end: 41136 }), { start: 40735, window: 601 });
  assert.deepEqual(readCallFor({ start: 50, end: 120 }), { start: 0, window: 470 });
  assert.deepEqual(readCallFor({ start: 1000, end: 2500 }), { start: 800, window: 1500 });
});
