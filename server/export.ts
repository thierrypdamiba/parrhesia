// Plain-text export of a letter (PLAN.md P3, docs/API.md GET /api/letters/:id/export.txt).
// Pure: takes rows, returns text. Every free-text field a person or agent typed is prefixed
// "[claimant's words]" because the page verifies quotes only; the footer discloses agent help.

import { APP_NAME } from '../lib/app';
import type { Claim, Letter, Position, RuleCacheParsed, Signer } from './types';

const POSITION_LABEL: Record<Position, string> = {
  support: 'Support',
  oppose: 'Oppose',
  modify: 'Modify',
};

export const CLAIMANT = "[claimant's words]";
export const NOT_VERIFIED = '[QUOTE NOT VERIFIED]';

/** The disclosure footer from PLAN.md section 5, with the product name from lib/app.ts. */
export function disclosureFooter(document_number: string | null, fetchedDate: string): string {
  return (
    `Quotes verified against Federal Register document ${document_number ?? '(none)'} text ` +
    `fetched ${fetchedDate}. Prepared with ${APP_NAME}, an agent-assisted drafting tool; ` +
    'filed by a person.'
  );
}

/** One numbered claim line: `N. [Position] Quoting page <page>: "<quote>" — …`. */
export function claimLine(c: Claim, n: number): string {
  const quoting =
    c.anchor_status === 'anchored' && c.page !== null
      ? `Quoting page ${c.page}`
      : `Quoting ${NOT_VERIFIED}`;
  let line = `${n}. [${POSITION_LABEL[c.position]}] ${quoting}: "${c.quote}" — ${CLAIMANT} ${c.assertion}`;
  if (c.requested_change.trim()) line += ` Requested change: ${CLAIMANT} ${c.requested_change}`;
  if (c.evidence.trim()) line += ` (Evidence: ${CLAIMANT} ${c.evidence})`;
  return line;
}

export function exportText(
  letter: Letter,
  claims: readonly Claim[],
  signers: readonly Signer[],
  rule: RuleCacheParsed | null,
): string {
  const lines: string[] = [];
  lines.push(`Public comment on ${letter.title ?? 'a rule the government wants to change'}`);
  lines.push(`Federal Register document ${letter.document_number ?? '(no rule attached)'}`);
  if (letter.agency) lines.push(`Agency: ${letter.agency}`);
  if (letter.docket_id) lines.push(`Docket: ${letter.docket_id}`);
  if (letter.comments_close_on) lines.push(`Comments close: ${letter.comments_close_on}`);
  lines.push('');
  if (claims.length === 0) lines.push('(no claims yet)');
  claims.forEach((c, i) => {
    lines.push(claimLine(c, i + 1));
    lines.push('');
  });
  lines.push('Signed by:');
  if (signers.length === 0) lines.push('(no signers yet)');
  for (const s of signers) {
    lines.push(
      `- ${s.display_name}${s.signed_at ? ` (signed ${s.signed_at})` : ' (not yet signed)'}`,
    );
    if (s.impact_text) lines.push(`  Impact: ${s.impact_text}`);
  }
  lines.push('');
  const fetched = rule?.fetched_at?.slice(0, 10) ?? letter.updated_at.slice(0, 10);
  lines.push(disclosureFooter(letter.document_number, fetched));
  return lines.join('\n') + '\n';
}
