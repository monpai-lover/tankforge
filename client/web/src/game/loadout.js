// Loadouts: turns vehicle data (stock or built in the workshop) into the runtime description the
// game uses -- a list of turrets, each with guns, loaders and a sight.
//
// A workshop build is first converted into the project's ordinary data format (vehicle.json,
// weapons.json with `extra_turrets`, visual.json ...) and then loaded through the same path as a
// stock vehicle, so whatever the workshop can make, the data files can describe.
import * as design from '../sim/design.js';
import { rangeTable } from '../sim/ballistics.js';
import { bulletOf } from '../sim/mg.js';
import { fired as queueReload } from '../sim/loading.js';

export const SIGHT_RANGES = Array.from({ length: 30 }, (_, i) => (i + 1) * 100);
export const DEFAULT_RANGEFINDER = { time_s: 2.5, error_pct: 5, max_range_m: 2500 };
const DEFAULT_SIGHT = { name: '直瞄鏡', levels: [{ magnification: 3, fov_deg: 16 }, { magnification: 6, fov_deg: 8 }] };
const DEG = Math.PI / 180;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const r3 = (x) => Math.round(x * 1000) / 1000;

export const MAX_TURRETS = 6;
export const MAX_GUNS_PER_TURRET = 4;

// ------------------------------------------------------------------ runtime

/** Rounds of each type when the data does not say (workshop guns). */
const DEFAULT_ROUNDS = 40;

/**
 * One gun and what it carries. ammo: [{shell, count, max, table}] in the order of the gunner's
 * selector (keys 1-4). `loaded` is the type in the breech (-1: empty), `selected` the type the
 * loader takes next; `shell` and `table` follow the round in the breech, or the next one while
 * the gun is empty.
 */
function gunEntry(def, shells, trunnion, muzzleOffset, rack) {
  const ammo = shells.map((shell, i) => {
    const n = def.ammo_count?.[i] ?? DEFAULT_ROUNDS;
    // slow rounds (rockets) are lobbed: their table may use the launcher's elevation, up to 45 deg
    const lob = shell.muzzle_velocity_ms < 300 ? Math.min(Math.max(def.max_elevation_deg || 20, 20), 45) * (Math.PI / 180) : 0.35;
    // a wire-guided missile flies along the sight line: its sight needs no elevation for range
    if (def.guided) return { shell, count: n, max: n, table: SIGHT_RANGES.map((range) => ({ range, elevation: 0, tof: range / 250, speed: 250 })) };
    return { shell, count: n, max: n, table: rangeTable(shell, SIGHT_RANGES, undefined, lob) };
  });
  const gun = {
    def,
    ammo,
    // an automatic gun: rounds left in the belt (or magazine) on the gun, how far the barrels
    // have spun up (rotary guns), whether the next "reload" is a belt change
    belt: def.autocannon ? def.autocannon.belt_rounds : 0,
    spin: 0,
    beltChange: false,
    loaded: 0,
    selected: 0,
    shell: ammo[0].shell,
    table: ammo[0].table,
    trunnion,
    muzzleOffset,
    muzzleVector: def.muzzle_vector_m?.slice(),
    breech: [trunnion[0], trunnion[1], trunnion[2] - 0.4],
    rack: rack || null,
  };
  refillLauncher(gun);
  return gun;
}

/** Points `shell` / `table` at the round in the breech, or at the next one when empty. */
export function syncGunShell(g) {
  const a = g.ammo[g.loaded >= 0 ? g.loaded : g.selected];
  g.shell = a.shell;
  g.table = a.table;
}

/** Type the loader takes next: the selected one while it lasts, else the first type left. -1: none. */
export function nextAmmo(g) {
  if (g.ammo[g.selected]?.count > 0) return g.selected;
  return g.ammo.findIndex((a) => a.count > 0);
}

/** A belt change finished: a fresh belt from what is left in the racks. */
export function refillBelt(g) {
  if (!g.def.autocannon || !g.beltChange) return;
  g.beltChange = false;
  g.belt = Math.min(g.def.autocannon.belt_rounds, roundsLeft(g));
}

/** Rounds left of every type together. */
export function roundsLeft(g) {
  return g.ammo.reduce((s, a) => s + a.count, 0);
}

/** A missile assembly reloads its tube set; the rounds in those tubes are part of its total ammo. */
export function refillLauncher(g) {
  if (!g.def.missile) return;
  const capacity = g.def.launcher?.muzzle_vectors_m?.length || 1;
  if (!g.launcher) g.launcher = { ready: 0, nextTube: 0 };
  g.launcher.ready = Math.min(capacity, roundsLeft(g));
  g.launcher.nextTube = 0;
  g.launcher.cooldown = 0;
}

/** Mirrors the server's minimum 0.25 s between missile launches without emptying a loaded tube. */
export function tickLauncher(g, dt) {
  if (g.launcher) g.launcher.cooldown = Math.max(0, g.launcher.cooldown - dt);
}

/** Tube mouths share one elevation hinge, including vertically stacked or off-axis tubes. */
export function launcherMount(g, mount) {
  const vector = g.def.launcher?.muzzle_vectors_m?.[g.launcher?.nextTube || 0];
  return vector ? { ...mount, muzzleVector: vector } : mount;
}

/** Consume one successful missile launch; the remaining loaded tube stays ready. */
export function fireLauncherRound(g, L, gi) {
  if (L.state[gi] !== 'ready' || !g.launcher?.ready || g.launcher.cooldown > 1e-9 || g.loaded < 0 || !(g.ammo[g.loaded]?.count > 0)) return false;
  g.ammo[g.loaded].count--;
  g.launcher.ready = Math.min(g.launcher.ready - 1, roundsLeft(g));
  g.launcher.nextTube++;
  g.launcher.cooldown = 0.25;
  const next = nextAmmo(g);
  g.loaded = g.launcher.ready > 0 ? next : -1;
  if (next < 0) L.state[gi] = 'empty';
  else if (g.launcher.ready <= 0) queueReload(L, gi);
  syncGunShell(g);
  return true;
}

/**
 * The sight's magnifications as the data gives them, and a second, doubled one where the
 * historical sight had a single power (dual-power sights such as the TZF 12a keep their own two).
 */
export function sightLevels(sight) {
  const s = sight || DEFAULT_SIGHT;
  const levels = (s.levels || []).slice().sort((a, b) => a.magnification - b.magnification);
  if (levels.length === 1) {
    const l = levels[0];
    levels.push({ magnification: Math.round(l.magnification * 2 * 10) / 10, fov_deg: l.fov_deg / 2, doubled: true });
  }
  return { ...s, levels };
}

function turretEntry(id, pivot, ring, size, traverse, facingDeg, limitDeg, sight, loaders, guns, generated, openTop, stabilizer, parent = null, depression = null) {
  return {
    id,
    // a turret riding on another (its index): the ring turns with that turret
    parent: parent ?? null,
    depByYaw: depression && depression.length ? depression.slice() : null,
    stabilizer: stabilizer || 'none',
    openTop: !!openTop,
    pivot,
    ring,
    size,
    traverse,
    facing: (facingDeg || 0) * DEG,
    limit: limitDeg ? [limitDeg[0] * DEG, limitDeg[1] * DEG] : null,
    sight: sightLevels(sight),
    rangefinder: { ...DEFAULT_RANGEFINDER, ...(sight?.rangefinder || {}) },
    loaders: loaders || [],
    guns,
    generated,
  };
}

/** Seconds for `loaderIdx` to load one round into gun `g` of turret `t`. */
export function reloadTime(turret, gunIdx, loaderIdx) {
  const g = turret.guns[gunIdx];
  // an automatic gun cycles itself until the belt is out; then the belt is changed
  const auto = g.def.autocannon;
  if (auto) {
    if (g.belt <= 0) {
      g.beltChange = true;
      return auto.belt_reload_s;
    }
    const interval = 60 / Math.max(1, auto.rate_rpm);
    return auto.spin_up_s > 0 ? interval / Math.max(0.12, g.spin) : interval;
  }
  // Layout-driven when the vehicle says where its loaders and racks are; otherwise the gun's data value.
  if (g.rack && turret.loaders.length) {
    const loader = turret.loaders[Math.min(loaderIdx, turret.loaders.length - 1)];
    return design.layoutReloadTime(g.shell.mass_kg, loader, g.rack, g.breech).total;
  }
  if (g.rack) return design.layoutReloadTime(g.shell.mass_kg, g.breech, g.rack, g.breech).total;
  return g.def.reload_s;
}

const MG_RANGES = [100, 200, 300, 400, 500, 600, 800, 1000, 1200];
const mgTables = new Map();
/** Range table of a machine gun's bullet (same maths as the main guns), worked out once per type. */
function mgTable(def) {
  if (!mgTables.has(def.id)) mgTables.set(def.id, rangeTable(bulletOf(def), MG_RANGES));
  return mgTables.get(def.id);
}
const MG_ARC = { hull: [15, 10, 18], pintle: [180, 10, 60] };
const MG_SLEW = { hull: 50, pintle: 70 }; // deg/s, by hand

/** bundle = {vehicle, weapons, engine, visual}; projectiles = id -> ProjectileDef; machineGuns = id -> def. */
export function makeLoadout(id, bundle, projectiles, machineGuns = {}) {
  const v = bundle.vehicle;
  const w = bundle.weapons;
  const shellsOf = (gun) => {
    const list = gun.ammo.map((id) => projectiles[id]).filter(Boolean);
    return list.length ? list : [projectiles[gun.ammo[0]]];
  };
  const partsFor = (idx) => bundle.visual.parts.some((p) => (p.mount === 'turret' || p.mount === 'gun') && (p.turret || 0) === idx);

  const mainGuns = [gunEntry(w.main_gun, shellsOf(w.main_gun), w.mount_m, w.muzzle_offset_m ?? w.main_gun.barrel_length_mm / 1000, w.rack_m)];
  for (const g of w.extra_guns || []) mainGuns.push(gunEntry(g.gun, shellsOf(g.gun), g.mount_m, g.muzzle_offset_m ?? g.gun.barrel_length_mm / 1000, g.rack_m));
  const turrets = [
    turretEntry('main', v.turret.position_m, v.turret.ring_diameter_m, v.turret.size_m, w.main_gun.traverse_deg_s, w.facing_deg, w.yaw_limit_deg, w.sight, w.loaders_m, mainGuns, !partsFor(0), v.turret.open_top, w.stabilizer, null, w.depression_by_bearing_deg),
  ];
  // designer vehicles: how far the gun may dip at each turret bearing (the barrel must clear the hull)
  turrets[0].foldedDepByYaw = w.folded_depression_by_bearing_deg;
  turrets[0].foldDepStages = w.fold_depression_stages;
  turrets[0].foldedLimit = w.folded_yaw_limit_deg?.map(d => d * DEG);
  turrets[0].foldYawStages = w.fold_yaw_limit_stages;
  if (bundle.design?.depression_by_yaw?.length) turrets[0].depByYaw = bundle.design.depression_by_yaw;
  (w.extra_turrets || []).forEach((t, i) => {
    const guns = t.guns.map((g) => gunEntry(g.gun, shellsOf(g.gun), g.mount_m, g.muzzle_offset_m ?? g.gun.barrel_length_mm / 1000, g.rack_m));
    turrets.push(turretEntry(t.id, t.position_m, t.ring_diameter_m, t.size_m, t.traverse_deg_s, t.facing_deg, t.yaw_limit_deg, t.sight, t.loaders_m, guns, !partsFor(i + 1), t.open_top, t.stabilizer, t.parent, t.depression_by_bearing_deg));
  });
  // machine guns: coaxial ones follow the main gun, hull and roof mounts are aimed by hand
  const mgs = [];
  for (const sec of w.secondary || []) {
    const def = machineGuns[sec.weapon];
    if (!def || !sec.mount) continue;
    const arc = (sec.arc_deg || MG_ARC[sec.mount] || [0, 0, 0]).map((d) => d * DEG);
    mgs.push({ id: sec.id, weapon: sec.weapon, mount: sec.mount, def, bullet: bulletOf(def), table: mgTable(def), pos: sec.position_m, elevationPivot: sec.elevation_pivot_m, post: sec.post_m ?? 0.34, shield: sec.shield_m || null, arc, slew: (MG_SLEW[sec.mount] || 0) * DEG });
  }
  return { id, name: v.name, vehicle: v, engine: bundle.engine, visual: bundle.visual, imported: bundle.imported || null, weapons: w, turrets, machineGuns: mgs, gunCount: turrets.reduce((s, t) => s + t.guns.length, 0) };
}

/** Allowed depression (deg) at a turret yaw (rad) from a 36-entry table; the full value without one. */
export function depressionAt(turret, yaw, full) {
  const tab = turret.depByYaw;
  if (!tab) return full;
  let deg = ((yaw * 180) / Math.PI) % 360;
  if (deg < 0) deg += 360;
  const step = 360 / tab.length;
  const i = Math.floor(deg / step);
  const f = deg / step - i;
  const v = tab[i % tab.length] * (1 - f) + tab[(i + 1) % tab.length] * f;
  return Math.min(full, v);
}

// ------------------------------------------------- generated turret geometry

function superellipse(cx, cz, rx, rzFront, rzRear, p = 2.8, n = 28) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = (2 * Math.PI * i) / n;
    const s = Math.sin(t);
    const c = Math.cos(t);
    const x = Math.sign(s) * Math.pow(Math.abs(s), 2 / p);
    const z = Math.sign(c) * Math.pow(Math.abs(c), 2 / p);
    pts.push([r3(cx + rx * x), r3(cz + (z >= 0 ? rzFront : rzRear) * z)]);
  }
  return pts;
}

/** Default exterior for a turret that has no parts of its own in visual.json. */
export function generatedTurretParts(turret, idx) {
  const [px, py, pz] = turret.pivot;
  const [tw, th, tl] = turret.size;
  const parts = [];
  const T = (p) => ({ ...p, turret: idx });
  if (turret.openTop) {
    // open-topped: thin walls a little lower than a closed turret, no roof and no cupola
    parts.push(T({ type: 'plan', mount: 'turret', mat: 'paint', outline: superellipse(px, pz, tw / 2, tl / 2, tl / 2, 3.4, 20), y0: py, y1: py + th * 0.9, scale_top: [0.92, 0.94], hollow: 0.04 }));
  } else {
    parts.push(T({ type: 'plan', mount: 'turret', mat: 'paint', outline: superellipse(px, pz, tw / 2, tl / 2, tl / 2), y0: py, y1: py + th, scale_top: [0.84, 0.86], smooth: true }));
    parts.push(T({ type: 'cyl', mount: 'turret', mat: 'paint', r: Math.min(0.3, turret.ring * 0.2), len: 0.16, axis: 'y', pos: [px - tw * 0.2, py + th + 0.08, pz - tl * 0.18], segs: 16 }));
  }
  turret.guns.forEach((g, j) => {
    const cal = g.def.caliber_mm;
    const r = cal * 0.0009 + 0.02;
    const [tx, ty, tz] = g.trunnion;
    const G = (p) => T({ ...p, mount: 'gun', gun: j });
    parts.push(G({ type: 'box', mat: 'paint', size: [0.3 + cal * 0.004, 0.26 + cal * 0.004, 0.18], pos: [tx, ty, tz + 0.1] }));
    parts.push(G({ type: 'cyl', mat: 'paint', r: r * 1.9, r2: r * 1.4, len: 0.3, axis: 'z', pos: [tx, ty, tz + 0.3], segs: 14 }));
    const m0 = tz + 0.42;
    const m1 = tz + g.muzzleOffset;
    const brake = cal >= 70 ? Math.min(0.5, cal * 0.004) : 0;
    parts.push(G({ type: 'cyl', mat: 'paint', r: r * 1.15, r2: r * 0.9, len: m1 - brake - m0, axis: 'z', pos: [tx, ty, (m0 + m1 - brake) / 2], segs: 14, recoil: true }));
    if (brake > 0) parts.push(G({ type: 'cyl', mat: 'paint_dark', r: r * 1.5, len: brake, axis: 'z', pos: [tx, ty, m1 - brake / 2], segs: 14, recoil: true }));
  });
  return parts;
}

// ---------------------------------------------------------- workshop builds

export function newTurretSpec(z = 0) {
  return { x: 0, z, lift: 0, facing: 0, arc: 360, ring: 1.4, loaders: 1, rack: 'ready', open: false, guns: [{ cal: 75, len: 48 }] };
}

export const PRESETS = {
  hexa: {
    label: '六炮怪',
    build: {
      base: 'proto_a',
      keepStock: false,
      turrets: [
        { x: 0, z: 1.75, lift: 0, facing: 0, arc: 240, ring: 1.4, loaders: 1, rack: 'ready', guns: [{ cal: 75, len: 48 }, { cal: 75, len: 48 }] },
        { x: 0, z: -0.1, lift: 0.75, facing: 0, arc: 360, ring: 1.5, loaders: 2, rack: 'ready', guns: [{ cal: 88, len: 56 }, { cal: 88, len: 56 }] },
        { x: 0, z: -1.95, lift: 0, facing: 180, arc: 240, ring: 1.3, loaders: 1, rack: 'ready', guns: [{ cal: 37, len: 45 }, { cal: 37, len: 45 }] },
      ],
    },
  },
  twin: {
    label: '雙管重炮',
    build: {
      base: 'de_tiger_e',
      keepStock: false,
      turrets: [{ x: 0, z: 0.1, lift: 0, facing: 0, arc: 360, ring: 2.0, loaders: 2, rack: 'hull_side', guns: [{ cal: 128, len: 55 }, { cal: 128, len: 55 }] }],
    },
  },
  porcupine: {
    label: '陸上刺蝟',
    build: {
      base: 'us_m4a3_76w_hvss',
      keepStock: true,
      turrets: [
        { x: -0.9, z: 2.0, lift: 0, facing: -35, arc: 120, ring: 0.8, loaders: 0, rack: 'ready', guns: [{ cal: 37, len: 45 }] },
        { x: 0.9, z: 2.0, lift: 0, facing: 35, arc: 120, ring: 0.8, loaders: 0, rack: 'ready', guns: [{ cal: 37, len: 45 }] },
        { x: 0, z: -1.9, lift: 0.3, facing: 180, arc: 240, ring: 1.2, loaders: 1, rack: 'ready', guns: [{ cal: 57, len: 50 }, { cal: 57, len: 50 }] },
      ],
    },
  },
};

function arcLimit(arc) {
  return arc >= 360 ? null : [-arc / 2, arc / 2];
}

/** Geometry of one workshop turret on a given hull. */
function layoutTurret(spec, hull, idx) {
  const H = hull.size_m[1];
  const W = hull.size_m[0];
  const designs = spec.guns.map((g) => design.designGun(g.cal, g.len));
  const maxCal = Math.max(...designs.map((d) => d.gun.caliber_mm));
  const th = r3(clamp(0.5 + maxCal * 0.0035, 0.55, 1.1));
  const tw = r3(spec.ring * 1.22 + 0.1);
  const tl = r3(spec.ring * 1.45 + 0.2);
  const pivot = [r3(spec.x), r3(H + spec.lift), r3(spec.z)];
  const n = designs.length;
  const spacing = Math.min((tw * 0.8) / n, Math.max(0.26, maxCal * 0.004 + 0.14));
  const gunsMass = designs.reduce((s, d) => s + d.gun.mass_kg, 0);
  const traverse = Math.round(design.traverseRate(spec.ring, gunsMass) * 10) / 10;
  const rack =
    spec.rack === 'hull_floor'
      ? [r3(pivot[0] * 0.5), 0.55, pivot[2]]
      : spec.rack === 'hull_side'
        ? [r3((pivot[0] < 0 ? -1 : 1) * (W / 2 - 0.4)), r3(H * 0.62), pivot[2]]
        : // ready rack on the turret wall, right beside the first loader
          [r3(pivot[0] + tw / 2 - 0.3), r3(pivot[1] + th * 0.5), r3(pivot[2] - tl * 0.22)];
  const loaders = [];
  for (let k = 0; k < spec.loaders; k++) loaders.push([r3(pivot[0] + (k % 2 ? -1 : 1) * spec.ring * 0.27), r3(pivot[1] + 0.3), r3(pivot[2] - 0.12 - Math.floor(k / 2) * 0.3)]);
  const guns = designs.map((d, j) => {
    const off = (j - (n - 1) / 2) * spacing;
    d.gun.traverse_deg_s = traverse;
    return {
      gun: d.gun,
      shell: d.shell,
      mount_m: [r3(pivot[0] + off), r3(pivot[1] + th * 0.5), r3(pivot[2] + tl / 2 - 0.12)],
      muzzle_offset_m: r3((d.gun.barrel_length_mm / 1000) * 0.86),
      rack_m: rack,
    };
  });
  return {
    id: 't' + idx,
    position_m: pivot,
    ring_diameter_m: spec.ring,
    size_m: [tw, th, tl],
    traverse_deg_s: traverse,
    facing_deg: spec.facing,
    yaw_limit_deg: arcLimit(spec.arc),
    loaders_m: loaders,
    sight: { name: '工坊瞄準鏡', levels: [{ magnification: 3, fov_deg: 16 }, { magnification: 6, fov_deg: 8 }], rangefinder: { time_s: 1.8, error_pct: 3, max_range_m: 3000 } },
    guns,
    // no roof and thinner walls: an open-topped turret weighs about a quarter less
    mass: design.turretMassKg(spec.ring, gunsMass) * (spec.open ? 0.75 : 1),
    open_top: !!spec.open,
    lift: spec.lift,
  };
}

/**
 * Converts a workshop build into data-format files. Returns {bundle, projectiles, stats}.
 * bundle has the same shape as a stock vehicle's {vehicle, weapons, engine, visual}.
 */
export function buildToBundle(build, data, id = 'custom_build', name = '自訂戰車') {
  const base = data.vehicles[build.base];
  const hull = base.vehicle.hull;
  const projectiles = {};
  const layouts = build.turrets.slice(0, MAX_TURRETS).map((t, i) => layoutTurret(t, hull, i + 1));
  for (const t of layouts) for (const g of t.guns) projectiles[g.shell.id] = g.shell;

  const stockMass = design.turretMassKg(base.vehicle.turret.ring_diameter_m, base.weapons.main_gun.mass_kg);
  const addedMass = layouts.reduce((s, t) => s + t.mass, 0);
  const mass = Math.round(hull.mass_kg - (build.keepStock ? 0 : stockMass) + addedMass);

  const strip = (t) => ({
    id: t.id,
    position_m: t.position_m,
    ring_diameter_m: t.ring_diameter_m,
    size_m: t.size_m,
    traverse_deg_s: t.traverse_deg_s,
    facing_deg: t.facing_deg,
    ...(t.yaw_limit_deg ? { yaw_limit_deg: t.yaw_limit_deg } : {}),
    loaders_m: t.loaders_m,
    sight: t.sight,
    ...(t.open_top ? { open_top: true } : {}),
    guns: t.guns.map((g) => ({ gun: g.gun, mount_m: g.mount_m, muzzle_offset_m: g.muzzle_offset_m, rack_m: g.rack_m })),
  });

  let weapons;
  let turretDef;
  let extra;
  if (build.keepStock || layouts.length === 0) {
    weapons = { ...base.weapons };
    turretDef = base.vehicle.turret;
    extra = layouts;
  } else {
    const [first, ...rest] = layouts;
    const g0 = first.guns[0];
    weapons = {
      main_gun: g0.gun,
      mount_m: g0.mount_m,
      muzzle_offset_m: g0.muzzle_offset_m,
      sight: first.sight,
      secondary: [],
      rack_m: g0.rack_m,
      loaders_m: first.loaders_m,
      facing_deg: first.facing_deg,
      ...(first.yaw_limit_deg ? { yaw_limit_deg: first.yaw_limit_deg } : {}),
      extra_guns: first.guns.slice(1).map((g) => ({ gun: g.gun, mount_m: g.mount_m, muzzle_offset_m: g.muzzle_offset_m, rack_m: g.rack_m })),
    };
    turretDef = { size_m: first.size_m, ring_diameter_m: first.ring_diameter_m, position_m: first.position_m, ...(first.open_top ? { open_top: true } : {}) };
    extra = rest;
  }
  weapons.extra_turrets = extra.map(strip);

  const hullParts = base.visual.parts.filter((p) => build.keepStock || !(p.mount === 'turret' || p.mount === 'gun'));
  const barbettes = layouts
    .filter((t) => t.lift > 0.02)
    .map((t) => ({ type: 'cyl', mount: 'hull', mat: 'paint_dark', r: r3(t.ring_diameter_m * 0.5), len: r3(t.lift), axis: 'y', pos: [t.position_m[0], r3(hull.size_m[1] + t.lift / 2), t.position_m[2]], segs: 20 }));

  const vehicle = {
    ...base.vehicle,
    id,
    name,
    meta: { nation: 'fictional', based_on: `workshop build on ${base.vehicle.id}`, notes: 'Generated by the workshop; gun and shell values come from tg_weapon::design.' },
    hull: { ...hull, mass_kg: mass },
    turret: turretDef,
  };
  const bundle = { vehicle, weapons, engine: base.engine, visual: { ...base.visual, parts: [...hullParts, ...barbettes] } };
  const hp = base.engine.engine.horsepower;
  const stats = {
    mass,
    hpPerTon: hp / (mass / 1000),
    guns: layouts.reduce((s, t) => s + t.guns.length, 0) + (build.keepStock ? 1 : 0),
    salvoMomentum: layouts.reduce((s, t) => s + t.guns.reduce((a, g) => a + g.shell.mass_kg * g.shell.muzzle_velocity_ms * 1.3, 0), 0),
    turrets: layouts,
  };
  return { bundle, projectiles, stats, layouts };
}

// ------------------------------------------------------------------- export

const plate = (id, zone, mm, c, n, u, hu, hv) => ({ id, zone, material: 'rha', thickness_mm: mm, center: { x: r3(c[0]), y: r3(c[1]), z: r3(c[2]) }, normal: { x: n[0], y: n[1], z: n[2] }, axis_u: { x: u[0], y: u[1], z: u[2] }, half_u: r3(hu), half_v: r3(hv) });
const mod = (id, kind, c, he, hp) => ({ id, kind, center: { x: r3(c[0]), y: r3(c[1]), z: r3(c[2]) }, half_extents: { x: he[0], y: he[1], z: he[2] }, max_health: hp, health: hp });
const crewman = (role, p) => ({ role, pos: { x: r3(p[0]), y: r3(p[1]), z: r3(p[2]) }, radius: 0.25, health: 100 });

/**
 * Full vehicle folder for a workshop build, as {filename: json}. Armour, modules and crew for
 * the generated turrets are laid out automatically; base-vehicle files are needed for the hull.
 * baseFiles = {armor, modules, crew} of the base vehicle (data-format arrays).
 */
export function exportFolder(build, data, baseFiles, id, name) {
  const { bundle, projectiles, layouts } = buildToBundle(build, data, id, name);
  const TURRET_KINDS = ['gun_breech', 'gun_barrel', 'ammo_rack', 'turret_drive', 'horizontal_drive', 'vertical_drive'];
  const armor = baseFiles.armor.filter((p) => build.keepStock || p.zone.startsWith('hull'));
  const modules = baseFiles.modules.filter((m) => build.keepStock || !TURRET_KINDS.includes(m.kind));
  const crew = baseFiles.crew.filter((c) => build.keepStock || c.role === 'driver' || c.role === 'radio_operator');
  layouts.forEach((t, i) => {
    const [px, py, pz] = t.position_m;
    const [tw, th, tl] = t.size_m;
    const s = `_${t.id}`;
    armor.push(plate('turret_front' + s, 'turret_front', 80, [px, py + th / 2, pz + tl / 2 - 0.03], [0, 0, 1], [1, 0, 0], tw / 2, th / 2));
    armor.push(plate('turret_side_r' + s, 'turret_side', 50, [px + tw / 2 - 0.02, py + th / 2, pz], [1, 0, 0], [0, 0, 1], tl / 2, th / 2));
    armor.push(plate('turret_side_l' + s, 'turret_side', 50, [px - tw / 2 + 0.02, py + th / 2, pz], [-1, 0, 0], [0, 0, 1], tl / 2, th / 2));
    armor.push(plate('turret_rear' + s, 'turret_rear', 50, [px, py + th / 2, pz - tl / 2 + 0.03], [0, 0, -1], [1, 0, 0], tw / 2, th / 2));
    if (!t.open_top) armor.push(plate('turret_roof' + s, 'turret_roof', 20, [px, py + th, pz], [0, 1, 0], [1, 0, 0], tw / 2 - 0.1, tl / 2 - 0.1));
    t.guns.forEach((g, j) => {
      const [tx, ty, tz] = g.mount_m;
      const cal = g.gun.caliber_mm;
      armor.push(plate(`gun_mantlet${s}_${j}`, 'gun_mantlet', 80, [tx, ty, pz + tl / 2 + 0.06], [0, 0, 1], [1, 0, 0], 0.15 + cal * 0.002, 0.13 + cal * 0.002));
      modules.push(mod(`breech${s}_${j}`, 'gun_breech', [tx, ty, tz - 0.4], [0.11, 0.11, 0.24], 90));
      modules.push(mod(`gun_barrel${s}_${j}`, 'gun_barrel', [tx, ty, tz + g.muzzle_offset_m / 2 + 0.2], [0.08, 0.08, r3(g.muzzle_offset_m / 2 - 0.2)], 110));
    });
    const rack = t.guns[0].rack_m;
    modules.push(mod('ammo_rack' + s, 'ammo_rack', rack, [0.2, 0.12, 0.12], 50));
    modules.push(mod('turret_drive' + s, 'turret_drive', [px - tw * 0.3, py + 0.1, pz - tl * 0.05], [0.1, 0.08, 0.12], 70));
    crew.push(crewman('gunner', [px - t.ring_diameter_m * 0.27, py + 0.3, pz + 0.12]));
    t.loaders_m.forEach((l) => crew.push(crewman('loader', l)));
    if (i === 0 && !build.keepStock) crew.push(crewman('commander', [px + t.ring_diameter_m * 0.05, py + 0.38, pz - t.ring_diameter_m * 0.36]));
  });
  const vehicle = { ...bundle.vehicle, files: { armor: 'armor.json', weapons: 'weapons.json', engine: 'engine.json', crew: 'crew.json', modules: 'modules.json', visual: 'visual.json' } };
  return {
    files: { 'vehicle.json': vehicle, 'armor.json': armor, 'weapons.json': bundle.weapons, 'engine.json': bundle.engine, 'crew.json': crew, 'modules.json': modules, 'visual.json': bundle.visual },
    projectiles,
    layouts,
  };
}

/**
 * Geometric subset of the Rust content validator (P003/P004/P008, M004, M006, C003, C004) for an
 * exported folder, so workshop exports can be checked without the Rust toolchain.
 */
export function checkFolder(files) {
  const v = files['vehicle.json'];
  const w = files['weapons.json'];
  const boxes = [
    { c: [0, v.hull.size_m[1] / 2, 0], h: [v.hull.size_m[0] / 2, v.hull.size_m[1] / 2, v.hull.size_m[2] / 2] },
    { c: [v.turret.position_m[0], v.turret.position_m[1] + v.turret.size_m[1] / 2, v.turret.position_m[2]], h: v.turret.size_m.map((s) => s / 2) },
    ...(w.extra_turrets || []).map((t) => ({ c: [t.position_m[0], t.position_m[1] + t.size_m[1] / 2, t.position_m[2]], h: t.size_m.map((s) => s / 2) })),
  ];
  const inside = (p, m) => boxes.some((b) => [0, 1, 2].every((i) => Math.abs(p[i] - b.c[i]) <= b.h[i] + m));
  const xyz = (o) => [o.x, o.y, o.z];
  const out = [];
  const ext = ['gun_barrel', 'track'];
  for (const p of files['armor.json']) {
    const n = xyz(p.normal);
    const u = xyz(p.axis_u);
    if (Math.abs(Math.hypot(...n) - 1) > 0.01) out.push('P003 ' + p.id);
    if (Math.abs(n[0] * u[0] + n[1] * u[1] + n[2] * u[2]) > 0.01) out.push('P004 ' + p.id);
    if (!inside(xyz(p.center), 0.1)) out.push('P008 ' + p.id);
  }
  const ids = new Set();
  for (const p of files['armor.json']) {
    if (ids.has(p.id)) out.push('P005 ' + p.id);
    ids.add(p.id);
  }
  const mods = files['modules.json'];
  for (const m of mods) {
    if (ext.includes(m.kind)) continue;
    const c = xyz(m.center);
    const h = xyz(m.half_extents);
    for (let k = 0; k < 8; k++) {
      const q = [c[0] + (k & 1 ? h[0] : -h[0]), c[1] + (k & 2 ? h[1] : -h[1]), c[2] + (k & 4 ? h[2] : -h[2])];
      if (!inside(q, 0.05)) {
        out.push('M004 ' + m.id);
        break;
      }
    }
  }
  for (let i = 0; i < mods.length; i++) {
    for (let j = i + 1; j < mods.length; j++) {
      const a = mods[i];
      const b = mods[j];
      if (ext.includes(a.kind) || ext.includes(b.kind)) continue;
      if (['x', 'y', 'z'].every((k) => Math.abs(a.center[k] - b.center[k]) < a.half_extents[k] + b.half_extents[k])) out.push(`M006 ${a.id}/${b.id}`);
    }
  }
  for (const c of files['crew.json']) if (!inside(xyz(c.pos), 0.05)) out.push('C003 ' + c.role);
  for (const role of ['commander', 'gunner', 'loader', 'driver']) if (!files['crew.json'].some((c) => c.role === role)) out.push('C004 ' + role);
  return out;
}
