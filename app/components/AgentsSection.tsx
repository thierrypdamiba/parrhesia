// STUB — lane E fills this in (PLAN.md 2.5): (b) the tool table generated from
// src/webmcp/schema.ts, (c) "What tools cannot do", (d) host notes. Paragraph (a) and the
// "Try it" line are kept here so the home and letter pages already read correctly.

import Link from 'next/link';

import { APP_NAME } from '@/lib/app';

export const SAMPLE_PROMPT =
  'Attach Federal Register document 2026-17902 (Bicycle Use in Park Areas) to my letter, read what proposed section 4.30(b) says about designations after notice, and propose a claim asking for a minimum interval between notice and designation.';

export function AgentsSection() {
  return (
    <section className="agents" id="agents" aria-labelledby="agents-title">
      <h2 className="section-title" id="agents-title">
        How agents use this site
      </h2>
      <p>
        This page registers tools with <code>document.modelContext.registerTool</code> (
        <code>navigator.modelContext</code> fallback). <code>read_rule</code> is the only source of
        quotes the page accepts: every anchor records the <code>read_rule</code> call and offsets
        that produced it, so a reader can click from a claim to the passage. The page verifies every
        quote against the same text it served; a person accepts, signs and files. {APP_NAME} never
        files.
      </p>
      <p className="muted small">
        The tool table, what tools cannot do, and host notes appear here once the WebMCP layer
        lands.
      </p>
      <p>
        <b>Try it:</b> open <Link href="/?judge=1">the judge letter</Link> without an agent, or
        paste this into ChatGPT with this page open in its browser:
      </p>
      <pre className="json">{SAMPLE_PROMPT}</pre>
    </section>
  );
}
