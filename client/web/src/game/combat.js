// The combat model of data vehicles: crates/combat (tg-combat) through the WebAssembly core.
// A vehicle is its armour plates, its modules and its crew; a shot comes back as a report of
// what it met and broke, and the vehicle's state (module and crew health, who sits where, fire,
// repairs) is kept here between shots. The same Rust code resolves hits on the online server.

const v3 = (p) => (Array.isArray(p) ? { x: p[0], y: p[1], z: p[2] } : p);
export const arr3 = (p) => (Array.isArray(p) ? p : [p.x, p.y, p.z]);

export const MODULE_NAME = {
  engine: '引擎', transmission: '傳動', fuel_tank: '油箱', ammo_rack: '彈藥架', gun_breech: '炮閂', gun_barrel: '炮管',
  turret_drive: '炮塔驅動', horizontal_drive: '方向機', vertical_drive: '高低機', radio: '無線電', track: '履帶',
};
export const CREW_NAME = { commander: '車長', gunner: '炮手', loader: '裝填手', driver: '駕駛', radio_operator: '無線電手' };
export const EVENT_NAME = {
  ammo_detonation: '彈藥殉爆', fire: '起火', destroyed: '擊毀', engine: '引擎損毀', transmission: '傳動損毀', track_left: '左履帶斷裂', track_right: '右履帶斷裂',
  breech: '炮閂損毀', barrel: '炮管損毀', turret_drive: '炮塔驅動損毀', elevation_drive: '高低機損毀', fuel_tank: '油箱破裂', ammo_rack: '彈藥架受損',
  repaired: '修理完成', fire_out: '火已熄滅', overpenetration: '過穿',
};

/**
 * Rounds every main gun's racks hold together (as tg_combat::ammo_capacity counts them:
 * `ammo_count` per type, 40 of a type without one).
 */
export function ammoCapacity(weapons) {
  if (!weapons) return 0;
  const gun = (g) => (g?.ammo?.length ? g.ammo : [null]).reduce((s, _, i) => s + (g?.ammo_count?.[i] ?? 40), 0);
  let n = weapons.main_gun ? gun(weapons.main_gun) : 0;
  for (const g of weapons.extra_guns || []) n += gun(g.gun);
  for (const t of weapons.extra_turrets || []) for (const g of t.guns || []) n += gun(g.gun);
  return n;
}

/** Ammo racks with no rounds left in them (module ids): drawn empty, nothing there to set off. */
export function emptyRacks(bundle, state) {
  const out = new Set();
  const fill = state?.rack_fill;
  if (!fill?.length) return out;
  (bundle.modules || []).forEach((m, i) => m.kind === 'ammo_rack' && fill[i] <= 0 && out.add(m.id));
  return out;
}

/** The target description the Rust model wants, from a vehicle's data files. */
export function targetDef(id, bundle) {
  const v = bundle.vehicle;
  const t = v.turret || {};
  const turret = t.ring_diameter_m > 0 && t.position_m ? { pivot: v3(t.position_m), size: v3(t.size_m || [1.5, 0.8, 1.8]) } : null;
  return {
    id,
    plates: (bundle.armor || []).map((p) => ({ ...p, center: v3(p.center), normal: v3(p.normal), axis_u: v3(p.axis_u) })),
    modules: (bundle.modules || []).map((m) => ({ ...m, center: v3(m.center), half_extents: v3(m.half_extents), health: m.max_health })),
    crew: (bundle.crew || []).map((c) => ({ role: c.role, pos: v3(c.pos), radius: c.radius ?? 0.25, health: 100 })),
    turret,
    open_top: !!t.open_top,
    ammo_capacity: ammoCapacity(bundle.weapons),
  };
}

/** A machine gun's bullet as a projectile the model can shoot with. */
export function bulletShell(mg) {
  const pen = mg.pen_mm_100m || 8;
  return {
    id: 'bullet_' + mg.id,
    name: mg.name,
    kind: 'ap',
    caliber_mm: mg.caliber_mm,
    mass_kg: (mg.bullet_mass_g || 10) / 1000,
    muzzle_velocity_ms: mg.muzzle_velocity_ms || 800,
    explosive_mass_kg: 0,
    explosive_type: 'none',
    penetrator_material: 'steel',
    length_mm: mg.caliber_mm * 4,
    drag_coefficient: mg.drag_coefficient || 0.3,
    penetration_curve: [
      { distance_m: 0, pen_mm: pen * 1.1 },
      { distance_m: 100, pen_mm: pen },
      { distance_m: 500, pen_mm: pen * 0.55 },
      { distance_m: 1000, pen_mm: pen * 0.3 },
    ],
    ricochet_angle_deg: 70,
    normalization_deg: 0,
    fuse_delay_s: 0,
    fuse_sensitivity_mm: 0,
  };
}

/** A shell as the Rust ProjectileDef (fills the fields older data may leave out). */
export function shellDef(s) {
  return {
    explosive_type: 'none',
    penetrator_material: 'steel',
    length_mm: s.caliber_mm * 4,
    drag_coefficient: 0.3,
    normalization_deg: 0,
    fuse_delay_s: 0,
    fuse_sensitivity_mm: 0,
    explosive_mass_kg: 0,
    ricochet_angle_deg: 70,
    ...s,
  };
}

export class Combat {
  constructor(core) {
    this.core = core;
    this.known = new Set();
  }

  get ready() {
    return !!this.core;
  }

  /** Registers a vehicle (once) and returns a fresh state with its capabilities. */
  fresh(id, bundle) {
    if (!this.core) return null;
    if (!this.known.has(id)) {
      this.core.combatTarget(targetDef(id, bundle));
      this.known.add(id);
    }
    return this.core.combatNew(id);
  }

  /** shot: {shell, origin, dir (hull space), speed_ms, distance_m, seed, turret_yaw} */
  shoot(id, state, shot) {
    return this.core.combatShoot(id, state, { ...shot, shell: shellDef(shot.shell), origin: v3(shot.origin), dir: v3(shot.dir) });
  }

  splash(id, state, at, kg, yaw, seed) {
    return this.core.combatSplash(id, state, v3(at), kg, yaw, seed);
  }

  advance(id, state, dt, seed) {
    return this.core.combatAdvance(id, state, dt, seed);
  }

  /** The vehicle now carries `carried` main-gun rounds: which racks still hold some. */
  ammo(id, state, carried) {
    return this.core.combatAmmo(id, state, carried);
  }

  repair(id, state) {
    return this.core.combatRepair(id, state);
  }

  extinguish(id, state) {
    return this.core.combatExtinguish(id, state);
  }
}
