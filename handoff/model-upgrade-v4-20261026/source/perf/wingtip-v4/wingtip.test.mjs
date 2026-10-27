import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {createLayout,declaration} from '../hardpoints/actual-layout-fixture.mjs';
import * as hardpoints from '../hardpoints/helper.mjs';
import * as details from '../mount-v3/details.mjs';
import {FITTED_MOUNTS} from '../mount-v3/fitted-mounts.mjs';
process.env.TF_LIVE_APP=fileURLToPath(new URL('../site-live-current-app.html',import.meta.url));
const {bundled}=await import('../../work/tankforge-live-flight-patch/source/handoff/tests/fixtures/live-aircraft.mjs');
const fixture=JSON.parse(fs.readFileSync(new URL('../all-interior/current-catalog-fixture.json',import.meta.url)));
await bundled.decodeAircraftModels(fixture.models);
const source=fs.readFileSync(process.env.TF_WINGTIP_APP||new URL('../model-upgrade-app.html',import.meta.url),'utf8');
const layout=createLayout(source,bundled.AIRCRAFT_TYPES);
const sockets=JSON.parse(fs.readFileSync(new URL('../hardpoints/store-sockets.json',import.meta.url)));
const quatMatrix=vm.runInNewContext('('+declaration(source,'quatMatrix')+')');
const json=x=>JSON.parse(JSON.stringify(x));
const close=(a,b,tolerance=2e-7)=>a.forEach((v,k)=>assert(Math.abs(v-b[k])<=tolerance,`${a} != ${b}`));
const transform=(p,q,v)=>{const m=quatMatrix(p,q);return[0,1,2].map(k=>m[k]*v[0]+m[4+k]*v[1]+m[8+k]*v[2]+m[12+k]);};
for(const [id,ids]of [['f104g',['aim9b']],['f16v',['aim9m','aim9x','aim120b','aim120c']]])for(const storeId of ids)test(`${id} ${storeId}: both source wingtip channels side-mount the physical socket`,()=>{
 const T=bundled.AIRCRAFT_TYPES[id],items=layout.layoutStores(T,['review',[[storeId,2,'tip']]]);
 assert.equal(items.length,2);
 for(const it of items){
  const binding=hardpoints.measuredProfile(T).bindings.find(b=>b.station==='tip'&&b.side===it.side),profile=FITTED_MOUNTS[id].mounts.find(p=>p.station==='tip'&&p.side===it.side);
  assert.equal(binding.attachmentFace,'outboard_side');
  assert.equal(it.modelMountBasis,'whole_mesh_clearance_with_physical_airframe_adapter');
  assert.equal(it.pylon,null);assert.equal(it.nativePylon,true);assert(it.fittedMountKey);
  assert(Math.abs(it.p[0])>Math.abs(binding.point[0])+.08,'Store body occupies the outboard side of the source channel');
  close([it.p[1]],[binding.point[1]],1e-10);
  close(it.mount,profile.end,1e-10);
  close(it.storeRotation,[0,0,it.side*Math.SQRT1_2,Math.SQRT1_2],1e-10);
  const socket=sockets[it.def.model].sockets.socket_mount.map((v,k)=>k===0?-v:v);
  close(transform(it.p,hardpoints.storeRotation(it),socket),it.mount);
  close(transform([0,0,0],hardpoints.storeRotation(it),[0,0,1]),[0,0,1]);
  assert.equal(it.owner,binding.owner+'_out');
  const fresh=layout.layoutStores(T,['review',[[storeId,2,'tip']]]);
  close(fresh.find(x=>x.side===it.side).p,it.p);
 }
});
test('unknown model revisions retain their ordinary layout and receive no rail rotation',()=>{
 const T=bundled.AIRCRAFT_TYPES.f16v,unknown={...T,model:{...T.model,sourceHashes:{main:'unknown'}}};
 const items=layout.layoutStores(unknown,['review',[['aim9m',2,'tip']]]);
 assert(items.every(it=>!it.storeRotation&&!it.fittedMountKey));
});
test('native ownership binding retains host position authority and derived rotation',()=>{
 const item={id:'aim9m',p:[4.9,-.016,-1.426],owner:'wing_l_out',side:1,count:1,storeRotation:[0,0,Math.SQRT1_2,Math.SQRT1_2]},before=json(item);
 hardpoints.forPlane({damage:{by:{wing_l_out:{},wing_r_out:{}}},modelHardpointNativeStores:[{id:'aim9m',owner:'wing_r_out',p:[99,98,97],count:1}]},[item]);
 close(item.p,before.p);close(item.storeRotation,before.storeRotation);assert.equal(item.owner,'wing_r_out');
});
test('store presentation rejects malformed quaternion metadata',()=>{
 for(const q of [null,[0,0,0,2],[0,0,Infinity,1],[0,0,0],['0',0,0,1]])assert.deepEqual(hardpoints.storeRotation({storeRotation:q}),[0,0,0,1]);
});
test('all three production store presentation paths retain model roll',()=>{
 assert(source.includes('n.local = quatMatrix(it.p, TFModelHardpoints.storeRotation(it));'),'Garage/controlled mounted store consumes roll');
 assert(source.includes('item.node.local = quatMatrix(item.p, TFModelHardpoints.storeRotation(item));'),'Accepted native telemetry must not reset roll');
 assert(source.includes('node.local=quatMatrix(store.p,TFModelHardpoints.storeRotation(store,plane.type));'),'Sensed public stores consume explicit visible roll');
});

test('sensed stores derive only the verified public lateral pose when q is absent',()=>{
 for(const id of ['f104g','f16v']){
  const T=bundled.AIRCRAFT_TYPES[id],weapon=id==='f104g'?'aim9b':'aim120c',items=layout.layoutStores(T,['visible',[[weapon,2,'tip']]]);
  for(const it of items){
   const sample={id:it.id,p:it.p.slice(),owner:it.owner},saved=json(sample);
   close(hardpoints.storeRotation(sample,T),it.storeRotation,1e-10);assert.deepEqual(sample,saved,'Derivation does not change host position or visible sample');
   assert.deepEqual(hardpoints.storeRotation({...sample,p:[0,0,0]},T),[0,0,0,1]);
   assert.deepEqual(hardpoints.storeRotation({...sample,id:'unknown'},T),[0,0,0,1]);
   assert.deepEqual(hardpoints.storeRotation(sample,{...T,model:{...T.model,sourceHashes:{main:'unknown'}}}),[0,0,0,1]);
  }
 }
});
test('production garage and sensed mount functions apply the rotated matrix without moving host p',()=>{
 class Node{constructor(name){this.name=name;} }
 for(const id of ['f104g','f16v']){
  const T=bundled.AIRCRAFT_TYPES[id],weapon=id==='f104g'?'aim9b':'aim120c';
  const loadout=['visible',[[weapon,2,'tip']]],items=layout.layoutStores(T,loadout),renderer={freeMesh(){},mesh:x=>x};
  const makePlane=()=>({type:T,root:{children:[],add(n){this.children.push(n);return n;}},meshes:[],storeNodes:[],pylonMeshes:[],damage:{by:{}}});
  const plane=makePlane(),context={Node,quatMatrix,TFModelHardpoints:hardpoints,TFMountedDetails:details,renderer,airLoadouts:()=>[loadout],layoutStores:()=>items,AIR_WEAPON_KINDS:new Set(['aam']),storeMesh:()=>({}),sourceStoreMesh:()=>({})};
  vm.createContext(context);vm.runInContext(declaration(source,'mountStores')+';this.mountStores=mountStores;',context);
  const mounted=context.mountStores(plane,id,0);
  for(const it of mounted.items)close(Array.from(it.node.local),Array.from(quatMatrix(it.p,it.storeRotation)),1e-8);
  const publicPlane=makePlane(),stores=items.map(it=>({id:it.id,owner:it.owner,p:it.p.slice(),mount_present:true,present:true,weapon_instance:1})),saved=json(stores);
  const publicContext={Node,quatMatrix,TFModelHardpoints:hardpoints,aircraftGeometry:{}};
  vm.createContext(publicContext);vm.runInContext(declaration(source,'mountFrontlinePublicStores')+';this.mountPublic=mountFrontlinePublicStores;',publicContext);
  const publicMounted=publicContext.mountPublic({renderer,plane:publicPlane,aircraftId:id,stores,storeMesh:()=>({}),sourceStoreMesh:()=>({})});
  for(let i=0;i<items.length;i++)close(Array.from(publicMounted.items[i].node.local),Array.from(quatMatrix(stores[i].p,items[i].storeRotation)),1e-8);
  assert.deepEqual(json(stores),saved,'Host-visible stores are unchanged by rendering');
 }
});
test('F16 inner menu selections occupy the source pylon rather than an unrelated generic station',()=>{
 const T=bundled.AIRCRAFT_TYPES.f16v,slots=layout.airSlots('f16v').filter(sl=>sl.station==='inner');
 assert.equal(slots.length,2);
 for(const sl of slots)for(const[id,n]of sl.options){
  const items=layout.layoutStores(T,['source inner',[[id,n,'inner',sl.side]]]);
  assert.equal(items.length,1,'One source longitudinal pylon/retention channel per inner station');
  const it=items[0],profile=FITTED_MOUNTS.f16v.mounts.find(p=>p.station==='inner'&&p.side===sl.side);
  assert(it.modelHardpoint.endsWith('_inner_pylon_lower_rail'),`${id} uses the original pylon`);
  assert(it.fittedMountKey);assert.equal(it.pylon,null);close(it.mount,profile.end,1e-10);
  close(it.p,layout.storeMountPosition(it.def,it.mount),1e-10);
  assert(!it.storeRotation,'A lower retention channel uses the upper weapon socket');
 }
});
