//! Ammunition for a designed gun. Every round type follows from calibre and barrel length via
//! the same formulas as `tg_weapon::design` (De Marre for kinetic rounds), so a player can
//! only choose what to carry, never type in a penetration value.
use tg_weapon::design::{demarre_mm, gun_mass_kg, muzzle_velocity, shell_mass_kg, DEMARRE_K};
use tg_weapon::{CurvePoint, GunDef, ProjectileDef, ProjectileKind};

pub const SHELL_KINDS: [&str; 6] = ["ap", "apcbc", "aphe", "apcr", "heat", "he"];

struct Spec {
    kind: ProjectileKind,
    mass_k: f32,
    v_k: f32,
    k: f32,
    drag: f32,
    ricochet: f32,
    normalization: f32,
    shatter: f32,
    explosive_frac: f32,
    fuse: f32,
    label: &'static str,
}

fn spec(kind: &str) -> Option<Spec> {
    Some(match kind {
        "ap" => Spec { kind: ProjectileKind::Ap, mass_k: 1.0, v_k: 1.0, k: DEMARRE_K, drag: 0.4, ricochet: 68.0, normalization: 4.0, shatter: 90.0, explosive_frac: 0.0, fuse: 0.0, label: "AP" },
        "apcbc" => Spec { kind: ProjectileKind::Apcbc, mass_k: 1.08, v_k: 0.98, k: DEMARRE_K * 1.02, drag: 0.3, ricochet: 71.0, normalization: 7.0, shatter: 90.0, explosive_frac: 0.004, fuse: 0.0012, label: "APCBC" },
        "aphe" => Spec { kind: ProjectileKind::Aphe, mass_k: 1.0, v_k: 1.0, k: DEMARRE_K * 1.12, drag: 0.4, ricochet: 66.0, normalization: 4.0, shatter: 90.0, explosive_frac: 0.025, fuse: 0.0012, label: "APHE" },
        "apcr" => Spec { kind: ProjectileKind::Apcr, mass_k: 0.55, v_k: 1.28, k: DEMARRE_K * 0.78, drag: 0.55, ricochet: 64.0, normalization: 2.0, shatter: 62.0, explosive_frac: 0.0, fuse: 0.0, label: "APCR" },
        "heat" => Spec { kind: ProjectileKind::Heat, mass_k: 0.75, v_k: 0.62, k: 0.0, drag: 0.45, ricochet: 80.0, normalization: 0.0, shatter: 90.0, explosive_frac: 0.12, fuse: 0.0, label: "HEAT" },
        "he" => Spec { kind: ProjectileKind::He, mass_k: 0.95, v_k: 0.95, k: 0.0, drag: 0.42, ricochet: 79.0, normalization: 0.0, shatter: 90.0, explosive_frac: 0.1, fuse: 0.0, label: "HE" },
        _ => return None,
    })
}

/// HEAT needs room for a useful charge; HE and AP rounds work in any calibre.
pub fn kind_allowed(kind: &str, cal_mm: f32) -> bool {
    match kind {
        "heat" => cal_mm >= 57.0,
        "apcr" => cal_mm >= 28.0,
        _ => spec(kind).is_some(),
    }
}

/// Complete ProjectileDef for one round of a designed gun.
pub fn design_shell(kind: &str, cal_mm: f32, len_cal: f32) -> Option<ProjectileDef> {
    let s = spec(kind)?;
    let cal = cal_mm.round();
    let len = len_cal.round();
    let mass = shell_mass_kg(cal) * s.mass_k;
    let v0 = muzzle_velocity(len) * s.v_k;
    let area = std::f32::consts::PI * (cal * 0.0005).powi(2);
    let kk = 0.5 * 1.225 * s.drag * area / mass;
    let pen = |d: f32| -> f32 {
        match s.kind {
            ProjectileKind::Heat => cal * 1.45,
            ProjectileKind::He => (cal * 0.16).max(4.0),
            ProjectileKind::Apcr => {
                // tungsten core: about half the calibre carries the punch
                let core = cal * 0.5;
                demarre_mm(v0 * (-kk * d).exp(), mass * 0.45, core, s.k * 0.92) * 0.82
            }
            _ => demarre_mm(v0 * (-kk * d).exp(), mass, cal, s.k),
        }
    };
    let curve = [0.0f32, 100.0, 500.0, 1000.0, 1500.0, 2000.0, 2500.0]
        .iter()
        .map(|&d| CurvePoint { distance_m: d, pen_mm: (pen(d) * 10.0).round() / 10.0 })
        .collect();
    Some(ProjectileDef {
        id: format!("{}_design_{}_l{}", kind, cal, len),
        name: format!("{} mm {}（L/{}）", cal, s.label, len),
        kind: s.kind,
        caliber_mm: cal,
        mass_kg: (mass * 100.0).round() / 100.0,
        muzzle_velocity_ms: v0.round(),
        explosive_mass_kg: (mass * s.explosive_frac * 1000.0).round() / 1000.0,
        explosive_type: if s.explosive_frac > 0.0 { "tnt".into() } else { "none".into() },
        penetrator_material: if s.kind == ProjectileKind::Apcr { "tungsten".into() } else { "steel".into() },
        length_mm: (cal * 3.7).round(),
        drag_coefficient: s.drag,
        penetration_curve: curve,
        ricochet_angle_deg: s.ricochet,
        normalization_deg: s.normalization,
        shatter_angle_deg: s.shatter,
        fuse_delay_s: s.fuse,
        fuse_sensitivity_mm: if s.explosive_frac > 0.0 { (cal * 0.1).round() } else { 0.0 },
    })
}

/// GunDef for a designed gun (limits are filled in by the clearance analysis).
pub fn design_gun_def(cal_mm: f32, len_cal: f32, ammo: Vec<String>) -> GunDef {
    let (g, _) = tg_weapon::design::design_gun(cal_mm, len_cal);
    GunDef { id: format!("gun_design_{}_l{}", cal_mm.round(), len_cal.round()), mass_kg: gun_mass_kg(cal_mm.round(), len_cal.round()).round(), ammo, ..g }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rounds_trade_properties_against_each_other() {
        let ap = design_shell("ap", 75.0, 48.0).unwrap();
        let apcr = design_shell("apcr", 75.0, 48.0).unwrap();
        let heat = design_shell("heat", 75.0, 48.0).unwrap();
        let aphe = design_shell("aphe", 75.0, 48.0).unwrap();
        // tungsten core: more penetration up close, falls off faster
        assert!(apcr.pen_at(100.0) > ap.pen_at(100.0));
        assert!(apcr.pen_at(2000.0) / apcr.pen_at(100.0) < ap.pen_at(2000.0) / ap.pen_at(100.0));
        // shaped charge: flat with range, slow
        assert_eq!(heat.pen_at(0.0), heat.pen_at(2000.0));
        assert!(heat.muzzle_velocity_ms < ap.muzzle_velocity_ms);
        // explosive filler costs penetration
        assert!(aphe.pen_at(500.0) < ap.pen_at(500.0) && aphe.explosive_mass_kg > 0.0);
        assert!(!kind_allowed("heat", 37.0) && kind_allowed("heat", 75.0));
    }
}
