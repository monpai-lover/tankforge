//! Belt-fed machine guns: a fixed cyclic rate, a belt that has to be changed when it runs out,
//! and a barrel that heats with every round and cools with time.
//!
//! Heat is a simplified model (0 = cold, 1 = too hot to fire): every round adds
//! `1 / heat_rounds`, time removes `1 / cool_s` per second, and a gun that reached 1 refuses to
//! fire until it is back under [`RESUME_HEAT`].
//! (client/web/src/sim/mg.js mirrors this file until the WASM build replaces it.)
use serde::{Deserialize, Serialize};
use std::f32::consts::PI;

pub const RESUME_HEAT: f32 = 0.55;

/// One entry of `data/machine_guns.json`.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MachineGunDef {
    pub id: String,
    pub name: String,
    pub caliber_mm: f32,
    /// Cyclic rate, rounds per minute.
    pub rate_rpm: f32,
    pub muzzle_velocity_ms: f32,
    pub bullet_mass_g: f32,
    pub drag_coefficient: f32,
    /// Rounds in one belt, drum or pan as the vehicle mount feeds it.
    pub belt_rounds: u32,
    /// Seconds to change the belt.
    pub reload_s: f32,
    pub dispersion_mrad: f32,
    /// Every n-th round carries a tracer; 0 = none.
    pub tracer_every: u32,
    /// Penetration of the usual armour-piercing round at 100 m, 0 degrees.
    pub pen_mm_100m: f32,
    /// Rounds of continuous fire that take a cold barrel to its limit.
    pub heat_rounds: f32,
    /// Seconds for a barrel at its limit to cool completely.
    pub cool_s: f32,
    /// Display colour of the tracer (client only).
    #[serde(default)]
    pub tracer_rgb: Option<[f32; 3]>,
    /// Neutral receiver/barrel boxes used by the shared combat target registrar.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub damage_geometry: Option<MgDamageGeometry>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MgDamageBox {
    pub center: [f32; 3],
    pub half_extents: [f32; 3],
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MgDamageGeometry {
    pub source: String,
    pub muzzle: [f32; 3],
    pub receiver: MgDamageBox,
    pub barrel: MgDamageBox,
    #[serde(default, skip_serializing_if = "std::collections::BTreeMap::is_empty")]
    pub variants: std::collections::BTreeMap<String, MgDamageGeometry>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MgState {
    pub belt: u32,
    /// Time until the next round can leave the barrel.
    pub cooldown: f32,
    pub heat: f32,
    /// Remaining seconds of the belt change (0 = not reloading).
    pub reload: f32,
    pub hot: bool,
    /// Rounds fired since the gun was created (drives the tracer pattern).
    pub fired: u64,
}

impl MgState {
    pub fn new(def: &MachineGunDef) -> Self {
        MgState { belt: def.belt_rounds, cooldown: 0.0, heat: 0.0, reload: 0.0, hot: false, fired: 0 }
    }
}

/// Advances one gun by `dt` seconds. `trigger` = the gunner is holding the trigger.
/// Returns how many rounds left the barrel during this step.
pub fn step(def: &MachineGunDef, st: &mut MgState, trigger: bool, dt: f32) -> u32 {
    let interval = 60.0 / def.rate_rpm;
    st.heat = (st.heat - dt / def.cool_s).max(0.0);
    if st.hot && st.heat < RESUME_HEAT {
        st.hot = false;
    }
    if st.reload > 0.0 {
        st.reload -= dt;
        if st.reload <= 0.0 {
            st.reload = 0.0;
            st.belt = def.belt_rounds;
        }
    }
    st.cooldown -= dt;
    if !trigger || st.hot || st.reload > 0.0 {
        if st.cooldown < 0.0 {
            st.cooldown = 0.0;
        }
        return 0;
    }
    let mut n = 0;
    while st.cooldown <= 0.0 {
        st.cooldown += interval;
        st.belt = st.belt.saturating_sub(1);
        st.fired += 1;
        st.heat += 1.0 / def.heat_rounds;
        n += 1;
        if st.belt == 0 {
            st.reload = def.reload_s;
            st.cooldown = 0.0;
            break;
        }
        if st.heat >= 1.0 {
            st.heat = 1.0;
            st.hot = true;
            st.cooldown = 0.0;
            break;
        }
    }
    n
}

/// True for the rounds that carry a tracer (call right after the round was counted).
pub fn is_tracer(def: &MachineGunDef, st: &MgState) -> bool {
    def.tracer_every > 0 && st.fired % def.tracer_every as u64 == 0
}

/// Direction of a flexible mount in its own frame, radians.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct MountAim {
    pub yaw: f32,
    pub pitch: f32,
}

fn wrap_pi(a: f32) -> f32 {
    let mut a = (a + PI) % (2.0 * PI);
    if a < 0.0 {
        a += 2.0 * PI;
    }
    a - PI
}

/// Slews a hand-laid mount towards `want` at `rate` rad/s.
/// `arc` = [yaw half-angle, depression, elevation] in radians; a yaw half-angle of PI or more is
/// free traverse, `None` is no limit at all. Returns true when the gun is on the target.
pub fn slew_mount(aim: &mut MountAim, want: MountAim, arc: Option<[f32; 3]>, rate: f32, dt: f32) -> bool {
    let wy = wrap_pi(want.yaw);
    let (ty, tp) = match arc {
        Some(a) => (if a[0] < PI { wy.clamp(-a[0], a[0]) } else { wy }, want.pitch.clamp(-a[1], a[2])),
        None => (wy, want.pitch),
    };
    let step = rate * dt;
    aim.yaw = wrap_pi(aim.yaw + wrap_pi(ty - aim.yaw).clamp(-step, step));
    aim.pitch += (tp - aim.pitch).clamp(-step, step);
    wrap_pi(want.yaw - aim.yaw).abs() < 0.03 && (want.pitch - aim.pitch).abs() < 0.03
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mg34() -> MachineGunDef {
        MachineGunDef {
            id: "mg34".into(),
            name: "MG 34".into(),
            caliber_mm: 7.92,
            rate_rpm: 850.0,
            muzzle_velocity_ms: 755.0,
            bullet_mass_g: 12.8,
            drag_coefficient: 0.30,
            belt_rounds: 150,
            reload_s: 6.0,
            dispersion_mrad: 1.6,
            tracer_every: 4,
            pen_mm_100m: 10.0,
            heat_rounds: 250.0,
            cool_s: 100.0,
            tracer_rgb: None,
            damage_geometry: None,
        }
    }

    #[test]
    fn cyclic_rate_belt_change_overheating_and_cooling() {
        let def = mg34();
        let mut st = MgState::new(&def);
        let dt = 1.0 / 120.0;
        let mut fired = 0;
        for _ in 0..240 {
            fired += step(&def, &mut st, true, dt);
        }
        assert!((fired as f32 - 2.0 * def.rate_rpm / 60.0).abs() <= 1.0, "fired {}", fired);
        assert_eq!(st.belt, def.belt_rounds - fired);
        assert!(st.heat > 0.05 && st.heat < 0.2, "heat {}", st.heat);
        // released: nothing leaves the barrel, and the first round after the pause is immediate
        for _ in 0..120 {
            assert_eq!(step(&def, &mut st, false, dt), 0);
        }
        assert_eq!(step(&def, &mut st, true, dt), 1);
        // run the belt out: the gun stops, changes belts for reload_s, then carries on
        let mut guard = 0;
        while st.reload == 0.0 && guard < 5000 {
            step(&def, &mut st, true, dt);
            guard += 1;
        }
        assert_eq!(st.belt, 0);
        assert!((st.reload - def.reload_s).abs() < 1e-6);
        let mut during = 0;
        for _ in 0..((def.reload_s / dt).round() as usize - 2) {
            during += step(&def, &mut st, true, dt);
        }
        assert_eq!(during, 0);
        for _ in 0..10 {
            step(&def, &mut st, true, dt);
        }
        assert!(st.belt > def.belt_rounds - 5 && st.belt < def.belt_rounds);
        // belt after belt: the barrel overheats, the gun refuses, and it recovers once cooler
        guard = 0;
        while !st.hot && guard < 200_000 {
            step(&def, &mut st, true, dt);
            guard += 1;
        }
        assert!(st.hot, "never overheated");
        assert_eq!(step(&def, &mut st, true, dt), 0);
        guard = 0;
        while st.hot && guard < 200_000 {
            step(&def, &mut st, false, dt);
            guard += 1;
        }
        assert!(st.heat < RESUME_HEAT && guard as f32 * dt > 10.0);
    }

    #[test]
    fn tracers_come_at_the_belt_interval() {
        let def = mg34();
        let mut st = MgState::new(&def);
        let mut tracers = 0u64;
        for _ in 0..1200 {
            if step(&def, &mut st, true, 1.0 / 120.0) > 0 && is_tracer(&def, &st) {
                tracers += 1;
            }
        }
        assert!((tracers as i64 - (st.fired / def.tracer_every as u64) as i64).abs() <= 1, "{} of {}", tracers, st.fired);
    }

    #[test]
    fn ball_mount_stays_inside_its_arc_and_a_pintle_swings_all_the_way_round() {
        let rad = |d: f32| d.to_radians();
        let arc = Some([rad(15.0), rad(10.0), rad(20.0)]);
        let mut aim = MountAim::default();
        let mut on = false;
        for _ in 0..240 {
            on = slew_mount(&mut aim, MountAim { yaw: rad(8.0), pitch: rad(5.0) }, arc, rad(50.0), 1.0 / 120.0);
        }
        assert!(on && (aim.yaw - rad(8.0)).abs() < 1e-5 && (aim.pitch - rad(5.0)).abs() < 1e-5);
        for _ in 0..240 {
            on = slew_mount(&mut aim, MountAim { yaw: rad(60.0), pitch: rad(-30.0) }, arc, rad(50.0), 1.0 / 120.0);
        }
        assert!(!on && (aim.yaw - rad(15.0)).abs() < 1e-5 && (aim.pitch + rad(10.0)).abs() < 1e-5);
        let mut free = MountAim::default();
        for _ in 0..600 {
            on = slew_mount(&mut free, MountAim { yaw: rad(-170.0), pitch: rad(40.0) }, Some([PI, rad(10.0), rad(60.0)]), rad(70.0), 1.0 / 120.0);
        }
        assert!(on && (free.yaw - rad(-170.0)).abs() < 1e-5 && (free.pitch - rad(40.0)).abs() < 1e-5);
    }
}
