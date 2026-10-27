import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const map=JSON.parse(fs.readFileSync(new URL('../../data/frontline/korea.json',import.meta.url),'utf8'));
const client=fs.readFileSync(new URL('../tools/frontline_client.js',import.meta.url),'utf8');
const app=fs.readFileSync(new URL('../bundle/app.js.html',import.meta.url),'utf8');
function section(source,a,b){const i=source.indexOf(a),j=source.indexOf(b,i);assert.ok(i>=0&&j>i,a);return source.slice(i,j);}
function sampler(extra={}){const c=vm.createContext({f:{map},clamp:(x,a,b)=>Math.max(a,Math.min(b,x)),...extra});vm.runInContext(section(client,'      function grid(','      async function ensureMap('),c);return c;}

test('actual shared client height matches all Python source/road/patch/pad/runway probes',()=>{
  const c=sampler();assert.ok(map.sampling.validationProbes.length>150);
  for(const p of map.sampling.validationProbes)assert.ok(Math.abs(c.height(p.x,p.z)-p.height)<1e-6,JSON.stringify(p));
  assert.ok(map.sampling.wetValidationProbes.some(p=>p.expectedSupported));
  assert.ok(map.sampling.wetValidationProbes.some(p=>!p.expectedSupported));
});

test('every physical strip has complete signed spatial cells and no duplicate/invalid candidate indices',()=>{
  const beds=map.terrain.roadbeds;assert.equal(beds.cellSize,256);
  for(const [key,indices]of Object.entries(beds.cells)){
    assert.match(key,/^-?\d+,-?\d+$/);
    assert.ok(indices.every((v,i)=>Number.isInteger(v)&&v>=0&&v<beds.segments.length&&(!i||indices[i-1]<v)),key);
  }
  for(const [i,s]of beds.segments.entries()){
    const [ax,az,ah,bx,bz,bh,width,blend]=s,length=Math.hypot(bx-ax,bz-az),nx=-(bz-az)/length,nz=(bx-ax)/length;
    for(const t of [0,.5,1])for(const offset of [0,width,width+blend-.01,-width-blend+.01]){
      const x=ax+(bx-ax)*t+nx*offset,z=az+(bz-az)*t+nz*offset,key=`${Math.floor(x/256)},${Math.floor(z/256)}`;
      assert.ok(beds.cells[key]?.includes(i),`${i} ${key}`);
    }
  }
});

test('production is three actual road fronts/15 objectives/six nonoverlapping sources; C2 stays explicit test-only',()=>{
  assert.equal(map.initialScene.objectiveIds.length,15);assert.equal(map.initialScene.aiStagingIds.length,6);
  const roads=map.roads.filter(r=>r.connected&&r.navEnabled);assert.equal(roads.length,12);
  for(const lane of ['west','centre','east'])assert.equal(roads.filter(r=>r.lane===lane).length,4);
  const ids=new Set(map.objectives.map(o=>o.id));
  for(const r of roads){assert.ok(ids.has(r.from)&&ids.has(r.to));assert.ok(r.sourceWayIds.length);assert.equal(r.halfWidth,8);assert.ok(r.surfaceProof.maximumAlongGradePercent<=15);assert.ok(r.surfaceProof.maximumCrossGradePercent<=15);}
  const sources=map.staging.filter(s=>s.enabled);assert.equal(sources.length,6);
  for(const s of sources){assert.equal(s.spawnSlots.length,10);assert.ok(roads.some(r=>r.id===s.roadId));assert.ok(ids.has(s.objectiveId));}
  for(let i=0;i<sources.length;i++)for(const s of sources.slice(i+1))assert.ok(Math.hypot(s.pos[0]-sources[i].pos[0],s.pos[2]-sources[i].pos[2])>=300);
  assert.equal(map.roads.find(r=>r.id==='centre:C2-local-test').navEnabled,false);
  assert.equal(map.staging.find(s=>s.id==='B-C2-TEST').enabled,false);
  assert.deepEqual(map.fixtures.c2.initialScene.objectiveIds,['C2']);
  assert.equal(map.navigation.surfaceAdmissionProof.passes,true);
});

test('actual renderer builder creates water from native polygons and thick physical decks on the same sampler',()=>{
  const bridge=map.terrain.bridges[0],segment=map.terrain.roadbeds.segments[bridge.roadbedSegments[0]];
  const state={map,focus:[(segment[0]+segment[3])/2,segment[2],(segment[1]+segment[4])/2],facilityPresentation:{ready:false},aircrafts:[],follow:null};
  let uploads=0,freed=0;
  const renderer={mesh(data){uploads++;return{data,count:data.length/13}},freeMesh(){freed++}};
  const c=sampler({f:state,renderer,controlled:()=>null});
  vm.runInContext(app.slice(app.indexOf('  function m4()'),app.indexOf('  // client/web/src/game/relief.js')),c);
  vm.runInContext(fs.readFileSync(new URL('../tools/frontline_bridge_geometry.js',import.meta.url),'utf8'),c);
  vm.runInContext(fs.readFileSync(new URL('../tools/frontline_water_cutout.js',import.meta.url),'utf8'),c);
  vm.runInContext(fs.readFileSync(new URL('../tools/frontline_terrain_geometry.js',import.meta.url),'utf8'),c);
  state.root=new c.Node('test-root');
  vm.runInContext(section(client,'      function rebuildTerrain(){','      function poseModel('),c);
  const before=JSON.stringify(map);c.rebuildTerrain();assert.equal(uploads,6);
  const meshes=Object.fromEntries(state.terrain.children.map(n=>[n.name,n.mesh]));
  const nodes=Object.fromEntries(state.terrain.children.map(n=>[n.name,n]));
  assert.equal(nodes.terrain.kind,20);assert.ok(!nodes.terrain.terrain,'Canonical XYZ must not enter the legacy vertex displacement');
  assert.equal(nodes['registered-water-polygons'].kind,22,'Canonical water writes actual surface depth without an invented seabed');
  for(const name of ['source-roads','authored-operational-runways']){assert.equal(nodes[name].kind,21);assert.equal(nodes[name].castShadow,false);}
  assert.equal(nodes['registered-water-polygons'].castShadow,false);
  for(const name of ['authored-physical-bridge-decks','authored-physical-bridge-shells']){assert.equal(nodes[name].kind,21);assert.equal(nodes[name].castShadow,true,'Solid bridge geometry remains a caster');}
  const decks=meshes['authored-physical-bridge-decks'].data,shell=meshes['authored-physical-bridge-shells'].data,water=meshes['registered-water-polygons'].data;
  assert.ok(decks.length>0&&shell.length>0&&water.length>0);assert.ok(decks.every(Number.isFinite)&&shell.every(Number.isFinite)&&water.every(Number.isFinite));
  let upward=false,downward=false;
  for(let i=0;i<decks.length;i+=13)upward||=decks[i+4]>.9;
  for(let i=0;i<shell.length;i+=13)downward||=shell[i+4]<-.9;
  assert.ok(upward&&downward,'Decks have top and bottom surfaces, not only a scope label');
  for(let i=0;i<water.length;i+=13)assert.ok(water[i+4]>.999,'Actual water triangles face up');
  const topY=decks[1],bottomY=shell[1];assert.ok(Math.abs(Math.abs(topY-bottomY)-1)<.02,'Physical deck thickness is1m');
  assert.deepEqual(Array.from(state.terrain.children.find(n=>n.name==='authored-physical-bridge-decks').polygonOffset),[-1,-1],'Coplanar top uses draw-only depth bias');
  assert.ok(meshes.terrain.count/3>20000,'Road-adjacent terrain uses finer canonical samples');
  c.rebuildTerrain();assert.equal(uploads,6,'Unchanged ROI does not rebuild GPU resources');
  state.focus[0]+=750;c.rebuildTerrain();assert.equal(freed,6,'All owned terrain/road/water/deck/runway meshes freed on ROI replacement');
  assert.equal(JSON.stringify(map),before,'Rendering cannot grade the canonical map or grant navigation');
});
