//! Aircraft online, the server's side: the types (data/aircraft/aircraft.json, taken from the game
//! itself by handoff/tests/export_aircraft.js: each airframe's damage parts and skin boxes, its guns
//! and their rounds, the air-to-air missiles' warheads and reach, the loadouts and what they carry)
//! and the damage model -- the client's AircraftDamage (handoff bundle) on its boxes. The client
//! finds a hit on its drawn triangles; the server takes the round's path in the target's frame and
//! resolves it against the skin and the parts: what a round breaks, a contact-fuzed blast,
//! a part shot away with what it carries, fire, the airframe breaking up. APHE cannot arm from
//! a box size or an armor damage multiplier; calibrated plating contacts are not recorded here.
//! An aircraft is down
//! when its pilot, a wing, its tail or its airframe is gone (the client's airDown).
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use tg_weapon::{ProjectileDef, ProjectileKind};

#[derive(Clone, Debug, Deserialize)]
pub struct AirData {
    pub types: HashMap<String, AirType>,
    pub shells: HashMap<String, AirShell>,
    #[serde(default)]
    pub missiles: HashMap<String, AirMissile>,
}
impl AirData {
    /// Enrich exact known rounds from source projectile definitions. Legacy
    /// filler_kg is already TNT-equivalent and must not become raw filler mass.
    pub fn hydrate_projectiles<'a>(&mut self,
        definitions: impl IntoIterator<Item=(&'a String,&'a ProjectileDef)>) {
        for (id, definition) in definitions {
            if let Some(shell) = self.shells.get_mut(id) {
                shell.kind=Some(definition.kind);
                shell.explosive_mass_kg=Some(definition.explosive_mass_kg as f64);
                shell.explosive_type=Some(definition.explosive_type.clone());
                shell.fuse_delay_s=Some(definition.fuse_delay_s as f64);
                shell.fuse_sensitivity_mm=Some(definition.fuse_sensitivity_mm as f64);
            }
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
pub struct AirType {
    pub name: String,
    /// Optional room-eligibility year copied from the game's fighter metadata, not a historical
    /// weapons/sensors certification. Legacy catalogs and test aircraft may leave it unknown.
    #[serde(default)]
    pub year: Option<u32>,
    #[serde(default)]
    pub mass_kg: f64,
    pub parts: Vec<PartDef>,
    #[serde(default)]
    pub skin: Vec<BoxDef>,
    #[serde(default)]
    pub guns: Vec<GunDef>,
    #[serde(default)]
    pub loadouts: Vec<LoadoutDef>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct PartDef {
    pub id: String,
    #[serde(default)]
    pub name: String,
    pub c: [f64; 3],
    pub h: [f64; 3],
    pub hp: f64,
    #[serde(default)]
    pub armor: Option<f64>,
    #[serde(default)]
    pub fire: Option<f64>,
    #[serde(default)]
    pub detach: bool,
    #[serde(default)]
    pub parent: Option<String>,
    #[serde(default)]
    pub blast_k: Option<f64>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct BoxDef {
    pub c: [f64; 3],
    pub h: [f64; 3],
}

#[derive(Clone, Debug, Deserialize)]
pub struct GunDef {
    pub id: String,
    pub kind: String,
    pub ammo: u32,
    pub rpm: f64,
    pub shells: Vec<String>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct LoadoutDef {
    pub index: u32,
    pub name: String,
    /// guns / aam / ground / agm: what decides its spawn cost
    pub class: String,
    #[serde(default)]
    pub stores: HashMap<String, u32>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct AirShell {
    pub mass_kg: f64,
    pub speed_ms: f64,
    #[serde(default)]
    pub filler_kg: f64,
    #[serde(default)]
    pub caliber_mm: f64,
    #[serde(default)]
    pub incendiary: bool,
    #[serde(default)]
    pub kind: Option<ProjectileKind>,
    /// Actual chemical filler mass; filler_kg above remains TNT-equivalent.
    #[serde(default)]
    pub explosive_mass_kg: Option<f64>,
    #[serde(default)]
    pub explosive_type: Option<String>,
    #[serde(default)]
    pub fuse_delay_s: Option<f64>,
    #[serde(default)]
    pub fuse_sensitivity_mm: Option<f64>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct AirMissile {
    pub tnt_kg: f64,
    pub fuse_m: f64,
    pub lock_range_m: f64,
    pub life_s: f64,
    #[serde(default)]
    pub guidance: String,
    pub max_speed_ms: f64,
}

/// Spawn-point cost of a loadout by what it carries (War Thunder-like: guns only cheapest, air-to-ground
/// missiles dearest). Balance settings.
pub fn spawn_cost(class: &str) -> f64 {
    match class {
        "guns" => 200.0,
        "aam" => 350.0,
        "ground" => 450.0,
        _ => 600.0,
    }
}

/// A small deterministic generator (xorshift64*), seeded from the shot.
pub struct Rng(u64);
impl Rng {
    pub fn new(seed: u64) -> Self {
        Rng(seed.max(1).wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1)
    }
    pub fn next(&mut self) -> f64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        ((x.wrapping_mul(0x2545_F491_4F6C_DD1D) >> 11) as f64) / ((1u64 << 53) as f64)
    }
}

#[derive(Clone, Debug)]
pub struct Part {
    pub def: PartDef,
    pub hp: f64,
    pub detached: bool,
}

/// One aircraft's damage (the client's AircraftDamage, the boxes path).
#[derive(Clone, Debug)]
pub struct AirDamage {
    pub parts: Vec<Part>,
    by: HashMap<String, usize>,
    children: HashMap<String, Vec<usize>>,
    engines: Vec<usize>,
    skin: Vec<BoxDef>,
    pub fire: f64,
    pub fire_at: Option<usize>,
    pub broken: bool,
    pub revision: u64,
}

/// What one round did: where it met the skin (0..1 along a->b), the parts it went through, those it broke.
#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct AirHit {
    pub t: f64,
    pub parts: Vec<String>,
    pub killed: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fuze_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limitation: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bursts: Option<Vec<Value>>,
}

/// Entry parameter (0..1) of the segment a->b into the box, or None.
pub fn slab(a: [f64; 3], b: [f64; 3], c: [f64; 3], h: [f64; 3]) -> Option<f64> {
    let (mut t0, mut t1) = (0.0f64, 1.0f64);
    for k in 0..3 {
        let d = b[k] - a[k];
        let (lo, hi) = (c[k] - h[k], c[k] + h[k]);
        if d.abs() < 1e-9 {
            if a[k] < lo || a[k] > hi {
                return None;
            }
        } else {
            let (mut u0, mut u1) = ((lo - a[k]) / d, (hi - a[k]) / d);
            if u0 > u1 {
                std::mem::swap(&mut u0, &mut u1);
            }
            t0 = t0.max(u0);
            t1 = t1.min(u1);
            if t0 > t1 {
                return None;
            }
        }
    }
    Some(t0)
}

impl AirDamage {
    pub fn new(t: &AirType) -> Self {
        let parts: Vec<Part> = t.parts.iter().map(|p| Part { def: p.clone(), hp: p.hp, detached: false }).collect();
        let by: HashMap<String, usize> = parts.iter().enumerate().map(|(i, p)| (p.def.id.clone(), i)).collect();
        let mut children: HashMap<String, Vec<usize>> = HashMap::new();
        for (i, p) in parts.iter().enumerate() {
            if let Some(par) = &p.def.parent {
                if by.contains_key(par) {
                    children.entry(par.clone()).or_default().push(i);
                }
            }
        }
        let engines = parts.iter().enumerate().filter(|(_, p)| p.def.id == "engine" || p.def.id.starts_with("engine_")).map(|(i, _)| i).collect();
        AirDamage { parts, by, children, engines, skin: t.skin.clone(), fire: 0.0, fire_at: None, broken: false, revision: 0 }
    }

    fn idx(&self, id: &str) -> Option<usize> {
        self.by.get(id).copied()
    }

    pub fn dead(&self, id: &str) -> bool {
        if id == "engine" && self.idx(id).is_none() && !self.engines.is_empty() {
            return self.engines.iter().all(|&e| self.parts[e].hp <= 0.0);
        }
        self.idx(id).is_some_and(|i| self.parts[i].hp <= 0.0)
    }

    pub fn gone(&self, id: &str) -> bool {
        self.idx(id).is_some_and(|i| self.parts[i].detached)
    }

    /// Deterministic structural load damage to an existing part. Wind loading
    /// neither rolls incendiary chance nor creates a new contact/damage body.
    /// The normal failure routine still detaches that part and its children.
    pub fn structural_harm(&mut self, id: &str, amount: f64) -> bool {
        if self.broken || !amount.is_finite() || amount <= 0.0 {
            return false;
        }
        let Some(i) = self.idx(id) else { return false; };
        if self.parts[i].hp <= 0.0 || self.parts[i].detached {
            return false;
        }
        self.parts[i].hp -= amount;
        self.revision += 1;
        if self.parts[i].hp > 0.0 {
            return false;
        }
        self.fail(i);
        true
    }

    /// Down: the pilot, a wing, the tail or the airframe gone (the client's airDown).
    pub fn down(&self) -> bool {
        self.dead("pilot") || self.broken || self.dead("wing_l") || self.dead("wing_r") || self.dead("tail")
    }

    /// Hit points off part i; true when this destroyed it. Starts fires by chance.
    fn harm(&mut self, i: usize, amount: f64, incendiary: bool, rng: &mut Rng) -> bool {
        let p = &mut self.parts[i];
        if !(amount > 0.0) || p.hp <= 0.0 {
            return false;
        }
        p.hp -= amount;
        self.revision += 1;
        if let Some(f) = p.def.fire {
            if self.fire <= 0.0 && rng.next() < f * if incendiary { 1.0 } else { 0.3 } * (amount / 15.0).min(1.0) {
                self.fire = 1e-3;
                self.fire_at = Some(i);
            }
        }
        if self.parts[i].hp > 0.0 {
            return false;
        }
        self.fail(i);
        true
    }

    fn fail(&mut self, i: usize) {
        self.parts[i].hp = 0.0;
        if self.parts[i].def.detach {
            self.detach(i);
        }
        if self.parts[i].def.id == "fuselage" {
            self.break_up();
        }
    }

    /// A piece shot away takes what it carries; a fire in what went goes with it.
    fn detach(&mut self, i: usize) {
        if self.parts[i].detached {
            return;
        }
        self.parts[i].detached = true;
        self.parts[i].hp = 0.0;
        self.revision += 1;
        if self.fire_at == Some(i) {
            self.fire = 0.0;
        }
        let id = self.parts[i].def.id.clone();
        for c in self.children.get(&id).cloned().unwrap_or_default() {
            self.detach(c);
        }
    }

    pub fn break_up(&mut self) {
        if self.broken {
            return;
        }
        self.broken = true;
        for p in self.parts.iter_mut() {
            if p.def.id != "pilot" {
                p.hp = 0.0;
            }
        }
        self.revision += 1;
    }

    /// Blast of `tnt` kg at local point `at` on every part (the structure takes it less: blast_k).
    pub fn blast(&mut self, at: [f64; 3], tnt: f64, rng: &mut Rng, killed: &mut Vec<String>) {
        for i in 0..self.parts.len() {
            if self.parts[i].detached {
                continue;
            }
            let (c, h, k) = (self.parts[i].def.c, self.parts[i].def.h, self.parts[i].def.blast_k.unwrap_or(1.0));
            let d = (0..3).map(|j| ((at[j] - c[j]).abs() - h[j]).max(0.0).powi(2)).sum::<f64>().sqrt();
            if self.harm(i, (160.0 * tnt / (0.06 + d * d * d)).min(450.0) * k, true, rng) {
                killed.push(self.parts[i].def.id.clone());
            }
        }
    }

    /// A round along local a->b: None when it missed. energy_j: kinetic energy relative to the aircraft;
    /// tnt: filler (bursts at the skin).
    pub fn hit(&mut self, a: [f64; 3], b: [f64; 3], energy_j: f64, tnt: f64, incendiary: bool, rng: &mut Rng) -> Option<AirHit> {
        let skin = self.skin.iter().filter_map(|s| slab(a, b, s.c, s.h)).fold(f64::INFINITY, f64::min);
        let mut crossed: Vec<(usize, f64)> = (0..self.parts.len()).filter(|&i| !self.parts[i].detached).filter_map(|i| slab(a, b, self.parts[i].def.c, self.parts[i].def.h).map(|t| (i, t))).collect();
        crossed.sort_by(|x, y| x.1.partial_cmp(&y.1).unwrap());
        if !skin.is_finite() && crossed.is_empty() {
            return None;
        }
        let t = skin.min(crossed.first().map(|c| c.1).unwrap_or(f64::INFINITY));
        let (mut killed, mut parts) = (Vec::new(), Vec::new());
        for (k, (i, _)) in crossed.iter().enumerate() {
            if (tnt > 0.0 && k > 0) || k > 3 {
                break;
            }
            parts.push(self.parts[*i].def.id.clone());
            let amount = 0.17 * energy_j.max(0.0).sqrt() * 0.65f64.powi(k as i32) * self.parts[*i].def.armor.unwrap_or(1.0);
            if self.harm(*i, amount, incendiary, rng) {
                killed.push(self.parts[*i].def.id.clone());
            }
        }
        if tnt > 0.0 {
            let at = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
            self.blast(at, tnt, rng, &mut killed);
        }
        // ammunition cooking off bursts inside
        if killed.iter().any(|k| k == "ammo") {
            if let Some(i) = self.idx("ammo") {
                if rng.next() < 0.35 {
                    let c = self.parts[i].def.c;
                    self.blast(c, 0.25, rng, &mut killed);
                }
            }
        }
        Some(AirHit { t, parts, killed, fuze_status:None,limitation:None,bursts:None })
    }

    /// An admitted typed projectile against the accepted aircraft boxes. These
    /// boxes have no measured plating mm, so they cannot arm delayed APHE.
    pub fn hit_projectile(&mut self,a:[f64;3],b:[f64;3],energy_j:f64,
        projectile:&ProjectileDef,rng:&mut Rng)->Option<AirHit> {
        let shell=AirShell { mass_kg:projectile.mass_kg as f64,
            speed_ms:projectile.muzzle_velocity_ms as f64,
            filler_kg:crate::he_effects::tnt_kg(projectile) as f64,
            caliber_mm:projectile.caliber_mm as f64,
            incendiary:projectile.explosive_mass_kg>0.0,
            kind:Some(projectile.kind),
            explosive_mass_kg:Some(projectile.explosive_mass_kg as f64),
            explosive_type:Some(projectile.explosive_type.clone()),
            fuse_delay_s:Some(projectile.fuse_delay_s as f64),
            fuse_sensitivity_mm:Some(projectile.fuse_sensitivity_mm as f64) };
        self.hit_shell(a,b,energy_j,&shell,rng)
    }

    /// The legacy room's exact admitted shell, with metadata hydrated from the
    /// same projectile catalog when available. Unknown filler never implies a
    /// contact fuse. Incendiary-only solids still keep their incendiary flag.
    pub fn hit_shell(&mut self,a:[f64;3],b:[f64;3],energy_j:f64,
        shell:&AirShell,rng:&mut Rng)->Option<AirHit> {
        let filled=shell.filler_kg>0.0
            || shell.explosive_mass_kg.is_some_and(|mass| mass>0.0);
        let contact=shell.kind.is_some_and(|kind| matches!(kind,
            ProjectileKind::He|ProjectileKind::Heat|ProjectileKind::HeatFs|ProjectileKind::Hesh));
        let limitation=if !filled || contact { None } else {
            Some(match shell.kind {
                Some(ProjectileKind::Ap|ProjectileKind::Aphe|ProjectileKind::Apcbc) => {
                    match shell.explosive_mass_kg {
                        Some(mass) if mass>0.0 => "arming_contact_thickness_unrecorded",
                        Some(_) => "explosive_filler_mass_mismatch",
                        None => "explosive_filler_mass_unrecorded",
                    }
                }
                Some(_) => "unexpected_filler_for_projectile_kind",
                None => "projectile_kind_unrecorded",
            })
        };
        let mut result=self.hit(a,b,energy_j,
            if contact {shell.filler_kg} else {0.0},
            shell.incendiary && limitation.is_none(),rng)?;
        if let Some(limitation)=limitation {
            result.fuze_status=Some("unarmed".into());
            result.limitation=Some(limitation.into());
            result.bursts=Some(Vec::new());
        } else if contact && shell.filler_kg>0.0 {
            // This hit() call actually applied its contact-fuzed HE blast.
            // Zero is the explicit FIRST-CONTACT clock, not an invented shot
            // launch timestamp. Raw mass stays separate from damage strength.
            let point:[f64;3]=std::array::from_fn(|k|a[k]+(b[k]-a[k])*result.t);
            result.fuze_status=Some("contact_detonated".into());
            result.bursts=Some(vec![json!({
                "mechanism":"immediate_he","time_origin":"first_contact","time_s":0.0,
                "armed_at_s":0.0,"delay_s":0.0,"contact_t":result.t,
                "point":point,"position_space":"target_local",
                "explosive_kg":shell.explosive_mass_kg,"tnt_equivalent_kg":shell.filler_kg
            })]);
        }
        Some(result)
    }

    /// Fire and an overheating engine for dt (the client's step).
    pub fn step(&mut self, dt: f64, rng: &mut Rng) {
        if self.fire > 0.0 && !self.broken {
            self.fire += dt;
            let at = self.fire_at;
            let wing = at.and_then(|i| self.parts[i].def.parent.clone()).filter(|p| p.starts_with("wing_"));
            if let (Some(i), Some(w)) = (at, wing) {
                self.harm(i, dt * 2.2, false, rng);
                if let Some(wi) = self.idx(&w) {
                    self.harm(wi, dt * 5.0, false, rng);
                }
            } else {
                let i = at.or_else(|| self.idx("fuel"));
                if let Some(i) = i {
                    self.harm(i, dt * 2.2, false, rng);
                }
                for e in self.engines.clone() {
                    self.harm(e, dt * 1.6, false, rng);
                }
                let gone = at.is_some_and(|i| self.parts[i].hp <= 0.0);
                if ((self.dead("fuel") || gone) && self.fire > 3.0) || self.fire > 30.0 {
                    self.break_up();
                }
            }
        }
        if self.dead("cooling") && !self.broken {
            for e in self.engines.clone() {
                self.harm(e, dt * 1.4, false, rng);
            }
        }
    }

    /// The state the clients apply: each part's hit points and whether it is gone (in the type's order).
    pub fn snapshot(&self) -> Value {
        json!({
            "parts": self.parts.iter().map(|p| json!([(p.hp.max(0.0) * 100.0).round() / 100.0, p.detached as u8])).collect::<Vec<_>>(),
            "fire": self.fire > 0.0,
            "broken": self.broken,
            "down": self.down(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn data() -> AirData {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../data/aircraft/aircraft.json");
        serde_json::from_str(&std::fs::read_to_string(path).expect("data/aircraft/aircraft.json")).expect("aircraft data")
    }

    #[test]
    fn every_type_loads_with_parts_skin_and_guns() {
        let d = data();
        assert!(d.types.len() >= 20);
        for (id, t) in &d.types {
            assert!(t.parts.iter().any(|p| p.id == "pilot"), "{id}: no pilot");
            assert!(!t.skin.is_empty(), "{id}: no skin");
            assert!(!t.guns.is_empty(), "{id}: no guns");
            for g in &t.guns {
                for s in &g.shells {
                    assert!(d.shells.contains_key(s), "{id}: shell {s}");
                }
            }
        }
    }

    #[test]
    fn a_burst_through_the_wing_root_breaks_it_and_the_aircraft_is_down() {
        let d = data();
        let t = &d.types["p51d"];
        let mut dmg = AirDamage::new(t);
        let w = t.parts.iter().find(|p| p.id == "wing_l").unwrap();
        let mut rng = Rng::new(7);
        // 20 mm HE from above, through the left wing, many times
        let (a, b) = ([w.c[0], w.c[1] + 3.0, w.c[2]], [w.c[0], w.c[1] - 3.0, w.c[2]]);
        let mut n = 0;
        while !dmg.down() && n < 200 {
            dmg.hit(a, b, 0.5 * 0.119 * 900.0 * 900.0, 0.01, true, &mut rng);
            n += 1;
        }
        assert!(dmg.dead("wing_l") && dmg.down(), "{n} rounds");
        assert!(n > 1, "one round is not enough: {n}");
    }

    #[test]
    fn a_miss_misses_and_a_rifle_bullet_does_little() {
        let d = data();
        let mut dmg = AirDamage::new(&d.types["f15c"]);
        let mut rng = Rng::new(3);
        assert!(dmg.hit([30.0, 30.0, 0.0], [30.0, -30.0, 0.0], 1e5, 0.0, false, &mut rng).is_none());
        let before: f64 = dmg.parts.iter().map(|p| p.hp).sum();
        let r = dmg.hit([0.0, 5.0, 0.0], [0.0, -5.0, 0.0], 0.5 * 0.0128 * 750.0 * 750.0, 0.0, false, &mut rng).expect("hit");
        let after: f64 = dmg.parts.iter().map(|p| p.hp).sum();
        assert!(!r.parts.is_empty() && after < before && !dmg.down());
    }

    #[test]
    fn a_missile_burst_beside_it_brings_it_down() {
        let d = data();
        let t = &d.types["mig29"];
        let mut dmg = AirDamage::new(t);
        let mut rng = Rng::new(11);
        let mut killed = Vec::new();
        let tnt = d.missiles["aim7f"].tnt_kg;
        dmg.blast([0.0, 0.5, -2.0], tnt, &mut rng, &mut killed);
        assert!(dmg.down(), "{killed:?}");
    }

    #[test]
    fn fire_burns_on_by_itself() {
        let d = data();
        let mut dmg = AirDamage::new(&d.types["p51d"]);
        let mut rng = Rng::new(5);
        dmg.fire = 1e-3;
        dmg.fire_at = dmg.idx("fuel");
        for _ in 0..(40 * 10) {
            dmg.step(0.1, &mut rng);
        }
        assert!(dmg.broken && dmg.down());
    }

    #[test]
    fn aircraft_fuze_legacy_hydration_preserves_tnt_and_actual_filler_separately() {
        let mut legacy=data();
        let before=legacy.shells["ap_50_mk214a"].filler_kg;
        let path=std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data/aircraft/frontline.json");
        let catalog:Value=serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
        let definitions:HashMap<String,ProjectileDef>=serde_json::from_value(catalog["shells"].clone()).unwrap();
        legacy.hydrate_projectiles(&definitions);
        let shell=&legacy.shells["ap_50_mk214a"];
        assert_eq!(shell.filler_kg,before,"TNT-equivalent must not be replaced by raw PETN mass");
        assert_eq!(shell.kind,Some(ProjectileKind::Apcbc));
        assert!((shell.explosive_mass_kg.unwrap()-0.017).abs()<1e-8);
        assert_eq!(shell.explosive_type.as_deref(),Some("petn"));
        assert!((shell.fuse_delay_s.unwrap()-0.0024).abs()<1e-8);
        assert_eq!(shell.fuse_sensitivity_mm,Some(15.0));
    }

    #[test]
    fn aircraft_fuze_legacy_unknown_filler_never_guesses_contact_detonation() {
        let d=data();
        let mut shell=d.shells.values().find(|s| s.filler_kg>0.0).unwrap().clone();
        shell.kind=None;shell.explosive_mass_kg=None;shell.incendiary=true;
        let mut actual=AirDamage::new(&d.types["f15c"]);
        let mut expected=actual.clone();
        let a=[0.0,5.0,0.0];let b=[0.0,-5.0,0.0];
        let expected_hit=expected.hit(a,b,10000.0,0.0,false,&mut Rng::new(31)).unwrap();
        let hit=actual.hit_shell(a,b,10000.0,&shell,&mut Rng::new(31)).unwrap();
        assert_eq!(actual.snapshot(),expected.snapshot());
        assert_eq!(hit.parts,expected_hit.parts);
        assert_eq!(hit.fuze_status.as_deref(),Some("unarmed"));
        assert_eq!(hit.limitation.as_deref(),Some("projectile_kind_unrecorded"));
        assert_eq!(hit.bursts,Some(vec![]));
    }

    #[test]
    fn aircraft_fuze_contact_record_preserves_raw_mass_tnt_and_accepted_contact() {
        let d=data();
        let mut shell=d.shells["hefi_20_sprgr"].clone();
        shell.kind=Some(ProjectileKind::He);shell.explosive_mass_kg=Some(0.017);
        shell.filler_kg=0.02822;shell.incendiary=true;
        let mut actual=AirDamage::new(&d.types["f15c"]);
        let mut expected=actual.clone();
        let a=[0.0,5.0,0.0];let b=[0.0,-5.0,0.0];
        let expected_hit=expected.hit(a,b,10000.0,shell.filler_kg,true,&mut Rng::new(31)).unwrap();
        let hit=actual.hit_shell(a,b,10000.0,&shell,&mut Rng::new(31)).unwrap();
        assert_eq!(actual.snapshot(),expected.snapshot(),"Recording cannot change accepted HE damage");
        assert_eq!(hit.t,expected_hit.t);
        assert_eq!(hit.fuze_status.as_deref(),Some("contact_detonated"));
        let burst=&hit.bursts.as_ref().unwrap()[0];
        assert_eq!(burst["mechanism"],"immediate_he");
        assert_eq!(burst["time_origin"],"first_contact");
        assert_eq!(burst["time_s"],0.0);
        assert_eq!(burst["explosive_kg"],0.017);
        assert_eq!(burst["tnt_equivalent_kg"],0.02822);
        assert_eq!(burst["position_space"],"target_local");
        let expected_point:[f64;3]=std::array::from_fn(|k|a[k]+(b[k]-a[k])*hit.t);
        assert_eq!(burst["point"],json!(expected_point));
    }
}
