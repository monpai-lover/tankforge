import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {fuelSourceParts} from './fixtures/aircraft-fuel-source-fixture.mjs';

function policy(){const c=vm.createContext({});vm.runInContext(fuelSourceParts(originalApp).helper,c);assert.equal(typeof c.TFAircraftFuelLoad,'object','The delivered internal fuel policy is required');return c.TFAircraftFuelLoad;}
const profile=JSON.parse(fs.readFileSync(new URL('../../data/aircraft/frontline.json',import.meta.url),'utf8'));
const originalApp=fs.readFileSync(new URL('../bundle/app.js.html',import.meta.url),'utf8'),fuelContext=vm.createContext({});
const originalSection=(a,b)=>{const i=originalApp.indexOf(a),j=originalApp.indexOf(b,i);assert.ok(i>=0&&j>i,a);return originalApp.slice(i,j);};
vm.runInContext(originalSection('/* TF_GUIDED_AIRCRAFT_VARIANTS_BEGIN */','/* TF_GUIDED_AIRCRAFT_VARIANTS_END */')+fuelSourceParts(originalApp).pure,fuelContext);
const sourceIds=new Map(Object.entries(profile.aircraft).map(([id,p])=>[p,id]));
function originalFlow(p,engine){return fuelContext.fuelFlow({type:{id:sourceIds.get(p),airframe:p.physics.airframe},cur:{27:engine}});}

test('only the four fixed minute choices or full are admitted without coercion',()=>{
 const p=policy();for(const n of [10,20,30,45])assert.equal(p.normalize(n),n);assert.equal(p.normalize(null),null);assert.equal(p.normalize(undefined),null);
 for(const bad of [0,5,15,60,-10,10.1,'10','full',true,{},[],NaN,Infinity])assert.throws(()=>p.normalize(bad),/fuel|minute/i);
});
test('all 28 source aircraft use their actual existing nominal cruise flow and retain physical capacity',()=>{
 const p=policy();assert.equal(Object.keys(profile.aircraft).length,28);
 for(const [id,a]of Object.entries(profile.aircraft)){
  const sourceFlow=originalFlow(a,.65),spec=p.spec(a.fuel.capacityKg,engine=>originalFlow(a,engine));assert.equal(spec.nominalFlowKgS,sourceFlow,id);
  for(const minutes of [10,20,30,45,null]){const load=p.load(spec,minutes);assert.equal(load.max,a.fuel.capacityKg,id);assert.equal(load.kg,minutes===null?spec.capacityKg:Math.min(spec.capacityKg,minutes*60*sourceFlow),id);assert.equal(load.selected_minutes,minutes);}
 }
 assert.throws(()=>p.spec(100,()=>0),/fuel|flow/i);assert.throws(()=>p.spec(NaN,()=>1),/fuel|capacity/i);
});
test('per-type preference is strict and persisted; old native hosts receive no unknown fuel field',()=>{
 const p=policy(),g={},writes=[],storage={getItem:()=>'{"f86f":20,"p51d":45}',setItem:(key,value)=>writes.push([key,JSON.parse(value)])};p.restore(g,storage);
 assert.equal(p.selected(g,'f86f'),20);assert.equal(p.selected(g,'p51d'),45);assert.equal(p.selected(g,'nf01'),null);p.choose(g,'f86f',10,storage);assert.equal(p.selected(g,'p51d'),45);assert.equal(writes.at(-1)[1].f86f,10);
 assert.deepEqual(JSON.parse(JSON.stringify(p.intent(g,'f86f',null))),{});assert.deepEqual(JSON.parse(JSON.stringify(p.intent(g,'f86f',{version:1}))),{fuel_minutes:10});p.choose(g,'f86f',null,storage);assert.deepEqual(JSON.parse(JSON.stringify(p.intent(g,'f86f',{version:1}))),{fuel_minutes:null});
});
test('fresh internal initialization changes kilograms only and does not replenish a retained aircraft or its tanks',()=>{
 const p=policy(),spec=p.spec(730,()=>.065),air={fuel:{kg:80,max:730},stores:{items:[{def:{kind:'tank',fuel:300},fuel:57}]}};
 const before=JSON.stringify(air);p.initialize(air,spec,10,false);assert.equal(JSON.stringify(air),before);
 p.initialize(air,spec,10,true);assert.equal(air.fuel.kg,39);assert.equal(air.fuel.max,730);assert.equal(air.fuel.told,39);assert.equal(air.stores.items[0].fuel,57);
});
test('the control describes internal cruise fuel, kilograms, capacity clamp and unchanged external tanks',()=>{
 const p=policy(),g={airFuelMinutes:{p51d:45}},html=p.html(g,'p51d',p.spec(100,()=>.1),true,'en');
 for(const value of ['10','20','30','45','full'])assert.ok(html.includes('value="'+value+'"'));
 assert.match(html,/internal/i);assert.match(html,/cruise/i);assert.match(html,/100(?:\.0)? kg/);assert.match(html,/capacity/i);assert.match(html,/external/i);assert.match(html,/data-air-fuel/);
 const old=p.html(g,'p51d',p.spec(100,()=>.1),false,'en');assert.match(old,/disabled/);assert.match(old,/full/i);
});
test('full fuel states the actual type-specific reference endurance and a capped choice shows carried endurance',()=>{
 const p=policy(),g={airFuelMinutes:{p51d:45}},source=p.spec(100,()=>.1),html=p.html(g,'p51d',source,true,'en');
 assert.match(html,/>Full \(16\.7 minutes\)<\/option>/);
 assert.match(html,/Estimated endurance: 16\.7 minutes/);
 assert.match(p.html(g,'p51d',p.spec(200,()=>.1),true,'en'),/>Full \(33\.3 minutes\)<\/option>/);
 assert.equal(p.load(source,null).kg,100);assert.equal(p.load(source,45).kg,100);
});

test('the actual source-bound control controller shares hangar/deployment preference and native capability',()=>{
 const p=policy();assert.equal(typeof p.create,'function','The actual surface controller is required');
 const a=profile.aircraft.f86f,game={},handlers={},events=[],storage={getItem:()=>null,setItem(){}},types={f86f:{id:'f86f',airframe:a.physics.airframe}};let native=false,option=null;
 const controller=p.create({game,types,tuples:{f86f:a.fuel.sourceTuple},flow:P=>originalFlow(a,P.cur[27]),storage,document:{addEventListener:(name,fn)=>handlers[name]=fn},native:()=>native,nativeOption:()=>option,onChange:id=>events.push(id),language:()=> 'en'});
 handlers.change({target:{dataset:{airFuel:'f86f'},value:'20'}});assert.equal(p.selected(game,'f86f'),20);assert.deepEqual(events,['f86f']);assert.match(controller.htmlFor('f86f'),/value="20" selected/);
 const air={plane:{type:types.f86f},stores:{items:[]}};controller.initializeAir(air,true);assert.equal(air.fuel.kg,Math.min(a.fuel.capacityKg,1200*originalFlow(a,.65)));
 native=true;assert.match(controller.htmlFor('f86f'),/disabled/);assert.deepEqual(JSON.parse(JSON.stringify(controller.intentFor('f86f'))),{});
 option={fuel_load:{version:1,capacity_kg:a.fuel.capacityKg,nominal_flow_kg_s:originalFlow(a,.65)}};assert.match(controller.htmlFor('f86f'),/value="20" selected/);assert.deepEqual(JSON.parse(JSON.stringify(controller.intentFor('f86f'))),{fuel_minutes:20});
 const before=JSON.stringify(air);controller.initializeAir(air,false);assert.equal(JSON.stringify(air),before);
});

function sharedFuel(capability={version:1}){
 const p=policy(),sent=[],member={player:7,team:'blue',observer:false,air_sorties_remaining:1,air_sortie_eligible:true},game={airFuelMinutes:{f86f:20}};
 const f={room:{id:2,battle:4,battle_mode:'air_frontline',started:true,round_state:'battle',members:[member]},aircrafts:[],units:[],objectives:[],map:{id:'korea',terrain:{x0:-100,z0:-100,width:3,height:3,cellX:100,cellZ:100},airspawns:[{enabled:true,team:0,pos:[0,2000,0],yawRad:0}],airfields:[]},aircraftOptions:[{id:'f86f',loadouts:[{index:0,name:'Guns'}],fuel_load:capability}]};
 const client=fs.readFileSync(new URL('../tools/frontline_client.js',import.meta.url),'utf8'),code=client.slice(0,client.indexOf('    // Production client for the versioned native frontline world.')),c=vm.createContext({});vm.runInContext(code,c);
 const api=c.createFrontlineSharedApi({f,net:{id:7,open:true},send:v=>sent.push(JSON.parse(JSON.stringify(v))),ensureMapOptions:async()=>{},ensureMap:async()=>{},mine:()=>member,controlled:()=>f.aircrafts.find(u=>u.controller===7)||null,clearInput(){},note(){},fuelPolicy:p,fuelIntent:id=>p.intent(game,id,capability)});
 return{f,api,sent,game};
}
test('actual native shared API sends selected fuel for fresh launch/service but drops it for retained aircraft',()=>{
 const x=sharedFuel();x.api.deployAir({aircraft:'f86f',loadout:0,spawn:'air'});assert.equal(x.sent.at(-1).fuel_minutes,20);
 x.f.airDeploymentPending=false;const unit={unit:{battle:4,unit:9,life:1},aircraft:'f86f',pos:[0,1000,0],owner:7,controller:7,alive:true,loadout:0,fuel:{kg:77,max:1300,selected_minutes:10},stores:[]};x.f.aircrafts=[unit];x.f.epoch=1;x.f.seq=0;
 x.api.serviceAir({loadout:0});assert.equal(x.sent.at(-1).fuel_minutes,20);assert.equal(x.sent.at(-1).op,'service_air');
 assert.throws(()=>x.api.serviceAir({loadout:0,fuel_minutes:99}),/fuel|minute/i);unit.controller=null;const before=JSON.stringify(unit);x.game.airFuelMinutes.f86f=45;x.api.deployAir({aircraft:'f86f',loadout:0,spawn:'air'});assert.equal(Object.hasOwn(x.sent.at(-1),'fuel_minutes'),false);assert.equal(JSON.stringify(unit),before);
 const old=sharedFuel(null);old.api.deployAir({aircraft:'f86f',loadout:0,spawn:'air'});assert.equal(Object.hasOwn(old.sent.at(-1),'fuel_minutes'),false);
});

const patcherURL=new URL('../tools/patch_aircraft_fuel_load.mjs',import.meta.url),appURL=new URL('../bundle/app.js.html',import.meta.url);
async function candidate(){assert.ok(fs.existsSync(patcherURL),'The candidate-only fuel integration patcher is required');return (await import(patcherURL)).patchAircraftFuelLoad(fs.readFileSync(appURL,'utf8'));}
test('fuel integration patches only an in-memory candidate, is idempotent and keeps actual original DeployScreen controls',async()=>{
 const original=fs.readFileSync(appURL,'utf8'),source=await candidate(),patch=(await import(patcherURL)).patchAircraftFuelLoad;if(original.includes('/* TF_AIRCRAFT_FUEL_LOAD_BEGIN */'))assert.equal(source,original,'The integrated application is already fuel-patched');else assert.notEqual(source,original);assert.equal(patch(source),source);assert.equal(fs.readFileSync(appURL,'utf8'),original);new vm.Script(source.slice(source.indexOf('<script>')+8,source.lastIndexOf('</script>')));
 assert.equal(source.split('/* TF_AIRCRAFT_FUEL_LOAD_BEGIN */').length,2);assert.match(source,/aircraftFuelLoad\.initializeAir\(air, true\)/);assert.match(source,/airLoadoutHtml\(id2\) \+ aircraftFuelLoad\.htmlFor\(id2\)/);
 const begin=source.indexOf('  var DeployScreen = class {'),end=source.indexOf('\n  // client/web/',begin+1),c=vm.createContext({esc:String});vm.runInContext(source.slice(begin,end),c);const area={innerHTML:''},d=Object.create(c.DeployScreen.prototype);d.vehicle='air:f86f';d.airLo=0;d.el={querySelector:()=>area};d.o={lineup:()=>[],airLineup:()=>[{id:'air:f86f',name:'F86'}],sp:()=>0,airLoadouts:()=>[{index:0,name:'Guns',online:true,cost:0}],airFuelHtml:()=>policy().html({airFuelMinutes:{f86f:20}},'f86f',policy().spec(1300,()=>.5),true,'en')};d.renderAmmo();assert.match(area.innerHTML,/data-air-fuel="f86f"/);assert.match(area.innerHTML,/value="20" selected/);
});

test('candidate CLI refuses canonical, same-path and existing targets without modifying input bytes',()=>{
 const root=path.resolve(process.env.TF_TEST_ARTIFACT_DIR||os.tmpdir());fs.mkdirSync(root,{recursive:true});const dir=fs.mkdtempSync(path.join(root,'air-fuel-cli-')),input=path.join(dir,'source.html'),output=path.join(dir,'candidate.html');fs.writeFileSync(input,originalApp);
 for(const target of [input,fileURLToPath(appURL)]){const result=spawnSync(process.execPath,[fileURLToPath(patcherURL),'--input',input,'--output',target],{encoding:'utf8'});assert.notEqual(result.status,0);assert.match(result.stderr,/Refus|ROOT owns/);}
 const first=spawnSync(process.execPath,[fileURLToPath(patcherURL),'--input',input,'--output',output],{encoding:'utf8'});assert.equal(first.status,0,first.stderr);const saved=fs.readFileSync(output,'utf8');const repeat=spawnSync(process.execPath,[fileURLToPath(patcherURL),'--input',input,'--output',output],{encoding:'utf8'});assert.notEqual(repeat.status,0);assert.equal(fs.readFileSync(output,'utf8'),saved);assert.equal(fs.readFileSync(input,'utf8'),originalApp);assert.equal(fs.readFileSync(appURL,'utf8'),originalApp);
});

test('source helper patching preserves both original LF and CRLF line endings',async()=>{
 const patch=await import(patcherURL);
 for(const [file,apply]of [['frontline_client.js',patch.patchFrontlineFuelClient],['frontline_shared_lobby.js',patch.patchFrontlineFuelLobby]]){
  const source=fs.readFileSync(new URL('../tools/'+file,import.meta.url),'utf8').replaceAll('\r\n','\n');
  for(const input of [source,source.replaceAll('\n','\r\n')])assert.equal(apply(input),input,file+' remains byte-identical after repeated patching');
 }
});

const bytes=fs.readFileSync(new URL('../flight/flight_core.wasm',import.meta.url));
async function plant(a,mass,bank=0){const {instance}=await WebAssembly.instantiate(bytes,{math:{sin:Math.sin,cos:Math.cos,atan2:Math.atan2,exp:Math.exp,asin:Math.asin,acos:Math.acos},world:{ground:()=>0,landable:()=>1}}),api=instance.exports,af=a.physics.airframe.slice();af[0]=mass;api.set_world(1);api.configure_airframe(...af);if(a.physics.surfaces)api.configure_surfaces(...a.physics.surfaces);api.configure_control(...a.physics.control);api.configure(...a.physics.configure);api.configure_envelope(...a.physics.envelope);api.spawn(0,3000,0,0,150,0);if(bank)assert.equal(api.adopt_kinematics(0,3000,0,0,0,Math.sin(bank/2),Math.cos(bank/2),0,0,150,0,0,0),1);return{api,s:new Float32Array(api.memory.buffer,api.state_ptr(),80)};}
test('real shared C215 plant responds to the selected physical mass during acceleration and a banked turn',async()=>{
 const p=policy(),a=profile.aircraft.f86f,spec=p.spec(a.fuel.capacityKg,e=>originalFlow(a,e)),selected=p.load(spec,10),fullMass=a.physics.airframe[0],lightMass=fullMass-(spec.capacityKg-selected.kg);assert.ok(lightMass<fullMass);
 const full=await plant(a,fullMass),light=await plant(a,lightMass);for(let i=0;i<120;i++){full.api.step(1/120,0,0,1,1,0,0,0,0);light.api.step(1/120,0,0,1,1,0,0,0,0);}assert.ok(light.s[13]>full.s[13],'actual thrust accelerates the reduced mass faster');
 const heavyTurn=await plant(a,fullMass,Math.PI/4),lightTurn=await plant(a,lightMass,Math.PI/4);for(let i=0;i<240;i++){heavyTurn.api.step(1/120,0,0,1,.65,.45,0,0,0);lightTurn.api.step(1/120,0,0,1,.65,.45,0,0,0,0);}assert.ok(Math.abs(lightTurn.s[0])>Math.abs(heavyTurn.s[0]),'actual lateral lift bends the lighter flight path further');
});
