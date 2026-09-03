// Read-range allowlist (PLAN.md 4.4): merged [start, end) intervals of everything the agent has
// read through read_rule in THIS page session. Reset on reload; nothing is pre-covered. A quote
// the verifier finds but the agent never read here is refused with ANCHOR_NOT_READ and the exact
// read_rule call that would show it. This is a page-side grounding discipline, not a security
// boundary (the server verifies substring only); human-typed quotes never pass through it.

import type { Passage } from '../../server/types';

export type Range = readonly [start: number, end: number];

/** Padding around an anchor in the suggested read_rule call (4.4). */
export const READ_HINT_LEAD = 200;
export const READ_HINT_PAD = 400;
export const READ_HINT_WINDOW_MAX = 1500;

export class ReadRanges {
  private ranges: Array<[number, number]> = [];
  private recorded = 0;

  /** Record one passage (or any [start,end) range) as read. Overlapping ranges merge. */
  add(start: number, end: number): void {
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
    this.recorded += 1;
    const next: Array<[number, number]> = [];
    let s = Math.max(0, Math.trunc(start));
    let e = Math.trunc(end);
    let placed = false;
    for (const [rs, re] of this.ranges) {
      if (re < s || rs > e) {
        // Disjoint: keep, in order.
        if (rs > e && !placed) {
          next.push([s, e]);
          placed = true;
        }
        next.push([rs, re]);
      } else {
        // Touching or overlapping: absorb.
        s = Math.min(s, rs);
        e = Math.max(e, re);
      }
    }
    if (!placed) next.push([s, e]);
    next.sort((a, b) => a[0] - b[0]);
    this.ranges = next;
  }

  addPassages(passages: readonly Pick<Passage, 'start' | 'end'>[]): void {
    for (const p of passages) this.add(p.start, p.end);
  }

  /** True when one merged interval covers [start, end) entirely. */
  covers(start: number, end: number): boolean {
    if (end <= start) return false;
    for (const [rs, re] of this.ranges) {
      if (rs <= start && end <= re) return true;
      if (rs > start) break;
    }
    return false;
  }

  /** Merged intervals in offset order (for the rule pane's blue shading). */
  merged(): Range[] {
    return this.ranges.map(r => [r[0], r[1]] as const);
  }

  /** Number of read_rule passages recorded this session (the tool reports it). */
  get count(): number {
    return this.recorded;
  }

  get isEmpty(): boolean {
    return this.ranges.length === 0;
  }

  /** Forget everything (a new letter, or tests). */
  reset(): void {
    this.ranges = [];
    this.recorded = 0;
  }
}

/** The exact read_rule call that would show an anchor the agent has not read (4.4). */
export function readCallFor(anchor: { start: number; end: number }): {
  start: number;
  window: number;
} {
  const len = Math.max(0, anchor.end - anchor.start);
  return {
    start: Math.max(0, anchor.start - READ_HINT_LEAD),
    window: Math.max(200, Math.min(READ_HINT_WINDOW_MAX, len + READ_HINT_PAD)),
  };
}
