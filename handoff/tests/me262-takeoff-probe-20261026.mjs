// Read-only flight diagnosis. Executes supplied WASM; never changes delivered artifacts.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const options={wasm:'handoff/flight/flight_core.wasm',profile:'data/aircraft/frontline.json',out:null};
for(let i=2;i<process.argv.length;i+=2){
  const key=process.argv[i].slice(2);assert.ok(Object.hasOwn(options,key)&&process.argv[i+1],process.argv[i]);options[key]=process.argv[i+1];
}
const profileBytes=fs.readFileSync(options.profile),profile=JSON.parse(profileBytes);
const bytes=fs.readFileSync(options.wasm),module=await WebAssembly.compile(bytes);
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const rounded=x=>Number.isFinite(x)?+x.toFixed(6):null;
const degree=x=>x*180/Math.PI;
const imports={math:{sin:Math.sin,cos:Math.cos,atan2:Math.atan2,exp:Math.exp,asin:Math.asin,acos:Math.acos},world:{ground:()=>0,landable:()=>1}};
const schedules=['neutral','aim8-at190','manual-pull1s-at190','manual-push1s-at190','manual-pull-held-at190','aim8-from-start','flaps-up','combat-flaps','instructor-off','legacy-instructor','default-surfaces'];
const results=[];
for(const id of ['me262','me262a2a','me262u4','mig15','f86f'])for(const schedule of schedules){
  const p=profile.aircraft[id].physics,api=(await WebAssembly.instantiate(module,imports)).exports;
  assert.ok([213,214,215].includes(api.core_version()));api.set_world(1);api.configure_airframe(...p.airframe);
  if(schedule!=='default-surfaces')api.configure_surfaces(...p.surfaces);
  api.configure_gear_sequence(...p.gearSequence);api.configure(...p.configure);api.configure_control(schedule==='legacy-instructor'?0:p.control[0],...p.control.slice(1));api.configure_envelope(...p.envelope);api.spawn(0,2,0,0,0,1);
  const s=new Float32Array(api.memory.buffer,api.state_ptr(),api.state_len()),a=new Float32Array(api.memory.buffer,api.aero_state_ptr(),api.aero_state_len());
  let pullStart=null,peak=-Infinity,groundPeak=-Infinity,first10=null,first162=null,firstLift=null,maxRate=0;
  const samples=[];
  const sample=(k,command)=>({step:k,time_s:rounded(s[23]),ias_kmh:rounded(s[14]*3.6),pitch_deg:rounded(degree(s[19])),alpha_deg:rounded(degree(s[15])),agl_m:rounded(s[35]),mode:s[36],crashed:!!s[22],bodyPitchRate_rad_s:rounded(s[10]),acceptedElevator:rounded(s[24]),instructorPitchRateDemand_rad_s:rounded(s[64]),pitchTorque_Nm:rounded(a[19]),wingLift_N:rounded(a[4]+a[5]),tailLift_N:rounded(a[6]),gear:rounded(s[33]),flap:rounded(s[34]),gearAxes:Array.from(a.slice(36,40),rounded),command});
  for(let k=0;k<6000;k++){
    if(pullStart===null&&s[14]*3.6>=190)pullStart=k;
    const aimUp=schedule==='aim8-from-start'||schedule==='aim8-at190'&&pullStart!==null;
    const pitch=schedule==='manual-pull-held-at190'&&pullStart!==null?1:schedule==='manual-pull1s-at190'&&pullStart!==null&&k<pullStart+120?1:schedule==='manual-push1s-at190'&&pullStart!==null&&k<pullStart+120?-1:0;
    const flags=(schedule==='instructor-off'?0:1)|4|(schedule==='flaps-up'?0:schedule==='combat-flaps'?64:128);
    const command={dt_s:1/120,aim:[0,aimUp?Math.tan(8*Math.PI/180):0,1],throttle:1,pitch,roll:0,yaw:0,flags};
    api.step(command.dt_s,...command.aim,command.throttle,pitch,0,0,flags);
    assert.ok(s.every(Number.isFinite)&&a.every(Number.isFinite),`${id}/${schedule}: nonfinite state`);
    const deg=degree(s[19]);peak=Math.max(peak,deg);if(s[35]<=2.00001)groundPeak=Math.max(groundPeak,deg);maxRate=Math.max(maxRate,Math.abs(s[10]));
    if(!first162&&s[13]>=45)first162=sample(k,command);
    if(!first10&&deg>=10)first10=sample(k,command);
    if(!firstLift&&s[35]>2.05)firstLift=sample(k,command);
    if(k%60===0)samples.push(sample(k,command));
    if(s[22])break;
  }
  const estimatedRotation_m_s=Math.sqrt(2*p.airframe[0]*9.80665/(1.225*p.airframe[1]*(.2+p.airframe[9]*.15+.36*.5)))*.9;
  results.push({id,schedule,coreVersion:api.core_version(),physics: p,estimatedRotation_kmh:rounded(estimatedRotation_m_s*3.6),peakPitch_deg:rounded(peak),groundPeakPitch_deg:rounded(groundPeak),maxPitchRate_rad_s:rounded(maxRate),first162,first10,firstLift,end:sample(-1,null),samples});
}
const result={scope:'Actual supplied C213/C214 flight WASM on flat universally landable ground, selected native profile full fuel/no stores, no fuel burn or host damage; original browser and native configure arguments are shared. Samples/commands are diagnostic, not historical performance certification. sourceHashes identify the current delivered C sources, not an assertion that historical/experimental WASM uses them unchanged.',wasm:{path:path.resolve(options.wasm),sha256:sha(bytes),bytes:bytes.length},profile:{path:path.resolve(options.profile),sha256:sha(profileBytes)},sourceHashes:Object.fromEntries(['handoff/flight/flight_core.c','handoff/flight/aerodynamics.h','handoff/flight/instructor_v2.h','handoff/tools/frontline_client.js'].map(p=>[p,sha(fs.readFileSync(p))])),results};
if(options.out)fs.writeFileSync(options.out,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({wasm:result.wasm,profile:result.profile,out:options.out,results:results.map(({id,schedule,peakPitch_deg,groundPeakPitch_deg,first10,firstLift,end})=>({id,schedule,peakPitch_deg,groundPeakPitch_deg,first10:first10&&{t:first10.time_s,ias:first10.ias_kmh,ctl:first10.acceptedElevator},firstLift:firstLift&&{t:firstLift.time_s,ias:firstLift.ias_kmh,pitch:firstLift.pitch_deg},crashed:end.crashed}))},null,2));
