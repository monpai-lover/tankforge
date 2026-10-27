const tf=window.__tf,x=window.__tfx,G=tf.G;await tf.coreReady();await x.flightCoreP;tf.pause(true);tf.setQuality('low');tf.finishThumbs();
const check=(v,m)=>{if(!v)throw Error(m);},tick=()=>new Promise(r=>setTimeout(r,0));
document.querySelector('.hangar-card[data-air=a10a]').click();
for(let i=0;i<150&&!G.air?.active;i++){tf.advance(1/60,[],false);await tick();}
const air=G.air,p=air.plane,loadouts=x.airLoadouts('a10a');
const index=loadouts.findIndex(lo=>x.layoutStores(p.type,lo).some(it=>it.def.kind==='bomb'));check(index>=0,'no bomb loadout');
air.stores=x.mountStores(p,'a10a',index);x.applyStoreLoad(air);air.stores.sel=air.stores.groups.findIndex(id=>x.AIR_STORE_DEFS[id].kind==='bomb');
p.spawn(-8000,600,-8000,0,180,false);tf.advance(.1,[],false);air.impact=x.storeImpact(air);check(x.visibleStoreImpact(air)?.kind==='bomb','airborne bomb cue absent');
const airborne=air.impact;
p.spawn(-8000,0,-8000,0,0,true);tf.advance(.1,[],false);air.impact=airborne;check(p.onGround,'ground state not accepted');check(x.visibleStoreImpact(air)===null,'stale ground bomb ring');
p.spawn(-8000,600,-8000,0,180,false);tf.advance(.1,[],false);air.impact=airborne;
for(const it of air.stores.items)if(it.def.kind==='bomb')it.count=0;
check(x.visibleStoreImpact(air)===null,'empty bombs still draw');
air.stores=null;check(x.visibleStoreImpact(air)===null,'no stores still draw');
console.log('@@BOMB_VISIBILITY '+JSON.stringify({airborne:true,groundHidden:true,lastBombHidden:true,noBombsHidden:true}));return true;
