// WebMCP host access and mode detection (PLAN.md P5, 2.3 "Host mode", risk 1).
//
// The context is `document.modelContext ?? navigator.modelContext`; every call into it is
// guarded because hosts differ in which members exist. Only imperative tools are used, only on
// the top-level page.
//
// Modes: 'dynamic' diffs the registered set on every state change (Chrome: live toolchange);
// 'static' registers the whole set once at load and enforces every gate inside execute (a host
// that snapshots the tool list, such as ChatGPT's in-app browser). 'auto' picks dynamic on
// Google Chrome brands unless the UA carries the ChatGPT marker recorded by the Prompt 0 probe.

export type ToolMode = 'dynamic' | 'static';
export type ToolModeConfig = ToolMode | 'auto';

/**
 * Findings from the hosted-runtime probe (PLAN.md P0; PROBE.md). Until PROBE.md records the
 * real values these are the plan's defaults: ChatGPT's browser is assumed to snapshot the tool
 * list, so it gets 'static'. Integration edits this constant from PROBE.md.
 */
export const PROBE = {
  /** Substring of navigator.userAgent that identifies ChatGPT's in-app browser. */
  CHATGPT_UA_MARKER: 'ChatGPT',
  /** HOST_MODE for ChatGPT: 'dynamic' if the probe showed mid-conversation refresh, else 'static'. */
  CHATGPT_HOST_MODE: 'static' as ToolMode,
} as const;

// ---------------------------------------------------------------------------
// Minimal typing of the host API we rely on (no ambient globals, so no clash with other lanes)
// ---------------------------------------------------------------------------

export interface HostToolDescriptor {
  name: string;
  title?: string;
  description: string;
  inputSchema: unknown;
  annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
  execute: (input: unknown) => unknown | Promise<unknown>;
}

export interface ModelContextHost {
  registerTool?: (tool: HostToolDescriptor, options?: { signal?: AbortSignal }) => unknown;
  unregisterTool?: (name: string) => unknown;
  getTools?: () => unknown;
  addEventListener?: (type: string, listener: (event: unknown) => void) => void;
  removeEventListener?: (type: string, listener: (event: unknown) => void) => void;
}

type MaybeHosted = { modelContext?: ModelContextHost | null };

/** `document.modelContext ?? navigator.modelContext`, or null when no host is present. */
export function getModelContext(): ModelContextHost | null {
  try {
    if (typeof document !== 'undefined') {
      const fromDocument = (document as unknown as MaybeHosted).modelContext;
      if (fromDocument && typeof fromDocument === 'object') return fromDocument;
    }
    if (typeof navigator !== 'undefined') {
      const fromNavigator = (navigator as unknown as MaybeHosted).modelContext;
      if (fromNavigator && typeof fromNavigator === 'object') return fromNavigator;
    }
  } catch {
    // A host that throws on property access counts as absent.
  }
  return null;
}

/** True only on the top-level page (never register tools inside an iframe). */
export function isTopLevelPage(): boolean {
  try {
    return typeof window !== 'undefined' && window.top === window.self;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Mode selection
// ---------------------------------------------------------------------------

export interface NavigatorFacts {
  userAgent: string;
  brands: readonly string[];
}

/** navigator.userAgent and navigator.userAgentData.brands, guarded. */
export function readNavigatorFacts(): NavigatorFacts {
  let userAgent = '';
  let brands: string[] = [];
  try {
    if (typeof navigator !== 'undefined') {
      userAgent = String(navigator.userAgent ?? '');
      const data = (navigator as unknown as { userAgentData?: { brands?: unknown } }).userAgentData;
      if (data && Array.isArray(data.brands)) {
        brands = (data.brands as Array<{ brand?: unknown }>)
          .map(b => (b && typeof b.brand === 'string' ? b.brand : ''))
          .filter(b => b.length > 0);
      }
    }
  } catch {
    // Treated as an unknown host below.
  }
  return { userAgent, brands };
}

export function isChatGptHost(facts: NavigatorFacts): boolean {
  return PROBE.CHATGPT_UA_MARKER.length > 0 && facts.userAgent.includes(PROBE.CHATGPT_UA_MARKER);
}

/** Resolve the configured mode against the navigator facts (P5 "Modes"). Pure. */
export function detectMode(config: ToolModeConfig, facts: NavigatorFacts): ToolMode {
  if (config === 'dynamic' || config === 'static') return config;
  if (isChatGptHost(facts)) return PROBE.CHATGPT_HOST_MODE;
  const chrome = facts.brands.some(b => b === 'Google Chrome');
  return chrome ? 'dynamic' : 'static';
}

function normalizeConfig(raw: unknown): ToolModeConfig | undefined {
  if (raw === 'dynamic' || raw === 'static' || raw === 'auto') return raw;
  return undefined;
}

/**
 * DOCKET_TOOL_MODE from the build environment. vinext inlines `process.env.NEXT_PUBLIC_*` for
 * the browser and Vite exposes `import.meta.env.VITE_*`; both spellings are accepted, plus a
 * `?tool_mode=` query override for host tests (P5 acceptance runs the static sequence by hand).
 * Default 'auto'.
 */
export function readConfiguredMode(search?: string): ToolModeConfig {
  try {
    const params = new URLSearchParams(
      search ?? (typeof location !== 'undefined' ? location.search : ''),
    );
    const fromQuery = normalizeConfig(params.get('tool_mode'));
    if (fromQuery) return fromQuery;
  } catch {
    // no location (tests)
  }
  const fromProcess = normalizeConfig(
    typeof process !== 'undefined' && process.env
      ? (process.env.NEXT_PUBLIC_DOCKET_TOOL_MODE ?? process.env.DOCKET_TOOL_MODE)
      : undefined,
  );
  if (fromProcess) return fromProcess;
  const viteEnv = readViteEnv();
  const fromVite = normalizeConfig(viteEnv?.VITE_DOCKET_TOOL_MODE ?? viteEnv?.DOCKET_TOOL_MODE);
  if (fromVite) return fromVite;
  return 'auto';
}

function readViteEnv(): Record<string, string | undefined> | undefined {
  try {
    const meta = import.meta as unknown as { env?: Record<string, string | undefined> };
    return meta.env;
  } catch {
    return undefined;
  }
}

/** Rail badge text per 2.3 "Host mode". */
export function hostLabel(mode: ToolMode | 'none', facts: NavigatorFacts): string {
  if (mode === 'none') return 'No WebMCP host detected; the page works by hand.';
  if (mode === 'dynamic') return 'Chrome: live toolchange';
  return isChatGptHost(facts)
    ? 'ChatGPT browser: all tools registered; gates enforced in execute (rail shows what would succeed now)'
    : 'Static host: all tools registered; gates enforced in execute (rail shows what would succeed now)';
}
