import {aircraftPerformancePrelude} from '../tools/aircraft_performance/runtime.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../bundle/app.js.html',import.meta.url),'utf8');
const cut=(a,b)=>{
  const start=source.indexOf(a),end=source.indexOf(b,start);
  assert.ok(start>=0&&end>start,`missing delivered section ${a}`);
  return source.slice(start,end);
};
function controlsContext(extra={}) {
  const c=vm.createContext(extra);
  vm.runInContext(aircraftPerformancePrelude()+`const norm=a=>{const l=Math.hypot(...a)||1;return a.map(v=>v/l);};
    const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
    const FLIGHT_FIXED=1/120,FLIGHT_MAX_STEPS=12;
    ${cut('  var aqMul = ','  var AIRCRAFT_KEYS')}
    ${cut('  // Input shaping follows wasm-flight-lab','  var Aircraft = class')}
    class ExtractedAircraft {${cut('    look(dx, dy) {','    pose(alpha = 1) {')}}
    globalThis.methods=ExtractedAircraft.prototype;
    globalThis.helpers={aircraftStick,aircraftPadInput,clearAircraftInput,advanceAircraftInput};`,c);
  return c;
}
const pad=(axes=[0,0,0,0],buttons={})=>({index:0,id:'standard-test',mapping:'standard',connected:true,axes,buttons:Array.from({length:16},(_,i)=>({value:buttons[i]||0,pressed:!!buttons[i]}))});
const fakePlane=()=>({keys:new Set(),pilotAxes:[0,0,0],state:{throttle:.5},look(){},update(){},throttleBy(d){this.state.throttle=Math.max(0,Math.min(1.12,this.state.throttle+d));}});
const input=()=>({touch:{throttle:0,steer:0},mdx:0,mdy:0});

test('real gamepad shaping is finite, odd, monotonic and preserves its endpoints/deadzone',()=>{
  const {aircraftStick:shape,aircraftPadInput:read}=controlsContext().helpers;
  assert.equal(shape(-1),-1);assert.equal(shape(1),1);assert.equal(shape(.12),0);assert.equal(shape(-.12),0);
  assert.equal(shape(NaN),0);assert.equal(shape(Infinity),0);
  let previous=-Infinity;
  for(let i=-100;i<=100;i++) {
    const x=i/100,y=shape(x);
    assert.ok(y>=previous);assert.ok(Math.abs(y+shape(-x))<1e-12);previous=y;
  }
  const ignored=read([null,{...pad([1,1,1]),mapping:''},{...pad([1,1,1]),connected:false}]);
  assert.equal(ignored.key,null);assert.deepEqual(Array.from(ignored.axes),[0,0,0]);
  const actual=read([pad([1,-1,.56],{0:1,7:1})]);
  assert.deepEqual(Array.from(actual.axes),[-1,1,shape(.56)]);
  assert.equal(actual.throttle,1);assert.equal(actual.fireAll,true);
});

test('standard pad needs neutral arming after connect, disconnect and focus loss; no sticky axes/fire',()=>{
  const {advanceAircraftInput:advance}=controlsContext().helpers;
  const air={plane:fakePlane()},g=input(),held=pad([1,1,1],{0:1,7:1});
  advance(air,.1,g,[held]);
  assert.deepEqual(Array.from(air.plane.pilotAxes),[0,0,0]);assert.equal(air.inputFireAll,false);
  advance(air,.1,g,[pad()]);advance(air,.1,g,[held]);
  assert.deepEqual(Array.from(air.plane.pilotAxes),[1,1,1]);assert.equal(air.inputFireAll,true);
  const throttle=air.plane.state.throttle;
  advance(air,.1,g,[]);
  assert.deepEqual(Array.from(air.plane.pilotAxes),[0,0,0]);assert.equal(air.inputFireAll,false);assert.equal(air.plane.state.throttle,throttle);
  advance(air,.1,g,[held]);assert.equal(air.inputFireAll,false);
  advance(air,.1,g,[pad()]);advance(air,.1,g,[held]);
  air.plane.keys.add('KeyS');air.fireAll=true;g.mdx=100;
  advance(air,.1,g,[held],false);
  assert.equal(air.plane.keys.size,0);assert.equal(air.fireAll,false);assert.equal(air.inputFireAll,false);assert.equal(g.mdx,0);
  advance(air,.1,g,[held],true);assert.equal(air.inputFireAll,false);
  advance(air,.1,g,[pad()]);advance(air,.1,g,[held]);assert.equal(air.inputFireAll,true);
  advance(air,.1,g,[{...held,index:1}]);assert.equal(air.inputFireAll,false,'switching controllers also requires neutral');
});

test('real _inputs gives held keyboard axes precedence and uses touch roll without cancelling pad pitch/yaw',()=>{
  const context=controlsContext(),{advanceAircraftInput:advance}=context.helpers,air={plane:fakePlane()},g=input();
  air.plane._inputs=context.methods._inputs;
  advance(air,.1,g,[pad()]);g.touch.steer=-.7;g.touch.throttle=.8;
  advance(air,.1,g,[pad([1,.56,-1])]);
  assert.deepEqual(Array.from(air.plane._inputs()),[context.helpers.aircraftStick(.56),-.7,-1]);
  assert.equal(air.plane.state.throttle,.52);
  air.plane.keys.add('KeyS');air.plane.keys.add('KeyA');air.plane.keys.add('KeyE');
  assert.deepEqual(Array.from(air.plane._inputs()),[1,-1,1]);
  air.plane.keys.add('KeyW');assert.equal(air.plane._inputs()[0],0,'opposing held keys must not reveal an underlying pad input');
});

test('mouse intent reaches the first actual WASM step in the same update and is consumed once',async()=>{
  const bytes=fs.readFileSync(new URL('../flight/flight_core.wasm',import.meta.url));
  const {instance}=await WebAssembly.instantiate(bytes,{math:{sin:Math.sin,cos:Math.cos,atan2:Math.atan2,exp:Math.exp,asin:Math.asin,acos:Math.acos},world:{ground:()=>0,landable:()=>1}});
  const api=instance.exports;api.set_world(1);api.configure_control(1,0,.22,1);api.configure(0,45,1,6.5,1);api.spawn(0,3000,0,0,140,0);
  const S=new Float32Array(api.memory.buffer,api.state_ptr(),api.state_len()),context=controlsContext(),calls=[];
  const p=Object.assign(Object.create(context.methods),{
    type:{id:'nf01'},api:{step(...args){calls.push(args);api.step(...args);}},S,cur:S.slice(),prev:S.slice(),keys:new Set(),pilotAxes:[0,0,0],state:{throttle:.78,instructor:true,gear:false,flaps:false,brake:false,level:false},
    aim:[0,0,1],camQ:[0,0,0,1],aimBias:[0,0,0,1],free:{yaw:0,pitch:0},time:0,acc:0,crashed:false,damage:{pilotDead:false,broken:false,step(){}},applyDamage(){},pose(){}
  });
  const g=input();g.mdx=30;g.mdy=-16;
  context.helpers.advanceAircraftInput({plane:p},1/60,g,[]);
  assert.equal(calls.length,2);assert.ok(calls[0][1]>.04,'first step still received the previous straight-ahead aim');
  assert.ok(calls[0][2]>.02);assert.deepEqual(calls[0].slice(1,4),Array.from(p.aim));
  assert.equal(g.mdx,0);assert.equal(g.mdy,0);assert.ok(S.every(Number.isFinite));
  const aim=Array.from(p.aim);context.helpers.advanceAircraftInput({plane:p},1/60,g,[]);
  assert.deepEqual(Array.from(p.aim),aim,'the same mouse delta was consumed twice');
});

class Target {
  constructor(id){this.id=id;this.handlers={};this.style={};this.dataset={};this.textContent=id;}
  addEventListener(type,handler){(this.handlers[type]||=[]).push(handler);}
  emit(type,properties={}){for(const handler of this.handlers[type]||[])handler({pointerId:1,pointerType:'touch',clientX:50,clientY:50,preventDefault(){},...properties});}
  setPointerCapture(){}
  getBoundingClientRect(){return {left:0,top:0,width:100,height:100};}
}
function touchContext(language='zh') {
  const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,new Target(id));return nodes.get(id);},window=new Target('window'),document=new Target('document');
  document.getElementById=node;document.body={dataset:{}};document.hasFocus=()=>true;window.matchMedia=()=>({matches:false});
  const plane=fakePlane(),toggles=[];plane.toggle=code=>toggles.push(code);plane.setXray=value=>toggles.push(['xray',value]);
  const G4={air:{active:true,plane},touch:{throttle:0,steer:0},touchResetters:[],keys:new Set(),mode:'battle',mdx:0,mdy:0,airInputFocused:true};
  const c=controlsContext({LANG:language,window,document,canvas:node('canvas'),G4,setFreeLook(){},setXray(){},toggleSight(){},startRanging(){},setZero(){},vehicleActions:{cancel(){}},hitcam:{suspendPresentation(){}},sound:{setReloadAudible(){}},vehicleActionIndicator:{update(){}}});
  vm.runInContext(cut('    const touchEl = document.getElementById("touch");','    function trigger(mgTrigger')+'\nglobalThis.syncTouch=syncAircraftTouchControls;',c);
  vm.runInContext(cut('    const airKeyState = ','    const comboOf = ')
    +cut('    function resetAirActionKeys() {','    /** Space is a chord prefix:')
    +'let keySpace=false;globalThis.chordState=airKeyState;'
    +cut('    function cancelPilotInput() {','    window.addEventListener("pagehide"'),c);
  c.syncTouch(true);
  toggles.length=0;
  return {c,node,window,document,G4,toggles};
}

test('actual touch handlers route flight controls, own one pointer, cancel capture and preserve mouse fire',()=>{
  const {c,node,G4,toggles}=touchContext(),fire=node('tb-fire'),cannon=node('tb-mg'),joy=node('joy');
  assert.equal(fire.textContent,'全部開火');assert.equal(node('tb-range').textContent,'起落架');
  const english=touchContext('en');
  assert.deepEqual(['tb-fire','tb-mg','tb-sight','tb-range','tb-zero-up','tb-zero-down','tb-free','tb-xray'].map(id=>english.node(id).textContent),['Fire all','Cannon','View','Gear','Flaps: Up','Brakes','Free look','X-ray']);
  assert.ok(english.node('joy').title.startsWith('Up/down: throttle'));
  G4.air.fireAll=true;
  fire.emit('pointerdown',{pointerId:1});fire.emit('pointerdown',{pointerId:2});fire.emit('pointerup',{pointerId:2});
  assert.equal(G4.touch.airFireAll,true,'unrelated finger released the owned trigger');
  fire.emit('pointercancel',{pointerId:1});assert.equal(G4.touch.airFireAll,false);assert.equal(G4.air.fireAll,true,'touch release cancelled an independent mouse trigger');
  cannon.emit('pointerdown',{pointerId:3});cannon.emit('lostpointercapture',{pointerId:3});assert.equal(G4.touch.airFireCannon,false);
  joy.emit('pointerdown',{pointerId:4,clientY:10});assert.ok(G4.touch.throttle>.7);
  joy.emit('pointerup',{pointerId:9});assert.ok(G4.touch.throttle>.7);
  joy.emit('pointermove',{pointerId:4,clientX:95,clientY:50});assert.ok(G4.touch.steer>.8);
  joy.emit('pointercancel',{pointerId:4});assert.equal(G4.touch.steer,0);assert.equal(G4.touch.throttle,0);assert.equal(node('joy-knob').style.transform,'');
  for(const id of ['tb-sight','tb-range','tb-zero-up','tb-zero-down'])node(id).emit('click');
  assert.deepEqual(toggles,['KeyV','KeyG','KeyF','KeyB']);
  node('tb-free').emit('pointerdown');c.helpers.advanceAircraftInput(G4.air,1/60,G4,[]);assert.equal(G4.air.plane.keys.has('KeyC'),true);node('tb-free').emit('lostpointercapture');c.helpers.advanceAircraftInput(G4.air,1/60,G4,[]);assert.equal(G4.air.plane.keys.has('KeyC'),false);
  const canvas=node('canvas');canvas.emit('pointerdown',{pointerId:5});canvas.emit('pointerdown',{pointerId:6});canvas.emit('pointermove',{pointerId:6,clientX:90});assert.equal(G4.mdx,0);
  canvas.emit('pointermove',{pointerId:5,clientX:90});assert.equal(G4.mdx,60);canvas.emit('pointercancel',{pointerId:5});canvas.emit('pointermove',{pointerId:5,clientX:100});assert.equal(G4.mdx,60);
});

test('touch free-look and keyboard C remain independent in actual look motion and cancellation',()=>{
  const {c,node,G4,window}=touchContext(),p=G4.air.plane,free=node('tb-free'),advance=c.helpers.advanceAircraftInput;
  Object.assign(p,{look:c.methods.look,aim:[0,0,1],camQ:[0,0,0,1],free:{yaw:0,pitch:0},state:{throttle:.5,level:false}});
  const move=()=>{G4.mdx=10;advance(G4.air,1/60,G4,[]);};
  p.keys.add('KeyC');free.emit('pointerdown',{pointerId:51});move();
  const aim=Array.from(p.aim),yaw=p.free.yaw;
  free.emit('pointercancel',{pointerId:51});move();
  assert.equal(p.keys.has('KeyC'),true,'cancelling touch released the still-held keyboard C');
  assert.deepEqual(Array.from(p.aim),aim);assert.ok(p.free.yaw>yaw);
  p.keys.delete('KeyC');move();assert.notDeepEqual(Array.from(p.aim),aim,'releasing both sources did not resume aiming');
  free.emit('pointerdown',{pointerId:52});p.keys.add('KeyC');move();
  p.keys.delete('KeyC');const touchAim=Array.from(p.aim);move();
  assert.equal(p.keys.size,0,'touch free-look must not insert a physical keyboard key');
  assert.equal(p.keys.has('KeyC'),true,'keyboard release cancelled the still-held touch source');
  assert.deepEqual(Array.from(p.aim),touchAim);
  free.emit('lostpointercapture',{pointerId:52});move();
  assert.equal(p.keys.has('KeyC'),false);assert.notDeepEqual(Array.from(p.aim),touchAim);
  free.emit('pointerdown',{pointerId:53});move();window.emit('blur');
  assert.equal(G4.touch.airFree,false);assert.equal(p.keys.has('KeyC'),false,'blur retained touch-only free-look');
});

test('actual blur/hidden handlers clear every pilot source and pointer ownership; ground labels restore',()=>{
  const {c,node,window,document,G4}=touchContext();
  const hold=()=>{G4.air.fireAll=true;G4.air.fireCannon=true;G4.air.inputFireAll=true;G4.air.padArmed=true;G4.air.plane.keys.add('KeyS');c.chordState.held.add('Space');c.chordState.pending={air:G4.air,action:'space'};G4.air.storeHeld=true;node('tb-fire').emit('pointerdown');node('joy').emit('pointerdown',{clientY:10});G4.mdx=20;};
  hold();window.emit('blur');
  assert.equal(G4.airInputFocused,false);assert.equal(G4.air.fireAll,false);assert.equal(G4.air.fireCannon,false);assert.equal(G4.air.inputFireAll,false);assert.equal(G4.air.padArmed,false);assert.equal(G4.air.plane.keys.size,0);assert.equal(G4.touch.throttle,0);assert.equal(G4.touch.airFireAll,false);assert.equal(G4.mdx,0);
  assert.equal(c.chordState.pending,null);assert.equal(c.chordState.held.size,0);assert.equal(G4.air.storeHeld,false);
  window.emit('focus');node('tb-fire').emit('pointerdown',{pointerId:2});assert.equal(G4.touch.airFireAll,true,'blur left a stale owned pointer that blocks the next press');
  document.hidden=true;document.emit('visibilitychange');assert.equal(G4.airInputFocused,false);assert.equal(G4.touch.airFireAll,false);
  document.hidden=false;document.emit('visibilitychange');assert.equal(G4.airInputFocused,true);
  G4.air.active=false;c.syncTouch(false);assert.equal(node('tb-range').textContent,'tb-range');
  node('tb-fire').emit('pointerdown',{pointerId:3});assert.equal(G4.fireHeld,true);assert.equal(G4.touch.airFireAll,false);node('tb-fire').emit('pointercancel',{pointerId:3});assert.equal(G4.fireHeld,false);
});

test('actual F toggle cycles up/combat/takeoff and normalizes legacy boolean assignments',()=>{
  const c=controlsContext(),p={state:{flaps:'up'}};
  for(const stage of ['combat','takeoff','up','combat']) {
    assert.equal(c.methods.toggle.call(p,'KeyF'),true);assert.equal(p.state.flaps,stage);
  }
  for(const [value,id,fraction,flags] of [[false,'up',0,0],[true,'takeoff',.5,136],['combat','combat',.25,72],['unknown','up',0,0]]) {
    const setting=c.aircraftFlapSetting(value);
    assert.deepEqual([setting.id,setting.fraction,setting.flags],[id,fraction,flags]);
    p.state.flaps=value;c.methods.toggle.call(p,'KeyF');
    assert.equal(p.state.flaps,id==='up'?'combat':id==='combat'?'takeoff':'up');
  }
});

test('actual fixed-step submission retains three flap flags after pilot loss and preserves diagnostics capture',()=>{
  const c=controlsContext(),calls=[],captures=[],S=new Float32Array(80);
  const p=Object.assign(Object.create(c.methods),{type:{id:'nf01'},api:{step(...args){calls.push(args);}},S,cur:S.slice(),prev:S.slice(),keys:new Set(),pilotAxes:[0,0,0],state:{flaps:'up',gear:true,instructor:true,throttle:.78},aim:[0,0,1],aimBias:[0,0,0,1],time:0,slump:1,damage:{pilotDead:false,broken:false},diagnostics:{enabled:true,capture(...args){captures.push(args);}}});
  for(const [stage,bits]of [['up',0],['combat',72],['takeoff',136],[false,0],[true,136]])for(const dead of [false,true]) {
    p.state.flaps=stage;p.damage.pilotDead=dead;p._step(1/120);
    const flags=calls.at(-1)[8];
    assert.equal(flags&(8|64|128),bits);assert.equal(flags&4,4);assert.equal(flags&1,dead?0:1);
    assert.equal(captures.at(-1)[2],flags,'diagnostics did not receive the same accepted command flags');
  }
});

test('real native flap fractions drive authored animation, with requested HUD stage separate from travel',async()=>{
  const c=controlsContext();
  vm.runInContext(cut('  var aircraftGeometry = (() => {','  // NF-01 gear')+cut('  var AIR_FIGHTERS = {','  function fighterDamageModel(f) {')+`
    globalThis.flapPose=({${cut('    pose(alpha = 1) {','    /** Sends the damage model')}}).pose;
    globalThis.flapHud=({${cut('    hudState() {','    dispose() {')}}).hudState;
    globalThis.flapModel=aircraftGeometry.fighter(AIR_FIGHTERS.p51d.spec);`,c);
  const bytes=fs.readFileSync(process.env.TF_FLIGHT_TEST_WASM||new URL('../flight/flight_core.wasm',import.meta.url));
  const {instance}=await WebAssembly.instantiate(bytes,{math:{sin:Math.sin,cos:Math.cos,atan2:Math.atan2,exp:Math.exp,asin:Math.asin,acos:Math.acos},world:{ground:()=>0,landable:()=>1}}),api=instance.exports;
  api.set_world(1);api.configure_control(1,0,.22,1);api.configure_airframe(...c.AIR_FIGHTERS.p51d.airframe);api.configure(0,45,1,7,1);api.spawn(0,3000,0,0,140,0);
  const S=new Float32Array(api.memory.buffer,api.state_ptr(),api.state_len());
  const p=Object.assign(Object.create(c.methods),{api,S,cur:S.slice(),prev:S.slice(),keys:new Set(),pilotAxes:[0,0,0],state:{flaps:'up',gear:false,instructor:true,throttle:.78,camera:0},aim:[0,0,1],aimBias:[0,0,0,1],time:0,damage:{pilotDead:false,broken:false,dead:()=>false},type:{id:'p51d',airframe:c.AIR_FIGHTERS.p51d.airframe,gear:{kind:'taildragger'}},root:{},controls:c.flapModel.controls.map(control=>({...control,node:{}})),glass:{},cockpit:{}});
  for(const [stage,target]of [['up',0],['combat',.25],['takeoff',.5],[false,0],[true,.5]]) {
    const before=p.cur[34];p.state.flaps=stage;
    const h=c.flapHud.call(p);
    assert.equal(h.flaps,before,'HUD replaced actual accepted travel with the requested stage');assert.equal(h.flapStage,c.aircraftFlapSetting(stage).id);assert.equal(h.flapTarget,target);
    for(let i=0;i<132;i++)p._step(1/120);
    assert.ok(Math.abs(p.cur[34]-target)<1e-6,`${stage}: native target is ${p.cur[34]}, expected ${target}`);
    c.flapPose.call(p,1);
    const controls=p.controls.filter(control=>control.type==='flap');assert.equal(controls.length,2);
    for(const control of controls) {
      const m=control.node.local,angle=Math.acos(Math.max(-1,Math.min(1,(m[0]+m[5]+m[10]-1)/2)));
      assert.ok(Math.abs(angle-.7*target)<1e-5,`${stage}: accepted native fraction did not drive the visual flap`);
    }
    assert.ok(S.every(Number.isFinite));
  }
});
