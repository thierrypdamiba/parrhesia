// GET /api/rules/:document_number/text[?start=&window=&query=&max_passages=] (docs/API.md Rules).
// Without params: the full normalized text, ETag = text_sha256, immutable. With params: passages.
import { readPassages } from '@/server/anchor';
import { migrate } from '@/server/db';
import { getEnv } from '@/server/env';
import { ensureRule } from '@/server/fr';
import { handle, json, queryInt } from '@/server/http';

export async function GET(
  request: Request,
  ctx: { params: Promise<{ document_number: string }> },
): Promise<Response> {
  return handle(async () => {
    const env = getEnv();
    await migrate(env);
    const { document_number } = await ctx.params;
    const rule = await ensureRule(env, document_number);
    const url = new URL(request.url);
    const hasParams = ['start', 'window', 'query', 'max_passages'].some(k =>
      url.searchParams.has(k),
    );
    const etag = `"${rule.text_sha256}"`;
    if (!hasParams) {
      if (request.headers.get('if-none-match') === etag) {
        return new Response(null, { status: 304, headers: { etag } });
      }
      return new Response(rule.text, {
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          etag,
          'cache-control': 'public, max-age=86400, immutable',
        },
      });
    }
    const start = queryInt(url, 'start', { min: 0, max: 10_000_000 });
    if (start !== undefined && start >= rule.text.length) {
      return json(
        {
          error: 'OUT_OF_RANGE',
          hint: `start must be below ${rule.text.length}`,
          total_chars: rule.text.length,
        },
        { status: 400 },
      );
    }
    const result = readPassages(rule.text, rule.pages, rule.first_page, {
      query: url.searchParams.get('query')?.slice(0, 120) ?? undefined,
      start,
      window: queryInt(url, 'window', { min: 200, max: 1500, fallback: 1200 }),
      max_passages: queryInt(url, 'max_passages', { min: 1, max: 5, fallback: 1 }),
    });
    // Passages are a pure function of the immutable text and the query string, so they carry
    // the same ETag (a weak validator: the JSON body differs per query) and cache policy.
    return json(
      {
        document_number: rule.document_number,
        total_chars: rule.text.length,
        first_page: rule.first_page,
        pages: rule.pages,
        ...result,
      },
      { headers: { etag: `W/${etag}`, 'cache-control': 'public, max-age=86400, immutable' } },
    );
  });
}
