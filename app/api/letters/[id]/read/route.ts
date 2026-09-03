// POST /api/letters/:id/read {query?, start?, window?, max_passages?, readonly?} → passages of
// the bound rule text. Activity is written only for an agent actor that can edit and did not
// say readonly (the public page always sends readonly:true) (docs/API.md).
import {
  READ_MAX_PASSAGES,
  READ_WINDOW_DEFAULT,
  READ_WINDOW_MAX,
  READ_WINDOW_MIN,
  readPassages,
} from '@/server/anchor';
import { fail, intField, stringField } from '@/server/http';
import { actorLabel, logActivity, shortRev } from '@/server/letter';
import { enforceRateLimit } from '@/server/ratelimit';
import { ok, readBody, requireBoundRule, withLetter, type IdParams } from '../../_shared';

export async function POST(request: Request, ctx: IdParams): Promise<Response> {
  return withLetter(request, ctx, async lc => {
    const body = await readBody(request, ['query', 'start', 'window', 'max_passages', 'readonly']);
    const rule = requireBoundRule(lc);
    await enforceRateLimit(lc.env, 'reads', request);
    const query = stringField(body, 'query', { min: 2, max: 120 }) || undefined;
    const start =
      body.start === undefined || body.start === null
        ? undefined
        : intField(body.start, 'start', { min: 0, max: 10_000_000 });
    if (start !== undefined && start >= rule.text.length) {
      fail(400, 'OUT_OF_RANGE', `start must be below ${rule.text.length}`, {
        total_chars: rule.text.length,
      });
    }
    const window = intField(body.window, 'window', {
      min: READ_WINDOW_MIN,
      max: READ_WINDOW_MAX,
      fallback: READ_WINDOW_DEFAULT,
    });
    const max_passages = intField(body.max_passages, 'max_passages', {
      min: 1,
      max: READ_MAX_PASSAGES,
      fallback: 1,
    });
    if (body.readonly !== undefined && typeof body.readonly !== 'boolean') {
      fail(400, 'INVALID', 'readonly: must be true or false');
    }
    const readonly = body.readonly === true;
    const result = readPassages(rule.text, rule.pages, rule.first_page, {
      query,
      start,
      window,
      max_passages,
    });
    if (query && result.matches_total === 0) {
      const headings = rule.toc.map(t => t.heading).join(', ');
      fail(404, 'NO_MATCH', `no passage matches "${query}"; headings: ${headings}`);
    }
    if (lc.isAgent && !readonly && lc.can_edit && result.passages.length > 0) {
      const ranges = result.passages.map(p => `p. ${p.page} · ${p.start}–${p.end}`).join('; ');
      await logActivity(
        lc.env,
        lc.letter.id,
        lc.actor,
        'read',
        `${actorLabel(lc.actor)} read ${ranges}${query ? ` (query "${query}")` : ''}`,
      );
    }
    return ok(lc, {
      document_number: rule.document_number,
      rev: shortRev(lc.letter.rev_hash),
      total_chars: rule.text.length,
      matches_total: result.matches_total,
      passages: result.passages,
    });
  });
}
