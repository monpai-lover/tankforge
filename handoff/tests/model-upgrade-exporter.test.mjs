import {R7_AIRCRAFT_IDS,migration} from './fixtures/r7-aircraft-contract.mjs';
import fs from 'node:fs';
import crypto from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {exportProfiles} from '../tools/export_frontline_aircraft.mjs';

const app=fs.readFileSync(new URL('../bundle/app.js.html',import.meta.url),'utf8');
const reference=JSON.parse(fs.readFileSync(new URL('./fixtures/model-upgrade-native-layout-20261025.json',import.meta.url),'utf8'));
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const profileURL=new URL('../../data/aircraft/frontline.json',import.meta.url),before=sha(fs.readFileSync(profileURL));
let result;const exported=()=>result||(result=exportProfiles());

test('exporter executes exact delivered sight/model/mount preludes and decodes all17 imported models',async()=>{
 const data=await exported();assert.equal(data.source.appSha256,sha(app));assert.deepEqual(Object.keys(data.aircraft).sort(),R7_AIRCRAFT_IDS);assert.equal(Object.values(data.aircraft).filter(value=>value.metadata.importedModel).length,17);
 for(const name of ['me262Sight','modelUpgradePrelude','modelHardpoints'])assert.match(data.source.sections[name]?.sha256||'',/^[0-9a-f]{64}$/,'Missing actual-source VM prelude receipt '+name);
 assert.equal(data.source.flightCoreVersion,215);assert.equal(data.source.flightWasmSha256,migration.cohort.flightWasmSha256);assert.equal(data.source.flightWasmSha256,sha(Buffer.from(app.match(/var FLIGHT_CORE_WASM = "([^"]+)"/)[1],'base64')));
 assert.equal(sha(fs.readFileSync(profileURL)),before,'Importing the exporter must not write the authoritative native catalog');
});

test('exported initial hardpoint positions owners and fitted keys match provided source-bound native placement fixtures',async()=>{
 const data=await exported();
 for(const [id,expected]of Object.entries(reference.models)){
  const preset=data.aircraft[id].stores.loadouts.find(loadout=>loadout.index===expected.preset.clientIndex);assert.ok(preset,id);assert.equal(preset.items.length,expected.preset.items.length,id+' item count');
  for(const target of expected.preset.items){const actual=preset.items[target.index];assert.equal(actual.id,target.id,id+' store');assert.equal(actual.count,target.count,id+' count');assert.equal(actual.owner,target.revisedOwner,id+' owner');for(let axis=0;axis<3;axis++)assert.ok(Math.abs(actual.p[axis]-target.revisedP[axis])<1e-7,`${id}/${target.id} position ${axis}: ${actual.p[axis]} vs ${target.revisedP[axis]}`);assert.equal(actual.fittedMountKey||null,target.fittedMountKey||null,id+' active fitted mount binding');}
 }
});

test('new source catalog slots preserve default-count Maps and expose physical chin pods without granting native support',async()=>{
 const data=await exported(),mid=data.aircraft.f15c.stores.slots.find(slot=>slot.station==='mid'&&slot.side===-1);assert.ok(mid);assert.ok(Object.keys(mid.defaultCounts||{}).length>0,'Map default counts must not serialize as an empty object');
 for(const [store,count]of Object.entries(mid.defaultCounts))assert.ok(Number.isInteger(count)&&count>0&&mid.options[store]>=count);
 const chin=data.aircraft.f16v.stores.slots.find(slot=>slot.station==='chin');assert.equal(chin.options.sniper,1);assert.equal(data.storeDefinitions.sniper.kind,'sensorpod');assert.ok(data.aircraft.f15c.stores.loadouts.some(loadout=>loadout.items.some(item=>item.fittedMountKey)));
 assert.equal(sha(fs.readFileSync(profileURL)),before,'Native profile remains unchanged until coordinated export');
});
