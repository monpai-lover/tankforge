import fs from 'node:fs';import test from 'node:test';import assert from 'node:assert/strict';
import {normalizeConventionalProfile,normalizeConventionalSourceSection} from './fixtures/r83-conventional-contract.mjs';
import {assertR7ExportContract} from './fixtures/r7-aircraft-contract.mjs';
const source=fs.readFileSync(new URL('../bundle/app.js.html',import.meta.url),'utf8'),profile=JSON.parse(fs.readFileSync(new URL('../../data/aircraft/frontline.json',import.meta.url),'utf8'));
test('explicit 20-preset R83 view normalizes to the exact frozen R7/R8 contract without mutating the actual catalog',()=>{
 const before=JSON.stringify(profile),old=normalizeConventionalProfile(profile);for(const [id,count]of Object.entries({su27:3,su27skm:4,mig29:4,mig29smt:6}))assert.equal(old.aircraft[id].stores.loadouts.length,count);
 assert.equal(old.source.sections.sovietConventionalStores,undefined);assertR7ExportContract(profile);assert.equal(JSON.stringify(profile),before);
});
test('new append counts, weapon identities, source mounts and default-count permissions reject mutations',()=>{
 const edits=[p=>p.aircraft.su27.stores.loadouts.push(structuredClone(p.aircraft.su27.stores.loadouts[3])),p=>p.aircraft.su27.stores.loadouts[3].entries[0][0]='rvvae',p=>p.aircraft.su27.stores.slots.find(s=>s.key==='inner:-1').options.fab100=2,p=>p.aircraft.mig29.stores.slotItems['inner:-1'].fab100[0].p[0]+=.001,p=>p.aircraft.mig29.stores.slots.find(s=>s.key==='inner:-1').defaultCounts.fab250=2];
 for(const edit of edits){const next=structuredClone(profile);edit(next);assert.throws(()=>normalizeConventionalProfile(next),/R83|conventional|smaller-bomb|geometry|default count/);}
});
test('explicit R83 normalization does not excuse a changed legacy preset or explosive filler',()=>{
 for(const edit of [p=>p.aircraft.mig29.stores.loadouts[1].items[0].count++,p=>p.storeDefinitions.fab100.warhead.explosive_mass_kg++]){const next=structuredClone(profile);edit(next);assert.throws(()=>assertR7ExportContract(next),/immutable|original|FAB|fab100|preset|stores/i);}
});
test('source normalization removes only exact reviewed calls and rejects missing, changed or duplicate hooks',()=>{
 const a=source.indexOf('    const WEAPON_STATUS = '),b=source.indexOf('    /**\n     * Fire-control radars',a),text=source.slice(a,b),call='\n    TFSovietConventionalStores.installLoadouts(AIR_LOADOUTS);';
 assert.ok(!normalizeConventionalSourceSection('weaponStatusCompatibilityLoadouts',text,source).includes('TFSovietConventionalStores'));
 for(const next of [text.replace(call,''),text.replace(call,call+call),text.replace('TFSovietConventionalStores.installLoadouts(AIR_LOADOUTS)','TFSovietConventionalStores.installLoadouts(OTHER)')])assert.throws(()=>normalizeConventionalSourceSection('weaponStatusCompatibilityLoadouts',next,source),/Exact reviewed R83 source call/);
});
