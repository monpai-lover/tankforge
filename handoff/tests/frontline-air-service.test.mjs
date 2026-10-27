import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';

const source=fs.readFileSync(new URL('../tools/frontline_client.js',import.meta.url),'utf8');
const helpers=source.slice(0,source.indexOf('    // Production client for the versioned native frontline world.'));
const map=JSON.parse(fs.readFileSync(new URL('../../data/frontline/korea.json',import.meta.url),'utf8'));
function unit(){
  const field=map.airfields.find(f=>f.enabled&&f.team===0&&f.runway),r=field.runway,state=Array(80).fill(0);
  state[0]=r.center[0];state[1]=r.height+2;state[2]=r.center[1];state[6]=1;state[27]=.05;state[33]=1;state[35]=2;state[36]=4;state[75]=.1;
  return{unit:{battle:1,unit:4,life:1},aircraft:'mig21',owner:7,alive:true,team:'blue',loadout:2,pos:state.slice(0,3),state,
    damage:{fire:false},guns:[{id:'air_nr30_0',ammo:120}],fuel:{kg:2190,max:2200,total_kg:2190},stores:[{id:'fab250',count:0,gone:true}],
    resource_revision:8,service_revision:0,service:{status:'idle',revision:0,elapsed_s:0,duration_s:15,remaining_s:15,reason:null}};
}
function reader(){const c=vm.createContext({});vm.runInContext(helpers,c);return c.frontlineAirServicePresentation;}

test('service UI checks actual friendly rotated runway/native ground mode and safe controls',()=>{
  const read=reader(),base=unit(),intent={throttle:.05,axes:[0,0,0],fire:false,release:false};
  assert.equal(read(base,map,intent).eligible,true);
  for(const [name,mutate,why] of [
    ['speed',u=>u.state[75]=1.6,'not_stopped'],['airborne',u=>u.state[36]=0,'not_stopped'],
    ['AGL',u=>u.state[35]=3,'not_stopped'],['gear',u=>u.state[33]=.8,'gear_not_down'],
    ['fire',u=>u.damage.fire=true,'aircraft_fire'],['enemy runway',u=>u.team='red','not_friendly_runway'],
    ['outside',u=>u.pos[0]+=10000,'not_friendly_runway'],['lost',u=>u.alive=false,'aircraft_lost']]){
    const u=structuredClone(base);mutate(u);const actual=read(u,map,intent);assert.equal(actual.eligible,false,name);assert.equal(actual.reason,why,name);
  }
  for(const override of [{throttle:.07},{axes:[.1,0,0]},{fire:true},{release:true},{throttle:NaN}])assert.equal(read(base,map,{...intent,...override}).reason,'unsafe_controls');
  const noService=structuredClone(base);delete noService.service;assert.equal(read(noService,map,intent).eligible,false);
});

test('countdown/reason presentation reads only accepted service state and cannot complete work or replenish inventory',()=>{
  const read=reader(),u=unit();u.service={status:'servicing',revision:1,elapsed_s:7.25,duration_s:15,remaining_s:7.75,airfield:'B-E'};
  const before=JSON.stringify(u);for(let i=0;i<100;i++){const view=read(u,map,{throttle:.05});assert.equal(view.status,'servicing');assert.equal(view.elapsed,7.25);assert.equal(view.remaining,7.75);assert.match(view.text,/7\.8/);}
  assert.equal(JSON.stringify(u),before);
  u.service={...u.service,elapsed_s:15,remaining_s:0};assert.equal(read(u,map,{throttle:.05}).status,'servicing','Elapsed time alone cannot invent a native completion');
  u.service={...u.service,status:'cancelled',reason:'new_damage',elapsed_s:0,remaining_s:15};assert.match(read(u,map,{throttle:.05}).text,/新的损伤/);assert.equal(u.guns[0].ammo,120);assert.equal(u.fuel.kg,2190);assert.equal(u.stores[0].gone,true);
});

function transport(){
  const current=unit(),sent=[],notes=[],elements=new Map(),member={player:7,team:'blue',observer:false,air_sorties_remaining:0,air_sortie_eligible:true},f={active:true,seq:100,epoch:6,keys:new Set(['KeyC']),fire:false,aircrafts:[current],control:current.unit,room:{battle_mode:'air_frontline',started:true,round_state:'battle',members:[member]},map,units:[],objectives:[],aircraftOptions:[{id:'mig21',loadouts:[{index:2},{index:3}],slots:[]}]};
  const el=id=>{if(!elements.has(id))elements.set(id,{value:''});return elements.get(id)};
  el('aircraft').value='mig21';el('air-loadout').value='3';el('air-spawn').value='runway';
  const c=vm.createContext({performance,f,net:{id:7,open:true},el,controlled:()=>f.control?current:null,mine:()=>member,ensureMapOptions:async()=>{},ensureMap:async()=>{},clearInput(){},G4:{airLoadout:{mig21:3},airCustom:{}},airLoadouts:()=>[['Guns'],['Bombs'],['Accepted'],['Desired']],
    controlledAirModel:()=>({input:()=>({aim:[0,0,1],throttle:.05,manual_pitch:0,manual_roll:0,manual_yaw:0,flags:5})}),send:m=>sent.push(JSON.parse(JSON.stringify(m))),note:m=>notes.push(m)});
  f.establishedFlight={transmit(){sent.push({op:'air_input',seq:++f.seq,unit:current.unit,epoch:f.epoch});}};
  const a=source.indexOf('      function requestAirService('),b=source.indexOf("      el('service-air').onclick",a);
  const inputA=source.indexOf('      function transmitInput(){'),inputB=source.indexOf('      // Input transport',inputA);
  vm.runInContext(helpers+'\nf.shared=createFrontlineSharedApi({f,net,send,ensureMapOptions,ensureMap,mine,controlled,clearInput,note});\n'+source.slice(a,b)+source.slice(inputA,inputB),c);
  return{c,current,f,el,sent,notes};
}
test('actual service/cancel producers share the air-input sequence and preserve held keys, native flight and stock',()=>{
  const x=transport(),before=JSON.stringify(x.current),keys=x.f.keys;
  x.c.transmitInput();x.c.requestAirService();x.c.requestAirService(true);x.c.transmitInput();
  assert.deepEqual(x.sent.map(m=>m.seq),[101,102,103,104]);assert.deepEqual(x.sent.map(m=>m.op),['air_input','service_air','cancel_air_service','air_input']);
  assert.equal(x.sent[1].loadout,3);assert.equal(x.sent[1].epoch,6);assert.deepEqual(x.sent[1].unit,x.current.unit);assert.ok(!('loadout' in x.sent[2]));
  assert.equal(x.f.keys,keys);assert.ok(keys.has('KeyC'));assert.equal(JSON.stringify(x.current),before);
});

test('shared return/rejoin preserves accepted loadout and selected service target with an explicit warning',()=>{
  const x=transport();x.c.f.shared.returnToDeployment();assert.equal(x.sent.pop().op,'return');x.f.control=null;
  x.c.f.shared.deployAir({aircraft:'mig21',loadout:3,spawn:'runway'});
  assert.equal(x.sent[0].op,'deploy_air');assert.equal(x.sent[0].loadout,2,'Acquire the surviving original configuration');assert.equal(x.el('air-loadout').value,'3','Keep desired service configuration selected');assert.match(x.notes.at(-1),/机场整备/);
  x.f.airDeploymentPending=false;x.f.aircraftOptions.push({id:'f15c',loadouts:[{index:0}]});const count=x.sent.length;assert.throws(()=>x.c.f.shared.deployAir({aircraft:'f15c',loadout:0,spawn:'air'}),/原机仍在场/);assert.equal(x.sent.length,count);
});
test('sequenced gear service presentation requires both accepted native legs locked even when average exceeds ninety percent',()=>{
 const read=reader(),u=unit();u.state[33]=.95;u.aero=Array(48).fill(0);u.aero[36]=1;u.aero[38]=.9;
 assert.equal(read(u,map,{throttle:.05,sequencedGear:true}).reason,'gear_not_down');
 u.aero[38]=1;u.aero[37]=0;u.aero[39]=1;assert.equal(read(u,map,{throttle:.05,sequencedGear:true}).eligible,true,'Open doors do not unlock fully extended legs');
});
