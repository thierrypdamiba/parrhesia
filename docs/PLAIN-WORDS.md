# Plain words: the writing check

Parrhesia adapts **unslop** by Lauren Tan (poteto), from Cursor's pstack plugin
(https://github.com/cursor/plugins/blob/main/pstack/skills/unslop/SKILL.md, MIT). The original
skill is copied verbatim to `docs/unslop-SKILL.md` for reference; this document says how it is
used here. Credit the author on the page and in the README wherever the check appears.

## Why it is in the product

A public comment is read by a person at an agency. Prose that reads as machine-written gets
discounted the way a form letter does. The claimant's own fields on a claim (assertion, requested
change, evidence) and the impact statement are the person's words, so they should sound like a
person. The quote field is exempt: it is the rule's text and must not change.

## What ships

1. `lib/plain-words.ts` (shared, pure, deterministic; no LLM). Exports:
   - `PLAIN_WORDS_RULES`: a data table derived from the skill's numbered patterns 7, 8, 9, 13,
     14, 19, 20, 22, 23, 24, 26, 30, 31 (the mechanically detectable ones). Each rule:
     `{ id, title, pattern: RegExp | (text) => Match[], fix: string, source: 'unslop §N' }`.
     Word lists come straight from the skill text (AI vocabulary; fancy "is"; filler phrases;
     hedges; abstract metaphor nouns; plain-word swaps; chatbot phrases; sycophancy). Style
     rules: em dash / en dash / hyphen-as-dash, mid-sentence colon, curly quotes, "not just X but
     Y", adverbs on weak verbs (a short list: quickly, significantly, seamlessly, effectively,
     truly, really, very).
   - `checkPlainWords(text): { flags: Flag[]; score: number }` where `Flag = { rule_id, title,
start, end, excerpt, fix, source }`, `score` = flags per 100 words (0 is clean). Case
     insensitive; word boundaries; never flags inside a quoted span (text between straight or
     curly double quotes) so quoted rule text is never touched.
   - `PLAIN_WORDS_GUIDE`: a ≤600-char string for agents, derived from the skill's "Adding soul"
     and "Plain speech" sections: write in the first person when it fits; one idea per
     sentence; say what the rule does to you, with a number or a place; no em dashes; no
     "not just X but Y"; no filler; name the mechanism, not the feeling.
   - `CREDIT`: `{ name: 'unslop', author: 'Lauren Tan (poteto)', url, license: 'MIT' }`.
     Tests: every rule fires on its own example from the skill and is silent on a clean sentence;
     the quote exemption holds; the guide is ≤600 chars.

2. Server. `GET /api/plain-words?text=` is not needed; the check is pure and runs on the page.
   The export (`server/export.ts`) appends one line under each claim when flags exist:
   `[plain words: N suggestions not applied]`, so a reader knows the person saw them and chose.

3. Page (`app/components/PlainWords.tsx` + hooks in ClaimCard and SignersSection):
   - Under each claimant field (assertion, requested change, evidence, impact statement), a small
     mono line: `Plain words · 2 suggestions` that expands to the flags: excerpt, the rule title,
     the fix, and the source (`unslop §23`). Clean fields show `Plain words · clean`. The check
     runs on the client on every change (debounced 300 ms).
   - Flags never block anything. No auto-rewrite. The person edits by hand or asks their agent.
   - One credit line at the bottom of the claims list and in the "How agents use this site"
     section: `Writing check adapted from unslop by Lauren Tan (poteto), MIT.` with the link.

4. Tools (`src/webmcp/schema.ts` descriptions and outputs; no new tool):
   - `propose_claim.description` gains one sentence: `Write assertion and requested_change in
plain first-person words; the page runs a plain-words check and shows suggestions.`
   - `draft_my_impact.description` gains the same sentence.
   - `get_letter` output: each claim preview gains `plain_words: { flags: N }`; the letter gains
     `writing_guide: PLAIN_WORDS_GUIDE` once (budget stays ≤1800; trim previews first).
   - `propose_claim` and `draft_my_impact` results gain `plain_words: { flags: N, top: [{title,
excerpt, fix}] ≤3 }` so the agent can fix its own draft on the next proposal.

5. Docs. README gets a `## Plain words` section (what it checks, that it never blocks, the
   credit). `docs/TOOLS.md` regenerates. The Devpost text gets one sentence in the "better user
   experience" answer.

## Rules that stay manual

Patterns 1–6, 10–12, 15–18, 21, 25, 27–29 need judgment (puffery, rule of three, passive
voice, title case). They are in the agent guide and in the README as advice, not as flags.

## Acceptance

- `checkPlainWords('Additionally, this serves as a testament to the vibrant landscape.')` returns
  ≥4 flags with sources §7 and §8; `checkPlainWords('The trail closes at dusk. I ride it home.')`
  returns 0.
- A claim whose assertion reads `"...quoted rule text with a testament inside..."` shows 0 flags
  for the quoted span.
- The judge letter's seeded assertions render their plain-words lines; claim 1's assertion
  (`Sec. 1.7 notice can be a bulletin-board posting; ...`) is clean or has ≤1 flag.
- `get_letter` output still ≤1800 chars on the judge letter.
- README credits Lauren Tan (poteto) with the link; `npm run tools:doc` passes.
