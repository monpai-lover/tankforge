// Parametric base shapes for the designer. A base shape is only the starting point: its
// parameters (length, width, glacis angles, roof and floor shape...) move vertices of a fixed
// topology, so a construction history of free edits (doc.js) replays on top of any parameter
// change. Every face the generators make is planar.
//
// Hull space: +Z forward, +X right, +Y up, origin on the ground under the hull centre.
// Turret space: origin at the centre of the ring plane, +Y up, +Z forward at yaw 0.
import { signedVolume, faceNormal, topAt, V } from './mesh.js';

const DEG = Math.PI / 180;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const r4 = (x) => Math.round(x * 10000) / 10000;

// ------------------------------------------------------------------ hull

export const HULL_TYPES = {
  box: { label: '箱型車體', note: '直立首上、側面垂直的傳統焊接車體' },
  wedge: { label: '楔形車體', note: '大傾角首上，鼻部壓低' },
  rounded: { label: '圓角車體', note: '肩部倒角、三段式車首' },
};

export const ROOF_SHAPES = { flat: '平頂', crowned: '拱頂', turtle: '龜背' };
export const FLOOR_SHAPES = { flat: '平底', v: 'V 形底', boat: '船形底' };

export const HULL_DEFAULTS = {
  type: 'wedge',
  length: 6.2,
  width_top: 3.1,
  width_low: 1.9,
  floor_y: 0.42,
  sponson_y: 0.98,
  deck_y: 1.62,
  side_deg: 0,
  upper_glacis_deg: 55,
  lower_glacis_deg: 50,
  nose_y: 0.78,
  nose2_y: 0.9,
  rear_upper_deg: 12,
  rear_lower_deg: 35,
  rear_break_y: 0.8,
  roof: 'flat',
  floor: 'flat',
};

export const HULL_PRESETS = {
  box: { type: 'box', upper_glacis_deg: 12, lower_glacis_deg: 40, nose_y: 0.86, side_deg: 0, rear_upper_deg: 5, rear_lower_deg: 30 },
  wedge: { type: 'wedge', upper_glacis_deg: 57, lower_glacis_deg: 52, nose_y: 0.78, side_deg: 0, rear_upper_deg: 15, rear_lower_deg: 35 },
  rounded: { type: 'rounded', upper_glacis_deg: 48, lower_glacis_deg: 45, nose_y: 0.62, nose2_y: 0.86, side_deg: 10, rear_upper_deg: 20, rear_lower_deg: 30, roof: 'crowned' },
};

/** Parameters made consistent (breaks inside their segments, widths ordered). */
export function sanitizeHull(p0) {
  const p = { ...HULL_DEFAULTS, ...p0 };
  p.length = clamp(p.length, 3.0, 10);
  p.width_top = clamp(p.width_top, 1.6, 4.4);
  p.width_low = clamp(p.width_low, 1.0, p.width_top - 0.3);
  p.floor_y = clamp(p.floor_y, 0.2, 0.9);
  const floor = FLOOR[p.floor] || FLOOR.flat;
  const lowTop = p.floor_y + floor.chine_h;
  p.sponson_y = clamp(p.sponson_y, lowTop + 0.2, 2.4);
  p.deck_y = clamp(p.deck_y, p.sponson_y + 0.2, 3.2);
  p.side_deg = clamp(p.side_deg, -10, 50);
  const maxLean = (p.width_top / 2 - 0.3) / Math.max(0.05, p.deck_y - p.sponson_y);
  if (Math.tan(p.side_deg * DEG) > maxLean) p.side_deg = Math.atan(maxLean) / DEG;
  p.upper_glacis_deg = clamp(p.upper_glacis_deg, 0, 80);
  p.lower_glacis_deg = clamp(p.lower_glacis_deg, 0, 75);
  p.rear_upper_deg = clamp(p.rear_upper_deg, -20, 70);
  p.rear_lower_deg = clamp(p.rear_lower_deg, 0, 70);
  p.nose_y = clamp(p.nose_y, lowTop + 0.03, p.sponson_y - 0.03);
  p.nose2_y = clamp(p.nose2_y, p.nose_y + 0.02, p.sponson_y - 0.01);
  p.rear_break_y = clamp(p.rear_break_y, lowTop + 0.03, p.sponson_y - 0.03);
  // the front and rear profiles must not cross
  const span = (y) => zFront(p, y) - zRear(p, y);
  for (let k = 0; k < 30 && Math.min(span(p.floor_y - 0.3), span(p.deck_y + 0.3), span(p.nose_y)) < 0.8; k++) {
    p.upper_glacis_deg *= 0.9;
    p.lower_glacis_deg *= 0.9;
    p.rear_upper_deg *= 0.9;
    p.rear_lower_deg *= 0.9;
  }
  return p;
}

const FLOOR = {
  flat: { v_depth: 0, chine_w: 0.05, chine_h: 0.05 },
  v: { v_depth: 0.16, chine_w: 0.05, chine_h: 0.08 },
  boat: { v_depth: 0.08, chine_w: 0.32, chine_h: 0.26 },
};
const ROOF = {
  flat: { edge_w: 0.35, turtle_h: 0, crown: 0 },
  crowned: { edge_w: 0.35, turtle_h: 0, crown: 0.06 },
  turtle: { edge_w: 0.4, turtle_h: 0.14, crown: 0.02 },
};

function zFront(p, y) {
  const L = p.length / 2;
  if (p.type === 'rounded') {
    if (y > p.nose2_y) return L - (y - p.nose2_y) * Math.tan(p.upper_glacis_deg * DEG);
    if (y < p.nose_y) return L - (p.nose_y - y) * Math.tan(p.lower_glacis_deg * DEG);
    return L;
  }
  if (y >= p.nose_y) return L - (y - p.nose_y) * Math.tan(p.upper_glacis_deg * DEG);
  return L - (p.nose_y - y) * Math.tan(p.lower_glacis_deg * DEG);
}

function zRear(p, y) {
  const L = p.length / 2;
  if (y >= p.rear_break_y) return -L + (y - p.rear_break_y) * Math.tan(p.rear_upper_deg * DEG);
  return -L + (p.rear_break_y - y) * Math.tan(p.rear_lower_deg * DEG);
}

/** Front and rear profile of a (sanitized) parameter set: z of the hull end at height y. */
export function hullProfile(p0) {
  const p = sanitizeHull(p0);
  return { zFront: (y) => zFront(p, y), zRear: (y) => zRear(p, y), params: p };
}

/** Right half of the cross-section, bottom centre to top centre: [{x, y, tag (of the segment that starts here), lower}]. */
function hullSection(p) {
  const fl = FLOOR[p.floor] || FLOOR.flat;
  const rf = ROOF[p.roof] || ROOF.flat;
  const wl = p.width_low / 2;
  const wt = p.width_top / 2;
  const lean = Math.tan(p.side_deg * DEG);
  const xD = wt - (p.deck_y - p.sponson_y) * lean;
  const pts = [
    { x: 0, y: p.floor_y - fl.v_depth, tag: 'floor' },
    { x: wl - fl.chine_w, y: p.floor_y, tag: 'chine' },
    { x: wl, y: p.floor_y + fl.chine_h, tag: 'lower_side', lower: true },
    { x: wl, y: p.sponson_y, tag: 'sponson_floor' },
    { x: wt, y: p.sponson_y, tag: 'side' },
  ];
  if (p.type === 'rounded') {
    const rr = Math.min(0.22, (p.deck_y - p.sponson_y) * 0.4);
    pts.push({ x: xD + rr * lean, y: p.deck_y - rr, tag: 'shoulder' });
    pts.push({ x: xD - rr, y: p.deck_y, tag: 'deck' });
  } else {
    pts.push({ x: xD, y: p.deck_y, tag: 'deck' });
  }
  const xR = Math.max(0.15, pts[pts.length - 1].x - rf.edge_w);
  pts.push({ x: xR, y: p.deck_y + rf.turtle_h, tag: 'roof' });
  pts.push({ x: 0, y: p.deck_y + rf.turtle_h + rf.crown, tag: null });
  return pts;
}

/**
 * Hull mesh from parameters. Two end rings (front and rear) of the same cross-section, each
 * with its own break points on the lower side plates; the front and rear caps are split into
 * planar bands at those breaks (upper / lower glacis), every lengthwise face is planar because
 * all its corners share one cross-section line.
 */
export function genHull(p0) {
  const p = sanitizeHull(p0);
  const half = hullSection(p);
  // full ring: right half bottom->top, then left half top->bottom (without the centre points)
  const ring = [];
  half.forEach((q, i) => ring.push({ x: q.x, y: q.y, tag: q.tag, side: 'r', lower: q.lower, i }));
  for (let i = half.length - 2; i >= 1; i--) ring.push({ x: -half[i].x, y: half[i].y, tag: half[i - 1].tag, side: 'l', lower: half[i - 1].lower, i });
  const n = ring.length;
  // segment s runs ring[s] -> ring[s+1]; its tag
  const segTag = (s) => {
    const a = ring[s];
    // from the top centre point the ring starts down the left half
    if (a.side === 'r' && a.i === half.length - 1) return `${half[half.length - 2].tag}_l`;
    return `${a.tag}_${a.side}`;
  };
  const isLowerSeg = (s) => !!ring[s].lower;
  const frontBreaks = p.type === 'rounded' ? [p.nose_y, p.nose2_y] : [p.nose_y];
  const rearBreaks = [p.rear_break_y];
  const vertices = [];
  // ring vertex lists with break points inserted in the lower side segments
  function buildRing(breaks, zf) {
    const list = []; // {v (vertex index), y, ringIdx|null, seg}
    for (let s = 0; s < n; s++) {
      const a = ring[s];
      const b = ring[(s + 1) % n];
      list.push({ v: vertices.length, y: a.y, ringIdx: s, seg: s });
      vertices.push([r4(a.x), r4(a.y), r4(zf(a.y))]);
      if (isLowerSeg(s)) {
        const bs = a.y < b.y ? breaks.slice() : breaks.slice().reverse();
        for (const y of bs) {
          const t = (y - a.y) / (b.y - a.y);
          const x = a.x + (b.x - a.x) * t;
          list.push({ v: vertices.length, y, ringIdx: null, seg: s, brk: true });
          vertices.push([r4(x), r4(y), r4(zf(y))]);
        }
      }
    }
    return list;
  }
  const F = buildRing(frontBreaks, (y) => zFront(p, y));
  const R = buildRing(rearBreaks, (y) => zRear(p, y));
  const faces = [];
  let id = 0;
  const posOf = (list, ringIdx) => list.findIndex((e) => e.ringIdx === ringIdx);
  // lengthwise faces
  for (let s = 0; s < n; s++) {
    const tag = segTag(s) || 'side';
    const f0 = posOf(F, s);
    const f1 = posOf(F, (s + 1) % n);
    const r0 = posOf(R, s);
    const r1 = posOf(R, (s + 1) % n);
    const fseg = [];
    for (let k = f0; ; k = (k + 1) % F.length) {
      fseg.push(F[k].v);
      if (k === f1) break;
    }
    const rseg = [];
    for (let k = r0; ; k = (k + 1) % R.length) {
      rseg.push(R[k].v);
      if (k === r1) break;
    }
    faces.push({ id: id++, v: [...fseg.slice().reverse(), ...rseg], tag });
  }
  // caps, split into bands at the break heights
  function caps(list, breaks, tags, reverse) {
    const brk = breaks.map((y) => list.map((e, k) => (e.brk && Math.abs(e.y - y) < 1e-9 ? k : -1)).filter((k) => k >= 0));
    // each break appears once on the right (rising) and once on the left
    const right = brk.map((ks) => ks.find((k) => vertices[list[k].v][0] > 0));
    const left = brk.map((ks) => ks.find((k) => vertices[list[k].v][0] < 0));
    const walk = (from, to) => {
      const out = [];
      for (let k = from; ; k = (k + 1) % list.length) {
        out.push(list[k].v);
        if (k === to) break;
      }
      return out;
    };
    const bands = [];
    bands.push({ v: walk(left[0], right[0]), tag: tags[0] });
    for (let i = 0; i + 1 < breaks.length; i++) bands.push({ v: [...walk(right[i], right[i + 1]), ...walk(left[i + 1], left[i])], tag: tags[i + 1] });
    bands.push({ v: walk(right[breaks.length - 1], left[breaks.length - 1]), tag: tags[breaks.length] });
    for (const b of bands) faces.push({ id: id++, v: reverse ? b.v.slice().reverse() : b.v, tag: b.tag });
  }
  caps(F, frontBreaks, frontBreaks.length === 2 ? ['lower_front', 'nose', 'upper_front'] : ['lower_front', 'upper_front'], false);
  caps(R, rearBreaks, ['lower_rear', 'upper_rear'], true);
  const mesh = { vertices, faces };
  if (signedVolume(mesh) < 0) for (const f of mesh.faces) f.v.reverse();
  return { mesh, params: p };
}

/** Default main-plate thickness (mm) for a hull face tag. */
export function hullArmorFor(tag) {
  const t = (tag || '').replace(/_(r|l)$/, '').replace(/_(ext|rim)$/, '');
  return { upper_front: 80, nose: 80, lower_front: 60, side: 45, lower_side: 45, shoulder: 40, sponson_floor: 20, deck: 25, roof: 20, chine: 25, floor: 20, upper_rear: 40, lower_rear: 40, bevel: 40 }[t] ?? 30;
}

// ------------------------------------------------------------------ turret

export const TURRET_TYPES = {
  welded: { label: '焊接型炮塔', note: '傾斜焊接板、斜切角' },
  box: { label: '箱型炮塔', note: '垂直平板' },
  cast: { label: '鑄造型炮塔', note: '圓頂鑄造，前圓後窄' },
  round: { label: '圓形炮塔', note: '正圓鑄造' },
  wedge: { label: '楔形炮塔', note: '尖楔形正面' },
  low: { label: '低矮炮塔', note: '扁平鑄造，車高低' },
  large: { label: '大型炮塔', note: '長尾艙，空間大' },
  unmanned: { label: '無人炮塔', note: '乘員都在車體內' },
};

export const TURRET_DEFAULTS = {
  type: 'welded',
  length: 2.5,
  width: 2.0,
  height: 0.85,
  front_z: 1.15,
  front_deg: 18,
  side_deg: 22,
  rear_deg: 12,
  chamfer: 0.32,
  roof_deg: 0,
};

export const TURRET_PRESETS = {
  welded: { type: 'welded', length: 2.5, width: 2.0, height: 0.85, front_z: 1.15, front_deg: 18, side_deg: 22, rear_deg: 12, chamfer: 0.32 },
  box: { type: 'box', length: 2.4, width: 1.95, height: 0.88, front_z: 1.1, front_deg: 0, side_deg: 0, rear_deg: 0, chamfer: 0.05 },
  cast: { type: 'cast', length: 2.5, width: 2.1, height: 0.9, front_z: 1.2, front_deg: 30, side_deg: 28, rear_deg: 25 },
  round: { type: 'round', length: 2.2, width: 2.2, height: 0.85, front_z: 1.1, front_deg: 25, side_deg: 25, rear_deg: 25 },
  wedge: { type: 'wedge', length: 2.7, width: 2.0, height: 0.8, front_z: 1.25, front_deg: 15, side_deg: 15, rear_deg: 10, chamfer: 0.2, wedge: 0.45 },
  low: { type: 'cast', length: 2.4, width: 2.2, height: 0.65, front_z: 1.15, front_deg: 40, side_deg: 35, rear_deg: 30 },
  large: { type: 'welded', length: 3.3, width: 2.3, height: 0.95, front_z: 1.25, front_deg: 15, side_deg: 15, rear_deg: -8, chamfer: 0.3 },
  unmanned: { type: 'box', length: 1.7, width: 1.4, height: 0.55, front_z: 0.9, front_deg: 10, side_deg: 15, rear_deg: 10, chamfer: 0.12 },
};

export function sanitizeTurret(p0) {
  const p = { ...TURRET_DEFAULTS, ...p0 };
  p.length = clamp(p.length, 0.9, 4.5);
  p.width = clamp(p.width, 0.8, 3.8);
  p.height = clamp(p.height, 0.35, 1.5);
  p.front_z = clamp(p.front_z, 0.3, p.length - 0.3);
  p.front_deg = clamp(p.front_deg, -10, 65);
  p.side_deg = clamp(p.side_deg, -10, 60);
  p.rear_deg = clamp(p.rear_deg, -35, 60);
  p.chamfer = clamp(p.chamfer ?? 0.2, 0.03, Math.min(p.width, p.length) * 0.35);
  p.wedge = clamp(p.wedge ?? 0.4, 0.05, 1.2);
  p.roof_deg = clamp(p.roof_deg || 0, -10, 15);
  // walls may not lean so far in that the roof collapses
  const room = Math.min(p.width / 2, p.length / 2) - 0.2;
  const maxTan = room / p.height;
  for (const k of ['front_deg', 'side_deg', 'rear_deg']) if (Math.tan(p[k] * DEG) > maxTan) p[k] = Math.atan(maxTan) / DEG;
  return p;
}

function planTag(nx, nz) {
  const a = Math.atan2(nx, nz) / DEG; // 0 = front, 90 = right
  const s = a >= 0 ? 'r' : 'l';
  const aa = Math.abs(a);
  if (aa < 30) return 'front';
  if (aa < 62) return `cheek_${s}`;
  if (aa < 128) return `side_${s}`;
  if (aa < 152) return `rear_cheek_${s}`;
  return 'rear';
}

/** Planar-walled turret: plan polygon at the base, each wall leaning in by its own angle. */
function wallTurret(p, plan) {
  const n = plan.length;
  // orient the plan counter-clockwise seen from above (x right, z forward: that is clockwise in (x,z))
  let area = 0;
  for (let i = 0; i < n; i++) area += plan[i][0] * plan[(i + 1) % n][1] - plan[(i + 1) % n][0] * plan[i][1];
  if (area > 0) plan.reverse();
  const walls = [];
  for (let i = 0; i < n; i++) {
    const a = plan[i];
    const b = plan[(i + 1) % n];
    const e = [b[0] - a[0], b[1] - a[1]];
    const l = Math.hypot(e[0], e[1]);
    // outward normal in plan
    let nx = e[1] / l;
    let nz = -e[0] / l;
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if (nx * mid[0] + nz * (mid[1] - (p.front_z - p.length / 2)) < 0) {
      nx = -nx;
      nz = -nz;
    }
    const tag = planTag(nx, nz);
    const deg = tag === 'front' ? p.front_deg : tag === 'rear' ? p.rear_deg : tag.startsWith('cheek') ? (p.front_deg + p.side_deg) / 2 : tag.startsWith('rear_cheek') ? (p.side_deg + p.rear_deg) / 2 : p.side_deg;
    const c = Math.cos(deg * DEG);
    const s = Math.sin(deg * DEG);
    const N = [nx * c, s, nz * c];
    walls.push({ N, d: N[0] * a[0] + N[2] * a[1], tag, p: a });
  }
  const rr = (p.roof_deg || 0) * DEG;
  const roof = { N: [0, Math.cos(rr), Math.sin(rr)], d: p.height * Math.cos(rr) };
  const solve = (P1, P2, P3) => {
    const m = [P1.N, P2.N, P3.N];
    const b = [P1.d, P2.d, P3.d];
    const det = (q) => q[0][0] * (q[1][1] * q[2][2] - q[1][2] * q[2][1]) - q[0][1] * (q[1][0] * q[2][2] - q[1][2] * q[2][0]) + q[0][2] * (q[1][0] * q[2][1] - q[1][1] * q[2][0]);
    const D = det(m);
    const out = [];
    for (let k = 0; k < 3; k++) {
      const mk = m.map((row, r) => row.map((v, cc) => (cc === k ? b[r] : v)));
      out.push(det(mk) / D);
    }
    return out;
  };
  const tops = () => {
    const out = [];
    for (let i = 0; i < n; i++) out.push(solve(walls[(i + n - 1) % n], walls[i], roof));
    return out;
  };
  // walls that lean in too far make the roof outline fold over itself: ease every lean until
  // each roof edge still runs the same way as the base edge under it
  let top = tops();
  for (let k = 0; k < 40; k++) {
    let ok = true;
    for (let i = 0; i < n && ok; i++) {
      const j = (i + 1) % n;
      const be = [plan[j][0] - plan[i][0], plan[j][1] - plan[i][1]];
      const te = [top[j][0] - top[i][0], top[j][2] - top[i][2]];
      if (be[0] * te[0] + be[1] * te[1] <= 1e-4 * Math.hypot(...be)) ok = false;
    }
    if (ok) break;
    for (const w of walls) {
      const h = Math.hypot(w.N[0], w.N[2]);
      const a = Math.atan2(w.N[1], h) * 0.85;
      const nx = w.N[0] / h;
      const nz = w.N[2] / h;
      w.N = [nx * Math.cos(a), Math.sin(a), nz * Math.cos(a)];
      w.d = w.N[0] * w.p[0] + w.N[2] * w.p[1];
    }
    top = tops();
  }
  const vertices = [];
  for (const q of plan) vertices.push([r4(q[0]), 0, r4(q[1])]);
  for (const t of top) vertices.push(t.map(r4));
  const faces = [];
  let id = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    faces.push({ id: id++, v: [i, j, n + j, n + i], tag: walls[i].tag });
  }
  faces.push({ id: id++, v: Array.from({ length: n }, (_, i) => n + i), tag: 'roof' });
  faces.push({ id: id++, v: Array.from({ length: n }, (_, i) => i).reverse(), tag: 'floor' });
  const mesh = { vertices, faces };
  if (signedVolume(mesh) < 0) for (const f of mesh.faces) f.v.reverse();
  return mesh;
}

/** Cast turret: stacked superellipse rings, each scaled about the vertical axis (planar quads). */
function castTurret(p, round) {
  const segs = 20;
  const pw = round ? 2 : 2.6;
  const zc = p.front_z - p.length / 2;
  const rx = p.width / 2;
  const rzF = round ? p.length / 2 : p.length * 0.55;
  const rzR = round ? p.length / 2 : p.length * 0.45;
  const zf = round ? zc : p.front_z - rzF;
  const base = [];
  for (let i = 0; i < segs; i++) {
    const t = (2 * Math.PI * i) / segs;
    const s = Math.sin(t);
    const c = Math.cos(t);
    const x = Math.sign(s) * Math.pow(Math.abs(s), 2 / pw) * rx;
    const z = Math.sign(c) * Math.pow(Math.abs(c), 2 / pw);
    base.push([x, zf + (z >= 0 ? rzF : rzR) * z]);
  }
  const lean = Math.tan(((p.front_deg + p.side_deg + p.rear_deg) / 3) * DEG);
  const top = clamp(1 - (p.height * lean) / Math.min(rx, rzR), 0.35, 1);
  const levels = [
    [0, 1],
    [0.45, 1 - (1 - top) * 0.22],
    [0.8, 1 - (1 - top) * 0.6],
    [1, top],
  ];
  const vertices = [];
  for (const [h, sc] of levels) for (const q of base) vertices.push([r4(q[0] * sc), r4(h * p.height), r4(zf + (q[1] - zf) * sc)]);
  const faces = [];
  let id = 0;
  for (let L = 0; L + 1 < levels.length; L++) {
    for (let i = 0; i < segs; i++) {
      const j = (i + 1) % segs;
      const a = L * segs + i;
      const b = L * segs + j;
      const q = base[i];
      const q2 = base[j];
      const tag = L === levels.length - 2 ? 'roof_edge' : planTag((q[0] + q2[0]) / 2, (q[1] + q2[1]) / 2 - zf);
      faces.push({ id: id++, v: [a, b, b + segs, a + segs], tag });
    }
  }
  const topStart = (levels.length - 1) * segs;
  faces.push({ id: id++, v: Array.from({ length: segs }, (_, i) => topStart + i), tag: 'roof' });
  faces.push({ id: id++, v: Array.from({ length: segs }, (_, i) => i).reverse(), tag: 'floor' });
  const mesh = { vertices, faces };
  if (signedVolume(mesh) < 0) for (const f of mesh.faces) f.v.reverse();
  return mesh;
}

export function genTurret(p0) {
  const p = sanitizeTurret(p0);
  const zf = p.front_z;
  const zr = p.front_z - p.length;
  const w = p.width / 2;
  let mesh;
  if (p.type === 'cast' || p.type === 'round') mesh = castTurret(p, p.type === 'round');
  else if (p.type === 'wedge') {
    const ch = p.chamfer;
    mesh = wallTurret(p, [[0, zf], [w, zf - p.wedge], [w, zr + ch], [w - ch, zr], [-(w - ch), zr], [-w, zr + ch], [-w, zf - p.wedge]]);
  } else {
    const ch = p.type === 'box' ? Math.min(p.chamfer, 0.08) : p.chamfer;
    const chr = ch * 0.6;
    mesh = wallTurret(p, [[w - ch, zf], [w, zf - ch], [w, zr + chr], [w - chr, zr], [-(w - chr), zr], [-w, zr + chr], [-w, zf - ch], [-(w - ch), zf]]);
  }
  return { mesh, params: p };
}

export function turretArmorFor(tag) {
  const t = (tag || '').replace(/_(r|l)$/, '').replace(/_(ext|rim)$/, '');
  return { front: 90, cheek: 75, side: 50, rear_cheek: 45, rear: 40, roof_edge: 35, roof: 20, floor: 15, bevel: 50 }[t] ?? 40;
}

/** z of the turret front surface at height y on the centre line (for placing the mantlet). */
export function turretFrontAt(mesh, y) {
  let best = -Infinity;
  for (const f of mesh.faces) {
    const n = faceNormal(mesh, f);
    if (n[2] < 0.5) continue;
    const pts = f.v.map((i) => mesh.vertices[i]);
    // intersect the centre line x = 0 at height y with this face's plane
    const c = pts[0];
    const z = c[2] - (n[0] * (0 - c[0]) + n[1] * (y - c[1])) / n[2];
    const ys = pts.map((q) => q[1]);
    const xs = pts.map((q) => q[0]);
    if (y < Math.min(...ys) - 1e-6 || y > Math.max(...ys) + 1e-6 || Math.min(...xs) > 1e-6 || Math.max(...xs) < -1e-6) continue;
    best = Math.max(best, z);
  }
  return Number.isFinite(best) ? best : 0;
}

/** Height of the ring plane for a ring at (x, z) of diameter d: the mean roof height under the ring. */
export function ringHeight(hullMesh, x, z, d) {
  const hs = [];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const h = topAt(hullMesh, x + Math.cos(a) * d * 0.45, z + Math.sin(a) * d * 0.45);
    if (h != null) hs.push(h);
  }
  const c = topAt(hullMesh, x, z);
  if (c != null) hs.push(c);
  return hs.length ? r4(hs.reduce((s, h) => s + h, 0) / hs.length) : 1.5;
}

export { V };
