// Per-hour per-IP rate limits (PLAN.md 4.3 ratelimit, 4.4 Links). One D1 statement per check:
// INSERT … ON CONFLICT(bucket) DO UPDATE SET count = count + 1 RETURNING count.

import type { DbEnv } from './envvars';
import { clientIp, rateLimit } from './http';
import { RATE_LIMITS } from './types';

export type RateBucket = keyof typeof RATE_LIMITS;

/** 'letters:203.0.113.9:2026-09-03T14' — the bucket key for one name, address and hour. */
export function bucketKey(name: RateBucket, ip: string, now: Date = new Date()): string {
  return `${name}:${ip}:${now.toISOString().slice(0, 13)}`;
}

/** Throws 429 RATE_LIMITED once the caller's address exceeds RATE_LIMITS[name] this hour. */
export async function enforceRateLimit(
  env: DbEnv,
  name: RateBucket,
  request: Request,
): Promise<void> {
  await rateLimit(env, name, request, RATE_LIMITS[name]);
}

export { clientIp };
