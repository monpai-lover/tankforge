// What stands on a battle map besides the ground: the water surface over the sea, river and
// lakes, the trees of the forests, and (Normandy) the buildings, bunkers, beach obstacles and the
// capture points' flags. Trees are drawn instanced (two kinds), only those within a few hundred
// metres of the camera, and they go over when a tank drives into them; everything else is one
// static mesh built from the map's objects (battlemap.js), the same boxes the vehicles, shells
// and sight lines meet.
import { GeoBuilder, hexToLinear, IDENTITY } from '../gfx/geo.js';
import { Node, translation, mul, rotY, rotX, rotZ, scaling } from '../gfx/math.js';
import { TREE_ROOT_OFFSET, TREE_FALL_SECONDS, treeFallAngle, FIR_TRUNK, FIR_TIERS, FIR_TIP_RADIUS, BROADLEAF_TRUNK, BROADLEAF_CROWNS } from './treeShapes.js';

const TREE_RANGE = 450; // m from the camera within which trees are drawn
const MAX_TREES = 5000;

/** A faceted blob of foliage: an icosahedron, squashed a little (20 triangles). */
function blob(b, c, r, mat, squash = 0.85) {
  const t = (1 + Math.sqrt(5)) / 2;
  const v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map((p) => {
    const l = Math.hypot(p[0], p[1], p[2]);
    return [c[0] + (p[0] / l) * r, c[1] + (p[1] / l) * r * squash, c[2] + (p[2] / l) * r];
  });
  const f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  for (const [i, j, k] of f) b.tri(IDENTITY, false, v[i], v[k], v[j], mat);
}

/** A fir about 14 m tall (scale 1), standing on its origin. */
function firGeometry() {
  const b = new GeoBuilder();
  const bark = { color: hexToLinear('#4a3a2a'), rough: 0.95, metal: 0 };
  b.cylY(translation(0, FIR_TRUNK[2] / 2, 0), false, ...FIR_TRUNK, 5, bark);
  const greens = ['#24391c', '#2a4220', '#2f4a24', '#35512a'];
  FIR_TIERS.forEach(([y, r, h], i) => {
    const mat = { color: hexToLinear(greens[i % greens.length]), rough: 0.9, metal: 0 };
    b.cylY(translation(0, y + h / 2, 0), false, r, FIR_TIP_RADIUS, h, 8, mat);
  });
  return b.build();
}

/** A broadleaf tree about 11 m tall: a trunk and a lumpy crown. */
function broadleafGeometry() {
  const b = new GeoBuilder();
  const bark = { color: hexToLinear('#53412d'), rough: 0.95, metal: 0 };
  b.cylY(translation(0, BROADLEAF_TRUNK[2] / 2, 0), false, ...BROADLEAF_TRUNK, 5, bark);
  const leaf = (h) => ({ color: hexToLinear(h), rough: 0.88, metal: 0 });
  for (const crown of BROADLEAF_CROWNS) blob(b, crown.center, crown.radius, leaf(crown.color), crown.squash);
  return b.build();
}


// ---------------------------------------------------------------- buildings

const mat = (hex, rough = 0.9, metal = 0) => ({ color: hexToLinear(hex), rough, metal });
// Caen limestone, ochre render, whitewash, grey granite; slate, dark slate, clay tile
const WALLS = ['#cbbf9f', '#b9a888', '#d9d3c3', '#9b927f'].map((h) => mat(h));
const ROOFS = ['#4c5158', '#3a3d43', '#8c4d37'].map((h) => mat(h, 0.75));
const PLINTH = mat('#77705f');
const GLASS = mat('#15181b', 0.25);
const DOOR = mat('#4a3324', 0.8);
const SHUTTER = ['#5f7363', '#6f5640', '#4f5d6d'].map((h) => mat(h, 0.8));
const CONCRETE = mat('#8f8b80', 0.95);
const STEEL = mat('#3b332c', 0.65, 0.45);

/** Windows of one wall: `cols` per storey from 1 m up, the ground floor's middle one a door. */
function windows(b, m, w, storeys, face, door, shutter) {
  const cols = Math.max(1, Math.floor((w - 1.0) / 2.7));
  for (let s = 0; s < storeys; s++) {
    for (let c = 0; c < cols; c++) {
      const x = -w / 2 + ((c + 0.5) * w) / cols;
      const isDoor = door && s === 0 && c === Math.floor(cols / 2);
      const y0 = s * 3.1 + (isDoor ? 0 : 1.0);
      const y1 = s * 3.1 + (isDoor ? 2.3 : 2.45);
      const hw = isDoor ? 0.6 : 0.5;
      face(x - hw, x + hw, y0, y1, isDoor ? DOOR : GLASS);
      if (!isDoor && shutter) {
        face(x - hw - 0.55, x - hw - 0.05, y0, y1, shutter);
        face(x + hw + 0.05, x + hw + 0.55, y0, y1, shutter);
      }
    }
  }
}

/** A house: walls to `h`, a gable or hip roof, windows, a chimney. Front faces local +z. */
function house(b, m, o, wallMat = null) {
  const { w, d, h } = o;
  const wall = wallMat || WALLS[(o.wall || 0) % WALLS.length];
  const roof = ROOFS[(o.roof || 0) % ROOFS.length];
  b.box(mul(m, translation(0, (h - 0.8) / 2, 0)), false, [w, h + 0.8, d], wall);
  b.box(mul(m, translation(0, -0.3, 0)), false, [w + 0.14, 1.2, d + 0.14], PLINTH);
  const rh = d * (o.roof === 2 ? 0.6 : 0.42);
  const ov = 0.35;
  const y0 = h;
  const y1 = h + rh;
  const X = w / 2 + ov;
  const Z = d / 2 + ov;
  if (o.roof === 1) {
    const r = Math.max(0.5, w / 2 - d * 0.42);
    b.quad(m, false, [-X, y0, Z], [X, y0, Z], [r, y1, 0], [-r, y1, 0], roof);
    b.quad(m, false, [X, y0, -Z], [-X, y0, -Z], [-r, y1, 0], [r, y1, 0], roof);
    b.tri(m, false, [X, y0, Z], [X, y0, -Z], [r, y1, 0], roof);
    b.tri(m, false, [-X, y0, -Z], [-X, y0, Z], [-r, y1, 0], roof);
  } else {
    b.quad(m, false, [-X, y0, Z], [X, y0, Z], [X, y1, 0], [-X, y1, 0], roof);
    b.quad(m, false, [X, y0, -Z], [-X, y0, -Z], [-X, y1, 0], [X, y1, 0], roof);
    for (const sx of [-1, 1]) b.tri(m, false, [(sx * w) / 2, y0, d / 2], [(sx * w) / 2, y0, -d / 2], [(sx * w) / 2, y1 - 0.05, 0], wall);
  }
  b.box(mul(m, translation(w / 2 - 0.9, y0 + rh * 0.55, 0)), false, [0.7, rh * 1.1 + 1.0, 1.0], wall);
  const storeys = Math.max(1, Math.round(h / 3.1));
  const shutter = o.wall === 2 || o.wall === 0 ? SHUTTER[(o.roof || 0) % SHUTTER.length] : null;
  const front = (zs) => (x0, x1, a, c, mt) => b.quad(m, false, [x0, a, zs * (d / 2 + 0.03)], [x1, a, zs * (d / 2 + 0.03)], [x1, c, zs * (d / 2 + 0.03)], [x0, c, zs * (d / 2 + 0.03)], mt);
  windows(b, m, w, storeys, front(1), true, shutter);
  windows(b, m, w, storeys, front(-1), false, shutter);
  const side = (xs) => (z0, z1, a, c, mt) => b.quad(m, false, [xs * (w / 2 + 0.03), a, z0], [xs * (w / 2 + 0.03), a, z1], [xs * (w / 2 + 0.03), c, z1], [xs * (w / 2 + 0.03), c, z0], mt);
  if (d > 7) for (const xs of [-1, 1]) windows(b, m, d * 0.6, Math.max(1, storeys - 1), (z0, z1, a, c, mt) => side(xs)(z0, z1, a + 3.1, c + 3.1, mt), false, null);
}

/** The church: a nave (ridge along its length) and a square tower with a slate spire. */
function church(b, m, o) {
  const stone = WALLS[3];
  const nave = mul(m, rotY(Math.PI / 2));
  house(b, nave, { w: o.d, d: o.w, h: o.h, roof: 0, wall: 3 }, stone);
  // tall windows down both sides
  for (const sx of [-1, 1]) {
    for (let k = 0; k < 5; k++) {
      const z = -o.d / 2 + ((k + 0.5) * o.d) / 5;
      const x = sx * (o.w / 2 + 0.04);
      b.quad(m, false, [x, 3.5, z - 0.7], [x, 3.5, z + 0.7], [x, 9.5, z + 0.7], [x, 9.5, z - 0.7], GLASS);
    }
  }
  const tz = o.d / 2 + 3.2;
  const t = mul(m, translation(0, 0, tz));
  b.box(mul(t, translation(0, 9.6, 0)), false, [6.8, 20.4, 6.8], stone);
  b.box(mul(t, translation(0, 19.8, 0)), false, [7.4, 0.5, 7.4], PLINTH);
  for (const [nx, nz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
    const off = 3.43;
    const q = (a, c, y0, y1) => (nz ? [[a, y0, nz * off], [c, y0, nz * off], [c, y1, nz * off], [a, y1, nz * off]] : [[nx * off, y0, a], [nx * off, y0, c], [nx * off, y1, c], [nx * off, y1, a]]);
    b.quad(t, false, ...q(-0.9, 0.9, 15.5, 18.6), GLASS);
    if (nz === 1) b.quad(t, false, ...q(-1.0, 1.0, 0, 3.4), DOOR);
  }
  b.cylY(mul(t, mul(translation(0, 26.0, 0), rotY(Math.PI / 4))), false, 4.9, 0.05, 12, 4, ROOFS[1]);
  b.cylY(mul(t, translation(0, 32.6, 0)), false, 0.06, 0.06, 1.6, 4, STEEL);
}

/** A concrete bunker dug into the dune, its embrasure towards the sea (local +z). */
function bunker(b, m, o) {
  const { w, d, h } = o;
  b.box(mul(m, translation(0, (h - 1.2) / 2, 0)), false, [w, h + 1.2, d], CONCRETE);
  b.box(mul(m, translation(0, h + 0.2, 0.25)), false, [w + 0.8, 0.5, d + 1.3], CONCRETE);
  b.quad(m, false, [-1.6, h - 1.25, d / 2 + 0.03], [1.6, h - 1.25, d / 2 + 0.03], [1.6, h - 0.7, d / 2 + 0.03], [-1.6, h - 0.7, d / 2 + 0.03], GLASS);
  // the wing walls either side of the embrasure
  for (const sx of [-1, 1]) b.box(mul(m, translation(sx * (w / 2 - 0.3), (h - 1.2) / 2, d / 2 + 0.9)), false, [0.6, h + 1.2, 1.8], CONCRETE);
}

/** A matrix whose x axis runs along `dir` (unit), at `pos`. */
function along(dir, pos) {
  const up = Math.abs(dir[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  let u = [dir[1] * up[2] - dir[2] * up[1], dir[2] * up[0] - dir[0] * up[2], dir[0] * up[1] - dir[1] * up[0]];
  const l = Math.hypot(...u);
  u = u.map((x) => x / l);
  const v = [dir[1] * u[2] - dir[2] * u[1], dir[2] * u[0] - dir[0] * u[2], dir[0] * u[1] - dir[1] * u[0]];
  return new Float32Array([...dir, 0, ...v, 0, ...u, 0, ...pos, 1]);
}

/** A Czech hedgehog: three steel beams at right angles, standing on three of their ends. */
const HEDGEHOG_AXES = [
  [1 / Math.SQRT2, 1 / Math.sqrt(3), 1 / Math.sqrt(6)],
  [-1 / Math.SQRT2, 1 / Math.sqrt(3), 1 / Math.sqrt(6)],
  [0, 1 / Math.sqrt(3), -2 / Math.sqrt(6)],
];
function hedgehog(b, m) {
  const L = 2.3;
  for (const a of HEDGEHOG_AXES) b.box(mul(m, along(a, [0, (L / 2) * (1 / Math.sqrt(3)) - 0.05, 0])), false, [L, 0.16, 0.16], STEEL);
}

/** The capture points: a flag on a pole in the middle and stakes round the circle. */
function capturePoint(b, map, p) {
  const white = mat('#e8e4d8', 0.7);
  const pole = mat('#5a5850', 0.5, 0.6);
  const y = map.height(p.x, p.z);
  b.cylY(translation(p.x, y + 4.5, p.z), false, 0.07, 0.05, 9.6, 6, pole);
  b.quad(translation(p.x, y, p.z), false, [0.08, 8.9, 0], [2.6, 8.7, 0.15], [2.6, 7.3, 0.15], [0.08, 7.5, 0], mat('#d9d2bd', 0.85));
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2;
    const x = p.x + Math.sin(a) * p.r;
    const z = p.z + Math.cos(a) * p.r;
    b.box(translation(x, map.height(x, z) + 0.35, z), false, [0.12, 0.9, 0.12], white);
  }
}

/** One static mesh of everything standing on the map (null when there is nothing). */
function objectsGeometry(map) {
  if (!map.objects.length && !map.points.length) return null;
  const b = new GeoBuilder();
  for (const o of map.objects) {
    if (o.kind === 'wall') {
      for (const i of o.boxes) {
        const q = map.boxes[i];
        const m = mul(translation(q.x, q.ground, q.z), rotY(q.yaw));
        b.box(mul(m, translation(0, (o.h - 0.4) / 2, 0)), false, [q.hx * 2, o.h + 0.4, q.hz * 2], CONCRETE);
      }
      continue;
    }
    const m = mul(translation(o.x, o.y, o.z), rotY(o.yaw || 0));
    if (o.kind === 'house') house(b, m, o);
    else if (o.kind === 'church') church(b, m, o);
    else if (o.kind === 'bunker') bunker(b, m, o);
    else if (o.kind === 'hedgehog') hedgehog(b, m);
  }
  for (const p of map.points) capturePoint(b, map, p);
  return b.build();
}

export function buildMapWorld(renderer, map) {
  const root = new Node('mapworld');

  // the water surface: one big sheet at the water level, blended over the beds
  const gb = new GeoBuilder();
  const S = 9000;
  const y = map.waterLevel;
  gb.quad(IDENTITY, false, [-S, y, -S], [S, y, -S], [S, y, S], [-S, y, S], { color: [0.02, 0.05, 0.06], rough: 0.05, metal: 0 });
  const water = root.add(new Node('water'));
  water.mesh = renderer.mesh(gb.build());
  water.kind = 7;
  water.castShadow = false;

  // buildings and the rest: one static mesh
  const og = objectsGeometry(map);
  if (og) {
    const node = root.add(new Node('buildings'));
    node.mesh = renderer.mesh(og);
    node.kind = 11;
    node.castShadow = true;
  }

  // trees, two instanced meshes
  const kinds = [firGeometry(), broadleafGeometry()].map((g) => {
    const node = root.add(new Node('trees'));
    node.mesh = renderer.instancedMesh(g, MAX_TREES);
    node.kind = 8;
    node.castShadow = true;
    return { node, buf: new Float32Array(MAX_TREES * 16), n: 0 };
  });
  const state = { cx: Infinity, cz: Infinity, dirty: true, falling: new Set() };

  const treeMatrix = (t) => {
    let m = mul(translation(t.x, t.y + TREE_ROOT_OFFSET, t.z), rotY(t.rot));
    if (t.fall > 0) {
      // a fallen tree pivots about its foot, away from what pushed it
      const a = treeFallAngle(t.fall);
      m = mul(translation(t.x, t.y + TREE_ROOT_OFFSET, t.z), mul(rotY(t.fallDir), mul(rotX(a), rotY(t.rot - t.fallDir))));
    }
    return mul(m, scaling(t.s, t.s, t.s));
  };

  /** Rebuilds the instance lists around the camera when it has moved far enough (or a tree fell). */
  const update = (cx, cz, dt) => {
    for (const i of state.falling) {
      const t = map.trees[i];
      t.fall = Math.min(1, t.fall + dt / TREE_FALL_SECONDS);
      if (t.fall >= 1) state.falling.delete(i);
      state.dirty = true;
    }
    if (!state.dirty && (cx - state.cx) ** 2 + (cz - state.cz) ** 2 < 30 * 30) return;
    state.cx = cx;
    state.cz = cz;
    state.dirty = false;
    for (const k of kinds) k.n = 0;
    const near = map.treesNear(cx, cz, TREE_RANGE);
    // nearest first, so a full list drops the far ones
    near.sort((a, b) => (map.trees[a].x - cx) ** 2 + (map.trees[a].z - cz) ** 2 - ((map.trees[b].x - cx) ** 2 + (map.trees[b].z - cz) ** 2));
    for (const i of near) {
      const t = map.trees[i];
      const k = kinds[t.kind];
      if (k.n >= MAX_TREES) continue;
      k.buf.set(treeMatrix(t), k.n * 16);
      k.n++;
    }
    for (const k of kinds) renderer.setInstances(k.node.mesh, k.buf, k.n);
  };

  /**
   * Knocks over the trees a vehicle runs into. hull: {x, z, heading, halfW, halfL, vx, vz}.
   * Returns how many fell (each one costs the vehicle a little momentum).
   */
  const collide = (hull) => {
    let n = 0;
    const c = Math.cos(hull.heading);
    const s = Math.sin(hull.heading);
    for (const i of map.treesNear(hull.x, hull.z, Math.hypot(hull.halfW, hull.halfL) + 1.5)) {
      const t = map.trees[i];
      if (t.fall > 0) continue;
      const dx = t.x - hull.x;
      const dz = t.z - hull.z;
      const along = dx * s + dz * c;
      const across = dx * c - dz * s;
      if (Math.abs(along) > hull.halfL + 0.35 || Math.abs(across) > hull.halfW + 0.35) continue;
      // it falls the way the vehicle is going, a little off to the side it was hit on
      const v = Math.hypot(hull.vx, hull.vz);
      const dir = v > 0.3 ? Math.atan2(hull.vx, hull.vz) : Math.atan2(dx, dz);
      t.fallDir = dir + Math.sign(across || 1) * 0.25;
      t.fall = 0.001;
      state.falling.add(i);
      state.dirty = true;
      n++;
    }
    return n;
  };

  const standing = () => map.trees.filter((t) => t.fall === 0).length;

  return { root, water, update, collide, standing };
}
