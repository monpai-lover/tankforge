import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const code=fs.readFileSync(new URL('../tools/frontline_water_cutout.js',import.meta.url),'utf8');
function make(areas,height=(x,z)=>11+x*.2-z*.3){const c=vm.createContext({});vm.runInContext(code+';globalThis.make=createFrontlineWaterCutout;',c);return c.make(areas,height);}
const cross=t=>(t[1][0]-t[0][0])*(t[2][2]-t[0][2])-(t[1][2]-t[0][2])*(t[2][0]-t[0][0]);
const area=tris=>tris.reduce((s,t)=>s+Math.abs(cross(t))/2,0);
const near=(a,b,e=1e-7)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
const bounds={minX:-20,maxX:30,minZ:-20,maxZ:30};
function rectangle(x0,z0,x1,z1){return{triangles:[[x0,z0,x1,z0,x1,z1],[x0,z0,x1,z1,x0,z1]]};}
function square(c,x0=0,z0=0,x1=10,z1=10){return [...c.clipTriangle([[x0,999,z0],[x1,999,z0],[x1,999,z1]]),...c.clipTriangle([[x0,999,z0],[x1,999,z1],[x0,999,z1]])];}

test('dry triangles retain area/winding and every XYZ output uses the actual height callback',()=>{
  let calls=0;const cut=make([], (x,z)=>{calls++;return 7+x*x-z;}).region(bounds);
  const input=[[0,999,0],[0,999,10],[10,999,0]],before=JSON.stringify(input),out=cut.clipTriangle(input);
  near(area(out),50);assert.ok(out.every(t=>cross(t)<0));
  for(const t of out)for(const [x,y,z]of t)assert.equal(y,7+x*x-z);
  assert.equal(JSON.stringify(input),before);assert.equal(calls,3);
  cut.clipTriangle(input);assert.equal(calls,3,'ROI caches canonical vertex heights without modifying native state');
});

test('a shoreline crossing splits a terrain triangle and resamples new boundary vertices',()=>{
  const r=make([rectangle(5,-10,20,20)]).region(bounds),out=r.clipTriangle([[0,999,0],[10,999,0],[0,999,10]]);
  near(area(out),37.5);assert.ok(out.flat().some(p=>Math.abs(p[0]-5)<1e-10));
  for(const t of out)for(const [x,y,z]of t){assert.ok(x<=5+1e-9);near(y,11+x*.2-z*.3);}
  assert.ok(out.every(t=>cross(t)>0),'Input winding preserved');
});

test('overlapping and duplicate water triangles subtract their union once',()=>{
  const a=rectangle(2,2,7,8),b=rectangle(5,2,9,8),source=[a,b,a],before=JSON.stringify(source);
  const out=square(make(source).region(bounds));near(area(out),58);
  assert.equal(JSON.stringify(source),before);
});

test('authored triangulation holes remain dry instead of being filled from outer rings',()=>{
  const areas=[rectangle(0,0,10,4),rectangle(0,6,10,10),rectangle(0,4,4,6),rectangle(6,4,10,6)];
  const out=square(make(areas).region(bounds));near(area(out),4);
  for(const t of out)for(const p of t)assert.ok(p[0]>=4-1e-9&&p[0]<=6+1e-9&&p[2]>=4-1e-9&&p[2]<=6+1e-9);
});

test('a shared shoreline edge keeps dry land and fully submerged triangles emit no terrain',()=>{
  const r=make([rectangle(0,0,10,10)]).region(bounds);
  assert.equal(r.clipTriangle([[1,0,1],[2,0,1],[1,0,2]]).length,0);
  near(area(r.clipTriangle([[-5,0,0],[0,0,0],[0,0,10]])),25);
});

test('half-million metre ocean uses a bounded coarse index and ROI clipping, not giant tiny-cell allocation',()=>{
  const factory=make([rectangle(-250000,-250000,250000,250000)]),r=factory.region({minX:-4000,maxX:4000,minZ:-4000,maxZ:4000});
  assert.equal(factory.stats.globalLargeTriangles,2);assert.equal(factory.stats.globalCells,0);
  assert.ok(r.stats.localCells<=4096);assert.equal(r.clipTriangle([[-10,0,-10],[10,0,-10],[0,0,10]]).length,0);
  assert.equal(r.stats.heightSamples,0,'Water needs no fabricated terrain/bathymetry samples');
  const overview=factory.region({minX:-250000,maxX:250000,minZ:-250000,maxZ:250000});
  assert.ok(overview.stats.localCells<=4096);assert.ok(overview.stats.cellSize>256);
});

test('actual Korea/Taiwan source water triangles cut their own interiors and retain real dry source areas',()=>{
  for(const id of ['korea','taiwan']){
    const map=JSON.parse(fs.readFileSync(new URL(`../../data/frontline/${id}.json`,import.meta.url),'utf8')),before=JSON.stringify(map.terrain.waterAreas);
    const f=make(map.terrain.waterAreas,(x,z)=>x*.01+z*.02);
    const a=map.terrain.waterAreas.find(a=>a.source.kind!=='natural_earth_coarse_ocean_mask').triangles[0];
    const points=[[a[0],a[1]],[a[2],a[3]],[a[4],a[5]]],cx=points.reduce((s,p)=>s+p[0],0)/3,cz=points.reduce((s,p)=>s+p[1],0)/3;
    const roi={minX:cx-100,maxX:cx+100,minZ:cz-100,maxZ:cz+100},r=f.region(roi);
    const tri=points.map(([x,z])=>[cx+(x-cx)*.1,0,cz+(z-cz)*.1]);
    assert.ok(area(tri.length?[tri]:[])>1e-10);near(area(r.clipTriangle(tri)),0,1e-6);
    const pad=map.terrain.pads.find(p=>map.staging.some(s=>s.enabled&&s.padId===p.id));
    const x=pad.center[0],z=pad.center[1],dry=f.region({minX:x-10,maxX:x+10,minZ:z-10,maxZ:z+10});
    near(area(dry.clipTriangle([[x-1,0,z-1],[x+1,0,z-1],[x,0,z+1]])),2);
    assert.ok(f.stats.globalCells<20000&&dry.stats.localCells<5000);
    assert.equal(JSON.stringify(map.terrain.waterAreas),before);
  }
});

test('actual Taiwan main-island hole stays land despite the full strategic ocean polygon bbox',()=>{
  const m=JSON.parse(fs.readFileSync(new URL('../../data/frontline/taiwan.json',import.meta.url),'utf8'));
  const x=63692.790417,z=30317.057057,f=make(m.terrain.waterAreas),r=f.region({minX:x-20,maxX:x+20,minZ:z-20,maxZ:z+20});
  near(area(r.clipTriangle([[x-5,0,z-5],[x+5,0,z-5],[x,0,z+5]])),50);
});

test('bad source triangles, nonfinite heights and ROI misuse fail explicitly',()=>{
  assert.throws(()=>make([{triangles:[[0,0,1,1,2,2]]}]),/Degenerate/);
  assert.throws(()=>make([{triangles:[[0,0,1,0,NaN,1]]}]),/Invalid/);
  const r=make([],()=>NaN).region(bounds);assert.throws(()=>r.clipTriangle([[0,0,0],[1,0,0],[0,0,1]]),/Nonfinite/);
  assert.throws(()=>make([]).region(bounds).clipTriangle([[100,0,100],[101,0,100],[100,0,101]]),/outside prepared/);
});
