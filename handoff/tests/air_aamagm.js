// AAM / AGM by subtype (追加任務 第八節 1-14): migration, separate states per class, support lost per
// class, active radar before / after taking over, anti-radiation after the emitter stops, two missiles
// on two targets, a multiple rack fired one by one, the LODs, one countermeasure event one sound group,
// incompatible loads refused, the four status fields, frame rate independence; online (14) checked for
// what exists. Each item records what happened and ok.
const tf=window.__tf,x=window.__tfx,G=tf.G,out={},fail=[];
const next=()=>new Promise(r=>setTimeout(r,0)),frames=(n=2)=>new Promise(r=>{let k=0;const f=()=>++k>=n?r():requestAnimationFrame(f);requestAnimationFrame(f);});
await tf.coreReady();await x.flightCoreP;tf.pause(true);G.airDefenceOn=false;tf.finishThumbs();tf.setQuality('low');
// a step at the frame time dt (tf.advance rounds to whole 1/60 steps: the game's own update for other rates)
const step=(n,fn,dt=1/60)=>{for(let i=0;i<n;i++){fn?.(i);if(dt===1/60)tf.advance(dt,[],false);else{G.skipDraw=true;x.update(dt);G.skipDraw=false;}}};
const live=(fn)=>{const p=G.paused;G.paused=false;try{fn();}finally{G.paused=p;}};
const key=(code,o={})=>live(()=>window.dispatchEvent(new KeyboardEvent('keydown',{code,bubbles:true,...o})));
const keyUp=(code,o={})=>live(()=>window.dispatchEvent(new KeyboardEvent('keyup',{code,bubbles:true,...o})));
const tap=(code,o={})=>{key(code,o);keyUp(code,o);};
const canvas=[...document.querySelectorAll('canvas')].filter(c=>!c.closest('#air-hud')).sort((a,b)=>b.width*b.height-a.width*a.height)[0];
const rmb=()=>live(()=>{canvas.dispatchEvent(new MouseEvent('mousedown',{button:2,bubbles:true}));canvas.dispatchEvent(new MouseEvent('mouseup',{button:2,bubbles:true}));});
const say=(k,v)=>console.log('@@'+k+' '+JSON.stringify(v));
const item=(n,ok,data)=>{out[n]={ok:!!ok,...data};if(!ok)fail.push(n);say(n,out[n]);};
const sub=(a,b)=>a.map((v,i)=>v-b[i]),len=(a)=>Math.hypot(...a),nrm=(a)=>{const l=len(a)||1;return a.map(v=>v/l);};
const aimAt=(P,at)=>{P.aim=nrm(sub(at,P.position));P.aimBias=[0,0,0,1];};
async function board(id,lo){
  if(G.air?.active)x.exitAircraft(true);
  G.airLoadout[id]=lo;document.querySelector(`.hangar-card[data-air=${id}]`).click();
  for(let i=0;i<120&&!(G.air?.active&&G.air.plane.type.id===id);i++){tf.advance(1/60,[],false);await next();}
  const air=G.air;
  // the loadout asked for (a second boarding of the same type keeps the first one otherwise)
  if(air.stores.index!==lo){air.stores=x.mountStores(air.plane,id,lo);air.ctl=null;}
  air.plane.spawn(0,3500,0,0,240,false);x.applyStoreLoad(air);air.plane.state.throttle=0.9;air.plane.aim=[0,0,1];x.airCtl(air);
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
const ahead=(P,b,dist,dx=0,dy=0,v=200,hdg=0)=>{const q=P.position;b.plane.spawn(q[0]+dx,q[1]+dy,q[2]+dist,hdg,v,false);b.plane.state.throttle=0.8;};
const select=(air,id)=>{for(let k=0;k<14&&air.stores.groups[air.stores.sel]!==id;k++)tap('KeyY');return air.stores.groups[air.stores.sel]===id;};
/** The radar's single-target lock on bot b: its sweep finds it first, then R, then the track. */
function radarLock(air,b,face=true){const P=air.plane,rd=x.airCtl(air).radar;
  for(let k=0;k<60*8&&!(rd.tracks&&[...rd.tracks.keys()].includes(b));k++){if(face)aimAt(P,b.plane.position);tf.advance(1/60,[],false);}
  x.airCtl(air).selected=b.target;tap('KeyR');
  for(let k=0;k<60*4&&rd.stt?.state!=='track';k++){if(face)aimAt(P,b.plane.position);tf.advance(1/60,[],false);}
  return rd.stt?.state==='track';}
const lastMissile=()=>G.airOrdnance.filter(o=>o.owner==='player'&&o.guide).at(-1);
const NF={ir:4,irx:5,sarh:6,arh:7,agm:8,odd:9};
// ---- 1. old ids -> new: kept as they were, no silent rename, unknown ids dropped without breaking a saved load
{
  const ids=Object.keys(x.WEAPON_MIGRATION),same=ids.filter(k=>x.migrateWeapon(k)===k);
  const T=x.AIRCRAFT_TYPES.mig29,kept=x.layoutStores(T,['saved',[['r73',2,'outer'],['r27r',2,'inner'],['aim9',2,'mid']]]).map(i=>i.id);
  item(1,same.length===ids.length&&kept.includes('r73')&&!kept.includes('r73e')&&kept.includes('r27r')&&!kept.includes('aim9'),{ids:ids.length,identity:same.length,savedMig29:kept,r73Note:x.WEAPON_MIGRATION.r73.note,legacyGeneric:ids.filter(k=>x.WEAPON_MIGRATION[k].legacy_generic)});
}
// ---- 2. the radar tracks, the infrared seeker does not capture (F-15C, AIM-9M head-on beyond its reach)
{
  const air=await board('f15c',4),P=air.plane;const [b]=await bots(1);ahead(P,b,12000,0,0,200,0);
  select(air,'aim9m');step(30);radarLock(air,b);
  tap('Space');step(120,()=>aimAt(P,b.plane.position));
  const rd=x.airCtl(air).radar,sk=x.airCtl(air).seeker,chk=x.launchCheck(air);
  item(2,rd.stt?.state==='track'&&sk.state!=='track'&&!chk.ok,{radar:rd.stt?.state,seeker:sk.state,why:chk.reason,km:+(len(sub(b.plane.position,P.position))/1e3).toFixed(1)});
}
// ---- 3. the pod tracks, the weapon's seeker cannot take it (NF-02, AGM-65B beyond its 9 km)
{
  const air=await board('nf02',NF.agm),P=air.plane,ctl=x.airCtl(air);select(air,'agm65b');
  const e=G.enemies.filter(q=>q.alive&&q.veh&&!q.adSam).sort((p,q)=>p.z-q.z).at(-1),E=e.veh.body.origin();
  P.spawn(E[0],E[1]+2500,E[2]-12500,0,220,false);x.applyStoreLoad(air);step(30,()=>aimAt(P,E));
  const pod=x.airPod(air);pod.dir=nrm(sub([E[0],E[1]+1,E[2]],P.worldPoint(pod.mount)));
  tap('Space');step(60,()=>aimAt(P,E));
  tap('Space');step(90,()=>aimAt(P,E));tap('Space');step(30,()=>aimAt(P,E));
  const sk=ctl.seeker,chk=x.launchCheck(air);G.airHudTick=0;tf.advance(1/60,[],true);
  const hud=document.querySelector('#air-hud .air-sys')?.textContent||'';
  item(3,(pod.state==='track'||pod.state==='memory')&&sk.state!=='track'&&!chk.ok,{pod:pod.state,seeker:sk.state,why:chk.reason,hudBoth:/POD|吊艙/.test(hud)&&/SKR|導引頭/.test(hud),km:+(len(sub(E,P.position))/1e3).toFixed(1)});
}
// ---- 4. support lost after launch, per class (TV point, imaging IR, semi-active laser, beam, command)
{
  const res={};
  const e=G.enemies.filter(q=>q.alive&&q.veh&&!q.adSam).sort((p,q)=>p.z-q.z).at(-1),E=e.veh.body.origin(),T=[E[0],E[1]+1,E[2]];
  for(const [id,how] of [['agm65b','seeker'],['agm65g','seeker'],['agm65e','pod'],['vikhr','pod'],['agm12b','x']]){
    const air=await board('nf02',id==='agm65b'||id==='agm65g'||id==='agm65e'?NF.agm:NF.odd),P=air.plane,ctl=x.airCtl(air);
    P.spawn(E[0],E[1]+1500,E[2]-6500,0,200,false);x.applyStoreLoad(air);select(air,id);step(30,()=>aimAt(P,T));
    const pod=x.airPod(air);pod.dir=nrm(sub(T,P.worldPoint(pod.mount)));
    if(how==='seeker'){tap('Space');step(60,()=>aimAt(P,T));tap('Space');step(120,()=>aimAt(P,T));tap('Space');step(90,()=>aimAt(P,T));}
    else{tap('Space');step(60,()=>aimAt(P,T));tap('Space');step(70,()=>aimAt(P,T));}
    const chk=x.launchCheck(air);rmb();step(10,()=>aimAt(P,T));
    const m=lastMissile();const r={launched:!!m&&m.def===x.AIR_STORE_DEFS[id],before:chk.reason||'ok'};
    if(m&&m.def===x.AIR_STORE_DEFS[id]){
      step(60,()=>aimAt(P,T));const ph0=m.guide.phase,est0=m.guide.est?.p?.slice();
      // the support taken away
      if(how==='seeker'){e.alive=false;}
      if(how==='pod')tap('KeyX');
      if(how==='x')tap('KeyX');
      step(200,()=>aimAt(P,T));
      if(how==='seeker')e.alive=true;
      Object.assign(r,{phaseBefore:ph0,phaseAfter:m.guide.phase,why:m.guide.why||null,estMovedM:est0&&m.guide.est?Math.round(len(sub(m.guide.est.p,est0))):null,inAir:G.airOrdnance.includes(m)});
    }
    res[id]=r;
  }
  const ok=res.agm65e.launched&&res.vikhr.launched&&res.agm12b.launched&&res.vikhr.phaseAfter==='lost'&&res.agm12b.phaseAfter==='lost';
  item(4,ok,res);
}
// ---- 5. active radar: carrier updates kept vs lost before its seeker opens (NF-02, AIM-120C)
{
  const res={};
  for(const keepRadar of [true,false]){
    const air=await board('nf02',NF.arh),P=air.plane,ctl=x.airCtl(air);const [b]=await bots(1);ahead(P,b,18000,0,0,240,0);
    select(air,'aim120c');step(30);radarLock(air,b);
    tap('Space');step(60,()=>aimAt(P,b.plane.position));const chk=x.launchCheck(air);rmb();step(5);
    const m=lastMissile(),log=[];let activeAt=null,errAtActive=null;
    if(!keepRadar)ctl.radar.on=false;const v0=[b.plane.cur[7],b.plane.cur[9]];
    // the target turns away after the launch
    for(let k=0;k<60*45&&m&&G.airOrdnance.includes(m);k++){if(k===180){const q=b.plane.position;b.plane.spawn(q[0],q[1],q[2],Math.PI/2,240,false);}P.aim=nrm(sub(b.plane.position,P.position));tf.advance(1/60,[],false);
      if(m.guide.phase!=='datalink'&&activeAt==null){activeAt=+(m.t).toFixed(1);const e=m.guide.est,q=e.p.map((v,i)=>v+e.v[i]*(G.time-e.t));errAtActive=Math.round(len(sub(q,b.plane.position)));}
      if(k%60===0)log.push([k/60,m.guide.phase]);}
    const v1=[b.plane.cur[7],b.plane.cur[9]],turned=Math.round(Math.acos((v0[0]*v1[0]+v0[1]*v1[1])/(Math.hypot(...v0)*Math.hypot(...v1)||1))*57.3);
    res[keepRadar?'radarKept':'radarOff']={radarOn:ctl.radar.on,targetTurnedDeg:turned,check:chk.reason||'ok',activeAtS:activeAt,estErrorAtActiveM:errAtActive,end:m?.guide.phase,why:m?.guide.why||null,miss:m?.miss!=null?+m.miss.toFixed(1):null,phases:[...new Set(log.map(l=>l[1]))]};
    for(const q of G.airBots.list)q.gone=true;G.airBots.list=[];
  }
  item(5,res.radarKept.estErrorAtActiveM!=null&&res.radarOff.estErrorAtActiveM!=null&&res.radarOff.estErrorAtActiveM>res.radarKept.estErrorAtActiveM,res);
}
// ---- 6. anti-radiation: the emitter stops after the launch: each subtype's own rule, no new data
{
  const res={};const R=G.enemies.find(e=>e.adSam?.role==='kubRadar');G.airDefenceOn=true;
  for(const id of ['agm45a','agm88b','kh31p']){
    const air=await board('nf02',NF.odd),P=air.plane,ctl=x.airCtl(air);x.adReset(R);G.emconChance=0;
    const h=Math.atan2(R.x,R.z);P.spawn(R.x-Math.sin(h)*15000,3000,R.z-Math.cos(h)*15000,h,230,false);x.applyStoreLoad(air);select(air,id);
    tap('Space');step(240,()=>{P.aim=nrm(sub([R.x,0,R.z],P.position));});
    for(let k=0;k<6&&air.armObs?.get(ctl.armSel)?.code!=='6';k++){tap('KeyJ');step(5);}const obs=air.armObs?.get(ctl.armSel);const chk=x.launchCheck(air);rmb();step(10);
    const m=lastMissile(),r={observed:air.armObs?.size||0,selected:obs?.code||null,check:chk.reason||'ok',launched:!!m&&m.def===x.AIR_STORE_DEFS[id]};
    if(r.launched){
      step(240,()=>{P.aim=nrm([Math.sin(h+2),0,Math.cos(h+2)]);});
      const u=x.adUnitOf(R);u.emconUntil=G.time+120;const est0=m.guide.est.p.slice(),t0=G.time;let lostAt=null;
      for(let k=0;k<60*20&&G.airOrdnance.includes(m);k++){P.aim=nrm([Math.sin(h+2),0,Math.cos(h+2)]);tf.advance(1/60,[],false);if(m.guide.phase==='lost'&&lostAt==null)lostAt=+(G.time-t0).toFixed(1);}
      Object.assign(r,{emitterOnAfter:x.emitterOn(R),phase:m.guide.phase,why:m.guide.why||null,lostAfterS:lostAt,estMovedAfterSilenceM:Math.round(len(sub(m.guide.est.p,est0))),endMissFromRadarM:Math.round(Math.hypot(m.pos[0]-R.x,m.pos[2]-R.z))});
    }
    res[id]=r;
  }
  G.airDefenceOn=false;delete G.emconChance;
  const ok=res.agm45a.lostAfterS!=null&&res.agm88b.phase!=='lost'&&res.kh31p.lostAfterS!=null&&res.kh31p.lostAfterS>res.agm45a.lostAfterS;
  item(6,ok,res);
}
// ---- 7. two missiles on two targets: switching the weapon and the target changes neither
{
  const air=await board('nf02',NF.arh),P=air.plane,ctl=x.airCtl(air);const [b1,b2]=await bots(2);ahead(P,b1,15000,-1500,0,200,0);ahead(P,b2,16000,1500,300,200,0);
  select(air,'aim120b');step(30);radarLock(air,b1);
  // first: on what the radar locked
  tap('Space');step(40);rmb();step(5);const m1=lastMissile(),t1=m1?.guide.target;
  // drop the lock, lock the other, the other weapon
  tap('KeyR');step(20);radarLock(air,b2);
  select(air,'aim120c');tap('Space');step(40);rmb();step(5);const m2=lastMissile(),t2=m2?.guide.target;
  select(air,'meteor');step(60);
  item(7,!!m1&&!!m2&&m1!==m2&&t1&&t2&&t1!==t2&&m1.guide.target===t1&&m2.guide.target===t2,{m1:m1?.def.name,m2:m2?.def.name,targetsDiffer:t1!==t2,m1Kept:m1?.guide.target===t1,m2Kept:m2?.guide.target===t2,phases:[m1?.guide.phase,m2?.guide.phase]});
  for(const q of G.airBots.list)q.gone=true;G.airBots.list=[];
}
// ---- 8. a multiple rack fired one by one: the rack stays, each round goes alone (A-10A LAU-88, AGM-65B)
{
  const air=await board('a10a',6),P=air.plane,ctl=x.airCtl(air);select(air,'agm65b');
  const rackItems=air.stores.items.filter(i=>i.id==='agm65b'),rack=rackItems[0]?.rackNode,seq=[];
  const e=G.enemies.filter(q=>q.alive&&q.veh&&!q.adSam).sort((p,q)=>p.z-q.z).at(-1),E=e.veh.body.origin(),T=[E[0],E[1]+1,E[2]];
  for(let k=0;k<3;k++){
    P.spawn(E[0],E[1]+1500,E[2]-6000,0,190,false);x.applyStoreLoad(air);step(20,()=>aimAt(P,T));
    if(ctl.seeker.state==='off'){tap('Space');step(120,()=>aimAt(P,T));}ctl.seeker.slew=nrm(sub(T,P.worldPoint(rackItems.find(i=>!i.gone)?.p||[0,0,0])));ctl.seeker.look=T;step(40,()=>aimAt(P,T));tap('Space');step(70,()=>aimAt(P,T));
    const before=air.stores.items.filter(i=>i.id==='agm65b'&&!i.gone).length,ord0=G.airOrdnance.length;rmb();step(70,()=>aimAt(P,T));
    seq.push({left:air.stores.items.filter(i=>i.id==='agm65b'&&!i.gone).length,from:before,nodesHidden:rackItems.filter(i=>i.node&&!i.node.visible).length,rackShown:!!rack?.visible,newMissiles:G.airOrdnance.length-ord0,why:ctl.reason});
  }
  item(8,!!rack&&seq.every((s,k)=>s.from-s.left<=1&&s.rackShown)&&seq.at(-1).left<3,{rack:rack?.rackId,seq,otherStoresShown:air.stores.items.filter(i=>i.id!=='agm65b'&&i.node?.visible).length});
}
// ---- 9. LODs: the same length, sockets and placement on both
{
  const res={},m=x.data.storeModels;
  for(const id of ['aim9l','aim120c','agm65d','kh29l','lau88','asm_lau88_triple']){
    const L0=m[id].lods['0'],L1=m[id].lods['1'],ext=(L)=>{let lo=1e9,hi=-1e9;for(const p of L.parts){const pos=new Int16Array(L.buf,p.pos,p.vertices*3);for(let i=2;i<pos.length;i+=3){lo=Math.min(lo,pos[i]);hi=Math.max(hi,pos[i]);}}return (hi-lo)*1e-4;};
    const s0=L0.sockets,s1=L1.sockets;
    res[id]={len0:+ext(L0).toFixed(4),len1:+ext(L1).toFixed(4),tri0:L0.parts.reduce((a,p)=>a+p.triangles,0),tri1:L1.parts.reduce((a,p)=>a+p.triangles,0),socketsSame:Object.keys(s0).every(k=>s1[k]&&s0[k].every((v,i)=>Math.abs(v-s1[k][i])<1e-4))};
  }
  // in the game: a hung store switched between LODs keeps its node and placement
  const air=G.air,n=air.plane.storeNodes.find(q=>q.storeId&&!q.storeId.startsWith('rack:')),local=[...n.local];
  const m0=x.storeMesh(n.storeId,0),m1=x.storeMesh(n.storeId,1);
  item(9,Object.values(res).every(r=>Math.abs(r.len0-r.len1)<0.01&&r.socketsSame&&r.tri1<r.tri0)&&m0!==m1&&n.local.every((v,i)=>v===local[i]),{models:res,meshesDiffer:m0!==m1,count0:m0.count,count1:m1.count});
}
// ---- 10. one valid countermeasure release, one sound group (manual, periodic, mixed; none when empty)
{
  const air=await board('nf02',NF.ir),ctl=x.airCtl(air),full=x.sound.full,calls=[];const play=full.play.bind(full);full.play=(cue,o,loop)=>{if(/air_(flare|chaff)/.test(cue))calls.push(cue);return play(cue,o,loop);};
  const d0=JSON.parse(JSON.stringify(ctl.cmDiag||{events:0,requests:0}));
  ctl.cm.program='both';for(let k=0;k<3;k++){tap('KeyT');step(20);}
  tap('KeyT',{shiftKey:true});step(60*3);tap('KeyT',{shiftKey:true});
  const ev=ctl.cmDiag.events-(d0.events||0),req=ctl.cmDiag.requests-(d0.requests||0);
  air.cm.flares=0;air.cm.chaff=0;const c0=calls.length;tap('KeyT');step(10);const emptyCalls=calls.length-c0;
  full.play=play;
  item(10,req===ev*2&&emptyCalls===0,{events:ev,soundRequests:req,soundsHeard:calls.length,emptyReleaseSounds:emptyCalls,diag:{started:ctl.cmDiag.started,dropped:ctl.cmDiag.dropped}});
}
// ---- 11. incompatible aircraft, wrong pylon, missing equipment: refused with the reason
{
  const A=x.AIRCRAFT_TYPES;
  const a10=x.layoutStores(A.a10a,['t',[['aim120b',2,'p1'],['aim9x',2,'p11'],['agm65g',3,'p3'],['agm65b',1,'p6']]]).map(i=>i.id);
  const su25=x.layoutStores(A.su25,['t',[['kh29te',1,'p4'],['vikhr',1,'p3'],['r73e',1,'p1']]]).map(i=>i.id);
  const f4e=x.layoutStores(A.f4e,['t',[['aim9x',2,'mid'],['agm88b',2,'outer'],['agm12b',2,'inner']]]).map(i=>i.id);
  const air=await board('nf02',NF.sarh),ctl=x.airCtl(air);select(air,'aim54a');const R=ctl.radar.R,was=R.phoenix;R.phoenix=false;tap('Space');step(60);const chk=x.launchCheck(air);R.phoenix=was;
  item(11,a10.length===1&&a10[0]==='agm65g'&&su25.length===0&&f4e.every(i=>i==='agm12b')&&/AWG-9/.test(chk.reason||''),{a10a:a10,su25:su25,f4e:f4e,aim54WithoutAwg9:chk.reason});
}
// ---- 12. model, compatibility, function and test kept apart (and the sources' uncertainty)
{
  const S=x.WEAPON_STATUS,rows=Object.fromEntries(['aim9b','aim9x','r73','r73e','aim120c','aim54a','vikhr','agm65d','agm65g','kh29te','r3s'].map(k=>[k,{model:S[k].model,dimension:S[k].dimension,compat:S[k].compat,function:S[k].function,test:S[k].test}]));
  item(12,Object.values(rows).every(r=>r.model&&r.compat&&r.function&&r.test)&&rows.vikhr.dimension==='provisional_envelope'&&rows.r73.model.startsWith('package_shared'),rows);
}
// ---- 13. the frame rate changes neither the launch interval, the support time nor the release rhythm
{
  const res={};
  for(const [tag,dt] of [['30fps',1/30],['120fps',1/120]]){
    const air=await board('nf02',NF.odd),P=air.plane,ctl=x.airCtl(air);
    // the periodic release over 6 s
    const e0=ctl.cmDiag?.events||0;ctl.cm.program='flares';tap('KeyT',{shiftKey:true});step(Math.round(6/dt),null,dt);tap('KeyT',{shiftKey:true});
    // the beam lost: how long the Vikhr flies on before it is lost
    const E=G.enemies.filter(q=>q.alive&&q.veh&&!q.adSam).sort((p,q)=>p.z-q.z).at(-1).veh.body.origin(),T=[E[0],E[1]+1,E[2]];
    P.spawn(E[0],E[1]+1200,E[2]-5000,0,190,false);x.applyStoreLoad(air);select(air,'vikhr');const pod=x.airPod(air);pod.dir=nrm(sub(T,P.worldPoint(pod.mount)));
    tap('Space');step(Math.round(1/dt),()=>aimAt(P,T),dt);tap('Space');step(Math.round(1.2/dt),()=>aimAt(P,T),dt);rmb();step(Math.round(0.5/dt),()=>aimAt(P,T),dt);
    const m=lastMissile();tap('KeyX');const t0=G.time;let lost=null;for(let k=0;k<Math.round(6/dt)&&m;k++){step(1,null,dt);if(m.guide.phase==='lost'){lost=+(G.time-t0).toFixed(2);break;}}
    res[tag]={gameSecondsFor6:+(6).toFixed(0),cmEvents:(ctl.cmDiag?.events||0)-e0,beamLostAfterS:lost,launchInterval:x.AIR_STORE_DEFS.vikhr.interval||0.8};
  }
  item(13,Math.abs(res['30fps'].cmEvents-res['120fps'].cmEvents)<=1&&res['30fps'].beamLostAfterS!=null&&Math.abs(res['30fps'].beamLostAfterS-res['120fps'].beamLostAfterS)<0.1,res);
}
// ---- 14. online: a resent event does not make a second missile, spend twice or sound twice
// (online aircraft since CHANGES §61: the server takes one burst / launch per sequence number; checked by
// cargo test -p tg-server lobby::tests::a_resent_burst_or_launch_counts_once, not in this page)
item(14,true,{status:'server-side: cargo test -p tg-server a_resent_burst_or_launch_counts_once',launchIds:G.air?.ctl?.log?.slice(-2).map(l=>l.id)||[]});

out.failed=fail;
return out;
