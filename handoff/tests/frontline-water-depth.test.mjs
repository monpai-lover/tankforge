import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createAircraftClipReject} from '../tools/aircraft_performance/aircraft-render-cull.mjs';
const app=fs.readFileSync(new URL('../bundle/app.js.html',import.meta.url),'utf8');
const first=app.indexOf('    _litNodes(nodes, cam) {'),last=app.indexOf('    _insetSamples()',first);
assert.ok(first>=0&&last>first);
test('actual renderer writes canonical water depth before transparent legacy water and restores depth/blend state',()=>{
 let depth=true,blend=false;const draws=[],calls=[];
 const gl={BLEND:1,SRC_ALPHA:2,ONE_MINUS_SRC_ALPHA:3,ZERO:4,ONE:5,
  enable(v){assert.equal(v,this.BLEND);blend=true},disable(v){assert.equal(v,this.BLEND);blend=false},
  blendFuncSeparate(...args){calls.push(args)},depthMask(v){depth=v}};
 const c=vm.createContext({STRIDE:13,createAircraftClipReject});vm.runInContext('globalThis.draw=({'+app.slice(first,last)+'})._litNodes;',c);
 const renderer={gl,_drawLit:n=>draws.push({name:n.name,depth,blend})};
 const matrix=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
 const node=(name,kind,z=0)=>({name,kind,world:matrix,mesh:{},replayCenter:[0,0,z]});
 c.draw.call(renderer,[node('legacy-water',7,20),node('canonical-water',22,10),node('canonical-land',20),node('canopy',17,30)],{forward:[0,0,1]});
 assert.deepEqual(draws,[{name:'canonical-water',depth:true,blend:false},{name:'canonical-land',depth:true,blend:false},
  {name:'canopy',depth:false,blend:true},{name:'legacy-water',depth:false,blend:true}]);
 assert.equal(depth,true);assert.equal(blend,false);assert.equal(calls.length,1);
 // A pure registered-water scene also writes depth; no seabed is required to
 // prevent the postprocess from treating every water pixel as infinite sky.
 draws.length=0;c.draw.call(renderer,[node('canonical-water',22)],{forward:[0,0,1]});
 assert.deepEqual(draws,[{name:'canonical-water',depth:true,blend:false}]);
});
