// Render-surface narrow phase. No health, armour resistance, audio or physics policy.
// Mesh-local BVHs are built once; the exact uploaded vertex positions and current instance
// transforms supply all triangles. Bounds only reject candidates: they NEVER score a hit.
// Geometry background: pbr-book.org/4ed/Shapes/Triangle_Meshes and
// pbr-book.org/4ed/Primitives_and_Intersection_Acceleration/Bounding_Volume_Hierarchies.
import {mul, transformPoint, sub, add, scale, dot, cross, norm} from '../gfx/math.js';

const EPS = 1e-10;
const POSE_OWNER = Symbol('hitbox pose owner');
const finite3 = p => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);
const at = (p,d,t) => add(p,scale(d,t));
const bounds = () => ({lo:[Infinity,Infinity,Infinity], hi:[-Infinity,-Infinity,-Infinity]});
const extend = (b,p) => {for(let k=0;k<3;k++){b.lo[k]=Math.min(b.lo[k],p[k]);b.hi[k]=Math.max(b.hi[k],p[k]);}return b;};

/** Full affine inverse, not a transpose-only rigid assumption. Fail closed on singular poses. */
export function inverseAffine(m) {
  if (!m || m.length !== 16 || !Array.from(m).every(Number.isFinite)) throw new TypeError('Invalid hitbox matrix');
  if(Math.abs(m[3])+Math.abs(m[7])+Math.abs(m[11])+Math.abs(m[15]-1)>1e-7) throw new RangeError('Hitbox matrix must be affine');
  const a=m[0],b=m[4],c=m[8],d=m[1],e=m[5],f=m[9],g=m[2],h=m[6],i=m[10];
  const det=a*(e*i-f*h)-b*(d*i-f*g)+c*(d*h-e*g);
  if(Math.abs(det)<1e-15) throw new RangeError('Singular hitbox transform');
  const r=new Float64Array(16);
  r[0]=(e*i-f*h)/det;r[4]=(c*h-b*i)/det;r[8]=(b*f-c*e)/det;
  r[1]=(f*g-d*i)/det;r[5]=(a*i-c*g)/det;r[9]=(c*d-a*f)/det;
  r[2]=(d*h-e*g)/det;r[6]=(b*g-a*h)/det;r[10]=(a*e-b*d)/det;r[15]=1;
  for(let k=0;k<3;k++)r[12+k]=-(r[k]*m[12]+r[k+4]*m[13]+r[k+8]*m[14]);
  return r;
}
function worldBounds(b,m) {
  const out=bounds();for(let bits=0;bits<8;bits++)extend(out,transformPoint(m,[0,1,2].map(k=>bits&(1<<k)?b.hi[k]:b.lo[k])));return out;
}
function boxEntry(p,d,b,r=0,maxT=1) {
  let enter=0,exit=maxT;
  for(let k=0;k<3;k++){
    const lo=b.lo[k]-r,hi=b.hi[k]+r;
    if(d[k]===0){if(p[k]<lo||p[k]>hi)return null;continue;}
    let a=(lo-p[k])/d[k],z=(hi-p[k])/d[k];if(a>z)[a,z]=[z,a];
    enter=Math.max(enter,a);exit=Math.min(exit,z);if(enter>exit)return null;
  }return enter;
}
/** Project into the dominant ray plane. Shared edges use the same edge expressions on
 * both triangles; zero barycentrics are included, without widening the triangle borders. */
export function segmentTriangle(origin, direction, a,b,c,maxT=1) {
  let z=0;for(let k=1;k<3;k++)if(Math.abs(direction[k])>Math.abs(direction[z]))z=k;
  if(direction[z]===0)return null;
  let x=(z+1)%3,y=(x+1)%3;if(direction[z]<0)[x,y]=[y,x];
  const sx=direction[x]/direction[z],sy=direction[y]/direction[z],sz=1/direction[z];
  const p=[a,b,c].map(v=>{const q=sub(v,origin);return [q[x]-sx*q[z],q[y]-sy*q[z],q[z]*sz];});
  const e=[p[1][0]*p[2][1]-p[1][1]*p[2][0],p[2][0]*p[0][1]-p[2][1]*p[0][0],p[0][0]*p[1][1]-p[0][1]*p[1][0]];
  if(e.some(v=>v<0)&&e.some(v=>v>0))return null;
  const det=e[0]+e[1]+e[2];if(det===0)return null;
  const t=(e[0]*p[0][2]+e[1]*p[1][2]+e[2]*p[2][2])/det;
  if(t<0||t>maxT)return null;
  return {t,barycentric:e.map(v=>v/det)};
}
function barycentric(p,a,b,c) {
  const e=sub(b,a),f=sub(c,a),q=sub(p,a),ee=dot(e,e),ef=dot(e,f),ff=dot(f,f),den=ee*ff-ef*ef;
  if(den<=1e-28)return null;const v=(dot(q,e)*ff-dot(q,f)*ef)/den,w=(dot(q,f)*ee-dot(q,e)*ef)/den;
  return [1-v-w,v,w];
}
function closestOnTriangle(p,a,b,c) {
  const n=cross(sub(b,a),sub(c,a)),nn=dot(n,n),candidates=[];
  if(nn>1e-28){const q=sub(p,scale(n,dot(sub(p,a),n)/nn)),bary=barycentric(q,a,b,c);if(bary&&bary.every(v=>v>=0))candidates.push(q);}
  for(const [v,w]of [[a,b],[b,c],[c,a]]){const e=sub(w,v),ee=dot(e,e),t=ee?Math.max(0,Math.min(1,dot(sub(p,v),e)/ee)):0;candidates.push(at(v,e,t));}
  return candidates.reduce((best,q)=>dot(sub(q,p),sub(q,p))<dot(sub(best,p),sub(best,p))?q:best);
}
function roots(A,B,C) {
  if(Math.abs(A)<1e-24)return Math.abs(B)<1e-24?[]:[-C/B];
  const disc=B*B-4*A*C;if(disc<0)return [];
  const s=Math.sqrt(Math.max(0,disc)),q=-.5*(B+(B<0?-s:s));
  return q===0?[-B/(2*A)]:[q/A,C/q].sort((a,b)=>a-b);
}
/** Continuous swept sphere vs a fixed triangle: face slabs, finite edge cylinders and
 * vertex spheres. This is a sphere approximation of projectile volume, NOT an ogive. */
export function sweepSphereTriangle(p,d,r,a,b,c,maxT=1) {
  const n0=cross(sub(b,a),sub(c,a)),nlen=Math.hypot(...n0);if(nlen<1e-14)return null;
  const n=scale(n0,1/nlen),near=closestOnTriangle(p,a,b,c),sep=sub(p,near);
  if(dot(sep,sep)<=r*r)return {t:0,point:near,barycentric:barycentric(near,a,b,c),initialOverlap:true};
  let best=null;
  const accept=(t,q)=>{if(t>=0&&t<=maxT&&(!best||t<best.t))best={t,point:q,barycentric:barycentric(q,a,b,c),initialOverlap:false};};
  const vn=dot(d,n),pn=dot(sub(p,a),n);
  if(Math.abs(vn)>1e-16)for(const sign of [-1,1]){
    const t=(sign*r-pn)/vn;if(t<0||t>maxT)continue;
    const q=sub(at(p,d,t),scale(n,sign*r)),bc=barycentric(q,a,b,c);
    if(bc&&bc.every(v=>v>=-EPS&&v<=1+EPS))accept(t,q);
  }
  for(const [v,w]of [[a,b],[b,c],[c,a]]){
    const e=sub(w,v),ee=dot(e,e),q=sub(p,v);if(ee<1e-28)continue;
    const dd=sub(d,scale(e,dot(d,e)/ee)),qq=sub(q,scale(e,dot(q,e)/ee));
    for(const t of roots(dot(dd,dd),2*dot(qq,dd),dot(qq,qq)-r*r)){
      const u=dot(sub(at(p,d,t),v),e)/ee;if(u>=0&&u<=1)accept(t,at(v,e,u));
    }
  }
  for(const v of [a,b,c]){const q=sub(p,v);for(const t of roots(dot(d,d),2*dot(q,d),dot(q,q)-r*r))accept(t,v);}
  return best;
}

/** Existing armour IDs are labels, not new thickness values. Curved-turret sector
 * assignment remains the declared game approximation, not a measured armour map. */
function armorLabel(part,normal,localTriangle) {
  const id=part?.name||'',n=normal;let armorRef=null,armorSurface=null;
  if(id==='t72a_welded_hull'){
    if(n[2]>.2)armorRef=n[1]<0?'hull_lower':'hull_glacis';
    else if(n[2]<-.5)armorRef='hull_rear';
    else if(Math.abs(n[0])>.5)armorRef=n[0]<0?'hull_side_l':'hull_side_r';
    else armorRef=n[1]<0?'hull_floor':'hull_roof';
    armorSurface='outer';
  } else if(id==='t72a_cast_turret'){
    const g=part.faceGroups?.[localTriangle];armorSurface=g===2?'inner':g===1?'outer':'reveal_or_roof';
    const outward=g===2?scale(n,-1):n;
    armorRef=outward[1]>.7?'turret_roof':outward[2]>.50?'turret_front':outward[2]<-.55?'turret_rear':outward[0]<0?'turret_side_l':'turret_side_r';
  } else if(/commander_hatch$|gunner_hatch$|coaming/.test(id)){armorRef='turret_roof';armorSurface='outer';}
  else if(id==='t72a_driver_hatch'){armorRef='hull_roof';armorSurface='outer';}
  return {armorRef,armorSurface};
}

export class TriangleBVH {
  constructor(positions) {
    if(!positions||positions.length%9||!Array.from(positions).every(Number.isFinite))throw new TypeError('Triangles require finite 9-float positions');
    this.positions=Float32Array.from(positions);this.triangleCount=positions.length/9;
    const triangleBounds=[];
    for(let i=0;i<this.triangleCount;i++){const b=bounds();for(const p of this.triangle(i))extend(b,p);triangleBounds.push(b);}
    const build=indices=>{
      const b=bounds();for(const i of indices){extend(b,triangleBounds[i].lo);extend(b,triangleBounds[i].hi);}
      if(indices.length<=8)return {...b,indices};
      const spans=b.hi.map((v,k)=>v-b.lo[k]),axis=spans.indexOf(Math.max(...spans));
      indices.sort((i,j)=>(triangleBounds[i].lo[axis]+triangleBounds[i].hi[axis])-(triangleBounds[j].lo[axis]+triangleBounds[j].hi[axis])||i-j);
      const mid=indices.length>>1;return {...b,children:[build(indices.slice(0,mid)),build(indices.slice(mid))]};
    };
    this.tree=this.triangleCount?build(Array.from({length:this.triangleCount},(_,i)=>i)):null;
  }
  triangle(i) {return [0,1,2].map(v=>Array.from(this.positions.subarray(i*9+v*3,i*9+v*3+3)));}
  candidates(p,d,r,maxT,visit,stats) {
    if(!this.tree)return;
    const walk=b=>{stats.bvhNodes++;if(boxEntry(p,d,b,r,maxT)===null)return;
      if(b.indices)for(const i of b.indices)visit(i);else for(const c of b.children)walk(c);};walk(this.tree);
  }
}

/** Capture methods keep the real renderer as `this`; no shared renderer policies change. */
export function captureHitboxGeometry(renderer) {
  const records=new Map();let next=0;
  const capture=(mesh,data,instanced=false)=>{
    const f32=Float32Array.from(data);if(f32.length%39)throw new RangeError('Expected 13-float triangle vertex buffer');
    const positions=new Float32Array(f32.length/13*3);
    for(let i=0,j=0;i<f32.length;i+=13){positions[j++]=f32[i];positions[j++]=f32[i+1];positions[j++]=f32[i+2];}
    records.set(mesh,{id:`mesh:${next++}`,bvh:new TriangleBVH(positions),ranges:[],instanced,matrices:new Float32Array(),count:instanced?0:1});return mesh;
  };
  const proxy=new Proxy(renderer,{get(target,key){
    if(key==='mesh')return data=>capture(target.mesh(data),data);
    if(key==='instancedMesh')return (data,count)=>capture(target.instancedMesh(data,count),data,true);
    if(key==='setInstances')return (mesh,matrices,count)=>{
      target.setInstances(mesh,matrices,count);const rec=records.get(mesh);if(!rec)return;
      rec.count=Math.min(count,mesh.maxInstances??count);if(rec.matrices.length!==rec.count*16)rec.matrices=new Float32Array(rec.count*16);
      rec.matrices.set(matrices.subarray(0,rec.count*16));
    };
    if(key==='freeMesh')return mesh=>{records.delete(mesh);return target.freeMesh(mesh);};
    const v=Reflect.get(target,key,target);return typeof v==='function'?v.bind(target):v;
  }});
  return {renderer:proxy,records,tag(mesh,ranges){const r=records.get(mesh);if(r)r.ranges=ranges?.map(x=>({...x}))||[];},dispose(){records.clear();}};
}

function defaultBinding(nodePath,instanceId,matrix,part) {
  const id=part?.name||nodePath,mat=part?.mat||null;
  let role='accessory',moduleRef=null;
  if(/welded_hull|cast_turret|turret_ring|coaming|commander_hatch$|gunner_hatch$|driver_hatch$/.test(id))role='armor_surface';
  else if(/rubber_skirt/.test(id))role='rubber_skirt';
  else if(/canvas|mantlet$/.test(id))role='canvas_cover';
  else if(/thermal|evacuator/.test(id))role='gun_sleeve';
  else if(/t72a_barrel$|muzzle_collar/.test(id)){role='gun_barrel';moduleRef='gun_barrel';}
  else if(/pkt_/.test(id)){role='machine_gun';moduleRef='coax_pkt';}
  else if(/mg_gun|mg_post/.test(nodePath)){role='machine_gun';moduleRef='aa_nsvt';}
  else if(/tracks|road_wheel|sprocket|idler|return_roller|support/.test(nodePath)){role=/tracks/.test(nodePath)?'track_link':'running_gear';moduleRef=matrix[12]<0?'track_l':'track_r';}
  else if(/glass|lens/.test(id))role='optics';
  return {partId:id,role,material:mat,moduleRef,instanceId};
}

/** Model-level exact surface query; presentation hiding (X-ray / scope) does not disable
 * physical geometry. Use setPartEnabled / node.hitboxDisabled for actual removal/detachment.
 * One frame is a frozen target pose. No claim of continuous moving-target TOI.
 * Bindings override semantic labels; derived armour labels fill missing/undefined fields,
 * preserving explicit null. Filters see those resolved labels. Contact geometry and IDs
 * always come from the queried triangle/instance, regardless of binding properties. */
export class ModelHitbox {
  constructor(root,capture,{version='t72a-render-surface-v1',binding=defaultBinding}={}) {
    this.root=root;this.capture=capture;this.version=version;this.binding=binding;this.disabled=new Set();this.disposed=false;
  }
  setPartEnabled(id,enabled){if(enabled)this.disabled.delete(id);else this.disabled.add(id);}
  frame(){
    if(this.disposed)throw new Error('Disposed hitbox');this.root.update();const entries=[];
    const walk=(node,path,disabled,inheritedBinding=null)=>{
      const nodeBinding=node.hitboxBinding||inheritedBinding;
      disabled=disabled||node.hitboxDisabled===true;
      const rec=this.capture.records.get(node.mesh);
      if(rec?.bvh.tree&&!disabled&&!this.disabled.has(path)){
        const n=rec.instanced?rec.count:1;
        for(let instanceId=0;instanceId<n;instanceId++){
          const matrix=rec.instanced?mul(node.world,rec.matrices.subarray(instanceId*16,instanceId*16+16)):Float32Array.from(node.world);
          const id=rec.instanced?`${path}#${instanceId}`:path;if(this.disabled.has(id))continue;
          entries.push({id,path,nodeBinding,instanceId:rec.instanced?instanceId:null,rec,matrix,inverse:inverseAffine(matrix),bounds:worldBounds(rec.bvh.tree,matrix)});
        }
      }
      node.children.forEach((c,i)=>walk(c,`${path}/${i}:${c.name}`,disabled,nodeBinding));
    };walk(this.root,this.root.name,false);
    // Do not retain scene-node references: returned transforms are independent pose copies (caller must treat them as read-only).
    return {version:this.version,entries,disabled:new Set(this.disabled),[POSE_OWNER]:this};
  }
  /** Closed segment [p0,p1]. radiusM=0 is an exact centre-line test; a positive radius
   * sweeps a sphere through the same triangles, not an expanded axis-aligned box hit. */
  querySegment(p0,p1,{radiusM=0,all=false,filter=null,frame=null,bruteForce=false}={}) {
    if(!finite3(p0)||!finite3(p1)||!Number.isFinite(radiusM)||radiusM<0)throw new TypeError('Finite segment and non-negative radius required');
    if(this.disposed)throw new Error('Disposed hitbox');
    const pose=frame||this.frame();if(pose.version!==this.version||pose[POSE_OWNER]!==this)throw new Error('Hitbox pose owner or version mismatch');
    const d=sub(p1,p0),distance=Math.hypot(...d),hits=[],stats={entries:pose.entries.length,candidateEntries:0,bvhNodes:0,trianglesTested:0};
    if(distance===0&&radiusM===0)return {hit:null,hits:[],stats,version:this.version};
    let nearest=1;
    const candidates=[];
    for(const entry of pose.entries){const t=boxEntry(p0,d,entry.bounds,radiusM,1);if(t!==null)candidates.push([t,entry]);}
    candidates.sort((a,b)=>a[0]-b[0]||a[1].id.localeCompare(b[1].id));
    for(const [enter,entry]of candidates){
      if(!all&&enter>nearest)continue;stats.candidateEntries++;
      const {rec,matrix,inverse,path,instanceId}=entry,localP=transformPoint(inverse,p0),localQ=transformPoint(inverse,p1),localD=sub(localQ,localP);
      const localRadius=radiusM*Math.hypot(inverse[0],inverse[1],inverse[2],inverse[4],inverse[5],inverse[6],inverse[8],inverse[9],inverse[10]);
      const visit=triangleId=>{
        const range=rec.ranges.find(r=>triangleId>=r.first&&triangleId<r.first+r.count);
        const tri=rec.bvh.triangle(triangleId),localNormal=norm(cross(sub(tri[1],tri[0]),sub(tri[2],tri[0])));
        const derived=armorLabel(range?.part,localNormal,range?triangleId-range.first:triangleId);
        const binding={...this.binding(path,instanceId,matrix,range?.part),...(entry.nodeBinding||{}),instanceId};
        if(binding.armorRef===undefined)binding.armorRef=derived.armorRef;
        if(binding.armorSurface===undefined)binding.armorSurface=derived.armorSurface;
        if(rec.instanced && /tracks/.test(path))binding.moduleRef=instanceId<rec.count/2?'track_r':'track_l';
        if(pose.disabled.has(binding.partId)||(filter&&!filter(binding)))return;
        stats.trianglesTested++;const maxT=all?1:nearest;
        let h;
        if(radiusM===0){h=segmentTriangle(localP,localD,...tri,maxT);if(h)h.point=at(p0,d,h.t);}
        else h=sweepSphereTriangle(p0,d,radiusM,...tri.map(v=>transformPoint(matrix,v)),maxT);
        if(!h)return;
        const worldTri=tri.map(v=>transformPoint(matrix,v)),faceNormal=norm(cross(sub(worldTri[1],worldTri[0]),sub(worldTri[2],worldTri[0]))),center=at(p0,d,h.t);
        const away=sub(center,h.point),contactNormal=radiusM>0&&Math.hypot(...away)>1e-12?norm(away):scale(faceNormal,dot(faceNormal,d)>0?-1:1);
        const hit={...binding,t:h.t,distance:distance*h.t,point:h.point,center,faceNormal,normal:contactNormal,barycentric:h.barycentric,
          nodePath:path,entryId:entry.id,meshId:rec.id,triangleId,partTriangleId:range?triangleId-range.first:triangleId,
          initialOverlap:!!h.initialOverlap,geometryVersion:this.version};
        hits.push(hit);nearest=Math.min(nearest,h.t);
      };
      if(bruteForce)for(let i=0;i<rec.bvh.triangleCount;i++)visit(i);
      else rec.bvh.candidates(localP,localD,localRadius,all?1:nearest,visit,stats);
    }
    hits.sort((a,b)=>a.t-b.t||a.entryId.localeCompare(b.entryId)||a.triangleId-b.triangleId);
    // De-duplicate a shared edge on ONE part/instance, not different armour layers.
    const unique=[];
    for(const h of hits){const same=unique.findLast(x=>Math.abs(x.t-h.t)*Math.max(distance,1)<=1e-7&&x.partId===h.partId&&x.entryId===h.entryId);
      if(!same)unique.push(h);}
    return {hit:unique[0]||null,hits:all?unique:unique.slice(0,1),stats,version:this.version};
  }
  snapshot(frame=this.frame()){
    if(this.disposed||frame[POSE_OWNER]!==this||frame.version!==this.version)throw new Error('Invalid hitbox snapshot owner or version');
    const unique=new Map();for(const {rec}of frame.entries)unique.set(rec.id,rec);
    return {schema_version:1,geometryVersion:this.version,frame:'world',units:'metres',
      meshes:[...unique.values()].map(r=>({id:r.id,positions:Array.from(r.bvh.positions),ranges:r.ranges})),
      entries:frame.entries.map(e=>({id:e.id,path:e.path,instanceId:e.instanceId,nodeBinding:e.nodeBinding,meshId:e.rec.id,matrix:Array.from(e.matrix)})),
      disabled:[...frame.disabled],scope:'Copied local render pose; not a trusted client damage packet'};
  }
  dispose(){this.disposed=true;this.capture.dispose();}
}
