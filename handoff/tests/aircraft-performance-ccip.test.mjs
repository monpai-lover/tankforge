import {migration} from './fixtures/r7-aircraft-contract.mjs';
// Exact original/current production predictor comparison. This is a pure CPU
// calculation test with scenario inputs; it never steps or edits a native world.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import zlib from 'node:zlib';
import {createHash} from 'node:crypto';
import {api,maps,source,section} from './jet-fixture.mjs';

const original=fs.readFileSync(new URL('fixtures/ccip-original-c213-20261025.js',import.meta.url),'utf8').trimEnd();
assert.equal(createHash('sha256').update(original).digest('hex'),'dcbf6cfa2d6f2c196ecb87cf5b8c94b560041ac19bc09e4984bd1c019fd0ec84');
const current=section('    function storeImpact(air) {','\n    function visibleStoreImpact(').trimEnd();
const ground=section('  function groundHit(','  function groundRay(');
const definitions=JSON.parse(JSON.stringify(api.AIR_STORE_DEFS));
const weapons=Object.keys(definitions).filter(id=>['bomb','rocket','pod'].includes(definitions[id].kind));
const inflate=value=>zlib.inflateSync(Buffer.from(value,'base64'));

function host(predictor,mapName){
  // Use the VM's native Math intrinsics, as the production realm does. Passing
  // host-realm Math would add a cross-context call to every integration sample.
  const c=vm.createContext({definitions,Float32Array,Map});
  vm.runInContext(section('  var ZONES = [','  var f = (v2) =>')+
    section('  var HUMP_LANES = [','  function groundRay(')+
    section('  var MAP_CLASSES = [','  // client/web/src/game/treeShapes.js')+
    section('  var CHUNK = 16;','  // client/web/src/game/gameplaySession.js')+
    `var G4={map:null},AIR_STORE_DEFS=definitions,G3=9.80665;const norm=a=>{const l=Math.hypot(...a)||1;return a.map(v=>v/l);};\n`+
    section('    function storeGroup(st) {','    function cycleStore(')+
    'var terrain=new Terrain({},humpLift),calls=0;const originalHeight=terrain.height;terrain.height=function(x,z){calls++;return originalHeight.call(this,x,z);};\n'+
    source.match(/    const surfaceAt = \(x, z\) => [^\n]+/)[0]+'\n'+
    source.match(/    const AIR_RHO = \(y\) => [^\n]+/)[0]+'\n'+predictor+
    '\nglobalThis.fixture={predict:storeImpact,terrain,setMap:m=>{G4.map=m;setActiveMap(m);terrain.extra=m?null:humpLift;},mapPrototype:BattleMap.prototype,surfaceAt,getCalls:()=>calls,clear:()=>{calls=0;}};',c);
  if(mapName!=='range'){
    const def=maps[mapName];assert.ok(def,'Actual current source map missing: '+mapName);
    const bytes=inflate(def.heights.data),heights16=new Int16Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/2);
    const map=Object.create(c.fixture.mapPrototype);
    Object.assign(map,{def,id:def.id,size:def.size_m,x0:-def.size_m/2,z0:-def.size_m/2,waterLevel:def.water_level_m??0,
      hres:def.heights.res,cres:def.classes.res,classes:inflate(def.classes.data),heights:Float32Array.from(heights16,v=>v*def.heights.scale_m),surfaces:def.surfaces,names:def.classes.names||['water','sand','grass','forest','road','rock']});
    map.WATER=map.names.indexOf('water');c.fixture.setMap(map);
  }
  return c.fixture;
}
function air(host,id,agl,pose){
  const [pitch,bank,heading,speed,x,z,lastSide]=pose,cp=Math.cos(pitch),sp=Math.sin(pitch),ch=Math.cos(heading),sh=Math.sin(heading),cb=Math.cos(bank),sb=Math.sin(bank);
  const forward=[sh*cp,sp,ch*cp],right=[ch,0,-sh],up=[-sh*sp,cp,-ch*sp];
  const r=right.map((v,i)=>v*cb+up[i]*sb),u=up.map((v,i)=>v*cb-right[i]*sb),pos=[x,host.surfaceAt(x,z)+agl,z];
  const local=[...r,0,...u,0,...forward,0,...pos,1],cur=new Float32Array(80);cur.set(forward.map(v=>v*speed),7);
  const items=[-1,1].map((side,station)=>({id,side,station,p:[side*2,-.25,0],count:1,gone:false}));
  return{plane:{onGround:false,crashed:false,cur,root:{local},worldPoint:p=>[0,1,2].map(i=>local[i]*p[0]+local[i+4]*p[1]+local[i+8]*p[2]+local[i+12])},stores:{groups:[id],sel:0,items,lastSide}};
}
const bits=n=>{const b=Buffer.alloc(8);b.writeDoubleLE(n);return b.toString('hex');};
function same(a,b,label){
  assert.equal(a===null,b===null,label);if(a===null)return;
  assert.deepEqual(Object.keys(a),Object.keys(b));for(const key of Object.keys(a)){
    if(Array.isArray(a[key]))assert.deepEqual(Array.from(a[key],bits),Array.from(b[key],bits),label+' '+key);
    else if(typeof a[key]==='number')assert.equal(bits(a[key]),bits(b[key]),label+' '+key);
    else assert.equal(a[key],b[key],label+' '+key);
  }
}
const poses=[[0,0,0,180,0,20,0],[-.95,.6,1.3,260,-450,-380,-1],[.78,-1.2,-2,90,210,460,1],[1.48,2.26,2.4,350,-250,300,0]];
test('current production cache preserves every Float64 result over all actual bombs/rockets/pods and three actual terrain paths',()=>{
  assert.deepEqual(weapons.slice().sort(),[...migration.oldCcipWeaponIds,'samp250'].sort());assert.equal(migration.oldCcipWeaponIds.length,32);assert.deepEqual(weapons.slice().sort(),migration.newCcipWeaponIds);let cases=0,oldCalls=0,newCalls=0,maxOld=0,maxNew=0;
  for(const map of ['range','coast','normandy']){
    const a=host(original,map),b=host(current,map);
    for(const weapon of weapons)for(const agl of [0,1,100,1000,3000,8000])for(const pose of poses){
      const oldAir=air(a,weapon,agl,pose),newAir=air(b,weapon,agl,pose);a.clear();b.clear();const old=a.predict(oldAir),now=b.predict(newAir);same(old,now,`${map}/${weapon}/${agl}`);
      const before=a.getCalls(),after=b.getCalls(),hit=old===null?0:1,steps=(before-hit)/2;
      assert.ok(Number.isInteger(steps)&&steps>0);assert.equal(after,steps+1+hit);oldCalls+=before;newCalls+=after;maxOld=Math.max(maxOld,before);maxNew=Math.max(maxNew,after);cases++;
    }
  }
  assert.equal(cases,2376);assert.ok(newCalls/oldCalls<.501);assert.equal(maxOld,9602);assert.equal(maxNew,4802);
  console.log(JSON.stringify({scope:'Current source exact predictor CPU equivalence; no FPS/native mixed-mode CCIP claim',cases,oldCalls,newCalls,maxOld,maxNew}));
});
test('ground/crash/empty/unsupported paths stay zero-work and later deformation is sampled afresh',()=>{
  const a=host(original,'range'),b=host(current,'range');
  for(const mutate of [v=>v.plane.onGround=true,v=>v.plane.crashed=true,v=>v.stores=null,v=>v.stores.groups=[],v=>v.stores.items.forEach(it=>it.gone=true)]){
    const av=air(a,'mk82',100,poses[0]),bv=air(b,'mk82',100,poses[0]);mutate(av);mutate(bv);a.clear();b.clear();same(a.predict(av),b.predict(bv),'early return');assert.equal(a.getCalls(),0);assert.equal(b.getCalls(),0);
  }
  const missileA=air(a,'aim9b',100,poses[0]),missileB=air(b,'aim9b',100,poses[0]);a.clear();b.clear();same(a.predict(missileA),b.predict(missileB),'unsupported missile');assert.equal(a.getCalls(),0);assert.equal(b.getCalls(),0);
  const pose=[0,0,0,0,0,20,0],av=air(a,'mk82',100,pose),bv=air(b,'mk82',100,pose),before=a.predict(av);same(before,b.predict(bv),'before deformation');
  for(const h of [a,b])for(let x=-2;x<=0;x++)for(let z=0;z<=2;z++)h.terrain._chunk(x,z,true).h.fill(-2);
  const after=a.predict(av);same(after,b.predict(bv),'after deformation');assert.notEqual(JSON.stringify(after),JSON.stringify(before));
});
