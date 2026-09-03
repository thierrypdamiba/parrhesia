// POST /api/letters/:id/verify {quote} → {anchor, normalized_quote} or 422 ANCHOR_NOT_FOUND
// {nearest} / ANCHOR_AMBIGUOUS {occurrences}. No state change (docs/API.md).
import { stringField } from '@/server/http';
import { requireAnchor } from '@/server/letter';
import { normalizeQuote } from '@/server/normalize';
import { enforceRateLimit } from '@/server/ratelimit';
import { ok, readBody, requireBoundRule, withLetter, type IdParams } from '../../_shared';

export async function POST(request: Request, ctx: IdParams): Promise<Response> {
  return withLetter(request, ctx, async lc => {
    const body = await readBody(request, ['quote'], ['quote']);
    const rule = requireBoundRule(lc);
    await enforceRateLimit(lc.env, 'reads', request);
    const quote = stringField(body, 'quote', { min: 20, max: 600, required: true });
    const anchor = requireAnchor(rule, quote);
    return ok(lc, { anchor, normalized_quote: normalizeQuote(quote) });
  });
}
