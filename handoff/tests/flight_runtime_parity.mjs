// No DOM/renderer: execute exactly the supplied WASM with the production client's
// canonical height sampler, and the same f32 parameters/commands as wasmi.
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
let text = '';
for await (const chunk of process.stdin) text += chunk;
const input = JSON.parse(text), bytes = fs.readFileSync(input.wasm);
const app = fs.readFileSync(input.app, 'utf8');
const embedded = Buffer.from(app.match(/var FLIGHT_CORE_WASM = "([^"]+)"/)[1], 'base64');
if (!embedded.equals(bytes)) throw Error('Browser embedding does not match runtime artifact');
const map = JSON.parse(fs.readFileSync(input.map, 'utf8'));
const client = fs.readFileSync(input.client, 'utf8');
const start = client.indexOf('      function grid('), end = client.indexOf('      async function ensureMap(', start);
if (start < 0 || end <= start) throw Error('Production terrain sampler unavailable');
const ctx = vm.createContext({f:{map},clamp:(x,a,b)=>Math.max(a,Math.min(b,x))});
vm.runInContext(client.slice(start,end)+'\nglobalThis.sampleHeight=height;',ctx);
const landing = (x,z) => {
  const t=map.terrain;
  if(x<t.x0||z<t.z0||x>t.x0+(t.width-1)*t.cellX||z>t.z0+(t.height-1)*t.cellZ)return 0;
  return input.landing.some(a=>{
    const n=Math.hypot(...a.forward),f=a.forward.map(v=>v/n),d=[x-a.center[0],z-a.center[1]];
    return Math.abs(d[0]*f[1]-d[1]*f[0])<=a.half_width&&Math.abs(d[0]*f[0]+d[1]*f[1])<=a.half_length;
  })?1:0;
};
const cases=[];
for(const item of input.cases){
  const {instance}=await WebAssembly.instantiate(bytes,{math:{sin:Math.sin,cos:Math.cos,atan2:Math.atan2,exp:Math.exp,asin:Math.asin,acos:Math.acos},world:{ground:ctx.sampleHeight,landable:landing}});
  const a=instance.exports;
  if(a.core_version()!==215||a.state_len()!==80||a.aero_state_len()!==48||a.memory.buffer.byteLength!==131072)throw Error('Wrong module ABI');
  a.set_world(1);a.configure_airframe(...item.airframe);
  a.configure_surfaces(...item.surfaces,...item.surfaceFlags);
  if(item.gearSequence)a.configure_gear_sequence(...item.gearSequence);
  a.configure(...item.configure);a.configure_control(...item.control);a.configure_envelope(...item.envelope);
  const s=item.spawn;a.spawn(...s.position,s.heading,s.airspeed,s.on_ground?1:0);
  const state=new Float32Array(a.memory.buffer,a.state_ptr(),80),aero=new Float32Array(a.memory.buffer,a.aero_state_ptr(),48);
  const snapshots=[];
  for(const step of item.steps){
    if(step.airframe){
      a.configure_airframe(...step.airframe);
      a.configure_surfaces(...item.surfaces,...item.surfaceFlags);
      if(item.gearSequence)a.configure_gear_sequence(...item.gearSequence);
    }
    if(step.damage)a.set_damage(...step.damage);
    if(step.impulse)a.impulse(...step.impulse);
    const i=step.input;a.step(step.dt,...i.aim,i.throttle,i.pitch,i.roll,i.yaw,i.flags);
    snapshots.push({core_version:215,state:Array.from(state),aero:Array.from(aero)});
  }
  cases.push({id:item.id,snapshots});
}
console.log(JSON.stringify({core_version:215,embeddedMatches:true,wasmSha256:crypto.createHash('sha256').update(bytes).digest('hex'),cases}));
