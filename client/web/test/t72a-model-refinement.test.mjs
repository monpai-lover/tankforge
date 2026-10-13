import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {auditT72a,protectedHashes,hashFile,rayHits} from '../../../tools/t72a_geometry_audit.mjs';
import {refineT72aVisual} from '../../../tools/t72a_visual.mjs';
import {loadData} from '../tools/load-data.mjs';
import {runtimeParts,topologyStatistics,makePiece} from '../tools/procedural-fleet-audit.mjs';
import {transformPoint} from '../src/gfx/math.js';
import {materials,addPart} from '../src/gfx/tankmodel.js';
import {GeoBuilder} from '../src/gfx/geo.js';
import {pintleGun} from '../src/gfx/mgmodel.js';
import {makeLoadout,buildToBundle,exportFolder} from '../src/game/loadout.js';
const data=loadData(),visual=data.vehicles.su_t72a.visual,rt=runtimeParts('su_t72a',data);
const hash=d=>createHash('sha256').update(Buffer.from(new Float32Array(d).buffer)).digest('hex');

test('T72 model refinement never changes identity, crew, AZ, mounts, ballistics, armor or module data',()=>{
 for(const [name,expected]of Object.entries(protectedHashes))assert.equal(hashFile('data/vehicles/su_t72a/'+name),expected,name);
 assert.equal(rt.loadout.id,'su_t72a');assert.deepEqual(rt.loadout.turrets[0].pivot,[0,1.5,.18]);
 assert.deepEqual(rt.loadout.turrets[0].guns[0].trunnion,[0,1.86,1.15]);
 assert.deepEqual(rt.loadout.machineGuns.map(m=>m.id),['coax_pkt','aa_nsvt']);
 assert.deepEqual(visual.running_gear.wheels.map(w=>w.z),[2.02,1.21,.4,-.41,-1.22,-2.03]);
});
test('T72 authored geometry regenerates identically and casting topology is closed around genuine openings',()=>{
 assert.deepEqual(refineT72aVisual(visual),visual);
 assert.equal(new Set(visual.parts.map(p=>p.name)).size,visual.parts.length);
 assert.ok(rt.maxRuntimeError<1e-6);
 for(const p of rt.at()) {const t=topologyStatistics(p);assert.equal(t.boundaryEdges,0,p.part.name||p.id);assert.equal(t.degenerate,0,p.part.name||p.id);assert.equal(t.nonManifoldEdges,0,p.part.name||p.id);}
 const shell=rt.at().find(p=>p.part.name==='t72a_cast_turret');
 assert.equal(rayHits(shell,[0,1.86,1.9],[0,0,-1],.95).length,0,'front aperture is not filled with a cap');
});
test('T72 full azimuth grid keeps seat and mantlet attached, primary tubes clear of the hull and sights unobstructed',()=>{
 const a=auditT72a();assert.equal(a.poseSampling.count,144);
 assert.deepEqual(a.seatFailures,[]);assert.deepEqual(a.mantletContactFailures,[]);
 assert.deepEqual(a.unexpectedGunHullCrossings,[]);assert.deepEqual(a.boreBlocked,[]);
 assert.deepEqual(a.opticObstructions,[]);assert.ok(a.mgPostStable);
 assert.ok(a.connections.every(c=>c.touch));
});
test('T72 muzzle follows the unchanged trunnion under independent yaw, elevation and 310mm slide',()=>{
 for(const yaw of [0,.7,Math.PI,-1.8])for(const pitch of [-6,0,13])for(const recoil of [0,.5,1]) {
  rt.at({yaw,pitch:pitch*Math.PI/180,recoil});const g=rt.model.turrets[0].guns[0];
  const tip=transformPoint(g.barrel.world,[0,0,4.95]);const a=pitch*Math.PI/180,r=4.95-.31*recoil;
  const expected=[Math.sin(yaw)*(.97+r*Math.cos(a)),1.86+r*Math.sin(a),.18+Math.cos(yaw)*(.97+r*Math.cos(a))];
  assert.ok(Math.hypot(...tip.map((x,i)=>x-expected[i]))<2e-6);
 }
});
test('T72 NSVT opt-in has a genuine bore, retained bore vector, closed meshes and preserved generic default',()=>{
 const m=materials(visual.palette),a=pintleGun('nsvt',12.7,m,'nsvt_t72a'),generic=pintleGun('nsvt',12.7,m);
 assert.deepEqual(a.muzzleVector,[0,.06,1.17]);assert.deepEqual(a.muzzleVector,generic.muzzleVector);
 assert.notEqual(hash(a.geo.data),hash(generic.geo.data));
 assert.equal(rayHits(makePiece('nsvt',a.geo.data),[0,.06,1.20],[0,0,-1],1.0).length,0);
 assert.deepEqual(data.machineGuns.nsvt.damage_geometry.variants.nsvt_t72a.muzzle,a.muzzleVector);
});
test('T72 wheels, rubber/rims and sprocket teeth stay on their existing spinning nodes with unchanged track input',()=>{
 const model=rt.model,roads=model.wheels.filter(w=>w.role==='road_wheel');assert.equal(roads.length,12);assert.equal(model.sprocketFront,false);
 const initial=model.wheels.map(w=>({p:w.node.pos.slice(),hash:hash(w.node.mesh.data)}));
 model.updateRunningGear({lifts:{1:model.stations.map(()=>0),[-1]:model.stations.map(()=>0)},travel:{1:.47,[-1]:.47}});model.root.update();
 model.wheels.forEach((w,i)=>{
  assert.ok(Number.isFinite(w.node.pitch));assert.notEqual(w.node.pitch,0,w.role);
  assert.equal(hash(w.node.mesh.data),initial[i].hash,'complete wheel mesh unchanged during rotation');
  if(w.role==='road_wheel')assert.ok(Math.abs(w.node.pitch-.47/w.r)<1e-6);
 });
});
test('T72 complete stock workshop export retains scoped casting normals, NSVT variant, mount IDs and AZ',()=>{
 const build={base:'su_t72a',keepStock:true,turrets:[]};const made=buildToBundle(build,data);
 const result=exportFolder(build,data,data.vehicles.su_t72a,'t72a_review_export','T72 model review');
 const v=result.files['visual.json'],w=result.files['weapons.json'];
 assert.deepEqual(v.parts.find(p=>p.name==='t72a_cast_turret').t72a_smoothing,visual.parts.find(p=>p.name==='t72a_cast_turret').t72a_smoothing);
 assert.equal(v.mg_variants.aa_nsvt,'nsvt_t72a');assert.equal(w.mechanized_loading.capacity,22);
 const loadout=makeLoadout('t72a_review_export',made.bundle,{...data.projectiles,...made.projectiles},data.machineGuns);
 assert.deepEqual(loadout.machineGuns.map(m=>m.id),['coax_pkt','aa_nsvt']);
});
test('T72 extension cannot silently alter ordinary mesh shading',()=>{
 const p={name:'unrelated_mesh',type:'mesh',mount:'hull',mat:'paint',vertices:[[0,0,0],[1,0,0],[0,1,0]],faces:[[0,1,2]],t72a_smoothing:[1]};
 const a=new GeoBuilder(),b=new GeoBuilder(),m=materials(visual.palette);addPart(a,p,[0,0,0],m);delete p.t72a_smoothing;addPart(b,p,[0,0,0],m);assert.deepEqual(a.data,b.data);
});
