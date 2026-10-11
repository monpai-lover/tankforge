use super::impact::*;
use tg_shared::Vec3;
use tg_weapon::ProjectileDef;

fn state() -> ImpactState {
    let mut p = ProjectileDef::generic_ap(10.0, 150.0);
    p.mass_kg = 0.1;
    initialize_impact(&p, Vec3::new(0.0, 0.0, 100.0), 150.0, "core").unwrap()
}
fn contact(layer: &str, traversal: u32, required: f64) -> DeclaredLayerContact {
    DeclaredLayerContact {
        layer_id: layer.into(),
        traversal_id: traversal,
        cumulative_required_mm: required,
        cumulative_path_m: required * 0.001,
        thickness_mm: 100.0,
        density_kg_m3: 7850.0,
        verdict: ImpactVerdict::Passed,
        emit_spall: true,
    }
}
#[test]
fn one_traversal_is_subdivision_and_duplicate_safe() {
    let mut whole = state();
    let mut split = state();
    let whole_mass = advance_kinetic_layer(&mut whole, &contact("plate", 0, 100.0))
        .unwrap()
        .allocations[0]
        .mass_kg;
    let mut split_mass = 0.0;
    for n in [25.0, 50.0, 50.0, 100.0] {
        let tr = advance_kinetic_layer(&mut split, &contact("plate", 0, n)).unwrap();
        tr.budget.validate().unwrap();
        split_mass += tr.allocations.iter().map(|a| a.mass_kg).sum::<f64>();
    }
    assert!((whole.energy_j() - 500.0 * 5.0 / 9.0).abs() < 1e-4);
    assert!((whole.energy_j() - split.energy_j()).abs() < 1e-4);
    assert_eq!(whole.remaining_pen_mm, split.remaining_pen_mm);
    assert!((whole_mass - split_mass).abs() < 1e-10);
    let mut two = state();
    advance_kinetic_layer(&mut two, &contact("first", 0, 50.0)).unwrap();
    advance_kinetic_layer(&mut two, &contact("second", 0, 50.0)).unwrap();
    assert!((two.energy_j() - 500.0 * 2.0 / 3.0).abs() < 1e-4);
    let e = two.energy_j();
    advance_kinetic_layer(&mut two, &contact("second", 1, 25.0)).unwrap();
    assert!(two.energy_j() < e, "true re-entry performs fresh work");
}
#[test]
fn plate_spall_is_a_finite_allocation_of_work() {
    let mut s = state();
    let t = advance_kinetic_layer(&mut s, &contact("plate", 0, 50.0)).unwrap();
    assert!((t.budget.armour_debris_j - (500.0 / 9.0) * 0.3).abs() < 1e-6);
    assert!(t.allocations[0].mass_kg <= 7850.0 * 0.1 * std::f64::consts::PI * 0.005f64.powi(2));
    t.budget.validate().unwrap();
    assert!(t
        .allocations
        .iter()
        .all(|a| a.source == FragmentSource::ArmourSpall));
}
#[test]
fn invalid_updates_and_charge_transfer_are_atomic() {
    let mut s = state();
    let before = s.clone();
    assert!(advance_kinetic_layer(&mut s, &contact("plate", 0, f64::NAN)).is_err());
    assert_eq!(s, before);
    advance_kinetic_layer(&mut s, &contact("plate", 0, 25.0)).unwrap();
    s.traversal.as_mut().unwrap().cumulative_work_j = f64::NAN;
    let invalid = s.clone();
    assert!(advance_kinetic_layer(&mut s, &contact("plate", 0, 50.0)).is_err());
    assert!(s.traversal.as_ref().unwrap().cumulative_work_j.is_nan());
    assert_eq!(s.current, invalid.current);
    s = before.clone();
    let p = ProjectileDef::generic_ap(10.0, 150.0);
    assert!(initialize_impact(&p, Vec3::new(f32::INFINITY, 0.0, 0.0), 150.0, "core").is_err());
    assert!(transfer_projectile_piece(
        &mut s,
        "piece",
        ComponentReservoirs {
            unallocated_kg: 0.2,
            ..Default::default()
        },
        1.0,
        false
    )
    .is_err());
    assert_eq!(s, before);
    let mut aphe = p;
    aphe.mass_kg = 0.1;
    aphe.explosive_mass_kg = 0.01;
    let mut charge = initialize_impact(&aphe, Vec3::new(0.0, 0.0, 100.0), 150.0, "body").unwrap();
    let piece = transfer_projectile_piece(
        &mut charge,
        "piece",
        ComponentReservoirs {
            filler_kg: aphe.explosive_mass_kg as f64,
            unallocated_kg: 0.02,
            ..Default::default()
        },
        20.0,
        true,
    )
    .unwrap();
    assert!(charge.charge.is_none());
    piece.transition.budget.validate().unwrap();
    assert_eq!(piece.piece.charge.unwrap().owner_id, "piece");
    assert!(transfer_projectile_piece(
        &mut charge,
        "duplicate",
        ComponentReservoirs::default(),
        0.0,
        true
    )
    .is_err());
    assert!(charge.mass_kg < 0.1);
}

#[test]
fn active_single_and_stack_progress_keep_one_fixed_physical_layer() {
    use crate::stack::{
        resolve_stack_with_progress, LayerIdentity, PlateCrossing, StackParams,
        StackTraversalProgress,
    };
    use crate::{resolve_with_state, resolve_with_state_progress, ImpactContext, LayerProgress};
    use tg_armor::{ArmorKind, ArmorPlate, ArmorZone, Material};
    let mut shell = ProjectileDef::generic_ap(75.0, 150.0);
    shell.mass_kg = 0.1;
    shell.normalization_deg = 0.0;
    let material = Material {
        id: "rha".into(),
        kind: ArmorKind::Rha,
        density_kg_m3: 7850.0,
        hardness_bhn: 300.0,
        kinetic_factor: 1.0,
        chemical_factor: 1.0,
    };
    let plate = ArmorPlate {
        id: "fixed".into(),
        zone: ArmorZone::HullSide,
        material: "rha".into(),
        thickness_mm: 100.0,
        center: Vec3::ZERO,
        normal: Vec3::new(0.0, 0.0, -1.0),
        axis_u: Vec3::new(1.0, 0.0, 0.0),
        half_u: 1.0,
        half_v: 1.0,
        curvature: 0.0,
        polygon: vec![],
        hinge: None,
    };
    let initial = initialize_impact(&shell, Vec3::new(0.0, 0.0, 100.0), 150.0, "core").unwrap();
    let mut full = initial.clone();
    let ctx = ImpactContext {
        incidence_deg: 0.0,
        distance_m: 0.0,
    };
    let (_, whole) =
        resolve_with_state(&shell, &plate, &material, ctx, &mut full, "fixed", 0).unwrap();
    assert!((whole.output.elapsed_s - 0.001).abs() < 1e-10);
    let mut partial = initial.clone();
    let mut mass = 0.0;
    let mut energy = 0.0;
    for required in [25.0, 50.0, 50.0, 100.0] {
        let (_, tr) = resolve_with_state_progress(
            &shell,
            &plate,
            &material,
            ctx,
            &mut partial,
            &LayerProgress {
                layer_id: "fixed",
                traversal_id: 0,
                cumulative_required_mm: required,
            },
        )
        .unwrap();
        mass += tr.allocations.iter().map(|a| a.mass_kg).sum::<f64>();
        energy += tr.budget.armour_debris_j;
    }
    assert!((full.energy_j() - partial.energy_j()).abs() < 1e-3);
    assert_eq!(full.remaining_pen_mm, partial.remaining_pen_mm);
    assert!((mass - whole.allocations[0].mass_kg).abs() < 1e-10);
    assert!((energy - whole.budget.armour_debris_j).abs() < 1e-4);
    assert_eq!(partial.elapsed_s, full.elapsed_s);
    let plates: Vec<_> = (0..4)
        .map(|i| PlateCrossing {
            material: &material,
            thickness_mm: 100.0,
            path_mm: 100.0,
            incidence_deg: 0.0,
            gap_before_mm: if i == 0 { 0.0 } else { 150.0 },
        })
        .collect();
    let progress: Vec<_> = [25.0, 50.0, 50.0, 100.0]
        .iter()
        .map(|required| StackTraversalProgress {
            identity: LayerIdentity {
                layer_id: "fixed".into(),
                traversal_id: 0,
            },
            cumulative_required_mm: *required,
        })
        .collect();
    let mut stack = initial;
    let report = resolve_stack_with_progress(
        &shell,
        &plates,
        &StackParams::default(),
        &mut stack,
        &progress,
    )
    .unwrap();
    assert!((stack.energy_j() - full.energy_j()).abs() < 1e-3);
    assert_eq!(report.total_required_mm, 100.0);
    assert_eq!(report.impacts[2].budget.armour_debris_j, 0.0);
    assert_eq!(
        stack.elapsed_s, full.elapsed_s,
        "duplicate progress must not charge transit or its supplied gap again"
    );
    assert_eq!(
        report.impacts[2].entry.elapsed_s,
        report.impacts[2].output.elapsed_s
    );
    let before = stack.clone();
    let bad = [StackTraversalProgress {
        identity: LayerIdentity {
            layer_id: "fixed".into(),
            traversal_id: 0,
        },
        cumulative_required_mm: 50.0,
    }];
    assert!(resolve_stack_with_progress(
        &shell,
        &plates[..1],
        &StackParams::default(),
        &mut stack,
        &bad
    )
    .is_err());
    assert_eq!(stack, before);
    // A duplicate boundary at exactly exhausted residual speed is still the
    // same accepted traversal; it cannot become a fresh zero-energy impact.
    let mut exact_plate = plate.clone();
    exact_plate.thickness_mm = 150.0;
    let mut exact = initialize_impact(&shell, Vec3::new(0.0, 0.0, 100.0), 150.0, "core").unwrap();
    let (_, first) =
        resolve_with_state(&shell, &exact_plate, &material, ctx, &mut exact, "exact", 0).unwrap();
    let (_, duplicate) =
        resolve_with_state(&shell, &exact_plate, &material, ctx, &mut exact, "exact", 0).unwrap();
    assert_eq!(first.verdict, ImpactVerdict::Passed);
    assert!((first.output.elapsed_s - 0.0015).abs() < 1e-10);
    assert_eq!(duplicate.verdict, ImpactVerdict::Passed);
    assert_eq!(duplicate.budget.input_j, 0.0);
    assert!(duplicate.allocations.is_empty());
    assert_eq!(exact.remaining_pen_mm, 0.0);
    assert_eq!(duplicate.output.elapsed_s, first.output.elapsed_s);
    for value in [f32::NAN, -1.0] {
        for field in 0..3 {
            let mut invalid_plate = plate.clone();
            let mut invalid_material = material.clone();
            match field {
                0 => invalid_plate.thickness_mm = value,
                1 => invalid_material.kinetic_factor = value,
                _ => invalid_material.density_kg_m3 = value,
            };
            let mut state = full.clone();
            let before = state.clone();
            assert!(resolve_with_state_progress(
                &shell,
                &invalid_plate,
                &invalid_material,
                ctx,
                &mut state,
                &LayerProgress {
                    layer_id: "fixed",
                    traversal_id: 0,
                    cumulative_required_mm: 100.0
                }
            )
            .is_err());
            assert_eq!(state, before);
            let crossing = PlateCrossing {
                material: &invalid_material,
                thickness_mm: invalid_plate.thickness_mm,
                path_mm: 100.0,
                incidence_deg: 0.0,
                gap_before_mm: 0.0,
            };
            let progress = [StackTraversalProgress {
                identity: LayerIdentity {
                    layer_id: "fixed".into(),
                    traversal_id: 0,
                },
                cumulative_required_mm: 100.0,
            }];
            assert!(resolve_stack_with_progress(
                &shell,
                &[crossing],
                &StackParams::default(),
                &mut state,
                &progress
            )
            .is_err());
            assert_eq!(state, before);
        }
    }
}

#[test]
fn subcal_mass_is_estimated_and_core_dimensions_remain_unknown() {
    use tg_weapon::ProjectileKind;
    for (kind, fraction) in [(ProjectileKind::Apcr, 0.35), (ProjectileKind::Apds, 0.6)] {
        let mut shell = ProjectileDef::generic_ap(75.0, 150.0);
        shell.kind = kind;
        shell.mass_kg = 1.0;
        let state = initialize_impact(&shell, Vec3::new(0.0, 0.0, 100.0), 150.0, "core").unwrap();
        assert!((state.admitted_mass_kg - fraction).abs() < 1e-10);
        assert_eq!(state.profile.source, ProfileSource::Estimated);
        assert_eq!(state.geometry_profile.source, ProfileSource::Unknown);
        assert!(state.effective_diameter_m.is_none());
        assert!(state.remaining_length_m.is_none());
        assert_eq!(state.components.casing_kg, 0.0);
        assert_eq!(state.components.total_kg(), state.mass_kg);
    }
}
