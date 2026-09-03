'use client';

// Letter workspace /l/{share_code} (PLAN.md 2.2 item 2, P4): split pane, header card, claim
// cards, proposals, add-by-hand, signers, export bar, history, the rule pane, judge tools.
// Every write goes through `write()` which sends the current rev, refreshes on success, and
// turns 409 STALE_REVISION into "Updated by <name>; reapply your edit".

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ActivityFeed } from './ActivityFeed';
import { AddClaimForm } from './AddClaimForm';
import { AgentsSection } from './AgentsSection';
import { ClaimCard } from './ClaimCard';
import { ExportBar } from './ExportBar';
import { JudgeBanner, VerifyBox } from './JudgeTools';
import { LetterHeader } from './LetterHeader';
import { ProposalCard } from './ProposalCard';
import { RulePane, type AnchorMark } from './RulePane';
import { SignersSection } from './SignersSection';
import { TopBar } from './TopBar';
import { readsFromRail, toastToolCall } from '@/lib/client/agentReads';
import { describeError, getApi, isFailure, type ClaimBody } from '@/lib/client/api';
import { actorLabel, isoDate } from '@/lib/client/format';
import { pushToast } from '@/lib/client/toasts';
import { useLetterState } from '@/lib/client/useLetterState';
import type {
  ChangedSince,
  ClaimField,
  LetterState,
  NearestPassage,
  PendingProposal,
} from '@/server/types';
import type { CallLogEntry } from '@/src/webmcp/guard';
import { ToolRail } from '@/src/webmcp/rail';
import type { PageState } from '@/src/webmcp/tools';
import { useWebmcp } from '@/src/webmcp/useWebmcp';

export interface WorkspaceProps {
  shareCode: string;
  judge: boolean;
}

export function Workspace({ shareCode, judge }: WorkspaceProps) {
  const router = useRouter();
  const [letterId, setLetterId] = useState<string | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const { state, error, refresh, api } = useLetterState(letterId);
  const stateRef = useRef<LetterState | null>(null);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const [nearestByClaim, setNearestByClaim] = useState<Record<string, NearestPassage[]>>({});
  const verifying = useRef(new Set<string>());
  const [localStale, setLocalStale] = useState<
    Record<string, NonNullable<PendingProposal['stale']>>
  >({});
  const [jump, setJump] = useState<{ id: string; nonce: number } | null>(null);
  const [tab, setTab] = useState<'letter' | 'rule'>('letter');

  // Resolve the share code to a letter id (grants edit through the share cookie).
  useEffect(() => {
    let alive = true;
    getApi()
      .then(a => a.resolveShare(shareCode))
      .then(r => {
        if (alive) setLetterId(r.letter_id);
      })
      .catch(err => {
        if (alive) setResolveError(describeError(err));
      });
    return () => {
      alive = false;
    };
  }, [shareCode]);

  // WebMCP (P5): the tool set is a pure function of this page state (2.3); every agent call
  // re-fetches state at once and toasts with the actor's name (2.6). Until the letter loads the
  // rail offers only the always-on tools.
  const pageState = useMemo<PageState>(
    () =>
      state
        ? {
            letter: {
              letter_id: state.letter.id,
              share_code: state.letter.share_code,
              public_token: state.letter.public_token,
              rev: state.letter.rev,
              rev_no: state.letter.rev_no,
            },
            rule: state.rule,
            bound: state.rule !== null,
            closed: state.closed,
            claimsAccepted: state.claims.length,
            signedIn: state.viewer.signed_in,
            viewerName: state.viewer.display_name,
            canEdit: state.viewer.can_edit,
            isPublicView: false,
          }
        : {
            letter: null,
            rule: null,
            bound: false,
            claimsAccepted: 0,
            signedIn: false,
            viewerName: 'Signer',
            canEdit: false,
            isPublicView: false,
          },
    [state],
  );
  const navigate = useCallback((path: string) => router.push(path), [router]);
  const onLetterChanged = useCallback(() => void refresh(true), [refresh]);
  const viewer = state?.viewer ?? null;
  const onCall = useCallback((entry: CallLogEntry) => toastToolCall(entry, viewer), [viewer]);
  const rail = useWebmcp(pageState, { navigate, onLetterChanged, onCall });

  // Agent-read shading for the rule pane: the merged read_rule ranges this session (4.4).
  const reads = useMemo(() => readsFromRail(rail), [rail]);

  // Unverified claims without cached nearest passages: ask the verifier once (no state change).
  useEffect(() => {
    if (!state || !api) return;
    for (const c of state.claims) {
      if (c.anchor_status === 'anchored' || nearestByClaim[c.id] || verifying.current.has(c.id))
        continue;
      verifying.current.add(c.id);
      api
        .verify(state.letter.id, c.quote)
        .then(() => setNearestByClaim(m => ({ ...m, [c.id]: [] })))
        .catch(err => {
          const nearest = isFailure(err, 'ANCHOR_NOT_FOUND')
            ? ((err.body.nearest as NearestPassage[] | undefined) ?? [])
            : [];
          setNearestByClaim(m => ({ ...m, [c.id]: nearest }));
        })
        .finally(() => verifying.current.delete(c.id));
    }
  }, [state, api, nearestByClaim]);

  const write = useCallback(
    async <T,>(fn: (rev: string) => Promise<T>, opts: { quiet?: boolean } = {}): Promise<T> => {
      const s = stateRef.current;
      if (!s || !api) throw new Error('The letter is still loading.');
      try {
        const result = await fn(s.letter.rev);
        await refresh(true);
        return result;
      } catch (err) {
        if (isFailure(err, 'STALE_REVISION')) {
          const changed = (err.body.changed_since as ChangedSince[] | undefined) ?? [];
          const by = changed.length ? actorLabel(changed[changed.length - 1].by) : 'someone';
          await refresh(true);
          const msg = `Updated by ${by}; reapply your edit`;
          if (!opts.quiet) pushToast(msg, { tone: 'error' });
          throw new Error(msg);
        }
        if (isFailure(err, 'STALE_PROPOSAL')) {
          await refresh(true);
          const msg = `Stale: ${err.body.field as string} was changed by ${actorLabel(err.body.by as string)} since the proposal (now "${String(err.body.now).slice(0, 60)}")`;
          pushToast(msg, { tone: 'error' });
          throw new Error(msg);
        }
        const msg = describeError(err);
        if (!opts.quiet) pushToast(msg, { tone: 'error' });
        throw err instanceof Error ? err : new Error(msg);
      }
    },
    [api, refresh],
  );

  const onPatch = useCallback(
    async (claim_id: string, field: ClaimField, text: string) => {
      const s = stateRef.current;
      if (!s || !api) return;
      // Human-driven staleness (2.2 item 4): flip pending edits on this field immediately.
      const now = new Date().toISOString();
      const by = `human:${s.viewer.signed_in ? s.viewer.display_name : 'anon'}`;
      const hit = s.pending.filter(
        p => p.kind === 'edit' && p.claim_id === claim_id && p.field === field && !p.stale,
      );
      if (hit.length) {
        setLocalStale(m => {
          const next = { ...m };
          for (const p of hit) next[p.proposal_id] = { field, by, at: now };
          return next;
        });
      }
      const res = await write(rev => api.patchClaim(s.letter.id, claim_id, rev, field, text), {
        quiet: true,
      });
      if (field === 'quote') {
        setNearestByClaim(m => ({ ...m, [claim_id]: res.nearest ?? [] }));
        if (res.claim.anchor_status === 'anchored')
          pushToast(
            `Quote anchored · p. ${res.claim.page} · ${res.claim.anchor_start}–${res.claim.anchor_end}`,
          );
        else
          pushToast('Quote is not in the rule text; the nearest passages are on the card', {
            tone: 'error',
          });
      }
    },
    [api, write],
  );

  const onDecide = useCallback(
    async (proposal_id: string, decision: 'accept' | 'reject', hold_ms?: number) => {
      const s = stateRef.current;
      if (!s || !api) return;
      try {
        const res = await write(() => api.decide(s.letter.id, proposal_id, decision, hold_ms));
        if (res.status === 'accepted') pushToast(`Accepted · Rev ${res.rev_no}`);
        else pushToast('Rejected');
      } catch {
        /* toasted in write() */
      }
    },
    [api, write],
  );

  const onAddClaim = useCallback(
    async (body: ClaimBody) => {
      const s = stateRef.current;
      if (!s || !api) return;
      const res = await write(rev => api.addClaim(s.letter.id, rev, body), { quiet: true });
      setNearestByClaim(m => ({ ...m, [res.claim.id]: res.nearest ?? [] }));
      if (res.claim.anchor_status === 'anchored')
        pushToast(
          `Claim added · anchored p. ${res.claim.page} · ${res.claim.anchor_start}–${res.claim.anchor_end}`,
        );
      else
        pushToast(
          'Claim added but the quote is not in the rule text; pick one of the nearest passages',
          { tone: 'error' },
        );
    },
    [api, write],
  );

  const pendingMerged = useMemo<PendingProposal[]>(() => {
    if (!state) return [];
    return state.pending.map(p =>
      !p.stale && localStale[p.proposal_id] ? { ...p, stale: localStale[p.proposal_id] } : p,
    );
  }, [state, localStale]);

  const anchors = useMemo<AnchorMark[]>(
    () =>
      (state?.claims ?? [])
        .filter(c => c.anchor_start !== null && c.anchor_end !== null)
        .map((c, _i, all) => ({
          id: c.id,
          n: all.indexOf(c) + 1,
          start: c.anchor_start as number,
          end: c.anchor_end as number,
          status: c.anchor_status,
        })),
    [state?.claims],
  );

  const returnTo = `/l/${shareCode}${judge ? '?judge=1' : ''}`;

  if (resolveError) {
    return (
      <>
        <TopBar returnTo={returnTo} />
        <ToolRail status={rail} />
        <main className="page">
          <div className="banner banner-error">
            <span>No letter for this link ({resolveError}).</span>
            <Link href="/">Start a new letter on an open rule</Link>
          </div>
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
          <p className="muted">
            {error ? `Could not load the letter: ${describeError(error)}` : 'Loading the letter…'}
          </p>
        </main>
      </>
    );
  }

  const canEdit = state.viewer.can_edit && !state.closed;
  const claimProposals = (claim_id: string) =>
    pendingMerged.filter(p => p.kind === 'edit' && p.claim_id === claim_id);
  const newClaimProposals = pendingMerged.filter(p => p.kind === 'claim');
  const impactProposals = pendingMerged.filter(p => p.kind === 'impact');
  const claimNumber = (claim_id: string | null) =>
    claim_id ? state.claims.findIndex(c => c.id === claim_id) + 1 : 0;

  return (
    <>
      <TopBar viewer={state.viewer} returnTo={returnTo} />
      <ToolRail status={rail} />
      <main className="page">
        {judge || state.letter.is_judge_copy ? (
          <JudgeBanner
            rule={state.rule}
            snapshotDate={
              state.rule?.source_kind === 'seed' ? isoDate(state.rule.fetched_at) : null
            }
          />
        ) : null}
        {state.closed && state.rule ? (
          <div className="banner banner-closed">
            <span>
              Comments closed {state.rule.comments_close_on}. Reading, export and history still
              work; nothing new can be proposed.
            </span>
            <Link href="/">Start a new letter on an open rule</Link>
          </div>
        ) : null}
        {!state.viewer.can_edit ? (
          <div className="banner">
            <span>This view cannot edit the letter; open the co-writing link.</span>
          </div>
        ) : null}
        {error ? (
          <div className="banner banner-error">Live updates paused: {describeError(error)}</div>
        ) : null}

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
            {state.claims.length === 0 && newClaimProposals.length === 0 ? (
              <p className="muted">
                No claims yet. Your agent can propose one after reading the rule; or add one by
                hand.
              </p>
            ) : null}
            {state.claims.map((c, i) => (
              <ClaimCard
                key={c.id}
                claim={c}
                n={i + 1}
                canEdit={canEdit}
                nearest={c.anchor_status === 'anchored' ? undefined : nearestByClaim[c.id]}
                proposals={claimProposals(c.id)}
                onPatch={(field, text) => onPatch(c.id, field, text)}
                onDelete={hold =>
                  write(rev => api!.deleteClaim(state.letter.id, c.id, rev, hold)).then(
                    () => pushToast(`Deleted claim ${i + 1}`),
                    () => undefined,
                  )
                }
                onJump={() => {
                  setTab('rule');
                  setJump({ id: c.id, nonce: Date.now() });
                }}
                onDecide={onDecide}
              />
            ))}
            {newClaimProposals.map(p => (
              <ProposalCard
                key={p.proposal_id}
                proposal={p}
                claimNumber={claimNumber(p.claim_id)}
                canEdit={canEdit}
                onDecide={onDecide}
              />
            ))}
            {canEdit && state.rule ? <AddClaimForm onSubmit={onAddClaim} /> : null}

            <SignersSection
              signers={state.signers}
              viewer={state.viewer}
              canEdit={canEdit}
              closed={state.closed}
              impacts={impactProposals}
              returnTo={returnTo}
              onAddSelf={() =>
                write(rev => api!.addSigner(state.letter.id, rev)).then(
                  () => undefined,
                  () => undefined,
                )
              }
              onSetImpact={text =>
                write(rev => api!.setImpact(state.letter.id, rev, text), { quiet: true }).then(
                  () => undefined,
                )
              }
              onSetDisplayName={name =>
                write(rev => api!.setDisplayName(state.letter.id, rev, name), { quiet: true }).then(
                  () => undefined,
                )
              }
              onSign={hold =>
                write(rev => api!.sign(state.letter.id, rev, hold)).then(
                  () => pushToast('Signed'),
                  () => undefined,
                )
              }
              onDecide={onDecide}
            />

            <div style={{ marginTop: 24 }}>
              <ExportBar state={state} api={api} />
            </div>

            <ActivityFeed
              activity={state.activity}
              revNo={state.letter.rev_no}
              canEdit={canEdit}
              onUndo={hold =>
                write(rev => api!.undo(state.letter.id, rev, hold)).then(
                  r => pushToast(`Undone · Rev ${r.rev_no}`),
                  () => undefined,
                )
              }
            />

            {judge || state.letter.is_judge_copy ? (
              <div style={{ marginTop: 24 }}>
                <VerifyBox api={api} letterId={state.letter.id} rule={state.rule} />
              </div>
            ) : null}
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
              <div className="rule-toolbar muted">No rule attached yet.</div>
            </aside>
          )}
        </div>

        <AgentsSection />
      </main>
    </>
  );
}
