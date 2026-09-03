// Page-session record of what the agent read through `read_rule`, for the light-blue shading in
// the rule pane ("read by agent 14:03", PLAN.md 2.2 item 2). The WebMCP layer (lane D,
// src/webmcp/readRanges.ts) calls `recordAgentRead` from its read_rule execute; the page only
// renders. Reset on reload by design (4.4 read-range allowlist lives there, not here).

export interface AgentRead {
  start: number;
  end: number;
  /** ISO timestamp of the read. */
  at: string;
}

type Listener = (reads: readonly AgentRead[]) => void;

const byDocument = new Map<string, AgentRead[]>();
const listeners = new Set<Listener>();

export function recordAgentRead(
  document_number: string,
  range: { start: number; end: number },
): void {
  const list = [
    ...(byDocument.get(document_number) ?? []),
    { start: range.start, end: range.end, at: new Date().toISOString() },
  ];
  byDocument.set(document_number, list);
  for (const l of listeners) l(list);
}

const EMPTY: readonly AgentRead[] = [];

export function getAgentReads(document_number: string | null): readonly AgentRead[] {
  return (document_number && byDocument.get(document_number)) || EMPTY;
}

export function subscribeAgentReads(listener: Listener | (() => void)): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
