use super::*;
use serde_json::json;
use super::super::{MeshStore,manifest::HitMeshManifestV1};

fn identity()->[u32;16]{[1f32,0.,0.,0.,0.,1.,0.,0.,0.,0.,1.,0.,0.,0.,0.,1.].map(f32::to_bits)}
fn seal(mut value:Value)->Vec<u8>{value.as_object_mut().unwrap().remove("manifestHash");
    value["manifestHash"]=json!(sha256(&serde_json::to_vec(&value).unwrap()));serde_json::to_vec(&value).unwrap()}
fn payload(x:f32,width:f32)->Vec<u8>{
    let mut bytes=b"THMESH1\0".to_vec();for word in [1u32,3,1,36,12,0]{bytes.extend(word.to_le_bytes());}
    for point in [[x,0.,0.],[x+width,0.,0.],[x,1.,0.]]{for f in point{bytes.extend(f.to_le_bytes());}}
    for i in [0u32,1,2]{bytes.extend(i.to_le_bytes());}bytes
}
fn mesh(store:&mut MeshStore,key:&str,x:f32,width:f32)->Value{
    let bytes=payload(x,width);let hash=sha256(&bytes);let loaded=store.install(&bytes,&hash).unwrap();
    json!({"key":key,"payloadHash":hash,"positionsHash":loaded.data.position_hash,"renderBufferHash":hash,
        "vertexCount":3,"triangleCount":1,"bounds":loaded.data.bounds,"bvh":null,
        "ranges":[{"first":0,"count":1,"sourceKey":format!("source:{key}"),"surfaceKey":format!("surface:{key}"),"solidKey":null,"bindingKey":null}]})
}
fn scene(manifest:Value,store:&MeshStore,catalog:&str,shape:Option<String>)->CombatScene{
    let bytes=seal(manifest);let hash=sha256(&bytes);let geometry=Geometry::register(&bytes,&hash,store).unwrap();
    let bindings=geometry.manifest.meshes.iter().enumerate().map(|(i,m)|(format!("surface:surface:{}",m.key),
        Binding {kind:if i==2{EvKind::Unknown}else{EvKind::Module(i)},region:None,side:None})).collect();
    CombatScene {geometry:RefCell::new(geometry),context:QueryContext {entity_id:"1:1:1".into(),spawn_epoch:1,
        build_hash:"0".repeat(64),pose_revision:1,geometry_revision:0,shape_hash:Some(shape.unwrap_or(hash))},
        target_id:"test".into(),target_signature:"1".repeat(64),catalog_hash:catalog.into(),bindings,
        instance_bindings:HashMap::new(),error:RefCell::new(None)}
}
fn manifest(meshes:Vec<Value>)->Value{
    let keys:Vec<_>=meshes.iter().map(|m|m["key"].as_str().unwrap().to_owned()).collect();let z="0".repeat(64);
    json!({"schema":"HitMeshManifestV1","format":"THMESH1","endianness":"LE","generator":{"revision":"fixture","sha256":z},
        "buildRecipeHash":z,"specId":"test","buildHash":z,"renderGeometryHash":z,"anatomyDataHash":z,"sources":{"assets":[]},"meshes":meshes,
        "assemblies":[{"key":"root","parent":null,"baseTransformBits":identity(),"pivot":[0,0,0],"joint":{"kind":"recoil","status":"declared","turret":0,"gun":0},"allowedMotionFields":[]}],
        "meshInstances":keys.iter().map(|key|json!({"key":format!("instance:{key}"),"meshKey":key,"assemblyKey":"root","sourceKey":format!("source:{key}"),
            "worldBits":identity(),"instanceBits":identity(),"materialFeature":{},"activityPolicy":"static_fixture"})).collect::<Vec<_>>(),"bindings":[],
        "surfaces":keys.iter().map(|key|json!({"key":format!("surface:{key}"),"role":"audit_pending","topology":"audit_pending","winding":"emitted", "responseRef":null,
            "armorLayerKey":null,"moduleKey":null,"crewKey":null,"fuseEligible":null,"contactEligible":true})).collect::<Vec<_>>(),
        "audits":{"certification":"audit_pending_diagnostic","triangleCoverage":keys.len(),"unclassifiedPhysicalTriangles":1,"degenerateCount":0,
            "boundaryEdges":0,"nonmanifoldEdges":0,"missingBindings":1,"ambiguousBindings":0,"renderPositionDifferences":0}})
}
fn record(stock:&CombatScene,derived:&CombatScene,key:&str,hash_byte:&str)->BarrelShapeVariantV1{
    let mesh=derived.geometry.borrow().manifest.meshes.iter().find(|m|m.key==key).unwrap().clone();
    let recipe=json!({"schema":"BarrelFractureRecipeV1","sourceMeshKey":key,"cutPlaneBits":0,"cutPlaneLocalZ":0,"keepSide":"local_z_le_cut"});
    let value=json!({"schema":"BarrelShapeVariantV1","shapeId":format!("variant:{key}"),"shapeHash":hash_byte.repeat(64),
        "parentStockManifestHash":stock.manifest_hash(),"parentStockCatalogHash":stock.catalog_hash,"buildHash":"0".repeat(64),"anatomyHash":"0".repeat(64),
        "targetRegistrationHash":"1".repeat(64),"instanceId":format!("instance:{key}"),"physicalBarrelId":format!("physical:{key}"),
        "physicalContactSourceKeys":[format!("source:{key}")],"moduleRef":key,"mountedWeaponKey":format!("weapon:{key}"),"recipe":recipe,
        "rendererAttributeUploadHash":mesh.render_buffer_hash,"positionPayloadHash":mesh.payload_hash,"damagedManifestHash":derived.manifest_hash(),
        "damagedCatalogHash":derived.catalog_hash,"triangleProvenanceHash":"2".repeat(64)});
    let mut record:BarrelShapeVariantV1=serde_json::from_value(value).unwrap();record.source_mesh_key=key.into();record
}
#[test]
fn composed_scene_retains_both_removed_spaces_and_independent_restore(){
    let mut store=MeshStore::default();let stock_meshes=vec![mesh(&mut store,"left",0.,1.),mesh(&mut store,"right",2.,1.),mesh(&mut store,"unknown",4.,1.)];
    let stock_manifest=manifest(stock_meshes);let stock=scene(stock_manifest.clone(),&store,&"a".repeat(64),None);
    let mut left_manifest=stock_manifest.clone();left_manifest["meshes"][0]=mesh(&mut store,"left",0.,0.2);
    let mut right_manifest=stock_manifest.clone();right_manifest["meshes"][1]=mesh(&mut store,"right",2.,0.2);
    let left=scene(left_manifest,&store,&"b".repeat(64),Some("b".repeat(64)));
    let right=scene(right_manifest,&store,&"c".repeat(64),Some("c".repeat(64)));
    let left_record=record(&stock,&left,"left","b");let right_record=record(&stock,&right,"right","c");
    let mut context=stock.context.clone();context.shape_hash=None;
    let composed=stock.compose_barrel_variants(&[(&left,&left_record),(&right,&right_record)],&store,context.clone()).unwrap();
    let hits=|s:&CombatScene,x:f32,y:f32|s.crossings(Vec3::new(x,y,-1.),Vec3::new(x,y,1.)).unwrap();
    assert!(!hits(&stock,0.5,0.25).is_empty());assert!(!hits(&stock,2.5,0.25).is_empty());
    assert!(hits(&composed,0.5,0.25).is_empty());assert!(hits(&composed,2.5,0.25).is_empty());
    assert!(!hits(&composed,0.1,0.1).is_empty());assert!(!hits(&composed,2.1,0.1).is_empty());
    assert!(matches!(composed.binding("instance:unknown",None,"surface:unknown").unwrap().kind,EvKind::Unknown));
    let restored_left=stock.compose_barrel_variants(&[(&right,&right_record)],&store,context.clone()).unwrap();
    assert!(!hits(&restored_left,0.5,0.25).is_empty());assert!(hits(&restored_left,2.5,0.25).is_empty());
    assert_eq!(restored_left.manifest_hash(),right_record.damaged_manifest_hash);
    assert_eq!(composed.context.shape_hash,Some(sha256(format!("BarrelShapeCompositionV1\0{}\0{}\0{}",stock.manifest_hash(),"b".repeat(64),"c".repeat(64)).as_bytes())));
    let reversed=stock.compose_barrel_variants(&[(&right,&right_record),(&left,&left_record)],&store,context).unwrap();
    assert_eq!(composed.manifest_hash(),reversed.manifest_hash());
    assert_eq!(composed.context.shape_hash,reversed.context.shape_hash);
}
#[test]
fn composed_scene_refuses_overlap_wrong_parent_and_wrong_derivative(){
    let mut store=MeshStore::default();let m=manifest(vec![mesh(&mut store,"a",0.,1.)]);let stock=scene(m.clone(),&store,&"a".repeat(64),None);
    let mut d=m;d["meshes"][0]=mesh(&mut store,"a",0.,0.2);let variant=scene(d,&store,&"b".repeat(64),Some("b".repeat(64)));
    let first=record(&stock,&variant,"a","b");let mut second=first.clone();second.shape_id="second".into();second.shape_hash="c".repeat(64);
    let mut ctx=stock.context.clone();ctx.shape_hash=None;
    assert!(stock.compose_barrel_variants(&[(&variant,&first),(&variant,&first)],&store,ctx.clone()).is_err());
    assert!(stock.compose_barrel_variants(&[(&variant,&second)],&store,ctx.clone()).is_err());
    second=first.clone();second.parent_stock_manifest_hash="d".repeat(64);
    assert!(stock.compose_barrel_variants(&[(&variant,&second)],&store,ctx).is_err());
}
fn target()->Target {
    let def=serde_json::from_value(json!({"id":"test","plates":[],"modules":[
        {"id":"tube","kind":"gun_barrel","center":{"x":0,"y":0,"z":0},"half_extents":{"x":1,"y":1,"z":1},"max_health":100,"health":100},
        {"id":"receiver","kind":"gun_breech","center":{"x":0,"y":0,"z":0},"half_extents":{"x":1,"y":1,"z":1},"max_health":100,"health":100},
        {"id":"mg_tube","kind":"machine_gun","center":{"x":0,"y":0,"z":0},"half_extents":{"x":1,"y":1,"z":1},"max_health":40,"health":40},
        {"id":"aps_tube","kind":"aps_gun","center":{"x":0,"y":0,"z":0},"half_extents":{"x":1,"y":1,"z":1},"max_health":40,"health":40}],
        "crew":[],"weapons":{"secondary":[{"id":"coax","mount":"coax"}]}})).unwrap();
    let mut target=Target::new(def,&[]);
    for (key,kind,ti,gi,secondary,critical) in [("primary","cannon",Some(0),Some(0),None,vec![0,1]),
        ("coax","machine_gun",Some(0),None,Some("coax"),vec![2]),("aps","cannon",Some(1),Some(0),None,vec![3])]{
        let binding=serde_json::from_value(json!({"key":key,"kind":kind,"model_id":"same-catalog-gun","turret_index":ti,"gun_index":gi,"secondary_id":secondary,
            "ammo":[],"missile":null,"critical":critical,"dispersion_parts":[],"ammo_racks":[],"traverse":[],"elevation":[],"binding_error":null})).unwrap();
        target.weapon_bindings.insert(key.into(),binding);
    }target
}
#[test]
fn declared_ancestor_and_actual_weapon_table_own_main_mg_and_aps(){
    let mut store=MeshStore::default();let m=manifest(vec![mesh(&mut store,"tube",0.,1.)]);let stock=scene(m,&store,&"a".repeat(64),None);
    let mut record=record(&stock,&stock,"tube","b");let target=target();record.module_ref="tube".into();record.mounted_weapon_key="primary".into();
    assert_eq!(physical_weapon_module(&target,&record).unwrap(),0);
    let mut manifest:HitMeshManifestV1=stock.geometry.borrow().manifest.clone();
    let mut child=manifest.assemblies[0].clone();child.key="imported-leaf".into();child.parent=Some("root".into());child.joint=json!({"status":"undeclared","kind":"static"});manifest.assemblies.push(child);
    let mut instance=manifest.mesh_instances[0].clone();instance.assembly_key="imported-leaf".into();
    let mut change=record.mesh_changes().remove(0);
    assert!(physical_joint(&target,&manifest,&instance,&change,&record).is_err());
    change.effective_recoil_assembly_key=Some("root".into());assert!(physical_joint(&target,&manifest,&instance,&change,&record).is_ok());
    manifest.assemblies[0].joint["kind"]=json!("gun");assert!(physical_joint(&target,&manifest,&instance,&change,&record).is_ok());
    record.module_ref="receiver".into();assert!(physical_weapon_module(&target,&record).is_err());
    record.module_ref="mg_tube".into();record.mounted_weapon_key="coax".into();assert_eq!(physical_weapon_module(&target,&record).unwrap(),2);
    manifest.assemblies[0].joint["kind"]=json!("recoil");assert!(physical_joint(&target,&manifest,&instance,&change,&record).is_ok());
    manifest.assemblies[0].joint=json!({"status":"declared","kind":"mg","mountedWeaponKey":"coax","machineGunId":"coax"});
    assert!(physical_joint(&target,&manifest,&instance,&change,&record).is_ok());
    manifest.assemblies[0].joint["mountedWeaponKey"]=json!("other-mg");assert!(physical_joint(&target,&manifest,&instance,&change,&record).is_err());
    record.module_ref="aps_tube".into();record.mounted_weapon_key="aps".into();assert_eq!(physical_weapon_module(&target,&record).unwrap(),3);
    manifest.assemblies[0].joint=json!({"status":"declared","kind":"gun","turret":1,"gun":0});assert!(physical_joint(&target,&manifest,&instance,&change,&record).is_ok());
    manifest.assemblies[0].joint["gun"]=json!(1);assert!(physical_joint(&target,&manifest,&instance,&change,&record).is_err());
    change.effective_recoil_assembly_key=Some("unrelated-sibling".into());assert!(physical_joint(&target,&manifest,&instance,&change,&record).is_err());
}
