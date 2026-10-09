// CPU particle system: camera-facing billboards, tracer beams and flat decals. Decals and beams
// go into two vertex arrays (alpha-blended and additive) drawn depth-tested with the scene;
// particles go into two more that the renderer draws as soft particles after the scene is
// resolved: faded where they meet the ground or a hull, smoke billowed by the noise volume and
// lit from the sun's side (the soft-particle and fake-normal ideas are adapted from
// Claude-of-Tanks' MIT fx/particles.ts).
import { cross, sub, norm } from '../gfx/math.js';

/** Two axes across a plate with normal n, each `r` long (for marks on it). */
function perp(n, r) {
  const a = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = norm(cross(n, a));
  return [u[0] * r, u[1] * r, u[2] * r];
}
function perp2(n, r) {
  const a = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = norm(cross(n, a));
  const v = norm(cross(n, u));
  return [v[0] * r, v[1] * r, v[2] * r];
}

const FLOATS = 9; // pos3 uv2 rgba4
export const SOFT_FLOATS = 13; // pos3 uv2 rgba4 + seed, life fraction, size, spare

export class Effects {
  constructor(maxQuads = 1600) {
    this.maxVerts = maxQuads * 6;
    this.alpha = new Float32Array(this.maxVerts * FLOATS);
    this.add = new Float32Array(this.maxVerts * FLOATS);
    this.alphaCount = 0;
    this.addCount = 0;
    this.softAlpha = new Float32Array(this.maxVerts * SOFT_FLOATS);
    this.softAdd = new Float32Array(this.maxVerts * SOFT_FLOATS);
    this.softAlphaCount = 0;
    this.softAddCount = 0;
    this.particles = [];
    this.decals = [];
    this.beams = [];
  }

  spawn(p) {
    if (this.particles.length > 1100) this.particles.shift();
    this.particles.push({
      pos: p.pos.slice(),
      vel: p.vel ? p.vel.slice() : [0, 0, 0],
      age: 0,
      life: p.life,
      size0: p.size0,
      size1: p.size1 ?? p.size0,
      color: p.color,
      alpha: p.alpha ?? 1,
      additive: !!p.additive,
      gravity: p.gravity ?? 0,
      drag: p.drag ?? 0,
      fadeIn: p.fadeIn ?? 0,
      seed: Math.random(),
    });
  }

  /** Persistent flat mark. axisU/axisV span the quad (already scaled to half size). */
  decal(pos, axisU, axisV, color, alpha, group = 'ground', shape = 'round') {
    const max = group === 'ground' ? 60 : group === 'rut' ? 260 : group === 'mg' ? 160 : 80;
    const list = this.decals.filter((d) => d.group === group);
    if (list.length >= max) this.decals.splice(this.decals.indexOf(list[0]), 1);
    this.decals.push({ pos, axisU, axisV, color, alpha, group, shape });
  }

  beam(a, b, halfWidth, color, alpha) {
    this.beams.push({ a, b, halfWidth, color, alpha });
  }

  update(dt) {
    const ps = this.particles;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.age += dt;
      if (p.age >= p.life) {
        ps.splice(i, 1);
        continue;
      }
      const k = Math.exp(-p.drag * dt);
      p.vel[0] *= k;
      p.vel[1] = p.vel[1] * k - p.gravity * dt;
      p.vel[2] *= k;
      p.pos[0] += p.vel[0] * dt;
      p.pos[1] += p.vel[1] * dt;
      p.pos[2] += p.vel[2] * dt;
      if (p.pos[1] < 0.02 && p.gravity > 0) {
        p.pos[1] = 0.02;
        p.vel[1] = 0;
      }
    }
  }

  _quad(buf, count, c0, c1, c2, c3, uvs, color, alpha) {
    if (count + 6 > this.maxVerts) return count;
    const order = [0, 1, 2, 0, 2, 3];
    const cs = [c0, c1, c2, c3];
    let o = count * FLOATS;
    for (const i of order) {
      const c = cs[i];
      buf[o++] = c[0];
      buf[o++] = c[1];
      buf[o++] = c[2];
      buf[o++] = uvs[i][0];
      buf[o++] = uvs[i][1];
      buf[o++] = color[0];
      buf[o++] = color[1];
      buf[o++] = color[2];
      buf[o++] = alpha;
    }
    return count + 6;
  }

  /** One soft-particle quad: corners c0..c3 around the centre, extra = [seed, t, size, 0]. */
  _softQuad(buf, count, cs, color, alpha, extra) {
    if (count + 6 > this.maxVerts) return count;
    const UV = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    let o = count * SOFT_FLOATS;
    for (const i of [0, 1, 2, 0, 2, 3]) {
      const c = cs[i];
      buf[o++] = c[0];
      buf[o++] = c[1];
      buf[o++] = c[2];
      buf[o++] = UV[i][0];
      buf[o++] = UV[i][1];
      buf[o++] = color[0];
      buf[o++] = color[1];
      buf[o++] = color[2];
      buf[o++] = alpha;
      buf[o++] = extra[0];
      buf[o++] = extra[1];
      buf[o++] = extra[2];
      buf[o++] = extra[3];
    }
    return count + 6;
  }

  /** Fills the vertex arrays for this frame. cam: {pos, right, up}. */
  build(cam) {
    this.alphaCount = 0;
    this.addCount = 0;
    this.softAlphaCount = 0;
    this.softAddCount = 0;
    const ROUND = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    // v = 2: the "beam" falloff, soft only across the quad (used for track ruts)
    const SOFT_BOX = [[-1, 2], [1, 2], [1, 2], [-1, 2]];
    for (const d of this.decals) {
      const p = d.pos;
      const u = d.axisU;
      const v = d.axisV;
      this.alphaCount = this._quad(
        this.alpha,
        this.alphaCount,
        [p[0] - u[0] - v[0], p[1] - u[1] - v[1], p[2] - u[2] - v[2]],
        [p[0] + u[0] - v[0], p[1] + u[1] - v[1], p[2] + u[2] - v[2]],
        [p[0] + u[0] + v[0], p[1] + u[1] + v[1], p[2] + u[2] + v[2]],
        [p[0] - u[0] + v[0], p[1] - u[1] + v[1], p[2] - u[2] + v[2]],
        d.shape === 'square' ? SOFT_BOX : ROUND,
        d.color,
        d.alpha,
      );
    }
    const r = cam.right;
    const up = cam.up;
    const extra = [0, 0, 0, 0];
    for (const p of this.particles) {
      const k = p.age / p.life;
      const size = p.size0 + (p.size1 - p.size0) * Math.sqrt(k);
      let a = p.alpha * (1 - k) * (1 - k);
      if (p.fadeIn > 0) a *= Math.min(1, p.age / p.fadeIn);
      const x = p.pos[0];
      const y = p.pos[1];
      const z = p.pos[2];
      // fade particles that are right in front of the lens (gunner sight) instead of whiting it out
      const near = Math.hypot(x - cam.pos[0], y - cam.pos[1], z - cam.pos[2]);
      a *= Math.min(1, Math.max(0.12, (near - 1.5) / 9));
      // each puff turns slowly about the view axis, so the billows never line up
      const ang = p.seed * 6.2832 + (p.seed - 0.5) * 0.7 * p.age;
      const ca = Math.cos(ang) * size;
      const sa = Math.sin(ang) * size;
      const R = [r[0] * ca + up[0] * sa, r[1] * ca + up[1] * sa, r[2] * ca + up[2] * sa];
      const U = [up[0] * ca - r[0] * sa, up[1] * ca - r[1] * sa, up[2] * ca - r[2] * sa];
      const cs = [
        [x - R[0] - U[0], y - R[1] - U[1], z - R[2] - U[2]],
        [x + R[0] - U[0], y + R[1] - U[1], z + R[2] - U[2]],
        [x + R[0] + U[0], y + R[1] + U[1], z + R[2] + U[2]],
        [x - R[0] + U[0], y - R[1] + U[1], z - R[2] + U[2]],
      ];
      extra[0] = p.seed;
      extra[1] = k;
      extra[2] = size;
      if (p.additive) this.softAddCount = this._softQuad(this.softAdd, this.softAddCount, cs, p.color, a, extra);
      else this.softAlphaCount = this._softQuad(this.softAlpha, this.softAlphaCount, cs, p.color, a, extra);
    }
    const BEAM = [[-1, 2], [1, 2], [1, 2], [-1, 2]];
    for (const b of this.beams) {
      const side = norm(cross(sub(b.b, b.a), sub(cam.pos, b.a)));
      const s = [side[0] * b.halfWidth, side[1] * b.halfWidth, side[2] * b.halfWidth];
      this.addCount = this._quad(
        this.add,
        this.addCount,
        [b.a[0] - s[0], b.a[1] - s[1], b.a[2] - s[2]],
        [b.a[0] + s[0], b.a[1] + s[1], b.a[2] + s[2]],
        [b.b[0] + s[0], b.b[1] + s[1], b.b[2] + s[2]],
        [b.b[0] - s[0], b.b[1] - s[1], b.b[2] - s[2]],
        BEAM,
        b.color,
        b.alpha,
      );
    }
    this.beams.length = 0;
  }

  // ------------------------------------------------------------------ presets

  muzzleBlast(pos, dir, caliber, dust, groundY = 0) {
    const s = caliber / 88;
    for (let i = 0; i < 5; i++) {
      this.spawn({ pos: [pos[0] + dir[0] * i * 0.5 * s, pos[1] + dir[1] * i * 0.5 * s, pos[2] + dir[2] * i * 0.5 * s], life: 0.09 + i * 0.012, size0: (1.5 - i * 0.2) * s, size1: (2.2 - i * 0.25) * s, color: [1.0, 0.78, 0.38], alpha: 0.95, additive: true });
    }
    for (let i = 0; i < 22; i++) {
      const sp = 3 + Math.random() * 14;
      const j = () => (Math.random() - 0.5) * 5;
      this.spawn({
        pos: [pos[0] + dir[0] * 0.8, pos[1] + dir[1] * 0.8, pos[2] + dir[2] * 0.8],
        vel: [dir[0] * sp + j(), dir[1] * sp + j() * 0.6 + 0.6, dir[2] * sp + j()],
        life: 1.6 + Math.random() * 1.8,
        size0: 0.5 * s,
        size1: (2.4 + Math.random() * 2) * s,
        color: [0.78, 0.76, 0.72],
        alpha: 0.42,
        drag: 2.6,
        gravity: -0.25,
        fadeIn: 0.05,
      });
    }
    if (dust) {
      // blast lifts dust off the ground under the muzzle
      for (let i = 0; i < 14; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 2 + Math.random() * 5;
        this.spawn({ pos: [pos[0] + Math.cos(a) * 1.5, groundY + 0.15, pos[2] + Math.sin(a) * 1.5], vel: [Math.cos(a) * sp, 0.6 + Math.random(), Math.sin(a) * sp], life: 1.4 + Math.random(), size0: 0.6, size1: 2.6, color: dust, alpha: 0.3, drag: 2.2, fadeIn: 0.08 });
      }
    }
  }

  /** Thin smoke that keeps drifting out of the muzzle for a moment after the shot. */
  muzzleSmoke(pos, dir, caliber) {
    const s = caliber / 88;
    const j = () => (Math.random() - 0.5) * 0.6;
    this.spawn({ pos, vel: [dir[0] * 1.2 + j(), 0.5 + Math.random() * 0.5, dir[2] * 1.2 + j()], life: 1.1 + Math.random() * 0.9, size0: 0.14 * s, size1: (0.7 + Math.random() * 0.5) * s, color: [0.7, 0.69, 0.66], alpha: 0.22, drag: 1.2, gravity: -0.35, fadeIn: 0.05 });
  }

  groundImpact(pos, dust) {
    const y = pos[1];
    this.spawn({ pos: [pos[0], y + 0.4, pos[2]], life: 0.1, size0: 1.2, size1: 2.2, color: [1, 0.8, 0.45], alpha: 0.8, additive: true });
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1.5 + Math.random() * 6;
      this.spawn({ pos: [pos[0], y + 0.1, pos[2]], vel: [Math.cos(a) * sp, 3 + Math.random() * 9, Math.sin(a) * sp], life: 1.2 + Math.random() * 1.6, size0: 0.35, size1: 1.6 + Math.random() * 1.8, color: dust, alpha: 0.6, drag: 1.5, gravity: 5, fadeIn: 0.03 });
    }
    this.decal([pos[0], y + 0.03, pos[2]], [1.3, 0, 0], [0, 0, 1.3], [0.06, 0.05, 0.04], 0.75, 'ground');
  }

  boardImpact(pos) {
    this.spawn({ pos: [pos[0], pos[1], pos[2] - 0.2], life: 0.12, size0: 0.5, size1: 1.4, color: [1, 0.85, 0.5], alpha: 0.9, additive: true });
    for (let i = 0; i < 12; i++) {
      const j = () => (Math.random() - 0.5) * 7;
      this.spawn({ pos: [pos[0], pos[1], pos[2] - 0.1], vel: [j(), j() + 2, -2 - Math.random() * 5], life: 0.5 + Math.random() * 0.5, size0: 0.07, size1: 0.03, color: [1, 0.7, 0.3], alpha: 1, additive: true, gravity: 9, drag: 0.5 });
    }
    this.decal([pos[0], pos[1], pos[2] - 0.03], [0.2, 0, 0], [0, 0.2, 0], [0.03, 0.03, 0.03], 0.95, 'board');
  }

  /** Machine-gun muzzle flash: a short star of light, a wisp of smoke now and then. */
  mgFlash(pos, dir, caliber) {
    const s = caliber > 10 ? 1.5 : 1;
    this.spawn({ pos: [pos[0] + dir[0] * 0.12, pos[1] + dir[1] * 0.12, pos[2] + dir[2] * 0.12], life: 0.045, size0: 0.16 * s, size1: 0.3 * s, color: [1.0, 0.8, 0.42], alpha: 0.95, additive: true });
    if (Math.random() < 0.3) {
      const j = () => (Math.random() - 0.5) * 0.8;
      this.spawn({ pos: pos.slice(), vel: [dir[0] * 2 + j(), 0.5 + Math.random() * 0.4, dir[2] * 2 + j()], life: 0.7 + Math.random() * 0.5, size0: 0.08 * s, size1: 0.45 * s, color: [0.72, 0.71, 0.68], alpha: 0.16, drag: 2.2, gravity: -0.3, fadeIn: 0.04 });
    }
  }

  /** A bullet striking the ground: a spurt of dirt and a small scar. */
  bulletGround(pos, dust, heavy) {
    const k = heavy ? 1.6 : 1;
    for (let i = 0; i < 3; i++) {
      const j = () => (Math.random() - 0.5) * 1.6;
      this.spawn({ pos: [pos[0], pos[1] + 0.05, pos[2]], vel: [j(), 1.6 + Math.random() * 2.4 * k, j()], life: 0.5 + Math.random() * 0.5, size0: 0.08 * k, size1: (0.5 + Math.random() * 0.4) * k, color: dust, alpha: 0.5, drag: 2.4, gravity: 3, fadeIn: 0.02 });
    }
    this.decal([pos[0], pos[1] + 0.025, pos[2]], [0.12 * k, 0, 0], [0, 0, 0.12 * k], [0.08, 0.07, 0.05], 0.6, 'mg');
  }

  /** A bullet striking a target board: sparks and a small hole. */
  bulletBoard(pos, heavy) {
    const k = heavy ? 1.5 : 1;
    this.spawn({ pos: [pos[0], pos[1], pos[2] - 0.08], life: 0.07, size0: 0.1 * k, size1: 0.3 * k, color: [1, 0.85, 0.5], alpha: 0.9, additive: true });
    for (let i = 0; i < 2; i++) {
      const j = () => (Math.random() - 0.5) * 4;
      this.spawn({ pos: [pos[0], pos[1], pos[2] - 0.05], vel: [j(), j() + 1, -1 - Math.random() * 3], life: 0.25 + Math.random() * 0.25, size0: 0.035, size1: 0.015, color: [1, 0.7, 0.3], alpha: 1, additive: true, gravity: 9, drag: 0.5 });
    }
    this.decal([pos[0], pos[1], pos[2] - 0.02], [0.035 * k, 0, 0], [0, 0.035 * k, 0], [0.03, 0.03, 0.03], 0.95, 'mg');
  }

  /** A shell striking armour: a flash and sparks; a penetration adds a puff of smoke. */
  armorImpact(pos, penetrated) {
    this.spawn({ pos: pos.slice(), life: 0.1, size0: 0.8, size1: 1.6, color: [1, 0.85, 0.5], alpha: 0.95, additive: true });
    for (let i = 0; i < 18; i++) {
      const j = () => (Math.random() - 0.5) * 9;
      this.spawn({ pos: pos.slice(), vel: [j(), j() + 2.5, j()], life: 0.35 + Math.random() * 0.4, size0: 0.06, size1: 0.02, color: [1, 0.72, 0.32], alpha: 1, additive: true, gravity: 9, drag: 0.6 });
    }
    if (penetrated) this.spawn({ pos: pos.slice(), vel: [0, 1.2, 0], life: 2.2, size0: 0.4, size1: 2.6, color: [0.3, 0.29, 0.28], alpha: 0.5, drag: 1.2, gravity: -0.6, fadeIn: 0.05 });
  }

  /** A knocked-out vehicle: fire and a column of black smoke, called every frame while it burns. */
  burning(pos, dt, strength = 1) {
    if (Math.random() < dt * 14 * strength) {
      const j = () => (Math.random() - 0.5) * 1.2;
      this.spawn({ pos: [pos[0] + j(), pos[1], pos[2] + j()], vel: [j() * 0.4, 2.2 + Math.random(), j() * 0.4], life: 4 + Math.random() * 3, size0: 0.8, size1: 5 + Math.random() * 3, color: [0.09, 0.085, 0.08], alpha: 0.55, drag: 0.4, gravity: -0.5, fadeIn: 0.15 });
    }
    // flame: many small tongues licking up out of the hatches, not one ball of light
    const tongues = dt * 26 * strength;
    for (let n = Math.floor(tongues) + (Math.random() < tongues % 1 ? 1 : 0); n > 0; n--) {
      const j = () => (Math.random() - 0.5) * 1.5;
      const hot = Math.random();
      this.spawn({ pos: [pos[0] + j(), pos[1] - 0.35 + Math.random() * 0.3, pos[2] + j()], vel: [j() * 0.5, 2.2 + Math.random() * 1.8, j() * 0.5], life: 0.3 + Math.random() * 0.35, size0: 0.32 + Math.random() * 0.25, size1: 0.7 + Math.random() * 0.4, color: [1, 0.38 + hot * 0.32, 0.1 + hot * 0.16], alpha: 0.5, additive: true, drag: 1.2, gravity: -1.5 });
    }
  }

  // ------------------------------------------------------- by kind of round

  /**
   * A round landing on the ground, by its kind: high explosive throws a fireball, a fountain of
   * earth and dark smoke and leaves a crater; solid shot kicks up a plume and skips dirt; a light
   * sub-calibre core only a puff.
   */
  shellGround(pos, dust, shell) {
    const kind = shell && shell.kind;
    const kg = (shell && shell.explosive_mass_kg) || 0;
    if ((kind === 'he' || kind === 'hesh') && kg > 0.05) return this.explosion(pos, dust, kg, true);
    if (kind === 'heat' || kind === 'heat_fs') return this.explosion(pos, dust, Math.max(0.2, kg), true);
    if (kind === 'apcr' || kind === 'apds' || kind === 'apfsds') {
      for (let i = 0; i < 10; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 1 + Math.random() * 3;
        this.spawn({ pos: [pos[0], pos[1] + 0.1, pos[2]], vel: [Math.cos(a) * sp, 2 + Math.random() * 4, Math.sin(a) * sp], life: 0.8 + Math.random(), size0: 0.2, size1: 1.0, color: dust, alpha: 0.5, drag: 1.8, gravity: 4, fadeIn: 0.03 });
      }
      this.decal([pos[0], pos[1] + 0.03, pos[2]], [0.5, 0, 0], [0, 0, 0.5], [0.07, 0.06, 0.05], 0.6, 'ground');
      return;
    }
    this.groundImpact(pos, dust);
    // a solid shot that grazes skips on, throwing clods
    for (let i = 0; i < 6; i++) {
      const j = () => (Math.random() - 0.5) * 3;
      this.spawn({ pos: [pos[0], pos[1] + 0.2, pos[2]], vel: [j(), 4 + Math.random() * 5, j()], life: 1.2, size0: 0.18, size1: 0.12, color: [0.18, 0.15, 0.11], alpha: 0.95, gravity: 9.8, drag: 0.2 });
    }
  }

  /** A filler going off in the open: flash, fireball, a column of earth or smoke, a crater. */
  explosion(pos, dust, kg, ground = false) {
    const s = Math.min(3, 0.8 + Math.cbrt(Math.max(kg, 0.05)) * 1.3);
    this.spawn({ pos: [pos[0], pos[1] + 0.5 * s, pos[2]], life: 0.14, size0: 1.8 * s, size1: 4.2 * s, color: [1, 0.85, 0.55], alpha: 1, additive: true });
    for (let i = 0; i < 10; i++) {
      const j = () => (Math.random() - 0.5) * 3 * s;
      this.spawn({ pos: [pos[0] + j() * 0.3, pos[1] + 0.4 * s, pos[2] + j() * 0.3], vel: [j(), 1 + Math.random() * 3, j()], life: 0.35 + Math.random() * 0.25, size0: 0.9 * s, size1: 2.4 * s, color: [1, 0.5, 0.15], alpha: 0.9, additive: true, drag: 3 });
    }
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (1 + Math.random() * 5) * s;
      this.spawn({ pos: [pos[0], pos[1] + 0.3, pos[2]], vel: [Math.cos(a) * sp, (4 + Math.random() * 10) * s, Math.sin(a) * sp], life: 1.6 + Math.random() * 2, size0: 0.6 * s, size1: (2.4 + Math.random() * 2) * s, color: ground && dust ? dust : [0.2, 0.19, 0.18], alpha: 0.7, drag: 1.6, gravity: 4.5, fadeIn: 0.03 });
    }
    // dark smoke left hanging
    for (let i = 0; i < 8; i++) {
      const j = () => (Math.random() - 0.5) * 1.6 * s;
      this.spawn({ pos: [pos[0] + j(), pos[1] + 0.8 * s, pos[2] + j()], vel: [j() * 0.3, 0.8 + Math.random(), j() * 0.3], life: 3.5 + Math.random() * 2.5, size0: 1.2 * s, size1: (4 + Math.random() * 2) * s, color: [0.13, 0.125, 0.12], alpha: 0.45, drag: 0.8, gravity: -0.3, fadeIn: 0.2 });
    }
    // fragments: hot streaks
    for (let i = 0; i < 16; i++) {
      const j = () => (Math.random() - 0.5) * 30;
      this.spawn({ pos: [pos[0], pos[1] + 0.4, pos[2]], vel: [j(), Math.random() * 14, j()], life: 0.4 + Math.random() * 0.3, size0: 0.07, size1: 0.03, color: [1, 0.75, 0.35], alpha: 1, additive: true, gravity: 9, drag: 0.4 });
    }
    if (ground) this.decal([pos[0], pos[1] + 0.03, pos[2]], [1.4 * s, 0, 0], [0, 0, 1.4 * s], [0.05, 0.045, 0.04], 0.85, 'ground');
  }

  /**
   * A round striking armour, by its kind and what it did: sparks and a glowing gouge for shot
   * that did not get through, a dark hole and a puff for one that did, a jet's white flash for
   * HEAT, a fireball and a scorch for HE and HESH, and a burst inside (smoke out of the hatches a
   * moment later) for APHE. dir: the round's direction; normal: the plate's (towards the round).
   */
  shellArmor(pos, dir, normal, shell, outcome) {
    const kind = shell && shell.kind;
    const kg = (shell && shell.explosive_mass_kg) || 0;
    const through = outcome === 'penetrated' || outcome === 'overpressure';
    const n = normal || [-dir[0], -dir[1], -dir[2]];
    if (kind === 'he' || kind === 'hesh') {
      this.explosion(pos, null, Math.max(kg, 0.2), false);
      this.decal([pos[0] + n[0] * 0.02, pos[1] + n[1] * 0.02, pos[2] + n[2] * 0.02], perp(n, 0.5 + kg * 0.3), perp2(n, 0.5 + kg * 0.3), [0.03, 0.03, 0.03], 0.9, 'board');
      return;
    }
    if (kind === 'heat' || kind === 'heat_fs') {
      this.spawn({ pos: pos.slice(), life: 0.12, size0: 1.2, size1: 2.6, color: [1, 0.95, 0.85], alpha: 1, additive: true });
      this.explosion(pos, null, Math.max(kg, 0.15) * 0.5, false);
      if (through) {
        // the jet goes on into the hull
        for (let i = 0; i < 10; i++) {
          const k = Math.random() * 1.6;
          this.spawn({ pos: [pos[0] + dir[0] * k, pos[1] + dir[1] * k, pos[2] + dir[2] * k], vel: [dir[0] * 4, dir[1] * 4, dir[2] * 4], life: 0.15, size0: 0.15, size1: 0.05, color: [1, 0.9, 0.7], alpha: 1, additive: true });
        }
      }
      return;
    }
    // kinetic rounds: a white-hot flash and a shower of sparks off the face
    const small = kind === 'apcr' || kind === 'apds' || kind === 'apfsds' || (shell && shell.caliber_mm < 30);
    this.spawn({ pos: pos.slice(), life: 0.08, size0: small ? 0.5 : 0.9, size1: small ? 1.0 : 1.8, color: [1, 0.92, 0.7], alpha: 1, additive: true });
    const sparks = small ? 10 : 22;
    for (let i = 0; i < sparks; i++) {
      const j = () => (Math.random() - 0.5) * 10;
      const out = 3 + Math.random() * 7;
      this.spawn({ pos: pos.slice(), vel: [n[0] * out + j(), n[1] * out + j() + 2, n[2] * out + j()], life: 0.3 + Math.random() * 0.5, size0: 0.06, size1: 0.02, color: [1, 0.72, 0.32], alpha: 1, additive: true, gravity: 9, drag: 0.6 });
    }
    const off = [pos[0] + n[0] * 0.02, pos[1] + n[1] * 0.02, pos[2] + n[2] * 0.02];
    const r = Math.max(0.03, ((shell && shell.caliber_mm) || 75) * 0.0007);
    if (through) {
      this.decal(off, perp(n, r * 1.2), perp2(n, r * 1.2), [0.01, 0.01, 0.01], 0.95, 'board');
      this.spawn({ pos: pos.slice(), vel: [n[0] * 0.6, 1.2, n[2] * 0.6], life: 2.2, size0: 0.4, size1: 2.4, color: [0.3, 0.29, 0.28], alpha: 0.5, drag: 1.2, gravity: -0.6, fadeIn: 0.05 });
      // APHE: the filler goes off inside a moment later -- a flash in the hole, smoke after it
      if (kg > 0.005 && kind !== 'apcr' && kind !== 'apds') {
        this.spawn({ pos: off, vel: [n[0] * 2, 2, n[2] * 2], life: 0.25, size0: 0.4, size1: 1.6, color: [1, 0.55, 0.2], alpha: 0.9, additive: true, fadeIn: 0.08 });
        for (let i = 0; i < 5; i++) this.spawn({ pos: off, vel: [n[0] * 1.5 + (Math.random() - 0.5), 1.5 + Math.random(), n[2] * 1.5 + (Math.random() - 0.5)], life: 2.5 + Math.random(), size0: 0.5, size1: 2.6, color: [0.16, 0.155, 0.15], alpha: 0.5, drag: 1, gravity: -0.6, fadeIn: 0.25 });
      }
    } else {
      // a glowing gouge that fades
      this.decal(off, perp(n, r * 1.6), perp2(n, r * 0.9), [0.28, 0.26, 0.24], 0.9, 'board', 'round');
      this.spawn({ pos: off, life: 0.6, size0: r * 3, size1: r * 2, color: [1, 0.45, 0.15], alpha: 0.8, additive: true });
    }
  }

  /** A round glancing off: it goes on along `dir`, a short tracer and a spray of sparks. */
  ricochet(pos, dir) {
    for (let i = 0; i < 12; i++) {
      const sp = 20 + Math.random() * 30;
      const j = () => (Math.random() - 0.5) * 8;
      this.spawn({ pos: pos.slice(), vel: [dir[0] * sp + j(), dir[1] * sp + j(), dir[2] * sp + j()], life: 0.2 + Math.random() * 0.3, size0: 0.07, size1: 0.03, color: [1, 0.8, 0.45], alpha: 1, additive: true, gravity: 4, drag: 0.4 });
    }
    this.spawn({ pos: pos.slice(), vel: [dir[0] * 120, dir[1] * 120, dir[2] * 120], life: 0.35, size0: 0.25, size1: 0.12, color: [1, 0.7, 0.3], alpha: 1, additive: true });
  }

  /** The ammunition going up: a huge fireball, burning debris, a pillar of smoke. */
  ammoExplosion(pos) {
    this.explosion(pos, null, 6, false);
    for (let i = 0; i < 30; i++) {
      const j = () => (Math.random() - 0.5) * 18;
      this.spawn({ pos: pos.slice(), vel: [j(), 6 + Math.random() * 16, j()], life: 1.5 + Math.random() * 1.5, size0: 0.35, size1: 0.2, color: [1, 0.55, 0.2], alpha: 1, additive: true, gravity: 9.8, drag: 0.2 });
    }
    for (let i = 0; i < 12; i++) {
      const j = () => (Math.random() - 0.5) * 2;
      this.spawn({ pos: [pos[0] + j(), pos[1] + 1, pos[2] + j()], vel: [j(), 4 + Math.random() * 3, j()], life: 7 + Math.random() * 4, size0: 2, size1: 9, color: [0.07, 0.065, 0.06], alpha: 0.6, drag: 0.5, gravity: -0.6, fadeIn: 0.3 });
    }
  }

  trackDust(pos, vel, color, strength) {
    this.spawn({ pos, vel, life: 0.9 + Math.random() * 1.1, size0: 0.35, size1: 1.4 + strength * 1.6, color, alpha: 0.16 + 0.2 * strength, drag: 1.8, gravity: -0.3, fadeIn: 0.1 });
  }
}
