// Aircraft stores in the delivered game (user request: bombs, rockets, AGMs, AIM-9 / AIM-7, R-73 /
// R-60 / R-27): each released by the game's own trigger path at a range target or an enemy aircraft,
// and what it did measured (the target's combat state, the enemy aircraft's damage).
const tf=window.__tf,x=window.__tfx,G=tf.G,out={};
const check=(value,message)=>{if(!value)throw Error(message);};
const next=()=>new Promise(resolve=>setTimeout(resolve,0));
await tf.coreReady();await x.flightCoreP;tf.pause(true);G.airDefenceOn=false;tf.finishThumbs();
tf.setQuality('low');tf.renderer.q={...tf.renderer.q,dome:64,cloudSteps:4};tf.renderer._buildDome(64);
const bursts=[];const ex=tf.fx.explosion.bind(tf.fx);tf.fx.explosion=(p,d,kg,g)=>{if(kg>20)bursts.push({p:p.slice(),kg});return ex(p,d,kg,g);};
async function board(id,loadout){
  if(G.air?.active)x.exitAircraft(true);
  G.airLoadout[id]=loadout;
  document.querySelector(`.hangar-card[data-air=${id}]`).click();
  for(let i=0;i<120&&!(G.air?.active&&G.air.plane.type.id===id);i++){tf.advance(1/60,[],false);await next();}
  check(G.air?.active&&G.air.plane.type.id===id,`${id}: could not board`);
  return G.air;
}
const select=(air,id)=>{const k=air.stores.groups.indexOf(id);check(k>=0,`no ${id} carried`);air.stores.sel=k;};
// guided weapons through the game's own keys and buttons (one event let through the test's pause)
const live=(fn)=>{const p0=G.paused;G.paused=false;try{fn();}finally{G.paused=p0;}};
const tap=(code,o={})=>live(()=>{window.dispatchEvent(new KeyboardEvent('keydown',{code,bubbles:true,...o}));window.dispatchEvent(new KeyboardEvent('keyup',{code,bubbles:true,...o}));});
const canvas=[...document.querySelectorAll('canvas')].filter(c=>!c.closest('#air-hud')).sort((a,b)=>b.width*b.height-a.width*a.height)[0];
const rmb=()=>live(()=>{canvas.dispatchEvent(new MouseEvent('mousedown',{button:2,bubbles:true}));canvas.dispatchEvent(new MouseEvent('mouseup',{button:2,bubbles:true}));});
const nrm=(a)=>{const l=Math.hypot(...a)||1;return a.map(v=>v/l);};
const step=(n,fn)=>{for(let i=0;i<n;i++){fn?.(i);tf.advance(1/60,[],false);}};
const enemyState=(i)=>{const c=tf.enemyCombat(i);return{alive:c.alive,destroyed:!!c.caps?.destroyed,crew:c.caps?.crew_alive??null,canFire:c.caps?.can_fire??null,canMove:c.caps?.can_move??null};};
// the worst the target came to during the attack (the range revives its targets a few seconds after)
const watch=(i)=>{const w={destroyed:false,crewMin:Infinity,lostFire:false,lostMove:false};return{w,look(){const s=enemyState(i);w.destroyed||=s.destroyed||!s.alive;w.crewMin=Math.min(w.crewMin,s.crew??Infinity);w.lostFire||=s.canFire===false;w.lostMove||=s.canMove===false;}};};
const targets=()=>tf.enemies().map((e,i)=>({...e,i})).filter(e=>e.alive);
const groundY=(x0,z0)=>tf.terrain.height?tf.terrain.height(x0,z0):0;
const aimAt=(p,at)=>{const d=at.map((v,k)=>v-p.position[k]),l=Math.hypot(...d);p.aim=d.map(v=>v/l);p.aimBias=[0,0,0,1];};
G.airBotsOn=false;
// ---- Mk 82 from an F-4E in level flight, released when the computed impact point reaches the target
{
  const air=await board('f4e',2),p=air.plane;select(air,'mk82');
  const e=targets().sort((a,b)=>b.z-a.z)[0],gy=G.enemies[e.i].veh.body.origin()[1];
  p.spawn(e.x,gy+600,e.z-3200,0,210,false);x.applyStoreLoad(air);p.state.throttle=0.85;
  let released=null;const W=watch(e.i);
  step(30*60,(i)=>{p.aim=[0,0,1];W.look();if(!released&&air.impact&&air.impact.at[2]>=e.z-4){air.storeTap=true;released={at:p.position.map(v=>+v.toFixed(0)),predicted:air.impact.at.map(v=>+v.toFixed(1)),fall:+air.impact.t.toFixed(2)};}});
  check(released,'Mk 82: the impact point never reached the target');
  const near=bursts.filter(b=>b.kg>50).map(b=>Math.hypot(b.p[0]-e.x,b.p[2]-e.z));
  out.mk82={released,missM:near.length?+Math.min(...near).toFixed(1):null,target:e.id,effect:W.w};
  check(near.length&&Math.min(...near)<25,`Mk 82 burst ${near} m from the target`);
}
// ---- AGM-65A: lock the target under the aim, fire and forget
{
  const air=await board('f4e',2),p=air.plane;select(air,'agm65a');
  const e=targets().sort((a,b)=>a.z-b.z).at(-1),E=G.enemies[e.i],at=()=>{const o=E.veh.body.origin();return[o[0],o[1]+1,o[2]];};
  p.spawn(e.x+300,at()[1]+900,e.z-5200,0,220,false);x.applyStoreLoad(air);p.state.throttle=0.85;
  const pod=x.airPod(air);check(pod,'F-4E: no pod hung');
  pod.dir=nrm(at().map((v,k)=>v-p.worldPoint(pod.mount)[k]));tap('Space');
  let lockT=null;step(30,()=>aimAt(p,at()));tap('Space');
  step(6*60,(i)=>{aimAt(p,at());const sk=air.ctl.seeker;if(sk.state==='search'&&i%20===0)tap('Space');if(lockT==null&&sk.state==='track')lockT=i/60;});
  check(lockT!=null,`AGM-65: no capture (pod ${pod.state}, seeker ${air.ctl.seeker.state}: ${air.ctl.reason})`);
  rmb();step(2);
  const fired=G.airOrdnance.find(o=>o.def.name.startsWith('AGM'));check(fired&&fired.target,'AGM-65 not launched at the target');
  const W=watch(e.i);G.lastHit=null;
  step(40*60,()=>{p.aim=[0,0,1];W.look();});
  out.agm65={lockSeconds:+lockT.toFixed(2),target:e.id,hit:G.lastHit&&{result:G.lastHit.result,plate:G.lastHit.plate,penMm:Math.round(G.lastHit.pen),title:G.lastHit.title},effect:W.w};
  check(out.agm65.effect.destroyed,'AGM-65 did not destroy the target');
}
// ---- LAU-3/A rockets in a dive
{
  const air=await board('f4e',3),p=air.plane;select(air,'lau3');
  const e=targets().sort((a,b)=>a.z-b.z)[0],E=G.enemies[e.i],at=()=>{const o=E.veh.body.origin();return[o[0],o[1]+1,o[2]];};
  p.spawn(e.x,at()[1]+700,e.z-1900,0,170,false);x.applyStoreLoad(air);p.state.throttle=0.5;
  step(5*60,()=>aimAt(p,at()));
  const W=watch(e.i),ends=[];const push=G.shots.push.bind(G.shots);
  G.shots.push=(sh)=>{if(sh.ownAir&&sh.shell.id==='he_70_m151')ends.push(sh);return push(sh);};
  air.storeHeld=true;step(60,()=>{aimAt(p,at());W.look();});air.storeHeld=false;
  const fired=19*4-air.stores.items.filter(it=>it.id==='lau3').reduce((n,it)=>n+it.count,0);
  step(8*60,()=>{p.aim=[0,0.3,1];W.look();});
  G.shots.push=push;
  const miss=ends.map(sh=>Math.hypot(sh.s.pos[0]-e.x,sh.s.pos[2]-e.z)).sort((a,b)=>a-b);
  out.rockets={fired,landed:ends.length,within15m:miss.filter(m=>m<15).length,medianMissM:miss.length?+miss[miss.length>>1].toFixed(1):null,target:e.id,effect:W.w,altitude:Math.round(p.cur[35])};
  check(ends.length>=fired*0.8&&miss[miss.length>>1]<40,`rockets: ${ends.length} of ${fired} landed, median ${miss[miss.length>>1]} m off`);
  check(fired>=6,`only ${fired} rockets fired`);
}
// ---- air-to-air: an enemy aircraft spawned ahead, tail-on, its flares, chaff and missiles off (the hit itself tested)
async function bot(typeId){
  G.airBotsOn=true;
  for(let i=0;i<600&&!G.airBots.list.length;i++){tf.advance(1/60,[],false);await next();}
  check(G.airBots.list.length,'no enemy aircraft spawned');
  const b=G.airBots.list[0];G.airBotsOn=false;return b;
}
async function aam(id,loadout,store,setup){
  const air=await board(id,loadout),p=air.plane;
  p.spawn(0,3500,0,0,240,false);x.applyStoreLoad(air);p.state.throttle=0.9;p.aim=[0,0,1];
  step(30);
  const b=await bot();
  for(const o of G.airBots.list.slice(1))o.gone=true;
  G.airBots.list=[b];
  const r=setup(p,b);b.flares=0;b.chaff=0;b.missileAt=1e9;
  select(air,store);
  const radar=x.AIR_STORE_DEFS[store].guidance!=='ir',ctl=x.airCtl(air);let lockT=null;
  if(radar){step(6*60,()=>aimAt(p,b.plane.position));tap('KeyR');}
  tap('Space');
  step(6*60,(i)=>{aimAt(p,b.plane.position);if(lockT==null&&(radar?ctl.radar?.stt?.state==='track'&&ctl.seeker.state==='ready':ctl.seeker.state==='track'))lockT=i/60;});
  check(lockT!=null,`${store}: no lock (radar ${ctl.radar?.stt?.state}, seeker ${ctl.seeker.state}: ${ctl.reason})`);
  const d0=Math.hypot(...b.plane.position.map((v,k)=>v-p.position[k]));
  rmb();step(2);
  const m=G.airOrdnance.find(o=>o.kind==='aam');check(m&&m.target===b.target,`${store}: not launched at the enemy`);
  let t=0;step(40*60,(i)=>{if(r.keepAim)aimAt(p,b.plane.position);if(!b.down&&!G.airOrdnance.includes(m)&&!t)t=i/60;});
  const D=b.plane.damage;
  return{lockSeconds:+lockT.toFixed(2),rangeM:Math.round(d0),flightSeconds:+t.toFixed(2),down:!!b.down,crashed:b.plane.crashed,damaged:D.parts.filter(q=>q.hp<q.max).map(q=>q.id)};
}
const ahead=(p,b,dist,dx=0,dy=0)=>{const q=p.position;b.plane.spawn(q[0]+dx,q[1]+dy,q[2]+dist,0,b.plane.type.sound==='jet'?220:130,false);b.plane.state.throttle=0.8;};
out.aim9l=await aam('f4e',1,'aim9l',(p,b)=>{ahead(p,b,2200);return{};});
check(out.aim9l.down,'AIM-9L missed');
out.aim7e=await aam('f4e',1,'aim7e',(p,b)=>{ahead(p,b,6000,0,200);return{keepAim:true};});
check(out.aim7e.down,'AIM-7E missed');
out.r73=await aam('mig29',1,'r73',(p,b)=>{ahead(p,b,2000,1400,0);return{};});
check(out.r73.down,'R-73 (target 35 deg off) missed');
out.r27r=await aam('mig29',1,'r27r',(p,b)=>{ahead(p,b,7000,0,300);return{keepAim:true};});
check(out.r27r.down,'R-27R missed');
out.r60m=await aam('mig29',2,'r60m',(p,b)=>{ahead(p,b,1800);return{};});
check(out.r60m.down,'R-60M missed');
// ---- guns on an enemy aircraft
{
  const air=await board('f4e',0),p=air.plane;p.spawn(0,3500,0,0,230,false);x.applyStoreLoad(air);step(30);
  const b=await bot();for(const o of G.airBots.list.slice(1))o.gone=true;G.airBots.list=[b];
  ahead(p,b,350);b.flares=0;b.chaff=0;b.missileAt=1e9;
  air.fireAll=true;step(3*60,()=>aimAt(p,b.plane.position));air.fireAll=false;step(60);
  out.guns={down:!!b.down,damaged:b.plane.damage.parts.filter(q=>q.hp<q.max).map(q=>q.id)};
  check(out.guns.damaged.length,'guns did not hit the enemy aircraft');
}
return out;
