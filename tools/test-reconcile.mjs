import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const directory = await mkdtemp(join(tmpdir(), 'vesper-reconcile-'));
let failed = false;
try {
  for (const file of (await readdir('tools')).filter(name => /^test-.*\.(mjs|ts)$/.test(name) && !['test-reconcile.mjs', 'test-desire.mjs'].includes(name))) {
    const output = join(directory, file.replace(/\.(mjs|ts)$/, '.mjs'));
    try {
      // Bundle extensionless TS imports and supply only an isolated Worker environment.
      // Existing source-inspection / import.meta.url tests must retain their original URL.
      const source = await readFile('tools/' + file, 'utf8');
      if ((source.includes('import.meta.url') && file.endsWith('.mjs')) || source.includes('vm.') || source.includes("from 'esbuild'")) {
        const result = spawnSync(process.execPath, ['--experimental-strip-types', 'tools/' + file], { stdio: 'inherit' });
        if (result.status !== 0) failed = true;
      } else {
        await build({ entryPoints: ['tools/' + file], outfile: output, bundle: true, platform: 'node', format: 'esm', define: { 'import.meta.url': JSON.stringify(new URL(file, new URL('./', import.meta.url)).href) }, plugins: [{ name: 'isolated-env', setup(b) {
          b.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: 'env', namespace: 'fixture' }));
          b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export function waitUntil(p){return p;} export const env = {}; export class WorkerEntrypoint {}', loader: 'js' }));
        } }] });
        const result = spawnSync(process.execPath, [output], { stdio: 'inherit' });
        if (result.status !== 0) failed = true;
      }
      console.log('FINISHED', file);
    } catch (error) { console.error(file, error); failed = true; }
  }
  const page = await readFile('app/page.tsx', 'utf8');
  const config = JSON.parse(await readFile('wrangler.production.jsonc', 'utf8'));
  assert.equal(config.d1_databases.find(x => x.binding === 'DB').database_name, 'vesper-db');
  assert.equal(config.d1_databases.find(x => x.binding === 'SHARED_MEMORY_DB').database_name, 'memory-db');
  assert.ok(page.includes('<SharedMemoryLibrary'));
  for (const manifest of ['public/manifest.webmanifest', 'public/manifest-v8.webmanifest']) {
    const data = JSON.parse(await readFile(manifest, 'utf8'));
    assert.equal(data.display, 'standalone');
    for (const icon of data.icons) await readFile('public/' + icon.src.replace(/^\.\//, '').replace(/^\//, '').split('?')[0]);
  }
} finally { await rm(directory, { recursive: true, force: true }); }
process.exitCode = failed ? 1 : 0;
