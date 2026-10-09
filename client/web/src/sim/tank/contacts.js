// TEMPORARY JS mirror of crates/physics/src/tank/terrain.rs + track_contact.rs.
//
// TerrainContactSystem: samples the ground along both tracks (one row per side, every 0.1 m in
// the hull frame), and pushes on the hull where the ground reaches something rigid: the runs of
// track rising to the sprocket and idler, and the hull's belly.
// TrackContactSystem: 8-16 contact samples along each track's ground run. Each carries the load of
// the road wheels near it and the friction between the track and the ground: the slip between
// the track's own speed and the ground under it decides how much force the ground gives, along
// the track and across it, inside a friction ellipse (lateral grip falls away while a track spins,
// and a fast turn slides). The friction is solved as impulses, so a braked tank holds on a slope
// without creeping and nothing overshoots at any stiffness.
import { add, sub, scale, dot, cross, norm, clamp } from './math3.js';
import { shearRatio } from '../terra.js';

const RUN_K = 6; // in units of one station's spring rate: the idler and the run of track to it are nearly rigid
const RUN_C = 4;
const BELLY_K = 25;
const BELLY_MU = 0.45;
/** A track skids sideways more easily than it grips along (grousers cut the ground across, links pivot). */
const TRACK_LATERAL = 0.6;
// rolling drag of bare road wheels on the ground (a thrown track), as a friction coefficient
const BARE_ROLL = 0.06;
// what is left of the drive with one track: a share of the speed and of the push
const ONE_TRACK_SPEED = 0.2;
const ONE_TRACK_FORCE = 0.12;

/**
 * Geometry of the ground rows and contact samples.
 * gear: as makeSuspension; sp: the suspension. contactsPerSide 8..16.
 */
export function makeContacts(gear, sp, opts = {}) {
  const per = gear.stations.length;
  const fw = gear.stations[0];
  const rw = gear.stations[per - 1];
  const ground = Math.min(...gear.stations.map((s) => s.y - s.r)) - gear.thickness; // static track bottom
  const end = (c) => ({ z: c.z, r: c.r, h: Math.max(0.02, c.y - c.r - gear.thickness / 2 - ground) });
  const sprocketFront = gear.sprocket.z > gear.idler.z;
  const front = end(sprocketFront ? gear.sprocket : gear.idler);
  const rear = end(sprocketFront ? gear.idler : gear.sprocket);
  const z0 = rear.z - rear.r * 0.8;
  const z1 = front.z + front.r * 0.8;
  const count = Math.max(8, Math.ceil((z1 - z0) / 0.1) + 1);
  const zs = new Float64Array(count);
  const run = new Float64Array(count).fill(-1);
  const runAt = (z, wheel, e, dir) => {
    const start = wheel.z + dir * wheel.r * 0.35;
    if ((z - start) * dir <= 0) return -1;
    const d = (e.z - z) * dir;
    if (d >= 0) return (e.h * (z - start)) / (e.z - start);
    const q = Math.min(-d, e.r * 0.95);
    return e.h + e.r - Math.sqrt(e.r * e.r - q * q);
  };
  for (let i = 0; i < count; i++) {
    const z = z0 + ((z1 - z0) * i) / (count - 1);
    zs[i] = z;
    if (z > fw.z) run[i] = runAt(z, fw, front, 1);
    else if (z < rw.z) run[i] = runAt(z, rw, rear, -1);
  }
  const nc = clamp(opts.contactsPerSide ?? 12, 8, 16);
  const cz = [];
  for (let i = 0; i < nc; i++) cz.push(rw.z + ((fw.z - rw.z) * (i + 0.5)) / nc);
  // belly: a grid between the tracks, on the hull floor
  const inner = Math.max(0.2, gear.trackX - gear.trackWidth / 2 - 0.05);
  const belly = [];
  for (const x of [-inner, 0, inner]) for (let i = 0; i < 5; i++) belly.push([x, opts.bellyY ?? 0.4, rw.z + ((fw.z - rw.z) * i) / 4]);
  const runSamples = Math.max(1, run.reduce((a, h) => a + (h >= 0 ? 1 : 0), 0) / 2);
  const share = Math.min(1, 6 / runSamples);
  return {
    zs,
    run,
    ground,
    front,
    rear,
    cz,
    contactLength: fw.z - rw.z + (fw.r + rw.r) * 0.5,
    trackWidth: gear.trackWidth,
    trackX: gear.trackX,
    belly,
    runK: RUN_K * sp.k * share,
    runC: RUN_C * sp.c * share,
    bellyK: BELLY_K * sp.k,
    bellyC: 4 * sp.c,
  };
}

export function newContactState(ct) {
  return {
    prof: {
      1: { zs: ct.zs, run: ct.run, h: new Float64Array(ct.zs.length), pts: [] },
      [-1]: { zs: ct.zs, run: ct.run, h: new Float64Array(ct.zs.length), pts: [] },
    },
    runPrev: { 1: new Float64Array(ct.zs.length), [-1]: new Float64Array(ct.zs.length) },
    bellyPrev: new Float64Array(ct.belly.length),
    samples: [], // last friction contacts, for debug / deformation / effects
    slip: { 1: 0, [-1]: 0 },
    groundForce: { 1: 0, [-1]: 0 },
    belly: 0,
  };
}

/** Samples the ground under both tracks. terrain.height(x, z) -> world y. */
export function sampleGround(ct, cs, body, terrain) {
  for (const side of [1, -1]) {
    const prof = cs.prof[side];
    const x = side * ct.trackX;
    prof.pts.length = ct.zs.length;
    for (let k = 0; k < ct.zs.length; k++) {
      const h = ct.run[k] >= 0 ? ct.ground + ct.run[k] : ct.ground;
      const p = body.worldPoint([x, h, ct.zs[k]]);
      prof.pts[k] = p;
      prof.h[k] = terrain.height(p[0], p[2]);
    }
  }
}

/** Ground normal at sample k of `side`, from the two ground rows. */
function groundNormal(ct, cs, body, side, z) {
  const a = cs.prof[side];
  const o = cs.prof[-side];
  const zs = ct.zs;
  let k = 1;
  while (k < zs.length - 2 && zs[k] < z) k++;
  const dz = zs[k + 1] - zs[k - 1];
  const along = (a.h[k + 1] - a.h[k - 1]) / dz;
  const across = ((side > 0 ? a.h[k] - o.h[k] : o.h[k] - a.h[k]) / (2 * ct.trackX));
  // horizontal forward / right of the hull
  const f = norm([body.ez[0], 0, body.ez[2]]);
  const r = [f[2], 0, -f[0]];
  return norm([-along * f[0] - across * r[0], 1, -along * f[2] - across * r[2]]);
}

/**
 * Rigid contacts (track runs to the end wheels, the belly): penalty forces, only pushing.
 * Returns extra friction contacts (with their normal loads).
 */
export function applyRigidContacts(ct, cs, body, terrain, surfaceOf, dt, sp, ss) {
  const extra = [];
  const per = sp.stations.length / 2;
  for (const side of [1, -1]) {
    const prof = cs.prof[side];
    const prev = cs.runPrev[side];
    const base = side > 0 ? 0 : per;
    const fw = sp.stations[base];
    const rw = sp.stations[base + per - 1];
    for (let k = 0; k < ct.zs.length; k++) {
      if (ct.run[k] < 0) continue;
      // the run leaves the end road wheel where that wheel is now, and reaches the fixed end wheel
      const z = ct.zs[k];
      const front = z > 0;
      const w = front ? fw : rw;
      const e = front ? ct.front : ct.rear;
      const u = clamp((z - w.z) / (e.z - w.z), 0, 1);
      const lift = ss.comp[front ? base : base + per - 1] * (1 - u);
      const pw = body.worldPoint([side * ct.trackX, ct.ground + ct.run[k] + lift, z]);
      const pen = prof.h[k] - pw[1];
      const rate = (pen - prev[k]) / dt;
      prev[k] = pen;
      if (pen <= 0) continue;
      const f = Math.min(ct.runK * pen + ct.runC * Math.max(rate, 0), ct.runK * 0.3);
      const n = groundNormal(ct, cs, body, side, ct.zs[k]);
      body.addForceAt(scale(n, f), pw);
      extra.push({ p: pw, n, N: f, side, surface: surfaceOf(pw[0], pw[2]) });
    }
  }
  let belly = 0;
  ct.belly.forEach((b, i) => {
    const pw = body.worldPoint(b);
    const h = terrain.height(pw[0], pw[2]);
    const pen = h - pw[1];
    const rate = (pen - cs.bellyPrev[i]) / dt;
    cs.bellyPrev[i] = pen;
    if (pen <= 0) return;
    const f = Math.min(ct.bellyK * pen + ct.bellyC * Math.max(rate, 0), ct.bellyK * 0.15);
    body.addForceAt([0, f, 0], pw);
    belly += f;
    extra.push({ p: pw, n: [0, 1, 0], N: f, side: 0, surface: { traction_mu: BELLY_MU, lateral_mu: BELLY_MU } });
  });
  cs.belly = belly;
  return extra;
}

/**
 * Friction contacts along each track's ground run, carrying the loads of the wheels near them.
 * wheels: the suspension (sp) and its state (ss).
 */
export function trackContacts(ct, cs, body, sp, ss, surfaceOf) {
  const out = [];
  const per = sp.stations.length / 2;
  for (const side of [1, -1]) {
    const base = side > 0 ? 0 : per;
    const st = sp.stations.slice(base, base + per);
    const bottom = st.map((s, i) => s.y + ss.comp[base + i] - s.r - sp.thickness);
    const spacing = per > 1 ? (st[0].z - st[per - 1].z) / (per - 1) : 1;
    // tent weights: each wheel's load goes to the samples within one wheel spacing of it
    const w = ct.cz.map((z) => st.map((s) => Math.max(0, 1 - Math.abs(z - s.z) / spacing)));
    const wsum = st.map((_, i) => w.reduce((a, row) => a + row[i], 0) || 1);
    ct.cz.forEach((z, k) => {
      let N = 0;
      for (let i = 0; i < per; i++) N += (ss.load[base + i] * w[k][i]) / wsum[i];
      // the track's lower run between the wheels
      let j = 0;
      while (j < per - 2 && st[j + 1].z > z) j++;
      const a = st[j];
      const b = st[j + 1] || a;
      const u = a === b ? 0 : clamp((a.z - z) / (a.z - b.z), 0, 1);
      const y = bottom[j] + ((bottom[j + 1] ?? bottom[j]) - bottom[j]) * u;
      const p = body.worldPoint([side * ct.trackX, y, z]);
      const n = groundNormal(ct, cs, body, side, z);
      out.push({ p, n, N, side, surface: surfaceOf(p[0], p[2]), z });
    });
  }
  return out;
}

/**
 * Friction as impulses (projected Gauss-Seidel). belts: {1: {v, m}, -1: {v, m}} track speeds
 * (the ground run moves backwards relative to the hull at v) and their effective masses.
 * brakes: {1: N, -1: N} brake force on each track. Each contact's longitudinal friction moves
 * both the hull (+J) and its track (-J / m_belt).
 */
export function solveFriction(contacts, body, belts, brakes, dt, iterations = 8, motor = null) {
  const prep = contacts.filter((c) => c.N > 0);
  // a broken track (shot off) no longer runs round its wheels: the bare road wheels roll on the
  // ground on that side, and the engine drives the other track alone
  const broken = motor && motor.broken ? motor.broken : null;
  const off = (side) => !!(broken && side && broken[side]);
  for (const c of prep) {
    // tangent directions in the ground plane: along the hull and across it
    let tl = sub(body.ez, scale(c.n, dot(body.ez, c.n)));
    tl = norm(tl);
    c.tl = tl;
    c.tt = cross(c.n, tl);
    c.bare = off(c.side);
    const belt = c.side && !c.bare ? belts[c.side] : null;
    c.kl = 1 / (body.invMassAlong(tl, c.p) + (belt ? 1 / belt.m : 0));
    c.kt = 1 / body.invMassAlong(c.tt, c.p);
    const s = c.surface;
    const vp = body.pointVelocity(c.p);
    const vl = dot(vp, tl) - (belt ? belt.v : 0);
    // soil needs some slip to carry thrust (Janosi-Hanamoto); hard ground grips at once
    let mul = s.traction_mu;
    if (s.soil && belt) {
      const i = Math.abs(vl) / Math.max(Math.abs(belt.v), Math.abs(dot(vp, tl)), 0.5);
      mul *= Math.max(0.15, shearRatio(i, s.soil.K, 3.6));
    }
    // bare wheels roll: only their rolling drag holds them along the hull
    c.Ll = (c.bare ? BARE_ROLL : mul) * c.N * dt;
    c.Lt = s.lateral_mu * (belt ? TRACK_LATERAL : 1) * c.N * dt;
    c.jl = 0;
    c.jt = 0;
    c.slip = vl;
  }
  const jb = { 1: 0, [-1]: 0 };
  let jm = 0;
  let js = 0;
  const L = belts[-1];
  const R = belts[1];
  for (let it = 0; it < iterations; it++) {
    if (motor && broken && (broken[1] || broken[-1])) {
      // one track (or none) left: the drive line's free shaft on the broken side takes most of
      // the engine's effort, so the good track pushes weakly and slowly -- the vehicle crawls
      // round on it rather than drives
      for (const side of [1, -1]) {
        if (broken[side]) continue;
        const b = belts[side];
        const target = (motor.mean + (side < 0 ? 0.5 : -0.5) * motor.diff) * ONE_TRACK_SPEED;
        const cap = motor.meanCap * ONE_TRACK_FORCE * dt;
        const prev = side < 0 ? js : jm;
        const want = clamp(prev + (target - b.v) * b.m, -cap, cap);
        b.v += (want - prev) / b.m;
        if (side < 0) js = want;
        else jm = want;
      }
    } else if (motor) {
      // engine: both tracks together towards the mean target (impulse split between them)
      const mean = (L.v + R.v) / 2;
      const capM = motor.meanCap * dt;
      const wantM = clamp(jm + (motor.mean - mean) * (L.m + R.m), -capM, capM);
      L.v += (wantM - jm) / (L.m + R.m);
      R.v += (wantM - jm) / (L.m + R.m);
      jm = wantM;
      // steering gear: a force pair holding the difference between the tracks
      const diff = L.v - R.v;
      const capS = motor.diffCap * dt;
      const mPair = 1 / (1 / L.m + 1 / R.m);
      const wantS = clamp(js + (motor.diff - diff) * mPair, -capS, capS);
      L.v += (wantS - js) / L.m;
      R.v -= (wantS - js) / R.m;
      js = wantS;
    }
    for (const side of [1, -1]) {
      // brakes hold the track against the hull
      const b = belts[side];
      const lim = (brakes[side] || 0) * dt;
      if (lim > 0) {
        const want = clamp(jb[side] - b.v * b.m, -lim, lim);
        b.v += (want - jb[side]) / b.m;
        jb[side] = want;
      }
    }
    for (const c of prep) {
      const belt = c.side && !c.bare ? belts[c.side] : null;
      const vp = body.pointVelocity(c.p);
      const vl = dot(vp, c.tl) - (belt ? belt.v : 0);
      const vt = dot(vp, c.tt);
      let jl = c.jl - vl * c.kl;
      let jt = c.jt - vt * c.kt;
      // inside the friction ellipse the contact sticks; outside it slides, and sliding friction
      // opposes the way it slides (not the way it would have liked to stop)
      if ((jl / c.Ll) ** 2 + (jt / c.Lt) ** 2 > 1) {
        const sl = vl + (c.jl - jl) * 0; // current slip, before this contact's correction
        const sv = Math.hypot(vl, vt);
        if (sv > 1e-6) {
          jl = (-c.Ll * vl) / sv;
          jt = (-c.Lt * vt) / sv;
          // the slide may not reverse within the step: take the smaller of the two along each axis
          if (Math.abs(jl - c.jl) > Math.abs(vl * c.kl)) jl = c.jl - vl * c.kl;
          if (Math.abs(jt - c.jt) > Math.abs(vt * c.kt)) jt = c.jt - vt * c.kt;
          void sl;
        } else {
          const k = 1 / Math.sqrt((jl / c.Ll) ** 2 + (jt / c.Lt) ** 2);
          jl *= k;
          jt *= k;
        }
      }
      const dl = jl - c.jl;
      const dtt = jt - c.jt;
      c.jl = jl;
      c.jt = jt;
      body.applyImpulseAt(add(scale(c.tl, dl), scale(c.tt, dtt)), c.p);
      if (belt) belt.v -= dl / belt.m;
    }
  }
  for (const c of prep) {
    c.fl = c.jl / dt;
    c.ft = c.jt / dt;
  }
  if (motor) {
    if (broken && (broken[1] || broken[-1])) {
      // report it as the usual pair: what the good track pushes, split as mean and steer
      const fl = js / dt;
      const fr = jm / dt;
      motor.fMean = fl + fr;
      motor.fSteer = (fl - fr) / 2;
    } else {
      motor.fMean = jm / dt;
      motor.fSteer = js / dt;
    }
  }
  return prep;
}
