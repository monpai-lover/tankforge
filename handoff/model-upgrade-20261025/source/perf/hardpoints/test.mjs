import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {createLayout,declaration} from './actual-layout-fixture.mjs';
import {F15_WING_RAILS, F4_WING_RAILS, rebind, matchesF15, matchesF4, matchesMeasuredLaunchers, measuredProfile, forPlane, wrapNativeFactory} from './helper.mjs';
process.env.TF_LIVE_APP = fileURLToPath(new URL('../site-live-current-app.html', import.meta.url));
const {bundled} = await import('../../work/tankforge-live-flight-patch/source/handoff/tests/fixtures/live-aircraft.mjs');
const fixture = JSON.parse(fs.readFileSync(new URL('../all-interior/current-catalog-fixture.json', import.meta.url)));
await bundled.decodeAircraftModels(fixture.models);
const source = fs.readFileSync(new URL('../site-live-current-app.html', import.meta.url),'utf8');
const candidate = fs.readFileSync(process.env.TF_HARDPOINT_APP || new URL('./current-app-fixed.html', import.meta.url),'utf8');
const before = createLayout(source,bundled.AIRCRAFT_TYPES), after = createLayout(candidate,bundled.AIRCRAFT_TYPES);
const mountedV3=candidate.includes('TF_MOUNTED_DETAILS_BEGIN');
const json = x => JSON.parse(JSON.stringify(x));
const stable = items => json(items.map(it=>({id:it.id,station:it.station,side:it.side,owner:it.owner,count:it.count,def:it.def})));
const mass = items => items.reduce((m,it)=>m+(it.def.mass||0),0);
const drag = items => items.reduce((m,it)=>m+0.8*Math.PI*(it.def.d/2)**2+0.02,0);
let presets = 0, moved = 0;
const result = [];
for (const [id,T] of Object.entries(bundled.AIRCRAFT_TYPES)) {
  for (const [index,lo] of (before.AIR_LOADOUTS[id]||[]).entries()) {
    const a = before.layoutStores(T,lo), b = after.layoutStores(T,lo);
    const expected=stable(a);
    if(id==='su27')for(const it of expected)if(it.station==='inner')it.owner='body';
    if(id==='mig21'||id==='f16v')for(let i=0;i<expected.length;i++)if(b[i].modelOwnerBinding==='source_wing_group'){
      const m=measuredProfile(T).bindings.find(q=>q.side===b[i].side);expected[i].owner=m.owner+(expected[i].owner.endsWith('_out')?'_out':'');
    }
    assert.deepEqual(stable(b),expected,`${id}/${index} item IDs/order/count/weapon definitions; Su27 underengine carrier deliberately body`);
    assert.equal(mass(b),mass(a),`${id}/${index} mass`);
    assert.equal(drag(b),drag(a),`${id}/${index} drag`);
    if (!mountedV3&&!['f15c','f4e','a10a','su25','f104g','mig21','f16v','su27'].includes(id)) assert.deepEqual(json(b),json(a),`${id}/${index} other aircraft unchanged`);
    const changes = b.map((it,i)=>it.p.some((v,k)=>v!==a[i].p[k]) ? i : null).filter(v=>v!==null);
    if(mountedV3)for(const it of b){assert(it.p.every(Number.isFinite));if(it.mount&&!it.rack){const expected=after.storeMountPosition(it.def,it.mount);assert(it.p.every((v,k)=>Math.abs(v-expected[k])<1e-9),'Actual model socket meets fitted mount');}}
    if (!mountedV3&&(id === 'f15c'||id==='f4e')) {
      const rails = b.filter(it=>it.modelHardpoint);
      assert.equal(new Set(rails.map(it=>it.modelHardpoint)).size,rails.length,`${id}/${index} unique rail per missile`);
      for (const it of rails) {
        const rail = (id==='f15c'?F15_WING_RAILS:F4_WING_RAILS).find(r=>it.modelHardpoint.endsWith(r.key));
        assert.deepEqual(json(it.mount),[it.side*rail.x,rail.y,rail.z]);
        assert.deepEqual(json(it.p),json(after.storeMountPosition(it.def,it.mount)));
        assert.equal(it.pylon,null,'No duplicated procedural pylon at model rail');
      }
      for (let i=0;i<b.length;i++) if(!b[i].modelHardpoint&&!b[i].modelBellyBinding&&!b[i].modelWingCarrier) assert.deepEqual(json(b[i]),json(a[i]),'Unrelated bomb positions unchanged');
    }
    if (!mountedV3&&['a10a','su25'].includes(id)) {
      const sockets=JSON.parse(fs.readFileSync(new URL('./store-sockets.json',import.meta.url)));
      const transforms=q=>[-q[0],q[1],q[2]];
      const rackCounts=new Map();
      for (let i=0;i<b.length;i++) {
        const it=b[i],prev=a[i];
        if (!it.rack) {assert.deepEqual(json(it),json(prev),'Non-launcher positions unchanged');continue;}
        const sa=transforms(sockets[it.rack.id].sockets.socket_aircraft);
        const sm=transforms(sockets[it.def.model].sockets.socket_mount);
        const ss=transforms(sockets[it.rack.id].sockets[`socket_store_${it.rack.k}`]);
        const top=it.rack.origin.map((v,k)=>v+sa[k]);
        const point=T.fighter.spec.pylonPoints[it.pylonN];
        for(let k=0;k<3;k++)assert(Math.abs(top[k]-(point[k]-(k===1?.03:0)))<1e-9,'Rack aircraft socket meets measured station + fixed adapter spacer');
        for(let k=0;k<3;k++)assert(Math.abs(it.p[k]+sm[k]-(it.rack.origin[k]+ss[k]))<1e-9,'Weapon mount exactly meets numbered launcher socket');
        assert(Math.abs(it.p[2]-(prev.p[2]-it.def.len*.08))<1e-9,'Only obsolete length-dependent longitudinal shift removed');
        assert.equal(it.p[0],prev.p[0]);assert.equal(it.p[1],prev.p[1]);
        if(it.pylon)for(let k=0;k<3;k++)assert(Math.abs(it.pylon[1][k]-top[k])<1e-9,'Procedural connector meets launcher aircraft socket');
        const key=it.pylonN+':'+it.rack.id;let c=rackCounts.get(key)||0;if(it.pylon)c++;rackCounts.set(key,c);
      }
      for(const n of rackCounts.values())assert.equal(n,1,'One connector per shared launcher, not per missile');
    }
    if(!mountedV3&&['f15c','f4e'].includes(id))for(const side of[-1,1]){
      const group=b.filter(it=>it.modelBellyBinding&&it.side===side).sort((x,y)=>y.p[2]-x.p[2]);
      if(group.length===2){
        assert(group[0].p[2]-group[1].p[2]>=(group[0].def.len+group[1].def.len)/2+.1499999,'Tandem missile bodies no longer overlap');
        for(const it of group){assert.equal(it.modelMountBasis,'inferred_clearance_with_exact_exterior_contact');assert(Math.abs(it.pylon[0][1]-it.mount[1]-.12)<1e-9,'Short procedural adapter starts at exact source exterior');}
      }
    }
    if(!mountedV3&&measuredProfile(T)){
      for(let i=0;i<b.length;i++){
        const it=b[i];if(it.modelMountBasis!=='source_component_lower_face_center'){const expected=json(a[i]);if(it.modelOwnerBinding){expected.owner=it.owner;expected.modelOwnerBinding=it.modelOwnerBinding;}assert.deepEqual(json(it),expected,'Unverified station geometry unchanged; source carrier identity corrected');continue;}
        const binding=measuredProfile(T).bindings.find(q=>it.modelHardpoint.endsWith(q.key)&&q.point.every((v,k)=>v===it.mount[k]));
        assert(binding,'Bound station points to exact measured component');
        assert.equal(it.pylon,null,'Source hardware replaces duplicate procedural pylon');
        assert.deepEqual(json(it.p),json(after.storeMountPosition(it.def,it.mount)),'Store socket meets source component attachment');
        if(id==='su27'&&it.station==='inner')assert.equal(it.owner,'body');else if(id==='mig21'||id==='f16v')assert.equal(it.owner,binding.owner+(a[i].owner.endsWith('_out')?'_out':''));else assert.equal(it.owner,a[i].owner);
      }
      assert.equal(new Set(b.filter(it=>it.modelHardpoint).map(it=>it.modelHardpoint)).size,b.filter(it=>it.modelHardpoint).length,'No source station occupied twice');
    }
    presets++; moved+=changes.length; result.push({id,index:index+1,count:b.length,changedPositions:changes.length});
  }
}
// Execute the host's actual visibility projection against corrected carriers.
const suStores=after.layoutStores(bundled.AIRCRAFT_TYPES.su27,after.AIR_LOADOUTS.su27[0]);
for(const it of suStores){it.node={visible:true};it.pylonNode={visible:true};}
const visibilityScope={mounted:{items:suStores},plane:{damage:{dead:id=>/^wing_l/.test(id),gone:id=>/^wing_l/.test(id)}}};
vm.createContext(visibilityScope);vm.runInContext(declaration(source,'projectStores')+';projectStores();',visibilityScope);
assert(suStores.filter(it=>it.station==='inner').every(it=>it.node.visible),'Underengine stores stay mounted after left wing detaches');
assert(suStores.filter(it=>it.station!=='inner'&&/^wing_l/.test(it.owner)).every(it=>!it.node.visible),'Left wing stores detach with their carrier');
assert(suStores.filter(it=>/^wing_r/.test(it.owner)).every(it=>it.node.visible),'Right wing remains independent');
for(const typeId of['mig21','f16v']){
 const type=bundled.AIRCRAFT_TYPES[typeId],stores=after.layoutStores(type,after.AIR_LOADOUTS[typeId][0]),g=type.geometry();
 const signMean=data=>{let n=0,sum=0;for(let o=0;o<data.length;o+=13){sum+=data[o];n++;}return Math.sign(sum/n);};
 assert.equal(signMean(g.wings.l),1,'Actual imported left-group wing lies on positive X in these source packages');
 assert.equal(signMean(g.wings.r),-1,'Actual imported right-group wing lies on negative X');
 for(const it of stores)it.node={visible:true};
 const ctx={mounted:{items:stores},plane:{damage:{dead:id=>/^wing_l/.test(id),gone:()=>false}}};vm.createContext(ctx);vm.runInContext(declaration(source,'projectStores')+';projectStores();',ctx);
 assert(stores.filter(it=>it.side===1).every(it=>!it.node.visible),'Detached positive-X source wing removes its actual physical stores');
 assert(stores.filter(it=>it.side===-1).every(it=>it.node.visible),'Opposite source wing stores stay mounted');
}
// Native ownership is accepted from the host before mount; position/count/id
// validation and projection in original accept are untouched.
{
 const sample=[{id:'r27r',owner:'body',count:1,p:[1,2,3]}],before=json(sample);
 const oldHost=[{id:'r27r',owner:'wing_l',count:1,p:[4,5,6]}],plane={damage:{by:{wing_l:{},wing_r:{}}},modelHardpointNativeStores:oldHost};
 forPlane(plane,sample);assert.equal(sample[0].owner,'wing_l');assert.deepEqual(sample[0].p,before[0].p,'Native helper does not override position');assert.equal(sample[0].count,1);
 for(const bad of[[{...oldHost[0],owner:'new_unknown_part'}],[{...oldHost[0],id:'other'}],[{...oldHost[0],count:2}],[...oldHost,...oldHost]]){
  const fresh=[{...before[0],p:before[0].p.slice()}];forPlane({...plane,modelHardpointNativeStores:bad},fresh);assert.deepEqual(json(fresh),before,'Unknown host schema is left for original validation; no invented owner/count');
 }
 const factory=(r,id,callbacks)=>({plane:{damage:plane.damage},accept(unit){const items=[{...before[0],p:before[0].p.slice()}];const result=callbacks.mountStores(this.plane,items);assert.equal(result[0].owner,unit.stores[0].owner);return result;}});
 const wrapped=wrapNativeFactory(factory),view=wrapped(null,'su27',{mountStores:(p,items)=>forPlane(p,items)});
 assert.equal(view.accept({stores:oldHost})[0].owner,'wing_l');assert.equal(view.accept({stores:[{...oldHost[0],owner:'body'}]})[0].owner,'body');assert.equal(wrapNativeFactory(wrapped),wrapped);
}
const T=bundled.AIRCRAFT_TYPES.f15c;
assert(matchesF15(T),'Current exact F15 source guard');
assert(!matchesF15({...T,model:{...T.model,sourceHashes:{main:'other'}}}),'Unknown model source not rebound');
const aa=after.layoutStores(T,after.AIR_LOADOUTS.f15c[0]);
assert.equal(aa.filter(it=>it.modelHardpoint?.includes('wing_rail')).length,4,'Four missiles use four authored wing rails');
const mixed=after.layoutStores(T,after.AIR_LOADOUTS.f15c[4]);
assert(mixed.filter(it=>it.id==='aim120c').every(it=>it.modelHardpoint.endsWith('inner')));
assert(mixed.filter(it=>it.id==='aim9m').every(it=>it.modelHardpoint.endsWith('outer')));
const slots=after.airSlots('f15c');
assert(after.slotsClash(slots.find(s=>s.station==='mid'&&s.side===-1),slots.find(s=>s.station==='outer'&&s.side===-1)),'Mid/outer aliases compete for the same real pair of rails');
assert(!after.slotsClash(slots.find(s=>s.station==='mid'&&s.side===-1),slots.find(s=>s.station==='outer'&&s.side===1)),'Opposite wings independent');
assert(!after.slotsClash(slots.find(s=>s.station==='mid'&&s.side===-1),slots.find(s=>s.station==='outer'&&s.side===-1),'aim120c','aim9m',1,1),'One AMRAAM plus one Sidewinder occupy different tracks');
assert(after.slotsClash(slots.find(s=>s.station==='mid'&&s.side===-1),slots.find(s=>s.station==='outer'&&s.side===-1),'aim9l','aim9m'),'Two Sidewinders plus one cannot use two tracks');
after.G4.airCustom.f15c={'mid:-1':'aim9l','outer:-1':'aim9m','mid:1':'aim9l','outer:1':'aim9m'};
const saved=after.customLoadout('f15c')[1];
for(const side of [-1,1]) assert(saved.filter(e=>e[3]===side&&['mid','outer'].includes(e[2])).reduce((n,e)=>n+e[1],0)<=2,'Old saved custom cannot overfill model rails');
const invalid=Array.from({length:3},()=>({...aa.find(it=>it.side===-1&&it.modelHardpoint),p:[1,2,3]}));
const unchanged=json(invalid);rebind(T,invalid,{storeMountPosition:after.storeMountPosition});assert.deepEqual(json(invalid),unchanged,'Unknown over-capacity layout fails open');
const evidence={ok:true,aircraft:Object.keys(bundled.AIRCRAFT_TYPES).length,presets,movedPositions:moved,presetIdsOrderCountsMassDragUnchanged:true,su27UnderengineOwnerCorrectedToBody:true,mig21F16SourceWingOwnershipCorrected:true,unrelatedOwnersUnchanged:true,nonJetLayoutsUnchanged:result.filter(r=>bundled.AIRCRAFT_TYPES[r.id].sound!=="jet").every(r=>r.changedPositions===0),measuredNumberedLaunchersAligned:true,sharedPylonConnectorsDeduplicated:true,existingInnerStoresReboundToSourcePylon:true,bellyTandemOverlapResolved:true,customWingRailCapacity:4,nativeFrontline:'Host p/count/id/owner remain authoritative; this client module does not update backend positions or capacities.',rows:result};
fs.writeFileSync(new URL('./test-results.json',import.meta.url),JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify({...evidence,rows:undefined}));
