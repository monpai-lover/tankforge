import test from 'node:test';
import assert from 'node:assert/strict';
import {runtime} from './live-network-rig.mjs';
import fs from 'node:fs';
import {loadCoreSync} from '../src/design/core.js';
import {loadData} from '../tools/load-data.mjs';
import {Missiles} from '../src/game/missiles.js';
import {LocalReplayAdmission} from '../src/game/localReplayAdmission.js';
import {Combat} from '../src/game/combat.js';
import {Enemy,useCombat} from '../src/game/enemies.js';
import {captureRangeTargetRestPose} from '../src/game/rangeTargetRevival.js';
import {buildTank} from '../src/gfx/tankmodel.js';
import {makeLoadout,generatedTurretParts} from '../src/game/loadout.js';
const data=loadData();
const core=loadCoreSync(fs.readFileSync(process.env.TG_TEST_WASM||new URL('../assets/tg_design.wasm',import.meta.url)),{materials:data.materials,catalog:data.designCatalog,terrains:Object.values(data.terrains)});
const replayCapable=core.combatReplayRevision===1;
function sortie(ready=true){
  const combat=ready?new Combat(core,Object.values(data.machineGuns)):null;
  const r=runtime('casual',{combat,spawnEnemies(G,renderer,terrain,scene){const id='us_m4a3_75w',bundle=data.vehicles[id],loadout=makeLoadout(id,bundle,data.projectiles,data.machineGuns),model=buildTank(renderer,loadout,generatedTurretParts);scene.add(model.root);const e=new Enemy(id,bundle,model,terrain,{x:20,z:0,heading:0},null,'casual');e.combatKey='offline_target';e.loadout=loadout;e.replayEntity=100;e.rangeTarget=true;e.sourceBundle=bundle;e.rangeRestPose=captureRangeTargetRestPose(e);G.enemies=[e];if(combat)useCombat(e,combat,e.combatKey);}});
  r.live.select('us_m4a3_75w');r.live.startBattle();r.G.time=0;return r;
}

test('successful offline startup admits self independently of combat readiness and Tab retires it',()=>{
  const r=runtime('casual',{combat:null});r.live.startBattle();
  const actor=r.localReplay?.actor(1);
  assert.ok(actor,'offline gameplay needs its first and sole admitted battle/life owner');
  assert.equal(actor.entity,1);assert.ok(actor.battle>0&&actor.life>0);
  r.live.toGarage();assert.equal(r.localReplay.actor(1),null);
  r.live.startBattle();assert.notDeepEqual(r.localReplay.actor(1),actor);
});

test('actual offline missile launch retains source before its actual world ending',()=>{
  const admission=new LocalReplayAdmission();admission.begin([{entity:1,key:'self'},{entity:100,key:'enemy'}]);
  const missiles=new Missiles({core,defs:data.missiles,projectiles:data.projectiles});missiles._launchLook=()=>{};
  missiles.present=()=>{};missiles.reset();missiles.replayAdmission=admission;missiles.replayTime=()=>0;
  const id=missiles.launch('tt250_rocket',100,1,[12,1.5,0],[-1,0,0],123,null,{weapon_instance:'gun:0:0',projectile_id:'he_420_tt250'});
  assert.ok(id!==null,'actual WASM accepted a missile');
  const accepted=missiles.acceptedLaunches?.get(id);
  assert.ok(accepted,'accepted missile source must be retained before end()');
  assert.equal(accepted.source.shooter.entity,100);
});

test('actual offline main missile contact produces a genuine fatal, retains launch source and rejects duplicate/stale mutation',()=>{
  const r=sortie(),o=r.G.veh.body.origin(),center=[o[0],o[1]+1.2,o[2]];
  const id=r.G.missiles.launch('tt250_rocket',100,1,[center[0]+12,center[1],center[2]],[-1,0,0],123,null,{weapon_instance:'gun:0:0',projectile_id:'he_420_tt250'});
  assert.ok(id!==null);const source=r.G.missiles.acceptedLaunches.get(id).source;let contact=false;
  for(let i=0;i<600;i++){r.G.time+=1/120;const res=r.G.missiles.step(1/120,[{id:1,team:0,alive:true,center,vel:[0,0,0]}]);r.live.missileImpacts(res);if(r.G.cstate.destroyed){contact=true;break;}}
  assert.ok(contact,'actual WASM flight and main hull contact required');assert.equal(r.G.cstate.destroyed,true,'real HE missile report must be fatal');
  const fatal=r.G.replayEvidence;
  if(replayCapable){assert.equal(fatal.authority,'offline');assert.equal(fatal.shooter.entity,100);assert.equal(fatal.shot_id,source.shot_id);assert.equal(fatal.seed,'123');assert.equal(fatal.deaths.length,1);assert.ok(fatal.segments.length>0);assert.ok(fatal.travelled_distance_m>0);}
  else assert.equal(fatal,null,'legacy core gameplay cannot certify contextual replay');
  const before=r.G.cstate;r.live.selfMissileHit(center,[-1,0,0],data.projectiles.he_420_tt250,100,data.missiles.tt250_rocket,source,source.travelled_distance_m,r.G.time);assert.equal(r.G.cstate,before);assert.equal(r.G.replayEvidence,fatal);
  const old=r.localReplay.actor(1),target=r.localReplay.actor(100);r.live.resetVehicle();assert.equal(r.localReplay.actor(1).life,old.life+1);assert.deepEqual(r.localReplay.actor(100),target);assert.equal(r.G.replayEvidence,null);
  const fresh=r.G.cstate;r.live.selfMissileHit(center,[-1,0,0],data.projectiles.he_420_tt250,100,data.missiles.tt250_rocket,source,source.travelled_distance_m,r.G.time);assert.equal(r.G.cstate,fresh,'old target-life source must not mutate a revived self');
});

test('actual target revival changes only target life after success; failure and core readiness keep admission',()=>{
  const r=sortie(),e=r.G.enemies[0],self=r.localReplay.actor(1),old=r.localReplay.actor(100);
  e.alive=false;const real=r.G.combat.fresh;r.G.combat.fresh=()=>null;assert.equal(r.live.reviveRangeEnemy(e),false);assert.deepEqual(r.localReplay.actor(100),old);
  r.G.combat.fresh=()=>{throw Error('fresh failed');};assert.throws(()=>r.live.reviveRangeEnemy(e),/fresh failed/);assert.deepEqual(r.localReplay.actor(100),old);
  r.G.combat.fresh=real.bind(r.G.combat);assert.equal(r.live.reviveRangeEnemy(e),true);assert.equal(r.localReplay.actor(100).life,old.life+1);assert.deepEqual(r.localReplay.actor(1),self);
  const late=sortie(false),admitted=late.localReplay.actor(1);late.G.combat=new Combat(core,Object.values(data.machineGuns));late.live.bindCombatReady();assert.deepEqual(late.localReplay.actor(1),admitted);assert.ok(late.G.cstate);assert.ok(late.localReplay.ownsState(late.G.combatKey,late.G.cstate));
});

test('preview state under admitted cache key cannot obtain context; failed startup does not mint a life',()=>{
  const r=sortie(),source=r.localReplay.acceptDischarge(100,{weapon_instance:'gun:0:0',projectile_id:'apcbc_88_l56',seed:1,time_s:0,origin:[3,1,0],direction:[-1,0,0]});
  const preview=r.G.combat.fresh(r.G.combatKey,r.G.sourceBundle),before=JSON.stringify(preview.state);
  assert.equal(r.G.combat.shoot(r.G.combatKey,preview.state,{shell:data.projectiles.apcbc_88_l56,origin:[3,1,0],dir:[-1,0,0],speed_ms:700,distance_m:0,seed:1,turret_yaw:0,replayDischarge:source}),null);assert.equal(JSON.stringify(preview.state),before);
  const broken=runtime('casual',{combat:null,spawnEnemies(){throw Error('startup failed');}});assert.throws(()=>broken.live.startBattle(),/startup failed/);assert.equal(broken.localReplay.actor(1),null);
});

test('consumed source cannot mutate the same living target twice; genuine timed fire death retains original source',()=>{
  const r=sortie(),combat=r.G.combat,key=r.G.combatKey;
  const ordinary=r.localReplay.acceptDischarge(100,{weapon_instance:'gun:0:0',projectile_id:'apcbc_88_l56',seed:1,time_s:0,origin:[3,.1,0],direction:[-1,0,0]});
  const shot={shell:data.projectiles.apcbc_88_l56,origin:[3,.1,0],dir:[-1,0,0],speed_ms:700,distance_m:0,seed:1,turret_yaw:0,replayDischarge:ordinary};
  const first=combat.shoot(key,r.G.cstate,shot);assert.ok(first);assert.equal(first.state.destroyed,false);r.G.cstate=first.state;r.G.caps=first.caps;
  const raw=core.combatShoot.bind(core);let calls=0;core.combatShoot=(...args)=>{calls++;return raw(...args);};assert.equal(combat.shoot(key,r.G.cstate,shot),null);assert.equal(calls,0);core.combatShoot=raw;
  r.live.resetVehicle();const source=r.localReplay.acceptDischarge(100,{weapon_instance:'gun:0:0',projectile_id:'apcbc_88_l56',seed:1023760,time_s:0,origin:[3,1,.8],direction:[-1,0,0]});
  const rep=combat.shoot(key,r.G.cstate,{...shot,origin:[3,1,.8],seed:source.seed,replayDischarge:source});assert.ok(rep);assert.equal(rep.state.destroyed,false);assert.ok(rep.state.fire_s>0);r.G.cstate=rep.state;r.G.caps=rep.caps;r.G.time=35;r.G.combatAcc=0;
  r.live.advanceCombat(35);assert.equal(r.G.cstate.destroyed,true);
  const retained=r.localReplay.histories.get(`${source.shooter.battle}:1:${r.localReplay.actor(1).life}`).fatal;
  if(replayCapable){assert.equal(r.G.replayEvidence.event_id,rep.replay.event_id);assert.deepEqual(r.G.replayEvidence.report,rep.replay.report);assert.equal(r.G.replayEvidence.deaths.length,1);assert.equal(retained.deaths.length,1);}
  else {assert.equal(rep.replay,undefined);assert.equal(rep.replay_unavailable,'unsupported_core_causal_replay');assert.equal(r.G.replayEvidence,null);assert.equal(retained,null);}
});
