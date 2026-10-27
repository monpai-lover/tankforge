use super::*;
use tg_armor::{ArmorKind, ArmorZone};
use tg_penetration::stack::{resolve_stack_with_state, LayerIdentity, PlateCrossing, StackParams};

fn material() -> Material {
    Material {
        id: "rha".into(),
        kind: ArmorKind::Rha,
        density_kg_m3: 7850.0,
        hardness_bhn: 300.0,
        kinetic_factor: 1.0,
        chemical_factor: 1.0,
    }
}
fn shell() -> ProjectileDef {
    let mut p = ProjectileDef::generic_ap(10.0, 150.0);
    p.mass_kg = 0.1;
    p.muzzle_velocity_ms = 100.0;
    p.normalization_deg = 0.0;
    p.drag_coefficient = 0.0;
    p
}
fn plate(id: &str, z: f32) -> ArmorPlate {
    ArmorPlate {
        id: id.into(),
        zone: ArmorZone::HullSide,
        material: "rha".into(),
        thickness_mm: 50.0,
        center: Vec3::new(0.0, 1.0, z),
        normal: Vec3::new(0.0, 0.0, -1.0),
        axis_u: Vec3::new(1.0, 0.0, 0.0),
        half_u: 1.0,
        half_v: 1.0,
        curvature: 0.0,
        polygon: vec![],
        hinge: None,
    }
}
fn event() -> ShotEvent {
    ShotEvent {
        shot_id: 1,
        tick: 0,
        seed: 1,
        shooter_id: 1,
        target_id: 2,
        projectile_type: "generic_ap".into(),
        muzzle_position: Vec3::new(0.0, 1.0, -2.0),
        impact_position: Vec3::ZERO,
        impact_normal: Vec3::ZERO,
        armor_plate: String::new(),
        armor_thickness_mm: 0.0,
        impact_angle_deg: 0.0,
        effective_thickness_mm: 0.0,
        penetration_value_mm: 150.0,
        penetration_result: PenetrationOutcome::Miss,
        projectile_path: vec![],
        fragments: vec![],
        damaged_modules: vec![],
        damaged_crew: vec![],
        outcomes: vec![],
        mechanism_revision: None,
        impact_events: vec![],
        impact_state: None,
    }
}
fn design() -> tg_design::VehicleDesign {
    let vertices: Vec<_> = (0..8)
        .map(|i| {
            vec![
                if i & 1 == 1 { 1.0 } else { -1.0 },
                if i & 2 == 2 { 2.0 } else { 0.0 },
                if i & 4 == 4 { 2.0 } else { -1.0 },
            ]
        })
        .collect();
    let faces: Vec<_> = [
        [4, 5, 7, 6],
        [1, 0, 2, 3],
        [5, 1, 3, 7],
        [0, 4, 6, 2],
        [6, 7, 3, 2],
        [0, 1, 5, 4],
    ]
    .iter()
    .enumerate()
    .map(|(id, v)| serde_json::json!({"id":id,"v":v}))
    .collect();
    serde_json::from_value(serde_json::json!({"schema":"tankforge.design/1","id":"p1_box","name":"P1 box","hull_geometry":{"vertices":vertices,"faces":faces},
        "armor_faces":[{"body":"hull","face":1,"material":"rha","thickness_mm":50}],"armor_layers":[{"body":"hull","face":1,"layers":[{"material":"rha","thickness_mm":50,"spacing_mm":100}]}],
        "internal_modules":[],"crew_positions":[],"engine":{"kind":"gasoline","power_hp":100},"transmission":{"kind":"synchromesh","forward_gears":5,"gearing_kmh":50,"steering":"controlled_differential"},
        "suspension":{"kind":"torsion_bar","stations":4,"wheel_diameter_m":0.5,"front_z_m":1,"rear_z_m":-0.5,"sprocket":"front"},"tracks":{"width_m":0.3,"center_x_m":1.2}})).unwrap()
}

#[test]
fn all_five_active_owners_share_raw_two_layer_state() {
    let p = shell();
    let mat = material();
    let plates = vec![plate("first", 0.0), plate("second", 0.2)];
    let velocity = Vec3::new(0.0, 0.0, 100.0);
    let mut single = impact::initialize_impact(&p, velocity, 150.0, "core").unwrap();
    let input = single.energy_j();
    for pl in &plates {
        resolve_with_state(
            &p,
            pl,
            &mat,
            ImpactContext {
                incidence_deg: 0.0,
                distance_m: 0.0,
            },
            &mut single,
            &format!("plate:{}", pl.id),
            0,
        )
        .unwrap();
    }
    let mut stack = impact::initialize_impact(&p, velocity, 150.0, "core").unwrap();
    let crossings: Vec<_> = plates
        .iter()
        .enumerate()
        .map(|(i, _)| PlateCrossing {
            material: &mat,
            thickness_mm: 50.0,
            path_mm: 50.0,
            incidence_deg: 0.0,
            gap_before_mm: if i == 0 { 0.0 } else { 150.0 },
        })
        .collect();
    let identities: Vec<_> = plates
        .iter()
        .map(|pl| LayerIdentity {
            layer_id: format!("plate:{}", pl.id),
            traversal_id: 0,
        })
        .collect();
    let stack_report = resolve_stack_with_state(
        &p,
        &crossings,
        &StackParams::default(),
        &mut stack,
        &identities,
    );
    let mut legacy = serde_json::to_value(&stack).unwrap();
    legacy["traversal"]
        .as_object_mut()
        .unwrap()
        .remove("cumulative_path_m");
    let old: impact::ImpactState = serde_json::from_value(legacy).unwrap();
    assert_eq!(old.current, stack.current);
    assert_eq!(old.traversal.unwrap().cumulative_path_m, 0.0);
    let target = tg_combat::Target::new(
        tg_combat::TargetDef {
            id: "p1".into(),
            plates: plates.clone(),
            modules: vec![],
            crew: vec![],
            turret: None,
            open_top: false,
            ammo_capacity: 0,
            weapons: serde_json::Value::Null,
            machine_guns: serde_json::Value::Null,
            visual: serde_json::Value::Null,
            surfaces: None,
        },
        &[mat.clone()],
    );
    let mut shot = tg_combat::Shot {
        shell: p.clone(),
        origin: Vec3::new(0.0, 1.0, -2.0),
        dir: Vec3::new(0.0, 0.0, 1.0),
        speed_ms: 100.0,
        distance_m: 0.0,
        seed: 1,
        turret_yaw: 0.0,
    };
    let probe = tg_combat::shoot(&target, &target.fresh_state(), &shot);
    shot.shell.penetration_curve[0].pen_mm *= 150.0 / probe.pen_mm;
    let combat = tg_combat::shoot(&target, &target.fresh_state(), &shot);
    let mut db = tg_design::Db::embedded();
    db.catalog.penetration.sigma_fraction = 0.0;
    let d = design();
    let model = tg_design::layout::Model::new(&d, &db);
    let req:tg_design::trace::ShotRequest=serde_json::from_value(serde_json::json!({"shell":p,"origin":[0,1,-2],"dir":[0,0,1],"speed_ms":100,"distance_m":0,"seed":1,"path":[]})).unwrap();
    let designed = tg_design::trace::shoot(&model, &tg_design::trace::TargetState::default(), &req);
    let mut data = Data {
        materials: MaterialDb::from_vec(vec![mat]),
        projectile: shell(),
        plates,
        modules: vec![],
        crew: vec![],
    };
    let ballistic = BallisticState::from_muzzle(
        Vec3::new(0.0, 1.0, -2.0),
        Vec3::new(0.0, 0.0, 1.0),
        &data.projectile,
    );
    let mut slice = event();
    run_kinetic_contacts(
        &mut data,
        &mut slice,
        &ballistic,
        0,
        Vec3::new(0.0, 1.0, 0.0),
        0.02,
        1,
    );
    let energies = [
        single.energy_j(),
        stack.energy_j(),
        combat.impact_state.as_ref().unwrap().energy_j(),
        designed.event.impact_state.as_ref().unwrap().energy_j(),
        slice.impact_state.as_ref().unwrap().energy_j(),
    ];
    for energy in energies {
        assert!((energy - input * 2.0 / 3.0).abs() < 1e-3, "energy={energy}");
    }
    for transitions in [&stack_report.impacts[..]] {
        for transition in transitions {
            transition.budget.validate().unwrap();
        }
    }
    assert_eq!(
        slice
            .impact_events
            .iter()
            .filter(|e| e.transition.verdict == ImpactVerdict::Passed)
            .count(),
        2
    );
    for events in [
        &combat.impact_events[..],
        &designed.event.impact_events[..],
        &slice.impact_events[..],
    ] {
        for event in events {
            event.transition.budget.validate().unwrap();
            if event.transition.verdict == ImpactVerdict::Passed {
                let distance = (event.exit_position - event.entry_position).length() as f64;
                let transit = distance / event.transition.entry.velocity_m_s.length() as f64;
                assert!(
                    (event.transition.output.elapsed_s
                        - event.transition.entry.elapsed_s
                        - transit)
                        .abs()
                        < 1e-8,
                    "shared transit in {}",
                    event.transition.layer_id
                );
            }
        }
    }
    let repeated = tg_design::trace::shoot(&model, &tg_design::trace::TargetState::default(), &req);
    assert_eq!(
        serde_json::to_value(&designed.event).unwrap(),
        serde_json::to_value(repeated.event).unwrap()
    );
}

#[test]
fn slice_real_flight_uses_actual_vector_and_reaches_second_plate() {
    let p = shell();
    let mut data = Data {
        materials: MaterialDb::from_vec(vec![material()]),
        projectile: p,
        plates: vec![plate("first", 0.0), plate("second", 0.2)],
        modules: vec![],
        crew: vec![],
    };
    let result = run_shot(
        &Scenario {
            shooter_pos: Vec3::new(0.0, 1.0, -2.0),
            aim_point: Vec3::new(0.0, 1.0, 0.2),
            seed: 1,
        },
        &mut data,
    );
    let plates: Vec<_> = result
        .event
        .impact_events
        .iter()
        .filter(|e| e.transition.verdict == ImpactVerdict::Passed)
        .collect();
    assert_eq!(plates.len(), 2);
    assert!(
        plates[0].transition.entry.velocity_m_s.y < 0.0,
        "gravity-integrated incoming vector"
    );
    assert!(
        (plates[1].transition.budget.input_j - plates[0].transition.budget.core_out_j).abs() < 1e-3
    );
    assert!(
        (result.event.impact_state.unwrap().energy_j() / plates[0].transition.budget.input_j
            - 2.0 / 3.0)
            .abs()
            < 1e-5
    );
}

#[test]
fn slice_plate_exit_time_is_shared_even_when_passed_with_zero_energy() {
    for thickness in [50.0, 150.0] {
        let mut front = plate("first", 0.0);
        front.thickness_mm = thickness;
        let mut data = Data {
            materials: MaterialDb::from_vec(vec![material()]),
            projectile: shell(),
            plates: vec![front],
            modules: vec![],
            crew: vec![],
        };
        let ballistic = BallisticState::from_muzzle(
            Vec3::new(0.0, 1.0, -2.0),
            Vec3::new(0.0, 0.0, 1.0),
            &data.projectile,
        );
        let mut slice = event();
        run_kinetic_contacts(
            &mut data,
            &mut slice,
            &ballistic,
            0,
            Vec3::new(0.0, 1.0, 0.0),
            0.02,
            1,
        );
        let contact = &slice.impact_events[0];
        assert_eq!(contact.transition.verdict, ImpactVerdict::Passed);
        let output = contact.transition.output.elapsed_s;
        assert!(
            (output - contact.transition.entry.elapsed_s - thickness as f64 * 0.001 / 100.0).abs()
                < 1e-10
        );
        assert!(slice
            .projectile_path
            .iter()
            .any(|p| (p.pos - contact.exit_position).length() < 1e-6
                && (p.t as f64 - output).abs() < 1e-8));
        let carriers: Vec<_> = slice.fragments.iter().filter(|f| f.is_penetrator).collect();
        if thickness == 150.0 {
            assert_eq!(slice.impact_state.as_ref().unwrap().energy_j(), 0.0);
            assert!(
                carriers.is_empty(),
                "exhausted passed carrier cannot invent positive-distance continuation"
            );
        } else {
            assert_eq!(carriers[0].provenance.start_s, Some(output));
        }
    }
}

#[test]
fn slice_primary_target_is_not_deposited_again_across_plate_segments() {
    let radio: Module = serde_json::from_value(serde_json::json!({
        "id":"radio", "kind":"radio", "center":[0,1,0.3],
        "half_extents":[0.2,0.2,0.25], "health":100, "max_health":100
    }))
    .unwrap();
    let mut data = Data {
        materials: MaterialDb::from_vec(vec![material()]),
        projectile: shell(),
        plates: vec![plate("first", 0.0), plate("second", 0.2)],
        modules: vec![radio],
        crew: vec![],
    };
    let result = run_shot(
        &Scenario {
            shooter_pos: Vec3::new(0.0, 1.0, -2.0),
            aim_point: Vec3::new(0.0, 1.0, 0.2),
            seed: 1,
        },
        &mut data,
    );
    let deposits: Vec<_> = result
        .event
        .impact_events
        .iter()
        .filter(|e| e.transition.verdict == ImpactVerdict::Deposited)
        .collect();
    assert_eq!(
        deposits.len(),
        1,
        "one physical primary radio contact: {:?}",
        deposits
            .iter()
            .map(|e| e.transition.budget.target_deposition_j)
            .collect::<Vec<_>>()
    );
    let last_plate = result
        .event
        .impact_events
        .iter()
        .find(|e| e.transition.layer_id == "plate:second")
        .unwrap();
    assert!(
        (result.event.impact_state.as_ref().unwrap().energy_j()
            - last_plate.transition.budget.core_out_j)
            .abs()
            < 1e-4
    );
    assert!(
        (result.event.impact_state.as_ref().unwrap().energy_j() - 316.563969).abs() < 1e-3,
        "one radio contact must preserve the legal second-plate output"
    );
    assert_eq!(result.event.damaged_modules.len(), 1);
}
