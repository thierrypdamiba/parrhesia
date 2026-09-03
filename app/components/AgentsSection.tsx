// "How agents use this site" (PLAN.md 2.5), rendered on the home and letter pages under
// id="agents". Every sentence comes from server/agents-doc.ts, the same source that generates
// docs/TOOLS.md and the README block (scripts/tools-doc.mjs), so the page and the docs never
// drift. The tool table is derived from src/webmcp/schema.ts. All text is rendered as text
// nodes; the only markup is ours.

import Link from 'next/link';
import type { ReactNode } from 'react';

import { APP_NAME } from '@/lib/app';
import {
  AGENTS_INTRO,
  AGENTS_SECTION_ID,
  CANNOT_DO,
  HOST_NOTES,
  JUDGE_PATH,
  REFUSAL_PROMPT,
  SAMPLE_PROMPT,
  toolTableRows,
} from '@/server/agents-doc';

export { SAMPLE_PROMPT };

/** Render the backtick-marked spans of the source strings as <code>, everything else as text. */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  text.split('`').forEach((part, i) => {
    if (!part) return;
    out.push(i % 2 === 1 ? <code key={i}>{part}</code> : <span key={i}>{part}</span>);
  });
  return out;
}

export function AgentsSection() {
  const rows = toolTableRows();
  return (
    <section className="agents" id={AGENTS_SECTION_ID} aria-labelledby="agents-title">
      <h2 className="section-title" id="agents-title">
        How agents use this site
      </h2>
      {AGENTS_INTRO.map((p, i) => (
        <p key={i}>{inline(p)}</p>
      ))}

      <h3 className="agents-subtitle">The eight tools</h3>
      <p className="muted small">
        Generated from the tool definitions in <code>src/webmcp/schema.ts</code>. Every schema has{' '}
        <code>additionalProperties:false</code>; both annotation hints are explicit, with the reason
        in parentheses; outputs are bounded; errors are <code>{'{error, hint}'}</code>.
      </p>
      <div className="tool-table-wrap">
        <table className="tool-table">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Tool</th>
              <th scope="col">Purpose</th>
              <th scope="col">readOnlyHint</th>
              <th scope="col">untrustedContentHint</th>
              <th scope="col">Appears when</th>
              <th scope="col">Key errors</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.name}>
                <td className="mono">{i + 1}</td>
                <td>
                  <code>{r.name}</code>
                  <div className="muted small">{r.title}</div>
                </td>
                <td>{r.purpose}</td>
                <td>
                  <span className="mono">{String(r.read_only.value)}</span>{' '}
                  <span className="muted small">({r.read_only.reason})</span>
                </td>
                <td>
                  <span className="mono">{String(r.untrusted.value)}</span>{' '}
                  <span className="muted small">({r.untrusted.reason})</span>
                </td>
                <td>{r.appears_when}</td>
                <td className="mono small">{r.errors.join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="agents-subtitle">What tools cannot do</h3>
      <ul className="agents-list">
        {CANNOT_DO.map(c => (
          <li key={c.what}>
            <b>{c.what}</b> — {c.why}
          </li>
        ))}
      </ul>

      <h3 className="agents-subtitle">Host notes</h3>
      <ul className="agents-list">
        {HOST_NOTES.map((n, i) => (
          <li key={i}>{inline(n)}</li>
        ))}
      </ul>

      <h3 className="agents-subtitle">Try it</h3>
      <p>
        Open <Link href={JUDGE_PATH}>the judge letter</Link> without an agent, or paste this into
        ChatGPT with this page open in its browser:
      </p>
      <pre className="json">{SAMPLE_PROMPT}</pre>
      <p className="muted small">
        To see a refusal, ask for the paraphrase that is not in the rule. {APP_NAME} answers with{' '}
        <code>ANCHOR_NOT_FOUND</code> and the three nearest real passages:
      </p>
      <pre className="json">{REFUSAL_PROMPT}</pre>
    </section>
  );
}
