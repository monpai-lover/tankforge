// TEMPORARY JS mirror of crates/ballistics (tg-ballistics): gravity + quadratic drag,
// semi-implicit Euler, plus the range table the gunner sight graduations are drawn from.

export const ATMOSPHERE = { airDensity: 1.225, gravity: 9.80665 };

export function newShot(pos, dir, def) {
  const r = def.caliber_mm * 0.0005;
  return {
    pos: [pos[0], pos[1], pos[2]],
    vel: [dir[0] * def.muzzle_velocity_ms, dir[1] * def.muzzle_velocity_ms, dir[2] * def.muzzle_velocity_ms],
    mass: def.mass_kg,
    area: Math.PI * r * r,
    cd: def.drag_coefficient,
  };
}

export function stepShot(s, dt, atm = ATMOSPHERE) {
  const v = Math.hypot(s.vel[0], s.vel[1], s.vel[2]);
  const k = (0.5 * atm.airDensity * s.cd * s.area * v) / s.mass;
  s.vel[0] += -k * s.vel[0] * dt;
  s.vel[1] += (-k * s.vel[1] - atm.gravity) * dt;
  s.vel[2] += -k * s.vel[2] * dt;
  s.pos[0] += s.vel[0] * dt;
  s.pos[1] += s.vel[1] * dt;
  s.pos[2] += s.vel[2] * dt;
}

/** Height (relative to the muzzle) and flight data when the shell has travelled `range` horizontally. */
export function flyTo(def, elevation, range, dt = 1 / 500, atm = ATMOSPHERE) {
  const s = newShot([0, 0, 0], [0, Math.sin(elevation), Math.cos(elevation)], def);
  let t = 0;
  let prevZ = 0;
  let prevY = 0;
  for (let i = 0; i < 20000; i++) {
    stepShot(s, dt, atm);
    t += dt;
    if (s.pos[2] >= range) {
      const f = (range - prevZ) / Math.max(s.pos[2] - prevZ, 1e-9);
      return { height: prevY + (s.pos[1] - prevY) * f, tof: t - dt + dt * f, speed: Math.hypot(s.vel[0], s.vel[1], s.vel[2]) };
    }
    if (s.vel[2] <= 1) break;
    prevZ = s.pos[2];
    prevY = s.pos[1];
  }
  return null;
}

/** Gun elevation (rad) that hits a target at the same height as the muzzle at `range` m. */
export function elevationForRange(def, range, atm = ATMOSPHERE, maxElevation = 0.35) {
  let lo = 0;
  let hi = maxElevation;
  const top = flyTo(def, hi, range, 1 / 500, atm);
  if (!top || top.height < 0) return null;
  let tof = 0;
  let speed = 0;
  for (let i = 0; i < 36; i++) {
    const mid = (lo + hi) / 2;
    const r = flyTo(def, mid, range, 1 / 500, atm);
    if (!r || r.height < 0) lo = mid;
    else {
      hi = mid;
      tof = r.tof;
      speed = r.speed;
    }
  }
  return { elevation: hi, tof, speed };
}

/** [{range, elevation, tof, speed}] for the sight's distance scale. */
export function rangeTable(def, ranges, atm = ATMOSPHERE, maxElevation = 0.35) {
  const out = [];
  for (const range of ranges) {
    const r = elevationForRange(def, range, atm, maxElevation);
    if (!r) break;
    out.push({ range, ...r });
  }
  return out;
}

/** Elevation (rad) for an arbitrary range by linear interpolation of a range table; 0 at range 0. */
export function elevationAt(table, range) {
  if (!table.length || range <= 0) return 0;
  let prevR = 0;
  let prevE = 0;
  for (const row of table) {
    if (range <= row.range) return prevE + ((row.elevation - prevE) * (range - prevR)) / (row.range - prevR);
    prevR = row.range;
    prevE = row.elevation;
  }
  return prevE;
}
