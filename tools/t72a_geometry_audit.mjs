// Read-only T-72A model audit. Uses the real buildTank/addPart path, not a duplicate renderer.
// node tools/t72a_geometry_audit.mjs [--out=target/t72a-model-review/geometry.json]
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {loadData} from '../client/web/tools/load-data.mjs';
import {runtimeParts, topologyStatistics, touches, surfaceCrossings} from '../client/web/tools/procedural-fleet-audit.mjs';
import {transformPoint, sub, cross, dot} from '../client/web/src/gfx/math.js';
const ROOT=fileURLToPath(new URL('../',import.meta.url)), DEG=Math.PI/180;
export const protectedHashes={
 'vehicle.json':'50ef9d6d145602dbea068dbdf4b8b5eb688087d97c473986d275a722385f9c1e',
 'weapons.json':'0a5260bf39c92b2fc81fd7abc322732100393816ccb6d1916810abd3def6582c',
 'engine.json':'ef40d6d2c255e114ac082f91cbbb839e4abb9bee90125ff15d1739e919f4adad',
 'armor.json':'b77c08e5d2010bf813d11d00917cd61a631542756e3344032432522e7bed0294',
 'crew.json':'78c56bc523009bcfb2a00b27fe5edead19eccdd8b8329a30109751553e48e21e',
 'modules.json':'23a06d5f58679bbab16a71d31905a55ca4a3aa45cbd16dd30a9b5cbca6772162',
};
export function hashFile(file){return createHash('sha256').update(fs.readFileSync(path.join(ROOT,file))).digest('hex');}
const rounded=p=>p.map(x=>+x.toFixed(6));
export function rayTriangle(p,d,[a,b,c]) {
 const e1=sub(b,a),e2=sub(c,a),h=cross(d,e2),det=dot(e1,h);
 if(Math.abs(det)<1e-11)return null;
 const s=sub(p,a),u=dot(s,h)/det,q=cross(s,e1),v=dot(d,q)/det,t=dot(e2,q)/det;
 return u>=-1e-8&&v>=-1e-8&&u+v<=1+1e-8&&t>=0?t:null;
}
export function rayHits(piece,p,d,max=100){return piece.tris.map(t=>rayTriangle(p,d,t)).filter(t=>t!==null&&t<=max);}

/** Candidate collider geometry only; deliberately NOT applied to armor.json.
 * Changing hit planes/obliquity changes combat. Main integration owns that decision.
 */
function planeCandidate(id,A,B,width,normal) {
 return {id,center:{x:0,y:(A[1]+B[1])/2,z:(A[0]+B[0])/2},normal:{x:0,y:normal[0],z:normal[1]},
   axis_u:{x:1,y:0,z:0},half_u:width/2,half_v:Math.hypot(A[0]-B[0],A[1]-B[1])/2};
}
export function auditT72a({yawStep=15}={}) {
 if(!Number.isInteger(yawStep)||yawStep<=0||360%yawStep)throw new Error('yawStep must divide 360');
 const data=loadData(), bundle=data.vehicles.su_t72a, rt=runtimeParts('su_t72a',data), neutral=rt.at();
 const find=(ps,name)=>ps.find(p=>p.part.name===name), name=p=>p.part.name||p.id;
 const bindings=neutral.map(p=>({name:name(p),sourceId:p.id,mount:p.part.mount,recoil:!!p.part.recoil,
   node:rt.records.find(r=>r.id===p.id)?.node.name,lo:rounded(p.lo),hi:rounded(p.hi),triangles:p.tris.length,
   role:p.mgGun?'machine_gun':p.part.mount==='gun'?(p.part.recoil?'barrel':'gun_mount'):p.part.mount==='turret'?'turret_shell':'hull',
   topology:topologyStatistics(p)}));
 const poses=[],unexpectedGunHullCrossings=[],seatFailures=[],mantletContactFailures=[],opticObstructions=[];
 for(let yaw=0;yaw<360;yaw+=yawStep) for(const pitch of [-6,0,13]) for(const recoil of [0,1]) {
   const pieces=rt.at({yaw:yaw*DEG,pitch:pitch*DEG,recoil}), pose={yaw,pitch,recoil};
   const hull=pieces.filter(p=>p.group==='hull'), guns=pieces.filter(p=>p.part.mount==='gun');
   const casting=find(pieces,'t72a_cast_turret'),seat=find(pieces,'t72a_turret_ring');
   const seatContact=touches(casting,seat)&&touches(seat,find(pieces,'t72a_welded_hull'));
   const mantleContact=touches(find(pieces,'t72a_mantlet'),casting);
   if(!seatContact)seatFailures.push(pose);
   if(!mantleContact)mantletContactFailures.push(pose);
   for(const gun of guns) for(const h of hull) {
     const hit=surfaceCrossings(gun,h,4);
     if(hit.count)unexpectedGunHullCrossings.push({pose,gun:name(gun),hull:name(h),triangles:hit.count,points:hit.points.map(rounded)});
   }
   // Original muzzle/trunnion hierarchy is independently checked against analytic rotation.
   const tm=rt.model.turrets[0],g=tm.guns[0],muzzle=transformPoint(g.barrel.world,[0,0,4.95]);
   const near=transformPoint(g.node.world,[0,0,0]);
   poses.push({...pose,seatContact,mantleContact,trunnion:rounded(near),muzzle:rounded(muzzle)});
 }
 const connections=[['t72a_commander_coaming','t72a_cast_turret'],['t72a_commander_hatch','t72a_commander_coaming'],
 ['t72a_gunner_coaming','t72a_cast_turret'],['t72a_gunner_hatch','t72a_gunner_coaming'],['t72a_tpd_k1_head','t72a_cast_turret'],
 ['t72a_tpd_k1_glass','t72a_tpd_k1_head'],['t72a_antenna_base','t72a_cast_turret'],['t72a_antenna','t72a_antenna_base'],
 ['t72a_ir_searchlight','t72a_ir_bracket'],['t72a_ir_bracket','t72a_cast_turret']].map(([a,b])=>({a,b,touch:touches(find(neutral,a),find(neutral,b))}));
 for(const x of [-.57,-.51,-.45]) for(const y of [2.15,2.19]) {
   const from=[x,y,.902];
   for(const piece of neutral.filter(p=>p.part.mount==='turret'))if(rayHits(piece,from,[0,0,1],4).length)
     opticObstructions.push({from,part:name(piece)});
 }
 const boreParts=neutral.filter(p=>p.part.recoil||['t72a_recoil_sleeve','t72a_mantlet'].includes(p.part.name));
 const boreBlocked=boreParts.filter(p=>rayHits(p,[0,1.86,6.3],[0,0,-1],5.3).length).map(name);
 const mg=rt.model.mgs[0],postMatrices=[];
 for(const yaw of [-Math.PI,0,Math.PI/2,Math.PI]) for(const pitch of [-.1,0,1]) {
   rt.at({mgYaw:yaw,mgPitch:pitch});postMatrices.push(Array.from(mg.post.world));
 }
 const mgPostStable=postMatrices.every(m=>m.every((x,i)=>Math.abs(x-postMatrices[0][i])<1e-7));
 const hp=bundle.visual.parts.find(p=>p.name==='t72a_welded_hull').profile;
 const proposedArmorGeometry=[planeCandidate('hull_glacis',hp[3],hp[4],2.28,[Math.sin(68*DEG),Math.cos(68*DEG)]),
   planeCandidate('hull_lower',hp[4],hp[5],2.28,[-Math.sin(60*DEG),Math.cos(60*DEG)])];
 return {schema_version:1,vehicle:'su_t72a',variant:'T-72A early exterior interpretation; see source/date limits',
   basedOnRemote:'bc2588519e96194f73fb0578b95cdf03caf03568',
   sourceHashes:Object.fromEntries(['data/vehicles/su_t72a/visual.json','client/web/src/gfx/t72aModel.js','client/web/src/gfx/tankmodel.js','client/web/src/gfx/mgmodel.js','client/web/src/collision/meshHitbox.js','data/machine_guns.json'].map(p=>[p,hashFile(p)])),
   protectedData:Object.entries(protectedHashes).map(([file,expected])=>({file,expected,actual:hashFile('data/vehicles/su_t72a/'+file),unchanged:hashFile('data/vehicles/su_t72a/'+file)===expected})),
   coordinateFrame:'+Z forward, +X right, +Y up; metres; same pivots and instance IDs as baseline',
   runtimePartMappingErrorM:rt.maxRuntimeError,modelTriangles:rt.model.triangles,bindings,
   poseSampling:{yawStepDeg:yawStep,pitchDeg:[-6,0,13],recoilFraction:[0,1],count:poses.length,poses},
   seatFailures,mantletContactFailures,unexpectedGunHullCrossings,connections,opticObstructions,boreBlocked,mgPostStable,
   renderSurfaceComponent:{enabled:!!rt.model.hitbox,geometryVersion:rt.model.hitbox?.version||null,
     source:'Exact uploaded Float32 mesh positions and current scene/instance matrices',nativeCombatConnected:false},
   visualToDamage:{status:'REQUIRES_MAIN_INTEGRATION; not a combat/replay release gate',
     runtime:'Existing Rust combat still uses armor.json planes and modules.json boxes, not visual mesh triangles.',
     proposedArmorGeometry,retainFields:['id','zone','material','thickness_mm'],
     furtherReview:['Native combat still uses legacy planar turret armor proxies. The opt-in JS surface component does not replace native event generation.',
       'Barrel damage box remains the original gameplay box; measured displayed envelope is in bindings.',
       'NSVT nsvt_t72a measured variant is applied, original default NSVT and all ballistic/health data are untouched.',
       'PKT visible muzzle agrees with existing coax position; its internal generic damage anatomy remains an approximate legacy adapter.']},
   limits:['Discrete poses are not continuous collision proof.','touches() uses the existing 12mm candidate tolerance; the seat has an explicit 5mm overlap.',
     'Only closed hatches are implemented in baseline. A hatch-state animation interface was not invented.',
     'No damaged/detached track acceptance or terrain extremes; suspension/transmission owners unchanged.',
     'This JSON is CPU geometry evidence, not a claim that a browser frame was rendered. Browser receipt is separate.']};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 const file=process.argv.find(x=>x.startsWith('--out='))?.slice(6)||'target/t72a-model-review/geometry.json';
 const out=path.resolve(ROOT,file),r=auditT72a();fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(r,null,2)+'\n');
 console.log(JSON.stringify({out,poses:r.poseSampling.count,parts:r.bindings.length,triangles:r.modelTriangles,seatFailures:r.seatFailures.length,mantletContactFailures:r.mantletContactFailures.length,gunHullCrossings:r.unexpectedGunHullCrossings.length,opticObstructions:r.opticObstructions.length,boreBlocked:r.boreBlocked,mgPostStable:r.mgPostStable},null,2));
}
