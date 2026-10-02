import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const directory=await mkdtemp(join(tmpdir(),'memory-contracts-'));
try {
 for(const name of ['test-shared-memory','test-memory-recall']){
  const outfile=join(directory,name+'.mjs');
  await build({entryPoints:['tools/'+name+'.ts'],outfile,bundle:true,platform:'node',format:'esm'});
  await import(pathToFileURL(outfile));
 }
} finally { await rm(directory,{recursive:true,force:true}); }
