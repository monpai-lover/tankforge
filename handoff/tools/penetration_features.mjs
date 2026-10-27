// Exact emission schedules from the shipped GeoBuilder. These identifiers
// author construction features; geometry proximity never assigns resistance.
import {triangulate} from '../../client/web/src/gfx/geo.js';
export function constructorFeatures(part,boreRadius=0){
 const out=[];let first=0;
 const add=(feature,count)=>{if(count>0){out.push({first,count,feature});first+=count;}};
 if(part.type==='box')for(const side of ['+z','-z','+x','-x','+y','-y'])add('box:'+side,2);
 else if(part.type==='prism'){
  for(const[i]of triangulate(part.profile).entries()){add('prism:right:'+i,1);add('prism:left:'+i,1);}
  for(const[i]of part.profile.entries())add('prism:edge:'+i,2);
 }else if(part.type==='plan'){
  const n=part.outline.length;
  for(const[i]of triangulate(part.outline).entries()){if(!part.hollow)add('plan:top:'+i,1);add('plan:bottom:'+i,1);}
  if(part.hollow){
   // The inset preserves the polygon's vertex count and ordering. Verify the
   // resulting total against the captured source range before using this plan.
   for(let i=0;i<n-2;i++)add('plan:floor:'+i,1);
   for(let i=0;i<n;i++){add('plan:inner:'+i,2);add('plan:rim:'+i,2);}
  }
  for(let i=0;i<n;i++)add('plan:edge:'+i,2);
 }else if(part.type==='loft'){
  const n=part.rings[0].length;
  for(let b=0;b<part.rings.length-1;b++)for(let e=0;e<n;e++){
   const a=part.rings[b][e],v=part.rings[b][(e+1)%n],c=part.rings[b+1][(e+1)%n],d=part.rings[b+1][e],x=c.map((q,k)=>q-a[k]),y=d.map((q,k)=>q-v[k]);
   if(Math.hypot(x[1]*y[2]-x[2]*y[1],x[2]*y[0]-x[0]*y[2],x[0]*y[1]-x[1]*y[0])>1e-12)add(`loft:band:${b}:edge:${e}`,2);
  }
  for(let end=0;end<2;end++)if((part.caps||[true,true])[end])for(let fan=0;fan<n;fan++)add(`loft:cap:${end}:fan:${fan}`,1);
 }else if(part.type==='cyl'){
  const r2=part.r2??part.r,hole=part.recoil&&part.axis==='z'?boreRadius:0,tube=hole>0&&hole<Math.min(part.r,r2)-.002;
  for(let i=0;i<(part.segs||18);i++){
   add(`cyl:sector:${i}:outer`,2);
   if(tube){add(`cyl:sector:${i}:positive_ring`,2);add(`cyl:sector:${i}:negative_ring`,2);add(`cyl:sector:${i}:bore`,2);}
   else{if(r2>1e-4)add(`cyl:sector:${i}:positive_cap`,1);if(part.r>1e-4)add(`cyl:sector:${i}:negative_cap`,1);}
  }
 }else if(part.type==='mesh'){
  // Each source face remains an independent identity, even when triangulated.
  for(const[i,f]of (part.faces||[]).entries()){
   if(f.length<3)continue;
   const pts=f.map(i=>part.vertices[i]),n=[0,0,0];
   for(let j=0;j<pts.length;j++){const a=pts[j],b=pts[(j+1)%pts.length];n[0]+=(a[1]-b[1])*(a[2]+b[2]);n[1]+=(a[2]-b[2])*(a[0]+b[0]);n[2]+=(a[0]-b[0])*(a[1]+b[1]);}
   const norm=a=>{const l=Math.hypot(...a);return l?a.map(v=>v/l):[0,0,0];},nn=norm(n);let u=[nn[2],0,-nn[0]];
   if(Math.hypot(...u)<1e-6)u=[1,0,0];u=norm(u);const v=[nn[1]*u[2]-nn[2]*u[1],nn[2]*u[0]-nn[0]*u[2],nn[0]*u[1]-nn[1]*u[0]],dot=(a,b)=>a.reduce((s,q,k)=>s+q*b[k],0);
   add('mesh:face:'+i,triangulate(pts.map(p=>[dot(p,u),dot(p,v)])).length);
  }
 }else return null;
 return out;
}
