import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { RangeTargetRevival } from '../src/game/rangeTargetRevival.js';
import * as revival from '../src/game/rangeTargetRevival.js';
import { Enemy, useCombat, combatHit } from '../src/game/enemies.js';
import { Combat, emptyRacks, arr3, bulletShell } from '../src/game/combat.js';
import { loadData } from '../tools/load-data.mjs';
import { loadCoreSync } from '../src/design/core.js';
import { makeLoadout, generatedTurretParts } from '../src/game/loadout.js';
import { buildTank } from '../src/gfx/tankmodel.js';
import { buildInterior } from '../src/gfx/interior.js';
import { Renderer } from '../src/gfx/renderer.js';
import { HitCam } from '../src/game/hitcam.js';
import { Terrain } from '../src/game/terrain.js';
import { deriveLoadoutPerformance } from '../src/game/gameplayPerformance.js';
import * as ballistics from '../src/sim/ballistics.js';
import { hitTargets, groundHit } from '../src/game/world.js';

const target = flags => ({rangeTarget:true,remote:false,alive:false,...flags});
const recordingRevival = seen => e => { seen.push(e); e.alive = true; return true; };

test('observed deaths wait exactly fifteen simulation seconds and successes are two seconds apart', () => {
  const r = new RangeTargetRevival(), a = target(), b = target(), seen = [];
  const revive = recordingRevival(seen);
  r.step(0,[a,b],revive);
  r.step(14.999,[a,b],revive);
  assert.deepEqual(seen,[]);
  r.step(.001,[a,b],revive);
  assert.deepEqual(seen,[a]);
  r.step(1.999,[a,b],revive);
  assert.deepEqual(seen,[a]);
  r.step(.001,[a,b],revive);
  assert.deepEqual(seen,[a,b]);
});

test('staggered deaths revive oldest first with current target order breaking ties', () => {
  const r = new RangeTargetRevival(), older = target(), newer = target({alive:true}), tie = target({alive:true}), seen = [];
  const revive = recordingRevival(seen);
  r.step(0,[older,newer,tie],revive);
  newer.alive = tie.alive = false;
  r.step(3,[newer,tie,older],revive);
  r.step(12,[tie,newer,older],revive);
  assert.deepEqual(seen,[older]);
  r.step(3,[tie,newer,older],revive);
  assert.deepEqual(seen,[older,tie]);
  r.step(2,[tie,newer,older],revive);
  assert.deepEqual(seen,[older,tie,newer]);
});

test('large steps revive at most one target and failed revival does not consume a slot', () => {
  const r = new RangeTargetRevival(), a = target(), b = target(), seen = [];
  const revive = recordingRevival(seen);
  r.step(0,[a,b],revive);
  assert.equal(r.step(60,[a,b],()=>false),null);
  assert.equal(r.nextAllowed,0);
  assert.equal(r.dead.get(a),0);
  assert.equal(r.step(0,[a,b],revive),a);
  assert.deepEqual(seen,[a]);
  r.step(0,[a,b],revive);
  assert.deepEqual(seen,[a]);
  r.step(60,[a,b],revive);
  assert.deepEqual(seen,[a,b]);
});

test('invalid dt cannot advance the simulation clock or revive an eligible target', () => {
  const r = new RangeTargetRevival(), a = target(), seen = [];
  const revive = recordingRevival(seen);
  r.step(0,[a],revive);
  r.step(14.999,[a],revive);
  for (const dt of [-1,NaN,Infinity,-Infinity]) assert.equal(r.step(dt,[a],revive),null);
  assert.equal(r.time,14.999);
  assert.deepEqual(seen,[]);
  r.step(.001,[a],revive);
  assert.deepEqual(seen,[a]);
});

test('living damaged actors are unchanged and remote, ordinary, removed and revived actors are purged', () => {
  const state = {modules:[17,0],crew:[100,0],rack_fill:[0,3],fire:4};
  const living = target({alive:true,hp:31,cstate:state,caps:{destroyed:false}});
  const removed = target(), remote = target(), ordinary = target(), resurrected = target(), dead = target();
  const r = new RangeTargetRevival(), seen = [], bytes = JSON.stringify(living);
  const revive = recordingRevival(seen);
  r.step(0,[removed,remote,ordinary,resurrected,dead,living],revive);
  remote.remote = true; ordinary.rangeTarget = false; resurrected.alive = true;
  r.step(15,[remote,ordinary,resurrected,dead,living],revive);
  assert.deepEqual(seen,[dead]);
  assert.equal(r.dead.size,0);
  assert.equal(living.cstate,state);
  assert.equal(JSON.stringify(living),bytes);
});

test('a repeated death gets a new observation deadline and reset discards prior session timing', () => {
  const r = new RangeTargetRevival(), a = target(), seen = [];
  const revive = recordingRevival(seen);
  r.step(0,[a],revive);
  r.step(15,[a],revive);
  a.alive = false;
  r.step(0,[a],revive);
  r.step(14.999,[a],revive);
  assert.deepEqual(seen,[a]);
  r.step(.001,[a],revive);
  assert.deepEqual(seen,[a,a]);
  a.alive = false;
  r.step(0,[a],revive);
  r.reset();
  assert.equal(r.time,0); assert.equal(r.nextAllowed,0); assert.equal(r.dead.size,0);
  r.step(0,[a],revive);
  r.step(14.999,[a],revive);
  assert.equal(seen.length,2);
  r.step(.001,[a],revive);
  assert.equal(seen.length,3);
});

const data = loadData();
const core = loadCoreSync(fs.readFileSync(new URL('../assets/tg_design.wasm',import.meta.url)), {
  materials:data.materials,catalog:data.designCatalog,terrains:Object.values(data.terrains),
});
const terrain = new Terrain(data.terrains);

// The real renderer's upload/lease owners, with only GPU entry points replaced by a CPU sink.
function rendererSink() {
  let serial = 0;
  const created = [], deleted = [];
  const handle = kind => { const h = {[kind]:++serial}; created.push(h); return h; };
  const gl = {ARRAY_BUFFER:1,FLOAT:2,STATIC_DRAW:3,DYNAMIC_DRAW:4,
    createVertexArray:()=>handle('vao'),createBuffer:()=>handle('buffer'),
    bindVertexArray(){},bindBuffer(){},bufferData(){},bufferSubData(){},
    enableVertexAttribArray(){},vertexAttribPointer(){},vertexAttribDivisor(){},
    deleteVertexArray:h=>deleted.push(h),deleteBuffer:h=>deleted.push(h),getExtension:()=>true,
  };
  return Object.assign(Object.create(Renderer.prototype), {
    gl,_live:new Set(),_texSrc:new Map(),lost:false,created,deleted,generation:0,
  });
}
function actor(renderer, combat, key, at = {x:25,z:100,heading:.4}, id = 'su_t54') {
  const sourceBundle = data.vehicles[id];
  const bundle = combat ? combat.prepare(key,sourceBundle) : sourceBundle;
  const loadout = makeLoadout(id,bundle,data.projectiles,data.machineGuns);
  const model = buildTank(renderer,loadout,generatedTurretParts);
  const e = new Enemy(id,bundle,model,terrain,at,[0,0]);
  Object.assign(e,{sourceBundle,loadout,rangeTarget:true,rangeM:100,combatKey:key});
  if (combat) useCombat(e,combat,key);
  e.turretYaw = .6; e.gunPitch = [.2]; e.pose(); model.root.update();
  e.rangeRestPose = revival.captureRangeTargetRestPose(e);
  return e;
}
const poses = rest => rest.joints.map(({node}) => ({
  pos:node.pos.slice(),yaw:node.yaw,pitch:node.pitch,roll:node.roll,local:node.local && node.local.slice(),
}));
const savedPoses = rest => rest.joints.map(({node,...pose}) => pose);
const modelPoses = model => poses({joints:model.turrets.flatMap(t=>[t.node,...t.guns.flatMap(g=>[g.node,g.barrel].filter(Boolean))]).map(node=>({node}))});
const worlds = model => {
  model.root.update();
  const nodes = []; model.root.collect(nodes);
  return nodes.map(n=>[n.name,Array.from(n.world)]);
};
function realDetonation(e) {
  const shell = data.projectiles.aphe_122_br471;
  const rack = e.bundle.modules.find(m=>m.id==='ammo_front');
  const dir = e.veh.body.worldDir([-1,0,0]);
  const o = e.veh.body.worldPoint([40,rack.center.y,rack.center.z]);
  const report = combatHit(e,o.map((v,i)=>v+dir[i]*2),dir,shell,shell.muzzle_velocity_ms*.85,100,2);
  assert.ok(report.events.includes('ammo_detonation') && report.events.includes('fire') && report.caps.destroyed,JSON.stringify(report.events));
  return {report,shell};
}

test('real WASM target revival restores combat and tossed articulation without rebuilding or changing a frozen replay', () => {
  const renderer = rendererSink(), combat = new Combat(core);
  const e = actor(renderer,combat,'revival:chosen'), other = actor(renderer,combat,'revival:other',{x:-25,z:200,heading:.2});
  other.cstate.modules[0] = 17;
  const otherState = other.cstate, otherBytes = JSON.stringify({state:other.cstate,caps:other.caps});
  const rest = e.rangeRestPose, expected = combat.fresh(e.combatKey,e.sourceBundle);
  const ids = {model:e.model,loadout:e.loadout,body:e.veh.body,key:e.combatKey,source:e.sourceBundle,bundle:e.bundle};
  const origin = e.veh.body.origin().slice(), attitude = e.veh.body.attitude();
  const hullPose = {pos:e.model.root.pos.slice(),yaw:e.model.root.yaw,local:e.model.body.local.slice()}, beforeWorlds = worlds(e.model);
  const {report,shell} = realDetonation(e);
  const root = {hidden:true,style:{},dataset:{},querySelector(){return {style:{},dataset:{}};}};
  const hc = new HitCam({renderer,root});
  hc.show({model:e.model,body:e.veh.body,armor:e.bundle.armor,pivot:e.loadout.turrets[0].pivot,
    name:e.name,length:e.model.length,crewRoles:e.bundle.crew.map(c=>c.role),
    interior(){return e.interior ||= buildInterior(renderer,e.model,e.loadout,e.bundle.modules,e.bundle.crew);},
  },report,shell,100);
  const replay = hc.cur, frozen = replay.target;
  const frozenBytes = JSON.stringify({pose:modelPoses(frozen.model),origin:frozen.body.worldPoint([0,0,0]),report});
  e.cstate = combat.ammo(e.combatKey,e.cstate,0).state;
  assert.ok(emptyRacks(e.bundle,e.cstate).size>0,'real core emptied target racks');
  e.cstate.repair_s = 3; e.cstate.repair_targets = [0];
  e.hp = 0; e.hits.push({old:true}); e.seen = true;
  e.toss = {t:2,y:7,vy:0,spin:2,tilt:1};
  const turret = e.model.turrets[0].node;
  turret.pos = [3,9,4]; turret.pitch = 2; turret.roll = 1; turret.yaw = 2;
  e.model.turrets[0].guns[0].barrel.pos[2] += .5;
  const oldState = e.cstate, oldCaps = e.caps, meshes = renderer.created.length;
  const retained = new Set(renderer._live), frozenWorlds = worlds(frozen.model);
  assert.equal(revival.reviveRangeTarget(e,combat),true);
  assert.notEqual(e.cstate,oldState); assert.notEqual(e.caps,oldCaps);
  assert.deepEqual(e.cstate,expected.state); assert.deepEqual(e.caps,expected.caps);
  assert.equal(emptyRacks(e.bundle,e.cstate).size,0);
  assert.equal(e.hp,100); assert.equal(e.alive,true); assert.equal(e.toss,null); assert.equal(e.seen,null); assert.deepEqual(e.hits,[]);
  assert.equal(e.rangeRestPose,rest); assert.deepEqual(poses(rest),savedPoses(rest));
  assert.equal(e.model,ids.model); assert.equal(e.loadout,ids.loadout); assert.equal(e.veh.body,ids.body); assert.equal(e.combatKey,ids.key);
  assert.equal(e.sourceBundle,ids.source); assert.equal(e.bundle,ids.bundle);
  assert.deepEqual(e.veh.body.origin(),origin); assert.deepEqual(e.veh.body.attitude(),attitude);
  assert.deepEqual({pos:e.model.root.pos,yaw:e.model.root.yaw,local:e.model.body.local},hullPose);
  assert.deepEqual(worlds(e.model),beforeWorlds);
  assert.equal(renderer.created.length,meshes,'revival creates no mesh or GPU allocation');
  assert.equal(other.cstate,otherState); assert.equal(JSON.stringify({state:other.cstate,caps:other.caps}),otherBytes);
  assert.equal(hc.cur,replay); assert.equal(hc.active,true);
  assert.deepEqual(renderer._live,retained); assert.deepEqual(worlds(frozen.model),frozenWorlds);
  assert.equal(JSON.stringify({pose:modelPoses(frozen.model),origin:frozen.body.worldPoint([0,0,0]),report}),frozenBytes);
  hc.hide(); e.interior.dispose(); e.model.dispose(); other.model.dispose();
});

test('core-null revival restores the existing actor and later useCombat attaches independent fresh state', () => {
  const renderer = rendererSink(), e = actor(renderer,null,'revival:late');
  const model = e.model, meshes = renderer.created.length;
  e.alive = false; e.hp = 0; e.pose(); e.toss = {y:5};
  assert.equal(revival.reviveRangeTarget(e,null),true);
  assert.equal(e.cstate,null); assert.equal(e.caps,null); assert.equal(e.alive,true);
  assert.equal(e.model,model); assert.equal(renderer.created.length,meshes);
  assert.deepEqual(poses(e.rangeRestPose),savedPoses(e.rangeRestPose));
  const combat = new Combat(core), fresh = combat.fresh(e.combatKey,e.sourceBundle);
  useCombat(e,combat,e.combatKey);
  assert.deepEqual(e.cstate,fresh.state); assert.deepEqual(e.caps,fresh.caps);
  assert.equal(e.model,model); assert.equal(renderer.created.length,meshes);
  e.model.dispose();
});

test('a supplied combat owner that cannot freshen leaves actor and scheduler deadline unchanged', () => {
  const renderer = rendererSink(), e = actor(renderer,null,'revival:failed');
  e.alive = false; e.hp = 0; e.toss = {y:5}; e.pose();
  const state = {destroyed:true,modules:[0]}, caps = {destroyed:true};
  e.cstate = state; e.caps = caps; e.hits.push({old:true}); e.seen = true;
  const before = {poses:poses(e.rangeRestPose),hp:e.hp,toss:e.toss,hits:e.hits.slice(),seen:e.seen,fold:e.fold};
  const r = new RangeTargetRevival(), unavailable = {setFold(){},fresh(){return null;}};
  r.step(0,[e],a=>revival.reviveRangeTarget(a,unavailable));
  assert.equal(r.step(15,[e],a=>revival.reviveRangeTarget(a,unavailable)),null);
  assert.equal(r.dead.get(e),0); assert.equal(r.nextAllowed,0);
  assert.equal(e.cstate,state); assert.equal(e.caps,caps); assert.equal(e.alive,false);
  assert.deepEqual({poses:poses(e.rangeRestPose),hp:e.hp,toss:e.toss,hits:e.hits.slice(),seen:e.seen,fold:e.fold},before);
  assert.equal(r.step(0,[e],a=>revival.reviveRangeTarget(a,null)),e);
  assert.equal(r.nextAllowed,17);
  e.model.dispose();
});

test('the reset adapter rejects living, ordinary, remote or uncaptured actors without touching them', () => {
  for (const e of [target({alive:true}),target({rangeTarget:false}),target({remote:true}),target()]) {
    const bytes = JSON.stringify(e);
    assert.equal(revival.reviveRangeTarget(e,{setFold(){assert.fail('invalid actor registered');}}),false);
    assert.equal(JSON.stringify(e),bytes);
  }
});

function registeringCombat() {
  const registered = new Map();
  let failure = null, newCalls = 0;
  const combat = new Combat({
    combatTarget(def) { const result = core.combatTarget(def); registered.set(def.id,structuredClone(def)); return result; },
    combatNew(id) { newCalls++; if (failure === 'throw') throw new Error('fresh core failure'); return failure ? null : core.combatNew(id); },
  },data.machineGuns);
  return {combat,registered,fail:kind=>{failure=kind;},get newCalls(){return newCalls;}};
}
const registrationMaps = combat => Object.fromEntries(['bundles','descriptions','catalogStamps','foldPose','appliedFold','registrations']
  .map(name=>[name,combat[name] && [...combat[name]]]));

test('real null and throwing fresh failures restore the previous fold definition, registration maps and actor', () => {
  for (const failure of ['null','throw']) {
    const r = registeringCombat(), renderer = rendererSink();
    const e = actor(renderer,r.combat,`revival:fold:${failure}`,undefined,'de_hetzer_mk103');
    e.fold = .7; r.combat.setFold(e.combatKey,.7); r.combat.fresh(e.combatKey,e.sourceBundle);
    e.alive = false; e.hp = 0; e.pose();
    const before = registrationMaps(r.combat), definition = structuredClone(r.registered.get(e.combatKey));
    const actorBefore = {state:e.cstate,caps:e.caps,fold:e.fold,hp:e.hp,poses:poses(e.rangeRestPose)};
    r.fail(failure);
    if (failure === 'throw') assert.throws(()=>revival.reviveRangeTarget(e,r.combat),/fresh core failure/);
    else assert.equal(revival.reviveRangeTarget(e,r.combat),false);
    assert.deepEqual(registrationMaps(r.combat),before);
    assert.deepEqual(r.registered.get(e.combatKey),definition,'real core target definition is restored');
    assert.deepEqual({state:e.cstate,caps:e.caps,fold:e.fold,hp:e.hp,poses:poses(e.rangeRestPose)},actorBefore);
    assert.equal(e.alive,false); e.model.dispose();
  }
});

test('rest-fold fresh uses one new-state call and restores absent maps or changed catalog on failure', () => {
  const r = registeringCombat(), key = 'revival:transaction', bundle = data.vehicles.su_t54;
  r.combat.prepare(key,bundle); r.combat.setFold(key,.7); r.combat.fresh(key,bundle);
  const count = r.newCalls;
  assert.ok(r.combat.fresh(key,bundle,0));
  assert.equal(r.newCalls,count+1); assert.equal(r.combat.foldPose.get(key),0); assert.equal(r.combat.appliedFold.get(key),0);
  r.combat.foldPose.delete(key); r.combat.appliedFold.delete(key);
  const before = registrationMaps(r.combat), definition = structuredClone(r.registered.get(key));
  r.fail('null');
  assert.equal(r.combat.fresh(key,bundle,.8),null);
  assert.deepEqual(registrationMaps(r.combat),before);
  assert.deepEqual(r.registered.get(key),definition);
  r.combat.machineGuns = structuredClone(data.machineGuns);
  const machineGun = Object.values(r.combat.machineGuns).find(m=>m.id===bundle.weapons.secondary[0].weapon);
  machineGun.name += ' changed catalog';
  assert.equal(r.combat.fresh(key,bundle,.5),null);
  assert.deepEqual(registrationMaps(r.combat),before);
  assert.deepEqual(r.registered.get(key),definition,'failed cached catalog refresh restores its prior exact definition');
});

test('rest-fold transactions reject unknown keys and different source identity before core or maps change', () => {
  const r = registeringCombat(), bundle = data.vehicles.su_t54;
  r.combat.prepare('revival:known',bundle);
  const maps = registrationMaps(r.combat), defs = [...r.registered], calls = r.newCalls;
  assert.equal(r.combat.fresh('revival:unknown',bundle,0),null);
  assert.equal(r.combat.fresh('revival:known',structuredClone(bundle),0),null);
  assert.deepEqual(registrationMaps(r.combat),maps); assert.deepEqual([...r.registered],defs); assert.equal(r.newCalls,calls);
});

test('a failing registration rollback throws and still restores the JavaScript registration maps', () => {
  const r = registeringCombat(), key = 'revival:rollback-error', bundle = data.vehicles.de_hetzer_mk103;
  r.combat.prepare(key,bundle);
  const definition = r.combat.registrations.get(key), maps = registrationMaps(r.combat);
  const register = r.combat.core.combatTarget;
  r.combat.core.combatTarget = def => { if (def === definition) throw new Error('registration rollback failure'); return register(def); };
  r.fail('null');
  assert.throws(()=>r.combat.fresh(key,bundle,1),/registration rollback failure/);
  assert.deepEqual(registrationMaps(r.combat),maps);
});

test('in-place catalog edits cannot mutate the saved successful definition used by failed reset rollback', () => {
  const r = registeringCombat(), key = 'revival:catalog-in-place', bundle = data.vehicles.su_t54;
  r.combat.machineGuns = structuredClone(data.machineGuns);
  r.combat.prepare(key,bundle);
  const definition = structuredClone(r.registered.get(key)), maps = registrationMaps(r.combat), sourceBytes = JSON.stringify(bundle);
  const row = Object.values(r.combat.machineGuns).find(m=>m.id===bundle.weapons.secondary[0].weapon), name = row.name;
  try {
    row.name += ' in-place edit'; r.fail('null');
    assert.equal(r.combat.fresh(key,bundle,.5),null);
    assert.deepEqual(r.registered.get(key),definition);
    assert.deepEqual(registrationMaps(r.combat),maps);
    assert.equal(JSON.stringify(bundle),sourceBytes);
  } finally { row.name = name; }
});

const source = fs.readFileSync(new URL('../src/main.js',import.meta.url),'utf8').replaceAll('\r\n','\n');
function functionSource(name) {
  const start = source.indexOf(`  function ${name}(`);
  assert.ok(start>=0,`actual ${name} function is present`);
  return source.slice(start,source.indexOf('\n  }',start)+4);
}
function live(names,deps) {
  return new Function(...Object.keys(deps),`${names.map(functionSource).join('\n')}\nreturn {${names.join(',')}};`)(...Object.values(deps));
}
function rangeRuntime() {
  const renderer = rendererSink(), combat = new Combat(core), rangeTargetRevival = new RangeTargetRevival();
  const scene = {children:[],add(root){this.children.push(root);}};
  const G = {mode:'battle',mapId:'range',map:null,online:null,gameplayMode:'historical',id:'player',enemies:[],combat};
  let hides = 0;
  const deps = {G,data,renderer,scene,terrain,makeLoadout,deriveLoadoutPerformance,buildTank,generatedTurretParts,Enemy,useCombat,
    rangeTargetRevival,...revival,ENEMY_POOL:['su_t54'],hitcam:{hide(){hides++;}},
    rangeVehicleTargets:()=>[{id:'su_t54',x:25,z:100,heading:Math.PI,rangeM:100},{id:'su_t54',x:-25,z:200,heading:Math.PI,rangeM:200}],
  };
  const app = live(['clearEnemies','spawnEnemies','updateRangeTargetRevival','reviveRangeEnemy'],deps);
  return {G,app,renderer,scene,rangeTargetRevival,get hides(){return hides;}};
}

test('actual spawn captures rest poses only for authored targets and teardown clears deadlines before re-entry', () => {
  const r = rangeRuntime(); r.app.spawnEnemies();
  assert.equal(r.G.enemies.length,2);
  const [e,living] = r.G.enemies, key = e.combatKey;
  assert.ok(e.rangeRestPose); assert.deepEqual(poses(e.rangeRestPose),savedPoses(e.rangeRestPose));
  assert.equal(e.rangeRestPose.turretYaw,e.turretYaw);
  living.cstate.modules[0] = 17;
  const livingState = living.cstate, livingBytes = JSON.stringify(living.cstate);
  realDetonation(e);
  r.app.updateRangeTargetRevival(0); r.app.updateRangeTargetRevival(14.999);
  assert.equal(e.alive,false);
  const meshes = r.renderer.created.length, hides = r.hides;
  r.app.updateRangeTargetRevival(.001);
  assert.equal(e.alive,true); assert.equal(r.G.enemies[0],e); assert.equal(r.renderer.created.length,meshes); assert.equal(r.hides,hides);
  assert.equal(living.cstate,livingState); assert.equal(JSON.stringify(living.cstate),livingBytes);
  e.alive = false; r.app.updateRangeTargetRevival(0); r.app.updateRangeTargetRevival(14);
  r.app.clearEnemies();
  assert.equal(r.G.enemies.length,0); assert.equal(r.scene.children.length,0);
  assert.equal(r.rangeTargetRevival.dead.size,0); assert.equal(r.rangeTargetRevival.time,0); assert.equal(r.rangeTargetRevival.nextAllowed,0);
  r.app.spawnEnemies();
  const next = r.G.enemies[0]; assert.notEqual(next,e); assert.equal(next.combatKey,key);
  next.alive = false; r.app.updateRangeTargetRevival(0); r.app.updateRangeTargetRevival(1);
  assert.equal(next.alive,false,'prior session death time cannot carry into this actor');
  r.G.map = {spawns:{blue:[{x:0,z:0}],red:[{x:20,z:500,heading:Math.PI}]}};
  r.app.spawnEnemies();
  assert.equal(r.G.enemies.length,1); assert.equal(r.G.enemies[0].rangeTarget,false); assert.equal(r.G.enemies[0].rangeRestPose,undefined);
  r.app.clearEnemies();
});

test('actual gate advances only offline battle range and excludes garage, test, map and online worlds', () => {
  const r = rangeRuntime(); r.app.spawnEnemies(); const e = r.G.enemies[0]; e.alive = false;
  for (const excluded of [{mode:'garage'},{mode:'test'},{mapId:'battlefield'},{map:{}},{online:{team:'blue'}}]) {
    const previous = {...r.G}; Object.assign(r.G,excluded);
    r.app.updateRangeTargetRevival(60);
    assert.equal(r.rangeTargetRevival.time,0); assert.equal(r.rangeTargetRevival.dead.size,0); assert.equal(e.alive,false);
    Object.assign(r.G,previous);
  }
  r.app.updateRangeTargetRevival(0); r.app.updateRangeTargetRevival(14.999);
  assert.equal(e.alive,false); r.app.updateRangeTargetRevival(.001); assert.equal(e.alive,true);
  r.app.clearEnemies();
});

test('the actual update projectile block observes both final damage states exactly once before scene collection', () => {
  const r = rangeRuntime(); r.app.spawnEnemies(); const [a,b] = r.G.enemies;
  const update = functionSource('update');
  const start = update.indexOf('// ---- projectiles and effects'), end = update.indexOf('    if (G.missiles)',start);
  assert.ok(start>=0 && end>start,'actual projectile update block');
  const calls = [];
  const tick = new Function('dt','updateShots','updateBullets','updateRangeTargetRevival',update.slice(start,end));
  tick(0,()=>{calls.push('shots'); a.alive=false;},()=>{calls.push('bullets'); b.alive=false;},dt=>{calls.push('revival');r.app.updateRangeTargetRevival(dt);});
  assert.deepEqual(calls,['shots','bullets','revival']);
  assert.equal(r.rangeTargetRevival.dead.get(a),0); assert.equal(r.rangeTargetRevival.dead.get(b),0);
  assert.ok(update.indexOf('updateRangeTargetRevival(dt)',start)<update.indexOf('scene.collect('),'reset precedes scene collection');
  tick(15,()=>{},()=>{},r.app.updateRangeTargetRevival);
  assert.equal(a.alive,true); assert.equal(b.alive,false);
  tick(2,()=>{},()=>{},r.app.updateRangeTargetRevival);
  assert.equal(b.alive,true);
  r.app.clearEnemies();
});

test('real cannon, bullet, missile, splash and fire death owners reach the same live observer', () => {
  const sink = new Proxy({}, {get:()=>()=>{}});
  for (const owner of ['cannon','bullet','missile','splash','fire']) {
    const renderer = rendererSink(), combat = new Combat(core), e = actor(renderer,combat,`revival:owner:${owner}`,undefined,['bullet','missile','splash'].includes(owner)?'us_m56':'su_t54');
    const G = {mode:'battle',mapId:'range',map:null,online:null,combat,enemies:[e],s:{x:0,z:0},camPos:[0,2,0],combatAcc:0,cstate:null};
    const rangeTargetRevival = new RangeTargetRevival();
    const deps = {G,data,rangeTargetRevival,...revival,combatHit,arr3,bulletShell,ballistics,hitTargets,groundHit,
      ME:1,BULLET_DT:1/240,rng:{nextF32:()=>2/4294967295},fx:sink,sound:sink,hud:sink,showHit(){},onCombatHit(){},syncRacks(){},
      rangeTargets:()=>[],buildingHit:()=>null,surfaceAt:()=>-1000,enemyOwner:i=>100+i,
    };
    const names = ['updateRangeTargetRevival','reviveRangeEnemy','hitEnemy','splashNear','advanceCombat','missileImpacts','updateBullets'];
    const app = live(names,deps);
    if (owner === 'cannon') realDetonation(e);
    if (owner === 'fire') {
      e.cstate.crew = e.cstate.crew.map(()=>1); e.cstate.fire_s = 10; e.cstate.fire_at = e.bundle.crew[1].pos;
      app.advanceCombat(1);
    }
    if (owner === 'splash') app.splashNear(e.veh.body.worldPoint([0,1.5,0]),data.projectiles.he_420_tt250);
    if (owner === 'missile') {
      const rack = e.bundle.modules.find(m=>m.kind==='ammo_rack'), dir = e.veh.body.worldDir([-1,0,0]);
      const p0 = e.veh.body.worldPoint([40,rack.center.y,rack.center.z]), p1 = e.veh.body.worldPoint([-40,rack.center.y,rack.center.z]);
      G.missiles = {segments:()=>[{id:1,def:'tt250_rocket',owner:1,p0,p1,vel:dir.map(v=>v*200)}],end(){}};
      app.missileImpacts({});
    }
    if (owner === 'bullet') {
      const def = data.machineGuns.kpvt, dir = e.veh.body.worldDir([-1,0,0]);
      e.turretYaw = 0; e.pose();
      e.cstate.crew = e.cstate.crew.map(()=>1);
      G.bulletShells = new Map();
      G.bullets = e.bundle.crew.map(c=>({def,age:0,travelled:0,tracer:false,
        s:ballistics.newShot(e.veh.body.worldPoint([40,c.pos.y,c.pos.z]),dir,bulletShell(def))}));
      app.updateBullets(.1);
    }
    assert.equal(e.alive,false,`${owner} actually destroys its actor through the real damage owner`);
    assert.equal(e.caps.destroyed,true);
    app.updateRangeTargetRevival(0); app.updateRangeTargetRevival(14.999);
    assert.equal(e.alive,false,`${owner} uses the shared observation deadline`);
    app.updateRangeTargetRevival(.001);
    assert.equal(e.alive,true,`${owner} is restored at the shared fifteen-second boundary`);
    assert.equal(e.caps.destroyed,false); e.model.dispose();
  }
});
