/** Offline geometry handoff, NOT a server registration path.
 * Exports the renderer's exact uploaded positions and a neutral posed scene.
 * Usage: node tools/t72a-review/export_surface.mjs <new-directory>
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {loadData} from '../../client/web/tools/load-data.mjs';
import {runtimeParts} from '../../client/web/tools/procedural-fleet-audit.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const out=process.argv[2];
if(!out)throw new Error('Expected a new output directory');
if(fs.existsSync(out))throw new Error('Output already exists; refusing to overwrite review evidence');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const data=loadData(),rt=runtimeParts('su_t72a',data),hb=rt.model.hitbox;
if(!hb)throw new Error('su_t72a did not opt into the render-surface collider');
rt.at();const frame=hb.frame(),snapshot=hb.snapshot(frame);
const meshes=[...hb.capture.records].map(([mesh,rec])=>{
 let maxPositionError=0;
 for(let v=0;v<mesh.data.length/13;v++)for(let k=0;k<3;k++)
  maxPositionError=Math.max(maxPositionError,Math.abs(Math.fround(mesh.data[v*13+k])-rec.bvh.positions[v*3+k]));
 const pos=rec.bvh.positions;
 return {id:rec.id,triangles:rec.bvh.triangleCount,positionBytes:pos.byteLength,
  positionsSha256:sha(Buffer.from(pos.buffer,pos.byteOffset,pos.byteLength)),maxUploadedPositionErrorM:maxPositionError,
  instanced:rec.instanced,instanceCount:rec.count,
  ranges:rec.ranges.map(r=>({firstTriangle:r.first,triangleCount:r.count,partId:r.part.name,mount:r.part.mount,material:r.part.mat,recoil:!!r.part.recoil}))};
});
const sourceFiles=['data/vehicles/su_t72a/visual.json','tools/t72a_visual.mjs','client/web/src/gfx/tankmodel.js',
 'client/web/src/gfx/t72aModel.js','client/web/src/gfx/geo.js','client/web/src/gfx/math.js','client/web/src/gfx/track.js',
 'client/web/src/gfx/gearSupports.js','client/web/src/gfx/mgmodel.js','client/web/src/collision/meshHitbox.js'];
const files=Object.fromEntries(sourceFiles.map(p=>[p,sha(fs.readFileSync(path.join(root,p)))]));
const protectedData=Object.fromEntries(['vehicle','weapons','armor','engine','crew','modules'].map(id=>{
 const p=`data/vehicles/su_t72a/${id}.json`;return [p,sha(fs.readFileSync(path.join(root,p)))];}));
const snapshotText=JSON.stringify(snapshot);
const witnesses=[
 ['glacis',[0,1.1,4],[0,1.1,2.5],0],
 ['empty_muzzle',[0,1.86,6.4],[0,1.86,5.85],0],
 ['muzzle_rim',[.09,1.86,6.4],[.09,1.86,5.85],0],
 ['empty_wheel_gap',[3,.46,1.61],[1.18,.46,1.61],0],
 ['road_wheel',[3,.46,2.02],[1.18,.46,2.02],0],
 ['oversize_sphere_at_bore',[0,1.86,6.4],[0,1.86,5.85],.07],
].map(([name,p0,p1,radiusM])=>({name,p0,p1,radiusM,...hb.querySegment(p0,p1,{radiusM,frame})}));
const manifest={schema_version:1,vehicle:'su_t72a',status:'GEOMETRY_COMPONENT_ONLY_NATIVE_COMBAT_NOT_CONNECTED',
 geometryVersion:hb.version,geometryContentSha256:sha(JSON.stringify(meshes.map(m=>[m.id,m.positionsSha256,m.ranges]))),
 snapshotFile:'neutral-render-surface.json',snapshotSha256:sha(snapshotText),sourceHashes:files,protectedData,
 uniqueMeshes:meshes.length,uniqueTriangles:rt.model.triangles,posedInstances:frame.entries.length,
 posedTriangleInstances:frame.entries.reduce((n,e)=>n+e.rec.bvh.triangleCount,0),
 exactUploadEquality:meshes.every(m=>m.maxUploadedPositionErrorM===0),meshes,witnesses,
 limits:['No runtime damage or native Rust/WASM collider switch is performed by this exporter.',
 'World matrices are a neutral example only; the authoritative host must produce current historical poses.',
 'Internal modules retain legacy boxes. Accessory surface contact does not imply main-armour resistance.',
 'Positive radius sweeps a sphere against a frozen target, not a complete projectile mesh against continuously moving geometry.',
 'This is the authored polygon surface, not normal-map relief or measured full-scale material thickness.']};
fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'neutral-render-surface.json'),snapshotText);
fs.writeFileSync(path.join(out,'surface-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({out,uniqueMeshes:meshes.length,uniqueTriangles:rt.model.triangles,posedInstances:frame.entries.length,
 posedTriangleInstances:manifest.posedTriangleInstances,exactUploadEquality:manifest.exactUploadEquality}));
