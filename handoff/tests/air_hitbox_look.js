// Pictures of the aircraft structure: the F-15C and P-51D from above, intact and with the right outer
// wing panel, the fin and the left tailplane half shot away (the debris falling beside).
const tf=window.__tf,x=window.__tfx,G=tf.G,out={};
const next=()=>new Promise(r=>setTimeout(r,0)),frames=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
await tf.coreReady();await x.flightCoreP;tf.pause(true);tf.finishThumbs();
document.querySelectorAll('#air-hud, #toast, .toast, #lock-hint, .lock-hint').forEach(el=>el.style.display='none');
const rnd=()=>0.99;
for(const id of ['f15c','p51d']){
  if(G.air?.active)x.exitAircraft(true);
  G.airLoadout[id]=0;document.querySelector(`.hangar-card[data-air=${id}]`).click();
  for(let i=0;i<120&&!(G.air?.active&&G.air.plane.type.id===id);i++){tf.advance(1/60,[],false);await next();}
  const P=G.air.plane;P.spawn(0,1500,0,0,200,false);x.applyStoreLoad(G.air);
  const cam0=P.camera.bind(P);P.camera=()=>{const c=P.drawPos,eye=[c[0]+0.5,c[1]+34,c[2]-3],d=[c[0]-eye[0],c[1]-eye[1],c[2]-eye[2]],l=Math.hypot(...d);return{camPos:eye,fwd:d.map(v=>v/l),fovY:0.7};};
  tf.advance(1/60,[],true);await frames();await pyShot(id+'_intact');
  const D=P.damage;
  for(const k of ['wing_r_out','fin','htail_l'])if(D.by[k])D.harm(k,1e4,false,rnd);
  P.applyDamage();
  for(let k=0;k<25;k++)tf.advance(1/60,[],false);
  tf.advance(1/60,[],true);await frames();await pyShot(id+'_damaged');
  out[id]={summary:D.summary(),debris:P.debris.length};
  P.camera=cam0;
}
return out;
