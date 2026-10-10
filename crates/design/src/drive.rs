//! Engine, gearbox and running-gear numbers for the physics model, derived from the player's
//! choices and the vehicle's real mass; and a mobility test that drives the result through
//! the same `tg-physics` step function the server and client use.
use crate::catalog::{Catalog, EngineCat};
use crate::model::VehicleDesign;
use serde::Serialize;
use std::f64::consts::PI;
use tg_physics::{step, Env, Input, State, TerrainDef, VehicleParams};
use tg_vehicle::{EngineDef, EngineFile, TransmissionDef};

const G: f64 = 9.81;

/// Torque curve with the rated power at max rpm and the catalog's torque rise below it.
pub fn torque_curve(c: &EngineCat, hp: f64) -> Vec<[f32; 2]> {
    let w_max = c.max_rpm * 2.0 * PI / 60.0;
    let t_rated = hp * 745.7 / w_max;
    let t_peak = t_rated * c.torque_rise;
    let pts = [(c.idle_rpm, 0.72), (c.max_rpm * 0.4, 0.94), (c.max_rpm * 0.6, 1.0), (c.max_rpm * 0.8, (1.0 + 1.0 / c.torque_rise) * 0.5), (c.max_rpm, 1.0 / c.torque_rise)];
    pts.iter().map(|(rpm, k)| [rpm.round() as f32, (t_peak * k).round() as f32]).collect()
}

pub const FINAL_DRIVE: f64 = 4.0;

/// Gear ratios for the requested top speed; first gear sized to climb (limited by how wide a
/// spread a gearbox can have, so a heavy, underpowered vehicle climbs badly).
pub fn gearing(d: &VehicleDesign, cat: &Catalog, mass_kg: f64, curve: &[[f32; 2]], max_rpm: f64, efficiency: f64) -> Vec<f32> {
    let rs = cat.tracks.sprocket_radius_m;
    let vt = (d.transmission.gearing_kmh / 3.6).clamp(3.0, 40.0);
    let top = 0.95 * max_rpm * 2.0 * PI * rs / (60.0 * vt);
    let t_peak = curve.iter().map(|p| p[1] as f64).fold(0.0, f64::max).max(1.0);
    let first = (0.65 * mass_kg * G * rs / (t_peak * efficiency)).clamp(top * 1.5, top * 14.0);
    let n = d.transmission.forward_gears.clamp(2, 12) as usize;
    (0..n)
        .map(|i| {
            let k = i as f64 / (n - 1) as f64;
            ((first * (top / first).powf(k) / FINAL_DRIVE) * 1000.0).round() as f32 / 1000.0
        })
        .collect()
}

pub fn engine_file(d: &VehicleDesign, cat: &Catalog, mass_kg: f64) -> Option<EngineFile> {
    let c = cat.engines.get(&d.engine.kind)?;
    let t = cat.transmissions.get(&d.transmission.kind)?;
    let hp = d.engine.power_hp.clamp(c.min_hp, c.max_hp);
    let curve = torque_curve(c, hp);
    let ratios = gearing(d, cat, mass_kg, &curve, c.max_rpm, t.efficiency);
    Some(EngineFile {
        engine: EngineDef { horsepower: hp as f32, max_rpm: c.max_rpm as f32, idle_rpm: c.idle_rpm as f32, weight_kg: (c.base_kg + c.kg_per_hp * hp) as f32, torque_curve: curve },
        transmission: TransmissionDef { forward_gears: ratios.len() as u32, reverse_gears: 1, gear_ratios: ratios, final_drive_ratio: FINAL_DRIVE as f32, shift_time_s: t.shift_time_s as f32 },
    })
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct MobilityReport {
    pub power_to_weight_hp_t: f64,
    pub top_speed_road_kmh: f64,
    pub top_speed_dirt_kmh: f64,
    pub top_speed_mud_kmh: f64,
    pub gearing_top_speed_kmh: f64,
    pub accel_0_32_s: Option<f64>,
    pub ground_pressure_kpa: f64,
    pub max_turn_rate_deg_s: f64,
    pub min_turn_radius_m: f64,
    pub neutral_steer: bool,
    pub brake_decel_ms2: f64,
    pub stopping_distance_40_m: f64,
    pub max_climb_deg: f64,
    pub fuel_l: f64,
    pub fuel_l_per_100km_road: f64,
    pub fuel_l_per_100km_offroad: f64,
    pub range_road_km: f64,
    pub range_offroad_km: f64,
    pub length_to_gauge: f64,
}

fn drive(p: &VehicleParams, terrain: &TerrainDef, slope_deg: f64, seconds: f64) -> (Option<f64>, f64) {
    let mut s = State::default();
    let dt = 1.0 / 30.0;
    let env = Env::new(terrain, slope_deg.to_radians() as f32);
    let mut t32 = None;
    let mut top = 0.0f64;
    let n = (seconds / dt) as usize;
    for i in 0..n {
        let info = step(p, &mut s, Input { throttle: 1.0, steer: 0.0, brake: 0.0, drive_power: None }, &env, dt as f32);
        let kmh = info.speed_kmh as f64;
        if t32.is_none() && kmh >= 32.0 {
            t32 = Some((i + 1) as f64 * dt);
        }
        top = top.max(kmh);
    }
    (t32, top)
}

/// Full-throttle runs on road, dirt and mud, and the steepest slope the vehicle still climbs.
pub fn mobility_runs(p: &VehicleParams, terrains: &[TerrainDef]) -> (Option<f64>, f64, f64, f64, f64) {
    let find = |id: &str| terrains.iter().find(|t| t.id == id);
    let road = find("road");
    let (t32, top_road) = road.map(|t| drive(p, t, 0.0, 90.0)).unwrap_or((None, 0.0));
    let top_dirt = find("dirt").map(|t| drive(p, t, 0.0, 60.0).1).unwrap_or(0.0);
    let top_mud = find("mud").map(|t| drive(p, t, 0.0, 60.0).1).unwrap_or(0.0);
    let mut climb = 0.0;
    if let Some(dirt) = find("dirt") {
        let (mut lo, mut hi) = (0.0f64, 45.0f64);
        for _ in 0..7 {
            let mid = 0.5 * (lo + hi);
            if drive(p, dirt, mid, 15.0).1 > 2.0 {
                lo = mid;
            } else {
                hi = mid;
            }
        }
        climb = lo;
    }
    (t32, top_road, top_dirt, top_mud, climb)
}
