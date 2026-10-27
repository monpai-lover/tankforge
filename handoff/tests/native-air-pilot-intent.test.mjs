import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';

const source=fs.readFileSync(new URL('../bundle/app.js.html',import.meta.url),'utf8');
const visual=fs.readFileSync(new URL('../tools/frontline_aircraft_visual.js',import.meta.url),'utf8');
const baseline=fs.readFileSync(new URL('./fixtures/aircraft-pilot-step-baseline-20261025.txt',import.meta.url),'utf8');
const provenance=JSON.parse(fs.readFileSync(new URL('./fixtures/aircraft-pilot-step-baseline-20261025.json',import.meta.url),'utf8'));
const bytes=fs.readFileSync(new URL('../flight/flight_core.wasm',import.meta.url));
assert.equal(crypto.createHash('sha256').update(baseline).digest('hex'),provenance.methodSha256);
const plain=value=>JSON.parse(JSON.stringify(value)),dt=1/120;
function context(){
 const c=vm.createContext({performance,atob}),a=source.indexOf('  // the C flight core'),b=source.indexOf('  // client/web/src/main.js',a);
 assert.ok(a>0&&b>a);
 vm.runInContext(source.slice(source.indexOf('  function m4()'),source.indexOf('  // client/web/src/game/relief.js'))+source.slice(source.lastIndexOf('\n',a)+1,b)+visual+'\nglobalThis.legacyStep=({'+baseline+'})._step;',c);
 const renderer={mesh(data){return{count:data.length/13,_src:{data}};},freeMesh(){}};
 return {c,renderer};
}
function readonlyPlane(f){
 const model=f.c.createFrontlineAircraftVisual(f.renderer,'f86f'),p=model.plane,state=Array(80).fill(0);state[1]=1500;state[6]=1;state[9]=150;state[13]=150;state[17]=1;state[27]=Math.fround(.7);state[35]=1500;state[42]=state[46]=state[50]=1;
 const unit={unit:{battle:3,unit:5,life:1},aircraft:'f86f',alive:true,state,aero:Array(48).fill(0),damage:{parts:p.damage.parts.map(part=>[part.max,0]),fire:false,broken:false},guns:[{id:'native_feed',ammo:117}],fuel:{kg:310,max:400,flow:2},stores:[],resource_revision:3};
 model.accept(unit,1);model.setControlled(true,new Set());
 return {model,p,unit};
}
const input=()=>({touch:{throttle:0,steer:0},mdx:0,mdy:0});
const pad=(axes=[0,0,0,0],buttons={})=>({index:0,id:'real-standard-map',mapping:'standard',connected:true,axes,buttons:Array.from({length:16},(_,i)=>({value:buttons[i]||0,pressed:!!buttons[i]}))});
async function livePlane(f){
 const {instance}=await WebAssembly.instantiate(bytes,{math:{sin:Math.sin,cos:Math.cos,atan2:Math.atan2,exp:Math.exp,asin:Math.asin,acos:Math.acos},world:{ground:()=>0,landable:()=>1}});
 const p=new f.c.Aircraft(f.renderer,instance.exports,'f86f');p.spawn(0,1500,0,0,150,false);p.slump=.4;
 return p;
}

test('actual Aircraft pilotIntent collects keyboard/free-look/dead-pilot intent without changing accepted flight or resources',()=>{
 const f=context(),{model,p,unit}=readonlyPlane(f);assert.equal(typeof p.pilotIntent,'function');
 const accepted=JSON.stringify({cur:Array.from(p.cur),prev:Array.from(p.prev),S:Array.from(p.S),aero:Array.from(p.aero),time:p.time,acc:p.acc,unit});
 p.keys.add('KeyS');p.keys.add('KeyA');p.keys.add('KeyE');p.keys.add('ShiftLeft');p.state.level=true;p.state.gear=true;p.state.flaps='combat';
 const command=p.pilotIntent(.04);assert.equal(command.manual_pitch,1);assert.equal(command.manual_roll,-1);assert.equal(command.manual_yaw,1);assert.ok(Math.abs(command.throttle-(Math.fround(.7)+.01))<1e-12);assert.equal(command.flags,1|4|8|64);assert.equal(p.state.level,false);
 p.keys.clear();p.keys.add('KeyC');p.keys.add('KeyW');p.state.throttle=.6;p.S[48]=.6;p.S[49]=0;p.S[50]=.8;
 const free=p.pilotIntent(0);assert.deepEqual(plain(free.aim),[Math.fround(.6),0,Math.fround(.8)]);assert.equal(free.flags&2,2);
 p.S.set(unit.state);p.keys.clear();p.slump=.4;const pilotHp=p.damage.by.pilot.hp;p.damage.by.pilot.hp=0;p.state.flaps='takeoff';p.state.gear=true;
 const dead=p.pilotIntent(0);assert.equal(dead.manual_pitch,-.3);assert.equal(dead.manual_roll,.35*.4);assert.equal(dead.manual_yaw,0);assert.equal(dead.flags,4|8|128);p.damage.by.pilot.hp=pilotHp;
 assert.equal(JSON.stringify({cur:Array.from(p.cur),prev:Array.from(p.prev),S:Array.from(p.S),aero:Array.from(p.aero),time:p.time,acc:p.acc,unit}),accepted);
 model.dispose();
});

test('nativeAuthority uses the actual shared mouse/keyboard/pad/touch input path and never advances readonly Aircraft',()=>{
 const f=context(),{model,p,unit}=readonlyPlane(f),air={nativeAuthority:true,plane:p,active:true,guns:unit.guns,fuel:unit.fuel,stores:{items:unit.stores}},g=input();
 const never=label=>()=>{throw Error('Forbidden native '+label);};p.update=never('update');p.api.step=never('flight step');p.damage.step=never('damage step');p.applyDamage=never('damage apply');p.pose=never('pose');
 const before=JSON.stringify({state:Array.from(p.cur),S:Array.from(p.S),aero:Array.from(p.aero),unit,time:p.time,acc:p.acc});
 f.c.advanceAircraftInput(air,dt,g,[pad()]);assert.ok(air.nativeIntent);
 g.mdx=30;g.mdy=-16;g.touch.steer=-.7;g.touch.throttle=.8;p.keys.add('KeyS');p.keys.add('ShiftLeft');
 f.c.advanceAircraftInput(air,dt,g,[pad([1,.56,-1],{0:1})]);
 assert.equal(air.nativeIntent.manual_pitch,1);assert.equal(air.nativeIntent.manual_roll,-.7);assert.equal(air.nativeIntent.manual_yaw,-1);assert.equal(air.inputFireAll,true);assert.ok(air.nativeIntent.aim[0]>.04);assert.ok(air.nativeIntent.aim[1]>.02);assert.equal(g.mdx,0);assert.equal(g.mdy,0);
 assert.ok(Math.abs(air.nativeIntent.throttle-(Math.fround(.7)+dt*.25*(.8+1)))<1e-12);
 const aim=plain(air.nativeIntent.aim);f.c.advanceAircraftInput(air,dt,g,[]);assert.deepEqual(plain(air.nativeIntent.aim),aim,'Mouse delta consumed once');
 f.c.advanceAircraftInput(air,dt,g,[pad([1,1,1],{0:1})],false);assert.equal(p.keys.size,0);assert.equal(air.inputFireAll,false);assert.equal(air.nativeIntent.manual_pitch,0);assert.equal(air.nativeIntent.manual_roll,0);assert.equal(air.nativeIntent.manual_yaw,0);assert.equal(air.padArmed,false);
 assert.equal(JSON.stringify({state:Array.from(p.cur),S:Array.from(p.S),aero:Array.from(p.aero),unit,time:p.time,acc:p.acc}),before);model.dispose();
});

test('native collected command equals the normal real-WASM first command for identical mixed pilot input',async()=>{
 const f=context(),{model,p}=readonlyPlane(f),normal=await livePlane(f),calls=[],api=normal.api;normal.api={...api,step(...args){calls.push(args);api.step(...args);}};
 for(const plane of [p,normal]){plane.state.throttle=.65;plane.state.gear=false;plane.state.flaps='combat';plane.state.instructor=true;plane.state.level=true;plane.aim=[0,0,1];plane.aimBias=[0,0,0,1];plane.keys.clear();}
 const native={nativeAuthority:true,plane:p},local={plane:normal},a=input(),b=input();
 for(const [air,g]of [[native,a],[local,b]])f.c.advanceAircraftInput(air,dt,g,[pad()]);calls.length=0;
 for(const plane of [p,normal]){plane.keys.add('ShiftRight');plane.keys.add('KeyE');}a.mdx=b.mdx=25;a.mdy=b.mdy=-8;a.touch.steer=b.touch.steer=.4;a.touch.throttle=b.touch.throttle=.6;
 f.c.advanceAircraftInput(native,dt,a,[pad([-.6,.7,-.5],{0:1,1:1})]);f.c.advanceAircraftInput(local,dt,b,[pad([-.6,.7,-.5],{0:1,1:1})]);
 assert.equal(calls.length,1);const actual=calls[0];assert.deepEqual(plain(native.nativeIntent),{aim:actual.slice(1,4),throttle:actual[4],manual_pitch:actual[5],manual_roll:actual[6],manual_yaw:actual[7],flags:actual[8]});assert.equal(native.inputFireAll,local.inputFireAll);assert.equal(native.inputFireCannon,local.inputFireCannon);
 model.dispose();normal.dispose();
});

test('normal single-player shared controls retain exact original WASM state, step commands and diagnostic submission',async()=>{
 const f=context(),current=await livePlane(f),legacy=await livePlane(f),calls=[[],[]],captures=[[],[]];legacy._step=f.c.legacyStep;
 for(const [i,p]of [current,legacy].entries()){const api=p.api;p.api={...api,step(...args){calls[i].push(args);api.step(...args);}};p.diagnostics={enabled:true,capture(_plane,axes,flags,delta,aim){captures[i].push(plain({axes,flags,delta,aim}));}};}
 const airs=[{plane:current},{plane:legacy}],inputs=[input(),input()];
 for(let frame=0;frame<40;frame++){
  for(let i=0;i<2;i++){const p=airs[i].plane,g=inputs[i];p.keys.clear();if(frame>2&&frame<12)p.keys.add('ShiftLeft');if(frame>=12&&frame<20)p.keys.add('ControlLeft');if(frame%7<3)p.keys.add('KeyS');if(frame%9<2)p.keys.add('KeyA');if(frame>=20&&frame<25)p.keys.add('KeyC');p.state.flaps=frame<10?'up':frame<25?'combat':'takeoff';p.state.brake=frame>=30;g.mdx=frame%3===0?3:0;g.mdy=frame%4===0?-2:0;g.touch.throttle=frame%8===0?.3:0;g.touch.steer=frame%5===0?-.2:0;f.c.advanceAircraftInput(airs[i],1/60,g,frame? [pad([.4,-.3,.2])]:[pad()]);}
  assert.deepEqual(Array.from(current.cur),Array.from(legacy.cur),`Actual WASM state changed at frame ${frame}`);assert.equal(current.time,legacy.time);assert.equal(current.acc,legacy.acc);
 }
 assert.deepEqual(calls[0],calls[1]);assert.deepEqual(captures[0],captures[1]);assert.ok(calls[0].length>60);assert.ok(airs.every(air=>air.nativeIntent===undefined));current.dispose();legacy.dispose();
});
