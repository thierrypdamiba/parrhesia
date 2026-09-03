// POST /api/letters/:id/proposals {base_rev, kind, …} → 201 pending proposal (docs/API.md).
// Kinds: claim (quote verified), edit (word diff), impact (for the session user only).
import { fail, stringField } from '@/server/http';
import { assertBaseRev, createProposal, type ProposalInput } from '@/server/letter';
import { enforceRateLimit } from '@/server/ratelimit';
import {
  CLAIM_KEYS,
  claimInput,
  editInput,
  ok,
  onlyKeys,
  readBody,
  requireBoundRule,
  requireCanEdit,
  withLetter,
  type IdParams,
} from '../../_shared';

const UNION = ['base_rev', 'kind', ...CLAIM_KEYS, 'claim_id', 'field', 'text'] as const;
const KIND_KEYS = {
  claim: ['base_rev', 'kind', ...CLAIM_KEYS],
  edit: ['base_rev', 'kind', 'claim_id', 'field', 'text'],
  impact: ['base_rev', 'kind', 'text'],
} as const;

export async function POST(request: Request, ctx: IdParams): Promise<Response> {
  return withLetter(request, ctx, async lc => {
    const body = await readBody(request, UNION, ['base_rev', 'kind']);
    const kind = stringField(body, 'kind', {
      max: 10,
      required: true,
      enum: ['claim', 'edit', 'impact'],
    }) as keyof typeof KIND_KEYS;
    onlyKeys(body, KIND_KEYS[kind]);
    requireCanEdit(lc);
    const rule = requireBoundRule(lc);
    await enforceRateLimit(lc.env, 'proposals', request);

    let input: ProposalInput;
    if (kind === 'claim') {
      input = { kind, input: claimInput(body) };
    } else if (kind === 'edit') {
      const claim_id = stringField(body, 'claim_id', {
        max: 10,
        required: true,
        pattern: /^c_[a-z0-9]{8}$/,
      });
      const { field, text } = editInput(body);
      if (text.length === 0) fail(400, 'INVALID', 'text: at least 1 char');
      input = { kind, claim_id, field, text };
    } else {
      input = { kind, text: stringField(body, 'text', { min: 40, max: 800, required: true }) };
    }
    const base_rev = await assertBaseRev(lc.env, lc.letter, body.base_rev);
    const created = await createProposal(
      lc.env,
      lc.letter,
      rule,
      lc.viewer,
      lc.actor,
      base_rev,
      input,
    );
    const { for_display_name: _omit, ...payload } = created.payload as typeof created.payload & {
      for_display_name?: string;
    };
    void _omit;
    return ok(
      lc,
      {
        proposal_id: created.proposal.id,
        status: 'pending',
        base_rev,
        kind,
        ...(created.proposal.claim_id ? { claim_id: created.proposal.claim_id } : {}),
        ...(created.proposal.field ? { field: created.proposal.field } : {}),
        ...(created.anchor
          ? {
              anchor: {
                start: created.anchor.start,
                end: created.anchor.end,
                page: created.anchor.page,
                unique: created.anchor.unique,
              },
            }
          : {}),
        ...(created.diff ? { diff: created.diff } : {}),
        payload,
        pending_count: created.pending_count,
      },
      201,
    );
  });
}
