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
  vm.runInContext(wire+replaySource+netSource+sharedSource,context);
  this.net=new context.NetClient();this.context=context;
  const me=()=>this.f.room?.members.find(member=>member.player===this.net.id),controlled=()=>this.f.aircrafts.find(unit=>key(unit.unit)===key(this.f.control));
  this.api=context.createFrontlineSharedApi({f:this.f,net:this.net,send:command=>this.send(command),ensureMapOptions:async()=>{this.f.availableMaps=registry.maps;},ensureMap:async()=>this.f.map,mine:me,controlled,
   clearInput:()=>{},note:message=>record(name+':notice',{message})});
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
 const blue=new Peer(`native-air-blue-${scenarioId}`),red=new Peer(`native-air-red-${scenarioId}`),observer=new Peer(`native-air-observer-${scenarioId}`);
 await Promise.all([blue.connect(),red.connect(),observer.connect()]);
 const created=await blue.via(()=>blue.api.create({map:mapId,era:1986,name:`Native air integration ${scenarioId}`,observer:false}),'snapshot');
 assert.equal(created.room.battle_mode,'air_frontline');assert.equal(created.room.player_ground_allowed,false);const room=created.room.id;
 await red.via(()=>red.api.list(),'rooms');await red.via(()=>red.api.join({room,observer:false}),'snapshot');await observer.via(()=>observer.api.list(),'rooms');await observer.via(()=>observer.api.join({room,observer:true}),'snapshot');
 assert.equal(blue.api.self().team,'blue');assert.equal(red.api.self().team,'red');
 const battle=await blue.via(()=>blue.api.start(),'snapshot',message=>message.room.started,20000);await observer.wait('snapshot',message=>message.room.started,20000);
 assert.deepEqual(plain(battle.objectives.map(objective=>objective.id).sort()),['C2','E2','W2']);assert.deepEqual(plain(battle.objectives.map(objective=>objective.name).sort()),['A','B','C']);
 const observed=plain(observer.lastFrame);assert.equal(observed.units.length,60);assert.ok(observed.units.every(unit=>(unit.role||'combat')==='combat'&&unit.controller==null));
 assert.equal(observed.aircrafts.length,0,'Observer-only start must not spawn autonomous aircraft in pure air mode');
 checks.ground_only_ai={passed:true,initial_ground_units:observed.units.length,initial_autonomous_aircraft:observed.aircrafts.length};
 checks.air_only_world={passed:true,room,mode:battle.room.battle_mode,ground_units:observed.units.length,ground_companies:observed.companies.length,objectives:battle.objectives.map(({id,name})=>({id,name}))};
 const groundRejection=await blue.request({op:'deploy',vehicle:'su_t72a'},'error');assert.equal(groundRejection.code,'air_only');checks.player_ground_denied={passed:true,code:groundRejection.code};
 const option=blue.f.aircraftOptions.find(option=>option.id==='su25')||blue.f.aircraftOptions.find(option=>option.slots.some(slot=>Object.keys(slot.options).some(store=>!slot.unsupported?.[store]&&!slot.incomplete?.[store]&&/fab|anm|mk8|bomb/i.test(store))));assert.ok(option,'Native configurable aircraft available');
 const other=red.f.aircraftOptions.find(option=>option.id==='su25')||red.f.aircraftOptions[0];
 const redPlane=await red.deploy({aircraft:other.id,loadout:0,custom:{},spawn:'air'});assert.ok(redPlane.state[35]>100);assert.deepEqual(plain(redPlane.custom),{});assert.equal(redPlane.stores.length,0);
 const bluePlane=await blue.deploy({aircraft:option.id,loadout:0,custom:{},spawn:'runway'});assert.ok(bluePlane.state[35]<=3);assert.deepEqual(plain(bluePlane.custom),{});assert.equal(bluePlane.stores.length,0);
 checks.spawn_types={passed:true,air:{aircraft:redPlane.aircraft,agl:redPlane.state[35],unit:redPlane.unit},runway:{aircraft:bluePlane.aircraft,agl:bluePlane.state[35],unit:bluePlane.unit}};
 let blueFire=true,bluePaused=false,redDive=false;heartbeat=setInterval(()=>{if(!bluePaused)blue.input({fire:blueFire});red.input(redDive?{throttle:0,manual_pitch:-1,flags:4}:{throttle:.8,flags:1});},50);
 const ammunitionBefore=bluePlane.guns.reduce((sum,gun)=>sum+gun.ammo,0);await sleep(700);blueFire=false;bluePaused=true;blue.input({fire:false});
 // WebSocket command order makes this fresh snapshot an accepted fire-stop
 // barrier. A historical "first ammo spent" frame cannot prove return/reclaim.
 const identity=key(bluePlane.unit),stopped=await blue.request({op:'snapshot'},'snapshot',message=>message.aircrafts.some(unit=>unit.owner===blue.net.id&&key(unit.unit)===identity));
 const stoppedPlane=stopped.aircrafts.find(unit=>unit.owner===blue.net.id&&key(unit.unit)===identity),ammunitionStopped=stoppedPlane.guns.reduce((sum,gun)=>sum+gun.ammo,0);
 assert.ok(ammunitionStopped<ammunitionBefore,'Actual accepted held fire must spend ammunition before stopping');
 const afterReturn=blue.serial,returnedSnapshot=blue.wait('snapshot',message=>message.room.members.some(member=>member.player===blue.net.id&&member.controlled===null)&&message.aircrafts.some(unit=>unit.owner===blue.net.id&&key(unit.unit)===identity),12000,afterReturn),returnedControl=blue.wait('control',message=>message.unit===null,12000,afterReturn);
 blue.api.returnToDeployment();const [returned]=await Promise.all([returnedSnapshot,returnedControl]);assert.ok(blue.api.retained());
 const retainedPlane=returned.aircrafts.find(unit=>unit.owner===blue.net.id&&key(unit.unit)===identity),ammunitionRetained=retainedPlane.guns.reduce((sum,gun)=>sum+gun.ammo,0);
 assert.ok(ammunitionRetained<=ammunitionStopped,'Return cannot restore ammunition after the accepted fire-stop barrier');
 const nativeReplace=await blue.request({op:'deploy_air',aircraft:blue.f.aircraftOptions.find(item=>item.id!==option.id)?.id||option.id,loadout:0,custom:{},spawn:'runway'},'error');assert.equal(nativeReplace.code,'owned_aircraft_active');
 const reclaimed=await blue.deploy({aircraft:option.id,loadout:0,custom:{},spawn:'runway'});bluePaused=false;assert.equal(key(reclaimed.unit),identity);assert.equal(reclaimed.guns.reduce((sum,gun)=>sum+gun.ammo,0),ammunitionRetained);assert.deepEqual(plain(reclaimed.custom),{});
 checks.retained_reclaim={passed:true,unit:reclaimed.unit,ammunitionBefore,ammunitionStopped,ammunitionRetainedAtAcceptedReturn:ammunitionRetained,ammunitionReclaimed:reclaimed.guns.reduce((sum,gun)=>sum+gun.ammo,0),native_replace_rejection:nativeReplace.code,barrier:'explicit fire=false, fresh authoritative snapshot, accepted Return snapshot/control, then reclaim'};
 const slot=option.slots.find(slot=>Object.keys(slot.options).some(store=>!slot.unsupported?.[store]&&!slot.incomplete?.[store]&&/fab|anm|mk8|bomb/i.test(store)));assert.ok(slot,'Admitted unguided bomb slot');const store=Object.keys(slot.options).find(store=>!slot.unsupported?.[store]&&!slot.incomplete?.[store]&&/fab|anm|mk8|bomb/i.test(store)),custom={[slot.key]:store};
 const beforeService=blue.serial;blue.api.serviceAir({custom});const servicing=await blue.wait('frame',message=>message.aircrafts.some(unit=>unit.owner===blue.net.id&&unit.service?.status==='servicing'),10000,beforeService);assert.equal(servicing.aircrafts.find(unit=>unit.owner===blue.net.id).stores.length,0,'No pre-completion materialization');
 record('airport-service-start',{aircraft:option.id,custom});
 const complete=await blue.wait('frame',message=>message.aircrafts.some(unit=>unit.owner===blue.net.id&&unit.service?.status==='complete'),90000,beforeService),serviced=complete.aircrafts.find(unit=>unit.owner===blue.net.id);
 assert.equal(key(serviced.unit),identity);assert.deepEqual(plain(serviced.custom),custom);assert.ok(serviced.stores.some(item=>item.id===store));assert.equal(serviced.guns.reduce((sum,gun)=>sum+gun.ammo,0),ammunitionBefore);assert.equal(serviced.service.duration_s,15);assert.ok(serviced.service.elapsed_s>=15);
 checks.airport_service={passed:true,duration_s:serviced.service.duration_s,elapsed_s:serviced.service.elapsed_s,unit:serviced.unit,custom:serviced.custom,stores:serviced.stores.map(({id,count,owner})=>({id,count,owner})),ammoAfter:serviced.guns.reduce((sum,gun)=>sum+gun.ammo,0)};
 const unsupported=option.slots.flatMap(slot=>Object.entries(slot.unsupported||{}).map(([store,reason])=>({slot:slot.key,store,reason})))[0];
 if(unsupported){const rejection=await blue.request({op:'service_air',unit:serviced.unit,epoch:blue.f.epoch,seq:++blue.f.seq,loadout:0,custom:{[unsupported.slot]:unsupported.store}},'error');assert.match(rejection.code,/service|loadout/);checks.unsupported_store_denied={passed:true,...unsupported,code:rejection.code};}
 bluePaused=true;await blue.via(()=>blue.api.returnToDeployment(),'control',message=>message.unit===null);const reclaimedServiced=await blue.deploy({aircraft:option.id,loadout:0,custom:{},spawn:'runway'});bluePaused=false;assert.equal(key(reclaimedServiced.unit),identity);assert.deepEqual(plain(reclaimedServiced.custom),custom,'Shared reclaim resends accepted custom rather than requested empty config');
 // Keep both real pilot lives through the 15-second service acceptance first;
 // intentionally crashing the opponent earlier can legitimately end the round.
 redDive=true;record('real-flight-loss-attempt',{unit:redPlane.unit});
 const lossDeadline=performance.now()+60000;while(!red.ended&&red.f.room?.members.find(member=>member.player===red.net.id)?.air_sortie_eligible!==false&&performance.now()<lossDeadline)await sleep(100);
 await red.request({op:'snapshot'},'snapshot');
 if(red.f.room?.members.find(member=>member.player===red.net.id)?.air_sortie_eligible===false){
  const last=red.f.aircrafts.find(unit=>key(unit.unit)===key(redPlane.unit));assert.ok(!last||!last.alive);assert.equal(red.api.self().air_sorties_remaining,0);assert.throws(()=>red.api.deployAir({aircraft:other.id,loadout:0,custom:{},spawn:'air'}),/本局|等待|观战|返回出击/);
  const rejection=await red.request({op:'deploy_air',aircraft:other.id,loadout:0,custom:{},spawn:'air'},'error');assert.ok(['air_sortie_spent','round_ended'].includes(rejection.code));checks.one_sortie_after_loss={passed:true,code:rejection.code,original_unit:redPlane.unit};
 }else limitations.push('Bounded real-flight crash did not produce accepted aircraft loss; post-loss respawn rejection remains covered by native tests, not certified by this CLI run.');
 const firstGround=observed.units.find(unit=>unit.alive),lastGround=observer.f.units.find(unit=>key(unit.unit)===key(firstGround?.unit));checks.ground_attack_movement={passed:!!firstGround&&!!lastGround&&Math.hypot(...lastGround.pos.map((value,i)=>value-firstGround.pos[i]))>.1,unit:firstGround?.unit,distanceMoved:firstGround&&lastGround?Math.hypot(...lastGround.pos.map((value,i)=>value-firstGround.pos[i])):null};assert.ok(checks.ground_attack_movement.passed);
 assert.equal(blue.net.frontlineWire.resets,0);assert.equal(red.net.frontlineWire.resets,0);assert.equal(observer.net.frontlineWire.resets,0);assert.ok(peers.every(peer=>peer.wireErrors.length===0));
 const scoreEvents=observer.events.filter(event=>['player_score','team_score'].includes(event.kind));checks.score_state={passed:Array.isArray(observer.f.room.team_score)&&observer.f.room.team_score.length===2,team_score:observer.f.room.team_score,scoreboard:observer.f.room.scoreboard,events:scoreEvents};assert.ok(checks.score_state.passed);
 const terminal=peers.map(peer=>peer.ended).find(Boolean);if(terminal){assert.ok(['air_elimination','score_limit','time'].includes(terminal.reason));checks.terminal={passed:true,...terminal};}else limitations.push('No native terminal round reached in the bounded unmodified multiplayer world; air-elimination/score-limit adjudication is verified separately by native tests.');
 const allowedErrors=new Set(['air_only','owned_aircraft_active','service_rejected','era_or_loadout','air_sortie_spent','round_ended']);const unexpected=peers.flatMap(peer=>peer.errors.map(error=>({peer:peer.name,...error}))).filter(error=>!allowedErrors.has(error.code));assert.equal(unexpected.length,0,JSON.stringify(unexpected));checks.expected_rejections={passed:true,errors:peers.flatMap(peer=>peer.errors.map(error=>({peer:peer.name,...error})))};
 checks.wire2={passed:true,peers:peers.map(peer=>({name:peer.name,...plain(peer.net.frontlineWire)}))};
 record('scenario-complete');
}catch(error){failure=String(error.stack||error);record('scenario-failed',{error:failure});}
finally{
 clearInterval(heartbeat);const cleanup=[];for(const peer of [...peers].reverse()){try{if(peer.net.open&&peer.f.room){await peer.request({op:'leave'},'left',()=>true,10000);cleanup.push({peer:peer.name,leftAcknowledged:true});}}catch(error){record(peer.name+':cleanup-error',{error:String(error)});failure??=String(error.stack||error);cleanup.push({peer:peer.name,leftAcknowledged:false});}peer.close();}checks.cleanup={passed:cleanup.length===peers.length&&cleanup.every(peer=>peer.leftAcknowledged),peers:cleanup};if(!checks.cleanup.passed)failure??='Not every actual peer received its Leave acknowledgement';
}
const result={passed:!failure,error:failure,url,map:mapId,scenarioId,scope:'Real HTTP and actual shipped NetClient + wire2 against unmodified native server. No UI, synthetic frames, local flight stepping, or test hooks.',source:{appSha256:digest(app),netClientSha256:digest(netSource),wireSha256:digest(wire),scenarioSha256:digest(fs.readFileSync(new URL(import.meta.url))),serverExe:serverExe||null,serverExeSha256},checks,limitations,timeline};
fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true});fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({...result,timeline:undefined}));process.exitCode=failure?1:0;
