// Glue between the WebMCP layer's rail status and the page (PLAN.md 2.2 item 2, 2.6):
// the merged read_rule ranges become the rule pane's light-blue shading ("read by agent 14:03"),
// and every finished tool call becomes a toast that names the actor. The read ranges themselves
// live in src/webmcp/readRanges.ts (reset on reload by design, 4.4).

import type { AgentRead } from '@/app/components/RulePane';
import { actorLabel } from '@/lib/client/format';
import { pushToast } from '@/lib/client/toasts';
import type { CallLogEntry } from '@/src/webmcp/guard';
import { formatCall } from '@/src/webmcp/guard';
import type { RailStatus } from '@/src/webmcp/rail';

/** Shading layers for the rule pane from the rail's merged ranges; stamped with the last read. */
export function readsFromRail(rail: Pick<RailStatus, 'readRanges' | 'log'>): AgentRead[] {
  if (rail.readRanges.length === 0) return [];
  let at = '';
  for (let i = rail.log.length - 1; i >= 0; i--) {
    const e = rail.log[i];
    if (e.tool === 'read_rule' && e.ok) {
      at = e.at;
      break;
    }
  }
  if (!at) at = new Date().toISOString();
  return rail.readRanges.map(([start, end]) => ({ start, end, at }));
}

/** Toast one finished tool call as "<name>'s agent" / "an agent" (attribution per 2.6). */
export function toastToolCall(
  entry: CallLogEntry,
  viewer: { signed_in: boolean; display_name: string } | null,
): void {
  const who = actorLabel(`agent-of:${viewer?.signed_in ? viewer.display_name : 'anon'}`);
  pushToast(formatCall(entry), { who, tone: entry.ok ? 'info' : 'error' });
}
