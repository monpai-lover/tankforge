// What the bureau viewport shows, built fresh from the design, the core's last report and the
// editor state; and picking (faces, edges, vertices, modules, add-ons) against the same data.
import { DrawList } from './view.js';
import * as M from './mesh.js';

const { sub, add, mul, dot, cross, len, norm } = M.V;

export const COLORS = {
  paint: [0.43, 0.48, 0.42, 1],
  turret: [0.47, 0.51, 0.44, 1],
  edge: [0.08, 0.09, 0.07, 1],
  edgeHi: [0.85, 0.85, 0.78, 1],
  sel: [0.95, 0.7, 0.2, 1],
  hover: [1, 0.86, 0.45, 1],
  bad: [0.86, 0.25, 0.2, 1],
  ok: [0.45, 0.78, 0.45, 1],
  ring: [0.95, 0.7, 0.2, 1],
  com: [0.85, 0.3, 0.85, 1],
  track: [0.2, 0.2, 0.19, 1],
  wheel: [0.32, 0.33, 0.31, 1],
  gun: [0.4, 0.43, 0.38, 1],
  breech: [0.55, 0.5, 0.3, 1],
  recoil: [0.95, 0.75, 0.3, 0.9],
};

export const MATERIAL_COLORS = {
  rha: [0.45, 0.52, 0.6],
  cha: [0.58, 0.48, 0.38],
  high_hardness_steel: [0.3, 0.33, 0.42],
  aluminium: [0.75, 0.77, 0.8],
  spaced: [0.4, 0.6, 0.62],
  composite: [0.55, 0.38, 0.65],
  applied: [0.5, 0.56, 0.42],
  skirt: [0.36, 0.4, 0.33],
  era: [0.9, 0.55, 0.2],
};

export const MODULE_COLORS = {
  engine: [0.75, 0.45, 0.2],
  transmission: [0.6, 0.5, 0.25],
  fuel_tank: [0.85, 0.75, 0.25],
  ammo_rack: [0.85, 0.35, 0.25],
  radio: [0.35, 0.6, 0.75],
  turret_drive: [0.5, 0.55, 0.6],
  crew: [0.4, 0.7, 0.45],
  gun_breech: [0.55, 0.5, 0.3],
};

// War Thunder's protection-analysis colours: green goes through, yellow may, red stops it
export const PROTECT_COLORS = {
  1: [0.25, 0.5, 0.9, 0.85],
  2: [0.88, 0.25, 0.18, 0.88],
  3: [0.95, 0.75, 0.2, 0.85],
  4: [0.35, 0.75, 0.4, 0.85],
  5: [0.6, 0.6, 0.6, 0.6],
};

/** Heat colour (same ramp as the shader): 0 = thin / light (red) ... 1 = thick / heavy (blue). */
export function heat(t) {
  t = Math.max(0, Math.min(1, t));
  const stops = [
    [0.78, 0.16, 0.12],
    [0.93, 0.62, 0.16],
    [0.86, 0.86, 0.3],
    [0.3, 0.72, 0.42],
    [0.2, 0.45, 0.85],
  ];
  const x = t * 4;
  const i = Math.min(3, Math.floor(x));
  const f = x - i;
  return [0, 1, 2].map((k) => stops[i][k] + (stops[i + 1][k] - stops[i][k]) * f).concat([1]);
}

// ------------------------------------------------------------------ armour at a point (display)

function meanValue(poly, p) {
  const n = poly.length;
  const s = poly.map((q) => [q[0] - p[0], q[1] - p[1]]);
  const r = s.map((q) => Math.hypot(q[0], q[1]));
  for (let i = 0; i < n; i++) if (r[i] < 1e-10) return poly.map((_, k) => (k === i ? 1 : 0));
  const w = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const cr = s[i][0] * s[j][1] - s[i][1] * s[j][0];
    const dt = s[i][0] * s[j][0] + s[i][1] * s[j][1];
    if (Math.abs(cr) < 1e-10 * Math.max(r[i] * r[j], 1e-12) && dt < 0) {
      const k = r[i] / (r[i] + r[j]);
      w[i] = 1 - k;
      w[j] = k;
      return w;
    }
  }
  const th = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const cr = s[i][0] * s[j][1] - s[i][1] * s[j][0];
    const dt = s[i][0] * s[j][0] + s[i][1] * s[j][1];
    th.push((r[i] * r[j] - dt) / cr);
  }
  let sum = 0;
  for (let i = 0; i < n; i++) {
    w[i] = (th[(i + n - 1) % n] + th[i]) / r[i];
    sum += w[i];
  }
  return w.map((x) => x / sum);
}

/** Main-plate thickness at point p of a face (uniform, per-corner, or map). Mirrors tg_design::armor. */
export function thicknessAt(mesh, face, armor, p) {
  if (!armor) return 0;
  const pts = M.facePoints(mesh, face);
  const n = M.faceNormal(mesh, face);
  const { u, v } = M.faceFrame(n);
  const c = M.faceCentroid(mesh, face);
  const to2 = (q) => [dot(sub(q, c), u), dot(sub(q, c), v)];
  if (armor.vertex_mm && armor.vertex_mm.length === pts.length) {
    const w = meanValue(pts.map(to2), to2(p));
    return w.reduce((s, x, k) => s + x * armor.vertex_mm[k], 0);
  }
  if (armor.map) {
    const poly = pts.map(to2);
    const us = poly.map((q) => q[0]);
    const vs = poly.map((q) => q[1]);
    const [u0, u1, v0, v1] = [Math.min(...us), Math.max(...us), Math.min(...vs), Math.max(...vs)];
    const q = to2(p);
    const sx = Math.max(0, Math.min(1, (q[0] - u0) / Math.max(u1 - u0, 1e-9)));
    const sy = Math.max(0, Math.min(1, (q[1] - v0) / Math.max(v1 - v0, 1e-9)));
    const { nu, nv, values_mm: vals } = armor.map;
    const get = (i, j) => vals[j * nu + i] ?? 0;
    if (nu === 1 && nv === 1) return get(0, 0);
    const x = sx * (nu - 1);
    const y = sy * (nv - 1);
    const i0 = Math.floor(x);
    const j0 = Math.floor(y);
    const i1 = Math.min(i0 + 1, nu - 1);
    const j1 = Math.min(j0 + 1, nv - 1);
    const fx = x - i0;
    const fy = y - j0;
    return (get(i0, j0) * (1 - fx) + get(i1, j0) * fx) * (1 - fy) + (get(i0, j1) * (1 - fx) + get(i1, j1) * fx) * fy;
  }
  return armor.thickness_mm;
}

/** Kinetic-RHA equivalent of the whole stack at p (outer layers + main plate), for the LOS view. */
export function stackRhaAt(mesh, face, armor, stack, mats, p) {
  if (!armor) return 0;
  const kf = (id) => mats[id]?.kinetic_factor ?? 1;
  let t = thicknessAt(mesh, face, armor, p) * kf(armor.material);
  for (const l of stack?.layers || []) t += l.thickness_mm * kf(l.material) / Math.max(0.2, Math.cos((l.angle_deg || 0) * Math.PI / 180));
  return t;
}

// ------------------------------------------------------------------ scene

export function bodyOffset(design, body) {
  return body === 'turret' ? design.turret_ring?.position_m || [0, 0, 0] : [0, 0, 0];
}

function subdivide(a, b, c, n) {
  const out = [];
  const P = (i, j) => add(add(a, mul(sub(b, a), i / n)), mul(sub(c, a), j / n));
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n - i; j++) {
      out.push([P(i, j), P(i + 1, j), P(i, j + 1)]);
      if (i + j + 1 < n) out.push([P(i + 1, j), P(i + 1, j + 1), P(i, j + 1)]);
    }
  return out;
}

/**
 * ctx: {design, report, mats, state: {step, body, sel:{body, mode, items}, hover, viewMode, xray,
 *       showInner, issueRefs:Set, selectedBox, protect, range}}
 */
export function buildScene(ctx) {
  const { design, report, mats, state } = ctx;
  const dl = new DrawList();
  const xray = state.xray;
  const faceArmor = new Map(design.armor_faces.map((a) => [a.body + ':' + a.face, a]));
  const faceStack = new Map((design.armor_layers || []).map((s) => [s.body + ':' + s.face, s]));
  const faceRep = new Map((report?.armor_faces || []).map((f) => [f.body + ':' + f.id, f]));
  let maxDensity = 1;
  for (const f of report?.armor_faces || []) maxDensity = Math.max(maxDensity, f.areal_density_kg_m2);

  for (const body of ['hull', 'turret']) {
    const mesh = body === 'hull' ? design.hull_geometry : design.turret_geometry;
    if (!mesh) continue;
    const off = bodyOffset(design, body);
    const P = (i) => add(mesh.vertices[i], off);
    const editing = state.body === body && (state.step === 'hull' || state.step === 'turret' || state.step === 'armor');
    const selFaces = state.sel.body === body && state.sel.mode === 'face' ? new Set(state.sel.items) : null;
    for (const f of mesh.faces) {
      const key = body + ':' + f.id;
      const armor = faceArmor.get(key);
      const stack = faceStack.get(key);
      const rep = faceRep.get(key);
      const n = M.faceNormal(mesh, f);
      let col = body === 'hull' ? COLORS.paint : COLORS.turret;
      const tmode = state.viewMode;
      const varying = tmode === 'thickness' && armor && (armor.vertex_mm || armor.map);
      if (tmode === 'material') col = (MATERIAL_COLORS[armor?.material] || [0.5, 0.5, 0.5]).concat([1]);
      else if (tmode === 'weight') col = heat(1 - (rep?.areal_density_kg_m2 ?? 0) / maxDensity);
      else if (tmode === 'thickness' && !varying) col = heat(((stackRhaAt(mesh, f, armor, stack, mats, M.faceCentroid(mesh, f)) - state.range[0]) / (state.range[1] - state.range[0])));
      if (selFaces?.has(f.id)) col = mix(col, COLORS.sel, 0.55);
      else if (state.hover?.kind === 'face' && state.hover.body === body && state.hover.id === f.id) col = mix(col, COLORS.hover, 0.3);
      if (state.issueRefs?.has(`${body}:face:${f.id}`)) col = mix(col, COLORS.bad, 0.6);
      const alpha = xray ? 0.16 : 1;
      const c = [col[0], col[1], col[2], alpha];
      const pts = f.v.map(P);
      const tris = M.faceTriangles(mesh, f);
      for (const [ia, ib, ic] of tris) {
        if (varying || tmode === 'effective') {
          // per-point thickness: subdivide so maps and corner values show their shape
          const parts = varying || armor?.map ? subdivide(pts[ia], pts[ib], pts[ic], armor?.map ? 4 : 2) : [[pts[ia], pts[ib], pts[ic]]];
          for (const [a, b, cc] of parts) {
            const th = [a, b, cc].map((q) => stackRhaAt(mesh, f, armor, stack, mats, sub(q, off)));
            const cols = tmode === 'thickness' ? th.map((t) => heat((t - state.range[0]) / (state.range[1] - state.range[0]))) : [c, c, c];
            dl.triV([a, b, cc], [n, n, n], cols.map((x) => [x[0], x[1], x[2], alpha]), th, xray);
          }
        } else dl.tri(pts[ia], pts[ib], pts[ic], n, c, 0, xray);
      }
      if (stack && tmode !== 'normal') {
        // stacked faces get an inner outline
        const cc = M.faceCentroid(mesh, f).map((v, k) => v + off[k]);
        for (let k = 0; k < pts.length; k++) {
          const a = add(cc, mul(sub(pts[k], cc), 0.86));
          const b = add(cc, mul(sub(pts[(k + 1) % pts.length], cc), 0.86));
          dl.line(add(a, mul(n, 0.004)), add(b, mul(n, 0.004)), [0.4, 0.85, 0.95, 1], 1.4);
        }
      }
    }
    // edges
    const selEdges = state.sel.body === body && state.sel.mode === 'edge' ? new Set(state.sel.items.map(([a, b]) => (a < b ? a + ',' + b : b + ',' + a))) : null;
    for (const [a, b] of M.edges(mesh)) {
      const k = a + ',' + b;
      const hov = state.hover?.kind === 'edge' && state.hover.body === body && state.hover.key === k;
      if (selEdges?.has(k)) dl.line(P(a), P(b), COLORS.sel, 3.2);
      else if (hov) dl.line(P(a), P(b), COLORS.hover, 2.6);
      else dl.line(P(a), P(b), editing && state.sel.mode === 'edge' ? COLORS.edgeHi : xray ? [0.5, 0.55, 0.5, 0.6] : COLORS.edge, editing ? 1.4 : 1.1);
    }
    // vertices
    if (editing && state.sel.mode === 'vertex') {
      const selV = state.sel.body === body ? new Set(state.sel.items) : new Set();
      for (const i of M.usedVertices(mesh)) {
        const hov = state.hover?.kind === 'vertex' && state.hover.body === body && state.hover.id === i;
        dl.point(P(i), selV.has(i) ? COLORS.sel : hov ? COLORS.hover : [0.9, 0.9, 0.85, 1], selV.has(i) ? 10 : hov ? 9 : 7);
      }
    }
    // inner surface of the armour
    if (state.showInner && report?.inner?.[body]?.length) {
      const inner = report.inner[body];
      for (const [a, b] of M.edges(mesh)) dl.line(add(inner[a], off), add(inner[b], off), [0.55, 0.85, 0.95, 0.9], 1);
    }
  }

  // ---- running gear (from the core's report)
  const g = report?.running_gear;
  if (g) {
    for (const side of [1, -1]) {
      const x = side * g.track_x_m;
      const hw = g.track_width_m / 2;
      for (const [z, y, r] of g.stations) dl.cylinder([x - hw * 0.62, y, z], [x + hw * 0.62, y, z], r, COLORS.wheel, 16);
      for (const [z, y, r] of [g.sprocket, g.idler]) dl.cylinder([x - hw * 0.5, y, z], [x + hw * 0.5, y, z], r, [0.28, 0.28, 0.27, 1], 16);
      for (const [z, y, r] of g.rollers) dl.cylinder([x - hw * 0.3, y, z], [x + hw * 0.3, y, z], r, COLORS.wheel, 10);
      const e0 = g.envelope_min;
      const e1 = g.envelope_max;
      const tc = state.issueRefs?.has('tracks') ? COLORS.bad : COLORS.track;
      dl.box([x - hw, 0, e0[2] + 0.25], [x + hw, 0.06, e1[2] - 0.25], tc);
      dl.box([x - hw, e1[1] - 0.06, e0[2] + 0.3], [x + hw, e1[1], e1[2] - 0.3], tc);
    }
  }

  // ---- turret ring, gun, mantlet
  const ring = design.turret_ring;
  if (ring) {
    const rc = state.issueRefs?.has('ring') ? COLORS.bad : COLORS.ring;
    dl.circle(add(ring.position_m, [0, 0.006, 0]), ring.diameter_m / 2, [0, 1, 0], rc, state.step === 'turret' ? 2.6 : 1.6, state.step === 'turret');
  }
  const gm = design.gun_mount;
  if (ring && gm && design.weapons) {
    const t = add(ring.position_m, gm.position_m);
    const gr = report?.gun;
    const cal = design.weapons.caliber_mm;
    const barrel = gr?.barrel_m ?? (cal * design.weapons.length_cal * 0.00086);
    const r = cal * 0.0009 + 0.02;
    const mt = gm.mantlet;
    const m0 = t[2] + mt.offset_m;
    dl.box([t[0] - mt.width_m / 2, t[1] - mt.height_m / 2, m0], [t[0] + mt.width_m / 2, t[1] + mt.height_m / 2, m0 + mt.thickness_mm / 1000], state.issueRefs?.has('gun') ? COLORS.bad : [0.42, 0.46, 0.4, xray ? 0.5 : 1], xray);
    dl.cylinder([t[0], t[1], m0], [t[0], t[1], t[2] + barrel], r, COLORS.gun, 14);
    if (state.step === 'gun' || xray) {
      const [bw, bh, br] = gr?.breech_m || [0.35, 0.33, 0.9];
      const rec = gr?.recoil_m ?? gm.recoil_distance_m;
      const bad = state.issueRefs?.has('gun');
      dl.box([t[0] - bw / 2, t[1] - bh / 2, t[2] - br - 0.05], [t[0] + bw / 2, t[1] + bh / 2, t[2] - 0.05], bad ? COLORS.bad : COLORS.breech);
      dl.boxEdges([t[0] - bw / 2, t[1] - bh / 2, t[2] - br - rec - 0.05], [t[0] + bw / 2, t[1] + bh / 2, t[2] - br - 0.05], COLORS.recoil, 1.6);
      // elevation arc of the breech end
      const cl = gr?.clearance;
      if (cl) {
        const arm = br + rec;
        let prev = null;
        for (let e = -cl.max_depression_deg; e <= cl.max_elevation_deg + 1e-6; e += 1) {
          const a = (e * Math.PI) / 180;
          const p = [t[0], t[1] - arm * Math.sin(a), t[2] - arm * Math.cos(a)];
          if (prev) dl.line(prev, p, COLORS.recoil, 1.4, true);
          prev = p;
        }
      }
      if (cl?.breech_sweep) dl.boxEdges(add(cl.breech_sweep.min, ring.position_m), add(cl.breech_sweep.max, ring.position_m), [0.95, 0.75, 0.3, 0.45], 1);
    }
  }

  // ---- add-on armour
  for (const a of report?.addons || []) {
    const off = bodyOffset(design, a.body);
    const cs = a.corners.map((c) => add(c, off));
    const src = design.addons.find((x) => x.id === a.id);
    let col = (MATERIAL_COLORS[src?.material] || [0.4, 0.45, 0.38]).concat([1]);
    if (a.kind === 'era') col = [0.85, 0.5, 0.2, 1];
    if (state.selectedAddon === a.id) col = mix(col, COLORS.sel, 0.6);
    if (state.issueRefs?.has(`addon:${a.id}`)) col = mix(col, COLORS.bad, 0.6);
    const faces = [[4, 5, 7, 6], [0, 2, 3, 1], [1, 3, 7, 5], [0, 4, 6, 2], [2, 6, 7, 3], [0, 1, 5, 4]];
    for (const f of faces) {
      const q = f.map((k) => cs[k]);
      const n = norm(cross(sub(q[1], q[0]), sub(q[2], q[0])));
      dl.tri(q[0], q[1], q[2], n, col, 0, xray);
      dl.tri(q[0], q[2], q[3], n, col, 0, xray);
    }
    const e = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
    for (const [i, j] of e) dl.line(cs[i], cs[j], COLORS.edge, 1);
  }

  // ---- interior: modules and crew
  const showInterior = xray || state.step === 'interior';
  if (showInterior && report) {
    for (const b of report.interior.boxes) {
      if (b.kind === 'gun_breech') continue;
      const bad = !b.inside || b.collisions.length > 0;
      const base = b.crew ? MODULE_COLORS.crew : MODULE_COLORS[b.kind] || [0.6, 0.6, 0.6];
      let col = bad ? COLORS.bad : base.concat([1]);
      if (state.selectedBox === b.id) col = mix(col, COLORS.sel, 0.45);
      const lo = b.hull_min;
      const hi = b.hull_max;
      if (b.crew) {
        // a simple seated figure inside its box: torso and head
        const cx = (lo[0] + hi[0]) / 2;
        const cz = (lo[2] + hi[2]) / 2;
        const sx = (hi[0] - lo[0]) * 0.32;
        dl.box([cx - sx, lo[1] + 0.05, cz - 0.14], [cx + sx, hi[1] - 0.28, cz + 0.14], col);
        dl.box([cx - 0.11, hi[1] - 0.26, cz - 0.11], [cx + 0.11, hi[1] - 0.04, cz + 0.11], col);
        dl.boxEdges(lo, hi, [col[0], col[1], col[2], 0.9], state.selectedBox === b.id ? 2.4 : 1);
      } else {
        dl.box(lo, hi, col);
        dl.boxEdges(lo, hi, state.selectedBox === b.id ? COLORS.sel : COLORS.edge, state.selectedBox === b.id ? 2.4 : 1);
      }
    }
  }

  // ---- centre of mass and wheel loads
  const sd = ctx.suspDbg;
  if (report && (state.step === 'suspension' || state.step === 'power' || state.viewMode === 'weight')) {
    const c = report.center_of_mass;
    dl.point(c, COLORS.com, 14);
    dl.line(c, [c[0], 0, c[2]], COLORS.com, 2, true);
    for (const s of sd?.wheels ? [] : report.suspension.stations) {
      const x = s.side * (report.running_gear.track_x_m + report.running_gear.track_width_m / 2 + 0.12);
      const h = Math.min(2.5, s.ratio * 1.2);
      dl.line([x, 0.02, s.z], [x, 0.02 + h, s.z], s.ratio > 1 ? COLORS.bad : s.ratio > 0.85 ? [0.95, 0.75, 0.2, 1] : COLORS.ok, 7, true);
    }
  }

  // ---- Suspension Debug Mode: each wheel where the physics put it, the ground's support under
  // it (green, up from below the ground) and each spring's push on the hull at its mount (yellow);
  // one static wheel load is drawn 0.8 m long
  if (sd?.wheels) {
    const k = 0.8 / Math.max(sd.staticKN, 1e-3);
    const arrow = (a, b, col, w) => {
      dl.line(a, b, col, w, true);
      const d = norm(sub(b, a));
      const side = norm(cross(d, [1, 0, 0]));
      const head = Math.min(0.12, len(sub(b, a)) * 0.4);
      dl.line(b, add(add(b, mul(d, -head)), mul(side, head * 0.6)), col, w, true);
      dl.line(b, add(add(b, mul(d, -head)), mul(side, -head * 0.6)), col, w, true);
    };
    for (const w of sd.wheels) {
      const over = w.compPct > 100;
      dl.circle([w.x, w.y, w.z], w.r, [1, 0, 0], !w.grounded ? COLORS.bad : over ? [0.95, 0.75, 0.2, 1] : [0.85, 0.9, 0.8, 1], 2, true);
      if (w.loadT > 0) {
        const l = w.loadT * 9.81 * k;
        arrow(add(w.contact, [0, -l, 0]), w.contact, [0.45, 0.85, 0.45, 1], 3);
      }
    }
    for (const u of sd.units) {
      if (!(u.forceKN > 0)) continue;
      const l = (u.forceKN / u.members) * k;
      arrow(u.mount, add(u.mount, [0, l, 0]), [0.98, 0.82, 0.3, 1], 3);
    }
  }

  // ---- protection map
  if (state.protect && state.step === 'analysis') {
    const pm = state.protect;
    const hs = pm.cell_m * 0.5;
    const u = pm.u;
    const v = pm.v;
    const back = mul(pm.dir, -0.01);
    for (const c of pm.cells) {
      const col = PROTECT_COLORS[c.class];
      const p = add(c.point, back);
      const a = add(add(p, mul(u, -hs)), mul(v, -hs));
      const b = add(add(p, mul(u, hs)), mul(v, -hs));
      const cc = add(add(p, mul(u, hs)), mul(v, hs));
      const d = add(add(p, mul(u, -hs)), mul(v, hs));
      const n = mul(pm.dir, -1);
      dl.tri(a, b, cc, n, col, 0, true);
      dl.tri(a, cc, d, n, col, 0, true);
    }
  }
  return dl;
}

function mix(a, b, k) {
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[3] ?? 1];
}

// ------------------------------------------------------------------ picking

/** Nearest face under the ray over both bodies: {body, id, point, normal, t}. */
export function pickFace(design, o, d, only) {
  let best = null;
  for (const body of ['hull', 'turret']) {
    if (only && body !== only) continue;
    const mesh = body === 'hull' ? design.hull_geometry : design.turret_geometry;
    if (!mesh) continue;
    const off = bodyOffset(design, body);
    const h = M.raycast(mesh, sub(o, off), d);
    if (h && (!best || h.t < best.t)) best = { body, id: h.face, point: add(h.point, off), local: h.point, normal: h.normal, t: h.t };
  }
  return best;
}

function occluded(design, eye, p) {
  const d = sub(p, eye);
  const l = len(d);
  const h = pickFace(design, eye, mul(d, 1 / l));
  return h && h.t < l - 0.02;
}

/** Vertex of `body` near the cursor (CSS px), visible from the camera. */
export function pickVertex(design, body, view, px, py, radius = 11) {
  const mesh = body === 'hull' ? design.hull_geometry : design.turret_geometry;
  if (!mesh) return null;
  const off = bodyOffset(design, body);
  const cam = view.camera();
  let best = null;
  for (const i of M.usedVertices(mesh)) {
    const p = add(mesh.vertices[i], off);
    const [sx, sy, w] = view.toScreen(p, cam);
    if (w <= 0) continue;
    const dpx = Math.hypot(sx - px, sy - py);
    if (dpx > radius) continue;
    const depth = len(sub(p, cam.eye));
    if (!best || dpx + depth * 0.5 < best.score) {
      if (occluded(design, cam.eye, p)) continue;
      best = { id: i, score: dpx + depth * 0.5 };
    }
  }
  return best ? best.id : null;
}

/** Edge of `body` near the cursor. */
export function pickEdge(design, body, view, px, py, radius = 8) {
  const mesh = body === 'hull' ? design.hull_geometry : design.turret_geometry;
  if (!mesh) return null;
  const off = bodyOffset(design, body);
  const cam = view.camera();
  let best = null;
  for (const [a, b] of M.edges(mesh)) {
    const pa = add(mesh.vertices[a], off);
    const pb = add(mesh.vertices[b], off);
    const A = view.toScreen(pa, cam);
    const B = view.toScreen(pb, cam);
    if (A[2] <= 0 || B[2] <= 0) continue;
    const ab = [B[0] - A[0], B[1] - A[1]];
    const l2 = ab[0] * ab[0] + ab[1] * ab[1] || 1;
    const t = Math.max(0, Math.min(1, ((px - A[0]) * ab[0] + (py - A[1]) * ab[1]) / l2));
    const dpx = Math.hypot(A[0] + ab[0] * t - px, A[1] + ab[1] * t - py);
    if (dpx > radius || (best && dpx >= best.d)) continue;
    const mid = add(pa, mul(sub(pb, pa), t));
    if (occluded(design, cam.eye, mid)) continue;
    best = { e: [a, b], d: dpx };
  }
  return best ? best.e : null;
}

/** Module / crew box from the report under the ray. */
export function pickBox(report, o, d) {
  let best = null;
  for (const b of report?.interior?.boxes || []) {
    if (b.kind === 'gun_breech') continue;
    const t = rayBox(o, d, b.hull_min, b.hull_max);
    if (t != null && (!best || t < best.t)) best = { id: b.id, t };
  }
  return best;
}

export function pickAddon(design, report, o, d) {
  let best = null;
  for (const a of report?.addons || []) {
    const off = bodyOffset(design, a.body);
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (const c of a.corners) for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], c[k] + off[k]);
      hi[k] = Math.max(hi[k], c[k] + off[k]);
    }
    const t = rayBox(o, d, lo, hi);
    if (t != null && (!best || t < best.t)) best = { id: a.id, t };
  }
  return best;
}

export function rayBox(o, d, lo, hi) {
  let t0 = 0;
  let t1 = Infinity;
  for (let k = 0; k < 3; k++) {
    if (Math.abs(d[k]) < 1e-12) {
      if (o[k] < lo[k] || o[k] > hi[k]) return null;
      continue;
    }
    let a = (lo[k] - o[k]) / d[k];
    let b = (hi[k] - o[k]) / d[k];
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    if (t0 > t1) return null;
  }
  return t0;
}
