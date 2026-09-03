'use client';

// Top bar (PLAN.md 2.2 item 1): wordmark, tagline, Sign in with ChatGPT or display name + sign
// out. The rail (2.4) renders directly under it.

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { APP_NAME, APP_TAGLINE } from '@/lib/app';
import { getApi } from '@/lib/client/api';

export interface TopBarViewer {
  signed_in: boolean;
  display_name: string;
}

export interface TopBarProps {
  /** When omitted the bar reads /api/me itself. */
  viewer?: TopBarViewer | null;
  /** Path to come back to after Sign in with ChatGPT (same-origin path). */
  returnTo: string;
}

export function signInHref(returnTo: string): string {
  return `/api/signin?return_to=${encodeURIComponent(returnTo)}`;
}

export function TopBar({ viewer, returnTo }: TopBarProps) {
  const [own, setOwn] = useState<TopBarViewer | null>(null);
  useEffect(() => {
    if (viewer !== undefined) return;
    let alive = true;
    getApi()
      .then(api => api.me())
      .then(me => {
        if (alive) setOwn({ signed_in: me.signed_in, display_name: me.display_name });
      })
      .catch(() => {
        if (alive) setOwn({ signed_in: false, display_name: 'Signer' });
      });
    return () => {
      alive = false;
    };
  }, [viewer]);
  const v = viewer === undefined ? own : viewer;
  return (
    <header className="topbar">
      <Link href="/" className="wordmark">
        {APP_NAME}
        <small>{APP_TAGLINE}</small>
      </Link>
      <div className="topbar-spacer" />
      {v === null || v === undefined ? (
        <span className="muted small">…</span>
      ) : v.signed_in ? (
        <span className="small">
          <span className="mono">{v.display_name}</span>
          {' · '}
          <a href="/signout-with-chatgpt">Sign out</a>
        </span>
      ) : (
        <a className="btn btn-sm" href={signInHref(returnTo)}>
          Sign in with ChatGPT
        </a>
      )}
    </header>
  );
}
