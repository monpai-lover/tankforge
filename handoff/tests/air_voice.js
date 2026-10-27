// User reports: the NR-30 silent and its 130 rounds; the voice warnings on every jet by nation (Betty
// in English on the Western ones and the NF-02, Rita on the Soviet ones; no Chinese voice), which calls each has in the data, and an
// F-15C's low-fuel call heard in English.
const tf=window.__tf,x=window.__tfx,G=tf.G,out={};
const next=()=>new Promise(r=>setTimeout(r,0)),frames=(n=2)=>new Promise(r=>{let k=0;const f=()=>++k>=n?r():requestAnimationFrame(f);requestAnimationFrame(f);});
await tf.coreReady();await x.flightCoreP;tf.pause(true);G.airDefenceOn=false;G.airBotsOn=false;tf.finishThumbs();tf.setQuality('low');
const live=(fn)=>{const p=G.paused;G.paused=false;try{fn();}finally{G.paused=p;}};
const key=(code,type,o={})=>live(()=>window.dispatchEvent(new KeyboardEvent(type,{code,bubbles:true,...o})));
const tap=(code,o={})=>{key(code,'keydown',o);key(code,'keyup',o);};
const canvas=[...document.querySelectorAll('canvas')].filter(c=>!c.closest('#air-hud')).sort((a,b)=>b.width*b.height-a.width*a.height)[0];
const rmb=()=>live(()=>{canvas.dispatchEvent(new MouseEvent('mousedown',{button:2,bubbles:true}));canvas.dispatchEvent(new MouseEvent('mouseup',{button:2,bubbles:true}));});
const nrm=(a)=>{const l=Math.hypot(...a)||1;return a.map(v=>v/l);};
const full=x.sound.full,calls=[];const play=full.play.bind(full);full.play=(cue,o,loop)=>{calls.push(cue);return play(cue,o,loop);};
async function board(id,lo){
  if(G.air?.active)x.exitAircraft(true);
  G.airLoadout[id]=lo;document.querySelector(`.hangar-card[data-air=${id}]`).click();
  for(let i=0;i<120&&!(G.air?.active&&G.air.plane.type.id===id);i++){tf.advance(1/60,[],false);await next();}
  return G.air;
}
const sel=(air,id)=>{for(let k=0;k<12&&air.stores.groups[air.stores.sel]!==id;k++)tap('KeyY');return air.stores.groups[air.stores.sel]===id;};
const ei=(e)=>G.enemies.indexOf(e),state=(e)=>{const c=tf.enemyCombat(ei(e));return{alive:c.alive,destroyed:!!c.caps?.destroyed,crew:c.caps?.crew_alive??null,canMove:c.caps?.can_move??null};};
const ground=()=>G.enemies.filter(q=>q.alive&&q.veh&&!q.adSam).sort((p,q)=>p.z-q.z);
// ---- the MiG-21's NR-30: 130 rounds, its shots heard (their cues pinned on boarding: a 30-round burst
// used to end before its first cue had decoded)
{
  const air=await board('mig21',0),P=air.plane;P.spawn(0,2000,0,0,220,false);P.state.throttle=0.8;
  for(let k=0;k<30;k++){P.aim=[0,0,1];tf.advance(1/60,[],true);}
  const g=air.guns[0],a0=g.ammo;calls.length=0;
  air.fireCannon=true;for(let k=0;k<120;k++){P.aim=[0,0,1];tf.advance(1/60,[],true);}air.fireCannon=false;
  out.nr30={rounds:a0,fired:a0-g.ammo,shotsHeard:calls.filter(c=>/air_nr30_shot/.test(c)).length,cueInData:!!x.sound.full?.bank?.cues?.air_nr30_shot_1};
}
// ---- the voice warnings by nation: each jet's voice and which of its calls are in the data
{
  const evs=['missile','missile_launch','attack_sam','lock','pull_up','over_g','critical_angle','fire','engine_fire','chaff_flare','check_gear','fuel_low','bingo','ahead','behind','left','right'];
  const cues=x.sound.full?.bank?.cues||{},res={};
  for(const id of ['nf02','f4e','f15c','a10a','f104g','mirage3e','f86f','hunter6','mig15','mig17f','mig21','mig29','su27','su25']){
    const air=await board(id,0),v=x.airCtl(air).eq.vws;
    res[id]={voice:v||null,calls:v?evs.filter(e=>cues[`air_vws_${v}_${e}`]).length+'/'+evs.length:null};
  }
  out.voices=res;
}
// ---- an F-15C's fuel call: Betty's
{
  const air=await board('f15c',0),P=air.plane;P.spawn(0,3000,0,0,240,false);P.state.throttle=0.8;tf.advance(0.5,[],false);
  air.fuel.kg=air.fuel.max*0.19;const before=calls.length;for(let k=0;k<60;k++){P.aim=[0,0,1];tf.advance(1/60,[],false);}
  out.f15cFuelCall={said:Object.keys(x.airCtl(air).voiceSaid||{}),cues:calls.slice(before).filter(c=>/vws/.test(c))};
}
return out;
