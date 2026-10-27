// Actual imported geometry, cockpit cameras and store placement in the running WebGL client.
const tf=window.__tf, x=window.__tfx, G=tf.G;
const check=(ok,msg)=>{if(!ok)throw Error(msg);};
const tick=()=>new Promise(r=>setTimeout(r,0));
await tf.coreReady(); await x.flightCoreP; tf.pause(true); tf.setQuality('low'); tf.finishThumbs();
const result={};
for(const id of (window.__IDS||'f86f,f15c,f16v,su25').split(',')) {
  if(G.air?.active)x.exitAircraft(true);
  document.querySelector(`.hangar-card[data-air=${id}]`).click();
  for(let i=0;i<120&&!(G.air?.active&&G.air.plane.type.id===id);i++){tf.advance(1/60,[],false);await tick();}
  check(G.air?.plane.type.id===id,`${id}: boarding failed`);
  const air=G.air,p=air.plane;
  p.spawn(-8000,1500,-8000,0,200,false);p.aim=[0,0,1];p.state.camera=1;
  for(let i=0;i<3;i++)tf.advance(1/60,[],false);
  p.pose(1);p._cockpitDetail?.(true);await p.cockpitHi?.loading;
  for(let i=0;i<4;i++){tf.advance(1/60,[],true);await tick();}
  const stores=x.mountStores(p,id,1);air.stores=stores;
  result[id]={eye:p.type.eye,cameraEye:p.cockpitEye,sightPoints:p.sightGlass?.length,fullCockpit:!!p.cockpitHi?.node,
    guns:air.guns.map(g=>({id:g.id,mount:g.mount})),pipper:air.pipper,
    stores:stores.items.map(it=>({id:it.id,station:it.station,p:it.p,owner:it.owner}))};
  await pyShot(`${id}_cockpit`);
  p.state.camera=0;p.pose(1);
  const camera=p.camera.bind(p);
  p.camera=()=>{const c=p.drawPos,eye=[c[0]+14,c[1]+5,c[2]+15],d=c.map((v,i)=>v-eye[i]),l=Math.hypot(...d);return {camPos:eye,fwd:d.map(v=>v/l),fovY:.75};};
  tf.advance(1/60,[],true);await pyShot(`${id}_stores`);
  p.setXray(true);tf.advance(1/60,[],true);await pyShot(`${id}_internal`);p.setXray(false);
  p.camera=camera;
}
console.log('@@JET_ALIGNMENT '+JSON.stringify(result));
return result;
