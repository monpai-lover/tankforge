// Mirror of crates/physics/src/tank/running_gear_dynamics.rs.
// Wheel/arm masses are an engineering estimate split FROM the original assembly mass.
// Coordinates retain the original assembly COM anchor; the sprung tensor is full, not diagonal.
import { dot } from './math3.js';

function factor(a, l, n) {
  l.fill(0);
  for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
    let v = a[i * n + j];
    for (let k = 0; k < j; k++) v -= l[i * n + k] * l[j * n + k];
    if (i === j) {
      if (!(v > 1e-9) || !Number.isFinite(v)) return false;
      l[i * n + j] = Math.sqrt(v);
    } else l[i * n + j] = v / l[j * n + j];
  }
  return true;
}

function solve(l, rhs, out) {
  for (let i = 0; i < 6; i++) {
    let x = rhs[i];
    for (let j = 0; j < i; j++) x -= l[i * 6 + j] * out[j];
    out[i] = x / l[i * 6 + i];
  }
  for (let i = 5; i >= 0; i--) {
    let x = out[i];
    for (let j = i + 1; j < 6; j++) x -= l[j * 6 + i] * out[j];
    out[i] = x / l[i * 6 + i];
  }
}

function pointMatrix(a, m, r) {
  const x = r[0], y = r[1], z = r[2];
  a[0] += m; a[7] += m; a[14] += m;
  a[4] += m * z; a[24] += m * z;
  a[5] -= m * y; a[30] -= m * y;
  a[9] -= m * z; a[19] -= m * z;
  a[11] += m * x; a[31] += m * x;
  a[15] += m * y; a[20] += m * y;
  a[16] -= m * x; a[26] -= m * x;
  a[21] += m * (y * y + z * z); a[28] += m * (x * x + z * z); a[35] += m * (x * x + y * y);
  a[22] -= m * x * y; a[27] -= m * x * y;
  a[23] -= m * x * z; a[33] -= m * x * z;
  a[29] -= m * y * z; a[34] -= m * y * z;
}

export function makeRunningGear(mass, com, inertia, stations, proxies, overrides = null, limits = {}) {
  const n = stations.length;
  const per = n / 2;
  const points = stations.map(s => [s.x, s.y, s.z]);
  const weights = stations.map((s, i) => proxies?.[i % per] || s.r * s.r * s.r);
  const sum = weights.reduce((a, x) => a + x, 0);
  if (overrides && (overrides.length !== per || overrides.some(m => !(m > 0) || !Number.isFinite(m)))) throw new RangeError('station_mass_kg must contain one positive mass per axle and side');
  let ratio = 0.06;
  for (;;) {
    const wheelMass = overrides ? stations.map((_, i) => overrides[i % per]) : weights.map(w => ratio * mass * w / sum);
    const sprungMass = mass - wheelMass.reduce((a, x) => a + x, 0);
    const moment = [0, 0, 0];
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) moment[k] += wheelMass[i] * (points[i][k] - com[k]);
    const r = moment.map(x => -x / sprungMass);
    const sprungCom = r.map((x, k) => x + com[k]);
    const sprungInertia = [inertia[0], 0, 0, 0, inertia[1], 0, 0, 0, inertia[2]];
    const subtractPoint = (m, d) => {
      const d2 = dot(d, d);
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) sprungInertia[a * 3 + b] -= m * ((a === b ? d2 : 0) - d[a] * d[b]);
    };
    for (let i = 0; i < n; i++) subtractPoint(wheelMass[i], points[i].map((x, k) => x - com[k]));
    subtractPoint(sprungMass, r);
    if (sprungMass > 0 && factor(sprungInertia, new Float64Array(9), 3)) {
      const spatial = new Float64Array(36);
      pointMatrix(spatial, sprungMass, r);
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) spatial[(a + 3) * 6 + b + 3] += sprungInertia[a * 3 + b];
      return Object.freeze({ mass, com: Object.freeze(com.slice()), points: Object.freeze(points.map(p => Object.freeze(p))), wheelMass: Object.freeze(wheelMass), sprungMass, sprungCom: Object.freeze(sprungCom), sprungInertia: Object.freeze(sprungInertia), spatial: Object.freeze(Array.from(spatial)), estimatedRatio: overrides ? 0 : ratio, unsprungRatio: 1 - sprungMass / mass, massSource: overrides ? 'explicit' : '6% wheel/arm volume estimate', qMin: -(limits.rebound ?? 0.1) - 0.3, qMax: (limits.travel ?? 0.18) + 0.3, qvLimit: 30 });
    }
    if (overrides) throw new RangeError('station masses leave a non-positive sprung inertia');
    ratio *= 0.5;
    if (ratio < 1e-10) throw new RangeError('assembly inertia is not positive');
  }
}

export function newMassResponse(stations) {
  return { delta: new Float64Array(6 + stations), invMass: 0, version: 0, owner: null };
}

export class RunningGearState {
  constructor(model) {
    this.model = model;
    const n = model.wheelMass.length;
    this.q = new Float64Array(n);
    this.qv = new Float64Array(n);
    this.normalImpulse = new Float64Array(n);
    this.springImpulse = new Float64Array(n);
    this.rockImpulse = new Float64Array(n);
    this.A = new Float64Array(36);
    this.S = new Float64Array(36);
    this.L = new Float64Array(36);
    this.b = Array.from({ length: n }, () => new Float64Array(6));
    this.r = Array.from({ length: n }, () => [0, 0, 0]);
    this.rhs = new Float64Array(6);
    this.response = new Float64Array(6);
    this.wheelForce = new Float64Array(n);
    this.hull = new Float64Array(6);
    this.force = new Float64Array(3);
    this.torque = new Float64Array(3);
    this.localW = new Float64Array(3);
    this.gravity = new Float64Array(3);
    this.dampingMatrix = new Float64Array(36);
    this.dampingL = new Float64Array(36);
    this.localVelocity = new Float64Array(6);
    this.damping = new Float64Array(6);
    this.relativeResponses = Array.from({ length: 2 * n }, () => newMassResponse(n));
    this.normalResponses = Array.from({ length: n }, () => newMassResponse(n));
    this.version = 0;
    this.identity = {}; // cache token does not retain a replaced body's dynamics buffers
    this.remotePose = false;
    this.refresh();
  }

  reset() {
    this.q.fill(0); this.qv.fill(0);
    this.normalImpulse.fill(0); this.springImpulse.fill(0); this.rockImpulse.fill(0);
    this.remotePose = false;
    this.refresh();
  }

  refresh() {
    this.version++;
    const m = this.model;
    this.A.set(m.spatial);
    for (let i = 0; i < this.q.length; i++) {
      const r = this.r[i];
      for (let k = 0; k < 3; k++) r[k] = m.points[i][k] - m.com[k] + (k === 1 ? this.q[i] : 0);
      pointMatrix(this.A, m.wheelMass[i], r);
      const b = this.b[i];
      b[0] = 0; b[1] = m.wheelMass[i]; b[2] = 0;
      b[3] = -m.wheelMass[i] * r[2]; b[4] = 0; b[5] = m.wheelMass[i] * r[0];
    }
    this.S.set(this.A);
    for (let i = 0; i < this.q.length; i++) for (let a = 0; a < 6; a++) for (let b = 0; b < 6; b++) this.S[a * 6 + b] -= this.b[i][a] * this.b[i][b] / m.wheelMass[i];
    if (!factor(this.S, this.L, 6)) throw new RangeError('running gear mass operator is not positive');
  }

  writeResponse(hull, weights, qScale, cache) {
    this.rhs.set(hull); this.wheelForce.fill(0);
    let diagonal = 0;
    if (weights) for (let k = 0; k < weights.length; k += 2) {
      const i = weights[k], q = weights[k + 1] * qScale;
      this.wheelForce[i] += q;
      diagonal += q * q / this.model.wheelMass[i];
      this.rhs[1] -= q; this.rhs[3] += this.r[i][2] * q; this.rhs[5] -= this.r[i][0] * q;
    }
    solve(this.L, this.rhs, this.response);
    cache.invMass = diagonal;
    for (let a = 0; a < 6; a++) { cache.delta[a] = this.response[a]; cache.invMass += this.rhs[a] * this.response[a]; }
    for (let i = 0; i < this.q.length; i++) cache.delta[6 + i] = this.wheelForce[i] / this.model.wheelMass[i] - this.response[1] + this.r[i][2] * this.response[3] - this.r[i][0] * this.response[5];
    cache.version = this.version;
    cache.owner = this.identity;
  }

  applyResponse(body, cache, impulse) {
    if (cache.owner !== this.identity || cache.version !== this.version) throw new RangeError('stale running gear response');
    const d = cache.delta;
    for (let k = 0; k < 3; k++) {
      body.v[k] += (body.ex[k] * d[0] + body.ey[k] * d[1] + body.ez[k] * d[2]) * impulse;
      body.w[k] += (body.ex[k] * d[3] + body.ey[k] * d[4] + body.ez[k] * d[5]) * impulse;
    }
    for (let i = 0; i < this.q.length; i++) this.qv[i] += d[6 + i] * impulse;
  }

  // weights are a flat [station, coefficient, station, coefficient] contact/relative Jacobian.
  inverseMass(hull, weights = null, qScale = 0) {
    this.rhs.set(hull);
    let diagonal = 0;
    if (weights) for (let k = 0; k < weights.length; k += 2) {
      const i = weights[k], q = weights[k + 1] * qScale, mass = this.model.wheelMass[i];
      diagonal += q * q / mass;
      for (let a = 0; a < 6; a++) this.rhs[a] -= this.b[i][a] * q / mass;
    }
    solve(this.L, this.rhs, this.response);
    let value = diagonal;
    for (let a = 0; a < 6; a++) value += this.rhs[a] * this.response[a];
    return value;
  }

  impulse(body, hull, weights = null, qScale = 0) {
    this.wheelForce.fill(0);
    if (weights) for (let k = 0; k < weights.length; k += 2) this.wheelForce[weights[k]] += weights[k + 1] * qScale;
    this.apply(body, hull, this.wheelForce);
  }

  apply(body, hull, wheel) {
    this.rhs.set(hull);
    for (let i = 0; i < this.q.length; i++) {
      this.rhs[1] -= wheel[i];
      this.rhs[3] += this.r[i][2] * wheel[i];
      this.rhs[5] -= this.r[i][0] * wheel[i];
    }
    solve(this.L, this.rhs, this.response);
    for (let k = 0; k < 3; k++) {
      body.v[k] += body.ex[k] * this.response[0] + body.ey[k] * this.response[1] + body.ez[k] * this.response[2];
      body.w[k] += body.ex[k] * this.response[3] + body.ey[k] * this.response[4] + body.ez[k] * this.response[5];
    }
    for (let i = 0; i < this.q.length; i++) this.qv[i] += wheel[i] / this.model.wheelMass[i] - this.response[1] + this.r[i][2] * this.response[3] - this.r[i][0] * this.response[5];
  }

  addMassBias(mass, x, y, z, qv) {
    const wx = this.localW[0], wy = this.localW[1], wz = this.localW[2];
    const ww = wx * wx + wy * wy + wz * wz, wr = wx * x + wy * y + wz * z;
    const bx = wx * wr - ww * x, by = wy * wr - ww * y, bz = wz * wr - ww * z;
    const fx = mass * (this.gravity[0] - bx + 2 * wz * qv);
    const fy = mass * (this.gravity[1] - by);
    const fz = mass * (this.gravity[2] - bz - 2 * wx * qv);
    this.force[0] += fx; this.force[1] += fy; this.force[2] += fz;
    this.torque[0] += y * fz - z * fy; this.torque[1] += z * fx - x * fz; this.torque[2] += x * fy - y * fx;
    return fy;
  }

  damp(body, dt) {
    // Rayleigh damping Qh=-C*Vh, Qq=0. (S+hC)Vh'=S*Vh dissipates coupled kinetic
    // energy even when qv cancels hull velocity; independently scaling v/w does not.
    if (!(body.linearDamping > 0) && !(body.angularDamping > 0)) return;
    const v = this.localVelocity;
    v[0] = dot(body.v, body.ex); v[1] = dot(body.v, body.ey); v[2] = dot(body.v, body.ez);
    v[3] = dot(body.w, body.ex); v[4] = dot(body.w, body.ey); v[5] = dot(body.w, body.ez);
    this.dampingMatrix.set(this.S);
    for (let a = 0; a < 6; a++) {
      this.damping[a] = dt * (a < 3 ? Math.max(0, body.linearDamping) * this.model.mass : Math.max(0, body.angularDamping) * body.inertia[a - 3]);
      this.dampingMatrix[a * 6 + a] += this.damping[a];
      this.rhs[a] = 0;
      for (let b = 0; b < 6; b++) this.rhs[a] += this.S[a * 6 + b] * v[b];
    }
    factor(this.dampingMatrix, this.dampingL, 6);
    solve(this.dampingL, this.rhs, this.response);
    for (let a = 0; a < 6; a++) this.hull[a] = -this.damping[a] * this.response[a];
    this.impulse(body, this.hull);
  }

  integrateVelocity(body, dt, gravity) {
    const m = this.model;
    this.force[0] = dot(body.f, body.ex); this.force[1] = dot(body.f, body.ey); this.force[2] = dot(body.f, body.ez);
    this.torque[0] = dot(body.t, body.ex); this.torque[1] = dot(body.t, body.ey); this.torque[2] = dot(body.t, body.ez);
    this.localW[0] = dot(body.w, body.ex); this.localW[1] = dot(body.w, body.ey); this.localW[2] = dot(body.w, body.ez);
    this.gravity[0] = -gravity * body.ex[1]; this.gravity[1] = -gravity * body.ey[1]; this.gravity[2] = -gravity * body.ez[1];
    this.addMassBias(m.sprungMass, m.sprungCom[0] - m.com[0], m.sprungCom[1] - m.com[1], m.sprungCom[2] - m.com[2], 0);
    const w = this.localW, I = m.sprungInertia;
    const ix = I[0] * w[0] + I[1] * w[1] + I[2] * w[2];
    const iy = I[3] * w[0] + I[4] * w[1] + I[5] * w[2];
    const iz = I[6] * w[0] + I[7] * w[1] + I[8] * w[2];
    this.torque[0] -= w[1] * iz - w[2] * iy; this.torque[1] -= w[2] * ix - w[0] * iz; this.torque[2] -= w[0] * iy - w[1] * ix;
    for (let i = 0; i < this.q.length; i++) this.wheelForce[i] = this.addMassBias(m.wheelMass[i], this.r[i][0], this.r[i][1], this.r[i][2], this.qv[i]) * dt;
    for (let k = 0; k < 3; k++) { this.hull[k] = this.force[k] * dt; this.hull[k + 3] = this.torque[k] * dt; }
    this.apply(body, this.hull, this.wheelForce);
  }
}
