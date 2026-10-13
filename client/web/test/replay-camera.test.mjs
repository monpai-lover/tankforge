import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { camera, hitCamera, fitCamera, v3CameraOffsetToTank, v3ProjectileToTank } from '../src/game/replayCamera.js';
import { transfer, directorKnots } from '../src/game/replayClock.js';
import { cross, dot, sub, transformPoint, project } from '../src/gfx/math.js';

const B = v3CameraOffsetToTank;
const entry = [-.42,1.18,.87], norm = a => a.map(v => v/Math.hypot(...a)), direction = norm([-.035,-.055,-1]);
const close = (a,b,tol=1e-10) => a.forEach((v,i) => assert.ok(Math.abs(v-b[i]) < tol, `${a} != ${b}`));
const rect = [0,0,1280,800];
// Unit framing calibration for the source camera's 1.05 m center and 4.34 m hull length.
// This is a bounds-only math fixture: no substitute vehicle is created or rendered.
const unitBounds = {min:[-.85,0,-2.17],max:[.85,2.1,2.17]};
const canonicalEvent = () => ({launch_s:0,contact_s:1.65,mechanism_anchors:[{time_s:7.4,phase_s:7.4}],entry:B(entry),direction:B(direction)});
function fixture(t, heavy=false) {
  // The source's fixed 14 m approach is restricted to this independent SOURCE fixture.
  const nose = entry.map((v,i) => v + direction[i]*(-14*(1-Math.max(0,Math.min(1,t/1.65)))));
  return { event:canonicalEvent(), frame:{projectile:{nose:B(nose),tangent:B(direction),timing:'recorded'}}, hullBounds:unitBounds, heavy };
}
const reference = process.env.V3_REPLAY_REFERENCE_ROOT || 'C:/Users/24908/.codex/scratch/tankforge-hit-replay-v3-reference-20261011/hit_replay_webgl_wasm_v3';
function sourceOracle() {
  const runtime = fs.readFileSync(path.join(reference,'src/runtime.js'),'utf8');
  const gl = fs.readFileSync(path.join(reference,'src/gl.js'),'utf8');
  const helpers = gl.slice(gl.indexOf('const clamp='),gl.indexOf('const M='));
  const director = runtime.slice(runtime.indexOf(' const directorKnots='),runtime.indexOf(' function bodyNodesAt('));
  const context = vm.createContext({event:{entry,direction},state:{type:0,scenario:0,manual:false,mode:'dual'},lastDamageTimes:[]});
  vm.runInContext(`${helpers}\n${director}\nglobalThis.oracle={camera,hitCamera,fitCamera,transfer};`,context);
  return context;
}

test('canonical SOURCE HE/APHE numerical fixtures retain the supplied full camera functions', () => {
  const he = camera(.65,rect,fixture(.65,true)), aphe = camera(2.74,rect,fixture(2.74));
  close(B(he.eye),[-.764825,2.026050,10.458331],1e-5);
  close(B(he.target),[-.190018,1.541400,7.440900],1e-5);
  assert.equal(he.fov,48);
  close(B(aphe.eye),[3.910538,3.95,4.746598],1e-5);
  close(B(aphe.target),[-.104164,1.119841,.215768],1e-5);
  assert.equal(aphe.fov,43);
  assert.equal(hitCamera(2.74,rect,fixture(2.74)).fov,38);
});

test('independent exact V3 runtime oracle agrees before offset/basis adaptation', {skip:!fs.existsSync(path.join(reference,'src/runtime.js'))}, () => {
  const oracle = sourceOracle();
  for (const reverse of [false,true]) for(const x of [-1,0,.65,1.65,1.8,2.74,5.5,7.4,9.6,12]) assert.equal(transfer(directorKnots,x,reverse),oracle.oracle.transfer(x,reverse));
  for (const heavy of [false,true]) for (const t of [0,.65,1.22,1.65,1.7,1.92,2.74,5.5,7.4]) {
    oracle.state.type = heavy ? 3 : 0;
    for (const r of [rect,[0,0,400,800]]) {
      const expected = oracle.oracle.camera(t,r), actual = camera(t,r,fixture(t,heavy));
      close(actual.eye,B(Array.from(expected.eye)),1e-9);
      close(actual.target,B(Array.from(expected.target)),1e-9);
      assert.equal(actual.fov,expected.fov);
    }
    const expectedInset = oracle.oracle.hitCamera(t,rect), actualInset = hitCamera(t,rect,fixture(t,heavy));
    close(actualInset.eye,B(Array.from(expectedInset.eye)),1e-9);
    close(actualInset.target,B(Array.from(expectedInset.target)),1e-9);
  }
});

test('complete source manual and side-entry camera branches survive the pure port', {skip:!fs.existsSync(path.join(reference,'src/runtime.js'))}, () => {
  const oracle=sourceOracle();
  oracle.state.manual=true;
  Object.assign(oracle.state,{yaw:.73,pitch:.46,zoom:7.4});
  const manual={yaw:.73,pitch:.46,zoom:7.4};
  for(const r of [rect,[0,0,400,800]]){
    const expected=oracle.oracle.camera(.65,r), actual=camera(.65,r,{...fixture(.65),manual});
    close(actual.eye,B(Array.from(expected.eye)),1e-9);
    close(actual.target,B(Array.from(expected.target)),1e-9);
    assert.equal(actual.fov,expected.fov);
  }
  oracle.state.manual=false;oracle.state.scenario=1;
  const expected=oracle.oracle.camera(2.74,rect), actual=camera(2.74,rect,{...fixture(2.74),sideEntry:true});
  close(actual.eye,B(Array.from(expected.eye)),1e-9);
  close(actual.target,B(Array.from(expected.target)),1e-9);
});

test('portrait uses exact source fit factor while keeping full and corner FOV', () => {
  for (const fn of [camera,hitCamera]) {
    const wide = fn(2.74,rect,fixture(2.74)), portrait = fn(2.74,[0,0,400,800],fixture(2.74));
    close(portrait.target,wide.target);
    close(sub(portrait.eye,portrait.target),sub(wide.eye,wide.target).map(v=>v*2.26));
    assert.equal(portrait.fov,wide.fov);
  }
  const cam = {eye:[1,2,3],target:[0,0,0],fov:38};
  assert.equal(fitCamera(cam,[0,0,1050,1000]),cam);
  close(cam.eye,[1,2,3]);
});

test('proper projectile rotation preserves cross products while camera reflection reverses them', () => {
  const ex=[1,0,0],ey=[0,1,0],ez=[0,0,1],R=v3ProjectileToTank;
  close(cross(R(ex),R(ey)),R(ez));
  assert.equal(dot(cross(R(ex),R(ey)),R(ez)),1);
  close(cross(B(ex),B(ey)),B(ez).map(v=>-v));
  assert.equal(dot(cross(B(ex),B(ey)),B(ez)),-1);
});

test('production recorded nose/contact anchors bypass B/R for cross-axis and opposite entries', () => {
  for (const tangent of [[1,0,0],[-1,0,0],[0,0,1],[0,0,-1],norm([1,.2,-1])]) {
    const nose=[21,4,-13], impact=[22,3,-9];
    const context={event:{launch_s:100,contact_s:101,entry:impact,direction:tangent},frame:{projectile:{nose,tangent,timing:'recorded'}},hullBounds:{min:[20,1,-12],max:[24,4,-6]}};
    const cam=camera(100,rect,context);
    close(cam.target,nose.map((v,i)=>v+tangent[i]*1.9*cam.hullScale));
    close(cam.projectileNose,nose);
    assert.equal(cam.flightTiming,'recorded');
    close(context.event.entry,impact);
    close(context.frame.projectile.nose,nose);
    const viewEye=transformPoint(cam.view,cam.eye);
    close(viewEye,[0,0,0],1e-4);
    const looked=transformPoint(cam.view,cam.target);
    assert.ok(looked[2]<0);
    const offset=[300,-17,-40];
    const shifted={...context,event:{...context.event,entry:impact.map((v,i)=>v+offset[i])},frame:{projectile:{...context.frame.projectile,nose:nose.map((v,i)=>v+offset[i])}},hullBounds:{min:context.hullBounds.min.map((v,i)=>v+offset[i]),max:context.hullBounds.max.map((v,i)=>v+offset[i])}};
    const translated=camera(100,rect,shifted);
    close(translated.eye,cam.eye.map((v,i)=>v+offset[i]));
    close(translated.target,cam.target.map((v,i)=>v+offset[i]));
    close([translated.near,translated.far],[cam.near,cam.far]);
  }
});

test('different frozen hulls derive finite clipping/framing without barrel overhang', () => {
  for (const hullBounds of [{min:[-1,0,-2],max:[1,2,2]},{min:[-4,-2,-10],max:[4,6,10]},{min:[8,1,-3],max:[20,3,1]}]) for (const r of [rect,[0,0,600,900],[0,0,1500,400]]) {
    const context={event:{launch_s:0,contact_s:1,entry:[10,2,0],direction:[1,0,0]},hullBounds,barrelBounds:{min:[-999,-999,-999],max:[999,999,999]}};
    const cam=camera(5,r,context);
    assert.equal(cam.flightTiming,'unknown');
    assert.ok([...cam.eye,...cam.target,...cam.view,...cam.viewProj,cam.near,cam.far].every(Number.isFinite));
    assert.ok(cam.near>0 && cam.far>cam.near);
    for (const x of [hullBounds.min[0],hullBounds.max[0]]) for (const y of [hullBounds.min[1],hullBounds.max[1]]) for (const z of [hullBounds.min[2],hullBounds.max[2]]) {
      const p=project(cam.viewProj,[x,y,z]);
      assert.ok(p[2]>cam.near && p[2]<cam.far && Math.abs(p[0])<=1 && Math.abs(p[1])<=1, `frozen hull corner must fit: ${p}`);
    }
    const ordinary=camera(5,r,{...context,purpose:'ordinary'});
    close(ordinary.eye,cam.eye);
  }
});

test('unknown flight stays static; invalid bounds/rect/recorded vectors cannot yield an invalid pose', () => {
  const context={event:{launch_s:0,contact_s:1,entry:[0,1,0],direction:[0,1,0]},hullBounds:unitBounds};
  close(camera(0,rect,context).eye,camera(100,rect,context).eye);
  assert.equal(camera(.5,rect,{...context,frame:{projectile:{nose:[0,1,-10],tangent:[0,0,1],timing:'unknown'}}}).flightTiming,'unknown');
  assert.throws(()=>camera(0,[0,0,0,1],context),/rect/);
  assert.throws(()=>camera(0,rect,{...context,hullBounds:{min:[0,0,0],max:[NaN,1,1]}}),/bounds/);
  assert.throws(()=>camera(0,rect,{...context,frame:{projectile:{nose:[NaN,1,0],tangent:[0,0,1],timing:'recorded'}}}),/projectile/);
  const vertical=hitCamera(1,rect,context);
  assert.ok([...vertical.eye,...vertical.view].every(Number.isFinite));
});

test('finite but unrepresentable hull/camera inputs are rejected rather than returning NaN/Infinity', () => {
  const context={event:{launch_s:0,contact_s:1,entry:[0,1,0],direction:[0,0,1]},hullBounds:unitBounds};
  assert.throws(()=>camera(0,rect,{...context,hullBounds:{min:[-Number.MAX_VALUE,0,-1],max:[Number.MAX_VALUE,1,1]}}),/bounds|pose/);
  assert.throws(()=>camera(0,rect,{...context,manual:{yaw:.3,pitch:.2,zoom:Number.MAX_VALUE}}),/pose/);
  assert.throws(()=>camera(0,rect,{...context,hullBounds:{min:[1e39,0,-1],max:[1e39+1e30,1,1]}}),/pose/);
});

function validBasis(cam) {
  for(const b of [cam.right,cam.up,cam.forward]){assert.ok(b.every(Number.isFinite));close([dot(b,b)],[1],1e-6);}
  close([dot(cam.right,cam.up),dot(cam.right,cam.forward),dot(cam.up,cam.forward)],[0,0,0],1e-6);
  close([dot(cross(cam.right,cam.up),cam.forward)],[1],1e-6);
  const right=[cam.view[0],cam.view[4],cam.view[8]], up=[cam.view[1],cam.view[5],cam.view[9]], forward=[-cam.view[2],-cam.view[6],-cam.view[10]];
  for(const b of [right,up,forward])close([dot(b,b)],[1],1e-6);
  close([dot(cross(right,up),forward)],[1],1e-6);
  assert.ok([...cam.view,...cam.proj,...cam.viewProj].every(Number.isFinite));
  assert.ok(cam.proj[0]>0&&cam.proj[5]>0&&cam.proj[14]<0,'Float32 perspective cannot collapse any scale');
}
function translatedContext(origin=100) {
  return {event:{launch_s:0,contact_s:1,entry:[origin,0,origin],direction:[0,0,1]},hullBounds:{min:[origin-1,-1,origin-2],max:[origin+1,1,origin+2]}};
}

test('translated zenith/nadir manual views retain an orthonormal noncollapsed Float32 LH basis', () => {
  for(const origin of [0,100,1e6])for(const pitch of [Math.PI/2,-Math.PI/2,Math.PI/2-.01,-Math.PI/2+.01]){
    const context={...translatedContext(origin),manual:{yaw:0,pitch,zoom:7.4}};
    const before=structuredClone(context), cam=camera(0,rect,context);
    validBasis(cam);
    close(cam.target,[origin,0,origin]);
    assert.equal(cam.fov,43);
    assert.deepEqual(context,before);
  }
});

test('overflowing finite recorded tangent norms preserve actual chase and inset direction', () => {
  for(const [tangent,expected] of [[[Number.MAX_VALUE,Number.MAX_VALUE,0],norm([1,1,0])],[[-Number.MAX_VALUE,Number.MAX_VALUE,0],norm([-1,1,0])],[[Number.MAX_VALUE,Number.MAX_VALUE,Number.MAX_VALUE],norm([1,1,1])],[[Number.MAX_VALUE,Number.MAX_VALUE/2,-Number.MAX_VALUE/4],norm([1,.5,-.25])]]){
    for(const origin of [100,1e6]){
      const context=translatedContext(origin), nose=[origin,0,origin];
      context.event.direction=tangent;
      context.frame={projectile:{nose,tangent,timing:'recorded'}};
      const before=structuredClone(context), cam=camera(0,rect,context);
      close(cam.target,nose.map((v,i)=>v+expected[i]*1.9*cam.hullScale),1e-9);
      validBasis(cam);
      assert.equal(cam.flightTiming,'recorded');
      close(cam.projectileNose,nose);
      const control={...context,event:{...context.event,direction:expected},frame:{projectile:{nose,tangent:expected,timing:'recorded'}}};
      close(cam.eye,camera(0,rect,control).eye,1e-9);
      close(hitCamera(0,rect,context).eye,hitCamera(0,rect,control).eye,1e-9);
      validBasis(hitCamera(0,rect,context));
      assert.deepEqual(context,before);
    }
  }
});

test('unrepresentable finite viewport aspects reject before publishing collapsed projections', () => {
  const context=translatedContext(1e6);
  for(const r of [[0,0,Number.MAX_VALUE,Number.MIN_VALUE],[0,0,Number.MIN_VALUE,Number.MAX_VALUE],[0,0,1e300,1],[0,0,1,1e300]]){
    for(const fn of [camera,hitCamera])assert.throws(()=>fn(0,r,context),/rect|aspect|projection/);
    assert.throws(()=>fitCamera({eye:[1,2,3],target:[0,0,0],fov:38},r),/rect|aspect|projection/);
  }
  for(const r of [rect,[0,0,600,900],[0,0,1e300,1e300],[0,0,1e-300,1e-300]])for(const fn of [camera,hitCamera])validBasis(fn(0,r,context));
});

test('sparse required vector coordinates reject uniformly before full/manual/inset publication', () => {
  const context={event:{launch_s:0,contact_s:1,entry:[0,1,0],direction:[0,0,1]},hullBounds:{min:[-1,0,-2],max:[1,2,2]},frame:{projectile:{nose:[0,1,-3],tangent:[0,0,1],timing:'recorded'}}};
  const views=[c=>camera(0,rect,c),c=>camera(0,rect,{...c,manual:{yaw:.7,pitch:.4,zoom:7}}),c=>hitCamera(0,rect,c)];
  for(const group of ['projectile','hull'])for(const field of group==='projectile'?['nose','tangent']:['min','max'])for(let index=0;index<3;index++)for(const fn of views){
    for(const sparse of [true,false]){
      const malformed=structuredClone(context), vector=group==='projectile'?malformed.frame.projectile[field]:malformed.hullBounds[field];
      if(sparse)delete vector[index];else vector[index]=undefined;
      const before=structuredClone(malformed);
      assert.throws(()=>fn(malformed),RangeError,`${group}.${field}[${index}] must reject for every view`);
      assert.deepEqual(malformed,before);
    }
  }
  for(const fn of views){const before=structuredClone(context),cam=fn(context);validBasis(cam);assert.equal(cam.flightTiming,'recorded');assert.deepEqual(context,before);}
});

test('sparse and explicit undefined rect coordinates reject before fit or pose mutation', () => {
  const context=translatedContext(100);
  const views=[r=>camera(0,r,context),r=>camera(0,r,{...context,manual:{yaw:.7,pitch:.4,zoom:7}}),r=>hitCamera(0,r,context)];
  for(const baseRect of [rect,[0,0,400,800]])for(let index=0;index<4;index++)for(const sparse of [true,false]){
    const malformed=baseRect.slice();if(sparse)delete malformed[index];else malformed[index]=undefined;
    const beforeRect=structuredClone(malformed),beforeContext=structuredClone(context);
    for(const fn of views){assert.throws(()=>fn(malformed),RangeError,`rect[${index}] must reject for every view`);assert.deepEqual(context,beforeContext);assert.deepEqual(malformed,beforeRect);}
    const pose={eye:[1,2,3],target:[0,0,0],fov:38},beforePose=structuredClone(pose);
    assert.throws(()=>fitCamera(pose,malformed),RangeError);
    assert.deepEqual(pose,beforePose);assert.deepEqual(malformed,beforeRect);
  }
  for(const r of [rect,[0,0,400,800],[0,0,1050,1000]])for(const fn of views)validBasis(fn(r));
});
