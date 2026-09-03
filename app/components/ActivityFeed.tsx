'use client';

// History (PLAN.md 2.2 item 7): the last 20 activity lines including refusals, and
// "Undo last change" (held; restores rev N−1 as a new revision).

import { HoldButton } from './HoldButton';
import { actorLabel, clock } from '@/lib/client/format';
import type { ActivityLine } from '@/server/types';

export interface ActivityFeedProps {
  activity: readonly ActivityLine[];
  revNo: number;
  canEdit: boolean;
  onUndo: (hold_ms: number) => Promise<void>;
}

export function ActivityFeed({ activity, revNo, canEdit, onUndo }: ActivityFeedProps) {
  return (
    <section aria-labelledby="history-title">
      <div className="card-header">
        <h2 className="section-title" id="history-title" style={{ margin: 0 }}>
          History
        </h2>
        <span className="mono muted">Rev {revNo}</span>
        <span className="topbar-spacer" />
        {canEdit ? (
          <HoldButton
            label="Hold to undo last change"
            ariaLabel="Press and hold to undo the last change"
            className="btn-sm"
            disabled={revNo <= 1}
            onHold={onUndo}
          />
        ) : null}
      </div>
      {activity.length === 0 ? (
        <p className="muted">Nothing yet.</p>
      ) : (
        <ul className="feed">
          {activity.map(a => (
            <li key={a.id}>
              <span className="when">{clock(a.created_at)}</span>
              <span>
                <span className="who">{actorLabel(a.actor)} · </span>
                {a.summary}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
