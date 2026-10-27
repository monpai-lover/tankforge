//! Local-authority surface combat. No diagnostic opt-in or client mesh replacement.
use std::collections::HashMap;
use serde_json::{json,Value};
use tg_combat::{Target,TargetState,Shot,Report,geometry::{Geometry,MeshStore,
    combat_scene::{CombatScene,BarrelShapeVariantV1,barrel_composition_identity},surface::QueryContext}};

struct LoadedVariant {record:BarrelShapeVariantV1,scene:CombatScene,module:usize}
fn primary_fracture(scene:&CombatScene,variant:&LoadedVariant,before:&TargetState,report:&Report,fractured:bool)->bool {
    !fractured&&before.modules[variant.module]>0.&&report.state.modules[variant.module]==0.
        &&report.primary_module_destructions.iter().any(|d|d["moduleRef"]==variant.record.module_ref
            &&d["beforeHealth"].as_f64().is_some_and(|h|h>0.)&&d["afterHealth"]==0
            &&scene.physical_barrel_contact(&d["contact"],&variant.record))
        &&report.primary_geometry_contacts.iter().any(|c|scene.physical_barrel_contact(c,&variant.record))
}
struct RepairWitness {generation:u64,remaining:f32,targets:Option<Vec<usize>>}
#[derive(Clone)]
struct PendingShape {token:String,old_revision:u64,new_revision:u64,shape_id:String,shape_hash:String,
    event_id:String,shot_id:String,repair_generation:Option<u64>,repair_generations:HashMap<String,u64>,
    active_variant_ids:Vec<String>,transition_variant_ids:Vec<String>}
struct ShapeOwner {variants:HashMap<String,LoadedVariant>,stock:CombatScene,active_variant_ids:Vec<String>,health:Vec<f32>,
    destroyed:bool,crew:Vec<f32>,
    repair_generation:u64,repair:Option<RepairWitness>,completed_repairs:HashMap<String,u64>,pending:Option<PendingShape>}
#[derive(Default)]
pub(crate) struct SurfaceRuntime {store:MeshStore,scenes:HashMap<String,CombatScene>,
    scopes:HashMap<String,QueryContext>,owners:HashMap<String,ShapeOwner>,token_counter:u64}

fn pinned_variant(req:&Value)->Result<BarrelShapeVariantV1,String>{
    let text:String=super::field(req,"record")?;let hash:String=super::field(req,"recordHash")?;
    let supplied:Value=serde_json::from_str(&text).map_err(|e|format!("variant JSON: {e}"))?;
    #[derive(serde::Deserialize)] struct Registry {schema:String,variants:Vec<Box<serde_json::value::RawValue>>}
    let registry:Registry=serde_json::from_str(include_str!("../../../data/barrel-shapes/index.json"))
        .map_err(|e|format!("compiled barrel registry: {e}"))?;
    if registry.schema!="BarrelShapeRegistryV1"||registry.variants.len()>256{return Err("compiled barrel registry contract".into());}
    for raw in registry.variants {
        let value:Value=serde_json::from_str(raw.get()).map_err(|e|e.to_string())?;
        if value["shapeId"]==supplied["shapeId"]&&value["shapeHash"]==supplied["shapeHash"] {
            return BarrelShapeVariantV1::parse_pinned(text.as_bytes(),&hash,raw.get().as_bytes());
        }
    }
    Err("barrel variant is not in the compiled trusted registry".into())
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs,path::PathBuf};
    use tg_shared::Vec3;
    use tg_combat::geometry::ray::{multiply,transform};
    mod multi_tests { include!("surface_runtime_multi_tests.rs"); }
    struct Fixture {runtime:SurfaceRuntime,target:Target,record:Value,updates:Vec<(String,[f64;16])>,barrel:[f64;16]}
    fn root()->PathBuf {PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")}
    fn read(path:&str)->Vec<u8> {fs::read(root().join(path)).unwrap()}
    fn value(path:&str)->Value {serde_json::from_slice(&read(path)).unwrap()}
    fn js_numbers(v:&mut Value) {
        match v {
            Value::Array(a)=>for v in a {js_numbers(v)},
            Value::Object(o)=>for v in o.values_mut(){js_numbers(v)},
            Value::Number(n) if n.is_f64()=>{let f=n.as_f64().unwrap();
                if f.fract()==0.&&f.abs()<=9_007_199_254_740_991.{*n=serde_json::Number::from(f as i64);}},
            _=>{}
        }
    }
    fn fixture()->Fixture {fixture_for("su_t72a")}
    fn target_for(id:&str)->Target {
        let vehicle=value(&format!("data/vehicles/{id}/vehicle.json"));
        let mut def=tg_combat::target_from_files("barrel-fixture",&vehicle,
            serde_json::from_slice(&read(&format!("data/vehicles/{id}/armor.json"))).unwrap(),
            serde_json::from_slice(&read(&format!("data/vehicles/{id}/modules.json"))).unwrap(),
            serde_json::from_slice(&read(&format!("data/vehicles/{id}/crew.json"))).unwrap());
        def.weapons=value(&format!("data/vehicles/{id}/weapons.json"));js_numbers(&mut def.weapons);
        def.ammo_capacity=tg_combat::ammo_capacity(&def.weapons);
        def.machine_guns=value("data/machine_guns.json");let visual=value(&format!("data/vehicles/{id}/visual.json"));
        let anchors=visual.get("mg_anchors").filter(|v|!v.is_null()).cloned().unwrap_or_else(||json!({}));
        let variants=visual.get("mg_variants").filter(|v|!v.is_null()).cloned().unwrap_or_else(||json!({}));
        def.visual=json!({"mg_anchors":anchors,"mg_variants":variants});
        let materials:Vec<_>=serde_json::from_slice(&read("data/materials.json")).unwrap();
        // Match the existing public targetDef neutral-frame adapter: source
        // hinge descriptors live in the authored geometry/pose owner.
        for plate in &mut def.plates{plate.hinge=None;}
        Target::new(def,&materials)
    }
    fn fixture_for(id:&str)->Fixture {
        let registry=value("data/barrel-shapes/index.json");
        let target=target_for(id);
        // The trust bank retains historical approvals. Exercise the newest
        // descendant that belongs to the current source engineering, while
        // compiled_registry_matches_current_pinned_record_files checks every
        // historical and current signed record independently.
        let signature=target.registration_hash();
        let record=registry["variants"].as_array().unwrap().iter().rev()
            .find(|r|r["specId"]==id&&r["targetRegistrationHash"]==signature).unwrap().clone();
        let parent=record["parentStockManifestHash"].as_str().unwrap();let catalog_hash=record["parentStockCatalogHash"].as_str().unwrap();
        let manifest=String::from_utf8(read(&format!("data/hit-meshes/{parent}.json"))).unwrap();
        let catalog=String::from_utf8(read(&format!("data/hit-bindings/{catalog_hash}.json"))).unwrap();
        let stock:Value=serde_json::from_str(&manifest).unwrap();let mut runtime=SurfaceRuntime::default();
        let load=|runtime:&mut SurfaceRuntime,m:&Value,dir:&str|{
            for mesh in m["meshes"].as_array().unwrap(){let hash=mesh["payloadHash"].as_str().unwrap();
                let preferred=format!("{dir}/{hash}.bin");let path=if root().join(&preferred).exists(){preferred}else{format!("data/hit-meshes/{hash}.bin")};
                runtime.call("combat_surface_install",&json!({"payload":read(&path),"expectedHash":hash}),None).unwrap();}
        };
        load(&mut runtime,&stock,"data/hit-meshes");
        let bits=|v:&Value|std::array::from_fn::<_,16,_>(|i|f32::from_bits(v[i].as_u64().unwrap()as u32)as f64);
        let updates:Vec<_>=stock["meshInstances"].as_array().unwrap().iter().map(|i|
            (i["key"].as_str().unwrap().to_owned(),multiply(bits(&i["worldBits"]),bits(&i["instanceBits"])))) .collect();
        let barrel=updates.iter().find(|(key,_)|key==record["instanceId"].as_str().unwrap()).unwrap().1;
        let reply=runtime.call("combat_surface_register",&json!({"key":"barrel-fixture","manifest":manifest,"manifestHash":parent,
            "catalog":catalog,"catalogHash":catalog_hash,"updates":updates,
            "poseContext":{"entityId":"7:9:1","spawnEpoch":1,"buildHash":record["buildHash"],"poseRevision":0}}),Some(&target))
            .unwrap_or_else(|e|panic!("{id}: stock target admission: {e}"));
        assert_eq!(reply["shapeId"],"stock");assert_eq!(reply["geometryRevision"],0);
        let mh=record["damagedManifestHash"].as_str().unwrap();let ch=record["damagedCatalogHash"].as_str().unwrap();
        let manifest=String::from_utf8(read(&format!("data/barrel-shapes/{mh}.json"))).unwrap();
        let catalog=String::from_utf8(read(&format!("data/barrel-shapes/{ch}.json"))).unwrap();
        load(&mut runtime,&serde_json::from_str(&manifest).unwrap(),"data/barrel-shapes");
        let rh=registry["recordFiles"][record["shapeId"].as_str().unwrap()].as_str().unwrap();
        let text=String::from_utf8(read(&format!("data/barrel-shapes/{rh}.json"))).unwrap();
        runtime.call("combat_surface_variant_register",&json!({"key":"barrel-fixture","record":text,"recordHash":rh,
            "manifest":manifest,"manifestHash":mh,"catalog":catalog,"catalogHash":ch}),Some(&target))
            .unwrap_or_else(|e|panic!("{id}: barrel variant admission: {e}"));
        Fixture {runtime,target,record,updates,barrel}
    }
    fn point(f:&Fixture,p:[f64;3])->Vec3 {let p=transform(&f.barrel,p);Vec3::new(p[0]as f32,p[1]as f32,p[2]as f32)}
    fn context(f:&Fixture,event:&str)->tg_combat::causes::DamageContext {
        let scope=&f.runtime.scopes["barrel-fixture"];
        serde_json::from_value(json!({"actor":{"battle":7,"entity":9,"life":1},"shooter":{"battle":7,"entity":8,"life":1},
            "event_id":event,"shot_id":format!("{event}:shot"),"pose_revision":scope.pose_revision,"geometry_revision":scope.geometry_revision})).unwrap()
    }
    fn fracture(f:&mut Fixture)->Value {
        let cut=f.record["recipe"]["cutPlaneLocalZ"].as_f64().unwrap();let max=f.record["tubeExtent"]["maxZ"].as_f64().unwrap();
        let state=f.target.fresh_state();damage_at(f,&state,(cut+max)*0.5,"actual-barrel-hit")
    }
    fn damage_at(f:&mut Fixture,state:&TargetState,z:f64,event:&str)->Value {
        let origin=point(f,[0.7,0.,z]);let end=point(f,[-0.7,0.,z]);
        let shot=Shot {shell:serde_json::from_slice(&read("data/projectiles/apcr_88_pzgr40.json")).unwrap(),origin,
            dir:(end-origin).normalized(),speed_ms:1130.,distance_m:0.,seed:1,turret_yaw:0.};
        let ctx=context(f,event);
        f.runtime.shoot("barrel-fixture",&f.target,state,&shot,end,Some(&ctx)).unwrap()
    }
    fn request(f:&Fixture,pending:&Value)->Value {
        let scope=&f.runtime.scopes["barrel-fixture"];
        json!({"key":"barrel-fixture","token":pending["token"],"expectedGeometryRevision":pending["expectedGeometryRevision"],
            "shapeId":pending["shapeId"],"updates":f.updates,"poseContext":{"entityId":scope.entity_id,"spawnEpoch":scope.spawn_epoch,
            "buildHash":scope.build_hash,"poseRevision":scope.pose_revision+1,"geometryRevision":pending["geometryRevision"],"shapeHash":pending["shapeHash"]}})
    }
    #[test]
    fn zero_neutral_public_targets_keep_source_hinge_descriptors_in_pinned_anatomy() {
        for id in ["de_flakpz38t","de_rso_pak40"]{
            let mut f=fixture_for(id);let catalog=value(&format!("data/hit-bindings/{}.json",f.record["parentStockCatalogHash"].as_str().unwrap()));
            assert!(catalog["acceptedAnatomy"]["armor"].as_array().unwrap().iter().any(|p|!p["hinge"].is_null()),"{id} source hinge metadata remains pinned");
            assert!(f.target.def.plates.iter().all(|p|p.hinge.is_none()),"{id} actual public neutral target strips source hinge metadata");
            let report=fracture(&mut f);assert!(report["shape_transition"]["token"].is_string(),"{id} actual primary tube hit");
            let mut def=f.target.def.clone();def.plates[0].center.x=f32::from_bits(def.plates[0].center.x.to_bits()+1);
            let changed=Target::new(def,&serde_json::from_slice::<Vec<_>>(&read("data/materials.json")).unwrap());
            assert_ne!(changed.registration_hash(),f.target.registration_hash());assert!(f.runtime.verify_target_registration("barrel-fixture",&changed).is_err());
        }
    }
    #[test]
    fn fractional_authored_armor_stock_and_variant_admit_without_changing_engineering() {
        let mut f=fixture_for("us_m8");let report=fracture(&mut f);
        assert!(report["shape_transition"]["token"].is_string());
    }
    #[test]
    fn one_f32_ulp_of_fractional_authored_armor_still_rejects() {
        let f=fixture_for("us_m8");let mh=f.record["parentStockManifestHash"].as_str().unwrap();let ch=f.record["parentStockCatalogHash"].as_str().unwrap();
        let original=String::from_utf8(read(&format!("data/hit-bindings/{ch}.json"))).unwrap();let catalog:Value=serde_json::from_str(&original).unwrap();
        let prior=catalog["catalogHash"].as_str().unwrap();let next=f32::from_bits(6.4f32.to_bits()+1);
        let modified=original.replacen("\"authoredThicknessMm\":6.4",&format!("\"authoredThicknessMm\":{}",next as f64),1);
        assert_ne!(original,modified);let member=format!("\"catalogHash\":\"{prior}\",");let body=modified.replacen(&member,"",1);
        let next_hash=tg_combat::geometry::manifest::sha256(body.as_bytes());let modified=modified.replacen(&member,&format!("\"catalogHash\":\"{next_hash}\","),1);
        let manifest=read(&format!("data/hit-meshes/{mh}.json"));let geometry=Geometry::register(&manifest,mh,&f.runtime.store).unwrap();
        let err=CombatScene::new(geometry,mh,modified.as_bytes(),&tg_combat::geometry::manifest::sha256(modified.as_bytes()),&f.target,
            f.runtime.scopes["barrel-fixture"].clone()).err().unwrap();assert_eq!(err,"authored armor layer mismatch");
        let mut def=f.target.def.clone();let plate=def.plates.iter_mut().find(|p|p.thickness_mm.to_bits()==6.4f32.to_bits()).unwrap();plate.thickness_mm=next;
        let changed=Target::new(def,&serde_json::from_slice::<Vec<_>>(&read("data/materials.json")).unwrap());
        assert_ne!(changed.registration_hash(),f.target.registration_hash());
        assert!(f.runtime.verify_target_registration("barrel-fixture",&changed).is_err());
    }
    #[test]
    fn compiled_registry_matches_current_pinned_record_files() {
        let compiled=include_str!("../../../data/barrel-shapes/index.json");let bytes=read("data/barrel-shapes/index.json");
        assert_eq!(compiled.as_bytes(),bytes.as_slice(),"compiled registry SHA {} differs from current file SHA {}",
            tg_combat::geometry::manifest::sha256(compiled.as_bytes()),tg_combat::geometry::manifest::sha256(&bytes));
        let registry:Value=serde_json::from_slice(&bytes).unwrap();
        for r in registry["variants"].as_array().unwrap(){let id=r["shapeId"].as_str().unwrap();let hash=registry["recordFiles"][id].as_str().unwrap();
            let text=String::from_utf8(read(&format!("data/barrel-shapes/{hash}.json"))).unwrap();let file:Value=serde_json::from_str(&text).unwrap();
            assert_eq!(r["shapeHash"],file["shapeHash"],"record file/registry shape hash differs for {id}");
            pinned_variant(&json!({"record":text,"recordHash":hash})).unwrap_or_else(|e|panic!("{id} hash {} failed current compiled pin: {e}",r["shapeHash"]));
        }
    }
    #[test]
    fn pinned_multi_upload_record_round_trips_declared_descendants() {
        let registry=value("data/barrel-shapes/index.json");let mut record=registry["variants"][0].clone();
        record["changedMeshes"]=json!([{ "sourceMeshKey":record["recipe"]["sourceMeshKey"],
            "instanceId":record["instanceId"],"physicalContactSourceKeys":record["physicalContactSourceKeys"],
            "recipe":record["recipe"],"rendererAttributeUploadHash":record["rendererAttributeUploadHash"],
            "positionPayloadHash":record["positionPayloadHash"],"effectiveRecoilAssemblyKey":"assembly:reviewed-recoil"}]);
        let parsed:BarrelShapeVariantV1=serde_json::from_value(record.clone()).unwrap();
        assert_eq!(serde_json::to_value(parsed).unwrap()["changedMeshes"],record["changedMeshes"],
            "trusted declared descendants must survive the native record contract");
    }
    #[test]
    fn transition_declares_complete_active_variant_identity() {
        let mut f=fixture();let report=fracture(&mut f);
        assert_eq!(report["shape_transition"]["activeVariantIds"],json!([f.record["shapeId"]]),
            "renderer and frozen replay need the complete core-issued damaged weapon set");
    }
    #[test]
    fn all_current_fleet_packets_preload_and_switch_only_after_actual_primary_damage() {
        let registry=value("data/barrel-shapes/index.json");let variants=registry["variants"].as_array().unwrap();
        assert!(variants.len()>=8);
        let ids:std::collections::BTreeSet<_>=variants.iter().map(|r|r["specId"].as_str().unwrap()).collect();
        assert_eq!(ids.len(),26,"all currently admitted exact-surface vehicles retain physical cuts");
        for id in ids {
            let mut f=fixture_for(id);
            let report=fracture(&mut f);let token=report["shape_transition"].clone();
            assert!(token["token"].is_string(),"{id}: actual physical tube destruction must issue a token: {report}");
            assert_eq!(f.runtime.scopes["barrel-fixture"].geometry_revision,0,"{id}: preload and damage preserve stock revision");
            let cut=f.record["recipe"]["cutPlaneLocalZ"].as_f64().unwrap();let max=f.record["tubeExtent"]["maxZ"].as_f64().unwrap();
            let a=point(&f,[0.4,0.,(cut+max)*0.5]);let b=point(&f,[-0.4,0.,(cut+max)*0.5]);
            let barrel_instance=f.record["instanceId"].as_str().unwrap();
            assert!(f.runtime.scenes["barrel-fixture"].crossings(a,b).unwrap().iter().any(|c|c.instance_id==barrel_instance),"{id}: removed-segment fixture crosses stock recoil geometry");
            let req=request(&f,&token);let reply=f.runtime.call("combat_surface_shape_commit",&req,Some(&f.target)).unwrap();
            assert_eq!(reply["geometryRevision"],1,"{id}");assert_eq!(reply["shapeHash"],f.record["shapeHash"],"{id}");
            assert!(f.runtime.scenes["barrel-fixture"].crossings(a,b).unwrap().iter().all(|c|c.instance_id!=barrel_instance),"{id}: removed recoil segment is a finite miss");
            assert!(report["geometry_contacts"].as_array().unwrap().iter().all(|c|c["geometryRevision"]==0),"{id}: damaging report remains stock");
        }
    }
    #[test]
    fn actual_pinned_fracture_commits_only_after_old_report_and_preserves_empty_bore() {
        let mut f=fixture();let report=fracture(&mut f);let token=report["shape_transition"].clone();
        assert!(token["token"].is_string(),"actual positive-to-zero physical tube shot must issue a token: {report}");
        assert!(report["geometry_contacts"].as_array().unwrap().iter().all(|c|c["geometryRevision"]==0));
        let frozen=report.clone();assert_eq!(f.runtime.scopes["barrel-fixture"].geometry_revision,0);
        let cut=f.record["recipe"]["cutPlaneLocalZ"].as_f64().unwrap();let min=f.record["tubeExtent"]["minZ"].as_f64().unwrap();let max=f.record["tubeExtent"]["maxZ"].as_f64().unwrap();
        let removed=(cut+max)*0.5;let a=point(&f,[0.4,0.,removed]);let b=point(&f,[-0.4,0.,removed]);
        assert!(!f.runtime.scenes["barrel-fixture"].crossings(a,b).unwrap().is_empty());
        let bore_a=point(&f,[0.,0.,min+0.1]);let bore_b=point(&f,[0.,0.,cut-0.1]);
        let old_bore=f.runtime.scenes["barrel-fixture"].crossings(bore_a,bore_b).unwrap();
        let req=request(&f,&token);let reply=f.runtime.call("combat_surface_shape_commit",&req,Some(&f.target)).unwrap();
        assert_eq!(reply["geometryRevision"],1);assert_eq!(reply["poseRevision"],2);
        assert!(f.runtime.scenes["barrel-fixture"].crossings(a,b).unwrap().is_empty(),"removed source muzzle must be a finite miss");
        let a=point(&f,[0.4,0.,(min+cut)*0.5]);let b=point(&f,[-0.4,0.,(min+cut)*0.5]);
        let retained=f.runtime.scenes["barrel-fixture"].crossings(a,b).unwrap();assert!(!retained.is_empty());
        assert!(retained.iter().all(|c|c.geometry_revision==1&&c.shape_hash.as_deref()==f.record["shapeHash"].as_str()));
        let bore=f.runtime.scenes["barrel-fixture"].crossings(bore_a,bore_b).unwrap();
        let barrel_mesh=f.record["recipe"]["sourceMeshKey"].as_str().unwrap();
        assert!(bore.iter().all(|c|c.mesh_id!=barrel_mesh),"retained annular barrel bore stays empty: {bore:?}");
        let external=|contacts:&[tg_combat::geometry::surface::SurfaceCrossingV1]|contacts.iter()
            .filter(|c|c.mesh_id!=barrel_mesh).map(|c|(c.instance_id.clone(),c.triangle_id,c.point,c.barycentric)).collect::<Vec<_>>();
        assert_eq!(external(&bore),external(&old_bore),"real retained geometry behind the bore is preserved exactly");
        let catalog=value(&format!("data/hit-bindings/{}.json",f.record["parentStockCatalogHash"].as_str().unwrap()));
        assert!(bore.iter().any(|c|catalog["declarations"].as_array().unwrap().iter()
            .any(|d|d["key"].as_str()==c.response_ref.as_deref()&&d["moduleRef"]=="breech")),"actual breech contact behind the empty tube remains present");
        assert_eq!(report,frozen,"damaging report remains on stock geometry and replay revision");
        assert!(f.runtime.call("combat_surface_shape_commit",&req,Some(&f.target)).is_err(),"token is single use");
    }
    #[test]
    fn stale_life_revision_token_and_bad_pose_fail_without_scene_switch() {
        let mut f=fixture();let report=fracture(&mut f);let req=request(&f,&report["shape_transition"]);
        for change in ["token","life","revision","shape","matrix"]{
            let mut bad=req.clone();match change {
                "token"=>bad["token"]=json!("forged"),"life"=>bad["poseContext"]["spawnEpoch"]=json!(2),
                "revision"=>bad["expectedGeometryRevision"]=json!(9),"shape"=>bad["shapeId"]=json!("stock"),
                _=>bad["updates"]=json!([])
            }
            assert!(f.runtime.call("combat_surface_shape_commit",&bad,Some(&f.target)).is_err());
            assert_eq!(f.runtime.scopes["barrel-fixture"].geometry_revision,0);
        }
        f.runtime.call("combat_surface_shape_commit",&req,Some(&f.target)).unwrap();
        f.runtime.call("combat_surface_release",&json!({"key":"barrel-fixture"}),None).unwrap();
        assert!(f.runtime.call("combat_surface_shape_commit",&req,Some(&f.target)).is_err());
    }
    #[test]
    fn repair_start_cancel_and_forged_health_cannot_restore_but_core_completion_can() {
        let mut f=fixture();let report=fracture(&mut f);let req=request(&f,&report["shape_transition"]);
        f.runtime.call("combat_surface_shape_commit",&req,Some(&f.target)).unwrap();
        let mut state:TargetState=serde_json::from_value(report["state"].clone()).unwrap();
        let module=f.runtime.owners["barrel-fixture"].variants.values().next().unwrap().module;
        let mut forged=state.clone();forged.modules[module]=50.;assert!(f.runtime.verify_state("barrel-fixture",&forged).is_err());
        assert!(tg_combat::start_repair(&f.target,&mut state));f.runtime.observe_repair_start("barrel-fixture",&state,true).unwrap();
        assert!(f.runtime.pending("barrel-fixture").is_null());
        let mut bad=state.clone();bad.repair_s=0.01;assert!(f.runtime.verify_advance("barrel-fixture",&bad,0.01).is_err());
        let before=state.clone();state.repair_s=0.;state.repair_targets=None;
        f.runtime.observe_advance("barrel-fixture",&before,&state,&[],"cancel").unwrap();
        assert!(f.runtime.pending("barrel-fixture").is_null());
        assert!(tg_combat::start_repair(&f.target,&mut state));f.runtime.observe_repair_start("barrel-fixture",&state,true).unwrap();
        f.runtime.verify_advance("barrel-fixture",&state,state.repair_s).unwrap();let before=state.clone();let dt=state.repair_s+1.;
        let events=tg_combat::advance(&f.target,&mut state,dt,1);assert!(events.iter().any(|e|e=="repaired"));
        f.runtime.observe_advance("barrel-fixture",&before,&state,&events,"repair-complete").unwrap();
        let pending=f.runtime.pending("barrel-fixture");assert_eq!(pending["shapeId"],"stock");
        let req=request(&f,&pending);let reply=f.runtime.call("combat_surface_shape_commit",&req,Some(&f.target)).unwrap();
        assert_eq!(reply["geometryRevision"],2);assert_eq!(reply["shapeId"],"stock");
    }
    #[test]
    fn aggregated_secondary_contacts_or_primary_graze_cannot_authorize_fracture() {
        let mut f=fixture();let result=fracture(&mut f);let before=f.target.fresh_state();
        let report:Report=serde_json::from_value(result).unwrap();let owner=&f.runtime.owners["barrel-fixture"];
        let scene=&f.runtime.scenes["barrel-fixture"];
        assert!(primary_fracture(scene,owner.variants.values().next().unwrap(),&before,&report,false));
        let mut secondary=report.clone();secondary.primary_geometry_contacts.clear();
        assert!(!secondary.geometry_contacts.is_empty());
        assert!(!primary_fracture(scene,owner.variants.values().next().unwrap(),&before,&secondary,false));
        let mut graze=report.clone();graze.primary_module_destructions.clear();
        assert!(!primary_fracture(scene,owner.variants.values().next().unwrap(),&before,&graze,false),"secondary finish after a primary tube graze has no direct destruction proof");
        let mut breech=report.clone();for d in &mut breech.primary_module_destructions{d["moduleRef"]=json!("breech");}
        assert!(!primary_fracture(scene,owner.variants.values().next().unwrap(),&before,&breech,false));
    }
    #[test]
    fn primary_tube_witness_cannot_launder_a_fatal_cover_contact_into_fracture() {
        let mut f=fixture();let result=fracture(&mut f);let before=f.target.fresh_state();
        let mut report:Report=serde_json::from_value(result).unwrap();let owner=&f.runtime.owners["barrel-fixture"];
        let scene=&f.runtime.scenes["barrel-fixture"];
        assert!(primary_fracture(scene,owner.variants.values().next().unwrap(),&before,&report,false));
        let manifest=value(&format!("data/hit-meshes/{}.json",f.record["parentStockManifestHash"].as_str().unwrap()));
        let mesh=manifest["meshes"].as_array().unwrap().iter().find(|m|m["key"]==owner.variants.values().next().unwrap().record.source_mesh_key).unwrap();
        let cover=mesh["ranges"].as_array().unwrap().iter().find(|r|
            r["sourceKey"].as_str().is_some_and(|key|key.ends_with(":part:70"))).unwrap();
        for destruction in &mut report.primary_module_destructions {
            destruction["contact"]["triangleId"]=cover["first"].clone();
            destruction["contact"]["surfaceId"]=cover["surfaceKey"].clone();
            assert!(!scene.physical_barrel_contact(&destruction["contact"],&owner.variants.values().next().unwrap().record));
        }
        assert!(report.primary_geometry_contacts.iter().any(|c|scene.physical_barrel_contact(c,&owner.variants.values().next().unwrap().record)),"genuine primary tube witness stays present");
        assert!(!primary_fracture(scene,owner.variants.values().next().unwrap(),&before,&report,false),"same recoil instance and earlier tube witness do not make a cover destruction the physical tube cause");
    }
    #[test]
    fn active_shape_owner_rejects_changed_target_registration_before_replacement() {
        let mut f=fixture();let report=fracture(&mut f);let pending=report["shape_transition"].clone();
        let original=f.target.def.clone();let accepted=f.target.registration_hash();let module=f.runtime.owners["barrel-fixture"].variants.values().next().unwrap().module;
        crate::handle(&json!({"op":"init","materials":value("data/materials.json"),
            "catalog":value("data/design_catalog.json"),"terrains":value("data/terrains.json")})).unwrap();
        crate::STATE.with(|cell|{let mut guard=cell.borrow_mut();let state=guard.as_mut().unwrap();
            state.targets.insert("barrel-fixture".into(),f.target);state.surfaces=f.runtime;});
        assert!(crate::handle(&json!({"op":"combat_target","def":original})).is_ok(),"identical typed target remains compatible");
        let mut replacement=original.clone();replacement.modules[module].max_health+=100.;
        assert!(crate::handle(&json!({"op":"combat_target","def":replacement})).is_err(),"changed actual engineering definition must not replace an active shape owner");
        crate::STATE.with(|cell|{let guard=cell.borrow();let state=guard.as_ref().unwrap();
            assert_eq!(state.targets["barrel-fixture"].registration_hash(),accepted);
            assert_eq!(state.surfaces.pending("barrel-fixture"),pending);});
        let mut legacy=original;legacy.id="legacy-no-shape-owner".into();legacy.modules[module].max_health+=100.;
        assert!(crate::handle(&json!({"op":"combat_target","def":legacy})).is_ok(),"legacy registration has no shape owner restriction");
    }
    #[test]
    fn repair_tick_rejects_foreign_scope_before_any_shape_owner_mutation() {
        let mut f=fixture();let report=fracture(&mut f);let req=request(&f,&report["shape_transition"]);
        f.runtime.call("combat_surface_shape_commit",&req,Some(&f.target)).unwrap();
        let mut state:TargetState=serde_json::from_value(report["state"].clone()).unwrap();
        assert!(tg_combat::start_repair(&f.target,&mut state));f.runtime.observe_repair_start("barrel-fixture",&state,true).unwrap();
        let original=context(&f,"repair-scope");
        for field in ["actor","life","pose","geometry"] {
            let mut bad=original.clone();match field{"actor"=>bad.actor.entity+=1,"life"=>bad.actor.life+=1,
                "pose"=>bad.pose_revision+=1,_=>bad.geometry_revision+=1}
            assert!(f.runtime.verify_advance_context("barrel-fixture",Some(&bad),0.01).is_err());
            let owner=&f.runtime.owners["barrel-fixture"];
            assert_eq!(owner.health[owner.variants.values().next().unwrap().module],0.);assert_eq!(owner.repair.as_ref().unwrap().remaining,state.repair_s);
            assert!(owner.pending.is_none());assert_eq!(owner.repair_generation,1);
        }
        assert!(f.runtime.verify_advance_context("barrel-fixture",None,0.).is_ok());
        assert!(f.runtime.verify_advance_context("barrel-fixture",None,0.01).is_err());
        assert!(f.runtime.verify_advance_context("legacy-no-scene",Some(&original),0.01).is_ok());
    }
    #[test]
    fn authored_zero_tick_scuttle_is_one_way_and_cannot_forge_repair_eligibility() {
        let mut f=fixture();let report=fracture(&mut f);let req=request(&f,&report["shape_transition"]);
        f.runtime.call("combat_surface_shape_commit",&req,Some(&f.target)).unwrap();
        let mut state:TargetState=serde_json::from_value(report["state"].clone()).unwrap();
        state.destroyed=true;assert!(f.runtime.verify_advance("barrel-fixture",&state,0.).is_ok());
        f.runtime.verify_advance_context("barrel-fixture",None,0.).unwrap();let before=state.clone();
        let events=tg_combat::advance(&f.target,&mut state,0.,1);
        f.runtime.observe_advance("barrel-fixture",&before,&state,&events,"scuttle").unwrap();
        let mut forged=state.clone();forged.destroyed=false;
        assert!(f.runtime.verify_state("barrel-fixture",&forged).is_err());
        assert!(f.runtime.verify_advance("barrel-fixture",&forged,0.).is_err());
        forged=state.clone();forged.crew[0]+=1.;assert!(f.runtime.verify_state("barrel-fixture",&forged).is_err());
        assert!(f.runtime.pending("barrel-fixture").is_null());
    }
    #[test]
    fn later_real_damage_retires_uncommitted_stock_restoration_token() {
        let mut f=fixture();let report=fracture(&mut f);let req=request(&f,&report["shape_transition"]);
        f.runtime.call("combat_surface_shape_commit",&req,Some(&f.target)).unwrap();
        let mut state:TargetState=serde_json::from_value(report["state"].clone()).unwrap();
        assert!(tg_combat::start_repair(&f.target,&mut state));f.runtime.observe_repair_start("barrel-fixture",&state,true).unwrap();
        let before=state.clone();let dt=state.repair_s+1.;let events=tg_combat::advance(&f.target,&mut state,dt,1);
        f.runtime.observe_advance("barrel-fixture",&before,&state,&events,"repair-ready").unwrap();
        let pending=f.runtime.pending("barrel-fixture");assert_eq!(pending["shapeId"],"stock");let old=request(&f,&pending);
        let z=(f.record["tubeExtent"]["minZ"].as_f64().unwrap()+f.record["recipe"]["cutPlaneLocalZ"].as_f64().unwrap())*0.5;
        let report=damage_at(&mut f,&state,z,"damage-before-render-restore");
        assert!(report["shape_transition"].is_null());assert!(f.runtime.pending("barrel-fixture").is_null());
        assert!(f.runtime.call("combat_surface_shape_commit",&old,Some(&f.target)).is_err());
    }
}
impl SurfaceRuntime {
    pub(crate) fn verify_target_registration(&self,key:&str,target:&Target)->Result<(),String>{
        if self.owners.contains_key(key)&&!self.scenes.get(key).is_some_and(|scene|scene.accepts(target)){
            return Err("target registration differs from active barrel shape owner".into());
        }Ok(())
    }
    pub(crate) fn call(&mut self,op:&str,req:&Value,target:Option<&Target>)->Result<Value,String>{
        match op {
            "combat_surface_install"=>{let bytes:Vec<u8>=super::field(req,"payload")?;let hash:String=super::field(req,"expectedHash")?;self.store.install(&bytes,&hash)?;Ok(json!({"payloadHash":hash}))},
            "combat_surface_register"=>{
                let key:String=super::field(req,"key")?;if !self.scenes.contains_key(&key)&&self.scenes.len()>=64{return Err("local surface actor scene capacity".into());}
                let manifest:String=super::field(req,"manifest")?;let manifest_hash:String=super::field(req,"manifestHash")?;
                let catalog:String=super::field(req,"catalog")?;let catalog_hash:String=super::field(req,"catalogHash")?;
                let context:QueryContext=super::field(req,"poseContext")?;
                if let Some(old)=self.scopes.get(&key){if context.spawn_epoch<=old.spawn_epoch{return Err("surface registration requires a newer actor life or explicit release".into());}}
                let geometry=Geometry::register(manifest.as_bytes(),&manifest_hash,&self.store)?;
                let mut scene=CombatScene::new(geometry,&manifest_hash,catalog.as_bytes(),&catalog_hash,target.ok_or("missing registered actor target")?,context.clone())?;
                let updates:Vec<(String,[f64;16])>=super::field(req,"updates")?;let mut accepted=context;
                accepted.pose_revision=accepted.pose_revision.checked_add(1).ok_or("pose revision exhausted")?;
                scene.update_pose(&updates,accepted)?;let accepted=scene.context().clone();
                self.owners.remove(&key);self.scopes.insert(key.clone(),accepted.clone());self.scenes.insert(key,scene);
                Ok(json!({"capability":"registered_surface_combat_subset","poseRevision":accepted.pose_revision,
                    "geometryRevision":0,"shapeId":"stock","shapeHash":manifest_hash}))
            },
            "combat_surface_variant_register"=>{let record=pinned_variant(req)?;self.register_variant(req,target,record)},
            "combat_surface_shape_commit"=>self.commit(req),
            "combat_surface_pose"=>{
                let key:String=super::field(req,"key")?;let updates:Vec<(String,[f64;16])>=super::field(req,"updates")?;
                let context:QueryContext=super::field(req,"poseContext")?;let scene=self.scenes.get_mut(&key).ok_or("missing actor surface scene")?;
                scene.update_pose(&updates,context)?;self.scopes.insert(key,scene.context().clone());Ok(json!({}))
            },
            "combat_surface_trace"=>{let key:String=super::field(req,"key")?;let a=super::field(req,"a")?;let b=super::field(req,"b")?;let crossings=self.scenes.get(&key).ok_or("missing actor surface scene")?.crossings(a,b)?;Ok(json!({"crossings":crossings}))},
            "combat_surface_release"=>{let key:String=super::field(req,"key")?;self.scenes.remove(&key);self.scopes.remove(&key);self.owners.remove(&key);self.store.collect_unused();Ok(json!({}))},
            _=>Err("unknown surface runtime operation".into())
        }
    }
    fn register_variant(&mut self,req:&Value,target:Option<&Target>,record:BarrelShapeVariantV1)->Result<Value,String>{
                let key:String=super::field(req,"key")?;
                if let Some(owner)=self.owners.get(&key){
                    if let Some(existing)=owner.variants.get(&record.shape_id){
                        if existing.record.shape_hash!=record.shape_hash{return Err("barrel shape identity collision".into());}
                        return Ok(json!({"shapeId":record.shape_id,"shapeHash":record.shape_hash,"prepared":true,"activeVariantIds":owner.active_variant_ids}));
                    }
                    if owner.variants.len()>=8{return Err("actor barrel variant capacity".into());}
                    let keys:Vec<_>=record.mesh_changes().into_iter().map(|m|m.source_mesh_key).collect();
                    if owner.variants.values().any(|v|v.record.module_ref==record.module_ref||v.record.mounted_weapon_key==record.mounted_weapon_key
                        ||v.record.physical_barrel_id==record.physical_barrel_id
                        ||v.record.mesh_changes().iter().any(|m|keys.contains(&m.source_mesh_key))){
                        return Err("independent barrel variants overlap physical ownership or upload".into());
                    }
                }
                let parent=self.owners.get(&key).map(|o|&o.stock).or_else(||self.scenes.get(&key)).ok_or("missing stock actor surface scene")?;
                let target=target.ok_or("missing variant actor target")?;
                let manifest:String=super::field(req,"manifest")?;let mh:String=super::field(req,"manifestHash")?;
                let catalog:String=super::field(req,"catalog")?;let ch:String=super::field(req,"catalogHash")?;
                let geometry=Geometry::register(manifest.as_bytes(),&mh,&self.store)?;
                let mut context=parent.context().clone();context.shape_hash=Some(record.shape_hash.clone());
                let scene=CombatScene::new_barrel_variant(geometry,&mh,catalog.as_bytes(),&ch,target,context,parent,&record)?;
                let module=target.def.modules.iter().position(|m|m.id==record.module_ref).ok_or("variant module absent")?;
                let active=self.owners.get(&key).map(|o|o.active_variant_ids.clone()).unwrap_or_default();
                let reply=json!({"shapeId":record.shape_id,"shapeHash":record.shape_hash,"prepared":true,"activeVariantIds":active});
                if !self.owners.contains_key(&key){
                    let current=self.scenes.get(&key).unwrap();
                    let stock=current.compose_barrel_variants(&[],&self.store,current.context().clone())?;let fresh=target.fresh_state();
                    self.owners.insert(key.clone(),ShapeOwner {variants:HashMap::new(),stock,active_variant_ids:vec![],
                        health:fresh.modules,destroyed:fresh.destroyed,crew:fresh.crew,repair_generation:0,repair:None,completed_repairs:HashMap::new(),pending:None});
                }
                self.owners.get_mut(&key).unwrap().variants.insert(record.shape_id.clone(),LoadedVariant {record,scene,module});Ok(reply)

    }
    fn commit(&mut self,req:&Value)->Result<Value,String>{
        let key:String=super::field(req,"key")?;let token:String=super::field(req,"token")?;
        let expected:u64=super::field(req,"expectedGeometryRevision")?;let shape_id:String=super::field(req,"shapeId")?;
        let context:QueryContext=super::field(req,"poseContext")?;let updates:Vec<(String,[f64;16])>=super::field(req,"updates")?;
        let scope=self.scopes.get(&key).ok_or("missing shape actor scope")?;
        let owner=self.owners.get_mut(&key).ok_or("actor has no prepared barrel shape")?;
        let pending=owner.pending.clone().ok_or("no core-issued shape transition")?;
        if token!=pending.token||expected!=pending.old_revision||expected!=scope.geometry_revision||shape_id!=pending.shape_id
            ||context.entity_id!=scope.entity_id||context.spawn_epoch!=scope.spawn_epoch||context.build_hash!=scope.build_hash
            ||context.pose_revision!=scope.pose_revision.checked_add(1).ok_or("pose revision exhausted")?
            ||context.geometry_revision!=pending.new_revision||context.shape_hash.as_deref()!=Some(pending.shape_hash.as_str())
            ||!self.scenes.contains_key(&key){return Err("stale or foreign shape transition token/pose".into());}
        let mut difference:Vec<_>=owner.variants.keys().filter(|id|owner.active_variant_ids.contains(id)!=pending.active_variant_ids.contains(id)).cloned().collect();
        difference.sort();
        if difference!=pending.transition_variant_ids{return Err("transition omits an independent physical shape change".into());}
        for id in &pending.transition_variant_ids {
            let variant=owner.variants.get(id).ok_or("transition references unknown barrel variant")?;
            let was_active=owner.active_variant_ids.contains(id);let will_be_active=pending.active_variant_ids.contains(id);
            let completed=pending.repair_generations.get(id);
            if was_active==will_be_active||if will_be_active{owner.health[variant.module]!=0.}else{
                owner.health[variant.module]<=0.||completed.is_none()||completed!=owner.completed_repairs.get(id)
            }{
                return Err("shape change lacks current core physical destruction or repair completion".into());
            }
        }
        let records:Vec<_>=pending.active_variant_ids.iter().map(|id|owner.variants.get(id).ok_or("composed variant is not prepared"))
            .collect::<Result<Vec<_>,_>>()?;
        let variants:Vec<_>=records.iter().map(|v|(&v.scene,&v.record)).collect();
        let mut prepared_context=scope.clone();prepared_context.shape_hash=Some(pending.shape_hash.clone());
        let mut next=owner.stock.compose_barrel_variants(&variants,&self.store,prepared_context)?;
        next.transition_pose(&updates,context.clone())?;
        // Complete pose, scene, shape set and token become visible together.
        self.scenes.insert(key.clone(),next);owner.active_variant_ids=pending.active_variant_ids.clone();
        owner.completed_repairs.retain(|id,_|owner.active_variant_ids.contains(id));
        owner.pending=None;self.scopes.insert(key,context.clone());
        Ok(json!({"geometryRevision":context.geometry_revision,"shapeId":shape_id,"shapeHash":pending.shape_hash,
            "poseRevision":context.pose_revision,"activeVariantIds":pending.active_variant_ids}))
    }
    fn scope_matches(&self,key:&str,context:Option<&tg_combat::causes::DamageContext>)->Result<(),String>{
        if let Some(c)=context{
            let scope=self.scopes.get(key).ok_or("missing accepted surface scope")?;
            if !c.valid()||scope.entity_id!=format!("{}:{}:{}",c.actor.battle,c.actor.entity,c.actor.life)
                ||scope.spawn_epoch!=c.actor.life||scope.pose_revision!=c.pose_revision||scope.geometry_revision!=c.geometry_revision {
                return Err("surface damage actor/life/pose/geometry mismatch".into());
            }
        }Ok(())
    }
    pub(crate) fn verify_state(&self,key:&str,state:&TargetState)->Result<(),String>{
        if let Some(owner)=self.owners.get(key){
            if owner.variants.values().any(|v|state.modules.get(v.module)!=owner.health.get(v.module)){return Err("barrel health differs from last core-issued state".into());}
            if state.destroyed!=owner.destroyed||state.crew!=owner.crew{return Err("barrel repair eligibility differs from last core-issued state".into());}
        }Ok(())
    }
    pub(crate) fn verify_advance(&self,key:&str,state:&TargetState,dt:f32)->Result<(),String>{
        let scuttle=self.owners.get(key).is_some_and(|o|dt==0.&&state.destroyed&&!o.destroyed
            &&o.variants.values().all(|v|state.modules.get(v.module)==o.health.get(v.module))&&state.crew==o.crew);
        if !scuttle{self.verify_state(key,state)?;}
        if let Some(owner)=self.owners.get(key){if state.repair_s>0. {
            let witness=owner.repair.as_ref().ok_or("repair timer was not issued by the core")?;
            if state.repair_s.to_bits()!=witness.remaining.to_bits()||state.repair_targets!=witness.targets{return Err("repair generation/timer/selection mismatch".into());}
        }}Ok(())
    }
    pub(crate) fn verify_advance_context(&self,key:&str,context:Option<&tg_combat::causes::DamageContext>,dt:f32)->Result<(),String>{
        if self.scopes.contains_key(key){self.scope_matches(key,context)?;}
        if self.owners.contains_key(key)&&(!dt.is_finite()||dt<0.||(dt>0.&&context.is_none())){
            return Err("barrel shape advance requires a finite scoped core tick".into());
        }Ok(())
    }
    pub(crate) fn observe_report(&mut self,key:&str,state:&TargetState){
        if let Some(owner)=self.owners.get_mut(key){
            owner.health=state.modules.clone();owner.destroyed=state.destroyed;owner.crew=state.crew.clone();
            owner.completed_repairs.retain(|id,_|!state.destroyed&&owner.health.get(owner.variants[id].module).is_some_and(|health|health.is_finite()&&*health>0.));
            if let Some(mut pending)=owner.pending.take(){
                let invalid:Vec<_>=pending.transition_variant_ids.iter().filter(|id|{
                    let health=owner.health.get(owner.variants[*id].module).copied().unwrap_or(f32::NAN);
                    if pending.active_variant_ids.contains(id){health!=0.}else{!health.is_finite()||health<=0.||state.destroyed}
                }).cloned().collect();
                if invalid.is_empty(){owner.pending=Some(pending);}else{
                    pending.transition_variant_ids.retain(|id|!invalid.contains(id));
                    pending.repair_generations.retain(|id,_|!invalid.contains(id));
                    for id in invalid {
                        pending.active_variant_ids.retain(|active|active!=&id);
                        if owner.active_variant_ids.contains(&id){pending.active_variant_ids.push(id);}
                    }
                    pending.active_variant_ids.sort();
                    if !pending.transition_variant_ids.is_empty(){
                        let records:Vec<_>=pending.active_variant_ids.iter().map(|id|&owner.variants[id].record).collect();
                        if let Ok((shape_id,shape_hash))=barrel_composition_identity(&owner.stock.manifest_hash(),&records){
                            pending.token=tg_combat::geometry::manifest::sha256(format!("{}:pruned:{}",pending.token,shape_hash).as_bytes());
                            pending.shape_id=shape_id;pending.shape_hash=shape_hash;
                            if !pending.transition_variant_ids.iter().any(|id|owner.active_variant_ids.contains(id)&&!pending.active_variant_ids.contains(id)){
                                pending.repair_generation=None;
                            }
                            owner.pending=Some(pending);
                        }
                    }
                }
            }
        }
    }
    pub(crate) fn observe_repair_start(&mut self,key:&str,state:&TargetState,ok:bool)->Result<(),String>{
        if let Some(owner)=self.owners.get_mut(key){if ok&&state.repair_s>0. {
            owner.repair_generation=owner.repair_generation.checked_add(1).ok_or("repair generation exhausted")?;
            owner.repair=Some(RepairWitness {generation:owner.repair_generation,remaining:state.repair_s,targets:state.repair_targets.clone()});
        }}Ok(())
    }
    pub(crate) fn observe_advance(&mut self,key:&str,before:&TargetState,after:&TargetState,events:&[String],event_id:&str)->Result<(),String>{
        let restore=self.owners.get(key).and_then(|owner|{
            let witness=owner.repair.as_ref()?;
            if !events.iter().any(|e|e=="repaired"){return None;}
            let ids:Vec<_>=owner.active_variant_ids.iter().filter(|id|{let module=owner.variants[*id].module;
                before.modules.get(module).is_some_and(|h|*h<=0.)&&after.modules.get(module).is_some_and(|h|*h>0.)
                    &&witness.targets.as_ref().is_some_and(|v|v.contains(&module))}).cloned().collect();
            (!ids.is_empty()).then_some((witness.generation,ids))
        });
        if let Some((generation,ids))=&restore{
            let owner=self.owners.get_mut(key).unwrap();
            // At most one completed witness for each of the bounded prepared
            // physical weapons. New repair jobs do not revoke earlier core
            // completions that still await the renderer's atomic commit.
            for id in ids{owner.completed_repairs.insert(id.clone(),*generation);}
        }
        self.observe_report(key,after);
        if let Some(owner)=self.owners.get_mut(key){
            if after.repair_s<=0.{owner.repair=None;}else if let Some(w)=owner.repair.as_mut(){w.remaining=after.repair_s;w.targets=after.repair_targets.clone();}
        }
        if let Some((generation,ids))=restore {
            let owner=&self.owners[key];
            // A different weapon may already have a physical destruction
            // witness waiting for the renderer's atomic commit. Repair changes
            // that complete intended shape rather than restarting from the
            // last visible shape and discarding the waiting destruction.
            let intended=owner.pending.as_ref().map(|p|&p.active_variant_ids).unwrap_or(&owner.active_variant_ids);
            let active=intended.iter().filter(|id|!ids.contains(id)).cloned().collect();
            let mut changed=owner.pending.as_ref().map(|p|p.transition_variant_ids.clone()).unwrap_or_default();
            changed.extend(ids);
            let shot_id=owner.pending.as_ref().map(|p|p.shot_id.clone()).unwrap_or_default();
            self.issue(key,active,changed,event_id,&shot_id,Some(generation))?;
        }Ok(())
    }
    fn issue(&mut self,key:&str,mut active:Vec<String>,mut changed:Vec<String>,event_id:&str,shot_id:&str,repair:Option<u64>)->Result<(),String>{
        active.sort();changed.sort();active.dedup();changed.dedup();
        let scope=self.scopes.get(key).ok_or("missing transition actor scope")?;
        let owner=self.owners.get_mut(key).ok_or("missing transition shape owner")?;
        let records:Vec<_>=active.iter().map(|id|owner.variants.get(id).map(|v|&v.record).ok_or("unprepared transition variant"))
            .collect::<Result<Vec<_>,_>>()?;
        let (shape_id,shape_hash)=barrel_composition_identity(&owner.stock.manifest_hash(),&records)?;
        let mut repair_generations=HashMap::new();
        for id in &changed{if owner.active_variant_ids.contains(id)&&!active.contains(id){
            let generation=owner.completed_repairs.get(id).copied().ok_or("restoration lacks a core-completed physical repair witness")?;
            repair_generations.insert(id.clone(),generation);
        }}
        let repair=if repair_generations.is_empty(){None}else{repair.or_else(||repair_generations.values().copied().max())};
        let new_revision=scope.geometry_revision.checked_add(1).filter(|r|*r<=tg_combat::replay_evidence::MAX_SAFE_COUNTER).ok_or("geometry revision exhausted")?;
        self.token_counter=self.token_counter.checked_add(1).ok_or("shape token counter exhausted")?;
        let token=tg_combat::geometry::manifest::sha256(format!("{}:{}:{}:{}:{}:{}",self.token_counter,scope.entity_id,scope.spawn_epoch,scope.geometry_revision,event_id,shape_hash).as_bytes());
        owner.pending=Some(PendingShape {token,old_revision:scope.geometry_revision,new_revision,shape_id,shape_hash,
            event_id:event_id.into(),shot_id:shot_id.into(),repair_generation:repair,repair_generations,active_variant_ids:active,transition_variant_ids:changed});Ok(())
    }
    pub(crate) fn pending(&self,key:&str)->Value {
        let Some(owner)=self.owners.get(key) else{return Value::Null;};let Some(p)=&owner.pending else{return Value::Null;};
        let scope=&self.scopes[key];json!({"schema":"BarrelShapeTransitionV1","token":p.token,"entityId":scope.entity_id,
            "spawnEpoch":scope.spawn_epoch,"buildHash":scope.build_hash,"expectedGeometryRevision":p.old_revision,
            "geometryRevision":p.new_revision,"shapeId":p.shape_id,"shapeHash":p.shape_hash,
            "eventId":p.event_id,"shotId":p.shot_id,"repairGeneration":p.repair_generation,"repairGenerations":p.repair_generations,
            "activeVariantIds":p.active_variant_ids,"transitionVariantIds":p.transition_variant_ids,
            "cause":if p.repair_generation.is_some(){"core_repaired_barrel"}else{"core_physical_barrel_destroyed"}})
    }
    pub(crate) fn shoot(&mut self,key:&str,target:&Target,state:&TargetState,shot:&Shot,end:tg_shared::Vec3,context:Option<&tg_combat::causes::DamageContext>)->Result<Value,String>{
        self.verify_state(key,state)?;self.scope_matches(key,context)?;
        let scene=self.scenes.get(key).ok_or("missing actor surface scene")?;
        let report=tg_combat::shoot_surface_impact(target,state,shot,scene,end,context)?;
        let fractures:Vec<_>=self.owners.get(key).map(|owner|{
            let active=owner.pending.as_ref().map(|p|&p.active_variant_ids).unwrap_or(&owner.active_variant_ids);
            owner.variants.iter().filter(|(id,v)|primary_fracture(scene,v,state,&report,
                active.contains(id)||owner.active_variant_ids.contains(id))).map(|(id,_)|id.clone()).collect()
        }).unwrap_or_default();
        self.observe_report(key,&report.state);
        if let Some(c)=context{if !fractures.is_empty(){
            let owner=&self.owners[key];let mut active=owner.pending.as_ref().map(|p|p.active_variant_ids.clone()).unwrap_or_else(||owner.active_variant_ids.clone());
            let mut changed=owner.pending.as_ref().map(|p|p.transition_variant_ids.clone()).unwrap_or_default();
            let repair=owner.pending.as_ref().and_then(|p|p.repair_generation);
            active.extend(fractures.iter().cloned());changed.extend(fractures);
            self.issue(key,active,changed,&c.event_id,&c.shot_id,repair)?;
        }}
        let mut result=serde_json::to_value(report).map_err(|e|e.to_string())?;result["shape_transition"]=self.pending(key);Ok(result)
    }
    pub(crate) fn near_burst(&self,key:&str,target:&Target,state:&TargetState,at:tg_shared::Vec3,shell:&tg_weapon::ProjectileDef,yaw:f32,seed:u64,context:Option<&tg_combat::causes::DamageContext>,include_pressure:bool)->Result<Report,String>{
        self.verify_state(key,state)?;self.scope_matches(key,context)?;
        let scene=self.scenes.get(key).ok_or("missing actor surface scene")?;
        if include_pressure{tg_combat::near_burst::evaluate(target,state,at,shell,yaw,seed,context,Some(scene))}
        else{tg_combat::near_burst::evaluate_casing(target,state,at,shell,yaw,seed,context,Some(scene))}
    }
}
