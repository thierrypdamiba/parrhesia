// Resolve/load hooks for `import x from './file.sql?raw'` under Node (see raw-loader.mjs).
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const RAW = '?raw';

export async function resolve(specifier, context, nextResolve) {
  if (!specifier.endsWith(RAW)) return nextResolve(specifier, context);
  const bare = specifier.slice(0, -RAW.length);
  const parentPath = context.parentURL ? fileURLToPath(context.parentURL) : process.cwd();
  const abs = path.resolve(path.dirname(parentPath), bare);
  return { url: pathToFileURL(abs).href + RAW, shortCircuit: true };
}

export async function load(url, context, nextLoad) {
  if (!url.endsWith(RAW)) return nextLoad(url, context);
  const text = await readFile(fileURLToPath(url.slice(0, -RAW.length)), 'utf8');
  return {
    format: 'module',
    source: `export default ${JSON.stringify(text)};`,
    shortCircuit: true,
  };
}
