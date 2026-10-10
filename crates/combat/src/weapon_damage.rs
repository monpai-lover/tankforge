//! Damage belongs to mounted instances, not gun catalogue IDs. Registration is shared by
//! native/server and WASM; uncertain critical-part associations fail closed with a reason.
use crate::{Module, ModuleKind, Target, TargetDef, TargetState};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use tg_damage::module_state;
use tg_shared::Vec3;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WeaponKind {
    Cannon,
    Missile,
    MachineGun,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WeaponBinding {
    pub key: String,
    pub kind: WeaponKind,
    pub model_id: String,
    pub turret_index: Option<usize>,
    pub gun_index: Option<usize>,
    pub secondary_id: Option<String>,
    pub ammo: Vec<String>,
    pub missile: Option<String>,
    pub critical: Vec<usize>,
    pub dispersion_parts: Vec<usize>,
    pub ammo_racks: Vec<usize>,
    pub traverse: Vec<usize>,
    pub elevation: Vec<usize>,
    pub binding_error: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct WeaponCaps {
    pub can_fire: bool,
    pub dispersion_mult: f32,
    pub reload_mult: f32,
    pub traverse_mult: f32,
    pub elevate_mult: f32,
    pub reason: Option<String>,
}

pub(crate) fn vec3(v: &Value) -> Option<Vec3> {
    let a = v.as_array()?;
    let p = Vec3::new(
        a.first()?.as_f64()? as f32,
        a.get(1)?.as_f64()? as f32,
        a.get(2)?.as_f64()? as f32,
    );
    (p.x.is_finite() && p.y.is_finite() && p.z.is_finite()).then_some(p)
}

fn refs(
    def: &TargetDef,
    value: &Value,
    kind: Option<ModuleKind>,
) -> Result<Option<Vec<usize>>, String> {
    if value.is_null() {
        return Ok(None);
    }
    let names = value
        .as_array()
        .ok_or("module references must be an array")?;
    let mut out = Vec::new();
    for name in names {
        let name = name.as_str().ok_or("module reference must be a string")?;
        let matches: Vec<usize> = def
            .modules
            .iter()
            .enumerate()
            .filter(|(_, m)| m.id == name)
            .map(|(i, _)| i)
            .collect();
        if matches.len() != 1 {
            return Err(format!("module reference {name} is missing or ambiguous"));
        }
        let i = matches[0];
        if kind.is_some_and(|k| def.modules[i].kind != k) {
            return Err(format!("module reference {name} has wrong kind"));
        }
        if !out.contains(&i) {
            out.push(i);
        }
    }
    Ok(Some(out))
}

fn group<'a>(mount: &'a Value, gun: &'a Value) -> Option<&'a str> {
    mount["weapon_group"]
        .as_str()
        .or_else(|| gun["weapon_group"].as_str())
}

fn damage<'a>(mount: &'a Value, gun: &'a Value, field: &str) -> &'a Value {
    mount["damage"].get(field).unwrap_or(&gun["damage"][field])
}

pub(crate) fn validate_critical(
    modules: &[Module],
    kind: WeaponKind,
    indices: &[usize],
    aps_gun: Option<&str>,
) -> Result<(), String> {
    if indices.is_empty() {
        return Err("empty critical module references".into());
    }
    for &i in indices {
        let m = &modules[i];
        let allowed = match kind {
            WeaponKind::Cannon if aps_gun.is_some() => {
                m.kind == ModuleKind::ApsGun && Some(m.id.as_str()) == aps_gun
            }
            WeaponKind::Cannon => matches!(m.kind, ModuleKind::GunBreech | ModuleKind::GunBarrel),
            WeaponKind::Missile => m.kind == ModuleKind::Launcher,
            WeaponKind::MachineGun => m.kind == ModuleKind::MachineGun,
        };
        if !allowed {
            return Err(format!(
                "critical module reference {} has wrong module kind for {:?}",
                m.id, kind
            ));
        }
    }
    if kind == WeaponKind::Cannon
        && aps_gun.is_none()
        && (!indices
            .iter()
            .any(|&i| modules[i].kind == ModuleKind::GunBreech)
            || !indices
                .iter()
                .any(|&i| modules[i].kind == ModuleKind::GunBarrel))
    {
        return Err(
            "incomplete cannon critical modules: requires gun_breech and gun_barrel".into(),
        );
    }
    Ok(())
}

fn independent_aps_gun(w: &Value, kind: WeaponKind, ti: usize) -> Result<Option<&str>, String> {
    let gun = w["aps"]["gun_module"].as_str();
    if kind != WeaponKind::Cannon || w["aps"]["turret"].as_u64() != Some(ti as u64) || gun.is_none()
    {
        return Ok(None);
    }
    if ti == 0 {
        return Err("invalid APS turret association".into());
    }
    if w["extra_turrets"][ti - 1]["guns"]
        .as_array()
        .map_or(0, Vec::len)
        != 1
    {
        return Err("ambiguous APS gun instance".into());
    }
    Ok(gun)
}

/// Extra turret IDs are authored identities, not ordinal labels. A legacy workshop
/// primary is t1 only when that identity is not already carried by an extra turret.
fn turret_identity(def: &TargetDef, ti: usize) -> Option<&str> {
    if ti > 0 {
        return def.weapons["extra_turrets"][ti - 1]["id"].as_str();
    }
    let t1_is_extra = def.weapons["extra_turrets"]
        .as_array()
        .into_iter()
        .flatten()
        .any(|t| t["id"] == "t1");
    (!t1_is_extra
        && def.modules.iter().any(|m| {
            ["breech_t1_", "gun_barrel_t1_", "launcher_t1_"]
                .iter()
                .any(|prefix| m.id.starts_with(prefix))
        }))
    .then_some("t1")
}

fn authored_owner(def: &TargetDef, m: &Module) -> Result<Option<usize>, String> {
    if let Some(ti) = m.turret_index {
        return Ok(Some(ti));
    }
    let count = 1 + def.weapons["extra_turrets"].as_array().map_or(0, Vec::len);
    let owners: Vec<_> = (0..count)
        .filter(|&ti| {
            turret_identity(def, ti).is_some_and(|id| {
                ["breech", "gun_barrel", "launcher"]
                    .iter()
                    .any(|prefix| m.id.starts_with(&format!("{prefix}_{id}_")))
                    || [
                        "turret_drive",
                        "horizontal_drive",
                        "vertical_drive",
                        "ammo_rack",
                    ]
                    .iter()
                    .any(|prefix| m.id == format!("{prefix}_{id}"))
            })
        })
        .collect();
    match owners.as_slice() {
        [] => Ok(None),
        [ti] => Ok(Some(*ti)),
        _ => Err(format!("ambiguous authored turret for {}", m.id)),
    }
}

fn part(
    def: &TargetDef,
    kind: ModuleKind,
    mount: Vec3,
    group: Option<&str>,
    single: bool,
    ti: usize,
    gi: usize,
) -> Result<Vec<usize>, String> {
    let mut candidates: Vec<usize> = def
        .modules
        .iter()
        .enumerate()
        .filter(|(_, m)| m.kind == kind && m.weapon_group.as_deref() == group)
        .map(|(i, _)| i)
        .collect();
    if group.is_some() {
        return if candidates.is_empty() {
            Err(format!(
                "missing {} parts for explicit group",
                kind.as_str()
            ))
        } else {
            Ok(candidates)
        };
    }
    let mut owned = Vec::new();
    for i in candidates {
        if authored_owner(def, &def.modules[i])?.is_none_or(|owner| owner == ti) {
            owned.push(i);
        }
    }
    candidates = owned;
    if single && !candidates.is_empty() {
        return Ok(candidates);
    }
    let suffix = turret_identity(def, ti).map(|id| format!("_{id}_{gi}"));
    let semantic: Vec<usize> = candidates
        .iter()
        .copied()
        .filter(|&i| {
            suffix
                .as_ref()
                .is_some_and(|s| def.modules[i].id.ends_with(s))
        })
        .collect();
    if !semantic.is_empty() {
        return if semantic.len() == 1 {
            Ok(semantic)
        } else {
            Err(format!("ambiguous {} instance identity", kind.as_str()))
        };
    }
    // A cannon bore is parallel to +Z at registration. Match its transverse line and
    // physical axial neighborhood, never choose an arbitrary nearest model or module.
    let candidates: Vec<usize> = candidates
        .into_iter()
        .filter(|&i| {
            let m = &def.modules[i];
            let h = m.half_extents;
            (m.center.x - mount.x).abs() <= h.x + 0.06
                && (m.center.y - mount.y).abs() <= h.y + 0.06
                && match kind {
                    ModuleKind::GunBreech => (m.center.z - mount.z).abs() <= h.z + 0.85,
                    ModuleKind::GunBarrel => {
                        m.center.z + h.z >= mount.z && m.center.z - h.z <= mount.z + 12.0
                    }
                    _ => (m.center.z - mount.z).abs() <= h.z + 0.85,
                }
        })
        .collect();
    match candidates.len() {
        1 => Ok(candidates),
        0 => Err(format!("missing {} association", kind.as_str())),
        _ => Err(format!("ambiguous {} association", kind.as_str())),
    }
}

fn turret_owner(def: &TargetDef, m: &Module, turret_count: usize) -> Result<Option<usize>, String> {
    if let Some(ti) = m.turret_index {
        return Ok(Some(ti));
    }
    if let Some(group) = &m.weapon_group {
        if let Some(index) = group.strip_prefix("turret:").and_then(|s| s.parse().ok()) {
            return Ok(Some(index));
        }
    }
    if let Some(owner) = authored_owner(def, m)? {
        return Ok(Some(owner));
    }
    if ["turret_drive", "horizontal_drive", "vertical_drive"].contains(&m.id.as_str()) {
        return Ok(Some(0));
    }
    if turret_count == 1 {
        return Ok(Some(0));
    }
    let mut candidates = Vec::new();
    for ti in 0..turret_count {
        let geom = if ti == 0 {
            def.turret.as_ref().map(|t| (t.pivot, t.size))
        } else {
            let t = &def.weapons["extra_turrets"][ti - 1];
            vec3(&t["position_m"]).zip(vec3(&t["size_m"]))
        };
        if let Some((p, s)) = geom {
            if (m.center.x - p.x).abs() <= s.x * 0.55
                && (m.center.z - p.z).abs() <= s.z * 0.55
                && m.center.y >= p.y - 0.15
                && m.center.y <= p.y + s.y
            {
                candidates.push(ti);
            }
        }
    }
    match candidates.len() {
        0 => Ok(None),
        1 => Ok(Some(candidates[0])),
        _ => Err(format!("ambiguous turret for {}", m.id)),
    }
}

fn dependencies(
    def: &TargetDef,
    mount: &Value,
    gun: &Value,
    ti: usize,
    gi: usize,
    kind: WeaponKind,
    critical: &[usize],
    turret_count: usize,
) -> Result<(Vec<usize>, Vec<usize>, Vec<usize>), String> {
    let drives = |field: &str, kinds: &[ModuleKind]| -> Result<Vec<usize>, String> {
        if let Some(indices) = refs(def, damage(mount, gun, field), None)? {
            if indices
                .iter()
                .any(|&i| !kinds.contains(&def.modules[i].kind))
            {
                return Err(format!("wrong-kind {field} module reference"));
            }
            return Ok(indices);
        }
        let mut out = Vec::new();
        for (i, m) in def
            .modules
            .iter()
            .enumerate()
            .filter(|(_, m)| kinds.contains(&m.kind))
        {
            if let Some(g) = m.weapon_group.as_deref() {
                // Reserved keys keep the entire mounted identity. Only turret:ti
                // explicitly shares a grouped drive with every gun of that turret.
                let reserved = g.starts_with("gun:") || g.starts_with("turret:");
                let own = g == format!("gun:{ti}:{gi}")
                    || g == format!("turret:{ti}")
                    || (!reserved
                        && (group(mount, gun) == Some(g)
                            || critical
                                .iter()
                                .any(|&i| def.modules[i].weapon_group.as_deref() == Some(g))));
                if own {
                    out.push(i);
                }
            } else if turret_owner(def, m, turret_count)? == Some(ti) {
                out.push(i);
            }
        }
        Ok(out)
    };
    let traverse = drives(
        "traverse",
        &[ModuleKind::TurretDrive, ModuleKind::HorizontalDrive],
    )?;
    let elevation = drives("elevation", &[ModuleKind::VerticalDrive])?;
    let racks = if let Some(indices) = refs(
        def,
        damage(mount, gun, "ammo_racks"),
        Some(ModuleKind::AmmoRack),
    )? {
        indices
    } else if kind == WeaponKind::Cannon {
        def.modules
            .iter()
            .enumerate()
            .filter(|(_, m)| m.kind == ModuleKind::AmmoRack)
            .filter(|(_, m)| {
                if let Some(g) = m.weapon_group.as_deref() {
                    return g == format!("turret:{ti}") || g == format!("gun:{ti}:{gi}");
                }
                authored_owner(def, m).is_ok_and(|owner| owner.is_none_or(|owner| owner == ti))
            })
            .map(|(i, _)| i)
            .collect()
    } else {
        Vec::new()
    };
    Ok((traverse, elevation, racks))
}

pub(crate) fn register(def: &mut TargetDef) -> BTreeMap<String, WeaponBinding> {
    let w = def.weapons.clone();
    let mut mounts: Vec<(usize, usize, Value, Value)> = Vec::new();
    if w["main_gun"].is_object() {
        mounts.push((0, 0, w.clone(), w["main_gun"].clone()));
    }
    for (gi, m) in w["extra_guns"].as_array().into_iter().flatten().enumerate() {
        mounts.push((0, gi + 1, m.clone(), m["gun"].clone()));
    }
    for (ti, t) in w["extra_turrets"]
        .as_array()
        .into_iter()
        .flatten()
        .enumerate()
    {
        for (gi, m) in t["guns"].as_array().into_iter().flatten().enumerate() {
            mounts.push((ti + 1, gi, m.clone(), m["gun"].clone()));
        }
    }
    let cannon_count = mounts
        .iter()
        .filter(|(_, _, _, g)| !g["missile"].is_string())
        .count();
    let launcher_count = mounts.len() - cannon_count;
    let turret_count = 1 + w["extra_turrets"].as_array().map_or(0, Vec::len);
    let mut bindings = BTreeMap::new();
    for (ti, gi, mount, gun) in mounts {
        let key = format!("gun:{ti}:{gi}");
        let missile = gun["missile"].as_str().map(String::from);
        let kind = if missile.is_some() {
            WeaponKind::Missile
        } else {
            WeaponKind::Cannon
        };
        let mut b = WeaponBinding {
            key: key.clone(),
            kind,
            model_id: gun["id"].as_str().unwrap_or("").into(),
            turret_index: Some(ti),
            gun_index: Some(gi),
            secondary_id: None,
            ammo: gun["ammo"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|s| s.as_str().map(String::from))
                .collect(),
            missile,
            critical: vec![],
            dispersion_parts: vec![],
            ammo_racks: vec![],
            traverse: vec![],
            elevation: vec![],
            binding_error: None,
        };
        let result = (|| -> Result<(), String> {
            let p = vec3(&mount["mount_m"]).ok_or("missing/invalid mount_m")?;
            let aps_gun = independent_aps_gun(&w, kind, ti)?;
            let instance_group = def.modules.iter().any(|m| {
                m.weapon_group.as_deref() == Some(&key)
                    && match kind {
                        WeaponKind::Missile => m.kind == ModuleKind::Launcher,
                        _ => matches!(m.kind, ModuleKind::GunBreech | ModuleKind::GunBarrel),
                    }
            });
            let explicit_group = group(&mount, &gun).or(if instance_group {
                Some(key.as_str())
            } else {
                None
            });
            if let Some(explicit) = refs(def, damage(&mount, &gun, "critical"), None)? {
                if explicit.is_empty() {
                    return Err("empty critical module references".into());
                }
                b.critical = explicit;
            } else if let Some(aps_gun) = aps_gun {
                b.critical =
                    refs(def, &serde_json::json!([aps_gun]), Some(ModuleKind::ApsGun))?.unwrap();
            } else if kind == WeaponKind::Missile {
                let conventional = if ti == 0 && gi == 0 {
                    "main_launcher".into()
                } else {
                    format!("launcher_mount_{gi}")
                };
                let authored = turret_identity(def, ti).map(|id| format!("launcher_{id}_{gi}"));
                let authored_exists = authored.as_ref().is_some_and(|group| {
                    def.modules.iter().any(|m| {
                        m.kind == ModuleKind::Launcher && m.weapon_group.as_deref() == Some(group)
                    })
                });
                let explicit = explicit_group.or(if authored_exists {
                    authored.as_deref()
                } else {
                    None
                });
                let conventional_exists = def.modules.iter().any(|m| {
                    m.kind == ModuleKind::Launcher
                        && m.weapon_group.as_deref() == Some(&conventional)
                });
                let g = explicit.or(if conventional_exists {
                    Some(&conventional)
                } else {
                    None
                });
                if launcher_count == 1 && g.is_none() {
                    b.critical = def
                        .modules
                        .iter()
                        .enumerate()
                        .filter(|(_, m)| m.kind == ModuleKind::Launcher && m.weapon_group.is_none())
                        .map(|(i, _)| i)
                        .collect();
                    if b.critical.is_empty() {
                        return Err("missing launcher association".into());
                    }
                } else {
                    b.critical = part(def, ModuleKind::Launcher, p, g, false, ti, gi)?;
                }
            } else {
                b.critical = part(
                    def,
                    ModuleKind::GunBreech,
                    p,
                    explicit_group,
                    cannon_count == 1,
                    ti,
                    gi,
                )?;
                b.critical.extend(part(
                    def,
                    ModuleKind::GunBarrel,
                    p,
                    explicit_group,
                    cannon_count == 1,
                    ti,
                    gi,
                )?);
            }
            validate_critical(&def.modules, kind, &b.critical, aps_gun)?;
            b.dispersion_parts = if kind == WeaponKind::Missile {
                vec![]
            } else {
                b.critical
                    .iter()
                    .copied()
                    .filter(|&i| {
                        matches!(
                            def.modules[i].kind,
                            ModuleKind::GunBreech | ModuleKind::GunBarrel | ModuleKind::ApsGun
                        )
                    })
                    .collect()
            };
            let (traverse, elevation, racks) =
                dependencies(def, &mount, &gun, ti, gi, kind, &b.critical, turret_count)?;
            b.traverse = traverse;
            b.elevation = elevation;
            b.ammo_racks = racks;
            Ok(())
        })();
        if let Err(e) = result {
            b.binding_error = Some(e);
        }
        bindings.insert(key, b);
    }
    super::weapon_mg::register(def, &mut bindings);
    let mut owners: BTreeMap<usize, Vec<String>> = BTreeMap::new();
    for (key, b) in &bindings {
        if b.binding_error.is_none() {
            for &i in &b.critical {
                owners.entry(i).or_default().push(key.clone());
            }
        }
    }
    for (i, keys) in owners.iter().filter(|(_, keys)| keys.len() > 1) {
        for key in keys {
            bindings.get_mut(key).unwrap().binding_error = Some(format!(
                "ambiguous shared critical part {}",
                def.modules[*i].id
            ));
        }
    }
    bindings
}

fn factor(t: &Target, st: &TargetState, indices: &[usize], curve: fn(f32) -> f32) -> f32 {
    indices
        .iter()
        .filter_map(|&i| {
            t.def.modules.get(i).map(|m| {
                curve(module_state::health_ratio(
                    st.modules.get(i).copied().unwrap_or(m.max_health),
                    m.max_health,
                ))
            })
        })
        .fold(1.0, f32::min)
}

pub(crate) fn capabilities(
    t: &Target,
    st: &TargetState,
    gunner: bool,
    loader: bool,
) -> BTreeMap<String, WeaponCaps> {
    t.weapon_bindings
        .iter()
        .map(|(key, b)| {
            let reason = if let Some(e) = &b.binding_error {
                Some(format!("binding: {e}"))
            } else if st.destroyed || st.ammo_detonated {
                Some("destroyed".into())
            } else if st.repair_s > 0.0 {
                Some("repairing".into())
            } else if !gunner {
                Some("gunner unavailable".into())
            } else {
                b.critical.iter().find_map(|&i| {
                    let m = &t.def.modules[i];
                    (module_state::health_ratio(
                        st.modules.get(i).copied().unwrap_or(m.max_health),
                        m.max_health,
                    ) <= 0.0)
                        .then(|| format!("{} destroyed", m.id))
                })
            };
            // Scatter and feeding multipliers worsen with damage; take the worst relevant part.
            let dispersion_mult = b
                .dispersion_parts
                .iter()
                .map(|&i| {
                    let m = &t.def.modules[i];
                    module_state::dispersion_multiplier(module_state::health_ratio(
                        st.modules.get(i).copied().unwrap_or(m.max_health),
                        m.max_health,
                    ))
                })
                .fold(1.0, f32::max);
            let feed = b
                .ammo_racks
                .iter()
                .copied()
                .filter(|&i| !super::empty_rack(t, st, i))
                .map(|i| {
                    let m = &t.def.modules[i];
                    module_state::ammo_reload_multiplier(module_state::health_ratio(
                        st.modules.get(i).copied().unwrap_or(m.max_health),
                        m.max_health,
                    ))
                })
                .fold(1.0, f32::max);
            (
                key.clone(),
                WeaponCaps {
                    can_fire: reason.is_none(),
                    reason,
                    dispersion_mult,
                    reload_mult: feed * if loader { 1.0 } else { 1.6 },
                    traverse_mult: factor(t, st, &b.traverse, module_state::traverse_factor),
                    elevate_mult: factor(t, st, &b.elevation, module_state::elevation_factor),
                },
            )
        })
        .collect()
}

/// Select a usable mounted instance and validate the model/ammunition request against it.
/// Legacy requests without an instance are accepted only if one eligible matching mount exists.
pub fn select_weapon<'a>(
    t: &'a Target,
    st: &TargetState,
    instance: Option<&str>,
    model: Option<&str>,
    ammo: Option<&str>,
    missile: Option<&str>,
) -> Result<&'a WeaponBinding, String> {
    let caps = crate::caps(t, st);
    let candidates: Vec<_> = t
        .weapon_bindings
        .values()
        .filter(|b| {
            instance.is_none_or(|key| b.key == key)
                && model.is_none_or(|id| b.model_id == id)
                && ammo.is_none_or(|id| b.ammo.iter().any(|a| a == id))
                && missile.is_none_or(|id| b.missile.as_deref() == Some(id))
                && caps.weapons.get(&b.key).is_some_and(|c| c.can_fire)
        })
        .collect();
    match candidates.len() {
        1 => Ok(candidates[0]),
        0 => Err("no eligible matching weapon instance".into()),
        _ => Err("ambiguous weapon instance".into()),
    }
}
