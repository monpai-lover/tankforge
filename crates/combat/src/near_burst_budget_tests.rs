use super::*;
use std::collections::{BTreeMap, BTreeSet};

fn samples(report: &Report) -> BTreeMap<String, &Frag> {
    let mut out = BTreeMap::new();
    for fragment in &report.fragments {
        if fragment.provenance.source == impact::FragmentSource::CasingFragment {
            out.entry(fragment.provenance.fragment_id.clone()).or_insert(fragment);
        }
    }
    out
}

#[test]
fn small_he_registered_casing_budget_keeps_sixteen_individual_physical_samples() {
    let (target, scene) = surface_combat_fixture();
    let at = Vec3::new(0., 0., -0.1);
    for caliber in [20., 35., 40., 40.001, 152., 420.] {
        let charge = shell(ProjectileKind::He, caliber, 0.55, 1175., 0.112);
        let report = near_burst::evaluate_casing(&target, &target.fresh_state(), at,
            &charge, 0., 4, None, Some(&scene)).unwrap();
        let by_id = samples(&report);
        let per_bin = if caliber <= 40. { 4 } else { 32 };
        assert_eq!(by_id.len(), per_bin * 4, "caliber {caliber}: the small-HE cost budget must bound representative rays, not bypass registered geometry");
        assert!(!report.geometry_contacts.is_empty(), "the registered scene must still own actual fragment contacts");
        assert!(report.bursts.is_empty(), "casing-only evaluation never repeats the primary blast");
        let scale = ((caliber as f64 / 420.).powi(2)).clamp(0.02, 1.);
        let casing = (charge.mass_kg - charge.explosive_mass_kg) as f64;
        let velocity = (2400. * ((charge.explosive_mass_kg as f64 / casing)
            / (1. + 0.5 * charge.explosive_mass_kg as f64 / casing)).sqrt()) as f32;
        let mut represented_mass = 0.;
        for (bin, (mass, share)) in [(0.002, 0.20), (0.01, 0.45), (0.05, 0.30), (0.2, 0.05)].into_iter().enumerate() {
            let expected_mass = (mass * scale).min(casing * share);
            for ordinal in bin * per_bin..(bin + 1) * per_bin {
                let fragment = by_id.values().find(|fragment| fragment.provenance.fragment_id.ends_with(&format!("/casing:{ordinal}"))).unwrap();
                let physical = fragment.provenance.physical.as_ref().unwrap();
                physical.validate().unwrap();
                assert!((physical.mass_kg - expected_mass).abs() < 1e-10, "sample count must not enlarge a physical piece");
                assert!((fragment.provenance.weight - casing * share / (expected_mass * per_bin as f64)).abs() < 1e-8,
                    "multiplicity alone compensates the numerical sample count");
                let expected_area = std::f64::consts::PI * (3. * expected_mass / (4. * std::f64::consts::PI * 7850.)).cbrt().powi(2);
                assert!((physical.area_m2.unwrap() - expected_area).abs() < 1e-12, "drag still uses one piece's area/mass");
                if (fragment.from - at).length() < 1e-6 {
                    let expected_energy = 0.5 * expected_mass * (velocity as f64).powi(2);
                    // ImpactSnapshot recomputes energy from three f32 velocity
                    // components. Match the production physical-energy contract
                    // instead of an absolute tolerance that shrinks with energy.
                    assert!((physical.energy_j - expected_energy).abs() <= 1e-5 * expected_energy.max(1.),
                        "caliber {caliber}, sample {ordinal}: launch energy cannot contain representative multiplicity: actual {} expected {expected_energy}, delta {}", physical.energy_j, physical.energy_j - expected_energy);
                }
                represented_mass += physical.mass_kg * fragment.provenance.weight;
            }
        }
        assert!((represented_mass - casing).abs() < 1e-6, "all four mass-bin shares are retained");
    }
}

#[test]
fn small_he_registered_samples_remain_seeded_and_respect_real_aperture_and_wall() {
    let (target, scene) = surface_combat_fixture();
    let charge = shell(ProjectileKind::He, 35., 0.55, 1175., 0.112);
    let at = Vec3::new(0., 0., -0.1);
    let mut real_contacts = BTreeSet::new();
    let mut paths = BTreeSet::new();
    let mut aperture_hit = false;
    let (blocked_target, blocked_scene) = surface_combat_fixture_engine_at(0.025);
    for seed in 1..=64 {
        let a = near_burst::evaluate_casing(&target, &target.fresh_state(), at,
            &charge, 0., seed, None, Some(&scene)).unwrap();
        let b = near_burst::evaluate_casing(&target, &target.fresh_state(), at,
            &charge, 0., seed, None, Some(&scene)).unwrap();
        assert_eq!(serde_json::to_value(&a).unwrap(), serde_json::to_value(&b).unwrap(), "same seed owns the same physical samples");
        assert_eq!(samples(&a).len(), 16);
        paths.insert(serde_json::to_string(&a.fragments.iter().map(|f| f.to).collect::<Vec<_>>()).unwrap());
        for c in &a.geometry_contacts { if let Some(surface) = c["surfaceId"].as_str() { real_contacts.insert(surface.to_owned()); } }
        aperture_hit |= a.fragments.iter().any(|f| f.hit.as_deref() == Some("engine"));
        let blocked = near_burst::evaluate_casing(&blocked_target, &blocked_target.fresh_state(),
            Vec3::new(0.5, 0., -0.1), &charge, 0., seed, None, Some(&blocked_scene)).unwrap();
        assert_eq!(blocked.state.modules, blocked_target.fresh_state().modules,
            "an actual module inside the paired wall cannot rewind the physical fragment cursor");
    }
    assert!(paths.len() > 1, "sample count must not turn seeded directions into a fixed empty cone");
    assert!(!real_contacts.is_empty(), "coverage controls include actual registered wall contacts");
    assert!(aperture_hit, "seed changes must retain positive small-fragment coverage through the real modeled aperture");
}

#[test]
fn small_he_registered_budget_preserves_other_explosive_families() {
    let (target, scene) = surface_combat_fixture();
    for kind in [ProjectileKind::Aphe, ProjectileKind::Hesh, ProjectileKind::Heat, ProjectileKind::HeatFs] {
        let charge = shell(kind, 35., 0.55, 1175., 0.112);
        let report = near_burst::evaluate_casing(&target, &target.fresh_state(),
            Vec3::new(0., 0., -0.1), &charge, 0., 4, None, Some(&scene)).unwrap();
        assert_eq!(samples(&report).len(), 128, "the autocannon HE budget must not silently change other charge families");
    }
}
