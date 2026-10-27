// Source-preserving correction of one supplied MiG-17 rig. All original indexed
// triangles/material attributes remain; only whole connected components change
// mover membership; the flap and aileron hinges follow their existing panel edges.
export const MIG17_WING_REVISION = 2;
const SOURCE_GLB = '5efa5c406e77ce78208da31e3a9455af4108c68c947619ab004e462878b0176e';
const ORIGINAL_BYTES = 2404226, ORIGINAL_FNV = 0xa943fd26;
const ORIGINAL_RIG_FNV = 0xc898c871;
const INNER = [-2932 / 3000, -417 / 3000, -622 / 3000];
const OUTER = [-8477 / 3000, -698 / 3000, -4954 / 3000];
const ROLL_INNER = [-17638 / 6000, -1164 / 6000, -12184 / 6000];
const ROLL_OUTER = [-25776 / 6000, -1745 / 6000, -20027 / 6000];
const MOVING = new Set([0,1,11,12]);
const EXPECTED = new Map([
  ['flap_l_source_03__wing_l',1128], ['flap_l_source_04__wing_l',593],
  ['flap_l_source_12__wing_l',26], ['flap_l_source_15__wing_l',48],
  ['flap_r_source_03__wing_r',1128], ['flap_r_source_04__wing_r',594],
  ['flap_r_source_12__wing_r',26], ['flap_r_source_15__wing_r',48],
  ['roll_l_source_03__wing_l',174], ['roll_l_source_04__wing_l',144], ['roll_l_source_15__wing_l',30],
  ['roll_r_source_03__wing_r',200], ['roll_r_source_04__wing_r',460], ['roll_r_source_15__wing_r',30]
]);
const normalise = v => { const n=Math.hypot(...v);return v.map(x=>x/n); };
const fnv = bytes => {let h=2166136261;for(const b of bytes)h=Math.imul(h^b,16777619);return h>>>0;};
const rigHash = movers => {const text=JSON.stringify(movers);let h=2166136261;for(let i=0;i<text.length;i++)h=Math.imul(h^text.charCodeAt(i),16777619);return h>>>0;};

function components(part, buf) {
  const pos=new Int16Array(buf,part.pos,part.vertices*3),idx=new Uint16Array(buf,part.idx,part.triangles*3);
  const parent=Int32Array.from({length:part.triangles},(_,i)=>i),edges=new Map();
  const find=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
  const point=i=>`${pos[i*3]},${pos[i*3+1]},${pos[i*3+2]}`;
  for(let t=0;t<part.triangles;t++){
    const p=[point(idx[t*3]),point(idx[t*3+1]),point(idx[t*3+2])];
    for(const [a,b]of [[0,1],[1,2],[2,0]]){
      const key=p[a]<p[b]?`${p[a]}|${p[b]}`:`${p[b]}|${p[a]}`;
      if(edges.has(key))parent[find(t)]=find(edges.get(key));else edges.set(key,t);
    }
  }
  const groups=new Map();
  for(let t=0;t<part.triangles;t++){const root=find(t);if(!groups.has(root))groups.set(root,[]);groups.get(root).push(t);}
  return {pos,idx,groups:[...groups.values()]};
}

/** Call after inflating the original model, before constructing AIRCRAFT_MODELS or
 * its geometry/hitbox cache. Other models, altered source records and repeat calls
 * pass through unchanged. The 4 cm connected-component margin is source-specific.
 */
export function normalizeMig17Wing(id, m, buf) {
  const forwardMarginM=.04;
  const unchanged=reason=>({model:m,buf,applied:false,reason});
  if(id!=='mig17f'||m?.sourceBinding?.glbSha256!==SOURCE_GLB)return unchanged('different_source');
  if(m.sourceBinding.mig17WingCorrection)return unchanged(m.sourceBinding.mig17WingCorrection.revision===MIG17_WING_REVISION?'already_normalized':'different_source_correction');
  if(m.posScale!==1/3000||m.parts?.length!==65||m.movers?.length!==14||buf?.byteLength!==ORIGINAL_BYTES)return unchanged('source_shape_mismatch');
  if(m.movers[0].name!=='flap_l'||m.movers[1].name!=='flap_r'||m.movers[0].poses?.length!==49||m.movers[1].poses?.length!==49)return unchanged('source_rig_mismatch');
  if(rigHash(m.movers)!==ORIGINAL_RIG_FNV)return unchanged('source_rig_mismatch');
  const selected=m.parts.filter(p=>MOVING.has(p.mover));
  if(selected.length!==EXPECTED.size||selected.some(p=>EXPECTED.get(p.name)!==p.triangles))return unchanged('source_parts_mismatch');
  if(fnv(new Uint8Array(buf))!==ORIGINAL_FNV)return unchanged('source_buffer_mismatch');
  const pivots={0:INNER,1:[-INNER[0],INNER[1],INNER[2]],11:ROLL_INNER,12:[-ROLL_INNER[0],ROLL_INNER[1],ROLL_INNER[2]]};
  const axis=normalise(INNER.map((v,k)=>v-OUTER[k])),rollAxis=normalise(ROLL_INNER.map((v,k)=>v-ROLL_OUTER[k]));
  const axes={0:axis,1:[axis[0],-axis[1],-axis[2]],11:rollAxis,12:[rollAxis[0],-rollAxis[1],-rollAxis[2]]};
  // Positive normal means the fixed-wing/front side of the panel's own leading edge.
  const forwards=Object.fromEntries(Object.entries(axes).map(([i,a])=>[i,normalise([-a[2],0,a[0]])]));
  const pieces=[],evidence=[];let extraBytes=0;
  for(const p of m.parts){
    if(!MOVING.has(p.mover)){pieces.push(p);continue;}
    const {pos,idx,groups}=components(p,buf),fixed=[],moving=[],side=p.mover;
    const n=forwards[side],pivot=pivots[side];
    for(const group of groups){
      let forward=-Infinity;
      for(const t of group)for(let v=0;v<3;v++){
        const i=idx[t*3+v];
        forward=Math.max(forward,(pos[i*3]*m.posScale-pivot[0])*n[0]+(pos[i*3+2]*m.posScale-pivot[2])*n[2]);
      }
      (forward>forwardMarginM?fixed:moving).push(...group);
    }
    const take=(triangles,isFixed)=>{
      if(!triangles.length)return;
      // Keep original triangle order/winding. Appending new index lists leaves
      // every original position, normal, UV and original byte offset untouched.
      triangles.sort((a,b)=>a-b);
      const indices=new Uint16Array(triangles.length*3);
      triangles.forEach((t,i)=>indices.set(idx.subarray(t*3,t*3+3),i*3));
      const part={...p,triangles:triangles.length,source_part:p.name,mig17WingRole:isFixed?'fixed_wing':side<2?'lower_flap':'aileron'};
      if(isFixed){delete part.mover;part.name=`${p.name}__fixed_wing`;}
      pieces.push({part,indices});extraBytes+=indices.byteLength;
    };
    take(moving,false);take(fixed,true);
    evidence.push({name:p.name,movingTriangles:moving.length,fixedTriangles:fixed.length,components:groups.length});
  }
  const corrected=new ArrayBuffer(buf.byteLength+extraBytes),bytes=new Uint8Array(corrected);
  bytes.set(new Uint8Array(buf));let offset=buf.byteLength;
  const parts=pieces.map(p=>{
    if(!p.indices)return p;
    bytes.set(new Uint8Array(p.indices.buffer),offset);p.part.idx=offset;offset+=p.indices.byteLength;return p.part;
  });
  const movers=m.movers.map((old,i)=>{
    if(!MOVING.has(i))return old;
    const hinge=pivots[i].slice(),p=old.p.slice(),axis=axes[i].slice();
    const poses=old.poses.map(source=>{
      const oldAxis=normalise(old.axis),projection=source[1].slice(0,3).reduce((v,x,k)=>v+x*oldAxis[k],0);
      // Flap angular response is the reviewed 0..40 degrees. Ailerons retain the
      // original signed angular response (approximately +/-18 degrees), on the
      // corrected edge axis rather than their original misplaced hinge.
      const angle=i<2?-source[0]*40*Math.PI/180:2*Math.atan2(projection,source[1][3]),half=angle/2;
      const q=[...axis.map(x=>x*Math.sin(half)),Math.cos(half)];
      // Keep the original uploaded vertices' origin. Translate that origin around
      // the corrected physical hinge, instead of re-quantizing every local vertex.
      const v=p.map((x,k)=>x-hinge[k]),u=q.slice(0,3);
      const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
      const t=cross(u,v).map(x=>2*x),w=cross(u,t);
      const at=source[0]===0?p.slice():v.map((x,k)=>hinge[k]+x+q[3]*t[k]+w[k]);
      return [source[0],q,at];
    });
    return {...old,p,axis,poses,correctedHinge:hinge};
  });
  const correction={revision:MIG17_WING_REVISION,sourceGlbSha256:SOURCE_GLB,sourceBufferFnv:ORIGINAL_FNV.toString(16),
    forwardMarginM,hinge:'existing panel leading-edge endpoints; game approximation',hingePoints:Object.fromEntries(Object.entries(pivots).map(([i,p])=>[i,p.slice()])),
    originalFlapMovers:[m.movers[0],m.movers[1]],originalRollMovers:[m.movers[11],m.movers[12]],parts:evidence};
  const model={...m,parts,movers,sourceBinding:{...m.sourceBinding,mig17WingCorrection:correction}};
  return {model,buf:corrected,applied:true,evidence};
}
