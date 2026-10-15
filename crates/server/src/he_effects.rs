//! Direct HE/HESH/HEAT hits detonate on the surface. Besides what `tg_combat::shoot` resolved for the hit,
//! the blast and fragments act on the vehicle from the contact point, and a charge that can blow
//! through the plate it struck also bursts inside. Same gameplay rules as the browser game
//! (`heContactEffects` in handoff/bundle/app.js.html, handoff/CHANGES.md); an estimate, not a
//! calibrated pressure model.
use tg_combat::{Outcome, Report, Shot, Target, TargetState};
use tg_shared::Vec3;
use tg_weapon::{ProjectileDef, ProjectileKind};

/// TNT equivalence (RE factor) of the filler types used by the projectile data: the RE table of
/// Wikipedia "TNT equivalent". Amatol (0.91-1.10 by ratio), explosive D (ammonium picrate, not
/// listed), A-IX-1 (96% RDX) and A-IX-2 (aluminised RDX, taken as hexal) are estimates.
pub fn re_factor(explosive_type: &str) -> f32 {
    match explosive_type {
        "petn" => 1.66,
        "hexogen" | "rdx" | "okfol" => 1.6,
        "comp_b" => 1.33,
        "explosive_d" => 0.95,
        "a_ix_1" => 1.54,
        "a_ix_2" => 1.35,
        _ => 1.0,
    }
}

/// The filler as TNT (kg); zero for none or invalid data.
pub fn tnt_kg(shell: &ProjectileDef) -> f32 {
    let kg = shell.explosive_mass_kg;
    if kg.is_finite() && kg > 0.0 { kg * re_factor(&shell.explosive_type) } else { 0.0 }
}

/// Plate a charge in contact can blow through (mm): the combat core's own estimate.
pub fn breach_mm(tnt: f32) -> f32 {
    13.1 * tnt.powf(0.673)
}

fn merge(into: &mut Report, add: Report) {
    let was = into.caps.destroyed;
    into.state = add.state;
    into.caps = add.caps;
    into.crew.extend(add.crew);
    into.modules.extend(add.modules);
    into.events.extend(add.events);
    into.fragments.extend(add.fragments);
    into.bursts.extend(add.bursts);
    into.cause_transitions.extend(add.cause_transitions);
    if into.caps.destroyed && !was {
        into.title = add.title;
    }
}

fn burst(t: &Target, r: &mut Report, at: Vec3, kg: f32, yaw: f32, seed: u64) {
    if r.caps.destroyed || !(kg > 0.0) {
        return;
    }
    let add = tg_combat::splash(t, &r.state, at, kg, yaw, seed);
    merge(r, add);
}

/// The plate struck; a hit on the running gear or another non-plate part bursts against the nearest
/// hull armour, taken as the thinnest plate within 1.5 m.
fn nearest_plate_mm(t: &Target, r: &Report, at: Vec3) -> Option<f32> {
    r.layers.first().map(|l| l.thickness_mm).filter(|t| t.is_finite()).or_else(|| {
        t.def.plates.iter().filter(|p| p.thickness_mm > 0.0 && (p.center - at).length() <= 1.5).map(|p| p.thickness_mm).reduce(f32::min)
    })
}

/// The hit report with the contact detonation's damage merged in (unchanged for other rounds).
/// `before`: the target state the hit was resolved from.
pub fn contact(t: &Target, before: &TargetState, shot: &Shot, mut r: Report) -> Report {
    // HEAT too: the core resolves the jet; the warhead's blast and casing fragments still act.
    if !matches!(shot.shell.kind, ProjectileKind::He | ProjectileKind::Hesh | ProjectileKind::Heat | ProjectileKind::HeatFs) || r.caps.destroyed {
        return r;
    }
    let tnt = tnt_kg(&shot.shell);
    let Some(at) = r.impact else { return r };
    if !(tnt > 0.0) {
        return r;
    }
    // HEAT: only against thin skins (the charge blows through the plate struck); on armour its blast
    // stays outside and the core's jet is the whole effect, as before.
    let heat = matches!(shot.shell.kind, ProjectileKind::Heat | ProjectileKind::HeatFs);
    if heat && !nearest_plate_mm(t, &r, at).is_some_and(|mm| breach_mm(tnt) >= mm) {
        return r;
    }
    let dir = shot.dir.normalized();
    let mut n = r.normal.unwrap_or(-dir);
    if n.dot(dir) > 0.0 {
        n = -n;
    }
    let (yaw, seed) = (shot.turret_yaw, shot.seed ^ 0x9e37_79b9);
    // The core rates an HE breach from the round's listed penetration (well below what its charge
    // blows through, e.g. 122 mm OF-471 ~25 mm vs 31 mm): when the TNT charge breaches the plate it
    // struck and the core did not, resolve the same hit with the charge's own rating, so the core's
    // internal blast and spall apply (one detonation, from the state before the hit).
    if let Some(first) = r.layers.first() {
        if r.outcome != Outcome::Overpressure && first.thickness_mm.is_finite() && breach_mm(tnt) >= first.thickness_mm {
            let mut charge = shot.clone();
            charge.shell.explosive_mass_kg = tnt;
            charge.shell.penetration_curve.clear();
            let again = tg_combat::shoot(t, before, &charge);
            if again.outcome == Outcome::Overpressure {
                r = again;
            }
        }
    }
    burst(t, &mut r, at + n * 0.15, tnt, yaw, seed.wrapping_add(1));
    let plate = nearest_plate_mm(t, &r, at);
    if r.outcome != Outcome::Overpressure && plate.is_some_and(|mm| breach_mm(tnt) >= mm) {
        // Blown through: the blast and plate fragments vent into the compartment, between the hole
        // and the hull centreline. The core's internal blast grows only weakly with charge, so a
        // large charge's lethal volume (radius ~ cube root of the charge) covers the crew stations in it.
        let hole = at - n * 0.2;
        let inner = Vec3::new(hole.x * 0.45, hole.y, hole.z * 0.7);
        let inside = tnt * 0.6;
        burst(t, &mut r, inner, inside, yaw, seed.wrapping_add(2));
        let lethal = 0.6 + 0.9 * inside.cbrt();
        let stations: Vec<Vec3> = t.def.crew.iter().map(|c| c.pos).filter(|p| (*p - inner).length() <= lethal).take(5).collect();
        for (k, p) in stations.into_iter().enumerate() {
            burst(t, &mut r, p, inside * 0.5, yaw, seed.wrapping_add(3 + k as u64));
        }
    }
    r
}

#[cfg(test)]
mod tests {
    use super::*;

    fn side_hit(t: &Target, shell: &ProjectileDef, seed: u64) -> Shot {
        let at = Vec3::new(0.0, 1.0, 0.0);
        let origin = Vec3::new(t.hi.x + 20.0, 1.2, 0.3);
        Shot { shell: shell.clone(), origin, dir: (at - origin).normalized(), speed_ms: 600.0, distance_m: 300.0, seed, turret_yaw: 0.0 }
    }

    /// Direct HE hits on a light tank and an armoured car: the contact detonation never weakens a
    /// hit, and large shells knock both out (they did not before: user report 2026-10-15).
    #[test]
    fn heavy_he_direct_hits_knock_out_light_vehicles() {
        let data = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data");
        let c = crate::server::load_combat(&data);
        for (vehicle, shell, min_kills) in [("de_pz3_j", "he_122_of471", 7), ("us_m8", "he_122_of471", 7), ("us_m8", "he_88_sprgr", 5), ("us_m8", "heat_152_tow", 7)] {
            let (t, s) = (&c.targets[vehicle], &c.projectiles[shell]);
            let (mut before, mut after) = (0, 0);
            for seed in 1..=10u64 {
                let shot = side_hit(t, s, seed);
                let r = tg_combat::shoot(t, &t.fresh_state(), &shot);
                before += r.caps.destroyed as u32;
                let lost_before = r.caps.crew_total - r.caps.crew_alive;
                let r = contact(t, &t.fresh_state(), &shot, r);
                assert!(r.caps.crew_total - r.caps.crew_alive >= lost_before, "{vehicle} {shell}: contact burst healed crew");
                after += r.caps.destroyed as u32;
            }
            println!("{vehicle} {shell}: destroyed {before}/10 -> {after}/10");
            assert!(after >= before && after >= min_kills, "{vehicle} {shell}: {before}/10 -> {after}/10");
        }
    }

    #[test]
    fn small_he_and_kinetic_rounds_are_unchanged() {
        let data = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data");
        let c = crate::server::load_combat(&data);
        let t = &c.targets["de_tiger_e"];
        for shell in ["apcbc_88_l56", "he_37_m63"] {
            let shot = side_hit(t, &c.projectiles[shell], 3);
            let r = tg_combat::shoot(t, &t.fresh_state(), &shot);
            let crew = r.caps.crew_alive;
            let r = contact(t, &t.fresh_state(), &shot, r);
            if shell.starts_with("ap") { assert_eq!(r.caps.crew_alive, crew); }
            assert!(!r.caps.destroyed || shell.starts_with("ap"), "{shell} destroyed a Tiger");
        }
        assert!((tnt_kg(&c.projectiles["he_88_sprgr"]) - c.projectiles["he_88_sprgr"].explosive_mass_kg * re_factor(&c.projectiles["he_88_sprgr"].explosive_type)).abs() < 1e-6);
    }
}
