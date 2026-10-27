import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const app=fs.readFileSync(new URL('../bundle/app.js.html',import.meta.url),'utf8');
const helper=fs.readFileSync(new URL('../tools/frontline_terrain_geometry.js',import.meta.url),'utf8');
const water=fs.readFileSync(new URL('../tools/frontline_water_cutout.js',import.meta.url),'utf8');
const c=vm.createContext({});
vm.runInContext(app.slice(app.indexOf('  function m4()'),app.indexOf('  // client/web/src/game/relief.js'))+water+helper,c);
const GeoBuilder=c.GeoBuilder,material={color:[.2,.3,.1],rough:1,metal:0},roi={center:[0,0],radius:50};
const dry={clipTriangle:t=>[t]},plain=x=>JSON.parse(JSON.stringify(x));
function build(extra={}){return c.buildFrontlineTerrainGeometry({GeoBuilder,roi,coarseStep:50,fineStep:10,needsFine:(x,z)=>x<0&&z<0,surface:(x,z)=>5+.1*x+.2*z,waterCutoutRegion:dry,material,...extra});}
const tris=data=>Array.from({length:data.length/39},(_,i)=>Array.from({length:3},(_,j)=>Array.from(data.slice(i*39+j*13,i*39+j*13+3))));
const key=p=>p.join(','),cross=(a,b,c)=>(b[0]-a[0])*(c[2]-a[2])-(b[2]-a[2])*(c[0]-a[0]);
const area=data=>tris(data).reduce((sum,t)=>sum+Math.abs(cross(...t))/2,0);
const close=(a,b,e=1e-5)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
function topology(data,bounds={minX:-50,maxX:50,minZ:-50,maxZ:50}){
  const vertices=new Map(),edges=new Map();
  for(const t of tris(data)){
    for(const p of t)vertices.set(key(p),p);
    for(let i=0;i<3;i++){const a=t[i],b=t[(i+1)%3],k=[key(a),key(b)].sort().join('|');const e=edges.get(k)||{a,b,count:0};e.count++;edges.set(k,e);}
  }
  for(const e of edges.values()){
    assert.ok(e.count<=2,'Manifold terrain edge cannot have more than two incident triangles');
    if(e.count===1)assert.ok((e.a[0]===bounds.minX&&e.b[0]===bounds.minX)||(e.a[0]===bounds.maxX&&e.b[0]===bounds.maxX)||(e.a[2]===bounds.minZ&&e.b[2]===bounds.minZ)||(e.a[2]===bounds.maxZ&&e.b[2]===bounds.maxZ),`Unpaired interior edge ${key(e.a)} -> ${key(e.b)}`);
    const dx=e.b[0]-e.a[0],dz=e.b[2]-e.a[2],l2=dx*dx+dz*dz;
    for(const p of vertices.values()){
      const u=((p[0]-e.a[0])*dx+(p[2]-e.a[2])*dz)/l2;
      if(u<=1e-7||u>=1-1e-7)continue;
      assert.ok(Math.abs((p[0]-e.a[0])*dz-(p[2]-e.a[2])*dx)>1e-6,`T-junction at ${key(p)} on ${key(e.a)} -> ${key(e.b)}`);
    }
  }
}

test('actual GeoBuilder stitches both coarse/fine interfaces without T-junctions and retains all fine-cell triangles',()=>{
  const r=build();close(area(r.data),10000);topology(r.data);
  assert.equal(r.stats.fineCells,1);assert.equal(r.stats.coarseCells,3);assert.equal(r.stats.fanCells,2);assert.equal(r.stats.stitchedEdges,2);assert.equal(r.stats.sourceTriangles,68);
  const ts=tris(r.data).slice(0,50);
  let i=0;for(let z=-50;z<0;z+=10)for(let x=-50;x<0;x+=10){const v=(x,z)=>[x,Math.fround(5+.1*x+.2*z),z];assert.deepEqual(ts[i++],[v(x,z),v(x,z+10),v(x+10,z)]);assert.deepEqual(ts[i++],[v(x+10,z),v(x,z+10),v(x+10,z+10)]);}
  assert.ok(tris(r.data).every(t=>cross(...t)<0),'Every top triangle retains original upward winding');
});
test('steep canonical cut/fill remains real while every shared edge uses the same sampled vertices',()=>{
  const surface=(x,z)=>100-15*Math.max(0,1-Math.abs(x)/30)+.05*z+Math.sin(z/9),r=build({surface});
  topology(r.data);close(area(r.data),10000);
  for(let i=0;i<r.data.length;i+=13)assert.equal(r.data[i+1],Math.fround(surface(r.data[i],r.data[i+2])));
  for(const z of [-50,-40,-30,-20,-10,0])assert.ok(tris(r.data).flat().some(p=>p[0]===0&&p[2]===z&&p[1]===Math.fround(surface(0,z))));
  assert.ok(r.data.some((v,i)=>i%13===1&&v<88),'The authored15m trench is preserved, not flattened for appearance');
});
test('aerial200/25 subdivisions use the same conforming topology with a fractional world origin',()=>{
  const roi={center:[123.25,-456.5],radius:200},r=build({roi,coarseStep:200,fineStep:25,needsFine:(x,z)=>x<roi.center[0]&&z<roi.center[1]});
  close(area(r.data),160000,.01);topology(r.data,{minX:roi.center[0]-200,maxX:roi.center[0]+200,minZ:roi.center[1]-200,maxZ:roi.center[1]+200});
  assert.equal(r.stats.sourceTriangles,152);assert.equal(r.stats.stitchedEdges,2);
});
test('registered hole-aware water cutout removes only water and leaves dry island/shore geometry',()=>{
  const rect=(x0,z0,x1,z1)=>({triangles:[[x0,z0,x1,z0,x1,z1],[x0,z0,x1,z1,x0,z1]]});
  const source=[rect(-40,-40,40,-10),rect(-40,10,40,40),rect(-40,-10,-10,10),rect(10,-10,40,10)],before=JSON.stringify(source),surface=(x,z)=>5+.1*x+.2*z;
  const cut=c.createFrontlineWaterCutout(source,surface).region({minX:-50,maxX:50,minZ:-50,maxZ:50}),r=build({surface,waterCutoutRegion:cut});
  close(area(r.data),4000,.005);assert.equal(JSON.stringify(source),before);
  const inside=(p,t)=>{const d=[0,1,2].map(i=>cross(t[i],t[(i+1)%3],p));return d.every(v=>v>=-1e-5)||d.every(v=>v<=1e-5);};
  assert.ok(tris(r.data).some(t=>inside([0,5,0],t)),'Actual dry hole remains covered');
  assert.ok(!tris(r.data).some(t=>inside([20,7,0],t)),'Registered water interior remains absent');
  for(const t of tris(r.data)){const x=t.reduce((s,p)=>s+p[0],0)/3,z=t.reduce((s,p)=>s+p[2],0)/3;assert.ok(!(Math.abs(x)<39.999&&Math.abs(z)<39.999&&(Math.abs(x)>10.001||Math.abs(z)>10.001)));}
});
test('shared normals are area-weighted from actual uploaded triangles and require no derivative height queries',()=>{
  let calls=0;const surface=(x,z)=>{calls++;return 5+.002*x*x+.001*z*z;},r=build({surface}),sums=new Map(),normals=new Map();
  assert.equal(calls,r.stats.sourceHeightSamples);
  for(let i=0;i<r.data.length;i+=39){const p=[0,13,26].map(k=>Array.from(r.data.slice(i+k,i+k+3))),u=p[1].map((v,j)=>v-p[0][j]),v=p[2].map((v,j)=>v-p[0][j]),n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];for(const a of p){const k=key(a),s=sums.get(k)||[0,0,0];for(let j=0;j<3;j++)s[j]+=n[j];sums.set(k,s);}}
  for(let i=0;i<r.data.length;i+=13){const k=key(Array.from(r.data.slice(i,i+3))),n=Array.from(r.data.slice(i+3,i+6)),s=sums.get(k),length=Math.hypot(...s);assert.deepEqual(n,s.map(v=>Math.fround(v/length)));if(normals.has(k))assert.deepEqual(n,normals.get(k));normals.set(k,n);close(Math.hypot(...n),1,1e-6);assert.ok(n[1]>0);}
  assert.equal(normals.size,r.stats.sharedNormalVertices);assert.equal(r.stats.degenerateUploadedTriangles,0);
});
test('all-coarse and all-fine original sample positions and triangle order remain unchanged',()=>{
  for(const selected of [false,true]){
    const r=build({needsFine:()=>selected}),step=selected?10:50,expected=[];
    const p=(x,z)=>[x,Math.fround(5+.1*x+.2*z),z];
    // Production ordering visits each coarse cell, then its fine rows.
    for(let cz=-50;cz<50;cz+=50)for(let cx=-50;cx<50;cx+=50)for(let z=cz;z<cz+50;z+=step)for(let x=cx;x<cx+50;x+=step)expected.push([p(x,z),p(x,z+step),p(x+step,z)],[p(x+step,z),p(x,z+step),p(x+step,z+step)]);
    assert.deepEqual(tris(r.data),expected);assert.equal(r.stats.fanCells,0);topology(r.data);
  }
});
test('source/clip positions, ROI alignment, material and selection must remain finite and explicit',()=>{
  assert.throws(()=>build({surface:()=>NaN}),/Nonfinite canonical/);
  assert.throws(()=>build({waterCutoutRegion:{clipTriangle:()=>[[[0,0,0],[1,Infinity,0],[0,0,1]]]}}),/Nonfinite clipped/);
  assert.throws(()=>build({roi:{center:[Infinity,0],radius:50}}),/ROI/);
  assert.throws(()=>build({fineStep:7}),/divide/);assert.throws(()=>build({roi:{center:[0,0],radius:49}}),/divide/);
  assert.throws(()=>build({needsFine:()=>1}),/boolean/);assert.throws(()=>build({material:{...material,color:[NaN,0,0]}}),/material/);
  const before=JSON.stringify({roi,material});build();assert.equal(JSON.stringify({roi,material}),before);
});

// Exact original loop captured from the frozen, actually rendered350f4ac45f41 page.
// Keep this independent oracle when production switches to the conforming helper.
const legacyCellSourceSha256="845a4dac7401022a143cb5965b52c1904a0918f87b3f0539db880c5d5f234d31";
const legacyCellLoops=fs.readFileSync(new URL('./fixtures/frontline-terrain-legacy-loop.js',import.meta.url),'utf8');
const legacyCellProvenance=JSON.parse(fs.readFileSync(new URL('./fixtures/frontline-terrain-legacy-loop.provenance.json',import.meta.url),'utf8'));

function sourceKorea(){
  const bytes=fs.readFileSync(new URL('../../data/frontline/korea.json',import.meta.url)),map=JSON.parse(bytes),client=fs.readFileSync(new URL('../tools/frontline_client.js',import.meta.url),'utf8');
  const sc=vm.createContext({f:{map},clamp:(n,a,b)=>Math.max(a,Math.min(b,n))});
  const a=client.indexOf('      function grid(g,x,z){'),b=client.indexOf('      async function ensureMapOptions(',a);
  assert.ok(a>=0&&b>a);vm.runInContext(client.slice(a,b),sc);
  const n=client.indexOf('        const beds=f.map.terrain.roadbeds;',client.indexOf('      function rebuildTerrain(){')),e=client.indexOf('        const terrain=buildFrontlineTerrainGeometry(',n);
  assert.ok(n>=0&&e>n);vm.runInContext(client.slice(n,e)+';globalThis.actualSourceNearRoad=nearRoad;',sc);
  // Execute the unchanged production renderer's pre-helper loops as the oracle,
  // not a fresh copy of the new conforming algorithm.
  assert.equal(legacyCellProvenance.source.appSha256,'350f4ac45f4128aeceba9bf37cd559aa93110e879775baa8d2fe93b292d11fda');
  assert.equal(legacyCellProvenance.fixture.bytes,Buffer.byteLength(legacyCellLoops));
  assert.equal(legacyCellProvenance.fixture.sha256,legacyCellSourceSha256);
  assert.equal(crypto.createHash('sha256').update(legacyCellLoops).digest('hex'),legacyCellSourceSha256);
  vm.runInContext(`function actualLegacyTerrain({cx,cz,radius,step,aerial,surface,dryTerrain,nearRoad,material}){const b=new GeoBuilder();${legacyCellLoops}return b.build();}`,c);
  return {map,sc,mapSha256:crypto.createHash('sha256').update(bytes).digest('hex'),before:JSON.stringify(map)};
}
function actualRoi(source,roi){
  const {map,sc}=source,cache=new Map(),known=new Set(),sampleCoordinates=new Set();let calls=0,canonicalComputations=0;
  const canonical=(x,z)=>{canonicalComputations++;const h=sc.height(x,z);sampleCoordinates.add(x+','+z);known.add([Math.fround(x),Math.fround(h),Math.fround(z)].join(','));return h;};
  const surface=(x,z)=>{calls++;const k=x+','+z;if(!cache.has(k))cache.set(k,canonical(x,z));return cache.get(k);};
  // Match current production: grid samples use surface's outer cache, while
  // the persistent water factory binds height and has its own per-ROI cache.
  const waterSurface=(x,z)=>{calls++;return canonical(x,z);};
  const started=performance.now(),factory=c.createFrontlineWaterCutout(map.terrain.waterAreas,waterSurface);
  const region=factory.region({minX:roi.center[0]-roi.radius,maxX:roi.center[0]+roi.radius,minZ:roi.center[1]-roi.radius,maxZ:roi.center[1]+roi.radius}),preparedMs=performance.now()-started;
  const buildAt=performance.now(),result=build({roi,surface,needsFine:(x,z,size)=>sc.actualSourceNearRoad(x+size/2,z+size/2,size),waterCutoutRegion:region}),buildMs=performance.now()-buildAt;
  const sourceCalls=calls,computations=canonicalComputations,uniqueCoordinates=sampleCoordinates.size;
  assert.equal(sourceCalls,result.stats.sourceHeightSamples+region.stats.heightSamples,'Area-weighted shared normals add zero canonical height calls');
  const normals=new Map();
  for(let i=0;i<result.data.length;i+=13){
    const p=Array.from(result.data.slice(i,i+3)),n=Array.from(result.data.slice(i+3,i+6));
    assert.ok(p.every(Number.isFinite)&&n.every(Number.isFinite));assert.ok(known.has(key(p)),'Every uploaded XYZ is an exact Float32 projection of an actual canonical source sample');
    const k=key(p);if(normals.has(k))assert.deepEqual(n,normals.get(k));normals.set(k,n);close(Math.hypot(...n),1,1e-6);
  }
  const legacyAt=performance.now();
  const legacyRegion=factory.region({minX:roi.center[0]-roi.radius,maxX:roi.center[0]+roi.radius,minZ:roi.center[1]-roi.radius,maxZ:roi.center[1]+roi.radius});
  const legacy=c.actualLegacyTerrain({cx:roi.center[0],cz:roi.center[1],radius:roi.radius,step:50,aerial:false,surface,dryTerrain:legacyRegion,nearRoad:sc.actualSourceNearRoad,material}),legacyMs=performance.now()-legacyAt;
  const oldArea=area(legacy),newArea=area(result.data);
  close(newArea,oldArea,Math.max(.01,(roi.radius*2)**2*2e-5));
  assert.equal(JSON.stringify(map),source.before,'Source heights/roadbeds/pads/water/nav must remain unchanged');
  return {...result,legacy,report:{roi:plain(roi),stats:plain(result.stats),heightCallbackCalls:sourceCalls,actualCanonicalComputations:computations,uniqueCanonicalCoordinates:uniqueCoordinates,normalDerivativeHeightCalls:0,waterCandidateSourceTriangles:region.stats.candidateSourceTriangles,waterClippedTriangles:region.stats.clippedWaterTriangles,waterCanonicalHeightSamples:region.stats.heightSamples,prepareWaterRegionMs:preparedMs,buildConformingMeshMs:buildMs,legacySmallRoiBuildMs:legacyMs,legacyTimingCaveat:'Legacy oracle runs second with a warmed grid cache and a fresh water ROI; these are observed costs, not a controlled speed comparison.',legacyCellSourceSha256,legacyDryAreaM2:oldArea,conformingDryAreaM2:newArea,scope:'One small source ROI on this process/wall clock, not a5km build, render performance or whole-world budget.'}};
}
function edgeSet(data){const out=new Set();for(const t of tris(data))for(let i=0;i<3;i++)out.add([key(t[i]),key(t[(i+1)%3])].sort().join('|'));return out;}

test('actual Korea250m screenshot ROI fixes the observed3.68m coarse/fine seam on unchanged canonical source',()=>{
  const source=sourceKorea(),roi={center:[-15975,2975],radius:125},r=actualRoi(source,roi);
  topology(r.data,{minX:-16100,maxX:-15850,minZ:2850,maxZ:3100});
  const a=[-15900,Math.fround(source.sc.height(-15900,3000)),3000],b=[-15900,Math.fround(source.sc.height(-15900,3050)),3050],p=[-15900,Math.fround(source.sc.height(-15900,3030)),3030],coarseKey=[key(a),key(b)].sort().join('|');
  assert.ok(edgeSet(r.legacy).has(coarseKey),'Actual prior renderer contains the unsegmented coarse edge');
  assert.ok(tris(r.legacy).flat().some(v=>key(v)===key(p)),'Actual fine neighbor has the hanging canonical vertex');
  assert.ok(!edgeSet(r.data).has(coarseKey),'Conforming mesh removes the old unsplit edge instead of adding a skirt');
  assert.ok(tris(r.data).flat().some(v=>key(v)===key(p)),'The hanging source position is retained unchanged and now shared');
  const oldGap=p[1]-(a[1]+(b[1]-a[1])*.6);close(oldGap,3.681442342778112,.00002);
  assert.ok(r.stats.stitchedEdges>0);assert.equal(r.report.waterClippedTriangles,0,'This photographed road ROI is dry; wet clipping is tested separately');
  console.log(JSON.stringify({proof:'actual_korea_small_road_roi',mapSha256:source.mapSha256,...r.report,observedFailurePoint:p,priorUnsuturedEdgeGapM:oldGap,conformingEdgeVertexGapM:0}));
});
test('actual Korea150m source-water ROI preserves registered water and canonical XYZ through mixed-resolution stitching',()=>{
  const source=sourceKorea(),waters=source.map.terrain.waterAreas,bridge=source.map.terrain.bridges.find(b=>b.waterAreaIds.some(id=>waters.some(w=>w.id===id&&w.source.kind==='osm_water_polygon'))),w=waters.find(w=>bridge.waterAreaIds.includes(w.id)&&w.source.kind==='osm_water_polygon'),t=w.triangles[0],p=[(t[0]+t[2]+t[4])/3,(t[1]+t[3]+t[5])/3];
  const roi={center:p.map(v=>Math.floor(v/50)*50+25),radius:75},r=actualRoi(source,roi);
  assert.ok(r.report.waterCandidateSourceTriangles>0&&r.report.waterClippedTriangles>0);
  assert.ok(r.stats.fineCells>0&&r.stats.fanCells>0,'Source road/river ROI exercises water clipping and mixed-resolution stitching together');
  assert.ok(r.report.conformingDryAreaM2<(roi.radius*2)**2);
  const point=[Math.fround(p[0]),0,Math.fround(p[1])],inside=(p,t)=>{if(Math.abs(cross(...t))<1e-6)return false;const d=[0,1,2].map(i=>cross(t[i],t[(i+1)%3],p));return d.every(v=>v>=-1e-5)||d.every(v=>v<=1e-5);};
  assert.ok(!tris(r.data).some(t=>inside(point,t)),'Actual source triangle interior stays an empty water cutout');
  console.log(JSON.stringify({proof:'actual_korea_small_source_water_roi',mapSha256:source.mapSha256,bridgeId:bridge.id,waterId:w.id,waterSource:w.source,waterLevel:w.level,...r.report}));
});
