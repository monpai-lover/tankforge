import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {loadData} from '../tools/load-data.mjs';
let api;try{api=await import('../src/game/replaySession.js');}catch{}
const receipt=JSON.parse(fs.readFileSync(new URL('../../../target/replay-network-r5-20261013.json',import.meta.url))),catalog=loadData();
const packets=(name,scenario='gap')=>receipt.phases.filter(p=>p.name===name&&p.scenario===scenario).map(p=>p.recipients.find(q=>q.message.replay)?.message.replay).filter(Boolean);
function session(evidence){assert.equal(typeof api?.createReplaySession,'function');let disposed=0;const target={hullBounds:{min:[-2,0,-3],max:[2,3,3]},dispose(){disposed++;}};return {s:api.createReplaySession(null,target,evidence,'offensive',{catalog}),target,disposed:()=>disposed};}
test('real 1→3→late2→duplicate3→fatal4 keeps one target, one played clock and latest state',()=>{
  const [one,two,three,fatal]=packets('gap_1_3_late_2_fatal_older_cause'),f=session(one),s=f.s;s.tick(2.5);const first=s.prepareFrame(1),knots=s.clock.knots,quarter=s.clock.physicalAt(.25);
  assert.equal(s.append(three).accepted,true);const before=s.prepareFrame(2),time=s.filmTimeS;
  const late=s.append(two);assert.equal(late.accepted,true);assert.equal(late.late,true);assert.equal(s.filmTimeS,time);assert.equal(s.target,f.target);assert.equal(f.disposed(),0);
  const current=s.prepareFrame(3);assert.equal(current.stateVersion,3);assert.deepEqual(current.state,three.report.state);assert.equal(s.append(three).duplicate,true);
  assert.equal(s.append(fatal).terminal,true);s.promoteVictim(fatal.deaths[0]);assert.equal(s.purpose,'victim');assert.equal(s.target,f.target);assert.equal(s.filmTimeS,time);
  assert.equal(s.clock.physicalAt(.25),quarter);assert.ok(knots.every((k,i)=>s.clock.knots[i][0]===k[0]&&s.clock.knots[i][1]===k[1]));
  const frame=s.prepareFrame(4);assert.equal(s.prepareFrame(4),frame);assert.ok(Object.isFrozen(frame));assert.notEqual(before,frame);assert.equal(frame.sourceEventId,one.event_id);assert.equal(frame.terminalEventId,fatal.deaths[0].event_id);
  s.finish('test');s.finish('duplicate');assert.equal(f.disposed(),1);
});
test('bounded real native pressure preserves a pinned original cause and independent terminal',()=>{
  const [source]=packets('pin_source','retained'),ordinary=packets('pin_ordinary','retained'),[fatal]=packets('pin_beyond_ring_compaction','retained'),{s}=session(source);
  for(const e of ordinary){s.append(e);s.tick(.01);s.prepareFrame(e.commit_seq);}
  assert.ok(s.diagnostics().events<=64);assert.ok(s.diagnostics().slots<=4096);assert.equal(s.hasPinnedCause(source.event_id),true);
  const result=s.append(fatal);assert.equal(result.terminal,true);s.promoteVictim(fatal.deaths[0]);const frame=s.prepareFrame(1000);
  assert.equal(frame.sourceEventId,source.event_id);assert.equal(frame.terminalEventId,fatal.deaths[0].event_id);assert.ok(s.diagnostics().mechanismNodes<=16);
});
test('same actor different life rejects without snapshot, state or clock mutation',()=>{
  const [one]=packets('gap_1_3_late_2_fatal_older_cause'),{s,disposed}=session(one),old=s.prepareFrame(1),bad=structuredClone(one);bad.actor.life++;
  assert.equal(s.append(bad).accepted,false);assert.equal(s.prepareFrame(1),old);assert.equal(disposed(),0);
});

test('actual 35-second delayed fatal appends a bounded future film span without changing played samples',()=>{
  const [one,,,fatal]=packets('gap_1_3_late_2_fatal_older_cause'),{s}=session(one);
  s.tick(2.5);const before=Array.from({length:251},(_,i)=>s.clock.physicalAt(i/100)),played=s.filmTimeS;
  assert.equal(s.append(fatal).terminal,true);s.promoteVictim(fatal.deaths[0]);
  assert.deepEqual(Array.from({length:251},(_,i)=>s.clock.physicalAt(i/100)),before);
  assert.ok(s.endFilm-played<=7.2,'35 seconds of recorded fire must not become 35 seconds of film');
  const frame=s.prepareFrame(70,s.endFilm);assert.equal(frame.terminalEventId,fatal.deaths[0].event_id);assert.equal(frame.state.destroyed,true);
});

test('invalid future clock anchors reject before source coverage, event or clock publication',()=>{
  const [one]=packets('gap_1_3_late_2_fatal_older_cause'),{s}=session(one),bad=structuredClone(one);
  bad.event_id='invalid-negative-time';bad.commit_seq=bad.state_after_version=2;bad.state_before_version=1;bad.launch_time_s=bad.impact_time_s=-1;
  const before=JSON.stringify(s.coverage.snapshot()),knots=s.clock.knots,n=s.events.length;
  assert.equal(s.append(bad).accepted,false);assert.equal(JSON.stringify(s.coverage.snapshot()),before);assert.equal(s.clock.knots,knots);assert.equal(s.events.length,n);
});

test('incompatible checkpoint incoming rejects its whole coverage transaction',()=>{
  const [ordinary]=packets('pin_ordinary','retained'),{s}=session(ordinary),packet=receipt.phases.find(p=>p.name==='retained_checkpoint'),c=structuredClone(packet.recipients.find(q=>q.message.replay_checkpoint).message.replay_checkpoint);
  c.incoming[0].build_hash='different-build';const before=JSON.stringify(s.coverage.snapshot()),knots=s.clock.knots;
  assert.equal(s.checkpoint(c),false);assert.equal(JSON.stringify(s.coverage.snapshot()),before);assert.equal(s.clock.knots,knots);assert.equal(s.events.length,1);
});

test('actual extinguish completion releases the independent source pin after its state arrival',()=>{
  const [one]=packets('gap_1_3_late_2_fatal_older_cause'),{s}=session(one),clear=receipt.phases.filter(p=>p.scenario==='reignition'&&p.name==='extinguish').flatMap(p=>p.recipients).find(q=>q.message.replay_commit?.record.state_after.active_fire_cause===null)?.message.replay_commit;
  assert.ok(clear);assert.equal(s.hasPinnedCause(one.event_id),true);assert.equal(s.commit(clear),true);
  s.prepareFrame(8,s.clock.filmAt(clear.record.time_s));assert.equal(s.hasPinnedCause(one.event_id),false);
});

test('bounded presentation pressure gives the fatal source trace slots before ordinary effects',()=>{
  // Explicit analysis pressure harness: copies recorded physical fragments; it never resolves damage.
  const base=receipt.phases.find(p=>p.name==='direct').recipients.find(q=>q.message.replay).message.replay;
  const record=i=>{const e=structuredClone(base);e.authority='analysis';e.event_id=`presentation-pressure:${i}`;e.commit_seq=e.state_after_version=i;e.deaths=[];
    e.report.fragments=Array.from({length:256},(_,j)=>({...structuredClone(base.report.fragments[j%base.report.fragments.length]),fragment_id:`${e.event_id}:fragment:${j}`}));return e;};
  const {s}=session(record(1));for(let i=2;i<65;i++)s.append(record(i));const fatal=record(65);fatal.deaths=[{event_id:'presentation-terminal:65',time_s:fatal.impact_time_s}];s.append(fatal);s.promoteVictim(fatal.deaths[0]);
  const frame=s.prepareFrame(999,s.clock.filmAt(base.impact_time_s+.001));assert.equal(frame.traces.length,4096);
  assert.ok(frame.traces.some(t=>t.eventId===fatal.event_id),'fatal recorded source stays visible under the trace cap');assert.ok(s.diagnostics().events<=64);
});

test('append, commit and checkpoint publish only after the cached outer frame ID changes',()=>{
  const [one,,three]=packets('gap_1_3_late_2_fatal_older_cause'),{s}=session(one),f=s.prepareFrame(10,.25);
  assert.equal(s.append(three).accepted,true);assert.equal(s.prepareFrame(10,.25),f);
  const c=structuredClone(receipt.phases.filter(p=>p.scenario==='reignition'&&p.name==='extinguish').flatMap(p=>p.recipients).find(q=>q.message.replay_commit?.record.state_after.active_fire_cause===null).message.replay_commit);
  c.record.event_id='frame-commit:4';c.record.commit_seq=c.record.state_after_version=4;c.record.state_before_version=3;
  assert.equal(s.commit(c),true);assert.equal(s.prepareFrame(10,.25),f);
  assert.equal(s.checkpoint({actor:one.actor,baseline_commit:0,covered_through:0,state_version:0,canonical_identity_binding:[],active_causes:[],cause_event_id:null,death_event_id:null,replay_available:false,incoming:[]}),true);
  assert.equal(s.prepareFrame(10,.25),f);assert.notEqual(s.prepareFrame(11,.25),f);s.finish();
});

test('a thousand continuous valid native receipt clones bound clock history without changing any earlier sample',()=>{
  const current=JSON.parse(fs.readFileSync(process.env.TG_REPLAY_NETWORK_RECEIPT||new URL('../../../target/replay-network-v3-cutover-final-r2-20261013.json',import.meta.url))),base=current.phases.filter(p=>p.scenario==='admitted_mg').flatMap(p=>p.recipients).map(q=>q.message.replay).find(e=>e&&!e.deaths.length),{s}=session(base);
  const initial=Array.from({length:11},(_,i)=>{const t=i/100,p=s.clock.physicalAt(t);return[t,p,s.clock.filmAt(p)];});
  for(let i=1;i<=1000;i++){
    const e=structuredClone(base),contact=s.clock.physicalAt(s.endFilm+.1)+.02;e.event_id=`clock-bound:${i}`;e.shot_id=`clock-bound-shot:${i}`;e.commit_seq=e.state_after_version=base.commit_seq+i;e.state_before_version=e.state_after_version-1;e.launch_time_s=e.impact_time_s=contact;e.deaths=[];e.mechanism_records=[];
    s.prepareFrame(`played:${i}`,s.endFilm+.1);assert.equal(s.append(e).accepted,true);s.prepareFrame(`next:${i}`,s.endFilm+.1);
  }
  assert.deepEqual(initial.map(([t,p])=>[t,s.clock.physicalAt(t),s.clock.filmAt(p)]),initial);const d=s.diagnostics();assert.ok(d.clockKnots<=256);assert.ok(d.clockProtectedTails<=256);assert.ok(d.clockProtectedKnots<=256*256);assert.ok(d.clockAnchorOverflow>0);assert.equal(d.clockPressure,true);s.finish();
});

test('simultaneously active overflow preserves body identity and timing in bounded explicit summaries',()=>{
  const current=JSON.parse(fs.readFileSync(process.env.TG_REPLAY_NETWORK_RECEIPT||new URL('../../../target/replay-network-v3-cutover-final-r2-20261013.json',import.meta.url))),base=current.phases.filter(p=>p.scenario==='admitted_mg').flatMap(p=>p.recipients).map(q=>q.message.replay).find(e=>e&&!e.deaths.length);
  const record=i=>{const e=structuredClone(base);e.authority='analysis';e.event_id=`active-body:${i}`;e.shot_id=`active-shot:${i}`;e.commit_seq=e.state_after_version=i;e.state_before_version=i-1;e.deaths=[];return e;};
  const {s}=session(record(1));for(let i=2;i<=70;i++)assert.equal(s.append(record(i)).accepted,true);
  const body=s.summaries.find(e=>e.id==='active-body:1')?.traces.find(t=>t.body&&t.end_s>t.start_s);assert.ok(body,'active ordinary body is represented after leaving the64 full reports');
  const f=s.prepareFrame(70,s.clock.filmAt((body.start_s+body.end_s)/2));assert.ok(f.bodySummaries.some(p=>p.eventId==='active-body:1'));assert.ok(f.bodyBudgetOverflow>0);assert.equal(s.diagnostics().events,64);assert.ok(s.diagnostics().summaryEvents<=64);assert.ok(s.diagnostics().decorativeAggregated>=0);s.finish();
});

test('checkpoint summary-capacity rejection rolls back every earlier incoming record in the same packet',()=>{
  const current=JSON.parse(fs.readFileSync(process.env.TG_REPLAY_NETWORK_RECEIPT||new URL('../../../target/replay-network-v3-cutover-final-r2-20261013.json',import.meta.url))),base=current.phases.filter(p=>p.scenario==='admitted_mg').flatMap(p=>p.recipients).map(q=>q.message.replay).find(e=>e&&!e.deaths.length);
  const record=i=>{const e=structuredClone(base);e.event_id=`checkpoint-cap:${i}`;e.shot_id=`checkpoint-shot:${i}`;e.commit_seq=e.state_after_version=i;e.state_before_version=i-1;e.deaths=[];return e;};
  const {s}=session(record(1));for(let i=2;i<=127;i++)assert.equal(s.append(record(i)).accepted,true);
  const before=JSON.stringify({coverage:s.coverage.snapshot(),events:s.events.map(e=>e.id),summaries:s.summaries.map(e=>e.id)}),knots=s.clock.knots;
  const c={actor:base.actor,baseline_commit:127,covered_through:129,state_version:129,canonical_identity_binding:[[128,'checkpoint-cap:128'],[129,'checkpoint-cap:129']],active_causes:[],cause_event_id:null,death_event_id:null,replay_available:true,incoming:[record(128),record(129)]};
  assert.equal(s.checkpoint(c),false);assert.equal(JSON.stringify({coverage:s.coverage.snapshot(),events:s.events.map(e=>e.id),summaries:s.summaries.map(e=>e.id)}),before);assert.equal(s.clock.knots,knots);s.finish();
});
