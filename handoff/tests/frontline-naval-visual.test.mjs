import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {Node,transformPoint} from '../../client/web/src/gfx/math.js';
import {GeoBuilder,STRIDE} from '../../client/web/src/gfx/geo.js';
import {Renderer} from '../../client/web/src/gfx/renderer.js';

const helper=new URL('../tools/frontline_naval_visual.js',import.meta.url);
const H='a'.repeat(64),H2='b'.repeat(64);
const f=Math.fround;
function catalog({hash=H,revision=1,shift=0}={}) {
  return [{id:'generic_transport',hash,geometry_revision:revision,coordinate_type:'float32',forward:'+Z',
    gun_rotation_order:'pitch_then_yaw_about_pivot_then_body_yaw',parts:[
      {id:'hull',role:'hull',color:[.3,.4,.4],pose_group:'body',pivot:[0,0,0],triangles:[
        [-4,1,-2,-2,1,-2,-2,1,2],[-4,1,-2,-2,1,2,-4,1,2],
        [2,1,-2,4,1,-2,4,1,2],[2,1,-2,4,1,2,2,1,2]]},
      {id:'gun_barrel',role:'gun',color:[.2,.3,.3],pose_group:'gun',pivot:[0,f(2.35),4],
        triangles:[[f(.16)+shift,f(2.35),4,0,f(2.51),4,0,f(2.35),f(7.5)]]}
    ]}];
}
function row(overrides={}) {return {id:'ship',unit:{battle:7,unit:23,life:1},team:0,role:'transport',model:'generic_transport',
  pos:[100,2,-50],yaw:.4,gun_yaw:.7,gun_pitch:.25,velocity:[0,0,1e6],alive:true,
  geometry_id:'generic_transport',geometry_hash:H,geometry_revision:1,pose_revision:1,...overrides};}
function fixture({parent=false}={}) {
  const context=vm.createContext({console});vm.runInContext(fs.readFileSync(helper,'utf8')+';globalThis.factory=createFrontlineNavalVisual;',context);
  let uploads=0,frees=0,failAt=Infinity;
  const gl={ARRAY_BUFFER:1,STATIC_DRAW:2,createVertexArray:()=>({}),createBuffer:()=>({}),bindVertexArray(){},bindBuffer(){},bufferData(){},deleteVertexArray(){frees++;},deleteBuffer(){}};
  const renderer=Object.create(Renderer.prototype);renderer.gl=gl;renderer._live=new Set();renderer._vertexLayout=()=>{};
  renderer.mesh=function(data){if(++uploads===failAt)throw Error('GPU upload fixture failure');return Renderer.prototype.mesh.call(this,data);};
  const scene=parent?new Node('existing-parent'):null;if(scene)scene.add(new Node('preserved-other-owner'));
  const owner=context.factory({Node,renderer,GeoBuilder,...scene?{root:scene}:{}});
  return {owner,renderer,scene,get uploads(){return uploads;},get frees(){return frees;},failAt:n=>failAt=n};
}
const nodes=owner=>{owner.root.update();return owner.root.collect([]);};
const near=(actual,expected,tol=5e-5)=>assert.ok(Math.abs(actual-expected)<=tol,`${actual} != ${expected}`);
function nativeWorld(p,v,pivot=null) {
  const ry=(p,a)=>{const s=Math.sin(a),c=Math.cos(a);return [c*p[0]+s*p[2],p[1],-s*p[0]+c*p[2]];};
  if(pivot){p=p.map((x,i)=>x-pivot[i]);const s=Math.sin(v.gun_pitch),c=Math.cos(v.gun_pitch);p=[p[0],c*p[1]+s*p[2],-s*p[1]+c*p[2]];p=ry(p,v.gun_yaw).map((x,i)=>x+pivot[i]);}
  return ry(p,v.yaw).map((x,i)=>x+v.pos[i]);
}

test('native Float32 triangles upload unchanged through the real GeoBuilder and Renderer mesh owner',()=>{
  const x=fixture(),source=catalog(),sample=row(),before=JSON.stringify({source,sample});
  assert.equal(x.owner.accept(source,[sample],{battle:7,tick:1}),true);
  const visible=nodes(x.owner);assert.equal(visible.length,2);assert.equal(x.renderer._live.size,2);
  for(const part of source[0].parts){const node=visible.find(n=>n.navalPartId===part.id);assert.ok(node);const positions=[];
    for(let i=0;i<node.mesh._src.data.length;i+=STRIDE)positions.push(...node.mesh._src.data.slice(i,i+3));
    assert.deepEqual(positions,part.triangles.flat());assert.equal(node.doubleSided,true);
    assert.equal(node.navalGeometryHash,H);assert.equal(node.navalGeometryRevision,1);
  }
  const hull=visible.find(n=>n.navalPartId==='hull');assert.equal(hull.mesh.count,12,'native aperture remains four original triangles');
  assert.equal(JSON.stringify({source,sample}),before);
});

test('body and articulated gun apply the native pivot/pitch/localYaw/bodyYaw transform exactly',()=>{
  const x=fixture(),source=catalog(),v=row();x.owner.accept(source,[v],{battle:7,tick:1});
  for(const node of nodes(x.owner)){const p=source[0].parts.find(p=>p.id===node.navalPartId),flat=p.triangles[0];
    for(let i=0;i<3;i++){const point=flat.slice(i*3,i*3+3),actual=transformPoint(node.world,point),expected=nativeWorld(point,v,p.pose_group==='gun'?p.pivot:null);actual.forEach((n,k)=>near(n,expected[k]));}
  }
  const gun=nodes(x.owner).find(n=>n.navalPartId==='gun_barrel');
  assert.ok(transformPoint(gun.world,[0,f(2.35),7.5])[1]>v.pos[1]+f(2.35),'positive native pitch elevates the muzzle');
  const first=Array.from(gun.world);x.owner.sync(null,[v],{battle:7,tick:2});assert.deepEqual(Array.from(nodes(x.owner).find(n=>n.navalPartId==='gun_barrel').world),first,'velocity does not integrate local motion');
});

test('same-model vessels share one GPU mesh per part and last reference releases every mesh once',()=>{
  const x=fixture(),a=row(),b=row({unit:{battle:7,unit:24,life:1},pos:[0,0,0]});
  x.owner.accept(catalog(),[a,b],{battle:7,tick:1});const first=nodes(x.owner);assert.equal(x.uploads,2);assert.equal(first.length,4);
  assert.equal(first.filter(n=>n.navalPartId==='hull')[0].mesh,first.filter(n=>n.navalPartId==='hull')[1].mesh);
  x.owner.accept(null,[a],{battle:7,tick:2});assert.equal(x.frees,0);assert.equal(x.uploads,2);
  x.owner.accept(null,[],{battle:7,tick:3});assert.equal(x.frees,2);assert.equal(x.renderer._live.size,0);assert.equal(x.owner.stats.live,0);
  x.owner.dispose();x.owner.dispose();assert.equal(x.frees,2);
});

test('stale battle/tick/life/pose and same-life resurrection cannot replace an accepted frame',()=>{
  const x=fixture(),v=row();assert.equal(x.owner.accept(catalog(),[v],{battle:7,tick:10}),true);const body=x.owner.root.children[0];
  for(const [sample,meta] of [[v,{battle:7,tick:9}],[v,{battle:6,tick:99}],
    [row({unit:{battle:7,unit:23,life:0}}),{battle:7,tick:11}],
    [row({pose_revision:0}),{battle:7,tick:11}]]) {assert.equal(x.owner.accept(null,[sample],meta),false);assert.equal(x.owner.root.children[0],body);}
  const second=row({unit:{battle:7,unit:23,life:2},pose_revision:1});assert.equal(x.owner.accept(null,[second],{battle:7,tick:11}),true);
  assert.equal(x.owner.accept(null,[v],{battle:7,tick:12}),false);
  assert.equal(x.owner.accept(null,[{...second,alive:false,pose_revision:2}],{battle:7,tick:12}),true);assert.equal(nodes(x.owner).length,0);
  assert.equal(x.owner.accept(null,[{...second,pose_revision:3}],{battle:7,tick:13}),false);assert.equal(nodes(x.owner).length,0);
});

test('absence releases presentation but keeps the life/pose guard against stale reappearance',()=>{
  const x=fixture();x.owner.accept(catalog(),[row({pose_revision:10})],{battle:7,tick:1});x.owner.accept(null,[],{battle:7,tick:2});
  assert.equal(x.owner.accept(null,[row({pose_revision:9})],{battle:7,tick:3}),false);assert.equal(x.renderer._live.size,0);
  assert.equal(x.owner.accept(null,[row({pose_revision:10})],{battle:7,tick:3}),true);
});

test('catalog/view identity, precision, numeric and duplicate corruption fail atomically before GPU allocation',()=>{
  const x=fixture();x.owner.accept(catalog(),[row()],{battle:7,tick:1});const body=x.owner.root.children[0],uploaded=x.uploads;
  const invalid=[row({geometry_hash:H2}),row({geometry_revision:2}),row({pos:[NaN,0,0]}),row({gun_pitch:Infinity}),row({unit:{battle:8,unit:23,life:1}})];
  for(const v of invalid){assert.equal(x.owner.accept(null,[v],{battle:7,tick:2}),false);assert.equal(x.owner.root.children[0],body);}
  assert.equal(x.owner.accept(null,[row(),row()],{battle:7,tick:2}),false);
  const changed=catalog();changed[0].parts[0].triangles[0][0]=f(5);assert.equal(x.owner.accept(changed,[row()],{battle:7,tick:2}),false,'same identity cannot redefine content');
  const lossy=catalog({hash:H2,revision:2});lossy[0].parts[0].triangles[0][0]=.1;assert.equal(x.owner.accept(lossy,[row({geometry_hash:H2,geometry_revision:2})],{battle:7,tick:2}),false,'source positions must already be uploaded Float32 values');
  assert.equal(x.uploads,uploaded);assert.equal(x.owner.root.children[0],body);
});

test('geometry upgrades replace owned buffers only after all uploads succeed and roll back failed allocations',()=>{
  const x=fixture();x.owner.accept(catalog(),[row()],{battle:7,tick:1});const body=x.owner.root.children[0];
  x.failAt(4);assert.equal(x.owner.accept(catalog({hash:H2,revision:2}),[row({geometry_hash:H2,geometry_revision:2,pose_revision:2})],{battle:7,tick:2}),false);
  assert.equal(x.owner.root.children[0],body);assert.equal(x.renderer._live.size,2);assert.equal(x.frees,1);
  x.failAt(Infinity);assert.equal(x.owner.accept(catalog({hash:H2,revision:2}),[row({geometry_hash:H2,geometry_revision:2,pose_revision:2})],{battle:7,tick:2}),true);
  assert.equal(x.renderer._live.size,2);assert.equal(x.frees,3);assert.ok(nodes(x.owner).every(n=>n.navalGeometryHash===H2));
});

test('battle changes require a fresh catalog and dispose only removes this owner subtree',()=>{
  const x=fixture({parent:true});assert.equal(x.scene.children.length,2);x.owner.accept(catalog(),[row()],{battle:7,tick:1});
  const v=row({unit:{battle:8,unit:23,life:1}});assert.equal(x.owner.accept(null,[v],{battle:8,tick:0}),false);
  assert.equal(x.owner.accept(catalog(),[v],{battle:8,tick:0}),true);assert.equal(x.owner.accept(catalog(),[row()],{battle:7,tick:999}),false);
  x.owner.dispose();assert.equal(x.scene.children.length,1);assert.equal(x.scene.children[0].name,'preserved-other-owner');assert.equal(x.renderer._live.size,0);
  assert.equal(x.owner.accept(catalog(),[v],{battle:8,tick:1}),false);
});

test('admission bounds retained models and vessel records without truncating an authoritative frame',()=>{
  const x=fixture(),rows=Array.from({length:65},(_,i)=>row({unit:{battle:7,unit:i+1,life:1}}));
  assert.equal(x.owner.accept(catalog(),rows,{battle:7,tick:1}),false);assert.equal(x.uploads,0);assert.equal(x.owner.root.children.length,0);
});

test('clear supports leaving and rejoining with two battles while dispose stays terminal',()=>{
  const x=fixture({parent:true});assert.equal(x.owner.accept(catalog(),[row()],{battle:7,tick:10}),true);
  x.owner.clear();assert.equal(x.renderer._live.size,0);assert.equal(x.owner.stats.live,0);assert.equal(x.owner.ready,false);
  assert.equal(x.scene.children.length,2,'clear keeps the owner scene mount reusable');
  const next=row({unit:{battle:8,unit:23,life:1},pos:[5,0,10]});
  assert.equal(x.owner.accept(catalog(),[next],{battle:8,tick:0}),true);assert.equal(nodes(x.owner).length,2);
  assert.equal(x.owner.accept(catalog(),[row()],{battle:7,tick:999}),false);
  x.owner.clear();x.owner.clear();assert.equal(x.renderer._live.size,0);
  assert.equal(x.owner.accept(catalog(),[row({unit:{battle:2,unit:23,life:1}})],{battle:2,tick:0}),true,'a new connection may use a lower independent battle counter');
  x.owner.dispose();x.owner.clear();assert.equal(x.owner.accept(catalog(),[next],{battle:8,tick:1}),false);assert.equal(x.scene.children.length,1);
});

test('repeating the catalog on every accepted frame keeps model GPU uploads constant',()=>{
  const x=fixture(),geometry=catalog();
  for(let tick=0;tick<100;tick++)assert.equal(x.owner.accept(geometry,[row({pose_revision:tick+1,pos:[tick,0,0]})],{battle:7,tick}),true);
  assert.equal(x.uploads,2);assert.equal(x.frees,0);assert.equal(x.renderer._live.size,2);x.owner.clear();assert.equal(x.frees,2);
});
