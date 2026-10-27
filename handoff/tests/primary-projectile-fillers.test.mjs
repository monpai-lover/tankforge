import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../../',import.meta.url)),ids=['apcbc_75_pzgr39','apcbc_75_pzgr39_l43','apcbc_75_pzgr39_42'],helper=path.join(root,'handoff/tools/primary_projectile_fillers.js');
const catalogs=()=>Object.fromEntries(fs.readdirSync(path.join(root,'data/projectiles')).filter(n=>n.endsWith('.json')).map(n=>{const s=JSON.parse(fs.readFileSync(path.join(root,'data/projectiles',n)));return [s.id,s];}));
test('reviewed primary-source material overlay changes only the three exact75mmPzgr39 variants',()=>{
 assert.ok(fs.existsSync(helper),'Primary-source runtime correction helper is required');const projectiles=catalogs(),before=structuredClone(projectiles),c=vm.createContext({});vm.runInContext(fs.readFileSync(helper,'utf8'),c);c.applyPrimaryProjectileFillerCorrections(projectiles);for(const id of Object.keys(projectiles)){const expected={...before[id]};if(ids.includes(id))expected.explosive_type='hexogen';assert.deepEqual(projectiles[id],expected,id);}assert.deepEqual(JSON.parse(JSON.stringify(c.applyPrimaryProjectileFillerCorrections(projectiles))).map(x=>x.id).sort(),[...ids].sort());
});
test('material overlay preflights the full correction set and refuses unrelated projectile data',()=>{
 assert.ok(fs.existsSync(helper));const projectiles=catalogs(),before=JSON.stringify(projectiles),c=vm.createContext({});vm.runInContext(fs.readFileSync(helper,'utf8'),c);projectiles[ids[2]].explosive_mass_kg=.1134;const drifted=JSON.stringify(projectiles);assert.throws(()=>c.applyPrimaryProjectileFillerCorrections(projectiles),/identity\/mass drift/);assert.equal(JSON.stringify(projectiles),drifted);assert.notEqual(drifted,before);
});
test('candidate source correction stages exactly3JSONs and an idempotent earlyruntime overlay without overwriting game assets',()=>{
 const script=path.join(root,'handoff/tools/patch_primary_projectile_fillers.py');assert.ok(fs.existsSync(script),'Candidate-only primary correction script is required');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tf-primary-filler-')),out=path.join(dir,'app.html'),outdir=path.join(dir,'projectiles'),python=process.env.TF_TEST_PYTHON||'python',app=path.join(root,'handoff/bundle/app.js.html'),before=fs.readFileSync(app,'utf8');
 try{const r=spawnSync(python,[script,'--input-app',app,'--output-app',out,'--output-catalog',outdir],{encoding:'utf8'});assert.equal(r.status,0,r.stderr||r.stdout);assert.deepEqual(fs.readdirSync(outdir).sort(),ids.map(id=>id+'.json').sort());for(const id of ids){const value=JSON.parse(fs.readFileSync(path.join(outdir,id+'.json'))),original=JSON.parse(fs.readFileSync(path.join(root,'data/projectiles',id+'.json')));assert.equal(value.explosive_type,'hexogen');assert.equal(value.explosive_mass_kg,original.explosive_mass_kg);}
 const candidate=fs.readFileSync(out,'utf8');assert.ok(candidate.indexOf('function applyPrimaryProjectileFillerCorrections(')<candidate.indexOf('function bulletShell('));assert.ok(candidate.includes('const data = JSON.parse(document.getElementById("tf-data").textContent);\n    applyPrimaryProjectileFillerCorrections(data.projectiles);'));const block=candidate.slice(candidate.indexOf('// BEGIN PRIMARY PROJECTILE FILLER CORRECTIONS'),candidate.indexOf('// END PRIMARY PROJECTILE FILLER CORRECTIONS'));assert.doesNotThrow(()=>vm.runInNewContext(block,{}),'Early helper definition cannot access boot-local data before parsing');const again=spawnSync(python,[script,'--input-app',out,'--output-app',out,'--output-catalog',outdir],{encoding:'utf8'});assert.equal(again.status,0,again.stderr||again.stdout);assert.equal(fs.readFileSync(out,'utf8'),candidate);assert.equal(fs.readFileSync(app,'utf8'),before);new vm.Script(candidate.slice(candidate.indexOf('>')+1,candidate.lastIndexOf('</script>')));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
