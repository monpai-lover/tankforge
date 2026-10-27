// The cockpit's warnings by equipment (user request: OPEX's own alarms, a voice for pull up, a missile
// launch, a radar lock and scan), recorded as the cues the game asks to play (no audio context in the
// headless browser): an NF-02 (warning receiver, approach warner, the voice) met head-on by an enemy
// that locks and fires a radar missile; diving at the ground in a MiG-29 (voice), an F-4E (beep) and a
// P-51D (nothing); the angle-of-attack warner; then the fixed sight vs the computing pipper.
const tf=window.__tf,x=window.__tfx,G=tf.G,out={};
const next=()=>new Promise(r=>setTimeout(r,0)),frames=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
await tf.coreReady();await x.flightCoreP;tf.pause(true);G.airDefenceOn=false;tf.finishThumbs();
const full=x.sound.full,calls=[];const play=full.play.bind(full);full.play=(cue,o,loop)=>{calls.push(cue);return play(cue,o,loop);};
const heard=(f)=>[...new Set(calls.filter(c=>f.test(c)))];
async function board(id,lo=1){
  if(G.air?.active)x.exitAircraft(true);
  G.airLoadout[id]=lo;document.querySelector(`.hangar-card[data-air=${id}]`).click();
  for(let i=0;i<120&&!(G.air?.active&&G.air.plane.type.id===id);i++){tf.advance(1/60,[],false);await next();}
  return G.air;
}
// ---- locked and fired at
{
  // an F-15C (its enemies are the MiG-29 / Su-27 class): the warning receiver and the voice
  const air=await board('f15c'),P=air.plane;P.spawn(0,3500,0,0,240,false);x.applyStoreLoad(air);P.state.throttle=0.9;
  // an enemy with a radar and radar missiles (the bots' types are drawn at random)
  let b=null;
  for(let k=0;k<12&&!b;k++){G.airBots.list=[];G.airBotsOn=true;for(let i=0;i<900&&!G.airBots.list.length;i++){tf.advance(1/60,[],false);await next();}G.airBotsOn=false;
    const c=G.airBots.list[0];if(c&&['su27','mig29','f15c','f4e'].includes(c.plane.type.id)&&c.stores?.items.some(it=>it.def.guidance==='sarh'))b=c;else if(c)c.gone=true;}
  G.airBots.list=[b];out.enemy=b.plane.type.id;
  b.plane.spawn(0,3600,9000,Math.PI,250,false);b.missileAt=0;b.flares=b.chaff=0;
  calls.length=0;const t={};
  for(let i=0;i<20*60;i++){P.aim=[0,0,1];tf.advance(1/60,[],false);for(const c of calls)if(t[c]==null)t[c]=+(i/60).toFixed(1);}
  out.threat={firstHeardS:Object.fromEntries(Object.entries(t).filter(([c])=>/rwr|missile_warn|vws/.test(c))),rwr:(air.ctl.threat?.rwr||[]).map(r=>r.level)};
}
// ---- an infrared missile from behind at the NF-02 (the approach warner and the voice with the direction)
{
  const air=await board('nf02'),P=air.plane;P.spawn(0,3500,0,0,240,false);x.applyStoreLoad(air);P.state.throttle=0.9;
  let b=null;
  for(let k=0;k<12&&!b;k++){G.airBots.list=[];G.airBotsOn=true;for(let i=0;i<900&&!G.airBots.list.length;i++){tf.advance(1/60,[],false);await next();}G.airBotsOn=false;
    const c=G.airBots.list[0];if(c?.stores?.items.some(it=>it.def.guidance==='ir'))b=c;else if(c)c.gone=true;}
  G.airBots.list=[b];
  const it=b.stores.items.find(i=>i.def.guidance==='ir');for(const i of b.stores.items)if(i!==it)i.gone=true;
  b.plane.spawn(0,3500,-950,0,245,false);b.missileAt=0;b.flares=b.chaff=0;calls.length=0;const t={};
  let m=null,mt=null,minAng=99;for(let i=0;i<16*60;i++){P.aim=[0,0,1];tf.advance(1/60,[],false);for(const c of calls)if(t[c]==null)t[c]=+(i/60).toFixed(1);const o=G.airOrdnance.find(o=>o.owner==='bot');if(o&&!m){m=o;mt=i/60;}if(m&&G.airOrdnance.includes(m)){const l=P.position.map((v,k)=>v-m.pos[k]),d=Math.hypot(...l),vl=Math.hypot(...m.vel);minAng=Math.min(minAng,Math.acos((l[0]*m.vel[0]+l[1]*m.vel[1]+l[2]*m.vel[2])/(d*vl))*57.3);}}
  out.mawsMissile={launchedS:mt,def:m?.def.name,minAngleDeg:+minAng.toFixed(1),eq:x.airCtl(air).eq.maws};
  out.maws={enemy:b.plane.type.id,firstHeardS:Object.fromEntries(Object.entries(t).filter(([c])=>/rwr|missile_warn|vws/.test(c)))};
}
// ---- the ground coming up
for(const id of ['mig29','f4e','p51d']){
  const air=await board(id,0),P=air.plane;P.spawn(0,700,0,0,200,false);P.state.throttle=0.6;calls.length=0;
  for(let i=0;i<8*60&&!P.crashed;i++){P.aim=[0,-0.5,0.87];tf.advance(1/60,[],false);}
  out['dive_'+id]={warnings:heard(/vws|alt_low|aoa/),crashed:P.crashed};
}
// ---- the angle-of-attack warner: slow, pulling up hard
for(const id of ['f4e','mig29','p51d']){
  const air=await board(id,0),P=air.plane;P.spawn(0,3000,0,0,90,false);P.state.throttle=0.1;calls.length=0;let amax=0;
  for(let i=0;i<6*60;i++){P.keys.add('KeyS');amax=Math.max(amax,P.hudState().aoa);tf.advance(1/60,[],false);}P.keys.delete('KeyS');
  out['aoa_'+id]={warnings:heard(/aoa|critical_angle/),aoaMaxDeg:+amax.toFixed(1),stallDeg:+(P.type.airframe[10]*57.3).toFixed(1)};
}
// ---- the sights: a P-51D (fixed reflector sight) and an F-86F (computing pipper)
document.querySelectorAll('#toast, .toast').forEach(el=>el.style.visibility='hidden');
for(const id of ['p51d','f86f']){
  const air=await board(id,0),P=air.plane;P.spawn(0,2500,0,0,200,false);G.airHelp=false;
  for(let i=0;i<30;i++){P.aim=[0,0,1];tf.advance(1/60,[],false);}
  G.airHudTick=0;tf.advance(1/60,[],true);await frames();await pyShot('sight_'+id);
  out['sight_'+id]={pipperShown:!document.querySelector('#air-hud .air-pipper').hidden,lcos:!!x.airCtl(air).eq.lcos};
}
return out;
