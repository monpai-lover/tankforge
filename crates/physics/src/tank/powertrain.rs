//! PowertrainSystem: engine torque curve -> gearbox (automatic, force-aware so it does not hunt)
//! -> final drive -> sprocket force. The engine turns with the tracks: its speed follows the mean
//! track speed through the gear ratio; below the launch speed the clutch slips and the engine
//! sits at its peak-torque speed.
//! (client/web/src/sim/tank/drive.js mirrors this file and track_drive.rs.)
use crate::{torque_at, VehicleParams};
use std::f64::consts::PI;

/// The vehicle's drivetrain numbers in the tank model's units (f64).
#[derive(Clone, Debug)]
pub struct Powertrain {
    pub gauge: f64,
    pub sprocket_r: f64,
    pub efficiency: f64,
    pub brake_decel: f64,
    pub cd_a: f64,
    pub rolling_resistance: f64,
    pub max_turn_rate: f64,
    pub max_reverse_speed: f64,
    pub min_turn_radius: f64,
    pub shift_time: f64,
    pub v_top: f64,
    /// At the tracks, W.
    pub power: f64,
    pub rev_gear: usize,
    pub launch_rpm: f64,
    pub idle_rpm: f64,
    pub max_rpm: f64,
    pub gear_ratios: Vec<f64>,
    pub final_drive: f64,
    pub torque_curve: Vec<[f32; 2]>,
}

impl Powertrain {
    pub fn new(p: &VehicleParams) -> Self {
        Self {
            gauge: p.gauge_m as f64,
            sprocket_r: p.sprocket_r as f64,
            efficiency: p.efficiency as f64,
            brake_decel: p.brake_decel as f64,
            cd_a: p.cd_a as f64,
            rolling_resistance: p.rolling_resistance as f64,
            max_turn_rate: p.max_turn_rate as f64,
            max_reverse_speed: p.max_reverse_speed as f64,
            min_turn_radius: p.min_turn_radius as f64,
            shift_time: p.shift_time as f64,
            v_top: p.v_top as f64,
            power: p.power_w as f64,
            rev_gear: p.rev_gear,
            launch_rpm: p.launch_rpm as f64,
            idle_rpm: p.engine.idle_rpm as f64,
            max_rpm: p.engine.max_rpm as f64,
            gear_ratios: p.trans.gear_ratios.iter().map(|r| *r as f64).collect(),
            final_drive: p.trans.final_drive_ratio as f64,
            torque_curve: p.engine.torque_curve.clone(),
        }
    }

    pub fn last_gear(&self) -> usize {
        self.gear_ratios.len() - 1
    }

    /// Overall ratio from engine to sprocket in `gear`.
    pub fn ratio(&self, gear: usize) -> f64 {
        self.gear_ratios[gear] * self.final_drive
    }

    /// Sprocket rpm at track speed `v` (m/s).
    pub fn wheel_rpm(&self, v: f64) -> f64 {
        v.abs() * 60.0 / (2.0 * PI * self.sprocket_r)
    }

    /// Engine speed in `gear` with the sprocket at `wheel_rpm` (clutch slipping below launch).
    pub fn engine_rpm(&self, wheel_rpm: f64, gear: usize) -> f64 {
        (wheel_rpm * self.ratio(gear)).clamp(self.launch_rpm, self.max_rpm)
    }

    /// Track force the engine can give in `gear` with the sprocket at `wheel_rpm` (governed).
    pub fn force_at(&self, wheel_rpm: f64, gear: usize) -> f64 {
        let rpm = self.engine_rpm(wheel_rpm, gear);
        let governor = if rpm <= 0.95 * self.max_rpm { 1.0 } else { ((self.max_rpm - rpm) / (0.05 * self.max_rpm)).clamp(0.0, 1.0) };
        torque_at(&self.torque_curve, rpm as f32) as f64 * governor * self.ratio(gear) * self.efficiency / self.sprocket_r
    }

    /// Rolling resistance of the running gear on this ground, as a force (load: N on the ground).
    pub fn rolling_force(&self, roll_mult: f64, load: f64) -> f64 {
        self.rolling_resistance * roll_mult * load
    }
}

/// The automatic gearbox.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Gearbox {
    pub gear: usize,
    pub shift_timer: f64,
    pub rpm: f64,
}

/// What the gearbox decides from.
#[derive(Clone, Copy, Debug)]
pub struct ShiftInput {
    pub drive_power: f64,
    /// Hull speed along its axis, m/s.
    pub u: f64,
    /// Mean |track speed|, m/s.
    pub avg_track: f64,
    pub reversing: bool,
    /// The driver wants more speed (within the speed lever's saturation).
    pub driving: bool,
    /// Resistance (rolling + air + grade against the direction of travel), N.
    pub demand: f64,
    /// Grade force against the direction of travel, N (>= 0).
    pub climb: f64,
    pub mass: f64,
}

impl Gearbox {
    /// Gear choice for this step; then the engine speed and the force it can give (0 mid-shift).
    pub fn step(&mut self, pt: &Powertrain, s: &ShiftInput, dt: f64) -> f64 {
        let last = pt.last_gear();
        self.gear = self.gear.min(last);
        let max_rpm = pt.max_rpm;
        let wheel_rpm = pt.wheel_rpm(s.avg_track);
        // gear choice follows the road speed, not spinning tracks (nobody changes up on wheelspin)
        let road_rpm = pt.wheel_rpm(s.u);
        self.shift_timer = (self.shift_timer - dt).max(0.0);
        if s.reversing {
            self.gear = pt.rev_gear;
        } else if s.u.abs() < 0.3 && s.avg_track < 1.5 {
            if self.gear != 0 {
                self.shift_timer = 0.0;
            }
            self.gear = 0;
        } else if self.shift_timer <= 0.0 {
            let rpm_now = road_rpm * pt.ratio(self.gear);
            // an upshift costs drive for the shift time: on a climb the next gear needs a good
            // margin, and the shift must not cost most of the speed (in deep mud or on a steep
            // climb the driver stays in the low gear)
            let lost_in_shift = (s.demand + s.climb) / s.mass * pt.shift_time;
            if self.gear < last && rpm_now > 0.85 * max_rpm && pt.force_at(wheel_rpm, self.gear + 1) * s.drive_power > (s.demand + s.climb) * 1.2 && lost_in_shift < 0.75 * s.u.abs() {
                self.gear += 1;
                self.shift_timer = pt.shift_time;
            } else if self.gear > 0 && road_rpm * pt.ratio(self.gear - 1) < 0.8 * max_rpm {
                let cannot_hold = s.driving && pt.force_at(wheel_rpm, self.gear) * s.drive_power < s.demand * 1.05;
                let coasting_down = !s.driving && rpm_now < pt.idle_rpm;
                if cannot_hold || coasting_down {
                    self.gear -= 1;
                    self.shift_timer = if cannot_hold { pt.shift_time } else { 0.0 };
                }
            }
        }
        self.rpm = pt.engine_rpm(wheel_rpm, self.gear);
        if self.shift_timer > 0.0 {
            0.0
        } else {
            pt.force_at(wheel_rpm, self.gear) * s.drive_power
        }
    }
}
