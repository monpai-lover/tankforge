// User report: the aiming ring with a radar lock was wrong. An F-15C locks (R) an aircraft 600 m ahead on a
// 30 deg crossing course; the guns fired 1.5 s with the mouse aim held on (a) the lead ring, (b) the target
// itself: the rounds that hit (the target's hp lost) and the lead's range / time of flight.
const tf=window.__tf,x=window.__tfx,G=tf.G,out={};
const next=()=>new Promise(r=>setTimeout(r,0));
await tf.coreReady();await x.flightCoreP;tf.pause(true);G.airDefenceOn=false;tf.finishThumbs();tf.setQuality('low');
const step=(n,fn,dt=1/60)=>{for(let i=0;i<n;i++){fn?.(i);tf.advance(dt,[],false);}};
const live=(fn)=>{const p=G.paused;G.paused=false;try{fn();}finally{G.paused=p;}};
const tap=(code)=>{live(()=>window.dispatchEvent(new KeyboardEvent('keydown',{code,bubbles:true})));live(()=>window.dispatchEvent(new KeyboardEvent('keyup',{code,bubbles:true})));};
const sub=(a,b)=>a.map((v,i)=>v-b[i]),nrm=(a)=>{const l=Math.hypot(...a)||1;return a.map(v=>v/l);};
for(const how of ['lead','target']){
  if(G.air?.active)x.exitAircraft(true);
  G.airLoadout.f15c=0;document.querySelector('.hangar-card[data-air=f15c]').click();
  for(let i=0;i<120&&!(G.air?.active&&G.air.plane.type.id==='f15c');i++){tf.advance(1/60,[],false);await next();}
  const air=G.air,P=air.plane;P.spawn(0,3500,0,0,220,false);P.state.throttle=0.8;P.aim=[0,0,1];step(10);
  G.airBotsOn=true;for(let i=0;i<900&&!G.airBots.list.length;i++){tf.advance(1/60,[],false);await next();}G.airBotsOn=false;
  const b=G.airBots.list[0];G.airBots.list=[b];b.flares=0;b.chaff=0;b.missileAt=1e9;
  const q=P.position;b.plane.spawn(q[0]-30,q[1]+10,q[2]+(window.__DIST||700),0.52,220,false);b.plane.state.throttle=0.8;
  const fixed=[Math.sin(0.52),0,Math.cos(0.52)];Object.defineProperty(b.plane,'aim',{get:()=>fixed,set:()=>{},configurable:true});
  for(let i=0;i<240&&air.ctl?.radar?.stt?.state!=='track';i++){if(i%30===0&&!air.ctl?.radar?.stt)tap('KeyR');P.aim=nrm(sub(b.plane.position,P.position));tf.advance(1/60,[],false);}
  const D=b.plane.damage,hp0=D.parts.reduce((s,p)=>s+p.hp,0);let leadSeen=null;
  const ring=[];step(120,()=>{const pp=air.pipper;if(pp?.lead)ring.push(nrm(sub(pp.lead,P.position)));const at=how==='lead'&&pp?.lead?pp.lead:b.plane.position;P.aim=nrm(sub(at,P.position));});
  // the ring's jitter: the frame-to-frame change of its angular step (sampled every other frame, as computed)
  const rs=ring.filter((_,k)=>k%2===0),st2=[];for(let k=1;k<rs.length;k++)st2.push(rs[k].map((v,j)=>v-rs[k-1][j]));const ac=[];for(let k=1;k<st2.length;k++)ac.push(Math.hypot(...st2[k].map((v,j)=>v-st2[k-1][j]))*1000);ac.sort((p,q)=>p-q);
  const ringJitter={rms:+Math.sqrt(ac.reduce((s2,v)=>s2+v*v,0)/(ac.length||1)).toFixed(2),p95:+(ac[Math.floor(ac.length*0.95)]||0).toFixed(2)};
  air.fireAll=true;
  const errs=[];let minMiss=1e9;const seen=new Set();
  step(90,(i)=>{const pp=air.pipper;if(pp?.lead&&!leadSeen)leadSeen={range:Math.round(pp.range),tof:+pp.tof.toFixed(2)};
    const at=how==='lead'&&pp?.lead?pp.lead:b.plane.position;P.aim=nrm(sub(at,P.position));
    if(pp?.lead&&i%10===0){const u=nrm(sub(pp.at,P.position)),w=nrm(sub(pp.lead,P.position));errs.push(+(Math.acos(Math.min(1,u[0]*w[0]+u[1]*w[1]+u[2]*w[2]))*1000).toFixed(1));}
    for(const q of [...G.bullets,...G.shots])if(q.ownAir){const d=Math.hypot(...sub(q.s.pos,b.plane.position));if(d<minMiss)minMiss=d;}});
  air.fireAll=false;
  out[how]={radar:air.ctl?.radar?.stt?.state||null,lead:leadSeen,hpLost:Math.round(hp0-D.parts.reduce((s,p)=>s+p.hp,0)),summary:D.summary().slice(0,120),fired:air.guns.map(g=>g.fired),bot:b.plane.type.id,ringJitterMrad:ringJitter,pipperToLeadMrad:errs,minMissM:+minMiss.toFixed(1),aimBias:P.aimBias.map(v=>+v.toFixed(3))};
}
return out;
