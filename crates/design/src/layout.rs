//! Everything placed in a design, prepared for queries: hull and turret bodies, the turret
//! ring, armour per face, component boxes (sized from their specification where the player
//! does not size them), the gun, and the running gear.
use crate::armor::{face_mass, wall_depth_mm, ArmorTable, FaceArmor, FaceMass};
use crate::catalog::{Catalog, EngineCat, SuspensionCat, TransmissionCat};
use crate::mesh::Geo;
use crate::model::*;
use crate::shells::{design_gun_def, design_shell, kind_allowed, SHELL_KINDS};
use crate::v3::{v3, Aabb, V3};
use crate::Db;
use tg_weapon::{GunDef, ProjectileDef};

#[derive(Clone, Debug)]
pub struct Ring {
    pub pos: V3,
    pub d: f64,
    pub axis: V3,
    pub drive: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BoxKind {
    Module(ModuleKindDef),
    Crew(CrewRoleDef),
    Breech,
}

impl BoxKind {
    pub fn label(&self) -> &'static str {
        match self {
            BoxKind::Module(k) => k.as_str(),
            BoxKind::Crew(r) => r.as_str(),
            BoxKind::Breech => "gun_breech",
        }
    }
}

/// A box in its mount's own space (hull space, or turret space for turret-mounted items).
#[derive(Clone, Debug)]
pub struct PlacedBox {
    pub id: String,
    pub kind: BoxKind,
    pub mount: Body,
    pub center: V3,
    pub size: V3,
    pub mass_kg: f64,
}

impl PlacedBox {
    pub fn local_aabb(&self) -> Aabb {
        Aabb::from_center(self.center, self.size)
    }
    /// 8 corners, 6 face centres and the centre: what has to be inside the armour. A person is
    /// not a box: for crew the corners are pulled in to 70%.
    pub fn sample_points(&self) -> Vec<V3> {
        let b = self.local_aabb();
        let c = b.center();
        let h = b.size() * 0.5;
        let k = if matches!(self.kind, BoxKind::Crew(_)) { 0.7 } else { 1.0 };
        let mut pts: Vec<V3> = b.corners().iter().map(|p| c + (*p - c) * k).collect();
        pts.extend([c + v3(h.x, 0.0, 0.0), c - v3(h.x, 0.0, 0.0), c + v3(0.0, h.y, 0.0), c - v3(0.0, h.y, 0.0), c + v3(0.0, 0.0, h.z), c - v3(0.0, 0.0, h.z), c]);
        pts
    }
}

#[derive(Clone, Debug)]
pub struct GunSpec {
    pub cal: f64,
    pub len: f64,
    pub def: GunDef,
    pub shells: Vec<ProjectileDef>,
    pub trunnion: V3,
    /// Breech extent behind the trunnion, width and height.
    pub rear: f64,
    pub width: f64,
    pub height: f64,
    pub recoil: f64,
    pub recoil_default: f64,
    /// Trunnion to muzzle.
    pub muzzle: f64,
    pub gun_kg: f64,
    pub mount_kg: f64,
    pub mount: GunMountDef,
}

#[derive(Clone, Debug)]
pub struct Wheel {
    pub z: f64,
    pub y: f64,
    pub r: f64,
}

#[derive(Clone, Debug)]
pub struct Gear {
    /// Road-wheel axles, front to rear.
    pub stations: Vec<Wheel>,
    pub sprocket: Wheel,
    pub idler: Wheel,
    pub rollers: Vec<Wheel>,
    pub track_x: f64,
    pub track_w: f64,
    pub track_t: f64,
    pub contact_length: f64,
    pub loop_length: f64,
    /// Right track envelope (the left one is mirrored in x).
    pub envelope: Aabb,
}

pub struct Model<'a> {
    pub d: &'a VehicleDesign,
    pub db: &'a Db,
    pub armor: ArmorTable<'a>,
    pub hull: Geo,
    /// Turret in its own space.
    pub turret_local: Option<Geo>,
    /// Turret in hull space at yaw 0.
    pub turret: Option<Geo>,
    pub ring: Option<Ring>,
    pub hull_face_mass: Vec<FaceMass>,
    pub turret_face_mass: Vec<FaceMass>,
    pub boxes: Vec<PlacedBox>,
    pub gun: Option<GunSpec>,
    pub gear: Gear,
    pub engine_cat: Option<&'a EngineCat>,
    pub trans_cat: Option<&'a TransmissionCat>,
    pub susp_cat: Option<&'a SuspensionCat>,
}

pub fn engine_box(c: &EngineCat, hp: f64) -> (V3, f64) {
    let vol = c.base_m3 + c.m3_per_hp * hp;
    let s = (vol / (1.25 * 0.75)).cbrt();
    (v3(s, 0.75 * s, 1.25 * s), c.base_kg + c.kg_per_hp * hp)
}

pub fn transmission_box(c: &TransmissionCat, hp: f64) -> (V3, f64) {
    let vol = c.base_m3 + c.m3_per_hp * hp;
    let s = (vol / (1.3 * 0.7 * 0.8)).cbrt();
    (v3(1.3 * s, 0.7 * s, 0.8 * s), c.base_kg + c.kg_per_hp * hp)
}

/// Rounds an ammo rack of this size holds for a gun of this calibre.
pub fn rack_capacity(cat: &Catalog, size: V3, cal_mm: f64) -> u32 {
    let d = cal_mm * 0.001 * 1.15;
    let round = d * d * cal_mm * 0.001 * cat.ammo.round_length_cal;
    if round <= 0.0 {
        return 0;
    }
    ((size.x * size.y * size.z).max(0.0) * cat.ammo.packing / round).floor() as u32
}

/// Mass of one complete round (projectile + cartridge case and charge).
pub fn round_mass(cat: &Catalog, shell: &ProjectileDef) -> f64 {
    shell.mass_kg as f64 * (1.0 + cat.ammo.case_mass_fraction)
}

impl<'a> Model<'a> {
    pub fn new(d: &'a VehicleDesign, db: &'a Db) -> Model<'a> {
        let cat = &db.catalog;
        let armor = ArmorTable::new(d);
        let hull = Geo::build(&d.hull_geometry, |p| p);
        let ring = d.turret_ring.as_ref().map(|r| Ring { pos: r.position_m, d: r.diameter_m, axis: r.rotation_axis, drive: r.drive.clone() });
        let turret_local = d.turret_geometry.as_ref().map(|m| Geo::build(m, |p| p));
        let turret = match (&d.turret_geometry, &ring) {
            (Some(m), Some(r)) => {
                let pos = r.pos;
                Some(Geo::build(m, move |p| pos + p))
            }
            _ => None,
        };
        let fm = |g: &Geo, body: Body| -> Vec<FaceMass> {
            g.faces.iter().map(|f| armor.get(body, f.id).map(|fa| face_mass(g, f, fa, &db.materials)).unwrap_or_default()).collect()
        };
        let hull_face_mass = fm(&hull, Body::Hull);
        let turret_face_mass = turret.as_ref().map(|g| fm(g, Body::Turret)).unwrap_or_default();

        let engine_cat = cat.engines.get(&d.engine.kind);
        let trans_cat = cat.transmissions.get(&d.transmission.kind);
        let susp_cat = cat.suspensions.get(&d.suspension.kind);

        // ---- gun
        let gun = match (&d.weapons, &d.gun_mount) {
            (Some(w), Some(m)) if w.caliber_mm > 0.0 && w.length_cal > 0.0 => {
                let (cal, len) = (w.caliber_mm.round(), w.length_cal.round());
                let shells: Vec<ProjectileDef> = SHELL_KINDS.iter().filter(|k| kind_allowed(k, cal as f32)).filter_map(|k| design_shell(k, cal as f32, len as f32)).collect();
                // the gunner's selector lists the loaded kinds in the order the design stows them
                let loaded: Vec<(String, u32)> = d.ammunition.iter().filter(|a| a.count > 0).filter_map(|a| shells.iter().find(|s| s.id.starts_with(&format!("{}_design", a.kind))).map(|s| (s.id.clone(), a.count))).collect();
                let mut def = if loaded.is_empty() {
                    design_gun_def(cal as f32, len as f32, shells.first().map(|s| vec![s.id.clone()]).unwrap_or_default())
                } else {
                    design_gun_def(cal as f32, len as f32, loaded.iter().map(|(id, _)| id.clone()).collect())
                };
                def.ammo_count = loaded.iter().map(|(_, n)| *n).collect();
                let g = &cat.gun;
                let recoil_default = def.recoil_mm as f64 * 0.001;
                let recoil = m.recoil_distance_m.max(0.0);
                // a shorter recoil stroke means a harder kick on the trunnions: heavier cradle
                let mount_kg = g.mount_kg_per_mm * cal * (recoil_default / recoil.max(0.05)).sqrt().max(1.0);
                Some(GunSpec {
                    cal,
                    len,
                    gun_kg: def.mass_kg as f64,
                    def,
                    shells,
                    trunnion: m.position_m,
                    rear: g.breech_rear_base_m + g.breech_rear_per_mm * cal,
                    width: g.breech_width_base_m + g.breech_width_per_mm * cal,
                    height: g.breech_height_base_m + g.breech_height_per_mm * cal,
                    recoil,
                    recoil_default,
                    muzzle: cal * len * 0.001 * 0.86,
                    mount_kg,
                    mount: m.clone(),
                })
            }
            _ => None,
        };

        // ---- component boxes
        let mut boxes = vec![];
        let hp = d.engine.power_hp.max(0.0);
        for m in &d.internal_modules {
            let (size, kg) = match m.kind {
                ModuleKindDef::Engine => engine_cat.map(|c| engine_box(c, hp)).unwrap_or((v3(1.0, 0.8, 1.2), 1000.0)),
                ModuleKindDef::Transmission => {
                    let (s, kg) = trans_cat.map(|c| transmission_box(c, hp)).unwrap_or((v3(1.2, 0.6, 0.7), 800.0));
                    (s, kg + cat.steering.get(&d.transmission.steering).map(|s| s.kg).unwrap_or(0.0))
                }
                ModuleKindDef::Radio => (V3::from(cat.modules.radio.size_m), cat.modules.radio.kg),
                ModuleKindDef::TurretDrive => (V3::from(cat.modules.turret_drive.size_m), cat.modules.turret_drive.kg),
                ModuleKindDef::FuelTank => {
                    let s = m.size_m.unwrap_or(v3(0.4, 0.4, 0.6));
                    let vol = (s.x * s.y * s.z).max(0.0);
                    let fuel_density = engine_cat.map(|c| c.fuel_density).unwrap_or(0.8);
                    (s, vol * cat.fuel.tank_kg_per_m3 + vol * cat.fuel.fill * 1000.0 * fuel_density)
                }
                ModuleKindDef::AmmoRack => {
                    let s = m.size_m.unwrap_or(v3(0.4, 0.4, 0.4));
                    (s, s.x * s.y * s.z * cat.ammo.rack_frame_kg_per_m3)
                }
            };
            boxes.push(PlacedBox { id: m.id.clone(), kind: BoxKind::Module(m.kind), mount: m.mount, center: m.center_m, size, mass_kg: kg });
        }
        for (i, c) in d.crew_positions.iter().enumerate() {
            let s = if c.role == CrewRoleDef::Loader { cat.crew.loader_box_m } else { cat.crew.seated_box_m };
            boxes.push(PlacedBox { id: format!("crew_{}_{}", c.role.as_str(), i), kind: BoxKind::Crew(c.role), mount: c.mount, center: c.position_m, size: V3::from(s), mass_kg: cat.crew.mass_kg });
        }

        // ---- running gear
        let s = &d.suspension;
        let t = &d.tracks;
        let tc = &cat.tracks;
        let n = s.stations.max(1) as usize;
        let r = (s.wheel_diameter_m * 0.5).max(0.05);
        let wy = r + tc.thickness_m;
        let stations: Vec<Wheel> = (0..n)
            .map(|i| {
                let k = if n > 1 { i as f64 / (n - 1) as f64 } else { 0.5 };
                Wheel { z: s.front_z_m + (s.rear_z_m - s.front_z_m) * k, y: wy, r }
            })
            .collect();
        let sr = tc.sprocket_radius_m;
        let ir = (sr * 0.85).max(0.2);
        let hub_y = (wy + 0.12).max(sr + tc.thickness_m + 0.05);
        let front_end = s.front_z_m + r + 0.3 + sr * 0.5;
        let rear_end = s.rear_z_m - r - 0.3 - sr * 0.5;
        let (sprocket, idler) = if s.sprocket == "front" {
            (Wheel { z: front_end, y: hub_y, r: sr }, Wheel { z: rear_end, y: hub_y, r: ir })
        } else {
            (Wheel { z: rear_end, y: hub_y, r: sr }, Wheel { z: front_end, y: hub_y, r: ir })
        };
        let top = (2.0 * r + tc.thickness_m).max(hub_y + sr) + 0.04;
        let rollers = if susp_cat.map(|c| c.return_rollers).unwrap_or(false) && n >= 3 {
            let k = (n / 2).max(2);
            (0..k).map(|i| Wheel { z: s.front_z_m + (s.rear_z_m - s.front_z_m) * (i as f64 + 0.5) / k as f64, y: top - 0.06, r: 0.08 }).collect()
        } else {
            vec![]
        };
        let contact_length = (s.front_z_m - s.rear_z_m).abs() + s.wheel_diameter_m * 0.5;
        let span = (front_end - rear_end).abs();
        let loop_length = 2.0 * span + std::f64::consts::PI * (sr + ir) + 0.2;
        let envelope = Aabb {
            min: v3(t.center_x_m - t.width_m * 0.5, 0.0, rear_end.min(front_end) - sr.max(ir) - tc.thickness_m),
            max: v3(t.center_x_m + t.width_m * 0.5, top + tc.thickness_m, rear_end.max(front_end) + sr.max(ir) + tc.thickness_m),
        };
        let gear = Gear { stations, sprocket, idler, rollers, track_x: t.center_x_m, track_w: t.width_m, track_t: tc.thickness_m, contact_length, loop_length, envelope };

        let mut model = Model { d, db, armor, hull, turret_local, turret, ring, hull_face_mass, turret_face_mass, boxes, gun: None, gear, engine_cat, trans_cat, susp_cat };
        if let Some(g) = gun {
            model.boxes.push(PlacedBox {
                id: "gun_breech".into(),
                kind: BoxKind::Breech,
                mount: Body::Turret,
                center: g.trunnion - v3(0.0, 0.0, g.rear * 0.5 + 0.05),
                size: v3(g.width, g.height, g.rear),
                mass_kg: 0.0,
            });
            model.gun = Some(g);
        }
        model
    }

    pub fn geo(&self, body: Body) -> Option<&Geo> {
        match body {
            Body::Hull => Some(&self.hull),
            Body::Turret => self.turret.as_ref(),
        }
    }

    pub fn face_armor(&self, body: Body, face: u32) -> Option<&FaceArmor<'a>> {
        self.armor.get(body, face)
    }

    /// Turret space -> hull space at a turret yaw.
    pub fn turret_to_hull(&self, p: V3, yaw: f64) -> V3 {
        match &self.ring {
            Some(r) => r.pos + p.rot_y(yaw),
            None => p,
        }
    }

    pub fn to_hull(&self, mount: Body, p: V3, yaw: f64) -> V3 {
        match mount {
            Body::Hull => p,
            Body::Turret => self.turret_to_hull(p, yaw),
        }
    }

    /// Hull-space AABB of a box with the turret at `yaw`.
    pub fn box_aabb(&self, b: &PlacedBox, yaw: f64) -> Aabb {
        if b.mount == Body::Hull {
            return b.local_aabb();
        }
        let mut out = Aabb::EMPTY;
        for c in b.local_aabb().corners() {
            out.add(self.turret_to_hull(c, yaw));
        }
        out
    }

    fn ring_radius(&self) -> f64 {
        self.ring.as_ref().map(|r| r.d * 0.5).unwrap_or(0.0)
    }

    /// Inside the body and clear of every armour wall. `skip` decides which faces are openings
    /// (turret floor over the ring, hull roof inside the ring).
    fn clear_of_walls(&self, body: Body, g: &Geo, p: V3, masses: &[FaceMass], skip: impl Fn(&crate::mesh::GFace) -> bool) -> bool {
        for (fi, f) in g.faces.iter().enumerate() {
            if skip(f) {
                continue;
            }
            let max_wall = masses.get(fi).map(|m| m.wall_max_mm).unwrap_or(0.0) * 0.001;
            if max_wall <= 0.0 {
                continue;
            }
            if (p - f.centroid).dot(f.normal).abs() >= max_wall {
                continue;
            }
            let (dist, q) = g.face_distance(fi, p);
            if dist >= max_wall {
                continue;
            }
            let wall = self.face_armor(body, f.id).map(|fa| wall_depth_mm(g, f, fa, q)).unwrap_or(0.0) * 0.001;
            if dist < wall {
                return false;
            }
        }
        true
    }

    fn in_ring_cylinder(&self, p_hull: V3, margin: f64) -> bool {
        match &self.ring {
            Some(r) => {
                let dx = p_hull.x - r.pos.x;
                let dz = p_hull.z - r.pos.z;
                (dx * dx + dz * dz).sqrt() <= r.d * 0.5 - margin
            }
            None => false,
        }
    }

    /// Hull-space point inside the hull's armoured interior.
    pub fn in_hull_interior(&self, p: V3) -> bool {
        if !self.hull.contains(p) {
            return false;
        }
        let ring_open = self.in_ring_cylinder(p, 0.0);
        self.clear_of_walls(Body::Hull, &self.hull, p, &self.hull_face_mass, |f| ring_open && f.normal.y > 0.7)
    }

    /// Turret-space point inside the turret interior, or in the turret basket under the ring.
    pub fn in_turret_space(&self, p: V3) -> bool {
        let (Some(t), Some(r)) = (&self.turret, &self.ring) else { return false };
        let h = r.pos + p;
        if p.y >= 0.0 {
            if !t.contains(h) {
                return false;
            }
            self.clear_of_walls(Body::Turret, t, h, &self.turret_face_mass, |f| f.normal.y < -0.7 && (f.centroid.y - r.pos.y).abs() < 0.05)
        } else {
            (p.x * p.x + p.z * p.z).sqrt() <= self.ring_radius() - 0.02 && self.in_hull_interior(h)
        }
    }

    pub fn in_mount_space(&self, mount: Body, p: V3) -> bool {
        match mount {
            Body::Hull => self.in_hull_interior(p),
            Body::Turret => self.in_turret_space(p),
        }
    }
}
