//! Raw filler owns physical mass; TNT equivalence owns explosive response.
use super::*;

fn actual_agm45() -> ProjectileDef {
    let data = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data/aircraft/frontline.json");
    let source: serde_json::Value = serde_json::from_slice(&std::fs::read(data).unwrap()).unwrap();
    serde_json::from_value(source["shells"]["he_agm45"].clone()).unwrap()
}

#[test]
fn comp_b_actual_agm_direct_uses_tnt_equivalent_response_without_inflating_filler_mass() {
    let target = near_burst_wall(96., None);
    let charge = actual_agm45();
    assert_eq!(charge.explosive_type, "comp_b");
    assert_eq!(charge.explosive_mass_kg, 22.);
    let shot = Shot { shell: charge.clone(), origin: Vec3::new(-4.,1.,0.),
        dir: Vec3::new(1.,0.,0.), speed_ms: 300., distance_m: 500., seed: 3, turret_yaw: 0. };
    let report = shoot(&target, &target.fresh_state(), &shot);
    assert_eq!(report.outcome, Outcome::Overpressure,
        "the real 22kg Composition B charge must use its existing 1.33 RE factor at the HE breach boundary");
    assert!(report.state.crew[0] < 100.);
    assert_eq!(report.bursts.len(), 1);
    assert!((report.bursts[0].explosive_kg - 22. * 0.8).abs() < 1e-5,
        "the receipt retains the actual admitted filler portion");
    assert!((report.bursts[0].radius - blast_radius_m(22. * 1.33 * 0.8)).abs() < 1e-5);
}

#[test]
fn comp_b_near_burst_uses_tnt_equivalent_radius_and_raw_casing_mass_in_both_geometry_routes() {
    let target = near_burst_wall(250., None);
    let charge = actual_agm45();
    let (registered_target, scene) = surface_combat_fixture();
    for (target, scene) in [(&target, None), (&registered_target, Some(&scene))] {
        let report = near_burst::evaluate(target, &target.fresh_state(), Vec3::new(0.,0.,-0.1),
            &charge, 0., 3, None, scene).unwrap();
        assert_eq!(report.bursts.len(), 1);
        assert_eq!(report.bursts[0].explosive_kg, 22.);
        assert!((report.bursts[0].radius - outside_radius_m(22. * 1.33)).abs() < 1e-6,
            "legacy and registered near bursts must use the same admitted explosive equivalence");
        let mut samples = std::collections::BTreeMap::new();
        for fragment in &report.fragments {
            if fragment.provenance.source == impact::FragmentSource::CasingFragment {
                let physical = fragment.provenance.physical.as_ref().unwrap();
                samples.entry(fragment.provenance.fragment_id.clone())
                    .or_insert(physical.mass_kg * fragment.provenance.weight);
            }
        }
        assert!(!samples.is_empty());
        assert!(samples.values().sum::<f64>() <= f64::from(charge.mass_kg - charge.explosive_mass_kg) + 1e-5,
            "TNT equivalence cannot subtract extra physical filler from the casing");
    }
}

#[test]
fn unknown_pbxn_is_not_guessed_and_large_external_charge_does_not_bypass_sealed_heavy_armor() {
    let target = near_burst_wall(250., None);
    let mut charge = actual_agm45();
    charge.explosive_type = "pbxn".into();
    let at = Vec3::new(-1.,1.,0.);
    let report = near_burst::evaluate(&target, &target.fresh_state(), at, &charge, 0., 3, None, None).unwrap();
    assert_eq!(report.bursts[0].radius, outside_radius_m(charge.explosive_mass_kg));
    assert_eq!(report.state.crew, target.fresh_state().crew);
    charge.explosive_type = "comp_b".into();
    let report = near_burst::evaluate(&target, &target.fresh_state(), at, &charge, 0., 3, None, None).unwrap();
    assert_eq!(report.state.crew, target.fresh_state().crew,
        "a larger external equivalent charge still needs a real penetration or open air path");
}
