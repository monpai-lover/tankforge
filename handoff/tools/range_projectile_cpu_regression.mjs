#!/usr/bin/env node
// CPU-only regression environment: actual RANGE fleet, uploaded geometry,
// DamageVisuals, ballistics and exact combat WASM. No browser/GPU/FPS claim.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {rendererSink} from '../../client/web/tools/hit-mesh-capture.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const argv=process.argv.slice(2),option=(name,fallback=null)=>{const i=argv.indexOf(name);return i<0?fallback:argv[i+1];};
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const readJSON=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const plain=value=>JSON.parse(JSON.stringify(value));
const memory=()=>{const m=process.memoryUsage();return Object.fromEntries(['rss','heapUsed','external','arrayBuffers'].map(k=>[k,m[k]]));};
function bodyAt(x,z,yaw=0){
  const ex=[Math.cos(yaw),0,-Math.sin(yaw)],ey=[0,1,0],ez=[Math.sin(yaw),0,Math.cos(yaw)],o=[x,0,z];
  return {ex,ey,ez,origin:()=>o.slice(),worldPoint:p=>o.map((v,k)=>v+ex[k]*p[0]+ey[k]*p[1]+ez[k]*p[2]),
    localPoint:p=>[ex,ey,ez].map(axis=>axis.reduce((v,a,k)=>v+a*(p[k]-o[k]),0))};
}
function embedded(){
  const dir=path.join(root,'handoff/bundle');
  const raw=fs.existsSync(path.join(dir,'data.line'))?fs.readFileSync(path.join(dir,'data.line')):zlib.gunzipSync(Buffer.concat(fs.readdirSync(dir).filter(n=>n.startsWith('data.line.gz.part')).sort().map(n=>fs.readFileSync(path.join(dir,n)))));
  function field(name){
    const marker=Buffer.from(JSON.stringify(name)+':');let i=raw.indexOf(marker)+marker.length;assert.ok(i>=marker.length,name);const start=i;
    let depth=0,quote=false,escape=false;
    for(;i<raw.length;i++){const b=raw[i];if(quote){if(escape)escape=false;else if(b===92)escape=true;else if(b===34)quote=false;continue;}if(b===34)quote=true;else if(b===123||b===91)depth++;else if((b===125||b===93)&&--depth===0)return JSON.parse(raw.subarray(start,i+1));}
    throw Error('Unterminated embedded source '+name);
  }
  return {...Object.fromEntries(['materials','designCatalog','terrains','projectiles','machineGuns','vehicles','surfaceCatalog'].map(k=>[k,field(k)])),embeddedSHA256:sha(raw)};
}
function functionSource(source,name){
  const marker='function '+name+'(',a=source.indexOf(marker);assert.ok(a>=0,'Actual function '+name);assert.equal(source.indexOf(marker,a+marker.length),-1,'One actual '+name);
  let start=source.indexOf('{',a),depth=0,quote=null,escape=false,line=false,comment=false;
  for(let i=start;i<source.length;i++){
    const c=source[i],n=source[i+1];
    if(line){if(c==='\n')line=false;continue;}if(comment){if(c==='*'&&n==='/'){comment=false;i++;}continue;}
    if(quote){if(escape)escape=false;else if(c==='\\')escape=true;else if(c===quote)quote=null;continue;}
    if(c==='/'&&n==='/'){line=true;i++;continue;}if(c==='/'&&n==='*'){comment=true;i++;continue;}
    if(c==='"'||c==="'"||c==='`'){quote=c;continue;}if(c==='{')depth++;if(c==='}'&&!--depth)return source.slice(a,i+1);
  }
  throw Error('Unclosed actual function '+name);
}
function surfaceRay(actor){
  const catalog=JSON.parse(actor.packet.catalog),decl=catalog.declarations.find(d=>d.role==='armor'&&d.armorBinding?.boundarySide==='outer');assert.ok(decl,actor.id+': authored outer armor');
  const b=actor.record.buffers.find(b=>'mesh:'+b.path===decl.meshKey);assert.ok(b);const p=new Float32Array(b.words.buffer,b.words.byteOffset,b.words.length),m=b.node.world;
  const point=p=>[0,1,2].map(k=>m[12+k]+p.reduce((s,v,i)=>s+m[i*4+k]*v,0));
  for(let t=decl.first;t<decl.first+decl.count;t++){
    const v=[0,1,2].map(k=>point(Array.from(p.subarray(t*9+k*3,t*9+k*3+3)))),center=[0,1,2].map(k=>v.reduce((s,p)=>s+p[k],0)/3),u=v[1].map((value,k)=>value-v[0][k]),w=v[2].map((value,k)=>value-v[0][k]);
    const n=[u[1]*w[2]-u[2]*w[1],u[2]*w[0]-u[0]*w[2],u[0]*w[1]-u[1]*w[0]],length=Math.hypot(...n);
    if(length>1e-8&&Number.isFinite(length))return {start:center.map((v,k)=>v+n[k]/length*.025),end:center.map((v,k)=>v-n[k]/length*.025),armor:decl.armorBinding.armorRefs[0]};
  }throw Error('No nondegenerate real surface ray '+actor.id);
}
function worker(){
  const app=path.resolve(option('--app')),result=path.resolve(option('--result')),frames=Number(option('--frames','24')),warmup=Number(option('--warmup','3'));
  assert.ok(frames>=12&&frames<=120&&warmup>=1&&warmup<=10);assert.ok(!fs.existsSync(result),'Refusing to overwrite worker result');
  const source=fs.readFileSync(app,'utf8'),end=source.indexOf('  // client/web/src/main.js');assert.ok(end>0);
  const started=performance.now(),phase=label=>console.log(JSON.stringify({phase:label,elapsedMs:performance.now()-started}));phase('read-source');
  let data=embedded(),context=vm.createContext({console,atob,btoa,TextEncoder,TextDecoder,performance,Float32Array,Float64Array,Uint32Array,Uint8Array,Uint16Array,Int32Array,Int16Array,Int8Array,ArrayBuffer,DataView,Map,Set,WeakMap,WeakSet,structuredClone});
  const stats={rootUpdates:0,coreTraces:0,coreCrossings:0,ownerPoses:0,shapeValidations:0,matrixCollections:0,queries:0,boundsCalls:0,verifiedMisses:0,boundsDeclined:0,projectileSegments:0,beams:0};
  const unexpected=name=>()=>{throw Error('Unexpected pressure-fixture branch '+name);};
  const game={mode:'battle',shots:[],enemies:[],air:null,online:null,time:0,s:{x:0,z:0},camPos:[0,25,0]};
  context.__game=game;context.__stats=stats;
  context.__sound={projectileSegment(){stats.projectileSegments++;},removeProjectile:unexpected('removeProjectile')};
  context.__fx={beam(){stats.beams++;},shellGround:unexpected('ground impact'),shellArmor:unexpected('armor impact')};
  const functions=['hitEnemy','hitSelf','updateShots'];if(source.includes('function updateShotsExactPhase('))functions.push('updateShotsExactPhase');
  const extracted=functions.map(name=>functionSource(source,name));
  const prelude=`
const G4=globalThis.__game,stats=globalThis.__stats,sound=globalThis.__sound,fx=globalThis.__fx,airBots={list:[]};
const surfaceAt=()=>0,buildingHit=(p0,p1)=>G4.map?G4.map.segmentHit(p0,p1):null;
const rangeTargets=()=>{throw Error('AA pressure rounds never call target boards');};
const TRACER={};
const countedBounds=surfaceCollisionBoundsMiss;surfaceCollisionBoundsMiss=function(...args){stats.boundsCalls++;const r=countedBounds(...args);if(r===true)stats.verifiedMisses++;if(r===null)stats.boundsDeclined++;return r;};
const countedQuery=surfaceCollisionQuery;surfaceCollisionQuery=function(...args){stats.queries++;return countedQuery(...args);};
`;
  vm.runInContext(source.replace(/^<script>/,'').slice(0,end-'<script>'.length)+prelude+'\n'+extracted.join('\n')+`
globalThis.actual={Enemy,buildTank,buildInterior,makeLoadout,generatedTurretParts,setCrewModel,setMgModels,Renderer,Combat,DesignCore,rangeVehicleTargets,newShot,stepShot,damageVisualsFor,surfaceCollisionQuery,updateShots,install:typeof installReviewedFoldableSurfacePackets==='function'?installReviewedFoldableSurfacePackets:null};})();`,context);
  let actual=context.actual;actual.install?.(data);actual.setCrewModel(readJSON('client/web/assets/crew_model.json'));actual.setMgModels(readJSON('client/web/assets/mg_models.json'));
  const embeddedSHA256=data.embeddedSHA256;phase('loaded-actual-runtime-and-data');
  const wasmPath=path.join(root,'target/wasm32-unknown-unknown/release/tg_design_wasm.wasm'),wasm=fs.readFileSync(wasmPath),beforeBuild=memory();
  let core=new actual.DesignCore(new WebAssembly.Instance(new WebAssembly.Module(wasm),{}),{materials:data.materials,catalog:data.designCatalog,terrains:Object.values(data.terrains)}),combat=new actual.Combat(core,data.machineGuns),sink=rendererSink(),renderer=Object.assign(Object.create(actual.Renderer.prototype),{gl:sink.gl,_live:new Set(),_texSrc:new Map(),lost:false});
  combat.setSurfaceCatalog(data.surfaceCatalog,renderer);combat.replayTime=()=>game.time;game.combat=combat;
  for(const [object,name,key]of [[core,'combatSurfaceTrace','coreTraces'],[combat.surfaceOwner,'pose','ownerPoses'],[combat.surfaceOwner,'validateShape','shapeValidations'],[combat.surfaceOwner,'matrices','matrixCollections']]){
    const original=object[name];object[name]=function(...args){stats[key]++;const r=Reflect.apply(original,this,args);if(key==='coreTraces')stats.coreCrossings+=r.crossings?.length||0;return r;};
  }
  const actors=[],targets=actual.rangeVehicleTargets();assert.equal(targets.length,15,'Actual source RANGE roster');
  const geometryHash=crypto.createHash('sha256');
  for(const [index,t]of [...targets,{id:'de_hetzer',x:0,z:0,heading:0,own:true}].entries()){
    const key='cpu-range-'+index,bundle=combat.prepare(key,data.vehicles[t.id]),fresh=combat.fresh(key,bundle),loadout=actual.makeLoadout(t.id,bundle,data.projectiles,data.machineGuns),model=actual.buildTank(renderer,loadout,actual.generatedTurretParts),interior=actual.buildInterior(renderer,model,loadout,bundle.modules,bundle.crew),body=bodyAt(t.x,t.z,t.heading);
    model.root.pos=body.origin();model.root.yaw=t.heading;model.setFold?.(0);actual.Enemy.prototype.poseGuns.call({model,loadout,turretYaw:0,alive:true,gunPitch:[]});model.root.update();
    actual.damageVisualsFor(renderer,model,fresh.caps,fresh.state,bundle.modules);
    assert.ok(model.damageVisuals,'Actual hidden DamageVisuals owner is primed');
    const supported=combat.surfaceOwner.supports(t.id),record=combat.registerSurfaceActor(key,t.id,{battle:263,entity:index+1,life:1},model,body);if(supported)assert.equal(record?.available,true,t.id+': '+record?.detail);else assert.equal(record,null,'Preserve actual source fallback where no exact packet exists');
    const packet=supported?combat.surfaceOwner.packet(t.id):null,actor={id:t.id,key,bundle,fresh,loadout,model,interior,body,record,packet};actors.push(actor);
    geometryHash.update(t.id+'\n'+(packet?.manifestHash||'source-unregistered')+'\n');
    const hashNode=node=>{if(node.damageVisual)return;if(node.mesh?._src?.data){const d=node.mesh._src.data;geometryHash.update(Buffer.from(d.buffer,d.byteOffset,d.byteLength));}for(const child of node.children)hashNode(child);};hashNode(model.root);
    const update=model.root.update;model.root.update=function(...args){stats.rootUpdates++;return Reflect.apply(update,this,args);};
    if(t.own)Object.assign(game,{model,veh:{body},combatKey:key,loadout,dims:{front:4,rear:-4,width:4}});
    else{const h=bundle.vehicle.hull.size_m,ts=bundle.vehicle.turret.size_m||[0,0,0];game.enemies.push(Object.assign(Object.create(actual.Enemy.prototype),{id:t.id,combat,combatKey:key,veh:{body},model,alive:true,remote:false,x:t.x,z:t.z,turret:bundle.vehicle.turret,turretYaw:0,fold:0,radius:Math.hypot(h[0],h[2])/2,box:{hw:h[0]/2,hl:h[2]/2,top:h[1]+(ts[1]||0)},plates:(bundle.armor||[]).map(p=>({id:p.id,zone:p.zone,turret:/^turret|mantlet|gun/.test(p.zone||p.id),t:p.thickness_mm,c:[p.center.x,p.center.y,p.center.z],n:[p.normal.x,p.normal.y,p.normal.z],u:[p.axis_u.x,p.axis_u.y,p.axis_u.z],hu:p.half_u,hv:p.half_v,def:p}))}));}
    phase('built-model-'+index+'-'+t.id);
  }
  const probes=[];
  for(const actor of actors.filter(a=>a.record)){const ray=surfaceRay(actor),hit=actual.surfaceCollisionQuery(combat,actor.key,ray.start,ray.end,game.time);assert.ok(hit.ready&&hit.contact,'Known authored triangle contact '+actor.id);probes.push({id:actor.id,key:actor.key,contact:plain(hit.contact),armor:ray.armor});}
  const actor=actors.find(a=>a.id==='de_pz3_j'),ray=surfaceRay(actor),localA=actor.body.localPoint(ray.start),localB=actor.body.localPoint(ray.end),direction=localB.map((v,k)=>v-localA[k]),length=Math.hypot(...direction),shell=Object.values(data.projectiles).find(p=>p.kind==='apcbc'&&p.caliber_mm>=50);
  assert.ok(shell,'Actual source armor-piercing round');
  const report=core.combatSurfaceShoot(actor.key,plain(actor.fresh.state),{shell,origin:localA,dir:direction.map(v=>v/length),speed_ms:500,distance_m:100,seed:'987',turret_yaw:0},localB);
  const damageProof=plain(Object.fromEntries(['outcome','layers','state','caps','events'].map(k=>[k,report[k]])));
  phase('verified-physical-positive-controls');
  const aa=Object.values(data.projectiles).find(p=>p.caliber_mm===35&&p.kind==='he')||Object.values(data.projectiles).find(p=>p.caliber_mm===35);assert.ok(aa&&aa.muzzle_velocity_ms>0,'Actual source 35 mm AA round');
  for(let i=0;i<71;i++){
    const pos=[(i%9-4)*9,20+(i%5),650+(i%11)*11],dir=[Math.sin(i*.13)*.07,.005,-Math.sqrt(1-.005**2-(Math.sin(i*.13)*.07)**2)];
    game.shots.push({s:actual.newShot(pos,dir,aa),shell:aa,from:-1,ownAir:false,age:0,travelled:0,origin:pos.slice(),selfDestructS:5});
  }
  const snapshot=()=>game.shots.map(sh=>({pos:sh.s.pos.slice(),vel:sh.s.vel.slice(),age:sh.age,travelled:sh.travelled}));
  const dt=1/60;
  for(let i=0;i<warmup;i++){game.time+=dt;actual.updateShots(dt);assert.equal(game.shots.length,71);}
  global.gc?.();const beforeTimed=memory(),warmStats={...stats};for(const key of Object.keys(stats))stats[key]=0;
  const samples=[],cpuStart=process.cpuUsage(),wallStart=performance.now();
  for(let i=0;i<frames;i++){game.time+=dt;const start=performance.now();actual.updateShots(dt);samples.push(performance.now()-start);assert.equal(game.shots.length,71,'Identical no-contact AA workload retains every shell');}
  const wallMs=performance.now()-wallStart,cpu=process.cpuUsage(cpuStart),afterTimed=memory(),pressureStats={...stats},finalShots=snapshot();
  assert.equal(stats.projectileSegments,71*4*frames,'Actual low-flight updateShots executes four 240 Hz substeps');assert.equal(stats.queries,71*4*16*frames,'All 15 exact RANGE actors and own exact actor are queried per substep');assert.equal(stats.coreCrossings,0,'No pressure segment is an actual physical contact');
  const physicalProof={roster:targets.map(t=>({id:t.id,x:t.x,z:t.z,heading:t.heading,ad:t.ad})),geometrySHA256:geometryHash.digest('hex'),probes,damageProof,finalShots};
  const models=actors.map(a=>({id:a.id,key:a.key,exactRegistered:!!a.record,triangles:a.record?.buffers.reduce((s,b)=>s+b.vertexCount/3,0)??null,buffers:a.record?.buffers.length??null,hiddenMirrorCount:[...a.model.damageVisuals.guns.values()].filter(Boolean).length}));
  combat.surfaceOwner.retire();for(const a of actors){a.interior.dispose();a.model.dispose();}assert.equal(combat.surfaceOwner.actors.size,0);assert.equal(renderer._live.size,0,'All real uploaded tank/interior/damage meshes are freed');
  const resources={liveMeshesAfterDispose:renderer._live.size,surfaceActorsAfterRetire:combat.surfaceOwner.actors.size};
  game.shots.length=0;game.enemies.length=0;for(const key of ['model','veh','combat','loadout'])delete game[key];actors.length=0;actual=null;context=null;core=null;combat=null;renderer=null;sink=null;data=null;global.gc?.();const afterCleanup=memory();
  const sorted=samples.slice().sort((a,b)=>a-b),out={schema:'TankForgeRangeProjectileCPURegressionWorkerV1',app,appSHA256:sha(source),embeddedSHA256,wasmSHA256:sha(wasm),frames,warmup,dt,rounds:71,actors:16,models,actualFunctions:Object.fromEntries([...functions,'newShot','stepShot'].map(name=>[name,sha(functionSource(source,name))])),scope:'CPU only; actual RANGE ground fleet; source exact surfaces where registered and unchanged source fallback where absent; flat ground at 0m; rounds 20-24m; no aircraft/board/building contacts; audio and tracer presentation sinks; no GPU or FPS claim',stats:pressureStats,warmupStats:warmStats,timing:{samplesMs:samples,meanMs:samples.reduce((s,v)=>s+v,0)/samples.length,medianMs:sorted[Math.floor(sorted.length/2)],p95Ms:sorted[Math.floor(sorted.length*.95)],wallMs,cpuUserMs:cpu.user/1000,cpuSystemMs:cpu.system/1000},memory:{beforeBuild,beforeTimed,afterTimed,afterCleanup},resources,physicalProofSHA256:sha(JSON.stringify(physicalProof)),physicalProof};
  fs.writeFileSync(result,JSON.stringify(out,null,2),{flag:'wx'});console.log(JSON.stringify({result,meanMs:out.timing.meanMs,stats:out.stats,resources}));
}
function main(){
  const before=path.resolve(option('--before')),after=path.resolve(option('--after')),out=path.resolve(option('--out'));assert.ok(!fs.existsSync(out),'Fresh output directory required');fs.mkdirSync(out,{recursive:true});
  const snapshots={before:path.join(out,'cohort-before.html'),after:path.join(out,'cohort-after.html')};for(const [name,file]of Object.entries({before,after}))fs.writeFileSync(snapshots[name],fs.readFileSync(file),{flag:'wx'});
  assert.equal(sha(fs.readFileSync(snapshots.before)),option('--expected-before','1c5607d177bbc3213e2aba442abcf23f2d13798f0e5023e26dba9b3eee7defb3'),'Exact requested before cohort');assert.notEqual(sha(fs.readFileSync(snapshots.before)),sha(fs.readFileSync(snapshots.after)),'Before and after builds must differ');
  const runs=[];
  for(const label of ['before','after']){
    const result=path.join(out,label+'.json'),args=['--expose-gc','--max-old-space-size=4096',fileURLToPath(import.meta.url),'--worker','--app',snapshots[label],'--result',result,'--frames',option('--frames','24'),'--warmup',option('--warmup','3')];
    const p=spawnSync(process.execPath,args,{encoding:'utf8',maxBuffer:16*1024*1024,timeout:240000});fs.writeFileSync(path.join(out,label+'.log'),p.stdout+p.stderr,{flag:'wx'});assert.equal(p.status,0,label+': '+p.stderr);runs.push(JSON.parse(fs.readFileSync(result,'utf8')));
  }
  assert.equal(runs[0].physicalProofSHA256,runs[1].physicalProofSHA256,'Projectile states, exact authored contacts and real damage results must remain byte-identical');
  assert.equal(runs[0].embeddedSHA256,runs[1].embeddedSHA256);assert.equal(runs[0].wasmSHA256,runs[1].wasmSHA256);
  const summary={schema:'TankForgeRangeProjectileCPURegressionV1',createdUtc:new Date().toISOString(),inputs:{before:{path:before,sha256:runs[0].appSHA256},after:{path:after,sha256:runs[1].appSHA256}},wasmSHA256:runs[0].wasmSHA256,physicalParity:true,physicalProofSHA256:runs[0].physicalProofSHA256,frames:runs[0].frames,rounds:71,actors:16,before:{timing:runs[0].timing,stats:runs[0].stats,resources:runs[0].resources},after:{timing:runs[1].timing,stats:runs[1].stats,resources:runs[1].resources},meanCPUWallSpeedup:runs[0].timing.meanMs/runs[1].timing.meanMs,scope:runs[1].scope};
  fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify(summary,null,2),{flag:'wx'});assert.ok(runs[1].stats.rootUpdates<runs[0].stats.rootUpdates/4,'Fixed real graph validation count must fall by at least four times');assert.ok(runs[1].stats.coreTraces<runs[0].stats.coreTraces/4,'Fixed real exact-core invocation count must fall by at least four times');console.log(JSON.stringify(summary));
}
if(argv.includes('--worker'))worker();else main();
