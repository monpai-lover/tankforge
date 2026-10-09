// Starting points for a new design (a blank chassis, or a light / medium / heavy layout) and
// the interior auto-arrangement. Every number a template sets is a design choice (shape,
// thickness, component choice, position); everything derived is left to the core.
import { genHull, genTurret, hullProfile, ringHeight, turretFrontAt, HULL_DEFAULTS, HULL_PRESETS, TURRET_PRESETS } from './gen.js';
import { reconcileArmor } from './doc.js';

const r3 = (x) => Math.round(x * 1000) / 1000;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export const TEMPLATES = {
  blank: { label: '空白底盤', note: '只有車體、行走機構、引擎與駕駛：炮塔、火炮、乘員、彈藥全部自己裝' },
  light: { label: '輕型範本', note: '小車體、37 mm 炮、渦形彈簧' },
  medium: { label: '中型範本', note: '楔形車體、焊接炮塔、75 mm L/48' },
  heavy: { label: '重型範本', note: '箱型車體、鑄造炮塔、88 mm L/56、交錯負重輪' },
};

const SPECS = {
  light: {
    hull: { ...HULL_DEFAULTS, ...HULL_PRESETS.wedge, length: 5.1, width_top: 2.5, width_low: 1.55, floor_y: 0.4, sponson_y: 0.96, deck_y: 1.5, nose_y: 0.74, upper_glacis_deg: 45, lower_glacis_deg: 45 },
    turret: { ...TURRET_PRESETS.welded, length: 2.15, width: 1.75, height: 0.86, front_z: 1.0, chamfer: 0.24, front_deg: 15, side_deg: 15, rear_deg: 8 },
    ring: { d: 1.45, z: -0.1 },
    gun: { caliber_mm: 37, length_cal: 50 },
    armor: 0.6,
    engine: { kind: 'gasoline', power_hp: 280 },
    transmission: { kind: 'synchromesh', forward_gears: 5, gearing_kmh: 52, steering: 'controlled_differential' },
    suspension: { kind: 'volute', stations: 5, wheel_diameter_m: 0.55, sprocket: 'front' },
    track_w: 0.36,
    ammo: [{ kind: 'ap', count: 60 }, { kind: 'he', count: 30 }],
    paint: '#5f6b4e',
  },
  medium: {
    hull: { ...HULL_DEFAULTS, ...HULL_PRESETS.wedge },
    turret: { ...TURRET_PRESETS.welded },
    ring: { d: 1.7, z: -0.15 },
    gun: { caliber_mm: 75, length_cal: 48 },
    armor: 1,
    engine: { kind: 'gasoline', power_hp: 550 },
    transmission: { kind: 'synchromesh', forward_gears: 5, gearing_kmh: 44, steering: 'regenerative' },
    suspension: { kind: 'torsion_bar', stations: 6, wheel_diameter_m: 0.68, sprocket: 'front' },
    track_w: 0.5,
    ammo: [{ kind: 'apcbc', count: 40 }, { kind: 'he', count: 24 }, { kind: 'apcr', count: 6 }],
    paint: '#5d6872',
  },
  heavy: {
    hull: { ...HULL_DEFAULTS, ...HULL_PRESETS.box, length: 7.0, width_top: 3.6, width_low: 2.0, floor_y: 0.48, sponson_y: 1.08, deck_y: 1.8, nose_y: 0.95, upper_glacis_deg: 10, lower_glacis_deg: 45 },
    turret: { ...TURRET_PRESETS.cast, length: 2.9, width: 2.35, height: 0.98, front_z: 1.35 },
    ring: { d: 1.9, z: 0.05 },
    gun: { caliber_mm: 88, length_cal: 56 },
    armor: 1.45,
    engine: { kind: 'gasoline', power_hp: 720 },
    transmission: { kind: 'preselector', forward_gears: 8, gearing_kmh: 40, steering: 'regenerative' },
    suspension: { kind: 'interleaved', stations: 8, wheel_diameter_m: 0.8, sprocket: 'front' },
    track_w: 0.72,
    ammo: [{ kind: 'apcbc', count: 50 }, { kind: 'he', count: 30 }],
    paint: '#6e6a52',
  },
};
SPECS.blank = { ...SPECS.medium, turret: null, gun: null, ammo: [] };

/** Engine / transmission boxes, mirroring tg_design::layout (only used to place them; the core sizes them). */
export function engineBox(cat, kind, hp) {
  const c = cat.engines[kind];
  const vol = c.base_m3 + c.m3_per_hp * hp;
  const s = Math.cbrt(vol / (1.25 * 0.75));
  return [s, 0.75 * s, 1.25 * s];
}
export function transmissionBox(cat, kind, hp) {
  const c = cat.transmissions[kind];
  const vol = c.base_m3 + c.m3_per_hp * hp;
  const s = Math.cbrt(vol / (1.3 * 0.7 * 0.8));
  return [1.3 * s, 0.7 * s, 0.8 * s];
}

export function breechSize(cat, cal) {
  const g = cat.gun;
  return { rear: g.breech_rear_base_m + g.breech_rear_per_mm * cal, width: g.breech_width_base_m + g.breech_width_per_mm * cal, height: g.breech_height_base_m + g.breech_height_per_mm * cal };
}

export function recoilDefault(cal) {
  return (250 + cal * 2.2) / 1000;
}

/** Track centre and wheel stations that fit under the sponsons of a hull. */
export function fitRunningGear(design) {
  const p = design.editor.hull.params;
  const s = design.suspension;
  const r = s.wheel_diameter_m / 2;
  const L = p.length / 2;
  s.front_z_m = r3(L - 0.62 - r);
  s.rear_z_m = r3(-(L - 0.62 - r));
  const w = design.tracks.width_m;
  design.tracks.center_x_m = r3(clamp(p.width_top / 2 - w / 2 - 0.02, p.width_low / 2 + w / 2 + 0.04, 3));
}

/** Gun mount and mantlet for the current turret shape and gun. */
export function fitGunMount(design, cat) {
  const tm = design.turret_geometry;
  if (!tm || !design.weapons) return;
  const tp = design.editor.turret.params;
  const cal = design.weapons.caliber_mm;
  const b = breechSize(cat, cal);
  const ty = r3(clamp(tp.height * 0.5, b.height / 2 + 0.1, tp.height - b.height / 2 - 0.12));
  const front = turretFrontAt(tm, ty);
  const tz = r3(front - 0.22 - cal * 0.0012);
  const m = design.gun_mount || {};
  const frontArmor = design.armor_faces.find((a) => a.body === 'turret' && /front/.test(tagOf(tm, a.face)))?.thickness_mm ?? 90;
  design.gun_mount = {
    position_m: [0, ty, tz],
    elevation_axis: [1, 0, 0],
    min_elevation_deg: m.min_elevation_deg ?? -8,
    max_elevation_deg: m.max_elevation_deg ?? 20,
    recoil_distance_m: r3(recoilDefault(cal)),
    mantlet: { width_m: r3(0.36 + cal * 0.0042), height_m: r3(0.3 + cal * 0.0032), thickness_mm: Math.round(frontArmor * 0.85), material: 'cha', offset_m: r3(front - tz + 0.015) },
  };
}

function tagOf(mesh, id) {
  return mesh.faces.find((f) => f.id === id)?.tag || '';
}

/** Puts the turret ring on the roof at (x, z) and sizes it. */
export function placeRing(design, x, z, d) {
  const y = ringHeight(design.hull_geometry, x, z, d);
  design.turret_ring = { diameter_m: r3(d), position_m: [r3(x), y, r3(z)], rotation_axis: [0, 1, 0], drive: design.turret_ring?.drive || 'electric' };
}

/**
 * First guess for every module and crew station from the hull and turret shape: engine at the
 * back, transmission (front sprocket) or both at the back, driver and radio operator behind the
 * transmission, fuel and ammunition in the sponsons, turret crew round the breech.
 */
export function defaultLayout(design, cat) {
  const p = design.editor.hull.params;
  const { zFront, zRear } = hullProfile(p);
  const floorIn = p.floor_y + 0.06 + (cat.suspensions[design.suspension.kind]?.floor_m || 0);
  const roofIn = p.deck_y - 0.05;
  const wl = p.width_low / 2 - 0.08;
  const wt = p.width_top / 2 - 0.09;
  const hp = design.engine.power_hp;
  const eng = engineBox(cat, design.engine.kind, hp);
  const tr = transmissionBox(cat, design.transmission.kind, hp);
  const rearAt = (y0, y1) => Math.max(zRear(y0), zRear(y1)) + 0.16;
  const frontAt = (y0, y1) => Math.min(zFront(y0), zFront(y1)) - 0.22;
  const mods = [];
  const crew = [];
  const add = (id, kind, mount, c, size) => mods.push({ id, kind, mount, center_m: c.map(r3), ...(size ? { size_m: size.map(r3) } : {}) });
  // engine and fuel at the back
  const ey0 = floorIn + 0.02;
  const ez = rearAt(ey0, ey0 + eng[1]) + eng[2] / 2 + 0.02;
  const rearSprocket = design.suspension.sprocket === 'rear';
  let engineZ = ez;
  if (rearSprocket) {
    const tz0 = rearAt(ey0, ey0 + tr[1]) + tr[2] / 2;
    add('transmission', 'transmission', 'hull', [0, ey0 + tr[1] / 2, tz0]);
    engineZ = tz0 + tr[2] / 2 + eng[2] / 2 + 0.06;
  }
  add('engine', 'engine', 'hull', [0, ey0 + eng[1] / 2, engineZ]);
  const spY0 = p.sponson_y + 0.06;
  const spY1 = roofIn - 0.02;
  const spIn = p.width_low / 2 + 0.09;
  const spX = (spIn + wt) / 2;
  const spW = Math.max(0.2, wt - spIn);
  const fuelLen = Math.max(0.6, eng[2] + 0.1);
  const fuelZ = Math.max(rearAt(spY0, spY1) + fuelLen / 2 + 0.02, engineZ - eng[2] / 2 + fuelLen / 2);
  for (const s of [1, -1]) add(s > 0 ? 'fuel_r' : 'fuel_l', 'fuel_tank', 'hull', [s * spX, (spY0 + spY1) / 2, fuelZ], [spW, spY1 - spY0, fuelLen]);
  // front: transmission, then driver and radio operator
  let crewZ;
  if (!rearSprocket) {
    const tz = frontAt(ey0, ey0 + tr[1]) - tr[2] / 2;
    add('transmission', 'transmission', 'hull', [0, ey0 + tr[1] / 2, tz]);
    crewZ = tz - tr[2] / 2 - 0.34;
  } else {
    crewZ = frontAt(floorIn, floorIn + 0.9) - 0.34;
  }
  const seatY = floorIn + 0.47;
  crew.push({ role: 'driver', mount: 'hull', position_m: [r3(-Math.min(0.45, wl - 0.26)), r3(seatY), r3(crewZ)] });
  if (p.width_low > 1.45) crew.push({ role: 'radio_operator', mount: 'hull', position_m: [r3(Math.min(0.45, wl - 0.26)), r3(seatY), r3(crewZ)] });
  add('radio', 'radio', 'hull', [r3(spX), r3(spY0 + 0.2), r3(crewZ + 0.05)]);
  // ammunition along the sponsons between the crew and the engine room
  const ring = design.turret_ring;
  const rr = ring ? ring.diameter_m / 2 + 0.12 : 0;
  const z0 = fuelZ + fuelLen / 2 + 0.05;
  const z1 = crewZ - 0.35;
  if (z1 - z0 > 0.4) {
    const x0 = Math.max(spIn, rr);
    if (wt - x0 > 0.18) for (const s of [1, -1]) add(s > 0 ? 'rack_r' : 'rack_l', 'ammo_rack', 'hull', [s * (x0 + wt) / 2, (spY0 + spY1) / 2, (z0 + z1) / 2], [wt - x0, spY1 - spY0, z1 - z0]);
  }
  if (ring) {
    // floor rack under the turret basket
    const top = ring.position_m[1] - 0.66;
    if (top - floorIn > 0.22) add('rack_floor', 'ammo_rack', 'hull', [0, (floorIn + top) / 2, ring.position_m[2]], [Math.min(1.0, 2 * wl - 0.1), top - floorIn, 0.8]);
  }
  // turret crew round the breech
  if (design.turret_geometry && design.gun_mount && ring) {
    const tp = design.editor.turret.params;
    const b = breechSize(cat, design.weapons.caliber_mm);
    const [, ty, tz] = design.gun_mount.position_m;
    const side = b.width / 2 + 0.03 + 0.25;
    const R = ring.diameter_m / 2;
    const gz = Math.min(tz - 0.45, Math.sqrt(Math.max(0.01, (R - 0.05) ** 2 - (side + 0.18) ** 2)) - 0.2);
    const H = tp.height;
    // a narrow turret has room for two: the commander loads, and both sit up on the ring
    // instead of in a basket
    const three = tp.width >= 1.85;
    crew.push({ role: 'gunner', mount: 'turret', position_m: [r3(-side), r3(three ? Math.min(0.1, H - 0.55) : H - 0.5), r3(gz)] });
    crew.push({ role: 'commander', mount: 'turret', position_m: three ? [r3(-side), r3(H - 0.52), r3(gz - 0.62)] : [r3(side), r3(H - 0.52), r3(gz - 0.3)] });
    if (three) crew.push({ role: 'loader', mount: 'turret', position_m: [r3(side), r3(H - 0.72), r3(gz - 0.2)] });
    const zr = tp.front_z - tp.length;
    const rw = Math.min(tp.width * 0.5, 1.0);
    const rackY = Math.min(ty, H - 0.3);
    const lean = Math.tan(Math.max(0, tp.rear_deg) * Math.PI / 180) * (rackY + 0.15);
    add('rack_ready', 'ammo_rack', 'turret', [0.1, rackY, zr + 0.24 + lean], [rw, 0.28, 0.24]);
    add('turret_drive', 'turret_drive', 'turret', [r3(side + 0.05), 0.14, r3(gz + 0.42)]);
  }
  design.internal_modules = mods;
  design.crew_positions = crew;
}

/** Template design, fully assembled (meshes, armour, ring, gun, layout). */
export function newDesign(key, cat, id = 'my_tank', name = '我的戰車') {
  const sp = SPECS[key] || SPECS.medium;
  const hull = genHull(sp.hull);
  const design = {
    schema: 'tankforge.design/1',
    id,
    name,
    hull_geometry: hull.mesh,
    turret_geometry: null,
    armor_faces: [],
    armor_layers: [],
    addons: [],
    turret_ring: null,
    gun_mount: null,
    internal_modules: [],
    crew_positions: [],
    engine: { ...sp.engine },
    transmission: { ...sp.transmission },
    suspension: { ...sp.suspension, front_z_m: 2, rear_z_m: -2 },
    tracks: { width_m: sp.track_w, center_x_m: 1.3 },
    weapons: null,
    ammunition: sp.ammo.map((a) => ({ ...a })),
    visual: { paint: sp.paint },
    editor: { version: 1, template: key, hull: { params: hull.params, ops: [] }, turret: null, symmetry: true },
  };
  reconcileArmor(design, 'hull', hull.mesh, [], new Map());
  for (const a of design.armor_faces) a.thickness_mm = Math.round(a.thickness_mm * sp.armor);
  fitRunningGear(design);
  if (sp.turret) {
    const t = genTurret(sp.turret);
    design.turret_geometry = t.mesh;
    design.editor.turret = { params: t.params, ops: [] };
    reconcileArmor(design, 'turret', t.mesh, [], new Map());
    for (const a of design.armor_faces) if (a.body === 'turret') a.thickness_mm = Math.round(a.thickness_mm * sp.armor);
    placeRing(design, 0, sp.ring.z, sp.ring.d);
    design.weapons = { ...sp.gun };
    fitGunMount(design, cat);
  }
  defaultLayout(design, cat);
  return design;
}

// ------------------------------------------------------------------ auto-arrange

function aabb(c, s) {
  return { min: [c[0] - s[0] / 2, c[1] - s[1] / 2, c[2] - s[2] / 2], max: [c[0] + s[0] / 2, c[1] + s[1] / 2, c[2] + s[2] / 2] };
}
function overlaps(a, b, m = 0.005) {
  for (let k = 0; k < 3; k++) if (!(a.min[k] < b.max[k] - m && b.min[k] < a.max[k] - m)) return false;
  return true;
}
function radial(box) {
  let r = 0;
  for (const x of [box.min[0], box.max[0]]) for (const z of [box.min[2], box.max[2]]) r = Math.max(r, Math.hypot(x, z));
  return r;
}

/**
 * Collision of one candidate box with the others (same rules as the core: boxes may not
 * overlap, nothing may sit in the breech's swept volume, and turret items that reach below the
 * ring must clear every hull item as the turret turns).
 */
function clashes(cand, others, ring, sweep) {
  const toHull = (b) => (b.mount === 'turret' && ring ? { min: b.box.min.map((v, k) => v + ring[k]), max: b.box.max.map((v, k) => v + ring[k]) } : b.box);
  const ch = toHull(cand);
  for (const o of others) if (overlaps(ch, toHull(o))) return true;
  if (ring && sweep) {
    const local = cand.mount === 'turret' ? cand.box : { min: cand.box.min.map((v, k) => v - ring[k]), max: cand.box.max.map((v, k) => v - ring[k]) };
    if (overlaps(sweep, local)) return true;
  }
  if (!ring) return false;
  const sweepers = others.filter((o) => o.mount === 'turret' && o.box.min[1] < 0).map((o) => ({ r: radial(o.box), low: o.box.min[1] }));
  if (sweep && sweep.min[1] < 0) sweepers.push({ r: radial(sweep), low: sweep.min[1] });
  const hits = (hullBox, r, low) => {
    if (hullBox.max[1] <= ring[1] + low || hullBox.min[1] >= ring[1]) return false;
    const cx = clamp(ring[0], hullBox.min[0], hullBox.max[0]);
    const cz = clamp(ring[2], hullBox.min[2], hullBox.max[2]);
    return Math.hypot(cx - ring[0], cz - ring[2]) < r - 0.005;
  };
  if (cand.mount === 'hull') return sweepers.some((s) => hits(cand.box, s.r, s.low));
  if (cand.box.min[1] < 0) {
    const r = radial(cand.box);
    return others.filter((o) => o.mount === 'hull').some((o) => hits(o.box, r, cand.box.min[1]));
  }
  return false;
}

/**
 * Moves every module / crew station that does not fit (outside the armour, overlapping, in the
 * breech's way) to the nearest spot that does. Uses the core for "inside the armour" and the
 * core's report for sizes and the breech sweep. Returns the number of items it could not place.
 */
export function arrange(core, design, { maxRadius = 1.6 } = {}) {
  let report = core.evaluate(design, { mobility: false });
  const ring = design.turret_ring?.position_m || null;
  const sweep = report.gun?.clearance?.breech_sweep || null;
  const items = report.interior.boxes
    .filter((b) => b.kind !== 'gun_breech')
    .map((b) => ({ id: b.id, crew: b.crew, mount: b.mount, size: b.size, center: b.center.slice(), box: aabb(b.center, b.size), bad: !b.inside || b.collisions.length > 0 }));
  const ref = (it) => {
    if (it.crew) {
      const idx = Number(it.id.split('_').pop());
      return { get: () => design.crew_positions[idx].position_m, set: (c) => (design.crew_positions[idx].position_m = c) };
    }
    const m = design.internal_modules.find((x) => x.id === it.id);
    return { get: () => m.center_m, set: (c) => (m.center_m = c) };
  };
  // offsets ordered by distance, finer near the start
  const offsets = [];
  const step = 0.06;
  const n = Math.ceil(maxRadius / step);
  for (let i = -n; i <= n; i++) for (let j = -Math.ceil(n / 2); j <= Math.ceil(n / 2); j++) for (let k = -n; k <= n; k++) {
    const d = [i * step, j * step, k * step];
    const l = Math.hypot(d[0], d[1] * 1.5, d[2]);
    if (l <= maxRadius) offsets.push({ d, l });
  }
  offsets.sort((a, b) => a.l - b.l);
  let failed = 0;
  for (const it of items) {
    if (!it.bad) continue;
    const others = items.filter((o) => o !== it);
    let placed = false;
    for (let start = 0; start < offsets.length && !placed; start += 400) {
      const batch = offsets.slice(start, start + 400).map((o) => [it.center[0] + o.d[0], it.center[1] + o.d[1], it.center[2] + o.d[2]]);
      const free = batch.filter((c) => !clashes({ mount: it.mount, box: aabb(c, it.size) }, others, ring, sweep));
      if (!free.length) continue;
      const fit = core.fits(free.map((c) => ({ mount: it.mount, center: c, size: it.size, crew: it.crew })), design);
      const k = fit.findIndex((f) => f.inside);
      if (k >= 0) {
        const c = free[k].map(r3);
        ref(it).set(c);
        it.center = c;
        it.box = aabb(c, it.size);
        it.bad = false;
        placed = true;
      }
    }
    if (!placed) failed++;
  }
  return failed;
}
