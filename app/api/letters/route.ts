// POST /api/letters {document_number?} → 201 create (+ bind in the same request) (docs/API.md).
import { apiContext, respond } from '@/server/context';
import { ensureRule, ruleHeader } from '@/server/fr';
import { fail, handle, readBody, stringField } from '@/server/http';
import { createLetter, shortRev } from '@/server/letter';
import { enforceRateLimit } from '@/server/ratelimit';
import { isClosed } from '@/server/time';
import type { RuleCacheParsed } from '@/server/types';

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const ctx = await apiContext(request);
    const body = await readBody(request, ['document_number']);
    await enforceRateLimit(ctx.env, 'letters', request);
    let rule: RuleCacheParsed | null = null;
    if (body.document_number !== undefined) {
      const document_number = stringField(body, 'document_number', {
        max: 12,
        required: true,
        pattern: /^\d{4}-\d{4,6}$/,
      });
      await enforceRateLimit(ctx.env, 'binds', request);
      rule = await ensureRule(ctx.env, document_number);
      if (isClosed(rule.comments_close_on)) {
        fail(409, 'NOT_OPEN', `${document_number} closed for comment on ${rule.comments_close_on}`);
      }
    }
    const letter = await createLetter(ctx.env, ctx.viewer, ctx.actor, { rule });
    return respond(
      ctx,
      {
        letter_id: letter.id,
        share_code: letter.share_code,
        public_token: letter.public_token,
        rev: shortRev(letter.rev_hash),
        rev_no: letter.rev_no,
        rule: rule ? ruleHeader(rule) : null,
        toc: rule?.toc ?? [],
      },
      { status: 201 },
    );
  });
}
