// Enemy vehicles at the red team's start points of a battle map. Each is a real vehicle standing
// on the ground on its own suspension (sim/tank), with the armour plates of its data files
// (armor.json): a hit is decided by the plate the shell strikes, its thickness, the angle the
// shell meets it at (normalisation for capped rounds, ricochet past the shell's limit) and what
// the shell can still penetrate at that range. A penetration with an explosive filler knocks the
// vehicle out; solid shot needs two.
import { onPlate } from './plates.js';
import { VehicleSim } from './vehicle.js';
import { penAt } from './hud.js';

const DEG = Math.PI / 180;
const v3 = (p) => (Array.isArray(p) ? p : [p.x, p.y, p.z]);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);

export const RESULT_LABEL = {
  ricochet: '跳彈', nopen: '未擊穿', pen: '擊穿', kill: '擊毀', track: '命中行走裝置', scuttle: '棄車',
  // combat model outcomes (crates/combat)
  stopped: '未擊穿', shattered: '彈體碎裂', penetrated: '擊穿', overpressure: '超壓擊穿', blast: '爆炸', external: '命中外部模組', unarmoured: '命中', miss: '未命中',
};
// how far behind the newest snapshot another player's vehicle is drawn (s, two send intervals and a
// little for jitter), and how far past it it may be carried on by its own velocity when late
const INTERP_DELAY = 0.13;
const EXTRAPOLATE = 0.3;

export class Enemy {
  /**
   * bundle: vehicle files (armor.json included); model: a built tank (gfx/tankmodel); terrain:
   * the ground; at: {x, z, heading}; aimAt: [x, z] where its turret looks.
   */
  constructor(id, bundle, model, terrain, at, aimAt) {
    this.id = id;
    this.bundle = bundle;
    this.model = model;
    this.name = bundle.vehicle.name;
    this.veh = new VehicleSim(bundle, model, terrain);
    this.veh.place(at.x, at.z, at.heading);
    for (let i = 0; i < 240; i++) this.veh.step({ throttle: 0, steer: 0, brake: 1 }, 1 / 120, false);
    const o = this.veh.body.origin();
    this.x = o[0];
    this.z = o[2];
    this.heading = this.veh.body.attitude().heading;
    this.turret = bundle.vehicle.turret;
    // turret laid towards the other team
    this.turretYaw = aimAt ? wrap(Math.atan2(aimAt[0] - this.x, aimAt[1] - this.z) - this.heading) : 0;
    this.plates = (bundle.armor || []).map((p) => ({
      id: p.id,
      zone: p.zone,
      turret: /^turret|mantlet|gun/.test(p.zone || p.id),
      t: p.thickness_mm,
      c: v3(p.center),
      n: v3(p.normal),
      u: v3(p.axis_u),
      hu: p.half_u,
      hv: p.half_v,
      def: p,
    }));
    const h = bundle.vehicle.hull.size_m;
    const ts = bundle.vehicle.turret.size_m || [0, 0, 0];
    this.box = { hw: h[0] / 2, hl: h[2] / 2, top: h[1] + (ts[1] || 0) };
    this.radius = Math.hypot(h[0], h[2]) / 2;
    this.hp = 100;
    this.alive = true;
    this.hits = [];
    this.gunPitch = [];
    this.turretYaws = null;
    // another player's vehicle (online): its state comes from the server, hits are scored there
    this.remote = false;
    // modules and crew (crates/combat): set by useCombat once the core is there
    this.combat = null;
    this.cstate = null;
    this.caps = null;
    this.buf = [];
    this.pose();
  }

  /** A snapshot of the other player's vehicle, received at `at` (seconds). */
  pushState(s, at) {
    if (!s || !Array.isArray(s.pos) || !Array.isArray(s.ex) || !Array.isArray(s.ez)) return;
    // States carry the sender's clock (t): the server's snapshots run on their own beat, so one
    // state can come twice and the next not at all. Repeats are dropped and every state is placed
    // on the sender's timeline (shifted by the smallest delay seen, which follows clock drift),
    // so the vehicle moves as evenly as it was driven, not as unevenly as it arrived.
    if (typeof s.t === 'number') {
      const last = this.buf[this.buf.length - 1];
      if (last && last.s.t != null && s.t <= last.s.t) return;
      const off = at - s.t;
      this.off = this.off == null || off < this.off ? off : this.off + Math.min(off - this.off, 0.002);
      at = s.t + this.off;
    }
    this.buf.push({ at, s });
    if (this.buf.length > 16) this.buf.shift();
  }

  /** Puts the vehicle where its snapshots say it was a moment ago (interpolated between them). */
  follow(now, dt) {
    const buf = this.buf;
    if (!buf.length) return;
    const t = now - INTERP_DELAY;
    let s;
    let i = buf.length - 1;
    while (i > 0 && buf[i - 1].at > t) i--;
    if (t >= buf[buf.length - 1].at) {
      // late: carry the last state on by its own velocity for a little while
      const last = buf[buf.length - 1].s;
      const k = Math.min(t - buf[buf.length - 1].at, EXTRAPOLATE);
      s = { ...last, pos: last.pos.map((p, j) => p + (last.v ? last.v[j] * k : 0)) };
    } else if (i === 0 && t <= buf[0].at) s = buf[0].s;
    else {
      const a = buf[i - 1];
      const b = buf[i];
      const span = Math.max(1e-3, b.at - a.at);
      const k = Math.min(1, Math.max(0, (t - a.at) / span));
      s = mixState(a.s, b.s, k);
      // positions along a cubic through both ends with their velocities: no kinks at the samples
      if (Array.isArray(a.s.v) && Array.isArray(b.s.v) && span < 0.5) {
        const k2 = k * k;
        const k3 = k2 * k;
        const h00 = 2 * k3 - 3 * k2 + 1;
        const h10 = k3 - 2 * k2 + k;
        const h01 = -2 * k3 + 3 * k2;
        const h11 = k3 - k2;
        s.pos = a.s.pos.map((p, j) => h00 * p + h10 * span * a.s.v[j] + h01 * b.s.pos[j] + h11 * span * b.s.v[j]);
      }
    }
    this.veh.applyNet(s, dt);
    const o = this.veh.body.origin();
    this.x = o[0];
    this.z = o[2];
    this.heading = this.veh.body.attitude().heading;
    if (Array.isArray(s.tur) && s.tur.length) {
      this.turretYaws = s.tur.map((x) => x[0]);
      this.gunPitch = s.tur.map((x) => x[1] || 0);
      this.turretYaw = this.turretYaws[0];
    }
    this.pose();
  }

  /** Puts the drawn model where the physics left it. */
  pose() {
    const M = this.model;
    M.root.pos = [this.x, 0, this.z];
    M.root.yaw = this.heading;
    M.body.local = this.veh.hullLocal(this.heading);
    M.turrets.forEach((mt, i) => {
      let yaw = this.turretYaws ? this.turretYaws[i] ?? 0 : i === 0 ? this.turretYaw : mt.node.yaw;
      // a turret riding on another: its yaw comes in the hull frame, its node turns with the other's
      const par = this.loadout?.turrets[i]?.parent;
      if (par != null && this.turretYaws) yaw -= this.turretYaws[par] ?? 0;
      mt.node.yaw = yaw + (this.alive || par != null ? 0 : 0.35);
      for (const mg of mt.guns) mg.node.pitch = this.alive ? -(this.gunPitch[i] || 0) : 0.08;
    });
    const tr = this.remote ? this.veh.t.travel : { 1: 0, [-1]: 0 };
    M.updateRunningGear({ lod: 1, lifts: this.veh.wheelLifts(), travel: { 1: tr[1], [-1]: tr[-1] }, ground: { 1: this.veh.groundUnder(1), [-1]: this.veh.groundUnder(-1) }, wheels: this.veh.wheelPose() });
  }

  /** A plate's corners in the hull frame (turret plates turned with the turret). */
  _plate(p) {
    if (!p.turret || !this.turretYaw) return p;
    const piv = this.turret.position_m;
    const c = Math.cos(this.turretYaw);
    const s = Math.sin(this.turretYaw);
    const rot = (v) => [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
    const rel = sub(p.c, [piv[0], 0, piv[2]]);
    const rc = rot(rel);
    return { ...p, c: [rc[0] + piv[0], rc[1], rc[2] + piv[2]], n: rot(p.n), u: rot(p.u) };
  }

  /**
   * The first plate the segment p0 -> p1 (world) strikes: {plate, point (world), t (0..1 along
   * the segment), local}, or {box: true, t} when it only meets the running gear, or null.
   */
  intersect(p0, p1) {
    const b = this.veh.body;
    // quick reject: nowhere near
    const mid = [(p0[0] + p1[0]) / 2, (p0[2] + p1[2]) / 2];
    if (Math.hypot(mid[0] - this.x, mid[1] - this.z) > this.radius + len(sub(p1, p0)) + 1) return null;
    const a = b.localPoint(p0);
    const e = b.localPoint(p1);
    const d = sub(e, a);
    let best = null;
    for (const raw of this.plates) {
      const p = this._plate(raw);
      const den = dot(d, p.n);
      if (Math.abs(den) < 1e-9) continue;
      const t = dot(sub(p.c, a), p.n) / den;
      if (t < 0 || t > 1 || (best && t >= best.t)) continue;
      const q = [a[0] + d[0] * t, a[1] + d[1] * t, a[2] + d[2] * t];
      const r = sub(q, p.c);
      const vax = cross(p.n, p.u);
      if (!onPlate(p.def, dot(r, p.u), dot(r, vax))) continue;
      best = { plate: p, t, local: q };
    }
    if (best) {
      best.point = [p0[0] + (p1[0] - p0[0]) * best.t, p0[1] + (p1[1] - p0[1]) * best.t, p0[2] + (p1[2] - p0[2]) * best.t];
      return best;
    }
    // the box round the hull and the running gear
    const B = this.box;
    let t0 = 0;
    let t1 = 1;
    const lo = [-B.hw - 0.1, 0, -B.hl - 0.2];
    const hi = [B.hw + 0.1, B.top, B.hl + 0.2];
    for (let k = 0; k < 3; k++) {
      if (Math.abs(d[k]) < 1e-9) {
        if (a[k] < lo[k] || a[k] > hi[k]) return null;
        continue;
      }
      let u = (lo[k] - a[k]) / d[k];
      let v = (hi[k] - a[k]) / d[k];
      if (u > v) [u, v] = [v, u];
      t0 = Math.max(t0, u);
      t1 = Math.min(t1, v);
      if (t0 > t1) return null;
    }
    return { box: true, t: t0, point: [p0[0] + (p1[0] - p0[0]) * t0, p0[1] + (p1[1] - p0[1]) * t0, p0[2] + (p1[2] - p0[2]) * t0] };
  }

  /**
   * What a shell does on striking: dir (world, unit), shell def, distance flown (m).
   * Returns {result, plate, thickness, angle (deg), effective (mm), pen (mm)}.
   */
  resolve(hit, dir, shell, distance) {
    if (hit.box) return { result: 'track', pen: penAt(shell, distance) };
    const p = hit.plate;
    const dl = this.veh.body.localDir(dir);
    const cos = Math.min(1, Math.abs(dot(dl, p.n)) / (len(dl) || 1));
    const angle = Math.acos(cos) / DEG;
    const kinetic = !['he', 'heat', 'heat_fs', 'hesh'].includes(shell.kind);
    const pen = penAt(shell, distance);
    if (kinetic && angle > (shell.ricochet_angle_deg ?? 70)) return { result: 'ricochet', plate: p.id, thickness: p.t, angle, effective: Infinity, pen };
    // capped rounds turn into the plate a little; HEAT and HE meet it as they strike
    const norm = kinetic ? Math.min(angle, shell.normalization_deg ?? 0) : 0;
    const eff = p.t / Math.max(0.05, Math.cos((angle - norm) * DEG));
    if (pen < eff) return { result: 'nopen', plate: p.id, thickness: p.t, angle, effective: eff, pen };
    // another player's vehicle: the server keeps its hit points and says whether this killed it
    if (this.remote) return { result: 'pen', plate: p.id, thickness: p.t, angle, effective: eff, pen };
    const filler = (shell.explosive_mass_kg || 0) > 0.01 || !kinetic;
    this.hp -= filler ? 100 : 55;
    if (this.hp <= 0 && this.alive) {
      this.alive = false;
      this.pose();
      return { result: 'kill', plate: p.id, thickness: p.t, angle, effective: eff, pen };
    }
    return { result: 'pen', plate: p.id, thickness: p.t, angle, effective: eff, pen };
  }
}

/**
 * Plugs a vehicle into the combat model: from now on a hit is resolved against its armour,
 * modules and crew by crates/combat, and it is out when that model says so.
 */
export function useCombat(e, combat, key) {
  const r = combat.fresh(key, e.bundle);
  if (!r) return;
  e.combat = combat;
  e.combatKey = key;
  e.cstate = r.state;
  e.caps = r.caps;
}

/**
 * A shell (or bullet) striking vehicle e: hit from Enemy.intersect, p0 the start of the flight
 * segment, dir its direction (world, unit), speed m/s, distance flown. Returns the combat report
 * (with the hull-space shot it was made from, for the hit camera).
 */
export function combatHit(e, p0, dir, shell, speed, distance, seed) {
  const b = e.veh.body;
  // a point on the flight line a little short of the vehicle, in its own frame
  const o = b.localPoint([p0[0] - dir[0] * 2, p0[1] - dir[1] * 2, p0[2] - dir[2] * 2]);
  const d = b.localDir(dir);
  const shot = { shell, origin: o, dir: d, speed_ms: speed, distance_m: distance, seed, turret_yaw: e.turretYaw || 0 };
  const r = e.combat.shoot(e.combatKey, e.cstate, shot);
  e.cstate = r.state;
  e.caps = r.caps;
  if (r.caps.destroyed && e.alive) {
    e.alive = false;
    e.pose();
  }
  r.shot = shot;
  return r;
}

/** Between two snapshots: positions and speeds blended, the hull's axes turned part way. */
export function mixState(a, b, k) {
  const mix = (x, y) => (Array.isArray(x) && Array.isArray(y) ? x.map((v, i) => v + (y[i] - v) * k) : y ?? x);
  const unit = (v) => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  const ez = unit(mix(a.ez, b.ez));
  let ex = mix(a.ex, b.ex);
  const d = ex[0] * ez[0] + ex[1] * ez[1] + ex[2] * ez[2];
  ex = unit([ex[0] - ez[0] * d, ex[1] - ez[1] * d, ex[2] - ez[2] * d]);
  const tur = Array.isArray(a.tur) && Array.isArray(b.tur) && a.tur.length === b.tur.length ? b.tur.map((x, i) => [a.tur[i][0] + wrap(x[0] - a.tur[i][0]) * k, a.tur[i][1] + (x[1] - a.tur[i][1]) * k]) : b.tur;
  return { ...b, pos: mix(a.pos, b.pos), ex, ez, v: mix(a.v, b.v), w: mix(a.w, b.w), track: mix(a.track, b.track), tur };
}

function wrap(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}
