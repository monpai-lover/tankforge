//! Missiles, rockets and active protection online. Each battle room has a `tg_missile::World`
//! stepped with the lobby's tick: the server launches what players fire (within what their
//! vehicle carries), steers wire-guided missiles on the lines their gunners send, runs every
//! vehicle's active protection system (radar, tracks, its gun and bullets), finds the missiles
//! that strike a vehicle's box and resolves them through the combat model. Clients only draw.
use serde_json::Value;
use std::collections::HashMap;
use std::path::Path;
use tg_combat::{Target, TargetState};
use tg_missile::{Actor, ApsDef, HeightGrid, MissileDef, Obb};

/// A vehicle's active protection: the system, the turret it lays, the modules that are its gun
/// and radar, and where its gun stands (hull frame, turrets at bearing 0).
#[derive(Clone, Debug)]
pub struct ApsSpec {
    pub def: ApsDef,
    pub turret: usize,
    pub parent: usize,
    pub gun_module: Option<String>,
    pub radar_module: Option<String>,
    /// The turret it rides on: its pivot; its own ring; its gun's trunnion.
    pub parent_pivot: [f64; 3],
    pub pivot: [f64; 3],
    pub trunnion: [f64; 3],
}

#[derive(Clone, Debug, Default)]
pub struct MissileData {
    pub defs: Vec<MissileDef>,
    /// The ground of each battle map (data/maps/<id>/heights.json, tools/map-heights.py).
    pub grids: HashMap<String, HeightGrid>,
    pub aps: HashMap<String, ApsSpec>,
    /// What each vehicle can launch: missile id -> rounds carried.
    pub launchers: HashMap<String, HashMap<String, u32>>,
}

fn arr3(v: &Value) -> Option<[f64; 3]> {
    let a = v.as_array()?;
    Some([a.first()?.as_f64()?, a.get(1)?.as_f64()?, a.get(2)?.as_f64()?])
}

/// Loads data/missiles.json, every map's height grid and every vehicle's launchers and APS.
pub fn load(data: &Path) -> MissileData {
    let read = |p: &Path| std::fs::read_to_string(p).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok());
    let defs: Vec<MissileDef> = read(&data.join("missiles.json")).and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default();
    let mut grids = HashMap::new();
    if let Ok(dir) = std::fs::read_dir(data.join("maps")) {
        for e in dir.flatten() {
            if let Some(g) = read(&e.path().join("heights.json")).and_then(|v| serde_json::from_value::<HeightGrid>(v).ok()) {
                grids.insert(e.file_name().to_string_lossy().into_owned(), g);
            }
        }
    }
    let mut aps = HashMap::new();
    let mut launchers = HashMap::new();
    if let Ok(dir) = std::fs::read_dir(data.join("vehicles")) {
        for e in dir.flatten() {
            let id = e.file_name().to_string_lossy().into_owned();
            let (Some(w), Some(v)) = (read(&e.path().join("weapons.json")), read(&e.path().join("vehicle.json"))) else { continue };
            // every gun that launches missiles, and how many it carries
            let mut guns: Vec<&Value> = vec![&w["main_gun"]];
            for g in w["extra_guns"].as_array().into_iter().flatten() {
                guns.push(&g["gun"]);
            }
            for t in w["extra_turrets"].as_array().into_iter().flatten() {
                for g in t["guns"].as_array().into_iter().flatten() {
                    guns.push(&g["gun"]);
                }
            }
            let mut carried: HashMap<String, u32> = HashMap::new();
            for g in guns {
                if let Some(m) = g["missile"].as_str() {
                    let n: u64 = g["ammo_count"].as_array().map(|a| a.iter().filter_map(|x| x.as_u64()).sum()).unwrap_or(2);
                    *carried.entry(m.to_string()).or_default() += n as u32;
                }
            }
            if !carried.is_empty() {
                launchers.insert(id.clone(), carried);
            }
            // the active protection and where its gun stands
            if w["aps"].is_object() {
                let Ok(def) = serde_json::from_value::<ApsDef>(w["aps"].clone()) else { continue };
                let ti = w["aps"]["turret"].as_u64().unwrap_or(0) as usize;
                let main_pivot = arr3(&v["turret"]["position_m"]).unwrap_or([0.0; 3]);
                let (pivot, trunnion, parent) = if ti == 0 {
                    (main_pivot, arr3(&w["mount_m"]).unwrap_or(main_pivot), 0)
                } else {
                    let t = &w["extra_turrets"][ti - 1];
                    let pv = arr3(&t["position_m"]).unwrap_or(main_pivot);
                    (pv, arr3(&t["guns"][0]["mount_m"]).unwrap_or(pv), t["parent"].as_u64().unwrap_or(0) as usize)
                };
                let parent_pivot = if parent == 0 { main_pivot } else { arr3(&w["extra_turrets"][parent - 1]["position_m"]).unwrap_or(main_pivot) };
                aps.insert(
                    id.clone(),
                    ApsSpec {
                        def,
                        turret: ti,
                        parent,
                        gun_module: w["aps"]["gun_module"].as_str().map(String::from),
                        radar_module: w["aps"]["radar_module"].as_str().map(String::from),
                        parent_pivot,
                        pivot,
                        trunnion,
                    },
                );
            }
        }
    }
    MissileData { defs, grids, aps, launchers }
}

/// A vehicle's pose from its network state: position and hull axes.
#[derive(Clone, Copy, Debug)]
pub struct Pose {
    pub pos: [f64; 3],
    pub ex: [f64; 3],
    pub ey: [f64; 3],
    pub ez: [f64; 3],
}

fn unit(v: [f64; 3]) -> Option<[f64; 3]> {
    let l = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
    if !(l > 1e-6) || !l.is_finite() {
        return None;
    }
    Some([v[0] / l, v[1] / l, v[2] / l])
}

pub fn pose_of(s: &Value) -> Option<Pose> {
    let pos = arr3(&s["pos"])?;
    let ex = unit(arr3(&s["ex"]).unwrap_or([1.0, 0.0, 0.0]))?;
    let ez = unit(arr3(&s["ez"]).unwrap_or([0.0, 0.0, 1.0]))?;
    let ey = unit([ez[1] * ex[2] - ez[2] * ex[1], ez[2] * ex[0] - ez[0] * ex[2], ez[0] * ex[1] - ez[1] * ex[0]])?;
    Some(Pose { pos, ex, ey, ez })
}

impl Pose {
    pub fn point(&self, q: [f64; 3]) -> [f64; 3] {
        [0, 1, 2].map(|k| self.pos[k] + self.ex[k] * q[0] + self.ey[k] * q[1] + self.ez[k] * q[2])
    }
    pub fn local_point(&self, w: [f64; 3]) -> [f64; 3] {
        let d = [w[0] - self.pos[0], w[1] - self.pos[1], w[2] - self.pos[2]];
        self.local_dir(d)
    }
    pub fn local_dir(&self, d: [f64; 3]) -> [f64; 3] {
        let dot = |a: [f64; 3]| a[0] * d[0] + a[1] * d[1] + a[2] * d[2];
        [dot(self.ex), dot(self.ey), dot(self.ez)]
    }
    pub fn heading(&self) -> f64 {
        self.ez[0].atan2(self.ez[2])
    }
}

/// Turret yaws (hull frame) from the state's `tur`.
pub fn yaws_of(s: &Value) -> Vec<f64> {
    s["tur"].as_array().map(|a| a.iter().map(|t| t[0].as_f64().unwrap_or(0.0)).collect()).unwrap_or_default()
}

/// Turns a hull-frame offset about the vertical by a turret yaw (clockwise from +z).
fn turn(v: [f64; 3], yaw: f64) -> [f64; 3] {
    let (s, c) = yaw.sin_cos();
    [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c]
}

fn module_ok(t: &Target, st: Option<&TargetState>, id: &Option<String>) -> bool {
    let (Some(id), Some(st)) = (id, st) else { return true };
    match t.def.modules.iter().position(|m| &m.id == id) {
        Some(i) => st.modules.get(i).copied().unwrap_or(1.0) > 0.0,
        None => true,
    }
}

/// A player's vehicle as the missile world sees it: middle, box, and its protection system.
pub fn actor_of(id: u32, team: u8, alive: bool, s: &Value, t: Option<&Target>, aps: Option<&ApsSpec>, st: Option<&TargetState>) -> Option<Actor> {
    let p = pose_of(s)?;
    let v = arr3(&s["v"]).unwrap_or([0.0; 3]);
    let (center, obb) = match t {
        Some(t) => {
            // the combat target's bounds carry 0.3 m of padding
            let lo = [t.lo.x as f64 + 0.3, t.lo.y as f64 + 0.3, t.lo.z as f64 + 0.3];
            let hi = [t.hi.x as f64 - 0.3, t.hi.y as f64 - 0.3, t.hi.z as f64 - 0.3];
            let mid = [(lo[0] + hi[0]) / 2.0, (lo[1] + hi[1]) / 2.0, (lo[2] + hi[2]) / 2.0];
            let half = [(hi[0] - lo[0]) / 2.0, (hi[1] - lo[1]) / 2.0, (hi[2] - lo[2]) / 2.0];
            let c = p.point(mid);
            (c, Some(Obb { center: c, axes: [p.ex, p.ey, p.ez], half }))
        }
        None => (p.point([0.0, 1.2, 0.0]), None),
    };
    let mut a = Actor { id, team, alive, center, vel: v, obb, aps_pivot: None, aps_base_yaw: 0.0, aps_gun_ok: true, aps_radar_ok: true };
    if let (Some(spec), Some(t)) = (aps, t) {
        let yaws = yaws_of(s);
        let py = yaws.get(spec.parent).copied().unwrap_or(0.0);
        let piv = if spec.turret == 0 {
            spec.pivot
        } else {
            let r = turn([spec.pivot[0] - spec.parent_pivot[0], spec.pivot[1] - spec.parent_pivot[1], spec.pivot[2] - spec.parent_pivot[2]], py);
            [spec.parent_pivot[0] + r[0], spec.parent_pivot[1] + r[1], spec.parent_pivot[2] + r[2]]
        };
        let off = turn([spec.trunnion[0] - spec.pivot[0], spec.trunnion[1] - spec.pivot[1], spec.trunnion[2] - spec.pivot[2]], py);
        a.aps_pivot = Some(p.point([piv[0] + off[0], piv[1] + off[1], piv[2] + off[2]]));
        a.aps_base_yaw = p.heading() + if spec.turret == 0 { 0.0 } else { py };
        a.aps_gun_ok = module_ok(t, st, &spec.gun_module);
        a.aps_radar_ok = module_ok(t, st, &spec.radar_module);
    }
    Some(a)
}
