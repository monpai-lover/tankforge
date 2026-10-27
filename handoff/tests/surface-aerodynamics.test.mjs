import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {types,flight,configureSurfaces,airInfo,models} from './surface-fixture.mjs';

const outputDir=process.env.TF_TEST_ARTIFACT_DIR?path.resolve(process.env.TF_TEST_ARTIFACT_DIR):fileURLToPath(new URL('out/',import.meta.url));

test('all aircraft country labels are one character without changing type names or source attribution',()=>{
  for(const T of Object.values(types)){
    const info=airInfo(T.id);assert.equal(Array.from(info.nation).length,1,T.id);assert.equal(info.name,T.name);
  }
  assert.equal(airInfo('f86f').nation,'美');assert.equal(airInfo('mig15').nation,'苏');assert.equal(airInfo('su27').nation,'中');
});
test('the actual WASM exports finite independent-surface telemetry without changing the accepted 80-float ABI',async()=>{
  const c=await flight();assert.equal(c.api.core_version(),215);assert.equal(c.s.length,80);assert.equal(c.a.length,48);
  c.step();assert.ok(c.a.every(Number.isFinite));assert.ok(c.a[4]>0&&c.a[5]>0);
});
test('deflected surfaces generate zero aerodynamic torque without relative airflow and dynamic-pressure-scaled torque in flight',async()=>{
  const zero=await flight('nf01',{speed:0});zero.step(0,1,0,0,0);
  assert.ok(Array.from(zero.a.slice(16,22)).every(q=>Math.abs(q)<1e-5));
  const low=await flight('nf01',{speed:40}),high=await flight('nf01',{speed:160});low.step(0,1);high.step(0,1);
  assert.ok(low.a[21]<0&&high.a[21]<low.a[21]);
  assert.ok(Math.abs(high.a[21]/low.a[21]-16)<.01,'force did not scale with V squared');
});
test('ailerons change the two actual wing forces and produce adverse yaw rather than directly rotating attitude',async()=>{
  const c=await flight('nf01');c.step(0,1);
  assert.ok(c.a[4]>c.a[5],'right roll must increase left lift');
  assert.ok(c.a[21]<0,'right roll torque absent');assert.ok(c.a[20]<0,'induced-drag adverse yaw absent');
  assert.ok(c.a[8]>0&&c.s[25]>0);
});
test('rotation changes each wing local incidence and stall independently',async()=>{
  const c=await flight('nf01',{speed:100});
  for(let k=0;k<6;k++)c.api.impulse(0,-5,0,0,0,0);
  c.api.impulse(0,0,0,0,0,.45);c.step();
  assert.ok(c.a[0]>c.a[1]);assert.ok(c.a[2]>c.a[3]+.01,'both wings incorrectly share one stall state');
});
test('losing one wing removes that wing force and rolls toward the missing wing',async()=>{
  const left=await flight(),right=await flight();left.api.set_damage(1,0,1,1,1,1);right.api.set_damage(1,1,0,1,1,1);
  left.step();right.step();
  assert.equal(left.a[4],0);assert.ok(left.a[5]>0&&left.a[21]>0);
  assert.equal(right.a[5],0);assert.ok(right.a[4]>0&&right.a[21]<0);
});
test('elevator and rudder operate through tail forces and physical moments',async()=>{
  const up=await flight(),down=await flight(),rudder=await flight();up.step(1);down.step(-1);rudder.step(0,0,1);
  assert.ok(up.a[6]<down.a[6]&&up.a[19]<down.a[19]);
  assert.ok(rudder.a[7]<0&&rudder.a[20]>0);
});
test('source surface geometry is configured again after load changes and mesh travel is used by the force model',async()=>{
  const c=await flight('f86f');for(let i=0;i<30;i++)c.step(1,1);
  const configured=Array.from(c.a.slice(8,15)),angles=[c.a[8]/c.s[25],c.a[9]/c.s[24]];
  const loaded=c.T.airframe.slice();loaded[0]+=450;c.api.configure_airframe(...loaded);configureSurfaces(c.api,c.T);c.step(1,1);
  assert.ok(Math.abs(c.a[8]/c.s[25]-angles[0])<1e-6&&Math.abs(c.a[9]/c.s[24]-angles[1])<1e-6);
  assert.ok(Array.from(c.a.slice(12,15)).every((v,k)=>Math.abs(v-configured[4+k])<1e-6));
  assert.ok(c.a[12]!==.26||c.a[13]!==.12,'model-specific travel was ignored');
  assert.equal(models.f86f.spec.gearAnimation.channels,49);
});

test('all delivered aircraft retain finite protected flight and capture a 35-degree heading target',async()=>{
  const result=[];
  for(const T of Object.values(types)){
    const c=await flight(T.id,{speed:T.sound==='jet'?200:125,altitude:4000,protection:true});
    const target=[Math.sin(.61),0,Math.cos(.61)];let max=0;
    for(let k=0;k<2400;k++){
      c.api.step(1/120,...target,.78,0,0,0,1);
      assert.ok(c.s.every(Number.isFinite)&&c.a.every(Number.isFinite),`${T.id}: nonfinite flight`);
      assert.equal(c.s[22],0,`${T.id}: crashed`);max=Math.max(max,Math.abs(c.s[17]));
    }
    const dot=Math.max(-1,Math.min(1,c.s[48]*target[0]+c.s[50]*target[2]));
    const error=Math.acos(dot)*180/Math.PI;
    result.push({id:T.id,error_deg:error,peak_abs_g:max,speed_ms:c.s[13]});
    assert.ok(error<8,`${T.id}: target error ${error} degrees`);
  }
  fs.mkdirSync(outputDir,{recursive:true});
  fs.writeFileSync(path.join(outputDir,'surface-fleet.json'),JSON.stringify(result,null,2));
});

test('surface-driven instructor follows a continuously moving world aim without latching or sustained oscillation',async()=>{
  const result=[];
  for(const id of ['f86f','mig17f','a10a','f15c','f104g']){
    const c=await flight(id,{speed:220,altitude:4000,protection:true});let sum=0,max=0,n=0;
    for(let k=0;k<4800;k++){
      const t=k/120,h=.25*Math.sin(t*.32),p=.05*Math.sin(t*.2),aim=[Math.sin(h)*Math.cos(p),Math.sin(p),Math.cos(h)*Math.cos(p)];
      c.api.step(1/120,...aim,.84,0,0,0,1);
      assert.ok(c.s.every(Number.isFinite),id);assert.equal(c.s[22],0,id);
      const error=Math.acos(Math.max(-1,Math.min(1,aim.reduce((s,v,i)=>s+v*c.s[48+i],0))))*180/Math.PI;
      if(k>240){sum+=error*error;n++;max=Math.max(max,error);}
    }
    const rms=Math.sqrt(sum/n);assert.ok(rms<1&&max<2,`${id}: moving-aim error RMS ${rms}, peak ${max}`);
    result.push({id,rms_deg:rms,peak_deg:max});
  }
  fs.writeFileSync(path.join(outputDir,'moving-aim-fleet.json'),JSON.stringify(result,null,2));
});

test('all aircraft move accepted ailerons on the wheels without rolling the parked airframe',async()=>{
  for(const id of Object.keys(types)){
    const c=await flight(id,{ground:true,speed:0});
    for(const sign of [1,-1]){
      for(let k=0;k<72;k++)c.step(0,sign,0,4,0);
      assert.ok(c.s[25]*sign>.95,`${id}: parked roll command suppressed`);
      assert.ok(c.a[8]*sign>.02,`${id}: accepted aileron angle absent`);
      assert.ok(Math.abs(c.s[20])<.01,`${id}: parked airframe rolls instead of just its surfaces`);
      assert.equal(c.s[36],4,id);assert.equal(c.s[22],0,id);
    }
    for(let k=0;k<40;k++)c.step(0,0,0,4,0);
    assert.ok(Math.abs(c.s[25])<.001,`${id}: released aileron input stuck`);
  }
});
