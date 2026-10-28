import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';
import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {rendererSink} from '../../client/web/tools/hit-mesh-capture.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
let source=fs.readFileSync(path.join(root,'handoff/bundle/app.js.html'),'utf8');
if(process.env.TF_R85_BASELINE!=='1'){
 const patch=await import('../tools/patch_r85_client_state_queries.mjs');
 if(patch.patchR85ProtectionQuery)source=patch.patchR85ProtectionQuery(source);
}
const dir=path.join(root,'handoff/bundle');
let raw=fs.existsSync(path.join(dir,'data.line'))?fs.readFileSync(path.join(dir,'data.line')):zlib.gunzipSync(Buffer.concat(fs.readdirSync(dir).filter(n=>n.startsWith('data.line.gz.part')).sort().map(n=>fs.readFileSync(path.join(dir,n)))));
function field(name){const marker=Buffer.from(JSON.stringify(name)+':');let i=raw.indexOf(marker)+marker.length;assert.ok(i>=marker.length,name);const start=i;let depth=0,quote=false,escape=false;for(;i<raw.length;i++){const b=raw[i];if(quote){if(escape)escape=false;else if(b===92)escape=true;else if(b===34)quote=false;continue;}if(b===34)quote=true;else if(b===123||b===91)depth++;else if((b===125||b===93)&&--depth===0)return JSON.parse(raw.subarray(start,i+1));}throw Error('unterminated '+name);}
const data=Object.fromEntries(['materials','designCatalog','terrains','projectiles','machineGuns','vehicles','surfaceCatalog'].map(k=>[k,field(k)]));raw=null;
const c=vm.createContext({console,atob,btoa,TextEncoder,TextDecoder,performance,Float32Array,Float64Array,Uint32Array,Uint8Array,Uint16Array,Int32Array,Int16Array,Int8Array,ArrayBuffer,DataView,Map,Set,WeakMap,WeakSet,structuredClone});
vm.runInContext(source.replace(/^<script>/,'').split('  // client/web/src/main.js')[0]+'globalThis.A={buildTank,buildInterior,makeLoadout,generatedTurretParts,setCrewModel,setMgModels,Renderer,Combat,DesignCore,Protection,install:typeof installReviewedFoldableSurfacePackets===\'function\'?installReviewedFoldableSurfacePackets:null};})();',c);
const A=c.A;A.install?.(data);A.setCrewModel(read('client/web/assets/crew_model.json'));A.setMgModels(read('client/web/assets/mg_models.json'));
const wasm=Buffer.from(source.match(/var TF_APHE_SURFACE_CORE = "([^"]+)"/)[1],'base64'),compiled=new WebAssembly.Module(wasm);
function actor(id){
 const core=new A.DesignCore(new WebAssembly.Instance(compiled,{}),{materials:data.materials,catalog:data.designCatalog,terrains:Object.values(data.terrains)}),combat=new A.Combat(core,data.machineGuns),sink=rendererSink(),renderer=Object.assign(Object.create(A.Renderer.prototype),{gl:sink.gl,_live:new Set(),_texSrc:new Map(),lost:false,setArmor(){}});
 let uploads=0;const bufferData=sink.gl.bufferData.bind(sink.gl);sink.gl.bufferData=(...args)=>{uploads++;return bufferData(...args);};
 combat.setSurfaceCatalog(data.surfaceCatalog,renderer);
 const bundle=combat.prepare(id,data.vehicles[id]),loadout=A.makeLoadout(id,bundle,data.projectiles,data.machineGuns),model=A.buildTank(renderer,loadout,A.generatedTurretParts),interior=A.buildInterior(renderer,model,loadout,bundle.modules,bundle.crew);
 model.setFold?.(0);model.root.update();
 const body={ex:[1,0,0],ey:[0,1,0],ez:[0,0,1],origin:()=>[0,0,0],localPoint:p=>p.slice(),worldPoint:p=>p.slice(),localDir:p=>p.slice(),worldDir:p=>p.slice()};
 const protection=new A.Protection({renderer,materials:Object.fromEntries(data.materials.map(m=>[m.id,m])),combat:()=>combat,surfaceCatalog:data.surfaceCatalog,inspectionNow:()=>1000});
 protection.attach(model,loadout,bundle);protection.shell=data.projectiles.apfsds_125_3bm22;protection.active=true;protection.update(body,0);
 return {protection,combat,core,model,bundle,renderer,uploads:()=>uploads,dispose(){protection.detach();combat.surfaceOwner?.retire();interior.dispose();model.dispose();}};
}
for(const [id,origin,dir,plate,mm] of [
 ['de_pz3_j',[12,1.82,-.35],[-1,0,0],'turret_side_r',30],
 ['de_pz4_h',[-12,1.9,.55],[1,0,0],'turret_side_l',30],
])test(`R85 ${id} actual registered triangle protection query reports authored ${plate} thickness`,()=>{
 const a=actor(id);try{
 const registeredKeys=[],nativeRegister=a.core.combatSurfaceRegister;
 a.core.combatSurfaceRegister=function(key,...args){registeredKeys.push(key);return Reflect.apply(nativeRegister,this,[key,...args]);};
 const h=a.protection.pick(origin,dir),record=a.protection.analysisOwner?.actors.get(a.protection.analysisKey);
 assert.equal(h?.geometrySource,'registered_triangles',JSON.stringify({h,unavailable:a.protection.analysisOwner?.lastUnavailable,detail:record?.detail}));
 assert.notEqual(h.verdict,'unknown',JSON.stringify({reason:h.reason,contact:h.contact,report:h.report,unavailable:a.protection.analysisOwner?.lastUnavailable,detail:record?.detail}));
 assert.equal(h.plate.def.id,plate);assert.equal(h.plate.def.thickness_mm,mm);assert.match(a.protection.describe(h),new RegExp(`${mm} mm`));
 assert.equal(h.contact.schema,'SurfaceCrossingV1');assert.ok(h.contact.triangleId!=null||h.contact.geometry,JSON.stringify(h.contact));
 // Hover movement and click previews are independent fresh targets. A previous
 // preview may have wounded crew; its issued state must not poison the next
 // fresh preview under native barrel-state identity checks.
 const owner=a.protection.analysisOwner,uploads=a.uploads(),gpuMeshes=a.renderer._live.size,payloads=owner.installed.size;
 for(let n=1;n<=10;n++){
   a.protection.inspectionNow=()=>1000+n*250;
   const next=a.protection.pick([origin[0],origin[1]+n*.00001,origin[2]],dir);
   assert.equal(next?.geometrySource,'registered_triangles',`preview ${n+1} lost the registered scene`);
   assert.equal(next?.plate?.def.thickness_mm,mm,`preview ${n+1} failed fresh armor inspection`);
   assert.deepEqual(Array.from(next.report.state.crew),Array.from(h.report.state.crew),'preview damage must not accumulate across independent inspection rays');
   assert.equal(owner.actors.size,1,'private preview actor records remain bounded');
   assert.equal(a.uploads(),uploads,'unchanged preview geometry must reuse GPU uploads');
   assert.equal(a.renderer._live.size,gpuMeshes,'fresh private life must retain its prepared variant meshes');
   assert.equal(owner.installed.size,payloads,'verified native payload installation is reused');
   assert.equal(next.contact.entityId,'1:1:'+(n+1));
 }
 // A native registration failure must not strand the private scene at the old
 // life. The next independent preview recovers through a newer registration.
 const nativeVariant=a.core.combatSurfaceVariantRegister;let injected=false;
 a.core.combatSurfaceVariantRegister=function(...args){if(!injected){injected=true;throw Error('diagnostic_registration_failure');}return Reflect.apply(nativeVariant,this,args);};
 a.protection.inspectionNow=()=>6000;
 const failed=a.protection.pick(origin,dir);assert.equal(injected,true);assert.equal(failed?.verdict,'unknown');
 a.protection.inspectionNow=()=>6250;
 const recovered=a.protection.pick(origin,dir);assert.equal(recovered?.geometrySource,'registered_triangles');assert.equal(recovered?.plate?.def.thickness_mm,mm);
 assert.equal(owner.actors.size,1);assert.equal(a.uploads(),uploads);assert.equal(a.renderer._live.size,gpuMeshes);
 a.core.combatSurfaceVariantRegister=nativeVariant;
 const shot1=a.protection.shoot(id,origin,dir),shot2=a.protection.shoot(id,origin,dir);
 assert.equal(shot1?.replay_unavailable,'non_authoritative_analysis');assert.equal(shot2?.replay_unavailable,'non_authoritative_analysis');
 assert.deepEqual(Array.from(shot2.state.crew),Array.from(shot1.state.crew),'independent click previews use fresh private targets too');
 assert.ok(registeredKeys.length>=14);assert.ok(registeredKeys.every(key=>key===a.protection.analysisKey),'preview resets may only address their private analysis actor');
 assert.equal(owner.actors.size,1);assert.equal(a.uploads(),uploads);assert.equal(a.renderer._live.size,gpuMeshes);
 // A ray above every uploaded surface remains a miss. No nearest abstract
 // armor plane is allowed to invent a query result for empty rendered space.
 a.protection.inspectionNow=()=>10000;
 assert.equal(a.protection.pick([12,100,0],[-1,0,0]),null);
 }finally{a.dispose();}
});

