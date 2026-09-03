// GET /api/letters/:id/export.txt → the letter as plain text with page-cited quotes, the
// "[claimant's words]" labels, signers and the disclosure footer (docs/API.md; PLAN.md 5).
import { withCookies } from '@/server/identity';
import { exportText } from '@/server/export';
import { loadClaims, loadSigners } from '@/server/letter';
import { withLetter, type IdParams } from '../../_shared';

export async function GET(request: Request, ctx: IdParams): Promise<Response> {
  return withLetter(request, ctx, async lc => {
    const [claims, signers] = await Promise.all([
      loadClaims(lc.env, lc.letter.id),
      loadSigners(lc.env, lc.letter.id),
    ]);
    const text = exportText(lc.letter, claims, signers, lc.rule);
    return withCookies(
      new Response(text, {
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'content-disposition': `inline; filename="${lc.letter.id}.txt"`,
          'cache-control': 'no-store',
        },
      }),
      lc.cookies,
    );
  });
}
