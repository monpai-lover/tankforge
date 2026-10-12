import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {NetClient} from '../src/game/net.js';

const receipt=JSON.parse(fs.readFileSync(process.env.TG_REPLAY_NETWORK_RECEIPT||new URL('../../../target/replay-network-v3-task1-final.json',import.meta.url)));
const native=receipt.phases.find(p=>p.name==='direct').recipients.find(r=>r.message.replay).message;

test('production receive rejects malformed owner evidence before any damage listener acquires a snapshot',()=>{
  const client=new NetClient();client.id=native.target;client.replayActorProvider=()=>native.replay.actor;
  let acquired=0;client.on('damage',()=>acquired++);
  const bad=structuredClone(native);bad.replay.accepted_pose.ex=[2,0,0];
  assert.equal(client._receive(bad),false);
  assert.equal(acquired,0);
});
test('production receive rejects a stale life before any damage listener',()=>{
  const client=new NetClient();client.id=native.target;client.replayActorProvider=()=>({...native.replay.actor,life:native.replay.actor.life+1});
  let acquired=0;client.on('damage',()=>acquired++);
  assert.equal(client._receive(native),false);assert.equal(acquired,0);
});
