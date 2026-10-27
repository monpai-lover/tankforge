import {installCurrentPresentation,productionFunction} from './fixtures/frontline-current-presentation.mjs';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

const source=fs.readFileSync(new URL('../bundle/app.js.html',import.meta.url),'utf8');
const client=fs.readFileSync(new URL('../tools/frontline_client.js',import.meta.url),'utf8');
const visual=fs.readFileSync(new URL('../tools/frontline_aircraft_visual.js',import.meta.url),'utf8');
const contacts=fs.readFileSync(new URL('../tools/frontline_contact_visual.js',import.meta.url),'utf8');
function fixture(){
  const context=vm.createContext({performance,atob});
  const a=source.indexOf('  // the C flight core'),b=source.indexOf('  // client/web/src/main.js',a);
  assert.ok(a>0&&b>a);
  // Real production math/scene geometry, all actual fighter types, AircraftDamage,
  // and the actual Aircraft constructor/pose/input/camera. Only GPU upload is a
  // CPU buffer here; no substitute aircraft class or generated placeholder mesh.
  vm.runInContext(source.slice(source.indexOf('  function m4()'),source.indexOf('  // client/web/src/game/relief.js'))+
    source.slice(source.lastIndexOf('\n',a)+1,b)+contacts+visual,context);
  let uploaded=0,freed=0;
  const renderer={mesh(data){uploaded++;return{count:data.length/13,_src:{data}}},freeMesh(){freed++}};
  return{context,renderer,get uploaded(){return uploaded},get freed(){return freed}};
}
function sample(model,id=1){
  const state=Array(80).fill(0),aero=Array(48).fill(0);
  state[0]=100;state[1]=1200;state[2]=-200;state[6]=1;state[9]=200;
  state[13]=200;state[14]=190;state[17]=1;state[27]=.8;state[33]=1;
  state[35]=1200;state[42]=state[46]=state[50]=1;aero[23]=.4;
  return{unit:{battle:1,unit:id,life:1},aircraft:model.plane.type.id,pos:state.slice(0,3),yaw:0,alive:true,owner:7,controller:7,team:'blue',epoch:2,state,aero,
    damage:{parts:model.plane.damage.parts.map(p=>[p.max,0]),fire:false,broken:false},
    guns:[{id:'actual-exported-gun',ammo:1800}],fuel:{kg:1000,max:1200,flow:.7},stores:[],resource_revision:1};
}

test('public aircraft keeps the real Aircraft pose and mechanisms without private telemetry or controllable flight',()=>{
 const f=fixture(),full=f.context.createFrontlineAircraftVisual(f.renderer,'f86f'),publicModel=f.context.createFrontlineAircraftVisual(f.renderer,'f86f'),u=sample(full);
 full.accept(u,1);full.pose(.016);full.root.update();
 const s=u.state,a=u.aero,p={sensed:true,unit:u.unit,aircraft:u.aircraft,team:u.team,alive:u.alive,pos:s.slice(0,3),quaternion:s.slice(3,7),speed:s[13],ground_speed:s[75],agl:s[35],sample_time:s[23],pitch_surface:s[24],roll_surface:s[25],yaw_surface:s[26],gear:s[33],flap:s[34],airbrake:a[23],gear_axes:a.slice(36,40),slat:0,detached_parts:[],stores:[]};
 publicModel.accept(p,1);publicModel.pose(.016);publicModel.root.update();assert.deepEqual(Array.from(publicModel.root.local),Array.from(full.root.local));
 for(let i=0;i<full.plane.controls.length;i++)assert.deepEqual(Array.from(publicModel.plane.controls[i].node.local),Array.from(full.plane.controls[i].node.local));
 assert.equal(publicModel.accepted,p);assert.equal(publicModel.plane.instrumentContext,null);assert.throws(()=>publicModel.setControlled(true,new Set()),/sensed aircraft/);assert.throws(()=>publicModel.plane.api.step(),/cannot step flight/);full.dispose();publicModel.dispose();
});

test('actual Aircraft meshes and accepted gear/controls pose without any local flight step or resource mutation',()=>{
  const f=fixture(),model=f.context.createFrontlineAircraftVisual(f.renderer,'f86f');
  assert.ok(model.plane instanceof f.context.Aircraft);
  assert.ok(model.plane.meshes.length>10&&model.plane.controls.length>0);
  assert.ok(model.plane.meshes.some(m=>m.count>1000),'actual source aircraft geometry uploaded');
  const u=sample(model),stock=JSON.stringify({guns:u.guns,fuel:u.fuel,stores:u.stores});
  model.accept(u,1);model.pose(.016);model.root.update();
  assert.deepEqual(Array.from(model.plane.cur),Array.from(new Float32Array(u.state)));
  assert.deepEqual(Array.from(model.root.local.slice(12,15)),[100,1200,-200]);
  const gear=model.plane.controls.find(c=>c.type==='gear'||c.param==='gear');
  assert.ok(gear);const extended=Array.from(gear.node.local);
  const next={...u,state:u.state.slice(),aero:u.aero.slice()};
  next.state[33]=0;next.state[24]=.4;next.state[25]=-.6;next.state[34]=.5;next.aero[23]=.75;
  model.accept(next,2);model.pose(.016);
  assert.notDeepEqual(Array.from(gear.node.local),extended);
  assert.equal(model.plane.brakeK,.75);
  const accepted=Array.from(model.plane.cur);
  for(let i=0;i<120;i++)model.pose(1/60);
  assert.deepEqual(Array.from(model.plane.cur),accepted);
  assert.equal(JSON.stringify({guns:u.guns,fuel:u.fuel,stores:u.stores}),stock);
  assert.throws(()=>model.plane.api.step(),/cannot step flight/);
  assert.throws(()=>model.plane.update(.05),/cannot update flight/);
  const count=f.uploaded;model.dispose();model.dispose();assert.equal(f.freed,count);
});

test('accepted native damage removes actual wing nodes; per-aircraft telemetry is isolated and invalid state is rejected',()=>{
  const f=fixture(),a=f.context.createFrontlineAircraftVisual(f.renderer,'f86f'),b=f.context.createFrontlineAircraftVisual(f.renderer,'f86f');
  const ua=sample(a),ub=sample(b,2);ub.state[0]=900;
  a.accept(ua,1);b.accept(ub,1);
  assert.notEqual(a.plane.api.memory.buffer,b.plane.api.memory.buffer);
  const index=a.plane.damage.parts.findIndex(p=>p.id==='wing_l');assert.ok(index>=0);
  ua.damage.parts[index]=[0,1];a.accept({...ua},2);a.pose(.016);
  assert.equal(a.plane.wings.l.visible,false);assert.equal(a.plane.damage.gone('wing_l'),true);
  assert.equal(b.plane.cur[0],900);assert.equal(b.plane.damage.gone('wing_l'),false);
  const previous=Array.from(a.plane.cur),bad={...ua,state:ua.state.slice()};bad.state[1]=NaN;
  assert.throws(()=>a.accept(bad,3),/状态格式/);assert.deepEqual(Array.from(a.plane.cur),previous);
  assert.throws(()=>f.context.createFrontlineAircraftVisual(f.renderer,'missing'),/未知飞机/);
  a.dispose();b.dispose();
});

test('actual frontend heartbeat transports original keyboard/mouse pilot intent without changing accepted telemetry',()=>{
  const x=fixture(),model=x.context.createFrontlineAircraftVisual(x.renderer,'f86f'),u=sample(model);
  model.accept(u,1);model.setControlled(true,new Set());
  const sent=[],listeners=new Map(),timers=[],target=name=>({addEventListener(type,fn){listeners.set(name+':'+type,fn)},focus(){},setPointerCapture(){}});
  const game={mode:'battle',air:null,touch:{throttle:0,steer:0},mdx:0,mdy:0},projection={guns:u.guns.map(g=>({...g})),fuel:{...u.fuel},stores:{items:[],groups:[],sel:0}};
  const document={...target('document'),body:{dataset:{}},getElementById:()=>({hidden:true})};
  vm.runInContext(fs.readFileSync(new URL('../tools/frontline_existing_aircraft.js',import.meta.url),'utf8'),x.context);
  const bridge=x.context.createEstablishedAircraftBridge({game,document,airHud:{hidden:true},project:()=>projection,
    clearInput:air=>x.context.clearAircraftInput(air,game.touch),syncTouch(){},pilotStep(air,dt){x.context.advanceAircraftInput(air,dt,game,[]);},systems(){},audio(){},effects(){},camera(){},drawHud(){},selection(){return{};}});
  bridge.bind(model,u);
  const f={active:true,epoch:7,seq:0,keys:new Set(),fire:false};
  f.establishedFlight={transmit(){const intent=bridge.intent();if(intent){sent.push({op:'air_input',unit:u.unit,epoch:f.epoch,seq:++f.seq,...intent});bridge.consumeIntent();}},clear(){x.context.clearAircraftInput(game.air,game.touch);game.air.storeHeld=game.air.storeTap=false;bridge.step(0);this.transmit();}};
  Object.assign(x.context,{G4:game,f,net:{open:true},controlled:()=>u,clamp:(n,a,b)=>Math.max(a,Math.min(b,n)),setInterval:fn=>(timers.push(fn),1),canvas:target('canvas'),window:target('window'),document,ui:{querySelectorAll:()=>[]}});
  const a=client.indexOf('      function transmitInput(){'),b=client.indexOf('      function frame(dt){',a);vm.runInContext(client.slice(a,b),x.context);
  const event=code=>({code,target:{tagName:'CANVAS'},repeat:false,preventDefault(){throw Error('Original aircraft event was intercepted');},stopImmediatePropagation(){throw Error('Original aircraft event was intercepted');}});
  const accepted=Array.from(model.plane.cur);
  listeners.get('document:keydown')(event('KeyS'));assert.equal(f.keys.size,0);
  model.plane.keys.add('KeyS');game.mdx=12;game.mdy=-5;bridge.step(.016);timers[0]();
  assert.equal(sent.at(-1).manual_pitch,1);assert.equal(sent.at(-1).epoch,7);assert.ok(sent.at(-1).aim[0]>0);
  model.plane.toggle('KeyG');bridge.step(.016);timers[0]();assert.equal(sent.at(-1).flags&4,0);
  model.accept({...u,state:u.state.map((v,k)=>k===33?.99:v)},2);bridge.bind(model,u);bridge.step(.016);timers[0]();assert.equal(sent.at(-1).flags&4,0,'Accepted leg movement cannot reset gear-up intent');
  game.air.storeTap=true;timers[0]();assert.equal(sent.at(-1).release,true);for(let i=0;i<10;i++)timers[0]();
  assert.ok(sent.every(m=>m.op==='air_input'&&m.unit.unit===u.unit.unit));assert.deepEqual(sent.map(m=>m.seq),Array.from({length:sent.length},(_,i)=>i+1));
  listeners.get('window:blur')();assert.equal(sent.at(-1).manual_pitch,0);assert.equal(sent.at(-1).release,false);assert.equal(sent.at(-1).fire,false);
  assert.equal(model.plane.cur[1],accepted[1]);assert.equal(model.plane.cur[9],accepted[9]);bridge.unbind();model.dispose();
});

test('server part IDs preserve damage binding when the actual procedural airframe omits an imported radar node',()=>{
  const f=fixture(),model=f.context.createFrontlineAircraftVisual(f.renderer,'f104g');
  const definitions=JSON.parse(fs.readFileSync(new URL('../../data/aircraft/aircraft.json',import.meta.url),'utf8')).types.f104g.parts.slice().reverse();
  assert.ok(definitions.some(p=>p.id==='radar'));
  const u=sample(model);u.damage={parts:definitions.map(p=>[p.id==='pilot'?0:p.hp,0]),part_ids:definitions.map(p=>p.id),fire:false,broken:false};
  model.accept(u,1);assert.equal(model.plane.damage.pilotDead,true);
  for(const p of model.plane.damage.parts)if(p.id!=='pilot')assert.equal(p.hp,definitions.find(d=>d.id===p.id).hp);
  model.dispose();
});

test('actual production mountStores renders accepted F86 bombs and preserves pylons after native release',()=>{
  const f=fixture();Object.assign(f.context,{renderer:f.renderer,data:{projectiles:{}},G4:{},RE_FACTOR:{},localStorage:{getItem(){return null}}});
  const a=source.indexOf('    const AIR_STORE_DEFS ='),b=source.indexOf('    /** Total mass of the stores',a);
  vm.runInContext(source.slice(a,b)+'\nglobalThis.actualMountStores=mountStores;',f.context);
  const model=f.context.createFrontlineAircraftVisual(f.renderer,'f86f',{mountStores:f.context.actualMountStores});
  const profile=JSON.parse(fs.readFileSync(new URL('../../data/aircraft/frontline.json',import.meta.url),'utf8')).aircraft.f86f.stores.loadouts.find(lo=>lo.index===1);
  const u=sample(model);u.loadout=1;u.stores=profile.items.map(item=>({...item,gone:false}));
  model.accept(u,1);model.pose();assert.equal(model.stores.items.length,2);
  for(let i=0;i<2;i++){
    const it=model.stores.items[i];assert.equal(it.id,'anm64');assert.ok(it.node.mesh.count>0);
    assert.deepEqual(Array.from(it.node.local.slice(12,15)),Array.from(new Float32Array(u.stores[i].p)));
    assert.equal(it.node.visible,true);assert.equal(it.pylonNode.visible,true);
  }
  u.stores[0]={...u.stores[0],gone:true,count:0};model.accept({...u},2);model.pose();
  assert.equal(model.stores.items[0].node.visible,false);assert.equal(model.stores.items[0].pylonNode.visible,true);
  assert.equal(model.stores.items[1].node.visible,true);
  const wing=model.plane.damage.parts.findIndex(p=>p.id==='wing_l');u.damage.parts[wing]=[0,1];
  model.accept({...u},3);model.pose();assert.equal(model.stores.items[0].pylonNode.visible,false);
  assert.equal(model.stores.items[1].pylonNode.visible,true);model.dispose();
});

test('native same-loadout service restores actual detached surfaces/stores and supports a second detachment without respawn or freeing shared wing meshes',()=>{
  const f=fixture(),freed=new Set();f.renderer.freeMesh=mesh=>freed.add(mesh);
  Object.assign(f.context,{renderer:f.renderer,data:{projectiles:{}},G4:{},RE_FACTOR:{},localStorage:{getItem(){return null}}});
  const a=source.indexOf('    const AIR_STORE_DEFS ='),b=source.indexOf('    /** Total mass of the stores',a);
  vm.runInContext(source.slice(a,b)+'\nglobalThis.actualMountStores=mountStores;',f.context);
  let mounts=0;const model=f.context.createFrontlineAircraftVisual(f.renderer,'f86f',{mountStores(...args){mounts++;return f.context.actualMountStores(...args)}});
  const profile=JSON.parse(fs.readFileSync(new URL('../../data/aircraft/frontline.json',import.meta.url),'utf8')).aircraft.f86f.stores.loadouts.find(lo=>lo.index===1);
  const u=sample(model);u.loadout=1;u.stores=profile.items.map(it=>({...it,gone:false}));u.service_revision=0;u.service={status:'idle',revision:0};u.state[23]=10;
  model.accept(u,1);const plane=model.plane,root=plane.root,damage=plane.damage,childIDs=()=>JSON.stringify(Object.fromEntries(Object.entries(damage.children).map(([id,list])=>[id,list.map(part=>part.id)]))),children=childIDs(),repairPart='wing_l_out',wing=plane.wingsOut.l,wingMesh=wing.mesh,originalStore=model.stores.items[0].node;
  const lost=new Set([repairPart]);for(let n=0;n<damage.parts.length;n++)for(const p of damage.parts)if(lost.has(p.parent))lost.add(p.id);
  const control=plane.controls.find(c=>lost.has(c.gonePart));assert.ok(control);
  const broken={...u,resource_revision:2,damage:{...u.damage,parts:damage.parts.map(p=>[lost.has(p.id)?0:p.max,lost.has(p.id)?1:0])},stores:u.stores.map((it,i)=>({...it,gone:i===0,count:i===0?0:1}))};
  damage.alive();model.accept(broken,2);const detachedCopy=plane.debris.find(it=>it.node.mesh===wingMesh);
  assert.ok(detachedCopy);assert.ok(root.children.includes(wing),'_debris keeps the original surface node');
  assert.equal(detachedCopy.node.mesh,wingMesh,'Actual cosmetic debris shares the original GPU mesh');
  assert.equal(wing.visible,false);assert.equal(wing.fell,true);assert.equal(control.node.visible,false);assert.ok(damage.detachedLog.includes(repairPart));assert.equal(freed.has(wingMesh),false);
  const aliveBroken=Array.from(damage.alive());assert.ok(aliveBroken.some(v=>v===0));
  const working={...broken,service_revision:1,service:{status:'servicing',revision:1,elapsed_s:14.9,remaining_s:.1,duration_s:15}};
  model.accept(working,3);assert.equal(mounts,1);assert.equal(wing.visible,false);assert.equal(model.stores.items[0].node.visible,false);
  const cancelled={...working,service_revision:2,service:{status:'cancelled',revision:2,elapsed_s:0,remaining_s:15,duration_s:15,reason:'new_damage'}};
  model.accept(cancelled,4);assert.equal(mounts,1);assert.equal(wing.visible,false);
  const repaired={...u,resource_revision:3,service_revision:4,service:{status:'complete',revision:4,elapsed_s:15,remaining_s:0,duration_s:15},state:u.state.slice()};repaired.state[23]=25;
  model.accept(repaired,5);
  assert.equal(model.plane,plane);assert.equal(plane.root,root);assert.equal(plane.damage,damage);assert.equal(plane.cur[23],25,'No spawn/reset of accepted flight time');
  assert.equal(wing.mesh,wingMesh);assert.equal(wing.visible,true);assert.equal(wing.fell,false);assert.equal(freed.has(wingMesh),false);
  assert.equal(plane.debris.length,0);assert.equal(root.children.includes(detachedCopy.node),false);
  assert.equal(damage.gone(repairPart),false);assert.ok(!damage.detachedLog.includes(repairPart));assert.equal(childIDs(),children);assert.equal(control.node.visible,true);assert.equal(control.fell,false);
  for(const list of Object.values(damage.children))for(const part of list)assert.equal(part,damage.by[part.id]);
  assert.ok(Array.from(damage.alive()).every(v=>v===1));assert.equal(mounts,2);assert.notEqual(model.stores.items[0].node,originalStore);assert.equal(model.stores.items[0].node.visible,true);assert.equal(model.stores.items[0].count,1);
  model.accept({...repaired},6);model.accept({...repaired,resource_revision:4},7);assert.equal(mounts,2,'Repeated complete/fuel revisions do not rebuild again');
  const again={...broken,resource_revision:5,service_revision:4,service:repaired.service};model.accept(again,8);
  assert.equal(wing.visible,false);assert.equal(wing.fell,true);assert.ok(plane.debris.some(it=>it.node.mesh===wingMesh));assert.equal(freed.has(wingMesh),false);assert.equal(damage.detachedLog.filter(id=>id===repairPart).length,1);assert.equal(childIDs(),children);
  model.dispose();assert.equal(freed.has(wingMesh),true);
});

test('all28 actual procedural Aircraft accept the complete server damage catalogs by stable ID',()=>{
  const f=fixture(),catalog=JSON.parse(fs.readFileSync(new URL('../../data/aircraft/aircraft.json',import.meta.url),'utf8')).types;
  const ids=Object.keys(f.context.AIRCRAFT_TYPES);assert.equal(ids.length,28);assert.ok(ids.includes('su27skm'));assert.ok(ids.includes('mig29smt'));assert.deepEqual(Object.keys(catalog).sort(),ids.slice().sort());
  for(const id of ids){
    const model=f.context.createFrontlineAircraftVisual(f.renderer,id),u=sample(model),definitions=catalog[id].parts;
    const declaredAliases={f4e:{engine_l:'engine',engine_r:'engine'},su27:{fin:'tail'}}[catalog[id].inheritedModelId||id]||{};
    u.damage={parts:definitions.map(p=>[p.hp,0]),part_ids:definitions.map(p=>p.id),part_max_hp:definitions.map(p=>p.hp),visual_aliases:declaredAliases,fire:false,broken:false};
    model.accept(u,1);model.pose();
    assert.equal(model.plane.constructor,f.context.Aircraft,id);
    assert.equal(model.plane.damage.parts.length,model.plane.partNodes.length,id);
    assert.ok(model.plane.meshes.some(m=>m.count>0),id);
    for(const part of model.plane.damage.parts){const binding=declaredAliases[part.id]||part.id,original=definitions.find(p=>p.id===binding);assert.ok(original,`${id}: visual part ${part.id} lacks host damage binding`);assert.equal(part.hp,binding===part.id?original.hp:part.max,`${id}/${part.id}`);}
    model.dispose();
  }
});

test('only explicit host visual aliases project aggregate health; undeclared missing parts remain rejected',()=>{
  const f=fixture(),catalog=JSON.parse(fs.readFileSync(new URL('../../data/aircraft/aircraft.json',import.meta.url),'utf8')).types;
  for(const [id,aliases] of [['f4e',{engine_l:'engine',engine_r:'engine'}],['su27',{fin:'tail'}]]){
    const model=f.context.createFrontlineAircraftVisual(f.renderer,id),u=sample(model),definitions=catalog[id].parts,owner=Object.values(aliases)[0];
    u.damage={parts:definitions.map(p=>[p.hp*(p.id===owner?.25:1),0]),part_ids:definitions.map(p=>p.id),part_max_hp:definitions.map(p=>p.hp),fire:false,broken:false};
    assert.throws(()=>model.accept(u,1),/部件目录不匹配/);
    u.damage.visual_aliases=aliases;model.accept({...u},2);
    for(const visualId of Object.keys(aliases)){const part=model.plane.damage.by[visualId];assert.equal(part.hp,part.max*.25);assert.equal(model.plane.frontlineDamageBindings[visualId],owner);}
    model.dispose();
  }
});

test('actual client.receive updates original Aircraft telemetry and pose while observer keys stay separate without any frame call',async()=>{
  const f=fixture();Object.assign(f.context,{renderer:f.renderer,data:{projectiles:{}},G4:{keys:new Set()},RE_FACTOR:{},localStorage:{getItem(){return null}}});
  const storesA=source.indexOf('    const AIR_STORE_DEFS ='),storesB=source.indexOf('    /** Total mass of the stores',storesA);
  vm.runInContext(source.slice(storesA,storesB),f.context);
  const state={active:true,room:null,control:null,epoch:0,seq:0,keys:new Set(),models:new Map(),airModels:new Map(),renderStats:{},facilityPresentation:{root:new f.context.Node('test-facilities'),dispose(){}},root:new f.context.Node('test-world'),
    units:[],aircrafts:[],missiles:[],ordnancePresentation:{root:new f.context.Node('test-ordnance'),clear(){},accept(){}},companies:[],objectives:[],vehicles:[],events:[],lastTick:0,map:{},focus:[0,0,0],establishedFlight:{release(){},sync(){}}};
  const elements=new Map(),key=r=>r?`${r.battle}:${r.unit}:${r.life}`:'';
  Object.assign(f.context,{f:state,net:{id:7},unitKey:key,same:(a,b)=>key(a)===key(b),
    mine:()=>state.room?.members.find(m=>m.player===7),owned:()=>null,
    controlled:()=>state.aircrafts.find(u=>key(u.unit)===key(state.control)),
    el:id=>{if(!elements.has(id))elements.set(id,{});return elements.get(id)},note(){},canvas:{focus(){}},
    ensureMap:async()=>{},refreshUi(){},send(){},hud:{loading(){}},reticle:{},flightReadout:{},renderGate:{clear(){}},sound:{cancelFull(){}},fx:{particles:[],decals:[],beams:[]},releaseGroundDetail(){}});
  installCurrentPresentation(f.context);
  const modelsA=client.indexOf('      function updateAircraftModels('),modelsB=client.indexOf('      function refreshUi(',modelsA);
  const receiveA=client.indexOf('      function applyControl('),receiveB=client.indexOf("      net.on('frontline'",receiveA);
  const resetA=client.indexOf('      function resetBattlePresentation(){'),resetB=client.indexOf('      function send(command)',resetA);
  vm.runInContext(client.slice(0,client.indexOf('    // Production client for the versioned native frontline world.'))+client.slice(resetA,resetB)+productionFunction('updateAircraftModels',client)+client.slice(receiveA,receiveB),f.context);
  const temporary=f.context.createFrontlineAircraftVisual(f.renderer,'f86f'),u=sample(temporary);temporary.dispose();
  const room={id:1,battle:1,battle_mode:'air_frontline',player_ground_allowed:false,started:true,members:[{player:7,controlled:u.unit,epoch:2,air_sorties_remaining:0,air_sortie_eligible:true}],team_score:[0,0],score_limit:1000};
  await f.context.receive({version:1,message:{op:'snapshot',room,tick:10,units:[],aircrafts:[u],companies:[],objectives:[]}});
  const item=state.airModels.get(key(u.unit));assert.ok(item);assert.equal(item.plane.constructor,f.context.Aircraft);
  assert.equal(item.tick,10);assert.notEqual(item.plane.keys,state.keys,'Observer-held keys must not replace the original aircraft pilot key Set');assert.equal(typeof item.plane.keys.add,'function');assert.equal(typeof item.plane.keys.has,'function');assert.equal(item.plane.cur[1],1200);
  assert.equal(f.context.frame,undefined,'No drawing frame function was even installed');
  const before=Array.from(item.plane.controls.find(c=>c.type==='roll').node.local);
  const next={...u,state:u.state.slice()};next.state[25]=.6;
  const score={player:7,name:'Pilot',score:100,air_kills:1,ground_kills:0,deaths:0};
  await f.context.receive({version:1,message:{op:'frame',battle:1,tick:11,units:[],aircrafts:[next],companies:[],objectives:[],events:[{kind:'player_score',player:7,points:100,totals:score,team_score:[100,0]}]}});
  assert.equal(item.tick,11);assert.equal(item.plane.cur[25],Math.fround(.6));assert.equal(item.accepted,next);
  assert.notDeepEqual(Array.from(item.plane.controls.find(c=>c.type==='roll').node.local),before);
  assert.equal(state.airModels.size,1,'Frame admission reuses the original Aircraft');assert.equal(state.room.scoreboard[0].score,100);assert.equal(state.room.team_score[0],100);item.dispose();
});

test('actual client terrain sampler agrees with every retained runway/patch/pad source probe',()=>{
  const map=JSON.parse(fs.readFileSync(new URL('../../data/frontline/korea.json',import.meta.url),'utf8'));
  const c=vm.createContext({f:{map},clamp:(n,a,b)=>Math.max(a,Math.min(b,n))});
  const a=client.indexOf('      function grid('),b=client.indexOf('      async function ensureMap(',a);
  vm.runInContext(client.slice(a,b),c);
  assert.ok(map.terrain.runways.length>=2);
  for(const p of map.sampling.validationProbes)assert.ok(Math.abs(c.height(p.x,p.z)-p.height)<1e-6,p.id||JSON.stringify(p));
});
