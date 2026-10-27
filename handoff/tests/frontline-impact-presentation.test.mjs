import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const ordnanceApp=fs.readFileSync(new URL('../bundle/app.js.html',import.meta.url),'utf8');
const ordnanceDefs=JSON.parse(fs.readFileSync(new URL('../../data/aircraft/frontline.json',import.meta.url),'utf8')).storeDefinitions;
const ordnancePrelude=ordnanceApp.slice(ordnanceApp.indexOf('  function m4()'),ordnanceApp.indexOf('  // client/web/src/game/relief.js'))+ordnanceApp.slice(ordnanceApp.indexOf('  var aqMul = '),ordnanceApp.indexOf('  var AIRCRAFT_KEYS'))+fs.readFileSync(new URL('../tools/frontline_ordnance_visual.js',import.meta.url),'utf8');
function installOrdnance(context){
  context.ordnanceStoreDefs=ordnanceDefs;
  vm.runInContext(ordnancePrelude+`f.ordnancePresentation=createFrontlineOrdnanceVisual({Node,storeDefs:ordnanceStoreDefs,storeMesh:id=>{throw Error('Unexpected ordnance geometry in this isolated fixture: '+id);},quatMatrix,aqLook});`,context);
}

const source=fs.readFileSync(new URL('../tools/frontline_client.js',import.meta.url),'utf8'),helpers=source.slice(0,source.indexOf('    // Production client for the versioned native frontline world.'));
function harness(){
 const blasts=[],contacts=[],f={room:{id:1,battle:2,battle_mode:'air_frontline',members:[{player:7,epoch:1,controlled:null}],team_score:[0,0]},active:false,control:null,airModels:new Map(),models:new Map(),keys:new Set(),units:[],aircrafts:[],companies:[],objectives:[],events:[],lastTick:0,establishedFlight:{sync(){},release(){}},root:{children:[]}},nodes=new Map(),key=r=>r?`${r.battle}:${r.unit}:${r.life}`:'';
 const c=vm.createContext({f,G4:{time:2},data:{projectiles:{}},net:{id:7},unitKey:key,same:(a,b)=>key(a)===key(b),mine:()=>f.room.members[0],controlled:()=>null,owned:()=>null,el:id=>{if(!nodes.has(id))nodes.set(id,{});return nodes.get(id)},note(){},canvas:{focus(){}},ensureMap:async()=>{},updateAircraftModels(){},refreshUi(){},fx:{explosion:(p,_,tnt,ground)=>blasts.push({point:[...p],tnt,ground}),armorImpact:p=>contacts.push([...p])},sound:{},renderer:{}});
 installOrdnance(c);
 const a=source.indexOf('      function applyControl('),b=source.indexOf("      net.on('frontline'",a);vm.runInContext(helpers+source.slice(a,b),c);
 const deliver=events=>c.receive({version:1,message:{op:'frame',battle:2,tick:3,units:[],aircrafts:[],companies:[],objectives:[],events}});
 return {c,f,blasts,contacts,deliver};
}
const impact=report=>({kind:'impact',pos:[10,20,30],detail:{shot_id:4,report}});
test('actual native receive never manufactures a contact explosion for unarmed APHE, solid AP or an unrecorded terrain charge',async()=>{
 const h=harness();await h.deliver([impact({hit:{fuze_status:'unarmed',limitation:'arming_contact_thickness_unrecorded',bursts:[]}}),impact({shell_kind:'ap',bursts:[]}),{kind:'terrain_impact',pos:[1,2,3],detail:{projectile_id:'filled50'}}]);assert.equal(h.blasts.length,0);assert.equal(h.contacts.length,3);
});
test('actual native receive uses recorded delayed burst worldposition and actual strength rather than first contact',async()=>{
 const h=harness();await h.deliver([impact({bursts:[{mechanism:'delayed_aphe',time_s:.002,world_position:[40,50,60],pos:[0,0,2],explosive_kg:.017,tnt_equivalent_kg:.0272}]})]);assert.equal(h.blasts.length,1);assert.deepEqual(h.blasts[0].point,[40,50,60]);assert.equal(h.blasts[0].tnt,.0272);assert.equal(h.contacts.length,1);
});
test('actual native receive transforms delayed targetlocal burst only with recorded accepted pose',async()=>{
 const h=harness(),event=impact({bursts:[{mechanism:'delayed_aphe',time_s:.002,pos:{x:1,y:2,z:3},explosive_kg:.017}]});event.detail.accepted_pose={hull_origin:[100,200,300],ex:[0,0,-1],ey:[0,1,0],ez:[1,0,0]};await h.deliver([event]);assert.deepEqual(h.blasts[0].point,[103,202,299]);
 const g=harness();delete event.detail.accepted_pose;await g.deliver([event]);assert.equal(g.blasts.length,0);assert.equal(g.contacts.length,1);
});
test('actual native receive accepts explicit immediate HE contact records but refuses bare filler or guessed timing',async()=>{
 const h=harness();await h.deliver([impact({hit:{fuze_status:'contact_detonated',bursts:[{mechanism:'immediate_he',time_origin:'first_contact',time_s:0,explosive_kg:.017,tnt_equivalent_kg:.02822}]}})]);assert.deepEqual(h.blasts,[{point:[10,20,30],tnt:.02822,ground:false}]);
 const g=harness();await g.deliver([impact({hit:{bursts:[{mechanism:'delayed_aphe',world_position:[4,5,6],explosive_kg:.1}]}}),impact({hit:{fuze_status:'unarmed',bursts:[]},explosive_kg:.1})]);assert.equal(g.blasts.length,0);
});
test('actual native receive prefers the authoritative worldburst list and does not duplicate report-local bursts',async()=>{
 const h=harness(),event=impact({bursts:[{mechanism:'delayed_aphe',time_s:.002,pos:[99,99,99],explosive_kg:1}]});event.detail.world_bursts=[{mechanism:'delayed_aphe',time_s:.002,world_position:[4,5,6],explosive_kg:.017}];await h.deliver([event]);assert.equal(h.blasts.length,1);assert.deepEqual(h.blasts[0].point,[4,5,6]);assert.equal(h.blasts[0].tnt,.017);
});
test('actual native receive displays an admitted facility HE burst without making unarmed facility APHE explode',async()=>{
 const h=harness();await h.deliver([{kind:'facility_impact',pos:[10,20,30],detail:{world_bursts:[{mechanism:'immediate_he',time_origin:'first_contact',time_s:0,world_position:[10,20,30],explosive_kg:.6}]}},{kind:'facility_impact',pos:[1,2,3],detail:{world_bursts:[]}}]);assert.deepEqual(h.blasts,[{point:[10,20,30],tnt:.6,ground:false}]);assert.equal(h.contacts.length,2);
});
