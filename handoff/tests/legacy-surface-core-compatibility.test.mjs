import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadCoreSync} from '../../client/web/src/design/core.js';
import {targetDef} from '../../client/web/src/game/combat.js';
const root=fileURLToPath(new URL('../../',import.meta.url)),read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const upgradedPath=process.env.TG_NEW_MAIN_WASM||path.join(root,'target/wasm32-unknown-unknown/release/tg_design_wasm.wasm');
const priorPath=process.env.TF_LEGACY_SURFACE_CORE_BASE_WASM||fileURLToPath(new URL('../../../task/provenance-recovery-20261026/original-active/surfaceCore.wasm',import.meta.url));
const priorBytes=fs.readFileSync(priorPath),priorSha256=crypto.createHash('sha256').update(priorBytes).digest('hex');
assert.equal(priorSha256,'f88569767f73e291a32c0a7c7b983126075f60a1c0d08f652af60cd99f78c83c','Only the preserved original-active legacy surface core is accepted');
const init={materials:read('data/materials.json'),catalog:read('data/design_catalog.json'),terrains:read('data/terrains.json')};
const base='data/vehicles/ru_pantsir_sm_sv/',bundle=Object.fromEntries(['vehicle','weapons','visual','armor','modules','crew'].map(k=>[k,read(base+k+'.json')]));bundle.surfaceArmor=read(base+'surface_armor.json');
const def={...targetDef('pantsir-legacy-triangle-proof',bundle,0,read('data/machine_guns.json')),surfaces:bundle.surfaceArmor};
const upgraded=loadCoreSync(fs.readFileSync(upgradedPath),init),prior=loadCoreSync(priorBytes,init);for(const core of [upgraded,prior])core.combatTarget(def);
const raw=read('data/aircraft/frontline.json').shells.ap_50_mk214a;
const shot=(core,origin,dir,yaw=0,shell=raw)=>core.combatShoot(def.id,core.combatNew(def.id).state,{shell,origin,dir,speed_ms:500,distance_m:500,seed:'5',turret_yaw:yaw});
const receipt={schema:'LegacyTriangleSurfaceCoreCompatibilityV1',upgraded:{path:upgradedPath,sha256:crypto.createHash('sha256').update(fs.readFileSync(upgradedPath)).digest('hex')},prior:{path:priorPath,sha256:priorSha256},vehicle:'ru_pantsir_sm_sv',surfaceGeometryHash:bundle.surfaceArmor.geometry_hash,cases:[]};
test('rebuilt main core preserves exact legacy Pantsir front/side/rotated-turret contacts and open chassis gap',()=>{
 const solid={...raw,explosive_mass_kg:0,explosive_type:'none'};
 for(const [name,origin,dir,yaw]of [['front',[-.5,1.2,40],[0,0,-1],0],['side',[40,2.3,.6],[-1,0,0],0],['rotated_turret',[40,2.3,.86],[-1,0,0],Math.PI/2],['open_chassis_gap',[0,.1,40],[0,0,-1],0]]){
  const old=shot(prior,origin,dir,yaw,solid),next=shot(upgraded,origin,dir,yaw,solid);assert.equal(next.hit,old.hit,name);assert.equal(next.plate,old.plate,name);assert.equal(next.layers.length,old.layers.length,name);
  for(let i=0;i<old.layers.length;i++){assert.equal(next.layers[i].plate,old.layers[i].plate,name);assert.deepEqual(next.layers[i].point,old.layers[i].point,name);assert.equal(next.layers[i].thickness_mm,old.layers[i].thickness_mm,name);}
  if(name==='open_chassis_gap')assert.equal(next.hit,false,'an actual open region must stay a miss');else assert.ok(next.layers.some(l=>l.plate.startsWith('surf:')));
  receipt.cases.push({name,hit:next.hit,plate:next.plate,first:next.layers[0]?.point||null,layers:next.layers.length});
 }
});
test('legacy triangle lane uses actual MK214 17g PETN and records delayed bursts through multiple Pantsir paths',()=>{
 let timed=0,inside=0,oldLost=0;
 for(const x of [-.8,-.5,0,.5,.8])for(const y of [1,1.2,1.4,1.6]){
  const old=shot(prior,[x,y,40],[0,0,-1]),next=shot(upgraded,[x,y,40],[0,0,-1]);
  assert.equal(next.plate,old.plate,`first model contact ${x}/${y}`);
  for(const burst of next.bursts){if(burst.mechanism!=='delayed_aphe')continue;timed++;inside+=Number(burst.inside);assert.ok(Math.abs(burst.explosive_kg-.017)<1e-6);assert.ok(Math.abs(burst.time_s-burst.armed_at_s-.0024)<1e-7);assert.ok(burst.detonation_id);}
  if(next.bursts.length&&!old.bursts.length)oldLost++;
 }
 assert.ok(timed>=3,`enough real triangle paths should produce timed APHE bursts: ${timed}`);assert.ok(inside>=3,`inside delayed bursts: ${inside}`);
 receipt.aphe={samples:20,timed,inside,oldLost,actualFillerGrams:17,explosiveType:'petn',delay_s:.0024};
 if(process.env.TG_SURFACE_COMPAT_RECEIPT)fs.writeFileSync(process.env.TG_SURFACE_COMPAT_RECEIPT,JSON.stringify(receipt,null,2)+'\n');
});
