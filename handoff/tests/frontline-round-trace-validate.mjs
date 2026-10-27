// Replay raw output of frontline_round_socket_tests through the production JS
// decoder. This never connects to a server, advances time or constructs frames.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const decoderPath=new URL('../tools/frontline_wire.js',import.meta.url);
const decoderSource=fs.readFileSync(decoderPath,'utf8');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const refKey=r=>r?`${r.battle}:${r.unit}:${r.life}`:null;
const entity=(m,ref,air)=>m[air?'aircrafts':'units']?.find(u=>refKey(u.unit)===refKey(ref));
const ammo=(u,air)=>air?u.guns.reduce((n,g)=>n+g.ammo,0):u.ammo;
const finite=n=>typeof n==='number'&&Number.isFinite(n);
function sources(trace){
  assert.ok(Array.isArray(trace.source?.inputs)&&trace.source.inputs.length>=8,'Missing frozen source inputs');
  for(const input of [...trace.source.inputs,trace.source.executable]){
    assert.match(input.sha256,/^[a-f0-9]{64}$/);const p=path.isAbsolute(input.path)?input.path:path.join(ROOT,input.path);
    assert.equal(sha(fs.readFileSync(p)),input.sha256,`Source/executable changed: ${input.path}`);
  }
  assert.ok(trace.source.inputs.some(v=>v.path==='handoff/tools/frontline_wire.js'&&v.sha256===sha(decoderSource)),'Trace decoder is not current production source');
}
function checkAudience(message,peer,battle){
  if(peer.observer){assert.ok(!message.intel,'Observer must receive the independent truth audience');return;}
  assert.equal(message.intel?.team,peer.team,'Missing/wrong team perception');
  for(const field of ['units','companies','aircrafts'])assert.ok(message[field].every(u=>u.team===peer.team),`${field} leaked foreign private state`);
  for(const objective of message.objectives)assert.equal(objective.presence[peer.team==='blue'?1:0],null,'Enemy capture count disclosed');
  for(const facility of message.facilities)if(facility.team!==(peer.team==='blue'?0:1)){
    for(const key of ['hp','max_hp','supplied'])assert.ok(!(key in facility),'Foreign facility disclosed '+key);
  }
  for(const pose of [...message.intel.visible_ground,...message.intel.visible_aircrafts]){
    assert.equal(pose.unit.battle,battle);assert.notEqual(pose.team,peer.team);
    for(const key of ['ammo','ammo_revision','damage','caps','company','controller','epoch','support_task','support_order_seq','resource_revision','fuel','guns'])assert.ok(!(key in pose),'Public pose disclosed '+key);
  }
  for(const contact of message.intel.contacts){assert.equal(contact.unit.battle,battle);if(message.tick!==undefined)assert.ok(contact.last_seen_tick<=message.tick);}
}
export function validateRoundTransitionTrace(trace){
  assert.equal(trace.schemaVersion,1);assert.equal(trace.fixture?.kind,'cfg_test_native_round_policy');
  assert.ok(trace.fixture.round_seconds>0&&trace.fixture.intermission_seconds>0);sources(trace);
  assert.ok(Number.isSafeInteger(trace.old_battle)&&Number.isSafeInteger(trace.new_battle)&&trace.old_battle!==trace.new_battle);
  const definitions=Object.entries(trace.peers);assert.equal(definitions.length,3);
  assert.equal(definitions.filter(([,p])=>p.observer).length,1);
  assert.deepEqual(definitions.filter(([,p])=>!p.observer).map(([,p])=>p.team).sort(),['blue','red']);
  const c=vm.createContext({ArrayBuffer,Uint8Array,DataView,TextDecoder,BigInt});vm.runInContext(decoderSource,c);
  const peers=new Map(definitions.map(([name,definition])=>[name,{...definition,name,decoder:c.createFrontlineWireDecoder(),received:[],sent:[],opens:0,closes:0,welcomes:0,firstNewSnapshot:null,firstNewFrame:null,lastOldHeader:null,lastOldBinary:null,intermission:[],ended:[],left:0}]));
  let previousSeq=0,previousAt=0;
  for(const row of trace.records){
    assert.equal(row.seq,++previousSeq);assert.ok(finite(row.at_s)&&row.at_s>=previousAt);previousAt=row.at_s;
    const peer=peers.get(row.peer);assert.ok(peer,'Unknown trace peer');
    if(row.kind){assert.ok(['socket_open','socket_close'].includes(row.kind));peer[row.kind==='socket_open'?'opens':'closes']++;continue;}
    assert.notEqual(typeof row.text==='string',typeof row.binary_base64==='string','Trace record needs one exact WS payload');
    let value,header=null,bytes=null;
    if(typeof row.text==='string')value=JSON.parse(row.text);
    else{
      assert.equal(row.direction,'received');assert.equal(peer.wire_version,2);
      bytes=Buffer.from(row.binary_base64,'base64');assert.equal(bytes.toString('base64'),row.binary_base64);
      value=peer.decoder.decode(new Uint8Array(bytes));header=peer.decoder.state;
      assert.equal(header.stream,BigInt(peer.stream),'Socket stream identity changed');
    }
    if(row.direction==='sent'){peer.sent.push({row,value});continue;}
    assert.equal(row.direction,'received');peer.received.push({row,value,header});
    if(value.t==='welcome'){
      peer.welcomes++;assert.equal(value.id,peer.player);
      if(peer.wire_version===2){assert.equal(value.frontline_wire_version,2);peer.stream=value.frontline_wire_stream;}continue;
    }
    if(value.t!=='frontline')continue;const m=value.message;
    if(m.op==='ended'){if(m.battle===trace.old_battle)peer.ended.push({row,message:m});continue;}
    if(m.op==='left'){peer.left++;continue;}
    if(m.op==='room'||m.op==='snapshot'){
      const room=m.room,mine=room.members.find(v=>v.player===peer.player);assert.ok(mine);
      assert.equal(mine.observer,peer.observer);assert.equal(mine.connected,true);if(!peer.observer)assert.equal(mine.team,peer.team);
      if(room.battle===trace.old_battle&&room.round_state==='intermission'){
        assert.equal(room.started,false);assert.equal(mine.controlled,null);
        assert.equal(room.result?.battle,trace.old_battle);assert.equal(room.result?.reason,'time');assert.ok(finite(room.next_round_s)&&room.next_round_s>=0&&room.next_round_s<=trace.fixture.intermission_seconds+1e-6);
        assert.ok(room.round_elapsed_s+1e-6>=trace.fixture.round_seconds);peer.intermission.push({row,room});
      }
      if(m.op==='snapshot'){
        checkAudience(m,peer,room.battle);
        if(room.battle===trace.new_battle&&!peer.firstNewSnapshot){
          const oldSnapshot=peer.received.find(p=>p.value.t==='frontline'&&p.value.message.op==='snapshot'&&p.value.message.room.battle===trace.old_battle)?.value.message;
          assert.ok(oldSnapshot);const initial=oldSnapshot.room;
          assert.equal(room.id,initial.id);assert.equal(room.map,initial.map);assert.equal(room.map_revision,initial.map_revision);assert.equal(room.era,initial.era);assert.equal(room.round_number,initial.round_number+1);
          assert.equal(room.round_state,'battle');assert.equal(room.started,true);assert.equal(room.result,null);assert.equal(room.next_round_s,null);assert.ok(room.round_elapsed_s>=0&&room.round_elapsed_s<.1);
          assert.equal(mine.controlled,null);assert.equal(mine.company,null);
          const ownOldEpoch=Math.max(...peer.received.filter(p=>p.value.message?.room?.battle===trace.old_battle).map(p=>p.value.message.room.members.find(v=>v.player===peer.player)?.epoch||0));
          assert.ok(mine.epoch>ownOldEpoch,'Control epochs must not survive a new round');
          assert.ok(m.units.every(u=>u.unit.battle===trace.new_battle));assert.ok(m.aircrafts.every(u=>u.unit.battle===trace.new_battle));assert.ok(m.companies.every(v=>v.owner===null),'Old player companies survived reset');assert.equal(m.facility_jobs.length,0);
          peer.firstNewSnapshot={row,message:m};
        }
      }
    }
    if(m.op==='frame'){
      checkAudience(m,peer,m.battle);assert.ok(m.units.concat(m.aircrafts).every(u=>u.unit.battle===m.battle));
      if(m.battle===trace.old_battle){assert.ok(!peer.firstNewSnapshot,'Old battle frame arrived after its replacement Snapshot');if(header){peer.lastOldHeader=header;peer.lastOldBinary=bytes;}}
      if(m.battle===trace.new_battle&&!peer.firstNewFrame){
        assert.ok(peer.firstNewSnapshot,'New frame preceded the authorized new-battle Snapshot');assert.ok(m.tick>=0&&m.tick<10);
        if(peer.wire_version===2){assert.ok(header.full,'New battle needs a fresh wire full');assert.ok(header.epoch>peer.lastOldHeader.epoch);assert.equal(header.baseTick,0n);}
        peer.firstNewFrame={row,message:m,header};
      }
      if(m.battle===trace.new_battle)for(const event of m.events)for(const field of ['unit','shooter','target'])if(event[field]?.battle!==undefined)assert.equal(event[field].battle,trace.new_battle,'Old event cursor leaked across battles');
    }
  }
  const summary={};
  for(const peer of peers.values()){
    assert.equal(peer.opens,1);assert.equal(peer.closes,1);assert.equal(peer.welcomes,1);assert.equal(peer.ended.length,1);assert.equal(peer.left,1);assert.ok(peer.intermission.length>=1);assert.ok(peer.firstNewSnapshot&&peer.firstNewFrame);
    const first=peer.intermission[0],last=peer.intermission.at(-1);
    assert.ok(peer.firstNewSnapshot.row.at_s-first.row.at_s>=trace.fixture.intermission_seconds-.15,'Intermission reset prematurely');assert.ok(Math.abs(last.room.round_elapsed_s-first.room.round_elapsed_s)<1e-6,'Native battle continued during intermission');
    if(!peer.observer){
      const controlledSnapshots=peer.received.filter(p=>p.value.message?.op==='snapshot').map(p=>({row:p.row,m:p.value.message,mine:p.value.message.room.members.find(v=>v.player===peer.player)})).filter(p=>p.mine.controlled);
      const old=controlledSnapshots.filter(p=>p.m.room.battle===trace.old_battle),fresh=controlledSnapshots.filter(p=>p.m.room.battle===trace.new_battle);assert.ok(old.length&&fresh.length);
      const air=peer.name==='blue',original=old.find(p=>!!entity(p.m,p.mine.controlled,true)===air),replacement=fresh.find(p=>!!entity(p.m,p.mine.controlled,true)===air);assert.ok(original&&replacement);
      const ref=original.mine.controlled,newRef=replacement.mine.controlled;assert.notEqual(refKey(ref),refKey(newRef));
      const initialStock=ammo(entity(original.m,ref,air),air);assert.ok(peer.received.some(p=>p.value.message?.op==='frame'&&p.value.message.battle===trace.old_battle&&entity(p.value.message,ref,air)&&ammo(entity(p.value.message,ref,air),air)<initialStock),'Missing actual old stock deficit');
      assert.equal(ammo(entity(replacement.m,newRef,air),air),initialStock,'New life did not start with its own fresh stock');
      const stale=peer.sent.filter(p=>p.row.seq>peer.firstNewSnapshot.row.seq&&p.value.command?.unit?.battle===trace.old_battle);assert.ok(stale.length>=1);
      for(const sent of stale){const next=peer.sent.find(p=>p.row.seq>sent.row.seq);assert.ok(peer.received.some(p=>p.row.seq>sent.row.seq&&(!next||p.row.seq<next.row.seq)&&p.value.message?.op==='error'),'Old unit input was not explicitly rejected');}
      const seqOne=peer.sent.find(p=>p.row.seq>peer.firstNewSnapshot.row.seq&&p.value.command?.seq===1&&p.value.command?.unit?.battle===trace.new_battle);assert.ok(seqOne);
      const barrier=peer.received.find(p=>p.row.seq>seqOne.row.seq&&p.value.message?.op==='snapshot'&&refKey(p.value.message.room.members.find(v=>v.player===peer.player)?.controlled)===refKey(newRef));assert.ok(barrier);assert.ok(!peer.received.some(p=>p.row.seq>seqOne.row.seq&&p.row.seq<barrier.row.seq&&p.value.message?.op==='error'),'Fresh sequence1 was rejected after reset');assert.equal(ammo(entity(barrier.value.message,newRef,air),air),initialStock);
      const before=peer.decoder.state;assert.throws(()=>peer.decoder.decode(new Uint8Array(peer.lastOldBinary)),'Production decoder accepted an old battle packet');assert.deepEqual(peer.decoder.state,before,'Rejected stale packet poisoned new baseline');
    }
    summary[peer.name]={wire:peer.wire_version,received:peer.received.length,oldEndedEvents:peer.ended.length,intermissionSamples:peer.intermission.length,newTick:peer.firstNewFrame.message.tick,newWireEpoch:peer.firstNewFrame.header?.epoch??null};
  }
  const red=peers.get('red'),obsoleteOrder=red.sent.find(p=>p.row.seq>red.firstNewSnapshot.row.seq&&p.value.command?.op==='order');assert.ok(obsoleteOrder);const next=red.sent.find(p=>p.row.seq>obsoleteOrder.row.seq);assert.ok(red.received.some(p=>p.row.seq>obsoleteOrder.row.seq&&(!next||p.row.seq<next.row.seq)&&p.value.message?.op==='error'),'Recycled old company order was accepted');
  assert.ok(Object.values(trace.native_assertions||{}).length>=6&&Object.values(trace.native_assertions).every(v=>v===true));
  return{pass:true,scope:'Actual native TCP/WS short-round lifecycle replayed through production JS wire decoder',productionDurationCertified:false,browserRenderingCertified:false,maxPopulationCertified:false,oldBattle:trace.old_battle,newBattle:trace.new_battle,fixture:trace.fixture,decoderSha256:sha(decoderSource),peers:summary};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [input,output]=process.argv.slice(2);assert.ok(input&&output,'Usage: node frontline-round-trace-validate.mjs trace.json NEW-result.json');assert.ok(!fs.existsSync(output),'Never overwrite earlier evidence');
  let result;try{const bytes=fs.readFileSync(input);result={...validateRoundTransitionTrace(JSON.parse(bytes)),traceSha256:sha(bytes)};}catch(error){result={pass:false,error:String(error.stack||error),productionDurationCertified:false};process.exitCode=1;}
  fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true});fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}
