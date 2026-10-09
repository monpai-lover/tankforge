// Browser wheeled-vehicle simulation; a corresponding Rust wheeled backend is not implemented.
//
// A wheeled vehicle (armoured car) as the chain the forces follow:
//   terrain -> tyre contact -> wheel -> spring and damper -> hull rigid body
// and for driving:
//   engine torque -> gearbox -> transfer box -> axle differentials -> wheels -> tyre grip -> hull.
// Each wheel hangs from its mount on a spring and damper and meets the ground under it (a ray down
// the hull's vertical); its tyre grips by slip: along the wheel by the difference between the rim
// speed and the ground speed, across it by the slip angle, both inside the friction circle of the
// load it carries. The steered axles turn by Ackermann geometry about a centre on the line of the
// unsteered axles (or the middle, when front and rear both steer); the hull turns because the
// tyres push it round, and leans, slides and lifts a wheel because the forces act where they do.
import { makeParams, torqueAt } from '../physics.js';
import { RigidBody, GRAVITY } from '../tank/body.js';
import { boxInertia } from '../tank/tank.js';
import { applyObstacles } from '../tank/obstacles.js';
import { dot, cross, scale, len, clamp, norm, add } from '../tank/math3.js';
import { advanceDriveForce } from '../drivetrain.js';

const AIR_RHO = 1.225;
const MOUNT = 0.3; // m from the axle (at static load) up to the spring's top mount
const TYRE_SAT = 0.12; // longitudinal slip (fraction of speed) at which a tyre gives its full grip
const SLIP_PEAK = 0.14; // rad: slip angle of full lateral grip
const MIN_SAT_SPEED = 0.35; // m/s: below this, grip builds over a fixed slip speed (no division by zero)
const STEER_RATE = 0.9; // rad/s the steering wheel turns the road wheels
const ENGINE_BRAKE = 0.18;
const WHEEL_INERTIA = 0.6; // of m r^2 for a tyre and hub of mass m (about 1/40 of the vehicle's share)

/**
 * Wheel layout for makeWheeled from a visual.json running_gear block of kind "wheels": every axle
 * once with its x (outer half track), y (axle height at static load), z, tyre r and w, how it
 * steers (1 front, < 0 counter-steering rear) and whether it is driven. Both sides, right first.
 */
export function wheelsFromVisual(rg) {
  const out = [];
  for (const side of [1, -1]) {
    for (const a of rg.axles) out.push({ side, x: side * a.x, y: a.y, z: a.z, r: a.r, w: a.w, steer: a.steer || 0, driven: a.driven !== false });
  }
  return out;
}

/** vehicle: vehicle.json, engineFile: engine.json, wheels: from wheelsFromVisual. */
export function makeWheeled(vehicle, engineFile, wheels, opts = {}) {
  const p = makeParams(vehicle, engineFile);
  const hull = vehicle.hull;
  const ph = vehicle.physics;
  const mass = hull.mass_kg;
  const com = hull.center_of_mass.slice();
  const height = hull.size_m[1] + 0.5 * (vehicle.turret?.size_m?.[1] || 0);
  const inertia = ph.inertia_kgm2 || boxInertia(mass, [hull.size_m[0], height, hull.size_m[2]]);
  const n = wheels.length;
  // springs: the static load of each wheel (lever rule along the wheelbase) gives the ride
  // frequency asked for, or the stiffness in the data
  const zs = wheels.map((w) => w.z);
  const zMax = Math.max(...zs);
  const zMin = Math.min(...zs);
  const share = wheels.map((w) => {
    // more load on the axles nearer the centre of mass
    const d = Math.abs(w.z - com[2]) / Math.max(zMax - zMin, 1);
    return 1.15 - 0.3 * d;
  });
  const sum = share.reduce((a, b) => a + b, 0);
  const statics = share.map((s) => (mass * GRAVITY * s) / sum);
  const freq = ph.suspension_freq_hz ?? 1.3;
  const zeta = ph.suspension_damping ?? 0.35;
  const travel = ph.suspension?.travel_m ?? 0.2;
  const springs = statics.map((F) => {
    const m = F / GRAVITY;
    const k = ph.suspension?.stiffness ?? m * (2 * Math.PI * freq) ** 2;
    const c = ph.suspension?.damping ?? 2 * zeta * Math.sqrt(k * m);
    return { k, c, preload: F };
  });
  // steering: the centre of turn lies on the line of the unsteered axles (or between the ends)
  const fixed = wheels.filter((w) => !w.steer).map((w) => w.z);
  const zc = fixed.length ? fixed.reduce((a, b) => a + b, 0) / fixed.length : (zMax + zMin) / 2;
  const front = wheels.filter((w) => w.steer > 0).map((w) => w.z);
  const lever = (front.length ? Math.max(...front) : zMax) - zc;
  const maxSteer = ((ph.max_steer_deg ?? 32) * Math.PI) / 180;
  // the turning circle the data gives sets the lock (kerb-to-kerb radius about the centre)
  const minR = ph.min_turn_radius_m > 0 ? ph.min_turn_radius_m : lever / Math.tan(maxSteer);
  const tyreR = wheels[0].r;
  const driven = wheels.filter((w) => w.driven).length;
  // outline that meets walls and other vehicles: the hull box's corners and edges, and the tyres
  const hw = hull.size_m[0] / 2;
  const hl = hull.size_m[2] / 2;
  const y0 = opts.bellyY ?? 0.45;
  const y1 = hull.size_m[1];
  const collide = [];
  for (const y of [y0, (y0 + y1) / 2, y1]) {
    for (let k = 0; k <= 8; k++) {
      const z = -hl + (2 * hl * k) / 8;
      collide.push([hw, y, z], [-hw, y, z]);
    }
    for (let k = 1; k < 4; k++) {
      const x = -hw + (2 * hw * k) / 4;
      collide.push([x, y, hl], [x, y, -hl]);
    }
  }
  for (const w of wheels) collide.push([w.x + Math.sign(w.x) * w.w * 0.4, w.y, w.z + w.r * 0.9], [w.x + Math.sign(w.x) * w.w * 0.4, w.y, w.z - w.r * 0.9]);
  return {
    kind: 'wheeled',
    p,
    mass,
    com,
    inertia,
    wheels,
    springs,
    travel,
    zc,
    lever,
    minR,
    tyreR,
    driven,
    wheelInertia: WHEEL_INERTIA * (mass / n / 40) * tyreR * tyreR + 0.5 * 30 * tyreR * tyreR,
    collide,
    substeps: opts.substeps ?? 4,
    groundPressure: mass * GRAVITY / (n * wheels[0].w * wheels[0].r * 0.6) / 1000,
  };
}

export function newWheeled(tm) {
  const body = new RigidBody(tm.mass, tm.inertia, tm.com);
  // the tyres' rolling loss and the air drag are modelled; no extra damping on the hull's speed
  body.linearDamping = 0;
  const n = tm.wheels.length;
  return {
    body,
    wheels: tm.wheels.map(() => ({ L: MOUNT, omega: 0, spin: 0, steer: 0, grounded: false, load: 0, slip: 0, fx: 0 })),
    ds: { gear: 0, rpm: tm.p.engine.idle_rpm, shiftTimer: 0, reversing: false, braking: false, load: 0, steer: 0, driveForce: 0, driveDirection: 0 },
    ss: { comp: new Array(n).fill(0), load: new Array(n).fill(0), grounded: new Array(n).fill(false) },
    contacts: [],
    info: {},
    travel: { 1: 0, [-1]: 0 },
    rut: 1,
    obstacles: [],
    obstacleContacts: [],
  };
}

/** Puts the vehicle on its wheels at (x, z) facing `heading`, still. */
export function placeWheeled(tm, t, terrain, x, z, heading) {
  const sn = Math.sin(heading);
  const cs = Math.cos(heading);
  const at = (lx, lz) => terrain.height(x + lx * cs + lz * sn, z - lx * sn + lz * cs);
  const ws = tm.wheels;
  const zf = Math.max(...ws.map((w) => w.z));
  const zr = Math.min(...ws.map((w) => w.z));
  const X = Math.max(...ws.map((w) => w.x));
  const fr = at(X, zf);
  const fl = at(-X, zf);
  const rr = at(X, zr);
  const rl = at(-X, zr);
  const pitch = Math.atan2((fr + fl - rr - rl) / 2, zf - zr);
  const roll = Math.atan2((fr + rr - fl - rl) / 2, 2 * X);
  const b = t.body;
  b.place([x, (fr + fl + rr + rl) / 4, z], heading);
  const rot = (v, axis, a) => {
    const c = Math.cos(a);
    const s2 = Math.sin(a);
    const d = dot(axis, v);
    const cr = cross(axis, v);
    return [0, 1, 2].map((i) => v[i] * c + cr[i] * s2 + axis[i] * d * (1 - c));
  };
  const origin = b.origin();
  for (const [axis, a] of [[b.ex.slice(), -pitch], [b.ez.slice(), roll]]) {
    b.ex = rot(b.ex, axis, a);
    b.ey = rot(b.ey, axis, a);
    b.ez = rot(b.ez, axis, a);
  }
  b.pos = [0, 1, 2].map((i) => origin[i] + b.worldDir(b.com)[i]);
  const fresh = newWheeled(tm);
  t.wheels = fresh.wheels;
  t.ds = fresh.ds;
  t.ss = fresh.ss;
}

const ratio = (p, g) => p.trans.gear_ratios[g] * p.trans.final_drive_ratio;

/** Steering angle of a wheel for the hull's turn centre (Ackermann), `delta` the lock asked for. */
function wheelSteer(tm, w, delta) {
  if (!w.steer || Math.abs(delta) < 1e-4) return 0;
  const R = tm.lever / Math.tan(Math.abs(delta)); // turn radius of the hull's centre line
  const side = Math.sign(delta); // + right
  const a = Math.atan((w.z - tm.zc) / Math.max(R - side * w.x, 0.5));
  return side * a;
}

/**
 * One step. input {throttle, steer, brake}; terrain {height(x, z), surface(x, z) -> terrain def}.
 */
export function stepWheeled(tm, t, input, terrain, dt) {
  const n = tm.substeps;
  const h = dt / n;
  const p = tm.p;
  const body = t.body;
  const ds = t.ds;
  const u0 = dot(body.v, body.ez);
  const throttle = clamp(input.throttle, -1, 1);
  const steerIn = clamp(input.steer, -1, 1);
  const broken = t.broken || null;
  let contacts = [];
  for (let s = 0; s < n; s++) {
    const u = dot(body.v, body.ez);
    // ---- steering: the lock narrows with speed (no driver throws a car over at speed)
    const lock = Math.atan(tm.lever / tm.minR) / (1 + (Math.abs(u) / 14) ** 2);
    const want = steerIn * lock;
    ds.steer += clamp(want - ds.steer, -STEER_RATE * h, STEER_RATE * h);

    // ---- engine and gearbox (automatic, by road speed)
    const reversing = throttle < 0 || (throttle === 0 && u < -0.3);
    const last = p.trans.gear_ratios.length - 1;
    const wheelW = t.wheels.reduce((a, w, i) => a + (tm.wheels[i].driven ? Math.abs(w.omega) : 0), 0) / Math.max(tm.driven, 1);
    const roadW = Math.abs(u) / tm.tyreR;
    ds.shiftTimer = Math.max(0, ds.shiftTimer - h);
    // a gearbox with as many reverse gears as forward ones (the Puma's rear driver) shifts the
    // same way going backwards; otherwise reverse is one gear
    const fullReverse = (p.trans.reverse_gears ?? 1) >= p.trans.gear_ratios.length;
    if (reversing && !fullReverse) ds.gear = p.revGear;
    else if (Math.abs(u) < 0.5 && ds.gear !== 0) ds.gear = 0;
    else if (ds.shiftTimer <= 0) {
      // the driver shifts for the most pull at the wheels: up when the next gear pulls harder
      // (or the engine is at its governor), down when the one below pulls clearly harder
      const rpmOf = (g) => (roadW * ratio(p, g) * 60) / (2 * Math.PI);
      const pull = (g) => {
        const r = rpmOf(g);
        if (r > p.engine.max_rpm) return 0;
        return torqueAt(p.engine.torque_curve, Math.max(r, p.launchRpm)) * ratio(p, g);
      };
      const wantsPull = Math.abs(throttle) > 0.3;
      if (ds.gear < last && (rpmOf(ds.gear) > 0.97 * p.engine.max_rpm || (wantsPull && rpmOf(ds.gear + 1) > p.launchRpm * 0.9 && pull(ds.gear + 1) > pull(ds.gear)))) {
        ds.gear++;
        ds.shiftTimer = p.shiftTime;
      } else if (ds.gear > 0 && rpmOf(ds.gear - 1) < 0.9 * p.engine.max_rpm && ((wantsPull && pull(ds.gear - 1) > pull(ds.gear) * 1.25) || rpmOf(ds.gear) < p.engine.idle_rpm * 1.1)) {
        ds.gear--;
        ds.shiftTimer = p.shiftTime * 0.5;
      }
    }
    const rpm = clamp((wheelW * ratio(p, ds.gear) * 60) / (2 * Math.PI), p.launchRpm, p.engine.max_rpm);
    ds.rpm = clamp((wheelW * ratio(p, ds.gear) * 60) / (2 * Math.PI), p.engine.idle_rpm, p.engine.max_rpm);
    const governor = rpm <= 0.95 * p.engine.max_rpm ? 1 : clamp((p.engine.max_rpm - rpm) / (0.05 * p.engine.max_rpm), 0, 1);
    const torqueAvailable = torqueAt(p.engine.torque_curve, rpm) * governor * ratio(p, ds.gear) * p.efficiency;
    const tEngine = ds.shiftTimer > 0 ? 0 : torqueAvailable;
    // throttle up to the speed asked for; past it the engine holds back
    const vWant = throttle >= 0 ? throttle * p.vTop : throttle * p.maxReverseSpeed;
    const short = vWant - u;
    const pushing = Math.abs(vWant) > 0.05 && short * Math.sign(vWant) > 0;
    const transmitted = advanceDriveForce(ds, pushing ? Math.sign(vWant) : 0, torqueAvailable / tm.tyreR, tm.mass, h) * tm.tyreR;
    const drive = pushing ? Math.sign(vWant) * Math.min(tEngine, transmitted) * clamp(Math.abs(short) / 0.6, 0, 1) : -Math.sign(u) * ENGINE_BRAKE * tEngine * (Math.abs(throttle) < 0.05 ? 1 : 0.3);
    const perWheel = drive / Math.max(tm.driven, 1);
    // brakes: asked for, parking, or a reversal at speed
    const reversal = vWant * u < 0 && Math.abs(u) > 0.6;
    const parking = Math.abs(throttle) < 0.05 && Math.abs(u) < 0.8;
    const brake = reversal || parking ? 1 : clamp(input.brake, 0, 1);
    ds.braking = brake > 0.5;
    ds.reversing = reversing;
    ds.load = pushing ? clamp(Math.abs(drive) / Math.max(tEngine, 1), 0, 1) : 0;
    const brakeT = (brake * tm.mass * p.brakeDecel * tm.tyreR) / tm.wheels.length;

    contacts = [];
    const ey = body.ey;
    const upY = Math.max(0.3, ey[1]);
    tm.wheels.forEach((w, i) => {
      const ws = t.wheels[i];
      const sp = tm.springs[i];
      const off = broken && broken[w.side] && (w.z === Math.min(...tm.wheels.filter((q) => q.side === w.side).map((q) => q.z)) || false);
      const mount = body.worldPoint([w.x, w.y + MOUNT, w.z]);
      const ground = terrain.height(mount[0], mount[2]);
      const dist = (mount[1] - ground) / upY; // along the hull's vertical down to the ground
      const Lmax = MOUNT + tm.travel * 0.5;
      const Lmin = MOUNT - tm.travel;
      const L = dist - w.r;
      ws.steer = wheelSteer(tm, w, ds.steer);
      if (L >= Lmax || off) {
        // in the air: the wheel hangs at its stop and spins on
        ws.L = Lmax;
        ws.grounded = false;
        ws.load = 0;
        ws.omega += ((perWheel * (w.driven ? 1 : 0) - Math.sign(ws.omega) * Math.min(brakeT, Math.abs(ws.omega) * tm.wheelInertia / h)) / tm.wheelInertia) * h;
        ws.omega *= 0.998;
        return;
      }
      const Lc = Math.max(L, Lmin);
      const vL = (Lc - ws.L) / h;
      ws.L = Lc;
      let F = sp.preload + sp.k * (MOUNT - Lc) - sp.c * vL;
      if (L < Lmin) F += sp.k * 12 * (Lmin - L); // the bump stop
      F = Math.max(0, F);
      ws.grounded = true;
      ws.load = F;
      // the contact patch and the tyre's axes on the ground
      const P = add(mount, scale(ey, -(Lc + w.r)));
      const c = Math.cos(ws.steer);
      const sn = Math.sin(ws.steer);
      let fwd = add(scale(body.ez, c), scale(body.ex, sn));
      let lat = add(scale(body.ex, c), scale(body.ez, -sn));
      const gx = terrain.height(P[0] + 0.5, P[2]) - terrain.height(P[0] - 0.5, P[2]);
      const gz = terrain.height(P[0], P[2] + 0.5) - terrain.height(P[0], P[2] - 0.5);
      const gn = norm([-gx, 1, -gz]);
      fwd = norm(add(fwd, scale(gn, -dot(fwd, gn))));
      lat = norm(add(lat, scale(gn, -dot(lat, gn))));
      body.addForceAt(scale(ey, F), P);
      const v = body.pointVelocity(P);
      const vx = dot(v, fwd);
      const vy = dot(v, lat);
      const surf = terrain.surface(P[0], P[2]);
      const mu = surf.traction_mu ?? 0.8;
      const muL = surf.lateral_mu ?? mu;
      const roll = p.rollingResistance * (surf.rolling_mult ?? 1) * F;
      // the wheel's share of the hull it must move this step (for the grip not to overshoot)
      const mEff = tm.mass / tm.wheels.length;
      // along the wheel: slip between the rim and the ground
      const rim = ws.omega * w.r;
      const slipV = rim - vx;
      const satX = Math.max(MIN_SAT_SPEED, TYRE_SAT * Math.max(Math.abs(vx), Math.abs(rim)));
      let fx = clamp(slipV / satX, -1, 1) * mu * F;
      fx = clamp(fx, -Math.abs(slipV) / (h * (1 / mEff + (w.r * w.r) / tm.wheelInertia)), Math.abs(slipV) / (h * (1 / mEff + (w.r * w.r) / tm.wheelInertia)));
      // across: the slip angle, a sliding speed at a crawl
      const satY = Math.max(MIN_SAT_SPEED, Math.abs(vx) * Math.tan(SLIP_PEAK));
      let fy = -clamp(vy / satY, -1, 1) * muL * F;
      fy = clamp(fy, -Math.abs(vy) * mEff / h, Math.abs(vy) * mEff / h);
      // both inside the friction circle (ellipse)
      const e = Math.hypot(fx / (mu * F + 1e-6), fy / (muL * F + 1e-6));
      if (e > 1) {
        fx /= e;
        fy /= e;
      }
      // rolling loss against the motion
      const fr = -Math.sign(vx) * Math.min(roll, (Math.abs(vx) * mEff) / h);
      body.addForceAt(add(scale(fwd, fx + fr), scale(lat, fy)), P);
      // the wheel: drive, brake, the tyre's reaction
      let tq = (w.driven ? perWheel : 0) - fx * w.r;
      ws.omega += (tq / tm.wheelInertia) * h;
      const bstep = (brakeT / tm.wheelInertia) * h;
      ws.omega = Math.abs(ws.omega) <= bstep ? 0 : ws.omega - Math.sign(ws.omega) * bstep;
      ws.slip = Math.min(1, Math.abs(slipV) / Math.max(Math.abs(vx), Math.abs(rim), 1));
      ws.fx = fx;
      contacts.push({ p: P, n: gn, N: F, side: w.side, z: w.z, fl: fx, ft: fy, wheel: i });
    });
    if (t.obstacles && t.obstacles.length) t.obstacleContacts = applyObstacles(tm.collide, body, t.obstacles, tm.mass, h);
    const v = len(body.v);
    if (v > 0.01) body.addForce(scale(body.v, -0.5 * AIR_RHO * p.cdA * v));
    body.integrateVelocity(h);
    body.integratePosition(h);
    tm.wheels.forEach((w, i) => {
      const ws = t.wheels[i];
      ws.spin = (ws.spin + ws.omega * h) % (Math.PI * 2);
      t.travel[w.side] += (ws.omega * w.r * h) / (tm.wheels.length / 2);
    });
  }
  t.contacts = contacts;
  // the springs as the rest of the game reads them: lift from static (+ up), load, ground
  tm.wheels.forEach((w, i) => {
    const ws = t.wheels[i];
    t.ss.comp[i] = MOUNT - ws.L;
    t.ss.load[i] = ws.load;
    t.ss.grounded[i] = ws.grounded;
  });
  const att = body.attitude();
  const u = dot(body.v, body.ez);
  const w = dot(body.v, body.ex);
  const r = dot(body.w, body.ey);
  const half = Math.max(...tm.wheels.map((q) => q.x));
  const sideMean = (side, f) => {
    const list = tm.wheels.map((q, i) => [q, t.wheels[i]]).filter(([q]) => q.side === side);
    return list.reduce((a, [q, s]) => a + f(q, s), 0) / Math.max(list.length, 1);
  };
  const rimL = sideMean(-1, (q, s) => s.omega * q.r);
  const rimR = sideMean(1, (q, s) => s.omega * q.r);
  const slipL = sideMean(-1, (q, s) => s.slip);
  const slipR = sideMean(1, (q, s) => s.slip);
  const force = { 1: 0, [-1]: 0 };
  for (const c of contacts) force[c.side] += c.fl;
  t.info = {
    rpm: ds.rpm,
    gear: ds.gear,
    reversing: ds.reversing,
    speedKmh: u * 3.6,
    trackSlip: Math.max(slipL, slipR),
    yawRateDeg: (r * 180) / Math.PI,
    ax: (u - u0) / dt,
    lateralAcc: u * r,
    slipL,
    slipR,
    trackSpeedL: rimL,
    trackSpeedR: rimR,
    groundSpeedL: u + r * half,
    groundSpeedR: u - r * half,
    forceL: force[-1],
    forceR: force[1],
    braking: ds.braking,
    throttleLoad: ds.load,
    steerDeg: (ds.steer * 180) / Math.PI,
    heading: att.heading,
    pitch: att.pitch,
    roll: att.roll,
    u,
    w,
    r,
  };
  return t.info;
}

// ---------------------------------------------------------------- multiplayer

/** What is sent for a wheeled vehicle: as a tank's (netState in sim/tank), track = mean rim speeds. */
export function netStateWheeled(tm, t) {
  const b = t.body;
  const rim = (side) => {
    const list = tm.wheels.map((w, i) => [w, t.wheels[i]]).filter(([w]) => w.side === side);
    return list.reduce((a, [w, s]) => a + s.omega * w.r, 0) / Math.max(list.length, 1);
  };
  return { pos: b.origin(), ex: b.ex.slice(), ez: b.ez.slice(), v: b.v.slice(), w: b.w.slice(), track: [rim(-1), rim(1)], rpm: t.ds.rpm, gear: t.ds.gear, steer: t.ds.steer };
}

/** Puts a remote wheeled vehicle into the state the server sent. */
export function applyNetStateWheeled(tm, t, s) {
  const b = t.body;
  b.ex = s.ex.slice();
  b.ez = s.ez.slice();
  b.ey = cross(b.ez, b.ex);
  const d = b.worldDir(b.com);
  b.pos = [s.pos[0] + d[0], s.pos[1] + d[1], s.pos[2] + d[2]];
  b.v = s.v.slice();
  b.w = s.w.slice();
  t.ds.rpm = s.rpm;
  t.ds.gear = s.gear;
  t.remoteTrack = s.track;
  if (typeof s.steer === 'number') t.ds.steer = s.steer;
}

/** A remote wheeled vehicle's tyres: each on the ground under it within its travel, turning at the sent speeds. */
export function reconstructWheels(tm, t, terrain, dt) {
  const b = t.body;
  const upY = Math.max(0.3, b.ey[1]);
  tm.wheels.forEach((w, i) => {
    const ws = t.wheels[i];
    const mount = b.worldPoint([w.x, w.y + MOUNT, w.z]);
    const L = (mount[1] - terrain.height(mount[0], mount[2])) / upY - w.r;
    ws.L = clamp(L, MOUNT - tm.travel, MOUNT + tm.travel * 0.5);
    ws.grounded = L < MOUNT + tm.travel * 0.5;
    const rim = t.remoteTrack ? t.remoteTrack[w.side > 0 ? 1 : 0] : 0;
    ws.omega = rim / w.r;
    ws.spin = (ws.spin + ws.omega * dt) % (Math.PI * 2);
    ws.steer = wheelSteer(tm, w, t.ds.steer || 0);
    t.ss.comp[i] = MOUNT - ws.L;
    t.travel[w.side] += (rim * dt) / (tm.wheels.length / 2);
  });
}
