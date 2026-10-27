// The user's Pantsir (ru_pantsir_sm_sv) as its own vehicle: its imported model in the garage, its combat on
// the surface core (triangle-surface armour: crates/combat/src/surface_armor.rs), the player's AA mode
// (radars, its four cannons on the radar's lead, the 57E6 from its tubes), its turning search radar.
const tf=window.__tf,x=window.__tfx,G=tf.G,out={};
const next=()=>new Promise(r=>setTimeout(r,0));
await tf.coreReady();await x.flightCoreP;tf.finishThumbs();
for(let i=0;i<200&&!G.combat?.surfaceCore;i++)await new Promise(r=>setTimeout(r,50));
tf.select('ru_pantsir_sm_sv');for(let i=0;i<20;i++)await next();
const M=G.model;
out.garage={id:G.id,model:!!M,spinners:(M?.spinners||[]).map(s=>s.name),turrets:M?.turrets?.length,nodes:M?.shellNodes?.length};
out.core={surfaceCore:!!G.combat.surfaceCore,onSurfaceCore:G.combat.coreOf('ru_pantsir_sm_sv')===G.combat.surfaceCore,info:x.data.surfaceCoreInfo?.sha256?.slice(0,12)};
// a 30 mm round at its front, through the core it runs on (hull space)
const fresh=G.combat.fresh('ru_pantsir_sm_sv',x.data.vehicles.ru_pantsir_sm_sv);
const pj=x.data.projectiles.pantsir_30_ap_est||Object.values(x.data.projectiles).find(p=>p.caliber_mm===30);
const rep=G.combat.shoot('ru_pantsir_sm_sv',fresh.state,{shell:pj,origin:[-0.5,1.2,40],dir:[0,0,-1],speed_ms:900,distance_m:500,seed:7,turret_yaw:0});
out.frontShot={outcome:rep?.outcome,plate:rep?.plate,layers:(rep?.layers||[]).map(l=>[l.plate.split(':').slice(0,2).join(':'),l.thickness_mm,Math.round(l.angle_deg),l.passed]).slice(0,4),spall:(rep?.fragments||[]).filter(f=>f.kind==='spall').length,modules:(rep?.modules||[]).map(m=>m.id||m).slice(0,6)};
// battle: the AA mode
tf.startBattle();tf.pause(true);G.airDefenceOn=false;
for(let i=0;i<30;i++)tf.advance(1/60,[],false);
const pad=G.pad;
out.ad={pad:!!pad,role:pad?.role,ownGuns:!!pad?.cfg?.ownGuns,missile:pad?.def?.name,rails:pad?.sam?.rails?.length,radar:!!pad?.cfg?.search};
const sp=G.model.spinners?.[0],y0=sp?.node.yaw;tf.advance(0.5,[],false);out.antennaTurnedDeg=sp?Math.round((((sp.node.yaw-y0)*57.3)%360+360)%360):null;
while(x.airBots.list.length)x.airBots.list.pop();
G.airBotsOn=true;await x.spawnBot();for(let i=0;i<60&&!x.airBots.list.length;i++)await next();
const b=x.airBots.list[0];G.airBotsOn=false;x.airBots.list.splice(0,x.airBots.list.length,b);const keep=setInterval(()=>{x.airBots.pending=true;},0);
for(const g of b.guns)g.ammo=0;if(b.stores)for(const it of b.stores.items||[])it.gone=true;
const h=G.s;b.plane.spawn(h.x-3000,700,h.z+4000,Math.PI/2,170,false);b.plane.state.throttle=0.7;
const fixed=[1,0,0];Object.defineProperty(b.plane,'aim',{get:()=>fixed,set:()=>{},configurable:true});
for(let i=0;i<180&&!pad.contacts.length;i++)tf.advance(1/60,[],false);
out.contacts=pad.contacts.length;
G.cam.yaw=Math.atan2(b.plane.position[0]-h.x,b.plane.position[2]-h.z);tf.advance(1/60,[],false);
const live=(fn)=>{const p=G.paused;G.paused=false;try{fn();}finally{G.paused=p;}};
const tap=(code)=>{live(()=>window.dispatchEvent(new KeyboardEvent('keydown',{code,bubbles:true})));live(()=>window.dispatchEvent(new KeyboardEvent('keyup',{code,bubbles:true})));};
tap('KeyR');let tk=0;for(;tk<480&&!(pad.u.track?.radar&&pad.autoAim);tk++)tf.advance(1/60,[],false);
out.lock={afterS:+(tk/60).toFixed(1),track:pad.u.track?.radar?'radar':null,autoAim:!!pad.autoAim};
for(let i=0;i<90;i++)tf.advance(1/60,[],false);
// a missile on N: from a tube
const n0=x.airOrdnance.length;G.mgHeld=true;tf.advance(1/60,[],false);G.mgHeld=false;tf.advance(1/60,[],false);
const m=x.airOrdnance.slice(n0).find(o=>o.owner==='player');
out.missile=m?{def:m.def.name,phase:m.guide?.phase,fromTubeM:+Math.hypot(...m.pos.map((v,k)=>v-[h.x,0,h.z][k]).map((v,k)=>k===1?0:v)).toFixed(1),y:+m.pos[1].toFixed(2),railsLeft:pad.sam.rails.filter(r=>r.loaded).length}:{why:pad.reason};
let res=null;for(let i=0;i<60*14&&m&&!res;i++){tf.advance(1/60,[],false);if(!x.airOrdnance.includes(m))res={s:+(i/60).toFixed(1),down:!!b.down||!!b.plane.crashed,hurt:b.plane.damage.parts.filter(p=>p.hp<p.max).length};}
out.missileResult=res;
clearInterval(keep);x.airBots.pending=false;
return out;
