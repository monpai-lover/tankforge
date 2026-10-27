// A type's drawn triangles (positions only, its frame: +x right, +y up, +z nose) for comparing with a
// reference model (tools/aircraft_ref): __IDS=su27,f15c. Printed in pieces: '@@GEO id k json'.
const x=window.__tfx,ids=(window.__IDS||'su27').split(',');
const out={};
for(const id of ids){
  const T=x.AIRCRAFT_TYPES[id],g=T.geometry(),meshes=[];
  const take=(name,d,off=[0,0,0])=>{if(!d||!d.length)return;const t=[];for(let i=0;i<d.length;i+=13)t.push(+(d[i]+off[0]).toFixed(3),+(d[i+1]+off[1]).toFixed(3),+(d[i+2]+off[2]).toFixed(3));meshes.push({name,tris:t});};
  take('body',g.body);take('wing_l',g.wings.l);take('wing_r',g.wings.r);take('glass',g.glass);
  for(const c of g.controls)if(c.type!=='gear'&&c.type!=='tailgear')take(c.type,c.data,c.p);
  const s=JSON.stringify({meshes});
  for(let i=0,k=0;i<s.length;i+=40000,k++)console.log('@@GEO '+id+' '+k+' '+s.slice(i,i+40000));
  out[id]=meshes.map(m=>m.name+':'+m.tris.length/9);
}
return out;
