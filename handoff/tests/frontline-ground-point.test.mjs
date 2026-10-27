import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as feedback from '../tools/agm_launch_fix.mjs';
const helper=fs.readFileSync(new URL('../tools/frontline_guided_control.js',import.meta.url),'utf8');
const app=fs.readFileSync(process.env.TF_AGM_APP||new URL('../bundle/app.js.html',import.meta.url),'utf8');
const cut=(a,b)=>{const i=app.indexOf(a),j=app.indexOf(b,i);assert.ok(i>=0&&j>i,a);return app.slice(i,j);};
const plain=x=>x===undefined?undefined:JSON.parse(JSON.stringify(x));
function fixture(kind='tv',withPod=false){
  const definitions={tv:{id:'agm65b',kind:'agm',guidance:'tv',lockRange:7000,seeker:{daylight:true}},laser:{id:'gbu12',kind:'bomb',guidance:'laser',lockRange:7000},aam:{id:'aim9l',kind:'aam',guidance:'ir'},radio:{id:'kh23',kind:'agm',guidance:'radio'}};
  const d=definitions[kind],oldTarget={unitRef:{battle:1,unit:9,life:1},enemy:{}},plane={position:[0,1000,0],worldPoint:p=>p.map((v,i)=>v+plane.position[i])};
  const dir=[0,-.6,.8],air={nativeAuthority:true,stores:{group:{id:d.id,def:d,items:[{p:[1,0,0]}]},items:[],count:1},plane,ctl:{sensor:withPod?'pod':'seeker',selected:oldTarget,seeker:{def:d,state:'search',dir:dir.slice(),point:null,est:null},radar:{on:true,stt:{target:oldTarget}},pod:withPod?{cfg:{range:7000,gate:5,laser:true},mount:[-1,0,0],dir:dir.slice(),state:'free',point:null}:null}};
  const unit={unit:{battle:1,unit:7,life:1},weapon_control:{store_id:d.id,store_index:null},seeker:{enabled:true,status:'search',point:null,target:null,reason:null,progress_s:0}};
  const reasons=[],G4={time:50},context=vm.createContext({console,Math,G4,airCtl:a=>a.ctl,airPod:a=>a.ctl.pod,storeGroup:s=>s.group,seekerOf:d=>d.seeker||{},imagingSeeker:d=>['tv','iir'].includes(d.guidance),daylight:()=>true,airReason:()=>false,L10N:(_z,e)=>e,airLos:()=>true,seekerCandidate:()=>({why:null}),vehicleInGate:()=>null,angleOf:()=>0,D2R:Math.PI/180,sub:(a,b)=>a.map((v,i)=>v-b[i]),airTargetVel:()=>[0,0,0],
    noseOf:()=>[0,0,1],seekerCancel:()=>false,worldDir:(_P,d)=>d,norm:d=>d.map(v=>v/Math.hypot(...d)),groundAlong:(from,dir,range)=>{const t=-from[1]/dir[1];return t>0&&t<=range?from.map((v,i)=>v+dir[i]*t):null;}});
  vm.runInContext(feedback.nativeGroundGuidanceReason.toString()+helper+cut('    function podTrackRequest(air) {','    // ---- the seeker of the missile')+cut('    function seekerCaptureRequest(air) {','    /** Shift+Tab:')+cut('    function airCancel(air) {','    /** The fixed-rate step')+cut('    function podCenter(air) {','    function podModeCycle(air)'),context);
  const api=context.createFrontlineGuidedControl({group:a=>a.stores.group,resolve:r=>r?.unit===9||r?.unitRef?.unit===9?oldTarget:null,targets:()=>[oldTarget],reason:(_a,why)=>{reasons.push(why);return false;},activate:a=>{a.ctl.seeker.state='prep';},pod:a=>a.ctl.pod,podTrack:context.podTrackRequest,capture:context.seekerCaptureRequest,cancel:context.airCancel,nose:()=>[0,0,1],now:()=>G4.time});
  api.accept(air,unit);return {api,air,unit,definitions,G4,oldTarget,dir,context,reasons};
}
test('actual imaging capture emits one cached normalized direction and no client point or stale selected UnitRef',()=>{
  const f=fixture();assert.equal(f.api.action(f.air,f.unit,'space',1),true);
  const request=f.api.intent(f.air,f.unit);assert.deepEqual(plain(request.sight),f.dir);assert.equal(request.target,null);assert.equal(request.point,undefined);
  assert.ok(f.air.ctl.seeker.point,'Actual local capture found a UI point');
  f.unit.seeker.status='prep';f.api.accept(f.air,f.unit);assert.deepEqual(plain(f.api.intent(f.air,f.unit).sight),f.dir);
  f.plane=f.air.plane;f.plane.position=[500,1000,0];f.air.ctl.seeker.dir=[1,0,0];assert.deepEqual(plain(f.api.intent(f.air,f.unit).sight),f.dir,'Air motion and projected UI changes cannot retarget the cached request');
});
test('actual pod point capture supports laser-guided bombs and retains its request through accepted prep/capture',()=>{
  const f=fixture('laser',true);assert.equal(f.api.action(f.air,f.unit,'space',1),true);assert.equal(f.air.ctl.pod.state,'point');
  assert.deepEqual(plain(f.api.intent(f.air,f.unit).sight),f.dir);assert.equal(f.api.intent(f.air,f.unit).target,null);assert.equal(f.api.intent(f.air,f.unit).laser,true);
  f.api.sent(10);f.unit.seeker.accepted_capture_seq=10;f.unit.seeker.status='capturing';f.unit.seeker.progress_s=.3;f.api.accept(f.air,f.unit);assert.equal(f.api.intent(f.air,f.unit).sight,undefined);assert.equal(f.air.ctl.seeker.nativeStatus,'capturing');
});
test('accepted point owns UI estimate and native status; local estimate never grants accepted readiness',()=>{
  const f=fixture();f.api.action(f.air,f.unit,'space',1);assert.equal(f.air.ctl.seeker.nativeStatus,'prep');f.api.sent(10);
  f.unit.seeker={...f.unit.seeker,status:'capturing',point:[10,0,2000],progress_s:.25,accepted_capture_seq:10};f.api.accept(f.air,f.unit);
  assert.deepEqual(plain(f.air.ctl.seeker.point),[10,0,2000]);assert.deepEqual(plain(f.air.ctl.seeker.est),{p:[10,0,2000],v:[0,0,0],t:50});assert.equal(f.air.ctl.seeker.nativeStatus,'capturing');assert.equal(f.air.ctl.seeker.target,null);
  f.unit.seeker.status='track';f.api.accept(f.air,f.unit);assert.equal(f.air.ctl.seeker.nativeStatus,'track');
  f.unit.seeker.point=null;f.unit.seeker.status='search';f.api.accept(f.air,f.unit);assert.equal(f.air.ctl.seeker.point,null);assert.equal(f.air.ctl.seeker.est,null);
});
test('cancel, power off, life and selected store changes clear point request and prevent previous-point reuse',()=>{
  for(const transition of ['cancel','seekerOff','seekerPower','life','store']){
    const f=fixture('laser',true);f.api.action(f.air,f.unit,'space',1);assert.ok(f.api.intent(f.air,f.unit).sight,transition);
    if(transition==='life'){f.unit.unit.life++;f.api.accept(f.air,f.unit);}
    else if(transition==='store'){const d=f.definitions.tv;f.air.stores.group={id:d.id,def:d,items:[{p:[1,0,0]}]};f.api.accept(f.air,f.unit);}
    else f.api.action(f.air,f.unit,transition,2);
    assert.equal(f.api.intent(f.air,f.unit).sight,undefined,transition);assert.equal(f.air.ctl.seeker.point,null,transition);
    if(['store','seekerOff','seekerPower'].includes(transition))assert.ok(f.air.ctl.pod.point,'The independent designator must continue supporting an airborne weapon');else assert.equal(f.air.ctl.pod.point,null,transition);
  }
});
test('actual cancel preserves the independent pod on first seeker cancel and releases it on the next cancel',()=>{
  const f=fixture('laser',true);f.api.action(f.air,f.unit,'space',1);f.api.sent(10);f.unit.seeker={...f.unit.seeker,status:'track',point:[10,0,2000],accepted_capture_seq:10};f.api.accept(f.air,f.unit);
  f.api.action(f.air,f.unit,'cancel',2);assert.equal(f.api.intent(f.air,f.unit).sight,undefined);assert.equal(f.api.intent(f.air,f.unit).target,null);assert.equal(f.api.intent(f.air,f.unit).laser,true);assert.ok(f.air.ctl.pod.point);
  f.api.action(f.air,f.unit,'cancel',3);assert.equal(f.air.ctl.pod.point,null);assert.equal(f.api.intent(f.air,f.unit).laser,false);
});
test('last-store depletion preserves accepted pod illumination without carrying the old weapon capture ray',()=>{
  const f=fixture('laser',true);f.api.action(f.air,f.unit,'space',1);assert.ok(f.api.intent(f.air,f.unit).sight);
  const point=f.air.ctl.pod.point.slice();f.air.stores.group.items=[];
  const intent=f.api.intent(f.air,f.unit);assert.equal(intent.sight,undefined);assert.equal(intent.laser,true);assert.equal(intent.target,null);assert.deepEqual(plain(f.air.ctl.pod.point),point);
});
test('explicit Space can reacquire an existing pod point for a new guided store while preserving fresh native preparation',()=>{
  const f=fixture('laser',true);f.api.action(f.air,f.unit,'space',1);assert.ok(f.api.intent(f.air,f.unit).sight);
  const next={...f.definitions.laser,id:'gbu10'};f.air.stores.group={id:next.id,def:next,items:[{p:[1,0,0],count:1}]};
  f.unit.weapon_control.store_id=next.id;f.unit.seeker={...f.unit.seeker,status:'prep',point:null,progress_s:0};f.api.accept(f.air,f.unit);
  assert.equal(f.api.intent(f.air,f.unit).sight,undefined);assert.equal(f.air.ctl.pod.state,'point');
  assert.equal(f.api.action(f.air,f.unit,'space',2),true);assert.deepEqual(plain(f.api.intent(f.air,f.unit).sight),f.dir);assert.equal(f.api.intent(f.air,f.unit).target,null);
  assert.equal(f.air.ctl.seeker.nativeStatus,'prep');assert.equal(f.air.ctl.seeker.nativeProgress,0);assert.equal(f.air.stores.group.items[0].count,1);
});
test('accepted point rejoin preserves point with no new ray and suppresses stale UI target without synthesizing a sight',()=>{
  const f=fixture();f.unit.seeker={...f.unit.seeker,status:'track',point:[10,0,2000]};f.api.accept(f.air,f.unit);
  const intent=f.api.intent(f.air,f.unit);assert.equal(intent.target,null);assert.equal(intent.sight,undefined);assert.deepEqual(plain(f.air.ctl.seeker.point),[10,0,2000]);
});
test('accepted laser point rejoin restores only matching pod display/illumination without inventing a new capture ray',()=>{
  const f=fixture('laser',true);assert.equal(f.air.ctl.pod.state,'free');f.unit.seeker={...f.unit.seeker,status:'track',point:[10,0,2000]};f.api.accept(f.air,f.unit);
  const intent=f.api.intent(f.air,f.unit);assert.equal(intent.sight,undefined);assert.equal(intent.target,null);assert.equal(intent.laser,true);assert.equal(f.air.ctl.pod.state,'point');assert.deepEqual(plain(f.air.ctl.pod.point),[10,0,2000]);
});
test('accepted independent designation survives carried seeker off/AAM selection without granting a carried point or a new sight',()=>{
  const f=fixture('aam',true);f.unit.seeker={...f.unit.seeker,enabled:false,status:'off',point:null,laser:true,designation_point:[10,0,2000]};f.api.clear();f.api.accept(f.air,f.unit);
  const request=f.api.intent(f.air,f.unit);assert.equal(request.enabled,false);assert.equal(request.sight,undefined);assert.equal(request.laser,true);assert.equal(request.target.unit,9);assert.equal(f.air.ctl.seeker.point,null);assert.equal(f.air.ctl.seeker.nativeStatus,'off');assert.deepEqual(plain(f.air.ctl.pod.point),[10,0,2000]);
});
test('stale accepted designation cannot undo explicit pod cancellation between real projection steps',()=>{
  const f=fixture('laser',true);f.api.action(f.air,f.unit,'space',1);f.api.sent(10);f.unit.seeker={...f.unit.seeker,status:'track',point:[10,0,2000],laser:true,designation_point:[10,0,2000],accepted_capture_seq:10};f.api.accept(f.air,f.unit);
  f.api.action(f.air,f.unit,'cancel',2);f.api.accept(f.air,f.unit);assert.equal(f.api.intent(f.air,f.unit).laser,true);
  f.api.action(f.air,f.unit,'cancel',3);f.api.accept(f.air,f.unit);assert.equal(f.air.ctl.pod.state,'free');assert.equal(f.api.intent(f.air,f.unit).laser,false);assert.equal(f.api.intent(f.air,f.unit).sight,undefined);
});
test('actual podCenter direction action is preserved and stale designation cannot undo its explicit release',()=>{
  const f=fixture('laser',true);f.unit.seeker={...f.unit.seeker,laser:true,designation_point:[10,0,2000]};f.api.accept(f.air,f.unit);assert.equal(f.api.intent(f.air,f.unit).laser,true);
  assert.equal(f.api.action(f.air,f.unit,'podCenter'),undefined,'Original input map must still perform podCenter');f.context.podCenter(f.air);f.api.accept(f.air,f.unit);
  assert.equal(f.air.ctl.pod.state,'free');assert.equal(f.air.ctl.pod.point,null);assert.equal(f.api.intent(f.air,f.unit).laser,false);assert.equal(f.api.intent(f.air,f.unit).sight,undefined);assert.ok(f.air.ctl.pod.dir.every(Number.isFinite));
});
test('capture direction can reach native terrain/facility admission when legacy ground/LOS rejects locally, without local ready/point',()=>{
  for(const fail of ['terrain','los']){
    const f=fixture();if(fail==='terrain')f.context.groundAlong=()=>null;else f.context.airLos=()=>false;
    assert.equal(f.api.action(f.air,f.unit,'space',1),true);assert.deepEqual(plain(f.api.intent(f.air,f.unit).sight),f.dir);assert.equal(f.api.intent(f.air,f.unit).target,null);
    assert.equal(f.air.ctl.seeker.point,null);assert.equal(f.air.ctl.seeker.est,null);assert.equal(f.air.ctl.seeker.nativeStatus,'prep');
  }
  const dark=fixture();dark.context.daylight=()=>false;assert.equal(dark.api.action(dark.air,dark.unit,'space',1),false);assert.equal(dark.api.intent(dark.air,dark.unit).sight,undefined);
});
test('pod capture intent can request native facility resolution without a local point or optimistic readiness',()=>{
  const f=fixture('laser',true);f.context.groundAlong=()=>null;assert.equal(f.api.action(f.air,f.unit,'space',1),true);
  const request=f.api.intent(f.air,f.unit);assert.deepEqual(plain(request.sight),f.dir);assert.equal(request.laser,true);assert.equal(request.target,null);assert.equal(f.air.ctl.pod.point,null);assert.equal(f.air.ctl.seeker.nativeStatus,'prep');
});
test('new control epoch on a retained UnitRef cannot automatically replay a prior explicit capture',()=>{
  const f=fixture();f.unit.epoch=1;f.api.accept(f.air,f.unit);f.api.action(f.air,f.unit,'space',1);assert.ok(f.api.intent(f.air,f.unit).sight);
  f.unit.epoch=2;f.unit.seeker={...f.unit.seeker,enabled:false,status:'off',point:null};f.api.accept(f.air,f.unit);
  const request=f.api.intent(f.air,f.unit);assert.equal(request.enabled,false);assert.equal(request.sight,undefined);assert.equal(f.air.ctl.seeker.point,null);
});
test('fresh capture immediately denies old accepted readiness and waits for the exact successful native capture sequence',()=>{
  const f=fixture('laser',true);f.unit.seeker={...f.unit.seeker,status:'track',point:[10,0,2000],laser:true,designation_point:[10,0,2000],accepted_capture_seq:3};f.api.accept(f.air,f.unit);
  f.air.ctl.pod.state='free';f.air.ctl.pod.point=null;assert.equal(f.api.action(f.air,f.unit,'space',1),true);
  assert.equal(feedback.nativeAgmLaunchCheck(f.air,f.air.stores.group.def,f.air.ctl.seeker,(_z,e)=>e).ok,false,'Old track cannot authorize a new unconfirmed capture');
  assert.equal(typeof f.api.sent,'function');f.api.sent(10);f.api.accept(f.air,f.unit);assert.equal(f.air.ctl.seeker.nativeStatus,'prep');assert.ok(f.api.intent(f.air,f.unit).sight);
  f.unit.seeker.accepted_capture_seq=9;f.api.accept(f.air,f.unit);assert.equal(f.air.ctl.seeker.nativeStatus,'prep');
  f.unit.seeker={...f.unit.seeker,accepted_capture_seq:10,point:[20,0,3000],designation_point:[20,0,3000]};f.api.accept(f.air,f.unit);
  assert.equal(f.air.ctl.seeker.nativeStatus,'track');assert.deepEqual(plain(f.air.ctl.seeker.point),[20,0,3000]);assert.equal(f.api.intent(f.air,f.unit).sight,undefined,'ACK consumes the pending ray, so later ECM/radar updates preserve rather than recapture');
});
test('failed/nonfinite capture cannot emit a ray; AAM UnitRef and radio control paths retain their contracts',()=>{
  const f=fixture();f.air.ctl.seeker.dir=[NaN,0,1];f.api.action(f.air,f.unit,'space',1);assert.equal(f.api.intent(f.air,f.unit).sight,undefined);
  const a=fixture('aam');assert.equal(a.api.intent(a.air,a.unit).sight,undefined);assert.equal(a.api.intent(a.air,a.unit).target.unit,9);a.unit.seeker.status='track';a.api.accept(a.air,a.unit);assert.equal(a.api.action(a.air,a.unit,'space',2),true);assert.equal(a.air.storeTap,true);
  const r=fixture('radio');r.api.accept(r.air,r.unit,[{shot_id:42,shooter:7,phase:'radio'}]);r.api.radioSteer(r.air,20,-20,1/60);assert.ok(r.api.intent(r.air,r.unit).manual[0]>0);assert.equal(r.api.intent(r.air,r.unit).sight,undefined);
});
test('all actual native guided bombs and unguided ground stores bypass only the obsolete native online display ban',()=>{
  const source=feedback.patchAgmLaunchFeedback(app),a=source.indexOf('    // TF_NATIVE_AGM_LAUNCH_READINESS_20261027'),b=source.indexOf('    function launchGuided(',a);assert.ok(a>=0&&b>a);
  const definitions=JSON.parse(fs.readFileSync(new URL('../../data/aircraft/frontline.json',import.meta.url))).storeDefinitions;
  const c=vm.createContext({G4:{time:10,online:{}},airCtl:a=>a.ctl,storeGroup:s=>s.group,L10N:(_z,e)=>e});vm.runInContext(source.slice(a,b),c);
  let checked=0;
  for(const [id,d]of Object.entries(definitions).filter(([,d])=>['bomb','rocket','pod'].includes(d.kind))){
    const guided=d.guidance&&d.guidance!=='none',air={nativeAuthority:true,stores:{group:{id,def:d,items:[{p:[0,0,0],count:1}]}},ctl:{seeker:{def:d,nativeStatus:guided?'track':'off',nativeReason:null},nextLaunch:0},plane:{crashed:false,damage:{pilotDead:false}}};
    assert.equal(c.launchCheck(air).ok,true,id);air.nativeAuthority=false;assert.equal(c.launchCheck(air).ok,false,'Legacy online gate remains: '+id);checked++;
  }
  assert.ok(checked>=5);
});
test('actual native point rejection codes have readable feedback and no internal-key fallback',()=>{
  assert.equal(typeof feedback.nativeGroundGuidanceReason,'function');
  for(const code of ['invalid_point_sight','conflicting_point_target','point_guidance_unsupported','point_no_surface_contact','point_below_minimum_range','point_outside_gimbal','point_blocked','no_valid_point_in_seeker']){
    const zh=feedback.nativeGroundGuidanceReason(code,(z,_e)=>z),en=feedback.nativeGroundGuidanceReason(code,(_z,e)=>e);
    assert.match(zh,/[\u4e00-\u9fff]/);assert.notEqual(zh,code);assert.match(en,/[A-Za-z]/);assert.notEqual(en,code);
  }
  assert.equal(feedback.nativeGroundGuidanceReason('unknown_internal_key',(z,_e)=>z),'服务器未确认发射条件，请重新捕获目标');
});
test('projection and repeated Space display readable point denial while keeping the raw native code for diagnostics',()=>{
  const f=fixture();f.unit.seeker={...f.unit.seeker,status:'prep',reason:'point_blocked'};f.api.accept(f.air,f.unit);
  assert.equal(f.air.ctl.seeker.nativeReason,'point_blocked');assert.match(f.air.ctl.seeker.why,/blocked/i);
  f.api.action(f.air,f.unit,'space',1);assert.match(f.reasons.at(-1),/blocked/i);assert.notEqual(f.reasons.at(-1),'point_blocked');
});
test('actual seeker error feedback translates authoritative point refusal while preserving its raw message and inventory',()=>{
  const source=feedback.patchAgmLaunchFeedback(app),a=source.indexOf("        if(m.op==='error'){"),b=source.indexOf("        if(m.op==='rooms'){",a);assert.ok(a>=0&&b>a);
  const shown=[],rejected=[],stock={count:2},f={establishedFlight:{rejectSeekerControl:x=>rejected.push(x)},seq:8};
  const c=vm.createContext({f,G4:{mode:'battle',air:{nativeAuthority:true,stock}},L10N:(z,_e)=>z,note:x=>shown.push(x),hud:{toast(){throw Error('No local release feedback');}}});
  vm.runInContext(feedback.nativeGroundGuidanceReason.toString()+'function receiveError(m){'+source.slice(a,b)+'}',c);
  const message={op:'error',code:'seeker_control_rejected',message:'point_blocked'};c.receiveError(message);
  assert.match(shown.at(-1),/遮挡/);assert.deepEqual(rejected,['point_blocked']);assert.equal(message.message,'point_blocked');assert.equal(stock.count,2);assert.equal(f.seq,8);
});
test('ground-point patch APIs update only their owned functions/hooks, stay idempotent, and reject unknown old readiness helpers',()=>{
  const staged=feedback.patchAgmLaunchFeedback(feedback.patchNativeGroundPointControl(app,helper));
  assert.equal(feedback.patchAgmLaunchFeedback(staged),staged);assert.equal(feedback.patchNativeGroundPointControl(staged,helper),staged);
  new vm.Script(staged.slice(staged.indexOf('>')+1,staged.lastIndexOf('</script>')));
  if(!app.includes('function nativeGroundGuidanceReason('))assert.throws(()=>feedback.patchAgmLaunchFeedback(app.replace('waiting for the accepted weapon selection','unreviewed readiness change')),/hash|review/);
  for(const token of ['// TF_NATIVE_CM_BEGIN','// TF_CM_ELIGIBLE_PAIR','TF_AIR_VORTEX_PRESENTATION','var TF_APHE_SURFACE_CORE = '])assert.equal(staged.split(token).length,app.split(token).length,token+' preserved');
});

