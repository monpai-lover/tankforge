import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { hetzerWitness, bruteForce, sha, bytesOf, rendererSink, captureNodes, positionsOf, verifyCrewCapture } from '../tools/hit-mesh-capture.mjs';
import { fixtureManifest, mintPackedSources, meshPayload, matrixBits, canonical, hashValue } from '../tools/export-hit-mesh.mjs';
import { Node, m4, translation } from '../src/gfx/math.js';
import { loadCoreSync } from '../src/design/core.js';
import { loadData } from '../tools/load-data.mjs';
import { decodeAllImported, decodeImported, partMesh } from '../src/gfx/imported.js';
import { workshopImportedModel, exportWorkshopModel } from '../src/game/workshopImported.js';
import * as hitExport from '../tools/export-hit-mesh.mjs';
import { normalizeWorkshopBuild } from '../src/game/workshopBuild.js';
import { buildToBundle, exportFolder, makeLoadout, generatedTurretParts } from '../src/game/loadout.js';
import { Combat } from '../src/game/combat.js';
import { buildTank } from '../src/gfx/tankmodel.js';
import { buildInterior, setCrewModel } from '../src/gfx/interior.js';
import { setMgModels } from '../src/gfx/mgmodel.js';

const data=loadData();
const wasmPath=process.env.TG_TEST_WASM || new URL('../assets/tg_design.wasm',import.meta.url);
const wasm=fs.readFileSync(wasmPath);
const core=loadCoreSync(wasm,{materials:data.materials,catalog:data.designCatalog,terrains:Object.values(data.terrains)});
function schemaValid(v,s,root=schemaDefinition){
  if(s.$ref)return schemaValid(v,s.$ref.split('/').slice(1).reduce((o,k)=>o[k],root),root);
  if(s.anyOf){if(!s.anyOf.some(q=>{try{schemaValid(v,q,root);return true;}catch{return false;}}))throw new Error('schema anyOf failed');return;}
  if(s.const!==undefined)assert.deepEqual(v,s.const);if(s.enum)assert.ok(s.enum.some(x=>x===v));
  const type=v===null?'null':Array.isArray(v)?'array':typeof v==='object'?'object':typeof v==='number'&&Number.isInteger(v)?'integer':typeof v;
  if(s.type){const types=Array.isArray(s.type)?s.type:[s.type];assert.ok(types.includes(type)||(type==='integer'&&types.includes('number')),`${type} does not match ${types}`);}
  if(typeof v==='string'){if(s.minLength!==undefined)assert.ok(v.length>=s.minLength);if(s.maxLength!==undefined)assert.ok(v.length<=s.maxLength);if(s.pattern)assert.match(v,new RegExp(s.pattern));}
  if(typeof v==='number'){if(s.minimum!==undefined)assert.ok(v>=s.minimum);if(s.maximum!==undefined)assert.ok(v<=s.maximum);}
  if(Array.isArray(v)){if(s.minItems!==undefined)assert.ok(v.length>=s.minItems);if(s.maxItems!==undefined)assert.ok(v.length<=s.maxItems);if(s.items)v.forEach(x=>schemaValid(x,s.items,root));}
  if(v&&typeof v==='object'&&!Array.isArray(v)){for(const k of s.required || [])assert.ok(Object.hasOwn(v,k),`missing schema field ${k}`);if(s.additionalProperties===false)for(const k of Object.keys(v))assert.ok(Object.hasOwn(s.properties || {},k),`unknown schema field ${k}`);for(const[k,q]of Object.entries(s.properties || {}))if(Object.hasOwn(v,k))schemaValid(v[k],q,root);}
}
const schemaDefinition=JSON.parse(fs.readFileSync(new URL('../../../schemas/hit-mesh.schema.json',import.meta.url)));
function registered(result){
  const leases=[];
  try { for(const[hash,payload]of result.payloads)leases.push(core.combatGeometryInstall(payload,hash).handle);
    const scene=core.combatGeometryRegister(result.text,result.expectedHash,leases);return{scene,leases,context:{entityId:'oracle',spawnEpoch:1,buildHash:result.manifest.buildHash,poseRevision:0},dispose(){core.combatGeometryRelease(scene.handle);leases.forEach(h=>core.combatGeometryRelease(h));}};
  }catch(e){leases.forEach(h=>core.combatGeometryRelease(h));throw e;}
}
function closedFixture(points,triangles,name='closed-fixture'){
  const buffer=new Float32Array(triangles.length*3*13);triangles.forEach((q,i)=>q.forEach((v,j)=>buffer.set(points[v],(i*3+j)*13)));
  const result=fixtureManifest([{key:name,data:buffer,positions:positionsOf(buffer),world:m4(),matrices:null,count:1}],name),m=result.manifest;
  m.surfaces[0].role='decoration';m.surfaces[0].topology='closed_solid';m.meshes[0].ranges[0].solidKey='certified-solid';
  delete m.manifestHash;m.manifestHash=hashValue(m);result.text=canonical(m);result.expectedHash=sha(Buffer.from(result.text));return result;
}
const cubePoints=[[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]];
const cubeTriangles=[[0,3,2],[0,2,1],[4,5,6],[4,6,7],[0,4,7],[0,7,3],[1,2,6],[1,6,5],[0,1,5],[0,5,4],[3,7,6],[3,6,2]];
test('finite coplanar clipping follows an independent exact dyadic interval oracle across scales windings directions and topologies',()=>{
  const integer=x=>{const n=x*2**250;assert.ok(Number.isInteger(n));return BigInt(n);},cmp=(a,b)=>a.n*b.d-b.n*a.d;
  function oracle(a,b,scale){
    const sa=integer(scale),pa=a.map(integer),pb=b.map(integer),aa=[pa[0],pa[1],sa-pa[0]-pa[1]],bb=[pb[0],pb[1],sa-pb[0]-pb[1]];
    let lo={n:0n,d:1n},hi={n:1n,d:1n};
    for(let i=0;i<3;i++){
      if(aa[i]<0n&&bb[i]<0n)return null;
      if(aa[i]<0n){const r={n:-aa[i],d:bb[i]-aa[i]};if(cmp(r,lo)>0n)lo=r;}
      if(bb[i]<0n){const r={n:aa[i],d:aa[i]-bb[i]};if(cmp(r,hi)<0n)hi=r;}
    }
    return cmp(lo,hi)>0n?null:lo;
  }
  const failures=[];let queries=0,outside=0,valid=0;
  for(const scaleExponent of [-40,0,40])for(const topology of ['audit_pending','open_sheet','boundary_shell','decorative_surface','closed_solid'])for(const order of [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]]){
    const s=2**scaleExponent,points=[[0,0,0],[s,0,0],[0,s,0],[0,0,-s]],triangles=topology==='closed_solid'?[order,[order[0],3,order[1]],[order[0],order[2],3],[order[1],3,order[2]]]:[order],buffer=new Float32Array(triangles.length*39);triangles.forEach((t,i)=>t.forEach((v,j)=>buffer.set(points[v],(i*3+j)*13)));
    const r=fixtureManifest([{key:'finite-coplanar-dyadic',data:buffer,positions:positionsOf(buffer),world:m4(),matrices:null,count:1}]);if(topology!=='audit_pending'){r.manifest.surfaces[0].role='decoration';r.manifest.surfaces[0].topology=topology;}if(topology==='closed_solid')r.manifest.meshes[0].ranges[0].solidKey='finite-coplanar-tetrahedron';const f=registered(reseal(r));
    const cases=[];for(const power of [-52,-53,-55,-100,-200]){const d=s*2**power;cases.push([[-.5*s,.25*s,0],[-d,.25*s,0]],[[.25*s,-.5*s,0],[.25*s,-d,0]],[[.5*s,s,0],[d,s,0]]);}
    const q=2**-53;cases.push([[(-1-4*q)*s,(1+2*q)*s,0],[s,(-1+q)*s,0]],[[(-1-4*q)*s,(1+2*q)*s,0],[s,(-1+2*q)*s,0]],[[-s,s,0],[s,-s*(1+2**-52),0]],[[-s,s,0],[s,-s,0]],[[-.5*s,.25*s,0],[.25*s,.25*s,0]],[[-.5*s,.25*s,0],[0,.25*s,0]],[[.25*s,.25*s,0],[.25*s,.25*s,0]]);
    try{for(const[a,b]of cases)for(const[start,end]of [[a,b],[b,a]]){
      const expected=oracle(start,end,s);queries++;if(expected)valid++;else outside++;
      try{const h=core.combatGeometryTrace(f.scene.handle,start,end,f.context,32).crossings;
        if(expected===null? h.length!==0 : h.length===0||Math.abs(h[0].t-Number(expected.n)/Number(expected.d))>2*Number.EPSILON)failures.push({scaleExponent,topology,order,start,end,expected:expected&&[String(expected.n),String(expected.d)],h});
      }catch(e){if(e.code==='ERR_ASSERTION')throw e;assert.match(e.message,/precision|uncertainty|underflow|overflow|certified|interval|lost actual contact/);}
    }}finally{f.dispose();}
  }
  assert.equal(queries,3960);assert.equal(outside,3060);assert.equal(valid,900);assert.equal(failures.length,0,`${failures.length} wrong successful outcomes; first ${JSON.stringify(failures[0])}`);
});
test('finite coplanar competing halfspaces and exact vertex tangents survive shear tilt and axis projections',()=>{
  const q=2**-53,fixtures=[
    {points:[[0,0,0],[1,0,0],[0,1,0]],a:[-1-4*q,1+2*q,0],b:[1,-1+q,0],ta:[-1-4*q,1+4*q,0],tb:[1,-1,0]},
    {points:[[0,0,0],[1,0,0],[1,1,0]],a:[-2*q,1+2*q,0],b:[q,-1+q,0],ta:[0,1+4*q,0],tb:[0,-1,0]},
    {points:[[0,0,0],[1,0,1],[0,1,1]],a:[-1-4*q,1+2*q,-2*q],b:[1,-1+q,q],ta:[-1-4*q,1+4*q,0],tb:[1,-1,0]},
  ];
  // q-4q^2 > 0 is the exact cross-product difference between x-entry
  // and y-exit roots; both nevertheless round to .5+q in f64.
  const denominator=1n<<53n;assert.ok(denominator-4n>0n);let queries=0;const failures=[];
  for(const exponent of [-40,0,40])for(let rotation=0;rotation<3;rotation++)for(const source of fixtures)for(const topology of ['audit_pending','open_sheet','boundary_shell','decorative_surface','closed_solid'])for(const order of [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]]){
    const project=p=>p.map((_,k)=>p[(k+rotation)%3]*2**exponent),points=[...source.points,[0,0,-1]].map(project),triangles=topology==='closed_solid'?[order,[order[0],3,order[1]],[order[0],order[2],3],[order[1],3,order[2]]]:[order],buffer=new Float32Array(triangles.length*39);triangles.forEach((t,i)=>t.forEach((v,j)=>buffer.set(points[v],(i*3+j)*13)));
    const r=fixtureManifest([{key:'competing-coplanar-axes',data:buffer,positions:positionsOf(buffer),world:m4(),matrices:null,count:1}]);if(topology!=='audit_pending'){r.manifest.surfaces[0].role='decoration';r.manifest.surfaces[0].topology=topology;}if(topology==='closed_solid')r.manifest.meshes[0].ranges[0].solidKey='competing-coplanar-tetrahedron';const f=registered(reseal(r));
    try{for(const[start,end,empty]of [[source.a,source.b,true],[source.b,source.a,true],[source.ta,source.tb,false],[source.tb,source.ta,false]]){
      queries++;try{const h=core.combatGeometryTrace(f.scene.handle,project(start),project(end),f.context,32).crossings;if(empty?h.length!==0:h.length===0)failures.push({exponent,rotation,topology,order,start,end,empty,h});}catch(e){assert.match(e.message,/precision|uncertainty|underflow|overflow|certified|interval|lost actual contact/);}
    }}finally{f.dispose();}
  }
  assert.equal(queries,3240);assert.equal(failures.length,0,`${failures.length} wrong successful projected outcomes; first ${JSON.stringify(failures[0])}`);
});
test('every finite axis-plane interior fraction matches an independent BigInt nearest-even quotient oracle',t=>{
  const n=1n<<52n,rounded=(num,den,shift)=>{const scaled=num<<BigInt(shift);let q=scaled/den;const rem=scaled%den;if(rem*2n>den||(rem*2n===den&&(q&1n)))q++;return Number(q)*2**-shift;};
  let queries=0,uncertain=0;const failures=[];
  for(const exponent of [-120,-40,0,40,120])for(let rotation=0;rotation<3;rotation++)for(const topology of ['audit_pending','open_sheet','boundary_shell','decorative_surface','closed_solid'])for(const order of [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]]){
    const s=2**exponent,project=p=>p.map((_,k)=>p[(k+rotation)%3]),points=[[0,0,0],[s,0,0],[0,s,0],[0,0,-s]].map(project),triangles=topology==='closed_solid'?[order,[order[0],3,order[1]],[order[0],order[2],3],[order[1],3,order[2]]]:[order],buffer=new Float32Array(triangles.length*39);triangles.forEach((t,i)=>t.forEach((v,j)=>buffer.set(points[v],(i*3+j)*13)));
    const r=fixtureManifest([{key:'axis-fraction-nearest-even',data:buffer,positions:positionsOf(buffer),world:m4(),matrices:null,count:1}]);if(topology!=='audit_pending'){r.manifest.surfaces[0].role='decoration';r.manifest.surfaces[0].topology=topology;}if(topology==='closed_solid')r.manifest.meshes[0].ranges[0].solidKey='axis-fraction-tetrahedron';const f=registered(reseal(r));
    try{for(const m of [1n,2n,3n,5n,7n,15n,31n,63n]){
      // Closed fixtures start inside, below the top face and above all side faces.
      // This common power-of-two factor preserves N/(2N+m) exactly.
      const a=project([s*.25,s*.25,-s*.125]),b=project([s*.25,s*.25,s*.125*(1+Number(m)*Number.EPSILON)]),den=2n*n+m;
      for(const[start,end,expected]of [[a,b,rounded(n,den,54)],[b,a,rounded(n+m,den,53)]]){
        queries++;try{const h=core.combatGeometryTrace(f.scene.handle,start,end,f.context,32).crossings;
          if(h.length!==1||h[0].t!==expected)failures.push({exponent,rotation,topology,order,m:String(m),start,end,expected,h});
        }catch(e){assert.match(e.message,/precision|uncertainty|underflow|overflow|certified|interval|lost actual contact/);uncertain++;}
      }
    }}finally{f.dispose();}
  }
  assert.equal(queries,7200);t.diagnostic(`${queries} exact ratio queries, ${uncertain} explicit numerical uncertainties, ${failures.length} wrong successful fractions or silent misses`);assert.equal(failures.length,0,`${failures.length} inaccurate successful axis fractions; first ${JSON.stringify(failures[0])}`);
});
test('axis-plane exact certification preserves minimum-subnormal direct crossings in actual WASM',()=>{
  for(const scale of [1,2**-149])for(let rotation=0;rotation<3;rotation++)for(const topology of ['audit_pending','open_sheet','boundary_shell','decorative_surface']){
    const project=p=>p.map((_,k)=>p[(k+rotation)%3]),points=[[0,0,0],[scale,0,0],[0,scale,0]].map(project),buffer=new Float32Array(39);points.forEach((p,i)=>buffer.set(p,13*i));const r=fixtureManifest([{key:'axis-fraction-subnormal',data:buffer,positions:positionsOf(buffer),world:m4(),matrices:null,count:1}]);if(topology!=='audit_pending'){r.manifest.surfaces[0].role='decoration';r.manifest.surfaces[0].topology=topology;}const f=registered(reseal(r));
    try{for(const d of [Number.MIN_VALUE,2*Number.MIN_VALUE,3*Number.MIN_VALUE,137*Number.MIN_VALUE,1e-310]){const a=project([scale*.25,scale*.25,-d]),b=project([scale*.25,scale*.25,d]);for(const[start,end]of [[a,b],[b,a]]){const h=core.combatGeometryTrace(f.scene.handle,start,end,f.context,32).crossings;assert.equal(h.length,1);assert.equal(h[0].t,.5);}}}finally{f.dispose();}
  }
});
test('triangle cancellation in every topology winding reverse and affine query follows an independent dyadic oracle',()=>{
  const canonical=[[-1,0,1],[0,1,-1],[1,-1,0],[0,0,-2]],xy=[[-1,0,0],[0,1,0],[1,-1,0],[0,0,-2]],identity=m4(),mirror=m4(),translated=m4(),shear=m4(),mirrorShear=m4();
  mirror[0]=-1;translated[12]=4;translated[14]=-4;shear[2]=-1;shear[6]=-1;mirrorShear.set(shear);mirrorShear[0]=-1;
  const variants=[['identity',canonical,identity,[1n,1n,1n],false,false],['mirror',canonical,mirror,[-1n,1n,1n],true,false],['translated',canonical,translated,[1n,1n,1n],false,true],['shear',xy,shear,[1n,1n,1n],false,false],['mirror-shear',xy,mirrorShear,[-1n,1n,1n],true,false]];
  const orders=[[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]],failures=[];let queries=0;
  const residual=(p,signs)=>p.reduce((sum,x,k)=>{const integer=x*2**56;assert.ok(Number.isInteger(integer));return sum+BigInt(integer)*signs[k];},0n);
  for(const topology of ['audit_pending','open_sheet','boundary_shell','decorative_surface','closed_solid'])for(const[name,points,matrix,signs,reflect,translate]of variants)for(const order of orders){
    const triangles=topology==='closed_solid'?[order,[order[0],3,order[1]],[order[0],order[2],3],[order[1],3,order[2]]]:[order],buffer=new Float32Array(triangles.length*39);
    triangles.forEach((q,i)=>q.forEach((v,j)=>buffer.set(points[v],(i*3+j)*13)));
    const r=fixtureManifest([{key:'analytic-cancellation',data:buffer,positions:positionsOf(buffer),world:matrix,matrices:null,count:1}],`analytic-${topology}`),m=r.manifest;
    if(topology!=='audit_pending'){m.surfaces[0].role='decoration';m.surfaces[0].topology=topology;}if(topology==='closed_solid')m.meshes[0].ranges[0].solidKey='analytic-tetrahedron';
    const f=registered(reseal(r)),world=p=>[p[0]*(reflect?-1:1)+(translate?4:0),p[1],p[2]-(translate?4:0)];
    try{
      for(const exponent of [-55,-56,-40]){const d=2**exponent;
        for(const[label,rawA,rawB,center]of [['parallel',[-.25,d,.25],[.25,d,-.25],false],['center',[-.25,-d,.25],[.25,d,-.25],true],['oblique',[-.25,d,.25],[.25,2*d,-.25],false]]){
          const a=world(rawA),b=world(rawB),ra=residual(a,signs),rb=residual(b,signs);assert.notEqual(ra,0n);assert.notEqual(rb,0n);assert.equal(ra===-rb,center);
          for(const[start,end]of [[a,b],[b,a]]){queries++;try{const hits=core.combatGeometryTrace(f.scene.handle,start,end,f.context,32).crossings;if(center?hits.length!==1||hits[0].t!==.5:hits.length!==0)failures.push({topology,name,order,exponent,label,start,end,hits});}catch(e){assert.match(e.message,/precision|uncertainty|underflow|overflow|certified|interval|lost actual contact/);}}
        }
      }
      const h=core.combatGeometryTrace(f.scene.handle,world([-.25,-.125,.25]),world([.25,.125,-.25]),f.context,32).crossings;assert.equal(h.length,1);assert.ok(Math.abs(h[0].t-.5)<=2*Number.EPSILON);
      if(topology!=='closed_solid'){const h=core.combatGeometryTrace(f.scene.handle,world([-.25,0,.25]),world([.25,0,-.25]),f.context,32).crossings;assert.equal(h.length,1);assert.equal(h[0].t,0);}
    }finally{f.dispose();}
  }
  assert.equal(queries,2700);assert.equal(failures.length,0,`${failures.length} wrong successful contacts; first ${JSON.stringify(failures[0])}`);
});
test('coplanar original-coordinate barycentric cancellation cannot grant an outside point',()=>{
  const d=2**-55,p=[d,1,0];assert.equal(BigInt(p[0]*2**56)+2n*BigInt(p[1]*2**56)-(2n<<56n),2n);
  for(const points of [[[1,0,0],[2,0,0],[0,1,0]],[[2,0,0],[1,0,0],[0,1,0]]]){
    const buffer=new Float32Array(39);points.forEach((q,i)=>buffer.set(q,i*13));const f=registered(fixtureManifest([{key:'analytic-edge',data:buffer,positions:positionsOf(buffer),world:m4(),matrices:null,count:1}]));
    try{try{assert.deepEqual(core.combatGeometryTrace(f.scene.handle,p,p,f.context,32).crossings,[]);}catch(e){if(e.code==='ERR_ASSERTION')throw e;assert.match(e.message,/precision|uncertainty|underflow|overflow|certified|interval/);}}finally{f.dispose();}
  }
});
test('inverse affine cancellation cannot silently miss a true world-plane crossing',()=>{
  const points=[[-1,0,0],[0,1,0],[1,-1,0],[0,0,-2]],matrix=m4();matrix[2]=-3;matrix[6]=-3;
  const q=2**-54;
  for(const exponent of [-100,-40]){const d=2**exponent,a=[.25+q,-.25+q,-6*q-d],b=[a[0],a[1],-6*q+d];
  const residual=p=>3n*BigInt(p[0]*2**100)+3n*BigInt(p[1]*2**100)+BigInt(p[2]*2**100);assert.equal(residual(a),-(1n<<BigInt(100+exponent)));assert.equal(residual(b),1n<<BigInt(100+exponent));
  for(const topology of ['audit_pending','open_sheet','boundary_shell','decorative_surface','closed_solid']){
    const triangles=topology==='closed_solid'?[[0,1,2],[0,3,1],[0,2,3],[1,3,2]]:[[0,1,2]],buffer=new Float32Array(triangles.length*39);triangles.forEach((t,i)=>t.forEach((v,j)=>buffer.set(points[v],(i*3+j)*13)));
    const r=fixtureManifest([{key:'analytic-affine-miss',data:buffer,positions:positionsOf(buffer),world:matrix,matrices:null,count:1}]);if(topology!=='audit_pending'){r.manifest.surfaces[0].role='decoration';r.manifest.surfaces[0].topology=topology;}if(topology==='closed_solid')r.manifest.meshes[0].ranges[0].solidKey='analytic-tetrahedron';const f=registered(reseal(r));
    try{for(const[start,end]of [[a,b],[b,a]])try{const h=core.combatGeometryTrace(f.scene.handle,start,end,f.context,32).crossings;assert.equal(h.length,1,`silent affine miss for ${topology}`);assert.equal(h[0].t,.5);}catch(e){if(e.code==='ERR_ASSERTION')throw e;assert.match(e.message,/precision|uncertainty|underflow|overflow|certified|interval/);}}finally{f.dispose();}
  }
  }
});
test('noncoplanar original edge and endpoint cancellation stays correct or explicitly uncertain',()=>{
  const d=2**-55,cases=[{key:'outside-edge',points:[[1,-1,0],[-1,1,0],[1,1,0]],a:[-d,0,-1],b:[-d,0,1],outside:true},{key:'exact-endpoint',points:[[-1,0,1],[0,1,-1],[1,-1,0]],a:[.25,.25,-.5],b:[1.25,.25,-.5],outside:false}];
  assert.equal(BigInt(cases[0].a[0]*2**56)+BigInt(cases[0].a[1]*2**56),-2n);assert.equal(cases[1].a.reduce((s,x)=>s+BigInt(x*2**56),0n),0n);
  for(const q of cases)for(const topology of ['audit_pending','open_sheet','boundary_shell','decorative_surface'])for(const points of [q.points,q.points.slice().reverse()]){
    const buffer=new Float32Array(39);points.forEach((p,i)=>buffer.set(p,i*13));const r=fixtureManifest([{key:q.key,data:buffer,positions:positionsOf(buffer),world:m4(),matrices:null,count:1}]);if(topology!=='audit_pending'){r.manifest.surfaces[0].role='decoration';r.manifest.surfaces[0].topology=topology;}const f=registered(reseal(r));
    try{for(const[a,b,t]of [[q.a,q.b,0],[q.b,q.a,1]])try{const h=core.combatGeometryTrace(f.scene.handle,a,b,f.context,32).crossings;if(q.outside)assert.deepEqual(h,[]);else{assert.equal(h.length,1);assert.equal(h[0].t,t);}}catch(e){if(e.code==='ERR_ASSERTION')throw e;assert.match(e.message,/precision|uncertainty|underflow|overflow|certified|interval/);}}finally{f.dispose();}
  }
});
test('rounded zero normal cannot certify an exact nondegenerate f32 triangle as empty',()=>{
  const large=2**80,tiny=2**-80;assert.equal(large*tiny,1);const points=[[large,large,0],[2*large,2*large,0],[0,tiny,0]],buffer=new Float32Array(39);points.forEach((p,i)=>buffer.set(p,i*13));assert.deepEqual(Array.from(positionsOf(buffer)),points.flat());
  const f=registered(fixtureManifest([{key:'exact-thin-normal',data:buffer,positions:positionsOf(buffer),world:m4(),matrices:null,count:1}]));
  try{try{const h=core.combatGeometryTrace(f.scene.handle,[0,tiny,-1],[0,tiny,1],f.context,32).crossings;assert.equal(h.length,1);assert.equal(h[0].t,.5);}catch(e){if(e.code==='ERR_ASSERTION')throw e;assert.match(e.message,/precision|uncertainty|underflow|overflow|certified|interval/);}}finally{f.dispose();}
});
for(const [name,end,triangles]of[
  ['edge tangency',[0,2,0],cubeTriangles],
  ['vertex tangency',[0,2,2],cubeTriangles],
  ['reordered vertex tangency',[0,2,2],[cubeTriangles[6],...cubeTriangles.filter((_,i)=>i!==6)]]
])test(`closed cube ${name} returns touch from actual adjacent occupancy`,()=>{
  const fixture=registered(closedFixture(cubePoints,triangles));try{
    const result=core.combatGeometryTrace(fixture.scene.handle,[2,0,0],end,fixture.context,32);
    assert.equal(result.crossings.length,1);assert.equal(result.crossings[0].t,.5);assert.equal(result.crossings[0].crossing,'touch');
    assert.ok(result.stats.occupancyTriangleTests>0);assert.equal(result.stats.occupancyPointTests,2);assert.ok(result.stats.occupancyRayAttempts>0);
  }finally{fixture.dispose();}
});
function reseal(result){delete result.manifest.manifestHash;result.manifest.manifestHash=hashValue(result.manifest);result.text=canonical(result.manifest);result.expectedHash=sha(Buffer.from(result.text));return result;}
test('closed nonconvex reentrant vertex uses occupancy despite mixed incident normals and reordered triangles',()=>{
  const p=[[-2,-2,-2],[2,-2,-2],[2,0,-2],[0,0,-2],[0,2,-2],[-2,2,-2],[-2,-2,0],[2,-2,0],[2,0,0],[0,0,0],[0,2,0],[-2,2,0]];
  const t=[[0,3,1],[1,3,2],[0,5,3],[3,5,4],[6,7,9],[7,8,9],[6,9,11],[9,10,11],[0,1,7],[0,7,6],[1,2,8],[1,8,7],[2,3,9],[2,9,8],[3,4,10],[3,10,9],[4,5,11],[4,11,10],[5,0,6],[5,6,11]];
  for(const triangles of [t,t.slice().reverse()]){
    const f=registered(closedFixture(p,triangles));try{
      const a=[1,-1,1],b=[-1,1,-1];
      for(const [start,end,kind]of [[a,b,'enter'],[b,a,'exit']]){const h=core.combatGeometryTrace(f.scene.handle,start,end,f.context,64).crossings;assert.equal(h.length,1);assert.equal(h[0].t,.5);assert.equal(h[0].crossing,kind);}
    }finally{f.dispose();}
  }
});
function nestedShellFixture(inward,distinct=false,copies=1){
  const points=[...cubePoints.map(p=>p.map(x=>x*2)),...cubePoints],triangles=[...cubeTriangles,...cubeTriangles.map(t=>{const q=t.map(i=>i+8);if(inward)[q[1],q[2]]=[q[2],q[1]];return q;})];
  const result=closedFixture(points,triangles),m=result.manifest,base=m.meshes[0].ranges[0];
  m.meshes[0].ranges=[{...base,count:12,solidKey:'outer'},{...base,first:12,count:12,solidKey:distinct?'inner':'outer'}];
  m.meshInstances=Array.from({length:copies},(_,i)=>({...m.meshInstances[0],key:`instance-${i}`}));return reseal(result);
}
test('closed cavity and same-solid outward overlap sum signed winding before occupancy',()=>{
  for(const [inward,kinds]of [[true,['enter','exit','enter','exit']],[false,['enter','touch','touch','exit']]]){
    const f=registered(nestedShellFixture(inward));try{
      const h=core.combatGeometryTrace(f.scene.handle,[-3,.2,.1],[3,.2,.1],f.context,64).crossings;
      assert.deepEqual(h.map(h=>h.crossing),kinds);h.forEach((h,i)=>assert.ok(Math.abs(h.t-[1/6,1/3,2/3,5/6][i])<1e-14));
    }finally{f.dispose();}
  }
});
test('closed distinct solids and instances retain independent winding scopes',()=>{
  const f=registered(nestedShellFixture(false,true,2));try{
    const h=core.combatGeometryTrace(f.scene.handle,[-3,.2,.1],[3,.2,.1],f.context,64).crossings;assert.equal(h.length,8);
    for(const id of ['instance-0','instance-1'])assert.deepEqual(h.filter(h=>h.instanceId===id).map(h=>h.crossing),['enter','enter','exit','exit']);
  }finally{f.dispose();}
});
test('closed endpoint coplanar mirror and zero-length boundary semantics remain exact',()=>{
  const f=registered(closedFixture(cubePoints,cubeTriangles));try{
    for(const [a,b,t,kind]of [[[1,.2,.1],[0,.2,.1],0,'enter'],[[0,.2,.1],[1,.2,.1],1,'exit'],[[1,1,0],[0,2,0],0,'touch'],[[2,1,0],[0,1,0],.5,'touch'],[[1,0,0],[1,0,0],0,'touch']]){
      const h=core.combatGeometryTrace(f.scene.handle,a,b,f.context,32).crossings;assert.ok(h.length);assert.equal(h[0].t,t);assert.ok(h.every(h=>h.crossing===kind));
    }
  }finally{f.dispose();}
  const result=closedFixture(cubePoints,cubeTriangles);result.manifest.meshInstances[0].worldBits=matrixBits(new Float32Array([-1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]));const mirrored=registered(reseal(result));try{
    const h=core.combatGeometryTrace(mirrored.scene.handle,[-2,0,0],[0,2,0],mirrored.context,32).crossings;assert.equal(h.length,1);assert.equal(h[0].crossing,'touch');
  }finally{mirrored.dispose();}
});
test('closed surface metadata partitions share one physical solid feature',()=>{
  const result=closedFixture(cubePoints,cubeTriangles),m=result.manifest,base=m.meshes[0].ranges[0];
  m.surfaces.push({...m.surfaces[0],key:'surface-second'});m.meshes[0].ranges=[{...base,count:7},{...base,first:7,count:5,surfaceKey:'surface-second'}];
  const f=registered(reseal(result));try{const h=core.combatGeometryTrace(f.scene.handle,[2,0,0],[0,2,0],f.context,32).crossings;assert.equal(h.length,1);assert.equal(h[0].crossing,'touch');}finally{f.dispose();}
});
test('closed distinct contact intervals below parameter precision return an explicit error',()=>{
  const points=cubePoints.map(p=>[p[0]*1.401298464324817e-45,p[1],p[2]]),f=registered(closedFixture(points,cubeTriangles));
  try{assert.throws(()=>core.combatGeometryTrace(f.scene.handle,[-1,.2,.1],[1,.2,.1],f.context,32),/interval/);}finally{f.dispose();}
});
test('closed internal coplanar overlap retains outer solid occupancy',()=>{
  const f=registered(nestedShellFixture(false));try{
    const h=core.combatGeometryTrace(f.scene.handle,[-3,1,.1],[3,1,.1],f.context,64).crossings;
    assert.equal(h[0].crossing,'enter');assert.equal(h.at(-1).crossing,'exit');assert.ok(h.slice(1,-1).every(h=>h.crossing==='touch'));
  }finally{f.dispose();}
});
test('closed cancellation cannot certify a false coplanar boundary',()=>{
  const f=registered(closedFixture([[0,0,0],[1,0,1],[0,1,1],[0,0,-1]],[[0,1,2],[0,3,1],[0,2,3],[1,3,2]]));
  const tiny=2**-56;try{let h;try{h=core.combatGeometryTrace(f.scene.handle,[.125,tiny,.125],[.375,tiny,.375],f.context,32).crossings;}catch(e){assert.match(e.message,/closed occupancy|triangle .*precision/);return;}assert.deepEqual(h,[],'exact same-side plane rejection keeps this strict interior segment contact-free');}finally{f.dispose();}
});
test('closed isolated cancellation never invents a contact in a strict interior line',()=>{
  const f=registered(closedFixture([[-2,-2,-4],[2,-2,0],[0,2,2],[0,0,-2]],[[0,1,2],[0,3,1],[0,2,3],[1,3,2]])),tiny=2**-56;
  try{let h;try{h=core.combatGeometryTrace(f.scene.handle,[.125,tiny,.125],[.375,tiny,.375],f.context,32).crossings;}catch(e){assert.match(e.message,/closed occupancy|triangle .*precision/);return;}assert.deepEqual(h,[]);}finally{f.dispose();}
});
test('closed sheared subnormal slab reports collapsed oblique intervals',()=>{
  const tiny=1.401298464324817e-45,points=cubePoints.map(p=>[p[0],tiny*(p[0]+p[1]),p[2]]),f=registered(closedFixture(points,cubeTriangles));
  try{assert.throws(()=>core.combatGeometryTrace(f.scene.handle,[0,-1,.1],[0,1,.1],f.context,32),/interval/);}finally{f.dispose();}
});
test('closed diamond edge boundary skips exact incident plane cuts',()=>{
  const points=cubePoints.map(p=>[p[0]-p[1],p[0]+p[1],p[2]]),f=registered(closedFixture(points,cubeTriangles));
  try{const h=core.combatGeometryTrace(f.scene.handle,[2,0,-2],[2,0,2],f.context,32).crossings;assert.ok(h.length);assert.ok(h.every(h=>h.crossing==='touch'));}finally{f.dispose();}
});

const empty = [[-3, .15, -1.9], [3, .15, -1.9]];
const axial = [[.38, 1.44, 3.83], [.38, 1.44, 3.63]];
const side = [[.534, 1.44, 3.015], [.38, 1.44, 3.015]];
test('actual renderer Hetzer empty-space and selected hollow tube witnesses', () => {
  const f = hetzerWitness();
  try {
    const e = bruteForce(f.capture, ...empty), a = bruteForce([f.tube], ...axial), s = bruteForce([f.tube], ...side);
    assert.equal(e.length, 0); assert.equal(a.length, 0);
    assert.ok(s.length > 0); assert.ok(Math.abs(s[0].t - .672078008556) < 2e-7, JSON.stringify(s[0]));
    const receipt = { schema: 'ExactHitOracleWitnessV1', renderer: 'Renderer.mesh/_src + Node.update',
      tube: { bufferHash: sha(bytesOf(f.tube.data)), positionsHash: sha(bytesOf(f.tube.positions)), firstTriangle: f.tube.firstTriangle, triangles: f.tube.positions.length / 9 },
      queries: [{ key: 'hetzer-empty', segment: empty, expected: e }, { key: 'selected-tube-axial', segment: axial, expected: a }, { key: 'selected-tube-side', segment: side, expected: s }],
      legacy: f.enemy.intersect(...empty) };
    const recorded=JSON.parse(fs.readFileSync(new URL('../../../target/exact-hit-x1-oracle-witness.json', import.meta.url)));
    assert.deepEqual(receipt,recorded,'the independent pre-kernel witness remains unchanged');
    assert.equal(f.enemy.intersect(...empty).box,true,'historical broad-box defect is retained until X3');
    const tube=registered(fixtureManifest([f.tube],'fixture_selected_hetzer_tube'));
    try{
      assert.equal(core.combatGeometryTrace(tube.scene.handle,...axial,tube.context).crossings.length,0);
      const actual=core.combatGeometryTrace(tube.scene.handle,...side,tube.context).crossings;
      assert.equal(actual.length,s.length);actual.forEach((h,i)=>{assert.equal(h.triangleId,s[i].triangle);assert.ok(Math.abs(h.t-s[i].t)<2e-12);assert.equal(h.topologyPending,true);assert.equal(h.physicalRole,'audit_pending');assert.equal(h.responseRef,null);});
      const before=core.instance.exports.memory.buffer;
      const growth=registered(fixtureManifest(f.capture,'fixture_actual_hetzer'));
      try{assert.notEqual(core.instance.exports.memory.buffer,before,'real installation grows WASM memory; wrappers must reacquire views');assert.deepEqual(core.combatGeometryTrace(growth.scene.handle,...empty,growth.context).crossings,[]);}finally{growth.dispose();}
    }finally{tube.dispose();}
  } finally { f.dispose(); }
});

test('capture preserves byte offsets signed zero hidden nodes and in-place instance updates',()=>{
  const r=rendererSink(),root=new Node('root'),hidden=root.add(new Node('hidden'));hidden.visible=false;
  const storage=new Float32Array(13*3+7),data=storage.subarray(7);data.set([-0,0,0],0);data.set([1,0,0],13);data.set([0,1,0],26);
  hidden.mesh=r.instancedMesh(data,1);const instances=new Float32Array(32);instances.set(m4());instances.set(translation(5,0,0),16);r.setInstances(hidden.mesh,instances,2);root.update();
  assert.equal(root.collect([]).length,0);const c=captureNodes(root);assert.equal(c.length,1);assert.equal(c[0].count,1);assert.equal(new Uint32Array(c[0].positions.buffer)[0],0x80000000);
  const positionHash=sha(bytesOf(c[0].positions)),matrixHash=sha(bytesOf(c[0].matrices));data[0]=99;instances[12]=7;r.setInstances(hidden.mesh,instances,1);root.pos[0]=8;root.update();
  assert.equal(sha(bytesOf(c[0].positions)),positionHash);assert.equal(sha(bytesOf(c[0].matrices)),matrixHash);assert.equal(c[0].world[12],0);
  const payload=meshPayload(c[0].positions);assert.equal(payload.readUInt32LE(32),0x80000000);assert.equal(payload.length,32+36+12);assert.throws(()=>meshPayload(new Float32Array([NaN,0,0,0,0,0,0,0,0])),/invalid/);
  assert.throws(()=>verifyCrewCapture({byCrew:[hidden]},[{role:'driver'}],{version:2,figures:[{index:'AAAAAA=='}],roles:{default:0}}),/fell back/);
});

test('packed donor identity survives borrowing filtering reordering and explicit flatpack remap',async()=>{
  const catalog=loadData();assert.equal(catalog.order.length,43);assert.equal(Object.values(catalog.vehicles).filter(b=>b.model).length,16);
  const original=catalog.vehicles.xp_bmp_k64.model.blob;mintPackedSources(catalog);
  const ownKey=catalog.vehicles.xp_bmp_k64.model.parts[0].hitSource.key;
  await decodeAllImported(catalog.vehicles);assert.equal(catalog.vehicles.xp_bmp_k64.model.blob,original);
  const base=catalog.vehicles.xp_bmp_k64_atgm,borrowed=base.imported.parts.find(p=>p.hitSource.key===ownKey);assert.ok(borrowed,'borrowed identity must retain donor packed asset and ordinal');
  const donorOnly=catalog.vehicles.su_t10m_oplot23;assert.equal(donorOnly.model.parts.length,0);assert.ok(donorOnly.imported.parts.length>0);assert.ok(donorOnly.imported.parts.every(p=>p.hitSource.assetHash===catalog.vehicles.su_t10m.model.parts[0].hitSource.assetHash));
  const filtered=workshopImportedModel(base,false);assert.ok(filtered.parts.every(p=>base.imported.parts.includes(p)));const ids=filtered.parts.map(p=>p.hitSource.key);assert.equal(new Set(ids).size,ids.length);
  const flat=exportWorkshopModel(base,false,catalog),decoded=await decodeImported(flat);assert.deepEqual(decoded.parts.map(p=>p.hitSource.key),ids);
  const remap=flat.parts.map((p,exportedPartOrdinal)=>({exportedPartOrdinal,sourceKey:p.hitSource.key,originalPartOrdinal:p.hitSource.packedPartOrdinal,triangles:p.triangles}));
  decoded.parts.reverse();assert.deepEqual(decoded.parts.map(p=>p.hitSource.key),ids.slice().reverse());assert.ok(remap.every(p=>ids.includes(p.sourceKey)));
  const renderer=rendererSink(),part=filtered.parts[0],mesh=partMesh(renderer,'mutable-uid:999',part,[0,1,2]);assert.equal(mesh._src.hitSource.key,part.hitSource.key);assert.deepEqual(mesh._src.hitSource.origin,[0,1,2]);assert.notEqual(mesh._src.hitSource.mount,part.hitSource.mount);
  const root=new Node('root'),n=root.add(new Node('repeated-import-name'));n.mesh=mesh;root.update();const key=captureNodes(root)[0].key;root.children.unshift(new Node('unrelated-filter-slot'));root.update();assert.equal(captureNodes(root)[0].key,key,'imported mesh assembly identity must survive current array ordinal changes');
});

test('WASM diagnostics require opt-in independent hashes live leases and explicit overflow capacity',()=>{
  const f=hetzerWitness(),result=fixtureManifest([f.tube]);const registeredTube=registered(result);
  try{
    assert.throws(()=>core.call({op:'combat_geometry_trace',handle:registeredTube.scene.handle,a:side[0],b:side[1],context:registeredTube.context}),/opt-in/);
    assert.throws(()=>core.combatGeometryTrace(registeredTube.scene.handle,...side,registeredTube.context,1),/overflow/);
    assert.equal(core.combatGeometryTrace(registeredTube.scene.handle,...side,registeredTube.context,4).crossings.length,2);
    assert.throws(()=>core.combatGeometryTrace(registeredTube.scene.handle,side[0],side[1],{...registeredTube.context,buildHash:'0'.repeat(64)}),/context\/build/);
    assert.throws(()=>core.combatGeometryRegister(result.text,'0'.repeat(64),registeredTube.leases),/SHA-256/);
    assert.throws(()=>core.combatGeometryRegister(result.text,result.expectedHash,[]),/lease/);
  }finally{registeredTube.dispose();f.dispose();}
  assert.throws(()=>core.combatGeometryTrace(registeredTube.scene.handle,...side,registeredTube.context),/released/);
  assert.throws(()=>core.combatGeometryRelease(registeredTube.scene.handle),/released/);
  const payload=Array.from(result.payloads.values())[0];assert.throws(()=>core.combatGeometryInstall(payload,'0'.repeat(64)),/SHA-256/);
});

test('schema and audit-pending inventory retain every emitted position hash and separate variant bindings',()=>{
  const root=new URL('../../../',import.meta.url),index=JSON.parse(fs.readFileSync(new URL('data/hit-meshes/index.json',root))),schema=JSON.parse(fs.readFileSync(new URL('schemas/hit-mesh.schema.json',root)));
  assert.equal(index.garageCount,43);assert.equal(index.packedModelCount,16);assert.deepEqual(index.nonGarageFolders.map(f=>f.specId),['fun_hexa']);assert.equal(schema.properties.schema.const,'HitMeshManifestV1');
  const currentGenerator=hitExport.generatorSourceIdentity();assert.deepEqual(index.generator.inputs,currentGenerator.inputs);assert.equal(index.generator.sha256,currentGenerator.sha256);
  for(const e of [...index.entries,...index.workshop]){
    const text=fs.readFileSync(new URL(`data/hit-meshes/${e.manifestFile}`,root),'utf8'),m=JSON.parse(text);assert.equal(sha(Buffer.from(text)),e.manifestHash);
    schemaValid(m,schema);assert.equal(m.audits.certification,'audit_pending_diagnostic');assert.equal(m.audits.unclassifiedPhysicalTriangles,m.audits.triangleCoverage);assert.equal(m.audits.renderPositionDifferences,0);
    assert.ok(m.surfaces.every(s=>s.role==='audit_pending'&&s.topology==='audit_pending'&&s.responseRef===null));
    for(const mesh of m.meshes){const payload=fs.readFileSync(new URL(`data/hit-meshes/${mesh.payloadHash}.bin`,root));assert.equal(sha(payload),mesh.payloadHash);assert.equal(sha(payload.subarray(32,32+payload.readUInt32LE(20))),mesh.positionsHash);}
  }
  const f=hetzerWitness();try{const a=fixtureManifest([f.tube],'variant-a'),b=fixtureManifest([f.tube],'variant-b');assert.equal(a.manifest.meshes[0].payloadHash,b.manifest.meshes[0].payloadHash);assert.notEqual(a.manifest.buildHash,b.manifest.buildHash);assert.notEqual(a.manifest.surfaces,b.manifest.surfaces);a.manifest.surfaces[0].role='x';assert.equal(b.manifest.surfaces[0].role,'audit_pending');}finally{f.dispose();}
});

const provenanceRoot=new URL('../../../',import.meta.url);
const executedOutputSources=[
  'client/web/tools/export-hit-mesh.mjs','client/web/tools/hit-mesh-capture.mjs','client/web/src/gfx/tankmodel.js','client/web/src/gfx/geo.js','client/web/src/gfx/imported.js','client/web/src/gfx/interior.js','client/web/src/gfx/mgmodel.js','client/web/src/gfx/track.js','client/web/src/gfx/gearSupports.js','client/web/src/game/loadout.js','client/web/src/game/workshopImported.js','client/web/src/gfx/math.js',
  'client/web/src/game/combat.js','client/web/src/game/workshopBuild.js','client/web/tools/load-data.mjs','client/web/src/gfx/renderer.js','client/web/src/game/turretSeat.js','client/web/src/game/rangefinderEquipment.js','client/web/src/design/core.js'
];
const provenanceRead=p=>fs.readFileSync(new URL(p,provenanceRoot));
const outputIdentity=(read=provenanceRead)=>hitExport.generatorSourceIdentity(read);
test('executed generator provenance covers every output and inclusion source byte',()=>{
  const identity=outputIdentity();assert.deepEqual(identity.inputs.map(r=>r.path).sort(),executedOutputSources.slice().sort());
  assert.equal(identity.sha256,hashValue(identity.inputs));
  for(const p of executedOutputSources){const bytes=provenanceRead(p),record=identity.inputs.find(r=>r.path===p);assert.equal(record.status,'available');assert.equal(record.sha256,sha(bytes));assert.equal(record.bytes,bytes.length);
    const alternate=outputIdentity(q=>q===p?Buffer.concat([bytes,Buffer.from('\n// isolated provenance sensitivity\n')]):provenanceRead(q));assert.notEqual(alternate.sha256,identity.sha256,p);
  }
  assert.throws(()=>hitExport.generatorSourceIdentity(p=>{if(p==='client/web/src/gfx/renderer.js')throw new Error('missing executed source');return provenanceRead(p);}),/missing executed source/);
});
async function provenanceFixture(){
  const d=loadData();mintPackedSources(d);await decodeAllImported(d.vehicles);setCrewModel(JSON.parse(provenanceRead('client/web/assets/crew_model.json')));setMgModels(JSON.parse(provenanceRead('client/web/assets/mg_models.json')));
  const normalizer=loadCoreSync(provenanceRead('client/web/assets/tg_design.wasm'),{materials:d.materials,catalog:d.designCatalog,terrains:Object.values(d.terrains)}),recipe={base:'xp_bmp_k64_atgm',keepStock:false,turrets:[{guns:[{weapon:'xp_kda35'}]}]};
  const oldIndex=JSON.parse(provenanceRead('data/hit-meshes/index.json')),entry=oldIndex.workshop.find(e=>e.specId==='workshop_xp_bmp_k64_atgm_replace'),official=JSON.parse(provenanceRead(`data/hit-meshes/${entry.manifestFile}`));
  const generate=(normalize,sink=rendererSink,identity=outputIdentity())=>{
    const build=normalize(recipe,d),raw=d.vehicles[recipe.base],compiled=buildToBundle(build,d,'spec_dependency'),folder=exportFolder(build,d,raw,'spec_dependency','spec');
    const bundle=new Combat(normalizer,d.machineGuns).prepare('isolated_provenance',{...compiled.bundle,armor:folder.files['armor.json'],modules:folder.files['modules.json'],crew:folder.files['crew.json']});
    const renderer=sink(),loadout=makeLoadout('spec_dependency',bundle,d.projectiles,d.machineGuns),model=buildTank(renderer,loadout,generatedTurretParts),interior=buildInterior(renderer,model,loadout,bundle.modules,bundle.crew);model.root.update();
    try{const capture=captureNodes(model.root),anatomyHash=hashValue({armor:bundle.armor,modules:bundle.modules,crew:bundle.crew,weapons:bundle.weapons});
      const assemblies=capture.map(c=>({key:c.key,parent:null,baseTransformBits:matrixBits(m4()),pivot:[0,0,0],joint:{status:'static_fixture'},allowedMotionFields:[]}));
      const result=hitExport.manifestFromCapture('spec_dependency',capture,assemblies,{generatorHash:identity.sha256,buildHash:official.buildHash,anatomyHash});
      return{ring:build.turrets[0].ring,anatomyHash,renderHash:result.manifest.renderGeometryHash,assemblyKeys:capture.filter(c=>!c.hitSource).map(c=>c.key),generatedSourceKeys:result.manifest.meshes.flatMap(m=>m.ranges.map(r=>r.sourceKey)).filter(k=>k.startsWith('generated:'))};
    }finally{interior.dispose();model.dispose();}
  };return{generate,official,oldIndex};
}
function isolatedModuleBytes(p,source){return Buffer.from(source.replace(/from '(\.\.?\/[^']+)'/g,(_,relative)=>`from '${new URL(relative,new URL(p,provenanceRoot)).href}'`));}
test('executed generator provenance changes for a real isolated workshop normalization output',async()=>{
  const p='client/web/src/game/workshopBuild.js',original=provenanceRead(p);assert.equal((original.toString().match(/ring: number\(t\.ring, 1\.4,/g)||[]).length,1);
  const bytes=isolatedModuleBytes(p,original.toString().replace('ring: number(t.ring, 1.4,','ring: number(t.ring, 1.6,')),variant=await import(`data:text/javascript;base64,${bytes.toString('base64')}`),{generate}=await provenanceFixture();
  const beforeIdentity=outputIdentity(),afterIdentity=outputIdentity(q=>q===p?bytes:provenanceRead(q)),before=generate(normalizeWorkshopBuild,rendererSink,beforeIdentity),after=generate(variant.normalizeWorkshopBuild,rendererSink,afterIdentity);
  assert.equal(before.ring,1.4);assert.equal(after.ring,1.6);assert.notEqual(after.anatomyHash,before.anatomyHash);assert.notEqual(after.renderHash,before.renderHash);assert.notEqual(afterIdentity.sha256,beforeIdentity.sha256);assert.ok(provenanceRead(p).equals(original),'candidate source remains unchanged');
});
test('executed generator provenance changes real Renderer output and minted generated source identities',async()=>{
  const p='client/web/src/gfx/renderer.js',original=provenanceRead(p);assert.equal((original.toString().match(/mesh\(data\) \{/g)||[]).length,1);
  const bytes=isolatedModuleBytes(p,original.toString().replace('mesh(data) {','mesh(data) {\n data=data.slice();data[0]+=.125;')),variant=await import(`data:text/javascript;base64,${bytes.toString('base64')}`),{generate,official,oldIndex}=await provenanceFixture();
  const beforeIdentity=outputIdentity(),afterIdentity=outputIdentity(q=>q===p?bytes:provenanceRead(q)),before=generate(normalizeWorkshopBuild,rendererSink,beforeIdentity),after=generate(normalizeWorkshopBuild,()=>Object.setPrototypeOf(rendererSink(),variant.Renderer.prototype),afterIdentity);
  assert.equal(after.anatomyHash,before.anatomyHash);assert.notEqual(after.renderHash,before.renderHash);assert.deepEqual(after.assemblyKeys,before.assemblyKeys);
  const officialKeys=official.meshes.flatMap(m=>m.ranges.map(r=>r.sourceKey)).filter(k=>k.startsWith('generated:'));assert.equal(officialKeys.length,17);assert.deepEqual(before.assemblyKeys.map(k=>`generated:${oldIndex.generator.sha256}:build:${official.buildHash}:assembly:${k}`),officialKeys);
  assert.notEqual(afterIdentity.sha256,beforeIdentity.sha256);assert.notDeepEqual(after.generatedSourceKeys,before.generatedSourceKeys);assert.ok(provenanceRead(p).equals(original),'candidate source remains unchanged');
});
