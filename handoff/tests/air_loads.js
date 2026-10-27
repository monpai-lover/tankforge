// Loads (追加規格七～八): release programs (a pair at once, a salvo of four), emergency jettison (twice,
// inert), an asymmetric load held by the ailerons (the moment of its weight), the mass after each change.
const tf=window.__tf,x=window.__tfx,G=tf.G,out={};
const next=()=>new Promise(r=>setTimeout(r,0));
await tf.coreReady();await x.flightCoreP;tf.pause(true);G.airDefenceOn=false;tf.finishThumbs();
const live=(fn)=>{const p=G.paused;G.paused=false;try{fn();}finally{G.paused=p;}};
const key=(code,type,o={})=>live(()=>window.dispatchEvent(new KeyboardEvent(type,{code,bubbles:true,...o})));
const tap=(code,o={})=>{key(code,'keydown',o);key(code,'keyup',o);};
async function board(id,lo){
  if(G.air?.active)x.exitAircraft(true);
  G.airLoadout[id]=lo;document.querySelector(`.hangar-card[data-air=${id}]`).click();
  for(let i=0;i<120&&!(G.air?.active&&G.air.plane.type.id===id);i++){tf.advance(1/60,[],false);await next();}
  const air=G.air;air.plane.spawn(0,2500,0,0,180,false);x.applyStoreLoad(air);air.plane.state.throttle=0.8;tf.advance(0.2,[],false);return air;
}
const bombsLeft=(air,id)=>air.stores.items.filter(it=>it.id===id&&!it.gone).length;
// ---- release programs: the A-10A's Mk 82s (loadout 2: 1 + 3 + 3 + 1 Mk 82, 2 Mk 84)
{
  const air=await board('a10a',2),ctl=x.airCtl(air);
  for(let k=0;k<10&&air.stores.groups[air.stores.sel]!=='mk82';k++)tap('KeyY');
  const n0=bombsLeft(air,'mk82'),progs=[];
  const press=()=>{tap('Space');tf.advance(0.05,[],false);};
  // single
  press();tf.advance(1,[],false);const a=bombsLeft(air,'mk82');progs.push(['single',n0-a]);
  // pair
  x.airCtl(air);air.stores.program={bomb:'pair'};press();tf.advance(1,[],false);const b=bombsLeft(air,'mk82');progs.push(['pair',a-b]);
  // salvo of four
  air.stores.program={bomb:'s4'};press();tf.advance(2,[],false);const c=bombsLeft(air,'mk82');progs.push(['salvo4',b-c]);
  out.programs=progs;
  // jettison: once asks, twice drops everything (inert)
  const m0=x.airMass(air),enemy0=G.enemies.map(e=>tf.enemyCombat(G.enemies.indexOf(e))?.caps?.destroyed);
  live(()=>{});const j=(()=>{for(const a2 of [1,2]){}})();
  x.airCtl(air);const act=(n)=>live(()=>{window.dispatchEvent(new KeyboardEvent('keydown',{code:'F7',bubbles:true}));});
  // through the bar's tile (no default key): click twice
  G.airHudTick=0;tf.advance(1/60,[],true);
  const tile=()=>document.querySelector('#air-hud .air-bar [data-act=jettison]');
  live(()=>tile().click());const afterOne=air.stores.items.filter(it=>!it.gone).length;
  live(()=>tile().click());const afterTwo=air.stores.items.filter(it=>!it.gone).length;
  tf.advance(30,[],false);
  out.jettison={beforeMassKg:Math.round(m0),afterOneClick:afterOne,afterTwoClicks:afterTwo,massKg:Math.round(x.airMass(air)),inertLanded:(G.airJettison||[]).length===0,enemiesKilledByJettison:G.enemies.filter((e,i)=>tf.enemyCombat(i)?.caps?.destroyed&&!enemy0[i]).length};
}
// ---- an asymmetric load: the Su-25 with only its left pylons loaded, flown level by the instructor
{
  const res={};
  for(const [tag,pick] of [['symmetric',{p3:'fab500',p8:'fab500',p4:'fab500',p7:'fab500'}],['leftOnly',{p2:'fab250',p3:'fab500',p4:'fab500',p5:'fab500'}]]){
    G.airCustom.su25=pick;const lo=4;const air=await board('su25',lo),P=air.plane;
    let roll=0,bank=0,n=0;
    for(let k=0;k<12*60;k++){P.aim=[0,0,1];tf.advance(1/60,[],false);if(k>6*60){roll+=P.cur[25];const q=P.cur;bank+=Math.atan2(2*(q[6]*q[5]+q[3]*q[4]),1-2*(q[3]**2+q[5]**2))*57.3;n++;}}
    res[tag]={stores:air.stores.items.map(i=>`${i.id}@p${i.pylonN}`),lever:air.storeLever.map(v=>Math.round(v)),meanAileron:+(roll/n).toFixed(3),meanBankDeg:+(bank/n).toFixed(1)};
  }
  out.asym=res;
}
return out;
