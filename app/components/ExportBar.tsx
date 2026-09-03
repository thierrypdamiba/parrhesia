'use client';

// Export bar (PLAN.md 2.2 item 6): copy as text, open the export in a new tab (no blob
// download), the regulations.gov link (or the ADDRESSES fallback when the rule has no form),
// copy the public and co-writing links, and the "Missing before filing" checklist.

import { APP_NAME } from '@/lib/app';
import { describeError, type LettersApi } from '@/lib/client/api';
import { pushToast } from '@/lib/client/toasts';
import type { LetterState } from '@/server/types';

export interface ExportBarProps {
  state: LetterState;
  api: LettersApi | null;
  compact?: boolean;
}

async function copy(text: string, what: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    pushToast(`${what} copied`);
  } catch {
    pushToast(`Could not copy ${what.toLowerCase()}; select and copy it by hand`, {
      tone: 'error',
    });
  }
}

export function ExportBar({ state, api, compact }: ExportBarProps) {
  const rule = state.rule;
  const id = state.letter.id;
  const origin = () => window.location.origin;
  const publicUrl = () => `${origin()}/r/${state.letter.public_token}`;
  const shareUrl = state.letter.share_code
    ? () => `${origin()}/l/${state.letter.share_code}`
    : null;

  const copyText = async () => {
    if (!api) return;
    try {
      const text = await api.exportText(id);
      await copy(text, 'Letter text');
    } catch (err) {
      pushToast(describeError(err), { tone: 'error' });
    }
  };

  return (
    <section className="card" aria-labelledby="export-title">
      <h2 className="section-title" id="export-title" style={{ marginTop: 0 }}>
        Export and file
      </h2>
      <div className="export-links">
        <button type="button" className="btn" onClick={() => void copyText()}>
          Copy letter as text
        </button>
        <a className="btn" href={api?.exportUrl(id) ?? '#'} target="_blank" rel="noopener">
          Open export
        </a>
        {rule ? (
          rule.comment_url ? (
            <a className="btn btn-primary" href={rule.comment_url} target="_blank" rel="noopener">
              Open the regulations.gov comment form
            </a>
          ) : (
            <a className="btn btn-primary" href={rule.html_url} target="_blank" rel="noopener">
              Open the rule on federalregister.gov
            </a>
          )
        ) : null}
        <button type="button" className="btn" onClick={() => void copy(publicUrl(), 'Public link')}>
          Copy public link
        </button>
        {shareUrl ? (
          <button
            type="button"
            className="btn"
            onClick={() => void copy(shareUrl(), 'Co-writing link')}
          >
            Copy co-writing link
          </button>
        ) : null}
      </div>
      <p className="muted small" style={{ marginBottom: 0 }}>
        {rule?.comment_url
          ? `Opens in your browser; ${APP_NAME} never files. You paste the letter into the site where you file it (regulations.gov) yourself.`
          : rule
            ? 'This rule takes comments by mail or email; see the ADDRESSES section of the rule. The link opens in your browser; ' +
              APP_NAME +
              ' never files.'
            : 'Attach a rule first.'}
      </p>
      {!compact ? (
        <div className="field">
          <div className="field-label">
            <span className="term">Missing before filing</span>
          </div>
          {state.missing.length === 0 ? (
            <div className="ok-text">Nothing missing. A person files it.</div>
          ) : (
            <ul className="checklist">
              {state.missing.map(m => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}
