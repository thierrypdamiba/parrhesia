// POST /api/letters/:id/proposals/:pid/decide {decision, hold_ms?} → accept (held, ≥700 ms)
// or reject. Accept applies the proposal as a new revision (docs/API.md; PLAN.md 4.4).
import { stringField } from '@/server/http';
import { decideProposal } from '@/server/letter';
import {
  holdField,
  ok,
  readBody,
  requireCanEdit,
  requireHuman,
  withLetter,
  type IdParams,
} from '../../../../_shared';

export async function POST(request: Request, ctx: IdParams<'pid'>): Promise<Response> {
  return withLetter(request, ctx, async (lc, { pid }) => {
    const body = await readBody(request, ['decision', 'hold_ms'], ['decision']);
    requireCanEdit(lc);
    requireHuman(lc);
    const decision = stringField(body, 'decision', {
      max: 10,
      required: true,
      enum: ['accept', 'reject'],
    }) as 'accept' | 'reject';
    if (decision === 'accept') holdField(body);
    const result = await decideProposal(lc.env, lc.letter, lc.viewer, lc.actor, pid, decision);
    return ok(lc, { proposal_id: pid, ...result });
  });
}
