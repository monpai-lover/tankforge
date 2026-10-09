//! TankForge vehicle designer core (`tg-design`).
//!
//! A player designs a vehicle from an empty chassis: hull and turret as free polygon meshes,
//! armour per face (main plate with uniform / per-corner / mapped thickness, extra layers with
//! air gaps, add-on plates, skirts, ERA), turret ring, gun mount, interior layout, crew,
//! engine, gearbox, suspension and tracks. This crate turns that raw `VehicleDesign` into
//! everything the game needs and checks that it is legal:
//!
//! * [`evaluate`] -- mass and centre of mass from real armour volumes and components,
//!   suspension loads per road wheel, internal volume, gun limits from breech / recoil / barrel
//!   clearance, mobility through `tg-physics`, and [`validate`] issues.
//! * [`trace`] -- shots through the real armour volume, the protection map, and test shots with
//!   spall and a replayable ShotEvent.
//! * [`compile`] -- the design as an ordinary vehicle folder for the game.
//! * [`accept`] -- server intake: rejects client-supplied derived numbers, recomputes everything.
//!
//! The browser editor runs this same code compiled to WebAssembly (`crates/design-wasm`).
pub mod accept;
pub mod armor;
pub mod catalog;
pub mod compile;
pub mod drive;
pub mod eval;
pub mod gun;
pub mod layout;
pub mod mesh;
pub mod model;
pub mod shells;
pub mod trace;
pub mod v3;
pub mod validate;

pub use accept::{accept_submission, Accepted, Rejection};
pub use catalog::Catalog;
pub use eval::{evaluate, evaluate_with, DesignReport};
pub use model::*;

use std::collections::BTreeMap;
use tg_armor::{Material, MaterialDb};
use tg_physics::TerrainDef;
use tg_weapon::ProjectileDef;

/// Shared data the designer needs: materials, terrains, the coefficient catalog and the
/// projectile list (for test shots with stock rounds).
pub struct Db {
    pub materials: MaterialDb,
    pub material_list: Vec<Material>,
    pub catalog: Catalog,
    pub terrains: Vec<TerrainDef>,
    pub projectiles: BTreeMap<String, ProjectileDef>,
}

impl Db {
    pub fn new(materials: Vec<Material>, catalog: Catalog, terrains: Vec<TerrainDef>, projectiles: Vec<ProjectileDef>) -> Db {
        Db { materials: MaterialDb::from_vec(materials.clone()), material_list: materials, catalog, terrains, projectiles: projectiles.into_iter().map(|p| (p.id.clone(), p)).collect() }
    }

    /// The data compiled into the binary (materials, catalog, terrains). The server loads the
    /// same files from disk / the database instead.
    pub fn embedded() -> Db {
        let mats: Vec<Material> = serde_json::from_str(include_str!("../../../data/materials.json")).expect("materials.json");
        let terrains: Vec<TerrainDef> = serde_json::from_str(include_str!("../../../data/terrains.json")).expect("terrains.json");
        Db::new(mats, Catalog::embedded(), terrains, vec![])
    }

    /// Loads from a data directory (materials.json, terrains.json, design_catalog.json, projectiles/).
    pub fn load(root: &std::path::Path) -> Result<Db, String> {
        let read = |p: std::path::PathBuf| std::fs::read_to_string(&p).map_err(|e| format!("{}: {}", p.display(), e));
        let mats: Vec<Material> = serde_json::from_str(&read(root.join("materials.json"))?).map_err(|e| e.to_string())?;
        let terrains: Vec<TerrainDef> = serde_json::from_str(&read(root.join("terrains.json"))?).map_err(|e| e.to_string())?;
        let catalog: Catalog = serde_json::from_str(&read(root.join("design_catalog.json"))?).map_err(|e| e.to_string())?;
        let mut shells = vec![];
        if let Ok(rd) = std::fs::read_dir(root.join("projectiles")) {
            let mut paths: Vec<_> = rd.filter_map(|e| e.ok()).map(|e| e.path()).filter(|p| p.extension().map(|x| x == "json").unwrap_or(false)).collect();
            paths.sort();
            for p in paths {
                shells.push(serde_json::from_str(&read(p)?).map_err(|e| e.to_string())?);
            }
        }
        Ok(Db::new(mats, catalog, terrains, shells))
    }
}

#[cfg(test)]
mod tests;
