// The online server's aircraft data, taken from the game itself (tools: export_aircraft.py writes it to
// data/aircraft/aircraft.json): each type's damage parts and skin boxes as its airframe builds them, its
// guns (rounds, rate, belt), the shells and bullets they fire, the air-to-air missiles' warheads and
// reach, the loadouts with what they carry (the spawn cost class from it). Boxes only: the client's
// triangle hitbox is not exported (the server checks a reported hit against the boxes).
// Optional year copies the fighter's current game metadata for room eligibility only; it does not
// certify a historical weapon/sensor configuration. Test aircraft keep their year unknown.
const tf=window.__tf,x=window.__tfx,G=tf.G;
const next=()=>new Promise(r=>setTimeout(r,0));
await tf.coreReady();await x.flightCoreP;tf.pause(true);G.airDefenceOn=false;G.airBotsOn=false;tf.finishThumbs();
const types={},shells={},missiles={};
const r3=(a)=>a.map(v=>Math.round(v*1e4)/1e4);
const shellOf=(id,s,extra={})=>{if(!s||shells[id])return;shells[id]={mass_kg:+(s.mass_kg??0).toFixed(5),speed_ms:Math.round(s.muzzle_velocity_ms||0),filler_kg:+x.tntEquivalentKg(s).toFixed(5),caliber_mm:s.caliber_mm||0,incendiary:x.tntEquivalentKg(s)>0||/incend|hefi|hei|_i_|brand/i.test(`${id} ${s.name||''}`),...extra};};
for(const id of Object.keys(x.AIRCRAFT_TYPES)){
  const T=x.AIRCRAFT_TYPES[id];if(!T.fighter&&id!=='nf01'&&id!=='nf02')continue;
  if(G.air?.active)x.exitAircraft(true);
  G.airLoadout[id]=0;const card=document.querySelector(`.hangar-card[data-air=${id}]`);if(!card)continue;card.click();
  for(let i=0;i<120&&!(G.air?.active&&G.air.plane.type.id===id);i++){tf.advance(1/60,[],false);await next();}
  const air=G.air;if(!air?.active)continue;const P=air.plane,D=P.damage;
  const guns=x.aircraftGuns(id).map(g=>{
    let ids=[];
    if(g.kind==='cannon'){ids=g.belt;for(const b of g.belt)shellOf(b,x.data.projectiles[b]);}
    // the rotary's round as the game fires it (the M61's M56 HEI: G.bulletShells), the machine guns' bullets
    else{const bid=`bullet:${g.def.id||g.sound}`;ids=[bid];const own=G.bulletShells?.get(g.def.id);shellOf(bid,own?{...own,name:own.name||g.def.name||''}:{...x.bulletOf(g.def),name:g.def.name||''},{bullet:true});}
    return {id:g.id,kind:g.kind,ammo:Math.round(g.ammo),rpm:g.rpm,owner:g.owner,shells:ids};
  });
  const los=x.airLoadouts(id).map((lo,index)=>{
    const stores={};for(const [sid,n] of lo[1])stores[sid]=(stores[sid]||0)+n;
    const kinds=new Set(Object.keys(stores).map(s=>x.AIR_STORE_DEFS[s]?.kind));
    const ground=[...kinds].some(k=>k==='bomb'||k==='rocket'||k==='pod'),agm=kinds.has('agm'),aam=kinds.has('aam');
    const cls=agm?'agm':ground?'ground':aam?'aam':'guns';
    for(const sid of Object.keys(stores)){const d=x.AIR_STORE_DEFS[sid];if(d?.kind==='aam'&&!missiles[sid])missiles[sid]={tnt_kg:d.tnt||5,fuse_m:d.fuse||8,lock_range_m:d.lockRange||5000,life_s:d.life||40,guidance:d.guidance,max_speed_ms:Math.round((d.dv||600)+(d.sustain?d.sustain[0]*d.sustain[1]:0)+(d.ramjet?400:0)+300)};}
    return {index,name:lo[0],class:cls,stores};
  });
  const value=T.fighter?.era, parsed=typeof value==='number'||typeof value==='string'&&/^\d{4}$/.test(value.trim())?Number(value):NaN;
  const year=Number.isInteger(parsed)&&parsed>=1900&&parsed<=2100?parsed:null;
  types[id]={name:T.name,...(year!==null?{year}:{}),mass_kg:Math.round(T.airframe[0]),parts:D.parts.map(p=>({id:p.id,name:p.name,c:r3(p.c),h:r3(p.h),hp:p.max,...(p.armor!=null?{armor:p.armor}:{}),...(p.fire?{fire:p.fire}:{}),...(p.detach?{detach:true}:{}),...(p.parent?{parent:p.parent}:{}),...(p.blastK!=null?{blast_k:p.blastK}:{})})),
    skin:(D.skin||[]).map(s=>({c:r3(s.c),h:r3(s.h)})),guns,loadouts:los};
  console.log('@@'+id+' '+D.parts.length+' parts '+guns.length+' guns');
}
const all=JSON.stringify({version:1,generated:'tests/export_aircraft.js',types,shells,missiles});
// printed in pieces (the runner's RESULT is cut at 20 kB): tools/export_aircraft.py joins them
for(let i=0,k=0;i<all.length;i+=40000,k++)console.log('@@JSON '+k+' '+all.slice(i,i+40000));
return {bytes:all.length,types:Object.keys(types).length,shells:Object.keys(shells).length,missiles:Object.keys(missiles).length};
