/** Pure integration helper for a backend's initial spawn/loadout constructor.
 * Pass the bundled JSON map. This helper never touches live accepted units.
 */
const finite3=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);
const same3=(a,b)=>finite3(a)&&finite3(b)&&a.every((v,k)=>Math.abs(v-b[k])<=1e-7);
export function applySpawnLayout({aircraft,sourceMain,items,phase},map){
  const unchanged=reason=>({applied:false,items,reason});
  if(phase!=='spawn_layout')return unchanged('Requires initial spawn/loadout construction phase');
  const model=map?.schema===2&&map.models?.[aircraft];
  if(!model||model.sourceMain!==sourceMain)return unchanged('Unknown aircraft model source');
  if(!Array.isArray(items)||items.some(it=>it.gone||!Number.isInteger(it.count)||it.count<0))return unchanged('Not an initial store layout');
  const matches=(preset,revised)=>preset.items.length===items.length&&preset.items.every((q,i)=>{
    const it=items[i];return it.id===q.id&&it.count===q.count&&it.owner===(revised?q.revisedOwner:q.previousOwner)&&same3(it.p,revised?q.revisedP:q.previousP);
  });
  if(model.presets.some(p=>matches(p,true)))return unchanged('Already calibrated');
  const candidates=model.presets.filter(p=>matches(p,false));
  if(!candidates.length)return unchanged('Unknown store sequence, carrier or mount positions');
  if(candidates.some(p=>p.items.some((q,i)=>q.revisedOwner!==candidates[0].items[i].revisedOwner||!same3(q.revisedP,candidates[0].items[i].revisedP))))return unchanged('Ambiguous source layout');
  const preset=candidates[0];
  return{applied:true,items:items.map((it,i)=>({...it,owner:preset.items[i].revisedOwner,p:preset.items[i].revisedP.slice(),fittedMountKey:preset.items[i].fittedMountKey||null})),clientReferenceIndex:preset.clientIndex};
}
