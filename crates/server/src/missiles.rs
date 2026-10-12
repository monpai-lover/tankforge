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
use crate::ammo::AmmoScope;
use serde::Deserialize;
use std::sync::LazyLock;

#[derive(Clone,Copy,Deserialize)]
#[serde(deny_unknown_fields)]
struct StabilizerDrive {traverse_deg_s:f64,elevate_deg_s:f64}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct StabilizerDrives {none:StabilizerDrive,vertical:StabilizerDrive,two_plane:StabilizerDrive}

fn stabilizer_drive(name: Option<&str>) -> StabilizerDrive {
    static DRIVES:LazyLock<StabilizerDrives>=LazyLock::new(|| {
        let drives:StabilizerDrives=serde_json::from_str(include_str!("../../../config/stabilizer-drives.json")).expect("invalid shared stabilizer drives");
        assert!([drives.none,drives.vertical,drives.two_plane].iter().all(|d|[d.traverse_deg_s,d.elevate_deg_s].iter().all(|v|v.is_finite()&&*v>=0.0)),"invalid stabilizer motor rate");drives
    });
    match name {Some("vertical")=>DRIVES.vertical,Some("two_plane")=>DRIVES.two_plane,_=>DRIVES.none}
}

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

impl MissileData {
    /// Each room gets a fresh gun profile; geometry, radar, guidance and ballistics remain
    /// source-valued. Actor damage multipliers are applied separately during world stepping.
    pub fn room_aps(&self, vehicle: &str, gameplay: crate::gameplay::RoomGameplay) -> Option<ApsSpec> {
        let mut spec = self.aps.get(vehicle)?.clone();
        spec.def = gameplay.aps(&spec.def);
        Some(spec)
    }
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

fn wrap(a: f64) -> f64 { (a+std::f64::consts::PI).rem_euclid(2.0*std::f64::consts::PI)-std::f64::consts::PI }

fn aps_hull_frame(p: Pose) -> Option<Pose> {
    let ex=unit(p.ex)?;
    let ey=unit([p.ez[1]*ex[2]-p.ez[2]*ex[1],p.ez[2]*ex[0]-p.ez[0]*ex[2],p.ez[0]*ex[1]-p.ez[1]*ex[0]])?;
    let ez=[ex[1]*ey[2]-ex[2]*ey[1],ex[2]*ey[0]-ex[0]*ey[2],ex[0]*ey[1]-ex[1]*ey[0]];
    Some(Pose {pos:p.pos,ex,ey,ez})
}

#[derive(Clone, Debug)]
pub struct AcceptedApsPose {
    pub instance: String,
    pub scope: AmmoScope,
    pub at: f64,
    pub state_t: f64,
    pub motor_yaw: f64,
    pub elevation: f64,
    pub parent_yaw: f64,
    pub hull: Pose,
    pub world_yaw: f64,
    pub world_pitch: f64,
    pub joints: Vec<(usize, f64, f64)>,
}

/// Exact bound source joints, observed on the server clock. State.t only orders
/// observations/correlates ownership; it never increases a motor's travel budget.
pub fn accepted_aps_pose(s: &Value, spec: &ApsSpec, target: &Target, state: &TargetState,
    gameplay: crate::gameplay::RoomGameplay, scope: AmmoScope, now: f64,
    previous: Option<&AcceptedApsPose>, automatic_until: Option<f64>) -> Option<AcceptedApsPose> {
    let submitted: AmmoScope=serde_json::from_value(s["ammo_scope"].clone()).ok()?;
    if submitted!=scope || !now.is_finite() { return None; }
    let binding=target.weapon_bindings.values().find(|b| b.kind==tg_combat::weapon_damage::WeaponKind::Cannon
        && b.turret_index==Some(spec.turret) && b.gun_index==Some(0)
        && b.binding_error.is_none() && b.critical.iter().any(|&i|Some(&target.def.modules[i].id)==spec.gun_module.as_ref()))?;
    if s["aps_instance"].as_str()!=Some(binding.key.as_str()) {return None;}
    let state_t=s["t"].as_f64()?;
    if !state_t.is_finite() || previous.is_some_and(|p|p.scope==scope && state_t<=p.state_t) {return None;}
    let ex=arr3(&s["ex"])?;let ez=arr3(&s["ez"])?;
    let dot=|a:[f64;3],b:[f64;3]|a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
    if !ex.into_iter().chain(ez).all(f64::is_finite) || (dot(ex,ex)-1.0).abs()>0.00025 || (dot(ez,ez)-1.0).abs()>0.00025 || dot(ex,ez).abs()>0.00025 {return None;}
    let hull=aps_hull_frame(pose_of(s)?)?;let tur=s["tur"].as_array()?;let w=&target.def.weapons;
    let caps=tg_combat::caps(target,state);let mut joints=Vec::new();let mut ti=spec.turret;
    loop {
        if joints.iter().any(|(seen,_,_)|*seen==ti) {return None;}
        let layout=if ti==0 {w} else {w["extra_turrets"].get(ti-1)?};
        let gun=if ti==0 {&w["main_gun"]} else {&layout["guns"][0]["gun"]};
        let parent=if ti==0 {None} else {layout["parent"].as_u64().map(|n|n as usize)};
        let raw=tur.get(ti)?;let yaw=raw[0].as_f64()?;let elevation=raw[1].as_f64()?;
        let parent_yaw=match parent {Some(p)=>tur.get(p)?[0].as_f64()?,None=>0.0};
        if ![yaw,elevation,parent_yaw].into_iter().all(f64::is_finite) {return None;}
        let motor=wrap(yaw-parent_yaw);let facing=layout["facing_deg"].as_f64().unwrap_or(0.0).to_radians();
        if let Some(arc)=layout["yaw_limit_deg"].as_array() {
            let rel=wrap(motor-facing);if rel<arc.first()?.as_f64()?.to_radians()-1e-4 || rel>arc.get(1)?.as_f64()?.to_radians()+1e-4 {return None;}
        }
        let mut depression=gun["max_depression_deg"].as_f64()?.to_radians();
        if let Some(table)=layout["depression_by_bearing_deg"].as_array().filter(|v|!v.is_empty()) {
            let x=motor.rem_euclid(2.0*std::f64::consts::PI)/(2.0*std::f64::consts::PI)*table.len() as f64;
            let i=x.floor() as usize;let f=x-i as f64;
            depression=(table[i%table.len()].as_f64()?*(1.0-f)+table[(i+1)%table.len()].as_f64()?*f).to_radians();
        }
        if elevation < -depression-1e-4 || elevation > gun["max_elevation_deg"].as_f64()?.to_radians()+1e-4 {return None;}
        let bound=target.weapon_bindings.values().find(|b|b.kind==tg_combat::weapon_damage::WeaponKind::Cannon&&b.turret_index==Some(ti)&&b.gun_index==Some(0)&&b.binding_error.is_none())?;
        let damage=caps.weapons.get(&bound.key)?;
        if let Some((_,old_yaw,old_pitch))=previous.filter(|p|p.scope==scope&&p.instance==binding.key).and_then(|p|p.joints.iter().find(|(old,_,_)|*old==ti)) {
            let elapsed=(now-previous?.at).max(0.0);
            let gyro=stabilizer_drive(layout["stabilizer"].as_str());
            let traverse=((if ti==0 {gun["traverse_deg_s"].as_f64()?} else {layout["traverse_deg_s"].as_f64()?})*gameplay.rules().traverse).max(gyro.traverse_deg_s);
            let elevate=(gun["elevate_deg_s"].as_f64()?*gameplay.rules().elevate).max(gyro.elevate_deg_s);
            let automatic_elapsed=if ti==spec.turret {automatic_until.map(|until|(until-previous.unwrap().at).clamp(0.0,elapsed)).unwrap_or(0.0)} else {0.0};
            let native=gameplay.aps(&spec.def);
            let yaw_budget=traverse*(elapsed-automatic_elapsed)+native.traverse_deg_s*automatic_elapsed;
            let pitch_budget=elevate*(elapsed-automatic_elapsed)+native.elevate_deg_s*automatic_elapsed;
            // Each wire angle has at most half a 1e-4 rad quantum of error.
            // A parented yaw delta subtracts four rounded angles (two endpoints
            // for child and parent); unparented yaw and pitch subtract only two.
            let yaw_quantization=if parent.is_some() {2e-4} else {1e-4};
            let roundoff=1e-12;
            if wrap(motor-old_yaw).abs()>yaw_budget.to_radians()*damage.traverse_mult as f64+yaw_quantization+roundoff
                || (elevation-old_pitch).abs()>pitch_budget.to_radians()*damage.elevate_mult as f64+1e-4+roundoff {return None;}
        }
        joints.push((ti,motor,elevation));
        match parent {Some(p)=>ti=p,None=>break}
    }
    let motor_yaw=joints[0].1;let elevation=joints[0].2;
    let parent_yaw=if spec.turret==0 {0.0} else {tur.get(spec.parent)?[0].as_f64()?};
    let local=turn([0.0,elevation.sin(),elevation.cos()],motor_yaw+parent_yaw);
    let d=[0,1,2].map(|k|hull.ex[k]*local[0]+hull.ey[k]*local[1]+hull.ez[k]*local[2]);
    Some(AcceptedApsPose {instance:binding.key.clone(),scope,at:now,state_t,motor_yaw,elevation,parent_yaw,hull,
        world_yaw:d[0].atan2(d[2]),world_pitch:d[1].atan2(d[0].hypot(d[2])),joints})
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
    let mut a = Actor { id, team, alive, center, vel: v, obb, aps_pivot: None, aps_base_yaw: 0.0, aps_axes: None, aps_gun_ok: true, aps_radar_ok: true, aps_traverse_mult: 1.0, aps_elevate_mult: 1.0, aps_dispersion_mult: 1.0 };
    if let (Some(spec), Some(t)) = (aps, t) {
        let p=aps_hull_frame(p)?;
        let yaws = yaws_of(s);
        let py = yaws.get(spec.parent).copied().unwrap_or(0.0);
        let piv = if spec.turret == 0 {
            spec.pivot
        } else {
            let r = turn([spec.pivot[0] - spec.parent_pivot[0], spec.pivot[1] - spec.parent_pivot[1], spec.pivot[2] - spec.parent_pivot[2]], py);
            [spec.parent_pivot[0] + r[0], spec.parent_pivot[1] + r[1], spec.parent_pivot[2] + r[2]]
        };
        let off = turn([spec.trunnion[0] - spec.pivot[0], spec.trunnion[1] - spec.pivot[1], spec.trunnion[2] - spec.pivot[2]], yaws.get(spec.turret).copied().unwrap_or(0.0));
        a.aps_pivot = Some(p.point([piv[0] + off[0], piv[1] + off[1], piv[2] + off[2]]));
        a.aps_base_yaw = p.heading() + if spec.turret == 0 { 0.0 } else { py };
        let frame_yaw=if spec.turret==0 {0.0} else {py};
        a.aps_axes=Some([turn([1.0,0.0,0.0],frame_yaw),[0.0,1.0,0.0],turn([0.0,0.0,1.0],frame_yaw)]
            .map(|v|[0,1,2].map(|k|p.ex[k]*v[0]+p.ey[k]*v[1]+p.ez[k]*v[2])));
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
    fn aps_pose_quantization_bounds_are_per_joint_not_free_motor_time() {
        let data=std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data");let c=crate::server::load_combat(&data);let md=load(&data);
        for vehicle in ["su_t10m","su_t10m_oplot23"] {for mode in ["historical","casual"] {
            let target=&c.targets[vehicle];let spec=&md.aps[vehicle];let state=target.fresh_state();let scope=AmmoScope{battle:1,life:1};
            let gameplay=crate::gameplay::RoomGameplay::parse(json!(mode),json!(tg_gameplay::GAMEPLAY_RULES_VERSION)).unwrap();
            let before=json!({"pos":[0,0,0],"ex":[1,0,0],"ez":[0,0,1],"tur":[[0,0],[0,0]],"t":0.0,"ammo_scope":scope,"aps_instance":"gun:1:0"});
            let previous=accepted_aps_pose(&before,spec,target,&state,gameplay,scope,0.0,None,None).unwrap();
            let mut observation=before.clone();observation["t"]=json!(0.001);observation["tur"][1][0]=json!(0.0002);
            assert!(accepted_aps_pose(&observation,spec,target,&state,gameplay,scope,0.0,Some(&previous),None).is_some(),"two parent/child yaw endpoints have a finite 2e-4 quantization bound at zero trusted elapsed");
            observation["tur"][1][0]=json!(0.00020001);
            assert!(accepted_aps_pose(&observation,spec,target,&state,gameplay,scope,0.0,Some(&previous),None).is_none(),"quantization cannot become extra motor time");
            observation["tur"]=json!([[0.00010001,0],[0.00010001,0]]);
            assert!(accepted_aps_pose(&observation,spec,target,&state,gameplay,scope,0.0,Some(&previous),None).is_none(),"unparented yaw retains the single-angle 1e-4 endpoint bound");
            observation["tur"]=json!([[0.0001,0.0001],[0.0001,0.0001]]);
            assert!(accepted_aps_pose(&observation,spec,target,&state,gameplay,scope,0.0,Some(&previous),None).is_some());
            observation["tur"][1][1]=json!(0.00010001);
            assert!(accepted_aps_pose(&observation,spec,target,&state,gameplay,scope,0.0,Some(&previous),None).is_none(),"pitch is one rounded angle, even on the child");
        }}
    }

    #[test]
    fn aps_pose_actual_trunnion_and_rounded_frame_remain_orthonormal_at_zero_motor_rate() {
        let data=std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data");let c=crate::server::load_combat(&data);let md=load(&data);
        let t=&c.targets["su_t10m"];let spec=&md.aps["su_t10m"];
        let (pitch,roll,heading)=(0.12_f64,0.1_f64,0.6_f64);
        let rounded=|v:[f64;3]|v.map(|n|(n*1e4).round()/1e4);
        let ex=rounded(turn([roll.cos(),roll.sin()*pitch.cos(),-roll.sin()*pitch.sin()],heading));
        let ez=rounded(turn([0.0,pitch.sin(),pitch.cos()],heading));
        let s=json!({"pos":[0,0,0],"ex":ex,"ez":ez,"tur":[[0,0],[std::f64::consts::FRAC_PI_2,0.2]]});
        let mut a=actor_of(1,0,true,&s,Some(t),Some(spec),Some(&t.fresh_state())).unwrap();
        let p=aps_hull_frame(pose_of(&s).unwrap()).unwrap();let offset=turn([spec.trunnion[0]-spec.pivot[0],spec.trunnion[1]-spec.pivot[1],spec.trunnion[2]-spec.pivot[2]],std::f64::consts::FRAC_PI_2);
        let expected=p.point([0,1,2].map(|k|spec.pivot[k]+offset[k]));assert_eq!(a.aps_pivot,Some(expected));
        let axes=a.aps_axes.unwrap();let dot=|a:[f64;3],b:[f64;3]|a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
        for i in 0..3 {for j in 0..3 {assert!((dot(axes[i],axes[j])-if i==j {1.0} else {0.0}).abs()<1e-12);}}
        let local=[0.4_f64.sin()*0.2_f64.cos(),0.2_f64.sin(),0.4_f64.cos()*0.2_f64.cos()];
        let d=[0,1,2].map(|k|axes[0][k]*local[0]+axes[1][k]*local[1]+axes[2][k]*local[2]);
        let mut w=tg_missile::World::new(Vec::new());w.add_aps(1,0,spec.def.clone(),3);w.set_aps(1,false,None);assert!(w.adopt_aps_pose(1,d[0].atan2(d[2]),d[1].atan2(d[0].hypot(d[2]))));w.set_aps(1,true,None);
        a.aps_traverse_mult=0.0;a.aps_elevate_mult=0.0;w.step(1.0/120.0,&[a]);
        let out=w.aps_of(1).unwrap();let d=[out.yaw.sin()*out.pitch.cos(),out.pitch.sin(),out.yaw.cos()*out.pitch.cos()];
        let returned=axes.map(|axis|dot(axis,d));for k in 0..3 {assert!((returned[k]-local[k]).abs()<1e-12,"zero-rate motor cannot move under rounded network basis");}
    }

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
