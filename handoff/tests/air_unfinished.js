// The unfinished features finished: fuel (drop tanks first, the warnings, a flameout), cluster bombs
// (opening, the bomblets on a vehicle), the F-4E's GBU-12 on its Pave Spike spot, the ALQ-131 against
// the Kub's search, the SPPU-22 firing, CCRP's automatic release, engines stopped and started, the
// split airbrakes, the bar's tooltips, the Pantsir-S1 (its missiles, then its guns).
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
// ---- fuel: the A-10A's drop tanks burned first, the internal next, the warnings, the flameout
{
  const air=await board('su25',4),P=air.plane;P.spawn(0,2500,0,0,180,false);x.applyStoreLoad(air);P.state.throttle=1;
  for(let k=0;k<60;k++){P.aim=[0,0,1];tf.advance(1/60,[],false);}
  const tanks=()=>air.stores.items.filter(it=>it.def.kind==='tank').map(it=>Math.round(it.fuel??it.def.fuel));
  const f0={internal:Math.round(air.fuel.kg),tanks:tanks(),mass:Math.round(x.airMass(air)),flowKgS:+air.fuel.flow.toFixed(2)};
  for(let k=0;k<30*60;k++){P.aim=[0,0,1];tf.advance(1/60,[],false);}
  const f1={internal:Math.round(air.fuel.kg),tanks:tanks(),mass:Math.round(x.airMass(air))};
  // drained: the tanks empty, the internal down to 25% then on to nothing
  for(const it of air.stores.items)if(it.def.kind==='tank')it.fuel=0;
  air.fuel.kg=air.fuel.max*0.21;calls.length=0;
  let low=null,bingo=null,out0=null;
  for(let k=0;k<240*60&&!out0;k++){P.aim=[0,0.02,1];air.fuel.kg-=air.fuel.max*0.0005;tf.advance(1/60,[],false);if(low==null&&air.fuel.low)low=k;if(bingo==null&&air.fuel.bingo)bingo=k;if(P.fuelOut)out0=k;}
  tf.advance(3,[],false);
  out.fuel={start:f0,after30s:f1,tanksFirst:f1.internal===f0.internal&&f1.tanks.some((v,i)=>v<f0.tanks[i]),lowWarned:low!=null,bingoWarned:bingo!=null,voices:Object.keys(x.airCtl(air).voiceSaid||{}),cues:['air_vws_rita_fuel_low','air_vws_rita_bingo'].filter(c=>x.sound.full?.bank?.cues?.[c]),flameout:!!P.fuelOut,thrustAfter:+(P.cur[27]||0).toFixed(3),hud:document.querySelector('#air-hud')?.textContent.match(/FUEL[^A-Z]{0,20}/)?.[0]||null,restart:(x.airCtl(air),null)};
}
// ---- cluster bombs: the A-10A's CBU-87 over a range vehicle
{
  const air=await board('a10a',5),P=air.plane;sel(air,'cbu87');
  const e=ground().at(-1),E=e.veh.body.origin(),s0=state(e);
  P.spawn(E[0],E[1]+900,E[2]-2600,0,170,false);x.applyStoreLoad(air);P.state.throttle=0.75;
  for(let k=0;k<30;k++){P.aim=[0,0,1];tf.advance(1/60,[],false);}
  // shift so that the impact point is on the target
  const at=air.impact?.at,dz=at?E[2]-at[2]:0,dx=at?E[0]-at[0]:0;
  P.spawn(E[0]+dx,E[1]+900,E[2]-2600+dz,0,170,false);x.applyStoreLoad(air);
  for(let k=0;k<30;k++){P.aim=[0,0,1];tf.advance(1/60,[],false);}
  const at2=air.impact?.at;
  const n0=G.airOrdnance.length;tap('Space');tf.advance(0.1,[],false);
  const main=G.airOrdnance.find(o=>o.def.cluster&&o.owner==='player');let opened=null,subs=0,openAgl=null;
  const lastAt=new Map();for(let k=0;k<30*60;k++){P.aim=[0,0.05,1];tf.advance(1/60,[],false);const sb=G.airOrdnance.filter(o=>o.sub);for(const o of sb)lastAt.set(o,o.pos.slice());if(sb.length&&opened==null){opened=+(k/60).toFixed(1);subs=sb.length;openAgl=Math.round(sb[0].pos[1]-E[1]);}if(opened!=null&&!G.airOrdnance.some(o=>o.sub))break;}
  tf.advance(2,[],false);
  const ds=[...lastAt.values()].map(p=>Math.hypot(p[0]-E[0],p[2]-E[2])).sort((a,b)=>a-b),cx=[...lastAt.values()].reduce((a,p)=>[a[0]+p[0]/lastAt.size,a[1]+p[2]/lastAt.size],[0,0]);
  out.cluster={landM:{min:Math.round(ds[0]),median:Math.round(ds[ds.length>>1]),max:Math.round(ds.at(-1)),within10:ds.filter(d=>d<10).length,centreMissM:Math.round(Math.hypot(cx[0]-E[0],cx[1]-E[2]))},impactMissM:at2&&Math.round(Math.hypot(at2[0]-E[0],at2[2]-E[2])),released:!!main,def:main?.def.name,openedAfterS:opened,openAglM:openAgl,bomblets:subs,target:e.name,before:s0,after:state(e),lastHit:G.lastHit&&{result:G.lastHit.result,title:G.lastHit.title}};
}
// ---- a BLU-97 bomblet straight onto a vehicle's roof: its shaped charge (one bomblet, four points)
{
  const e=ground().at(-1),E=e.veh.body.origin(),res=[];
  for(const [dx,dz] of [[0,0],[0.5,1],[-0.4,-1.5]]){
    G.lastHit=null;x.airOrdnance.push({def:x.AIR_STORE_DEFS.blu97,kind:'bomb',pos:[E[0]+dx,E[1]+60,E[2]+dz],vel:[0,-60,0],dir:[0,-1,0],t:1,owner:'player',shooter:{name:'test'},smoke:0,seq:'blu'+dx,sub:true});
    for(let k=0;k<180;k++)tf.advance(1/60,[],false);
    res.push({at:[dx,dz],hit:G.lastHit&&G.lastHit.title,state:state(e)});
  }
  out.bomblet={target:e.name,res};
}
// ---- the F-4E's GBU-12: the Pave Spike's point on a vehicle, released short, guided onto it
{
  const air=await board('f4e',5),P=air.plane,ctl=x.airCtl(air);sel(air,'gbu12');
  const e=ground().at(-2)||ground().at(-1),E=e.veh.body.origin(),s0=state(e);
  P.spawn(E[0]+150,E[1]+3000,E[2]-5000,0,200,false);x.applyStoreLoad(air);P.state.throttle=0.75;
  for(let k=0;k<30;k++){P.aim=[0,0,1];tf.advance(1/60,[],false);}
  let v=0;while(ctl.view!=='pod'&&v++<5)tap('KeyV');
  const pod=x.airPod(air),pm=P.worldPoint(pod.mount);pod.dir=nrm([E[0]-pm[0],E[1]+1-pm[1],E[2]-pm[2]]);
  tap('Space');for(let k=0;k<60;k++){P.aim=[0,0,1];tf.advance(1/60,[],false);}
  const podState=pod.state;
  // released at about 3.5 km short (a toss of the computed fall), guided by the spot
  for(let k=0;k<20*60&&Math.hypot(P.position[0]-E[0],P.position[2]-E[2])>3300;k++){P.aim=[0,0,1];tf.advance(1/60,[],false);}
  rmb();tf.advance(0.3,[],false);const relReason=ctl.reason;
  const b=G.airOrdnance.find(o=>o.owner==='player'&&o.def===x.AIR_STORE_DEFS.gbu12);const ph=b?.guide?.phase;let end=null,worst={destroyed:false};
  const trace=[];for(let k=0;k<60*60&&b&&G.airOrdnance.includes(b);k++){P.aim=[0,0,1];tf.advance(1/60,[],false);if(k%60===0)trace.push([k/60,Math.round(b.pos[1]-E[1]),Math.round(Math.hypot(b.pos[0]-E[0],b.pos[2]-E[2])),!!b.guide?.est]);end=Math.hypot(b.pos[0]-E[0],b.pos[2]-E[2]);}
  for(let k=0;k<60;k++){tf.advance(1/60,[],false);const sx=state(e);worst.destroyed||=sx.destroyed||!sx.alive;}
  out.lgb={relReason,laser:!!pod.cfg.laser,view:ctl.view,pod:pod.cfg.name,podState,released:!!b,phase:ph,trace:trace.slice(-6),endMissM:end&&+end.toFixed(1),target:e.name,before:s0,after:state(e),worst};
  // the pod's black-and-white picture left on the canvas after leaving the aircraft (user report)
  tf.advance(1/60,[],true);await frames(1);const inPod=canvas.style.filter;x.exitAircraft(true);for(let k=0;k<3;k++){tf.advance(1/60,[],true);await frames(1);}
  out.podFilter={inPod,afterExit:canvas.style.filter,mode:G.mode};
}
// ---- the ALQ-131 against the Kub's search: how close the 1S91 first finds the A-10A, jammer on / off
{
  G.airDefenceOn=true;const R=G.enemies.find(e=>e.adSam?.role==='kubRadar'),res={};
  for(const on of [false,true]){
    const air=await board('a10a',5),P=air.plane;for(const e of G.enemies)if(e.adSam||x.adUnitOf(e))x.adReset(e);
    air.ecmOff=!on;const h=Math.atan2(R.x,R.z);P.spawn(R.x-Math.sin(h)*26000,2500,R.z-Math.cos(h)*26000,h,200,false);x.applyStoreLoad(air);P.state.throttle=0.9;
    let found=null,track=null;
    for(let k=0;k<120*60&&!track;k++){P.aim=[Math.sin(h),0,Math.cos(h)];tf.advance(1/60,[],false);const u=x.adUnitOf(R),d=Math.round(Math.hypot(P.position[0]-R.x,P.position[2]-R.z));if(found==null&&u.search)found=d;if(u.track)track=d;}
    res[on?'ecmOn':'ecmOff']={searchFoundAtM:found,trackAtM:track};
  }
  G.airHudTick=0;tf.advance(1/60,[],true);const tile=document.querySelector('#air-hud .air-bar [data-act=ecm]');
  out.ecm={...res,tile:!!tile,tip:tile?.dataset.tip||null};
  G.airDefenceOn=false;
}
// ---- the Su-25's SPPU-22 gun pods: added to the guns, firing, the rounds going
{
  const air=await board('su25',4),P=air.plane;P.spawn(0,1500,0,0,180,false);x.applyStoreLoad(air);P.state.throttle=0.7;
  for(let k=0;k<30;k++){P.aim=[0,0,1];tf.advance(1/60,[],false);}
  const pods=air.guns.filter(g=>g.podItem),a0=pods.map(g=>g.ammo);
  air.fireCannon=true;for(let k=0;k<60;k++){P.aim=[0,0,1];tf.advance(1/60,[],false);}air.fireCannon=false;
  out.sppu22={pods:pods.length,ids:pods.map(g=>g.id),roundsFired:pods.map((g,i)=>a0[i]-g.ammo),mainGun:air.guns.filter(g=>!g.podItem).map(g=>g.id)};
}
// ---- CCRP: the F-4E's Mk 82s, the target marked, Space held, released by the computer
{
  const air=await board('f4e',2),P=air.plane,ctl=x.airCtl(air);sel(air,'mk82');
  const e=ground().at(-1),E=e.veh.body.origin();
  // marked level, the impact point placed on it; then flown level from far out
  P.spawn(E[0],E[1]+1200,E[2]-6000,0,200,false);x.applyStoreLoad(air);P.state.throttle=0.75;
  for(let k=0;k<20;k++){P.aim=[0,0,1];tf.advance(1/60,[],false);}
  let at=air.impact?.at;const dz=at?E[2]-at[2]:0,dx=at?E[0]-at[0]:0;
  P.spawn(E[0]+dx,E[1]+1200,E[2]-6000+dz,0,200,false);x.applyStoreLoad(air);
  for(let k=0;k<20;k++){P.aim=[0,0,1];tf.advance(1/60,[],false);}
  const tile0=document.querySelector('#air-hud .air-bar [data-act=ccrp]');
  live(()=>{G.airHudTick=0;});tf.advance(1/60,[],true);
  const tile=document.querySelector('#air-hud .air-bar [data-act=ccrp]');tile&&live(()=>tile.click());
  const mark=air.ccrp&&air.ccrp.p.slice();
  P.spawn(E[0]+dx,E[1]+1200,E[2]-9000,0,200,false);x.applyStoreLoad(air);P.state.throttle=0.75;
  for(let k=0;k<20;k++){P.aim=[0,0,1];tf.advance(1/60,[],false);}
  key('Space','keydown');const n0=air.stores.items.filter(it=>it.id==='mk82'&&!it.gone).length;let rel=null,cueAt=null;
  for(let k=0;k<60*60&&rel==null;k++){P.aim=[0,0,1];tf.advance(1/60,[],false);const c=air.ccrp&&x.airCtl(air)&&air.impact;if(air.stores.items.filter(it=>it.id==='mk82'&&!it.gone).length<n0){rel=+(k/60).toFixed(1);cueAt=Math.round(Math.hypot(P.position[0]-E[0],P.position[2]-E[2]));}}
  key('Space','keyup');
  const b=G.airOrdnance.find(o=>o.owner==='player'&&o.def===x.AIR_STORE_DEFS.mk82);let land=null;
  for(let k=0;k<30*60&&b&&G.airOrdnance.includes(b);k++){P.aim=[0,0,1];tf.advance(1/60,[],false);land=[b.pos[0],b.pos[2]];}
  out.ccrp={tileBefore:!!tile0,tile:!!tile,marked:!!mark,markMissM:mark&&Math.round(Math.hypot(mark[0]-E[0],mark[2]-E[2])),releasedAfterS:rel,releasedAtRangeM:cueAt,bombLandMissM:land&&Math.round(Math.hypot(land[0]-(mark?.[0]??E[0]),land[1]-(mark?.[2]??E[2]))),ccrpAfter:!!air.ccrp,reason:ctl.reason};
}
// ---- engines: stopped (the thrust gone, the sound), started (the spool-up, the thrust back)
{
  const air=await board('f15c',0),P=air.plane;P.spawn(0,3000,0,0,250,false);P.state.throttle=0.9;calls.length=0;
  for(let k=0;k<120;k++){P.aim=[0,0,1];tf.advance(1/60,[],false);}
  const e0=+(P.cur[27]||0).toFixed(3);
  G.airHudTick=0;tf.advance(1/60,[],true);const tile=()=>document.querySelector('#air-hud .air-bar [data-act=engine]');
  live(()=>tile().click());for(let k=0;k<5*60;k++){P.aim=[0,0,1];tf.advance(1/60,[],false);}
  const off={engine:+(P.cur[27]||0).toFixed(3),kmh:Math.round(P.cur[14]*3.6),tile:tile()?.textContent.trim()};
  live(()=>tile().click());const t0=G.time;let back=null;const spool=[];
  for(let k=0;k<20*60&&back==null;k++){P.aim=[0,0,1];tf.advance(1/60,[],false);if(k%120===0)spool.push(+(P.engineSpool??1).toFixed(2));if(P.engineStart==null&&P.cur[27]>0.5)back=+(G.time-t0).toFixed(1);}
  out.engine={running:e0,off,startedAfterS:back,spool,cues:[...new Set(calls.filter(c=>/air_(start|stop)/.test(c)))]};
}
// ---- the split airbrakes: B opens the plates, released they close
{
  const air=await board('a10a',0),P=air.plane;P.spawn(0,1500,0,0,160,false);P.state.throttle=0.5;tf.advance(0.3,[],false);
  const plates=()=>P.controls.filter(c=>c.type==='airbrake');
  tap('KeyB');for(let k=0;k<90;k++){P.aim=[0,0,1];tf.advance(1/60,[],true);}
  const open=+(P.brakeK||0).toFixed(2),ang=plates().map(c=>+(c.sign*c.open*(P.brakeK||0)*57.3).toFixed(1));
  G.camOverride={pivot:P.drawPos.slice(),dist:24,fov:0.7};G.cam.yaw=P.heading+2.4;G.cam.pitch=-0.25;await frames(3);await pyShot('a10_airbrake');G.camOverride=null;
  tap('KeyB');for(let k=0;k<120;k++){P.aim=[0,0,1];tf.advance(1/60,[],true);}
  out.airbrake={plates:plates().length,openK:open,anglesDeg:ang.slice(0,4),closedK:+(P.brakeK||0).toFixed(2)};
}
// ---- the bar's tooltips: every tile has one; hovering shows it
{
  const air=G.air;G.airHudTick=0;tf.advance(1/60,[],true);await frames(2);
  const tiles=[...document.querySelectorAll('#air-hud .air-bar [data-act], #air-hud .air-bar [data-grp]')];
  const missing=tiles.filter(t=>!t.dataset.tip).map(t=>t.dataset.act||t.dataset.grp);
  const t=tiles.find(q=>q.dataset.act==='map');t?.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));await frames(2);
  const tip=document.querySelector('.air-tip');
  out.tooltips={tiles:tiles.length,missing,shown:tip&&!tip.hidden&&getComputedStyle(tip).display!=='none',text:tip?.textContent||null};
  await pyShot('bar_tooltip');
  t?.dispatchEvent(new MouseEvent('mouseout',{bubbles:true}));
}
// ---- the Pantsir-S1: its search, a command-guided missile far out, its guns inside 4 km
{
  G.airDefenceOn=true;const S=G.enemies.find(e=>e.adSam?.role==='pantsir');
  if(!S)out.pantsir={missing:true};
  else{
    const air=await board('f4e',1),P=air.plane;for(const e of G.enemies)if(x.adUnitOf(e))x.adReset(e);
    const h=Math.atan2(S.x,S.z);P.spawn(S.x-Math.sin(h)*20000,1500,S.z-Math.cos(h)*20000,h,230,false);P.state.throttle=0.8;
    const u=()=>x.adUnitOf(S),log=[];let m=null,gunShots=0,firstGunM=null,states=[];
    for(let k=0;k<80*60&&!P.crashed&&!x.airDown(P);k++){
      P.aim=[Math.sin(h),0,Math.cos(h)];tf.advance(1/60,[],false);
      const d=Math.round(Math.hypot(P.position[0]-S.x,P.position[2]-S.z));
      if(states.at(-1)?.split('@')[0]!==u().state)states.push(u().state+'@'+d);
      if(!m)m=G.airOrdnance.find(o=>o.owner==='ground'&&o.unit===S);
      const gs=G.shots.filter(s=>String(s.from).startsWith('ad:')).length;if(gs&&firstGunM==null)firstGunM=d;gunShots=Math.max(gunShots,gs);
      if(k%120===0)log.push({s:k/60,km:+(d/1e3).toFixed(1),track:u().track?(u().track.radar?'radar':'eo'):null,state:u().state,missile:m&&G.airOrdnance.includes(m)?m.guide.phase:null});
      if(d<1500)break;
    }
    out.pantsir={name:S.adSam.cfg.name,rails:S.adSam.rails.length,states:states.slice(0,14),log:log.slice(0,25),missile:m&&{def:m.def.name,phase:m.guide.phase,why:m.guide.why||null},firstGunShotAtM:firstGunM,gunRoundsLeft:u().gunRounds,playerHurt:P.damage.parts.filter(q=>q.hp<q.max).length,down:x.airDown(P),emitters:(G.adEmitters||[]).filter(e=>e.e===S).map(e=>e.level)};
    {
      const air2=await board('a10a',0),P2=air2.plane;for(const e of G.enemies)if(x.adUnitOf(e))x.adReset(e);
      for(const r of S.adSam.rails){r.loaded=false;r.node.visible=false;}
      P2.spawn(S.x-Math.sin(h)*5500,800,S.z-Math.cos(h)*5500,h,170,false);P2.state.throttle=0.6;
      let first=null,maxShots=0;const st=[];
      for(let k=0;k<40*60&&!P2.crashed&&!x.airDown(P2);k++){P2.aim=[Math.sin(h),0.03,Math.cos(h)];tf.advance(1/60,[],false);const d=Math.round(Math.hypot(P2.position[0]-S.x,P2.position[2]-S.z));if(st.at(-1)?.split('@')[0]!==u().state)st.push(u().state+'@'+d);const gs=G.shots.filter(s=>String(s.from).startsWith('ad:')).length;if(gs&&first==null)first=d;maxShots=Math.max(maxShots,gs);if(d<600)break;}
      out.pantsirGuns={states:st.slice(0,12),firstShotAtM:first,inAir:maxShots,roundsUsed:1400-(u().gunRounds??1400),playerHurt:P2.damage.parts.filter(q=>q.hp<q.max).length,down:x.airDown(P2)};
    }
    G.camOverride={pivot:[S.x,S.veh.body.origin()[1]+2,S.z],dist:14,fov:0.7};G.cam.yaw=S.heading+2.2;G.cam.pitch=-0.25;tf.advance(1/60,[],true);await frames(3);await pyShot('pantsir');G.camOverride=null;
  }
  G.airDefenceOn=false;
}
return out;
