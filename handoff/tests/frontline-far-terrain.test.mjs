import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';

const app=fs.readFileSync(new URL('../bundle/app.js.html',import.meta.url),'utf8');
const source=fs.readFileSync(new URL('../tools/frontline_terrain_geometry.js',import.meta.url),'utf8');
const water=fs.readFileSync(new URL('../tools/frontline_water_cutout.js',import.meta.url),'utf8');
const c=vm.createContext({});
vm.runInContext(app.slice(app.indexOf('  function m4()'),app.indexOf('  // client/web/src/game/relief.js'))+water+source,c);
const material={color:[.2,.3,.1],rough:1,metal:0};
const terrain={width:3,height:3,x0:0,z0:0,cellX:50,cellZ:50,heights:[0,10,0,20,90,20,0,10,0],waterAreas:[]};
const plain=value=>JSON.parse(JSON.stringify(value));
const triangles=data=>Array.from({length:data.length/39},(_,i)=>Array.from({length:3},(_,j)=>Array.from(data.slice(i*39+j*13,i*39+j*13+3))));
const cross=(a,b,p)=>(b[0]-a[0])*(p[2]-a[2])-(b[2]-a[2])*(p[0]-a[0]);
const area=t=>Math.abs(cross(t[0],t[1],t[2]))/2;
const contains=(t,p)=>{const q=[p[0],0,p[1]],d=t.map((a,i)=>cross(a,t[(i+1)%3],q));return d.every(v=>v>=-1e-4)||d.every(v=>v<=1e-4);};
const covers=(data,p)=>triangles(data).some(t=>area(t)>1e-5&&contains(t,p));
function base(g,x,z){
  const u=Math.max(0,Math.min(g.width-1,(x-g.x0)/g.cellX)),v=Math.max(0,Math.min(g.height-1,(z-g.z0)/g.cellZ));
  const i=Math.min(g.width-2,Math.floor(u)),j=Math.min(g.height-2,Math.floor(v)),a=u-i,b=v-j,k=j*g.width+i;
  return g.heights[k]*(1-a)*(1-b)+g.heights[k+1]*a*(1-b)+g.heights[k+g.width]*(1-a)*b+g.heights[k+g.width+1]*a*b;
}
function make(extra={}){
  assert.equal(typeof c.createFrontlineFarTerrainGeometry,'function','A bounded cached far-land owner must render source heights outside the moving detail rectangle');
  return c.createFrontlineFarTerrainGeometry({GeoBuilder:c.GeoBuilder,terrain,step:20,createWaterCutout:c.createFrontlineWaterCutout,material,...extra});
}

test('far land retains source relief and exact extent while removing only the near detail square',()=>{
  const before=JSON.stringify(terrain),owner=make(),detailBounds={minX:25,maxX:65,minZ:27,maxZ:67},result=owner.build({detailBounds});
  assert.deepEqual(plain(owner.bounds),{minX:0,maxX:100,minZ:0,maxZ:100});
  assert.equal(owner.stats.gridCells,25);
  assert.equal(owner.stats.sourceTriangles,50);
  const ts=triangles(result.data);
  assert.ok(Math.abs(ts.reduce((sum,t)=>sum+area(t),0)-8400)<.01,'Only the1600m² detail rectangle is excluded');
  assert.ok(!covers(result.data,[45,45]));
  for(const p of[[5,5],[90,90],[15,50],[75,50]])assert.ok(covers(result.data,p));
  for(let i=0;i<result.data.length;i+=13){const[x,y,z]=result.data.slice(i,i+3);assert.ok(x>=0&&x<=100&&z>=0&&z<=100);assert.ok(Math.abs(y-base(terrain,x,z))<1e-4);assert.ok(Array.from(result.data.slice(i,i+6)).every(Number.isFinite));}
  assert.ok(Array.from(result.data).some((v,i)=>i%13===1&&v>60),'The far hill is not flattened');
  assert.equal(JSON.stringify(terrain),before);
});

test('new boundary vertices match the exact near edge grid and its piecewise-linear canonical heights',()=>{
  const owner=make(),detailBounds={minX:25,maxX:65,minZ:27,maxZ:67},detailStep=10;
  const detailSurface=(x,z)=>50+Math.sin(x/7)*3+Math.cos(z/9),result=owner.build({detailBounds,detailStep,detailSurface});
  const vertices=triangles(result.data).flat();
  for(let i=0;i<=4;i++)for(const p of[[25+10*i,27],[25+10*i,67],[25,27+10*i],[65,27+10*i]]){
    assert.ok(vertices.some(v=>Math.abs(v[0]-p[0])<1e-5&&Math.abs(v[2]-p[1])<1e-5&&Math.abs(v[1]-detailSurface(...p))<1e-5),`Near perimeter sample ${p} must be shared`);
  }
  for(const p of vertices){
    let a,b,u;
    if((p[0]===25||p[0]===65)&&p[2]>=27&&p[2]<=67){const k=Math.min(3,Math.floor((p[2]-27)/10));a=[p[0],27+k*10];b=[p[0],27+(k+1)*10];u=(p[2]-a[1])/10;}
    else if((p[2]===27||p[2]===67)&&p[0]>=25&&p[0]<=65){const k=Math.min(3,Math.floor((p[0]-25)/10));a=[25+k*10,p[2]];b=[25+(k+1)*10,p[2]];u=(p[0]-a[0])/10;}
    if(a)assert.ok(Math.abs(p[1]-(detailSurface(...a)*(1-u)+detailSurface(...b)*u))<1e-5,'Every inserted intersection stays on the near edge, including between grid samples');
  }
  assert.ok(result.stats.detailHeightSamples<=20,'Canonical work is restricted to the perimeter');
});

test('detail edges aligned with the far grid still gain near samples and canonical edge heights',()=>{
  const owner=make(),detailBounds={minX:20,maxX:60,minZ:20,maxZ:60},detailSurface=(x,z)=>100+x*.3+z*.2;
  const result=owner.build({detailBounds,detailStep:10,detailSurface}),vertices=triangles(result.data).flat();
  for(let i=0;i<=4;i++)for(const p of[[20+10*i,20],[20+10*i,60],[20,20+10*i],[60,20+10*i]]){
    const edge=vertices.filter(v=>v[0]===p[0]&&v[2]===p[1]);
    assert.ok(edge.length>0,`Aligned near grid sample ${p} stays in the far boundary`);
    assert.ok(edge.every(v=>Math.abs(v[1]-detailSurface(...p))<1e-5),'No copied triangle retains an old height on the exact detail edge');
  }
});

test('distant sampling never queries canonical patches, roads, pads or runways',()=>{
  const g={...terrain};
  for(const name of['patches','roadbeds','pads','runways'])Object.defineProperty(g,name,{get(){throw Error(`Far terrain queried near-only ${name}`);}});
  const owner=make({terrain:g}),result=owner.build({detailBounds:{minX:25,maxX:65,minZ:27,maxZ:67}});
  assert.ok(result.data.length>0);
});

test('near rectangle outside or covering the source produces bounded complete or empty geometry',()=>{
  const owner=make(),all=owner.build({detailBounds:{minX:200,maxX:220,minZ:200,maxZ:220}});
  assert.equal(all.data.length/39,50);
  assert.equal(all.stats.clippedSourceTriangles,0);
  const empty=owner.build({detailBounds:{minX:-100,maxX:200,minZ:-100,maxZ:200}});
  assert.equal(empty.data.length,0);
  assert.equal(empty.stats.omittedTriangles,50);
  const clipped=make({bounds:{minX:-20,maxX:70,minZ:10,maxZ:150}});
  assert.deepEqual(plain(clipped.bounds),{minX:0,maxX:70,minZ:10,maxZ:100});
});

let actual;
function actualTaiwan(){
  if(actual)return actual;
  const map=JSON.parse(fs.readFileSync(new URL('../../data/frontline/taiwan.json',import.meta.url),'utf8')),before=JSON.stringify(map);
  const started=performance.now(),owner=make({terrain:map.terrain,bounds:map.bounds,step:4000});
  actual={map,before,owner,prepareMs:performance.now()-started};return actual;
}
test('actual Taiwan far land represents both source shores beyond the red aircraft detail radius',()=>{
  const {map,owner}=actualTaiwan(),detailBounds={minX:19500,maxX:43500,minZ:70500,maxZ:94500},result=owner.build({detailBounds});
  assert.equal(owner.stats.gridCells,15930);
  assert.equal(owner.stats.sourceTriangles,31860);
  assert.deepEqual(plain(owner.bounds),{minX:-235631.25,maxX:235631.25,minZ:-270631.65075034107,maxZ:268631.65075034107});
  const ocean=map.terrain.waterAreas.find(a=>a.id==='strategic-ocean:0');
  assert.deepEqual(ocean.holes[51].slice(233,235),[[7072.04,78982.13],[9159.28,78996.79]]);
  assert.deepEqual(ocean.holes[0].slice(462,464),[[-109823.28,-100642.66],[-108835.48,-97722.99]]);
  for(const p of[[8108.636543945863,79989.43533522835],[-110605.85147280344,-100000],[100000,0]])assert.ok(covers(result.data,p),`Actual dry far-coast/mountain sample ${p} stays land`);
  for(const p of[[8122.6834560541365,77989.48466477163],[-108605.85147280344,-100000],[0,-1000],[32234.83784746688,82679.61499112658]])assert.ok(!covers(result.data,p),`Registered sea/detail sample ${p} has no duplicate far land`);
});

test('actual Taiwan source height cache and water clipping stay fixed across750m detail moves',()=>{
  const {map,before,owner,prepareMs}=actualTaiwan(),initial=plain(owner.stats),times=[];
  for(let i=0;i<3;i++){
    const started=performance.now(),detailBounds={minX:19500+i*750,maxX:43500+i*750,minZ:70500,maxZ:94500};
    const result=owner.build({detailBounds,detailStep:200,detailSurface:(x,z)=>base(map.terrain,x,z)});times.push(performance.now()-started);
    assert.equal(owner.stats.waterClipCalls,31860,'Coast subtraction runs once, never per near move');
    assert.equal(owner.stats.baseHeightSamples,initial.baseHeightSamples,'Moving samples never grow the persistent base cache');
    assert.ok(result.stats.clippedSourceTriangles<400);
    assert.ok(result.stats.detailHeightSamples<=484);
    assert.ok(result.data.length<31860*39*2,'Far buffer stays within a fixed theatre geometry budget');
    for(let k=0;k<result.data.length;k+=13*37){assert.ok(Array.from(result.data.slice(k,k+6)).every(Number.isFinite));}
    assert.ok(result.stats.baseHeightSamplesAdded<2000,'New base work covers only boundary fragments');
  }
  assert.equal(JSON.stringify(map),before);
  console.log(JSON.stringify({proof:'taiwan_far_coast_source_lod',prepareMs,rebuildMs:times,stats:plain(owner.stats),scope:'Observed CPU on this Node process; not browser frame or GPU performance.'}));
});

test('far source preparation rejects fine unbounded grids, invalid extents and nonfinite source heights',()=>{
  assert.throws(()=>make({step:.01}),/budget/);
  assert.throws(()=>make({step:0}),/step/);
  assert.throws(()=>make({terrain:{...terrain,heights:[NaN,...terrain.heights.slice(1)]}}),/height/);
  assert.throws(()=>make({bounds:{minX:200,maxX:300,minZ:200,maxZ:300}}),/extent/);
  assert.throws(()=>make().build({detailBounds:{minX:50,maxX:20,minZ:0,maxZ:10}}),/detail/);
  assert.throws(()=>make().build({detailBounds:{minX:20,maxX:40,minZ:20,maxZ:40},detailStep:0}),/step/);
});
