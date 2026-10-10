import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Node, lookAtLH } from '../src/gfx/math.js';
import { RigidBody } from '../src/sim/tank/body.js';
import { BattleMap } from '../src/game/battlemap.js';
import { buildMapWorld } from '../src/game/mapworld.js';

const source=fs.readFileSync(new URL('../src/main.js',import.meta.url),'utf8').replaceAll('\r\n','\n');
const modulePath=new URL('../src/game/cameraObstruction.js',import.meta.url);
const CameraObstruction=fs.existsSync(modulePath)?(await import(modulePath)).CameraObstruction:null;
const tree=(x,z,kind=0,extra={})=>({x,z,y:.1,s:1,rot:0,kind,fall:0,fallDir:0,...extra});
function mapOf(trees=[],boxes=[]) {
  const map=Object.create(BattleMap.prototype);
  Object.assign(map,{trees,boxes,bucket:50,x0:-500,z0:-500,buckets:new Map(),boxBuckets:new Map(),maxBoxR:0});
  for(const [objects,buckets] of [[trees,map.buckets],[boxes,map.boxBuckets]])objects.forEach((o,i)=>{const key=map._key(o.x,o.z);if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(i);});
  for(const b of boxes)map.maxBoxR=Math.max(map.maxBoxR,b.r);
  return map;
}
function box(z,yaw=0) {return {x:0,z,y0:0,y1:8,hx:2,hz:.6,c:Math.cos(yaw),s:Math.sin(yaw),r:Math.hypot(2,.6),yaw};}
function rig(map) {
  const body=new RigidBody(1000,[1000,1000,1000],[0,0,0]);
  const G={map,veh:{body},model:{height:2},loadout:{vehicle:{hull:{size_m:[2.6,2,4.8]}}},cam:{yaw:0,pitch:-.14,dist:12,fov:50*Math.PI/180,pivot:[0,3,0]},s:{x:0,y:0,z:0}};
  return {G,collider:CameraObstruction?new CameraObstruction(()=>0):null};
}
function frame(r) {
  const start=source.indexOf('      fwd = dirFrom(G.cam.yaw + jitter() * 0.012,');
  const body=source.slice(start,source.indexOf('\n    }\n    G.camPos = camPos;',start));
  const constants=[...source.matchAll(/^const THIRD_[A-Z_]+ = .*$/gm)].map(m=>m[0]).join('\n');
  const dirFrom=(yaw,pitch)=>[Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch)];
  const deps={G:r.G,M:r.G.model,DEG:Math.PI/180,garage:false,document:{body:{dataset:{touch:'1'}}},jitter:()=>0,dirFrom,lookAtLH,groundAt:()=>0,aspect:16/9,dt:1/60,cameraObstruction:r.collider};
  return new Function(...Object.keys(deps),`${constants}\nlet fwd,camPos;const fovY=G.cam.fov;\n${body}\nreturn {camPos,fwd};`)(...Object.values(deps));
}
function adjust(r,eye,dt=1/60,radius=.45) {
  assert.ok(r.collider,'camera collision owner is available');
  return r.collider.update(r.G.map,r.G.veh.body,r.G.loadout.vehicle,r.G.model.height,eye,dt,radius);
}

test('actual third-person/free camera moves to the player side of a fir canopy', () => {
  const r=rig(mapOf([tree(0,-7)])),view=frame(r);
  assert.ok(view.camPos[2]>-6,'a tree between vehicle and eye must shorten the actual camera arm');
  assert.ok(view.camPos[1]>=.45,'camera remains above the ground');
  assert.ok(view.fwd[2]>.98,'camera correction preserves the requested viewing direction');
});

test('trunks, broadleaf crowns and nearest rotated buildings all retract the camera', () => {
  for(const [map,eye,limit] of [[mapOf([tree(0,-4)]),[0,1,-12],-3.5],[mapOf([tree(0,-8,1)]),[0,11,-16],-8],[mapOf([],[box(-4,.6),box(-9)]),[0,3,-14],-4]]) {
    const r=rig(map);adjust(r,eye);
    assert.ok(eye[2]>limit,'camera stops before the first inflated obstacle');
    assert.ok(r.collider.fraction<1);
  }
});

test('scaled and fallen trees use their current rendered pose instead of stale upright volumes', () => {
  const small=rig(mapOf([tree(0,-7,0,{s:.75})])),large=rig(mapOf([tree(0,-7,0,{s:1.3})]));
  // At low height, scaling also lifts the canopy base and exposes more trunk.
  // Compare rays through both crowns, where the larger silhouette is actually wider.
  const a=[0,8,-15],b=a.slice();adjust(small,a);adjust(large,b);
  assert.ok(b[2]>a[2],'larger foliage stops the camera sooner');
  const standing=rig(mapOf([tree(-8,-10,1)])),fallen=rig(mapOf([tree(-8,-10,1,{fall:1,fallDir:Math.PI/2})]));
  const c=[0,1,-18],d=c.slice();adjust(standing,c);adjust(fallen,d);
  assert.equal(standing.collider.fraction,1,'upright foliage outside the ray is clear');
  assert.ok(fallen.collider.fraction<1&&d[2]>-10,'fallen crown extends away from the original trunk');
});

test('camera retracts immediately and smoothly returns after the obstruction clears', () => {
  const map=mapOf([tree(0,-7)]),r=rig(map),eye=[0,4,-15];
  adjust(r,eye);const blocked=r.collider.fraction;
  assert.ok(blocked<.8,'new blocker is resolved in its first frame');
  map.trees.length=0;map.buckets.clear();
  adjust(r,[0,4,-15]);
  assert.ok(r.collider.fraction>blocked&&r.collider.fraction<1,'release is gradual');
  for(let i=0;i<180;i++)adjust(r,[0,4,-15]);
  assert.equal(r.collider.fraction,1,'original camera distance is eventually restored');
  r.collider.reset();assert.equal(r.collider.fraction,1);
});

test('camera collision does not add foliage to projectile or spotting collision and clear paths retain the original eye', () => {
  const map=mapOf([tree(0,-7)]),before=JSON.stringify(map.trees),r=rig(map);
  assert.equal(map.segmentHit([0,3,0],[0,3,-15]),null,'existing map combat query excludes trees');
  adjust(r,[0,4,-15]);
  assert.equal(map.segmentHit([0,3,0],[0,3,-15]),null);
  assert.equal(JSON.stringify(map.trees),before,'camera never changes tree damage or fall state');
  const clear=rig(mapOf()),eye=[3,6,-14],expected=eye.slice();adjust(clear,eye);
  assert.deepEqual(eye,expected);
});

test('a forced close camera hides the player only in the primary view while status and targets remain visible', () => {
  const r=rig(mapOf([],[box(-.8)])),eye=[0,3,-12];adjust(r,eye);
  assert.equal(r.collider.hideBody,true,'camera pushed inside the hull needs a clear primary picture');
  r.G.cam.hideBody=r.collider.hideBody;
  const scene=new Node('scene'),player=scene.add(new Node('player')),target=scene.add(new Node('target'));
  player.mesh={};target.mesh={};
  const statement=source.match(/^    const nodes = scene\.collect\([^\n]+;/m)[0];
  const nodes=new Function('scene','M','inSight','testing','G',`${statement}\nreturn nodes;`)(scene,{root:player},false,false,{thumbShot:false,cam:r.G.cam});
  assert.ok(!nodes.includes(player)&&nodes.includes(target),'only the player subtree is hidden');
  assert.equal(player.visible,true);assert.ok(player.collect([]).includes(player),'status inset remains complete');
});

test('terrain ridges keep the corrected eye above the surface without changing player physics', () => {
  const r=rig(mapOf()),body=r.G.veh.body,pos=body.pos.slice();
  assert.ok(CameraObstruction);
  r.collider=new CameraObstruction((x,z)=>z<-5?2:0);
  const eye=[0,1,-12];adjust(r,eye);
  assert.ok(eye[2]>-5&&eye[1]>=.45,'camera cannot be left below a ridge');
  assert.deepEqual(body.pos,pos);
});

test('rendered roofs and bunker overhangs obstruct the camera above the combat boxes', () => {
  for (const [object,height] of [
    [{kind:'house',x:0,z:-6,w:4,d:4,h:3,roof:2,yaw:.2},5.3],
    [{kind:'bunker',x:0,z:-6,w:4,d:4,h:2.6,yaw:0},3.2],
    [{kind:'church',x:0,z:-25,w:12,d:28,h:13,yaw:0},31],
  ]) {
    const map=mapOf();map.height=()=>0;map.points=[];map.waterLevel=0;map._placeObjects([object]);
    let top=-Infinity;
    buildMapWorld({mesh:g=>{for(let i=1;i<g.length;i+=13)top=Math.max(top,g[i]);return {};},instancedMesh:()=>({}),setInstances:()=>{}},map);
    assert.ok(top>height-.45,'the actual visual geometry reaches this camera sphere');
    assert.equal(map.segmentHit([0,height,0],[0,height,-12]),null,'combat box intentionally leaves this roof height clear');
    const r=rig(map);r.G.veh.body.place([0,height-1,0],0);
    const eye=[0,height,-12];adjust(r,eye);
    assert.ok(eye[2]>-6,'camera stops on the player side of the rendered structure');
    assert.equal(map.segmentHit([0,height,0],[0,height,-12]),null,'expanded camera volume must not change projectile collision');
  }
});
