// GET /api/rules/:document_number → RuleHeader (docs/API.md Rules).
import { migrate } from '@/server/db';
import { getEnv } from '@/server/env';
import { ensureRule, ruleHeader } from '@/server/fr';
import { handle, json } from '@/server/http';

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ document_number: string }> },
): Promise<Response> {
  return handle(async () => {
    const env = getEnv();
    await migrate(env);
    const { document_number } = await ctx.params;
    const rule = await ensureRule(env, document_number);
    return json(ruleHeader(rule));
  });
}
