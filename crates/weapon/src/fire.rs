//! Fire control: reload timing, the can-fire gate and shot dispersion.
use crate::GunDef;
use tg_shared::{Rng, Vec3};

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct GunState {
    pub reload_remaining_s: f32,
    pub selected_ammo: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FireDenied {
    /// Crew or module state forbids firing (dead gunner, broken breech...).
    Disabled,
    Reloading,
    NoAmmo,
}

pub fn tick_reload(st: &mut GunState, dt: f32) {
    st.reload_remaining_s = (st.reload_remaining_s - dt).max(0.0);
}

/// On success returns the projectile id to spawn and starts the reload.
/// `reload_multiplier` comes from crew state (2.0 with the loader out of action).
pub fn try_fire<'a>(gun: &'a GunDef, st: &mut GunState, can_fire: bool, reload_multiplier: f32) -> Result<&'a str, FireDenied> {
    if !can_fire {
        return Err(FireDenied::Disabled);
    }
    if st.reload_remaining_s > 0.0 {
        return Err(FireDenied::Reloading);
    }
    let ammo = gun.ammo.get(st.selected_ammo).ok_or(FireDenied::NoAmmo)?;
    st.reload_remaining_s = gun.reload_s * reload_multiplier;
    Ok(ammo.as_str())
}

/// Random direction inside a cone of half-angle `dispersion_mrad` around `dir` (unit length).
pub fn disperse(dir: Vec3, dispersion_mrad: f32, rng: &mut Rng) -> Vec3 {
    if dispersion_mrad <= 0.0 {
        return dir;
    }
    let ang = rng.next_f32().sqrt() * dispersion_mrad * 0.001;
    let az = rng.next_f32() * std::f32::consts::TAU;
    let u = dir.any_perpendicular();
    let v = dir.cross(u);
    (dir + (u * az.cos() + v * az.sin()) * ang.tan()).normalized()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gun() -> GunDef {
        GunDef {
            id: "g".into(),
            caliber_mm: 75.0,
            barrel_length_mm: 3600.0,
            recoil_mm: 300.0,
            rounds_per_min: 8.0,
            reload_s: 7.5,
            traverse_deg_s: 20.0,
            elevate_deg_s: 12.0,
            max_depression_deg: 8.0,
            max_elevation_deg: 20.0,
            dispersion_mrad: 1.2,
            mass_kg: 900.0,
            ammo: vec!["ap_75_generic".into()],
            ammo_count: Vec::new(),
            autocannon: None,
            missile: None,
            weapon_group: None,
            damage: None,
        }
    }

    #[test]
    fn reload_and_crew_gates() {
        let g = gun();
        let mut st = GunState::default();
        assert_eq!(try_fire(&g, &mut st, false, 1.0), Err(FireDenied::Disabled));
        assert_eq!(try_fire(&g, &mut st, true, 1.0), Ok("ap_75_generic"));
        assert_eq!(st.reload_remaining_s, 7.5);
        assert_eq!(try_fire(&g, &mut st, true, 1.0), Err(FireDenied::Reloading));
        tick_reload(&mut st, 7.5);
        assert!(try_fire(&g, &mut st, true, 2.0).is_ok());
        assert_eq!(st.reload_remaining_s, 15.0);
        tick_reload(&mut st, 20.0);
        st.selected_ammo = 5;
        assert_eq!(try_fire(&g, &mut st, true, 1.0), Err(FireDenied::NoAmmo));
    }

    #[test]
    fn dispersion_stays_in_cone_and_is_deterministic() {
        let dir = Vec3::new(0.0, 0.0, 1.0);
        let (mut a, mut b) = (Rng::new(42), Rng::new(42));
        for _ in 0..200 {
            let d = disperse(dir, 1.2, &mut a);
            assert_eq!(d, disperse(dir, 1.2, &mut b));
            assert!(d.z.min(1.0).acos() <= 0.0012 + 4e-4, "{}", d.z.min(1.0).acos());
        }
        assert_eq!(disperse(dir, 0.0, &mut a), dir);
    }
}
