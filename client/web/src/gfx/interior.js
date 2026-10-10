// What is inside the vehicle, built from the same modules.json / crew.json the damage model uses:
// engine, transmission, fuel tanks, ammunition, breech and drives, radio, and the crew at their
// stations. Shown by the interior view (the outer shell goes see-through).
import { GeoBuilder, hexToLinear, IDENTITY } from './geo.js';
import { Node, translation, mul, rotZ, m4, norm, cross, sub } from './math.js';

const C = (hex, rough, metal) => ({ color: hexToLinear(hex), rough, metal });
const MAT = {
  engine: C('#6b6258', 0.5, 0.7),
  engineHead: C('#8a8377', 0.45, 0.8),
  dark: C('#26241f', 0.7, 0.4),
  gearbox: C('#5f6f7a', 0.5, 0.7),
  shaft: C('#9aa0a2', 0.35, 0.9),
  fuel: C('#8b3a2c', 0.6, 0.3),
  brass: C('#b08a3c', 0.35, 0.9),
  shell: C('#2f3528', 0.6, 0.3),
  shellTip: C('#1c1c1c', 0.5, 0.4),
  breech: C('#4a4d50', 0.4, 0.85),
  breechSteel: C('#8b8f93', 0.32, 0.92),
  breechBlock: C('#a7aaac', 0.28, 0.95),
  cradle: C('#5b5f58', 0.5, 0.75),
  canvas: C('#4b4636', 0.95, 0.0),
  drive: C('#7a6a3c', 0.5, 0.6),
  radio: C('#3d4a3f', 0.6, 0.3),
  knob: C('#c9c4b4', 0.5, 0.2),
  uniform: C('#5a5f4c', 0.9, 0.0),
  uniformDark: C('#3f4336', 0.9, 0.0),
  skin: C('#c79a78', 0.8, 0.0),
  cap: C('#2e2f2a', 0.85, 0.0),
  boot: C('#1e1b17', 0.7, 0.0),
};

export const MODULE_LABEL = {
  machine_gun: '機槍',
  aps_gun: '主動防護機槍',
  aps_radar: '雷達',
  engine: '引擎',
  transmission: '變速箱',
  fuel_tank: '油箱',
  ammo_rack: '彈藥架',
  gun_breech: '炮閂',
  launcher: '發射裝置',
  turret_drive: '炮塔迴轉機',
  vertical_drive: '高低機',
  radio: '無線電',
};
export const CREW_LABEL = { driver: '駕駛', radio_operator: '無線電手', gunner: '炮手', commander: '車長', loader: '裝填手' };
// uniform colours by role, as on the crew-layout blueprint
const ROLE_COLOR = { commander: '#b9584e', gunner: '#4f74ad', loader: '#c9a43c', driver: '#5d8e4c', radio_operator: '#80649f' };

let crewModel = null;
/**
 * The posed crew figures (null: the simple built-in figures). Version 2 (tools/crew-glb.py): the
 * War Thunder crew models, each with its colour map, the commander as the officer; version 1
 * (tools/crew-prep.py): one untextured figure coloured by role.
 */
export function setCrewModel(data) {
  crewModel = null;
  if (!data) return;
  try {
    const bytes = (b64) => Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
    const posesOf = (src) => {
      const poses = {};
      for (const [k, v] of Object.entries(src)) poses[k] = { pos: new Int16Array(bytes(v.pos).buffer), nor: new Int8Array(bytes(v.nor).buffer) };
      return poses;
    };
    if (data.version === 2) {
      const figures = data.figures.map((f) => {
        const img = typeof Image !== 'undefined' ? new Image() : null;
        if (img) img.src = f.texture;
        return { name: f.name, img, tex: null, uv: new Uint16Array(bytes(f.uv).buffer), index: new Uint16Array(bytes(f.index).buffer), poses: posesOf(f.poses) };
      });
      crewModel = { version: 2, figures, roles: data.roles || { default: 0 } };
      return;
    }
    if (!data.poses) return;
    crewModel = { version: 1, parts: data.parts, part: bytes(data.part), index: new Uint16Array(bytes(data.index).buffer), poses: posesOf(data.poses) };
  } catch {
    crewModel = null;
  }
}

/** Which figure a role is drawn with (version 2). */
const figureOf = (role) => crewModel.figures[crewModel.roles[role] ?? crewModel.roles.default ?? 0] || crewModel.figures[0];

/** The figure's colour map as a texture (made once the image has loaded; null until then). */
function figureTexture(renderer, fig) {
  if (!fig.tex && fig.img && fig.img.complete && fig.img.naturalWidth) fig.tex = renderer.texture(fig.img);
  return fig.tex;
}

/** A crewman from the posed figure: textured (version 2) or in the role's colour (version 1). */
function modelCrewGeometry(pose, role) {
  const b = new GeoBuilder();
  if (crewModel.version === 2) {
    const fig = figureOf(role);
    const pz = fig.poses[pose] || fig.poses.seated;
    const white = { color: [1, 1, 1], rough: 0.8, metal: 0 };
    const P = (i) => [pz.pos[i * 3] / 1000, pz.pos[i * 3 + 1] / 1000, pz.pos[i * 3 + 2] / 1000];
    const N = (i) => [pz.nor[i * 3] / 127, pz.nor[i * 3 + 1] / 127, pz.nor[i * 3 + 2] / 127];
    // uv as stored: v down from the top of the image; renderer.texture() flips images on upload
    const U = (i) => [fig.uv[i * 2] / 65535, 1 - fig.uv[i * 2 + 1] / 65535];
    const idx = fig.index;
    for (let t = 0; t < idx.length / 3; t++) {
      const a = idx[t * 3];
      const c = idx[t * 3 + 1];
      const d = idx[t * 3 + 2];
      b.tri(IDENTITY, false, P(a), P(c), P(d), white, [N(a), N(c), N(d)], [U(a), U(c), U(d)]);
    }
    return b.build();
  }
  const pz = crewModel.poses[pose] || crewModel.poses.seated;
  const uniform = role && ROLE_COLOR[role] ? C(ROLE_COLOR[role], 0.85, 0) : MAT.uniform;
  const mats = { uniform, trousers: MAT.uniformDark, boots: MAT.boot, skin: MAT.skin, helmet: MAT.cap, belt: MAT.boot };
  const byPart = crewModel.parts.map((p) => mats[p] || MAT.uniform);
  const P = (i) => [pz.pos[i * 3] / 1000, pz.pos[i * 3 + 1] / 1000, pz.pos[i * 3 + 2] / 1000];
  const N = (i) => [pz.nor[i * 3] / 127, pz.nor[i * 3 + 1] / 127, pz.nor[i * 3 + 2] / 127];
  const idx = crewModel.index;
  for (let t = 0; t < idx.length / 3; t++) {
    const a = idx[t * 3];
    const c = idx[t * 3 + 1];
    const d = idx[t * 3 + 2];
    b.tri(IDENTITY, false, P(a), P(c), P(d), byPart[crewModel.part[t]], [N(a), N(c), N(d)]);
  }
  return b.build();
}

/** Matrix that puts a +Y cylinder of the right length between two points. */
function between(p0, p1) {
  const d = sub(p1, p0);
  const y = norm(d);
  const helper = Math.abs(y[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0];
  const x = norm(cross(helper, y));
  const z = cross(x, y);
  const m = m4();
  m[0] = x[0]; m[1] = x[1]; m[2] = x[2];
  m[4] = y[0]; m[5] = y[1]; m[6] = y[2];
  m[8] = z[0]; m[9] = z[1]; m[10] = z[2];
  m[12] = (p0[0] + p1[0]) / 2; m[13] = (p0[1] + p1[1]) / 2; m[14] = (p0[2] + p1[2]) / 2;
  return { m, len: Math.hypot(d[0], d[1], d[2]) };
}
const limb = (b, p0, p1, r0, r1, mat) => {
  const { m, len } = between(p0, p1);
  b.cylY(m, false, r0, r1, len, 10, mat);
};
function sphere(b, c, r, mat, squash = 1) {
  const rings = 6;
  for (let i = 0; i < rings; i++) {
    const a0 = (i / rings - 0.5) * Math.PI;
    const a1 = ((i + 1) / rings - 0.5) * Math.PI;
    const y0 = Math.sin(a0) * r * squash;
    const y1 = Math.sin(a1) * r * squash;
    b.cylY(translation(c[0], c[1] + (y0 + y1) / 2, c[2]), false, Math.max(Math.cos(a0) * r, 1e-3), Math.max(Math.cos(a1) * r, 1e-3), y1 - y0, 12, mat);
  }
}

/**
 * A crewman about 1.75 m tall, origin at the middle of the chest, facing +Z.
 * pose: 'seated' (hands forward on the controls) or 'standing' (loader, arms half raised).
 */
function crewGeometry(pose) {
  const b = new GeoBuilder();
  const seated = pose !== 'standing';
  // torso and hips
  b.prism(IDENTITY, false, [[-0.1, -0.27], [0.11, -0.27], [0.13, 0.1], [0.09, 0.26], [-0.09, 0.26], [-0.12, 0.05]], 0.3, 0.38, 0, MAT.uniform);
  b.box(translation(0, -0.33, 0), false, [0.33, 0.14, 0.22], MAT.uniformDark);
  // neck, head, cap with headphones
  limb(b, [0, 0.26, 0], [0, 0.33, 0.01], 0.05, 0.045, MAT.skin);
  sphere(b, [0, 0.43, 0.02], 0.1, MAT.skin, 1.12);
  b.cylY(translation(0, 0.5, 0.01), false, 0.108, 0.09, 0.07, 12, MAT.cap);
  for (const sx of [-1, 1]) b.cyl(translation(sx * 0.105, 0.43, 0.02), false, 'x', 0.04, 0.04, 0.03, 8, MAT.cap);
  for (const sx of [-1, 1]) {
    const shoulder = [sx * 0.2, 0.2, 0];
    const elbow = seated ? [sx * 0.23, -0.02, 0.16] : [sx * 0.25, 0.02, 0.2];
    const hand = seated ? [sx * 0.16, 0.0, 0.42] : [sx * 0.14, 0.22, 0.42];
    limb(b, shoulder, elbow, 0.055, 0.047, MAT.uniform);
    limb(b, elbow, hand, 0.045, 0.038, MAT.uniform);
    sphere(b, hand, 0.045, MAT.skin);
    const hip = [sx * 0.1, -0.36, 0];
    const knee = seated ? [sx * 0.12, -0.33, 0.42] : [sx * 0.11, -0.78, 0.04];
    const foot = seated ? [sx * 0.12, -0.74, 0.52] : [sx * 0.11, -1.2, 0];
    limb(b, hip, knee, 0.078, 0.062, MAT.uniformDark);
    limb(b, knee, foot, 0.058, 0.046, MAT.uniformDark);
    b.box(translation(foot[0], foot[1] - 0.03, foot[2] + 0.07), false, [0.09, 0.07, 0.24], MAT.boot);
  }
  return b.build();
}

function moduleGeometry(mod, caliberMm, missileAmmo = false) {
  const b = new GeoBuilder();
  const hx = mod.half_extents.x;
  const hy = mod.half_extents.y;
  const hz = mod.half_extents.z;
  switch (mod.kind) {
    case 'engine': {
      // V engine: crankcase, two cylinder banks, air cleaners, flywheel housing, cooling fan
      b.box(translation(0, -hy * 0.35, 0), false, [hx * 1.1, hy * 1.2, hz * 1.8], MAT.engine);
      for (const sx of [-1, 1]) {
        const m = mul(translation(sx * hx * 0.48, hy * 0.35, 0), rotZ(-sx * 0.52));
        b.box(m, false, [hx * 0.55, hy * 0.9, hz * 1.6], MAT.engineHead);
        for (let i = 0; i < 6; i++) b.cylY(mul(m, translation(0, hy * 0.5, (-0.72 + i * 0.29) * hz)), false, hx * 0.14, hx * 0.14, hy * 0.2, 8, MAT.dark);
        b.cyl(translation(sx * hx * 0.2, hy * 0.82, -hz * 0.2), false, 'z', hx * 0.17, hx * 0.17, hz * 0.9, 10, MAT.dark);
      }
      b.cyl(translation(0, -hy * 0.2, hz * 0.95), false, 'z', hy * 0.75, hy * 0.75, hz * 0.14, 16, MAT.shaft);
      b.cyl(translation(0, hy * 0.1, -hz * 0.98), false, 'z', hy * 0.8, hy * 0.8, hz * 0.08, 16, MAT.dark);
      break;
    }
    case 'transmission': {
      b.box(translation(0, 0, -hz * 0.15), false, [hx * 1.2, hy * 1.5, hz * 1.3], MAT.gearbox);
      b.cyl(translation(0, hy * 0.2, hz * 0.55), false, 'x', hy * 0.8, hy * 0.8, hx * 1.5, 14, MAT.gearbox);
      b.cyl(translation(0, hy * 0.1, hz * 0.55), false, 'x', hy * 0.28, hy * 0.28, hx * 2.0, 10, MAT.shaft);
      b.cyl(translation(0, -hy * 0.1, -hz * 0.9), false, 'z', hy * 0.22, hy * 0.22, hz * 0.4, 10, MAT.shaft);
      b.box(translation(0, hy * 0.85, -hz * 0.2), false, [hx * 0.5, hy * 0.3, hz * 0.6], MAT.dark);
      break;
    }
    case 'fuel_tank': {
      b.box(IDENTITY, false, [hx * 1.9, hy * 1.8, hz * 1.9], MAT.fuel);
      for (const k of [-0.45, 0.45]) b.box(translation(0, 0, k * hz), false, [hx * 1.96, hy * 1.86, hz * 0.08], MAT.dark);
      b.cylY(translation(0, hy * 0.95, -hz * 0.5), false, hx * 0.22, hx * 0.22, hy * 0.16, 10, MAT.shaft);
      break;
    }
    case 'ammo_rack': {
      // rounds lying nose-forward in rows
      const cal = caliberMm / 1000;
      const d = cal * (missileAmmo ? 1.02 : 1.42);
      const len = Math.min(hz * 2, cal * 10.5);
      const cols = Math.max(1, Math.floor((hx * 2) / (d * 1.12)));
      const rows = Math.max(1, Math.floor((hy * 2) / (d * 1.12)));
      const perLine = Math.max(1, Math.floor((hz * 2) / (len * 1.03)));
      for (let k = 0; k < perLine; k++) {
        const z0 = -hz + (k + 0.5) * ((hz * 2) / perLine);
        for (let i = 0; i < cols; i++) {
          for (let j = 0; j < rows; j++) {
            const x = (i - (cols - 1) / 2) * d * 1.12;
            const y = (j - (rows - 1) / 2) * d * 1.12;
            b.cyl(translation(x, y, z0 - len * 0.2), false, 'z', d / 2, d / 2, len * 0.6, 8, missileAmmo ? MAT.shell : MAT.brass);
            b.cyl(translation(x, y, z0 + len * 0.2), false, 'z', cal / 2, cal / 2, len * 0.2, 8, MAT.shell);
            b.cyl(translation(x, y, z0 + len * 0.4), false, 'z', cal / 2, cal * 0.08, len * 0.2, 8, MAT.shellTip);
          }
        }
      }
      // rack frame
      for (const sy of [-1, 1]) b.box(translation(0, sy * hy, 0), false, [hx * 2, 0.012, hz * 2], MAT.dark);
      break;
    }
    case 'aps_gun':
    case 'machine_gun': {
      if (mod.id.endsWith(':barrel')) b.cyl(IDENTITY, false, 'z', Math.min(hx, hy), Math.min(hx, hy), hz * 2, 10, MAT.breechSteel);
      else b.box(IDENTITY, false, [hx * 2, hy * 2, hz * 2], MAT.breech);
      break;
    }
    case 'gun_breech': {
      b.box(translation(0, 0, -hz * 0.35), false, [hx * 1.7, hy * 1.7, hz * 0.9], MAT.breech);
      b.box(translation(hx * 0.2, 0, -hz * 0.35), false, [hx * 1.0, hy * 0.8, hz * 0.5], MAT.dark);
      b.cyl(translation(0, 0, hz * 0.4), false, 'z', hy * 0.62, hy * 0.62, hz * 1.2, 12, MAT.breech);
      b.cyl(translation(-hx * 0.75, hy * 0.75, hz * 0.3), false, 'z', hy * 0.3, hy * 0.3, hz * 1.3, 10, MAT.shaft);
      b.cyl(translation(hx * 0.75, hy * 0.75, hz * 0.3), false, 'z', hy * 0.3, hy * 0.3, hz * 1.3, 10, MAT.shaft);
      // recoil guard behind the breech
      for (const sx of [-1, 1]) b.box(translation(sx * hx * 0.95, -hy * 0.6, -hz * 1.5), false, [0.015, hy * 0.5, hz * 1.4], MAT.dark);
      break;
    }
    case 'turret_drive': {
      b.cylY(IDENTITY, false, hx * 0.8, hx * 0.8, hy * 1.6, 14, MAT.drive);
      b.cyl(translation(hx * 0.6, hy * 0.2, 0), false, 'x', hy * 0.5, hy * 0.5, hx * 1.0, 10, MAT.shaft);
      break;
    }
    case 'vertical_drive': {
      b.box(IDENTITY, false, [hx * 1.4, hy * 1.4, hz * 1.4], MAT.drive);
      b.cyl(translation(-hx * 1.2, 0, -hz * 0.6), false, 'x', hy * 1.1, hy * 1.1, 0.02, 14, MAT.shaft);
      break;
    }
    case 'aps_radar':
    case 'radio': {
      b.box(IDENTITY, false, [hx * 1.9, hy * 1.9, hz * 1.9], MAT.radio);
      for (let i = 0; i < 3; i++) b.cyl(translation((i - 1) * hx * 0.55, hy * 0.2, -hz * 0.98), false, 'z', hy * 0.22, hy * 0.22, 0.03, 8, MAT.knob);
      b.box(translation(0, -hy * 0.45, -hz * 0.98), false, [hx * 1.2, hy * 0.3, 0.012], MAT.dark);
      break;
    }
    default:
      return null;
  }
  return b.build();
}

/** The support/firing apparatus and the projectile in each measured launch tube/rail. */
function launcherGeometry(g) {
  const apparatus = new GeoBuilder();
  const length = g.def.barrel_length_mm / 1000;
  const radius = g.def.caliber_mm / 2000;
  const vectors = g.def.launcher?.muzzle_vectors_m || [g.muzzleVector || [0, 0, g.muzzleOffset]];
  const rounds = vectors.map(v => {
    const z = v[2] - length / 2;
    // Open supports and firing contacts, without a cannon's recoil cylinders or breech block.
    for (const sx of [-1, 1]) apparatus.box(translation(v[0] + sx * radius * 1.08, v[1] - radius * .65, z), false, [.025, .035, length], MAT.cradle);
    for (const f of [-.3, .3]) apparatus.box(translation(v[0], v[1] - radius * 1.03, z + length * f), false, [radius * 2.35, .035, .045], MAT.breechSteel);
    apparatus.box(translation(v[0], v[1] - radius * 1.18, v[2] - length + .08), false, [Math.max(.065, radius * .6), .05, .12], MAT.dark);
    const body = new GeoBuilder();
    body.cyl(translation(v[0], v[1], z - length * .07), false, 'z', radius * .94, radius * .94, length * .80, 12, MAT.shell);
    body.cyl(translation(v[0], v[1], z + length * .4), false, 'z', radius * .94, radius * .08, length * .14, 12, MAT.shellTip);
    body.cyl(translation(v[0], v[1], z - length * .475), false, 'z', radius * .55, radius * .72, length * .03, 10, MAT.dark);
    return body.build();
  });
  return { fixed: apparatus.build(), rounds, centers: vectors.map(v => [v[0], v[1], v[2] - length / 2]) };
}

/**
 * The gun's breech end and cradle, drawn after the gun-system blueprint, in the gun's own frame
 * (origin at the trunnions, +Z along the bore). Sizes follow the calibre with the same rules the
 * design bureau uses for breech clearance.
 *   fixed:  cradle sleeve, trunnion pins, cheeks, recoil cylinders, elevating arc, recoil guard
 *           and, in a closed turret, the spent-case bag (they elevate with the gun but do not
 *           recoil); an open mount throws its cases clear and has neither guard nor bag
 *   moving: breech ring, sliding wedge block, firing mechanism, operating lever (they recoil)
 *   wheel:  the elevating handwheel and its pinion box (bolted to the turret)
 * Returns {fixed, moving, wheel, ringZ}.
 */
export function breechGeometry(caliberMm, recoilMm, open = false) {
  const c = caliberMm / 1000;
  const W = 0.16 + 0.0026 * caliberMm;
  const H = 0.16 + 0.0024 * caliberMm;
  const Lr = 0.25 + 0.0085 * caliberMm;
  const ringL = 0.22 + 0.0025 * caliberMm;
  const recoil = Math.max(0.15, (recoilMm || caliberMm * 4) / 1000);
  const zc = -Lr + ringL / 2;
  const fixed = new GeoBuilder();
  const moving = new GeoBuilder();
  const wheel = new GeoBuilder();

  // ---- cradle: sleeve round the barrel, trunnion pins, side cheeks
  const sleeveR = 1.35 * c + 0.03;
  fixed.cyl(translation(0, 0, 0.16), false, 'z', sleeveR, sleeveR, 0.62, 16, MAT.cradle);
  fixed.cyl(IDENTITY, false, 'x', 0.32 * c + 0.018, 0.32 * c + 0.018, W + 0.28, 12, MAT.breechSteel);
  for (const sx of [-1, 1]) {
    fixed.box(translation(sx * (W / 2 + 0.03), -0.05 * H, 0.04), false, [0.03, H * 0.95, 0.62], MAT.cradle);
    fixed.cyl(translation(sx * (W / 2 + 0.16), 0, 0), false, 'x', 0.5 * c + 0.03, 0.5 * c + 0.03, 0.05, 12, MAT.cradle);
  }
  // recoil buffer and recuperator: two cylinders over the barrel, one under it
  const rr = 0.36 * c + 0.012;
  for (const sx of [-1, 1]) {
    fixed.cyl(translation(sx * (sleeveR * 0.62), sleeveR + rr * 0.6, 0.15), false, 'z', rr, rr, 0.95, 12, MAT.breechSteel);
    fixed.cyl(translation(sx * (sleeveR * 0.62), sleeveR + rr * 0.6, -0.34), false, 'z', rr * 0.55, rr * 0.55, 0.08, 10, MAT.dark);
  }
  fixed.cyl(translation(0, -(sleeveR + rr * 0.7), 0.1), false, 'z', rr * 1.15, rr * 1.15, 0.85, 12, MAT.breechSteel);
  // elevating arc: a toothed sector under the cradle on the gunner's (left) side
  const ra = H * 0.5 + 0.2;
  for (let i = 0; i <= 9; i++) {
    const a = -Math.PI / 2 - 0.55 + (i / 9) * 0.9;
    const y = Math.sin(a) * ra;
    const z = -Math.cos(a) * ra * 0.9 - 0.05;
    fixed.box(mul(translation(-(W / 2 + 0.05), y, z), m4rotX(a)), false, [0.035, 0.03, 0.06], MAT.breechSteel);
  }
  fixed.box(translation(-(W / 2 + 0.05), -ra * 0.55, -0.05), false, [0.02, ra * 0.9, 0.05], MAT.cradle);
  // recoil guard: two side plates behind the breech with rails, and the spent-case bag
  const gz0 = -Lr - 0.04;
  const gl = recoil + 0.32;
  for (const sx of open ? [] : [-1, 1]) {
    fixed.box(translation(sx * (W / 2 + 0.1), -H * 0.15, gz0 - gl / 2), false, [0.012, H * 0.95, gl], MAT.cradle);
    limb(fixed, [sx * (W / 2 + 0.1), H * 0.36, gz0 + 0.1], [sx * (W / 2 + 0.1), H * 0.36, gz0 - gl], 0.014, 0.014, MAT.breechSteel);
  }
  if (!open) {
    limb(fixed, [-(W / 2 + 0.1), -H * 0.6, gz0 - gl], [W / 2 + 0.1, -H * 0.6, gz0 - gl], 0.016, 0.016, MAT.breechSteel);
    limb(fixed, [-(W / 2 + 0.1), H * 0.36, gz0 - gl], [W / 2 + 0.1, H * 0.36, gz0 - gl], 0.014, 0.014, MAT.breechSteel);
    fixed.box(translation(0, -H * 0.62 - 0.17, gz0 - gl * 0.55), false, [W + 0.14, 0.34, gl * 0.7], MAT.canvas);
  }
  // loading tray under the opening
  fixed.box(translation(0, -H * 0.3, gz0 - 0.12), false, [W * 0.55, 0.012, 0.22], MAT.breechSteel);

  // ---- breech ring and block (recoil with the barrel)
  moving.cyl(translation(0, 0, (zc + ringL / 2) / 2), false, 'z', 1.05 * c + 0.012, 1.05 * c + 0.012, -(zc + ringL / 2) + 0.02, 14, MAT.breechSteel);
  moving.box(translation(0, 0, zc), false, [W, H, ringL], MAT.breechSteel);
  // chamfered rear edges
  for (const sy of [-1, 1]) moving.box(translation(0, sy * H * 0.47, zc - ringL * 0.42), false, [W * 0.9, H * 0.08, ringL * 0.18], MAT.breech);
  // sliding wedge block, standing out on the right where it opens
  moving.box(translation(W * 0.14, -H * 0.04, zc - ringL * 0.12), false, [W * 1.18, H * 0.6, ringL * 0.42], MAT.breechBlock);
  moving.cyl(translation(0, 0, -Lr - 0.004), false, 'z', 0.62 * c, 0.62 * c, 0.012, 16, MAT.dark);
  // firing mechanism housing and the striker (firing pin) cap on the block
  moving.box(translation(W * 0.18, -H * 0.24, -Lr - 0.025), false, [W * 0.32, H * 0.22, 0.05], MAT.breech);
  moving.cyl(translation(W * 0.05, -H * 0.04, -Lr - 0.03), false, 'z', 0.18 * c + 0.008, 0.14 * c + 0.006, 0.05, 10, MAT.breechSteel);
  // operating lever (閉鎖機構) on the right: pivot, crank arm and handle
  const piv = [W / 2 + 0.035, H * 0.12, zc + ringL * 0.1];
  moving.cyl(translation(piv[0], piv[1], piv[2]), false, 'x', 0.035, 0.035, 0.05, 10, MAT.breech);
  const knob = [W / 2 + 0.07, -H * 0.42, zc - ringL * 0.75];
  limb(moving, piv, knob, 0.016, 0.014, MAT.breechSteel);
  sphere(moving, knob, 0.026, MAT.dark);
  // the obturating ring stamped round the chamber
  moving.cyl(translation(0, 0, -Lr + 0.01), false, 'z', 0.85 * c, 0.85 * c, 0.01, 16, MAT.breech);

  // ---- elevating handwheel and pinion box (turret-fixed), left of the cradle
  const hw = [-(W / 2 + 0.24), -H * 0.55 - 0.12, -0.38];
  const R = 0.11;
  for (let i = 0; i < 14; i++) {
    const a0 = (i / 14) * Math.PI * 2;
    const a1 = ((i + 1) / 14) * Math.PI * 2;
    limb(wheel, [hw[0], hw[1] + Math.sin(a0) * R, hw[2] + Math.cos(a0) * R], [hw[0], hw[1] + Math.sin(a1) * R, hw[2] + Math.cos(a1) * R], 0.011, 0.011, MAT.dark);
  }
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    limb(wheel, hw, [hw[0], hw[1] + Math.sin(a) * R, hw[2] + Math.cos(a) * R], 0.007, 0.007, MAT.breechSteel);
  }
  limb(wheel, [hw[0], hw[1] + R, hw[2]], [hw[0] - 0.07, hw[1] + R, hw[2]], 0.012, 0.012, MAT.dark);
  wheel.cyl(translation(hw[0] + 0.06, hw[1], hw[2]), false, 'x', 0.02, 0.02, 0.1, 8, MAT.breechSteel);
  wheel.box(translation(hw[0] + 0.14, hw[1] + 0.03, hw[2] + 0.12), false, [0.07, 0.14, 0.2], MAT.drive);

  return { fixed: fixed.build(), moving: moving.build(), wheel: wheel.build(), ringZ: zc };
}

const m4rotX = (a) => {
  const m = m4();
  const c = Math.cos(a);
  const s = Math.sin(a);
  m[5] = c; m[6] = s; m[9] = -s; m[10] = c;
  return m;
};

/**
 * Builds interior nodes and hangs them on the model (hidden until the interior view is on).
 * Returns {nodes: [...], labels: [{node, text, local}]}.
 */
export function buildInterior(renderer, model, loadout, modules, crew, mounts = null) {
  const meshes = [];
  const nodes = [];
  const labels = [];
  const attached = [];
  const attach = (parent, node) => { attached.push([parent, node]); return parent.add(node); };
  // which nodes show which module and crew member (the hit camera lights them up)
  const byModule = new Map();
  const byCrew = [];
  const launcherRounds = [];
  const tagModule = (id, n) => {
    if (!byModule.has(id)) byModule.set(id, []);
    byModule.get(id).push(n);
  };
  const turret0 = loadout.turrets[0];
  const caliber = turret0 ? turret0.guns[0].def.caliber_mm : 75;
  const guns = loadout.turrets.flatMap(t => t.guns);
  const distance = (m, g) => (m.center.x - g.trunnion[0]) ** 2 + (m.center.y - g.trunnion[1]) ** 2 + (m.center.z - g.trunnion[2]) ** 2;
  const moduleGun = (m, candidates = guns) => candidates.reduce((best, g) => !best || distance(m, g) < distance(m, best) ? g : best, null);
  /** Parts inside a turret's box ride with that turret. */
  const turretOf = (p) => {
    let best = -1;
    loadout.turrets.forEach((t, ti) => {
      const dx = p[0] - t.pivot[0];
      const dz = p[2] - t.pivot[2];
      if (p[1] > t.pivot[1] - 0.12 && Math.hypot(dx, dz) < Math.max(t.size[0], t.size[2]) * 0.55) best = ti;
    });
    return best;
  };
  const place = (pos, mesh, label, rotate, crewTag, turretIndex = undefined) => {
    const ti = turretIndex === undefined ? rotate ? turretOf(pos) : -1 : turretIndex;
    const parent = ti >= 0 ? model.turrets[ti].node : model.body;
    const origin = ti >= 0 ? loadout.turrets[ti].pivot : [0, 0, 0];
    const n = attach(parent, new Node('interior'));
    n.pos = [pos[0] - origin[0], pos[1] - origin[1], pos[2] - origin[2]];
    n.mesh = mesh;
    n.kind = 3;
    // an open-topped turret shows its crew all the time, not only in the interior view
    n.always = !!crewTag && ti >= 0 && !!loadout.turrets[ti].openTop;
    n.visible = n.always;
    n.castShadow = false;
    nodes.push(n);
    labels.push({ node: n, text: label, crew: !!crewTag });
    return n;
  };
  // every gun's breech end and cradle, on the gun itself so it elevates and recoils with it
  const drawnModules = new Set();
  loadout.turrets.forEach((t, ti) => {
    const mt = model.turrets[ti];
    if (!mt) return;
    t.guns.forEach((g, gi) => {
      const mg = mt.guns[gi];
      if (!mg || (!g.def.missile && g.def.caliber_mm < 20)) return;
      const add = (parent, data, label, pos = [0, 0, 0]) => {
        const mesh = renderer.mesh(data);
        meshes.push(mesh);
        const n = attach(parent, new Node('interior'));
        n.pos = pos;
        n.mesh = mesh;
        n.kind = 3;
        // in an open mount the breech shows all the time -- unless the model has its own (an
        // imported one, or a gun built in full in visual.json: own_breech)
        const sourceGun = loadout.imported?.parts.some(p => (p.mount === 'gun' || p.mount === 'barrel') && (p.turret || 0) === ti && (p.gun || 0) === gi);
        n.always = !!t.openTop && !sourceGun && !(loadout.visual?.own_breech && !t.generated);
        n.visible = n.always;
        n.castShadow = false;
        nodes.push(n);
        if (label) labels.push({ node: n, text: label, crew: false });
        return n;
      };
      if (g.def.missile) {
        const geo = launcherGeometry(g);
        const apparatus = add(mg.node, geo.fixed, MODULE_LABEL.launcher);
        // Launcher damage stays attached to its own mount in mixed cannon/rocket vehicles.
        for (const m of modules) if (m.kind === 'launcher' && moduleGun(m, guns.filter(g => g.def.missile)) === g) {
          tagModule(m.id, apparatus);
          drawnModules.add(m.id);
        }
        geo.rounds.forEach((data, tube) => {
          const body = add(mg.node, data, g.def.guided ? '飛彈彈體' : '火箭彈體');
          body.always = false;
          body.visible = false;
          body.launcherRound = { gun: g, tube, apparatus };
          launcherRounds.push(body);
          const tag = attach(body, new Node('interior_tag'));
          tag.pos = geo.centers[tube];
          tag.visible = false;
          labels[labels.length - 1].node = tag;
          labels[labels.length - 1].anchor = body;
        });
        return;
      }
      const geo = breechGeometry(g.def.caliber_mm, g.def.recoil_mm, !!t.openTop);
      const fixedNode = add(mg.node, geo.fixed, null);
      // the label rides on the breech ring
      const ring = add(mg.barrel, geo.moving, null);
      for (const m of modules) if (m.kind === 'gun_breech' && moduleGun(m, guns.filter(g => !g.def.missile)) === g) {
        [fixedNode, ring].forEach(n => tagModule(m.id, n));
        drawnModules.add(m.id);
      }
      const tag = attach(mg.barrel, new Node('interior_tag'));
      tag.pos = [0, 0, geo.ringZ];
      tag.visible = false;
      labels.push({ node: tag, text: MODULE_LABEL.gun_breech, crew: false, anchor: ring });
      const tr = [g.trunnion[0] - t.pivot[0], g.trunnion[1] - t.pivot[1], g.trunnion[2] - t.pivot[2]];
      add(mt.node, geo.wheel, null, tr);
    });
  });
  for (const m of modules) {
    // the breech is drawn on the gun (above); its damage box stays in modules.json
    if (drawnModules.has(m.id)) continue;
    const exposedLauncher = m.kind === 'ammo_rack' ? moduleGun(m, guns.filter(g => g.def.missile && m.center.y >= g.trunnion[1] - .3 && distance(m, g) < 1.5 && m.half_extents.x >= g.def.caliber_mm / 2000 * .8)) : null;
    const rackGun = exposedLauncher || (m.kind === 'ammo_rack' ? moduleGun(m) : null);
    // A loaded rocket on an exposed rail is already drawn on its elevating mount above.
    if (exposedLauncher) {
      for (const n of launcherRounds) if (n.launcherRound.gun === rackGun) tagModule(m.id, n);
      continue;
    }
    const data = moduleGeometry(m, rackGun?.def.caliber_mm || caliber, !!rackGun?.def.missile);
    if (!data) continue;
    const mesh = renderer.mesh(data);
    meshes.push(mesh);
    // designer vehicles say which parts ride with the turret; for the others it is guessed
    const inTurret = mounts ? mounts.modules.includes(m.id) : m.kind === 'gun_breech' || m.kind === 'vertical_drive' || m.kind === 'turret_drive' || m.kind === 'ammo_rack';
    const apsPart = m.id === loadout.weapons.aps?.gun_module || m.id === loadout.weapons.aps?.radar_module;
    const ti = apsPart ? loadout.weapons.aps.turret ?? 1 : m.kind === 'machine_gun' ? m.turret_index ?? -1 : m.turret_index;
    const weapon = apsPart ? loadout.weapons.aps.name : m.kind === 'machine_gun' ? loadout.machineGuns.find(g => g.damageKey === m.weapon_group)?.def.name : null;
    const label = (weapon ? weapon + ' ' : '') + (MODULE_LABEL[m.kind] || m.kind) + (m.kind === 'machine_gun' ? m.id.endsWith(':barrel') ? '槍管' : '機匣' : '');
    tagModule(m.id, place([m.center.x, m.center.y, m.center.z], mesh, label, inTurret, false, ti));
  }
  // one mesh per pose and figure (or role), made on first use
  const figures = new Map();
  const figure = (pose, role) => {
    const key = crewModel ? pose + ':' + (crewModel.version === 2 ? figureOf(role).name : role) : pose;
    if (!figures.has(key)) {
      const mesh = renderer.mesh(crewModel ? modelCrewGeometry(pose, role) : crewGeometry(pose));
      meshes.push(mesh);
      figures.set(key, mesh);
    }
    return figures.get(key);
  };
  crew.forEach((c, ci) => {
    const hullCrew = mounts ? !mounts.crew[ci] : c.role === 'driver' || c.role === 'radio_operator';
    byCrew[ci] = place([c.pos.x, c.pos.y, c.pos.z], figure(c.pose || (c.role === 'loader' ? 'standing' : 'seated'), c.role), CREW_LABEL[c.role] || c.role, !hullCrew, true);
    // the War Thunder figures carry their own colour map
    if (crewModel && crewModel.version === 2) {
      const fig = figureOf(c.role);
      const node = byCrew[ci];
      const tex = figureTexture(renderer, fig);
      if (tex) node.texture = tex;
      else if (fig.img) fig.img.addEventListener('load', () => (node.texture = figureTexture(renderer, fig)), { once: true });
    }
  });
  return {
    nodes,
    labels,
    byModule,
    byCrew,
    updateLaunchers() {
      for (const n of launcherRounds) {
        const { gun, tube, apparatus } = n.launcherRound;
        const next = gun.launcher?.nextTube || 0;
        const ready = gun.launcher?.ready || 0;
        n.visible = !!apparatus.visible && gun.loaded >= 0 && (gun.ammo[gun.loaded]?.count || 0) > 0 && tube >= next && tube < next + ready;
      }
    },
    dispose() {
      for (const [parent, node] of attached) parent.children = parent.children.filter(n => n !== node);
      for (const m of meshes) renderer.freeMesh(m);
    },
  };
}

