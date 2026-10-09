// TEMPORARY JS mirror of crates/physics (tg-physics). The Rust crate is the source of truth;
// this file exists only until the WASM build replaces it. Keep the two in lockstep.
//
// Planar tracked-vehicle model: body-frame velocity u (forward) / w (sideways, right+),
// yaw rate r (clockwise+). See crates/physics/src/lib.rs for the model notes.

import { groundPressure, pressureFactor, sinkage, slipForRatio, HARD_GROUND_K } from './terra.js';

const G = 9.81;
const AIR_RHO = 1.225;
const TURN_RESISTANCE_FACTOR = 0.5;
const SPEED_ERR_SAT = 0.5;
const STEER_ERR_SAT = 0.25;
const ENGINE_BRAKE = 0.25;
const CREEP_SPEED = 2.0;

export function makeParams(vehicle, engineFile) {
  const hull = vehicle.hull;
  const ph = vehicle.physics;
  const wid = hull.size_m[0];
  const len = hull.size_m[2];
  const p = {
    mass: hull.mass_kg,
    inertia: (hull.mass_kg * (len * len + wid * wid)) / 12,
    trackLength: ph.track_length_m,
    trackWidth: ph.track_width_m,
    groundPressure: groundPressure(hull.mass_kg, ph.track_width_m, ph.track_length_m),
    gauge: Math.max(wid - ph.track_width_m, 0.5),
    sprocketR: ph.sprocket_radius_m ?? 0.35,
    efficiency: ph.drivetrain_efficiency ?? 0.85,
    brakeDecel: ph.max_brake_decel_ms2 ?? 6.0,
    cdA: 0.9 * wid * (hull.size_m[1] + 0.6 * vehicle.turret.size_m[1]),
    rollingResistance: ph.rolling_resistance,
    maxTurnRate: ((ph.max_turn_rate_deg_s ?? 45) * Math.PI) / 180,
    maxReverseSpeed: ph.max_reverse_speed_ms ?? 4.0,
    minTurnRadius: ph.min_turn_radius_m ?? 0.0,
    engine: engineFile.engine,
    trans: engineFile.transmission,
    shiftTime: engineFile.transmission.shift_time_s ?? 0.35,
    vTop: 0,
    power: 0,
  };
  const top = p.trans.gear_ratios.length - 1;
  const gearSpeed = (g) => ((0.95 * p.engine.max_rpm) / ratio(p, g) / 60) * 2 * Math.PI * p.sprocketR;
  p.vTop = gearSpeed(top);
  p.power = p.engine.horsepower * 745.7 * p.efficiency;
  // Reverse uses the lowest forward ratio that can reach the reverse speed limit.
  p.revGear = top;
  for (let g = 0; g <= top; g++) {
    if (gearSpeed(g) >= p.maxReverseSpeed) {
      p.revGear = g;
      break;
    }
  }
  // While the clutch slips (low road speed) the engine sits at its peak-torque speed.
  let peak = p.engine.torque_curve[0];
  for (const pt of p.engine.torque_curve) if (pt[1] > peak[1]) peak = pt;
  p.launchRpm = Math.min(peak[0], 0.8 * p.engine.max_rpm);
  return p;
}

function ratio(p, gear) {
  return p.trans.gear_ratios[gear] * p.trans.final_drive_ratio;
}

export function torqueAt(curve, rpm) {
  if (curve.length === 0) return 0;
  if (rpm <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) {
    if (rpm <= curve[i][0]) {
      const a = curve[i - 1];
      const b = curve[i];
      return a[1] + ((b[1] - a[1]) * (rpm - a[0])) / Math.max(b[0] - a[0], 1e-6);
    }
  }
  return curve[curve.length - 1][1];
}

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const shrink = (v, d) => (Math.abs(v) <= d ? 0 : v - d * Math.sign(v));

/** Speed of the track itself: the ground speed plus what the slip adds in the direction of thrust. */
function slipSpeed(ground, force, slip, spin) {
  const k = Math.min(slip, 0.9);
  const extra = (Math.abs(ground) * k) / (1 - k) + slip * slip * Math.min(spin, 4);
  return ground + Math.sign(force) * extra;
}

export function newState() {
  return { x: 0, z: 0, heading: 0, u: 0, w: 0, r: 0, gear: 0, shiftTimer: 0, rpm: 0 };
}

/**
 * input: {throttle -1..1, steer -1..1 (+ = right), brake 0..1}
 * env:   {terrain: {rolling_mult, traction_mu, lateral_mu, soil?}, slope (rad, uphill+ along heading),
 *         drag? (N, extra resistance: the suspension's dampers on rough ground),
 *         load? [left, right] share of each track's static load on the ground (1 = level, default)}
 * Returns per-step info used by HUD / audio / effects.
 */
export function step(p, s, input, env, dt) {
  const t = env.terrain;
  const steer = clamp(input.steer, -1, 1);
  const brakeIn = clamp(input.brake, 0, 1);
  let throttle = clamp(input.throttle, -1, 1);
  const slope = env.slope || 0;
  const normal = p.mass * G * Math.cos(slope);
  const half = p.gauge * 0.5;
  const last = p.trans.gear_ratios.length - 1;
  const revGear = p.revGear;
  s.gear = Math.min(s.gear, last);
  const maxRpm = p.engine.max_rpm;
  const launch = p.launchRpm;

  // Vehicles that cannot neutral-steer creep forward when only steering is held.
  let vTarget = throttle >= 0 ? throttle * p.vTop : throttle * p.maxReverseSpeed;
  let creeping = false;
  if (p.minTurnRadius > 0 && Math.abs(throttle) < 0.05 && Math.abs(steer) > 0.05) {
    vTarget = (s.u < -0.3 ? -1 : 1) * CREEP_SPEED * Math.abs(steer);
    creeping = true;
  }
  const reversing = vTarget < 0 || (vTarget === 0 && s.u < 0);
  const dir = reversing ? -1 : 1;

  // Soft ground costs a heavily loaded track more than a lightly loaded one (Bekker compaction).
  const rollMult = 1 + (t.rolling_mult - 1) * pressureFactor(t.soil, p.groundPressure);
  const roll = p.rollingResistance * rollMult * normal + Math.max(env.drag || 0, 0);
  const grade = p.mass * G * Math.sin(slope);
  const demand = roll + 0.5 * AIR_RHO * p.cdA * s.u * s.u + Math.max(grade * dir, 0);

  const avgTrack = (Math.abs(s.u + s.r * half) + Math.abs(s.u - s.r * half)) * 0.5;
  const wheelRpm = (avgTrack * 60) / (2 * Math.PI * p.sprocketR);
  const forceAt = (gear) => {
    const rpm = clamp(wheelRpm * ratio(p, gear), launch, maxRpm);
    const governor = rpm <= 0.95 * maxRpm ? 1 : clamp((maxRpm - rpm) / (0.05 * maxRpm), 0, 1);
    return (torqueAt(p.engine.torque_curve, rpm) * governor * ratio(p, gear) * p.efficiency) / p.sprocketR;
  };

  // ---- gearbox (automatic, with force-aware shifting so it does not hunt on slopes / mud)
  s.shiftTimer = Math.max(s.shiftTimer - dt, 0);
  const cMean = clamp((vTarget - s.u) / SPEED_ERR_SAT, -1, 1);
  const driving = cMean * dir > 0.9;
  if (reversing) {
    s.gear = revGear;
  } else if (avgTrack < 0.05) {
    s.gear = 0;
  } else if (s.shiftTimer <= 0) {
    const rpmNow = wheelRpm * ratio(p, s.gear);
    if (s.gear < last && rpmNow > 0.85 * maxRpm && forceAt(s.gear + 1) > demand * 1.15) {
      s.gear += 1;
      s.shiftTimer = p.shiftTime;
    } else if (s.gear > 0 && wheelRpm * ratio(p, s.gear - 1) < 0.8 * maxRpm) {
      // kick down when the engine cannot hold the demand, or follow the road speed down when coasting
      const cannotHold = driving && forceAt(s.gear) < demand * 1.05;
      const coastingDown = !driving && rpmNow < p.engine.idle_rpm;
      if (cannotHold || coastingDown) {
        s.gear -= 1;
        s.shiftTimer = cannotHold ? p.shiftTime : 0;
      }
    }
  }

  // ---- engine
  const rpm = clamp(wheelRpm * ratio(p, s.gear), launch, maxRpm);
  const fEng = s.shiftTimer > 0 ? 0 : forceAt(s.gear);
  const engineBraking = cMean * s.u < 0 && vTarget * s.u >= 0;
  const fMean = cMean * fEng * (engineBraking ? ENGINE_BRAKE : 1);
  const reversal = vTarget * s.u < 0 && Math.abs(s.u) > 0.5;
  const parking = !creeping && Math.abs(throttle) < 0.05 && Math.abs(s.u) < 1.0;
  const brake = reversal || parking ? 1 : brakeIn;

  // ---- steering
  let rateCap = p.maxTurnRate;
  if (p.minTurnRadius > 0) rateCap = Math.min(rateCap, Math.abs(s.u) / p.minTurnRadius);
  const deltaTarget = steer * rateCap * half;
  const cDiff = clamp((deltaTarget - s.r * half) / STEER_ERR_SAT, -1, 1);
  const steerCap = Math.min(p.mass * p.brakeDecel * 0.5, p.power / (2 * Math.max(Math.abs(s.r * half), 1)));
  const turnMoment = (TURN_RESISTANCE_FACTOR * t.lateral_mu * normal * p.trackLength) / 4;
  // feed-forward cancels the skid resistance so the commanded yaw rate is actually reached
  const feedForward = Math.abs(deltaTarget) > 1e-3 ? (Math.sign(deltaTarget) * turnMoment) / (2 * half) : 0;
  const fSteer = clamp(cDiff * steerCap + feedForward, -steerCap, steerCap);

  // ---- track forces, limited by traction: a track that is lifted off the ground (over a hump,
  // on a ridge) has less weight on it and less grip
  const cap = t.traction_mu * normal * 0.5;
  const capL = cap * clamp(env.load ? env.load[0] : 1, 0, 1.6);
  const capR = cap * clamp(env.load ? env.load[1] : 1, 0, 1.6);
  const flT = fMean * 0.5 + fSteer;
  const frT = fMean * 0.5 - fSteer;
  const fl = clamp(flT, -capL, capL);
  const fr = clamp(frT, -capR, capR);
  const over = (want, c) => (Math.abs(want) > 1 ? Math.min(Math.max(Math.abs(want) - c, 0) / Math.abs(want), 1) : 0);
  const slip = Math.max(over(flT, capL), over(frT, capR));
  // Slip each track needs to deliver its thrust (Janosi-Hanamoto), plus wheelspin once the
  // demand is more than the ground can carry. The track then runs faster than the ground passes.
  const shearK = t.soil ? t.soil.K : HARD_GROUND_K;
  const gearSpeed = (rpmNow) => (rpmNow / ratio(p, s.gear) / 60) * 2 * Math.PI * p.sprocketR;
  const trackSlip = (applied, wanted, c) => {
    if (c < 1) return Math.abs(wanted) > 1 ? 1 : 0;
    let i = slipForRatio(Math.abs(applied) / c, shearK, p.trackLength);
    if (Math.abs(wanted) > c) i = Math.max(i, 0.3 + 0.7 * (1 - c / Math.abs(wanted)));
    return i;
  };
  const slipL = trackSlip(fl, flT, capL);
  const slipR = trackSlip(fr, frT, capR);

  // ---- rigid body (body frame)
  const aero = -0.5 * AIR_RHO * p.cdA * s.u * Math.abs(s.u);
  const ax = (fl + fr + aero - grade) / p.mass + s.w * s.r;
  const aw = -s.u * s.r;
  const ar = ((fl - fr) * half) / p.inertia;
  s.u += ax * dt;
  s.w += aw * dt;
  s.r += ar * dt;

  // ---- Coulomb friction as impulses that never cross zero (exact stiction)
  // Skid-steering bleeds speed; brake-steered vehicles pay for all of it, regenerative ones for part.
  const turnDrag = ((turnMoment * Math.abs(s.r)) / Math.max(Math.abs(s.u), 2)) * (p.minTurnRadius > 0 ? 1.0 : 0.3);
  const brakeF = brake * Math.min(p.mass * p.brakeDecel, t.traction_mu * normal);
  s.u = shrink(s.u, ((roll + brakeF + turnDrag) / p.mass) * dt);
  s.w = shrink(s.w, ((t.lateral_mu * normal) / p.mass) * dt);
  s.r = shrink(s.r, (turnMoment / p.inertia) * dt);

  // ---- pose
  s.heading += s.r * dt;
  const sn = Math.sin(s.heading);
  const cs = Math.cos(s.heading);
  s.x += (s.u * sn + s.w * cs) * dt;
  s.z += (s.u * cs - s.w * sn) * dt;
  s.rpm = rpm;

  return {
    rpm,
    gear: s.gear,
    reversing,
    speedKmh: s.u * 3.6,
    trackSlip: slip,
    yawRateDeg: (s.r * 180) / Math.PI,
    ax,
    lateralAcc: s.u * s.r,
    slipL,
    slipR,
    trackSpeedL: slipSpeed(s.u + s.r * half, fl, slipL, gearSpeed(rpm)),
    trackSpeedR: slipSpeed(s.u - s.r * half, fr, slipR, gearSpeed(rpm)),
    groundSpeedL: s.u + s.r * half,
    groundSpeedR: s.u - s.r * half,
    forceL: fl,
    forceR: fr,
    sinkage: sinkage(t.soil, p.groundPressure, p.trackWidth) * (1 + 1.2 * Math.max(slipL, slipR)),
    braking: brake > 0.5,
    throttleLoad: Math.abs(cMean) * (s.shiftTimer > 0 ? 0 : 1),
  };
}
