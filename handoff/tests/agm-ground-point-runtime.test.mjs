// Exercise the actual shipped controller, native runtime heartbeat, and original
// capture functions together. Rendering/raycast boundaries use a finite fixture;
// native terrain resolution, admission and ammunition have separate Rust tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const app=fs.readFileSync(process.env.TF_AGM_APP||new URL('../bundle/app.js.html',import.meta.url),'utf8');
const defs=JSON.parse(fs.readFileSync(new URL('../../data/aircraft/frontline.json',import.meta.url))).storeDefinitions;
const plain=v=>JSON.parse(JSON.stringify(v));
function extract(name){
  const marker='function '+name+'(',a=app.indexOf(marker);
  assert.ok(a>=0,'Actual bundled function required: '+name);
  let parens=0,closing=-1;
  for(let i=app.indexOf('(',a);i<app.length;i++){
    if(app[i]==='(')parens++;
    if(app[i]===')'&&!--parens){closing=i;break;}
  }
  const start=app.indexOf('{',closing);
  let depth=0,quote=null,escape=false,line=false,block=false;
  for(let i=start;i<app.length;i++){
    const c=app[i],n=app[i+1];
    if(line){if(c==='\n')line=false;continue;}
    if(block){if(c==='*'&&n==='/'){block=false;i++;}continue;}
    if(quote){if(escape)escape=false;else if(c==='\\')escape=true;else if(c===quote)quote=null;continue;}
    if(c==='/'&&n==='/'){line=true;i++;continue;}
    if(c==='/'&&n==='*'){block=true;i++;continue;}
    if(c==='"'||c==="'"||c==='`'){quote=c;continue;}
    if(c==='{')depth++;
    if(c==='}'&&!--depth)return app.slice(a,i+1);
  }
  throw Error('Unclosed '+name);
}
function fixture(id='agm65b',{pod=false}={}){
  const sent=[],d=defs[id],point=[0,0,4000],forbidden=()=>{throw Error('Local combat/inventory mutation forbidden');};
  const unit={unit:{battle:1,unit:71,life:1},aircraft:'a10a',alive:true,team:'blue',pos:[0,900,0],guns:[],stores:[],fuel:null,
    seeker:{enabled:true,status:'search',target:null,reason:null,progress_s:0,point:null},
    weapon_control:{store_id:id,store_index:null,program:'single',gun_mode:'all'}};
  const item={id,def:d,count:2,gone:false,p:[0,0,0]},stores={items:[item],groups:[id],sel:0,program:{}};
  const plane={type:{id:'a10a',name:'A-10A'},position:[0,900,0],cur:new Float32Array(80),damage:{pilotDead:false},
    worldPoint:p=>p.map((v,i)=>v+plane.position[i]),
    pilotIntent:()=>({aim:[0,0,1],throttle:.5,manual_pitch:0,manual_roll:0,manual_yaw:0,flags:1})};
  const model={plane,stores,hudProjection:{guns:[],stores,fuel:null},localPose:()=>null};
  const G4={mode:'battle',time:10,online:{},air:null},f={epoch:4,seq:0,lastTick:1,room:{battle:1,team_score:[0,0]},map:{},aircrafts:[unit],units:[],airModels:new Map()};
  const document={body:{dataset:{}},getElementById:()=>null,createElement:()=>({style:{}})};
  const c=vm.createContext({G4,f,console,Math,performance:{now:()=>1},document,airHud:{appendChild(){}},airHudInventory:{},
    AIR_STORE_DEFS:defs,AIR_WEAPON_KINDS:new Set(['aam','agm','bomb','rocket','pod']),data:{vehicles:{}},
    D2R:Math.PI/180,WEAPON_STATUS:{},L10N:(zh,en)=>zh,
    airCtl:a=>a.ctl,aircraftGuns:()=>[],frontlineAircraftHud(){},cancelPilotInput(){},syncAircraftTouchControls(){},
    stepPlayerAircraftPilot(){G4.air.nativeIntent=plane.pilotIntent();},
    stepAirSystems(a){a.ctl??={nextLaunch:0,eq:{},seeker:{state:'search',dir:[0,-.2,1]},selected:null,radar:null,
      sensor:pod?'pod':'seeker',pod:pod?{cfg:{laser:true,range:10000,gate:3},mount:[0,0,0],dir:[0,-.2,1],state:'free'}:null};},
    airAudio(){},airEffects(){},airViewCamera(){},updateAirHud(){},
    storeGroup:s=>({id:s.groups[s.sel],def:s.items.find(it=>it.id===s.groups[s.sel])?.def,items:s.items.filter(it=>it.id===s.groups[s.sel]&&!it.gone)}),
    releaseProgram:()=>({id:'single'}),airReason:()=>false,seekerActivate:a=>{a.ctl.seeker.state='prep';},
    airPod:a=>a.ctl.pod,airCancel:a=>{a.ctl.pod&&(a.ctl.pod.state='free');a.ctl.seeker.point=null;},noseOf:()=>[0,0,1],
    daylight:()=>true,seekerOf:d=>d.seeker||{},imagingSeeker:d=>['tv','iir'].includes(d.guidance),
    sub:(a,b)=>a.map((v,i)=>v-b[i]),angleOf:()=>0,seekerCandidate:()=>({t:null}),vehicleInGate:()=>null,
    groundAlong:()=>point.slice(),airLos:()=>true,
    dropAirPreview(){},removeAircraft:forbidden,setMode:m=>{G4.mode=m;},renderer:{setMap(){},zones:[]},hud:{toast(){}},
    frontlineRoundPresentation:()=>({text:'battle'}),frontlineAirServiceReason:v=>v,storeImpact:()=>null,
    launchGuided:forbidden,releaseStore:forbidden,airInputOpen:()=>true,
  });
  const names=['createFrontlineCountermeasureControl','createEstablishedAircraftBridge','createFrontlineGuidedControl',
    'podTrackRequest','seekerCaptureRequest','nativeAgmLaunchCheck','launchCheck','createFrontlineExistingRuntime'];
  if(app.includes('function nativeGroundGuidanceReason('))names.unshift('nativeGroundGuidanceReason');
  vm.runInContext(names.map(extract).join('\n'),c);
  const runtime=c.createFrontlineExistingRuntime({f,mine:()=>({team:'blue'}),controlled:()=>unit,controlledAirModel:()=>model,
    send:m=>sent.push(plain(m)),height:()=>0,note(){},shared:{}});
  runtime.step(1/60);
  return {runtime,c,G4,f,sent,unit,item,stores,plane,point};
}

for(const id of ['agm65b','agm65d','agm65g'])test(`${id}: original ground capture survives projection and reaches the actual native heartbeat`,()=>{
  const x=fixture(id);assert.equal(x.runtime.action('space',1),true);
  // Original display still receives pending server snapshots before acceptance.
  x.runtime.step(1/60);x.runtime.transmit();
  const control=x.sent.find(m=>m.op==='air_seeker_control');
  assert.ok(control.sight,'Captured ground direction must cross the actual wire seam');
  assert.equal(control.target,null);assert.ok(Math.abs(Math.hypot(...control.sight)-1)<1e-9);
  assert.ok(!('point'in control)&&!('pos'in control),'Client sends direction only');
  assert.equal(control.epoch,4);assert.deepEqual(control.unit,x.unit.unit);
  assert.equal(x.item.count,2);assert.equal(x.item.gone,false);
  const immutable=plain(control.sight);x.plane.position[0]+=120;x.runtime.step(1/60);x.runtime.transmit();
  assert.equal(x.sent.filter(m=>m.op==='air_seeker_control').length,1,'Moving aircraft must not recapture/reset its ground lock every heartbeat');
  assert.deepEqual(control.sight,immutable);
  x.unit.seeker={...x.unit.seeker,status:'track',point:x.point,reason:null,progress_s:2.3,accepted_capture_seq:control.seq};
  x.runtime.step(1/60);assert.deepEqual(plain(x.G4.air.ctl.seeker.point),x.point);
  assert.deepEqual(plain(x.G4.air.ctl.seeker.est.p),x.point);
  assert.equal(x.c.launchCheck(x.G4.air).ok,true);
  assert.equal(x.runtime.action('fire',2),true);x.runtime.transmit();
  assert.equal(x.sent.filter(m=>m.op==='air_input').at(-1).release,true);
  assert.equal(x.item.count,2,'Only native acceptance may spend the store');
});

test('laser ground-point capture goes through original pod controls and native release readiness',()=>{
  const x=fixture('kh25ml',{pod:true});assert.equal(x.runtime.action('space',1),true);
  x.runtime.step(1/60);x.runtime.transmit();const control=x.sent.find(m=>m.op==='air_seeker_control');
  assert.ok(control.sight);assert.equal(control.target,null);assert.equal(control.laser,true);
  x.unit.seeker={...x.unit.seeker,status:'track',point:x.point,laser:true,accepted_capture_seq:control.seq};x.runtime.step(1/60);
  assert.equal(x.c.launchCheck(x.G4.air).ok,true);
  x.runtime.action('fire',2);x.runtime.transmit();assert.equal(x.sent.filter(m=>m.op==='air_input').at(-1).release,true);
});

test('accepted guided bomb and unguided native stores do not inherit the obsolete online refusal',()=>{
  for(const id of ['gbu10','gbu12','mk82','s24b','lau68']){
    const x=fixture(id,{pod:!!defs[id].guidance});
    x.unit.seeker={...x.unit.seeker,status:'track',point:x.point};x.runtime.step(1/60);
    const result=x.c.launchCheck(x.G4.air);
    assert.equal(result.ok,true,id+': '+result.reason);
  }
});

test('native capture rejection stays denied through heartbeats and explicit same-direction Space retries with a fresh sequence',()=>{
  const x=fixture('agm65b');assert.equal(x.runtime.action('space',1),true);x.runtime.step(1/60);x.runtime.transmit();
  const first=x.sent.find(m=>m.op==='air_seeker_control'&&m.sight);assert.ok(first);
  // A stale old snapshot must not resurrect a prior point/track after refusal.
  x.unit.seeker={...x.unit.seeker,status:'track',point:[20,0,3000],accepted_capture_seq:0};
  x.runtime.rejectSeekerControl('point_blocked');
  for(let i=0;i<4;i++){x.runtime.step(1/60);x.runtime.transmit();assert.equal(x.c.launchCheck(x.G4.air).ok,false);}
  assert.equal(x.sent.filter(m=>m.op==='air_seeker_control'&&m.sight).length,1,'Rejected sight must not retry automatically');
  assert.equal(x.G4.air.ctl.seeker.nativeReason,'point_blocked');assert.equal(x.item.count,2);
  assert.equal(x.runtime.action('space',2),true);x.runtime.step(1/60);x.runtime.transmit();
  const requests=x.sent.filter(m=>m.op==='air_seeker_control'&&m.sight);assert.equal(requests.length,2);assert.ok(requests[1].seq>first.seq);assert.deepEqual(requests[1].sight,first.sight);
  assert.equal(x.c.launchCheck(x.G4.air).ok,false,'Explicit retry still waits for its own native ACK');
  x.unit.seeker={...x.unit.seeker,status:'track',point:x.point,reason:null,accepted_capture_seq:requests[1].seq};x.runtime.step(1/60);
  assert.equal(x.c.launchCheck(x.G4.air).ok,true);x.runtime.action('fire',3);x.runtime.transmit();assert.equal(x.sent.filter(m=>m.op==='air_input').at(-1).release,true);assert.equal(x.item.count,2);
});

test('pre-ACK native fire is discarded and acceptance cannot automatically release a previously pressed tap',()=>{
  const x=fixture('agm65b');assert.equal(x.runtime.action('fire',0),true);assert.equal(x.G4.air.storeTap,true);
  assert.equal(x.runtime.action('space',1),true);assert.equal(x.G4.air.storeTap,false,'Explicit new capture discards any older unsent tap');
  assert.equal(x.runtime.action('fire',2),false,'A new unconfirmed capture cannot reuse prior readiness');x.runtime.step(1/60);x.runtime.transmit();
  const capture=x.sent.find(m=>m.op==='air_seeker_control'&&m.sight);assert.ok(capture);assert.equal(x.sent.filter(m=>m.op==='air_input').at(-1).release,false);
  x.unit.seeker={...x.unit.seeker,status:'track',point:x.point,reason:null,accepted_capture_seq:capture.seq};x.runtime.step(1/60);x.runtime.transmit();
  assert.equal(x.sent.filter(m=>m.op==='air_input').at(-1).release,false,'ACK must not replay a pre-ACK press');
  x.runtime.action('fire',3);x.runtime.transmit();assert.equal(x.sent.filter(m=>m.op==='air_input').at(-1).release,true);assert.equal(x.item.count,2);
});

test('a new original pod capture cannot reuse the preceding accepted point readiness before its own acknowledgment',()=>{
  const x=fixture('kh25ml',{pod:true});
  x.unit.seeker={...x.unit.seeker,status:'track',point:[0,0,3500],laser:true,accepted_capture_seq:0};
  x.runtime.step(1/60);
  // Existing P/free-view operation followed by the original Space capture.
  x.G4.air.ctl.pod.state='free';x.G4.air.ctl.pod.point=null;
  assert.equal(x.runtime.action('space',7),true);
  assert.equal(x.c.launchCheck(x.G4.air).ok,false,'A changed local capture is not the previous accepted track');
  x.runtime.transmit();const request=x.sent.find(m=>m.op==='air_seeker_control');assert.ok(request.sight);
  x.runtime.step(1/60);assert.equal(x.c.launchCheck(x.G4.air).ok,false,'A stale point snapshot cannot acknowledge the new capture');
  x.unit.seeker={...x.unit.seeker,point:x.point,accepted_capture_seq:request.seq};x.runtime.step(1/60);
  assert.equal(x.c.launchCheck(x.G4.air).ok,true);
});
