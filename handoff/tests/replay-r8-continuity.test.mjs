import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const app=fs.readFileSync(process.env.TG_R8_APP||new URL('../bundle/app.js.html',import.meta.url),'utf8');
const section=(a,b)=>{const i=app.indexOf(a),j=app.indexOf(b,i+1);assert.ok(i>=0&&j>i,a);return app.slice(i,j);};
const catalog={projectiles:{filled50:{id:'filled50',kind:'apcbc',caliber_mm:50,mass_kg:2.06,explosive_mass_kg:.017}}};
const runtime=new Function('bulletShellOf','projectileProfile','projectileBodyStage','snapshotReplayTarget',
 (app.includes('function createCombatGeometryImmutable()')?section('function createCombatGeometryImmutable()','  // client/web/src/game/combat.js'):'')+
 section('  // client/web/src/game/replayRecords.js','  // client/web/src/game/projectileReplay.js')+
 section('  // client/web/src/game/replayClock.js','  // client/web/src/game/replayCamera.js')+
 section('  // client/web/src/game/replayEvidence.js','  // client/web/src/vendor/suppliedHitReplayV3.js')+
 section('  // client/web/src/game/hitcam.js','  // client/web/src/')+
 ';return {createReplaySession,validateReplayEvidence,HitCam};')(
 ()=>null,s=>({diameterM:s.caliber_mm/1000,family:'apcbc'}),()=>null,
 (_r,t)=>({...t,hullBounds:{min:[-2,0,-3],max:[2,3,3]},dispose(){t.releases++;}}));
export function evidence(n,{contact=10+n*.01,entity=2,fragments=0,fragmentTravel=.16}={}){
 const state={destroyed:false,modules:[],crew:[100]},pose={trust:'accepted',hull_origin:[0,0,0],ex:[1,0,0],ey:[0,1,0],ez:[0,0,1],joints:[],running_gear:[],payload:[],variants:[]};
 return {revision:1,authority:'offline',actor:{battle:1,entity,life:1},shooter:{battle:1,entity:1,life:1},event_id:`hit:${entity}:${n}`,shot_id:`shot:${entity}:${n}`,weapon_instance:'gun:0',projectile_id:'filled50',build_hash:'fixture-build',anatomy_hash:'fixture-anatomy',parent_mechanism_id:null,commit_seq:n,state_before_version:n-1,state_after_version:n,pose_revision:0,geometry_revision:0,seed:String(n),coordinates:'target_hull_metres',launch_time_s:contact-.2,impact_time_s:contact,accepted_pose:pose,state_before:state,capabilities:[],flight:[],flight_trust:'local_ballistic_world_segments_legacy_contact',segments:[{start_time_s:contact-.2,end_time_s:contact,from:[0,1,-100],to:[0,1,0]}],deaths:[],mechanism_records:[],report:{state,caps:{},impact:[0,1,0],shell_kind:'apcbc',title:'hit',events:[],modules:[],crew:[],fragments:Array.from({length:fragments},(_,j)=>({fragment_id:`spall:${entity}:${n}:${j}`,kind:'spall',from:[0,1,.3],to:[1,1,.3],start_s:.004,physical:{velocity_m_s:[1/fragmentTravel,0,0]},weight:1})),impact_events:[{event_id:`plate:${entity}:${n}`,entry:{body_id:'core',elapsed_s:0,velocity_m_s:[0,0,500]},output:{elapsed_s:.001,velocity_m_s:[0,0,400],remaining_pen_mm:20},entry_position:[0,1,0],exit_position:[0,1,.3],verdict:'penetrated',budget:{input_j:100,core_out_j:70}}],bursts:[{pos:[0,1,.8],radius:1,inside:true,explosive_kg:.0289,time_s:.004,armed_at_s:0,delay_s:.004,detonation_id:'core/charge:0/detonation:0',mechanism:'delayed_aphe'}]}};
}
function session(){const s=runtime.createReplaySession(null,{hullBounds:{min:[-2,0,-3],max:[2,3,3]}},evidence(1),'offensive',{catalog,holdS:10,maxFilmS:240});s.prepareFrame('first',4);return s;}
function facade(){
 const elements=new Map(),root={hidden:true,querySelector(k){if(!elements.has(k))elements.set(k,{style:{},dataset:{}});return elements.get(k);}},presentation={hide(){},warmUp(){}};
 const hc=new runtime.HitCam({root,catalog,presentation,projectiles:{},replayDrawFactory(){return {prepare(f){return {nodes:[],frame:f};},acquire(){},dispose(){}};}});
 const target=entity=>({actor:{battle:1,entity,life:1},model:{},releases:0});
 const show=(t,n)=>{const e=evidence(n,{entity:t.actor.entity});return hc.show(t,{...e.report,replay:e},catalog.projectiles.filled50,10,false,'','offensive');};
 return {hc,target,show};
}
test('late APHE body traversal survives display cadence even with much longer recorded spall paths',()=>{
 const s=session(),e=evidence(2,{fragments:24,fragmentTravel:.16}),start=s.filmTimeS;
 assert.equal(s.append(e).accepted,true);let bodyFrames=0;const flashes=[];
 for(let k=0;k<100;k++){
  const f=s.prepareFrame(`late:${k}`,start+k/60),p=f.projectiles.find(p=>p.eventId===e.event_id);
  if(p?.visible&&p.nose[2]>0&&p.nose[2]<.3)bodyFrames++;
  if(f.bursts.some(b=>b.eventId===e.event_id&&b.alpha>0))flashes.push(k);
 }
 assert.ok(bodyFrames>=3,`only ${bodyFrames} visible traversal frames`);
 assert.ok(flashes.length>=3,'recorded delayed detonation must survive frame cadence');
});
test('dense overlapping fragmentation gives every active round path slots under the4096 budget',()=>{
 const s=session(),start=s.filmTimeS;
 for(let n=2;n<=49;n++)assert.equal(s.append(evidence(n,{fragments:180})).accepted,true);
 const f=s.prepareFrame('dense',start+.5),seen=new Set(f.traces.map(t=>t.eventId));
 assert.ok(f.traces.length<=4096);assert.equal(f.projectiles.length<=64,true);
 for(let n=2;n<=49;n++)assert.ok(seen.has(`hit:2:${n}`),`no path slots for round${n}`);
});
test('continuous fire retires completed rounds on their own clocks instead of losing new shots',()=>{
 const s=session();let rejected=0,maxClocks=0;
 for(let n=2;n<=500;n++){
  if(!s.append(evidence(n,{contact:10+n*.01,fragments:8})).accepted)rejected++;
  s.tick(1/30);s.prepareFrame(`sustain:${n}`);maxClocks=Math.max(maxClocks,s.localStart.size);
 }
 assert.equal(rejected,0);assert.ok(maxClocks<=128,`unbounded local clock map ${maxClocks}`);
 const latest=s.events.at(-1),f=s.prepareFrame('last',s.filmTimeS+.2);
 assert.ok(f.projectiles.some(p=>p.eventId===latest.id)||f.traces.some(t=>t.eventId===latest.id));
});
test('100 rounds per second retire fading decoration before rejecting new physical paths',()=>{
 const s=session();let rejected=0;
 for(let n=2;n<=601;n++){
  if(!s.append(evidence(n,{contact:10+n*.01,fragments:1})).accepted)rejected++;
  s.tick(.01);s.prepareFrame(`rapid:${n}`);
 }
 assert.equal(rejected,0,`${rejected} fresh rounds hidden by old fading traces`);
 assert.ok(s.events.length<=64&&s.summaries.length<=64);
});
test('next target takes over immediately while previous evidence is still playing',()=>{
 const {hc,target,show}=facade(),a=target(2),b=target(3);
 assert.equal(show(a,1),true);const prior=hc.cur.session;assert.ok(prior.filmTimeS<prior.endFilm);
 assert.equal(show(b,1),true);
 assert.equal(hc.cur?.session.actor.entity,3,'next target must acquire before another tick');
 assert.equal(a.releases,1);assert.equal(hc.deferred.length,0);hc.hide();assert.equal(b.releases,1);
});
test('a fresh shot reacquires an already finished same actor session and does not replay appended duplicates',()=>{
 const {hc,target,show}=facade(),a=target(2);assert.equal(show(a,1),true);assert.equal(show(a,2),true);
 hc.cur.session.finish('test-finished-between-input-and-tick');
 assert.equal(show(a,3),true,'finished same-target append must fall through to acquisition');
 hc.hide();assert.equal(show(a,2),false,'an appended round resend must not resurrect a completed replay');
});
test('active victim playback retains priority over outgoing different-target feedback',()=>{
 const {hc,target,show}=facade(),a=target(2),b=target(3);show(a,1);hc.cur.session.purpose='victim';
 assert.equal(show(b,1),false);assert.equal(hc.deferred.length,0);assert.equal(hc.cur.session.actor.entity,2);hc.hide();
});
test('a locally timed fatal followup becomes the victim camera source immediately',()=>{
 const s=session(),start=s.filmTimeS,e=evidence(2,{contact:100});
 e.deaths=[{event_id:'death:2',mechanism_id:'core/charge:0',cause_event_id:e.event_id,reason:'ammo',commit_seq:3,state_before_version:2,state_after_version:3,time_s:100.005,state_after:{destroyed:true,modules:[],crew:[0]},accepted_terminal_pose:null}];
 assert.equal(runtime.validateReplayEvidence(e,e.actor).ok,true);assert.equal(s.append(e).accepted,true);s.purpose='victim';
 const f=s.prepareFrame('victim-local',start+.1);
 assert.equal(f.event.id,e.event_id);assert.ok(f.cameraProjectile.nose[2]<0,'camera must follow the fatal incoming recorded body');
 assert.ok(f.cameraBlend>=0&&f.cameraBlend<=1);assert.equal(s.clock.physicalAt(.25),runtime.createReplaySession(null,s.target,evidence(1),'offensive',{catalog}).clock.physicalAt(.25));
});
test('a failed immediate target acquisition keeps current playback and allows the next valid target',()=>{
 const {hc,target,show}=facade(),a=target(2),b=target(3),c=target(4);
 show(a,1);const current=hc.cur,factory=hc.env.replayDrawFactory;
 hc.env.replayDrawFactory=(renderer,snapshot,...args)=>{if(snapshot.actor.entity===3)throw Error('unavailable target');return factory(renderer,snapshot,...args);};
 assert.equal(show(b,1),false);assert.equal(hc.cur,current);assert.equal(show(c,1),true);
 assert.equal(hc.cur?.session.actor.entity,4);assert.equal(b.releases,1);hc.hide();
});
