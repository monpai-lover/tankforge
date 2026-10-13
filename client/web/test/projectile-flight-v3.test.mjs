import test from 'node:test';
import assert from 'node:assert/strict';
import {loadData} from '../tools/load-data.mjs';
import {bulletShell} from '../src/game/combat.js';
import {Missiles} from '../src/game/missiles.js';
import {Node} from '../src/gfx/math.js';
let api;try{api=await import('../src/game/projectileFlight.js');}catch{}
const data=loadData();
test('common V3 pool gives real MG and cannon rounds nose-anchored physical live bodies',()=>{
  assert.equal(typeof api?.ProjectileFlightOwner,'function');
  const renderer={mesh:data=>({data}),freeMesh(){}},owner=new api.ProjectileFlightOwner(renderer,data),def=data.machineGuns.m2hb;
  const bullet={def,tracer:false,s:{pos:[10,2,30],vel:[100,0,0]}},shot={shell:data.projectiles.aphe_122_br471,s:{pos:[0,1,0],vel:[0,0,700]}};
  const nodes=owner.sync([shot],[bullet]);assert.equal(nodes.length,2);const n=nodes.find(n=>n.projectileId===bulletShell(def).id);
  assert.ok(n);assert.equal(n.projectileProfile.diameterM,.0127);assert.deepEqual(Array.from(n.world.slice(12,15)),[10,2,30]);assert.ok(n.world[8]>0);assert.equal(n.tracer,false);
  const replay=owner.acquire(n.projectileProfile,'intact','replay_projectile');assert.equal(replay.node.mesh,n.mesh,'live and replay lease the same accepted prototype');
  owner.sync([],[]);assert.equal(owner.pool.stats().leases,1);replay.release();owner.reset();assert.equal(owner.pool.stats().leases,0);
});
test('shared projectile context restore updates active node mesh getters without duplicate owners',()=>{
  assert.equal(typeof api?.ProjectileFlightOwner,'function');let uploads=0,freed=0;const r={mesh:()=>({serial:++uploads}),freeMesh(){freed++;}},o=new api.ProjectileFlightOwner(r,data);
  const n=o.sync([],[{def:data.machineGuns.m1919a4,tracer:true,s:{pos:[0,0,0],vel:[0,0,800]}}])[0],old=n.mesh;o.contextLost();assert.equal(n.mesh,null);o.restoreContext();assert.notEqual(n.mesh,old);assert.equal(uploads,2);assert.equal(freed,1);o.dispose();assert.equal(freed,2);
});

test('actual live missile owner leases the common V3 prototype and preserves recorded nose after scene update',()=>{
  const renderer={mesh:data=>({data}),freeMesh(){}},owner=new api.ProjectileFlightOwner(renderer,data),scene=new Node('scene'),missiles=new Missiles({defs:data.missiles,projectiles:data.projectiles,renderer,scene,projectileFlight:owner}),def=data.missiles.bgm71a_tow;
  const node=missiles._node(def),v={node,def,pos:[4,5,6],vel:[20,10,0],t:0};missiles._pose(v);scene.update();
  assert.equal(node.projectileProfile.id,def.id);assert.equal(owner.pool.stats().leases,1);assert.deepEqual(Array.from(node.world.slice(12,15)),[4,5,6]);
  const replay=owner.acquire(owner.profile(data.projectiles[def.warhead],def));assert.equal(replay.node.mesh,node.mesh);
  missiles._drop(v);assert.equal(owner.pool.stats().leases,1);assert.equal(scene.children.includes(node),false);replay.release();assert.equal(owner.pool.stats().leases,0);owner.dispose();
});

test('actual design-range shot list leases common physical bodies beside battlefield records',()=>{
  const r={mesh:data=>({data}),freeMesh(){}},owner=new api.ProjectileFlightOwner(r,data),shot={shell:data.projectiles.aphe_122_br471,s:{pos:[0,2,15],vel:[0,0,800]}};
  const nodes=owner.sync([],[],[shot]);assert.equal(nodes.length,1);assert.equal(nodes[0].projectileProfile.id,shot.shell.id);assert.deepEqual(Array.from(nodes[0].world.slice(12,15)),shot.s.pos);owner.sync([],[],[]);assert.equal(owner.pool.stats().leases,0);owner.dispose();
});

test('established live body poses reuse display metadata across changing flight frames',()=>{
  const r={mesh:data=>({data}),freeMesh(){}},o=new api.ProjectileFlightOwner(r,data),b={def:data.machineGuns.mg34,tracer:false,s:{pos:[1,2,3],vel:[0,0,800]}};
  const n=o.sync([],[b])[0],metadata=n.displayDiagnostic;b.s.pos=[2,3,4];b.s.vel=[100,0,600];o.sync([],[b]);
  assert.ok(n.displayDiagnostic===metadata,'unchanged physical/display scales reuse their prepared metadata');assert.deepEqual(Array.from(n.world.slice(12,15)),b.s.pos);o.dispose();
});

test('full shared live capacity reserves the replacement replay before releasing the old view',()=>{
  const r={mesh:data=>({data}),freeMesh(){}},o=new api.ProjectileFlightOwner(r,data),shell=data.projectiles.aphe_122_br471;
  o.sync(Array.from({length:1024},()=>({shell,s:{pos:[0,0,0],vel:[0,0,700]}})),[]);
  const p=o.profile(shell),missiles=Array.from({length:256},()=>o.acquire(p)),old=Array.from({length:64},()=>o.acquire(p));let next=[];
  assert.doesNotThrow(()=>{next=Array.from({length:64},()=>o.acquire(p));},'fatal replacement is acquired transactionally beside live and old replay leases');
  assert.equal(o.pool.stats().leases,1408);for(const h of [...missiles,...old,...next])h.release();o.dispose();assert.equal(o.pool.stats().leases,0);
});

test('distinct live catalog profiles leave reserved prototypes for a newly acquired replay body',()=>{
  const r={mesh:data=>({data}),freeMesh(){}},o=new api.ProjectileFlightOwner(r,data),shells=Object.values(data.projectiles),held=[];
  for(const shell of shells.slice(0,64))held.push(o.acquire(o.profile(shell)));const fatal=o.acquire(o.profile(shells[64]),'intact','replay_projectile');
  assert.equal(o.pool.stats().prototypes,65);assert.ok(fatal.node.projectileProfile.id===shells[64].id);
  for(const h of [...held,fatal])h.release();o.dispose();
});
