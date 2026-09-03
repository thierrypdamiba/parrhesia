'use client';

// Proposal cards (PLAN.md 2.2 item 4): a dotted new-claim card, a word-level diff over one
// field, or an impact draft. Controls: "Press and hold to accept" (700 ms, held) and "Reject"
// (click). A stale card says exactly what changed and offers Reject only.

import { HoldButton } from './HoldButton';
import { WordDiff } from './WordDiff';
import {
  FIELD_LABEL,
  POSITION_LABEL,
  YOUR_WORDS_LABEL,
  actorLabel,
  clock,
} from '@/lib/client/format';
import type {
  ClaimProposalPayload,
  EditProposalPayload,
  ImpactProposalPayload,
  PendingProposal,
  Position,
} from '@/server/types';

export interface ProposalCardProps {
  proposal: PendingProposal;
  /** 1-based claim number for edit proposals. */
  claimNumber?: number;
  canEdit: boolean;
  onDecide: (proposal_id: string, decision: 'accept' | 'reject', hold_ms?: number) => Promise<void>;
}

function Label({ p }: { p: PendingProposal }) {
  return (
    <div className="card-footer">
      <span>
        proposed by {actorLabel(p.by)} {clock(p.created_at)} against Rev {p.base_rev}
      </span>
    </div>
  );
}

function Controls({
  p,
  canEdit,
  onDecide,
  acceptLabel,
  canAccept = true,
}: {
  p: PendingProposal;
  canEdit: boolean;
  onDecide: ProposalCardProps['onDecide'];
  acceptLabel: string;
  canAccept?: boolean;
}) {
  if (!canEdit)
    return <div className="muted small">Waiting for a person on the co-writing link.</div>;
  if (p.stale) {
    return (
      <div className="proposal-controls">
        <span className="stale-note">
          Stale: {actorLabel(p.stale.by)} changed {FIELD_LABEL[p.stale.field]} at{' '}
          {clock(p.stale.at)}
        </span>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => void onDecide(p.proposal_id, 'reject')}
        >
          Reject
        </button>
      </div>
    );
  }
  return (
    <div className="proposal-controls">
      {canAccept ? (
        <HoldButton
          label={acceptLabel}
          ariaLabel="Press and hold to accept"
          tone="primary"
          onHold={ms => onDecide(p.proposal_id, 'accept', ms)}
        />
      ) : null}
      <button
        type="button"
        className="btn btn-sm"
        onClick={() => void onDecide(p.proposal_id, 'reject')}
      >
        Reject
      </button>
      <span className="muted small">
        A click does nothing on Accept; hold it for about a second.
      </span>
    </div>
  );
}

export function ProposalCard({ proposal: p, claimNumber, canEdit, onDecide }: ProposalCardProps) {
  const stale = !!p.stale;
  const cardClass = `card ${stale ? 'card-stale' : 'card-dotted'}`;

  if (p.kind === 'claim') {
    const pl = p.payload as ClaimProposalPayload;
    return (
      <article className={cardClass} aria-label="Proposed claim, pending">
        <div className="card-header">
          <span className="chip chip-pending">Pending · proposed claim</span>
          {pl.anchor ? (
            <span className="chip chip-anchored">
              Anchored · p. {pl.anchor.page} · {pl.anchor.start}–{pl.anchor.end} · verifier norm-1
            </span>
          ) : null}
          <span className={`pill pill-${pl.position}`}>{POSITION_LABEL[pl.position]}</span>
        </div>
        <p className="quote">{pl.quote}</p>
        <div className="field">
          <div className="field-label">
            <span className="term">Assertion</span>
            <span>{YOUR_WORDS_LABEL}</span>
          </div>
          <div className="serif">{pl.assertion}</div>
        </div>
        {pl.requested_change ? (
          <div className="field">
            <div className="field-label">
              <span className="term">Requested change</span>
              <span>{YOUR_WORDS_LABEL}</span>
            </div>
            <div className="serif">{pl.requested_change}</div>
          </div>
        ) : null}
        {pl.evidence ? (
          <div className="field">
            <div className="field-label">
              <span className="term">Evidence</span>
              <span>{YOUR_WORDS_LABEL}</span>
            </div>
            <div className="serif">{pl.evidence}</div>
          </div>
        ) : null}
        <Label p={p} />
        <Controls
          p={p}
          canEdit={canEdit}
          onDecide={onDecide}
          acceptLabel="Press and hold to accept"
        />
      </article>
    );
  }

  if (p.kind === 'edit') {
    const pl = p.payload as EditProposalPayload;
    const field = pl.field ?? p.field ?? 'assertion';
    return (
      <div
        className={cardClass}
        style={{ padding: '10px 12px', marginTop: 8 }}
        aria-label={`Proposed edit to ${FIELD_LABEL[field]}`}
      >
        <div className="card-header" style={{ marginBottom: 6 }}>
          <span className="chip chip-pending">
            Pending · edit to {FIELD_LABEL[field]}
            {claimNumber ? ` on claim ${claimNumber}` : ''}
          </span>
          {pl.anchor ? (
            <span className="chip chip-anchored">
              Anchored · p. {pl.anchor.page} · {pl.anchor.start}–{pl.anchor.end}
            </span>
          ) : null}
        </div>
        {field === 'position' ? (
          <div>
            <span className={`pill pill-${pl.was as Position}`}>
              {POSITION_LABEL[pl.was as Position] ?? pl.was}
            </span>
            {' → '}
            <span className={`pill pill-${pl.text as Position}`}>
              {POSITION_LABEL[pl.text as Position] ?? pl.text}
            </span>
          </div>
        ) : (
          <WordDiff
            before={pl.was}
            after={pl.text}
            className={field === 'quote' ? 'quote' : 'serif'}
          />
        )}
        <Label p={p} />
        <Controls
          p={p}
          canEdit={canEdit}
          onDecide={onDecide}
          acceptLabel="Press and hold to accept"
        />
      </div>
    );
  }

  const pl = p.payload as ImpactProposalPayload;
  const forMe = p.proposed_for_user_id === 'me';
  return (
    <div
      className={cardClass}
      style={{ padding: '10px 12px', marginTop: 8 }}
      aria-label="Drafted impact statement, pending"
    >
      <div className="card-header" style={{ marginBottom: 6 }}>
        <span className="chip chip-pending">
          Pending · impact statement draft for {p.for_display_name ?? 'a signer'}
        </span>
      </div>
      <div className="impact">{pl.text}</div>
      <Label p={p} />
      <Controls
        p={p}
        canEdit={canEdit}
        onDecide={onDecide}
        acceptLabel="Press and hold to accept"
        canAccept={forMe}
      />
      {!forMe && !p.stale ? (
        <div className="muted small">
          Only {p.for_display_name ?? 'that signer'} can accept this.
        </div>
      ) : null}
    </div>
  );
}
