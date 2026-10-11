import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runtime } from './live-network-rig.mjs';
import { roundsLeft } from '../src/game/loadout.js';
import * as loadout from '../src/game/loadout.js';
import * as loading from '../src/sim/loading.js';
import { NetClient, roomGameplayProfile } from '../src/game/net.js';
import { Combat } from '../src/game/combat.js';
import { loadCoreSync } from '../src/design/core.js';
import { loadData } from '../tools/load-data.mjs';
import { Missiles } from '../src/game/missiles.js';
import * as selection from '../src/game/weaponselection.js';

const root=new URL('../../../',import.meta.url);
const sourceNames=['Cargo.toml','config/gameplay-modes.json','crates/gameplay/Cargo.toml','crates/gameplay/src/lib.rs','crates/server/Cargo.toml','crates/server/src/gameplay.rs','crates/server/src/gameplay_tests.rs','crates/server/src/lobby.rs','crates/server/src/missiles.rs','crates/server/src/server.rs','crates/server/src/ammo.rs','crates/server/src/ammo_tests.rs','config/ammo-resupply.json','crates/combat/src/lib.rs','crates/combat/src/weapon_damage.rs','crates/missile/src/world.rs','crates/missile/src/def.rs','crates/design-wasm/src/lib.rs','crates/missile/src/tests.rs','config/stabilizer-drives.json'];
const receiptPath=process.env.TG_AMMO_RESUPPLY_RECEIPT||new URL('target/weapon-control-ammo-network.json',root);
assert.ok(fs.existsSync(receiptPath),'Generate the actual native ammunition handler receipt before replay');
const receipt=JSON.parse(fs.readFileSync(receiptPath,'utf8'));
assert.deepEqual(Object.keys(receipt.sources).sort(),sourceNames.slice().sort(),'Every source/config tag is mandatory before replay');
for(const [name,bytes]of Object.entries(receipt.sources))assert.equal(fs.readFileSync(new URL(name,root),'utf8'),bytes,`Stale native receipt: ${name}`);
const gameplayReceipt=JSON.parse(fs.readFileSync(process.env.TG_GAMEPLAY_NETWORK_RECEIPT||new URL('target/weapon-control-gameplay-network.json',root),'utf8'));
assert.deepEqual(Object.keys(gameplayReceipt.sources).sort(),sourceNames.slice().sort());
for(const [name,bytes]of Object.entries(gameplayReceipt.sources))assert.equal(fs.readFileSync(new URL(name,root),'utf8'),bytes,`Stale gameplay receipt: ${name}`);
assert.equal(receipt.ammo_protocol_version,1);
const data=loadData();
const core=loadCoreSync(fs.readFileSync(process.env.TG_TEST_WASM||new URL('../assets/tg_design.wasm',import.meta.url)),{materials:data.materials,catalog:data.designCatalog,terrains:Object.values(data.terrains)});

test('aps_pose genuine warm handler outputs require the matching final-State acknowledgement and a later Snap',()=>{
  assert.deepEqual(Object.keys(receipt.aps_handoffs),Object.keys(gameplayReceipt.aps_handoffs));
  for(const key of Object.keys(receipt.aps_handoffs))for(const field of ['held','carried','before'])assert.deepEqual(receipt.aps_handoffs[key][field],gameplayReceipt.aps_handoffs[key][field],'both independently generated producers carry the same physical handler evidence');
  for(const s of Object.values(receipt.aps_handoffs)) {
    let clock=.01;const sent=[];
    const r=runtime(s.mode,{combat:new Combat(core,data.machineGuns),clock:{now:()=>clock*1000}});
    r.net.status='open';r.net.ws={readyState:1,send:text=>sent.push(JSON.parse(text))};
    for(const phase of ['welcome','create','start','deploy','initial_state','warm'])replay(r,s,phase);
    r.G.weaponControl={kind:'gun',ti:1,gi:0};r.live.syncApsControl();replay(r,s,'disable');
    const gun=r.G.loadout.turrets[1].guns[0],L=r.G.T[1].loading;
    r.G.online.seq=76;assert.equal(r.live.fireGun(1,0),true);replay(r,s,'manual');
    const t=r.G.loadout.turrets[1],seconds=loadout.reloadTime(t,0,0,s.mode);
    assert.deepEqual(loading.tick(L,seconds/2,(gi,li)=>loadout.reloadTime(t,gi,li,s.mode)),[],'actual normal loader remains busy');
    assert.deepEqual(loading.tick(L,seconds,(gi,li)=>loadout.reloadTime(t,gi,li,s.mode)),[0]);
    loadout.refillBelt(gun);gun.loaded=loadout.nextAmmo(gun);loadout.syncGunShell(gun);
    const setHeld=state=>{r.G.veh.place(0,0,Math.atan2(state.ez[0],state.ez[2]));r.G.veh.compat(r.G.s);state.tur.forEach((joint,i)=>{r.G.T[i].yaw=joint[0];r.G.T[i].guns[0].pitch=joint[1];});r.G.T[1].carried=state.tur[0][0];clock=state.t;};
    setHeld(s.held);r.G.weaponControl={kind:'all'};r.live.syncApsControl();
    assert.equal(sent.at(-2).t,'state');assert.equal(sent.at(-1).t,'aps');assert.equal(sent.at(-2).s.t,s.held.t);assert.equal(sent.at(-2).s.aps_instance,'gun:1:0');assert.deepEqual(sent.at(-2).s.ammo_scope,r.onlineAmmo.scope());
    const held={yaw:r.G.T[1].yaw,pitch:r.G.T[1].guns[0].pitch},stock=r.onlineAmmo.counts();
    replay(r,s,'warm','snap');assert.deepEqual({yaw:r.G.T[1].yaw,pitch:r.G.T[1].guns[0].pitch},held,'old enabled Snap cannot write before acknowledgement');
    replay(r,s,'enable');replay(r,s,'warm','snap');assert.deepEqual({yaw:r.G.T[1].yaw,pitch:r.G.T[1].guns[0].pitch},held,'pre-barrier enabled Snap cannot write after acknowledgement');
    replay(r,s,'next_snap');const next=packet(s,'next_snap','snap').aps.find(a=>a.owner===s.owner);
    assert.ok(Math.abs(r.G.T[1].yaw-(next.yaw-.4))<1e-7);assert.ok(Math.abs(r.G.T[1].guns[0].pitch-next.pitch)<1e-7);assert.deepEqual(r.onlineAmmo.counts(),stock,'pose barrier does not mutate independent stock');
    r.G.weaponControl={kind:'gun',ti:0,gi:0};r.live.syncApsControl();setHeld(s.carried);r.G.weaponControl={kind:'all'};r.live.syncApsControl();
    replay(r,s,'enable');assert.equal(r.G.online.apsPose.barrier,null,'obsolete acknowledgement cannot own a newer transition');
    r.G.weaponControl={kind:'gun',ti:0,gi:0};r.live.syncApsControl();replay(r,s,'carry_enable');assert.equal(r.G.online.apsPose,null,'rapid ALL to SOLO invalidates its pending acknowledgement');
    r.G.weaponControl={kind:'all'};clock+=.001;r.live.syncApsControl();replay(r,s,'carry_enable');assert.equal(r.G.online.apsPose.barrier,null,'repeated toggle rejects the prior real acknowledgement');
    assert.equal(r.onlineAmmo.scope().life,s.held.ammo_scope.life);assert.equal(r.G.loadout.turrets[1].guns[0],gun);assert.equal(r.G.T[1].loading,L);
    const pendingStock=r.onlineAmmo.counts(),life=r.onlineAmmo.scope();setHeld(s.restarted);
    r.net._emit('reconnecting',{});r.G.online.stateT=null;replay(r,s,'resume');r.net._emit('resumed',{});
    assert.equal(sent.at(-2).s.t,s.restarted.t,'the authenticated resumed transport can restart its State clock');
    const oldTransport=packet(s,'initial_state','aps_pose');assert.equal(oldTransport.request_t,r.G.online.apsPose.state_t,'real previous transport and resumed State clocks collide');
    replay(r,s,'initial_state');assert.equal(r.G.online.apsPose.barrier,null,'previous transport acknowledgement cannot claim the resumed same life even at identical State.t');
    replay(r,s,'restarted_state');replay(r,s,'restarted_enable');assert.ok(Number.isSafeInteger(r.G.online.apsPose.barrier));replay(r,s,'restarted_snap');
    assert.deepEqual(r.onlineAmmo.scope(),life);assert.deepEqual(r.onlineAmmo.counts(),pendingStock);assert.equal(r.G.loadout.turrets[1].guns[0],gun);assert.equal(r.G.T[1].loading,L);
  }
});

test('aps_pose admitted real Oplot lives defer the barrier through map and core readiness and cancel old callbacks on leave',async()=>{
  for(const s of Object.values(receipt.aps_readiness))for(const coreAt of ['ready','during_load','after_load','leave']) {
    let resolve;const loaded=new Promise(r=>{resolve=r;}),sent=[];
    const r=runtime(s.mode,{combat:coreAt==='ready'?new Combat(core,data.machineGuns):null,loadMap:()=>loaded,clock:{now:()=>10}});
    r.net.status='open';r.net.ws={readyState:1,send:text=>sent.push(JSON.parse(text))};
    for(const phase of ['welcome','create','start','deploy'])replay(r,s,phase);
    assert.equal(r.G.mode,'garage');const gun=r.G.loadout.turrets[1].guns[0],L=r.G.T[1].loading,counts=r.onlineAmmo.counts(),scope=r.onlineAmmo.scope();
    assert.equal(sent.some(m=>m.t==='aps'&&m.enabled),false,'life admission cannot publish enable before actual world readiness');
    if(coreAt==='during_load'){r.G.combat=new Combat(core,data.machineGuns);r.live.bindCombatReady();}
    if(coreAt==='leave')replay(r,s,'leave');
    r.G.maps.set('coast',{});resolve();await loaded;await Promise.resolve();await Promise.resolve();
    if(coreAt==='leave'){assert.equal(r.G.online,null);assert.equal(r.G.mode,'garage');assert.equal(sent.some(m=>m.t==='aps'&&m.enabled),false);continue;}
    assert.equal(r.G.loadout.turrets[1].guns[0],gun);assert.equal(r.G.T[1].loading,L);assert.deepEqual(r.onlineAmmo.counts(),counts);assert.deepEqual(r.onlineAmmo.scope(),scope);
    if(coreAt==='after_load'){assert.equal(sent.some(m=>m.t==='aps'&&m.enabled),false,'late core still defers enabling');r.G.combat=new Combat(core,data.machineGuns);r.live.bindCombatReady();}
    assert.equal(r.G.mode,'battle');assert.equal(sent.at(-2).t,'state');assert.equal(sent.at(-1).t,'aps');assert.equal(sent.at(-2).s.t,s.state.t);assert.deepEqual(sent.at(-2).s.tur,s.state.tur);
    assert.ok(Math.abs(sent.at(-2).s.ez[0]-s.state.ez[0])<1e-7,'first force-State carries actual nonzero source spawn heading');
    const held=r.G.T[1].yaw;replay(r,s,'snap');assert.equal(r.G.T[1].yaw,held,'startup Snap cannot write before accepted barrier');
    replay(r,s,'pose');replay(r,s,'enable');assert.equal(r.G.online.apsPose.barrier,0);replay(r,s,'snap');assert.ok(Math.abs(r.G.T[1].yaw)<1e-4);
  }
});

test('aps_pose genuine seven-round refill suspends the old enabled writer until a resumed readiness barrier',()=>{
  for(const s of Object.values(receipt.aps_short)) {
    let clock=0;const sent=[],r=runtime(s.mode,{combat:new Combat(core,data.machineGuns),clock:{now:()=>clock*1000}});
    r.net.status='open';r.net.ws={readyState:1,send:text=>sent.push(JSON.parse(text))};
    for(const phase of ['welcome','create','start','deploy'])replay(r,s,phase);
    r.G.veh.place(0,0,0);r.G.veh.compat(r.G.s);replay(r,s,'initial_state');
    const t=r.G.loadout.turrets[1],gun=t.guns[0],L=r.G.T[1].loading;
    r.G.weaponControl={kind:'gun',ti:1,gi:0};r.live.syncApsControl();replay(r,s,'disable');
    for(let i=0;i<7;i++){assert.equal(r.live.fireGun(1,0),true);if(L.state[0]!=='empty'){loading.tick(L,1e-6,(gi,li)=>loadout.reloadTime(t,gi,li,s.mode));const done=loading.tick(L,loading.progress(L,0).remaining,(gi,li)=>loadout.reloadTime(t,gi,li,s.mode));assert.deepEqual(done,[0]);}loadout.refillBelt(gun);gun.loaded=loadout.nextAmmo(gun);if(gun.loaded<0)L.state[0]='empty';loadout.syncGunShell(gun);}
    replay(r,s,'manual');assert.equal(roundsLeft(gun),0);r.G.weaponControl={kind:'all'};r.live.syncApsControl();replay(r,s,'empty_state');replay(r,s,'enable_empty');assert.ok(Number.isSafeInteger(r.G.online.apsPose.barrier));
    clock=5;r.G.veh.place(0,0,.4);r.G.veh.compat(r.G.s);r.G.T[0].yaw=.5;r.G.T[1].yaw=.5;r.G.T[1].carried=.5;
    replay(r,s,'grant');assert.equal(roundsLeft(gun),7);assert.notEqual(L.state[0],'ready');assert.deepEqual(gun.ammo.map(a=>a.count),s.selected['gun:1:0']);
    const held=r.G.T[1].yaw;replay(r,s,'empty_active','snap');assert.equal(r.G.T[1].yaw,held,'delayed pre-suspension enabled Snap cannot reclaim the refill');
    const request=r.G.online.apsPose;replay(r,s,'automatic','snap');assert.equal(r.G.online.apsPose,request,'old off/automatic tick cannot replace a later ownership transition');
    const seconds=s.ready_at-5;assert.deepEqual(loading.tick(L,seconds-.01,(gi,li)=>loadout.reloadTime(t,gi,li,s.mode)),[]);
    replay(r,s,'before_ready');assert.equal(r.G.T[1].yaw,held);assert.equal(r.G.apsState.enabled,false);
    assert.deepEqual(loading.tick(L,.02,(gi,li)=>loadout.reloadTime(t,gi,li,s.mode)),[0]);loadout.refillBelt(gun);gun.loaded=loadout.nextAmmo(gun);loadout.syncGunShell(gun);
    replay(r,s,'ready');assert.ok(Number.isSafeInteger(r.G.online.apsPose.barrier));assert.equal(r.G.T[1].yaw,held,'barrier tick itself cannot write the pose');
    replay(r,s,'empty_active','snap');assert.equal(r.G.T[1].yaw,held);replay(r,s,'after_ready');assert.ok(Math.abs(r.G.T[1].yaw-.5)<1e-7);assert.equal(roundsLeft(gun),7);assert.equal(gun.loaded,0);assert.equal(gun.belt,7);
  }
});
for(const cause of ['stale','invalid'])test(`aps_pose genuine ${cause} server suspension recovers the current final-State barrier`,()=>{
  assert.equal(Object.keys(receipt.aps_suspensions).length,8);
  assert.deepEqual(Object.keys(receipt.aps_suspensions),Object.keys(gameplayReceipt.aps_suspensions));
  for(const s of Object.values(receipt.aps_suspensions).filter(s=>s.cause===cause)) {
    const other=gameplayReceipt.aps_suspensions[`${s.vehicle}_${s.mode}_${cause}`];
    for(const field of ['held','before','adopted','counts'])assert.deepEqual(s[field],other[field],'independent producers retain the same physical history');
    let clock=.01;const sent=[],r=runtime(s.mode,{combat:new Combat(core,data.machineGuns),clock:{now:()=>clock*1000}});
    r.net.status='open';r.net.ws={readyState:1,send:text=>sent.push(JSON.parse(text))};
    for(const phase of ['welcome','create','start','deploy','initial_state','initial_enable','initial_snap'])replay(r,s,phase);
    r.G.veh.place(0,0,0);r.G.veh.compat(r.G.s);replay(r,s,'warm');
    assert.ok(Number.isSafeInteger(r.G.online.apsPose.barrier));assert.ok(r.G.apsState.heat>0,'real interception has warmed the system');
    clock=s.primary_at;assert.equal(r.live.fireGun(0,0),true);replay(r,s,'primary');
    const gun=r.G.loadout.turrets[1].guns[0],L=r.G.T[1].loading,primary=r.G.T[0].loading,t=r.G.loadout.turrets[0];
    assert.deepEqual(loading.tick(primary,.25,(gi,li)=>loadout.reloadTime(t,gi,li,s.mode)),[]);assert.equal(primary.state[0],'loading');
    const loader=structuredClone(primary),stock=r.onlineAmmo.counts(),scope=r.onlineAmmo.scope();assert.deepEqual(stock,s.counts);
    clock=s.held.t;s.held.tur.forEach((joint,i)=>{r.G.T[i].yaw=joint[0];r.G.T[i].guns[0].pitch=joint[1];});r.G.T[1].carried=s.held.tur[0][0];
    const held={yaw:r.G.T[1].yaw,pitch:r.G.T[1].guns[0].pitch},old=r.G.online.apsPose,n=sent.length;
    replay(r,s,'off_snap');
    assert.notEqual(r.G.online.apsPose,old);assert.equal(r.G.online.apsPose.barrier,null);
    assert.equal(sent.length,n+2);assert.equal(sent.at(-2).t,'state');assert.equal(sent.at(-1).t,'aps');assert.equal(sent.at(-1).enabled,true);
    assert.equal(sent.at(-2).s.t,s.held.t);assert.deepEqual(sent.at(-2).s.tur,s.held.tur);assert.deepEqual(sent.at(-2).s.ammo_scope,scope);
    assert.equal(r.G.apsState.enabled,false);assert.equal(r.G.apsState.heat,packet(s,'off_snap','snap').aps.find(a=>a.owner===s.owner).heat);
    replay(r,s,'initial_state');replay(r,s,'warm','snap');
    assert.equal(r.G.online.apsPose.barrier,null,'old ACK cannot own the forced current State');assert.deepEqual({yaw:r.G.T[1].yaw,pitch:r.G.T[1].guns[0].pitch},held,'old enabled Snap cannot overwrite the current held bore');
    replay(r,s,'inflight_state');replay(r,s,'rate_while_suspended');replay(r,s,'recovery_state');
    assert.equal(r.G.online.apsPose.barrier,null,'regular State and Y do not bypass the explicit current request');
    replay(r,s,'recovery_enable');
    assert.ok(Number.isSafeInteger(r.G.online.apsPose.barrier),'actual current handler ACK must release this pending barrier');
    assert.deepEqual({yaw:r.G.T[1].yaw,pitch:r.G.T[1].guns[0].pitch},held,'ACK itself cannot move the gun');
    assert.deepEqual(r.onlineAmmo.counts(),stock);assert.deepEqual(primary,loader);assert.equal(r.G.loadout.turrets[1].guns[0],gun);assert.equal(r.G.T[1].loading,L);
    const barrier=r.G.online.apsPose;replay(r,s,'initial_state');replay(r,s,'off_snap');replay(r,s,'warm','snap');
    assert.equal(r.G.online.apsPose,barrier,'old off Snap cannot replace the accepted current transition');assert.deepEqual({yaw:r.G.T[1].yaw,pitch:r.G.T[1].guns[0].pitch},held);
    replay(r,s,'later_snap');const next=packet(s,'later_snap','snap').aps.find(a=>a.owner===s.owner);
    assert.ok(packet(s,'later_snap','snap').tick>barrier.barrier);assert.equal(next.enabled,true);
    assert.ok(Math.abs(next.yaw-s.adopted.yaw)<=s.adopted.def.traverse_deg_s*Math.PI/180*.05+1e-8);assert.ok(Math.abs(next.pitch-s.adopted.pitch)<=s.adopted.def.elevate_deg_s*Math.PI/180*.05+1e-8);
    assert.ok(Math.abs(r.G.T[1].yaw-next.yaw)<1e-7);assert.ok(Math.abs(r.G.T[1].guns[0].pitch-next.pitch)<1e-7);
    assert.equal(r.G.apsState.heat,next.heat);assert.equal(r.G.apsState.spin,next.spin);assert.equal(roundsLeft(gun),next.rounds);
    assert.deepEqual(primary,loader);assert.equal(r.G.T[1].loading,L);assert.deepEqual(r.onlineAmmo.scope(),scope);
  }
});
test('aps_pose genuine rejected final request accepts its later trusted State without an obsolete correlation',()=>{
  assert.equal(Object.keys(receipt.aps_quantization).length,4);
  for(const s of Object.values(receipt.aps_quantization)) {
    let clock=.01;const sent=[],r=runtime(s.mode,{combat:new Combat(core,data.machineGuns),clock:{now:()=>clock*1000}});
    r.net.status='open';r.net.ws={readyState:1,send:text=>sent.push(JSON.parse(text))};
    for(const phase of ['rejected_welcome','rejected_create','rejected_start','rejected_deploy'])replay(r,s,phase);
    r.G.veh.place(0,0,0);r.G.veh.compat(r.G.s);replay(r,s,'rejected_before');
    r.live.toggleAps();assert.equal(r.G.apsOn,false);replay(r,s,'rejected_disable');
    const held=state=>{state.tur.forEach((joint,i)=>{r.G.T[i].yaw=joint[0];r.G.T[i].guns[0].pitch=joint[1];});r.G.T[1].carried=state.tur[0][0];clock=state.t;};
    held(s.bad);r.live.toggleAps();assert.equal(r.G.apsOn,true);
    assert.equal(sent.at(-2).t,'state');assert.equal(sent.at(-2).s.t,s.bad.t);assert.deepEqual(sent.at(-2).s.tur,s.bad.tur);assert.equal(sent.at(-1).t,'aps');
    const pending=r.G.online.apsPose,stock=r.onlineAmmo.counts(),scope=r.onlineAmmo.scope(),gun=r.G.loadout.turrets[1].guns[0],L=r.G.T[1].loading;
    replay(r,s,'rejected_current');replay(r,s,'rejected_enable');replay(r,s,'rejected_snap');
    assert.equal(pending.barrier,null);assert.equal(r.G.apsState.enabled,false);assert.equal(r.G.T[1].yaw,s.bad.tur[1][0]);
    replay(r,s,'rejected_before');replay(r,s,'unrelated');assert.equal(pending.barrier,null,'the actual old ACK and unrelated observations cannot release the current request');
    held(s.later);r.live.sendOnlineState();assert.equal(sent.at(-1).s.t,s.later.t);assert.equal(pending.state_t,s.bad.t,'regular current State retains the pending final-State request');
    replay(r,s,'later_current');assert.ok(Number.isSafeInteger(pending.barrier),'the actual current ACK must correlate the rejected .05 request with trusted .1 admission');
    const ack=packet(s,'later_current','aps_pose');assert.equal(ack.request_t,s.bad.t);assert.equal(ack.state_t,s.later.t);assert.equal(ack.transport,r.net.token);
    assert.deepEqual(r.onlineAmmo.counts(),stock);assert.deepEqual(r.onlineAmmo.scope(),scope);assert.equal(r.G.T[1].yaw,s.later.tur[1][0]);
    replay(r,s,'rejected_before');replay(r,s,'rejected_snap');assert.equal(r.G.online.apsPose,pending);assert.equal(r.G.T[1].yaw,s.later.tur[1][0]);
    replay(r,s,'later_snap');const next=packet(s,'later_snap','snap').aps.find(a=>a.owner===s.owner);
    assert.equal(next.enabled,true);assert.ok(packet(s,'later_snap','snap').tick>pending.barrier);
    assert.ok(Math.abs(next.yaw-s.later.tur[1][0])<=s.adopted.def.traverse_deg_s*Math.PI/180*.05+1e-8);
    assert.ok(Math.abs(next.pitch-s.later.tur[1][1])<=s.adopted.def.elevate_deg_s*Math.PI/180*.05+1e-8);
    assert.ok(Math.abs(r.G.T[1].yaw-next.yaw)<1e-7);assert.ok(Math.abs(r.G.T[1].guns[0].pitch-next.pitch)<1e-7);
    assert.equal(roundsLeft(gun),next.rounds);assert.equal(r.G.T[1].loading,L);assert.equal(r.G.apsState.heat,next.heat);assert.deepEqual(r.onlineAmmo.counts(),stock);
  }
});
const packets=(s,name,t=null)=>s.phases[name].filter(([to,m])=>to===s.owner&&(!t||m.t===t)).map(([,m])=>structuredClone(m));
const packet=(s,name,t)=>packets(s,name,t)[0];
const replay=(r,s,name,t=null)=>{for(const m of packets(s,name,t))r.net._receive(m);};
function initialized(s) {
  const r=runtime(s.mode==='historical'?'casual':'historical',{combat:new Combat(core,data.machineGuns)});
  for(const phase of ['welcome','create','join','start','deploy'])replay(r,s,phase);
  assert.equal(r.G.mode,'battle');assert.deepEqual(r.onlineAmmo.counts(),s.selected);
  return r;
}
function chooseControl(r, key) {
  for (let i = 0; i < selection.weaponControlSlots(r.G.loadout).length; i++) {
    if (selection.weaponControlKey(r.G.weaponControl) === key) return;
    r.live.cycleSightGun();
  }
  assert.equal(selection.weaponControlKey(r.G.weaponControl), key, 'actual G reaches the requested control');
}

test('solo network instances retain exact cannon shell and sequence after actual G switches', () => {
  for (const s of Object.values(receipt.scenarios).filter(s => s.vehicle === 'su_bmpt34')) {
    const r = initialized(s), sent = [];
    r.net.status = 'open'; r.net.ws = { readyState: 1, send: text => sent.push(JSON.parse(text)) };
    for (const [gi, phase] of [[0, 'cannon'], [1, 'secondary_cannon']]) {
      const ack = packet(s, phase, 'fire_accepted');
      chooseControl(r, `gun:0:${gi}`);
      const gun = r.G.loadout.turrets[0].guns[gi], shell = gun.ammo[gun.loaded].shell.id;
      r.G.online.seq = ack.seq - 1;
      r.live.trigger();
      assert.deepEqual(r.G.pending.map(p => [p.ti, p.gi]), [[0, gi]]);
      r.G.pending.length = 0;
      assert.equal(r.live.fireGun(0, gi), true);
      const msg = sent.at(-1), pending = r.onlineFires.pending.at(-1);
      assert.deepEqual({ t: msg.t, instance: msg.instance, shell: msg.shell, seq: msg.seq, scope: msg.ammo_scope },
        { t: 'fire', instance: `gun:0:${gi}`, shell, seq: ack.seq, scope: r.onlineAmmo.scope() });
      assert.equal(pending.gun, gun);
      r.live.cycleSightGun();
      assert.equal(r.onlineFires.pending.at(-1), pending, 'G clears intent while retaining the sent request');
      r.net._receive({ ...ack, ammo_scope: { ...ack.ammo_scope, life: ack.ammo_scope.life + 1 } });
      assert.ok(r.onlineFires.pending.includes(pending), 'wrong life cannot acknowledge a sent request');
      replay(r, s, phase, 'fire_accepted');
      assert.ok(!r.onlineFires.pending.includes(pending), 'genuine scoped ACK resolves its original cannon');
      const before = r.onlineAmmo.counts();
      replay(r, s, phase, 'fire_accepted');
      assert.deepEqual(r.onlineAmmo.counts(), before, 'duplicate ACK grants no ammunition');
    }
  }
});

test('solo network MG packets and in-flight bullets retain the real fitted secondary ID after G', () => {
    const r = runtime('casual'), sent = [];
    for (const phase of ['welcome_a', 'room', 'start', 'deploy_a'])
      for (const [to, m] of gameplayReceipt.phases[phase]) if (to === gameplayReceipt.a) r.net._receive(m);
    r.net.status = 'open'; r.net.ws = { readyState: 1, send: text => sent.push(JSON.parse(text)) };
    const index = r.G.MG.findIndex(e => e.m.mount === 'coax');
    assert.ok(index >= 0);
    chooseControl(r, `mg:${index}`);
    const stock = r.onlineAmmo.counts(), before = r.G.MG.map(e => e.st.fired), seq = r.G.online.seq;
    r.G.fireHeld = true; r.live.stepMachineGuns(.2); r.G.fireHeld = false;
    const packets = sent.filter(m => m.t === 'mg_fire');
    assert.ok(packets.length > 0);
    const mg = r.G.MG[index];
    packets.forEach((m, i) => {
      assert.equal(m.instance, `mg:${mg.m.id}`);
      assert.equal(m.gun, mg.m.def.id);
      assert.equal(m.seq, seq + i + 1);
      assert.deepEqual(m.ammo_scope, r.onlineAmmo.scope());
      assert.equal(r.G.bullets[i].instance, m.instance);
    });
    r.G.MG.forEach((e, i) => i === index ? assert.ok(e.st.fired > before[i]) : assert.equal(e.st.fired, before[i]));
    r.live.cycleSightGun();
    assert.ok(r.G.bullets.every(b => b.instance === mg.m.damageKey), 'in-flight MG identity remains bound after G');
    assert.deepEqual(r.onlineAmmo.counts(), stock, 'MG mode preserves cannon pools');
});

test('solo network launch retries ACK and same-life resume retain their firing-time mount after G', () => {
  for (const s of Object.values(receipt.scenarios).filter(s => s.vehicle === 'su_bmpt34')) {
    const r = initialized(s), sent = [];
    r.net.status = 'open'; r.net.ws = { readyState: 1, send: text => sent.push(JSON.parse(text)) };
    replay(r, s, 'cannon');
    const ack = packet(s, 'rail', 'launched');
    chooseControl(r, 'gun:0:2'); r.G.online.seq = ack.seq - 1;
    const gun = r.G.loadout.turrets[0].guns[2], L = r.G.T[0].loading, ammo = gun.ammo[gun.loaded].shell.id;
    assert.equal(r.live.fireGun(0, 2), true);
    const launch = r.onlineLaunches.pending[0], msg = structuredClone(sent.at(-1));
    assert.equal(msg.instance, 'gun:0:2'); assert.equal(msg.seq, ack.seq); assert.equal(msg.ammo, ammo);
    assert.deepEqual(msg.ammo_scope, ack.ammo_scope);
    replay(r, s, 'rail', 'ammo');
    replay(r, s, 'at_5');
    chooseControl(r, 'gun:0:1'); r.G.online.seq = 44;
    assert.equal(r.live.fireGun(0, 1), true);
    const pendingFire = r.onlineFires.pending[0];
    chooseControl(r, 'gun:0:0');
    const control = r.G.weaponControl, stock = r.onlineAmmo.counts(), readiness = structuredClone(L);
    replay(r, s, 'resume');
    assert.equal(r.G.weaponControl, control); assert.equal(r.G.loadout.turrets[0].guns[2], gun);
    assert.equal(r.G.T[0].loading, L); assert.deepEqual(L, readiness);
    assert.deepEqual(r.onlineAmmo.counts(), stock);
    assert.equal(r.onlineLaunches.pending[0], launch); assert.equal(r.onlineFires.pending[0], pendingFire);
    r.live.retryPendingLaunches(true);
    assert.deepEqual(sent.at(-1), msg, 'timeout/reconnect retries exact firing-time instance, ammo, scope and sequence');
    r.net._receive({ ...ack, ammo_scope: { ...ack.ammo_scope, life: ack.ammo_scope.life + 1 } });
    assert.equal(r.onlineLaunches.pending[0], launch, 'wrong life cannot release the original tube');
    const other = r.G.loadout.turrets[0].guns[3], otherState = structuredClone(other.launcher);
    replay(r, s, 'rail', 'launched');
    assert.equal(r.onlineLaunches.pending.length, 0);
    assert.equal(gun.launcher.nextTube, 1); assert.equal(gun.launcher.ready, 0);
    assert.deepEqual(other.launcher, otherState, 'ACK never rebinds to a later selected weapon');
    const effects = r.G.launchEffects, committed = structuredClone(gun.launcher);
    replay(r, s, 'rail_retry');
    assert.deepEqual(gun.launcher, committed); assert.equal(r.G.launchEffects, effects);
  }
});

test('actual G traverses ALL gun zero and Oplot before genuine APS manual and adoption receipts', () => {
  for (const s of Object.values(receipt.aps_handoffs)) {
    let clock = .01;
    const sent = [], r = runtime(s.mode, { combat: new Combat(core, data.machineGuns), clock: { now: () => clock * 1000 } });
    r.net.status = 'open'; r.net.ws = { readyState: 1, send: text => sent.push(JSON.parse(text)) };
    for (const phase of ['welcome', 'create', 'start', 'deploy', 'initial_state', 'warm']) replay(r, s, phase);
    assert.equal(selection.weaponControlKey(r.G.weaponControl), 'all');
    r.live.cycleSightGun(); assert.equal(selection.weaponControlKey(r.G.weaponControl), 'gun:0:0');
    r.live.cycleSightGun(); assert.equal(selection.weaponControlKey(r.G.weaponControl), 'gun:1:0');
    replay(r, s, 'disable');
    r.G.online.seq = 76;
    assert.equal(r.live.fireGun(1, 0), true);
    const msg = sent.at(-1);
    assert.equal(msg.instance, 'gun:1:0'); assert.equal(msg.seq, 77);
    assert.equal(msg.shell, r.onlineFires.pending[0].ammo.shell.id);
    replay(r, s, 'manual'); assert.equal(r.onlineFires.pending.length, 0);
    chooseControl(r, 'gun:0:0');
    s.carried.tur.forEach((joint, i) => { r.G.T[i].yaw = joint[0]; r.G.T[i].guns[0].pitch = joint[1]; });
    r.G.T[1].carried = s.carried.tur[0][0];
    clock = s.carried.t;
    chooseControl(r, 'all');
    replay(r, s, 'carry_enable');
    assert.ok(Number.isSafeInteger(r.G.online.apsPose.barrier), 'real current scoped APS acknowledgement binds the ALL transition');
  }
});
function deferredRuntime(local,combat=new Combat(core,data.machineGuns)) {
  let resolve;const loaded=new Promise(r=>{resolve=r;});
  const r=runtime(local,{combat,loadMap:()=>loaded});
  return {r,async finish(){r.G.maps.set('coast',{});resolve();await loaded;await Promise.resolve();}};
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
test('actual deferred map preserves an admitted deployment mounts loading predictions controls and latest inventory',async()=>{
  for(const s of Object.values(receipt.scenarios).filter(s=>s.vehicle==='su_bmpt34')){
    const {r,finish}=deferredRuntime(s.mode);for(const phase of ['welcome','create','join','start','deploy'])replay(r,s,phase);
    assert.equal(r.G.mode,'garage');assert.equal(r.onlineAmmo.scope().life,1);
    replay(r,s,'cannon');replay(r,s,'at_5');r.net.status='open';r.net.ws={readyState:1,send(){}};r.G.online.seq=199;
    assert.equal(r.live.fireGun(0,1),true);assert.equal(r.live.fireGun(0,2),true);r.G.apsOn=false;r.G.sightG=1;r.G.T[0].yaw=.37;r.G.T[0].guns[1].pitch=.12;r.G.zero=450;r.G.zoomIdx=2;
    r.G.pending.push({ti:0,gi:2,t:.2});
    const gun=r.G.loadout.turrets[0].guns[1],L=r.G.T[0].loading,counts=r.onlineAmmo.counts(),state=JSON.stringify(r.G.cstate),caps=JSON.stringify(r.G.caps),loadingState=JSON.stringify(L),shot=r.G.shots[0],pending=r.onlineFires.pending[0],launch=r.onlineLaunches.pending[0],intent=r.G.pending[0];
    await finish();assert.equal(r.G.mode,'battle');assert.equal(r.G.loadout.turrets[0].guns[1],gun);assert.equal(r.G.T[0].loading,L);assert.equal(JSON.stringify(L),loadingState);assert.deepEqual(r.onlineAmmo.counts(),counts);assert.equal(r.onlineAmmo.scope().life,1);
    assert.equal(JSON.stringify(r.G.cstate),state);assert.equal(JSON.stringify(r.G.caps),caps);assert.equal(r.G.shots[0],shot);assert.equal(r.onlineFires.pending[0],pending);assert.equal(r.onlineLaunches.pending[0],launch);assert.equal(r.G.pending[0],intent);assert.equal(r.G.apsOn,false);assert.equal(r.G.sightG,1);assert.equal(r.G.T[0].yaw,.37);assert.equal(r.G.T[0].guns[1].pitch,.12);assert.equal(r.G.zero,450);assert.equal(r.G.zoomIdx,2);
    assert.equal(r.G.loadout.turrets[0].guns[3].launcher.ready,0);assert.ok(r.G.model.turrets[0].guns[3].rounds.filter(Boolean).every(n=>n.visible===false));
    replay(r,s,'secondary_cannon','ammo');assert.ok(r.onlineAmmo.scope(),'ordinary inventory reception remains attached to the admitted life');
  }
});
test('actual deferred dead resume admits scoped Status before map readiness and retains it through pose and late core binding',async()=>{
  for(const s of Object.values(receipt.scenarios).filter(s=>s.vehicle==='su_bmpt34')){
    for(const coreAt of ['ready','during_load','after_load']){
      const {r,finish}=deferredRuntime(s.mode,coreAt==='ready'?new Combat(core,data.machineGuns):null);for(const phase of ['welcome','create','join'])replay(r,s,phase);
      const returned=s.dead_recovery.phases.resume.filter(([to])=>to===s.owner).map(([,m])=>m);for(const m of returned)r.net._receive(m);
      const status=returned.find(m=>m.t==='status');assert.equal(r.onlineAmmo.scope()?.life,2);assert.deepEqual(r.G.cstate,status.state);assert.deepEqual(r.G.caps,status.caps);
      const gun=r.G.loadout.turrets[0].guns[0],L=r.G.T[0].loading,counts=r.onlineAmmo.counts();
      if(coreAt==='during_load'){r.G.combat=new Combat(core,data.machineGuns);r.live.bindCombatReady();assert.deepEqual(r.G.cstate,status.state);assert.deepEqual(r.G.caps,status.caps);}
      await finish();
      if(coreAt==='after_load'){r.G.combat=new Combat(core,data.machineGuns);r.live.bindCombatReady();}
      assert.equal(r.G.loadout.turrets[0].guns[0],gun);assert.equal(r.G.T[0].loading,L);assert.equal(r.onlineAmmo.scope().life,2);assert.deepEqual(r.onlineAmmo.counts(),counts);assert.deepEqual(r.G.cstate,status.state);assert.deepEqual(r.G.caps,status.caps);assert.equal(r.G.online.dead,true);assert.equal(r.G.online.benched,true);assert.equal(r.scene.children.includes(r.G.model.root),false);assert.equal(r.live.fireGun(0,1),false);
      replay(r,s,'rail','status');assert.deepEqual(r.G.cstate,status.state);replay(r,s,'secondary_cannon','status');assert.deepEqual(r.G.cstate,status.state);
    }
  }
});
test('actual newer life during deferred map loading retains one sortie and rejects malformed and old life admission',async()=>{
  const s=receipt.scenarios.bmpt_historical,{r,finish}=deferredRuntime(s.mode);for(const phase of ['welcome','create','join','start'])replay(r,s,phase);
  const bench=r.G.loadout;r.net._receive(packet(s,'at_5','ammo'));r.net._receive(packet(s,'at_5','status'));assert.equal(r.onlineAmmo.scope(),null);assert.equal(r.G.loadout,bench);assert.equal(r.G.cstate,null);replay(r,s,'deploy');
  const sortie=r.G.online,first=r.G.loadout,errors=[],old=console.error,bad=packet(s,'new_life_resume','start');
  console.error=(...a)=>errors.push(a);try{r.net._receive({...bad,ammo:{...bad.ammo,counts:{}}});}finally{console.error=old;}
  assert.equal(errors.length,1);assert.equal(r.G.online,sortie);assert.equal(r.G.loadout,first);assert.equal(r.onlineAmmo.scope().life,1);
  replay(r,s,'new_life_resume');assert.equal(r.G.online,sortie);assert.equal(r.onlineAmmo.scope().life,2);const gun=r.G.loadout.turrets[0].guns[0],L=r.G.T[0].loading;r.G.apsOn=false;
  replay(r,s,'deploy_resume');assert.equal(r.G.loadout.turrets[0].guns[0],gun);assert.equal(r.onlineAmmo.scope().life,2);
  await finish();assert.equal(r.G.online,sortie);assert.equal(r.G.loadout.turrets[0].guns[0],gun);assert.equal(r.G.T[0].loading,L);assert.equal(r.onlineAmmo.scope().life,2);assert.equal(r.G.online.spawn,2);assert.equal(r.G.apsOn,false);assert.deepEqual(r.G.cstate,packet(s,'new_life_resume','status').state);
});
test('actual deferred map callback cannot revive a departed sortie or overwrite a fresh Start',async()=>{
  const s=receipt.scenarios.bmpt_historical;
  for(const restart of ['leave','same_battle','new_battle']){
    const {r,finish}=deferredRuntime(s.mode);for(const phase of ['welcome','create','join','start','deploy'])replay(r,s,phase);
    const sortie=r.G.online;r.live.toGarage();assert.equal(r.onlineAmmo.scope(),null);
    for(const [to,m]of gameplayReceipt.phases.leave)if(to===gameplayReceipt.a)r.net._receive(m);
    if(restart==='same_battle')for(const phase of ['create','join','start','deploy'])replay(r,s,phase);
    if(restart==='new_battle')for(const phase of ['welcome_c','room_c','start_c'])for(const [to,m]of gameplayReceipt.phases[phase])if(to===gameplayReceipt.c)r.net._receive(m);
    const next=r.G.online,gun=r.G.loadout.turrets[0].guns[0];if(restart!=='leave')assert.notEqual(next,sortie);
    await finish();assert.equal(r.G.online,next);assert.equal(r.G.loadout.turrets[0].guns[0],gun);assert.equal(r.G.mode,restart==='leave'?'garage':'battle');assert.equal(r.onlineAmmo.scope()?.life,restart==='same_battle'?1:undefined);
    if(restart==='new_battle'){assert.equal(r.G.online.battle,2);assert.equal(r.G.mapId,'range');assert.equal(r.G.gameplayMode,'casual');}
  }
});
