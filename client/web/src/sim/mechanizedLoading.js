// Fitted loading apparatus belongs to a mounted gun, not a gun catalogue identity.
const STAGES = ['select_lift', 'projectile_ram', 'charge_ram'];
// Fixed cartridge identities supported by the authored AZ/2A46-1 reconstruction.
// Flight-body calibre is intentionally not constrained: the APFSDS body is 44 mm.
const AZ_T72_AMMO = ['apfsds_125_3bm22', 'heatfs_125_3bk14', 'he_125_3of26'];
export function fittedMechanizedLoading(mount, gun, modules = null) {
  const d = mount?.mechanized_loading;
  if (d == null) return null;
  const fail = () => { throw new Error('Invalid or incompatible mechanized carousel'); };
  if (!d || d.mechanism !== 'az_t72' || gun.autocannon || gun.missile || d.gun_id !== '2a46_1_125' || d.gun_id !== gun.id || gun.caliber_mm !== 125
    || !Number.isSafeInteger(d.capacity) || d.capacity <= 0 || d.capacity > 22
    || !(Number.isFinite(d.cycle_s) && d.cycle_s > 0)
    || !Array.isArray(d.ammo) || d.ammo.length !== gun.ammo.length
    || d.ammo.some((id,i) => typeof id !== 'string' || id !== gun.ammo[i] || !AZ_T72_AMMO.includes(id) || d.ammo.indexOf(id) !== i)
    || !Array.isArray(gun.ammo_count) || gun.ammo_count.length !== gun.ammo.length
    || gun.ammo_count.some(n=>!Number.isSafeInteger(n)||n<0)
    || gun.ammo_count.reduce((a,b)=>a+b,0)>d.capacity
    || !Array.isArray(d.modules) || !d.modules.length
    || d.modules.some((id,i)=>typeof id!=='string'||!id||d.modules.indexOf(id)!==i)
    || !Array.isArray(d.stages) || d.stages.length !== STAGES.length) fail();
  d.stages.forEach((s,i)=>{
    if (s.stage!==STAGES[i] || !Number.isFinite(s.at) || s.at<0 || s.at>=1
      || (i===0 ? s.at!==0 : s.at<=d.stages[i-1].at)) fail();
  });
  if (modules && d.modules.some(id=>{
    const matches=modules.filter(m=>m.id===id);
    return matches.length!==1 || !['horizontal_drive','vertical_drive'].includes(matches[0].kind);
  })) fail();
  return Object.freeze({...d,ammo:Object.freeze(d.ammo.slice()),modules:Object.freeze(d.modules.slice()),
    stages:Object.freeze(d.stages.map(s=>Object.freeze({...s})))});
}
