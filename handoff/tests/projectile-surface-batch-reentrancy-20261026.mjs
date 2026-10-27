// Reuse the existing actual-model/WASM fixture without registering its tests.
// Only the batch candidate changes between RED and GREEN. No mock hit geometry.
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

const fixtureURL=new URL('./projectile-surface-batch-20261026.mjs',import.meta.url);
const fixtureSource=fs.readFileSync(fixtureURL,'utf8');
const boundary=fixtureSource.indexOf('\ntest(');
assert.ok(boundary>0,'The real fixture must end before its first registered test');
const fixturePrefix=fixtureSource.slice(0,boundary).replace(/^import .*;\r?$/gm,'').replaceAll('import.meta.url','fixtureURL');
const currentHelper=fs.readFileSync(new URL('../tools/projectile_surface_batch.js',import.meta.url),'utf8');
const unsafePath=process.env.TF_PROJECTILE_BATCH_UNSAFE_HELPER;
const candidatePatcher=source=>{
  const patched=patchProjectileSurfaceBatch(source);
  if(!unsafePath)return patched;
  assert.equal(patched.split(currentHelper).length-1,1,'Exactly the batch helper changes for the unsafe comparison');
  return patched.replace(currentHelper,fs.readFileSync(unsafePath,'utf8'));
};
const validationTemp='D:/TankForge-validation/projectile-batch-reentrancy/temp';
fs.mkdirSync(validationTemp,{recursive:true});
const fixture=new Function('patchProjectileSurfaceBatch','fs','os','path','vm','spawnSync','fileURLToPath','test','assert','loadData','rendererSink','fixtureURL',
  fixturePrefix+'\nreturn {actual,data,suite,batch,query,setFold,point};')(candidatePatcher,fs,{...os,tmpdir:()=>validationTemp},path,vm,spawnSync,fileURLToPath,test,assert,loadData,rendererSink,fixtureURL);
const {actual,suite,batch,query,setFold,point}=fixture;
assert.ok(actual.batch,'The real candidate batch must be installed');

function initializePose(a){
  actual.Enemy.prototype.poseGuns.call({model:a.model,loadout:a.loadout,turretYaw:0,alive:true,gunPitch:[]});
  assert.ok(Number.isSafeInteger(a.model.poseSerial),'Actual Enemy pose owner supplies the cache serial');
}
function openWithoutTracing(s,a){
  // This is the actual public model/combat fold path. surfaceOwner.trace poses
  // its matrices when next queried; calling pose here would mask the barrier.
  a.model.setFold(1);a.model.root.update();s.combat.setFold(a.key,1);
}
function expandingPanelRay(s,a){
  setFold(s,a,0);initializePose(a);
  query(s,a,[50,100,-20],[50,100,20]);
  assert.equal(query(s,a,[50,100,-20],[50,100,20]).boundsCulled,true,'Initialize and fully verify the real closed exact bounds');
  assert.equal(a.record.surfaceCollisionBounds.initialized,true);
  const closed={lo:Array.from(a.record.surfaceCollisionBounds.lo),hi:Array.from(a.record.surfaceCollisionBounds.hi)};
  setFold(s,a,1);
  for(const buffer of a.record.buffers.filter(b=>b.path.includes('hinged_flap'))){
    const p=new Float32Array(buffer.words.buffer,buffer.words.byteOffset,buffer.words.length);
    for(let t=0;t<p.length;t+=9){
      const vertices=[0,1,2].map(k=>point(buffer.node.world,Array.from(p.subarray(t+k*3,t+k*3+3))));
      const center=[0,1,2].map(k=>vertices.reduce((v,p)=>v+p[k],0)/3);
      const outside=center.some((v,k)=>v<closed.lo[k]-.04||v>closed.hi[k]+.04);
      if(!outside)continue;
      const u=vertices[1].map((v,k)=>v-vertices[0][k]),v=vertices[2].map((v,k)=>v-vertices[0][k]);
      const normal=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],length=Math.hypot(...normal);
      if(!Number.isFinite(length)||length<1e-8)continue;
      const start=center.map((v,k)=>v+normal[k]/length*.02),end=center.map((v,k)=>v-normal[k]/length*.02);
      const exact=query(s,a,start,end);
      if(exact.ready&&exact.contact?.meshId==='mesh:'+buffer.path){
        const result={start,end,meshId:exact.contact.meshId,closed,center};
        setFold(s,a,0);
        assert.equal(query(s,a,start,end).contact,null,'The expanded panel ray is empty when closed');
        return result;
      }
    }
  }
  throw Error(a.id+': no actual open flap triangle outside its closed exact bounds');
}
function actors(){
  const s=suite(),a=s.create('de_flakpz38t',0,'reentrant-fold-a'),b=s.create('de_rso_pak40',0,'diagnostic-b');
  initializePose(a);initializePose(b);const ray=expandingPanelRay(s,a);
  query(s,b,[50,100,-20],[50,100,20]);
  return {s,a,b,ray};
}
const nextQuery=(s,a,ray)=>actual.surfaceCollisionQuery(s.combat,a.key,ray.start,ray.end,78);
function assertExpandedContact(result,ray){
  assert.equal(result?.ready,true,'Reentrant exact query is ready');
  assert.equal(result?.contact?.meshId,ray.meshId,'Reentrant callback must hit the real expanded panel outside the old AABB: '+JSON.stringify(result));
  assert.notEqual(result?.boundsCulled,true,'A stale closed AABB must never hide the expanded panel');
}

test('unavailable diagnostic reentry invalidates every cached actor before callbacks',()=>{
  const {s,a,b,ray}=actors();try{
    let reentrant,callbacks=0;
    s.combat.onSurfaceUnavailable=event=>{
      assert.equal(event.key,b.key);callbacks++;
      const before={serial:a.model.poseSerial,revision:a.record.revision};
      openWithoutTracing(s,a);
      assert.equal(a.model.poseSerial,before.serial,'Public fold mutation has not run the Enemy pose owner');
      assert.equal(a.record.revision,before.revision,'Exact owner has not yet observed changed matrices');
      reentrant=nextQuery(s,a,ray);
    };
    batch(s,()=>{
      assert.equal(query(s,a,[50,100,-20],[50,100,20]).boundsCulled,true);
      b.record.available=false;b.record.registrationFailed=true;
      assert.equal(query(s,b,[50,100,-20],[50,100,20]).ready,false);
    });
    assert.equal(callbacks,1);assertExpandedContact(reentrant,ray);
  }finally{s.dispose();}
});

test('bounds-only recovery reentry invalidates every cached actor before callbacks',()=>{
  const {s,a,b,ray}=actors();try{
    let reentrant,callbacks=0;
    s.combat.onSurfaceCollisionRecovered=event=>{
      assert.equal(event.key,b.key);callbacks++;
      openWithoutTracing(s,a);reentrant=nextQuery(s,a,ray);
    };
    batch(s,()=>{
      assert.equal(query(s,a,[50,100,-20],[50,100,20]).boundsCulled,true);
      assert.equal(query(s,b,[50,100,-20],[50,100,20]).boundsCulled,true);
      (s.combat.surfaceCollisionErrors ||= new Map()).set(b.key,{key:b.key,reason:'prior-unavailability'});
      assert.equal(query(s,b,[50,100,-20],[50,100,20]).boundsCulled,true);
    });
    assert.equal(callbacks,1);assertExpandedContact(reentrant,ray);
  }finally{s.dispose();}
});

test('nested synchronous scopes and a throwing phase cannot leak stale snapshots',()=>{
  const {s,a,ray}=actors();try{
    batch(s,()=>{
      query(s,a,[50,100,-20],[50,100,20]);
      batch(s,()=>openWithoutTracing(s,a));
      assertExpandedContact(nextQuery(s,a,ray),ray);
    });
    setFold(s,a,0);
    assert.throws(()=>batch(s,()=>{
      query(s,a,[50,100,-20],[50,100,20]);
      openWithoutTracing(s,a);throw Error('synthetic phase exit');
    }),/synthetic phase exit/);
    assertExpandedContact(nextQuery(s,a,ray),ray);
  }finally{s.dispose();}
});

test('source-unregistered actors cannot repeatedly invalidate verified actors in the same RANGE phase',()=>{
  const s=suite();try{
    const a=s.create('de_flakpz38t');initializePose(a);query(s,a,[50,100,-20],[50,100,20]);query(s,a,[50,100,-20],[50,100,20]);
    assert.equal(s.combat.surfaceOwner.actors.has('actual-source-unregistered-spec'),false);
    let updates=0,diagnostics=0;const update=a.model.root.update;a.model.root.update=function(...args){updates++;return Reflect.apply(update,this,args);};
    s.combat.onSurfaceUnavailable=()=>diagnostics++;s.combat.onSurfaceCollisionRecovered=()=>diagnostics++;
    batch(s,()=>{for(let i=0;i<300;i++){
      assert.equal(query(s,a,[50,100,-20],[50,100,20]).boundsCulled,true);
      const missing=actual.surfaceCollisionQuery(s.combat,'actual-source-unregistered-spec',[50,100,-20],[50,100,20],77);
      assert.equal(missing.handled,false);assert.equal(missing.ready,false);
    }});
    assert.equal(diagnostics,0,'The actual unregistered branch has no callbacks or mutations');
    assert.ok(updates<=2,'Unregistered source actors must not clear other cached exact-model bounds: '+updates);
  }finally{s.dispose();}
});
