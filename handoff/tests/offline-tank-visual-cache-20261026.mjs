import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {patchOfflineOwnTankWork} from '../tools/patch_offline_own_tank_work.mjs';
import {patchOfflineFlightProfile} from '../tools/patch_offline_flight_profile.mjs';
import {loadData} from '../../client/web/tools/load-data.mjs';
import {rendererSink} from '../../client/web/tools/hit-mesh-capture.mjs';

const helper=fs.readFileSync(new URL('../tools/offline_tank_visual_cache.js',import.meta.url),'utf8');
function cache(){const c={};vm.runInNewContext(helper,c);return c.TFOfflineTankVisualCache;}
function dyn(offset=0){return{lod:0,lifts:{1:new Float64Array([0,.01]),[-1]:[0,0]},travel:{1:0,[-1]:0},slack:{1:1,[-1]:1},ground:{1:z=>z*.01+offset,[-1]:z=>z*.02+offset},wheels:null,openBelts:null};}
function model(){return{calls:0,ground:[],updateRunningGear(d){this.calls++;this.ground=[d.ground[1](0),d.ground[1](2),d.ground[-1](-1)];return this.calls;}};}
test('exact cache compares mutable numeric contents and sampled terrain heights',()=>{
  const c=cache(),m=model();c.update(m,dyn(),true);c.update(m,dyn(),true);assert.equal(m.calls,1);
  c.update(m,dyn(.2),true);assert.equal(m.calls,2);assert.deepEqual(m.ground,[.2,.02+.2,-.02+.2]);
  const d=dyn(.2);d.lifts[1][0]=.15;c.update(m,d,true);assert.equal(m.calls,3);c.update(m,d,true);assert.equal(m.calls,3);
  d.travel[-1]=.1;c.update(m,d,true);assert.equal(m.calls,4);d.lod=1;c.update(m,d,true);assert.equal(m.calls,5);
});
test('direct external updates, model replacement, non-flight and broken tracks invalidate the cache',()=>{
  const c=cache(),m=model();c.update(m,dyn(),true);m.updateRunningGear(dyn(.5));c.update(m,dyn(),true);assert.equal(m.calls,3);
  c.update(m,dyn(),false);c.update(m,dyn(),true);assert.equal(m.calls,5);
  const broken=dyn();broken.openBelts={1:{laid:true}};c.update(m,broken,true);c.update(m,broken,true);assert.equal(m.calls,7);
  c.update(m,dyn(),true);c.update(m,dyn(),true);assert.equal(m.calls,8);
  const n=model();c.update(n,dyn(),true);assert.equal(n.calls,1);
});
test('wheeled steering/spin/lift and invalid numeric inputs cannot be skipped',()=>{
  const c=cache(),m=model(),d=dyn();d.wheels=[{lift:0,spin:0,steer:0}];c.update(m,d,true);c.update(m,d,true);assert.equal(m.calls,1);
  for(const key of ['lift','spin','steer']){d.wheels[0][key]+=.2;c.update(m,d,true);}assert.equal(m.calls,4);
  d.travel[1]=NaN;c.update(m,d,true);c.update(m,d,true);assert.equal(m.calls,6);
});
test('original errors preserve identity and do not create a successful cached state',()=>{
  const c=cache(),error=new Error('same'),m={calls:0,updateRunningGear(){this.calls++;throw error;}};
  assert.throws(()=>c.update(m,dyn(),true),e=>e===error);assert.throws(()=>c.update(m,dyn(),true),e=>e===error);assert.equal(m.calls,2);
});
test('own-tank patch is idempotent, composes with profiler V2 in either order and preserves simulation blocks',()=>{
  const s=fs.readFileSync(new URL('../bundle/app.js.html',import.meta.url),'utf8'),p=patchOfflineOwnTankWork(s);
  assert.equal(patchOfflineOwnTankWork(p),p);assert.equal(patchOfflineFlightProfile(p),patchOfflineOwnTankWork(patchOfflineFlightProfile(s)));
  const extract=(text,a,b)=>text.slice(text.indexOf(a,text.indexOf('    function update(dt) {')),text.indexOf(b,text.indexOf(a,text.indexOf('    function update(dt) {'))));
  for(const [a,b] of [['      G4.acc += dt;','      const terrainId ='],['      updateShots(dt);','      const speed ='],['      if (G4.mapEntry) {','      storeLodStep();']])assert.equal(extract(p,a,b),extract(s,a,b));
  new vm.Script(p.slice(p.indexOf('<script>')+8,p.lastIndexOf('</script>')));
  assert.throws(()=>patchOfflineOwnTankWork(s.replace('        wheels: G4.veh.wheelPose(),','        wheels: G4.veh.wheelPose(),\n        unknownFuturePoseInput: G4.time,')),/One own-tank hook/,'Unknown future input shape must fail closed');
});

const app=fs.readFileSync(new URL('../bundle/app.js.html',import.meta.url),'utf8').replace(/^<script>/,''),end=app.indexOf('  // client/web/src/main.js');
let clock=0;
const context=vm.createContext({console,atob,btoa,TextEncoder,TextDecoder,performance:{now:()=>clock},Float32Array,Float64Array,Uint32Array,Uint8Array,Uint16Array,Int32Array,Int16Array,Int8Array,ArrayBuffer,DataView,Map,Set,WeakMap,WeakSet,structuredClone});
vm.runInContext(app.slice(0,end)+'globalThis.actual={buildTank,makeLoadout,generatedTurretParts,setMgModels,Renderer};})();',context);
const A=context.actual,data=loadData();A.setMgModels(JSON.parse(fs.readFileSync(new URL('../../client/web/assets/mg_models.json',import.meta.url),'utf8')));
function rig(id){const sink=rendererSink(),renderer=Object.assign(Object.create(A.Renderer.prototype),{gl:sink.gl,_live:new Set(),_texSrc:new Map(),lost:false});const loadout=A.makeLoadout(id,data.vehicles[id],data.projectiles,data.machineGuns),m=A.buildTank(renderer,loadout,A.generatedTurretParts);let calls=0;const original=m.updateRunningGear;m.updateRunningGear=function(d){calls++;return original.call(this,d);};return{m,calls:()=>calls};}
function snapshot(m){m.root.update();const hash=createHash('sha256');function walk(n){hash.update(n.name);hash.update(Buffer.from(n.world.buffer,n.world.byteOffset,n.world.byteLength));if(n.mesh?.instanced){const b=n.mesh._src.matrices;hash.update(Buffer.from(b.buffer,b.byteOffset,b.byteLength));}for(const child of n.children)walk(child);}walk(m.root);for(const side of [1,-1]){const pins=m.openTrackPins?.[side]||m.fixedPinSource?.[side]?.pins;if(pins)hash.update(Buffer.from(pins.buffer,pins.byteOffset,pins.byteLength));}return hash.digest('hex');}
for(const id of ['us_m4a3_75w','su_t72a','de_sdkfz234_2'])test(id+': real bundled builder poses/instance uploads/physical pins remain bit-identical across cache hits and invalidations',()=>{
  const base=rig(id),candidate=rig(id),c=cache();let lift=0,travel=0,lod=0,offset=0,broken=false;
  function input(){const n=base.m.stations.length;return{lod,lifts:{1:Array(n).fill(lift),[-1]:Array(n).fill(0)},travel:{1:travel,[-1]:0},slack:{1:1,[-1]:1},ground:{1:z=>.01*Math.sin(z*2)+offset,[-1]:z=>.02*Math.sin(z)+offset},wheels:base.m.wheeled?base.m.wheels.map(()=>({lift,spin:travel,steer:0})):null,openBelts:broken?{1:{laid:true,cutPin:1}}:null};}
  try{for(let i=0;i<13;i++){clock=i*80;if(i===2)lift=.1;if(i===4)travel=.2;if(i===5)lod=1;if(i===7)offset=.03;if(i===8)lod=0;if(i===9)offset=.04;if(i===11)broken=true;base.m.updateRunningGear(input());c.update(candidate.m,input(),true);assert.equal(snapshot(candidate.m),snapshot(base.m),id+' frame '+i);}assert.equal(base.calls(),13);assert.ok(candidate.calls()<base.calls(),id+' actually skipped redundant builds');}finally{base.m.dispose();candidate.m.dispose();}
});
