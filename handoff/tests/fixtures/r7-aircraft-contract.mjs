import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {assertR8HistoricalExportContract} from './r8-aircraft-contract.mjs';
const migrationBytes=fs.readFileSync(new URL('./aircraft-r7-semantic-migration-20261026.json',import.meta.url));
export const migration=JSON.parse(migrationBytes);
const integratedCohort=JSON.parse(fs.readFileSync(new URL('./aircraft-r7-integrated-cohort-20261027.json',import.meta.url),'utf8'));
export const ORIGINAL_AIRCRAFT_IDS=['nf01','nf02','p51d','bf109g','spitfire9','me262','me262a2a','me262u4','f86f','f104g','mig21','fw190a8','yak9u','a6m2','f4u1d','mig15','mig17f','hunter6','mirage3e','f4e','f15c','mig29','f16v','su27','a10a','su25'].sort();
export const INHERITED_AIRCRAFT=Object.freeze({su27skm:'su27',mig29smt:'mig29'});
export const R7_AIRCRAFT_IDS=[...ORIGINAL_AIRCRAFT_IDS,...Object.keys(INHERITED_AIRCRAFT)].sort();
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export function assertFlightKernelIdentity(bytes){assert.equal(createHash('sha256').update(bytes).digest('hex'),migration.cohort.flightWasmSha256,'Actual delivered C215 kernel identity');}
const item=i=>Object.fromEntries(['id','count','station','side'].filter(k=>Object.hasOwn(i,k)).map(k=>[k,i[k]]));
const preset=l=>JSON.parse(JSON.stringify({index:l.index,name:l.name,entries:l.entries,items:l.items.map(item),gunPodsSha256:sha(l.gunPods)}));
export function assertR7ExportContract(fresh){
 assert.deepEqual(migration.originalIds,ORIGINAL_AIRCRAFT_IDS);assert.deepEqual(migration.inherited,INHERITED_AIRCRAFT);
 assert.deepEqual(Object.keys(fresh.aircraft).sort(),R7_AIRCRAFT_IDS);
 assert.equal(migration.provenance.r6ProfileSha256,'3d9b6e198405ec00295e7d9e3146a57d8790ef58f9b67f8d5da14c3e01318a82');
 assert.equal(migration.provenance.r6AppSha256,'8305c62f4c858dbb5fb5ae69e9fd59eb5424243e3c43be68b775df568e076937');
 assert.equal(integratedCohort.baseSemanticMigrationSha256,createHash('sha256').update(migrationBytes).digest('hex'),'Original semantic migration stays immutable');
 assert.equal(integratedCohort.baseAppSha256,migration.cohort.appSha256);
 assert.deepEqual(Object.keys(integratedCohort.sourceSections).sort(),Object.keys(migration.cohort.sourceSections).sort(),'Integration preserves every source section identity');
 for(const [name,section]of Object.entries(migration.cohort.sourceSections))assert.equal(integratedCohort.sourceSections[name].sha256,section.sha256,name+' original exported source body remains exact');
 if(![migration.cohort.appSha256,integratedCohort.appSha256].includes(fresh.source.appSha256))return assertR8HistoricalExportContract(fresh,migration,ORIGINAL_AIRCRAFT_IDS,R7_AIRCRAFT_IDS);
 const cohort=fresh.source.appSha256===migration.cohort.appSha256?migration.cohort:integratedCohort;
 assert.equal(fresh.source.appSha256,cohort.appSha256);assert.equal(fresh.source.flightCoreVersion,215);assert.equal(fresh.source.flightWasmSha256,migration.cohort.flightWasmSha256);
 assert.deepEqual(fresh.source.sections,cohort.sourceSections,'Exact delivered source helper bodies and line provenance for the declared cohort');
 let oldPresets=0;
 for(const id of ORIGINAL_AIRCRAFT_IDS){const a=fresh.aircraft[id],old=migration.originals[id];
  for(const field of ['physics','guns','fuel','metadata'])assert.equal(sha(a[field]),old.fields[field],id+'/'+field+' must retain original26 serialized contract');
  const added=migration.appendedPresets[id]||[];assert.equal(a.stores.loadouts.length,old.presets.length+added.length,id+' preset list only admits declared append');
  for(let i=0;i<old.presets.length;i++)assert.deepEqual(preset(a.stores.loadouts[i]),old.presets[i],id+'/'+i+' original preset INDEX/LIST/item/ammunition semantics');
  assert.deepEqual(Array.from(a.stores.loadouts.slice(old.presets.length),preset),added,id+' explicit appended presets');oldPresets+=old.presets.length;
  assert.equal(sha(a.sensors),old.newSensorsSha256,id+' source-bound V4 sensors');assert.equal(sha(a.stores),old.newStoresSha256,id+' source-bound V4 mount geometry');
 }
 assert.equal(oldPresets,93);assert.equal(migration.originalPresetCount,93);assert.deepEqual(Object.keys(migration.appendedPresets),['f15c']);assert.equal(migration.appendedPresets.f15c.length,3);
 for(const[id,base]of Object.entries(INHERITED_AIRCRAFT)){const a=fresh.aircraft[id],parent=fresh.aircraft[base];assert.equal(a.metadata.inheritedModelId,base);assert.equal(a.metadata.year,2005);assert.ok(a.metadata.variantProvenance.geometryLimitation);assert.ok(a.metadata.variantProvenance.physicsLimitation);for(const f of ['physics','guns','fuel'])assert.equal(sha(a[f]),sha(parent[f]),id+'/'+f+' inherited approximation must stay explicit');}
 for(const[key,addedKey,expectedAdded]of [['shells','addedShells',['he_bomb_samp250_game']],['storeDefinitions','addedStoreDefinitions',['r3r','r60','samp250']]]){
  assert.deepEqual(Object.keys(migration[addedKey]).sort(),expectedAdded);assert.deepEqual(Object.keys(fresh[key]).sort(),[...Object.keys(migration[key]),...expectedAdded].sort());
  for(const[id,hash]of Object.entries(migration[key]))assert.equal(sha(fresh[key][id]),hash,key+'/'+id+' unchanged original weapon definition');
  for(const[id,hash]of Object.entries(migration[addedKey]))assert.equal(sha(fresh[key][id]),hash,key+'/'+id+' explicit provided V4 addition');
 }
 for(const[key,pin]of Object.entries(migration.newTopLevel))assert.equal(sha(fresh[key]),pin.sha256,key+' explicit source/native rule metadata migration');
 return {shells:structuredClone(fresh.shells),storeDefinitions:structuredClone(fresh.storeDefinitions)};
}
