// Presentation provenance must survive the actual JS export and strict native loader.
use std::{fs, path::Path, process::Command};

#[test]
fn workshop_weapon_and_engine_audio_sources_roundtrip_without_relaxing_strict_loading() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let output = Command::new("node").current_dir(&root).args(["--input-type=module", "-e", r#"
        import {loadData} from './client/web/tools/load-data.mjs';
        import {newTurretSpec, exportFolder} from './client/web/src/game/loadout.js';
        const data=loadData();
        const build={base:'de_hetzer',keepStock:false,turrets:[
          {...newTurretSpec(),id:'front',guns:[{weapon:'de_tiger_e'},{weapon:'xp_kda35'}]},
          {...newTurretSpec(),id:'rear',guns:[{weapon:'de_panther_f'}]}
        ]};
        process.stdout.write(JSON.stringify(exportFolder(build,data,data.vehicles.de_hetzer,'audio_export','Audio',{includeModel:false}).files));
    "#]).output().expect("Node is required for the real workshop exporter");
    assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
    let files: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    let dir = std::env::temp_dir().join(format!("tankforge-workshop-audio-{}", std::process::id()));
    fs::create_dir_all(&dir).unwrap();
    for (name, value) in files.as_object().unwrap() {
        fs::write(dir.join(name), serde_json::to_vec(value).unwrap()).unwrap();
    }
    let loaded = tg_vehicle::load_vehicle(&dir).expect("exported presentation identities must load");
    let weapons = serde_json::to_value(&loaded.weapons).unwrap();
    assert_eq!(weapons["sourceVehicle"], "de_tiger_e");
    assert_eq!(weapons["extra_guns"][0]["sourceVehicle"], "xp_kda35");
    assert_eq!(weapons["extra_turrets"][0]["guns"][0]["sourceVehicle"], "de_panther_f");
    assert_eq!(serde_json::to_value(&loaded.engine).unwrap()["audio_source_vehicle"], "de_hetzer");
    assert_eq!(weapons["main_gun"]["id"], files["weapons.json"]["main_gun"]["id"]);
    let mut unknown = weapons.clone();
    unknown["unknown_gameplay_field"] = serde_json::json!(true);
    assert!(serde_json::from_value::<tg_vehicle::WeaponsFile>(unknown).is_err());
    let mut unknown_engine = serde_json::to_value(&loaded.engine).unwrap();
    unknown_engine["unknown_gameplay_field"] = serde_json::json!(true);
    assert!(serde_json::from_value::<tg_vehicle::EngineFile>(unknown_engine).is_err());
    for file in fs::read_dir(&dir).unwrap() { fs::remove_file(file.unwrap().path()).unwrap(); }
    fs::remove_dir(dir).unwrap();
}
