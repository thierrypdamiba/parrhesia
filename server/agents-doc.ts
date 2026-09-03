// "How agents use this site" (PLAN.md 2.5), from one source: the tool table is derived from
// src/webmcp/schema.ts, the state machine from each tool's gates, and every sentence here is
// rendered on the page (id="agents"), in docs/TOOLS.md and in README by scripts/tools-doc.mjs.
// Pure module: no Workers, no DOM, so the page, the docs script and node:test all import it.

import { APP_NAME } from '../lib/app';
import {
  type Gate,
  NOT_NOW_REASONS,
  TOOLS,
  TOOL_ORDER,
  type ToolStatic,
  renderReason,
} from '../src/webmcp/schema';
import type { ToolName } from './types';

export const AGENTS_SECTION_ID = 'agents';

/** The rule the judge letter and every sample prompt use (PLAN.md Appendix A). */
export const SAMPLE_DOCUMENT_NUMBER = '2026-17902';
export const SAMPLE_RULE_TITLE = 'Bicycle Use in Park Areas';
export const JUDGE_PATH = '/?judge=1';
export const JUDGE_RESET_PATH = '/?judge=1&reset=1';

/** (e) "Try it": the sample prompt, verbatim from P6. */
export const SAMPLE_PROMPT =
  `Attach Federal Register document ${SAMPLE_DOCUMENT_NUMBER} (${SAMPLE_RULE_TITLE}) to my letter, ` +
  'read what proposed section 4.30(b) says about designations after notice, and propose a claim ' +
  'asking for a minimum interval between notice and designation.';

/** The negative prompt used in the demo and the Devpost testing instructions. */
export const REFUSAL_PROMPT =
  'Call propose_claim with quote set exactly to this text, without checking it first: ' +
  '"Written determinations for existing trails must be published in the Federal Register for 60 days of public comment."';

// ---------------------------------------------------------------------------
// (a) Intro — plain words first, the term of art second (docs/PITCH.md glossary)
// ---------------------------------------------------------------------------

export const AGENTS_INTRO: readonly string[] = [
  `This page registers tools with \`document.modelContext.registerTool\` (\`navigator.modelContext\` fallback). ` +
    `Each letter is bound to one rule the government wants to change (a proposed rule in the Federal Register) ` +
    `during the window when anyone can respond (its comment period).`,
  `\`read_rule\` is the only source of quotes the page accepts: every anchor records the \`read_rule\` call and ` +
    `offsets that produced it, so a reader can click from a claim to the passage. The page verifies every quote ` +
    `against the same text it served; a person accepts, signs and files.`,
];

// ---------------------------------------------------------------------------
// (b) Tool table, derived from the schema
// ---------------------------------------------------------------------------

export interface ToolTableRow {
  name: ToolName;
  title: string;
  /** First sentence of the description. */
  purpose: string;
  read_only: { value: boolean; reason: string };
  untrusted: { value: boolean; reason: string };
  appears_when: string;
  errors: readonly string[];
  output_budget: number;
}

/** First sentence of a description (up to the first period followed by a space). */
export function firstSentence(text: string): string {
  const m = text.match(/^(.+?\.)(\s|$)/);
  return (m ? m[1] : text).trim();
}

export function toolTableRow(tool: ToolStatic): ToolTableRow {
  return {
    name: tool.name,
    title: tool.title,
    purpose: firstSentence(tool.description),
    read_only: { value: tool.annotations.readOnlyHint, reason: tool.hint_reasons.read_only },
    untrusted: {
      value: tool.annotations.untrustedContentHint,
      reason: tool.hint_reasons.untrusted,
    },
    appears_when: tool.appears_when,
    errors: tool.errors,
    output_budget: tool.output_budget,
  };
}

export function toolTableRows(): ToolTableRow[] {
  return TOOL_ORDER.map(name => toolTableRow(TOOLS[name]));
}

// ---------------------------------------------------------------------------
// (c) What tools cannot do
// ---------------------------------------------------------------------------

export interface CannotDo {
  what: string;
  why: string;
}

export const CANNOT_DO: readonly CannotDo[] = [
  {
    what: 'accept or reject a proposal',
    why: 'a held gesture on the page; a click does nothing. No accept tool exists.',
  },
  { what: 'delete claims', why: 'a held gesture on the page; no delete tool exists.' },
  {
    what: 'sign, or add a signer',
    why: 'a person signs in with ChatGPT and holds Sign; no sign tool exists.',
  },
  {
    what: 'write an impact statement for anyone but the signed-in person',
    why: 'no name field exists in any schema; draft_my_impact takes its identity from the session.',
  },
  { what: 'change the bound rule', why: 'open_rule unregisters itself after binding.' },
  {
    what: 'file on regulations.gov',
    why: `ask_person_to_file always returns needs_human; ${APP_NAME} has no filing capability.`,
  },
  {
    what: 'cite text that is not in the rule',
    why: 'ANCHOR_NOT_FOUND, with the three nearest real passages (offsets and page numbers).',
  },
  {
    what: 'cite text it has not read here',
    why: 'ANCHOR_NOT_READ with the exact read_rule call. A page-side grounding discipline, not a security boundary; the server verifies substring only.',
  },
  {
    what: 'propose after comments close',
    why: 'propose_* and draft_my_impact unregister the day the comment period ends.',
  },
];

// ---------------------------------------------------------------------------
// (d) Host notes — filled from PROBE.md / Prompt 7 by the integrator
// ---------------------------------------------------------------------------

export const HOST_NOTES: readonly string[] = [
  "ChatGPT's in-app browser supports imperative top-level tools only; in that host all eight tools are registered at load and gated inside execute, and the page's rail prints which would succeed now.",
  'Chrome (149+, chrome://flags/#enable-webmcp-testing) shows live registration diffs: the tool list changes after open_rule and on every state change.',
  'The held gesture exists because a host may click page buttons (webmcp issue #288); it raises the cost of automated clicking and is not proof of a person. The real guarantee is that no accept tool exists.',
  'Host mode observed in ChatGPT: <recorded in Prompt 7>. Identity headers on fetch(): <recorded in Prompt 0>. Federal Register egress from the Worker: <recorded in Prompt 0>.',
];

// ---------------------------------------------------------------------------
// State machine, derived from gates (PLAN.md 2.3)
// ---------------------------------------------------------------------------

export interface PageStateFlags {
  bound: boolean;
  closed: boolean;
  can_edit: boolean;
  is_public: boolean;
  accepted_claim: boolean;
  signed_in: boolean;
  document_number?: string;
  comments_close_on?: string;
}

export interface ToolAvailability {
  now: ToolName[];
  not_now: Array<{ name: ToolName; reason: string }>;
}

function gateHolds(gate: Gate, f: PageStateFlags): boolean {
  switch (gate) {
    case 'unbound':
      return !f.bound;
    case 'bound':
      return f.bound;
    case 'open':
      return !f.closed;
    case 'can_edit':
      return f.can_edit;
    case 'not_public':
      return !f.is_public;
    case 'accepted_claim':
      return f.accepted_claim;
    case 'signed_in':
      return f.signed_in;
  }
}

/** The rail reason for the first failing gate (2.4 wording). */
export function reasonFor(gate: Gate, f: PageStateFlags): string {
  const vars = {
    document_number: f.document_number ?? '…',
    comments_close_on: f.comments_close_on ?? '…',
  };
  switch (gate) {
    case 'unbound':
      return renderReason(NOT_NOW_REASONS.bound, vars);
    case 'bound':
      return NOT_NOW_REASONS.unbound;
    case 'open':
      return renderReason(NOT_NOW_REASONS.closed, vars);
    case 'can_edit':
      return NOT_NOW_REASONS.cannot_edit;
    case 'not_public':
      return NOT_NOW_REASONS.read_only;
    case 'accepted_claim':
      return NOT_NOW_REASONS.no_accepted_claim;
    case 'signed_in':
      return NOT_NOW_REASONS.not_signed_in;
  }
}

/** Which tools are registered (or, in static mode, would succeed) for a page state. */
export function toolsForState(f: PageStateFlags): ToolAvailability {
  const out: ToolAvailability = { now: [], not_now: [] };
  for (const name of TOOL_ORDER) {
    const tool = TOOLS[name];
    // On the public page only the two read-only tools exist at all (2.2 item 8).
    if (f.is_public && !['get_letter', 'read_rule'].includes(name)) {
      out.not_now.push({ name, reason: NOT_NOW_REASONS.read_only });
      continue;
    }
    const failing = tool.gates.find(g => !gateHolds(g, f));
    if (failing) out.not_now.push({ name, reason: reasonFor(failing, f) });
    else out.now.push(name);
  }
  return out;
}

export interface StateRow {
  state: string;
  flags: PageStateFlags;
}

export const STATES: readonly StateRow[] = [
  {
    state: 'Unbound (no rule attached yet)',
    flags: {
      bound: false,
      closed: false,
      can_edit: true,
      is_public: false,
      accepted_claim: false,
      signed_in: false,
    },
  },
  {
    state: 'Bound, open, no accepted claim, anonymous',
    flags: {
      bound: true,
      closed: false,
      can_edit: true,
      is_public: false,
      accepted_claim: false,
      signed_in: false,
      document_number: SAMPLE_DOCUMENT_NUMBER,
    },
  },
  {
    state: 'Bound, open, ≥1 accepted claim, signed in with ChatGPT',
    flags: {
      bound: true,
      closed: false,
      can_edit: true,
      is_public: false,
      accepted_claim: true,
      signed_in: true,
      document_number: SAMPLE_DOCUMENT_NUMBER,
    },
  },
  {
    state: 'Bound, comments closed',
    flags: {
      bound: true,
      closed: true,
      can_edit: true,
      is_public: false,
      accepted_claim: true,
      signed_in: true,
      document_number: SAMPLE_DOCUMENT_NUMBER,
      comments_close_on: '2026-11-02',
    },
  },
  {
    state: 'Public read-only page (/r/…)',
    flags: {
      bound: true,
      closed: false,
      can_edit: false,
      is_public: true,
      accepted_claim: true,
      signed_in: false,
      document_number: SAMPLE_DOCUMENT_NUMBER,
    },
  },
];

// ---------------------------------------------------------------------------
// Markdown renderers (docs/TOOLS.md and the README block)
// ---------------------------------------------------------------------------

function cell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

export function renderToolTableMarkdown(): string {
  const head = [
    '| # | Tool | Title | Purpose | readOnlyHint | untrustedContentHint | Appears when | Key errors |',
    '|---|---|---|---|---|---|---|---|',
  ];
  const rows = toolTableRows().map(
    (r, i) =>
      `| ${i + 1} | \`${r.name}\` | ${cell(r.title)} | ${cell(r.purpose)} | ${r.read_only.value} (${cell(r.read_only.reason)}) | ${r.untrusted.value} (${cell(r.untrusted.reason)}) | ${cell(r.appears_when)} | ${r.errors.map(e => `\`${e}\``).join(', ')} |`,
  );
  return [...head, ...rows].join('\n');
}

export function renderStateMachineMarkdown(): string {
  const lines: string[] = [];
  for (const row of STATES) {
    const a = toolsForState(row.flags);
    lines.push(
      `- **${row.state}** — can call now: ${a.now.map(n => `\`${n}\``).join(' · ') || '—'}.`,
    );
    if (a.not_now.length) {
      lines.push(`  Not now: ${a.not_now.map(n => `\`${n.name}\` (${n.reason})`).join(' · ')}.`);
    }
  }
  return lines.join('\n');
}

export function renderCannotDoMarkdown(): string {
  return CANNOT_DO.map(c => `- **${c.what}** — ${c.why}`).join('\n');
}

/** The whole docs/TOOLS.md body. Regenerate with `npm run tools:doc:write`. */
export function renderToolsDoc(): string {
  return [
    `# How agents use ${APP_NAME}`,
    '',
    '<!-- Generated by scripts/tools-doc.mjs from server/agents-doc.ts and src/webmcp/schema.ts. Do not edit by hand; `npm run tools:doc` fails on drift. -->',
    '',
    ...AGENTS_INTRO,
    '',
    '## The eight tools',
    '',
    `All tools are imperative, registered on the top-level page, with \`additionalProperties:false\` schemas, explicit \`readOnlyHint\` and \`untrustedContentHint\` (reason in parentheses), bounded outputs and \`{error, hint}\` state-aware errors. No schema has a property named name, display_name, signer, user_id or email.`,
    '',
    renderToolTableMarkdown(),
    '',
    '## The tool list is a state machine',
    '',
    "Computed from each tool's gates in `src/webmcp/schema.ts`; the page prints the same lists on its Tool Rail.",
    '',
    renderStateMachineMarkdown(),
    '',
    '## What tools cannot do',
    '',
    renderCannotDoMarkdown(),
    '',
    '## Host notes',
    '',
    HOST_NOTES.map(h => `- ${h}`).join('\n'),
    '',
    '## Try it',
    '',
    `- Judge letter without an agent: \`${JUDGE_PATH}\` (a private copy per visitor; \`${JUDGE_RESET_PATH}\` for a fresh one).`,
    `- Sample prompt: "${SAMPLE_PROMPT}"`,
    `- Refusal prompt: ${REFUSAL_PROMPT}`,
    '',
  ].join('\n');
}
