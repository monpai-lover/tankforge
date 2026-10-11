import * as selection from '../src/game/weaponselection.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadData } from '../tools/load-data.mjs';
import * as loadout from '../src/game/loadout.js';
import * as loading from '../src/sim/loading.js';
import * as gunnery from '../src/sim/gunnery.js';
import * as ballistics from '../src/sim/ballistics.js';
import * as mgSim from '../src/sim/mg.js';
import { hullTilt } from '../src/sim/tank/tank.js';
import { applyAmmo } from '../src/game/deploy.js';
import { Conquest, captureMessage } from '../src/game/conquest.js';
import * as damage from '../src/game/weaponDamage.js';
import { buildTank } from '../src/gfx/tankmodel.js';
import { decodeImported } from '../src/gfx/imported.js';
import { Combat, emptyRacks, launcherCanFire } from '../src/game/combat.js';
import { loadCoreSync } from '../src/design/core.js';
import * as inventory from '../src/game/ammoInventory.js';
import * as policy from '../src/game/ammoResupply.js';
const source=fs.readFileSync(new URL('../src/main.js',import.meta.url),'utf8').replaceAll('\r\n','\n'),data=loadData();
for(const id of ['su_bmpt34','us_m901_itv'])if(data.vehicles[id].model)data.vehicles[id].imported=await decodeImported(data.vehicles[id].model);
function body(name,optional=false){const start=source.indexOf(`  function ${name}(`);if(optional&&start<0)return '';assert.ok(start>=0,`actual ${name}`);return source.slice(start,source.indexOf('\n  }',start)+4);}
const loadingFrame=source.slice(source.indexOf('      G.loadout.turrets.forEach((t, ti) => {',source.indexOf('      stepMachineGuns(SIM_DT);')),source.indexOf('      G.acc -= SIM_DT;',source.indexOf('      stepMachineGuns(SIM_DT);')));
function runtime(id='su_bmpt34',cfg={}){
  const lo=loadout.makeLoadout(id,data.vehicles[id],data.projectiles,data.machineGuns);applyAmmo(lo,cfg);
  const G={weaponControl:{kind:'all'},id,mode:'battle',mapId:'battlefield',loadout:lo,bundle:data.vehicles[id],s:{x:0,z:0,heading:0},ss:{pitch:0,roll:0},online:null,
    sightT:0,sightG:0,sightM:-1,cam:{shake:0},camPos:[0,3,0],shots:[],bullets:[],guided:[],enemies:[],aps:lo.weapons.aps,apsOn:true,
    MG:lo.machineGuns.map(m=>({m,st:mgSim.newMg(m.def)})),
    T:lo.turrets.map(t=>({yaw:0,guns:t.guns.map(()=>({pitch:0,smoke:0})),loading:loading.newLoading(t.guns.length,t.loaders.length,t.guns.map(g=>!g.rack))})),
    veh:{impulse(){},worldPoint:p=>p,body:{worldDir:p=>p}},ammoPlan:inventory.captureAmmoPlan(lo),resupply:policy.newResupplyState(),
    conquest:new Conquest([{id:'A',x:0,z:0,r:45}])};
  G.conquest.local=true;Object.assign(G.conquest.points[0],{owner:'blue',progress:1});
  const toasts=[],payloads=[],racks=[],apsCalls=[];
  const renderer={mesh:vertices=>({vertices}),instancedMesh:vertices=>({vertices}),setInstances(){},freeMesh(){}};
  G.model=buildTank(renderer,lo,loadout.generatedTurretParts);const payload=G.model.payload.bind(G.model);
  G.model.payload=(...args)=>{payloads.push(args);payload(...args);};
  let launchId=0;
  G.missiles={ready:true,reset(){},launch:()=>++launchId,addAps:(...args)=>apsCalls.push(args),setAps:(...args)=>apsCalls.push(args)};
  const sync=new Function('G','roundsLeft','emptyRacks','applyXray',`${body('carriedRounds')}\n${body('syncRacks')}\nreturn syncRacks;`)(G,loadout.roundsLeft,emptyRacks,()=>{});
  const cqBar={hidden:true,innerHTML:''},cqMsg={textContent:''};
  const deps={G,data,ME:1,DEG:Math.PI/180,RECOIL_ROCK:1,...selection,...loadout,...inventory,...policy,...damage,loading,gunnery,ballistics,hullTilt,captureMessage,
    sightGun:()=>G.loadout.turrets[G.sightT].guns[G.sightG],pose:()=>({pos:[0,0,0],heading:0}),
    mountOf:(t,g)=>({pivot:t.pivot,trunnion:g.trunnion,muzzleOffset:g.muzzleOffset}),
    hud:{toast:(...a)=>toasts.push(a),aps(){}},sound:{shot(){},mg(){},click(){},tone(){},apsGun(){}},fx:{muzzleBlast(){},autocannonBlast(){},mgFlash(){}},
    moduleOk:()=>true,rng:{nextF32:()=>.5},surfaceAt:()=>0,impactColor:()=>[0,0,0],
    net:{open:true,send(){}},onlineFires:{begin(){}},launcherCanFire,
    cqBar,cqMsg,announcePoint(){},toGarage(){G.mode='garage';},syncRacks(){racks.push(loadout.roundsLeft(G.loadout.turrets[0].guns[0]));sync();},enemyOwner:i=>100+i,
    missileTerrain:()=>null,onlineLaunches:{clear(){}},missileVehicle(){},
    clamp:(n,a,b)=>Math.max(a,Math.min(b,n))};
  const names=['selectAmmo','fireGun','launchFromGun','conquestStep','apsAutomatic','syncApsControl','carriedRounds','missileBattleStart','applyAps','resupplyStep'];
  const enemyYaws=source.match(/  const enemyYaws = .*;/)[0];
  const live=new Function(...Object.keys(deps),`${enemyYaws}\n${names.map(n=>body(n)).join('\n')}\nreturn {${names.join(',')}};`)(...Object.values(deps));
  const finish=seconds=>new Function(...Object.keys(deps),'SIM_DT',loadingFrame)(...Object.values(deps),seconds);
  return {G,live,finish,toasts,payloads,racks,apsCalls,cqMsg,syncRacks:sync};
}
test('actual quick unload and real fire conserve aboard rounds',()=>{
  const r=runtime('de_tiger_e'),g=r.G.loadout.turrets[0].guns[0],before=g.ammo.map(a=>a.count);
  r.live.selectAmmo(1);r.live.selectAmmo(1);assert.deepEqual(g.ammo.map(a=>a.count),before,'breech is already counted before unloading');
  assert.equal(g.loaded,-1);assert.equal(r.G.T[0].loading.state[0],'waiting');r.finish(100);assert.deepEqual(g.ammo.map(a=>a.count),before);
  assert.equal(r.live.fireGun(0,0),true);assert.equal(loadout.roundsLeft(g),before.reduce((s,n)=>s+n,0)-1);r.finish(100);
  for(let i=0;i<4;i++){r.live.selectAmmo(i%2);r.live.selectAmmo(i%2);r.finish(100);assert.equal(loadout.roundsLeft(g),before.reduce((s,n)=>s+n,0)-1);}
});

test('actual enemy lifecycle captures independent plans and actual automatic depletion requires its ordinary belt cycle',()=>{
  const r=runtime('su_t34_85'),enemy=runtime('su_t10m_oplot23');r.G.s.x=100;
  const e={loadout:enemy.G.loadout,model:enemy.G.model,x:0,z:0,alive:true,heading:0,turretYaw:.4,gunPitch:[],pose(){}};
  r.G.enemies=[e,{...e,remote:true},{...e,rangeTarget:true}];r.live.missileBattleStart();
  assert.ok(Object.isFrozen(e.ammoPlan));assert.equal(e.ammoLoading[1].state[0],'ready');assert.equal(r.G.enemies[1].ammoPlan,undefined);assert.equal(r.G.enemies[2].ammoPlan,undefined);
  const ti=e.loadout.weapons.aps.turret??1,g=e.loadout.turrets[ti].guns[0];
  r.live.applyAps({aps:[{owner:100,rounds:0,yaw:.8,pitch:.2,spin:0,rate_rpm:8000}],events:[]},{});
  assert.equal(loadout.roundsLeft(g),0);assert.equal(e.ammoLoading[ti].state[0],'empty');assert.equal(e.gunPitch[ti],.2);assert.ok(Math.abs(e.turretYaws[ti]-.8)<1e-9);
  const core=loadCoreSync(fs.readFileSync(new URL('../assets/tg_design.wasm',import.meta.url)),{materials:data.materials,catalog:data.designCatalog,terrains:Object.values(data.terrains)});
  core.call({op:'mw_reset',defs:Object.values(data.missiles)});core.call({op:'mw_aps',owner:100,team:1,def:e.loadout.weapons.aps,seed:11});
  r.G.missiles.setAps=(owner,enabled,rate_rpm=null,rounds=null)=>core.call({op:'mw_aps',owner,enabled,rate_rpm,rounds});
  Object.assign(r.G.conquest.points[0],{owner:'red',progress:-1});r.live.conquestStep(5);assert.equal(loadout.roundsLeft(g),500);assert.equal(e.ammoLoading[ti].state[0],'waiting');assert.equal(e.apsDesired,true);
  const missileBody=body('missileStep'),prefix=missileBody.slice(missileBody.indexOf('    syncApsControl();'),missileBody.indexOf('    const actors = []'));
  const gate=new Function('G','dt','loading','reloadTime','weaponReloadRate','refillBelt','nextAmmo','syncGunShell','roundsLeft','enemyOwner','syncApsControl',prefix);
  const update=dt=>gate(r.G,dt,loading,loadout.reloadTime,damage.weaponReloadRate,loadout.refillBelt,loadout.nextAmmo,loadout.syncGunShell,loadout.roundsLeft,i=>100+i,r.live.syncApsControl);
  const actor={id:100,team:1,alive:true,center:[0,1.3,0],aps_pivot:[.502,2.715,.557],aps_base_yaw:0,aps_gun_ok:true,aps_radar_ok:true};
  const threat=seed=>core.call({op:'mw_launch',def:'bgm71a_tow',owner:1,team:0,pos:[0,2,600],dir:[0,0,-1],seed});
  for(let i=0;i<3599;i++){if(i%120===0)threat(i+1);update(1/120);assert.deepEqual(core.call({op:'mw_step',dt:1/120,actors:[actor]}).fired,[]);}
  update(1/120);assert.equal(e.ammoLoading[ti].state[0],'ready');assert.equal(g.belt,500);threat(8000);
  let fired=[];for(let i=0;i<1200&&!fired.length;i++)fired=core.call({op:'mw_step',dt:1/120,actors:[actor]}).fired;
  assert.ok(fired.length,'actual enemy world intercepts after original belt load');
});
test('actual conquest 4.75 plus .25 refills BMPT payload with ordinary empty rail loading',()=>{
  const r=runtime(),gs=r.G.loadout.turrets[0].guns;for(const gi of [2,3])assert.equal(r.live.fireGun(0,gi),true);
  const nodes=[2,3].map(gi=>r.G.model.turrets[0].guns[gi].rounds[0]);assert.ok(nodes.every(Boolean),'actual decoded rocket payload nodes');assert.deepEqual(nodes.map(n=>n.visible),[false,false]);
  const mgBefore=structuredClone(r.G.MG);r.live.conquestStep(4.75);assert.match(r.cqMsg.textContent,/彈藥補給 95%/);assert.deepEqual(gs.slice(2).map(loadout.roundsLeft),[0,0]);
  r.live.conquestStep(.25);assert.deepEqual(gs.slice(2).map(loadout.roundsLeft),[1,1]);assert.deepEqual(gs.slice(2).map(g=>g.launcher.ready),[0,0]);
  assert.deepEqual(nodes.map(n=>n.visible),[false,false],'grant cannot visually preload empty rails');
  assert.equal(r.live.fireGun(0,2),false);assert.equal(r.toasts.filter(a=>a[0]==='彈藥已補滿').length,1);assert.ok(r.payloads.length>=2);assert.ok(r.racks.length);assert.deepEqual(r.G.MG,mgBefore);
  r.live.conquestStep(10);assert.equal(r.toasts.filter(a=>a[0]==='彈藥已補滿').length,1);assert.doesNotMatch(r.cqMsg.textContent,/彈藥補給/);
  r.finish(100);
  assert.deepEqual(nodes.map(n=>n.visible),[true,true],'ordinary completion exposes the loaded real rocket nodes');assert.equal(r.live.fireGun(0,2),true);
});
test('actual partial TOW refill preserves ready tube and spacing',()=>{
  const r=runtime('us_m901_itv'),g=r.G.loadout.turrets[0].guns[0],stock=loadout.roundsLeft(g);assert.equal(r.live.fireGun(0,0),true);const before=structuredClone(g.launcher);
  r.live.conquestStep(5);assert.equal(loadout.roundsLeft(g),stock);assert.deepEqual(g.launcher,before);loadout.tickLauncher(g,.25);assert.equal(r.live.fireGun(0,0),true);
});
test('actual dwell resets outside, dead, finished, full and online and cannot repair damage',()=>{
  for(const kind of ['exit','dead','winner','online','full']){const r=runtime();r.live.fireGun(0,2);r.live.conquestStep(4);
    if(kind==='exit')r.G.s.x=46;if(kind==='dead')r.G.caps={destroyed:true};if(kind==='winner')r.G.conquest.winner='blue';if(kind==='online')r.G.online={team:'blue'};
    if(kind==='full'){const g=r.G.loadout.turrets[0].guns[2];g.ammo[0].count=1;}
    r.live.conquestStep(.1);assert.equal(r.G.resupply?.elapsed,0,kind);assert.doesNotMatch(r.cqMsg.textContent,/彈藥補給/,kind);
  }
  const r=runtime();r.live.fireGun(0,2);r.G.caps={destroyed:false,weapons:{'gun:0:2':{can_fire:false,reload_mult:1}}};const before=structuredClone(r.G.caps);r.live.conquestStep(5);
  assert.equal(loadout.roundsLeft(r.G.loadout.turrets[0].guns[2]),1);assert.deepEqual(r.G.caps,before);r.finish(100);assert.equal(r.live.fireGun(0,2),false);
});
test('actual red local actor refills its own pools while remote and range actors are excluded',()=>{
  const r=runtime();r.G.s.x=100;const p=r.G.conquest.points[0];Object.assign(p,{owner:'red',progress:-1});
  for(const kind of ['local','remote','range']){const q=runtime();const e={loadout:q.G.loadout,x:0,z:0,alive:true,remote:kind==='remote',rangeTarget:kind==='range',model:q.G.model,
      ammoPlan:q.G.ammoPlan,resupply:q.G.resupply,ammoLoading:q.G.T.map(t=>t.loading),caps:{destroyed:false},combatKey:kind,cstate:{modules:[7],crew:[80]},combat:null};
    loadout.fireLauncherRound(e.loadout.turrets[0].guns[2],e.ammoLoading[0],2);r.G.enemies.push(e);}
  r.live.conquestStep(5);assert.deepEqual(r.G.enemies.map(e=>loadout.roundsLeft(e.loadout.turrets[0].guns[2])),[1,0,0]);
});

test('actual grant preserves a real secondary MG belt, heat, cooldown and active replacement cycle',()=>{
  const r=runtime('su_t34_85');assert.ok(r.G.MG.length>0);
  for(const m of r.G.MG){m.st.belt=0;m.st.heat=.72;m.st.reload=4;m.st.cooldown=.18;}
  const before=structuredClone(r.G.MG);assert.equal(r.live.fireGun(0,0),true);
  r.live.conquestStep(5);assert.deepEqual(r.G.MG,before);
});

test('actual capture winner reached during the step suppresses the pending grant',()=>{
  const r=runtime();r.live.fireGun(0,2);r.live.conquestStep(4.75);r.G.conquest.tickets[1]=.1;
  r.live.conquestStep(.25);assert.equal(r.G.conquest.winner,'blue');assert.equal(loadout.roundsLeft(r.G.loadout.turrets[0].guns[2]),0);assert.equal(r.G.resupply.elapsed,0);
});

test('actual player and red grant synchronize real combat racks without repairing modules or crew',()=>{
  const r=runtime();r.live.fireGun(0,2);
  const core=loadCoreSync(fs.readFileSync(new URL('../assets/tg_design.wasm',import.meta.url)),{materials:data.materials,catalog:data.designCatalog,terrains:Object.values(data.terrains)});
  const combat=new Combat(core,data.machineGuns),fresh=combat.fresh('player',data.vehicles.su_bmpt34);
  Object.assign(r.G,{combat,combatKey:'player',cstate:fresh.state,caps:fresh.caps,carried:-1});
  r.G.cstate.modules[0]=10;r.G.cstate.crew[0]=35;
  const saved=structuredClone({modules:r.G.cstate.modules,crew:r.G.cstate.crew});
  r.syncRacks();const depleted=structuredClone(r.G.cstate);r.live.conquestStep(5);
  assert.deepEqual({modules:r.G.cstate.modules,crew:r.G.cstate.crew},saved);assert.notDeepEqual(r.G.cstate.rack_fill,depleted.rack_fill,'real rack occupancy tracks increased rounds');
  const enemy=runtime(),e={loadout:enemy.G.loadout,model:enemy.G.model,x:0,z:0,alive:true,remote:false,rangeTarget:false,
    ammoPlan:enemy.G.ammoPlan,resupply:enemy.G.resupply,ammoLoading:enemy.G.T.map(t=>t.loading),combat,combatKey:'enemy'};
  const state=combat.fresh('enemy',data.vehicles.su_bmpt34);e.cstate=state.state;e.caps=state.caps;e.cstate.modules[0]=8;e.cstate.crew[0]=40;
  loadout.fireLauncherRound(e.loadout.turrets[0].guns[2],e.ammoLoading[0],2);
  e.cstate=combat.ammo('enemy',e.cstate,r.live.carriedRounds(e.loadout)).state;
  const previous=structuredClone(e.cstate);r.G.enemies=[e];r.G.s.x=100;Object.assign(r.G.conquest.points[0],{owner:'red',progress:-1});
  r.live.conquestStep(5);assert.deepEqual(e.cstate.modules,previous.modules);assert.deepEqual(e.cstate.crew,previous.crew);assert.notDeepEqual(e.cstate.rack_fill,previous.rack_fill);
});
