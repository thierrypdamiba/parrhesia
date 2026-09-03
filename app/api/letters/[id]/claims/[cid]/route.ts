// PATCH /api/letters/:id/claims/:cid {base_rev, field, text} → human inline edit (quote
// re-verified; pending edit proposals on that field go stale).
// DELETE … {base_rev, hold_ms} → held delete (docs/API.md).
import { assertBaseRev, deleteClaim, editClaimField, requireOpen } from '@/server/letter';
import {
  editInput,
  holdField,
  ok,
  readBody,
  requireBoundRule,
  requireCanEdit,
  requireHuman,
  withLetter,
  type IdParams,
} from '../../../_shared';

export async function PATCH(request: Request, ctx: IdParams<'cid'>): Promise<Response> {
  return withLetter(request, ctx, async (lc, { cid }) => {
    const body = await readBody(
      request,
      ['base_rev', 'field', 'text'],
      ['base_rev', 'field', 'text'],
    );
    requireCanEdit(lc);
    requireHuman(lc);
    const rule = requireBoundRule(lc);
    requireOpen(lc.letter);
    const { field, text } = editInput(body);
    await assertBaseRev(lc.env, lc.letter, body.base_rev);
    const { claim, nearest, occurrences, write } = await editClaimField(
      lc.env,
      lc.letter,
      rule,
      lc.actor,
      cid,
      field,
      text,
    );
    return ok(lc, {
      claim,
      rev: write.rev,
      rev_no: write.rev_no,
      ...(field === 'quote' && claim.anchor_status === 'unverified' ? { nearest } : {}),
      ...(occurrences.length > 0 ? { occurrences } : {}),
    });
  });
}

export async function DELETE(request: Request, ctx: IdParams<'cid'>): Promise<Response> {
  return withLetter(request, ctx, async (lc, { cid }) => {
    const body = await readBody(request, ['base_rev', 'hold_ms'], ['base_rev']);
    requireCanEdit(lc);
    requireHuman(lc);
    holdField(body);
    await assertBaseRev(lc.env, lc.letter, body.base_rev);
    const write = await deleteClaim(lc.env, lc.letter, lc.actor, cid);
    return ok(lc, { rev: write.rev, rev_no: write.rev_no });
  });
}
