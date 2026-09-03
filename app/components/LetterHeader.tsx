// Header card (PLAN.md 2.2 item 2): agency, title, document number, docket, closing line,
// revision line and the provenance line. Plain words first, the term of art second.

import { DeadlineChip } from './DeadlineChip';
import { clock, cx, isoDate, num } from '@/lib/client/format';
import type { LetterState } from '@/server/types';

export function LetterHeader({ state }: { state: LetterState }) {
  const { rule, letter, claims, pending } = state;
  const anchored = claims.filter(c => c.anchor_status === 'anchored').length;
  const unverified = claims.length - anchored;
  const pendingCount = pending.filter(p => !p.stale).length;
  if (!rule) {
    return (
      <header className="card">
        <div className="card-title">No rule attached</div>
        <p className="muted">
          Pick a rule the government wants to change (a proposed rule) on the home page, or ask your
          agent: <span className="mono">find_open_rules → open_rule</span>.
        </p>
        <div className="provenance">
          Rev {letter.rev_no} · {letter.rev} · full hash {letter.rev_hash}
        </div>
      </header>
    );
  }
  return (
    <header className={cx('card', state.closed && 'card-stale')}>
      <div className="mono muted small">{rule.agency}</div>
      <h1 className="card-title" style={{ marginTop: 2 }}>
        {rule.title}
      </h1>
      <div className="card-header" style={{ marginTop: 8, marginBottom: 4 }}>
        <span className="chip chip-muted">Federal Register document {rule.document_number}</span>
        {rule.docket_id ? (
          <span className="chip chip-muted">regulations.gov docket {rule.docket_id}</span>
        ) : null}
        {state.closed ? (
          <span className="chip chip-muted">Comments closed {rule.comments_close_on}</span>
        ) : (
          <>
            <span className="small muted">
              The window when anyone can respond (the comment period)
            </span>
            <DeadlineChip comments_close_on={rule.comments_close_on} days_left={state.days_left} />
          </>
        )}
      </div>
      <div className="mono small" style={{ marginTop: 6 }}>
        Rev {letter.rev_no} · {claims.length} claim{claims.length === 1 ? '' : 's'} ({anchored}{' '}
        anchored · {unverified} unverified) · {pendingCount} pending
      </div>
      <div className="provenance" style={{ marginTop: 4 }}>
        Rule text fetched from federalregister.gov {isoDate(rule.fetched_at)}{' '}
        {clock(rule.fetched_at)} · {num(rule.total_chars)} chars · pp. {rule.pages.first}–
        {rule.pages.last} · source {rule.source_kind} · sha256 {rule.text_sha256.slice(0, 16)}… ·
        rev {letter.rev} ({letter.rev_hash.slice(12, 28)}…)
      </div>
    </header>
  );
}
