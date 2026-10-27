import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const runtime=fs.readFileSync(new URL('../tools/frontline_existing_runtime.js',import.meta.url),'utf8');
const client=fs.readFileSync(new URL('../tools/frontline_client.js',import.meta.url),'utf8');
function section(source,start,end){
  const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a,start);return source.slice(a,b);
}

function fixture(open){
  const messages=[],toasts=[],notes=[],garages=[],calls={bound:0,unbound:0};
  const unit={unit:{battle:1,unit:7,life:1},aircraft:'f15c',alive:true,pos:[0,500,0],guns:[{ammo:32}],fuel:{kg:50}},model={plane:{}};
  const air={plane:model.plane,active:true,nativeAuthority:true};let activeAir=air;
  const member={player:2,team:'blue',controlled:unit.unit},net={open,id:2};
  const f={returnPending:false,control:unit.unit,epoch:1,airModels:new Map(),keys:new Set(),room:{battle:1,battle_mode:'air_frontline',round_state:'battle',members:[member]},
    map:{name:'Native theatre',terrain:{x0:0,z0:0,width:2,height:2,cellX:100,cellZ:100},
      airspawns:[{enabled:true,team:0,pos:[0,500,0]}]},aircrafts:[unit],units:[],objectives:[]};
  const c=vm.createContext({f,net,guided:null,shownLife:'1:7:1',serviceSignature:'',scoreLabel:{},sharedHeaderOriginal:null,document:{getElementById:()=>null},G4:{air},airGarage:{sel:'f15c'},
    key:ref=>`${ref.battle}:${ref.unit}:${ref.life}`,unitKey:ref=>ref?`${ref.battle}:${ref.unit}:${ref.life}`:'',same:(a,b)=>JSON.stringify(a)===JSON.stringify(b),mine:()=>member,owned:()=>null,controlled:()=>f.control?unit:null,controlledAirModel:()=>model,
    bridge:{bind(){calls.bound++;activeAir=air;return air;},unbind(){calls.unbound++;activeAir=null;}},
    clear(){},hud:{toast:(message,duration)=>toasts.push([message,duration])},note:message=>notes.push(message),refreshUi(){},updateAircraftModels(){},
    garage(context){garages.push(context);activeAir=null;f.returnPending=false;},
    frontlineRoundPresentation:()=>({text:'battle'}),performance:{now:()=>100}});
  vm.runInContext(section(client,'    function createFrontlineSharedApi(','    // Production client'),c);
  c.shared=c.createFrontlineSharedApi({f,net,send:message=>messages.push(message),mine:()=>member,controlled:()=>f.control?unit:null,
    clearInput(){},ensureMapOptions(){},ensureMap(){},note(){}});
  vm.runInContext(section(runtime,'  function sharedAircraftHeader(','  function resources(')+section(runtime,'  function sync(){','  function step(')+'\n'+section(runtime,'  function returnToGarage(){','  function action('),c);
  f.shared=c.shared;f.establishedFlight={release:()=>c.bridge.unbind()};
  vm.runInContext(section(client,'      function applyControl(','      net.on(\'frontline\''),c);
  let opened=false;c.shared.subscribe(()=>{if(!f.control&&!opened){opened=true;c.garage({aircraftId:unit.aircraft});}});
  return {c,f,net,unit,air,messages,toasts,notes,garages,calls,active:()=>activeAir};
}

test('a disconnected return reports the real API rejection and keeps the accepted pilot bindable after reconnect',()=>{
  const x=fixture(false);
  assert.doesNotThrow(()=>x.c.returnToGarage());
  assert.equal(x.f.returnPending,false);assert.equal(x.garages.length,0);assert.equal(x.messages.length,0);
  assert.deepEqual(x.toasts,[['请先连接服务器',3]]);
  x.net.open=true;x.c.sync();
  assert.equal(x.active(),x.air);assert.equal(x.calls.unbound,0);assert.equal(x.calls.bound,1);
});

test('a native Return request keeps the original pilot bound until accepted control release',()=>{
  const x=fixture(true);x.c.returnToGarage();
  assert.deepEqual(x.messages.map(message=>message.op),['return']);assert.equal(x.garages.length,0);
  assert.equal(x.f.returnPending,false);assert.equal(x.toasts.length,0);
  x.c.sync();assert.equal(x.active(),x.air);assert.equal(x.calls.bound,1);assert.equal(x.calls.unbound,0);
  assert.equal(x.unit.alive,true,'Returning never changes authoritative aircraft life');
});
test('actual rejected Return retains the accepted aircraft, reports Chinese runway conditions, and permits retry',async()=>{
 const x=fixture(true),before=JSON.stringify(x.unit);x.c.returnToGarage();await x.c.receive({version:1,message:{op:'error',code:'not_at_deployment',message:'Stop on friendly runway before returning'}});x.c.sync();assert.equal(x.active(),x.air);assert.equal(x.f.control,x.unit.unit);assert.equal(x.calls.unbound,0);assert.equal(x.garages.length,0);assert.match(x.notes.at(-1),/己方.*跑道.*停稳/);assert.equal(JSON.stringify(x.unit),before);x.c.returnToGarage();assert.equal(x.messages.length,2);assert.equal(x.f.returnPending,false);
});
test('only actual accepted control null opens the garage through shared notification, without resetting resources',async()=>{
 const x=fixture(true),before=JSON.stringify(x.unit);x.c.returnToGarage();x.c.sync();await x.c.receive({version:1,message:{op:'control',unit:x.unit.unit,epoch:1}});assert.equal(x.garages.length,0);assert.equal(x.calls.unbound,0);await x.c.receive({version:1,message:{op:'control',unit:null,epoch:2}});assert.equal(x.f.control,null);assert.equal(x.active(),null);assert.equal(x.calls.unbound,1);assert.equal(x.garages.length,1);assert.equal(JSON.stringify(x.unit),before);await x.c.receive({version:1,message:{op:'control',unit:null,epoch:2}});assert.equal(x.garages.length,1);assert.equal(x.calls.unbound,1);
});
test('a stale old returnPending flag never suppresses an accepted pilot binding',()=>{const x=fixture(true);x.f.returnPending=true;x.c.sync();assert.equal(x.active(),x.air);assert.equal(x.calls.unbound,0);});
test('duplicate Tab and disconnect after Return cannot strand control; reconnection permits another intent',()=>{const x=fixture(true),before=JSON.stringify(x.unit);x.c.returnToGarage();x.c.returnToGarage();assert.equal(x.messages.length,2);x.net.open=false;x.c.sync();x.c.returnToGarage();assert.equal(x.messages.length,2);assert.equal(x.active(),x.air);assert.equal(x.garages.length,0);assert.equal(x.calls.unbound,0);assert.deepEqual(x.toasts,[['请先连接服务器',3]]);x.net.open=true;x.c.sync();x.c.returnToGarage();assert.equal(x.messages.length,3);assert.equal(x.f.control,x.unit.unit);assert.equal(JSON.stringify(x.unit),before);});
