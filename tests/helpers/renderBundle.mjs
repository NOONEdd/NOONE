// Test helper: bundles real UI source files IN MEMORY with esbuild (ships with vite -- no new dependency) together with react /
// react-dom/server, and imports the result, so a test can render the REAL components with renderToStaticMarkup. Nothing in the repo
// is written or modified; the bundle goes to the OS temp dir and is deleted right after import.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let n = 0;

/** @param {string} entryContents  ES module source that imports from absolute file paths and re-exports what the test needs */
export async function bundleModule(entryContents) {
  const result = await build({
    stdin: { contents: entryContents, resolveDir: ROOT, loader: 'js', sourcefile: 'render-entry.js' },
    bundle: true, write: false, format: 'esm', platform: 'node', target: 'node18', jsx: 'automatic', logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"production"' },
    banner: { js: "import { createRequire as __nyxCreateRequire } from 'node:module'; const require = __nyxCreateRequire(import.meta.url);" },
    loader: { '.css': 'empty', '.png': 'empty', '.webp': 'empty', '.jpg': 'empty', '.svg': 'empty' },
  });
  const file = path.join(os.tmpdir(), `nyx-render-${process.pid}-${n++}.mjs`);
  fs.writeFileSync(file, result.outputFiles[0].text);
  try { return await import(pathToFileURL(file).href); } finally { fs.rmSync(file, { force: true }); }
}

export const src = (rel) => JSON.stringify(path.join(ROOT, rel));
