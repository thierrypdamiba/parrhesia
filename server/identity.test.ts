import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFAULT_DISPLAY_NAME,
  EMAIL_HEADER,
  FULL_NAME_HEADER,
  getViewer,
  parseCookies,
  safeReturnPath,
  sanitizeDisplayName,
  signSession,
  userIdFromEmail,
  verifySession,
} from './identity';

test("sanitizeDisplayName keeps [A-Za-z0-9 .'-], collapses whitespace, caps at 40", () => {
  assert.equal(sanitizeDisplayName('Maya Chen'), 'Maya Chen');
  assert.equal(sanitizeDisplayName("  O'Brien-Smith Jr.  "), "O'Brien-Smith Jr.");
  assert.equal(sanitizeDisplayName('Maya\nChen'), 'Maya Chen');
  assert.equal(
    sanitizeDisplayName('Maya\r\n<script>alert(1)</script>'),
    'Maya script alert 1 script',
  );
  assert.equal(sanitizeDisplayName('Zoë Ångström'), 'Zo ngstr m');
  assert.equal(sanitizeDisplayName('x'.repeat(80)).length, 40);
  assert.equal(sanitizeDisplayName(''), DEFAULT_DISPLAY_NAME);
  assert.equal(sanitizeDisplayName('   '), DEFAULT_DISPLAY_NAME);
  assert.equal(sanitizeDisplayName('!!!'), DEFAULT_DISPLAY_NAME);
  assert.equal(sanitizeDisplayName(null), DEFAULT_DISPLAY_NAME);
  assert.equal(sanitizeDisplayName(undefined), DEFAULT_DISPLAY_NAME);
});

test('userIdFromEmail is the sha256 of the lowercased, trimmed email', async () => {
  const a = await userIdFromEmail('Maya@Example.org');
  const b = await userIdFromEmail('  maya@example.org ');
  assert.equal(a, b);
  assert.match(a, /^[a-f0-9]{64}$/);
  // sha256('maya@example.org') — pinned so the fixture ids in later lanes stay stable.
  assert.equal(a, '1d059e493b8768f6f649ba0898377eafabdf9f343defc099e8497e57dfcda5de');
  assert.notEqual(a, await userIdFromEmail('other@example.org'));
});

test('getViewer derives identity from the oai headers and never echoes the email', async () => {
  const request = new Request('http://localhost/api/me', {
    headers: {
      [EMAIL_HEADER]: 'Maya@Example.org',
      // A newline cannot travel in an HTTP header at all (undici rejects it; the wire would
      // 400), so the transport-level case is a tab plus markup; sanitizeDisplayName's own test
      // covers '\n'.
      [FULL_NAME_HEADER]: 'Maya\tChen <b>x</b>',
    },
  });
  const viewer = await getViewer(request, {});
  assert.equal(viewer.signed_in, true);
  assert.equal(viewer.display_name, 'Maya Chen b x b');
  assert.equal(viewer.user_id, await userIdFromEmail('maya@example.org'));
  assert.equal(viewer.source, 'headers');
  assert.match(viewer.owner_token, /^[a-z0-9]{32}$/);
  const serialized = JSON.stringify(viewer);
  assert.ok(!/example\.org/i.test(serialized), 'email must not appear anywhere in the viewer');
  assert.ok(viewer.set_cookies.some(c => c.startsWith('docket_owner=')));
  assert.ok(viewer.set_cookies.every(c => /HttpOnly/.test(c) && /SameSite=Lax/.test(c)));
  // No secret configured → no session cookie.
  assert.ok(!viewer.set_cookies.some(c => c.startsWith('docket_session=')));
});

test('percent-encoded full names are decoded before sanitizing', async () => {
  const request = new Request('http://localhost/api/me', {
    headers: {
      [EMAIL_HEADER]: 'maya@example.org',
      [FULL_NAME_HEADER]: 'Maya%20O%27Brien%20%3Cx%3E',
      'oai-authenticated-user-full-name-encoding': 'percent-encoded-utf-8',
    },
  });
  const viewer = await getViewer(request, {});
  assert.equal(viewer.display_name, "Maya O'Brien x");
  // Without the encoding header the raw value is sanitized as-is.
  const plain = await getViewer(
    new Request('http://localhost/api/me', {
      headers: { [EMAIL_HEADER]: 'maya@example.org', [FULL_NAME_HEADER]: 'Maya%20Chen' },
    }),
    {},
  );
  assert.equal(plain.display_name, 'Maya 20Chen');
});

test('getViewer without headers is anonymous and reuses an existing owner cookie', async () => {
  const request = new Request('http://localhost/api/me', {
    headers: { cookie: 'docket_owner=abcdefghijklmnopqrstuvwxyz012345; other=1' },
  });
  const viewer = await getViewer(request, {});
  assert.equal(viewer.signed_in, false);
  assert.equal(viewer.user_id, null);
  assert.equal(viewer.display_name, DEFAULT_DISPLAY_NAME);
  assert.equal(viewer.owner_token, 'abcdefghijklmnopqrstuvwxyz012345');
  assert.deepEqual(viewer.set_cookies, []);
});

test('headers with an empty name fall back to Signer, never the email local part', async () => {
  const request = new Request('http://localhost/api/me', {
    headers: { [EMAIL_HEADER]: 'thierry@example.org' },
  });
  const viewer = await getViewer(request, {});
  assert.equal(viewer.display_name, 'Signer');
});

test('session cookie fallback: issued with headers + secret, accepted without headers', async () => {
  const env = { DOCKET_SESSION_SECRET: 'test-secret' };
  const first = await getViewer(
    new Request('https://docket.example/api/me', {
      headers: { [EMAIL_HEADER]: 'maya@example.org', [FULL_NAME_HEADER]: 'Maya Chen' },
    }),
    env,
  );
  const session = first.set_cookies.find(c => c.startsWith('docket_session='));
  assert.ok(session, 'session cookie issued');
  assert.match(session, /Secure/);
  const value = decodeURIComponent(session.split(';')[0].slice('docket_session='.length));
  const second = await getViewer(
    new Request('https://docket.example/api/letters', {
      headers: {
        cookie: `docket_session=${encodeURIComponent(value)}; docket_owner=${first.owner_token}`,
      },
    }),
    env,
  );
  assert.equal(second.signed_in, true);
  assert.equal(second.source, 'session');
  assert.equal(second.user_id, first.user_id);
  assert.equal(second.display_name, 'Maya Chen');

  // Tampered or wrong-secret cookies are rejected.
  assert.equal(await verifySession('other-secret', value), null);
  assert.equal(await verifySession('test-secret', value.slice(0, -1) + '0'), null);
  const expired = await signSession('test-secret', first.user_id!, 'Maya Chen', 1);
  assert.equal(await verifySession('test-secret', expired), null);
});

test('dev identity cookie is honoured only when DEV_IDENTITY === "1"', async () => {
  const request = () =>
    new Request('http://localhost/api/me', { headers: { cookie: 'docket_dev_identity=Maya' } });
  const off = await getViewer(request(), {});
  assert.equal(off.signed_in, false);
  const on = await getViewer(request(), { DEV_IDENTITY: '1' });
  assert.equal(on.signed_in, true);
  assert.equal(on.display_name, 'Maya');
  assert.equal(on.source, 'dev');
  assert.notEqual(on.user_id, await userIdFromEmail('maya'));
});

test('parseCookies and safeReturnPath', () => {
  assert.deepEqual(parseCookies('a=1; b="two"; c=%2Fl%2Fx; a=dup'), {
    a: '1',
    b: 'two',
    c: '/l/x',
  });
  assert.deepEqual(parseCookies(null), {});
  assert.equal(safeReturnPath('/l/abc?judge=1'), '/l/abc?judge=1');
  assert.equal(safeReturnPath('//evil.example'), null);
  assert.equal(safeReturnPath('https://evil.example'), null);
  assert.equal(safeReturnPath('/x\r\nSet-Cookie: a=b'), null);
  assert.equal(safeReturnPath(''), null);
});
