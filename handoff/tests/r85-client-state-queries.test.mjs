import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const original=fs.readFileSync(new URL('../bundle/app.js.html',import.meta.url),'utf8');
const baseline=process.env.TF_R85_BASELINE==='1';
const patch=baseline?{}:await import('../tools/patch_r85_client_state_queries.mjs');
const app=baseline?original:patch.patchR85ReplayTargetSwitch(original);
const stateApp=baseline?original:patch.patchR85SingleplayerExit(original);
const section=(from,to)=>{const a=app.indexOf(from),b=app.indexOf(to,a+from.length);assert.ok(a>=0&&b>a,from);return app.slice(a,b);};
const existing=fs.readFileSync(new URL('./replay-r8-continuity.test.mjs',import.meta.url),'utf8');
const fixture=existing.slice(existing.indexOf('export function evidence'),existing.indexOf('\nfunction session()')).replace('export function','function');
const evidence=new Function(fixture+';return evidence;')();
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
function facade(){
 const elements=new Map(),root={hidden:true,querySelector(k){if(!elements.has(k))elements.set(k,{style:{},dataset:{}});return elements.get(k);}},presentation={hide(){},warmUp(){}};
 const hc=new runtime.HitCam({root,catalog,presentation,projectiles:{},replayDrawFactory(){return {prepare(f){return {nodes:[],frame:f};},acquire(){},dispose(){}};}});
 const target=entity=>({actor:{battle:1,entity,life:1},model:{},releases:0});
 const show=(t,n,overrides={})=>{const e={...evidence(n,{entity:t.actor.entity}),...overrides};return hc.show(t,{...e.report,replay:e},catalog.projectiles.filled50,10,false,'','offensive');};
 return {hc,target,show};
}
test('R85 new target replaces an unfinished replay synchronously without a tick or timer',()=>{
 const {hc,target,show}=facade(),a=target(2),b=target(3);
 assert.equal(show(a,1),true);const prior=hc.cur.session;assert.ok(prior.filmTimeS<prior.endFilm);
 assert.equal(show(b,1),true,'next target must acquire in the same show call');
 assert.equal(hc.cur.session.actor.entity,3);assert.equal(prior.finishReason,'replaced');assert.equal(a.releases,1);assert.equal(hc.deferred.length,0);
 hc.hide();assert.equal(b.releases,1);
});
test('R85 new target replaces a completed replay immediately and preserves duplicate rejection',()=>{
 const {hc,target,show}=facade(),a=target(2),b=target(3);show(a,1);hc.cur.session.finish('test-complete');
 assert.equal(show(b,1),true);const current=hc.cur.session;assert.equal(show(b,1),false);assert.equal(hc.cur.session,current);hc.hide();
});
test('R85 same-target rounds append without restarting the director clock or snapshot',()=>{
 const {hc,target,show}=facade(),a=target(2);show(a,1);const s=hc.cur.session,director=s.directorEvent,targetSnapshot=s.target;
 hc.tick(.1);const time=s.filmTimeS;assert.equal(show(a,2),true);assert.equal(show(a,3),true);
 assert.equal(hc.cur.session,s);assert.equal(s.filmTimeS,time);assert.equal(s.directorEvent,director);assert.equal(s.target,targetSnapshot);assert.equal(s.events.length,3);hc.hide();
});
test('R85 a failed next-target acquisition leaves current replay intact',()=>{
 const {hc,target,show}=facade(),a=target(2),b=target(3);show(a,1);const current=hc.cur;
 hc.env.replayDrawFactory=()=>{throw Error('unavailable target');};assert.equal(show(b,1),false);assert.equal(hc.cur,current);assert.equal(current.session.finished,false);assert.equal(a.releases,0);assert.equal(b.releases,1);hc.hide();
});
test('R85 victim priority and accepted battle/life validation remain enforced',()=>{
 const {hc,target,show}=facade(),a=target(2),b=target(3);show(a,1);hc.cur.session.purpose='victim';
 assert.equal(show(b,1),false);assert.equal(hc.cur.session.actor.entity,2);assert.equal(hc.deferred.length,0);hc.hide();
 assert.equal(show(a,2,{actor:{battle:2,entity:2,life:1}}),false);assert.equal(hc.cur,null);
});
test('R85 replay patch is idempotent and refuses a drifted target arbitration anchor',()=>{
 if(baseline)return;
 assert.equal(patch.patchR85ReplayTargetSwitch(app),app);
 assert.throws(()=>patch.patchR85ReplayTargetSwitch(app.replace('/* TF_R85_IMMEDIATE_REPLAY_TARGET */','/* TF_R85_IMMEDIATE_REPLAY_TARGET */\n      changedReplayOwner();')),/drift/);
});
function leaveRuntime(){
 const calls=[],keys=new Set(['KeyW']),clear=()=>{},presentation=()=>({clear,dispose:clear,root:{}});
 const f={active:true,room:{id:1},control:{},keys:new Set(['fire']),models:new Map(),airModels:new Map(),navalPresentation:presentation(),airportPresentation:presentation(),facilityPresentation:presentation(),root:{children:[],add(n){this.children.push(n);}},renderStats:{},shared:{notify:clear},establishedFlight:{release(){calls.push('release');env.G4.air=null;}}};
 const G4={frontline:f,air:{nativeAuthority:true},mode:'battle',id:'de_pz3_j',keys,view:'spectator',free:true,fireHeld:true,mgHeld:true,rmb:true,localReplay:{retire(){calls.push('retire');}},cam:{pivot:[9,9,9]}};
 const env={f,G4,m:{op:'left'},net:{},renderGate:{clear},airwarOverlay:{hidden:false},reticle:{},flightReadout:{},sound:{},gameplay:{endBattle(){calls.push('endBattle');},activeMode:()=> 'historical',setRoomProfile:clear},hud:{aps:clear,freeLook:clear,hideToast:clear},document:{pointerLockElement:null,getElementById:()=>({textContent:''})},canvas:{},testRange:{exit:clear},deploy:{close:clear},cqBar:{},cqMsg:{},hitcam:{hide(){calls.push('hitcam');}},removeAircraft:clear,isDesign:()=>false,setXray:clear,setMode(mode){G4.mode=mode;},select3(){calls.push('select');},updateGameplayDisplay:clear,useWorld(id){calls.push('world:'+id);},clearEnemies:clear,updateNetHud:clear,resetPose(){calls.push('resetPose');G4.cam.pivot=null;},measureInsets:clear,note:clear,refreshUi(){env.document.frontlineWatch=f.active?'1':'0';},releaseGroundDetail:clear};
 const garageStart=stateApp.indexOf('    function toGarage() {'),garageEnd=stateApp.indexOf('    function stepVehicle(',garageStart);
 env.toGarage=new Function('env','with(env){'+stateApp.slice(garageStart,garageEnd)+';return toGarage;}')(env);
 const from="if(m.op==='left'){f.navalPresentation.clear();",start=stateApp.indexOf(from),end=stateApp.indexOf('\n',start);
 const receive=new Function('env','with(env){'+stateApp.slice(start,end)+'}');
 return {env,f,G4,calls,leave:()=>receive(env)};
}
test('R85 accepted multiplayer leave invokes the full local garage lifecycle before solo play',()=>{
 const {leave,calls,f,G4}=leaveRuntime();leave();
 assert.deepEqual(calls,['release','retire','endBattle','select','world:range','hitcam','resetPose']);
 assert.equal(f.active,false);assert.equal(f.room,null);assert.equal(G4.view,'third');assert.equal(G4.free,false);assert.equal(G4.cam.pivot,null);assert.equal(G4.keys.size,0);assert.equal(G4.fireHeld,false);assert.equal(G4.rmb,false);
});
test('R85 accepted leave resets spectator CSS and detaches native flight before garage reset',()=>{
 const {leave,env,f,G4}=leaveRuntime();leave();assert.equal(env.document.frontlineWatch,'0');assert.equal(G4.air,null);assert.equal(f.spectator,null);assert.equal(f.lossPending,false);assert.equal(env.airwarOverlay.hidden,true);
});
test('R85 state and protection source patches are idempotent and guard their exact owner anchors',()=>{
 if(baseline)return;
 const retained=fs.readFileSync(new URL('../tools/frontline_client.js',import.meta.url),'utf8');
 const next=patch.patchR85SingleplayerExit(retained);assert.equal(patch.patchR85SingleplayerExit(next),next);
 assert.throws(()=>patch.patchR85SingleplayerExit(next.replace('/* TF_R85_LOCAL_GARAGE_EXIT */toGarage()','/* TF_R85_LOCAL_GARAGE_EXIT */changedGarageOwner()')),/drift/);
 const armor=patch.patchR85ProtectionQuery(original);assert.equal(patch.patchR85ProtectionQuery(armor),armor);
 assert.throws(()=>patch.patchR85ProtectionQuery(armor.replace('{ [spec]: packet }, this.env.renderer);','{ [spec]: packet }, changedRenderer);')),/drift/);
});

