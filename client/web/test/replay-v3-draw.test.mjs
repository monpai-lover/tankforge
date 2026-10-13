import test from 'node:test';
import assert from 'node:assert/strict';
import {m4,Node} from '../src/gfx/math.js';
let api;try{api=await import('../src/gfx/replayDraw.js');}catch{}
function gl(){let id=0;const calls=[],deleted=[];return {calls,deleted,ARRAY_BUFFER:1,DYNAMIC_DRAW:2,FLOAT:3,TRIANGLE_STRIP:4,TRIANGLES:5,POINTS:6,BLEND:7,SRC_ALPHA:8,ONE_MINUS_SRC_ALPHA:9,DEPTH_TEST:10,createBuffer:()=>({id:++id}),createVertexArray:()=>({id:++id}),deleteBuffer:x=>deleted.push(x),deleteVertexArray:x=>deleted.push(x),deleteProgram:x=>deleted.push(x),bindVertexArray(){},bindBuffer(){},bufferData(){},bufferSubData(...a){calls.push(['upload',...a]);},enableVertexAttribArray(){},vertexAttribPointer(){},vertexAttribDivisor(){},useProgram(){},uniformMatrix4fv(){},uniform2f(){},uniform1f(){},enable(){},disable(){},blendFunc(){},depthMask(x){calls.push(['depth',x]);},drawArraysInstanced(...a){calls.push(['draw',...a]);}};}
test('V3 trace/shard/field buffers reuse identical prepared frames and never write transparent depth',()=>{
  assert.equal(typeof api?.ReplayGpu,'function');const g=gl(),gpu=new api.ReplayGpu(g,()=>({p:{},u:{}})),p={frameId:1,instances:new Float32Array(24),count:2,physicalS:.2};
  gpu.upload(p);gpu.draw(m4(),[640,360],p);gpu.upload(p);gpu.draw(m4(),[320,180],p);
  assert.equal(g.calls.filter(c=>c[0]==='upload').length,2,'one trace and one timed-effect buffer upload with no resampling or duplicate identical-view uploads');assert.equal(g.calls.filter(c=>c[0]==='draw').length,8);assert.ok(g.calls.filter(c=>c[0]==='depth').every(c=>c[1]===false));
  const data=Array.from(p.instances);assert.deepEqual(Array.from(p.instances),data);gpu.dispose();const n=g.deleted.length;gpu.dispose();assert.equal(g.deleted.length,n);
});
test('semantic crew damage cannot tint a neighboring breech, barrel or furnishing',()=>{
  assert.equal(typeof api?.ReplayDraw,'function');const root=new Node('root'),crew=root.add(new Node('crew')),seat=root.add(new Node('seat')),barrel=root.add(new Node('barrel')),breech=root.add(new Node('breech'));
  for(const n of [crew,seat,barrel,breech])n.mesh={};crew.replayRole='crew';crew.replayCrewIndex=0;seat.replayRole='furnishing';barrel.replayRole='barrel';breech.replayRole='breech';root.update();
  const target={model:{root},interior:()=>({nodes:[crew,seat,breech],byCrew:[crew],byModule:new Map([['breech',[breech]]]),updateLaunchers(){}})},draw=new api.ReplayDraw(null,target,null);
  const frame={id:1,physicalS:1,traces:[],staticTraces:[],projectiles:[],event:{contact_s:0,evidence:{report:{modules:[],crew:[{index:0,killed:true,health:0}]}}},state:null};draw.prepare(frame);
  assert.ok(crew.highlight[0]>0);for(const n of [seat,barrel,breech])assert.equal(n.highlight?.[3]||0,0);assert.equal(barrel.kind,14);assert.equal(crew.kind,13);
});

test('one prepared view preserves both arrived hits and waits for each linked recorded arrival',()=>{
  const root=new Node('root'),crew=root.add(new Node('crew')),breech=root.add(new Node('breech'));crew.mesh=breech.mesh={};root.update();
  const inner={nodes:[crew,breech],byCrew:[crew],byModule:new Map([['breech',[breech]]])},draw=new api.ReplayDraw(null,{model:{root},interior:()=>inner},null);
  const first={contact_s:0,traces:[],evidence:{report:{modules:[],crew:[{index:0,health:0,killed:true}]}}},second={contact_s:.1,traces:[{hit:'breech',end_s:.5}],evidence:{report:{modules:[{id:'breech',index:0,health:0,max_health:100,destroyed:true}],crew:[]}}};
  const frame={id:1,physicalS:.2,event:second,records:[first,second],traces:[],staticTraces:[],projectiles:[],state:{crew:[0],modules:[0]}};draw.prepare(frame);
  assert.ok(crew.highlight[3]>0,'first hit remains visible beside the second');assert.equal(breech.highlight[3],0,'second linked traversal has not arrived');
  draw.prepare({...frame,id:2,physicalS:.6});assert.ok(crew.highlight[3]>0);assert.ok(breech.highlight[3]>0);
  draw.prepare({...frame,id:3,physicalS:.7,state:{crew:[0],modules:[100]}});assert.equal(breech.highlight[3],0,'known repair state clears only repaired damage');
});

test('untimed static records draw only their retained reference lines without animated shards or fields',()=>{
  const root=new Node('root'),draw=new api.ReplayDraw(null,{model:{root},interior:()=>null},null),g=gl(),gpu=new api.ReplayGpu(g,()=>({p:{},u:{}}));
  const frame={id:11,physicalS:2,projectiles:[],traces:[],staticTraces:[{from:[0,0,0],to:[1,0,0],kind:4}],event:null};
  const p=draw.prepare(frame);assert.equal(p.count,1);assert.equal(p.dynamicCount,0);gpu.upload(p);gpu.draw(m4(),[640,360],p);
  assert.deepEqual(g.calls.filter(c=>c[0]==='draw').map(c=>[c[1],c[4]]),[[g.TRIANGLE_STRIP,1],[g.TRIANGLE_STRIP,1]],'unknown timing cannot animate a burst field or moving shard');gpu.dispose();
});

test('opposed replay cameras sort trace and shard centers independently from the identical immutable physical frame',()=>{
  const g=gl(),gpu=new api.ReplayGpu(g,()=>({p:{},u:{}})),instances=new Float32Array(24);instances[2]=instances[5]=1;instances[14]=instances[17]=9;
  const before=Array.from(instances),p=Object.freeze({frameId:90,instances,count:2,dynamicCount:2,physicalS:.3});gpu.upload(p);gpu.draw(m4(),[640,360],p,[0,0,1]);
  assert.deepEqual(gpu.viewOrder,[1,0]);const first=Array.from(gpu.viewInstances.subarray(0,24));gpu.draw(m4(),[320,180],p,[0,0,-1]);assert.deepEqual(gpu.viewOrder,[0,1]);
  assert.equal(first[2],9);assert.equal(gpu.viewInstances[2],1);assert.deepEqual(Array.from(instances),before);assert.equal(gpu.last,p);gpu.dispose();
});
