//! Vehicle physics. Two models of a tracked vehicle share the vehicle data:
//!
//! * [`tank`]: the full model the game drives: the hull as a 6-DOF rigid body on independent
//!   road-wheel stations, track contacts with friction and slip, a differential track drive and
//!   a powertrain, on deformable ground. Server-authoritative in multiplayer
//!   ([`tank::NetState`]); client/web/src/sim/tank mirrors it until the WASM build carries it.
//! * [`step`] (this file): a fast planar (x, z, yaw) model used where only the vehicle's
//!   performance matters: the design bureau's mobility numbers (top speed, acceleration, pivot
//!   rate, mud penalty) and quick checks of vehicle data. client/web/src/sim/physics.js mirrors it.
//!
//! Planar model summary
//! * Body-frame velocity: `u` forward, `w` sideways (right+), yaw rate `r` (clockwise+).
//! * Throttle is a *speed lever* (target speed fraction), not a raw torque request;
//!   force = engine torque x gearing, saturating with the speed error (P-control).
//! * Clutch slip: below the peak-torque speed the engine is held at peak torque.
//! * Automatic gearbox with force-aware shifting (no hunting on slopes or in mud).
//! * Steering commands a yaw rate. Vehicles with `min_turn_radius_m > 0` cannot
//!   neutral-steer: their yaw rate is limited to |u| / radius and steer-only input
//!   makes them creep forward in an arc.
//! * Track force is capped by `traction_mu * normal / 2` per track; the slip each track needs
//!   to deliver its thrust follows the Janosi-Hanamoto shear curve (see [`terra`]), and the
//!   track then runs faster than the ground passes under it.
//! * Soft ground costs a heavily loaded track more than a lightly loaded one (Bekker), and
//!   the tracks sink into it.
//! * Rolling resistance, braking, lateral and turning friction are Coulomb forces
//!   applied as impulses that never cross zero (exact stiction, stable at 30 Hz).
//! * Lateral friction vs centripetal demand `u * r` gives understeer / drifting, and
//!   skid-steering bleeds forward speed.
//! Known simplifications: no friction circle between long./lat. force, no pitch or roll (the
//! [`tank`] model has both).
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::f32::consts::PI;
use std::path::Path;
use tg_vehicle::{read_json, EngineDef, LoadError, LoadedVehicle, Report, TransmissionDef};

pub mod tank;
pub mod terra;

const G: f32 = 9.81;
const AIR_RHO: f32 = 1.225;
const TURN_RESISTANCE_FACTOR: f32 = 0.5;
const SPEED_ERR_SAT: f32 = 0.5;
const STEER_ERR_SAT: f32 = 0.25;
const ENGINE_BRAKE: f32 = 0.25;
const CREEP_SPEED: f32 = 2.0;

// ------------------------------------------------------------------ terrain

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TerrainDef {
    pub id: String,
    pub rolling_mult: f32,
    pub traction_mu: f32,
    pub lateral_mu: f32,
    /// Bekker / Janosi-Hanamoto soil parameters; absent on hard ground.
    #[serde(default)]
    pub soil: Option<terra::SoilDef>,
}

#[derive(Clone, Debug, Default)]
pub struct TerrainDb {
    map: HashMap<String, TerrainDef>,
}

impl TerrainDb {
    pub fn from_vec(v: Vec<TerrainDef>) -> Self {
        Self { map: v.into_iter().map(|t| (t.id.clone(), t)).collect() }
    }
    pub fn get(&self, id: &str) -> Option<&TerrainDef> {
        self.map.get(id)
    }
}

pub fn load_terrains(path: &Path) -> Result<Vec<TerrainDef>, LoadError> {
    read_json(path)
}

/// Content rules for terrains.json (codes R001..R004), in the same report format as
/// the vehicle validator.
pub fn validate_terrains(list: &[TerrainDef]) -> Report {
    let mut r = Report::default();
    let mut seen = HashSet::new();
    for (i, t) in list.iter().enumerate() {
        let path = format!("terrains.json[{}]({})", i, t.id);
        if t.id.is_empty() || !seen.insert(t.id.clone()) {
            r.err("R001", path.clone(), "terrain id is empty or duplicated");
        }
        if !(t.traction_mu > 0.0 && t.traction_mu <= 1.5) || !(t.lateral_mu > 0.0 && t.lateral_mu <= 1.5) {
            r.err("R002", path.clone(), "friction coefficients must be in (0, 1.5]");
        }
        if !(t.rolling_mult > 0.0 && t.rolling_mult <= 10.0) {
            r.err("R003", path.clone(), "rolling_mult must be in (0, 10]");
        }
        if let Some(s) = &t.soil {
            let ok = s.n > 0.0 && s.n <= 3.0 && s.kc >= 0.0 && s.kphi > 0.0 && s.c >= 0.0
                && (0.0..=60.0).contains(&s.phi_deg) && s.k > 0.0 && s.k <= 0.2
                && s.max_sinkage_m > 0.0 && s.max_sinkage_m <= 1.0;
            if !ok {
                r.err("R004", path, "soil parameters out of range (n, kc, kphi, c, phi_deg, K, max_sinkage_m)");
            }
        }
    }
    r
}

// ------------------------------------------------------------------- params

#[derive(Clone, Debug)]
pub struct VehicleParams {
    pub mass_kg: f32,
    pub inertia: f32,
    pub track_length_m: f32,
    pub track_width_m: f32,
    /// Mean pressure under the tracks, Pa.
    pub ground_pressure_pa: f32,
    pub gauge_m: f32,
    pub sprocket_r: f32,
    pub efficiency: f32,
    pub brake_decel: f32,
    pub cd_a: f32,
    pub rolling_resistance: f32,
    pub max_turn_rate: f32,
    pub max_reverse_speed: f32,
    pub min_turn_radius: f32,
    pub shift_time: f32,
    pub v_top: f32,
    pub power_w: f32,
    pub rev_gear: usize,
    pub launch_rpm: f32,
    pub engine: EngineDef,
    pub trans: TransmissionDef,
}

impl VehicleParams {
    /// Assumes the vehicle already passed content validation (>= 1 gear, curve not empty...).
    pub fn from_vehicle(v: &LoadedVehicle) -> Self {
        let d = &v.def;
        let (len, wid) = (d.hull.size_m[2], d.hull.size_m[0]);
        let ph = &d.physics;
        let mut p = VehicleParams {
            mass_kg: d.hull.mass_kg,
            inertia: d.hull.mass_kg * (len * len + wid * wid) / 12.0,
            track_length_m: ph.track_length_m,
            track_width_m: ph.track_width_m,
            ground_pressure_pa: terra::ground_pressure(d.hull.mass_kg, ph.track_width_m, ph.track_length_m),
            gauge_m: (wid - ph.track_width_m).max(0.5),
            sprocket_r: ph.sprocket_radius_m,
            efficiency: ph.drivetrain_efficiency,
            brake_decel: ph.max_brake_decel_ms2,
            cd_a: 0.9 * wid * (d.hull.size_m[1] + 0.6 * d.turret.size_m[1]),
            rolling_resistance: ph.rolling_resistance,
            max_turn_rate: ph.max_turn_rate_deg_s.to_radians(),
            max_reverse_speed: ph.max_reverse_speed_ms,
            min_turn_radius: ph.min_turn_radius_m,
            shift_time: v.engine.transmission.shift_time_s,
            v_top: 0.0,
            power_w: 0.0,
            rev_gear: 0,
            launch_rpm: 0.0,
            engine: v.engine.engine.clone(),
            trans: v.engine.transmission.clone(),
        };
        let top = p.trans.gear_ratios.len() - 1;
        p.v_top = p.gear_speed(top);
        p.power_w = p.engine.horsepower * 745.7 * p.efficiency;
        // Reverse uses the lowest forward ratio that can reach the reverse speed limit.
        p.rev_gear = (0..=top).find(|g| p.gear_speed(*g) >= p.max_reverse_speed).unwrap_or(top);
        // While the clutch slips (low road speed) the engine sits at its peak-torque speed.
        let mut peak = p.engine.torque_curve[0];
        for pt in &p.engine.torque_curve {
            if pt[1] > peak[1] {
                peak = *pt;
            }
        }
        p.launch_rpm = peak[0].min(0.8 * p.engine.max_rpm);
        p
    }

    fn ratio(&self, gear: usize) -> f32 {
        self.trans.gear_ratios[gear] * self.trans.final_drive_ratio
    }

    /// Road speed in `gear` at 95% of maximum engine speed.
    fn gear_speed(&self, gear: usize) -> f32 {
        0.95 * self.engine.max_rpm / self.ratio(gear) / 60.0 * 2.0 * PI * self.sprocket_r
    }
}

// -------------------------------------------------------------------- state

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct State {
    pub x: f32,
    pub z: f32,
    /// Clockwise from +Z (towards +X).
    pub heading: f32,
    pub u: f32,
    pub w: f32,
    pub r: f32,
    pub gear: usize,
    pub shift_timer: f32,
    pub rpm: f32,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct Input {
    /// -1..1; speed lever (negative = reverse).
    pub throttle: f32,
    /// -1..1; +1 = turn right.
    pub steer: f32,
    /// 0..1
    pub brake: f32,
}

#[derive(Clone, Copy, Debug)]
pub struct Env<'a> {
    pub terrain: &'a TerrainDef,
    /// Uphill-positive slope along the heading, radians.
    pub slope_rad: f32,
    /// Extra resistance, N: what the suspension's dampers take out on rough ground.
    pub drag_n: f32,
    /// Share of each track's static load on the ground, [left, right] (1 = level ground).
    pub load: [f32; 2],
}

impl<'a> Env<'a> {
    /// Level, even ground.
    pub fn new(terrain: &'a TerrainDef, slope_rad: f32) -> Self {
        Self { terrain, slope_rad, drag_n: 0.0, load: [1.0, 1.0] }
    }
}

#[derive(Clone, Copy, Debug, Default)]
pub struct StepInfo {
    pub rpm: f32,
    pub gear: usize,
    pub reversing: bool,
    pub speed_kmh: f32,
    /// 0 = full grip, 1 = tracks fully spinning.
    pub track_slip: f32,
    pub yaw_rate_deg_s: f32,
    /// Longitudinal / lateral acceleration.
    pub accel_long: f32,
    pub accel_lat: f32,
    /// Speed of each track itself (ground speed plus what the slip adds).
    pub track_speed_left: f32,
    pub track_speed_right: f32,
    /// Slip of each track, 0..1 (Janosi-Hanamoto, plus wheelspin past the traction limit).
    pub slip_left: f32,
    pub slip_right: f32,
    /// How deep the tracks sit in the ground, m.
    pub sinkage_m: f32,
    pub braking: bool,
}

/// Speed of the track itself: the ground speed plus what the slip adds in the direction of thrust.
fn slip_speed(ground: f32, force: f32, slip: f32, spin: f32) -> f32 {
    let k = slip.min(0.9);
    let extra = ground.abs() * k / (1.0 - k) + slip * slip * spin.min(4.0);
    let sign = if force > 0.0 { 1.0 } else if force < 0.0 { -1.0 } else { 0.0 };
    ground + sign * extra
}

pub fn torque_at(curve: &[[f32; 2]], rpm: f32) -> f32 {
    if curve.is_empty() {
        return 0.0;
    }
    if rpm <= curve[0][0] {
        return curve[0][1];
    }
    for w in curve.windows(2) {
        if rpm <= w[1][0] {
            let k = (rpm - w[0][0]) / (w[1][0] - w[0][0]).max(1e-6);
            return w[0][1] + (w[1][1] - w[0][1]) * k;
        }
    }
    curve[curve.len() - 1][1]
}

/// Reduce |v| by `d` without crossing zero.
fn shrink(v: f32, d: f32) -> f32 {
    if v.abs() <= d {
        0.0
    } else {
        v - d * v.signum()
    }
}

pub fn step(p: &VehicleParams, s: &mut State, inp: Input, env: &Env, dt: f32) -> StepInfo {
    let t = env.terrain;
    let throttle = inp.throttle.clamp(-1.0, 1.0);
    let steer = inp.steer.clamp(-1.0, 1.0);
    let brake_in = inp.brake.clamp(0.0, 1.0);
    let normal = p.mass_kg * G * env.slope_rad.cos();
    let half = p.gauge_m * 0.5;
    let last = p.trans.gear_ratios.len() - 1;
    s.gear = s.gear.min(last);
    let max_rpm = p.engine.max_rpm;
    let launch = p.launch_rpm;

    // Vehicles that cannot neutral-steer creep forward when only steering is held.
    let mut v_target = if throttle >= 0.0 { throttle * p.v_top } else { throttle * p.max_reverse_speed };
    let mut creeping = false;
    if p.min_turn_radius > 0.0 && throttle.abs() < 0.05 && steer.abs() > 0.05 {
        let sign = if s.u < -0.3 { -1.0 } else { 1.0 };
        v_target = sign * CREEP_SPEED * steer.abs();
        creeping = true;
    }
    let reversing = v_target < 0.0 || (v_target == 0.0 && s.u < 0.0);
    let dir = if reversing { -1.0 } else { 1.0 };

    // Soft ground costs a heavily loaded track more than a lightly loaded one (Bekker compaction).
    let roll_mult = 1.0 + (t.rolling_mult - 1.0) * terra::pressure_factor(t.soil.as_ref(), p.ground_pressure_pa);
    let roll = p.rolling_resistance * roll_mult * normal + env.drag_n.max(0.0);
    let grade = p.mass_kg * G * env.slope_rad.sin();
    let demand = roll + 0.5 * AIR_RHO * p.cd_a * s.u * s.u + (grade * dir).max(0.0);

    let avg_track = ((s.u + s.r * half).abs() + (s.u - s.r * half).abs()) * 0.5;
    let wheel_rpm = avg_track * 60.0 / (2.0 * PI * p.sprocket_r);
    let force_at = |gear: usize| -> f32 {
        let rpm = (wheel_rpm * p.ratio(gear)).clamp(launch, max_rpm);
        let governor = if rpm <= 0.95 * max_rpm { 1.0 } else { ((max_rpm - rpm) / (0.05 * max_rpm)).clamp(0.0, 1.0) };
        torque_at(&p.engine.torque_curve, rpm) * governor * p.ratio(gear) * p.efficiency / p.sprocket_r
    };

    // ---- gearbox (automatic, force-aware so it does not hunt on slopes / in mud)
    s.shift_timer = (s.shift_timer - dt).max(0.0);
    let c_mean = ((v_target - s.u) / SPEED_ERR_SAT).clamp(-1.0, 1.0);
    let driving = c_mean * dir > 0.9;
    if reversing {
        s.gear = p.rev_gear;
    } else if avg_track < 0.05 {
        s.gear = 0;
    } else if s.shift_timer <= 0.0 {
        let rpm_now = wheel_rpm * p.ratio(s.gear);
        if s.gear < last && rpm_now > 0.85 * max_rpm && force_at(s.gear + 1) > demand * 1.15 {
            s.gear += 1;
            s.shift_timer = p.shift_time;
        } else if s.gear > 0 && wheel_rpm * p.ratio(s.gear - 1) < 0.8 * max_rpm {
            // kick down when the engine cannot hold the demand, or follow the road speed down when coasting
            let cannot_hold = driving && force_at(s.gear) < demand * 1.05;
            let coasting_down = !driving && rpm_now < p.engine.idle_rpm;
            if cannot_hold || coasting_down {
                s.gear -= 1;
                s.shift_timer = if cannot_hold { p.shift_time } else { 0.0 };
            }
        }
    }

    // ---- engine
    let rpm = (wheel_rpm * p.ratio(s.gear)).clamp(launch, max_rpm);
    let f_eng = if s.shift_timer > 0.0 { 0.0 } else { force_at(s.gear) };
    let engine_braking = c_mean * s.u < 0.0 && v_target * s.u >= 0.0;
    let f_mean = c_mean * f_eng * if engine_braking { ENGINE_BRAKE } else { 1.0 };
    let reversal = v_target * s.u < 0.0 && s.u.abs() > 0.5;
    let parking = !creeping && throttle.abs() < 0.05 && s.u.abs() < 1.0;
    let brake = if reversal || parking { 1.0 } else { brake_in };

    // ---- steering
    let mut rate_cap = p.max_turn_rate;
    if p.min_turn_radius > 0.0 {
        rate_cap = rate_cap.min(s.u.abs() / p.min_turn_radius);
    }
    let delta_target = steer * rate_cap * half;
    let c_diff = ((delta_target - s.r * half) / STEER_ERR_SAT).clamp(-1.0, 1.0);
    let steer_cap = (p.mass_kg * p.brake_decel * 0.5).min(p.power_w / (2.0 * (s.r * half).abs().max(1.0)));
    let turn_moment = TURN_RESISTANCE_FACTOR * t.lateral_mu * normal * p.track_length_m / 4.0;
    // feed-forward cancels the skid resistance so the commanded yaw rate is actually reached
    let feed_forward = if delta_target.abs() > 1e-3 { delta_target.signum() * turn_moment / (2.0 * half) } else { 0.0 };
    let f_steer = (c_diff * steer_cap + feed_forward).clamp(-steer_cap, steer_cap);

    // ---- track forces, limited by traction: a track lifted off the ground (over a hump, on a
    // ridge) has less weight on it and less grip
    let cap = t.traction_mu * normal * 0.5;
    let cap_l = cap * env.load[0].clamp(0.0, 1.6);
    let cap_r = cap * env.load[1].clamp(0.0, 1.6);
    let fl_t = f_mean * 0.5 + f_steer;
    let fr_t = f_mean * 0.5 - f_steer;
    let (fl, fr) = (fl_t.clamp(-cap_l, cap_l), fr_t.clamp(-cap_r, cap_r));
    let over = |want: f32, c: f32| if want.abs() > 1.0 { ((want.abs() - c).max(0.0) / want.abs()).min(1.0) } else { 0.0 };
    let slip = over(fl_t, cap_l).max(over(fr_t, cap_r));
    // Slip each track needs to deliver its thrust, plus wheelspin once the demand is more than
    // the ground can carry.
    let shear_k = t.soil.as_ref().map_or(terra::HARD_GROUND_K, |s| s.k);
    let track_slip = |applied: f32, wanted: f32, c: f32| -> f32 {
        if c < 1.0 {
            return if wanted.abs() > 1.0 { 1.0 } else { 0.0 };
        }
        let mut i = terra::slip_for_ratio(applied.abs() / c, shear_k, p.track_length_m);
        if wanted.abs() > c {
            i = i.max(0.3 + 0.7 * (1.0 - c / wanted.abs()));
        }
        i
    };
    let (slip_left, slip_right) = (track_slip(fl, fl_t, cap_l), track_slip(fr, fr_t, cap_r));

    // ---- rigid-body dynamics (body frame)
    let aero = -0.5 * AIR_RHO * p.cd_a * s.u * s.u.abs();
    let ax = (fl + fr + aero - grade) / p.mass_kg + s.w * s.r;
    let aw = -s.u * s.r;
    let ar = (fl - fr) * half / p.inertia;
    s.u += ax * dt;
    s.w += aw * dt;
    s.r += ar * dt;

    // ---- Coulomb friction impulses
    // Skid-steering bleeds speed; brake-steered vehicles pay for all of it, regenerative ones for part.
    let turn_drag = turn_moment * s.r.abs() / s.u.abs().max(2.0) * if p.min_turn_radius > 0.0 { 1.0 } else { 0.3 };
    let brake_f = brake * (p.mass_kg * p.brake_decel).min(t.traction_mu * normal);
    s.u = shrink(s.u, (roll + brake_f + turn_drag) / p.mass_kg * dt);
    s.w = shrink(s.w, t.lateral_mu * normal / p.mass_kg * dt);
    s.r = shrink(s.r, turn_moment / p.inertia * dt);

    // ---- integrate pose
    s.heading += s.r * dt;
    let (sn, cs) = s.heading.sin_cos();
    s.x += (s.u * sn + s.w * cs) * dt;
    s.z += (s.u * cs - s.w * sn) * dt;
    s.rpm = rpm;
    let gear_speed_now = rpm / p.ratio(s.gear) / 60.0 * 2.0 * PI * p.sprocket_r;

    StepInfo {
        rpm,
        gear: s.gear,
        reversing,
        speed_kmh: s.u * 3.6,
        track_slip: slip,
        yaw_rate_deg_s: s.r.to_degrees(),
        accel_long: ax,
        accel_lat: s.u * s.r,
        track_speed_left: slip_speed(s.u + s.r * half, fl, slip_left, gear_speed_now),
        track_speed_right: slip_speed(s.u - s.r * half, fr, slip_right, gear_speed_now),
        slip_left,
        slip_right,
        sinkage_m: terra::sinkage(t.soil.as_ref(), p.ground_pressure_pa, p.track_width_m) * (1.0 + 1.2 * slip_left.max(slip_right)),
        braking: brake > 0.5,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    const DT: f32 = 1.0 / 60.0;
    const FULL: Input = Input { throttle: 1.0, steer: 0.0, brake: 0.0 };
    const PIVOT: Input = Input { throttle: 0.0, steer: 1.0, brake: 0.0 };

    fn root() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data")
    }
    fn params_of(id: &str) -> VehicleParams {
        VehicleParams::from_vehicle(&tg_vehicle::load_vehicle(&root().join("vehicles").join(id)).unwrap())
    }
    fn params() -> VehicleParams {
        params_of("proto_a")
    }
    fn terrain(id: &str) -> TerrainDef {
        TerrainDb::from_vec(load_terrains(&root().join("terrains.json")).unwrap()).get(id).unwrap().clone()
    }
    /// Returns the last step's info and the largest slip seen.
    fn run_dt(p: &VehicleParams, s: &mut State, i: Input, t: &TerrainDef, slope: f32, secs: f32, dt: f32) -> (StepInfo, f32) {
        let env = Env::new(t, slope);
        let mut info = StepInfo::default();
        let mut max_slip = 0.0f32;
        for _ in 0..(secs / dt).round() as usize {
            info = step(p, s, i, &env, dt);
            max_slip = max_slip.max(info.track_slip);
        }
        (info, max_slip)
    }
    fn run(p: &VehicleParams, s: &mut State, i: Input, t: &TerrainDef, slope: f32, secs: f32) -> StepInfo {
        run_dt(p, s, i, t, slope, secs, DT).0
    }

    #[test]
    fn terrain_data_is_valid() {
        let r = validate_terrains(&load_terrains(&root().join("terrains.json")).unwrap());
        assert!(r.issues.is_empty(), "\n{}", r);
    }

    #[test]
    fn terrain_rules_catch_bad_values() {
        let soil = terra::SoilDef { n: 0.0, kc: 1.0, kphi: 1.0, c: 0.0, phi_deg: 20.0, k: 0.02, max_sinkage_m: 0.1 };
        let bad = TerrainDef { id: "x".into(), rolling_mult: 0.0, traction_mu: 2.0, lateral_mu: 0.5, soil: Some(soil) };
        let r = validate_terrains(&[bad.clone(), bad]);
        assert!(r.has("R001") && r.has("R002") && r.has("R003") && r.has("R004"));
    }

    #[test]
    fn accelerates_to_30_kmh_quickly_on_road() {
        let (p, road) = (params(), terrain("road"));
        let mut s = State::default();
        let mut t = 0.0;
        let env = Env::new(&road, 0.0);
        while s.u * 3.6 < 30.0 && t < 20.0 {
            step(&p, &mut s, FULL, &env, DT);
            t += DT;
        }
        assert!(t < 12.0, "took {t}s");
    }

    #[test]
    fn top_speed_is_governed() {
        let (p, road) = (params(), terrain("road"));
        let mut s = State::default();
        let info = run(&p, &mut s, FULL, &road, 0.0, 90.0);
        assert!(info.speed_kmh > 42.0 && info.speed_kmh < 52.0, "{} km/h", info.speed_kmh);
        assert_eq!(info.gear, p.trans.gear_ratios.len() - 1);
    }

    #[test]
    fn mud_slips_and_is_slower_than_road() {
        let (p, road, mud) = (params(), terrain("road"), terrain("mud"));
        let (mut a, mut b) = (State::default(), State::default());
        run(&p, &mut a, FULL, &road, 0.0, 8.0);
        let (_, max_slip) = run_dt(&p, &mut b, FULL, &mud, 0.0, 8.0, DT);
        assert!(max_slip > 0.0);
        assert!(b.z < a.z * 0.9, "mud {} road {}", b.z, a.z);
    }

    #[test]
    fn tracks_slip_to_make_thrust() {
        let (p, road, mud) = (params(), terrain("road"), terrain("mud"));
        let mut s = State::default();
        let cruise = run(&p, &mut s, Input { throttle: 0.5, steer: 0.0, brake: 0.0 }, &road, 0.0, 12.0);
        assert!(cruise.slip_left < 0.05 && cruise.track_speed_left >= s.u - 1e-4, "cruise slip {}", cruise.slip_left);
        assert_eq!(cruise.sinkage_m, 0.0);
        let mut s2 = State::default();
        let first = step(&p, &mut s2, FULL, &Env::new(&mud, 0.0), DT);
        assert!(first.slip_left > 0.3, "launch in mud slips {}", first.slip_left);
        assert!(first.track_speed_left > s2.u + 0.3);
        assert!(first.sinkage_m > 0.005);
        // a heavier ground pressure pays more on soft ground
        let ratio = |id: &str| {
            let q = params_of(id);
            let (mut a, mut b) = (State::default(), State::default());
            run(&q, &mut a, FULL, &mud, 0.0, 40.0).speed_kmh / run(&q, &mut b, FULL, &road, 0.0, 40.0).speed_kmh
        };
        assert!(ratio("de_tiger_e") < ratio("su_t34_85"));
    }

    #[test]
    fn neutral_steer_rotates_in_place() {
        let (p, road) = (params(), terrain("road"));
        let mut s = State::default();
        let info = run(&p, &mut s, PIVOT, &road, 0.0, 6.0);
        assert!(info.yaw_rate_deg_s > 30.0 && info.yaw_rate_deg_s < 50.0, "{}", info.yaw_rate_deg_s);
        assert!(s.u.abs() < 0.2 && (s.x * s.x + s.z * s.z).sqrt() < 1.5);
    }

    #[test]
    fn climbs_gentle_slope_without_gear_hunting_but_not_a_cliff() {
        let (p, road) = (params(), terrain("road"));
        let mut a = State::default();
        let env = Env::new(&road, 10f32.to_radians());
        let (mut min_u, mut shifts, mut last_gear) = (f32::MAX, 0, 0);
        for i in 0..(20.0 / DT) as usize {
            step(&p, &mut a, FULL, &env, DT);
            if i as f32 * DT > 10.0 {
                min_u = min_u.min(a.u);
                if a.gear != last_gear {
                    shifts += 1;
                }
            }
            last_gear = a.gear;
        }
        assert!(min_u > 1.0, "10 deg: min u {min_u}");
        assert!(shifts <= 1, "gear hunting: {shifts} shifts in a steady climb");
        let mut b = State::default();
        run(&p, &mut b, FULL, &road, 40f32.to_radians(), 10.0);
        assert!(b.u < 0.5, "40 deg: u={}", b.u);
    }

    #[test]
    fn brakes_to_a_full_stop_and_stays_parked_on_a_slope() {
        let (p, road) = (params(), terrain("road"));
        let mut s = State { u: 10.0, gear: 3, ..Default::default() };
        run(&p, &mut s, Input { throttle: 0.0, steer: 0.0, brake: 1.0 }, &road, 0.0, 3.0);
        assert!(s.u.abs() < 1e-3, "u={}", s.u);
        let mut q = State::default();
        run(&p, &mut q, Input::default(), &road, 10f32.to_radians(), 5.0);
        assert_eq!((q.u, q.z), (0.0, 0.0));
    }

    #[test]
    fn reverse_speed_is_limited_and_rollback_recovers() {
        let (p, road) = (params(), terrain("road"));
        let mut s = State::default();
        run(&p, &mut s, Input { throttle: -1.0, steer: 0.0, brake: 0.0 }, &road, 0.0, 20.0);
        assert!(s.u < -3.5 && s.u > -4.5, "u={}", s.u);
        let mut q = State { u: -3.0, ..Default::default() };
        run(&p, &mut q, FULL, &road, 20f32.to_radians(), 15.0);
        assert!(q.u > 0.5, "u={}", q.u);
    }

    #[test]
    fn hard_turn_at_speed_drifts_on_mud_but_grips_on_road() {
        let p = params();
        let input = Input { throttle: 1.0, steer: 1.0, brake: 0.0 };
        let mut road_s = State { u: 10.0, gear: 3, ..Default::default() };
        run(&p, &mut road_s, input, &terrain("road"), 0.0, 3.0);
        let mud = terrain("mud");
        let env = Env::new(&mud, 0.0);
        let mut mud_s = State { u: 10.0, gear: 3, ..Default::default() };
        let mut max_w = 0.0f32;
        for _ in 0..(3.0 / DT) as usize {
            step(&p, &mut mud_s, input, &env, DT);
            max_w = max_w.max(mud_s.w.abs());
        }
        assert!(road_s.w.abs() < 0.5, "road w={}", road_s.w);
        assert!(max_w > 1.0, "mud max w={max_w}");
    }

    #[test]
    fn simulation_is_deterministic_and_stable_at_30hz() {
        let (p, dirt, road) = (params(), terrain("dirt"), terrain("road"));
        let i = Input { throttle: 0.8, steer: 0.3, brake: 0.0 };
        let (mut a, mut b) = (State::default(), State::default());
        run(&p, &mut a, i, &dirt, 0.05, 10.0);
        run(&p, &mut b, i, &dirt, 0.05, 10.0);
        assert_eq!(a, b);
        let mut c = State::default();
        let (info, _) = run_dt(&p, &mut c, FULL, &road, 0.0, 60.0, 1.0 / 30.0);
        assert!(info.speed_kmh > 42.0 && info.speed_kmh < 52.0, "{}", info.speed_kmh);
    }

    #[test]
    fn historical_vehicles_match_their_data() {
        let road = terrain("road");
        for (id, lo, hi) in [("de_tiger_e", 38.0, 46.0), ("su_t34_85", 48.0, 56.0), ("us_m4a3_76w_hvss", 36.0, 43.0), ("uk_cromwell_iv", 54.0, 64.0)] {
            let p = params_of(id);
            let mut s = State::default();
            let info = run(&p, &mut s, FULL, &road, 0.0, 150.0);
            assert!(info.speed_kmh > lo && info.speed_kmh < hi, "{id} top {}", info.speed_kmh);

            let mut piv = State::default();
            let pi = run(&p, &mut piv, PIVOT, &road, 0.0, 6.0);
            if p.min_turn_radius > 0.0 {
                // cannot neutral-steer: creeps forward in an arc instead
                assert!(piv.u > 0.5 && pi.yaw_rate_deg_s > 3.0, "{id} arc u={} r={}", piv.u, pi.yaw_rate_deg_s);
            } else {
                assert!(piv.u.abs() < 0.2 && pi.yaw_rate_deg_s > 12.0, "{id} pivot r={}", pi.yaw_rate_deg_s);
            }

            let mut rev = State::default();
            run(&p, &mut rev, Input { throttle: -1.0, steer: 0.0, brake: 0.0 }, &road, 0.0, 20.0);
            assert!(rev.u < -0.8 * p.max_reverse_speed && rev.u > -1.1 * p.max_reverse_speed, "{id} reverse {}", rev.u);
        }
    }
}
