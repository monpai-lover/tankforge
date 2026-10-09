// Missiles, rockets and active protection in a battle. crates/missile flies them (through the
// WebAssembly core offline; the server runs the same code online and sends what happened); this
// file draws them -- the missile with its fins, the motor's flame and smoke, the tracking flare,
// the protection gun's bursts and tracers, bullets striking the missile, air bursts and breaking
// up -- and plays them.
import { Node, rotX, rotY, mul, translation } from '../gfx/math.js';
import { GeoBuilder, hexToLinear } from '../gfx/geo.js';

const G = 9.80665;
const mat = (hex, rough = 0.6, metal = 0.2) => ({ color: hexToLinear(hex), rough, metal });
/** Colours of each missile type: body, fins and bands. */
const LOOK = {
  bgm71a_tow: { body: '#5d6640', fins: '#3a3f2a', band: '#c9a43a', flare: [1.0, 0.95, 0.75] },
  tt250_rocket: { body: '#4b4f4c', fins: '#363a38', band: '#6e7370', flare: [1.0, 0.72, 0.35] },
};

/** A ring of points round the y axis at height y (wound the way GeoBuilder.loft wants). */
function ring(r, y, n = 16) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = -(i / n) * 2 * Math.PI;
    out.push([r * Math.cos(a), y, r * Math.sin(a)]);
  }
  return out;
}

/**
 * The missile's body as a mesh along +z (nose forward): a lofted body from its radius profile,
 * the fins, and a band. Built along +y and turned onto +z.
 */
function missileGeometry(def) {
  const L = def.length_m;
  const r = def.caliber_mm / 2000;
  const look = LOOK[def.id] || LOOK.bgm71a_tow;
  const body = mat(look.body, 0.55, 0.25);
  const fins = mat(look.fins, 0.6, 0.3);
  const band = mat(look.band, 0.5, 0.2);
  const b = new GeoBuilder();
  const up = rotX(Math.PI / 2); // +y onto +z
  const h = L / 2;
  // radius profile tail -> nose; a rocket has a blunt ogive, a missile a short rounded nose
  const prof =
    def.guidance === 'none'
      ? [[-h, r * 0.78], [-h + 0.06, r * 0.92], [-h + 0.14, r], [h - 0.55, r], [h - 0.32, r * 0.93], [h - 0.16, r * 0.74], [h - 0.06, r * 0.42], [h, r * 0.08]]
      : [[-h, r * 0.62], [-h + 0.04, r * 0.85], [-h + 0.08, r], [h - 0.22, r], [h - 0.12, r * 0.88], [h - 0.05, r * 0.6], [h, r * 0.2]];
  b.loft(up, false, prof.map(([y, rr]) => ring(rr, y, 18)), body, 32, [true, true]);
  // a band round the body behind the warhead
  const by = h - L * 0.38;
  b.loft(up, false, [ring(r * 1.012, by - 0.03, 18), ring(r * 1.012, by + 0.03, 18)], band, 10, [false, false]);
  // fins: four at the tail, and for a wire-guided missile four wings amidships
  const span = Math.max(def.span_m / 2, r * 1.4);
  const finSet = (y, chord, outer, t) => {
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2 + Math.PI / 4;
      const mid = (r + outer) / 2;
      // radial: the fin's span (box x) along (cos a, 0, sin a) of the body frame
      const m = mul(up, mul(translation(Math.cos(a) * mid, y, Math.sin(a) * mid), rotY(-a)));
      b.box(m, false, [outer - r, chord, t], fins);
    }
  };
  finSet(-h + 0.09, def.guidance === 'none' ? 0.34 : 0.12, span, 0.008);
  if (def.guidance !== 'none') finSet(-h + L * 0.55, 0.14, span * 0.95, 0.006);
  return b.build();
}

export class Missiles {
  /**
   * core: the WebAssembly core (design/core.js); defs: data.missiles; projectiles: data.projectiles
   * (the warheads); renderer, scene: where the missiles are drawn; fx, sound: effects and audio.
   */
  constructor({ core, defs, projectiles, renderer, scene, fx, sound }) {
    this.core = core;
    this.defs = defs || {};
    this.projectiles = projectiles || {};
    this.renderer = renderer;
    this.scene = scene;
    this.fx = fx;
    this.sound = sound;
    this.meshes = new Map();
    this.nodes = new Map(); // missile id -> {node, def, prev, trailAcc, t}
    this.tracers = [];
    this.aps = new Map(); // owner -> latest state
    this.camPos = [0, 0, 0];
    this.local = true;
  }

  get ready() {
    return !!this.core;
  }

  /** Clears the sky (a new battle): the terrain grid the missiles fly over and the radar sees. */
  reset(terrain = null) {
    for (const v of this.nodes.values()) this._drop(v);
    this.nodes.clear();
    this.tracers.length = 0;
    this.aps.clear();
    if (this.core) this.core.call({ op: 'mw_reset', defs: Object.values(this.defs), terrain });
  }

  launch(def, owner, team, pos, dir, seed, id = null) {
    if (!this.core) return null;
    const r = this.core.call({ op: 'mw_launch', def, owner, team, pos, dir, seed: seed >>> 0, id });
    if (r.id != null) this._launchLook(def, pos, dir);
    return r.id;
  }

  guide(id, owner, sight, aim) {
    if (this.core) this.core.call({ op: 'mw_guide', id, owner, sight, aim });
  }

  /** The missile struck something the world does not know of (a vehicle, a building). */
  end(id) {
    if (this.core) this.core.call({ op: 'mw_end', id });
    const v = this.nodes.get(id);
    if (v) {
      this._drop(v);
      this.nodes.delete(id);
    }
  }

  addAps(owner, team, def, seed) {
    if (this.core) this.core.call({ op: 'mw_aps', owner, team, def, seed: seed >>> 0 });
  }

  setAps(owner, enabled, rateRpm = null, rounds = null) {
    if (this.core) this.core.call({ op: 'mw_aps', owner, enabled, rate_rpm: rateRpm, rounds });
  }

  removeAps(owner) {
    if (this.core) this.core.call({ op: 'mw_aps', owner, remove: true });
    this.aps.delete(owner);
  }

  /** Steps the world (offline) and draws the result. actors: see crates/missile Actor. */
  step(dt, actors) {
    if (!this.core || !(dt > 0)) return { events: [], fired: [], missiles: [], aps: [] };
    const res = this.core.call({ op: 'mw_step', dt, actors });
    this.present(res, dt);
    return res;
  }

  /** Where each missile moved this frame: [{id, owner, team, def, p0, p1, vel}] (for hit tests). */
  segments() {
    const out = [];
    for (const [id, v] of this.nodes) if (v.prev && v.pos) out.push({ id, owner: v.owner, team: v.team, def: v.def.id, p0: v.prev, p1: v.pos, vel: v.vel });
    return out;
  }

  /** Draws a step's result (local, or the server's online). */
  present(res, dt) {
    const seen = new Set();
    for (const m of res.missiles || []) {
      seen.add(m.id);
      let v = this.nodes.get(m.id);
      const def = this.defs[m.def];
      if (!def) continue;
      if (!v) {
        v = { node: this._node(def), def, owner: m.owner, team: m.team, prev: null, pos: m.pos, vel: m.vel, trailAcc: 0, t: 0 };
        this.nodes.set(m.id, v);
      }
      v.prev = v.pos;
      v.pos = m.pos;
      v.vel = m.vel;
      v.motor = m.motor;
      v.guided = m.guided;
      v.hits = m.hits;
      v.t += dt;
      this._pose(v);
      this._trail(v, dt);
    }
    // how they ended, while the missiles are still known
    for (const a of res.aps || []) this.aps.set(a.owner, a);
    this._fired(res.fired || []);
    for (const e of res.events || []) this._event(e);
    for (const [id, v] of this.nodes) {
      if (!seen.has(id)) {
        this._drop(v);
        this.nodes.delete(id);
      }
    }
  }

  /** Tracers in flight: straight lines bent by gravity, drawn as beams. Call every frame. */
  draw(dt, camPos) {
    this.camPos = camPos || this.camPos;
    const fx = this.fx;
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      if (t.life <= 0) {
        this.tracers.splice(i, 1);
        continue;
      }
      const p0 = t.pos.slice();
      t.vel[1] -= G * dt;
      t.pos = [t.pos[0] + t.vel[0] * dt, t.pos[1] + t.vel[1] * dt, t.pos[2] + t.vel[2] * dt];
      const sp = Math.hypot(t.vel[0], t.vel[1], t.vel[2]) || 1;
      const tail = Math.min(sp * 0.03, Math.hypot(t.pos[0] - t.o[0], t.pos[1] - t.o[1], t.pos[2] - t.o[2]));
      const a = [t.pos[0] - (t.vel[0] / sp) * tail, t.pos[1] - (t.vel[1] / sp) * tail, t.pos[2] - (t.vel[2] / sp) * tail];
      const dc = Math.hypot(t.pos[0] - this.camPos[0], t.pos[1] - this.camPos[1], t.pos[2] - this.camPos[2]);
      fx.beam(a, t.pos, 0.018 + dc * 0.0010, [1.0, 0.55, 0.22], 0.95);
      if (p0[1] < -50) t.life = 0;
    }
    // online the server's positions come 20 times a second: carry them on between
    if (!this.local) {
      for (const v of this.nodes.values()) {
        v.pos = [v.pos[0] + v.vel[0] * dt, v.pos[1] + v.vel[1] * dt, v.pos[2] + v.vel[2] * dt];
        this._pose(v);
      }
    }
    // the tracking flare at a missile's tail: it burns all the way so the gunner can follow it
    for (const v of this.nodes.values()) {
      const look = LOOK[v.def.id] || LOOK.bgm71a_tow;
      const d = norm(v.vel);
      const back = v.def.length_m / 2;
      const p = [v.pos[0] - d[0] * back, v.pos[1] - d[1] * back, v.pos[2] - d[2] * back];
      fx.spawn({ pos: p, life: 0.05, size0: v.def.guidance === 'none' ? 0.5 : 0.22, color: look.flare, alpha: 0.9, additive: true });
    }
  }

  // ------------------------------------------------------------------ inside

  _mesh(def) {
    if (!this.meshes.has(def.id)) this.meshes.set(def.id, this.renderer.mesh(missileGeometry(def)));
    return this.meshes.get(def.id);
  }

  _node(def) {
    const n = new Node('missile');
    n.mesh = this._mesh(def);
    n.castShadow = true;
    this.scene.add(n);
    return n;
  }

  _drop(v) {
    this.scene.children = this.scene.children.filter((c) => c !== v.node);
  }

  _pose(v) {
    const n = v.node;
    n.pos = v.pos.slice();
    const sp = Math.hypot(v.vel[0], v.vel[2]);
    n.yaw = Math.atan2(v.vel[0], v.vel[2]);
    n.pitch = -Math.atan2(v.vel[1], sp);
    // a wire-guided missile rolls slowly; a damaged one tumbles a little
    n.roll = v.t * (v.def.guidance === 'none' ? 0.6 : 2.4) + (v.hits ? Math.sin(v.t * 9) * 0.3 * v.hits : 0);
  }

  _trail(v, dt) {
    const fx = this.fx;
    const d = norm(v.vel);
    const back = v.def.length_m / 2;
    const tail = [v.pos[0] - d[0] * back, v.pos[1] - d[1] * back, v.pos[2] - d[2] * back];
    const heavy = v.def.guidance === 'none';
    // the motor's flame while it burns
    if (v.motor) {
      fx.spawn({ pos: tail, vel: [-d[0] * 20, -d[1] * 20, -d[2] * 20], life: 0.06, size0: heavy ? 0.7 : 0.32, size1: heavy ? 0.25 : 0.1, color: [1, 0.68, 0.3], alpha: 1, additive: true });
    }
    // a smoke trail: thick from the motor, thin after burn-out
    v.trailAcc += dt * (v.motor ? 90 : 22) * (v.def.smoke ?? 1);
    const seg = Math.hypot(v.pos[0] - (v.prev || v.pos)[0], v.pos[1] - (v.prev || v.pos)[1], v.pos[2] - (v.prev || v.pos)[2]);
    while (v.trailAcc >= 1) {
      v.trailAcc -= 1;
      const k = Math.random();
      const p = [tail[0] - d[0] * seg * k, tail[1] - d[1] * seg * k, tail[2] - d[2] * seg * k];
      const j = () => (Math.random() - 0.5) * 0.4;
      fx.spawn({ pos: p, vel: [j(), 0.3 + Math.random() * 0.4, j()], life: v.motor ? 2.4 : 1.4, size0: heavy ? 0.6 : 0.25, size1: heavy ? 3.2 : 1.4, color: v.motor ? [0.78, 0.77, 0.74] : [0.6, 0.6, 0.6], alpha: v.motor ? 0.42 : 0.22, drag: 1.2, gravity: -0.15, fadeIn: 0.05 });
    }
  }

  _launchLook(defId, pos, dir) {
    const def = this.defs[defId];
    if (!def) return;
    const heavy = def.guidance === 'none';
    const fx = this.fx;
    // the eject charge and the backblast
    fx.spawn({ pos, life: 0.1, size0: heavy ? 1.6 : 0.9, size1: heavy ? 3.5 : 2, color: [1, 0.8, 0.45], alpha: 1, additive: true });
    for (let i = 0; i < (heavy ? 30 : 16); i++) {
      const s = 2 + Math.random() * (heavy ? 9 : 6);
      const j = () => (Math.random() - 0.5) * 2;
      fx.spawn({ pos, vel: [-dir[0] * s + j(), -dir[1] * s + Math.random(), -dir[2] * s + j()], life: 1.6 + Math.random() * 1.6, size0: heavy ? 0.8 : 0.4, size1: heavy ? 3.6 : 2.2, color: [0.72, 0.7, 0.66], alpha: 0.5, drag: 1.5, gravity: -0.3, fadeIn: 0.04 });
    }
    this.sound.launch(dist(pos, this.camPos), heavy);
  }

  _fired(list) {
    if (!list.length) return;
    const fx = this.fx;
    const flashed = new Set();
    for (const f of list) {
      if (f.tracer) this.tracers.push({ pos: f.pos.slice(), o: f.pos.slice(), vel: f.vel.slice(), life: 1.6 });
      if (!flashed.has(f.aps)) {
        flashed.add(f.aps);
        const d = norm(f.vel);
        fx.mgFlash(f.pos, d, 14.5);
        // the barrel cluster's smoke and the spent cases thrown from the side
        fx.spawn({ pos: f.pos, vel: [d[0] * 2, 0.6, d[2] * 2], life: 0.9, size0: 0.12, size1: 0.6, color: [0.75, 0.74, 0.7], alpha: 0.3, drag: 1.5, gravity: -0.2 });
        for (let k = 0; k < 2; k++) {
          const side = [d[2], 0, -d[0]];
          fx.spawn({ pos: f.pos, vel: [side[0] * 4 + (Math.random() - 0.5), 2 + Math.random() * 2, side[2] * 4 + (Math.random() - 0.5)], life: 0.8, size0: 0.025, color: [0.85, 0.65, 0.3], alpha: 1, gravity: 9.8 });
        }
      }
    }
    while (this.tracers.length > 400) this.tracers.shift();
  }

  _event(e) {
    const fx = this.fx;
    const d = (p) => dist(p, this.camPos);
    switch (e.type) {
      case 'bullet_hit':
        // a round strikes the missile: sparks and torn skin
        for (let i = 0; i < 8; i++) {
          const j = () => (Math.random() - 0.5) * 9;
          fx.spawn({ pos: e.point, vel: [j(), j(), j()], life: 0.25 + Math.random() * 0.2, size0: 0.05, color: [1, 0.85, 0.5], alpha: 1, additive: true, gravity: 6 });
        }
        fx.spawn({ pos: e.point, life: 0.06, size0: 0.4, color: [1, 0.9, 0.7], alpha: 1, additive: true });
        break;
      case 'missile_damaged':
        fx.spawn({ pos: this._posOf(e.missile) || [0, -999, 0], life: 1.2, size0: 0.3, size1: 1.6, color: [0.2, 0.2, 0.2], alpha: 0.6, drag: 1, gravity: -0.4 });
        break;
      case 'intercept': {
        const def = this._defOf(e.missile);
        const kg = def ? this.projectiles[def.warhead]?.explosive_mass_kg || 2 : 2;
        if (e.kind === 'airburst') {
          // the warhead goes off in the air: the shaped charge's jet flash, fireball, fragments
          fx.explosion(e.point, null, kg, false);
          fx.spawn({ pos: e.point, life: 0.08, size0: 3.5, size1: 7, color: [1, 0.95, 0.85], alpha: 1, additive: true });
          this.sound.blast(kg, d(e.point));
        } else {
          // broken up: the motor bursts and the pieces fall
          fx.explosion(e.point, null, Math.min(kg * 0.15, 0.6), false);
          for (let i = 0; i < 14; i++) {
            const j = () => (Math.random() - 0.5) * 12;
            fx.spawn({ pos: e.point, vel: [j(), Math.random() * 6, j()], life: 1.6 + Math.random(), size0: 0.08, size1: 0.06, color: [0.12, 0.12, 0.11], alpha: 1, gravity: 9.8, drag: 0.3 });
          }
          this.sound.blast(0.5, d(e.point));
        }
        break;
      }
      case 'missile_ground': {
        const v = this.nodes.get(e.missile);
        if (v && this.onGround) this.onGround(e.point, v.def);
        break;
      }
      default:
        break;
    }
  }

  _posOf(id) {
    return this.nodes.get(id)?.pos || null;
  }

  _defOf(id) {
    return this.nodes.get(id)?.def || null;
  }
}

function norm(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
function dist(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
