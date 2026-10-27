// Fresh authoritative world. Optional `air` also returns the player's tank and
// deploys an aircraft while the retained company remains in the same world.
import fs from 'node:fs';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
const [url, secondsText, output, mode]=process.argv.slice(2),seconds=Number(secondsText||12),mixed=mode==='air';
const samples=[],transitions=[],began=performance.now(),observer=new WebSocket(url);
let player,room,phase='initial_list',startSent=false,playerSent=false,deployed=false,timer,shutdownTimer,snapshotBytes=null,snapshotUnits=null,initialRooms=null,duringRooms=null,playerLeft=false,observerLeft=false,failure=null;
let returned=false,sortie=false;
const send=(ws,command)=>ws.send(JSON.stringify({t:'frontline',version:1,command}));
function hello(ws,name){ws.send(JSON.stringify({t:'hello',name,gameplay_rules_version:2,ammo_protocol_version:1}));}
function write(){
 clearTimeout(timer);clearTimeout(shutdownTimer);
 const first=samples[0],last=samples.at(-1),elapsed=first&&last?(last.atMs-first.atMs)/1000:0;
 const result={scope:mixed?'one actual world with30 native ground units and3 independent aircraft; zeroGPUbrowsers; no maximum-population/WAN claim':'one actual shared30-unit ground world; zeroGPUbrowsers; no240-unit orWANclaim',
  hardware:{platform:os.platform(),arch:os.arch(),cpuModels:[...new Set(os.cpus().map(c=>c.model))],logicalCpus:os.cpus().length,availableParallelism:os.availableParallelism(),systemMemoryBytes:os.totalmem()},
  room,initialWorldCount:initialRooms,concurrentWorldCount:duringRooms,
  bytesMeaning:'UTF8 JSON payload only; excludesWebSocket/TCP/TLSoverhead',snapshotBytes,snapshotUnits,
  durationSeconds:elapsed,frames:samples.length,unitCounts:[...new Set(samples.map(s=>s.units))],aliveCounts:[...new Set(samples.map(s=>s.alive))],
  aircraftCounts:[...new Set(samples.map(s=>s.aircraft))],aircraftNativeTimeAdvance:first&&last?last.airTimes.map((t,i)=>t-first.airTimes[i]):[],
  tickAdvance:first&&last?last.tick-first.tick:0,tickHz:elapsed?(last.tick-first.tick)/elapsed:0,
  frameArrivalHz:elapsed?(samples.length-1)/elapsed:0,
  meanFrameBytes:samples.length?samples.reduce((s,v)=>s+v.bytes,0)/samples.length:0,
  maxFrameBytes:samples.length?Math.max(...samples.map(s=>s.bytes)):0,
  receivedFrameBytesPerSecond:elapsed?samples.slice(1).reduce((s,v)=>s+v.bytes,0)/elapsed:0,
  elapsedFromConnectionSeconds:(performance.now()-began)/1000,error:failure,
  cleanup:{playerLeaveAcknowledged:playerLeft,observerLeaveAcknowledged:observerLeft,finalWorldCount:phase==='clean'?0:null},transitions,samples};
 fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({...result,samples:undefined}));
 observer.close();player?.close();setTimeout(()=>process.exit(failure?1:0),200);
}
function stop(error){
 if(['leaving','clean'].includes(phase))return;
 failure=error||null;phase='leaving';clearTimeout(timer);
 if(player?.readyState===WebSocket.OPEN)send(player,{op:'leave'});else{playerLeft=true;send(observer,{op:'leave'});}
 shutdownTimer=setTimeout(()=>{failure=failure||'ExplicitLeavecleanup timed out';write()},10000);
}
function startPlayer(){
 if(playerSent)return;playerSent=true;player=new WebSocket(url);
 player.onopen=()=>hello(player,'native-perf-player');
 player.onmessage=e=>{let m;try{m=JSON.parse(String(e.data))}catch{return}
  if(m.t==='welcome')return send(player,{op:'join',room,observer:false});
  if(m.t!=='frontline')return;const v=m.message;
  if(v.op==='error')return stop(v.code+': '+v.message);
  if(v.op==='snapshot'){
   if(!deployed){deployed=true;send(player,{op:'deploy',vehicle:'su_t72a'});}
   else if(mixed&&!returned){returned=true;send(player,{op:'return'});}
   else if(mixed&&returned&&!sortie){sortie=true;send(player,{op:'deploy_air',aircraft:'mig21',spawn:'air',loadout:0});}
  }
  if(v.op==='left'){playerLeft=true;send(observer,{op:'leave'});}
 };
 player.onerror=e=>stop(String(e.message||'playerWebSocketerror'));
}
observer.onopen=()=>hello(observer,'native-perf-observer');
observer.onmessage=e=>{
 const raw=String(e.data);let m;try{m=JSON.parse(raw)}catch{return}
 if(m.t==='welcome')return send(observer,{op:'list'});
 if(m.t==='error')return stop(m.msg||'helloRejected');
 if(m.t!=='frontline')return;const v=m.message;
 if(v.op!=='frame')transitions.push({atMs:performance.now(),op:v.op,started:v.room?.started,units:v.units?.length});
 if(v.op==='error')return stop(v.code+': '+v.message);
 if(v.op==='rooms'){
  if(phase==='initial_list'){initialRooms=v.rooms.length;if(initialRooms)return stop('QA worlds were not cleared before independent probe');phase='create';send(observer,{op:'create',name:'Independent30-native-unitperformance',map:'korea',observer:true,era:1986});}
  else if(phase==='measuring'){duringRooms=v.rooms.length;if(duringRooms!==1)stop('Concurrentworldcount differs from1');}
  else if(phase==='leaving'&&observerLeft){if(v.rooms.length)failure=failure||'World remains afterlastLeave';else phase='clean';write();}
  return;
 }
 if((v.op==='room'||v.op==='snapshot')&&!startSent){room=v.room.id;startSent=true;send(observer,{op:'start'});}
 if(v.op==='snapshot'){
  snapshotBytes=Buffer.byteLength(raw);snapshotUnits=v.units.length;
  if(v.units.length===20)startPlayer();
 }
 if(v.op==='left'){observerLeft=true;send(observer,{op:'list'});return;}
 if(v.op!=='frame'||v.units.length!==30||(mixed&&v.aircrafts?.length!==3)||phase==='leaving'||phase==='clean')return;
 samples.push({atMs:performance.now(),tick:v.tick,bytes:Buffer.byteLength(raw),units:v.units.length,alive:v.units.filter(u=>u.alive).length,aircraft:v.aircrafts?.length||0,airTimes:(v.aircrafts||[]).map(a=>a.state[23])});
 if(samples.length===1){phase='measuring';send(observer,{op:'list'});timer=setTimeout(()=>stop(),seconds*1000);}
};
observer.onerror=e=>stop(String(e.message||'observerWebSocketerror'));
setTimeout(()=>{if(!samples.length&&!['leaving','clean'].includes(phase))stop('No30-unit nativeframes within20seconds')},20000);
