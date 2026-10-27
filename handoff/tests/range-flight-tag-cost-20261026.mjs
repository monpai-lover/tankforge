import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {loadData} from '../../client/web/tools/load-data.mjs';
import {patchRangeTargetVisibility} from '../tools/patch_range_target_visibility.mjs';
const source=fs.readFileSync(new URL('../bundle/app.js.html',import.meta.url),'utf8');
const end=source.indexOf('  // client/web/src/main.js'),shared=vm.createContext({console,atob,btoa,performance,TextEncoder,TextDecoder,structuredClone});
vm.runInContext(source.replace(/^<script>/,'').slice(0,end-8)+'globalThis.runtime={rangeVehicleTargets,Terrain,humpLift,groundRay,project,perspective,lookAt,mul,visibleGameplayMarker,isGameplayAlly};})();',shared);
const actual=shared.runtime,data=loadData();
function functionSource(text){const a=text.indexOf('    function drawVehicleTags('),b=text.indexOf('    function hitEnemy(',a);assert.ok(a>=0&&b>a);return text.slice(a,b);}
function execute(text,{eye,target,firstSeen=true,forceOccluded=false}){
 const terrain=new actual.Terrain(data.terrains,actual.humpLift);let heightCalls=0,losCalls=0,tags;
 const enemies=actual.rangeVehicleTargets().map((e,i)=>({...e,rangeTarget:true,remote:false,rangeM:e.rangeM,name:e.id,alive:true,seen:firstSeen?undefined:false,box:{top:2},veh:{body:{origin:()=>[e.x,terrain.height(e.x,e.z),e.z]}}}));
 const context=vm.createContext({G4:{mode:'battle',map:null,online:null,mapTick:0,s:{x:0,z:0},enemies,gameplayMode:'casual'},Math,project:actual.project,visibleGameplayMarker:actual.visibleGameplayMarker,isGameplayAlly:actual.isGameplayAlly,groundRay(...args){losCalls++;return actual.groundRay(...args);},surfaceAt(x,z){heightCalls++;return terrain.height(x,z);},buildingHit:()=>forceOccluded?{}:null,hud:{drawNameTags(value){tags=JSON.parse(JSON.stringify(value));}}});
 vm.runInContext(functionSource(text),context);
 const matrix=actual.mul(actual.perspective(Math.PI/3,16/9,.1,50000),actual.lookAt(eye,target));
 const before=performance.now();context.drawVehicleTags(eye,matrix,1280,720);const elapsed=performance.now()-before;
 return {tags,heightCalls,losCalls,elapsed};
}
const scenes=[{eye:[0,30,100],target:[0,2000,1500]},{eye:[0,100,500],target:[0,100,1500]},{eye:[0,500,1000],target:[0,0,1800]},{eye:[300,800,800],target:[-400,0,1500]},{eye:[0,4,-20],target:[0,2,900]}];
const candidate=process.env.TF_RANGE_BASELINE==='1'?source:patchRangeTargetVisibility(source);
test('offscreen range targets perform no terrain/obstacle visibility queries',()=>{const x=execute(candidate,scenes[0]);assert.equal(x.tags.length,0);assert.equal(x.losCalls,0);assert.equal(x.heightCalls,0);});
test('actual range camera paths preserve every visible tag and occlusion result',()=>{for(const scene of scenes)for(const forceOccluded of [false,true]){const a=execute(source,{...scene,forceOccluded}),b=execute(candidate,{...scene,forceOccluded});assert.deepEqual(b.tags,a.tags);assert.ok(b.losCalls<=a.losCalls);assert.ok(b.heightCalls<=a.heightCalls);}});
test('candidate is idempotent and rejects an unknown visibility projection shape',()=>{assert.equal(patchRangeTargetVisibility(candidate),candidate);assert.throws(()=>patchRangeTargetVisibility(source.replace('const pr = project(viewProj, p);','const pr = unknownProjection(viewProj, p);')),/projection/);});
if(process.env.TF_RANGE_TAG_RECEIPT){const rows=scenes.map(scene=>({scene,baseline:execute(source,scene),candidate:execute(candidate,scene)}));fs.writeFileSync(process.env.TF_RANGE_TAG_RECEIPT,JSON.stringify({scope:'Actual source range targets, projection and terrain LOS; CPU presentation only, not browser FPS or GPU.',rows},null,2));}
