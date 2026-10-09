// A battle map made from a drawing by tools/map-prep.py or tools/map-normandy.py
// (data/maps/<id>/map.json): the ground type of every square, the terrain height of every 4 m
// square, where the teams start, and (Normandy) the painted ground colours, the buildings and
// other things standing on the ground, and the capture points.
//
// The heights are read with the same bilinear filter here and in the terrain shader (MAP_GLSL), so
// the tracks stand on exactly the ground that is drawn. Ground types decide the surface the tracks
// meet (terrains.json), the colour of the ground, where the trees stand and how rough the ground is.
// Water is everything below the water level (0 m): sea, river and lakes; the drawn bridges are
// causeways the map tool raised above it.
//
// Objects (houses, the church, bunkers, beach walls, steel hedgehogs) are solid: each is one or
// more boxes {x, z, yaw, hx, hz, y0, y1} (as sim/tank/obstacles.js takes them; yaw turns the box's
// +z to (sin yaw, cos yaw)) that stop vehicles, shells, bullets and sight lines.
import { roughness } from './relief.js';

export const MAP_CLASSES = ['water', 'sand', 'grass', 'forest', 'road', 'rock', 'farm', 'town'];
/** Ground colour of each type (sRGB), the river and sea bed where under water. */
export const CLASS_COLOR = { water: '#5b5a43', sand: '#c2ad7c', grass: '#7b8b43', forest: '#55672e', road: '#6f5b41', rock: '#7c7763', farm: '#a08a52', town: '#6d6a60' };
const MINIMAP_COLOR = { water: '#2f5a7c', sand: '#cdb98a', grass: '#8a9a55', forest: '#5c7136', road: '#6e5a3f', rock: '#86806a', farm: '#b09a5e', town: '#7a766c' };
/** How far down the water level the ground is still shallow enough to drive through (m). */
export const FORD_DEPTH = 1.3;
/** Size of the objects' parts: [half width, half depth, height] for the fixed kinds. */
const HEDGEHOG = [0.95, 0.95, 1.35];

const rgbOf = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

async function inflate(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Small deterministic random numbers (the trees stand in the same places every time). */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function loadBattleMap(def) {
  const cls = await inflate(def.classes.data);
  const raw = await inflate(def.heights.data);
  const h16 = new Int16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2);
  const heights = new Float32Array(h16.length);
  for (let i = 0; i < h16.length; i++) heights[i] = h16[i] * def.heights.scale_m;
  const colors = def.colors ? await inflate(def.colors.data) : null;
  return new BattleMap(def, cls, heights, colors);
}

export class BattleMap {
  constructor(def, classes, heights, colors = null) {
    this.def = def;
    this.id = def.id;
    this.name = def.name;
    this.size = def.size_m;
    this.x0 = -this.size / 2;
    this.z0 = -this.size / 2;
    this.rect = [this.x0, this.z0, this.x0 + this.size, this.z0 + this.size];
    this.waterLevel = def.water_level_m ?? 0;
    this.cres = def.classes.res;
    this.hres = def.heights.res;
    this.classes = classes;
    this.heights = heights;
    this.surfaces = def.surfaces;
    this.spawns = def.spawns;
    this.grid = def.grid;
    // ground types by name (older maps have no names: the first six)
    this.names = def.classes.names || MAP_CLASSES.slice(0, 6);
    const id = (n) => this.names.indexOf(n);
    this.WATER = id('water');
    this.FOREST = id('forest');
    this.ROAD = id('road');
    this.GRASS = id('grass');
    this.colors = colors;
    this.colRes = colors ? def.colors.res : 0;
    this.points = (def.points || []).map((p) => ({ ...p, y: this.height(p.x, p.z) }));
    this.bucket = 50;
    this._placeObjects(def.objects || []);
    this.trees = this._placeTrees();
  }

  /** Terrain height (m), bilinear between the height samples (texel centres), clamped at the edges. */
  height(x, z) {
    const n = this.hres;
    const u = Math.min(Math.max(((x - this.x0) / this.size) * n - 0.5, 0), n - 1.001);
    const v = Math.min(Math.max(((z - this.z0) / this.size) * n - 0.5, 0), n - 1.001);
    const i = Math.floor(u);
    const j = Math.floor(v);
    const fu = u - i;
    const fv = v - j;
    const h = this.heights;
    const a = h[j * n + i];
    const b = h[j * n + i + 1];
    const c = h[(j + 1) * n + i];
    const d = h[(j + 1) * n + i + 1];
    return (a * (1 - fu) + b * fu) * (1 - fv) + (c * (1 - fu) + d * fu) * fv;
  }

  /** Ground type index at (x, z) (nearest 2 m square). */
  classAt(x, z) {
    const n = this.cres;
    const i = Math.min(Math.max(Math.floor(((x - this.x0) / this.size) * n), 0), n - 1);
    const j = Math.min(Math.max(Math.floor(((z - this.z0) / this.size) * n), 0), n - 1);
    return this.classes[j * n + i];
  }

  /** Terrain id (terrains.json) of the ground at (x, z). */
  surfaceId(x, z) {
    const c = this.classAt(x, z);
    if (c === this.WATER) return this.height(x, z) > -0.6 ? 'mud' : 'wetland';
    return this.surfaces[this.names[c]] || 'grass';
  }

  /** The drawn ground: height plus the small waves of its surface (none under water). */
  relief(x, z) {
    const c = this.classAt(x, z);
    const h = this.height(x, z);
    return c === this.WATER ? h : h + roughness(this.surfaces[this.names[c]] || 'grass', x, z);
  }

  /** Depth of water over the ground at (x, z) (0 on dry land). */
  waterDepth(x, z) {
    return Math.max(0, this.waterLevel - this.height(x, z));
  }

  // ------------------------------------------------------------------- trees

  /**
   * Trees: dense in the forests and hedgerows (one about every 7 m, jittered), a few lone ones in
   * the open, never on roads, sand, fields, in town or water, nor inside a building. Each tree: x, z, ground y, scale, rotation, kind (0 fir,
   * 1 broadleaf). Fallen trees keep the direction they fell in.
   */
  _placeTrees() {
    const r = rng(1234567);
    const out = [];
    const step = 7;
    for (let z = this.z0 + step / 2; z < this.z0 + this.size; z += step) {
      for (let x = this.x0 + step / 2; x < this.x0 + this.size; x += step) {
        const px = x + (r() - 0.5) * step * 0.9;
        const pz = z + (r() - 0.5) * step * 0.9;
        const c = this.classAt(px, pz);
        const roll = r();
        const forest = c === this.FOREST;
        if (!(forest ? roll < 0.86 : c === this.GRASS ? roll < 0.012 : false)) continue;
        // keep the roads clear
        const R = this.ROAD;
        if (this.classAt(px + 3, pz) === R || this.classAt(px - 3, pz) === R || this.classAt(px, pz + 3) === R || this.classAt(px, pz - 3) === R) continue;
        const y = this.height(px, pz);
        if (y < 0.3) continue;
        if (this.boxesNear(px, pz, 2.5).some((i) => this._inBox(this.boxes[i], px, pz, 2.5))) continue;
        out.push({ x: px, z: pz, y, s: 0.75 + r() * 0.55, rot: r() * Math.PI * 2, kind: r() < (forest ? 0.58 : 0.25) ? 0 : 1, fall: 0, fallDir: 0, fallen: false });
      }
    }
    // a 50 m bucket grid for finding the trees near a point
    this.buckets = new Map();
    out.forEach((t, i) => {
      const k = this._key(t.x, t.z);
      if (!this.buckets.has(k)) this.buckets.set(k, []);
      this.buckets.get(k).push(i);
    });
    return out;
  }

  _key(x, z) {
    return Math.floor((x - this.x0) / this.bucket) * 1000 + Math.floor((z - this.z0) / this.bucket);
  }

  /** Indices of the trees within `r` m of (x, z). */
  treesNear(x, z, r) {
    const out = [];
    const b = this.bucket;
    for (let gx = Math.floor((x - r - this.x0) / b); gx <= Math.floor((x + r - this.x0) / b); gx++) {
      for (let gz = Math.floor((z - r - this.z0) / b); gz <= Math.floor((z + r - this.z0) / b); gz++) {
        const list = this.buckets.get(gx * 1000 + gz);
        if (!list) continue;
        for (const i of list) {
          const t = this.trees[i];
          if ((t.x - x) ** 2 + (t.z - z) ** 2 <= r * r) out.push(i);
        }
      }
    }
    return out;
  }

  // ------------------------------------------------------------------- objects

  /**
   * The boxes every object is made of, its ground height, and a bucket grid to find them.
   * this.objects: the map's objects with y (ground under the middle) and their box indices;
   * this.boxes: {x, z, yaw, hx, hz, y0, y1, obj, kind, c, s, r} (c, s: cos and sin of yaw).
   */
  _placeObjects(list) {
    this.objects = [];
    this.boxes = [];
    this.boxBuckets = new Map();
    const box = (o, x, z, yaw, hx, hz, h, sink = 0.6) => {
      // stands on the lowest corner, sunk into the slope on the high side
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      let lo = Infinity;
      let hi = -Infinity;
      for (const [u, w] of [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz], [0, 0]]) {
        const g = this.height(x + u * c + w * s, z - u * s + w * c);
        lo = Math.min(lo, g);
        hi = Math.max(hi, g);
      }
      const b = { x, z, yaw, hx, hz, y0: lo - sink, y1: lo + h, ground: lo, top: hi, obj: this.objects.length, kind: o.kind, c, s, r: Math.hypot(hx, hz) };
      o.boxes.push(this.boxes.length);
      this.boxes.push(b);
      return b;
    };
    for (const src of list) {
      const o = { ...src, y: this.height(src.x, src.z), boxes: [] };
      const yaw = o.yaw || 0;
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      const at = (u, w) => [o.x + u * c + w * s, o.z - u * s + w * c];
      if (o.kind === 'house') {
        // walls to the eaves, the roof's lower half counted in (the ridge is open air for shells)
        const b = box(o, o.x, o.z, yaw, o.w / 2, o.d / 2, o.h + Math.min(o.w, o.d) * 0.2);
        o.y = b.ground;
      } else if (o.kind === 'church') {
        // nave, and the tower at its front (local +z) end
        const nave = box(o, o.x, o.z, yaw, o.w / 2, o.d / 2, o.h + o.w * 0.22);
        const [tx, tz] = at(0, o.d / 2 + 3.2);
        box(o, tx, tz, yaw, 3.4, 3.4, 26);
        o.y = nave.ground;
      } else if (o.kind === 'bunker') {
        const b = box(o, o.x, o.z, yaw, o.w / 2, o.d / 2, o.h, 1.2);
        o.y = b.ground;
      } else if (o.kind === 'wall') {
        // a long wall follows the ground in 10 m pieces
        const n = Math.max(1, Math.round(o.w / 10));
        const len = o.w / n;
        for (let k = 0; k < n; k++) {
          const [x, z] = at(-o.w / 2 + (k + 0.5) * len, 0);
          box(o, x, z, yaw, len / 2, o.d / 2, o.h, 0.4);
        }
      } else if (o.kind === 'hedgehog') {
        const b = box(o, o.x, o.z, yaw, HEDGEHOG[0], HEDGEHOG[1], HEDGEHOG[2], 0.2);
        o.y = b.ground;
      } else continue;
      this.objects.push(o);
    }
    this.boxes.forEach((b, i) => {
      const k = this._key(b.x, b.z);
      if (!this.boxBuckets.has(k)) this.boxBuckets.set(k, []);
      this.boxBuckets.get(k).push(i);
    });
    this.maxBoxR = this.boxes.reduce((m, b) => Math.max(m, b.r), 0);
  }

  /** Indices of the boxes whose middle is within `r` m (plus their own size) of (x, z). */
  boxesNear(x, z, r) {
    const out = [];
    if (!this.boxes.length) return out;
    const b = this.bucket;
    const R = r + this.maxBoxR;
    for (let gx = Math.floor((x - R - this.x0) / b); gx <= Math.floor((x + R - this.x0) / b); gx++) {
      for (let gz = Math.floor((z - R - this.z0) / b); gz <= Math.floor((z + R - this.z0) / b); gz++) {
        const list = this.boxBuckets.get(gx * 1000 + gz);
        if (!list) continue;
        for (const i of list) {
          const q = this.boxes[i];
          if ((q.x - x) ** 2 + (q.z - z) ** 2 <= (r + q.r) ** 2) out.push(i);
        }
      }
    }
    return out;
  }

  /** Is (x, z) within `margin` m of the box's footprint? */
  _inBox(b, x, z, margin = 0) {
    const dx = x - b.x;
    const dz = z - b.z;
    return Math.abs(dx * b.c - dz * b.s) <= b.hx + margin && Math.abs(dx * b.s + dz * b.c) <= b.hz + margin;
  }

  /** The obstacle boxes near (x, z), as the tank's collision takes them. */
  obstaclesNear(x, z, r) {
    return this.boxesNear(x, z, r).map((i) => this.boxes[i]);
  }

  /**
   * The first object box the segment p0 -> p1 enters: {t (0..1), point, normal, box} or null.
   * Shells, bullets and sight lines stop on houses, bunkers and walls.
   */
  segmentHit(p0, p1) {
    if (!this.boxes.length) return null;
    const dx = p1[0] - p0[0];
    const dz = p1[2] - p0[2];
    const len = Math.hypot(dx, dz);
    const mx = (p0[0] + p1[0]) / 2;
    const mz = (p0[2] + p1[2]) / 2;
    let best = null;
    for (const i of this.boxesNear(mx, mz, len / 2 + 1)) {
      const b = this.boxes[i];
      // into the box's frame: u along its x, w along its z
      const lx = (x, z) => (x - b.x) * b.c - (z - b.z) * b.s;
      const lz = (x, z) => (x - b.x) * b.s + (z - b.z) * b.c;
      const o = [lx(p0[0], p0[2]), p0[1], lz(p0[0], p0[2])];
      const d = [dx * b.c - dz * b.s, p1[1] - p0[1], dx * b.s + dz * b.c];
      const lo = [-b.hx, b.y0, -b.hz];
      const hi = [b.hx, b.y1, b.hz];
      let t0 = 0;
      let t1 = 1;
      let axis = -1;
      let sign = 0;
      let ok = true;
      for (let k = 0; k < 3 && ok; k++) {
        if (Math.abs(d[k]) < 1e-9) {
          if (o[k] < lo[k] || o[k] > hi[k]) ok = false;
          continue;
        }
        let a = (lo[k] - o[k]) / d[k];
        let c = (hi[k] - o[k]) / d[k];
        let sg = -1;
        if (a > c) {
          [a, c] = [c, a];
          sg = 1;
        }
        if (a > t0) {
          t0 = a;
          axis = k;
          sign = sg;
        }
        t1 = Math.min(t1, c);
        if (t0 > t1) ok = false;
      }
      if (!ok || axis < 0 || (best && t0 >= best.t)) continue;
      // the face's normal back in the world
      let n;
      if (axis === 1) n = [0, sign, 0];
      else if (axis === 0) n = [sign * b.c, 0, -sign * b.s];
      else n = [sign * b.s, 0, sign * b.c];
      best = { t: t0, point: [p0[0] + (p1[0] - p0[0]) * t0, p0[1] + (p1[1] - p0[1]) * t0, p0[2] + (p1[2] - p0[2]) * t0], normal: n, box: b };
    }
    return best;
  }

  /** The capture point (A, B, C) whose circle holds (x, z), or null. */
  pointAt(x, z) {
    return this.points.find((p) => (p.x - x) ** 2 + (p.z - z) ** 2 <= p.r * p.r) || null;
  }

  /** Grid square name at (x, z), as on the drawing: row letter and column number ("d4"). */
  squareAt(x, z) {
    const g = this.grid;
    const col = Math.min(g.cols - 1, Math.max(0, Math.floor(((x - this.x0) / this.size) * g.cols)));
    const row = Math.min(g.rows - 1, Math.max(0, Math.floor((1 - (z - this.z0) / this.size) * g.rows)));
    return `${g.row_labels[row]}${g.col_labels[col]}`;
  }

  // ------------------------------------------------------------------- pictures

  /**
   * Ground colours for the terrain shader, RGBA8 `res` square: the painted colours where the map
   * has them, else the ground types' colours (alpha: ground type). Returns {res, data}.
   */
  colorTexture() {
    if (this.colors) {
      const n = this.colRes;
      const out = new Uint8Array(n * n * 4);
      for (let k = 0; k < n * n; k++) {
        out[k * 4] = this.colors[k * 3];
        out[k * 4 + 1] = this.colors[k * 3 + 1];
        out[k * 4 + 2] = this.colors[k * 3 + 2];
        out[k * 4 + 3] = 255;
      }
      return { res: n, data: out };
    }
    const n = this.cres;
    const rgb = this.names.map((nm) => rgbOf(CLASS_COLOR[nm] || CLASS_COLOR.grass));
    const out = new Uint8Array(n * n * 4);
    for (let k = 0; k < n * n; k++) {
      const c = this.classes[k];
      out.set(rgb[c], k * 4);
      out[k * 4 + 3] = c * 30;
    }
    return { res: n, data: out };
  }

  /** Painted ground colour at (x, z) (sRGB 0..255), or the ground type's. */
  _mapColor(x, z, palette) {
    if (this.colors) {
      const n = this.colRes;
      const i = Math.min(Math.max(Math.floor(((x - this.x0) / this.size) * n), 0), n - 1);
      const j = Math.min(Math.max(Math.floor(((z - this.z0) / this.size) * n), 0), n - 1);
      const k = (j * n + i) * 3;
      return [this.colors[k], this.colors[k + 1], this.colors[k + 2]];
    }
    return palette[this.classAt(x, z)];
  }

  /**
   * The minimap picture: ground colours with hill shading, the water darker with depth, the
   * buildings, the grid (north up). Returns a canvas `px` square.
   */
  minimapCanvas(px = 512) {
    const c = document.createElement('canvas');
    c.width = c.height = px;
    const g = c.getContext('2d');
    const img = g.createImageData(px, px);
    const palette = this.names.map((nm) => rgbOf(MINIMAP_COLOR[nm] || MINIMAP_COLOR.grass));
    const cell = this.size / px;
    for (let y = 0; y < px; y++) {
      for (let x = 0; x < px; x++) {
        const wx = this.x0 + (x + 0.5) * cell;
        const wz = this.z0 + this.size - (y + 0.5) * cell;
        const cls = this.classAt(wx, wz);
        const h = this.height(wx, wz);
        const col = this._mapColor(wx, wz, palette);
        let k = 1;
        if (cls === this.WATER) k = (this.colors ? 1.05 : 1) - Math.min(0.45, -h * 0.05);
        else {
          const dx = this.height(wx + cell, wz) - this.height(wx - cell, wz);
          const dz = this.height(wx, wz + cell) - this.height(wx, wz - cell);
          k = Math.min(1.25, Math.max(0.65, 1 + (-dx + dz) * 0.18)) * (this.colors ? 1.08 : 1);
        }
        const o = (y * px + x) * 4;
        img.data[o] = col[0] * k;
        img.data[o + 1] = col[1] * k;
        img.data[o + 2] = col[2] * k;
        img.data[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    // buildings, as dark blocks
    const P = (x, z) => [((x - this.x0) / this.size) * px, (1 - (z - this.z0) / this.size) * px];
    for (const b of this.boxes) {
      if (b.kind === 'hedgehog') continue;
      g.fillStyle = b.kind === 'wall' || b.kind === 'bunker' ? 'rgba(70, 68, 60, 0.95)' : 'rgba(58, 50, 44, 0.9)';
      g.beginPath();
      [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([su, sw], k) => {
        const u = su * b.hx;
        const w = sw * b.hz;
        const [x, y] = P(b.x + u * b.c + w * b.s, b.z - u * b.s + w * b.c);
        if (k === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      });
      g.closePath();
      g.fill();
    }
    // the grid, as on the drawing
    const cols = this.grid.cols;
    const rows = this.grid.rows;
    g.strokeStyle = 'rgba(16, 20, 12, 0.55)';
    g.lineWidth = Math.max(1, px / 512);
    for (let i = 1; i < cols; i++) {
      g.beginPath();
      g.moveTo((i * px) / cols, 0);
      g.lineTo((i * px) / cols, px);
      g.stroke();
    }
    for (let j = 1; j < rows; j++) {
      g.beginPath();
      g.moveTo(0, (j * px) / rows);
      g.lineTo(px, (j * px) / rows);
      g.stroke();
    }
    return c;
  }
}
