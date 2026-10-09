//! TrackDriveSystem: the two tracks are driven separately (differential track drive). The
//! driver's throttle and steering become a target speed for each track (straight: both the same;
//! a turn: the inner track slower; a pivot: opposite directions), and the tracks are pushed
//! towards their targets by the engine (mean speed) and the steering mechanism (difference), or
//! held back by engine braking and the brakes. Both are velocity motors solved together with the
//! ground contacts ([`super::track_contact::solve_friction`]): what the ground will not take, the
//! tracks spend in slip. What the tracks then do to the hull is decided at the ground.
//! (client/web/src/sim/tank/drive.js mirrors this file and powertrain.rs.)
use super::math::*;
use super::powertrain::{Gearbox, Powertrain, ShiftInput};
use super::rigid_body::GRAVITY;
use super::track_contact::{Belt, Motor};
use crate::Input;

const SPEED_ERR_SAT: f64 = 0.5;
const ENGINE_BRAKE: f64 = 0.25;
const CREEP_SPEED: f64 = 2.0;
/// Each track's effective mass (links, wheels and drivetrain inertia), share of the vehicle's.
pub const BELT_MASS_SHARE: f64 = 0.06;

/// What the drive needs to know about the vehicle now.
#[derive(Clone, Copy, Debug)]
pub struct DriveEnv {
    /// Forward speed of the hull, m/s.
    pub u: f64,
    /// Rolling + air resistance, N.
    pub resist: f64,
    /// Grade force, N (+ uphill along the hull's heading).
    pub grade: f64,
}

#[derive(Clone, Debug)]
pub struct DriveState {
    pub gearbox: Gearbox,
    /// [left, right].
    pub belts: [Belt; 2],
    pub target: [f64; 2],
    /// Drive force solved on each track, N.
    pub drive: [f64; 2],
    pub motor: Motor,
    pub f_eng: f64,
    pub brakes: [f64; 2],
    /// Engine load 0..1.
    pub load: f64,
    pub reversing: bool,
    pub braking: bool,
}

impl DriveState {
    pub fn new(pt: &Powertrain, mass: f64) -> Self {
        let belt = Belt { v: 0.0, m: BELT_MASS_SHARE * mass };
        Self {
            gearbox: Gearbox { gear: 0, shift_timer: 0.0, rpm: pt.idle_rpm },
            belts: [belt, belt],
            target: [0.0; 2],
            drive: [0.0; 2],
            motor: Motor::default(),
            f_eng: 0.0,
            brakes: [0.0; 2],
            load: 0.0,
            reversing: false,
            braking: false,
        }
    }
}

/// Sets each track's target, the engine and steering motors and the brakes for this step.
pub fn drive_step(pt: &Powertrain, mass: f64, ds: &mut DriveState, input: Input, env: &DriveEnv, dt: f64) {
    let throttle = (input.throttle as f64).clamp(-1.0, 1.0);
    let steer = (input.steer as f64).clamp(-1.0, 1.0);
    let u = env.u;
    let half = pt.gauge * 0.5;

    // ---- what the driver asks of each track
    let mut v_target = if throttle >= 0.0 { throttle * pt.v_top } else { throttle * pt.max_reverse_speed };
    let mut creeping = false;
    if pt.min_turn_radius > 0.0 && throttle.abs() < 0.05 && steer.abs() > 0.05 {
        v_target = if u < -0.3 { -1.0 } else { 1.0 } * CREEP_SPEED * steer.abs();
        creeping = true;
    }
    let reversing = v_target < 0.0 || (v_target == 0.0 && u < 0.0);
    let dir = if reversing { -1.0 } else { 1.0 };
    // the difference between the tracks: the turn rate the steering is built for
    let mut delta = steer * pt.max_turn_rate * half;
    if pt.min_turn_radius > 0.0 {
        let lim = v_target.abs() * half / pt.min_turn_radius;
        delta = delta.clamp(-lim, lim);
    }
    // steer right: the left track runs faster, so the hull swings right going either way
    ds.target = [v_target + delta, v_target - delta];

    // ---- engine and gearbox
    let [bl, br] = ds.belts;
    let avg_track = (bl.v.abs() + br.v.abs()) * 0.5;
    let demand = env.resist + (env.grade * dir).max(0.0);
    let c_mean = ((v_target - u) / SPEED_ERR_SAT).clamp(-1.0, 1.0);
    let shift = ShiftInput { u, avg_track, reversing, driving: c_mean * dir > 0.9, demand, climb: (env.grade * dir).max(0.0), mass };
    let f_eng = ds.gearbox.step(pt, &shift, dt);

    // ---- the two channels of a tracked drive: the engine sets the mean speed of the tracks,
    // the steering mechanism (differential, steering brakes) forces their difference
    let mean = (bl.v + br.v) / 2.0;
    let diff = bl.v - br.v;
    let mean_target = (ds.target[0] + ds.target[1]) / 2.0;
    let diff_target = ds.target[0] - ds.target[1];
    // the engine pushes whenever the tracks are short of the way the driver wants to go (also
    // when rolling back on a slope); slowing them is engine braking
    let pushing = if mean_target.abs() > 0.05 { (mean_target - mean) * sign(mean_target) > 0.0 } else { false };
    // the steering gear can push the tracks apart as hard as they can grip, within the engine power
    let steer_cap = (0.45 * mass * GRAVITY).min(pt.power / (2.0 * (diff.abs() / 2.0).max(0.5)));
    ds.motor = Motor { mean: mean_target, mean_cap: if pushing { f_eng } else { ENGINE_BRAKE * f_eng }, diff: diff_target, diff_cap: steer_cap, pushing, broken: [false; 2], f_mean: 0.0, f_steer: 0.0 };
    ds.f_eng = f_eng;

    // ---- brakes: asked for, parking, or a reversal at speed
    let reversal = v_target * u < 0.0 && u.abs() > 0.5;
    let parking = !creeping && throttle.abs() < 0.05 && steer.abs() < 0.05 && u.abs() < 1.0;
    let brake = if reversal || parking { 1.0 } else { (input.brake as f64).clamp(0.0, 1.0) };
    let bf = brake * mass * pt.brake_decel * 0.5;
    ds.brakes = [bf, bf];
    ds.braking = brake > 0.5;
    ds.reversing = reversing;
}
