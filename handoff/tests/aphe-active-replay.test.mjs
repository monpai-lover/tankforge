import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const app=fs.readFileSync(new URL('../bundle/app.js.html',import.meta.url),'utf8'),a=app.indexOf('  // client/web/src/game/replayRecords.js'),b=app.indexOf('  // client/web/src/game/projectileReplay.js',a);
assert.ok(a>=0&&b>a);
const context=vm.createContext({structuredClone,bulletShellOf:()=>null,projectileProfile:s=>({diameterM:s.caliber_mm/1000}),projectileBodyStage:()=>null});
vm.runInContext(app.slice(a,b)+fs.readFileSync(new URL('../tools/aphe_replay_presentation.js',import.meta.url),'utf8')+';globalThis.adapter=({prepare:prepareReplayEvent,sample:samplePreparedReplay});globalThis.pack=packRecordedReplayBursts;',context);
const prepareReplayEvent=(...a)=>JSON.parse(JSON.stringify(context.adapter.prepare(...a)));
const samplePreparedReplay=(...a)=>JSON.parse(JSON.stringify(context.adapter.sample(...a)));
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

test('active thirteen-word instance packing retains both flashes and reserves their slots',()=>{
 const instances=new Float32Array(4096*13);instances[0]=42;
 const rows=[{eventId:'one',position:[1,2,3],radius:.4,age:.01,alpha:.8},{eventId:'two',position:[4,5,6],radius:.5,age:.02,alpha:.6}];
 const result=context.pack(instances,13,{bursts:rows},4096,4096);
 assert.equal(result.count,4096);assert.equal(result.dynamicCount,4094);assert.equal(result.burstCount,2);assert.equal(result.droppedTraceCount,2);
 assert.equal(instances[0],42);assert.deepEqual(Array.from(instances.slice(4094*13,4094*13+3)),[1,2,3]);assert.equal(instances[4094*13+11],5);
});

test('actual installed supplied renderer packs APHE flashes without replacing its source geometry owner',()=>{
 const begin=app.indexOf('  // client/web/src/game/suppliedReplayDraw.js'),end=app.indexOf('  // client/web/src/game/hitcam.js',begin);assert.ok(begin>=0&&end>begin);
 context.suppliedReplaySource={name:'actual-source'};context.applyReplayBarrelDamage=()=>{};
 vm.runInContext(app.slice(begin,end)+';globalThis.ActiveDraw=SuppliedReplayDraw;',context);
 const root={collect(){}},draw=new context.ActiveDraw({}, {model:{root},interior:()=>null},null,{presentation:{}});
 const frame={id:991,physicalS:1.01,traces:[],staticTraces:[],projectiles:[],event:{contact_s:1,evidence:{authority:'analysis',report:{modules:[],crew:[]}}},bursts:[{eventId:'one',position:[1,2,3],radius:.4,age:.01,alpha:.8}]};
 const p=draw.prepare(frame);assert.equal(p.source,context.suppliedReplaySource);assert.equal(p.burstCount,1);assert.equal(p.count,1);assert.equal(p.instances[11],5);assert.equal(p.instances.length,4096*13);assert.equal(draw.prepare(frame),p);
});
