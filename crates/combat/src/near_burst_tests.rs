use super::*;
use geometry::{manifest::sha256, Geometry, MeshStore};
use serde_json::json;

// The left station is genuinely visible through the modeled opening; the right
// station has a separate armored (or explicitly unknown) screen. Engineering
// planes and global open_top deliberately cannot stand in for these triangles.
fn exposed_stations(unknown_screen: bool, open_top: bool) -> (Target, geometry::combat_scene::CombatScene) {
    exposed_stations_with_occluders(unknown_screen, open_top, None)
}

fn exposed_stations_with_occluders(unknown_screen: bool, open_top: bool, breech: Option<bool>) -> (Target, geometry::combat_scene::CombatScene) {
    let mut def = box_tank(false).def;
    def.id = "blast-stations".into();
    def.turret = None;
    def.modules.clear();
    def.open_top = open_top;
    def.crew = vec![crew(CrewRole::Gunner, [-0.5, 0., 0.8]), crew(CrewRole::Driver, [0.5, 0., 0.8])];
    if breech.is_some() { def.crew.push(crew(CrewRole::Loader, [-0.65, 0., 1.4])); }
    if breech == Some(true) { def.modules.push(module("breech", ModuleKind::GunBreech, [-0.5,0.,0.4], [0.4,0.4,0.1], 100.)); }
    def.plates = vec![plate("screen", ArmorZone::HullSide, 250., [0.5, 0., 0.], [0., 0., -1.], [1., 0., 0.], 0.4, 1.)];
    let target = Target::new(def, &rha());
    let anatomy = json!({"armor":target.def.plates,"modules":target.def.modules,"crew":target.def.crew,"weapons":target.def.weapons});
    let ah = sha256(&serde_json::to_vec(&anatomy).unwrap());
    let mut positions = Vec::<[f32; 3]>::new();
    let mut triangles = Vec::<[u32; 3]>::new();
    let mut quads = vec![(0.1, 1., -1., 1., 0.), (-0.65, -0.35, -0.2, 0.2, 0.8), (0.35, 0.65, -0.2, 0.2, 0.8)];
    if breech.is_some() { quads.push((-0.8,-0.5,-0.2,0.2,1.4)); }
    if breech == Some(true) { quads.push((-0.9,-0.1,-0.4,0.4,0.4)); }
    for (x0, x1, y0, y1, z) in quads {
        let first = positions.len() as u32;
        positions.extend([[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]]);
        triangles.extend([[first, first + 2, first + 1], [first, first + 3, first + 2]]);
    }
    let mut payload = b"THMESH1\0".to_vec();
    for n in [1, positions.len() as u32, triangles.len() as u32, positions.len() as u32 * 12, triangles.len() as u32 * 12, 0] { payload.extend(n.to_le_bytes()); }
    for p in &positions { for v in p { payload.extend(v.to_le_bytes()); } }
    for t in &triangles { for v in t { payload.extend(v.to_le_bytes()); } }
    let ph = sha256(&payload);
    let mut store = MeshStore::default();
    let mesh = store.install(&payload, &ph).unwrap();
    let ident = [1f32,0.,0.,0.,0.,1.,0.,0.,0.,0.,1.,0.,0.,0.,0.,1.].map(f32::to_bits);
    let zero = "0".repeat(64);
    let mut declarations = vec![];
    let mut ranges = vec![];
    let mut surfaces = vec![];
    let mut keys = vec!["screen", "gunner", "driver"];
    if breech.is_some() { keys.push("loader"); }
    if breech == Some(true) { keys.push("breech"); }
    for (ordinal, key) in keys.into_iter().enumerate() {
        let armor = ordinal == 0 && !unknown_screen;
        let is_crew = ordinal > 0 && key != "breech";
        let role = if key == "breech" { "module" } else if is_crew { "crew" } else if armor { "armor" } else { "unknown" };
        let mut d = json!({"meshKey":"mesh","first":ordinal*2,"count":2,"sourceKey":"stations-fixture","partId":key,"material":{},"role":role,"topology":{"kind":"open_sheet"},
            "armorBinding":{"status":if armor{"declared"}else{"none"},"armorRefs":if armor{vec!["screen"]}else{vec![]},"layerKey":if armor{Some("wall")}else{None},"boundarySide":if armor{"outer"}else{"none"},"thicknessSource":if armor{"authored_engineering"}else{"none"},"pairing":"same_material_region"},
            "moduleRef":if key=="breech"{Some("breech")}else{None},"crewSlot":if is_crew{Some(json!({"index":ordinal-1,"role":target.def.crew[ordinal-1].role,"anatomyHash":ah}))}else{None},
            "contactEligible":true,"fuseEligible":armor,"resistancePolicy":if armor{"authored_thickness"}else if is_crew{"crew"}else if key=="breech"{"module"}else{"unsupported"},"declaration":{"revision":"test","basis":"authored_station_screen"},"owners":[]});
        let dh = sha256(&serde_json::to_vec(&d).unwrap());
        let dk = format!("decl:{dh}");
        d["key"] = json!(dk); d["declaration"]["contentHash"] = json!(dh);
        declarations.push(d);
        ranges.push(json!({"first":ordinal*2,"count":2,"sourceKey":"stations-fixture","surfaceKey":key,"solidKey":null,"bindingKey":null}));
        surfaces.push(json!({"key":key,"role":if role=="unknown"{"audit_pending"}else{role},"topology":"open_sheet","winding":"emitted","responseRef":dk,"armorLayerKey":if armor{Some("wall")}else{None},"moduleKey":if key=="breech"{Some("breech")}else{None},"crewKey":if is_crew{Some(key)}else{None},"fuseEligible":armor,"contactEligible":true}));
    }
    let mut m = json!({"schema":"HitMeshManifestV1","format":"THMESH1","endianness":"LE","generator":{"revision":"test","sha256":zero},"buildRecipeHash":zero,"specId":target.def.id,"buildHash":zero,"renderGeometryHash":zero,"anatomyDataHash":ah,"sources":{"assets":[]},
        "meshes":[{"key":"mesh","payloadHash":ph,"positionsHash":mesh.data.position_hash,"renderBufferHash":zero,"vertexCount":positions.len(),"triangleCount":triangles.len(),"bounds":mesh.data.bounds,"ranges":ranges,"bvh":null}],
        "assemblies":[{"key":"root","parent":null,"baseTransformBits":ident,"pivot":[0,0,0],"joint":{},"allowedMotionFields":[]}],
        "meshInstances":[{"key":"instance","meshKey":"mesh","assemblyKey":"root","sourceKey":"stations-fixture","worldBits":ident,"instanceBits":ident,"materialFeature":{},"activityPolicy":"static_fixture"}],"bindings":[{"key":"wall"},{"key":"gunner"},{"key":"driver"},{"key":"loader"},{"key":"breech"}],"surfaces":surfaces,
        "audits":{"certification":"audit_pending_diagnostic","triangleCoverage":triangles.len(),"unclassifiedPhysicalTriangles":if unknown_screen{2}else{0},"degenerateCount":0,"boundaryEdges":0,"nonmanifoldEdges":0,"missingBindings":0,"ambiguousBindings":0,"renderPositionDifferences":0,"topologyPending":false,"declaredOpenBoundaries":null,"shaderDeformation":"none","activity":"static_fixture"}});
    m["manifestHash"] = json!(sha256(&serde_json::to_vec(&m).unwrap()));
    let mb = serde_json::to_vec(&m).unwrap();
    let mh = sha256(&mb);
    let geo = Geometry::register(&mb, &mh, &store).unwrap();
    let mut c = json!({"schema":"HitBindingCatalogV1","specId":target.def.id,"manifestHash":mh,"buildHash":zero,"anatomyHash":ah,"acceptedAnatomy":anatomy,"targetRegistrationHash":target.registration_hash(),"sourceGeneratorHash":zero,"geometryBytesChanged":0,"declarations":declarations,
        "layers":[{"key":"wall","armorRef":"screen","authoredThicknessMm":250.,"authoredMaterial":target.def.plates[0].material,"chargePolicy":"once_per_material_region","historicalMeasurement":false}],"instances":[{"instanceKey":"instance","assemblyKey":"root","materialFeature":{}}],"articulations":[],"audit":{}});
    c["catalogHash"] = json!(sha256(&serde_json::to_vec(&c).unwrap()));
    let cb = serde_json::to_vec(&c).unwrap();
    let ctx = geometry::surface::QueryContext { entity_id:"blast-actor".into(),spawn_epoch:1,build_hash:zero,pose_revision:7,geometry_revision:0,shape_hash:None };
    let scene = geometry::combat_scene::CombatScene::new(geo, &mh, &cb, &sha256(&cb), &target, ctx).unwrap();
    (target, scene)
}

fn surface_pressure_only(target: &Target, scene: &geometry::combat_scene::CombatScene, inside: bool) -> Report {
    let at = Vec3::new(0.,0.,-1.);
    let state = target.fresh_state();
    let mut work = Work { scene:Some(scene),context:None,t:target,p:target.posed(0.),st:state.clone(),
        rng:Rng::new(3),explosive_re_factor:1.,rep:splash(target,&state,at,0.,0.,3),mod_dmg:HashMap::new(),crew_dmg:HashMap::new(),
        newly_destroyed:vec![],newly_killed:vec![] };
    work.blast_surface(at, 39., inside);
    finish(&mut work);
    work.rep
}

#[test]
fn internal_pressure_does_not_treat_registered_crew_or_breech_as_sealed_compartment_walls() {
    for breech in [false, true] {
        for unknown_screen in [false, true] {
            let (target, scene) = exposed_stations_with_occluders(unknown_screen, false, Some(breech));
            let report = surface_pressure_only(&target,&scene,true);
            assert!(report.state.crew[0] < 100., "an ordinary registered breech is not a gas-tight compartment wall");
            assert!(report.state.crew[2] < 100., "one crew body cannot seal the rest of the same open air path");
            assert_eq!(report.state.crew[1], 100., "a registered armor or unknown surface still separates the protected station");
        }
    }
}

#[test]
fn external_pressure_keeps_registered_module_and_crew_line_of_sight_policy() {
    let (target, scene) = exposed_stations_with_occluders(false, true, Some(true));
    let report = surface_pressure_only(&target,&scene,false);
    assert_eq!(report.state.crew,target.fresh_state().crew,
        "external pressure does not gain an unmodeled route through any physical occluder");
}

#[test]
fn initiated_heat_family_keeps_casing_burst_separate_from_jet() {
    let target = near_burst_wall(250., None);
    for kind in [ProjectileKind::Heat, ProjectileKind::HeatFs] {
        let charge = shell(kind, 152., 20., 600., 3.);
        let report = near_burst::evaluate(&target, &target.fresh_state(), Vec3::new(-1.,1.,0.), &charge, 0., 4, None, None).unwrap();
        assert_eq!(report.bursts.len(), 1, "an initiated HEAT charge still has an external explosive burst");
        assert!(report.fragments.iter().any(|f| f.kind == "burst" && f.provenance.source == impact::FragmentSource::CasingFragment));
        assert!(!report.fragments.iter().any(|f| f.kind == "jet"), "near burst does not invent a second shaped-charge jet");
        assert_eq!(report.state.crew[0], 100., "thick intact armor still shields the crew");
    }
}

#[test]
fn external_pressure_reaches_only_actual_visible_station_triangles() {
    for open_top in [false, true] {
        let (target, scene) = exposed_stations(false, open_top);
        // No casing: this must test primary blast alone, not lucky fragment damage.
        let charge = shell(ProjectileKind::He, 152., 3., 30., 3.);
        let at = Vec3::new(0., 0., -1.);
        let report = near_burst::evaluate(&target, &target.fresh_state(), at, &charge, 0., 4, None, Some(&scene)).unwrap();
        assert!(report.state.crew[0] < 100., "visible crew anatomy must receive the external direct blast component");
        assert_eq!(report.state.crew[1], 100., "armored driver must be shielded independently of open_top");
        assert!(report.fragments.iter().any(|f| f.kind == "blast" && f.hit.as_deref() == Some("crew:0")));
        assert!(!report.fragments.iter().any(|f| f.kind == "burst"), "zero casing cannot create casing fragments");
        assert!(report.geometry_contacts.iter().any(|c| c["surfaceId"] == "gunner"));
        assert_eq!(report.bursts.len(), 1, "exposure never relocates or duplicates the actual explosion");
        assert_eq!(report.bursts[0].pos, at);
        assert!(!report.bursts[0].inside);
    }
}

#[test]
fn unknown_surface_stays_a_pressure_barrier_while_real_opening_stays_open() {
    let (target, scene) = exposed_stations(true, true);
    let charge = shell(ProjectileKind::He, 420., 250., 300., 250.);
    let report = near_burst::evaluate(&target, &target.fresh_state(), Vec3::new(0.,0.,-1.), &charge, 0., 4, None, Some(&scene)).unwrap();
    assert!(report.state.crew[0] < 100., "actual opening is retained even for a large charge");
    assert_eq!(report.state.crew[1], 100., "unknown screen is quarantined even when blast radius includes the entire target");
}

#[test]
fn legacy_declared_plane_fallback_checks_each_open_station() {
    let mut def = near_burst_wall(250., None).def;
    def.open_top = true;
    def.crew.push(crew(CrewRole::Gunner, [-1., 1., 1.]));
    let target = Target::new(def.clone(), &rha());
    let charge = shell(ProjectileKind::He, 152., 3., 30., 3.);
    let at = Vec3::new(-1., 1., 0.);
    let report = near_burst::evaluate(&target, &target.fresh_state(), at, &charge, 0., 4, None, None).unwrap();
    assert_eq!(report.state.crew[0], 100., "declared armored screen shields the driver");
    assert!(report.state.crew[1] < 100., "open gun station retains its external primary-blast component");
    assert!(report.events.iter().any(|s| s == "legacy_declared_plane_pressure_v1"), "legacy geometry is named, never claimed as registered triangle evidence");
    def.open_top = false;
    let target = Target::new(def, &rha());
    let report = near_burst::evaluate(&target, &target.fresh_state(), at, &charge, 0., 4, None, None).unwrap();
    assert_eq!(report.state.crew, target.fresh_state().crew, "missing legacy compartment/opening evidence cannot expose sealed crew");
}

#[test]
fn casing_only_contact_does_not_repeat_primary_or_duplicate_recorded_burst() {
    let (target,scene)=exposed_stations(false,false);
    let charge=shell(ProjectileKind::He,152.,3.,30.,3.);
    let before=target.fresh_state();
    let report=near_burst::evaluate_casing(&target,&before,Vec3::new(0.,0.,-1.),&charge,0.,4,None,Some(&scene)).unwrap();
    assert_eq!(report.state.crew,before.crew,"recorded primary cannot be applied again");
    assert!(report.fragments.is_empty(),"zero casing must remain zero");
    assert!(report.bursts.is_empty(),"original contact already owns its one detonation record");
}

#[test]
fn direct_he_primary_uses_the_same_real_aperture_as_near_burst() {
    // The projectile hits the screen just beside its left edge. The gunner
    // triangle can see around that real edge; the driver remains behind it.
    for open_top in [false, true] {
        let (target, scene) = exposed_stations(false, open_top);
        let charge = shell(ProjectileKind::He, 152., 3., 30., 3.);
        let before = target.fresh_state();
        let shot = Shot { shell: charge.clone(), origin: Vec3::new(0.1, 0., -1.),
            dir: Vec3::new(0., 0., 1.), speed_ms: 600., distance_m: 0., seed: 4, turret_yaw: 0. };
        let direct = shoot_surface(&target, &before, &shot, &scene, Vec3::new(0.1, 0., 1.), None).unwrap();
        assert_eq!(direct.bursts.len(), 1, "the direct contact records one actual primary burst");
        assert!(!direct.bursts[0].inside, "the stopped contact cannot invent an internal gas route");
        assert_eq!(direct.bursts[0].pos, direct.impact.unwrap(), "the recorded detonation stays at the actual armor contact");
        assert!(direct.state.crew[0] < 100., "a real visible gunner triangle must receive direct-contact primary pressure even when global open_top is false");
        assert_eq!(direct.state.crew[1], 100., "the same screen must shield the driver");
        let query_at = direct.bursts[0].pos - shot.dir * 0.001;
        let near = near_burst::evaluate(&target, &before, query_at,
            &charge, 0., 4, None, Some(&scene)).unwrap();
        assert_eq!(direct.state.crew, near.state.crew, "direct and initiated-near primary exposure share one path policy");
        let casing = near_burst::evaluate_casing(&target, &direct.state, direct.bursts[0].pos,
            &charge, 0., 4, None, Some(&scene)).unwrap();
        assert_eq!(casing.state.crew, direct.state.crew, "the contact followup cannot apply primary twice");
        assert!(casing.bursts.is_empty());
    }
}

#[test]
fn direct_legacy_primary_respects_each_declared_station_screen() {
    let mut def = near_burst_wall(250., None).def;
    def.open_top = true;
    def.crew.push(crew(CrewRole::Gunner, [-1., 1., 1.]));
    let target = Target::new(def, &rha());
    let charge = shell(ProjectileKind::He, 152., 3., 30., 3.);
    let before = target.fresh_state();
    let shot = Shot { shell: charge, origin: Vec3::new(-1., 1., 0.),
        dir: Vec3::new(1., 0., 0.), speed_ms: 600., distance_m: 0., seed: 4, turret_yaw: 0. };
    let direct = shoot(&target, &before, &shot);
    assert_eq!(direct.bursts.len(), 1);
    assert!(!direct.bursts[0].inside);
    assert_eq!(direct.state.crew[0], 100., "global open_top must not expose the driver through his declared armor");
    assert!(direct.state.crew[1] < 100., "the outboard open station retains direct external exposure");
    assert!(direct.events.iter().any(|e| e == "legacy_declared_plane_pressure_v1"));
}

#[test]
fn anatomy_visibility_candidate_scan_skips_occluder_triangle_transforms_without_changing_contacts() {
    for unknown_screen in [false, true] {
        let (_target, scene) = exposed_stations(unknown_screen, false);
        let before = geometry::surface_triangle_visits_for_test();
        let rows = scene.exposed_anatomy(Vec3::new(0., 0., -1.), 10.).unwrap();
        let transformed = geometry::surface_triangle_visits_for_test() - before;
        assert_eq!(rows.len(), 1, "the real opening exposes only one station");
        assert!(matches!(rows[0].0, EvKind::Crew(0)));
        assert_eq!(rows[0].2.surface_id, "gunner", "exact visibility still stops at the real anatomy triangle");
        assert_eq!(transformed, 4, "candidate scan must transform the four crew triangles, not the two armor/unknown occluder triangles; full exact visibility rays still keep those occluders");
    }
}
