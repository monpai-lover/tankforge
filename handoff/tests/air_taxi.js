// Taxiing (user request: on the ground the instructor works only the rudder, not the ailerons or the
// elevator): the mouse aim pulled up and to the left on the runway at taxi speed; the elevator and
// aileron positions, the rudder's, the heading change. Then a take-off with the instructor still works.
const tf=window.__tf,x=window.__tfx,G=tf.G,out={};
const next=()=>new Promise(r=>setTimeout(r,0));
await tf.coreReady();await x.flightCoreP;tf.pause(true);G.airDefenceOn=false;tf.finishThumbs();
for(const id of (window.__TYPES||'nf01,p51d,f15c').split(',')){
  if(G.air?.active)x.exitAircraft(true);
  G.airLoadout[id]=0;document.querySelector(`.hangar-card[data-air=${id}]`).click();
  for(let i=0;i<120&&!(G.air?.active&&G.air.plane.type.id===id);i++){tf.advance(1/60,[],false);await next();}
  const P=G.air.plane,S=P.cur,r={};
  // taxi: a little throttle, the aim 40 deg left and 25 deg up
  P.state.throttle=0.35;const h0=P.heading;let maxP=0,maxR=0,maxY=0;
  for(let k=0;k<6*60;k++){const a=h0+0.7;P.aim=[Math.sin(a)*Math.cos(0.44),Math.sin(0.44),Math.cos(a)*Math.cos(0.44)];tf.advance(1/60,[],false);
    if(P.onGround){maxP=Math.max(maxP,Math.abs(S[24]));maxR=Math.max(maxR,Math.abs(S[25]));maxY=Math.max(maxY,Math.abs(S[26]));}}
  r.taxi={kmh:Math.round(S[13]*3.6),onGround:P.onGround,elevatorMax:+maxP.toFixed(3),aileronMax:+maxR.toFixed(3),rudderMax:+maxY.toFixed(2),turnedDeg:Math.round(((P.heading-h0)*57.3+540)%360-180)};
  // take-off: full throttle, aim straight ahead and a little up
  P.state.throttle=1;P.state.flaps='takeoff';let lift=null;const h1=P.heading;
  for(let k=0;k<60*60&&lift==null;k++){P.aim=[Math.sin(h1)*0.97,0.24,Math.cos(h1)*0.97];tf.advance(1/60,[],false);if(!P.onGround&&S[35]>8)lift={s:+(k/60).toFixed(1),kmh:Math.round(S[13]*3.6)};}
  r.takeoff=lift;out[id]=r;
}
return out;
