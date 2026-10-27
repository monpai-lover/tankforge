// User requests: the Gepard had no radar (a bug), its search radar should turn, and a radar lock should
// lay the guns on the aircraft with the radar's lead (the view following), the mouse fine-laying, the
// guns firing on that lead. The player's Gepard on the range, an enemy aircraft passing 2.5 km out:
// the radar mode, the antenna's turning, R's lock, the guns' error from the lead, a mouse nudge held as
// an offset, the 35 mm rounds fired and what they did.
const tf=window.__tf,x=window.__tfx,G=tf.G,out={};
const next=()=>new Promise(r=>setTimeout(r,0));
await tf.coreReady();await x.flightCoreP;tf.finishThumbs();
if(window.__GAINS)G.leadGains=window.__GAINS;tf.select(window.__VEH||'de_gepard');tf.startBattle();tf.pause(true);G.airDefenceOn=false;
const live=(fn)=>{const p=G.paused;G.paused=false;try{fn();}finally{G.paused=p;}};
const tap=(code)=>{live(()=>window.dispatchEvent(new KeyboardEvent('keydown',{code,bubbles:true})));live(()=>window.dispatchEvent(new KeyboardEvent('keyup',{code,bubbles:true})));};
for(let i=0;i<30;i++)tf.advance(1/60,[],false);
const pad=G.pad,sp=G.model.spinners||[];
out.mode={pad:!!pad,role:pad?.role,radar:!!pad?.cfg?.search,name:pad?.cfg?.name,spinners:sp.map(s=>s.name)};
const y0=sp[0]?.node.yaw;tf.advance(0.5,[],false);out.antennaTurnedDeg=sp[0]?Math.round(((sp[0].node.yaw-y0)*57.3+720)%360):null;
while(x.airBots.list.length)x.airBots.list.pop();
G.airBotsOn=true;await x.spawnBot();for(let i=0;i<60&&!x.airBots.list.length;i++)await next();
const b=x.airBots.list[0];if(!b)return{...out,error:'no bot'};G.airBotsOn=false;x.airBots.list.splice(0,x.airBots.list.length,b);const keepOne=setInterval(()=>{x.airBots.pending=true;},0);x.airBots.pending=true;
const h=G.s;b.plane.spawn(h.x-(window.__DX||2500),window.__ALT||600,h.z+(window.__DZ||2200),Math.PI/2,170,false);b.plane.state.throttle=0.7;
// unarmed (its fire on the Gepard is ad_bot_hits_player.js's)
for(const g of b.guns)g.ammo=0;if(b.stores)for(const it of b.stores.items||[])it.gone=true;
const fixed=[1,0,0];Object.defineProperty(b.plane,'aim',{get:()=>fixed,set:()=>{},configurable:true});
for(let i=0;i<120&&!pad.contacts.length;i++)tf.advance(1/60,[],false);
out.contacts=pad.contacts.length;
G.cam.yaw=Math.atan2(b.plane.position[0]-h.x,b.plane.position[2]-h.z);tf.advance(1/60,[],false);
tap('KeyR');let tk=0;for(;tk<480&&!(pad.u.track?.radar&&pad.autoAim);tk++)tf.advance(1/60,[],false);
out.lock={afterS:+(tk/60).toFixed(1),locked:!!pad.lock,track:pad.u.track?.radar?'radar':pad.u.track?'other':null,autoAim:!!pad.autoAim,reason:pad.reason};
const rows=[];const tv=()=>[b.plane.cur[7],b.plane.cur[8],b.plane.cur[9]];
for(let i=0;i<240;i++){tf.advance(1/60,[],false);const tr=pad.u.track,L=pad.lead;if(i%6===0)rows.push([+(i/60).toFixed(2),tr?.n,pad.leadF?.n,L?+(Math.atan2(L.dir[0],L.dir[2])*1000).toFixed(1):null,L?+(Math.asin(L.dir[1])*1000).toFixed(1):null,tr?+Math.hypot(...tr.v.map((v,k)=>v-tv()[k])).toFixed(1):null,tr?.acc?+Math.hypot(...tr.acc).toFixed(1):null,L?+L.tof.toFixed(2):null]);}
return {rows};
