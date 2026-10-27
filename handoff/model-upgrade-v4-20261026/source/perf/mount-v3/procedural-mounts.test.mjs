import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as details from './details.mjs';
import {FITTED_MOUNTS} from './fitted-mounts.mjs';
import {createLayout} from '../hardpoints/actual-layout-fixture.mjs';
process.env.TF_LIVE_APP ||=new URL('./app-fixed.html',import.meta.url).pathname;
const {bundled,makeAircraft}=await import('../../work/tankforge-live-flight-patch/source/handoff/tests/fixtures/live-aircraft.mjs');
const source=fs.readFileSync(process.env.TF_LIVE_APP,'utf8'),L=createLayout(source,bundled.AIRCRAFT_TYPES);
const plain=x=>JSON.parse(JSON.stringify(x));
for(const id of['nf01','f4u1d']){
 test(id+': exact procedural geometry accepts8 physical mounts; changed source or geometry rejects profiles',()=>{
  const T=bundled.AIRCRAFT_TYPES[id],raw=T.geometry(),profile=FITTED_MOUNTS[id],base={...raw,mountFitVersion:undefined,mountFitAdded:undefined};
  assert.equal(profile.sourceMain,'procedural:'+id+'-v1');assert.deepEqual(details.proceduralGeometryFingerprint(base),profile.proceduralGeometry);
  const g=details.airframe(id,null,base);assert.equal(g.mountFitAdded.length,8);assert.ok(g.mountFitAdded.every(x=>x.data.length>0&&x.data.every(Number.isFinite)));assert.deepEqual(g.mountFitAdded.map(p=>p.owner),profile.mounts.map(p=>p.owner));
  assert.equal(details.airframe(id,{sourceHashes:{main:'different-source'}},base),base);
  const altered={...base,body:base.body.slice(),mountBaseBody:undefined};altered.body[0]+=.001;assert.equal(details.airframe(id,null,altered),altered,'A geometry change invalidates the fitted profile');
  assert.equal(details.airframe('p51d',null,base),base,'Another procedural aircraft cannot use these supports');
  const lo=L.AIR_LOADOUTS[id].find(x=>x[1].some(e=>e[0]==='hvar')),items=L.layoutStores(T,lo);assert.ok(items.some(x=>x.fittedMountKey?.startsWith(id+':')));
  const frozen=plain(items.map(x=>({...x,mountFitVersion:undefined})));const input=frozen.map(x=>({...x,p:x.p.slice(),mount:x.mount?.slice()}));details.fitItems({...T,model:{sourceHashes:{main:'different-source'}}},input);assert.deepEqual(input,frozen,'Unknown source leaves item transforms unchanged');
 });
 test(id+': only physically selected adapter triangles are active and carrier detachment hides them',()=>{
  const T=bundled.AIRCRAFT_TYPES[id],raw=T.geometry(),base={...raw,mountFitVersion:undefined,mountFitAdded:undefined},g=details.airframe(id,null,base),{plane}=makeAircraft(id);
  details.install(plane,{Node:bundled.Node,geometry:g});assert.equal(plane.mountFitNodes.length,8);assert.equal(plane.hitbox.mountActive.size,0);assert.ok(plane.mountFitNodes.every(n=>!n.visible&&n.hitboxDisabled));
  const node=plane.mountFitNodes[0],key=node.mountKey;details.attach(plane,[{fittedMountKey:key}]);assert.deepEqual([...plane.hitbox.mountActive],[key]);assert.equal(plane.mountFitNodes.filter(n=>n.visible).length,1);assert.equal(node.hitboxDisabled,false);
  const mask=new Uint8Array(plane.hitbox.pieces.length).fill(1);details.maskAlive(plane.hitbox,mask);for(let i=0;i<plane.hitbox.pieces.length;i++){const k=plane.hitbox.pieces[i].mountKey;if(k)assert.equal(mask[i],k===key?1:0);}
  // Attaching is a spawn-layout operation. A later weapon release does not call attach,
  // so its physical support remains until the actual damage carrier is gone.
  details.show(plane);assert.equal(node.visible,true);plane.damage._detach(plane.damage.by[node.mountOwner]);plane.applyDamage();details.show(plane);assert.equal(node.visible,false);assert.equal(node.hitboxDisabled,true);
 });
}
