import test from 'node:test';
import assert from 'node:assert/strict';
import {loadData} from '../tools/load-data.mjs';
import {runtimeParts} from '../tools/procedural-fleet-audit.mjs';
import {segmentTriangle,sweepSphereTriangle,inverseAffine,ModelHitbox} from '../src/collision/meshHitbox.js';
import {transformPoint,mul,translation,rotY,rotX,scaling,sub,add,scale} from '../src/gfx/math.js';
const data=loadData(),rt=runtimeParts('su_t72a',data),hb=rt.model.hitbox;
const near=(a,b,e=2e-6)=>assert.ok(Math.hypot(...a.map((v,i)=>v-b[i]))<e,`${a} != ${b}`);
const reset=()=>{rt.model.root.pos=[0,0,0];rt.model.root.yaw=0;rt.model.body.local=null;rt.at();};

test('real hitbox captures every exterior upload without remeshing or convex filling',()=>{
 reset();assert.ok(hb);const frame=hb.frame();assert.ok(frame.entries.length>200);
 for(const [mesh,rec]of hb.capture.records){
  assert.equal(rec.bvh.positions.length,mesh.data.length/13*3);
  for(let v=0;v<mesh.data.length/13;v++)for(let k=0;k<3;k++)assert.equal(rec.bvh.positions[v*3+k],Math.fround(mesh.data[v*13+k]));
 }
 assert.equal(frame.entries.filter(e=>e.rec.instanced && /tracks$/.test(e.path)).length,rt.model.linkCount*2);
 const sourceTriangles=[...hb.capture.records.values()].reduce((n,r)=>n+r.bvh.triangleCount,0);
 assert.equal(sourceTriangles,rt.model.triangles);
});
test('triangle narrow phase includes shared edges and vertices, not a blind border strip',()=>{
 const a=[0,0,0],b=[1,0,0],c=[0,1,0],d=[1,1,0];
 for(const p of [[.5,.5,1],[0,0,1],[1,0,1],[1-1e-12,1e-12,1]]){
  const h=segmentTriangle(p,[0,0,-2],a,b,c)||segmentTriangle(p,[0,0,-2],b,d,c);assert.ok(h);assert.equal(h.t,.5);
 }
 assert.equal(segmentTriangle([1+1e-9,0,1],[0,0,-2],a,b,c),null);
 assert.equal(segmentTriangle([0,0,1],[0,0,0],a,b,c),null);
});
test('swept sphere computes actual face and edge contact rather than an inflated box hit',()=>{
 const a=[0,0,0],b=[1,0,0],c=[0,1,0];
 let h=sweepSphereTriangle([.2,.2,1],[0,0,-2],.1,a,b,c);near(h.point,[.2,.2,0]);assert.ok(Math.abs(h.t-.45)<1e-10);
 assert.equal(segmentTriangle([1.1,0,1],[0,0,-2],a,b,c),null);
 h=sweepSphereTriangle([1.1,0,1],[0,0,-2],.2,a,b,c);near(h.point,[1,0,0]);assert.ok(Math.abs(h.t-(1-Math.sqrt(.03))/2)<1e-9);
 assert.equal(sweepSphereTriangle([1.25,.9,1],[0,0,-2],.2,a,b,c),null);
 assert.ok(sweepSphereTriangle([.2,.2,.03],[0,0,0],.1,a,b,c).initialOverlap);
});
test('real muzzle hole is empty; a shell wider than the bore strikes the same annular wall',()=>{
 reset();const p=[0,1.86,6.4],q=[0,1.86,5.85];
 assert.equal(hb.querySegment(p,q).hit,null);assert.equal(hb.querySegment(p,q,{radiusM:.004}).hit,null);
 const h=hb.querySegment(p,q,{radiusM:.070}).hit;assert.ok(h);assert.match(h.partId,/barrel|muzzle/);
 assert.ok(h.point[0]**2+(h.point[1]-1.86)**2>.06**2,'contact on material, not centre of empty bore');
});
test('long high-speed segment hits the muzzle rim; no endpoint-only tunnelling',()=>{
 reset();const r=hb.querySegment([.085,1.86,66],[.085,1.86,-66]);assert.equal(r.hit.partId,'t72a_muzzle_collar');
 assert.ok(Math.abs(r.hit.point[2]-6.1)<2e-6);assert.ok(r.stats.trianglesTested<1500);
});
test('wheel gaps miss, solid wheels hit; no broadphase fallback scores empty air',()=>{
 reset();assert.equal(hb.querySegment([3,.46,1.61],[1.18,.46,1.61]).hit,null);
 const r=hb.querySegment([3,.46,2.02],[1.18,.46,2.02]);assert.equal(r.hit.role,'running_gear');assert.equal(r.hit.moduleRef,'track_r');
});
test('144 live poses retain triangle-exact muzzle location through yaw, elevation and recoil',()=>{
 reset();for(let yaw=0;yaw<360;yaw+=15)for(const pitch of [-6,0,13])for(const recoil of [0,1]){
  rt.at({yaw:yaw*Math.PI/180,pitch:pitch*Math.PI/180,recoil});
  const m=rt.model.turrets[0].guns[0].barrel.world,p=transformPoint(m,[.090,0,5.08]),q=transformPoint(m,[.090,0,4.84]);
  const r=hb.querySegment(p,q);assert.ok(r.hit,`pose ${yaw}/${pitch}/${recoil}`);assert.equal(r.hit.partId,'t72a_muzzle_collar');
  near(r.hit.point,transformPoint(m,[.090,0,4.95]));
 }reset();
});
test('independent NSVT motion follows its own mesh and leaves the post fixed',()=>{
 reset();const m=rt.model.mgs[0],post=m.post.world.slice();
 for(const yaw of [-2,.2,2.4])for(const pitch of [-.1,.65,1]){
  rt.at({mgYaw:yaw,mgPitch:pitch});near(Array.from(m.post.world),Array.from(post));
  const p=transformPoint(m.node.world,[.01,.06,1.30]),q=transformPoint(m.node.world,[.01,.06,1.05]);
  const hit=hb.querySegment(p,q,{filter:b=>b.moduleRef==='aa_nsvt'}).hit;assert.ok(hit);assert.equal(hit.role,'machine_gun');
 }reset();
});
test('physical removal is explicit; X-ray hiding does not create bullet ghosts',()=>{
 reset();let q=()=>hb.querySegment([0,1.1,4],[0,1.1,2.5]).hit;
 assert.equal(q().partId,'t72a_welded_hull');rt.model.hull.visible=false;assert.equal(q().partId,'t72a_welded_hull');rt.model.hull.visible=true;
 hb.setPartEnabled('t72a_welded_hull',false);assert.equal(q(),null);hb.setPartEnabled('t72a_welded_hull',true);assert.ok(q());
});
test('immutable hitbox frame keeps its old pose after live motion, including track instances',()=>{
 reset();const old=hb.frame(),snapshot=hb.snapshot(old);
 rt.model.root.pos=[31,2,-9];rt.model.root.yaw=.8;rt.at({yaw:.8,pitch:.1});
 assert.ok(hb.querySegment([0,1.1,4],[0,1.1,2.5],{frame:old}).hit);
 assert.equal(hb.querySegment([0,1.1,4],[0,1.1,2.5]).hit,null);
 assert.deepEqual(snapshot.entries.map(e=>e.matrix),hb.snapshot(old).entries.map(e=>e.matrix));
 const other=new ModelHitbox(rt.model.root,hb.capture);
 assert.throws(()=>other.querySegment([0,0,0],[1,0,0],{frame:old}),/owner/);
 assert.throws(()=>other.snapshot(old),/owner/);
 reset();
});
test('AABB/BVH acceleration agrees with all candidate triangle tests for seeded rays',()=>{
 reset();const f=hb.frame();let seed=7719;const rand=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};
 for(let i=0;i<160;i++){
  const a=[rand()*14-7,rand()*5-1,rand()*20-10],b=[rand()*4-2,rand()*2.8,rand()*7-3.5];
  const opts={frame:f,all:true,radiusM:i<16?.04:0},a1=hb.querySegment(a,b,opts),b1=hb.querySegment(a,b,{...opts,bruteForce:true});
  assert.equal(a1.hits.length,b1.hits.length,`ray ${i}`);
  for(let j=0;j<a1.hits.length;j++){assert.equal(a1.hits[j].partId,b1.hits[j].partId);near(a1.hits[j].point,b1.hits[j].point);}
 }
});
test('full affine transforms retain surface location and reject invalid geometry inputs',()=>{
 const m=mul(translation(8,2,-6),mul(rotY(.6),mul(rotX(.3),scaling(2,.7,1.1)))),inv=inverseAffine(m);
 near(transformPoint(inv,transformPoint(m,[.8,-.9,.3])),[.8,-.9,.3]);
 assert.throws(()=>inverseAffine(scaling(0,1,1)));assert.throws(()=>hb.querySegment([NaN,0,0],[1,0,0]));assert.throws(()=>hb.querySegment([0,0,0],[1,0,0],{radiusM:-1}));
 assert.equal(hb.querySegment([0,0,0],[0,0,0]).hit,null);
});
test('contact classification never assigns hull armour to rubber, cloth, lamps or tow eyes',()=>{
 reset();const g=hb.querySegment([0,1.1,4],[0,1.1,2.5]).hit;assert.equal(g.armorRef,'hull_glacis');
 for(const [a,b,name]of [[[3,.98,1.9],[1.75,.98,1.9],'rubber_skirt'],[[.91,1.325,3],[.91,1.325,2.70],'headlamp']]){
  const h=hb.querySegment(a,b).hit;assert.ok(h);assert.match(h.partId,new RegExp(name));assert.equal(h.armorRef,null);
 }
});

test('custom semantic armour mapping preserves explicit values and null without replacing geometric evidence',()=>{
 reset();const p=[0,1.1,4],q=[0,1.1,2.5],original=hb.querySegment(p,q).hit;
 for(const armorRef of ['registered_plate',null]){
  const mapped=new ModelHitbox(rt.model.root,hb.capture,{binding:()=>({partId:'registered_hull',role:'armor_surface',armorRef,armorSurface:null,
   point:[999,999,999],center:[999,999,999],normal:[1,0,0],faceNormal:[1,0,0],barycentric:[999,999,999],t:-1,distance:-1,initialOverlap:true,geometryVersion:'semantic_only',
   triangleId:-1,partTriangleId:-1,meshId:'semantic_only',entryId:'semantic_only',nodePath:'semantic_only',instanceId:999})});
  const hit=mapped.querySegment(p,q).hit;assert.ok(hit);assert.equal(hit.armorRef,armorRef);assert.equal(hit.armorSurface,null);assert.equal(hit.partId,'registered_hull');
  for(const key of ['point','center','normal','faceNormal','barycentric','t','distance','initialOverlap','geometryVersion','triangleId','partTriangleId','meshId','entryId','nodePath','instanceId'])assert.deepEqual(hit[key],original[key],key);
 }
 const missing=new ModelHitbox(rt.model.root,hb.capture,{binding:()=>({partId:'registered_hull',armorRef:undefined})}).querySegment(p,q).hit;
 assert.equal(missing.armorRef,'hull_glacis');assert.equal(missing.armorSurface,'outer');
});

test('contact filters observe resolved armour labels including custom mappings and explicit null',()=>{
 reset();const p=[0,1.1,4],q=[0,1.1,2.5];
 const hit=hb.querySegment(p,q,{filter:b=>b.armorRef==='hull_glacis'&&b.armorSurface==='outer'}).hit;
 assert.ok(hit);assert.equal(hit.armorRef,'hull_glacis');
 assert.equal(hb.querySegment(p,q,{filter:b=>b.armorRef==='turret_front'}).hit,null);
 for(const armorRef of ['registered_plate',null]){
  const mapped=new ModelHitbox(rt.model.root,hb.capture,{binding:()=>({partId:'registered_hull',armorRef,armorSurface:null})});
  const result=mapped.querySegment(p,q,{filter:b=>b.armorRef===armorRef&&b.armorSurface===null}).hit;
  assert.ok(result);assert.equal(result.armorRef,armorRef);
 }
});
