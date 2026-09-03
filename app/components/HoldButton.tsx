'use client';

// Press-and-hold control (PLAN.md 2.2 item 4, P4). Starts on pointerdown or Space/Enter keydown,
// cancels on pointerup / pointerleave / pointercancel / keyup before `holdMs`, fills a ring,
// fires `onHold(elapsedMs)` at >= holdMs, ignores `click`, and requires `event.isTrusted`.
// The hold raises the cost of automated clicking; it is not a proof of a human (2.1). The real
// guarantee is that no accept tool exists.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';

import { cx } from '@/lib/client/format';
import { LIMITS } from '@/server/types';

export interface HoldButtonProps {
  label: string;
  onHold: (elapsedMs: number) => void | Promise<void>;
  holdMs?: number;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
  tone?: 'default' | 'danger' | 'primary';
}

const RADIUS = 7;
const CIRC = 2 * Math.PI * RADIUS;

export function HoldButton({
  label,
  onHold,
  holdMs = LIMITS.hold_ms,
  disabled,
  className,
  ariaLabel,
  tone = 'default',
}: HoldButtonProps) {
  const [progress, setProgress] = useState(0);
  const [holding, setHolding] = useState(false);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const startRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const firedRef = useRef(false);

  const stop = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    startRef.current = null;
    setHolding(false);
    setProgress(0);
  }, []);

  const start = useCallback(() => {
    if (disabled || busy || startRef.current !== null) return;
    firedRef.current = false;
    startRef.current = performance.now();
    setHolding(true);
    setDone(false);
    const loop = () => {
      if (startRef.current === null) return;
      const elapsed = performance.now() - startRef.current;
      setProgress(Math.min(1, elapsed / holdMs));
      if (elapsed >= holdMs && !firedRef.current) {
        firedRef.current = true;
        const ms = Math.round(elapsed);
        stop();
        setProgress(1);
        setDone(true);
        setBusy(true);
        Promise.resolve(onHold(ms)).finally(() => {
          setBusy(false);
          setDone(false);
          setProgress(0);
        });
        return;
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  }, [busy, disabled, holdMs, onHold, stop]);

  const cancel = useCallback(() => {
    if (startRef.current !== null && !firedRef.current) stop();
  }, [stop]);

  useEffect(() => () => stop(), [stop]);

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (!e.nativeEvent.isTrusted) return;
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* capture is best-effort */
    }
    start();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!e.nativeEvent.isTrusted || e.repeat) return;
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      start();
    }
  };

  const onKeyUp = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      cancel();
    }
  };

  return (
    <button
      type="button"
      className={cx(
        'btn',
        'hold',
        tone === 'danger' && 'btn-danger',
        tone === 'primary' && 'btn-primary',
        holding && 'is-holding',
        done && 'is-done',
        className,
      )}
      aria-label={ariaLabel ?? label}
      disabled={disabled || busy}
      onPointerDown={onPointerDown}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onBlur={cancel}
      onClick={e => {
        // A click never fires the action: only a completed hold does.
        e.preventDefault();
      }}
      onContextMenu={e => e.preventDefault()}
    >
      <svg className="hold-ring" viewBox="0 0 18 18" aria-hidden="true">
        <circle className="track" cx="9" cy="9" r={RADIUS} />
        <circle
          className="progress"
          cx="9"
          cy="9"
          r={RADIUS}
          strokeDasharray={CIRC}
          strokeDashoffset={CIRC * (1 - progress)}
        />
      </svg>
      <span>{busy ? 'Working…' : label}</span>
    </button>
  );
}
