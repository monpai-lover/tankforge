/* TF_SOVIET_CONVENTIONAL_STORES_BEGIN */
// Reuse existing native weapon definitions and already bomb-authorized mounts.
// Base aircraft identities remain distinct from the explicit upgraded variants.
var TFSovietConventionalStores = (() => {
  const provenance=Object.freeze({
    su27:Object.freeze({variant:'Su-27UBK / China 1992 source aircraft',sourceRecord:'data/aircraft/frontline.json#aircraft.su27',stationBasis:'Existing FAB-500-authorized inner/center stations; original counts retained'}),
    mig29:Object.freeze({variant:'MiG-29 9.12 source aircraft',sourceRecord:'data/aircraft/frontline.json#aircraft.mig29',stationBasis:'Existing FAB-500-authorized inner pair; original conventional rocket stations retained'}),
    su27skm:Object.freeze({variant:'Su-27SKM explicit export variant',sourceRecord:'data/aircraft/frontline.json#aircraft.su27skm',stationBasis:'Inherited measured Su-27UBK source geometry; no new SKM exterior claim'}),
    mig29smt:Object.freeze({variant:'MiG-29SMT explicit export variant',sourceRecord:'data/aircraft/frontline.json#aircraft.mig29smt',stationBasis:'Inherited measured 9.12 source geometry; no new SMT exterior claim'})
  });
  const base=id=>id==='su27skm'?'su27':id==='mig29smt'?'mig29':id;
  const aam=id=>id==='su27skm'||id==='mig29smt'?'r73e':'r73';
  const copy=v=>JSON.parse(JSON.stringify(v));
  function additions(id){
    if(!provenance[id])return [];
    const flanker=base(id)==='su27',selfDefense=[aam(id),2,flanker?'tip':'outer'];
    const rows=[['fab100','FAB-100'],['fab250','FAB-250M-54'],['fab500','FAB-500M-62']].map(([store,name])=>
      [name+' 對地 / 自衛',[[store,2,'inner'],...(flanker?[[store,2,'center']]:[]),selfDefense]]);
    rows.push(['B-8M1 火箭 / 自衛',[['b8m1',2,'mid'],selfDefense]]);
    if(!flanker)rows.push(['UB-16-57 火箭 / 自衛',[['ub16',2,'mid'],selfDefense]],['S-24B 火箭 / 自衛',[['s24b',2,'mid'],selfDefense]]);
    return rows;
  }
  function installLoadouts(loadouts){
    for(const id of Object.keys(provenance)){
      if(!Array.isArray(loadouts[id]))continue;
      for(const row of additions(id)){
        const existing=loadouts[id].find(([name])=>name===row[0]);
        if(existing){if(JSON.stringify(existing)!==JSON.stringify(row))throw Error('Conventional source preset collision: '+id+'/'+row[0]);continue;}
        loadouts[id].push(copy(row));
      }
    }
  }
  function decorateSlots(id,slots){
    if(!provenance[id])return slots;
    return slots.map(slot=>{
      const count=slot.options.get('fab500');if(!count)return slot;
      const options=new Map(slot.options);for(const store of ['fab100','fab250'])options.set(store,count);
      return {...slot,options};
    });
  }
  function inheritCompatibility(table){
    for(const id of Object.keys(provenance))if(table[id])for(const store of ['fab100','fab250'])table[id][store]='primary';
  }
  return Object.freeze({provenance,additions,installLoadouts,decorateSlots,inheritCompatibility});
})();
/* TF_SOVIET_CONVENTIONAL_STORES_END */
