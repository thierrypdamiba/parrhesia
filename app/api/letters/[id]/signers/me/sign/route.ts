// POST /api/letters/:id/signers/me/sign {base_rev, hold_ms} → held signature; records
// signed_at for the session user and bumps the revision (docs/API.md).
import {
  assertBaseRev,
  loadSigners,
  requireSignedIn,
  stateSigners,
  updateSelfSigner,
} from '@/server/letter';
import {
  holdField,
  ok,
  readBody,
  requireCanEdit,
  requireHuman,
  withLetter,
  type IdParams,
} from '../../../../_shared';

export async function POST(request: Request, ctx: IdParams): Promise<Response> {
  return withLetter(request, ctx, async lc => {
    const body = await readBody(request, ['base_rev', 'hold_ms'], ['base_rev']);
    requireSignedIn(lc.viewer);
    requireCanEdit(lc);
    requireHuman(lc);
    holdField(body);
    await assertBaseRev(lc.env, lc.letter, body.base_rev);
    const write = await updateSelfSigner(lc.env, lc.letter, lc.viewer, lc.actor, { sign: true });
    const signers = await loadSigners(lc.env, lc.letter.id);
    return ok(lc, {
      signers: stateSigners(signers, lc.viewer),
      rev: write.rev,
      rev_no: write.rev_no,
    });
  });
}
