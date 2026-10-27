import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

// Exercise the shipped boundary owners, not a duplicate admission algorithm.
// The core is a spy: these tests establish state/admission continuity only.
const app=fs.readFileSync(process.env.TG_R8_APP||new URL('../bundle/app.js.html',import.meta.url),'utf8');
const section=(a,b)=>{const i=app.indexOf(a),j=app.indexOf(b,i+a.length);assert.ok(i>=0&&j>i,a);return app.slice(i,j);};
const shoot=section('    shoot(id2, state, shot) {','    splash(id2, state, at2, kg, yaw, seed2) {').replace(/^    shoot\(/,'function shoot(');
const runtime=new Function('TF_COMBAT_GEOMETRY_IMMUTABLE','shellDef','v3',
  section('  // client/web/src/game/replayEvidence.js','  // client/web/src/vendor/suppliedHitReplayV3.js')+
  section('  // client/web/src/game/localReplayAdmission.js','  // client/web/src/game/mods.js')+
  ';return {LocalReplayAdmission,shoot:'+shoot+'};')(
  {clone:structuredClone,capture:()=>[]},s=>s,p=>Array.isArray(p)?{x:p[0],y:p[1],z:p[2]}:p);

function fixture(surface) {
  const admission=new runtime.LocalReplayAdmission();
  admission.begin([{entity:1,key:'player'},{entity:2,key:'target'}]);
  const state={destroyed:false,crew:[100],modules:[]};
  admission.bindState('target',state);
  const calls=[];
  const resolve=(key,before,physical,end,context)=>{
    calls.push({key,before,physical,end,context});
    return {outcome:'penetrated',state:{...before,crew:[before.crew[0]-10]},caps:{destroyed:false},events:[],crew:[{index:0}],modules:[],layers:[],impact_events:[],fragments:[],bursts:[]};
  };
  const combat={_applyFold(){},surfaceOwner:surface?{pose:()=>({available:true,revision:1,geometryRevision:1}),evidence:()=>({})}:null,
    replayAdmission:admission,replayPose:()=>null,replayTime:()=>1,
    coreOf:()=>({combatReplayRevision:1,combatSurfaceShoot:resolve,combatShoot:(key,before,physical,context)=>resolve(key,before,physical,null,context)})};
  const shot={shell:{id:'fixture-shell'},origin:[0,0,0],dir:[0,0,1],speed_ms:10,distance_m:10,seed:7,finite_end:surface?[0,0,10]:null};
  const discharge=()=>{
    const source=admission.acceptDischarge(1,{weapon_instance:'gun:0:0',projectile_id:'fixture-shell',seed:8,time_s:0,origin:[0,0,0],direction:[0,0,1],velocity_m_s:[0,0,10],flight_trust:'local_ballistic_world_segments_legacy_contact'});
    admission.retainProjectile(source);
    admission.recordProjectileStep(source,{start_time_s:0,end_time_s:1,from:[0,0,0],to:[0,0,10],velocity_m_s:[0,0,10]});
    return source;
  };
  return {admission,state,calls,shot,discharge,shoot:(before,extra={})=>runtime.shoot.call(combat,'target',before,{...shot,...extra})};
}

for(const surface of [false,true])test(`${surface?'surface':'legacy'}: a non-admitted contact retains target state ownership for the next admitted shot`,()=>{
  const f=fixture(surface),first=f.shoot(f.state);
  assert.equal(first.state.crew[0],90,'first physical report applied');
  assert.equal(first.replay_unavailable,'non_authoritative_analysis');
  const source=f.discharge(),second=f.shoot(first.state,{replayDischarge:source,replay_time_s:1});
  assert.ok(second,'fresh valid discharge must not be dropped after replacing state');
  assert.equal(f.calls.length,2,'both live contacts reach the physical core');
  assert.equal(second.state.crew[0],80);
  assert.equal(f.admission.ownsState('target',second.state),true);
});

test('binding a non-admitted result does not admit a projectile against a replacement target life',()=>{
  const f=fixture(true),source=f.discharge(),first=f.shoot(f.state);
  f.admission.replace(2,'target');
  f.admission.bindState('target',first.state);
  assert.equal(f.shoot(first.state,{replayDischarge:source,replay_time_s:1}),null);
  assert.equal(f.calls.length,1,'projectile accepted for the retired life remains rejected');
});
