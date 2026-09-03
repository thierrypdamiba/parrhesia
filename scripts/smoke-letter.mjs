// HTTP walkthrough of the judge letter (PLAN.md P9 `evals:api`). No LLM, no browser: plain
// fetch with a cookie jar against a running server. Exits non-zero on any mismatch.
//   node scripts/smoke-letter.mjs http://localhost:3101
// Steps: fork judge letter → verify Q3 (40935/41136/56101) → verify BAD (ANCHOR_NOT_FOUND,
// nearest[0].start 20073) → propose with current rev (pending) → accept hold 700 (rev_no+1)
// → propose with the pre-accept rev (STALE_REVISION) → accept hold 100 (HOLD_REQUIRED)
// → export contains 'page 56101'.

const base = (process.argv[2] || process.env.URL || 'http://localhost:3101').replace(/\/$/, '');

const Q3 =
  'The use of bicycles and electric bicycles is allowed in other locations designated by the superintendent after notice is provided using one or more of the methods described in Sec. 1.7 of this chapter.';
const Q2 =
  'The superintendent would have authority to designate other locations, including administrative roads and trails, for bicycle and e-bike use except that rulemaking in the Federal Register would be required to allow bicycles or e-bikes in two circumstances.';
const BAD =
  'Written determinations for existing trails must be published in the Federal Register for 60 days of public comment.';

const jar = new Map();
function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}
function storeCookies(res) {
  const setCookies =
    typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  for (const line of setCookies) {
    const [pair] = line.split(';');
    const eq = pair.indexOf('=');
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}

async function call(method, path, body, extraHeaders = {}) {
  const headers = { accept: 'application/json, text/plain', ...extraHeaders };
  if (jar.size) headers.cookie = cookieHeader();
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(base + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  });
  storeCookies(res);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* text body */
  }
  return { status: res.status, json, text };
}

const rows = [];
let failed = 0;
function record(step, ok, detail) {
  rows.push({ step, result: ok ? 'PASS' : 'FAIL', detail });
  if (!ok) failed++;
}
function show(r) {
  return r.json ? JSON.stringify(r.json).slice(0, 160) : `${r.status} ${r.text.slice(0, 80)}`;
}

async function main() {
  console.log(`smoke-letter against ${base}`);

  // 1. Fork a fresh judge letter (reset so every run starts from the seed).
  const fork = await call('POST', '/api/judge/fork', { reset: true });
  const letterId = fork.json?.letter_id;
  record(
    'fork judge letter (reset)',
    fork.status === 200 && /^l_[a-z0-9]{8}$/.test(letterId || '') && fork.json.reused === false,
    show(fork),
  );
  if (!letterId) return finish();
  const L = `/api/letters/${letterId}`;

  // 1b. Reuse without reset returns the same letter.
  const again = await call('POST', '/api/judge/fork', {});
  record(
    'fork again reuses the cookie letter',
    again.status === 200 && again.json?.letter_id === letterId && again.json.reused === true,
    show(again),
  );

  // 2. Verify Q3.
  const v3 = await call('POST', `${L}/verify`, { quote: Q3 });
  const a = v3.json?.anchor;
  record(
    'verify Q3 → 40935–41136 p. 56101',
    v3.status === 200 && a?.start === 40935 && a?.end === 41136 && a?.page === 56101,
    show(v3),
  );

  // 3. Verify BAD.
  const vb = await call('POST', `${L}/verify`, { quote: BAD });
  record(
    'verify BAD → 422 ANCHOR_NOT_FOUND, nearest[0].start 20073',
    vb.status === 422 &&
      vb.json?.error === 'ANCHOR_NOT_FOUND' &&
      vb.json?.nearest?.[0]?.start === 20073 &&
      vb.json.nearest.length === 3,
    show(vb),
  );

  // 4. State: current rev, seeded contents.
  const st = await call('GET', `${L}/state`);
  const s = st.json;
  const rev0 = s?.letter?.rev;
  const revNo0 = s?.letter?.rev_no;
  const seededPending = s?.pending?.find(p => p.kind === 'claim');
  record(
    'state: 3 claims (2 anchored, 1 unverified), 1 pending, is_judge_copy',
    st.status === 200 &&
      s.claims?.length === 3 &&
      s.claims.filter(c => c.anchor_status === 'anchored').length === 2 &&
      s.claims[0].anchor_start === 40935 &&
      s.claims[1].anchor_start === 20073 &&
      s.claims[2].anchor_status === 'unverified' &&
      s.pending?.length >= 1 &&
      s.letter?.is_judge_copy === true,
    st.status === 200
      ? `rev ${rev0} rev_no ${revNo0} claims ${s.claims?.length} pending ${s.pending?.length}`
      : show(st),
  );
  if (!rev0) return finish();

  // 5. Propose with the current rev → pending.
  const prop = await call(
    'POST',
    `${L}/proposals`,
    {
      base_rev: rev0,
      kind: 'claim',
      quote: Q2,
      position: 'support',
      assertion:
        'Superintendent-level designation would let parks open connector routes without a full rulemaking.',
      requested_change: 'Publish each designation on the park website within 30 days.',
    },
    { 'x-docket-actor': 'agent' },
  );
  const pid2 = prop.json?.proposal_id;
  record(
    'propose claim with current rev → pending',
    prop.status === 201 && prop.json?.status === 'pending' && prop.json?.anchor?.start === 28833,
    show(prop),
  );

  // 6. Accept the seeded pending proposal with a 700 ms hold → rev_no + 1.
  const pid1 = seededPending?.proposal_id;
  const acc = await call('POST', `${L}/proposals/${pid1}/decide`, {
    decision: 'accept',
    hold_ms: 700,
  });
  record(
    'accept hold 700 → rev_no + 1',
    acc.status === 200 && acc.json?.status === 'accepted' && acc.json?.rev_no === revNo0 + 1,
    show(acc),
  );

  // 7. Propose against the pre-accept rev → STALE_REVISION naming the accepted claim.
  const stale = await call(
    'POST',
    `${L}/proposals`,
    {
      base_rev: rev0,
      kind: 'claim',
      quote: Q3,
      position: 'modify',
      assertion: 'A second proposal against a revision that has since moved on.',
    },
    { 'x-docket-actor': 'agent' },
  );
  record(
    'propose with stale rev → 409 STALE_REVISION with changed_since',
    stale.status === 409 &&
      stale.json?.error === 'STALE_REVISION' &&
      Array.isArray(stale.json?.changed_since) &&
      stale.json.changed_since.length >= 1,
    show(stale),
  );

  // 8. Accept with a 100 ms hold → HOLD_REQUIRED.
  const short = await call('POST', `${L}/proposals/${pid2}/decide`, {
    decision: 'accept',
    hold_ms: 100,
  });
  record(
    'accept hold 100 → 400 HOLD_REQUIRED',
    short.status === 400 && short.json?.error === 'HOLD_REQUIRED',
    show(short),
  );

  // 9. Unknown body key → UNKNOWN_FIELD.
  const unk = await call('POST', `${L}/proposals`, {
    base_rev: rev0,
    kind: 'impact',
    text: 'x'.repeat(50),
    signer_name: 'Maya',
  });
  record(
    'body with signer_name → 400 UNKNOWN_FIELD',
    unk.status === 400 && unk.json?.error === 'UNKNOWN_FIELD',
    show(unk),
  );

  // 10. Export.
  const exp = await call('GET', `${L}/export.txt`);
  record(
    "export.txt contains 'page 56101' and \"[claimant's words]\"",
    exp.status === 200 &&
      exp.text.includes('page 56101') &&
      exp.text.includes("[claimant's words]"),
    `${exp.status} ${exp.text.length} chars`,
  );

  finish();
}

function finish() {
  const w = Math.max(...rows.map(r => r.step.length));
  console.log('');
  for (const r of rows) console.log(`${r.result}  ${r.step.padEnd(w)}  ${r.detail}`);
  console.log(`\n${rows.length - failed}/${rows.length} passed`);
  process.exit(failed ? 1 : 0);
}

main().catch(err => {
  console.error('smoke-letter crashed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
