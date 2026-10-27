import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const app=fs.readFileSync(new URL('../bundle/app.js.html',import.meta.url),'utf8');
const geometry=fs.readFileSync(new URL('../tools/frontline_terrain_geometry.js',import.meta.url),'utf8');
const background=fs.readFileSync(new URL('../tools/frontline_map_background.js',import.meta.url),'utf8');
const c=vm.createContext({});
vm.runInContext(app.slice(app.indexOf('  function m4()'),app.indexOf('  // client/web/src/game/relief.js'))+geometry+background,c);
const material={color:[.1,.2,.3],rough:.25,metal:.1};
const taiwan=JSON.parse(fs.readFileSync(new URL('../../data/frontline/taiwan.json',import.meta.url),'utf8'));
const ocean=taiwan.terrain.waterAreas.find(a=>a.id==='strategic-ocean:0');
const contains=(q,p)=>{
  const points=[[q[0],q[1]],[q[2],q[3]],[q[4],q[5]]];
  const signs=points.map((a,i)=>{const b=points[(i+1)%3];return(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);});
  return signs.every(v=>v>=0)||signs.every(v=>v<=0);
};
const triangles=data=>Array.from({length:data.length/39},(_,i)=>Array.from({length:3},(_,j)=>Array.from(data.slice(i*39+j*13,i*39+j*13+3))));
const plain=value=>JSON.parse(JSON.stringify(value));
function build(waterAreas,roi={center:[0,0],radius:10},extra={}){
  assert.equal(typeof c.buildFrontlineWaterGeometry,'function','Registered water needs a geometry builder that retains triangle/ROI intersections');
  return c.buildFrontlineWaterGeometry({GeoBuilder:c.GeoBuilder,waterAreas,roi,material,...extra});
}

test('actual Taiwan ocean covers theatre centre even with its source triangle centroid33km away',()=>{
  const centre=[0,-1000],fixture=[28009.33,4062.67,-61805.8,-99924.97,-48286.6,34992.61];
  const source=ocean.triangles.find(q=>contains(q,centre));
  assert.deepEqual(source,fixture,'Fixture must remain an unchanged actual map triangle');
  const centroid=[(source[0]+source[2]+source[4])/3,(source[1]+source[3]+source[5])/3];
  assert.ok(Math.hypot(centroid[0],centroid[1]-centre[1])>33000,'Old12.5km centroid cull rejects this visible ocean');
  const before=JSON.stringify(ocean),result=build([ocean],{center:centre,radius:12000});
  assert.ok(triangles(result.data).some(t=>contains(t.flatMap(p=>[p[0],p[2]]),centre)),'The actual centre of the Strait retains a sea surface');
  assert.ok(result.stats.visibleTriangles>0);
  assert.equal(result.stats.sourceTriangles,1951);
  assert.equal(JSON.stringify(ocean),before,'Rendering must never rewrite coast/source data');
  for(const t of triangles(result.data))for(const p of t)assert.equal(p[1],Math.fround(.02));
});

test('water selection includes disk interiors, long edges, vertices and tangency but rejects a disjoint bbox corner',()=>{
  const source=[[-100,-100,100,-100,0,100],[9,-100,9,100,100,100],[9,0,30,20,30,-20],[10,-100,10,100,100,0],[8,8,50,8,8,50],[100,100,101,100,100,101]];
  const result=build([{id:'fixture',level:7,triangles:source}]);
  assert.equal(result.stats.sourceTriangles,6);
  assert.equal(result.stats.visibleTriangles,4);
  assert.equal(result.stats.culledTriangles,2);
  assert.equal(result.stats.vertices,12);
  assert.deepEqual(triangles(result.data),source.slice(0,4).map(q=>[[q[0],Math.fround(7.02),q[1]],[q[2],Math.fround(7.02),q[3]],[q[4],Math.fround(7.02),q[5]]]),'All accepted source vertices and winding stay unchanged');
});

test('whole-theatre water uploads all registered source triangles without adding shoreline or bathymetry',()=>{
  const before=JSON.stringify(ocean),result=build([ocean],null,{surfaceOffset:0});
  assert.equal(result.stats.visibleTriangles,1951);
  assert.equal(result.stats.culledTriangles,0);
  assert.equal(result.stats.vertices,1951*3);
  assert.equal(result.data.length,1951*39);
  assert.equal(JSON.stringify(ocean),before);
  assert.deepEqual(triangles(result.data)[0],[[ocean.triangles[0][0],0,ocean.triangles[0][1]],[ocean.triangles[0][2],0,ocean.triangles[0][3]],[ocean.triangles[0][4],0,ocean.triangles[0][5]]].map(p=>p.map(Math.fround)));
});

test('theatre fit uses the source rectangle with one metre scale on both axes and north at negative z',()=>{
  const helper=c.createFrontlineMapBackground(taiwan),before=JSON.stringify(taiwan);
  assert.equal(typeof helper.fit,'function','Native deployment and tactical maps need the same source-bounds fit');
  for(const [width,height]of[[480,340],[640,640]]){
    const view=helper.fit(width,height);
    assert.deepEqual(plain(view.centre),[0,-1000]);
    assert.equal(view.scale,Math.max(472000/width,540000/height)*1.08);
    const project=(x,z)=>[(x-view.centre[0])/view.scale+width/2,(z-view.centre[1])/view.scale+height/2];
    for(const x of[-236000,236000])for(const z of[-271000,269000]){const p=project(x,z);assert.ok(p[0]>0&&p[0]<width&&p[1]>0&&p[1]<height);}
    assert.ok(project(0,-271000)[1]<project(0,269000)[1]);
  }
  assert.equal(JSON.stringify(taiwan),before);
});

test('malformed water geometry and map fitting requests fail before producing speculative surfaces',()=>{
  assert.throws(()=>build([{level:NaN,triangles:[]}]),/level/);
  assert.throws(()=>build([{level:0,triangles:[[0,0,1,1,2,2]]}]),/Degenerate/);
  assert.throws(()=>build([{level:0,triangles:[[0,0,NaN,1,1,0]]}]),/triangle/);
  assert.throws(()=>build([],{center:[0,NaN],radius:1}),/ROI/);
  assert.throws(()=>build([],{center:[0,0],radius:0}),/ROI/);
  assert.throws(()=>build([],null,{surfaceOffset:Infinity}),/offset/);
  const helper=c.createFrontlineMapBackground(taiwan);
  assert.equal(typeof helper.fit,'function');
  for(const args of[[0,100],[100,Infinity],[100,100,.9]])assert.throws(()=>helper.fit(...args),/fit/);
});
