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
 const blue=new Peer(`r7-local-blue-${scenarioId}`),red=new Peer(`r7-local-red-${scenarioId}`),observer=new Peer(`r7-observer-${scenarioId}`);
 await Promise.all([blue.connect(),red.connect(),observer.connect()]);
 const created=await blue.via(()=>blue.api.create({map:mapId,era:2022,name:`R7 local flight ${scenarioId}`,observer:false}),'snapshot');
 const room=created.room.id;
 await red.via(()=>red.api.list(),'rooms');await red.via(()=>red.api.join({room,observer:false}),'snapshot');
 await observer.via(()=>observer.api.list(),'rooms');await observer.via(()=>observer.api.join({room,observer:true}),'snapshot');
 await blue.via(()=>blue.api.start(),'snapshot',message=>message.room.started,20000);
 await Promise.all([red.wait('snapshot',m=>m.room.started,20000),observer.wait('snapshot',m=>m.room.started,20000)]);
 for(const [id,store] of [['su27skm','kh29te'],['mig29smt','kh29te'],['f15c','agm65d']]){
  const option=blue.f.aircraftOptions.find(item=>item.id===id);assert.ok(option,`native option ${id}`);
  const valid=option.slots.filter(slot=>Object.hasOwn(slot.options,store)&&!slot.unsupported?.[store]&&!slot.incomplete?.[store]);
  assert.equal(valid.length,2,`${id} has both source AGM inner stations open by default`);
 }
 checks.source_agm_open={passed:true,aircraft:['su27skm','mig29smt','f15c']};
 const custom={'inner:-1':'kh29te','inner:1':'kh29te'};
 const enemy=await red.deploy({aircraft:'su27skm',loadout:0,custom,spawn:'air'});
 const unit=await blue.deploy({aircraft:'mig29smt',loadout:0,custom,spawn:'air'});
 assert.equal(unit.stores.filter(store=>store.id==='kh29te').length,2);
 assert.equal(enemy.stores.filter(store=>store.id==='kh29te').length,2);
 checks.inherited_source_deploy={passed:true,blue:{aircraft:unit.aircraft,custom:unit.custom,stores:unit.stores.map(s=>({id:s.id,p:s.p}))},red:{aircraft:enemy.aircraft,custom:enemy.custom,stores:enemy.stores.map(s=>({id:s.id,p:s.p}))}};
 const context=blue.context;
 vm.runInContext(fs.readFileSync(new URL('../tools/frontline_local_flight.js',import.meta.url),'utf8'),context);
 const from=client.indexOf('      function grid(g,x,z){'),to=client.indexOf('      async function ensureMapOptions(',from);
 assert.ok(from>=0&&to>from);context.f=blue.f;context.clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
 vm.runInContext(client.slice(from,to),context);
 const world=context.createFrontlineFlightWorld(blue.f,context.height);
 const wasm=fs.readFileSync(new URL('../flight/flight_core.wasm',import.meta.url));
 const api=(await WebAssembly.instantiate(wasm,{math:{sin:Math.sin,cos:Math.cos,atan2:Math.atan2,exp:Math.exp,asin:Math.asin,acos:Math.acos},world:{ground:world.ground,landable:(x,z)=>world.landable(x,z)?1:0}})).instance.exports;
 api.set_world(1);
 const plane={api:{},S:Float32Array.from(unit.state),aero:Float32Array.from(unit.aero),cur:Float32Array.from(unit.state),prev:Float32Array.from(unit.state),pose(){}};
 const owner=context.createFrontlineLocalFlight({api,plane,unit,epoch:blue.f.epoch});
 const intent={aim:[unit.state[48],unit.state[49],unit.state[50]],throttle:.8,manual_pitch:0,manual_roll:.05,manual_yaw:0,flags:1};
 const stock=JSON.stringify({guns:unit.guns,stores:unit.stores,fuel:unit.fuel});
 let accepted=0,lastLocalAt=performance.now();
 function stepLocal(){const at=performance.now();owner.step((at-lastLocalAt)/1000,intent);lastLocalAt=at;}
 heartbeat=setInterval(()=>red.input({throttle:.8,flags:1}),50);
 for(let i=0;i<50;i++){
  await sleep(50);stepLocal();
  blue.input(intent);const packet=owner.packet(++blue.f.seq);assert.ok(packet);
  const after=blue.serial;blue.send({op:'air_pose',...packet});
  const ack=await blue.wait('air_pose_accepted',value=>value.seq===packet.seq,12000,after);
  assert.equal(owner.ack(ack),true);accepted++;
  assert.equal(JSON.stringify({guns:unit.guns,stores:unit.stores,fuel:unit.fuel}),stock,'local stepping cannot mutate native inventory');
 }
 checks.real_local_kernel_pose={passed:true,accepted,coreVersion:api.core_version(),flightWasmSha256:digest(wasm),initialPosition:unit.state.slice(0,3),localPosition:Array.from(plane.cur.slice(0,3)),resourcesUnchangedByLocalOwner:true};
 assert.ok(Math.hypot(...plane.cur.slice(0,3).map((x,i)=>x-unit.state[i]))>100);
 await sleep(50);stepLocal();blue.input(intent);
 const invalid=owner.packet(++blue.f.seq);invalid.pose.position[0]+=50000;
 const rejected=await blue.request({op:'air_pose',...invalid},'error',m=>m.code==='air_pose_rejected');
 assert.match(rejected.message,/flight_teleport_rejected|flight_position_out_of_bounds/);
 owner.reject();assert.equal(owner.packet(++blue.f.seq),null);
 const snap=await blue.request({op:'snapshot'},'snapshot');
 const fresh=snap.aircrafts.find(a=>key(a.unit)===key(unit.unit));assert.ok(fresh);
 assert.equal(owner.accept(fresh,blue.f.epoch),true);
 await sleep(60);stepLocal();blue.input(intent);
 const recovered=owner.packet(++blue.f.seq);assert.ok(recovered);
 const after=blue.serial;blue.send({op:'air_pose',...recovered});const recoveredAck=await blue.wait('air_pose_accepted',m=>m.seq===recovered.seq,12000,after);assert.equal(owner.ack(recoveredAck),true);
 checks.rejected_pose_recovery={passed:true,rejection:rejected.message,recoveredSeq:recovered.seq};
 await blue.request({op:'air_weapon_control',unit:unit.unit,epoch:blue.f.epoch,seq:++blue.f.seq,store_id:'kh29te',store_index:null,program:'single',gun_mode:'all'},'frame',m=>m.aircrafts.some(a=>key(a.unit)===key(unit.unit)&&a.weapon_control?.store_id==='kh29te'));
 const seeking=await blue.request({op:'air_seeker_control',unit:unit.unit,epoch:blue.f.epoch,seq:++blue.f.seq,enabled:true,radar:true,target:null,laser:false,ecm:false,manual:[0,0]},'frame',m=>m.aircrafts.some(a=>key(a.unit)===key(unit.unit)&&a.seeker?.enabled));
 const privateUnit=seeking.aircrafts.find(a=>key(a.unit)===key(unit.unit));assert.ok(privateUnit.seeker);assert.ok(!privateUnit.seeker.locked);
 await observer.request({op:'snapshot'},'snapshot');
 const publicUnit=observer.f.aircrafts.find(a=>key(a.unit)===key(unit.unit));assert.ok(publicUnit);
 assert.equal(publicUnit.seeker.status,privateUnit.seeker.status,'authorized raw observer preserves the actual native seeker state');
 await red.request({op:'snapshot'},'snapshot');const hostile=red.f.aircrafts.find(a=>key(a.unit)===key(unit.unit));assert.ok(!hostile||hostile.seeker===undefined,'enemy pilot must not receive private seeker lock state');
 checks.native_seeker_and_audience={passed:true,privateStatus:privateUnit.seeker,rawObserverStatus:publicUnit.seeker.status,enemyPrivateSeeker:false};
 owner.dispose();
 assert.equal(blue.net.frontlineWire.resets,0);assert.equal(red.net.frontlineWire.resets,0);assert.equal(observer.net.frontlineWire.resets,0);
 const unexpected=peers.flatMap(p=>p.errors).filter(e=>e.code!=='air_pose_rejected');assert.equal(unexpected.length,0,JSON.stringify(unexpected));
 checks.wire2={passed:true,peers:peers.map(p=>({name:p.name,...plain(p.net.frontlineWire)}))};
 limitations.push('CLI integration executes the real flight WASM, shipped NetClient and native WebSocket server. No foreground browser FPS, GPU or Linux execution was measured.');
 record('scenario-complete');
}catch(error){failure=String(error.stack||error);record('scenario-failed',{error:failure});}
finally{
 clearInterval(heartbeat);const cleanup=[];for(const peer of [...peers].reverse()){try{if(peer.net.open&&peer.f.room){await peer.request({op:'leave'},'left',()=>true,10000);cleanup.push({peer:peer.name,leftAcknowledged:true});}}catch(error){record(peer.name+':cleanup-error',{error:String(error)});failure??=String(error.stack||error);cleanup.push({peer:peer.name,leftAcknowledged:false});}peer.close();}checks.cleanup={passed:cleanup.length===peers.length&&cleanup.every(peer=>peer.leftAcknowledged),peers:cleanup};if(!checks.cleanup.passed)failure??='Not every actual peer received its Leave acknowledgement';
}
const result={passed:!failure,error:failure,url,map:mapId,scenarioId,scope:'Actual native server, real shipped NetClient/wire2, public source terrain and original local C215 WASM. No fabricated frames, hidden state, test-only native hooks or UI.',source:{appSha256:digest(app),netClientSha256:digest(netSource),wireSha256:digest(wire),scenarioSha256:digest(fs.readFileSync(new URL(import.meta.url))),serverExe:serverExe||null,serverExeSha256},checks,limitations,timeline};
fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true});fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({...result,timeline:undefined}));process.exitCode=failure?1:0;
