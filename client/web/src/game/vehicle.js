// The player's vehicle on the range: the tank model (sim/tank) standing on the deformable terrain,
// and everything the rest of the game reads from it (pose, speed, hull attitude, wheel positions).
// The physics knows nothing about drawing; this class turns its state into what the model needs.
import { makeTank, newTank, placeTank, stepTank, netState, applyNetState, reconstructRunningGear } from '../sim/tank/tank.js';
import { makeWheeled, newWheeled, placeWheeled, stepWheeled, wheelsFromVisual, netStateWheeled, applyNetStateWheeled, reconstructWheels } from '../sim/wheeled/wheeled.js';
import { dot, cross, sub, norm } from '../sim/tank/math3.js';

/** Running-gear geometry for the physics from the model's running gear. */
export function gearFromModel(model) {
  const rg = model.runningGear;
  return {
    stations: model.stations.map((s) => ({ z: s.z, y: s.y, r: s.r })),
    trackX: rg.track_x,
    trackWidth: rg.track_width,
    thickness: rg.track_thickness,
    sprocket: rg.sprocket,
    idler: rg.idler,
  };
}

export class VehicleSim {
  /** bundle: vehicle files; model: the drawn tank (running gear geometry, hull floor). */
  constructor(bundle, model, terrain) {
    this.terrain = terrain;
    // an armoured car (physics.drive "wheeled") runs on tyres, everything else on tracks
    this.wheeled = bundle.vehicle.physics?.drive === 'wheeled' && model.runningGear?.kind === 'wheels';
    if (this.wheeled) {
      this.tm = makeWheeled(bundle.vehicle, bundle.engine, wheelsFromVisual(model.runningGear), { bellyY: model.hullBottom ?? 0.45 });
      this.t = newWheeled(this.tm);
    } else {
      this.tm = makeTank(bundle.vehicle, bundle.engine, gearFromModel(model), { bellyY: model.hullBottom ?? 0.4 });
      this.t = newTank(this.tm);
    }
    this.rut = 1;
    this.sinkage = 0;
    this.pressAcc = 0;
  }

  place(x, z, heading) {
    if (this.wheeled) placeWheeled(this.tm, this.t, this.terrain, x, z, heading);
    else placeTank(this.tm, this.t, this.terrain, x, z, heading);
  }

  get body() {
    return this.t.body;
  }

  get info() {
    return this.t.info;
  }

  /** One fixed step, then the tracks press into the ground under them. */
  step(input, dt, deform = true) {
    this.t.rut = this.rut;
    const info = this.wheeled ? stepWheeled(this.tm, this.t, input, this.terrain, dt) : stepTank(this.tm, this.t, input, this.terrain, dt);
    if (deform) this._press(dt);
    return info;
  }

  _press(dt) {
    const b = this.t.body;
    const f = norm([b.ez[0], 0, b.ez[2]]);
    // a tyre presses a patch about half its radius long
    const seg = this.wheeled ? this.tm.wheels[0].r * 0.5 : this.tm.ct.contactLength / this.tm.ct.cz.length;
    const width = this.wheeled ? this.tm.wheels[0].w : this.tm.ct.trackWidth;
    let fresh = 0;
    let n = 0;
    let sink = 0;
    for (const c of this.t.contacts) {
      if (!c.side || c.z === undefined || !(c.N > 0)) continue;
      const belt = this.wheeled ? this.t.wheels[c.wheel].omega * this.tm.wheels[c.wheel].r : this.t.ds.belts[c.side].v;
      const ground = dot(this.t.body.pointVelocity(c.p), f);
      const pressed = this.terrain.press(c.p[0], c.p[2], f[0], f[2], width, seg, c.N, ground - belt + (c.ft || 0) * 0, dt);
      if (pressed > 0.0005) fresh++;
      n++;
      sink += -this.terrain.deform(c.p[0], c.p[2]);
    }
    // share of the ground under the tracks that is still being pressed in (fresh ground costs more)
    const want = n ? fresh / n : 0;
    this.rut += (Math.max(want, 0.15) - this.rut) * Math.min(1, dt * 3);
    this.sinkage = n ? Math.max(0, sink / n) : 0;
  }

  /** The planar state the rest of the game was written against (x, z, heading, speeds). */
  compat(s) {
    const o = this.t.body.origin();
    const i = this.t.info;
    s.x = o[0];
    s.z = o[2];
    s.y = o[1];
    s.heading = i.heading ?? this.t.body.attitude().heading;
    s.u = i.u ?? 0;
    s.w = i.w ?? 0;
    s.r = i.r ?? 0;
    s.gear = i.gear ?? 0;
    s.rpm = i.rpm ?? 0;
    return s;
  }

  /** Hull attitude in the old suspension terms (pitch nose-up +, roll right-up +, heave). */
  attitude() {
    const a = this.t.body.attitude();
    const o = this.t.body.origin();
    const w = this.t.body.w;
    return { y: o[1], pitch: a.pitch, roll: a.roll, vy: this.t.body.v[1], vp: -dot(w, this.t.body.ex), vr: dot(w, this.t.body.ez) };
  }

  /**
   * The hull node's matrix under a root placed at (x, 0, z) turned by `heading`:
   * the yaw is taken out of the body's axes, the height kept.
   */
  hullLocal(heading) {
    const b = this.t.body;
    const c = Math.cos(heading);
    const s = Math.sin(heading);
    // Ry^T v: components along the root's x (c, 0, -s), y, z (s, 0, c)
    const unyaw = (v) => [v[0] * c - v[2] * s, v[1], v[0] * s + v[2] * c];
    const ex = unyaw(b.ex);
    const ey = unyaw(b.ey);
    const ez = unyaw(b.ez);
    const o = b.origin();
    return new Float32Array([ex[0], ex[1], ex[2], 0, ey[0], ey[1], ey[2], 0, ez[0], ez[1], ez[2], 0, 0, o[1], 0, 1]);
  }

  /** The state sent to the other players. */
  netState() {
    return this.wheeled ? netStateWheeled(this.tm, this.t) : netState(this.t);
  }

  /** Another player's vehicle: put it where the server says and rebuild its running gear. */
  applyNet(s, dt) {
    if (this.wheeled) {
      applyNetStateWheeled(this.tm, this.t, s);
      reconstructWheels(this.tm, this.t, this.terrain, dt);
    } else {
      applyNetState(this.tm, this.t, s);
      reconstructRunningGear(this.tm, this.t, this.terrain, dt);
    }
  }

  /** Each tyre's lift (from static), spin angle and steering angle, in the model's wheel order. */
  wheelPose() {
    if (!this.wheeled) return null;
    return this.tm.wheels.map((w, i) => ({ lift: this.t.ss.comp[i], spin: this.t.wheels[i].spin, steer: this.t.wheels[i].steer }));
  }

  /** Each road wheel's height against the hull, from static (drawing), per side. */
  wheelLifts() {
    if (this.wheeled) return { 1: [], [-1]: [] };
    const per = this.tm.sp.stations.length / 2;
    const comp = this.t.ss.comp;
    return { 1: comp.slice(0, per), [-1]: comp.slice(per) };
  }

  /** z -> height of the ground under one track in the hull frame (for draping the drawn track). */
  groundUnder(side) {
    if (this.wheeled) return () => 0;
    const b = this.t.body;
    const x = side * this.tm.ct.trackX;
    const ground = this.tm.ct.ground;
    return (z) => {
      const p = b.worldPoint([x, ground, z]);
      return b.localPoint([p[0], this.terrain.height(p[0], p[2]), p[2]])[1];
    };
  }

  /** An impulse (N s, world) at a world point: recoil, a hit. */
  impulse(j, p) {
    this.t.body.applyImpulseAt(j, p);
  }

  /** Full 3D pose for anything that must follow the hull exactly. */
  worldPoint(p) {
    return this.t.body.worldPoint(p);
  }
}

export { cross, sub };
