# Parrhesia

_Parrhesia_ (Greek, παρρησία): frank speech — the citizen's right, and duty, to say the true
thing to power.

**Speak up for your rights. Your agent brings the receipts.**

When the government is about to change a rule that affects you, it has to ask the public first.
Parrhesia lets you and your agent write that response together: the agent reads the fine print,
you say what should change, and only you sign. Every quote the agent proposes is checked by the
page against the rule text the page itself served; a paraphrase is refused with the three nearest
real passages. Parrhesia never files anything: you paste the finished letter into regulations.gov
yourself.

A WebMCP Challenge entry. New project created during the Submission Period; first commit
2026-09-03. MIT licensed (see `LICENSE`).

## Plain words first

- a rule the government wants to change → a _proposed rule_
- the government's daily journal where it publishes them → the _Federal Register_
- the window when anyone can respond → the _comment period_
- your response → a _public comment_
- the site where you file it → _regulations.gov_

## Run locally

```bash
npm install
cp .env.example .env        # DEV_IDENTITY=1 enables /dev/signin?name=Maya locally
npm run dev -- --port 3101  # vinext (Next.js app router) on the Cloudflare Workers runtime with local D1
curl -s localhost:3101/api/health
```

`npm run check` runs typecheck, lint, prettier, the node:test suite, the tool-doc drift check and
the build. No API keys and no secrets are needed; the only optional variable is
`DOCKET_SESSION_SECRET` for the identity-cookie fallback.

## How WebMCP is used

Eight imperative tools are registered on the top-level page with
`document.modelContext.registerTool` (`navigator.modelContext` fallback). The table below is
generated from the tool definitions in `src/webmcp/schema.ts` by `npm run tools:doc`
(`npm run tools:doc:write` regenerates; the check exits non-zero on drift). The full section,
including the state machine and host notes, is `docs/TOOLS.md`, and the same text is rendered on
the page under "How agents use this site".

<!-- tools:begin -->

| #   | Tool                 | Title                                                                                  | Purpose                                                                                                                                                                                                                                                                           | readOnlyHint                                                            | untrustedContentHint                                                 | Appears when                                                           | Key errors                                                                                                                                    |
| --- | -------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `find_open_rules`    | Find proposed rules open for comment                                                   | Search Federal Register proposed rules that are open for public comment today.                                                                                                                                                                                                    | true (searches federalregister.gov through the page; writes nothing)    | true (titles and agency names are federalregister.gov text)          | always                                                                 | `NO_MATCH`, `UPSTREAM_UNAVAILABLE`, `RATE_LIMITED`                                                                                            |
| 2   | `open_rule`          | Attach a rule to this letter (one time)                                                | Attach one Federal Register proposed rule to this letter by document number.                                                                                                                                                                                                      | false (creates or binds the letter and stores the rule header)          | true (returns rule headings and summary from federalregister.gov)    | only while the letter is unbound and the viewer may edit; never on /r/ | `ALREADY_BOUND`, `NOT_FOUND`, `NOT_OPEN`, `RULE_UNAVAILABLE`, `RULE_TOO_LARGE`, `FORBIDDEN`, `RATE_LIMITED`                                   |
| 3   | `read_rule`          | Read passages of {document_number} ({total_chars} chars, pp. {first_page}-{last_page}) | Read verbatim passages of the attached rule as the page serves them, with character offsets and Federal Register page numbers.                                                                                                                                                    | true (records which ranges the agent read; changes no letter content)   | true (verbatim third-party rule text)                                | once a rule is bound (workspace and public page)                       | `NO_RULE`, `NO_MATCH`, `OUT_OF_RANGE`                                                                                                         |
| 4   | `propose_claim`      | Propose a claim card (verified quote)                                                  | Propose a claim card: a verbatim quote from the rule, a position, an assertion and a requested change.                                                                                                                                                                            | false (creates a pending proposal that only a held Accept applies)      | true (refusals echo rule passages (third-party text))                | rule bound, comment period open, viewer may edit                       | `ANCHOR_NOT_FOUND`, `ANCHOR_NOT_READ`, `ANCHOR_AMBIGUOUS`, `STALE_REVISION`, `COMMENTS_CLOSED`, `PENDING_LIMIT`, `LIMIT`, `NO_RULE`           |
| 5   | `propose_edit`       | Propose an edit to one claim field                                                     | Propose replacing one field of an existing claim (quote, assertion, requested_change, evidence or position) against the current revision.                                                                                                                                         | false (creates a pending edit proposal that only a held Accept applies) | true (diffs and refusals echo people’s typed text and rule passages) | at least one accepted claim, comment period open, viewer may edit      | `UNKNOWN_CLAIM`, `STALE_REVISION`, `NO_CHANGE`, `ANCHOR_NOT_FOUND`, `ANCHOR_NOT_READ`, `ANCHOR_AMBIGUOUS`, `COMMENTS_CLOSED`, `PENDING_LIMIT` |
| 6   | `draft_my_impact`    | Draft an impact statement for {display_name}                                           | Draft an impact statement for the person who is signed in on this page, describing how the rule affects them.                                                                                                                                                                     | false (creates a pending impact proposal for the signed-in person)      | false (returns only a preview of the text the agent supplied)        | viewer signed in with ChatGPT, rule bound, comment period open         | `NOT_SIGNED_IN`, `STALE_REVISION`, `ALREADY_PENDING`, `COMMENTS_CLOSED`, `NO_RULE`                                                            |
| 7   | `get_letter`         | Read the letter state and checklist                                                    | Read the current letter: revision (use it as base_rev), the bound rule and its deadline, claims with anchor status and previews, signers, pending proposals, the "missing before filing" checklist, the viewer, and which tools can be called now versus not now with the reason. | true (reads state; writes nothing)                                      | true (echoes people’s typed text and rule quotes)                    | always                                                                 | `NO_LETTER`                                                                                                                                   |
| 8   | `ask_person_to_file` | Ask a person to file the comment on regulations.gov                                    | Ask the person to file this comment.                                                                                                                                                                                                                                              | true (returns links and the checklist; files nothing)                   | false (returns only page-generated links and checklist lines)        | once a rule is bound (workspace only)                                  | `NO_RULE`                                                                                                                                     |

<!-- tools:end -->

### The tool list is a state machine

- **Unbound** — `find_open_rules`, `open_rule`, `get_letter`.
- **Bound, open** — `find_open_rules`, `read_rule`, `propose_claim`, `get_letter`,
  `ask_person_to_file`; plus `propose_edit` once at least one claim is accepted; plus
  `draft_my_impact` when the viewer is signed in with ChatGPT. `open_rule` is gone: "letter is
  bound to 2026-17902".
- **Bound, closed** (`comments_close_on` before today in America/New_York) — `propose_*` and
  `draft_my_impact` disappear with the reason "comment period closed <date>"; reading, export and
  history still work.
- **Public page `/r/…`** — only `get_letter` and `read_rule`; no writes at all.

In Chrome the set is diffed against `getTools()` with per-tool `AbortController`s and the rail
re-renders on `toolchange`. In ChatGPT's browser all eight tools are registered at load and every
gate is enforced inside `execute` (`{error:'NOT_AVAILABLE', hint:<the rail reason>}`); the rail
prints what would succeed now. Both modes are honest and both are printed on the page.

### Deliberately not offered

No tool can: accept or reject a proposal (a held gesture on the page; a click does nothing);
delete a claim; sign or add a signer; write an impact statement for anyone but the signed-in
person (no name field exists in any schema); change the bound rule (`open_rule` unregisters
itself); file on regulations.gov (`ask_person_to_file` always returns `needs_human`); cite text
that is not in the rule (`ANCHOR_NOT_FOUND`) or that it has not read here (`ANCHOR_NOT_READ`, a
page-side grounding discipline, not a security boundary: the server verifies substring only);
propose after comments close.

### Verifier norm-1

The Worker fetches the Federal Register raw text, strips the `<pre>` wrapper, maps typographic
quotes and NBSP, collapses whitespace, and records page and paragraph offsets so anchors map back
to Federal Register page numbers. Quotes get the same mapping plus em/en dash → `--`, `§` →
`Sec.` and footnote markers stripped; a quote must then be an exact substring. Refusals return the
three nearest sentence candidates by Jaccard similarity of word sets. Fixture-pinned numbers for
document 2026-17902 (`test/fixtures/`, `server/normalize.test.ts`, `server/judge.test.ts`):

```
normalized    44,458 chars  first page 56095  sha256 fc22cd12737d1979…
pages         559→56096  8007→56097  15592→56098  24699→56099  32421→56100  39700→56101
Q3 4.30(b)    40935–41136  p.56101  unique   (judge claim 1)
Q1 30 days    20073–20230  p.56098  unique   (judge claim 2)
Q2 superint.  28833–29088  p.56099  unique   (judge pending proposal)
BAD 60 days   not found; nearest 0.696@20073 p.56098 · 0.212@41137 p.56101 · 0.208@19987 p.56098
```

## Data sources (all keyless)

- Federal Register search and facets:
  `https://www.federalregister.gov/api/v1/documents.json?conditions[type][]=PRORULE&conditions[comment_date][gte]=<today>…`
  (literal brackets). The JSON API answers CORS `*`, but `OPTIONS` returns 404, so browsers cannot
  preflight it: every federalregister.gov call goes through the Worker with
  `User-Agent: Parrhesia/1.0 (+<site url>)` (`USER_AGENT` in `lib/app.ts`). Cached 15 minutes in
  D1 `fr_cache`; a stale copy is served with `stale:true` when the upstream fails.
- Document detail: `https://www.federalregister.gov/api/v1/documents/<number>.json`.
- Rule text: `raw_text_url` (no CORS header; Worker only) with retry, then `full_text_xml_url`,
  then `RULE_UNAVAILABLE` with the FR `html_url`. Cap 900,000 normalized chars.
- regulations.gov: `https://www.regulations.gov/commenton/<document_id>` is a human link-out only
  (it answers 403 to anything that is not a browser). About 7% of open rules have no
  regulations.gov form; then the page links to the rule's ADDRESSES section.

## Identity

Sign in with ChatGPT supplies `oai-authenticated-user-email` and `oai-authenticated-user-full-name`
headers. The Worker derives `user_id = sha256(lowercased email)` and a sanitized display name
(≤40 chars, `[A-Za-z0-9 .'-]`, else "Signer"); the email is never stored, returned or shown.
Anonymous visitors get an httpOnly `docket_owner` cookie; letters store its hash. Editing is
allowed for the owner or anyone holding the `/l/{share_code}` link; `/r/{public_token}` is
read-only. No API body ever carries a name or user id (unknown keys are rejected with
`UNKNOWN_FIELD`).

## Host notes

_Placeholder: filled from PROBE.md / Prompt 7 by the integrator._

| Check                                               | Result                 |
| --------------------------------------------------- | ---------------------- |
| Tool mode in ChatGPT's browser (dynamic or static)  | <recorded in Prompt 7> |
| Identity headers present on `fetch()`               | <recorded in Prompt 0> |
| federalregister.gov egress from the Worker          | <recorded in Prompt 0> |
| `target=_blank` and clipboard in the in-app browser | <recorded in Prompt 0> |

The held gesture exists because a host may click page buttons
([webmcp #288](https://github.com/webmachinelearning/webmcp/issues/288)); it raises the cost of
automated clicking and is not proof of a person. The real guarantee is that no accept tool exists.

## Judge path

Open `/?judge=1`. The page calls `POST /api/judge/fork`, which forks a private letter for you from
`seed/2026-17902.json` with the shipped text snapshot (`seed/2026-17902.txt`, source `seed`), and
remembers it in a cookie so a reload returns the same letter; `/?judge=1&reset=1` makes a new one.
The letter contains: claim 1 anchored at 40935–41136, p. 56101 (proposed 36 CFR 4.30(b)); claim 2
anchored at 20073–20230, p. 56098; claim 3 intentionally unverified (the "60 days" paraphrase)
with its three nearest passages; one pending proposal by "Judge demo's agent" to hold-accept; and
a "Try an unverified quote" box that runs the verifier live and prints the JSON verdict.

Sample prompt for an agent: "Attach Federal Register document 2026-17902 (Bicycle Use in Park
Areas) to my letter, read what proposed section 4.30(b) says about designations after notice, and
propose a claim asking for a minimum interval between notice and designation."

## Evals

Files are in the [webmcp-evals](https://www.npmjs.com/package/webmcp-evals) format.

| Command                         | What it does                                                                                                          |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `URL=<url> npm run evals:api`   | `scripts/smoke-letter.mjs`: HTTP walkthrough of the judge letter (fork, verify, propose, accept, stale, hold, export) |
| `URL=<url> npm run evals:smoke` | `webmcp-evals smoke` on `/?judge=1` with `evals/parrhesia.smoke.json` (no LLM; needs Chrome with WebMCP)              |
| `npm run evals:local`           | `webmcp-evals local` with `evals/schema.json` + `evals/parrhesia.evals.json` (needs a Gemini or Vercel AI key)        |
| `npm run evals:schema`          | Regenerates `evals/schema.json` (exactly 8 tools) from `src/webmcp/schema.ts`                                         |

The smoke file omits `open_rule` on purpose: on `/?judge=1` the letter is already bound, so
`open_rule` has unregistered itself and a fresh page per case cannot call it; the full evals file
keeps the "Attach 2026-17902" case for LLM modes.

Results actually run (update this table; say "not run" rather than inventing numbers):

| Run                             | Date       | Result                                                        |
| ------------------------------- | ---------- | ------------------------------------------------------------- |
| `evals:api` against local dev   | 2026-09-03 | fork/reuse steps PASS in lane E; letter routes land in lane B |
| `evals:api` against production  | —          | not run: no deployment yet                                    |
| `evals:smoke` against local dev | —          | not run: needs the page tools from lane D and Chrome Canary   |
| `evals:local` (LLM)             | —          | not run: no key                                               |

Negative case, documented by hand: "Call `propose_claim` with the quote set exactly to 'Written
determinations for existing trails must be published in the Federal Register for 60 days of public
comment.' without checking it first" → `{"error":"ANCHOR_NOT_FOUND", "nearest":[{start:20073, end:20230,
page:56098, score:0.696, …}, {start:41137, …}, {start:19987, …}]}`; the card lands red with the real
30-day sentence first. The same sentence typed into the judge box prints the same JSON.

## Honest limits

- Parrhesia never files. regulations.gov is a human link-out; about 7% of open rules have no
  regulations.gov form, in which case the link goes to the rule's ADDRESSES section.
- The judge letter's rule text is a snapshot from 2026-09-03; live letters fetch the current text.
  `days_left` counts down during judging, and the rule really closes on 2026-11-02.
- 2026-15406 is a sibling rule that ranks first for the query "bicycle"; the sample prompts name
  the document number 2026-17902.
- Assertion, requested change and evidence are the claimant's own words and are labelled so; only
  the quote is verified against the rule.
- The rule pane renders the full text into the DOM, so `read_rule` is the only source of quotes
  the page accepts, not the agent's only way to see the text.
- Host behaviour that depends on ChatGPT's browser is recorded above from real runs, not assumed.

## File map

- `lib/app.ts` — product name, tagline, `USER_AGENT`.
- `src/webmcp/schema.ts` — the eight tool definitions (names, titles, schemas, annotations,
  gates, errors, budgets); `src/webmcp/tools.ts` attaches `execute` and registers them.
- `server/anchor.ts` — `locate`, `nearest`, `readPassages` (the verifier); `server/normalize.ts`
  — norm-1; `server/fr.ts` — Federal Register adapter and caches.
- `server/letter.ts` — revisions, the revisions-first atomic D1 batch, proposals, signers,
  export; `server/judge.ts` — the judge fork; `server/agents-doc.ts` — the on-page agents section
  and `docs/TOOLS.md` source.
- `app/api/**` — HTTP routes (`docs/API.md`); `migrations/0001_init.sql` — D1 schema.
- `seed/` — the judge seed (claims spec, text snapshot, document detail); `test/fixtures/` — the
  frozen normalizer fixture.
- `evals/` — webmcp-evals suites and the exported tool schema; `scripts/smoke-letter.mjs` — the
  HTTP walkthrough.
- `docs/PLAN.md` — the build plan; `docs/PITCH.md` — the plain-language pitch.
