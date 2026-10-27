import {R7_AIRCRAFT_IDS,assertFlightKernelIdentity} from './fixtures/r7-aircraft-contract.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {exportProfiles} from '../tools/export_frontline_aircraft.mjs';

const root=new URL('../../',import.meta.url);
const profile=JSON.parse(fs.readFileSync(new URL('data/aircraft/frontline.json',root),'utf8'));
const app=fs.readFileSync(new URL('handoff/bundle/app.js.html',root),'utf8');
const expected=R7_AIRCRAFT_IDS;

test('export deterministically matches actual production metadata/model sockets and original26 plus two inherited aircraft',async()=>{
  const fresh=await exportProfiles();
  const digest=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
  assert.equal(digest(fresh),digest(profile),'Run node handoff/tools/export_frontline_aircraft.mjs after changing source');
  assert.deepEqual(Object.keys(profile.aircraft).sort(),expected);
  assert.equal(Object.values(profile.aircraft).filter(a=>a.metadata.importedModel).length,17);
  assert.equal(profile.source.appSha256,crypto.createHash('sha256').update(app).digest('hex'));
  assert.equal(profile.source.baselineSha256,'7a35444f326a3234f7bdf6ad84ff8d2a561edc00d1824740ebc236dd6bf46bd4','The current tracked gzip data includes all three repaired Me262 variants and retains the earlier MiG17/F104 fixes');
  assert.equal(profile.aircraft.nf01.metadata.year,null);
  assert.equal(profile.aircraft.f104g.metadata.year,1960);
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'tankforge-air-data-pin-'));
  try{
    const unverified=path.join(temp,'data.line');fs.writeFileSync(unverified,'<script id="tf-data" type="application/json">{"aircraftModels":{}}</script>');
    await assert.rejects(exportProfiles({baseline:unverified}),/Only the verified tracked data/,'Unverified repair caches cannot silently become the source');
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
});

test('all28 exported configurations are accepted by source-matched real flight WASM',async()=>{
  const bytes=Buffer.from(app.match(/var FLIGHT_CORE_WASM = "([^"]+)"/)[1],'base64');
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),profile.source.flightWasmSha256);
  assertFlightKernelIdentity(bytes);
  const module=await WebAssembly.compile(bytes);
  for(const [id,a] of Object.entries(profile.aircraft)){
    for(const [key,count] of [['airframe',14],['configure',5],['control',4],['envelope',4]]){
      assert.equal(a.physics[key].length,count,id+':'+key);
      assert.ok(a.physics[key].every(Number.isFinite),id+':'+key);
    }
    if(a.physics.surfaces)assert.equal(a.physics.surfaces.length,17,id);
    else assert.ok(['nf01','nf02'].includes(id));
    const instance=await WebAssembly.instantiate(module,{math:{sin:Math.sin,cos:Math.cos,atan2:Math.atan2,exp:Math.exp,asin:Math.asin,acos:Math.acos},world:{ground:()=>0,landable:()=>1}});
    const api=instance.exports;
    assert.equal(api.core_version(),215);
    api.set_world(1);api.configure_airframe(...a.physics.airframe);
    if(a.physics.surfaces)api.configure_surfaces(...a.physics.surfaces);
    if(a.physics.gearSequence){assert.equal(a.physics.gearSequence.length,6);api.configure_gear_sequence(...a.physics.gearSequence);}
    api.configure_control(...a.physics.control);api.configure(...a.physics.configure);api.configure_envelope(...a.physics.envelope);
    api.spawn(0,1500,0,0,140,0);
    for(let k=0;k<12;k++)api.step(1/120,0,0,1,.78,0,0,0,1);
    const state=new Float32Array(api.memory.buffer,api.state_ptr(),api.state_len());
    assert.ok(state.every(Number.isFinite),id+' actual native telemetry');
    assert.ok(state[2]>0,id+' actual native forward flight');
  }
});

test('logical gun feeds, measured muzzles, live fuel tuples and full store warheads retain source data',()=>{
  const mig=profile.aircraft.mig15,f104=profile.aircraft.f104g;
  assert.deepEqual(mig.guns.map(g=>g.ammo),[80,80,40]);
  assert.deepEqual(mig.guns[0].muzzle,[-.22,-.54,4.136]);
  assert.equal(f104.guns.length,1);assert.equal(f104.guns[0].ammo,725);
  assert.deepEqual(f104.guns[0].muzzle,[-.49,-.47,5.818]);
  assert.notEqual(mig.physics.surfaces[8],.38,'imported mesh travel, not procedural fallback');
  const attack=profile.aircraft.a10a.guns[0];
  assert.equal(attack.belt.length,6);assert.equal(attack.belt.filter(id=>id==='api_30_pgu14').length,5);
  assert.equal(profile.aircraft.f86f.fuel.capacityKg,1300);
  assert.equal(profile.storeDefinitions.tank120.fuel,363);
  for(const a of Object.values(profile.aircraft))for(const g of [...a.guns,...a.stores.loadouts.flatMap(l=>l.gunPods)]){
    assert.equal(g.muzzle.length,3);assert.ok(g.muzzle.every(Number.isFinite));
    assert.ok(Math.abs(Math.hypot(...g.direction)-1)<1e-12);
    assert.ok(g.ammo>0&&g.rpm>0);
    for(const id of g.belt)assert.ok(profile.shells[id],id);
  }
  for(const [id,d] of Object.entries(profile.storeDefinitions))if(d.warhead){
    assert.equal(d.projectile_id,d.warhead.id,id);
    const p=profile.shells[d.projectile_id];
    assert.ok(p&&p.mass_kg>0&&p.caliber_mm>0,id);
    assert.ok(p.penetration_curve?.length>0,id+' actual template penetration curve');
    assert.equal(p.drag_coefficient,d.kind==='bomb'?.3:.4,id);
  }
  const pod=profile.storeDefinitions.lau3;
  assert.equal(pod.rocket_projectile_id,profile.storeDefinitions[pod.rockets].projectile_id);
  const podLoadout=profile.aircraft.su25.stores.loadouts.find(l=>l.gunPods.length);
  assert.ok(podLoadout);assert.deepEqual(podLoadout.gunPods.map(g=>g.ammo),[260,260]);
});

test('Me262 family exports real four-axis gear, fixed source barrels and individual source stores without renderer buffers',()=>{
 for(const [id,ammo,count]of [['me262',[100,100,80,80],24],['me262a2a',[100,100],2],['me262u4',[32],0]]){
  const a=profile.aircraft[id];assert.deepEqual(a.guns.map(g=>g.ammo),ammo);
  assert.deepEqual(a.physics.gearSequence,[1,3,3,1,.75,1]);
  assert.equal(a.physics.surfaces[16],0,id+' conventional elevator');
  for(const g of a.guns){assert.equal(g.mounts.length,1);assert.ok(g.mount[2]>3);}
  const items=a.stores.loadouts[1]?.items||[];assert.equal(items.length,count);
  assert.equal(new Set(items.map(i=>i.sourceStore.id)).size,count);
  for(const i of items){assert.equal(i.count,1);assert.ok(i.sourceStore.sourceParts.length);assert.ok(i.sourceMount.sourceParts.length);assert.equal(i.sourceStore.data,undefined);assert.equal(i.sourceMount.data,undefined);}
 }
});
