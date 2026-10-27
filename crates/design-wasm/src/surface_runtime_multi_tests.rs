use super::*;
use tg_combat::geometry::manifest::sha256;

fn seal(mut v:Value,member:&str)->(Value,String,String){
    v.as_object_mut().unwrap().remove(member);let hash=sha256(&serde_json::to_vec(&v).unwrap());v[member]=json!(hash);
    let text=serde_json::to_string(&v).unwrap();let file_hash=sha256(text.as_bytes());(v,text,file_hash)
}
fn identity()->[u32;16]{[1f32,0.,0.,0.,0.,1.,0.,0.,0.,0.,1.,0.,0.,0.,0.,1.].map(f32::to_bits)}
fn fixture_mesh(runtime:&mut SurfaceRuntime,index:usize,width:f32)->Value{
    let x=index as f32*3.;let mut bytes=b"THMESH1\0".to_vec();for w in [1u32,3,1,36,12,0]{bytes.extend(w.to_le_bytes());}
    for point in [[x,0.,0.],[x+width,0.,0.],[x,1.,0.]]{for f in point{bytes.extend(f.to_le_bytes());}}
    for i in [0u32,1,2]{bytes.extend(i.to_le_bytes());}let hash=sha256(&bytes);let m=runtime.store.install(&bytes,&hash).unwrap();
    json!({"key":format!("mesh:{index}"),"payloadHash":hash,"positionsHash":m.data.position_hash,"renderBufferHash":hash,
        "vertexCount":3,"triangleCount":1,"bounds":m.data.bounds,"bvh":null,
        "ranges":[{"first":0,"count":1,"sourceKey":format!("source:{index}"),"surfaceKey":format!("surface:{index}"),"solidKey":null,"bindingKey":null}]})
}
struct Pair {runtime:SurfaceRuntime,target:Target,updates:Vec<(String,[f64;16])>,ids:Vec<String>}
fn pair()->Pair{
    let mut modules=vec![];
    for i in 0..2 {for (part,kind) in [("tube","gun_barrel"),("breech","gun_breech")]{modules.push(json!({
        "id":format!("{part}:{i}"),"kind":kind,"center":{"x":i*3,"y":0,"z":0},"half_extents":{"x":0.1,"y":0.1,"z":0.1},
        "max_health":1,"health":1,"weapon_group":format!("gun:0:{i}"),"external":true,"turret_index":0}));}}
    let def=serde_json::from_value(json!({"id":"pair","plates":[],"modules":modules,
        "crew":[{"role":"commander","pos":{"x":20,"y":0,"z":0},"radius":0.1,"health":100},
            {"role":"driver","pos":{"x":21,"y":0,"z":0},"radius":0.1,"health":100}],
        "weapons":{"mount_m":[0,0,0],"main_gun":{"id":"identical-catalog-model","damage":{"critical":["tube:0","breech:0"]}},
            "extra_guns":[{"mount_m":[3,0,0],"gun":{"id":"identical-catalog-model","damage":{"critical":["tube:1","breech:1"]}}}]}})).unwrap();
    let target=Target::new(def,&[]);assert!(target.binding_errors.is_empty(),"{:?}",target.binding_errors);
    let anatomy=json!({"armor":target.def.plates,"modules":target.def.modules,"crew":target.def.crew,"weapons":target.def.weapons});
    let ah=sha256(&serde_json::to_vec(&anatomy).unwrap());let z="0".repeat(64);let mut runtime=SurfaceRuntime::default();
    let meshes:Vec<_>=(0..3).map(|i|fixture_mesh(&mut runtime,i,1.)).collect();
    let declarations:Vec<_>=(0..3).map(|i|{let mut d=json!({"meshKey":format!("mesh:{i}"),"sourceKey":format!("source:{i}"),"first":0,"count":1,
        "role":"module","moduleRef":format!("tube:{}",i%2),"contactEligible":true,"resistancePolicy":"no_authored_armor",
        "armorBinding":{"status":"none","armorRefs":[],"layerKey":null},"declaration":{"basis":"native_synthetic_physical_tube","revision":"fixture"}});
        let hash=sha256(&serde_json::to_vec(&d).unwrap());d["declaration"]["contentHash"]=json!(hash);d["key"]=json!(format!("decl:{hash}"));d}).collect();
    let instances:Vec<_>=(0..3).map(|i|json!({"key":format!("instance:{i}"),"meshKey":format!("mesh:{i}"),"assemblyKey":format!("recoil:{}",i%2),
        "sourceKey":format!("source:{i}"),"worldBits":identity(),"instanceBits":identity(),"materialFeature":{},"activityPolicy":"static_fixture"})).collect();
    let manifest=json!({"schema":"HitMeshManifestV1","format":"THMESH1","endianness":"LE","generator":{"revision":"fixture","sha256":z},
        "buildRecipeHash":z,"specId":"pair","buildHash":z,"renderGeometryHash":z,"anatomyDataHash":ah,"sources":{"assets":[]},"meshes":meshes,
        "assemblies":(0..2).map(|i|json!({"key":format!("recoil:{i}"),"parent":null,"baseTransformBits":identity(),"pivot":[0,0,0],
            "joint":{"status":"declared","kind":"recoil","turret":0,"gun":i},"allowedMotionFields":[]})).collect::<Vec<_>>(),"meshInstances":instances,"bindings":[],
        "surfaces":(0..3).map(|i|json!({"key":format!("surface:{i}"),"role":"module","topology":"open_sheet","winding":"emitted","responseRef":declarations[i]["key"],
            "armorLayerKey":null,"moduleKey":null,"crewKey":null,"fuseEligible":false,"contactEligible":true})).collect::<Vec<_>>(),
        "audits":{"certification":"audit_pending_diagnostic","triangleCoverage":3,"unclassifiedPhysicalTriangles":0,"degenerateCount":0,"boundaryEdges":0,"nonmanifoldEdges":0,
            "missingBindings":0,"ambiguousBindings":0,"renderPositionDifferences":0}});
    let (manifest,mt,mh)=seal(manifest,"manifestHash");
    let catalog=json!({"schema":"HitBindingCatalogV1","manifestHash":mh,"specId":"pair","buildHash":z,"anatomyHash":ah,"targetRegistrationHash":target.registration_hash(),
        "geometryBytesChanged":0,"sourceGeneratorHash":z,"acceptedAnatomy":anatomy,"declarations":declarations,"layers":[],
        "instances":(0..3).map(|i|json!({"instanceKey":format!("instance:{i}"),"assemblyKey":format!("recoil:{}",i%2),"materialFeature":{}})).collect::<Vec<_>>()});
    let (catalog,ct,ch)=seal(catalog,"catalogHash");let updates:Vec<_>=(0..3).map(|i|(format!("instance:{i}"),identity().map(|b|f32::from_bits(b)as f64))).collect();
    runtime.call("combat_surface_register",&json!({"key":"pair","manifest":mt,"manifestHash":mh,"catalog":ct,"catalogHash":ch,"updates":updates,
        "poseContext":{"entityId":"7:9:1","spawnEpoch":1,"buildHash":z,"poseRevision":0}}),Some(&target)).unwrap();
    let mut ids=vec![];
    for i in 0..2 {
        let shape_id=format!("variant:{i}");let shape_hash=sha256(shape_id.as_bytes());let recipe=json!({"schema":"BarrelFractureRecipeV1","sourceMeshKey":format!("mesh:{i}"),
            "cutPlaneBits":0,"cutPlaneLocalZ":0,"keepSide":"local_z_le_cut"});let mut dm=manifest.clone();dm["meshes"][i]=fixture_mesh(&mut runtime,i,0.2);
                if i==0{dm["meshes"][2]=fixture_mesh(&mut runtime,2,0.2);}
        let (_,dmt,dmh)=seal(dm.clone(),"manifestHash");let mut dc=catalog.clone();dc["manifestHash"]=json!(dmh);dc["geometryBytesChanged"]=json!(1);
        dc["shapeVariant"]=json!({"shapeId":shape_id,"parentStockManifestHash":mh,"parentStockCatalogHash":ch,"recipe":recipe});
        let (_,dct,dch)=seal(dc,"catalogHash");let mut record:BarrelShapeVariantV1=serde_json::from_value(json!({"schema":"BarrelShapeVariantV1","shapeId":shape_id,"shapeHash":shape_hash,
            "parentStockManifestHash":mh,"parentStockCatalogHash":ch,"buildHash":z,"anatomyHash":ah,"targetRegistrationHash":target.registration_hash(),
            "instanceId":format!("instance:{i}"),"physicalBarrelId":format!("physical:{i}"),"physicalContactSourceKeys":[format!("source:{i}")],"moduleRef":format!("tube:{i}"),
            "mountedWeaponKey":format!("gun:0:{i}"),"recipe":recipe,"rendererAttributeUploadHash":dm["meshes"][i]["renderBufferHash"],"positionPayloadHash":dm["meshes"][i]["payloadHash"],
            "damagedManifestHash":dmh,"damagedCatalogHash":dch,"triangleProvenanceHash":z})).unwrap();record.source_mesh_key=format!("mesh:{i}");
        if i==0{
            record.changed_meshes=vec![record.mesh_changes().remove(0),tg_combat::geometry::combat_scene::BarrelChangedMeshV1{
                source_mesh_key:"mesh:2".into(),instance_id:"instance:2".into(),physical_contact_source_keys:vec!["source:2".into()],
                recipe:json!({"schema":"BarrelFractureRecipeV1","sourceMeshKey":"mesh:2","cutPlaneBits":0,"cutPlaneLocalZ":0,"keepSide":"local_z_le_cut"}),
                renderer_attribute_upload_hash:dm["meshes"][2]["renderBufferHash"].as_str().unwrap().into(),
                position_payload_hash:dm["meshes"][2]["payloadHash"].as_str().unwrap().into(),triangle_provenance_hash:None,effective_recoil_assembly_key:Some("recoil:0".into())}];
        }
        let reply=runtime.register_variant(&json!({"key":"pair","manifest":dmt,"manifestHash":dmh,"catalog":dct,"catalogHash":dch}),Some(&target),record).unwrap();
        assert_eq!(reply["activeVariantIds"],json!([]));assert_eq!(runtime.owners["pair"].variants.len(),i+1);ids.push(shape_id);
    }
    Pair {runtime,target,updates,ids}
}
fn pair_context(f:&Pair,event:&str)->tg_combat::causes::DamageContext{
    let scope=&f.runtime.scopes["pair"];serde_json::from_value(json!({"actor":{"battle":7,"entity":9,"life":1},"shooter":{"battle":7,"entity":8,"life":1},
        "event_id":event,"shot_id":format!("{event}:shot"),"pose_revision":scope.pose_revision,"geometry_revision":scope.geometry_revision})).unwrap()
}
fn shot(f:&mut Pair,state:&TargetState,i:usize)->Value{
    let origin=Vec3::new(i as f32*3.+0.5,0.25,-1.);let end=Vec3::new(origin.x,origin.y,1.);
    let shot=Shot {shell:serde_json::from_slice(&read("data/projectiles/apcr_88_pzgr40.json")).unwrap(),origin,dir:(end-origin).normalized(),speed_ms:1130.,distance_m:0.,seed:1,turret_yaw:0.};
    let ctx=pair_context(f,&format!("hit:{i}"));f.runtime.shoot("pair",&f.target,state,&shot,end,Some(&ctx)).unwrap()
}
fn commit(f:&mut Pair,p:&Value)->Value{
    let scope=&f.runtime.scopes["pair"];let req=json!({"key":"pair","token":p["token"],"expectedGeometryRevision":p["expectedGeometryRevision"],"shapeId":p["shapeId"],"updates":f.updates,
        "poseContext":{"entityId":scope.entity_id,"spawnEpoch":scope.spawn_epoch,"buildHash":scope.build_hash,"poseRevision":scope.pose_revision+1,"geometryRevision":p["geometryRevision"],"shapeHash":p["shapeHash"]}});
    f.runtime.call("combat_surface_shape_commit",&req,Some(&f.target)).unwrap()
}
#[test]
fn second_weapon_destroyed_during_first_repair_stays_fractured_after_completion(){
    let mut f=pair();let fresh=f.target.fresh_state();let left=shot(&mut f,&fresh,0);let mut state:TargetState=serde_json::from_value(left["state"].clone()).unwrap();
    assert_eq!(state.modules[0],0.);commit(&mut f,&left["shape_transition"]);
    assert!(tg_combat::start_repair(&f.target,&mut state));assert_eq!(state.repair_targets,Some(vec![0]));
    f.runtime.observe_repair_start("pair",&state,true).unwrap();let right=shot(&mut f,&state,1);state=serde_json::from_value(right["state"].clone()).unwrap();
    let pending=right["shape_transition"].clone();assert_eq!(pending["activeVariantIds"],json!(f.ids));let frozen=right.clone();commit(&mut f,&pending);
    let before=state.clone();let dt=state.repair_s+1.;f.runtime.verify_advance("pair",&state,dt).unwrap();let events=tg_combat::advance(&f.target,&mut state,dt,1);
    f.runtime.observe_advance("pair",&before,&state,&events,"left-repair-done").unwrap();let repair=f.runtime.pending("pair");
    assert_eq!(repair["activeVariantIds"],json!([f.ids[1]]));assert_eq!(repair["cause"],"core_repaired_barrel");assert_eq!(repair["repairGeneration"],1);
    assert_eq!(state.modules[2],0.);let result=commit(&mut f,&repair);assert_eq!(result["geometryRevision"],3);assert_eq!(result["shapeId"],f.ids[1]);
    let scene=&f.runtime.scenes["pair"];assert!(!scene.crossings(Vec3::new(0.5,0.25,-1.),Vec3::new(0.5,0.25,1.)).unwrap().is_empty());
    assert!(scene.crossings(Vec3::new(3.5,0.25,-1.),Vec3::new(3.5,0.25,1.)).unwrap().is_empty());assert_eq!(right,frozen);
}
#[test]
fn two_uncommitted_physical_destructions_issue_one_complete_atomic_scene(){
    let mut f=pair();let fresh=f.target.fresh_state();let first=shot(&mut f,&fresh,0);let state=serde_json::from_value(first["state"].clone()).unwrap();
    let second=shot(&mut f,&state,1);assert_eq!(second["shape_transition"]["activeVariantIds"],json!(f.ids));
    assert_eq!(second["shape_transition"]["transitionVariantIds"],json!(f.ids));assert_eq!(f.runtime.scopes["pair"].geometry_revision,0);
    commit(&mut f,&second["shape_transition"]);assert_eq!(f.runtime.scopes["pair"].geometry_revision,1);
    assert_eq!(f.runtime.owners["pair"].active_variant_ids,f.ids);
}
#[test]
fn secondary_upload_primary_contact_destroys_one_complete_multi_mesh_weapon(){
    let mut f=pair();let fresh=f.target.fresh_state();let report=shot(&mut f,&fresh,2);
    assert_eq!(report["shape_transition"]["activeVariantIds"],json!([f.ids[0]]));commit(&mut f,&report["shape_transition"]);
    for x in [0.5,6.5]{assert!(f.runtime.scenes["pair"].crossings(Vec3::new(x,0.25,-1.),Vec3::new(x,0.25,1.)).unwrap().is_empty());}
    assert!(!f.runtime.scenes["pair"].crossings(Vec3::new(3.5,0.25,-1.),Vec3::new(3.5,0.25,1.)).unwrap().is_empty());
    let before:&TargetState=&serde_json::from_value(report["state"].clone()).unwrap();assert_eq!(before.modules[0],0.);assert_eq!(before.modules[2],1.);
}
#[test]
fn pending_first_repair_and_later_second_fracture_require_both_core_witnesses(){
    let mut f=pair();let fresh=f.target.fresh_state();let first=shot(&mut f,&fresh,0);let mut state:TargetState=serde_json::from_value(first["state"].clone()).unwrap();
    commit(&mut f,&first["shape_transition"]);assert!(tg_combat::start_repair(&f.target,&mut state));f.runtime.observe_repair_start("pair",&state,true).unwrap();
    let before=state.clone();let dt=state.repair_s+1.;let events=tg_combat::advance(&f.target,&mut state,dt,1);
    f.runtime.observe_advance("pair",&before,&state,&events,"first-complete").unwrap();let old_token=f.runtime.pending("pair")["token"].clone();
    let second=shot(&mut f,&state,1);let p=&second["shape_transition"];
    assert_eq!(p["activeVariantIds"],json!([f.ids[1]]));assert_eq!(p["transitionVariantIds"],json!(f.ids));
    assert_eq!(p["repairGeneration"],1);assert_ne!(p["token"],old_token);commit(&mut f,p);
    assert_eq!(f.runtime.owners["pair"].active_variant_ids,vec![f.ids[1].clone()]);
}
#[test]
fn new_damage_retires_only_invalid_repair_action_in_a_mixed_pending_shape(){
    let mut f=pair();let fresh=f.target.fresh_state();let first=shot(&mut f,&fresh,0);let mut state:TargetState=serde_json::from_value(first["state"].clone()).unwrap();
    commit(&mut f,&first["shape_transition"]);assert!(tg_combat::start_repair(&f.target,&mut state));f.runtime.observe_repair_start("pair",&state,true).unwrap();
    let before=state.clone();let dt=state.repair_s+1.;let events=tg_combat::advance(&f.target,&mut state,dt,1);
    f.runtime.observe_advance("pair",&before,&state,&events,"first-complete").unwrap();let second=shot(&mut f,&state,1);state=serde_json::from_value(second["state"].clone()).unwrap();
    let old=f.runtime.pending("pair");state.modules[0]=0.;f.runtime.observe_report("pair",&state);
    let pending=f.runtime.pending("pair");assert_eq!(pending["activeVariantIds"],json!(f.ids));
    assert_eq!(pending["transitionVariantIds"],json!([f.ids[1]]));assert_ne!(pending["token"],old["token"]);
    commit(&mut f,&pending);assert_eq!(f.runtime.owners["pair"].active_variant_ids,f.ids);
}
#[test]
fn repair_completion_preserves_another_weapons_uncommitted_physical_destruction(){
    let mut f=pair();let fresh=f.target.fresh_state();let first=shot(&mut f,&fresh,0);let mut state:TargetState=serde_json::from_value(first["state"].clone()).unwrap();
    commit(&mut f,&first["shape_transition"]);assert!(tg_combat::start_repair(&f.target,&mut state));
    f.runtime.observe_repair_start("pair",&state,true).unwrap();
    let second=shot(&mut f,&state,1);state=serde_json::from_value(second["state"].clone()).unwrap();
    let old=second["shape_transition"].clone();let frozen=second.clone();
    assert_eq!(old["activeVariantIds"],json!(f.ids));assert_eq!(f.runtime.scopes["pair"].geometry_revision,1);
    let before=state.clone();let dt=state.repair_s+1.;f.runtime.verify_advance("pair",&state,dt).unwrap();
    let events=tg_combat::advance(&f.target,&mut state,dt,1);
    f.runtime.observe_advance("pair",&before,&state,&events,"repair-before-second-commit").unwrap();
    let pending=f.runtime.pending("pair");
    assert_eq!(pending["activeVariantIds"],json!([f.ids[1]]),"repair must retain the pending physical destruction of the other weapon");
    assert_eq!(pending["transitionVariantIds"],json!(f.ids));assert_eq!(pending["repairGeneration"],1);
    assert_eq!(pending["shotId"],old["shotId"]);assert_ne!(pending["token"],old["token"]);
    for member in ["entityId","spawnEpoch","expectedGeometryRevision","geometryRevision"]{assert_eq!(pending[member],old[member]);}
    assert_eq!(state.modules[2],0.);assert!(state.modules[0]>0.);
    let scope=&f.runtime.scopes["pair"];
    let old_request=json!({"key":"pair","token":old["token"],"expectedGeometryRevision":old["expectedGeometryRevision"],"shapeId":old["shapeId"],"updates":f.updates,
        "poseContext":{"entityId":scope.entity_id,"spawnEpoch":scope.spawn_epoch,"buildHash":scope.build_hash,"poseRevision":scope.pose_revision+1,
            "geometryRevision":old["geometryRevision"],"shapeHash":old["shapeHash"]}});
    assert!(f.runtime.call("combat_surface_shape_commit",&old_request,Some(&f.target)).is_err());
    assert_eq!(f.runtime.scopes["pair"].geometry_revision,1);
    let result=commit(&mut f,&pending);assert_eq!(result["activeVariantIds"],json!([f.ids[1]]));assert_eq!(result["geometryRevision"],2);
    let scene=&f.runtime.scenes["pair"];assert!(!scene.crossings(Vec3::new(0.5,0.25,-1.),Vec3::new(0.5,0.25,1.)).unwrap().is_empty());
    assert!(scene.crossings(Vec3::new(3.5,0.25,-1.),Vec3::new(3.5,0.25,1.)).unwrap().is_empty());assert_eq!(second,frozen);
}
#[test]
fn completed_repair_token_survives_new_repair_generation_for_another_module(){
    let mut f=pair();let fresh=f.target.fresh_state();let hit=shot(&mut f,&fresh,0);let mut state:TargetState=serde_json::from_value(hit["state"].clone()).unwrap();
    commit(&mut f,&hit["shape_transition"]);assert!(tg_combat::start_repair(&f.target,&mut state));f.runtime.observe_repair_start("pair",&state,true).unwrap();
    let before=state.clone();let dt=state.repair_s+1.;let events=tg_combat::advance(&f.target,&mut state,dt,1);
    f.runtime.observe_advance("pair",&before,&state,&events,"first-core-completion").unwrap();let completed=f.runtime.pending("pair");
    assert_eq!(completed["shapeId"],"stock");assert_eq!(completed["repairGeneration"],1);
    // Another observed core module result starts a later repair; the first
    // completed physical restoration still awaits the renderer's commit.
    state.modules[1]=0.;f.runtime.observe_report("pair",&state);
    assert!(tg_combat::start_repair(&f.target,&mut state));assert_eq!(state.repair_targets,Some(vec![1]));
    f.runtime.observe_repair_start("pair",&state,true).unwrap();
    assert_eq!(f.runtime.owners["pair"].repair_generation,2);assert_eq!(f.runtime.pending("pair"),completed);
    commit(&mut f,&completed);assert!(f.runtime.owners["pair"].active_variant_ids.is_empty());
    assert!(f.runtime.owners["pair"].repair.is_some());assert_eq!(f.runtime.owners["pair"].repair.as_ref().unwrap().generation,2);
}
#[test]
fn repair_start_preserves_uncommitted_actual_physical_destruction(){
    let mut f=pair();let fresh=f.target.fresh_state();let left=shot(&mut f,&fresh,0);let mut state:TargetState=serde_json::from_value(left["state"].clone()).unwrap();
    commit(&mut f,&left["shape_transition"]);let right=shot(&mut f,&state,1);state=serde_json::from_value(right["state"].clone()).unwrap();
    let pending=right["shape_transition"].clone();assert_eq!(pending["activeVariantIds"],json!(f.ids));
    assert!(tg_combat::start_repair(&f.target,&mut state));f.runtime.observe_repair_start("pair",&state,true).unwrap();
    assert_eq!(f.runtime.pending("pair"),pending,"starting repair cannot discard physical destruction already witnessed by the core");
    commit(&mut f,&pending);assert_eq!(f.runtime.owners["pair"].active_variant_ids,f.ids);
    assert_eq!(state.modules[0],0.);assert_eq!(state.modules[2],0.);
}
#[test]
fn delayed_restorations_keep_their_independent_core_completed_generations(){
    let mut f=pair();let fresh=f.target.fresh_state();let left=shot(&mut f,&fresh,0);let mut state:TargetState=serde_json::from_value(left["state"].clone()).unwrap();
    commit(&mut f,&left["shape_transition"]);assert!(tg_combat::start_repair(&f.target,&mut state));f.runtime.observe_repair_start("pair",&state,true).unwrap();
    let right=shot(&mut f,&state,1);state=serde_json::from_value(right["state"].clone()).unwrap();commit(&mut f,&right["shape_transition"]);
    let before=state.clone();let dt=state.repair_s+1.;let events=tg_combat::advance(&f.target,&mut state,dt,1);
    f.runtime.observe_advance("pair",&before,&state,&events,"left-completed").unwrap();let first_restore=f.runtime.pending("pair");
    assert!(tg_combat::start_repair(&f.target,&mut state));assert_eq!(state.repair_targets,Some(vec![2]));f.runtime.observe_repair_start("pair",&state,true).unwrap();
    assert_eq!(f.runtime.pending("pair"),first_restore);
    let before=state.clone();let dt=state.repair_s+1.;let events=tg_combat::advance(&f.target,&mut state,dt,1);
    f.runtime.observe_advance("pair",&before,&state,&events,"right-completed").unwrap();let both=f.runtime.pending("pair");
    assert_eq!(both["activeVariantIds"],json!([]));assert_eq!(both["transitionVariantIds"],json!(f.ids));
    assert_eq!(both["repairGenerations"],json!({f.ids[0].clone():1,f.ids[1].clone():2}));
    commit(&mut f,&both);assert!(f.runtime.owners["pair"].completed_repairs.is_empty());
    for x in [0.5,3.5,6.5]{assert!(!f.runtime.scenes["pair"].crossings(Vec3::new(x,0.25,-1.),Vec3::new(x,0.25,1.)).unwrap().is_empty());}
}
#[test]
fn positive_health_and_a_generation_number_cannot_mint_a_completed_repair_witness(){
    let mut f=pair();let fresh=f.target.fresh_state();let hit=shot(&mut f,&fresh,0);let mut state:TargetState=serde_json::from_value(hit["state"].clone()).unwrap();
    commit(&mut f,&hit["shape_transition"]);state.modules[0]=0.6;f.runtime.observe_report("pair",&state);
    assert!(f.runtime.issue("pair",vec![],vec![f.ids[0].clone()],"invented-completion","",Some(1)).is_err());
    assert!(f.runtime.pending("pair").is_null());assert_eq!(f.runtime.owners["pair"].active_variant_ids,vec![f.ids[0].clone()]);
}
