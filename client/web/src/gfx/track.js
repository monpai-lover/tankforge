// Track as a chain of separate links running round the sprocket, idler, road wheels and return
// rollers. The loop is rebuilt every frame from where the wheels are (they move with the
// suspension), the upper run hangs between its supports, and the links are placed pin to pin
// along it, so they hinge round the sprocket and idler the way a real track does.
import { GeoBuilder, IDENTITY, STRIDE } from './geo.js';
import { translation, mul, rotX, scaling } from './math.js';

const TAU = Math.PI * 2;

/** Road-wheel stations (one per axle), front first. Interleaved wheels on one axle count once. */
export function stationsOf(rg) {
  const byZ = new Map();
  for (const w of rg.wheels) {
    const key = w.z.toFixed(3);
    if (!byZ.has(key)) byZ.set(key, { z: w.z, y: w.y, r: w.r });
  }
  return [...byZ.values()].sort((a, b) => b.z - a.z);
}

/** Direction (angle in the z-y plane) of the belt running from circle a to circle b, both on its left. */
function tangentAngle(a, b) {
  const dz = b.z - a.z;
  const dy = b.y - a.y;
  const len = Math.hypot(dz, dy) || 1e-6;
  return Math.atan2(dy, dz) + Math.asin(Math.max(-1, Math.min(1, (a.r - b.r) / len)));
}

const onCircle = (c, travelAngle) => [c.z + c.r * Math.sin(travelAngle), c.y - c.r * Math.cos(travelAngle)];

/**
 * Centre line of one track as a closed polyline in the hull's z-y plane, counter-clockwise:
 * along the ground from the rear road wheel to the front one, up round the front wheel, back
 * along the top, down round the rear wheel.
 *   lifts[i]: how far station i sits above its static height
 *   sag: droop of the upper run per square metre of free span (1/m)
 *   ground(z): optional height of the ground under this track; where it rises above the
 *              straight run between two wheels the track lies over it
 * Returns {pts: [z0, y0, z1, y1, ...], cum: running length at each point, length}.
 */
export function buildLoop(rg, stations, lifts, sag, ground) {
  const h = rg.track_thickness / 2;
  const circle = (c, lift = 0) => ({ z: c.z, y: c.y + lift, r: c.r + h });
  const wheels = stations.map((s, i) => circle(s, lifts ? lifts[i] : 0));
  const sprocketFront = rg.sprocket.z > rg.idler.z;
  const front = circle(sprocketFront ? rg.sprocket : rg.idler);
  const rear = circle(sprocketFront ? rg.idler : rg.sprocket);
  const firstW = wheels[0];
  const lastW = wheels[wheels.length - 1];
  // what the upper run rests on: return rollers, or the tops of the road wheels (slack track)
  const supports = (rg.rollers && rg.rollers.length ? rg.rollers.map((r) => circle(r)) : wheels)
    .filter((c) => c.z < front.z - 0.05 && c.z > rear.z + 0.05)
    .sort((a, b) => b.z - a.z)
    .map((c) => ({ z: c.z, y: c.y + c.r, r: 0 }));

  const pts = [];
  const push = (z, y) => pts.push(z, y);
  const arc = (c, from, to) => {
    // belt direction turns from `from` to `to`, counter-clockwise
    let d = (to - from) % TAU;
    if (d < 0) d += TAU;
    if (d > TAU - 1e-3) d = 0;
    const n = Math.max(1, Math.ceil(d / 0.2));
    for (let i = 1; i <= n; i++) {
      const p = onCircle(c, from + (d * i) / n);
      push(p[0], p[1]);
    }
  };
  const hang = (a, b) => {
    // free span from point a to point b, drooping as a parabola
    const span = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const depth = Math.min(sag * span * span, span * 0.2);
    const n = Math.max(1, Math.ceil(span / 0.14));
    for (let i = 1; i <= n; i++) {
      const u = i / n;
      push(a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u - 4 * depth * u * (1 - u));
    }
  };

  const tail = () => [pts[pts.length - 2], pts[pts.length - 1]];
  // straight run from the last point to b, draped over the ground where the ground is higher
  const drape = (b) => {
    const a = tail();
    const span = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = ground ? Math.max(1, Math.ceil(span / 0.11)) : 1;
    for (let i = 1; i <= n; i++) {
      const u = i / n;
      const z = a[0] + (b[0] - a[0]) * u;
      let y = a[1] + (b[1] - a[1]) * u;
      if (ground && i < n) y = Math.max(y, ground(z) + h);
      push(z, y);
    }
  };

  // ground run: under every road wheel, rear to front
  push(lastW.z, lastW.y - lastW.r);
  for (let i = wheels.length - 2; i >= 0; i--) drape([wheels[i].z, wheels[i].y - wheels[i].r]);
  // up round the front road wheel, across to the front sprocket / idler and round it
  const up = tangentAngle(firstW, front);
  arc(firstW, 0, up);
  drape(onCircle(front, up));
  const firstTop = supports.length ? supports[0] : rear;
  const topOut = tangentAngle(front, firstTop);
  arc(front, up, topOut);
  // upper run, front to rear
  let prev = onCircle(front, topOut);
  for (const s of supports) {
    hang(prev, [s.z, s.y]);
    prev = [s.z, s.y];
  }
  const lastTop = supports.length ? supports[supports.length - 1] : front;
  const topIn = tangentAngle(lastTop, rear);
  hang(prev, onCircle(rear, topIn));
  // down round the rear sprocket / idler and back under the rear road wheel
  const down = tangentAngle(rear, lastW);
  arc(rear, topIn, down);
  drape(onCircle(lastW, down));
  arc(lastW, down, TAU);

  const n = pts.length / 2;
  const cum = new Float32Array(n + 1);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    cum[i + 1] = cum[i] + Math.hypot(pts[j * 2] - pts[i * 2], pts[j * 2 + 1] - pts[i * 2 + 1]);
  }
  return { pts, cum, length: cum[n], front, rear, sprocketFront };
}

/**
 * The same loop with the upper run's droop chosen so that the whole track has the length it
 * was made with: when the ground run takes up more track (wheels pushed apart, track bent over
 * an obstacle) the top pulls tight, and when the wheels close up the slack hangs on top.
 * `bias` shifts the result a little (drive tension, swing).
 */
export function fitLoop(rg, stations, lifts, ground, length, bias = 1, maxTension = 0.08) {
  let lo = 0;
  let hi = 0.3;
  let loop = buildLoop(rg, stations, lifts, lo, ground);
  if (loop.length >= length) {
    // pulled tight: the idler's tensioner gives a little (the track keeps its length), and only
    // what it cannot take up is left as stretch
    const excess = loop.length - length;
    const shift = Math.min(excess / 2, maxTension);
    if (shift > 1e-4) {
      const inward = rg.idler.z > 0 ? -1 : 1;
      loop = buildLoop({ ...rg, idler: { ...rg.idler, z: rg.idler.z + inward * shift } }, stations, lifts, lo, ground);
      loop.idlerShift = inward * shift;
    }
    return loop;
  }
  for (let i = 0; i < 7; i++) {
    const mid = 0.5 * (lo + hi);
    loop = buildLoop(rg, stations, lifts, mid, ground);
    if (loop.length < length) lo = mid;
    else hi = mid;
  }
  const sag = Math.min(0.3, 0.5 * (lo + hi) * bias);
  loop = buildLoop(rg, stations, lifts, sag, ground);
  loop.sag = sag;
  return loop;
}

/**
 * Writes one 4x4 matrix per link into `out` (column-major, starting at float index `o`):
 * each link spans from one pin to the next. `offset` is how far the track has run (metres).
 * Returns the float index after the last matrix. pins (optional) receives the pin positions.
 */
export function placeLinks(loop, count, offset, x, out, o, pins) {
  const { pts, cum, length } = loop;
  const n = pts.length / 2;
  const pitch = length / count;
  let s = ((offset % pitch) + pitch) % pitch;
  let seg = 0;
  let pz = 0;
  let py = 0;
  let firstZ = 0;
  let firstY = 0;
  for (let i = 0; i <= count; i++) {
    let z;
    let y;
    if (i === count) {
      z = firstZ;
      y = firstY;
    } else {
      while (seg < n - 1 && cum[seg + 1] < s) seg++;
      const a = seg;
      const b = (seg + 1) % n;
      const l = cum[seg + 1] - cum[seg];
      const k = l > 1e-9 ? (s - cum[seg]) / l : 0;
      z = pts[a * 2] + (pts[b * 2] - pts[a * 2]) * k;
      y = pts[a * 2 + 1] + (pts[b * 2 + 1] - pts[a * 2 + 1]) * k;
      s += pitch;
    }
    if (pins) {
      pins[i * 2] = z;
      pins[i * 2 + 1] = y;
    }
    if (i === 0) {
      firstZ = z;
      firstY = y;
    } else {
      const dz = z - pz;
      const dy = y - py;
      const len = Math.hypot(dz, dy) || 1;
      const c = dz / len;
      const sn = -dy / len;
      out[o] = 1; out[o + 1] = 0; out[o + 2] = 0; out[o + 3] = 0;
      out[o + 4] = 0; out[o + 5] = c; out[o + 6] = sn; out[o + 7] = 0;
      out[o + 8] = 0; out[o + 9] = -sn; out[o + 10] = c; out[o + 11] = 0;
      out[o + 12] = x; out[o + 13] = (y + py) / 2; out[o + 14] = (z + pz) / 2; out[o + 15] = 1;
      o += 16;
    }
    pz = z;
    py = y;
  }
  return o;
}

/** Rotation that puts a sprocket tooth into the link sitting on the middle of its wrap. */
export function sprocketPhase(loop, pins, count, sprocket, teeth) {
  const c = loop.sprocketFront ? loop.front : loop.rear;
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < count; i++) {
    const z = (pins[i * 2] + pins[i * 2 + 2]) / 2 - c.z;
    const y = (pins[i * 2 + 1] + pins[i * 2 + 3]) / 2 - c.y;
    // links on the wrap sit at the pitch radius on the outer side of the wheel
    const outward = loop.sprocketFront ? z : -z;
    const d = Math.abs(Math.hypot(z, y) - c.r) - outward * 0.2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  if (best < 0) return 0;
  const z = (pins[best * 2] + pins[best * 2 + 2]) / 2 - c.z;
  const y = (pins[best * 2 + 1] + pins[best * 2 + 3]) / 2 - c.y;
  const step = TAU / teeth;
  const a = Math.PI / 2 - Math.atan2(y, z);
  return ((a % step) + step) % step;
}

// ------------------------------------------------------------------------- geometry

/** Sets the two free vertex values the running-gear shader reads: wear (0..1) and mud affinity (0..1). */
function tag(b, from, wear, mud) {
  for (let i = from; i < b.vertexCount; i++) {
    b.data[i * STRIDE + 11] = wear;
    b.data[i * STRIDE + 12] = mud;
  }
}

/**
 * One track link, lying along +Z (pin to pin = `pitch`), ground face towards -Y.
 * style: 'center_guide' (one row of guide horns), 'twin_guide' (two rows), 'rubber_block'
 * (flat rubber pads with end connectors).
 */
export function linkGeometry(rg, pitch, mat, rubber) {
  const b = new GeoBuilder();
  const w = rg.track_width;
  const t = rg.track_thickness;
  const style = rg.link_style || 'center_guide';
  let from = b.vertexCount;
  const part = (wear, mud, fn) => {
    from = b.vertexCount;
    fn();
    tag(b, from, wear, mud);
  };
  if (style === 'band') {
    // a moulded rubber band (the T103 of the M56): a cross-bar of steel inside every pitch, tread
    // bars on the ground face and guide horns along both outer edges
    part(0.2, 0.6, () => b.box(translation(0, 0, 0), false, [w, t * 0.8, pitch * 1.0], rubber));
    part(0.85, 0.2, () => b.box(translation(0, t * 0.48, 0), false, [w * 0.78, t * 0.3, pitch * 0.3], mat));
    part(0.35, 0.8, () => b.box(translation(0, -t * 0.5, 0), false, [w * 0.92, t * 0.4, pitch * 0.36], rubber));
    part(0.9, 0.1, () => {
      for (const sx of [-1, 1]) b.box(translation(sx * w * 0.47, t * 1.1, 0), false, [w * 0.05, t * 1.6, pitch * 0.5], mat);
    });
    return b.build();
  }
  if (style === 'rubber_block') {
    part(0.25, 0.5, () => b.box(translation(0, 0, 0), false, [w * 0.86, t * 0.72, pitch * 0.8], rubber));
    part(0.85, 0.5, () => {
      for (const sx of [-1, 1]) b.box(translation(sx * w * 0.465, 0, pitch * 0.5), false, [w * 0.07, t * 0.8, pitch * 0.42], mat);
    });
    part(0.9, 0.1, () => b.box(translation(0, t * 0.75, pitch * 0.5), false, [0.05, t * 1.1, pitch * 0.34], mat));
    part(0.3, 0.6, () => b.cyl(translation(0, 0, pitch * 0.5), false, 'x', t * 0.26, t * 0.26, w * 0.9, 8, mat));
    return b.build();
  }
  // cast link: plate, grouser bar on the ground face, hinge at the leading edge
  part(0.4, 0.45, () => b.box(translation(0, 0.02 * t, 0), false, [w, t * 0.5, pitch * 0.84], mat));
  part(1.0, 1.0, () => b.box(translation(0, -t * 0.38, -pitch * 0.08), false, [w * 0.96, t * 0.42, pitch * 0.3], mat));
  part(0.75, 0.9, () => {
    for (const sx of [-1, 1]) b.box(translation(sx * w * 0.3, -t * 0.3, pitch * 0.22), false, [w * 0.3, t * 0.3, pitch * 0.16], mat);
  });
  part(0.3, 0.6, () => b.cyl(translation(0, 0, pitch * 0.5), false, 'x', t * 0.3, t * 0.3, w * 1.02, 8, mat));
  const horn = (x) => {
    const m = translation(x, t * 0.25, 0);
    b.prism(m, false, [[-pitch * 0.2, 0], [pitch * 0.2, 0], [pitch * 0.06, t * 1.5], [-pitch * 0.06, t * 1.5]], 0.05, 0.03, 0, mat);
  };
  part(0.95, 0.1, () => {
    if (style === 'twin_guide') {
      horn(-w * 0.17);
      horn(w * 0.17);
    } else horn(0);
  });
  return b.build();
}

/**
 * Drive sprocket: a hub and drum in paint (returned as `body`) and two toothed rings in bare,
 * polished steel (`teeth`). r is the radius the track's inner face rides on.
 */
export function sprocketGeometry(rg, teeth, pitch, mats, side = 1) {
  const r = rg.sprocket.r;
  const t = rg.track_thickness;
  const w = rg.track_width;
  const ringX = w * (rg.link_style === 'twin_guide' ? 0.36 : 0.33);
  const body = new GeoBuilder();
  // the dished outer face points away from the hull, so the left-hand sprocket is a mirror image
  const flip = side < 0;
  const at = (x, y, z) => (flip ? mul(scaling(-1, 1, 1), translation(x, y, z)) : translation(x, y, z));
  body.cyl(at(0, 0, 0), flip, 'x', r * 0.62, r * 0.62, ringX * 2, 20, mats.paint_dark);
  // outer face: a dished disc that covers the ring up to its bolt circle, hub cap, ring bolts
  body.cyl(at(ringX + 0.04, 0, 0), flip, 'x', r * 0.8, r * 0.42, 0.05, 24, mats.paint);
  body.cyl(at(ringX + 0.085, 0, 0), flip, 'x', r * 0.3, r * 0.2, 0.1, 12, mats.paint);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    body.cyl(at(ringX + 0.03, Math.cos(a) * r * 0.72, Math.sin(a) * r * 0.72), flip, 'x', r * 0.03, r * 0.03, 0.05, 6, mats.steel);
  }
  const ring = new GeoBuilder();
  const base = pitch * 0.46;
  const tip = pitch * 0.2;
  const root = r * 0.9;
  const top = r + t * 0.95;
  for (const sx of [-1, 1]) {
    let from = ring.vertexCount;
    ring.cyl(translation(sx * ringX, 0, 0), false, 'x', r * 0.93, r * 0.93, 0.04, Math.max(teeth, 12), mats.steel);
    tag(ring, from, 0.55, 0.5);
    from = ring.vertexCount;
    for (let i = 0; i < teeth; i++) {
      const m = mul(rotX((i / teeth) * TAU), translation(sx * ringX, 0, 0));
      ring.prism(m, false, [[-base / 2, root], [base / 2, root], [tip / 2, top], [-tip / 2, top]], 0.04, 0.03, 0, mats.steel);
    }
    tag(ring, from, 1.0, 0.25);
  }
  return { body: body.build(), teeth: ring.build() };
}

/** Road wheel / idler / roller: tyre or steel rim, dished disc, hub and bolt circle. */
export function wheelGeometry(r, w, style, mats) {
  const b = new GeoBuilder();
  if (style === 'hvss_dish') {
    // One C135843-style HVSS wheel disc. The paired disc is a separate wheel
    // entry at the same longitudinal station, not a second tyre at this x.
    // Keep the solid dished plates and short face bolts within that disc; only
    // the small axle/hub bridges toward its mate, leaving the guide slot open.
    b.cyl(IDENTITY, false, 'x', r, r, w, 24, mats.rubber);
    b.cyl(IDENTITY, false, 'x', r * .86, r * .86, w + .008, 24, mats.paint);
    for (const sx of [-1, 1]) {
      b.cyl(translation(sx * (w * .5 + .006), 0, 0), false, 'x',
        r * (sx > 0 ? .8 : .34), r * (sx > 0 ? .34 : .8), .02, 20, mats.paint);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU;
        b.cyl(translation(sx * (w * .5 + .016), Math.cos(a) * r * .5, Math.sin(a) * r * .5),
          false, 'x', r * .028, r * .028, .014, 6, mats.steel);
      }
    }
    b.cyl(IDENTITY, false, 'x', r * .22, r * .18, w + .10, 12, mats.paint_dark);
    return b.build();
  }
  if (style === 'spoked') {
    // rubber tyre on a narrow rim, six flat spokes to the hub on each face
    b.cyl(IDENTITY, false, 'x', r, r, w, 24, mats.rubber);
    b.cyl(IDENTITY, false, 'x', r * 0.84, r * 0.84, w + 0.01, 24, mats.paint);
    b.cyl(IDENTITY, false, 'x', r * 0.72, r * 0.72, w * 0.5, 20, mats.black);
    for (const sx of [-1, 1]) {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU;
        const m = mul(translation(sx * (w * 0.5 + 0.004), Math.cos(a) * r * 0.45, Math.sin(a) * r * 0.45), rotX(a));
        b.box(m, false, [0.012, r * 0.62, r * 0.11], mats.paint);
      }
    }
    b.cyl(IDENTITY, false, 'x', r * 0.2, r * 0.16, w + 0.08, 12, mats.paint_dark);
    return b.build();
  }
  if (style === 'starfish') {
    // the T-54/55 wheel: rubber tyre, a deep-dished disc pressed into five spokes, the dark
    // pockets between them, the hub cap
    b.cyl(IDENTITY, false, 'x', r, r, w, 28, mats.rubber);
    b.cyl(IDENTITY, false, 'x', r * 0.82, r * 0.82, w + 0.01, 28, mats.paint);
    for (const sx of [-1, 1]) {
      b.cyl(translation(sx * (w * 0.5 + 0.004), 0, 0), false, 'x', r * 0.74, r * 0.74, 0.008, 24, mats.black);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU;
        const m = mul(translation(sx * (w * 0.5 + 0.012), Math.cos(a) * r * 0.42, Math.sin(a) * r * 0.42), rotX(a));
        b.box(m, false, [0.022, r * 0.66, r * 0.30], mats.paint);
      }
      b.cyl(translation(sx * (w * 0.5 + 0.02), 0, 0), false, 'x', r * 0.34, r * 0.30, 0.03, 18, mats.paint);
    }
    b.cyl(IDENTITY, false, 'x', r * 0.17, r * 0.13, w + 0.12, 12, mats.paint_dark);
    return b.build();
  }
  const steel = style === 'steel_dish';
  const rim = steel ? { ...mats.steel, rough: 0.5 } : mats.rubber;
  b.cyl(IDENTITY, false, 'x', r, r, w, 24, rim);
  b.cyl(IDENTITY, false, 'x', r * 0.86, r * 0.86, w + 0.012, 24, mats.paint);
  // dished disc: a shallow cone on each face
  b.cyl(translation(w * 0.5 + 0.012, 0, 0), false, 'x', r * 0.8, r * 0.34, 0.03, 20, mats.paint);
  b.cyl(translation(-w * 0.5 - 0.012, 0, 0), false, 'x', r * 0.34, r * 0.8, 0.03, 20, mats.paint);
  b.cyl(IDENTITY, false, 'x', r * 0.22, r * 0.18, w + 0.11, 12, mats.paint_dark);
  const bolts = r > 0.3 ? 8 : 6;
  for (let i = 0; i < bolts; i++) {
    const a = (i / bolts) * TAU;
    if (w < .10) {
      // Narrow paired discs (M113) need short bolt heads on each face. A single
      // through-rod protrudes into the guide slot and makes the pair look joined.
      for (const sx of [-1, 1]) {
        b.cyl(translation(sx * (w * .5 + .015), Math.cos(a) * r * .36, Math.sin(a) * r * .36),
          false, 'x', r * .035, r * .035, .015, 6, mats.steel);
      }
    } else {
      b.cyl(translation(0, Math.cos(a) * r * 0.36, Math.sin(a) * r * 0.36), false, 'x', r * 0.035, r * 0.035, w + 0.075, 6, mats.steel);
    }
  }
  if (!steel) {
    // lightening holes in the disc
    for (let i = 0; i < 6; i++) {
      const a = ((i + 0.5) / 6) * TAU;
      b.cyl(translation(0, Math.cos(a) * r * 0.6, Math.sin(a) * r * 0.6), false, 'x', r * 0.09, r * 0.09, w + 0.05, 8, mats.black);
    }
  }
  return b.build();
}
