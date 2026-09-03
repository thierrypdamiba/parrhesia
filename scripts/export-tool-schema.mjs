// Writes evals/schema.json in the webmcp-evals tool-schema format ({tools:[{name, description,
// inputSchema, ...}]}) from src/webmcp/schema.ts, so `npx webmcp-evals local -t evals/schema.json`
// runs against exactly the eight tools the page registers. Titles are rendered for the judge
// rule (2026-17902) and the default display name. `--check` exits 1 on drift.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import prettier from 'prettier';

import { TOOLS, TOOL_ORDER, renderTitle } from '../src/webmcp/schema.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'evals', 'schema.json');
const check = process.argv.includes('--check');

const TITLE_VARS = {
  document_number: '2026-17902',
  total_chars: 44458,
  first_page: 56095,
  last_page: 56101,
  display_name: 'Signer',
};

const tools = TOOL_ORDER.map(name => {
  const t = TOOLS[name];
  return {
    name: t.name,
    title: renderTitle(t.title, TITLE_VARS),
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: t.annotations,
  };
});

const next = await prettier.format(JSON.stringify({ tools }, null, 2), {
  ...((await prettier.resolveConfig(out)) ?? {}),
  filepath: out,
});
let current = null;
try {
  current = readFileSync(out, 'utf8');
} catch {
  /* first run */
}
if (current === next) {
  console.log(`ok       evals/schema.json (${tools.length} tools)`);
} else if (check) {
  console.error(
    'DRIFT    evals/schema.json differs from src/webmcp/schema.ts; run `npm run evals:schema`',
  );
  process.exitCode = 1;
} else {
  writeFileSync(out, next);
  console.log(`written  evals/schema.json (${tools.length} tools)`);
}
