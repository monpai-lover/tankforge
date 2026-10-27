// The Pantsir's 57E6 (command guidance on the player's tracking radar) against one attacker, several
// shots: a straight flier and one that evades; per shot the closest pass, the miss the fuse saw, the
// track's error near the end and whether chaff took the track.
const tf=window.__tf,x=window.__tfx,G=tf.G,out={};
const next=()=>new Promise(r=>setTimeout(r,0));
await tf.coreReady();await x.flightCoreP;tf.finishThumbs();
for(let i=0;i<200&&!G.combat?.surfaceCore;i++)await new Promise(r=>setTimeout(r,50));
tf.select('ru_pantsir_sm_sv');for(let i=0;i<20;i++)await next();
const M=G.model;
out.garage={id:G.id,model:!!M,spinners:(M?.spinners||[]).map(s=>s.name),turrets:M?.turrets?.length,nodes:M?.shellNodes?.length};
out.core={surfaceCore:!!G.combat.surfaceCore,onSurfaceCore:G.combat.coreOf('ru_pantsir_sm_sv')===G.combat.surfaceCore,info:x.data.surfaceCoreInfo?.sha256?.slice(0,12)};
// battle: the AA mode
tf.startBattle();tf.pause(true);G.airDefenceOn=false;
for(let i=0;i<30;i++)tf.advance(1/60,[],false);
const pad=G.pad;
out.ad={pad:!!pad,role:pad?.role,ownGuns:!!pad?.cfg?.ownGuns,missile:pad?.def?.name,rails:pad?.sam?.rails?.length,radar:!!pad?.cfg?.search};
const sp=G.model.spinners?.[0],y0=sp?.node.yaw;tf.advance(0.5,[],false);out.antennaTurnedDeg=sp?Math.round((((sp.node.yaw-y0)*57.3)%360+360)%360):null;
while(x.airBots.list.length)x.airBots.list.pop();
G.airBotsOn=true;await x.spawnBot();for(let i=0;i<60&&!x.airBots.list.length;i++)await next();
const b=x.airBots.list[0];G.airBotsOn=false;x.airBots.list.splice(0,x.airBots.list.length,b);const keep=setInterval(()=>{x.airBots.pending=true;},0);
for(const g of b.guns)g.ammo=0;if(b.stores)for(const it of b.stores.items||[])it.gone=true;
const h=G.s;b.plane.spawn(h.x-3000,700,h.z+4000,Math.PI/2,170,false);b.plane.state.throttle=0.7;

for(let i=0;i<180&&!pad.contacts.length;i++)tf.advance(1/60,[],false);
out.contacts=pad.contacts.length;
G.cam.yaw=Math.atan2(b.plane.position[0]-h.x,b.plane.position[2]-h.z);tf.advance(1/60,[],false);
const live=(fn)=>{const p=G.paused;G.paused=false;try{fn();}finally{G.paused=p;}};
const tap=(code)=>{live(()=>window.dispatchEvent(new KeyboardEvent('keydown',{code,bubbles:true})));live(()=>window.dispatchEvent(new KeyboardEvent('keyup',{code,bubbles:true})));};
tap('KeyR');let tk=0;for(;tk<480&&!(pad.u.track?.radar&&pad.autoAim);tk++)tf.advance(1/60,[],false);
out.lock={afterS:+(tk/60).toFixed(1),track:pad.u.track?.radar?'radar':null,autoAim:!!pad.autoAim};
for(let i=0;i<90;i++)tf.advance(1/60,[],false);
// the cannons on the left button (laid at the sky ahead), before the missile shots
{
  const T=G.loadout.turrets.map((t,ti)=>t.guns.map((g,gi)=>({ti,gi,id:g.def.id,missile:!!g.def.missile,trigger:g.def.trigger||null,ac:!!g.def.autocannon,loaded:g.loaded,ammo:(g.ammo||[]).map(a=>a.count),state:G.T[ti].loading.state[gi]})));
  const n0=new Set(G.shots);G.cam.pitch=0.3;G.fireHeld=true;const pend=[];for(let i=0;i<60;i++){tf.advance(1/60,[],false);if(i<5)pend.push(G.pending.length);}G.fireHeld=false;
  out.caps={weapons:G.caps?.weapons===undefined?'(none)':Object.fromEntries(Object.entries(G.caps.weapons||{}).map(([k,v])=>[k,v?.can_fire])),keys:G.loadout.turrets[0].guns.map(g=>g.damageKey),capsKeys:Object.keys(G.caps||{}),onSurface:G.combat.coreOf(G.id)===G.combat.surfaceCore,ids:[...(G.combat.surfaceIds||[])]};
  out.gunProbe={weaponControl:G.weaponControl,sightT:G.sightT,guns:T.flat(),fired:G.shots.filter(q=>!n0.has(q)&&q.from==null).length,pending:pend,stateAfter:G.T.map(t=>t.loading.state),yawErr:G.T[0].yawErr,pitchErr:G.T[0].guns.map(g=>g.pitchErr)};
}
const shots=[];
const liveBot=async()=>{let c=x.airBots.list.find(q=>!q.gone&&!q.down&&!q.plane.crashed);if(c)return c;
  while(x.airBots.list.length)x.airBots.list.pop();G.airBotsOn=true;x.airBots.pending=false;await x.spawnBot();for(let i=0;i<60&&!x.airBots.list.length;i++)await next();G.airBotsOn=false;
  c=x.airBots.list[0];x.airBots.list.splice(0,x.airBots.list.length,c);for(const g of c.guns)g.ammo=0;if(c.stores)for(const it of c.stores.items||[])it.gone=true;return c;};
for(const mode of ['straight','straight','straight','evade','evade','evade','evade']){
  const bb=await liveBot(),bp=bb.plane;
  // the attacker re-placed 5-9 km out, flying across
  const r=5000+Math.random()*4000,az=Math.random()*6.28;bp.spawn(h.x+Math.sin(az)*r,600+Math.random()*1500,h.z+Math.cos(az)*r,az+Math.PI/2,220,false);bp.state.throttle=0.9;
  if(mode==='straight'){const f=[Math.cos(az),0,-Math.sin(az)];Object.defineProperty(bp,'aim',{get:()=>f,set:()=>{},configurable:true});}else delete bp.aim;
  pad.u.track=null;pad.lock=null;for(let i=0;i<120;i++)tf.advance(1/60,[],false);
  G.cam.yaw=Math.atan2(bp.position[0]-h.x,bp.position[2]-h.z);tf.advance(1/60,[],false);
  tap('KeyR');let tk=0;for(;tk<600&&!(pad.u.track?.radar);tk++)tf.advance(1/60,[],false);
  for(let i=0;i<60;i++)tf.advance(1/60,[],false);
  const n0=x.airOrdnance.length;G.mgHeld=true;tf.advance(1/60,[],false);G.mgHeld=false;tf.advance(1/60,[],false);
  const m=x.airOrdnance.slice(n0).find(o=>o.owner==='player');
  if(!m){shots.push({mode,why:pad.reason,track:!!pad.u.track});continue;}
  let best=1e9,bestT=0,trk=[],chaff=false,sp=[],end=null;const km=+(Math.hypot(bp.position[0]-h.x,bp.position[2]-h.z)/1e3).toFixed(1);
  for(let i=0;i<60*26;i++){
    tf.advance(1/60,[],false);
    if(!x.airOrdnance.includes(m)){end={s:+(i/60).toFixed(1),miss:m.miss!=null?+m.miss.toFixed(1):null,phase:m.guide.phase,why:m.guide.why||null};break;}
    const d=Math.hypot(...m.pos.map((v,k)=>v-bp.position[k]));if(d<best){best=d;bestT=i/60;}
    const tr=pad.u.track;if(tr?.chaff)chaff=true;
    if(tr&&d<1500)trk.push(Math.hypot(...tr.p.map((v,k)=>v+tr.v[k]*(G.time-tr.t)-bp.position[k])));
    if(i%60===0)sp.push(Math.round(Math.hypot(...m.vel)));
  }
  trk.sort((a,c)=>a-c);
  shots.push({mode,type:bp.type.name,km,closest:+best.toFixed(1),atS:+bestT.toFixed(1),end,down:!!bb.down||!!bp.crashed||x.airDown(bp),trackErrMed:trk.length?+trk[trk.length>>1].toFixed(1):null,trackErrMax:trk.length?+trk.at(-1).toFixed(1):null,chaff,speeds:sp,tgtSpeed:Math.round(Math.hypot(bp.cur[7],bp.cur[8],bp.cur[9]))});
}
out.shots=shots;
clearInterval(keep);x.airBots.pending=false;
return out;
