import {installCurrentPresentation} from './fixtures/frontline-current-presentation.mjs';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const ordnanceApp=fs.readFileSync(new URL('../bundle/app.js.html',import.meta.url),'utf8');
const ordnanceDefs=JSON.parse(fs.readFileSync(new URL('../../data/aircraft/frontline.json',import.meta.url),'utf8')).storeDefinitions;
const ordnancePrelude=ordnanceApp.slice(ordnanceApp.indexOf('  function m4()'),ordnanceApp.indexOf('  // client/web/src/game/relief.js'))+ordnanceApp.slice(ordnanceApp.indexOf('  var aqMul = '),ordnanceApp.indexOf('  var AIRCRAFT_KEYS'))+fs.readFileSync(new URL('../tools/frontline_ordnance_visual.js',import.meta.url),'utf8');
function installOrdnance(context){
  context.ordnanceStoreDefs=ordnanceDefs;
  vm.runInContext(ordnancePrelude+`f.ordnancePresentation=createFrontlineOrdnanceVisual({Node,storeDefs:ordnanceStoreDefs,storeMesh:id=>{throw Error('Unexpected ordnance geometry in this isolated fixture: '+id);},quatMatrix,aqLook});`,context);
}

const source=fs.readFileSync(new URL('../tools/frontline_client.js',import.meta.url),'utf8');
const app=fs.readFileSync(new URL('../bundle/app.js.html',import.meta.url),'utf8');
const frameStart=source.indexOf('      function frame(dt){');
const frameEnd=source.indexOf('      return Object.assign(f,',frameStart);
const hudStart=app.indexOf('    toast(text, seconds = 4) {');
const hudEnd=app.indexOf('    resize(w, h) {',hudStart);
assert.ok(frameStart>=0&&frameEnd>frameStart&&hudStart>=0&&hudEnd>hudStart);

function fixture({ready=true,mode='battle'}={}){
  const calls={ticks:[],pilot:0,draws:0,compass:0};
  const noop=()=>{},plane={heading:0,state:{camera:0}},model={plane,pose:noop};
  const G4={mode,time:10,air:{plane},veh:{step(){throw Error('Shared HUD must not advance local tank physics');}}};
  const f={active:true,map:{id:'taiwan'},focus:[0,0,0],follow:null,keys:new Set(),room:{},yaw:0,pitch:0,distance:50,
    renderStats:{drawDt:0,lastDrawAt:undefined,max:{},frames:0},airModels:new Map([['pilot',model]]),models:new Map(),
    root:{update:noop,collect:noop},facilityPresentation:{ready:false},establishedFlight:{
      step(){calls.pilot++;},view:()=>({camPos:[0,10,0],fwd:[0,0,1],fovY:1}),draw:noop}};
  const c=vm.createContext({G4,f,calls,renderer:{resize:()=>[100,100],advance:noop,render(){calls.draws++;},drawCalls:0},
    controlled:()=>({aircraft:'f15c'}),controlledAirModel:()=>model,allUnits:()=>[],
    renderGate:{ready:()=>ready,submitted:noop},renderScale:{sample:()=>null},performance:{now:()=>100},updateModels:noop,rebuildTerrain:noop,
    lookAtLH:()=>({view:[],forward:[0,0,1],right:[1,0,0],up:[0,1,0]}),mul:()=>[],perspective:()=>[],
    sound:{},fx:{update:noop,build:noop},reticle:{},canvas:{clientWidth:1000},drawMap:noop,refreshUi:noop,height:()=>0,
    advanceCombat(){throw Error('Shared HUD must not advance local combat');},
    stepAirWeapons(){throw Error('Shared HUD must not spend local aircraft resources');}});
  installOrdnance(c);installCurrentPresentation(c);
  // Use the real shared HUD timers, including the timer-to-DOM expiry behavior.
  vm.runInContext('globalThis.hud=new class {\n'+app.slice(hudStart,hudEnd)+'\n};',c);
  const hud=c.hud;
  hud.el={toast:{dataset:{}},hint:{dataset:{show:'1'}}};hud.hitTimer=0;hud.hintTimer=.1;
  hud.overlay={style:{visibility:'hidden'}};hud.resize=hud.clear=noop;
  hud.drawCompass=()=>{calls.compass++;};hud.drawLabels=noop;
  const tick=hud.tick.bind(hud);hud.tick=dt=>{calls.ticks.push(dt);tick(dt);};
  hud.toast('Native battle message',.1);
  vm.runInContext(source.slice(frameStart,frameEnd),c);
  return {G4,f,hud,calls,frame:c.frame};
}

test('native battle restores the shared HUD hidden by the original garage and expires real HUD messages',()=>{
  const x=fixture();x.frame(.05);x.frame(.05);
  assert.equal(x.hud.overlay.style.visibility,'visible');
  assert.equal(x.hud.el.toast.dataset.show,'0');assert.equal(x.hud.el.hint.dataset.show,'0');
  assert.deepEqual(x.calls.ticks,[.05,.05]);assert.equal(x.calls.draws,2);assert.equal(x.calls.compass,2);
  assert.ok(Math.abs(x.G4.time-10.1)<1e-10,'Game time advances once per original frame');
});

test('GPU-busy native frames tick shared HUD once without accumulating the skipped time a second time',()=>{
  const x=fixture({ready:false});x.frame(.05);x.frame(.05);
  assert.deepEqual(x.calls.ticks,[.05,.05]);assert.equal(x.hud.el.toast.dataset.show,'0');
  assert.equal(x.hud.overlay.style.visibility,'visible');assert.equal(x.calls.pilot,2);assert.equal(x.calls.draws,0);
  assert.ok(Math.abs(x.f.renderStats.drawDt-.1)<1e-10);assert.ok(Math.abs(x.G4.time-10.1)<1e-10);
});

test('the native world frame cannot reveal the garage shared HUD outside battle',()=>{
  const x=fixture({ready:false,mode:'garage'});x.frame(.05);
  assert.equal(x.hud.overlay.style.visibility,'hidden');assert.equal(x.hud.el.toast.dataset.show,'1');
  assert.equal(x.calls.ticks.length,0);
});
