#!/usr/bin/env node
// Read-only production CPU benchmark. Writes receipts only to the requested validation path.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const args=process.argv.slice(2),opt=(n,d)=>{let i=args.indexOf(n);return i<0?d:args[i+1];};
const root=path.resolve(opt('--root')),out=path.resolve(opt('--out')),samples=Number(opt('--samples',48)),warmup=Number(opt('--warmup',12));
assert.ok(!fs.existsSync(out),'fresh report path');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex'),plain=x=>JSON.parse(JSON.stringify(x));
const app=path.resolve(opt('--app',path.join(root,'handoff/bundle/app.js.html'))),source=fs.readFileSync(app,'utf8');
const start=performance.now(),phase=s=>console.log(JSON.stringify({phase:s,elapsedMs:performance.now()-start}));
const end=source.indexOf('  // client/web/src/main.js');assert.ok(end>0);
const wasmMatch=source.match(/var TF_APHE_SURFACE_CORE = "([^"]+)"/);assert.ok(wasmMatch);
const wasm=Buffer.from(wasmMatch[1],'base64');
const bundleDir=path.join(root,'handoff/bundle');
let raw=fs.existsSync(path.join(bundleDir,'data.line'))?fs.readFileSync(path.join(bundleDir,'data.line')):zlib.gunzipSync(Buffer.concat(fs.readdirSync(bundleDir).filter(n=>n.startsWith('data.line.gz.part')).sort().map(n=>fs.readFileSync(path.join(bundleDir,n)))));
const embeddedSHA256=sha(raw);
function field(name){const marker=Buffer.from(JSON.stringify(name)+':');let i=raw.indexOf(marker)+marker.length;assert.ok(i>=marker.length,name);const begin=i;let depth=0,quote=false,escape=false;for(;i<raw.length;i++){const b=raw[i];if(quote){if(escape)escape=false;else if(b===92)escape=true;else if(b===34)quote=false;continue;}if(b===34)quote=true;else if(b===123||b===91)depth++;else if((b===125||b===93)&&--depth===0)return JSON.parse(raw.subarray(begin,i+1));}throw Error(name);}
const data=Object.fromEntries(['materials','designCatalog','terrains','projectiles','machineGuns','vehicles','surfaceCatalog'].map(k=>[k,field(k)]));raw=null;global.gc?.();phase('decoded-actual-embedded-data');
const context=vm.createContext({console,atob,btoa,TextEncoder,TextDecoder,performance,Float32Array,Float64Array,Uint32Array,Uint8Array,Uint16Array,Int32Array,Int16Array,Int8Array,ArrayBuffer,DataView,Map,Set,WeakMap,WeakSet,structuredClone});
vm.runInContext(source.replace(/^<script>/,'').slice(0,end-'<script>'.length)+`\nglobalThis.actual={targetDef,setScreenNormalizer:(normalize)=>{const base=normalizeSurfacePacket;normalizeSurfacePacket=packet=>normalize(packet)||base(packet);},Enemy,buildTank,buildInterior,makeLoadout,generatedTurretParts,setCrewModel,setMgModels,Renderer,Combat,DesignCore,damageVisualsFor,surfaceCollisionQuery,heContactEffects,flushHeContactBursts,queue:HE_CONTACT_QUEUE,install:typeof installReviewedFoldableSurfacePackets==='function'?installReviewedFoldableSurfacePackets:null};})();`,context);
const a=context.actual;a.install?.(data);const readJSON=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
a.setCrewModel(readJSON('client/web/assets/crew_model.json'));a.setMgModels(readJSON('client/web/assets/mg_models.json'));
const core=new a.DesignCore(new WebAssembly.Instance(new WebAssembly.Module(wasm),{}),{materials:data.materials,catalog:data.designCatalog,terrains:Object.values(data.terrains)}),combat=new a.Combat(core,data.machineGuns);
let serial=0;const gl={ARRAY_BUFFER:1,FLOAT:2,STATIC_DRAW:3,DYNAMIC_DRAW:4,createVertexArray:()=>({vao:++serial}),createBuffer:()=>({buffer:++serial}),bindVertexArray(){},bindBuffer(){},bufferData(){},bufferSubData(){},enableVertexAttribArray(){},vertexAttribPointer(){},vertexAttribDivisor(){},deleteVertexArray(){},deleteBuffer(){},getExtension:()=>true};
const renderer=Object.assign(Object.create(a.Renderer.prototype),{gl,_live:new Set(),_texSrc:new Map(),lost:false});
combat.setSurfaceCatalog(data.surfaceCatalog,renderer);combat.replayTime=()=>1;
const body={ex:[1,0,0],ey:[0,1,0],ez:[0,0,1],origin:()=>[0,0,0],worldPoint:p=>p.slice(),localPoint:p=>p.slice(),worldDir:p=>p.slice(),localDir:p=>p.slice()};
const counters={coreCalls:0,coreMs:0,coreOps:{},ownerPoses:0,shapeValidations:0,matrixCollections:0};
let countCalls=true;
const ccall=core.call;core.call=function(req){const t=performance.now();const r=Reflect.apply(ccall,this,[req]);const ms=performance.now()-t;if(countCalls){counters.coreCalls++;counters.coreMs+=ms;counters.coreOps[req.op]=(counters.coreOps[req.op]||0)+1;}return r;};
for(const [name,key]of [['pose','ownerPoses'],['validateShape','shapeValidations'],['matrices','matrixCollections']]){const f=combat.surfaceOwner[name];combat.surfaceOwner[name]=function(...xs){if(countCalls)counters[key]++;return Reflect.apply(f,this,xs);};}
const helper=await import('./penetration_screens.mjs');
const records={},normalized={};
for(const id of ['de_pz4_h','de_panther_g','de_panther_f']){
 const vehicle=data.vehicles[id],packet=combat.surfaceOwner.packet(id),plates=helper.screenArmorFor(id,vehicle),extended={...vehicle,armor:vehicle.armor.concat(plates)};
 const description=core.combatTarget(a.targetDef('screen-registration-'+id,extended,0,Object.values(data.machineGuns)));
 const derivative=helper.buildScreenPacket(packet,vehicle,description.registration_hash),c=JSON.parse(packet.catalog),dc=JSON.parse(derivative.catalog);
 assert.deepEqual(dc.acceptedAnatomy.armor.slice(0,-2),c.acceptedAnatomy.armor,'original engineering retained');
 assert.deepEqual(JSON.parse(derivative.manifest).meshes.map(m=>[m.payloadHash,m.positionsHash,m.renderBufferHash,m.vertexCount,m.triangleCount]),JSON.parse(packet.manifest).meshes.map(m=>[m.payloadHash,m.positionsHash,m.renderBufferHash,m.vertexCount,m.triangleCount]));
 records[id]={originalArmorHash:helper.sha(helper.canonical(vehicle.armor)),updatedArmorHash:helper.sha(helper.canonical(extended.armor)),originalPacketManifestHash:data.surfaceCatalog[id].manifestHash,originalPacketCatalogHash:data.surfaceCatalog[id].catalogHash,parentManifestHash:packet.manifestHash,parentCatalogHash:packet.catalogHash,originalUnknownDeclarations:c.declarations.filter(d=>d.resistancePolicy==='unsupported').length,plates,packet:derivative};normalized[id]=packet;
}
a.setScreenNormalizer(packet=>helper.recognizeScreenPacket(packet,records));
const actors=[],results=[];
for(const [i,id]of ['de_pz4_h','de_panther_g','de_panther_f'].entries()){
 const base=data.vehicles[id],extended={...base,armor:base.armor.concat(records[id].plates)},key='screen-actor-'+id;
 const packets={...data.surfaceCatalog,[id]:records[id].packet},ownedCombat=new a.Combat(core,data.machineGuns);ownedCombat.setSurfaceCatalog(packets,renderer);ownedCombat.replayTime=()=>1;
 const bundle=ownedCombat.prepare(key,extended),fresh=ownedCombat.fresh(key,bundle),loadout=a.makeLoadout(id,bundle,data.projectiles,data.machineGuns),model=a.buildTank(renderer,loadout,a.generatedTurretParts),interior=a.buildInterior(renderer,model,loadout,bundle.modules,bundle.crew);
 model.root.pos=[0,0,0];model.root.yaw=0;model.setFold?.(0);a.Enemy.prototype.poseGuns.call({model,loadout,turretYaw:0,alive:true,gunPitch:[]});model.root.update();a.damageVisualsFor(renderer,model,fresh.caps,fresh.state,bundle.modules);
 const record=ownedCombat.registerSurfaceActor(key,id,{battle:266,entity:i+1,life:1},model,body);assert.equal(record?.available,true,id+': '+record?.detail);
 assert.equal(ownedCombat.surfaceOwner.packet(id).armorBindingReview.sourcePinned,true,'screen derivative explicitly pinned');
 actors.push({id,key,combat:ownedCombat,bundle,fresh,model,interior,record});phase('screen-registered-'+id);
}
const arena=new Uint8Array(core.instance.exports.memory.buffer).slice();
for(const actor of actors){
 const plate=records[actor.id].plates[0],x=plate.center.x,y=plate.center.y,z=plate.center.z;
 const mg=data.machineGuns.mg34,pen=mg.pen_mm_100m;
 const mgShell=(ball)=>({id:'bullet_mg34'+(ball?'_ball':''),name:mg.name,kind:'ap',caliber_mm:mg.caliber_mm,mass_kg:mg.bullet_mass_g/1000,muzzle_velocity_ms:mg.muzzle_velocity_ms,explosive_mass_kg:0,explosive_type:'none',penetrator_material:'steel',length_mm:mg.caliber_mm*4,drag_coefficient:mg.drag_coefficient||.3,penetration_curve:[{distance_m:0,pen_mm:pen*1.1*(ball?.4:1)},{distance_m:100,pen_mm:pen*(ball?.4:1)},{distance_m:500,pen_mm:pen*.55*(ball?.4:1)}],ricochet_angle_deg:70,normalization_deg:0,fuse_delay_s:0,fuse_sensitivity_mm:0});
 for(const side of [1,-1])for(const [name,shell]of [['high-ap',data.projectiles.apfsds_125_3bm22],['mg-ap',mgShell(false)],['mg-ball',mgShell(true)]]){
  new Uint8Array(core.instance.exports.memory.buffer).set(arena);
  const start=[side*(x+.1),y,z],end=[side*(x-.1),y,z],dir=[-side,0,0],r=actor.combat.shoot(actor.key,plain(actor.fresh.state),{shell,origin:start,dir,speed_ms:shell.muzzle_velocity_ms,distance_m:100,seed:501,turret_yaw:0,finite_end:end,replay_time_s:1});
  results.push({id:actor.id,side,name,shell:plain(shell),outcome:r.outcome,layers:r.layers,events:r.events,modules:r.modules,crew:r.crew,geometryContacts:r.geometry_contacts});
  const skirt=r.layers.find(l=>l.plate==='schuerzen_'+(side===1?'r':'l'));assert.ok(skirt,actor.id+' real skirt layer');assert.equal(skirt.thickness_mm,5);
  if(name==='high-ap')assert.equal(skirt.passed,true,'high AP passes actual screen');
  if(name==='mg-ball')assert.equal(skirt.passed,false,'ordinary rifle ball stops on actual5mm screen');
 }
}
const pins=Object.fromEntries(Object.entries(records).map(([id,r])=>[id,{parentManifestHash:r.parentManifestHash,parentCatalogHash:r.parentCatalogHash,manifestHash:r.packet.manifestHash,catalogHash:r.packet.catalogHash,targetRegistrationHash:JSON.parse(r.packet.catalog).targetRegistrationHash,anatomyHash:JSON.parse(r.packet.catalog).anatomyHash,plates:r.plates}]));
fs.writeFileSync(path.join(path.dirname(out),'penetration_screens_packets.json'),JSON.stringify(records));
fs.writeFileSync(path.join(path.dirname(out),'penetration_screens_install.js'),helper.screenInstallSource(records)+'\n'+helper.screenNormalizationSource(records));
fs.writeFileSync(path.join(path.dirname(out),'penetration_screens_native_armor_overlay.json'),JSON.stringify(Object.fromEntries(Object.entries(records).map(([id,r])=>[id,{path:'data/vehicles/'+id+'/armor.json',originalArmorHash:r.originalArmorHash,append:r.plates,armor:data.vehicles[id].armor.concat(r.plates)}])) ,null,2));
fs.writeFileSync(out,JSON.stringify({schema:'SupplementalScreensEmbeddedWasmProofV1',app,sourceSHA256:sha(source),wasmSHA256:sha(wasm),scope:'CPU-only actual embedded WASM and actual registered production render triangles, no geometry replacement or native guard bypass',pins,results},null,2),{flag:'wx'});
console.log(JSON.stringify({out,results:results.map(r=>({id:r.id,side:r.side,name:r.name,outcome:r.outcome,layers:r.layers.map(l=>({plate:l.plate,thickness:l.thickness_mm,passed:l.passed})),events:r.events}))}));


