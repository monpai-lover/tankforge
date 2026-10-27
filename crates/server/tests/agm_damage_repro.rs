//! Source-backed diagnostic matrix for the native declared-geometry AGM path.
use serde_json::{json, Value};
use std::path::Path;
use tg_combat::{near_burst, shoot, Shot, Target};
use tg_shared::Vec3;
use tg_weapon::ProjectileDef;

#[test]
fn actual_agm_direct_and_near_miss_damage_matrix() {
    let data = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data");
    let catalog = tg_server::server::load_combat(&data);
    let air: Value = serde_json::from_slice(&std::fs::read(data.join("aircraft/frontline.json")).unwrap()).unwrap();
    let mut agms: Vec<_> = air["storeDefinitions"].as_object().unwrap().iter()
        .filter(|(_, store)| store["kind"] == "agm").collect();
    agms.sort_by_key(|(id, _)| *id);
    assert_eq!(agms.len(), 13);
    for (id, store) in agms {
        let shell_id = store["projectile_id"].as_str().unwrap();
        let shell: ProjectileDef = serde_json::from_value(air["shells"][shell_id].clone()).unwrap();
        for target_id in ["de_flakpz38t", "us_m8", "de_sdkfz234_2", "de_tiger_e", "su_t72a"] {
            let target = &catalog.targets[target_id];
            let center = target.def.crew.iter().fold(Vec3::ZERO, |sum, crew| sum + crew.pos)
                * (1. / target.def.crew.len() as f32);
            for direction in ["top", "front", "side", "near_side_0.5", "near_side_3"] {
                let before = target.fresh_state();
                let mut direct_changed = None;
                let report = if direction.starts_with("near_") {
                    let gap = if direction == "near_side_0.5" { 0.5 } else { 3. };
                    // Broadphase bounds include articulated barrel sweeps. Anchor
                    // a near miss to the accepted physical side contact instead.
                    let probe = Shot { shell: shell.clone(), origin: Vec3::new(target.hi.x + 40., center.y, center.z),
                        dir: Vec3::new(-1.,0.,0.), speed_ms: 300., distance_m: 1000., seed: 3, turret_yaw: 0. };
                    let contact = shoot(target, &before, &probe).impact.unwrap_or_else(||
                        target.def.plates.iter().filter(|p| matches!(p.zone,tg_armor::ArmorZone::HullSide))
                            .max_by(|a,b|a.center.x.total_cmp(&b.center.x)).expect("source side armor").center);
                    near_burst::evaluate(target, &before, contact + Vec3::new(gap,0.,0.),
                        &shell, 0., 3, None, None).unwrap()
                } else {
                    let origin = match direction {
                        "top" => Vec3::new(center.x, target.hi.y + 40., center.z),
                        "front" => Vec3::new(center.x, center.y, target.hi.z + 40.),
                        _ => Vec3::new(target.hi.x + 40., center.y, center.z),
                    };
                    let shot = Shot { shell: shell.clone(), origin, dir: (center - origin).normalized(),
                        speed_ms: 300., distance_m: 1000., seed: 3, turret_yaw: 0. };
                    let direct = shoot(target, &before, &shot);
                    direct_changed = Some(state_change(target, &before, &direct));
                    tg_server::he_effects::contact(target, &before, &shot, direct)
                };
                let row = json!({"store":id,"shell":shell_id,"target":target_id,"open_top":target.def.open_top,
                    "case":direction,"raw_filler_kg":shell.explosive_mass_kg,"type":shell.explosive_type,
                    "declared_tnt_kg":tg_server::he_effects::tnt_kg(&shell),"direct":direct_changed,
                    "final":state_change(target,&before,&report),"plate":report.plate,"outcome":report.outcome,
                    "bursts":report.bursts,"events":report.events});
                eprintln!("agm_native_matrix {row}");
                assert!(report.state.crew.iter().chain(&report.state.modules).all(|health| health.is_finite()));
            }
        }
    }
}

fn state_change(target: &Target, before: &tg_combat::TargetState, report: &tg_combat::Report) -> Value {
    json!({"hit":report.hit,"destroyed":report.state.destroyed,"crew_alive":report.caps.crew_alive,
        "crew_total":target.def.crew.len(),"crew_health":report.state.crew,
        "crew_damage":before.crew.iter().sum::<f32>()-report.state.crew.iter().sum::<f32>(),
        "module_damage":before.modules.iter().sum::<f32>()-report.state.modules.iter().sum::<f32>(),
        "fragments":report.fragments.len(),"pressure_hits":report.fragments.iter().filter(|f|f.kind=="blast"&&f.damage>0.).count()})
}
