// TEMPORARY JS mirror of crates/physics/src/tank/powertrain.rs + track_drive.rs.
//
// PowertrainSystem: engine torque curve -> gearbox (automatic, force-aware so it does not hunt)
// -> final drive -> sprocket force. The engine turns with the tracks (its speed follows the mean
// track speed through the gear ratio; below the launch speed the clutch slips).
// TrackDriveSystem: the two tracks are driven separately (differential track drive). The driver's
// throttle and steering become a target speed for each track (straight: both the same; a turn:
// the inner track slower; a pivot: opposite directions), and each track is pushed towards its
// target by the engine, or held back by engine braking, the steering mechanism or the brakes.
// What the tracks then do to the hull is decided at the ground by the track contacts.
import { torqueAt } from '../physics.js';
import { GRAVITY } from './body.js';
import { clamp } from './math3.js';
import { advanceDriveForce } from '../drivetrain.js';

const SPEED_ERR_SAT = 0.5;
const ENGINE_BRAKE = 0.25;
const CREEP_SPEED = 2.0;
const DRIVE_TAU = 0.02; // s: the gearbox holds the tracks at their target speeds, up to what the engine can give

/** p: the vehicle parameters from physics.makeParams (engine, gearbox, sprocket, limits). */
export function makeDrive(p, mass) {
  return { p, mass, beltMass: 0.06 * mass };
}

export function newDriveState(dr) {
  return {
    gear: 0,
    shiftTimer: 0,
    rpm: dr.p.engine.idle_rpm,
    belts: { 1: { v: 0, m: dr.beltMass }, [-1]: { v: 0, m: dr.beltMass } },
    target: { 1: 0, [-1]: 0 },
    drive: { 1: 0, [-1]: 0 },
    motor: null,
    fEng: 0,
    brakes: { 1: 0, [-1]: 0 },
    load: 0,
    reversing: false,
    driveForce: 0,
    driveDirection: 0,
  };
}

const ratio = (p, g) => p.trans.gear_ratios[g] * p.trans.final_drive_ratio;

/**
 * Sets the drive force on each track (applied to the track speeds here) and the brake force each
 * track may use in the contact solve. env: {u (forward speed), resist (rolling + air, N),
 * grade (N, + uphill)}.
 */
export function driveStep(dr, ds, input, env, dt) {
  const p = dr.p;
  const drivePower = clamp(input.drive_power ?? 1, 0, 1);
  const throttle = clamp(input.throttle, -1, 1);
  const steer = clamp(input.steer, -1, 1);
  const u = env.u;
  const last = p.trans.gear_ratios.length - 1;
  ds.gear = Math.min(ds.gear, last);
  const maxRpm = p.engine.max_rpm;
  const half = p.gauge * 0.5;

  // ---- what the driver asks of each track
  let vTarget = throttle >= 0 ? throttle * p.vTop : throttle * p.maxReverseSpeed;
  let creeping = false;
  if (p.minTurnRadius > 0 && Math.abs(throttle) < 0.05 && Math.abs(steer) > 0.05) {
    vTarget = (u < -0.3 ? -1 : 1) * CREEP_SPEED * Math.abs(steer);
    creeping = true;
  }
  const reversing = vTarget < 0 || (vTarget === 0 && u < 0);
  const dir = reversing ? -1 : 1;
  // the difference between the tracks: the turn rate the steering is built for
  let delta = steer * p.maxTurnRate * half;
  if (p.minTurnRadius > 0) delta = clamp(delta, -Math.abs(vTarget) * half / p.minTurnRadius, Math.abs(vTarget) * half / p.minTurnRadius);
  // steer right: the left track runs faster, so the hull swings right going either way
  ds.target[-1] = vTarget + delta;
  ds.target[1] = vTarget - delta;

  // ---- engine and gearbox
  const vl = ds.belts[-1].v;
  const vr = ds.belts[1].v;
  const avgTrack = (Math.abs(vl) + Math.abs(vr)) * 0.5;
  const wheelRpm = (avgTrack * 60) / (2 * Math.PI * p.sprocketR);
  const launch = p.launchRpm;
  const forceAt = (gear) => {
    const rpm = clamp(wheelRpm * ratio(p, gear), launch, maxRpm);
    const governor = rpm <= 0.95 * maxRpm ? 1 : clamp((maxRpm - rpm) / (0.05 * maxRpm), 0, 1);
    return (torqueAt(p.engine.torque_curve, rpm) * governor * ratio(p, gear) * p.efficiency * drivePower) / p.sprocketR;
  };
  const demand = env.resist + Math.max(env.grade * dir, 0);
  ds.shiftTimer = Math.max(ds.shiftTimer - dt, 0);
  const cMean = clamp((vTarget - u) / SPEED_ERR_SAT, -1, 1);
  const driving = cMean * dir > 0.9;
  // gear choice follows the road speed, not spinning tracks (nobody changes up on wheelspin)
  const roadRpm = (Math.abs(u) * 60) / (2 * Math.PI * p.sprocketR);
  if (reversing) ds.gear = p.revGear;
  else if (Math.abs(u) < 0.3 && avgTrack < 1.5) {
    if (ds.gear !== 0) ds.shiftTimer = 0;
    ds.gear = 0;
  } else if (ds.shiftTimer <= 0) {
    const rpmNow = roadRpm * ratio(p, ds.gear);
    // an upshift costs drive for the shift time: on a climb the next gear must have a good margin
    const climb = Math.max(env.grade * dir, 0);
    // ... and only if the shift (no drive meanwhile) does not cost most of the speed: in mud or on
    // a steep climb the driver stays in the low gear
    const lostInShift = ((demand + climb) / dr.mass) * p.shiftTime;
    if (ds.gear < last && rpmNow > 0.85 * maxRpm && forceAt(ds.gear + 1) > (demand + climb) * 1.2 && lostInShift < 0.75 * Math.abs(u)) {
      ds.gear += 1;
      ds.shiftTimer = p.shiftTime;
    } else if (ds.gear > 0 && roadRpm * ratio(p, ds.gear - 1) < 0.8 * maxRpm) {
      const cannotHold = driving && forceAt(ds.gear) < demand * 1.05;
      const coastingDown = !driving && rpmNow < p.engine.idle_rpm;
      if (cannotHold || coastingDown) {
        ds.gear -= 1;
        ds.shiftTimer = cannotHold ? p.shiftTime : 0;
      }
    }
  }
  ds.rpm = clamp(wheelRpm * ratio(p, ds.gear), launch, maxRpm);
  const fEng = ds.shiftTimer > 0 ? 0 : forceAt(ds.gear);

  // ---- the two channels of a tracked drive: the engine sets the mean speed of the tracks, the
  // steering mechanism (differential, steering brakes) forces their difference
  const bl = ds.belts[-1];
  const br = ds.belts[1];
  const mean = (bl.v + br.v) / 2;
  const diff = bl.v - br.v;
  const meanTarget = (ds.target[-1] + ds.target[1]) / 2;
  const diffTarget = ds.target[-1] - ds.target[1];
  // Both channels are velocity motors solved with the ground contacts (solveFriction): the
  // gearbox and the steering gear hold the tracks at their target speeds up to their force limits;
  // what the ground will not take, the tracks spend in slip.
  // the engine pushes whenever the tracks are short of the way the driver wants to go (also when
  // rolling back on a slope); slowing them is engine braking
  const pushing = Math.abs(meanTarget) > 0.05 ? (meanTarget - mean) * Math.sign(meanTarget) > 0 : false;
  const transmitted = advanceDriveForce(ds, pushing ? Math.sign(meanTarget) : 0, forceAt(ds.gear), dr.mass, dt);
  // the steering gear can push the tracks apart as hard as they can grip, within the engine power
  const steerCap = drivePower * Math.min(0.45 * dr.mass * GRAVITY, p.power / (2 * Math.max(Math.abs(diff) / 2, 0.5)));
  ds.motor = { mean: meanTarget, meanCap: pushing ? Math.min(fEng, transmitted) : ENGINE_BRAKE * fEng, diff: diffTarget, diffCap: steerCap, pushing };
  ds.fEng = fEng;

  // ---- brakes: asked for, parking, or a reversal at speed
  const reversal = vTarget * u < 0 && Math.abs(u) > 0.5;
  const parking = !creeping && Math.abs(throttle) < 0.05 && Math.abs(steer) < 0.05 && Math.abs(u) < 1.0;
  const brake = reversal || parking ? 1 : clamp(input.brake, 0, 1);
  const bf = brake * dr.mass * p.brakeDecel * 0.5;
  ds.brakes[1] = bf;
  ds.brakes[-1] = bf;
  ds.braking = brake > 0.5;
  ds.reversing = reversing;
  return ds;
}

/** Rolling resistance of the running gear on this ground, as a force on each track. */
export function rollingForce(p, rollMult, load) {
  return p.rollingResistance * rollMult * load;
}

export { GRAVITY };
