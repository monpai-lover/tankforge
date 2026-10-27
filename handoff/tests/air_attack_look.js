// The A-10A and Su-25 in the hangar with a load hung, from above-front and from the side.
const tf=window.__tf,x=window.__tfx,G=tf.G,out={};
const frames=(n=2)=>new Promise(r=>{let k=0;const f=()=>++k>=n?r():requestAnimationFrame(f);requestAnimationFrame(f);});
await tf.coreReady();await x.flightCoreP;tf.finishThumbs();
document.querySelector('#g-mode .tab[data-g=air]').click();
for(let i=0;i<30&&!G.airGarage.plane;i++)await frames(1);
for(const [id,lo] of [['a10a',1],['su25',3]]){
  document.querySelector(`#air-list .card[data-air=${id}]`).click();
  for(let i=0;i<120&&G.airGarage.plane?.type.id!==id;i++)await frames(1);
  await frames(3);document.querySelector(`#g-air .air-lo[data-lo="${lo}"]`)?.click();await frames(4);
  const p=G.airGarage.plane,c=p.drawPos;out[id]={type:p.type.id,stores:p.storeNodes.filter(n=>n.name.startsWith('aircraft_store')).length};
  document.querySelectorAll('#g-bottom, #g-top, #g-info').forEach(el=>el.style.visibility='hidden');
  for(const [tag,yaw,pitch,dist] of [['top',0.75,-0.5,1.1],['side',1.9,-0.12,0.95]]){
    const L=Math.max(G.airGarage.size.len,G.airGarage.size.span);G.camOverride={pivot:[c[0],c[1],c[2]],dist:L*dist,fov:0.75};G.cam.yaw=p.heading+yaw;G.cam.pitch=pitch;await frames(5);await pyShot(id+'_'+tag);
  }
  document.querySelectorAll('#g-bottom, #g-top, #g-info').forEach(el=>el.style.visibility='');
}
G.camOverride=null;
return out;
