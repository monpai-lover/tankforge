import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {runtime} from './live-network-rig.mjs';
import {loadCoreSync} from '../src/design/core.js';
import {loadData} from '../tools/load-data.mjs';
import {Combat} from '../src/game/combat.js';
import {Enemy,useCombat} from '../src/game/enemies.js';
import {captureRangeTargetRestPose} from '../src/game/rangeTargetRevival.js';
import {buildTank} from '../src/gfx/tankmodel.js';
import {makeLoadout,generatedTurretParts} from '../src/game/loadout.js';
const data=loadData();
const fields={weapon_instance:'gun:0:0',projectile_id:'heat_152_tow',seed:123,time_s:0,origin:[12,1.2,0],direction:[-1,0,0]};
function pressure(r){for(let i=0;i<422;i++)r.localReplay.acceptDischarge(1,{...fields,weapon_instance:'mg:0:0',projectile_id:'m1919a4',seed:i});assert.equal(r.localReplay.discharges.size,256);}
function launch(r){return r.G.missiles.launch('bgm71a_tow',100,1,fields.origin,fields.direction,123,null,fields);}
function prepared(r,source,state=r.G.cstate){return r.localReplay.prepare(r.G.combatKey,source,{},r.G.time,state);}
function sortie(){
  const core=loadCoreSync(fs.readFileSync(process.env.TG_TEST_WASM||new URL('../assets/tg_design.wasm',import.meta.url)),{materials:data.materials,catalog:data.designCatalog,terrains:Object.values(data.terrains)}),combat=new Combat(core,Object.values(data.machineGuns));
  const r=runtime('casual',{combat,spawnEnemies(G,renderer,terrain,scene){
    const id='us_m4a3_75w',bundle=data.vehicles[id],loadout=makeLoadout(id,bundle,data.projectiles,data.machineGuns),model=buildTank(renderer,loadout,generatedTurretParts);scene.add(model.root);
    const e=new Enemy(id,bundle,model,terrain,{x:20,z:0,heading:0},null,'casual');e.combatKey='offline_target';e.loadout=loadout;e.replayEntity=100;e.rangeTarget=true;e.sourceBundle=bundle;e.rangeRestPose=captureRangeTargetRestPose(e);G.enemies=[e];useCombat(e,combat,e.combatKey);
  }});
  r.live.select('us_m4a3_75w');r.live.startBattle();r.G.time=0;
  return {r,core};
}

for(const fire of [false,true])test(fire?'actual MG source pressure preserves a valid in-flight TOW damage transaction':'actual 3500m TOW control applies genuine penetration damage',()=>{
  const {r,core}=sortie(),o=r.G.veh.body.origin(),center=[o[0],o[1]+1.2,o[2]],launch=[center[0]+3500,center[1],center[2]];
  const id=r.G.missiles.launch('bgm71a_tow',100,1,launch,[-1,0,0],123,null,{weapon_instance:'gun:0:0',projectile_id:'heat_152_tow'});
  const source=r.G.missiles.acceptedLaunches.get(id).source;
  r.G.bulletShells=new Map();const initial=JSON.stringify(r.G.cstate);r.G.mgHeld=fire;r.G.aimPoint=[o[0],o[1]+1.2,o[2]+1000];
  const original=core.combatShoot.bind(core);let calls=0;core.combatShoot=(...args)=>{calls++;return original(...args);};let mainContact=false,hitTime=null;
  for(let i=0;i<4800;i++){
    r.G.time+=1/120;if(fire)r.live.stepMachineGuns(1/120);r.G.missiles.guide(id,100,launch,center);
    const result=r.G.missiles.step(1/120,[{id:1,team:0,alive:true,center,vel:[0,0,0]}]);const held=r.G.missiles.acceptedLaunches.has(id);
    r.live.missileImpacts(result);if(held&&!r.G.missiles.acceptedLaunches.has(id)){mainContact=true;hitTime=r.G.time;break;}
  }
  console.log(JSON.stringify({fire,cacheSize:r.localReplay.discharges.size,discharges:r.localReplay.dischargeSerial,sourceKnown:r.localReplay.discharges.get(source.shot_id)===source,mainContact,combatCalls:calls,hitTime,stateChanged:JSON.stringify(r.G.cstate)!==initial,trackHealth:r.G.replayEvidence?.report.modules[0]?.health,evidence:r.G.replayEvidence?.event_id??null}));
  assert.equal(mainContact,true);assert.equal(hitTime,16.04999999999973);
  assert.equal(r.localReplay.actor(100).life,source.shooter.life);assert.equal(r.localReplay.actor(1).life,1);
  if(fire){assert.equal(r.localReplay.discharges.size,256);assert.equal(r.localReplay.dischargeSerial,423);assert.equal(r.localReplay.discharges.has(source.shot_id),false,'bounded cache still evicts the oldest source');}
  assert.equal(calls,1,'same-life accepted missile contact must reach the combat core once after later MG pressure');
  assert.notEqual(JSON.stringify(r.G.cstate),initial,'genuine penetration damage must apply');
  if(core.combatReplayRevision===1){assert.equal(source.flight.length,256);assert.equal(source.segments.length,256);assert.ok(source.flight_compacted_count>0);assert.ok(source.segment_compacted_count>0);assert.equal(r.G.replayEvidence.report.modules[0].id,'track_l');assert.equal(r.G.replayEvidence.report.modules[0].health,17.234073638916016);}
  else {assert.equal(source.flight.length,0,'legacy core has no timed flight evidence');assert.equal(r.G.replayEvidence,null);}
  const damaged=r.G.cstate,evidence=r.G.replayEvidence;r.live.missileImpacts({events:[]});
  assert.equal(calls,1,'repeated last segment cannot damage twice');assert.equal(r.G.cstate,damaged);assert.equal(r.G.replayEvidence,evidence);
});

test('contact exception still retires active source ownership',()=>{
  const {r}=sortie(),o=r.G.veh.body.origin(),center=[o[0],o[1]+1.2,o[2]],start=[center[0]+12,center[1],center[2]];
  const id=r.G.missiles.launch('bgm71a_tow',100,1,start,[-1,0,0],123,null,fields),source=r.G.missiles.acceptedLaunches.get(id).source;
  r.G.combat.shoot=()=>{throw Error('contact failure');};let thrown=false;
  for(let i=0;i<600;i++){r.G.time+=1/120;const result=r.G.missiles.step(1/120,[{id:1,team:0,alive:true,center,vel:[0,0,0]}]);try{r.live.missileImpacts(result);}catch(e){assert.match(e.message,/contact failure/);thrown=true;break;}}
  assert.equal(thrown,true);assert.equal(r.G.missiles.acceptedLaunches.has(id),false);assert.equal(prepared(r,source),null);
});

test('existing missile-owner capacity stays bounded and releases its evicted source',()=>{
  const {r}=sortie(),first=launch(r),source=r.G.missiles.acceptedLaunches.get(first).source;
  for(let i=0;i<256;i++)launch(r);
  assert.equal(r.G.missiles.acceptedLaunches.size,256);assert.equal(r.localReplay.discharges.size,256);assert.equal(r.G.missiles.acceptedLaunches.has(first),false);assert.equal(prepared(r,source),null);
  assert.equal(r.localReplay.retainProjectile(source),null,'eviction cannot acquire a new lease');
  const newest=[...r.G.missiles.acceptedLaunches.values()].at(-1).source;assert.ok(prepared(r,newest));assert.equal(r.localReplay.retainProjectile(newest),null,'same source cannot mint another owner');
  r.G.missiles.reset();assert.equal(r.G.missiles.acceptedLaunches.size,0);assert.equal(r.G.missiles.terminalLaunches.size,0);assert.equal(r.localReplay.discharges.size,0);assert.equal(prepared(r,newest),null);
});

test('noncontact native ending releases source without a terminal lease',()=>{
  const {r}=sortie(),id=r.G.missiles.launch('tt250_rocket',100,1,[12,1.2,0],[-1,-1,0],123,null,{...fields,projectile_id:'he_420_tt250'}),source=r.G.missiles.acceptedLaunches.get(id).source;
  let result;
  for(let i=0;i<600;i++){r.G.time+=1/120;result=r.G.missiles.step(1/120,[]);if(result.events.some(e=>e.type==='missile_ground')||result.ended?.length)break;}
  assert.ok(result.events.some(e=>e.type==='missile_ground'));assert.equal(r.G.missiles.acceptedLaunches.has(id),false);assert.equal(r.G.missiles.terminalLaunches.size,0);assert.equal(prepared(r,source),null);
});

test('native ending cleanup survives a presentation exception',()=>{
  const {r}=sortie(),id=r.G.missiles.launch('tt250_rocket',100,1,[12,1.2,0],[-1,-1,0],123,null,{...fields,projectile_id:'he_420_tt250'}),source=r.G.missiles.acceptedLaunches.get(id).source;
  r.G.missiles.present=res=>{if(res.events.some(e=>e.type==='missile_ground'))throw Error('presentation failure');};let thrown=false;
  for(let i=0;i<600;i++){r.G.time+=1/120;try{r.G.missiles.step(1/120,[]);}catch(e){assert.match(e.message,/presentation failure/);thrown=true;break;}}
  assert.equal(thrown,true);assert.equal(r.G.missiles.acceptedLaunches.has(id),false);assert.equal(prepared(r,source),null);
});

test('only an actual active missile source survives ordinary replay-cache eviction',()=>{
  const {r}=sortie(),ordinary=r.localReplay.acceptDischarge(100,fields),id=launch(r),source=r.G.missiles.acceptedLaunches.get(id).source;
  pressure(r);assert.equal(r.localReplay.discharges.has(source.shot_id),false);
  assert.ok(prepared(r,source),'exact active source remains eligible');
  assert.equal(prepared(r,ordinary),null,'ordinary evicted source gains no active-projectile eligibility');
  assert.equal(prepared(r,structuredClone(source)),null,'copied source cannot forge projectile ownership');
  const preview=r.G.combat.fresh(r.G.combatKey,r.G.sourceBundle);assert.equal(prepared(r,source,preview.state),null,'unbound preview is rejected');
  r.localReplay.replace(1,r.G.combatKey);r.localReplay.bindState(r.G.combatKey,r.G.cstate);assert.equal(prepared(r,source),null,'old victim life remains rejected');
});

test('retired missile source cannot be reused while its ordinary cache entry is recent',()=>{
  for(const retire of ['end','reset']){
    const {r}=sortie(),id=launch(r),source=r.G.missiles.acceptedLaunches.get(id).source;assert.ok(prepared(r,source));
    r.G.missiles[retire](retire==='end'?id:undefined);assert.equal(prepared(r,source),null,`${retire} retires exact projectile eligibility`);
  }
});

test('active missile identity is immutable while genuine sweep evidence remains writable',()=>{
  const {r,core}=sortie(),id=launch(r),source=r.G.missiles.acceptedLaunches.get(id).source;
  for(const k of ['shot_id','weapon_instance','projectile_id','seed','launch_time_s'])assert.throws(()=>{source[k]='forged';},TypeError,k);
  assert.throws(()=>{source.shooter.life++;},TypeError);assert.throws(()=>{source.origin[0]++;},TypeError);assert.throws(()=>{source.direction[0]++;},TypeError);
  r.G.time=1/120;r.G.missiles.step(1/120,[]);if(core.combatReplayRevision===1){assert.ok(source.flight.length);assert.ok(source.segments.length);}assert.ok(source.travelled_distance_m>0);
});

test('old shooter life and retired battle invalidate an active evicted missile source',()=>{
  for(const retire of ['replace','retire']){
    const {r}=sortie(),id=launch(r),source=r.G.missiles.acceptedLaunches.get(id).source;pressure(r);
    if(retire==='replace')r.localReplay.replace(100,'offline_target');else r.localReplay.retire();
    assert.equal(prepared(r,source),null,retire);
  }
});

test('native struck source survives its bounded terminal delivery and expires on the next step',()=>{
  for(const deliver of [false,true]){
    const {r,core}=sortie(),o=r.G.veh.body.origin(),center=[o[0],o[1]+1.2,o[2]],start=[center[0]+12,center[1],center[2]];
    const id=r.G.missiles.launch('bgm71a_tow',100,1,start,[-1,0,0],123,null,fields),source=r.G.missiles.acceptedLaunches.get(id).source;pressure(r);
    let result;
    for(let i=0;i<600;i++){r.G.time+=1/120;result=r.G.missiles.step(1/120,[{id:1,team:0,alive:true,center,vel:[0,0,0],obb:{center,axes:[[1,0,0],[0,1,0],[0,0,1]],half:[6,3,4]}}]);if(result.events.some(e=>e.type==='missile_hit'))break;}
    assert.ok(result.events.some(e=>e.type==='missile_hit'));assert.equal(r.G.missiles.acceptedLaunches.has(id),false,'native ended launch moved out of active owner');
    if(!Array.isArray(result.ended)){assert.equal(prepared(r,source),null,'legacy ending has no terminal sweep to deliver');assert.equal(r.G.missiles.terminalLaunches.size,0);continue;}
    assert.ok(prepared(r,source),'native struck source remains eligible for this delivery frame');
    const raw=core.combatShoot.bind(core);let calls=0;core.combatShoot=(...args)=>{calls++;return raw(...args);};
    if(deliver){r.live.missileImpacts(result);assert.equal(calls,1);assert.equal(prepared(r,source),null,'delivered contact retires source');}
    else {r.G.missiles.step(0,[]);assert.equal(prepared(r,source),null,'unconsumed terminal delivery expires even on an invalid step');}
  }
});
