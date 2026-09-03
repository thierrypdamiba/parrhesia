'use client';

// Rule pane (PLAN.md 2.2 item 2, P4): the normalized text fetched once (immutable), rendered
// as paragraphs split at the stored break offsets (offsets unchanged, so anchors still map),
// <h4> headings from the TOC, a page-number gutter, green anchor highlights with claim badges,
// light-blue shading over what the agent read, a client-side find box, "jump to anchor", and
// lazy per-section rendering above 200K chars. All text is rendered as text nodes.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { describeError, getApi, type RuleMeta } from '@/lib/client/api';
import { clock, cx, num } from '@/lib/client/format';
import type { AnchorStatus } from '@/server/types';

/**
 * A range the agent read through `read_rule` this page session (light-blue shading, "read by
 * agent 14:03"). The WebMCP layer owns the ranges (src/webmcp/readRanges.ts, exposed as
 * `RailStatus.readRanges`); the page only renders them.
 */
export interface AgentRead {
  start: number;
  end: number;
  /** ISO timestamp of the read. */
  at: string;
}

export interface AnchorMark {
  id: string;
  n: number;
  start: number;
  end: number;
  status: AnchorStatus;
}

export interface RulePaneProps {
  documentNumber: string;
  anchors: readonly AnchorMark[];
  reads: readonly AgentRead[];
  /** Bump `nonce` to scroll to the anchor of claim `id`. */
  jump: { id: string; nonce: number } | null;
}

export const LAZY_THRESHOLD = 200_000;
const HEADING_MAX = 90;
const FIND_MAX = 300;

interface RuleDoc {
  meta: RuleMeta;
  text: string;
}

const docCache = new Map<string, Promise<RuleDoc>>();

function loadDoc(document_number: string): Promise<RuleDoc> {
  let p = docCache.get(document_number);
  if (!p) {
    p = getApi().then(api =>
      Promise.all([api.ruleMeta(document_number), api.ruleText(document_number)]).then(
        ([meta, text]) => ({
          meta,
          text,
        }),
      ),
    );
    docCache.set(document_number, p);
    p.catch(() => docCache.delete(document_number));
  }
  return p;
}

interface Para {
  start: number;
  end: number;
  /** Heading text when the paragraph starts a TOC section. */
  heading: string | null;
  /** True when the paragraph *is* the heading (short), false when the heading labels a long paragraph. */
  isHeadingPara: boolean;
  /** Page number that begins inside this paragraph (last one when several). */
  pageStart: number | null;
  /** Page the paragraph starts on. */
  page: number;
  section: number;
}

function buildParas(doc: RuleDoc): Para[] {
  const { meta, text } = doc;
  const cuts = Array.from(
    new Set([0, ...meta.breaks.filter(b => b > 0 && b < text.length), text.length]),
  ).sort((a, b) => a - b);
  const tocByStart = new Map(meta.toc.map(t => [t.start, t.heading]));
  const tocStarts = meta.toc.map(t => t.start).sort((a, b) => a - b);
  const pages = [...meta.pages].sort((a, b) => a.offset - b.offset);
  const out: Para[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const start = cuts[i];
    const end = cuts[i + 1];
    if (end <= start) continue;
    const heading = tocByStart.get(start) ?? null;
    let page = meta.first_page;
    for (const p of pages) if (p.offset <= start) page = p.page;
    let pageStart: number | null = null;
    for (const p of pages)
      if (p.offset >= start && p.offset < end && p.offset > 0) pageStart = p.page;
    if (start === 0) pageStart = meta.first_page;
    let section = 0;
    for (let s = 0; s < tocStarts.length; s++) if (tocStarts[s] <= start) section = s + 1;
    out.push({
      start,
      end,
      heading,
      isHeadingPara: heading !== null && end - start <= HEADING_MAX,
      pageStart,
      page,
      section,
    });
  }
  return out;
}

interface Layer {
  start: number;
  end: number;
  anchor?: AnchorMark;
  read?: AgentRead;
  find?: boolean;
  current?: boolean;
}

function renderPara(text: string, p: Para, layers: readonly Layer[]): ReactNode[] {
  const inside = layers.filter(l => l.start < p.end && l.end > p.start);
  if (inside.length === 0) return [text.slice(p.start, p.end)];
  const cutSet = new Set<number>([p.start, p.end]);
  for (const l of inside) {
    cutSet.add(Math.max(p.start, l.start));
    cutSet.add(Math.min(p.end, l.end));
  }
  const cuts = Array.from(cutSet).sort((a, b) => a - b);
  const nodes: ReactNode[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const a = cuts[i];
    const b = cuts[i + 1];
    if (b <= a) continue;
    const covering = inside.filter(l => l.start <= a && l.end >= b);
    const anchor = covering.find(l => l.anchor)?.anchor;
    const read = covering.find(l => l.read)?.read;
    const find = covering.some(l => l.find);
    const current = covering.some(l => l.current);
    const slice = text.slice(a, b);
    const classes = [
      read ? 'read' : '',
      find ? 'find-hit' : '',
      current ? 'find-current' : '',
    ].filter(Boolean);
    const readLabel =
      read && a === read.start ? (
        <span className="read-label" aria-label={`read by agent ${clock(read.at)}`}>
          read by agent {clock(read.at)}
        </span>
      ) : null;
    if (anchor) {
      const isStart = a === anchor.start;
      nodes.push(
        <mark
          key={a}
          id={isStart ? `anchor-${anchor.id}` : undefined}
          className={cx('anchor', anchor.status === 'unverified' && 'unverified', ...classes)}
          title={`claim ${anchor.n} · ${anchor.start}–${anchor.end}`}
        >
          {isStart ? <span className="anchor-badge">{anchor.n}</span> : null}
          {readLabel}
          {slice}
        </mark>,
      );
    } else if (classes.length) {
      nodes.push(
        <span key={a} id={current ? 'find-current' : undefined} className={classes.join(' ')}>
          {readLabel}
          {slice}
        </span>,
      );
    } else {
      nodes.push(slice);
    }
  }
  return nodes;
}

export function RulePane({ documentNumber, anchors, reads, jump }: RulePaneProps) {
  const [doc, setDoc] = useState<RuleDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState('');
  const [current, setCurrent] = useState(0);
  const [open, setOpen] = useState<Set<number>>(() => new Set([0, 1]));
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    loadDoc(documentNumber)
      .then(d => {
        if (!alive) return;
        setDoc(d);
        setError(null);
      })
      .catch(err => {
        if (alive) setError(describeError(err));
      });
    return () => {
      alive = false;
    };
  }, [documentNumber, attempt]);

  const paras = useMemo(() => (doc ? buildParas(doc) : []), [doc]);
  const lazy = !!doc && doc.text.length > LAZY_THRESHOLD;

  const matches = useMemo(() => {
    if (!doc || query.trim().length < 2) return [] as Array<{ start: number; end: number }>;
    const hay = doc.text.toLowerCase();
    const needle = query.trim().toLowerCase();
    const out: Array<{ start: number; end: number }> = [];
    let idx = hay.indexOf(needle);
    while (idx >= 0 && out.length < FIND_MAX) {
      out.push({ start: idx, end: idx + needle.length });
      idx = hay.indexOf(needle, idx + needle.length);
    }
    return out;
  }, [doc, query]);

  const layers = useMemo<Layer[]>(() => {
    const out: Layer[] = [];
    for (const a of anchors) out.push({ start: a.start, end: a.end, anchor: a });
    for (const r of reads) out.push({ start: r.start, end: r.end, read: r });
    matches.forEach((m, i) =>
      out.push({ start: m.start, end: m.end, find: true, current: i === current }),
    );
    return out;
  }, [anchors, reads, matches, current]);

  const sectionOf = useCallback(
    (offset: number): number => {
      if (!doc) return 0;
      let s = 0;
      const starts = doc.meta.toc.map(t => t.start).sort((a, b) => a - b);
      for (let i = 0; i < starts.length; i++) if (starts[i] <= offset) s = i + 1;
      return s;
    },
    [doc],
  );

  const scrollTo = useCallback((id: string, flash = false) => {
    let tries = 0;
    const attemptScroll = () => {
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        if (flash) {
          el.classList.remove('flash');
          void el.getBoundingClientRect();
          el.classList.add('flash');
        }
        return;
      }
      if (tries++ < 5) requestAnimationFrame(attemptScroll);
    };
    requestAnimationFrame(attemptScroll);
  }, []);

  // Sections that must be visible right now (lazy mode): the jump target and the current find hit.
  const jumpTarget = jump ? (anchors.find(x => x.id === jump.id) ?? null) : null;
  const findTarget = matches.length ? (matches[current] ?? null) : null;
  const effectiveOpen = useMemo(() => {
    if (!lazy) return open;
    const s = new Set(open);
    if (jumpTarget) s.add(sectionOf(jumpTarget.start));
    if (findTarget) s.add(sectionOf(findTarget.start));
    return s;
  }, [lazy, open, jumpTarget, findTarget, sectionOf]);

  // Jump to anchor from a claim card (DOM only; the section is opened by effectiveOpen).
  const jumpNonce = jump?.nonce ?? 0;
  const jumpId = jumpTarget?.id ?? null;
  useEffect(() => {
    if (!jumpId || !doc) return;
    scrollTo(`anchor-${jumpId}`, true);
  }, [jumpNonce, jumpId, doc, scrollTo]);

  // Keep the current find hit in view.
  const findStart = findTarget?.start ?? -1;
  useEffect(() => {
    if (findStart < 0) return;
    scrollTo('find-current');
  }, [findStart, scrollTo]);

  const onToc = (value: string) => {
    if (!value) return;
    const start = Number(value);
    if (lazy) setOpen(prev => new Set(prev).add(sectionOf(start)));
    scrollTo(`sec-${start}`);
  };

  if (error) {
    return (
      <div className="rule-pane">
        <div className="banner banner-error" style={{ margin: 12 }}>
          <span>
            Could not load the rule text from federalregister.gov ({error}) —{' '}
            <button type="button" className="btn btn-sm" onClick={() => setAttempt(a => a + 1)}>
              retry
            </button>
          </span>
        </div>
      </div>
    );
  }

  if (!doc) {
    return (
      <div className="rule-pane">
        <div className="rule-toolbar muted">Loading the rule text…</div>
      </div>
    );
  }

  const { meta } = doc;
  const lastPage = meta.pages.length ? meta.pages[meta.pages.length - 1].page : meta.first_page;
  const sections: Array<{ index: number; heading: string; paras: Para[] }> = [];
  for (const p of paras) {
    let s = sections[sections.length - 1];
    if (!s || s.index !== p.section) {
      s = {
        index: p.section,
        heading: p.section === 0 ? 'Preamble' : (meta.toc[p.section - 1]?.heading ?? ''),
        paras: [],
      };
      sections.push(s);
    }
    s.paras.push(p);
  }

  return (
    <div className="rule-pane" aria-label="Rule text">
      <div className="rule-toolbar">
        <span className="mono muted" title="Rule text served by this page from federalregister.gov">
          {documentNumber} · {num(doc.text.length)} chars · pp. {meta.first_page}–{lastPage}
        </span>
        <select
          aria-label="Jump to a section"
          defaultValue=""
          onChange={e => onToc(e.target.value)}
        >
          <option value="">Contents…</option>
          {meta.toc.map(t => (
            <option key={t.start} value={t.start}>
              {t.heading}
            </option>
          ))}
        </select>
        <div className="find">
          <input
            type="search"
            aria-label="Find in the rule text"
            placeholder="Find in rule…"
            value={query}
            onChange={e => {
              setQuery(e.target.value);
              setCurrent(0);
            }}
            onKeyDown={e => {
              if (e.key === 'Enter' && matches.length) {
                e.preventDefault();
                setCurrent(c =>
                  e.shiftKey ? (c - 1 + matches.length) % matches.length : (c + 1) % matches.length,
                );
              }
            }}
          />
          {query.trim().length >= 2 ? (
            <span className="mono muted" aria-live="polite">
              {matches.length
                ? `${current + 1} of ${matches.length}${matches.length >= FIND_MAX ? '+' : ''}`
                : 'no match'}
            </span>
          ) : null}
          <button
            type="button"
            className="btn btn-sm"
            aria-label="Previous match"
            disabled={!matches.length}
            onClick={() => setCurrent(c => (c - 1 + matches.length) % matches.length)}
          >
            ↑
          </button>
          <button
            type="button"
            className="btn btn-sm"
            aria-label="Next match"
            disabled={!matches.length}
            onClick={() => setCurrent(c => (c + 1) % matches.length)}
          >
            ↓
          </button>
        </div>
      </div>
      <div className="rule-scroll" ref={scrollRef}>
        <div className="rule-text">
          {sections.map(sec => {
            const isOpen = !lazy || effectiveOpen.has(sec.index);
            const chars = sec.paras.reduce((n, p) => n + (p.end - p.start), 0);
            if (!isOpen) {
              return (
                <div key={sec.index}>
                  <h4
                    id={sec.paras[0]?.heading !== null ? `sec-${sec.paras[0].start}` : undefined}
                    className="rule-para"
                  >
                    <span className="rule-gutter" />
                    <span className="rule-body">{sec.heading}</span>
                  </h4>
                  <button
                    type="button"
                    className="btn btn-sm rule-section-toggle"
                    onClick={() => setOpen(prev => new Set(prev).add(sec.index))}
                  >
                    Show section · {num(chars)} chars
                  </button>
                </div>
              );
            }
            return sec.paras.map(p => {
              const body = renderPara(doc.text, p, layers);
              const gutter = (
                <span
                  className={cx('rule-gutter', p.pageStart !== null && 'is-new-page')}
                  aria-label={`page ${p.pageStart ?? p.page}`}
                >
                  {p.pageStart ?? p.page}
                </span>
              );
              if (p.isHeadingPara) {
                return (
                  <h4 key={p.start} id={`sec-${p.start}`} className="rule-para">
                    {gutter}
                    <span className="rule-body">{body}</span>
                  </h4>
                );
              }
              return (
                <div key={p.start}>
                  {p.heading !== null ? (
                    <h4 id={`sec-${p.start}`} className="rule-para">
                      <span className="rule-gutter" />
                      <span className="rule-body">{p.heading}</span>
                    </h4>
                  ) : null}
                  <p className="rule-para" data-start={p.start}>
                    {gutter}
                    <span className="rule-body">{body}</span>
                  </p>
                </div>
              );
            });
          })}
        </div>
      </div>
    </div>
  );
}
