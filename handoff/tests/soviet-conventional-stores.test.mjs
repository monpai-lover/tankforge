import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import test from 'node:test';
const helper=new URL('../tools/soviet_conventional_stores.js',import.meta.url),native=JSON.parse(fs.readFileSync(new URL('../../data/aircraft/frontline.json',import.meta.url),'utf8'));
function setup(){assert.ok(fs.existsSync(helper),'source-owned conventional-store adapter required');const c=vm.createContext({Map});vm.runInContext(fs.readFileSync(helper,'utf8'),c);return c.TFSovietConventionalStores;}
const plain=v=>JSON.parse(JSON.stringify(v));
const originalCounts={su27:3,su27skm:4,mig29:4,mig29smt:6};
test('all four distinct source aircraft gain conventional presets without replacing existing indices',()=>{
 const owner=setup(),loadouts=Object.fromEntries(['su27','su27skm','mig29','mig29smt'].map(id=>[id,native.aircraft[id].stores.loadouts.slice(0,originalCounts[id]).map(l=>[l.name,l.entries])])),before=structuredClone(loadouts);
 owner.installLoadouts(loadouts);for(const id of Object.keys(before)){assert.deepEqual(plain(loadouts[id].slice(0,before[id].length)),before[id]);for(const store of ['fab100','fab250','fab500','b8m1'])assert.ok(loadouts[id].slice(before[id].length).some(([,e])=>e.some(s=>s[0]===store)),id+'/'+store);}
 for(const id of ['mig29','mig29smt'])for(const store of ['ub16','s24b'])assert.ok(loadouts[id].slice(before[id].length).some(([,e])=>e.some(s=>s[0]===store)),id+'/'+store);
 const once=plain(loadouts);owner.installLoadouts(loadouts);assert.deepEqual(plain(loadouts),once);
 for(const [id,rows]of Object.entries(loadouts))for(const [,entries]of rows.slice(before[id].length)){assert.ok(!entries.some(([store])=>/^(rvvae|kh|kab|pl12|r27e)/.test(store)),'conventional patch must not move upgraded guided weapons to base airframes');assert.ok(entries.some(([store])=>store===(id.endsWith('skm')||id.endsWith('smt')?'r73e':'r73')));}
});
test('smaller bombs reuse only existing bomb-authorized stations and retain counts, coordinates and other aircraft choices',()=>{
 const owner=setup();for(const id of ['su27','su27skm','mig29','mig29smt']){
  const slots=native.aircraft[id].stores.slots.map(s=>({...s,options:new Map(Object.entries(s.options)),incomplete:new Map(Object.entries(s.incomplete))})),before=slots.map(s=>[...s.options]);
  const output=owner.decorateSlots(id,slots);assert.deepEqual(slots.map(s=>[...s.options]),before,'input remains owned by source');
  output.forEach((slot,i)=>{for(const store of ['fab100','fab250'])assert.equal(slot.options.get(store),slots[i].options.get('fab500'),'counts/stations follow the existing FAB-500 mount authorization');});
 }
 const untouched=[{station:'inner',options:new Map([['mk82',1]])}];assert.equal(owner.decorateSlots('f16v',untouched),untouched);
 assert.equal(owner.decorateSlots('mig29',[]).length,0);
});
test('source adapter provenance keeps UBK and 9.12 separate from the explicit upgraded variants',()=>{
 const owner=setup();assert.ok(owner.provenance.su27.variant.includes('UBK'));assert.ok(owner.provenance.mig29.variant.includes('9.12'));assert.ok(owner.provenance.su27skm.variant.includes('SKM'));assert.ok(owner.provenance.mig29smt.variant.includes('SMT'));
});
test('candidate patch preserves source line endings, rejects moved anchors, and composes idempotently',async()=>{
 const {patchSovietConventionalStores}=await import('../tools/patch_soviet_conventional_stores.mjs');
 const original=fs.readFileSync(new URL('../bundle/app.js.html',import.meta.url),'utf8').replaceAll('\r\n','\n');
 for(const eol of ['\n','\r\n']){const source=original.replaceAll('\n',eol),once=patchSovietConventionalStores(source);assert.equal(patchSovietConventionalStores(once),once);if(eol==='\r\n')assert.equal(/(?<!\r)\n/.test(once),false);assert.throws(()=>patchSovietConventionalStores(source.replace('TFGuidedAircraftVariants.installLoadouts(AIR_LOADOUTS);','MOVED(AIR_LOADOUTS);')),/Unique/);}
});