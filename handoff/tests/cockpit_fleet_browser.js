// Small aircraft batches exercise the real renderer and WASM without loading the whole tank catalog.
const tf=window.__tf,x=window.__tfx,G=tf.G,result={};
const tick=()=>new Promise(r=>setTimeout(r,0)),check=(a,b)=>{if(!a)throw Error(b);};
await tf.coreReady();await x.flightCoreP;tf.pause(true);tf.setQuality('low');tf.renderer.q={...tf.renderer.q,dome:64,cloudSteps:4};tf.renderer._buildDome(64);tf.finishThumbs();G.airHelp=false;
for(const id of (window.__COCKPIT_IDS||'f16v,su25,mig21,su27,mig29,f4e').split(',')){
 if(G.air?.active)x.exitAircraft(true);
 document.querySelector(`.hangar-card[data-air=${id}]`).click();
 for(let i=0;i<150&&!(G.air?.active&&G.air.plane.type.id===id);i++){tf.advance(1/60,[],false);await tick();}
 check(G.air?.plane.type.id===id,id+' board');const air=G.air,p=air.plane;p.spawn(-8000,1500,-8000,0,150,false);p.state.camera=1;
 tf.advance(.1,[],false);p._cockpitDetail(true);await p.cockpitHi?.loading;
 for(let i=0;i<3;i++){tf.advance(1/60,[],true);await tick();}
 await pyShot(id+'-cockpit');check(p.sightGlass?.length>=3,id+' no glass');check(p.cur.every(Number.isFinite),id+' flight NaN');
 result[id]={eye:p.cockpitEye,glass:p.sightGlass.length,guns:air.guns.map(g=>({id:g.id,mount:g.mount,ports:g.mounts}))};
 if(window.__GUN_INSPECT){
  p.state.camera=0;
  for(const gun of air.guns)for(const mount of gun.mounts||[gun.mount]){const n=p.root.add(new p.root.constructor('gun_muzzle_probe'));n.mesh=tf.renderer.mesh(x.aircraftGeometry.box(mount,[.04,.04,.04],'#ff2020'));p.meshes.push(n.mesh);n.kind=3;}
  const mean=[0,1,2].map(k=>air.guns.reduce((n,g)=>n+g.mount[k],0)/air.guns.length),side=Math.sign(mean[0])||1;
  for(const [label,offset] of [['side',[side*4,-1,2]],['top',[side*3,2,3]]]){p.camera=()=>{const c=p.worldPoint(mean),l=Math.hypot(...offset);return{camPos:c.map((v,i)=>v+offset[i]),fwd:offset.map(v=>-v/l),fovY:.8};};tf.advance(1/60,[],true);await pyShot(id+'-gun-'+label);}
 }
 console.log('@@FLEET '+id+' '+JSON.stringify(result[id]));
}
console.log('@@FLEET_DONE '+JSON.stringify(Object.keys(result)));return result;
