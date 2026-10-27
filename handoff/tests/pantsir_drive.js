// The Pantsir (ru_pantsir_sm_sv) on the range: how its running gear looks standing and driving (close
// side views), its speed against time on full throttle, its top speed, and the same for the T-72A.
const tf=window.__tf,x=window.__tfx,G=tf.G,out={};
const frames=(n)=>new Promise(r=>{let k=0;const f=()=>(++k>=n?r():requestAnimationFrame(f));requestAnimationFrame(f);});
await tf.coreReady();tf.finishThumbs();
const side=async(name,keys=[])=>{G.airBotsOn=false;if(x.airBots)x.airBots.list.length=0;if(G.pad)G.pad.autoAim=false;G.camOverride={fov:0.6,dist:window.__DIST||7};G.cam.yaw=G.s.heading-Math.PI/2;G.cam.pitch=window.__PITCH??-0.3;tf.advance(1/60,keys,true);G.cam.yaw=G.s.heading-Math.PI/2;G.cam.pitch=window.__PITCH??-0.3;tf.advance(1/60,keys,true);const hid=[];const walk=(el)=>{for(const e of el.children){if(e.tagName==='CANVAS')continue;if(e.querySelector('canvas'))walk(e);else if(getComputedStyle(e).visibility!=='hidden')hid.push(e);}};walk(document.body);hid.forEach(e=>e.style.visibility='hidden');await frames(2);await pyShot(name);hid.forEach(e=>e.style.visibility='');G.camOverride=null;};
for(const id of (window.__VEH||'ru_pantsir_sm_sv,su_t72a').split(',')){
  if(G.mode==='battle')tf.toGarage();
  tf.select(id);await frames(10);
  if(id==='ru_pantsir_sm_sv')await pyShot('garage_'+id);
  tf.startBattle();await frames(5);tf.pause(true);
  tf.advance(1,[],false);
  out.camKeys=Object.keys(G.cam);
  if(id==='ru_pantsir_sm_sv')await side('stand');
  const r={curve:[]};let vmax=0;
  for(let k=0;k<60*40;k++){tf.advance(1/60,['fwd'],false);const v=Math.abs(G.s.u||0);vmax=Math.max(vmax,v);if(k%120===0)r.curve.push([k/60,+(v*3.6).toFixed(1),G.s.gear]);
    if(id==='ru_pantsir_sm_sv'&&k===60*8)await side('drive',['fwd']);}
  r.topKmh=+(vmax*3.6).toFixed(1);
  // pivot on the spot and reverse
  tf.advance(4,['brake'],false);const h0=G.s.heading;tf.advance(3,['left'],false);r.pivotDegS=+(Math.abs(Math.atan2(Math.sin(G.s.heading-h0),Math.cos(G.s.heading-h0)))/3*57.3).toFixed(1);
  let vr=0;for(let k=0;k<60*8;k++){tf.advance(1/60,['back'],false);vr=Math.max(vr,Math.abs(G.s.u||0));}r.reverseKmh=+(vr*3.6).toFixed(1);
  out[id]=r;
}
return out;
