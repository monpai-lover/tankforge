use super::*;
use super::super::MeshStore;
use serde_json::json;

// Source constructor pieces are kept as real separate triangle ranges. A tuple
// is (accepted instance, measured z, authored plate, authored boundary side).
fn fixture(faces: &[(usize, f32, usize, &str)]) -> (Target, CombatScene) {
    let plates = (0..2).map(|i| json!({"id":if i==0{"cast"}else{"independent"},
        "zone":"hull_side","material":"rha","thickness_mm":20,
        "center":{"x":0,"y":0,"z":i as f32*0.03},
        "normal":{"x":0,"y":0,"z":-1},"axis_u":{"x":1,"y":0,"z":0},
        "half_u":1,"half_v":1})).collect::<Vec<_>>();
    let def: crate::TargetDef = serde_json::from_value(json!({"id":"compound-region",
        "plates":plates,"modules":[],"crew":[]})).unwrap();
    let materials = [tg_armor::Material {id:"rha".into(),kind:tg_armor::ArmorKind::Rha,
        density_kg_m3:7850.,hardness_bhn:300.,kinetic_factor:1.,chemical_factor:1.}];
    let target=Target::new(def,&materials);
    let identity=[1f32,0.,0.,0.,0.,1.,0.,0.,0.,0.,1.,0.,0.,0.,0.,1.].map(f32::to_bits);
    let mut store=MeshStore::default();let mut meshes=vec![];let mut instances=vec![];
    let mut surfaces=vec![];let mut bindings=HashMap::new();
    for group in 0..=faces.iter().map(|f|f.0).max().unwrap_or(0) {
        let mut positions=vec![];let mut triangles:Vec<[u32;3]>=vec![];let mut ranges=vec![];
        for (ordinal,&(_,z,plate,side)) in faces.iter().enumerate().filter(|(_,f)|f.0==group) {
            let first=triangles.len();let n=positions.len()as u32;
            positions.extend([[-1f32,-1.,z],[1.,-1.,z],[1.,1.,z],[-1.,1.,z]]);
            if side=="inner" {triangles.extend([[n,n+1,n+2],[n,n+2,n+3]]);}
            else {triangles.extend([[n,n+2,n+1],[n,n+3,n+2]]);}
            let key=format!("surface:{ordinal}");
            ranges.push(json!({"first":first,"count":2,"sourceKey":format!("constructor:piece:{ordinal}"),
                "surfaceKey":key,"solidKey":null,"bindingKey":null}));
            surfaces.push(json!({"key":key,"role":"armor","topology":"boundary_shell","winding":"emitted",
                "responseRef":null,"armorLayerKey":null,"moduleKey":null,"crewKey":null,
                "fuseEligible":true,"contactEligible":true}));
            bindings.insert(format!("surface:{key}"),Binding {kind:EvKind::Plate(plate),
                region:Some(format!("authored-region:{plate}")),side:Some(side.into())});
        }
        let mut bytes=b"THMESH1\0".to_vec();
        for v in [1u32,positions.len()as u32,triangles.len()as u32,positions.len()as u32*12,triangles.len()as u32*12,0] {bytes.extend(v.to_le_bytes());}
        for p in &positions {for v in p {bytes.extend(v.to_le_bytes());}}
        for t in &triangles {for v in t {bytes.extend(v.to_le_bytes());}}
        let hash=sha256(&bytes);let loaded=store.install(&bytes,&hash).unwrap();let key=format!("mesh:{group}");
        meshes.push(json!({"key":key,"payloadHash":hash,"positionsHash":loaded.data.position_hash,
            "renderBufferHash":hash,"vertexCount":positions.len(),"triangleCount":triangles.len(),
            "bounds":loaded.data.bounds,"ranges":ranges,"bvh":null}));
        instances.push(json!({"key":format!("instance:{group}"),"meshKey":key,"assemblyKey":"root",
            "sourceKey":format!("constructor:group:{group}"),"worldBits":identity,"instanceBits":identity,
            "materialFeature":{},"activityPolicy":"static_fixture"}));
    }
    let zero="0".repeat(64);
    let mut manifest=json!({"schema":"HitMeshManifestV1","format":"THMESH1","endianness":"LE",
        "generator":{"revision":"fixture","sha256":zero},"buildRecipeHash":zero,"specId":"compound-region",
        "buildHash":zero,"renderGeometryHash":zero,"anatomyDataHash":zero,"sources":{"assets":[]},"meshes":meshes,
        "assemblies":[{"key":"root","parent":null,"baseTransformBits":identity,"pivot":[0,0,0],"joint":{},"allowedMotionFields":[]}],
        "meshInstances":instances,"bindings":[],"surfaces":surfaces,
        "audits":{"certification":"audit_pending_diagnostic","triangleCoverage":faces.len()*2,
            "unclassifiedPhysicalTriangles":0,"degenerateCount":0,"boundaryEdges":0,"nonmanifoldEdges":0,
            "missingBindings":0,"ambiguousBindings":0,"renderPositionDifferences":0}});
    manifest["manifestHash"]=json!(sha256(&serde_json::to_vec(&manifest).unwrap()));
    let bytes=serde_json::to_vec(&manifest).unwrap();let hash=sha256(&bytes);
    let geometry=Geometry::register(&bytes,&hash,&store).unwrap();
    let scene=CombatScene {geometry:RefCell::new(geometry),context:QueryContext {entity_id:"1:2:1".into(),spawn_epoch:1,
        build_hash:zero,pose_revision:1,geometry_revision:0,shape_hash:Some(hash)},target_id:target.def.id.clone(),
        target_signature:target.registration_hash(),catalog_hash:"0".repeat(64),bindings,
        instance_bindings:HashMap::new(),error:RefCell::new(None)};
    (target,scene)
}
fn line()->(Vec3,Vec3,f32){(Vec3::new(0.23,0.11,-1.),Vec3::new(0.,0.,1.),3.)}
fn shot()->crate::Shot {
    let mut shell:tg_weapon::ProjectileDef=serde_json::from_slice(include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"),"/../../data/projectiles/ap_37_m74.json"))).unwrap();
    for p in &mut shell.penetration_curve {p.pen_mm=500.;}
    shell.explosive_mass_kg=0.;
    crate::Shot {shell,origin:line().0,dir:line().1,speed_ms:884.,distance_m:0.,seed:4,turret_yaw:0.}
}

#[test]
fn compound_same_region_overlapping_constructor_pieces_charge_once() {
    let(t,s)=fixture(&[(0,0.,0,"outer"),(0,0.04,0,"outer"),(0,0.10,0,"inner"),(0,0.14,0,"inner")]);
    let(o,d,max)=line();let events=s.events(o,d,max,true);
    assert_eq!(events.len(),1,"O O I I is one connected authored material region, not repeated armor");
    assert!((events[0].paired_contact.as_ref().unwrap().point[2]-0.14).abs()<1e-6);
    let r=crate::shoot_surface(&t,&t.fresh_state(),&shot(),&s,o+d*max,None).unwrap();
    assert_eq!(r.layers.len(),1);assert!(!r.events.iter().any(|e|e=="rejected_impact_contact"));
}
#[test]
fn compound_disjoint_same_region_panels_each_consume_new_resistance() {
    let(t,s)=fixture(&[(0,0.,0,"outer"),(0,0.04,0,"inner"),(0,0.10,0,"outer"),(0,0.14,0,"inner")]);
    let(o,d,max)=line();assert_eq!(s.events(o,d,max,true).len(),2);
    let r=crate::shoot_surface(&t,&t.fresh_state(),&shot(),&s,o+d*max,None).unwrap();
    assert_eq!(r.layers.len(),2);assert!(!r.events.iter().any(|e|e=="rejected_impact_contact"));
    assert!(r.layers[1].pen_before_mm-r.layers[1].pen_after_mm>19.,"a real air gap must start a new traversal, not reuse the first slab's work");
}
#[test]
fn compound_independent_instances_with_same_region_name_are_not_merged() {
    let(_,s)=fixture(&[(0,0.,0,"outer"),(1,0.04,0,"outer"),(0,0.10,0,"inner"),(1,0.14,0,"inner")]);
    let(o,d,max)=line();assert_eq!(s.events(o,d,max,true).iter()
        .filter(|e|!e.surface_transit.is_some_and(|t|t.is_exit)).count(),2,"instance identity owns separate material");
}
#[test]
fn compound_overlap_does_not_skip_a_distinct_authored_armor_layer() {
    let(t,s)=fixture(&[(0,0.,0,"outer"),(0,0.03,1,"outer"),(0,0.04,0,"outer"),
        (0,0.07,1,"inner"),(0,0.10,0,"inner"),(0,0.14,0,"inner")]);
    let(o,d,max)=line();let r=crate::shoot_surface(&t,&t.fresh_state(),&shot(),&s,o+d*max,None).unwrap();
    assert_eq!(r.layers.iter().filter(|l|l.plate=="cast").count(),1);
    assert_eq!(r.layers.iter().filter(|l|l.plate=="independent").count(),1,
        "pairing a compound casting must not jump the cursor over another accepted region");
    assert!(!r.events.iter().any(|e|e=="rejected_impact_contact"));
}
