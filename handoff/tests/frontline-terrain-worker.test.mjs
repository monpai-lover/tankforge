import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
const helper=fs.readFileSync(new URL('../tools/frontline_terrain_worker.js',import.meta.url),'utf8');
function fixture(){
 const calls={mesh:[],free:[],messages:[],workers:[]},f={map:{id:'test'},root:{children:[],add(n){this.children.push(n);}},facilityPresentation:{ready:true}};
 class Node{constructor(name){this.name=name;this.children=[];}add(n){this.children.push(n);return n;}}
 const renderer={mesh(data){const m={data};calls.mesh.push(m);return m;},freeMesh(m){calls.free.push(m);}};
 const c=vm.createContext({f,renderer,Node,console,Float32Array});vm.runInContext(helper,c);
 const workerFactory=source=>{const worker={postMessage:m=>calls.messages.push(m),terminate(){this.terminated=true},source};calls.workers.push(worker);return worker;};
 const owner=c.createFrontlineTerrainWorker({f,renderer,Node,build:function(){},definitions:{},grid:function(){},height:function(){},workerFactory});
 const request=(x=0,aerial=true,facilityReady=true)=>owner.request({focus:[x,2,0],aerial,facilityReady});
 const deliver=key=>calls.workers[0].onmessage({data:{op:'built',key,origin:[0,0],aerial:true,stats:{},nodes:[0,1,2].map(i=>({name:'mesh'+i,data:new Float32Array(39),kind:20,castShadow:false}))}});
 return {calls,f,owner,request,deliver};
}
test('actual client routes moving Taiwan terrain through the worker rather than its synchronous builder',()=>{
 const source=fs.readFileSync(new URL('../tools/frontline_client.js',import.meta.url),'utf8');
 assert.ok(source.includes('createFrontlineTerrainWorker'),'current frame must own the worker');
 assert.ok(source.includes('rebuildTerrainImmediate'),'keep source-matched synchronous fallback');
});
test('coalesces newest cell, stages one upload per frame and atomically replaces complete terrain',()=>{
 const x=fixture();assert.equal(x.calls.messages[0].op,'map');x.request();x.request();x.request(750);x.request(1500);
 assert.equal(x.calls.messages.length,2,'one in-flight build');x.deliver('0:0:true:true');assert.equal(x.calls.mesh.length,0);assert.equal(x.calls.messages.at(-1).key,'1500:0:true:true');
 x.deliver('1500:0:true:true');for(let i=0;i<2;i++){x.request(1500);assert.equal(x.calls.mesh.length,i+1);assert.equal(x.f.terrain,undefined);}
 x.request(1500);assert.equal(x.f.terrain.children.length,3);assert.equal(x.owner.stats.swaps,1);
 const original=x.f.terrain;x.request(2250);x.deliver('2250:0:true:true');x.request(2250);assert.equal(x.f.terrain,original);x.request(3000);assert.equal(x.calls.free.length,1,'stale partial upload freed');assert.equal(x.f.terrain,original);
 x.owner.dispose();assert.ok(x.calls.workers[0].terminated);
});
test('worker or upload failure returns to explicit fallback and keeps prior complete geometry',()=>{
 const x=fixture();x.request();x.calls.workers[0].onmessage({data:{op:'error',message:'bad source'}});assert.equal(x.request(),false);assert.equal(x.owner.stats.errors,1);
 x.owner.dispose();
});
test('worker constructor failure revokes its Blob URL before synchronous fallback',()=>{
 const x=fixture(),calls=[],c=vm.createContext({Blob:class{},URL:{createObjectURL(){calls.push('create');return 'blob:test';},revokeObjectURL(url){calls.push(url);}},Worker:class{constructor(){throw Error('blocked');}}});
 vm.runInContext(helper,c);const owner=c.createFrontlineTerrainWorker({f:x.f,renderer:{},Node:class{},build:function(){},definitions:{},grid:function(){},height:function(){}});
 assert.equal(owner,null);assert.deepEqual(calls,['create','blob:test']);
});
test('actual serialized source can execute in an isolated worker and transfer Float32 geometry',async()=>{
 const x=fixture(),c=vm.createContext({Float32Array,console});vm.runInContext(helper,c);
 const workers=[];let message;
 const owner=c.createFrontlineTerrainWorker({f:x.f,renderer:{mesh(data){assert.ok(data instanceof Float32Array);return {data}},freeMesh(){}},Node:class{constructor(name){this.name=name;this.children=[];}add(n){this.children.push(n);return n;}},
 definitions:{m4:()=>new Float32Array(16)},grid:function(){return 0;},height:function(){return 0;},
 build:function(){f.terrain=new Node('terrain');const n=f.terrain.add(new Node('triangle'));n.mesh=renderer.mesh(new Float32Array([1,2,3]));f.terrainOrigin=[0,0];f.terrainAerial=true;},
 workerFactory(source){const w=new Worker('const {parentPort}=require("node:worker_threads");globalThis.self={postMessage:(data,transfer)=>parentPort.postMessage(data,transfer)};parentPort.on("message",data=>self.onmessage({data}));\n'+source,{eval:true});workers.push(w);const adapter={postMessage:m=>w.postMessage(m),terminate:()=>w.terminate()};w.on('message',data=>{message=data;adapter.onmessage?.({data});});w.on('error',error=>adapter.onerror?.(error));return adapter;}});
 try{owner.request({focus:[0,2,0],aerial:true,facilityReady:true});for(let i=0;i<100&&!message;i++)await new Promise(r=>setTimeout(r,10));assert.equal(message?.op,'built',message?.message);owner.request({focus:[0,2,0],aerial:true,facilityReady:true});assert.equal(owner.stats.swaps,1);assert.deepEqual(Array.from(x.f.terrain.children[0].mesh.data),[1,2,3]);}
 finally{owner.dispose();await Promise.all(workers.map(w=>w.terminate()));}
});
