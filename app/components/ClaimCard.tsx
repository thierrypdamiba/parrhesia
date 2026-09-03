'use client';

// Claim card (PLAN.md 2.2 item 3): quote in serif with the anchor chip or the refusal with the
// three nearest passages and "Use this passage"; position pill; assertion, requested change and
// evidence as click-to-edit fields carrying the grey "your words · not verified against the rule"
// label; attribution footer; Delete (held). Pending edit proposals render under their field.

import { EditableField } from './EditableField';
import { HoldButton } from './HoldButton';
import { ProposalCard } from './ProposalCard';
import {
  POSITION_LABEL,
  YOUR_WORDS_LABEL,
  actorLabel,
  clock,
  isAgentActor,
} from '@/lib/client/format';
import type {
  Claim,
  ClaimField,
  NearestPassage,
  Occurrence,
  PendingProposal,
  Position,
} from '@/server/types';
import { POSITIONS } from '@/server/types';

export interface ClaimCardProps {
  claim: Claim;
  n: number;
  canEdit: boolean;
  nearest?: readonly NearestPassage[];
  /** Set when the quote is unverified because it occurs more than once (2.2 item 3). */
  occurrences?: readonly Occurrence[];
  /** Pending edit proposals targeting this claim. */
  proposals: readonly PendingProposal[];
  onPatch: (field: ClaimField, text: string) => Promise<void>;
  onDelete: (hold_ms: number) => Promise<void>;
  onJump: () => void;
  onDecide: (proposal_id: string, decision: 'accept' | 'reject', hold_ms?: number) => Promise<void>;
}

export function AnchorChip({
  claim,
  occurrences,
  onJump,
}: {
  claim: Claim;
  occurrences?: readonly Occurrence[];
  onJump?: () => void;
}) {
  if (
    claim.anchor_status === 'anchored' &&
    claim.anchor_start !== null &&
    claim.anchor_end !== null
  ) {
    const text = `Anchored · p. ${claim.page} · ${claim.anchor_start}–${claim.anchor_end} · verifier norm-1`;
    return onJump ? (
      <button
        type="button"
        className="chip chip-anchored chip-btn"
        onClick={onJump}
        title="Jump to this passage in the rule text"
      >
        {text}
      </button>
    ) : (
      <span className="chip chip-anchored">{text}</span>
    );
  }
  if (occurrences && occurrences.length > 1) {
    return (
      <span className="chip chip-unverified">
        Ambiguous · occurs {occurrences.length} times · quote a longer span
      </span>
    );
  }
  return <span className="chip chip-unverified">Unverified · not in rule text</span>;
}

function Attribution({ claim }: { claim: Claim }) {
  const parts: string[] = [];
  if (claim.proposed_by) {
    parts.push(`proposed by ${actorLabel(claim.proposed_by)} ${clock(claim.created_at)}`);
    if (claim.accepted_by)
      parts.push(`accepted by ${actorLabel(claim.accepted_by)} ${clock(claim.accepted_at)}`);
  } else if (claim.accepted_by) {
    parts.push(`typed by ${actorLabel(claim.accepted_by)} ${clock(claim.created_at)}`);
  }
  if (claim.updated_at && claim.updated_at !== claim.created_at)
    parts.push(`edited ${clock(claim.updated_at)}`);
  if (parts.length === 0) return null;
  return (
    <span className={isAgentActor(claim.proposed_by) ? '' : undefined}>{parts.join(' · ')}</span>
  );
}

export function ClaimCard({
  claim,
  n,
  canEdit,
  nearest,
  occurrences,
  proposals,
  onPatch,
  onDelete,
  onJump,
  onDecide,
}: ClaimCardProps) {
  const editsOn = (field: ClaimField) =>
    proposals.filter(p => p.kind === 'edit' && p.field === field);
  const unverified = claim.anchor_status !== 'anchored';
  const ambiguous = !!occurrences && occurrences.length > 1;

  return (
    <article className="card" id={`claim-${claim.id}`} aria-label={`Claim ${n}`}>
      <div className="card-header">
        <span className="mono muted">Claim {n}</span>
        <AnchorChip
          claim={claim}
          occurrences={occurrences}
          onJump={unverified ? undefined : onJump}
        />
        {canEdit ? (
          <select
            className={`pill pill-${claim.position}`}
            aria-label="Position"
            value={claim.position}
            onChange={e => void onPatch('position', e.target.value as Position)}
          >
            {POSITIONS.map(p => (
              <option key={p} value={p}>
                {POSITION_LABEL[p]}
              </option>
            ))}
          </select>
        ) : (
          <span className={`pill pill-${claim.position}`}>{POSITION_LABEL[claim.position]}</span>
        )}
        {!unverified ? (
          <button type="button" className="btn btn-quiet btn-sm" onClick={onJump}>
            Jump to anchor
          </button>
        ) : null}
      </div>

      <div className="field" style={{ marginTop: 0 }}>
        <div className="field-label">
          <span className="term">Quote</span>
          <span>
            {ambiguous
              ? `occurs ${occurrences!.length} times in the rule text`
              : unverified
                ? 'must be copied from the rule text'
                : 'verified against the rule text this page served'}
          </span>
        </div>
        <EditableField
          value={claim.quote}
          ariaLabel={`Quote of claim ${n}`}
          className="quote"
          disabled={!canEdit}
          minLength={20}
          maxLength={600}
          rows={4}
          onSave={text => onPatch('quote', text)}
        />
        {editsOn('quote').map(p => (
          <ProposalCard
            key={p.proposal_id}
            proposal={p}
            claimNumber={n}
            canEdit={canEdit}
            onDecide={onDecide}
          />
        ))}
        {ambiguous ? (
          <div className="nearest">
            <div className="nearest-title">
              This quote appears more than once in the rule, so the page will not say which one you
              mean. Quote a longer span. It occurs at:
            </div>
            {occurrences!.map((oc, i) => (
              <div className="nearest-item" key={`${oc.start}-${i}`}>
                <span className="chip chip-muted">
                  p. {oc.page} · {oc.start}–{oc.end}
                </span>
              </div>
            ))}
          </div>
        ) : unverified && nearest && nearest.length > 0 ? (
          <div className="nearest">
            <div className="nearest-title">
              Not in the rule. The three nearest real passages (offsets and Federal Register page
              numbers):
            </div>
            {nearest.map((np, i) => (
              <div className="nearest-item" key={`${np.start}-${i}`}>
                <div className="quote">{np.text}</div>
                <div className="nearest-meta">
                  <span className="chip chip-muted">
                    p. {np.page} · {np.start}–{np.end} · score {np.score.toFixed(3)}
                  </span>
                  {canEdit ? (
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => void onPatch('quote', np.text)}
                    >
                      Use this passage
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : unverified ? (
          <div className="nearest">
            <div className="nearest-title">
              Not in the rule. Looking up the nearest real passages…
            </div>
          </div>
        ) : null}
      </div>

      {(
        [
          ['assertion', 'Assertion', 20],
          ['requested_change', 'Requested change', 0],
          ['evidence', 'Evidence', 0],
        ] as const
      ).map(([field, label, min]) => (
        <div className="field" key={field}>
          <div className="field-label">
            <span className="term">{label}</span>
            <span>{YOUR_WORDS_LABEL}</span>
          </div>
          <EditableField
            value={claim[field]}
            ariaLabel={`${label} of claim ${n}`}
            className="serif"
            disabled={!canEdit}
            minLength={min}
            maxLength={field === 'assertion' ? 600 : 400}
            placeholder={
              field === 'requested_change' ? 'What exactly should the agency change?' : undefined
            }
            onSave={text => onPatch(field, text)}
          />
          {editsOn(field).map(p => (
            <ProposalCard
              key={p.proposal_id}
              proposal={p}
              claimNumber={n}
              canEdit={canEdit}
              onDecide={onDecide}
            />
          ))}
        </div>
      ))}

      {editsOn('position').map(p => (
        <ProposalCard
          key={p.proposal_id}
          proposal={p}
          claimNumber={n}
          canEdit={canEdit}
          onDecide={onDecide}
        />
      ))}

      <div className="card-footer">
        <Attribution claim={claim} />
        <span className="topbar-spacer" />
        {canEdit ? (
          <HoldButton
            label="Hold to delete"
            ariaLabel={`Press and hold to delete claim ${n}`}
            tone="danger"
            className="btn-sm"
            onHold={onDelete}
          />
        ) : null}
      </div>
    </article>
  );
}
