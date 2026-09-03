// POST /api/letters/:id/undo {base_rev, hold_ms} → a new revision equal to snapshot N−1
// (PLAN.md 4.4 Undo). 409 NO_CHANGE at rev_no 1.
import { assertBaseRev, undoLast } from '@/server/letter';
import {
  holdField,
  ok,
  readBody,
  requireCanEdit,
  requireHuman,
  withLetter,
  type IdParams,
} from '../../_shared';

export async function POST(request: Request, ctx: IdParams): Promise<Response> {
  return withLetter(request, ctx, async lc => {
    const body = await readBody(request, ['base_rev', 'hold_ms'], ['base_rev']);
    requireCanEdit(lc);
    requireHuman(lc);
    holdField(body);
    await assertBaseRev(lc.env, lc.letter, body.base_rev);
    const write = await undoLast(lc.env, lc.letter, lc.actor);
    return ok(lc, { rev: write.rev, rev_no: write.rev_no });
  });
}
