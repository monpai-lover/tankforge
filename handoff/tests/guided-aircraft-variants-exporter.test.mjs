import fs from 'node:fs';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {exportProfiles} from '../tools/export_frontline_aircraft.mjs';
const root=new URL('../../',import.meta.url),baseApp=new URL('handoff/bundle/app.js.html',root);
const tempRoot=path.resolve(process.env.TF_TEST_ARTIFACT_DIR||os.tmpdir());fs.mkdirSync(tempRoot,{recursive:true});
const temp=fs.mkdtempSync(path.join(tempRoot,'tf-guided-variants-')),appPath=path.join(temp,'candidate.html');
const python=process.env.TF_TEST_PYTHON||(process.platform==='win32'?'python':'python3');
const patcher=fileURLToPath(new URL('handoff/tools/patch_guided_aircraft_variants.py',root));
const patched=spawnSync(python,[patcher,'--input',fileURLToPath(baseApp),'--output',appPath],{encoding:'utf8'});assert.equal(patched.status,0,patched.stderr);
// Keep generated candidates recoverable. CI may archive its configured artifact
// directory; the tests never recursively delete another process's artifacts.
after(()=>{assert.equal(path.dirname(path.resolve(temp)),tempRoot);assert.match(path.basename(temp),/^tf-guided-variants-/);});
const profilePath=new URL('data/aircraft/frontline.json',root);
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const before=sha(profilePath);let cached;const result=()=>cached||(cached=exportProfiles({appPath}));

test('candidate exporter runs real variant helper and retains exactly 17 physical imported model records',async()=>{
 const r=await result();assert.equal(r.source.appSha256,sha(appPath));assert.equal(Object.keys(r.aircraft).length,28);assert.equal(Object.values(r.aircraft).filter(a=>a.metadata.importedModel).length,17);assert.equal(r.source.physicalImportedModelCount,17);
 for(const[id,base]of [['su27skm','su27'],['mig29smt','mig29']]){
  const a=r.aircraft[id],b=r.aircraft[base];assert.equal(a.metadata.inheritedModelId,base);assert.equal(a.metadata.year,2005);assert.match(a.metadata.variantProvenance.yearBasis,/export catalog/);assert.equal(a.metadata.modelMetadataSha256,b.metadata.modelMetadataSha256);assert.deepEqual(a.physics,b.physics);assert.deepEqual(a.guns,b.guns);assert.deepEqual(a.fuel,b.fuel);
  const lo=a.stores.loadouts.find(l=>l.items.some(i=>i.id==='kh29te'));assert.ok(lo);const items=lo.items.filter(i=>i.id==='kh29te');assert.equal(items.length,2);for(const i of items){assert.ok(i.p.every(Number.isFinite));const source=b.stores.loadouts.flatMap(l=>l.items).find(x=>x.station==='inner'&&x.side===i.side);assert.ok(source);assert.equal(i.owner,source.owner);assert.deepEqual(i.mount,source.mount);assert.equal(i.fittedMountKey,source.fittedMountKey);}
 }
 assert.equal(sha(profilePath),before,'candidate export is read-only');
});

test('exported sensors execute actual source equipment/radar/pod definitions without fabricating radar on early aircraft',async()=>{
 const r=await result();assert.equal(r.aircraft.p51d.sensors.radar,null);assert.deepEqual(r.aircraft.p51d.sensors.equipment,{});assert.equal(r.aircraft.su25.sensors.equipment.pod,'klenps');assert.equal(r.aircraft.su25.sensors.pods.klenps.laser,true);
 for(const id of ['su27skm','mig29smt']){const a=r.aircraft[id];assert.equal(a.sensors.equipment.radar,id);assert.ok(a.sensors.radar.pd);assert.ok(!a.sensors.equipment.pod);assert.ok(!a.stores.slots.some(s=>s.options.sniper||s.options.litening));}
 assert.equal(r.aircraft.f15c.sensors.equipment.pod,'lantirn');assert.equal(r.aircraft.f15c.sensors.pods.lantirn.laser,true);assert.match(r.source.sections.aircraftSensorDefinitions.sha256,/^[0-9a-f]{64}$/);
});

test('new Maverick presets append while actual inner mount keys and host slotItems remain source-bound',async()=>{
 const r=await result(),a=r.aircraft.f15c;
 for(const id of ['agm65b','agm65d','agm65g']){
  const lo=a.stores.loadouts.find(l=>l.items.some(i=>i.id===id));assert.ok(lo,id);const items=lo.items.filter(i=>i.id===id);assert.equal(items.length,2);for(const i of items){assert.equal(i.station,'inner');assert.ok(i.owner.startsWith('wing_'));assert.ok(i.fittedMountKey?.startsWith('f15c:')||i.modelWingCarrier&&i.modelMountBasis==='source_pylon_bottom_with_inferred_short_carrier','source existing carrier receipt');}
  for(const s of a.stores.slots.filter(s=>s.station==='inner')){assert.equal(s.options[id],1);assert.ok(a.stores.slotItems[s.key][id].some(i=>i.id===id&&i.side===s.side));}
 }
});

test('every exposed variant slot option exports its exact count ID station side and finite authoritative geometry',async()=>{
 const r=await result();let checked=0;
 for(const id of ['su27skm','mig29smt'])for(const slot of r.aircraft[id].stores.slots)for(const [weapon,count]of Object.entries(slot.options)){
  const items=r.aircraft[id].stores.slotItems[slot.key][weapon];assert.equal(items.length,count,`${id}/${slot.key}/${weapon}: every visible choice needs actual authoritative items`);
  for(const item of items){assert.equal(item.id,weapon);assert.equal(item.station,slot.station);assert.equal(item.side,slot.side);assert.equal(typeof item.owner,'string');assert.ok(item.owner.length);assert.equal(item.p.length,3);assert.ok(item.p.every(Number.isFinite));}checked++;
 }
 assert.ok(checked>=40,'coverage includes all source variant choices, not just the new ground-attack preset');
});


test('patcher is idempotent and candidate parses as actual shipped JavaScript',()=>{
 const s=fs.readFileSync(appPath,'utf8');new Function(s.slice(s.indexOf('>')+1,s.lastIndexOf('</script>')));
 const next=path.join(temp,'idempotent.html'),p=spawnSync(python,[patcher,'--input',appPath,'--output',next],{encoding:'utf8'});assert.equal(p.status,0,p.stderr);assert.equal(fs.readFileSync(next,'utf8'),s);
});

test('all existing source aircraft keep physics guns fuel and every original preset index unchanged',async()=>{
 const plain=x=>JSON.parse(JSON.stringify(x)),base=plain(await exportProfiles()),next=plain(await result());
 for(const[id,a]of Object.entries(base.aircraft)){if(['su27skm','mig29smt'].includes(id))continue;const b=next.aircraft[id];for(const k of ['metadata','physics','guns','fuel','sensors'])assert.deepEqual(b[k],a[k],id+'/'+k);for(const l of a.stores.loadouts)assert.deepEqual(b.stores.loadouts[l.index],l,id+' preset '+l.index);if(id!=='f15c')assert.deepEqual(b.stores,a.stores,id+' source stores');}
 assert.equal(sha(profilePath),before);
});
