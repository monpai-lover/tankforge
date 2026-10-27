// Explicit R83 additive view. Frozen R7/R8 receipts are never rewritten.
import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const root=new URL('../../../',import.meta.url),sha=x=>createHash('sha256').update(x).digest('hex'),canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x,hash=x=>sha(JSON.stringify(canonical(x)));
const bytes=fs.readFileSync(new URL('./r83-conventional-stores.json',import.meta.url));assert.equal(sha(bytes),'4a37cd566fb99300ce6c55498d4c98b34839285a755c3d879ace46a1a7e7edf7','Exact reviewed R83 additive receipt');
const receipt=JSON.parse(bytes),begin='/* TF_SOVIET_CONVENTIONAL_STORES_BEGIN */',end='/* TF_SOVIET_CONVENTIONAL_STORES_END */';
const edits={weaponStatusCompatibilityLoadouts:['\n    TFSovietConventionalStores.installLoadouts(AIR_LOADOUTS);','\n    TFSovietConventionalStores.inheritCompatibility(WEAPON_COMPAT);'],slotsAndCustomLoadout:['\n    const sourceAirSlotsForConventionalStores = airSlots;\n    airSlots = function(typeId) { return TFSovietConventionalStores.decorateSlots(typeId,sourceAirSlotsForConventionalStores(typeId)); };']};
export function normalizeConventionalSourceSection(name,text,app){
 if(!app.includes(begin))return text;
 for(const exact of edits[name]||[]){assert.equal(text.split(exact).length-1,1,'Exact reviewed R83 source call: '+name);text=text.replace(exact,'');}
 return text;
}
export function normalizeConventionalProfile(fresh,appPath=new URL('handoff/bundle/app.js.html',root)){
 const app=fs.readFileSync(appPath,'utf8');if(!app.includes(begin)){assert.ok(!fresh.source.sections.sovietConventionalStores,'No unbound R83 source receipt');return structuredClone(fresh);}
 assert.equal(app.split(begin).length-1,1,'One R83 source helper');assert.equal(app.split(end).length-1,1,'One R83 source helper end');
 const helperBytes=fs.readFileSync(new URL('handoff/tools/soviet_conventional_stores.js',root));assert.equal(sha(helperBytes),receipt.helperSha256,'Reviewed R83 helper body');
 const helper=helperBytes.toString('utf8').trim(),at=app.indexOf(begin),finish=app.indexOf(end,at);assert.equal(app.slice(at,finish+end.length),helper,'Actual app embeds exact R83 helper');
 assert.deepEqual(fresh.source.sections.sovietConventionalStores,{startLine:app.slice(0,at).split('\n').length,sha256:sha(app.slice(at,finish))},'R83 exporter binds actual helper section');
 const legacy=structuredClone(fresh);let total=0;
 for(const [id,pin]of Object.entries(receipt.aircraft)){
  const actual=fresh.aircraft[id],old=legacy.aircraft[id];assert.ok(actual,id+' R83 source identity');assert.equal(actual.stores.loadouts.length,pin.originalCount+pin.appended.length,id+' only explicit conventional append count');
  for(const row of pin.appended){const value=actual.stores.loadouts[row.index];assert.deepEqual({index:value.index,name:value.name,entries:value.entries},{index:row.index,name:row.name,entries:row.entries},id+' explicit R83 preset');assert.equal(hash(value),row.sha256,id+'/'+row.index+' exact mounted R83 preset');total++;}
  old.stores.loadouts=old.stores.loadouts.slice(0,pin.originalCount);
  for(const slot of old.stores.slots){const addition=pin.slots[slot.key];if(!addition)continue;
   for(const [store,count]of Object.entries(addition.options)){assert.equal(slot.options[store],count,id+'/'+slot.key+' exact smaller-bomb count');delete slot.options[store];}
   const items=old.stores.slotItems[slot.key];assert.equal(hash({fab100:items.fab100,fab250:items.fab250}),addition.itemsSha256,id+'/'+slot.key+' exact added mounted geometry');delete items.fab100;delete items.fab250;
   if(addition.defaults){for(const [store,count]of Object.entries(addition.defaults)){assert.equal(slot.defaultCounts?.[store],count,id+'/'+slot.key+' R83 default count');delete slot.defaultCounts[store];}}
  }
  for(const [key,defaults]of Object.entries(pin.existingOptionDefaultsAdded||{})){
   const slot=old.stores.slots.find(s=>s.key===key);assert.ok(slot,id+'/'+key+' existing rocket station');
   for(const [store,count]of Object.entries(defaults)){assert.equal(slot.options[store],count,id+'/'+key+' unchanged existing rocket permission');assert.equal(slot.defaultCounts?.[store],count,id+'/'+key+' exact inferred R83 rocket default');delete slot.defaultCounts[store];}
  }
 }
 assert.equal(total,20,'Exactly 20 reviewed conventional source configurations');
 for(const [id,allowed]of Object.entries(receipt.compatibilityAdded))for(const [store,value]of Object.entries(allowed)){assert.equal(legacy.weaponCompatibility[id]?.[store],value,id+'/'+store+' exact additive authorization');delete legacy.weaponCompatibility[id][store];}
 delete legacy.source.sections.sovietConventionalStores;return legacy;
}
