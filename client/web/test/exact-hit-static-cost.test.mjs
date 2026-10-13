import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { measureStaticWasm,STATIC_IDS } from '../tools/measure-hit-mesh.mjs';
import { sha } from '../tools/hit-mesh-capture.mjs';
const root=new URL('../../../',import.meta.url);
test('static native and actual release WASM costs measure cold warm sharing and disposal without an FPS threshold',()=>{
  const native=JSON.parse(fs.readFileSync(process.env.TG_HIT_NATIVE_COST_RECEIPT || new URL('target/exact-hit-static-native-cost.json',root))),wasm=measureStaticWasm();assert.equal(native.schema,'ExactHitStaticCostV1');assert.equal(native.backend,'actual_native');
  const geometry=JSON.parse(fs.readFileSync(process.env.TG_GEOMETRY_RECEIPT || new URL('target/exact-hit-geometry-native.json',root)));
  for(const result of [native,wasm]){
    assert.deepEqual(Object.keys(result.kernelPins).sort(),Object.keys(geometry.sourcePins).sort(),`${result.backend} static costs must pin the complete geometry/export/measurement/test source set`);
    assert.deepEqual(result.cases.map(c=>c.specId),STATIC_IDS);assert.equal(result.queries.length,4);
    for(const[p,hash]of Object.entries(result.kernelPins))assert.equal(sha(fs.readFileSync(new URL(p,root))),hash,`stale static cost source ${p}`);
    for(const c of result.cases){assert.ok(c.coldInstallMs>=0&&c.coldRegisterMs>=0&&c.warm.samples===100);assert.ok(c.queryEvidence.some(q=>q.stats.triangleTests>0));assert.ok(c.queryEvidence.every(q=>q.stats.triangleTests<=c.possibleTriangles));assert.equal(c.sameManifestActors.length,7);assert.ok(c.sameManifestActors.every(a=>a.storeMemory.immutableMeshes===c.storeMemory.immutableMeshes));assert.equal(c.dispose.immutableMeshes,0);assert.equal(c.dispose.payloadBytes,0);assert.equal(c.dispose.blasArrayBytes,0);assert.equal(c.dispose.sceneArrayBytes,0);}
  }
  for(let i=0;i<wasm.cases.length;i++){assert.equal(wasm.cases[i].manifestHash,native.cases[i].manifestHash);assert.deepEqual(wasm.cases[i].queryEvidence.map(q=>({key:q.key,tlasNodeVisits:q.stats.tlasNodeVisits,blasNodeVisits:q.stats.blasNodeVisits,triangleTests:q.stats.triangleTests,crossings:q.crossings})),native.cases[i].queryEvidence.map(q=>({key:q.key,tlasNodeVisits:q.stats.tlasNodeVisits,blasNodeVisits:q.stats.blasNodeVisits,triangleTests:q.stats.triangleTests,crossings:q.crossings})));assert.deepEqual(wasm.cases[i].warmWork,native.cases[i].warmWork);}
  fs.writeFileSync(process.env.TG_HIT_WASM_COST_RECEIPT || new URL('target/exact-hit-static-wasm-cost.json',root),JSON.stringify(wasm,null,2));
});
