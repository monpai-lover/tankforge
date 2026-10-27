import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const source=fs.readFileSync(new URL('../tools/frontline_client.js',import.meta.url),'utf8');
const section=(start,end)=>{const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a);return source.slice(a,b);};
const plain=value=>JSON.parse(JSON.stringify(value));
const map=id=>({schemaVersion:1,id,terrain:{x0:0,z0:0,width:2,height:2,cellX:100,cellZ:100,heights:[1,2,3,4],waterAreas:[]},bounds:{minX:0,maxX:100,minZ:0,maxZ:100},objectives:[{id:'A',pos:[20,4,30]}],initialScene:{objectiveIds:['A']},provenance:{terrain:'source terrain',roads:'source roads'},roads:[],airfields:[]});

test('map loading prepares Taiwan far terrain once before flight and replaces it only for a new map identity',async()=>{
  const f={room:{map:'taiwan'}},net={url:'ws://source.example/'},prepared=[],owners=[];
  const c=vm.createContext({f,net,URL,el:()=>({}),GeoBuilder:function(){},hexToLinear:()=>[.2,.3,.1],createFrontlineWaterCutout(){},height:()=>0,
    fetch:async()=>({ok:true,text:async()=>JSON.stringify(map(f.room.map))}),
    createFrontlineFarTerrainGeometry(options){prepared.push(options);const owner={stats:{gridCells:4},build(){throw Error('Far mesh should not rebuild during loading');}};owners.push(owner);return owner;}});
  vm.runInContext(section('      async function ensureMap(){','      function refreshGroundDeployment(){'),c);
  await c.ensureMap();
  assert.equal(prepared.length,1,'The distant source grid is prepared as part of map loading');
  assert.equal(prepared[0].terrain,f.map.terrain);assert.equal(prepared[0].bounds,f.map.bounds);assert.equal(prepared[0].step,4000);
  assert.equal(f.farTerrain,owners[0]);assert.equal(f.farTerrainMap,f.map);
  await c.ensureMap();assert.equal(prepared.length,1,'The same source map reuses its prepared coast cache');
  f.room.map='korea';await c.ensureMap();
  assert.equal(prepared.length,1,'The Taiwan presentation does not add a new distant terrain path to Korea');
  assert.equal(f.farTerrain,null);assert.equal(f.farTerrainMap,null);
  f.room.map='taiwan';await c.ensureMap();assert.equal(prepared.length,2);assert.equal(f.farTerrain,owners[1]);
});

class Node {
  constructor(name){this.name=name;this.children=[];}
  add(node){this.children.push(node);return node;}
}
class GeoBuilder {build(){return new Float32Array(0);}}
function scene(){
  const native=map('taiwan'),calls={near:[],far:[],water:[],regions:[],uploads:[],freed:[],height:[]},nearData=new Float32Array(39),farData=new Float32Array(78);
  const owner={stats:{gridCells:15930,cachedTriangles:43129},build(options){calls.far.push(options);return{data:farData,stats:{outputTriangles:2}};}};
  const f={map:native,focus:[32000,4500,82679],aircrafts:[],root:new Node('root'),terrainOrigin:null,facilityPresentation:{ready:true},farTerrain:owner,farTerrainMap:native};
  const c=vm.createContext({f,Node,GeoBuilder,Float32Array,IDENTITY:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],hexToLinear:()=>[.2,.3,.1],controlled:()=>({aircraft:'f86f'}),height:(x,z)=>{calls.height.push([x,z]);return 50+x*.001;},
    renderer:{mesh(data){const mesh={data,count:data.length/13};calls.uploads.push(mesh);return mesh;},freeMesh(mesh){calls.freed.push(mesh);}},
    createFrontlineWaterCutout(){return{region(bounds){calls.regions.push(bounds);return{clipTriangle:t=>[t]};}};},
    buildFrontlineTerrainGeometry(options){calls.near.push(options);return{data:nearData,stats:{vertices:3}};},
    buildFrontlineWaterGeometry(options){calls.water.push(options);return{data:new Float32Array(39),stats:{vertices:3}};}});
  vm.runInContext(section('      function rebuildTerrain(){','      function poseModel('),c);
  return{c,f,calls,owner,farData};
}
test('actual terrain rebuild uploads cached far land outside the exact near square with source grass and no shadows',()=>{
  const {c,f,calls,owner,farData}=scene();c.rebuildTerrain();
  assert.equal(calls.far.length,1,'The prepared distant terrain must reach the production scene');
  assert.deepEqual(plain(calls.far[0].detailBounds),{minX:19500,maxX:43500,minZ:70500,maxZ:94500});
  assert.equal(calls.far[0].detailStep,200);
  assert.equal(calls.far[0].detailSurface,calls.near[0].surface,'Far handoff shares the actual memoized near height sampler');
  assert.deepEqual(plain(calls.regions[0]),plain(calls.far[0].detailBounds));
  const far=f.terrain.children.find(n=>n.name==='far-source-terrain');
  assert.ok(far);assert.equal(far.kind,20);assert.equal(far.castShadow,false);assert.equal(far.mesh.data,farData);
  assert.equal(f.farTerrainStats.prepared,owner.stats);assert.equal(f.farTerrainStats.last.outputTriangles,2);
  c.rebuildTerrain();assert.equal(calls.far.length,1,'A stationary view does not rebuild or upload any far geometry');
  f.focus[0]+=750;c.rebuildTerrain();
  assert.equal(calls.far.length,2);assert.ok(calls.freed.includes(far.mesh),'Moving detail releases the previous far GPU mesh');
  assert.equal(f.farTerrain,owner,'The whole-source coast cache survives750m near shifts');
});

test('an old or absent distant owner cannot render land from another accepted map',()=>{
  for(const stale of[false,true]){
    const {c,f,calls}=scene();if(stale)f.farTerrainMap=map('taiwan');else f.farTerrain=null;
    c.rebuildTerrain();assert.equal(calls.far.length,0);assert.ok(!f.terrain.children.some(n=>n.name==='far-source-terrain'));
    assert.equal(calls.near.length,1,'The current accepted near map still renders normally');
  }
});
