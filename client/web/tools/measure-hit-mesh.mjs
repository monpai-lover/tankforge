// CPU static diagnostic costs; no gameplay, browser, FPS claim, or geometry simplification.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { loadData } from './load-data.mjs';
import { loadCoreSync } from '../src/design/core.js';
import { sha } from './hit-mesh-capture.mjs';
import { GEOMETRY_SOURCE_PATHS } from './export-hit-mesh.mjs';
export const STATIC_IDS=['de_hetzer','us_m901_itv','su_att_m46','xp_bmp_k64'];
export const STATIC_QUERIES=[{key:'side',a:[-10,1,0],b:[10,1,0]},{key:'longitudinal',a:[0,1,-10],b:[0,1,10]},{key:'oblique',a:[-8,2,-8],b:[8,.5,8]},{key:'outside',a:[10,10,10],b:[11,11,11]}];
const ROOT=fileURLToPath(new URL('../../../',import.meta.url));
const summary=s=>{const sorted=s.slice().sort((a,b)=>a-b);return{samples:s.length,minMs:sorted[0],p50Ms:sorted[Math.floor(sorted.length*.5)],p95Ms:sorted[Math.floor(sorted.length*.95)],maxMs:sorted.at(-1),meanMs:s.reduce((n,v)=>n+v,0)/s.length};};
export function measureStaticWasm(wasmPath=process.env.TG_TEST_WASM || path.join(ROOT,'target/wasm32-unknown-unknown/release/tg_design_wasm.wasm')){
  const wasm=fs.readFileSync(wasmPath),data=loadData(),index=JSON.parse(fs.readFileSync(path.join(ROOT,'data/hit-meshes/index.json')));
  const core=loadCoreSync(wasm,{materials:data.materials,catalog:data.designCatalog,terrains:Object.values(data.terrains)});
  const cases=[];let peakLinearMemoryBytes=core.instance.exports.memory.buffer.byteLength;
  const timed=fn=>{const start=performance.now(),value=fn();peakLinearMemoryBytes=Math.max(peakLinearMemoryBytes,core.instance.exports.memory.buffer.byteLength);return{value,ms:performance.now()-start};};
  for(const specId of STATIC_IDS){
    const entry=index.entries.find(e=>e.specId===specId),text=fs.readFileSync(path.join(ROOT,'data/hit-meshes',entry.manifestFile),'utf8'),manifest=JSON.parse(text);
    const payloads=[...new Set(manifest.meshes.map(m=>m.payloadHash))].map(hash=>[hash,fs.readFileSync(path.join(ROOT,'data/hit-meshes',`${hash}.bin`))]);
    const leases=[],scenes=[];const beforeLinearMemoryBytes=core.instance.exports.memory.buffer.byteLength;let finalRelease;
    try{
      const install=timed(()=>payloads.forEach(([hash,bytes])=>leases.push(core.combatGeometryInstall(bytes,hash).handle)));
      const cold=timed(()=>core.combatGeometryRegister(text,entry.manifestHash,leases));scenes.push(cold.value.handle);
      const context={entityId:`cost:${specId}:0`,spawnEpoch:1,buildHash:manifest.buildHash,poseRevision:1};
      const queryEvidence=STATIC_QUERIES.map(q=>{const t=timed(()=>core.combatGeometryTrace(scenes[0],q.a,q.b,context,4096));return{key:q.key,coldQueryMs:t.ms,crossings:t.value.crossings.length,stats:t.value.stats,memory:t.value.memory};});
      const samples=[],warmWork={samples:0,tlasNodeVisits:0,blasNodeVisits:0,tlasBoundsTests:0,blasBoundsTests:0,triangleTests:0,rawCrossings:0,crossings:0,occupancyTriangleTests:0,occupancyPointTests:0,occupancyRayAttempts:0,occupancyPredicateProducts:0};for(let round=0;round<25;round++)for(const q of STATIC_QUERIES){const t=timed(()=>core.combatGeometryTrace(scenes[0],q.a,q.b,context,4096));samples.push(t.ms);warmWork.samples++;for(const k of Object.keys(warmWork).filter(k=>k!=='samples'))warmWork[k]+=t.value.stats[k];}
      const actors=[];for(let actor=1;actor<8;actor++){const reg=timed(()=>core.combatGeometryRegister(text,entry.manifestHash,leases));scenes.push(reg.value.handle);const q=STATIC_QUERIES[0],ctx={...context,entityId:`cost:${specId}:${actor}`};const trace=timed(()=>core.combatGeometryTrace(reg.value.handle,q.a,q.b,ctx,4096));if(trace.value.crossings.some(h=>h.entityId!==ctx.entityId))throw new Error('shared BLAS aliased actor identity');actors.push({actor,registerMs:reg.ms,traceMs:trace.ms,stats:trace.value.stats,storeMemory:reg.value.storeMemory});}
      cases.push({specId,manifestHash:entry.manifestHash,manifestBytes:Buffer.byteLength(text),serializedPayloadBytes:payloads.reduce((n,[,b])=>n+b.length,0),declaredMeshes:manifest.meshes.length,physicalInstances:manifest.meshInstances.length,possibleTriangles:manifest.meshInstances.reduce((n,i)=>n+manifest.meshes.find(m=>m.key===i.meshKey).triangleCount,0),coldInstallMs:install.ms,coldRegisterMs:cold.ms,storeMemory:cold.value.storeMemory,sceneMemory:queryEvidence[0].memory,queryEvidence,warm:summary(samples),warmWork,sameManifestActors:actors,beforeLinearMemoryBytes});
    }finally{for(const h of scenes)finalRelease=core.combatGeometryRelease(h);for(const h of leases)finalRelease=core.combatGeometryRelease(h);}
    if(finalRelease.immutableMeshes||finalRelease.payloadBytes||finalRelease.sceneHandles||finalRelease.meshHandles||finalRelease.sceneArrayBytes||finalRelease.storeMemory.blasArrayBytes||finalRelease.storeMemory.vertexIndexArrayBytes)throw new Error('geometry ownership did not return to zero');
    cases.at(-1).dispose={...finalRelease,blasArrayBytes:finalRelease.storeMemory.blasArrayBytes,vertexIndexArrayBytes:finalRelease.storeMemory.vertexIndexArrayBytes};cases.at(-1).afterDisposeLinearMemoryBytes=core.instance.exports.memory.buffer.byteLength;
  }
  const kernelPaths=GEOMETRY_SOURCE_PATHS;
  return{schema:'ExactHitStaticCostV1',backend:'actual_release_wasm',wasmHash:sha(wasm),kernelPins:Object.fromEntries(kernelPaths.map(p=>[p,sha(fs.readFileSync(path.join(ROOT,p)))])),timingScope:'DesignCore JSON serialization + ABI + shared Rust geometry query; disk reads excluded',visitDefinition:'node visits are actual traversal stack pops including rejected nodes; boundsTests also counts child ordering tests; structural node counts are separate',memoryScope:'actual WASM linear-memory high-water and Vec-capacity geometry arrays; maps/strings/JSON scratch are included only in linear-memory high-water; pages remain reserved after lease disposal',queries:STATIC_QUERIES,cases,peakLinearMemoryBytes,nodeProcessMemory:process.memoryUsage()};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){const receipt=measureStaticWasm();fs.writeFileSync(process.env.TG_HIT_WASM_COST_RECEIPT || path.join(ROOT,'target/exact-hit-static-wasm-cost.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt.cases.map(c=>({specId:c.specId,coldInstallMs:c.coldInstallMs,coldRegisterMs:c.coldRegisterMs,warmP50Ms:c.warm.p50Ms,triangleTests:c.queryEvidence.map(q=>q.stats.triangleTests),disposedMeshes:c.dispose.immutableMeshes}))));}
