// Env shape and variable lookup with no Workers import, so every server module and every
// node:test file can use it. server/env.ts adds the live `getEnv()` on top (PLAN.md 4.1 item 7).

/** Everything the Worker may find on `env`. Only DB is guaranteed (.openai/hosting.json). */
export interface DocketEnv {
  DB: D1Database;
  /** Optional HMAC secret for the identity-cookie fallback (4.4 Identity). */
  DOCKET_SESSION_SECRET?: string;
  /** '1' enables /dev/signin and /dev/signout (P1). Must be unset in production (P7). */
  DEV_IDENTITY?: string;
  /** 'dynamic' | 'static' | 'auto' (P5). Read by the page via import.meta.env; mirrored here. */
  DOCKET_TOOL_MODE?: string;
}

/** The subset most server modules need. */
export type DbEnv = Pick<DocketEnv, 'DB'>;

export type EnvVarName = 'DOCKET_SESSION_SECRET' | 'DEV_IDENTITY' | 'DOCKET_TOOL_MODE';

/**
 * Read a string variable from `env`, falling back to `process.env` (nodejs_compat exposes it
 * locally when variables come from `.env` files rather than wrangler `vars`).
 */
export function envVar(env: Partial<DocketEnv> | undefined, name: EnvVarName): string | undefined {
  const fromEnv = env?.[name];
  if (typeof fromEnv === 'string' && fromEnv !== '') return fromEnv;
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  const fromProcess = proc?.env?.[name];
  return typeof fromProcess === 'string' && fromProcess !== '' ? fromProcess : undefined;
}
