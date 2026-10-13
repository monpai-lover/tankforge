import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {runtime} from './live-network-rig.mjs';
import {HitCam} from '../src/game/hitcam.js';
import {loadCoreSync} from '../src/design/core.js';
import {loadData} from '../tools/load-data.mjs';
import {Combat} from '../src/game/combat.js';
import {Enemy,useCombat} from '../src/game/enemies.js';
import {buildTank} from '../src/gfx/tankmodel.js';
import {makeLoadout,generatedTurretParts} from '../src/game/loadout.js';
const data=loadData(),receipt=JSON.parse(fs.readFileSync(process.env.TG_REPLAY_NETWORK_RECEIPT||new URL('../../../target/replay-network-r5-20261013.json',import.meta.url)));
function graphics(){const calls=[],renderer={mesh:data=>({_src:{data}}),instancedMesh:(data,maxInstances)=>({instanced:true,_src:{data},maxInstances}),setInstances(m,matrices,instances){m._src.matrices=matrices.slice();m.instances=instances;},freeMesh(){},retainMesh(){},releaseMesh(){},renderInset(nodes,cam,rect,opts){calls.push({nodes,cam,rect,opts});}},el=new Map(),root={style:{},dataset:{},querySelector(k){if(!el.has(k))el.set(k,{style:{},dataset:{}});return el.get(k);}};return{renderer,calls,root};}
test('actual main offline missile fatal routes real saved Player source into full V3 victim playback',()=>{
  const g=graphics(),core=loadCoreSync(fs.readFileSync(process.env.TG_TEST_WASM||new URL('../../../target/tg_design_wasm-r4-20261012.wasm',import.meta.url)),{materials:data.materials,catalog:data.designCatalog,terrains:Object.values(data.terrains)}),combat=new Combat(core,Object.values(data.machineGuns));let r;
  const hc=new HitCam({...g,catalog:data,onFinish:()=>r.G.victimReplay.finish()});r=runtime('casual',{combat,renderer:g.renderer,hitcam:hc,spawnEnemies(G,renderer,terrain,scene){const id='us_m4a3_75w',bundle=data.vehicles[id],loadout=makeLoadout(id,bundle,data.projectiles,data.machineGuns),model=buildTank(renderer,loadout,generatedTurretParts),e=new Enemy(id,bundle,model,terrain,{x:20,z:0,heading:0},null,'casual');e.combatKey='offline_target';e.replayEntity=100;e.loadout=loadout;e.sourceBundle=bundle;G.enemies=[e];useCombat(e,combat,e.combatKey);}});
  r.live.select('us_m4a3_75w');r.live.startBattle();r.G.time=0;r.G.T[0].yaw=.7;r.G.T[0].guns[0].pitch=.2;
  const o=r.G.veh.body.origin(),center=[o[0],o[1]+1.2,o[2]];r.G.missiles.launch('tt250_rocket',100,1,[center[0]+12,center[1],center[2]],[-1,0,0],123,null,{weapon_instance:'gun:0:0',projectile_id:'he_420_tt250'});
  for(let i=0;i<600;i++){r.G.time+=1/120;const result=r.G.missiles.step(1/120,[{id:1,team:0,alive:true,center,vel:[0,0,0]}]);r.live.missileImpacts(result);if(r.G.cstate.destroyed)break;}
  assert.equal(r.G.cstate.destroyed,true);assert.equal(hc.victimActive,true,'actual self handler must start fatal replay');assert.equal(hc.cur.target.model.turrets[0].node.yaw,.7);assert.equal(hc.cur.target.model.turrets[0].guns[0].node.pitch,-.2);
  const saved=hc.cur.target.body.worldPoint([0,0,0]);r.G.model.turrets[0].node.yaw=8;r.G.veh.body.place([80,4,90],1);hc.render3d({cw:1280,ch:720,scale:1,nodes:[],frameId:1});assert.deepEqual(hc.cur.target.body.worldPoint([0,0,0]),saved);assert.equal(g.calls.length,2);assert.equal(g.calls[0].opts.frame,g.calls[1].opts.frame);
});
test('actual main accepts fatal after status already marked dead and does not auto-open deploy over victim playback',()=>{
  const g=graphics();let r,now=0,opens=0;const hc=new HitCam({...g,catalog:data,onFinish:()=>r.G.victimReplay.finish()});r=runtime('casual',{combat:null,renderer:g.renderer,hitcam:hc,clock:{now:()=>now},openDeploy:()=>opens++});
  const phases=receipt.phases.filter(p=>p.scenario==='gap'),fatal=phases.find(p=>p.name==='gap_1_3_late_2_fatal_older_cause'&&p.recipients.some(q=>q.message.replay?.deaths.length)),victim=fatal.recipients.find(q=>q.message.replay).to;
  for(const p of phases.filter(p=>p.name==='admission')){const own=p.recipients.filter(q=>q.to===victim);for(const q of own.slice(own.findIndex(q=>q.message.t==='welcome')))r.net._receive(q.message);}
  const all=phases.filter(p=>p.name==='gap_1_3_late_2_fatal_older_cause'),one=all[0].recipients.find(q=>q.message.replay).message;r.net._receive(one);
  const status=fatal.recipients.find(q=>q.to===victim&&q.message.t==='status').message;r.net._receive(status);assert.equal(r.G.online.dead,true);r.net._receive(fatal.recipients.find(q=>q.message.replay).message);
  assert.equal(hc.victimActive,true);assert.equal(r.G.victimReplay.active,true);assert.equal(typeof r.live.netStep,'function');now=5000;r.live.netStep(.01);assert.equal(opens,0);
  hc.hide('manual_skip');now=3500;r.live.netStep(.01);assert.equal(opens,0,'skip cannot bypass the authoritative respawn cooldown');now=5000;r.live.netStep(.01);assert.equal(opens,1);assert.equal(r.G.victimReplay.active,false);
});

test('actual admitted native MG impacts append, promote fatal priority and render the real bullet caliber',()=>{
  const phases=receipt.phases.filter(p=>p.scenario==='admitted_mg'),impacts=phases.filter(p=>p.name==='mg_impact').map(p=>p.recipients.find(q=>q.message.replay)?.message).filter(Boolean);
  assert.ok(impacts.length>1,'fresh actual MG native vectors are required');const first=impacts[0],fatal=impacts.find(m=>m.killed);assert.ok(fatal);assert.equal(fatal.replay.projectile_id,'bullet_mg34');
  const g=graphics();let r,opens=0,now=0;const hc=new HitCam({...g,catalog:data,onFinish:()=>r.G.victimReplay.finish()});r=runtime('casual',{combat:null,renderer:g.renderer,hitcam:hc,clock:{now:()=>now},openDeploy:()=>opens++});
  for(const p of phases.filter(p=>p.name==='admission')){const own=p.recipients.filter(q=>q.to===first.target);for(const q of own.slice(own.findIndex(q=>q.message.t==='welcome')))r.net._receive(q.message);}
  r.net._receive(first);const target=hc.cur.target,clock=hc.cur.session.clock;
  for(const m of impacts.slice(1))r.net._receive(m);
  assert.ok(hc.cur.target===target);assert.ok(hc.cur.session.clock===clock);assert.equal(hc.victimActive,true);assert.equal(r.G.online.dead,true);assert.equal(r.G.victimReplay.active,true);
  const event=hc.cur.session.fatal;assert.equal(event.profile.weaponClass,'mg');assert.ok(Math.abs(event.profile.diameterM-.00792)<1e-9);
  const body=event.traces.find(t=>t.body);assert.ok(body,'actual MG core traversal retains physical timing');hc.cur.t=hc.cur.session.clock.filmAt((body.start_s+body.end_s)/2);
  hc.render3d({cw:1280,ch:720,scale:1,nodes:[],frameId:66});assert.equal(g.calls.length,2);assert.ok(g.calls[0].opts.frame===g.calls[1].opts.frame);
  const bullet=g.calls[0].nodes.find(n=>n.projectileProfile?.weaponClass==='mg');assert.ok(bullet);assert.ok(Math.abs(bullet.projectileProfile.diameterM-.00792)<1e-9);
  now=5000;r.live.netStep(.01);assert.equal(opens,0);r.net._receive(fatal);assert.ok(hc.cur.target===target);hc.hide('manual_skip');r.live.netStep(.01);assert.equal(opens,1);
});

test('actual online extinguish completion releases the private Player source pose after the accepted state clears its cause',()=>{
  const phases=receipt.phases.filter(p=>p.scenario==='reignition'),r=runtime('casual',{combat:null}),statuses=phases.filter(p=>p.name==='extinguish').flatMap(p=>p.recipients).filter(q=>q.message.replay_commit);
  const victim=statuses[0].to;for(const p of phases.filter(p=>p.name==='admission')){const own=p.recipients.filter(q=>q.to===victim);for(const q of own.slice(own.findIndex(q=>q.message.t==='welcome')))r.net._receive(q.message);}
  const initial=statuses[0].message.replay_commit.record.state_after.active_fire_cause,pose={frame:'private source'};r.G.playerReplayCausePose={id:initial.source_event_id,pose,stateVersion:1};
  r.net._receive(statuses[0].message);assert.equal(r.G.playerReplayCausePose.pose,pose,'extinguisher start retains the ongoing cause');
  r.net._receive(statuses[1].message);assert.equal(r.G.playerReplayCausePose,null,'authority completion releases the private source pin without waiting for a new life');
});

test('preserved default core fatal missile without causal evidence follows normal death flow without an invented victim replay',()=>{
  const g=graphics(),core=loadCoreSync(fs.readFileSync(new URL('../assets/tg_design.wasm',import.meta.url)),{materials:data.materials,catalog:data.designCatalog,terrains:Object.values(data.terrains)}),combat=new Combat(core,data.machineGuns),hc=new HitCam({...g,catalog:data}),r=runtime('casual',{combat,renderer:g.renderer,hitcam:hc});
  r.live.select('us_m4a3_75w');r.live.startBattle();const b=r.G.veh.body,pt=b.worldPoint([1.31,1.2,0]);
  r.live.selfMissileHit(pt,[-1,0,0],data.projectiles.he_420_tt250,400,data.missiles.tt250_rocket);
  assert.equal(r.G.cstate.destroyed,true);assert.equal(r.G.replayEvidence,null);assert.equal(hc.victimActive,false);assert.equal(r.G.victimReplay.active,false);assert.equal(r.G.victimReplay.canDeploy(true),true);
});
