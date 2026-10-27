// CPU probe of the actual frontend terrain rebuild, not a rendered FPS claim.
import fs from 'node:fs';
import vm from 'node:vm';
import {performance} from 'node:perf_hooks';
const app=fs.readFileSync(new URL('../bundle/app.js.html',import.meta.url),'utf8'),client=fs.readFileSync(new URL('../tools/frontline_client.js',import.meta.url),'utf8');
const section=(s,a,b)=>s.slice(s.indexOf(a),s.indexOf(b,s.indexOf(a)));
const map=JSON.parse(fs.readFileSync(new URL('../../data/frontline/taiwan.json',import.meta.url),'utf8'));
const c=vm.createContext({console,performance,Float32Array,Float64Array,Uint8Array,Uint32Array,Map,Set});
vm.runInContext(section(app,'  function m4()','  // client/web/src/game/relief.js')+'\n'+fs.readFileSync(new URL('../tools/frontline_water_cutout.js',import.meta.url),'utf8')+'\n'+fs.readFileSync(new URL('../tools/frontline_terrain_geometry.js',import.meta.url),'utf8'),c);
const upload={count:0,bytes:0},f={map,focus:[32000,4500,82679],root:new c.Node(),aircrafts:[],facilityPresentation:{ready:true}};
Object.assign(c,{f,clamp:(x,a,b)=>Math.max(a,Math.min(b,x)),controlled:()=>({aircraft:'f15c'}),unitKey:()=>'',renderer:{mesh(data){upload.count++;upload.bytes+=data.byteLength;return {_src:{data},count:data.length/13}},freeMesh(){}}});
vm.runInContext(section(client,'      function grid(g,x,z){','      async function ensureMapOptions')+section(client,'      function rebuildTerrain(){','      function poseModel'),c);
const start=performance.now();f.farTerrain=c.createFrontlineFarTerrainGeometry({GeoBuilder:c.GeoBuilder,terrain:map.terrain,bounds:map.bounds,step:4000,createWaterCutout:c.createFrontlineWaterCutout,material:{color:[.2,.3,.1],rough:1,metal:0}});f.farTerrainMap=map;
const preparedMs=performance.now()-start,samples=[];
for(let i=0;i<4;i++){const t=performance.now();c.rebuildTerrain();samples.push({x:f.focus[0],ms:performance.now()-t,stats:f.terrainStats,far:f.farTerrainStats?.last});f.focus[0]+=750;}
const result={scope:'Actual current frontend rebuild CPU, no GL or browser FPS',preparedMs,upload,samples};
if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
