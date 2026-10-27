// The flight's action bar and weapon panel, the countermeasure release events and their sounds, the
// bomb ring, the flight map (M), TWS (user requests): an F-4E with bombs, an F-15C with AMRAAMs.
const tf=window.__tf,x=window.__tfx,G=tf.G,out={};
const next=()=>new Promise(r=>setTimeout(r,0)),frames=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
await tf.coreReady();await x.flightCoreP;tf.pause(true);G.airDefenceOn=false;tf.finishThumbs();
const live=(fn)=>{const p=G.paused;G.paused=false;try{fn();}finally{G.paused=p;}};
const tap=(code,o={})=>live(()=>{window.dispatchEvent(new KeyboardEvent('keydown',{code,bubbles:true,...o}));window.dispatchEvent(new KeyboardEvent('keyup',{code,bubbles:true,...o}));});
const canvas=[...document.querySelectorAll('canvas')].filter(c=>!c.closest('#air-hud')).sort((a,b)=>b.width*b.height-a.width*a.height)[0];
const rmb=()=>live(()=>{canvas.dispatchEvent(new MouseEvent('mousedown',{button:2,bubbles:true}));canvas.dispatchEvent(new MouseEvent('mouseup',{button:2,bubbles:true}));});
const shot=async(n)=>{G.airHudTick=0;tf.advance(1/60,[],true);await frames();await pyShot(n);};
async function board(id,lo){
  if(G.air?.active)x.exitAircraft(true);
  G.airLoadout[id]=lo;document.querySelector(`.hangar-card[data-air=${id}]`).click();
  for(let i=0;i<120&&!(G.air?.active&&G.air.plane.type.id===id);i++){tf.advance(1/60,[],false);await next();}
  return G.air;
}
document.querySelectorAll('#toast, .toast').forEach(el=>el.style.visibility='hidden');
// ---- F-4E with bombs: the bar, the weapon panel, a pylon picked with the mouse
let air=await board('f4e',2),P=air.plane;G.airHelp=false;
const e=G.enemies.filter(q=>q.alive&&q.veh).sort((p,q)=>p.z-q.z).at(-1);
P.spawn(e.x,e.veh.body.origin()[1]+800,e.z-2600,0,200,false);x.applyStoreLoad(air);P.state.throttle=0.7;
for(let i=0;i<30;i++){P.aim=[0,-0.32,0.95];tf.advance(1/60,[],false);}
await shot('bar');
out.bar=[...document.querySelectorAll('#air-hud .air-bar .ab')].map(b=>[b.dataset.act,b.querySelector('.k')?.textContent,b.querySelector('b')?.textContent,b.className.replace('ab','').trim()]);
tap('KeyY',{shiftKey:true});G.airHudTick=0;tf.advance(1/60,[],true);
const tiles=[...document.querySelectorAll('#air-hud .air-wpn .wt')];out.panel=tiles.map(t=>[t.dataset.grp,t.querySelector('b').textContent,t.classList.contains('sel')]);
const mk=tiles.find(t=>t.dataset.grp==='mk82');if(mk)live(()=>mk.click());out.afterClick=air.stores.groups[air.stores.sel];
await shot('panel');
tap('KeyY',{shiftKey:true});
// the bomb ring: diving at the target
for(let i=0;i<120;i++){const o=e.veh.body.origin(),d=[o[0]-P.position[0],o[1]-P.position[1],o[2]-P.position[2]],l=Math.hypot(...d);P.aim=d.map(v=>v/l);tf.advance(1/60,[],false);}
out.ccip=!!air.impact;await shot('ccip');
// ---- countermeasures: T, quick T, Shift+T periodic, then empty
const cm0=[air.cm.flares,air.cm.chaff];
tap('KeyT');tf.advance(1/60,[],false);tap('KeyT');tf.advance(0.3,[],false);tap('KeyT');tf.advance(1/60,[],false);
tap('KeyT',{shiftKey:true});tf.advance(5,[],false);tap('KeyT',{shiftKey:true});
const d0=x.airCtl(air).cmDiag;out.cm={before:cm0,after:[air.cm.flares,air.cm.chaff],events:d0.events,requests:d0.requests,started:d0.started,dropped:d0.dropped,periodic:x.airCtl(air).cm.periodic};
// ---- the map, M
tap('KeyM');await shot('bigmap');out.bigmap=document.body.dataset.bigmap;tap('KeyM');
// ---- the F-15C: TWS, an AMRAAM on a scanned track
air=await board('f15c',2);P=air.plane;P.spawn(0,3500,0,0,240,false);x.applyStoreLoad(air);
G.airBotsOn=true;for(let i=0;i<900&&!G.airBots.list.length;i++){tf.advance(1/60,[],false);await next();}G.airBotsOn=false;
const b=G.airBots.list[0];for(const o of G.airBots.list.slice(1))o.gone=true;G.airBots.list=[b];b.flares=b.chaff=0;b.missileAt=1e9;
b.plane.spawn(0,3600,15000,0,200,false);
for(let k=0;k<6&&x.airCtl(air).radar.mode!=='tws';k++)tap('KeyR',{shiftKey:true});
tf.advance(3,[],false);tap('KeyR');
for(let k=0;k<10&&air.stores.groups[air.stores.sel]!=='aim120a';k++)tap('KeyY');
tap('Space');tf.advance(1,[],false);rmb();
const m=G.airOrdnance.find(o=>o.owner==='player'&&o.def.name.startsWith('AIM-120'));const ph=[];
for(let i=0;i<20*60&&m;i++){tf.advance(1/60,[],false);if(ph.at(-1)!==m.guide.phase)ph.push(m.guide.phase);}
out.tws={mode:x.airCtl(air).radar.mode,stt:!!x.airCtl(air).radar.stt,launched:!!m,tws:!!m?.guide.tws,phases:ph,down:!!b.down,reason:x.airCtl(air).reason};
await shot('tws');
return out;
