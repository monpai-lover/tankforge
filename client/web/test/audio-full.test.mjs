import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Sound } from '../src/game/audio.js';
import * as mgSim from '../src/sim/mg.js';
import * as loading from '../src/sim/loading.js';
import * as loadout from '../src/game/loadout.js';
import * as gunnery from '../src/sim/gunnery.js';
import * as ballistics from '../src/sim/ballistics.js';
import { RigidBody } from '../src/sim/tank/body.js';
import { Missiles } from '../src/game/missiles.js';
import { bulletShell } from '../src/game/combat.js';
import { loadData } from '../tools/load-data.mjs';
import { weaponDamage, weaponReloadRate } from '../src/game/weaponDamage.js';

const adoption = { source: 'human-direct-instruction', statement: '同時完成所有的音效生成和替換' };
const bank = () => ({ schemaVersion: 1, selectionState: 'user-directed', adoption,
  profiles: [
    { id: 'mg34', kind: 'mg', bindings: ['mg:mg34'], cues: { report: 'report_mg34' } },
    { id: 'm2hb', kind: 'mg', bindings: ['mg:m2hb'], cues: { report: 'report_m2hb' } },
    { id: 'rotary', kind: 'weapon', bindings: ['gun:rotary'], mechanism: 'rotary', cues: { spinUp: 'spin', fireLoop: 'rotary', stop: 'stop' } },
    { id: 'engine', kind: 'engine', bindings: ['engine:vehicle'], cues: { idle: 'idle', mid: 'mid', high: 'high', load: 'load', start: 'start', stop: 'stop' } },
    { id: 'gear', kind: 'runningGear', bindings: [], selector: 'track_medium', cues: { loop: 'track' } },
    { id: 'ground', kind: 'impact', bindings: [], selector: 'earth_gravel', cues: { tail: 'ground' } },
    { id: 'small', kind: 'blast', bindings: [], selector: 'small', cues: { report: 'blast' } },
    { id: 'flight', kind: 'flight', bindings: [], selector: 'small', cues: { approach: 'approach', recede: 'recede', crack: 'crack' } },
  ], cues: Object.fromEntries(['report_mg34','report_m2hb','spin','rotary','stop','idle','mid','high','load','start','track','ground','blast','approach','recede','crack'].map(id => [id, { url: 'data:audio/wav;base64,AA==', sha256: 'a'.repeat(64), loop: ['rotary','idle','mid','high','load','track'].includes(id), durationSeconds: 1, level: .5 }])) });
function fixture() {
  const starts = [], nodes = [], sound = new Sound();
  sound.master = { connect() {}, disconnect() {} };
  const param = () => ({ value: 0, setValueAtTime(v) { this.value = v; }, setTargetAtTime(v) { this.value = v; }, linearRampToValueAtTime(v) { this.value = v; } });
  sound.ctx = { currentTime: 10, state: 'running', createBufferSource() {
    const n = { playbackRate: param(), connect() {}, disconnect() { this.disconnected = true; }, start(at) { starts.push({ id: this.buffer.id, at, node: this }); }, stop() { this.stopped = true; this.onended?.(); } }; nodes.push(n); return n;
  }, createGain() { return { gain: param(), connect() {}, disconnect() {} }; }, createPanner() { return { positionX: param(), positionY: param(), positionZ: param(), orientationX: param(), orientationY: param(), orientationZ: param(), connect() {}, disconnect() {} }; },
  createOscillator() { throw new Error('generated events cannot synthesize'); } };
  sound.loadFullBank(bank());
  for (const id of Object.keys(bank().cues)) sound.full.buffers.set(id, { id, length: 100, numberOfChannels: 1 });
  sound.setListener({ position: [0,0,0], forward: [0,0,1], up: [0,1,0], velocity: [0,0,0], time: 1 });
  return { sound, starts, nodes };
}
test('simultaneous physical MGs retain independent identity and cadence', () => {
  const r=fixture();
  r.sound.mg(7.92,{weaponId:'mg34',emitterId:'player/mg0',eventId:1,time:1,position:[0,0,0]});
  r.sound.mg(12.7,{weaponId:'m2hb',emitterId:'player/mg1',eventId:1,time:1,position:[0,0,0]});
  assert.deepEqual(r.starts.map(s=>s.id),['report_mg34','report_m2hb']);
});
test('actual main MG step forwards each physical round and mounted identity', () => {
  const source=fs.readFileSync(new URL('../src/main.js',import.meta.url),'utf8').replaceAll('\r\n','\n');
  const begin=source.indexOf('  function stepMachineGuns('), end=source.indexOf('\n  }',begin)+4;
  const data=loadData(), r=fixture(), m={def:data.machineGuns.mg34,damageKey:'mg:roof'}, G={time:1,mode:'battle',workshop:false,caps:null,online:null,weaponControl:{kind:'all'},fireHeld:false,mgHeld:true,MG:[{m,st:mgSim.newMg(m.def),bearing:true}],bullets:[],bulletShells:new Map(),cam:{shake:0},veh:{body:{v:[0,0,0]}}};
  const deps={G,mgSim,bulletShell,layMg:()=>({pos:[0,0,0],dir:[0,0,1]}),weaponDamage:()=>({can_fire:true,dispersion_mult:1}),machineGunTrigger:()=>true,weaponReloadRate:()=>1,gunnery:{disperse:d=>d},ballistics:{newShot:()=>({})},rng:{},fx:{mgFlash(){}},sound:r.sound,net:{send(){}},onlineAmmo:{scope:()=>null}};
  const step=new Function(...Object.keys(deps),source.slice(begin,end)+';return stepMachineGuns;')(...Object.values(deps));
  step(.2);
  assert.equal(G.bullets.length,3);
  assert.equal(r.starts.length,3);
  assert.deepEqual(r.starts.map(s=>s.id),Array(3).fill('report_mg34'));
  assert.ok(r.starts[1].at>r.starts[0].at && r.starts[2].at>r.starts[1].at);
});
test('accepted online fire plays once; rejected and stale requests never play', () => {
  const r=fixture(), base={weaponId:'mg34',emitterId:'player/mg0',time:1,position:[0,0,0],accepted:false,session:'life1'};
  r.sound.mg(7.92,{...base,seq:1}); r.sound.mg(7.92,{...base,seq:2});
  assert.equal(r.starts.length,0);
  r.sound.confirmFire(1);r.sound.confirmFire(1);r.sound.rejectFire(2);
  assert.equal(r.starts.length,1);
  r.sound.mg(7.92,{...base,seq:3});r.sound.cancelFull();r.sound.confirmFire(3);assert.equal(r.starts.length,1);
});
test('missing or pending generated clips remain silent and ended sources release admission', () => {
  const r=fixture();r.sound.full.buffers.delete('report_mg34');
  r.sound.mg(7.92,{weaponId:'mg34',emitterId:'x',time:1,position:[0,0,0]});assert.equal(r.starts.length,0);
  r.sound.mg(12.7,{weaponId:'m2hb',emitterId:'x',time:1,position:[0,0,0],eventId:2});
  assert.equal(r.sound.full.voices.size,1);r.nodes.at(-1).onended();assert.equal(r.sound.full.voices.size,0);assert.equal(r.nodes.at(-1).disconnected,true);
});
test('rotary firing starts only after actual bullets, stops by owner and never scales source count by rpm', () => {
  const r=fixture();r.sound.rotaryState({weaponId:'rotary',emitterId:'aps1',spin:1,firing:true,position:[0,0,0]});
  assert.ok(!r.starts.some(s=>s.id==='rotary'));
  for(let i=0;i<100;i++)r.sound.shot(23,{weaponId:'rotary',emitterId:'aps1',time:1,position:[0,0,0],eventId:i});
  assert.equal(r.starts.filter(s=>s.id==='rotary').length,1);
  r.sound.rotaryState({weaponId:'rotary',emitterId:'aps1',spin:0,firing:false,position:[0,0,0]});
  assert.ok(r.nodes.find(n=>n.buffer?.id==='rotary').stopped);
});
test('actual engine bands, pivot-turn tracks and stopped rig lifecycle', () => {
  const r=fixture(), v={emitterId:'vehicle1',vehicleId:'vehicle',running:true,rpm:600,idleRpm:600,maxRpm:2000,load:0,position:[0,0,0],track:[2,-2],runningGear:'track_medium',time:1};
  r.sound.vehicleState(v);r.sound.vehicleState({...v,rpm:1800,load:1});
  assert.ok(r.starts.some(s=>s.id==='track'));assert.equal(r.starts.filter(s=>s.id==='start').length,1);
  assert.ok(r.sound.full.loops.size<=4);
  r.sound.vehicleState({...v,running:false});assert.equal(r.sound.full.loops.size,0);assert.equal(r.starts.filter(s=>s.id==='stop').length,1);
});
test('distance schedules physical arrivals; terminal bursts use reported mass and never invent zero-mass explosions',()=>{
  const r=fixture();r.sound.mg(7.92,{weaponId:'mg34',emitterId:'remote',eventId:1,time:1,position:[0,0,343]});assert.equal(r.starts[0].at,11);
  r.sound.contact({eventId:'a',position:[0,0,0],material:'earth_gravel',bursts:[],time:1});assert.ok(!r.starts.some(s=>s.id==='blast'));
  r.sound.contact({eventId:'b',position:[0,0,0],bursts:[{explosive_mass_kg:0}],time:1});assert.ok(!r.starts.some(s=>s.id==='blast'));
  r.sound.contact({eventId:'c',position:[0,0,0],bursts:[{explosive_mass_kg:.1}],time:1});r.sound.contact({eventId:'c',position:[0,0,0],bursts:[{explosive_mass_kg:.1}],time:1});assert.equal(r.starts.filter(s=>s.id==='blast').length,1);
});
test('nearby physical supersonic crossing emits one crack, subsonic and removal are silent',()=>{
  const r=fixture();for(let i=0;i<2;i++)r.sound.projectileSegment({id:'p',p0:[-10,0,1],p1:[10,0,1],velocity:[700,0,0],time:1,caliber:8});
  assert.equal(r.starts.filter(s=>s.id==='crack').length,1);r.sound.projectileSegment({id:'s',p0:[-10,0,1],p1:[10,0,1],velocity:[100,0,0],time:1,caliber:8});assert.equal(r.starts.filter(s=>s.id==='crack').length,1);r.sound.removeProjectile('p');assert.ok(!r.sound.full.trackers.has('p'));
});
test('actual authored profile roles cover all source identities and additive effect layers',()=>{
  const authored=JSON.parse(fs.readFileSync(new URL('../../../tools/audio/banks/full-game-bindings-v1.json',import.meta.url),'utf8'));
  const sound=new Sound(),fixtureBank={...authored,selectionState:'user-directed',cues:Object.fromEntries(Object.entries(authored.cues).map(([id,c])=>[id,{...c,url:'data:audio/wav;base64,AA==',sha256:'a'.repeat(64)}]))};
  assert.equal(sound.loadFullBank(fixtureBank),true);
  for(const id of Object.keys(loadData().machineGuns))assert.ok(sound.full.profile('mg',id),id);
  assert.ok(sound.full.generic(37));assert.ok(sound.full.generic(75));assert.ok(sound.full.generic(183));
  assert.ok(sound.full.effect('flight','small').cues.sonicCrack);
  assert.ok(sound.full.effect('flight','small').cues.recede);
  assert.ok(sound.full.loadingProfile({id:'m46_130'}).cues.chargeLoad);
  assert.ok(sound.full.loadingProfile({id:'mg42'},'mg').cues.load);
});
function firedReloadFixture(id='de_tiger_e') {
  const data=loadData(),r=fixture(),lo=loadout.makeLoadout(id,data.vehicles[id],data.projectiles,data.machineGuns),gun=lo.turrets[0].guns[0],L=loading.newLoading(1,1,[!!gun.mechanizedLoading],[gun.mechanizedLoading]);
  const b=bank();b.profiles.push({id:'tested_cannon',kind:'weapon',bindings:['gun:'+gun.def.id],cues:{report:'report_mg34'}});r.sound.loadFullBank(b);for(const id of Object.keys(b.cues))r.sound.full.buffers.set(id,{id,length:100,numberOfChannels:1});
  r.sound.loadReloadBank({schemaVersion:1,reviewState:'reviewed',automaticAdoption:{source:'human-direct-instruction',scope:'three-fitted-az-t72-stages',mechanism:'az_t72'},cues:{}});for(const stage of ['grab','load','lock'])r.sound.reloadSamples['de_manual_'+stage]={id:stage,length:100,numberOfChannels:1};for(const stage of ['drive','ram','lock'])r.sound.reloadSamples['az_t72_'+stage]={id:stage,length:100,numberOfChannels:1};
  r.sound.setListener({position:[0,0,0],time:1});
  const G={time:1,weaponControl:{kind:'all'},loadout:lo,T:[{yaw:0,guns:[{pitch:0}],loading:L}],caps:null,online:null,aps:null,ss:{pitch:0,roll:0},shots:[],veh:{body:new RigidBody(1000,[1000,1000,1000],[0,0,0]),impulse(){},worldPoint:p=>p},cam:{shake:0},sightT:0};
  const src=fs.readFileSync(new URL('../src/main.js',import.meta.url),'utf8').replaceAll('\r\n','\n'),start=src.indexOf('  function fireGun('),end=src.indexOf('\n  }',start)+4;
  const mountStart=src.indexOf('  const mountOf ='),mountEnd=src.indexOf('\n  };',mountStart)+5,mountOf=new Function(src.slice(mountStart,mountEnd)+';return mountOf;')();
  const deps={G,sound:r.sound,gunControlActive:()=>true,weaponDamage:()=>({can_fire:true,dispersion_mult:1}),net:{open:true},onlineAmmo:{scope:()=>null},mountOf,gunnery,pose:()=>({pos:[0,0,0],heading:0}),hullTilt:()=>0,ballistics,rng:{nextF32:()=>.5},surfaceAt:()=>0,loading,fx:{muzzleBlast(){}},impactColor:()=>null,RECOIL_ROCK:.1,...loadout,performance:{now:()=>1000}};
  const fire=new Function(...Object.keys(deps),src.slice(start,end)+';return fireGun;')(...Object.values(deps));
  assert.equal(fire(0,0),true);
  return {...r,G,gun,L,step(dt,rate=1){G.time+=dt;r.sound.ctx.currentTime+=dt;r.sound.setListener({position:[0,0,0],time:G.time});const done=loading.tick(L,dt,()=>loadout.reloadTime(lo.turrets[0],0,0),()=>{r.sound.reloadWork(gun,L,0,rate);return rate;},event=>r.sound.reloadStage(gun,L,event.gun,event));for(const i of done){gun.loaded=0;r.sound.reloadReady(gun,L,i);} }};
}
test('real main accepted cannon fire delays initial loading to 1.5 seconds without shifting work',()=>{
  const r=firedReloadFixture();r.step(.1);
  const grab=r.starts.find(s=>s.id==='grab');assert.ok(grab);assert.equal(grab.at,11.5);
  assert.equal(r.L.state[0],'loading');assert.ok(r.L.loaders[0].remaining<7.5);
  r.step(.9);assert.ok(grab.at>r.sound.ctx.currentTime);r.step(.5);assert.equal(grab.at,r.sound.ctx.currentTime);
});
test('cancel, pause and a ready-before-onset cycle stop delayed handling',()=>{
  for(const stop of [r=>r.sound.cancelReload(r.gun),r=>r.sound.setReloadAudible(false),r=>{r.gun.loaded=0;r.sound.reloadReady(r.gun,r.L,0);}]){const r=firedReloadFixture();r.step(.1);const grab=r.starts.find(s=>s.id==='grab');stop(r);assert.equal(grab.node.stopped,true);assert.ok([...r.sound.reloadVoices].every(v=>v!==grab.node));}
});
test('actual fitted AZ initial drive waits 1.5 seconds and later consumed rams/ready are unchanged',()=>{
  const r=firedReloadFixture('su_t72a');r.step(.1);const drive=r.starts.find(s=>s.id==='drive');assert.equal(drive.at,11.5);
  for(let i=0;i<600&&r.L.state[0]!=='ready';i++)r.step(1/60);
  assert.equal(r.starts.filter(s=>s.id==='drive').length,1);assert.equal(r.starts.filter(s=>s.id==='ram').length,2);assert.equal(r.starts.filter(s=>s.id==='lock').length,1);assert.equal(r.L.state[0],'ready');
});
test('stall during delayed manual handling stops it and resume never catches up acquisition',()=>{
  const r=firedReloadFixture();r.step(.1);const grab=r.starts.find(s=>s.id==='grab');r.step(.1,0);assert.equal(grab.node.stopped,true);r.step(2,0);r.step(.1);assert.equal(r.starts.filter(s=>s.id==='grab').length,1);assert.ok(r.L.loaders[0].remaining>7);
});
test('real workshop packing retains transplanted weapon and inherited engine source identity',()=>{
  const data=loadData(),result=loadout.buildToBundle({base:'de_hetzer',keepStock:false,turrets:[{...loadout.newTurretSpec(),guns:[{weapon:'de_tiger_e'}]}]},data),lo=loadout.makeLoadout('custom',result.bundle,{...data.projectiles,...result.projectiles},data.machineGuns);
  assert.equal(lo.turrets[0].guns[0].def.id,'kwk36_88_l56');
  assert.equal(lo.turrets[0].guns[0].sourceVehicle,'de_tiger_e');
  assert.equal(lo.engine.audio_source_vehicle,'de_hetzer');
});
test('actual missile-world fired list authorizes rotary audio and duplicate ordinals cannot restart it',()=>{
  const r=fixture(),ms=new Missiles({sound:r.sound,defs:{},projectiles:{},renderer:{mesh:data=>({data}),freeMesh(){}},scene:{},fx:{mgFlash(){},spawn(){}}});ms.setAudioMount(1,'rotary','gun:1:0',[0,0,0]);
  ms.present({aps:[{owner:1,spin:1,firing:true}],fired:[],missiles:[],events:[]},1/60);assert.equal(r.starts.filter(s=>s.id==='rotary').length,0);
  const event={aps:1,pos:[0,0,0],vel:[0,0,1000],tracer:false,ordinal:7,at:1};
  ms.present({aps:[{owner:1,spin:1,firing:true}],fired:[event,event],missiles:[],events:[]},1/60);assert.equal(r.starts.filter(s=>s.id==='rotary').length,1);
  ms.present({aps:[{owner:1,spin:0,firing:false}],fired:[],missiles:[],events:[]},1/60);assert.equal(r.sound.full.loops.size,0);
});
test('generated source setup/start failures and throwing cleanup never consume admissions',()=>{
  for(const method of ['createBufferSource','createGain','createPanner']){const r=fixture();r.sound.ctx[method]=()=>{throw new Error(method);};assert.doesNotThrow(()=>r.sound.mg(7.92,{weaponId:'mg34',emitterId:'x',time:1,position:[0,0,0]}));assert.equal(r.sound.full.voices.size,0);}
  const r=fixture(),create=r.sound.ctx.createBufferSource;r.sound.ctx.createBufferSource=()=>{const n=create();n.start=()=>{throw new Error('start');};n.stop=()=>{throw new Error('stop');};n.disconnect=()=>{throw new Error('disconnect');};return n;};
  for(let i=0;i<100;i++)assert.doesNotThrow(()=>r.sound.mg(7.92,{weaponId:'mg34',emitterId:'x',time:1,position:[0,0,0],eventId:i}));assert.equal(r.sound.full.voices.size,0);r.sound.cancelFull();
});
test('long firing is bounded and suspended/dead/replaced owners cancel scheduled sources',()=>{
  const r=fixture();for(let i=0;i<1000;i++)r.sound.mg(7.92,{weaponId:'mg34',emitterId:'x',eventId:i,time:1,position:[0,0,343]});
  assert.equal(r.sound.full.voices.size,24);assert.ok(r.sound.full.seen.size<=2048);r.sound.setFullAudible(false);assert.equal(r.sound.full.voices.size,0);assert.ok(r.nodes.every(n=>n.stopped));
  r.sound.setFullAudible(true);r.sound.mg(7.92,{weaponId:'mg34',emitterId:'y',eventId:1,time:1,position:[0,0,0]});r.sound.cancelOwner('y');assert.equal(r.sound.full.voices.size,0);r.sound.loadFullBank(bank());assert.equal(r.sound.full.voices.size,0);
});
test('generated bank initializes a keyless context without creating legacy oscillators',()=>{
  const old=globalThis.window;let oscillators=0,closed=0;globalThis.window={AudioContext:class{constructor(){this.currentTime=0;this.state='running';this.destination={};}createGain(){return{gain:{value:0},connect(){},disconnect(){}};}createOscillator(){oscillators++;throw new Error('legacy synth');}close(){closed++;}}};
  try{const sound=new Sound();sound.loadFullBank(bank());assert.doesNotThrow(()=>sound.start());assert.equal(oscillators,0);sound.dispose();assert.equal(closed,1);}finally{globalThis.window=old;}
});
test('two decoding workers reject oversized buffers and stale bank results',async()=>{
  const oldFetch=globalThis.fetch;globalThis.fetch=async()=>({arrayBuffer:async()=>new ArrayBuffer(4)});const sound=new Sound(),waiting=[];let active=0,peak=0;
  sound.loadFullBank(bank());sound.ctx={state:'running',currentTime:0,decodeAudioData(){active++;peak=Math.max(peak,active);return new Promise(resolve=>waiting.push(value=>{active--;resolve(value);}));}};
  try{for(let i=0;i<30;i++)sound.full.request('report_mg34');await new Promise(setImmediate);assert.equal(active,1,'a pending decode is never duplicated by repeated physical events');for(const id of ['report_mg34','report_m2hb','spin'])sound.full.request(id);await new Promise(setImmediate);assert.equal(peak,2);const stale=sound.full;sound.loadFullBank(bank());sound.full.request('spin');await new Promise(setImmediate);assert.equal(peak,2,'bank replacement cannot double the active worker budget');for(const done of waiting.splice(0))done({length:100,numberOfChannels:1});await new Promise(setImmediate);assert.equal(stale.buffers.size,0);assert.equal(sound.full.buffers.size,0);for(const done of waiting.splice(0))done({length:100,numberOfChannels:1});await new Promise(setImmediate);
    const beforeBytes=sound.full.bytes;sound.full.request('report_mg34');await new Promise(setImmediate);waiting.shift()({length:9*1024*1024,numberOfChannels:1});await new Promise(setImmediate);assert.equal(sound.full.buffers.has('report_mg34'),false);assert.equal(sound.full.bytes,beforeBytes);
  }finally{for(const done of waiting.splice(0))done({length:1,numberOfChannels:1});sound.dispose();globalThis.fetch=oldFetch;}
});
test('accepted loading and full-bank cues share the two-worker decoded-memory budget',async()=>{
  const oldFetch=globalThis.fetch;globalThis.fetch=async()=>({arrayBuffer:async()=>new ArrayBuffer(4)});const sound=new Sound(),waiting=[];let active=0,peak=0;
  sound.loadReloadBank({schemaVersion:1,reviewState:'reviewed',cues:{de_manual_grab:{url:'data:audio/wav;base64,AA=='},de_manual_load:{url:'data:audio/wav;base64,AA=='}}});sound.loadFullBank(bank());
  sound.ctx={state:'running',currentTime:0,decodeAudioData(){active++;peak=Math.max(peak,active);return new Promise(resolve=>waiting.push(()=>{active--;resolve({length:100,numberOfChannels:1});}));}};
  try{sound.reloadWanted.add('de_manual_grab');sound.reloadWanted.add('de_manual_load');sound._decodeReloadPending();sound.full.request('report_mg34');sound.full.request('report_m2hb');await new Promise(setImmediate);assert.equal(peak,2);while(waiting.length){for(const finish of waiting.splice(0))finish();await new Promise(setImmediate);}assert.ok(sound.reloadBytes+sound.full.bytes<=32*1024*1024);}finally{for(const finish of waiting.splice(0))finish();sound.dispose();globalThis.fetch=oldFetch;}
});
test('invalid replacement bank keeps migrated firing moments silent instead of resurrecting synthesis',()=>{
  const r=fixture();assert.equal(r.sound.loadFullBank(null),false);assert.doesNotThrow(()=>r.sound.mg(7.92,{weaponId:'mg34',time:1}));assert.equal(r.starts.length,0);
});
test('an emission observer failure cannot abort real MG count, belt or cyclic state',()=>{
  const def=loadData().machineGuns.mg42,a=mgSim.newMg(def),b=mgSim.newMg(def);const expected=mgSim.stepMg(def,a,true,.2);
  let count;assert.doesNotThrow(()=>{count=mgSim.stepMg(def,b,true,.2,1,()=>{throw new Error('presentation');});});assert.equal(count,expected);assert.deepEqual(b,a);
});
test('actual accepted peer MG entrance creates physical presentation sweeps without client damage authority',()=>{
  const source=fs.readFileSync(new URL('../src/main.js',import.meta.url),'utf8').replaceAll('\r\n','\n'),a=source.indexOf("  net.on('mg_fired',"),b=source.indexOf("  net.on('damage',",a),r=fixture(),data=loadData(),G={time:1,mode:'battle',online:{team:0},bullets:[],camPos:[0,0,0],MG:[]};let receive,mutations=0,sent=0;
  new Function('net','G','data','sound','mgSim','ballistics',source.slice(a,b))({on(_t,fn){receive=fn;},send(){sent++;}},G,data,r.sound,mgSim,ballistics);
  receive({from:2,seq:7,instance:'mg:roof',gun:'mg34',o:[0,0,0],d:[0,0,1],at:1,ammo_scope:{battle:1,life:1}});
  receive({from:2,seq:7,instance:'mg:roof',gun:'mg34',o:[0,0,0],d:[0,0,1],at:1,ammo_scope:{battle:1,life:1}});
  assert.equal(G.bullets.length,1);assert.equal(G.bullets[0].from,2);assert.equal(r.starts[0].id,'report_mg34');
  assert.equal(r.starts.length,1,'duplicate accepted peer event cannot replay a report or create another sweep');
  const begin=source.indexOf('  function updateBullets('),end=source.indexOf('\n  }',begin)+4;
  const deps={G,BULLET_DT:1/360,ballistics,rangeTargets:()=>[],hitTargets:()=>null,hitEnemy:()=>({e:{combat:{},alive:true,remote:false},hit:{point:[0,0,1]}}),buildingHit:()=>null,fx:{bulletBoard(){},beam(){}},sound:r.sound,combatHit:()=>{mutations++;},groundHit:()=>null,net:{send(){sent++;}}};
  const step=new Function(...Object.keys(deps),source.slice(begin,end)+';return updateBullets;')(...Object.values(deps));step(.01);assert.equal(mutations,0);assert.equal(sent,0);assert.equal(G.bullets.length,0);
});
test('actual peer MG range-target sweep preserves FX without mutating score or hit feedback',()=>{
  const source=fs.readFileSync(new URL('../src/main.js',import.meta.url),'utf8').replaceAll('\r\n','\n'),begin=source.indexOf('  function updateBullets('),end=source.indexOf('\n  }',begin)+4,data=loadData();
  for(const peer of [true,false]){let boards=0,markers=0,contacts=0;const target={mgHits:3,range:100,x:0,y:0},G={time:1,mgHits:4,lastMgHit:null,bullets:[{from:peer?2:undefined,s:ballistics.newShot([0,0,0],[0,0,1],mgSim.bulletOf(data.machineGuns.mg34)),def:data.machineGuns.mg34,age:0,travelled:0,tracer:false}]};
    const deps={G,BULLET_DT:1/360,ballistics,rangeTargets:()=>[target],hitTargets:()=>({target,point:[0,0,1]}),hitEnemy:()=>null,buildingHit:()=>null,fx:{bulletBoard(){boards++;}},sound:{projectileSegment(){},contact(){contacts++;},removeProjectile(){}},hud:{hitMarker(){markers++;}}};
    new Function(...Object.keys(deps),source.slice(begin,end)+';return updateBullets;')(...Object.values(deps))(.01);
    assert.equal(boards,1);assert.equal(contacts,1);assert.equal(G.bullets.length,0);assert.equal(target.mgHits,peer?3:4);assert.equal(G.mgHits,peer?4:5);assert.equal(markers,peer?0:1);assert.equal(G.lastMgHit===null,peer);
  }
});
test('disposing sound disconnects and releases compressor and master after active sources',()=>{
  const r=fixture();let compressorDisconnects=0,masterDisconnects=0;r.sound.compressor={disconnect(){compressorDisconnects++;}};r.sound.master.disconnect=()=>{masterDisconnects++;};
  r.sound.mg(7.92,{weaponId:'mg34',emitterId:'x',time:1,position:[0,0,0]});r.sound.dispose();r.sound.dispose();assert.equal(compressorDisconnects,1);assert.equal(masterDisconnects,1);assert.equal(r.sound.compressor,null);assert.equal(r.sound.master,null);assert.equal(r.sound.ctx,null);assert.ok(r.nodes.every(n=>n.stopped));
});
test('actual main MG loading is silent without consumed work and a stall cancels handling without replay on resume',()=>{
  const r=fixture(),data=loadData(),def=data.machineGuns.mg34,m={def,damageKey:'mg:roof'},b=bank();b.reloads={mg:{mg34:{profile:'mg_feed'}}};b.profiles.push({id:'mg_feed',kind:'loading',bindings:[],cues:{grab:'start',load:'load',lock:'stop'}});r.sound.loadFullBank(b);for(const id of Object.keys(b.cues))r.sound.full.buffers.set(id,{id,length:100,numberOfChannels:1});
  const st=mgSim.newMg(def);st.belt=0;st.reload=def.reload_s;const G={time:1,mode:'battle',workshop:false,caps:{repair_s:1},online:null,weaponControl:{kind:'all'},fireHeld:false,mgHeld:false,MG:[{m,st,bearing:true}],bullets:[],cam:{shake:0},veh:{body:{v:[0,0,0]}}};
  const source=fs.readFileSync(new URL('../src/main.js',import.meta.url),'utf8').replaceAll('\r\n','\n'),a=source.indexOf('  function stepMachineGuns('),end=source.indexOf('\n  }',a)+4,deps={G,mgSim,layMg:()=>({pos:[0,0,0],dir:[0,0,1]}),weaponDamage,weaponReloadRate,machineGunTrigger:()=>false,gunnery,ballistics,rng:{},fx:{},sound:r.sound,net:{send(){}},onlineAmmo:{scope:()=>null}},step=new Function(...Object.keys(deps),source.slice(a,end)+';return stepMachineGuns;')(...Object.values(deps));
  step(.1);assert.equal(st.reload,def.reload_s);assert.equal(r.starts.length,0);G.caps.repair_s=0;step(.1);assert.equal(r.starts.filter(s=>s.id==='start').length,1);const grab=r.starts.at(-1).node;
  G.caps.repair_s=1;step(.1);assert.equal(grab.stopped,true);G.caps.repair_s=0;step(.1);assert.equal(r.starts.filter(s=>s.id==='start').length,1);assert.equal(r.starts.filter(s=>s.id==='load').length,0);step(2);assert.equal(r.starts.filter(s=>s.id==='load').length,1);step(def.reload_s);assert.equal(st.reload,0);assert.equal(st.belt,def.belt_rounds);assert.equal(r.starts.filter(s=>s.id==='stop').length,1);assert.equal(r.sound.full.jobs.size,0);
});
test('MG reload acquisition begins only after exhaustion consumes reload work and zero-ammo completion cannot lock',()=>{
  const r=fixture(),def=loadData().machineGuns.mg34,m={def},b=bank();b.reloads={mg:{mg34:{profile:'mg_feed'}}};b.profiles.push({id:'mg_feed',kind:'loading',bindings:[],cues:{grab:'start',load:'load',lock:'stop'}});r.sound.loadFullBank(b);for(const id of Object.keys(b.cues))r.sound.full.buffers.set(id,{id,length:100,numberOfChannels:1});
  const st=mgSim.newMg(def);st.belt=1;let previous=st.reload;assert.equal(mgSim.stepMg(def,st,true,.01),1);r.sound.mgLoading(m,st,previous);assert.equal(r.starts.length,0);previous=st.reload;mgSim.stepMg(def,st,false,.1);r.sound.mgLoading(m,st,previous);assert.equal(r.starts.filter(s=>s.id==='start').length,1);r.sound.mgLoading(m,{...st,reload:0,belt:0},st.reload);assert.equal(r.starts.filter(s=>s.id==='stop').length,0);r.sound.cancelFull();assert.equal(r.sound.full.jobs.size,0);
});
test('equipped MG loading roles are preloaded through their authored reload profile',()=>{
  const r=fixture(),b=bank();b.reloads={mg:{mg34:{profile:'mg_feed'}}};b.profiles.push({id:'mg_feed',kind:'loading',bindings:[],cues:{grab:'start',load:'load',lock:'stop'}});r.sound.loadFullBank(b);const requests=[];r.sound.full.request=(id,pin)=>requests.push({id,pin});r.sound.prepareFullBank({turrets:[],machineGuns:[{def:loadData().machineGuns.mg34}]},null);for(const id of ['start','load','stop'])assert.ok(requests.some(r=>r.id===id&&r.pin),id);
});
test('actual tree fell route uses its wood contact and preserves physical slowdown and count',()=>{
  const r=fixture(),b=bank();b.profiles.push({id:'wood_collision',kind:'impact',selector:'wood_collision',bindings:[],cues:{debris:'ground'}});r.sound.loadFullBank(b);for(const id of Object.keys(b.cues))r.sound.full.buffers.set(id,{id,length:100,numberOfChannels:1});const body={v:[10,1,0],worldPoint:p=>p.map((x,i)=>x+[2,3,4][i])},G={time:1,mode:'battle',veh:{body},s:{x:2,z:4,heading:0},dims:{width:3,front:4,rear:-2},treesDown:2},source=fs.readFileSync(new URL('../src/main.js',import.meta.url),'utf8').replaceAll('\r\n','\n'),a=source.indexOf('        const fell = w.collide('),end=source.indexOf('\n        }',a)+10;
  const run=new Function('G','w','b','sound',source.slice(a,end));run(G,{collide:()=>1},body,r.sound);assert.deepEqual(body.v,[8.8,1,0]);assert.equal(G.treesDown,3);assert.deepEqual(r.starts.map(s=>s.id),['ground']);run(G,{collide:()=>1},body,r.sound);assert.equal(r.starts.length,2,'two physical fell events each remain audible');assert.equal(G.treesDown,4);
});
test('actual MG building contact plays the resolved world surface without score or damage feedback',()=>{
  const r=fixture(),def=loadData().machineGuns.mg34,G={time:1,bullets:[{s:ballistics.newShot([0,0,0],[0,0,1],mgSim.bulletOf(def)),def,age:0,travelled:0,tracer:false}]},source=fs.readFileSync(new URL('../src/main.js',import.meta.url),'utf8').replaceAll('\r\n','\n'),a=source.indexOf('  function updateBullets('),end=source.indexOf('\n  }',a)+4;
  const deps={G,BULLET_DT:1/360,ballistics,rangeTargets:()=>[],hitTargets:()=>null,hitEnemy:()=>null,buildingHit:()=>({point:[0,0,1],t:.1}),fx:{bulletGround(){}},MASONRY_DUST:[],sound:r.sound};new Function(...Object.keys(deps),source.slice(a,end)+';return updateBullets;')(...Object.values(deps))(.01);assert.equal(G.bullets.length,0);assert.deepEqual(r.starts.filter(s=>s.id==='ground').map(s=>s.id),['ground']);
});
test('every actual loadout firing entrance dispatches the authored gun/MG family including shared KPVT',()=>{
  const raw=JSON.parse(fs.readFileSync(new URL('../assets/full-audio.json',import.meta.url),'utf8')),r=fixture(),b={...raw,cues:Object.fromEntries(Object.entries(raw.cues).map(([id,c])=>[id,{...c,url:'data:audio/wav;base64,AA=='}]))};r.sound.loadFullBank(b);for(const id of Object.keys(b.cues))r.sound.full.buffers.set(id,{id,length:100,numberOfChannels:1});r.sound.setListener({position:[0,0,0],time:1});
  const source=fs.readFileSync(new URL('../src/main.js',import.meta.url),'utf8'),line=method=>{const start=source.indexOf(`sound.${method}(g.def.caliber_mm,`);assert.ok(start>=0);return source.slice(start,source.indexOf('\n',start));},callAuto=new Function('sound','g','G','shot','mz',line('mg')),callCannon=new Function('sound','g','G','shot','mz',line('shot')),data=loadData(),G={time:1,online:null,veh:{body:{v:[0,0,0]}}};let guns=0,mgs=0;
  for(const [vehicle,bundle] of Object.entries(data.vehicles)){const lo=loadout.makeLoadout(vehicle,bundle,data.projectiles,data.machineGuns);for(const turret of lo.turrets)for(const g of turret.guns){if(g.def.missile){assert.ok(r.sound.full.profile('missile',g.def.missile));continue;}r.sound.cancelFull();const before=r.starts.length,p=r.sound.full.profile('weapon',g.def.id);assert.ok(p,`${vehicle}/${g.def.id}`);(g.def.autocannon?callAuto:callCannon)(r.sound,g,G,{}, {pos:[0,0,0],dir:[0,0,1]});assert.equal(r.starts.length,before+1,`${vehicle}/${g.def.id}`);assert.equal(r.starts.at(-1).id,p.cues.fireLoop||p.cues.report);guns++;}for(const m of lo.machineGuns){r.sound.cancelFull();const before=r.starts.length;r.sound.mg(m.def.caliber_mm,{weaponId:m.def.id,emitterId:'player/'+m.damageKey,eventId:1,position:[0,0,0],time:1});assert.equal(r.starts.length,before+1,m.def.id);mgs++;}}
  assert.equal(guns,45);assert.equal(mgs,47);assert.equal(r.sound.full.profile('weapon','foreign_gun'),undefined);
});
