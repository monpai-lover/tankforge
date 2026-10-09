// Source IDs are vehicle IDs: a fit is always backed by an existing definition and its ammunition.
import { PRESETS } from './loadout.js';

/** Existing main weapons, including their real belt, magazine and launcher definitions. */
export function workshopWeapons(data) {
  return Object.entries(data.vehicles).filter(([, b]) => b.weapons?.main_gun?.ammo?.length).map(([id, bundle]) => {
    const gun = bundle.weapons.main_gun;
    const category = gun.missile ? 'missile' : gun.autocannon ? 'autocannon' : 'cannon';
    return {
      id,
      label: `${gun.caliber_mm} mm ${{ missile: '導彈發射器', autocannon: '機關炮', cannon: '火炮' }[category]} · ${bundle.vehicle.name}`,
      category,
      gun,
      sourceVehicle: id,
      shells: gun.ammo.map(id => data.projectiles[id]),
      muzzleOffset: bundle.weapons.muzzle_offset_m ?? gun.barrel_length_mm / 1000,
      missile: gun.missile ? data.missiles?.[gun.missile] : null,
    };
  });
}

/** Optics retain the source's calibrated field of view and optional rangefinder. */
export function workshopSights(data) {
  return Object.entries(data.vehicles).filter(([, b]) => b.weapons?.sight).map(([id, bundle]) => ({
    id,
    label: `${bundle.weapons.sight.name} · ${bundle.vehicle.name}`,
    sight: bundle.weapons.sight,
  }));
}

/** Useful source-backed fits come first; the original creative builds remain available. */
export function workshopPresets(data) {
  const turret = (weapon, sightSource, ring, overrides = {}) => ({
    x: 0, z: 0, lift: 0, facing: 0, arc: 360, ring, loaders: 1, rack: 'ready', open: false,
    sightSource, stabilizer: 'none', guns: [{ weapon }], ...overrides,
  });
  const practical = [
    { id: 'hetzer20', label: '追獵者 20 mm 機關炮', build: { base: 'de_hetzer', keepStock: false, turrets: [turret('de_hetzer_sdkfz1401', 'de_hetzer_sdkfz1401', 1.2, { z: -.05, lift: .12, open: true })] } },
    { id: 'bmpTwin', label: 'BMP 雙管 Konkurs 導彈', build: { base: 'xp_bmp_k64', keepStock: false, turrets: [turret('xp_bmp_k64_atgm', 'xp_bmp_k64_atgm', 1.1)] } },
    { id: 'kda35', label: '35 mm 五彈種機關炮', build: { base: 'xp_kda35', keepStock: false, turrets: [turret('xp_kda35', 'xp_kda35', 1.4, { stabilizer: 'both' })] } },
  ];
  return [...practical.filter(p => data.vehicles[p.build.base] && p.build.turrets.every(t => data.vehicles[t.sightSource] && t.guns.every(g => data.vehicles[g.weapon]))), ...Object.entries(PRESETS).map(([id, p]) => ({ id, ...structuredClone(p) }))];
}
