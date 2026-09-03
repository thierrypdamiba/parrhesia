// Signer routes for the session user only (docs/API.md Signers): no body ever carries a name
// or user id; identity comes from getViewer. All require a signed-in session (401).
// POST   {base_rev}               → add yourself as a signer
// PATCH  {base_rev, impact_text}  → write (or clear) your own impact statement
// DELETE {base_rev}               → remove yourself
import { stringField } from '@/server/http';
import {
  addSelfAsSigner,
  assertBaseRev,
  loadSigners,
  requireSignedIn,
  stateSigners,
  updateSelfSigner,
} from '@/server/letter';
import { ok, readBody, requireCanEdit, withLetter, type IdParams } from '../../../_shared';
import type { LetterContext } from '@/server/context';

async function signersResponse(lc: LetterContext, write: { rev: string; rev_no: number }) {
  const signers = await loadSigners(lc.env, lc.letter.id);
  return ok(lc, {
    signers: stateSigners(signers, lc.viewer),
    rev: write.rev,
    rev_no: write.rev_no,
  });
}

export async function POST(request: Request, ctx: IdParams): Promise<Response> {
  return withLetter(request, ctx, async lc => {
    const body = await readBody(request, ['base_rev'], ['base_rev']);
    requireSignedIn(lc.viewer);
    requireCanEdit(lc);
    await assertBaseRev(lc.env, lc.letter, body.base_rev);
    const write = await addSelfAsSigner(lc.env, lc.letter, lc.viewer, lc.actor);
    return signersResponse(lc, write);
  });
}

export async function PATCH(request: Request, ctx: IdParams): Promise<Response> {
  return withLetter(request, ctx, async lc => {
    const body = await readBody(request, ['base_rev', 'impact_text'], ['base_rev', 'impact_text']);
    requireSignedIn(lc.viewer);
    requireCanEdit(lc);
    const impact_text = stringField(body, 'impact_text', { max: 800 });
    await assertBaseRev(lc.env, lc.letter, body.base_rev);
    const write = await updateSelfSigner(lc.env, lc.letter, lc.viewer, lc.actor, { impact_text });
    return signersResponse(lc, write);
  });
}

export async function DELETE(request: Request, ctx: IdParams): Promise<Response> {
  return withLetter(request, ctx, async lc => {
    const body = await readBody(request, ['base_rev'], ['base_rev']);
    requireSignedIn(lc.viewer);
    requireCanEdit(lc);
    await assertBaseRev(lc.env, lc.letter, body.base_rev);
    const write = await updateSelfSigner(lc.env, lc.letter, lc.viewer, lc.actor, { remove: true });
    return signersResponse(lc, write);
  });
}
