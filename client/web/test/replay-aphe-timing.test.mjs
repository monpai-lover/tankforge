import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareReplayEvent,samplePreparedReplay} from '../src/game/replayRecords.js';
import {ReplayDraw} from '../src/gfx/replayDraw.js';

const catalog={projectiles:{filled50:{id:'filled50',kind:'apcbc',caliber_mm:50,mass_kg:2.06,length_mm:185,explosive_mass_kg:.017}}};
function evidence(){return {authority:'local',event_id:'hit:1',shot_id:'shot:1',actor:{battle:1,entity:1,life:1},projectile_id:'filled50',launch_time_s:2,impact_time_s:3,accepted_pose:{hull_origin:[10,0,0],ex:[1,0,0],ey:[0,1,0],ez:[0,0,1]},segments:[],deaths:[],mechanism_records:[],report:{impact:[0,1,0],shell_kind:'apcbc',fragments:[],impact_events:[{event_id:'plate:1',entry:{body_id:'core',elapsed_s:0,velocity_m_s:[0,0,500]},output:{elapsed_s:.001,velocity_m_s:[0,0,0],remaining_pen_mm:0},entry_position:[0,1,0],exit_position:[0,1,.3],verdict:'deposited',budget:{input_j:100,core_out_j:0}}],bursts:[{pos:[0,1,.3],radius:1,inside:true,explosive_kg:.0289,time_s:.004,armed_at_s:0,delay_s:.004,detonation_id:'core/charge:0/detonation:0',mechanism:'delayed_aphe'}]}};}

test('recorded APHE burst waits for its actual deadline and uses the accepted target frame',()=>{
  const p=prepareReplayEvent(evidence(),catalog,[5,0,0],2);
  assert.equal(p.bursts?.length,1);
  assert.equal(p.bursts[0].time_s,1.004);
  assert.deepEqual(p.bursts[0].position,[5,1,.3]);
  assert.ok(!p.limitations.includes('burst_timing_unrecorded'));
  assert.deepEqual(samplePreparedReplay(p,1.003).bursts,[]);
  const flash=samplePreparedReplay(p,1.014).bursts[0];
  assert.equal(flash.eventId,'hit:1');assert.ok(flash.alpha>0&&flash.radius>0);
  assert.deepEqual(samplePreparedReplay(p,2).bursts,[],'Visual flash has a bounded lifetime');
});

test('an armed deposited core holds at its stop then disappears at detonation',()=>{
  const p=prepareReplayEvent(evidence(),catalog,undefined,2);
  const before=samplePreparedReplay(p,1.002).projectile;
  assert.equal(before.visible,true);assert.equal(before.holdingStopped,true);
  assert.deepEqual(before.nose,[10,1,.3]);
  assert.equal(samplePreparedReplay(p,1.004).projectile.visible,false,'Detonated casing cannot remain an intact projectile');
});

test('legacy or malformed burst timing remains unknown without an invented flash',()=>{
  for(const timing of [undefined,-1,NaN]){
    const e=evidence();e.report.bursts[0].time_s=timing;
    const p=prepareReplayEvent(e,catalog,undefined,2);
    assert.equal(p.bursts?.length,0);assert.ok(p.limitations.includes('burst_timing_unrecorded'));
    assert.deepEqual(samplePreparedReplay(p,1.01).bursts,[]);
  }
});

test('the same prepared GPU frame carries multiple independent burst flashes',()=>{
  const draw=new ReplayDraw(null,{model:{root:{collect(){}}},interior:()=>null},null);
  const frame={id:1,physicalS:1.01,traces:[],staticTraces:[],projectiles:[],event:null,bursts:[{eventId:'one',position:[1,2,3],radius:.4,age:.01,alpha:.8,inside:true},{eventId:'two',position:[4,5,6],radius:.5,age:.02,alpha:.6,inside:false}]};
  const result=draw.prepare(frame);
  assert.equal(result.burstCount,2);assert.equal(result.count,2);
  assert.equal(result.instances[11],5);assert.equal(result.instances[23],5);
  assert.deepEqual(Array.from(result.instances.slice(0,3)),[1,2,3]);
  assert.deepEqual(Array.from(result.instances.slice(12,15)),[4,5,6]);
  assert.equal(draw.prepare(frame),result,'Two replay cameras reuse the same physical frame');
});
