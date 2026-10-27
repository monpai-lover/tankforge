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
vm.runInContext(source.replace(/^<script>/,'').slice(0,end-'<script>'.length)+`\nglobalThis.actual={Enemy,buildTank,buildInterior,makeLoadout,generatedTurretParts,setCrewModel,setMgModels,Renderer,Combat,DesignCore,damageVisualsFor,surfaceCollisionQuery,heContactEffects,flushHeContactBursts,queue:HE_CONTACT_QUEUE,install:typeof installReviewedFoldableSurfacePackets==='function'?installReviewedFoldableSurfacePackets:null};})();`,context);
const a=context.actual;a.install?.(data);const readJSON=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
a.setCrewModel(readJSON('client/web/assets/crew_model.json'));a.setMgModels(readJSON('client/web/assets/mg_models.json'));
const core=new a.DesignCore(new WebAssembly.Instance(new WebAssembly.Module(wasm),{}),{materials:data.materials,catalog:data.designCatalog,terrains:Object.values(data.terrains)}),combat=new a.Combat(core,data.machineGuns);
let serial=0;const gl={ARRAY_BUFFER:1,FLOAT:2,STATIC_DRAW:3,DYNAMIC_DRAW:4,createVertexArray:()=>({vao:++serial}),createBuffer:()=>({buffer:++serial}),bindVertexArray(){},bindBuffer(){},bufferData(){},bufferSubData(){},enableVertexAttribArray(){},vertexAttribPointer(){},vertexAttribDivisor(){},deleteVertexArray(){},deleteBuffer(){},getExtension:()=>true};
const renderer=Object.assign(Object.create(a.Renderer.prototype),{gl,_live:new Set(),_texSrc:new Map(),lost:false});
combat.setSurfaceCatalog(data.surfaceCatalog,renderer);combat.replayTime=()=>1;
const body={ex:[1,0,0],ey:[0,1,0],ez:[0,0,1],origin:()=>[0,0,0],worldPoint:p=>p.slice(),localPoint:p=>p.slice(),worldDir:p=>p.slice(),localDir:p=>p.slice()};
const ids=opt('--ids',null)?.split(',')||Object.keys(data.surfaceCatalog);
const selected=Object.values(data.projectiles).filter(s=>/ap|heat/.test(s.kind));
const shells=[...new Map(selected.filter(s=>s.caliber_mm>=75).sort((a,b)=>b.muzzle_velocity_ms-a.muzzle_velocity_ms).slice(0,1).concat(selected.filter(s=>s.caliber_mm>=100).sort((a,b)=>b.mass_kg*b.muzzle_velocity_ms**2-a.mass_kg*a.muzzle_velocity_ms**2).slice(0,1)).map(s=>[s.id,s])).values()];
const actors=[];
for(const [index,id] of ids.entries()){
 const key='penetration-audit-'+id,bundle=combat.prepare(key,data.vehicles[id]),fresh=combat.fresh(key,bundle),loadout=a.makeLoadout(id,bundle,data.projectiles,data.machineGuns),model=a.buildTank(renderer,loadout,a.generatedTurretParts),interior=a.buildInterior(renderer,model,loadout,bundle.modules,bundle.crew);
 model.root.pos=[0,0,0];model.root.yaw=0;model.setFold?.(0);a.Enemy.prototype.poseGuns.call({model,loadout,turretYaw:0,alive:true,gunPitch:[]});model.root.update();a.damageVisualsFor(renderer,model,fresh.caps,fresh.state,bundle.modules);
 const record=combat.registerSurfaceActor(key,id,{battle:263,entity:index+1,life:1},model,body);assert.ok(record?.available,id+': '+record?.detail);
 const packet=combat.surfaceOwner.packet(id),catalog=JSON.parse(packet.catalog),manifest=JSON.parse(packet.manifest),rays=[];
 for(const d of catalog.declarations.filter(d=>d.role==='armor'&&d.armorBinding?.boundarySide==='outer').slice(0,16)){
  const b=record.buffers.find(b=>'mesh:'+b.path===d.meshKey),p=new Float32Array(b.words.buffer,b.words.byteOffset,b.words.length),m=b.node.world;
  const world=p=>[0,1,2].map(k=>m[12+k]+p.reduce((s,v,i)=>s+m[i*4+k]*v,0));
  for(let t=d.first;t<Math.min(d.first+d.count,d.first+8);t++){
   const v=[0,1,2].map(k=>world(Array.from(p.subarray(t*9+k*3,t*9+k*3+3)))),center=[0,1,2].map(k=>v.reduce((s,p)=>s+p[k],0)/3),u=v[1].map((q,k)=>q-v[0][k]),w=v[2].map((q,k)=>q-v[0][k]),n=[u[1]*w[2]-u[2]*w[1],u[2]*w[0]-u[0]*w[2],u[0]*w[1]-u[1]*w[0]],length=Math.hypot(...n);
   if(!(length>1e-8))continue;const normal=n.map(q=>q/length),start=center.map((q,k)=>q+normal[k]*.025),end=center.map((q,k)=>q-normal[k]*.025),hit=a.surfaceCollisionQuery(combat,key,start,end,1);if(!hit.ready||!hit.contact)continue;
   rays.push({name:'authored:'+d.key,source:'authored-outer-armor-normal',start,end,armorRefs:d.armorBinding.armorRefs});break;
  }
 }
 for(const y of [.5,1,1.5,2,2.5])for(const u of [-1,0,1]){
  rays.push({name:`front:${u}:${y}`,start:[u,y,20],end:[u,y,-20]});
  rays.push({name:`side:${u}:${y}`,start:[20,y,u],end:[-20,y,u]});
 }
 const arena=new Uint8Array(core.instance.exports.memory.buffer).slice(),cases=[];
 for(const ray of rays)for(const shell of shells){
  new Uint8Array(core.instance.exports.memory.buffer).set(arena);
  const chord=ray.end.map((v,k)=>v-ray.start[k]),length=Math.hypot(...chord),hit=a.surfaceCollisionQuery(combat,key,ray.start,ray.end,1);
  let report,error;try {report=combat.shoot(key,plain(fresh.state),{shell,origin:ray.start,dir:chord.map(v=>v/length),speed_ms:shell.muzzle_velocity_ms,distance_m:100,seed:1001,turret_yaw:0,finite_end:ray.end,replay_time_s:1});}catch(e){error=e.message;}
  cases.push({ray,shell:shell.id,query:plain(hit),error,report:report?plain(Object.fromEntries(['outcome','hit','impact','layers','events','geometry_contacts','crew','modules','caps','penetration','residual_energy_j','path'].map(k=>[k,report[k]]))):null});
 }
 const roles={};for(const d of catalog.declarations)roles[d.role]=(roles[d.role]||0)+d.count;
 actors.push({id,roles,manifestHash:packet.manifestHash,catalogHash:packet.catalogHash,cases,review:packet.armorBindingReview});phase('probed-'+id);
 combat.surfaceOwner.retire();interior.dispose();model.dispose();
}
assert.equal(actors.length,26,'all currently registered stock vehicles');for(const actor of actors){assert.ok(actor.cases.some(c=>c.report?.layers?.some(l=>l.passed)),actor.id+' must have physically penetrable armor');assert.ok(actor.cases.every(c=>!c.error&&c.report),actor.id+' must resolve every shot');}
const receipt={root,app,sourceSHA256:sha(source),wasmSHA256:sha(wasm),embeddedSHA256,shells,actors};fs.writeFileSync(out,JSON.stringify(receipt,null,2),{flag:'wx'});
console.log(JSON.stringify({out,actors:actors.map(x=>({id:x.id,roles:x.roles,outcomes:x.cases.reduce((o,c)=>(o[c.report?.outcome||c.error||'null']=(o[c.report?.outcome||c.error||'null']||0)+1,o),{}),unsupported:x.cases.filter(c=>c.report?.events?.includes('unsupported_surface_resistance')).length,penetrated:x.cases.filter(c=>c.report?.layers?.some(l=>l.penetrated)).length}))}));