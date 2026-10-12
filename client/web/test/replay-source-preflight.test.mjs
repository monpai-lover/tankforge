import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {runtime} from './live-network-rig.mjs';
import {validateReplayCheckpoint} from '../src/game/replayEvidence.js';
const receipt=JSON.parse(fs.readFileSync(process.env.TG_REPLAY_NETWORK_RECEIPT||new URL('../../../target/replay-network-r3-20261012.json',import.meta.url)));
const phases=name=>receipt.phases.filter(p=>p.name===name&&p.scenario==='retained');
const owner=p=>p.recipients.find(r=>r.message.replay)?.message;
function fixture(pressure=false){const r=runtime('casual',{combat:null}),source=owner(phases('pin_source')[0]),ordinary=phases('pin_ordinary').map(owner),id=source.target;for(const p of phases('admission')){const own=p.recipients.filter(q=>q.to===id);for(const q of own.slice(own.findIndex(q=>q.message.t==='welcome')))assert.notEqual(r.net._receive(q.message),false);}r.net._receive(source);if(pressure)for(const m of ordinary.slice(1,64))r.net._receive(m);const checkpoint=structuredClone(phases('retained_checkpoint')[0].recipients.find(q=>q.to===id&&q.message.replay_checkpoint).message);return{r,source,ordinary,checkpoint};}
function before(r){const c=r.net.replayCoverage;return{snapshot:structuredClone(c.snapshot()),bindings:[...c.bindings],proofs:[...c.proofs],sources:[...c.sources],pending:[...c.pendingSources],deaths:[...c.deaths],pinned:c.pinned,fatal:c.fatal,state:r.G.cstate,caps:r.G.caps,evidence:r.G.replayEvidence,commit:r.G.replayCommit,checkpoint:r.G.replayCheckpoint,dead:r.G.online.dead,hp:r.G.online.hp};}
function unchanged(r,accepted){const after=before(r);assert.deepEqual(after,accepted);for(const k of ['pinned','fatal','state','caps','evidence','commit','checkpoint'])assert.equal(after[k],accepted[k],`rejected ${k} retains accepted object`);}
function calls(r){const accepted=[];for(const kind of ['replay_evidence','replay_commit','replay_checkpoint','replay_coverage','replay_checkpoint_required','damage','status'])r.net.on(kind,()=>accepted.push(kind));return accepted;}

test('whole native checkpoint fingerprints use pre-admission sources before an earlier missing source can evict them',()=>{
  const {r,ordinary,checkpoint}=fixture(true),rewrite=structuredClone(ordinary[1].replay);rewrite.report.title+=' contradictory';checkpoint.replay_checkpoint.incoming.unshift(ordinary[0].replay,rewrite);
  assert.equal(r.net.replayCoverage.sources.size,64);assert.ok(r.net.replayCoverage.sources.has(rewrite.event_id));assert.equal(validateReplayCheckpoint(checkpoint.replay_checkpoint,r.net.replayCoverage.actor),true);
  const accepted=before(r),events=calls(r);assert.equal(r.net._receive(checkpoint),false);assert.deepEqual(events,[]);unchanged(r,accepted);
  assert.equal(r.net.replayCoverage.preflight({checkpoint:checkpoint.replay_checkpoint}),'rewritten_checkpoint_source');unchanged(r,accepted);
});
test('valid native missing source and known unchanged source still precede checkpoint proofs',()=>{
  const {r,ordinary,checkpoint}=fixture(true);checkpoint.replay_checkpoint.incoming.unshift(ordinary[0].replay,ordinary[1].replay);let evidence=0;r.net.on('replay_evidence',()=>evidence++);
  assert.notEqual(r.net._receive(checkpoint),false);assert.equal(evidence,2);assert.equal(r.net.replayCoverage.retiredThrough,88);assert.equal(r.G.cstate.destroyed,true);assert.equal(r.G.online.dead,true);assert.equal(r.G.online.hp,0);
});
test('unknown same-envelope source rewrites reject before later rows can evict their first fingerprint',()=>{
  for(const direct of [false,true]){const {r,ordinary,checkpoint}=fixture(),rewrite=structuredClone(ordinary[0].replay);assert.equal(r.net.replayCoverage.sources.has(rewrite.event_id),false);rewrite.report.title+=' contradictory';
    checkpoint.replay_checkpoint.incoming.unshift(...ordinary.slice(0,64).map(m=>m.replay),rewrite);assert.equal(checkpoint.replay_checkpoint.incoming.length,66);assert.equal(validateReplayCheckpoint(checkpoint.replay_checkpoint,r.net.replayCoverage.actor),true);
    const accepted=before(r),events=calls(r);assert.equal(direct?r.net.replayCoverage.checkpoint(checkpoint.replay_checkpoint):r.net._receive(checkpoint),false);assert.deepEqual(events,[]);unchanged(r,accepted);
  }
});
test('matching original source fingerprints allow genuine appended mechanism, compaction and terminal records',()=>{
  const {r,source,checkpoint}=fixture(),fatal=checkpoint.replay_checkpoint.incoming.find(e=>e.deaths.length);assert.ok(fatal);assert.ok(fatal.mechanism_records.length);assert.ok(fatal.mechanism_compaction);assert.ok(fatal.capabilities.includes('mechanism_prefix_compacted'));
  checkpoint.replay_checkpoint.incoming.unshift(source.replay);assert.equal(validateReplayCheckpoint(checkpoint.replay_checkpoint,r.net.replayCoverage.actor),true);assert.equal(r.net.replayCoverage.preflight({checkpoint:checkpoint.replay_checkpoint}),null);
  let terminal=0;r.net.on('replay_evidence',e=>{if(e.deaths.length)terminal++;});assert.notEqual(r.net._receive(checkpoint),false);assert.equal(terminal,1);assert.deepEqual(r.G.replayEvidence.report,source.replay.report);assert.equal(r.G.online.dead,true);
});
