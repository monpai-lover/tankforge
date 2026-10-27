import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createAircraftHitbox} from '../../work/tankforge-live-flight-patch/source/handoff/flight-rust/aircraft-hitbox.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
process.env.TF_LIVE_APP ||= path.join(here,'../model-upgrade-app.html');
const {bundled,types,makeAircraft}=await import('../../work/tankforge-live-flight-patch/source/handoff/tests/fixtures/live-aircraft.mjs');
const fixture=JSON.parse(fs.readFileSync(path.join(here,'current-catalog-fixture.json')));
await bundled.decodeAircraftModels(fixture.models);await bundled.decodePilotModel(fixture.pilot);
const {buildAircraftInterior:beforeBuilder}=await import('./deep-audit/interior-before.mjs');
const bytesHash=a=>createHash('sha256').update(new Uint8Array(a.buffer,a.byteOffset,a.byteLength)).digest('hex');
const expectedAuthored=['mig15','f86f','f104g','me262','hunter6','mirage3e','mig29','me262a2a','me262u4'];

for(const id of expectedAuthored)test(id+': dedicated geometry survives the deep upgrade byte for byte',()=>{
 const {plane}=makeAircraft(id),current=plane.ensureDetailedInterior(),{plane:oldPlane}=makeAircraft(id),old=beforeBuilder(oldPlane,{Node:bundled.Node});
 const currentParts=current.parts.filter(p=>!p.preserved),oldParts=old.parts.filter(p=>!p.preserved);
 assert.equal(current.preservesAuthoredInternal,true);assert.equal(currentParts.length,oldParts.length);
 for(let i=0;i<oldParts.length;i++){
  assert.equal(currentParts[i].instanceId,oldParts[i].instanceId);
  assert.equal(bytesHash(currentParts[i].data),bytesHash(oldParts[i].data));
  assert.equal(currentParts[i].renderData,currentParts[i].data);assert.equal(currentParts[i].displayOnly,false);
 }
 assert.equal(current.addedTriangles,0);assert.ok(!current.parts.some(p=>p.renderNode));
});

for(const id of ['nf01','mig21','p51d','mig17f','f4e','f15c','su27','a10a','su25'])test(id+': service details add no collision and fuel inspection leaves a closed contact surface',async()=>{
 const {plane}=makeAircraft(id),interior=plane.ensureDetailedInterior();plane.pose(1);plane.root.update();
 const hb=createAircraftHitbox(plane,{interior,damagePolicy:'live212'}),audit=await hb.audit();
 assert.ok(interior.parts.some(p=>p.displayOnly));
 assert.ok(audit.entries.every(p=>!p.instanceId.includes('/deep_')),'Auxiliaries must not add contacts');
 for(const p of interior.parts.filter(p=>p.inspectionCutaway)){
  assert.equal(p.node.mesh._src.data,p.data);assert.notEqual(p.renderNode.mesh._src.data,p.data);
  const e=audit.entries.find(e=>e.instanceId===p.instanceId);assert.ok(e);assert.equal(e.triangles,p.data.length/39);
  let j=-1;
  for(let i=0;i<p.data.length;i+=39)if(p.data[i+4]>.65&&p.data[i+6]>.5){j=i;break;}
  if(j<0)continue;
  const c=[0,1,2].map(k=>(p.data[j+k]+p.data[j+13+k]+p.data[j+26+k])/3),n=Array.from(p.data.slice(j+3,j+6)),span=createAircraftHitbox(plane,{interior:{parts:[p]},damagePolicy:'live212'});
  const ray=span.trace(c.map((v,k)=>v+n[k]*.05),c.map((v,k)=>v-n[k]*.05));
  assert.ok(ray.contacts.length,'The removed visual tank lid must remain physical');
 }
 const hash=audit.entries.map(e=>[e.instanceId,e.positionHash,e.triangles]);
 plane.setXray(true);plane.pose(1);plane.root.update();assert.deepEqual((await hb.audit()).entries.map(e=>[e.instanceId,e.positionHash,e.triangles]),hash);
 plane.setXray(false);plane.pose(1);plane.root.update();assert.deepEqual((await hb.audit()).entries.map(e=>[e.instanceId,e.positionHash,e.triangles]),hash);
});

test('radial banks and wing-envelope tanks use aircraft-specific mechanical layouts',()=>{
 for(const [id,cylinders]of [['a6m2',14],['fw190a8',14],['f4u1d',18]])assert.equal(makeAircraft(id).plane.ensureDetailedInterior().radialCylinders,cylinders);
 for(const id of ['yak9u','a6m2']){
  const i=makeAircraft(id).plane.ensureDetailedInterior();assert.equal(i.wingEnvelopeFuel,true);assert.ok(!i.parts.some(p=>p.instanceId.endsWith('/fuel_fuselage')));assert.ok(i.parts.some(p=>p.owner==='wing_l'&&p.role==='fuel'));
 }
});

test('damage heat is tied to accepted health/fire and clears after repair',()=>{
 const {plane}=makeAircraft('mig21'),i=plane.ensureDetailedInterior(),p=i.parts.find(p=>p.role==='fuel'&&!p.displayOnly),d=plane.damage.by[p.id];
 i.setVisible(true);d.hp=d.max*.45;i.updateDamage();assert.ok(p.node.highlight[1]>.4);assert.deepEqual(p.renderNode.highlight,p.node.highlight);
 d.hp=d.max;d.fire=true;i.updateDamage();assert.ok(p.node.highlight[3]>.2);d.fire=false;i.updateDamage();assert.equal(p.node.highlight[3],0);
});
