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

/// Defender wall pose in the existing state payload; reject nonfinite values before casting.
pub fn fold_of(s: &Value) -> f32 {
    let value = s["fold"].as_f64().unwrap_or(0.0);
    if value.is_finite() { value.clamp(0.0, 1.0) as f32 } else { 0.0 }
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
        Some(i) => t.def.modules[i].max_health > 0.0 && st.modules.get(i).copied().unwrap_or(t.def.modules[i].max_health) > 0.0,
        None => false,
    }
}

/// A player's vehicle as the missile world sees it: middle, box, and its protection system.
pub fn actor_of(id: u32, team: u8, alive: bool, s: &Value, t: Option<&Target>, aps: Option<&ApsSpec>, st: Option<&TargetState>) -> Option<Actor> {
    let p = pose_of(s)?;
    let v = arr3(&s["v"]).unwrap_or([0.0; 3]);
    let fold = fold_of(s);
    let yaw = yaws_of(s).first().copied().unwrap_or(0.0);
    let (center, obb) = match t {
        Some(t) => {
            let (lo,hi) = t.contact_bounds(yaw as f32, fold);
            let lo = [lo.x as f64, lo.y as f64, lo.z as f64];
            let hi = [hi.x as f64, hi.y as f64, hi.z as f64];
            let mid = [(lo[0] + hi[0]) / 2.0, (lo[1] + hi[1]) / 2.0, (lo[2] + hi[2]) / 2.0];
            let half = [(hi[0] - lo[0]) / 2.0, (hi[1] - lo[1]) / 2.0, (hi[2] - lo[2]) / 2.0];
            let c = p.point(mid);
            (c, Some(Obb { center: c, axes: [p.ex, p.ey, p.ez], half }))
        }
        None => (p.point([0.0, 1.2, 0.0]), None),
    };
    let mut a = Actor { id, team, alive, center, vel: v, obb, aps_pivot: None, aps_base_yaw: 0.0, aps_gun_ok: true, aps_radar_ok: true, aps_traverse_mult: 1.0, aps_elevate_mult: 1.0, aps_dispersion_mult: 1.0 };
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
        let fresh;
        let st = if let Some(st) = st { st } else { fresh = t.fresh_state(); &fresh };
        let caps = tg_combat::caps(t, st);
        let binding = t.weapon_bindings.values().find(|b| b.kind == tg_combat::weapon_damage::WeaponKind::Cannon
            && b.turret_index == Some(spec.turret) && b.critical.iter().any(|&i| Some(&t.def.modules[i].id) == spec.gun_module.as_ref()));
        a.aps_gun_ok = false;
        if let Some(c) = binding.and_then(|b| caps.weapons.get(&b.key)) {
            a.aps_gun_ok = c.can_fire;
            a.aps_traverse_mult = c.traverse_mult as f64;
            a.aps_elevate_mult = c.elevate_mult as f64;
            a.aps_dispersion_mult = c.dispersion_mult as f64;
        }
        a.aps_radar_ok = module_ok(t, Some(st), &spec.radar_module);
    }
    Some(a)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn fold_state_defaults_and_clamps_before_the_float_cast() {
        for value in [json!({}), json!({ "fold": null }), json!({ "fold": "1" }), json!({ "fold": -0.5 })] {
            assert_eq!(fold_of(&value), 0.0);
        }
        assert_eq!(fold_of(&json!({ "fold": 0.4 })), 0.4);
        assert_eq!(fold_of(&json!({ "fold": 2.0 })), 1.0);
        assert_eq!(fold_of(&json!({ "fold": 1e300 })), 1.0);
    }

    #[test]
    fn missile_box_follows_a_hull_wall_without_mutating_the_cached_target() {
        let def = serde_json::from_value(json!({
            "id": "fold-test", "modules": [], "crew": [],
            "plates": [{ "id": "side", "zone": "hull_side", "material": "rha", "thickness_mm": 20,
                "center": { "x": 1.5, "y": 2.2, "z": 0 }, "normal": { "x": 1, "y": 0, "z": 0 },
                "axis_u": { "x": 0, "y": 0, "z": 1 }, "half_u": 3, "half_v": 0.4,
                "hinge": { "a": [1.5, 1.8, -3], "b": [1.5, 1.8, 3], "angle": -90 } }]
        })).unwrap();
        let t = Target::new(def, &[]);
        let original_center = t.def.plates[0].center;
        let original_hi = t.hi;
        let mut state = json!({ "pos": [10, 0, 20], "ex": [1, 0, 0], "ez": [0, 0, 1], "fold": 0 });
        let raised = actor_of(7, 1, true, &state, Some(&t), None, None).unwrap().obb.unwrap();
        state["fold"] = json!(1);
        let lowered = actor_of(7, 1, true, &state, Some(&t), None, None).unwrap().obb.unwrap();
        assert!(lowered.center[0] + lowered.half[0] > raised.center[0] + raised.half[0] + 0.6,
            "an outward horizontal wall must expand the missile hit box");
        assert!(lowered.center[1] + lowered.half[1] < raised.center[1] + raised.half[1] - 0.6,
            "the old vertical wall must not remain in the missile hit box");
        assert_eq!(lowered.axes, raised.axes);
        assert_eq!(t.def.plates[0].center, original_center);
        assert_eq!(t.hi, original_hi);
        state["fold"] = json!(0);
        let raised_again = actor_of(7, 1, true, &state, Some(&t), None, None).unwrap().obb.unwrap();
        assert_eq!(raised_again.center, raised.center);
        assert_eq!(raised_again.half, raised.half);
    }
    #[test]
    fn contact_box_follows_long_barrel_yaw_without_rotation_sweep_inflation() {
        let def = serde_json::from_value(json!({"id":"long", "plates":[], "crew":[],
            "turret":{"pivot":{"x":0,"y":1,"z":0},"size":{"x":2,"y":1,"z":2}},
            "modules":[{"id":"barrel","kind":"gun_barrel","center":{"x":0,"y":1.5,"z":5},"half_extents":{"x":0.1,"y":0.1,"z":4},"max_health":100,"health":100}]})).unwrap();
        let t = Target::new(def,&[]);
        let broad = (t.lo,t.hi);
        let mut s = json!({"pos":[0,0,0],"ex":[1,0,0],"ez":[0,0,1],"tur":[[0,0]]});
        let straight = actor_of(1,0,true,&s,Some(&t),None,None).unwrap().obb.unwrap();
        assert!(straight.half[0] < 2.0,"future barrel rotation incorrectly inflated contact width");
        s["tur"] = json!([[std::f64::consts::FRAC_PI_2,0]]);
        let sideways = actor_of(1,0,true,&s,Some(&t),None,None).unwrap().obb.unwrap();
        assert!(sideways.half[0] > straight.half[0] + 2.0);
        assert!(sideways.half[2] < straight.half[2] - 2.0);
        assert_eq!((t.lo,t.hi),broad);
    }

    #[test]
    fn aps_actor_uses_its_authoritative_instance_curves_and_crew_constraints() {
        let data=std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data");
        let c=crate::server::load_combat(&data); let md=load(&data);
        let t=&c.targets["su_t10m"]; let sp=&md.aps["su_t10m"];
        let mut st=t.fresh_state();
        let main=t.weapon_bindings["gun:0:0"].critical[0]; st.modules[main]=0.0;
        let s=json!({"pos":[0,0,0],"ex":[1,0,0],"ez":[0,0,1],"tur":[[0,0],[0,0]],"caps":{"can_fire":false,"aps_traverse_mult":0.01}});
        let actor=actor_of(1,0,true,&s,Some(t),Some(sp),Some(&st)).unwrap();
        assert!(actor.aps_gun_ok,"broken main cannot disable Oplot");
        let binding=t.weapon_bindings.values().find(|b| b.critical.iter().any(|&i| Some(&t.def.modules[i].id)==sp.gun_module.as_ref())).unwrap();
        for &i in binding.critical.iter().chain(&binding.traverse).chain(&binding.elevation){ st.modules[i]=t.def.modules[i].max_health*0.25; }
        let expected=tg_combat::caps(t,&st).weapons[&binding.key].clone();
        let actor=actor_of(1,0,true,&s,Some(t),Some(sp),Some(&st)).unwrap();
        assert_eq!(actor.aps_dispersion_mult,expected.dispersion_mult as f64);
        assert_eq!(actor.aps_traverse_mult,expected.traverse_mult as f64);
        assert_eq!(actor.aps_elevate_mult,expected.elevate_mult as f64);
        assert!(actor.aps_dispersion_mult>1.0);
        st.repair_s=1.0;
        assert!(!actor_of(1,0,true,&s,Some(t),Some(sp),Some(&st)).unwrap().aps_gun_ok);
        st.repair_s=0.0;st.modules[binding.critical[0]]=0.0;
        assert!(!actor_of(1,0,true,&s,Some(t),Some(sp),Some(&st)).unwrap().aps_gun_ok);
    }

    #[test]
    fn an_invalid_own_radar_reference_cannot_be_reported_healthy() {
        let data=std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data");
        let c=crate::server::load_combat(&data);let md=load(&data);let t=&c.targets["su_t10m"];
        let mut sp=md.aps["su_t10m"].clone();sp.radar_module=Some("foreign_radar".into());
        let s=json!({"pos":[0,0,0],"ex":[1,0,0],"ez":[0,0,1]});
        assert!(!actor_of(1,0,true,&s,Some(t),Some(&sp),Some(&t.fresh_state())).unwrap().aps_radar_ok);
    }

}
