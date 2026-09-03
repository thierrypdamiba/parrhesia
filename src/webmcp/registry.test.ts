import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ToolName } from '../../server/types';
import type { HostToolDescriptor, ModelContextHost } from './host';
import { ToolRegistry, type ToolSpec } from './registry';
import { TOOLS } from './schema';

interface FakeHost extends ModelContextHost {
  tools: Map<string, HostToolDescriptor>;
  events: number;
  fire: () => void;
  throwOnRegister?: boolean;
}

function fakeHost(): FakeHost {
  const listeners = new Set<(e: unknown) => void>();
  const host: FakeHost = {
    tools: new Map(),
    events: 0,
    registerTool(tool, options) {
      if (host.throwOnRegister) throw new Error('boom');
      host.tools.set(tool.name, tool);
      options?.signal?.addEventListener('abort', () => {
        host.tools.delete(tool.name);
        host.fire();
      });
      host.fire();
    },
    getTools() {
      return [...host.tools.values()].map(t => ({ name: t.name }));
    },
    addEventListener(type, l) {
      if (type === 'toolchange') listeners.add(l);
    },
    removeEventListener(_type, l) {
      listeners.delete(l);
    },
    fire() {
      host.events++;
      for (const l of listeners) l({ type: 'toolchange' });
    },
  };
  return host;
}

function spec(name: ToolName, title = TOOLS[name].title): ToolSpec {
  return {
    name,
    title,
    description: TOOLS[name].description,
    inputSchema: TOOLS[name].inputSchema,
    annotations: TOOLS[name].annotations,
    execute: async () => ({ ok: true }),
  };
}

test('dynamic mode diffs: registers missing, aborts removed, re-registers on title change', () => {
  const host = fakeHost();
  const reg = new ToolRegistry(host, 'dynamic');
  const seen: string[][] = [];
  reg.subscribe(s => seen.push([...s.registered]));

  reg.sync([spec('find_open_rules'), spec('open_rule'), spec('get_letter')]);
  assert.deepEqual([...host.tools.keys()].sort(), ['find_open_rules', 'get_letter', 'open_rule']);
  assert.deepEqual(reg.registered().sort(), ['find_open_rules', 'get_letter', 'open_rule']);

  reg.sync([
    spec('find_open_rules'),
    spec('read_rule', 'Read passages of 2026-17902 (44,458 chars, pp. 56095-56101)'),
    spec('propose_claim'),
    spec('get_letter'),
    spec('ask_person_to_file'),
  ]);
  assert.ok(!host.tools.has('open_rule'), 'open_rule aborted after binding');
  assert.deepEqual([...host.tools.keys()].sort(), [
    'ask_person_to_file',
    'find_open_rules',
    'get_letter',
    'propose_claim',
    'read_rule',
  ]);

  const before = host.tools.get('read_rule');
  reg.sync([
    spec('find_open_rules'),
    spec('read_rule', 'Read passages of 2026-15406 (10,000 chars, pp. 1-2)'),
    spec('propose_claim'),
    spec('get_letter'),
    spec('ask_person_to_file'),
  ]);
  assert.notEqual(host.tools.get('read_rule'), before, 'changed title re-registers');
  assert.equal(
    host.tools.get('read_rule')?.title,
    'Read passages of 2026-15406 (10,000 chars, pp. 1-2)',
  );
  assert.ok(seen.length > 0, 'listeners re-rendered from getTools on toolchange');
  assert.deepEqual(seen[seen.length - 1].sort(), reg.registered().sort());

  reg.dispose();
  assert.equal(host.tools.size, 0, 'dispose aborts everything');
});

test('static mode registers the whole set once and ignores later syncs', () => {
  const host = fakeHost();
  const reg = new ToolRegistry(host, 'static');
  const all = (Object.keys(TOOLS) as ToolName[]).map(n => spec(n));
  reg.sync(all);
  assert.equal(host.tools.size, 8);
  const events = host.events;
  reg.sync([spec('find_open_rules')]);
  assert.equal(host.tools.size, 8, 'no re-registration in static mode');
  assert.equal(host.events, events, 'no host calls either');
  assert.equal(reg.snapshot().mode, 'static');
});

test('a throwing host never throws out of the registry; no host is a no-op', () => {
  const host = fakeHost();
  host.throwOnRegister = true;
  const reg = new ToolRegistry(host, 'dynamic');
  reg.sync([spec('get_letter')]);
  assert.match(reg.snapshot().host_error ?? '', /registerTool\(get_letter\) threw: boom/);
  assert.deepEqual(reg.registered(), []);

  const none = new ToolRegistry(null, 'dynamic');
  none.sync([spec('get_letter')]);
  assert.deepEqual(none.registered(), []);
  assert.equal(none.hasHost, false);
  none.dispose();
});

test('the registered execute forwards to the spec and returns a plain object', async () => {
  const host = fakeHost();
  const reg = new ToolRegistry(host, 'dynamic');
  const s = spec('get_letter');
  s.execute = async (input: unknown) => ({ echoed: input });
  reg.sync([s]);
  const result = await host.tools.get('get_letter')!.execute({ a: 1 });
  assert.deepEqual(result, { echoed: { a: 1 } });
});

test('an aborted pending registerTool promise is swallowed; other rejections become host_error', async () => {
  // A host like Chrome's: registerTool returns a promise that stays pending until the tool is
  // aborted, then rejects with AbortError. Aborting mid-registration must not surface anywhere.
  const rejections: unknown[] = [];
  const onUnhandled = (err: unknown) => rejections.push(err);
  process.on('unhandledRejection', onUnhandled);
  try {
    const registered = new Set<string>();
    const host: ModelContextHost = {
      registerTool(tool, options) {
        registered.add(tool.name);
        return new Promise((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => {
            registered.delete(tool.name);
            const err = new Error('registration aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      },
      getTools() {
        return [...registered].map(name => ({ name }));
      },
    };
    const reg = new ToolRegistry(host, 'dynamic');
    reg.sync([spec('get_letter'), spec('open_rule')]);
    assert.deepEqual(reg.registered().sort(), ['get_letter', 'open_rule']);

    reg.sync([spec('get_letter')]); // aborts open_rule while its promise is still pending
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(reg.registered(), ['get_letter']);
    assert.equal(reg.snapshot().host_error, null, 'AbortError is not a host error');
    assert.deepEqual(rejections, [], 'no unhandled rejection escaped');

    reg.dispose();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(rejections, [], 'dispose aborts the rest without unhandled rejections');
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

test('a registerTool promise that rejects for another reason is reported on the rail', async () => {
  const host: ModelContextHost = {
    registerTool() {
      return Promise.reject(new Error('quota exceeded'));
    },
  };
  const reg = new ToolRegistry(host, 'dynamic');
  const seen: (string | null)[] = [];
  reg.subscribe(s => seen.push(s.host_error));
  reg.sync([spec('get_letter')]);
  await new Promise(resolve => setImmediate(resolve));
  assert.match(reg.snapshot().host_error ?? '', /registerTool\(get_letter\) rejected: quota/);
  assert.ok(
    seen.some(e => e && /quota exceeded/.test(e)),
    'listeners were notified',
  );
  reg.dispose();
});
