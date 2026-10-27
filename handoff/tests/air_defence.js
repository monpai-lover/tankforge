// Ground air defence (追加規格 二～五): the Kub battery (1S91 search -> track -> a 3M9 launched by a
// 2P25 on its track, the warning receiver hearing each), chaff against its radar, its radar destroyed
// with a missile in the air; the Chaparral from behind (its seeker's tone, an infrared launch, the
// approach warner); the Gepard's radar shot out (the optical backup); the optical gun at dusk; pictures.
const tf=window.__tf,x=window.__tfx,G=tf.G,out={};
const next=()=>new Promise(r=>setTimeout(r,0)),frames=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
await tf.coreReady();await x.flightCoreP;tf.pause(true);tf.finishThumbs();tf.setQuality('low');
const live=(fn)=>{const p=G.paused;G.paused=false;try{fn();}finally{G.paused=p;}};
const tap=(code,o={})=>live(()=>{window.dispatchEvent(new KeyboardEvent('keydown',{code,bubbles:true,...o}));window.dispatchEvent(new KeyboardEvent('keyup',{code,bubbles:true,...o}));});
const full=x.sound.full,calls=[];const play=full.play.bind(full);full.play=(cue,o,loop)=>{calls.push(cue);return play(cue,o,loop);};
async function board(id,lo=1){
  if(G.air?.active)x.exitAircraft(true);
  G.airLoadout[id]=lo;document.querySelector(`.hangar-card[data-air=${id}]`).click();
  for(let i=0;i<120&&!(G.air?.active&&G.air.plane.type.id===id);i++){tf.advance(1/60,[],false);await next();}
  return G.air;
}
const unit=(role)=>G.enemies.find(e=>e.adSam?.role===role);
await board('f15c',1);
const units=G.enemies.map(e=>({id:e.id,role:e.adSam?.role||null,name:e.name,ad:!!x.adUnitOf?.(e)}));out.units=units.filter(u=>u.ad);
G.airBotsOn=false;
// ---- the Kub: fly at it at 1.5 km
const R=unit('kubRadar'),L=unit('kubLauncher');
{
  const air=await board('f15c',1),P=air.plane;
  const dx=R.x-0,dz=R.z-0,h=Math.atan2(dx,dz),d=Math.hypot(dx,dz);
  P.spawn(R.x-Math.sin(h)*16000,1500,R.z-Math.cos(h)*16000,h,230,false);P.state.throttle=0.8;calls.length=0;
  const log=[],t={};let m=null;
  for(let i=0;i<40*60&&!P.crashed;i++){
    const f=[Math.sin(h),0,Math.cos(h)];P.aim=f;tf.advance(1/60,[],false);
    const ru=x.adUnitOf(R),lu=x.adUnitOf(L),em=(G.adEmitters||[]).map(e=>e.level).join(',');
    for(const c of calls)if(t[c]==null&&/rwr|vws|missile_warn|missile_launch/.test(c))t[c]=+(i/60).toFixed(1);
    if(i%60===0)log.push({s:i/60,km:+(Math.hypot(P.position[0]-R.x,P.position[2]-R.z)/1e3).toFixed(1),search:!!ru.search,track:!!ru.track,launcher:lu.state,emit:em});
    if(!m)m=G.airOrdnance.find(o=>o.owner==='ground');
    if(m&&i%30===0)log.push({s:i/60,missile:m.guide.phase});
    if(m&&!G.airOrdnance.includes(m))break;
  }
  out.kub={log:log.slice(0,40),firstHeard:t,missile:m&&{def:m.def.name,phase:m.guide.phase,why:m.guide.why||null},playerDamaged:P.damage.parts.filter(q=>q.hp<q.max).length,down:x.airDown(P)};
}
// ---- the Kub's radar destroyed while its missile flies: the missile loses its support
{
  const air=await board('f15c',1),P=air.plane;
  for(const e of [R,L])x.adReset(e);
  const h=Math.atan2(R.x,R.z);P.spawn(R.x-Math.sin(h)*14000,1500,R.z-Math.cos(h)*14000,h,230,false);P.state.throttle=0.8;
  let m=null;for(let i=0;i<30*60&&!m;i++){P.aim=[Math.sin(h),0,Math.cos(h)];tf.advance(1/60,[],false);m=G.airOrdnance.find(o=>o.owner==='ground'&&o.def.guidance==='sarh');}
  const before=m?.guide.phase;x.adUnitOf(R).radarHp=0;
  for(let i=0;i<4*60&&m&&G.airOrdnance.includes(m);i++){P.aim=[Math.sin(h+1.2),0,Math.cos(h+1.2)];tf.advance(1/60,[],false);}
  out.kubRadarKilled={launched:!!m,phaseBefore:before,phaseAfter:m?.guide.phase,why:m?.guide.why||null,launcher:x.adUnitOf(L).state,launcherWhy:x.adUnitOf(L).why};
}
// ---- chaff against the 1S91's track (the dice forced to succeed)
{
  const air=await board('f15c',1),P=air.plane;for(const e of [R,L])x.adReset(e);
  const h=Math.atan2(R.x,R.z);P.spawn(R.x-Math.sin(h)*15000,1500,R.z-Math.cos(h)*15000,h,230,false);
  for(let i=0;i<8*60&&!x.adUnitOf(R).track;i++){P.aim=[Math.sin(h),0,Math.cos(h)];tf.advance(1/60,[],false);}
  const had=!!x.adUnitOf(R).track;const rnd=Math.random;Math.random=()=>0;x.airCtl(air).cm.program='chaff';tap('KeyT');tf.advance(0.2,[],false);Math.random=rnd;
  const onChaff=!!x.adUnitOf(R).track?.chaff;tf.advance(5,[],false);
  out.chaff={hadTrack:had,trackOnChaff:onChaff,afterwards:x.adUnitOf(R).track?(x.adUnitOf(R).track.chaff?'chaff':'reacquired'):'lost'};
}
// ---- the Chaparral from behind at 1 km altitude, 3 km out, flying away
{
  const C=unit('chaparral'),air=await board('nf02',1),P=air.plane;x.adReset(C);
  const h=Math.atan2(-C.x,-C.z);P.spawn(C.x+Math.sin(h)*2200,900,C.z+Math.cos(h)*2200,h,200,false);P.state.throttle=0.6;calls.length=0;
  const st=[];let m=null;
  for(let i=0;i<25*60&&!m;i++){P.aim=[Math.sin(h),0,Math.cos(h)];tf.advance(1/60,[],false);const u=x.adUnitOf(C);if(st.at(-1)!==u.state)st.push(u.state);m=G.airOrdnance.find(o=>o.owner==='ground'&&o.def.guidance==='ir');}
  const mlog=[];for(let i=0;i<8*60&&m&&G.airOrdnance.includes(m);i++){P.aim=[Math.sin(h),0,Math.cos(h)];tf.advance(1/60,[],false);if(i%30===0){const l=P.position.map((v,k)=>v-m.pos[k]),d=Math.hypot(...l),vl=Math.hypot(...m.vel);mlog.push([+(i/60).toFixed(1),Math.round(d),Math.round(Math.acos((l[0]*m.vel[0]+l[1]*m.vel[1]+l[2]*m.vel[2])/(d*vl))*57.3),m.guide.phase,(x.airCtl(air).threat?.maws||[]).length]);}}
  out.chaparral={mlog,states:st,launched:m&&m.def.name,rails:C.adSam.rails.filter(r=>r.loaded).length,maws:[...new Set(calls.filter(c=>/missile_warn|vws/.test(c)))],rwrHeardIr:(x.airCtl(air).threat?.rwr||[]).length};
}
// ---- the Gepard: its radar track, then its radar shot out (the optical backup)
{
  const Gp=G.enemies.find(e=>e.id==='de_gepard'),air=await board('f4e',0),P=air.plane;x.adReset(Gp);
  const h=Math.atan2(Gp.x,Gp.z);P.spawn(Gp.x-Math.sin(h)*5000,800,Gp.z-Math.cos(h)*5000,h,200,false);
  for(let i=0;i<6*60;i++){P.aim=[Math.sin(h),0,Math.cos(h)];tf.advance(1/60,[],false);}
  const u=x.adUnitOf(Gp),radar=!!u.track?.radar,shots0=G.shots.filter(s=>String(s.from).startsWith('aa:')).length;
  u.radarHp=0;u.track=null;for(let i=0;i<5*60;i++){P.aim=[Math.sin(h),0,Math.cos(h)];tf.advance(1/60,[],false);}
  out.gepard={radarTrack:radar,afterRadarKilled:u.track?(u.track.radar?'radar':'optical'):'none',emitters:(G.adEmitters||[]).filter(e=>e.e===Gp).map(e=>e.level)};
}
// ---- the optical Flakpanzer at dusk: its eye's reach shortened
{
  const F=G.enemies.find(e=>e.id==='de_flakpz38t'),air=await board('f4e',0),P=air.plane;x.adReset(F);
  const t0=tf.renderer.timeIndex;while(x.daylight())live(()=>{tf.advance(1/60,[],true);document.querySelector('#air-hud .air-bar [data-act=time]')?.click();});
  const h=Math.atan2(F.x,F.z);P.spawn(F.x-Math.sin(h)*4200,600,F.z-Math.cos(h)*4200,h,130,false);P.state.throttle=0.5;
  let seen=null;for(let i=0;i<24*60;i++){P.aim=[Math.sin(h),0,Math.cos(h)];tf.advance(1/60,[],false);if(x.adUnitOf(F).track&&seen==null)seen=+(Math.hypot(P.position[0]-F.x,P.position[2]-F.z)/1e3).toFixed(2);}
  out.flakDusk={firstSeenKm:seen,reachKm:2.7};
  for(let k=0;k<8&&tf.renderer.timeIndex!==t0;k++)live(()=>{tf.advance(1/60,[],true);document.querySelector('#air-hud .air-bar [data-act=time]')?.click();});
}
// ---- pictures of the SAM units
document.querySelectorAll('#air-hud, #toast, .toast').forEach(el=>el.style.visibility='hidden');
for(const role of ['chaparral','kubLauncher','kubRadar']){
  const e=unit(role),o=e.veh.body.origin();
  G.camOverride={pivot:[o[0],o[1]+1.5,o[2]],dist:13,fov:0.8};G.cam.yaw=e.heading+2.3;G.cam.pitch=-0.25;
  x.exitAircraft(true);tf.advance(1/60,[],true);await frames();await pyShot('sam_'+role);
}
G.camOverride=null;
return out;
