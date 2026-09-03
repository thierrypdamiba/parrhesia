// GET /api/letters/by-share/:share_code → {letter_id, can_edit:true}; remembers the share code
// in the httpOnly share cookie so later writes carry can_edit (docs/API.md).
import { apiContext, grantShare, respond } from '@/server/context';
import { handle } from '@/server/http';
import { findLetterBy } from '@/server/letter';

export async function GET(
  request: Request,
  ctx: { params: Promise<{ share_code: string }> },
): Promise<Response> {
  return handle(async () => {
    const { share_code } = await ctx.params;
    const api = await apiContext(request);
    const letter = await findLetterBy(api.env, 'share_code', share_code);
    grantShare(api, letter.share_code);
    return respond(api, { letter_id: letter.id, can_edit: true });
  });
}
