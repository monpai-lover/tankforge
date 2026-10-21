import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// Analysis only: node handoff/tests/flight_control_probe.mjs [--wasm PATH].
// Does not modify flight settings or artifacts.
const root=fileURLToPath(new URL('../../', import.meta.url));
const source=fs.readFileSync(root+'/handoff/bundle/app.js.html','utf8');
assert.ok(process.argv.length===2||(process.argv.length===4&&process.argv[2]==='--wasm'), 'Usage: node flight_control_probe.mjs [--wasm PATH]');
const wasmPath=process.argv[3]?path.resolve(process.argv[3]):root+'/handoff/flight/flight_core.wasm';
const bytes=fs.readFileSync(wasmPath);
const embedded=Buffer.from(source.match(/var FLIGHT_CORE_WASM = "([^"]+)"/)[1],'base64');
if(!process.argv[3])assert.ok(embedded.equals(bytes), 'Embedded and standalone flight kernels differ');
const context=vm.createContext({AIR_PARTS:[], AIR_SKIN:[], AIR_PARTS_JET:[], AIR_SKIN_JET:[]});
const geometryStart=source.indexOf('  var aircraftGeometry = (() => {');
const geometryEnd=source.indexOf('  // NF-01 gear',geometryStart);
assert.ok(geometryStart>=0&&geometryEnd>geometryStart, 'Aircraft metadata helpers unavailable');
vm.runInContext(source.slice(geometryStart,geometryEnd),context);
const typeStart=source.indexOf('  var AIRCRAFT_TYPES = {');
const typeEnd=source.indexOf('  // ---- hangar fighters',typeStart);
assert.ok(typeStart>=0&&typeEnd>typeStart, 'Aircraft type definitions unavailable');
vm.runInContext(source.slice(typeStart,typeEnd)+';globalThis.testTypes=AIRCRAFT_TYPES;',context);
const start=source.indexOf('  var AIR_FIGHTERS = {'),end=source.indexOf('  /** Damage parts and skin of a hangar fighter',start);
vm.runInContext(source.slice(start,end)+';globalThis.fighters=AIR_FIGHTERS;',context);
const types={...context.testTypes,...context.fighters};
async function core(type) {
 const {instance}=await WebAssembly.instantiate(bytes,{math:{sin:Math.sin,cos:Math.cos,atan2:Math.atan2,exp:Math.exp,asin:Math.asin,acos:Math.acos},world:{ground:()=>0,landable:()=>1}});
 const api=instance.exports;
 api.set_world(1);api.configure_control(1,0,.22,1);api.configure_airframe(...type.airframe);api.configure(0,45,1,type.gLimit,1);
 if(api.configure_envelope)api.configure_envelope(type.gLimit,type.minGLimit??-3,type.maxAoA??0,type.minAoA??0);
 api.spawn(0,3000,0,0,140,0);
 return {api,s:new Float32Array(api.memory.buffer,api.state_ptr(),api.state_len())};
}
const results={conditions:{dt_s:1/120,world:'flat, landable, wind zero',intact:true,altitude_m:3000,airspeed_m_s:140,throttle:.78,instructor:true,protection:true,profile:1,handoff:0,release_delay_s:.22,response:1},artifact:{wasmPath,matches:embedded.equals(bytes),sha256:crypto.createHash('sha256').update(bytes).digest('hex'),len:bytes.length},negativeG:[],turns:[]};
for(const id of ['nf01','p51d','f104g','mirage3e']) {
 const type=types[id];
 for(const input of [-1,1]) {
  const {api,s}=await core(type);let minG=Infinity,maxG=-Infinity,minA=Infinity,maxA=-Infinity;
  for(let i=0;i<240;i++){api.step(1/120,0,0,1,.78,input,0,0,1);assert.ok(s.every(Number.isFinite),'Nonfinite flight telemetry');minG=Math.min(minG,s[17]);maxG=Math.max(maxG,s[17]);minA=Math.min(minA,s[15]*180/Math.PI);maxA=Math.max(maxA,s[15]*180/Math.PI);}
  results.negativeG.push({id,manualPitch:input,seconds:2,airspeedStart:140,altitudeStart:3000,gLimit:type.gLimit,minG:+minG.toFixed(3),maxG:+maxG.toFixed(3),minAoADeg:+minA.toFixed(2),maxAoADeg:+maxA.toFixed(2),endAlt:+s[1].toFixed(1),crashed:!!s[22]});
 }
 const {api,s}=await core(type);const target=[Math.sin(Math.PI/3),0,Math.cos(Math.PI/3)];let firstWithin3=null,peakG=-Infinity,minSpeed=Infinity;let rms=0,n=0;
 for(let i=0;i<3600;i++){api.step(1/120,...target,.78,0,0,0,1);assert.ok(s.every(Number.isFinite),'Nonfinite flight telemetry');const dot=target[0]*s[48]+target[1]*s[49]+target[2]*s[50];const error=Math.acos(Math.max(-1,Math.min(1,dot)))*180/Math.PI;if(firstWithin3===null&&error<=3)firstWithin3=(i+1)/120;peakG=Math.max(peakG,s[17]);minSpeed=Math.min(minSpeed,s[13]);if(i>=2400){rms+=error*error;n++;}}
 results.turns.push({id,targetYawDeg:60,seconds:30,airspeedStart:140,altitudeStart:3000,throttle:.78,firstWithin3s:firstWithin3===null?null:+firstWithin3.toFixed(3),last10sRmsError:+Math.sqrt(rms/n).toFixed(3),peakG:+peakG.toFixed(3),minSpeed:+minSpeed.toFixed(2),endSpeed:+s[13].toFixed(2),endAlt:+s[1].toFixed(1),crashed:!!s[22]});
}
const a=await core(types.nf01), b=await core(types.nf01);
for(let i=0;i<3600;i++) {
 const yaw=i<600?0:Math.PI/3;
 for(const c of [a,b]) c.api.step(1/120,Math.sin(yaw),0,Math.cos(yaw),.78,0,0,0,1);
 assert.deepEqual(new Uint8Array(a.s.buffer,a.s.byteOffset,a.s.byteLength),new Uint8Array(b.s.buffer,b.s.byteOffset,b.s.byteLength),'Independent instances diverged');
}
results.determinism={id:'nf01',steps:3600,telemetryBytes:320,bitIdentical:true};
console.log(JSON.stringify(results,null,2));
