import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const helperUrl=new URL('../tools/frontline_ordnance_visual.js',import.meta.url);
const code=fs.existsSync(helperUrl)?fs.readFileSync(helperUrl,'utf8'):'';
class Node{
  constructor(name=''){this.name=name;this.children=[];this.visible=true;this.local=null;}
  add(child){this.children.push(child);return child;}
}
const defs={aim9:{kind:'aam',burn:2,len:3,d:.13},r60:{kind:'aam',burn:1,sustain:[3,100],len:2,d:.12},meteor:{kind:'aam',burn:2,ramjet:{speed:1000,time:30,k:.2},len:3.6,d:.18},rocket:{kind:'rocket',burn:1,len:1.2,d:.08},bomb:{kind:'bomb',burn:9,len:2,d:.3},child:{kind:'bomb',len:.3,d:.08}};
const row=(id=1,patch={})=>({shot_id:id,shooter:9,team:0,store_id:'aim9',pos:[0,100,0],velocity:[0,0,400],age:.1,phase:'ir',...patch});
function fixture(options={}){
  const context={};vm.runInNewContext(code,context);
  assert.equal(typeof context.createFrontlineOrdnanceVisual,'function','Native ordnance visual owner must exist');
  const meshes=new Map(),calls=[],particles=[],glows=[];
  const owner=context.createFrontlineOrdnanceVisual({Node,storeDefs:defs,storeMesh:id=>{calls.push(id);if(!meshes.has(id))meshes.set(id,{id,borrowed:true});return meshes.get(id);},
    aqLook:direction=>direction.slice(),quatMatrix:(pos,q)=>({pos:pos.slice(),q:q.slice()}),fx:{spawn:p=>particles.push(p),glow:(...args)=>glows.push(args)},...options});
  return {owner,meshes,calls,particles,glows};
}
test('accepted native rows create borrowed store meshes and inert visual nodes only',()=>{
  const f=fixture(),input=Object.freeze([Object.freeze({...row(),pos:Object.freeze([1,100,2]),velocity:Object.freeze([0,0,400])})]);
  assert.equal(f.owner.accept(input,{battle:1,tick:1}),true);f.owner.step(0);
  assert.equal(f.owner.root.children.length,1);const node=f.owner.root.children[0];
  assert.equal(node.mesh,f.meshes.get('aim9'));assert.equal(node.hitboxDisabled,true);assert.equal(node.castShadow,false);
  assert.deepEqual(Array.from(node.local.pos),[1,100,2]);assert.deepEqual(f.calls,['aim9']);assert.equal(input[0].pos[0],1);
});
test('a full accepted list removes absent missiles immediately and never frees shared mesh ownership',()=>{
  const f=fixture();f.owner.accept([row(1),row(2)],{battle:1,tick:1});const mesh=f.owner.root.children[0].mesh;
  f.owner.accept([row(2)],{battle:1,tick:2});assert.equal(f.owner.root.children.length,1);
  f.owner.accept([],{battle:1,tick:3});assert.equal(f.owner.root.children.length,0);assert.equal(mesh.borrowed,true);
  f.owner.dispose();assert.equal(f.owner.accept([row(3)],{battle:1,tick:4}),false);assert.equal(f.owner.root.children.length,0);
});
test('interpolation is bounded between accepted positions and cannot extrapolate or mutate host rows',()=>{
  const f=fixture(),a=row(1,{pos:[0,100,0],age:1}),b=row(1,{pos:[100,120,0],age:1.1});
  f.owner.accept([a],{battle:1,tick:1});f.owner.step(.01);f.owner.accept([b],{battle:1,tick:3});f.owner.step(.05);
  const pos=f.owner.root.children[0].local.pos;assert.ok(pos[0]>0&&pos[0]<100);assert.ok(pos[1]>100&&pos[1]<120);
  f.owner.step(20);assert.deepEqual(Array.from(f.owner.root.children[0].local.pos),[100,120,0]);f.owner.step(20);assert.deepEqual(Array.from(f.owner.root.children[0].local.pos),[100,120,0]);
  assert.deepEqual(b.pos,[100,120,0]);
});
test('stale and replayed samples cannot rewind ordnance, and battle changes clear reused shot IDs',()=>{
  const f=fixture();f.owner.accept([row(1,{pos:[10,100,0]})],{battle:4,tick:10});
  for(const meta of [{battle:4,tick:9},{battle:4,tick:10},{battle:3,tick:100}])assert.equal(f.owner.accept([row(1,{pos:[-100,100,0]})],meta),false);
  f.owner.step(1);assert.deepEqual(Array.from(f.owner.root.children[0].local.pos),[10,100,0]);
  const old=f.owner.root.children[0];f.owner.accept([row(1,{store_id:'bomb',phase:'ballistic',pos:[50,100,0]})],{battle:5,tick:1});assert.notEqual(f.owner.root.children[0],old);f.owner.step(0);assert.deepEqual(Array.from(f.owner.root.children[0].local.pos),[50,100,0]);
});
test('malformed identities and vectors fail closed without admitting coordinates',()=>{
  for(const patch of [{shot_id:0},{shot_id:1.2},{shooter:0},{team:3},{store_id:'__proto__'},{pos:[NaN,0,0]},{pos:[1e40,0,0]},{velocity:[0,Infinity,1]},{age:-1},{phase:'untrusted'},{powered:'yes'}]){
    const f=fixture();assert.equal(f.owner.accept([row(1,patch)],{battle:1,tick:1}),false,JSON.stringify(patch));assert.equal(f.owner.root.children.length,0);
  }
  for(const meta of [{battle:0,tick:1},{battle:1,tick:-1},{battle:1,tick:1.1}]){const f=fixture();assert.equal(f.owner.accept([row()],meta),false);}
});
test('duplicate identities, changed store ownership and unknown mesh records cannot bypass the cap',()=>{
  const f=fixture({maxEntries:3});f.owner.accept(Array.from({length:20},(_,i)=>row(i+1)),{battle:1,tick:1});assert.equal(f.owner.root.children.length,3);assert.equal(f.owner.stats.capped,17);
  assert.equal(f.owner.accept([row(1),row(1)],{battle:1,tick:2}),false);assert.equal(f.owner.root.children.length,0);
  f.owner.accept([row(1)],{battle:1,tick:3});assert.equal(f.owner.accept([row(1,{shooter:42})],{battle:1,tick:4}),false);assert.equal(f.owner.root.children.length,0);
  const unknown=fixture();assert.equal(unknown.owner.accept([row(1,{store_id:'not_installed'})],{battle:1,tick:1}),false);assert.equal(unknown.owner.root.children.length,0);
});
test('smoke follows accepted propulsion age and sustain, never bombs/cluster children or expired motors',()=>{
  const f=fixture();f.owner.accept([row(1,{age:.1}),row(2,{store_id:'bomb',phase:'ballistic'}),row(3,{store_id:'child',phase:'ballistic'}),row(4,{age:2.1}),row(5,{store_id:'r60',age:2.1}),row(6,{store_id:'rocket',phase:'ballistic',age:.2})],{battle:1,tick:1});f.owner.step(.05);
  assert.equal(f.glows.length,3);assert.ok(f.particles.length>0);assert.ok(f.particles.every(p=>p.pos[1]===100));
  const before=f.particles.length;f.owner.step(2);f.owner.step(.05);assert.equal(f.particles.length,before,'stale network data cannot smoke forever');
});
test('explicit native powered state can suppress a burning source motor and emission is globally bounded',()=>{
  const f=fixture({maxSmokePerStep:5});f.owner.accept(Array.from({length:20},(_,i)=>row(i+1,{powered:i!==0})),{battle:1,tick:1});f.owner.step(.1);assert.equal(f.glows.length,19);assert.equal(f.particles.length,5);
});
test('ramjet exhaust requires its accepted age window and a positive source speed deficit',()=>{
  const f=fixture();f.owner.accept([row(1,{store_id:'meteor',age:5,velocity:[0,0,700]}),row(2,{store_id:'meteor',age:5,velocity:[0,0,1100]}),row(3,{store_id:'meteor',age:33,velocity:[0,0,700]})],{battle:1,tick:1});f.owner.step(.05);
  assert.equal(f.glows.length,1);assert.ok(f.particles.length>0);
});
test('a newer tick cannot reuse a shot identity with a younger native age',()=>{
  const f=fixture();f.owner.accept([row(1,{age:4})],{battle:1,tick:1});assert.equal(f.owner.accept([row(1,{age:1})],{battle:1,tick:2}),false);assert.equal(f.owner.root.children.length,0);
});
test('a fresh accepted sample does not inherit the preceding slow render interval as staleness',()=>{
  const f=fixture();f.owner.accept([row(1,{age:.1})],{battle:1,tick:1});f.owner.step(1);assert.equal(f.glows.length,1);
  f.owner.step(1);assert.equal(f.glows.length,1,'unchanged sample becomes stale after its first drawing');
  f.owner.accept([row(1,{age:.2})],{battle:1,tick:2});f.owner.step(1);assert.equal(f.glows.length,2);
});
test('zero velocity and invalid render dt remain finite without running a local solver',()=>{
  const f=fixture();f.owner.accept([row(1,{velocity:[0,0,0]})],{battle:1,tick:1});for(const dt of [NaN,-1,Infinity,0,.1])f.owner.step(dt);
  const node=f.owner.root.children[0];assert.ok(node.local.pos.every(Number.isFinite));assert.ok(node.local.q.every(Number.isFinite));assert.deepEqual(Array.from(node.local.pos),[0,100,0]);
  assert.ok(!/collision|stepShot|damage\.|set_damage|airOrdnance|\.ammo\s*=/.test(code),'Visual owner must not invoke combat or a local ordnance solver');
});
test('clear resets life identity and mesh failure does not leak a node or retry every frame',()=>{
  let attempts=0;const f=fixture({storeMesh(){attempts++;throw new Error('not available');}});
  f.owner.accept([row(1)],{battle:1,tick:1});f.owner.accept([row(1)],{battle:1,tick:2});assert.equal(attempts,1);assert.equal(f.owner.root.children.length,0);
  f.owner.clear();f.owner.accept([row(1)],{battle:1,tick:1});assert.equal(attempts,2);
});
