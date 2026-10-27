import {modelUpgradePrelude} from './fixture-model-upgrade.mjs';
import fs from 'node:fs';
import vm from 'node:vm';
import zlib from 'node:zlib';
import test from 'node:test';
import assert from 'node:assert/strict';
import {models,source} from './jet-fixture.mjs';

async function fixture(id){
  const canvas={getContext:()=>new Proxy({},{get:(o,k)=>k in o?o[k]:(()=>{}),set:(o,k,v)=>(o[k]=v,true)})};
  const c=vm.createContext({performance,atob,document:{createElement:()=>canvas},inflate:async b=>{const r=zlib.inflateSync(Buffer.from(b,'base64'));return r.buffer.slice(r.byteOffset,r.byteOffset+r.byteLength);}});
  const a=source.indexOf('  // the C flight core'),b=source.indexOf('  // client/web/src/main.js',a);
  vm.runInContext(modelUpgradePrelude(source)+source.slice(source.indexOf('  function m4()'),source.indexOf('  // client/web/src/game/relief.js'))+source.slice(source.lastIndexOf('\n',a)+1,b)+fs.readFileSync(new URL('../tools/frontline_aircraft_visual.js',import.meta.url),'utf8'),c);
  vm.runInContext(source.slice(source.indexOf('  function registerAircraftFrame('),source.indexOf('  /** The reference types re-created'))+source.slice(source.indexOf('  function imageTexture('),source.indexOf('  function partMesh(')),c);
  await c.decodeAircraftModels({[id]:models[id]});
  let uploaded=0,freed=0;
  const renderer={mesh(data){uploaded++;return{count:data.length/13,_src:{data}};},texture:()=>({}),freeTexture(){},freeMesh(){freed++;}};
  const model=c.createFrontlineAircraftVisual(renderer,id);
  return {c,model,p:model.plane,get uploaded(){return uploaded},get freed(){return freed}};
}

test('all supplied native interiors and Me262 variants upload actual module triangles/material batches and suppress represented box overlays',async()=>{
  const ids=Object.keys(models).filter(id=>models[id].parts.some(p=>p.group==='internal'));
  assert.deepEqual(ids.sort(),['f104g','f86f','hunter6','me262','me262a2a','me262u4','mig15','mig29','mirage3e']);
  for(const id of ids){
    const f=await fixture(id),p=f.p,expected=models[id].parts.filter(q=>['internal','crew'].includes(q.group)&&q.mover==null).reduce((n,q)=>n+q.triangles,0);
    assert.ok(p.internalNode&&p.sourceInternalNodes.length>0,id);
    assert.equal(p.sourceInternalNodes.reduce((n,q)=>n+q.mesh.count/3,0),expected,id+' exact source triangles');
    for(const node of p.sourceInternalNodes){
      assert.equal(node.mesh._src.data,node.sourceModule.data,id+' original immutable uploaded data');
      assert.equal(node.kind,node.sourceModule.textured?18:3,id+' source material path');
      assert.ok(node.sourceModule.sourceParts.length>0);
    }
    assert.ok(p.sourceModuleParts.size>0,id+' registered accepted-family visual aliases');
    for(const q of p.partNodes)assert.ok(!p.sourceModuleParts.has(q.part.id),id+' no duplicate coarse box');
    const retained=p.partNodes.map(n=>n.part.id);
    p.api.configure_airframe=()=>{};p.api.configure=()=>{};p.api.configure_envelope=()=>{};p.api.spawn=()=>{};
    p.spawn(0,1000,0,0,150,false);
    assert.deepEqual(p.partNodes.map(n=>n.part.id),retained,id+' respawn preserves filtered part identities');
    for(const n of p.partNodes)assert.equal(n.part,p.damage.by[n.part.id],id+' respawn binds current accepted damage');
    p.setXray(true);assert.ok(p.detailedInterior?.replacesInternal,id+' accepted detailed interior replaces the old overlay');assert.equal(p.internalNode.visible,false);assert.ok(p.detailedInterior.parts.some(part=>part.node.visible),id+' actual detailed modules are drawn');
    p.setXray(false);assert.equal(p.internalNode.visible,false);
    const count=f.uploaded;f.model.dispose();assert.equal(f.freed,count,id+' all buffers released once');
  }
});

test('accepted native damage tints the original engine mesh, preserves geometry and hides only detached source modules',async()=>{
  const f=await fixture('f104g'),p=f.p;
  const node=p.sourceInternalNodes.find(n=>n.damageIds.some(id=>id==='engine'||id.startsWith('engine_')));assert.ok(node);
  const id=node.damageIds[0],part=p.damage.by[id],data=Array.from(node.mesh._src.data),originalMesh=node.mesh;
  p.setXray(true);p.damage.harm(id,part.max*.8,false,()=>1);p.applyDamage();
  assert.ok(node.highlight?.[3]>0);assert.equal(node.mesh,originalMesh);assert.deepEqual(Array.from(node.mesh._src.data),data);
  p.setXray(false);assert.equal(node.highlight,null);
  p.damage._detach(part);p.setXray(true);assert.equal(node.visible,false);
  assert.ok(p.sourceInternalNodes.some(n=>n!==node&&n.visible),'other source modules retain their own state');
  f.model.dispose();
});

test('an imported airframe with no supplied internal geometry retains its explicit procedural fallback',async()=>{
  const f=await fixture('f15c');
  assert.equal(f.p.sourceInternalNodes.length,0);assert.ok(f.p.internalNode?.mesh?.count>0);
  assert.ok(f.p.partNodes.some(n=>n.part.id==='ammo'));
  f.model.dispose();
});
