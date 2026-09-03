'use client';

// Home / (PLAN.md 2.2 item 1): the rules the government wants to change that are open for a
// response today, search, "Start a letter", the empty letter outline, and judge mode
// (/?judge=1 → POST /api/judge/fork → /l/{share_code}?judge=1).

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AgentsSection } from './AgentsSection';
import { DeadlineChip } from './DeadlineChip';
import { TopBar, type TopBarViewer } from './TopBar';
import { APP_DESCRIPTION, APP_NAME } from '@/lib/app';
import { toastToolCall } from '@/lib/client/agentReads';
import {
  describeError,
  getApi,
  isFailure,
  type LettersApi,
  type RulesResponse,
} from '@/lib/client/api';
import { clock } from '@/lib/client/format';
import { pushToast } from '@/lib/client/toasts';
import type { CallLogEntry } from '@/src/webmcp/guard';
import { ToolRail } from '@/src/webmcp/rail';
import type { PageState } from '@/src/webmcp/tools';
import { useWebmcp } from '@/src/webmcp/useWebmcp';

export function Home() {
  const router = useRouter();
  const params = useSearchParams();
  const judge = params.get('judge') === '1';
  const reset = params.get('reset') === '1';

  const [api, setApi] = useState<LettersApi | null>(null);
  const [viewer, setViewer] = useState<TopBarViewer | null>(null);
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<RulesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const [judgeNote, setJudgeNote] = useState<string | null>(
    judge ? 'Preparing your private judge copy…' : null,
  );
  const requestSeq = useRef(0);

  // WebMCP (P5): unbound state, so the rail offers find_open_rules, open_rule, get_letter.
  // open_rule creates the letter bound in one request (POST /api/letters {document_number}) and
  // navigates to /l/{share_code} through the router.
  const pageState = useMemo<PageState>(
    () => ({
      letter: null,
      rule: null,
      bound: false,
      closed: false,
      claimsAccepted: 0,
      signedIn: viewer?.signed_in ?? false,
      viewerName: viewer?.display_name ?? 'Signer',
      canEdit: true,
      isPublicView: false,
    }),
    [viewer],
  );
  const navigate = useCallback((path: string) => router.push(path), [router]);
  const onCall = useCallback((entry: CallLogEntry) => toastToolCall(entry, viewer), [viewer]);
  const rail = useWebmcp(pageState, { navigate, onCall });

  useEffect(() => {
    let alive = true;
    getApi().then(a => {
      if (!alive) return;
      setApi(a);
      a.me()
        .then(me => {
          if (!alive) return;
          setViewer({ signed_in: me.signed_in, display_name: me.display_name });
          if (me.return_to && me.return_to.startsWith('/')) router.replace(me.return_to);
        })
        .catch(() => setViewer({ signed_in: false, display_name: 'Signer' }));
    });
    return () => {
      alive = false;
    };
  }, [router]);

  // Judge mode: fork (or reuse) the judge letter and go there.
  useEffect(() => {
    if (!judge || !api) return;
    let alive = true;
    api
      .judgeFork(reset)
      .then(r => {
        if (!alive) return;
        router.replace(`/l/${r.share_code}?judge=1`);
      })
      .catch(err => {
        if (!alive) return;
        if (isFailure(err, 'NOT_IMPLEMENTED'))
          setJudgeNote(
            'The judge letter is not available yet on this build (the judge seed lands with Prompt 6). Start a letter on 2026-17902 below instead.',
          );
        else setJudgeNote(`Could not prepare the judge letter: ${describeError(err)}`);
      });
    return () => {
      alive = false;
    };
  }, [judge, reset, api, router]);

  // Search with a small debounce; the count line comes from the same response.
  useEffect(() => {
    if (!api) return;
    const seq = ++requestSeq.current;
    const t = window.setTimeout(
      () => {
        setLoading(true);
        api
          .rules({ query: query.trim() || undefined, limit: 8 })
          .then(r => {
            if (seq !== requestSeq.current) return;
            setResult(r);
            setSearchError(null);
          })
          .catch(err => {
            if (seq !== requestSeq.current) return;
            setSearchError(describeError(err));
          })
          .finally(() => {
            if (seq === requestSeq.current) setLoading(false);
          });
      },
      query ? 300 : 0,
    );
    return () => window.clearTimeout(t);
  }, [api, query]);

  const start = async (document_number: string) => {
    if (!api) return;
    setStarting(document_number);
    try {
      const r = await api.createLetter(document_number);
      router.push(`/l/${r.share_code}`);
    } catch (err) {
      pushToast(describeError(err), { tone: 'error' });
      setStarting(null);
    }
  };

  const total = result?.open_total ?? null;
  const asOf = result ? clock(result.as_of) : '';

  return (
    <>
      <TopBar viewer={viewer} returnTo="/" />
      <ToolRail status={rail} />
      <main className="page">
        {judge ? <div className="banner">{judgeNote ?? 'Preparing…'}</div> : null}
        <div className="home">
          <section aria-labelledby="open-title">
            <h1 className="card-title" id="open-title">
              {total !== null
                ? `${total} rules the government wants to change are open for your response today`
                : 'Rules the government wants to change, open for your response'}
            </h1>
            <p className="provenance" style={{ marginTop: 4 }}>
              Proposed rules with an open comment period · Federal Register
              {asOf ? ` · as of ${asOf} (cached 15 min)` : ''}
              {result?.stale
                ? ' · federalregister.gov was unreachable; showing the last cached list'
                : ''}
            </p>
            <p className="muted">{APP_DESCRIPTION}</p>
            <label className="sr-only" htmlFor="rule-search">
              Search open rules
            </label>
            <input
              id="rule-search"
              type="search"
              placeholder="Search by topic, agency or document number (e.g. bicycle, 2026-17902)"
              value={query}
              onChange={e => setQuery(e.target.value)}
              style={{ width: '100%', margin: '8px 0 12px' }}
            />
            {searchError ? (
              <div className="banner banner-error">
                Could not reach federalregister.gov ({searchError}).
              </div>
            ) : null}
            {result && result.rules.length === 0 && !loading ? (
              <p className="muted">
                No open rules match &quot;{query.trim()}&quot;. Try fewer words.
              </p>
            ) : null}
            {result?.refine ? (
              <p className="muted small">
                {result.refine.question}{' '}
                {result.refine.options.map(o => (
                  <button
                    key={o.agency_slug}
                    type="button"
                    className="btn btn-quiet btn-sm"
                    onClick={() => setQuery(o.name)}
                  >
                    {o.name} ({o.count})
                  </button>
                ))}
              </p>
            ) : null}
            <div aria-busy={loading}>
              {result?.rules.map(r => (
                <div className="rule-row" key={r.document_number}>
                  <div>
                    <div className="rule-row-title">{r.title}</div>
                    <div className="rule-row-meta">
                      <span>{r.agency}</span>
                      <span className="mono">{r.document_number}</span>
                      <DeadlineChip
                        comments_close_on={r.comments_close_on}
                        days_left={r.days_left}
                      />
                      <span>
                        {r.pages} page{r.pages === 1 ? '' : 's'}
                      </span>
                      {r.matched_by ? (
                        <span className="chip chip-muted">
                          matched by {r.matched_by.replace('_', ' ')}
                        </span>
                      ) : null}
                      {!r.comment_url ? (
                        <span className="chip chip-muted">
                          comments by mail or email (see ADDRESSES)
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={starting !== null}
                    onClick={() => void start(r.document_number)}
                  >
                    {starting === r.document_number ? 'Starting…' : 'Start a letter'}
                  </button>
                </div>
              ))}
              {loading && !result ? <p className="muted">Loading the open rules…</p> : null}
            </div>
          </section>

          <aside className="card" aria-labelledby="outline-title">
            <h2 className="card-title" id="outline-title">
              Your response (a public comment)
            </h2>
            <p className="muted">
              No rule attached. Pick a rule on the left, or ask your agent:{' '}
              <span className="mono">find_open_rules → open_rule</span>.
            </p>
            <ul className="outline">
              <li>The rule you are responding to</li>
              <li>
                Claims: a sentence quoted from the rule, verified by this page · your position ·
                your point · the change you ask for
              </li>
              <li>Signers, each under their own ChatGPT identity, with an impact statement</li>
              <li>
                Export as text; you file it yourself on regulations.gov. {APP_NAME} never files.
              </li>
            </ul>
            <p className="muted small" style={{ marginBottom: 0 }}>
              Want the 60-second tour without an agent?{' '}
              <Link href="/?judge=1">Open the judge letter</Link>.
            </p>
          </aside>
        </div>
        <AgentsSection />
      </main>
    </>
  );
}
