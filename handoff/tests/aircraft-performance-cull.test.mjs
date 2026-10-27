import test from 'node:test';
import assert from 'node:assert/strict';
import {createAircraftClipReject,invalidateAircraftRenderBounds} from '../tools/aircraft_performance/aircraft-render-cull.mjs';
import {Node,m4,translation,mul,lookAt,perspective} from '../../client/web/src/gfx/math.js';

const upload=points=>{const data=new Float32Array(points.flatMap(p=>[...p,0,0,1,1,1,1,.5,0,0,0]));return{count:points.length,_src:{kind:'mesh',data},aircraftGeometry:true};};
test('exact camera/shadow clip rejection never drops a marked mesh with any visible uploaded vertex',()=>{
  const camera=mul(perspective(Math.PI/3,1.6,.1,500),lookAt([0,2,-8],[0,1,5],[0,1,0]));
  for(const vp of [camera,m4()])for(let i=0;i<120;i++){
    const points=[[-1,-.5,-1],[1,.5,1],[0,1,0]],world=translation((i%11-5)*3,(i%7-3)*1.1,(i%19-9)*5),node={mesh:upload(points),world};
    const transform=(m,p)=>[0,1,2,3].map(k=>m[k]*p[0]+m[k+4]*p[1]+m[k+8]*p[2]+m[k+12]),clip=points.map(p=>transform(vp,transform(world,p)));
    if(clip.some(p=>p[3]>=0&&p.slice(0,3).every(v=>Math.abs(v)<=p[3])))assert.equal(createAircraftClipReject(vp)(node),false);
  }
});
test('unknown or mutable uploads fail open and draw filtering leaves physical scene state intact',()=>{
  const mesh=upload([[0,0,0],[1,1,1]]),node={mesh,world:translation(100,0,0),visible:true,hitboxDisabled:false,part:'wing_l'},before={...node};
  assert.equal(createAircraftClipReject(m4())(node),true);assert.deepEqual(node,before);
  for(const patch of [{aircraftGeometry:false},{instanced:true},{indexed:true},{_src:{kind:'mesh',data:new Float32Array([NaN])}}])assert.equal(createAircraftClipReject(m4())({...node,mesh:{...mesh,...patch}}),false);
  mesh._src.data[0]=-200;invalidateAircraftRenderBounds(mesh);assert.equal(createAircraftClipReject(m4())(node),false);
  const root=new Node('skin'),child=root.add(new Node('gear'));root.mesh=mesh;child.mesh=mesh;root.aircraftHiddenSkin=true;
  assert.deepEqual(root.collect([]),[child]);assert.equal(root.visible,true);root.aircraftHiddenSkin=false;assert.deepEqual(root.collect([]),[root,child]);
});
