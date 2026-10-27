import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
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
  else{const output=path.join(temp,'candidate.html'),r=spawnSync(process.env.TF_TEST_PYTHON||(process.platform==='win32'?'python':'python3'),[patch,'--input',app,'--output',output],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);source=fs.readFileSync(output,'utf8');}
}finally{assert.equal(path.dirname(path.resolve(temp)),path.resolve(os.tmpdir()));assert.match(path.basename(temp),/^tf-foldable-surface-/);fs.rmSync(temp,{recursive:true,force:true});}
source=source.replace(/^<script>/,'');const end=source.indexOf('  // client/web/src/main.js');assert.ok(end>0);
const context=vm.createContext({console,atob,btoa,TextEncoder,TextDecoder,performance,Float32Array,Float64Array,Uint32Array,Uint8Array,Uint16Array,Int32Array,Int16Array,Int8Array,ArrayBuffer,DataView,Map,Set,WeakMap,WeakSet,structuredClone});
vm.runInContext(source.slice(0,end)+'globalThis.actual={buildTank,buildInterior,makeLoadout,generatedTurretParts,setCrewModel,setMgModels,Renderer,LocalSurfaceCombat,Combat,DesignCore,targetDef,surfaceCollisionQuery,install:typeof installReviewedFoldableSurfacePackets===\"function\"?installReviewedFoldableSurfacePackets:null};})();',context);
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

test('actual rendered buffers and target identity register with the existing compatibility policy',()=>{const s=suite();try{for(const id of ids){const a=s.create(id);assert.equal(a.record.available,true,a.record.detail);assert.equal(a.record.variants?.size||0,1);assert.equal(s.combat.surfaceOwner.packet(id).droppedVariants||0,0);assert.equal(s.combat.surfaceOwner.packet(id).armorBindingReview.sourcePinned,true);assert.equal(data.surfaceCatalog[id].variants.length,1);assert.deepEqual(normalize(a.fresh.state),a.saved);const r=authoredRay(a),report=shoot(s,a,r.start,r.end);assert.equal(report.hit,true);assert.ok(report.layers.some(l=>l.plate===r.armorRef));}}finally{s.dispose();}});

test('saved closed/mid/open fold before first registration keeps rest engineering and existing health/ammo/replay hooks',()=>{for(const id of ids)for(const fold of [0,.5,1]){const s=suite();try{const admission={tag:'retained-existing-admission'},pose=()=>null,time=()=>9;s.combat.setReplayAdmission(admission,pose,time);const a=s.create(id,fold);assert.equal(a.record.available,true,`${id} saved fold${fold}: ${a.record.detail}`);assert.deepEqual(normalize(s.combat.registrations.get(a.key)),normalize(s.combat._definition(a.key,a.source,0)));a.fresh.state.modules[0]=17;const before=normalize(a.fresh.state);s.combat.registerSurfaceActor(a.key,id,{battle:73,entity:1,life:1},a.model,a.frame);assert.deepEqual(normalize(a.fresh.state),before);assert.equal(s.combat.replayAdmission,admission);assert.equal(s.combat.replayPose,pose);assert.equal(s.combat.replayTime,time);const r=authoredRay(a),report=shoot(s,a,r.start,r.end);assert.equal(report.hit,true);assert.equal(report.layers[0].thickness_mm,r.thickness);}finally{s.dispose();}}});

test('both mirrored folding panels keep exact contact through closed/mid/open poses and leave real apertures',()=>{for(const id of ids){const s=suite();try{const a=s.create(id);assert.equal(a.record.available,true,a.record.detail);const panels=apertureCases(s,a);for(const fold of [0,.5,1]){setFold(s,a,fold);for(const panel of panels){const r=ray(a,panel),hits=s.combat.surfaceOwner.trace(a.key,r.start,r.end,fold);assert.ok(hits.some(h=>h.meshId==='mesh:'+panel.buffer.path&&Math.hypot(...h.point.map((x,k)=>x-r.center[k]))<.001));assert.equal(shoot(s,a,r.start,r.end).hit,true);}}setFold(s,a,1);for(const panel of panels){assert.equal(s.combat.surfaceOwner.trace(a.key,panel.closed.start,panel.closed.end,1).length,0);assert.equal(shoot(s,a,panel.closed.start,panel.closed.end).hit,false);}}finally{s.dispose();}}});

test('two actors of the same stock specification retain separate exact fold poses',()=>{for(const id of ids){const s=suite();try{const closed=s.create(id,0,id+':closed'),open=s.create(id,1,id+':open');assert.equal(closed.record.available,true,closed.record.detail);assert.equal(open.record.available,true,open.record.detail);const panel=apertureCases(s,closed)[0];setFold(s,closed,0);setFold(s,open,1);assert.ok(s.combat.surfaceOwner.trace(closed.key,panel.closed.start,panel.closed.end,1).length>0);assert.equal(s.combat.surfaceOwner.trace(open.key,panel.closed.start,panel.closed.end,1).length,0);assert.equal(shoot(s,closed).hit,true);assert.equal(shoot(s,open).hit,true);assert.notEqual(closed.record.actorKey,open.record.actorKey);}finally{s.dispose();}}});

test('retired exact actors and custom bundle copies keep the original legacy plate folding behavior',()=>{const s=suite();try{const a=s.create('de_flakpz38t');assert.equal(a.record.available,true,a.record.detail);setFold(s,a,1);assert.deepEqual(normalize(s.combat.registrations.get(a.key).plates),normalize(s.combat._definition(a.key,a.source,0).plates));s.combat.surfaceOwner.retire();s.combat._applyFold(a.key);assert.deepEqual(normalize(s.combat.registrations.get(a.key).plates),normalize(s.combat._definition(a.key,a.source,1).plates));const key='custom-copy',copy=structuredClone(data.vehicles.de_flakpz38t);s.combat.prepare(key,copy);s.combat.setFold(key,1);s.combat._applyFold(key);assert.deepEqual(normalize(s.combat.registrations.get(key).plates),normalize(s.combat._definition(key,copy,1).plates));assert.notDeepEqual(normalize(s.combat.registrations.get(key).plates),normalize(s.combat._definition(key,copy,0).plates));}finally{s.dispose();}});

test('shape mismatch retains explicit unavailability and cannot fall back to legacy damage',()=>{const s=suite();try{const a=s.create('de_rso_pak40');assert.equal(a.record.available,true,a.record.detail);const before=normalize(a.fresh.state);a.record.buffers[0].mesh._src.data=a.record.buffers[0].mesh._src.data.slice();a.record.buffers[0].mesh._src.data[0]+=.2;const result=actual.surfaceCollisionQuery(s.combat,a.key,[0,1,8],[0,1,-8],1);assert.equal(result.handled,true);assert.equal(result.ready,false);assert.equal(result.error.reason,'shape_unavailable');assert.deepEqual(normalize(a.fresh.state),before);}finally{s.dispose();}});

test('registered rest engineering survives ordinary prepare and fresh redefinitions at a saved open fold',()=>{for(const id of ids){const s=suite();try{const a=s.create(id,1);assert.equal(a.record.available,true,a.record.detail);a.fresh.state.modules[0]=13;const before=normalize(a.fresh.state);s.combat.catalogStamps.delete(a.key);s.combat.prepare(a.key,a.source);s.combat.fresh(a.key,a.source,1);assert.deepEqual(normalize(s.combat.registrations.get(a.key)),normalize(s.combat._definition(a.key,a.source,0)));assert.deepEqual(normalize(a.fresh.state),before);const r=authoredRay(a);assert.equal(shoot(s,a,r.start,r.end).hit,true);s.combat.surfaceOwner.retire();s.combat._applyFold(a.key);assert.deepEqual(normalize(s.combat.registrations.get(a.key).plates),normalize(s.combat._definition(a.key,a.source,1).plates),'prepare/fresh followed by retirement must restore the real legacy fold');}finally{s.dispose();}}});

test('source-pinned packet patch is byte-idempotent on an already patched app',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tf-foldable-surface-'));try{const input=path.join(dir,'input.html'),output=path.join(dir,'output.html');fs.writeFileSync(input,'<script>'+source);const r=spawnSync(process.env.TF_TEST_PYTHON||(process.platform==='win32'?'python':'python3'),[patch,'--input',input,'--output',output],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);assert.equal(fs.readFileSync(output,'utf8'),'<script>'+source);}finally{assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert.match(path.basename(dir),/^tf-foldable-surface-/);fs.rmSync(dir,{recursive:true,force:true});}});

test('exact reviewed fold parents preserve engineering, geometry and trusted variants while quarantining remaining source gaps',()=>{
 const pins={
  de_flakpz38t:{manifest:'514d9f3f04fa1024c7ebac9c75351f09bc2106bc71cc520581ccc1317494fc08',catalog:'8a954fdab267c22eb45502af5656c559cfac1a87a2de261444531041a5d0cb36',record:'3c8d8a4cf475b77427728858ac7b6bdd3af4e1d86921180dd40bbfa626e086bb',shape:'1eed6537d8fade0093db30db6709e2fda62b86d956907b4abd38107dbcfcf9aa',mapped:197,unknown:1},
  de_rso_pak40:{manifest:'d5fc142fd2ce1dd29fe4ed22bb531b66e4e877b84782b6ad6519e454f09df67e',catalog:'f51a9be77abb08a8285769e95e9cb24b34e8f2c2fed03776ba6f653056f8b642',record:'6c33493bf7b2332a9d4fce442169ae46884c5648c50050786f8e32f83ab173d9',shape:'36e14b8283cb3d6389a23f666f18877e9b30630ed4e9ecd813c9c94c3fa49eae',mapped:83,unknown:12},
 };
 const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),trust=read('data/barrel-shapes/index.json');
 const geometry=m=>m.meshes.map(({ranges,...mesh})=>mesh),s=suite();
 try{for(const id of ids){
  const raw=data.surfaceCatalog[id],runtime=s.combat.surfaceOwner.packet(id),before=JSON.parse(raw.manifest),after=JSON.parse(runtime.manifest),catalog=JSON.parse(raw.catalog),next=JSON.parse(runtime.catalog),pin=pins[id];
  assert.equal(catalog.declarations.filter(d=>d.resistancePolicy==='unsupported').length,id==='de_flakpz38t'?198:89,'Original source packets remain immutable');
  assert.equal(runtime.manifestHash,pin.manifest,id+' exact reviewed parent manifest');assert.equal(hash(runtime.manifest),pin.manifest);
  assert.equal(runtime.catalogHash,pin.catalog,id+' exact reviewed parent catalog');assert.equal(hash(runtime.catalog),pin.catalog);
  assert.equal(runtime.sourceManifestHash,raw.manifestHash);assert.equal(runtime.sourceCatalogHash,raw.catalogHash);
  assert.equal(runtime.armorBindingReview.sourcePinned,true);assert.equal(runtime.armorBindingReview.mappedDeclarations,pin.mapped);
  assert.equal(runtime.quarantinedSurfaces,pin.unknown);assert.equal(next.declarations.filter(d=>d.resistancePolicy==='unsupported').length,pin.unknown);
  assert.deepEqual(next.acceptedAnatomy,catalog.acceptedAnatomy,id+' every original armor, module, crew and weapon datum');
  for(const d of catalog.declarations.filter(d=>d.resistancePolicy!=='unsupported'))assert.deepEqual(next.declarations.find(n=>n.key===d.key),d,id+' previously admitted declaration '+d.key);
  assert.equal(runtime.payloads,raw.payloads);assert.deepEqual(geometry(after),geometry(before),id+' every uploaded mesh geometry field');
  assert.deepEqual(after.assemblies,before.assemblies);assert.deepEqual(after.meshInstances,before.meshInstances);
  assert.equal(runtime.droppedVariants||0,0);assert.equal(runtime.variants.length,1);
  const v=runtime.variants[0],record=JSON.parse(v.record),pinned=trust.variants.find(r=>r.shapeId===record.shapeId&&r.shapeHash===pin.shape);
  assert.ok(pinned,id+' exact approved descendant');assert.deepEqual(record,pinned);
  assert.equal(v.recordHash,pin.record);assert.equal(hash(v.record),pin.record);assert.equal(trust.recordFiles[record.shapeId],pin.record);
  assert.equal(record.parentStockManifestHash,pin.manifest);assert.equal(record.parentStockCatalogHash,pin.catalog);
  assert.equal(record.damagedManifestHash,v.manifestHash);assert.equal(hash(v.manifest),v.manifestHash);
  assert.equal(record.damagedCatalogHash,v.catalogHash);assert.equal(hash(v.catalog),v.catalogHash);
 }}finally{s.dispose();}
});

test('six exterior and running-gear directions retain exact contact and explicitly stop at unresolved resistance',()=>{for(const id of ids){const s=suite();try{const a=s.create(id);assert.equal(a.record.available,true,a.record.detail);const cases=[[[10,1,0],[-10,1,0]],[[-10,1,0],[10,1,0]],[[0,1,10],[0,1,-10]],[[0,1,-10],[0,1,10]],[[0,10,0],[0,-5,0]],[[0,-5,0],[0,10,0]],[[10,.55,1.3],[-10,.55,1.3]],[[-10,.55,-1.3],[10,.55,-1.3]]];for(const [start,end]of cases){const contacts=s.combat.surfaceOwner.trace(a.key,start,end,1),report=shoot(s,a,start,end);assert.ok(contacts.length>0,`${id}: actual visible contact ${start}`);assert.equal(report.hit,true,`${id}: real shot ${start}`);if(report.events.includes('unsupported_surface_resistance')){assert.equal(report.outcome,'stopped',`${id}: unknown visible resistance must not become transparent`);assert.ok(s.combat.surfaceOwner.packet(id).quarantinedSurfaces>0);}else{assert.ok(report.layers.length>0,`${id}: admitted authored resistance must have actual material layers`);assert.ok(report.layers.every(l=>l.thickness_mm>0));}}}finally{s.dispose();}}});
