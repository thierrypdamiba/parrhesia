'use client';

// Public read-only page /r/{public_token} (PLAN.md 2.2 item 8): the letter as a document,
// no editing controls, the rule pane for reading, export links only.

import { useCallback, useEffect, useMemo, useState } from 'react';

import { AgentsSection } from './AgentsSection';
import { AnchorChip } from './ClaimCard';
import { ExportBar } from './ExportBar';
import { LetterHeader } from './LetterHeader';
import { RulePane, type AnchorMark } from './RulePane';
import { TopBar } from './TopBar';
import { readsFromRail, toastToolCall } from '@/lib/client/agentReads';
import { describeError, getApi } from '@/lib/client/api';
import { POSITION_LABEL, YOUR_WORDS_LABEL, actorLabel, clock } from '@/lib/client/format';
import { useLetterState } from '@/lib/client/useLetterState';
import type { CallLogEntry } from '@/src/webmcp/guard';
import { ToolRail } from '@/src/webmcp/rail';
import type { PageState } from '@/src/webmcp/tools';
import { useWebmcp } from '@/src/webmcp/useWebmcp';

export function PublicLetter({ publicToken }: { publicToken: string }) {
  const [letterId, setLetterId] = useState<string | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const { state, error, api } = useLetterState(letterId);
  const [jump, setJump] = useState<{ id: string; nonce: number } | null>(null);
  const [tab, setTab] = useState<'letter' | 'rule'>('letter');
  const returnTo = `/r/${publicToken}`;

  // WebMCP (P5, 2.2 item 8): the public page registers only get_letter and read_rule; nothing
  // here writes. read_rule still shades what the agent read.
  const pageState = useMemo<PageState>(
    () => ({
      letter: state
        ? {
            letter_id: state.letter.id,
            public_token: state.letter.public_token,
            rev: state.letter.rev,
            rev_no: state.letter.rev_no,
          }
        : null,
      rule: state?.rule ?? null,
      bound: !!state?.rule,
      closed: state?.closed ?? false,
      claimsAccepted: state?.claims.length ?? 0,
      signedIn: state?.viewer.signed_in ?? false,
      viewerName: state?.viewer.display_name ?? 'Signer',
      canEdit: false,
      isPublicView: true,
    }),
    [state],
  );
  const viewer = state?.viewer ?? null;
  const onCall = useCallback((entry: CallLogEntry) => toastToolCall(entry, viewer), [viewer]);
  const rail = useWebmcp(pageState, { onCall });
  const reads = useMemo(() => readsFromRail(rail), [rail]);

  useEffect(() => {
    let alive = true;
    getApi()
      .then(a => a.resolvePublic(publicToken))
      .then(r => {
        if (alive) setLetterId(r.letter_id);
      })
      .catch(err => {
        if (alive) setResolveError(describeError(err));
      });
    return () => {
      alive = false;
    };
  }, [publicToken]);

  const anchors = useMemo<AnchorMark[]>(
    () =>
      (state?.claims ?? [])
        .map((c, i) => ({ c, i }))
        .filter(({ c }) => c.anchor_start !== null && c.anchor_end !== null)
        .map(({ c, i }) => ({
          id: c.id,
          n: i + 1,
          start: c.anchor_start as number,
          end: c.anchor_end as number,
          status: c.anchor_status,
        })),
    [state?.claims],
  );

  if (resolveError) {
    return (
      <>
        <TopBar returnTo={returnTo} />
        <ToolRail status={rail} />
        <main className="page">
          <div className="banner banner-error">No letter for this link ({resolveError}).</div>
        </main>
      </>
    );
  }
  if (!state) {
    return (
      <>
        <TopBar returnTo={returnTo} />
        <ToolRail status={rail} />
        <main className="page">
          <p className="muted">{error ? describeError(error) : 'Loading…'}</p>
        </main>
      </>
    );
  }

  return (
    <>
      <TopBar viewer={state.viewer} returnTo={returnTo} />
      <ToolRail status={rail} />
      <main className="page">
        <div className="banner">
          <span>
            Public read-only view of this letter. Nothing here can be changed from this page.
          </span>
        </div>
        <div className="pane-tabs" role="tablist" aria-label="Letter or rule text">
          <button
            type="button"
            role="tab"
            className="btn btn-sm"
            aria-selected={tab === 'letter'}
            onClick={() => setTab('letter')}
          >
            Letter
          </button>
          <button
            type="button"
            role="tab"
            className="btn btn-sm"
            aria-selected={tab === 'rule'}
            onClick={() => setTab('rule')}
          >
            Rule text
          </button>
        </div>
        <div className="workspace" data-tab={tab}>
          <section className="letter-pane" aria-label="Letter">
            <LetterHeader state={state} />
            <h2 className="section-title">Claims</h2>
            {state.claims.length === 0 ? <p className="muted">No claims yet.</p> : null}
            {state.claims.map((c, i) => (
              <article className="card" key={c.id} aria-label={`Claim ${i + 1}`}>
                <div className="card-header">
                  <span className="mono muted">Claim {i + 1}</span>
                  <AnchorChip
                    claim={c}
                    onJump={
                      c.anchor_status === 'anchored'
                        ? () => {
                            setTab('rule');
                            setJump({ id: c.id, nonce: Date.now() });
                          }
                        : undefined
                    }
                  />
                  <span className={`pill pill-${c.position}`}>{POSITION_LABEL[c.position]}</span>
                </div>
                <p className="quote">{c.quote}</p>
                {(
                  [
                    ['assertion', 'Assertion'],
                    ['requested_change', 'Requested change'],
                    ['evidence', 'Evidence'],
                  ] as const
                ).map(([field, label]) =>
                  c[field] ? (
                    <div className="field" key={field}>
                      <div className="field-label">
                        <span className="term">{label}</span>
                        <span>{YOUR_WORDS_LABEL}</span>
                      </div>
                      <div className="serif">{c[field]}</div>
                    </div>
                  ) : null,
                )}
                <div className="card-footer">
                  {c.proposed_by
                    ? `proposed by ${actorLabel(c.proposed_by)} ${clock(c.created_at)}`
                    : ''}
                  {c.accepted_by
                    ? ` · ${c.proposed_by ? 'accepted' : 'typed'} by ${actorLabel(c.accepted_by)} ${clock(c.accepted_at ?? c.created_at)}`
                    : ''}
                </div>
              </article>
            ))}
            <h2 className="section-title">Signers</h2>
            {state.signers.length === 0 ? <p className="muted">No signers yet.</p> : null}
            {state.signers.map((s, i) => (
              <article className="card signer" key={`${s.display_name}-${i}`}>
                <div className="card-header" style={{ marginBottom: 0 }}>
                  <span className="signer-name">{s.display_name}</span>
                  <span className={`chip ${s.signed_at ? 'chip-anchored' : 'chip-muted'}`}>
                    {s.signed_at ? `signed ${clock(s.signed_at)}` : 'not yet signed'}
                  </span>
                </div>
                {s.impact_text ? <div className="impact">{s.impact_text}</div> : null}
              </article>
            ))}
            <div style={{ marginTop: 24 }}>
              <ExportBar state={state} api={api} compact />
            </div>
          </section>
          {state.rule ? (
            <RulePane
              documentNumber={state.rule.document_number}
              anchors={anchors}
              reads={reads}
              jump={jump}
            />
          ) : (
            <aside className="rule-pane">
              <div className="rule-toolbar muted">No rule attached.</div>
            </aside>
          )}
        </div>
        <AgentsSection />
      </main>
    </>
  );
}
