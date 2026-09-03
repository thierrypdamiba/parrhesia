// POST /api/judge/fork — body {reset?: boolean} (docs/API.md Judge, PLAN.md 2.2 item 9, P6).
// Reuses the judge letter named by the docket_judge cookie unless reset (body or ?reset=1);
// otherwise forks a private copy from the shipped seed. Own rate bucket: judge_forks 30/h/IP.
import { JUDGE_COOKIE, apiContext, grantShare, respond } from '@/server/context';
import { handle, rateLimit, readBody } from '@/server/http';
import { parseCookies, serializeCookie } from '@/server/identity';
import { findJudgeLetter, forkOrReuse } from '@/server/judge';
import { RATE_LIMITS } from '@/server/types';

const JUDGE_COOKIE_TTL = 365 * 24 * 3600;

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const ctx = await apiContext(request);
    const body = await readBody(request, ['reset'] as const);
    const url = new URL(request.url);
    const reset = body.reset === true || body.reset === 1 || url.searchParams.get('reset') === '1';
    const cookie_letter_id = parseCookies(request.headers.get('cookie'))[JUDGE_COOKIE];

    // Count only real forks against the judge bucket; reloading the same letter is free.
    const willFork = reset || !(await findJudgeLetter(ctx.env, cookie_letter_id));
    if (willFork) await rateLimit(ctx.env, 'judge_forks', request, RATE_LIMITS.judge_forks);

    const { letter, reused } = await forkOrReuse(ctx.env, ctx.viewer, ctx.actor, {
      reset,
      cookie_letter_id,
    });
    ctx.cookies.push(
      serializeCookie(JUDGE_COOKIE, letter.id, { maxAge: JUDGE_COOKIE_TTL, secure: ctx.secure }),
    );
    grantShare(ctx, letter.share_code);
    return respond(ctx, {
      letter_id: letter.id,
      share_code: letter.share_code,
      reused,
      rev: letter.rev_hash.slice(0, 12),
      rev_no: letter.rev_no,
      document_number: letter.document_number,
    });
  });
}
