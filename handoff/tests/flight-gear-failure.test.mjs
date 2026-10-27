import {assertFlightKernelIdentity} from './fixtures/r7-aircraft-contract.mjs';
import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

async function aircraft(sequence=false){
  const path=process.env.TF_GEAR_FAILURE_WASM||new URL('../flight/flight_core.wasm',import.meta.url);
  const bytes=fs.readFileSync(path);assertFlightKernelIdentity(bytes);
  const {instance}=await WebAssembly.instantiate(bytes,{math:{sin:Math.sin,cos:Math.cos,atan2:Math.atan2,exp:Math.exp,asin:Math.asin,acos:Math.acos},world:{ground:()=>0,landable:()=>1}});
  const api=instance.exports;
  assert.equal(typeof api.set_gear_failure,'function','Real flight kernel must expose authoritative gear failure');
  assert.equal(api.core_version(),215);
  api.set_world(1);api.spawn(0,1000,0,0,150,0);
  if(sequence)api.configure_gear_sequence(1,3,3,1,.75,1);
  const s=new Float32Array(api.memory.buffer,api.state_ptr(),80),a=new Float32Array(api.memory.buffer,api.aero_state_ptr(),48);
  const step=()=>api.step(1/120,0,0,1,.65,0,0,0,4);
  return {api,s,a,step};
}

for(const sequence of [false,true])test(`real flight kernel removes ${sequence?'sequenced':'scalar'} gear immediately and cannot extend it until explicit repair`,async()=>{
  const x=await aircraft(sequence);for(let i=0;i<1200;i++)x.step();
  assert.ok(x.s[33]>.99);const position=[...x.s.slice(0,13)],time=x.s[23];
  x.api.set_gear_failure(1);assert.equal(x.s[33],0);assert.deepEqual([...x.a.slice(36,40)],[0,0,0,0]);
  assert.deepEqual([...x.s.slice(0,13)],position);assert.equal(x.s[23],time);
  for(let i=0;i<1200;i++)x.step();assert.equal(x.s[33],0);
  x.api.configure_airframe(3200,22,2.1,11,14000,21000,6500,.026,.065,4.5,.28,0,15500,0);
  if(sequence)x.api.configure_gear_sequence(1,3,3,1,.75,1);
  x.step();assert.equal(x.s[33],0,'Mass reconfiguration cannot repair failed gear');
  x.api.set_gear_failure(0);for(let i=0;i<1200;i++)x.step();assert.ok(x.s[33]>.99);
  x.api.set_gear_failure(1);x.api.spawn(0,0,0,0,0,1);assert.equal(x.s[33],1,'New life clears failure');
  x.api.set_gear_failure(1);x.api.reset(1);assert.equal(x.s[33],1,'Explicit reset clears failure');
});
