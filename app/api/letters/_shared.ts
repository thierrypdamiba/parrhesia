// Shared plumbing for every /api/letters route (docs/API.md Letters). Not a route: vinext only
// mounts files named route.ts. Routes stay thin: context → permission → body → letter.ts.
import { letterContext, respond, type LetterContext } from '@/server/context';
import { fail, handle, readBody, stringField } from '@/server/http';
import { requireHold, requireRule, type ClaimInput } from '@/server/letter';
import { NOT_NOW_REASONS } from '@/src/webmcp/schema';
import { CLAIM_FIELDS, POSITIONS, type ClaimField, type RuleCacheParsed } from '@/server/types';

export type IdParams<Extra extends string = never> = {
  params: Promise<{ id: string } & Record<Extra, string>>;
};

/** Resolve the letter (404 NO_LETTER), its cached rule and can_edit, then run the handler. */
export function withLetter<Extra extends string = never>(
  request: Request,
  ctx: IdParams<Extra>,
  fn: (lc: LetterContext, params: { id: string } & Record<Extra, string>) => Promise<Response>,
): Promise<Response> {
  return handle(async () => {
    const params = await ctx.params;
    const lc = await letterContext(request, params.id);
    return fn(lc, params);
  });
}

export function ok(lc: LetterContext, body: unknown, status = 200): Response {
  return respond(lc, body, { status });
}

/** 403 FORBIDDEN unless the caller is the owner or arrived through the co-writing link. */
export function requireCanEdit(lc: LetterContext): void {
  if (!lc.can_edit) fail(403, 'FORBIDDEN', NOT_NOW_REASONS.cannot_edit);
}

/** Held gestures and by-hand edits are things a person does on the page; tools propose. */
export function requireHuman(lc: LetterContext): void {
  if (lc.isAgent) {
    fail(
      403,
      'FORBIDDEN',
      'this is a held gesture on the page; agents propose, a person accepts, signs or deletes',
    );
  }
}

export function requireBoundRule(lc: LetterContext): RuleCacheParsed {
  return requireRule(lc.letter, lc.rule);
}

/** Second pass over a body already parsed with the union key set: enforce one kind's set. */
export function onlyKeys(body: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) fail(400, 'UNKNOWN_FIELD', `${key} is not accepted`);
  }
}

export const CLAIM_KEYS = [
  'quote',
  'position',
  'assertion',
  'requested_change',
  'evidence',
] as const;

/** Validate the claim fields exactly as the propose_claim schema (section 3 tool 4). */
export function claimInput(body: Record<string, unknown>): ClaimInput {
  return {
    quote: stringField(body, 'quote', { min: 20, max: 600, required: true }),
    position: stringField(body, 'position', {
      max: 10,
      required: true,
      enum: POSITIONS,
    }) as ClaimInput['position'],
    assertion: stringField(body, 'assertion', { min: 20, max: 600, required: true }),
    requested_change: stringField(body, 'requested_change', { max: 400 }),
    evidence: stringField(body, 'evidence', { max: 400 }),
  };
}

/** Validate an edit's target field and text per field (section 3 tool 5; docs/API.md). */
export function editInput(body: Record<string, unknown>): { field: ClaimField; text: string } {
  const field = stringField(body, 'field', {
    max: 20,
    required: true,
    enum: CLAIM_FIELDS,
  }) as ClaimField;
  const raw = body.text;
  if (typeof raw !== 'string') fail(400, 'INVALID', 'text: must be a string');
  const text = raw.trim();
  if (text.length > 600) fail(400, 'INVALID', 'text: at most 600 chars');
  if (field === 'position') {
    if (!(POSITIONS as readonly string[]).includes(text)) {
      fail(400, 'INVALID', `text: position must be one of ${POSITIONS.join(', ')}`);
    }
  } else if (field === 'quote' || field === 'assertion') {
    if (text.length < 20) fail(400, 'INVALID', `text: ${field} needs at least 20 chars`);
  } else if (text.length > 400) {
    fail(400, 'INVALID', `text: ${field} is at most 400 chars`);
  }
  return { field, text };
}

export function holdField(body: Record<string, unknown>): number {
  return requireHold(body.hold_ms);
}

export { readBody, stringField };
