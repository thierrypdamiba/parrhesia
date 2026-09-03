'use client';

import { useSyncExternalStore } from 'react';

import { cx } from '@/lib/client/format';
import { dismissToast, getToasts, subscribeToasts } from '@/lib/client/toasts';

export function Toasts() {
  const list = useSyncExternalStore(subscribeToasts, getToasts, getToasts);
  if (list.length === 0) return null;
  return (
    <div className="toasts" aria-live="polite">
      {list.map(t => (
        <div
          key={t.id}
          className={cx('toast', t.tone === 'error' && 'toast-error')}
          role={t.tone === 'error' ? 'alert' : 'status'}
          onClick={() => dismissToast(t.id)}
        >
          {t.who ? <span className="who">{t.who}</span> : null}
          {t.text}
        </div>
      ))}
    </div>
  );
}
