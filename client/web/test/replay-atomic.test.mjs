import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {runtime} from './live-network-rig.mjs';
import {validateReplayCheckpoint,validateReplayEvidence} from '../src/game/replayEvidence.js';
const receipt=JSON.parse(fs.readFileSync(process.env.TG_REPLAY_NETWORK_RECEIPT||new URL('../../../target/v3-task1-quality-r2-20261012-native-replay.json',import.meta.url)));
const phases=(name,scenario='gap')=>receipt.phases.filter(p=>p.name===name&&p.scenario===scenario);
const owner=p=>p.recipients.find(r=>r.message.replay)?.message;
const packets=()=>phases('gap_1_3_late_2_fatal_older_cause').map(owner);
function admitted(scenario='gap'){const r=runtime('casual',{combat:null}),id=owner(phases(scenario==='gap'?'gap_1_3_late_2_fatal_older_cause':'pin_source',scenario)[0]).target;for(const p of phases('admission',scenario)){const own=p.recipients.filter(q=>q.to===id);for(const q of own.slice(own.findIndex(q=>q.message.t==='welcome')))assert.notEqual(r.net._receive(q.message),false);}return r;}
const checkpoint=r=>structuredClone(phases('coverage_checkpoint')[0].recipients.find(q=>q.to===r.net.id&&q.message.replay_checkpoint).message);
function admissionState(r){const c=r.net.replayCoverage;return {diagnostics:structuredClone(c.snapshot()),proofs:[...c.proofs],bindings:[...c.bindings],sources:[...c.sources],pending:[...c.pendingSources],deaths:[...c.deaths],pinned:c.pinned,fatal:c.fatal,state:r.G.cstate,caps:r.G.caps,evidence:r.G.replayEvidence,checkpoint:r.G.replayCheckpoint,commit:r.G.replayCommit,dead:r.G.online.dead};}
function unchanged(r,before){const after=admissionState(r);assert.deepEqual(after,before);for(const k of ['pinned','fatal','state','caps','evidence','checkpoint','commit'])assert.equal(after[k],before[k],`rejected ${k} retains its accepted object`);}
function acceptedCount(r){const calls=[];for(const kind of ['replay_evidence','replay_commit','replay_checkpoint','replay_coverage','replay_checkpoint_required','damage','status'])r.net.on(kind,()=>calls.push(kind));return calls;}

test('conflicting native checkpoint rejects all admission before any callback and leaves genuine fatal eligible',()=>{
  const r=admitted(),[one,,three,fatal]=packets();r.net._receive(one);r.net._receive(three);
  const bad=checkpoint(r);bad.replay_checkpoint.canonical_identity_binding[2][1]='contradictory:commit3';assert.equal(validateReplayCheckpoint(bad.replay_checkpoint,r.net.replayCoverage.actor),true);
  const before=admissionState(r),calls=acceptedCount(r);assert.equal(r.net._receive(bad),false);assert.deepEqual(calls,[]);unchanged(r,before);
  let terminal;r.net.on('damage',m=>{if(m.killed)terminal=m._replayPresentDeath;});r.net._receive(fatal);
  assert.equal(terminal,true);assert.equal(r.G.cstate.destroyed,true);assert.equal(r.G.online.dead,true);assert.equal(r.G.online.hp,0);
});
test('rejected native prefix checkpoint preserves range, maps, pending identities and accepted runtime state',()=>{
  for(const direct of [false,true]){const r=admitted();r.net._receive(packets()[0]);const bad=checkpoint(r);bad.replay_checkpoint.incoming=[];bad.replay_checkpoint.canonical_identity_binding[0][1]='contradictory:commit1';
    const before=admissionState(r),calls=acceptedCount(r);assert.equal(direct?r.net.replayCoverage.checkpoint(bad.replay_checkpoint):r.net._receive(bad),false);assert.deepEqual(calls,[]);unchanged(r,before);
  }
});
test('rejected native terminal identity preserves source pin and fatal for receive and direct admission',()=>{
  for(const direct of [false,true]){const r=admitted(),[one,,,fatal]=packets();r.net._receive(one);r.net._receive(fatal);const before=admissionState(r),calls=acceptedCount(r),bad=structuredClone(fatal);
    bad.replay.deaths[0].event_id='contradictory:death4';bad.owner_commit.record.event_id='contradictory:death4';bad.owner_commit.death_event_id='contradictory:death4';
    assert.equal(direct?r.net.replayCoverage.evidence(bad.replay):r.net._receive(bad),direct?null:false);assert.deepEqual(calls,[]);unchanged(r,before);
  }
});
test('later rewritten incoming source rolls back earlier genuine checkpoint terminal admission',()=>{
  const r=admitted(),[one,,three]=packets();r.net._receive(one);r.net._receive(three);const bad=checkpoint(r);
  // Native reconnect expires ordinary reports; append the actual retained packet to
  // exercise a later source conflict after the checkpoint's genuine first fatal.
  const row=structuredClone(three.replay);row.report.title+=' contradictory';bad.replay_checkpoint.incoming.push(row);
  const before=admissionState(r),calls=acceptedCount(r);assert.equal(r.net._receive(bad),false);assert.deepEqual(calls,[]);unchanged(r,before);
});
test('atomic envelope staging preserves real late gaps, header-first sources and single fatal presentation',()=>{
  const r=admitted(),[one,two,three,fatal]=packets();let emitted=0;r.net.on('replay_evidence',()=>emitted++);
  r.net._receive(one);r.net._receive(three);const state=r.G.cstate;assert.equal(r.net.replayCoverage.retiredThrough,1);
  r.net._receive(two);assert.equal(r.G.cstate,state);assert.equal(r.net.replayCoverage.retiredThrough,3);r.net._receive(three);assert.equal(emitted,3);
  const status=phases('gap_1_3_late_2_fatal_older_cause')[3].recipients.find(q=>q.to===r.net.id&&q.message.t==='status').message;r.net._receive(status);assert.equal(r.G.online.dead,true);assert.equal(r.G.online.hp,0);
  r.net._receive(fatal);assert.equal(emitted,4);assert.equal(r.G.replayEvidence.deaths.length,1);r.net._receive(fatal);assert.equal(emitted,4);
  const headerFirst=admitted(),header={...one};delete header.replay;delete header.report;let count=0;headerFirst.net.on('replay_evidence',()=>count++);headerFirst.net._receive(header);headerFirst.net._receive(one);headerFirst.net._receive(one);assert.equal(count,1);
});
test('atomic staging preserves bounded eviction, sparse pressure, current health and first old fatal',()=>{
  const ordinary=phases('pin_ordinary','retained').map(owner),source=owner(phases('pin_source','retained')[0]),fatal=owner(phases('pin_beyond_ring_compaction','retained')[0]);
  for(const sparse of [false,true]){const r=admitted('retained');let emitted=0;r.net.on('replay_evidence',()=>emitted++);if(!sparse)r.net._receive(source);for(const m of ordinary)r.net._receive(m);
    assert.equal(r.net.replayCoverage.retiredThrough,sparse?0:67);assert.equal(r.net.replayCoverage.stateVersion,67);assert.ok(r.net.replayCoverage.sources.size<=64);assert.ok(r.net.replayCoverage.proofs.size<=64);assert.ok(r.net.replayCoverage.pendingSources.size<=64);
    const count=emitted,state=r.G.cstate,evidence=r.G.replayEvidence;r.net._receive(ordinary[0]);r.net._receive(ordinary.at(-1));assert.equal(emitted,count);assert.equal(r.G.cstate,state);assert.equal(r.G.replayEvidence,evidence);
  }
  const old=admitted('retained');let deaths=0;old.net.on('replay_evidence',e=>{if(e.deaths.length)deaths++;});for(const m of [source,...ordinary]){const header={...m};delete header.replay;delete header.report;old.net._receive(header);}
  assert.equal(old.net.replayCoverage.pendingSources.has(1),false);old.net._receive(fatal);assert.equal(deaths,1);assert.equal(old.G.online.dead,true);old.net._receive(fatal);assert.equal(deaths,1);
});
test('wrong-life envelope cannot reset previously accepted coverage to the new provider actor',()=>{
  const r=admitted(),one=packets()[0];r.net._receive(one);const before=admissionState(r),calls=acceptedCount(r),next={...r.net.replayCoverage.actor,life:r.net.replayCoverage.actor.life+1};r.net.replayActorProvider=()=>next;
  assert.equal(r.net._receive(one),false);assert.deepEqual(calls,[]);unchanged(r,before);
});
test('valid native fatal checkpoint applies death independently of later presentation dedupe',()=>{
  const r=admitted(),[one,,,fatal]=packets();r.net._receive(one);let presentations=0;r.net.on('replay_evidence',e=>{if(e.deaths.length)presentations++;});
  r.net._receive(checkpoint(r));assert.equal(presentations,1);assert.equal(r.G.cstate.destroyed,true);assert.equal(r.G.online.dead,true);assert.equal(r.G.online.hp,0);assert.ok(r.notices.some(n=>n.text.startsWith('載具已被擊毀')),'header-only death does not fabricate abandonment or an attacker');
  const diedAt=r.G.online.diedAt;r.net._receive(fatal);assert.equal(presentations,1);assert.equal(r.G.online.dead,true);assert.equal(r.G.online.diedAt,diedAt);
});
test('conflicting native header alone cannot change canonical or pending admission',()=>{
  const r=admitted(),one=packets()[0];r.net._receive(one);const bad=structuredClone(one);delete bad.replay;delete bad.report;bad.owner_commit.record.event_id='contradictory:header1';
  const before=admissionState(r),calls=acceptedCount(r);assert.equal(r.net._receive(bad),false);assert.deepEqual(calls,[]);unchanged(r,before);
});
test('all native mechanism record identities preflight before source and terminal publication',()=>{
  const r=admitted(),[one,,three,fatal]=packets();r.net._receive(one);r.net._receive(three);const bad=structuredClone(fatal),record=bad.replay.mechanism_records[0];assert.ok(record);
  record.commit_seq=3;record.state_before_version=2;record.state_after_version=3;record.event_id='contradictory:mechanism3';
  assert.equal(validateReplayEvidence(bad.replay,r.net.replayCoverage.actor).ok,true);
  const before=admissionState(r),calls=acceptedCount(r);assert.equal(r.net._receive(bad),false);assert.deepEqual(calls,[]);unchanged(r,before);
});
