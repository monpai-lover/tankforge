// Test range: terrain zones (shared by the ground shader and the physics terrain lookup)
// and range targets.
import { GeoBuilder, hexToLinear, IDENTITY } from '../gfx/geo.js';
import { Node, translation } from '../gfx/math.js';

import { ZONES, terrainAt, BUMP_HEIGHT, FIELD, fieldHeight, relief, reliefRects, COURSE, activeMap } from './relief.js';

export { ZONES, terrainAt, BUMP_HEIGHT, FIELD, fieldHeight, relief, COURSE };

// Where the selected vehicle stands in the garage, and where the camera starts from (east of it,
// looking west into the open shed, with the afternoon sun over the camera's left shoulder).
export const GARAGE = { x: -46, z: -52, heading: 0.65, camYaw: -Math.PI / 2 - 0.12, camPitch: -0.16 };

export const TERRAIN_LABEL = { road: '道路', mud: '泥地', snow: '雪地', sand: '沙地', dirt: '土路', grass: '草地', gravel: '碎石', wetland: '濕地', water: '水中' };

// display-space colours for dust kicked up on each terrain
export const DUST_COLOR = {
  road: [0.55, 0.53, 0.5],
  mud: [0.24, 0.18, 0.12],
  snow: [0.92, 0.94, 0.96],
  sand: [0.78, 0.68, 0.46],
  dirt: [0.5, 0.4, 0.28],
  grass: [0.46, 0.42, 0.3],
  gravel: [0.58, 0.56, 0.52],
  wetland: [0.22, 0.2, 0.14],
};

// Suspension test course beside the road: rows of half-round humps. The first lane lifts both
// tracks together, the second is staggered left / right so the hull also rolls.
// lane = {x0, x1, z0 (first hump), pitch, count, r (radius), h (height above the ground)}
export const HUMP_LANES = [
  { x0: 9, x1: 17, z0: 30, pitch: 3.2, count: 10, r: 0.6, h: 0.3 },
  { x0: 9, x1: 13, z0: 74, pitch: 3.2, count: 10, r: 0.6, h: 0.3 },
  { x0: 13, x1: 17, z0: 75.6, pitch: 3.2, count: 10, r: 0.6, h: 0.3 },
];

function humpHeight(x, z) {
  for (const l of HUMP_LANES) {
    if (x < l.x0 || x > l.x1) continue;
    const k = Math.round((z - l.z0) / l.pitch);
    if (k < 0 || k >= l.count) continue;
    const d = z - (l.z0 + k * l.pitch);
    const yc = l.h - l.r;
    const under = l.r * l.r - d * d;
    if (under > yc * yc) return yc + Math.sqrt(under);
  }
  return 0;
}

/** Height of the hump lanes above the ground (0 elsewhere): solid objects beside the road. */
export function humpLift(x, z) {
  return humpHeight(x, z);
}

/** The relief plus the humps (ruts are added by Terrain). */
export function groundHeight(x, z) {
  return relief(x, z) + humpHeight(x, z);
}

/** The surface a ray or a shell meets: the ground, or the water over it on a battle map. */
export function surfaceHeight(x, z) {
  const m = activeMap();
  const h = relief(x, z);
  return m ? Math.max(h, m.waterLevel) : h;
}

/** Where the segment p0 -> p1 goes into the ground (the drawn surface), or null. */
export function groundHit(p0, p1, height = relief) {
  const h0 = p0[1] - height(p0[0], p0[2]);
  const h1 = p1[1] - height(p1[0], p1[2]);
  if (h1 > 0) return null;
  const k = h0 / Math.max(h0 - h1, 1e-6);
  const x = p0[0] + (p1[0] - p0[0]) * k;
  const z = p0[2] + (p1[2] - p0[2]) * k;
  return [x, height(x, z), z];
}

/** Distance along a ray to the ground (drawn surface), or Infinity. */
export function groundRay(o, d, max, height = relief) {
  let t = d[1] < -1e-5 ? (o[1] + 0.1) / -d[1] : Infinity;
  // where the ground has relief: march the ray across those boxes
  const slab = (a, da, lo, hi) => {
    if (Math.abs(da) < 1e-9) return a > lo && a < hi ? [0, Infinity] : [Infinity, -Infinity];
    const u = (lo - a) / da;
    const v = (hi - a) / da;
    return [Math.min(u, v), Math.max(u, v)];
  };
  for (const [x0, z0, x1, z1] of reliefRects()) {
    const [ax, bx] = slab(o[0], d[0], x0, x1);
    const [az, bz] = slab(o[2], d[2], z0, z1);
    const enter = Math.max(0, ax, az);
    const leave = Math.min(max, bx, bz, t + 1);
    if (!(enter < leave)) continue;
    let prev = enter;
    let hp = o[1] + d[1] * prev - height(o[0] + d[0] * prev, o[2] + d[2] * prev);
    for (let s = enter + 0.5; s <= leave + 0.5; s += 0.5) {
      const u = Math.min(s, leave);
      const h = o[1] + d[1] * u - height(o[0] + d[0] * u, o[2] + d[2] * u);
      if (h <= 0) {
        t = Math.min(t, prev + (u - prev) * (hp / Math.max(hp - h, 1e-6)));
        break;
      }
      prev = u;
      hp = h;
      if (u >= leave) break;
    }
  }
  // near ground: the plane crossing, settled onto the small waves
  if (t < Infinity && t <= max) {
    for (let i = 0; i < 3; i++) {
      const p = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
      const h = height(p[0], p[2]);
      if (Math.abs(d[1]) < 1e-4) break;
      t += (p[1] - h) / -d[1];
    }
  }
  return t;
}

/**
 * Line offsets of the terrain grid: `fine` m apart within +-inner, then each cell `growth`
 * times the last, out to +-outer.
 */
export function terrainLines(fine, inner, outer, growth) {
  const half = [];
  let x = 0;
  while (x < inner - 1e-6) {
    x += fine;
    half.push(x);
  }
  let step = fine;
  while (x < outer) {
    step *= growth;
    x += step;
    half.push(x);
  }
  return [...half.map((v) => -v).reverse(), 0, ...half];
}

const RANGES = [200, 400, 600, 800, 1000, 1200, 1600, 2000];

function boardTexture(range) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 208;
  const g = c.getContext('2d');
  g.fillStyle = '#e9e6da';
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = '#1b1b1b';
  g.lineWidth = 10;
  g.strokeRect(5, 5, c.width - 10, c.height - 10);
  const cx = c.width / 2;
  const cy = c.height / 2 + 14;
  for (const [r, fill] of [[70, '#1b1b1b'], [52, '#e9e6da'], [34, '#1b1b1b'], [14, '#c9482c']]) {
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fillStyle = fill;
    g.fill();
  }
  g.fillStyle = '#1b1b1b';
  g.font = 'bold 44px sans-serif';
  g.textAlign = 'left';
  g.textBaseline = 'top';
  g.fillText(String(range / 100), 16, 12);
  g.font = 'bold 20px sans-serif';
  g.textAlign = 'right';
  g.fillText('×100 m', c.width - 16, 20);
  return c;
}

function labelTexture(text, bg) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = '#1b1b1b';
  g.lineWidth = 8;
  g.strokeRect(4, 4, c.width - 8, c.height - 8);
  g.fillStyle = '#1b1b1b';
  g.font = 'bold 54px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, c.width / 2, c.height / 2 + 4);
  return c;
}

/** Quad in the XY plane facing -Z (towards the firing line), UV 0..1. */
function boardMesh(renderer, w, h) {
  const b = new GeoBuilder();
  const mat = { color: [1, 1, 1], rough: 0.9, metal: 0 };
  const hw = w / 2;
  const hh = h / 2;
  b.quad(IDENTITY, false, [-hw, -hh, 0], [hw, -hh, 0], [hw, hh, 0], [-hw, hh, 0], mat, undefined, [[0, 0], [1, 0], [1, 1], [0, 1]]);
  return renderer.mesh(b.build());
}

export function buildWorld(renderer) {
  const root = new Node('world');

  // the flat far ground (cut away under the terrain grid) and the terrain grid itself, which
  // follows the camera and is lifted onto the relief and the ruts by the vertex shader
  const gb = new GeoBuilder();
  const S = 9000;
  gb.quad(IDENTITY, false, [-S, 0, -S], [S, 0, -S], [S, 0, S], [-S, 0, S], { color: [0.2, 0.25, 0.1], rough: 1, metal: 0 });
  const ground = root.add(new Node('ground'));
  ground.mesh = renderer.mesh(gb.build());
  ground.kind = 2;
  ground.castShadow = false;
  const terrain = root.add(new Node('terrain'));
  terrain.kind = 2;
  terrain.terrain = true;
  terrain.castShadow = false;
  const grid = { fine: 0, outer: 0, mesh: null, extent: 0 };
  /**
   * Builds the grid for a quality level (fine spacing near the middle), reaching `outer` m from
   * the camera (the range is flat further out; a battle map needs its hills to the horizon).
   */
  const setGrid = (fine, outer = grid.outer || 700) => {
    if (grid.fine === fine && grid.outer === outer) return;
    if (grid.mesh) renderer.freeMesh(grid.mesh);
    const lines = terrainLines(fine, 10, outer, fine < 0.2 ? 1.08 : 1.1);
    grid.mesh = renderer.terrainMesh(lines, lines);
    grid.fine = fine;
    grid.outer = outer;
    grid.extent = lines[lines.length - 1];
    terrain.mesh = grid.mesh;
  };
  setGrid(0.15);
  /** Moves the grid under the camera focus (snapped to its fine spacing so the near ground stays still). */
  const placeGrid = (x, z) => {
    const s2 = grid.fine * 2;
    terrain.pos = [Math.round(x / s2) * s2, 0, Math.round(z / s2) * s2];
    const e = grid.extent - 2;
    renderer.hole = [terrain.pos[0] - e, terrain.pos[2] - e, terrain.pos[0] + e, terrain.pos[2] + e];
  };
  placeGrid(0, 0);

  renderer.zones = ZONES.map((z) => ({ rect: z.rect, color: hexToLinear(z.color), soft: z.soft }));
  renderer.road = ZONES[0].rect;

  const wood = { color: hexToLinear('#5a4630'), rough: 0.9, metal: 0 };
  const targets = [];
  RANGES.forEach((range, i) => {
    const big = range >= 1600 ? 1.6 : range >= 1000 ? 1.25 : 1;
    const w = 3.2 * big;
    const h = 2.6 * big;
    const x = (i % 2 === 0 ? 1 : -1) * (13 + (range >= 1000 ? 6 : 0));
    const y = 0.5 + h / 2;
    const n = root.add(new Node('target_' + range));
    n.pos = [x, y, range];
    n.mesh = boardMesh(renderer, w, h);
    n.kind = 4;
    n.texture = renderer.texture(boardTexture(range));
    const legs = new GeoBuilder();
    for (const sx of [-1, 1]) legs.box(translation(sx * w * 0.38, -h / 2 - 0.25, 0.06), false, [0.14, 0.6, 0.14], wood);
    const ln = n.add(new Node('legs'));
    ln.mesh = renderer.mesh(legs.build());
    targets.push({ range, x, y, z: range, hw: w / 2, hh: h / 2, hits: 0 });
  });

  // name boards beside each terrain patch and at the suspension course
  const sign = (id, label, x, z) => {
    const n = root.add(new Node('sign_' + id));
    n.pos = [x, 1.6, z];
    n.mesh = boardMesh(renderer, 2.6, 1.0);
    n.kind = 4;
    n.texture = renderer.texture(labelTexture(label, '#e9e6da'));
    const legs = new GeoBuilder();
    legs.box(translation(0, -1.05, 0.05), false, [0.12, 1.1, 0.12], wood);
    const ln = n.add(new Node('post'));
    ln.mesh = renderer.mesh(legs.build());
  };
  for (const z of ZONES.slice(1)) {
    if (z.sign === false) continue;
    const r = z.rect;
    sign(z.id, z.label, r[0] < 0 ? r[2] + 3 : r[0] - 3, r[1] - 2);
  }
  sign('humps', '懸吊測試', 18.8, 26);
  sign('course', '懸吊測試場', -66, 296);
  COURSE.lanes.forEach((l, i) => sign('lane' + i, l.label, l.x0 + 5, 304));

  // the humps themselves: concrete half-rounds (the part below ground level is never seen)
  const concrete = { color: hexToLinear('#6f6d66'), rough: 0.95, metal: 0 };
  const hb = new GeoBuilder();
  for (const l of HUMP_LANES) {
    for (let k = 0; k < l.count; k++) {
      hb.cyl(translation((l.x0 + l.x1) / 2, l.h - l.r, l.z0 + k * l.pitch), false, 'x', l.r, l.r, l.x1 - l.x0, 28, concrete);
    }
  }
  const humps = root.add(new Node('humps'));
  humps.mesh = renderer.mesh(hb.build());
  humps.kind = 0;

  buildMotorPool(renderer, root);

  return { root, targets, terrain, ground, setGrid, placeGrid, grid };
}

/** The garage: an open-fronted arched shed with the hard standing in front of it, and yard clutter. */
function buildMotorPool(renderer, root) {
  const R = 12;
  const D = 22;
  const SEG = 26;
  const sheet = { color: hexToLinear('#7d8179'), rough: 0.62, metal: 0.55 };
  const sheetIn = { color: hexToLinear('#5f635c'), rough: 0.75, metal: 0.4 };
  const frame = { color: hexToLinear('#3d4038'), rough: 0.7, metal: 0.5 };
  const b = new GeoBuilder();
  const at = (i, r) => {
    const a = (i / SEG) * Math.PI;
    return [Math.cos(a) * r, Math.sin(a) * r];
  };
  for (let i = 0; i < SEG; i++) {
    const [x0, y0] = at(i, R);
    const [x1, y1] = at(i + 1, R);
    const [u0, v0] = at(i, R - 0.12);
    const [u1, v1] = at(i + 1, R - 0.12);
    // corrugated sheet: every other strip sits a little proud
    const lift = i % 2 ? 1.0 : 1.012;
    b.quad(IDENTITY, false, [x0 * lift, y0 * lift, 0], [x0 * lift, y0 * lift, -D], [x1 * lift, y1 * lift, -D], [x1 * lift, y1 * lift, 0], sheet);
    b.quad(IDENTITY, false, [u0, v0, -D], [u0, v0, 0], [u1, v1, 0], [u1, v1, -D], sheetIn);
    // end wall, inside and out
    b.tri(IDENTITY, false, [0, 0, -D + 0.05], [u0, v0, -D + 0.05], [u1, v1, -D + 0.05], sheetIn);
    b.tri(IDENTITY, false, [0, 0, -D], [x1, y1, -D], [x0, y0, -D], sheet);
    // front rim
    b.quad(IDENTITY, false, [x0 * 1.02, y0 * 1.02, 0.02], [x1 * 1.02, y1 * 1.02, 0.02], [u1 * 0.99, v1 * 0.99, 0.02], [u0 * 0.99, v0 * 0.99, 0.02], frame);
  }
  // ribs inside, door posts and the half-open sliding doors
  for (const z of [-0.6, -5.8, -11, -16.2, -21.4]) {
    for (let i = 0; i < SEG; i++) {
      const [u0, v0] = at(i, R - 0.13);
      const [u1, v1] = at(i + 1, R - 0.13);
      const [w0, t0] = at(i, R - 0.38);
      const [w1, t1] = at(i + 1, R - 0.38);
      b.quad(IDENTITY, false, [u0, v0, z], [u1, v1, z], [w1, t1, z], [w0, t0, z], frame);
      b.quad(IDENTITY, false, [w0, t0, z], [w1, t1, z], [w1, t1, z - 0.14], [w0, t0, z - 0.14], frame);
    }
  }
  for (const sx of [-1, 1]) {
    b.box(translation(sx * 9.6, 3.6, 0.28), false, [4.0, 7.2, 0.12], sheet);
    b.box(translation(sx * 7.6, 3.6, 0.2), false, [0.18, 7.3, 0.18], frame);
  }
  b.box(translation(0, 7.3, 0.2), false, [15.4, 0.2, 0.22], frame);
  // workbench, shelves and lockers along the walls
  const wood = { color: hexToLinear('#6b5234'), rough: 0.9, metal: 0 };
  const olive = { color: hexToLinear('#4a5236'), rough: 0.8, metal: 0.1 };
  const red = { color: hexToLinear('#7a2f22'), rough: 0.7, metal: 0.2 };
  const steel = { color: hexToLinear('#6a6d70'), rough: 0.45, metal: 0.85 };
  b.box(translation(-9.0, 0.9, -11), false, [1.0, 0.08, 6.0], wood);
  for (const z of [-13.8, -11, -8.2]) b.box(translation(-9.0, 0.44, z), false, [0.9, 0.86, 0.1], frame);
  b.box(translation(-9.9, 1.7, -11), false, [0.3, 1.5, 5.6], olive);
  for (const z of [-5, -6.1, -7.2, -8.3]) b.box(translation(9.4, 1.0, z), false, [0.6, 2.0, 1.0], olive);
  b.box(translation(9.0, 0.5, -14), false, [1.3, 1.0, 2.2], wood);
  b.box(translation(9.0, 1.3, -14.3), false, [1.2, 0.6, 1.4], wood);
  for (const [x, z] of [[6.6, -19.6], [7.4, -19.4], [7.0, -20.3], [-6.8, -20.0], [-7.6, -19.6], [-6.4, -20.6]]) {
    b.cyl(translation(x, 0.45, z), false, 'y', 0.29, 0.29, 0.9, 14, x > 0 ? red : olive);
    b.cyl(translation(x, 0.91, z), false, 'y', 0.3, 0.3, 0.03, 14, steel);
  }
  // overhead crane rail down the middle, with its hoist
  b.box(translation(0, 10.4, -11), false, [0.34, 0.45, 21.5], frame);
  b.box(translation(0, 9.9, -9), false, [0.6, 0.6, 0.9], steel);
  b.cyl(translation(0, 8.4, -9), false, 'y', 0.03, 0.03, 2.4, 6, steel);
  const shed = root.add(new Node('motor_pool_shed'));
  shed.pos = [GARAGE.x - 24, 0, GARAGE.z];
  shed.yaw = Math.PI / 2;
  shed.mesh = renderer.mesh(b.build());
  shed.kind = 0;

  // out on the hard standing, laid out round the vehicle's bay: bay lines, fuel drums,
  // ammunition crates, a row of jerrycans, a tool chest
  const y = new GeoBuilder();
  const paint = { color: hexToLinear('#c9b458'), rough: 0.9, metal: 0 };
  const line = (cx, cz, w, d) => y.box(translation(cx, 0.012, cz), false, [w, 0.006, d], paint);
  line(-2.9, 0.5, 0.14, 12.5);
  line(2.9, 0.5, 0.14, 12.5);
  line(0, -5.75, 5.94, 0.14);
  for (const [dx, dz, c] of [[-5.6, -3.6, olive], [-6.3, -3.2, olive], [-5.9, -4.4, red], [-6.8, -4.0, olive]]) {
    y.cyl(translation(dx, 0.45, dz), false, 'y', 0.29, 0.29, 0.9, 14, c);
    y.cyl(translation(dx, 0.91, dz), false, 'y', 0.3, 0.3, 0.03, 14, steel);
  }
  for (const [dx, dz, h] of [[-5.4, 1.0, 0], [-5.4, 1.6, 0], [-5.4, 1.3, 0.42], [-6.0, 3.0, 0]]) y.box(translation(dx, 0.21 + h, dz), false, [1.1, 0.42, 0.5], wood);
  for (let i = 0; i < 5; i++) y.box(translation(-4.4, 0.24, -1.6 + i * 0.22), false, [0.36, 0.48, 0.16], olive);
  y.box(translation(-6.4, 0.5, -1.2), false, [0.8, 1.0, 1.6], olive);
  const yard = root.add(new Node('motor_pool_yard'));
  yard.pos = [GARAGE.x, 0, GARAGE.z];
  yard.yaw = GARAGE.heading;
  yard.mesh = renderer.mesh(y.build());
  yard.kind = 0;
}

/** Segment p0->p1 against the target boards. Returns {target, point, t} for the nearest hit. */
export function hitTargets(targets, p0, p1) {
  let best = null;
  const dz = p1[2] - p0[2];
  if (Math.abs(dz) < 1e-9) return null;
  for (const tg of targets) {
    const t = (tg.z - p0[2]) / dz;
    if (t < 0 || t > 1) continue;
    const x = p0[0] + (p1[0] - p0[0]) * t;
    const y = p0[1] + (p1[1] - p0[1]) * t;
    if (Math.abs(x - tg.x) <= tg.hw && Math.abs(y - tg.y) <= tg.hh && (!best || t < best.t)) {
      best = { target: tg, point: [x, y, tg.z], t };
    }
  }
  return best;
}
