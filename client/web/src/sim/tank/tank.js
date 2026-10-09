// TEMPORARY JS mirror of crates/physics/src/tank/mod.rs -- keep the two in lockstep.
//
// A tracked vehicle as the chain the forces really follow:
//   terrain -> track contact -> road wheels -> suspension -> hull rigid body
// and for driving:
//   engine torque -> gearbox -> final drive -> left / right track -> track-ground friction -> hull.
// Nothing here sets the hull's attitude: heave, pitch and roll come from the station forces at
// their mounts, weight transfer from forces acting at the ground below the centre of mass.
import { makeParams } from '../physics.js';
import { pressureFactor, groundPressure } from '../terra.js';
import { RigidBody, GRAVITY } from './body.js';
import { makeSuspension, newSuspensionState, applySuspension, supportUnder } from './suspension.js';
import { makeContacts, newContactState, sampleGround, applyRigidContacts, trackContacts, solveFriction } from './contacts.js';
import { makeDrive, newDriveState, driveStep, rollingForce } from './drive.js';
import { collisionPoints, applyObstacles } from './obstacles.js';
import { dot, scale, len, clamp } from './math3.js';

const AIR_RHO = 1.225;

/**
 * Running-gear geometry for makeTank from a visual.json running_gear block: one station per
 * road-wheel axle (interleaved wheels on one axle count once), front first.
 */
export function gearFromVisual(rg) {
  const byZ = new Map();
  for (const w of rg.wheels) if (!byZ.has(w.z.toFixed(3))) byZ.set(w.z.toFixed(3), { z: w.z, y: w.y, r: w.r });
  const stations = [...byZ.values()].sort((a, b) => b.z - a.z);
  return { stations, trackX: rg.track_x, trackWidth: rg.track_width, thickness: rg.track_thickness, sprocket: rg.sprocket, idler: rg.idler };
}

/** Box-like hull: inertia about the centre of mass, hull axes [pitch (x), yaw (y), roll (z)]. */
export function boxInertia(mass, size) {
  const [w, h, l] = size;
  return [(mass * (h * h + l * l)) / 12, (mass * (w * w + l * l)) / 12, (mass * (w * w + h * h)) / 12];
}

/**
 * vehicle: vehicle.json, engineFile: engine.json, gear: running-gear geometry
 * {stations: [{z, y, r}], trackX, trackWidth, thickness, sprocket, idler}, bellyY: hull floor.
 */
export function makeTank(vehicle, engineFile, gear, opts = {}) {
  const p = makeParams(vehicle, engineFile);
  const hull = vehicle.hull;
  const ph = vehicle.physics;
  const mass = hull.mass_kg;
  const com = hull.center_of_mass.slice();
  const height = hull.size_m[1] + 0.5 * (vehicle.turret?.size_m?.[1] || 0);
  const inertia = ph.inertia_kgm2 || boxInertia(mass, [hull.size_m[0], height, hull.size_m[2]]);
  const sp = makeSuspension(gear, {
    mass,
    cgZ: com[2],
    travel: ph.suspension?.travel_m,
    stiffness: ph.suspension?.stiffness,
    damping: ph.suspension?.damping,
    kind: ph.suspension?.kind,
    freqHz: ph.suspension_freq_hz,
    dampingRatio: ph.suspension_damping,
  });
  const ct = makeContacts(gear, sp, { bellyY: opts.bellyY, contactsPerSide: opts.contactsPerSide });
  const dr = makeDrive(p, mass);
  // the outline that collides with obstacles: both track belts and the hull box
  const collide = collisionPoints(gear, { hw: hull.size_m[0] / 2, y0: opts.bellyY ?? 0.4, y1: hull.size_m[1], hl: hull.size_m[2] / 2 });
  return { p, mass, com, inertia, sp, ct, dr, collide, substeps: opts.substeps ?? 2, groundPressure: groundPressure(mass, gear.trackWidth, ct.contactLength) };
}

export function newTank(tm) {
  const body = new RigidBody(tm.mass, tm.inertia, tm.com);
  return { body, ss: newSuspensionState(tm.sp), cs: newContactState(tm.ct), ds: newDriveState(tm.dr), contacts: [], info: {}, travel: { 1: 0, [-1]: 0 }, rut: 1, obstacles: [], obstacleContacts: [] };
}

/** Puts the tank standing on the ground at (x, z) facing `heading`, still. */
export function placeTank(tm, t, terrain, x, z, heading) {
  // stand it on the ground under its tracks: a plane through the ground at the four track ends
  const sn = Math.sin(heading);
  const cs = Math.cos(heading);
  const L = (tm.sp.stations[0].z - tm.sp.stations[tm.sp.stations.length / 2 - 1].z) / 2 + 0.3;
  const X = tm.ct.trackX;
  const at = (lx, lz) => terrain.height(x + lx * cs + lz * sn, z - lx * sn + lz * cs);
  const fr = at(X, L);
  const fl = at(-X, L);
  const rr = at(X, -L);
  const rl = at(-X, -L);
  const pitch = Math.atan2((fr + fl - rr - rl) / 2, 2 * L);
  const roll = Math.atan2((fr + rr - fl - rl) / 2, 2 * X);
  t.body.place([x, (fr + fl + rr + rl) / 4, z], heading);
  // tilt: nose up by pitch, right side up by roll
  const b = t.body;
  const rot = (v, axis, a) => {
    const c = Math.cos(a);
    const s2 = Math.sin(a);
    const d = axis[0] * v[0] + axis[1] * v[1] + axis[2] * v[2];
    const cr = [axis[1] * v[2] - axis[2] * v[1], axis[2] * v[0] - axis[0] * v[2], axis[0] * v[1] - axis[1] * v[0]];
    return [0, 1, 2].map((i) => v[i] * c + cr[i] * s2 + axis[i] * d * (1 - c));
  };
  const origin = b.origin();
  for (const [axis, a] of [[b.ex, -pitch], [b.ez, roll]]) {
    const ax = axis.slice();
    b.ex = rot(b.ex, ax, a);
    b.ey = rot(b.ey, ax, a);
    b.ez = rot(b.ez, ax, a);
  }
  b.pos = [origin[0], origin[1], origin[2]];
  b.pos = [0, 1, 2].map((i) => origin[i] + b.worldDir(b.com)[i]);
  t.ss = newSuspensionState(tm.sp);
  t.cs = newContactState(tm.ct);
  t.ds = newDriveState(tm.dr);
}

/**
 * One step. input {throttle, steer, brake}; terrain {height(x, z), surface(x, z) -> terrain def}.
 * t.rut (0..1): how much of the ground under the tracks is fresh (1) or already pressed (0).
 */
export function stepTank(tm, t, input, terrain, dt) {
  const n = tm.substeps;
  const h = dt / n;
  const body = t.body;
  const surfaceOf = (x, z) => terrain.surface(x, z);
  let solved = [];
  let sideLoad = { 1: 0, [-1]: 0 };
  const u0 = dot(body.v, body.ez);
  for (let i = 0; i < n; i++) {
    sampleGround(tm.ct, t.cs, body, terrain);
    sideLoad = applySuspension(tm.sp, t.ss, body, t.cs.prof, h);
    const extra = applyRigidContacts(tm.ct, t.cs, body, terrain, surfaceOf, h, tm.sp, t.ss);
    // walls, buildings, other vehicles: the track belts and the hull are solid against them
    if (t.obstacles && t.obstacles.length) t.obstacleContacts = applyObstacles(tm.collide, body, t.obstacles, tm.mass, h);
    const sp = len(body.v);
    if (sp > 0.01) body.addForce(scale(body.v, -0.5 * AIR_RHO * tm.p.cdA * sp));
    body.integrateVelocity(h);

    // drive: targets, engine, steering, brakes
    const u = dot(body.v, body.ez);
    const mid = surfaceOf(body.pos[0], body.pos[2]);
    const rollMult = 1 + (mid.rolling_mult - 1) * pressureFactor(mid.soil, tm.groundPressure) * (0.35 + 0.65 * clamp(t.rut, 0, 1));
    const rollTotal = rollingForce(tm.p, rollMult, sideLoad[1] + sideLoad[-1]);
    const grade = tm.mass * GRAVITY * body.ez[1];
    driveStep(tm.dr, t.ds, input, { u, resist: rollTotal + 0.5 * AIR_RHO * tm.p.cdA * u * u, grade }, h);
    // a track shot off (set by the damage model): t.broken = {1: right, -1: left}
    t.ds.motor.broken = t.broken || null;
    // rolling losses hold each track back (never past standing still)
    for (const side of [1, -1]) {
      const b = t.ds.belts[side];
      const fr = rollingForce(tm.p, rollMult, sideLoad[side]);
      const dv = (fr * h) / b.m;
      b.v = Math.abs(b.v) <= dv ? 0 : b.v - dv * Math.sign(b.v);
    }

    const contacts = trackContacts(tm.ct, t.cs, body, tm.sp, t.ss, surfaceOf).concat(extra);
    solved = solveFriction(contacts, body, t.ds.belts, t.ds.brakes, h, 10, t.ds.motor);
    const mo = t.ds.motor;
    t.ds.drive[-1] = mo.fMean / 2 + mo.fSteer;
    t.ds.drive[1] = mo.fMean / 2 - mo.fSteer;
    t.ds.load = mo.pushing && t.ds.fEng > 0 ? Math.min(1, Math.abs(mo.fMean) / t.ds.fEng + Math.abs(mo.fSteer * (t.ds.belts[-1].v - t.ds.belts[1].v)) / tm.p.power) : 0;
    body.integratePosition(h);
    for (const side of [1, -1]) t.travel[side] += t.ds.belts[side].v * h;
  }
  t.contacts = solved;
  // what the rest of the game reads
  const att = body.attitude();
  const u = dot(body.v, body.ez);
  const w = dot(body.v, body.ex);
  const r = dot(body.w, body.ey);
  const half = tm.p.gauge / 2;
  const slip = (side) => {
    const b = t.ds.belts[side].v;
    const g = u - side * r * half;
    return Math.min(1, Math.abs(b - g) / Math.max(Math.abs(b), Math.abs(g), 1));
  };
  const force = { 1: 0, [-1]: 0 };
  for (const c of solved) if (c.side) force[c.side] += c.fl;
  t.info = {
    rpm: t.ds.rpm,
    gear: t.ds.gear,
    reversing: t.ds.reversing,
    speedKmh: u * 3.6,
    trackSlip: Math.max(slip(1), slip(-1)),
    yawRateDeg: (r * 180) / Math.PI,
    ax: (u - u0) / dt,
    lateralAcc: u * r,
    slipL: slip(-1),
    slipR: slip(1),
    trackSpeedL: t.ds.belts[-1].v,
    trackSpeedR: t.ds.belts[1].v,
    groundSpeedL: u + r * half,
    groundSpeedR: u - r * half,
    forceL: force[-1],
    forceR: force[1],
    braking: !!t.ds.braking,
    throttleLoad: t.ds.load,
    heading: att.heading,
    pitch: att.pitch,
    roll: att.roll,
    u,
    w,
    r,
  };
  return t.info;
}

/**
 * How much the hull's tilt lifts a gun laid at `yaw` (turret angle from the hull's nose):
 * pitch along the nose, roll across it. att: {pitch, roll}.
 */
export function hullTilt(att, yaw) {
  return att.pitch * Math.cos(yaw) + att.roll * Math.sin(yaw);
}

/** Hull-frame origin, heading, pitch and roll of the tank now. */
export function tankPose(t) {
  const o = t.body.origin();
  const a = t.body.attitude();
  return { pos: o, heading: a.heading, pitch: a.pitch, roll: a.roll };
}

// ---------------------------------------------------------------- multiplayer

/**
 * What the server sends for a tank (authoritative): hull position (hull-frame origin, world),
 * orientation (hull axes x and z; y follows), velocities, track speeds, engine and gear.
 * Wheels, track shape and sprocket phase are rebuilt by each client from this.
 */
export function netState(t) {
  const b = t.body;
  return {
    pos: b.origin(),
    ex: b.ex.slice(),
    ez: b.ez.slice(),
    v: b.v.slice(),
    w: b.w.slice(),
    track: [t.ds.belts[-1].v, t.ds.belts[1].v],
    rpm: t.ds.rpm,
    gear: t.ds.gear,
  };
}

/** Puts a remote tank into the state the server sent (no forces are simulated for it). */
export function applyNetState(tm, t, s) {
  const b = t.body;
  b.ex = s.ex.slice();
  b.ez = s.ez.slice();
  const ey = [b.ez[1] * b.ex[2] - b.ez[2] * b.ex[1], b.ez[2] * b.ex[0] - b.ez[0] * b.ex[2], b.ez[0] * b.ex[1] - b.ez[1] * b.ex[0]];
  b.ey = ey;
  const d = b.worldDir(b.com);
  b.pos = [s.pos[0] + d[0], s.pos[1] + d[1], s.pos[2] + d[2]];
  b.v = s.v.slice();
  b.w = s.w.slice();
  t.ds.belts[-1].v = s.track[0];
  t.ds.belts[1].v = s.track[1];
  t.ds.rpm = s.rpm;
  t.ds.gear = s.gear;
}

/**
 * Rebuilds a remote tank's road wheels from its hull pose and the ground: each wheel stands on
 * its ground within its travel, or hangs from its stop. Tracks run on at the sent speeds.
 */
export function reconstructRunningGear(tm, t, terrain, dt) {
  sampleGround(tm.ct, t.cs, t.body, terrain);
  const sp = tm.sp;
  const b = t.body;
  const upY = Math.max(0.2, b.ey[1]);
  sp.stations.forEach((s, i) => {
    const sup = supportUnder(sp, t.cs.prof[s.side], s);
    const h = b.worldPoint([s.x, s.y, s.z])[1];
    const x = (sup + s.r + sp.thickness - h) / upY;
    t.ss.grounded[i] = x >= -sp.rebound;
    t.ss.comp[i] = Math.min(Math.max(x, -sp.rebound), sp.travel + 0.03);
  });
  for (const side of [1, -1]) t.travel[side] += t.ds.belts[side].v * dt;
}
