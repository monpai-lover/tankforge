use super::*;
use tg_armor::ArmorKind;
use tg_weapon::CurvePoint;

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
    assert_eq!(counts, (42, 47, 45));
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
        id: "narrow_turret".into(), plates: vec![],
        modules: vec![module("narrow", kind, [0.0, 1.0, 0.0], [0.1, 0.1, 1.0], 100.0)],
        crew: vec![], turret: Some(TurretGeom { pivot: Vec3::new(0.0, 0.5, 0.0), size: Vec3::new(2.0, 1.0, 2.0) }),
        open_top: false, ammo_capacity: 0, weapons: serde_json::Value::Null, machine_guns: serde_json::Value::Null, visual: serde_json::Value::Null,
    }, &rha())
}

fn work<'a>(t: &'a Target, st: &TargetState, yaw: f32) -> Work<'a> {
    let rep = shoot(t, st, &Shot { origin: Vec3::new(20.0, 20.0, 20.0), dir: Vec3::new(0.0, 1.0, 0.0), ..side_shot(ap(), 1) });
    Work { t, p: t.posed(yaw), st: st.clone(), rng: Rng::new(1), rep,
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
    let def = TargetDef { id: "box".into(), plates, modules, crew, turret: Some(TurretGeom { pivot: Vec3::new(0.0, 1.8, 0.0), size: Vec3::new(2.0, 0.9, 2.4) }), open_top, ammo_capacity: 0, weapons: serde_json::Value::Null, machine_guns: serde_json::Value::Null, visual: serde_json::Value::Null };
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
    let mut w = Work { t: &t, p, st: st.clone(), rng: Rng::new(1), rep: shoot(&t, &st, &side_shot(ap(), 1)), mod_dmg: HashMap::new(), crew_dmg: HashMap::new(), newly_destroyed: vec![], newly_killed: vec![] };
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
    assert!(r.crew.iter().any(|c| c.role == CrewRole::Commander && c.damage > 50.0), "{:?}", r.crew);
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
    let blast_at = Vec3::new(2.4, 1.6, 0.0);
    // Keep the burst outside the lowered wall's 2.3 m tip, and close enough to reach the
    // gunner: 0.68 kg only reaches 2.67 m of open crew, short of this 2.91 m line.
    let blast_kg = 1.2;
    assert!((upright.def.crew[2].pos - blast_at).length() < outside_radius_m(blast_kg) * 1.4);
    let raised_blast = splash(&upright, &state, blast_at, blast_kg, 0.0, 31);
    let lowered_blast = splash(&folded, &state, blast_at, blast_kg, 0.0, 31);
    assert!(!raised_blast.crew.iter().any(|c| c.index == 2 && c.damage > 0.0));
    assert!(lowered_blast.crew.iter().any(|c| c.index == 2 && c.damage > 0.0));
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
