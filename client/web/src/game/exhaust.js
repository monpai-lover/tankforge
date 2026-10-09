// Engine exhaust: smoke from the vehicle's exhaust outlets, thin at idle, thick under load, a
// dark puff when the throttle is opened or a gear goes in (a diesel's black smoke, a petrol
// engine's lighter grey). The outlets are the vehicle's own (visual.json exhaust.outlets) or,
// without them, placed from the engine module: on the rear plate over a rear engine, out of the
// side beside a front one.

const DIESEL = { idle: [0.36, 0.36, 0.35], load: [0.08, 0.075, 0.07] };
const PETROL = { idle: [0.62, 0.63, 0.66], load: [0.3, 0.3, 0.32] };

const vx = (v) => (Array.isArray(v) ? v[0] : v.x);
const vy = (v) => (Array.isArray(v) ? v[1] : v.y);
const vz = (v) => (Array.isArray(v) ? v[2] : v.z);

/** {outlets: [{pos, dir}] (hull frame), diesel} for a vehicle bundle. */
export function exhaustOf(bundle) {
  const ex = bundle.visual?.exhaust;
  const diesel = ex?.fuel ? ex.fuel === 'diesel' : bundle.vehicle?.meta?.nation === 'ussr';
  if (ex?.outlets?.length) return { outlets: ex.outlets.map((o) => ({ pos: o.pos.slice(), dir: norm(o.dir || [0, 0.4, -1]) })), diesel };
  const size = bundle.vehicle?.hull?.size_m || [2.5, 2, 6];
  const eng = (bundle.modules || []).find((m) => m.kind === 'engine');
  const W = size[0];
  const L = size[2];
  if (!eng) return { outlets: [{ pos: [0.4, 1.2, -L / 2], dir: [0, 0.35, -1] }], diesel };
  const ex0 = vx(eng.center);
  const ey = vy(eng.center) + vy(eng.half_extents) + 0.05;
  const ez = vz(eng.center);
  if (ez < 0) {
    // a rear engine: two pipes on the rear plate, either side of the engine
    const z = -L / 2 + 0.05;
    return { outlets: [-1, 1].map((s) => ({ pos: [ex0 + s * Math.min(0.5, W * 0.18), ey, z], dir: norm([0, 0.45, -1]) })), diesel };
  }
  // a front engine: out of the side beside it
  const side = ex0 >= 0 ? 1 : -1;
  return { outlets: [{ pos: [side * (W / 2 - 0.05), ey, ez - vz(eng.half_extents) * 0.5], dir: norm([side, 0.5, -0.3]) }], diesel };
}

function norm(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** Puffs for one vehicle: call every frame with how hard its engine works. */
export class Exhaust {
  constructor(fx, spec) {
    this.fx = fx;
    this.spec = spec;
    this.acc = 0;
    this.lastLoad = 0;
    this.burst = 0;
  }

  /** Follow the same rigid-body frame as the visible hull, including pitch and roll. */
  updateHull(dt, body, load, rpm01) {
    this.update(dt, p => body.worldPoint(p), d => body.worldDir(d), load, rpm01, body.v);
  }

  /**
   * dt; toWorld(p) / toWorldDir(d) from the hull frame; load 0..1 (throttle against the engine);
   * rpm01 0..1 between idle and the governed speed; vel the hull's velocity (world).
   */
  update(dt, toWorld, toWorldDir, load, rpm01, vel = [0, 0, 0]) {
    if (!this.spec || dt <= 0) return;
    // opening the throttle (or a gear going in) throws a dark puff
    if (load - this.lastLoad > 0.25) this.burst = Math.min(1.5, this.burst + (load - this.lastLoad) * 2);
    this.lastLoad = load;
    this.burst = Math.max(0, this.burst - dt * 1.4);
    const work = Math.min(1, 0.15 + 0.5 * load + 0.35 * rpm01 + this.burst * 0.6);
    const pal = this.spec.diesel ? DIESEL : PETROL;
    const dark = Math.min(1, load * 0.25 + this.burst * 0.8);
    const color = pal.idle.map((c, k) => c + (pal.load[k] - c) * dark);
    this.acc += dt * (5 + 20 * work) * this.spec.outlets.length;
    while (this.acc > 1) {
      this.acc -= 1;
      const o = this.spec.outlets[(Math.random() * this.spec.outlets.length) | 0];
      const p = toWorld(o.pos);
      const d = toWorldDir(o.dir);
      const sp = 1.2 + 2.5 * work;
      const j = () => (Math.random() - 0.5) * 0.25;
      this.fx.spawn({
        pos: p,
        vel: [vel[0] * 0.6 + d[0] * sp + j(), vel[1] * 0.6 + d[1] * sp + 0.4 + j(), vel[2] * 0.6 + d[2] * sp + j()],
        life: 1.2 + Math.random() * 1.2 + work,
        size0: 0.12 + 0.1 * work,
        size1: 0.8 + 1.2 * work + this.burst,
        color,
        alpha: 0.07 + 0.14 * work + 0.2 * this.burst,
        drag: 1.4,
        gravity: -0.35,
        fadeIn: 0.05,
      });
    }
  }
}
