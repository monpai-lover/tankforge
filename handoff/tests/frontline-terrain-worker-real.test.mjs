import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {Worker} from 'node:worker_threads';
import {performance} from 'node:perf_hooks';
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8'),app=read('../bundle/app.js.html'),client=read('../tools/frontline_client.js');
const section=(s,a,b)=>{const x=s.indexOf(a),y=s.indexOf(b,x);assert.ok(x>=0&&y>x);return s.slice(x,y);};
const map=JSON.parse(read('../../data/frontline/taiwan.json')),material={color:[.2,.3,.1],rough:1,metal:0};
test('full Taiwan geometry in actual worker is byte-identical to source builder across moving cells',async()=>{
 const c=vm.createContext({console,performance}),uploads=[];
 vm.runInContext(section(app,'  function m4()','  // client/web/src/game/relief.js')+'\n'+read('../tools/frontline_water_cutout.js')+'\n'+read('../tools/frontline_terrain_geometry.js')+'\n'+read('../tools/frontline_bridge_geometry.js')+'\n'+read('../tools/frontline_terrain_worker.js'),c);
 const f={map,focus:[32000,4500,82679],root:new c.Node(),aircrafts:[],facilityPresentation:{ready:true}};
 const renderer={mesh(data){uploads.push(data.byteLength);return {_src:{data},data,count:data.length/13}},freeMesh(){}};
 Object.assign(c,{f,clamp:(x,a,b)=>Math.max(a,Math.min(b,x)),controlled:()=>({aircraft:'f15c'}),unitKey:()=>'',renderer});
 vm.runInContext(section(client,'      function grid(g,x,z){','      async function ensureMapOptions')+section(client,'      function rebuildTerrain(){','      function poseModel'),c);
 f.farTerrain=c.createFrontlineFarTerrainGeometry({GeoBuilder:c.GeoBuilder,terrain:map.terrain,bounds:map.bounds,step:4000,createWaterCutout:c.createFrontlineWaterCutout,material:{...material,color:c.hexToLinear('#6e7954')}});f.farTerrainMap=map;
 const digest=data=>crypto.createHash('sha256').update(new Uint8Array(data.buffer,data.byteOffset,data.byteLength)).digest('hex');
 const snapshot=()=>f.terrain.children.map(n=>({name:n.name,kind:n.kind,shadow:n.castShadow,sha:digest(n.mesh.data),bytes:n.mesh.data.byteLength}));
 const expected=[];for(const x of [32000,32750]){f.focus[0]=x;c.rebuildTerrainImmediate();expected.push(snapshot());}
 f.terrain=null;f.terrainOrigin=null;f.root.children=[];
 const definitions=Object.fromEntries('m4 mul translation scaling rotX rotY rotZ compose sub add scale dot cross len norm transformPoint transformDir triangulate hexToLinear GeoBuilder buildFrontlineTerrainGeometry buildFrontlineWaterGeometry buildFrontlineBridgeGeometry createFrontlineWaterCutout createFrontlineFarTerrainGeometry'.split(' ').map(k=>[k,c[k]]));
 let worker;const owner=c.createFrontlineTerrainWorker({f,renderer,Node:c.Node,build:c.rebuildTerrainImmediate,grid:c.grid,height:c.height,definitions,
 workerFactory(source){worker=new Worker('const {parentPort}=require("node:worker_threads");globalThis.self={postMessage:(data,transfer)=>parentPort.postMessage(data,transfer)};parentPort.on("message",data=>self.onmessage({data}));\n'+source,{eval:true});const adapter={postMessage:m=>worker.postMessage(m),terminate:()=>worker.terminate()};worker.on('message',data=>adapter.onmessage?.({data}));worker.on('error',error=>adapter.onerror?.(error));return adapter;}});
 const stats={ticks:0,maxTimerDelayMs:0,maxRequestMs:0};
 try{let last=performance.now();for(let i=0;i<2;i++){
   f.focus=[32000+i*750,4500,82679];const target=owner.stats.swaps+1,deadline=performance.now()+20000;
   while(owner.stats.swaps<target&&performance.now()<deadline){const start=performance.now();stats.maxTimerDelayMs=Math.max(stats.maxTimerDelayMs,start-last-5);owner.request({focus:f.focus,aerial:true,facilityReady:true});stats.maxRequestMs=Math.max(stats.maxRequestMs,performance.now()-start);assert.equal(owner.failed,false,owner.stats.error);stats.ticks++;last=performance.now();await new Promise(r=>setTimeout(r,5));}
   assert.equal(owner.stats.swaps,target,'worker must complete geometry');assert.deepEqual(snapshot(),expected[i]);
 }
 console.log(JSON.stringify({proof:'actual_Taiwan_worker_geometry_byte_parity',...stats,worker:owner.stats,expected}));}
 finally{owner.dispose();await worker.terminate();}
});
