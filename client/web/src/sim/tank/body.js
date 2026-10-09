// TEMPORARY JS mirror of crates/physics/src/tank/rigid_body.rs -- keep the two in lockstep.
//
// VehicleRigidBody: the hull as one rigid body with mass, centre of mass and a diagonal inertia
// tensor (hull axes). Every force acts at a point (addForceAt), so a force off the centre of mass
// also turns the hull: the suspension's pitch and roll are a result, never set directly.
// Hull frame: +X right, +Y up, +Z forward, origin on the ground under the hull at static ride.
import { add, sub, scale, dot, cross, madd, norm } from './math3.js';

export const GRAVITY = 9.81;

export class RigidBody {
  /**
   * mass kg, inertia [Ixx, Iyy, Izz] kg m^2 about the centre of mass in hull axes,
   * com: centre of mass in the hull frame.
   */
  constructor(mass, inertia, com) {
    this.mass = mass;
    this.inertia = inertia.slice();
    this.com = com.slice();
    // world position of the centre of mass, hull axes in world space, velocities in world space
    this.pos = [0, com[1], 0];
    this.ex = [1, 0, 0];
    this.ey = [0, 1, 0];
    this.ez = [0, 0, 1];
    this.v = [0, 0, 0];
    this.w = [0, 0, 0];
    this.linearDamping = 0.01;
    this.angularDamping = 0.15;
    this.clearForces();
  }

  clearForces() {
    this.f = [0, 0, 0];
    this.t = [0, 0, 0];
  }

  /** Puts the hull frame's origin at `origin`, heading `yaw` (clockwise from +Z), level and still. */
  place(origin, yaw) {
    const s = Math.sin(yaw);
    const c = Math.cos(yaw);
    this.ex = [c, 0, -s];
    this.ey = [0, 1, 0];
    this.ez = [s, 0, c];
    this.pos = add(origin, this.worldDir(this.com));
    this.v = [0, 0, 0];
    this.w = [0, 0, 0];
  }

  worldDir(d) {
    return [
      this.ex[0] * d[0] + this.ey[0] * d[1] + this.ez[0] * d[2],
      this.ex[1] * d[0] + this.ey[1] * d[1] + this.ez[1] * d[2],
      this.ex[2] * d[0] + this.ey[2] * d[1] + this.ez[2] * d[2],
    ];
  }

  localDir(d) {
    return [dot(d, this.ex), dot(d, this.ey), dot(d, this.ez)];
  }

  /** Hull-frame point -> world. */
  worldPoint(p) {
    return add(this.pos, this.worldDir(sub(p, this.com)));
  }

  /** World point -> hull frame. */
  localPoint(p) {
    return add(this.localDir(sub(p, this.pos)), this.com);
  }

  /** World position of the hull frame's origin. */
  origin() {
    return this.worldPoint([0, 0, 0]);
  }

  pointVelocity(pw) {
    return add(this.v, cross(this.w, sub(pw, this.pos)));
  }

  /** I^-1 (world) applied to a world vector. */
  invInertia(x) {
    const l = this.localDir(x);
    return this.worldDir([l[0] / this.inertia[0], l[1] / this.inertia[1], l[2] / this.inertia[2]]);
  }

  /** Effective inverse mass of the body for a push along unit `dir` at world point `pw`. */
  invMassAlong(dir, pw) {
    const rn = cross(sub(pw, this.pos), dir);
    return 1 / this.mass + dot(rn, this.invInertia(rn));
  }

  addForceAt(force, pw) {
    this.f = add(this.f, force);
    this.t = add(this.t, cross(sub(pw, this.pos), force));
  }

  addForce(force) {
    this.f = add(this.f, force);
  }

  applyImpulseAt(j, pw) {
    this.v = madd(this.v, j, 1 / this.mass);
    this.w = add(this.w, this.invInertia(cross(sub(pw, this.pos), j)));
  }

  /** Velocity step from the accumulated forces (and gravity), then clears them. */
  integrateVelocity(dt) {
    this.v = madd(this.v, this.f, dt / this.mass);
    this.v[1] -= GRAVITY * dt;
    // gyroscopic term in hull axes: I w' = t - w x (I w)
    const wl = this.localDir(this.w);
    const Iw = [this.inertia[0] * wl[0], this.inertia[1] * wl[1], this.inertia[2] * wl[2]];
    const gyro = this.worldDir(cross(wl, Iw));
    this.w = add(this.w, scale(this.invInertia(sub(this.t, gyro)), dt));
    this.v = scale(this.v, Math.max(0, 1 - this.linearDamping * dt));
    this.w = scale(this.w, Math.max(0, 1 - this.angularDamping * dt));
    this.clearForces();
  }

  integratePosition(dt) {
    this.pos = madd(this.pos, this.v, dt);
    // rotate the axes by w dt, then re-orthonormalise
    const rot = (a) => add(a, scale(cross(this.w, a), dt));
    let ez = norm(rot(this.ez));
    let ey = rot(this.ey);
    const ex = norm(cross(ey, ez));
    ey = cross(ez, ex);
    this.ex = ex;
    this.ey = norm(ey);
    this.ez = ez;
  }

  /** Heading (clockwise from +Z), pitch (nose up +) and roll (right side up +), radians. */
  attitude() {
    return {
      heading: Math.atan2(this.ez[0], this.ez[2]),
      pitch: Math.asin(Math.max(-1, Math.min(1, this.ez[1]))),
      roll: Math.asin(Math.max(-1, Math.min(1, this.ex[1]))),
    };
  }
}
