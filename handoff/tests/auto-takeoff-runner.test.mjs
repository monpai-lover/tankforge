import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {aircraftPerformancePrelude} from '../tools/aircraft_performance/runtime.mjs';

const helperURL=new URL('../tools/auto_takeoff_runner.js',import.meta.url);
const helper=fs.existsSync(helperURL)?fs.readFileSync(helperURL,'utf8'):'';
const app=fs.readFileSync(process.env.TF_AUTO_TAKEOFF_APP||new URL('../bundle/app.js.html',import.meta.url),'utf8');
function cut(a,b){const i=app.indexOf(a),j=app.indexOf(b,i);assert.ok(i>=0&&j>i,a);return app.slice(i,j);}
function realControls(extra={}){
  const c=vm.createContext({TFOfflineFlightProfile:null,...extra});
  vm.runInContext(aircraftPerformancePrelude()+`const norm=a=>{const l=Math.hypot(...a)||1;return a.map(v=>v/l);};
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const FLIGHT_FIXED=1/120,FLIGHT_MAX_STEPS=12;
  ${cut('  var aqMul = ','  var AIRCRAFT_KEYS')}
  ${cut('  // Input shaping follows wasm-flight-lab','  var Aircraft = class')}
  class ExtractedAircraft {${cut('    look(dx, dy) {','    pose(alpha = 1) {')}}
  globalThis.methods=ExtractedAircraft.prototype;
  globalThis.advance=advanceAircraftInput;globalThis.PilotKeys=AircraftPilotKeys;`,c);
  return c;
}
const plain=x=>JSON.parse(JSON.stringify(x));
function fixture(search='?tfAutoTakeoff=1',overrides={}){
  let now=0;const nodes=[],logs=[],calls=[];
  const element=tag=>({tagName:tag.toUpperCase(),style:{},children:[],appendChild(x){this.children.push(x);},addEventListener(){},click(){calls.push(['click',tag]);}});
  const handlers={};
  const document={hidden:false,visibilityState:'visible',activeElement:{tagName:'CANVAS'},hasFocus:()=>true,createElement:element,body:element('body'),addEventListener(kind,fn){(handlers[kind]||=[]).push(fn);},emit(kind){for(const fn of handlers[kind]||[])fn();}};
  const g={mode:'garage',online:null,frontline:null,paused:false,thumbs:[],mapId:'range',airInputFocused:true,touch:{throttle:0,steer:0},mdx:0,mdy:0,keys:new Set(),air:null,shots:[],bullets:[],enemies:[]};
  const types={p51d:{id:'p51d',name:'P-51D',sound:'piston',rotateKmh:180,fighter:{}},me262:{id:'me262',name:'Me 262',sound:'jet',rotateKmh:200,fighter:{}},f15c:{id:'f15c',name:'F-15',sound:'jet',rotateKmh:260,fighter:{}}};
  const context=vm.createContext({URLSearchParams,document,location:{search},performance:{now:()=>now},console:{log:x=>logs.push(x)},Blob,URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}},setTimeout:f=>f()});
  vm.runInContext(helper,context);
  assert.equal(typeof context.createAutoTakeoffRunner,'function','candidate takeoff runner is present');
  const deps={state:()=>g,types,now:()=>now,document,log:x=>logs.push(plain(x)),launch(id){calls.push(['launch',id]);},toGarage(){calls.push(['garage']);g.air=null;g.mode='garage';},setMap(id){calls.push(['map',id]);g.mapId=id;},readCounts(){return {surfaceActors:16,ordnance:0,hitcamActive:false};},...overrides};
  const runner=context.createAutoTakeoffRunner(deps);
  return {runner,g,types,context,document,nodes,logs,calls,advance(ms=16){now+=ms;},time:()=>now};
}

test('diagnostic is absent without exact opt-in, including no panel or lifecycle mutation',()=>{
  for(const query of ['', '?tfAutoTakeoff=true','?tfAutoTakeoff=0']){const f=fixture(query);assert.equal(f.runner,null);assert.equal(f.document.body.children.length,0);assert.deepEqual(f.calls,[]);}
});

test('candidate uses real launch dependency, real range roster and no online takeover',()=>{
  const f=fixture();assert.ok(f.runner);f.runner.afterFrame();assert.deepEqual(f.calls,[['map','range'],['launch','p51d']]);
  assert.deepEqual(plain(f.runner.summary().selectedAircraft),['p51d','me262','f15c']);
  const b=fixture();b.g.online={battle:1};b.runner.afterFrame();assert.equal(b.runner.summary().status,'aborted');assert.deepEqual(b.calls,[]);
  const c=fixture();c.g.frontline={active:true};c.runner.afterFrame();assert.equal(c.runner.summary().status,'aborted');assert.deepEqual(c.calls,[]);
});

test('AA-disabled or empty AA observations are not reported as a passing real-AA run',()=>{
  for(const enabled of [false,true]){
    const f=fixture('?tfAutoTakeoff=1&tfAutoTakeoffTypes=p51d');f.runner.afterFrame();
    const p={type:f.types.p51d,keys:new Set(),state:{throttle:1,flaps:'takeoff',gear:true},cur:new Float32Array(64),onGround:true,crashed:false,toggle(){}};
    f.g.mode='battle';f.g.air={active:true,plane:p};f.g.airDefenceOn=enabled;f.runner.afterFrame();p.onGround=false;p.cur[35]=20;
    for(let i=0;i<905&&!f.runner.summary().results.length;i++){f.runner.beforeInput(1/60);f.runner.afterFrame();}
    assert.equal(f.runner.summary().results[0].status,'FAIL');assert.match(f.runner.summary().results[0].reason,/AA|防空/);
  }
});

test('hidden, unfocused, paused and typing frames submit no commands or elapsed simulation time',()=>{
  const f=fixture('?tfAutoTakeoff=1&tfAutoTakeoffTypes=p51d');
  f.runner.afterFrame();
  const p={type:f.types.p51d,keys:new Set(),state:{throttle:0,flaps:false,gear:true,brake:false},cur:new Float32Array(64),onGround:true,crashed:false,toggle(){throw Error('must not command hidden frame');}};
  f.g.air={active:true,plane:p};f.g.mode='battle';f.runner.afterFrame();
  for(const mode of ['hidden','focus','pause','typing']){
    f.document.hidden=mode==='hidden';f.document.visibilityState=mode==='hidden'?'hidden':'visible';f.g.airInputFocused=mode!=='focus';f.g.paused=mode==='pause';f.document.activeElement.tagName=mode==='typing'?'INPUT':'CANVAS';
    f.advance(10000);f.runner.beforeInput(1/60);f.runner.afterFrame();assert.equal(p.keys.size,0);assert.equal(f.g.mdy,0);
  }
  assert.equal(f.runner.summary().results.length,0);assert.equal(f.runner.summary().current.simSeconds,0);
});

test('background periods with no RAF callbacks never count as visible startup or flight time',()=>{
  const f=fixture('?tfAutoTakeoff=1&tfAutoTakeoffTypes=p51d');f.runner.afterFrame();
  f.document.hidden=true;f.document.visibilityState='hidden';f.document.emit('visibilitychange');f.advance(240000);
  f.document.hidden=false;f.document.visibilityState='visible';f.document.emit('visibilitychange');f.runner.afterFrame();
  assert.equal(f.runner.summary().status,'running');assert.equal(f.runner.summary().results.length,0);
});

test('real input and actual fixed-step WASM consume Shift and mouse rotation before stepping',async()=>{
  const bytes=fs.readFileSync(new URL('../flight/flight_core.wasm',import.meta.url));
  const {instance}=await WebAssembly.instantiate(bytes,{math:{sin:Math.sin,cos:Math.cos,atan2:Math.atan2,exp:Math.exp,asin:Math.asin,acos:Math.acos},world:{ground:()=>0,landable:()=>1}});
  const api=instance.exports;api.set_world(1);api.configure_control(1,0,.22,1);api.configure(0,45,1,6.5,1);api.spawn(0,0,0,0,80,1);
  const S=new Float32Array(api.memory.buffer,api.state_ptr(),api.state_len()),controls=realControls(),calls=[];
  const p=Object.assign(Object.create(controls.methods),{type:{id:'p51d',rotateKmh:180,sound:'piston'},api:{step(...a){calls.push(a);api.step(...a);}},S,cur:S.slice(),prev:S.slice(),keys:new controls.PilotKeys(),pilotAxes:[0,0,0],state:{throttle:.5,instructor:true,gear:true,flaps:false,brake:false,level:false},aim:[0,0,1],camQ:[0,0,0,1],aimBias:[0,0,0,1],free:{yaw:0,pitch:0},time:0,acc:0,crashed:false,onGround:true,damage:{pilotDead:false,broken:false,step(){}},applyDamage(){},pose(){},hudState(){return {ias:this.cur[13]*3.6,agl:this.cur[35],pitch:0};}});
  const f=fixture('?tfAutoTakeoff=1&tfAutoTakeoffTypes=p51d');f.runner.afterFrame();f.g.mode='battle';f.g.air={active:true,plane:p};f.runner.afterFrame();
  const beforePosition=Array.from(p.cur);f.runner.beforeInput(1/60);assert.deepEqual(Array.from(p.cur),beforePosition,'runner cannot write physical telemetry');assert.ok(p.keys.has('ShiftLeft'));
  controls.advance(f.g.air,1/60,f.g,[],true);
  assert.equal(calls.length,2);assert.ok(calls[0][4]>.5,'actual Shift command reaches first core call');
  let rotated=false;
  for(let i=0;i<7200&&!rotated;i++){
    f.runner.beforeInput(1/60);const mouse=f.g.mdy,at=calls.length;controls.advance(f.g.air,1/60,f.g,[],true);
    if(mouse<0){assert.ok(calls[at][2]>0,'actual mouse rotation reaches the first core call after reaching rotation speed');rotated=true;}
  }
  assert.ok(rotated,`real runway consumer reached rotation speed; final IAS=${p.cur[13]*3.6}`);assert.equal(f.g.mdy,0);assert.ok(S.every(Number.isFinite));
});

test('genuine takeoff/AA observation accumulates in one run and profiler counters are reported as measured',()=>{
  const f=fixture('?tfAutoTakeoff=1&tfAutoTakeoffTypes=p51d');f.runner.afterFrame();
  const p={type:f.types.p51d,keys:new Set(),state:{throttle:1,flaps:false,gear:true,brake:false},cur:new Float32Array(64),onGround:true,crashed:false,toggle(code){if(code==='KeyG')this.state.gear=!this.state.gear;else if(code==='KeyF')this.state.flaps='combat';}};
  p.cur[13]=p.cur[14]=70;f.g.mode='battle';f.g.air={active:true,plane:p};f.g.enemies=[{alive:true,adState:{state:'guns'}}];f.g.shots=[{}];f.runner.afterFrame();p.onGround=false;p.cur[35]=20;
  f.runner.onProfile({kind:'sample',aircraft:'p51d',frames:60,metrics:{'frame.cpu_ms':{mean:12,total:720,calls:60},'fn.surfaceCollisionQuery':{calls:200}},counters:{'replay.record_step':24}});
  assert.match(f.document.body.children[0].children[0].textContent,/CPU 12/,'panel displays measured CPU values from actual profiler');
  for(let i=0;i<901;i++){f.runner.beforeInput(1/60);f.runner.afterFrame();}
  const summary=f.runner.summary();assert.equal(summary.status,'complete');assert.equal(summary.results.length,1);assert.equal(summary.results[0].takeoff,true);assert.ok(summary.results[0].peakCounts.shots>=1);assert.equal(summary.results[0].profiles[0].metrics['fn.surfaceCollisionQuery'].calls,200);assert.match(summary.scope,/actual|真實/i);assert.equal(summary.results[0].profiles[0].metrics['frame.cpu_ms'].mean,12);
});

test('C215 actual aircraft configuration completes prop, early jet and modern jet runway takeoffs through normal input only',async()=>{
  const end=app.indexOf('  // client/web/src/main.js');assert.ok(end>0);
  const shared=vm.createContext({console,atob,btoa,TextEncoder,TextDecoder,performance,structuredClone});
  vm.runInContext(app.replace(/^<script>/,'').slice(0,end-8)+'globalThis.real={AIRCRAFT_TYPES,configureAircraftSurfaces,Aircraft,aqLook,advanceAircraftInput};})();',shared);
  const {real}=shared,bytes=fs.readFileSync(new URL('../flight/flight_core.wasm',import.meta.url)),rows=[];
  for(const id of ['p51d','me262','f15c']){
    const type=real.AIRCRAFT_TYPES[id];assert.ok(type,id+' actual playable profile');
    const {instance}=await WebAssembly.instantiate(bytes,{math:{sin:Math.sin,cos:Math.cos,atan2:Math.atan2,exp:Math.exp,asin:Math.asin,acos:Math.acos},world:{ground:()=>0,landable:()=>1}}),api=instance.exports;
    api.set_world(1);api.configure_airframe(...type.airframe);real.configureAircraftSurfaces(api,type);api.configure(0,45,1,type.gLimit||6.5,1);api.configure_envelope(type.gLimit||6.5,type.minGLimit??-3,type.maxAoA??0,type.minAoA??0);api.configure_control(1,0,.22,1);api.spawn(0,0,18,0,0,1);
    const S=new Float32Array(api.memory.buffer,api.state_ptr(),api.state_len());
    const p=Object.assign(Object.create(real.Aircraft.prototype),{type,api,S,cur:S.slice(),prev:S.slice(),keys:new Set(),pilotAxes:[0,0,0],state:{throttle:.05,instructor:true,gear:true,flaps:'takeoff',brake:false,level:false},aim:[S[48],S[49],S[50]],camQ:real.aqLook([S[48],S[49],S[50]]),aimBias:[0,0,0,1],free:{yaw:0,pitch:0},time:0,acc:0,damage:{pilotDead:false,broken:false,step(){}},applyDamage(){},pose(){}});
    const f=fixture('?tfAutoTakeoff=1&tfAutoTakeoffTypes='+id,{types:real.AIRCRAFT_TYPES});f.runner.afterFrame();f.g.mode='battle';f.g.air={active:true,plane:p};f.runner.afterFrame();
    const spawn=Array.from(p.cur);let frames=0;
    while(frames<7200 && !p.crashed && !(p.cur[35]>=15&&!p.onGround)){
      f.runner.beforeInput(1/60);real.advanceAircraftInput(f.g.air,1/60,f.g,[],true);frames++;
    }
    rows.push({id,frames,simSeconds:frames/60,spawn:spawn.slice(0,3),position:p.position,iasKmh:p.cur[14]*3.6,agl:p.cur[35],crashed:p.crashed,onGround:p.onGround});
    assert.ok(!p.crashed,id+' must not crash under real runway commands');assert.ok(p.cur[35]>=15&&!p.onGround,id+' runway input must achieve actual flight');
  }
  if(process.env.TF_AUTO_TAKEOFF_CORE_RECEIPT){const crypto=await import('node:crypto');fs.writeFileSync(process.env.TF_AUTO_TAKEOFF_CORE_RECEIPT,JSON.stringify({schema:'TankForgeAutomaticTakeoffCoreConsumerV1',scope:'Actual delivered C215 WASM, aircraft profiles, surface configuration, pilot input and fixed-step consumer on flat runway. Rendering, battle lifecycle and AA are outside this CPU fixture; no browser FPS/performance result.',appSHA256:crypto.createHash('sha256').update(app).digest('hex'),wasmSHA256:crypto.createHash('sha256').update(bytes).digest('hex'),rows},null,2),{flag:'wx'});}
});

test('crash is a failure, invalid types abort, and cancellation clears only harness input',()=>{
  const f=fixture('?tfAutoTakeoff=1&tfAutoTakeoffTypes=p51d');f.runner.afterFrame();
  const p={type:f.types.p51d,keys:new Set(['KeyQ']),state:{throttle:0,flaps:false,gear:true,brake:false},cur:new Float32Array(64),onGround:true,crashed:false,toggle(){}};f.g.mode='battle';f.g.air={active:true,plane:p};f.runner.afterFrame();f.runner.beforeInput(1/60);assert.ok(p.keys.has('ShiftLeft'));f.runner.cancel();assert.ok(!p.keys.has('ShiftLeft'));assert.ok(p.keys.has('KeyQ'));assert.equal(f.runner.summary().status,'aborted');
  const b=fixture('?tfAutoTakeoff=1&tfAutoTakeoffTypes=not-a-real-plane');b.runner.afterFrame();assert.equal(b.runner.summary().status,'aborted');assert.match(b.runner.summary().reason,/aircraft|機型/);
  const c=fixture('?tfAutoTakeoff=1&tfAutoTakeoffTypes=p51d');c.runner.afterFrame();c.g.mode='battle';c.g.air={active:true,plane:{...p,keys:new Set(),crashed:true}};c.runner.afterFrame();c.runner.beforeInput(1/60);c.runner.afterFrame();assert.equal(c.runner.summary().results[0].status,'FAIL');
});

test('actual pilot consumer hook executes immediately before advanceAircraftInput; candidate is syntax-valid and idempotent',async()=>{
  const patchURL=new URL('../tools/patch_auto_takeoff_runner.mjs',import.meta.url);
  assert.ok(fs.existsSync(patchURL),'candidate-only patcher exists');
  const {patchAutoTakeoffRunner}=await import(patchURL.href);const candidate=patchAutoTakeoffRunner(app);
  assert.equal(patchAutoTakeoffRunner(candidate),candidate);
  if(app.includes('/* TF_AUTO_TAKEOFF_RUNNER_BEGIN_20261027 */'))assert.equal(candidate,app);else assert.notEqual(candidate,app);
  const start=candidate.indexOf('<script>')+8,end=candidate.lastIndexOf('</script>');new vm.Script(candidate.slice(start,end));
  const section=candidate.slice(candidate.indexOf('    function stepPlayerAircraftPilot(dt) {'),candidate.indexOf('    function update(dt) {'));
  assert.match(section,/TFAutoTakeoffRunner\.beforeInput\(dt\);\s*advanceAircraftInput/);
  assert.ok(candidate.includes('frame = TFAutoTakeoffRunner.wrapFrame(frame)'));
  assert.ok(candidate.includes('replayDischarges: G4.localReplay?.discharges?.size'),'actual replay owner exposes discharges, not an invented tracks collection');
  for(const [a,b] of [['    function startBattle(', '    // BEGIN AIRCRAFT RESOURCE HELPERS'],['    async function enterAircraft(', '    // NF-01 armament'],['    function flyType(', '    {\n      const battleBtn'],['    function stepAirDefence(', '    // ==== the player']]){
    const original=cut(a,b),i=candidate.indexOf(a),j=candidate.indexOf(b,i);assert.equal(candidate.slice(i,j),original,'existing '+a+' remains byte-identical');
  }
  for(const forbidden of ['window.__tf','.__tfx','plane.spawn(','.cur.set(','.position =','.state.throttle =','.aim ='])assert.ok(!helper.includes(forbidden),forbidden);
});

test('candidate CLI refuses in-place, canonical, existing and non-D output paths without writing',()=>{
  const artifacts=process.env.TF_AUTO_TAKEOFF_TEST_ROOT||(process.platform==='win32'?'D:/TankForge-validation/agent-variant-preserved':os.tmpdir());
  fs.mkdirSync(artifacts,{recursive:true});const dir=fs.mkdtempSync(path.join(artifacts,'takeoff-cli-safety-')),input=path.join(dir,'sentinel.html');fs.writeFileSync(input,'sentinel',{flag:'wx'});
  const patch=fileURLToPath(new URL('../tools/patch_auto_takeoff_runner.mjs',import.meta.url)),canonical=fileURLToPath(new URL('../bundle/app.js.html',import.meta.url));
  for(const output of [input,canonical,'C:/Users/24908/.codex/scratch/forbidden-takeoff-output.html']){
    const r=spawnSync(process.execPath,[patch,'--input',input,'--output',output],{encoding:'utf8'});assert.notEqual(r.status,0);assert.match(r.stderr,/Refusing|D:/i);
  }
  assert.equal(fs.readFileSync(input,'utf8'),'sentinel');
});

test('candidate real profiler discards background gaps even if browser emits no hidden RAF',async()=>{
  const {patchAutoTakeoffRunner}=await import('../tools/patch_auto_takeoff_runner.mjs');const candidate=patchAutoTakeoffRunner(app);
  const a=candidate.indexOf('var TFOfflineFlightProfile = '),b=candidate.indexOf('/* TF_AUTO_TAKEOFF_RUNNER_BEGIN_20261027 */',a);assert.ok(a>=0&&b>a);
  let now=0;const events={},logs=[],document={hidden:false,visibilityState:'visible',hasFocus:()=>true,addEventListener(k,f){(events[k]||=[]).push(f);}};
  const c=vm.createContext({URLSearchParams,location:{search:'?tfAutoTakeoff=1'},performance:{now:()=>now},document,console:{log:s=>logs.push(s)}});vm.runInContext(candidate.slice(a,b),c);
  const profile=c.TFOfflineFlightProfile,g={mode:'battle',air:{active:true,plane:{type:{id:'p51d'},cur:new Float32Array(64)}},paused:false},r={quality:'high',renderScale:1,canvas:{width:1280,height:720}};
  profile.frameStart(0,g,r);now=12;profile.frameEnd(g,r);
  document.hidden=true;document.visibilityState='hidden';for(const f of events.visibilitychange||[])f();now+=240000;
  document.hidden=false;document.visibilityState='visible';for(const f of events.visibilitychange||[])f();profile.frameStart(now,g,r);now+=12;profile.frameEnd(g,r);
  assert.equal(logs.filter(x=>x.includes('"kind":"sample"')).length,0,'no sample can span background time');
  now+=1000;profile.frameStart(now,g,r);now+=12;profile.frameEnd(g,r);
  const report=logs.map(s=>JSON.parse(s.slice('[TF_OFFLINE_PROFILE] '.length))).find(r=>r.kind==='sample');assert.ok(report);assert.ok(report.metrics['raf.gap_ms'].max<2000);
});
