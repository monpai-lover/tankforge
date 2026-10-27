// Actual shipped fire -> ballistic step -> Enemy.intersect -> Combat/WASM ->
// accepted replay append. DOM/audio/GPU submission are observation-only sinks.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {loadData} from '../../client/web/tools/load-data.mjs';
import {rendererSink} from '../../client/web/tools/hit-mesh-capture.mjs';
import {patchProjectileSurfaceBatch} from '../tools/patch_projectile_surface_batch.mjs';

const fixtureURL=new URL('./projectile-surface-batch-20261026.mjs',import.meta.url);
const fixture=fs.readFileSync(fixtureURL,'utf8'),boundary=fixture.indexOf('\ntest(');
assert.ok(boundary>0);
// Use one JS realm, as in the browser: Node vm + host structuredClone otherwise
// rejects valid replay objects because their Object.prototype belongs elsewhere.
const prefix=fixture.slice(0,boundary).replace(/^import .*;\r?$/gm,'')
  .replaceAll('import.meta.url','fixtureURL')
  .replace("const app=path.join(root,'handoff/bundle/app.js.html')","const app=process.env.TF_VULCAN_APP||path.join(root,'handoff/bundle/app.js.html')")
  .replace('vm.runInContext(source.slice(0,end)+','new Function(source.slice(0,end)+')
  .replace("})();',context);","})();')();")
  .replace('context.actual','globalThis.actual')
  .replace("fs.readFileSync(path.join(root,'target/wasm32-unknown-unknown/release/tg_design_wasm.wasm'))","fs.readFileSync(process.env.TF_VULCAN_WASM||path.join(root,'target/wasm32-unknown-unknown/release/tg_design_wasm.wasm'))")
  .replace('damageVisualsFor,Enemy,','combatHit,heContactEffects,flushHeContactBursts,LocalReplayAdmission,HitCam,createReplaySession,Rng,newShot,stepShot,bulletOf,bulletShell,disperse,groundHit,damageVisualsFor,Enemy,');
const {actual,suite,authoredRay,data,source}=new Function('patchProjectileSurfaceBatch','fs','os','path','vm','spawnSync','fileURLToPath','test','assert','loadData','rendererSink','fixtureURL',
  prefix+'\nreturn {actual,suite,authoredRay,data,source};')(patchProjectileSurfaceBatch,fs,os,path,vm,spawnSync,fileURLToPath,test,assert,loadData,rendererSink,fixtureURL);
const section=(from,to)=>{const a=source.indexOf(from),b=source.indexOf(to,a+from.length);assert.ok(a>=0&&b>a,from);return source.slice(a,b);};

function liveRun({fire=true,seconds=1,miss=false}={}){
  const s=suite();
  // The real scheduler admits shooter entity 1. Preserve the fixture's exact
  // native actor identity rather than manufacturing a different damage scope.
  s.create('de_rso_pak40',0,'player');
  const a=s.create('de_flakpz38t'),ray=authoredRay(a);
  Object.assign(a.frame,{localDir:p=>p.slice(),worldDir:p=>p.slice()});
  actual.Enemy.prototype.poseGuns.call({model:a.model,loadout:a.loadout,turretYaw:0,alive:true,gunPitch:[]});
  const e=Object.assign(Object.create(actual.Enemy.prototype),{model:a.model,veh:{body:a.frame,setDamageCaps(){}},loadout:a.loadout,
    combat:s.combat,combatKey:a.key,cstate:a.fresh.state,alive:true,turretYaw:0,gunPitch:[],x:0,z:0,pose(){}});
  actual.damageVisualsFor(s.renderer,a.model,a.fresh.caps,a.fresh.state,a.bundle.modules);
  const dir=ray.end.map((v,k)=>v-ray.start[k]),length=Math.hypot(...dir);dir.forEach((v,k)=>dir[k]=v/length);
  const origin=ray.center.map((v,k)=>v-dir[k]*10),side=Math.abs(dir[1])<.9?[dir[2],0,-dir[0]]:[0,-dir[2],dir[1]],sideLength=Math.hypot(...side);
  side.forEach((v,k)=>side[k]=v/sideLength);
  if(miss)origin.forEach((v,k)=>origin[k]=v+side[k]*100);
  const up=[dir[1]*side[2]-dir[2]*side[1],dir[2]*side[0]-dir[0]*side[2],dir[0]*side[1]-dir[1]*side[0]],matrix=new Float32Array([...side,0,...up,0,...dir,0,...origin,1]);
  const gun={id:'air_vulcan',kind:'rotary',sound:'vulcan',owner:'hull',mount:[0,0,0],rpm:6000,ammo:725,cool:.005,fired:0,spin:1};
  const G4={time:1,mode:'battle',camPos:[0,0,0],cam:{shake:0},bullets:[],shots:[],bulletShells:new Map(),enemies:[e],combat:s.combat,
    air:{active:true,fireAll:fire,guns:[gun],plane:{root:{local:matrix},cur:new Float32Array(64),damage:{pilotDead:false,dead:()=>false},type:{airframe:[9000,0,0,0,9000,9000,9000]},api:{impulse(){}}}}};
  const admission=new actual.LocalReplayAdmission();admission.battleSerial=72;admission.begin([{entity:1,key:'player'},{entity:2,key:a.key}]);admission.bindState(a.key,e.cstate);
  G4.localReplay=admission;s.combat.replayAdmission=admission;s.combat.replayTime=()=>G4.time;
  s.combat.replayPose=()=>({trust:'accepted',hull_origin:[0,0,0],ex:[1,0,0],ey:[0,1,0],ez:[0,0,1],joints:[],running_gear:[],payload:[],variants:[]});
  const cam=Object.create(actual.HitCam.prototype),target={actor:admission.actor(2),model:a.model,body:a.frame,hullBounds:{min:[-3,-1,-5],max:[3,4,5]}};
  cam.cur=null;cam.presented=new Map();cam.deferred=[];cam.env={};cam._summary=()=>{};
  const reports=[],contacts=[],frames=[],accepted=[],calls={coreHits:0,trace:0,replayAppends:0};
  const original=s.core.combatSurfaceShoot;s.core.combatSurfaceShoot=function(...args){calls.coreHits++;return original.apply(this,args);};
  const trace=s.core.combatSurfaceTrace;s.core.combatSurfaceTrace=function(...args){calls.trace++;return trace.apply(this,args);};
  const onCombatHit=(_e,report,shell,dist,mg)=>{
    reports.push(report);assert.ok(report.replay,'every live accepted impact keeps its authoritative replay');
    if(!cam.cur){const session=actual.createReplaySession(null,target,report.replay,'offensive',{catalog:{projectiles:data.projectiles},holdS:10,maxFilmS:240});cam.cur={session,sourceModel:a.model,rep:report};}
    else{assert.equal(cam.show(target,report,shell,dist,mg,'','offensive'),true);calls.replayAppends++;}
    accepted.push(cam.cur.session);
  };
  const noop=()=>{},fx={mgFlash:noop,bulletGround:noop,bulletBoard:noop,shellGround:noop,beam:noop};
  const sound={contact:noop,removeProjectile:noop},rng2=new actual.Rng(12345);
  const fireSource=section('    const M61_DEF =','    // hangar fighters'),gunsSource=section('    function stepAircraftGuns(dt) {','    /**\n     * Gun recoil'),
    recoilSource=section('    function airRecoil(air) {','    /** The aircraft\'s mass now:'),hitSource=section('    function hitEnemy(p0, p1, skip = null, self = null) {','    const SHED ='),
    bulletsSource=section('    function updateBullets(dt) {','    function updateShots(dt) {');
  const runtime=new Function('G4','data','rng2','fx','sound','TFProjectileSurfaceBatch','newShot','stepShot','bulletOf','bulletShell','disperse','combatHit','heContactEffects','groundHit','onCombatHit',
    `const BULLET_DT=1/120,airBots={list:[]},rangeTargets=()=>[],hitTargets=()=>null,buildingHit=()=>null,surfaceAt=()=>-10000,impactColor=()=>[.5,.5,.5],showHit=()=>{},hud={},net={send(){}},seed2=()=>1,airShot=()=>false;
     const aircraftGunMount=g=>g.mount,airMass=air=>air.plane.type.airframe[0];
     ${fireSource}\nG4.bulletShells.set(M61_DEF.id,m56Shell());data.projectiles.hei_20_m56=m56Shell();G4.air.guns[0].def=M61_DEF;
     const beltShell=()=>G4.bulletShells.get(M61_DEF.id);
     ${recoilSource}\n${gunsSource}\n${hitSource}\n${bulletsSource}
     return {stepAircraftGuns,updateBullets};`)(G4,data,rng2,fx,sound,actual.batch,actual.newShot,actual.stepShot,actual.bulletOf,actual.bulletShell,actual.disperse,
      actual.combatHit,actual.heContactEffects,actual.groundHit,onCombatHit);
  const framesN=Math.round(seconds*60),started=performance.now();
  for(let frame=0;frame<framesN;frame++){
    G4.time=1+(frame+1)/60;
    const t=performance.now();runtime.stepAircraftGuns(1/60);runtime.updateBullets(1/60);actual.flushHeContactBursts(null,true);frames.push(performance.now()-t);
  }
  if(miss){
    G4.air.fireAll=false;
    for(let frame=0;frame<200;frame++){
      G4.time+=1/60;runtime.updateBullets(1/60);
    }
  }
  const elapsedMs=performance.now()-started,session=cam.cur?.session;
  let concurrent=0;if(session)for(let i=0;i<180;i++)concurrent=Math.max(concurrent,session.prepareFrame(`vulcan:${i}`,i/60).projectiles.filter(p=>p.visible).length);
  const result={fired:gun.fired,ammo:gun.ammo,remaining:G4.bullets.length,reports,calls,sessionCount:new Set(accepted).size,concurrent,
    elapsedMs,p95FrameMs:frames.slice().sort((a,b)=>a-b)[Math.floor(frames.length*.95)],reportHash:createHash('sha256').update(JSON.stringify(reports)).digest('hex')};
  s.dispose();return result;
}

test('real M61 6000rpm scheduler retains ammunition, finite hits and one multi-round replay view',()=>{
  const result=liveRun();
  assert.equal(result.fired,100);assert.equal(result.ammo,625);
  assert.equal(result.calls.coreHits,100);assert.equal(result.reports.length,100);
  assert.equal(result.remaining,0);assert.equal(result.sessionCount,1);assert.equal(result.calls.replayAppends,99);
  assert.ok(result.concurrent>1,'multiple recorded physical rounds remain visible in the same session');
  console.log('VULCAN_GROUND_LIVE',JSON.stringify({...result,reports:undefined}));
});
test('released M61 trigger does not synthesize discharges, hits or replay sessions',()=>{
  const result=liveRun({fire:false,seconds:.1});
  assert.equal(result.fired,0);assert.equal(result.ammo,725);assert.equal(result.calls.coreHits,0);assert.equal(result.reports.length,0);assert.equal(result.sessionCount,0);
});
test('real fired M61 misses retain all ammunition and ballistic lifetime without manufacturing a target hit',()=>{
  const result=liveRun({miss:true});
  assert.equal(result.fired,100);assert.equal(result.ammo,625);assert.equal(result.calls.coreHits,0);
  assert.equal(result.reports.length,0);assert.equal(result.sessionCount,0);assert.equal(result.remaining,0,'actual bullet lifetime retires every missed projectile');
});
