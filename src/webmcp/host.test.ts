import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PROBE, detectMode, hostLabel, readConfiguredMode } from './host';

const chrome = { userAgent: 'Mozilla/5.0 Chrome/149.0', brands: ['Chromium', 'Google Chrome'] };
const chatgpt = {
  userAgent: `Mozilla/5.0 Chrome/149.0 ${PROBE.CHATGPT_UA_MARKER}/1.0`,
  brands: ['Chromium', 'Google Chrome'],
};
const other = { userAgent: 'Mozilla/5.0 Safari/605', brands: [] };

test('auto = dynamic on Google Chrome brands, static otherwise, PROBE overrides ChatGPT', () => {
  assert.equal(detectMode('auto', chrome), 'dynamic');
  assert.equal(detectMode('auto', other), 'static');
  assert.equal(detectMode('auto', chatgpt), PROBE.CHATGPT_HOST_MODE);
  assert.equal(detectMode('static', chrome), 'static');
  assert.equal(detectMode('dynamic', other), 'dynamic');
});

test('DOCKET_TOOL_MODE defaults to auto; query override wins', () => {
  assert.equal(readConfiguredMode(''), 'auto');
  assert.equal(readConfiguredMode('?tool_mode=static'), 'static');
  assert.equal(readConfiguredMode('?tool_mode=bogus'), 'auto');
});

test('rail badges per 2.3', () => {
  assert.equal(hostLabel('none', other), 'No WebMCP host detected; the page works by hand.');
  assert.equal(hostLabel('dynamic', chrome), 'Chrome: live toolchange');
  assert.match(hostLabel('static', chatgpt), /^ChatGPT browser: all tools registered/);
});
