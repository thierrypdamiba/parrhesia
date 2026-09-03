'use client';

// "Add claim by hand" (PLAN.md 2.6): verified the same way as agent proposals; an unverified
// quote is kept and flagged, with the nearest passages shown on the card.

import { useState, type FormEvent } from 'react';

import type { ClaimBody } from '@/lib/client/api';
import { POSITION_LABEL, YOUR_WORDS_LABEL } from '@/lib/client/format';
import type { Position } from '@/server/types';
import { POSITIONS } from '@/server/types';

export function AddClaimForm({
  onSubmit,
  disabled,
}: {
  onSubmit: (body: ClaimBody) => Promise<void>;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [quote, setQuote] = useState('');
  const [position, setPosition] = useState<Position>('modify');
  const [assertion, setAssertion] = useState('');
  const [requested, setRequested] = useState('');
  const [evidence, setEvidence] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const q = quote.trim();
    const a = assertion.trim();
    if (q.length < 20 || q.length > 600)
      return setError('The quote needs 20–600 characters, copied from the rule text.');
    if (a.length < 20 || a.length > 600) return setError('The assertion needs 20–600 characters.');
    if (requested.trim().length > 400 || evidence.trim().length > 400)
      return setError('Requested change and evidence are at most 400 characters each.');
    setBusy(true);
    try {
      await onSubmit({
        quote: q,
        position,
        assertion: a,
        requested_change: requested.trim(),
        evidence: evidence.trim(),
      });
      setQuote('');
      setAssertion('');
      setRequested('');
      setEvidence('');
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the claim.');
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button type="button" className="btn" disabled={disabled} onClick={() => setOpen(true)}>
        Add claim by hand
      </button>
    );
  }

  return (
    <form className="card form-grid" onSubmit={submit} aria-label="Add claim by hand">
      <div className="card-title">Add a claim by hand</div>
      <label className="form-grid" style={{ gap: 4 }}>
        <span className="field-label">
          <span className="term">Quote</span>
          <span>
            copy a sentence from the rule text; the page verifies it the same way it verifies your
            agent
          </span>
        </span>
        <textarea
          className="quote"
          rows={4}
          value={quote}
          onChange={e => setQuote(e.target.value)}
          required
          minLength={20}
          maxLength={600}
        />
      </label>
      <label className="form-grid" style={{ gap: 4 }}>
        <span className="field-label">
          <span className="term">Position</span>
        </span>
        <select
          className={`pill pill-${position}`}
          value={position}
          onChange={e => setPosition(e.target.value as Position)}
          style={{ width: 'fit-content' }}
        >
          {POSITIONS.map(p => (
            <option key={p} value={p}>
              {POSITION_LABEL[p]}
            </option>
          ))}
        </select>
      </label>
      <label className="form-grid" style={{ gap: 4 }}>
        <span className="field-label">
          <span className="term">Assertion</span>
          <span>{YOUR_WORDS_LABEL}</span>
        </span>
        <textarea
          className="serif"
          rows={3}
          value={assertion}
          onChange={e => setAssertion(e.target.value)}
          required
          minLength={20}
          maxLength={600}
        />
      </label>
      <label className="form-grid" style={{ gap: 4 }}>
        <span className="field-label">
          <span className="term">Requested change</span>
          <span>{YOUR_WORDS_LABEL}</span>
        </span>
        <textarea
          className="serif"
          rows={2}
          value={requested}
          onChange={e => setRequested(e.target.value)}
          maxLength={400}
        />
      </label>
      <label className="form-grid" style={{ gap: 4 }}>
        <span className="field-label">
          <span className="term">Evidence</span>
          <span>{YOUR_WORDS_LABEL}</span>
        </span>
        <textarea
          className="serif"
          rows={2}
          value={evidence}
          onChange={e => setEvidence(e.target.value)}
          maxLength={400}
        />
      </label>
      {error ? <div className="error-text">{error}</div> : null}
      <div className="proposal-controls" style={{ marginTop: 0 }}>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Verifying…' : 'Add claim'}
        </button>
        <button type="button" className="btn" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}
