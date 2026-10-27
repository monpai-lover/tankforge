// The pod and Maverick sensor views (user report: no crosshair, no zoom; the TV Maverick should lock
// by image): NF-02 over the range, V into the pod view, the wheel to zoom, the pod pointed at a vehicle
// and tracked, then the Maverick's own seeker view and an image lock; pictures of each.
const tf=window.__tf,x=window.__tfx,G=tf.G,out={};
const next=()=>new Promise(r=>setTimeout(r,0)),frames=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
await tf.coreReady();await x.flightCoreP;tf.pause(true);G.airDefenceOn=false;tf.finishThumbs();
const live=(fn)=>{const p=G.paused;G.paused=false;try{fn();}finally{G.paused=p;}};
const tap=(code,o={})=>live(()=>{window.dispatchEvent(new KeyboardEvent('keydown',{code,bubbles:true,...o}));window.dispatchEvent(new KeyboardEvent('keyup',{code,bubbles:true,...o}));});
const canvas=[...document.querySelectorAll('canvas')].filter(c=>!c.closest('#air-hud')).sort((a,b)=>b.width*b.height-a.width*a.height)[0];
const wheel=(dy)=>live(()=>canvas.dispatchEvent(new WheelEvent('wheel',{deltaY:dy,bubbles:true,cancelable:true})));
const nrm=(a)=>{const l=Math.hypot(...a)||1;return a.map(v=>v/l);};
G.airLoadout.nf02=2;document.querySelector('.hangar-card[data-air=nf02]').click();
for(let i=0;i<120&&!G.air?.active;i++){tf.advance(1/60,[],false);await next();}
const air=G.air,P=air.plane,ctl=x.airCtl(air);
const e=G.enemies.filter(q=>q.alive&&q.veh).sort((p,q)=>p.z-q.z).at(-1),E=e.veh.body;
P.spawn(e.x+300,E.origin()[1]+1400,e.z-5000,0,220,false);x.applyStoreLoad(air);P.state.throttle=0.8;tf.advance(0.2,[],false);
for(let k=0;k<10&&air.stores.groups[air.stores.sel]!=='agm65a';k++)tap('KeyY');
const shot=async(n)=>{G.airHudTick=0;tf.advance(1/60,[],true);await frames();await pyShot(n);};
let k=0;while(ctl.view!=='pod'&&k++<5)tap('KeyV');
const pod=x.airPod(air);pod.dir=nrm([e.x-P.position[0],E.origin()[1]+1-P.position[1],e.z-P.position[2]]);
out.view=ctl.view;out.zoom0={zoom:pod.zoom,fov:+(pod.cfg.fov[0]+(pod.cfg.fov[1]-pod.cfg.fov[0])*pod.zoom).toFixed(2)};
await shot('pod_wide');
for(let i=0;i<2;i++)wheel(-100);
out.zoom1={zoom:+pod.zoom.toFixed(2)};
await shot('pod_zoom');
tap('Space');for(let i=0;i<40;i++)tf.advance(1/60,[],false);out.pod=pod.state;
await shot('pod_track');
// the Maverick's own seeker view: V on to it, Space on, then Space captures what is under the cross
tap('Space');for(let i=0;i<120;i++)tf.advance(1/60,[],false);
k=0;while(ctl.view!=='seeker'&&k++<4)tap('KeyV');out.seekerView=ctl.view;
// aim the seeker at the vehicle (as the mouse would in this view), then Space: an image lock
{const o=E.origin();ctl.seeker.look=[o[0],o[1]+1,o[2]];ctl.seeker.slew=nrm(ctl.seeker.look.map((v,i)=>v-P.position[i]));}for(let i=0;i<60;i++)tf.advance(1/60,[],false);
await shot('maverick_aim');
{const g=air.stores.items.find(it=>it.id==='agm65a'&&!it.gone),from=P.worldPoint(g.p),o=E.origin(),tp=[o[0],o[1]+Math.min(2.2,(e.box?.top||2)*0.6),o[2]],l=nrm(tp.map((v,i)=>v-from[i])),sd=ctl.seeker.dir,sl=ctl.seeker.slew;out.aimErr={dirDeg:+(Math.acos(Math.min(1,l[0]*sd[0]+l[1]*sd[1]+l[2]*sd[2]))*57.3).toFixed(3),slewDeg:+(Math.acos(Math.min(1,l[0]*sl[0]+l[1]*sl[1]+l[2]*sl[2]))*57.3).toFixed(3),state:ctl.seeker.state,limited:ctl.seeker.limited};}
for(let i=0;i<3;i++)wheel(-100);out.seekerZoom=ctl.seekerZoom;
tap('Space');for(let i=0;i<70;i++)tf.advance(1/60,[],false);
out.seeker={state:ctl.seeker.state,target:!!ctl.seeker.target,point:!!ctl.seeker.point,reason:ctl.reason};
await shot('maverick_seeker');
// and a ground point: X, the seeker moved off the vehicle, Space
tap('KeyX');{const o=E.origin();ctl.seeker.look=[o[0]+250,o[1],o[2]+150];ctl.seeker.slew=nrm(ctl.seeker.look.map((v,i)=>v-P.position[i]));}for(let i=0;i<60;i++)tf.advance(1/60,[],false);tap('Space');for(let i=0;i<10;i++)tf.advance(1/60,[],false);
out.point={state:ctl.seeker.state,point:!!ctl.seeker.point,reason:ctl.reason};await shot('maverick_point');
return out;
