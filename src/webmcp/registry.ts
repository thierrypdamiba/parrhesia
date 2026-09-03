// Tool registry (PLAN.md P5): keeps the host's registered set equal to the desired set.
//
// dynamic mode — Map<name,{controller,spec}>; missing/changed tools are registered with
//   `{signal}`, removed ones aborted; the rail re-renders from getTools() on `toolchange` and
//   after every local change (a host may not fire the event).
// static mode — the whole set for the route is registered ONCE at load; the rail is computed
//   from page state, and every execute enforces its gate (tools.ts) so an out-of-order call
//   returns NOT_AVAILABLE instead of doing anything.
//
// Every call into the host is guarded: a host that throws is reported on the rail, never to
// the console as an uncaught error, and never breaks the page.

import type { ToolName } from '../../server/types';
import type { HostToolDescriptor, ModelContextHost, ToolMode } from './host';
import type { ToolAnnotations, ToolInputSchema } from './schema';

/** A fully rendered tool ready for registerTool (tools.ts builds these). */
export interface ToolSpec {
  name: ToolName;
  title: string;
  description: string;
  inputSchema: ToolInputSchema;
  annotations: ToolAnnotations;
  execute: (input: unknown) => Promise<Record<string, unknown>>;
}

export interface RegistrySnapshot {
  mode: ToolMode;
  /** Names the host reports (getTools) or, without getTools, the names we registered. */
  registered: ToolName[];
  /** Last host error, e.g. 'registerTool threw: …' (rail shows it once). */
  host_error: string | null;
}

type Listener = (snapshot: RegistrySnapshot) => void;

interface Entry {
  controller: AbortController;
  signature: string;
}

function signatureOf(spec: ToolSpec): string {
  return [
    spec.title,
    spec.description,
    JSON.stringify(spec.inputSchema),
    JSON.stringify(spec.annotations),
  ].join('\n');
}

function isThenable(v: unknown): v is PromiseLike<unknown> {
  return !!v && typeof (v as { then?: unknown }).then === 'function';
}

export class ToolRegistry {
  private readonly entries = new Map<ToolName, Entry>();
  private readonly listeners = new Set<Listener>();
  private hostNames: ToolName[] | null = null;
  private hostError: string | null = null;
  private staticDone = false;
  private disposed = false;
  private readonly onToolChange = () => this.refreshFromHost();

  constructor(
    private readonly host: ModelContextHost | null,
    readonly mode: ToolMode,
  ) {
    if (host) {
      try {
        host.addEventListener?.('toolchange', this.onToolChange);
      } catch (err) {
        this.hostError = `addEventListener threw: ${message(err)}`;
      }
    }
  }

  get hasHost(): boolean {
    return this.host !== null;
  }

  /**
   * Make the host's set equal to `desired`. In static mode only the first call registers
   * (the union for the route); later calls only re-render.
   */
  sync(desired: readonly ToolSpec[]): void {
    if (this.disposed || !this.host) return;
    if (this.mode === 'static') {
      if (!this.staticDone) {
        this.staticDone = true;
        for (const spec of desired) this.register(spec);
      }
    } else {
      const wanted = new Map(desired.map(s => [s.name, s] as const));
      for (const [name, entry] of this.entries) {
        const spec = wanted.get(name);
        if (!spec || signatureOf(spec) !== entry.signature) this.unregister(name);
      }
      for (const spec of desired) {
        if (!this.entries.has(spec.name)) this.register(spec);
      }
    }
    this.refreshFromHost();
  }

  /** Names currently registered (host view when available). */
  registered(): ToolName[] {
    return this.hostNames ?? [...this.entries.keys()];
  }

  snapshot(): RegistrySnapshot {
    return { mode: this.mode, registered: this.registered(), host_error: this.hostError };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Abort every registration and stop listening (component unmount). */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const name of [...this.entries.keys()]) this.unregister(name);
    try {
      this.host?.removeEventListener?.('toolchange', this.onToolChange);
    } catch {
      // nothing to do
    }
    this.listeners.clear();
  }

  // -------------------------------------------------------------------------

  private register(spec: ToolSpec): void {
    if (!this.host) return;
    const controller = new AbortController();
    const descriptor: HostToolDescriptor = {
      name: spec.name,
      title: spec.title,
      description: spec.description,
      inputSchema: spec.inputSchema,
      annotations: spec.annotations,
      execute: (input: unknown) => spec.execute(input),
    };
    try {
      if (typeof this.host.registerTool !== 'function') {
        this.hostError = 'host has no registerTool';
        return;
      }
      this.host.registerTool(descriptor, { signal: controller.signal });
      this.entries.set(spec.name, { controller, signature: signatureOf(spec) });
    } catch (err) {
      this.hostError = `registerTool(${spec.name}) threw: ${message(err)}`;
    }
  }

  private unregister(name: ToolName): void {
    const entry = this.entries.get(name);
    if (!entry) return;
    this.entries.delete(name);
    try {
      entry.controller.abort();
    } catch (err) {
      this.hostError = `abort(${name}) threw: ${message(err)}`;
    }
    // Hosts that ignore the signal but expose unregisterTool: call it too (guarded).
    try {
      this.host?.unregisterTool?.(name);
    } catch {
      // already removed by the signal
    }
  }

  /** Re-read getTools() (sync or async) and notify listeners. */
  private refreshFromHost(): void {
    if (this.disposed) return;
    const host = this.host;
    if (host && typeof host.getTools === 'function') {
      try {
        const result = host.getTools();
        if (isThenable(result)) {
          Promise.resolve(result).then(
            tools => {
              this.hostNames = namesOf(tools);
              this.emit();
            },
            err => {
              this.hostError = `getTools rejected: ${message(err)}`;
              this.emit();
            },
          );
          return;
        }
        this.hostNames = namesOf(result);
      } catch (err) {
        this.hostError = `getTools threw: ${message(err)}`;
      }
    }
    this.emit();
  }

  private emit(): void {
    const snap = this.snapshot();
    for (const l of this.listeners) {
      try {
        l(snap);
      } catch {
        // a listener must never break the registry
      }
    }
  }
}

function namesOf(tools: unknown): ToolName[] | null {
  if (!Array.isArray(tools)) return null;
  const names: ToolName[] = [];
  for (const t of tools) {
    const name = t && typeof t === 'object' ? (t as { name?: unknown }).name : t;
    if (typeof name === 'string') names.push(name as ToolName);
  }
  return names;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
