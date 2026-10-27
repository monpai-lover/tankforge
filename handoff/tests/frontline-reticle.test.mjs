import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';

const ordnanceApp=fs.readFileSync(new URL('../bundle/app.js.html',import.meta.url),'utf8');
const ordnanceDefs=JSON.parse(fs.readFileSync(new URL('../../data/aircraft/frontline.json',import.meta.url),'utf8')).storeDefinitions;
const ordnancePrelude=ordnanceApp.slice(ordnanceApp.indexOf('  function m4()'),ordnanceApp.indexOf('  // client/web/src/game/relief.js'))+ordnanceApp.slice(ordnanceApp.indexOf('  var aqMul = '),ordnanceApp.indexOf('  var AIRCRAFT_KEYS'))+fs.readFileSync(new URL('../tools/frontline_ordnance_visual.js',import.meta.url),'utf8');
function installOrdnance(context){
  context.ordnanceStoreDefs=ordnanceDefs;
  vm.runInContext(ordnancePrelude+`f.ordnancePresentation=createFrontlineOrdnanceVisual({Node,storeDefs:ordnanceStoreDefs,storeMesh:id=>{throw Error('Unexpected ordnance geometry in this isolated fixture: '+id);},quatMatrix,aqLook});`,context);
}

const source=fs.readFileSync(new URL('../tools/frontline_client.js',import.meta.url),'utf8');
const a=source.indexOf('      function frame(dt){'),b=source.indexOf('      return Object.assign(f,',a);
assert.ok(a>=0&&b>a);

test('actual frontline frame delegates player aiming to the original aircraft HUD and never draws the removed generic plus',()=>{
  const aircraft={unit:{unit:4},aircraft:'mig21',pos:[100,1000,100]},ground={unit:{unit:2},pos:[0,0,0]};
  let current=aircraft,renders=0,poses=0,cameras=0,hudDraws=0;
  const plane={state:{camera:0},camera(){cameras++;return {camPos:[100,1000,90],fwd:[0,0,1],fovY:1,up:[0,1,0]};}};
  const item={plane,pose(){poses++;}},reticle={hidden:true};
  const f={map:{},focus:[100,1000,100],keys:new Set(),models:new Map(),renderStats:{drawDt:0,max:{},frames:0},airModels:new Map([['4',item]]),
    establishedFlight:{step(){},view(dt){return plane.camera(dt);},draw(){hudDraws++;}},root:{update(){},collect(){}},facilityPresentation:{ready:false},yaw:0,pitch:0,distance:20};
  const c=vm.createContext({f,G4:{time:0,air:{plane}},canvas:{clientWidth:800},hud:{resize(){},clear(){},drawCompass(){}},reticle,performance,renderGate:{ready:()=>true,submitted(){}},renderScale:{sample:()=>null},controlled:()=>current,allUnits:()=>[aircraft,ground],unitKey:r=>String(r?.unit),controlledAirModel:()=>item,
    updateModels(){},rebuildTerrain(){},height:()=>0,drawMap(){},refreshUi(){},
    fx:{update(){},build(){}},sound:{setListener(){}},
    renderer:{resize:()=>[800,600],advance(){},render(){renders++;}},
    lookAtLH:(_,forward,up)=>({view:[],forward,up,right:[1,0,0]}),mul:()=>[],perspective:()=>[]});
  installOrdnance(c);
  vm.runInContext(source.slice(a,b),c);
  for(const [camera,hidden] of [[0,true],[1,true],[2,true]]){
    plane.state.camera=camera;c.frame(1/60);assert.equal(reticle.hidden,hidden,`camera ${camera}`);
  }
  current=ground;c.frame(1/60);assert.equal(reticle.hidden,true,'Ground AI has no controllable aiming reticle');
  current=null;f.follow='4';plane.state.camera=1;c.frame(1/60);assert.equal(reticle.hidden,true,'Observer has no controllable aiming reticle');
  assert.equal(hudDraws,3);assert.equal(renders,5);assert.equal(poses,5);assert.equal(cameras,4);
});
