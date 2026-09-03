'use client';

// Polls GET /api/letters/{id}/state?rev= every 4 s (the first load always runs; later polls
// pause while the tab is hidden), toasting the newest activity line (PLAN.md 2.6 "Seeing each
// other"). Writes call `refresh()` right after they land so the page never waits for the next tick.

import { useCallback, useEffect, useRef, useState } from 'react';

import { getApi, type LettersApi } from './api';
import { actorLabel } from './format';
import { pushToast } from './toasts';
import type { LetterState } from '@/server/types';

export const POLL_MS = 4000;

export interface LetterStateHook {
  state: LetterState | null;
  error: unknown;
  /** Re-fetch now; `force` ignores the cached rev so a stale-marked proposal shows up too. */
  refresh: (force?: boolean) => Promise<LetterState | null>;
  api: LettersApi | null;
}

export function useLetterState(letterId: string | null): LetterStateHook {
  const [state, setState] = useState<LetterState | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [api, setApi] = useState<LettersApi | null>(null);
  const revRef = useRef<string | null>(null);
  const lastActivityRef = useRef<number | null>(null);
  const inflight = useRef<Promise<LetterState | null> | null>(null);

  useEffect(() => {
    let alive = true;
    getApi().then(a => {
      if (alive) setApi(a);
    });
    return () => {
      alive = false;
    };
  }, []);

  const refresh = useCallback(
    async (force = false): Promise<LetterState | null> => {
      if (!api || !letterId) return null;
      if (inflight.current) return inflight.current;
      const run = (async () => {
        try {
          const res = await api.state(letterId, force ? null : revRef.current);
          if ('unchanged' in res) return null;
          revRef.current = res.letter.rev;
          const newest = res.activity[0];
          if (newest) {
            if (lastActivityRef.current !== null && newest.id > lastActivityRef.current) {
              pushToast(newest.summary, { who: actorLabel(newest.actor) });
            }
            lastActivityRef.current = newest.id;
          } else if (lastActivityRef.current === null) {
            lastActivityRef.current = 0;
          }
          setState(res);
          setError(null);
          return res;
        } catch (err) {
          setError(err);
          return null;
        } finally {
          inflight.current = null;
        }
      })();
      inflight.current = run;
      return run;
    },
    [api, letterId],
  );

  useEffect(() => {
    if (!api || !letterId) return;
    let timer: number | undefined;
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      // The first load always runs (a hidden or background tab must still show the letter);
      // only the steady-state polling pauses while the tab is hidden.
      if (revRef.current === null || typeof document === 'undefined' || !document.hidden)
        await refresh();
      if (!stopped) timer = window.setTimeout(tick, POLL_MS);
    };
    void tick();
    const onVisible = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [api, letterId, refresh]);

  return { state, error, refresh, api };
}
