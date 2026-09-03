'use client';

// Signer blocks (PLAN.md 2.2 item 5): display name, signed time, impact statement (editable
// only by that signer), "Press and hold to sign" for the viewer's own block, "Add yourself as a
// signer" / "Sign in with ChatGPT to sign on", and the human-only "Your public display name"
// field when the sign-in had no full name (never a tool field; the email is never shown).

import { useState } from 'react';

import { EditableField } from './EditableField';
import { HoldButton } from './HoldButton';
import { ProposalCard } from './ProposalCard';
import { signInHref } from './TopBar';
import { clock } from '@/lib/client/format';
import type { PendingProposal, StateSigner, StateViewer } from '@/server/types';

export interface SignersSectionProps {
  signers: readonly StateSigner[];
  viewer: StateViewer;
  canEdit: boolean;
  closed: boolean;
  /** Pending impact proposals (rendered inside the block they are for). */
  impacts: readonly PendingProposal[];
  returnTo: string;
  onAddSelf: () => Promise<void>;
  onSetImpact: (text: string) => Promise<void>;
  onSetDisplayName: (name: string) => Promise<void>;
  onSign: (hold_ms: number) => Promise<void>;
  onDecide: (proposal_id: string, decision: 'accept' | 'reject', hold_ms?: number) => Promise<void>;
}

function DisplayNameField({ onSave }: { onSave: (name: string) => Promise<void> }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="form-grid"
      style={{ gap: 4, maxWidth: 360 }}
      onSubmit={async e => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await onSave(name);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Could not save the name.');
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="field-label" htmlFor="display-name">
        <span className="term">Your public display name</span>
        <span>required before signing; typed by you, never by a tool</span>
      </label>
      <div className="export-links">
        <input
          id="display-name"
          value={name}
          onChange={e => setName(e.target.value)}
          maxLength={40}
          pattern="[A-Za-z0-9 .'\-]+"
          required
        />
        <button type="submit" className="btn btn-sm" disabled={busy}>
          Save name
        </button>
      </div>
      {error ? <div className="error-text">{error}</div> : null}
    </form>
  );
}

export function SignersSection(props: SignersSectionProps) {
  const { signers, viewer, canEdit, closed, impacts, returnTo } = props;
  const mine = signers.find(s => s.is_viewer) ?? null;
  const needsName = !!mine && mine.display_name === 'Signer';

  return (
    <section aria-labelledby="signers-title">
      <h2 className="section-title" id="signers-title">
        Signers
      </h2>
      {signers.length === 0 ? (
        <p className="muted">No signers yet. Each signer signs under their own ChatGPT identity.</p>
      ) : null}
      {signers.map((s, i) => {
        const own = s.is_viewer;
        const myImpacts = own
          ? impacts.filter(p => p.proposed_for_user_id === 'me')
          : impacts.filter(
              p => p.for_display_name === s.display_name && p.proposed_for_user_id !== 'me',
            );
        return (
          <article
            className="card signer"
            key={`${s.display_name}-${s.added_at}-${i}`}
            aria-label={`Signer ${s.display_name}`}
          >
            <div className="card-header" style={{ marginBottom: 0 }}>
              <span className="signer-name">{s.display_name}</span>
              <span className={`chip ${s.signed_at ? 'chip-anchored' : 'chip-muted'}`}>
                {s.signed_at ? `signed ${clock(s.signed_at)}` : 'not yet signed'}
              </span>
              {own ? <span className="chip chip-muted">you</span> : null}
            </div>
            {own && needsName ? <DisplayNameField onSave={props.onSetDisplayName} /> : null}
            <div className="field" style={{ marginTop: 4 }}>
              <div className="field-label">
                <span className="term">Impact statement</span>
                <span>
                  {own
                    ? 'your words · only you can write or accept it'
                    : `${s.display_name}'s words`}
                </span>
              </div>
              {own ? (
                <EditableField
                  value={s.impact_text ?? ''}
                  ariaLabel="Your impact statement"
                  className="impact"
                  disabled={closed}
                  maxLength={800}
                  rows={4}
                  placeholder="How does this rule affect you? Your agent can draft this for you (draft_my_impact); you accept and sign."
                  onSave={props.onSetImpact}
                />
              ) : (
                <div className="impact">
                  {s.impact_text ?? <span className="muted">(none yet)</span>}
                </div>
              )}
              {myImpacts.map(p => (
                <ProposalCard
                  key={p.proposal_id}
                  proposal={p}
                  canEdit={canEdit}
                  onDecide={props.onDecide}
                />
              ))}
            </div>
            {own && !s.signed_at ? (
              <div className="proposal-controls">
                <HoldButton
                  label="Press and hold to sign"
                  ariaLabel="Press and hold to sign"
                  tone="primary"
                  disabled={needsName || closed}
                  onHold={props.onSign}
                />
                {needsName ? (
                  <span className="muted small">Set your public display name first.</span>
                ) : null}
              </div>
            ) : null}
          </article>
        );
      })}
      {viewer.signed_in ? (
        !mine && !closed ? (
          <button type="button" className="btn" onClick={() => void props.onAddSelf()}>
            Add yourself as a signer
          </button>
        ) : null
      ) : (
        <a className="btn" href={signInHref(returnTo)}>
          Sign in with ChatGPT to sign on
        </a>
      )}
    </section>
  );
}
