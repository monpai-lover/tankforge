// The crew at work: the loader turns to the racks, stoops for a round, swings it up to the breech
// and rams it home -- one cycle over exactly the reload the game is running, with a bigger, slower
// bend and swing for a heavier round, and two cycles (projectile, then charge) where the gun takes
// separate-loading ammunition. A belt-fed gun's loader only heaves a new belt box in when the belt
// runs out. The gunner and commander rock back as the gun fires, and everyone breathes.

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (t) => t * t * (3 - 2 * t);
/** 0 -> 1 -> 0 over [a, b], eased. */
const hump = (p, a, b) => (p <= a || p >= b ? 0 : Math.sin(((p - a) / (b - a)) * Math.PI));
/** 0 before a, eased up to 1 at b. */
const ramp = (p, a, b) => smooth(clamp((p - a) / (b - a), 0, 1));

/** How a calibre loads: 0 (a light round, quick swing) .. 1 (a heavy one, deep bend). */
export function loadWeight(caliberMm) {
  return clamp((caliberMm - 37) / (122 - 37), 0, 1);
}

/**
 * The loader's offsets at phase p (0..1) of a reload: {dx, dy, dz, yaw, pitch} in the turret's
 * frame. k from loadWeight; split: separate-loading (two fetches).
 */
export function loaderPose(p, k, split = false) {
  if (split) {
    const half = p < 0.5 ? p * 2 : (p - 0.5) * 2;
    const pose = loaderPose(half, k, false);
    return pose;
  }
  const yawMax = 1.0 + 1.6 * k;
  const bend = 0.08 + 0.17 * k;
  const ram = 0.08 + 0.10 * k;
  // turn to the rack (0..0.3), stoop and lift (0.15..0.6), turn back (0.45..0.8), ram (0.8..0.94)
  const turn = ramp(p, 0, 0.28) * (1 - ramp(p, 0.45, 0.8));
  const stoop = hump(p, 0.12, 0.62);
  const push = hump(p, 0.78, 0.96);
  return {
    dx: 0,
    dy: -bend * stoop,
    dz: ram * push - 0.05 * stoop,
    yaw: yawMax * turn,
    // a node's positive pitch tips the figure back: stooping and ramming lean it forward
    pitch: -(0.55 * stoop + 0.25 * push),
  };
}

/**
 * Moves the crew figures of one vehicle. interior from buildInterior; crew the crew.json list;
 * loadout; T the per-turret runtime state (loading, guns); now (s); fired[ti] the time each turret
 * last fired.
 */
export function animateCrew(interior, crew, loadout, T, now, fired = []) {
  if (!interior || !interior.byCrew) return;
  const t0 = loadout.turrets[0];
  const rt0 = T && T[0];
  let loaderNo = 0;
  interior.byCrew.forEach((n, ci) => {
    if (!n) return;
    const c = crew[ci] || {};
    if (!n.base) n.base = { pos: n.pos.slice(), yaw: n.yaw, pitch: n.pitch };
    const b = n.base;
    let dx = 0;
    let dy = 0.004 * Math.sin(now * 1.6 + ci * 1.7);
    let dz = 0;
    let yaw = 0;
    let pitch = 0;
    if (c.role === 'loader' && t0 && rt0) {
      const l = rt0.loading.loaders[loaderNo++];
      if (l && l.gun >= 0 && l.total > 0) {
        const g = t0.guns[l.gun];
        const def = g ? g.def : {};
        const p = clamp(1 - l.remaining / l.total, 0, 1);
        if (def.autocannon) {
          // a new belt box: only for a real belt change, not the gun's own cycling
          if (l.total > 1) {
            const s = loaderPose(p, 0.3, false);
            ({ dx, dy, dz, yaw, pitch } = { ...s, yaw: s.yaw * 0.5 });
          }
        } else {
          const s = loaderPose(p, loadWeight(def.caliber_mm || 75), (def.caliber_mm || 0) >= 100);
          ({ dx, dy, dz, yaw, pitch } = s);
        }
      }
    } else if ((c.role === 'gunner' || c.role === 'commander') && fired[0] != null) {
      // the shock of the shot through the seat and the brow pad
      const k = loadWeight((t0 && t0.guns[0] && t0.guns[0].def.caliber_mm) || 75);
      const e = Math.exp(-Math.max(0, now - fired[0]) * 9);
      dz -= (0.02 + 0.03 * k) * e;
      pitch += (0.05 + 0.06 * k) * e;
    }
    n.pos = [b.pos[0] + dx, b.pos[1] + dy, b.pos[2] + dz];
    n.yaw = b.yaw + yaw;
    n.pitch = b.pitch + pitch;
  });
}
