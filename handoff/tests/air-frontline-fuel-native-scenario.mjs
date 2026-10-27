// CLI integration against an actual tg-server. No fabricated server frames,
// test-only native hooks, browser, flight stepping, or replacement NetClient.
// node handoff/tests/air-frontline-native-scenario.mjs ws://127.0.0.1:18788/ws output.json [korea|taiwan]
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';

const [url,output,mapId='korea']=process.argv.slice(2);
if(!url||!output||!['korea','taiwan'].includes(mapId))throw Error('Expected ws URL, output JSON, optional korea|taiwan');
const app=fs.readFileSync(new URL('../bundle/app.js.html',import.meta.url),'utf8');
const client=fs.readFileSync(new URL('../tools/frontline_client.js',import.meta.url),'utf8');
const wire=fs.readFileSync(new URL('../tools/frontline_wire.js',import.meta.url),'utf8');
const section=(start,end)=>{const a=app.indexOf(start),b=app.indexOf(end,a);assert.ok(a>=0&&b>a,start);return app.slice(a,b);};
const netSource=section('  // client/web/src/game/net.js','  // client/web/src/game/lobbyui.js');
const replaySource=section('  // client/web/src/game/replayEvidence.js','  // client/web/src/game/replaySession.js');
const sharedSource=client.slice(0,client.indexOf('    // Production client for the versioned native frontline world.'));
const plain=value=>JSON.parse(JSON.stringify(value));
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
const key=ref=>ref?`${ref.battle}:${ref.unit}:${ref.life}`:'';
const started=performance.now(),timeline=[],peers=[],limitations=[],checks={};
const scenarioId=`${mapId}-${process.pid}-${Date.now().toString(36)}`;
const serverExe=process.env.TANKFORGE_NATIVE_SERVER_EXE;
const serverExeSha256=serverExe?digest(fs.readFileSync(serverExe)):null;
const record=(action,details={})=>timeline.push({atSeconds:(performance.now()-started)/1000,action,...plain(details)});
let registry,maps,failure=null,heartbeat;

class Peer{
 constructor(name){
  this.name=name;this.serial=0;this.messages=[];this.listeners=new Set();this.events=[];this.errors=[];this.wireErrors=[];this.controls=[];
  this.f={room:null,rooms:[],aircraftOptions:[],units:[],aircrafts:[],objectives:[],keys:new Set(),epoch:0,seq:0,control:null};
  const context=vm.createContext({console,ArrayBuffer,Uint8Array,DataView,TextDecoder,WebSocket,BigInt,performance,setTimeout,clearTimeout,setInterval,clearInterval,structuredClone,
   ammo_resupply_default:{ammo_protocol_version:1},GAMEPLAY_RULES_VERSION:2});
  vm.runInContext(fs.readFileSync(new URL('../tools/aircraft_fuel_load.js',import.meta.url),'utf8')+wire+replaySource+netSource+sharedSource,context);
  this.net=new context.NetClient();this.context=context;
  const me=()=>this.f.room?.members.find(member=>member.player===this.net.id),controlled=()=>this.f.aircrafts.find(unit=>key(unit.unit)===key(this.f.control));
  this.api=context.createFrontlineSharedApi({f:this.f,net:this.net,send:command=>this.send(command),ensureMapOptions:async()=>{this.f.availableMaps=registry.maps;},ensureMap:async()=>this.f.map,mine:me,controlled,
   fuelPolicy:context.TFAircraftFuelLoad,clearInput:()=>{},note:message=>record(name+':notice',{message})});
  this.net.on('frontline',envelope=>this.receive(envelope.message));
  this.net.on('frontline_wire_error',error=>this.wireErrors.push(plain(error)));
  this.net.on('error',error=>this.errors.push(plain(error)));
  this.net.on('closed',()=>record(name+':closed'));
  peers.push(this);
 }
 async connect(){const welcome=await this.net.connect(url,this.name);assert.equal(this.net.frontlineWire.version,2);assert.equal(welcome.gameplay_rules_version,2);assert.equal(welcome.ammo_protocol_version,1);record(this.name+':connected',{player:welcome.id,wire:this.net.frontlineWire.version});this.f.availableMaps=registry.maps;return welcome;}
 send(command){this.net.send({t:'frontline',version:1,command});}
 receive(message){
  const f=this.f;this.messages.push({serial:++this.serial,message});if(this.messages.length>600)this.messages.shift();
  if(message.op==='room'||message.op==='snapshot'){f.room=message.room;f.map=maps.get(f.room.map);this.net.frontlineRoom={...f.room,playing:f.room.started};const member=f.room.members.find(member=>member.player===this.net.id);if(member){if(key(f.control)!==key(member.controlled)||f.epoch!==member.epoch)f.seq=0;f.control=member.controlled;f.epoch=member.epoch;}}
  if(message.op==='rooms')f.rooms=message.rooms;
  if(message.op==='snapshot'||message.op==='frame'){
   f.units=message.units;f.aircrafts=message.aircrafts||[];f.objectives=message.objectives;f.lastTick=message.tick;
   if(message.aircraft_options)f.aircraftOptions=message.aircraft_options;
   if(message.team_score)f.room.team_score=message.team_score;if(message.scoreboard)f.room.scoreboard=message.scoreboard;
   this.context.frontlineAcceptScoreEvents(f.room,message.events);
   this.events.push(...(message.events||[]));if(this.events.length>4000)this.events.splice(0,this.events.length-4000);
   this.lastFrame=message;
  }
  if(message.op==='control'){f.airDeploymentPending=false;if(key(f.control)!==key(message.unit)||f.epoch!==message.epoch)f.seq=0;f.control=message.unit;f.epoch=message.epoch;this.controls.push(plain(message));const member=this.api.self();if(member){member.controlled=message.unit;member.epoch=message.epoch;}}
  if(message.op==='error'){f.airDeploymentPending=false;this.errors.push(plain(message));record(this.name+':native-rejection',{code:message.code,message:message.message});}
  if(message.op==='ended'){this.ended=plain(message);record(this.name+':ended',message);}
  for(const notify of [...this.listeners])notify();
 }
 wait(op,predicate=()=>true,timeout=12000,after=0){
  return new Promise((resolve,reject)=>{
   const inspect=()=>{const found=this.messages.find(entry=>entry.serial>after&&entry.message.op===op&&predicate(entry.message));if(found){clearTimeout(timer);this.listeners.delete(inspect);resolve(found.message);}};
   const timer=setTimeout(()=>{this.listeners.delete(inspect);reject(Error(`${this.name} timeout ${op}; tick ${this.f.lastTick}, control ${key(this.f.control)}, errors ${JSON.stringify(this.errors.slice(-2))}`));},timeout);this.listeners.add(inspect);inspect();
  });
 }
 request(command,op,predicate,timeout){const after=this.serial;this.send(command);return this.wait(op,predicate,timeout,after);}
 via(fn,op,predicate,timeout){const after=this.serial;fn();return this.wait(op,predicate,timeout,after);}
 current(){return this.api.controlled();}
 input({fire=false,release=false,throttle=0,manual_pitch=0,manual_roll=0,manual_yaw=0,flags=5,aim}={}){const unit=this.current();if(!unit)return;const desired=aim||[unit.state[48],unit.state[49],unit.state[50]],length=Math.hypot(...desired)||1;this.send({op:'air_input',unit:unit.unit,epoch:this.f.epoch,seq:++this.f.seq,aim:desired.map(value=>value/length),throttle,manual_pitch,manual_roll,manual_yaw,flags,fire,release});}
 async deploy(options){const after=this.serial;this.api.deployAir(options);const snapshot=await this.wait('snapshot',message=>message.room.members.some(member=>member.player===this.net.id&&member.controlled),20000,after);await this.wait('control',message=>!!message.unit,12000,after);return snapshot.aircrafts.find(unit=>unit.owner===this.net.id&&key(unit.unit)===key(this.f.control));}
 close(){this.api.dispose();this.net.close();}
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function fetchRegistry(){const response=await fetch(new URL('/frontline/maps.json',url.replace(/^ws/,'http')),{signal:AbortSignal.timeout(10000)});assert.equal(response.status,200);const text=await response.text();registry=JSON.parse(text);assert.deepEqual(registry.maps.map(map=>map.id).sort(),['korea','taiwan']);maps=new Map();for(const item of registry.maps){assert.equal(item.path,`/frontline/${item.id}.json`);const response=await fetch(new URL(item.path,url.replace(/^ws/,'http')),{signal:AbortSignal.timeout(10000)});assert.equal(response.status,200);const bytes=Buffer.from(await response.arrayBuffer());assert.equal(digest(bytes),item.sha256);const local=fs.readFileSync(new URL(`../../data/frontline/${item.id}.json`,import.meta.url));assert.equal(digest(local),item.sha256);maps.set(item.id,JSON.parse(bytes));}checks.http_maps={passed:true,maps:registry.maps.map(({id,sha256})=>({id,sha256}))};}
try{
 await fetchRegistry();
 const blue=new Peer(`fuel-blue-${scenarioId}`),red=new Peer(`fuel-red-${scenarioId}`),observer=new Peer(`fuel-observer-${scenarioId}`);
 await Promise.all([blue.connect(),red.connect(),observer.connect()]);
 const created=await blue.via(()=>blue.api.create({map:mapId,era:2022,name:`Fuel native ${scenarioId}`,observer:false}),'snapshot');const room=created.room.id;
 for(const [peer,watch]of [[red,false],[observer,true]]){await peer.via(()=>peer.api.list(),'rooms');await peer.via(()=>peer.api.join({room,observer:watch}),'snapshot');}
 await blue.via(()=>blue.api.start(),'snapshot',m=>m.room.started,20000);await Promise.all([red.wait('snapshot',m=>m.room.started),observer.wait('snapshot',m=>m.room.started)]);
 const option=blue.f.aircraftOptions.find(x=>x.id==='me262');assert.ok(option?.fuel_load);assert.deepEqual(plain(option.fuel_load.minutes),[10,20,30,45]);
 const target=n=>Math.min(option.fuel_load.capacity_kg,n*60*option.fuel_load.nominal_flow_kg_s);
 const enemy=await red.deploy({aircraft:'p51d',loadout:0,custom:{},fuel_minutes:20,spawn:'air'});
 const initial=await blue.deploy({aircraft:'me262',loadout:0,custom:{},fuel_minutes:10,spawn:'runway'});assert.equal(initial.fuel.selected_minutes,10);assert.ok(Math.abs(initial.fuel.kg-target(10))<1e-6);
 const profile=JSON.parse(fs.readFileSync(new URL('../../data/aircraft/frontline.json',import.meta.url),'utf8')).aircraft.me262;
 assert.ok(Math.abs(initial.flight.airframe[0]-(profile.physics.airframe[0]-option.fuel_load.capacity_kg+target(10)))<.01);
 checks.actual_selected_launch={passed:true,unit:initial.unit,fuel:initial.fuel,loadedMass:initial.flight.airframe[0],fullMass:profile.physics.airframe[0]};
 heartbeat=setInterval(()=>{blue.input({throttle:0,flags:5});red.input({throttle:.65,flags:1});},50);
 await blue.via(()=>blue.api.returnToDeployment(),'control',m=>m.unit===null);
 const retained=await blue.deploy({aircraft:'me262',loadout:0,custom:{},fuel_minutes:45,spawn:'runway'});assert.equal(key(retained.unit),key(initial.unit));assert.equal(retained.fuel.selected_minutes,10);assert.ok(Math.abs(retained.fuel.kg-initial.fuel.kg)<1e-6);
 checks.reclaim_preserves_stock={passed:true,unit:retained.unit,fuel:retained.fuel,ignoredRequestedMinutes:45};
 const serial=blue.serial;blue.api.serviceAir({loadout:0,custom:{},fuel_minutes:20});
 const working=await blue.wait('frame',m=>m.aircrafts.some(a=>key(a.unit)===key(initial.unit)&&a.service?.status==='servicing'),12000,serial);
 const pending=working.aircrafts.find(a=>key(a.unit)===key(initial.unit));assert.equal(pending.service.fuel_minutes,20);assert.equal(pending.fuel.selected_minutes,10);assert.ok(Math.abs(pending.fuel.kg-target(10))<1e-6);
 const finished=await blue.wait('frame',m=>m.aircrafts.some(a=>key(a.unit)===key(initial.unit)&&a.service?.status==='complete'),90000,serial);
 const serviced=finished.aircrafts.find(a=>key(a.unit)===key(initial.unit));assert.equal(serviced.fuel.selected_minutes,20);assert.ok(Math.abs(serviced.fuel.kg-target(20))<1e-6);assert.equal(serviced.service.duration_s,15);assert.ok(serviced.service.elapsed_s>=15);
 assert.ok(Math.abs(serviced.flight.airframe[0]-(profile.physics.airframe[0]-option.fuel_load.capacity_kg+target(20)))<.01);
 checks.actual_native_fuel_service={passed:true,before:pending.fuel,after:serviced.fuel,duration_s:serviced.service.duration_s,elapsed_s:serviced.service.elapsed_s,loadedMass:serviced.flight.airframe[0]};
 const cancelStart=blue.serial;blue.api.serviceAir({loadout:0,custom:{},fuel_minutes:45});await blue.wait('frame',m=>m.aircrafts.some(a=>key(a.unit)===key(initial.unit)&&a.service?.status==='servicing'),12000,cancelStart);
 const beforeCancel=blue.serial;blue.api.serviceAir({cancel:true});const cancelled=await blue.wait('frame',m=>m.aircrafts.some(a=>key(a.unit)===key(initial.unit)&&a.service?.status==='cancelled'),12000,beforeCancel);const same=cancelled.aircrafts.find(a=>key(a.unit)===key(initial.unit));assert.equal(same.fuel.selected_minutes,20);assert.ok(Math.abs(same.fuel.kg-target(20))<1e-6);
 checks.cancel_no_grant={passed:true,fuel:same.fuel,status:same.service.status};
 assert.ok(peers.every(p=>p.errors.length===0&&p.wireErrors.length===0));checks.wire2={passed:true,peers:peers.map(p=>({name:p.name,...plain(p.net.frontlineWire)}))};
 limitations.push('Actual Windows native process and shipped NetClient; no browser GUI or Linux execution.');record('scenario-complete');
}catch(error){failure=String(error.stack||error);record('scenario-failed',{error:failure});}
finally{
 clearInterval(heartbeat);const cleanup=[];for(const peer of [...peers].reverse()){try{if(peer.net.open&&peer.f.room){await peer.request({op:'leave'},'left',()=>true,10000);cleanup.push({peer:peer.name,leftAcknowledged:true});}}catch(error){record(peer.name+':cleanup-error',{error:String(error)});failure??=String(error.stack||error);cleanup.push({peer:peer.name,leftAcknowledged:false});}peer.close();}checks.cleanup={passed:cleanup.length===peers.length&&cleanup.every(peer=>peer.leftAcknowledged),peers:cleanup};if(!checks.cleanup.passed)failure??='Not every actual peer received its Leave acknowledgement';
}
const result={passed:!failure,error:failure,url,map:mapId,scenarioId,scope:'Actual native server plus shipped NetClient/shared fuel API, real runway deployment, retained reclaim, fifteen-second fuel service and cancellation. No fabricated snapshots or test-only native hooks.',source:{appSha256:digest(app),netClientSha256:digest(netSource),wireSha256:digest(wire),scenarioSha256:digest(fs.readFileSync(new URL(import.meta.url))),serverExe:serverExe||null,serverExeSha256},checks,limitations,timeline};
fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true});fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({...result,timeline:undefined}));process.exitCode=failure?1:0;
