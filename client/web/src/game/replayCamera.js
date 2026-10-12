// V3 director port, Copyright (c) 2026 Replay Lab Contributors (MIT).
// Complete source notice: docs/third-party/hit-replay-v3-LICENSE.txt.
import { lookAtLH, perspective, mul, cross, dot } from '../gfx/math.js';
import { replayDirectorPhase } from './replayClock.js';

// V3 gl.js:3–6, retained presentation easing/vector operations.
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const mix=(a,b,t)=>a+(b-a)*t;
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a));return t*t*(3-2*t);};
function normCamera(a){
  const length=Math.hypot(...a)||1;
  if(Number.isFinite(length))return a.map(x=>x/length);
  // Preserve the source calculation for normal vectors. Scale only overflowing
  // finite norms so a recorded tangent can never silently normalize to zero.
  const maximum=Math.max(...a.map(Math.abs));
  if(!Number.isFinite(maximum)||maximum===0)throw new RangeError('camera direction cannot be represented');
  const scaled=a.map(x=>x/maximum), scaledLength=Math.hypot(...scaled);
  return scaled.map(x=>x/scaledLength);
}
const V={add:(a,b)=>a.map((x,i)=>x+b[i]),sub:(a,b)=>a.map((x,i)=>x-b[i]),scale:(a,s)=>a.map(x=>x*s),cross,len:a=>Math.hypot(...a),norm:normCamera,lerp:(a,b,t)=>a.map((x,i)=>mix(x,b[i],t))};
const up=[0,1,0];
export function v3ProjectileToTank([x,y,z]) {return [-z,y,x];}
export function v3CameraOffsetToTank([x,y,z]) {return [z,y,x];}
const finite3=v=>Array.isArray(v)&&v.length===3&&Number.isFinite(v[0])&&Number.isFinite(v[1])&&Number.isFinite(v[2]);

function rectAspect(rect){
  if(!Array.isArray(rect)||rect.length!==4||!Number.isFinite(rect[0])||!Number.isFinite(rect[1])
    || !Number.isFinite(rect[2])||!Number.isFinite(rect[3])||rect[2]<=0||rect[3]<=0)throw new RangeError('camera rect must have positive finite dimensions');
  const aspect=rect[2]/rect[3], converted=Math.fround(aspect);
  if(!Number.isFinite(aspect)||aspect<=0||!Number.isFinite(converted)||converted<=0)throw new RangeError('camera rect aspect cannot be represented');
  return aspect;
}

/** V3 runtime.js:59, unchanged eye-distance formula and FOV. */
export function fitCamera(cam,rect){
  let aspect=rectAspect(rect);if(aspect<1.05)cam.eye=V.add(cam.target,V.scale(V.sub(cam.eye,cam.target),Math.min(2.55,1.13/aspect)));return cam;
}

function frozenHull(bounds){
  if(!bounds || !finite3(bounds.min) || !finite3(bounds.max) || bounds.max.some((v,i)=>v<=bounds.min[i]))throw new RangeError('frozen hull bounds must have positive finite dimensions');
  const size=V.sub(bounds.max,bounds.min), center=V.lerp(bounds.min,bounds.max,.5);
  if(!finite3(size)||!finite3(center))throw new RangeError('frozen hull bounds cannot be represented');
  // Source hull section length is 4.34 m (scene.js:29). Its director center is y=1.05.
  // These are camera calibration constants; no proxy hull or report coordinate is scaled.
  const scale=Math.max(size[2]/4.34,size[0]/1.70,size[1]/2.10);
  return {bounds,size,center,scale,radius:V.len(size)*.5};
}

function sourceSide(direction){
  // B has det=-1: B(cross(dir,up)) == -cross(B(dir),up).
  const side=V.scale(V.cross(direction,up),-1);
  return V.len(side)>1e-10?V.norm(side):[1,0,0];
}
function sourceOffset(offset,hull){return V.scale(v3CameraOffsetToTank(offset),hull.scale);}
function centerAt(hull,y){return V.add(hull.center,[0,(y-1.05)*hull.scale,0]);}

function orthonormal(right,up,forward){
  const axes=[right,up,forward], tolerance=1e-6;
  return axes.every(a=>finite3(a)&&Math.abs(dot(a,a)-1)<=tolerance)
    && Math.abs(dot(right,up))<=tolerance && Math.abs(dot(right,forward))<=tolerance && Math.abs(dot(up,forward))<=tolerance
    && Math.abs(dot(cross(right,up),forward)-1)<=tolerance;
}
function cameraBasis(eye,target){
  const forward=V.norm(V.sub(target,eye));
  // A zenith/nadir view can lose its tiny horizontal offset at a translated anchor.
  // Keep eye/target unchanged and use +Z as the roll reference when +Y is parallel.
  const viewUp=V.len(cross(up,forward))<=1e-8?[0,0,1]:up;
  const basis=lookAtLH(eye,forward,viewUp), m=basis.view;
  if(!orthonormal(basis.right,basis.up,basis.forward)
    || !orthonormal([m[0],m[4],m[8]],[m[1],m[5],m[9]],[-m[2],-m[6],-m[10]]))throw new RangeError('replay camera pose basis cannot be represented');
  return basis;
}

function inputs(physicalS,context){
  if(!context)throw new TypeError('replay camera context is required');
  const hull=frozenHull(context.hullBounds), event=context.event;
  const phase=replayDirectorPhase(event,physicalS);
  const entry=finite3(event.entry)?event.entry:hull.center;
  const direction=finite3(event.direction)&&V.len(event.direction)>1e-10?V.norm(event.direction):[0,0,1];
  const projectile=context.frame?.projectile;
  const recorded=projectile?.timing==='recorded';
  if(recorded && (!finite3(projectile.nose)||!finite3(projectile.tangent)||V.len(projectile.tangent)<=1e-10))throw new RangeError('recorded projectile nose/tangent is invalid');
  return {hull,event,phase,entry,direction,projectile,recorded};
}

function finish(cam,rect,hull,projectile,recorded,fitHull=false){
  fitCamera(cam,rect);
  if(!finite3(cam.eye)||!finite3(cam.target)||!Number.isFinite(V.len(V.sub(cam.target,cam.eye)))||V.len(V.sub(cam.target,cam.eye))<=1e-10)throw new RangeError('replay camera pose cannot be represented');
  const aspect=rectAspect(rect);
  // Static explanatory views fit the frozen hull, never the projectile/barrel broadphase.
  if(fitHull){
    const tanY=Math.tan(cam.fov*Math.PI/360), tanX=tanY*aspect;
    let away=V.sub(cam.eye,cam.target), distance=V.len(away), back=V.norm(away);
    const basis=cameraBasis(cam.eye,cam.target);
    let required=distance;
    for(const x of [hull.bounds.min[0],hull.bounds.max[0]])for(const y of [hull.bounds.min[1],hull.bounds.max[1]])for(const z of [hull.bounds.min[2],hull.bounds.max[2]]){
      const p=V.sub([x,y,z],cam.target), depthOffset=dot(p,basis.forward);
      required=Math.max(required,Math.abs(dot(p,basis.right))/(tanX*.96)-depthOffset,Math.abs(dot(p,basis.up))/(tanY*.96)-depthOffset);
    }
    if(required>distance)cam.eye=V.add(cam.target,V.scale(back,required));
  }
  const centerDistance=V.len(V.sub(cam.eye,hull.center));
  const noseDistance=recorded?V.len(V.sub(cam.eye,projectile.nose)):0;
  const margin=Math.max(hull.radius*.1,.01);
  const near=Math.max(.001,(centerDistance-hull.radius)*.1);
  const far=Math.max(near+margin,centerDistance+hull.radius+margin,noseDistance+margin);
  const basis=cameraBasis(cam.eye,cam.target);
  const proj=perspective(cam.fov*Math.PI/180,aspect,near,far);
  if(![...proj].every(Number.isFinite)||!(proj[0]>0&&proj[5]>0&&proj[11]===-1&&proj[14]<0))throw new RangeError('replay camera pose projection cannot be represented');
  const viewProj=mul(proj,basis.view);
  if(![near,far,...basis.view,...proj,...viewProj].every(Number.isFinite)||!(near>0&&far>near))throw new RangeError('replay camera pose cannot be represented');
  return {...cam,...basis,proj,viewProj,near,far,hullScale:hull.scale,
    flightTiming:recorded?'recorded':'unknown',projectileNose:recorded?projectile.nose.slice():null};
}

/** V3 runtime.js:60–78. Physical time selects easing; the nose/tangent is never generated. */
export function camera(physicalS,rect,context){
  const {hull,phase:t,entry,projectile,recorded}=inputs(physicalS,context);
  let target=centerAt(hull,1.05);
  if(context.manual){
    const {yaw,pitch,zoom}=context.manual;
    if(![yaw,pitch,zoom].every(Number.isFinite)||zoom<=0)throw new RangeError('manual camera values are invalid');
    let eye=V.add(target,sourceOffset([Math.sin(yaw)*Math.cos(pitch)*zoom,Math.sin(pitch)*zoom,Math.cos(yaw)*Math.cos(pitch)*zoom],hull));
    return finish({eye,target,fov:43},rect,hull,projectile,recorded);
  }
  // The source demo's external gameplay camera is intentionally not a replay component.
  // The visible recorded projectile leads the shot; the camera travels with it.
  const dir=recorded?V.norm(projectile.tangent):null, side=recorded?sourceSide(dir):null;
  const heavy=context.heavy===true, trailDistance=(heavy?1.1:1.9)*hull.scale;
  let pos=recorded?projectile.nose:null;
  let chase=recorded?V.add(pos,V.add(V.scale(dir,-trailDistance),V.add(V.scale(side,-.68*hull.scale),[0,.32*hull.scale,0]))):null;
  let chaseTarget=recorded?V.add(pos,V.scale(dir,1.9*hull.scale)):null;
  // Switch up and across the entry point, then settle to the source three-quarter angle.
  // Missing flight is a fixed explanatory orbit, not a fabricated approach.
  const orbitPhase=recorded?t:3.25;
  let orbitAngle=.62+smooth(2.0,5.5,orbitPhase)*.60,dist=6.15;
  let orbitEye=V.add(hull.center,sourceOffset([Math.sin(orbitAngle)*dist,3.95-1.05,Math.cos(orbitAngle)*dist],hull));
  if(context.sideEntry===true)orbitEye=V.add(hull.center,sourceOffset([5.8,3.75-1.05,4.2],hull));
  let orbitTarget=recorded?V.lerp(entry,centerAt(hull,1.10),smooth(1.68,3.25,t)):centerAt(hull,1.10);
  let cut=recorded?smooth(1.22,1.92,t):1,eye=recorded?V.lerp(chase,orbitEye,cut):orbitEye;target=recorded?V.lerp(chaseTarget,orbitTarget,cut):orbitTarget;
  // Subtle source contact bump is an easing offset, not another physical impact time.
  let age=t-1.65;if(recorded&&age>=0&&age<.11)eye=V.add(eye,[0,Math.sin(age/.11*Math.PI)*.018*hull.scale,0]);
  return finish({eye,target,fov:mix(heavy?48:43,43,cut)},rect,hull,projectile,recorded,!recorded);
}

/** V3 runtime.js:79–84, with the approved source portrait fit added to the inset. */
export function hitCamera(physicalS,rect,context){
  const {hull,phase:t,entry,direction,projectile,recorded}=inputs(physicalS,context);
  // The corner uses the same prepared frame and its own tighter camera, never damage logic.
  let target=V.lerp(entry,centerAt(hull,1.15),smooth(1.65,3.0,t));
  const side=sourceSide(direction);
  let eye=V.add(target,V.add(V.scale(direction,-4.6*hull.scale),V.add(V.scale(side,2.4*hull.scale),[0,2.45*hull.scale,0])));
  return finish({eye,target,fov:38},rect,hull,projectile,recorded);
}
