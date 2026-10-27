import {migration} from './fixtures/r7-aircraft-contract.mjs';
import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {exportProfiles} from '../tools/export_frontline_aircraft.mjs';
import {api,c} from './jet-fixture.mjs';

const sha=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const previous=JSON.parse(fs.readFileSync(new URL('../../data/aircraft/frontline.json',import.meta.url),'utf8'));
const sanitize=items=>JSON.parse(JSON.stringify(items.map(({def,sourceStore,sourceMount,...item})=>({...item,
  ...(sourceStore?{sourceStore:{id:sourceStore.id,sourceParts:sourceStore.sourceParts}}:{}),
  ...(sourceMount?{sourceMount:{id:sourceMount.id,sourceParts:sourceMount.sourceParts}}:{})}))));
let exported;const fresh=()=>exported||(exported=exportProfiles());

test('every declared native slot option exports geometry from the actual custom loadout path',async()=>{
  const profile=await fresh();let options=0;
  for(const[id,a]of Object.entries(profile.aircraft))for(const slot of a.stores.slots)for(const[store,count]of Object.entries(slot.options)){
    const actual=a.stores.slotItems?.[slot.key]?.[store];assert.ok(Array.isArray(actual),`${id}/${slot.key}/${store} exact catalog geometry`);
    c.G4.airCustom[id]={[slot.key]:store};c.G4.airCustomCounts[id]={[slot.key]:count};
    const original=api.layoutStores(api.AIRCRAFT_TYPES[id],api.customLoadout(id));
    assert.deepEqual(JSON.parse(JSON.stringify(actual)),sanitize(original),`${id}/${slot.key}/${store} retains actual imported-model position/owner/count/fitted metadata`);options++;
  }
  assert.ok(options>300);c.G4.airCustom={};c.G4.airCustomCounts={};
});

test('the seven newly supported bomb sockets have exact fitted model geometry without inventing presets',async()=>{
  const profile=await fresh(),cases=[['f15c','inner',-1,'gbu12'],['f15c','inner',1,'gbu12'],['f15c','inner',-1,'gbu10'],['f15c','inner',1,'gbu10'],['f15c','center',0,'gbu10'],['f16v','inner',-1,'mk84'],['f16v','inner',1,'mk84']];
  for(const[id,station,side,store]of cases){const a=profile.aircraft[id],slot=a.stores.slots.find(s=>s.station===station&&s.side===side);assert.equal(slot.options[store],1);
    const items=a.stores.slotItems[slot.key][store];assert.equal(items.length,1);assert.equal(items[0].id,store);assert.equal(items[0].count,1);assert.ok(items[0].p.every(Number.isFinite));if(id==='f15c'&&station==='inner'){assert.equal(items[0].modelWingCarrier,migration.geometry.modelWingCarrier);assert.equal(items[0].modelMountBasis,'source_pylon_bottom_with_inferred_short_carrier');assert.equal(items[0].nativePylon,false);}else{assert.ok(items[0].fittedMountKey);assert.equal(items[0].mountFitVersion,migration.geometry.mountFitVersion);}
  }
  for(const[id,a]of Object.entries(profile.aircraft))assert.equal(sha(a.stores.loadouts),sha(previous.aircraft[id].stores.loadouts),id+' existing preset list/quantities are unchanged');
});
