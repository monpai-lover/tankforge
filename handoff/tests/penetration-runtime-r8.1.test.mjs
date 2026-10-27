import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';
test('actual shipped WASM resolves former invulnerable paths and preserves MG protection/open crew',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tf-penetration-r81-'));
 try{
  const root=fileURLToPath(new URL('../../',import.meta.url)),out=path.join(dir,'receipt.json');
  const run=spawnSync(process.execPath,['--expose-gc','--max-old-space-size=4096',path.join(root,'handoff/tools/penetration_regression_cpu.mjs'),'--root',root,'--out',out],{encoding:'utf8',maxBuffer:4*1024*1024,timeout:240000});
  assert.equal(run.status,0,run.stdout+'\n'+run.stderr);
  const proof=JSON.parse(fs.readFileSync(out,'utf8'));
  assert.equal(proof.results.length,11);
  assert.equal(proof.results.filter(r=>r.expected==='penetrate').length,9);
  assert.equal(proof.results.filter(r=>r.expected==='block').length,1);
  assert.equal(proof.results.filter(r=>r.expected==='open').length,1);
 }finally{
  assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));
  assert.match(path.basename(dir),/^tf-penetration-r81-/);
  fs.rmSync(dir,{recursive:true,force:true});
 }
});
