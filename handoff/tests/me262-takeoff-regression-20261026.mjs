// Standalone diagnosis gate; intentionally outside the frozen *.test.mjs suite.
// node handoff/tests/me262-takeoff-regression-20261026.mjs --wasm PATH [--baseline PATH]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import test from 'node:test';
const root=fileURLToPath(new URL('../../',import.meta.url));
const options={wasm:path.join(root,'handoff/flight/flight_core.wasm'),baseline:path.join(root,'handoff/flight/flight_core.wasm')};
for(let k=2;k<process.argv.length;k+=2){const name=process.argv[k].slice(2);assert.ok(Object.hasOwn(options,name)&&process.argv[k+1]);options[name]=path.resolve(process.argv[k+1]);}
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'me262-takeoff-'));
let result;
try{
  const out=path.join(folder,'probe.json');execFileSync(process.execPath,[path.join(root,'handoff/tests/me262-takeoff-probe-20261026.mjs'),'--wasm',options.wasm,'--out',out],{cwd:root,stdio:'pipe'});result=JSON.parse(fs.readFileSync(out));
}finally{fs.rmSync(folder,{recursive:true,force:true});}
for(const id of ['me262','me262a2a','me262u4']){
  const get=schedule=>result.results.find(x=>x.id===id&&x.schedule===schedule);
  test(`${id}: neutral runway acceleration retains a small trim attitude`,()=>{const x=get('neutral');assert.ok(x.peakPitch_deg<8,`uncommanded pitch ${x.peakPitch_deg} deg`);assert.equal(x.end.crashed,false);assert.ok(x.samples.some(s=>s.ias_kmh>180&&s.acceptedElevator<-.05),'physical elevator trim must oppose the nose-up moment');});
  test(`${id}: an elevated marker starts controlled rotation after the wheel phase`,()=>{const x=get('aim8-from-start');assert.ok(x.firstLift,'must take off');assert.ok(x.firstLift.pitch_deg>6&&x.firstLift.pitch_deg<15,`liftoff pitch ${x.firstLift.pitch_deg} deg`);assert.ok(x.firstLift.ias_kmh>200);assert.equal(x.end.crashed,false);});
  test(`${id}: held manual pull at 190 km/h remains protected through liftoff`,()=>{const x=get('manual-pull-held-at190');assert.equal(x.end.crashed,false,'taxi override must not bypass pitch protection into a ground crash');assert.ok(x.firstLift,'must leave the runway');assert.ok(x.firstLift.pitch_deg<22);assert.ok(x.samples.some(s=>s.command?.pitch===1&&s.acceptedElevator>.02&&s.bodyPitchRate_rad_s<0),'manual pull still drives the physical elevator');});
}
const current=await WebAssembly.compile(fs.readFileSync(options.baseline)),candidate=await WebAssembly.compile(fs.readFileSync(options.wasm));
const profiles=JSON.parse(fs.readFileSync(path.join(root,'data/aircraft/frontline.json'))).aircraft;
const imports={math:{sin:Math.sin,cos:Math.cos,atan2:Math.atan2,exp:Math.exp,asin:Math.asin,acos:Math.acos},world:{ground:()=>0,landable:()=>1}};
async function make(module,id,ground){const api=(await WebAssembly.instantiate(module,imports)).exports,p=profiles[id].physics;api.set_world(1);api.configure_airframe(...p.airframe);api.configure_surfaces(...p.surfaces);api.configure_gear_sequence(...p.gearSequence);api.configure(...p.configure);api.configure_control(...p.control);api.configure_envelope(...p.envelope);api.spawn(0,ground?2:5000,0,0,ground?0:160,Number(ground));return{api,state:new Uint8Array(api.memory.buffer,api.state_ptr(),80*4),aero:new Uint8Array(api.memory.buffer,api.aero_state_ptr(),48*4)};}
test('instructor-off wheel dynamics retain exact prior telemetry for all five aircraft',async()=>{
  for(const id of ['me262','me262a2a','me262u4','mig15','f86f']){const pair=await Promise.all([make(current,id,true),make(candidate,id,true)]);for(let k=0;k<3600;k++){for(const x of pair)x.api.step(1/120,0,0,1,1,0,0,0,132);assert.deepEqual(pair[0].state,pair[1].state,`${id}/${k} state`);assert.deepEqual(pair[0].aero,pair[1].aero,`${id}/${k} aero`);}}
});
test('airborne mixed controls retain exact prior telemetry at 120 and 60 Hz',async()=>{
  for(const id of ['me262','me262a2a','me262u4','mig15','f86f'])for(const dt of [1/120,1/60]){const pair=await Promise.all([make(current,id,false),make(candidate,id,false)]);for(let k=0;k<1200;k++){const args=[dt,.08*Math.sin(k*.02),.05*Math.cos(k*.012),1,.8+.2*Math.sin(k*.001),.4*Math.sin(k*.021),.35*Math.cos(k*.013),.1*Math.sin(k*.03),(k%300<200?1:0)|(k%500<250?4:0)|(k%600<300?128:0)];for(const x of pair)x.api.step(...args);assert.deepEqual(pair[0].state,pair[1].state,`${id}/${dt}/${k} state`);assert.deepEqual(pair[0].aero,pair[1].aero,`${id}/${dt}/${k} aero`);}}
});
