// Test runner: finds every *.test.ts outside build/dependency directories and runs them with
// node:test through tsx (plus the ?raw loader). Exits 0 with a note when no test files exist
// yet, so `npm run check` stays green while lanes are still landing.
import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set([
  'node_modules',
  '.next',
  '.vinext',
  '.wrangler',
  '.git',
  'dist',
  'out',
  'coverage',
  '.openai',
  '.claude',
  'public',
]);

function walk(dir, out) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.test\.(ts|tsx|mts)$/.test(entry)) out.push(full);
  }
  return out;
}

const files = walk(root, []).sort();
if (files.length === 0) {
  console.log('no *.test.ts files found; nothing to run');
  process.exit(0);
}

const result = spawnSync(
  process.execPath,
  [
    '--import',
    'tsx',
    '--import',
    path.join(root, 'scripts', 'raw-loader.mjs'),
    '--test',
    ...process.argv.slice(2),
    ...files,
  ],
  { cwd: root, stdio: 'inherit' },
);
process.exit(result.status ?? 1);
