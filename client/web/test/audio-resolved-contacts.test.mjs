import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Sound } from '../src/game/audio.js';
import { Combat, arr3, bulletShell } from '../src/game/combat.js';
import { combatHit } from '../src/game/enemies.js';
import { TestRange } from '../src/game/testrange.js';
import { RigidBody } from '../src/sim/tank/body.js';
import { loadData } from '../tools/load-data.mjs';
import { loadCoreSync } from '../src/design/core.js';
import { newDesign } from '../src/design/templates.js';
import * as ballistics from '../src/sim/ballistics.js';

const source=fs.readFileSync(new URL('../src/main.js',import.meta.url),'utf8').replaceAll('\r\n','\n');
const data=loadData(),core=loadCoreSync(fs.readFileSync(process.env.TG_TEST_WASM||new URL('../assets/tg_design.wasm',import.meta.url)),{materials:data.materials,catalog:data.designCatalog,terrains:Object.values(data.terrains)});
function actual(name,deps){const a=source.indexOf(`  function ${name}(`),b=source.indexOf('\n  }',a)+4;assert.ok(a>=0&&b>a);return new Function(...Object.keys(deps),source.slice(a,b)+`;return ${name};`)(...Object.values(deps));}
function audio(){const starts=[],contacts=[],sound=new Sound(),param=()=>({value:0,setValueAtTime(v){this.value=v;},setTargetAtTime(){},linearRampToValueAtTime(){}}),raw=JSON.parse(fs.readFileSync(new URL('../assets/full-audio.json',import.meta.url),'utf8'));
  sound.ctx={currentTime:1,state:'running',createBufferSource(){return{playbackRate:param(),connect(){},disconnect(){},start(){starts.push(this.buffer.id);},stop(){this.onended?.();}};},createGain(){return{gain:param(),connect(){},disconnect(){}};},createPanner(){return Object.fromEntries([...['positionX','positionY','positionZ','orientationX','orientationY','orientationZ'].map(k=>[k,param()]),['connect',()=>{}],['disconnect',()=>{}]]);}};sound.master={connect(){},disconnect(){}};
  assert.equal(sound.loadFullBank({...raw,cues:Object.fromEntries(Object.entries(raw.cues).map(([id,c])=>[id,{...c,url:'data:audio/wav;base64,AA=='}]))}),true);for(const id of Object.keys(raw.cues))sound.full.buffers.set(id,{id,length:100,numberOfChannels:1});sound.setListener({position:[0,0,0],time:1});const contact=sound.contact.bind(sound);sound.contact=e=>{contacts.push(e);contact(e);};return{sound,starts,contacts};
}
function target(id='de_tiger_e'){const combat=new Combat(core,data.machineGuns),body=new RigidBody(1000,[1,1,1],[0,0,0]),key='audio:'+id,fresh=combat.fresh(key,data.vehicles[id]),e={id,name:id,combat,combatKey:key,cstate:fresh.state,caps:fresh.caps,alive:true,model:{turrets:[]},gunPitch:[],veh:{body},turretYaw:0,pose(){}};return{combat,body,fresh,e};}
const effects=new Proxy({},{get:()=>()=>{}});
function impactLayers(r,report){assert.equal(report.outcome,'penetrated');assert.ok(report.layers.length>=1);assert.ok(r.starts.includes('impact_penetrated'));assert.ok(r.starts.includes('tail_steel'));assert.equal(r.starts.some(id=>id.startsWith('blast_')),report.bursts.some(b=>(b.explosive_kg??b.explosive_mass_kg)>0));}

test('actual matched WASM self missile report emits armor audio before self state changes with no invented blast',()=>{
  const r=audio(),t=target(),def=data.missiles.bgm71a_tow,war=data.projectiles[def.warhead],G={time:1,combat:t.combat,combatKey:t.e.combatKey,cstate:t.fresh.state,caps:t.fresh.caps,veh:{body:t.body},T:[{yaw:0}],cam:{shake:0}},initial=G.cstate;let report;
  const shoot=t.combat.shoot.bind(t.combat);t.combat.shoot=(...args)=>report=shoot(...args);const contact=r.sound.contact;r.sound.contact=event=>{assert.equal(G.cstate,initial);contact(event);};
  actual('selfMissileHit',{G,fx:effects,sound:r.sound,rng:{nextF32:()=>.5},hud:{toast(){}},arr3})([3,2.05,.75],[-1,0,0],war,300,def);
  assert.equal(r.contacts.length,1);assert.equal(r.contacts[0].eventId,report);assert.deepEqual(r.contacts[0].bursts,[]);assert.equal(G.cstate,report.state);impactLayers(r,report);
});
test('actual matched WASM AI and player missile hits emit the same report family once independently of hit replay',()=>{
  for(const owner of [1,101]){const r=audio(),t=target(),G={time:1,mode:'battle',online:null,enemies:[t.e],s:{x:0,z:0},camPos:[0,0,0],missiles:{segments:()=>[{id:7,owner,def:'bgm71a_tow',p0:[3,2.05,.75],p1:[.5,2.05,.75],vel:[-300,0,0]}],end(){}}};let report,replays=0;
    const shoot=t.combat.shoot.bind(t.combat);t.combat.shoot=(...args)=>report=shoot(...args);t.e.intersect=()=>({t:.5,point:[1.065,2.05,.75]});
    const deps={G,ME:1,enemyOwner:i=>100+i,data,buildingHit:()=>null,hitSelf:()=>null,combatHit,fx:effects,sound:r.sound,rng:{nextF32:()=>.5},arr3,hud:{},showHit(){},selfMissileHit(){throw new Error('wrong hit target');}};
    const present=actual('onCombatHit',{G,sound:r.sound,fx:effects,arr3,camTarget:()=>({}),hitcam:{show(){replays++;}}});deps.onCombatHit=present;actual('missileImpacts',deps)({});
    impactLayers(r,report);assert.equal(r.starts.filter(id=>id==='impact_penetrated').length,1);assert.equal(replays,owner===1?1:0);assert.equal(r.contacts[0].eventId,report);
  }
});
test('actual damaging MG report remains one contact when hit replay presents the same report',()=>{
  const r=audio(),t=target('de_rso_flak'),shell=bulletShell(data.machineGuns.m2hb),seat=data.vehicles.de_rso_flak.crew.find(c=>c.role==='driver').pos,G={time:1,mode:'battle',online:null,camPos:[0,0,0],bulletShells:new Map([['m2hb',shell]]),bullets:[{s:ballistics.newShot([3,seat.y,seat.z],[-1,0,0],shell),def:data.machineGuns.m2hb,age:0,travelled:0,tracer:false}]};let report;
  const shoot=t.combat.shoot.bind(t.combat);t.combat.shoot=(...args)=>report=shoot(...args);
  const deps={G,BULLET_DT:1/360,ballistics,rangeTargets:()=>[],hitTargets:()=>null,hitEnemy:()=>({e:t.e,hit:{point:[1.065,2.05,.75]}}),buildingHit:()=>null,fx:effects,sound:r.sound,combatHit,arr3,rng:{nextF32:()=>.5},showHit(){},hud:{},net:{send(){throw new Error('offline');}}};
  deps.onCombatHit=actual('onCombatHit',{G,sound:r.sound,fx:effects,arr3,camTarget:()=>({}),hitcam:{show(){}}});actual('updateBullets',deps)(.01);
  assert.equal(report.outcome,'penetrated');assert.ok(report.modules.length||report.crew.length);assert.equal(r.starts.filter(id=>id==='impact_penetrated').length,1,'one physical terminal report may also feed hit replay');
});
test('actual designer core impact event reaches generated armor audio with its actual layers and fragments',()=>{
  const design=newDesign('blank',data.designCatalog);design.hull_geometry={vertices:Array.from({length:8},(_,i)=>[i&1?1:-1,i&2?2:0,i&4?2:-1]),faces:[[4,5,7,6],[1,0,2,3],[5,1,3,7],[0,4,6,2],[6,7,3,2],[0,1,5,4]].map((v,id)=>({id,v,tag:''}))};design.turret_geometry=null;design.turret_ring=null;design.gun_mount=null;design.weapons=null;design.internal_modules=[];design.crew_positions=[];design.addons=[];design.ammunition=[];design.armor_faces=[{body:'hull',face:1,material:'rha',thickness_mm:50}];design.armor_layers=[];core.setDesign(design);
  const shell={...data.projectiles.apcbc_75_pzgr39_42,explosive_mass_kg:0,kind:'ap'},resp=core.shoot({shell,origin:[0,1,-2],dir:[0,0,1],speed_ms:800,distance_m:0,seed:1,path:[]});assert.equal(resp.hit,true);const r=audio(),range=new TestRange({G:{time:1},pose:()=>({pos:[0,0,0],heading:0}),sound:r.sound,fx:effects});for(const method of ['_refresh','startReplay','showCard'])range[method]=()=>{};range.onHit({shell,travelled:1,s:{vel:[0,0,800]}},resp);
  assert.ok(r.starts.includes('impact_penetrated'));assert.ok(r.starts.includes('tail_steel'));assert.equal(r.contacts.length,1);assert.equal(r.contacts[0].eventId,resp);assert.deepEqual(r.contacts[0].bursts,[]);
});
test('actual matched WASM cannon contact preserves reported filler and reaches audio before replay',()=>{
  const r=audio(),t=target(),shell=data.projectiles.apcbc_88_l56,G={time:1,mode:'battle',online:null,s:{x:0,z:0},camPos:[0,0,0],shots:[{s:ballistics.newShot([3,2.05,.75],[-1,0,0],shell),shell,origin:[3,2.05,.75],age:0,travelled:0}],loadout:{gunCount:1}};let report,atReplay;
  const shoot=t.combat.shoot.bind(t.combat);t.combat.shoot=(...args)=>report=shoot(...args);const deps={G,ballistics,hitTargets:()=>null,rangeTargets:()=>[],hitEnemy:()=>({e:t.e,hit:{point:[1.065,2.05,.75]}}),hitSelf:()=>null,buildingHit:()=>null,sound:r.sound,fx:effects,combatHit,shotSeed:()=>1,arr3,showHit(){},hud:{hideToast(){}},net:{send(){throw new Error('offline');}}};
  deps.onCombatHit=actual('onCombatHit',{G,sound:r.sound,fx:effects,arr3,camTarget:()=>({}),hitcam:{show(){atReplay=r.starts.slice();}}});actual('updateShots',deps)(.01);
  impactLayers(r,report);assert.ok(report.bursts.some(b=>b.inside));assert.ok(atReplay.includes('impact_penetrated'));assert.equal(r.starts.filter(id=>id==='impact_penetrated').length,1);assert.deepEqual(r.contacts[0].bursts.map(({worldPosition,...b})=>b),report.bursts);
});
test('resolved-report presentation observer cannot abort actual combat state and capabilities',()=>{
  const t=target(),shell=data.projectiles.apcbc_88_l56,initial=t.e.cstate;let observed;
  const rep=combatHit(t.e,[3,2.05,.75],[-1,0,0],shell,700,500,1,report=>{assert.equal(t.e.cstate,initial);observed=report;throw new Error('presentation observer');});assert.equal(observed,rep);assert.equal(t.e.cstate,rep.state);assert.equal(t.e.caps,rep.caps);assert.ok(rep.shot);
});
