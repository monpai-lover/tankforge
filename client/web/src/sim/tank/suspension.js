// TEMPORARY JS mirror of crates/physics/src/tank/suspension.rs + road_wheel.rs.
//
// SuspensionSystem / RoadWheelSystem: one spring-damper station per road-wheel axle and side,
// each looking at the ground under its own wheel. A station pushes on the hull along the hull's
// up axis at its own mount point, so the hull's heave, pitch and roll come out of the sum of the
// station forces. Bogie suspensions (volute, HVSS, leaf-spring bogies) carry two neighbouring
// wheels on one pivoting arm whose spring acts at the pivot.
//
// The wheels stand on the track, not on the bare ground: the track bridges a dip narrower than
// the wheel spacing and wraps round a hump before the wheel reaches it (BRIDGE). Wheels have
// inertial coordinates owned by body.runningGear; springs couple those coordinates to the
// sprung remainder and unilateral terrain impulses support the complete assembly.
import { GRAVITY } from './body.js';
import { dot } from './math3.js';

export const BOGIE_KINDS = ['volute', 'hvss', 'leaf_bogie'];
/** How steeply the track can drop away from a high point between two wheels. */
export const BRIDGE = 0.6;
const BUMP_STOP = 30;
/** Compression damping is lighter than rebound damping (shares of the data value). */
const DAMP_COMPRESSION = 0.7;
const DAMP_REBOUND = 1.35;

/**
 * gear: {stations: [{z, y, r}] front first (wheel centre in the hull frame), trackX, trackWidth,
 *        thickness, front: {z, y, r}, rear: {z, y, r}} (sprocket / idler at each end)
 * opts: {mass, cgZ, travel, stiffness, damping (per station), freqHz, dampingRatio, kind}
 */
export function makeSuspension(gear, opts) {
  const per = gear.stations.length;
  const n = per * 2;
  const m = opts.mass;
  const stations = [];
  for (const side of [1, -1]) for (const s of gear.stations) stations.push({ z: s.z, y: s.y, r: s.r, x: side * gear.trackX, side });
  let k = opts.stiffness || 0;
  let c = opts.damping || 0;
  if (opts.freqHz || !(k > 0)) {
    const kTot = m * (2 * Math.PI * (opts.freqHz || 1.4)) ** 2;
    k = kTot / n;
    c = (2 * (opts.dampingRatio ?? 0.35) * Math.sqrt(kTot * m)) / n;
  }
  // keep the ride in the band real tracked vehicles ride in, whatever the data says
  const freq = Math.min(Math.max(Math.sqrt((k * n) / m) / (2 * Math.PI), 0.9), 2.4);
  k = (m * (2 * Math.PI * freq) ** 2) / n;
  const zetaWanted = c > 0 ? (c * n) / (2 * Math.sqrt(k * n * m)) : opts.dampingRatio ?? 0.35;
  const zeta = Math.min(Math.max(zetaWanted, 0.15), 0.7);
  c = (2 * zeta * Math.sqrt(k * n * m)) / n;

  // static load of each station: the hull rests level with the centre of gravity where it is
  const zm = gear.stations.reduce((a, s) => a + s.z, 0) / per;
  const zz = gear.stations.reduce((a, s) => a + (s.z - zm) ** 2, 0) || 1;
  const cgZ = opts.cgZ ?? 0;
  const mean = (m * GRAVITY) / n;
  const preload = gear.stations.map((s) => Math.max(0.25 * mean, mean + (mean * per * (cgZ - zm) * (s.z - zm)) / zz));
  const sc = (m * GRAVITY) / (2 * preload.reduce((a, b) => a + b, 0));
  for (let i = 0; i < per; i++) preload[i] *= sc;

  const travel = opts.travel ?? 0.18;
  const sag = mean / k;
  const rebound = Math.min(sag, Math.max(0.04, 0.45 * travel));

  const bogie = BOGIE_KINDS.includes(opts.kind);
  const units = [];
  for (const side of [1, -1]) {
    const base = side > 0 ? 0 : per;
    for (let i = 0; i < per; ) {
      const pair = bogie && i + 1 < per;
      const members = pair ? [base + i, base + i + 1] : [base + i];
      const mz = members.reduce((a, j) => a + stations[j].z, 0) / members.length;
      const my = members.reduce((a, j) => a + stations[j].y, 0) / members.length;
      units.push({
        members,
        mount: [side * gear.trackX, my, mz],
        side,
        k: k * members.length,
        c: c * members.length,
        p: members.reduce((a, j) => a + preload[j % per], 0),
        lim: pair ? Math.max(0.06, 0.6 * travel) : 0,
        heave: pair ? [base + i, 0.5, base + i + 1, 0.5] : [base + i, 1],
        rock: pair ? [base + i, 0.5, base + i + 1, -0.5] : null,
        rockK: pair ? 0.05 * k * members.length : 0,
        rockC: pair ? Math.sqrt(0.05) * c * members.length : 0,
      });
      i += members.length;
    }
  }
  const fw = gear.stations[0];
  const rw = gear.stations[per - 1];
  const spacing = per > 1 ? (fw.z - rw.z) / (per - 1) : 1;
  return {
    stations,
    units,
    k,
    c,
    freq,
    zeta,
    preload,
    travel,
    rebound,
    sag,
    window: Math.max(0.75 * spacing, fw.r),
    thickness: gear.thickness,
  };
}

/** Per-station / per-unit state. */
export function newSuspensionState(sp) {
  return {
    wheelWeights: sp.stations.map((_, i) => [i, 1]),
    normals: sp.stations.map(() => [0, 1, 0]),
    comp: sp.stations.map(() => 0), // wheel height against the hull, from static (+ up)
    grounded: sp.stations.map(() => false),
    support: sp.stations.map(() => 0), // world height of the track under the wheel
    contact: sp.stations.map(() => [0, 0, 0]), // world point where the wheel's track meets the ground
    load: sp.stations.map(() => 0), // N carried by each wheel
    unitX: sp.units.map(() => 0),
    unitV: sp.units.map(() => 0),
    spring: sp.units.map(() => 0),
    damper: sp.units.map(() => 0),
    force: sp.units.map(() => 0),
  };
}

/**
 * Height of the track under station i (world y), from the ground profile along its side.
 * prof: {zs (hull-frame z of each sample), h: world heights, run: track height above the ground
 * line at each sample (<0 on the ground run)}
 */
export function supportUnder(sp, prof, s, bare = false) {
  const zs = prof.zs;
  const g = prof.h;
  let j = 1;
  while (j < zs.length - 1 && zs[j] < s.z) j++;
  const u = Math.min(Math.max((s.z - zs[j - 1]) / (zs[j] - zs[j - 1]), 0), 1);
  let best = g[j - 1] + (g[j] - g[j - 1]) * u;
  for (let k = 0; k < zs.length; k++) {
    const dz = Math.abs(zs[k] - s.z);
    if (dz > sp.window || prof.run[k] >= 0 || (bare && dz >= s.r)) continue;
    // the wheel is round; past its rim the track falls away at the bridging angle
    const round = dz < s.r ? s.r - Math.sqrt(s.r * s.r - dz * dz) : Infinity;
    const v = g[k] - (bare ? round : Math.min(round, BRIDGE * dz));
    if (v > best) best = v;
  }
  return best;
}

/**
 * One substep: every station finds its ground, every unit pushes the hull at its mount.
 * profiles: {1: prof, -1: prof} (right, left). Returns the total vertical load per side.
 */
function stationNormal(profiles, body, station, out) {
  const a = profiles[station.side], o = profiles[-station.side];
  let k = 1;
  while (k < a.zs.length - 2 && a.zs[k] < station.z) k++;
  const along = (a.h[k + 1] - a.h[k - 1]) / (a.zs[k + 1] - a.zs[k - 1]);
  const across = (station.side > 0 ? a.h[k] - o.h[k] : o.h[k] - a.h[k]) / (2 * Math.abs(station.x));
  const fl = Math.hypot(body.ez[0], body.ez[2]) || 1;
  const fx = body.ez[0] / fl, fz = body.ez[2] / fl;
  const nx = -along * fx - across * fz, nz = -along * fz + across * fx;
  const nl = Math.hypot(nx, 1, nz);
  out[0] = nx / nl; out[1] = 1 / nl; out[2] = nz / nl;
}

export function syncSuspensionPose(sp, st, body, broken = null) {
  const rg = body.runningGear;
  for (let i = 0; i < sp.stations.length; i++) {
    const s = sp.stations[i];
    st.comp[i] = rg.q[i];
    const thickness = broken?.[s.side] ? 0 : sp.thickness;
    body.worldPointIntoXYZ(s.x, s.y + rg.q[i] - s.r - thickness, s.z, st.contact[i]);
  }
}

function solveSpring(sp, st, body, u, ui, weights, isRock, dt) {
  const rg = body.runningGear;
  let x = 0, v = 0;
  for (let k = 0; k < weights.length; k += 2) { x += weights[k + 1] * rg.q[weights[k]]; v += weights[k + 1] * rg.qv[weights[k]]; }
  let k = isRock ? u.rockK : u.k;
  let c = isRock ? u.rockC : u.c * (v > 0 ? DAMP_COMPRESSION : DAMP_REBOUND);
  let p = isRock ? 0 : u.p;
  const limit = isRock ? u.lim : sp.travel;
  const low = isRock ? -u.lim : -sp.rebound;
  const predicted = x + dt * v;
  if (predicted > limit) { p -= BUMP_STOP * u.k * limit; k += BUMP_STOP * u.k; c += 3 * u.c; }
  if (predicted < low) { p -= BUMP_STOP * u.k * low; k += BUMP_STOP * u.k; c += 3 * u.c; }
  const impulse = isRock ? rg.rockImpulse : rg.springImpulse;
  const cache = rg.relativeResponses[2 * ui + (isRock ? 1 : 0)];
  const inv = cache.invMass;
  const d = (-impulse[ui] - dt * (p + k * x + (c + dt * k) * v)) / (1 + dt * (c + dt * k) * inv);
  impulse[ui] += d;
  body.applyCachedResponse(cache, d);
  if (!isRock) {
    st.unitX[ui] = x; st.unitV[ui] = v;
    st.spring[ui] = p + k * x; st.force[ui] = -impulse[ui] / dt;
    st.damper[ui] = st.force[ui] - st.spring[ui];
  }
}

/** Internal spring impulses use only relative generalized coordinates: no duplicate hull force. */
export function applySuspension(sp, st, body, profiles, dt, broken = null) {
  const rg = body.runningGear;
  rg.normalImpulse.fill(0); rg.springImpulse.fill(0); rg.rockImpulse.fill(0);
  syncSuspensionPose(sp, st, body, broken);
  const normals = st.normals;
  for (let i = 0; i < sp.stations.length; i++) {
    const s = sp.stations[i];
    st.support[i] = supportUnder(sp, profiles[s.side], s, !!broken?.[s.side]);
    stationNormal(profiles, body, s, normals[i]);
    st.load[i] = 0; st.grounded[i] = false;
    body.contactResponse(normals[i], st.contact[i], st.wheelWeights[i], rg.normalResponses[i]);
  }
  for (let ui = 0; ui < sp.units.length; ui++) {
    const u = sp.units[ui];
    body.relativeResponse(u.heave, rg.relativeResponses[2 * ui]);
    if (u.rock) body.relativeResponse(u.rock, rg.relativeResponses[2 * ui + 1]);
  }

  // The spring and normal impulses are iterated together, so grounded preload does not depend
  // on an airborne prediction of spring velocity. Impulses are reset on every contact loss.
  for (let iteration = 0; iteration < 12; iteration++) {
    for (let ui = 0; ui < sp.units.length; ui++) {
      const u = sp.units[ui];
      solveSpring(sp, st, body, u, ui, u.heave, false, dt);
      if (u.rock) solveSpring(sp, st, body, u, ui, u.rock, true, dt);
    }
    for (let i = 0; i < sp.stations.length; i++) {
      const p = st.contact[i], n = normals[i], weights = st.wheelWeights[i];
      const pen = (st.support[i] - p[1]) * n[1];
      const vn = body.pointVelocityAlong(p, n, weights);
      if (rg.normalImpulse[i] === 0 && pen < -0.00001 && pen - vn * dt < 0) { rg.normalImpulse[i] = 0; continue; }
      const target = pen >= 0 ? 0.25 * pen / dt : pen / dt;
      const cache = rg.normalResponses[i], inv = cache.invMass;
      const want = Math.max(0, rg.normalImpulse[i] + (target - vn) / inv);
      const d = want - rg.normalImpulse[i];
      rg.normalImpulse[i] = want;
      body.applyCachedResponse(cache, d);
    }
  }
  const sideLoad = { 1: 0, [-1]: 0 };
  for (let i = 0; i < sp.stations.length; i++) {
    st.load[i] = rg.normalImpulse[i] / dt;
    st.grounded[i] = st.load[i] > 0;
    sideLoad[sp.stations[i].side] += st.load[i];
  }
  return sideLoad;
}
