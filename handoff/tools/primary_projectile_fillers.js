// Primary source: TM9-1985-3 (1953), printed pp398-399 (KwK40 Pzgr39)
// and p423 (KwK42 Pzgr39/42). Cyclonite is RDX; PETN/wax on p399 is
// the separate booster. Game enum hexogen represents RDX, not a certified
// chemical-mixture model. Raw17g and all fuze/penetration values are preserved.
function applyPrimaryProjectileFillerCorrections(projectiles) {
  const ids=['apcbc_75_pzgr39','apcbc_75_pzgr39_l43','apcbc_75_pzgr39_42'];
  for(const id of ids){
    const shell=projectiles?.[id];
    if(!shell||shell.id!==id||shell.kind!=='apcbc'||shell.caliber_mm!==75||shell.explosive_mass_kg!==.017||!['petn','hexogen'].includes(shell.explosive_type))throw new Error(`Primary projectile correction identity/mass drift: ${id}`);
  }
  return ids.map(id=>{const shell=projectiles[id],previous=shell.explosive_type;shell.explosive_type='hexogen';return {id,previous,explosive_type:'hexogen',rawFillerGrams:17};});
}
