import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../../',import.meta.url)),script=path.join(root,'handoff/tools/enrich_aircraft_projectile_metadata.py');
const fields=['kind','fuse_delay_s','fuse_sensitivity_mm','explosive_mass_kg','explosive_type'];
function run(input,source){
 assert.ok(fs.existsSync(script),'Candidate-only metadata enrichment script is required');const folder=fs.mkdtempSync(path.join(os.tmpdir(),'tf-shell-metadata-')),args=[];
 try{for(const [name,data]of Object.entries({input,source})){const file=path.join(folder,name+'.json');fs.writeFileSync(file,JSON.stringify(data));args.push('--'+name,file);}const output=path.join(folder,'out.json'),manifest=path.join(folder,'proof.json');const r=spawnSync(process.env.TF_TEST_PYTHON||'python',[script,...args,'--output',output,'--manifest',manifest],{encoding:'utf8'});assert.equal(r.status,0,r.stderr||r.stdout);return {result:JSON.parse(fs.readFileSync(output)),proof:JSON.parse(fs.readFileSync(manifest))};}finally{fs.rmSync(folder,{recursive:true,force:true});}
}
test('legacy metadata enrichment copies exact raw shell semantics while preserving TNT filler and all other fields',()=>{
 const input={version:1,types:{},shells:{ap_50_mk214a:{mass_kg:2.06,filler_kg:.02822,incendiary:true},api_30_pgu14:{filler_kg:0,incendiary:false}}};
 const source={shells:{ap_50_mk214a:{kind:'apcbc',explosive_mass_kg:.017,explosive_type:'petn',fuse_delay_s:.002,fuse_sensitivity_mm:15},api_30_pgu14:{kind:'ap',explosive_mass_kg:0,explosive_type:'none'}},aircraft:{}};
 const {result}=run(input,source);assert.equal(result.shells.ap_50_mk214a.filler_kg,.02822);assert.equal(result.shells.ap_50_mk214a.explosive_mass_kg,.017);assert.equal(result.shells.ap_50_mk214a.kind,'apcbc');assert.equal(result.shells.api_30_pgu14.explosive_mass_kg,0);
 for(const id of Object.keys(input.shells)){const value={...result.shells[id]};for(const f of fields)delete value[f];assert.deepEqual(value,input.shells[id]);}
 assert.deepEqual(run(result,source).result,result);
});
test('legacy bullet aliases resolve only through explicit gun definition and actual single-round belt',()=>{
 const source={shells:{actual_m61:{kind:'he',explosive_mass_kg:.01,explosive_type:'tnt'}},aircraft:{jet:{guns:[{definition:{id:'m61a1'},belt:['actual_m61']}],stores:{loadouts:[]}}}};
 const {result,proof}=run({shells:{'bullet:m61a1':{filler_kg:.0176}}},source);assert.equal(result.shells['bullet:m61a1'].explosive_mass_kg,.01);assert.equal(proof.resolved[0].sourceShell,'actual_m61');
 const missing=run({shells:{'bullet:unknown':{filler_kg:.5}}},source);assert.equal(missing.result.shells['bullet:unknown'].explosive_mass_kg,undefined);assert.equal(missing.proof.unverified[0],'bullet:unknown');
});
test('current source profile enriches all legacy aircraft rounds without changing accepted damage strength',()=>{
 const input=JSON.parse(fs.readFileSync(path.join(root,'data/aircraft/aircraft.json'))),source=JSON.parse(fs.readFileSync(path.join(root,'data/aircraft/frontline.json'))),{result,proof}=run(input,source);
 assert.equal(result.shells.ap_50_mk214a.explosive_mass_kg,.017);assert.equal(result.shells.ap_50_mk214a.filler_kg,.02822);assert.equal(result.shells.api_30_pgu14.explosive_mass_kg,0);
 assert.deepEqual(proof.unverified,[]);for(const id of Object.keys(input.shells))assert.equal(result.shells[id].filler_kg,input.shells[id].filler_kg,id);
});
