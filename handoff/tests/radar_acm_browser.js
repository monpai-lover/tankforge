// Real DOM keyboard routes, weapon inventory, scope/bar and fixed-step radar observations.
const tf=window.__tf,x=window.__tfx,G=tf.G,results=[];
const check=(ok,message)=>{if(!ok)throw Error(message);};
const next=()=>new Promise(r=>setTimeout(r,0));
await tf.coreReady();await x.flightCoreP;tf.pause(true);tf.finishThumbs();tf.setQuality('low');
tf.renderer.q={...tf.renderer.q,dome:64,cloudSteps:4};tf.renderer._buildDome(64);
G.airHelp=false;G.airBotsOn=false;
const key=(type,code,extra={})=>{
  G.paused=false;
  window.dispatchEvent(new KeyboardEvent(type,{code,bubbles:true,cancelable:true,...extra}));
  G.paused=true;
};
const chord=()=>{key('keydown','Space');key('keydown','KeyR');key('keyup','KeyR');key('keyup','Space');};
for(const id of ['f104g','f15c','nf02']){
  if(G.air?.active)x.exitAircraft(true);
  document.querySelector(`.hangar-card[data-air=${id}]`).click();
  for(let i=0;i<180&&(!G.air?.active||G.air.plane.type.id!==id);i++){tf.advance(1/60,[],false);await next();}
  check(G.air?.active&&G.air.plane.type.id===id,`boarding ${id}`);
  const air=G.air,p=air.plane;p.spawn(-8000,3500,-8000,0,230,false);G.airInputFocused=true;
  tf.advance(1/60,[],false);x.clearBots();
  air.stores=x.mountStores(p,id,id==='f104g'?2:1);x.applyStoreLoad(air);
  const inventory=()=>air.stores.items.filter(i=>!i.gone).reduce((sum,i)=>sum+(i.count||0),0);
  let before=inventory();const rd=x.airCtl(air).radar;rd.mode='search';rd.scale=20;rd.elev=.08;
  key('keydown','Space');check(rd.mode==='search'&&inventory()===before,`${id} prefix changed radar or weapon`);
  key('keydown','KeyR');key('keydown','KeyR',{repeat:true});key('keyup','Space');key('keyup','KeyR');
  tf.advance(.1,[],true);
  check(rd.mode==='acm'&&rd.scale===10&&rd.elev===0,`${id} chord did not enable ACM`);
  check(inventory()===before&&!air.storeHeld&&!air.storeTap,`${id} chord released a weapon`);
  const tile=document.querySelector('.air-bar [data-act=radarDogfight]')||document.querySelector('[data-act=radarDogfight]');
  check(tile&&tile.classList.contains('on')&&tile.dataset.key.includes('R'),`${id} visible ACM control missing`);
  if(id==='f15c'){
    // Capture a clear search-frame view before adding a target.
    p.state.camera=1;tf.advance(1/60,[],true);await pyShot('cockpit');
    p.state.camera=0;tf.advance(1/60,[],true);await pyShot('third');
  }
  chord();check(rd.mode==='search'&&rd.scale===20&&rd.elev===.08,`${id} previous settings not restored`);
  chord();
  const botPromise=x.spawnBot();await botPromise;const b=x.airBots.list[0];check(b,`${id} no real target instance`);
  const setTarget=(az,el,dist=5000)=>{
    const d=x.radarAcmDirection(p,az*Math.PI/180,el*Math.PI/180),q=p.position.map((v,k)=>v+d[k]*dist);
    b.plane.spawn(...q,Math.PI,230,false);
  };
  const t=G.time;rd.acmNext=-Infinity;
  setTarget(6,0);x.stepRadarSys(air,1/60);check(!rd.stt,`${id} captured outside horizontal edge`);
  setTarget(0,20);G.time=t+.1;x.stepRadarSys(air,1/60);check(!rd.stt,`${id} retained the old upper scan volume`);
  setTarget(0,0,11000);G.time=t+.2;x.stepRadarSys(air,1/60);check(!rd.stt,`${id} captured beyond 10 km`);
  setTarget(0,0);G.time=t+.3;x.stepRadarSys(air,1/60);check(rd.stt?.state==='acq',`${id} did not begin acquisition`);
  G.time=t+.4;x.stepRadarSys(air,1/60);check(rd.stt?.state==='acq',`${id} locked before dwell`);
  G.time=t+.5;x.stepRadarSys(air,1/60);check(rd.stt?.state==='track',`${id} failed fast lock`);
  check(inventory()===before,`${id} radar lock launched a weapon`);
  results.push({id,mode:rd.mode,state:rd.stt.state,range:rd.scale,inventoryUnchanged:true,defaultKey:G.airKeys.radarDogfight});
  if(id==='f15c'){tf.advance(1/60,[],true);await pyShot('locked');}
  if(id==='f104g'){
    check(x.storeGroup(air.stores)?.def.kind==='bomb','ground loadout did not select bombs');
    key('keydown','Space');tf.advance(.05,[],false);
    check(inventory()===before,'held Space prefix dropped a bomb');
    key('keyup','Space');tf.advance(.05,[],false);
    check(inventory()===before-1,'single Space release failed to drop exactly one bomb');
    G.paused=false;
    document.getElementById('view').dispatchEvent(new MouseEvent('mousedown',{button:2,bubbles:true,cancelable:true}));
    G.paused=true;check(air.storeHeld,'right mouse did not hold the weapon trigger');
    chord();check(air.storeHeld,'ACM chord cancelled a separately held mouse weapon trigger');
    tf.advance(.4,[],false);
    window.dispatchEvent(new MouseEvent('mouseup',{button:2,bubbles:true}));
    check(inventory()===before-2,'right-mouse release control stopped working');
    before=inventory();results.at(-1).singleSpaceAndMouseRelease=true;
  }
  // Actual key editor accepts a two-key Space chord and survives cancellation/focus loss.
  key('keydown','F7');key('keyup','F7');
  const editor=document.getElementById('air-keys');check(!editor.hidden,'F7 editor missing');
  editor.querySelector('[data-a=radarDogfight] .ak-key').click();
  key('keydown','Space');key('keydown','KeyR');key('keyup','KeyR');key('keyup','Space');
  check(G.airKeys.radarDogfight==='Space+KeyR','editor lost Space prefix');
  editor.querySelector('.ak-close').click();
  key('keydown','Space');window.dispatchEvent(new Event('blur'));key('keyup','Space');
  check(inventory()===before&&!air.storeHeld,'blur left deferred weapon input');
  window.dispatchEvent(new Event('focus'));x.clearBots();
  console.log('@@RADAR_CASE '+JSON.stringify(results.at(-1)));
}
console.log('@@RADAR_ACM '+JSON.stringify(results));return results;
