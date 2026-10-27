// User requests: the Gepard had no radar (a bug), its search radar should turn, and a radar lock should
// lay the guns on the aircraft with the radar's lead (the view following), the mouse fine-laying, the
// guns firing on that lead. The player's Gepard on the range, an enemy aircraft passing 2.5 km out:
// the radar mode, the antenna's turning, R's lock, the guns' error from the lead, a mouse nudge held as
// an offset, the 35 mm rounds fired and what they did.
const tf=window.__tf,x=window.__tfx,G=tf.G,out={};
const next=()=>new Promise(r=>setTimeout(r,0));
await tf.coreReady();await x.flightCoreP;tf.finishThumbs();
if(window.__GAINS)G.leadGains=window.__GAINS;tf.select(window.__VEH||'de_gepard');tf.startBattle();tf.pause(true);G.airDefenceOn=false;
const live=(fn)=>{const p=G.paused;G.paused=false;try{fn();}finally{G.paused=p;}};
const tap=(code)=>{live(()=>window.dispatchEvent(new KeyboardEvent('keydown',{code,bubbles:true})));live(()=>window.dispatchEvent(new KeyboardEvent('keyup',{code,bubbles:true})));};
for(let i=0;i<30;i++)tf.advance(1/60,[],false);
const pad=G.pad,sp=G.model.spinners||[];
out.mode={pad:!!pad,role:pad?.role,radar:!!pad?.cfg?.search,name:pad?.cfg?.name,spinners:sp.map(s=>s.name)};
const y0=sp[0]?.node.yaw;tf.advance(0.5,[],false);out.antennaTurnedDeg=sp[0]?Math.round(((sp[0].node.yaw-y0)*57.3+720)%360):null;
while(x.airBots.list.length)x.airBots.list.pop();
G.airBotsOn=true;await x.spawnBot();for(let i=0;i<60&&!x.airBots.list.length;i++)await next();
const b=x.airBots.list[0];if(!b)return{...out,error:'no bot'};G.airBotsOn=false;x.airBots.list.splice(0,x.airBots.list.length,b);const keepOne=setInterval(()=>{x.airBots.pending=true;},0);x.airBots.pending=true;
const h=G.s;b.plane.spawn(h.x-(window.__DX||2500),window.__ALT||600,h.z+(window.__DZ||2200),Math.PI/2,170,false);b.plane.state.throttle=0.7;
// unarmed (its fire on the Gepard is ad_bot_hits_player.js's)
for(const g of b.guns)g.ammo=0;if(b.stores)for(const it of b.stores.items||[])it.gone=true;
const fixed=[1,0,0];Object.defineProperty(b.plane,'aim',{get:()=>fixed,set:()=>{},configurable:true});
for(let i=0;i<120&&!pad.contacts.length;i++)tf.advance(1/60,[],false);
out.contacts=pad.contacts.length;
G.cam.yaw=Math.atan2(b.plane.position[0]-h.x,b.plane.position[2]-h.z);tf.advance(1/60,[],false);
tap('KeyR');let tk=0;for(;tk<480&&!(pad.u.track?.radar&&pad.autoAim);tk++)tf.advance(1/60,[],false);
out.lock={afterS:+(tk/60).toFixed(1),locked:!!pad.lock,track:pad.u.track?.radar?'radar':pad.u.track?'other':null,autoAim:!!pad.autoAim,reason:pad.reason};
// the guns laid on the lead: the gun line's angle from the lead after 2 s
const angle=(a,c)=>Math.acos(Math.max(-1,Math.min(1,a[0]*c[0]+a[1]*c[1]+a[2]*c[2])))*1000;
out.gunFromLeadMrad=[];const dirs=[],aims=[];for(let i=0;i<180;i++){tf.advance(1/60,[],false);if(pad.lead)dirs.push(pad.lead.dir.slice());if(pad.autoAim)aims.push([Math.sin(pad.autoAim.yaw)*Math.cos(pad.autoAim.pitch),Math.sin(pad.autoAim.pitch),Math.cos(pad.autoAim.yaw)*Math.cos(pad.autoAim.pitch)]);if(i%30===29)out.gunFromLeadMrad.push(pad.lead?+angle(pad.dir,pad.lead.dir).toFixed(1):null);}
// the lead's jitter: the frame-to-frame change of its angular step (a steady crossing turns it evenly)
const jit=(dirs)=>{const step=[];for(let k=1;k<dirs.length;k++)step.push(dirs[k].map((v,j)=>v-dirs[k-1][j]));const acc=[];for(let k=1;k<step.length;k++)acc.push(Math.hypot(...step[k].map((v,j)=>v-step[k-1][j]))*1000);
 acc.sort((p,q)=>p-q);return {rms:+Math.sqrt(acc.reduce((s2,v)=>s2+v*v,0)/(acc.length||1)).toFixed(2),p95:+(acc[Math.floor(acc.length*0.95)]||0).toFixed(2)};};out.leadJitterMrad=jit(dirs);out.aimJitterMrad=jit(aims);
out.turretDegS=x.data?.vehicles?.de_gepard?.vehicle?.turret?.traverse_deg_s??null;
// a mouse nudge of 0.02 rad: kept as the offset
G.cam.yaw+=0.02;tf.advance(1/60,[],false);out.offsetYaw=pad.autoAim?+pad.autoAim.off.yaw.toFixed(3):null;
G.cam.yaw-=0.02;tf.advance(1/60,[],false);
const D=b.plane.damage,hp0=D.parts.reduce((s,p)=>s+p.hp,0);let near=0;const seen=new Set();
let minMiss=1e9;const fired=new Set(),last=new Map(),closest=new Map(),offs=new Map();let tp0=b.plane.position.slice();G.fireHeld=true;
// fire 2 s, then follow the rounds 5 s more (a 30 mm round takes ~4 s to 2.4 km)
for(let i=0;i<420;i++){if(i===120)G.fireHeld=false;tf.advance(1/60,[],false);const tp=b.plane.position,tm=tp.map((v,k)=>(v+tp0[k])/2);
  for(const q of G.shots){if(q.from!=null)continue;fired.add(q);const p1=q.s.pos.slice(),p0=last.get(q)||p1;last.set(q,p1);
    const d=p1.map((v,k)=>v-p0[k]),dd=d[0]*d[0]+d[1]*d[1]+d[2]*d[2]||1,u=Math.max(0,Math.min(1,((tm[0]-p0[0])*d[0]+(tm[1]-p0[1])*d[1]+(tm[2]-p0[2])*d[2])/dd)),m=Math.hypot(...p0.map((v,k)=>v+d[k]*u-tm[k]));
    if(m<(closest.get(q)??1e9)){const vv=[b.plane.cur[7],b.plane.cur[8],b.plane.cur[9]],vl=Math.hypot(...vv)||1,rel=p0.map((v,k)=>v+d[k]*u-tm[k]);offs.set(q,[(rel[0]*vv[0]+rel[1]*vv[1]+rel[2]*vv[2])/vl,rel[1]]);}closest.set(q,Math.min(closest.get(q)??1e9,m));if(m<minMiss)minMiss=m;if(!seen.has(q)&&m<15){seen.add(q);near++;}}
  tp0=tp.slice();if(b.down||b.plane.crashed)break;}
const cl=[...closest.values()].sort((p,q)=>p-q);out.closestApproachM=cl.slice(0,12).map(v=>+v.toFixed(1));{const near=[...closest.entries()].filter(([,m])=>m<30).map(([q])=>offs.get(q)).filter(Boolean),mean=(k)=>near.reduce((s2,o)=>s2+o[k],0)/(near.length||1),sd=(k)=>Math.sqrt(near.reduce((s2,o)=>s2+(o[k]-mean(k))**2,0)/(near.length||1));out.missAlongTrack={n:near.length,mean:+mean(0).toFixed(1),sd:+sd(0).toFixed(1)};out.missUp={mean:+mean(1).toFixed(1),sd:+sd(1).toFixed(1)};}
G.fireHeld=false;
{const tr=[...fired].map(q=>({age:+(q.age||0).toFixed(2),trav:Math.round(q.travelled||0),from:q.from,shell:q.shell?.id,dist:Math.round(Math.hypot(...q.s.pos.map((v,k)=>v-q.origin[k])))}));tr.sort((a,b)=>b.dist-a.dist);out.shotsFar=tr.slice(0,3);out.shotsNear=tr.slice(-2);out.leadTof=pad.lead?.tof;out.liveShots=G.shots.filter(q=>q.from==null).length;}
out.vehicle={destroyed:!!G.caps?.destroyed,canFire:G.caps?.can_fire??null};out.fire={shellsFired:fired.size,minMissM:+minMiss.toFixed(1),rangeM:Math.round(Math.hypot(...b.plane.position.map((v,k)=>v-[h.x,b.plane.position[1],h.z][k]))),shellsWithin15m:near,hpLost:Math.round(hp0-D.parts.reduce((s,p)=>s+p.hp,0)),summary:D.summary().slice(0,100),down:!!b.down||!!b.plane.crashed};
clearInterval(keepOne);x.airBots.pending=false;
return out;
