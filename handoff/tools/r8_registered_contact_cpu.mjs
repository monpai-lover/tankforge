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
const counters={coreCalls:0,coreMs:0,coreOps:{},ownerPoses:0,shapeValidations:0,matrixCollections:0};
let countCalls=true;
const ccall=core.call;core.call=function(req){const t=performance.now();const r=Reflect.apply(ccall,this,[req]);const ms=performance.now()-t;if(countCalls){counters.coreCalls++;counters.coreMs+=ms;counters.coreOps[req.op]=(counters.coreOps[req.op]||0)+1;}return r;};
for(const [name,key]of [['pose','ownerPoses'],['validateShape','shapeValidations'],['matrices','matrixCollections']]){const f=combat.surfaceOwner[name];combat.surfaceOwner[name]=function(...xs){if(countCalls)counters[key]++;return Reflect.apply(f,this,xs);};}
const actors=[];
for(const [index,id]of ['su_t72a','de_flakpz38t'].entries()){
  const key='contact-cpu-'+id,bundle=combat.prepare(key,data.vehicles[id]),fresh=combat.fresh(key,bundle),loadout=a.makeLoadout(id,bundle,data.projectiles,data.machineGuns),model=a.buildTank(renderer,loadout,a.generatedTurretParts),interior=a.buildInterior(renderer,model,loadout,bundle.modules,bundle.crew);
  model.root.pos=[0,0,0];model.root.yaw=0;model.setFold?.(0);a.Enemy.prototype.poseGuns.call({model,loadout,turretYaw:0,alive:true,gunPitch:[]});model.root.update();a.damageVisualsFor(renderer,model,fresh.caps,fresh.state,bundle.modules);
  const record=combat.registerSurfaceActor(key,id,{battle:263,entity:index+1,life:1},model,body);assert.equal(record?.available,true,id+': '+record?.detail);
  const packet=combat.surfaceOwner.packet(id),geometry=crypto.createHash('sha256');for(const b of record.buffers)geometry.update(Buffer.from(b.words.buffer,b.words.byteOffset,b.words.byteLength));
  const actor={id,key,bundle,fresh,loadout,model,interior,body,record,packet,geometrySHA256:geometry.digest('hex')};
  const catalog=JSON.parse(packet.catalog),armorById=new Map(bundle.armor.map(p=>[p.id,p]));
  const declarations=catalog.declarations.filter(d=>d.role==='armor'&&d.armorBinding?.boundarySide==='outer').sort((x,y)=>Math.max(...y.armorBinding.armorRefs.map(k=>armorById.get(k)?.thickness_mm||0))-Math.max(...x.armorBinding.armorRefs.map(k=>armorById.get(k)?.thickness_mm||0)));
  for(const d of declarations){const b=record.buffers.find(b=>'mesh:'+b.path===d.meshKey),p=new Float32Array(b.words.buffer,b.words.byteOffset,b.words.length),m=b.node.world,world=p=>[0,1,2].map(k=>m[12+k]+p.reduce((s,v,i)=>s+m[i*4+k]*v,0));
    for(let t=d.first;t<Math.min(d.first+d.count,d.first+8);t++){const v=[0,1,2].map(k=>world(Array.from(p.subarray(t*9+k*3,t*9+k*3+3)))),center=[0,1,2].map(k=>v.reduce((s,p)=>s+p[k],0)/3),u=v[1].map((q,k)=>q-v[0][k]),w=v[2].map((q,k)=>q-v[0][k]);
      const n=[u[1]*w[2]-u[2]*w[1],u[2]*w[0]-u[0]*w[2],u[0]*w[1]-u[1]*w[0]],length=Math.hypot(...n);if(!(length>1e-8))continue;const normal=n.map(q=>q/length),start=center.map((q,k)=>q+normal[k]*.025),end=center.map((q,k)=>q-normal[k]*.025),hit=a.surfaceCollisionQuery(combat,key,start,end,1);if(!hit.ready||!hit.contact)continue;
      actor.ray={start,end,point:plain(hit.contact.point),normal:plain(hit.contact.geometricNormal),declaration:d.key||d.surfaceKey||d.meshKey,triangle:t,armorRefs:d.armorBinding.armorRefs,contact:plain(hit.contact)};break;
    }if(actor.ray)break;
  }assert.ok(actor.ray,id+' actual authored contact');actors.push(actor);phase('registered-'+id);
}
const pct=(s,p)=>s.slice().sort((a,b)=>a-b)[Math.min(s.length-1,Math.ceil(s.length*p)-1)];
// Restore the registered native arena before each independent sample. This preserves the
// production anti-state-forgery guards; combat_new alone intentionally cannot revive an owner.
const registeredArena=new Uint8Array(core.instance.exports.memory.buffer).slice();
const restoreRegistered=()=>new Uint8Array(core.instance.exports.memory.buffer).set(registeredArena);
function reportSummary(r){return {hit:r.hit,destroyed:r.caps?.destroyed,geometryContacts:r.geometry_contacts?.length||0,fragments:r.fragments?.length||0,fragmentHits:r.fragments?.filter(f=>f.hit).length||0,casingSegments:r.fragments?.filter(f=>f.source==='casing_fragment').length||0,casingSamples:new Set(r.fragments?.filter(f=>f.source==='casing_fragment').map(f=>f.fragment_id)).size,externalPrimaryBursts:r.bursts?.filter(b=>b.inside===false).length||0,crew:r.crew,modules:r.modules,events:r.events,reportSHA256:sha(JSON.stringify(r))};}
const cases=[];
for(const actor of actors)for(const shellId of ['hei_20_dm51','hei_35_kda']){
  const shell=data.projectiles[shellId];assert.ok(shell?.kind==='he'&&shell.explosive_mass_kg>0,shellId);
  restoreRegistered();
  const ray=actor.ray,dir=ray.end.map((q,k)=>q-ray.start[k]),length=Math.hypot(...dir),primary=combat.shoot(actor.key,plain(actor.fresh.state),{shell,origin:ray.start,dir:dir.map(q=>q/length),speed_ms:shell.muzzle_velocity_ms,distance_m:100,seed:1001,turret_yaw:0,finite_end:ray.end,replay_time_s:1});
  assert.ok(primary&&primary.outcome!=='miss',actor.id+' real primary contact');assert.equal(primary.caps.destroyed,false,actor.id+' primary fixture survives');
  let exteriorNormal=primary.normal?Array.isArray(primary.normal)?primary.normal.slice():[primary.normal.x,primary.normal.y,primary.normal.z]:dir.map(q=>-q/length);
  if(exteriorNormal.reduce((s,q,k)=>s+q*dir[k]/length,0)>0)exteriorNormal=exteriorNormal.map(q=>-q);
  const acceptedImpact=Array.isArray(primary.impact)?primary.impact:[primary.impact.x,primary.impact.y,primary.impact.z];
  const e={combatKey:actor.key,cstate:primary.state,caps:primary.caps,alive:true,veh:{body},turretYaw:0,combat,bundle:actor.bundle,model:actor.model,pose(){}};
  for(const mode of ['source-queued','registered-same-point','legacy-plane-control']){
    const times=[],coreTimes=[],proofs=[];let lastArgs=null;
    const originalNB=combat.nearBurst;combat.nearBurst=function(...xs){lastArgs={point:plain(xs[2]),shell:plain(xs[3]),plates:xs[8]??false,includePressure:xs[9]??true};return Reflect.apply(originalNB,this,xs);};
    const reset=()=>{countCalls=false;restoreRegistered();const fresh=core.combatNew(actor.key),r=combat.shoot(actor.key,fresh.state,{shell,origin:ray.start,dir:dir.map(q=>q/length),speed_ms:shell.muzzle_velocity_ms,distance_m:100,seed:1001,turret_yaw:0,finite_end:ray.end,replay_time_s:1});countCalls=true;e.cstate=r.state;e.caps=r.caps;e.alive=true;};
    const invoke=i=>{let r;
      if(mode==='source-queued'){assert.equal(a.queue.length,0);const rep=plain(primary);a.heContactEffects(e,shell,ray.point,dir.map(q=>q/length),rep,1);assert.equal(a.queue.length,1,'real contact must use source queue');a.flushHeContactBursts((_,rep)=>{r=rep;},true);}
      else{const point=acceptedImpact.map((q,k)=>q+exteriorNormal[k]*.001);r=combat.nearBurst(actor.key,e.cstate,point,shell,0,1000+i,null,1,mode==='legacy-plane-control',false);}
      assert.ok(r,actor.id+' '+mode+' real result');return r;
    };
    for(let i=0;i<warmup;i++){reset();invoke(i);}global.gc?.();Object.assign(counters,{coreCalls:0,coreMs:0,coreOps:{},ownerPoses:0,shapeValidations:0,matrixCollections:0});const cpu={user:0,system:0};
    for(let i=0;i<samples;i++){reset();const previous=counters.coreMs,cpuStart=process.cpuUsage(),t=performance.now(),r=invoke(i);times.push(performance.now()-t);const used=process.cpuUsage(cpuStart);cpu.user+=used.user;cpu.system+=used.system;coreTimes.push(counters.coreMs-previous);if(i===0||i===samples-1)proofs.push(reportSummary(r));}
    combat.nearBurst=originalNB;
    const c={actor:actor.id,shell:shellId,mode,samples,warmup,actualArguments:lastArgs,primary:{outcome:primary.outcome,layers:primary.layers,bursts:primary.bursts,geometryContacts:primary.geometry_contacts?.length||0},timing:{meanMs:times.reduce((s,v)=>s+v,0)/samples,p50Ms:pct(times,.5),p95Ms:pct(times,.95),maxMs:Math.max(...times),cpuUserMs:cpu.user/1000,cpuSystemMs:cpu.system/1000,coreMeanMs:coreTimes.reduce((s,v)=>s+v,0)/samples,coreP95Ms:pct(coreTimes,.95),samplesMs:times},stats:plain(counters),proofs};cases.push(c);phase(actor.id+' '+shellId+' '+mode+' p50='+c.timing.p50Ms.toFixed(3)+' p95='+c.timing.p95Ms.toFixed(3));
  }
}
const models=actors.map(x=>({id:x.id,geometrySHA256:x.geometrySHA256,manifestSHA256:x.packet.manifestHash,catalogSHA256:x.packet.catalogHash,triangles:x.record.buffers.reduce((s,b)=>s+b.vertexCount/3,0),instances:x.record.rows.length,buffers:x.record.buffers.length,ray:x.ray}));
combat.surfaceOwner.retire();for(const x of actors){x.interior.dispose();x.model.dispose();}assert.equal(renderer._live.size,0);assert.equal(combat.surfaceOwner.actors.size,0);
const receipt={schema:'TankForgeRegisteredHEContactCPUV3',createdUtc:new Date().toISOString(),root,app,fixtureSHA256:sha(fs.readFileSync(fileURLToPath(import.meta.url))),sourceSHA256:sha(source),embeddedSHA256,wasmSHA256:sha(wasm),wasmOrigin:'TF_APHE_SURFACE_CORE bytes embedded in each cohort app.js.html',models,cases,resources:{liveMeshesAfterDispose:renderer._live.size,surfaceActorsAfterRetire:combat.surfaceOwner.actors.size},scope:'CPU-only Node actual bundle runtime, exact cohort-embedded WASM/data, production model/interior/DamageVisuals builders and real triangle registration; authored positive-contact primary, native registered-arena restoration and actual primary contact outside each timed repetition (combat_new alone does not bypass anti-state-forgery guards), actual source contact queue. Registered-same-point and legacy-plane controls use accepted primary impact plus the production incoming-facing normal at 1mm exterior with raw source shell and request exclusion of already-recorded primary pressure; R7 ignores that new argument, so externalPrimaryBursts records the actual policy. Source-queue call sites always use each exact cohort function, including its actual accepted-point versus supplied-point policy. Renderer upload sink; no browser, GPU, audio, real-time sustained battle, or FPS claim.'};
fs.writeFileSync(out,JSON.stringify(receipt,null,2),{flag:'wx'});console.log(JSON.stringify({out,sourceSHA256:receipt.sourceSHA256,wasmSHA256:receipt.wasmSHA256}));
