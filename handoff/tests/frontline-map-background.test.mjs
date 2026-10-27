import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const source=fs.readFileSync(new URL('../tools/frontline_map_background.js',import.meta.url),'utf8');
class Path {
  constructor(){this.rings=[];}
  moveTo(x,z){this.rings.push([[x,z]]);}
  lineTo(x,z){this.rings.at(-1).push([x,z]);}
  closePath(){}
}
function make(map,cached=false){const c=vm.createContext(cached?{Path2D:Path}:{});vm.runInContext(source+';globalThis.make=createFrontlineMapBackground;',c);return c.make(map);}
const inside=(p,r)=>{let yes=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[i],b=r[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;};
class Canvas {
  constructor(){this.commands=[];this.state={sx:1,sz:1,tx:0,tz:0,fillStyle:'original',clip:null};this.stack=[];this.path=new Path();}
  set fillStyle(v){this.state.fillStyle=v;}get fillStyle(){return this.state.fillStyle;}
  point(x,z){const s=this.state;return[x*s.sx+s.tx,z*s.sz+s.tz];}
  save(){this.stack.push({...this.state});}
  restore(){this.state=this.stack.pop();}
  translate(x,z){this.state.tx+=this.state.sx*x;this.state.tz+=this.state.sz*z;}
  scale(x,z){this.state.sx*=x;this.state.sz*=z;}
  beginPath(){this.path=new Path();}
  moveTo(x,z){this.path.moveTo(...this.point(x,z));}
  lineTo(x,z){this.path.lineTo(...this.point(x,z));}
  closePath(){this.path.closePath();}
  rect(x,z,w,h){this.moveTo(x,z);this.lineTo(x+w,z);this.lineTo(x+w,z+h);this.lineTo(x,z+h);this.closePath();}
  clip(){this.state.clip=this.path.rings.map(r=>r.map(p=>p.slice()));}
  fillRect(x,z,w,h){const p=new Path();p.moveTo(...this.point(x,z));p.lineTo(...this.point(x+w,z));p.lineTo(...this.point(x+w,z+h));p.lineTo(...this.point(x,z+h));this.record(p.rings,'nonzero');}
  fill(path,rule){if(typeof path==='string'){rule=path;path=null;}const rings=path?path.rings.map(r=>r.map(p=>this.point(...p))):this.path.rings;this.record(rings,rule||'nonzero');}
  record(rings,rule){this.commands.push({rings:rings.map(r=>r.map(p=>p.slice())),rule,clip:this.state.clip,color:this.fillStyle});}
  pixel(x,z){let color=null;for(const c of this.commands){if(c.clip&&!c.clip.some(r=>inside([x,z],r)))continue;const hits=c.rings.reduce((n,r)=>n+Number(inside([x,z],r)),0);if(c.rule==='evenodd'?hits%2:hits)color=c.color;}return color;}
}
const ring=(x0,z0,x1,z1)=>[[x0,z0],[x1,z0],[x1,z1],[x0,z1],[x0,z0]];
const water=(x0,z0,x1,z1,holes=[])=>({ring:ring(x0,z0,x1,z1),holes});
const map=areas=>({bounds:{minX:0,maxX:100,minZ:0,maxZ:100},terrain:{waterAreas:areas}});
const colors={outside:'outside',land:'land',water:'water'};
const view={width:200,height:200,centre:[50,50],scale:1};
const project=(p,v)=>[(p[0]-v.centre[0])/v.scale+v.width/2,(p[1]-v.centre[1])/v.scale+v.height/2];
function draw(m,v=view,cached=false){const helper=make(m,cached),c=new Canvas(),before=JSON.stringify(m),report=helper.draw(c,v,colors);assert.equal(JSON.stringify(m),before);assert.deepEqual(c.state,{sx:1,sz:1,tx:0,tz:0,fillStyle:'original',clip:null});return{helper,c,report};}

test('registered terrain rectangle clips source water and leaves map exterior neutral',()=>{
  const {c,report}=draw(map([water(-100,-100,50,200)]));
  assert.equal(c.pixel(75,100),'water');assert.equal(c.pixel(125,100),'land');
  assert.equal(c.pixel(25,100),'outside');assert.equal(c.pixel(175,100),'outside');
  assert.equal(report.drawnAreas,1);assert.equal(c.commands.filter(c=>c.color==='water')[0].rule,'evenodd');
});
test('per-area even-odd holes preserve land regardless of winding while overlaps remain water union',()=>{
  const m=map([water(0,0,100,100,[ring(20,20,80,80).reverse()]),water(40,40,60,60),water(0,0,100,10)]),{c}=draw(m);
  assert.equal(c.pixel(...project([30,30],view)),'land');assert.equal(c.pixel(...project([50,50],view)),'water');
  assert.equal(c.pixel(...project([10,5],view)),'water','Overlapping waters must not XOR into land');
  assert.ok(c.commands.filter(c=>c.color==='water').every(c=>c.rule==='evenodd'));
});
test('near-distance projection uses east right/north up and culls remote source areas',()=>{
  const v={width:100,height:80,centre:[10,10],scale:.1},m=map([water(11,8,12,9),water(80,80,90,90)]),{c,report}=draw(m,v);
  assert.equal(c.pixel(...project([11.5,8.5],v)),'water');assert.equal(c.pixel(...project([8.5,11.5],v)),'land');assert.equal(report.drawnAreas,1);
});
test('world-space cached Path2D and fallback Canvas paths produce identical full-theatre and zoomed pixels',()=>{
  const m=map([water(-10,-10,110,110,[ring(25,25,75,75)]),water(40,40,60,60)]),before=JSON.stringify(m),f=make(m,true);
  assert.equal(f.stats.cachedPaths,2);
  for(const v of [view,{width:80,height:60,centre:[45,45],scale:.5}]){
    const cached=new Canvas(),fallback=draw(m,v).c;f.draw(cached,v,colors);
    for(let x=2;x<v.width;x+=7)for(let z=3;z<v.height;z+=9)assert.equal(cached.pixel(x,z),fallback.pixel(x,z));
  }
  assert.equal(JSON.stringify(m),before);assert.equal(f.stats.cachedPaths,2);
});
test('view outside the source extent draws no invented terrain or water; vertex extent fallback is bounded',()=>{
  const {c,report}=draw(map([water(-1000,-1000,1000,1000)]),{width:100,height:100,centre:[500,500],scale:1});
  assert.equal(report.drawnAreas,0);assert.equal(c.pixel(50,50),'outside');
  const f=make({terrain:{x0:10,z0:20,cellX:5,cellZ:7,width:3,height:4,waterAreas:[]}});
  assert.deepEqual(JSON.parse(JSON.stringify(f.bounds)),{minX:10,maxX:20,minZ:20,maxZ:41});assert.equal(f.stats.extentSource,'terrain.vertexBounds');
});
test('actual Taiwan whole-theatre paths preserve main island/mainland holes and three independent ocean samples',()=>{
  const m=JSON.parse(fs.readFileSync(new URL('../../data/frontline/taiwan.json',import.meta.url),'utf8')),b=m.bounds;
  const v={width:480,height:340,centre:[(b.minX+b.maxX)/2,(b.minZ+b.maxZ)/2],scale:Math.max((b.maxX-b.minX)/480,(b.maxZ-b.minZ)/340)*1.08},{c,helper,report}=draw(m,v,true);
  assert.equal(helper.stats.areas,224);assert.equal(report.drawnAreas,224);
  for(const p of [[63692.790417,30317.057057],[-208967.809105,-137259.534867]])assert.equal(c.pixel(...project(p,v)),'land');
  for(const p of [[-58279.366605,-47193.972123],[23289.155486,262995.483014],[216214.357020,6672.710057]])assert.equal(c.pixel(...project(p,v)),'water');
  assert.equal(c.pixel(1,1),'outside');
});
test('actual Korea/Taiwan local river paths agree with registered triangle interiors and pads remain dry',()=>{
  for(const id of ['korea','taiwan']){
    const m=JSON.parse(fs.readFileSync(new URL(`../../data/frontline/${id}.json`,import.meta.url),'utf8')),f=make(m,true);
    const waterArea=m.terrain.waterAreas.find(a=>a.source.kind!=='natural_earth_coarse_ocean_mask');
    for(const t of waterArea.triangles.slice(0,5)){
      const p=[(t[0]+t[2]+t[4])/3,(t[1]+t[3]+t[5])/3],v={width:100,height:80,centre:p,scale:2},c=new Canvas();f.draw(c,v,colors);assert.equal(c.pixel(50,40),'water');
    }
    const pad=m.terrain.pads.find(p=>m.staging.some(s=>s.enabled&&s.padId===p.id)),v={width:100,height:80,centre:pad.center,scale:2},c=new Canvas();
    f.draw(c,v,colors);assert.equal(c.pixel(50,40),'land');assert.ok(c.commands.filter(c=>c.color==='water').length<15,'Near view culls remote water areas');
  }
});
test('malformed source rings/bounds/views fail explicitly without painting speculative geometry',()=>{
  assert.throws(()=>make(map([{ring:[[0,0],[1,0],[1,1],[0,1]],holes:[]}])),/closed/);
  assert.throws(()=>make(map([{ring:[[0,0],[NaN,0],[1,1],[0,0]],holes:[]}])),/finite/);
  assert.throws(()=>make({...map([]),bounds:{minX:1,maxX:0,minZ:0,maxZ:1}}),/bounds/);
  assert.throws(()=>make({terrain:{waterAreas:[]}}),/extent/);
  for(const v of [{...view,scale:0},{...view,centre:[NaN,0]},{...view,width:Infinity}])assert.throws(()=>make(map([])).draw(new Canvas(),v),/view/);
});
