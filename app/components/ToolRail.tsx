'use client';

// STUB — lane D replaces this with src/webmcp/rail.tsx (PLAN.md 2.4). It keeps the 40 px
// monospace strip in the layout so the page composition is final: "Agent can call now: …",
// "Not now: …", a host-mode badge, a pulsing dot while a tool executes, and the last call line.

export interface ToolRailProps {
  context: 'home' | 'workspace' | 'public';
}

export function ToolRail({ context }: ToolRailProps) {
  return (
    <div className="rail" role="status" aria-label="Agent tool rail">
      <span>
        <b>Agent can call now:</b> —
      </span>
      {context === 'public' ? <span>read-only public view: no writes at all</span> : null}
      <span className="rail-badge">No WebMCP host detected; the page works by hand.</span>
    </div>
  );
}
