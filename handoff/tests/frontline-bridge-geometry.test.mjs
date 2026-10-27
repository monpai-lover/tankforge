import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const app=fs.readFileSync(new URL('../bundle/app.js.html',import.meta.url),'utf8');
const helper=fs.readFileSync(new URL('../tools/frontline_bridge_geometry.js',import.meta.url),'utf8');
const client=fs.readFileSync(new URL('../tools/frontline_client.js',import.meta.url),'utf8');
const context=vm.createContext({});
vm.runInContext(app.slice(app.indexOf('  function m4()'),app.indexOf('  // client/web/src/game/relief.js'))+helper,context);
const material={color:[.3,.31,.29],rough:.85,metal:.05};
function build(map,surface=()=>4,roi=null){return context.buildFrontlineBridgeGeometry({GeoBuilder:context.GeoBuilder,map,surface,roi,material});}
const vertices=data=>Array.from({length:data.length/13},(_,i)=>Array.from(data.slice(i*13,i*13+3)));
const triangles=data=>Array.from({length:data.length/39},(_,i)=>vertices(data.slice(i*39,i*39+39)));
const cross=(a,b,p)=>(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);
function covered(data,p){return triangles(data).some(t=>{const q=t.map(v=>[v[0],v[2]]),c=q.map((a,i)=>cross(a,q[(i+1)%3],p));return c.every(v=>v>=-1e-5)||c.every(v=>v<=1e-5);});}
function mapWithJoint(hole=false){
  const s=[[-10,0,4,0,0,4,4,1],[0,0,4,0,10,4,4,1]],width=hole?4:2;
  const ring=hole?[[1,-1],[2,-1],[2,-2],[1,-2],[1,-1]]:[[0,0],[1,0],[1,-1],[0,0]];
  const holes=hole?[[[1.25,-1.25],[1.25,-1.75],[1.75,-1.75],[1.75,-1.25],[1.25,-1.25]]]:[];
  const quads=hole?[
    [[1,-1],[2,-1],[1.75,-1.25],[1.25,-1.25]],
    [[2,-1],[2,-2],[1.75,-1.75],[1.75,-1.25]],
    [[2,-2],[1,-2],[1.25,-1.75],[1.75,-1.75]],
    [[1,-2],[1,-1],[1.25,-1.25],[1.25,-1.75]]]:[];
  const ts=hole?quads.flatMap(q=>[[...q[0],...q[1],...q[2]],[...q[0],...q[2],...q[3]]]):[[0,0,1,0,1,-1]];
  return{terrain:{roadbeds:{segments:s},bridges:[{id:'explicit-test-joint',roadbedSegments:[0,1],halfWidth:width,deckThickness:1,authored:true,
    jointGeometry:{version:1,source:{kind:'authored_internal_deck_joint_wedges'},sharedVertices:[{point:[0,0],roadbedSegments:[0,1]}],polygons:[{ring,holes}],triangles:ts}}]}};
}

test('lit-only depth bias restores the complete GL offset state even when drawing fails',()=>{
  for(const initiallyEnabled of [false,true]){
    let enabled=initiallyEnabled,factor=2,units=4,draws=0;
    const gl={POLYGON_OFFSET_FILL:1,POLYGON_OFFSET_FACTOR:2,POLYGON_OFFSET_UNITS:3,
      isEnabled:()=>enabled,getParameter:k=>k===2?factor:units,enable:()=>{enabled=true;},disable:()=>{enabled=false;},polygonOffset:(f,u)=>{factor=f;units=u;}};
    assert.throws(()=>context.drawWithPolygonOffset(gl,[-1,-1],()=>{draws++;assert.equal(enabled,true);assert.equal(factor,-1);assert.equal(units,-1);throw Error('draw failed');}),/draw failed/);
    assert.equal(draws,1);assert.equal(enabled,initiallyEnabled);assert.equal(factor,2);assert.equal(units,4);
  }
  const lit=app.slice(app.indexOf('      const drawLit = (n) => {'),app.indexOf('      drawLit.resetNormals'));
  assert.match(lit,/drawWithPolygonOffset/);
  const shadow=app.slice(app.indexOf('gl.polygonOffset(2, 4)'),app.indexOf('gl.disable(gl.POLYGON_OFFSET_FILL)',app.indexOf('gl.polygonOffset(2, 4)')));
  assert.doesNotMatch(shadow,/drawWithPolygonOffset/);
});

test('all frozen Korea and Taiwan deck groups accept their exact authored joint geometry',()=>{
  for(const [id,count]of [['korea',36],['taiwan',30]]){
    const map=JSON.parse(fs.readFileSync(new URL(`../../data/frontline/${id}.json`,import.meta.url)));
    const result=build(map);
    assert.equal(result.stats.bridges,count);assert.equal(result.stats.jointTriangles,map.terrain.bridges.reduce((n,b)=>n+b.jointGeometry.triangles.length,0));
    assert.ok(result.top.length>0);assert.ok(result.shell.length>0);
  }
});

test('actual GeoBuilder keeps rectangle top exactly on canonical surface and thickness below, with ROI intersection rather than centre-only culling',()=>{
  const map={terrain:{roadbeds:{segments:[[0,0,4,0,10,5,2,1]]},bridges:[{id:'rect',roadbedSegments:[0],halfWidth:2,deckThickness:1}]}};
  const surface=(x,z)=>4+.1*z+.05*x,before=JSON.stringify(map),result=build(map,surface,{center:[0,0],radius:.5});
  assert.equal(result.stats.rectangles,1,'Near endpoint is in ROI even though segment centre is outside');
  assert.equal(result.stats.topTriangles,2);assert.equal(result.stats.shellTriangles,10);
  for(const [x,y,z]of vertices(result.top))assert.equal(y,Math.fround(surface(x,z)),'No +.12m visual lift');
  for(let i=0;i<result.top.length;i+=13)assert.ok(result.top[i+4]>0,'Top normal points upward');
  for(const [x,y,z]of vertices(result.shell))assert.ok(y===Math.fround(surface(x,z))||y===Math.fround(surface(x,z)-1));
  assert.equal(JSON.stringify(map),before,'Geometry builder cannot mutate canonical source');
  const far=build(map,surface,{center:[1000,1000],radius:2});assert.equal(far.top.length,0);assert.equal(far.shell.length,0);
});

test('only explicit shared-endpoint wedge is added, while unsupported caps and gap locations remain empty',()=>{
  const map=mapWithJoint(),old=structuredClone(map);delete old.terrain.bridges[0].jointGeometry;old.terrain.bridges[0].jointCaps=true;
  const original=build(old),repaired=build(map);
  assert.equal(original.stats.topTriangles,4);assert.equal(repaired.stats.topTriangles,5);
  assert.equal(repaired.stats.jointTriangles,1);assert.equal(repaired.stats.jointPolygons,1);
  assert.equal(covered(original.top,[.75,-.25]),false);assert.equal(covered(repaired.top,[.75,-.25]),true);
  assert.equal(covered(repaired.top,[-10.5,0]),false,'No extension at dangling approach endpoint');
  assert.equal(covered(repaired.top,[1.5,-1.5]),false,'No disc or broad old-rectangle fallback around junction');
});

test('provided joint triangles retain holes and generate real inward-facing hole walls',()=>{
  const result=build(mapWithJoint(true));
  assert.equal(result.stats.jointTriangles,8);assert.equal(result.stats.jointHoles,1);
  assert.equal(result.stats.shellTriangles,44);
  assert.equal(covered(result.top,[1.5,-1.5]),false,'Hole is not capped by a fan triangulation');
  assert.equal(covered(result.top,[1.1,-1.5]),true);
  // Wall endpoints are enough to identify the planar x=1.25 inner side.
  let positiveHoleNormal=false;
  for(const t of triangles(result.shell)){if(t.every(p=>p[0]===1.25)&&t.every(p=>p[2]>=-1.75&&p[2]<=-1.25)){
    positiveHoleNormal=true;
    const a=t[0],b=t[1],c=t[2];assert.ok((b[1]-a[1])*(c[2]-a[2])-(b[2]-a[2])*(c[1]-a[1])>0,'Hole wall faces into the empty hole');
  }}
  assert.ok(positiveHoleNormal);
});

test('actual Taiwan native failure locus is covered by its explicit source triangles at the unchanged canonical height',()=>{
  const example=JSON.parse(fs.readFileSync(new URL('../../docs/air-frontline/research/bridge-joint-example-taiwan-deck576.json',import.meta.url),'utf8'));
  const map=JSON.parse(fs.readFileSync(new URL('../../data/frontline/taiwan.json',import.meta.url),'utf8'));
  map.terrain.bridges=[example.bridge];
  const c=vm.createContext({f:{map},clamp:(n,a,b)=>Math.max(a,Math.min(b,n))});
  const a=client.indexOf('      function grid(g,x,z){'),b=client.indexOf('      async function ensureMapOptions(',a);assert.ok(a>=0&&b>a);vm.runInContext(client.slice(a,b),c);
  const q=example.failureWorldXZ,canonical=c.height(...q);assert.ok(Math.abs(canonical-example.canonicalHeight)<1e-8);
  const builders=[];
  class AuditedGeoBuilder extends context.GeoBuilder{constructor(){super();builders.push(this);}}
  const result=context.buildFrontlineBridgeGeometry({GeoBuilder:AuditedGeoBuilder,map,surface:c.height,roi:{center:q,radius:100},material});
  const old=structuredClone(map);delete old.terrain.bridges[0].jointGeometry;
  assert.equal(covered(build(old,c.height).top,q),false,'Original unextended rectangles reproduce the real unsupported locus');
  assert.equal(covered(result.top,q),true,'Only authored joint triangles cover that locus');
  assert.equal(result.stats.rectangles,6);assert.equal(result.stats.jointTriangles,16);
  assert.equal(result.stats.jointPolygons,6);assert.equal(result.stats.topTriangles,28);
  // Actual GeoBuilder retains double source positions until GPU Float32 upload.
  // Compare the canonical callback at those original positions: the bridge is
  // not assumed flat, and large-coordinate Float32 rounding is not a new grade.
  for(let i=0;i<builders[0].data.length;i+=13){const d=builders[0].data;assert.equal(d[i+1],c.height(d[i],d[i+2]),'Every top source vertex uses canonical height without a visual lift');assert.equal(result.top[i+1],Math.fround(d[i+1]));}
  assert.ok(canonical-example.waterLevel>=2);
});

test('invalid or unsupported joint inputs fail rather than silently replacing source geometry',()=>{
  for(const mutate of [m=>m.terrain.bridges[0].jointGeometry.version=2,
    m=>m.terrain.bridges[0].jointGeometry.sharedVertices[0].point=[5,5],
    m=>m.terrain.bridges[0].jointGeometry.triangles=[[0,0,1,-1,1,0]],
    m=>m.terrain.bridges[0].jointGeometry.triangles=[]]){
    const m=mapWithJoint();mutate(m);assert.throws(()=>build(m));
  }
  assert.throws(()=>build(mapWithJoint(),()=>NaN));
});
