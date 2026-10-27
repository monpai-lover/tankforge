import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import * as details from './details.mjs';
import {createLayout,declaration} from '../hardpoints/actual-layout-fixture.mjs';
import {REVIEW_CASES,EXTRA_OPTIONS} from './catalog.mjs';
import {buildProjection} from '../damage-schematic/helper.mjs';
import {createAircraftHitbox} from '../../work/tankforge-live-flight-patch/source/handoff/flight-rust/aircraft-hitbox.mjs';
process.env.TF_LIVE_APP ||= new URL('./app-fixed.html',import.meta.url).pathname;
const{bundled,makeAircraft}=await import('../../work/tankforge-live-flight-patch/source/handoff/tests/fixtures/live-aircraft.mjs');
const fixture=JSON.parse(fs.readFileSync(new URL('../all-interior/current-catalog-fixture.json',import.meta.url)));
await bundled.decodeAircraftModels(fixture.models);
const source=fs.readFileSync(process.env.TF_LIVE_APP,'utf8'),layout=createLayout(source,bundled.AIRCRAFT_TYPES);
const hash=a=>createHash('sha256').update(new Uint8Array(a.buffer,a.byteOffset,a.byteLength)).digest('hex');
const type=bundled.AIRCRAFT_TYPES.su27;
const report={tests:[],source:'Actual compiled Aircraft geometry + actual mounted layout functions',aircraft:26,presets:0};

test('Su27 source-wing rails are continuous with the actual wing and belong to its exact physical mesh',()=>{
 const {plane}=makeAircraft('su27'),g=plane.type.geometry();assert.equal(g.mountDetailsVersion,details.VERSION);assert.equal(g.mountHardware.length,2);
 const oldModule=details.airframe('unknown',type.model,{wings:{l:new Float32Array(),r:new Float32Array()}});assert.equal(oldModule.mountDetailsVersion,undefined);
 for(const side of[-1,1]){
  const t=details.tipLayout(side),data=g.wings[side<0?'l':'r'],added=data.slice(-g.mountHardware.find(q=>q.side===side).vertices*13);
  assert.ok(added.every(Number.isFinite));assert.ok(added.length<16000);
  // New rail closes the former 0.24m span gap and reaches the missile's mounting plane.
  const close=[];for(let i=0;i<added.length;i+=13)if(Math.abs(added[i]-t.wingEdge)<.04&&Math.abs(added[i+2]+2.6)<.8)close.push(added.slice(i,i+3));
  assert.ok(close.length>0);assert.ok(close.some(p=>p[1]<=-.03&&p[1]>=-.13));
  const at=[];for(let i=0;i<added.length;i+=13)if(Math.abs(added[i+1]-t.y)<1e-6)at.push(added.slice(i,i+3));assert.ok(at.length>0);
  let hasRailContact=false;for(let i=0;i<plane.hitbox.tris.length;i+=3)if(Math.abs(plane.hitbox.tris[i]-t.x)<.1&&Math.abs(plane.hitbox.tris[i+1]-t.y)<1e-6&&Math.abs(plane.hitbox.tris[i+2]+2.65)<.9)hasRailContact=true;
  assert.ok(hasRailContact,'Visible permanent rail must exist in the same triangle hitbox');
 }
 const before=hash(plane.hitbox.tris);plane.setXray(true);plane.pose(1);plane.setXray(false);plane.pose(1);assert.equal(hash(plane.hitbox.tris),before);
});

test('Su27 ten missiles use ten separate real mounts, correct shared-model sockets, and no phantom tip location',()=>{
 const items=layout.layoutStores(type,layout.AIR_LOADOUTS.su27[0]);assert.equal(items.length,10);assert.equal(new Set(items.map(it=>it.modelHardpoint)).size,10);
 for(const it of items){
  assert.deepEqual(it.p,layout.storeMountPosition(it.def,it.mount));
  if(it.station==='tip'){
   const t=details.tipLayout(it.side);assert.deepEqual(it.mount,[t.x,t.y,t.z]);assert.equal(it.p[2],t.z);assert.ok(it.p[1]<-.25);assert.equal(it.pylon,null);
   assert.equal(it.owner,it.side<0?'wing_l_out':'wing_r_out');
  }
 }
 for(const id of ['r73','r27r','r27t']){const d=layout.AIR_STORE_DEFS[id],before=JSON.stringify(d);assert.equal(details.modelId(d),details.VISUAL_ALIASES[id]);assert.equal(JSON.stringify(d),before);}
});

test('all 67 presets keep original IDs, counts, ammunition, mass and drag definitions',()=>{
 const old=fs.readFileSync(new URL('../site-live-current-app.html',import.meta.url),'utf8'),base=createLayout(old,bundled.AIRCRAFT_TYPES);
 for(const[id,T]of Object.entries(bundled.AIRCRAFT_TYPES))for(const lo of base.AIR_LOADOUTS[id]||[]){
  const a=base.layoutStores(T,lo),b=layout.layoutStores(T,lo);assert.equal(a.length,b.length);
  for(let i=0;i<a.length;i++){assert.equal(a[i].id,b[i].id);assert.equal(a[i].count,b[i].count);assert.equal(JSON.stringify(a[i].def),JSON.stringify(b[i].def));}
  report.presets++;
 }
 assert.equal(report.presets,67);
});

test('fitted adapters use per-plane membership in both actual triangle hitbox paths; unused alternatives are absent',()=>{
 const {plane:a}=makeAircraft('f4e'),{plane:b}=makeAircraft('f4e'),g=a.type.geometry(),descriptors=g.mountFitAdded;
 assert.ok(descriptors.length>2);assert.notEqual(a.hitbox,b.hitbox);assert.equal(a.hitbox.tris,b.hitbox.tris);assert.equal(a.hitbox.parts,a.type._hitbox.parts);
 assert.deepEqual(Array.from(a.hitbox.tris.subarray(0,a.type._hitbox.tris.length)),Array.from(a.type._hitbox.tris));
 const first=descriptors[0],second=descriptors.find(p=>p.key!==first.key),triangle=first.data.subarray(0,39),p=[0,1,2].map(k=>(triangle[k]+triangle[13+k]+triangle[26+k])/3),n=Array.from(triangle.subarray(3,6)),x=p.map((v,k)=>v-n[k]*.02),y=p.map((v,k)=>v+n[k]*.02);
 const contacts=P=>bundled.airHitboxQuery(P.hitbox,x,y,P.damage.alive()).filter(c=>P.hitbox.pieces[P.hitbox.piece[c.tri]].mountKey===first.key);
 assert.equal(contacts(a).length,0);details.attach(a,[{fittedMountKey:first.key}]);assert.ok(contacts(a).length>0);assert.equal(contacts(b).length,0);
 const optional=createAircraftHitbox(a,{outer:[],damagePolicy:'live212'});assert.ok(optional.trace(x,y).contacts.some(c=>c.damageId===a.mountFitNodes[0].mountOwner));
 const projection=buildProjection(a,160);a.setXray(true);a.pose(1);assert.ok(a.mountFitNodes.filter(n=>n.visible).every(n=>n.kind===6&&!n.hitboxDisabled));assert.ok(contacts(a).length>0);
 details.attach(a,[{fittedMountKey:second.key}]);assert.equal(contacts(a).length,0);assert.notEqual(buildProjection(a,160).mountRevision,projection.mountRevision);
 details.attach(a,[{fittedMountKey:first.key}]);a.damage._detach(a.damage.by[a.mountFitNodes[0].mountOwner]);a.applyDamage();a.pose(1);assert.equal(contacts(a).length,0);assert.equal(a.mountFitNodes[0].visible,false);assert.equal(optional.trace(x,y).contacts.length,0);
});

test('catalog choices are independent of preset enumeration and every new review combination mounts completely',()=>{
 const enabled=[];
 for(const[id,extras]of Object.entries(EXTRA_OPTIONS)){
  const T=bundled.AIRCRAFT_TYPES[id],slots=layout.airSlots(id);
  for(const[station,options]of Object.entries(extras))for(const[weapon,n]of Object.entries(options)){
   const sl=slots.find(s=>s.station===station);assert.ok(sl?.options.get(weapon)>=n,id+' '+weapon);
   const items=layout.layoutStores(T,['catalog',[[weapon,n,station,sl.side]]]);assert.equal(items.length,n,id+' '+station+' '+weapon);enabled.push([id,station,weapon,n]);
  }
 }
 for(const[id,cases]of Object.entries(REVIEW_CASES))for(const lo of cases){const items=layout.layoutStores(bundled.AIRCRAFT_TYPES[id],lo);assert.equal(items.length,lo[1].reduce((n,e)=>n+e[1],0),id+' '+lo[0]);assert.ok(items.every(it=>it.p.every(Number.isFinite)));}
 const slots=layout.airSlots('a10a');for(const n of[2,10]){const s=slots.find(s=>s.key==='p'+n);assert.equal(s.options.get('sniper'),1);assert.equal(s.options.get('litening'),1);}for(const n of[4,8])assert.equal(slots.find(s=>s.key==='p'+n).options.get('gbu10'),1);
 report.catalogAdditions=enabled;
});

test('one plus one and dual rail counts are selectable without silently overfilling the original F15 pylon',()=>{
 const G=layout.G4;G.airCustom.f15c={'mid:-1':'aim120c','outer:-1':'aim9m'};G.airCustomCounts={};G.airArmMirror=false;
 let entries=layout.customLoadout('f15c')[1];assert.equal(entries.find(e=>e[2]==='mid')[1],1,'A saved single AMRAAM remains single after catalog expansion');
 const slots=layout.airSlots('f15c');details.countPick(G,slots,'f15c','mid:-1',2,layout.slotsClash);assert.equal(G.airCustom.f15c['outer:-1'],undefined);entries=layout.customLoadout('f15c')[1];assert.equal(entries.find(e=>e[2]==='mid')[1],2);assert.equal(layout.layoutStores(bundled.AIRCRAFT_TYPES.f15c,['custom',entries]).length,2);
 details.countPick(G,slots,'f15c','mid:-1',1,layout.slotsClash);G.airCustom.f15c['outer:-1']='aim9m';assert.equal(layout.customLoadout('f15c')[1].reduce((n,e)=>n+e[1],0),2);
});

test('actual targeting-pod function exposes the fitted designator and removes its capability after release',()=>{
 const context={TFMountedDetails:details,norm:v=>v,worldDir:(p,v)=>v,airCtl:air=>air.ctl};vm.createContext(context);
 const actual=vm.runInContext('(()=>{'+declaration(source,'AIR_EQUIP','const')+declaration(source,'AIR_PODS','const')+declaration(source,'airPod')+';return {AIR_EQUIP,airPod};})()',context);
 const f15={ctl:{eq:actual.AIR_EQUIP.f15c},plane:{}};assert.equal(actual.airPod(f15).cfg.laser,true);assert.match(actual.airPod(f15).cfg.name,/LANTIRN/);
 for(const[type,id]of[['f16v','sniper'],['a10a','sniper'],['a10a','litening']]){const it={def:layout.AIR_STORE_DEFS[id],p:[.7,-1,2.8]},air={plane:{},ctl:{eq:actual.AIR_EQUIP[type]},stores:{items:[it]}};assert.equal(actual.airPod(air).cfg.laser,true);assert.equal(actual.airPod(air).mount,it.p);it.gone=true;assert.equal(actual.airPod(air),null);}
 assert.equal(details.catalogEntries([['sniper',1,'p2'],['litening',1,'p10']]).length,1);
});

for(const id of['gbu10','gbu12'])test(id+': precision bomb has actual seeker and control/tail surfaces',()=>{const d=layout.AIR_STORE_DEFS[id],v=details.store(d,0);assert.ok(v&&v.every(Number.isFinite));assert.ok(details.storeEvidence(d).features.includes('laser_seeker'));});

for(const[id,d]of Object.entries(layout.AIR_STORE_DEFS))if(['tank','gunpod','pod','ecm','sensorpod'].includes(d.kind)&&id!=='r4mrack')test(id+': specialized closed finite geometry, distinct from the missile fallback at both LODs',()=>{
 const frozen=JSON.stringify(d),near=details.store(d,0),far=details.store(d,1);assert.ok(near&&far);assert.equal(JSON.stringify(d),frozen);
 for(const data of[near,far]){assert.equal(data.length%39,0);assert.ok(data.every(Number.isFinite));assert.ok(data.length/39<4000);for(let i=0;i<data.length;i+=13)assert.ok(Math.abs(data[i+2])<=d.len*.51);}
 assert.ok(far.length<near.length);
 const evidence=details.storeEvidence(d);if(d.kind==='pod')assert.ok(evidence.features.includes('open_rocket_tubes:'+d.count));
 if(d.kind==='gunpod')assert.ok(evidence.features.includes('twin_barrels'));
 if(d.kind==='tank'){assert.ok(evidence.features.includes('closed_fuel_body'));for(let i=0;i<near.length;i+=13)assert.ok(Math.abs(near[i])<d.d*.8,'Fuel tank must not inherit the old 3-diameter missile cross');}
 report.tests.push({id,nearTriangles:near.length/39,farTriangles:far.length/39,features:evidence.features});
});
test.after(()=>fs.writeFileSync(new URL('./details-test-report.json',import.meta.url),JSON.stringify(report,null,2)+'\n'));
