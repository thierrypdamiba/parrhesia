// POST /api/letters/:id/bind {document_number} → attach a rule once (409 ALREADY_BOUND).
import { ensureRule, ruleHeader } from '@/server/fr';
import { fail, stringField } from '@/server/http';
import { bindRule } from '@/server/letter';
import { enforceRateLimit } from '@/server/ratelimit';
import { isClosed } from '@/server/time';
import { ok, readBody, requireCanEdit, withLetter, type IdParams } from '../../_shared';

export async function POST(request: Request, ctx: IdParams): Promise<Response> {
  return withLetter(request, ctx, async lc => {
    const body = await readBody(request, ['document_number'], ['document_number']);
    requireCanEdit(lc);
    if (lc.letter.document_number) {
      fail(409, 'ALREADY_BOUND', `letter is bound to ${lc.letter.document_number}`, {
        document_number: lc.letter.document_number,
      });
    }
    const document_number = stringField(body, 'document_number', {
      max: 12,
      required: true,
      pattern: /^\d{4}-\d{4,6}$/,
    });
    await enforceRateLimit(lc.env, 'binds', request);
    const rule = await ensureRule(lc.env, document_number);
    if (isClosed(rule.comments_close_on)) {
      fail(409, 'NOT_OPEN', `${document_number} closed for comment on ${rule.comments_close_on}`);
    }
    const write = await bindRule(lc.env, lc.letter, rule, lc.actor);
    return ok(lc, {
      letter_id: lc.letter.id,
      share_code: lc.letter.share_code,
      public_token: lc.letter.public_token,
      rev: write.rev,
      rev_no: write.rev_no,
      rule: ruleHeader(rule),
      toc: rule.toc,
    });
  });
}
