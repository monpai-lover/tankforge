use super::*;
use tg_armor::ArmorKind;
use tg_weapon::CurvePoint;

#[path = "near_burst_tests.rs"]
mod near_burst_regressions;

#[path = "near_burst_budget_tests.rs"]
mod near_burst_budget_regressions;

fn near_burst_wall(mm:f32,behind:Option<f32>)->Target {
    let mut def=box_tank(false).def;def.turret=None;def.modules.clear();
    def.crew=vec![crew(CrewRole::Driver,[0.,1.,0.])];
    def.plates=vec![plate("wall",ArmorZone::HullSide,mm,[-0.5,1.,0.],[-1.,0.,0.],[0.,0.,1.],3.,3.)];
    if let Some(mm)=behind {def.plates.push(plate("main",ArmorZone::HullSide,mm,[-0.3,1.,0.],[-1.,0.,0.],[0.,0.,1.],3.,3.));}
    Target::new(def,&rha())
}
fn near_burst_shell()->ProjectileDef {
    let root=std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    serde_json::from_slice(&std::fs::read(root.join("data/projectiles/he_420_tt250.json")).unwrap()).unwrap()
}
#[test]
fn near_burst_closed_thin_armour_is_defeated_by_actual_casing_paths_not_primary_pressure(){
    let thin=near_burst_wall(15.,None);let thick=near_burst_wall(250.,None);let layered=near_burst_wall(1.,Some(250.));
    let shell=near_burst_shell();let at=Vec3::new(-1.,1.,0.);
    let r=near_burst::evaluate(&thin,&thin.fresh_state(),at,&shell,0.,4,None,None).unwrap();
    assert!(r.state.crew[0]<100.,"a real close casing path must defeat thin armor: {:?}",r.fragments.iter().filter(|f|f.hit.is_some()).collect::<Vec<_>>());
    assert!(r.fragments.iter().any(|f|f.kind=="burst"&&f.hit.as_deref()==Some("crew:0")&&f.damage>0.));
    assert!(!r.fragments.iter().any(|f|f.kind=="blast"&&f.hit.as_deref()==Some("crew:0")),"sealed crew have no evidenced air path");
    for t in [thick,layered] {let r=near_burst::evaluate(&t,&t.fresh_state(),at,&shell,0.,4,None,None).unwrap();assert_eq!(r.state.crew[0],100.,"each intervening armor layer must resist a single physical fragment");}
}
#[test]
fn near_burst_casing_mass_and_representative_weight_never_become_one_oversized_fragment(){
    let t=near_burst_wall(250.,None);let shell=near_burst_shell();
    let r=near_burst::evaluate(&t,&t.fresh_state(),Vec3::new(-1.,1.,0.),&shell,0.,4,None,None).unwrap();
    let mut masses=std::collections::BTreeMap::new();
    for f in &r.fragments {if f.kind!="burst"{continue;}let p=f.provenance.physical.as_ref().expect("individual mass and energy required");p.validate().unwrap();if let Some(budget)=f.budget{budget.validate().unwrap();assert!((p.energy_j-budget.input_j).abs()<1e-4);}assert!(p.mass_kg<=0.200001,"numerical budget cannot enlarge one fragment");masses.entry(f.provenance.fragment_id.clone()).or_insert(p.mass_kg*f.provenance.weight);}
    assert!(!masses.is_empty());assert!(masses.values().sum::<f64>()<=(shell.mass_kg-shell.explosive_mass_kg)as f64+1e-4);
    assert!(r.fragments.len()<=256);assert!(r.impact_events.len()<=64);
    assert!(r.events.iter().any(|e|e=="unknown_pressure_boundary"));
}
#[test]
fn near_burst_invalid_charge_rejects_and_zero_filler_cannot_create_fragments(){
    let t=near_burst_wall(1.,None);let mut shell=near_burst_shell();let at=Vec3::new(-1.,1.,0.);
    shell.explosive_mass_kg=0.;let r=near_burst::evaluate(&t,&t.fresh_state(),at,&shell,0.,4,None,None).unwrap();assert!(r.bursts.is_empty()&&r.fragments.is_empty());assert_eq!(r.state.crew,t.fresh_state().crew);
    for kg in [-1.,f32::NAN,f32::INFINITY,251.] {shell.explosive_mass_kg=kg;assert!(near_burst::evaluate(&t,&t.fresh_state(),at,&shell,0.,4,None,None).is_err());}
}
#[test]
fn near_burst_is_deterministic_and_global_open_top_does_not_open_a_sealed_driver(){
    let mut def=near_burst_wall(250.,None).def;def.open_top=true;let t=Target::new(def,&rha());let shell=near_burst_shell();let at=Vec3::new(-1.,1.,0.);
    let a=near_burst::evaluate(&t,&t.fresh_state(),at,&shell,0.,4,None,None).unwrap();let b=near_burst::evaluate(&t,&t.fresh_state(),at,&shell,0.,4,None,None).unwrap();
    assert_eq!(serde_json::to_value(a.clone()).unwrap(),serde_json::to_value(b).unwrap());assert_eq!(a.state.crew[0],100.);
}
#[test]
fn near_burst_seeded_sampling_has_no_permanently_empty_central_cone(){
    let t=near_burst_wall(1.,None);let shell=near_burst_shell();let mut damaged=false;
    for seed in 1..=128 {let r=near_burst::evaluate(&t,&t.fresh_state(),Vec3::new(-10.,1.,0.),&shell,0.,seed,None,None).unwrap();damaged|=r.state.crew[0]<100.;}
    assert!(damaged,"a centered 0.28 m crew at 10 m has positive solid angle; changing seeds must sample that cone");
}
#[test]
fn near_burst_fragment_cursor_never_reenters_already_crossed_paired_wall(){
    let(t,scene)=surface_combat_fixture_engine_at(0.025);let before=t.fresh_state();let shell=near_burst_shell();
    for seed in 1..=8 {let r=near_burst::evaluate(&t,&before,Vec3::new(0.5,0.,-0.1),&shell,0.,seed,None,Some(&scene)).unwrap();assert_eq!(r.state.modules,before.modules,"an anatomy contact inside already crossed wall cannot rewind the physical cursor");}
}

// A visible frame with a real aperture, two faces of the same authored wall,
// and a modeled engine beyond it. Legacy planes and boxes deliberately disagree.
fn surface_combat_fixture() -> (Target, geometry::combat_scene::CombatScene) {
    surface_combat_fixture_engine_at(0.8)
}
fn surface_combat_fixture_engine_at(engine_z:f32) -> (Target, geometry::combat_scene::CombatScene) {
    use serde_json::{json, Value};
    use geometry::{manifest::sha256, Geometry, MeshStore};
    let mut def = box_tank(false).def;
    def.id = "surface-fixture".into(); def.turret = None; def.crew.clear();
    def.plates = vec![plate("front", ArmorZone::HullUpperFront, 20., [0.,0.,-0.4], [0.,0.,-1.], [1.,0.,0.], 1.,1.)];
    def.modules = vec![module("engine", ModuleKind::Engine, [5.,0.,0.8], [0.2,0.2,0.2], 160.)];
    let target=Target::new(def,&rha());
    let mut positions:Vec<[f32;3]>=vec![]; let mut triangles:Vec<[u32;3]>=vec![];
    let mut quad=|x0:f32,x1:f32,y0:f32,y1:f32,z:f32| {
        let n=positions.len() as u32;
        positions.extend([[x0,y0,z],[x1,y0,z],[x1,y1,z],[x0,y1,z]]);
        triangles.extend([[n,n+2,n+1],[n,n+3,n+2]]);
    };
    for z in [0.,0.05] {quad(-1.,-0.2,-1.,1.,z);quad(0.2,1.,-1.,1.,z);quad(-0.2,0.2,-1.,-0.2,z);quad(-0.2,0.2,0.2,1.,z);}
    quad(0.3,0.7,-0.2,0.2,engine_z);
    let mut payload=b"THMESH1\0".to_vec();
    for n in [1,positions.len() as u32,triangles.len() as u32,positions.len() as u32*12,triangles.len() as u32*12,0] {payload.extend(n.to_le_bytes());}
    for p in &positions {for v in p {payload.extend(v.to_le_bytes());}}
    for t in &triangles {for v in t {payload.extend(v.to_le_bytes());}}
    let mut store=MeshStore::default();let ph=sha256(&payload);let mesh=store.install(&payload,&ph).unwrap();
    let ident=[1f32,0.,0.,0.,0.,1.,0.,0.,0.,0.,1.,0.,0.,0.,0.,1.].map(f32::to_bits);
    let z="0".repeat(64);
    let mut declarations=vec![];let mut ranges=vec![];let mut surfaces=vec![];
    for (key,first,count,role,side) in [("outer",0,8,"armor","outer"),("inner",8,8,"armor","inner"),("engine",16,2,"module","none")] {
        let mut d=json!({"meshKey":"mesh","first":first,"count":count,"sourceKey":"fixture-source","partId":key,"material":{},"role":role,"topology":{"kind":"open_sheet"},"armorBinding":{"status":if role=="armor"{"declared"}else{"none"},"armorRefs":if role=="armor"{vec!["front"]}else{vec![]},"layerKey":if role=="armor"{Some("wall")}else{None},"boundarySide":side,"thicknessSource":if role=="armor"{"authored_engineering"}else{"none"},"pairing":"same_material_region"},"moduleRef":if role=="module"{Some("engine")}else{None},"crewSlot":null,"contactEligible":true,"fuseEligible":true,"resistancePolicy":if role=="armor"{"authored_thickness"}else{"module"},"declaration":{"revision":"fixture-v1","basis":"test"},"owners":[]});
        let dh=sha256(&serde_json::to_vec(&d).unwrap());let dk=format!("decl:{dh}");d["key"]=json!(dk);d["declaration"]["contentHash"]=json!(dh);
        declarations.push(d);
        ranges.push(json!({"first":first,"count":count,"sourceKey":"fixture-source","surfaceKey":key,"solidKey":null,"bindingKey":null}));
        surfaces.push(json!({"key":key,"role":role,"topology":"open_sheet","winding":"emitted","responseRef":dk,"armorLayerKey":if role=="armor"{Some("wall")}else{None},"moduleKey":if role=="module"{Some("engine")}else{None},"crewKey":null,"fuseEligible":true,"contactEligible":true}));
    }
    let mut m=json!({"schema":"HitMeshManifestV1","format":"THMESH1","endianness":"LE","generator":{"revision":"test","sha256":z},"buildRecipeHash":z,"specId":target.def.id,"buildHash":z,"renderGeometryHash":z,"anatomyDataHash":z,"sources":{"assets":[]},"meshes":[{"key":"mesh","payloadHash":ph,"positionsHash":mesh.data.position_hash,"renderBufferHash":z,"vertexCount":positions.len(),"triangleCount":triangles.len(),"bounds":mesh.data.bounds,"ranges":ranges,"bvh":null}],"assemblies":[{"key":"root","parent":null,"baseTransformBits":ident,"pivot":[0,0,0],"joint":{},"allowedMotionFields":[]}],"meshInstances":[{"key":"instance","meshKey":"mesh","assemblyKey":"root","sourceKey":"fixture-source","worldBits":ident,"instanceBits":ident,"materialFeature":{},"activityPolicy":"static_fixture"}],"bindings":[{"key":"wall"},{"key":"engine"}],"surfaces":surfaces,"audits":{"certification":"audit_pending_diagnostic","triangleCoverage":triangles.len(),"unclassifiedPhysicalTriangles":0,"degenerateCount":0,"boundaryEdges":0,"nonmanifoldEdges":0,"missingBindings":0,"ambiguousBindings":0,"renderPositionDifferences":0,"topologyPending":false,"declaredOpenBoundaries":null,"shaderDeformation":"none","activity":"static_fixture"}});
    m["manifestHash"]=json!(sha256(&serde_json::to_vec(&m).unwrap()));
    let anatomy=json!({"armor":target.def.plates,"modules":target.def.modules,"crew":target.def.crew,"weapons":target.def.weapons});
    let anatomy_hash=sha256(&serde_json::to_vec(&anatomy).unwrap());
    m.as_object_mut().unwrap().remove("manifestHash");m["anatomyDataHash"]=json!(anatomy_hash);m["manifestHash"]=json!(sha256(&serde_json::to_vec(&m).unwrap()));
    let mb=serde_json::to_vec(&m).unwrap();let mh=sha256(&mb);let geo=Geometry::register(&mb,&mh,&store).unwrap();
    let mut c=json!({"schema":"HitBindingCatalogV1","specId":target.def.id,"manifestHash":mh,"buildHash":z,"anatomyHash":z,"sourceGeneratorHash":z,"geometryBytesChanged":0,"declarations":declarations,"layers":[{"key":"wall","armorRef":"front","authoredThicknessMm":20.,"authoredMaterial":target.def.plates[0].material,"chargePolicy":"once_per_material_region","historicalMeasurement":false}],"instances":[{"instanceKey":"instance","assemblyKey":"root","materialFeature":{}}],"articulations":[],"audit":{}});
    c["acceptedAnatomy"]=anatomy;c["anatomyHash"]=json!(anatomy_hash);c["targetRegistrationHash"]=json!(target.registration_hash());c["catalogHash"]=json!(sha256(&serde_json::to_vec(&c).unwrap()));let cb=serde_json::to_vec(&c).unwrap();
    let context=geometry::surface::QueryContext{entity_id:"actor".into(),spawn_epoch:1,build_hash:z,pose_revision:7,geometry_revision:0,shape_hash:None};
    let scene=geometry::combat_scene::CombatScene::new(geo,&mh,&cb,&sha256(&cb),&target,context).unwrap();
    let _:Value=c;(target,scene)
}
fn surface_shot(x:f32)->Shot {Shot{shell:shell(ProjectileKind::Ap,10.,0.1,150.,0.),origin:Vec3::new(x,0.,-1.),dir:Vec3::new(0.,0.,1.),speed_ms:800.,distance_m:0.,seed:1,turret_yaw:0.}}

// One shared physical shoe mesh, independently owned by the two running-gear
// sides. Abstract module boxes deliberately sit far away from the visible metal.
fn instance_gear_fixture(change: impl FnOnce(&mut serde_json::Value)) -> Result<(Target, geometry::combat_scene::CombatScene), String> {
    instance_gear_fixture_kind("track_link",change)
}
fn instance_gear_fixture_kind(kind: &str,change: impl FnOnce(&mut serde_json::Value)) -> Result<(Target, geometry::combat_scene::CombatScene), String> {
    instance_gear_fixture_options(kind,false,change)
}
fn instance_gear_fixture_options(kind: &str,duplicate:bool,change: impl FnOnce(&mut serde_json::Value)) -> Result<(Target, geometry::combat_scene::CombatScene), String> {
    use serde_json::json;
    use geometry::{manifest::sha256, Geometry, MeshStore};
    let mut def = box_tank(false).def;
    def.id = "instance-gear".into(); def.turret = None; def.plates.clear(); def.crew.clear();
    def.modules = vec![module("track_l", ModuleKind::Track, [-20.,0.,0.], [0.1;3], 120.), module("track_r", ModuleKind::Track, [20.,0.,0.], [0.1;3], 120.), module("engine", ModuleKind::Engine, [0.,20.,0.], [0.1;3],160.)];
    if duplicate {def.modules.push(def.modules[0].clone());}
    let target = Target::new(def, &rha());
    let positions = [[-0.5f32,-0.5,0.],[0.5,-0.5,0.],[0.,0.5,0.]];
    let mut payload = b"THMESH1\0".to_vec();
    for n in [1u32,3,1,36,12,0] { payload.extend(n.to_le_bytes()); }
    for p in positions { for x in p { payload.extend(x.to_le_bytes()); } }
    for n in [0u32,2,1] { payload.extend(n.to_le_bytes()); }
    let mut store=MeshStore::default();let ph=sha256(&payload);let mesh=store.install(&payload,&ph).unwrap();
    let ident=[1f32,0.,0.,0.,0.,1.,0.,0.,0.,0.,1.,0.,0.,0.,0.,1.].map(f32::to_bits);let z="0".repeat(64);
    let mut d=json!({"meshKey":"shoe","first":0,"count":1,"sourceKey":"authored-shoe","partId":"shoe","material":{},"role":"module","armorBinding":{"status":"none","armorRefs":[],"layerKey":null},"moduleRef":null,"crewSlot":null,"contactEligible":true,"fuseEligible":false,"resistancePolicy":"no_authored_armor","declaration":{"revision":"test","basis":"authored_running_gear_instance_side"},"owners":[]});
    let dh=sha256(&serde_json::to_vec(&d).unwrap());let dk=format!("decl:{dh}");d["key"]=json!(dk);d["declaration"]["contentHash"]=json!(dh);
    let instances: Vec<_>=[(-1,-2f32,"track_l"),(1,2f32,"track_r")].into_iter().map(|(side,x,_)| {let mut world=ident;world[12]=x.to_bits();json!({"key":format!("shoe:{side}"),"meshKey":"shoe","assemblyKey":"root","sourceKey":"authored-shoe","worldBits":world,"instanceBits":ident,"materialFeature":{"status":"declared_identity","kind":kind,"side":side,"index":0},"activityPolicy":"static_fixture"})}).collect();
    let anatomy=json!({"armor":target.def.plates,"modules":target.def.modules,"crew":target.def.crew,"weapons":target.def.weapons});let ah=sha256(&serde_json::to_vec(&anatomy).unwrap());
    let mut m=json!({"schema":"HitMeshManifestV1","format":"THMESH1","endianness":"LE","generator":{"revision":"fixture","sha256":z},"buildRecipeHash":z,"specId":"instance-gear","buildHash":z,"renderGeometryHash":z,"anatomyDataHash":ah,"sources":{"assets":[]},"meshes":[{"key":"shoe","payloadHash":ph,"positionsHash":mesh.data.position_hash,"renderBufferHash":z,"vertexCount":3,"triangleCount":1,"bounds":mesh.data.bounds,"ranges":[{"first":0,"count":1,"sourceKey":"authored-shoe","sourceTriangleFirst":0,"surfaceKey":"shoe-surface","solidKey":null,"bindingKey":null}],"bvh":null}],"assemblies":[{"key":"root","parent":null,"baseTransformBits":ident,"pivot":[0,0,0],"joint":{},"allowedMotionFields":[]}],"meshInstances":instances,"bindings":[],"surfaces":[{"key":"shoe-surface","role":"module","topology":"decorative_surface","winding":"emitted","responseRef":dk,"armorLayerKey":null,"moduleKey":null,"crewKey":null,"fuseEligible":false,"contactEligible":true}],"audits":{"certification":"audit_pending_diagnostic","triangleCoverage":1,"unclassifiedPhysicalTriangles":0,"degenerateCount":0,"boundaryEdges":3,"nonmanifoldEdges":0,"missingBindings":0,"ambiguousBindings":0,"renderPositionDifferences":0,"topologyPending":false,"declaredOpenBoundaries":null,"shaderDeformation":"none","activity":"static_fixture"}});
    m["manifestHash"]=json!(sha256(&serde_json::to_vec(&m).unwrap()));let mh=sha256(&serde_json::to_vec(&m).unwrap());
    let instance_rows:Vec<_>=m["meshInstances"].as_array().unwrap().iter().map(|i|{let side=i["materialFeature"]["side"].as_i64().unwrap();json!({"instanceKey":i["key"],"assemblyKey":i["assemblyKey"],"materialFeature":i["materialFeature"],"responseOverrides":[{"responseRef":dk,"sourceKey":"authored-shoe","moduleRef":if side<0{"track_l"}else{"track_r"},"ownerSide":side,"policy":"registered_module_kind"}]})}).collect();
    let mut c=json!({"schema":"HitBindingCatalogV1","specId":"instance-gear","manifestHash":mh,"buildHash":z,"anatomyHash":ah,"acceptedAnatomy":anatomy,"targetRegistrationHash":target.registration_hash(),"sourceGeneratorHash":z,"geometryBytesChanged":0,"declarations":[d],"layers":[],"instances":instance_rows});
    change(&mut c);
    let mut changed=c["declarations"][0].clone();changed.as_object_mut().unwrap().remove("key");changed["declaration"].as_object_mut().unwrap().remove("contentHash");
    let dh=sha256(&serde_json::to_vec(&changed).unwrap());let changed_key=format!("decl:{dh}");changed["key"]=json!(changed_key);changed["declaration"]["contentHash"]=json!(dh);c["declarations"][0]=changed;
    m["surfaces"][0]["responseRef"]=json!(changed_key);
    for row in c["instances"].as_array_mut().unwrap(){if let Some(overrides)=row["responseOverrides"].as_array_mut(){for o in overrides{if o["responseRef"]==dk{o["responseRef"]=json!(changed_key);}}}}
    m.as_object_mut().unwrap().remove("manifestHash");m["manifestHash"]=json!(sha256(&serde_json::to_vec(&m).unwrap()));let mb=serde_json::to_vec(&m).unwrap();let mh=sha256(&mb);c["manifestHash"]=json!(mh);
    c["catalogHash"]=json!(sha256(&serde_json::to_vec(&c).unwrap()));let cb=serde_json::to_vec(&c).unwrap();
    let geo=Geometry::register(&mb,&mh,&store)?;
    let context=geometry::surface::QueryContext{entity_id:"gear-actor".into(),spawn_epoch:1,build_hash:z,pose_revision:1,geometry_revision:0,shape_hash:None};
    let scene=geometry::combat_scene::CombatScene::new(geo,&mh,&cb,&sha256(&cb),&target,context)?;
    Ok((target,scene))
}
#[test]
fn surface_instance_gear_hit_damages_only_visible_owned_side() {
    let (t,scene)=instance_gear_fixture(|_|{}).unwrap();let st=t.fresh_state();
    for (x,index) in [(-2.,0usize),(2.,1)] {
        let r=shoot_surface(&t,&st,&surface_shot(x),&scene,Vec3::new(x,0.,1.),None).unwrap();
        assert!(r.hit);assert!(r.state.modules[index]<st.modules[index]);assert_eq!(r.state.modules[1-index],st.modules[1-index]);assert_eq!(r.state.modules[2],st.modules[2]);
        assert!(r.geometry_contacts.iter().any(|c|c["instanceId"]==format!("shoe:{}",if index==0{-1}else{1})));assert!(r.layers.is_empty());
    }
    let miss=shoot_surface(&t,&st,&surface_shot(0.),&scene,Vec3::new(0.,0.,1.),None).unwrap();assert!(!miss.hit);assert_eq!(miss.state.modules,st.modules);
}
#[test]
fn surface_instance_gear_blast_resolves_same_instance_owner() {
    let(_t,scene)=instance_gear_fixture(|_|{}).unwrap();
    for (x,index) in [(-2.,0usize),(2.,1)] {
        let found=scene.exposed_anatomy(Vec3::new(x,0.,-0.1),1.).unwrap();
        assert_eq!(found.len(),1);assert_eq!(found[0].0,EvKind::Module(index));
    }
}
#[test]
fn surface_instance_gear_registration_rejects_forged_or_missing_side_owner() {
    for kind in ["track_shoe","", "engine"] {assert!(instance_gear_fixture_kind(kind,|_|{}).is_err(),"undeclared instance kind {kind}");}
    for change in 0..7 {
        let r=instance_gear_fixture(|c|match change {
            0=>c["instances"][0]["responseOverrides"]=serde_json::json!([]),
            1=>c["instances"][0]["responseOverrides"][0]["moduleRef"]=serde_json::json!("track_r"),
            2=>c["instances"][0]["responseOverrides"][0]["moduleRef"]=serde_json::json!("engine"),
            3=>c["instances"][0]["responseOverrides"][0]["sourceKey"]=serde_json::json!("foreign"),
            4=>c["instances"][0]["materialFeature"]["side"]=serde_json::json!(1),
            5=>{let row=c["instances"][0].clone();c["instances"].as_array_mut().unwrap().push(row);},
            _=>{c["instances"].as_array_mut().unwrap().pop();},
        });assert!(r.is_err(),"forged mapping {change} was accepted");
    }
}
#[test]
fn surface_instance_gear_rejects_duplicate_module_owner() {
    assert!(instance_gear_fixture_options("track_link",true,|_|{}).is_err(),"duplicate registered module identifiers cannot select the first match silently");
}
#[test]
fn surface_instance_gear_rejects_second_anatomy_owner() {
    assert!(instance_gear_fixture(|c|c["declarations"][0]["crewSlot"]=serde_json::json!({"index":0,"role":"driver"})).is_err(),"a module declaration cannot silently discard a crew owner");
}
#[test]
fn surface_combat_aperture_and_finite_segment_never_fall_back_to_plane() {
    let(t,scene)=surface_combat_fixture();let st=t.fresh_state();let shot=surface_shot(0.);
    assert!(shoot(&t,&st,&shot).hit,"legacy plane must expose the regression");
    let r=shoot_surface(&t,&st,&shot,&scene,Vec3::new(0.,0.,1.),None).unwrap();
    assert!(!r.hit);assert_eq!(r.state.modules,st.modules);assert!(r.layers.is_empty());
    let shot=surface_shot(0.5);let r=shoot_surface(&t,&st,&shot,&scene,Vec3::new(0.5,0.,-0.1),None).unwrap();assert!(!r.hit);
}
#[test]
fn surface_combat_continuation_hits_visible_engine_and_charges_paired_wall_once() {
    let(t,scene)=surface_combat_fixture();let st=t.fresh_state();
    let r=shoot_surface(&t,&st,&surface_shot(0.5),&scene,Vec3::new(0.5,0.,1.),None).unwrap();
    assert!(r.hit);assert_eq!(r.layers.len(),1,"inner wall cannot charge armor twice");
    assert!(r.state.modules[0]<st.modules[0],"visible engine, not the old box at x=5, must receive energy");
    assert_eq!(r.geometry_contacts[0]["poseRevision"],7);
    assert!(r.geometry_contacts.iter().any(|c|!c["responseRef"].is_null()&&(c["point"][2].as_f64().unwrap()-0.8).abs()<1e-6));
    assert!((r.impact.unwrap().z-0.).abs()<1e-6,"old plane at z=-0.4 is not the contact");
    assert!((r.impact_events[0].exit_position.z-0.05).abs()<1e-6,"the modeled inner face, not an invented thickness offset, is the transit exit");
}
#[test]
fn surface_combat_fragment_never_uses_old_module_box_or_crew_sphere() {
    let(t,scene)=surface_combat_fixture();let st=t.fresh_state();
    let mut w=work(&t,&st,0.);w.scene=Some(&scene);
    // A fragment outside the rendered aperture meets no engine triangles even
    // though the abstract box is centered directly on this ray.
    w.fragment(Vec3::new(5.,0.,0.),Vec3::new(0.,0.,1.),100_000.,"spall",1.);
    assert_eq!(w.st.modules,st.modules);
    w.fragment(Vec3::new(0.5,0.,0.1),Vec3::new(0.,0.,1.),100_000.,"spall",1.);
    assert!(w.st.modules[0]<st.modules[0]);
    assert!(w.rep.geometry_contacts.iter().any(|c|c["physicalRole"]=="module"),"fragment damage must retain the same measured contact identity");
}
#[test]
fn surface_combat_impact_requires_incoming_contact_before_bounded_internal_continuation() {
    let(t,scene)=surface_combat_fixture();let st=t.fresh_state();let shot=surface_shot(0.5);
    let miss=shoot_surface_impact(&t,&st,&shot,&scene,Vec3::new(0.5,0.,-0.1),None).unwrap();
    assert!(!miss.hit);assert_eq!(miss.state.modules,st.modules);
    let hit=shoot_surface_impact(&t,&st,&shot,&scene,Vec3::new(0.5,0.,0.1),None).unwrap();
    assert!(hit.state.modules[0]<st.modules[0],"a proven armor impact owns a bounded internal continuation beyond the incoming step");
    let shot=surface_shot(0.);let miss=shoot_surface_impact(&t,&st,&shot,&scene,Vec3::new(0.,0.,0.1),None).unwrap();assert!(!miss.hit);
}
#[test]
fn surface_combat_chemical_path_uses_modeled_inner_face_and_impact_clock_starts_at_contact() {
    let(t,scene)=surface_combat_fixture();let st=t.fresh_state();let mut shot=surface_shot(0.5);
    shot.shell=shell(ProjectileKind::Heat,10.,0.1,150.,0.01);
    let r=shoot_surface(&t,&st,&shot,&scene,Vec3::new(0.5,0.,1.),None).unwrap();
    assert!(r.path.iter().any(|p|(p.z-0.05).abs()<1e-6),"jet origin must use the measured inner face");
    let r=shoot_surface(&t,&st,&surface_shot(0.5),&scene,Vec3::new(0.5,0.,1.),None).unwrap();
    assert_eq!(r.impact_events[0].transition.entry.elapsed_s,0.,"incoming ballistic flight already owns the time before first contact");
}
#[test]
fn surface_combat_blast_damage_uses_actual_anatomy_and_surface_occlusion() {
    let(t,scene)=surface_combat_fixture();let st=t.fresh_state();
    let mut w=work(&t,&st,0.);w.scene=Some(&scene);
    w.blast_inside(Vec3::new(5.,0.,0.8),0.1);
    assert_eq!(w.st.modules,st.modules,"a legacy box inside the radius cannot damage an absent modeled engine");
    w.blast_inside(Vec3::new(0.5,0.,0.3),0.1);
    assert!(w.st.modules[0]<st.modules[0],"exposed actual engine triangles must receive the blast");
    let mut w=work(&t,&st,0.);w.scene=Some(&scene);
    w.blast_inside(Vec3::new(0.5,0.,-0.3),0.1);
    assert_eq!(w.st.modules,st.modules,"the modeled armor frame occludes this path, even within the damage radius");
}
#[test]
fn surface_combat_same_key_replacement_must_not_reuse_anatomy() {
    let(t,scene)=surface_combat_fixture();
    for change in 0..4 {
        let mut def=t.def.clone();
        match change {0=>def.modules[0].max_health*=2.,1=>def.modules[0].kind=ModuleKind::FuelTank,2=>def.crew.push(crew(CrewRole::Driver,[0.,0.,0.5])),_=>def.weapons=serde_json::json!({"altered_reload_seconds":0.01})};
        let other=Target::new(def,&rha());
        assert!(!scene.accepts(&other),"an unchanged actor key cannot keep the old anatomy claim after change {change}");
    }
}
#[test]
fn surface_combat_registered_target_mutation_invalidates_accepted_anatomy() {
    let(t,scene)=surface_combat_fixture();
    for change in 0..4 {
        let mut changed=t.clone();
        match change {0=>changed.def.plates[0].thickness_mm*=2.,1=>changed.def.modules[0].max_health*=2.,2=>changed.def.crew.push(crew(CrewRole::Driver,[0.,0.,0.5])),_=>changed.def.weapons=serde_json::json!({"altered_reload_seconds":0.01})};
        assert!(!scene.accepts(&changed),"public registered definition mutation cannot retain accepted anatomy after change {change}");
    }
}
#[test]
fn surface_registration_hash_uses_numeric_value_not_json_integer_spelling() {
    let mut a=box_tank(false).def;
    a.machine_guns=serde_json::from_str("[{\"reload_s\":8.0,\"bullet_mass_g\":64.0}]").unwrap();
    let mut b=a.clone();b.machine_guns=serde_json::json!([{"reload_s":8,"bullet_mass_g":64}]);
    assert_eq!(Target::new(a,&rha()).registration_hash(),Target::new(b,&rha()).registration_hash(),"native file 8.0 and browser JSON 8 are the same engineering number");
}
fn real_t72_surface_fixture() -> (Target,geometry::combat_scene::CombatScene,serde_json::Value) {
    use serde_json::Value;
    use geometry::{manifest::sha256,Geometry,MeshStore,surface::QueryContext,combat_scene::CombatScene};
    let root=std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    let read=|p:&str|std::fs::read(root.join(p)).unwrap();
    let value=|p:&str|serde_json::from_slice::<Value>(&read(p)).unwrap();
    let v=value("data/vehicles/su_t72a/vehicle.json");
    let mut def=target_from_files("player:su_t72a",&v,serde_json::from_slice(&read("data/vehicles/su_t72a/armor.json")).unwrap(),serde_json::from_slice(&read("data/vehicles/su_t72a/modules.json")).unwrap(),serde_json::from_slice(&read("data/vehicles/su_t72a/crew.json")).unwrap());
    def.weapons=value("data/vehicles/su_t72a/weapons.json");def.ammo_capacity=ammo_capacity(&def.weapons);def.machine_guns=value("data/machine_guns.json");
    let visual=value("data/vehicles/su_t72a/visual.json");def.visual=serde_json::json!({"mg_anchors":visual["mg_anchors"],"mg_variants":visual["mg_variants"]});
    let t=Target::new(def,&serde_json::from_slice::<Vec<Material>>(&read("data/materials.json")).unwrap());
    let index=value("data/hit-meshes/bindings-v1-index.json");let e=index["entries"].as_array().unwrap().iter().find(|e|e["specId"]=="su_t72a").unwrap();
    let mb=read(&format!("data/hit-meshes/{}",e["manifestFile"].as_str().unwrap()));let m:Value=serde_json::from_slice(&mb).unwrap();
    let mut store=MeshStore::default();for mesh in m["meshes"].as_array().unwrap(){let h=mesh["payloadHash"].as_str().unwrap();store.install(&read(&format!("data/hit-meshes/{h}.bin")),h).unwrap();}
    let geo=Geometry::register(&mb,e["manifestHash"].as_str().unwrap(),&store).unwrap();
    let cb=read(&format!("data/hit-bindings/{}",e["bindingCatalogFile"].as_str().unwrap()));
    let context=QueryContext{entity_id:"player:1".into(),spawn_epoch:2,build_hash:m["buildHash"].as_str().unwrap().into(),pose_revision:1,geometry_revision:0,shape_hash:None};
    let scene=CombatScene::new(geo,&sha256(&mb),&cb,e["bindingCatalogHash"].as_str().unwrap(),&t,context).unwrap();
    (t,scene,m)
}
#[test]
fn surface_combat_real_t72_he_wheel_impact_has_exact_blast_exposure() {
    let(t,scene,_)=real_t72_surface_fixture();
    let root=std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    let shell:ProjectileDef=serde_json::from_slice(&std::fs::read(root.join("data/projectiles/he_100_of412.json")).unwrap()).unwrap();
    let index=t.def.modules.iter().position(|m|m.id=="track_r").unwrap();
    for z in [0.97,0.99,1.,1.01,1.03] {
        let shot=Shot{shell:shell.clone(),origin:Vec3::new(4.,0.4,z),dir:Vec3::new(-1.,0.,0.),speed_ms:800.,distance_m:0.,seed:1,turret_yaw:0.};
        let end=Vec3::new(-4.,0.4,z);assert!(!scene.crossings(shot.origin,end).unwrap().is_empty());
        let st=t.fresh_state();let report=shoot_surface(&t,&st,&shot,&scene,end,None).unwrap_or_else(|e|panic!("real HE wheel boundary z={z}: {e}"));
        assert!(report.state.modules[index]<st.modules[index],"direct HE wheel impact z={z} must expose that real track surface: {:?}",report.events);
    }
}
#[test]
fn surface_combat_real_t72_catalog_native_registration_and_damage() {
    use serde_json::Value;
    let(t,scene,m)=real_t72_surface_fixture();
    let root=std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");let read=|p:&str|std::fs::read(root.join(p)).unwrap();
    // A real cast-turret transit through the visible breech.
    let shot=Shot{shell:shell(ProjectileKind::Ap,10.,0.1,1000.,0.),origin:Vec3::new(3.,1.86,0.62),dir:Vec3::new(-1.,0.,0.),speed_ms:800.,distance_m:0.,seed:1,turret_yaw:0.};
    let report=shoot_surface(&t,&t.fresh_state(),&shot,&scene,Vec3::new(-3.,1.86,0.62),None).unwrap();
    assert!(!report.geometry_contacts.is_empty());
    assert!(report.geometry_contacts.iter().all(|c|c["buildHash"]==m["buildHash"]&&c["poseRevision"]==1&&c["spawnEpoch"]==2));
    assert!(!report.events.iter().any(|e|e=="rejected_impact_contact"));
    assert!(!report.layers.is_empty(),"the actual casting must resolve authored resistance");
    assert!(report.modules.iter().any(|m|m.kind==ModuleKind::GunBreech&&m.damage>0.),"actual modeled breech damage is required, not registration alone: {:?}",report.events);
    fn bounded(v:&Value)->bool{match v {Value::String(s)=>s.len()<=256,Value::Array(a)=>a.iter().all(bounded),Value::Object(m)=>m.values().all(bounded),_=>true}}
    assert!(bounded(&serde_json::to_value(&report.geometry_contacts).unwrap()),"geometry receipts must fit the actual V3 nested-string limits");
    // Actual rendered wheel rays, formerly unsupported contacts despite an
    // intact visible wheel. A finite side segment must damage only that gear.
    let track=|side:i8|t.track_side.iter().position(|s|*s==side).unwrap();
    for side in [-1i8,1] {
        let x=side as f32;
        let shot=Shot{shell:shell(ProjectileKind::Ap,75.,6.8,150.,0.),origin:Vec3::new(4.*x,0.46,2.02),dir:Vec3::new(-x,0.,0.),speed_ms:800.,distance_m:0.,seed:1,turret_yaw:0.};
        let fresh=t.fresh_state();let r=shoot_surface(&t,&fresh,&shot,&scene,Vec3::new(1.18*x,0.46,2.02),None).unwrap();
        assert!(r.state.modules[track(side)]<fresh.modules[track(side)],"actual side {side} wheel must resolve its Track owner: {:?}",r.events);
        assert_eq!(r.state.modules[track(-side)],fresh.modules[track(-side)]);
        assert!(!r.events.iter().any(|e|e=="unsupported_surface_resistance"));
    }
    // The two sides share a single shoe payload. Build two finite segments from
    // real source vertices and emitted instance matrices, independent of boxes.
    for side in [-1i8,1] {
        let instance=m["meshInstances"].as_array().unwrap().iter().find(|i|i["materialFeature"]["kind"]=="track_link"&&i["materialFeature"]["side"]==side).unwrap();
        let mesh=m["meshes"].as_array().unwrap().iter().find(|mesh|mesh["key"]==instance["meshKey"]).unwrap();
        let payload=read(&format!("data/hit-meshes/{}.bin",mesh["payloadHash"].as_str().unwrap()));
        let local:[geometry::ray::Point;3]=std::array::from_fn(|v|std::array::from_fn(|k|{let o=32+(v*3+k)*4;f32::from_le_bytes(payload[o..o+4].try_into().unwrap())as f64}));
        let matrix=|key:&str|std::array::from_fn(|k|f32::from_bits(instance[key][k].as_u64().unwrap()as u32)as f64);
        let world=geometry::ray::multiply(matrix("worldBits"),matrix("instanceBits"));let p=local.map(|p|geometry::ray::transform(&world,p));
        let center:geometry::ray::Point=std::array::from_fn(|k|p[0][k]*0.25+p[1][k]*0.25+p[2][k]*0.5);
        let n=geometry::ray::cross(geometry::ray::sub(p[1],p[0]),geometry::ray::sub(p[2],p[0]));let length=geometry::ray::dot(n,n).sqrt();
        let vec=|p:geometry::ray::Point|Vec3::new(p[0]as f32,p[1]as f32,p[2]as f32);
        let a=vec(std::array::from_fn(|k|center[k]+n[k]/length*0.05));let b=vec(std::array::from_fn(|k|center[k]-n[k]/length*0.05));
        let shot=Shot{shell:shell(ProjectileKind::Ap,75.,6.8,150.,0.),origin:a,dir:(b-a).normalized(),speed_ms:800.,distance_m:0.,seed:1,turret_yaw:0.};
        let fresh=t.fresh_state();let r=shoot_surface(&t,&fresh,&shot,&scene,b,None).unwrap();
        assert!(r.state.modules[track(side)]<fresh.modules[track(side)],"actual shared shoe side {side} must resolve instance override: {:?}",r.events);
        assert_eq!(r.state.modules[track(-side)],fresh.modules[track(-side)]);
    }
}

#[test]
fn zero_kinetic_energy_does_not_damage_crew() {
    let mut t = box_tank(false);
    t.def.plates.clear();
    t.def.modules.clear();
    t.def.crew = vec![crew(CrewRole::Driver, [0.0, 1.0, 0.0])];
    let t = Target::new(t.def, &rha());
    let mut shell = ProjectileDef::generic_ap(10.0, 150.0);
    shell.mass_kg = 0.1;
    let r = shoot(&t, &t.fresh_state(), &Shot { shell, origin: Vec3::new(0.0, 1.0, -2.0), dir: Vec3::new(0.0, 0.0, 1.0), speed_ms: 0.0, distance_m: 0.0, seed: 1, turret_yaw: 0.0 });
    assert_eq!(r.state.crew[0], 100.0, "zero energy caused {:?}", r.crew);
}

#[test]
fn passing_plate_core_segment_starts_at_output_snapshot() {
    let mut def = box_tank(false).def;
    def.plates = vec![plate(
        "front",
        ArmorZone::HullSide,
        50.0,
        [0.0, 1.0, 0.0],
        [0.0, 0.0, -1.0],
        [1.0, 0.0, 0.0],
        1.0,
        1.0,
    )];
    def.modules.clear();
    def.crew = vec![crew(CrewRole::Driver, [0.0, 1.0, 0.5])];
    let target = Target::new(def, &rha());
    let mut p = ProjectileDef::generic_ap(10.0, 150.0);
    p.mass_kg = 0.1;
    p.normalization_deg = 0.0;
    let r = shoot(
        &target,
        &target.fresh_state(),
        &Shot {
            shell: p,
            origin: Vec3::new(0.0, 1.0, -2.0),
            dir: Vec3::new(0.0, 0.0, 1.0),
            speed_ms: 100.0,
            distance_m: 0.0,
            seed: 1,
            turret_yaw: 0.0,
        },
    );
    let contact = &r.impact_events[0];
    let core = r
        .fragments
        .iter()
        .find(|f| {
            f.provenance.source == impact::FragmentSource::Core
                && f.provenance.parent_event_id == contact.transition.event_id
                && (f.from - contact.exit_position).length() < 1e-6
        })
        .expect("outgoing core segment must start at the plate exit");
    assert_eq!(
        core.provenance.start_s,
        Some(contact.transition.output.elapsed_s)
    );
    assert!(
        (core.provenance.physical.as_ref().unwrap().energy_j
            - contact.transition.budget.core_out_j)
            .abs()
            < 1e-3
    );
    assert!(r
        .impact_events
        .iter()
        .filter(|e| e.transition.verdict == impact::ImpactVerdict::Deposited)
        .all(|e| e.time_s > contact.transition.output.elapsed_s));
}

#[test]
fn invalid_kinetic_material_contact_preserves_targets_and_carrier() {
    for value in [f32::NAN,-1.0] {for field in 0..4 {
        let mut mat=rha();let mut def=box_tank(false).def;
        def.plates=vec![plate("front",ArmorZone::HullSide,50.0,[0.0,1.0,0.0],[0.0,0.0,-1.0],[1.0,0.0,0.0],1.0,1.0)];def.modules.clear();def.crew=vec![crew(CrewRole::Driver,[0.0,1.0,0.4])];
        match field {0=>mat[0].hardness_bhn=value,1=>mat[0].kinetic_factor=value,2=>mat[0].density_kg_m3=value,_=>def.plates[0].thickness_mm=value};
        let target=Target::new(def,&mat);let state=target.fresh_state();let mut p=ProjectileDef::generic_ap(10.0,150.0);p.mass_kg=0.1;
        let r=shoot(&target,&state,&Shot{shell:p,origin:Vec3::new(0.0,1.0,-2.0),dir:Vec3::new(0.0,0.0,1.0),speed_ms:100.0,distance_m:0.0,seed:1,turret_yaw:0.0});
        assert_eq!(r.state.crew,state.crew);assert!(r.fragments.is_empty());assert!(r.impact_events.is_empty());assert!(r.events.iter().any(|e|e=="rejected_impact_contact"));
        assert!((r.impact_state.unwrap().energy_j()-500.0).abs()<1e-3);
    }}
}

fn cursor_volume_shot(center_z: f32, half_z: f32) -> Report {
    let mut def = box_tank(false).def;
    def.turret = None;
    def.plates = vec![plate(
        "front",
        ArmorZone::HullSide,
        50.0,
        [0.0, 1.0, 0.0],
        [0.0, 0.0, -1.0],
        [1.0, 0.0, 0.0],
        1.0,
        1.0,
    )];
    def.modules = vec![
        module(
            "radio",
            ModuleKind::Radio,
            [0.0, 1.0, center_z],
            [0.1, 0.1, half_z],
            100.0,
        ),
        module(
            "later",
            ModuleKind::Radio,
            [0.0, 1.0, 0.3],
            [0.1, 0.1, 0.02],
            100.0,
        ),
    ];
    let mut first = crew(CrewRole::Driver, [0.0, 1.0, center_z]);
    first.radius = half_z;
    let mut later = crew(CrewRole::Gunner, [0.0, 1.0, 0.7]);
    later.radius = 0.02;
    def.crew = vec![first, later];
    let target = Target::new(def, &rha());
    let mut shell = ProjectileDef::generic_ap(10.0, 150.0);
    shell.mass_kg = 0.1;
    shell.normalization_deg = 0.0;
    shoot(
        &target,
        &target.fresh_state(),
        &Shot {
            shell,
            origin: Vec3::new(0.0, 1.0, -2.0),
            dir: Vec3::new(0.0, 0.0, 1.0),
            speed_ms: 100.0,
            distance_m: 0.0,
            seed: 1,
            turret_yaw: 0.0,
        },
    )
}

#[test]
fn primary_cursor_contacts_straddling_module_and_crew_once_at_exit() {
    let r = cursor_volume_shot(0.05, 0.03);
    let plate = &r.impact_events[0];
    let deposits: Vec<_> = r
        .impact_events
        .iter()
        .filter(|e| e.transition.verdict == impact::ImpactVerdict::Deposited)
        .collect();
    assert_eq!(deposits.len(), 4);
    for contact in &deposits[..2] {
        assert!(
            (contact.entry_position - plate.exit_position).length() < 1e-6,
            "straddling volume must be contacted at the actual cursor, {:?}",
            contact.entry_position
        );
        assert_eq!(contact.time_s, plate.transition.output.elapsed_s);
    }
    assert!(r
        .state
        .modules
        .iter()
        .chain(&r.state.crew)
        .all(|hp| *hp < 100.0));
    for f in r
        .fragments
        .iter()
        .filter(|f| f.provenance.source == impact::FragmentSource::Core)
    {
        assert!(
            (f.to - f.from).z >= -1e-7,
            "primary segment cannot reverse: {:?}->{:?}",
            f.from,
            f.to
        );
    }
    assert!(r
        .impact_events
        .windows(2)
        .all(|pair| pair[1].time_s >= pair[0].time_s));
    let last = deposits.last().unwrap();
    let tail = r
        .fragments
        .iter()
        .find(|f| f.hit.is_none() && f.provenance.parent_event_id == last.transition.event_id)
        .unwrap();
    let elapsed = last.transition.output.elapsed_s
        + (tail.to - tail.from).length() as f64
            / last.transition.output.velocity_m_s.length() as f64;
    assert!((r.impact_state.as_ref().unwrap().elapsed_s - elapsed).abs() < 1e-8);
}

#[test]
fn primary_cursor_ignores_module_and_crew_volumes_entirely_before_exit() {
    let r = cursor_volume_shot(0.02, 0.01);
    assert_eq!(
        r.state.modules[0], 100.0,
        "a wholly passed box is not a current contact"
    );
    assert_eq!(
        r.state.crew[0], 100.0,
        "a wholly passed sphere is not a current contact"
    );
    assert!(r.state.modules[1] < 100.0 && r.state.crew[1] < 100.0);
    assert_eq!(
        r.impact_events
            .iter()
            .filter(|e| e.transition.verdict == impact::ImpactVerdict::Deposited)
            .count(),
        2
    );
    assert!(
        (r.impact_state.as_ref().unwrap().remaining_pen_mm - (r.pen_mm as f64 - 50.0 - 3.0 - 5.0))
            .abs()
            < 1e-3
    );
}

#[test]
fn combat_report_old_json_defaults_and_new_mechanisms_roundtrip() {
    let t=box_tank(false);let r=shoot(&t,&t.fresh_state(),&side_shot(shell(ProjectileKind::Ap,75.0,6.8,200.0,0.0),1));
    let value=serde_json::to_value(&r).unwrap();
    let decoded:Report=serde_json::from_value(value.clone()).unwrap();
    assert_eq!(serde_json::to_value(decoded).unwrap(),value);
    let mut legacy=value;
    for key in ["mechanism_revision","impact_events","impact_state"]{legacy.as_object_mut().unwrap().remove(key);}
    for fragment in legacy["fragments"].as_array_mut().unwrap(){for key in ["fragment_id","parent_event_id","source","source_layer_or_module","physical","weight","start_s","profile","budget"]{fragment.as_object_mut().unwrap().remove(key);}}
    let legacy:Report=serde_json::from_value(legacy).unwrap();
    assert!(legacy.mechanism_revision.is_none());assert!(legacy.impact_events.is_empty());
    assert!(legacy.fragments.iter().all(|f|f.provenance.source==impact::FragmentSource::UnknownLegacy && f.provenance.physical.is_none()));
}

fn kinetic_test_fragment()->tg_damage::Fragment {
    let energy=20000.0;let mass=0.005;let velocity=Vec3::new(0.0,0.0,(2.0f64*energy/mass).sqrt() as f32);
    tg_damage::Fragment{origin:Vec3::new(0.0,1.0,0.0),dir:Vec3::new(0.0,0.0,1.0),energy_j:energy as f32,damage:0.0,is_penetrator:false,remaining_pen_mm:None,impact_state:None,
        provenance:FragmentProvenance{fragment_id:"spall:0".into(),parent_event_id:"plate:outer/traversal:0".into(),source:impact::FragmentSource::ArmourSpall,source_layer_or_module:Some("plate:outer".into()),physical:Some(impact::PhysicalFragment{mass_kg:mass,energy_j:energy,area_m2:None,velocity_m_s:velocity}),weight:1.0,start_s:Some(0.02),profile:Some(impact::ProfileReference{id:"test_allocation".into(),revision:impact::MECHANISM_REVISION.into(),source:impact::ProfileSource::Estimated})}}
}

#[test]
fn kinetic_fragment_serial_reports_match_segment_entry_and_collision_point() {
    let mut def=box_tank(false).def;def.plates.clear();def.modules=vec![module("radio",ModuleKind::Radio,[0.0,1.0,0.3],[0.05,0.05,0.05],1000.0)];def.crew=vec![crew(CrewRole::Driver,[0.0,1.0,1.0])];
    let t=Target::new(def,&rha());let mut w=work(&t,&t.fresh_state(),0.0);let f=kinetic_test_fragment();
    w.rep.fragments.clear();w.rep.impact_events.clear();w.kinetic_fragment(&f,2.0);
    let contacts:Vec<_>=w.rep.fragments.iter().filter(|f|f.budget.is_some()).collect();assert_eq!(contacts.len(),2);
    let first=contacts[0];let second=contacts[1];
    assert!((second.provenance.physical.as_ref().unwrap().energy_j-first.budget.unwrap().core_out_j).abs()<1e-3);
    assert_eq!(second.from,first.to);
    assert!(second.provenance.start_s.unwrap()>first.provenance.start_s.unwrap());
    for (segment,event) in contacts.iter().zip(&w.rep.impact_events) {
        assert_eq!(event.entry_position,segment.to);assert_eq!(event.exit_position,segment.to);
        let physical=segment.provenance.physical.as_ref().unwrap();physical.validate().unwrap();
        assert!((physical.energy_j-segment.budget.unwrap().input_j).abs()<1e-3);
    }
}

#[test]
fn distinct_nearby_main_plate_blocks_allocated_auxiliary_spall() {
    let mut def=box_tank(false).def;
    def.plates=vec![plate("main",ArmorZone::HullSide,200.0,[0.0,1.0,0.005],[0.0,0.0,-1.0],[1.0,0.0,0.0],1.0,1.0)];def.modules.clear();def.crew=vec![crew(CrewRole::Driver,[0.0,1.0,0.5])];
    let t=Target::new(def,&rha());let mut w=work(&t,&t.fresh_state(),0.0);
    w.kinetic_fragment(&kinetic_test_fragment(),2.0);
    assert_eq!(w.st.crew[0],100.0);
    assert!(w.rep.fragments.last().unwrap().to.z<=0.005001);
}

fn weapon_target(id: &str) -> Target {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data");
    let read = |f: &str| serde_json::from_str::<serde_json::Value>(&std::fs::read_to_string(root.join(f)).unwrap()).unwrap();
    let vehicle = read(&format!("vehicles/{id}/vehicle.json"));
    let def = target_from_files(id, &vehicle,
        serde_json::from_value(read(&format!("vehicles/{id}/armor.json"))).unwrap(),
        serde_json::from_value(read(&format!("vehicles/{id}/modules.json"))).unwrap(),
        serde_json::from_value(read(&format!("vehicles/{id}/crew.json"))).unwrap());
    let mut value = serde_json::to_value(def).unwrap();
    value["weapons"] = read(&format!("vehicles/{id}/weapons.json"));
    value["machine_guns"] = read("machine_guns.json");
    value["visual"] = read(&format!("vehicles/{id}/visual.json"));
    Target::new(serde_json::from_value(value).unwrap(), &rha())
}

fn weapon_caps_json(t: &Target, st: &TargetState) -> serde_json::Value {
    serde_json::to_value(caps(t, st)).unwrap()["weapons"].clone()
}

fn break_part(t: &Target, st: &mut TargetState, id: &str) {
    st.modules[t.def.modules.iter().position(|m| m.id == id).unwrap()] = 0.0;
}

#[test]
fn weapon_bindings_oplot_survives_main_breech_and_radar_damage() {
    let t = weapon_target("su_t10m");
    let mut st = t.fresh_state();
    break_part(&t, &mut st, "breech");
    break_part(&t, &mut st, "oplot_radar");
    let c = weapon_caps_json(&t, &st);
    assert_eq!(c["gun:0:0"]["can_fire"], false);
    assert_eq!(c["gun:1:0"]["can_fire"], true);
    assert!(caps(&t, &st).can_fire);
    break_part(&t, &mut st, "oplot_gun");
    assert_eq!(weapon_caps_json(&t, &st)["gun:1:0"]["can_fire"], false);
}

#[test]
fn weapon_bindings_duplicate_models_and_launcher_instances_are_independent() {
    for (id, part) in [("de_gepard", "breech"), ("su_bmpt34", "cannon_breech_01")] {
        let t = weapon_target(id);
        let mut st = t.fresh_state();
        break_part(&t, &mut st, part);
        let c = weapon_caps_json(&t, &st);
        assert_eq!(c["gun:0:0"]["can_fire"], false, "{id}");
        assert_eq!(c["gun:0:1"]["can_fire"], true, "{id}");
        if id == "su_bmpt34" {
            assert_eq!(c["gun:0:2"]["can_fire"], true);
            assert_eq!(c["gun:0:3"]["can_fire"], true);
            break_part(&t, &mut st, "launcher_tt250_rail_r");
            let c = weapon_caps_json(&t, &st);
            assert_eq!(c["gun:0:2"]["can_fire"], false);
            assert_eq!(c["gun:0:3"]["can_fire"], true);
            assert_eq!(c["gun:0:2"]["dispersion_mult"], 1.0);
        }
    }
}

#[test]
fn weapon_bindings_mg_survives_main_gun_damage_and_has_own_real_parts() {
    let t = weapon_target("de_hetzer");
    let original: Vec<Module> = serde_json::from_str(include_str!("../../../data/vehicles/de_hetzer/modules.json")).unwrap();
    assert!(t.def.modules.len() > original.len());
    assert_eq!(t.def.modules[..original.len()].iter().map(|m| &m.id).collect::<Vec<_>>(), original.iter().map(|m| &m.id).collect::<Vec<_>>());
    let mut st = t.fresh_state();
    break_part(&t, &mut st, "breech");
    assert_eq!(weapon_caps_json(&t, &st)["mg:roof_mg34"]["can_fire"], true);
    let mg: Vec<_> = t.def.modules.iter().enumerate().filter(|(_, m)| m.weapon_group.as_deref() == Some("mg:roof_mg34")).collect();
    assert_eq!(mg.len(), 2);
    assert!(mg.iter().all(|(_, m)| m.kind.as_str() == "machine_gun"));
    // Stockless receiver stays ahead of the renderer's -332mm seam.
    assert!(mg.iter().all(|(_, m)| m.center.z - m.half_extents.z >= -0.05 - 0.332 - 1e-5));
    st.modules[mg[0].0] = 0.0;
    assert_eq!(weapon_caps_json(&t, &st)["mg:roof_mg34"]["can_fire"], false);
    let again = Target::new(t.def.clone(), &rha());
    assert_eq!(serde_json::to_value(&again.def.modules).unwrap(), serde_json::to_value(&t.def.modules).unwrap());
}

#[test]
fn weapon_bindings_shared_drives_and_partial_damage_use_instance_curves() {
    let mut def = weapon_target("de_gepard").def;
    // Gepard itself has no loader seat; add one to exercise the legacy seat multiplier.
    def.crew.push(crew(CrewRole::Loader, [0.0, 2.0, 0.0]));
    let t = Target::new(def, &rha());
    let mut st = t.fresh_state();
    let set_ratio = |st: &mut TargetState, id: &str, ratio: f32| {
        let i = t.def.modules.iter().position(|m| m.id == id).unwrap();
        st.modules[i] = t.def.modules[i].max_health * ratio;
    };
    set_ratio(&mut st, "breech", 0.25);
    set_ratio(&mut st, "gun_barrel", 0.4);
    set_ratio(&mut st, "turret_drive", 0.25);
    set_ratio(&mut st, "ammo_drum", 0.25);
    let c = weapon_caps_json(&t, &st);
    assert_eq!(c["gun:0:0"]["dispersion_mult"], 1.5);
    assert_eq!(c["gun:0:1"]["dispersion_mult"], 1.0);
    for key in ["gun:0:0", "gun:0:1"] {
        assert!((c[key]["traverse_mult"].as_f64().unwrap() - 0.675).abs() < 1e-6);
        assert_eq!(c[key]["reload_mult"], 1.25);
    }
    st.rack_fill = vec![1.0; t.def.modules.len()];
    st.rack_fill[t.def.modules.iter().position(|m| m.id == "ammo_drum").unwrap()] = 0.0;
    assert_eq!(weapon_caps_json(&t, &st)["gun:0:0"]["reload_mult"], 1.0);
    for (i, c) in t.def.crew.iter().enumerate() { if c.role == CrewRole::Loader { st.crew[i] = 0.0; } }
    assert!((weapon_caps_json(&t, &st)["gun:0:0"]["reload_mult"].as_f64().unwrap() - 1.6).abs() < 1e-6);
}

#[test]
fn t72a_fitted_mechanical_caps_do_not_require_a_human_loader_and_follow_named_damage() {
    let t=weapon_target("su_t72a"); let mut st=t.fresh_state();
    let c=weapon_caps_json(&t,&st);
    assert_eq!(c["gun:0:0"]["mechanized"],true);
    assert_eq!(c["gun:0:0"]["reload_mult"],1.0);
    assert_eq!(c["gun:0:0"]["mechanism_available"],true);
    let i=t.def.modules.iter().position(|m|m.id=="az_drive").unwrap();
    st.modules[i]=t.def.modules[i].max_health*0.25;
    assert_eq!(weapon_caps_json(&t,&st)["gun:0:0"]["reload_mult"],1.25);
    st.modules[i]=0.0;
    assert_eq!(weapon_caps_json(&t,&st)["gun:0:0"]["mechanism_available"],false);
    // A chambered round may still fire; the failed drive blocks subsequent loading work.
    assert_eq!(weapon_caps_json(&t,&st)["gun:0:0"]["can_fire"],true);
}

#[test]
fn weapon_bindings_common_restrictions_and_legacy_defaults() {
    let t = weapon_target("su_t10m");
    for mode in 0..3 {
        let mut st = t.fresh_state();
        match mode { 0 => st.destroyed = true, 1 => st.repair_s = 1.0, _ => { for (i, c) in t.def.crew.iter().enumerate() { if c.role == CrewRole::Gunner { st.crew[i] = 0.0; } } } }
        let c = weapon_caps_json(&t, &st);
        assert_eq!(c["gun:0:0"]["can_fire"], false);
        assert_eq!(c["gun:1:0"]["can_fire"], false);
    }
    let legacy = narrow_turret_module(ModuleKind::GunBreech);
    let mut value = serde_json::to_value(&legacy.def).unwrap();
    value.as_object_mut().unwrap().remove("weapons");
    let old = Target::new(serde_json::from_value(value).unwrap(), &rha());
    assert_eq!(weapon_caps_json(&old, &old.fresh_state()), serde_json::json!({}));
    assert!(caps(&old, &old.fresh_state()).can_fire);
}

#[test]
fn weapon_bindings_every_fleet_and_workshop_mount_is_usable() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data/vehicles");
    let mut counts = (0, 0, 0);
    for e in std::fs::read_dir(root).unwrap().flatten() {
        let id = e.file_name().to_string_lossy().into_owned();
        let t = weapon_target(&id);
        let c = weapon_caps_json(&t, &t.fresh_state());
        let map = c.as_object().expect("ordered instance capabilities");
        for (key, value) in map { assert_eq!(value["can_fire"], true, "{id}/{key}: {value}"); }
        if id != "fun_hexa" {
            counts.0 += 1;
            counts.1 += map.keys().filter(|k| k.starts_with("gun:")).count();
            counts.2 += map.keys().filter(|k| k.starts_with("mg:")).count();
        } else { assert_eq!(map.keys().filter(|k| k.starts_with("gun:")).count(), 6); }
    }
    assert_eq!(counts, (46, 56, 49));
}

#[test]
fn weapon_bindings_rotated_long_barrel_tip_stays_in_broadphase() {
    let t=weapon_target("su_t10m");
    let i=t.def.modules.iter().position(|m| m.id=="gun_barrel").unwrap();
    let m=&t.def.modules[i];
    let pivot=t.def.turret.as_ref().unwrap().pivot;
    let yaw=std::f32::consts::FRAC_PI_2;
    let tip=pivot+rotate_yaw(m.center-pivot+Vec3::new(0.0,0.0,m.half_extents.z-0.05),yaw);
    assert!(tip.x<t.hi.x && tip.x>t.lo.x && tip.z<t.hi.z && tip.z>t.lo.z);
    let r=shoot(&t,&t.fresh_state(),&Shot {origin:tip+Vec3::new(0.0,5.0,0.0),dir:Vec3::new(0.0,-1.0,0.0),turret_yaw:yaw,..side_shot(ap(),1)});
    assert!(r.modules.iter().any(|m| m.id=="gun_barrel"));
}

#[test]
fn weapon_bindings_shared_critical_part_is_ambiguous_for_both_mounts() {
    let mut def=weapon_target("de_gepard").def;
    let p=def.weapons["mount_m"].clone();
    def.weapons["extra_guns"][0]["mount_m"]=p;
    def.modules.retain(|m| m.id!="breech_r" && m.id!="gun_barrel_r");
    let t=Target::new(def,&rha());
    let c=weapon_caps_json(&t,&t.fresh_state());
    for key in ["gun:0:0","gun:0:1"] {
        assert_eq!(c[key]["can_fire"],false);
        assert!(c[key]["reason"].as_str().unwrap().contains("ambiguous"));
    }
}

#[test]
fn weapon_bindings_feed_groups_only_affect_their_instance() {
    let mut def=weapon_target("de_gepard").def;
    let i=def.modules.iter().position(|m| m.id=="ammo_drum").unwrap();
    def.modules[i].weapon_group=Some("gun:0:0".into());
    let mut right=def.modules[i].clone(); right.id="ammo_right".into(); right.weapon_group=Some("gun:0:1".into());
    def.modules.push(right);
    let t=Target::new(def,&rha());
    let mut st=t.fresh_state(); st.modules[i]=t.def.modules[i].max_health*0.25;
    let c=weapon_caps_json(&t,&st);
    assert_eq!(c["gun:0:0"]["reload_mult"],1.25);
    assert_eq!(c["gun:0:1"]["reload_mult"],1.0);
}

#[test]
fn weapon_bindings_invalid_aps_turret_and_group_metadata_report_errors() {
    let mut def=weapon_target("su_t10m").def;
    def.weapons["aps"]["turret"]=serde_json::json!(0);
    let t=Target::new(def,&rha());
    assert!(t.binding_errors.contains_key("gun:0:0"));
    let mut def=weapon_target("de_gepard").def;
    def.weapons["damage"]=serde_json::json!({"traverse":["breech"]});
    let t=Target::new(def,&rha());
    assert!(t.binding_errors.contains_key("gun:0:0"),"wrong-kind drive reference must fail closed");
}

#[test]
fn weapon_bindings_instance_selection_is_unique_eligible_and_ammo_checked() {
    use crate::weapon_damage::select_weapon;
    let t=weapon_target("de_gepard");
    let mut st=t.fresh_state();
    assert!(select_weapon(&t,&st,None,Some("kda_35_gepard"),Some("hei_35_kda"),None).unwrap_err().contains("ambiguous"));
    assert_eq!(select_weapon(&t,&st,Some("gun:0:1"),Some("kda_35_gepard"),Some("hei_35_kda"),None).unwrap().key,"gun:0:1");
    assert!(select_weapon(&t,&st,Some("gun:0:1"),None,Some("foreign_shell"),None).is_err());
    assert!(select_weapon(&t,&st,Some("gun:0:9"),None,None,None).is_err());
    break_part(&t,&mut st,"breech");
    assert_eq!(select_weapon(&t,&st,None,Some("kda_35_gepard"),None,None).unwrap().key,"gun:0:1");
    let t=weapon_target("su_bmpt34");
    let st=t.fresh_state();
    assert!(select_weapon(&t,&st,None,None,None,Some("tt250_rocket")).unwrap_err().contains("ambiguous"));
    let binding=select_weapon(&t,&st,Some("gun:0:3"),None,None,Some("tt250_rocket")).unwrap();
    assert_eq!(binding.missile.as_deref(),Some("tt250_rocket"));
    assert_eq!(binding.model_id,"tt250_rail_l");
    assert!(select_weapon(&t,&st,Some("gun:0:0"),None,None,Some("tt250_rocket")).is_err());
}

#[test]
fn weapon_bindings_explicit_groups_and_module_refs_override_ambiguous_geometry() {
    let mut def=weapon_target("de_gepard").def;
    for m in &mut def.modules { if ["breech","gun_barrel"].contains(&m.id.as_str()) { m.weapon_group=Some("left_cannon".into()); } }
    def.weapons["weapon_group"]=serde_json::json!("left_cannon");
    def.weapons["extra_guns"][0]["damage"]=serde_json::json!({"critical":["breech_r","gun_barrel_r"]});
    def.weapons["extra_guns"][0]["mount_m"]=def.weapons["mount_m"].clone();
    let t=Target::new(def,&rha());
    assert!(t.binding_errors.is_empty(),"{:?}",t.binding_errors);
    let mut st=t.fresh_state(); break_part(&t,&mut st,"breech");
    assert!(!caps(&t,&st).weapons["gun:0:0"].can_fire);
    assert!(caps(&t,&st).weapons["gun:0:1"].can_fire);
}

#[test]
fn weapon_bindings_oplot_has_its_own_drives_and_cannon_curves() {
    let t=weapon_target("su_t10m");
    let mut st=t.fresh_state();
    break_part(&t,&mut st,"turret_drive"); break_part(&t,&mut st,"vertical_drive");
    let c=caps(&t,&st);
    assert_eq!(c.weapons["gun:0:0"].traverse_mult,0.15);
    assert_eq!(c.weapons["gun:0:0"].elevate_mult,0.3);
    assert_eq!(c.weapons["gun:1:0"].traverse_mult,1.0);
    assert_eq!(c.weapons["gun:1:0"].elevate_mult,1.0);
    let i=t.def.modules.iter().position(|m| m.id=="oplot_gun").unwrap();
    st.modules[i]=t.def.modules[i].max_health*0.25;
    assert_eq!(caps(&t,&st).weapons["gun:1:0"].dispersion_mult,1.5);
}

#[test]
fn weapon_bindings_mg_external_frame_and_origin_metadata_are_respected() {
    let hetzer=weapon_target("de_hetzer");
    let pivot=hetzer.def.modules.iter().find(|m| m.id=="mg:roof_mg34:receiver").unwrap().center;
    let i=hetzer.def.modules.iter().position(|m| m.id=="mg:roof_mg34:receiver").unwrap();
    assert_eq!(hetzer.posed(std::f32::consts::FRAC_PI_2).boxes[i].center,pivot,"Hetzer roof gun anchored to hull");
    let t=weapon_target("su_t54");
    for (i,m) in t.def.modules.iter().enumerate().filter(|(_,m)| m.kind.as_str()=="machine_gun") {
        if m.turret_index==Some(0) { assert_ne!(t.posed(std::f32::consts::FRAC_PI_2).boxes[i].center,m.center); }
        if m.id.contains("coax") && m.id.ends_with("receiver") {
            assert!(!m.is_external());
            let mut w=work(&t,&t.fresh_state(),0.0); w.blast_outside(m.center,0.001);
            assert_eq!(w.st.modules[i],m.max_health,"armoured coax receiver excludes outside blast");
        }
    }
}

#[test]
fn weapon_bindings_omitted_catalog_uses_shared_measured_geometry() {
    let supplied=weapon_target("su_t54");
    let mut def=supplied.def.clone();
    def.modules.retain(|m| m.kind.as_str()!="machine_gun");
    def.machine_guns=serde_json::Value::Null;
    let legacy=Target::new(def,&rha());
    assert!(legacy.binding_errors.is_empty(),"{:?}",legacy.binding_errors);
    assert_eq!(serde_json::to_value(&legacy.def.modules).unwrap(),serde_json::to_value(&supplied.def.modules).unwrap());
}

#[test]
fn weapon_bindings_stable_module_groups_resolve_same_pose_mounts() {
    let mut def=weapon_target("de_gepard").def;
    for m in &mut def.modules {
        if ["breech","gun_barrel"].contains(&m.id.as_str()) { m.weapon_group=Some("gun:0:0".into()); }
        if ["breech_r","gun_barrel_r"].contains(&m.id.as_str()) { m.weapon_group=Some("gun:0:1".into()); m.center.x=-0.84; }
    }
    def.weapons["extra_guns"][0]["mount_m"]=def.weapons["mount_m"].clone();
    let t=Target::new(def,&rha());
    assert!(t.binding_errors.is_empty(),"{:?}",t.binding_errors);
    let mut st=t.fresh_state(); break_part(&t,&mut st,"breech");
    assert!(!caps(&t,&st).weapons["gun:0:0"].can_fire);
    assert!(caps(&t,&st).weapons["gun:0:1"].can_fire);
}

#[test]
fn weapon_bindings_single_legacy_cannon_keeps_all_ungrouped_parts() {
    let mut def=weapon_target("de_hetzer").def;
    let mut segment=def.modules.iter().find(|m| m.id=="gun_barrel").unwrap().clone();
    segment.id="barrel_segment".into(); def.modules.push(segment);
    let t=Target::new(def,&rha());
    assert!(t.binding_errors.is_empty(),"{:?}",t.binding_errors);
    let mut st=t.fresh_state(); break_part(&t,&mut st,"barrel_segment");
    assert!(!caps(&t,&st).weapons["gun:0:0"].can_fire);
    assert!(caps(&t,&st).weapons["mg:roof_mg34"].can_fire);
}

#[test]
fn weapon_bindings_module_schema_accepts_runtime_rounds_and_frame_metadata() {
    let schema:serde_json::Value=serde_json::from_str(include_str!("../../../schemas/modules.schema.json")).unwrap();
    let props=&schema["items"]["properties"];
    assert_eq!(props["rounds"]["type"],"integer");
    assert_eq!(props["rounds"]["minimum"],0);
    assert_eq!(props["external"]["type"],"boolean");
    assert_eq!(props["turret_index"]["minimum"],0);
    for kind in [ModuleKind::MachineGun,ModuleKind::ApsGun,ModuleKind::ApsRadar,ModuleKind::Launcher] {
        assert!(props["kind"]["enum"].as_array().unwrap().iter().any(|v| v==kind.as_str()));
    }
    let mut value=serde_json::to_value(module("rack",ModuleKind::AmmoRack,[0.0,0.0,0.0],[0.1,0.1,0.1],40.0)).unwrap();
    assert_eq!(serde_json::from_value::<Module>(value.clone()).unwrap().rounds,None);
    for rounds in [0,42] { value["rounds"]=serde_json::json!(rounds); assert_eq!(serde_json::from_value::<Module>(value.clone()).unwrap().rounds,Some(rounds)); }
    value["rounds"]=serde_json::json!(-1); assert!(serde_json::from_value::<Module>(value.clone()).is_err());
    value["rounds"]=serde_json::json!(0.5); assert!(serde_json::from_value::<Module>(value).is_err());
}

fn workshop_binding_cases() -> serde_json::Value {
    let root=std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let code=r#"import {loadData} from './client/web/tools/load-data.mjs';
import {exportFolder,newTurretSpec,PRESETS} from './client/web/src/game/loadout.js';
import {decodeAllImported} from './client/web/src/gfx/imported.js';
const data=loadData(); await decodeAllImported(data.vehicles);
const builds={two_launchers:{base:'de_hetzer',keepStock:false,turrets:[{...newTurretSpec(),guns:[{weapon:'us_m901_itv'},{weapon:'us_m901_itv'}]}]},porcupine:PRESETS.porcupine.build,stock_aps:{base:'su_t10m',keepStock:true,turrets:[{...newTurretSpec(),guns:[{weapon:'us_m901_itv'}]}]}};
console.log(JSON.stringify(Object.fromEntries(Object.entries(builds).map(([key,build])=>[key,exportFolder(build,data,data.vehicles[build.base],key,key).files]))));"#;
    let output=std::process::Command::new("node").args(["--input-type=module","-e",code]).current_dir(root).output().unwrap();
    assert!(output.status.success(),"{}",String::from_utf8_lossy(&output.stderr));
    serde_json::from_slice(&output.stdout).unwrap()
}

#[test]
fn weapon_bindings_real_workshop_exports_and_legacy_imports_preserve_instances() {
    let cases=workshop_binding_cases();
    for legacy in [false,true] { for (key,source) in cases.as_object().unwrap() {
        let mut files=source.clone();
        if legacy {
            let strip=|m:&mut serde_json::Value| { m.as_object_mut().unwrap().remove("damage"); m.as_object_mut().unwrap().remove("weapon_group"); };
            strip(&mut files["weapons.json"]);
            for m in files["weapons.json"]["extra_guns"].as_array_mut().into_iter().flatten() { strip(m); }
            for t in files["weapons.json"]["extra_turrets"].as_array_mut().into_iter().flatten() { for m in t["guns"].as_array_mut().unwrap() { strip(m); } }
            for m in files["modules.json"].as_array_mut().unwrap() { m.as_object_mut().unwrap().remove("turret_index"); if m["kind"]!="launcher" { m.as_object_mut().unwrap().remove("weapon_group"); } }
        }
        let mut def=target_from_files(key,&files["vehicle.json"],serde_json::from_value(files["armor.json"].clone()).unwrap(),serde_json::from_value(files["modules.json"].clone()).unwrap(),serde_json::from_value(files["crew.json"].clone()).unwrap());
        def.weapons=files["weapons.json"].clone(); def.visual=files["visual.json"].clone();
        let t=Target::new(def,&rha());
        assert!(t.binding_errors.is_empty(),"{key}/legacy={legacy}: {:?}",t.binding_errors);
        let mut st=t.fresh_state();
        assert!(caps(&t,&st).weapons.values().all(|c| c.can_fire));
        if key=="two_launchers" { break_part(&t,&mut st,"launcher_t1_0"); assert!(!caps(&t,&st).weapons["gun:0:0"].can_fire); assert!(caps(&t,&st).weapons["gun:0:1"].can_fire); }
        if key=="porcupine" {
            break_part(&t,&mut st,"breech_t1_0"); assert!(caps(&t,&st).weapons["gun:0:0"].can_fire); assert!(!caps(&t,&st).weapons["gun:1:0"].can_fire); assert!(caps(&t,&st).weapons["gun:2:0"].can_fire);
            break_part(&t,&mut st,"turret_drive_t1"); let c=caps(&t,&st);
            assert_eq!(c.weapons["gun:0:0"].traverse_mult,1.0);assert_eq!(c.weapons["gun:1:0"].traverse_mult,0.15);assert_eq!(c.weapons["gun:2:0"].traverse_mult,1.0);
        }
        if key=="stock_aps" { break_part(&t,&mut st,"launcher_t1_0"); assert!(caps(&t,&st).weapons["gun:0:0"].can_fire); assert!(caps(&t,&st).weapons["gun:1:0"].can_fire); assert!(!caps(&t,&st).weapons["gun:2:0"].can_fire); }
    } }
}

#[test]
fn weapon_bindings_authored_secondary_groups_reuse_only_their_real_modules() {
    let mut def=weapon_target("de_hetzer").def;
    def.weapons["secondary"][0]["weapon_group"]=serde_json::json!("authored_roof_assembly");
    for m in &mut def.modules { if m.weapon_group.as_deref()==Some("mg:roof_mg34") {m.weapon_group=Some("authored_roof_assembly".into());m.id=format!("authored_{}",m.id);} }
    let count=def.modules.len();
    let t=Target::new(def.clone(),&rha());
    assert_eq!(t.def.modules.len(),count,"explicit groups must not duplicate measured MG modules");
    let mut st=t.fresh_state(); break_part(&t,&mut st,"authored_mg:roof_mg34:receiver");
    assert!(!caps(&t,&st).weapons["mg:roof_mg34"].can_fire);
    assert!(caps(&t,&st).weapons["gun:0:0"].can_fire);
    def.modules.iter_mut().find(|m| m.id=="authored_mg:roof_mg34:receiver").unwrap().kind=ModuleKind::GunBreech;
    assert!(Target::new(def,&rha()).binding_errors["mg:roof_mg34"].contains("wrong module kind"));
}

#[test]
fn weapon_bindings_explicit_missing_mg_group_fails_without_appending_parts() {
    let mut def=weapon_target("de_hetzer").def;
    def.weapons["secondary"][0]["weapon_group"]=serde_json::json!("missing_authored_assembly");
    let count=def.modules.len(); let t=Target::new(def,&rha());
    assert_eq!(t.def.modules.len(),count);
    assert!(t.binding_errors["mg:roof_mg34"].contains("missing explicit MG group"));
}

#[test]
fn weapon_bindings_main_gun_damage_refs_are_used_and_mount_refs_take_priority() {
    let mut def=weapon_target("de_gepard").def;
    def.weapons["main_gun"]["damage"]=serde_json::json!({"critical":["breech_r","gun_barrel_r"]});
    def.weapons["extra_guns"][0]["damage"]=serde_json::json!({"critical":["breech","gun_barrel"]});
    let t=Target::new(def.clone(),&rha());
    assert!(t.binding_errors.is_empty());
    let mut st=t.fresh_state();break_part(&t,&mut st,"breech_r");
    assert!(!caps(&t,&st).weapons["gun:0:0"].can_fire);assert!(caps(&t,&st).weapons["gun:0:1"].can_fire);
    def.weapons["damage"]=serde_json::json!({"critical":["breech","gun_barrel"]});
    def.weapons["extra_guns"][0]["damage"]=serde_json::json!({"critical":["breech_r","gun_barrel_r"]});
    let t=Target::new(def,&rha());let mut st=t.fresh_state();break_part(&t,&mut st,"breech_r");
    assert!(caps(&t,&st).weapons["gun:0:0"].can_fire);assert!(!caps(&t,&st).weapons["gun:0:1"].can_fire);
}

#[test]
fn quality_weapon_bindings_cannon_critical_requires_breech_and_barrel_kinds() {
    for refs in [serde_json::json!(["track_l"]),serde_json::json!(["gun_barrel"]),serde_json::json!(["breech"]),serde_json::json!(["oplot_gun"])] {
        let id=if refs[0]=="oplot_gun" {"su_t10m"} else {"de_gepard"};
        let mut def=weapon_target(id).def;
        def.weapons["damage"]=serde_json::json!({"critical":refs});
        let t=Target::new(def.clone(),&rha());
        assert!(t.binding_errors.contains_key("gun:0:0"),"invalid/partial cannon references must fail closed: {:?}",def.weapons["damage"]);
        let mut st=t.fresh_state();break_part(&t,&mut st,"breech");
        assert!(!caps(&t,&st).weapons["gun:0:0"].can_fire);
        let again=Target::new(def,&rha());assert_eq!(t.binding_errors,again.binding_errors,"stable registration error");
    }
}

#[test]
fn quality_weapon_bindings_missile_and_mg_critical_reject_other_module_kinds() {
    let mut def=weapon_target("su_bmpt34").def;
    let wrong=def.modules.iter().find(|m| m.kind==ModuleKind::Engine).unwrap().id.clone();
    def.weapons["extra_guns"][1]["damage"]=serde_json::json!({"critical":[wrong]});
    let t=Target::new(def,&rha());
    assert!(t.binding_errors.contains_key("gun:0:2"));
    let mut st=t.fresh_state();break_part(&t,&mut st,"launcher_tt250_rail_r");
    assert!(!caps(&t,&st).weapons["gun:0:2"].can_fire);
    assert!(caps(&t,&st).weapons["gun:0:3"].can_fire);
    let mut def=weapon_target("de_hetzer").def;
    def.weapons["secondary"][0]["weapon_group"]=serde_json::json!("authored_roof_assembly");
    for m in &mut def.modules { if m.weapon_group.as_deref()==Some("mg:roof_mg34") { m.weapon_group=Some("authored_roof_assembly".into()); if m.id.ends_with("receiver") {m.kind=ModuleKind::Track;} } }
    let count=def.modules.len();let t=Target::new(def,&rha());
    assert!(t.binding_errors.contains_key("mg:roof_mg34"));assert_eq!(t.def.modules.len(),count);
    assert!(!caps(&t,&t.fresh_state()).weapons["mg:roof_mg34"].can_fire);
}

#[test]
fn quality_weapon_bindings_independent_aps_critical_is_the_named_complete_gun() {
    let mut def=weapon_target("su_t10m").def;
    def.weapons["extra_turrets"][0]["guns"][0]["damage"]=serde_json::json!({"critical":["oplot_gun"]});
    let t=Target::new(def.clone(),&rha());assert!(t.binding_errors.is_empty());
    let mut st=t.fresh_state();break_part(&t,&mut st,"breech");break_part(&t,&mut st,"oplot_radar");
    assert!(caps(&t,&st).weapons["gun:1:0"].can_fire);
    for refs in [serde_json::json!(["oplot_radar"]),serde_json::json!(["breech","gun_barrel"])] {
        def.weapons["extra_turrets"][0]["guns"][0]["damage"]=serde_json::json!({"critical":refs});
        let t=Target::new(def.clone(),&rha());assert!(t.binding_errors.contains_key("gun:1:0"));assert!(!caps(&t,&t.fresh_state()).weapons["gun:1:0"].can_fire);
    }
}

#[test]
fn quality_weapon_bindings_drives_keep_full_instance_and_shared_turret_groups() {
    for (group,owners) in [(Some("gun:0:0"),[true,false]),(Some("gun:0:1"),[false,true]),(Some("left_assembly"),[true,false]),(Some("turret:0"),[true,true]),(None,[true,true])] {
        let mut def=weapon_target("de_gepard").def;
        if group==Some("left_assembly") {
            def.weapons["weapon_group"]=serde_json::json!("left_assembly");def.weapons["extra_guns"][0]["weapon_group"]=serde_json::json!("right_assembly");
            for m in &mut def.modules {
                if ["breech","gun_barrel"].contains(&m.id.as_str()) {m.weapon_group=Some("left_assembly".into());}
                if ["breech_r","gun_barrel_r"].contains(&m.id.as_str()) {m.weapon_group=Some("right_assembly".into());}
            }
        }
        def.modules.iter_mut().find(|m| m.id=="turret_drive").unwrap().weapon_group=group.map(String::from);
        let mut elevation=module("own_elevation",ModuleKind::VerticalDrive,[0.0,2.3,0.0],[0.1,0.1,0.1],60.0);elevation.weapon_group=group.map(String::from);def.modules.push(elevation);
        let t=Target::new(def,&rha());assert!(t.binding_errors.is_empty(),"{group:?}: {:?}",t.binding_errors);
        let mut st=t.fresh_state();break_part(&t,&mut st,"turret_drive");break_part(&t,&mut st,"own_elevation");
        let c=caps(&t,&st);
        for gi in 0..2 {let key=format!("gun:0:{gi}");assert_eq!(c.weapons[&key].traverse_mult,if owners[gi] {0.15} else {1.0},"{group:?}/{key}");assert_eq!(c.weapons[&key].elevate_mult,if owners[gi] {0.3} else {1.0},"{group:?}/{key}");assert!(c.weapons[&key].can_fire);}
    }
}

#[test]
fn quality_weapon_bindings_explicit_critical_cannot_borrow_an_errored_cannon_owner() {
    let mut def = weapon_target("de_gepard").def;
    for m in &mut def.modules {
        if ["breech_r", "gun_barrel_r"].contains(&m.id.as_str()) {
            m.weapon_group = Some("gun:0:1".into());
        }
    }
    def.weapons["damage"] = serde_json::json!({"critical":["breech_r","gun_barrel_r"]});
    def.weapons["extra_guns"][0]["damage"] = serde_json::json!({"critical":["missing_part"]});
    let t = Target::new(def.clone(), &rha());
    assert!(t.binding_errors.contains_key("gun:0:1"));
    assert!(t.binding_errors.contains_key("gun:0:0"), "foreign explicit ownership must fail even when its owner is invalid");
    assert!(!caps(&t, &t.fresh_state()).weapons["gun:0:0"].can_fire);
    assert_eq!(t.binding_errors, Target::new(def, &rha()).binding_errors);
}

#[test]
fn quality_weapon_bindings_explicit_critical_respects_declared_groups_and_turret_ownership() {
    for group in ["gun:0:0", "left_assembly"] {
        let mut def = weapon_target("de_gepard").def;
        for m in &mut def.modules {
            if ["breech", "gun_barrel"].contains(&m.id.as_str()) { m.weapon_group = Some(group.into()); }
        }
        if group == "left_assembly" { def.weapons["weapon_group"] = serde_json::json!(group); }
        def.weapons["damage"] = serde_json::json!({"critical":["breech","gun_barrel"]});
        let t = Target::new(def.clone(), &rha());
        assert!(t.binding_errors.is_empty(), "{group}: {:?}", t.binding_errors);
        assert!(caps(&t, &t.fresh_state()).weapons["gun:0:0"].can_fire);
        def.modules.iter_mut().find(|m| m.id == "breech").unwrap().turret_index = Some(1);
        assert!(Target::new(def, &rha()).binding_errors.contains_key("gun:0:0"), "a matching group cannot override an explicit foreign turret");
    }
    let mut def = weapon_target("de_gepard").def;
    def.modules.iter_mut().find(|m| m.id == "breech_r").unwrap().weapon_group = Some("right_assembly".into());
    def.weapons["damage"] = serde_json::json!({"critical":["breech_r","gun_barrel_r"]});
    def.weapons["extra_guns"][0]["damage"] = serde_json::json!({"critical":["missing_part"]});
    assert!(Target::new(def, &rha()).binding_errors.contains_key("gun:0:0"), "undeclared foreign author group must fail closed");
}

#[test]
fn quality_weapon_bindings_explicit_missile_critical_cannot_borrow_an_errored_owner() {
    let mut def = weapon_target("su_bmpt34").def;
    def.weapons["extra_guns"][1]["damage"] = serde_json::json!({"critical":["launcher_tt250_rail_r"]});
    assert!(Target::new(def.clone(), &rha()).binding_errors.is_empty(), "own conventional launcher group remains valid");
    def.weapons["extra_guns"][1]["damage"] = serde_json::json!({"critical":["launcher_tt250_rail_l"]});
    def.weapons["extra_guns"][2]["damage"] = serde_json::json!({"critical":["missing_part"]});
    let t = Target::new(def, &rha());
    assert!(t.binding_errors.contains_key("gun:0:3"));
    assert!(t.binding_errors.contains_key("gun:0:2"), "a foreign launcher assembly cannot be borrowed");
    assert!(!caps(&t, &t.fresh_state()).weapons["gun:0:2"].can_fire);
    assert!(caps(&t, &t.fresh_state()).weapons["gun:0:0"].can_fire);
}

#[test]
fn quality_weapon_bindings_named_aps_gun_rejects_foreign_explicit_ownership() {
    for field in ["group", "turret"] {
        let mut def = weapon_target("su_t10m").def;
        def.weapons["extra_turrets"][0]["guns"][0]["damage"] = serde_json::json!({"critical":["oplot_gun"]});
        let m = def.modules.iter_mut().find(|m| m.id == "oplot_gun").unwrap();
        if field == "group" { m.weapon_group = Some("gun:0:0".into()); } else { m.turret_index = Some(0); }
        let t = Target::new(def, &rha());
        assert!(t.binding_errors.contains_key("gun:1:0"), "named APS module still requires correct {field} ownership");
        assert!(!caps(&t, &t.fresh_state()).weapons["gun:1:0"].can_fire);
        assert!(caps(&t, &t.fresh_state()).weapons["gun:0:0"].can_fire);
    }
}

#[test]
fn quality_weapon_bindings_mg_cannot_borrow_a_foreign_reserved_owner_group() {
    let mut def = weapon_target("su_t54").def;
    let first = def.weapons["secondary"][0]["id"].as_str().unwrap().to_owned();
    let second = def.weapons["secondary"][1]["id"].as_str().unwrap().to_owned();
    let foreign = format!("mg:{second}");
    def.weapons["secondary"][0]["weapon_group"] = serde_json::json!(foreign);
    def.weapons["secondary"][1]["mount"] = serde_json::json!("invalid_mount");
    let count = def.modules.len();
    let t = Target::new(def, &rha());
    assert!(t.binding_errors.contains_key(&format!("mg:{second}")));
    assert!(t.binding_errors.contains_key(&format!("mg:{first}")), "reserved MG identity cannot be adopted as an author group");
    assert!(!caps(&t, &t.fresh_state()).weapons[&format!("mg:{first}")].can_fire);
    assert_eq!(t.def.modules.len(), count);
}

fn rha() -> Vec<Material> {
    vec![Material { id: "rha".into(), kind: ArmorKind::Rha, density_kg_m3: 7850.0, hardness_bhn: 300.0, kinetic_factor: 1.0, chemical_factor: 1.0 }]
}

fn plate(id: &str, zone: ArmorZone, mm: f32, c: [f32; 3], n: [f32; 3], u: [f32; 3], hu: f32, hv: f32) -> ArmorPlate {
    ArmorPlate { id: id.into(), zone, material: "rha".into(), thickness_mm: mm, center: Vec3::new(c[0], c[1], c[2]), normal: Vec3::new(n[0], n[1], n[2]), axis_u: Vec3::new(u[0], u[1], u[2]), half_u: hu, half_v: hv, curvature: 0.0, polygon: Vec::new(), hinge: None }
}

fn module(id: &str, kind: ModuleKind, c: [f32; 3], h: [f32; 3], hp: f32) -> Module {
    Module { id: id.into(), kind, center: Vec3::new(c[0], c[1], c[2]), half_extents: Vec3::new(h[0], h[1], h[2]), max_health: hp, health: hp, rounds: None, weapon_group: None, external: None, turret_index: None }
}

fn crew(role: CrewRole, p: [f32; 3]) -> Crew {
    Crew { role, pos: Vec3::new(p[0], p[1], p[2]), radius: 0.28, health: 100.0, also: Vec::new(), pose: None }
}

fn narrow_turret_module(kind: ModuleKind) -> Target {
    Target::new(TargetDef {
        surfaces:None,
        id: "narrow_turret".into(), plates: vec![],
        modules: vec![module("narrow", kind, [0.0, 1.0, 0.0], [0.1, 0.1, 1.0], 100.0)],
        crew: vec![], turret: Some(TurretGeom { pivot: Vec3::new(0.0, 0.5, 0.0), size: Vec3::new(2.0, 1.0, 2.0) }),
        open_top: false, ammo_capacity: 0, weapons: serde_json::Value::Null, machine_guns: serde_json::Value::Null, visual: serde_json::Value::Null,
    }, &rha())
}

fn work<'a>(t: &'a Target, st: &TargetState, yaw: f32) -> Work<'a> {
    let rep = shoot(t, st, &Shot { origin: Vec3::new(20.0, 20.0, 20.0), dir: Vec3::new(0.0, 1.0, 0.0), ..side_shot(ap(), 1) });
    Work { scene:None,context:None,t, p: t.posed(yaw), st: st.clone(), rng: Rng::new(1), rep,
        mod_dmg: HashMap::new(), crew_dmg: HashMap::new(), newly_destroyed: vec![], newly_killed: vec![] }
}

#[test]
fn rotated_barrel_empty_corner_is_not_a_direct_hit() {
    let t = narrow_turret_module(ModuleKind::GunBarrel);
    for yaw in [0.0, std::f32::consts::FRAC_PI_4, std::f32::consts::FRAC_PI_2] {
        let r = shoot(&t, &t.fresh_state(), &Shot {
            origin: Vec3::new(0.7, 10.0, -0.7), dir: Vec3::new(0.0, -1.0, 0.0), turret_yaw: yaw, ..side_shot(ap(), 1)
        });
        assert!(!r.hit && r.modules.is_empty(), "yaw {yaw}: the expanded box corner must miss");
        assert_eq!(r.state.modules, vec![100.0]);
    }
}

#[test]
fn rotated_barrel_true_volume_remains_a_direct_hit() {
    let t = narrow_turret_module(ModuleKind::GunBarrel);
    for yaw in [0.0, std::f32::consts::FRAC_PI_4, std::f32::consts::FRAC_PI_2] {
        let at = Vec3::new(0.0, 1.0, 0.0) + rotate_yaw(Vec3::new(0.0, 0.0, 0.8), yaw);
        let r = shoot(&t, &t.fresh_state(), &Shot {
            origin: at + Vec3::new(0.0, 9.0, 0.0), dir: Vec3::new(0.0, -1.0, 0.0), turret_yaw: yaw, ..side_shot(ap(), 1)
        });
        assert!(r.hit && r.modules.iter().any(|m| m.id == "narrow"), "yaw {yaw}: the true volume must hit");
    }
}

#[test]
fn fragment_ray_misses_rotated_empty_corner() {
    let t = narrow_turret_module(ModuleKind::GunBarrel);
    let mut w = work(&t, &t.fresh_state(), std::f32::consts::FRAC_PI_4);
    w.fragment(Vec3::new(0.7, 2.0, -0.7), Vec3::new(0.0, -1.0, 0.0), 8000.0, "spall", 4.0);
    assert_eq!(w.st.modules, vec![100.0]);
    assert!(w.rep.fragments.last().unwrap().hit.is_none());
}

#[test]
fn fragment_starting_in_expanded_corner_is_not_excluded_from_true_module() {
    let t = narrow_turret_module(ModuleKind::GunBarrel);
    let mut w = work(&t, &t.fresh_state(), std::f32::consts::FRAC_PI_4);
    w.fragment(Vec3::new(0.7, 1.0, -0.7), Vec3::new(-1.0, 0.0, 1.0).normalized(), 8000.0, "spall", 4.0);
    assert!(w.st.modules[0] < 100.0, "the fragment starts outside the actual oriented box");
    let mut inside = work(&t, &t.fresh_state(), std::f32::consts::FRAC_PI_4);
    inside.fragment(Vec3::new(0.0, 1.0, 0.0), Vec3::new(1.0, 0.0, 0.0), 8000.0, "spall", 4.0);
    assert_eq!(inside.st.modules[0], 100.0, "a fragment starting inside the true box is excluded");
}

#[test]
fn blast_distance_uses_rotated_box_for_external_and_internal_modules() {
    let corner = Vec3::new(0.7, 1.0, -0.7);
    let yaw = std::f32::consts::FRAC_PI_4;
    let t = narrow_turret_module(ModuleKind::GunBarrel);
    assert!(splash(&t, &t.fresh_state(), corner, 0.000001, yaw, 1).modules.is_empty());
    let t = narrow_turret_module(ModuleKind::GunBreech);
    let mut w = work(&t, &t.fresh_state(), yaw);
    w.blast_inside(corner, 0.001);
    assert_eq!(w.st.modules, vec![100.0]);
    w.blast_inside(Vec3::new(0.0, 1.0, 0.0), 0.001);
    assert!(w.st.modules[0] < 100.0);
}

#[test]
fn rotated_module_shields_crew_even_after_it_is_destroyed() {
    let mut def = narrow_turret_module(ModuleKind::GunBreech).def;
    def.crew = vec![crew(CrewRole::Driver, [0.0, -0.1, 0.0])];
    let t = Target::new(def, &rha());
    for health in [100.0, 0.0] {
        let mut st = t.fresh_state();
        st.modules[0] = health;
        let mut w = work(&t, &st, std::f32::consts::FRAC_PI_4);
        w.fragment(Vec3::new(0.0, 2.0, 0.0), Vec3::new(0.0, -1.0, 0.0), 8000.0, "spall", 4.0);
        assert_eq!(w.st.crew[0], 100.0);
        assert_eq!(w.rep.fragments.last().unwrap().hit.as_deref(), Some("narrow"));
    }
}

#[test]
fn excessive_and_repeated_direct_damage_records_only_actual_loss() {
    let t = narrow_turret_module(ModuleKind::GunBarrel);
    let shot = Shot { origin: Vec3::new(0.0, 10.0, 0.0), dir: Vec3::new(0.0, -1.0, 0.0), ..side_shot(ap(), 1) };
    let first = shoot(&t, &t.fresh_state(), &shot);
    assert_eq!(first.state.modules[0], 0.0);
    assert_eq!(first.modules[0].health, first.state.modules[0]);
    assert_eq!(first.modules[0].damage, 100.0);
    assert_eq!(first.fragments[0].damage, 100.0);
    assert_eq!(first.events.iter().filter(|e| *e == "barrel").count(), 1);
    let second = shoot(&t, &first.state, &shot);
    assert!(second.hit, "the destroyed physical barrel remains in the ray");
    assert_eq!(second.state.modules[0], 0.0);
    assert!(second.modules.is_empty() && !second.events.iter().any(|e| e == "barrel"));
    assert_eq!(second.fragments[0].damage, 0.0);
}

#[test]
fn repeated_fragment_damage_is_clamped_and_records_one_transition() {
    let t = narrow_turret_module(ModuleKind::GunBarrel);
    let mut st = t.fresh_state();
    st.modules[0] = 2.0;
    let mut w = work(&t, &st, 0.0);
    for _ in 0..3 { w.fragment(Vec3::new(0.0, 2.0, 0.0), Vec3::new(0.0, -1.0, 0.0), 8000.0, "spall", 4.0); }
    assert_eq!(w.st.modules[0], 0.0);
    assert_eq!(w.mod_dmg[&0], 2.0);
    assert_eq!(w.newly_destroyed, vec![0]);
    assert_eq!(w.rep.fragments.iter().map(|f| f.damage).sum::<f32>(), 2.0);
}

#[test]
fn excessive_crew_damage_reports_actual_loss_and_one_death() {
    let t = box_tank(false);
    let mut st = t.fresh_state(); st.crew[0] = 3.0;
    let mut w = work(&t, &st, 0.0);
    w.hurt_crew(0, 300.0); w.hurt_crew(0, 300.0);
    assert_eq!(w.st.crew[0], 0.0);
    assert_eq!(w.crew_dmg[&0], 3.0);
    assert_eq!(w.newly_killed, vec![0]);
}

#[test]
fn fire_clamps_health_and_emits_crew_death_once() {
    let t = box_tank(false);
    let mut st = t.fresh_state();
    st.modules[1] = 1.0; st.crew[0] = 1.0;
    st.fire_s = FIRE_S; st.fire_at = Some(Vec3::new(0.0, 1.0, 2.0));
    let first = advance(&t, &mut st, 1.0, 1);
    assert_eq!(st.modules[1], 0.0);
    assert_eq!(st.crew[0], 0.0);
    assert_eq!(first.iter().filter(|e| *e == "crew_burned:driver").count(), 1);
    assert!(!advance(&t, &mut st, 1.0, 1).iter().any(|e| e == "crew_burned:driver"));
}

#[test]
fn partially_damaged_engine_and_aim_drives_use_continuous_curves() {
    let mut def = box_tank(false).def;
    def.modules.push(module("elevation", ModuleKind::VerticalDrive, [0.0, 2.0, 0.0], [0.1, 0.1, 0.1], 80.0));
    let t = Target::new(def, &rha());
    let mut st = t.fresh_state();
    st.modules[0] = 0.25 * t.def.modules[0].max_health;
    st.modules[8] = 0.25 * t.def.modules[8].max_health;
    st.modules[9] = 0.25 * t.def.modules[9].max_health;
    let c = caps(&t, &st);
    assert!((c.engine_power - 0.8).abs() < 1e-6);
    assert!((c.traverse_mult - 0.675).abs() < 1e-6);
    assert!((c.elevate_mult - 0.75).abs() < 1e-6);
}

#[test]
fn drive_power_combines_engine_and_transmission_and_old_caps_deserialize() {
    let t = box_tank(false); let mut st = t.fresh_state();
    assert_eq!(caps(&t, &st).drive_power, 1.0);
    st.modules[0] = t.def.modules[0].max_health * 0.25;
    st.modules[1] = t.def.modules[1].max_health * 0.25;
    let c = caps(&t, &st);
    assert!((c.engine_power - 0.8).abs() < 1e-6);
    assert!((c.drive_power - 0.6).abs() < 1e-6);
    assert!(c.can_move);
    st.modules[1] = 0.0;
    assert_eq!(caps(&t, &st).drive_power, 0.0);
    assert!(!caps(&t, &st).can_move);
    let mut old = serde_json::to_value(c).unwrap();
    old.as_object_mut().unwrap().remove("drive_power");
    assert_eq!(serde_json::from_value::<Caps>(old).unwrap().drive_power, 1.0);
}

#[test]
fn rotated_module_centres_follow_a_translated_turret_pivot() {
    let mut def = narrow_turret_module(ModuleKind::GunBarrel).def;
    def.turret.as_mut().unwrap().pivot = Vec3::new(1.0, 0.5, 1.0);
    def.modules[0].center = Vec3::new(1.0, 1.0, 2.0);
    let t = Target::new(def, &rha());
    for yaw in [0.0, std::f32::consts::FRAC_PI_4, std::f32::consts::FRAC_PI_2] {
        let centre = Vec3::new(1.0, 1.0, 1.0) + rotate_yaw(Vec3::new(0.0, 0.0, 1.0), yaw);
        let r = shoot(&t, &t.fresh_state(), &Shot {
            origin: centre + Vec3::new(0.0, 9.0, 0.0), dir: Vec3::new(0.0, -1.0, 0.0), turret_yaw: yaw, ..side_shot(ap(), 1)
        });
        assert!(r.hit && r.modules.len() == 1);
    }
}

#[test]
fn field_repair_does_not_refill_empty_racks_or_put_out_a_fire() {
    let t = box_tank(false); let mut st = t.fresh_state();
    st.rack_fill = vec![1.0; st.modules.len()]; st.rack_fill[3] = 0.0;
    st.fire_at = Some(t.def.modules[3].center); st.fire_s = FIRE_S;
    st.modules[0] = 0.0;
    assert!(start_repair(&t, &mut st));
    advance(&t, &mut st, 10.0, 1);
    assert_eq!(st.rack(3), 0.0);
    assert_eq!(st.modules[3], t.def.modules[3].max_health);
    assert_eq!(st.fire_s, FIRE_S - 10.0);
    assert!(!st.ammo_detonated);
}

#[test]
fn partially_damaged_modules_can_be_repaired_with_weighted_duration() {
    let t = box_tank(false); let mut st = t.fresh_state();
    st.modules[0] = 0.3 * t.def.modules[0].max_health;
    st.crew[4] = 0.0;
    assert!(start_repair(&t, &mut st));
    assert!((st.repair_s - 10.0).abs() < 1e-5);
    assert_eq!(serde_json::to_value(&st).unwrap()["repair_targets"], serde_json::json!([0]));
    assert!(!caps(&t, &st).can_move && !caps(&t, &st).can_fire);
    let duration = st.repair_s;
    assert_eq!(advance(&t, &mut st, duration, 1).iter().filter(|e| *e == "repaired").count(), 1);
    assert!((st.modules[0] - 0.6 * t.def.modules[0].max_health).abs() < 1e-5);
    assert!(!start_repair(&t, &mut st), "the 60% repair cap is not a full-health refill");
}

#[test]
fn repair_only_restores_original_targets_and_does_not_reset_when_hit() {
    let t = box_tank(false); let mut st = t.fresh_state();
    st.modules[0] = 0.0;
    assert!(start_repair(&t, &mut st));
    assert_eq!(st.repair_s, 10.0);
    advance(&t, &mut st, 3.0, 1);
    st.modules[1] = 0.0;
    assert!(!start_repair(&t, &mut st));
    assert_eq!(st.repair_s, 7.0);
    advance(&t, &mut st, 7.0, 1);
    assert_eq!(st.modules[0], t.def.modules[0].max_health * 0.6);
    assert_eq!(st.modules[1], 0.0, "new damage on an unrelated module is not part of this repair");
}

#[test]
fn repair_targets_survive_serialization_and_keep_later_hits_on_the_same_target() {
    let t = box_tank(false); let mut st = t.fresh_state();
    st.modules[0] = t.def.modules[0].max_health * 0.3;
    assert!(start_repair(&t, &mut st));
    advance(&t, &mut st, 2.0, 1);
    let st: TargetState = serde_json::from_value(serde_json::to_value(st).unwrap()).unwrap();
    let mut w = work(&t, &st, 0.0); w.hurt_module(0, 400.0, 0.0);
    assert_eq!(w.st.repair_s, 6.0);
    let mut st = w.st; advance(&t, &mut st, 6.0, 1);
    assert_eq!(st.modules[0], t.def.modules[0].max_health * 0.6);
}

#[test]
fn repair_cancels_after_abandonment_or_insufficient_crew() {
    let t = box_tank(false);
    for abandoned in [false, true] {
        let mut st = t.fresh_state(); st.modules[0] = 0.0;
        assert!(start_repair(&t, &mut st));
        if abandoned { st.destroyed = true; } else { for health in st.crew.iter_mut().skip(1) { *health = 0.0; } }
        assert!(!advance(&t, &mut st, 20.0, 1).iter().any(|e| e == "repaired"));
        assert_eq!(st.repair_s, 0.0);
        assert_eq!(st.modules[0], 0.0);
        assert!(serde_json::to_value(&st).unwrap()["repair_targets"].is_null());
    }
}

#[test]
fn repair_excludes_ammo_and_preserves_empty_racks_and_old_completion() {
    let t = box_tank(false); let mut st = t.fresh_state();
    st.modules[3] = 0.0; st.rack_fill = vec![1.0; st.modules.len()]; st.rack_fill[3] = 0.0;
    assert!(!start_repair(&t, &mut st));
    st.modules[0] = 0.0;
    assert!(start_repair(&t, &mut st));
    advance(&t, &mut st, 10.0, 1);
    assert_eq!(st.modules[3], 0.0); assert_eq!(st.rack(3), 0.0);
    let mut old = serde_json::to_value(t.fresh_state()).unwrap();
    old.as_object_mut().unwrap().remove("repair_targets");
    old["repair_s"] = serde_json::json!(1.0); old["modules"][0] = serde_json::json!(0.0); old["modules"][1] = serde_json::json!(1.0);
    let mut old: TargetState = serde_json::from_value(old).unwrap();
    advance(&t, &mut old, 1.0, 1);
    assert_eq!(old.modules[0], t.def.modules[0].max_health * 0.6);
    assert_eq!(old.modules[1], t.def.modules[1].max_health * 0.6);
}

#[test]
fn all_destroyed_repairable_modules_preserve_original_duration() {
    let t = box_tank(false); let mut st = t.fresh_state();
    st.modules.fill(0.0); st.crew[4] = 0.0;
    assert!(start_repair(&t, &mut st));
    assert_eq!(st.repair_s, 6.0 + 4.0 * 8.0 + 2.0);
}

#[test]
fn launcher_apparatus_has_its_own_damage_kind_and_disables_firing_when_destroyed() {
    let kind: ModuleKind = serde_json::from_str("\"launcher\"").expect("launcher apparatus must deserialize independently of cannon parts");
    assert_eq!(kind.as_str(), "launcher");
    assert!(kind.is_external(), "launch apparatus is exposed to direct impacts");
    let mut target = box_tank(false).def;
    target.modules.retain(|m| !matches!(m.kind, ModuleKind::GunBreech | ModuleKind::GunBarrel));
    target.modules.push(module("launcher", kind, [0.0, 2.5, 0.0], [0.4, 0.1, 0.5], 70.0));
    let target = Target::new(target, &rha());
    let mut state = target.fresh_state();
    assert!(caps(&target, &state).can_fire);
    let index = target.def.modules.len() - 1;
    state.modules[index] = 0.0;
    assert!(!caps(&target, &state).can_fire);
    let mods = target.def.modules.iter().enumerate().map(|(i, m)| { let mut m = m.clone(); m.health = state.modules[i]; m }).collect::<Vec<_>>();
    assert!(!tg_damage::capabilities(&mods, &target.def.crew).can_fire);
    assert!(!caps(&target, &state).ammo_detonated, "apparatus damage does not manufacture a warhead detonation");
    state.modules[index] = 70.0;
    assert!(caps(&target, &state).can_fire);
}

/// A box tank: hull 3 m wide, 6 m long, 0.4..1.8 m high; turret 2 x 2.4 x 0.9 on top.
fn box_tank(open_top: bool) -> Target {
    let x = [1.0, 0.0, 0.0];
    let z = [0.0, 0.0, 1.0];
    let y = [0.0, 1.0, 0.0];
    let mut plates = vec![
        plate("hull_front", ArmorZone::HullUpperFront, 80.0, [0.0, 1.1, 3.0], [0.0, 0.0, 1.0], x, 1.5, 0.7),
        plate("hull_rear", ArmorZone::HullRear, 30.0, [0.0, 1.1, -3.0], [0.0, 0.0, -1.0], x, 1.5, 0.7),
        plate("hull_side_l", ArmorZone::HullSide, 40.0, [-1.5, 1.1, 0.0], [-1.0, 0.0, 0.0], z, 3.0, 0.7),
        plate("hull_side_r", ArmorZone::HullSide, 40.0, [1.5, 1.1, 0.0], [1.0, 0.0, 0.0], z, 3.0, 0.7),
        plate("hull_floor", ArmorZone::HullFloor, 15.0, [0.0, 0.4, 0.0], [0.0, -1.0, 0.0], x, 1.5, 3.0),
    ];
    if !open_top {
        plates.push(plate("hull_roof", ArmorZone::HullRoof, 12.0, [0.0, 1.8, 0.0], [0.0, 1.0, 0.0], x, 1.5, 3.0));
        plates.extend([
            plate("turret_front", ArmorZone::TurretFront, 100.0, [0.0, 2.25, 1.2], [0.0, 0.0, 1.0], x, 1.0, 0.45),
            plate("turret_rear", ArmorZone::TurretRear, 45.0, [0.0, 2.25, -1.2], [0.0, 0.0, -1.0], x, 1.0, 0.45),
            plate("turret_side_l", ArmorZone::TurretSide, 50.0, [-1.0, 2.25, 0.0], [-1.0, 0.0, 0.0], z, 1.2, 0.45),
            plate("turret_side_r", ArmorZone::TurretSide, 50.0, [1.0, 2.25, 0.0], [1.0, 0.0, 0.0], z, 1.2, 0.45),
            plate("turret_roof", ArmorZone::TurretRoof, 10.0, [0.0, 2.7, 0.0], y, x, 1.0, 1.2),
        ]);
    }
    let modules = vec![
        module("engine", ModuleKind::Engine, [0.0, 1.0, -2.0], [0.6, 0.45, 0.7], 160.0),
        module("transmission", ModuleKind::Transmission, [0.0, 0.8, 2.4], [0.5, 0.3, 0.4], 130.0),
        module("fuel_l", ModuleKind::FuelTank, [-1.1, 1.2, -1.6], [0.3, 0.3, 0.5], 50.0),
        module("ammo_r", ModuleKind::AmmoRack, [1.15, 1.0, 0.2], [0.25, 0.35, 0.6], 40.0),
        module("breech", ModuleKind::GunBreech, [0.0, 2.2, 0.4], [0.2, 0.15, 0.5], 120.0),
        module("barrel", ModuleKind::GunBarrel, [0.0, 2.2, 3.2], [0.08, 0.08, 1.9], 110.0),
        module("track_l", ModuleKind::Track, [-1.75, 0.45, 0.0], [0.25, 0.45, 3.2], 90.0),
        module("track_r", ModuleKind::Track, [1.75, 0.45, 0.0], [0.25, 0.45, 3.2], 90.0),
        module("turret_drive", ModuleKind::TurretDrive, [0.5, 1.95, -0.3], [0.15, 0.12, 0.15], 60.0),
    ];
    let crew = vec![
        crew(CrewRole::Driver, [-0.6, 1.1, 1.9]),
        crew(CrewRole::RadioOperator, [0.6, 1.1, 1.9]),
        crew(CrewRole::Gunner, [-0.45, 2.1, 0.3]),
        crew(CrewRole::Commander, [-0.45, 2.3, -0.6]),
        crew(CrewRole::Loader, [0.45, 2.0, -0.2]),
    ];
    let def = TargetDef {surfaces:None, id: "box".into(), plates, modules, crew, turret: Some(TurretGeom { pivot: Vec3::new(0.0, 1.8, 0.0), size: Vec3::new(2.0, 0.9, 2.4) }), open_top, ammo_capacity: 0, weapons: serde_json::Value::Null, machine_guns: serde_json::Value::Null, visual: serde_json::Value::Null };
    Target::new(def, &rha())
}

fn shell(kind: ProjectileKind, cal: f32, mass: f32, pen: f32, filler: f32) -> ProjectileDef {
    ProjectileDef {
        id: format!("{:?}", kind).to_lowercase(),
        name: "test".into(),
        kind,
        caliber_mm: cal,
        mass_kg: mass,
        muzzle_velocity_ms: 800.0,
        explosive_mass_kg: filler,
        explosive_type: "tnt".into(),
        penetrator_material: "steel".into(),
        length_mm: 300.0,
        drag_coefficient: 0.3,
        penetration_curve: vec![CurvePoint { distance_m: 0.0, pen_mm: pen }, CurvePoint { distance_m: 2000.0, pen_mm: pen }],
        ricochet_angle_deg: 70.0,
        normalization_deg: 4.0,
        shatter_angle_deg: 90.0,
        fuse_delay_s: 0.0012,
        fuse_sensitivity_mm: 15.0,
    }
}

fn ap() -> ProjectileDef {
    shell(ProjectileKind::Apcbc, 75.0, 6.8, 110.0, 0.0)
}
fn aphe() -> ProjectileDef {
    shell(ProjectileKind::Aphe, 85.0, 9.2, 120.0, 0.048)
}
fn he() -> ProjectileDef {
    shell(ProjectileKind::He, 75.0, 6.3, 10.0, 0.68)
}

/// From the right, level, at the middle of the hull side.
fn side_shot(s: ProjectileDef, seed: u64) -> Shot {
    Shot { shell: s, origin: Vec3::new(30.0, 1.15, 0.1), dir: Vec3::new(-1.0, 0.0, 0.0), speed_ms: 700.0, distance_m: 500.0, seed, turret_yaw: 0.0 }
}

#[test]
fn solid_shot_through_the_side_sprays_spall_and_hurts_what_is_inside() {
    let t = box_tank(false);
    let st = t.fresh_state();
    let r = shoot(&t, &st, &side_shot(ap(), 7));
    assert_eq!(r.outcome, Outcome::Penetrated);
    assert_eq!(r.plate.as_deref(), Some("hull_side_r"));
    assert!(r.layers[0].passed && r.layers[0].angle_deg < 1.0);
    assert!(r.fragments.iter().filter(|f| f.kind == "spall").count() >= 5);
    // the ammunition beside the right wall is right behind the plate
    assert!(r.modules.iter().any(|m| m.id == "ammo_r"));
    assert!(r.bursts.is_empty());
    // the state carries over: the next shot finds the damage already done
    assert!(r.state.modules[3] < 40.0);
    assert_eq!(r.path.first().copied(), r.impact);
}

#[test]
fn thick_front_stops_the_round_and_steep_hits_glance_off() {
    let t = box_tank(false);
    let st = t.fresh_state();
    let front = Shot { origin: Vec3::new(0.3, 1.1, 40.0), dir: Vec3::new(0.0, 0.0, -1.0), ..side_shot(shell(ProjectileKind::Apcbc, 75.0, 6.8, 70.0, 0.0), 3) };
    let r = shoot(&t, &st, &front);
    assert_eq!(r.outcome, Outcome::Stopped);
    assert!(r.modules.is_empty() && r.crew.is_empty());
    assert_eq!(r.title, "未擊穿");
    // 75 degrees off the side plate's normal
    let a = 75f32.to_radians();
    let glance = Shot { origin: Vec3::new(1.5 + 20.0 * a.cos(), 1.1, 20.0 * a.sin()), dir: Vec3::new(-a.cos(), 0.0, -a.sin()), ..side_shot(ap(), 3) };
    let r = shoot(&t, &st, &glance);
    assert_eq!(r.outcome, Outcome::Ricochet);
    assert!(r.ricochet_dir.unwrap().x > 0.0);
}

#[test]
fn aphe_bursts_inside_and_kills_more_than_solid_shot() {
    let t = box_tank(false);
    let st = t.fresh_state();
    let turret_side = |s: ProjectileDef, seed| Shot { origin: Vec3::new(30.0, 2.2, 0.0), dir: Vec3::new(-1.0, 0.0, 0.0), ..side_shot(s, seed) };
    let (mut solid, mut burst) = (0usize, 0usize);
    for seed in 1..40u64 {
        let r = shoot(&t, &st, &turret_side(aphe(), seed));
        assert!(r.bursts.iter().any(|b| b.inside), "seed {seed}: {:?}", r.events);
        burst += r.crew.iter().filter(|c| c.killed).count();
        let r = shoot(&t, &st, &turret_side(ap(), seed));
        solid += r.crew.iter().filter(|c| c.killed).count();
    }
    assert!(burst > solid, "aphe {burst} vs solid {solid}");
}

#[test]
fn aphe_through_thin_plate_does_not_start_its_fuse() {
    let t = box_tank(false);
    let st = t.fresh_state();
    // straight down through the 10 mm turret roof: under the 15 mm sensitivity
    let r = shoot(&t, &st, &Shot { origin: Vec3::new(0.2, 20.0, 0.5), dir: Vec3::new(0.0, -1.0, 0.0), ..side_shot(aphe(), 5) });
    assert_eq!(r.plate.as_deref(), Some("turret_roof"));
    assert!(r.bursts.iter().all(|b| !b.inside || r.layers.iter().any(|l| l.thickness_mm >= 15.0 && l.passed)));
}

fn delayed_aphe_target(kind: Option<ModuleKind>) -> Target {
    let mut def = box_tank(false).def;
    def.modules.clear();
    def.crew.clear();
    if let Some(kind) = kind {
        def.modules.push(module("fuse_test_stop", kind,
            [0.9, 1.15, 0.1], [0.1, 0.1, 0.1], 1000.0));
    }
    Target::new(def, &rha())
}

#[test]
fn delayed_aphe_armed_shell_stopped_inside_keeps_one_timed_detonation() {
    let target = delayed_aphe_target(Some(ModuleKind::Engine));
    let mut round = shell(ProjectileKind::Aphe, 50.0, 2.06, 65.0, 0.017);
    round.fuse_delay_s = 0.02;
    let report = shoot(&target, &target.fresh_state(), &side_shot(round, 4));
    let stop = report.impact_events.iter()
        .find(|e| e.transition.layer_id.contains("module:fuse_test_stop")).unwrap();
    assert_eq!(stop.transition.output.remaining_pen_mm, 0.0);
    assert_eq!(report.bursts.len(), 1, "armed stopped shell lost/duplicated filler burst");
    let burst = &report.bursts[0];
    assert!(burst.inside);
    assert!((burst.pos-stop.exit_position).length() < 1e-5);
    assert!((burst.explosive_kg-0.017).abs() < 1e-6);
    let evidence = serde_json::to_value(&report).unwrap();
    let burst = &evidence["bursts"][0];
    let time = burst["time_s"].as_f64().expect("record actual APHE detonation time");
    let armed = burst["armed_at_s"].as_f64().unwrap();
    assert!((time-armed-0.02).abs() < 1e-6);
    assert_eq!(burst["mechanism"], "delayed_aphe");
    assert_eq!(burst["detonation_id"], "core/charge:0/detonation:0");
    assert_eq!(evidence["impact_state"]["fuse"], "detonated");
    assert_eq!(evidence["impact_state"]["charge"]["disposition"], "released");
    assert!(evidence["fragments"].as_array().unwrap().iter()
        .filter(|f| f["kind"] == "burst")
        .all(|f| f["start_s"].as_f64() == Some(time)));
}

#[test]
fn delayed_aphe_fuse_uses_current_residual_speed_after_internal_contact() {
    let target = delayed_aphe_target(Some(ModuleKind::GunBreech));
    let mut round = aphe();
    round.fuse_delay_s = 0.003;
    let report = shoot(&target, &target.fresh_state(), &side_shot(round, 8));
    let contact = report.impact_events.iter()
        .find(|e| e.transition.layer_id.contains("module:fuse_test_stop")).unwrap();
    assert!(contact.transition.output.remaining_pen_mm > 0.0);
    let data = serde_json::to_value(&report).unwrap();
    let burst = &data["bursts"][0];
    let time = burst["time_s"].as_f64().expect("fuse time is physical evidence");
    let armed = burst["armed_at_s"].as_f64().unwrap();
    assert!((time-armed-0.003).abs() < 1e-6);
    let after = &contact.transition.output;
    let remaining = (time-after.elapsed_s) as f32;
    assert!(remaining > 0.0);
    let expected = contact.exit_position+after.velocity_m_s*remaining;
    assert!((report.bursts[0].pos-expected).length() < 1e-4,
        "burst drifted from residual velocity: {:?} expected {:?}", report.bursts[0].pos, expected);
}

#[test]
fn delayed_aphe_overpenetration_keeps_armed_exit_without_inventing_outside_burst() {
    let target = delayed_aphe_target(None);
    let mut round = shell(ProjectileKind::Aphe, 85.0, 9.2, 220.0, 0.048);
    round.fuse_delay_s = 0.02;
    let report = shoot(&target, &target.fresh_state(), &side_shot(round, 6));
    assert!(report.events.iter().any(|e| e == "overpenetration"));
    assert!(report.bursts.is_empty(), "unknown future world collisions cannot be extrapolated");
    let data = serde_json::to_value(&report).unwrap();
    assert_eq!(data["impact_state"]["fuse"], "armed");
    assert_eq!(data["impact_state"]["charge"]["disposition"], "contained");
    assert!(report.events.iter().any(|e| e == "aphe_armed_exit_continuation_unresolved"));
}

#[test]
fn delayed_aphe_unarmed_thin_plate_and_solid_shot_never_release_filler() {
    let mut def = delayed_aphe_target(None).def;
    for plate in &mut def.plates { plate.thickness_mm = 5.0; }
    let target = Target::new(def, &rha());
    for round in [aphe(), ap()] {
        let report = shoot(&target, &target.fresh_state(), &side_shot(round, 9));
        assert!(report.bursts.is_empty());
        let data = serde_json::to_value(&report).unwrap();
        assert_eq!(data["impact_state"]["fuse"], "unarmed");
    }
}

#[test]
fn delayed_aphe_destructive_shatter_marks_fuze_failed_without_burst() {
    let def = delayed_aphe_target(None).def;
    let mut materials = rha();
    materials[0].hardness_bhn = 400.0;
    let target = Target::new(def, &materials);
    let mut round = aphe();
    round.shatter_angle_deg = 0.0;
    let report = shoot(&target, &target.fresh_state(), &side_shot(round, 4));
    assert_eq!(report.outcome, Outcome::Shattered);
    assert!(report.bursts.is_empty());
    let data = serde_json::to_value(&report).unwrap();
    assert_eq!(data["impact_state"]["fuse"], "failed");
    assert_eq!(data["impact_state"]["charge"]["disposition"], "failed");
}

#[test]
fn he_bursts_outside_heavy_armour_but_wrecks_the_track_it_lands_on() {
    let t = box_tank(false);
    let st = t.fresh_state();
    let r = shoot(&t, &st, &side_shot(he(), 9));
    assert_eq!(r.outcome, Outcome::Blast);
    assert!(r.crew.is_empty(), "a closed vehicle's crew is safe from an outside burst");
    // low on the side: the burst is on the track itself
    let low = Shot { origin: Vec3::new(30.0, 0.5, 0.0), ..side_shot(he(), 9) };
    let r = shoot(&t, &st, &low);
    assert!(r.events.iter().any(|e| e == "track_right"), "{:?}", r.events);
    assert!(!r.caps.track_right && r.caps.track_left);
    assert_eq!(r.title, "右履帶斷裂");
}

#[test]
fn big_he_breaks_in_through_thin_roof_armour() {
    let t = box_tank(false);
    let st = t.fresh_state();
    let big = shell(ProjectileKind::He, 152.0, 43.0, 45.0, 5.9);
    let r = shoot(&t, &st, &Shot { origin: Vec3::new(-0.3, 20.0, 0.0), dir: Vec3::new(0.0, -1.0, 0.0), ..side_shot(big, 2) });
    assert_eq!(r.outcome, Outcome::Overpressure);
    assert!(r.crew.iter().filter(|c| c.killed).count() >= 2, "{:?}", r.crew);
    assert!(he_pen_mm(0.68) > 9.0 && he_pen_mm(0.68) < 11.0);
    assert!(he_pen_mm(3.6) > 29.0 && he_pen_mm(3.6) < 33.0);
}

#[test]
fn a_dead_engine_stops_the_vehicle_until_it_is_repaired() {
    let t = box_tank(false);
    let st = t.fresh_state();
    // from behind, through the 30 mm rear plate into the engine
    let r = shoot(&t, &st, &Shot { origin: Vec3::new(0.0, 1.0, -30.0), dir: Vec3::new(0.0, 0.0, 1.0), ..side_shot(ap(), 4) });
    assert!(r.events.iter().any(|e| e == "engine"), "{:?}", r.events);
    assert!(!r.caps.can_move && r.caps.engine_power == 0.0);
    let mut s = r.state.clone();
    assert!(start_repair(&t, &mut s));
    assert!(!caps(&t, &s).can_move, "no driving off while the crew is at work");
    let total = s.repair_s;
    let mut done = false;
    let mut k = 0;
    while k < 1000 && !done {
        done = advance(&t, &mut s, 0.5, k).iter().any(|e| e == "repaired");
        k += 1;
    }
    assert!(done && (k as f32) * 0.5 >= total - 0.5);
    let c = caps(&t, &s);
    assert!(c.can_move && c.engine_power > 0.0);
}

#[test]
fn engine_block_shields_what_is_behind_it() {
    let t = box_tank(false);
    let mut st = t.fresh_state();
    let p = t.posed(0.0);
    let mut w = Work { scene:None,context:None,t: &t, p, st: st.clone(), rng: Rng::new(1), rep: shoot(&t, &st, &side_shot(ap(), 1)), mod_dmg: HashMap::new(), crew_dmg: HashMap::new(), newly_destroyed: vec![], newly_killed: vec![] };
    w.rep.fragments.clear();
    // a fragment straight through the engine towards the rear wall stops in the block
    w.fragment(Vec3::new(0.0, 1.0, -0.8), Vec3::new(0.0, 0.0, -1.0), 8000.0, "spall", 4.0);
    let f = &w.rep.fragments[0];
    assert_eq!(f.hit.as_deref(), Some("engine"));
    assert!((f.to.z - (-1.3)).abs() < 0.05, "stopped at the face of the block, not at the wall: {:?}", f.to);
    st = w.st;
    assert!(st.modules[0] < 160.0);
}

#[test]
fn ammunition_that_goes_up_destroys_the_vehicle() {
    let t = box_tank(false);
    let mut st = t.fresh_state();
    st.modules[3] = 1.0; // the rack is all but gone
    let mut detonated = 0;
    for seed in 1..30u64 {
        let r = shoot(&t, &st, &side_shot(ap(), seed));
        if r.events.iter().any(|e| e == "ammo_detonation") {
            detonated += 1;
            assert!(r.caps.destroyed && r.events.iter().any(|e| e == "destroyed"));
            assert_eq!(r.title, "彈藥殉爆　擊毀");
        }
    }
    assert!(detonated > 10, "{detonated}");
}

#[test]
fn explicit_zero_racks_stay_empty_on_fresh_and_loaded_states() {
    let mut def=weapon_target("de_pz3_j").def;
    def.ammo_capacity=0;
    for m in &mut def.modules {if m.kind==ModuleKind::AmmoRack {m.rounds=Some(0);}}
    let t=Target::new(def,&rha());
    let racks:Vec<usize>=t.def.modules.iter().enumerate().filter(|(_,m)|m.kind==ModuleKind::AmmoRack).map(|(i,_)|i).collect();
    assert!(!racks.is_empty());
    let fresh=t.fresh_state();
    assert!(racks.iter().all(|&i|fresh.rack(i)==0.0));
    for fill in [vec![],vec![1.0;t.def.modules.len()]] {
        for carried in [0,10] {
            let mut st=fresh.clone(); st.rack_fill=fill.clone(); st.modules[racks[0]]=7.0;
            load_ammo(&t,&mut st,carried);
            assert!(racks.iter().all(|&i|st.rack(i)==0.0));
            assert_eq!(st.modules[racks[0]],7.0,"loading does not repair a rack");
        }
    }
}

#[test]
fn explicit_zero_racks_do_not_receive_or_displace_a_short_load() {
    let mut def=box_tank(false).def;
    def.modules[3].rounds=Some(0); def.modules[3].center.y=0.1;
    let mut positive=module("positive",ModuleKind::AmmoRack,[0.0,0.5,0.0],[0.5,0.5,0.5],40.0); positive.rounds=Some(20);
    def.modules.push(positive);
    def.modules.push(module("legacy",ModuleKind::AmmoRack,[0.0,1.5,0.0],[0.1,0.1,0.02],40.0));
    let fill=rack_fill(&def,10,40);
    assert_eq!(fill[3],0.0);
    assert!((fill[9]-0.2525).abs()<1e-6,"positive rounds and legacy volume retain their old weights: {fill:?}");
    assert_eq!(fill[10],0.0);
    for capacity in [0,40] {
        let fill=rack_fill(&def,40,capacity);
        assert_eq!(fill[3],0.0); assert_eq!(fill[9],1.0); assert_eq!(fill[10],1.0);
    }
    let mut legacy=box_tank(false).def;
    for rounds in [None,Some(20)] {
        legacy.modules[3].rounds=rounds;
        let t=Target::new(legacy.clone(),&rha()); let mut st=t.fresh_state();
        assert_eq!(st.rack(3),1.0);
        st.rack_fill=vec![0.5;t.def.modules.len()]; load_ammo(&t,&mut st,0);
        assert_eq!(st.rack(3),0.5,"unknown legacy capacity remains a no-op");
    }
}

#[test]
fn explicit_zero_racks_never_take_shell_fragment_blast_or_fire_hits_in_stale_states() {
    let mut def=narrow_turret_module(ModuleKind::AmmoRack).def;
    def.turret=None; def.modules[0].rounds=Some(0);
    let t=Target::new(def.clone(),&rha());
    for fill in [vec![],vec![1.0]] {
        let mut st=t.fresh_state(); st.rack_fill=fill; st.modules[0]=1.0;
        let r=shoot(&t,&st,&Shot {origin:Vec3::new(0.0,5.0,0.0),dir:Vec3::new(0.0,-1.0,0.0),..side_shot(ap(),1)});
        assert!(!r.hit,"there is nothing to hit in an authored empty rack");
        assert!(r.modules.is_empty()); assert_eq!(r.state.modules[0],1.0);
        let mut w=work(&t,&st,0.0);
        w.fragment(Vec3::new(0.0,2.0,0.0),Vec3::new(0.0,-1.0,0.0),8000.0,"spall",4.0);
        assert!(w.rep.fragments.last().unwrap().hit.is_none());
        w.blast_inside(t.def.modules[0].center,1.0);
        assert_eq!(w.st.modules[0],1.0); assert!(!w.st.ammo_detonated); assert!(w.mod_dmg.is_empty());
        st.fire_s=50.0; st.fire_at=Some(t.def.modules[0].center);
        let events=advance(&t,&mut st,40.0,1);
        assert_eq!(st.modules[0],1.0); assert!(!st.ammo_detonated);
        assert!(!events.iter().any(|e|e=="ammo_detonation"));
    }
    def.modules[0].external=Some(true);
    let t=Target::new(def,&rha()); let mut st=t.fresh_state(); st.rack_fill=vec![1.0];
    let mut w=work(&t,&st,0.0); w.blast_outside(t.def.modules[0].center,1.0);
    assert!(w.rep.fragments.is_empty(),"empty racks do not report outside blast module hits either");
}

#[test]
fn explicit_zero_rack_damage_never_penalizes_weapon_feed_in_stale_states() {
    for rounds in [Some(0),Some(20),None] {
        let mut def=weapon_target("de_pz3_j").def;
        for m in &mut def.modules {if m.kind==ModuleKind::AmmoRack {m.rounds=rounds;}}
        let t=Target::new(def,&rha());
        for fill in [vec![],vec![1.0;t.def.modules.len()]] {
            let mut st=t.fresh_state(); st.rack_fill=fill;
            for (i,m) in t.def.modules.iter().enumerate() {if m.kind==ModuleKind::AmmoRack {st.modules[i]=m.max_health*0.25;}}
            assert_eq!(weapon_caps_json(&t,&st)["gun:0:0"]["reload_mult"],if rounds==Some(0) {1.0} else {1.25});
        }
    }
}

#[test]
fn an_empty_rack_cannot_go_up() {
    let mut t = box_tank(false);
    // a second rack low on the floor: a short load keeps its rounds there
    t.def.modules.push(module("ammo_floor", ModuleKind::AmmoRack, [0.0, 0.5, 0.0], [0.5, 0.15, 0.5], 40.0));
    t.def.ammo_capacity = 60;
    let t = Target::new(t.def, &rha());
    let fill = rack_fill(&t.def, 20, 60);
    assert_eq!(fill[3], 0.0, "the side rack is emptied first: {fill:?}");
    assert!(fill[9] > 0.0 && fill[0] == 1.0);
    let mut st = t.fresh_state();
    load_ammo(&t, &mut st, 20);
    st.modules[3] = 1.0;
    for seed in 1..30u64 {
        let r = shoot(&t, &st, &side_shot(ap(), seed));
        assert!(r.modules.iter().all(|m| m.id != "ammo_r"), "an empty rack takes no hits");
        // only the floor rack (the one with rounds in it) can set the load off
        assert!(!r.events.iter().any(|e| e == "ammo_detonation") || r.modules.iter().any(|m| m.id == "ammo_floor" && m.destroyed), "seed {seed}");
    }
    // a full load: the same rack goes up again
    load_ammo(&t, &mut st, 60);
    assert!((1..30u64).any(|seed| shoot(&t, &st, &side_shot(ap(), seed)).events.iter().any(|e| e == "ammo_detonation")));
}

#[test]
fn someone_takes_over_the_gunners_seat() {
    let t = box_tank(false);
    let mut st = t.fresh_state();
    st.crew[2] = 0.0; // gunner
    plan_swaps(&t, &mut st);
    assert!(!caps(&t, &st).gunner && !caps(&t, &st).can_fire);
    // the radio operator moves up first
    assert_eq!(st.swaps[0].crew, 1);
    let mut k = 0;
    while caps(&t, &st).can_fire == false && k < 100 {
        advance(&t, &mut st, 0.5, k);
        k += 1;
    }
    assert!(caps(&t, &st).gunner && (k as f32) * 0.5 >= SWAP_S - 0.01);
    assert_eq!(st.roles[1], CrewRole::Gunner);
}

#[test]
fn losing_all_but_one_of_the_crew_puts_the_vehicle_out() {
    let t = box_tank(false);
    let mut st = t.fresh_state();
    for i in 0..4 {
        st.crew[i] = 0.0;
    }
    assert!(check_destroyed(&mut st));
}

#[test]
fn machine_gun_bullets_bounce_off_armour_but_hit_an_open_crew() {
    let closed = box_tank(false);
    let open = box_tank(true);
    let mg = shell(ProjectileKind::Ap, 12.7, 0.046, 22.0, 0.0);
    let into_turret = |seed| Shot { origin: Vec3::new(30.0, 2.3, -0.6), dir: Vec3::new(-1.0, 0.0, 0.0), speed_ms: 820.0, ..side_shot(mg.clone(), seed) };
    let r = shoot(&closed, &closed.fresh_state(), &into_turret(1));
    assert_eq!(r.outcome, Outcome::Stopped, "{:?} {:?}", r.plate, r.layers);
    let r = shoot(&open, &open.fresh_state(), &into_turret(1));
    assert_eq!(r.outcome, Outcome::Unarmoured, "{:?} {:?} {:?} {:?}", r.hit, r.crew, r.fragments, (open.lo, open.hi));
    let contact=r.impact_events.iter().find(|e|e.transition.layer_id=="core/crew:3").unwrap();
    let input=0.5*0.046f32 as f64*820.0f64.powi(2);
    let expected_deposition=input*(5.0/r.pen_mm as f64).min(1.0);
    assert!((contact.transition.budget.target_deposition_j-expected_deposition).abs()<1e-2);
    let expected_damage=25.0*(expected_deposition/1000.0).sqrt();
    let commander=r.crew.iter().find(|c|c.role==CrewRole::Commander).unwrap();
    assert!((commander.damage as f64-expected_damage).abs()<1e-3);
    assert!((commander.health+commander.damage-100.0).abs()<1e-5);
    assert!(r.impact_state.as_ref().unwrap().energy_j().is_finite());
    assert!(r.fragments.iter().all(|f| f.kind != "spall"));
}

#[test]
fn the_turret_turns_its_armour_with_it() {
    let t = box_tank(false);
    let st = t.fresh_state();
    let at_turret = |yaw| Shot { origin: Vec3::new(30.0, 2.25, 0.5), dir: Vec3::new(-1.0, 0.0, 0.0), turret_yaw: yaw, ..side_shot(ap(), 2) };
    assert_eq!(shoot(&t, &st, &at_turret(0.0)).plate.as_deref(), Some("turret_side_r"));
    // turned 90 degrees to the right: the 100 mm front now faces this way
    let r = shoot(&t, &st, &at_turret(std::f32::consts::FRAC_PI_2));
    assert_eq!(r.plate.as_deref(), Some("turret_front"));
    assert_eq!(r.layers[0].thickness_mm, 100.0);
}

#[test]
fn the_same_seed_gives_the_same_shot() {
    let t = box_tank(false);
    let st = t.fresh_state();
    let a = serde_json::to_string(&shoot(&t, &st, &side_shot(aphe(), 11))).unwrap();
    let b = serde_json::to_string(&shoot(&t, &st, &side_shot(aphe(), 11))).unwrap();
    assert_eq!(a, b);
}

#[test]
fn fire_burns_out_or_is_put_out() {
    let t = box_tank(false);
    let mut st = t.fresh_state();
    st.fire_s = FIRE_S;
    st.fire_at = Some(Vec3::new(-1.1, 1.2, -1.6));
    assert!(caps(&t, &st).on_fire);
    assert!(extinguish(&mut st));
    assert!(!extinguish(&mut st), "one extinguisher");
    let ev = advance(&t, &mut st, 2.0, 1);
    assert!(ev.iter().any(|e| e == "fire_out") && !caps(&t, &st).on_fire);
}

#[test]
fn an_he_shell_landing_beside_an_open_vehicle_hurts_its_crew() {
    let open = box_tank(true);
    let r = splash(&open, &open.fresh_state(), Vec3::new(2.4, 0.3, 0.0), 0.68, 0.0, 3);
    assert!(r.crew.iter().any(|c| c.damage > 0.0) || r.modules.iter().any(|m| m.id == "track_r"));
    let closed = box_tank(false);
    let r = splash(&closed, &closed.fresh_state(), Vec3::new(2.4, 0.3, 0.0), 0.68, 0.0, 3);
    assert!(r.crew.is_empty());
}

#[test]
fn folding_hull_side_armor_changes_shell_and_splash_protection_without_reindexing_the_crew() {
    let mut base = box_tank(true).def;
    let mut flap = plate("fold_side", ArmorZone::TurretSide, 200.0,
        [1.5, 2.2, 0.0], [1.0, 0.0, 0.0], [0.0, 0.0, 1.0], 3.0, 0.4);
    flap.hinge = Some(tg_armor::ArmorHinge { a: [1.5, 1.8, -3.0], b: [1.5, 1.8, 3.0], angle: -90.0 });
    base.plates.push(flap);
    let upright = Target::new(base, &rha());
    let folded = upright.folded(1.0);
    let idx = folded.def.plates.len() - 1;
    assert!((folded.posed(1.2).plates[idx].center - folded.def.plates[idx].center).length() < 1e-5,
        "a hull-mounted foldable wall must not turn with the gun");
    assert_eq!(upright.def.modules.len(), folded.def.modules.len());
    assert_eq!(upright.def.crew.len(), folded.def.crew.len());
    for (a, b) in upright.def.modules.iter().zip(&folded.def.modules) { assert_eq!(a.id, b.id); }
    for (a, b) in upright.def.crew.iter().zip(&folded.def.crew) { assert_eq!(a.pos, b.pos); }
    let state = upright.fresh_state();
    let shot = Shot { shell: ProjectileDef::generic_ap(75.0, 120.0), origin: Vec3::new(4.0, 2.2, 0.0),
        dir: Vec3::new(-1.0, 0.0, 0.0), speed_ms: 800.0, distance_m: 0.0, seed: 17, turret_yaw: 0.0 };
    let raised_hit = shoot(&upright, &state, &shot);
    let lowered_hit = shoot(&folded, &state, &shot);
    assert_eq!(raised_hit.plate.as_deref(), Some("fold_side"));
    assert_ne!(lowered_hit.plate.as_deref(), Some("fold_side"));
    // The old low burst-to-gunner ray still crosses the fixed lower hull side
    // at y=1.758 m, below its 1.8 m top. Folding the upper flap cannot open it.
    let low_at = Vec3::new(2.4, 1.6, 0.0);
    let fixed_side = upright.def.plates.iter().position(|p| p.id == "hull_side_r").unwrap();
    for target in [&upright, &folded] {
        let w = work(target, &state, 0.0);
        let delta = target.def.crew[2].pos - low_at;
        let first = w.events(low_at, delta.normalized(), delta.length() * 1.001, true)
            .into_iter().find(|e| !matches!(e.kind, EvKind::Decoration)).unwrap();
        assert_eq!(first.kind, EvKind::Plate(fixed_side), "folding the upper flap retains lower-hull protection");
    }
    // Use the unchanged outboard loader station for the actual upper opening:
    // the raised flap crosses this ray at y=2.108 m; the lowered flap and fixed
    // hull both lie below it. The breech is behind this station, not on its ray.
    let exposed_station = 4;
    assert_eq!(upright.def.crew[exposed_station].role, CrewRole::Loader);
    let blast_at = Vec3::new(2.4, 2.2, -0.2);
    let blast_kg = 1.2;
    assert!((upright.def.crew[exposed_station].pos - blast_at).length() < outside_radius_m(blast_kg) * 1.4);
    for (target, expected) in [(&upright, EvKind::Plate(idx)), (&folded, EvKind::Crew(exposed_station))] {
        let w = work(target, &state, 0.0);
        let delta = target.def.crew[exposed_station].pos - blast_at;
        let first = w.events(blast_at, delta.normalized(), delta.length() * 1.001, true)
            .into_iter().find(|e| !matches!(e.kind, EvKind::Decoration)).unwrap();
        assert_eq!(first.kind, expected, "the actual posed upper wall alone controls this station's exposure");
    }
    let raised_blast = splash(&upright, &state, blast_at, blast_kg, 0.0, 31);
    let lowered_blast = splash(&folded, &state, blast_at, blast_kg, 0.0, 31);
    assert!(!raised_blast.crew.iter().any(|c| c.index == exposed_station && c.damage > 0.0));
    assert!(lowered_blast.crew.iter().any(|c| c.index == exposed_station && c.damage > 0.0));
    let mut narrow = upright.def.clone();
    narrow.plates = vec![narrow.plates.last().unwrap().clone()];
    narrow.modules.clear(); narrow.crew.clear(); narrow.turret = None;
    let narrow = Target::new(narrow, &rha());
    assert!(narrow.folded(1.0).hi.x > narrow.hi.x + 0.6,
        "folded wall corners must remain inside the shot/missile broadphase bounds");
}

/// Every vehicle in data/ loads as a target and takes a side shot without trouble.
#[test]
fn every_data_vehicle_is_a_target() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data");
    let mats: Vec<Material> = serde_json::from_str(&std::fs::read_to_string(root.join("materials.json")).unwrap()).unwrap();
    let mut n = 0;
    for e in std::fs::read_dir(root.join("vehicles")).unwrap().flatten() {
        let dir = e.path();
        let read = |f: &str| std::fs::read_to_string(dir.join(f)).unwrap();
        let vehicle: serde_json::Value = serde_json::from_str(&read("vehicle.json")).unwrap();
        let def = target_from_files(&e.file_name().to_string_lossy(), &vehicle, serde_json::from_str(&read("armor.json")).unwrap(), serde_json::from_str(&read("modules.json")).unwrap(), serde_json::from_str(&read("crew.json")).unwrap());
        let t = Target::new(def, &mats);
        let st = t.fresh_state();
        // level from the right, through the driver's seat
        let c = t.def.crew[0].pos;
        let r = shoot(&t, &st, &Shot { origin: Vec3::new(40.0, c.y, c.z), dir: Vec3::new(-1.0, 0.0, 0.0), ..side_shot(aphe(), 1) });
        assert!(r.hit, "{:?} side shot missed: {:?} {:?}", dir, t.lo, t.hi);
        n += 1;
    }
    assert!(n >= 10);
}


#[test]
fn surface_delayed_aphe_mk214_uses_accepted_triangles_and_armed_stop() {
    let (target,scene)=surface_combat_fixture();
    let root=std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    let catalog:serde_json::Value=serde_json::from_slice(&std::fs::read(root.join("data/aircraft/frontline.json")).unwrap()).unwrap();
    let round:ProjectileDef=serde_json::from_value(catalog["shells"]["ap_50_mk214a"].clone()).unwrap();
    assert!((round.explosive_mass_kg-0.017).abs()<1e-6);
    assert_eq!(round.explosive_type,"petn");
    let shot=Shot{shell:round,origin:Vec3::new(0.5,0.,-1.),dir:Vec3::new(0.,0.,1.),
        speed_ms:500.,distance_m:2500.,seed:4,turret_yaw:0.};
    let before=target.fresh_state();
    let report=shoot_surface_impact(&target,&before,&shot,&scene,Vec3::new(0.5,0.,0.1),None).unwrap();
    assert!(report.hit);
    assert!((report.impact.unwrap().z-0.).abs()<1e-5,"must hit the visible wall, not its legacy z=-0.4 plane");
    let engine=report.impact_events.iter().find(|e|e.transition.layer_id.contains("module:engine")).unwrap();
    assert!((engine.entry_position.x-0.5).abs()<1e-5,"must use the visible engine surface, not its abstract x=5 box");
    assert_eq!(engine.transition.output.remaining_pen_mm,0.);
    assert_eq!(report.bursts.len(),1,"armed stopped MK214 filler must release exactly once");
    let burst=&report.bursts[0];assert!(burst.inside);
    assert!((burst.pos-engine.exit_position).length()<1e-5);
    assert!((burst.explosive_kg-0.017).abs()<1e-6);
    assert!((burst.time_s.unwrap()-burst.armed_at_s.unwrap()-0.0024).abs()<1e-7);
    assert!(report.primary_geometry_contacts.len()>=3);
    assert_eq!(report.impact_state.as_ref().unwrap().fuse,impact::FuseState::Detonated);
    assert!(report.fragments.iter().filter(|f|f.kind=="burst").all(|f|f.provenance.start_s==burst.time_s));
    let mut gap=shot.clone();gap.origin.x=0.;
    let miss=shoot_surface_impact(&target,&before,&gap,&scene,Vec3::new(0.,0.,0.1),None).unwrap();
    assert!(!miss.hit&&miss.bursts.is_empty(),"the real aperture cannot become a legacy plane hit or an invented APHE burst");
}


// Retained handoff legacy triangle/API regressions; surface recovery does not remove coverage.
fn pantsir_from_data() -> Target {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data/vehicles/ru_pantsir_sm_sv");
    let read = |f: &str| std::fs::read_to_string(root.join(f)).unwrap();
    let mut t = weapon_target("ru_pantsir_sm_sv").def;
    t.surfaces = Some(serde_json::from_str(&read("surface_armor.json")).unwrap());
    let t = Target::new(t, &rha());
    assert!(t.surface_error.is_none(), "{:?}", t.surface_error);
    t
}

#[test]
fn pantsir_triangle_armour_from_its_model() {
    let t = pantsir_from_data();
    assert!(t.def.plates.is_empty());
    assert_eq!(t.surf.as_ref().unwrap().triangle_count, 22206);
    let shot = |o: [f32; 3], d: [f32; 3], yaw: f32, shell: ProjectileDef| shoot(&t, &t.fresh_state(), &Shot { shell, origin: Vec3::new(o[0], o[1], o[2]), dir: Vec3::new(d[0], d[1], d[2]).normalized(), speed_ms: 900.0, distance_m: 500.0, seed: 5, turret_yaw: yaw });
    let ap30 = || shell(ProjectileKind::Apcbc, 30.0, 0.4, 60.0, 0.0);
    // the hull's front at the driver's height: its 20 mm skin, met where the model's triangles are
    let r = shot([-0.5, 1.2, 40.0], [0.0, 0.0, -1.0], 0.0, ap30());
    let first = &r.layers[0];
    assert!(first.plate.starts_with("surf:armor_hull_front:"), "{first:?}");
    assert_eq!(first.thickness_mm, 20.0);
    assert!(first.point.z > 2.5 && first.point.z < 4.2, "front skin at {:?}", first.point);
    // the turret's side from the right (12 mm front, 10 mm sides)
    let side = shot([40.0, 2.3, 0.6], [-1.0, 0.0, 0.0], 0.0, ap30());
    let turret_layer = side.layers.iter().find(|l| l.plate.contains("turret")).expect("the turret's side");
    assert_eq!(turret_layer.zone, ArmorZone::TurretSide);
    // turned a quarter round, its front faces that shot
    let turned = shot([40.0, 2.3, 0.86], [-1.0, 0.0, 0.0], std::f32::consts::FRAC_PI_2, ap30());
    let tl = turned.layers.iter().find(|l| l.plate.contains("turret")).expect("the turned turret");
    assert_eq!(tl.zone, ArmorZone::TurretFront, "{:?}", turned.layers.iter().map(|l| (&l.plate, l.zone)).collect::<Vec<_>>());
    // a 12.7 mm round (20 mm of penetration) does not get through the 20 mm front at its slope
    let mg = shot([-0.5, 1.2, 40.0], [0.0, 0.0, -1.0], 0.0, shell(ProjectileKind::Ap, 12.7, 0.048, 20.0, 0.0));
    assert!(!mg.layers[0].passed || mg.layers[0].required_mm <= 20.5, "{:?}", mg.layers[0]);
    // the cost: a hundred shots across the 22,206 triangles
    let t0 = std::time::Instant::now();
    for k in 0..100 { let _ = shot([-1.2 + k as f32 * 0.024, 1.4, 40.0], [0.0, -0.05, -1.0], 0.0, ap30()); }
    eprintln!("pantsir: 100 shots in {:?}", t0.elapsed());
}

#[test]
fn surface_armour_hole_in_the_skin_is_not_filled() {
    let t = surface_tank(Some(0), None);
    // through the middle cell of the right side (left out): no right wall on the way in
    let r = shoot(&t, &t.fresh_state(), &side_shot(ap(), 7));
    assert!(r.layers.iter().all(|l| !l.plate.starts_with("surf:hull_side_r:")), "{:?}", r.layers.iter().map(|l| &l.plate).collect::<Vec<_>>());
    // beside the hole the wall is there
    let mut s = side_shot(ap(), 7);
    s.origin.z = 2.5;
    let r = shoot(&t, &t.fresh_state(), &s);
    assert!(r.layers[0].plate.starts_with("surf:hull_side_r:"));
}

#[test]
fn surface_armour_rejects_a_changed_geometry() {
    let mut def = surface_tank(None, None).def;
    if let Some(s) = def.surfaces.as_mut() { s.geometry_hash = "0".repeat(64); }
    let t = Target::new(def, &rha());
    assert!(t.surface_error.as_deref().unwrap_or("").contains("hash"));
    assert!(t.surf.is_none());
}

#[test]
fn surface_armour_side_shot_meets_the_models_wall() {
    let t = surface_tank(None, None);
    let r = shoot(&t, &t.fresh_state(), &side_shot(ap(), 7));
    assert_eq!(r.outcome, Outcome::Penetrated);
    assert!(r.plate.as_deref().unwrap().starts_with("surf:hull_side_r:"), "{:?}", r.plate);
    let first = &r.layers[0];
    assert_eq!(first.thickness_mm, 20.0);
    assert!(first.angle_deg < 1.0 && (first.point.x - 1.5).abs() < 1e-3, "{first:?}");
    // the spall stays inside the hull's skin
    for f in r.fragments.iter().filter(|f| f.kind == "spall") {
        assert!(f.to.x <= 1.5 + 0.02 && f.to.x >= -1.5 - 0.02 && f.to.z.abs() <= 3.02 && f.to.y >= 0.38 && f.to.y <= 2.82, "spall left the hull: {:?}", f.to);
    }
}

#[test]
fn surface_armour_turret_turns_with_its_yaw() {
    let t = surface_tank(None, None);
    let front = |yaw: f32| shoot(&t, &t.fresh_state(), &Shot { shell: ap(), origin: Vec3::new(0.0, 2.4, 30.0), dir: Vec3::new(0.0, 0.0, -1.0), speed_ms: 700.0, distance_m: 500.0, seed: 3, turret_yaw: yaw });
    let r0 = front(0.0);
    assert_eq!(r0.layers[0].zone, ArmorZone::TurretFront);
    assert_eq!(r0.layers[0].thickness_mm, 60.0);
    let r1 = front(std::f32::consts::FRAC_PI_2);
    assert_eq!(r1.layers[0].zone, ArmorZone::TurretSide, "{:?}", r1.layers[0]);
    assert!((r1.layers[0].point.z - 0.9).abs() < 1e-3, "turned turret's side at 0.9 m: {:?}", r1.layers[0].point);
}

#[test]
fn surface_armour_two_skins_of_one_part_are_one_wall() {
    // a second skin 5 mm inside the right side (a doubled panel): one 20 mm wall, not two
    let t = surface_tank(None, Some((0, 0.005)));
    let r = shoot(&t, &t.fresh_state(), &side_shot(ap(), 7));
    assert_eq!(r.layers.iter().filter(|l| l.plate.starts_with("surf:hull_side_r:")).count(), 1);
}

fn surface_box(lo: [f32; 3], hi: [f32; 3], parts: &[(&str, ArmorZone, f32)], turret: bool, holed: Option<usize>, extra_skin: Option<(usize, f32)>, pos: &mut Vec<[f32; 3]>, tris: &mut Vec<[u32; 4]>, defs: &mut Vec<surface_armor::SurfacePartDef>) {
    // faces: +x, -x, +y, -y, +z, -z: (axis, sign)
    let faces = [(0, 1.0f32), (0, -1.0), (1, 1.0), (1, -1.0), (2, 1.0), (2, -1.0)];
    for (f, &(axis, sign)) in faces.iter().enumerate() {
        let (name, zone, mm) = parts[f];
        let part = defs.len() as u32;
        defs.push(surface_armor::SurfacePartDef { id: name.into(), zone, material: "rha".into(), thickness_mm: mm, turret });
        let (a1, a2) = ((axis + 1) % 3, (axis + 2) % 3);
        let mut emit = |depth: f32, cells: &[(usize, usize)], n: usize| {
            for &(i, j) in cells {
                let corner = |di: usize, dj: usize| -> [f32; 3] {
                    let mut p = [0.0; 3];
                    p[axis] = if sign > 0.0 { hi[axis] - depth } else { lo[axis] + depth };
                    p[a1] = lo[a1] + (hi[a1] - lo[a1]) * (i + di) as f32 / n as f32;
                    p[a2] = lo[a2] + (hi[a2] - lo[a2]) * (j + dj) as f32 / n as f32;
                    p
                };
                let base = pos.len() as u32;
                for (di, dj) in [(0, 0), (1, 0), (1, 1), (0, 1)] { pos.push(corner(di, dj)); }
                tris.push([base, base + 1, base + 2, part]);
                tris.push([base, base + 2, base + 3, part]);
            }
        };
        if holed == Some(f) {
            let cells: Vec<(usize, usize)> = (0..3).flat_map(|i| (0..3).map(move |j| (i, j))).filter(|&c| c != (1, 1)).collect();
            emit(0.0, &cells, 3);
        } else {
            emit(0.0, &[(0, 0)], 1);
        }
        if let Some((sf, depth)) = extra_skin { if sf == f { emit(depth, &[(0, 0)], 1); } }
    }
}

fn surface_tank(holed: Option<usize>, extra_skin: Option<(usize, f32)>) -> Target {
    let (mut pos, mut tris, mut parts) = (vec![], vec![], vec![]);
    let hull = [("hull_side_r", ArmorZone::HullSide, 20.0), ("hull_side_l", ArmorZone::HullSide, 20.0), ("hull_roof", ArmorZone::HullRoof, 10.0), ("hull_floor", ArmorZone::HullFloor, 10.0), ("hull_front", ArmorZone::HullUpperFront, 40.0), ("hull_rear", ArmorZone::HullRear, 15.0)];
    surface_box([-1.5, 0.4, -3.0], [1.5, 2.0, 3.0], &hull, false, holed, extra_skin, &mut pos, &mut tris, &mut parts);
    let turret = [("turret_side_r", ArmorZone::TurretSide, 30.0), ("turret_side_l", ArmorZone::TurretSide, 30.0), ("turret_roof", ArmorZone::TurretRoof, 15.0), ("turret_floor", ArmorZone::Other, 15.0), ("turret_front", ArmorZone::TurretFront, 60.0), ("turret_rear", ArmorZone::TurretRear, 20.0)];
    surface_box([-0.9, 2.0, -1.0], [0.9, 2.8, 1.0], &turret, true, None, None, &mut pos, &mut tris, &mut parts);
    let (positions, triangles, geometry_hash) = surface_armor::encode(&pos, &tris);
    let mut def = box_tank(false).def;
    def.plates.clear();
    def.surfaces = Some(surface_armor::SurfaceArmorDef { schema: 1, geometry_hash, parts, positions, triangles, source: serde_json::Value::Null });
    let t = Target::new(def, &rha());
    assert!(t.surface_error.is_none(), "{:?}", t.surface_error);
    t
}

#[test]
fn weapon_bindings_explicit_shared_part_under_one_group_fires_and_fails_together() {
    // the Pantsir's twin 2A38M: each side one breech module for its two barrels, named on both mounts
    let t=pantsir_from_data();
    let c=weapon_caps_json(&t,&t.fresh_state());
    for key in ["gun:0:0","gun:0:1","gun:0:2","gun:0:3","gun:0:4"] {
        assert_eq!(c[key]["can_fire"],true,"{key}: {}",c[key]["reason"]);
    }
    let i=t.def.modules.iter().position(|m| m.id=="cannon_left_breech").unwrap();
    let mut st=t.fresh_state(); st.modules[i]=0.0;
    let c=weapon_caps_json(&t,&st);
    assert_eq!(c["gun:0:0"]["can_fire"],false);
    assert_eq!(c["gun:0:1"]["can_fire"],false);
    assert_eq!(c["gun:0:2"]["can_fire"],true);
    // the same parts named under different groups stay ambiguous
    let mut def=t.def.clone();
    def.weapons["extra_guns"][0]["gun"]["weapon_group"]="cannon_x".into();
    let t2=Target::new(def,&rha());
    let c=weapon_caps_json(&t2,&t2.fresh_state());
    assert!(c["gun:0:0"]["reason"].as_str().unwrap().contains("ambiguous"));
}
