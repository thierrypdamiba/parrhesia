# HTTP API contract

Frozen for the parallel lanes. Sources: `docs/PLAN.md` P1 (identity), P2 (rules), P3 (letters),
P6 (judge). Types live in `server/types.ts`; tool schemas in `src/webmcp/schema.ts`.

## Conventions

- All routes live under `app/api/**/route.ts` (Next app router on Workers). Handlers read
  `env` from `server/env.ts` and call `migrate(env)` before touching D1.
- JSON in, JSON out. Errors are `{error, hint, ...extra}` (`ApiError`) with the status codes
  below. Never a stack trace; the catch-all is `500 {error:'INTERNAL', hint}`.
- Every body is validated against a closed key set. Any unknown key →
  `400 {error:'UNKNOWN_FIELD', hint:'<key> is not accepted'}`. No body ever carries a signer
  name, display name, user id or email; identity comes from the session only.
- Field lengths and enums are exactly the tool schemas (`src/webmcp/schema.ts`): quote 20–600,
  assertion 20–600, requested_change ≤400, evidence ≤400, impact text 40–800, edit text 1–600,
  position ∈ support|oppose|modify, field ∈ quote|assertion|requested_change|evidence|position.
  Violations → `400 {error:'INVALID', hint:'<field>: <what is wrong>'}`.
- `base_rev` is the first 12 hex of the letter's `rev_hash`; compared by prefix. Every content
  write requires it; a mismatch is `409 STALE_REVISION {current_rev, changed_since:[…]}`.
- Actor: header `x-docket-actor: agent` → `agent-of:<display_name|anon>`; anything else →
  `human:<display_name|anon>`. The page sends `agent` only from tool executes.
- Identity headers (`oai-authenticated-user-email`, `oai-authenticated-user-full-name`), the
  `docket_session` cookie, or the dev cookie are accepted on every `/api` route
  (`server/identity.ts getViewer`). Every response may append `Set-Cookie` for `docket_owner`
  (anonymous ownership) and `docket_session` (when `DOCKET_SESSION_SECRET` is set).
- Permission: `can_edit` = letter owner (owner cookie hash or owner user id) OR request arrived
  via the share code. Public token = read only. Owner-only actions say so below.
- Held gestures send `hold_ms`; accept/sign/delete/undo require `hold_ms ≥ 700` else
  `400 HOLD_REQUIRED`. This is a consistency check, not a security boundary.
- Rate limits (per hour per IP, D1 `ratelimit` upsert): judge forks 30, letters 60,
  proposals 120, binds 60, reads 600 → `429 {error:'RATE_LIMITED', hint}`.
- Timestamps ISO-8601 UTC. Dates `YYYY-MM-DD`. `days_left` counts calendar days from today in
  `America/New_York`; negative when closed. `closed` = `comments_close_on < today (NY)`.

## Health and identity

### `GET /api/health`

`{ok:true, db:boolean, migrations:string[], fr_api?:number, now}`.

### `GET /api/me`

`{signed_in, display_name, user_id|null, return_to?}`. Never contains the email. When a
`docket_return` cookie is present, `return_to` is returned once and the cookie is cleared; the
SPA root navigates there.

### `GET /api/signin?return_to=/l/…`

Sets `docket_return` (same-origin path only) and `302 → /signin-with-chatgpt`.

**Local dev shim (verified 2026-09-03 against `@openai/sites-vite-plugin`):** the Vite
middleware strips every incoming `oai-authenticated-user-*` header (curl with those headers
always reads as anonymous in dev), and injects `oai-authenticated-user-id`, `-email`,
`-full-name` and `-full-name-encoding: percent-encoded-utf-8` only after its own cookie flow:
`GET /signin-with-chatgpt?return_to=/l/…` (302 back to `return_to`; local user `Seedy`,
`seedy@sites.test`) and `GET /signout-with-chatgpt`. `getViewer` percent-decodes the name when
the encoding header says so. Production header behaviour is recorded by Prompt 0 (PROBE.md).

### `GET /dev/signin?name=Maya[&return_to=…]`, `GET /dev/signout`

Only when `env.DEV_IDENTITY === '1'`; otherwise `404`. Sets/clears `docket_dev_identity`.
Dev users get `user_id = sha256('dev:' + lowercased name)`.

## Rules (P2)

### `GET /api/rules?query=&agency_slug=&closing_within_days=&limit=`

```
200 {as_of, open_total, count, rules: OpenRule[], refine?: {question, facet:'agency', options:[{agency_slug,name,count}]}, stale?:true}
```

`OpenRule` = `{document_number, title≤90, agency≤40, agency_slug, comments_close_on, days_left,
docket_id, document_id, comment_url|null, pages, html_url, matched_by?}`. Empty results are
`count:0, rules:[]` (never an error; the tool maps that to `NO_MATCH`). Upstream failure with a
stale cache → 200 with `stale:true`; without → `503 UPSTREAM_UNAVAILABLE`.

### `GET /api/rules/:document_number`

Rule header (`RuleHeader` without text) from `rules_cache` or federalregister.gov.
Errors: `404 NOT_FOUND`, `409 NOT_OPEN`, `502 RULE_UNAVAILABLE {html_url}`, `413 RULE_TOO_LARGE`.

### `GET /api/rules/:document_number/text[?start=&window=&query=&max_passages=]`

Without params: the full normalized text as `text/plain; charset=utf-8` with
`ETag: "<text_sha256>"` and `Cache-Control: public, max-age=86400, immutable`; `304` on
`If-None-Match`. With params: `{document_number, total_chars, first_page, pages, matches_total,
passages:[{start,end,page,text}]}` (JSON). Errors as above.

### `GET /api/rules/:document_number/meta`

`{document_number, total_chars, first_page, pages:[{offset,page}], breaks:[…], toc:[{heading,start}], text_sha256, source_kind, fetched_at}`.

## Letters (P3)

### `POST /api/letters` — body `{document_number?}`

Creates a letter owned by the caller (owner cookie hash + owner user id when signed in). With
`document_number`, binds it in the same request.

```
201 {letter_id, share_code, public_token, rev, rev_no, rule: RuleHeader|null, toc: TocEntry[]}
```

Errors: `404 NOT_FOUND`, `409 NOT_OPEN`, `502 RULE_UNAVAILABLE {html_url}`, `413 RULE_TOO_LARGE`,
`429 RATE_LIMITED`.

### `POST /api/letters/:id/bind` — body `{document_number}`

Same result shape as create. `409 ALREADY_BOUND {document_number}`, `403 FORBIDDEN` when the
caller cannot edit.

### `GET /api/letters/:id/state?rev=<12hex>`

`{unchanged:true}` when `rev` matches the current revision, else `LetterState`
(`server/types.ts`): `{letter:{id, share_code*, public_token, rev, rev_hash, rev_no, is_judge_copy,
created_at, updated_at, rule_sha256}, rule: RuleHeader|null, claims: Claim[], signers:
StateSigner[], pending: PendingProposal[], missing: string[], activity: ActivityLine[] (20,
newest first), viewer:{signed_in, display_name, is_signer, can_edit}, closed, days_left}`.
Never embeds rule text. `*share_code` is omitted when the caller cannot edit. `404 NO_LETTER`.

### `GET /api/letters/by-share/:share_code`, `GET /api/letters/by-public/:public_token`

Resolve a link to `{letter_id, can_edit}` and set the letter's owner cookie relationship for
the share path. `404 NO_LETTER`.

### `POST /api/letters/:id/read` — body `{query?, start?, window?, max_passages?, readonly?}`

`readPassages` over the bound rule text:

```
200 {document_number, rev, total_chars, matches_total, passages:[{start,end,page,text}]}
```

Writes an activity row only when the actor is `agent-of:*` and `readonly` is not true (the
public page always sends `readonly:true`). Errors: `404 NO_RULE`, `404 NO_MATCH {hint: 'no
passage matches "…"; headings: SUMMARY, DATES, …'}`, `400 OUT_OF_RANGE {total_chars}`.

### `POST /api/letters/:id/verify` — body `{quote}`

No state change. `200 {anchor:{start,end,page,unique,occurrences}, normalized_quote}` or
`422 ANCHOR_NOT_FOUND {nearest:[{score,start,end,page,text}]×3}` or
`422 ANCHOR_AMBIGUOUS {occurrences:[{start,end,page}]}`. `404 NO_RULE`.

### `POST /api/letters/:id/proposals`

Body by kind (closed key sets):

- `{base_rev, kind:'claim', quote, position, assertion, requested_change?, evidence?}`
- `{base_rev, kind:'edit', claim_id, field, text}`
- `{base_rev, kind:'impact', text}` — requires a signed-in session; `proposed_for_user_id` is
  the session user; never accepts a name or id in the body.

```
201 {proposal_id, status:'pending', base_rev, kind, claim_id?, field?, anchor?, diff?, payload, pending_count}
```

Errors: `400 INVALID`, `400 UNKNOWN_FIELD`, `401 NOT_SIGNED_IN` (impact), `403 FORBIDDEN`,
`404 NO_RULE`, `404 UNKNOWN_CLAIM`, `409 STALE_REVISION {current_rev, changed_since}`,
`409 COMMENTS_CLOSED {comments_close_on}`, `409 ALREADY_PENDING` (one pending impact per user),
`409 NO_CHANGE` (edit text equals current), `409 LIMIT` (>40 claims), `422 ANCHOR_NOT_FOUND
{nearest}`, `422 ANCHOR_AMBIGUOUS {occurrences}`, `429 PENDING_LIMIT` (>5 pending),
`429 RATE_LIMITED`. `ANCHOR_NOT_READ` is page-side only (read-range allowlist); the server
verifies substring only.

### `POST /api/letters/:id/proposals/:pid/decide` — body `{decision:'accept'|'reject', hold_ms?}`

Accept applies the proposal as a new revision: `claim`/`impact` add against the current
revision; `edit` re-checks that the target field still equals its value at `base_rev`, else
the proposal is marked `stale` and `409 STALE_PROPOSAL {field, was, now, by}` is returned.
Accept requires `hold_ms ≥ 700` (`400 HOLD_REQUIRED`). Impact proposals can be accepted only by
the user they are for (`403 FORBIDDEN {hint:'Only <display_name> can accept this'}`).

```
200 {proposal_id, status:'accepted'|'rejected', rev, rev_no, claim_id?}
```

Errors: `404 UNKNOWN_PROPOSAL`, `409 STALE_REVISION` (concurrent write), `403 FORBIDDEN`.

### `POST /api/letters/:id/claims` — body `{base_rev, quote, position, assertion, requested_change?, evidence?}`

Human "Add claim by hand". The quote is verified the same way; an unverified quote is allowed
and stored as `anchor_status:'unverified'` with `nearest` returned for the card.

```
201 {claim: Claim, rev, rev_no, nearest?: NearestPassage[]}
```

### `PATCH /api/letters/:id/claims/:cid` — body `{base_rev, field, text}`

Human inline edit. Quote edits are re-verified (unverified allowed, flagged). Marks any pending
edit proposal on that field `stale`. `200 {claim, rev, rev_no, nearest?}`. `404 UNKNOWN_CLAIM`.

### `DELETE /api/letters/:id/claims/:cid` — body `{base_rev, hold_ms}`

`200 {rev, rev_no}`. `400 HOLD_REQUIRED`.

### Signers (all require a signed-in session → else `401 NOT_SIGNED_IN`)

- `POST /api/letters/:id/signers/me` — `{base_rev}` → adds the session user with the session
  display name. `409 ALREADY_SIGNER`, `409 SIGNER_LIMIT` (25).
- `PATCH /api/letters/:id/signers/me` — `{base_rev, impact_text}` (≤800; empty clears).
- `PATCH /api/letters/:id/signers/me/display_name` — `{base_rev, display_name}` (human UI only;
  sanitized ≤40 `[A-Za-z0-9 .'-]`; the only route that accepts a name, and only for oneself).
- `POST /api/letters/:id/signers/me/sign` — `{base_rev, hold_ms}` → sets `signed_at`.
- `DELETE /api/letters/:id/signers/me` — `{base_rev}` → removes oneself.
- `DELETE /api/letters/:id/signers/:user_id` — `{base_rev, hold_ms}` → owner removes a signer
  (P8; `403 FORBIDDEN` otherwise).
  All return `200 {signers: StateSigner[], rev, rev_no}`; `404 NOT_SIGNER` when absent.

### `POST /api/letters/:id/undo` — body `{base_rev, hold_ms}`

Writes a new revision equal to snapshot `rev_no − 1`. `200 {rev, rev_no}`.
`409 NO_CHANGE` when at rev_no 1.

### `GET /api/letters/:id/export.txt`

`text/plain; charset=utf-8`. Header lines (title, document number, agency, docket, closing
date); each claim as
`N. [Position] Quoting page <page>: "<quote>" — [claimant's words] <assertion> Requested change: [claimant's words] <requested_change> (Evidence: [claimant's words] …)`,
unverified quotes marked `[QUOTE NOT VERIFIED]`; `Signed by:` with display names, impact
statements and times; the disclosure footer from PLAN.md section 5 (uses `APP_NAME`).

## Judge (P6)

### `POST /api/judge/fork` — body `{reset?: boolean}`

Reuses the letter named by the `docket_judge` cookie unless `reset`; else forks the seed.
`200 {letter_id, share_code, reused:boolean}`. `501 NOT_IMPLEMENTED` until P6 lands.
Own rate bucket (30/hour/IP).

## Atomic write recipe (4.4)

Every content change is one `env.DB.batch([...])` whose FIRST statement is
`INSERT INTO revisions (letter_id, rev_no, rev_hash, snapshot_json, actor, action, created_at) VALUES (?, <current rev_no>+1, …)`;
a concurrent writer collides on the PK and D1 rolls the whole batch back. Then
`UPDATE letters SET rev_no=?, rev_hash=?, updated_at=? WHERE id=? AND rev_no=?`, the content
statements, and the `activity` insert. Catch the constraint error → `409 STALE_REVISION`.
