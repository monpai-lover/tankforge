//! Neutral-frame MG receiver/barrel boxes from the measured shared catalogue. Independent
//! pintle/hull yaw and elevation are not represented by the current combat Shot pose API.
use super::weapon_damage::{validate_critical, vec3, WeaponBinding, WeaponKind};
use crate::{Module, ModuleKind, TargetDef};
use serde_json::Value;
use std::collections::BTreeMap;
use std::sync::OnceLock;

pub(crate) fn register(def: &mut TargetDef, out: &mut BTreeMap<String, WeaponBinding>) {
    // Legacy adapters can omit the optional catalogue. Use exactly the same measured
    // first-party definitions as native/server registration, never browser heuristics.
    static FALLBACK: OnceLock<Value> = OnceLock::new();
    let catalog = if def.machine_guns.is_null() {
        FALLBACK.get_or_init(|| {
            serde_json::from_str(include_str!("../../../data/machine_guns.json"))
                .unwrap_or(Value::Null)
        })
    } else {
        &def.machine_guns
    };
    let secondaries = def.weapons["secondary"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    for sec in secondaries {
        let (Some(id), Some(model), Some(mount)) = (
            sec["id"].as_str(),
            sec["weapon"].as_str(),
            sec["mount"].as_str(),
        ) else {
            continue;
        };
        let key = format!("mg:{id}");
        let hull = mount == "hull" || def.visual["mg_anchors"][id].as_str() == Some("hull");
        let mut b = WeaponBinding {
            key: key.clone(),
            kind: WeaponKind::MachineGun,
            model_id: model.into(),
            turret_index: if hull { None } else { Some(0) },
            gun_index: None,
            secondary_id: Some(id.into()),
            ammo: vec![],
            missile: None,
            critical: vec![],
            dispersion_parts: vec![],
            ammo_racks: vec![],
            traverse: vec![],
            elevation: vec![],
            binding_error: None,
        };
        let result = (|| -> Result<(), String> {
            if !["hull", "pintle", "coax"].contains(&mount) {
                return Err("unknown MG mount".into());
            }
            let pos = vec3(&sec["position_m"]).ok_or("missing/invalid MG position_m")?;
            let explicit_group = sec
                .get("weapon_group")
                .map(|v| {
                    v.as_str()
                        .filter(|s| !s.is_empty())
                        .ok_or("invalid explicit MG group")
                })
                .transpose()?;
            let group = explicit_group.unwrap_or(&key);
            let existing: Vec<_> = def
                .modules
                .iter()
                .enumerate()
                .filter(|(_, m)| m.weapon_group.as_deref() == Some(group))
                .map(|(i, _)| i)
                .collect();
            if !existing.is_empty() {
                validate_critical(&def.modules, WeaponKind::MachineGun, &existing, None)?;
                b.critical = existing;
            } else {
                if explicit_group.is_some() {
                    return Err("missing explicit MG group parts".into());
                }
                let entries: Vec<_> = catalog
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter(|m| m["id"].as_str() == Some(model))
                    .collect();
                if entries.len() != 1 {
                    return Err("MG catalogue entry missing or ambiguous".into());
                }
                let base = &entries[0]["damage_geometry"];
                let variant = def.visual["mg_variants"][id].as_str();
                let geom = if let Some(v) = variant {
                    &base["variants"][v]
                } else {
                    base
                };
                let muzzle = vec3(&geom["muzzle"]).ok_or("missing MG damage_geometry muzzle")?;
                // Coax authoring gives a muzzle, hull authoring gives its ball pivot with
                // the runtime's 0.3m forward muzzle, pintle authoring gives the swivel.
                let origin = match mount {
                    "coax" => pos - muzzle,
                    "hull" => pos + tg_shared::Vec3::new(0.0, 0.0, 0.3) - muzzle,
                    _ => pos,
                };
                let mut parts = Vec::new();
                for part in ["receiver", "barrel"] {
                    let p = &geom[part];
                    let center = vec3(&p["center"]).ok_or("missing MG part center")? + origin;
                    let half_extents =
                        vec3(&p["half_extents"]).ok_or("missing MG part half_extents")?;
                    if half_extents.x <= 0.0 || half_extents.y <= 0.0 || half_extents.z <= 0.0 {
                        return Err("invalid MG part extents".into());
                    }
                    let module_id = format!("{key}:{part}");
                    if def.modules.iter().any(|m| m.id == module_id) {
                        return Err("MG module ID collision".into());
                    }
                    parts.push(Module {
                        id: module_id,
                        kind: ModuleKind::MachineGun,
                        center,
                        half_extents,
                        max_health: 40.0,
                        health: 40.0,
                        rounds: None,
                        weapon_group: Some(key.clone()),
                        external: Some(mount == "pintle" || part == "barrel"),
                        turret_index: b.turret_index,
                    });
                }
                for m in parts {
                    b.critical.push(def.modules.len());
                    def.modules.push(m);
                }
            }
            b.dispersion_parts = b.critical.clone();
            // A coax gun follows its cannon's own laying drives, not its breech health.
            if mount == "coax" {
                if let Some(main) = out.get("gun:0:0") {
                    b.traverse = main.traverse.clone();
                    b.elevation = main.elevation.clone();
                }
            }
            Ok(())
        })();
        if let Err(e) = result {
            b.binding_error = Some(e);
        }
        if out.contains_key(&key) {
            b.binding_error = Some("duplicate secondary ID".into());
        }
        out.insert(key, b);
    }
}
