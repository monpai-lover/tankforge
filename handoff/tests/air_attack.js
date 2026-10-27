// The attack aircraft (追加規格六～七): A-10A and Su-25 in the hangar with their loads, take-off and
// top speed, the GAU-8 (spin-up, rounds, recoil), the A-10A's Maverick from its triple rack (the seeker
// view, an image lock), the Su-25's Kh-25ML on its Klen-PS laser spot, an unfinished store refused, the
// stores' weight going as they go.
const tf=window.__tf,x=window.__tfx,G=tf.G,out={};
const next=()=>new Promise(r=>setTimeout(r,0)),frames=(n=2)=>new Promise(r=>{let k=0;const f=()=>++k>=n?r():requestAnimationFrame(f);requestAnimationFrame(f);});
await tf.coreReady();await x.flightCoreP;tf.pause(true);G.airDefenceOn=false;tf.finishThumbs();tf.setQuality('low');
const live=(fn)=>{const p=G.paused;G.paused=false;try{fn();}finally{G.paused=p;}};
const tap=(code,o={})=>live(()=>{window.dispatchEvent(new KeyboardEvent('keydown',{code,bubbles:true,...o}));window.dispatchEvent(new KeyboardEvent('keyup',{code,bubbles:true,...o}));});
const canvas=[...document.querySelectorAll('canvas')].filter(c=>!c.closest('#air-hud')).sort((a,b)=>b.width*b.height-a.width*a.height)[0];
const rmb=()=>live(()=>{canvas.dispatchEvent(new MouseEvent('mousedown',{button:2,bubbles:true}));canvas.dispatchEvent(new MouseEvent('mouseup',{button:2,bubbles:true}));});
const nrm=(a)=>{const l=Math.hypot(...a)||1;return a.map(v=>v/l);};
// ---- the hangar: both types, each loadout hung
document.querySelector('#g-mode .tab[data-g=air]').click();
for(let i=0;i<30&&!G.airGarage.plane;i++)await frames(1);
out.cards=[...document.querySelectorAll('#air-list .card')].map(c=>c.dataset.air).filter(id=>id==='a10a'||id==='su25');
for(const [id,lo] of [['a10a',1],['su25',3]]){
  document.querySelector(`#air-list .card[data-air=${id}]`).click();await frames(3);
  document.querySelector(`#g-air .air-lo[data-lo="${lo}"]`)?.click();await frames(3);
  const p=G.airGarage.plane,c=p.drawPos;
  out['hangar_'+id]={what:document.querySelector('#g-air .air-lo-what')?.textContent,stores:p.storeNodes.filter(n=>n.name.startsWith('aircraft_store')).length};
  document.querySelectorAll('#g-bottom, #g-top, #g-info').forEach(el=>el.style.visibility='hidden');
  const L=Math.max(G.airGarage.size.len,G.airGarage.size.span);G.camOverride={pivot:[c[0],c[1],c[2]],dist:L*1.05,fov:0.75};G.cam.yaw=p.heading+0.9;G.cam.pitch=-0.45;await frames(4);await pyShot(id+'_hangar');
  document.querySelectorAll('#g-bottom, #g-top, #g-info').forEach(el=>el.style.visibility='');
}
G.camOverride=null;
async function board(id,lo,ground=false){
  if(G.air?.active)x.exitAircraft(true);
  G.airLoadout[id]=lo;document.querySelector(`.hangar-card[data-air=${id}]`).click();
  for(let i=0;i<120&&!(G.air?.active&&G.air.plane.type.id===id);i++){tf.advance(1/60,[],false);await next();}
  return G.air;
}
// ---- take-off and top speed (clean)
for(const id of ['a10a','su25']){
  const air=await board(id,0),P=air.plane,r={};
  P.state.throttle=1;P.state.flaps='takeoff';let lift=null;const h=P.heading;
  for(let k=0;k<60*60&&!lift;k++){P.aim=[Math.sin(h)*0.97,0.24,Math.cos(h)*0.97];tf.advance(1/60,[],false);if(!P.onGround&&P.cur[35]>8)lift={s:+(k/60).toFixed(1),kmh:Math.round(P.cur[14]*3.6)};}
  r.takeoff=lift;
  P.spawn(0,300,0,0,180,false);P.state.throttle=1;P.state.gear=false;P.state.flaps='up';let vmax=0;
  for(let k=0;k<90*60;k++){P.aim=[0,0.01,1];tf.advance(1/60,[],false);vmax=Math.max(vmax,P.cur[14]*3.6);}
  r.topKmh=Math.round(vmax);r.mass=x.airMass(air);out['fly_'+id]=r;
}
// ---- the GAU-8: spin-up, the rate, the recoil (speed lost firing level)
{
  const air=await board('a10a',0),P=air.plane;P.spawn(0,1500,0,0,180,false);P.state.throttle=0.7;
  for(let k=0;k<120;k++){P.aim=[0,0,1];tf.advance(1/60,[],false);}
  const g=air.guns[0],a0=g.ammo,v0=P.cur[14];let first=null;
  air.fireAll=true;for(let k=0;k<120;k++){P.aim=[0,0,1];tf.advance(1/60,[],false);if(first==null&&g.ammo<a0)first=+(k/60).toFixed(2);}air.fireAll=false;
  const fired=a0-g.ammo;
  out.gau8={firstRoundS:first,roundsIn2s:fired,speedLostKmh:Math.round((v0-P.cur[14])*3.6),loop:!!air.rotaryUntil?.air_gau8_fire,shell:G.shots.filter(s=>s.ownAir).map(s=>s.shell.id).slice(0,7)};
}
// ---- the A-10A's Maverick: LAU-88, the seeker view, an image lock on a range vehicle, launched
{
  const air=await board('a10a',1),P=air.plane,ctl=x.airCtl(air);
  const e=G.enemies.filter(q=>q.alive&&q.veh).sort((p,q)=>p.z-q.z).at(-1),E=e.veh.body;
  P.spawn(e.x+200,E.origin()[1]+1400,e.z-5200,0,190,false);x.applyStoreLoad(air);P.state.throttle=0.7;tf.advance(0.2,[],false);
  for(let k=0;k<10&&air.stores.groups[air.stores.sel]!=='agm65d';k++)tap('KeyY');
  const m0=x.airMass(air),rack=air.stores.items.filter(it=>it.id==='agm65d'&&it.pylonN===3).length;
  tap('Space');tf.advance(2,[],false);
  let k=0;while(ctl.view!=='seeker'&&k++<4)tap('KeyV');
  const o=E.origin();ctl.seeker.look=[o[0],o[1]+1,o[2]];ctl.seeker.slew=nrm(ctl.seeker.look.map((v,i)=>v-P.position[i]));tf.advance(1,[],false);
  tap('Space');tf.advance(1.5,[],false);const cap=ctl.seeker.state;rmb();tf.advance(0.2,[],false);
  const m=G.airOrdnance.find(q=>q.owner==='player'&&q.def.name.startsWith('AGM-65D'));
  G.airHudTick=0;tf.advance(1/60,[],true);await frames();await pyShot('a10_maverick');
  out.a10maverick={rackOnPylon3:rack,seekerView:ctl.view,capture:cap,launched:!!m,target:!!m?.guide.target,massBefore:Math.round(m0),massAfter:Math.round(x.airMass(air)),reason:ctl.reason};
  k=0;while(ctl.view!=='third'&&k++<4)tap('KeyV');
}
// ---- the Su-25's Kh-25ML: the Klen-PS laser on a vehicle (its narrow window ahead), launched, flown to it
{
  const air=await board('su25',3),P=air.plane,ctl=x.airCtl(air);
  const e=G.enemies.filter(q=>q.alive&&q.veh).sort((p,q)=>p.z-q.z).at(-1),E=e.veh.body;
  P.spawn(e.x,E.origin()[1]+1200,e.z-5500,0,190,false);x.applyStoreLoad(air);P.state.throttle=0.7;tf.advance(0.2,[],false);
  for(let k=0;k<10&&air.stores.groups[air.stores.sel]!=='kh25ml';k++)tap('KeyY');
  const pod=x.airPod(air);
  const aimAt=()=>{const o=E.origin(),d=[o[0]-P.position[0],o[1]-P.position[1],o[2]-P.position[2]],l=Math.hypot(...d);P.aim=d.map(v=>v/l);};
  for(let k=0;k<120;k++){aimAt();tf.advance(1/60,[],false);}
  pod.dir=nrm([E.origin()[0]-P.worldPoint(pod.mount)[0],E.origin()[1]+1-P.worldPoint(pod.mount)[1],E.origin()[2]-P.worldPoint(pod.mount)[2]]);
  tap('Space');for(let k=0;k<40;k++){aimAt();tf.advance(1/60,[],false);}const podState=pod.state;
  tap('Space');for(let k=0;k<90;k++){aimAt();tf.advance(1/60,[],false);}
  const chk=x.launchCheck(air);rmb();for(let k=0;k<6;k++)tf.advance(1/60,[],false);
  const m=G.airOrdnance.find(q=>q.owner==='player'&&q.def.name.startsWith('Kh-25'));let ph=m?.guide.phase,end=null;
  const ei=G.enemies.indexOf(e),state=()=>{const c=tf.enemyCombat(ei);return{alive:c.alive,destroyed:!!c.caps?.destroyed,crew:c.caps?.crew_alive??null,canFire:c.caps?.can_fire??null,canMove:c.caps?.can_move??null};},s0=state();let worst={destroyed:false,crew:99};G.lastHit=null;
  const trace=[];for(let k=0;k<40*60&&m&&G.airOrdnance.includes(m);k++){aimAt();tf.advance(1/60,[],false);const sx=state();worst.destroyed||=sx.destroyed||!sx.alive;worst.crew=Math.min(worst.crew,sx.crew??99);if(k%30===0){const sp=x.airCtl(air).pod;trace.push([+(k/60).toFixed(1),m.pos.map(v=>Math.round(v)),m.guide.est?.p.map(v=>Math.round(v)),sp.state,sp.target?.enemy===e,Math.round(Math.hypot(m.pos[0]-e.x,m.pos[2]-e.z))]);}}
  out.khTrace=trace.slice(-8);out.target=[Math.round(e.x),Math.round(E.origin()[1]),Math.round(e.z)];
  for(let k=0;k<90;k++){tf.advance(1/60,[],false);const sx=state();worst.destroyed||=sx.destroyed||!sx.alive;worst.crew=Math.min(worst.crew,sx.crew??99);}
  if(m)end=Math.hypot(m.pos[0]-e.x,m.pos[2]-e.z);
  out.su25kh25={pod:pod.cfg.name,podState,laserSpot:!!x.airCtl(air).pod&&chk.ok,check:chk.reason||'ok',launched:!!m,phase:ph,handoverM:end&&+end.toFixed(1),target:e.name,before:s0,worst,hit:G.lastHit&&{result:G.lastHit.result,title:G.lastHit.title}};
}
// ---- an unfinished store asked for on its pylon: not hung
{
  const T=x.AIRCRAFT_TYPES?.a10a;const items=x.layoutStores(G.air.plane.type.id==='su25'?G.air.plane.type:G.air.plane.type,['test',[['cbu87',1,'p2'],['mk82',1,'p2']]]);
  out.incomplete={hung:items.map(i=>i.id)};
}
return out;
