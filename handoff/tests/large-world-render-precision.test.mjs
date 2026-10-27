import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const original=fs.readFileSync(new URL('../bundle/app.js.html',import.meta.url),'utf8');
const patchUrl=new URL('../tools/patch_large_world_render.mjs',import.meta.url);
const patch=fs.existsSync(patchUrl)?(await import(patchUrl)).patchLargeWorldRender:s=>s;
const source=process.env.TF_PRECISION_BASELINE?original:patch(original);
function load(){
  const math=source.slice(source.indexOf('  // client/web/src/gfx/math.js'),source.indexOf('  // client/web/src/gfx/geo.js'));
  const begin=source.indexOf('  var Effects = class'),end=source.indexOf('\n  // client/',begin);
  const context=vm.createContext({console,Float32Array,Float64Array,WeakMap,Map,Set,performance,
    TFAirVortex:{write:(_b,n)=>n,context:()=>null},TFNativeCMVisual:{write:(_b,n)=>n,context:()=>null}});
  const quat=source.slice(source.indexOf('  function quatMatrix(p, q) {'),source.indexOf('  var AIRCRAFT_KEYS',source.indexOf('  function quatMatrix(p, q) {')));
  vm.runInContext('var FLOATS=9,SOFT_FLOATS=13;'+math+'\n'+quat+'\n'+source.slice(begin,end)+';globalThis.api={Node,Effects,lookAtLH,perspective,ortho,quatMatrix,mul,project};',context);
  return context;
}
function clip(m,p){const f=Math.fround,a=[...p,1],v=[0,0,0,0];for(let r=0;r<4;r++)v[r]=f(f(f(f(m[r]*a[0])+f(m[r+4]*a[1]))+f(m[r+8]*a[2]))+m[r+12]);return [v[0]/v[3],v[1]/v[3]];}
function camera(api,offset){const pos=[offset[0]+1.123456,offset[1]+2.345678,offset[2]-12.987654],basis=api.lookAtLH(pos,[.12,-.03,1]),tanY=Math.tan(Math.PI/6);return {...basis,pos,tanX:tanY*1.6,tanY,near:.05,far:300000,viewProj:api.mul(api.perspective(Math.PI/3,1.6,.05,300000),basis.view)};}
function uploaded(c,n,cam){
  const a=source.indexOf('    _draw(prog, n) {'),b=source.indexOf('\n  };',a),method=source.slice(a,b);
  const values={},gl={uniformMatrix4fv:(u,_t,m)=>{if(u)values[u]=Array.from(m)},bindVertexArray(){},drawArrays(){},TRIANGLES:4};
  Object.assign(c,{gl,values,node:n,camera:cam});
  vm.runInContext('globalThis.renderer={gl,_renderCamera:camera,_draw:function(prog,n)'+method.slice(method.indexOf('{'))+'};renderer._draw({u:{uModel:"model",uModelViewProj:"mvp",uModelLightVP:null}},node);',c);
  return values;
}
test('actual Node and renderer preserve sub-centimetre aircraft/weapon alignment at 350km',()=>{
  const c=load(),{Node}=c.api,offsets=[[0,0,0],[250000,3000,-350000]],frames=[];
  for(const offset of offsets){const root=new Node('aircraft');root.pos=offset.map((x,i)=>x+[.123456,1.987654,.876543][i]);root.yaw=.723;root.pitch=.17;root.roll=-.13;
    const mount=root.add(new Node('pylon'));mount.pos=[3.124567,-.54321,-.98765];mount.pitch=-.08;root.update();mount.mesh={vao:{},count:3};
    const cam=camera(c.api,offset),uploadedMatrices=uploaded(c,mount,cam),matrix=uploadedMatrices.mvp||c.api.mul(cam.viewProj,uploadedMatrices.model);
    frames.push([[0,0,0],[.004,.007,.003],[1.2,0,0]].map(p=>clip(matrix,p)));
    assert.deepEqual(uploadedMatrices.model,Array.from(mount.world),'authoritative matrix upload remains the original Float32 representation');
  }
  const error=Math.max(...frames[0].flatMap((p,i)=>p.map((v,k)=>Math.abs(v-frames[1][i][k])*1920/2)));
  assert.ok(error<.01,`translation alone moved the model ${error.toFixed(4)} pixels`);
});
test('actual tracer/particle/decal packing subtracts camera before Float32 upload',()=>{
  const c=load(),offsets=[[0,0,0],[250000,3000,-350000]],out=[];
  for(const offset of offsets){const fx=new c.api.Effects(20),p=v=>v.map((x,i)=>x+offset[i]);
    fx.decal(p([.123,1.456,2.789]),[.02,0,0],[0,.02,0],[1,1,1],1);
    fx.spawn({pos:p([.12,1.45,2.78]),size0:.01,life:2,color:[1,.5,.2]});fx.particles[0].seed=.123;
    fx.beam(p([.1,1.4,2.7]),p([.3,1.5,3.9]),.003,[1,1,1],1);
    fx.build(camera(c.api,offset));
    out.push([['alpha',9],['add',9],['softAlpha',13],['softAdd',13]].map(([key,stride])=>Array.from(fx[key].slice(0,fx[key+'Count']*stride))));
  }
  for(let kind=0;kind<4;kind++){assert.equal(out[0][kind].length,out[1][kind].length);for(let i=0;i<out[0][kind].length;i++)assert.ok(Math.abs(out[0][kind][i]-out[1][kind][i])<2e-6,`FX ${kind} float ${i} shifted by ${out[1][kind][i]-out[0][kind][i]}`);}
});
test('precision patch is idempotent, validates anchors, and keeps inset/shadow shaders wired',()=>{
  const candidate=patch(original);assert.equal(patch(candidate),candidate);
  assert.throws(()=>patch('bad input'),/anchor|boundary|math|renderer/i);
  assert.throws(()=>patch('/* TF_RENDER_PRECISION_BEGIN */'),/anchor|boundary|incomplete/i);
  for(const anchor of ['uModelViewProj','uModelLightVP','_renderCamera = cam','TFRenderPrecision.mvp'])assert.ok(candidate.includes(anchor),anchor);
});
test('aircraft quaternion root retains precise presentation translation and HUD agrees at far coordinates',()=>{
 const c=load(),frames=[];
 for(const offset of [[0,0,0],[250000,3000,-350000]]){
  const n=new c.api.Node(),p=offset.map((v,k)=>v+[.123456,1.987654,.876543][k]);n.local=c.api.quatMatrix(p,[0,Math.sin(.3),0,Math.cos(.3)]);n.update();n.mesh={vao:{},count:3};
  const cam=camera(c.api,offset),m=uploaded(c,n,cam).mvp;
  assert.ok(m,'precise projection must be uploaded');frames.push(clip(m,[0,0,0]));
  c.TFRenderPrecision.registerCamera(cam);const screen=c.api.project(cam.viewProj,p);assert.ok(Math.abs(screen[0]-frames.at(-1)[0])<1e-6);assert.ok(Math.abs(screen[1]-frames.at(-1)[1])<1e-6);
 }
 for(let k=0;k<2;k++)assert.ok(Math.abs(frames[0][k]-frames[1][k])<1e-7);
});
test('orthographic status inset keeps its authored projection',()=>{
 const c=load(),n=new c.api.Node();n.pos=[1.2,.3,2];n.update();n.mesh={vao:{},count:3};
 const cam={...camera(c.api,[0,0,0]),viewProj:c.api.ortho(-4,4,-3,3,1,120)};
 const m=uploaded(c,n,cam).mvp,expected=c.api.mul(cam.viewProj,n.world);
 for(let i=0;i<16;i++)assert.ok(Math.abs(m[i]-expected[i])<1e-6);
});
test('accepted replay world replacement overrides the earlier presentation pose',()=>{
 const c=load(),n=new c.api.Node();n.pos=[1,0,0];n.update();n.mesh={vao:{},count:3};
 const replacement=new Float32Array(n.world);replacement[12]=5;replacement[13]=2;n.world=replacement;
 const cam=camera(c.api,[0,0,0]),got=uploaded(c,n,cam).mvp;
 const expected=c.TFRenderPrecision.mvp(cam,replacement,new Float32Array(16));
 assert.deepEqual(got,Array.from(expected),'frozen accepted geometry must not reuse a stale live render transform');
});
