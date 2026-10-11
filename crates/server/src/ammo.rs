//! One inventory per mounted gun. Tubes, belts and breeches are part of carried stock.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap};
use tg_combat::Target;

pub const MAX_SAFE_COUNTER: u64 = 9_007_199_254_740_991;
pub type AmmoMix = BTreeMap<String, Vec<u32>>;
pub fn selected_mix<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<AmmoMix>, D::Error> {
    struct SelectedMix;
    impl<'de> serde::de::Visitor<'de> for SelectedMix {
        type Value = AmmoMix;
        fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
            f.write_str("a unique mounted ammunition map")
        }
        fn visit_map<M: serde::de::MapAccess<'de>>(self, mut map: M) -> Result<AmmoMix, M::Error> {
            let mut selected = AmmoMix::new();
            while let Some((key, counts)) = map.next_entry::<String, Vec<u32>>()? {
                if selected.insert(key, counts).is_some() {
                    return Err(serde::de::Error::custom(
                        "Duplicate mounted ammunition selection",
                    ));
                }
            }
            Ok(selected)
        }
    }
    deserializer.deserialize_map(SelectedMix).map(Some)
}
pub const AMMO_UPDATE_NEEDED: &str = "彈藥協定版本不相容，請更新遊戲與伺服器";
pub fn compatible(capability: &Value) -> bool {
    capability.as_u64() == Some(tg_gameplay::AMMO_PROTOCOL_VERSION as u64)
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct AmmoFrame {
    pub ammo_protocol_version: u32,
    #[serde(flatten)]
    pub scope: AmmoScope,
    pub revision: u64,
    pub processed_through: u32,
    pub counts: AmmoMix,
    pub targets: AmmoMix,
    pub resupply_progress: f64,
    pub refilled: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct AmmoScope {
    pub battle: u64,
    pub life: u64,
}
impl AmmoScope {
    pub fn new(battle: u64, life: u64) -> Result<Self, String> {
        if battle == 0 || life == 0 || battle > MAX_SAFE_COUNTER || life > MAX_SAFE_COUNTER {
            return Err("Ammunition scope exhausted or invalid".into());
        }
        Ok(Self { battle, life })
    }
}

#[derive(Clone, Debug)]
pub struct AmmoGunSpec {
    pub ammo: Vec<String>,
    pub defaults: Vec<u32>,
    pub capacity: Option<u32>,
    pub missile: Option<String>,
    pub aps: bool,
}
#[derive(Clone, Debug, Default)]
pub struct AmmoCatalog {
    pub guns: BTreeMap<String, AmmoGunSpec>,
}
fn sum(values: &[u32]) -> Result<u32, String> {
    values.iter().try_fold(0u32, |n, x| {
        n.checked_add(*x)
            .ok_or_else(|| "Ammunition capacity overflow".into())
    })
}
impl AmmoCatalog {
    pub fn from_target(
        target: &Target,
        aps: Option<&crate::missiles::ApsSpec>,
    ) -> Result<Self, String> {
        let w = &target.def.weapons;
        let mut mounts: Vec<(String, &Value)> = Vec::new();
        if w["main_gun"].is_object() {
            mounts.push(("gun:0:0".into(), &w["main_gun"]));
        }
        for (gi, g) in w["extra_guns"].as_array().into_iter().flatten().enumerate() {
            mounts.push((format!("gun:0:{}", gi + 1), &g["gun"]));
        }
        for (ti, t) in w["extra_turrets"]
            .as_array()
            .into_iter()
            .flatten()
            .enumerate()
        {
            for (gi, g) in t["guns"].as_array().into_iter().flatten().enumerate() {
                mounts.push((format!("gun:{}:{gi}", ti + 1), &g["gun"]));
            }
        }
        let mut guns = BTreeMap::new();
        for (key, gun) in mounts {
            let types = gun["ammo"].as_array().ok_or("Missing ammunition types")?;
            let ammo: Vec<String> = types
                .iter()
                .map(|id| {
                    id.as_str()
                        .filter(|s| !s.is_empty())
                        .map(String::from)
                        .ok_or("Invalid ammunition type".to_string())
                })
                .collect::<Result<_, _>>()?;
            if ammo.is_empty()
                || ammo
                    .iter()
                    .enumerate()
                    .any(|(i, id)| ammo[..i].contains(id))
            {
                return Err("Missing or duplicate ammunition types".into());
            }
            let binding = target
                .weapon_bindings
                .get(&key)
                .ok_or("Missing mounted weapon binding")?;
            if binding.ammo != ammo {
                return Err("Ammunition does not match mounted binding".into());
            }
            let declared = gun.get("ammo_count").filter(|v| !v.is_null());
            if declared.is_some_and(|v| !v.is_array() || v.as_array().unwrap().len() > ammo.len()) {
                return Err("Invalid source ammunition counts".into());
            }
            let defaults = (0..ammo.len())
                .map(|i| match declared.and_then(|v| v.get(i)) {
                    None | Some(Value::Null) => Ok(40),
                    Some(v) => v
                        .as_u64()
                        .and_then(|n| u32::try_from(n).ok())
                        .ok_or("Invalid source ammunition count".to_string()),
                })
                .collect::<Result<Vec<_>, _>>()?;
            let finite = declared.is_some() || target.def.ammo_capacity > 0;
            let capacity = if finite { Some(sum(&defaults)?) } else { None };
            let owns_aps = aps
                .and_then(|a| a.gun_module.as_deref())
                .is_some_and(|module| {
                    binding.critical.iter().any(|&i| {
                        target.def.modules[i].id == module
                            && target.def.modules[i].kind == tg_combat::ModuleKind::ApsGun
                    })
                });
            if owns_aps && capacity.is_none() {
                return Err("Unknown active protection ammunition capacity".into());
            }
            if owns_aps && capacity.unwrap() > aps.unwrap().def.rounds {
                return Err("Active protection stock exceeds source magazine".into());
            }
            if owns_aps
                && gun["autocannon"]["belt_reload_s"]
                    .as_f64()
                    .is_none_or(|n| !n.is_finite() || n <= 0.0)
            {
                return Err("Invalid source active protection belt cycle".into());
            }
            guns.insert(
                key,
                AmmoGunSpec {
                    ammo,
                    defaults,
                    capacity,
                    missile: binding.missile.clone(),
                    aps: owns_aps,
                },
            );
        }
        if aps.is_some() && guns.values().filter(|g| g.aps).count() != 1 {
            return Err("Missing or ambiguous active protection ammunition binding".into());
        }
        // Aggregate projections and combat rack loading must also fit their u32 owner.
        guns.values()
            .filter_map(|g| g.capacity)
            .try_fold(0u32, |n, x| {
                n.checked_add(x).ok_or("Ammunition total overflow")
            })?;
        Ok(Self { guns })
    }

    /// Only an omitted whole plan receives trusted defaults. Unknown legacy pools stay absent.
    pub fn validate_mix(&self, selected: Option<&AmmoMix>) -> Result<AmmoMix, String> {
        let defaults: AmmoMix = self
            .guns
            .iter()
            .filter(|(_, g)| g.capacity.is_some())
            .map(|(k, g)| (k.clone(), g.defaults.clone()))
            .collect();
        let Some(selected) = selected else {
            return Ok(defaults);
        };
        if selected.len() != defaults.len() || selected.keys().any(|k| !defaults.contains_key(k)) {
            return Err("Incomplete ammunition selection".into());
        }
        for (key, values) in selected {
            let gun = &self.guns[key];
            if values.len() != gun.ammo.len() || sum(values)? > gun.capacity.unwrap() {
                return Err(format!("Invalid ammunition selection for {key}"));
            }
        }
        Ok(selected.clone())
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct AmmoLedger {
    pub scope: AmmoScope,
    pub revision: u64,
    pub processed_through: u32,
    pub targets: AmmoMix,
    pub counts: AmmoMix,
}
impl AmmoLedger {
    pub fn frame(&self, progress: f64, refilled: bool) -> AmmoFrame {
        AmmoFrame {
            ammo_protocol_version: tg_gameplay::AMMO_PROTOCOL_VERSION,
            scope: self.scope,
            revision: self.revision,
            processed_through: self.processed_through,
            counts: self.counts.clone(),
            targets: self.targets.clone(),
            resupply_progress: progress,
            refilled,
        }
    }
    pub fn new(
        scope: AmmoScope,
        catalog: &AmmoCatalog,
        mix: Option<&AmmoMix>,
    ) -> Result<Self, String> {
        AmmoScope::new(scope.battle, scope.life)?;
        let targets = catalog.validate_mix(mix)?;
        Ok(Self {
            scope,
            revision: 1,
            processed_through: 0,
            counts: targets.clone(),
            targets,
        })
    }
    pub fn bump(&mut self) -> Result<(), String> {
        if self.revision >= MAX_SAFE_COUNTER {
            return Err("Ammunition revision exhausted".into());
        }
        self.revision += 1;
        Ok(())
    }
    pub fn missing(&self) -> bool {
        self.counts
            .iter()
            .any(|(k, v)| v.iter().zip(&self.targets[k]).any(|(n, max)| n < max))
    }
    pub fn available(&self, catalog: &AmmoCatalog, instance: &str, ammo: &str) -> bool {
        let Some(gun) = catalog.guns.get(instance) else {
            return false;
        };
        let Some(index) = gun.ammo.iter().position(|id| id == ammo) else {
            return false;
        };
        gun.capacity.is_none()
            || self
                .counts
                .get(instance)
                .and_then(|v| v.get(index))
                .is_some_and(|n| *n > 0)
    }
    pub fn spend(
        &mut self,
        catalog: &AmmoCatalog,
        instance: &str,
        ammo: &str,
    ) -> Result<(), String> {
        let gun = catalog
            .guns
            .get(instance)
            .ok_or("Unknown mounted ammunition pool")?;
        let index = gun
            .ammo
            .iter()
            .position(|id| id == ammo)
            .ok_or("Wrong mounted ammunition type")?;
        if gun.capacity.is_none() {
            return Ok(());
        }
        let count = self
            .counts
            .get_mut(instance)
            .and_then(|v| v.get_mut(index))
            .ok_or("Missing mounted ammunition pool")?;
        if *count == 0 {
            return Err("no_ammo".into());
        }
        *count -= 1;
        Ok(())
    }
    pub fn consume_aps(&mut self, catalog: &AmmoCatalog, spent: u32) -> Result<(), String> {
        if spent == 0 {
            return Ok(());
        }
        let key = catalog
            .guns
            .iter()
            .find(|(_, g)| g.aps)
            .map(|(k, _)| k)
            .ok_or("Missing active protection pool")?;
        let counts = self
            .counts
            .get(key)
            .ok_or("Missing active protection stock")?;
        if spent > sum(counts)? {
            return Err("Active protection overconsumption".into());
        }
        self.bump()?;
        let mut remaining = spent;
        for n in self.counts.get_mut(key).unwrap() {
            let take = (*n).min(remaining);
            *n -= take;
            remaining -= take;
        }
        Ok(())
    }
    pub fn refill(&mut self) -> Result<bool, String> {
        if !self.missing() {
            return Ok(false);
        }
        self.bump()?;
        self.counts.clone_from(&self.targets);
        Ok(true)
    }
    /// Every newly terminal request, accepted or rejected, covers all lower sequence numbers.
    pub fn terminal(&mut self, seq: u32) -> Result<(), String> {
        if seq <= self.processed_through {
            return Err("stale_sequence".into());
        }
        self.bump()?;
        self.processed_through = seq;
        Ok(())
    }
    pub fn finite_total(&self) -> Result<u32, String> {
        self.counts.values().try_fold(0u32, |n, v| {
            n.checked_add(sum(v)?)
                .ok_or("Ammunition total overflow".into())
        })
    }
    pub fn non_aps_rounds(&self, catalog: &AmmoCatalog) -> Option<u32> {
        if catalog.guns.is_empty()
            || catalog
                .guns
                .values()
                .any(|g| !g.aps && g.capacity.is_none())
        {
            return None;
        }
        Some(
            self.counts
                .iter()
                .filter(|(k, _)| !catalog.guns[*k].aps)
                .map(|(_, v)| sum(v).unwrap())
                .sum(),
        )
    }
    pub fn missile_counts(&self, catalog: &AmmoCatalog) -> HashMap<String, u32> {
        let mut missiles = HashMap::new();
        for (key, values) in &self.counts {
            if let Some(missile) = &catalog.guns[key].missile {
                *missiles.entry(missile.clone()).or_default() += sum(values).unwrap();
            }
        }
        missiles
    }
    pub fn aps_rounds(&self, catalog: &AmmoCatalog) -> Option<u32> {
        catalog
            .guns
            .iter()
            .find(|(_, g)| g.aps)
            .and_then(|(key, _)| self.counts.get(key))
            .map(|v| sum(v).unwrap())
    }
}
