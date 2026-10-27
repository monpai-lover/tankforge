import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const app=fs.readFileSync(new URL('../bundle/app.js.html',import.meta.url),'utf8');
const section=(from,to)=>{const a=app.indexOf(from),b=app.indexOf(to,a);assert.ok(a>=0&&b>a,from);return app.slice(a,b);};
const runtime=new Function('bulletShellOf','projectileProfile','projectileBodyStage',
 (app.includes('function createCombatGeometryImmutable()')?section('function createCombatGeometryImmutable()','  // client/web/src/game/combat.js'):'')+
 section('  // client/web/src/game/replayRecords.js','  // client/web/src/game/projectileReplay.js')+
 section('  // client/web/src/game/replayClock.js','  // client/web/src/game/replayCamera.js')+
 section('  // client/web/src/game/replayEvidence.js','  // client/web/src/vendor/suppliedHitReplayV3.js')+
 ';return {createReplaySession,validateReplayEvidence};')(()=>null,s=>({diameterM:s.caliber_mm/1000,family:'apcbc'}),()=>null);
const catalog={projectiles:{filled50:{id:'filled50',kind:'apcbc',caliber_mm:50,mass_kg:2.06,explosive_mass_kg:.017}}};
function evidence(n,contact=10*n){
 const state={destroyed:false,modules:[],crew:[100]},pose={trust:'accepted',hull_origin:[0,0,0],ex:[1,0,0],ey:[0,1,0],ez:[0,0,1],joints:[],running_gear:[],payload:[],variants:[]};
 return {revision:1,authority:'offline',actor:{battle:1,entity:2,life:1},shooter:{battle:1,entity:1,life:1},event_id:`hit:${n}`,shot_id:`shot:${n}`,weapon_instance:'gun:0',projectile_id:'filled50',build_hash:'fixture-build',anatomy_hash:'fixture-anatomy',parent_mechanism_id:null,commit_seq:n,state_before_version:n-1,state_after_version:n,pose_revision:0,geometry_revision:0,seed:String(n),coordinates:'target_hull_metres',launch_time_s:contact-.2,impact_time_s:contact,accepted_pose:pose,state_before:state,capabilities:[],flight:[],flight_trust:'local_ballistic_world_segments_legacy_contact',segments:[{start_time_s:contact-.2,end_time_s:contact,from:[0,1,-100],to:[0,1,0]}],deaths:[],mechanism_records:[],report:{state,caps:{},impact:[0,1,0],shell_kind:'apcbc',modules:[],crew:[],fragments:[],impact_events:[{event_id:`plate:${n}`,entry:{body_id:'core',elapsed_s:0,velocity_m_s:[0,0,500]},output:{elapsed_s:.001,velocity_m_s:[0,0,400],remaining_pen_mm:20},entry_position:[0,1,0],exit_position:[0,1,.3],verdict:'penetrated',budget:{input_j:100,core_out_j:70}}],bursts:[{pos:[0,1,.8],radius:1,inside:true,explosive_kg:.0289,time_s:.004,armed_at_s:0,delay_s:.004,detonation_id:'core/charge:0/detonation:0',mechanism:'delayed_aphe'}]}};
}
function setup(){const target={hullBounds:{min:[-2,0,-3],max:[2,3,3]}};const s=runtime.createReplaySession(null,target,evidence(1),'offensive',{catalog,holdS:10,maxFilmS:240});s.prepareFrame('first',5);return {s,target};}
test('later recorded rounds retain visible incoming and internal projectile motion at render cadence',()=>{
 const {s,target}=setup(),director=s.directorEvent,time=s.filmTimeS,firstClock=s.clock.physicalAt(.25);
 assert.equal(s.append(evidence(2)).accepted,true);
 let incoming=0,inside=0;
 for(let k=0;k<90;k++){
  const frame=s.prepareFrame(`f:${k}`,time+k/60),p=frame.projectiles.find(p=>p.eventId==='hit:2');
  if(p?.visible&&p.nose[2]<0)incoming++;
  if(p?.visible&&p.nose[2]>0&&p.nose[2]<.3)inside++;
  assert.equal(frame.event,director);assert.equal(s.target,target);
 }
 assert.ok(incoming>=3,`second round incoming body visible for ${incoming} frames`);
 assert.ok(inside>=2,`second round armor traversal visible for ${inside} frames`);
 assert.equal(s.clock.physicalAt(.25),firstClock,'secondary animation cannot rewrite played camera clock');
});
test('three overlapping followups show each recorded APHE flash and path without replacing the session',()=>{
 const {s}=setup(),start=s.filmTimeS,director=s.directorEvent,seen=new Set(),paths=new Set();
 for(let n=2;n<=4;n++)assert.equal(s.append(evidence(n)).accepted,true);
 let concurrent=0;
 for(let k=0;k<150;k++){
  const frame=s.prepareFrame(`burst:${k}`,start+k/60);
  concurrent=Math.max(concurrent,frame.bursts.filter(b=>b.eventId!=='hit:1').length);
  for(const b of frame.bursts)if(b.alpha>0&&b.radius>0)seen.add(b.eventId);
  for(const t of frame.traces)if(Math.hypot(...t.head.map((v,i)=>v-t.tail[i]))>.01)paths.add(t.eventId);
  assert.equal(frame.event,director);
 }
 for(let n=2;n<=4;n++){assert.ok(seen.has(`hit:${n}`),`missing flash ${n}`);assert.ok(paths.has(`hit:${n}`),`missing path ${n}`);}
 assert.equal(concurrent,3,'independent secondary rounds overlap instead of queueing');
});
