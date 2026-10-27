import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {patchFrontlineGuidedSourceHooks} from '../tools/sync_frontline_guided.mjs';
import {composeFrontlineGuidedCandidate} from '../tools/stage_frontline_guided_candidate.mjs';
const read=name=>fs.readFileSync(new URL('../tools/'+name,import.meta.url),'utf8'),app=fs.readFileSync(new URL('../bundle/app.js.html',import.meta.url),'utf8');
const section=(source,a,b)=>{const i=source.indexOf(a),j=source.indexOf(b,i);assert.ok(i>=0&&j>i,a);return source.slice(i,j);};
const plain=v=>JSON.parse(JSON.stringify(v));
function fixture(){
  const sent=[],forbidden=()=>{throw Error('Local solver/resource mutation forbidden');},unit={unit:{battle:1,unit:7,life:1},aircraft:'test',alive:true,team:'blue',pos:[0,500,0],guns:[],fuel:null,stores:[],seeker:{enabled:false,radar:false,status:'off',target:null,progress_s:0,reason:null},weapon_control:null};
  const def={kind:'aam',guidance:'sarh'},stores={items:[{id:'test',def,count:2,gone:false}],groups:['test'],sel:0,program:{}},model={plane:{type:{id:'test',name:'test'},pilotIntent:()=>({aim:[0,0,1],throttle:.5,manual_pitch:0,manual_roll:0,manual_yaw:0,flags:1}),cur:new Float32Array(80)},stores,hudProjection:{guns:[],stores,fuel:null},localPose:seq=>({unit:unit.unit,epoch:4,seq,pose:{sample_time_s:1}})};
  const enemy={unit:{battle:1,unit:9,life:1},aircraft:'enemy',alive:true,team:'red',pos:[0,500,100]},enemyModel={plane:{type:{name:'enemy'}}};
  const G4={mode:'battle',air:null,time:1},f={epoch:4,seq:0,room:{battle:1,team_score:[0,0]},map:{},aircrafts:[unit,enemy],units:[],airModels:new Map([['1:9:1',enemyModel]])};
  const document={body:{dataset:{}},getElementById:()=>null,createElement:()=>({style:{},appendChild(){}})},c=vm.createContext({G4,f,document,performance:{now:()=>1},airHud:{appendChild(){}},airHudInventory:{},AIR_STORE_DEFS:{test:def},AIR_WEAPON_KINDS:new Set(['aam','agm','bomb']),data:{vehicles:{}},
    frontlineAircraftHud(){},aircraftGuns:()=>[],cancelPilotInput(){},syncAircraftTouchControls(){},stepPlayerAircraftPilot(air){G4.air.nativeIntent=model.plane.pilotIntent();},stepAirSystems(air){air.ctl??={eq:{},seeker:{state:'off'},radar:{on:true,stt:null},selected:null};},airAudio(){},airEffects(){},airViewCamera(){},updateAirHud(){},storeGroup:()=>({id:'test',def,items:stores.items.filter(i=>!i.gone)}),releaseProgram:()=>({id:'single'}),
    airReason:()=>false,seekerActivate:air=>{air.ctl.seeker.state='prep';},airPod:air=>air.ctl.pod,podTrackRequest:()=>true,seekerCaptureRequest:()=>true,airCancel:air=>{air.ctl.seeker.target=null;},noseOf:()=>[0,0,1],dropAirPreview(){},removeAircraft:forbidden,setMode:m=>{G4.mode=m;},renderer:{setMap(){},zones:[]},hud:{toast(){}},frontlineRoundPresentation:()=>({text:'battle'}),frontlineAirServiceReason:v=>v,storeImpact:()=>null,
    launchGuided:forbidden,releaseStore:forbidden,airInputOpen:()=>true});
  vm.runInContext(read('frontline_existing_aircraft.js')+'\n'+read('frontline_guided_control.js')+'\n'+read('frontline_existing_runtime.js'),c);
  const runtime=c.createFrontlineExistingRuntime({f,mine:()=>({team:'blue'}),controlled:()=>unit,controlledAirModel:()=>model,send:m=>sent.push(plain(m)),height:()=>0,note(){},shared:{}});
  runtime.step(1/60);G4.frontline={handleAircraftAction:(name,stamp)=>runtime.action(name,stamp),radioSteer:runtime.radioSteer,groundTargets:runtime.groundTargets,sensorTargetAlive:runtime.targetAlive};
  vm.runInContext(section(patchFrontlineGuidedSourceHooks(app),'    function airAction(name, stamp) {','    /** The flight help'),c);
  return{runtime,G4,f,c,sent,unit,enemy,model,stores};
}
test('actual heartbeat sends changed seeker before air input/pose with one sequence domain, without polling status',()=>{
  const f=fixture();f.G4.air.ctl.selected=f.runtime.targets()[0];f.runtime.action('seekerPower');f.runtime.transmit();
  assert.deepEqual(f.sent.map(m=>m.op),['air_weapon_control','air_seeker_control','air_input','air_pose']);assert.deepEqual(f.sent.map(m=>m.seq),[1,2,3,4]);
  const seeker=f.sent[1];assert.deepEqual(seeker.target,f.enemy.unit);assert.equal(seeker.epoch,4);assert.deepEqual(Object.keys(seeker).sort(),['ecm','enabled','epoch','laser','manual','op','radar','seq','target','unit']);
  f.unit.seeker={...f.unit.seeker,status:'capturing',progress_s:.5};f.runtime.step(.01);f.runtime.transmit();assert.equal(f.sent.filter(m=>m.op==='air_seeker_control').length,1);
});
test('actual original native fire action reaches release intent without local solver or spending resources',()=>{
  const f=fixture();f.runtime.transmit();const {op,unit,epoch,seq,...choice}=f.sent.find(m=>m.op==='air_weapon_control');f.unit.weapon_control=choice;
  assert.equal(f.c.airAction('fire',12),true);f.runtime.transmit();assert.equal(f.sent.filter(m=>m.op==='air_input').at(-1).release,true);assert.equal(f.stores.items[0].count,2);assert.equal(f.stores.items[0].gone,false);
});
test('ground sensor wrappers expose only live admitted enemy lives and stale wrappers stop resolving',()=>{
  const f=fixture(),enemy={unit:{battle:1,unit:14,life:3},vehicle:'testTank',team:'red',alive:true,pos:[10,0,30],net:{v:[1,0,2]}};
  f.f.units=[enemy,{...enemy,unit:{...enemy.unit,unit:15},team:'blue'},{...enemy,unit:{...enemy.unit,unit:16},alive:false}];const views=f.runtime.groundTargets();assert.equal(views.length,1);assert.deepEqual(plain(views[0].airTarget.unitRef),enemy.unit);assert.deepEqual(plain(views[0].veh.body.origin()),enemy.pos);assert.equal(f.runtime.targetAlive(views[0].airTarget),true);f.f.units=[];assert.equal(f.runtime.targetAlive(views[0].airTarget),false);
});
test('source hooks compose idempotently and candidate full script is syntax-valid without app writes',()=>{
  const candidate=composeFrontlineGuidedCandidate(app);assert.equal(patchFrontlineGuidedSourceHooks(candidate),candidate);assert.equal(composeFrontlineGuidedCandidate(candidate),candidate);
  new vm.Script(candidate.slice(candidate.indexOf('<script>')+8,candidate.lastIndexOf('</script>')));
  for(const marker of ['TF_NATIVE_SEEKER_OFF','TF_NATIVE_RADIO_STEER','TF_NATIVE_TARGET_ALIVE','TF_NATIVE_POD_TARGETS','TF_NATIVE_CYCLE_TARGETS','createFrontlineOrdnanceVisual','air_seeker_control'])assert.ok(candidate.includes(marker),marker);
});
test('accepted native proximity world bursts feed FX positions and explosive strength directly',()=>{
  const c={};vm.runInNewContext(section(read('frontline_client.js'),'    function frontlineImpactPresentation(event){','    // Production client'),c);
  const burst={mechanism:'immediate_he',time_origin:'first_contact',time_s:0,world_position:[3,400,5],explosive_kg:8};const out=plain(c.frontlineImpactPresentation({kind:'missile_proximity',pos:[3,400,5],detail:{world_bursts:[burst]}}));assert.deepEqual(out.bursts,[{position:[3,400,5],strength:8,time_s:0}]);
});
