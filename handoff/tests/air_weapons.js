// The weapons system's acceptance items (user spec, section 12, items 1-20), each through the game's
// own key and mouse listeners (the test holds the game paused between its steps and lets one event
// through at a time), reading the actual states: the radar's track, the pod's, the seeker's, each
// missile's own guidance, the stores and the HUD. Each item records what happened and ok.
const tf=window.__tf,x=window.__tfx,G=tf.G,out={},fail=[];
const next=()=>new Promise(r=>setTimeout(r,0));
await tf.coreReady();await x.flightCoreP;tf.pause(true);G.airDefenceOn=false;tf.finishThumbs();tf.setQuality('low');
const step=(n,fn,dt=1/60)=>{for(let i=0;i<n;i++){fn?.(i);tf.advance(dt,[],false);}};
const live=(fn)=>{const p=G.paused;G.paused=false;try{fn();}finally{G.paused=p;}};
const key=(code,o={})=>live(()=>window.dispatchEvent(new KeyboardEvent('keydown',{code,bubbles:true,...o})));
const keyUp=(code,o={})=>live(()=>window.dispatchEvent(new KeyboardEvent('keyup',{code,bubbles:true,...o})));
const tap=(code,o={})=>{key(code,o);keyUp(code,o);};
const canvas=[...document.querySelectorAll('canvas')].filter(c=>!c.closest('#air-hud')).sort((a,b)=>b.width*b.height-a.width*a.height)[0];
const rmb=()=>live(()=>{canvas.dispatchEvent(new MouseEvent('mousedown',{button:2,bubbles:true}));canvas.dispatchEvent(new MouseEvent('mouseup',{button:2,bubbles:true}));});
const item=(n,ok,data)=>{out[n]={ok:!!ok,...data};if(!ok)fail.push(n);};
const sub=(a,b)=>a.map((v,i)=>v-b[i]),len=(a)=>Math.hypot(...a),nrm=(a)=>{const l=len(a)||1;return a.map(v=>v/l);};
const aimAt=(P,at)=>{P.aim=nrm(sub(at,P.position));P.aimBias=[0,0,0,1];};
const missiles=()=>G.airOrdnance.filter(o=>o.owner==='player'&&o.guide);
async function board(id,lo){
  if(G.air?.active)x.exitAircraft(true);
  G.airLoadout[id]=lo;
  document.querySelector(`.hangar-card[data-air=${id}]`).click();
  for(let i=0;i<120&&!(G.air?.active&&G.air.plane.type.id===id);i++){tf.advance(1/60,[],false);await next();}
  if(!(G.air?.active&&G.air.plane.type.id===id))throw Error(`${id}: could not board`);
  const air=G.air;air.plane.spawn(0,3500,0,0,240,false);x.applyStoreLoad(air);air.plane.state.throttle=0.9;air.plane.aim=[0,0,1];
  step(10);return air;
}
async function bots(n=1){
  G.airBotsOn=true;
  for(let i=0;i<900&&G.airBots.list.length<n;i++){tf.advance(1/60,[],false);await next();}
  G.airBotsOn=false;
  const list=G.airBots.list.slice(0,n);for(const o of G.airBots.list.slice(n))o.gone=true;G.airBots.list=list;
  for(const b of list){b.flares=0;b.chaff=0;b.missileAt=1e9;}
  return list;
}
const ahead=(P,b,dist,dx=0,dy=0,v=200)=>{const q=P.position;b.plane.spawn(q[0]+dx,q[1]+dy,q[2]+dist,0,v,false);b.plane.state.throttle=0.8;};
const select=(air,id)=>{for(let k=0;k<10&&air.stores.groups[air.stores.sel]!==id;k++)tap('KeyY');return air.stores.groups[air.stores.sel]===id;};
const ctl=(air)=>air.ctl;
// ---- 1, 2, 11, 17, 19: F-4E, AIM-9L at an enemy aircraft ahead
{
  let air=await board('f4e',1),P=air.plane;const [b]=await bots(1);ahead(P,b,1800);
  select(air,'aim9l');
  // 2: launch pressed before anything: refused now, with a reason, nothing stored
  const n0=missiles().length;rmb();
  const why2=ctl(air).reason,shown2=ctl(air).reasonAt>G.time;
  // 1: Space held (auto-repeat) through the seeker's preparation and capture: no launch
  key('Space');let captured=null;
  step(4*60,(i)=>{aimAt(P,b.plane.position);if(i%3===0)key('Space',{repeat:true});if(!captured&&ctl(air).seeker.state==='track')captured=i/60;});
  keyUp('Space');
  const launchedHeld=missiles().length-n0;
  // 2 (cont.): the refused press stored nothing: still no missile after the capture
  item(2,why2&&shown2&&launchedHeld===0,{reason:why2});
  item(1,captured!=null&&launchedHeld===0,{capturedAtS:captured,launchedWhileHeld:launchedHeld});
  // 19: one press delivered twice (the same event): one missile, one round off
  const left0=air.stores.items.filter(it=>it.id==='aim9l'&&!it.gone).length;
  const ev=new MouseEvent('mousedown',{button:2,bubbles:true});live(()=>{canvas.dispatchEvent(ev);canvas.dispatchEvent(ev);canvas.dispatchEvent(new MouseEvent('mouseup',{button:2,bubbles:true}));});
  const m1=missiles().filter(o=>o.def.name.startsWith('AIM-9'));
  item(19,m1.length===1&&air.stores.items.filter(it=>it.id==='aim9l'&&!it.gone).length===left0-1,{missiles:m1.length,roundsBefore:left0,roundsAfter:air.stores.items.filter(it=>it.id==='aim9l'&&!it.gone).length,log:ctl(air).log.map(l=>l.id)});
  // 11: a second missile at a second aircraft, then the selection moved: each keeps its own target
  ahead(P,b,1800);
}
{
  let air=await board('f4e',1),P=air.plane;const [a,b]=await bots(2);
  ahead(P,a,1700,-120);ahead(P,b,1900,140);
  select(air,'aim9l');tap('Space');
  const trace=[];const fireAt=async(t)=>{let ok=false;step(3*60,(i)=>{aimAt(P,t.plane.position);const sk=ctl(air).seeker;if(i%20===0)trace.push([sk.state,sk.target===a.target?'A':sk.target===b.target?'B':'-',sk.why,Math.round(len(sub(t.plane.position,P.position))),!!t.down]);if(!ok&&sk.state==='track'&&sk.target===t.target){ok=true;}
    // captured the other aircraft: X rejects it, the seeker searches again (as a player would)
    else if(!ok&&sk.state==='track'&&i%30===29)tap('KeyX');});step(Math.ceil(60*0.9),()=>aimAt(P,t.plane.position));rmb();return ok;};
  const okA=await fireAt(a);const mA=missiles().at(-1);step(10,()=>aimAt(P,b.plane.position));const okB=await fireAt(b);const mB=missiles().at(-1);const dbg11={okA,okB,seeker:ctl(air).seeker.state,onB:ctl(air).seeker.target===b.target,reason:ctl(air).reason,aDown:!!a.down};
  const ms=[mA,mB].filter((o,i,l)=>o&&l.indexOf(o)===i);ctl(air).selected=a.target;tap('KeyX');step(20,()=>aimAt(P,a.plane.position));
  const tg=ms.map(o=>o.guide.target===a.target?'A':o.guide.target===b.target?'B':'?');
  item(11,okA&&okB&&ms.length===2&&tg[0]==='A'&&tg[1]==='B',{targets:tg,phases:ms.map(o=>o.guide.phase),dbg11});
  // 17: the rest fired off until none: then refused, the HUD and the stations agree
  for(const o of missiles())G.airOrdnance.splice(G.airOrdnance.indexOf(o),1);
  let guard=0;while(air.stores.items.some(it=>it.id==='aim9l'&&!it.gone)&&guard++<10){ahead(P,b,1600,0,0,240);if(ctl(air).seeker.state==='off')tap('Space');step(150,()=>aimAt(P,b.plane.position));rmb();for(const o of missiles())G.airOrdnance.splice(G.airOrdnance.indexOf(o),1);}
  const before=G.airOrdnance.length;rmb();step(2);G.airHudTick=0;tf.advance(1/60,[],true);
  const hud=[...document.querySelectorAll('#air-hud .air-store > div')].map(d=>d.textContent).find(t=>/AIM-9L/.test(t))||'';
  const drawn=air.plane.storeNodes?.filter(n=>n.name?.startsWith('aircraft_store')&&n.visible).length;
  item(17,!air.stores.items.some(it=>it.id==='aim9l'&&!it.gone)&&G.airOrdnance.length===before&&/0/.test(hud),{reason:ctl(air).reason,hud,storesDrawn:drawn});
}
// ---- 3, 12, 8: radar lock held while the infrared seeker cannot capture; a SARH missile without support
{
  let air=await board('f15c',1),P=air.plane;const [b]=await bots(1);ahead(P,b,14000,0,300,180);
  let tracked=false;step(8*60,()=>{P.aim=[0,0,1];if(!tracked&&ctl(air).radar.tracks.has(b))tracked=true;});
  tap('KeyR');step(90,()=>{P.aim=[0,0,1];});
  const stt=ctl(air).radar.stt?.state;
  select(air,'aim9l');tap('Space');step(90,()=>{P.aim=[0,0,1];});
  rmb();
  item(3,stt==='track'&&ctl(air).radar.stt?.state==='track'&&missiles().length===0&&ctl(air).seeker.state!=='track',{radar:ctl(air).radar.stt?.state,seeker:ctl(air).seeker.state,reason:ctl(air).reason});
  // 8: V through the views: radar track, seeker unchanged
  const snap=()=>JSON.stringify([ctl(air).radar.stt?.state,ctl(air).radar.stt?.target===b.target,ctl(air).seeker.state]);
  const s0=snap(),views=[];for(let k=0;k<3;k++){tap('KeyV');step(2,()=>{P.aim=[0,0,1];});views.push(ctl(air).view);}
  // 12: AIM-7F on the radar track, then the radar switched off: the missile loses its support
  select(air,'aim7f');tap('Space');step(60,()=>{P.aim=nrm(sub(b.plane.position,P.position));});tap('Space');
  const m=missiles().find(o=>o.def.name.startsWith('AIM-7'));
  step(90,()=>{P.aim=nrm(sub(b.plane.position,P.position));});const phase0=m?.guide.phase;
  tap('KeyR',{altKey:true});step(3*60);
  const s1=snap();
  item(8,s0===JSON.stringify(['track',true,JSON.parse(s0)[2]])&&views.length===3,{before:s0,views});
  item(12,m&&phase0==='sarh'&&m.guide.phase==='lost',{launched:!!m,phaseWithRadar:phase0,phaseAfterRadarOff:m?.guide.phase,why:m?.guide.why});
}
// ---- 13: AIM-120A: the launcher's data link, then its own active seeker
{
  let air=await board('f15c',2),P=air.plane;const [b]=await bots(1);ahead(P,b,16000,0,200,180);
  step(8*60,()=>{P.aim=[0,0,1];});tap('KeyR');step(90,()=>{P.aim=[0,0,1];});
  select(air,'aim120a');tap('Space');step(60,()=>{P.aim=[0,0,1];});rmb();
  const m=missiles().find(o=>o.def.name.startsWith('AIM-120')),phases=[];
  step(25*60,(i)=>{P.aim=[0,0,1];if(m&&phases.at(-1)?.p!==m.guide.phase)phases.push({p:m.guide.phase,t:+(i/60).toFixed(1),km:+(len(sub(b.plane.position,m.pos))/1e3).toFixed(1)});});
  item(13,m&&phases[0]?.p==='datalink'&&phases.some(q=>q.p==='active'||q.p==='active-track'),{phases,down:!!b.down});
}
// ---- 6, 7: the seeker's target leaves the gimbal (memory -> search); the radar's target deleted
{
  let air=await board('f4e',1),P=air.plane;const [b]=await bots(1);ahead(P,b,1600);
  select(air,'aim9l');tap('Space');step(150,()=>aimAt(P,b.plane.position));
  const s0=ctl(air).seeker.state,states=[];
  b.plane.spawn(P.position[0]+1500,P.position[1],P.position[2]-1500,Math.PI,200,false);
  step(90,()=>{P.aim=[0,0,1];const s=ctl(air).seeker.state;if(states.at(-1)!==s)states.push(s);});
  item(6,s0==='track'&&states.includes('memory')&&states.at(-1)==='search',{states,why:ctl(air).seeker.why});
  ahead(P,b,9000,0,0,180);step(8*60,()=>{P.aim=[0,0,1];});tap('KeyR');step(90,()=>{P.aim=[0,0,1];});
  const had=ctl(air).radar.stt?.state;b.gone=true;let err=null;
  try{step(60,()=>{P.aim=[0,0,1];});}catch(e){err=String(e);}
  item(7,had==='track'&&!ctl(air).radar.stt&&!ctl(air).radar.tracks.has(b)&&!err,{radarBefore:had,radarAfter:ctl(air).radar.stt,error:err});
}
// ---- 4, 5, 9: NF-02 pod: tracking a vehicle the TV Maverick cannot take over (night); moving target vs ground point
{
  let air=await board('nf02',2),P=air.plane;
  const e=G.enemies.filter(q=>q.alive&&q.veh).sort((p,q)=>p.z-q.z).at(-1),E=e.veh.body;
  P.spawn(e.x+200,E.origin()[1]+1500,e.z-5500,0,220,false);x.applyStoreLoad(air);step(10);
  const time0=tf.renderer.timeIndex;
  select(air,'agm65a');
  const pod=x.airPod(air),mount=()=>P.worldPoint(pod.mount);
  const pointPod=()=>{pod.dir=nrm(sub([e.x,E.origin()[1]+1,e.z],mount()));};
  pointPod();tap('Space');step(60,()=>{P.aim=[0,-0.2,1];});
  const podState=pod.state;
  // night: the TV seeker cannot see; the pod still tracks
  // the time of day from the flight bar's clock (T is the countermeasures in flight)
  const clock=()=>{G.airHudTick=0;tf.advance(1/60,[],true);live(()=>document.querySelector('#air-hud .air-bar [data-act=time]').click());};
  for(let k=0;k<8&&x.daylight?.()!==false;k++)clock();
  tap('Space');step(120,()=>{P.aim=[0,-0.2,1];});tap('Space');step(60,()=>{P.aim=[0,-0.2,1];});rmb();
  G.airHudTick=0;tf.advance(1/60,[],true);const sys=document.querySelector('#air-hud .air-sys')?.textContent||'';
  item(4,podState==='track'&&pod.state==='track'&&ctl(air).seeker.state!=='track'&&missiles().length===0,{pod:pod.state,seeker:ctl(air).seeker.state,reason:ctl(air).reason,hud:sys});
  // 5: the vehicle moved (20 m/s east): a tracking pod follows it; a ground point stays put
  const est0=pod.est.p.slice();
  step(120,()=>{E.pos[0]+=20/60;e.x=E.origin()[0];e.vx=20;P.aim=[0,-0.2,1];});
  const followed=len(sub(pod.est.p,est0));
  tap('KeyX');pod.dir=nrm(sub([e.x+700,E.origin()[1],e.z+300],mount()));
  // nothing in the gate there: Space stabilizes on the ground point
  tap('Space');const pt=pod.point?.slice();step(120,()=>{E.pos[0]+=20/60;P.aim=[0,-0.2,1];});
  item(5,followed>30&&pod.state==='point'&&pt&&len(sub(pod.point,pt))<0.5,{trackMovedM:+followed.toFixed(1),podState:pod.state,pointDriftM:pt?+len(sub(pod.point,pt)).toFixed(2):null});
  for(let k=0;k<8&&tf.renderer.timeIndex!==time0;k++)clock();
  // 9: into the pod view and out: the aircraft held its attitude, then the mouse instructor from the nose
  const view=()=>ctl(air).view;let k=0;while(view()!=='pod'&&k++<4)tap('KeyV');
  const inSensor=view()==='pod',held=ctl(air).holdAim?.slice();
  live(()=>canvas.dispatchEvent(new MouseEvent('mousemove',{movementX:120,movementY:40,bubbles:true})));step(30);
  const podTurned=!!held,aimHeld=held&&len(sub(P.aim,held))<1e-6;
  while(view()==='pod'&&k++<8)tap('KeyV');
  const nose=[P.cur[48],P.cur[49],P.cur[50]],gap=Math.acos(Math.max(-1,Math.min(1,nose[0]*P.aim[0]+nose[1]*P.aim[1]+nose[2]*P.aim[2])))*57.3;
  item(9,inSensor&&podTurned&&aimHeld&&gap<3,{inSensor,aimHeld,aimToNoseDegOnExit:+gap.toFixed(2)});
}
// ---- 10: countermeasures: stock, decoys made, a seduction by chance (not certain)
{
  let air=await board('f4e',1),P=air.plane;const c0=[air.cm.flares,air.cm.chaff];
  tap('KeyT');step(2);
  const c1=[air.cm.flares,air.cm.chaff],made=G.airBots.flares.filter(f=>f.owner==='player').length;
  tap('KeyT',{altKey:true});const program=ctl(air).cm.program;
  // the same missile geometry against a flare, with the dice forced each way
  const runs={};
  for(const [tag,r] of [['lucky',0],['unlucky',0.999]]){
    air=await board('f4e',1);P=air.plane;const [b]=await bots(1);
    const it=b.stores.items.find(i=>i.def.guidance==='ir');for(const i of b.stores.items)if(i!==it)i.gone=true;
    b.plane.spawn(0,3500,-2500,0,250,false);b.missileAt=0;let m=null;
    for(let i=0;i<10*60&&!m;i++){P.aim=[0,0,1];tf.advance(1/60,[],false);m=G.airOrdnance.find(o=>o.owner==='bot');}
    const rnd=Math.random;Math.random=()=>r;tap('KeyT');step(60);Math.random=rnd;
    runs[tag]={fired:!!m,decoyed:!!m?.decoyed};
  }
  item(10,c1[0]===c0[0]-2&&c1[1]===c0[1]-2&&made>=2&&runs.lucky.decoyed&&!runs.unlucky.decoyed,{before:c0,after:c1,flaresMade:made,program,runs});
}
// ---- 14, 16: the same AIM-9L shot at 120 and 30 frames a second: hit at both (swept collision), the
// seeker's preparation and the missile's flight time alike
{
  const res={};
  for(const [tag,dt] of [['120fps',1/120],['30fps',1/30]]){
    let air=await board('f4e',1),P=air.plane;const [b]=await bots(1);ahead(P,b,1500,0,0,180);
    select(air,'aim9l');tap('Space');let prep=null,t=0;
    const up=()=>{G.skipDraw=true;x.update(dt);G.skipDraw=false;};
    for(let i=0;i<3/dt&&ctl(air).seeker.state!=='track';i++){aimAt(P,b.plane.position);up();t+=dt;if(prep==null&&ctl(air).seeker.state!=='prep')prep=t;}
    for(let i=0;i<0.5/dt;i++){aimAt(P,b.plane.position);up();}rmb();
    const m=missiles().find(o=>o.def.name.startsWith('AIM-9'));let fly=null;t=0;
    for(let i=0;i<20/dt&&!fly;i++){up();t+=dt;if(m&&!G.airOrdnance.includes(m))fly=t;}
    res[tag]={prepS:prep&&+prep.toFixed(3),flightS:fly&&+fly.toFixed(2),down:!!b.down,damaged:b.plane.damage.parts.filter(q=>q.hp<q.max).map(q=>q.id).length};
  }
  item(14,res['30fps'].damaged>0&&res['120fps'].damaged>0,res);
  item(16,Math.abs(res['30fps'].prepS-res['120fps'].prepS)<0.05&&Math.abs(res['30fps'].flightS-res['120fps'].flightS)<0.4,res);
}
// ---- 15: zoom, field of view and the camera do not widen the seeker: a target just outside its field
{
  let air=await board('f4e',1),P=air.plane;const [b]=await bots(1);
  select(air,'aim9l');const d=x.AIR_STORE_DEFS.aim9l,half=Math.max(1.5,d.fov*0.5);
  const res={};
  for(const [tag,setup] of [['third',()=>{}],['cockpit',()=>{tap('KeyV');}],['zoomed',()=>{ctl(air).seekerZoom=1;}]]){
    air=await board('f4e',1);P=air.plane;select(air,'aim9l');setup();
    const off=(half+3)*Math.PI/180;ahead(P,b,2000*Math.cos(off),2000*Math.sin(off),0,240);b.plane.aim=[0,0,1];
    tap('Space');step(150,()=>{P.aim=[0,0,1];});res[tag]=ctl(air).seeker.state;
  }
  item(15,Object.values(res).every(s=>s!=='track'&&s!=='capturing'),{states:res,halfFieldDeg:half});
}
// ---- 18: chat, a menu, pause: no launch, no radar change, no countermeasures
{
  let air=await board('f15c',1),P=air.plane;const cm0=[air.cm.flares,air.cm.chaff],r0=ctl(air).radar.on,n0=G.airOrdnance.length;
  const tries=()=>{tap('KeyT');tap('KeyR',{altKey:true});tap('Space');rmb();};
  // pause (the key handler sees the pause)
  const p=G.paused;G.paused=true;for(const code of ['KeyT','KeyR','Space'])window.dispatchEvent(new KeyboardEvent('keydown',{code,bubbles:true,altKey:code==='KeyR'}));G.paused=p;
  const afterPause=[air.cm.flares,air.cm.chaff,ctl(air).radar.on,G.airOrdnance.length];
  // the key editor (a menu) open
  tap('F7');const menu=!document.querySelector('#air-keys').hidden;tries();tap('Escape');
  const chat=document.getElementById('net-chat');if(chat){chat.hidden=false;tries();chat.hidden=true;}
  item(18,afterPause[0]===cm0[0]&&afterPause[2]===r0&&menu&&air.cm.flares===cm0[0]&&ctl(air).radar.on===r0&&G.airOrdnance.length===n0,{cm:[air.cm.flares,air.cm.chaff],radarOn:ctl(air).radar.on,menuOpened:menu});
}
// ---- 20: equipment: no pod, no radar, no RWR / MAWS / countermeasures where not fitted
{
  const res={};
  for(const id of ['p51d','f104g','f4e','nf02']){
    const air=await board(id,id==='p51d'?0:1);
    tap('KeyV');const views=[ctl(air).view];tap('KeyV');views.push(ctl(air).view);tap('KeyV');views.push(ctl(air).view);
    tap('KeyR',{altKey:true});const radarWhy=ctl(air).reason;tap('KeyR',{altKey:true});
    tf.advance(1/60,[],true);
    res[id]={sensorView:views.some(v=>v==='pod'||v==='seeker'),radar:!!ctl(air).radar,rwr:!document.querySelector('#air-hud .air-rwr').hidden,eq:ctl(air).eq,cm:air.cm?[air.cm.max.flares,air.cm.max.chaff]:null,radarWhy};
  }
  item(20,!res.p51d.sensorView&&!res.p51d.radar&&!res.p51d.rwr&&!res.f104g.sensorView&&res.f104g.radar&&!res.f104g.rwr&&res.nf02.sensorView&&res.f4e.rwr,res);
}
out.failed=fail;
return out;
