// GET /api/letters/by-public/:public_token → {letter_id, can_edit:false}. The public link is
// read-only for everyone (PLAN.md 4.4 Links); it grants nothing.
import { apiContext, respond } from '@/server/context';
import { handle } from '@/server/http';
import { findLetterBy } from '@/server/letter';

export async function GET(
  request: Request,
  ctx: { params: Promise<{ public_token: string }> },
): Promise<Response> {
  return handle(async () => {
    const { public_token } = await ctx.params;
    const api = await apiContext(request);
    const letter = await findLetterBy(api.env, 'public_token', public_token);
    return respond(api, { letter_id: letter.id, can_edit: false });
  });
}
