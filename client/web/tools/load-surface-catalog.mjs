import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {DATA_DIR} from './load-data.mjs';
import {reviewedFleetSource} from './fleet-authored-bindings.mjs';
import {validateBindingCatalog} from './hit-binding-catalog.mjs';
import {loadBarrelShapes} from './load-barrel-shapes.mjs';
import {REVIEWED_ADDITIONAL_BARRELS} from './fleet-additional-authored-bindings.mjs';

const admittedSpecs=new Set(['su_t72a','de_hetzer','de_tiger_e','de_sdkfz234_2','de_pz4_h','de_pz3_j','su_t34_1940','su_t34_85']);
const staticFoldingCandidates=new Set(['de_flakpz38t','de_rso_pak40']);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const isHash=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const indexPath='hit-meshes/bindings-v1-index.json';

// Build-time reviewed subset only. Source capture never grants unknown surfaces
// armor semantics. Native registration still checks accepted engineering.
export function loadSurfaceCatalog({readDataFile=null,readBarrelFile=null,includeAdditional=true,includeStaticFoldingCandidates=false}={}){
  if(!readDataFile&&!fs.existsSync(path.join(DATA_DIR,indexPath)))return {};
  const read=readDataFile||((relative)=>fs.readFileSync(path.join(DATA_DIR,relative)));
  const index=JSON.parse(read(indexPath)),seen=new Set(),packets={};
  if(index.schema!=='HitMeshIndexV1'||!Array.isArray(index.entries)||index.entries.length>1024)throw new Error('surface catalog index schema invalid');
  for(const entry of index.entries){
    if(!entry||typeof entry.specId!=='string'||seen.has(entry.specId))throw new Error('surface catalog duplicate or invalid spec id');
    seen.add(entry.specId);
    if(staticFoldingCandidates.has(entry.specId)&&!includeStaticFoldingCandidates)continue;
    const additional=includeAdditional&&Object.hasOwn(REVIEWED_ADDITIONAL_BARRELS,entry.specId)?reviewedFleetSource(entry.specId):null;
    if(!admittedSpecs.has(entry.specId)&&(!additional||additional.admissionStatus==='incomplete_unadmitted'))continue;
    if(!isHash(entry.manifestHash)||!isHash(entry.bindingCatalogHash)||entry.manifestFile!==`${entry.manifestHash}.json`||entry.bindingCatalogFile!==`${entry.bindingCatalogHash}.json`)throw new Error('surface catalog hash-addressed entry invalid');
    const manifest=read(`hit-meshes/${entry.manifestFile}`).toString('utf8'),m=JSON.parse(manifest);
    if(hash(manifest)!==entry.manifestHash||m.schema!=='HitMeshManifestV1')throw new Error('surface catalog manifest hash/schema invalid');
    if(m.specId!==entry.specId)throw new Error('surface catalog manifest spec mismatch');
    const catalog=read(`hit-bindings/${entry.bindingCatalogFile}`).toString('utf8'),c=JSON.parse(catalog);
    if(hash(catalog)!==entry.bindingCatalogHash||c.schema!=='HitBindingCatalogV1')throw new Error('surface catalog binding hash/schema invalid');
    if(c.specId!==entry.specId)throw new Error('surface catalog binding spec mismatch');
    if(!c.audit||!['reviewed_subset','declared_authored_geometry'].includes(c.audit.status)||c.audit.historicalArmorCertification!==false||!isHash(c.targetRegistrationHash)||!Array.isArray(c.declarations)||!Array.isArray(c.layers)||!c.layers.length)throw new Error('surface catalog lacks reviewed authored values');
    const review=entry.specId==='su_t72a'?null:reviewedFleetSource(entry.specId);
    const authored=c.declarations.filter(d=>d.role==='armor'&&(entry.specId==='su_t72a'?d.declaration?.basis==='t72a_named_part_and_authored_face_group':d.declaration?.basis==='reviewed_source_constructor_feature'&&d.sourceKey.startsWith(`visual:${review.assetHash}:part:`)));
    if(!authored.length)throw new Error('surface catalog reviewed source armor is unknown');
    validateBindingCatalog(catalog,entry.bindingCatalogHash,{manifest:m,expectedHash:entry.manifestHash},c.acceptedAnatomy);
    const payloads={};
    for(const row of m.meshes){
      if(!isHash(row.payloadHash))throw new Error('surface catalog payload hash invalid');
      if(payloads[row.payloadHash])continue;
      const bytes=read(`hit-meshes/${row.payloadHash}.bin`);
      if(hash(bytes)!==row.payloadHash)throw new Error('surface catalog payload bytes mismatch');
      payloads[row.payloadHash]=bytes.toString('base64');
    }
    packets[entry.specId]={manifest,manifestHash:entry.manifestHash,catalog,catalogHash:entry.bindingCatalogHash,payloads};
  }
  return !readDataFile||readBarrelFile?loadBarrelShapes({packets,readDataFile:readBarrelFile}):packets;
}
