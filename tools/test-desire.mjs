import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
for (const [source, output] of [['desire-store', 'rowan-desire-store-test'], ['push', 'rowan-push-test'], ['encounter-service', 'rowan-encounter-service-test'], ['native', 'vesper-desire-native-test']]) {
  await build({ entryPoints: [`lib/desire/${source}.ts`], bundle: true, platform: 'node', format: 'esm', outfile: `/tmp/${output}.mjs` });
}
const tests = ['longing-rules', 'encounter-history', 'encounter-notification', 'real-interaction', 'native', 'api'];
const run = spawnSync(process.execPath, ['--test', ...tests.map(name => `tests/desire/${name}.test.mjs`)], { stdio: 'inherit' });
process.exit(run.status ?? 1);
