// TEMPORARY JS mirror of crates/weapon/src/design.rs (tg_weapon::design).
// Gun and shell properties derived from two player choices -- calibre and barrel length -- plus
// the crew-loading model. Everything a custom gun needs comes from these formulas, so a player
// can only trade one property against another, never type in a number.

const AIR_RHO = 1.225;
export const DEMARRE_K = 2050;
export const SHELL_DRAG = 0.4;

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

/** Full-calibre AP shot mass grows with the cube of the calibre. 75 mm -> 6.6 kg, 88 mm -> 10.6 kg. */
export function shellMassKg(calMm) {
  return 15.6 * Math.pow(calMm / 100, 3);
}

/** Muzzle velocity from barrel length in calibres. L/24 -> 516, L/48 -> 732, L/70 -> 930 m/s. */
export function muzzleVelocity(lenCal) {
  return clamp(300 + 9 * lenCal, 350, 1150);
}

/** Gun mass in kg. 88 mm L/56 -> ~1060, 37 mm L/45 -> ~150. */
export function gunMassKg(calMm, lenCal) {
  return 0.003 * calMm * calMm * Math.pow(lenCal, 0.95);
}

export function dispersionMrad(lenCal) {
  return clamp(2.2 - lenCal * 0.022, 0.5, 2.2);
}

export function recoilMm(calMm) {
  return 250 + calMm * 2.2;
}

/** De Marre penetration of homogeneous plate at 0 degrees, mm. */
export function demarreMm(velocity, massKg, calMm, k = DEMARRE_K) {
  const dDm = calMm / 100;
  return Math.pow((velocity * Math.sqrt(massKg)) / (k * Math.pow(dDm, 0.75)), 1 / 0.7) * 100;
}

/** Time for one loader to handle one round at the breech (unstow, lift, ram), seconds. */
export function handlingTime(shellKg) {
  return 1.6 + 0.22 * shellKg + 0.012 * shellKg * shellKg;
}

/** Time to carry a round over `distance` metres inside the vehicle; heavier rounds move slower. */
export function carryTime(distance, shellKg) {
  return (distance * (1 + shellKg / 20)) / 1.6;
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Reload time for one round: loader station -> ammo rack -> breech. */
export function layoutReloadTime(shellKg, loaderPos, rackPos, breechPos) {
  const d = dist(loaderPos, rackPos) + dist(rackPos, breechPos);
  return { distance: d, handling: handlingTime(shellKg), carry: carryTime(d, shellKg), total: handlingTime(shellKg) + carryTime(d, shellKg) };
}

/** Turret traverse rate (deg/s) from ring diameter and the mass of the guns it carries. */
export function traverseRate(ringM, gunsMassKg) {
  return clamp(42 - ringM * 10 - gunsMassKg / 150, 5, 40);
}

export function turretMassKg(ringM, gunsMassKg) {
  return 2200 * ringM * ringM + gunsMassKg;
}

/** Complete GunDef + ProjectileDef (project data format) for a custom gun. */
export function designGun(calMm, lenCal) {
  const cal = Math.round(calMm);
  const len = Math.round(lenCal);
  const mass = shellMassKg(cal);
  const v0 = muzzleVelocity(len);
  const area = Math.PI * Math.pow(cal * 0.0005, 2);
  const kk = (0.5 * AIR_RHO * SHELL_DRAG * area) / mass;
  const curve = [0, 100, 500, 1000, 1500, 2000, 2500].map((d) => ({
    distance_m: d,
    pen_mm: Math.round(demarreMm(v0 * Math.exp(-kk * d), mass, cal) * 10) / 10,
  }));
  const id = `custom_${cal}_l${len}`;
  const shell = {
    id: `ap_${id}`,
    name: `${cal} mm AP（L/${len}）`,
    kind: 'ap',
    caliber_mm: cal,
    mass_kg: Math.round(mass * 100) / 100,
    muzzle_velocity_ms: Math.round(v0),
    explosive_mass_kg: 0,
    explosive_type: 'none',
    penetrator_material: 'steel',
    length_mm: Math.round(cal * 3.7),
    drag_coefficient: SHELL_DRAG,
    penetration_curve: curve,
    ricochet_angle_deg: 68,
    normalization_deg: 4,
    fuse_delay_s: 0,
    fuse_sensitivity_mm: 0,
  };
  const gunMass = gunMassKg(cal, len);
  const gun = {
    id: `gun_${id}`,
    caliber_mm: cal,
    barrel_length_mm: cal * len,
    recoil_mm: Math.round(recoilMm(cal)),
    rounds_per_min: Math.round((60 / handlingTime(mass)) * 10) / 10,
    reload_s: Math.round(handlingTime(mass) * 10) / 10,
    traverse_deg_s: 20,
    elevate_deg_s: Math.round(clamp(16 - gunMass / 200, 3, 14) * 10) / 10,
    max_depression_deg: 8,
    max_elevation_deg: 20,
    dispersion_mrad: Math.round(dispersionMrad(len) * 100) / 100,
    mass_kg: Math.round(gunMass),
    ammo: [shell.id],
  };
  return { gun, shell };
}
