// TEMPORARY JS mirror of crates/weapon/src/mg.rs (tg_weapon::mg) -- keep the two in lockstep.
//
// A belt-fed machine gun: a fixed cyclic rate, a belt that has to be changed when it runs out,
// and a barrel that heats with every round and cools with time. Heat is a simplified model
// (0 = cold, 1 = too hot to fire); the gun refuses to fire from 1 until it is back under
// RESUME_HEAT.

export const RESUME_HEAT = 0.55;

/** def: an entry of data/machine_guns.json. */
export function newMg(def) {
  return { belt: def.belt_rounds, cooldown: 0, heat: 0, reload: 0, hot: false, fired: 0 };
}

/**
 * Advances one gun by dt seconds. `trigger` = the gunner is holding the trigger.
 * Returns how many rounds left the barrel during this step.
 */
export function stepMg(def, st, trigger, dt, reloadRate = 1) {
  const interval = 60 / def.rate_rpm;
  st.heat = Math.max(0, st.heat - dt / def.cool_s);
  if (st.hot && st.heat < RESUME_HEAT) st.hot = false;
  if (st.reload > 0) {
    st.reload -= dt * reloadRate;
    if (st.reload <= 0) {
      st.reload = 0;
      st.belt = def.belt_rounds;
    }
  }
  st.cooldown -= dt;
  if (!trigger || st.hot || st.reload > 0) {
    if (st.cooldown < 0) st.cooldown = 0;
    return 0;
  }
  let n = 0;
  while (st.cooldown <= 0) {
    st.cooldown += interval;
    st.belt -= 1;
    st.fired += 1;
    st.heat += 1 / def.heat_rounds;
    n += 1;
    if (st.belt <= 0) {
      st.belt = 0;
      st.reload = def.reload_s;
      st.cooldown = 0;
      break;
    }
    if (st.heat >= 1) {
      st.heat = 1;
      st.hot = true;
      st.cooldown = 0;
      break;
    }
  }
  return n;
}

/** True for the rounds that carry a tracer (every `tracer_every`-th round of the belt). */
export function isTracer(def, st) {
  return def.tracer_every > 0 && st.fired % def.tracer_every === 0;
}

/** The bullet as the ballistics module wants it. */
export function bulletOf(def) {
  return { caliber_mm: def.caliber_mm, mass_kg: def.bullet_mass_g / 1000, muzzle_velocity_ms: def.muzzle_velocity_ms, drag_coefficient: def.drag_coefficient };
}

/**
 * Where a flexible mount points. want = {yaw, pitch} towards the target in the mount's own frame,
 * arc = [yaw half-angle, depression, elevation] in radians (null = free traverse).
 * Slews `aim` towards it at `rate` rad/s and returns true when the gun is on the target.
 */
export function slewMount(aim, want, arc, rate, dt, elevateRate = rate) {
  const wrap = (a) => {
    a = (a + Math.PI) % (2 * Math.PI);
    if (a < 0) a += 2 * Math.PI;
    return a - Math.PI;
  };
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const ty = arc && arc[0] < Math.PI ? clamp(wrap(want.yaw), -arc[0], arc[0]) : wrap(want.yaw);
  const tp = arc ? clamp(want.pitch, -arc[1], arc[2]) : want.pitch;
  const step = rate * dt;
  aim.yaw = wrap(aim.yaw + clamp(wrap(ty - aim.yaw), -step, step));
  const pitchStep = elevateRate * dt;
  aim.pitch += clamp(tp - aim.pitch, -pitchStep, pitchStep);
  return Math.abs(wrap(want.yaw - aim.yaw)) < 0.03 && Math.abs(want.pitch - aim.pitch) < 0.03;
}
