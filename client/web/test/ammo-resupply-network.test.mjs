import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runtime } from './live-network-rig.mjs';
import { roundsLeft } from '../src/game/loadout.js';
import { NetClient, roomGameplayProfile } from '../src/game/net.js';
import { Combat } from '../src/game/combat.js';
import { loadCoreSync } from '../src/design/core.js';
import { loadData } from '../tools/load-data.mjs';

const root=new URL('../../../',import.meta.url);
const sourceNames=['Cargo.toml','config/gameplay-modes.json','crates/gameplay/Cargo.toml','crates/gameplay/src/lib.rs','crates/server/Cargo.toml','crates/server/src/gameplay.rs','crates/server/src/gameplay_tests.rs','crates/server/src/lobby.rs','crates/server/src/missiles.rs','crates/server/src/server.rs','crates/server/src/ammo.rs','crates/server/src/ammo_tests.rs','config/ammo-resupply.json','crates/combat/src/lib.rs','crates/combat/src/weapon_damage.rs','crates/missile/src/world.rs','crates/missile/src/def.rs'];
const receiptPath=process.env.TG_AMMO_RESUPPLY_RECEIPT||new URL('target/ammo-resupply-network.json',root);
assert.ok(fs.existsSync(receiptPath),'Generate the actual native ammunition handler receipt before replay');
const receipt=JSON.parse(fs.readFileSync(receiptPath,'utf8'));
assert.deepEqual(Object.keys(receipt.sources).sort(),sourceNames.slice().sort(),'Every source/config tag is mandatory before replay');
for(const [name,bytes]of Object.entries(receipt.sources))assert.equal(fs.readFileSync(new URL(name,root),'utf8'),bytes,`Stale native receipt: ${name}`);
assert.equal(receipt.ammo_protocol_version,1);
const data=loadData();
const core=loadCoreSync(fs.readFileSync(process.env.TG_TEST_WASM||new URL('../assets/tg_design.wasm',import.meta.url)),{materials:data.materials,catalog:data.designCatalog,terrains:Object.values(data.terrains)});
const packets=(s,name,t=null)=>s.phases[name].filter(([to,m])=>to===s.owner&&(!t||m.t===t)).map(([,m])=>structuredClone(m));
const packet=(s,name,t)=>packets(s,name,t)[0];
const replay=(r,s,name,t=null)=>{for(const m of packets(s,name,t))r.net._receive(m);};
function initialized(s) {
  const r=runtime(s.mode==='historical'?'casual':'historical');
  for(const phase of ['welcome','create','join','start','deploy'])replay(r,s,phase);
  assert.equal(r.G.mode,'battle');assert.deepEqual(r.onlineAmmo.counts(),s.selected);
  r.G.combat=new Combat(core,data.machineGuns);const state=r.G.combat.fresh(r.G.combatKey,r.G.bundle);r.G.cstate=state.state;r.G.caps=state.caps;
  r.G.carried=-1;return r;
}
function prediction(r,seq,ti,gi) {
  const gun=r.G.loadout.turrets[ti].guns[gi],shot={seq};r.G.shots.push(shot);
  assert.ok(r.onlineFires.begin({seq,scope:r.onlineAmmo.scope(),gun,ammo:gun.ammo[gun.loaded],loading:r.G.T[ti].loading,ti,gi,session:r.G.online,shot},performance.now()/1000));
  assert.ok(r.onlineAmmo.predictCannon(seq,gun.damageKey,gun.ammo[gun.loaded].shell.id));r.G.online.seq=Math.max(r.G.online.seq,seq);return shot;
}
test('actual scoped cannon receipts cover predictions rejection gaps duplicate initialization and resume',()=>{
  for(const s of Object.values(receipt.scenarios).filter(s=>s.vehicle==='su_bmpt34')){
    const r=initialized(s),gun=r.G.loadout.turrets[0].guns[0],loading=r.G.T[0].loading;
    replay(r,s,'start');replay(r,s,'deploy');assert.equal(r.G.loadout.turrets[0].guns[0],gun);assert.equal(r.G.T[0].loading,loading);
    prediction(r,41,0,0);assert.equal(roundsLeft(gun),6);replay(r,s,'cannon');assert.equal(roundsLeft(gun),6);assert.equal(r.onlineFires.pending.length,0);
    const rejected=prediction(r,44,0,0);assert.equal(roundsLeft(gun),5);replay(r,s,'unchanged_reject','fire_rejected');assert.equal(roundsLeft(gun),5,'terminal effects do not refund counts directly');assert.ok(!r.G.shots.includes(rejected));
    replay(r,s,'unchanged_reject','ammo');assert.equal(roundsLeft(gun),6);assert.equal(r.onlineAmmo.processedThrough,44);replay(r,s,'lower');assert.equal(roundsLeft(gun),6);
    replay(r,s,'at_4_75');assert.equal(r.G.resupplyProgress,.95);replay(r,s,'at_5');assert.equal(roundsLeft(gun),7);
    const before=structuredClone(r.G.cstate.modules);prediction(r,45,0,0);const projected=r.onlineAmmo.counts();
    replay(r,s,'resume');assert.equal(r.G.loadout.turrets[0].guns[0],gun);assert.deepEqual(r.onlineAmmo.counts(),projected);assert.equal(r.onlineFires.pending.length,1);assert.equal(r.G.online.seq,45);assert.deepEqual(r.G.cstate.modules,before);
    replay(r,s,'new_life');assert.notEqual(r.G.loadout.turrets[0].guns[0],gun);assert.equal(r.onlineAmmo.scope().life,2);assert.equal(r.onlineFires.pending.length,0);const current=r.onlineAmmo.counts();
    replay(r,s,'old_scope');assert.deepEqual(r.onlineAmmo.counts(),current);replay(r,s,'enemy_deploy');replay(r,s,'contested');assert.equal(r.G.resupplyProgress,0);
  }
});
test('actual delayed last-rail ACK adopts absolute inventory before or after refill without another spend',()=>{
  for(const s of Object.values(receipt.scenarios).filter(s=>s.vehicle==='su_bmpt34'))for(const order of ['ack_first','inventory_first','refill_first']){
    const r=initialized(s),gun=r.G.loadout.turrets[0].guns[2],L=r.G.T[0].loading,ack=packet(s,'rail','launched');
    const msg={t:'launch',seq:ack.seq,ammo_scope:ack.ammo_scope,instance:gun.damageKey,missile:ack.missile,ammo:gun.ammo[gun.loaded].shell.id,o:ack.o,d:ack.d};
    assert.ok(r.onlineLaunches.begin({gun,loading:L,ti:0,gi:2,msg,session:r.G.online},0));
    replay(r,s,'empty_rail');assert.equal(roundsLeft(gun),1);assert.equal(r.G.loadout.turrets[0].guns[3].ammo[0].count,0);
    if(order==='ack_first')r.net._receive(ack);
    replay(r,s,'rail','ammo');assert.equal(roundsLeft(gun),0);if(order!=='ack_first')assert.equal(gun.launcher.ready,1,'absolute zero leaves the pending tube alone');
    if(order==='inventory_first')r.net._receive(ack);
    if(order==='refill_first'){replay(r,s,'at_4_75');replay(r,s,'at_5');assert.equal(roundsLeft(gun),1);assert.equal(gun.launcher.ready,1);r.net._receive(ack);assert.equal(L.state[2],'waiting');}
    else assert.equal(L.state[2],'empty');
    assert.equal(gun.launcher.nextTube,1);assert.equal(gun.launcher.ready,0);assert.equal(gun.launcher.cooldown,.25/(s.mode==='casual'?1.2:1));
    const count=roundsLeft(gun),effects=r.G.launchEffects;replay(r,s,'rail_retry');assert.equal(roundsLeft(gun),count);assert.equal(gun.launcher.nextTube,1);assert.equal(r.G.launchEffects,effects);
    const preserved=L;replay(r,s,'deploy');assert.equal(r.G.loadout.turrets[0].guns[2],gun);assert.equal(r.G.T[0].loading,preserved);assert.equal(gun.launcher.nextTube,1);
  }
});
test('actual automatic Oplot messages debit the manual pool and stale bare APS snapshots cannot erase refill',()=>{
  for(const s of Object.values(receipt.scenarios).filter(s=>s.vehicle!=='su_bmpt34')){
    const r=initialized(s),gun=r.G.loadout.turrets[1].guns[0];prediction(r,41,1,0);replay(r,s,'manual');assert.equal(roundsLeft(gun),129);
    replay(r,s,'automatic');const auto=roundsLeft(gun);assert.ok(auto<129&&auto>0);
    replay(r,s,'manual_empty');assert.equal(roundsLeft(gun),0);replay(r,s,'at_4_75');assert.equal(r.G.resupplyProgress,.95);replay(r,s,'at_5');assert.equal(roundsLeft(gun),130);
    const counts=r.onlineAmmo.counts();replay(r,s,'automatic','snap');assert.deepEqual(r.onlineAmmo.counts(),counts);assert.equal(roundsLeft(gun),130,'an old unversioned APS snapshot cannot debit replenished inventory');
    replay(r,s,'reload_reject');assert.equal(roundsLeft(gun),130);
    replay(r,s,'reload_hostile');assert.equal(roundsLeft(gun),130);assert.equal(r.G.apsState.enabled,false);
    assert.ok(packets(s,'reload_hostile','snap').every(m=>(m.fired||[]).length===0),'actual incoming missiles produce no APS shots during reload');
    replay(r,s,'before_ready');assert.equal(roundsLeft(gun),130);assert.equal(r.G.apsState.enabled,false);replay(r,s,'ready');assert.equal(r.G.apsState.enabled,true);assert.equal(roundsLeft(gun),130);
    replay(r,s,'recovered');assert.ok(roundsLeft(gun)<130);assert.equal(r.G.apsState.enabled,true);assert.ok(r.G.apsState.spin>0);assert.ok(r.G.apsState.tracks>0);
    assert.ok(r.G.cstate.rack_fill.some(n=>n>0));assert.equal(r.G.carried,r.G.loadout.turrets.flatMap(t=>t.guns).reduce((n,g)=>n+roundsLeft(g),0));
  }
});
test('missing malformed or mismatched ammunition capability is refused before room admission',()=>{
  const s=receipt.scenarios.bmpt_historical,welcome=packet(s,'welcome','welcome'),room=packet(s,'create','room');
  for(const value of [undefined,null,'1',0,2,1.5]){const net=new NetClient(),errors=[];net.on('error',m=>errors.push(m.msg));assert.equal(net._receive({...welcome,ammo_protocol_version:value}),false);assert.equal(net.ammoSupported,false);assert.equal(net.room,null);assert.ok(errors.some(m=>m.includes('更新')));assert.throws(()=>roomGameplayProfile({...room.room,ammo_protocol_version:value}));}
});
test('malformed current-life frames and malformed new-life initialization leave actual mounts unchanged',()=>{
  const s=receipt.scenarios.bmpt_historical,r=initialized(s),original=r.G.loadout.turrets[0].guns[0],counts=r.onlineAmmo.counts(),scope=r.onlineAmmo.scope(),initial=packet(s,'deploy','ammo');
  const errors=[],old=console.error;console.error=(...args)=>errors.push(args);
  try{
    for(const change of [{counts:{}},{targets:{...initial.targets,'gun:0:2':[0]}},{resupply_progress:2},{ammo_protocol_version:'1'}])r.net._receive({...initial,revision:99,...change});
    const spawn=packet(s,'new_life','respawned');r.net._receive({...spawn,ammo:{...spawn.ammo,counts:{}}});
    const start=packet(s,'start','start'),me=start.members.find(m=>m.id===s.owner);me.alive=true;me.vehicle=s.vehicle;
    r.net._receive({...start,battle:scope.battle+1,ammo:{...initial,battle:scope.battle+1,counts:{}}});
  }finally{console.error=old;}
  assert.equal(errors.length,6);assert.equal(r.G.mode,'battle');assert.equal(r.G.loadout.turrets[0].guns[0],original);assert.deepEqual(r.onlineAmmo.counts(),counts);assert.deepEqual(r.onlineAmmo.scope(),scope);
});
test('missing receipt missing mandatory source and replaced source fail before any replay',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tankforge-ammo-receipt-'));
  try{for(const variant of ['missing_receipt','missing_tag','stale_tag']){
    const file=path.join(dir,variant+'.json');if(variant!=='missing_receipt'){const altered=structuredClone(receipt);if(variant==='missing_tag')delete altered.sources['crates/server/src/ammo.rs'];else altered.sources['crates/server/src/ammo.rs']='stale tagged bytes';fs.writeFileSync(file,JSON.stringify(altered));}
    const childEnv={...process.env,TG_AMMO_RESUPPLY_RECEIPT:file};delete childEnv.NODE_TEST_CONTEXT;
    const result=spawnSync(process.execPath,['--test',fileURLToPath(import.meta.url)],{encoding:'utf8',env:childEnv});assert.notEqual(result.status,0);assert.match(result.stdout+result.stderr,/before replay|before this suite|before replay|Stale native receipt|Every source\/config tag|Generate the actual native/);
  }}finally{assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('tankforge-ammo-receipt-'));fs.rmSync(dir,{recursive:true,force:true});}
});
