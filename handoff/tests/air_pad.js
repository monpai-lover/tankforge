// The player's own missile AA vehicles (user request): the Pantsir-S1 (the user's own vehicle,
// ru_pantsir_sm_sv) and the Chaparral (a variant of the M901 hull), driven into the range, enemy attack aircraft flying runs at them; the
// Pantsir's radar lock (R), a command-guided missile (middle button) and its own cannons on the radar's
// lead (left button); the
// Chaparral's seeker (R), its tone and an infrared launch; pictures of both.
const tf=window.__tf,x=window.__tfx,G=tf.G,out={};
const next=()=>new Promise(r=>setTimeout(r,0)),frames=(n=2)=>new Promise(r=>{let k=0;const f=()=>++k>=n?r():requestAnimationFrame(f);requestAnimationFrame(f);});
await tf.coreReady();await x.flightCoreP;tf.finishThumbs();tf.setQuality('low');
const live=(fn)=>{const p=G.paused;G.paused=false;try{fn();}finally{G.paused=p;}};
const tap=(code)=>live(()=>{window.dispatchEvent(new KeyboardEvent('keydown',{code,bubbles:true}));window.dispatchEvent(new KeyboardEvent('keyup',{code,bubbles:true}));});
const nrm=(a)=>{const l=Math.hypot(...a)||1;return a.map(v=>v/l);};
const say=(k,v)=>console.log('@@'+k+' '+JSON.stringify(v));let stepN=0;const step=()=>tf.advance(1/30,[],(++stepN)%3===0);
const alive=()=>x.airBots.list.filter(b=>!b.gone&&!b.down&&!b.plane.crashed);
/** The camera (and so the crosshair, the turret and the launcher) on a world point. */
const look=(p)=>{const c=G.camPos||[G.s.x,3,G.s.z],d=p.map((v,i)=>v-c[i]);G.cam.yaw=Math.atan2(d[0],d[2]);G.cam.pitch=Math.atan2(d[1],Math.hypot(d[0],d[2]));};
async function drive(id){
  tf.pause(false);tf.select(id);await frames(3);
  const garage={pad:!!G.pad,role:G.pad?.role,rails:G.pad?.sam?.rails.length,name:G.loadout?.name};
  tf.startBattle();await frames(4);tf.pause(true);G.airDefenceOn=false;
  for(const e of G.enemies)e.alive&&e.adSam&&(e.alive=e.alive);
  // the attackers arrive (spawned asynchronously)
  for(let i=0;i<600&&!alive().length;i++){step();await next();}
  return garage;
}
// ---- the Pantsir-S1
{
  const garage=await drive('ru_pantsir_sm_sv');
  const pad=G.pad,r={garage,attackers:alive().map(b=>b.plane.type.name)};
  const dist=(b)=>Math.hypot(b.plane.position[0]-G.s.x,b.plane.position[2]-G.s.z);
  // the radar sees them; R locks the one nearest the launcher's line
  let k=0;for(;k<60*30&&!pad.contacts.length;k++){const b=alive()[0];if(b)look(b.plane.position);step();if(k%10===0)await next();}
  r.contactsAfterS=+(k/30).toFixed(1);r.contacts=pad.contacts.map(c=>Math.round(c.d));
  const tgt=pad.contacts.sort((a,b)=>a.d-b.d)[0]?.b;if(tgt)look(tgt.plane.position);tf.advance(1/30,[],true);
  tap('KeyR');
  let tr=null;for(k=0;k<20*30&&!tr;k++){if(pad.lock)look(pad.lock.plane.position);step();if(x.adUnitOf(pad.pe).track)tr={afterS:+(k/30).toFixed(1),radar:!!x.adUnitOf(pad.pe).track.radar,km:+(dist(pad.lock)/1e3).toFixed(1)};if(k%10===0)await next();}
  r.lock=pad.lock?.plane.type.name||null;r.track=tr;say('lock',{lock:r.lock,track:tr,contacts:r.contacts,after:r.contactsAfterS});r.launcherPitchDeg=+(pad.elev*57.3).toFixed(1);
  // middle button: a missile when it is between 1.5 and 18 km
  let m=null;const log=[];
  for(k=0;k<90*30&&!m;k++){const b=pad.lock;if(b)look(b.plane.position);if(b&&dist(b)<17e3&&dist(b)>1600&&x.adUnitOf(pad.pe).track){G.mgHeld=true;tf.advance(1/30,[],true);G.mgHeld=false;tf.advance(1/30,[],false);m=x.airOrdnance.find(o=>o.site===pad.pe);}else step();if(k%10===0)await next();}
  r.missile=m&&{def:m.def.name,phase:m.guide.phase,launchKm:+(dist(pad.lock)/1e3).toFixed(1)};r.why=pad.reason;say('missile',{m:r.missile,why:r.why});
  const victim=pad.lock;
  for(k=0;k<40*30&&m&&x.airOrdnance.includes(m);k++){if(pad.lock)look(pad.lock.plane.position);step();if(k%15===0){log.push([+(k/30).toFixed(1),Math.round(Math.hypot(...m.pos.map((v,i)=>v-victim.plane.position[i]))),m.guide.phase]);await next();}}
  r.flight=log.slice(-6);say('flight',log.slice(-6));r.result={phase:m?.guide.phase,why:m?.guide.why||null,miss:m?.miss!=null?+m.miss.toFixed(1):null,victimDown:!!(victim&&(victim.down||x.airDown(victim.plane))),victimHurt:victim?victim.plane.damage.parts.filter(q=>q.hp<q.max).length:0};
  G.camOverride=null;tf.advance(1/30,[],true);await frames(2);await pyShot('pantsir_hud');
  // the guns: its own cannons (left button), an attacker inside 4 km, tracked; the lock lays them on the lead
  let gunsFired=0,hit=null;const fired=new Set(),offs=[];
  for(k=0;k<70*30;k++){
    const near=alive().sort((a,b)=>dist(a)-dist(b))[0];
    if(near&&pad.lock!==near&&dist(near)<9e3){look(near.plane.position);tf.advance(1/30,[],true);pad.lock=null;tap('KeyR');}
    if(pad.lead&&near&&dist(near)<3800){const off=Math.acos(Math.max(-1,Math.min(1,pad.dir.reduce((q,v,i)=>q+v*pad.lead.dir[i],0))))*57.3;G.fireHeld=off<1;offs.push(+off.toFixed(1));}else{if(near&&!pad.autoAim)look(near.plane.position);G.fireHeld=false;}
    step();for(const q of G.shots)if(q.from==null)fired.add(q);
    if(near&&(near.hit||near.down)){hit={type:near.plane.type.name,down:!!near.down,km:+(dist(near)/1e3).toFixed(1)};}
    if(fired.size>300||hit?.down)break;
    if(k%10===0)await next();
  }
  G.fireHeld=false;r.guns={roundsFired:fired.size,hit,laidOffDeg:offs.filter((v,i)=>i%30===0).slice(0,20)};
  out.pantsir=r;say('pantsir',r);
}
// ---- the Chaparral
{
  const garage=await drive('ad_chaparral'),pad=G.pad,r={toneWhenHeard:null,garage,attackers:alive().map(b=>b.plane.type.name)};
  const dist=(b)=>Math.hypot(b.plane.position[0]-G.s.x,b.plane.position[2]-G.s.z);
  tap('KeyR');r.seekerOn=pad.seeker;
  // laid on an attacker going away (its tail): the seeker hears it, the tone, the launch
  let m=null,heard=null,k=0;const states=[];
  for(;k<90*30&&!m;k++){
    const b=alive().sort((a,c)=>dist(a)-dist(c))[0];
    if(b)look(b.plane.position);
    step();
    if(states.at(-1)!==pad.seeker)states.push(pad.seeker);
    if(pad.hears&&!heard)heard={afterS:+(k/30).toFixed(1),km:+(dist(pad.hears)/1e3).toFixed(1),type:pad.hears.plane.type.name};
    if(pad.hears){r.toneWhenHeard=!!G.airTone?.air_seeker_lock;G.fireHeld=true;tf.advance(1/30,[],true);G.fireHeld=false;m=x.airOrdnance.find(o=>o.site===pad.pe);}
    if(k%10===0)await next();
  }
  r.states=states;r.heard=heard;say('chap',{states,heard,m:!!m});r.tone=!!G.airTone?.air_seeker_lock||!!G.airTone?.air_seeker_search;
  r.missile=m&&{def:m.def.name,phase:m.guide.phase};
  const victim=m&&m.guide.target?.bot;
  for(k=0;k<30*30&&m&&x.airOrdnance.includes(m);k++){if(victim)look(victim.plane.position);step();if(k%15===0)await next();}
  for(k=0;k<90;k++)step();
  r.result=m&&{phase:m.guide.phase,why:m.guide.why||null,miss:m.miss!=null?+m.miss.toFixed(1):null,victimDown:!!(victim&&(victim.down||x.airDown(victim.plane))),victimHurt:victim?victim.plane.damage.parts.filter(q=>q.hp<q.max).length:0};
  r.railsLeft=pad.sam.rails.filter(q=>q.loaded).length;r.reserve=pad.sam.reserve;
  tf.advance(1/30,[],true);await frames(2);await pyShot('chaparral_hud');
  out.chaparral=r;
}
// ---- the garage card: the variants on their hull's card
tf.pause(false);
out.variants={pantsir:!!x.data.vehicles.ru_pantsir_sm_sv,chaparral:!!x.data.vehicles.ad_chaparral,order:x.data.order.filter(i=>/ad_|m901|bmp_k64/.test(i))};
return out;
