import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as replay from '../src/game/projectileReplay.js';
import {loadData} from '../tools/load-data.mjs';
import {loadCoreSync} from '../src/design/core.js';
import {Combat,bulletShell} from '../src/game/combat.js';
import {LocalReplayAdmission} from '../src/game/localReplayAdmission.js';
const receipt=JSON.parse(fs.readFileSync(new URL('../../../target/replay-network-r5-20261013.json',import.meta.url))),data=loadData();
const evidence=name=>receipt.phases.find(p=>p.name===name).recipients.find(q=>q.message.replay).message.replay;
test('actual native cannon receipt has no invented incoming chase or reflected flight',()=>{
  assert.equal(typeof replay.prepareReplayEvent,'function','runtime needs a recorded V3 adapter');
  const e=evidence('direct'),before=JSON.stringify(e),p=replay.prepareReplayEvent(e,data,[0,0,0]);
  assert.equal(p.flightTiming,'unknown');assert.equal(p.launch_s,p.contact_s);assert.equal(p.flight.length,0);
  const frame=replay.samplePreparedReplay(p,p.contact_s-.001);assert.equal(frame.projectile.timing,'unknown');assert.equal(frame.projectile.visible,false);
  assert.equal(JSON.stringify(e),before);assert.ok(p.traces.length>0,'real core timed traversal remains available');
});
test('actual native missile sampler uses retained timed sweeps and preserves omitted-prefix gaps',()=>{
  const e=evidence('missile'),p=replay.prepareReplayEvent(e,data,[0,0,0]);assert.equal(p.flightTiming,'recorded');
  const s=e.segments.at(-1),time=(s.start_time_s+s.end_time_s)/2,frame=replay.samplePreparedReplay(p,time);
  assert.equal(frame.projectile.timing,'recorded');assert.ok(frame.projectile.nose.every((v,i)=>Math.abs(v-(s.from[i]+s.to[i])/2)<1e-10));
  assert.equal(frame.projectile.visible,true);assert.ok(p.omittedFlight>0);
  const gap=(e.segments[0].end_time_s+e.segments[1].start_time_s)/2;assert.equal(replay.samplePreparedReplay(p,gap).projectile.visible,false,'removed sweeps are not reconstructed');
});
test('actual core fragment velocity supplies travel time and source tail/hold sampling',()=>{
  const e=evidence('direct'),p=replay.prepareReplayEvent(e,data,[5,0,0]),f=e.report.fragments.find(f=>f.physical?.velocity_m_s&&f.from&&f.to),tr=p.traces.find(t=>t.id===f.fragment_id);
  assert.ok(tr);const speed=Math.hypot(...Object.values(f.physical.velocity_m_s)),distance=Math.hypot(...['x','y','z'].map(k=>f.to[k]-f.from[k]));
  assert.ok(Math.abs(tr.end_s-tr.start_s-distance/speed)<1e-12);const out=replay.samplePreparedReplay(p,(tr.start_s+tr.end_s)/2);
  const sample=out.traces.find(t=>t.id===tr.id);assert.ok(sample);assert.deepEqual(sample.head,tr.from.map((v,i)=>(v+tr.to[i])/2));
  assert.ok(sample.alpha>0&&sample.width>0);assert.equal(replay.samplePreparedReplay(p,tr.end_s+4).traces.some(t=>t.id===tr.id),false);
});

test('chemical catalog families cannot reuse legacy kinetic body records as intact cabin flight',()=>{
  const direct=evidence('direct');
  for(const family of ['heat','hesh','he']){
    // HESH has a supported display envelope but no shipped round in this catalog yet.
    const shell=Object.values(data.projectiles).find(s=>s.kind===family)||{...Object.values(data.projectiles).find(s=>s.kind==='he'),id:'fixture_hesh',kind:'hesh'};
    const catalog={...data,projectiles:{...data.projectiles,[shell.id]:shell}};
    const raw=structuredClone(direct);raw.projectile_id=shell.id;raw.report.shell_kind=family;
    const prepared=replay.prepareReplayEvent(raw,catalog),timed=prepared.traces.find(t=>t.body);
    const time=timed?(timed.start_s+timed.end_s)/2:prepared.contact_s+.00001;
    assert.equal(replay.samplePreparedReplay(prepared,time).projectile.visible,false,`${family} cannot show an intact body after contact`);
    assert.ok(prepared.limitations.includes('chemical_body_continuation_unrecorded'));
  }
});

test('actual pending-P3 fuse receipt stays explicitly unknown without fabricated detonation stages',()=>{
  const prepared=replay.prepareReplayEvent(evidence('direct'),data);
  assert.ok(prepared.limitations.includes('fuze_pending_p3'));
  assert.equal(prepared.traces.some(t=>t.kind===4),false);
});

test('real WASM zero-duration stopped MG contact retains a stationary catalog body at its recorded point',()=>{
  const core=loadCoreSync(fs.readFileSync(process.env.TG_TEST_WASM||new URL('../../../target/tg_design_wasm-r4-20261012.wasm',import.meta.url)),{materials:data.materials,catalog:data.designCatalog,terrains:Object.values(data.terrains)}),combat=new Combat(core,data.machineGuns),admission=new LocalReplayAdmission();
  admission.begin([{entity:1,key:'stopped_tiger'},{entity:100,key:'shooter'}]);const {state}=combat.fresh('stopped_tiger',data.vehicles.de_tiger_e);admission.bindState('stopped_tiger',state);
  const pose={trust:'legacy_receipt_pose',hull_origin:[0,0,0],ex:[1,0,0],ey:[0,1,0],ez:[0,0,1],joints:[],running_gear:[],payload:[],variants:[]};combat.setReplayAdmission(admission,()=>pose,()=>1);
  const shell=bulletShell(data.machineGuns.mg34),origin=[0,1.55,5],dir=[0,0,-1],source=admission.acceptDischarge(100,{weapon_instance:'mg:0',projectile_id:shell.id,seed:123,time_s:0,origin,direction:dir});
  const report=combat.shoot('stopped_tiger',state,{shell,origin,dir,speed_ms:750,distance_m:0,seed:123,turret_yaw:0,replayDischarge:source}),stop=report.impact_events.find(i=>i.verdict==='stopped');
  assert.ok(stop);assert.equal(stop.entry.elapsed_s,stop.output.elapsed_s);assert.deepEqual(stop.output.velocity_m_s,{x:0,y:0,z:0});
  const p=replay.prepareReplayEvent(report.replay,data),at=replay.samplePreparedReplay(p,p.contact_s+.2).projectile;
  assert.equal(at.visible,true);assert.equal(at.holdingStopped,true);assert.equal(at.timing,'recorded');assert.deepEqual(at.nose,[stop.exit_position.x,stop.exit_position.y,stop.exit_position.z]);
  assert.deepEqual(replay.samplePreparedReplay(p,p.contact_s+.8).projectile.nose,at.nose);assert.equal(p.flight.length,0);assert.equal(replay.samplePreparedReplay(p,p.contact_s-.001).projectile.visible,false);assert.equal(replay.samplePreparedReplay(p,p.contact_s+3.4).projectile.visible,false,'display hold is bounded');
});
