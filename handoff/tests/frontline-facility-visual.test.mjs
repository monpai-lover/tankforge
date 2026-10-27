import fs from 'node:fs';import vm from 'node:vm';import test from 'node:test';import assert from 'node:assert/strict';import {webcrypto,createHash} from 'node:crypto';
const app=fs.readFileSync(new URL('../bundle/app.js.html',import.meta.url),'utf8'),helper=fs.readFileSync(new URL('../tools/frontline_facility_visual.js',import.meta.url),'utf8');
const hash=b=>createHash('sha256').update(b).digest('hex');
function geometry(){
 const triangles=[[[0,4,0],[0,4,4],[1,4,4]],[[0,4,0],[1,4,4],[1,4,0]],[[3,4,0],[3,4,4],[4,4,4]],[[3,4,0],[4,4,4],[4,4,0]]];
 const bytes=Buffer.alloc(triangles.length*36);triangles.flat(2).forEach((v,i)=>bytes.writeFloatLE(v,i*4));
 const g={facility_id:'korea:bridge:aperture',geometry_hash:hash(bytes),triangles,triangle_roles:triangles.map(()=>'bridge_top'),bounds:[[0,4,0],[4,4,4]],source:{kind:'authored_campaign'}};
 return {g,identity:{battle:1,mapId:'korea',layoutHash:hash(g.facility_id+'\0'+g.geometry_hash+'\0')}};
}
function fixture(){const c=vm.createContext({TextEncoder});vm.runInContext(app.slice(app.indexOf('  function m4()'),app.indexOf('  // client/web/src/game/relief.js'))+helper+';globalThis.make=createFrontlineFacilityPresentation;',c);let created=0,freed=0;const renderer={mesh:data=>{created++;return{data,count:data.length/13}},freeMesh(){freed++;}};const p=c.make({renderer,crypto:webcrypto});return {p,get created(){return created},get freed(){return freed}};}
const state=g=>({facility_id:g.facility_id,geometry_hash:g.geometry_hash,kind:'bridge',damage_state:'intact',capabilities:{geometry_active:true}}),roi={center:[2,2],radius:20};
test('registered visible positions are exactly uploaded Float32 triangles, retaining the central aperture',async()=>{
 const x=fixture(),{g,identity}=geometry();await x.p.install([g],identity);x.p.update([state(g)],roi);assert.equal(x.created,1);
 const values=x.p.root.children[0].mesh.data,positions=[];for(let i=0;i<values.length;i+=13)positions.push(...values.slice(i,i+3));assert.deepEqual(positions,g.triangles.flat(2));assert.ok(!positions.filter((_,i)=>i%3===0).some(v=>v>1&&v<3),'No fill across source aperture');
});
test('destroyed bridge retires every deck triangle, repair restores the same source, and disposal releases owned meshes',async()=>{
 const x=fixture(),{g,identity}=geometry();await x.p.install([g],identity);x.p.update([state(g)],roi);x.p.update([{...state(g),damage_state:'destroyed',capabilities:{geometry_active:false}}],roi);assert.equal(x.p.root.children.length,0);assert.equal(x.freed,1);
 x.p.update([state(g)],roi);assert.equal(x.created,2);x.p.dispose();assert.equal(x.freed,2);assert.equal(x.p.ready,false);
});
test('foreign geometry/hash, altered Float32 payload and duplicated state fail before modifying visible meshes',async()=>{
 const x=fixture(),{g,identity}=geometry();await x.p.install([g],identity);x.p.update([state(g)],roi);const node=x.p.root.children[0];
 assert.throws(()=>x.p.update([{...state(g),geometry_hash:'0'.repeat(64)}],roi));assert.throws(()=>x.p.update([state(g),state(g)],roi));assert.equal(x.p.root.children[0],node);
 const bad=structuredClone(g);bad.triangles[0][0][0]=.1;await assert.rejects(()=>x.p.install([bad],identity),/Float32/);
 await assert.rejects(()=>x.p.install([{...g,geometry_hash:'0'.repeat(64)}],identity),/hash/);await assert.rejects(()=>x.p.install([g],{...identity,layoutHash:'0'.repeat(64)}),/identity/);
});
test('a disposed asynchronous catalog cannot reattach geometry to a departed battle',async()=>{
 const x=fixture(),{g,identity}=geometry(),pending=x.p.install([g],identity);x.p.dispose();assert.equal(await pending,false);assert.equal(x.p.ready,false);assert.equal(x.created,0);
});
