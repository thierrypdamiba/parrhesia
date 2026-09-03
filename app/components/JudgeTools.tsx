'use client';

// Judge mode (PLAN.md 2.2 item 9): the banner over a private judge copy, and the
// "Try an unverified quote" box that runs the verifier live and prints the JSON verdict.

import Link from 'next/link';
import { useState } from 'react';

import { ApiFailure, type LettersApi } from '@/lib/client/api';
import { isoDate, shortDate } from '@/lib/client/format';
import type { RuleHeader } from '@/server/types';

export function JudgeBanner({
  rule,
  snapshotDate,
}: {
  rule: RuleHeader | null;
  snapshotDate: string | null;
}) {
  const live = rule
    ? rule.days_left >= 0
      ? `the rule is live (closes ${rule.comments_close_on})`
      : `the rule closed ${rule.comments_close_on}`
    : '';
  return (
    <div className="banner" role="note">
      <b>Judge letter</b>
      <span>a private copy for you</span>
      {snapshotDate ? <span>· rule text snapshot {snapshotDate}</span> : null}
      {live ? <span>· {live}</span> : null}
      <span className="topbar-spacer" />
      <Link href="/?judge=1&reset=1">Reset judge letter</Link>
    </div>
  );
}

const SAMPLE_BAD =
  'Written determinations for existing trails must be published in the Federal Register for 60 days of public comment.';

export function VerifyBox({
  api,
  letterId,
  rule,
}: {
  api: LettersApi | null;
  letterId: string;
  rule: RuleHeader | null;
}) {
  const [quote, setQuote] = useState(SAMPLE_BAD);
  const [verdict, setVerdict] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (!api) return;
    setBusy(true);
    try {
      const res = await api.verify(letterId, quote);
      setVerdict(JSON.stringify(res, null, 2));
    } catch (err) {
      if (err instanceof ApiFailure) setVerdict(JSON.stringify(err.body, null, 2));
      else
        setVerdict(
          JSON.stringify(
            { error: 'INTERNAL', hint: err instanceof Error ? err.message : 'failed' },
            null,
            2,
          ),
        );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card" aria-labelledby="verify-title">
      <h2 className="section-title" id="verify-title" style={{ marginTop: 0 }}>
        Try an unverified quote
      </h2>
      <p className="muted small">
        Paste any sentence. The page runs the same verifier (norm-1) it runs on the quotes your
        agent proposes
        {rule ? ` against the text of ${rule.document_number} it served` : ''} and prints the raw
        verdict: an anchor with page and offsets, or <span className="mono">ANCHOR_NOT_FOUND</span>{' '}
        with the three nearest real passages.
      </p>
      <textarea
        className="serif"
        rows={3}
        value={quote}
        onChange={e => setQuote(e.target.value)}
        aria-label="Quote to verify"
      />
      <div className="proposal-controls">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || quote.trim().length < 2}
          onClick={() => void run()}
        >
          {busy ? 'Verifying…' : 'Verify'}
        </button>
        <button type="button" className="btn btn-quiet btn-sm" onClick={() => setQuote(SAMPLE_BAD)}>
          the 60-days paraphrase
        </button>
        <button
          type="button"
          className="btn btn-quiet btn-sm"
          onClick={() =>
            setQuote(
              'The use of bicycles and electric bicycles is allowed in other locations designated by the superintendent after notice is provided using one or more of the methods described in Sec. 1.7 of this chapter.',
            )
          }
        >
          the real 4.30(b) sentence
        </button>
      </div>
      {verdict !== null ? (
        <pre className="json" aria-live="polite">
          {verdict}
        </pre>
      ) : null}
      {rule ? (
        <p className="provenance" style={{ marginBottom: 0 }}>
          Rule text fetched {isoDate(rule.fetched_at)} · closes {shortDate(rule.comments_close_on)}
        </p>
      ) : null}
    </section>
  );
}
