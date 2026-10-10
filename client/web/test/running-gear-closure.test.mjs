import test from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../tools/load-data.mjs';
import { buildTank } from '../src/gfx/tankmodel.js';
import { decodeAllImported } from '../src/gfx/imported.js';
import { transformPoint, mul, translation, rotX, rotY, rotZ } from '../src/gfx/math.js';
import { makePiece, topologyStatistics, surfaceCrossings } from '../tools/procedural-fleet-audit.mjs';

const data=loadData();await decodeAllImported(data.vehicles);
const procedural=data.order.filter(id=>!data.vehicles[id].model&&data.vehicles[id].visual.running_gear.kind!=='wheels');
function rig(id,bundle=data.vehicles[id]) {
  let created=0;const freed=[];
  const renderer={mesh:vertices=>{created++;return {data:vertices,count:vertices.length/13};},instancedMesh:vertices=>{created++;return {data:vertices,count:vertices.length/13};},setInstances(mesh,matrices,count){mesh.matrices=matrices;mesh.instances=count;},freeMesh(mesh){freed.push(mesh);}};
  const M=buildTank(renderer,{vehicle:bundle.vehicle,visual:bundle.visual,imported:bundle.imported,turrets:[]},()=>[]);
  return {M,renderer,created:()=>created,freed};
}
const distance=(a,b)=>Math.hypot(...a.map((v,k)=>v-b[k]));
function segments(M,world=false) {
  const node=M.running.children.find(n=>n.name==='gear_connections');
  assert.ok(node?.mesh,'running gear needs physical axle and suspension connectors');
  return Array.from({length:node.mesh.instances},(_,i)=>{
    const matrix=node.mesh.matrices.subarray(i*16,i*16+16);
    const point=p=>{const q=transformPoint(matrix,p);return world?transformPoint(node.world,q):q;};
    return [point([0,-.5,0]),point([0,.5,0])];
  });
}
function dynamics(M,lift=.1,travel=.37,lod=0) {
  return {lifts:{1:M.stations.map((_,i)=>lift*(i+1)/M.stations.length),[-1]:M.stations.map((_,i)=>-lift*(i+1)/M.stations.length)},travel:{1:travel,[-1]:-travel},lod};
}

test('Hetzer final drives and inner wheel axles have closed castings instead of unsupported gaps',()=>{
  const {M}=rig('de_hetzer');
  const casting=M.running.children.find(n=>n.name==='gear_mounts');
  assert.ok(casting?.mesh,'missing hull-side transmission and axle bearing castings');
  assert.equal(topologyStatistics(makePiece('mounts',casting.mesh.data)).boundaryEdges,0,'castings have end caps');
  assert.ok(M.shellNodes.includes(casting)&&M.shellNodes.includes(M.running.children.find(n=>n.name==='gear_connections')),'external castings retain the normal X-ray fade contract');
  const links=segments(M);
  for(const w of M.wheels) {
    assert.ok(links.some(pair=>pair.some(p=>distance(p,w.node.pos)<.015)),`${w.side}:${w.role}: the connector reaches the actual axle centre`);
  }
  for(const side of [1,-1]) {
    const w=M.wheels.find(w=>w.role==='sprocket'&&w.side===side);
    const points=Array.from({length:casting.mesh.data.length/13},(_,i)=>Array.from(casting.mesh.data.subarray(i*13,i*13+3)));
    assert.ok(points.some(p=>side*p[0]>.72&&Math.hypot(p[1]-w.node.pos[1],p[2]-w.node.pos[2])<w.r*.6), 'final-drive casting occupies the photographed inboard gap');
  }
});

test('every procedural tracked chassis has sealed mounted gear and continuous connectors to both sides',()=>{
  assert.equal(procedural.length,23);
  for(const id of procedural) {
    const {M}=rig(id),casting=M.running.children.find(n=>n.name==='gear_mounts'),links=segments(M);
    assert.ok(casting?.mesh,`${id}: hull-side mounts`);
    assert.equal(topologyStatistics(makePiece(id,casting.mesh.data)).boundaryEdges,0,`${id}: no missing end faces`);
    for(const side of [1,-1])for(const role of ['sprocket','idler']) {
      const w=M.wheels.find(w=>w.side===side&&w.role===role);
      assert.ok(links.some(pair=>pair.some(p=>distance(p,w.node.pos)<.015)),`${id}:${side}:${role}: hub is attached`);
    }
    assert.ok(M.running.children.includes(casting)&&M.body.children.includes(M.running),'castings follow the hull');
    M.dispose();
  }
});

test('suspension connectors follow both wheel lift and idler tension without inheriting wheel spin',()=>{
  for(const id of ['de_hetzer','de_tiger_e','us_m901_itv','us_m4a3_76w_hvss','proto_a']) {
    const {M}=rig(id);M.body.local=mul(translation(7,.4,-3),mul(rotY(.6),mul(rotX(.15),rotZ(-.1))));
    for(const [lift,travel,lod] of [[.14,.37,0],[-.12,.73,1],[.16,1.29,2]]) {
      M.updateRunningGear(dynamics(M,lift,travel,lod));M.root.update();
      const links=segments(M,true);
      for(const w of M.wheels.filter(w=>w.role==='road_wheel'||w.role==='idler')) {
        const hub=transformPoint(w.node.world,[0,0,0]);
        assert.ok(links.some(pair=>pair.some(p=>distance(p,hub)<.02)),`${id}:${w.side}:${w.station}: real moving hub stays joined`);
      }
      const node=M.running.children.find(n=>n.name==='gear_connections');
      assert.equal(node.pitch,0,'support owner must not rotate with tyres or sprocket teeth');
      assert.ok([...node.mesh.matrices].every(Number.isFinite));
    }
  }
});

test('paired and interleaved wheel layouts retain their guide channels, mesh and longitudinal stations',()=>{
  for(const id of ['de_tiger_e','us_m4a3_76w_hvss','us_m901_itv']) {
    const {M}=rig(id),rg=data.vehicles[id].visual.running_gear;
    segments(M);
    assert.equal(M.wheels.filter(w=>w.role==='road_wheel').length,rg.wheels.length*2);
    for(const side of [1,-1])for(const [index,w] of M.wheels.filter(w=>w.role==='road_wheel'&&w.side===side).entries()) {
      assert.equal(w.node.pos[0],side*(rg.track_x+(rg.wheels[index].x||0)));
      assert.equal(w.node.pos[2],rg.wheels[index].z);
    }
    assert.equal(M.running.children.find(n=>n.name==='tracks').mesh.instances,M.linkCount*2);
  }
});

test('imported tracked and wheeled models retain their own suspension and geometry',()=>{
  for(const id of data.order.filter(id=>data.vehicles[id].model||data.vehicles[id].visual.running_gear.kind==='wheels')) {
    const {M}=rig(id);
    assert.ok(!M.running.children.some(n=>n.name==='gear_mounts'||n.name==='gear_connections'),`${id}: preserve provided models and wheeled chassis`);
    M.dispose();
  }
});

test('support meshes and matrix buffers are reused through animation and released with the model',()=>{
  const r=rig('de_hetzer'),links=r.M.running.children.find(n=>n.name==='gear_connections');
  assert.ok(links?.mesh);
  const created=r.created(),matrices=links.mesh.matrices;
  for(let i=0;i<90;i++)r.M.updateRunningGear(dynamics(r.M,.1*Math.sin(i*.2),i*.02));
  assert.equal(r.created(),created,'no per-frame mesh uploads');
  assert.equal(links.mesh.matrices,matrices,'no per-frame matrix replacement');
  r.M.dispose();
  assert.equal(new Set(r.freed).size,r.freed.length,'every mesh released once');
  assert.ok(r.freed.includes(links.mesh));
});

test('new suspension arms clear the actual inner dished plates and bolts outside the axle hub',()=>{
  for(const id of procedural) {
    const {M}=rig(id),node=M.running.children.find(n=>n.name==='gear_connections');
    M.updateRunningGear(dynamics(M,.13,.47));M.root.update();
    const road=M.wheels.filter(w=>w.role==='road_wheel').map(w=>{
      const geo=w.node.mesh.data,triangles=[];
      for(let i=0;i<geo.length;i+=39)triangles.push([0,13,26].map(j=>transformPoint(w.node.world,geo.subarray(i+j,i+j+3))));
      return {w,piece:makePiece('wheel',triangles,true),center:transformPoint(w.node.world,[0,0,0])};
    });
    for(let instance=0;instance<node.mesh.instances;instance++) {
      const matrix=mul(node.world,node.mesh.matrices.subarray(instance*16,instance*16+16));
      if(Math.abs(matrix[5])+Math.abs(matrix[6])<1e-4)continue; // horizontal axle shafts intentionally join the central hub
      const triangles=[],geo=node.mesh.data;
      for(let i=0;i<geo.length;i+=39)triangles.push([0,13,26].map(j=>transformPoint(matrix,geo.subarray(i+j,i+j+3))));
      const arm=makePiece('arm',triangles,true);
      for(const {w,piece,center} of road) {
        const hit=surfaceCrossings(arm,piece);
        const outside=hit.points.filter(p=>Math.hypot(p[1]-center[1],p[2]-center[2])>w.r*.30+1e-4);
        assert.equal(outside.length,0,`${id}:${w.side}:${w.station}: arm must not cut the wheel disc away from its bearing`);
      }
    }
    M.dispose();
  }
});

test('paired bogie stations share a casting instead of drawing coincident copies',()=>{
  for(const id of ['de_pz4_h','us_m4a3_76w_hvss']) {
    const {M}=rig(id),geo=M.running.children.find(n=>n.name==='gear_mounts').mesh.data,triangles=[];
    for(let i=0;i<geo.length;i+=39)triangles.push([0,13,26].map(j=>Array.from(geo.subarray(i+j,i+j+3)).map(v=>v.toFixed(6)).join(',')).sort().join('|'));
    assert.equal(new Set(triangles).size,triangles.length,`${id}: each cast surface should be drawn once`);
    M.dispose();
  }
});
