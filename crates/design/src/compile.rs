//! A design compiled into the project's ordinary vehicle-folder format (vehicle.json,
//! weapons.json, engine.json, modules.json, crew.json, visual.json). Everything the game,
//! the physics and the damage model read comes from here -- computed, never client-supplied.
use crate::eval::{addon_box, DesignReport};
use crate::layout::{BoxKind, Model};
use crate::model::*;
use crate::v3::{v3, V3};
use serde::Serialize;
use serde_json::{json, Value};
use std::path::PathBuf;
use tg_damage::{Crew, CrewRole, Module, ModuleKind};
use tg_vehicle::*;

#[derive(Clone, Debug, Serialize)]
pub struct CompiledVehicle {
    pub vehicle: VehicleDef,
    pub weapons: WeaponsFile,
    pub engine: EngineFile,
    pub modules: Vec<Module>,
    pub crew: Vec<Crew>,
    pub visual: Value,
    /// Designer extras the game client uses (yaw-dependent depression, turret-space data).
    pub design: Value,
}

impl CompiledVehicle {
    pub fn loaded(&self) -> LoadedVehicle {
        LoadedVehicle {
            dir: PathBuf::new(),
            def: self.vehicle.clone(),
            plates: vec![],
            weapons: self.weapons.clone(),
            engine: self.engine.clone(),
            crew: self.crew.clone(),
            modules: self.modules.clone(),
            visual: Some(self.visual.clone()),
        }
    }

    /// The folder as {file name: JSON}, ready to drop into data/vehicles/<id>/.
    pub fn files(&self) -> Value {
        json!({
            "vehicle.json": self.vehicle,
            "weapons.json": self.weapons,
            "engine.json": self.engine,
            "modules.json": self.modules,
            "crew.json": self.crew,
            "armor.json": [],
            "visual.json": self.visual,
        })
    }
}

fn f3(p: V3) -> [f32; 3] {
    [p.x as f32, p.y as f32, p.z as f32]
}

fn r3(x: f64) -> f64 {
    (x * 1000.0).round() / 1000.0
}

fn mesh_part(m: &MeshDef, xf: impl Fn(V3) -> V3, mount: &str, mat: &str) -> Value {
    json!({
        "type": "mesh",
        "mount": mount,
        "mat": mat,
        "vertices": m.vertices.iter().map(|p| { let q = xf(*p); [r3(q.x), r3(q.y), r3(q.z)] }).collect::<Vec<_>>(),
        "faces": m.faces.iter().map(|f| f.v.clone()).collect::<Vec<_>>(),
    })
}

fn box_part(corners: &[V3], mount: &str, mat: &str) -> Value {
    // corner k: bit0 u, bit1 w, bit2 n (outward)
    let faces = vec![vec![4, 5, 7, 6], vec![0, 2, 3, 1], vec![1, 3, 7, 5], vec![0, 4, 6, 2], vec![2, 6, 7, 3], vec![0, 1, 5, 4]];
    json!({
        "type": "mesh",
        "mount": mount,
        "mat": mat,
        "vertices": corners.iter().map(|q| [r3(q.x), r3(q.y), r3(q.z)]).collect::<Vec<_>>(),
        "faces": faces,
    })
}

fn module_kind(k: ModuleKindDef) -> ModuleKind {
    match k {
        ModuleKindDef::Engine => ModuleKind::Engine,
        ModuleKindDef::Transmission => ModuleKind::Transmission,
        ModuleKindDef::FuelTank => ModuleKind::FuelTank,
        ModuleKindDef::AmmoRack => ModuleKind::AmmoRack,
        ModuleKindDef::Radio => ModuleKind::Radio,
        ModuleKindDef::TurretDrive => ModuleKind::TurretDrive,
    }
}

fn health(k: ModuleKind) -> f32 {
    match k {
        ModuleKind::Engine => 150.0,
        ModuleKind::Transmission => 120.0,
        ModuleKind::FuelTank => 60.0,
        ModuleKind::AmmoRack => 50.0,
        ModuleKind::GunBreech => 100.0,
        ModuleKind::GunBarrel => 110.0,
        ModuleKind::Track => 200.0,
        _ => 70.0,
    }
}

pub fn crew_role(r: CrewRoleDef) -> CrewRole {
    match r {
        CrewRoleDef::Commander => CrewRole::Commander,
        CrewRoleDef::Gunner => CrewRole::Gunner,
        CrewRoleDef::Loader => CrewRole::Loader,
        CrewRoleDef::Driver => CrewRole::Driver,
        CrewRoleDef::RadioOperator => CrewRole::RadioOperator,
    }
}

/// Damage-model modules and crew with the turret at `yaw` (hull space).
pub fn damage_targets(m: &Model, yaw: f64) -> (Vec<Module>, Vec<Crew>) {
    let mut modules = vec![];
    let mut crew = vec![];
    for b in &m.boxes {
        let a = m.box_aabb(b, yaw);
        match b.kind {
            BoxKind::Module(k) => {
                let kind = module_kind(k);
                let h = health(kind);
                modules.push(Module { id: b.id.clone(), kind, center: a.center().to_f32(), half_extents: (a.size() * 0.5).to_f32(), max_health: h, health: h, rounds: None, weapon_group: None });
            }
            BoxKind::Breech => {
                let h = health(ModuleKind::GunBreech);
                modules.push(Module { id: "gun_breech".into(), kind: ModuleKind::GunBreech, center: a.center().to_f32(), half_extents: (a.size() * 0.5).to_f32(), max_health: h, health: h, rounds: None, weapon_group: None });
            }
            BoxKind::Crew(r) => {
                // the vulnerable torso and head sit in the upper part of the crew box
                let c = m.to_hull(b.mount, b.center + v3(0.0, b.size.y * 0.15, 0.0), yaw);
                crew.push(Crew { role: crew_role(r), pos: c.to_f32(), radius: m.db.catalog.crew.hit_radius_m as f32, health: 100.0, also: Vec::new(), pose: None });
            }
        }
    }
    if let Some(g) = &m.gun {
        let mid = m.turret_to_hull(g.trunnion + v3(0.0, 0.0, g.muzzle * 0.5 + 0.1), yaw);
        let half = (g.muzzle * 0.5 - 0.1).max(0.1);
        let r = (g.cal * 0.0009 + 0.03) as f32;
        let (s, c) = yaw.sin_cos();
        let he = v3((half * s).abs() + r as f64, r as f64, (half * c).abs() + r as f64);
        let h = health(ModuleKind::GunBarrel);
        modules.push(Module { id: "gun_barrel".into(), kind: ModuleKind::GunBarrel, center: mid.to_f32(), half_extents: he.to_f32(), max_health: h, health: h, rounds: None, weapon_group: None });
    }
    let env = m.gear.envelope;
    for (id, side) in [("track_r", 1.0), ("track_l", -1.0)] {
        let c = env.center();
        let h = health(ModuleKind::Track);
        modules.push(Module { id: id.into(), kind: ModuleKind::Track, center: v3(c.x * side, c.y, c.z).to_f32(), half_extents: (env.size() * 0.5).to_f32(), max_health: h, health: h, rounds: None, weapon_group: None });
    }
    (modules, crew)
}

pub fn compile(m: &Model, r: &DesignReport, engine: Option<&EngineFile>) -> Option<CompiledVehicle> {
    let d = m.d;
    let cat = &m.db.catalog;
    let engine = engine?.clone();
    let tc = m.trans_cat?;
    let sc = m.susp_cat?;
    let steer = cat.steering.get(&d.transmission.steering)?;
    let total = r.mass.total_kg.max(1.0);
    let gear = &m.gear;
    let gauge = 2.0 * gear.track_x;
    let over = (r.suspension.max_ratio - 1.0).max(0.0);
    let mean_over = (r.suspension.mean_ratio - 1.0).max(0.0);

    // steering: power-limited pivot rate against the turning resistance of the tracks; an
    // overloaded or nose/tail-heavy vehicle turns worse
    let imbalance = 1.0 + 1.5 * (r.suspension.com_offset_m.abs() / gear.contact_length.max(0.5));
    let mu_t = cat.mobility.turn_mu * imbalance * (1.0 + 0.5 * over);
    let lb = gear.contact_length / gauge.max(0.5);
    let m_turn = mu_t * total * 9.81 * gear.contact_length / 4.0;
    let p_w = d.engine.power_hp * 745.7 * tc.efficiency;
    let mut turn = (p_w * steer.steer_efficiency * 0.35 / m_turn.max(1.0)).to_degrees();
    // a long, narrow vehicle needs more track force to skid round than it can get from the ground
    let need = 2.0 * m_turn / gauge.max(0.5);
    let grip = 0.9 * total * 9.81;
    if need > grip {
        turn *= grip / need;
    }
    turn = turn.clamp(6.0, 55.0);

    let brake = (tc.brake_force_kn * 1000.0 / total).min(0.75 * 9.81);
    let n_st = (gear.stations.len() * 2).max(1) as f64;
    let m_st = total / n_st;
    let k = m_st * (2.0 * std::f64::consts::PI * sc.freq_hz).powi(2);
    let c = 2.0 * sc.damping * (k * m_st).sqrt();
    let rolling = sc.rolling_resistance * (1.0 + 0.6 * mean_over);

    let hb = m.hull.bounds;
    let tb = m.turret_local.as_ref().map(|t| t.bounds);
    let ring = m.ring.as_ref();
    let width = (2.0 * gear.track_x + gear.track_w).max(hb.size().x);
    let vehicle = VehicleDef {
        id: d.id.clone(),
        name: d.name.clone(),
        schema_version: 1,
        model: String::new(),
        meta: Some(VehicleMeta { nation: "design".into(), class: "design".into(), year: 0, outline: "design".into(), based_on: "TankForge design bureau".into(), notes: format!("design hash {}", r.design_hash) }),
        files: VehicleFiles { armor: "armor.json".into(), weapons: "weapons.json".into(), engine: "engine.json".into(), crew: "crew.json".into(), modules: "modules.json".into(), visual: Some("visual.json".into()) },
        hull: HullDef { size_m: [width as f32, hb.size().y as f32, hb.size().z as f32], mass_kg: total as f32, center_of_mass: f3(r.center_of_mass) },
        turret: TurretDef {
            size_m: tb.map(|b| [b.size().x as f32, b.max.y as f32, b.size().z as f32]).unwrap_or([0.0, 0.0, 0.0]),
            ring_diameter_m: ring.map(|r| r.d as f32).unwrap_or(0.0),
            position_m: f3(ring.map(|r| r.pos).unwrap_or(v3(0.0, hb.max.y, 0.0))),
            open_top: false,
        },
        physics: PhysicsDef {
            track_width_m: gear.track_w as f32,
            track_length_m: gear.contact_length as f32,
            suspension: SuspensionDef { travel_m: r.suspension.travel_m as f32, stiffness: k as f32, damping: c as f32, kind: Some(d.suspension.kind.clone()) },
            rolling_resistance: rolling as f32,
            sprocket_radius_m: cat.tracks.sprocket_radius_m as f32,
            drivetrain_efficiency: tc.efficiency as f32,
            max_brake_decel_ms2: brake as f32,
            max_turn_rate_deg_s: turn as f32,
            max_reverse_speed_ms: tc.reverse_speed_ms as f32,
            min_turn_radius_m: (steer.min_radius_gauge * gauge) as f32,
            suspension_freq_hz: Some(sc.freq_hz as f32),
            suspension_damping: Some(sc.damping as f32),
            inertia_kgm2: Some(r.mass.inertia_kg_m2.map(|x| x as f32)),
            drive: None,
            max_steer_deg: None,
        },
    };
    let _ = lb;

    // ---- weapons
    let gun = m.gun.as_ref()?;
    let gr = r.gun.as_ref()?;
    let cl = &gr.clearance;
    let traverse = r.turret.as_ref().map(|t| t.traverse_deg_s).unwrap_or(10.0);
    let mut def = gun.def.clone();
    def.max_elevation_deg = cl.max_elevation_deg as f32;
    def.max_depression_deg = cl.frontal_depression_deg as f32;
    def.traverse_deg_s = traverse as f32;
    def.reload_s = gr.reload_s as f32;
    def.rounds_per_min = (60.0 / gr.reload_s.max(0.5)) as f32;
    let trunnion = m.turret_to_hull(gun.trunnion, 0.0);
    let racks: Vec<V3> = m.boxes.iter().filter(|b| b.kind == BoxKind::Module(ModuleKindDef::AmmoRack)).map(|b| m.to_hull(b.mount, b.center, 0.0)).collect();
    let breech = trunnion - v3(0.0, 0.0, 0.4);
    let rack = racks.iter().min_by(|a, b| (**a - breech).len().total_cmp(&(**b - breech).len())).copied();
    let loaders: Vec<[f32; 3]> = d.crew_positions.iter().filter(|c| c.role == CrewRoleDef::Loader).map(|c| f3(m.to_hull(c.mount, c.position_m, 0.0))).collect();
    let weapons = WeaponsFile {
        main_gun: def,
        mount_m: f3(trunnion),
        muzzle_offset_m: Some(gun.muzzle as f32),
        sight: Some(SightDef {
            name: "設計局瞄準鏡".into(),
            levels: vec![SightLevel { magnification: 3.0, fov_deg: 16.0 }, SightLevel { magnification: 6.0, fov_deg: 8.0 }],
            rangefinder: Some(RangefinderDef { time_s: 2.0, error_pct: 4.0, max_range_m: 3000.0 }),
        }),
        stabilizer: d.weapons.as_ref().map(|w| w.stabilizer.clone()).filter(|s| s != "none"),
        secondary: vec![],
        rack_m: rack.map(f3),
        loaders_m: loaders,
        facing_deg: 0.0,
        yaw_limit_deg: None,
        depression_by_bearing_deg: vec![],
        folded_depression_by_bearing_deg: vec![],
        fold_depression_stages: vec![],
        folded_yaw_limit_deg: None,
        fold_yaw_limit_stages: vec![],
        extra_guns: vec![],
        aps: None,
        extra_turrets: vec![],
    };

    let (modules, crew) = damage_targets(m, 0.0);

    // ---- visual: the design meshes themselves, plus gun, mantlet, add-ons and running gear
    let paint = d.visual.paint.clone().unwrap_or_else(|| "#5d6872".into());
    let rp = ring.map(|r| r.pos).unwrap_or(V3::ZERO);
    let mut parts = vec![mesh_part(&d.hull_geometry, |p| p, "hull", "paint")];
    if let Some(t) = &d.turret_geometry {
        parts.push(mesh_part(t, |p| rp + p, "turret", "paint"));
    }
    for a in &d.addons {
        let (_, corners) = addon_box(a);
        let mount = if a.body == Body::Turret { "turret" } else { "hull" };
        let cs: Vec<V3> = corners.iter().map(|c| m.to_hull(a.body, *c, 0.0)).collect();
        let mat = if a.kind == AddonKind::Era { "paint_dark" } else { "paint" };
        parts.push(box_part(&cs, mount, mat));
    }
    let mt = &gun.mount.mantlet;
    let mt_t = mt.thickness_mm * 0.001;
    let mc = trunnion + v3(0.0, 0.0, mt.offset_m + mt_t * 0.5);
    let tr = [trunnion.x, trunnion.y, trunnion.z].map(r3);
    parts.push(json!({"type": "box", "mount": "gun", "mat": "paint", "size": [r3(mt.width_m), r3(mt.height_m), r3(mt_t.max(0.02))], "pos": [r3(mc.x), r3(mc.y), r3(mc.z)]}));
    let rad = gun.cal * 0.0009 + 0.02;
    let m0 = trunnion.z + mt.offset_m + mt_t;
    let m1 = trunnion.z + gun.muzzle;
    let brake_len = if gun.cal >= 70.0 { (gun.cal * 0.004).min(0.5) } else { 0.0 };
    parts.push(json!({"type": "cyl", "mount": "gun", "mat": "paint", "r": r3(rad * 1.9), "r2": r3(rad * 1.4), "len": 0.3, "axis": "z", "pos": [tr[0], tr[1], r3(m0 + 0.12)], "segs": 14}));
    parts.push(json!({"type": "cyl", "mount": "gun", "mat": "paint", "r": r3(rad * 1.15), "r2": r3(rad * 0.9), "len": r3((m1 - brake_len - m0).max(0.2)), "axis": "z", "pos": [tr[0], tr[1], r3((m0 + m1 - brake_len) / 2.0)], "segs": 14, "recoil": true}));
    if brake_len > 0.0 {
        parts.push(json!({"type": "cyl", "mount": "gun", "mat": "paint_dark", "r": r3(rad * 1.5), "len": r3(brake_len), "axis": "z", "pos": [tr[0], tr[1], r3(m1 - brake_len / 2.0)], "segs": 14, "recoil": true}));
    }
    let wheel_w = (gear.track_w * 0.62).max(0.18);
    let wheel_style = match d.suspension.kind.as_str() {
        "christie" | "interleaved" => "steel_dish",
        _ => "rubber_dish",
    };
    let visual = json!({
        "schema_version": 1,
        "palette": {"steel": "#6a6d70", "rubber": "#1c1c1d", "track": "#4a4743", "black": "#151515", "paint": paint, "paint_dark": "#3f474e"},
        "parts": parts,
        "running_gear": {
            "track_width": r3(gear.track_w),
            "track_thickness": r3(gear.track_t),
            "track_x": r3(gear.track_x),
            "link_pitch": 0.15,
            "link_style": if gear.track_w > 0.55 { "twin_guide" } else { "center_guide" },
            "track_sag": if gear.rollers.is_empty() { 0.03 } else { 0.012 },
            "sprocket": {"z": r3(gear.sprocket.z), "y": r3(gear.sprocket.y), "r": r3(gear.sprocket.r)},
            "idler": {"z": r3(gear.idler.z), "y": r3(gear.idler.y), "r": r3(gear.idler.r)},
            "wheels": gear.stations.iter().map(|w| json!({"z": r3(w.z), "y": r3(w.y), "r": r3(w.r), "w": r3(wheel_w), "x": 0.0})).collect::<Vec<_>>(),
            "rollers": gear.rollers.iter().map(|w| json!({"z": r3(w.z), "y": r3(w.y), "r": r3(w.r), "w": 0.16})).collect::<Vec<_>>(),
            "wheel_style": wheel_style,
        }
    });
    let design = json!({
        "hash": r.design_hash,
        "depression_by_yaw": cl.depression_by_yaw,
        "max_depression_deg": cl.max_depression_deg,
        "barrel_blocked_yaws": cl.barrel_blocked_yaws,
        "turret_blocked_yaws": r.turret.as_ref().map(|t| t.sweep.blocked_yaws.clone()).unwrap_or_default(),
        "shells": gr.shells.iter().map(|s| &s.def).collect::<Vec<_>>(),
        "ammunition": d.ammunition,
        // which damage-model parts ride with the turret (the interior view hangs them on it)
        "turret_modules": m.boxes.iter().filter(|b| b.mount == Body::Turret && !matches!(b.kind, BoxKind::Crew(_))).map(|b| if b.kind == BoxKind::Breech { "gun_breech".to_string() } else { b.id.clone() }).collect::<Vec<_>>(),
        "turret_crew": m.boxes.iter().filter(|b| matches!(b.kind, BoxKind::Crew(_))).map(|b| b.mount == Body::Turret).collect::<Vec<_>>(),
    });
    Some(CompiledVehicle { vehicle, weapons, engine, modules, crew, visual, design })
}
