use super::*;
use crate::geometry::combat_scene::damage_registration_checks_for_test;

#[test]
fn small_he_exposure_does_not_transform_anatomy_outside_its_finite_radius() {
    let (_, scene) = instance_gear_fixture(|_| {}).unwrap();
    for (x, owner) in [(-2., 0), (2., 1)] {
        let before = geometry::surface_triangle_visits_for_test();
        let exposed = scene.exposed_anatomy(Vec3::new(x, 0., -0.1), 1.).unwrap();
        assert_eq!(exposed.len(), 1);
        assert_eq!(exposed[0].0, EvKind::Module(owner));
        assert_eq!(geometry::surface_triangle_visits_for_test() - before, 1,
            "the opposite actual shoe is beyond this finite blast sphere and cannot be an exposure candidate");
    }
}

#[test]
fn surface_impact_burst_checks_registration_once_for_each_real_round() {
    let (target, scene) = surface_combat_fixture();
    let mut state = target.fresh_state();
    for (kind, caliber, charge) in [(ProjectileKind::Ap, 7.92, 0.), (ProjectileKind::He, 20., 0.0108), (ProjectileKind::Ap, 75., 0.)] {
        for i in 0..16 {
            let x = if i % 4 == 0 { 0. } else { 0.5 };
            let mut shot = surface_shot(x);
            shot.shell = shell(kind, caliber, 0.102, 150., charge);
            let before = damage_registration_checks_for_test();
            let report = shoot_surface_impact(&target, &state, &shot, &scene, Vec3::new(x, 0., 1.), None).unwrap();
            assert_eq!(damage_registration_checks_for_test() - before, 1,
                "the finite incoming owner and internal continuation share one synchronous registration proof; every round still checks current anatomy");
            assert_eq!(report.hit, x != 0., "the real aperture stays open for every caliber");
            state = report.state;
        }
    }
}

#[test]
fn surface_impact_registration_proof_expires_between_rounds_and_targets() {
    let (mut target, scene) = surface_combat_fixture();
    let shot = surface_shot(0.5);
    assert!(shoot_surface_impact(&target, &target.fresh_state(), &shot, &scene, Vec3::new(0.5, 0., 1.), None).unwrap().hit);
    target.def.modules[0].max_health *= 2.;
    assert!(shoot_surface_impact(&target, &target.fresh_state(), &shot, &scene, Vec3::new(0.5, 0., 1.), None).is_err(),
        "a new round must reject in-place anatomy mutation");
    let (other, other_scene) = instance_gear_fixture(|_| {}).unwrap();
    assert!(shoot_surface_impact(&other, &other.fresh_state(), &shot, &scene, Vec3::new(0.5, 0., 1.), None).is_err());
    let round = surface_shot(-2.);
    assert!(shoot_surface_impact(&other, &other.fresh_state(), &round, &other_scene, Vec3::new(-2., 0., 1.), None).unwrap().hit);
}
