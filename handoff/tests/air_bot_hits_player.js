// User report: hit by AI enemy aircraft, no damage. The player flying straight and level; an enemy
// aircraft put 400 m behind on the same heading and speed: its rounds fired, how many pass within 10 m
// of the player, the player's damage (parts' hp lost, summary) after 12 s. __TYPES: the player's type.
const tf=window.__tf,x=window.__tfx,G=tf.G,out={};
const next=()=>new Promise(r=>setTimeout(r,0));
await tf.coreReady();await x.flightCoreP;tf.pause(true);G.airDefenceOn=false;G.airBotsOn=false;tf.finishThumbs();
for(const id of (window.__TYPES||'p51d,f4e').split(',')){
  if(G.air?.active)x.exitAircraft(true);
  G.airLoadout[id]=0;document.querySelector(`.hangar-card[data-air=${id}]`).click();
  for(let i=0;i<120&&!(G.air?.active&&G.air.plane.type.id===id);i++){tf.advance(1/60,[],false);await next();}
  const air=G.air,P=air.plane;P.spawn(0,2500,0,0,P.type.sound==='jet'?220:140,false);const D=P.damage;P.state.throttle=0.8;P.aim=[0,0,1];tf.advance(0.5,[],false);
  while(x.airBots.list.length)x.airBots.list.pop();
  await x.spawnBot();for(let i=0;i<30&&!x.airBots.list.length;i++)await next();
  const b=x.airBots.list[0];if(!b){out[id]={error:'no bot'};continue;}
  const S=P.cur,v=Math.hypot(S[7],S[8],S[9]);b.plane.spawn(P.position[0],P.position[1]+3,P.position[2]-400,0,v,false);b.plane.state.throttle=0.8;
  const calls={n:0,hit:0,minMiss:1e9};const h0=D.hit.bind(D);D.hit=(a,e,...r)=>{calls.n++;const q=h0(a,e,...r);if(q)calls.hit++;return q;};
  const hp0=D.parts.reduce((s,p)=>s+p.hp,0);let near=0,fired0=b.guns.reduce((s,g)=>s+g.fired,0);const seen=new Set();
  for(let k=0;k<12*60;k++){P.aim=[0,0,1];tf.advance(1/60,[],false);
    for(const q of [...G.bullets,...G.shots]){if(q.ownAir||seen.has(q))continue;const p=q.s.pos;if(Math.hypot(p[0]-P.position[0],p[1]-P.position[1],p[2]-P.position[2])<10){seen.add(q);near++;}}
    if(P.crashed)break;}
  out[id]={bot:b.plane.type.id,botGuns:b.guns.map(g=>g.kind+':'+g.id),fired:b.guns.reduce((s,g)=>s+g.fired,0)-fired0,nearPlayer:near,hpLost:Math.round(hp0-D.parts.reduce((s,p)=>s+p.hp,0)),summary:D.summary(),gap:Math.round(Math.hypot(...b.plane.position.map((c,i)=>c-P.position[i]))),crashed:P.crashed,calls};
}
return out;
