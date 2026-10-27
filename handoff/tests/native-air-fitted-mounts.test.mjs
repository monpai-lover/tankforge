import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const app=fs.readFileSync(new URL('../bundle/app.js.html',import.meta.url),'utf8');
const visual=fs.readFileSync(new URL('../tools/frontline_aircraft_visual.js',import.meta.url),'utf8');
const contact=fs.readFileSync(new URL('../tools/frontline_contact_visual.js',import.meta.url),'utf8');

function fixture(){
  const a=app.indexOf('/* TF_MOUNTED_DETAILS_BEGIN */'),b=app.indexOf('/* TF_MOUNTED_DETAILS_END */',a);
  assert.ok(a>=0&&b>a,'production fitted mount implementation is installed');
  class Node { constructor(name){this.name=name;this.children=[];} add(n){this.children.push(n);return n;} }
  const context=vm.createContext({Node,quatMatrix:p=>[...p]});
  const hardpointStart=app.indexOf('/* TF_MODEL_HARDPOINTS_BEGIN */'),hardpointEnd=app.indexOf('/* TF_MODEL_HARDPOINTS_END */',hardpointStart);
  assert.ok(hardpointStart>=0&&hardpointEnd>hardpointStart,'production model hardpoints implementation is installed');
  vm.runInContext(app.slice(a,b)+app.slice(hardpointStart,hardpointEnd)+contact+visual,context);
  const detached=new Set(),plane={root:new Node('aircraft'),meshes:[],storeNodes:[],pylonMeshes:[],type:{geometry:()=>({imported:{sourceStores:[],sourceMounts:[]}})},
    hitbox:{mountActive:new Set(),mountRevision:0,pieces:[{mountKey:'left_adapter'},{mountKey:'right_adapter'}]},
    damage:{revision:0,_alive:[],gone:owner=>detached.has(owner)},
    mountFitNodes:[{mountKey:'left_adapter',mountOwner:'wing_l'},{mountKey:'right_adapter',mountOwner:'wing_r'}]};
  return {context,plane,detached};
}

test('accepted fitted keys activate exact installed adapters without changing host stores',()=>{
  const {context,plane}=fixture();
  const stores=[{id:'aim9b',owner:'wing_l',p:[-2.345,-.69,.45],count:1,gone:false,fuel:0,fittedMountKey:'left_adapter'}];
  const before=JSON.stringify(stores);
  context.syncFrontlineFittedMounts(plane,stores);
  assert.equal(JSON.stringify(stores),before);
  assert.deepEqual([...plane.hitbox.mountActive],['left_adapter']);
  assert.equal(plane.mountFitNodes[0].visible,true);
  assert.equal(plane.mountFitNodes[1].visible,false);
  assert.deepEqual(Array.from(context.TFMountedDetails.maskAlive(plane.hitbox,new Uint8Array([1,1]))),[1,0]);
  const revision=plane.hitbox.mountRevision;
  context.syncFrontlineFittedMounts(plane,stores);
  assert.equal(plane.hitbox.mountRevision,revision,'identical accepted keys retain the cached mask');
});

test('release retains hardware, carrier detachment hides it, and explicit public absence removes it',()=>{
  const {context,plane,detached}=fixture();
  const released={id:'aim9b',owner:'wing_l',p:[-2,-.5,1],count:0,gone:true,fittedMountKey:'left_adapter'};
  context.syncFrontlineFittedMounts(plane,[released]);
  assert.equal(plane.mountFitNodes[0].visible,true,'a released weapon leaves its fitted carrier');
  detached.add('wing_l');context.TFMountedDetails.show(plane);
  assert.equal(plane.mountFitNodes[0].visible,false);
  detached.clear();context.syncFrontlineFittedMounts(plane,[{...released,mount_present:false}]);
  assert.equal(plane.hitbox.mountActive.size,0);
  assert.equal(plane.mountFitNodes[0].visible,false);
  context.syncFrontlineFittedMounts(plane,[]);
  assert.equal(plane.hitbox.mountActive.size,0);
});

test('native accepted mounting keeps host positions and owners while passing fitted metadata',()=>{
  const {context,plane}=fixture();
  const stores=[{id:'aim9b',owner:'wing_r',p:[-7.125,-.2,2.5],count:1,gone:false,fittedMountKey:'right_adapter'}];
  const before=JSON.stringify(stores),renderer={mesh:data=>({data}),freeMesh(){}};
  const result=context.mountFrontlineAcceptedStores({renderer,plane,aircraftId:'f86f',stores,storeMesh:id=>({id}),sourceStoreMesh(){throw Error('unexpected source fallback');},storeDefs:{aim9b:{len:2.83,d:.127}}});
  assert.equal(JSON.stringify(stores),before);
  assert.equal(result.items[0].owner,stores[0].owner,'accepted owner wins over side and position');
  assert.deepEqual(Array.from(result.items[0].p),stores[0].p);
  assert.notEqual(result.items[0].p,stores[0].p);
  assert.deepEqual(Array.from(result.items[0].node.local),stores[0].p);
  assert.equal(result.items[0].fittedMountKey,'right_adapter');
  assert.deepEqual([...plane.hitbox.mountActive],['right_adapter']);
});

test('old hosts without fitted keys do not infer hardware from local presets',()=>{
  const {context,plane}=fixture();
  context.syncFrontlineFittedMounts(plane,[{id:'aim9b',owner:'wing_l',p:[-2,0,0],count:1}]);
  assert.equal(plane.hitbox.mountActive.size,0);
  assert.ok(plane.mountFitNodes.every(n=>!n.visible));
});
