import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { sha } from '../tools/hit-mesh-capture.mjs';
import { loadCoreSync } from '../src/design/core.js';
import { loadData } from '../tools/load-data.mjs';
import { GEOMETRY_SOURCE_PATHS,GENERATOR_SOURCE_PATHS } from '../tools/export-hit-mesh.mjs';
const root=new URL('../../../',import.meta.url);
const receiptPath=process.env.TG_GEOMETRY_RECEIPT || new URL('target/exact-hit-geometry-native.json',root);
const receipt=JSON.parse(fs.readFileSync(receiptPath,'utf8'));
const retainedPins=[
  'Cargo.toml','Cargo.lock','crates/combat/Cargo.toml','crates/combat/src/lib.rs',
  'crates/combat/src/geometry/mod.rs','crates/combat/src/geometry/manifest.rs','crates/combat/src/geometry/bvh.rs','crates/combat/src/geometry/ray.rs','crates/combat/src/geometry/surface.rs','crates/combat/src/geometry/tests.rs',
  'crates/design-wasm/src/lib.rs','crates/design-wasm/src/geometry_diagnostic.rs','client/web/src/design/core.js','client/web/src/gfx/imported.js',
  'client/web/tools/export-hit-mesh.mjs','client/web/tools/hit-mesh-capture.mjs','schemas/hit-mesh.schema.json',
  'client/web/test/exact-hit-mesh.test.mjs','client/web/test/exact-hit-source-receipt.test.mjs','client/web/tools/measure-hit-mesh.mjs','client/web/test/exact-hit-static-cost.test.mjs',
  'client/web/src/gfx/tankmodel.js','client/web/src/gfx/geo.js','client/web/src/gfx/interior.js','client/web/src/gfx/mgmodel.js','client/web/src/gfx/track.js','client/web/src/gfx/gearSupports.js','client/web/src/game/loadout.js','client/web/src/game/workshopImported.js','client/web/src/gfx/math.js'
];
const executedPins=['client/web/src/game/combat.js','client/web/src/game/workshopBuild.js','client/web/tools/load-data.mjs','client/web/src/gfx/renderer.js','client/web/src/game/turretSeat.js','client/web/src/game/rangefinderEquipment.js'];
const pins=GEOMETRY_SOURCE_PATHS;
function verifySourcePins(pinned,read=p=>fs.readFileSync(new URL(p,root))){assert.deepEqual(Object.keys(pinned).sort(),pins.slice().sort());for(const p of pins)assert.equal(sha(read(p)),pinned[p],`${p} changed since actual native receipt`);}
test('new X1 native receipt pins the exact geometry exporter kernel dependency and fixture sources',()=>{
  assert.deepEqual(pins.slice().sort(),[...retainedPins,...executedPins].sort());assert.equal(new Set(pins).size,pins.length);
  assert.ok(GENERATOR_SOURCE_PATHS.every(p=>pins.includes(p)),'every executed generator source is receipt-pinned');
  assert.equal(receipt.schema,'ExactHitGeometryNativeReceiptV1');verifySourcePins(receipt.sourcePins);
  assert.equal(receipt.positionHash,'d514cca1fd4a062ecdc172eddcf665960e11490a8a52d31574d98988094536f5');assert.equal(receipt.renderBufferHash,'9bdaffb74fedb4d48e4159b8c3c48ac0615e1bd06d1a081e406cc0161d062a11');
  assert.deepEqual(receipt.empty,[]);assert.deepEqual(receipt.axial,[]);assert.equal(receipt.side.length,2);assert.equal(receipt.side[0].triangleId,41);assert.ok(Math.abs(receipt.side[0].t-.6720780188743095)<2e-12);
});
test('native provenance becomes stale when executed workshop or Renderer bytes change in isolation',()=>{
  verifySourcePins(receipt.sourcePins);
  for(const p of ['client/web/src/game/workshopBuild.js','client/web/src/gfx/renderer.js']){
    const original=fs.readFileSync(new URL(p,root));const changed=Buffer.from(original.toString().replace(p.includes('workshopBuild')?'ring: number(t.ring, 1.4,':'mesh(data) {',p.includes('workshopBuild')?'ring: number(t.ring, 1.6,':'mesh(data) {\n data=data.slice();data[0]+=.125;'));
    assert.ok(!changed.equals(original));assert.throws(()=>verifySourcePins(receipt.sourcePins,q=>q===p?changed:fs.readFileSync(new URL(q,root))),/changed since actual native receipt/);
  }
});
test('actual release WASM returns the same recorded fixture crossings as the native kernel',()=>{
  const bytes=fs.readFileSync(process.env.TG_TEST_WASM || new URL('../assets/tg_design.wasm',import.meta.url));const data=loadData(),core=loadCoreSync(bytes,{materials:data.materials,catalog:data.designCatalog,terrains:Object.values(data.terrains)});
  const text=fs.readFileSync(new URL(`data/hit-meshes/${receipt.manifestFile}`,root),'utf8'),m=JSON.parse(text),leases=[];
  try{
    for(const mesh of m.meshes)leases.push(core.combatGeometryInstall(fs.readFileSync(new URL(`data/hit-meshes/${mesh.payloadHash}.bin`,root)),mesh.payloadHash).handle);
    const s=core.combatGeometryRegister(text,receipt.manifestHash,leases);
    try{
      assert.deepEqual(core.combatGeometryTrace(s.handle,[.38,1.44,3.83],[.38,1.44,3.63],receipt.context).crossings,receipt.axial);
      assert.deepEqual(core.combatGeometryTrace(s.handle,[.534,1.44,3.015],[.38,1.44,3.015],receipt.context).crossings,receipt.side);
    }finally{core.combatGeometryRelease(s.handle);}
  }finally{leases.forEach(h=>core.combatGeometryRelease(h));}
  const parity={schema:'ExactHitGeometryWasmParityV1',wasmHash:sha(bytes),nativeReceiptHash:sha(fs.readFileSync(receiptPath)),manifestHash:receipt.manifestHash,positionHash:receipt.positionHash,sameOrderedCrossings:true};
  fs.writeFileSync(process.env.TG_GEOMETRY_WASM_RECEIPT || new URL('target/exact-hit-geometry-wasm-parity.json',root),JSON.stringify(parity,null,2));
});
