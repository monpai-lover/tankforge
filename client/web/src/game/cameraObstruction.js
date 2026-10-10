import { TREE_ROOT_OFFSET, TREE_FALL_SECONDS, treeFallAngle, FIR_TRUNK, FIR_TIERS, FIR_TIP_RADIUS, BROADLEAF_TRUNK, BROADLEAF_CROWNS } from './treeShapes.js';

// First t in [lo, hi] for which A*t*t + B*t + C <= 0, or 1 if clear.
function quadraticEntry(A, B, C, lo = 0, hi = 1) {
  if ((A * lo + B) * lo + C <= 0) return lo;
  if (Math.abs(A) < 1e-10) {
    const t = -C / B;
    return B < 0 && t >= lo && t <= hi ? t : 1;
  }
  const disc = B * B - 4 * A * C;
  if (disc < 0) return 1;
  const root = Math.sqrt(disc);
  const r0 = (-B - root) / (2 * A), r1 = (-B + root) / (2 * A);
  const first = Math.min(r0, r1), last = Math.max(r0, r1);
  const t = A > 0 ? Math.max(lo, first) : last;
  return t >= lo && t <= hi && (A < 0 || t <= last) ? t : 1;
}

function boxEntry(o, d, lo, hi) {
  let enter = 0, exit = 1;
  for (let k = 0; k < 3; k++) {
    if (Math.abs(d[k]) < 1e-10) {
      if (o[k] < lo[k] || o[k] > hi[k]) return 1;
    } else {
      const a = (lo[k] - o[k]) / d[k], b = (hi[k] - o[k]) / d[k];
      enter = Math.max(enter, Math.min(a, b));
      exit = Math.min(exit, Math.max(a, b));
      if (enter > exit) return 1;
    }
  }
  return enter;
}

function frustumEntry(o, d, bottom, r0, r1, height, pad) {
  let lo = 0, hi = 1;
  const ymin = bottom - pad, ymax = bottom + height + pad;
  if (Math.abs(d[1]) < 1e-10) {
    if (o[1] < ymin || o[1] > ymax) return 1;
  } else {
    const a = (ymin - o[1]) / d[1], b = (ymax - o[1]) / d[1];
    lo = Math.max(lo, Math.min(a, b));
    hi = Math.min(hi, Math.max(a, b));
    if (lo > hi) return 1;
  }
  const slope = (r1 - r0) / height;
  const r = r0 + slope * (o[1] - bottom) + pad * Math.hypot(1, slope);
  const dr = slope * d[1];
  return quadraticEntry(d[0] ** 2 + d[2] ** 2 - dr ** 2,
    2 * (o[0] * d[0] + o[2] * d[2] - r * dr), o[0] ** 2 + o[2] ** 2 - r ** 2, lo, hi);
}

function sphereEntry(o, d, center, radius) {
  const x = o[0] - center[0], y = o[1] - center[1], z = o[2] - center[2];
  return quadraticEntry(d[0] ** 2 + d[1] ** 2 + d[2] ** 2,
    2 * (x * d[0] + y * d[1] + z * d[2]), x ** 2 + y ** 2 + z ** 2 - radius ** 2);
}

// Inverse of the exact rotation used by mapworld's falling tree instances.
function treeLocal(out, x, y, z, c, s, ca, sa, cr, sr, scale) {
  const rx = c * x - s * z, rz = s * x + c * z;
  const ry = ca * y + sa * rz, fz = -sa * y + ca * rz;
  out[0] = (cr * rx - sr * fz) / scale;
  out[1] = ry / scale;
  out[2] = (sr * rx + cr * fz) / scale;
}

// Combat intentionally leaves roof ridges open to shells. Include the full visible
// building envelope for the camera, without modifying BattleMap's collision boxes.
function visualBox(map, b, index) {
  const object = map.objects?.[b.obj];
  if (!object) return b;
  const box = { ...b };
  if (object.kind === 'house' || (object.kind === 'church' && index === object.boxes[0])) {
    const depth = object.kind === 'church' ? object.w : object.d;
    const roof = depth * (object.kind === 'house' && object.roof === 2 ? 0.6 : 0.42);
    box.hx += 0.35; box.hz += 0.35;
    box.y0 = Math.min(box.y0, object.y - 0.9);
    box.y1 = Math.max(box.y1, object.y + object.h + roof * 1.1 + 0.5);
  } else if (object.kind === 'church') {
    box.hx = Math.max(box.hx, 3.7); box.hz = Math.max(box.hz, 3.7);
    box.y1 = Math.max(box.y1, object.y + 33.4);
  } else if (object.kind === 'bunker') {
    box.hx += 0.4; box.hz += 1.8;
    box.y1 = Math.max(box.y1, object.y + object.h + 0.45);
  }
  return box;
}

/** Visual-only camera sweep. Never modifies map combat collision or vehicle physics. */
export class CameraObstruction {
  constructor(surfaceAt) {
    this.surfaceAt = surfaceAt;
    this.anchor = [0, 0, 0];
    this.delta = [0, 0, 0];
    this.localOrigin = [0, 0, 0];
    this.localDelta = [0, 0, 0];
    this.lo = [0, 0, 0];
    this.hi = [0, 0, 0];
    this.candidates = [];
    this.map = null;
    this.visualBoxes = [];
    this.reset();
  }

  reset() {
    this.fraction = 1;
    this.hideBody = false;
  }

  update(map, body, vehicle, modelHeight, eye, dt = 1 / 60, radius = 0.45) {
    this.hideBody = false;
    if (!body || !eye.every(Number.isFinite)) { this.reset(); return; }
    radius = Number.isFinite(radius) ? Math.max(0.45, radius) : 0.45;
    dt = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    const size = vehicle.hull.size_m;
    const anchor = this.anchor, d = this.delta, o = this.localOrigin, ld = this.localDelta;
    // The old high orbit pivot can already be inside a canopy. Sweep from the hull centre.
    for (let k = 0; k < 3; k++) anchor[k] = body.pos[k] - body.ex[k] * body.com[0] + body.ey[k] * (size[1] / 2 - body.com[1]) - body.ez[k] * body.com[2];
    anchor[1] = Math.max(anchor[1], this.surfaceAt(anchor[0], anchor[2]) + radius);
    for (let k = 0; k < 3; k++) d[k] = eye[k] - anchor[k];
    const length = Math.hypot(...d);
    if (length < 1e-8) { this.reset(); return; }
    let limit = 1;
    const mx = anchor[0] + d[0] / 2, mz = anchor[2] + d[2] / 2;
    const reach = Math.hypot(d[0], d[2]) / 2;
    if (map) {
      if (this.map !== map) {
        this.map = map;
        this.visualBoxes = map.boxes.map((b, i) => visualBox(map, b, i));
      }
      // Up to 1.8 m of bunker wing wall extends outside the combat footprint.
      for (const i of map.boxesNear(mx, mz, reach + radius + 2, this.candidates)) {
        const b = this.visualBoxes[i], x = anchor[0] - b.x, z = anchor[2] - b.z;
        o[0] = x * b.c - z * b.s; o[1] = anchor[1]; o[2] = x * b.s + z * b.c;
        ld[0] = d[0] * b.c - d[2] * b.s; ld[1] = d[1]; ld[2] = d[0] * b.s + d[2] * b.c;
        this.lo[0] = -b.hx - radius; this.lo[1] = b.y0 - radius; this.lo[2] = -b.hz - radius;
        this.hi[0] = b.hx + radius; this.hi[1] = b.y1 + radius; this.hi[2] = b.hz + radius;
        limit = Math.min(limit, boxEntry(o, ld, this.lo, this.hi));
      }
      // A fallen scaled fir reaches almost 19 m away from its bucketed root.
      for (const i of map.treesNear(mx, mz, reach + 20 + radius, this.candidates)) {
        const t = map.trees[i];
        if (!(t.s > 0)) continue;
        const dir = t.fall > 0 ? t.fallDir : t.rot;
        // mapworld advances the falling pose later in this same frame, before rendering.
        const fall = t.fall > 0 ? Math.min(1, t.fall + dt / TREE_FALL_SECONDS) : 0;
        const a = treeFallAngle(fall), c = Math.cos(dir), s = Math.sin(dir);
        const ca = Math.cos(a), sa = Math.sin(a), cr = Math.cos(t.rot - dir), sr = Math.sin(t.rot - dir);
        treeLocal(o, anchor[0] - t.x, anchor[1] - t.y - TREE_ROOT_OFFSET, anchor[2] - t.z, c, s, ca, sa, cr, sr, t.s);
        treeLocal(ld, d[0], d[1], d[2], c, s, ca, sa, cr, sr, t.s);
        const pad = radius / t.s;
        const trunk = t.kind === 0 ? FIR_TRUNK : BROADLEAF_TRUNK;
        limit = Math.min(limit, frustumEntry(o, ld, 0, trunk[0], trunk[1], trunk[2], pad));
        if (t.kind === 0) {
          for (const tier of FIR_TIERS) limit = Math.min(limit, frustumEntry(o, ld, tier[0], tier[1], FIR_TIP_RADIUS, tier[2], pad));
        } else {
          // These spheres contain the squashed faceted blobs, including their edges.
          for (const crown of BROADLEAF_CROWNS) limit = Math.min(limit, sphereEntry(o, ld, crown.center, crown.radius + pad));
        }
      }
    }
    const steps = Math.min(128, Math.max(1, Math.ceil(length / 0.5)));
    for (let n = 1; n <= steps; n++) {
      const t = Math.min(n / steps, limit);
      if (anchor[1] + d[1] * t < this.surfaceAt(anchor[0] + d[0] * t, anchor[2] + d[2] * t) + radius) {
        let lo = (n - 1) / steps, hi = t;
        for (let j = 0; j < 12; j++) {
          const mid = (lo + hi) / 2;
          if (anchor[1] + d[1] * mid < this.surfaceAt(anchor[0] + d[0] * mid, anchor[2] + d[2] * mid) + radius) hi = mid;
          else lo = mid;
        }
        limit = lo; break;
      }
      if (t === limit) break;
    }
    if (limit < 1) limit = Math.max(0, limit - 0.01 / length);
    // New obstacles take effect immediately. Only returning to the desired eye is damped.
    this.fraction = limit < this.fraction ? limit : this.fraction + (limit - this.fraction) * (1 - Math.exp(-8 * dt));
    if (limit === 1 && this.fraction > 0.9999) this.fraction = 1;
    for (let k = 0; k < 3; k++) eye[k] = anchor[k] + d[k] * this.fraction;
    const x = eye[0] - body.pos[0], y = eye[1] - body.pos[1], z = eye[2] - body.pos[2];
    const lx = body.com[0] + x * body.ex[0] + y * body.ex[1] + z * body.ex[2];
    const ly = body.com[1] + x * body.ey[0] + y * body.ey[1] + z * body.ey[2];
    const lz = body.com[2] + x * body.ez[0] + y * body.ez[1] + z * body.ez[2];
    this.hideBody = this.fraction < 1 && Math.abs(lx) < size[0] / 2 + radius && Math.abs(lz) < size[2] / 2 + radius && ly < Math.max(size[1], modelHeight) + radius && ly > -radius;
  }
}
