// PATCH /api/letters/:id/signers/me/display_name {base_rev, display_name} → the only route that
// accepts a name, only for oneself, only from the page (a tool never sets it) (docs/API.md).
import { fail, stringField } from '@/server/http';
import { sanitizeDisplayName } from '@/server/identity';
import {
  assertBaseRev,
  loadSigners,
  requireSignedIn,
  stateSigners,
  updateSelfSigner,
} from '@/server/letter';
import { LIMITS } from '@/server/types';
import {
  ok,
  readBody,
  requireCanEdit,
  requireHuman,
  withLetter,
  type IdParams,
} from '../../../../_shared';

export async function PATCH(request: Request, ctx: IdParams): Promise<Response> {
  return withLetter(request, ctx, async lc => {
    const body = await readBody(
      request,
      ['base_rev', 'display_name'],
      ['base_rev', 'display_name'],
    );
    requireSignedIn(lc.viewer);
    requireCanEdit(lc);
    requireHuman(lc);
    const raw = stringField(body, 'display_name', {
      max: LIMITS.display_name_chars * 2,
      required: true,
    });
    const display_name = sanitizeDisplayName(raw);
    if (!display_name || display_name === 'Signer') {
      fail(400, 'INVALID', "display_name: use letters, digits, spaces, . ' or - (not 'Signer')");
    }
    await assertBaseRev(lc.env, lc.letter, body.base_rev);
    const write = await updateSelfSigner(lc.env, lc.letter, lc.viewer, lc.actor, { display_name });
    const signers = await loadSigners(lc.env, lc.letter.id);
    return ok(lc, {
      signers: stateSigners(signers, lc.viewer),
      rev: write.rev,
      rev_no: write.rev_no,
    });
  });
}
