import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import type { RuleHeader } from '../../server/types';
import { PROBE, type HostToolDescriptor, type ModelContextHost } from './host';
import type { PageState } from './tools';
import { WebmcpController } from './useWebmcp';

// A static host (ChatGPT's in-app browser): it snapshots whatever is registered and never
// diffs, so what matters is *when* the page registers and whether a later title lands.
interface FakeHost extends ModelContextHost {
  tools: Map<string, HostToolDescriptor>;
}

function fakeHost(): FakeHost {
  const host: FakeHost = {
    tools: new Map(),
    registerTool(tool, options) {
      host.tools.set(tool.name, tool);
      options?.signal?.addEventListener('abort', () => host.tools.delete(tool.name));
    },
    getTools() {
      return [...host.tools.values()].map(t => ({ name: t.name }));
    },
  };
  return host;
}

const CHATGPT_UA = `Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 ${PROBE.CHATGPT_UA_MARKER}/1.2026.240`;

/** Install the globals host.ts reads: a top-level window, the UA marker and the host. */
function installHost(host: FakeHost | null): void {
  const win = { location: { search: '' } } as Record<string, unknown>;
  win.top = win;
  win.self = win;
  define('window', win);
  define('document', { modelContext: host });
  define('navigator', { userAgent: CHATGPT_UA, userAgentData: { brands: [] } });
}

function define(name: string, value: unknown): void {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

afterEach(() => {
  for (const name of ['window', 'document', 'navigator']) {
    Reflect.deleteProperty(globalThis, name);
  }
});

const RULE: RuleHeader = {
  document_number: '2026-17902',
  title: 'Bicycles and Electric Bicycles',
  agency: 'National Park Service',
  docket_id: 'NPS-2026-0166',
  document_id: 'NPS-2026-0166-0001',
  comment_url: null,
  html_url: 'https://www.federalregister.gov/d/2026-17902',
  comments_close_on: '2026-11-02',
  days_left: 60,
  pages: { first: 56095, last: 56101 },
  total_chars: 44458,
  fetched_at: '2026-09-03T14:02:00.000Z',
  source_kind: 'txt',
  text_sha256: 'fc22cd12737d1979',
};

function publicState(): PageState {
  return {
    letter: { letter_id: 'l_pub', public_token: 'p'.repeat(22), rev: 'abcdef012345' },
    rule: RULE,
    claimsAccepted: 2,
    signedIn: false,
    viewerName: 'Signer',
    canEdit: false,
    isPublicView: true,
  };
}

function workspaceState(viewerName: string): PageState {
  return {
    letter: { letter_id: 'l_ws', share_code: 's'.repeat(22), rev: 'abcdef012345' },
    rule: RULE,
    claimsAccepted: 1,
    signedIn: true,
    viewerName,
    canEdit: true,
    isPublicView: false,
  };
}

test('a static host gets nothing until the page reports its real state', () => {
  const host = fakeHost();
  installHost(host);
  const controller = new WebmcpController();
  controller.start();
  assert.equal(controller.getSnapshot().mode, 'static');
  assert.deepEqual([...host.tools.keys()], [], 'INITIAL_STATE registers nothing');

  controller.setState(publicState());
  assert.deepEqual(
    [...host.tools.keys()].sort(),
    ['get_letter', 'read_rule'],
    '/r/ registers only the two read-only tools',
  );
  assert.match(host.tools.get('read_rule')?.title ?? '', /2026-17902/);
  controller.stop();
});

test('a static host is handed the workspace set with the rule and the viewer in the titles', () => {
  const host = fakeHost();
  installHost(host);
  const controller = new WebmcpController();
  controller.start();
  controller.setState(workspaceState('Maya'));

  assert.equal(host.tools.size, 8, 'the whole route set, gated inside execute');
  assert.match(host.tools.get('draft_my_impact')?.title ?? '', /Maya/);
  assert.match(host.tools.get('read_rule')?.title ?? '', /2026-17902.*44,458/);
  controller.stop();
});

test('a static host is re-handed a tool whose title changed after sign-in', () => {
  const host = fakeHost();
  installHost(host);
  const controller = new WebmcpController();
  controller.start();
  controller.setState(workspaceState('Signer'));
  const before = host.tools.get('draft_my_impact');
  const getLetterBefore = host.tools.get('get_letter');
  assert.ok(before && !/Maya/.test(before.title ?? ''));

  controller.setState(workspaceState('Maya'));
  assert.equal(host.tools.size, 8, 'the set is unchanged');
  assert.notEqual(host.tools.get('draft_my_impact'), before, 'the tool was re-registered');
  assert.match(host.tools.get('draft_my_impact')?.title ?? '', /Maya/);
  assert.equal(
    host.tools.get('get_letter'),
    getLetterBefore,
    'a tool whose signature did not change is left alone',
  );
  controller.stop();
});

test('with no host the controller still reports the rail and registers nothing', () => {
  installHost(null);
  const controller = new WebmcpController();
  controller.start();
  controller.setState(workspaceState('Maya'));
  const status = controller.getSnapshot();
  assert.equal(status.mode, 'none');
  assert.deepEqual(status.registered, []);
  assert.ok(status.now.includes('read_rule'));
  controller.stop();
});
