// Roof machine guns on their pintles, built from their real proportions (measured off reference
// models of the guns): the swivel at the origin, the gun pointing +z. Each returns the geometry
// and the muzzle's distance ahead of the swivel.
import { GeoBuilder } from './geo.js';
import { translation, mul, rotZ, m4 } from './math.js';

const IDENTITY = m4();

const T = translation;

/** The guns reduced from reference models (tools/mg_asset.py): id -> {muzzle, pos, col, palette}. */
let MODELS = null;
export function setMgModels(m) {
  MODELS = m || null;
}

function fromAsset(a, mats) {
  const b = new GeoBuilder();
  const pal = a.palette.map((c) => ({ ...mats.black, color: c.map((v) => Math.pow(v, 2.2)), rough: 0.55, metal: 0.45 }));
  const p = a.pos;
  for (let t = 0; t < a.triangles; t++) {
    const o = t * 9;
    const v = (k) => [p[o + k * 3] / 1000, p[o + k * 3 + 1] / 1000, p[o + k * 3 + 2] / 1000];
    b.tri(IDENTITY, false, v(0), v(1), v(2), pal[a.col[t]]);
  }
  return b;
}

/** DShK 1938: receiver with the spade grips, the 50-round box on the left, the finned barrel,
 *  the gas tube under it, the ball muzzle brake, the ring anti-aircraft sight and the cradle. */
function dshk(b, m) {
  b.box(T(0, 0.215, -0.30), false, [0.13, 0.17, 0.66], m.black); // receiver
  b.box(T(0, 0.31, -0.40), false, [0.10, 0.03, 0.30], m.black); // feed cover
  b.cyl(T(0, 0.29, -0.15), false, 'x', 0.05, 0.05, 0.11, 12, m.black); // feed drum
  b.box(T(0, 0.20, -0.66), false, [0.16, 0.10, 0.03], m.steel); // back plate
  for (const sx of [-1, 1]) b.cyl(T(sx * 0.06, 0.20, -0.70), false, 'y', 0.018, 0.018, 0.12, 8, m.steel); // spade grips
  b.box(T(-0.15, 0.18, -0.36), false, [0.12, 0.22, 0.30], m.paint_dark); // ammunition box
  b.cyl(T(0, 0.19, 0.25), false, 'z', 0.034, 0.034, 0.38, 12, m.black); // barrel under its fins
  for (let i = 0; i < 9; i++) b.cyl(T(0, 0.19, 0.08 + i * 0.042), false, 'z', 0.046, 0.046, 0.012, 12, m.black); // cooling fins
  b.cyl(T(0, 0.19, 0.64), false, 'z', 0.022, 0.021, 0.42, 10, m.black); // barrel
  b.cyl(T(0, 0.14, 0.28), false, 'z', 0.014, 0.014, 0.46, 8, m.black); // gas tube
  b.cyl(T(0, 0.19, 0.89), false, 'z', 0.026, 0.042, 0.06, 12, m.black); // muzzle brake
  b.cyl(T(0, 0.19, 0.93), false, 'z', 0.042, 0.03, 0.04, 12, m.black);
  b.box(T(0, 0.27, 0.66), false, [0.012, 0.10, 0.02], m.black); // front sight post
  b.box(T(0, 0.22, 0.66), false, [0.06, 0.03, 0.03], m.black);
  // the ring sight: a hoop on a post
  b.box(T(0, 0.36, 0.28), false, [0.012, 0.12, 0.012], m.steel);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    b.box(mul(T(Math.cos(a) * 0.11, 0.53 + Math.sin(a) * 0.11, 0.28), rotZ(a)), false, [0.008, 0.045, 0.008], m.steel);
  }
  b.box(T(0, 0.06, -0.02), false, [0.09, 0.12, 0.26], m.paint_dark); // cradle
  return 0.95;
}

/** M2HB: the long receiver with the feed cover and spade grips, the trunnion block, the ammunition
 *  can on the left, the perforated barrel support, the heavy barrel and its carrying handle. */
function m2hb(b, m) {
  b.box(T(0, 0.17, -0.21), false, [0.13, 0.14, 0.62], m.black); // receiver
  b.box(T(0, 0.25, -0.16), false, [0.11, 0.025, 0.32], m.black); // feed cover
  b.box(T(0, 0.12, 0.0), false, [0.12, 0.20, 0.18], m.black); // trunnion block
  b.box(T(0, 0.17, -0.53), false, [0.15, 0.10, 0.03], m.steel); // back plate
  for (const sx of [-1, 1]) b.cyl(T(sx * 0.05, 0.17, -0.57), false, 'y', 0.015, 0.015, 0.10, 8, m.steel); // spade grips
  b.box(T(0, 0.17, -0.57), false, [0.04, 0.02, 0.02], m.steel); // butterfly trigger
  b.box(T(-0.12, 0.13, 0.0), false, [0.10, 0.20, 0.28], m.paint_dark); // ammunition can
  b.cyl(T(0, 0.18, 0.23), false, 'z', 0.034, 0.034, 0.26, 12, m.black); // barrel support
  for (let i = 0; i < 4; i++) b.cyl(T(0, 0.18, 0.14 + i * 0.06), false, 'z', 0.036, 0.036, 0.015, 12, m.black);
  b.cyl(T(0, 0.18, 0.71), false, 'z', 0.020, 0.019, 0.70, 10, m.black); // barrel
  b.cyl(T(0, 0.18, 1.065), false, 'z', 0.024, 0.024, 0.05, 10, m.black); // muzzle
  b.box(T(0.035, 0.12, 0.43), false, [0.01, 0.06, 0.18], m.steel); // carrying handle
  b.box(T(0, 0.255, 0.02), false, [0.01, 0.05, 0.02], m.black); // rear sight
  b.box(T(0, 0.04, 0.0), false, [0.08, 0.08, 0.20], m.paint_dark); // cradle
  return 1.09;
}

/** Any other gun: receiver, barrel jacket, barrel, ammunition box, grips (scaled for heavy guns). */
function generic(b, m, heavy) {
  const k = heavy ? 1 : 0.72;
  b.box(T(0, 0.05, -0.05 * k), false, [0.09 * k, 0.12 * k, 0.5 * k], m.black);
  b.cyl(T(0, 0.06, 0.52 * k), false, 'z', 0.03 * k, 0.026 * k, 0.66 * k, 10, m.black);
  b.cyl(T(0, 0.06, 1.0 * k), false, 'z', 0.018 * k, 0.018 * k, 0.34 * k, 8, m.steel);
  b.box(T(-0.13 * k, 0.0, 0.02), false, [0.17 * k, 0.16 * k, 0.26 * k], m.paint_dark);
  for (const sx of [-1, 1]) b.cyl(T(sx * 0.035 * k, 0.05, -0.36 * k), false, 'z', 0.014, 0.014, 0.14 * k, 6, m.steel);
  b.box(T(0, -0.03, 0), false, [0.05, 0.08, 0.14], m.steel);
  return 1.17 * k;
}

/** The pintle gun for this weapon id: { geo: GeoBuilder, muzzle: m ahead of the swivel }. */
export function pintleGun(weapon, caliber, mats) {
  if (MODELS && MODELS[weapon]) return { geo: fromAsset(MODELS[weapon], mats), muzzle: MODELS[weapon].muzzle };
  const b = new GeoBuilder();
  let muzzle;
  if (weapon === 'dshk') muzzle = dshk(b, mats);
  else if (weapon === 'm2hb') muzzle = m2hb(b, mats);
  else muzzle = generic(b, mats, caliber > 10);
  return { geo: b, muzzle };
}

