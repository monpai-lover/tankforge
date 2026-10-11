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
import { Missiles } from '../src/game/missiles.js';

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
  const r=runtime(s.mode==='historical'?'casual':'historical',{combat:new Combat(core,data.machineGuns)});
  for(const phase of ['welcome','create','join','start','deploy'])replay(r,s,phase);
  assert.equal(r.G.mode,'battle');assert.deepEqual(r.onlineAmmo.counts(),s.selected);
  return r;
}
function prediction(r,seq,ti,gi) {
  const gun=r.G.loadout.turrets[ti].guns[gi],shot={seq};r.G.shots.push(shot);
  assert.ok(r.onlineFires.begin({seq,scope:r.onlineAmmo.scope(),gun,ammo:gun.ammo[gun.loaded],loading:r.G.T[ti].loading,ti,gi,session:r.G.online,shot},performance.now()/1000));
  assert.ok(r.onlineAmmo.predictCannon(seq,gun.damageKey,gun.ammo[gun.loaded].shell.id));r.G.online.seq=Math.max(r.G.online.seq,seq);return shot;
}
test('actual scoped cannon receipts cover predictions rejection gaps duplicate initialization and resume',()=>{
  for(const s of Object.values(receipt.scenarios).filter(s=>s.vehicle==='su_bmpt34')){
    const r=initialized(s),gun=r.G.loadout.turrets[0].guns[0],loading=r.G.T[0].loading;
    replay(r,s,'start');replay(r,s,'deploy');assert.equal(r.G.online.dead,false);assert.equal(r.G.online.benched,false);assert.equal(r.G.loadout.turrets[0].guns[0],gun);assert.equal(r.G.T[0].loading,loading);
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
    assert.ok(r.G.cstate.rack_fill.some(n=>n>0));assert.deepEqual(r.G.cstate,packet(s,'recovered','status').state);
    assert.equal(Object.values(r.onlineAmmo.counts()).flat().reduce((n,c)=>n+c,0),r.G.loadout.turrets.flatMap(t=>t.guns).reduce((n,g)=>n+roundsLeft(g),0));
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
test('actual resume Start recovers dropped deploy and respawn replies and rejects malformed recovery atomically',()=>{
  for(const s of Object.values(receipt.scenarios).filter(s=>s.vehicle==='su_bmpt34')){
    const r=runtime('historical');for(const phase of ['welcome','create','join','start'])replay(r,s,phase);
    assert.equal(r.G.online.benched,true);assert.equal(r.onlineAmmo.scope(),null);
    const original=r.G.loadout,errors=[],old=console.error;console.error=(...a)=>errors.push(a);
    try{const start=packet(s,'deploy_resume','start');r.net._receive({...start,ammo:{...start.ammo,counts:{}}});}finally{console.error=old;}
    assert.equal(errors.length,1);assert.equal(r.G.loadout,original);assert.equal(r.onlineAmmo.scope(),null);assert.equal(r.G.online.benched,true);
    replay(r,s,'deploy_resume');assert.equal(r.G.online.benched,false);assert.equal(r.G.online.dead,false);assert.equal(r.onlineAmmo.scope().life,1);assert.deepEqual(r.onlineAmmo.counts(),s.selected);
    const gun=r.G.loadout.turrets[0].guns[0],L=r.G.T[0].loading;r.G.apsOn=false;prediction(r,200,0,0);
    replay(r,s,'deploy_resume');assert.equal(r.G.loadout.turrets[0].guns[0],gun);assert.equal(r.G.T[0].loading,L);assert.equal(r.G.apsOn,false);assert.equal(r.onlineFires.pending.length,1);
    const bad=packet(s,'new_life_resume','start');console.error=(...a)=>errors.push(a);try{r.net._receive({...bad,ammo:{...bad.ammo,counts:{}}});}finally{console.error=old;}
    assert.equal(errors.length,2);assert.equal(r.G.loadout.turrets[0].guns[0],gun);assert.equal(r.G.T[0].loading,L);assert.equal(r.onlineAmmo.scope().life,1);assert.equal(r.onlineFires.pending.length,1);
    replay(r,s,'new_life_resume');assert.equal(r.onlineAmmo.scope().life,2);assert.equal(r.G.online.dead,false);assert.notEqual(r.G.loadout.turrets[0].guns[0],gun);assert.equal(r.onlineFires.pending.length,0);
    const current=r.G.loadout,counts=r.onlineAmmo.counts();replay(r,s,'deploy_resume');assert.equal(r.G.loadout,current);assert.deepEqual(r.onlineAmmo.counts(),counts);
  }
});
test('actual selected BMPT life fits visible payload and live cannon firing without local online rack writes',()=>{
  const s=receipt.scenarios.bmpt_historical,r=initialized(s),g=r.G.loadout.turrets[0].guns[1],zero=r.G.loadout.turrets[0].guns[3];
  assert.equal(g.loaded,1);assert.equal(g.selected,1);assert.equal(g.belt,5);assert.equal(zero.loaded,-1);assert.equal(zero.launcher.ready,0);assert.equal(r.G.T[0].loading.state[3],'empty');
  const rail=r.G.model.turrets[0].guns[3];assert.ok(rail.rounds.some(Boolean));assert.ok(rail.rounds.filter(Boolean).every(n=>n.visible===false),'actual empty rail payload is hidden');
  const sent=[];r.net.status='open';r.net.ws={readyState:1,send:m=>sent.push(JSON.parse(m))};let localWrites=0;r.G.combat.ammo=()=>{localWrites++;throw new Error('online rack writes must use server Status');};
  r.G.online.seq=45;r.G.veh.place(0,0,0);r.G.veh.compat(r.G.s);
  assert.equal(r.live.fireGun(0,1),true);assert.equal(sent.at(-1).shell,g.ammo[1].shell.id);assert.equal(roundsLeft(g),4);assert.equal(g.belt,4);
  replay(r,s,'secondary_cannon');assert.equal(roundsLeft(g),4);assert.equal(r.onlineFires.pending.length,0);assert.equal(localWrites,0);assert.deepEqual(r.G.cstate,packet(s,'secondary_cannon','status').state);
});
test('actual authoritative progress is displayed and current grants toast once while lifecycle clears stale UI',()=>{
  const s=receipt.scenarios.bmpt_historical,r=initialized(s);replay(r,s,'conquest');replay(r,s,'cannon');replay(r,s,'at_4_75');r.live.conquestStep(100);
  assert.match(r.ui.cqMsg.textContent,/彈藥補給 95%/);assert.equal(r.G.loadout.turrets[0].guns[0].ammo[0].count,6,'online HUD cannot make a local grant');
  replay(r,s,'at_5');replay(r,s,'at_5');assert.equal(r.notices.filter(n=>n.text==='彈藥已補滿').length,1);r.live.conquestStep(.01);assert.doesNotMatch(r.ui.cqMsg.textContent,/彈藥補給/);
  replay(r,s,'new_life');replay(r,s,'at_5');assert.equal(r.notices.filter(n=>n.text==='彈藥已補滿').length,1,'old-life grants are inert');
  for(const [before,loss,after] of [['owner_before_exit','owner_exit','owner_after_reentry'],['enemy_before_entry','enemy_entry','enemy_after_exit'],['stale_before_refresh','stale_refresh','stale_after_refresh']]){
    replay(r,s,before);r.live.conquestStep(.01);assert.match(r.ui.cqMsg.textContent,/95%/);replay(r,s,loss);r.live.conquestStep(.01);assert.doesNotMatch(r.ui.cqMsg.textContent,/彈藥補給/);replay(r,s,after);assert.ok(r.G.resupplyProgress<.1);assert.equal(r.G.loadout.turrets[0].guns[0].ammo[0].count,6);
  }
  r.live.markDead(null);assert.equal(r.G.resupplyProgress,0);assert.equal(r.ui.cqMsg.textContent,'');
  const connected=initialized(s);replay(connected,s,'conquest');replay(connected,s,'at_4_75');connected.live.conquestStep(.01);connected.net._emit('reconnecting',{});assert.equal(connected.G.resupplyProgress,0);assert.equal(connected.ui.cqMsg.textContent,'');
});
test('actual scoped rack Status admits either delivery order and preserves authoritative damage while rejecting old updates',()=>{
  const s=receipt.scenarios.bmpt_historical;
  for(const order of ['status_first','ammo_first']){
    const r=initialized(s);let writes=0;r.G.combat.ammo=()=>{writes++;throw new Error('local projection is forbidden online');};
    const ammo=packet(s,'cannon','ammo'),status=packet(s,'cannon','status');for(const m of order==='status_first'?[status,ammo]:[ammo,status])r.net._receive(m);
    assert.deepEqual(r.G.cstate,status.state);const retained=structuredClone(r.G.cstate);replay(r,s,'at_5');const grant=packet(s,'at_5','status');assert.deepEqual(r.G.cstate,grant.state);assert.deepEqual(r.G.cstate.modules,retained.modules);assert.deepEqual(r.G.cstate.crew,retained.crew);assert.equal(r.G.cstate.fire_s,retained.fire_s);assert.equal(r.G.cstate.repair_s,retained.repair_s);
    const current=structuredClone(r.G.cstate);r.net._receive(status);r.net._receive({...grant,ammo_scope:{...grant.ammo_scope,life:0},ammo_revision:999});r.net._receive({...grant,ammo_scope:{...grant.ammo_scope,life:2},ammo_revision:999});assert.deepEqual(r.G.cstate,current);assert.equal(writes,0);
  }
});
test('actual newer inventory from dead resume fences delayed rack Status without changing confirmed stock',()=>{
  for(const s of Object.values(receipt.scenarios).filter(s=>s.vehicle==='su_bmpt34')){
    const dead=initialized(s);replay(dead,s,'cannon');const delayed=packet(s,'rail','status');
    assert.ok(delayed.ammo_revision>dead.G.online.ammoRackStatus.revision,'delayed rack mutation crosses the prior Status watermark');
    replay(dead,s,'dead_resume');const snapshot=packet(s,'dead_resume','status'),counts=dead.onlineAmmo.counts(),targets=dead.G.loadout.turrets.flatMap(t=>t.guns.map(g=>g.ammo.map(a=>a.max))),state=JSON.stringify(dead.G.cstate),caps=JSON.stringify(dead.G.caps);
    assert.equal(snapshot.ammo_revision,undefined);assert.equal(dead.G.cstate.destroyed,true);assert.equal(dead.G.online.dead,true);
    dead.net._receive(delayed);assert.equal(JSON.stringify(dead.G.cstate),state);assert.equal(JSON.stringify(dead.G.caps),caps);assert.deepEqual(dead.onlineAmmo.counts(),counts);assert.deepEqual(dead.G.loadout.turrets.flatMap(t=>t.guns.map(g=>g.ammo.map(a=>a.max))),targets);
    replay(dead,s,'dead_resume');assert.equal(JSON.stringify(dead.G.cstate),state);assert.equal(JSON.stringify(dead.G.caps),caps);assert.deepEqual(dead.onlineAmmo.counts(),counts);
  }
});
test('actual newer inventory fences unseen older rack Status while equal current Status remains admissible',()=>{
  for(const s of Object.values(receipt.scenarios).filter(s=>s.vehicle==='su_bmpt34')){
    const refilled=initialized(s);replay(refilled,s,'cannon','ammo');replay(refilled,s,'at_5','ammo');const before=refilled.G.cstate,stock=refilled.onlineAmmo.counts();
    refilled.net._receive(packet(s,'cannon','status'));assert.equal(refilled.G.cstate,before,'an earlier unseen rack Status cannot pass a newer confirmed Ammo revision');assert.deepEqual(refilled.onlineAmmo.counts(),stock);
    const grant=packet(s,'at_5','status');refilled.net._receive(grant);assert.deepEqual(refilled.G.cstate,grant.state,'equal-revision current Status remains admissible after Ammo');assert.deepEqual(refilled.G.caps,grant.caps);
    const admitted=refilled.G.cstate;refilled.net._receive(grant);assert.equal(refilled.G.cstate,admitted,'last accepted Status still deduplicates equal-revision rack mutations');assert.deepEqual(refilled.onlineAmmo.counts(),stock);
  }
});
test('actual scope-only combat snapshot covers current racks while still admitting damage at the same ammo revision',()=>{
  for(const s of Object.values(receipt.scenarios).filter(s=>s.vehicle==='su_bmpt34')){
    const snapshot=packet(s,'dead_resume','status');
    const missed=initialized(s);replay(missed,s,'dead_resume');const covered=JSON.stringify(missed.G.cstate),stock=missed.onlineAmmo.counts();
    replay(missed,s,'secondary_cannon','status');assert.equal(JSON.stringify(missed.G.cstate),covered,'a current full snapshot already covers the delayed equal inventory rack revision');assert.deepEqual(missed.onlineAmmo.counts(),stock);
    const sameRevision=initialized(s);replay(sameRevision,s,'secondary_cannon');const live=JSON.stringify(sameRevision.G.cstate);replay(sameRevision,s,'dead_resume');
    assert.notEqual(JSON.stringify(sameRevision.G.cstate),live);assert.equal(sameRevision.G.cstate.destroyed,true,'scope-only combat state must be admitted even when ammo revision did not change');assert.deepEqual(sameRevision.G.cstate,snapshot.state);assert.deepEqual(sameRevision.G.caps,snapshot.caps);
    const deadState=JSON.stringify(sameRevision.G.cstate);replay(sameRevision,s,'secondary_cannon','status');assert.equal(JSON.stringify(sameRevision.G.cstate),deadState);
  }
});
test('actual recipient-qualified APS snapshots preserve remote presentation without private rounds',()=>{
  for(const s of Object.values(receipt.scenarios).filter(s=>s.vehicle!=='su_bmpt34')){
    const messages=s.phases.automatic.filter(([to,m])=>to===s.enemy&&m.t==='snap').map(([,m])=>m);assert.ok(messages.length);
    const presentation={nodes:new Map(),defs:{},aps:new Map(),_fired(){},_event(){},_drop(){}};
    for(const m of messages)Missiles.prototype.present.call(presentation,{missiles:m.ms,aps:m.aps,fired:m.fired,events:m.ev},.05);
    const remote=presentation.aps.get(s.owner);assert.ok(remote);assert.equal(Object.hasOwn(remote,'rounds'),false);for(const field of ['yaw','pitch','spin','heat'])assert.ok(Number.isFinite(remote[field]));
    const own=packet(s,'automatic','snap').aps.find(a=>a.owner===s.owner);assert.ok(Number.isInteger(own.rounds));
  }
});
test('actual recovered nonzero spawn belongs to the new incarnation while dead Start cannot revive it',()=>{
  const s=receipt.scenarios.bmpt_historical,r=runtime('historical');for(const phase of ['welcome','create','join','start'])replay(r,s,phase);
  replay(r,s,'deploy_resume');assert.equal(r.G.online.spawn,1);const first=r.G.map.spawns.blue[1%r.G.map.spawns.blue.length];assert.equal(r.G.s.x,first.x);assert.equal(r.G.s.z,first.z);
  const gun=r.G.loadout.turrets[0].guns[0],L=r.G.T[0].loading;r.G.veh.place(17,29,0);r.G.veh.compat(r.G.s);replay(r,s,'deploy_resume');assert.equal(r.G.s.x,17);assert.equal(r.G.s.z,29);assert.equal(r.G.loadout.turrets[0].guns[0],gun);assert.equal(r.G.T[0].loading,L);
  replay(r,s,'dead_resume');assert.equal(r.G.online.dead,true);assert.equal(r.G.online.benched,true);assert.equal(r.G.resupplyProgress,0);assert.equal(r.onlineAmmo.scope().life,1);
  replay(r,s,'new_life_resume');assert.equal(r.G.online.spawn,2);assert.equal(r.G.online.dead,false);const second=r.G.map.spawns.blue[2%r.G.map.spawns.blue.length];assert.equal(r.G.s.x,second.x);assert.equal(r.G.s.z,second.z);
  const dead=initialized(s),held=dead.G.loadout;
  const returned=s.dead_recovery.phases.resume.filter(([to])=>to===s.owner).map(([,m])=>m);for(const m of returned)dead.net._receive(m);
  assert.equal(dead.onlineAmmo.scope().life,2);assert.equal(dead.G.online.spawn,2);assert.equal(dead.G.online.dead,true);assert.equal(dead.G.online.benched,true);assert.equal(dead.G.resupplyProgress,0);assert.notEqual(dead.G.loadout,held);
  const status=returned.find(m=>m.t==='status');assert.deepEqual(dead.G.cstate,status.state);assert.equal(dead.G.caps.destroyed,true);assert.equal(dead.live.fireGun(0,1),false);
});
test('actual dead recovery validates spawn and stock atomically and admits a retained life from the garage',()=>{
  const s=receipt.scenarios.bmpt_historical,returned=s.dead_recovery.phases.resume.filter(([to])=>to===s.owner).map(([,m])=>structuredClone(m)),start=returned.find(m=>m.t==='start');
  const r=initialized(s),loadout=r.G.loadout,scope=r.onlineAmmo.scope(),spawn=r.G.online.spawn,errors=[],old=console.error;
  for(const bad of [{...start,spawn:-1},{...start,spawn:1.5},{...start,spawn:undefined},{...start,ammo:{...start.ammo,counts:{}}}]){
    console.error=(...a)=>errors.push(a);try{r.net._receive(bad);}finally{console.error=old;}
    assert.equal(r.G.loadout,loadout);assert.deepEqual(r.onlineAmmo.scope(),scope);assert.equal(r.G.online.spawn,spawn);assert.equal(r.G.online.dead,false);assert.equal(r.G.online.benched,false);
  }
  assert.equal(errors.length,4);
  const fresh=runtime('casual',{combat:new Combat(core,data.machineGuns)});for(const phase of ['welcome','create','join'])replay(fresh,s,phase);
  for(const m of returned)fresh.net._receive(m);
  assert.equal(fresh.G.id,'su_bmpt34');assert.equal(fresh.onlineAmmo.scope().life,2);assert.equal(fresh.G.online.spawn,2);assert.equal(fresh.G.online.dead,true);assert.equal(fresh.G.online.benched,true);assert.equal(fresh.G.resupplyProgress,0);
  assert.deepEqual(fresh.G.cstate,returned.find(m=>m.t==='status').state);assert.equal(fresh.live.fireGun(0,1),false);
});
test('actual refill Status retains damaged modules crew fire and ongoing repair without an online projection',()=>{
  const s=receipt.scenarios.bmpt_historical,r=initialized(s);replay(r,s,'new_life');replay(r,s,'stale_after_refresh');let writes=0;r.G.combat.ammo=()=>{writes++;throw new Error('server racks only');};
  replay(r,s,'damage_before_refill');const before=structuredClone(r.G.cstate);assert.ok(before.repair_s>0);assert.ok(before.fire_s>0);assert.ok(before.crew.some(n=>n<100));
  replay(r,s,'damage_refill');assert.deepEqual(r.G.cstate,packet(s,'damage_refill','status').state);assert.notDeepEqual(r.G.cstate.rack_fill,before.rack_fill);for(const field of ['modules','crew','roles','fire_s','repair_s'])assert.deepEqual(r.G.cstate[field],before[field]);assert.equal(writes,0);
});
