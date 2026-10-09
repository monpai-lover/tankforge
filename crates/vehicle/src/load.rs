//! Loading of vehicle folders, materials and projectiles from disk.
//! Paths named inside user data are confined to the vehicle folder.
use crate::files::*;
use serde::de::DeserializeOwned;
use std::fmt;
use std::path::{Component, Path, PathBuf};
use tg_armor::{ArmorPlate, Material};
use tg_damage::{Crew, Module};
use tg_weapon::mg::MachineGunDef;
use tg_weapon::ProjectileDef;

#[derive(Debug)]
pub enum LoadError {
    Io { path: PathBuf, err: std::io::Error },
    Parse { path: PathBuf, err: serde_json::Error },
    BadPath { path: String },
}

impl fmt::Display for LoadError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            LoadError::Io { path, err } => write!(f, "{}: {}", path.display(), err),
            LoadError::Parse { path, err } => write!(f, "{}: {}", path.display(), err),
            LoadError::BadPath { path } => write!(f, "file reference '{}' must be a relative path inside the vehicle folder", path),
        }
    }
}
impl std::error::Error for LoadError {}

pub fn read_json<T: DeserializeOwned>(path: &Path) -> Result<T, LoadError> {
    let text = std::fs::read_to_string(path).map_err(|err| LoadError::Io { path: path.into(), err })?;
    serde_json::from_str(&text).map_err(|err| LoadError::Parse { path: path.into(), err })
}

fn confined(dir: &Path, name: &str) -> Result<PathBuf, LoadError> {
    let rel = Path::new(name);
    let ok = !name.is_empty() && rel.components().all(|c| matches!(c, Component::Normal(_)));
    if ok {
        Ok(dir.join(rel))
    } else {
        Err(LoadError::BadPath { path: name.to_string() })
    }
}

#[derive(Clone, Debug)]
pub struct LoadedVehicle {
    pub dir: PathBuf,
    pub def: VehicleDef,
    pub plates: Vec<ArmorPlate>,
    pub weapons: WeaponsFile,
    pub engine: EngineFile,
    pub crew: Vec<Crew>,
    pub modules: Vec<Module>,
    /// Raw visual description if the vehicle references one and it exists. Not interpreted server-side.
    pub visual: Option<serde_json::Value>,
}

pub fn load_vehicle(dir: &Path) -> Result<LoadedVehicle, LoadError> {
    let def: VehicleDef = read_json(&dir.join("vehicle.json"))?;
    let plates = read_json(&confined(dir, &def.files.armor)?)?;
    let weapons = read_json(&confined(dir, &def.files.weapons)?)?;
    let engine = read_json(&confined(dir, &def.files.engine)?)?;
    let crew = read_json(&confined(dir, &def.files.crew)?)?;
    let modules = read_json(&confined(dir, &def.files.modules)?)?;
    // model path is only checked for confinement here; existence is a validator warning.
    confined(dir, &def.model)?;
    let visual = match &def.files.visual {
        Some(name) => {
            let p = confined(dir, name)?;
            if p.is_file() { Some(read_json(&p)?) } else { None }
        }
        None => None,
    };
    Ok(LoadedVehicle { dir: dir.into(), def, plates, weapons, engine, crew, modules, visual })
}

pub fn load_materials(path: &Path) -> Result<Vec<Material>, LoadError> {
    read_json(path)
}

/// Every `*.json` file in `dir` is one ProjectileDef. Sorted for stable output.
pub fn load_projectiles(dir: &Path) -> Result<Vec<(PathBuf, ProjectileDef)>, LoadError> {
    let mut paths: Vec<PathBuf> = std::fs::read_dir(dir)
        .map_err(|err| LoadError::Io { path: dir.into(), err })?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().map_or(false, |x| x == "json"))
        .collect();
    paths.sort();
    paths.into_iter().map(|p| read_json(&p).map(|d| (p, d))).collect()
}

/// `machine_guns.json`: the catalogue the vehicles' secondary weapons refer to.
pub fn load_machine_guns(path: &Path) -> Result<Vec<MachineGunDef>, LoadError> {
    read_json(path)
}

/// Sub-folders of `root` that contain a vehicle.json.
pub fn vehicle_dirs(root: &Path) -> Result<Vec<PathBuf>, LoadError> {
    let mut v: Vec<PathBuf> = std::fs::read_dir(root)
        .map_err(|err| LoadError::Io { path: root.into(), err })?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.join("vehicle.json").is_file())
        .collect();
    v.sort();
    Ok(v)
}
