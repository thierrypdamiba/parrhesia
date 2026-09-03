// GET /api/rules/:document_number/meta → offsets for the rule pane (docs/API.md Rules).
import { migrate } from '@/server/db';
import { getEnv } from '@/server/env';
import { ensureRule } from '@/server/fr';
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
    return json(
      {
        document_number: rule.document_number,
        total_chars: rule.text.length,
        first_page: rule.first_page,
        pages: rule.pages,
        breaks: rule.breaks,
        toc: rule.toc,
        text_sha256: rule.text_sha256,
        source_kind: rule.source_kind,
        fetched_at: rule.fetched_at,
      },
      {
        headers: {
          etag: `"${rule.text_sha256}"`,
          'cache-control': 'public, max-age=86400, immutable',
        },
      },
    );
  });
}
