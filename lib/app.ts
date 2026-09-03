// Product identity. Import these everywhere; never hardcode the product name
// (it changes before submission). PLAN.md sections 2.1, 4.1 item 1, section 8.

export const APP_NAME = 'Docket';

export const APP_TAGLINE =
  'Co-write a public comment on a live federal rule with your agent. ' +
  'Every quote is verified against the rule; every signer is a person; a person files.';

// Integration replaces this with the production Sites URL (PLAN.md 4.1 item 1).
export const SITE_URL = 'https://example.invalid';

// Sent on every federalregister.gov request made by the Worker (PLAN.md 4.1 item 1).
export const USER_AGENT = `${APP_NAME}/1.0 (+${SITE_URL})`;

// Header the page sets on tool-originated writes; the server derives the actor from it
// (PLAN.md P3: `agent-of:<display_name|anon>` vs `human:<display_name|anon>`).
export const ACTOR_HEADER = 'x-docket-actor';
