import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {fuelSourceParts} from './fixtures/aircraft-fuel-source-fixture.mjs';
import {patchAircraftFuelLoad} from '../tools/patch_aircraft_fuel_load.mjs';

function policy(){const c=vm.createContext({});vm.runInContext(fuelSourceParts(candidateApp).helper,c);assert.equal(typeof c.TFAircraftFuelLoad,'object','The delivered internal fuel policy is required');return c.TFAircraftFuelLoad;}
const profile=JSON.parse(fs.readFileSync(new URL('../../data/aircraft/frontline.json',import.meta.url),'utf8'));
const originalApp=fs.readFileSync(new URL('../bundle/app.js.html',import.meta.url),'utf8'),fuelContext=vm.createContext({});
const candidateApp=patchAircraftFuelLoad(originalApp);
const originalSection=(a,b)=>{const i=originalApp.indexOf(a),j=originalApp.indexOf(b,i);assert.ok(i>=0&&j>i,a);return originalApp.slice(i,j);};
vm.runInContext(originalSection('/* TF_GUIDED_AIRCRAFT_VARIANTS_BEGIN */','/* TF_GUIDED_AIRCRAFT_VARIANTS_END */')+fuelSourceParts(originalApp).pure,fuelContext);
const sourceIds=new Map(Object.entries(profile.aircraft).map(([id,p])=>[p,id]));
function originalFlow(p,engine){return fuelContext.fuelFlow({type:{id:sourceIds.get(p),airframe:p.physics.airframe},cur:{27:engine}});}

test('only the four fixed minute choices or full are admitted without coercion',()=>{
 const p=policy();for(const n of [10,20,30,45])assert.equal(p.normalize(n),n);assert.equal(p.normalize(null),null);assert.equal(p.normalize(undefined),null);
 for(const bad of [0,5,15,60,-10,10.1,'10','full',true,{},[],NaN,Infinity])assert.throws(()=>p.normalize(bad),/fuel|minute/i);
});
test('all 28 source aircraft select minutes at 100% dry throttle and retain physical capacity',()=>{
 const p=policy();assert.equal(Object.keys(profile.aircraft).length,28);
 for(const [id,a]of Object.entries(profile.aircraft)){
  const sourceFlow=originalFlow(a,1),calls=[],spec=p.spec(a.fuel.capacityKg,engine=>{calls.push(engine);return originalFlow(a,engine);});assert.deepEqual(calls,[1],id);assert.equal(spec.referenceThrottle,1,id);assert.equal(spec.nominalFlowKgS,sourceFlow,id);
  for(const minutes of [10,20,30,45,null]){const load=p.load(spec,minutes);assert.equal(load.max,a.fuel.capacityKg,id);assert.equal(load.kg,minutes===null?spec.capacityKg:Math.min(spec.capacityKg,minutes*60*sourceFlow),id);assert.equal(load.selected_minutes,minutes);}
 }
 assert.throws(()=>p.spec(100,()=>0),/fuel|flow/i);assert.throws(()=>p.spec(NaN,()=>1),/fuel|capacity/i);
});
test('the original live piston, dry jet and afterburner boundary consumption curves stay byte-identical',()=>{
 assert.equal(fuelSourceParts(candidateApp).pure,fuelSourceParts(originalApp).pure);
 let piston=0,dryJet=0,afterburner=0;
 for(const [id,a]of Object.entries(profile.aircraft)){
  const F=a.fuel.sourceTuple,af=a.physics.airframe;
  if(F[3])piston++;else if(F[2])afterburner++;else dryJet++;
  for(const throttle of [0,.05,.65,1,1.005,1.006,1.12,1.15]){
   const eng=Math.max(.05,throttle),dry=F[1]*af[12];
   const expected=F[3]?F[3]*Math.min(1.15,Math.max(.08,eng)):eng>1.005&&F[2]?F[2]*af[12]*(1+(af[13]||0))*Math.min(1,(eng-1)/.12)+dry:dry*Math.min(1,eng);
   assert.equal(originalFlow(a,throttle),expected,id+' throttle '+throttle);
  }
  if(F[2]){assert.equal(originalFlow(a,1),originalFlow(a,1.005),id+' 100% must remain dry');assert.ok(originalFlow(a,1.006)>originalFlow(a,1),id+' AB starts above 1.005');}
 }
 assert.ok(piston>0&&dryJet>0&&afterburner>0,'all three existing engine laws are exercised');
});
test('per-type preference is strict and persisted; old native hosts receive no unknown fuel field',()=>{
 const p=policy(),g={},writes=[],storage={getItem:()=>'{"f86f":20,"p51d":45}',setItem:(key,value)=>writes.push([key,JSON.parse(value)])};p.restore(g,storage);
 assert.equal(p.selected(g,'f86f'),20);assert.equal(p.selected(g,'p51d'),45);assert.equal(p.selected(g,'nf01'),null);p.choose(g,'f86f',10,storage);assert.equal(p.selected(g,'p51d'),45);assert.equal(writes.at(-1)[1].f86f,10);
 for(const cap of [null,{version:1},{version:1,reference_throttle:.65},{version:2,reference_throttle:1}])assert.deepEqual(JSON.parse(JSON.stringify(p.intent(g,'f86f',cap))),{});
 assert.deepEqual(JSON.parse(JSON.stringify(p.intent(g,'f86f',{version:1,reference_throttle:1}))),{fuel_minutes:10});p.choose(g,'f86f',null,storage);assert.deepEqual(JSON.parse(JSON.stringify(p.intent(g,'f86f',{version:1,reference_throttle:1}))),{fuel_minutes:null});
});
test('fresh internal initialization changes kilograms only and does not replenish a retained aircraft or its tanks',()=>{
 const p=policy(),spec=p.spec(730,()=>.065),air={fuel:{kg:80,max:730},stores:{items:[{def:{kind:'tank',fuel:300},fuel:57}]}};
 const before=JSON.stringify(air);p.initialize(air,spec,10,false);assert.equal(JSON.stringify(air),before);
 p.initialize(air,spec,10,true);assert.equal(air.fuel.kg,39);assert.equal(air.fuel.max,730);assert.equal(air.fuel.told,39);assert.equal(air.stores.items[0].fuel,57);
});
test('the control explicitly describes 100% dry-throttle internal fuel in both languages',()=>{
 const p=policy(),g={airFuelMinutes:{p51d:45}},html=p.html(g,'p51d',p.spec(100,()=>.1),true,'en');
 for(const value of ['10','20','30','45','full'])assert.ok(html.includes('value="'+value+'"'));
 assert.match(html,/internal/i);assert.match(html,/100% throttle/i);assert.match(html,/without afterburner/i);assert.doesNotMatch(html,/cruise|65%/i);assert.match(html,/100(?:\.0)? kg/);assert.match(html,/capacity/i);assert.match(html,/external/i);assert.match(html,/data-air-fuel/);
 const zh=p.html(g,'p51d',p.spec(100,()=>.1),true,'zh');assert.match(zh,/100%/);assert.match(zh,/不加力/);assert.doesNotMatch(zh,/65%|巡航/);
 const old=p.html(g,'p51d',p.spec(100,()=>.1),false,'en');assert.match(old,/disabled/);assert.match(old,/full/i);
});
test('full fuel states the actual type-specific reference endurance and a capped choice shows carried endurance',()=>{
 const p=policy(),g={airFuelMinutes:{p51d:45}},source=p.spec(100,()=>.1),html=p.html(g,'p51d',source,true,'en');
 assert.match(html,/>Full \(16\.7 minutes at 100% throttle\)<\/option>/);
 assert.match(html,/Endurance at 100% throttle: 16\.7 minutes/);
 assert.match(p.html(g,'p51d',p.spec(200,()=>.1),true,'en'),/>Full \(33\.3 minutes at 100% throttle\)<\/option>/);
 assert.match(p.html(g,'p51d',source,true,'zh'),/满油（约16\.7分钟，100%节流阀）/);
 assert.equal(p.load(source,null).kg,100);assert.equal(p.load(source,45).kg,100);
});

test('the actual source-bound UI controller uses source 100% flow and new host data without relabelling legacy hosts',()=>{
 const a=profile.aircraft.f86f,game={},handlers={},events=[],storage={getItem:()=>'{}',setItem(){}},types={f86f:{id:'f86f',airframe:a.physics.airframe}};let native=false,option=null;
 game.frontline={shared:{room:()=>native?{}:null,aircraftOptions:()=>option?[option]:[]}};
 const deploy={o:{},visible:true,renderAmmo:()=>events.push('f86f')},parts=fuelSourceParts(candidateApp),c=vm.createContext({G4:game,AIRCRAFT_TYPES:types,localStorage:storage,document:{addEventListener:(name,fn)=>handlers[name]=fn},LANG:'en',airGarage:{on:false},deploy});
 vm.runInContext(parts.helper+originalSection('/* TF_GUIDED_AIRCRAFT_VARIANTS_BEGIN */','/* TF_GUIDED_AIRCRAFT_VARIANTS_END */')+parts.pure+parts.controller,c);
 const p=c.TFAircraftFuelLoad,controller=vm.runInContext('aircraftFuelLoad',c);
 handlers.change({target:{dataset:{airFuel:'f86f'},value:'20'}});assert.equal(p.selected(game,'f86f'),20);assert.deepEqual(events,['f86f']);assert.match(controller.htmlFor('f86f'),/value="20" selected/);
 const air={plane:{type:types.f86f},stores:{items:[]}};controller.initializeAir(air,true);assert.equal(air.fuel.kg,Math.min(a.fuel.capacityKg,1200*originalFlow(a,1)));assert.match(deploy.o.airFuelHtml('f86f'),/100% throttle/);
 native=true;assert.match(controller.htmlFor('f86f'),/disabled/);assert.deepEqual(JSON.parse(JSON.stringify(controller.intentFor('f86f'))),{});
 for(const reference of [.65,undefined]){
  option={id:'f86f',fuel_load:{version:1,reference_throttle:reference,capacity_kg:a.fuel.capacityKg,nominal_flow_kg_s:originalFlow(a,.65)}};
  const html=controller.htmlFor('f86f');assert.match(html,/disabled/);assert.match(html,/update.*server/i);assert.match(html,/local source.*100% throttle/i);assert.match(html,reference===.65?/server.*65% throttle/i:/server.*unknown/i);assert.deepEqual(JSON.parse(JSON.stringify(controller.intentFor('f86f'))),{});
  handlers.change({target:{dataset:{airFuel:'f86f'},value:'45'}});assert.equal(p.selected(game,'f86f'),20,'blocked legacy host must retain the existing preference');
 }
 option={id:'f86f',fuel_load:{version:1,reference_throttle:1,capacity_kg:600,nominal_flow_kg_s:.4}};assert.match(controller.htmlFor('f86f'),/value="20" selected/);assert.match(controller.htmlFor('f86f'),/480 kg/);assert.match(controller.htmlFor('f86f'),/>Full \(25\.0 minutes at 100% throttle\)/);assert.deepEqual(JSON.parse(JSON.stringify(controller.intentFor('f86f'))),{fuel_minutes:20});
 const before=JSON.stringify(air);controller.initializeAir(air,false);assert.equal(JSON.stringify(air),before);
});

function sharedFuel(capability={version:1,reference_throttle:1}){
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
 for(const capability of [null,{version:1,reference_throttle:.65},{version:1}]){const old=sharedFuel(capability);old.api.deployAir({aircraft:'f86f',loadout:0,spawn:'air'});assert.equal(Object.hasOwn(old.sent.at(-1),'fuel_minutes'),false);}
});

const patcherURL=new URL('../tools/patch_aircraft_fuel_load.mjs',import.meta.url),appURL=new URL('../bundle/app.js.html',import.meta.url);
async function candidate(){assert.ok(fs.existsSync(patcherURL),'The candidate-only fuel integration patcher is required');return (await import(patcherURL)).patchAircraftFuelLoad(fs.readFileSync(appURL,'utf8'));}
test('fuel integration patches only an in-memory candidate, is idempotent and keeps actual original DeployScreen controls',async()=>{
 const original=fs.readFileSync(appURL,'utf8'),source=await candidate(),patch=(await import(patcherURL)).patchAircraftFuelLoad;assert.equal(fuelSourceParts(source).helper,fs.readFileSync(new URL('../tools/aircraft_fuel_load.js',import.meta.url),'utf8').trimEnd());assert.equal(patch(source),source);assert.equal(fs.readFileSync(appURL,'utf8'),original);new vm.Script(source.slice(source.indexOf('<script>')+8,source.lastIndexOf('</script>')));
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

test('the marker-only helper upgrade is guarded, idempotent and changes no runtime fuel source or UI hooks',async()=>{
 const {patchAircraftFuelLoadHelper:patch}=await import(patcherURL);assert.equal(typeof patch,'function','ROOT requires the guarded helper-only integration API');
 for(const eol of ['\n','\r\n']){
  const input=originalApp.replaceAll('\r\n','\n').replaceAll('\n',eol),output=patch(input),helper=fuelSourceParts(output).helper;
  assert.equal(patch(output),output);assert.equal(helper,fs.readFileSync(new URL('../tools/aircraft_fuel_load.js',import.meta.url),'utf8').trimEnd().replaceAll('\r\n','\n').replaceAll('\n',eol));
  assert.equal(output.replace(helper,''),input.replace(fuelSourceParts(input).helper,''),'only the helper boundary may change');
 }
 const begin='/* TF_AIRCRAFT_FUEL_LOAD_BEGIN */',end='/* TF_AIRCRAFT_FUEL_LOAD_END */';
 for(const bad of [originalApp.replace(begin,''),originalApp.replace(end,''),originalApp+begin,originalApp+end,end+begin])assert.throws(()=>patch(bad),/one|complete|order|boundary/i);
 assert.equal(fs.readFileSync(appURL,'utf8'),originalApp);
});

const bytes=fs.readFileSync(new URL('../flight/flight_core.wasm',import.meta.url));
async function plant(a,mass,bank=0){const {instance}=await WebAssembly.instantiate(bytes,{math:{sin:Math.sin,cos:Math.cos,atan2:Math.atan2,exp:Math.exp,asin:Math.asin,acos:Math.acos},world:{ground:()=>0,landable:()=>1}}),api=instance.exports,af=a.physics.airframe.slice();af[0]=mass;api.set_world(1);api.configure_airframe(...af);if(a.physics.surfaces)api.configure_surfaces(...a.physics.surfaces);api.configure_control(...a.physics.control);api.configure(...a.physics.configure);api.configure_envelope(...a.physics.envelope);api.spawn(0,3000,0,0,150,0);if(bank)assert.equal(api.adopt_kinematics(0,3000,0,0,0,Math.sin(bank/2),Math.cos(bank/2),0,0,150,0,0,0),1);return{api,s:new Float32Array(api.memory.buffer,api.state_ptr(),80)};}
test('real shared C215 plant responds to the selected physical mass during acceleration and a banked turn',async()=>{
 const p=policy(),a=profile.aircraft.f86f,spec=p.spec(a.fuel.capacityKg,e=>originalFlow(a,e)),selected=p.load(spec,10),fullMass=a.physics.airframe[0],lightMass=fullMass-(spec.capacityKg-selected.kg);assert.ok(lightMass<fullMass);
 const full=await plant(a,fullMass),light=await plant(a,lightMass);for(let i=0;i<120;i++){full.api.step(1/120,0,0,1,1,0,0,0,0);light.api.step(1/120,0,0,1,1,0,0,0,0);}assert.ok(light.s[13]>full.s[13],'actual thrust accelerates the reduced mass faster');
 const heavyTurn=await plant(a,fullMass,Math.PI/4),lightTurn=await plant(a,lightMass,Math.PI/4);for(let i=0;i<240;i++){heavyTurn.api.step(1/120,0,0,1,.65,.45,0,0,0);lightTurn.api.step(1/120,0,0,1,.65,.45,0,0,0,0);}assert.ok(Math.abs(lightTurn.s[0])>Math.abs(heavyTurn.s[0]),'actual lateral lift bends the lighter flight path further');
});
