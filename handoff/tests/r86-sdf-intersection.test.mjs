import test from 'node:test';
import assert from 'node:assert/strict';

let api={};
try{api=await import('../tools/r86_sdf_intersection.mjs');}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;}
function march(...args){assert.equal(typeof api.marchSdf,'function','Original standalone SDF diagnostic is required');return api.marchSdf(...args);}
const sphere=(center,radius)=>p=>Math.hypot(...p.map((v,k)=>v-center[k]))-radius;
const close=(a,b,eps=.011)=>assert.ok(Math.abs(a-b)<=eps,`${a} differs from ${b}`);

test('near1 sees the foreground that a near3 start already skipped',()=>{
 const field=sphere([0,0,2],.2),hit=march(field,[0,0,0],[0,0,1],{safety:1});
 assert.equal(hit.hit,true);close(hit.t,1.8);assert.equal(hit.reason,'hit');close(hit.point[2],1.8);
 const clipped=march(field,[0,0,0],[0,0,1],{near:3,far:10,safety:1});assert.equal(clipped.hit,false);assert.equal(clipped.reason,'far');assert.equal(clipped.point,null);
});
test('near1 is an explicit clip choice and does not magically include surfaces before1',()=>{
 const field=sphere([0,0,.4],.1);
 assert.equal(march(field,[0,0,0],[0,0,1],{far:3}).hit,false);
 const hit=march(field,[0,0,0],[0,0,1],{near:0,far:3,safety:1});assert.equal(hit.hit,true);close(hit.t,.3);
});
test('negative distance far inside is not a hit and forward absolute steps reach the exit',()=>{
 const sampled=[],field=sphere([0,0,0],2);
 const r=march(p=>{sampled.push(p[2]);return field(p);},[0,0,0],[0,0,1],{near:0,far:5,safety:1});
 assert.equal(r.hit,true);assert.equal(r.startedInside,true);close(r.t,2);assert.equal(r.steps,2);
 assert.ok(sampled.every((t,i)=>t>=0&&(!i||t>=sampled[i-1])),'inside tracing must never walk backward');
});
test('a near plane already inside a solid finds its forward exit',()=>{
 const r=march(sphere([0,0,0],2),[0,0,0],[0,0,1],{far:5,safety:1});assert.equal(r.hit,true);assert.equal(r.startedInside,true);close(r.t,2);
});
test('small negative residual is accepted only within the absolute tolerance',()=>{
 const r=march(sphere([0,0,0],2),[0,0,0],[0,0,1],{near:1.995,far:5});assert.equal(r.hit,true);assert.equal(r.steps,1);assert.ok(r.distance<0&&Math.abs(r.distance)<=.01);
});
test('direction is normalized so near far and returned t are physical ray distance',()=>{
 const r=march(sphere([0,0,3],1),[0,0,0],[0,0,7],{near:0,far:5,safety:1});assert.equal(r.hit,true);close(r.t,2);close(r.point[2],2);
});

for(const magnitude of[Number.MIN_VALUE,1e-320,Number.MAX_VALUE])test('extreme finite direction '+magnitude+' retains a unit ray and the first entry',()=>{
 const c=3/Math.sqrt(2),r=march(sphere([c,c,0],1),[0,0,0],[magnitude,magnitude,0],{near:0,far:5,safety:1});
 assert.equal(r.hit,true);close(r.t,2,1e-10);close(Math.hypot(...r.point),2,1e-10);
});
test('a valid declared Lipschitz bound prevents an inflated field from skipping the surface',()=>{
 const sdf=sphere([0,0,3],.5),field=p=>5*sdf(p);
 const r=march(field,[0,0,0],[0,0,1],{near:1,far:10,lipschitz:5,safety:1});assert.equal(r.hit,true);close(r.t,2.5);
 assert.equal(march(field,[0,0,0],[0,0,1],{near:1,far:10,lipschitz:1,safety:1}).hit,false,'understating the bound is not repaired by an absolute hit test');
});
test('far endpoint is sampled and may be an actual hit',()=>{
 const r=march(sphere([0,0,5],1),[0,0,0],[0,0,1],{near:0,far:4,safety:1});assert.equal(r.hit,true);assert.equal(r.t,4);
});
test('a miss returns no intersection point and cannot exceed far',()=>{
 const samples=[],r=march(p=>{samples.push(p[2]);return 1;},[0,0,0],[0,0,1],{near:1,far:4,safety:1});
 assert.equal(r.hit,false);assert.equal(r.reason,'far');assert.equal(r.point,null);assert.equal(r.t,4);assert.deepEqual(samples,[1,2,3,4]);assert.equal(r.steps,4);
});
test('step budget reports the last sampled parameter without fabricating a final hit',()=>{
 let calls=0;const r=march(()=>{calls++;return .1;},[0,0,0],[0,0,1],{near:0,far:100,maxSteps:3,safety:1});
 assert.equal(r.hit,false);assert.equal(r.reason,'step_limit');assert.equal(r.point,null);assert.equal(r.steps,3);assert.equal(calls,3);close(r.t,.2,1e-12);
});
for(const value of[NaN,Infinity,-Infinity,'1'])test('nonfinite or nonnumeric field '+String(value)+' stops immediately',()=>{
 let calls=0;const r=march(()=>{calls++;return value;},[0,0,0],[0,0,1]);assert.equal(r.hit,false);assert.equal(r.reason,'non_finite_distance');assert.equal(r.point,null);assert.equal(r.steps,1);assert.equal(calls,1);assert.ok(Number.isFinite(r.t));
});
test('overflowing sample positions do not reach the field callback',()=>{
 let calls=0;const r=march(()=>{calls++;return 1;},[1e308,0,0],[1,0,0],{near:1e308,far:1.1e308});
 assert.equal(r.hit,false);assert.equal(r.reason,'non_finite_position');assert.equal(r.point,null);assert.equal(r.steps,0);assert.equal(calls,0);
});
test('floating point stagnation has an explicit exit instead of repeating until the cap',()=>{
 const r=march(()=>1e-10,[0,0,0],[0,0,1],{near:1e16,far:1e16+100,epsilon:1e-12});assert.equal(r.hit,false);assert.equal(r.reason,'stalled');assert.equal(r.point,null);assert.equal(r.steps,1);
});
test('a zero length interval is sampled once and distinguishes contact from miss',()=>{
 const hit=march(p=>p[2]-1,[0,0,0],[0,0,1],{near:1,far:1});assert.equal(hit.hit,true);assert.equal(hit.steps,1);
 const miss=march(()=>1,[0,0,0],[0,0,1],{near:1,far:1});assert.equal(miss.hit,false);assert.equal(miss.reason,'far');assert.equal(miss.steps,1);
});
test('caller vectors and options are not mutated; typed vectors work',()=>{
 const origin=Object.freeze([0,0,0]),direction=new Float64Array([0,0,2]),options=Object.freeze({near:0,far:5,safety:1});
 const r=march(sphere([0,0,3],1),origin,direction,options);assert.equal(r.hit,true);assert.deepEqual(origin,[0,0,0]);assert.deepEqual([...direction],[0,0,2]);assert.deepEqual(options,{near:0,far:5,safety:1});
});
test('invalid ray and bound configurations fail before any sampling',()=>{
 for(const args of[
  [null,[0,0,0],[0,0,1]], [()=>1,[0,0],[0,0,1]], [()=>1,[NaN,0,0],[0,0,1]], [()=>1,[0,0,0],[0,0,0]],
  ...[{near:-1},{far:0},{near:2,far:1},{epsilon:0},{epsilon:NaN},{safety:0},{safety:1.01},{lipschitz:0},{maxSteps:0},{maxSteps:Infinity},{maxSteps:1.5},{maxSteps:65537}].map(options=>[()=>{throw Error('invalid inputs reached field');},[0,0,0],[0,0,1],options])
 ])assert.throws(()=>march(...args),/ray|field|near|far|epsilon|safety|lipschitz|maxSteps/i);
});
