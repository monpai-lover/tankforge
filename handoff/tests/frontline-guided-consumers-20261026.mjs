import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {patchFrontlineGuidedSourceHooks} from '../tools/sync_frontline_guided.mjs';
const app=patchFrontlineGuidedSourceHooks(fs.readFileSync(new URL('../bundle/app.js.html',import.meta.url),'utf8'));
const helper=fs.readFileSync(new URL('../tools/frontline_guided_control.js',import.meta.url),'utf8');
function section(a,b){const i=app.indexOf(a),j=app.indexOf(b,i);assert.ok(i>=0&&j>i,a);return app.slice(i,j);}
const element=()=>({style:{},hidden:false,firstChild:{textContent:''},innerHTML:'',textContent:'',parentElement:{offsetTop:0,offsetHeight:0}});
function fixture(){
  const first={id:'first',name:'SARH',kind:'aam',guidance:'sarh'},second={id:'second',name:'IR',kind:'aam',guidance:'ir'},radio={id:'radio',name:'Radio',kind:'agm',guidance:'radio'};
  const target={unitRef:{battle:1,unit:9,life:1},bot:{plane:{}}},stores={items:[{id:'first',def:first,count:1,p:[0,0,0]},{id:'second',def:second,count:1,p:[0,0,0]},{id:'radio',def:radio,count:1,p:[0,0,0]}],groups:['first','second','radio'],sel:0};
  const host={unit:{battle:1,unit:7,life:1},weapon_control:{store_id:'first',store_index:null},seeker:{enabled:true,status:'track',target:target.unitRef,progress_s:1,reason:null}};
  const plane={position:[0,500,0],state:{camera:0},type:{id:'test',sound:'jet',airframe:Array(20).fill(0),gLimit:9},worldPoint:p=>p.map((v,i)=>v+(i===1?500:0)),hudState:()=>({aim:[0,0,1],nose:[0,0,1],heading:0,throttle:.5,ias:500,tas:520,alt:500,agl:500,vs:0,aoa:0,load:1,flapStage:'up'}),onGround:false,crashed:false};
  const air={active:true,nativeAuthority:true,stores,plane,ctl:{eq:{},view:'third',seeker:{def:first,state:'track',dir:[0,0,1],target},radar:{on:true,R:{},mode:'search',tracks:new Map(),stt:{target,state:'track'}},selected:target,cm:{periodic:false},acc:0,log:[]}};
  const forbidden=()=>{throw Error('Local guided solver/resources forbidden');},airEl=Object.fromEntries(['aim','nose','pipper','pipperText','lock','ccip','ccipText','panel','main','flags','dmg','store','sys'].map(k=>[k,element()]));airEl.tgts=[];
  const group=st=>{const id=st.groups[st.sel],items=st.items.filter(i=>i.id===id);return{id,def:items[0]?.def,items};};
  const context=vm.createContext({console,Math,performance:{now:()=>50000},G4:{air,time:1,airAssist:false,airHelp:false,airHudTick:0},canvas:{clientWidth:1280,style:{}},airEl,AIR_EQUIP:{test:{}},AIR_STORE_DEFS:{first,second,radio},airBots:{list:[],kills:0},airOrdnance:[],D2R:Math.PI/180,LANG:'en',
    airCtl:a=>a.ctl,storeGroup:group,airReason:()=>false,L10N:(_zh,en)=>en,noseOf:()=>[0,0,1],groundAlong:()=>[0,0,100],airPod:a=>a.ctl.pod,imagingSeeker:d=>d?.guidance==='tv'||d?.guidance==='iir',setAirView:(a,v)=>{a.ctl.view=v;a.ctl.sensor=null;},sensorFov:()=>20,
    project:()=>[0,0,1],sub:(a,b)=>a.map((v,i)=>v-b[i]),drawAirOverlay(){},visibleStoreImpact:()=>null,drawRadar(){},drawRwr(){},drawWarn(){},refreshFlightDiagnostics(){},drawDamage(){},airHelpText:()=>'',air$fmt:(n,d=0)=>Number(n).toFixed(d),esc3:String,aircraftFlapLabel:()=> 'up',drawAirBar(){},viewName:a=>a.ctl.view,airMode:()=> 'ground',RADAR_MODE_NAME:{search:()=> 'SEARCH'},POD_STATE:{},launchCheck:()=>({ok:false,reason:'native host decides'}),
    airHudInventory:{report:()=>({guns:[],stores:[],selectedStore:null,fuel:{usableKg:null,low:false,timeText:'—',statusEn:'native'}})},stepArmObs(){},stepRadarSys(){},stepPod(){},stepSeeker(){},targetAlive:()=>true,cmRelease:forbidden,stepThreats(){},launchGuided:forbidden,releaseStore:forbidden});
  vm.runInContext(helper+section('    function podCancel(air) {','    /** Space in the air')+section('    function seekerCancel(air) {','    /** Light for')+section('    function airCancel(air) {','    /** The fixed-rate step')+section('    function weaponCycle(air,','    /** J: the next target')+section('    function sensorViews(air) {','    function viewCycle(')+section('    function airViewCamera(air) {','    /** The command missile')+section('    function radioSteer(air,','    /** The mouse in the sensor')+section('    function stepAirSystems(air,','    // ---- one input map')+section('    function updateAirHud(viewProj,','    function drawReticle('),context);
  const api=context.createFrontlineGuidedControl({group:a=>group(a.stores),resolve:v=>JSON.stringify(v?.unitRef||v)===JSON.stringify(target.unitRef)?target:null,targets:()=>[target],reason:context.airReason,activate:a=>{a.ctl.seeker.state='prep';},pod:context.airPod,podTrack:()=>false,capture:()=>false,cancel:context.airCancel,nose:context.noseOf});
  context.G4.frontline={radioSteer:(dx,dy,dt)=>api.radioSteer(air,dx,dy,dt)};api.accept(air,host,[]);return{context,api,air,host,target,first,second,radio,stores,airEl};
}
test('Y-selected guided definition follows selection immediately and does not inherit prior host readiness',()=>{
  const f=fixture();f.context.weaponCycle(f.air,1);f.api.accept(f.air,f.host,[]);assert.equal(f.air.ctl.seeker.def,f.second);assert.notEqual(f.air.ctl.seeker.state,'track');assert.equal(f.air.ctl.seeker.target,null);
  assert.equal(f.api.intent(f.air,f.host).target.unit,9,'Existing STT/selected target can still support the prior airborne SARH');
  f.api.action(f.air,f.host,'space',2);assert.notEqual(f.air.storeTap,true,'Old accepted readiness must not release newly selected source');
  f.host.weapon_control={store_id:'second',store_index:null};f.host.seeker={...f.host.seeker,status:'prep',progress_s:0};f.api.accept(f.air,f.host,[]);assert.equal(f.air.ctl.seeker.state,'prep');
  f.host.seeker.status='track';f.api.accept(f.air,f.host,[]);f.api.action(f.air,f.host,'space',3);assert.equal(f.air.storeTap,true);
});
test('actual X seeker-cancel preserves real STT while pod cancellation follows its existing target-clear semantics',()=>{
  const f=fixture(),stt=f.air.ctl.radar.stt;f.api.action(f.air,f.host,'cancel');assert.equal(f.air.ctl.radar.stt,stt);assert.equal(f.air.ctl.selected,f.target);assert.equal(f.api.intent(f.air,f.host).enabled,false);assert.equal(f.api.intent(f.air,f.host).target.unit,9);
  f.air.ctl.seeker.state='off';f.air.ctl.pod={state:'track',target:f.target,point:[0,0,100],mount:[0,0,0],dir:[0,0,1],cfg:{laser:true,range:10000}};f.api.action(f.air,f.host,'cancel');assert.equal(f.air.ctl.pod.state,'free');assert.equal(f.air.ctl.pod.target,null);assert.equal(f.api.intent(f.air,f.host).laser,false);
});
test('native Radio UI proxy survives actual camera/HUD/sensor consumers without missile pose or local ordnance',()=>{
  const f=fixture();f.stores.sel=2;f.host.weapon_control={store_id:'radio',store_index:null};f.host.seeker.status='ready';const rows=[{shot_id:31,shooter:7,phase:'radio',store_id:'radio'}];f.api.accept(f.air,f.host,rows);
  assert.deepEqual(Object.keys(f.air.ctl.radio.guide).sort(),['cmd','phase']);assert.equal(f.air.ctl.radio.pos,undefined);
  assert.equal(f.context.airViewCamera(f.air),null);assert.doesNotThrow(()=>f.context.stepAirSystems(f.air,1/60));assert.doesNotThrow(()=>f.context.updateAirHud([],1280,720));assert.match(f.airEl.sys.innerHTML,/Radio/);
  assert.doesNotThrow(()=>f.context.radioSteer(f.air,10,-20,1/60));assert.ok(f.api.intent(f.air,f.host).manual[0]>0);assert.equal(f.context.airOrdnance.length,0);
  f.api.action(f.air,f.host,'cancel');assert.equal(f.air.ctl.radio,null);f.api.accept(f.air,f.host,rows);assert.equal(f.air.ctl.radio,null,'Cancel must not re-enter the same radio UI mode on the next snapshot');
});
test('seeker power off leaves an existing radio control proxy, while full cancel ends only that shot UI mode',()=>{
  const f=fixture();f.stores.sel=2;f.host.weapon_control={store_id:'radio',store_index:null};const row={shot_id:41,shooter:7,phase:'radio',store_id:'radio'};f.api.accept(f.air,f.host,[row]);const proxy=f.air.ctl.radio;
  f.api.radioSteer(f.air,25,-50,0);const manual=JSON.stringify(f.api.intent(f.air,f.host).manual);f.api.action(f.air,f.host,'seekerPower');assert.equal(f.api.intent(f.air,f.host).enabled,false);assert.equal(f.air.ctl.radio,proxy);assert.equal(JSON.stringify(f.api.intent(f.air,f.host).manual),manual);
  f.api.action(f.air,f.host,'cancel');assert.equal(f.air.ctl.radio,null);assert.equal(JSON.stringify(f.api.intent(f.air,f.host).manual),'[0,0]');f.api.accept(f.air,f.host,[row]);assert.equal(f.air.ctl.radio,null);
  f.api.accept(f.air,f.host,[{...row,shot_id:42}]);assert.equal(f.air.ctl.radio.shot_id,42,'A distinct accepted shot may create a new control proxy');
});
