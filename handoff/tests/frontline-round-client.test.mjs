import {installCurrentPresentation} from './fixtures/frontline-current-presentation.mjs';
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

const source=fs.readFileSync(new URL('../tools/frontline_client.js',import.meta.url),'utf8');
const helpers=source.slice(0,source.indexOf('    // Production client for the versioned native frontline world.'));
const section=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const reference=(battle,id=1)=>({battle,unit:id,life:1});
const room=(battle,extra={})=>({id:7,battle,battle_mode:'air_frontline',player_ground_allowed:false,started:true,round_state:'battle',members:[{player:5,epoch:4,controlled:reference(battle),air_sorties_remaining:1,air_sortie_eligible:true}],...extra});

function harness(){
  const calls=[],elements=new Map(),f={room:room(10),active:true,control:reference(10),epoch:4,seq:8,orderSeq:9,supportSeq:3,lastTick:500,keys:new Set(['KeyW','Space']),fire:true,mouse:{x:1,y:2},models:new Map(),airModels:new Map(),root:{children:[]},facilityPresentation:{root:{name:'facilities'},dispose(){calls.push('dispose facilities');},async install(){calls.push('install');return true;}},renderStats:{drawDt:.4,lastDrawAt:123},units:[],aircrafts:[],companies:[],objectives:[],facilities:[],facilityJobs:[],events:[],map:{},facilityIdentity:'10:old',facilityCatalog:{old:true},contactPresentation:{old:true},contacts:[{old:true}],order:{old:true},follow:'10:1:1',lastServiceRejection:{old:true}};
  f.establishedFlight={release(){calls.push('release original controls');},garage(){calls.push('original garage');},transmit(){calls.push('original transport');}};
  const c=vm.createContext({airGarage:{sel:'f86f'},sharedApi:{deploymentMap:()=>({})},f,calls,net:{id:5,open:true},renderGate:{clear(){calls.push('clear gate');}},sound:{cancelFull(){calls.push('cancel audio');}},fx:{particles:[1],decals:[2],beams:[3]},reticle:{hidden:false},flightReadout:{hidden:false},releaseGroundDetail(){calls.push('release detail');},unitKey:r=>r?`${r.battle}:${r.unit}:${r.life}`:'',same:(a,b)=>JSON.stringify(a)===JSON.stringify(b),mine:()=>f.room?.members.find(m=>m.player===5),owned:()=>null,controlled:()=>f.units.find(u=>JSON.stringify(u.unit)===JSON.stringify(f.control)),controlledAirModel:()=>null,el:key=>{if(!elements.has(key))elements.set(key,{});return elements.get(key);},note:s=>calls.push(['note',s]),send:s=>calls.push(['send',s]),refreshUi:()=>calls.push('refresh'),updateAircraftModels:()=>calls.push('models'),ensureMap:async()=>{},canvas:{focus(){}},G4:{keys:new Set(),fireHeld:false,mgHeld:false},renderer:{setMap(){},zones:[]},setMode:()=>{},hud:{loading(){},toast:s=>calls.push(['toast',s])},clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),console,performance:{now:()=>1000},data:{projectiles:{}},frontlineAirServiceReason:s=>s});
  installOrdnance(c);installCurrentPresentation(c);
  vm.runInContext(helpers+section('      function resetBattlePresentation(){','      function send(command)')+section('      function applyControl(unit,epoch){',"      net.on('frontline'")+section('      function transmitInput(){','      // Input transport'),c);
  return {c,f,calls,elements};
}
const deliver=(c,message)=>c.receive({version:1,message});

test('round text consumes accepted native time and intermission metadata without a browser clock',()=>{
  const c=vm.createContext({});vm.runInContext(helpers,c);
  const r=room(10,{round_number:2,round_elapsed_s:125.7});
  assert.equal(c.frontlineRoundPresentation(r).text,'第 2 局 · 02:05');
  assert.equal(c.frontlineRoundPresentation(r).text,'第 2 局 · 02:05');
  const end={...r,round_state:'intermission',next_round_s:4.2,result:{winner:'red',reason:'readiness'}};
  assert.equal(c.frontlineRoundPresentation(end).text,'第 2 局结束 · 红方获胜 · 战备耗尽 · 下一局 5 秒');
  delete end.next_round_s;assert.match(c.frontlineRoundPresentation(end).text,/正在结算/);
  assert.equal(r.round_elapsed_s,125.7);
});

test('new accepted battle disposes old model/contact/audio state and admits fresh epoch',async()=>{
  const {c,f,calls}=harness();f.models.set('old',{lod:{dispose(){calls.push('dispose lod');}}});f.airModels.set('old',{dispose(){calls.push('dispose plane');}});
  f.terrain={name:'static map'};
  await deliver(c,{op:'room',room:room(11,{members:[{player:5,epoch:5,controlled:null}]})});
  assert.equal(f.room.battle,11);assert.equal(f.epoch,5);assert.equal(f.control,null);assert.equal(f.active,false);
  assert.equal(f.lastTick,0);assert.equal(f.seq,0);assert.equal(f.orderSeq,0);assert.equal(f.supportSeq,0);assert.equal(f.keys.size,0);assert.equal(f.fire,false);
  assert.equal(f.models.size,0);assert.equal(f.airModels.size,0);assert.equal(f.contactPresentation,null);assert.equal(f.contacts.length,0);assert.equal(f.facilityCatalog,null);assert.equal(f.facilityIdentity,null);
  assert.equal(f.root.children[0],f.terrain);assert.equal(f.terrainOrigin,null);
  assert.equal(c.fx.particles.length+c.fx.decals.length+c.fx.beams.length,0);assert.equal(c.reticle.hidden,true);assert.equal(c.flightReadout.hidden,true);
  for(const effect of ['clear gate','release detail','dispose lod','dispose plane','dispose facilities','cancel audio'])assert.ok(calls.includes(effect),effect);
});

test('old room, native frame, control, and end messages cannot replace the next battle',async()=>{
  const {c,f,calls}=harness();await deliver(c,{op:'room',room:room(11,{members:[{player:5,epoch:5,controlled:null}]})});
  const accepted=f.room;
  await deliver(c,{op:'room',room:room(10)});
  await deliver(c,{op:'frame',battle:10,tick:9999,units:[{unit:reference(10)}],companies:[],objectives:[]});
  assert.ok(!calls.includes('models'),'Old frame never updates an aircraft model');
  await deliver(c,{op:'control',unit:reference(10),epoch:99});
  await deliver(c,{op:'control',unit:null,epoch:4});
  await deliver(c,{op:'ended',battle:10,winner:'red',reason:'time'});
  assert.equal(f.room,accepted);assert.equal(f.room.started,true);assert.equal(f.control,null);assert.equal(f.epoch,5);assert.equal(f.lastTick,0);assert.equal(f.units.length,0);
});

test('snapshot waiting for old map/catalog cannot resume after battle reset',async()=>{
  const {c,f,calls}=harness();let release;
  c.ensureMap=()=>new Promise(resolve=>{release=resolve;});
  const pending=deliver(c,{op:'snapshot',room:room(10,{facility_layout_version:1,map:'korea',facility_layout_hash:'old'}),tick:501,units:[],aircrafts:[],companies:[],objectives:[],facility_geometry_catalog:{old:true}});
  assert.equal(typeof release,'function');
  await deliver(c,{op:'room',room:room(11,{members:[{player:5,epoch:5,controlled:null}]})});
  release();await pending;
  assert.equal(f.room.battle,11);assert.equal(f.lastTick,0);assert.equal(f.active,false);assert.equal(f.facilityCatalog,null);
  assert.ok(!calls.includes('install'));assert.ok(!calls.includes('models'));
});

test('accepted end clears held controls and blocks further transport until next round',async()=>{
  const {c,f,calls}=harness();f.aircrafts=[{unit:reference(10),aircraft:'f86f',alive:true}];c.controlled=()=>f.aircrafts.find(u=>JSON.stringify(u.unit)===JSON.stringify(f.control));c.controlledAirModel=()=>({input:()=>({aim:[0,0,1],throttle:.5,manual_pitch:0,manual_roll:0,manual_yaw:0,flags:1})});
  c.transmitInput();assert.equal(calls.filter(x=>x==='original transport').length,1);
  await deliver(c,{op:'ended',battle:10,winner:'blue',reason:'frontline'});
  c.transmitInput();assert.equal(calls.filter(x=>x==='original transport').length,1);
  assert.equal(f.keys.size,0);assert.equal(f.fire,false);assert.equal(f.control,null);assert.equal(f.room.round_state,'intermission');assert.equal(f.room.result.winner,'blue');
});
test('actual Return epoch2 then Left and a new room admits epoch1 without an orphan control poisoning the new scope',async()=>{
 const {c,f}=harness();f.epoch=1;f.room.members[0].epoch=1;await deliver(c,{op:'control',unit:null,epoch:2});assert.equal(f.epoch,2);f.seq=41;f.orderSeq=42;f.supportSeq=43;f.inputTime=99;
 await deliver(c,{op:'left'});assert.equal(f.room,null);assert.equal(f.control,null);assert.equal(f.epoch,0);assert.equal(f.seq,0);assert.equal(f.orderSeq,0);assert.equal(f.supportSeq,0);assert.equal(f.inputTime,undefined);
 await deliver(c,{op:'control',unit:null,epoch:99});assert.equal(f.epoch,0);await deliver(c,{op:'control',unit:reference(10),epoch:100});assert.equal(f.control,null);
 await deliver(c,{op:'room',room:room(20,{id:8,members:[{player:5,epoch:0,controlled:null}]})});await deliver(c,{op:'control',unit:reference(20),epoch:1});assert.equal(f.epoch,1);assert.equal(f.control.battle,20);assert.equal(f.room.members[0].epoch,1);
});
test('first admitted room resets a residual control scope even when no previous room is present',async()=>{
 const {c,f}=harness();f.room=null;f.epoch=50;f.seq=60;f.orderSeq=70;f.supportSeq=80;await deliver(c,{op:'room',room:room(21,{id:9,members:[{player:5,epoch:0,controlled:null}]})});assert.equal(f.epoch,0);assert.equal(f.seq,0);assert.equal(f.orderSeq,0);assert.equal(f.supportSeq,0);await deliver(c,{op:'control',unit:reference(21),epoch:1});assert.equal(f.epoch,1);assert.equal(f.control.battle,21);
});
test('within one battle member/client epochs stay monotonic and foreign-battle nonnull controls remain rejected',async()=>{
 const {c,f}=harness();f.room.members[0].epoch=7;await deliver(c,{op:'control',unit:reference(10,2),epoch:6});assert.equal(f.epoch,4);assert.equal(f.control.unit,1);await deliver(c,{op:'control',unit:reference(10,2),epoch:7});assert.equal(f.epoch,7);assert.equal(f.control.unit,2);await deliver(c,{op:'control',unit:null,epoch:6});await deliver(c,{op:'control',unit:reference(9,3),epoch:99});assert.equal(f.epoch,7);assert.equal(f.control.unit,2);
});
test('a control without current room membership cannot change an accepted control scope',async()=>{const {c,f}=harness();f.room.members=[];await deliver(c,{op:'control',unit:null,epoch:99});assert.equal(f.epoch,4);assert.equal(f.control.battle,10);});
test('native garage errors are visible while in-flight service feedback uses its existing single channel',async()=>{
 const {c,f,calls}=harness();c.airReason=(_air,message)=>calls.push(['airReason',message]);vm.runInContext(section('      function note(message){','      function resetBattlePresentation(){'),c);c.G4.mode='garage';c.G4.air=null;await deliver(c,{op:'error',code:'era_or_loadout',message:'请选择已开放的挂载'});assert.deepEqual(calls.filter(x=>Array.isArray(x)&&x[0]==='toast'),[['toast','请选择已开放的挂载']]);c.G4.mode='battle';c.G4.air={nativeAuthority:true};await deliver(c,{op:'error',code:'service_rejected',message:'not_stopped'});assert.equal(calls.filter(x=>Array.isArray(x)&&x[0]==='toast').length,1);assert.equal(calls.filter(x=>Array.isArray(x)&&x[0]==='airReason').length,1);assert.equal(f.lastServiceRejection.reason,'not_stopped');
});
