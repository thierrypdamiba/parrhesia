'use client';

// React binding (PLAN.md P5): `useWebmcp(state)` registers the tools for the page's state and
// returns the rail status; `<ToolRail status={…} />` prints it. The host is an external system,
// so it lives in a small controller read through useSyncExternalStore: nothing touches
// document/navigator during render, and the server render says "detecting host".

import { useEffect, useMemo, useSyncExternalStore } from 'react';

import { CallLog, type CallLogEntry } from './guard';
import {
  detectMode,
  getModelContext,
  hostLabel,
  isTopLevelPage,
  readConfiguredMode,
  readNavigatorFacts,
  type ToolMode,
} from './host';
import { EMPTY_RAIL_STATUS, type RailStatus } from './rail';
import { ReadRanges } from './readRanges';
import { ToolRegistry, type RegistrySnapshot } from './registry';
import {
  buildExecutes,
  desiredTools,
  type PageState,
  pushStateNavigate,
  staticTools,
  type ToolExecutes,
  toolsNotNow,
  toolsNow,
} from './tools';

export interface UseWebmcpOptions {
  /** SPA navigation for open_rule; defaults to history.pushState + popstate. */
  navigate?: (path: string) => void;
  /** Called after any call that changed or read the letter, so the page re-fetches state now. */
  onLetterChanged?: () => void;
  /** Every finished tool call (toasts, activity). */
  onCall?: (entry: CallLogEntry) => void;
}

function gateKey(state: PageState): string {
  return JSON.stringify([
    state.letter?.letter_id ?? null,
    state.letter?.rev ?? null,
    state.rule?.document_number ?? null,
    state.rule?.total_chars ?? null,
    state.rule?.pages ?? null,
    state.rule?.comments_close_on ?? null,
    state.bound ?? !!state.rule,
    !!state.closed,
    state.claimsAccepted,
    state.signedIn,
    state.viewerName,
    state.canEdit,
    state.isPublicView,
  ]);
}

const INITIAL_STATE: PageState = {
  letter: null,
  rule: null,
  claimsAccepted: 0,
  signedIn: false,
  viewerName: 'Signer',
  canEdit: false,
  isPublicView: false,
};

/** Owns the registry, read ranges and call log for one mounted page. */
export class WebmcpController {
  private options: UseWebmcpOptions = {};
  private state: PageState = INITIAL_STATE;
  private key = '';
  private mode: ToolMode | 'none' = 'none';
  private label = EMPTY_RAIL_STATUS.hostLabel;
  private detected = false;
  private registry: ToolRegistry | null = null;
  private executes: ToolExecutes | null = null;
  private readonly readRanges = new ReadRanges();
  private readonly log = new CallLog();
  private registrySnapshot: RegistrySnapshot | null = null;
  /** Static hosts register once, so the first registration waits for the page's real state. */
  private stateReceived = false;
  private busy = false;
  private status: RailStatus = EMPTY_RAIL_STATUS;
  private readonly listeners = new Set<() => void>();
  private unsubscribeLog: (() => void) | null = null;
  private stopped = false;

  setOptions(options: UseWebmcpOptions): void {
    this.options = options;
  }

  /** Find the host, pick the mode, build executes and the registry (client only). */
  start(): void {
    if (this.registry) return;
    this.stopped = false;
    const facts = readNavigatorFacts();
    const host = isTopLevelPage() ? getModelContext() : null;
    this.mode = host ? detectMode(readConfiguredMode(), facts) : 'none';
    this.label = hostLabel(this.mode, facts);
    const mode: ToolMode = this.mode === 'none' ? 'static' : this.mode;
    this.registry = new ToolRegistry(host, mode);
    this.executes = buildExecutes({
      getState: () => this.state,
      mode,
      readRanges: this.readRanges,
      log: this.log,
      navigate: path => {
        const custom = this.options.navigate;
        if (custom) custom(path);
        else pushStateNavigate(path);
      },
      onLetterChanged: () => {
        this.publish();
        this.options.onLetterChanged?.();
      },
      onCall: entry => this.options.onCall?.(entry),
      onBusy: busy => {
        this.busy = busy;
        this.publish();
      },
    });
    this.registry.subscribe(snapshot => {
      this.registrySnapshot = snapshot;
      this.publish();
    });
    this.unsubscribeLog?.();
    this.unsubscribeLog = this.log.subscribe(() => this.publish());
    this.registrySnapshot = this.registry.snapshot();
    this.detected = true;
    // Nothing is registered against INITIAL_STATE: a static host takes the whole set for the
    // route at once, and INITIAL_STATE has no rule and no viewer, so it would hand ChatGPT all
    // eight tools on /r/ with titles that never name the document or the signer. The first sync
    // waits for setState (which the mounting page always calls) unless state arrived already.
    if (this.stateReceived) this.sync();
    this.publish();
  }

  stop(): void {
    this.stopped = true;
    this.unsubscribeLog?.();
    this.unsubscribeLog = null;
    this.registry?.dispose();
    this.registry = null;
    this.executes = null;
  }

  /** New page state: re-sync the host set when a gate-relevant field changed. */
  setState(state: PageState): void {
    const first = !this.stateReceived;
    this.stateReceived = true;
    this.state = state;
    const key = gateKey(state);
    if (key === this.key && !first) return;
    this.key = key;
    this.sync();
    this.publish();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): RailStatus => this.status;

  getServerSnapshot = (): RailStatus => EMPTY_RAIL_STATUS;

  private sync(): void {
    if (!this.registry || !this.executes || this.mode === 'none' || this.stopped) return;
    this.registry.sync(
      this.mode === 'dynamic'
        ? desiredTools(this.state, this.executes)
        : staticTools(this.state, this.executes),
    );
  }

  private publish(): void {
    const log = this.log.list();
    this.status = {
      mode: this.mode,
      detected: this.detected,
      hostLabel: this.label,
      now: toolsNow(this.state),
      notNow: toolsNotNow(this.state),
      registered: this.registrySnapshot?.registered ?? [],
      busy: this.busy,
      last: log[log.length - 1] ?? null,
      log,
      hostError: this.registrySnapshot?.host_error ?? null,
      readRanges: this.readRanges.merged(),
    };
    for (const l of this.listeners) l();
  }
}

export function useWebmcp(state: PageState, options: UseWebmcpOptions = {}): RailStatus {
  const controller = useMemo(() => new WebmcpController(), []);
  useEffect(() => {
    controller.setOptions(options);
  });
  useEffect(() => {
    controller.start();
    return () => controller.stop();
  }, [controller]);
  useEffect(() => {
    controller.setState(state);
  }, [controller, state]);
  return useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getServerSnapshot,
  );
}
