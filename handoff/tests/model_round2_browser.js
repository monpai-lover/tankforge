// Run on the debug handoff page with pyShot, as for the other handoff browser checks.
const tf=window.__tf, x=window.__tfx, G=tf.G, out={};
const check=(value,message)=>{if(!value)throw Error(message);};
const next=()=>new Promise(r=>setTimeout(r,0));
async function board(id){
  document.querySelector(`.hangar-card[data-air=${id}]`).click();
  // Garage take-off is deliberately deferred to update(); the harness keeps RAF paused.
  for(let i=0;i<120&&!(G.air?.active&&G.air.plane.type.id===id);i++){
    tf.advance(1/60,[],false);await next();
  }
  check(G.air?.active&&G.air.plane.type.id===id,`${id} did not enter flight`);
}
await tf.coreReady(); await x.flightCoreP;
tf.pause(true);
// This is a model/animation check: keep real renderer passes but reduce only background cloud cost.
tf.setQuality('low'); tf.renderer.q={...tf.renderer.q,dome:64,cloudSteps:4}; tf.renderer._buildDome(64);
tf.finishThumbs();
document.querySelector('#g-mode .tab[data-g=air]').click(); await next();
check(G.airGarage?.plane,'hangar did not initialize');
document.querySelectorAll('#g-info,#g-bottom,#g-top').forEach(el=>el.style.visibility='hidden');
async function preview(id,gear,flaps,deadLeft=false){
  document.querySelector(`#air-list .card[data-air=${id}]`).click(); await next();
  const p=G.airGarage.plane; check(p.type.id===id,`wrong preview: ${id}`);
  p.cur[1]+=3;p.prev[1]=p.cur[1];p.cur[35]=p.prev[35]=100;
  p.cur[33]=p.prev[33]=gear;p.cur[34]=p.prev[34]=flaps;
  if(deadLeft)p.damage.harm('wing_l',1e6,false,()=>1);
  p.applyDamage();p.pose(1);
  const c=p.drawPos,L=Math.max(G.airGarage.size.len,G.airGarage.size.span);
  G.camOverride={pivot:Array.from(c),dist:L*1.05,fov:.75};G.cam.yaw=p.heading+.72;G.cam.pitch=-.48;
  tf.advance(1/60,[],true);
  const controls=p.controls.filter(c=>['gear','flap'].includes(c.type)).map(c=>({type:c.type,side:c.sign,visible:c.node.visible,position:Array.from(c.node.local.slice(12,15))}));
  check(controls.every(c=>c.position.every(Number.isFinite)),`${id}: invalid posed controls`);
  check(!deadLeft || !p.wings.l.visible&&p.wings.r.visible,`${id}: detached side still visible`);
  check(!deadLeft || controls.filter(c=>c.type==='gear'&&c.side<0).every(c=>!c.visible),`${id}: detached wing gear still visible`);
  await pyShot(`${id}-${deadLeft?'left-wing-removed':'gear-'+gear+'-flaps-'+flaps}`);
  return {gear,flaps,controls,leftVisible:p.wings.l.visible,rightVisible:p.wings.r.visible};
}
out.bf109=await preview('bf109g',.5,1);
out.corsair=await preview('f4u1d',.5,1);
out.me262Intact=await preview('me262',1,0);
out.me262=await preview('me262',1,0,true);
out.mig17=await preview('mig17f',1,0,true);
G.camOverride=null;
await board('mig21');
let p=G.air.plane;p.spawn(-8000,1500,-8000,0,220,false);p.state.camera=1;
tf.advance(1/60,[],true);
out.cockpit={eye:Array.from(p.type.eye),camera:p.state.camera,hud:!!document.querySelector('#air-hud')};
check(out.cockpit.eye.every(Number.isFinite),'invalid cockpit eye');await pyShot('mig21-cockpit');
x.exitAircraft(true);
await board('p51d');
p=G.air.plane;p.spawn(-8000,1500,-8000,0,140,false);p.damage.harm('wing_l',1e6,false,()=>1);p.applyDamage();
const before=G.air.guns.map(g=>g.ammo);G.air.fireAll=true;tf.advance(.15,[],false);G.air.fireAll=false;
out.guns=G.air.guns.map((g,i)=>({owner:g.owner,fired:before[i]-g.ammo}));
check(out.guns.filter(g=>g.owner==='wing_l').every(g=>g.fired===0),'detached guns still fired');
check(out.guns.filter(g=>g.owner==='wing_r').every(g=>g.fired>0),'intact guns stopped firing');
check(p.wings.l.visible===false&&p.wings.r.visible===true,'damage ownership did not reach live model');
return out;
