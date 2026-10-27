import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const source=fs.readFileSync(new URL('../tools/frontline_client.js',import.meta.url),'utf8');
const a=source.indexOf('      function transmitInput(){'),b=source.indexOf('      function frame(dt){',a);
assert.ok(a>=0&&b>a);
function fixture(){
  const listeners=new Map(),timers=[],calls=[];
  const target=name=>({addEventListener(type,fn){listeners.set(`${name}:${type}`,fn);},focus(){},setPointerCapture(){}});
  const unit={unit:{battle:1,unit:21,life:1},aircraft:'f86f',alive:true,yaw:0};
  const f={active:true,epoch:3,seq:0,keys:new Set(),yaw:0,pitch:-.32,fire:false,
    establishedFlight:{transmit(){calls.push('transport');},clear(){calls.push('clear original controls');}}};
  const editor={hidden:true},G4={mode:'battle',air:{nativeAuthority:true}};
  const context=vm.createContext({f,G4,net:{open:true},performance:{now:()=>1000},controlled:()=>unit,
    clamp:(v,min,max)=>Math.max(min,Math.min(max,v)),setInterval:fn=>(timers.push(fn),timers.length),
    canvas:target('canvas'),document:{...target('document'),getElementById:()=>editor},window:target('window'),ui:{querySelectorAll:()=>[]}});
  vm.runInContext(source.slice(a,b),context);
  const event=(code,tagName='CANVAS')=>({code,target:{tagName},preventDefault(){calls.push('prevent');},stopImmediatePropagation(){calls.push('capture');}});
  return {f,G4,unit,editor,context,listeners,timers,calls,event};
}

test('actual client heartbeat delegates native input without requiring a drawing frame or intercepting original aircraft keys',()=>{
  const x=fixture();x.listeners.get('document:keydown')(x.event('KeyS'));
  assert.equal(x.f.keys.size,0);assert.equal(x.calls.length,0,'Original aircraft key listener receives the event');
  for(let i=0;i<20;i++)x.timers[0]();assert.deepEqual(x.calls,Array(20).fill('transport'));
  x.listeners.get('document:keyup')(x.event('KeyS'));assert.equal(x.calls.length,20);
});

test('native blur/cancel delegates release to the original pilot controls and closed sessions stop transport',()=>{
  const x=fixture();x.listeners.get('document:keydown')(x.event('KeyW','INPUT'));assert.equal(x.calls.length,0);
  x.listeners.get('window:blur')();assert.deepEqual(x.calls,['clear original controls']);
  x.f.active=false;x.timers[0]();assert.equal(x.calls.length,1);
});

test('deployment and custom editor leave original aircraft keys untouched and ground AI never produces player input',()=>{
  const x=fixture();x.f.deploymentVisible=true;x.listeners.get('document:keydown')(x.event('KeyS'));assert.equal(x.calls.length,0);
  x.f.deploymentVisible=false;x.editor.hidden=false;x.listeners.get('document:keydown')(x.event('KeyS'));assert.equal(x.calls.length,0);
  x.editor.hidden=true;delete x.unit.aircraft;for(let i=0;i<10;i++)x.timers[0]();assert.equal(x.calls.length,0);
});
