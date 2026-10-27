// User report: turning on the spot on the ground became very slow. Each tracked vehicle in the trimmed
// data held on A with no throttle for 6 s on the range: its yaw rate over the last 3 s against its
// max turn rate (data, times the gameplay rule's steer factor), and its speed.
const tf=window.__tf,x=window.__tfx,G=tf.G,out={};
await tf.coreReady();tf.finishThumbs();
const ids=(window.__VEH||Object.keys(x.data.vehicles).join(',')).split(',');
for(const id of ids){
  if(G.mode==='battle')tf.toGarage();
  tf.select(id);
  tf.startBattle();tf.pause(true);
  for(let i=0;i<120;i++)tf.advance(1/60,[],false);
  const h0=G.s.heading;tf.advance(3,['left'],false);const h1=G.s.heading;tf.advance(3,['left'],false);const h2=G.s.heading;
  const wrap=(a)=>Math.atan2(Math.sin(a),Math.cos(a)),rate=Math.abs(wrap(h2-h1))/3*180/Math.PI,first=Math.abs(wrap(h1-h0))/3*180/Math.PI;
  const p=G.veh?.tm?.dr?.p||G.veh?.tm?.p||null;
  out[id]={turnDegS:+rate.toFixed(1),firstDegS:+first.toFixed(1),maxDegS:p?+(p.maxTurnRate*180/Math.PI).toFixed(1):null,speedKmh:+(G.s.u*3.6).toFixed(1),mode:G.gameplayMode};
}
return out;
