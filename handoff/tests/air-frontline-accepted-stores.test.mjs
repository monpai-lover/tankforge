import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
const source=fs.readFileSync(new URL('../bundle/app.js.html',import.meta.url),'utf8');
const visual=fs.readFileSync(new URL('../tools/frontline_aircraft_visual.js',import.meta.url),'utf8');
const contact=fs.readFileSync(new URL('../tools/frontline_contact_visual.js',import.meta.url),'utf8');
function fixture(){const context=vm.createContext({performance,atob}),a=source.indexOf('  // the C flight core'),b=source.indexOf('  // client/web/src/main.js',a);vm.runInContext(source.slice(source.indexOf('  function m4()'),source.indexOf('  // client/web/src/game/relief.js'))+source.slice(source.lastIndexOf('\n',a)+1,b)+visual,context);let uploaded=0;const renderer={mesh(data){uploaded++;return{count:data.length/13,_src:{data}}},freeMesh(){}};return {context,renderer};}
function sample(model,id,stores,custom){const state=Array(80).fill(0),aero=Array(48).fill(0);state[6]=1;return {unit:{battle:1,unit:id,life:1},aircraft:'f86f',state,aero,damage:{parts:model.plane.damage.parts.map(p=>[p.max,0]),fire:false,broken:false},custom,loadout:0,stores,resource_revision:1};}
test('two same-type native aircraft use their own accepted custom stores and remount only structural/service changes',()=>{
 const f=fixture(),calls=[],callback=(plane,id,stores)=>{calls.push(stores.map(s=>s.id));return{items:stores.map(s=>({...s,p:s.p.slice()}))};};
 const a=f.context.createFrontlineAircraftVisual(f.renderer,'f86f',{mountAcceptedStores:callback}),b=f.context.createFrontlineAircraftVisual(f.renderer,'f86f',{mountAcceptedStores:callback});
 const sa=[{id:'anm64',owner:'wing_l',p:[-1,0,0],count:1,gone:false}],sb=[{id:'tank_f86',owner:'wing_r',p:[1,0,0],count:1,gone:false}];
 const ua=sample(a,1,sa,{'inner:-1':'anm64'}),ub=sample(b,2,sb,{'inner:1':'tank_f86'}),before=JSON.stringify([ua,ub]);
 a.accept(ua,1);b.accept(ub,1);assert.equal(a.stores.items[0].id,'anm64');assert.equal(b.stores.items[0].id,'tank_f86');assert.equal(JSON.stringify([ua,ub]),before);assert.equal(calls.length,2);
 a.accept({...ua,stores:sa.map(s=>({...s,count:0,gone:true})),resource_revision:2},2);assert.equal(calls.length,2);assert.equal(a.stores.items[0].gone,true);
 a.accept({...ua,custom:{'inner:-1':'tank_f86'},stores:sb,resource_revision:3},3);assert.equal(calls.length,3);assert.equal(a.stores.items[0].id,'tank_f86');assert.equal(b.stores.items[0].id,'tank_f86');
 a.dispose();b.dispose();
});
test('custom native loadouts never fall back to local preset mountStores',()=>{
 const f=fixture();let presets=0;const m=f.context.createFrontlineAircraftVisual(f.renderer,'f86f',{mountStores(){presets++;return{items:[]}}});
 assert.throws(()=>m.accept(sample(m,1,[],{}),1),/accepted|接受|挂载|外挂/);assert.equal(presets,0);m.dispose();
});

test('accepted custom configuration mounts actual catalog bomb geometry on the proper native hardpoints',()=>{
 const f=fixture();Object.assign(f.context,{renderer:f.renderer,data:{projectiles:{}},G4:{},RE_FACTOR:{},localStorage:{getItem(){return null}}});
 const start=source.indexOf('    const AIR_STORE_DEFS ='),end=source.indexOf('    /** Total mass of the stores',start);
 vm.runInContext(source.slice(start,end)+contact+'\nglobalThis.acceptedMount=(plane,id,stores)=>mountFrontlineAcceptedStores({renderer,plane,aircraftId:id,stores,storeMesh,sourceStoreMesh,storeDefs:AIR_STORE_DEFS});',f.context);
 const model=f.context.createFrontlineAircraftVisual(f.renderer,'f86f',{mountAcceptedStores:f.context.acceptedMount});
 const profile=JSON.parse(fs.readFileSync(new URL('../../data/aircraft/frontline.json',import.meta.url),'utf8')).aircraft.f86f.stores.loadouts.find(lo=>lo.index===1);
 const stores=profile.items.map(item=>({...item,gone:false})),u=sample(model,1,stores,{'inner:-1':'anm64','inner:1':'anm64'}),before=JSON.stringify(u);
 model.accept(u,1);model.pose();assert.equal(model.stores.items.length,2);
 const left=model.stores.items[0],right=model.stores.items[1];assert.equal(left.id,'anm64');assert.ok(left.node.mesh.count>100);assert.ok(right.node.mesh.count>100);
 for(let i=0;i<2;i++){const mounted=model.stores.items[i];assert.deepEqual(Array.from(mounted.node.local.slice(12,15)),Array.from(new Float32Array(stores[i].p)));assert.equal(mounted.owner,stores[i].owner);assert.equal(mounted.count,stores[i].count);assert.equal(mounted.pylonNode.visible,true);}
 model.accept({...u,stores:stores.map((store,i)=>({...store,count:i?store.count:0,gone:!i})),resource_revision:2},2);model.pose();
 assert.equal(model.stores.items[0].node,left.node,'A normal release reuses its original mesh');assert.equal(left.node.visible,false);assert.equal(left.pylonNode.visible,true);assert.equal(right.node.visible,true);
 assert.equal(JSON.stringify(u),before);model.dispose();
});
