import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {loadCoreSync} from '../src/design/core.js';
import {loadData} from '../tools/load-data.mjs';
import {Combat} from '../src/game/combat.js';
import {LocalReplayAdmission} from '../src/game/localReplayAdmission.js';
const data=loadData(),init={materials:data.materials,catalog:data.designCatalog,terrains:Object.values(data.terrains)};
const defaultBytes=fs.readFileSync(new URL('../assets/tg_design.wasm',import.meta.url));
assert.equal(crypto.createHash('sha256').update(defaultBytes).digest('hex'),'18a27ae78002ac872fff88ca90992ce59afd778cd5837cf3a64c0b8bb79e6989');
const releaseBytes=fs.readFileSync(process.env.TG_TEST_WASM||new URL('../../../target/wasm32-unknown-unknown/release/tg_design_wasm.wasm',import.meta.url));
const pose={trust:'legacy_receipt_pose',hull_origin:[0,0,0],ex:[1,0,0],ey:[0,1,0],ez:[0,0,1],joints:[],running_gear:[],payload:[],variants:[]};
function target(bytes){const core=loadCoreSync(bytes,init),combat=new Combat(core,data.machineGuns),admission=new LocalReplayAdmission();admission.begin([{entity:1,key:'compat'},{entity:100,key:'enemy'}]);const {state}=combat.fresh('compat',data.vehicles.us_m4a3_75w);admission.bindState('compat',state);combat.setReplayAdmission(admission,()=>pose,()=>0);return{core,combat,admission,state};}
function shot(admission,seed){const source=admission.acceptDischarge(100,{weapon_instance:'gun:0:0',projectile_id:'apcbc_88_l56',seed,time_s:0,origin:[3,.1,0],direction:[-1,0,0]});return{shell:data.projectiles.apcbc_88_l56,origin:[3,.1,0],dir:[-1,0,0],speed_ms:700,distance_m:0,seed,turret_yaw:0,replayDischarge:source};}
test('preserved default core resolves admitted safe seeds without claiming causal capability',()=>{
  const {core,combat,admission,state}=target(defaultBytes);let report;
  assert.doesNotThrow(()=>{report=combat.shoot('compat',state,shot(admission,123));});
  assert.equal(core.combatReplayRevision,0);assert.equal(report.state.destroyed,false);assert.equal(report.replay,undefined);assert.equal(report.replay_unavailable,'unsupported_core_causal_replay');
});
test('preserved default core rejects an unrepresentable u64 before any combat call',()=>{
  const {core,combat,admission,state}=target(defaultBytes),request=shot(admission,'18446744073709551615'),calls=core.calls;
  assert.throws(()=>combat.shoot('compat',state,request),/legacy core cannot exactly represent combat seed/);assert.equal(core.calls,calls);assert.equal(admission.ownsState('compat',state),true);
});
test('current release declares contextual replay and resolves decimal max-u64 losslessly',()=>{
  const {core,combat,admission,state}=target(releaseBytes);assert.equal(core.combatReplayRevision,1);
  const report=combat.shoot('compat',state,shot(admission,'18446744073709551615'));assert.equal(report.replay.seed,'18446744073709551615');assert.equal(report.replay.authority,'offline');
  assert.throws(()=>core.combatShoot('compat',state,{...shot(admission,1),seed:'18446744073709551616'}),/invalid combat seed/);
});
