import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import {api,c} from './jet-fixture.mjs';
const helper=new URL('../tools/guided_aircraft_variants.js',import.meta.url);
const original=JSON.stringify({su27:api.AIR_FIGHTERS.su27,mig29:api.AIR_FIGHTERS.mig29,su27Loadouts:api.AIR_LOADOUTS.su27,mig29Loadouts:api.AIR_LOADOUTS.mig29});
if(fs.existsSync(helper))vm.runInContext(fs.readFileSync(helper,'utf8'),c);
const V=c.TFGuidedAircraftVariants;
V?.installTypes(api.AIR_FIGHTERS,api.AIRCRAFT_TYPES);
V?.installLoadouts(api.AIR_LOADOUTS);
V?.inheritTables({compatibility:vm.runInContext('WEAPON_COMPAT',c)});
const slots=id=>V?V.decorateSlots(id,api.airSlots(V.sourceId(id))):api.airSlots(id);
const plain=x=>JSON.parse(JSON.stringify(x));

test('explicit SKM and SMT IDs inherit actual imported meshes and flight data without changing their bases',()=>{
 for(const[id,base,name]of [['su27skm','su27','Su-27SKM'],['mig29smt','mig29','MiG-29SMT']]){
  const T=api.AIRCRAFT_TYPES[id],B=api.AIRCRAFT_TYPES[base];assert.ok(T,id+' exists');assert.match(T.name,new RegExp(name));assert.equal(T.variantSourceId,base);assert.equal(T.model,B.model);assert.equal(T.geometry,B.geometry);assert.deepEqual(plain(T.airframe),plain(B.airframe));assert.equal(T.fighter.era,'2005');assert.match(T.variantProvenance.yearBasis,/export catalog/);assert.match(T.variantProvenance.geometryLimitation,/inherited/);assert.match(T.variantProvenance.physicsLimitation,/inherited/);
 }
 assert.equal(JSON.stringify({su27:api.AIR_FIGHTERS.su27,mig29:api.AIR_FIGHTERS.mig29,su27Loadouts:api.AIR_LOADOUTS.su27,mig29Loadouts:api.AIR_LOADOUTS.mig29}),original);
});

test('variant choices expose exported missiles and a mirrored inner pair',()=>{
 for(const id of ['su27skm','mig29smt']){
  const all=slots(id),inner=all.filter(s=>s.station==='inner');assert.equal(inner.length,2,id+' inner pair');
  for(const s of inner)assert.equal(s.options.get('kh29te'),1,id+' Kh-29TE');
  assert.ok(!all.some(s=>['sniper','litening','alq131'].some(w=>s.options.has(w))),'no western pods on Soviet variants');
  assert.ok(all.some(s=>s.options.has('r73e')));assert.ok(all.some(s=>s.options.has('r27r1')));assert.ok(all.some(s=>s.options.has('r27t1')));
  const T=api.AIRCRAFT_TYPES[id],lo=api.AIR_LOADOUTS[id].find(x=>x[1].some(e=>e[0]==='kh29te'));assert.ok(lo,id+' preset');
  const items=api.layoutStores(T,lo).filter(it=>it.id==='kh29te');assert.equal(items.length,2);assert.deepEqual(plain(items.map(it=>it.side).sort()),[-1,1]);
  for(const it of items)assert.ok(it.p.every(Number.isFinite));
 }
});

test('F15 wire ID remains existing F15E and gains separate B D G Maverick choices only on its inner pair',()=>{
 assert.match(api.AIRCRAFT_TYPES.f15c.name,/F-15E/);
 for(const s of slots('f15c'))for(const id of ['agm65b','agm65d','agm65g'])assert.equal(s.options.has(id),s.station==='inner',s.key+' '+id);
 const presets=api.AIR_LOADOUTS.f15c.filter(x=>x[1].some(e=>/^agm65[bdg]$/.test(e[0])));assert.equal(presets.length,3);
 for(const lo of presets){const items=api.layoutStores(api.AIRCRAFT_TYPES.f15c,lo).filter(it=>/^agm65/.test(it.id));assert.equal(items.length,2);for(const it of items)assert.ok(it.p.every(Number.isFinite));}
});

test('variants clone metadata tables and carry own native radar IDs without assigning a western pod',()=>{
 assert.ok(V,'variant helper loaded');const eq={su27:{radar:'su27',irst:true,hms:true},mig29:{radar:'mig29',hms:true}},rad={su27:{name:'N001',range:80,pd:true},mig29:{name:'N019',range:70,pd:true}},fuel={su27:[1,2,3],mig29:[4,5,6]},cm={su27:{flares:48,chaff:48},mig29:{flares:30,chaff:30}},compat={su27:{r73:'primary'},mig29:{r73:'primary'}};
 const before=JSON.stringify({eq,rad,fuel,cm,compat});V.inheritTables({equipment:eq,radars:rad,fuel,countermeasures:cm,compatibility:compat});
 for(const[id,base]of [['su27skm','su27'],['mig29smt','mig29']]){assert.equal(eq[id].radar,id);assert.ok(!eq[id].pod);assert.deepEqual(plain(fuel[id]),plain(fuel[base]));assert.notEqual(fuel[id],fuel[base]);assert.deepEqual(plain(cm[id]),plain(cm[base]));assert.ok(compat[id].kh29te);assert.ok(rad[id]);}
 assert.equal(JSON.stringify({eq:{su27:eq.su27,mig29:eq.mig29},rad:{su27:rad.su27,mig29:rad.mig29},fuel:{su27:fuel.su27,mig29:fuel.mig29},cm:{su27:cm.su27,mig29:cm.mig29},compat:{su27:compat.su27,mig29:compat.mig29}}),before);
});
