// DELETE /api/letters/:id/signers/:user_id {base_rev, hold_ms} → the letter owner removes a
// signer (P8). Anyone else gets 403. `me` is handled by the sibling static route.
import { fail } from '@/server/http';
import { assertBaseRev, isOwner, loadSigners, removeSigner, stateSigners } from '@/server/letter';
import { holdField, ok, readBody, requireHuman, withLetter, type IdParams } from '../../../_shared';

export async function DELETE(request: Request, ctx: IdParams<'user_id'>): Promise<Response> {
  return withLetter(request, ctx, async (lc, { user_id }) => {
    const body = await readBody(request, ['base_rev', 'hold_ms'], ['base_rev']);
    if (!(await isOwner(lc.letter, lc.viewer))) {
      fail(403, 'FORBIDDEN', 'only the letter owner can remove a signer');
    }
    requireHuman(lc);
    holdField(body);
    await assertBaseRev(lc.env, lc.letter, body.base_rev);
    const write = await removeSigner(lc.env, lc.letter, lc.actor, user_id);
    const signers = await loadSigners(lc.env, lc.letter.id);
    return ok(lc, {
      signers: stateSigners(signers, lc.viewer),
      rev: write.rev,
      rev_no: write.rev_no,
    });
  });
}
