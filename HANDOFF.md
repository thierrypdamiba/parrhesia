# Handoff for Codex

Read this first. It says what is built, what is verified, what is unfinished, and what to do next.

## What this is

Parrhesia: a person and their agent co-write a public comment on a live U.S. federal proposed rule.
The page verifies every quoted provision against the rule text it served, co-signers sign in with
ChatGPT, and only a person files (on regulations.gov, by hand). WebMCP Challenge entry; closes
Sep 4 2026 1:00am PT. Full spec: `docs/PLAN.md` (it says "Docket"; the name is Parrhesia via
`lib/app.ts`). Plain-language copy and glossary: `docs/PITCH.md`. Tool table: `docs/TOOLS.md`.

## State of `main` (commit 8e51362)

Green: `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test` (134 tests; one
test, `server/identity.test.ts` "tampered cookie", is flaky about 1 in 16 runs), `npm run tools:doc`,
`npm run build`. Verified on a local dev server (`npx vinext dev`, D1 via the Cloudflare plugin):

- `/api/health` -> `{ok:true, db:true, migrations:["0001_init"], fr_api:200}`
- `/api/rules?query=bicycle` -> 191 rules open today; 2026-17902 present
- `/api/rules/2026-17902/text?start=20000&window=300` -> page 56098, ETag + immutable
- `BASE=<url> scripts/api-walkthrough.sh` -> 48 steps pass, ends at rev_no 3
- `URL=<url> npm run evals:api` -> 11/11
- `/?judge=1` -> forks a private judge letter and redirects to `/l/{share_code}?judge=1`
- Chrome 151 + WebMCP flag: getTools() on the judge letter = ask_person_to_file, find_open_rules,
  get_letter, propose_claim, propose_edit, read_rule; the sequence read_rule -> propose_claim
  (paraphrase) -> ANCHOR_NOT_FOUND with 3 nearest passages -> propose_claim (unread quote) ->
  ANCHOR_NOT_READ -> read_rule -> propose_claim -> pending card works end to end.

Not verified anywhere yet: the hosted deploy, and ChatGPT's in-app browser (static tool mode).

## Deploy (do this first)

1. Sites project from this repo, branch `main`. `.openai/hosting.json` declares `"d1": "DB"`;
   provision D1 and write `project_id` back. No env vars. Do NOT set `DEV_IDENTITY` in production.
2. Save a version, deploy owner-only. Check `<url>/api/health`. If `fr_api` is not 200,
   federalregister.gov is blocking Workers egress: see `docs/PLAN.md` Prompt 7 (client-side JSON
   for search/detail, Worker for raw text, seed snapshot as last resort).
3. Set `SITE_URL` in `lib/app.ts` to the real URL (it drives the Worker User-Agent). Redeploy.
4. In the in-app browser (GPT-5.6 Sol or Terra, site tools enabled), open `<url>/?judge=1` and paste
   the sample prompt from the page's "How agents use this site" section. Record: which tools the
   Site tools menu lists, whether new tools appear after `open_rule` in the same conversation, and
   whether the model got confirmation prompts. Put the answers in `server/agents-doc.ts` HOST_NOTES,
   run `npm run tools:doc:write`, commit.
5. Audience: "Anyone on the internet". Verify `/`, `/?judge=1`, a `/l/...` and a `/r/...` link load
   signed out.

## Unfinished work (branch `wip/review-fixes-and-plain-words-ui`, one test failing)

Reviewer findings that still need fixing on main, in priority order:

1. `server/letter.ts` addClaimByHand / editClaimField: a hand-typed quote that occurs more than
   once is stored as anchored at the first hit. Store it as unverified and return the occurrences so
   the card can say "Ambiguous, occurs N times, quote a longer span". (The agent path already
   refuses with ANCHOR_AMBIGUOUS.)
2. `app/api/letters/[id]/signers/me/route.ts`: POST, PATCH, DELETE must call `requireHuman` so a
   request with `x-docket-actor: agent` cannot add a signer, write an impact directly, or remove a
   signer. Sign and display_name already do this.
3. `server/identity.test.ts`: make the tamper test deterministic (flip a hex digit that is not
   already the replacement).
4. `server/judge.ts`: keep the judge fork's rule row as `source_kind 'seed'` so the banner can say
   "rule text snapshot 2026-09-03"; seed `accepted_by` as `human:Judge demo` so cards do not read
   "accepted by someone".
5. `app/components/Home.tsx`: delete the NOT_IMPLEMENTED branch that mentions "Prompt 6".
6. `README.md`: replace the Host notes placeholder with the HOST_NOTES sentences (or the real
   observations from step 4 above); rewrite "Results actually run" (evals:api 11/11, walkthrough 48
   steps, evals:smoke not run); document `cp .env.example .dev.vars` for local sign-in.
7. Plain-words UI (spec: `docs/PLAIN-WORDS.md`; core library `lib/plain-words.ts` is done and
   tested; export footer line is done). Remaining: the `Plain words · N suggestions` line under
   assertion / requested change / evidence / impact statement, the `plain_words` fields on
   `propose_claim` / `draft_my_impact` / `get_letter` outputs (keep `get_letter` <= 1800 chars),
   the README "Plain words" section, and the credit line on the page and in README: "Writing check
   adapted from unslop by Lauren Tan (poteto), MIT" with the link in `docs/PLAIN-WORDS.md`.
   The wip branch has a partial version of items 1, 2 and 7; `get_letter` test 123 fails there.

Optional hardening the reviewers suggested: word-boundary check in `server/anchor.ts` locate();
JSON bodies for 405/404 on `/api/*`.

## Submission

- Devpost text, testing instructions, and video beats: `docs/PLAN.md` sections 7 and 8, with the
  plain-language wording from `docs/PITCH.md`. Tagline: "Speak up for your rights. Your agent
  brings the receipts." Do not claim anything the hosted URL cannot reproduce.
- The judge path is `<url>/?judge=1` (works without an agent).
- Freeze after the form shows Submitted; the repo, site and video stay unchanged through judging
  (ends Sep 21 5pm PT). Keep building on a fork.
