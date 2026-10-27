// User report: the radar's track prediction is wrong. An F-15C's radar locked on an aircraft in a steady
// turn (its heading turning 0.25 rad/s at ~220 m/s: ~5.6 g) 700 m ahead; the lead ring's predicted
// intercept point against where the target really is after the ring's time of flight: the mean and the
// 90th percentile error, with the target's acceleration in the prediction (the default) and without
// (G.rawStt: the earlier straight-line prediction on the raw measurement).
const tf=window.__tf,x=window.__tfx,G=tf.G,out={};
const next=()=>new Promise(r=>setTimeout(r,0));
await tf.coreReady();await x.flightCoreP;tf.pause(true);G.airDefenceOn=false;tf.finishThumbs();tf.setQuality('low');
const live=(fn)=>{const p=G.paused;G.paused=false;try{fn();}finally{G.paused=p;}};
const tap=(code)=>{live(()=>window.dispatchEvent(new KeyboardEvent('keydown',{code,bubbles:true})));live(()=>window.dispatchEvent(new KeyboardEvent('keyup',{code,bubbles:true})));};
const sub=(a,b)=>a.map((v,i)=>v-b[i]),nrm=(a)=>{const l=Math.hypot(...a)||1;return a.map(v=>v/l);};
for(const mode of ['acceleration','straight']){
  G.rawStt=mode==='straight';
  if(G.air?.active)x.exitAircraft(true);
  G.airLoadout.f15c=0;document.querySelector('.hangar-card[data-air=f15c]').click();
  for(let i=0;i<120&&!(G.air?.active&&G.air.plane.type.id==='f15c');i++){tf.advance(1/60,[],false);await next();}
  const air=G.air,P=air.plane;P.spawn(0,3500,0,0,220,false);P.state.throttle=0.85;P.aim=[0,0,1];tf.advance(10/60,[],false);
  G.airBotsOn=true;for(let i=0;i<900&&!G.airBots.list.length;i++){tf.advance(1/60,[],false);await next();}G.airBotsOn=false;
  const b=G.airBots.list[0];G.airBots.list=[b];b.flares=0;b.chaff=0;b.missileAt=1e9;for(const g of b.guns)g.ammo=0;
  const q=P.position;b.plane.spawn(q[0],q[1]+10,q[2]+700,0,220,false);b.plane.state.throttle=0.9;
  const t0=G.time;Object.defineProperty(b.plane,'aim',{get:()=>{const h=0.25*(G.time-t0);return [Math.sin(h),0,Math.cos(h)];},set:()=>{},configurable:true});
  for(let i=0;i<240&&air.ctl?.radar?.stt?.state!=='track';i++){if(i%30===0&&!air.ctl?.radar?.stt)tap('KeyR');P.aim=nrm(sub(b.plane.position,P.position));tf.advance(1/60,[],false);}
  // the target settles into its turn; the F-15 follows it
  const hist=[],preds=[];
  for(let k=0;k<300;k++){P.aim=nrm(sub(b.plane.position,P.position));tf.advance(1/60,[],false);hist.push({t:G.time,p:b.plane.position.slice()});const pp=air.pipper;if(k>60&&pp?.lead)preds.push({t:G.time+pp.tof,F:pp.lead.slice()});}
  const errs=[];for(const pr of preds){const h=hist.find(e=>e.t>=pr.t);if(h)errs.push(Math.hypot(...sub(h.p,pr.F)));}
  errs.sort((p,q)=>p-q);
  out[mode]={radar:air.ctl?.radar?.stt?.state||null,samples:errs.length,meanErrM:+(errs.reduce((s,v)=>s+v,0)/(errs.length||1)).toFixed(1),p90ErrM:+(errs[Math.floor(errs.length*0.9)]||0).toFixed(1),range:Math.round(Math.hypot(...sub(b.plane.position,P.position)))};
}
G.rawStt=false;
return out;
