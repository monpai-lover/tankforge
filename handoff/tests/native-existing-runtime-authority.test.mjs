import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const app=fs.readFileSync(new URL('../bundle/app.js.html',import.meta.url),'utf8');
const bridge=fs.readFileSync(new URL('../tools/frontline_existing_aircraft.js',import.meta.url),'utf8');
const runtime=fs.readFileSync(new URL('../tools/frontline_existing_runtime.js',import.meta.url),'utf8');
const profile=JSON.parse(fs.readFileSync(new URL('../../data/aircraft/frontline.json',import.meta.url),'utf8'));
const section=(start,end)=>{const a=app.indexOf(start),b=app.indexOf(end,a);assert.ok(a>=0&&b>a,start);return app.slice(a,b);};
const plain=x=>JSON.parse(JSON.stringify(x));
function fixture(){
  const G4={mode:'garage',time:10,air:null},sent=[],events=[],def=profile.storeDefinitions;
  const unit={unit:{battle:1,unit:7,life:1},aircraft:'f15c',alive:true,loadout:1,resource_revision:3,guns:[{id:'m61',ammo:250}],fuel:{kg:500,max:1000,flow:1},stores:[{id:'fab250',owner:'wing_l',count:2,gone:false,p:[-2,-1,0]},{id:'mk82',owner:'wing_r',count:2,gone:false,p:[2,-1,0]}],weapon_control:null};
  const nope=()=>{throw Error('Local authoritative update is forbidden');},cur=new Float32Array(80);cur[1]=500;cur[9]=200;
  const plane={type:{id:'f15c'},position:[0,500,0],cur,onGround:false,crashed:false,root:{local:[1,0,0,0,0,1,0,0,0,0,1,0,0,500,0,1]},worldPoint:p=>[p[0],p[1]+500,p[2]],update:nope,api:{step:nope},damage:{step:nope},pilotIntent:()=>({aim:[0,0,1],throttle:.7,manual_pitch:0,manual_roll:0,manual_yaw:0,flags:1})};
  const stores={items:unit.stores.map(s=>({...s,p:s.p.slice(),def:def[s.id]})),groups:['fab250','mk82'],sel:0,program:{bomb:'single'}};
  const model={plane,stores,hudProjection:{guns:unit.guns.map(g=>({...g})),fuel:{...unit.fuel},stores}};
  const element=()=>({style:{},appendChild(){},hidden:true});
  const document={body:{dataset:{}},createElement:element};
  const f={epoch:4,seq:0,map:{name:'Native theatre'},room:{team_score:[0,0],score_limit:1000},aircrafts:[],airModels:new Map()};
  const c=vm.createContext({G4,document,airHud:element(),performance:{now:()=>0},AIR_STORE_DEFS:def,AIR_WEAPON_KINDS:new Set(['bomb','rocket','pod','aam','agm']),airHudInventory:{},
    frontlineAircraftHud(u,m){m.hudProjection.guns.forEach((g,i)=>g.ammo=u.guns[i].ammo);m.hudProjection.fuel=u.fuel?{...u.fuel}:null;},aircraftGuns:()=>[],
    cancelPilotInput(){if(G4.air){G4.air.storeTap=G4.air.storeHeld=G4.air.fireAll=G4.air.fireCannon=false;}},
    syncAircraftTouchControls(){},stepPlayerAircraftPilot(){G4.air.nativeIntent=plane.pilotIntent();},stepAirSystems(air){air.ctl??={eq:{ccip:true,ccrp:true}};},airAudio(){},airEffects(){},airViewCamera:()=>null,updateAirHud(){},
    dropAirPreview(){},removeAircraft:nope,setMode(mode){G4.mode=mode;},renderer:{setMap(){},zones:[]},hud:{toast(){}},frontlineRoundPresentation:()=>({text:'battle'}),airReason(_air,text){events.push(text);},frontlineAirServiceReason:s=>s,
    sub:(a,b)=>a.map((v,i)=>v-b[i]),norm:a=>{const n=Math.hypot(...a)||1;return a.map(x=>x/n);},surfaceAt:()=>0,AIR_RHO:()=>1.2,G3:9.80665
  });
  vm.runInContext(section('    const RELEASE_PROGRAMS = {','    function releaseModeCycle(')+section('    function storeGroup(st)','    function cycleStore(')+section('    function ccrpCue(air)','    /** The flight core told')+section('    function storeImpact(air)','    function visibleStoreImpact(')+bridge+'\n'+runtime,c);
  const r=c.createFrontlineExistingRuntime({f,mine:()=>({team:'blue'}),controlled:()=>unit,controlledAirModel:()=>model,send:m=>sent.push(plain(m)),height:()=>0,note(){},shared:{}});
  r.step(1/60);
  return {r,G4,unit,model,plane,stores,sent,events,c,f,air:()=>G4.air,last:()=>sent.filter(m=>m.op==='air_input').at(-1),choice:()=>sent.filter(m=>m.op==='air_weapon_control').at(-1)};
}
const acknowledge=f=>{const {op,unit,epoch,seq,...control}=f.choice();f.unit.weapon_control=control;};

test('native release and guns wait for the exact accepted weapon control while tap remains pending',()=>{
  const f=fixture(),air=f.air();air.fireAll=true;air.storeTap=true;f.r.transmit();
  assert.equal(f.last().fire,false);assert.equal(f.last().release,false);assert.equal(air.storeTap,true);
  f.unit.weapon_control={store_id:'fab250',store_index:0,program:'single',gun_mode:'all'};f.r.transmit();assert.equal(f.last().release,false,'Wrong station is not the same accepted command');
  acknowledge(f);f.r.transmit();assert.equal(f.last().fire,true);assert.equal(f.last().release,true);assert.equal(air.storeTap,false);
  f.r.transmit();assert.equal(f.last().release,false,'One tap is transported once');
});

test('selection changes and rejection cancel a pending release without falling back to a prior accepted weapon',()=>{
  const f=fixture(),air=f.air();air.storeTap=true;f.r.transmit();acknowledge(f);
  f.stores.sel=1;f.r.transmit();assert.equal(air.storeTap,false);assert.equal(f.last().release,false);assert.equal(f.choice().store_id,'mk82');
  air.storeTap=air.storeHeld=true;f.r.rejectWeaponControl('unsupported_release_program');assert.equal(air.storeTap,false);assert.equal(air.storeHeld,false);f.r.transmit();assert.equal(f.last().release,false);
  const before=f.sent.filter(m=>m.op==='air_weapon_control').length;f.r.transmit();assert.equal(f.sent.filter(m=>m.op==='air_weapon_control').length,before,'Rejected unchanged choice is not resent forever');
  acknowledge(f);air.storeTap=true;f.r.transmit();assert.equal(f.last().release,true,'A fresh request may use a later accepted command');
});

test('cannon-only trigger waits for cannon-mode echo and cannot fire the previous all-gun mode',()=>{
  const f=fixture(),air=f.air();f.r.transmit();acknowledge(f);air.fireCannon=true;f.r.transmit();
  assert.equal(f.choice().gun_mode,'cannon');assert.equal(f.last().fire,false);acknowledge(f);f.r.transmit();assert.equal(f.last().fire,true);
});

test('original read-only CCIP predictor is updated without stepping local flight damage fuel or stores',()=>{
  const f=fixture(),before=JSON.stringify({unit:f.unit,cur:[...f.plane.cur],guns:f.air().guns,stores:f.stores});
  assert.ok(f.air().impact?.at.every(Number.isFinite));assert.equal(f.air().impact.weaponId,'fab250');assert.equal(f.air().impact.kind,'bomb');assert.ok(f.air().impact.t>0);
  f.r.step(.05);assert.equal(JSON.stringify({unit:f.unit,cur:[...f.plane.cur],guns:f.air().guns,stores:f.stores}),before);
  f.air().ctl.eq.ccip=f.air().ctl.eq.ccrp=false;f.r.step(.01);assert.equal(f.air().impact,null);
});

test('CCRP uses the original signed along-track and 80m cross-track cue before sending one native release',()=>{
  const f=fixture(),air=f.air();f.r.transmit();acknowledge(f);const point=air.impact.at;
  air.ccrp={p:[point[0],point[1],point[2]+20],t:10};air.storeHeld=air.storeTap=true;f.r.transmit();assert.equal(f.last().release,false,'Still short of the designated point');assert.equal(air.storeTap,false,'CCRP ignores an immediate ordinary tap');
  air.ccrp.p=[point[0]+81,point[1],point[2]-20];f.r.transmit();assert.equal(f.last().release,false,'Outside original cross-track gate');
  air.ccrp.p=[point[0],point[1],point[2]-151];f.r.transmit();assert.equal(f.last().release,false,'Too far beyond original release window');
  air.ccrp.p=[point[0],point[1],point[2]-20];f.r.transmit();assert.equal(f.last().release,true);assert.equal(air.ccrp.released,true);f.r.transmit();assert.equal(f.last().release,false,'Designation cannot start another salvo');
});

test('missing accepted fuel stays unavailable rather than breaking the whole control bridge',()=>{
  const f=fixture();f.unit.fuel=null;assert.doesNotThrow(()=>f.r.step(.01));assert.equal(f.air().fuel,null);
});
