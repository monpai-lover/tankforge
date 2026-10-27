import fs from 'node:fs';
import vm from 'node:vm';
import {api,c,source,section,models} from './jet-fixture.mjs';
import {R7_AIRCRAFT_IDS,assertFlightKernelIdentity} from './fixtures/r7-aircraft-contract.mjs';
import assert from 'node:assert/strict';
export {source,section,models};
vm.runInContext(section('    const AIR_TEST_INFO = {','    const hangar = document.createElement')+'\nconst AIR_GUN_TEXT={};globalThis.surfaceMetadata={configureAircraftSurfaces,airTypeInfo};',c);
export const types=api.AIRCRAFT_TYPES;
assert.deepEqual(Object.keys(types).sort(),R7_AIRCRAFT_IDS,'Actual decoded production type registry includes both explicitly inherited variants');
export const configureSurfaces=c.surfaceMetadata.configureAircraftSurfaces;
export const airInfo=c.surfaceMetadata.airTypeInfo;
const bytes=fs.readFileSync(new URL('../flight/flight_core.wasm',import.meta.url));assertFlightKernelIdentity(bytes);
const module=await WebAssembly.compile(bytes);
export async function flight(id='nf01',{speed=140,altitude=3000,protection=false,ground=false}={}){
  const {exports:api}=await WebAssembly.instantiate(module,{math:{sin:Math.sin,cos:Math.cos,atan2:Math.atan2,exp:Math.exp,asin:Math.asin,acos:Math.acos},world:{ground:()=>0,landable:()=>1}});
  const T=types[id];api.set_world(1);api.configure_airframe(...T.airframe);configureSurfaces(api,T);
  api.configure(0,45,1,T.gLimit,Number(protection));api.configure_envelope(T.gLimit,T.minGLimit??-3,0,0);
  api.spawn(0,altitude,0,0,speed,Number(ground));
  const s=new Float32Array(api.memory.buffer,api.state_ptr(),api.state_len()),a=new Float32Array(api.memory.buffer,api.aero_state_ptr(),api.aero_state_len());
  return {api,s,a,T,step:(pitch=0,roll=0,yaw=0,flags=0,throttle=.78)=>api.step(1/120,0,0,1,throttle,pitch,roll,yaw,flags)};
}
