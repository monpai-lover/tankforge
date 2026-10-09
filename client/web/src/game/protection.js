// Protection analysis (garage): the vehicle's armour as the combat model knows it -- every plate of
// armor.json -- shown on the vehicle's own model for a chosen round at a chosen range, as seen from
// the camera (each point of the surface takes the thickness of the plate nearest it and the angle
// the camera sees the real surface at), in War Thunder's colours: green where the round goes
// through, yellow where it is close, red where it is stopped, grey-blue where it glances off. Pointing at a plate names it and gives its numbers (thickness, angle, line-of-sight
// thickness, what the round needs, what it has); a click fires the round there through the full
// combat model (crates/combat via the design core) and plays the hit camera: path, spall, burst,
// the modules and crew it reaches.
import { penAt } from './hud.js';
import { newShot, stepShot } from '../sim/ballistics.js';
import { onPlate } from './plates.js';

export const ZONE_NAME = {
  hull_upper_front: '車體上部正面',
  hull_lower_front: '車體下部正面',
  hull_side: '車體側面',
  hull_rear: '車體後部',
  hull_roof: '車體頂部',
  hull_floor: '車底',
  turret_front: '炮塔正面',
  turret_side: '炮塔側面',
  turret_rear: '炮塔後部',
  turret_roof: '炮塔頂部',
  gun_mantlet: '防盾',
};
export const MATERIAL_NAME = { rha: '均質鋼', cha: '鑄鋼', aluminium: '鋁合金', high_hardness_steel: '高硬度鋼', spaced: '間隙裝甲', skirt: '側裙', applied: '附加裝甲', composite: '複合裝甲', era: '反應裝甲' };
export const VERDICT = {
  pen: { color: [0.18, 0.72, 0.28], label: '可擊穿' },
  maybe: { color: [0.98, 0.72, 0.12], label: '可能擊穿' },
  stop: { color: [0.95, 0.16, 0.1], label: '無法擊穿' },
  glance: { color: [0.42, 0.58, 0.82], label: '跳彈' },
};
const CHEMICAL = new Set(['heat', 'heat_fs']);
const HE = new Set(['he', 'hesh']);
const DEG = Math.PI / 180;

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const v3 = (p) => (Array.isArray(p) ? p : [p.x, p.y, p.z]);

/** Penetration of a round at a range (mm): the curve, or what its burst does on contact for HE. */
export function roundPen(shell, dist) {
  const curve = penAt(shell, dist);
  if (HE.has(shell.kind) && shell.explosive_mass_kg > 0) return Math.max(curve, 13.1 * shell.explosive_mass_kg ** 0.673);
  return curve;
}

/** One plate against one round coming along `dir` (hull frame, unit), as crates/penetration rules it. */
export function plateVerdict(plate, mat, shell, dist, dir) {
  const n = plate.n;
  const inc = Math.acos(Math.min(1, Math.abs(dot(dir, n)))) / DEG;
  const chem = CHEMICAL.has(shell.kind);
  const eff = chem ? inc : Math.max(0, inc - (shell.normalization_deg || 0));
  const los = plate.t / Math.max(Math.cos(eff * DEG), 0.01);
  const factor = mat ? (chem ? mat.chemical_factor : mat.kinetic_factor) : 1;
  const need = los * factor;
  const pen = roundPen(shell, dist);
  const overmatch = !chem && shell.caliber_mm >= 3 * plate.t;
  let v;
  if (!overmatch && shell.ricochet_angle_deg && inc >= shell.ricochet_angle_deg) v = 'glance';
  else if (pen >= need * 1.1) v = 'pen';
  else if (pen >= need * 0.9) v = 'maybe';
  else v = 'stop';
  return { verdict: v, inc, eff, los, need, pen, overmatch };
}

/** Speed of a round after `dist` m of flight (m/s). */
export function speedAt(shell, dist) {
  const s = newShot([0, 0, 0], [0, 0, 1], shell);
  for (let i = 0; i < 20000 && s.pos[2] < dist; i++) stepShot(s, 1 / 500);
  return Math.hypot(s.vel[0], s.vel[1], s.vel[2]);
}

export class Protection {
  /**
   * env: {renderer, materials (id -> material), hitcam, combat: () => Combat | null}
   */
  constructor(env) {
    this.env = env;
    this.active = false;
    this.shell = null;
    this.dist = 500;
    this.plates = [];
    this.hover = null;
    this.meshes = [];
  }

  /**
   * Takes a vehicle's armour plates (armor.json) for the analysis. The plates are not drawn: the
   * vehicle's own model is coloured (renderer kind 12), each point of its surface by the plate
   * nearest it and the angle the camera sees that surface at.
   */
  attach(model, loadout, bundle) {
    this.detach();
    this.model = model;
    this.loadout = loadout;
    this.bundle = bundle;
    const armor = (bundle && bundle.armor) || [];
    this.plates = armor.map((p) => {
      const turret = p.zone.startsWith('turret') || p.zone === 'gun_mantlet';
      const n = norm(v3(p.normal));
      const u = norm(v3(p.axis_u));
      const v = cross(n, u);
      return { def: p, turret, c: v3(p.center), n, u, v, t: p.thickness_mm, mat: this.env.materials[p.material] || null };
    });
    this.buf = new Float32Array(Math.max(1, this.plates.length) * 16);
    if (this.active) this._paint(true);
  }

  detach() {
    if (this.model) this._paint(false);
    this.plates = [];
    this.model = null;
  }

  /** The model's shell drawn in the analysis colours (kind 12), or as it was. */
  _paint(on) {
    if (!this.model) return;
    for (const n of this.model.shellNodes) {
      if (on) {
        if (n.protKind == null) n.protKind = n.kind;
        n.kind = 12;
        n.visible = true;
      } else if (n.protKind != null) {
        n.kind = n.protKind;
        n.protKind = null;
      }
    }
  }

  setActive(on) {
    this.active = on;
    this._paint(on);
    if (!on) {
      this.hover = null;
      this.env.renderer.setArmor(null);
    }
  }

  /** The plate's frame: turret plates turn with the turret. */
  _toPlateFrame(p, pt, dir, turretYaw) {
    if (!p.turret || !this.loadout.turrets[0]) return [pt, dir];
    const pv = this.loadout.turrets[0].pivot;
    const c = Math.cos(-turretYaw);
    const s = Math.sin(-turretYaw);
    const r = (q) => [q[0] * c + q[2] * s, q[1], -q[0] * s + q[2] * c];
    const q = r(sub(pt, pv));
    return [[q[0] + pv[0], q[1] + pv[1], q[2] + pv[2]], r(dir)];
  }

  /**
   * Hands the renderer every plate in the world (turret plates turned with the turret) and the
   * round's figures. body: the vehicle's rigid body (hull frame -> world).
   */
  update(body, turretYaw = 0) {
    if (!this.active || !this.shell || !this.model) return;
    const pv = this.loadout.turrets[0] ? this.loadout.turrets[0].pivot : [0, 0, 0];
    const c = Math.cos(turretYaw);
    const sn = Math.sin(turretYaw);
    const turn = (q) => [q[0] * c + q[2] * sn, q[1], -q[0] * sn + q[2] * c];
    const chem = CHEMICAL.has(this.shell.kind);
    const b = this.buf;
    this.plates.forEach((p, i) => {
      let C = p.c;
      let N = p.n;
      let U = p.u;
      let V = p.v;
      if (p.turret) {
        const r = turn(sub(C, pv));
        C = [r[0] + pv[0], r[1] + pv[1], r[2] + pv[2]];
        N = turn(N);
        U = turn(U);
        V = turn(V);
      }
      const w = body.worldPoint(C);
      const wn = body.worldDir(N);
      const wu = body.worldDir(U);
      const wv = body.worldDir(V);
      const f = p.mat ? (chem ? p.mat.chemical_factor : p.mat.kinetic_factor) : 1;
      b.set([w[0], w[1], w[2], p.t, wn[0], wn[1], wn[2], f, wu[0], wu[1], wu[2], p.def.half_u, wv[0], wv[1], wv[2], p.def.half_v], i * 16);
    });
    const sh = this.shell;
    this.env.renderer.setArmor({ data: b, count: this.plates.length, shell: [roundPen(sh, this.dist), chem ? 0 : sh.normalization_deg || 0, sh.ricochet_angle_deg || 90, sh.caliber_mm], chem });
  }

  /** The first plate along a ray (hull frame): {plate, t, point, verdict...} or null. */
  pick(origin, dir, turretYaw = 0) {
    let best = null;
    for (const p of this.plates) {
      const [o, d] = this._toPlateFrame(p, origin, dir, turretYaw);
      const den = dot(d, p.n);
      if (Math.abs(den) < 1e-6) continue;
      const t = dot(sub(p.c, o), p.n) / den;
      if (t <= 0 || (best && t >= best.t)) continue;
      const q = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
      const rel = sub(q, p.c);
      if (!onPlate(p.def, dot(rel, p.u), dot(rel, p.v))) continue;
      best = { plate: p, t, dir: d };
    }
    if (!best) return null;
    const r = plateVerdict(best.plate, best.plate.mat, this.shell, this.dist, best.dir);
    return { ...best, ...r };
  }

  /** A line of text for the plate under the pointer. */
  describe(h) {
    if (!h) return '';
    const p = h.plate.def;
    const name = ZONE_NAME[p.zone] || p.zone;
    const mat = MATERIAL_NAME[p.material] || p.material;
    return `${name}（${p.id}）　${mat} ${p.thickness_mm} mm　入射 ${h.inc.toFixed(0)}°　等效 ${h.need.toFixed(0)} mm　穿深 ${h.pen.toFixed(0)} mm　→ ${VERDICT[h.verdict].label}`;
  }

  /**
   * Fires the round along the ray through the combat model (a fresh copy of the vehicle: nothing
   * stays broken). Returns the report, or null when the core is not ready.
   */
  shoot(id, origin, dir, turretYaw = 0) {
    const combat = this.env.combat();
    if (!combat || !this.bundle || !this.shell) return null;
    const fresh = combat.fresh(id, this.bundle);
    // start a little short of the vehicle, on the line
    const o = [origin[0] + dir[0] * 0.5, origin[1] + dir[1] * 0.5, origin[2] + dir[2] * 0.5];
    const shot = { shell: this.shell, origin: o, dir, speed_ms: speedAt(this.shell, this.dist), distance_m: this.dist, seed: (Math.random() * 4294967295) >>> 0, turret_yaw: turretYaw };
    const r = combat.shoot(id, fresh.state, shot);
    r.shot = shot;
    return r;
  }
}
