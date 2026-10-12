// Trusted CPU-only X1 export of actual Renderer._src buffers. Unknown roles remain pending.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { loadData, DATA_DIR } from './load-data.mjs';
import { rendererSink, captureNodes, positionsOf, bytesOf, sha, hetzerWitness, verifyCrewCapture, physicalNodeKey } from './hit-mesh-capture.mjs';
import { decodeAllImported } from '../src/gfx/imported.js';
import { buildTank } from '../src/gfx/tankmodel.js';
import { buildInterior, setCrewModel } from '../src/gfx/interior.js';
import { setMgModels } from '../src/gfx/mgmodel.js';
import { makeLoadout, generatedTurretParts, buildToBundle, exportFolder } from '../src/game/loadout.js';
import { normalizeWorkshopBuild } from '../src/game/workshopBuild.js';
import { m4, translation, mul, rotX, rotY, rotZ } from '../src/gfx/math.js';
import { loadCoreSync } from '../src/design/core.js';
import { Combat } from '../src/game/combat.js';
import { workshopImportedModel, exportWorkshopModel } from '../src/game/workshopImported.js';

export const ROOT = path.resolve(DATA_DIR, '..');
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const hashValue = value => sha(Buffer.from(canonical(value)));
// One source table owns both actual-byte generator identity and diagnostic receipt pins.
// `true` marks sources executed to produce or include the neutral render/anatomy export.
// Runtime-only behavior (including folding updates) is outside this neutral capture scope.
const sourceProvenance = [
  ['Cargo.toml', false], ['Cargo.lock', false], ['crates/combat/Cargo.toml', false], ['crates/combat/src/lib.rs', false],
  ['crates/combat/src/geometry/mod.rs', false], ['crates/combat/src/geometry/manifest.rs', false], ['crates/combat/src/geometry/bvh.rs', false], ['crates/combat/src/geometry/ray.rs', false], ['crates/combat/src/geometry/surface.rs', false], ['crates/combat/src/geometry/tests.rs', false],
  ['crates/design-wasm/src/lib.rs', false], ['crates/design-wasm/src/geometry_diagnostic.rs', false], ['client/web/src/design/core.js', true], ['client/web/src/gfx/imported.js', true],
  ['client/web/tools/export-hit-mesh.mjs', true], ['client/web/tools/hit-mesh-capture.mjs', true], ['schemas/hit-mesh.schema.json', false],
  ['client/web/test/exact-hit-mesh.test.mjs', false], ['client/web/test/exact-hit-source-receipt.test.mjs', false], ['client/web/tools/measure-hit-mesh.mjs', false], ['client/web/test/exact-hit-static-cost.test.mjs', false],
  ['client/web/src/gfx/tankmodel.js', true], ['client/web/src/gfx/geo.js', true], ['client/web/src/gfx/interior.js', true], ['client/web/src/gfx/mgmodel.js', true], ['client/web/src/gfx/track.js', true], ['client/web/src/gfx/gearSupports.js', true], ['client/web/src/game/loadout.js', true], ['client/web/src/game/workshopImported.js', true], ['client/web/src/gfx/math.js', true],
  ['client/web/src/game/combat.js', true], ['client/web/src/game/workshopBuild.js', true], ['client/web/tools/load-data.mjs', true], ['client/web/src/gfx/renderer.js', true], ['client/web/src/game/turretSeat.js', true], ['client/web/src/game/rangefinderEquipment.js', true]
];
export const GENERATOR_SOURCE_PATHS = Object.freeze(sourceProvenance.filter(([, generator]) => generator).map(([p]) => p));
export const GEOMETRY_SOURCE_PATHS = Object.freeze(sourceProvenance.map(([p]) => p));
export function generatorSourceIdentity(readSource = p => fs.readFileSync(path.join(ROOT, p))) {
  const inputs = GENERATOR_SOURCE_PATHS.map(p => {
    // Executed inputs must exist: a missing placeholder cannot identify an export.
    const bytes = readSource(p);
    return { kind: 'generator_source', path: p, status: 'available', sha256: sha(bytes), bytes: bytes.length };
  });
  return { inputs, sha256: hashValue(inputs) };
}
export const matrixBits = a => Array.from(new Uint32Array(a.buffer, a.byteOffset, a.length));
const identityBits = matrixBits(m4());
export function meshPayload(positions, indices = null) {
  if (!(positions instanceof Float32Array) || positions.length % 9 || !positions.length || positions.some(v => !Number.isFinite(v))) throw new Error('invalid triangle-list positions');
  const vertices = positions.length / 3, triangles = indices ? indices.length / 3 : vertices / 3;
  if (!Number.isInteger(triangles) || triangles <= 0 || triangles > 1_000_000) throw new Error('triangle count limit');
  const out = Buffer.alloc(32 + positions.byteLength + triangles * 12);
  out.write('THMESH1\0', 0, 'ascii');
  [1, vertices, triangles, positions.byteLength, triangles * 12, 0].forEach((v, i) => out.writeUInt32LE(v, 8 + i * 4));
  const bits = new Uint32Array(positions.buffer, positions.byteOffset, positions.length);
  bits.forEach((v, i) => out.writeUInt32LE(v, 32 + i * 4));
  for (let i = 0; i < triangles * 3; i++) { const v = indices ? indices[i] : i; if (!Number.isInteger(v) || v < 0 || v >= vertices) throw new Error('index out of bounds'); out.writeUInt32LE(v, 32 + positions.byteLength + i * 4); }
  return out;
}
function hashFile(file, kind = 'asset') {
  const absolute = path.isAbsolute(file) ? file : path.resolve(ROOT, file);
  const label = path.isAbsolute(file) ? file : file.replaceAll('\\', '/');
  if (!fs.existsSync(absolute)) return { kind, path: label, status: 'missing', sha256: null };
  const bytes = fs.readFileSync(absolute), record = { kind, path: label, status: 'available', sha256: sha(bytes), bytes: bytes.length };
  if (absolute.endsWith('.glb.gz')) record.decompressedGlbHash = sha(gunzipSync(bytes));
  return record;
}
function mountDescriptor(p) {
  return Object.fromEntries(['mount','turret','gun','side','index','hinge','payload','source_node'].filter(k => p[k] !== undefined).map(k => [k, structuredClone(p[k])]));
}
export function mintPackedSources(data) {
  for (const [id, b] of Object.entries(data.vehicles)) {
    if (!b.model) continue;
    const asset = hashFile(`data/vehicles/${id}/${b.vehicle.model}`, 'packed_model');
    b.model.parts = b.model.parts.map((p, packedPartOrdinal) => ({ ...p, hitSource: { key: `packed:${asset.sha256}:part:${packedPartOrdinal}:mount:${hashValue(mountDescriptor(p))}`, assetHash: asset.sha256, packedPartOrdinal, mount: mountDescriptor(p) } }));
  }
}
function sourceRecords(id, bundle, data, seen = new Set()) {
  if (seen.has(id)) throw new Error('cyclic source donor'); seen.add(id);
  const dir = path.join(DATA_DIR, 'vehicles', id), records = [];
  const config = path.join(dir, 'import.json');
  records.push(hashFile(`data/vehicles/${id}/vehicle.json`, 'vehicle_data'));
  for (const [kind, file] of Object.entries(bundle.vehicle.files)) records.push(hashFile(`data/vehicles/${id}/${file}`, `${kind}_data`));
  if (bundle.model) records.push(hashFile(`data/vehicles/${id}/${bundle.vehicle.model}`, 'packed_model'));
  if (fs.existsSync(config)) {
    records.push(hashFile(path.relative(ROOT, config), 'import_config'));
    const imp = JSON.parse(fs.readFileSync(config));
    if (imp.glb) records.push(hashFile(path.isAbsolute(imp.glb) ? imp.glb : path.relative(ROOT, path.resolve(dir, imp.glb)), 'source_glb'));
    else records.push({ kind: 'source_glb', path: null, status: imp.grp || imp.blk ? 'different_source_format' : 'not_declared', sha256: null });
    for (const kind of ['grp','blk']) if (imp[kind]) records.push(hashFile(path.relative(ROOT,path.resolve(dir,imp[kind])),`source_${kind}`));
  } else records.push({ kind: 'import_config', path: null, status: 'not_declared', sha256: null });
  const archives = { su_att_m46: 'tools/sources/AT_T_M46_130mm_PhotoReplica.glb.gz', de_flakpz38t: 'tools/sources/flak38t-reconstruction-v2.glb.gz' };
  if (archives[id]) records.push(hashFile(archives[id], 'source_archive'));
  if (bundle.model?.shared) {
    const from = bundle.model.shared.from; records.push({ kind: 'donor_selection', specId: from, mounts: bundle.model.shared.mounts.slice() });
    records.push(...sourceRecords(from, data.vehicles[from], data, seen).map(r => ({ ...r, donorSpecId: from })));
  }
  records.push(hashFile('SOURCES.md', 'provenance_record'));
  return records;
}
function localMatrix(n) { if (n.local) return n.local.slice(); let l = translation(...n.pos); if(n.yaw)l=mul(l,rotY(n.yaw));if(n.pitch)l=mul(l,rotX(n.pitch));if(n.roll)l=mul(l,rotZ(n.roll));return l; }
function assembliesOf(root) {
  const records=[]; const visit=(n,key,parent)=>{records.push({key,parent,baseTransformBits:matrixBits(localMatrix(n)),pivot:n.pos.slice(),joint:{status:'audit_pending',nodeName:n.name},allowedMotionFields:[]});n.children.forEach((c,i)=>visit(c,physicalNodeKey(c,key,i),key));};visit(root,root.name,null);return records;
}
function topologyAudit(positions) {
  const edges = new Map(); let degenerateCount = 0;
  const vertex = off => [0,1,2].map(k => { const v=positions[off+k]; return v===0?'0':new Uint32Array(positions.buffer,positions.byteOffset+(off+k)*4,1)[0].toString(16); }).join(',');
  for(let t=0;t<positions.length;t+=9) {
    const e=[0,1,2].map(k=>positions[t+3+k]-positions[t+k]),f=[0,1,2].map(k=>positions[t+6+k]-positions[t+k]);
    const n=[e[1]*f[2]-e[2]*f[1],e[2]*f[0]-e[0]*f[2],e[0]*f[1]-e[1]*f[0]];if(n.every(v=>v===0))degenerateCount++;
    const v=[vertex(t),vertex(t+3),vertex(t+6)];for(const [a,b]of[[0,1],[1,2],[2,0]]){const key=[v[a],v[b]].sort().join('|');edges.set(key,(edges.get(key)||0)+1);}
  }
  return {degenerateCount,boundaryEdges:Array.from(edges.values()).filter(n=>n===1).length,nonmanifoldEdges:Array.from(edges.values()).filter(n=>n>2).length};
}
export function manifestFromCapture(specId, capture, assemblies, metadata = {}) {
  const payloads=new Map(), meshes=[],meshInstances=[],surfaces=[];let degenerateCount=0,boundaryEdges=0,nonmanifoldEdges=0;
  const buildHash=metadata.buildHash || hashValue({specId,recipe:metadata.recipe || 'actual-renderer-neutral-v1'});
  for(const c of capture) {
    const payload=meshPayload(c.positions),payloadHash=sha(payload);const key=`mesh:${c.key}`,surfaceKey=`pending:${c.key}`;
    if(payloads.has(payloadHash)&&!payloads.get(payloadHash).equals(payload))throw new Error('mesh SHA collision');payloads.set(payloadHash,payload);
    const bounds={lo:[Infinity,Infinity,Infinity],hi:[-Infinity,-Infinity,-Infinity]};for(let i=0;i<c.positions.length;i++){const k=i%3;bounds.lo[k]=Math.min(bounds.lo[k],c.positions[i]);bounds.hi[k]=Math.max(bounds.hi[k],c.positions[i]);}
    const sourceKey=c.hitSource?.key || `generated:${metadata.generatorHash || hashValue('test-generator')}:build:${buildHash}:assembly:${c.key}`;
    const audit=topologyAudit(c.positions);degenerateCount+=audit.degenerateCount;boundaryEdges+=audit.boundaryEdges;nonmanifoldEdges+=audit.nonmanifoldEdges;
    meshes.push({key,payloadHash,positionsHash:sha(bytesOf(c.positions)),renderBufferHash:sha(bytesOf(c.data)),vertexCount:c.positions.length/3,triangleCount:c.positions.length/9,bounds,ranges:[{first:0,count:c.positions.length/9,sourceKey,surfaceKey,solidKey:null,bindingKey:null}],bvh:null});
    surfaces.push({key:surfaceKey,role:'audit_pending',topology:'audit_pending',winding:'emitted',responseRef:null,armorLayerKey:null,moduleKey:null,crewKey:null,fuseEligible:null,contactEligible:null});
    for(let i=0;i<c.count;i++)meshInstances.push({key:`instance:${c.key}:${i}`,meshKey:key,assemblyKey:c.key,sourceKey,
      worldBits:matrixBits(c.world),instanceBits:c.matrices?matrixBits(c.matrices.subarray(i*16,i*16+16)):identityBits.slice(),
      materialFeature:{status:'audit_pending',capturedInstanceOrdinal:i,source:c.hitSource || null},activityPolicy:'audit_pending_state; visibility_ignored'});
  }
  const triangleCount=meshes.reduce((n,m)=>n+m.triangleCount,0);
  const manifest={schema:'HitMeshManifestV1',format:'THMESH1',endianness:'LE',generator:{revision:metadata.revision || 'fixture',sha256:metadata.generatorHash || hashValue('test-generator')},
    buildRecipeHash:metadata.recipeHash || hashValue('actual-renderer-neutral-v1'),specId,buildHash,renderGeometryHash:hashValue(capture.map(c=>({key:c.key,bufferHash:sha(bytesOf(c.data)),worldBits:matrixBits(c.world),matricesHash:c.matrices?sha(bytesOf(c.matrices)):null,count:c.count}))),
    anatomyDataHash:metadata.anatomyHash || hashValue({}),sources:metadata.sources || {assets:[]},meshes,assemblies,meshInstances,bindings:metadata.bindings || [],surfaces,
    audits:{certification:'audit_pending_diagnostic',triangleCoverage:triangleCount,unclassifiedPhysicalTriangles:triangleCount,degenerateCount,boundaryEdges,nonmanifoldEdges,topologyPending:true,declaredOpenBoundaries:null,missingBindings:triangleCount,ambiguousBindings:0,renderPositionDifferences:0,shaderDeformation:'not_declared',activity:'pending_semantic_state',...metadata.audit}};
  manifest.manifestHash=hashValue(manifest);const text=canonical(manifest),expectedHash=sha(Buffer.from(text));return{manifest,text,expectedHash,payloads};
}
export function fixtureManifest(capture,specId='fixture') {
  const assemblies=capture.map(c=>({key:c.key,parent:null,baseTransformBits:identityBits.slice(),pivot:[0,0,0],joint:{status:'static_fixture'},allowedMotionFields:[]}));
  return manifestFromCapture(specId,capture,assemblies);
}
export function writeDerivative(result,destination=path.join(DATA_DIR,'hit-meshes')) {
  fs.mkdirSync(destination,{recursive:true});for(const[hash,bytes]of result.payloads) { const p=path.join(destination,`${hash}.bin`);if(fs.existsSync(p)&&!fs.readFileSync(p).equals(bytes))throw new Error('hash-addressed derivative changed');if(!fs.existsSync(p))fs.writeFileSync(p,bytes); }
  const name=`${result.expectedHash}.json`,file=path.join(destination,name);if(fs.existsSync(file)&&fs.readFileSync(file,'utf8')!==result.text)throw new Error('hash-addressed manifest changed');if(!fs.existsSync(file))fs.writeFileSync(file,result.text);return name;
}
async function exportFleet(options={}) {
  const data=loadData();mintPackedSources(data);await decodeAllImported(data.vehicles);
  for(const[id,b]of Object.entries(data.vehicles))if(b.model&&(!b.imported || (b.model.shared&&!b.imported.borrowed)))throw new Error(`declared packed model decoding/donor resolution failed: ${id}`);
  const crew=hashFile('client/web/assets/crew_model.json','crew_model'),mg=hashFile('client/web/assets/mg_models.json','mg_model');
  const crewAsset=JSON.parse(fs.readFileSync(path.resolve(ROOT,crew.path)));setCrewModel(crewAsset);setMgModels(JSON.parse(fs.readFileSync(path.resolve(ROOT,mg.path))));
  const corePath=process.env.TG_HIT_EXPORT_CORE || path.join(ROOT,'client/web/assets/tg_design.wasm');
  const core=loadCoreSync(fs.readFileSync(corePath),{materials:data.materials,catalog:data.designCatalog,terrains:Object.values(data.terrains)}),combat=new Combat(core,data.machineGuns);
  const {inputs:generatorInputs,sha256:generatorHash}=generatorSourceIdentity();
  const revision=execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim();
  const index={schema:'HitMeshIndexV1',certification:'audit_pending_diagnostic',generator:{revision,sha256:generatorHash,inputs:generatorInputs},garageCount:data.order.length,packedModelCount:Object.values(data.vehicles).filter(b=>b.model).length,entries:[],nonGarageFolders:[],workshop:[]};
  const bindingDir=path.join(DATA_DIR,'hit-bindings');fs.mkdirSync(bindingDir,{recursive:true});
  const captureBuild=(id,raw,recipe)=>{
    const bundle=combat.prepare(`x1:${id}`,raw),renderer=rendererSink(),loadout=makeLoadout(id,bundle,data.projectiles,data.machineGuns),model=buildTank(renderer,loadout,generatedTurretParts);
    const interior=buildInterior(renderer,model,loadout,bundle.modules,bundle.crew);model.root.update();
    try{
      verifyCrewCapture(interior,bundle.crew,crewAsset);
      const capture=captureNodes(model.root),anatomyHash=hashValue({armor:bundle.armor,modules:bundle.modules,crew:bundle.crew,weapons:bundle.weapons});
      const bindings=bundle.modules.map(m=>({key:`module:${m.id}`,kind:'module',moduleId:m.id,moduleKind:m.kind,weaponKey:null,weaponGroup:m.weapon_group || null,status:'audit_pending_surface_assignment'}));
      bundle.armor.forEach(a=>bindings.push({key:`armor:${a.id}`,kind:'armor',armorId:a.id,authoredEngineeringHash:hashValue(a),status:'audit_pending_patch_and_layer_assignment'}));
      const mountedWeaponKeys=Object.keys(core.combatNew(`x1:${id}`).caps.weapons || {}).sort();
      mountedWeaponKeys.forEach(key=>bindings.push({key:`weapon:${key}`,kind:'weapon',mountedWeaponKey:key,status:'audit_pending_surface_assignment'}));
      bundle.crew.forEach((c,i)=>bindings.push({key:`crew:${anatomyHash}:${i}`,kind:'crew',crewIndex:i,crewRole:c.role,status:'audit_pending_surface_assignment'}));
      const evidence=[];for(const[id,nodes]of interior.byModule)for(const n of nodes){const c=capture.find(c=>c.node===n);if(c)evidence.push({assemblyKey:c.key,moduleId:id});}interior.byCrew.forEach((n,i)=>{const c=capture.find(c=>c.node===n);if(c)evidence.push({assemblyKey:c.key,crewKey:`crew:${anatomyHash}:${i}`});});
      const sources={assets:[...sourceRecords(recipe.base || id,data.vehicles[recipe.base || id],data),...(recipe.donor?sourceRecords(recipe.donor,data.vehicles[recipe.donor],data).map(r=>({...r,donorSpecId:recipe.donor})):[]),crew,mg,hashFile('data/machine_guns.json','machine_gun_catalog')],normalizedAnatomyHash:anatomyHash,normalizerCoreHash:sha(fs.readFileSync(corePath)),normalizerCoreRole:process.env.TG_HIT_EXPORT_CORE?'explicit_anatomy_normalizer_override':'published_G_anatomy_normalizer; X1_query_core_is_separate'};
      const result=manifestFromCapture(id,capture,assembliesOf(model.root),{generatorHash,revision,recipeHash:hashValue(recipe),buildHash:hashValue({recipe,anatomyHash,sources}),anatomyHash,sources,bindings});
      const manifestFile=writeDerivative(result);
      const remap=capture.filter(c=>c.hitSource).map(c=>({assemblyKey:c.key,meshKey:`mesh:${c.key}`,source:structuredClone(c.hitSource),selectedTriangles:c.positions.length/9,triangleRemap:{kind:'identity_original_packed_triangle',first:0,count:c.positions.length/9}}));
      const launcherEvidence=capture.filter(c=>c.node.launcherRound).map(c=>({assemblyKey:c.key,mountedWeaponKey:c.node.launcherRound.gun.damageKey,tube:c.node.launcherRound.tube,activity:'audit_pending_semantic_occupancy; visibility_ignored'}));
      const sidecar={schema:'HitBindingSidecarV1',specId:id,manifestHash:result.expectedHash,anatomyHash,status:'audit_pending',sourceRemap:remap,anatomyEvidence:evidence,mountedWeaponKeys,launcherEvidence,roles:result.manifest.surfaces,missingBindingTriangles:result.manifest.audits.missingBindings,recipe};
      const sidecarHash=hashValue(sidecar),sidecarFile=`${sidecarHash}.json`;fs.writeFileSync(path.join(bindingDir,sidecarFile),canonical(sidecar));
      return{specId:id,manifestFile,manifestHash:result.expectedHash,buildHash:result.manifest.buildHash,sidecarFile,sidecarHash,meshes:capture.length,instances:result.manifest.meshInstances.length,triangles:result.manifest.audits.triangleCoverage,packed:!!raw.model};
    }finally{interior.dispose();model.dispose();}
  };
  for(const id of data.order.filter(id=>!options.ids || options.ids.includes(id)))index.entries.push(captureBuild(id,data.vehicles[id],{kind:'stock_neutral',base:id}));
  for(const id of fs.readdirSync(path.join(DATA_DIR,'vehicles')).filter(id=>!data.order.includes(id)).sort())index.nonGarageFolders.push({specId:id,garage:false,reason:'folder_not_in_ORDER',vehicle:hashFile(`data/vehicles/${id}/vehicle.json`,'non_garage_vehicle')});
  for(const[base,keepStock]of[['xp_bmp_k64_atgm',true],['xp_bmp_k64_atgm',false],['su_t10m_oplot23',true]]){
    const raw=data.vehicles[base],imported=workshopImportedModel(raw,keepStock),flat=exportWorkshopModel(raw,keepStock,data),id=`workshop_${base}_${keepStock?'keep':'replace'}`;
    const exportedRemap=(flat?.parts || []).map((p,exportedPartOrdinal)=>({exportedPartOrdinal,source:structuredClone(p.hitSource),selectedTriangleCount:p.triangles,triangleRemap:{kind:'identity_original_packed_triangle',first:0,count:p.triangles}}));
    const donor='xp_kda35',build=normalizeWorkshopBuild({base,keepStock,turrets:[{guns:[{weapon:donor}]}]},data);
    const compiled=buildToBundle(build,data,id),folder=exportFolder(build,data,raw,id,id);
    const replacement={...compiled.bundle,armor:folder.files['armor.json'],modules:folder.files['modules.json'],crew:folder.files['crew.json']};
    const entry=captureBuild(id,replacement,{kind:'workshop_normalized_build',base,keepStock,donor,build,exportedPackedPartRemap:exportedRemap});index.workshop.push(entry);
  }
  const fixture=hetzerWitness();try{const tube=fixtureManifest([fixture.tube],'fixture_selected_hetzer_tube');const file=writeDerivative(tube);index.fixtures={tube:{manifestFile:file,manifestHash:tube.expectedHash},oracleFile:'target/exact-hit-x1-oracle-witness.json'};}finally{fixture.dispose();}
  fs.writeFileSync(path.join(DATA_DIR,'hit-meshes','index.json'),canonical(index));return index;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const ids=process.argv.find(a=>a.startsWith('--ids='))?.slice(6).split(',');const index=await exportFleet({ids});console.log(JSON.stringify({garage:index.garageCount,packed:index.packedModelCount,exported:index.entries.length,workshop:index.workshop.length,nonGarage:index.nonGarageFolders.map(v=>v.specId),certification:index.certification}));
}
