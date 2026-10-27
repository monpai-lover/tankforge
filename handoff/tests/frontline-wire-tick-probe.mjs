// Actual WebSockets, two observers of exactly the same native world/ticks.
// Usage: node ... ws://127.0.0.1:PORT/ws 12 result.json mixed|solo korea|taiwan
import fs from 'node:fs';
import vm from 'node:vm';
import os from 'node:os';
import crypto from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';

const [url,secondsText='12',output,mode='mixed',map='korea']=process.argv.slice(2);
const seconds=Number(secondsText),mixed=mode==='mixed';
const expectedGround=mixed?86:76;
if(!url||!output||!Number.isFinite(seconds)||seconds<2||seconds>120)throw Error('Expected URL seconds(2..120) output mixed|solo map');
const decoderSource=fs.readFileSync(new URL('../tools/frontline_wire.js',import.meta.url),'utf8');
const c=vm.createContext({ArrayBuffer,Uint8Array,DataView,TextDecoder,BigInt});vm.runInContext(decoderSource,c);
const peers=[],samples=[],unpaired=[new Map(),new Map()],errors=[];
// Local short-probe tolerance; this is not a WAN/GPU/mobile population claim.
const budgetThresholds={nativeTickHz:[19,21.5],airClockPerWall:[.95,1.05],minimumPairedFrameHz:18};
function realtimeBudget(){
  const first=samples[0],last=samples.at(-1),wall=first&&last?(last.atMs-first.atMs)/1000:0;
  const nativeTickHz=wall?(last.tick-first.tick)/wall:0,pairedFrameHz=wall?(samples.length-1)/wall:0;
  const airClockPerWall=wall?last.airTimes.map((t,i)=>(t-first.airTimes[i])/wall):[];
  const passed=wall>0&&nativeTickHz>=19&&nativeTickHz<=21.5&&pairedFrameHz>=18&&airClockPerWall.length===(mixed?3:2)&&airClockPerWall.every(v=>v>=.95&&v<=1.05);
  return{passed,nativeTickHz,pairedFrameHz,airClockPerWall,thresholds:budgetThresholds};
}
let room=null,armed=false,started=null,measureBegan=null,finished=false,resetRequested=false,resetSnapshot=false,resetFull=false,roleBeforeReset=null,player=null,inputTimer=null;
let initialRegistry=null,httpDuringPromise=null;
const state={wireFull:0,wireDelta:0,resetRequests:0,warmupResetRequests:0,initialRooms:null,finalRooms:null,httpRegistry:null,audienceFrames:{blue:0,red:0}};
const digest=x=>crypto.createHash('sha256').update(x).digest('hex');
const send=(peer,command)=>peer.ws.send(JSON.stringify({t:'frontline',version:1,command}));
async function registry(){
  const began=performance.now(),address=new URL('/frontline/maps.json',url.replace(/^ws/,'http'));
  const response=await fetch(address,{signal:AbortSignal.timeout(2000)});assert.equal(response.status,200);
  const text=await response.text(),value=JSON.parse(text);assert.deepEqual(value.maps.map(m=>m.id).sort(),['korea','taiwan']);
  for(const m of value.maps)assert.match(m.sha256,/^[a-f0-9]{64}$/);
  return{value,latencyMs:performance.now()-began,bodySha256:digest(text)};
}
function sameValue(a,b,path='frame'){
  if(typeof a==='number'&&typeof b==='number'){
    // Legacy serde writes Vec<f32> in shortest f32 decimal form. Its consumer
    // promotes those through Float32Array. The binary path sends the exact
    // original f32 value. All other native f64 fields stay bit-exact unchanged.
    if(/^frame\.aircrafts\[\d+\]\.(state|aero)\[\d+\]$/.test(path))a=Math.fround(a);
    assert.ok(Object.is(a,b),`${path}: ${a} != ${b}`);return;
  }
  if(a===null||b===null||typeof a!=='object'||typeof b!=='object'){assert.equal(a,b,path);return;}
  assert.equal(Array.isArray(a),Array.isArray(b),path);
  if(Array.isArray(a)){assert.equal(a.length,b.length,path);for(let i=0;i<a.length;i++)sameValue(a[i],b[i],`${path}[${i}]`);}
  else{const ak=Object.keys(a).sort(),bk=Object.keys(b).sort();assert.deepEqual(ak,bk,path);for(const k of ak)sameValue(a[k],b[k],`${path}.${k}`);}
}
const roles=room=>room?.members.map(m=>({player:m.player,observer:m.observer,team:m.team,company:m.company,controlled:m.controlled,epoch:m.epoch}));
let completeMeasurement;
const measured=new Promise(resolve=>completeMeasurement=resolve);
function observe(which,message,bytes,header){
  if(!armed||finished)return;
  // Setup snapshots on another socket can overtake an older writer queue.
  // Begin only at the requested complete population; once begun, every pair
  // below must continue to contain all of those accepted actors.
  if(started===null&&(message.units.length!==expectedGround||message.aircrafts.length!==(mixed?3:2)))return;
  const key=`${message.battle}:${message.tick}`;unpaired[which].set(key,{message,bytes,atMs:performance.now(),header});
  if(unpaired[0].size>600||unpaired[1].size>600)throw Error('Same-tick observer pairing backlog');
  const a=unpaired[0].get(key),b=unpaired[1].get(key);if(!a||!b)return;
  sameValue(a.message,b.message);unpaired[0].delete(key);unpaired[1].delete(key);
  assert.equal(a.message.units.length,expectedGround,'Complete combat and sixteen real support actors must remain replicated');
  assert.equal(a.message.units.filter(u=>u.role!=='combat').length,16,'All support actors remain part of the actual native world');
  assert.equal(a.message.aircrafts.length,mixed?3:2,'Independent actual aircraft remain replicated');
  const atMs=Math.max(a.atMs,b.atMs);started??=atMs;
  samples.push({tick:a.message.tick,atMs,legacyBytes:a.bytes,wireBytes:b.bytes,full:b.header?.full===true,
    units:a.message.units.length,aircrafts:a.message.aircrafts.length,airTimes:a.message.aircrafts.map(u=>u.state[23])});
  if(samples.length>=12&&!resetRequested){
    resetRequested=true;state.resetRequests++;roleBeforeReset=roles(peers[1].room);
    peers[1].ws.send(JSON.stringify({t:'frontline_wire_reset',version:2}));
    httpDuringPromise=registry().then(current=>{assert.deepEqual(current.value,initialRegistry.value,'Registry identity/hash changed during native world');state.httpRegistry=current;}).catch(error=>{errors.push(String(error.stack||error));completeMeasurement();});
  }
  if(resetSnapshot&&b.header?.full)resetFull=true;
  if((atMs-started)/1000>=seconds){finished=true;completeMeasurement();}
}
class Peer{
  constructor(name,wire,index){
    this.name=name;this.wire=wire;this.index=index;this.messages=[];this.waiters=[];this.decoder=c.createFrontlineWireDecoder();this.awaiting=false;this.snapshot=null;this.measuredTotalBytes=0;
    this.ws=new WebSocket(url);this.ws.binaryType='arraybuffer';
    this.ping=setInterval(()=>{if(this.ws.readyState===WebSocket.OPEN)this.ws.send(JSON.stringify({t:'ping',at:Date.now()}));},5000);
    this.opened=new Promise((resolve,reject)=>{this.ws.onopen=resolve;this.ws.onerror=e=>reject(Error(e.message||`${name} socket error`));});
    this.ws.onmessage=e=>{try{this.receive(e.data);}catch(error){errors.push(String(error.stack||error));for(const w of this.waiters.splice(0))w.reject(error);completeMeasurement();}};
    peers.push(this);
  }
  receive(data){
    let value,bytes,header=null;
    if(typeof data==='string'){bytes=Buffer.byteLength(data);value=JSON.parse(data);}
    else{
      assert.equal(this.wire,2,'A legacy client cannot receive binary');
      bytes=data.byteLength;const view=new DataView(data);assert.equal(view.getBigUint64(5,true),BigInt(this.welcome.frontline_wire_stream));
      const full=new Uint8Array(data)[4]===0;if(this.awaiting&&!full)return;
      value=this.decoder.decode(data);header=this.decoder.state;if(full){this.awaiting=false;if(this.index===1)state.wireFull++;}else if(this.index===1)state.wireDelta++;
    }
    if(armed&&!finished)this.measuredTotalBytes+=bytes;
    if(value.t==='error'||value.t==='frontline'&&value.message.op==='error')throw Error(JSON.stringify(value));
    if(value.t==='welcome'){
      this.welcome=value;
      if(this.wire===2){assert.equal(value.frontline_wire_version,2);assert.equal(typeof value.frontline_wire_stream,'string');}
      else assert.equal(value.frontline_wire_version,undefined);
    }
    if(value.t==='frontline'){
      const m=value.message;
      if(m.op==='room'||m.op==='snapshot')this.room=m.room;
      if(m.op==='snapshot'){
        this.snapshot=m;
        if(this.wire===2)this.awaiting=true;
        if(this.index===1&&resetRequested&&!resetSnapshot){assert.deepEqual(roles(this.room),roleBeforeReset,'Readonly resync changed role/control/epoch/company');resetSnapshot=true;}
      }
      if((m.op==='snapshot'||m.op==='frame')&&m.intel){
        const team=m.intel.team;assert.ok(['blue','red'].includes(team));
        for(const kind of ['units','companies','aircrafts'])assert.ok(m[kind].every(u=>u.team===team),kind+' cannot contain foreign private state');
        assert.ok(m.objectives.every(o=>o.presence[team==='blue'?1:0]===null));
        for(const pose of m.intel.visible_ground)for(const field of ['ammo','ammo_revision','damage','caps','company','controller','epoch','support_task','support_order_seq'])assert.ok(!(field in pose),'Public pose leaked '+field);
        for(const f of m.facilities)if(f.team!==(team==='blue'?0:1))for(const field of ['hp','max_hp','supplied'])assert.ok(!(field in f),'Foreign facility leaked '+field);
        if(m.op==='frame')state.audienceFrames[team]++;
      }
      if(m.op==='frame'){this.lastFrame=m;if(this.index!=null)observe(this.index,m,bytes,header);return;}
    }
    this.messages.push(value);if(this.messages.length>300)this.messages.shift();
    for(const w of this.waiters.slice())w.try();
  }
  wait(predicate,timeout=15000){
    return new Promise((resolve,reject)=>{
      let timer;const waiter={reject:error=>{clearTimeout(timer);this.waiters=this.waiters.filter(w=>w!==waiter);reject(error);},try:()=>{
        const i=this.messages.findIndex(predicate);if(i>=0){const value=this.messages.splice(i,1)[0];clearTimeout(timer);this.waiters=this.waiters.filter(w=>w!==waiter);resolve(value);}
      }};timer=setTimeout(()=>waiter.reject(Error(`${this.name} message timeout`)),timeout);this.waiters.push(waiter);waiter.try();
    });
  }
  waitOp(op,predicate=()=>true,timeout){return this.wait(m=>m.t==='frontline'&&m.message.op===op&&predicate(m.message),timeout).then(m=>m.message);}
  async hello(){await this.opened;this.ws.send(JSON.stringify({t:'hello',name:this.name,gameplay_rules_version:2,ammo_protocol_version:1,...(this.wire===2?{frontline_wire_version:2}:{})}));return this.wait(m=>m.t==='welcome');}
}
let failure=null;const cleanup={};
try{
  const binary=new Peer('wire2-native-observer',2,1);await binary.hello();send(binary,{op:'list'});
  const initial=await binary.waitOp('rooms');state.initialRooms=initial.rooms.length;assert.equal(state.initialRooms,0,'Use a fresh private process for an isolated budget probe');
  initialRegistry=await registry();
  send(binary,{op:'create',name:'Same-tick v1/v2 native transport probe',map,observer:true,era:1986});room=(await binary.waitOp('snapshot')).room.id;
  assert.equal(binary.room.map_revision,initialRegistry.value.maps.find(m=>m.id===map).sha256);
  const legacy=new Peer('wire1-native-observer',1,0);await legacy.hello();send(legacy,{op:'join',room,observer:true});await legacy.waitOp('snapshot');
  // Index order is an explicit contract for roles/reset and paired samples.
  peers.splice(0,2,legacy,binary);
  send(binary,{op:'start'});await binary.waitOp('snapshot',m=>m.room.started,30000);
  if(mixed){
    player=new Peer('wire2-native-pilot',2,null);await player.hello();send(player,{op:'join',room,observer:false,team:'blue'});await player.waitOp('snapshot');
    const red=new Peer('wire2-native-red-team',2,null);await red.hello();send(red,{op:'join',room,observer:false,team:'red'});await red.waitOp('snapshot');
    send(player,{op:'deploy',vehicle:'su_t72a'});await player.waitOp('snapshot',m=>m.room.members.find(p=>p.player===player.welcome.id)?.controlled);
    send(player,{op:'return'});await player.waitOp('snapshot',m=>!m.room.members.find(p=>p.player===player.welcome.id)?.controlled);
    const option=player.snapshot.aircraft_options.find(a=>a.id==='su25')||player.snapshot.aircraft_options[0];assert.ok(option);
    send(player,{op:'deploy_air',aircraft:option.id,spawn:'air',loadout:option.loadouts[0].index});
    const spawned=await player.waitOp('snapshot',m=>{const member=m.room.members.find(p=>p.player===player.welcome.id);return m.aircrafts.some(a=>a.unit.unit===member?.controlled?.unit);});
    const member=spawned.room.members.find(p=>p.player===player.welcome.id),unit=spawned.aircrafts.find(a=>a.unit.unit===member.controlled.unit);
    let seq=0;const aim=[unit.state[48],.03,unit.state[50]];
    inputTimer=setInterval(()=>send(player,{op:'air_input',unit:unit.unit,epoch:member.epoch,seq:++seq,aim,throttle:.75,manual_pitch:0,manual_roll:0,manual_yaw:0,flags:1,fire:false,release:false}),50);
    // Control changes may send their Snapshot only to the commanding player.
    // Obtain the observer's actual current all-member baseline AFTER the real
    // tank->Return->air sequence, rather than compare a pre-sortie room view.
    state.warmupResetRequests++;
    binary.ws.send(JSON.stringify({t:'frontline_wire_reset',version:2}));
    const baseline=await binary.waitOp('snapshot',m=>{const p=m.room.members.find(p=>p.player===player.welcome.id);return p?.epoch===member.epoch&&p.controlled?.battle===unit.unit.battle&&p.controlled?.unit===unit.unit.unit&&p.controlled?.life===unit.unit.life;});
    const ownTeam=member.team,authorized=roles(baseline.room).map(m=>m.team===ownTeam?m:{...m,controlled:null,company:null,epoch:0});
    assert.deepEqual(authorized,roles(spawned.room),'Fresh observer truth projected to the pilot audience must retain final authorized role/control/company');
    const deadline=performance.now()+5000;
    while(binary.awaiting){if(performance.now()>deadline)throw Error('Setup readonly full baseline timeout');await new Promise(resolve=>setTimeout(resolve,10));}
  }
  measureBegan=performance.now();armed=true;
  const timeout=setTimeout(()=>{errors.push('Measurement did not complete within bounded wall time');completeMeasurement();},Math.max(30000,seconds*6000));
  await measured;clearTimeout(timeout);await httpDuringPromise;if(errors.length)throw Error(errors.join('\n'));
  assert.ok(samples.length>=20);assert.ok(resetSnapshot&&resetFull,'Actual readonly Snapshot/full reset not observed');
  if(mixed)assert.ok(state.audienceFrames.blue>=10&&state.audienceFrames.red>=10,'Both actual team sockets must receive only authorized snapshots/frames');
  assert.ok(state.httpRegistry&&state.httpRegistry.latencyMs<2000,'Actual bounded HTTP registry did not complete during measurement');
  assert.ok(realtimeBudget().passed,`Actual native/network realtime budget failed: ${JSON.stringify(realtimeBudget())}`);
}catch(error){failure=String(error.stack||error);}
finally{
  clearInterval(inputTimer);armed=false;finished=true;
  for(const peer of [...peers].reverse()){
    try{if(peer.ws.readyState===WebSocket.OPEN){send(peer,{op:'leave'});await peer.waitOp('left',()=>true,10000);cleanup[peer.name]=true;}}catch(error){cleanup[peer.name]=String(error);failure??=String(error);}
  }
  try{const binary=peers.find(p=>p.index===1);if(binary?.ws.readyState===WebSocket.OPEN){send(binary,{op:'list'});state.finalRooms=(await binary.waitOp('rooms')).rooms.length;assert.equal(state.finalRooms,0);}}catch(error){failure??=String(error);}
  for(const p of peers){clearInterval(p.ping);p.ws.close();}
}
const first=samples[0],last=samples.at(-1),elapsed=first&&last?(last.atMs-first.atMs)/1000:0;
const legacyBytes=samples.slice(1).reduce((n,s)=>n+s.legacyBytes,0),wireBytes=samples.slice(1).reduce((n,s)=>n+s.wireBytes,0);
const socketSeconds=last&&measureBegan?(last.atMs-measureBegan)/1000:0,socketLegacy=peers.find(p=>p.index===0)?.measuredTotalBytes||0,socketWire=peers.find(p=>p.index===1)?.measuredTotalBytes||0;
const result={passed:!failure,error:failure,diagnosticOnly:process.env.TANKFORGE_PROBE_DIAGNOSTIC==='1',scope:'Actual same-world WebSocket transport, exact native f32 and f64 state/resources/damage after accepted decode; no GPU/WAN/mobile/max-player certification',
  url,map,mode,room,source:{decoderSha256:digest(decoderSource),registryAtStartup:initialRegistry,...(process.env.TANKFORGE_PROBE_BINARY?{binarySha256:digest(fs.readFileSync(process.env.TANKFORGE_PROBE_BINARY))}:{})},hardware:{cpus:os.availableParallelism(),models:[...new Set(os.cpus().map(c=>c.model))]},
  bytesMeaning:'Paired Frame payload bytes; excludes WebSocket/TCP/TLS overhead. Reset Frame is included; readonly Snapshot/Pong and all other received messages are also measured separately in socketPayloadBytes.',
  frames:samples.length,durationSeconds:elapsed,tickAdvance:first&&last?last.tick-first.tick:0,tickHz:elapsed?(last.tick-first.tick)/elapsed:0,
  realtimeBudget:realtimeBudget(),frameArrivalHz:elapsed?(samples.length-1)/elapsed:0,
  nativeAirTimeAdvance:first&&last?last.airTimes.map((t,i)=>t-first.airTimes[i]):[],
  legacyBytesPerSecond:elapsed?legacyBytes/elapsed:0,wireBytesPerSecond:elapsed?wireBytes/elapsed:0,wireOverLegacyRatio:legacyBytes?wireBytes/legacyBytes:0,
  socketWindowSeconds:socketSeconds,socketPayloadBytes:{legacy:socketLegacy,wire:socketWire},socketBytesPerSecond:{legacy:socketSeconds?socketLegacy/socketSeconds:0,wire:socketSeconds?socketWire/socketSeconds:0},socketWireOverLegacyRatio:socketLegacy?socketWire/socketLegacy:0,
  exactSameTickIdentityPairs:samples.length,state,cleanup,samples};
fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true});
fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({...result,samples:undefined}));
process.exitCode=failure?1:0;
