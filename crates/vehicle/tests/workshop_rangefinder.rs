// Exercise the actual web exporter and then the native strict folder loader.
use std::{collections::HashMap, fs, path::Path, process::Command};
use tg_armor::MaterialDb;
use tg_vehicle::{load_materials, load_projectiles, load_vehicle, validate_vehicle, RangefinderKind};

#[test]
fn actual_workshop_exports_preserve_equipment_through_native_folder_loading() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let output = Command::new("node").current_dir(&root).args(["--input-type=module", "-e", r#"
      import {loadData} from './client/web/tools/load-data.mjs';
      import {newTurretSpec, exportFolder} from './client/web/src/game/loadout.js';
      const data=loadData();
      const kinds=['inherit','manual','coincidence','stereoscopic','laser'];
      const exports=kinds.map(kind=>exportFolder({base:'de_hetzer',keepStock:false,turrets:[{...newTurretSpec(),sightSource:'de_panther_f',rangefinderKind:kind,guns:[{weapon:'xp_kda35'}]}]},data,data.vehicles.de_hetzer,'rf_export','RF',{includeModel:false}).files);
      process.stdout.write(JSON.stringify(exports));
    "#]).output().expect("Node is required to verify actual workshop exports");
    assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
    let exports: Vec<serde_json::Value> = serde_json::from_slice(&output.stdout).unwrap();
    let dir = std::env::temp_dir().join(format!("tankforge-rangefinder-export-{}", std::process::id()));
    fs::create_dir_all(&dir).unwrap();
    let db = MaterialDb::from_vec(load_materials(&root.join("data/materials.json")).unwrap());
    let shells: HashMap<_, _> = load_projectiles(&root.join("data/projectiles")).unwrap().into_iter().map(|(_, p)| (p.id.clone(), p)).collect();
    for (files, kind) in exports.iter().zip([RangefinderKind::Stereoscopic, RangefinderKind::Manual, RangefinderKind::Coincidence, RangefinderKind::Stereoscopic, RangefinderKind::Laser]) {
        for (name, value) in files.as_object().unwrap() {
            fs::write(dir.join(name), serde_json::to_vec(value).unwrap()).unwrap();
        }
        let loaded = load_vehicle(&dir).expect("full exported folder must load");
        let rf = loaded.weapons.sight.as_ref().unwrap().rangefinder.as_ref().unwrap();
        assert_eq!(rf.kind, Some(kind));
        assert_eq!((rf.time_s, rf.error_pct, rf.max_range_m), (3.0, 2.0, 4000.0));
        let report = validate_vehicle(&loaded, &db, &shells);
        assert!(!report.has("W009"), "{report}");
        let written = serde_json::to_value(&loaded.weapons).unwrap();
        assert_eq!(written["sight"]["rangefinder"]["kind"], files["weapons.json"]["sight"]["rangefinder"]["kind"]);
        for field in ["time_s", "error_pct", "max_range_m"] {
            assert_eq!(written["sight"]["rangefinder"][field].as_f64(), files["weapons.json"]["sight"]["rangefinder"][field].as_f64());
        }
        let _: tg_vehicle::WeaponsFile = serde_json::from_value(written).unwrap();
    }
    for file in fs::read_dir(&dir).unwrap() { fs::remove_file(file.unwrap().path()).unwrap(); }
    fs::remove_dir(dir).unwrap();
}
