// Actual WebGL/WASM paths, using the small aircraft dataset generated with trim.py.
const tf=window.__tf,x=window.__tfx,G=tf.G,report={};
const check=(v,m)=>{if(!v)throw Error(m);},tick=()=>new Promise(r=>setTimeout(r,0));
await tf.coreReady();await x.flightCoreP;tf.pause(true);tf.setQuality('low');
tf.renderer.q={...tf.renderer.q,dome:64,cloudSteps:4};tf.renderer._buildDome(64);tf.finishThumbs();
G.airHelp=false;G.airAssist=false;
console.log('@@REPAIR ready');
async function board(id){
  if(G.air?.active)x.exitAircraft(true);
  document.querySelector(`.hangar-card[data-air=${id}]`).click();
  for(let i=0;i<150&&!(G.air?.active&&G.air.plane.type.id===id);i++){tf.advance(1/60,[],false);await tick();}
  check(G.air?.active&&G.air.plane.type.id===id,id+' boarding');
  const p=G.air.plane;p.spawn(-8000,1500,-8000,0,180,false);p.aim=[0,0,1];return p;
}
const checksum=cv=>{let sum=0;const d=cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;for(let i=0;i<d.length;i+=7)sum=(sum*31+d[i])>>>0;return sum;};
for(const id of ['a10a','f15c','f104g']){
  const p=await board(id);p.state.camera=1;tf.advance(.1,[],false);p._cockpitDetail(true);await p.cockpitHi?.loading;
  for(let i=0;i<4;i++){tf.advance(1/60,[],true);await tick();}
  check(p.instruments?.node.visible,id+' live instrument layer missing');
  const before=checksum(p.instruments.canvas),alt=p.instruments.values.altitudeM;
  await pyShot(id+'-cockpit-calibrated');
  p.spawn(-8000,2400,-8000,0,130,false);p.state.camera=1;tf.advance(.25,[],true);
  check(p.instruments.values.altitudeM>alt+700,id+' altimeter not linked');
  check(before!==checksum(p.instruments.canvas),id+' instrument texture did not change');
  report[id]={eye:p.cockpitEye,sourceEye:p.type.model.spec.eyeSeated,glass:p.sightGlass.length,
    instruments:p.instruments.definitions.map(d=>d.id),accepted:p.instruments.values};
  console.log('@@REPAIR '+id+' cockpit + linked instruments');
}
{
  const p=await board('mig17f'),air=G.air;air.stores=x.mountStores(p,'mig17f',1);x.applyStoreLoad(air);
  check(air.stores.items.every(i=>i.nativePylon&&!i.pylonNode),'MiG-17 still uses duplicate generic pylons');
  p.state.gear=true;tf.advance(2.1,[],false);
  const original=p.camera.bind(p);
  for(const [name,offset] of [['front',[0,-1,12]],['underside',[7,-6,8]]]){
    p.camera=()=>{const c=p.drawPos,d=offset.map(v=>-v),l=Math.hypot(...d);return{camPos:c.map((v,i)=>v+offset[i]),fwd:d.map(v=>v/l),fovY:.9};};
    tf.advance(1/60,[],true);await pyShot('mig17-'+name+'-pylons');
  }
  p.camera=original;report.mig17={stations:p.type.model.spec.stations,stores:air.stores.items.map(i=>({id:i.id,p:i.p,mount:i.mount,native:i.nativePylon}))};
}
{
  const p=await board('mirage3e');p.state.gear=true;tf.advance(2.1,[],false);
  const original=p.camera.bind(p),offset=[9,-2,5];
  p.camera=()=>{const c=p.drawPos,d=offset.map(v=>-v),l=Math.hypot(...d);return{camPos:c.map((v,i)=>v+offset[i]),fwd:d.map(v=>v/l),fovY:.9};};
  for(const [label,gear,seconds] of [['down',true,.02],['moving',false,.9],['up',false,1.1]]){
    p.state.gear=gear;tf.advance(seconds,[],true);await pyShot('mirage-gear-'+label);
    check(p.cur.every(Number.isFinite),'Mirage nonfinite gear/flight');
    (report.mirageGear||(report.mirageGear=[])).push({label,accepted:p.cur[33]});
  }
  p.camera=original;
}
console.log('@@AIRCRAFT_REPAIR '+JSON.stringify(report));return report;
