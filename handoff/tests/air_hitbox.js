// The aircraft hitbox from the drawn triangles and the structure (user request: a finer hitbox and
// structure). Per type: the triangle count and content hash, how many rays the old boxes counted as
// hits that miss the drawn airframe, the outer wing panel shot away (its aileron with it, the inner
// wing kept, the lift left, out of the hitbox, drawn falling), the rear fuselage shot away (fin and
// tailplanes with it), the radar shot out, the fuselage broken; a flight with an outer panel gone vs a
// whole wing; a picture of the damaged airframe with its debris.
const tf=window.__tf,x=window.__tfx,G=tf.G,out={types:{}};
const check=(value,message)=>{if(!value)throw Error(message);};
const next=()=>new Promise(resolve=>setTimeout(resolve,0));
await tf.coreReady();await x.flightCoreP;tf.pause(true);G.airDefenceOn=false;tf.finishThumbs();
tf.setQuality('low');
async function board(id){
  if(G.air?.active)x.exitAircraft(true);
  G.airLoadout[id]=0;
  document.querySelector(`.hangar-card[data-air=${id}]`).click();
  for(let i=0;i<120&&!(G.air?.active&&G.air.plane.type.id===id);i++){tf.advance(1/60,[],false);await next();}
  check(G.air?.active&&G.air.plane.type.id===id,`${id}: could not board`);
  return G.air;
}
const rnd=()=>0.99;
// a vertical round through the local point (x, z), hard enough to kill what it crosses after a few
const through=(D,px,pz,e=4e7)=>D.hit([px,6,pz],[px,-6,pz],e,0,false,rnd);
const centre=(D,id)=>D.by[id]&&D.by[id].c;
for(const id of (window.__TYPES||'p51d,nf01,nf02,mig15,f4e,f15c,su27,mirage3e').split(',')){
  const air=await board(id),P=air.plane;
  P.spawn(0,2500,0,0,200,false);x.applyStoreLoad(air);tf.advance(1/60,[],false);
  const hb=P.hitbox,D=P.damage,r={tris:hb.count,hash:hb.hash,parts:D.parts.length};
  // the old boxes against the drawn airframe: random vertical rays through the skin boxes
  let boxHits=0,triMiss=0;
  for(let k=0;k<1500;k++){
    const s=D.skin[k%D.skin.length],px=s.c[0]+(Math.random()*2-1)*s.h[0],pz=s.c[2]+(Math.random()*2-1)*s.h[2];
    boxHits++;
    if(!x.airHitboxQuery(hb,[px,8,pz],[px,-8,pz],D.alive()).length)triMiss++;
  }
  r.boxRaysMissingTheAirframe=+(triMiss/boxHits).toFixed(3);
  // the outer right panel: down through its centre until it goes
  const ow=centre(D,'wing_r_out');
  if(ow){
    let n=0;while(!D.gone('wing_r_out')&&n<40){through(D,ow[0],ow[2]);n++;}
    P.applyDamage();
    r.outer={rounds:n,gone:D.gone('wing_r_out'),aileronGone:D.gone('aileron_r'),innerKept:!D.gone('wing_r'),liftR:+D.flight()[2].toFixed(2),roll:+D.flight()[4].toFixed(2),nodeHidden:!P.wingsOut.r.visible,debris:P.debris.length,again:through(D,ow[0],ow[2])===null,down:x.airDown?x.airDown(P):null};
    check(r.outer.gone&&r.outer.aileronGone===(D.by.aileron_r?.parent==='wing_r_out')&&r.outer.innerKept,`${id}: outer panel structure ${JSON.stringify(r.outer)}`);
    check(r.outer.again,`${id}: a round through the gone panel still hit`);
    check(r.outer.nodeHidden&&r.outer.debris>=1,`${id}: panel not drawn falling`);
  }
  // the rear fuselage: from the side through its middle
  // (through the middle of its drawn triangles, which is inside the cone)
  const tl=[0,0,0];let m=0;
  hb.piece.forEach((pc,i)=>{if(hb.pieces[pc].name!=='tail')return;for(let v=0;v<3;v++)for(let k=0;k<3;k++)tl[k]+=hb.tris[i*9+v*3+k];m+=3;});
  for(let k=0;k<3;k++)tl[k]/=m;
  let n=0;while(!D.gone('tail')&&n<60){D.hit([6,tl[1],tl[2]],[-6,tl[1],tl[2]],4e7,0,false,rnd);n++;}
  P.applyDamage();
  r.tail={rounds:n,gone:D.gone('tail'),fin:D.by.fin?D.gone('fin'):null,htail:D.by.htail_l?D.gone('htail_l')&&D.gone('htail_r'):null,rudder:D.gone('rudder'),pitch:D.flight()[3],debris:P.debris.length};
  check(r.tail.gone&&r.tail.fin!==false&&r.tail.htail!==false,`${id}: tail structure ${JSON.stringify(r.tail)} ${JSON.stringify(D.by.tail)}`);
  // the radar (types with one)
  if(D.by.radar){
    D.harm('radar',1e3,false,rnd);for(let k=0;k<3;k++)tf.advance(1/60,[],false);
    const rd=air.ctl?.radar;r.radar={dead:D.dead('radar'),radarOn:rd?.on,reason:air.ctl?.reason};
    check(rd&&!rd.on,`${id}: radar still on`);
  }
  D.harm('fuselage',1e4,false,rnd);r.fuselageBroken=D.broken;
  check(D.broken,`${id}: fuselage killed but not broken up`);
  out.types[id]=r;
}
// flying on: an outer panel gone vs a whole wing (NF-02, instructor holding level)
{
  const air=await board('nf02'),P=air.plane,res={};
  for(const [tag,ids] of [['intact',[]],['outerPanel',['wing_l_out']],['wholeWing',['wing_l']]]){
    P.spawn(0,3000,0,0,220,false);x.applyStoreLoad(air);P.state.throttle=0.9;P.aim=[0,0,1];
    for(const k of ids)P.damage.harm(k,1e4,false,rnd);P.applyDamage();
    let bankMax=0;
    for(let k=0;k<6*60&&!P.crashed;k++){P.aim=[0,0,1];tf.advance(1/60,[],false);const q=P.cur,bank=Math.abs(Math.atan2(2*(q[6]*q[5]+q[3]*q[4]),1-2*(q[3]**2+q[5]**2))*57.3);bankMax=Math.max(bankMax,bank);}
    res[tag]={bankMaxDeg:Math.round(bankMax),altLost:Math.round(3000-P.cur[1]),down:x.airDown?x.airDown(P):null};
  }
  out.flight=res;
}
// a picture: the F-15C with its right outer panel and fin shot away, the debris falling
{
  const air=await board('f15c'),P=air.plane;
  P.spawn(0,1500,0,0,200,false);x.applyStoreLoad(air);tf.advance(1/60,[],true);
  const D=P.damage,ow=D.by.wing_r_out.c,fin=D.by.fin.c;
  while(!D.gone('wing_r_out'))through(D,ow[0],ow[2]);
  while(!D.gone('fin'))D.hit([6,fin[1],fin[2]],[-6,fin[1],fin[2]],4e7,0,false,rnd);
  P.applyDamage();
  for(let k=0;k<20;k++)tf.advance(1/60,[],false);
  const cam0=P.camera.bind(P);P.camera=()=>{const c=P.drawPos,eye=[c[0]+14,c[1]+7,c[2]-12],d=[c[0]-eye[0],c[1]-eye[1],c[2]-eye[2]],l=Math.hypot(...d);return{camPos:eye,fwd:d.map(v=>v/l),fovY:0.8};};
  document.querySelectorAll('#air-hud, #toast, .toast').forEach(el=>el.style.visibility='hidden');
  tf.advance(1/60,[],true);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  await pyShot('air_hitbox_f15c');
  out.picture={debris:P.debris.length,summary:D.summary()};
  P.camera=cam0;document.querySelectorAll('#air-hud, #toast, .toast').forEach(el=>el.style.visibility='');
}
return out;
