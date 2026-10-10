import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Node, rotX, transformPoint } from '../src/gfx/math.js';
import { STRIDE } from '../src/gfx/geo.js';
import { runtimeParts } from '../tools/procedural-fleet-audit.mjs';
import { loadData } from '../tools/load-data.mjs';
import { muzzleWorld } from '../src/sim/gunnery.js';

const source=fs.readFileSync(new URL('../src/main.js',import.meta.url),'utf8').replaceAll('\r\n','\n');
const data=loadData();
// Execute the actual frame's node collection and turret visibility statements.
function frameNodes(scene,M,inSight,{testing=false,thumbShot=false}={}) {
  const G={sightT:0,thumbShot};
  const visibility=source.match(/^      mt\.node\.visible = [^\n]+;/m)?.[0];
  if(visibility) M.turrets.forEach((mt,ti)=>new Function('mt','ti','inSight','G',visibility)(mt,ti,inSight,G));
  scene.update();
  const statement=source.match(/^    const nodes = scene\.collect\([^\n]+;/m)?.[0];
  assert.ok(statement,'live frame collector present');
  return new Function('scene','M','inSight','testing','G',`${statement}\nreturn nodes;`)(scene,M,inSight,testing,G);
}
const sub=(a,b)=>a.map((v,k)=>v-b[k]);
const dot=(a,b)=>a.reduce((s,v,k)=>s+v*b[k],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
function triangleHit(o,d,[a,b,c]) {
  const e=sub(b,a),f=sub(c,a),h=cross(d,f),det=dot(e,h);
  if(Math.abs(det)<1e-9) return null;
  const q=sub(o,a),u=dot(q,h)/det;
  if(u<0||u>1) return null;
  const j=cross(q,e),v=dot(d,j)/det;
  if(v<0||u+v>1) return null;
  const distance=dot(f,j)/det;
  return distance>.3 ? distance : null;
}
function firstHit(nodes,o,d) {
  let best=null;
  for(const n of nodes) {
    const values=n.mesh.data;
    if(!values) continue;
    for(let i=0;i<values.length;i+=STRIDE*3) {
      const tri=[0,1,2].map(k=>transformPoint(n.world,Array.from(values.slice(i+k*STRIDE,i+k*STRIDE+3))));
      const distance=triangleHit(o,d,tri);
      if(distance!=null&&(!best||distance<best.distance)) best={node:n,distance};
    }
  }
  return best;
}
function rig() {
  const rt=runtimeParts('de_hetzer',data);
  const scene=new Node('scene');scene.add(rt.model.root);
  const world=scene.add(new Node('world'));
  world.mesh={data:new Float32Array(0)};
  const enemy=scene.add(new Node('vehicle'));enemy.mesh={data:new Float32Array(0)};
  return {rt,M:rt.model,scene,world,enemy};
}

test('the actual Hetzer casemate cannot occlude its scoped free-look view', () => {
  const {rt,M,scene}=rig(),t=rt.loadout.turrets[0],g=t.guns[0];
  rt.at();
  const mz=muzzleWorld({pos:[0,0,0],heading:0},{pivot:t.pivot,trunnion:g.trunnion,muzzleOffset:g.muzzleOffset},{yaw:0,pitch:0});
  const eye=mz.trunnion.map((v,k)=>v+mz.dir[k]*.6),direction=[0,0,-1];
  scene.update();
  const oldBodyNodes=M.hull.collect([]);
  assert.ok(firstHit(oldBodyNodes,eye,direction),'real fixed casemate triangles reproduce the view obstruction');
  const nodes=frameNodes(scene,M,true);
  assert.ok(!firstHit(nodes,eye,direction),'first-person picture must not draw the player casemate across its own eyepiece');
});

test('scoping removes only the player model while retaining every target and world node', () => {
  const {M,scene,world,enemy}=rig();
  const own=new Set(M.root.collect([]));
  const before=Array.from(M.root.world);
  const nodes=frameNodes(scene,M,true);
  assert.ok(nodes.every(n=>!own.has(n)),'hull, collar, running gear and every turret are excluded from the optical picture');
  assert.ok(nodes.includes(world)&&nodes.includes(enemy),'other vehicles are never filtered by the shared node name');
  assert.equal(M.root.visible,true,'model remains available for status and hit-camera passes');
  assert.deepEqual(Array.from(M.root.world),before,'drawing does not move the vehicle or eyepiece');
});

test('the status inset retains the complete Hetzer and third-person view restores its full exterior', () => {
  const {M,scene}=rig(),original=M.root.collect([]);
  frameNodes(scene,M,true);
  const inset=M.root.collect([]);
  assert.ok(inset.length===original.length&&inset.every((n,i)=>n===original[i]),'status inset still sees the gun and fixed casemate while scoped');
  const outside=frameNodes(scene,M,false);
  for(const n of original)assert.ok(outside.includes(n),'third person shows every original model part');
  for(const mode of [{testing:true},{thumbShot:true}]) {
    const nodes=frameNodes(scene,M,true,mode);
    for(const n of original)assert.ok(nodes.includes(n),'test-range and garage thumbnail render all parts');
  }
});

test('scope collection preserves posed gun transforms and supports a replacement turret', () => {
  const {rt,M,scene}=rig();
  const extra=M.body.add(new Node('custom_turret'));
  extra.mesh={data:new Float32Array(0)};
  for(const hullPitch of [-.12,0,.12])for(const yaw of [-5,0,11])for(const pitch of [-6,0,12]) {
    M.body.local=rotX(hullPitch);rt.at({yaw:yaw*Math.PI/180,pitch:pitch*Math.PI/180});
    const gun=M.turrets[0].guns[0].node;
    const matrix=Array.from(gun.world);
    const scoped=frameNodes(scene,M,true);
    assert.ok(!scoped.includes(extra),'replacement turrets also cannot block the optical picture');
    assert.deepEqual(Array.from(gun.world),matrix,'gun orientation and shot transforms remain intact');
    assert.ok(M.root.collect([]).includes(extra),'replacement turret survives in status and exterior views');
  }
});
