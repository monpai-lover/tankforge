import test from 'node:test';
import assert from 'node:assert/strict';
import {createAirVortex,createAirVortexPool} from '../tools/air_vortex.js';

const wing=[[.5,0,1,3],[6,.2,-1,.8]];
function sample(time=1,overrides={}) {
  return {time,life:1,position:[time*150,2000,0],matrix:[1,0,0,0,0,1,0,0,0,0,1,0,time*150,2000,0,1],
    wing,area:30,speed:150,load:4,q:11000,alpha:[.2,.2],lift:[65000,65000],wind:[3,0,0],
    humidity:.92,temperatureC:15,visible:true,...overrides};
}
test('wing tips use measured final planform trailing edges, not a span fallback',()=>{
  const f=createAirVortex();assert.deepEqual(Array.from(f.tips(wing)),[-6,.2,-1.8,6,.2,-1.8]);
  assert.equal(f.tips([]),null);
});
test('dry air, zero pressure, one-G cruise and missing telemetry do not emit condensation',()=>{
  for(const override of [{humidity:.3},{q:0},{load:1,alpha:[.025,.025]},{lift:[0,0]},{humidity:NaN}]){
    const f=createAirVortex();for(let k=0;k<30;k++)f.sample(sample(1+k/60,override));assert.equal(f.count,0);
  }
});
test('humid high-load flight emits both tip trails, a damaged wing emits none',()=>{
  const f=createAirVortex();for(let k=0;k<30;k++)f.sample(sample(1+k/60));assert.ok(f.count>10);assert.ok(f.sideCount(0)>0&&f.sideCount(1)>0);
  const d=createAirVortex();for(let k=0;k<30;k++)d.sample(sample(1+k/60,{lift:[0,65000]}));assert.equal(d.sideCount(0),0);assert.ok(d.sideCount(1)>0);
});
test('cadence is based on accepted time and repeated poses add no points',()=>{
  const a=createAirVortex(),b=createAirVortex();for(let k=0;k<=120;k++)a.sample(sample(1+k/120));for(let k=0;k<=30;k++)b.sample(sample(1+k/30));
  assert.equal(a.count,b.count);const before=a.count;for(let k=0;k<100;k++)a.sample(sample(2));assert.equal(a.count,before);
});
test('teleport, life change, crash and rewind clear historical geometry',()=>{
  const f=createAirVortex();f.sample(sample(1));f.sample(sample(1.1));assert.ok(f.count>0);
  f.sample(sample(1.2,{position:[9000,2000,0]}));assert.equal(f.count,0);
  f.sample(sample(1.3,{life:2}));assert.equal(f.count,0);
  f.sample(sample(1.4,{crashed:true}));assert.equal(f.count,0);f.sample(sample(.1));assert.equal(f.count,0);
});
test('ring arrays and draw vertices are bounded and reused over sustained flight',()=>{
  const f=createAirVortex({capacity:64,maxSegments:96}),data=f.data;
  for(let k=0;k<36000;k++)f.sample(sample(1+k/60));assert.equal(f.data,data);assert.ok(f.count<=128);
  const out=new Float32Array(96*6*9),cam={pos:[90000,2100,100]};const n=f.write(out,0,cam,601);
  assert.ok(n<=96*6);assert.ok(out.every(Number.isFinite));assert.ok(out.some(v=>v>0));
});
test('render buffer receives translucent alpha ribbons without simulation mutation',()=>{
  const f=createAirVortex();for(let k=0;k<20;k++)f.sample(sample(1+k/60));
  const before=Array.from(f.data),out=new Float32Array(20000),n=f.write(out,0,{pos:[200,2010,100]},1.32);
  assert.ok(n>0);for(let v=0;v<n;v++)assert.ok(out[v*9+8]>=0&&out[v*9+8]<.35);
  assert.deepEqual(Array.from(f.data),before);assert.equal(f.write(out,out.length/9-3,{pos:[0,0,0]},1.32),out.length/9-3);
});
function plane(){const cur=new Float32Array(80),aero=new Float32Array(48),matrix=new Float64Array([1,0,0,0,0,1,0,0,0,0,1,0,0,2000,0,1]);
  cur[1]=2000;cur[13]=150;cur[17]=4;cur[35]=2000;aero[0]=aero[1]=.2;aero[4]=aero[5]=65000;aero[15]=11000;
  return {cur,aero,type:{fighter:{spec:{wing}},airframe:[10000,30]},root:{local:matrix},damage:{dead:()=>false}};
}
test('world presentation pool covers multiple aircraft within one fixed draw budget',()=>{
  const pool=createAirVortexPool({maxAircraft:4,maxSegments:48}),planes=Array.from({length:7},plane);
  const scene={mode:'battle',time:0,airAtmosphere:{relativeHumidity:.92,temperatureC:15}};
  for(let k=0;k<30;k++){scene.time=k/60;for(const p of planes){p.cur[23]=scene.time;p.cur[0]=k*2.5;p.root.local[12]=k*2.5;pool.samplePlane(p,scene);}}
  assert.equal(pool.slots.length,4);assert.ok(pool.slots.filter(s=>s.plane).length<=4);
  const out=new Float32Array(20000),n=pool.write(out,0,{pos:[100,2100,100]},scene);assert.ok(n>0&&n<=48*6);assert.ok(out.every(Number.isFinite));
});
test('garage transition and disposal clear pooled aircraft geometry',()=>{
  const pool=createAirVortexPool(),p=plane(),scene={mode:'battle',time:0,airAtmosphere:{relativeHumidity:.92,temperatureC:15}};
  for(let k=0;k<30;k++){scene.time=p.cur[23]=k/60;p.cur[0]=k*2;pool.samplePlane(p,scene);}
  assert.ok(pool.slots.some(s=>s.flow.count>0));pool.remove(p);assert.ok(pool.slots.every(s=>s.flow.count===0));
  pool.samplePlane(p,{...scene,mode:'garage'});assert.ok(pool.slots.every(s=>s.plane===null));
});
test('invalid accepted transforms cannot publish nonfinite trail geometry',()=>{
  const f=createAirVortex();f.sample(sample(1));const invalid=sample(1.1);invalid.matrix[3]=NaN;f.sample(invalid);assert.equal(f.count,0);
});
