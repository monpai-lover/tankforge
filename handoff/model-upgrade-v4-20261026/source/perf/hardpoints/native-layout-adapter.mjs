/** Pure integration helper for a backend's initial spawn/loadout constructor.
 * Pass the bundled JSON map. This helper never touches live accepted units.
 */
const finite3=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);
const same3=(a,b)=>finite3(a)&&finite3(b)&&a.every((v,k)=>Math.abs(v-b[k])<=1e-7);
const rotation=q=>q==null?[0,0,0,1]:Array.isArray(q)&&q.length===4&&q.every(Number.isFinite)&&Math.abs(Math.hypot(...q)-1)<1e-5?q:null;
const sameRotation=(a,b)=>{a=rotation(a);b=rotation(b);return a&&b&&(a.every((v,k)=>Math.abs(v-b[k])<1e-7)||a.every((v,k)=>Math.abs(v+b[k])<1e-7));};
export function applySpawnLayout({aircraft,sourceMain,geometryFingerprint,items,phase},map){
  const unchanged=reason=>({applied:false,items,reason});
  if(phase!=='spawn_layout')return unchanged('Requires initial spawn/loadout construction phase');
  const model=map?.schema===2&&map.models?.[aircraft];
  if(!model||model.sourceMain!==sourceMain)return unchanged('Unknown aircraft model source');
  if(model.proceduralGeometry&&Object.entries(model.proceduralGeometry).some(([key,value])=>geometryFingerprint?.[key]!==value))return unchanged('Unknown procedural aircraft geometry');
  if(!Array.isArray(items)||items.some(it=>it.gone||!Number.isInteger(it.count)||it.count<0))return unchanged('Not an initial store layout');
  const matches=(preset,stage)=>preset.items.length===items.length&&preset.items.every((q,i)=>{
    const it=items[i],revised=stage==='revised',oldCalibration=stage==='calibrated';
    return it.id===q.id&&it.count===q.count&&it.owner===(revised?q.revisedOwner:oldCalibration?q.previousCalibratedOwner:q.previousOwner)&&same3(it.p,revised?q.revisedP:oldCalibration?q.previousCalibratedP:q.previousP)&&sameRotation(it.storeRotation,revised?q.storeRotation:null);
  });
  if(model.presets.some(p=>matches(p,'revised')))return unchanged('Already calibrated');
  const candidates=model.presets.filter(p=>matches(p,'original')||matches(p,'calibrated'));
  if(!candidates.length)return unchanged('Unknown store sequence, carrier or mount positions');
  if(candidates.some(p=>p.items.some((q,i)=>q.revisedOwner!==candidates[0].items[i].revisedOwner||!same3(q.revisedP,candidates[0].items[i].revisedP)||!sameRotation(q.storeRotation,candidates[0].items[i].storeRotation))))return unchanged('Ambiguous source layout');
  const preset=candidates[0];
  return{applied:true,items:items.map((it,i)=>({...it,owner:preset.items[i].revisedOwner,p:preset.items[i].revisedP.slice(),...(preset.items[i].storeRotation?{storeRotation:preset.items[i].storeRotation.slice()}:{}),fittedMountKey:preset.items[i].fittedMountKey||null})),clientReferenceIndex:preset.clientIndex};
}
