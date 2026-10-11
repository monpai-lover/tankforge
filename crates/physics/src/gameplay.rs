//! Source-derived performance policy; contact, mass, suspension and timestep stay original.
use crate::VehicleParams;
use tg_gameplay::{rules, GameplayMode};

/// Call once on the original vehicle parameters when a mode is selected. Never feed a
/// previous derived result back into this function. Stock constructors default to historical
/// behavior by remaining unchanged; the caller owns the derived result for its lifetime.
pub fn derive_vehicle_params(stock: &VehicleParams, mode: GameplayMode) -> VehicleParams {
    let mut effective = stock.clone();
    if mode == GameplayMode::Historical {
        return effective;
    }
    let r = rules(mode);
    // Taller gearing raises the RPM-limited speed. Power = force * speed, so the torque
    // curve gains drive*speed and final drive loses speed: tractive force gains drive.
    let power = r.drive * r.speed;
    effective.trans.final_drive_ratio = (stock.trans.final_drive_ratio as f64 / r.speed) as f32;
    effective.engine.horsepower = (stock.engine.horsepower as f64 * power) as f32;
    for point in &mut effective.engine.torque_curve {
        point[1] = (point[1] as f64 * power) as f32;
    }
    effective.v_top = (stock.v_top as f64 * r.speed) as f32;
    effective.max_reverse_speed = (stock.max_reverse_speed as f64 * r.speed) as f32;
    effective.max_turn_rate = (stock.max_turn_rate as f64 * r.steer) as f32;
    effective.power_w = (stock.power_w as f64 * power) as f32;
    effective
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{VehicleParams, Input, State, Env, TerrainDef, step};
    use crate::tank::powertrain::Powertrain;
    use crate::tank::track_drive::{drive_step, DriveState, DriveEnv};
    use tg_gameplay::GameplayMode;
    use std::path::Path;

    fn stock(id: &str) -> VehicleParams {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data/vehicles").join(id);
        VehicleParams::from_vehicle(&tg_vehicle::load_vehicle(&path).unwrap())
    }
    fn close(a: f64, b: f64) {
        assert!((a - b).abs() < 2e-6 * b.abs().max(1.0), "{a} != {b}");
    }

    #[test]
    fn gameplay_preserves_source_and_historical_identity() {
        for id in ["su_t34_85", "su_t10m", "de_sdkfz234_2"] {
            let p = stock(id);
            let snapshot = format!("{p:?}");
            let h = derive_vehicle_params(&p, GameplayMode::Historical);
            assert_eq!(format!("{h:?}"), snapshot);
            let c = derive_vehicle_params(&p, GameplayMode::Casual);
            assert_eq!(format!("{c:?}"), format!("{:?}", derive_vehicle_params(&p, GameplayMode::Casual)));
            close(c.v_top as f64 / p.v_top as f64, 1.15);
            close(c.max_reverse_speed as f64 / p.max_reverse_speed as f64, 1.15);
            close(c.max_turn_rate as f64 / p.max_turn_rate as f64, 1.25);
            close(c.power_w as f64 / p.power_w as f64, 1.25 * 1.15);
            close(c.engine.horsepower as f64 / p.engine.horsepower as f64, 1.25 * 1.15);
            // Restore only the approved performance fields; every other physical field stays exact.
            let mut physical = c.clone();
            physical.v_top = p.v_top; physical.max_reverse_speed = p.max_reverse_speed;
            physical.max_turn_rate = p.max_turn_rate; physical.power_w = p.power_w;
            physical.engine.horsepower = p.engine.horsepower;
            physical.engine.torque_curve = p.engine.torque_curve.clone();
            physical.trans.final_drive_ratio = p.trans.final_drive_ratio;
            assert_eq!(format!("{physical:?}"), snapshot);
            assert_eq!(format!("{p:?}"), snapshot);
        }
    }

    #[test]
    fn gameplay_native_force_and_governed_speed_match_js_transform() {
        for id in ["su_t34_85", "su_t10m", "de_sdkfz234_2"] {
            let p = stock(id);
            let c = derive_vehicle_params(&p, GameplayMode::Casual);
            let a = Powertrain::new(&p); let b = Powertrain::new(&c);
            let gear = a.last_gear();
            for fraction in [0.65, 0.8, 0.97] {
                let rpm = fraction * a.max_rpm;
                close(b.force_at(rpm / b.ratio(gear), gear) / a.force_at(rpm / a.ratio(gear), gear), 1.25);
                close(b.engine_rpm(rpm / b.ratio(gear), gear), a.engine_rpm(rpm / a.ratio(gear), gear));
                let run = |pt: &Powertrain| {
                    let mut s = DriveState::new(pt, p.mass_kg as f64);
                    s.gearbox.gear = gear;
                    let speed = rpm / pt.ratio(gear) / 60.0 * 2.0 * std::f64::consts::PI * pt.sprocket_r;
                    s.belts[0].v = speed; s.belts[1].v = speed;
                    drive_step(pt, p.mass_kg as f64, &mut s, Input { throttle: 1.0, ..Input::default() }, &DriveEnv { u: speed, resist: 0.0, grade: 0.0 }, 1.0 / 60.0);
                    s
                };
                let sa = run(&a); let sb = run(&b);
                close(sb.f_eng / sa.f_eng, 1.25);
                close(sb.target[0] / sa.target[0], 1.15);
                close(sb.gearbox.rpm, sa.gearbox.rpm);
            }
            let terrain = TerrainDef { id: "grip-limit".into(), rolling_mult: 1.0, traction_mu: 0.01, lateral_mu: 0.01, soil: None };
            let env = Env::new(&terrain, 0.0);
            let mut sa = State::default(); let mut sb = sa;
            let ia = step(&p, &mut sa, Input { throttle: 1.0, ..Input::default() }, &env, 1.0 / 60.0);
            let ib = step(&c, &mut sb, Input { throttle: 1.0, ..Input::default() }, &env, 1.0 / 60.0);
            close(ib.accel_long as f64, ia.accel_long as f64);
            if p.min_turn_radius == 0.0 {
                let run = |pt: &Powertrain| {
                    let mut s = DriveState::new(pt, p.mass_kg as f64);
                    drive_step(pt, p.mass_kg as f64, &mut s, Input { steer: 0.05, ..Input::default() }, &DriveEnv { u: 0.0, resist: 0.0, grade: 0.0 }, 1.0 / 60.0);
                    s
                };
                close(run(&b).motor.diff / run(&a).motor.diff, 1.25);
            }
        }
    }
}
