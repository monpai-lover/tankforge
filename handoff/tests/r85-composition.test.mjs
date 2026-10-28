import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {applyR85AirwarFixes} from '../tools/apply_r85_airwar_fixes.mjs';
import {applyR83AirwarFixes} from '../tools/apply_r83_airwar_fixes.mjs';
import {applyR84AirwarFixes} from '../tools/apply_r84_airwar_fixes.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),canonical=path.join(root,'handoff/bundle/app.js.html'),sha=s=>crypto.createHash('sha256').update(s).digest('hex');
function cleanup(dir){assert.equal(path.dirname(dir),os.tmpdir());for(const name of ['candidate.html','unexpected.html','unrelated-entry.mjs']){const file=path.join(dir,name);if(fs.existsSync(file))fs.unlinkSync(file);}fs.rmdirSync(dir);}
test('importing historical composers has no inherited CLI writes',()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'tf-r85-import-')),output=path.join(temp,'unexpected.html');
 try{const entry=path.join(temp,'unrelated-entry.mjs');fs.writeFileSync(entry,'// unrelated existing entry');const script=`process.argv=['node',${JSON.stringify(entry)},${JSON.stringify(output)}];await import(${JSON.stringify(new URL('../tools/apply_r82_airwar_fixes.mjs',import.meta.url).href)});await import(${JSON.stringify(new URL('../tools/apply_r83_airwar_fixes.mjs',import.meta.url).href)});`;
  const p=spawnSync(process.execPath,['--input-type=module','-e',script],{cwd:root,encoding:'utf8'});assert.equal(p.status,0,p.stderr);assert.equal(fs.existsSync(output),false,'an import must not publish another entry point\'s output');
 }finally{cleanup(temp);}
});
test('R85 candidate CLI writes once, preserves canonical and composes strict legacy owners',()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'tf-r85-compose-')),output=path.join(temp,'candidate.html'),before=fs.readFileSync(canonical);
 try{const p=spawnSync(process.execPath,['handoff/tools/apply_r85_airwar_fixes.mjs',output],{cwd:root,encoding:'utf8'});assert.equal(p.status,0,p.stderr);assert.equal(sha(fs.readFileSync(canonical)),sha(before));
  const result=fs.readFileSync(output,'utf8');assert.equal(result,applyR85AirwarFixes(before.toString('utf8')));assert.equal(applyR85AirwarFixes(result),result);assert.equal(applyR83AirwarFixes(result),result);assert.equal(applyR84AirwarFixes(result),result);
 }finally{cleanup(temp);}
});
