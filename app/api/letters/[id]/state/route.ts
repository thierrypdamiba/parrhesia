// GET /api/letters/:id/state?rev= → {unchanged:true} or LetterState without rule text.
// Polled every 4 s by the page, so it is not rate limited (the 'reads' bucket is for passages).
import { buildState, isRev } from '@/server/letter';
import { ok, withLetter, type IdParams } from '../../_shared';

export async function GET(request: Request, ctx: IdParams): Promise<Response> {
  return withLetter(request, ctx, async lc => {
    const rev = new URL(request.url).searchParams.get('rev');
    if (rev && isRev(rev) && lc.letter.rev_hash.startsWith(rev)) return ok(lc, { unchanged: true });
    return ok(lc, await buildState(lc.env, lc.letter, lc.rule, lc.viewer, lc.can_edit));
  });
}
