// Each new subtype flown once from NF-02 (the game's own test aircraft) at a range target: the air-to-air
// ones at an enemy aircraft (the infrared ones also by lock after launch on the radar's track), the
// air-to-ground ones at a range vehicle; the phases each went through, its end and miss. With
// tests/air_aamagm.js this is what WEAPON_STATUS.test reports.
const tf=window.__tf,x=window.__tfx,G=tf.G,out={};
const next=()=>new Promise(r=>setTimeout(r,0));
await tf.coreReady();await x.flightCoreP;tf.pause(true);G.airDefenceOn=false;tf.finishThumbs();tf.setQuality('low');
const step=(n,fn)=>{for(let i=0;i<n;i++){fn?.(i);tf.advance(1/60,[],false);}};
const live=(fn)=>{const p=G.paused;G.paused=false;try{fn();}finally{G.paused=p;}};
const tap=(code,o={})=>{live(()=>window.dispatchEvent(new KeyboardEvent('keydown',{code,bubbles:true,...o})));live(()=>window.dispatchEvent(new KeyboardEvent('keyup',{code,bubbles:true,...o})));};
const canvas=[...document.querySelectorAll('canvas')].filter(c=>!c.closest('#air-hud')).sort((a,b)=>b.width*b.height-a.width*a.height)[0];
const rmb=()=>live(()=>{canvas.dispatchEvent(new MouseEvent('mousedown',{button:2,bubbles:true}));canvas.dispatchEvent(new MouseEvent('mouseup',{button:2,bubbles:true}));});
const say=(k,v)=>console.log('@@'+k+' '+JSON.stringify(v));
const sub=(a,b)=>a.map((v,i)=>v-b[i]),len=(a)=>Math.hypot(...a),nrm=(a)=>{const l=len(a)||1;return a.map(v=>v/l);};
const aimAt=(P,at)=>{P.aim=nrm(sub(at,P.position));P.aimBias=[0,0,0,1];};
const select=(air,id)=>{for(let k=0;k<14&&air.stores.groups[air.stores.sel]!==id;k++)tap('KeyY');return air.stores.groups[air.stores.sel]===id;};
async function board(lo){
  if(G.air?.active)x.exitAircraft(true);
  G.airLoadout.nf02=lo;document.querySelector('.hangar-card[data-air=nf02]').click();
  for(let i=0;i<120&&!(G.air?.active&&G.air.plane.type.id==='nf02');i++){tf.advance(1/60,[],false);await next();}
  const air=G.air;if(air.stores.index!==lo){air.stores=x.mountStores(air.plane,'nf02',lo);air.ctl=null;}
  air.plane.spawn(0,3500,0,0,240,false);x.applyStoreLoad(air);air.plane.state.throttle=0.9;x.airCtl(air);step(10);return air;
}
async function bot(){
  for(const q of G.airBots.list)q.gone=true;G.airBots.list=[];
  G.airBotsOn=true;for(let i=0;i<900&&!G.airBots.list.length;i++){tf.advance(1/60,[],false);await next();}G.airBotsOn=false;
  const b=G.airBots.list[0];b.flares=0;b.chaff=0;b.missileAt=1e9;return b;
}
function radarLock(air,b){const P=air.plane,rd=x.airCtl(air).radar;
  for(let k=0;k<60*8&&!(rd.tracks&&[...rd.tracks.keys()].includes(b));k++){aimAt(P,b.plane.position);tf.advance(1/60,[],false);}
  x.airCtl(air).selected=b.target;tap('KeyR');for(let k=0;k<60*4&&rd.stt?.state!=='track';k++){aimAt(P,b.plane.position);tf.advance(1/60,[],false);}
  return rd.stt?.state==='track';}
const NF={ir:4,irx:5,sarh:6,arh:7,agm:8,odd:9};
/** One flight: the phases, the end, the miss, the target down. */
function fly(m,b,watch){const phases=[],t0=G.time;let down=false;
  for(let k=0;k<60*90&&m&&G.airOrdnance.includes(m);k++){watch?.();tf.advance(1/60,[],false);if(phases.at(-1)?.[0]!==m.guide.phase)phases.push([m.guide.phase,+(G.time-t0).toFixed(1)]);}
  if(b)down=!!(b.down||x.airDown(b.plane));
  return {phases,why:m?.guide.why||null,miss:m?.miss!=null?+m.miss.toFixed(1):null,down,decoyed:!!m?.decoyed};}
// ---- air to air
const air2air=[['aim9x',NF.ir,'loal',12500],['irist',NF.ir,'lock',4000],['asraam',NF.ir,'loal',16500],['mica_ir',NF.ir,'lock',4000],['r73e',NF.irx,'lock',3500],['aim9m',NF.irx,'lock',3000],['r27t1',NF.irx,'lock',6000],['r27et1',NF.irx,'lock',8000],
  ['aim7m',NF.sarh,'radar',12000],['r27r1',NF.sarh,'radar',12000],['r27er1',NF.sarh,'radar',16000],['aim54a',NF.sarh,'radar',32000],['aim120b',NF.arh,'radar',16000],['aim120c',NF.arh,'radar',16000],['rvvae',NF.arh,'radar',16000],['meteor',NF.arh,'radar',30000],['mica_em',NF.arh,'radar',14000]];
for(const [id,lo,how,dist] of air2air){
  const air=await board(lo),P=air.plane,b=await bot();
  const q=P.position;b.plane.spawn(q[0]+200,q[1]+150,q[2]+dist,0,200,false);b.plane.state.throttle=0.7;
  select(air,id);step(20);
  let r={how};
  if(how==='radar'||how==='loal'){x.airCtl(air).radar.scale=dist>18e3?80:40;r.radar=radarLock(air,b);}
  tap('Space');step(how==='lock'?150:90,()=>aimAt(P,b.plane.position));
  const chk=x.launchCheck(air);r.check=chk.ok?(chk.loal?'ok (LOAL)':'ok'):chk.reason;r.seeker=x.airCtl(air).seeker.state;
  const n0=G.airOrdnance.length;rmb();step(3);const m=G.airOrdnance.slice(n0).find(o=>o.owner==='player');
  r.launched=!!m&&m.def===x.AIR_STORE_DEFS[id];
  if(r.launched){r.loal=!!m.guide.loal;Object.assign(r,fly(m,b,()=>aimAt(P,b.plane.position)));}
  out[id]=r;say(id,r);
}
// ---- air to ground at a range vehicle
const e=G.enemies.filter(q=>q.alive&&q.veh&&!q.adSam).sort((p,q)=>p.z-q.z).at(-1),E=e.veh.body.origin(),T=[E[0],E[1]+1,E[2]],ei=G.enemies.indexOf(e);
for(const [id,lo] of [['agm65b',NF.agm],['agm65g',NF.agm],['agm65e',NF.agm],['kh29te',NF.agm],['vikhr',NF.odd],['agm12b',NF.odd]]){
  const air=await board(lo),P=air.plane,ctl=x.airCtl(air);
  P.spawn(E[0],E[1]+1500,E[2]-6500,0,200,false);x.applyStoreLoad(air);select(air,id);step(30,()=>aimAt(P,T));
  const pod=x.airPod(air);pod.dir=nrm(sub(T,P.worldPoint(pod.mount)));
  if(id==='agm12b'){tap('Space');step(40,()=>aimAt(P,T));}
  else if(id==='agm65e'||id==='vikhr'){tap('Space');step(60,()=>aimAt(P,T));tap('Space');step(70,()=>aimAt(P,T));}
  else {tap('Space');step(60,()=>aimAt(P,T));tap('Space');step(120,()=>aimAt(P,T));tap('Space');step(90,()=>aimAt(P,T));}
  for(let k=0;k<600&&!tf.enemyCombat(ei).alive;k++)tf.advance(1/60,[],false);
  const chk=x.launchCheck(air),n0=G.airOrdnance.length;G.lastHit=null;rmb();step(3);const m=G.airOrdnance.slice(n0).find(o=>o.owner==='player');
  const r={check:chk.ok?'ok':chk.reason,launched:!!m&&m.def===x.AIR_STORE_DEFS[id]};
  if(r.launched){
    // the command missile: the stick toward the target (the pilot's correction), the aircraft holding attitude
    const watch=id==='agm12b'?()=>{const g=m.guide,l=sub(T,m.pos),f=nrm(m.vel),rr=nrm([f[2],0,-f[0]]),u=[-f[0]*f[1],1-f[1]*f[1],-f[2]*f[1]];const lr=l.reduce((a,v,i)=>a+v*rr[i],0)/len(l),lu=l.reduce((a,v,i)=>a+v*u[i],0)/len(l);g.cmd[0]=Math.max(-1,Math.min(1,lr*6));g.cmd[1]=Math.max(-1,Math.min(1,lu*6));}:()=>aimAt(P,T);
    Object.assign(r,fly(m,null,watch));r.endFromTargetM=Math.round(Math.hypot(m.pos[0]-E[0],m.pos[2]-E[2]));
    step(60);const c=tf.enemyCombat(ei);r.target={alive:c.alive,destroyed:!!c.caps?.destroyed,hit:G.lastHit?{result:G.lastHit.result,title:G.lastHit.title}:null};
  }
  out[id]=r;say(id,r);
}
return out;
