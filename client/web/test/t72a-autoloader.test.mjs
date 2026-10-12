import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadData } from '../tools/load-data.mjs';
import * as loadout from '../src/game/loadout.js';
import * as loading from '../src/sim/loading.js';
import * as performanceApi from '../src/game/gameplayPerformance.js';
import * as damageApi from '../src/game/weaponDamage.js';
import * as inventory from '../src/game/ammoInventory.js';
import * as resupply from '../src/game/ammoResupply.js';
import * as selection from '../src/game/weaponselection.js';
import * as gunnery from '../src/sim/gunnery.js';
import * as ballistics from '../src/sim/ballistics.js';
import { applyAmmo } from '../src/game/deploy.js';
import { buildTank } from '../src/gfx/tankmodel.js';
import { VehicleSim } from '../src/game/vehicle.js';
import { ground } from './tankrig.mjs';
import { OnlineAmmo } from '../src/game/onlineAmmo.js';
import { OnlineFires } from '../src/game/onlineFire.js';
import { Sound } from '../src/game/audio.js';

const data = loadData(), ID = 'su_t72a';
const source = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
function stock(mode = 'historical') {
  assert.ok(data.vehicles[ID], 'real stock T-72A must be registered');
  const b = data.vehicles[ID];
  const lo = performanceApi.deriveLoadoutPerformance(loadout.makeLoadout(ID, b, data.projectiles, data.machineGuns), mode);
  const t = lo.turrets[0], g = t.guns[0];
  const L = loading.newLoading(t.guns.length, t.loaders.length, t.guns.map(g => !g.rack || g.loadingOwner === 'mechanized'), t.guns.map(g => g.mechanizedLoading));
  return { b, lo, t, g, L, mode };
}
function advance(r, dt, onStage = () => {}, rate = () => 1) {
  const done = loading.tick(r.L, dt, (gi, li) => loadout.reloadTime(r.t, gi, li, r.mode), rate, onStage);
  for (const gi of done) {
    const g = r.t.guns[gi]; g.loaded = loadout.nextAmmo(g);
    if (g.loaded < 0) r.L.state[gi] = 'empty';
    loadout.syncGunShell(g);
  }
  return done;
}
function fireOwner(r) {
  const renderer = { mesh: vertices => ({ vertices }), instancedMesh: vertices => ({ vertices }), setInstances() {}, freeMesh() {} };
  const model = buildTank(renderer, r.lo, loadout.generatedTurretParts);
  const veh = new VehicleSim(r.b, model, ground(() => 0), r.mode); veh.place(0, 0, 0);
  const G = { id: ID, loadout: r.lo, caps: null, weaponControl: {kind:'all'}, online:null,
    T:[{loading:r.L,yaw:0,guns:[{pitch:0}]}], s:{x:0,y:0,z:0,heading:0}, ss:{pitch:0,roll:0},
    aps:null, shots:[], pending:[], cam:{shake:0}, sightT:0, veh };
  const start = source.indexOf('  function fireGun(');
  assert.ok(start >= 0); const body = source.slice(start, source.indexOf('\n  }', start)+4);
  const deps = { G, data, ...loadout, ...selection, ...damageApi, loading, gunnery, ballistics,
    hullTilt:()=>0, pose:()=>({pos:[0,0,0],heading:0}), mountOf:(t,g)=>({pivot:t.pivot,trunnion:g.trunnion,muzzleOffset:g.muzzleOffset}),
    rng:{nextF32:()=>.5}, surfaceAt:()=>0, impactColor:()=>[0,0,0], RECOIL_ROCK:1,
    fx:{muzzleBlast(){}}, sound:Object.assign(new Sound(),{shot(){}}), net:{open:false} };
  const fire = new Function(...Object.keys(deps), `${body}\nreturn fireGun;`)(...Object.values(deps));
  return { fire, G, model, veh };
}

test('T-72A is an independent 1979 six-wheel, three-crew procedural vehicle with a fitted 22-set carousel', () => {
  const { b, g, t, lo } = stock();
  assert.equal(b.vehicle.meta.year, 1979); assert.equal(b.vehicle.hull.mass_kg, 41500);
  assert.equal(b.vehicle.hull.size_m[2], 6.86); assert.equal(b.visual.running_gear.wheels.length, 6);
  assert.deepEqual(b.crew.map(c=>c.role).sort(), ['commander','driver','gunner']);
  assert.equal(t.loaders.length, 0); assert.equal(g.def.id, '2a46_1_125');
  assert.equal(g.def.caliber_mm, 125); assert.equal(g.def.autocannon, undefined); assert.equal(g.def.missile, undefined);
  assert.equal(g.loadingOwner, 'mechanized'); assert.equal(g.mechanizedLoading.mechanism, 'az_t72');
  assert.equal(g.capacity, 22); assert.equal(loadout.roundsLeft(g), 22);
  assert.equal(inventory.captureAmmoPlan(lo)['gun:0:0'].targets.reduce((a,b)=>a+b), 22);
  assert.equal(lo.imported, null); assert.ok(b.visual.parts.some(p=>p.name==='t72a_cast_turret'));
  assert.ok(b.visual.parts.some(p=>p.name==='t72a_bore_evacuator'));
});

test('fitted mechanical worker completes real work without a crew-loader 1.6 penalty and emits two distinct ram strokes once', () => {
  const r = stock(), events=[];
  r.g.loaded=-1; loading.fired(r.L,0); const cycle=r.L.waitedSince[0];
  assert.deepEqual(advance(r,7.99,e=>events.push(e)),[]); assert.equal(r.L.state[0],'loading');
  assert.equal(loading.progress(r.L,0).total,8); assert.equal(r.g.loaded,-1);
  assert.deepEqual(events.map(e=>e.stage),['select_lift','projectile_ram','charge_ram']);
  assert.ok(events.every(e=>e.owner==='mechanized'&&e.mechanism==='az_t72'&&e.cycle===cycle));
  assert.deepEqual(advance(r,.01,e=>events.push(e)),[0]); assert.equal(r.g.loaded,0);
  assert.equal(events.length,3); assert.equal(r.L.state[0],'ready');
});

test('pausing mechanical work does not advance presentation and resuming does not replay a stage', () => {
  const r=stock(),events=[]; loading.fired(r.L,0);
  advance(r,.01,e=>events.push(e)); advance(r,100,e=>events.push(e),()=>0);
  assert.deepEqual(events.map(e=>e.stage),['select_lift']); assert.equal(r.L.state[0],'loading');
  advance(r,8,e=>events.push(e)); assert.deepEqual(events.map(e=>e.stage),['select_lift','projectile_ram','charge_ram']);
});

test('mechanical reload receives exactly one casual multiplier while manual fallback retains its own penalty', () => {
  for (const mode of ['historical','casual']) {
    const r=stock(mode); loading.fired(r.L,0); advance(r,.01);
    assert.ok(Math.abs(loading.progress(r.L,0).total-(mode==='historical'?8:8/1.2))<1e-8);
  }
  const r=stock(); const mixed=loading.newLoading(2,0,[false,true],[null,r.g.mechanizedLoading]);
  loading.fired(mixed,0); loading.fired(mixed,1);
  assert.deepEqual(loading.tick(mixed,8,()=>8),[1]); assert.equal(mixed.state[0],'loading');
  assert.equal(loading.progress(mixed,0).total,12.8);
});

test('transplanting only the 2A46 gun into an ordinary workshop head does not manufacture a carousel', () => {
  const r=stock(); const c=loadout.buildToBundle({base:'de_hetzer',keepStock:false,turrets:[{...loadout.newTurretSpec(),loaders:0,guns:[{weapon:ID}]}]},data);
  const lo=loadout.makeLoadout('custom',c.bundle,{...data.projectiles,...c.projectiles},data.machineGuns), t=lo.turrets[0],g=t.guns[0];
  assert.equal(g.loadingOwner,'manual'); assert.equal(g.mechanizedLoading,null); assert.ok(g.rack);
  const L=loading.newLoading(1,0); loading.fired(L,0); loading.tick(L,.01,(gi,li)=>loadout.reloadTime(t,gi,li));
  assert.equal(loading.progress(L,0).total,loadout.reloadTime(t,0,0)*1.6);
  const retained=loadout.buildToBundle({base:ID,keepStock:true,turrets:[]},data);
  assert.equal(loadout.makeLoadout('retained',retained.bundle,data.projectiles,data.machineGuns).turrets[0].guns[0].loadingOwner,'mechanized');
  assert.equal(r.g.capacity,22);
});

test('incompatible fitted gun, ammo, overcapacity and malformed stage recipes fail during actual loadout creation', () => {
  const {b}=stock();
  for (const mutate of [b=>b.weapons.main_gun.id='d10t_100', b=>b.weapons.main_gun.ammo_count=[22,22,0],
    b=>b.weapons.mechanized_loading.stages[1].at=0, b=>b.weapons.mechanized_loading.cycle_s=0,
    b=>b.weapons.mechanized_loading.ammo=['he_100_of412'],
    b=>{b.weapons.main_gun.id='d10t_100';b.weapons.mechanized_loading.gun_id='d10t_100';},
    b=>b.weapons.main_gun.caliber_mm=75]) {
    const bad=structuredClone(b); mutate(bad);
    assert.throws(()=>loadout.makeLoadout('bad',bad,data.projectiles,data.machineGuns),/mechanized|carousel/i);
  }
});

test('actual fire owner debits all 22 sets, rejects during work and reaches empty without imaginary reserve rounds', () => {
  const r=stock(); const {fire,G,veh,model}=fireOwner(r);
  assert.equal(model.stations.length,6); assert.equal(veh.tm.sp.stations.length,12);
  for(let i=0;i<22;i++) {
    assert.equal(fire(0,0),true,`round ${i+1}`); assert.equal(fire(0,0),false,'cycle gate');
    if(i<21) assert.deepEqual(advance(r,8),[0]);
  }
  assert.equal(loadout.roundsLeft(r.g),0); assert.equal(r.L.state[0],'empty'); assert.equal(fire(0,0),false);
  assert.equal(G.shots.length,22); assert.equal(advance(r,30).length,0);
  const terrain=ground(()=>0); veh.place(0,0,0); for(let i=0;i<60;i++) veh.step({throttle:.5,steer:0,brake:0},1/60,false);
  assert.ok(veh.body.origin().every(Number.isFinite)); assert.ok(veh.netState().pos.every(Number.isFinite));
});

test('five-second supply restores only selected carousel stock and requires a fresh mechanical cycle', () => {
  const r=stock(); applyAmmo(r.lo,{[ID]:{'0.0':[2,0,1]}}); const plan=inventory.captureAmmoPlan(r.lo);
  for(const a of r.g.ammo) a.count=0; r.g.loaded=-1; r.L.state[0]='empty';
  const s=resupply.newResupplyState(); assert.equal(resupply.stepResupply(s,4.99,true,true).complete,false);
  assert.equal(resupply.stepResupply(s,.01,true,true).complete,true);
  assert.deepEqual(inventory.refillAmmo(r.lo,plan,[r.L]),['gun:0:0']); assert.equal(loadout.roundsLeft(r.g),3);
  assert.equal(r.L.state[0],'waiting'); assert.equal(r.g.loaded,-1);
  assert.deepEqual(advance(r,7.99),[]); assert.deepEqual(advance(r,.01),[0]);
  assert.equal(r.g.loaded,0); assert.equal(r.g.ammo[r.g.loaded].count,2);
  assert.throws(()=>inventory.applyAmmoCounts(r.lo,{'gun:0:0':[22,22,0]},[r.L]),/Invalid ammunition/);
});

test('named fitted machinery health freezes mechanical work independently of human-loader availability', () => {
  const r=stock(); assert.equal(typeof damageApi.mountedReloadRate,'function');
  const caps={loader:false,destroyed:false,repair_s:0,weapons:{'gun:0:0':{can_fire:true,reload_mult:1.6}}};
  const state={modules:r.b.modules.map(m=>m.max_health)};
  assert.equal(damageApi.mountedReloadRate(caps,r.g,r.b,state),1);
  const i=r.b.modules.findIndex(m=>m.id==='az_drive'); assert.ok(i>=0); state.modules[i]=0;
  assert.equal(damageApi.mountedReloadRate(caps,r.g,r.b,state),0);
  loading.fired(r.L,0); advance(r,20,()=>{},()=>damageApi.mountedReloadRate(caps,r.g,r.b,state));
  assert.equal(r.L.state[0],'loading'); state.modules[i]=r.b.modules[i].max_health;
  assert.deepEqual(advance(r,8,()=>{},()=>damageApi.mountedReloadRate(caps,r.g,r.b,state)),[0]);
  assert.equal(damageApi.mountedReloadRate({...caps,repair_s:1},r.g,r.b,state),0);
});

test('actual frame loading and HUD use the fitted owner with real stock state and gun selection remains mounted', () => {
  const r=stock(),events=[];
  const start=source.indexOf('        const L = G.T[ti].loading;',source.indexOf('      stepMachineGuns(SIM_DT);'));
  const end=source.indexOf('        // a rotary gun',start);
  assert.ok(start>=0&&end>start,'actual frame reload owner exists');
  const state={modules:r.b.modules.map(m=>m.max_health)};
  const G={loadout:r.lo,mode:'battle',gameplayMode:'historical',bundle:r.b,cstate:state,caps:{loader:false,weapons:{'gun:0:0':{can_fire:true,reload_mult:1.6}}},T:[{loading:r.L}]};
  const deps={G,t:r.t,ti:0,SIM_DT:1/60,loading,...loadout,...damageApi,sound:Object.assign(new Sound(),{click:()=>events.push('ready')})};
  const frame=new Function(...Object.keys(deps),source.slice(start,end));
  r.g.loaded=-1; loading.fired(r.L,0);
  for(let i=0;i<479;i++) frame(...Object.values(deps));
  assert.equal(r.L.state[0],'loading'); assert.equal(r.g.loaded,-1); assert.deepEqual(events,[]);
  frame(...Object.values(deps)); assert.equal(r.L.state[0],'ready'); assert.equal(r.g.loaded,0); assert.deepEqual(events,['ready']);
  const shownStart=source.indexOf('  function reloadShown('),shownEnd=source.indexOf('\n  }',shownStart)+4;
  const shown=new Function('G','reloadTime',source.slice(shownStart,shownEnd)+'\nreturn reloadShown;')(G,loadout.reloadTime);
  assert.equal(shown(0,0),8);
  assert.equal(damageApi.mountedReloadMult(G.caps,r.g,r.b,state),1);
  let c={kind:'all'}; c=selection.nextWeaponControl(r.lo,c);
  assert.deepEqual(c,{kind:'gun',ti:0,gi:0}); assert.equal(selection.gunTrigger(c,0,0,r.g.def),true);
  assert.equal(selection.machineGunTrigger(c,0,true,true),false);
});

test('fitted cycles preserve sole C2 stock ownership through last-round rejection, stale snapshots and refill', () => {
  const r=stock(),owner=new OnlineAmmo(),fires=new OnlineFires(),session={};
  const frame={t:'ammo',ammo_protocol_version:1,battle:7,life:2,revision:1,processed_through:0,
    counts:{'gun:0:0':[1,0,0]},targets:{'gun:0:0':[1,0,0]},resupply_progress:0,refilled:false};
  owner.begin(frame,r.lo,[r.L]);
  fires.begin({seq:1,scope:owner.scope(),gun:r.g,ammo:r.g.ammo[0],loading:r.L,gi:0,session},0);
  assert.equal(owner.predictCannon(1,'gun:0:0',r.g.shell.id),true);
  r.g.loaded=-1;r.L.state[0]='empty';
  assert.equal(loadout.roundsLeft(r.g),0);
  owner.receive({...frame,revision:2,processed_through:1});
  assert.ok(fires.reject(1,r.g,session,1,{refund:false,scope:owner.scope()}));
  assert.equal(loadout.roundsLeft(r.g),1,'confirmed rejection restores one stock set exactly once');
  assert.equal(r.L.state[0],'waiting'); const cycle=r.L.waitedSince[0];
  advance(r,2); assert.equal(r.L.state[0],'loading'); assert.equal(r.g.loaded,-1);
  assert.equal(fires.reject(1,r.g,session,2,{refund:false,scope:owner.scope()}),null);
  assert.equal(owner.receive({...frame,battle:6,revision:99}),false);
  assert.equal(r.L.waitedSince[0],cycle); assert.equal(loadout.roundsLeft(r.g),1);
  advance(r,6); assert.equal(r.g.loaded,0); assert.equal(loadout.roundsLeft(r.g),1);
  owner.predictCannon(2,'gun:0:0',r.g.shell.id); r.g.loaded=-1;r.L.state[0]='empty';
  owner.receive({...frame,revision:3,processed_through:2,counts:{'gun:0:0':[0,0,0]}});
  assert.equal(advance(r,50).length,0); assert.equal(loadout.roundsLeft(r.g),0);
  owner.receive({...frame,revision:4,processed_through:2,refilled:true});
  assert.equal(r.L.state[0],'waiting');assert.equal(r.g.loaded,-1);assert.equal(loadout.roundsLeft(r.g),1);
  assert.deepEqual(advance(r,8),[0]);assert.equal(r.g.loaded,0);assert.equal(loadout.roundsLeft(r.g),1);
});

test('real source-tagged native T72 C2 outputs replay into stock OnlineAmmo and fitted mechanical work', () => {
  const file=process.env.TG_T72A_RECEIPT||new URL('../../../target/t72a-c2-native.json',import.meta.url);
  assert.ok(fs.existsSync(file),'generate actual T72 C2 receipt before this production replay');
  const receipt=JSON.parse(fs.readFileSync(file,'utf8'));
  for(const [path,bytes] of Object.entries(receipt.sources))assert.equal(fs.readFileSync(new URL('../../../'+path,import.meta.url),'utf8'),bytes,`stale native T72 source:${path}`);
  for(const s of Object.values(receipt.scenarios)) {
    const r=stock(s.mode),owner=new OnlineAmmo();
    const packet=phase=>s.phases[phase].find(e=>e[0]===s.owner&&e[1].t==='ammo')[1];
    owner.begin(packet('deploy'),r.lo,[r.L]);
    assert.equal(owner.predictCannon(41,'gun:0:0',r.g.shell.id),true);
    r.g.loaded=-1;r.L.state[0]='empty';owner.receive(packet('first'));
    assert.equal(loadout.roundsLeft(r.g),0); assert.deepEqual(advance(r,50),[]);
    owner.receive(packet('empty_reject'));assert.equal(loadout.roundsLeft(r.g),0);
    owner.receive(packet('at_5'));assert.equal(loadout.roundsLeft(r.g),1);assert.equal(r.L.state[0],'waiting');assert.equal(r.g.loaded,-1);
    const seconds=loadout.reloadTime(r.t,0,0,s.mode);
    assert.deepEqual(advance(r,seconds-.01),[]);assert.deepEqual(advance(r,.01),[0]);
    assert.equal(r.g.loaded,0);assert.equal(loadout.roundsLeft(r.g),1);
  }
});
