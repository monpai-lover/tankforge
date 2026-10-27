// Real uploaded fleet geometry + DamageVisuals owner. The comparison changes
// only the readiness helper in an in-memory candidate, never the source app.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadData} from '../../client/web/tools/load-data.mjs';
import {rendererSink} from '../../client/web/tools/hit-mesh-capture.mjs';
import {patchProjectileSurfaceBatch} from '../tools/patch_projectile_surface_batch.mjs';

const fixtureURL=new URL('./projectile-surface-batch-20261026.mjs',import.meta.url),text=fs.readFileSync(fixtureURL,'utf8');
const boundary=text.indexOf('\ntest(');assert.ok(boundary>0,'Real fixture must precede registered tests');
const appHook="const app=path.join(root,'handoff/bundle/app.js.html')";
assert.equal(text.slice(0,boundary).split(appHook).length-1,1,'One real fixture app input');
const prefix=text.slice(0,boundary).replace(/^import .*;\r?$/gm,'').replaceAll('import.meta.url','fixtureURL')
  .replace(appHook,"const app=process.env.TF_DAMAGE_VISUAL_BASE_APP||path.join(root,'handoff/bundle/app.js.html')");
const helperPath=process.env.TF_DAMAGE_VISUAL_READINESS_HELPER||new URL('../tools/surface_collision_readiness.js',import.meta.url);
const readiness=fs.readFileSync(helperPath,'utf8');
function candidate(source){
  let value=patchProjectileSurfaceBatch(source);
  const start='// BEGIN SURFACE COLLISION READINESS',end='// END SURFACE COLLISION READINESS',a=value.indexOf(start),b=value.indexOf(end,a);
  assert.ok(a>=0&&b>a,'One complete actual readiness owner required');
  assert.equal(value.split(start).length-1,1);assert.equal(value.split(end).length-1,1);
  return value.slice(0,a)+start+'\n'+readiness+'\n'+value.slice(b);
}
const validationTemp=process.platform==='win32'?'D:/TankForge-validation/surface-damage-visual-membership/temp':os.tmpdir();fs.mkdirSync(validationTemp,{recursive:true});
const {actual,suite,authoredRay,batch}=new Function('patchProjectileSurfaceBatch','fs','os','path','vm','spawnSync','fileURLToPath','test','assert','loadData','rendererSink','fixtureURL',
  prefix+'\nreturn {actual,suite,authoredRay,batch};')(candidate,fs,{...os,tmpdir:()=>validationTemp},path,vm,spawnSync,fileURLToPath,test,assert,loadData,rendererSink,fixtureURL);

function prepared(){
  const s=suite(),a=s.create('de_flakpz38t');
  actual.Enemy.prototype.poseGuns.call({model:a.model,loadout:a.loadout,turretYaw:0,alive:true,gunPitch:[]});
  let tick=100;
  const q=(start=[50,100,-20],end=[50,100,20])=>actual.surfaceCollisionQuery(s.combat,a.key,start,end,tick++);
  const ray=authoredRay(a),hull=q(ray.start,ray.end);assert.ok(hull.contact,'Real authored hull triangle is hittable');
  assert.equal(q().boundsCulled,true,'Closed physical model has initialized verified bounds');
  return {s,a,q,ray,hullMeshId:hull.contact.meshId};
}
function prime(s,a){
  actual.damageVisualsFor(s.renderer,a.model,a.fresh.caps,a.fresh.state,a.bundle.modules);
  const entry=[...a.model.damageVisuals.guns.values()].find(e=>e?.root?.damageVisual&&e?.barrel);
  assert.ok(entry,'Actual DamageVisuals.prime creates an uploaded broken-barrel mirror');
  let parent;
  const walk=n=>{if(n.children.includes(entry.root))parent=n;for(const child of n.children)walk(child);};walk(a.model.root);
  assert.ok(parent);assert.ok(parent.children.indexOf(entry.root)>parent.children.indexOf(entry.barrel),'Real mirror is appended after physical barrel');
  return {entry,parent};
}

test('actual damage mirrors appended after sealing are excluded as complete truthy visual subtrees',()=>{
  const {s,a,q,ray,hullMeshId}=prepared();try{
    const {entry}=prime(s,a);entry.root.damageVisual='presentation';
    assert.equal(q().boundsCulled,true,'Appending a real visual mirror preserves the exact physical topology');
    const physical=q(ray.start,ray.end);assert.equal(physical.contact?.meshId,hullMeshId,'The same physical hull remains hittable');
    // Visual descendants are intentionally outside nodesOf, including their
    // visibility, name, membership and local pose. No physical node is changed.
    entry.root.name='reviewed_visual_only';entry.root.visible=true;entry.root.pos=[10000,10000,10000];
    const extra=new entry.root.constructor('visual_child');extra.mesh=a.record.buffers[0].mesh;entry.root.children.push(extra);
    let updates=0;const update=a.model.root.update;a.model.root.update=function(...args){updates++;return Reflect.apply(update,this,args);};
    const results=[];batch(s,()=>{for(let i=0;i<300;i++)results.push(q());});
    assert.ok(results.every(r=>r.ready&&r.boundsCulled&&r.contact===null));assert.ok(updates<=2,'Actual visual-only subtrees must not force repeated full graph validation: '+updates);
    entry.root.children.pop();
  }finally{s.dispose();}
});

test('moving a visual mirror before a physical sibling invalidates the original raw ordinal',()=>{
  const {s,a,q}=prepared();try{
    const {entry,parent}=prime(s,a);assert.equal(q().boundsCulled,true);
    const from=parent.children.indexOf(entry.root);parent.children.splice(from,1);parent.children.unshift(entry.root);
    const result=q();assert.notEqual(result.boundsCulled,true,'Filtering visual children must not erase physical ordinal shifts');assert.equal(result.ready,false,'Actual exact owner rejects changed physicalNodeKey membership');
  }finally{s.dispose();}
});

test('an appended unregistered nonvisual instance of real uploaded geometry remains unavailable',()=>{
  const {s,a,q}=prepared();let extra;try{
    prime(s,a);assert.equal(q().boundsCulled,true);
    extra=new a.model.root.constructor('unknown_physical_instance');extra.mesh=a.record.buffers[0].mesh;a.model.root.children.push(extra);
    const result=q();assert.notEqual(result.boundsCulled,true);assert.equal(result.ready,false);assert.equal(result.error.code,'surface_collision_unavailable');
  }finally{if(extra)a.model.root.children.splice(a.model.root.children.indexOf(extra),1);s.dispose();}
});

test('a registered physical mesh becoming a visual subtree cannot preserve old bounds authority',()=>{
  const {s,a,q}=prepared();const node=a.record.buffers[0].node,old=node.damageVisual;try{
    prime(s,a);assert.equal(q().boundsCulled,true);node.damageVisual='newly-hidden-physical';
    const result=q();assert.notEqual(result.boundsCulled,true);assert.equal(result.ready,false);assert.equal(result.error.code,'surface_collision_unavailable');
  }finally{node.damageVisual=old;s.dispose();}
});
