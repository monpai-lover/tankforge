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
const root=path.resolve(opt('--root')),out=path.resolve(opt('--out')); 
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
vm.runInContext(source.replace(/^<script>/,'').slice(0,end-'<script>'.length)+`\nglobalThis.actual={bulletShell,Enemy,buildTank,buildInterior,makeLoadout,generatedTurretParts,setCrewModel,setMgModels,Renderer,Combat,DesignCore,damageVisualsFor,surfaceCollisionQuery,heContactEffects,flushHeContactBursts,queue:HE_CONTACT_QUEUE,install:typeof installReviewedFoldableSurfacePackets==='function'?installReviewedFoldableSurfacePackets:null};})();`,context);
const a=context.actual;a.install?.(data);const readJSON=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
a.setCrewModel(readJSON('client/web/assets/crew_model.json'));a.setMgModels(readJSON('client/web/assets/mg_models.json'));
const core=new a.DesignCore(new WebAssembly.Instance(new WebAssembly.Module(wasm),{}),{materials:data.materials,catalog:data.designCatalog,terrains:Object.values(data.terrains)}),combat=new a.Combat(core,data.machineGuns);
let serial=0;const gl={ARRAY_BUFFER:1,FLOAT:2,STATIC_DRAW:3,DYNAMIC_DRAW:4,createVertexArray:()=>({vao:++serial}),createBuffer:()=>({buffer:++serial}),bindVertexArray(){},bindBuffer(){},bufferData(){},bufferSubData(){},enableVertexAttribArray(){},vertexAttribPointer(){},vertexAttribDivisor(){},deleteVertexArray(){},deleteBuffer(){},getExtension:()=>true};
const renderer=Object.assign(Object.create(a.Renderer.prototype),{gl,_live:new Set(),_texSrc:new Map(),lost:false});
combat.setSurfaceCatalog(data.surfaceCatalog,renderer);combat.replayTime=()=>1;
const body={ex:[1,0,0],ey:[0,1,0],ez:[0,0,1],origin:()=>[0,0,0],worldPoint:p=>p.slice(),localPoint:p=>p.slice(),worldDir:p=>p.slice(),localDir:p=>p.slice()};

const fixtures=[
 ['us_m8','front nose',[.5,.733,12],[.5,.733,-12]],
 ['de_hetzer','front sponson',[1,1.5,12],[1,1.5,-12]],
 ['su_is2','turret side',[12,2,.3],[-12,2,.3]],
 ['su_t54','turret side',[12,2,.2],[-12,2,.2]],
 ['us_m4a1_76w','upper side',[12,1.4,0],[-12,1.4,0]],
 ['de_panther_g','turret corner',[.8,2.3,12],[.8,2.3,-12]],
 ['de_sdkfz234_2','right turret front chamfer',[20,2,1],[-20,2,1]],
 ['de_sdkfz234_2','Saukopf rear cap after authored front',[0,2,20],[0,2,-20]],
 ['us_m8','own 37 mm against thin side',[12,1.24,-.5],[-12,1.24,-.5],'ap_37_m74'],
 ['us_m8','rifle MG against closed nose',[.5,.733,12],[.5,.733,-12],'mg34','block'],
 ['us_m8','rifle MG through actual open turret',[.25,12,-.14],[.25,1.65,-.14],'mg34','open'],
];
const results=[];
for(const[index,[id,label,origin,end,shellId='apfsds_125_3bm22',expected='penetrate']]of fixtures.entries()){
 const key='penetration-regression-'+index+'-'+id,bundle=combat.prepare(key,data.vehicles[id]),fresh=combat.fresh(key,bundle),loadout=a.makeLoadout(id,bundle,data.projectiles,data.machineGuns),model=a.buildTank(renderer,loadout,a.generatedTurretParts),interior=a.buildInterior(renderer,model,loadout,bundle.modules,bundle.crew);
 model.root.pos=[0,0,0];model.root.yaw=0;model.setFold?.(0);a.Enemy.prototype.poseGuns.call({model,loadout,turretYaw:0,alive:true,gunPitch:[]});model.root.update();a.damageVisualsFor(renderer,model,fresh.caps,fresh.state,bundle.modules);
 const record=combat.registerSurfaceActor(key,id,{battle:8271,entity:index+1,life:1},model,body);assert.ok(record?.available,id+':'+record?.detail);
 const shell=shellId==='mg34'?a.bulletShell(data.machineGuns.mg34):data.projectiles[shellId];assert.ok(shell);
 const chord=end.map((q,k)=>q-origin[k]),l=Math.hypot(...chord),r=combat.shoot(key,fresh.state,{shell,origin,dir:chord.map(q=>q/l),speed_ms:shell.muzzle_velocity_ms,distance_m:100,seed:1001,turret_yaw:0,finite_end:end,replay_time_s:1});
 assert.ok(r,id+' must resolve a report');
 results.push({id,label,shellId,expected,origin,end,outcome:r.outcome,events:r.events,layers:r.layers,crew:r.state.crew,modules:r.state.modules,contacts:(r.primary_geometry_contacts||[]).map(c=>({role:c.physicalRole,point:c.point,mesh:c.meshId,triangle:c.triangleId})),passed:r.layers.some(l=>l.passed),unsupported:r.events.includes('unsupported_surface_resistance')});
 combat.surfaceOwner.retire();interior.dispose();model.dispose();assert.equal(renderer._live.size,0);
}
const receipt={schema:'TankForgePenetrationRegressionV1',sourceSHA256:sha(source),wasmSHA256:sha(wasm),embeddedSHA256,results};fs.writeFileSync(out,JSON.stringify(receipt,null,2),{flag:'wx'});
for(const r of results){console.log(JSON.stringify({id:r.id,outcome:r.outcome,passed:r.passed,unsupported:r.unsupported,layers:r.layers.map(l=>({plate:l.plate,passed:l.passed})),crew:r.crew}));}
assert.deepEqual(results.filter(r=>r.expected==='penetrate'?(!r.passed||r.unsupported):r.expected==='block'?(r.passed||r.unsupported||r.layers.length===0||r.crew.some(hp=>hp<100)):(!r.crew.some(hp=>hp<100)||r.contacts[0]?.role!=='crew')).map(r=>r.id+':'+r.label),[], 'high-energy normal-side/front shots must reach real armor and continue; unreviewed surfaces must not turn these ordinary vulnerable paths invincible');
