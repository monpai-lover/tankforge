// The ground the vehicles drive on: the relief (relief.js) plus what the tracks have done to it.
//
// Deformation is kept in 16 m chunks of 12.5 cm cells, made when first touched:
//   h: height change (m): ruts pressed into soft ground (negative), the soil pushed up beside them
//   m: marks (0..1): tread marks and skid marks on hard ground, churned soil in the ruts
// Soft ground is any surface with soil data (Bekker): each track contact sinks to the depth its
// pressure gives (terra.sinkage), progressively, so a standing tank settles and a moving one
// leaves a rut; driving in an old rut sinks no further and costs less. Hard ground keeps its
// shape and only takes marks, heavier where the track slips.
import { relief, terrainAt } from './relief.js';
import { sinkage } from '../sim/terra.js';

export const CHUNK = 16;
export const RES = 0.125;
export const N = CHUNK / RES; // cells per chunk side

const key = (cx, cz) => (cx + 50000) * 100000 + (cz + 50000);

export class Terrain {
  /** terrains: {id: terrain def} from terrains.json. extra(x, z): solid things on top (humps). */
  constructor(terrains, extra = null) {
    this.terrains = terrains;
    this.extra = extra;
    this.chunks = new Map();
    this.version = 0;
  }

  surface(x, z) {
    return this.terrains[terrainAt(x, z)] || this.terrains.grass;
  }

  surfaceId(x, z) {
    return terrainAt(x, z);
  }

  /** World height of the ground, ruts included. */
  height(x, z) {
    const r = relief(x, z);
    const e = this.extra ? this.extra(x, z) : 0;
    return e > 0 ? Math.max(r + this.deform(x, z), r + e) : r + this.deform(x, z);
  }

  _chunk(cx, cz, make) {
    const k = key(cx, cz);
    let c = this.chunks.get(k);
    if (!c && make) {
      c = { cx, cz, h: new Float32Array(N * N), m: new Float32Array(N * N), dirty: true, rev: 0 };
      this.chunks.set(k, c);
    }
    return c;
  }

  /** Value of one deformation grid point (global cell indices). */
  _at(field, i, j) {
    const cx = Math.floor(i / N);
    const cz = Math.floor(j / N);
    const c = this.chunks.get(key(cx, cz));
    if (!c) return 0;
    return c[field][(j - cz * N) * N + (i - cx * N)];
  }

  /** Bilinear deformation height at (x, z). */
  deform(x, z) {
    if (this.chunks.size === 0) return 0;
    const fx = x / RES;
    const fz = z / RES;
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const a = this._at('h', i, j);
    const b = this._at('h', i + 1, j);
    const c = this._at('h', i, j + 1);
    const d = this._at('h', i + 1, j + 1);
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  }

  mark(x, z) {
    return this._at('m', Math.round(x / RES), Math.round(z / RES));
  }

  /** Calls fn(chunk, index) for every cell centre inside the oriented rectangle. */
  _cells(cx0, cz0, fx, fz, halfLen, halfWid, fn) {
    const rx = Math.abs(fx) * halfLen + Math.abs(fz) * halfWid;
    const rz = Math.abs(fz) * halfLen + Math.abs(fx) * halfWid;
    const i0 = Math.floor((cx0 - rx) / RES);
    const i1 = Math.ceil((cx0 + rx) / RES);
    const j0 = Math.floor((cz0 - rz) / RES);
    const j1 = Math.ceil((cz0 + rz) / RES);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const dx = i * RES - cx0;
        const dz = j * RES - cz0;
        const along = dx * fx + dz * fz;
        const across = dx * fz - dz * fx;
        if (Math.abs(along) > halfLen || Math.abs(across) > halfWid) continue;
        const ci = Math.floor(i / N);
        const cj = Math.floor(j / N);
        const c = this._chunk(ci, cj, true);
        fn(c, (j - cj * N) * N + (i - ci * N), across);
      }
    }
  }

  /**
   * One track contact pressing on the ground: at (x, z), the track running along (fx, fz)
   * (unit, horizontal), `width` wide over `length`, carrying `load` N, slipping at `slip` m/s.
   * Returns the depth it pressed in this time (m), for the rolling resistance.
   */
  press(x, z, fx, fz, width, length, load, slip, dt) {
    if (load <= 0) return 0;
    const s = this.surface(x, z);
    const pressure = load / Math.max(width * length, 0.01);
    const soft = !!s.soil;
    const target = soft ? -sinkage(s.soil, pressure, width) : 0;
    let pressed = 0;
    const wear = Math.min(1, (0.6 + 2.5 * Math.min(Math.abs(slip), 2)) * dt);
    const half = width / 2;
    this._cells(x, z, fx, fz, length / 2, half + (soft ? 0.3 : 0), (c, k, across) => {
      const out = Math.abs(across) - half;
      if (out <= 0) {
        if (soft && c.h[k] > target) {
          // the ground gives way over a few tenths of a second, not at once
          const dh = (target - c.h[k]) * Math.min(1, dt * 8);
          c.h[k] += dh;
          pressed = Math.min(pressed, dh);
        }
        // tread marks, heavier where the track slips; churned soil in a rut
        c.m[k] = Math.min(1, Math.max(c.m[k] + wear * (soft ? 2 : 0.35), soft ? 0.55 : 0));
        c.dirty = true;
      } else if (soft) {
        // the soil pushed out of the rut heaps up beside it
        const berm = -target * 0.28 * (1 - out / 0.3);
        if (c.h[k] < berm && c.h[k] >= 0) {
          c.h[k] = Math.max(c.h[k], Math.min(berm, c.h[k] + dt * 0.5));
          c.dirty = true;
        }
      }
    });
    if (pressed < 0) this.version++;
    return -pressed;
  }

  /** Removes every rut and mark. */
  clear() {
    for (const c of this.chunks.values()) {
      c.h.fill(0);
      c.m.fill(0);
      c.dirty = true;
    }
    this.version++;
  }
}
