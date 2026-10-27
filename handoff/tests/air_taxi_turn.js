// User report: turning on the spot on the ground had become very slow (the rudder only, nothing at a
// standstill). Each type parked on the runway: D held at idle (the brakes pivot it), then at taxi
// speed, then Q held (the yaw key); the yaw rate (deg/s) and the speed. Then the instructor's mouse-aim
// taxi turn (40 deg left) still steers.
const tf=window.__tf,x=window.__tfx,G=tf.G,out={};
const next=()=>new Promise(r=>setTimeout(r,0));
await tf.coreReady();await x.flightCoreP;tf.pause(true);G.airDefenceOn=false;G.airBotsOn=false;tf.finishThumbs();
const live=(fn)=>{const p=G.paused;G.paused=false;try{fn();}finally{G.paused=p;}};
const key=(code,type)=>live(()=>window.dispatchEvent(new KeyboardEvent(type,{code,bubbles:true})));
const wrap=(a)=>Math.atan2(Math.sin(a),Math.cos(a));
for(const id of (window.__TYPES||'nf01,p51d,f15c,a10a,mig21').split(',')){
  if(G.air?.active)x.exitAircraft(true);
  G.airLoadout[id]=0;document.querySelector(`.hangar-card[data-air=${id}]`).click();
  for(let i=0;i<120&&!(G.air?.active&&G.air.plane.type.id===id);i++){tf.advance(1/60,[],false);await next();}
  const P=G.air.plane,S=P.cur,r={};
  const hold=(code,secs,thr)=>{P.state.throttle=thr;key(code,'keydown');const h0=P.heading;let kmh=0;for(let k=0;k<secs*60;k++){tf.advance(1/60,[],false);kmh=Math.max(kmh,S[13]*3.6);}key(code,'keyup');return{degS:+(Math.abs(wrap(P.heading-h0))*57.3/secs).toFixed(1),kmh:Math.round(kmh),onGround:P.onGround,bankDeg:+(S[20]*57.3).toFixed(1)};};
  r.pivotD=hold('KeyD',3,0.05);
  r.taxiD=hold('KeyD',3,0.3);
  for(let k=0;k<120;k++)tf.advance(1/60,[],false);
  r.yawQ=hold('KeyQ',3,0.3);
  P.state.throttle=0.3;const h0=P.heading;
  for(let k=0;k<4*60;k++){const a=h0+0.7;P.aim=[Math.sin(a),0,Math.cos(a)];tf.advance(1/60,[],false);}
  r.aimTurnDeg=Math.round(wrap(P.heading-h0)*57.3);
  out[id]=r;
}
return out;
