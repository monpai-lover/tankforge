// TEMPORARY JS mirror of crates/physics/src/tank/suspension.rs + road_wheel.rs.
//
// SuspensionSystem / RoadWheelSystem: one spring-damper station per road-wheel axle and side,
// each looking at the ground under its own wheel. A station pushes on the hull along the hull's
// up axis at its own mount point, so the hull's heave, pitch and roll come out of the sum of the
// station forces. Bogie suspensions (volute, HVSS, leaf-spring bogies) carry two neighbouring
// wheels on one pivoting arm whose spring acts at the pivot.
//
// The wheels stand on the track, not on the bare ground: the track bridges a dip narrower than
// the wheel spacing and wraps round a hump before the wheel reaches it (BRIDGE). Wheels have no
// mass of their own, so they follow the ground at once while the hull, with all the mass, follows
// through the springs: wheel response is faster than hull response.
import { GRAVITY } from './body.js';

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
    comp: sp.stations.map(() => 0), // wheel height against the hull, from static (+ up)
    grounded: sp.stations.map(() => false),
    support: sp.stations.map(() => 0), // world height of the track under the wheel
    contact: sp.stations.map(() => [0, 0, 0]), // world point where the wheel's track meets the ground
    load: sp.stations.map(() => 0), // N carried by each wheel
    unitX: sp.units.map(() => 0),
    unitV: sp.units.map(() => 0),
    unitPrev: sp.units.map(() => null),
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
export function supportUnder(sp, prof, s) {
  const zs = prof.zs;
  const g = prof.h;
  let j = 1;
  while (j < zs.length - 1 && zs[j] < s.z) j++;
  const u = Math.min(Math.max((s.z - zs[j - 1]) / (zs[j] - zs[j - 1]), 0), 1);
  let best = g[j - 1] + (g[j] - g[j - 1]) * u;
  for (let k = 0; k < zs.length; k++) {
    const dz = Math.abs(zs[k] - s.z);
    if (dz > sp.window || prof.run[k] >= 0) continue;
    // the wheel is round; past its rim the track falls away at the bridging angle
    const round = dz < s.r ? s.r - Math.sqrt(s.r * s.r - dz * dz) : Infinity;
    const v = g[k] - Math.min(round, BRIDGE * dz);
    if (v > best) best = v;
  }
  return best;
}

/**
 * One substep: every station finds its ground, every unit pushes the hull at its mount.
 * profiles: {1: prof, -1: prof} (right, left). Returns the total vertical load per side.
 */
export function applySuspension(sp, st, body, profiles, dt) {
  const upY = Math.max(0.2, body.ey[1]);
  const xc = sp.stations.map((s, i) => {
    const prof = profiles[s.side];
    const sup = supportUnder(sp, prof, s);
    st.support[i] = sup;
    // the wheel centre must stand r + track thickness above the track's ground line
    const h = body.worldPoint([s.x, s.y, s.z])[1];
    return (sup + s.r + sp.thickness - h) / upY;
  });
  const sideLoad = { 1: 0, [-1]: 0 };
  sp.units.forEach((u, ui) => {
    const m = u.members;
    const a = xc[m[0]];
    const b = m.length > 1 ? xc[m[1]] : a;
    // a bogie arm takes the mean of its two wheels, until one of them reaches the end of its swing
    const want = m.length > 1 ? Math.max((a + b) / 2, Math.max(a, b) - u.lim) : a;
    const prev = st.unitPrev[ui] ?? want;
    st.unitPrev[ui] = want;
    const grounded = want >= -sp.rebound;
    const x = grounded ? want : -sp.rebound;
    const xv = grounded ? (want - prev) / dt : 0;
    let spring = 0;
    let damper = 0;
    if (grounded) {
      spring = u.p + u.k * x;
      damper = u.c * xv * (xv > 0 ? DAMP_COMPRESSION : DAMP_REBOUND);
      if (x > sp.travel) {
        spring += BUMP_STOP * u.k * (x - sp.travel);
        damper += 3 * u.c * Math.max(xv, 0);
      }
    }
    // a stop is stiff, not infinite: a wheel can be thrown hard, but not launch the hull
    const f = Math.min(Math.max(0, spring + damper), 30 * u.p);
    st.unitX[ui] = x;
    st.unitV[ui] = xv;
    st.spring[ui] = grounded ? spring : 0;
    st.damper[ui] = f > 0 ? f - spring : 0;
    st.force[ui] = f;
    if (f > 0) body.addForceAt([body.ey[0] * f, body.ey[1] * f, body.ey[2] * f], body.worldPoint(u.mount));
    sideLoad[u.side] += f;
    // where each wheel sits: on its ground, or hanging from the rebound stop
    let swing = 0;
    if (m.length > 1) {
      if (grounded) swing = Math.max(-u.lim, Math.min(u.lim, (a - b) / 2));
      else {
        // a hanging bogie still pivots: the higher wheel rests on its ground, the other drops
        const hi = Math.max(a, b);
        const up = Math.max(0, Math.min(u.lim, hi - x));
        swing = a >= b ? up : -up;
      }
    }
    m.forEach((i, j) => {
      const wx = m.length > 1 || grounded ? x + (j === 0 ? swing : -swing) : -sp.rebound;
      st.comp[i] = wx;
      st.grounded[i] = xc[i] >= wx - 0.02;
      st.load[i] = (f / m.length) * (st.grounded[i] ? 1 : 0);
      const s = sp.stations[i];
      st.contact[i] = body.worldPoint([s.x, s.y + wx - s.r - sp.thickness, s.z]);
    });
    if (m.length > 1) {
      // the arm shares its load by where the wheels stand
      const [i0, i1] = m;
      const g0 = st.grounded[i0];
      const g1 = st.grounded[i1];
      if (g0 !== g1) {
        st.load[i0] = g0 ? f : 0;
        st.load[i1] = g1 ? f : 0;
      }
    }
  });
  return sideLoad;
}
