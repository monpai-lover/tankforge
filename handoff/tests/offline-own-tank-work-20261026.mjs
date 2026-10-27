// Source probes: baseline is intentionally RED; TF_OFFLINE_BACKGROUND_APP selects the reviewed candidate.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(process.env.TF_OFFLINE_BACKGROUND_APP||new URL('../bundle/app.js.html',import.meta.url),'utf8');
const cacheHelper=source.includes('/* TF_OFFLINE_TANK_VISUAL_CACHE_BEGIN */')?fs.readFileSync(new URL('../tools/offline_tank_visual_cache.js',import.meta.url),'utf8'):null;
const updateStart=source.indexOf('    function update(dt) {');
assert.ok(updateStart>=0);
function between(start,end){const a=source.indexOf(start,updateStart),b=source.indexOf(end,a);assert.ok(a>=updateStart&&b>a,start);return source.slice(a,b);}
const aim=between('      let gunPx = null;','      updateShots(dt);');
const pose=between('      const M2 = G4.model;','      const target = [G4.s.x,');
const simulation=between('      G4.acc += dt;','      const terrainId = terrainAt(G4.s.x, G4.s.z);');
function run(code,context){return vm.runInNewContext('(()=>{'+code+'\n})()',context);}
function aiming(flying){
  const calls=[],point=[8,9,10],G4={cam:{yaw:0,pitch:0,dist:20},s:{heading:0},aimPoint:point,aim:{},ret:null};
  const context={flying,orbit:false,testing:false,inSight:false,G4,camPos:[0,10,0],selectedMg:null,sg:{},st:{},srt:{yaw:0,yawErr:0,bearing:true},sgs:{pitch:0,pitchErr:0},tilt:0,ze:0,cw:1280,ch:720,viewProj:[],Math,
    pose:()=>({}),dirFrom2(){return[0,0,1];},losHit(){calls.push('tank.los');return null;},muzzleWorld(){return{trunnion:[0,1,0]};},mountOf(){return{};},sightMuzzle(){calls.push('tank.muzzle');return{pos:[0,1,1],trunnion:[0,1,0],dir:[0,0,1]};},project(){calls.push('tank.project');return[0,0,1];},wrapPi:v=>v,clamp15:(v,a,b)=>Math.max(a,Math.min(b,v)),TFOfflineFlightProfile:null};
  run(aim,context);return{calls,G4,point};
}
test('local aircraft frame performs no own-tank aiming ray or sight projection',()=>{
  const f=aiming(true);assert.deepEqual(f.calls,[]);assert.equal(f.G4.aimPoint,f.point);
});
test('returning to tank resumes its ordinary aiming ray and sight projection',()=>{
  const f=aiming(false);assert.equal(f.calls.filter(c=>c==='tank.los').length,1);assert.ok(f.calls.includes('tank.project'));assert.notEqual(f.G4.aimPoint,f.point);
});
function posing(){
  const draws=[],lift={1:[0,0],[-1]:[0,0]},ground={1:[0,0],[-1]:[0,0]},G4={s:{x:0,z:0,heading:0},ss:{y:0,pitch:0,roll:0},travel:{1:0,[-1]:0},sag:{1:{x:1},[-1]:{x:1}},MG:[],T:[],loadout:{turrets:[]},camPos:null};
  G4.model={root:{},body:{},turrets:[],mgs:[],updateRunningGear(dyn){draws.push(dyn);}};
  G4.veh={hullLocal(){return[G4.s.x,0,G4.s.z];},wheelLifts:()=>lift,groundUnder:side=>ground[side],wheelPose:()=>[],runningGearPose:()=>null};
  const context={flying:true,garage:false,testing:false,G4,dt:1/60,Math,TFOfflineFlightProfile:null};
  if(cacheHelper)vm.runInNewContext(cacheHelper,context);
  return{G4,draws,lift,step(){run(pose,context);}};
}
test('identical intact parked-tank running gear inputs are built once while flying',()=>{
  const f=posing();f.step();f.step();assert.equal(f.draws.length,1);
});
test('tank root and hull transforms keep following physics while aircraft is active',()=>{
  const f=posing();f.step();f.G4.s.x=7;f.G4.s.z=-3;f.G4.s.heading=.3;f.step();
  assert.deepEqual(Array.from(f.G4.model.root.pos),[7,0,-3]);assert.equal(f.G4.model.root.yaw,.3);assert.deepEqual(Array.from(f.G4.model.body.local),[7,0,-3]);
});
test('changed suspension/track travel and broken tracks keep rebuilding running gear',()=>{
  const f=posing();f.step();f.lift[1][0]=.15;f.G4.travel[1]=.2;f.step();assert.equal(f.draws.length,2);
  f.G4.veh.brokenTracks={1:true};f.G4.veh.runningGearPose=()=>({1:{laid:true,cutPin:2}});f.step();f.step();assert.equal(f.draws.length,4);
});
test('flight frame retains tank physics, enemy tracks, ground AI/AD and live projectile stepping',()=>{
  const calls=[],stub=name=>(...args)=>{calls.push(name);return{};};
  const G4={mode:'battle',acc:0,s:{u:0},params:{mass:30000},model:{sprocketFront:false},sag:{1:{x:1,v:0},[-1]:{x:1,v:0}},loadout:{turrets:[]},enemies:[{veh:{stepTracks:stub('enemy.tracks')}}],map:{},aLong:0};
  G4.veh={t:{travel:{1:0,[-1]:0}},step(){calls.push('tank.physics');return{forceR:0,forceL:0};},compat:stub('tank.compat'),attitude:()=>({}),sinkage:0};
  const context={G4,flying:true,input:{throttle:0,steer:0,brake:1},dt:1/60,SIM_DT:1/60,TFOfflineFlightProfile:null,Math,lerp:(a,b,k)=>a+(b-a)*k,clamp15:(v,a,b)=>Math.max(a,Math.min(b,v)),obstacleBoxes:()=>[],wade:stub('tank.wade'),aimTurrets:stub('tank.turrets'),stepMachineGuns:stub('tank.mg'),syncPlayerAd:stub('player.ad.sync')};
  for(const name of ['conquestStep','advanceCombat','aiMissiles','stepAirDefence','airEffects','airAudio','stepAirWeapons','stepPlayerAd','gun2a38Sweep','radarSpinners','missileStep'])context[name]=stub(name);
  run(simulation,context);
  for(const name of ['tank.physics','tank.compat','tank.wade','enemy.tracks','advanceCombat','aiMissiles','stepAirDefence','stepAirWeapons','missileStep'])assert.equal(calls.filter(x=>x===name).length,1,name);
  const shots=between('      updateShots(dt);','      const speed = Math.abs(G4.s.u);');
  const projectileCalls=[];
  run(shots,{G4:{},dt:1/60,camPos:[0,0,0],testing:false,TFOfflineFlightProfile:null,updateShots:()=>projectileCalls.push('shells'),updateBullets:()=>projectileCalls.push('bullets'),flushHeContactBursts:()=>projectileCalls.push('contact-bursts'),updateRangeTargetRevival:()=>projectileCalls.push('revival')});
  assert.deepEqual(projectileCalls,['shells','bullets','contact-bursts','revival']);
});
