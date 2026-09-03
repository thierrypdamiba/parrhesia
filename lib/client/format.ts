// Small presentation helpers shared by the pages: clocks in America/New_York, actor labels,
// deadline chips and the plain-language glossary (docs/PITCH.md: plain words first, term second).

import type { Actor, Position } from '@/server/types';

const NY = 'America/New_York';

/** 'HH:MM' in America/New_York for attribution footers and provenance lines. */
export function clock(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: NY,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

/** 'Nov 2' for deadline chips. */
export function shortDate(date: string | null | undefined): string {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return '';
  const [y, m, d] = date.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** 'YYYY-MM-DD' of an ISO timestamp, for provenance lines. */
export function isoDate(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : '';
}

/** 'Maya's agent' / 'Maya' / 'an agent' / 'someone' (mirrors server/letter.ts actorLabel). */
export function actorLabel(actor: Actor | null | undefined): string {
  if (!actor) return 'someone';
  const idx = actor.indexOf(':');
  const kind = idx < 0 ? actor : actor.slice(0, idx);
  const name = idx < 0 ? '' : actor.slice(idx + 1);
  const who = name && name !== 'anon' ? name : null;
  if (kind === 'agent-of') return who ? `${who}'s agent` : 'an agent';
  return who ?? 'someone';
}

export function isAgentActor(actor: Actor | null | undefined): boolean {
  return !!actor && actor.startsWith('agent-of:');
}

export type DeadlineTone = 'plain' | 'amber' | 'red' | 'closed';

/** Deadline chip text and tone (PLAN.md 2.2 item 1: amber ≤14 days, red ≤3). */
export function deadline(
  comments_close_on: string | null | undefined,
  days_left: number | null | undefined,
): { text: string; tone: DeadlineTone } {
  const when = shortDate(comments_close_on);
  if (days_left === null || days_left === undefined)
    return { text: when ? `closes ${when}` : '', tone: 'plain' };
  if (days_left < 0) return { text: `closed ${when}`, tone: 'closed' };
  const left =
    days_left === 0 ? 'closes today' : `${days_left} day${days_left === 1 ? '' : 's'} left`;
  const tone: DeadlineTone = days_left <= 3 ? 'red' : days_left <= 14 ? 'amber' : 'plain';
  return { text: `closes ${when} · ${left}`, tone };
}

export const POSITION_LABEL: Record<Position, string> = {
  support: 'Support',
  oppose: 'Oppose',
  modify: 'Modify',
};

export const FIELD_LABEL = {
  quote: 'quote',
  assertion: 'assertion',
  requested_change: 'requested change',
  evidence: 'evidence',
  position: 'position',
} as const;

/** Join class names, skipping falsy parts (keeps the tailwind prettier plugin away from template literals). */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/** Thousands separator for character counts ("44,458 chars"). */
export function num(n: number | null | undefined): string {
  return typeof n === 'number' ? n.toLocaleString('en-US') : '';
}

/** Plain-language glossary from docs/PITCH.md, plain words first and the term of art second. */
export const WORDS = {
  proposedRule: 'a rule the government wants to change',
  proposedRuleTerm: 'proposed rule',
  federalRegister: "the government's daily journal",
  federalRegisterTerm: 'Federal Register',
  commentPeriod: 'the window when anyone can respond',
  commentPeriodTerm: 'comment period',
  publicComment: 'your response',
  publicCommentTerm: 'public comment',
  regulationsGov: 'the site where you file it',
  regulationsGovTerm: 'regulations.gov',
} as const;

/** The grey label under free-text fields (PLAN.md 2.2 item 3; PITCH wording). */
export const YOUR_WORDS_LABEL = 'your words · not verified against the rule';
