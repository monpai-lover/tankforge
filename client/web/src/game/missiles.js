// Missiles, rockets and active protection in a battle. crates/missile flies them (through the
// WebAssembly core offline; the server runs the same code online and sends what happened); this
// file draws them -- the missile with its fins, the motor's flame and smoke, the tracking flare,
// the protection gun's bursts and tracers, bullets striking the missile, air bursts and breaking
// up -- and plays them.
import { Node, m4 } from '../gfx/math.js';
import { ProjectileFlightOwner, poseProjectile } from './projectileFlight.js';

const G = 9.80665;
/** Colours of each missile type: body, fins and bands. */
const LOOK = {
  bgm71a_tow: { body: '#5d6640', fins: '#3a3f2a', band: '#c9a43a', flare: [1.0, 0.95, 0.75] },
  tt250_rocket: { body: '#4b4f4c', fins: '#363a38', band: '#6e7370', flare: [1.0, 0.72, 0.35] },
};

export class Missiles {
  /**
   * core: the WebAssembly core (design/core.js); defs: data.missiles; projectiles: data.projectiles
   * (the warheads); renderer, scene: where the missiles are drawn; fx, sound: effects and audio.
   */
  constructor({ core, defs, projectiles, renderer, scene, fx, sound, projectileFlight = null }) {
    this.core = core;
    this.defs = defs || {};
    this.projectiles = projectiles || {};
    this.renderer = renderer;
    this.scene = scene;
    this.fx = fx;
    this.sound = sound;
    this.projectileFlight = projectileFlight || (renderer ? new ProjectileFlightOwner(renderer, {projectiles: this.projectiles, missiles: this.defs}) : null);
    this.bodyLeases = new Map();
    this.nodes = new Map(); // missile id -> {node, def, prev, trailAcc, t}
    this.tracers = [];
    this.aps = new Map(); // owner -> latest state
    this.camPos = [0, 0, 0];
    this.local = true;
    this.acceptedLaunches=new Map();
    this.terminalLaunches=new Map(); // struck sources awaiting this frame's contact delivery
    this.retainedSegments=null;
  }

  get ready() {
    return !!this.core;
  }

  /** Clears the sky (a new battle): the terrain grid the missiles fly over and the radar sees. */
  reset(terrain = null) {
    for(const a of [...this.acceptedLaunches.values(),...this.terminalLaunches.values()])a.lease?.release();
    this.acceptedLaunches.clear();this.terminalLaunches.clear();this.retainedSegments=null;
    for (const v of this.nodes.values()) this._drop(v);
    this.nodes.clear();
    this.tracers.length = 0;
    this.aps.clear();
    if (this.core) this.core.call({ op: 'mw_reset', defs: Object.values(this.defs), terrain });
  }

  launch(def, owner, team, pos, dir, seed, id = null, context = null) {
    if (!this.core) return null;
    const r = this.core.call({ op: 'mw_launch', def, owner, team, pos, dir, seed: seed >>> 0, id });
    if (r.id != null) {
      this._launchLook(def,pos,dir);
      const time_s=this.replayTime?.()??null;
      const source=context&&this.replayAdmission&&Number.isFinite(time_s)?this.replayAdmission.acceptDischarge(owner,{...context,seed:seed>>>0,time_s,origin:pos,direction:dir,flight_trust:'missile_world_segments_legacy_contact'}):null;
      this.acceptedLaunches.get(r.id)?.lease?.release();this.terminalLaunches.get(r.id)?.lease?.release();this.terminalLaunches.delete(r.id);
      const lease=source?this.replayAdmission.retainProjectile(source):null;
      this.acceptedLaunches.set(r.id,{id:r.id,owner,def,source,lease,previous:pos.slice(),distance:0,time_offset:Number.isFinite(r.time_s)?time_s-r.time_s:null});
      if(this.acceptedLaunches.size>256){const oldest=this.acceptedLaunches.keys().next().value;this.acceptedLaunches.get(oldest).lease?.release();this.acceptedLaunches.delete(oldest);}
    }
    return r.id;
  }

  guide(id, owner, sight, aim) {
    if (this.core) this.core.call({ op: 'mw_guide', id, owner, sight, aim });
  }

  /** The missile struck something the world does not know of (a vehicle, a building). */
  end(id) {
    this.acceptedLaunches.get(id)?.lease?.release();this.terminalLaunches.get(id)?.lease?.release();this.terminalLaunches.delete(id);
    this.acceptedLaunches.delete(id);
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

  adoptApsPose(owner, yaw, pitch) {
    return !!(this.core && this.core.call({ op: 'mw_aps_pose', owner, yaw, pitch }).adopted);
  }

  removeAps(owner) {
    if (this.core) this.core.call({ op: 'mw_aps', owner, remove: true });
    this.aps.delete(owner);
  }

  /** Steps the world (offline) and draws the result. actors: see crates/missile Actor. */
  step(dt, actors) {
    for(const a of this.terminalLaunches.values())a.lease?.release();
    this.terminalLaunches.clear();this.retainedSegments=null;
    if (!this.core || !(dt > 0)) return { events: [], fired: [], missiles: [], aps: [] };
    const res = this.core.call({ op: 'mw_step', dt, actors });
    this.retainedSegments=[];
    for(const m of [...(res.missiles||[]),...(res.ended||[])]) {
      const admitted=this.acceptedLaunches.get(m.id);if(!admitted)continue;
      const contact=(res.events||[]).find(e=>e.type==='missile_hit'&&e.missile===m.id);
      const p0=admitted.previous.slice(),p1=(contact?.point||m.pos).slice();
      admitted.distance+=Math.hypot(...p1.map((v,i)=>v-p0[i]));admitted.previous=p1;if(admitted.source)admitted.source.travelled_distance_m=admitted.distance;
      const time_s=Number.isFinite(res.time_s)&&Number.isFinite(admitted.time_offset)?res.time_s+admitted.time_offset:null;
      const source=admitted.source;
      if(source&&Number.isFinite(time_s)) {
        if(!source.flight.length)source.flight.push({time_s:source.launch_time_s,position:p0.slice(),velocity_m_s:m.vel.slice()});
        if(source.flight.length>=256){source.flight.splice(1,1);source.flight_compacted_count=(source.flight_compacted_count||0)+1;}
        source.flight.push({time_s,position:p1.slice(),velocity_m_s:m.vel.slice()});
        if(source.segments.length>=256){source.segments.splice(1,1);source.segment_compacted_count=(source.segment_compacted_count||0)+1;}
        source.segments.push({start_time_s:Math.max(source.launch_time_s,time_s-dt),end_time_s:time_s,from:p0.slice(),to:p1.slice()});
      }
      if(!m.status||m.status==='flying'||m.status==='struck')this.retainedSegments.push({id:m.id,owner:m.owner,team:m.team,def:m.def,p0,p1,vel:m.vel.slice(),contact,source,distance:admitted.distance,time_s});
    }
    try { this.present(res, dt); }
    finally {
      for(const m of res.ended||[]){
        const admitted=this.acceptedLaunches.get(m.id);if(!admitted)continue;
        if(m.status==='struck'&&this.retainedSegments.some(s=>s.id===m.id&&s.contact))this.terminalLaunches.set(m.id,admitted);
        else admitted.lease?.release();
        this.acceptedLaunches.delete(m.id);
      }
      // The preserved legacy core has no terminal snapshots. Its absent missiles
      // must still retire; no contact sweep or timestamp is invented for them.
      const flying=new Set((res.missiles||[]).map(m=>m.id));
      for(const[id,admitted]of this.acceptedLaunches)if(!flying.has(id)){admitted.lease?.release();this.acceptedLaunches.delete(id);}
    }
    return res;
  }

  /** Where each missile moved this frame: [{id, owner, team, def, p0, p1, vel}] (for hit tests). */
  segments() {
    if(this.local&&this.retainedSegments)return this.retainedSegments;
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
      const back = v.def.length_m;
      const p = [v.pos[0] - d[0] * back, v.pos[1] - d[1] * back, v.pos[2] - d[2] * back];
      fx.spawn({ pos: p, life: 0.05, size0: v.def.guidance === 'none' ? 0.5 : 0.22, color: look.flare, alpha: 0.9, additive: true });
    }
  }

  // ------------------------------------------------------------------ inside

  _node(def) {
    if (!this.projectileFlight) return new Node('missile_unavailable');
    const profile = this.projectileFlight.profile(this.projectiles[def.warhead], def), lease = this.projectileFlight.acquire(profile, 'intact', 'missile');
    const n = lease.node; this.bodyLeases.set(n, lease);
    this.scene?.add(n);
    return n;
  }

  _drop(v) {
    this.bodyLeases.get(v.node)?.release(); this.bodyLeases.delete(v.node);
    if(this.scene)this.scene.children = this.scene.children.filter((c) => c !== v.node);
  }

  _pose(v) {
    const n = v.node;
    if(!n.projectileProfile)return;
    // The missile-world point is its recorded legacy contact anchor, now also the display nose.
    poseProjectile(n, v.pos, v.vel, n.projectileProfile);
    if(!n.local)n.local=m4(); n.local.set(n.world);
  }

  _trail(v, dt) {
    const fx = this.fx;
    const d = norm(v.vel);
    const back = v.def.length_m;
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
        if (v && this.onGround) this.onGround(e.point, v.def, v.owner);
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
