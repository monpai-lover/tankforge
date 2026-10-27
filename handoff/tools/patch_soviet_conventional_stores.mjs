import fs from 'node:fs';import assert from 'node:assert/strict';
const begin='/* TF_SOVIET_CONVENTIONAL_STORES_BEGIN */',end='/* TF_SOVIET_CONVENTIONAL_STORES_END */';
const helper=fs.readFileSync(new URL('./soviet_conventional_stores.js',import.meta.url),'utf8').replaceAll('\r\n','\n').trim();
const edits=[
 ['    TFGuidedAircraftVariants.installLoadouts(AIR_LOADOUTS);','    TFGuidedAircraftVariants.installLoadouts(AIR_LOADOUTS);\n    TFSovietConventionalStores.installLoadouts(AIR_LOADOUTS);'],
 ['    TFGuidedAircraftVariants.inheritTables({compatibility: WEAPON_COMPAT});','    TFGuidedAircraftVariants.inheritTables({compatibility: WEAPON_COMPAT});\n    TFSovietConventionalStores.inheritCompatibility(WEAPON_COMPAT);'],
 ['    airSlots = function(typeId) { return TFGuidedAircraftVariants.decorateSlots(typeId, sourceAirSlotsForGuidedVariants(TFGuidedAircraftVariants.sourceId(typeId))); };','    airSlots = function(typeId) { return TFGuidedAircraftVariants.decorateSlots(typeId, sourceAirSlotsForGuidedVariants(TFGuidedAircraftVariants.sourceId(typeId))); };\n    const sourceAirSlotsForConventionalStores = airSlots;\n    airSlots = function(typeId) { return TFSovietConventionalStores.decorateSlots(typeId,sourceAirSlotsForConventionalStores(typeId)); };']
];
export function patchSovietConventionalStores(source){
 const crlf=source.includes('\r\n')&&!/(?<!\r)\n/.test(source);source=source.replaceAll('\r\n','\n');
 if(source.includes(begin)){
  assert.equal(source.split(begin).length-1,1,'Unique conventional-store helper');assert.equal(source.split(end).length-1,1,'Unique conventional-store helper end');const a=source.indexOf(begin),b=source.indexOf(end,a)+end.length;assert.equal(source.slice(a,b),helper,'Reviewed conventional-store helper differs');
 }else{const anchor='/* TF_GUIDED_AIRCRAFT_VARIANTS_BEGIN */';assert.equal(source.split(anchor).length-1,1,'Unique guided-variant source anchor');source=source.replace(anchor,helper+'\n'+anchor);}
 for(const [before,after]of edits){const n=source.split(after).length-1;if(n){assert.equal(n,1,'Unique installed conventional-store hook');continue;}assert.equal(source.split(before).length-1,1,'Unique source conventional-store hook');source=source.replace(before,after);}
 return crlf?source.replaceAll('\n','\r\n'):source;
}
