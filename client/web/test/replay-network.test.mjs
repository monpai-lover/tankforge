import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {runtime} from './live-network-rig.mjs';
const root=new URL('../../../',import.meta.url);
const receipt=JSON.parse(fs.readFileSync(process.env.TG_REPLAY_NETWORK_RECEIPT||new URL('target/replay-network-v3-task1-final.json',root)));
for(const [name,pin]of Object.entries(receipt.replay_sources)){const bytes=fs.readFileSync(new URL(name,root));assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),pin.sha256,`source-matched native receipt: ${name}`);assert.equal(bytes.toString('utf8'),pin.utf8);}
const phases=(name,scenario='gap')=>receipt.phases.filter(p=>p.name===name&&p.scenario===scenario);
const owner=p=>p.recipients.find(r=>r.message.replay)?.message;
function admitted(scenario='gap'){
  const r=runtime('casual',{combat:null});
  const id=owner(phases(scenario==='gap'?'gap_1_3_late_2_fatal_older_cause':scenario==='retained'?'pin_source':scenario,scenario)[0]).target;
  for(const p of phases('admission',scenario)){const own=p.recipients.filter(q=>q.to===id);for(const q of own.slice(own.findIndex(q=>q.message.t==='welcome')))assert.notEqual(r.net._receive(q.message),false);}
  assert.ok(r.onlineAmmo.scope());assert.ok(r.G.online);return r;
}
test('native production owner headers prove 1,3,late2,duplicate3,fatal4 and do not regress state',()=>{
  const r=admitted(),[one,two,three,fatal]=phases('gap_1_3_late_2_fatal_older_cause').map(owner);
  assert.ok(one.owner_commit,'native owner commit required');
  let evidence=0;r.net.on('replay_evidence',()=>evidence++);
  r.net._receive(one);r.net._receive(three);const state3=r.G.cstate;
  assert.equal(r.net.replayCoverage.retiredThrough,1);assert.equal(r.net.replayCoverage.stateVersion,3);
  for(const p of phases('snapshot_before_fatal'))for(const q of p.recipients)if(q.to===r.net.id)r.net._receive(q.message);
  assert.equal(r.net.replayCoverage.retiredThrough,1,'normal snap cannot close missing commit2');
  r.net._receive(two);assert.equal(r.G.cstate,state3);assert.equal(r.net.replayCoverage.retiredThrough,3);
  r.net._receive(three);assert.equal(evidence,3);
  r.net._receive(fatal);assert.equal(r.G.cstate.destroyed,true);assert.equal(r.G.caps.destroyed,true);assert.equal(r.net.replayCoverage.retiredThrough,4);
  assert.deepEqual(r.G.replayEvidence.report,one.replay.report);assert.equal(r.G.replayEvidence.deaths[0].cause_event_id,one.replay.event_id);
  r.net._receive(fatal);assert.equal(evidence,4,'duplicate old source plus duplicate death has no second presentation');
});
test('native status before fatal keeps terminal evidence eligible; checkpoint explicitly closes represented gap',()=>{
  const r=admitted(),[one,,three,fatal]=phases('gap_1_3_late_2_fatal_older_cause').map(owner);
  r.net._receive(one);r.net._receive(three);
  const p=phases('gap_1_3_late_2_fatal_older_cause')[3];const status=p.recipients.find(q=>q.to===r.net.id&&q.message.t==='status').message;
  r.net._receive(status);assert.equal(r.G.cstate.destroyed,true);assert.equal(r.net.replayCoverage.retiredThrough,1);
  r.net._receive(fatal);assert.equal(r.G.replayEvidence.deaths.length,1);
  const checkpoint=phases('coverage_checkpoint')[0].recipients.find(q=>q.to===r.net.id&&q.message.t==='status').message;
  r.net._receive(checkpoint);assert.equal(r.net.replayCoverage.retiredThrough,4);assert.ok(Object.isFrozen(r.G.replayCheckpoint.incoming[0].report));
});
test('production rejects stale owner header, rewritten original and excessive nested input before damage listener',()=>{
  const r=admitted(),one=owner(phases('gap_1_3_late_2_fatal_older_cause')[0]);let damage=0;r.net.on('damage',()=>damage++);
  const stale=structuredClone(one);stale.owner_commit.actor.life++;assert.equal(r.net._receive(stale),false);assert.equal(damage,0);
  r.net._receive(one);const rewrite=structuredClone(one);rewrite.replay.report.title+=' changed';assert.equal(r.net._receive(rewrite),false);assert.equal(damage,1);
  const over=structuredClone(one);over.replay.accepted_pose.running_gear=Array(1025).fill(null);assert.equal(r.net._receive(over),false);assert.equal(damage,1);
  const contradictory=structuredClone(one);contradictory.killed=true;assert.equal(r.net._receive(contradictory),false);assert.equal(damage,1);
  const reportRewrite=structuredClone(one);reportRewrite.report.title+=' changed';assert.equal(r.net._receive(reportRewrite),false);assert.equal(damage,1);
});

test('native pressure preserves old fatal source and checkpoint proves only its represented suffix',()=>{
  const r=admitted('retained');let pressure=0;r.net.on('replay_checkpoint_required',()=>pressure++);
  for(const p of phases('pin_ordinary','retained'))r.net._receive(owner(p));
  assert.ok(pressure>0);assert.ok(r.net.replayCoverage.proofs.size<=64);assert.equal(r.net.replayCoverage.retiredThrough,0);assert.equal(r.net.replayCoverage.stateVersion,67);
  const cp=phases('retained_checkpoint','retained')[0].recipients.find(q=>q.to===r.net.id&&q.message.t==='status').message;
  const fresh=admitted('retained');fresh.net._receive(cp);assert.equal(fresh.net.replayCoverage.retiredThrough,1,'source1 and suffix checkpoint cannot invent missing prefix2..baseline');
  r.net._receive(cp);assert.equal(r.net.replayCoverage.retiredThrough,88,'represented suffix joins actual existing proofs and retained source1');assert.deepEqual(r.net.replayCoverage.checkpointRange,[cp.replay_checkpoint.baseline_commit+1,cp.replay_checkpoint.covered_through]);
  const fatal=owner(phases('pin_beyond_ring_compaction','retained')[0]);r.net._receive(fatal);
  assert.equal(r.G.replayEvidence.deaths.length,1);assert.equal(r.G.replayEvidence.event_id,owner(phases('pin_source','retained')[0]).replay.event_id);assert.ok(r.G.replayEvidence.mechanism_compaction.count>=4);assert.equal(r.G.replayEvidence.mechanism_records.length,16);assert.equal(r.G.cstate.destroyed,true);
});

test('native canonical duplicates remain retired after ordinary fingerprint eviction',()=>{
  const r=admitted('retained');let emitted=0;r.net.on('replay_evidence',()=>emitted++);
  r.net._receive(owner(phases('pin_source','retained')[0]));
  const ordinary=phases('pin_ordinary','retained').map(owner);for(const packet of ordinary)r.net._receive(packet);
  assert.equal(r.net.replayCoverage.retiredThrough,67);assert.ok(r.net.replayCoverage.sources.size<=64);
  const before={emitted,state:r.G.cstate,caps:r.G.caps,evidence:r.G.replayEvidence};r.net._receive(ordinary[0]);
  assert.equal(emitted,before.emitted);assert.equal(r.G.cstate,before.state);assert.equal(r.G.caps,before.caps);assert.equal(r.G.replayEvidence,before.evidence);
  assert.equal(r.net.replayCoverage.evidence(ordinary[0].replay).source_status,'covered_prefix','an evicted retired identity does not assert prior presentation');
});
test('native sparse proof suppresses an evicted duplicate while health remains current',()=>{
  const r=admitted('retained');let emitted=0;r.net.on('replay_evidence',()=>emitted++);
  const ordinary=phases('pin_ordinary','retained').map(owner);for(const packet of ordinary)r.net._receive(packet);
  assert.equal(r.net.replayCoverage.retiredThrough,0);assert.equal(r.net.replayCoverage.stateVersion,67);assert.ok(r.net.replayCoverage.proofs.size<=64);
  const before={emitted,state:r.G.cstate,evidence:r.G.replayEvidence};r.net._receive(ordinary[0]);
  assert.equal(emitted,before.emitted);assert.equal(r.G.cstate,before.state);assert.equal(r.G.replayEvidence,before.evidence);
  const pressure=ordinary.at(-1);assert.equal(r.net.replayCoverage.evidence(pressure.replay).source_status,'coverage_pressure');
  r.net._receive(pressure);r.net._receive(pressure);assert.equal(emitted,before.emitted,'untracked sparse identities cannot create presentation exceptions');
});
test('native source arriving after its header presents once with bounded explicit pending identities',()=>{
  const r=admitted(),one=owner(phases('gap_1_3_late_2_fatal_older_cause')[0]);let emitted=0;r.net.on('replay_evidence',()=>emitted++);
  const header={...one};delete header.replay;delete header.report;r.net._receive(header);
  assert.equal(emitted,0);assert.equal(r.net.replayCoverage.retiredThrough,1);
  r.net._receive(one);assert.equal(emitted,1);r.net._receive(one);assert.equal(emitted,1);
  const retired=admitted('retained'),packets=[owner(phases('pin_source','retained')[0]),...phases('pin_ordinary','retained').map(owner)];
  for(const packet of packets){const onlyHeader={...packet};delete onlyHeader.replay;delete onlyHeader.report;retired.net._receive(onlyHeader);}
  assert.ok(retired.net.replayCoverage.pendingSources.size<=64);const late=packets[1].replay;
  assert.equal(retired.net.replayCoverage.evidence(late).source_status,'covered_prefix','expired header exception is explicitly covered, not presented');
});
test('native terminal source first observed behind headers still presents exactly once',()=>{
  const r=admitted(),[,,three,fatal]=phases('gap_1_3_late_2_fatal_older_cause').map(owner);let emitted=0;r.net.on('replay_evidence',()=>emitted++);
  r.net._receive(three);
  const status=phases('gap_1_3_late_2_fatal_older_cause')[3].recipients.find(q=>q.to===r.net.id&&q.message.t==='status').message;r.net._receive(status);
  assert.equal(r.G.cstate.destroyed,true);const before=emitted;r.net._receive(fatal);
  assert.equal(emitted,before+1);assert.equal(r.G.replayEvidence.event_id,fatal.replay.event_id);assert.equal(r.G.replayEvidence.deaths.length,1);
  r.net._receive(fatal);assert.equal(emitted,before+1);
  const retired=admitted('retained');let deaths=0;retired.net.on('replay_evidence',()=>deaths++);
  for(const packet of [owner(phases('pin_source','retained')[0]),...phases('pin_ordinary','retained').map(owner)]){const header={...packet};delete header.replay;delete header.report;retired.net._receive(header);}
  const oldFatal=owner(phases('pin_beyond_ring_compaction','retained')[0]);assert.equal(retired.net.replayCoverage.retiredThrough,67);assert.equal(retired.net.replayCoverage.pendingSources.has(1),false);
  retired.net._receive(oldFatal);assert.equal(deaths,1);assert.equal(retired.G.replayEvidence.deaths.length,1);retired.net._receive(oldFatal);assert.equal(deaths,1);
});
