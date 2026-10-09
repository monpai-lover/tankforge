//! Turret traverse / gun elevation control and muzzle geometry.
//! Angles in radians. Yaw is clockwise from the hull's +Z towards +X; pitch is up-positive.
use crate::GunDef;
use std::f32::consts::PI;
use tg_shared::{rotate_yaw, HullPose, Vec3};

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct TurretState {
    pub yaw: f32,
    pub pitch: f32,
}

/// Health of the aiming drives: 1.0 = full speed, 0.0 = jammed. Derived from module damage.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct AimDrive {
    pub traverse: f32,
    pub elevate: f32,
}

impl Default for AimDrive {
    fn default() -> Self {
        Self { traverse: 1.0, elevate: 1.0 }
    }
}

/// Wraps an angle into [-PI, PI).
pub fn wrap_pi(a: f32) -> f32 {
    let two_pi = 2.0 * PI;
    let mut x = (a + PI) % two_pi;
    if x < 0.0 {
        x += two_pi;
    }
    x - PI
}

/// Rate-limited slew towards the requested yaw/pitch. Yaw takes the shortest way round;
/// pitch is clamped to the gun's depression/elevation limits.
pub fn aim_step(gun: &GunDef, s: &mut TurretState, target_yaw: f32, target_pitch: f32, drive: AimDrive, dt: f32) {
    let max_yaw = (gun.traverse_deg_s.to_radians() * drive.traverse * dt).max(0.0);
    let dy = wrap_pi(target_yaw - s.yaw);
    s.yaw = wrap_pi(s.yaw + dy.clamp(-max_yaw, max_yaw));

    let lo = -gun.max_depression_deg.to_radians();
    let hi = gun.max_elevation_deg.to_radians().max(lo);
    let tp = target_pitch.clamp(lo, hi);
    let max_pitch = (gun.elevate_deg_s.to_radians() * drive.elevate * dt).max(0.0);
    s.pitch = (s.pitch + (tp - s.pitch).clamp(-max_pitch, max_pitch)).clamp(lo, hi);
}

/// Traverse for a turret with a limited arc. `facing` is the centre of the arc (rad, hull frame)
/// and `limit` = (min, max) offsets from it. The turret never swings through the blocked sector.
/// Returns the yaw it is trying to reach, so callers can tell whether the target is inside the arc.
pub fn traverse_limited(s: &mut TurretState, target_yaw: f32, facing: f32, limit: Option<(f32, f32)>, rate_rad_s: f32, dt: f32) -> f32 {
    let max = (rate_rad_s * dt).max(0.0);
    match limit {
        None => {
            s.yaw = wrap_pi(s.yaw + wrap_pi(target_yaw - s.yaw).clamp(-max, max));
            target_yaw
        }
        Some((lo, hi)) => {
            let rel = wrap_pi(s.yaw - facing).clamp(lo, hi);
            let want = wrap_pi(target_yaw - facing).clamp(lo, hi);
            s.yaw = wrap_pi(facing + rel + (want - rel).clamp(-max, max));
            wrap_pi(facing + want)
        }
    }
}

/// Elevation only (same limits and rate rules as `aim_step`), for vehicles whose guns elevate
/// independently of the traverse.
pub fn elevate(gun: &GunDef, pitch: &mut f32, target_pitch: f32, scale: f32, dt: f32) {
    let lo = -gun.max_depression_deg.to_radians();
    let hi = gun.max_elevation_deg.to_radians().max(lo);
    let tp = target_pitch.clamp(lo, hi);
    let max = (gun.elevate_deg_s.to_radians() * scale * dt).max(0.0);
    *pitch = (*pitch + (tp - *pitch).clamp(-max, max)).clamp(lo, hi);
}

/// Where the gun sits on the vehicle (hull-local space, turret yaw 0).
#[derive(Clone, Copy, Debug)]
pub struct GunMount {
    /// Turret ring centre: the turret rotates about the vertical axis through this point.
    pub pivot: Vec3,
    /// Gun trunnion: the gun elevates about this point.
    pub trunnion: Vec3,
    pub muzzle_offset_m: f32,
}

#[derive(Clone, Copy, Debug)]
pub struct Muzzle {
    pub trunnion: Vec3,
    pub pos: Vec3,
    pub dir: Vec3,
}

pub fn gun_dir_local(t: &TurretState) -> Vec3 {
    let cp = t.pitch.cos();
    Vec3::new(t.yaw.sin() * cp, t.pitch.sin(), t.yaw.cos() * cp)
}

/// Muzzle position and bore direction in hull-local space.
pub fn muzzle_local(m: &GunMount, t: &TurretState) -> Muzzle {
    let trunnion = m.pivot + rotate_yaw(m.trunnion - m.pivot, t.yaw);
    let dir = gun_dir_local(t);
    Muzzle { trunnion, pos: trunnion + dir * m.muzzle_offset_m, dir }
}

pub fn muzzle_world(pose: &HullPose, m: &GunMount, t: &TurretState) -> Muzzle {
    let l = muzzle_local(m, t);
    Muzzle { trunnion: pose.to_world_point(l.trunnion), pos: pose.to_world_point(l.pos), dir: pose.to_world_dir(l.dir) }
}

#[cfg(test)]
mod tests {
    use super::*;

    const DT: f32 = 1.0 / 60.0;

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
        }
    }

    #[test]
    fn traverse_is_rate_limited_then_settles_on_target() {
        let g = gun();
        let mut s = TurretState::default();
        for _ in 0..60 {
            aim_step(&g, &mut s, PI / 2.0, 0.0, AimDrive::default(), DT);
        }
        assert!((s.yaw.to_degrees() - 20.0).abs() < 0.1, "{}", s.yaw.to_degrees());
        for _ in 0..240 {
            aim_step(&g, &mut s, PI / 2.0, 0.0, AimDrive::default(), DT);
        }
        assert!((s.yaw.to_degrees() - 90.0).abs() < 1e-3);
    }

    #[test]
    fn yaw_takes_the_shortest_way_across_180() {
        let g = gun();
        let mut s = TurretState { yaw: 170f32.to_radians(), pitch: 0.0 };
        let target = (-170f32).to_radians();
        for _ in 0..30 {
            aim_step(&g, &mut s, target, 0.0, AimDrive::default(), DT);
        }
        assert!((s.yaw.to_degrees().abs() - 180.0).abs() < 0.2, "{}", s.yaw.to_degrees());
        for _ in 0..60 {
            aim_step(&g, &mut s, target, 0.0, AimDrive::default(), DT);
        }
        assert!(wrap_pi(s.yaw - target).abs() < 1e-4);
    }

    #[test]
    fn pitch_respects_depression_and_elevation_limits() {
        let g = gun();
        let mut s = TurretState::default();
        for _ in 0..600 {
            aim_step(&g, &mut s, 0.0, -1.0, AimDrive::default(), DT);
        }
        assert!((s.pitch.to_degrees() + 8.0).abs() < 1e-3);
        for _ in 0..600 {
            aim_step(&g, &mut s, 0.0, 1.2, AimDrive::default(), DT);
        }
        assert!((s.pitch.to_degrees() - 20.0).abs() < 1e-3);
    }

    #[test]
    fn jammed_drives_do_not_move() {
        let g = gun();
        let mut s = TurretState::default();
        for _ in 0..60 {
            aim_step(&g, &mut s, 1.0, 0.1, AimDrive { traverse: 0.0, elevate: 0.0 }, DT);
        }
        assert_eq!(s, TurretState::default());
    }

    #[test]
    fn limited_arc_stops_at_its_edge_and_never_crosses_the_blocked_sector() {
        // rear turret: faces 180 deg, may swing 60 deg either way
        let facing = PI;
        let limit = Some(((-60f32).to_radians(), 60f32.to_radians()));
        let rate = 20f32.to_radians();
        let mut s = TurretState { yaw: facing, pitch: 0.0 };
        let mut reach = 0.0;
        for _ in 0..600 {
            reach = traverse_limited(&mut s, 0.4, facing, limit, rate, DT);
            // always inside the arc
            assert!(wrap_pi(s.yaw - facing).abs() <= 60f32.to_radians() + 1e-4);
        }
        // the target (0.4 rad, ahead-right) is outside the arc: the turret parks on the nearer edge
        assert!((wrap_pi(s.yaw - facing).abs() - 60f32.to_radians()).abs() < 1e-3, "{}", s.yaw.to_degrees());
        assert!(wrap_pi(reach - 0.4).abs() > 0.5);
        // a target inside the arc is reached
        let inside = 170f32.to_radians();
        for _ in 0..600 {
            reach = traverse_limited(&mut s, inside, facing, limit, rate, DT);
        }
        assert!(wrap_pi(s.yaw - inside).abs() < 1e-3 && wrap_pi(reach - inside).abs() < 1e-4);
        // unlimited turrets take the short way round like aim_step
        let mut u = TurretState { yaw: 170f32.to_radians(), pitch: 0.0 };
        for _ in 0..90 {
            traverse_limited(&mut u, (-170f32).to_radians(), 0.0, None, rate, DT);
        }
        assert!(wrap_pi(u.yaw - (-170f32).to_radians()).abs() < 1e-4);
    }

    #[test]
    fn elevate_matches_aim_step_limits() {
        let g = gun();
        let mut p = 0.0;
        for _ in 0..600 {
            elevate(&g, &mut p, 1.2, 1.0, DT);
        }
        assert!((p.to_degrees() - 20.0).abs() < 1e-3);
    }

    #[test]
    fn muzzle_follows_yaw_pitch_and_hull_pose() {
        let m = GunMount { pivot: Vec3::new(0.0, 1.1, 0.2), trunnion: Vec3::new(0.0, 1.6, 1.5), muzzle_offset_m: 3.6 };
        let near = |a: Vec3, b: Vec3| (a - b).length() < 1e-4;
        let a = muzzle_local(&m, &TurretState::default());
        assert!(near(a.pos, Vec3::new(0.0, 1.6, 5.1)) && near(a.dir, Vec3::new(0.0, 0.0, 1.0)));
        let b = muzzle_local(&m, &TurretState { yaw: PI / 2.0, pitch: 0.0 });
        assert!(near(b.pos, Vec3::new(4.9, 1.6, 0.2)) && near(b.dir, Vec3::new(1.0, 0.0, 0.0)), "{:?}", b);
        let c = muzzle_local(&m, &TurretState { yaw: 0.0, pitch: PI / 6.0 });
        assert!(near(c.pos, Vec3::new(0.0, 1.6 + 1.8, 1.5 + 3.6 * (PI / 6.0).cos())));
        let pose = HullPose { pos: Vec3::new(10.0, 0.0, 5.0), heading: PI / 2.0 };
        let w = muzzle_world(&pose, &m, &TurretState::default());
        assert!(near(w.pos, Vec3::new(15.1, 1.6, 5.0)) && near(w.dir, Vec3::new(1.0, 0.0, 0.0)), "{:?}", w);
    }
}
