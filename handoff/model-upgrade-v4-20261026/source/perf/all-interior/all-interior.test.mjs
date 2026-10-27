import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const here=path.dirname(fileURLToPath(import.meta.url));
process.env.TF_LIVE_APP ||= path.join(here,'current-app-with-interiors.html');
const {bundled,types,makeAircraft}=await import('../../work/tankforge-live-flight-patch/source/handoff/tests/fixtures/live-aircraft.mjs');
const fixture=JSON.parse(fs.readFileSync(path.join(here,'current-catalog-fixture.json'),'utf8'));
await bundled.decodeAircraftModels(fixture.models);await bundled.decodePilotModel(fixture.pilot);
const hash=b=>createHash('sha256').update(new Uint8Array(b)).digest('hex');
const metadata=m=>m?JSON.stringify([m.posScale,m.parts,m.movers,m.spec,m.sourceBinding]):null;
const report={catalog:Object.keys(types),aircraft:[],policy:'Display-only detailed interiors; no flight kernel or accepted damage schema mutation.'};

test('current catalog includes all 24 aircraft plus the two existing NF prototypes',()=>{
 assert.equal(Object.keys(types).length,26);
 for(const id of ['me262','me262a2a','me262u4','p51d','f4u1d','mig21','f16v','su27','nf01','nf02'])assert.ok(types[id]);
});

for(const id of Object.keys(types))test(id+': lazy detailed mechanism geometry, accepted HP bindings, O/damage/repair/disposal',()=>{
 const {plane,renderer}=makeAircraft(id),accepted=plane.damage.parts.map(p=>p.id),beforeHP=JSON.stringify(plane.damage.parts),sourceMeta=metadata(plane.type.model),sourceBytes=plane.type.model?.buf?hash(plane.type.model.buf):null;
 assert.equal(plane.detailedInterior,undefined,'AI construction must not upload hidden rich geometry');
 assert.equal(plane.interiorUpgrade.builds,0);
 const oldMeshes=plane.meshes.length,normalNodes=()=>plane.root.collect([]).map(n=>n.name).sort();
 plane.setXray(false);plane.pose(1);plane.root.update();const normalBefore=normalNodes();
 const interior=plane.ensureDetailedInterior();
 assert.ok(interior&&interior.parts.length>=8);assert.ok(plane.meshes.length>oldMeshes);
 assert.ok(interior.triangles>=4000&&interior.triangles<30000);
 assert.equal(plane.interiorUpgrade.builds,1);
 assert.equal(plane.ensureDetailedInterior(),interior);assert.equal(plane.interiorUpgrade.builds,1);
 assert.deepEqual(plane.damage.parts.map(p=>p.id),accepted);assert.equal(JSON.stringify(plane.damage.parts),beforeHP);
 assert.equal(metadata(plane.type.model),sourceMeta);if(sourceBytes)assert.equal(hash(plane.type.model.buf),sourceBytes);
 assert.ok(interior.parts.some(p=>p.role==='engine'),'real engine mechanics must exist');
 assert.ok(interior.parts.some(p=>p.role==='fuel'),'fuel mechanisms must exist');
 const allowed=new Set(accepted);
 for(const p of interior.parts){
  assert.ok(p.damageIds.length&&p.damageIds.every(id=>allowed.has(id)),p.instanceId+' must bind accepted HP');
  assert.ok(p.owner===null||allowed.has(p.owner));
  assert.equal(p.node.mesh._src.data,p.data);assert.ok(p.data.every(Number.isFinite));
  if(p.inspectionCutaway){assert.equal(p.renderNode.mesh._src.data,p.renderData);assert.equal(p.renderNode.hitboxDisabled,true);assert.equal(p.node.aircraftHiddenSkin,true);}
  if(p.displayOnly){assert.equal(p.enabled,false);assert.equal(p.node.hitboxDisabled,true);}
 }
 plane.setXray(true);plane.pose(1);plane.root.update();
 assert.equal(interior.root.visible,true);assert.ok(!plane.internalNode?.visible);
 assert.ok(plane.partNodes.every(n=>!n.visible));
 const drawn=new Set(plane.root.collect([]));
 assert.ok(interior.parts.some(p=>p.role==='engine'&&drawn.has(p.node)));
 assert.ok(interior.parts.filter(p=>p.role==='structure').every(p=>!drawn.has(p.node)));
 const engine=interior.parts.find(p=>p.role==='engine'),record=plane.damage.by[engine.id];record.hp=record.max*.35;plane.damage.revision++;
 plane._showParts();assert.ok(engine.node.highlight[3]>0,'accepted engine damage colours its actual mechanism');
 const owner=interior.parts.find(p=>p.owner)?.owner;
 if(owner){
  const owned=interior.parts.filter(p=>p.owner===owner);plane.damage.by[owner].detached=true;plane.damage.revision++;plane._showParts();
  assert.ok(owned.every(p=>p.node.hitboxDisabled&&!p.node.visible));
 }
 plane.spawn(0,100,0,0,140,false);
 assert.equal(plane.detailedInterior,interior,'respawn rebinds HP without another geometry upload');
 assert.equal(plane.interiorUpgrade.builds,1);assert.deepEqual(plane.damage.parts.map(p=>p.id),accepted);
 assert.ok(interior.parts.every(p=>p.node.hitboxDisabled===!!p.displayOnly));
 plane.setXray(false);plane.pose(1);plane.root.update();
 assert.equal(interior.root.visible,false);assert.deepEqual(normalNodes(),normalBefore,'O release restores the same normal draw membership');
 const frees=[];renderer.freeMesh=mesh=>{assert.ok(!frees.includes(mesh),'no double free');frees.push(mesh);};
 const expectedFrees=plane.meshes.length;plane.dispose();assert.equal(frees.length,expectedFrees);assert.equal(plane.meshes.length,0);assert.equal(plane.ensureDetailedInterior,null);
 if(!interior.preservesAuthoredInternal){
  assert.ok(interior.generatedMechanisms);assert.ok(interior.serviceModules>=2);
  assert.ok(interior.renderTriangles<=interior.triangles&&interior.uploadedTriangles<=30000);
  assert.equal(interior.parts.filter(p=>p.role==='structure').length,0,'Hidden approximate framework is never generated');
  assert.ok(interior.parts.some(p=>p.instanceId.includes('deep_engine_accessory')));
  assert.ok(interior.parts.some(p=>p.instanceId.includes('deep_hydraulic_manifold')));
  assert.ok(interior.inspectionCutaways>0,'Generated tanks have inspection openings');
  for(const p of interior.parts.filter(p=>p.inspectionCutaway))assert.ok(p.renderData.length<p.data.length);
 }
 report.aircraft.push({id,triangles:interior.triangles,renderTriangles:interior.renderTriangles,uploadedTriangles:interior.uploadedTriangles,mechanismModules:interior.parts.length,preservesAuthoredInternal:interior.preservesAuthoredInternal,serviceModules:interior.serviceModules||0,inspectionCutaways:interior.inspectionCutaways||0,radialCylinders:interior.radialCylinders||0,wingEnvelopeFuel:interior.wingEnvelopeFuel||false,roles:[...new Set(interior.parts.map(p=>p.role))],acceptedBindings:true,lazy:true});
});

test.after(()=>fs.writeFileSync(path.join(here,'all-interior-test-results.json'),JSON.stringify(report,null,2)+'\n'));
