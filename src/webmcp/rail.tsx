'use client';

// The Tool Rail (PLAN.md 2.4): a 40 px monospace strip under the top bar, always visible.
// "Agent can call now: …" · "Not now: name (reason) · …" · mode badge · a dot that pulses while
// a tool executes · the last call line. Everything is rendered as text nodes; the only markup
// is ours. Tokens come from section 5 with fallbacks so the rail reads the same in every lane.

import type { ToolName } from '../../server/types';
import type { CallLogEntry } from './guard';
import { formatCall } from './guard';
import type { ToolMode } from './host';
import type { Range } from './readRanges';

export interface RailStatus {
  /** 'none' when no host was found; `detected` false until the first effect ran. */
  mode: ToolMode | 'none';
  detected: boolean;
  hostLabel: string;
  now: ToolName[];
  notNow: Array<{ name: ToolName; reason: string }>;
  /** What the host reports as registered (dynamic: the live list; static: the whole set). */
  registered: ToolName[];
  busy: boolean;
  last: CallLogEntry | null;
  log: readonly CallLogEntry[];
  hostError: string | null;
  /** Merged read_rule ranges this session, for the rule pane's shading (4.4). */
  readRanges: Range[];
}

export const EMPTY_RAIL_STATUS: RailStatus = {
  mode: 'none',
  detected: false,
  hostLabel: 'Detecting WebMCP host…',
  now: [],
  notNow: [],
  registered: [],
  busy: false,
  last: null,
  log: [],
  hostError: null,
  readRanges: [],
};

const RAIL_CSS = `
.pr-rail{height:40px;box-sizing:border-box;display:flex;align-items:center;gap:14px;padding:0 12px;
  overflow-x:auto;overflow-y:hidden;white-space:nowrap;font-family:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
  font-size:12px;line-height:1;color:var(--ink,#1b1a17);background:var(--paper,#f7f5f0);
  border-top:1px solid var(--muted,#6b675f);border-bottom:1px solid var(--muted,#6b675f);scrollbar-width:thin}
.pr-rail .pr-badge{display:inline-flex;align-items:center;gap:6px;padding:3px 7px;border:1px solid var(--muted,#6b675f);
  border-radius:3px;color:var(--muted,#6b675f);flex:none}
.pr-rail .pr-dot{width:8px;height:8px;border-radius:50%;background:var(--muted,#6b675f);flex:none}
.pr-rail .pr-dot[data-busy="true"]{background:var(--pending,#b7791f);animation:pr-pulse .9s ease-in-out infinite}
.pr-rail .pr-label{color:var(--muted,#6b675f)}
.pr-rail .pr-now{color:var(--anchored,#1f7a4d)}
.pr-rail .pr-not{color:var(--muted,#6b675f)}
.pr-rail .pr-last{color:var(--ink,#1b1a17)}
.pr-rail .pr-last[data-ok="false"]{color:var(--unverified,#a83232)}
.pr-rail .pr-sep{color:var(--muted,#6b675f)}
.pr-rail .pr-err{color:var(--unverified,#a83232)}
@keyframes pr-pulse{0%,100%{opacity:.35}50%{opacity:1}}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]) .pr-rail{color:var(--ink,#ecebe6);background:var(--paper,#141311)}
  :root:not([data-theme="light"]) .pr-rail .pr-now{color:var(--anchored,#6fcf97)}}
:root[data-theme="dark"] .pr-rail{color:var(--ink,#ecebe6);background:var(--paper,#141311)}
:root[data-theme="dark"] .pr-rail .pr-now{color:var(--anchored,#6fcf97)}
`;

export function modeBadge(status: Pick<RailStatus, 'mode' | 'detected'>): string {
  if (!status.detected) return 'detecting host';
  if (status.mode === 'dynamic') return 'dynamic';
  if (status.mode === 'static') return 'static';
  return 'no host';
}

function joinNow(now: readonly ToolName[]): string {
  return now.length ? now.join(' · ') : '—';
}

function joinNotNow(notNow: readonly { name: ToolName; reason: string }[]): string {
  return notNow.length ? notNow.map(t => `${t.name} (${t.reason})`).join(' · ') : '—';
}

export function ToolRail({ status }: { status: RailStatus }) {
  const badge = modeBadge(status);
  const last = status.last;
  return (
    <div className="pr-rail" role="status" aria-live="polite" aria-label="Tool rail">
      <style>{RAIL_CSS}</style>
      <span className="pr-badge" title={status.hostLabel}>
        <span className="pr-dot" data-busy={status.busy ? 'true' : 'false'} aria-hidden="true" />
        <span>{badge}</span>
      </span>
      <span title={status.hostLabel}>
        <span className="pr-label">Agent can call now: </span>
        <span className="pr-now">{joinNow(status.now)}</span>
      </span>
      <span className="pr-sep" aria-hidden="true">
        |
      </span>
      <span>
        <span className="pr-label">Not now: </span>
        <span className="pr-not">{joinNotNow(status.notNow)}</span>
      </span>
      {status.detected ? (
        <>
          <span className="pr-sep" aria-hidden="true">
            |
          </span>
          <span className="pr-label">{status.hostLabel}</span>
        </>
      ) : null}
      {last ? (
        <>
          <span className="pr-sep" aria-hidden="true">
            |
          </span>
          <span className="pr-last" data-ok={last.ok ? 'true' : 'false'} title={last.at}>
            {formatCall(last)}
          </span>
        </>
      ) : null}
      {status.hostError ? <span className="pr-err">host: {status.hostError}</span> : null}
    </div>
  );
}
