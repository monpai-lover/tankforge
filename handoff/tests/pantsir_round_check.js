// The Pantsir's guns as fired against what the radar lead assumes: each fired round's muzzle speed, the
// shell it is, its origin against the lead's origin, and its direction against the lead's (mrad), with the
// track locked on a crossing aircraft.
const tf=window.__tf,x=window.__tfx,G=tf.G,out={};
const next=()=>new Promise(r=>setTimeout(r,0));
await tf.coreReady();await x.flightCoreP;tf.finishThumbs();
tf.select(window.__VEH||'ru_pantsir_sm_sv');tf.startBattle();tf.pause(true);G.airDefenceOn=false;
const live=(fn)=>{const p=G.paused;G.paused=false;try{fn();}finally{G.paused=p;}};
const tap=(code)=>{live(()=>window.dispatchEvent(new KeyboardEvent('keydown',{code,bubbles:true})));live(()=>window.dispatchEvent(new KeyboardEvent('keyup',{code,bubbles:true})));};
for(let i=0;i<30;i++)tf.advance(1/60,[],false);
const pad=G.pad;while(x.airBots.list.length)x.airBots.list.pop();
G.airBotsOn=true;await x.spawnBot();for(let i=0;i<60&&!x.airBots.list.length;i++)await next();
const b=x.airBots.list[0];G.airBotsOn=false;x.airBots.list.splice(0,x.airBots.list.length,b);const keep=setInterval(()=>{x.airBots.pending=true;},0);
for(const g of b.guns)g.ammo=0;if(b.stores)for(const it of b.stores.items||[])it.gone=true;
const h=G.s;b.plane.spawn(h.x-2500,600,h.z+2200,Math.PI/2,170,false);b.plane.state.throttle=0.7;
const fixed=[1,0,0];Object.defineProperty(b.plane,'aim',{get:()=>fixed,set:()=>{},configurable:true});
for(let i=0;i<120&&!pad.contacts.length;i++)tf.advance(1/60,[],false);
G.cam.yaw=Math.atan2(b.plane.position[0]-h.x,b.plane.position[2]-h.z);tf.advance(1/60,[],false);
tap('KeyR');for(let k=0;k<480&&!(pad.u.track?.radar&&pad.autoAim);k++)tf.advance(1/60,[],false);
tf.advance(2,[],false);
const seen=new Set(G.shots),rec=[];G.fireHeld=true;
for(let f=0;f<24;f++){tf.advance(1/60,[],false);const L=pad.lead;for(const q of G.shots){if(seen.has(q))continue;seen.add(q);if(q.from!=null)continue;
  const v0=q.s.vel.map((v,k)=>v+(k===1?9.80665*q.age:0));const ang2=(a,c)=>Math.acos(Math.max(-1,Math.min(1,(a[0]*c[0]+a[1]*c[1]+a[2]*c[2])/Math.hypot(...a)/Math.hypot(...c))))*1000;
  const yaw=(d)=>Math.atan2(d[0],d[2]),pit=(d)=>Math.asin(d[1]/Math.hypot(...d));
  rec.push({age:+q.age.toFixed(3),v0:Math.round(Math.hypot(...v0)),offMrad:+ang2(v0,L.dir).toFixed(1),dYaw:+((yaw(v0)-yaw(L.dir))*1000).toFixed(1),dPitch:+((pit(v0)-pit(L.dir))*1000).toFixed(1),gunYawErr:+((G.T[0].yaw+G.s.heading-yaw(L.dir))*1000).toFixed(1)});}}
G.fireHeld=false;out.fired=rec.slice(0,12);out.mean={dYaw:+(rec.reduce((s,r)=>s+r.dYaw,0)/rec.length).toFixed(1),dPitch:+(rec.reduce((s,r)=>s+r.dPitch,0)/rec.length).toFixed(1),n:rec.length};
const mine=[];
const L=pad.lead;const ang=(a,c)=>Math.acos(Math.max(-1,Math.min(1,(a[0]*c[0]+a[1]*c[1]+a[2]*c[2])/Math.hypot(...a)/Math.hypot(...c))))*1000;
out.lead={from:L.from.map(v=>+v.toFixed(2)),tof:+L.tof.toFixed(2)};
out.rounds=mine.slice(0,8).map(q=>({shell:q.shell?.id,v:+Math.hypot(...q.s.vel).toFixed(0),mv:q.shell?.muzzle_velocity_ms,mass:q.shell?.mass_kg,cd:q.shell?.drag_coefficient,cal:q.shell?.caliber_mm,origin:q.origin.map((v,k)=>+(v-L.from[k]).toFixed(2)),dirFromLeadMrad:+ang(q.s.vel,L.dir).toFixed(1),age:+q.age.toFixed(3)}));
out.leadRound=(()=>{const t0=G.loadout.turrets[0],g0=t0.guns[0];const r=(g0.ammo.find(a=>a.shell.explosive_mass_kg>0)||g0.ammo[0]).shell;return {id:r.id,mv:r.muzzle_velocity_ms,mass:r.mass_kg,cd:r.drag_coefficient,cal:r.caliber_mm};})();
out.guns=G.loadout.turrets[0].guns.map(g=>({id:g.def.id,shell:g.shell?.id,mv:g.def.muzzle_velocity_ms}));
clearInterval(keep);x.airBots.pending=false;
return out;
