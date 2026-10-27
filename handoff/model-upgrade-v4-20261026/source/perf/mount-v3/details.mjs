// Presentation geometry and actual geometric attachment points.
// Existing weapon performance, ammunition and damage parts remain authoritative.
import {sampBomb} from './samp-bomb.mjs';
import {FITTED_MOUNTS} from './fitted-mounts.mjs';
export {normalizeModel} from './source-cleanup.mjs';
export {catalogDefinitions,compatibility,slots,stations,prototypeWing,prototypeFuselage,equipment,radars,pods,quantity,quantityEnabled,startCount,countPick,catalogClash,catalogEntries} from './catalog.mjs';
export const VERSION='mounted-details-v4';
const SU27_MAIN='562a29d0ae0fbc4f251dc5120b5a30103959eff9b72b5a3116db62d25b77b0f8';
const registry=new WeakMap();
export const VISUAL_ALIASES={r73:'r73e',r27r:'r27r1',r27t:'r27t1'};
export function register(defs,models){
 for(const[id,modelId]of Object.entries(VISUAL_ALIASES)){
  const d=defs[id],m=models?.[modelId];
  if(d&&m&&Math.abs(d.len-m.length_m)<1e-7&&Math.abs(d.d-m.diameter_m)<1e-7)registry.set(d,modelId);
 }
}
export const modelId=d=>d?.model||registry.get(d)||null;
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const norm=a=>{const n=Math.hypot(...a)||1;return a.map(v=>v/n)};
const rgb=s=>{const n=parseInt(s.replace('#',''),16);return [16,8,0].map(k=>Math.pow(((n>>k)&255)/255,2.2))};
class Mesh{
 constructor(){this.v=[];this.features=[];}
 tri(a,b,c,color){const n=norm(cross(sub(b,a),sub(c,a)));if(Math.hypot(...n)<.5)return;for(const p of[a,b,c])this.v.push(...p,...n,...color,.62,.28,0,0);}
 quad(a,b,c,d,color){this.tri(a,b,c,color);this.tri(a,c,d,color);}
 box(c,s,color){const p=[[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]].map(q=>q.map((v,i)=>c[i]+v*s[i]/2));for(const f of[[0,3,2,1],[4,5,6,7],[0,4,7,3],[1,2,6,5],[0,1,5,4],[3,7,6,2]])this.quad(...f.map(i=>p[i]),color);}
 beam(a,b,width,depth,color){
  const axis=norm(sub(b,a)),length=Math.hypot(...sub(b,a));if(length<1e-6)return;
  let u=norm(cross(axis,[0,0,1]));if(Math.hypot(...u)<.5)u=[1,0,0];const v=norm(cross(axis,u)),c=a.map((x,k)=>(x+b[k])/2);
  const p=[[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]].map(q=>c.map((x,k)=>x+u[k]*q[0]*width/2+v[k]*q[1]*depth/2+axis[k]*q[2]*length/2));
  for(const f of[[0,3,2,1],[4,5,6,7],[0,4,7,3],[1,2,6,5],[0,1,5,4],[3,7,6,2]])this.quad(...f.map(i=>p[i]),color);
 }
 loft(sections,color,n=24){
  const p=(s,i)=>{const t=i/n*Math.PI*2;return[(s[3]||0)+s[1]*Math.cos(t),(s[4]||0)+s[2]*Math.sin(t),s[0]]};
  for(let j=1;j<sections.length;j++)for(let i=0;i<n;i++)this.quad(p(sections[j-1],i),p(sections[j-1],i+1),p(sections[j],i+1),p(sections[j],i),color);
  for(let i=0;i<n;i++){const a=sections[0],b=sections.at(-1);this.tri([a[3]||0,a[4]||0,a[0]],p(a,i+1),p(a,i),color);this.tri([b[3]||0,b[4]||0,b[0]],p(b,i),p(b,i+1),color);}
 }
 tube(c,z0,z1,r,wall,color,n=12){
  this.loft([[z0,r,r,c[0],c[1]],[z1,r,r,c[0],c[1]]],color,n);
  if(wall){const inner=Math.max(.002,r-wall),dark=rgb('#111820');
   for(let i=0;i<n;i++){const p=(rad,t,z)=>[c[0]+rad*Math.cos(t),c[1]+rad*Math.sin(t),z],a=i/n*2*Math.PI,b=(i+1)/n*2*Math.PI;
    this.quad(p(r,a,z1),p(r,b,z1),p(inner,b,z1),p(inner,a,z1),color);this.quad(p(inner,a,z1),p(inner,b,z1),p(inner,b,z0+.02),p(inner,a,z0+.02),dark);
   }
   // The first loft supplies a dark inset bore cap; leave the muzzle annulus visible.
   this.loft([[z1+.0005,inner,inner,c[0],c[1]],[z1+.001,inner,inner,c[0],c[1]]],dark,n);
  }
 }
 get data(){return new Float32Array(this.v)}
}
function append(a,b){const x=new Float32Array(a.length+b.length);x.set(a);x.set(b,a.length);return x;}
export function matchesSu27(m){return m?.sourceHashes?.main===SU27_MAIN&&m.version===2&&Math.abs(m.posScale-1/2345)<1e-12&&m.parts?.[28]?.vertices===182&&m.parts?.[29]?.vertices===184;}
export function tipLayout(side){return{side,x:side<0?-7.13:7.138,y:-.18,z:-2.55,wingEdge:side<0?-6.887420042643923:6.895522388059701,railZ:[-3.42,-1.88]};}
export function outerLayout(side){const top=side<0?-.4157782515991471:-.41194029850746267;return{x:side<0?-5.746055437100213:5.757356076759061,y:top-.19,z:-1.649040511727079,top};}
function su27Airframe(id,model,geometry){
 if(id!=='su27'||!matchesSu27(model)||geometry.mountDetailsVersion===VERSION)return geometry;
 const wings={...geometry.wings},hardware=[];
 for(const side of[-1,1]){
  const t=tipLayout(side),key=side<0?'l':'r',m=new Mesh(),paint=rgb('#c0c9cf'),metal=rgb('#67747b');
  // Permanent launch rail and a lateral shoe tied into the source wingtip edge.
  m.box([t.x,-.139,-2.65],[.105,.082,1.54],metal);
  m.box([t.x,-.096,-2.65],[.16,.028,1.62],paint);
  m.box([(t.x+t.wingEdge)/2,-.075,-2.67],[Math.abs(t.x-t.wingEdge)+.055,.09,1.20],paint);
  // The forward fairing reaches the source wingtip navigation light, not the missile canards.
  m.loft([[-1.96,.145,.068,side*7.15,-.041],[-1.32,.16,.065,side*7.18,-.035],[-1.20,.045,.026,side*7.25,-.035]],paint,12);
  // The original long outer pylon otherwise cuts through an R73's dorsal fins.
  // A short adapter supports the two lugs between the front/rear fin stations.
  const outer=outerLayout(side);
  m.box([outer.x,(outer.top+outer.y)/2,outer.z],[.075,.19,.94],metal);
  m.box([outer.x,outer.y+.009,outer.z],[.11,.018,.98],paint);
  const data=m.data,original=wings[key];let uv=[0,0],best=Infinity;
  for(let i=0;i<original.length;i+=13){const d=Math.abs(original[i]-t.wingEdge)+Math.abs(original[i+2]+2.6);if(d<best){best=d;uv=[original[i+11],original[i+12]];}}
  for(let i=0;i<data.length;i+=13){data[i+11]=uv[0];data[i+12]=uv[1];}
  wings[key]=append(original,data);hardware.push({...t,outerMount:outer,vertices:data.length/13,triangles:data.length/39,owner:side<0?'wing_l_out':'wing_r_out'});
 }
 return{...geometry,wings,mountDetailsVersion:VERSION,mountHardware:hardware};
}
export function proceduralGeometryFingerprint(geometry){
 const hash=data=>{let h=Math.imul(2166136261^(data.length/39),16777619)>>>0;for(let i=0;i<data.length;i+=13)for(let k=0;k<3;k++)h=Math.imul(h^Math.round(data[i+k]*1e4),16777619)>>>0;return h.toString(16).padStart(8,'0');};
 if(!geometry?.body||!geometry.wings?.l||!geometry.wings?.r)return null;
 return {algorithm:'fnv1a32-triangles-quantized-xyz-v1',quantization_m:.0001,body:hash(geometry.mountBaseBody||geometry.body),left:hash(geometry.wings.l),right:hash(geometry.wings.r)};
}
function matchesProceduralGeometry(profile,geometry){const expected=profile.proceduralGeometry;if(!expected)return true;const actual=proceduralGeometryFingerprint(geometry);return actual&&Object.keys(expected).every(k=>actual[k]===expected[k]);}
function fitProfile(id,model){const p=FITTED_MOUNTS[id],source=model?.sourceHashes?.main||model?.sourceBinding?.glbSha256||(['nf01','nf02','f4u1d'].includes(id)?'procedural:'+id+'-v1':null);return p&&p.sourceMain===source?p:null;}
export function airframe(id,model,geometry){
 const g=su27Airframe(id,model,geometry),profile=fitProfile(id,model);if(!profile||!matchesProceduralGeometry(profile,g)||g.mountFitVersion===VERSION)return g;
 const out={...g,wings:{...g.wings},mountBaseBody:g.body,mountFitVersion:VERSION,mountFitAdded:[]};
 for(const [index,p] of profile.mounts.entries()){
  const end=p.end||p.anchor.map((v,k)=>v-(k===1?p.lower:0)),mesh=new Mesh(),c=rgb('#a4afb6'),dark=rgb('#58646c');
  if(p.clearanceElbow){const elbow=[p.root[0],end[1],end[2]];mesh.beam(p.root,elbow,.055,.16,c);mesh.beam(elbow,end,.055,.16,c);}else mesh.beam(p.root,end,.055,p.existingProceduralPylon?.22:.16,c);
  mesh.box([end[0],end[1]+.007,end[2]],[.075,.014,Math.min(.80,p.length)],dark);
  const data=mesh.data,field=p.owner?.startsWith('wing_l')?'l':p.owner?.startsWith('wing_r')?'r':'body',base=field==='body'?g.body:g.wings[field];
  let uv=[0,0],best=Infinity;for(let i=0;i<base.length;i+=13){const d=Math.hypot(base[i]-p.root[0],base[i+1]-p.root[1],base[i+2]-p.root[2]);if(d<best){best=d;uv=[base[i+11],base[i+12]];}}
  for(let i=0;i<data.length;i+=13){data[i+11]=uv[0];data[i+12]=uv[1];}
  out.mountFitAdded.push({key:id+':'+index,field,owner:p.owner,station:p.station,side:p.side,data});
 }
 return out;
}
export function fitItems(T,items){
 const profile=fitProfile(T?.id,T?.model);if(!profile||profile.proceduralGeometry&&!matchesProceduralGeometry(profile,T.geometry?.()))return items;
 for(const it of items){
  if(it.mountFitVersion===VERSION)continue;
  const anchor=it.mount||it.pylon?.[1];if(!anchor)continue;
  const fits=p=>p.station===it.station&&p.side===it.side&&(p.anchors||[p.anchor]).some(a=>a.every((v,k)=>Math.abs(v-anchor[k])<1e-4));
  // A weapon-specific fin-clearance adapter wins over the existing general
  // carrier; other weapons retain their original profile and stable key.
  const p=profile.mounts.find(p=>p.onlyWeapons?.includes(it.id)&&fits(p))||profile.mounts.find(p=>!p.onlyWeapons&&fits(p));if(!p)continue;
  const end=p.end||p.anchor.map((v,k)=>v-(k===1?p.lower:0)),delta=end.map((v,k)=>v-anchor[k]);
  it.p=it.p.map((v,k)=>v+delta[k]);it.mount=end.slice();
  if(it.rack)it.rack={...it.rack,origin:it.rack.origin.map((v,k)=>v+delta[k])};
  it.pylon=null;it.nativePylon=true;it.fittedMountKey=T.id+':'+profile.mounts.indexOf(p);it.mountFitVersion=VERSION;it.modelMountBasis='whole_mesh_clearance_with_physical_airframe_adapter';
 }
 return items;
}
const hitboxTemplates=new WeakMap();
/** Potential adapters share triangle storage. Membership is private to each plane. */
export function install(plane,{Node,geometry}={}){
 const added=geometry?.mountFitAdded;if(!added?.length||plane.mountFitNodes)return;
 const base=plane.hitbox,has=new Set(base.parts.map(p=>p.id));let template=hitboxTemplates.get(base);
 if(!template){
  const count=added.reduce((n,p)=>n+p.data.length/39,0),tris=new Float32Array(base.tris.length+count*9),piece=new Uint16Array(base.piece.length+count),pieces=base.pieces.slice();tris.set(base.tris);piece.set(base.piece);let v=base.tris.length,t=base.piece.length;
  for(const p of added){
   const part=has.has(p.owner)?p.owner:has.has(p.owner?.replace(/_out$/,''))?p.owner.replace(/_out$/,''):'fuselage',ix=pieces.length;
   pieces.push({name:'mount:'+p.key,part,carrier:part==='fuselage'?null:part,mountKey:p.key});
   for(let i=0;i<p.data.length;i+=39){for(let j=0;j<3;j++)for(let k=0;k<3;k++)tris[v++]=p.data[i+j*13+k];piece[t++]=ix;}
  }
  let hash=2166136261;for(const word of new Uint32Array(tris.buffer))hash=Math.imul(hash^word,16777619)>>>0;
  template={...base,tris,piece,pieces,count:piece.length,hash:hash.toString(16).padStart(8,'0'),bvh:null,mountBaseTriangleCount:base.count};hitboxTemplates.set(base,template);
 }
 const hb={...template,mountActive:new Set(),mountRevision:0};Object.defineProperty(hb,'bvh',{get:()=>template.bvh,set:v=>template.bvh=v,enumerable:true});
 plane.hitbox=plane.damage.hitbox=hb;plane.damage._alive=null;
 plane.mountFitNodes=added.map(p=>{
  const n=plane.root.add(new Node('aircraft_fitted_mount_'+p.key));n.mesh=plane.renderer.mesh(p.data);n.mesh.aircraftGeometry=true;plane.meshes.push(n.mesh);
  n.kind=3;n.visible=false;n.hitboxDisabled=true;n.mountFitNode=true;n.mountKey=p.key;n.mountOwner=template.pieces.find(q=>q.mountKey===p.key).part;return n;
 });
}
export function maskAlive(hb,alive){if(hb.mountActive)for(let i=0;i<hb.pieces.length;i++){const key=hb.pieces[i].mountKey;if(key&&!hb.mountActive.has(key))alive[i]=0;}return alive;}
export function attach(plane,items){
 if(!plane.mountFitNodes)return;
 const active=new Set(items.map(it=>it.fittedMountKey).filter(Boolean)),old=plane.hitbox.mountActive;
 if(active.size!==old.size||[...active].some(k=>!old.has(k))){plane.hitbox.mountActive=active;plane.hitbox.mountRevision++;plane.damage._alive=null;plane.damage.revision++;}
 show(plane);
}
export function show(plane){
 for(const n of plane.mountFitNodes||[]){const active=plane.hitbox.mountActive.has(n.mountKey)&&!plane.damage.gone(n.mountOwner);n.visible=active;n.hitboxDisabled=!active;n.kind=plane.xray?6:3;n.aircraftShell=plane.xray?.48:0;}
}
export function rebind(T,items,{storeMountPosition}){
 const dual=T?.id==='f15c'&&T.model?.sourceHashes?.main==='b736634797d9c94fa04967e8f06b20a40458d8349af54888d0b62de47a50c23a'?[2.668717375093214,3.18717375093214]:T?.id==='f4e'&&T.model?.sourceHashes?.main==='e03a28ce0a9ef04a4198a647e4ca22eaf85d92e0a625ddad4ad640005624a2f6'?[1.84966101695,2.33338983051]:null;
 if(dual)for(const it of items)if(it.modelHardpoint?.includes('wing_rail_')){
  const inner=it.modelHardpoint.endsWith('inner'),direction=it.side*(inner?-1:1);it.mount=[it.side*dual[inner?0:1]+direction*.13,it.mount[1],it.mount[2]];it.p=storeMountPosition(it.def,it.mount);it.modelMountBasis='source_dual_rail_with_lateral_saddle';
 }
 if(T?.id==='f15c'&&T.model?.sourceHashes?.main==='b736634797d9c94fa04967e8f06b20a40458d8349af54888d0b62de47a50c23a'){
  // Use the existing CFT fore/aft ejector hooks, rather than placing missiles
  // through the sensor pods on the intake sides. No source hardware is removed.
  for(const side of[-1,1]){
   const group=items.filter(it=>it.station==='belly'&&it.side===side).sort((a,b)=>b.p[2]-a.p[2]);
   for(let i=0;i<group.length&&i<2;i++){
    const it=group[i],m=i===0?[side*2.094,-1.199,2.356]:[side*2.081,-1.139,-2.739];it.mount=m;it.p=storeMountPosition(it.def,m);it.pylon=null;it.nativePylon=true;it.modelHardpoint=(side<0?'left':'right')+'_cft_'+(i===0?'fore':'aft');it.modelMountBasis='source_cft_ejector_hook';
   }
  }
 }
 if(T?.id!=='su27'||!matchesSu27(T.model))return items;
 for(const it of items)if(it.station==='tip'&&Math.abs(it.side)===1){const t=tipLayout(it.side);it.mount=[t.x,t.y,t.z];it.p=storeMountPosition(it.def,it.mount);it.pylon=null;it.nativePylon=true;it.modelHardpoint=(it.side<0?'left':'right')+'_wingtip_launcher';it.modelMountBasis='new_rail_fitted_to_actual_source_wing_edge';}
 for(const it of items)if(it.station==='outer'&&Math.abs(it.side)===1){const t=outerLayout(it.side);it.mount=[t.x,t.y,t.z];it.p=storeMountPosition(it.def,it.mount);it.pylon=null;it.nativePylon=true;it.modelMountBasis='source_outer_pylon_with_fin_clearance_adapter';}
 return items;
}
const profiles={
 tank120:[[-.5,.005],[-.46,.28],[-.32,.78],[-.12,1],[.14,.97],[.31,.78],[.43,.44],[.49,.10],[.5,.005]],
 tank600:[[-.5,.008],[-.46,.30],[-.35,.74],[-.18,.98],[.17,1],[.32,.85],[.43,.49],[.49,.12],[.5,.005]],
 ptb800:[[-.5,.006],[-.46,.24],[-.35,.63],[-.18,.94],[.19,1],[.33,.82],[.43,.46],[.49,.10],[.5,.004]]
};
function features(d,lod=0){
 const samp=sampBomb(d,lod);if(samp)return samp;
 const guided=d?.kind==='bomb'&&d.guidance==='laser';
 if(!d||!guided&&!['tank','gunpod','pod','sensorpod','ecm'].includes(d.kind)||!(d.len>0&&d.d>0))return null;
 const m=new Mesh(),L=d.len,r=d.d/2,c=rgb(d.color||'#9aa0a0'),dark=rgb('#293039'),seam=rgb('#697075'),metal=rgb('#68737a'),near=lod===0,n=near?28:14;
 if(guided){
  m.loft([[-L*.5,r*.42,r*.42],[-L*.36,r*.82,r*.82],[-L*.20,r,r],[L*.20,r,r],[L*.35,r*.58,r*.58],[L*.43,r*.30,r*.30],[L*.50,r*.22,r*.22]],c,n);
  for(const z of[-.39,.34])for(let k=0;k<4;k++){
   const t=(k+.5)*Math.PI/2,u=[Math.cos(t),Math.sin(t)],span=r*(z<0?1.9:1.35),a=[u[0]*r*.65,u[1]*r*.65,L*(z-.07)],b=[u[0]*span,u[1]*span,L*(z-.08)],e=[u[0]*span,u[1]*span,L*(z+.03)],f=[u[0]*r*.65,u[1]*r*.65,L*(z+.07)];m.quad(a,b,e,f,c);m.quad(f,e,b,a,c);
  }
  m.loft([[L*.493,r*.23,r*.23],[L*.501,r*.18,r*.18]],dark,n);m.box([0,r,-L*.08],[.055,.03,.30],metal);m.features.push('laser_seeker','forward_control_fins','folded_tail_fins');
 }else if(d.kind==='tank'){
  const id=d.name?.includes('PTB')?'ptb800':L<4?'tank120':'tank600',p=profiles[id];m.loft(p.map(([z,s])=>[z*L,r*s,r*s]),c,n);m.features.push('closed_fuel_body');
  if(near){for(const z of[-.18,.18])m.loft([[z*L-.006,r*1.003,r*1.003],[z*L+.006,r*1.003,r*1.003]],seam,n);
   m.box([0,r*.98,L*.11],[r*.27,.018,r*.32],metal);m.features.push('filler_and_seams');}
  if(id==='ptb800'){for(const s of[-1,1]){
   const a=[s*r*.57,0,-L*.36],b=[s*r*1.52,0,-L*.47],e=[s*r*1.52,0,-L*.37],f=[s*r*.8,0,-L*.27];
   m.quad(a,b,e,f,c);m.quad(f,e,b,a,c);
  }m.features.push('tank_tail_stabilizers');}
  // Existing fallback placement advances the body by 8% length: put its two
  // physical lugs around the inverse socket, so both actually meet the pylon.
  for(const z of[-.12,.12])m.box([0,r*.99,(z-.08)*L],[.055,.035,.10],metal);
 }else if(d.kind==='gunpod'){
  m.loft([[-.5*L,.015,.015],[-.40*L,r*.76,r*.78],[-.20*L,r,r],[.19*L,r*.98,r*.86],[.31*L,r*.72,r*.62],[.34*L,r*.40,r*.42]],c,n);
  // SPPU-22-01: twin GSh-23 barrels in the forward opening; no missile fins or nozzle.
  const y=-.06;m.box([0,y,L*.30],[r*.85,r*.49,L*.15],dark);
  for(const x of[-.042,.042]){m.tube([x,y],L*.25,L*.50,.022,.006,metal,near?16:8);if(near)m.tube([x,y],L*.43,L*.49,.032,.009,seam,16);}
  if(near){for(const z of[-.25,.04])m.loft([[z*L-.006,r*1.006,r*.97],[z*L+.006,r*1.006,r*.97]],seam,n);for(let i=0;i<5;i++)m.box([r*.98,0,-L*.17+i*.06],[.007,.06,.025],dark);m.features.push('panel_seams_and_vents');}
  m.features.push('twin_barrels','forward_gun_cradle');m.box([0,r*.98,-L*.08],[.10,.03,.34],metal);
 }else if(d.kind==='pod'){
  if(d.count===12&&L<1.2)return null; // Existing exposed wooden R4M rack stays its own model.
  m.loft([[-L*.5,r*.68,r*.68],[-L*.44,r,r],[L*.46,r,r],[L*.5,r*.95,r*.95]],c,n);
  const total=Math.max(1,Math.min(36,Math.floor(d.count||7))),patterns={7:[[1,0],[6,.62]],16:[[1,0],[5,.38],[10,.76]],18:[[6,.33],[12,.74]],19:[[1,0],[6,.40],[12,.74]],20:[[1,0],[7,.38],[12,.76]]};
  const rings=patterns[total]||[[total,.65]],used=[];
  for(const[count,rad]of rings)for(let i=0;i<count;i++){const t=2*Math.PI*i/count+Math.PI/2;used.push([Math.cos(t)*rad*r,Math.sin(t)*rad*r]);}
  const radius=r*(total===7?.22:total>=16?.135:Math.min(.22,1.5/total));
  for(const[x,y]of used)m.tube([x,y],L*.47,L*.505,radius,radius*.19,dark,near?12:6);
  m.features.push('open_rocket_tubes:'+used.length);if(near)m.loft([[-L*.32-.005,r*1.007,r*1.007],[-L*.32+.005,r*1.007,r*1.007]],seam,n);
  m.box([0,r*.98,-L*.08],[r*.6,.026,L*.17],metal);
 }else if(d.kind==='ecm'){
  m.loft([[-L*.5,r*.42,r*.50],[-L*.40,r,r],[L*.35,r,r],[L*.5,r*.45,r*.60]],c,n);
  m.box([0,-r*.85,0],[r*1.7,r*.85,L*.62],c);m.box([0,-r*1.3,L*.29],[r*1.4,.025,.16],dark);m.features.push('ecm_lower_fairing');
 }else if(d.pod==='sniper'||d.pod==='litening'){
  const sn=d.pod==='sniper';m.loft([[-L*.5,r*.4,r*.4],[-L*.43,r,r],[L*.23,r,r],[L*.36,r*.85,r*.85],[L*.48,r*.65,r*.65]],c,n);
  m.loft([[L*.48,r*.65,r*.65],[L*.50,r*.60,r*.60]],dark,n);m.box([0,-r*.61,L*.33],[r*1.17,r*.42,L*.19],dark);
  if(near){for(const z of[-.28,.13])m.loft([[z*L-.004,r*1.006,r*1.006],[z*L+.004,r*1.006,r*1.006]],seam,n);}
  m.box([0,r,-L*.08],[.10,.03,.34],metal);if(!sn)m.box([0,r*.92,-L*.20],[r*.8,r*.45,L*.18],c);m.features.push(sn?'sniper_optical_head':'litening_optical_head','sensor_window');
 }else{
  m.loft([[-L*.5,r*.44,r*.44],[-L*.38,r,r],[L*.28,r,r],[L*.40,r*.76,r*.76]],c,n);m.loft([[L*.4,r*.65,r*.65],[L*.48,r*.55,r*.55]],dark,n);m.features.push('sensor_window');
 }
 return{data:m.data,features:m.features};
}
export const store=(d,lod=0)=>features(d,lod)?.data||null;
export const storeEvidence=(d,lod=0)=>{const f=features(d,lod);return f?{features:f.features,triangles:f.data.length/39}:null};
