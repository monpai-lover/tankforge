// Keys are precomputed on mounted loadout entries. Only older cores lacking the weapons
// map use whole-vehicle capability; an unknown instance in a new core fails closed.
import { MODULE_NAME } from './combat.js';
const HEALTHY = Object.freeze({ can_fire: true, dispersion_mult: 1, reload_mult: 1, traverse_mult: 1, elevate_mult: 1, reason: null });
const UNKNOWN = Object.freeze({ ...HEALTHY, can_fire: false, reason: 'binding:unknown weapon' });
const LEGACY = new WeakMap();

export function weaponDamage(caps, key) {
  if (!caps) return HEALTHY;
  if (caps.weapons !== undefined) return caps.weapons?.[key] || UNKNOWN;
  let legacy = LEGACY.get(caps);
  if (!legacy) { legacy = {}; LEGACY.set(caps, legacy); }
  legacy.can_fire = caps.can_fire ?? true;
  legacy.dispersion_mult = caps.dispersion_mult ?? 1;
  legacy.reload_mult = caps.reload_mult ?? 1;
  legacy.traverse_mult = caps.traverse_mult ?? 1;
  legacy.elevate_mult = caps.elevate_mult ?? 1;
  legacy.reason = null;
  return legacy;
}

export function weaponReloadMult(caps, key, noDedicatedLoader = false) {
  // The manual queue already includes 1.6 for a fallback loader. Independent source
  // cycles do not; keep that penalty there and retain each rack's feed multiplier.
  return weaponDamage(caps, key).reload_mult / (noDedicatedLoader && caps?.loader === false ? 1.6 : 1);
}

/** Reload work uses real seconds so a health change also affects an in-progress reload. */
export function weaponReloadRate(caps, key, noDedicatedLoader = false) {
  return caps?.destroyed || caps?.repair_s > 0 ? 0 : 1 / Math.max(1, weaponReloadMult(caps, key, noDedicatedLoader));
}

/** Fitted mechanical owner adapter for older cores lacking mechanical capability fields.
 * Only its loader factor is removed; rack feeding damage remains. Existing drive kinds
 * represent the two named AZ parts until a dedicated mechanical module kind exists.
 */
export function mountedReloadMult(caps, gun, bundle = null, state = null) {
  let multiplier=weaponReloadMult(caps,gun.damageKey,gun.noDedicatedLoader);
  if (!gun.mechanizedLoading) return multiplier;
  const own=weaponDamage(caps,gun.damageKey);
  if (own.mechanism_available === false) return Infinity;
  if (caps?.loader === false && own.mechanized !== true) multiplier/=1.6;
  if (own.mechanized === true) return multiplier;
  if (state?.modules && bundle?.modules) {
    for (const id of gun.mechanizedLoading.modules) {
      const i=bundle.modules.findIndex(m=>m.id===id),m=bundle.modules[i];
      if (!m || !Number.isFinite(state.modules[i]) || !(m.max_health>0)) return Infinity;
      const h=Math.max(0,Math.min(1,state.modules[i]/m.max_health));
      if (h<=0) return Infinity;
      multiplier=Math.max(multiplier,1+Math.max(0,.5-h));
    }
  }
  return multiplier;
}

export function mountedReloadRate(caps, gun, bundle = null, state = null) {
  return caps?.destroyed || caps?.repair_s>0 ? 0 : 1/Math.max(1,mountedReloadMult(caps,gun,bundle,state));
}

/** Presentation names are resolved once from the same source mounts and normalized anatomy. */
export function moduleDamageLabels(loadout, modules) {
  const guns = loadout.turrets.flatMap((t, ti) => t.guns.map((g, gi) => ({ g, ti, mount: ti === 0 ? gi === 0 ? loadout.weapons : loadout.weapons.extra_guns?.[gi - 1] : loadout.weapons.extra_turrets?.[ti - 1]?.guns[gi] })));
  return new Map(modules.map(m => {
    const mechanism=guns.find(({g})=>g.mechanizedLoading?.modules.includes(m.id));
    if(mechanism) return [m.id,`${mechanism.g.mechanizedLoading.mechanism} 自動裝彈機構`];
    const kind = MODULE_NAME[m.kind] || m.kind;
    if (['aps_gun', 'aps_radar'].includes(m.kind)) return [m.id, `${loadout.weapons.aps?.name || '主動防護'} ${kind}`];
    if (m.kind === 'machine_gun') {
      const mg = loadout.machineGuns.find(g => g.damageKey === m.weapon_group);
      return [m.id, `${mg?.def.name || kind} ${m.id.endsWith(':barrel') ? '槍管' : '機匣'}`];
    }
    if (!['gun_breech', 'gun_barrel', 'launcher', 'horizontal_drive', 'vertical_drive', 'turret_drive', 'ammo_rack'].includes(m.kind)) return [m.id, kind];
    let own = guns.filter(({g, mount}) => {
      const refs = mount?.damage || g.def.damage;
      return refs && Object.values(refs).some(ids => Array.isArray(ids) && ids.includes(m.id)) || m.weapon_group && m.weapon_group === (mount?.weapon_group || g.def.weapon_group || g.damageKey);
    });
    if (!own.length) own = guns.filter(({g, ti}) => (!loadout.weapons.aps || ti !== (loadout.weapons.aps.turret ?? 1)) && (m.turret_index == null || ti === m.turret_index) && (m.kind === 'launcher' ? !!g.def.missile : m.kind === 'gun_breech' || m.kind === 'gun_barrel' ? !g.def.missile : true));
    if (own.length > 1 && ['gun_breech', 'gun_barrel', 'launcher'].includes(m.kind)) {
      const distance = ({g}) => (m.center.x - g.trunnion[0]) ** 2 + (m.center.y - g.trunnion[1]) ** 2 + (m.center.z - g.trunnion[2]) ** 2;
      own = [own.reduce((a, b) => distance(a) <= distance(b) ? a : b)];
    }
    const names = [...new Set(own.map(({g}) => g.def.name || g.def.id))].join('／');
    return [m.id, names ? `${names} ${kind}` : kind];
  }));
}
