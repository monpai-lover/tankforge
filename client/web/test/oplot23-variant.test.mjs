import { Missiles } from '../src/game/missiles.js';
import stabilizerDrives from '../../../config/stabilizer-drives.json' with { type: 'json' };
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as gunnery from '../src/sim/gunnery.js';
import * as ballistics from '../src/sim/ballistics.js';
import * as mgSim from '../src/sim/mg.js';
import * as loading from '../src/sim/loading.js';
import * as optics from '../src/game/optics.js';
import * as selection from '../src/game/weaponselection.js';
import * as loadout from '../src/game/loadout.js';
import { hullTilt } from '../src/sim/tank/tank.js';
import { RigidBody } from '../src/sim/tank/body.js';
import { foldDepression, foldYawLimit } from '../src/game/folding.js';
import { loadData } from '../tools/load-data.mjs';
import { loadCoreSync } from '../src/design/core.js';
import { Hud } from '../src/game/hud.js';
import { OnlineFires } from '../src/game/onlineFire.js';
import { OnlineAmmo } from '../src/game/onlineAmmo.js';
import { buildTank } from '../src/gfx/tankmodel.js';
import { Combat, launcherCanFire, bulletShell } from '../src/game/combat.js';
import { Enemy, useCombat, combatHit } from '../src/game/enemies.js';
import { hitTargets, groundHit } from '../src/game/world.js';
import * as performanceApi from '../src/game/gameplayPerformance.js';
import * as phys from '../src/sim/physics.js';
import { VehicleSim } from '../src/game/vehicle.js';
import { applyAmmo } from '../src/game/deploy.js';
import { ground } from './tankrig.mjs';
import { GameplaySession } from '../src/game/gameplaySession.js';
import { GAMEPLAY_RULES_VERSION } from '../src/game/gameplayRules.js';
import { GAMEPLAY_UPDATE_NEEDED } from '../src/game/net.js';
import { normalizeWorkshopBuild } from '../src/game/workshopBuild.js';
import * as damageApi from '../src/game/weaponDamage.js';
import { ammoMix, consumeApsRounds } from '../src/game/ammoInventory.js';
import { Mods, familyOf } from '../src/game/mods.js';
import { decodeAllImported, decodeImported } from '../src/gfx/imported.js';
import { exportWorkshopModel } from '../src/game/workshopImported.js';
import { GeoBuilder, STRIDE } from '../src/gfx/geo.js';
import { addPart, materials } from '../src/gfx/tankmodel.js';
import { transformPoint, transformDir, mul, translation, rotX, rotY, rotZ } from '../src/gfx/math.js';
import { advanceGunRecoil } from '../src/game/fx.js';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const source = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const data = loadData(), DEG = Math.PI / 180, ME = 1;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const dirFrom = (yaw, pitch) => [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
// Run the exact live function bodies, with real gun/loadout/ballistic dependencies.
// Presentation and transport sinks are the only fakes; no browser is needed.
function functionSource(name) {
  const start = source.indexOf(`  function ${name}(`);
  return start < 0 ? '' : source.slice(start, source.indexOf('\n  }', start) + 4);
}
function controls(id, mode = 'historical', rng = { nextF32: () => .5 }) {
  const lo = performanceApi.deriveLoadoutPerformance(loadout.makeLoadout(id, data.vehicles[id], data.projectiles, data.machineGuns), mode);
  const G = { id, mode: 'battle', weaponControl: { kind: 'all' }, gameplayMode: mode, loadout: lo, zero: 0,
    s: { x: 0, y: 0, z: 0, heading: 0 }, ss: { pitch: 0, roll: 0 },
    sightT: 0, sightG: 0, sightM: -1, pending: [], zoomIdx: 0,
    cam: { yaw: 0, pitch: 0, shake: 0 }, camPos: [0, 3, 0], aimPoint: [0, 3, 800], aim: { dist: 800 },
    MG: lo.machineGuns.map(m => ({ m, st: mgSim.newMg(m.def), aim: { yaw: 0, pitch: 0 }, bearing: true })),
    T: lo.turrets.map(t => ({ yaw: t.facing, bearing: true, yawErr: 0,
      guns: t.guns.map(() => ({ pitch: 0, pitchErr: 0, smoke: 0 })),
      loading: loading.newLoading(t.guns.length, t.loaders.length, t.guns.map(g => !g.rack)) })),
    aps: lo.weapons.aps, apsOn: true, shots: [], bullets: [], online: null,
    veh: { body: new RigidBody(1000, [1000, 1000, 1000], [0, 0, 0]), impulses: [], impulse(j, p) { this.impulses.push({j,p}); this.body.applyImpulseAt(j, p); }, worldPoint(p) { return this.body.worldPoint(p); } },
  };
  G.veh.netState=()=>({pos:G.veh.body.origin(),ex:G.veh.body.ex,ez:G.veh.body.ez,v:G.veh.body.v,w:G.veh.body.w,track:[0,0],rpm:0,gear:0});
  const sent = [], apsCalls = [];
  const core = loadCoreSync(fs.readFileSync(process.env.TG_TEST_WASM || new URL('../assets/tg_design.wasm', import.meta.url)),
    { materials: data.materials, catalog: data.designCatalog, terrains: Object.values(data.terrains) });
  const combat = new Combat(core, data.machineGuns), fresh = combat.fresh('control:' + id, data.vehicles[id]);
  G.combat = combat; G.combatKey = 'control:' + id; G.cstate = fresh.state; G.caps = fresh.caps;
  G.bundle = combat.prepare?.(G.combatKey, data.vehicles[id]) || data.vehicles[id];
  core.call({ op: 'mw_reset', defs: Object.values(data.missiles) });
  if (G.aps) core.call({ op: 'mw_aps', owner: ME, team: 0, def: G.aps, seed: 10 });
  G.missiles = new Missiles({core,defs:data.missiles,projectiles:data.projectiles});
  const setAps=G.missiles.setAps.bind(G.missiles);
  G.missiles.setAps=(owner,enabled,rate_rpm=null,rounds=null)=>{apsCalls.push({owner,enabled,rounds});setAps(owner,enabled,rate_rpm,rounds);};
  const onlineAmmo=new OnlineAmmo(), selected=ammoMix(lo);
  onlineAmmo.begin({t:'ammo',ammo_protocol_version:1,battle:7,life:2,revision:1,processed_through:0,counts:selected,targets:selected,resupply_progress:0,refilled:false},lo,G.T.map(t=>t.loading));
  const deps = { G, stabilizerDrives, ME, data, DEG, RECOIL_ROCK: 1, BULLET_DT: 1 / 120, clamp, dirFrom, hullTilt, gunnery, ballistics, mgSim, loading, consumeApsRounds,
    foldDepression, foldYawLimit, launcherCanFire, ...damageApi, ...performanceApi,
    ...selection, ...loadout, ...optics, rng,
    onlineFires: new OnlineFires(), onlineAmmo, net: { open: true, send: m => sent.push(m) }, hud: { buildAmmo() {}, toast() {}, aps() {} },
    sound: { tone() {}, apsGun() {}, mg() {}, shot() {} }, fx: { mgFlash() {}, autocannonBlast() {}, muzzleBlast() {}, bulletBoard() {}, bulletGround() {}, beam() {} },
    hitTargets, groundHit, combatHit, bulletShell, rangeTargets: () => [], buildingHit: () => null, onCombatHit() {}, rnd: k => v => Math.round(v * k) / k,
    surfaceAt: () => 0, impactColor: () => [0, 0, 0], selectAmmo() {},
    launcherMount: loadout.launcherMount, reloadTime: loadout.reloadTime,
  };
  delete deps.sightLevels;
  const preamble = source.slice(source.indexOf('  const pose = '), source.indexOf('  // ----------------------------------------------------------------- workshop'));
  const moduleCheck = source.slice(source.indexOf('  const moduleOk ='), source.indexOf('  /** Where the protection gun'));
  const stabilizers = source.slice(source.indexOf('  const GUNNER ='), source.indexOf('  /**\n   * The hull\'s attitude'));
  const functions = ['cycleSightGun', 'trigger', 'fireGun', 'layMg', 'sightMuzzle', 'stepMachineGuns', 'hitEnemy', 'wireShot', 'updateBullets', 'currentLos', 'applyAps', 'toggleAps', 'apsAutomatic', 'apsHullPose','apsFrame','heldApsPose','sendOnlineState','acceptApsPose','suspendApsPose','syncApsControl', 'mountFor', 'apsOf', 'trackHull', 'aimTurrets'].map(functionSource).join('\n');
  const live = new Function(...Object.keys(deps), `${preamble}\n${moduleCheck}\n${stabilizers}\n${functions}\nreturn {cycleSightGun, trigger, fireGun, layMg, sightMuzzle, stepMachineGuns, updateBullets, currentLos, applyAps, toggleAps, syncApsControl, apsOf, aimTurrets};`)(...Object.values(deps));
  const snapshot = () => core.call({ op: 'mw_step', dt: 1 / 60, actors: [] }).aps[0];
  return { G, live, sent, apsCalls, snapshot, core, combat, damage: (id, health = 0) => {
    G.cstate.modules[G.bundle.modules.findIndex(m => m.id === id)] = health;
    G.caps = combat.advance(G.combatKey, G.cstate, 0, 1).caps;
  } };
}
function chooseControl(r, key) {
  for (let i = 0; i < selection.weaponControlSlots(r.G.loadout).length; i++) {
    if (selection.weaponControlKey(r.G.weaponControl) === key) return;
    r.live.cycleSightGun();
  }
  assert.equal(selection.weaponControlKey(r.G.weaponControl), key, 'actual G reaches requested control');
}
const close = (actual, expected, message, epsilon = 1e-7) => assert.ok(Math.abs(actual - expected) < epsilon, `${message}: ${actual} != ${expected}`);
const ID = 'su_t10m_oplot23';
const original = structuredClone(data.vehicles.su_t10m);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function triangleCovers(point, triangle) {
  const cross = (a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  if(Math.abs(cross(...triangle))<1e-12)return false;
  const sides=triangle.map((a,i)=>cross(a,triangle[(i+1)%3],point));
  return sides.every(v=>v>=-1e-10)||sides.every(v=>v<=1e-10);
}
const root = new URL('../../../', import.meta.url);
const sourceHashes = Object.fromEntries(['vehicle','weapons','visual','armor','modules','crew','engine','model'].map(k => [k, sha(fs.readFileSync(new URL(`data/vehicles/su_t10m/${k}.json`, root)))]));

test('independent custom Oplot23 is registered next to the unchanged original and selects through Mods', () => {
  assert.ok(data.vehicles[ID], 'independent six-barrel Oplot23 must be registered');
  assert.equal(data.order.indexOf(ID), data.order.indexOf('su_t10m') + 1);
  const b = data.vehicles[ID];
  assert.equal(b.vehicle.id, ID); assert.match(b.vehicle.meta.notes, /hypothetical|custom/i);
  for (const k of ['engine','armor','modules','crew']) assert.deepEqual(b[k], original[k], k);
  for (const k of ['hull','turret','physics']) assert.deepEqual(b.vehicle[k], original.vehicle[k], k);
  assert.deepEqual(b.weapons.main_gun, original.weapons.main_gun);
  const g = b.weapons.extra_turrets[0].guns[0];
  assert.equal(g.gun.caliber_mm, 23); assert.equal(g.gun.mass_kg, 76); assert.equal(g.gun.barrel_length_mm, 1000);
  assert.equal(g.muzzle_offset_m, 1); assert.deepEqual(g.gun.ammo, ['api_23_bza','hei_23_ofz']);
  assert.deepEqual(g.gun.ammo_count, [300,200]);
  assert.deepEqual(g.gun.autocannon, {rate_rpm:8000,belt_rounds:500,belt_reload_s:30,spin_up_s:.35});
  const aps = b.weapons.aps;
  assert.equal(aps.rate_rpm, 8000); assert.deepEqual(aps.rate_range_rpm,[6000,8000]); assert.equal(aps.rounds,500);
  assert.equal(aps.bullet_caliber_mm,23); assert.equal(aps.bullet_mass_kg,.174); assert.equal(aps.bullet_speed_ms,715); assert.equal(aps.barrel_m,1);
  for (const key of Object.keys(original.weapons.aps).filter(k => !['name','rate_rpm','rate_range_rpm','rounds','barrel_m','bullet_speed_ms','bullet_mass_kg','bullet_caliber_mm'].includes(k))) assert.deepEqual(aps[key], original.weapons.aps[key], key);
  const store = {get(){return null;},set(){}}; const mods = new Mods(store,'test',id=>!!data.vehicles[id]);
  assert.equal(familyOf(ID).key,'su_t10m'); mods.choose(ID); assert.equal(mods.variantOf('su_t10m'),ID);
  assert.equal(mods.cards(data.order).filter(([k])=>k==='su_t10m').length,1);
  mods.choose('su_t10m'); assert.equal(mods.variantOf('su_t10m'),'su_t10m');
  assert.equal(mods.slots(ID,1).weapons.length,2);
});

test('new API curve recomputes drag and De Marre from declared B32 steel coefficient; HEI uses existing HE authoring', () => {
  const api=data.projectiles.api_23_bza, hei=data.projectiles.hei_23_ofz, src=data.projectiles.api_145_b32;
  assert.ok(api && hei,'new rounds must load');
  const k=src.muzzle_velocity_ms*Math.sqrt(src.mass_kg)/((src.caliber_mm/100)**.75*(src.penetration_curve[0].pen_mm/100)**.7);
  close(api.meta.demarre_steel_k,k,'declared coefficient');
  for (const [p,kind,len] of [[api,'ap',98.5],[hei,'he',102.5]]) {
    assert.equal(p.kind,kind); assert.equal(p.caliber_mm,23); assert.equal(p.mass_kg,.174); assert.equal(p.muzzle_velocity_ms,715); assert.equal(p.length_mm,len);
    assert.match(p.meta.notes,/index|copy|estimate/i);
  }
  for (const row of api.penetration_curve) {
    const drag=.5*1.225*.30*Math.PI*(.023/2)**2/.174;
    const v=715*Math.exp(-drag*row.distance_m), pen=((v*Math.sqrt(.174))/(k*(23/100)**.75))**(1/.7)*100;
    close(row.pen_mm,Math.round(pen*10)/10,`23 mm curve ${row.distance_m}`);
  }
  assert.notDeepEqual(api.penetration_curve,src.penetration_curve);
  assert.equal(api.explosive_mass_kg,0); assert.equal(hei.explosive_mass_kg,.0178); assert.equal(hei.explosive_type,'a_ix_2');
  hei.penetration_curve.forEach(row=>close(row.pen_mm,Math.round(14*Math.sqrt(.0178)*10)/10,'existing HE curve'));
});

test('decoded shared housing excludes old barrels; actual build has six open 23 mm tubes and independent export', async () => {
  assert.ok(data.vehicles[ID]);
  await decodeAllImported({su_t10m:data.vehicles.su_t10m,[ID]:data.vehicles[ID]});
  const b=data.vehicles[ID]; assert.deepEqual(b.model.shared,{from:'su_t10m',mounts:['turret','gun']});
  assert.equal(b.model.parts.length,0); assert.equal(b.imported.parts.length,data.vehicles.su_t10m.imported.parts.filter(p=>['turret','gun'].includes(p.mount)).length);
  assert.ok(b.imported.parts.every(p=>p.mount!=='barrel'));
  const lo=loadout.makeLoadout(ID,b,data.projectiles,data.machineGuns);
  const renderer={mesh:vertices=>({vertices}),instancedMesh:vertices=>({vertices}),setInstances(){},freeMesh(){}};
  const model=buildTank(renderer,lo,loadout.generatedTurretParts), gun=lo.turrets[1].guns[0];
  const parts=b.visual.parts.filter(p=>p.mount==='gun'&&p.turret===1&&p.recoil);
  assert.equal(parts.length,6); assert.deepEqual(b.visual.parts.slice(0,-6),original.visual.parts);
  const centers=parts.map(p=>p.pos.slice(0,2));
  const combined=new GeoBuilder();
  for (const [i,p] of parts.entries()) {
    close(p.pos[0],.502+.055*Math.cos(2*Math.PI*i/6),'circle x'); close(p.pos[1],2.715+.055*Math.sin(2*Math.PI*i/6),'circle y');
    assert.equal(p.len,1); assert.equal(p.segs,32); close(p.pos[2]+p.len/2,1.557,'muzzle plane');
    const geo=new GeoBuilder(); addPart(geo,p,gun.trunnion,materials(b.visual.palette),gun.def.caliber_mm/2000);
    addPart(combined,p,gun.trunnion,materials(b.visual.palette),gun.def.caliber_mm/2000);
    const v=geo.build(), lip=[];
    for(let j=0;j<v.length;j+=STRIDE) if(Math.abs(v[j+2]-1)<1e-6) lip.push(Math.hypot(v[j]-(p.pos[0]-.502),v[j+1]-(p.pos[1]-2.715)));
    close(Math.min(...lip)*2000,23,'actual inner diameter mm',.001); close(Math.max(...lip)*2,.045,'outer diameter',1e-6);
    for(let j=0;j<v.length;j+=STRIDE*3) {
      const tri=[0,1,2].map(k=>Array.from(v.slice(j+k*STRIDE,j+k*STRIDE+3)));
      if(tri.every(q=>Math.abs(q[2]-1)<1e-6)) {
        assert.ok(tri.every(q=>Math.hypot(q[0]-(p.pos[0]-.502),q[1]-(p.pos[1]-2.715))>=.011499),'lip stays outside bore');
        assert.equal(triangleCovers([p.pos[0]-.502,p.pos[1]-2.715],tri),false,'no front triangle closes the bore axis');
      }
    }
  }
  for(let i=0;i<6;i++)for(let j=i+1;j<6;j++)assert.ok(Math.hypot(...centers[i].map((x,k)=>x-centers[j][k]))>.045,'tubes do not overlap');
  assert.deepEqual(model.turrets[1].guns[0].barrel.mesh.vertices,combined.build(),'six tubes built by actual model owner');
  model.root.update();
  const avg=[0,1,2].map(k=>parts.reduce((s,p)=>s+transformPoint(model.turrets[1].guns[0].barrel.world,[p.pos[0]-.502,p.pos[1]-2.715,1])[k],0)/6);
  const axis=transformPoint(model.turrets[1].guns[0].node.world,[0,0,1]); avg.forEach((v,k)=>close(v,axis[k],'average muzzle axis',1e-6));
  const exported=exportWorkshopModel(b,true,data), decoded=await decodeImported(exported);
  assert.equal(exported.shared,undefined); assert.equal(decoded.parts.length,b.imported.parts.length);
  decoded.parts.forEach((p,i)=>assert.deepEqual(p.pos,b.imported.parts[i].pos,'export retains exact housing'));
  const out=loadout.exportFolder({base:ID,keepStock:true,turrets:[]},data,b,'test23','test23');
  assert.equal(out.files['weapons.json'].extra_turrets[0].guns[0].gun.autocannon.rate_rpm,8000,'source export remains original-valued');
});

function loadStep(r,dt) {
  const a=source.indexOf('      G.loadout.turrets.forEach((t, ti) => {\n        t.guns.forEach((g) => tickLauncher');
  const b=source.indexOf('\n      G.acc -= SIM_DT;',a);
  const deps={...selection,G:r.G,SIM_DT:dt,...loadout,loading,...damageApi,sound:{click(){}},clamp};
  new Function(...Object.keys(deps),source.slice(a,b))(...Object.values(deps));
}

test('actual API and HEI manual fire consume rounds, recoil the rigid body and retain readiness in both modes', () => {
  for(const id of ['su_t10m',ID])for(const mode of ['historical','casual']) {
    assert.ok(data.vehicles[id]); const r=controls(id,mode),g=r.G.loadout.turrets[1].guns[0];
    chooseControl(r, 'gun:1:0'); assert.equal(r.snapshot().enabled,false); g.spin=1; r.G.fireHeld=true;
    const expectedRate=(id===ID?8000:10000)*(mode==='casual'?1.2:1);
    assert.equal(g.def.autocannon.rate_rpm,expectedRate); assert.equal(r.G.aps.rate_rpm,expectedRate);
    close(r.G.loadout.turrets[1].traverse/original.weapons.extra_turrets[0].traverse_deg_s,mode==='casual'?1.3:1,'traverse once');
    for(let ai=0;ai<(id===ID?2:1);ai++) {
      if(ai){g.selected=ai;g.loaded=ai;loadout.syncGunShell(g);}
      const shell=g.shell,before=loadout.roundsLeft(g),vz=r.G.veh.body.v[2];
      assert.equal(r.live.fireGun(1,0),true); assert.equal(r.live.fireGun(1,0),false,'cycle is unready immediately');
      assert.equal(loadout.roundsLeft(g),before-1); const shot=r.G.shots.at(-1);
      assert.equal(shot.shell,shell); close(Math.hypot(...shot.s.vel),shell.muzzle_velocity_ms,'actual emitted velocity',1e-6);
      if(id===ID){assert.equal(shot.s.mass,.174);close(shot.s.area,Math.PI*(.023/2)**2,'actual shot area');assert.equal(shot.shell.caliber_mm,23);assert.equal(shot.shell.explosive_mass_kg,ai?.0178:0);}
      assert.ok(r.G.veh.body.v[2]<vz,'real automatic gun body recoil impulse');
      close(vz-r.G.veh.body.v[2],shell.mass_kg*shell.muzzle_velocity_ms*1.3/r.G.veh.body.mass,'recoil uses emitted round momentum');
      let elapsed=0;while(r.G.T[1].loading.state[0]!=='ready'&&elapsed<.1){loadStep(r,.0005);elapsed+=.0005;}
      close(elapsed,60/expectedRate,'actual cycle',.00051);
    }
    chooseControl(r, 'all'); assert.equal(r.snapshot().rounds,loadout.roundsLeft(g),'manual/auto shared rounds');
  }
});

test('actual autocannon recoil opposes the nominal world muzzle on tilted parented poses and acts at the physical trunnion', () => {
  for(const [pitch,roll] of [[0,0],[.2,0],[0,.2],[.2,.1]])for(const mode of ['historical','casual']) {
    let draw=0; const r=controls(ID,mode,{nextF32:()=>[.75,.25][draw++%2]});
    const matrix=mul(translation(10,1,-5),mul(rotY(.6),mul(rotX(-pitch),rotZ(roll))));
    const body=r.G.veh.body;
    body.ex=transformDir(matrix,[1,0,0]);body.ey=transformDir(matrix,[0,1,0]);body.ez=transformDir(matrix,[0,0,1]);body.pos=[10,1,-5];
    r.G.ss=body.attitude();r.G.s={x:10,y:1,z:-5,heading:r.G.ss.heading};
    chooseControl(r, 'gun:1:0');r.G.T[0].yaw=.7;r.G.T[1].yaw=1.1;r.G.T[1].guns[0].pitch=.25;
    const g=r.G.loadout.turrets[1].guns[0], t=r.G.loadout.turrets[1];
    const nominal=r.live.sightMuzzle(hullTilt(r.G.ss,1.1));
    const parent=r.G.loadout.turrets[0];
    const pivot=gunnery.muzzleLocal({pivot:parent.pivot,trunnion:t.pivot,muzzleOffset:0},{yaw:.7,pitch:0}).trunnion;
    const mount={pivot,trunnion:g.trunnion.map((v,k)=>v+pivot[k]-t.pivot[k]),muzzleOffset:g.muzzleOffset};
    const local=gunnery.muzzleLocal(mount,{yaw:1.1,pitch:.25});
    const physicalTrunnion=body.worldPoint(local.trunnion), momentum=g.shell.mass_kg*g.shell.muzzle_velocity_ms*1.3;
    assert.equal(r.live.fireGun(1,0),true);
    const impulse=r.G.veh.impulses[0];assert.ok(impulse);
    impulse.j.forEach((v,k)=>close(v,-nominal.dir[k]*momentum,`${mode} tilted nominal recoil ${pitch}/${roll}`,1e-5));
    impulse.p.forEach((v,k)=>close(v,physicalTrunnion[k],'physical parented trunnion',1e-6));
    const shot=r.G.shots[0];shot.origin.forEach((v,k)=>close(v,nominal.pos[k],'actual emitted origin',1e-6));
    const actualDir=shot.s.vel.map(v=>v/g.shell.muzzle_velocity_ms);
    assert.ok(Math.hypot(...actualDir.map((v,k)=>v-nominal.dir[k]))>1e-7,'dispersion belongs to the bullet; recoil uses the average nominal gun axis');
    body.v.forEach((v,k)=>close(v,impulse.j[k]/body.mass,'actual rigid body velocity',1e-6));
    assert.ok(Math.hypot(...body.w)>0,'off-center physical trunnion twists the rigid body');
  }
});

test('actual live aiming and pose keep parent yaw, pitch, recoil and rotary cluster transform', async () => {
  assert.ok(data.vehicles[ID]); const r=controls(ID),a=controls(ID,'casual');
  for(const q of [r,a]){chooseControl(q, 'gun:1:0');q.G.aimPoint=[400,200,400];q.live.aimTurrets(.005);}
  close(a.G.T[1].yaw/r.G.T[1].yaw,1.3,'actual Oplot aiming yaw'); close(a.G.T[1].guns[0].pitch/r.G.T[1].guns[0].pitch,1.2,'actual elevation');
  const renderer={mesh:vertices=>({vertices}),instancedMesh:vertices=>({vertices}),setInstances(){},freeMesh(){}};
  r.G.model=buildTank(renderer,r.G.loadout,loadout.generatedTurretParts);
  r.G.veh.hullLocal=()=>r.G.model.body.local; r.G.T[0].yaw=.7;r.G.T[1].yaw=1.1;r.G.T[1].guns[0].pitch=.25;r.G.T[1].guns[0].recoilT=0;r.G.loadout.turrets[1].guns[0].spin=1;
  const from=source.indexOf('    M.body.local = G.veh.hullLocal'),to=source.indexOf('    for (const pm of M.mgs)',from);
  const deps={M:r.G.model,G:r.G,dt:.0007,gunnery,advanceGunRecoil,fx:{muzzleSmoke(){}},hullTilt,pose:()=>({}),mountOf:loadout.mountOf};
  new Function(...Object.keys(deps),source.slice(from,to))(...Object.values(deps));r.G.model.root.update();
  const mount=r.G.model.turrets[1].guns[0]; close(r.G.model.turrets[1].node.yaw,.4,'relative parent yaw'); close(mount.node.pitch,-.25,'pitch');
  assert.ok(mount.barrel.pos[2]<0); assert.ok(mount.barrel.roll>0);
  const mz=r.live.sightMuzzle();transformPoint(mount.node.world,[0,0,1]).forEach((v,k)=>close(v,mz.pos[k],'actual posed firing axis',1e-6));
  close(Math.hypot(...transformDir(mount.barrel.world,[0,0,1])),1,'rotation keeps bore axis',1e-6);
});

test('actual WASM automatic interception emits 23 mm rounds and shares depletion with manual control', () => {
  for(const mode of ['historical','casual']) {
    assert.ok(data.vehicles[ID]); const r=controls(ID,mode);
    const actor={id:1,team:0,alive:true,center:[0,1.3,0],aps_pivot:[.502,2.715,.557],aps_base_yaw:0,aps_gun_ok:true,aps_radar_ok:true};
    r.core.call({op:'mw_launch',def:'bgm71a_tow',owner:99,team:1,pos:[0,2,600],dir:[0,0,-1],seed:3});
    let fired=[],last;
    for(let i=0;i<1200&&!fired.length;i++){last=r.core.call({op:'mw_step',dt:1/120,actors:[actor]});fired=last.fired;}
    assert.ok(fired.length,'real world emits interception bullets');
    fired.forEach(b=>{close(Math.hypot(...b.vel),715,'APS actual velocity',1e-6);assert.equal(r.G.aps.bullet_caliber_mm,23);assert.equal(r.G.aps.bullet_mass_kg,.174);});
    r.live.applyAps(last,{aps_gun_ok:true,aps_radar_ok:true}); const g=r.G.loadout.turrets[1].guns[0];
    assert.equal(loadout.roundsLeft(g),last.aps[0].rounds);chooseControl(r, 'gun:1:0');assert.equal(r.live.fireGun(1,0),true);chooseControl(r, 'all');assert.equal(r.snapshot().rounds,last.aps[0].rounds-1);
    const blocked=r.core.call({op:'mw_step',dt:1/120,actors:[{...actor,aps_gun_ok:false}]});assert.deepEqual(blocked.fired,[]);
  }
});

test('both vehicles and modes preserve independent module, own gun, crew and common repair gates', () => {
  for(const id of ['su_t10m',ID])for(const mode of ['historical','casual']) {
    assert.ok(data.vehicles[id]);const r=controls(id,mode);chooseControl(r, 'gun:1:0');
    r.damage(original.modules.find(m=>m.kind==='gun_breech').id);chooseControl(r, 'gun:0:0');assert.equal(r.live.fireGun(0,0),false);chooseControl(r, 'gun:1:0');assert.equal(r.live.fireGun(1,0),true,'healthy independent Oplot');
    const b=controls(id,mode);chooseControl(b, 'gun:1:0');b.damage('oplot_gun');assert.equal(b.live.fireGun(1,0),false);chooseControl(b, 'gun:0:0');assert.equal(b.live.fireGun(0,0),true,'main gun remains healthy');
    for(const restriction of ['crew','repair']) {
      const q=controls(id,mode);chooseControl(q, 'gun:1:0');
      if(restriction==='repair')q.G.cstate.repair_s=3;else q.G.bundle.crew.forEach((c,i)=>{if(c.role==='gunner')q.G.cstate.crew[i]=0;});
      q.G.caps=q.combat.advance(q.G.combatKey,q.G.cstate,0,1).caps;
      assert.equal(q.live.fireGun(1,0),false,restriction);const actor={};q.live.apsOf(actor,q.G.aps,q.G.loadout,q.G.T.map(t=>t.yaw),{pos:[0,0,0],heading:0},q.G.bundle,q.G.cstate,q.G.caps);assert.equal(actor.aps_gun_ok,false,restriction);
    }
  }
});

test('author tool is deterministic and touches only new files; all original packed assets stay unchanged', () => {
  assert.ok(data.vehicles[ID]);
  const paths=['vehicle','weapons','visual','armor','modules','crew','engine','model'].map(k=>`data/vehicles/${ID}/${k}.json`).concat(['data/projectiles/api_23_bza.json','data/projectiles/hei_23_ofz.json']);
  const before=paths.map(p=>sha(fs.readFileSync(new URL(p,root))));
  const beforeTimes=paths.map(p=>{const s=fs.statSync(new URL(p,root),{bigint:true});return [s.mtimeNs,s.ctimeNs];});
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'tankforge-oplot23-'));
  // Keep source reads real, and fail before any accidental write into this checkout.
  // This also makes the RED run safe when the tool does not yet honor --output-root.
  const guard=`import pathlib, runpy, sys\ntool=sys.argv[1]\nroot=pathlib.Path(tool).resolve().parent.parent\nwrite=pathlib.Path.write_text\ndef isolated_write(self,*args,**kwargs):\n    if self.resolve().is_relative_to(root): raise RuntimeError('author tool attempted to write canonical checkout')\n    return write(self,*args,**kwargs)\npathlib.Path.write_text=isolated_write\nsys.argv=[tool,*sys.argv[2:]]\nrunpy.run_path(tool,run_name='__main__')`;
  try {
    for(const pass of ['first','second']) {
      const output=path.join(temp,pass);
      const run=spawnSync('python',['-c',guard,fileURLToPath(new URL('tools/oplot23-variant.py',root)),'--output-root',output],{cwd:root,encoding:'utf8'});
      assert.equal(run.status,0,run.stderr);
      paths.forEach(p=>assert.deepEqual(fs.readFileSync(path.join(output,p)),fs.readFileSync(new URL(p,root)),`${pass} canonical bytes ${p}`));
    }
  } finally {
    assert.equal(path.dirname(temp),os.tmpdir());
    fs.rmSync(temp,{recursive:true,force:true});
  }
  assert.deepEqual(paths.map(p=>sha(fs.readFileSync(new URL(p,root)))),before);
  assert.deepEqual(paths.map(p=>{const s=fs.statSync(new URL(p,root),{bigint:true});return [s.mtimeNs,s.ctimeNs];}),beforeTimes,'canonical files were never rewritten');
  for(const[k,hash]of Object.entries(sourceHashes))assert.equal(sha(fs.readFileSync(new URL(`data/vehicles/su_t10m/${k}.json`,root))),hash,k);
  assert.deepEqual(data.vehicles.su_t10m.model,original.model,'source packed manifest remains exact');
});
