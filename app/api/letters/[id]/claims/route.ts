// POST /api/letters/:id/claims {base_rev, quote, position, assertion, requested_change?,
// evidence?} → 201 "Add claim by hand": verified the same way; an unverified quote is stored
// flagged with nearest passages returned for the card (docs/API.md).
import { addClaimByHand, assertBaseRev, requireOpen } from '@/server/letter';
import {
  CLAIM_KEYS,
  claimInput,
  ok,
  readBody,
  requireBoundRule,
  requireCanEdit,
  requireHuman,
  withLetter,
  type IdParams,
} from '../../_shared';

export async function POST(request: Request, ctx: IdParams): Promise<Response> {
  return withLetter(request, ctx, async lc => {
    const body = await readBody(request, ['base_rev', ...CLAIM_KEYS], ['base_rev']);
    requireCanEdit(lc);
    requireHuman(lc);
    const rule = requireBoundRule(lc);
    requireOpen(lc.letter);
    const input = claimInput(body);
    await assertBaseRev(lc.env, lc.letter, body.base_rev);
    const { claim, nearest, write } = await addClaimByHand(
      lc.env,
      lc.letter,
      rule,
      lc.actor,
      input,
    );
    return ok(
      lc,
      {
        claim,
        rev: write.rev,
        rev_no: write.rev_no,
        ...(claim.anchor_status === 'unverified' ? { nearest } : {}),
      },
      201,
    );
  });
}
