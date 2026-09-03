// Typed accessor around the Cloudflare Workers `env` (PLAN.md 4.1 item 7).
// Only route handlers should import this module (it pulls in `cloudflare:workers`); every
// other server module takes a `DocketEnv` (or the narrower `DbEnv`) as a parameter and imports
// the types and `envVar` from ./envvars so it stays testable under node:test.

import { env as workerEnv } from 'cloudflare:workers';
import type { DocketEnv } from './envvars';

export type { DbEnv, DocketEnv, EnvVarName } from './envvars';
export { envVar } from './envvars';

/** The live Worker env, typed. */
export function getEnv(): DocketEnv {
  return workerEnv as unknown as DocketEnv;
}
