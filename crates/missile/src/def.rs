//! What a missile or rocket is (data/missiles.json) and what an active protection system is (a
//! vehicle's weapons.json "aps"). Every number the simulation uses lives here, so another
//! missile or another protection system is a new entry, not new code.
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Guidance {
    /// Unguided: flies where it was pointed, falls under gravity (rockets).
    None,
    /// Semi-automatic command to line of sight over a wire: the gunner keeps the sight on the
    /// target and the missile is steered onto the line from the sight through the aim point.
    Saclos,
}

fn one() -> f64 {
    1.0
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MissileDef {
    pub id: String,
    pub name: String,
    pub guidance: Guidance,
    pub mass_kg: f64,
    pub caliber_mm: f64,
    pub length_m: f64,
    /// Fin span (the target the bullets see is the body plus a share of the fins).
    #[serde(default)]
    pub span_m: f64,
    /// Speed leaving the tube or rail, the top speed the motor brings it to, and how long that takes.
    pub launch_speed_ms: f64,
    pub max_speed_ms: f64,
    pub boost_s: f64,
    /// Total motor time (>= boost_s); after it the missile coasts, slowed by `drag_k` (dv/dt = -k v^2).
    pub burn_s: f64,
    pub drag_k: f64,
    pub max_range_m: f64,
    /// It is armed (and steerable) only beyond this distance.
    pub min_range_m: f64,
    /// Sideways acceleration the fins can give it (m/s^2).
    pub turn_accel_ms2: f64,
    /// Guided flight holds its height (the sustainer and the body's lift carry the weight);
    /// without guidance, or for a rocket, gravity bends the path.
    #[serde(default)]
    pub lift: bool,
    /// Bullet hits the structure takes before it breaks up.
    pub hp: f64,
    /// Share of the length (from the nose) that is warhead: a hit there may set it off.
    #[serde(default = "warhead_share")]
    pub warhead_share: f64,
    /// Chance a hit on the warhead sets it off in the air.
    #[serde(default = "half")]
    pub fuse_chance: f64,
    /// Chance a hit elsewhere cuts the wire, the controls or the motor (it flies on unguided).
    #[serde(default = "third")]
    pub control_loss_chance: f64,
    /// The warhead as a projectile (data/projectiles): what it does when it strikes.
    pub warhead: String,
    /// Steering lag of the control loop (s).
    #[serde(default = "lag")]
    pub guidance_lag_s: f64,
    #[serde(default = "one")]
    pub smoke: f64,
}

fn warhead_share() -> f64 {
    0.35
}
fn half() -> f64 {
    0.5
}
fn third() -> f64 {
    0.33
}
fn lag() -> f64 {
    0.25
}

/// An automatic, radar-directed gun that shoots incoming missiles and rockets down.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ApsDef {
    pub name: String,
    /// The radar: how far it sees, how often it updates, its elevation coverage (deg) and how good
    /// a measurement is (angle in mrad, range in m).
    pub radar_range_m: f64,
    pub radar_rate_hz: f64,
    pub radar_elevation_deg: [f64; 2],
    pub angle_noise_mrad: f64,
    pub range_noise_m: f64,
    /// Chance of a detection per look at the edge of range (it rises to 0.98 close in).
    pub detect_chance_far: f64,
    /// Consecutive detections before a track is firm, time without one before it is dropped.
    pub confirm_hits: u32,
    pub drop_after_s: f64,
    /// Threats it can do anything about: slower than this is ignored (debris), faster is beyond
    /// the gun (long-rod and full-calibre shot).
    pub min_threat_speed_ms: f64,
    pub max_threat_speed_ms: f64,
    /// A track is a threat when it will pass within this of the vehicle's middle.
    pub threat_miss_m: f64,
    /// Opens fire inside engage, ceases inside stop (the debris would carry on anyway).
    pub engage_range_m: f64,
    pub stop_range_m: f64,
    /// The gun: rate (adjustable within rate_range_rpm), rounds, spin-up of the barrel cluster,
    /// laying rates and limits, servo lag, scatter, its bullet.
    pub rate_rpm: f64,
    pub rate_range_rpm: [f64; 2],
    pub rounds: u32,
    pub spin_up_s: f64,
    pub traverse_deg_s: f64,
    pub elevate_deg_s: f64,
    pub max_elevation_deg: f64,
    /// Lowest the gun may point at each 10 deg of bearing relative to the vehicle's turret
    /// (36 entries; positive = below the horizon). Empty: `max_depression_deg` everywhere.
    #[serde(default)]
    pub depression_by_bearing_deg: Vec<f64>,
    #[serde(default)]
    pub max_depression_deg: f64,
    pub servo_lag_s: f64,
    pub dispersion_mrad: f64,
    /// It fires only when laid within this of the solution (mrad).
    pub fire_window_mrad: f64,
    pub barrel_m: f64,
    pub bullet_speed_ms: f64,
    pub bullet_mass_kg: f64,
    pub bullet_caliber_mm: f64,
    pub bullet_drag: f64,
    /// Every n-th round carries a tracer.
    pub tracer_every: u32,
    /// Heat: the barrels are too hot after `heat_rounds` in a row; they cool at `cool_per_s` of
    /// that a second and fire again below `resume_heat`.
    pub heat_rounds: f64,
    pub cool_per_s: f64,
    pub resume_heat: f64,
}

impl ApsDef {
    /// The lowest allowed elevation (rad, negative = below the horizon) at a bearing (rad)
    /// relative to the vehicle's turret.
    pub fn min_pitch(&self, rel_yaw: f64) -> f64 {
        let t = &self.depression_by_bearing_deg;
        let dep = if t.is_empty() {
            self.max_depression_deg
        } else {
            let mut deg = rel_yaw.to_degrees() % 360.0;
            if deg < 0.0 {
                deg += 360.0;
            }
            let step = 360.0 / t.len() as f64;
            let i = (deg / step).floor() as usize % t.len();
            let f = deg / step - (deg / step).floor();
            t[i] * (1.0 - f) + t[(i + 1) % t.len()] * f
        };
        -dep.to_radians()
    }

    /// The Oplot-MO of the T-10M (used by tests; the game reads the same from weapons.json).
    pub fn oplot_mo() -> ApsDef {
        ApsDef {
            name: "Oplot-MO".into(),
            radar_range_m: 2000.0,
            radar_rate_hz: 25.0,
            radar_elevation_deg: [-10.0, 30.0],
            angle_noise_mrad: 1.5,
            range_noise_m: 1.0,
            detect_chance_far: 0.55,
            confirm_hits: 3,
            drop_after_s: 0.6,
            min_threat_speed_ms: 40.0,
            max_threat_speed_ms: 650.0,
            threat_miss_m: 6.0,
            engage_range_m: 200.0,
            stop_range_m: 20.0,
            rate_rpm: 10000.0,
            rate_range_rpm: [9000.0, 11000.0],
            rounds: 900,
            spin_up_s: 0.35,
            traverse_deg_s: 180.0,
            elevate_deg_s: 120.0,
            max_elevation_deg: 70.0,
            depression_by_bearing_deg: Vec::new(),
            max_depression_deg: 10.0,
            servo_lag_s: 0.06,
            dispersion_mrad: 2.0,
            fire_window_mrad: 6.0,
            barrel_m: 1.35,
            bullet_speed_ms: 990.0,
            bullet_mass_kg: 0.064,
            bullet_caliber_mm: 14.5,
            bullet_drag: 0.30,
            tracer_every: 3,
            heat_rounds: 600.0,
            cool_per_s: 0.12,
            resume_heat: 0.5,
        }
    }
}

impl MissileDef {
    /// BGM-71A TOW (tests; the game reads data/missiles.json).
    pub fn tow() -> MissileDef {
        MissileDef {
            id: "bgm71a_tow".into(),
            name: "BGM-71A TOW".into(),
            guidance: Guidance::Saclos,
            mass_kg: 18.9,
            caliber_mm: 152.0,
            length_m: 1.17,
            span_m: 0.46,
            launch_speed_ms: 70.0,
            max_speed_ms: 300.0,
            boost_s: 1.6,
            burn_s: 1.6,
            drag_k: 1.8e-4,
            max_range_m: 3750.0,
            min_range_m: 65.0,
            turn_accel_ms2: 60.0,
            lift: true,
            hp: 3.0,
            warhead_share: 0.35,
            // a 14.5 mm API round through a thin aluminium body: the shaped charge is set off or
            // wrecked more often than not, wires and control actuators are easily cut
            fuse_chance: 0.65,
            control_loss_chance: 0.45,
            warhead: "heat_152_tow".into(),
            guidance_lag_s: 0.25,
            smoke: 1.0,
        }
    }
}
