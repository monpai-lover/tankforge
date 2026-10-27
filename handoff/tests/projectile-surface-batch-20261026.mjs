import {patchProjectileSurfaceBatch} from '../tools/patch_projectile_surface_batch.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadData} from '../../client/web/tools/load-data.mjs';
import {rendererSink} from '../../client/web/tools/hit-mesh-capture.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url)),read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const app=path.join(root,'handoff/bundle/app.js.html'),patch=path.join(root,'handoff/tools/patch_foldable_surface_packets.py');
const ids=['de_flakpz38t','de_rso_pak40'],packets=read('handoff/qa/foldable-surface-packets-20261026.json');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'tf-foldable-surface-'));
let source;
try{
  if(process.env.TG_FOLDABLE_UNPATCHED==='1')source=fs.readFileSync(app,'utf8');
  else{const output=path.join(temp,'candidate.html'),r=spawnSync(process.env.TF_TEST_PYTHON||(process.platform==='win32'?'python':'python3'),[patch,'--input',app,'--output',output],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);source=fs.readFileSync(output,'utf8');if(process.env.TF_MIRROR_BOUNDS_BASELINE!=='1'){const ready=path.join(temp,'ready.html'),rr=spawnSync(process.env.TF_TEST_PYTHON||(process.platform==='win32'?'python':'python3'),[path.join(root,'handoff/tools/patch_surface_collision_readiness.py'),'--input',output,'--output',ready],{encoding:'utf8'});assert.equal(rr.status,0,rr.stderr);source=fs.readFileSync(ready,'utf8');}}
}finally{assert.equal(path.dirname(path.resolve(temp)),path.resolve(os.tmpdir()));assert.match(path.basename(temp),/^tf-foldable-surface-/);fs.rmSync(temp,{recursive:true,force:true});}
if(process.env.TF_PROJECTILE_BATCH_BASELINE!=='1')source=patchProjectileSurfaceBatch(source);source=source.replace(/^<script>/,'');const end=source.indexOf('  // client/web/src/main.js');assert.ok(end>0);
const context=vm.createContext({console,atob,btoa,TextEncoder,TextDecoder,performance,Float32Array,Float64Array,Uint32Array,Uint8Array,Uint16Array,Int32Array,Int16Array,Int8Array,ArrayBuffer,DataView,Map,Set,WeakMap,WeakSet,structuredClone});
vm.runInContext(source.slice(0,end)+'globalThis.actual={damageVisualsFor,Enemy,buildTank,buildInterior,makeLoadout,generatedTurretParts,setCrewModel,setMgModels,Renderer,LocalSurfaceCombat,Combat,DesignCore,targetDef,surfaceCollisionQuery,batch:typeof TFProjectileSurfaceBatch==="object"?TFProjectileSurfaceBatch:null,install:typeof installReviewedFoldableSurfacePackets===\"function\"?installReviewedFoldableSurfacePackets:null};})();',context);
const actual=context.actual,data=loadData(),stock=read('handoff/tests/fixtures/foldable-surface-stock-vehicles-20261026.json');for(const id of ids)data.vehicles[id].vehicle=stock.vehicles[id];data.surfaceCatalog={};Object.assign(data.surfaceCatalog,packets);actual.install?.(data);
actual.setCrewModel(read('client/web/assets/crew_model.json'));actual.setMgModels(read('client/web/assets/mg_models.json'));
const wasm=fs.readFileSync(path.join(root,'target/wasm32-unknown-unknown/release/tg_design_wasm.wasm'));
const normalize=value=>JSON.parse(JSON.stringify(value));
const body=()=>({ex:[1,0,0],ey:[0,1,0],ez:[0,0,1],origin:()=>[0,0,0],localPoint:p=>p.slice(),worldPoint:p=>p.slice()});
function suite(){
  const core=new actual.DesignCore(new WebAssembly.Instance(new WebAssembly.Module(wasm),{}),{materials:data.materials,catalog:data.designCatalog,terrains:Object.values(data.terrains)}),combat=new actual.Combat(core,data.machineGuns),sink=rendererSink(),renderer=Object.assign(Object.create(actual.Renderer.prototype),{gl:sink.gl,_live:new Set(),_texSrc:new Map(),lost:false}),actors=[];
  combat.setSurfaceCatalog(data.surfaceCatalog,renderer);
  return{core,combat,renderer,actors,create(id,fold=0,key=id,source=data.vehicles[id]){
    combat.foldPose.set(key,fold);const bundle=combat.prepare(key,source),fresh=combat.fresh(key,bundle),loadout=actual.makeLoadout(id,bundle,data.projectiles,data.machineGuns),model=actual.buildTank(renderer,loadout,actual.generatedTurretParts),interior=actual.buildInterior(renderer,model,loadout,bundle.modules,bundle.crew),frame=body();
    model.setFold(fold);model.root.update();const saved=normalize(fresh.state),record=combat.registerSurfaceActor(key,id,{battle:73,entity:actors.length+1,life:1},model,frame),actor={id,key,source,bundle,fresh,loadout,model,interior,frame,record,saved};actors.push(actor);return actor;
  },dispose(){combat.surfaceOwner.retire();for(const a of actors){a.interior.dispose();a.model.dispose();}}};
}
function setFold(s,a,fraction){a.model.setFold(fraction);a.model.root.update();s.combat.setFold(a.key,fraction);s.combat._applyFold(a.key);assert.equal(s.combat.surfaceOwner.pose(a.key,fraction)?.available,true);}
function shoot(s,a,start=[0,1,8],end=[0,1,-8]){const d=end.map((x,i)=>x-start[i]),length=Math.hypot(...d),shell=Object.values(data.projectiles).find(p=>p.kind==='apcbc');const report=s.core.combatSurfaceShoot(a.key,a.fresh.state,{shell,origin:start,dir:d.map(x=>x/length),speed_ms:500,distance_m:500,seed:'5',turret_yaw:0},end);a.fresh.state=report.state;return report;}
const point=(m,p)=>[0,1,2].map(row=>m[12+row]+p.reduce((sum,v,k)=>sum+m[k*4+row]*v,0));
function ray(a,selection){const m=selection.buffer.node.world,v=selection.vertices.map(p=>point(m,p)),center=[0,1,2].map(k=>v.reduce((n,p)=>n+p[k],0)/3),u=v[1].map((x,k)=>x-v[0][k]),w=v[2].map((x,k)=>x-v[0][k]),n=[u[1]*w[2]-u[2]*w[1],u[2]*w[0]-u[0]*w[2],u[0]*w[1]-u[1]*w[0]],length=Math.hypot(...n);return{center,start:center.map((x,k)=>x+n[k]/length*.025),end:center.map((x,k)=>x-n[k]/length*.025)};}
function authoredRay(a){const catalog=JSON.parse(packets[a.id].catalog),armorRef=a.id==='de_flakpz38t'?'hull_upper_front':'hull_front',declaration=catalog.declarations.find(d=>d.role==='armor'&&d.armorBinding.boundarySide==='outer'&&d.armorBinding.armorRefs.includes(armorRef));assert.ok(declaration,`${a.id}: actual reviewed hull engineering reference`);const buffer=a.record.buffers.find(b=>'mesh:'+b.path===declaration.meshKey),p=new Float32Array(buffer.words.buffer,buffer.words.byteOffset,buffer.words.length);for(let triangle=declaration.first;triangle<declaration.first+declaration.count;triangle++){const selection={buffer,vertices:[0,1,2].map(k=>Array.from(p.subarray(triangle*9+k*3,triangle*9+k*3+3)))},r=ray(a,selection);if(r.start.every(Number.isFinite))return{...r,armorRef,thickness:a.source.armor.find(p=>p.id===armorRef).thickness_mm};}throw Error('no nondegenerate reviewed hull face');}
function apertureCases(s,a){
  const candidates=[];setFold(s,a,0);
  for(const buffer of a.record.buffers.filter(b=>b.path.includes('hinged_flap'))){const p=new Float32Array(buffer.words.buffer,buffer.words.byteOffset,buffer.words.length);for(let t=0;t<p.length;t+=9){const selection={buffer,vertices:[0,1,2].map(k=>Array.from(p.subarray(t+k*3,t+k*3+3)))},r=ray(a,selection);if(r.center.every(Number.isFinite)&&r.center[1]>1.2&&Math.abs(r.center[0])>.1){const hits=s.combat.surfaceOwner.trace(a.key,r.start,r.end,0);if(hits?.some(h=>h.meshId==='mesh:'+buffer.path))candidates.push({...selection,closed:r});}}}
  candidates.sort((a,b)=>b.closed.center[1]-a.closed.center[1]);setFold(s,a,1);
  const selected=[];for(const side of [-1,1]){const candidate=candidates.find(c=>Math.sign(c.closed.center[0])===side&&s.combat.surfaceOwner.trace(a.key,c.closed.start,c.closed.end,1)?.length===0);assert.ok(candidate,`${a.id}: a real raised ${side} panel leaves its old location open`);selected.push(candidate);}
  return selected;
}


function batch(s,work){return actual.batch?actual.batch.run(s.combat,work):work();}
function query(s,a,p0,p1){return actual.surfaceCollisionQuery(s.combat,a.key,p0,p1,77);}
test('real exact-model bounds are verified once for a synchronous run of far AA segments',()=>{
 const s=suite();try{const a=s.create('de_flakpz38t');actual.Enemy.prototype.poseGuns.call({model:a.model,loadout:a.loadout,turretYaw:0,alive:true,gunPitch:[]});const ray=authoredRay(a);actual.damageVisualsFor(s.renderer,a.model,a.fresh.caps,a.fresh.state,a.bundle.modules);query(s,a,ray.start,ray.end);let updates=0;const update=a.model.root.update;a.model.root.update=function(...args){updates++;return Reflect.apply(update,this,args);};
 const samples=[];batch(s,()=>{for(let i=0;i<300;i++)samples.push(query(s,a,[50+i*.1,100,-20],[50+i*.1,100,20]));});
 assert.ok(samples.every(v=>v.boundsCulled&&v.ready&&v.contact===null));assert.ok(updates<=2,`full exact bounds graph updates ${updates}`);
 }finally{s.dispose();}
});
test('near contacts, real openings, pose changes and separate phases still query the exact triangles',()=>{
 const s=suite();try{const a=s.create('de_rso_pak40'),ray=authoredRay(a),hits=[];
 for(let phase=0;phase<2;phase++)batch(s,()=>{query(s,a,[50,100,0],[50,100,1]);hits.push(query(s,a,ray.start,ray.end));setFold(s,a,phase);hits.push(query(s,a,ray.start,ray.end));query(s,a,[50,100,0],[50,100,1]);});
 assert.ok(hits.every(v=>v.handled&&v.ready&&v.contact));const panels=apertureCases(s,a);setFold(s,a,1);for(const p of panels)assert.equal(query(s,a,p.closed.start,p.closed.end).contact,null);
 }finally{s.dispose();}
});
test('body movement, geometry revision and failed readiness cannot reuse an earlier far-miss snapshot',()=>{
 const s=suite();try{const a=s.create('de_flakpz38t');query(s,a,[50,100,0],[50,100,1]);batch(s,()=>{query(s,a,[50,100,0],[50,100,1]);a.record.available=false;a.record.registrationFailed=true;const v=query(s,a,[50,100,0],[50,100,1]);assert.equal(v.ready,false);assert.equal(v.boundsCulled,undefined);});
 }finally{s.dispose();}
});
test('unbatched direct consumers retain current-root same-tick validation',()=>{
 const s=suite();try{const a=s.create('de_flakpz38t');query(s,a,[50,100,0],[50,100,1]);a.model.root.pos=[50,100,0];a.model.root.update();a.record.available=false;a.record.registrationFailed=true;const v=query(s,a,[50,100,0],[50,100,1]);assert.equal(v.ready,false);assert.equal(v.boundsCulled,undefined);
 }finally{s.dispose();}
});
