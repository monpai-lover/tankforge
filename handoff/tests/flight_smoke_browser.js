// Delivered game + actual WASM: take off, then capture a fixed 60-degree target.
const tf=window.__tf,x=window.__tfx,G=tf.G,out={};
const check=(value,message)=>{if(!value)throw Error(message);};
const next=()=>new Promise(resolve=>setTimeout(resolve,0));
await tf.coreReady();await x.flightCoreP;tf.pause(true);tf.finishThumbs();
tf.setQuality('low');tf.renderer.q={...tf.renderer.q,dome:64,cloudSteps:4};tf.renderer._buildDome(64);
for(const id of ['nf01','p51d','f104g','mirage3e']){
  if(G.air?.active)x.exitAircraft(true);
  document.querySelector(`.hangar-card[data-air=${id}]`).click();
  for(let i=0;i<120&&!(G.air?.active&&G.air.plane.type.id===id);i++){tf.advance(1/60,[],false);await next();}
  check(G.air?.active&&G.air.plane.type.id===id,`${id}: could not board`);
  const p=G.air.plane,z0=p.position[2],rotate=p.type.rotateKmh/3.6;
  p.state.throttle=1.12;p.state.flaps=true;let lift=null;
  for(let i=0;i<45*60&&!p.crashed&&!lift;i++){
    if(p.cur[13]>rotate)p.aim=[0,.2,1].map(v=>v/Math.hypot(.2,1));
    tf.advance(1/60,[],false);
    if(p.cur[35]>4)lift={seconds:+((i+1)/60).toFixed(2),speedKmh:+(p.cur[13]*3.6).toFixed(1),runMetres:+(p.position[2]-z0).toFixed(1)};
  }
  check(lift&&!p.crashed,`${id}: takeoff failed`);
  p.spawn(-8000,3000,-8000,0,140,false);
  p.aim=[Math.sin(Math.PI/3),0,Math.cos(Math.PI/3)];p.aimBias=[0,0,0,1];
  tf.advance(30,[],false);
  const dot=p.aim.reduce((sum,v,k)=>sum+v*p.cur[48+k],0),error=Math.acos(Math.max(-1,Math.min(1,dot)))*180/Math.PI;
  check(!p.crashed&&p.cur.every(Number.isFinite)&&error<3,`${id}: target capture failed (${error} deg)`);
  out[id]={takeoff:lift,targetErrorDeg:+error.toFixed(4),core:p.api.core_version(),negativeGLimit:p.cur[79]};
}
return out;
