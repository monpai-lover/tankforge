import {aircraftPerformancePrelude} from '../tools/aircraft_performance/runtime.mjs';
// Real WASM authority tests; no browser, synthetic animation actuator, or GPU.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const wasmPath=process.argv[2]||'handoff/flight/flight_core.wasm';
const baselinePath=process.argv[3]||'handoff/tests/out/me262-game-v2-20261025/core212-before-gear.wasm';
const outPath=process.argv[4]||'handoff/tests/out/me262-game-v2-20261025/core213-gear-verification.json';
const source=fs.readFileSync('handoff/bundle/app.js.html','utf8');
const section=(a,b)=>{const i=source.indexOf(a),j=source.indexOf(b,i);assert.ok(i>=0&&j>i,a);return source.slice(i,j);};
const c=vm.createContext({AIR_PARTS:[],AIR_SKIN:[],AIR_PARTS_JET:[],AIR_SKIN_JET:[]});
vm.runInContext(aircraftPerformancePrelude()+section('  var aircraftGeometry = (() => {','  // NF-01 gear')+
 section('  var AIRCRAFT_TYPES = {','  // ---- hangar fighters')+
 section('  var AIR_FIGHTERS = {','  function fighterDamageModel(f) {')+
 '\nglobalThis.types={nf01:AIRCRAFT_TYPES.nf01,me262:AIR_FIGHTERS.me262,mig17f:AIR_FIGHTERS.mig17f};',c);
const bytes=fs.readFileSync(wasmPath),baseline=fs.existsSync(baselinePath)?fs.readFileSync(baselinePath):execFileSync('git',['show','3d4c4953e3519ae5b54b377db91b92bce87cedbe:handoff/flight/flight_core.wasm']);
const compiled=await WebAssembly.compile(bytes),old=await WebAssembly.compile(baseline);
const DT=1/120, checks=[], sha=b=>crypto.createHash('sha256').update(b).digest('hex');
assert.equal(sha(baseline),'a52a939b991eee2ac7c64f2a3aabb6b5ab7f69142d4bd887e2fc12bc268d1342','Expected verified core212 fixture');
const near=(a,b,e=1e-4)=>assert.ok(Math.abs(a-b)<=e,`${a} vs ${b}, tolerance ${e}`);
async function make(module=compiled,type='me262',ground=false){
 const host={ground:0};
 const api=(await WebAssembly.instantiate(module,{math:{sin:Math.sin,cos:Math.cos,atan2:Math.atan2,exp:Math.exp,asin:Math.asin,acos:Math.acos},world:{ground:()=>host.ground,landable:()=>1}})).exports;
 api.set_world(1);api.configure_airframe(...c.types[type].airframe);api.configure(0,45,1,6.5,0);api.configure_control(1,0,.22,1);
 api.spawn(0,20000,0,0,150,Number(ground));
 const s=new Float32Array(api.memory.buffer,api.state_ptr(),80),a=new Float32Array(api.memory.buffer,api.aero_state_ptr(),48);
 return {api,s,a,host,axes:()=>Array.from(a.slice(36,40)),step:(down,dt=DT)=>api.step(dt,0,0,1,.65,0,0,0,down?4:0)};
}
const sequence=p=>p.api.configure_gear_sequence(1,3,3,1,.75,1);
let comparedFloats=0;
for(const type of ['nf01','me262','mig17f'])for(const initial of ['spawn','parked','scenario1']){
 const a=await make(compiled,type,initial==='parked'),b=await make(old,type,initial==='parked');
 if(initial==='scenario1'){a.api.reset(1);b.api.reset(1);}
 assert.equal(a.api.core_version(),213);assert.equal(b.api.core_version(),212);
 for(let k=0;k<960;k++){
  const flags=(k%400<200?4:0)|(k%177<60?128:0)|(k%210<40?16:0)|(k%500<300?1:0);
  const args=[DT,.2*Math.sin(k*.01),.03,1,.8,Math.sin(k*.021)*.3,Math.cos(k*.017)*.4,Math.sin(k*.011)*.2,flags];
  a.api.step(...args);b.api.step(...args);
  const actual=[...a.s,...a.a],expected=[...b.s,...b.a];
  for(let j=0;j<128;j++){assert.equal(actual[j],expected[j],`mode0 ${type}/${initial} tick${k} float${j}`);comparedFloats++;}
  assert.deepEqual(a.axes(),[0,0,0,0]);
 }
}
checks.push({name:'mode0 exact core212 parity',profiles:3,scenarios:3,ticks:8640,floats:comparedFloats,maximumError:0});
{
 const p=await make();sequence(p);assert.deepEqual(p.axes(),[0,0,0,0]);
 const points=[];
 for(let k=1;k<=932;k++){
  p.step(true);if([120,480,570,930,932].includes(k))points.push({time:k*DT,axes:p.axes(),effectiveGear:p.s[33]});
  near(p.s[33],(p.a[36]+p.a[38])/2,1e-7);
 }
 near(points[0].axes[1],1);near(points[0].axes[0],0);near(points[1].axes[0],1);near(points[1].axes[2],0);
 near(points[2].axes[3],1);near(points[2].axes[2],0);assert.deepEqual(p.axes(),[1,1,1,1]);
 for(let k=1;k<=962;k++){p.step(false);if([360,480,840,960,962].includes(k))points.push({retractionTime:k*DT,axes:p.axes(),effectiveGear:p.s[33]});}
 assert.deepEqual(p.axes(),[0,0,0,0]);assert.equal(p.s[22],0);
 checks.push({name:'accepted7.75s extension/8s retraction phases and physical scalar',points});
}
{
 const p=await make();sequence(p);let last=p.axes(),toggles=0;
 for(let k=0;k<4800;k++){
  const down=Math.floor(k/137)%2===0;if(k%137===0)toggles++;
  p.step(down);const now=p.axes();
  for(let j=0;j<4;j++){assert.ok(now[j]>=0&&now[j]<=1);assert.ok(Math.abs(now[j]-last[j])<=DT/[3,1,3,.75][j]+1e-6);}
  if(Math.abs(now[0]-last[0])>1e-7)near(now[1],1);
  if(Math.abs(now[2]-last[2])>1e-7)near(now[3],1);
  if(now[1]<last[1]-1e-7)near(now[0],0);
  if(now[3]<last[3]-1e-7)near(now[2],0);
  last=now;
 }
 assert.equal(p.s[22],0);checks.push({name:'arbitrary reversals preserve clearance and bounded actual movement',ticks:4800,toggles});
}
{
 const p=await make();sequence(p);for(let k=0;k<650;k++)p.step(true);
 const before=p.axes(),time=p.s[23],pose=Array.from(p.s.slice(0,13));
 p.api.configure_airframe(...c.types.me262.airframe);assert.deepEqual(p.axes(),[0,0,0,0]);sequence(p);
 assert.deepEqual(p.axes(),before);assert.deepEqual(Array.from(p.s.slice(0,13)),pose);assert.equal(p.s[23],time);
 p.step(false);const after=p.axes();for(let j=0;j<4;j++)assert.ok(Math.abs(after[j]-before[j])<=DT/.75+1e-6);
 sequence(p);assert.deepEqual(p.axes(),after,'repeat configure cannot advance/reset mechanism');
 p.api.configure_airframe(...c.types.nf01.airframe);p.step(true);assert.deepEqual(p.axes(),[0,0,0,0]);
 const scalar=p.s[33];sequence(p);near(p.a[36],scalar);near(p.a[38],scalar);
 p.api.configure_airframe(...c.types.nf01.airframe);p.api.spawn(0,20000,0,0,150,0);sequence(p);assert.deepEqual(p.axes(),[0,0,0,0]);
 p.api.spawn(0,20000,0,0,0,1);assert.deepEqual(p.axes(),[1,1,1,1]);
 p.api.reset(0);assert.deepEqual(p.axes(),[0,0,0,0]);p.api.reset(1);assert.deepEqual(p.axes(),[1,1,1,1]);
 checks.push({name:'mass reconfiguration continuity, no cross-type/new-spawn state, endpoint reset',before,after});
}
{
 const p=await make();sequence(p);for(let k=0;k<300;k++)p.step(true);
 const before=p.axes();p.step(false,0);p.step(false,NaN);assert.deepEqual(p.axes(),before);
 p.api.configure_gear_sequence(1,NaN,Infinity,-1,0,NaN);assert.ok(p.axes().every(Number.isFinite));
 p.api.configure_gear_sequence(0,3,3,1,.75,1);assert.deepEqual(p.axes(),[0,0,0,0]);
 checks.push({name:'finite timing/input boundaries and explicit mode0 disable'});
}
{
 const landings=[];
 for(const ticks of [888,940]){
  const p=await make();sequence(p);for(let k=0;k<ticks;k++)p.api.step(DT,0,0,1,.65,0,0,0,5);
  // Use the real bounded impulse API to arrest sink, then raise host terrain
  // 1cm into the landing contact. No internal C state/telemetry is overwritten.
  for(let k=0;k<30&&Math.abs(p.s[8])>.001;k++)p.api.impulse(0,-p.s[8],0,0,0,0);
  assert.ok(p.s[33]>.9);assert.ok(Math.abs(p.s[20])<.35);assert.ok(p.s[19]>-.32&&p.s[19]<.45);assert.ok(p.s[8]>-6.5);
  const before={axes:p.axes(),effectiveGear:p.s[33],sink:p.s[8],pitch:p.s[19],bank:p.s[20]};
  p.host.ground=p.s[1]-2+.01;p.api.step(DT,0,0,1,.65,0,0,0,5);
  assert.equal(p.s[22],ticks===888?1:0,'Actual native touchdown requires both accepted leg locks');
  landings.push({...before,crashed:p.s[22]});
 }
 checks.push({name:'real terrain touchdown rejects unlocked nose despite average>.9 and accepts both locked',landings});
}
const result={passed:true,coreVersion:213,wasmSha256:sha(bytes),baseline212Sha256:sha(baseline),checks};
fs.mkdirSync(path.dirname(outPath),{recursive:true});
fs.writeFileSync(outPath,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
