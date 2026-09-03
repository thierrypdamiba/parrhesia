// Generates docs/TOOLS.md and the README tool block from server/agents-doc.ts (which derives
// the table from src/webmcp/schema.ts). Default: check mode — exit 1 on drift so CI and
// `npm run check` catch a schema edit that was not documented. `--write` regenerates both.
// Run through tsx: `node --import tsx scripts/tools-doc.mjs [--write]` (see package.json).
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import prettier from 'prettier';

import { renderToolTableMarkdown, renderToolsDoc } from '../server/agents-doc.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const write = process.argv.includes('--write');

const BEGIN = '<!-- tools:begin -->';
const END = '<!-- tools:end -->';

function readOr(p) {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

/** Replace the marked block in README (or leave README alone when it has no markers). */
function withReadmeBlock(readme, table) {
  const a = readme.indexOf(BEGIN);
  const b = readme.indexOf(END);
  if (a < 0 || b < 0 || b < a) return null;
  return `${readme.slice(0, a + BEGIN.length)}\n${table}\n${readme.slice(b)}`;
}

/** Format exactly as `npm run format` would, so the drift check agrees with prettier. */
async function formatted(text, filepath) {
  const options = (await prettier.resolveConfig(filepath)) ?? {};
  return prettier.format(text, { ...options, filepath });
}

const targets = [];
const toolsPath = path.join(root, 'docs', 'TOOLS.md');
targets.push({
  path: toolsPath,
  current: readOr(toolsPath),
  next: await formatted(renderToolsDoc(), toolsPath),
});

const readmePath = path.join(root, 'README.md');
const readme = readOr(readmePath);
if (readme !== null) {
  const next = withReadmeBlock(readme, renderToolTableMarkdown());
  if (next === null) {
    console.error(`README.md has no ${BEGIN} … ${END} block; the tool table is not embedded.`);
    process.exitCode = 1;
  } else {
    targets.push({ path: readmePath, current: readme, next: await formatted(next, readmePath) });
  }
}

let drift = 0;
for (const t of targets) {
  const rel = path.relative(root, t.path);
  if (t.current === t.next) {
    console.log(`ok       ${rel}`);
    continue;
  }
  drift++;
  if (write) {
    writeFileSync(t.path, t.next);
    console.log(`written  ${rel}`);
  } else {
    console.error(
      `DRIFT    ${rel} differs from the tool definitions; run \`npm run tools:doc:write\``,
    );
  }
}
if (drift && !write) process.exitCode = 1;
