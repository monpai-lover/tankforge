// A separate SAMP 250 kg-class game asset. Photo/aircraft provenance is in catalog.mjs.
// Dimensions, finish, fins, lugs and HE figures are game estimates, not an exact Type 25F1 drawing.
export const SAMP_VISUAL='samp250_game_fit';
export function sampDefinition(defs={}){
 const he=defs.fab250?.warhead||{kind:'he',mass_kg:250,explosive_mass_kg:100,explosive_type:'tnt'};
 return {name:'SAMP 250 kg 炸弹（游戏拟合）',kind:'bomb',visual:SAMP_VISUAL,mass:250,len:2.05,d:.30,color:'#67715a',band:'#c8ae46',
  dimension_status:'game_estimate',provenance:'French Mirage 5F actual SAMP 250kg carriage: T.Laurent photo 159898, September1990; aircraft bomb capability: Dassault Mirage5. Exact subtype and all geometry/gameplay figures are provisional.',
  warhead:{...he,id:'he_bomb_samp250_game',name:'SAMP 250 kg HE（游戏估计）',caliber_mm:300,mass_kg:250}};
}
const rgb=s=>{const n=parseInt(s.replace('#',''),16);return [16,8,0].map(k=>Math.pow(((n>>k)&255)/255,2.2))};
const sub=(a,b)=>a.map((v,k)=>v-b[k]),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export function sampBomb(d,lod=0){
 if(d?.visual!==SAMP_VISUAL||!(d.len>0&&d.d>0))return null;
 const out=[],L=d.len,r=d.d/2,n=lod===0?28:12,paint=rgb(d.color||'#67715a'),metal=rgb('#777b6c'),band=rgb(d.band||'#c8ae46');
 const tri=(a,b,c,color)=>{let q=cross(sub(b,a),sub(c,a)),size=Math.hypot(...q);if(size<1e-10)return;q=q.map(v=>v/size);for(const p of[a,b,c])out.push(...p,...q,...color,.64,.18,0,0);};
 const quad=(a,b,c,d,color)=>{tri(a,b,c,color);tri(a,c,d,color);};
 const loft=(sections,color)=>{
  const point=(s,i)=>{const t=2*Math.PI*i/n;return[s[1]*Math.cos(t),s[1]*Math.sin(t),s[0]];};
  for(let j=1;j<sections.length;j++)for(let i=0;i<n;i++)quad(point(sections[j-1],i),point(sections[j-1],i+1),point(sections[j],i+1),point(sections[j],i),color);
  const a=sections[0],b=sections.at(-1);for(let i=0;i<n;i++){tri([0,0,a[0]],point(a,i+1),point(a,i),color);tri([0,0,b[0]],point(b,i),point(b,i+1),color);}
 };
 const box=(c,s,color)=>{const p=[[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]].map(q=>q.map((v,k)=>c[k]+v*s[k]/2));for(const f of[[0,3,2,1],[4,5,6,7],[0,4,7,3],[1,2,6,5],[0,1,5,4],[3,7,6,2]])quad(...f.map(i=>p[i]),color);};
 // Broad cylindrical GP body with a rounded nose, a tapering tail cone and a separate tail sleeve.
 loft([[-.50*L,r*.29],[-.43*L,r*.33],[-.30*L,r*.61],[-.19*L,r],[.22*L,r],[.33*L,r*.87],[.43*L,r*.48],[.50*L,r*.025]],paint);
 loft([[-.50*L,r*.31],[-.39*L,r*.37]],metal);
 // Four thick tail plates on the tail sleeve. This is a distinct French bomb asset,
 // not a recoloured US Mk82 mesh or a guided-bomb fallback with seeker fins.
 for(let i=0;i<4;i++){
  const t=(i+.5)*Math.PI/2,u=[Math.cos(t),Math.sin(t)],v=[-u[1],u[0]],half=.006;
  const shape=[[r*.28,-.50*L],[r*1.72,-.50*L],[r*1.72,-.32*L],[r*.57,-.24*L]],points=sign=>shape.map(([a,z])=>[u[0]*a+v[0]*half*sign,u[1]*a+v[1]*half*sign,z]),a=points(-1),b=points(1);
  quad(...a,paint);quad(...b.toReversed(),paint);for(let k=0;k<4;k++)quad(a[k],b[k],b[(k+1)%4],a[(k+1)%4],paint);
 }
 // Same body-origin/socket convention as existing non-model bomb definitions.
 for(const dz of[-.18,.18])box([0,r+.008,-.08*L+dz],[.045,.030,.070],metal);
 if(lod===0){loft([[.28*L,r*.953],[.296*L,r*.934]],band);loft([[-.185*L,r*1.003],[-.175*L,r*1.003]],metal);}
 return {data:new Float32Array(out),features:['samp_250kg_independent_body','rounded_gp_nose','tapered_tail_sleeve','four_tail_plates','twin_suspension_lugs','game_estimate_geometry']};
}
