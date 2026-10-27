import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
const patchFile=new URL('../tools/frontline_countermeasures_patch.mjs',import.meta.url);
const {patchFrontlineCountermeasures}=fs.existsSync(patchFile)?await import(patchFile):{patchFrontlineCountermeasures:s=>s};
const original=fs.readFileSync(process.env.TG_R8_APP||new URL('../bundle/app.js.html',import.meta.url),'utf8');
const app=patchFrontlineCountermeasures(original);
const cut=(a,b)=>{const i=app.indexOf(a),j=app.indexOf(b,i);assert.ok(i>=0&&j>i,a);return app.slice(i,j);};
function releaseFixture(native=false){
  const sent=[],local=[],actions=[],air={nativeAuthority:native,active:true,plane:{position:[0,500,0],crashed:false},cm:{flares:30,chaff:60,max:{flares:30,chaff:60}},ctl:{seq:0,cm:{program:'both',readyAt:0}}};
  const context=vm.createContext({console,Math,G4:{time:10,frontline:{handleAircraftAction:x=>{actions.push(x);return true;}}},
    airCtl:a=>a.ctl,airTone(){},airReason:()=>false,L10N:(_z,e)=>e,CM_NAME:{both:()=> 'mixed'},releaseDecoys:(_p,_o,k)=>local.push(k),sound:{full:null},net:{send:x=>sent.push(x)}});
  vm.runInContext(cut('    function cmRelease(air) {','    function cmPeriodicToggle(air)'),context);
  return {release:context.cmRelease,air,sent,local,actions};
}
test('actual native cmRelease diverts to authoritative intent before any local stock/lure/sound path',()=>{
  const t=releaseFixture(true);assert.equal(t.release(t.air),true);assert.deepEqual(t.actions,['cm']);assert.deepEqual(t.local,[]);assert.deepEqual(t.sent,[]);
  assert.equal(t.air.cm.flares,30);assert.equal(t.air.cm.chaff,60);
});
test('actual legacy cmRelease retains paired local release, stock consumption and interval refusal',()=>{
  const t=releaseFixture(false);assert.equal(t.release(t.air),true);assert.deepEqual(t.local,['flares','chaff']);assert.equal(t.air.cm.flares,28);assert.equal(t.air.cm.chaff,58);
  assert.equal(t.air.ctl.cmDiag.events,1);assert.equal(t.air.ctl.cmDiag.requests,2);assert.equal(t.release(t.air),false);assert.equal(t.air.cm.flares,28);
});
function seduceFixture(){
  let visible=true,draws=0,observedHalf=null;
  const f={owner:'player',lead:true,t:.1,pos:[200,0,100],vel:[0,0,0]},target={player:true,pos:[0,0,100],irMissiles:1};
  const missile={guide:{phase:'ir',target},def:{flareResist:0},pos:[0,0,0],vel:[0,0,300],owner:'player'};
  const sub=(a,b)=>a.map((v,i)=>v-b[i]),angleOf=(a,b)=>Math.acos(Math.max(-1,Math.min(1,a.reduce((s,v,i)=>s+v*b[i],0)/(Math.hypot(...a)*Math.hypot(...b)||1))));
  const context=vm.createContext({console,Math:Object.assign(Object.create(Math),{random:()=>{draws++;return 1;}}),Set,sub,angleOf,D2R:Math.PI/180,
    decoyOwner:()=> 'player',airTargetPos:t=>t.pos,airBots:{flares:[f],chaff:[]},AIR_RADARS:{},G4:{},missileSees:(_o,_t,half)=>{observedHalf=half;return visible?{p:f.pos,v:f.vel}:null;}});
  vm.runInContext(cut('    function decoysSeduce(o, half) {','    /** One step of a missile\'s own guidance'),context);
  return {f,missile,run:()=>context.decoysSeduce(missile,.05),draws:()=>draws,observedHalf:()=>observedHalf,setVisible:v=>{visible=v;}};
}
test('actual local decoy eligibility defers tested mark until angle and seeker visibility succeed',()=>{
  const t=seduceFixture();assert.equal(t.run(),false);assert.equal(t.f.tested?.has(t.missile)||false,false);assert.equal(t.draws(),0);
  t.f.pos=[0,0,100];t.setVisible(false);assert.equal(t.run(),false);assert.equal(t.f.tested?.has(t.missile)||false,false);assert.equal(t.draws(),0);
  t.setVisible(true);assert.equal(t.run(),false);assert.equal(t.f.tested.has(t.missile),true);assert.equal(t.draws(),1);assert.equal(t.observedHalf(),.05,'Keep the real seeker FOV separate from decoy-to-target angular proximity');
  for(let i=0;i<60;i++)t.run();assert.equal(t.draws(),1,'An eligible pair gets one chance, not one every rendered frame');
});
test('patch is idempotent and embeds accepted graphics, shared control sequence and lifecycle hooks',()=>{
  assert.ok(app.includes('// TF_NATIVE_CM_BEGIN'));assert.equal(patchFrontlineCountermeasures(app),app);
  for(const needle of ['nextSequence:()=>++f.seq','nativeCM.accept(air,unit','TFNativeCMVisual.accept(f.aircrafts',"TFNativeCMVisual.write(this.add,this.addCount,cam,TFNativeCMVisual.context(),'flares')",'nativeCM.clear();TFNativeCMVisual.clear()'])assert.ok(app.includes(needle),needle);
  if(original.includes('function frontlineCountermeasureReason('))assert.equal(app,original);else assert.notEqual(app,original);
});
test('patch rejects a recomposition that removed its runtime hook instead of silently claiming installation',()=>{
  const detached=app.replace('nativeCM.accept(air,unit','detachedCM.accept(air,unit');
  assert.throws(()=>patchFrontlineCountermeasures(detached),/hook|composition|integration/i);
});
test('actual established native runtime projects accepted stock and sends CM through its shared control owner',()=>{
  const sent=[],sounds=[],identity={battle:7,unit:4,life:2},unit={unit:identity,aircraft:'f16v',alive:true,
    countermeasures:{flares:30,chaff:60,max:{flares:30,chaff:60},release_seq:0,cooldown_remaining_s:0}};
  const air={nativeAuthority:true,active:true,ctl:{cm:{program:'both',periodic:false}},plane:{type:{id:'f16v',name:'F-16V'},position:[0,500,0]}},model={plane:air.plane};
  const f={epoch:3,seq:10,lastTick:8,room:{battle:7},aircrafts:[unit]},G4={air,time:20,mode:'battle'};
  const context=vm.createContext({console,Math,performance:{now:()=>1000},G4,Float64Array,Map,Set,
    document:{getElementById:()=>null,createElement:()=>({style:{}})},airHud:{appendChild(){}},hud:{el:{}},renderer:{setMap(){},zones:[]},dropAirPreview(){},setMode(){},
    airCtl:a=>a.ctl,airReason:()=>false,frontlineRoundPresentation:()=>({text:'battle'}),sound:{full:{play:(cue,event)=>{sounds.push({cue,event});return true;}}},
    createEstablishedAircraftBridge:()=>({bind:()=>air,getair:()=>air,unbind(){},intent:()=>({}),step(){}})});
  vm.runInContext(cut('  // TF_NATIVE_CM_BEGIN','  // TF_NATIVE_CM_END')+cut('function createFrontlineExistingRuntime(','// Visual submissions only.'),context);
  const runtime=context.createFrontlineExistingRuntime({f,mine:()=>null,controlled:()=>unit,controlledAirModel:()=>model,send:x=>sent.push(JSON.parse(JSON.stringify(x))),height:()=>0,note(){},shared:{}});
  runtime.sync();assert.equal(air.cm.flares,30);assert.equal(runtime.action('cm'),true);assert.equal(sent.length,1);assert.equal(sent[0].seq,11);assert.equal(sent[0].op,'air_countermeasure');assert.equal(air.cm.flares,30);assert.equal(sounds.length,0);
  f.lastTick=9;unit.countermeasures={...unit.countermeasures,flares:28,chaff:58,release_seq:1};runtime.sync();assert.equal(air.cm.flares,28);assert.equal(sounds.length,2);assert.match(sounds[0].event.emitterId,/7:4:2:1:flares$/);
  runtime.sync();assert.equal(sounds.length,2);runtime.release();assert.equal(air.cm.flares,0);assert.equal(air.ctl.cm.periodic,false);
});
test('actual receive-frame composition admits only filtered aircraft decoys to the visual pool',()=>{
  const identity={battle:7,unit:4,life:2},known={unit:identity,decoys:[{id:1,kind:'flares',pos:[1,2,3],velocity:[0,0,0],age:0,ttl:4}]};
  const f={room:{battle:7},lastTick:0,ordnancePresentation:{accept(){}},contactPresentation:{accept:()=>({units:[],aircrafts:[known],contacts:[]})}};
  const context=vm.createContext({console,Math,G4:{time:20},f,mine:()=>({observer:false})});
  const start=app.indexOf("        if(m.op==='snapshot'||m.op==='frame'){");assert.ok(start>=0);
  const end=app.indexOf('          f.companies=m.companies;',start);assert.ok(end>start);
  vm.runInContext(cut('  // TF_NATIVE_CM_BEGIN','  // TF_NATIVE_CM_END')+'function acceptFrame(m){'+app.slice(start,end)+'}}',context);
  context.acceptFrame({op:'frame',battle:7,tick:1,intel:{},units:[],aircrafts:[known,{unit:{battle:7,unit:99,life:1},decoys:[{...known.decoys[0],id:2}]}]});
  assert.equal(context.TFNativeCMVisual.stats.live,1);assert.equal(context.TFNativeCMVisual.slots.find(s=>s.key)?.key,'7:4:2:1');
});
test('actual hostile PublicAirPose conversion carries visible decoys without stock and retires them on lost observation',()=>{
  const identity={battle:7,unit:99,life:1},d={id:1,kind:'flares',pos:[1,2,3],velocity:[0,0,0],age:0,ttl:4};
  const pose={unit:identity,team:'red',aircraft:'mig29',alive:true,pos:[1,2,3],quaternion:[0,0,0,1],gear_axes:[0,0,0,0],detached_parts:[],stores:[],decoys:[d],countermeasures:{flares:999,chaff:999}};
  for(const key of ['speed','ground_speed','agl','sample_time','pitch_surface','roll_surface','yaw_surface','gear','flap','airbrake','slat'])pose[key]=0;
  const contact={unit:identity,team:'red',kind:'air',pos:pose.pos,observed_alive:true,last_seen_tick:1,last_seen_at:0,status:'detected'};
  const frame={battle:7,units:[],aircrafts:[],intel:{team:'blue',contacts:[contact],visible_ground:[],visible_aircrafts:[pose]}};
  const context=vm.createContext({console,Math});
  vm.runInContext(cut('  // TF_NATIVE_CM_BEGIN','  // TF_NATIVE_CM_END')+cut('function createFrontlineContactPresentation(){','// Build only the externally observable'),context);
  const filter=context.createFrontlineContactPresentation(),visible=filter.accept(frame),enemy=visible.aircrafts[0];
  assert.equal(enemy.countermeasures,undefined);assert.ok(Array.isArray(enemy.decoys),'Visible public aircraft must retain accepted decoys');assert.deepEqual(JSON.parse(JSON.stringify(enemy.decoys)),[d]);
  context.TFNativeCMVisual.accept(visible.aircrafts,{battle:7,tick:1,time:20});assert.equal(context.TFNativeCMVisual.stats.live,1);
  contact.status='last_known';frame.intel.visible_aircrafts=[];const lost=filter.accept(frame);
  context.TFNativeCMVisual.accept(lost.aircrafts,{battle:7,tick:2,time:20.05});assert.equal(context.TFNativeCMVisual.stats.live,0);
});
test('actual Effects.build writes accepted flare/chaff graphics into existing bounded GPU buffers',()=>{
  const G4={mode:'battle',time:20},context=vm.createContext({console,Math,G4,FLOATS:9,SOFT_FLOATS:13,Float32Array,Float64Array,
    TFAirVortex:{write:(_b,n)=>n,context:()=>G4}});
  vm.runInContext(cut('  // TF_NATIVE_CM_BEGIN','  // TF_NATIVE_CM_END')+cut('  var Effects = class {','  // client/web/src/game/audioReload.js'),context);
  context.TFNativeCMVisual.context=()=>G4;
  const d={id:1,kind:'flares',pos:[1,2,3],velocity:[0,0,0],age:0,ttl:4};
  context.TFNativeCMVisual.accept([{unit:{battle:7,unit:4,life:2},decoys:[d,{...d,id:2,kind:'chaff'}]}],{battle:7,tick:1,time:20});
  const effects=new context.Effects(4),cam={pos:[0,0,0],right:[1,0,0],up:[0,1,0]};effects.build(cam);
  assert.equal(effects.addCount,6);assert.equal(effects.alphaCount,6);assert.equal(effects.particles.length,0);assert.equal(effects.glows.length,0);
  assert.ok(effects.add.subarray(0,54).every(Number.isFinite));G4.mode='garage';effects.build(cam);assert.equal(effects.addCount,0);assert.equal(effects.alphaCount,0);
});
test('native CM denial reasons are readable in both languages and unknown codes use a plain safe fallback',()=>{
  const context=vm.createContext({});vm.runInContext(cut('  // TF_NATIVE_CM_BEGIN','  // TF_NATIVE_CM_END'),context);
  assert.equal(typeof context.frontlineCountermeasureReason,'function','Authoritative rejection reasons require a presentation translator');
  for(const code of ['countermeasures_empty','countermeasure_dispenser_cycling','countermeasures_not_fitted','aircraft_not_controlled','aircraft_servicing','unknown_aircraft','invalid_countermeasure_kind','countermeasure_serial_exhausted']){
    const zh=context.frontlineCountermeasureReason(code,'zh'),en=context.frontlineCountermeasureReason(code,'en');
    assert.match(zh,/[\u4e00-\u9fff]/);assert.match(en,/[A-Za-z]/);assert.ok(!zh.includes(code)&&!en.includes(code),code);assert.notEqual(zh,en);
  }
  assert.match(context.frontlineCountermeasureReason('countermeasure_dispenser_cycling','en'),/cycling/i);
  assert.equal(context.frontlineCountermeasureReason('unknown_code\n<script>','zh'),'反制投放未获确认，请稍后重试');
  assert.equal(context.frontlineCountermeasureReason(null,'en'),'Countermeasure release was not confirmed. Please try again shortly.');
});
test('actual authoritative error hook translates cooldown and race denials without stock, lure, sound or control fallback',()=>{
  const stock={flares:28,chaff:58,max:{flares:30,chaff:60}},air={nativeAuthority:true,cm:stock},f={seq:11,airDeploymentPending:false,establishedFlight:{rejectWeaponControl(){},rejectSeekerControl(){}}};
  const shown=[],forbidden=()=>{throw Error('A denial must not trigger local authority or cosmetic release');};
  const context=vm.createContext({LANG:'en',f,G4:{air,mode:'battle',frontline:{handleAircraftAction:forbidden}},note:x=>shown.push(x),hud:{toast:forbidden},releaseDecoys:forbidden,cmRelease:forbidden,sound:{full:{play:forbidden}},net:{send:forbidden}});
  vm.runInContext(cut('  // TF_NATIVE_CM_BEGIN','  // TF_NATIVE_CM_END')+'function acceptError(m){'+cut("        if(m.op==='error'){","        if(m.op==='rooms'){")+'}',context);
  const before=JSON.stringify(stock);
  context.acceptError({op:'error',code:'countermeasure_rejected',message:'countermeasure_dispenser_cycling'});assert.match(shown.at(-1),/cycling/i);
  context.LANG='zh';context.acceptError({op:'error',code:'countermeasure_rejected',message:'countermeasures_empty'});assert.match(shown.at(-1),/已用完/);
  context.acceptError({op:'error',code:'countermeasure_rejected',message:'unexpected_raw_token'});assert.equal(shown.at(-1),'反制投放未获确认，请稍后重试');
  context.acceptError({op:'error',code:'unrelated_error',message:'Existing unrelated feedback'});assert.equal(shown.at(-1),'Existing unrelated feedback');
  assert.equal(JSON.stringify(stock),before);assert.equal(f.seq,11);assert.equal(air.cm,stock);
});
test('CM UI upgrade preserves the complete previous authority helper bytes and upgrades only its pinned owned block plus feedback hook',()=>{
  const helper=fs.readFileSync(new URL('../tools/frontline_countermeasures.js',import.meta.url),'utf8').replace(/\r\n/g,'\n'),marker='\n// TF_NATIVE_CM_REASONS_V2';
  const added=helper.indexOf(marker);assert.ok(added>0,'Reason-map upgrade must be a declared append to the reviewed authority helper');
  const prior=helper.slice(0,added),sha=x=>createHash('sha256').update(x).digest('hex');
  assert.equal(sha(prior),'032acd38e647fcc492fc1885e82f3f61f033dfa3c313498525f6a0683cd89fbb','Original authority/visual implementation is byte-identical');
  const begin='  // TF_NATIVE_CM_BEGIN\n',end='  // TF_NATIVE_CM_END\n',a=app.indexOf(begin),b=app.indexOf(end,a)+end.length;
  const previous=begin+prior+'\n  var TFNativeCMVisual=Object.assign(createFrontlineCountermeasureVisual(),{context:()=>null});\n'+end;
  assert.equal(sha(previous),'127eebfb755925b59da905040072b41576ef472d6192d9c832c163f91adfb74c');
  const extra="m.code==='countermeasure_rejected'?frontlineCountermeasureReason(m.message,typeof LANG==='string'?LANG:'zh'):";
  const legacy=(app.slice(0,a)+previous+app.slice(b)).replace(extra,'');
  assert.equal(patchFrontlineCountermeasures(legacy),app,'Exact previous block migrates to the current app without unrelated edits');
  assert.throws(()=>patchFrontlineCountermeasures(legacy.replace('scoped intent and projects accepted state','unknown prior block change')),/helper|block|hash|preserve/i);
  assert.throws(()=>patchFrontlineCountermeasures(legacy.replace('nativeCM.accept(air,unit','detachedCM.accept(air,unit')),/hook|composition|integration/i);
});
