// Red 4-cm markers show the exact accepted gun emission positions on the imported aircraft.
const tf=window.__tf,x=window.__tfx,G=tf.G,result={};
const tick=()=>new Promise(r=>setTimeout(r,0));
await tf.coreReady();await x.flightCoreP;tf.pause(true);tf.setQuality('low');tf.finishThumbs();G.airHelp=false;
for(const id of (window.__GUN_IDS||'a10a,f15c,mig17f').split(',')){
  if(G.air?.active)x.exitAircraft(true);
  document.querySelector(`.hangar-card[data-air=${id}]`).click();
  for(let i=0;i<150&&!(G.air?.active&&G.air.plane.type.id===id);i++){tf.advance(1/60,[],false);await tick();}
  if(G.air?.plane.type.id!==id)throw Error(id+' board failed');
  const air=G.air,p=air.plane;p.spawn(-8000,1500,-8000,0,150,false);p.state.camera=0;tf.advance(.05,[],false);
  const mean=[0,1,2].map(k=>air.guns.reduce((n,g)=>n+g.mount[k],0)/air.guns.length);
  for(const gun of air.guns){
    const n=p.root.add(new p.root.constructor('gun_muzzle_probe'));
    n.mesh=tf.renderer.mesh(x.aircraftGeometry.box(gun.mount,[.045,.045,.045],'#ff2020'));p.meshes.push(n.mesh);n.kind=3;
  }
  const side=Math.sign(mean[0])||1;
  for(const [label,offset] of [['side',[side*4,-1,2]],['front',[side*2,-1,5]]]){
    p.camera=()=>{const c=p.worldPoint(mean),l=Math.hypot(...offset);return{camPos:c.map((v,i)=>v+offset[i]),fwd:offset.map(v=>-v/l),fovY:.8};};
    tf.advance(1/60,[],true);await pyShot(id+'-gun-'+label);
  }
  result[id]=air.guns.map(g=>({id:g.id,mount:g.mount}));
}
console.log('@@GUN_ALIGNMENT '+JSON.stringify(result));return result;
