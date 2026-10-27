// Mach 2 fighters, gun recoil and loadouts (user request: new Mach 2 aircraft; guns kick when fired;
// bombs, rockets, AGMs, AIM-9 / AIM-7, R-73 / R-60 / R-27 on the fighters). Delivered game + WASM.
const tf=window.__tf,x=window.__tfx,G=tf.G,out={loadouts:{},speed:{},recoil:{}};
const check=(value,message)=>{if(!value)throw Error(message);};
const next=()=>new Promise(resolve=>setTimeout(resolve,0));
await tf.coreReady();await x.flightCoreP;tf.pause(true);G.airDefenceOn=false;tf.finishThumbs();
tf.setQuality('low');tf.renderer.q={...tf.renderer.q,dome:64,cloudSteps:4};tf.renderer._buildDome(64);
const types=[...document.querySelectorAll('.hangar-card')].map(c=>c.dataset.air);
async function board(id,loadout=0){
  if(G.air?.active)x.exitAircraft(true);
  G.airLoadout[id]=loadout;
  document.querySelector(`.hangar-card[data-air=${id}]`).click();
  for(let i=0;i<120&&!(G.air?.active&&G.air.plane.type.id===id);i++){tf.advance(1/60,[],false);await next();}
  check(G.air?.active&&G.air.plane.type.id===id,`${id}: could not board`);
  return G.air;
}
G.airBotsOn=false;
for(const id of types){
  const air=await board(id,0),T=air.plane.type;
  out.loadouts[id]=x.airLoadouts(id).map(lo=>lo[0]);
  // every loadout lays out its stores (finite points, the counts asked for, mass added)
  for(let k=0;k<x.airLoadouts(id).length;k++){
    const st=x.mountStores(air.plane,id,k),want=x.airLoadouts(id)[k][1].reduce((n,[,c])=>n+c,0);
    check(st.items.length===want,`${id} loadout ${k}: ${st.items.length} stores placed, ${want} asked`);
    check(st.items.every(it=>it.p.every(Number.isFinite)),`${id} loadout ${k}: a store point is not finite`);
    // stores below the airframe's centre line and inside the span
    const span=T.fighter?Math.max(...T.fighter.spec.wing.map(w=>w[0])):6;
    check(st.items.every(it=>Math.abs(it.p[0])<=span+0.3&&it.p[1]<0.6),`${id} loadout ${k}: a store is outside the airframe`);
    // no two stores in the same place (their boxes may touch, not overlap)
    for(let i=0;i<st.items.length;i++)for(let j=i+1;j<st.items.length;j++){
      const a=st.items[i],b=st.items[j],r=(a.def.d+b.def.d)/2*0.95,L=(a.def.len+b.def.len)/2*0.95;
      check(!(Math.abs(a.p[0]-b.p[0])<r&&Math.abs(a.p[1]-b.p[1])<r&&Math.abs(a.p[2]-b.p[2])<L),`${id} loadout ${k}: ${a.id} and ${b.id} overlap`);
    }
    air.stores=st;x.applyStoreLoad(air);
    if(k&&want)check(x.airMass(air)>T.airframe[0],`${id} loadout ${k}: no mass added`);
  }
  air.stores=x.mountStores(air.plane,id,0);x.applyStoreLoad(air);
}
// top speed high up, clean, full afterburner: Mach 2 class for the new types
for(const id of ['f4e','f15c','mig29','su27','f104g','mig21']){
  const air=await board(id,0),p=air.plane;
  p.spawn(0,11000,0,0,320,false);x.applyStoreLoad(air);
  p.state.throttle=1.12;p.state.gear=false;p.state.flaps='up';p.aim=[0,0,1];p.aimBias=[0,0,0,1];
  let best=0;
  for(let s=0;s<240;s++){tf.advance(1,[],false);p.aim=[0,0,1];best=Math.max(best,p.cur[13]/340);}
  out.speed[id]={mach:+best.toFixed(2),altitude:Math.round(p.cur[1])};
  check(!p.crashed,`${id}: crashed in the speed run`);
}
for(const id of ['f4e','f15c','mig29','su27'])check(out.speed[id].mach>=1.95,`${id}: only Mach ${out.speed[id].mach}`);
// recoil: the same 3 s of level flight with and without the guns firing
for(const id of ['f104g','f4e','mig29','p51d','mig15']){
  const air=await board(id,0),p=air.plane,run=(fire)=>{
    p.spawn(0,3000,0,0,200,false);air.stores=x.mountStores(p,id,0);x.applyStoreLoad(air);
    for(const g of air.guns){g.ammo=1e4;g.cool=0;g.spin=1;}
    p.state.throttle=0.8;p.aim=[0,0,1];p.aimBias=[0,0,0,1];
    const pitch=[];air.fireAll=fire;
    for(let i=0;i<180;i++){tf.advance(1/60,[],false);p.aim=[0,0,1];pitch.push(p.cur[10]);}
    air.fireAll=false;
    const mean=pitch.reduce((a,b)=>a+b,0)/pitch.length,rms=Math.sqrt(pitch.reduce((a,b)=>a+(b-mean)**2,0)/pitch.length);
    return{speed:p.cur[13],rateRms:rms,recoilN:air.recoilN||0};
  };
  const quiet=run(false),firing=run(true);
  out.recoil[id]={speedLossMs:+(quiet.speed-firing.speed).toFixed(2),pitchRateRmsQuiet:+quiet.rateRms.toFixed(4),pitchRateRmsFiring:+firing.rateRms.toFixed(4),lastFrameImpulseNs:+firing.recoilN.toFixed(0)};
  check(quiet.speed-firing.speed>0.3,`${id}: firing did not slow the aircraft`);
  check(firing.rateRms>quiet.rateRms,`${id}: firing did not shake the aircraft`);
}
return out;
