// User report (2026-10-23): the ground AA's radar lead twitches a lot in play. Tests stepped a steady
// 60 Hz; play runs at the display's rate with uneven frames. The player's radar AA (window.__VEH,
// default the Pantsir; also de_gepard) locked on an aircraft crossing ~2.5 km out, stepped at several frame
// patterns: the view's aim (what the player sees, the guns follow it) and the lead's direction, each as
// its residual from a local quadratic fit over +-0.25 s (mrad RMS / 95th percentile): the twitch.
const tf=window.__tf,x=window.__tfx,G=tf.G,out={};
const next=()=>new Promise(r=>setTimeout(r,0));
await tf.coreReady();await x.flightCoreP;tf.finishThumbs();
if(window.__GAINS)G.leadGains=window.__GAINS;if(window.__FADE)G.accFade=window.__FADE;tf.select(window.__VEH||'ru_pantsir_sm_sv');tf.startBattle();tf.pause(true);G.airDefenceOn=false;
const live=(fn)=>{const p=G.paused;G.paused=false;try{fn();}finally{G.paused=p;}};
const tap=(code)=>{live(()=>window.dispatchEvent(new KeyboardEvent('keydown',{code,bubbles:true})));live(()=>window.dispatchEvent(new KeyboardEvent('keyup',{code,bubbles:true})));};
for(let i=0;i<30;i++)tf.advance(1/60,[],false);
const pad=G.pad;
while(x.airBots.list.length)x.airBots.list.pop();
G.airBotsOn=true;await x.spawnBot();for(let i=0;i<60&&!x.airBots.list.length;i++)await next();
const b=x.airBots.list[0];if(!b)return{error:'no bot'};G.airBotsOn=false;x.airBots.list.splice(0,x.airBots.list.length,b);const keepOne=setInterval(()=>{x.airBots.pending=true;},0);x.airBots.pending=true;
for(const g of b.guns)g.ammo=0;if(b.stores)for(const it of b.stores.items||[])it.gone=true;
const fixed=[1,0,0];Object.defineProperty(b.plane,'aim',{get:()=>fixed,set:()=>{},configurable:true});
const h=G.s;
// frame patterns: seconds per frame
let seed=12345;const rnd=()=>((seed=(seed*1103515245+12345)>>>0)/4294967296);
const patterns={'60':()=>1/60,'144':()=>1/144,'uneven':()=>1/144+rnd()*(1/40-1/144),'30':()=>1/30};
const want=(window.__PATTERNS||'60,144,uneven').split(',');
const fit=(ts,ys)=>{// residuals from a local quadratic fit over +-0.25 s
  const res=[];for(let i=0;i<ts.length;i++){const t0=ts[i];if(t0-ts[0]<0.25||ts[ts.length-1]-t0<0.25)continue;
    let S=[0,0,0,0,0],Sy=[0,0,0];for(let j=0;j<ts.length;j++){const d=ts[j]-t0;if(Math.abs(d)>0.25)continue;const p=[1,d,d*d];for(let a=0;a<5;a++)S[a]+=d**a;for(let a=0;a<3;a++)Sy[a]+=ys[j]*p[a];}
    const M=[[S[0],S[1],S[2]],[S[1],S[2],S[3]],[S[2],S[3],S[4]]];const det=(m)=>m[0][0]*(m[1][1]*m[2][2]-m[1][2]*m[2][1])-m[0][1]*(m[1][0]*m[2][2]-m[1][2]*m[2][0])+m[0][2]*(m[1][0]*m[2][1]-m[1][1]*m[2][0]);
    const D=det(M);const c0=det([[Sy[0],M[0][1],M[0][2]],[Sy[1],M[1][1],M[1][2]],[Sy[2],M[2][1],M[2][2]]])/D;res.push((ys[i]-c0)*1000);}
  const a=res.map(Math.abs).sort((p,q)=>p-q);return {rms:+Math.sqrt(res.reduce((s,v)=>s+v*v,0)/(res.length||1)).toFixed(2),p95:+(a[Math.floor(a.length*0.95)]||0).toFixed(2),n:res.length};};
for(const name of want){
  const fdt=patterns[name];
  pad.lock=null;Object.assign(pad.u,{track:null,search:null,acqAt:null});pad.leadF=null;
  b.plane.spawn(h.x-(window.__DX||2500),window.__ALT||600,h.z+(window.__DZ||2200),Math.PI/2,170,false);b.plane.state.throttle=0.7;
  const step=(dt)=>{G.paused=true;G.keys=new Set();G.skipDraw=true;x.update(dt);};
  for(let t=0;t<2;)t+=(step(fdt()),1/60);
  for(let i=0;i<240&&!pad.contacts.length;i++)step(1/60);
  G.cam.yaw=Math.atan2(b.plane.position[0]-h.x,b.plane.position[2]-h.z);step(1/60);
  tap('KeyR');let tk=0;for(;tk<600&&!(pad.u.track?.radar&&pad.autoAim);tk++)step(fdt());
  for(let t=0;t<1.5;){const d=fdt();step(d);t+=d;}  // settle
  const ts=[],ay=[],ap=[],ly=[],lp=[],ve=[],aa=[],an=[];let t=0;
  for(;t<3;){const d=fdt();step(d);t+=d;if(!pad.autoAim||!pad.lead)continue;ts.push(t);ay.push(pad.autoAim.yaw);ap.push(pad.autoAim.pitch);
    const L=pad.lead.dir;ly.push(Math.atan2(L[0],L[2]));lp.push(Math.asin(L[1]));
    const tr=pad.u.track;if(tr){const tv=[b.plane.cur[7],b.plane.cur[8],b.plane.cur[9]],s=Math.hypot(...tv),uu=tv.map(v=>v/s),dtt=G.time-tr.t,A=tr.acc||[0,0,0],ev=tr.v.map((v,k)=>v+A[k]*dtt);ve.push(Math.hypot(...ev.map((v,k)=>v-tv[k])));const at=A[0]*uu[0]+A[1]*uu[1]+A[2]*uu[2];aa.push(at);an.push(Math.hypot(...A.map((v,k)=>v-at*uu[k])));}}
  // unwrap yaw
  const un=(a)=>{for(let i=1;i<a.length;i++)while(a[i]-a[i-1]>Math.PI)a[i]-=2*Math.PI,0;for(let i=1;i<a.length;i++)while(a[i]-a[i-1]<-Math.PI)a[i]+=2*Math.PI;return a;};
  out[name]={lockS:+(tk/60).toFixed(2),frames:ts.length,aimYaw:fit(ts,un(ay)),aimPitch:fit(ts,ap),leadYaw:fit(ts,un(ly)),leadPitch:fit(ts,lp),velErr:{rms:+Math.sqrt(ve.reduce((s,v)=>s+v*v,0)/ve.length).toFixed(2)},accAlong:{mean:+(aa.reduce((s,v)=>s+v,0)/aa.length).toFixed(2),rms:+Math.sqrt(aa.reduce((s,v)=>s+v*v,0)/aa.length).toFixed(2)},accAcross:{rms:+Math.sqrt(an.reduce((s,v)=>s+v*v,0)/an.length).toFixed(2)},rangeM:Math.round(Math.hypot(b.plane.position[0]-h.x,b.plane.position[2]-h.z))};
}
clearInterval(keepOne);x.airBots.pending=false;
return out;
