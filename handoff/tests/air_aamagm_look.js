// The package's store models and racks in the hangar (A-10A Mavericks B / G on LAU-88 / LAU-117,
// AIM-9M on LAU-105; NF-02's anti-radiation / beam / command test load; F-15C AMRAAM B / C), side views.
const tf=window.__tf,x=window.__tfx,G=tf.G,out={};
const frames=(n=2)=>new Promise(r=>{let k=0;const f=()=>++k>=n?r():requestAnimationFrame(f);requestAnimationFrame(f);});
await tf.coreReady();await x.flightCoreP;tf.finishThumbs();
document.querySelector('#g-mode .tab[data-g=air]').click();for(let i=0;i<30&&!G.airGarage?.plane;i++)await frames(1);
for(const [id,lo,yaw,k] of [['a10a',6,2.4,0.55],['a10a',6,0.9,0.5],['nf02',9,2.4,0.7],['f15c',5,2.4,0.62]]){
  document.querySelector(`#air-list .card[data-air=${id}]`).click();await frames(3);document.querySelector(`#g-air .air-lo[data-lo="${lo}"]`).click();await frames(3);
  const pl=G.airGarage.plane,c=pl.drawPos;document.querySelectorAll('#g-bottom, #g-top, #g-info').forEach(el=>el.style.visibility='hidden');
  const L=Math.max(G.airGarage.size.len,G.airGarage.size.span);G.camOverride={pivot:[c[0],c[1]-0.3,c[2]],dist:L*k,fov:0.75};G.cam.yaw=pl.heading+yaw;G.cam.pitch=-0.12;await frames(4);await pyShot(`${id}_${yaw}`);
  out[`${id}_${yaw}`]={loadout:document.querySelector('#g-air .air-lo[aria-pressed=true]')?.textContent,nodes:pl.storeNodes.filter(n=>n.storeId).map(n=>`${n.storeId}:${n.storeLod}`).join(' ')};
  document.querySelectorAll('#g-bottom, #g-top, #g-info').forEach(el=>el.style.visibility='');
}
G.camOverride=null;
return out;
