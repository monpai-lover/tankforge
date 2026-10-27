// User report: hit by AI enemy aircraft, no damage. The player's AA vehicle (Pantsir) on the range; an enemy attack
// aircraft (the AA vehicle's attackers) put 2.5 km out at 500 m on a run at it: its rounds that reach
// the vehicle and what the player's combat model made of them (calls, modules / crew hit, destroyed).
const tf=window.__tf,x=window.__tfx,G=tf.G,out={};
const next=()=>new Promise(r=>setTimeout(r,0));
await tf.coreReady();await x.flightCoreP;tf.finishThumbs();
tf.select(window.__VEH||'ad_pantsir');tf.startBattle();tf.pause(true);G.airDefenceOn=false;
for(let i=0;i<60;i++)tf.advance(1/60,[],false);
const calls={n:0,modules:0,crew:0};const sh=G.combat.shoot.bind(G.combat);G.combat.shoot=(key,st,shot)=>{const r=sh(key,st,shot);if(key===G.combatKey){calls.n++;calls.modules+=r?.modules?.length||0;calls.crew+=r?.crew?.length||0;}return r;};
while(x.airBots.list.length)x.airBots.list.pop();
G.airBotsOn=true;await x.spawnBot();for(let i=0;i<60&&!x.airBots.list.length;i++)await next();
const b=x.airBots.list[0];if(!b)return{error:'no bot'};
const p=[G.s.x,0,G.s.z];b.plane.spawn(p[0],x.missileTerrain?600:600,p[2]+2500,Math.PI,170,false);
const caps0=JSON.stringify(G.caps||{});let minD=1e9,fired0=b.guns.reduce((s,g)=>s+g.fired,0);
for(let k=0;k<40*60;k++){tf.advance(1/60,[],false);const q=b.plane.position;minD=Math.min(minD,Math.hypot(q[0]-G.s.x,q[2]-G.s.z));if(G.caps?.destroyed)break;}
out.bot=b.plane.type.id;out.guns=b.guns.map(g=>g.kind+':'+g.id);out.fired=b.guns.reduce((s,g)=>s+g.fired,0)-fired0;out.closestM=Math.round(minD);
out.playerHits=calls;out.destroyed=!!G.caps?.destroyed;out.capsChanged=JSON.stringify(G.caps||{})!==caps0;out.crewAlive=G.caps?.crew_alive;
return out;
