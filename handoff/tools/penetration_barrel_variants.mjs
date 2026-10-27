#!/usr/bin/env node
// Stage content-addressed barrel-cut descendants of reviewed stock bindings.
// Never edits the source app, embedded data, canonical trust bank or binaries.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';

const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
const clone=v=>JSON.parse(JSON.stringify(v));
const equal=(a,b,message)=>assert.equal(canonical(a),canonical(b),message);
function sealed(value,member){delete value[member];value[member]=hash(canonical(value));const text=canonical(value);return {value,text,hash:hash(text)};}
function verify(text,expected,member){assert.equal(hash(text),expected,'Artifact file SHA256');const value=JSON.parse(text),body={...value};delete body[member];assert.equal(hash(canonical(body)),value[member],member+' canonical self hash');return value;}
const changedMeshes=r=>r.changedMeshes?.length?r.changedMeshes:[{sourceMeshKey:r.recipe.sourceMeshKey}];
const geometry=m=>m.meshes.map(({ranges,...mesh})=>mesh);

/** Retarget only approved physical descendants; all actual cut geometry survives. */
export function retargetPacketVariants({originalPacket,normalizedPacket,bindingRegistryHash,sourceAppHash,helperHash}) {
  const raw=originalPacket,stock=normalizedPacket;
  const rawManifest=verify(raw.manifest,raw.manifestHash,'manifestHash'),rawCatalog=verify(raw.catalog,raw.catalogHash,'catalogHash');
  const manifest=verify(stock.manifest,stock.manifestHash,'manifestHash'),catalog=verify(stock.catalog,stock.catalogHash,'catalogHash');
  equal(geometry(rawManifest),geometry(manifest),'Stock binding migration cannot alter uploaded geometry');
  equal(rawManifest.assemblies,manifest.assemblies,'Stock assembly identity');equal(rawManifest.meshInstances,manifest.meshInstances,'Stock instance identity');
  assert.equal(manifest.specId,rawManifest.specId);
  if(manifest.buildHash!==rawManifest.buildHash){
    assert.equal(manifest.sources?.supplementalEngineering?.revision,'supplemental-schuerzen-five-mm-20261027-v1','Only reviewed supplemental engineering may change the build identity');
    const before=rawCatalog.acceptedAnatomy,after=catalog.acceptedAnatomy;
    equal(before.modules,after.modules,'Supplemental engineering preserves modules');
    equal(before.crew,after.crew,'Supplemental engineering preserves crew');
    equal(before.weapons,after.weapons,'Supplemental engineering preserves weapons');
    equal(before.armor,after.armor.slice(0,before.armor.length),'Supplemental engineering preserves every original plate');
    const added=after.armor.slice(before.armor.length);
    assert.deepEqual(added.map(p=>p.id),['schuerzen_r','schuerzen_l']);
    assert.ok(added.every(p=>p.zone==='skirt'&&p.material==='rha'&&p.thickness_mm===5));
  }
  const variants=[],records=[],artifacts=new Map(),proof=[];
  const add=(name,text)=>{if(artifacts.has(name))assert.equal(artifacts.get(name),text);else artifacts.set(name,text);};
  for(const original of raw.variants||[]) {
    const record=verify(original.record,original.recordHash,'shapeHash');
    assert.equal(record.parentStockManifestHash,raw.manifestHash);assert.equal(record.parentStockCatalogHash,raw.catalogHash);
    const cutManifest=verify(original.manifest,original.manifestHash,'manifestHash'),cutCatalog=verify(original.catalog,original.catalogHash,'catalogHash');
    assert.equal(record.damagedManifestHash,original.manifestHash);assert.equal(record.damagedCatalogHash,original.catalogHash);
    assert.equal(cutCatalog.geometryBytesChanged,1);equal(cutManifest.assemblies,rawManifest.assemblies,'Original cut assemblies');equal(cutManifest.meshInstances,rawManifest.meshInstances,'Original cut instances');
    if(raw.manifestHash===stock.manifestHash&&raw.catalogHash===stock.catalogHash){variants.push(clone(original));proof.push({specId:record.specId,shapeId:record.shapeId,preservedOriginal:true});continue;}
    const changed=new Set(changedMeshes(record).map(c=>c.sourceMeshKey));
    for(const mesh of rawManifest.meshes){
      const approvedCut=cutManifest.meshes.find(m=>m.key===mesh.key),newBase=manifest.meshes.find(m=>m.key===mesh.key);
      assert.ok(approvedCut&&newBase,'No removed mesh');
      if(changed.has(mesh.key))equal(mesh,newBase,'Reviewed stock changed the barrel response; this needs a separate source-triangle migration');
      else equal(mesh,approvedCut,'Original approved cut altered an unrelated mesh');
    }
    assert.ok(changed.size&&changed.size<=32);assert.equal(cutManifest.meshes.length,manifest.meshes.length);
    // The approved cut generator inherits only non-armor barrel declarations.
    // A new armor layer on a barrel cannot silently reuse this source proof.
    for(const d of rawCatalog.declarations.filter(d=>changed.has(d.meshKey)))assert.equal(d.armorBinding.layerKey,null);
    const nextManifest=clone(manifest),nextCatalog=clone(catalog);
    nextManifest.meshes=manifest.meshes.map(mesh=>clone(changed.has(mesh.key)?cutManifest.meshes.find(m=>m.key===mesh.key):mesh));
    const stockCutSurfaces=new Set(manifest.meshes.filter(m=>changed.has(m.key)).flatMap(m=>m.ranges.map(r=>r.surfaceKey)));
    const approvedCutSurfaces=new Set(cutManifest.meshes.filter(m=>changed.has(m.key)).flatMap(m=>m.ranges.map(r=>r.surfaceKey)));
    nextManifest.surfaces=manifest.surfaces.filter(s=>!stockCutSurfaces.has(s.key)).map(clone)
      .concat(cutManifest.surfaces.filter(s=>approvedCutSurfaces.has(s.key)).map(clone));
    nextCatalog.declarations=catalog.declarations.filter(d=>!changed.has(d.meshKey)).map(clone)
      .concat(cutCatalog.declarations.filter(d=>changed.has(d.meshKey)).map(clone));
    // Actual rendering did not change. The original cut's geometric audit
    // delta is independent of the body response declarations now being copied.
    nextManifest.renderGeometryHash=cutManifest.renderGeometryHash;
    for(const key of ['degenerateCount','boundaryEdges','nonmanifoldEdges']){
      assert.ok(Number.isSafeInteger(rawManifest.audits[key])&&Number.isSafeInteger(cutManifest.audits[key]));
      nextManifest.audits[key]=manifest.audits[key]+cutManifest.audits[key]-rawManifest.audits[key];
      assert.ok(Number.isSafeInteger(nextManifest.audits[key])&&nextManifest.audits[key]>=0);
    }
    const total=nextManifest.meshes.reduce((n,m)=>n+m.triangleCount,0),unknown=nextCatalog.declarations.filter(d=>d.resistancePolicy==='unsupported'),
      unknownCount=unknown.reduce((n,d)=>n+d.count,0),ambiguous=nextCatalog.declarations.filter(d=>d.owners.length>1).reduce((n,d)=>n+d.count,0);
    Object.assign(nextManifest.audits,{triangleCoverage:total,unclassifiedPhysicalTriangles:unknownCount,missingBindings:unknownCount,ambiguousBindings:ambiguous});
    Object.assign(nextCatalog.audit,{physicalTriangles:total,declaredTriangles:total-unknownCount,unknownTriangles:unknownCount,ambiguousTriangles:ambiguous,missingSemantics:[...new Set(unknown.map(d=>d.partId))]});
    const shapeId=record.shapeId+':bindings:'+stock.manifestHash.slice(0,12);assert.ok(shapeId.length<=128);
    nextCatalog.geometryBytesChanged=1;
    nextCatalog.shapeVariant={...clone(cutCatalog.shapeVariant),shapeId,parentStockManifestHash:stock.manifestHash,parentStockCatalogHash:stock.catalogHash,recipe:clone(record.recipe)};
    const m=sealed(nextManifest,'manifestHash');nextCatalog.manifestHash=m.hash;
    const c=sealed(nextCatalog,'catalogHash');
    const nextRecord=clone(record);
    Object.assign(nextRecord,{shapeId,parentStockManifestHash:stock.manifestHash,parentStockCatalogHash:stock.catalogHash,
      buildHash:manifest.buildHash,anatomyHash:manifest.anatomyDataHash,targetRegistrationHash:catalog.targetRegistrationHash,
      damagedManifestHash:m.hash,damagedCatalogHash:c.hash,
      bindingMigration:{schema:'BarrelShapeBindingMigrationV1',sourceRecordHash:original.recordHash,
        sourceParentManifestHash:raw.manifestHash,sourceParentCatalogHash:raw.catalogHash,
        sourceBindingRegistryHash:bindingRegistryHash,sourceAppHash,helperHash,
        physicalGeometryChanged:false,policy:'Copy reviewed stock body declarations; retain the already-approved physical cut upload, recipe and triangle provenance.'}});
    const r=sealed(nextRecord,'shapeHash');
    const next={...clone(original),record:r.text,recordHash:r.hash,manifest:m.text,manifestHash:m.hash,catalog:c.text,catalogHash:c.hash};
    equal(geometry(nextManifest),geometry(cutManifest),'Approved physical cut geometry must remain identical');
    equal(nextManifest.meshInstances,manifest.meshInstances,'Derivative instance identity');equal(nextManifest.assemblies,manifest.assemblies,'Derivative assembly identity');
    for(const mesh of manifest.meshes)if(!changed.has(mesh.key))equal(mesh,nextManifest.meshes.find(m=>m.key===mesh.key),'Unchanged native mesh must exactly equal normalized stock');
    for(const key of ['recipe','physicalBarrelId','physicalContactSourceKeys','instanceId','moduleRef','mountedWeaponKey','positionPayloadHash',
      'rendererAttributeUploadHash','triangleProvenanceHash','rendererRangesHash','changedMeshes'])equal(record[key],nextRecord[key],'Physical cut identity: '+key);
    assert.equal(hash(Buffer.from(next.payloads[nextRecord.positionPayloadHash],'base64')),nextRecord.positionPayloadHash);
    assert.equal(hash(Buffer.from(next.rendererUpload,'base64')),nextRecord.rendererAttributeUploadHash);
    add('barrel-shapes/'+r.hash+'.json',r.text);add('barrel-shapes/'+m.hash+'.json',m.text);add('barrel-shapes/'+c.hash+'.json',c.text);
    variants.push(next);records.push(nextRecord);
    proof.push({specId:record.specId,shapeId,sourceShapeId:record.shapeId,sourceRecordHash:original.recordHash,recordHash:r.hash,
      parentManifestHash:stock.manifestHash,parentCatalogHash:stock.catalogHash,damagedManifestHash:m.hash,damagedCatalogHash:c.hash,
      shapeHash:nextRecord.shapeHash,physicalCutUnchanged:true,unchangedBodyMeshesEqualStock:true,changedMeshes:[...changed],
      bodyUnknownBefore:rawCatalog.audit.unknownTriangles,bodyUnknownAfter:catalog.audit.unknownTriangles,derivativeUnknownAfter:unknownCount});
  }
  if(records.length){add('hit-meshes/'+stock.manifestHash+'.json',stock.manifest);add('hit-bindings/'+stock.catalogHash+'.json',stock.catalog);}
  return {packet:{...stock,variants,droppedVariants:0,disabledVariantReason:null},records,artifacts,proof};
}

function field(raw,name){const marker=Buffer.from(JSON.stringify(name)+':');let i=raw.indexOf(marker)+marker.length;assert.ok(i>=marker.length,name);const start=i;let depth=0,q=false,e=false;
  for(;i<raw.length;i++){const b=raw[i];if(q){if(e)e=false;else if(b===92)e=true;else if(b===34)q=false;continue;}if(b===34)q=true;else if(b===123||b===91)depth++;else if((b===125||b===93)&&--depth===0)return JSON.parse(raw.subarray(start,i+1));}throw Error(name);}
function option(name,fallback){const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1];}
function main(){
  const root=path.resolve(option('--root','.')),app=path.resolve(option('--app',path.join(root,'handoff/bundle/app.js.html'))),out=path.resolve(option('--out'));
  assert.ok(!fs.existsSync(out),'Fresh staging output required');fs.mkdirSync(out,{recursive:true});
  const source=fs.readFileSync(app,'utf8'),sourceAppHash=hash(source),helperHash=hash(fs.readFileSync(fileURLToPath(import.meta.url))),end=source.indexOf('  // client/web/src/main.js');assert.ok(end>0);
  const dir=path.join(root,'handoff/bundle');let raw=fs.existsSync(path.join(dir,'data.line'))?fs.readFileSync(path.join(dir,'data.line')):
    zlib.gunzipSync(Buffer.concat(fs.readdirSync(dir).filter(n=>n.startsWith('data.line.gz.part')).sort().map(n=>fs.readFileSync(path.join(dir,n)))));
  const data={vehicles:field(raw,'vehicles'),surfaceCatalog:field(raw,'surfaceCatalog')};raw=null;
  const originalPackets={...data.surfaceCatalog};
  const context=vm.createContext({console,atob,btoa,TextEncoder,TextDecoder,performance,Float32Array,Float64Array,Uint32Array,Uint8Array,Uint16Array,Int32Array,Int16Array,Int8Array,ArrayBuffer,DataView,Map,Set,WeakMap,WeakSet,structuredClone});
  vm.runInContext(source.replace(/^<script>/,'').slice(0,end-'<script>'.length)+
    '\nglobalThis.barrels={normalize:normalizeSurfacePacket,registry:VERIFIED_SURFACE_ARMOR_REGISTRY,install:installReviewedFoldableSurfacePackets};})();',context);
  context.barrels.install(data);
  const bindingRegistryHash=hash(canonical(context.barrels.registry)),trust=JSON.parse(fs.readFileSync(option('--trust-index',path.join(root,'data/barrel-shapes/index.json')),'utf8'));
  const normalizedFile=option('--normalized-packets',null),normalized=normalizedFile?JSON.parse(fs.readFileSync(normalizedFile,'utf8')):null;
  const staged={schema:'PenetrationReviewedBarrelVariantsV1',sourceAppHash,bindingRegistryHash,specs:{}},records=[],proof=[],fileHashes=[];
  for(const [id,installedPacket]of Object.entries(data.surfaceCatalog)){
    const packet=originalPackets[id]||installedPacket;
    if(!packet.variants?.length)continue;
    for(const v of packet.variants){const r=JSON.parse(v.record);assert.ok(trust.variants.some(t=>canonical(t)===canonical(r)),'Original variant is compiled-bank approved');assert.equal(trust.recordFiles[r.shapeId],v.recordHash);}
    const stock=normalized?.[id]||context.barrels.normalize(installedPacket);
    const result=retargetPacketVariants({originalPacket:packet,normalizedPacket:stock,bindingRegistryHash,sourceAppHash,helperHash});
    for(const [name,text]of result.artifacts){const p=path.join(out,'data',name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,text,{flag:'wx'});fileHashes.push({path:'data/'+name,sha256:hash(text),bytes:Buffer.byteLength(text)});}
    staged.specs[id]={parentManifestHash:stock.manifestHash,parentCatalogHash:stock.catalogHash,variants:result.packet.variants};records.push(...result.records);proof.push(...result.proof);
  }
  const index=clone(trust),seen=new Set(index.variants.map(r=>r.shapeId));
  for(const r of records){assert.ok(!seen.has(r.shapeId),'Unique shape IDs preserve loader compatibility');seen.add(r.shapeId);index.variants.push(r);index.recordFiles[r.shapeId]=hash(canonical(r));}
  assert.ok(index.variants.length<=64,'Build-time loader record limit');assert.equal(Object.keys(staged.specs).length,26,'Preserve all admitted physical cut variants');
  const bank=path.join(out,'data/barrel-shapes');fs.mkdirSync(bank,{recursive:true});fs.writeFileSync(path.join(bank,'index.json'),canonical(index),{flag:'wx'});
  // The native compiled bank keeps both generations. The original build-time
  // loader accepts one current parent per spec and therefore needs this compact
  // view when rebuilding intake from the reviewed stock packets.
  const runtimeRecords=Object.values(staged.specs).flatMap(s=>s.variants.map(v=>JSON.parse(v.record)));
  const runtimeIndex={...clone(trust),variants:runtimeRecords,recordFiles:Object.fromEntries(runtimeRecords.map(r=>[r.shapeId,hash(canonical(r))]))};
  fs.writeFileSync(path.join(out,'runtime-barrel-index.json'),canonical(runtimeIndex),{flag:'wx'});
  fs.writeFileSync(path.join(out,'runtime-variants.json'),canonical(staged),{flag:'wx'});
  const receipt={schema:'PenetrationBarrelVariantMigrationV1',root,app,sourceAppHash,bindingRegistryHash,helperHash,
    originalTrustedRecords:trust.variants.length,newTrustedRecords:records.length,totalTrustedRecords:index.variants.length,
    variantsPreserved:proof.length,unmodifiedVariants:proof.filter(p=>p.preservedOriginal).length,proof,fileHashes,
    scope:'Staging only. New native/WASM compile must include staged trust index. Runtime must attach staged variants only to the exact reviewed parent hashes. Geometry uploads, recipe, triangle provenance and physical damage ownership are unchanged.'};
  fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify(receipt,null,2),{flag:'wx'});
  console.log(JSON.stringify({out,sourceAppHash,originalTrustedRecords:receipt.originalTrustedRecords,newTrustedRecords:records.length,totalTrustedRecords:index.variants.length,variantsPreserved:proof.length,unmodifiedVariants:receipt.unmodifiedVariants}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(fileURLToPath(import.meta.url)))main();
