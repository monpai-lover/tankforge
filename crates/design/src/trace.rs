//! Shots against a design: the shot line through the real armour volume (hull and turret walls
//! with their layer stacks, add-on slabs, the mantlet), the protection map (penetration
//! probability over the whole silhouette), and test shots with spall, crew and module damage
//! and a replayable ShotEvent.
use crate::armor::stack_at;
use crate::compile::damage_targets;
use crate::eval::addon_box;
use crate::layout::Model;
use crate::mesh::Geo;
use crate::model::{AddonKind, Body};
use crate::v3::{v3, Aabb, V3};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};
use tg_ballistics::{elevation_for_range, Atmosphere, BallisticState};
use tg_damage::{capabilities, generate_fragments, Capabilities, Crew, DamageParams, DamageSummary, Fragment, FragmentTrace, Module, ModuleKind, TargetRef};
use tg_penetration::stack::{min_pen_to_defeat, normal_cdf, resolve_stack, LayerOutcome, PlateCrossing, StackParams, StackReport};
use tg_penetration::PenetrationResult;
use tg_replay::*;
use tg_shared::{Rng, Vec3};
use tg_weapon::ProjectileDef;

#[derive(Clone, Debug, Serialize)]
pub struct Crossing {
    /// "wall" | "addon" | "mantlet"
    pub kind: &'static str,
    pub source: String,
    pub body: Option<Body>,
    pub face: Option<u32>,
    pub layer: usize,
    pub main: bool,
    pub material: String,
    pub thickness_mm: f64,
    pub path_mm: f64,
    pub incidence_deg: f64,
    pub gap_before_mm: f64,
    pub entry: V3,
    pub exit: V3,
    pub normal: V3,
    pub t0: f64,
    pub t1: f64,
    #[serde(skip)]
    pub era: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct Trace {
    /// Plates on the line before the round reaches a crew compartment, in order.
    pub plates: Vec<Crossing>,
    /// Where the line enters the interior (after the wall), if it does.
    pub interior_t: Option<f64>,
    pub interior_body: Option<Body>,
    pub interior_exit_t: Option<f64>,
    pub hit_anything: bool,
}

/// The armour of a design with the turret at a yaw and the gun at an elevation (hull space).
pub struct Scene<'m, 'a> {
    pub m: &'m Model<'a>,
    pub yaw: f64,
    pub elevation: f64,
    turret: Option<Geo>,
    pub spent_era: HashSet<String>,
}

struct Obb {
    c: V3,
    axes: [V3; 3],
    half: [f64; 3],
}

impl Obb {
    /// (t0, t1, entry normal) of the ray through the box.
    fn ray(&self, o: V3, d: V3) -> Option<(f64, f64, V3)> {
        let rel = o - self.c;
        let lo = v3(rel.dot(self.axes[0]), rel.dot(self.axes[1]), rel.dot(self.axes[2]));
        let ld = v3(d.dot(self.axes[0]), d.dot(self.axes[1]), d.dot(self.axes[2]));
        let b = Aabb { min: v3(-self.half[0], -self.half[1], -self.half[2]), max: v3(self.half[0], self.half[1], self.half[2]) };
        let (t0, t1) = b.ray(lo, ld)?;
        if t1 - t0 < 1e-9 {
            return None;
        }
        // entry face: the slab whose bound produced t0
        let p = lo + ld * t0;
        let mut best = (0usize, f64::INFINITY);
        for i in 0..3 {
            let dist = (p[i].abs() - self.half[i]).abs() / self.half[i].max(1e-6);
            if dist < best.1 {
                best = (i, dist);
            }
        }
        let s = if p[best.0] >= 0.0 { 1.0 } else { -1.0 };
        Some((t0, t1, self.axes[best.0] * s))
    }
}

fn incidence(d: V3, n: V3) -> f64 {
    (-d.dot(n)).abs().clamp(0.0, 1.0).acos().to_degrees()
}

impl<'m, 'a> Scene<'m, 'a> {
    pub fn new(m: &'m Model<'a>, yaw_deg: f64, elevation_deg: f64) -> Self {
        let yaw = yaw_deg.to_radians();
        let turret = match (&m.d.turret_geometry, &m.ring) {
            (Some(t), Some(_)) => Some(Geo::build(t, |p| m.turret_to_hull(p, yaw))),
            _ => None,
        };
        Scene { m, yaw, elevation: elevation_deg.to_radians(), turret, spent_era: HashSet::new() }
    }

    fn body_geo(&self, b: Body) -> Option<&Geo> {
        match b {
            Body::Hull => Some(&self.m.hull),
            Body::Turret => self.turret.as_ref(),
        }
    }

    pub fn bounds(&self) -> Aabb {
        let mut b = self.m.hull.bounds;
        if let Some(t) = &self.turret {
            b.add(t.bounds.min);
            b.add(t.bounds.max);
        }
        for a in &self.m.d.addons {
            for c in addon_box(a).1 {
                b.add(self.m.to_hull(a.body, c, self.yaw));
            }
        }
        b
    }

    fn mantlet(&self) -> Option<Obb> {
        let g = self.m.gun.as_ref()?;
        let mt = &g.mount.mantlet;
        let t = mt.thickness_mm.max(1.0) * 0.001;
        let c_local = g.trunnion + v3(0.0, 0.0, mt.offset_m + t * 0.5).rot_x(self.elevation);
        let ax = |v: V3| v.rot_x(self.elevation).rot_y(self.yaw);
        Some(Obb { c: self.m.turret_to_hull(c_local, self.yaw), axes: [ax(V3::X), ax(V3::Y), ax(V3::Z)], half: [mt.width_m * 0.5, mt.height_m * 0.5, t * 0.5] })
    }

    /// Everything the line o + d t passes through, nearest first.
    pub fn trace(&self, o: V3, d: V3) -> Trace {
        let d = d.norm();
        let mut plates: Vec<Crossing> = vec![];
        let mut interiors: Vec<(f64, f64, Body)> = vec![];
        for body in [Body::Hull, Body::Turret] {
            let Some(g) = self.body_geo(body) else { continue };
            let hits = g.ray_hits(o, d);
            let mut i = 0;
            while i < hits.len() {
                if !hits[i].front {
                    i += 1;
                    continue;
                }
                let entry = hits[i];
                let exit_t = hits[i + 1..].iter().find(|h| !h.front).map(|h| h.t).unwrap_or(entry.t + 0.01);
                let f = &g.faces[entry.face];
                let cos_f = (-d.dot(f.normal)).max(0.02);
                let mut wall_end = entry.t;
                if let Some(fa) = self.m.face_armor(body, f.id) {
                    // turret armour is described in turret space (thickness maps, layer tilt)
                    let layers = match (body, &self.m.turret_local, &self.m.ring) {
                        (Body::Turret, Some(tl), Some(r)) => {
                            let fl = &tl.faces[entry.face];
                            let pl = (entry.point - r.pos).rot_y(-self.yaw);
                            let mut ls = stack_at(tl, fl, fa, pl);
                            for l in &mut ls {
                                l.normal = l.normal.rot_y(self.yaw);
                            }
                            ls
                        }
                        _ => stack_at(g, f, fa, entry.point),
                    };
                    for l in layers {
                        let t0 = entry.t + l.depth_mm * 0.001 / cos_f;
                        if t0 >= exit_t {
                            break;
                        }
                        let cos_l = (-d.dot(l.normal)).abs().max(0.02);
                        let t1 = (t0 + l.thickness_mm * 0.001 / cos_l).min(exit_t);
                        plates.push(Crossing {
                            kind: "wall",
                            source: format!("{}:face:{}", body.as_str(), f.id),
                            body: Some(body),
                            face: Some(f.id),
                            layer: l.index,
                            main: l.main,
                            material: l.material.clone(),
                            thickness_mm: l.thickness_mm,
                            path_mm: (t1 - t0) * 1000.0,
                            incidence_deg: incidence(d, l.normal),
                            gap_before_mm: 0.0,
                            entry: o + d * t0,
                            exit: o + d * t1,
                            normal: l.normal,
                            t0,
                            t1,
                            era: false,
                        });
                        wall_end = wall_end.max(t1);
                    }
                }
                if wall_end < exit_t - 1e-4 {
                    interiors.push((wall_end, exit_t, body));
                }
                // continue after this exit
                i = hits.iter().position(|h| h.t > exit_t + 1e-9).unwrap_or(hits.len());
            }
        }
        for a in &self.m.d.addons {
            if a.kind == AddonKind::Era && self.spent_era.contains(&a.id) {
                continue;
            }
            let n = a.normal.norm();
            let u = (a.u_axis - n * a.u_axis.dot(n)).norm();
            let w = n.cross(u);
            let (c, _) = addon_box(a);
            let to = |v: V3| -> V3 {
                match a.body {
                    Body::Hull => v,
                    Body::Turret => v.rot_y(self.yaw),
                }
            };
            let obb = Obb { c: self.m.to_hull(a.body, c, self.yaw), axes: [to(u), to(w), to(n)], half: [a.size_m[0] * 0.5, a.size_m[1] * 0.5, a.thickness_mm.max(0.1) * 0.0005] };
            if let Some((t0, t1, nrm)) = obb.ray(o, d) {
                plates.push(Crossing { kind: "addon", source: format!("addon:{}", a.id), body: Some(a.body), face: a.face, layer: 0, main: false, material: a.material.clone(), thickness_mm: a.thickness_mm, path_mm: (t1 - t0) * 1000.0, incidence_deg: incidence(d, nrm), gap_before_mm: 0.0, entry: o + d * t0, exit: o + d * t1, normal: nrm, t0, t1, era: a.kind == AddonKind::Era });
            }
        }
        if let Some(obb) = self.mantlet() {
            if let Some((t0, t1, nrm)) = obb.ray(o, d) {
                let mt = &self.m.gun.as_ref().unwrap().mount.mantlet;
                plates.push(Crossing { kind: "mantlet", source: "mantlet".into(), body: Some(Body::Turret), face: None, layer: 0, main: false, material: mt.material.clone(), thickness_mm: mt.thickness_mm, path_mm: (t1 - t0) * 1000.0, incidence_deg: incidence(d, nrm), gap_before_mm: 0.0, entry: o + d * t0, exit: o + d * t1, normal: nrm, t0, t1, era: false });
            }
        }
        plates.sort_by(|a, b| a.t0.total_cmp(&b.t0));
        interiors.sort_by(|a, b| a.0.total_cmp(&b.0));
        let hit_anything = !plates.is_empty() || !interiors.is_empty();
        let first_interior = interiors.first().copied();
        if let Some((t_in, _, _)) = first_interior {
            plates.retain(|p| p.t0 < t_in - 1e-6);
        }
        let mut prev: Option<f64> = None;
        for p in &mut plates {
            p.gap_before_mm = prev.map(|e| ((p.t0 - e) * 1000.0).max(0.0)).unwrap_or(0.0);
            prev = Some(p.t1.max(prev.unwrap_or(f64::NEG_INFINITY)));
        }
        Trace { plates, interior_t: first_interior.map(|x| x.0), interior_body: first_interior.map(|x| x.2), interior_exit_t: first_interior.map(|x| x.1), hit_anything }
    }

    /// How far a fragment starting inside the vehicle can fly before it meets the armour.
    pub fn inside_range(&self, o: V3, d: V3, max: f64) -> f64 {
        let d = d.norm();
        let mut best = max;
        for body in [Body::Hull, Body::Turret] {
            if let Some(g) = self.body_geo(body) {
                if let Some(h) = g.ray_hits(o, d).into_iter().find(|h| !h.front) {
                    // the wall itself has depth; stopping at its outer surface is close enough
                    if g.contains(o + d * 1e-3) {
                        best = best.min(h.t);
                    }
                }
            }
        }
        best
    }

    pub fn crossings<'b>(&'b self, plates: &'b [Crossing]) -> Option<Vec<PlateCrossing<'b>>> {
        plates
            .iter()
            .map(|p| {
                let mat = self.m.db.materials.get(&p.material)?;
                Some(PlateCrossing { material: mat, thickness_mm: p.thickness_mm as f32, path_mm: p.path_mm as f32, incidence_deg: p.incidence_deg as f32, gap_before_mm: p.gap_before_mm as f32 })
            })
            .collect()
    }
}

pub fn stack_params(m: &Model) -> StackParams {
    let c = &m.db.catalog.penetration;
    StackParams { heat_gap_loss_per_mm: c.heat_gap_loss_per_mm as f32, heat_gap_max_loss: c.heat_gap_max_loss as f32 }
}

/// Speed, descent angle and penetration of a round fired flat at a target `distance` away.
pub fn impact_conditions(shell: &ProjectileDef, distance: f64) -> (f64, f64, f64) {
    let atm = Atmosphere::default();
    let e = elevation_for_range(shell, distance as f32, &atm).map(|s| s.elevation_rad).unwrap_or(0.0);
    let mut s = BallisticState::from_muzzle(Vec3::ZERO, Vec3::new(0.0, e.sin(), e.cos()), shell);
    let dt = 1.0 / 500.0;
    for _ in 0..40_000 {
        if s.pos.z as f64 >= distance || s.vel.z <= 1.0 {
            break;
        }
        s.step(dt, &atm);
    }
    let descent = (-s.vel.y as f64).atan2(s.vel.z as f64).max(0.0);
    (s.speed() as f64, descent.to_degrees(), shell.pen_at(distance as f32) as f64)
}

// ------------------------------------------------------------------ protection map

#[derive(Clone, Debug, Deserialize)]
pub struct ProtectRequest {
    pub shell: ProjectileDef,
    pub distance_m: f64,
    /// Where the shooter stands, seen from the vehicle: 0 = in front, 90 = right side, 180 = behind.
    pub azimuth_deg: f64,
    /// Shooter above the target (deg), added to the round's descent at that range.
    #[serde(default)]
    pub elevation_deg: f64,
    #[serde(default)]
    pub turret_yaw_deg: f64,
    #[serde(default = "d_cols")]
    pub cols: usize,
    #[serde(default = "d_rows")]
    pub rows: usize,
}

fn d_cols() -> usize {
    96
}
fn d_rows() -> usize {
    64
}

#[derive(Clone, Debug, Serialize)]
pub struct ProtectCell {
    pub i: usize,
    pub j: usize,
    pub point: V3,
    pub normal: V3,
    pub prob: f64,
    /// 1 cannot penetrate, 2 hard, 3 possible, 4 easy, 5 armour but no crew compartment behind it
    pub class: u8,
    pub need_mm: Option<f64>,
    pub ricochet: bool,
    pub source: String,
    pub plates: usize,
    pub behind: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct ProtectMap {
    pub cols: usize,
    pub rows: usize,
    pub dir: V3,
    pub u: V3,
    pub v: V3,
    pub cell_m: f64,
    pub origin: V3,
    pub pen_mm: f64,
    pub impact_speed_ms: f64,
    pub descent_deg: f64,
    pub cells: Vec<ProtectCell>,
    /// Presented area (m^2) in each class 1..5, and the area-weighted chance of a penetration.
    pub area_by_class: [f64; 5],
    pub mean_probability: f64,
}

pub fn class_of(prob: f64) -> u8 {
    if prob >= 0.85 {
        4
    } else if prob >= 0.35 {
        3
    } else if prob >= 0.02 {
        2
    } else {
        1
    }
}

/// First crew member / module along the line after it enters the interior (within 3 m).
fn behind(targets: &(Vec<tg_damage::Module>, Vec<tg_damage::Crew>), o: V3, d: V3) -> Option<String> {
    let (mods, crew) = targets;
    let mut best: Option<(f64, String)> = None;
    for c in crew {
        let p = V3::from_f32(c.pos);
        let oc = o - p;
        let b = oc.dot(d);
        let disc = b * b - (oc.dot(oc) - (c.radius as f64).powi(2));
        if disc >= 0.0 {
            let t = -b - disc.sqrt();
            if (0.0..3.0).contains(&t) && best.as_ref().map_or(true, |x| t < x.0) {
                best = Some((t, format!("crew:{}", c.role.as_str())));
            }
        }
    }
    for m in mods {
        if matches!(m.kind, ModuleKind::GunBarrel | ModuleKind::Track) {
            continue;
        }
        let a = Aabb::from_center(V3::from_f32(m.center), V3::from_f32(m.half_extents) * 2.0);
        if let Some((t, _)) = a.ray(o, d) {
            if t < 3.0 && best.as_ref().map_or(true, |x| t < x.0) {
                best = Some((t, format!("{}:{}", m.kind.as_str(), m.id)));
            }
        }
    }
    best.map(|b| b.1)
}

pub fn protection_map(m: &Model, req: &ProtectRequest) -> ProtectMap {
    let scene = Scene::new(m, req.turret_yaw_deg, 0.0);
    let (speed, descent, pen) = impact_conditions(&req.shell, req.distance_m);
    let el = (descent + req.elevation_deg).to_radians();
    let az = req.azimuth_deg.to_radians();
    // direction the round travels: from the shooter towards the vehicle
    let d = v3(-az.sin() * el.cos(), -el.sin(), -az.cos() * el.cos()).norm();
    let mut u = d.cross(V3::Y);
    if u.len() < 1e-6 {
        u = V3::X;
    }
    let u = u.norm();
    let v = u.cross(d).norm();
    let b = scene.bounds();
    let (mut u0, mut u1, mut v0, mut v1) = (f64::INFINITY, f64::NEG_INFINITY, f64::INFINITY, f64::NEG_INFINITY);
    for c in b.corners() {
        u0 = u0.min(c.dot(u));
        u1 = u1.max(c.dot(u));
        v0 = v0.min(c.dot(v));
        v1 = v1.max(c.dot(v));
    }
    let cols = req.cols.clamp(8, 240);
    let rows = req.rows.clamp(8, 160);
    let cell = ((u1 - u0) / cols as f64).max((v1 - v0) / rows as f64).max(0.01);
    let (uc, vc) = ((u0 + u1) * 0.5, (v0 + v1) * 0.5);
    let back = b.center() - d * (b.size().len() + 5.0);
    let origin = back + u * (uc - back.dot(u)) + v * (vc - back.dot(v));
    let sp = stack_params(m);
    let sigma = m.db.catalog.penetration.sigma_fraction;
    let targets = damage_targets(m, scene.yaw);
    let mut cells = vec![];
    let mut area = [0.0; 5];
    let mut weighted = 0.0;
    let mut presented = 0.0;
    for j in 0..rows {
        for i in 0..cols {
            let du = (i as f64 + 0.5 - cols as f64 * 0.5) * cell;
            let dv = (j as f64 + 0.5 - rows as f64 * 0.5) * cell;
            let o = origin + u * du + v * dv;
            let tr = scene.trace(o, d);
            if !tr.hit_anything {
                continue;
            }
            let first = tr.plates.first();
            let point = first.map(|p| p.entry).unwrap_or_else(|| o + d * tr.interior_t.unwrap_or(0.0));
            let normal = first.map(|p| p.normal).unwrap_or(V3::ZERO);
            let source = first.map(|p| p.source.clone()).unwrap_or_default();
            let mut c = ProtectCell { i, j, point, normal, prob: 0.0, class: 5, need_mm: None, ricochet: false, source, plates: tr.plates.len(), behind: None };
            if let Some(t_in) = tr.interior_t {
                c.behind = behind(&targets, o + d * t_in, d);
                match scene.crossings(&tr.plates) {
                    Some(pl) if !pl.is_empty() => match min_pen_to_defeat(&req.shell, &pl, &sp) {
                        None => {
                            c.ricochet = true;
                            c.class = 1;
                        }
                        Some(need) => {
                            c.need_mm = Some(need as f64);
                            c.prob = 1.0 - normal_cdf(((need as f64 - pen) / (pen * sigma).max(1e-3)) as f32) as f64;
                            c.class = class_of(c.prob);
                        }
                    },
                    Some(_) => {
                        c.prob = 1.0;
                        c.class = 4;
                    }
                    None => c.class = 1,
                }
            }
            area[(c.class - 1) as usize] += cell * cell;
            if c.class <= 4 {
                weighted += c.prob * cell * cell;
                presented += cell * cell;
            }
            cells.push(c);
        }
    }
    ProtectMap { cols, rows, dir: d, u, v, cell_m: cell, origin, pen_mm: pen, impact_speed_ms: speed, descent_deg: descent, cells, area_by_class: area, mean_probability: if presented > 0.0 { weighted / presented } else { 0.0 } }
}

// ------------------------------------------------------------------- probe

#[derive(Clone, Debug, Serialize)]
pub struct Probe {
    pub plates: Vec<Crossing>,
    pub stack: Option<StackReport>,
    pub los_mm: f64,
    pub rha_mm: f64,
    pub interior: bool,
}

/// What a line of sight meets: for the editor's hover readout (LOS thickness from the view).
pub fn probe(m: &Model, o: V3, d: V3, yaw_deg: f64) -> Probe {
    let scene = Scene::new(m, yaw_deg, 0.0);
    let tr = scene.trace(o, d);
    let los: f64 = tr.plates.iter().map(|p| p.path_mm).sum();
    let rha: f64 = tr.plates.iter().map(|p| p.path_mm * m.db.materials.get(&p.material).map(|x| x.kinetic_factor as f64).unwrap_or(1.0)).sum();
    Probe { los_mm: los, rha_mm: rha, interior: tr.interior_t.is_some(), plates: tr.plates, stack: None }
}

// ---------------------------------------------------------------- test shots

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct TargetState {
    pub module_health: HashMap<String, f32>,
    pub crew_health: HashMap<String, f32>,
    pub spent_era: Vec<String>,
    pub shots: u32,
}

#[derive(Clone, Debug, Deserialize)]
pub struct ShotRequest {
    pub shell: ProjectileDef,
    /// Start of the last flight segment and the direction of flight, hull space.
    pub origin: V3,
    pub dir: V3,
    pub speed_ms: f64,
    pub distance_m: f64,
    pub seed: u64,
    #[serde(default)]
    pub turret_yaw_deg: f64,
    #[serde(default)]
    pub gun_elevation_deg: f64,
    /// Flight path so far (world or hull space, the client's choice), copied into the event.
    #[serde(default)]
    pub path: Vec<[f64; 4]>,
}

#[derive(Clone, Debug, Serialize)]
pub struct LayerDetail {
    pub crossing: Crossing,
    pub outcome: LayerOutcome,
    pub los_mm: f64,
    pub required_mm: f64,
    pub pen_before_mm: f64,
    pub pen_after_mm: f64,
}

#[derive(Clone, Debug, Serialize)]
pub struct ShotResponse {
    pub event: ShotEvent,
    pub layers: Vec<LayerDetail>,
    pub timeline: Vec<ReplayKeyframe>,
    pub capabilities: Capabilities,
    pub pen_nominal_mm: f64,
    pub pen_rolled_mm: f64,
    pub hit: bool,
    pub interior_point: Option<V3>,
    pub stopped_point: Option<V3>,
    pub ricochet_dir: Option<V3>,
    pub state: TargetState,
    pub note: String,
}

fn gauss(rng: &mut Rng) -> f64 {
    let u1 = (rng.next_f32() as f64).max(1e-9);
    let u2 = rng.next_f32() as f64;
    (-2.0 * u1.ln()).sqrt() * (std::f64::consts::TAU * u2).cos()
}

pub fn shoot(m: &Model, state: &TargetState, req: &ShotRequest) -> ShotResponse {
    let mut scene = Scene::new(m, req.turret_yaw_deg, req.gun_elevation_deg);
    scene.spent_era = state.spent_era.iter().cloned().collect();
    let d = req.dir.norm();
    let tr = scene.trace(req.origin, d);
    let mut rng = Rng::new(req.seed.max(1));
    let pen_nominal = req.shell.pen_at(req.distance_m as f32) as f64;
    let sigma = m.db.catalog.penetration.sigma_fraction;
    let z = gauss(&mut rng).clamp(-2.5, 2.5);
    let pen = (pen_nominal * (1.0 + sigma * z)).max(0.0);
    let (mut modules, mut crew) = damage_targets(m, scene.yaw);
    for md in &mut modules {
        if let Some(h) = state.module_health.get(&md.id) {
            md.health = *h;
        }
    }
    for (i, c) in crew.iter_mut().enumerate() {
        if let Some(h) = state.crew_health.get(&format!("{}_{}", c.role.as_str(), i)) {
            c.health = *h;
        }
    }
    let mut path: Vec<PathPoint> = req.path.iter().map(|p| PathPoint { t: p[0] as f32, pos: Vec3::new(p[1] as f32, p[2] as f32, p[3] as f32) }).collect();
    let mut ev = ShotEvent {
        shot_id: req.seed,
        tick: 0,
        seed: req.seed,
        shooter_id: 1,
        target_id: 2,
        projectile_type: req.shell.id.clone(),
        muzzle_position: path.first().map(|p| p.pos).unwrap_or(req.origin.to_f32()),
        impact_position: req.origin.to_f32(),
        impact_normal: Vec3::ZERO,
        armor_plate: String::new(),
        armor_thickness_mm: 0.0,
        impact_angle_deg: 0.0,
        effective_thickness_mm: 0.0,
        penetration_value_mm: pen as f32,
        penetration_result: PenetrationOutcome::Miss,
        projectile_path: vec![],
        fragments: vec![],
        damaged_modules: vec![],
        damaged_crew: vec![],
        outcomes: vec![ShotOutcome::Miss],
    };
    let mut resp = ShotResponse { event: ev.clone(), layers: vec![], timeline: vec![], capabilities: capabilities(&modules, &crew), pen_nominal_mm: pen_nominal, pen_rolled_mm: pen, hit: false, interior_point: None, stopped_point: None, ricochet_dir: None, state: state.clone(), note: String::new() };
    if !tr.hit_anything {
        resp.event.projectile_path = path;
        resp.timeline = build_timeline(&resp.event, &TimelineOptions::default());
        resp.note = "未命中".into();
        return resp;
    }
    resp.hit = true;
    let plates = tr.plates.clone();
    let first_point = plates.first().map(|p| p.entry).unwrap_or_else(|| req.origin + d * tr.interior_t.unwrap_or(0.0));
    let t_impact = path.last().map(|p| p.t).unwrap_or(0.0) + ((first_point - req.origin).len() / req.speed_ms.max(1.0)) as f32;
    path.push(PathPoint { t: t_impact, pos: first_point.to_f32() });
    ev.impact_position = first_point.to_f32();
    ev.outcomes.clear();
    let crossings = scene.crossings(&plates).unwrap_or_default();
    let sp = stack_params(m);
    let report = resolve_stack(&req.shell, &crossings, pen as f32, &sp);
    if let Some(f) = plates.first() {
        ev.impact_normal = f.normal.to_f32();
        ev.armor_plate = f.source.clone();
        ev.armor_thickness_mm = f.thickness_mm as f32;
        ev.impact_angle_deg = f.incidence_deg as f32;
    }
    ev.effective_thickness_mm = report.layers.iter().filter(|l| l.outcome != LayerOutcome::NotReached).map(|l| l.required_mm).sum();
    resp.layers = plates
        .iter()
        .zip(report.layers.iter())
        .map(|(c, l)| LayerDetail { crossing: c.clone(), outcome: l.outcome, los_mm: l.los_mm as f64, required_mm: l.required_mm as f64, pen_before_mm: l.pen_before_mm as f64, pen_after_mm: l.pen_after_mm as f64 })
        .collect();
    // reactive bricks go off when hit, whatever the result
    for (c, l) in plates.iter().zip(report.layers.iter()) {
        if c.era && l.outcome != LayerOutcome::NotReached {
            resp.state.spent_era.push(c.source.trim_start_matches("addon:").to_string());
        }
    }
    let mut penetrated = false;
    match report.result {
        PenetrationResult::Ricochet => {
            ev.penetration_result = PenetrationOutcome::Ricochet;
            ev.outcomes.push(ShotOutcome::Ricochet);
            let i = report.stopped_at.unwrap_or(0);
            let n = plates[i].normal;
            let r = d - n * (2.0 * d.dot(n));
            resp.ricochet_dir = Some(r.norm());
            resp.stopped_point = Some(plates[i].entry);
            resp.note = format!("跳彈（入射角 {:.0}°）", plates[i].incidence_deg);
        }
        PenetrationResult::Shattered => {
            ev.penetration_result = PenetrationOutcome::Shattered;
            ev.outcomes.push(ShotOutcome::Shattered);
            resp.stopped_point = report.stopped_at.map(|i| plates[i].entry);
            resp.note = "彈體碎裂".into();
        }
        PenetrationResult::Stopped => {
            ev.penetration_result = PenetrationOutcome::Stopped;
            ev.outcomes.push(ShotOutcome::Stopped);
            if let Some(i) = report.stopped_at {
                let l = &report.layers[i];
                let k = if l.required_mm > 0.0 { (l.pen_before_mm / l.required_mm).clamp(0.0, 1.0) as f64 } else { 0.0 };
                resp.stopped_point = Some(plates[i].entry + (plates[i].exit - plates[i].entry) * k);
                resp.note = format!("未擊穿：停在第 {} 層（{}）", i + 1, plates[i].material);
            }
        }
        PenetrationResult::Penetrated { residual_mm, speed_fraction } => {
            match tr.interior_t {
                Some(t_in) => {
                    penetrated = true;
                    ev.penetration_result = PenetrationOutcome::Penetrated;
                    let entry = req.origin + d * t_in;
                    resp.interior_point = Some(entry);
                    path.push(PathPoint { t: t_impact + 0.0005, pos: entry.to_f32() });
                    let v = req.speed_ms * speed_fraction as f64;
                    let energy = 0.5 * req.shell.mass_kg as f64 * v * v;
                    let mut params = DamageParams::default();
                    let chemical = req.shell.kind.is_chemical();
                    if chemical {
                        params.cone_half_angle_deg = 14.0;
                        params.frag_energy_fraction = 0.25;
                    }
                    let mut frags = generate_fragments(entry.to_f32(), d.to_f32(), energy as f32, residual_mm, &params, &mut rng);
                    // explosive filler: a delayed burst inside the compartment
                    if req.shell.explosive_mass_kg > 0.0 && !chemical {
                        let span = tr.interior_exit_t.map(|e| (e - t_in) * 0.8).unwrap_or(1.0);
                        let travel = (v * req.shell.fuse_delay_s as f64).max(0.3).min(span).min(2.0);
                        let burst = entry + d * travel;
                        let burst_energy = req.shell.explosive_mass_kg * 4.2e6 * 0.3;
                        let bp = DamageParams { base_frag_count: 24, frags_per_residual_mm: 0.0, max_frags: 60, frag_energy_fraction: 1.0, cone_half_angle_deg: 180.0, ..DamageParams::default() };
                        let extra = generate_fragments(burst.to_f32(), d.to_f32(), burst_energy, 0.0, &bp, &mut rng);
                        frags.extend(extra.into_iter().skip(1));
                    }
                    // spall stays inside: each fragment stops at the inner side of the armour
                    let ranges: Vec<f64> = frags.iter().map(|f| scene.inside_range(V3::from_f32(f.origin), V3::from_f32(f.dir), params.frag_range_m as f64)).collect();
                    let summary = propagate_inside(&frags, &ranges, &mut modules, &mut crew);
                    for (f, t) in frags.iter().zip(summary.traces.iter()) {
                        ev.fragments.push(FragmentRecord {
                            origin: t.origin,
                            end: t.end,
                            energy_j: f.energy_j,
                            damage: t.damage,
                            is_penetrator: t.is_penetrator,
                            hit: t.target.map(|x| match x {
                                TargetRef::Module(i) => modules[i].id.clone(),
                                TargetRef::Crew(i) => format!("crew:{}", crew[i].role.as_str()),
                            }),
                        });
                    }
                    let mut md: BTreeMap<usize, f32> = BTreeMap::new();
                    for (i, dmg) in &summary.module_damage {
                        *md.entry(*i).or_default() += dmg;
                    }
                    for (i, dmg) in md {
                        let mo = &modules[i];
                        let destroyed = summary.newly_destroyed_modules.contains(&i);
                        ev.damaged_modules.push(DamagedModule { id: mo.id.clone(), kind: mo.kind.as_str().into(), damage: dmg, destroyed });
                        ev.outcomes.push(if destroyed {
                            match mo.kind {
                                ModuleKind::AmmoRack => ShotOutcome::AmmoDetonation,
                                ModuleKind::FuelTank => ShotOutcome::FuelFire,
                                ModuleKind::Engine => ShotOutcome::EngineDamaged,
                                ModuleKind::GunBarrel => ShotOutcome::BarrelDamaged,
                                ModuleKind::GunBreech => ShotOutcome::BreechDamaged,
                                ModuleKind::Track => ShotOutcome::TrackBroken,
                                _ => ShotOutcome::ModuleDamaged,
                            }
                        } else {
                            ShotOutcome::ModuleDamaged
                        });
                    }
                    let mut cd: BTreeMap<usize, f32> = BTreeMap::new();
                    for (i, dmg) in &summary.crew_damage {
                        *cd.entry(*i).or_default() += dmg;
                    }
                    for (i, dmg) in cd {
                        let killed = summary.newly_killed_crew.contains(&i);
                        ev.damaged_crew.push(DamagedCrew { role: crew[i].role.as_str().into(), damage: dmg, killed });
                        ev.outcomes.push(if killed { ShotOutcome::CrewKilled } else { ShotOutcome::CrewInjured });
                    }
                    if ev.outcomes.is_empty() {
                        ev.outcomes.push(ShotOutcome::PenetratedNoDamage);
                    }
                    resp.note = format!("擊穿 {} 層，剩餘穿深 {:.0} mm", plates.len(), residual_mm);
                }
                None => {
                    // went through external plates only (skirt, mantlet edge, add-on) and out
                    ev.penetration_result = PenetrationOutcome::Penetrated;
                    ev.outcomes.push(ShotOutcome::PenetratedNoDamage);
                    resp.note = "穿過外部裝甲，沒有進入車內".into();
                }
            }
        }
    }
    let _ = penetrated;
    if let Some(p) = resp.stopped_point {
        path.push(PathPoint { t: t_impact + 0.0002, pos: p.to_f32() });
    }
    ev.projectile_path = path;
    for md in &modules {
        resp.state.module_health.insert(md.id.clone(), md.health);
    }
    for (i, c) in crew.iter().enumerate() {
        resp.state.crew_health.insert(format!("{}_{}", c.role.as_str(), i), c.health);
    }
    resp.state.shots += 1;
    resp.capabilities = capabilities(&modules, &crew);
    resp.timeline = build_timeline(&ev, &TimelineOptions::default());
    resp.event = ev;
    resp
}

fn ray_sphere(o: V3, d: V3, c: V3, r: f64) -> Option<f64> {
    let oc = o - c;
    let b = oc.dot(d);
    let disc = b * b - (oc.dot(oc) - r * r);
    if disc < 0.0 {
        return None;
    }
    let s = disc.sqrt();
    let t = if -b - s >= 0.0 { -b - s } else { -b + s };
    if t >= 0.0 {
        Some(t)
    } else {
        None
    }
}

/// tg_damage::propagate with a range per fragment (fragments do not fly through armour) and
/// without the external modules (barrel, tracks), which interior spall cannot reach.
pub fn propagate_inside(frags: &[Fragment], ranges: &[f64], modules: &mut [Module], crew: &mut [Crew]) -> DamageSummary {
    let mut s = DamageSummary::default();
    for (f, &range) in frags.iter().zip(ranges.iter()) {
        let (o, d) = (V3::from_f32(f.origin), V3::from_f32(f.dir).norm());
        let mut best: Option<(f64, TargetRef)> = None;
        for (i, c) in crew.iter().enumerate() {
            if c.health <= 0.0 {
                continue;
            }
            if let Some(t) = ray_sphere(o, d, V3::from_f32(c.pos), c.radius as f64) {
                if t <= range && best.map_or(true, |(bt, _)| t < bt) {
                    best = Some((t, TargetRef::Crew(i)));
                }
            }
        }
        for (i, m) in modules.iter().enumerate() {
            if m.health <= 0.0 || m.kind.is_external() {
                continue;
            }
            let a = Aabb::from_center(V3::from_f32(m.center), V3::from_f32(m.half_extents) * 2.0);
            if let Some((t, _)) = a.ray(o, d) {
                if t <= range && best.map_or(true, |(bt, _)| t < bt) {
                    best = Some((t, TargetRef::Module(i)));
                }
            }
        }
        match best {
            Some((t, target)) => {
                match target {
                    TargetRef::Crew(i) => {
                        let was = crew[i].health > 0.0;
                        crew[i].health -= f.damage;
                        s.crew_damage.push((i, f.damage));
                        if was && crew[i].health <= 0.0 {
                            s.newly_killed_crew.push(i);
                        }
                    }
                    TargetRef::Module(i) => {
                        let was = modules[i].health > 0.0;
                        modules[i].health -= f.damage;
                        s.module_damage.push((i, f.damage));
                        if was && modules[i].health <= 0.0 {
                            s.newly_destroyed_modules.push(i);
                        }
                    }
                }
                s.traces.push(FragmentTrace { origin: f.origin, end: (o + d * t).to_f32(), target: Some(target), damage: f.damage, is_penetrator: f.is_penetrator });
            }
            None => s.traces.push(FragmentTrace { origin: f.origin, end: (o + d * range).to_f32(), target: None, damage: 0.0, is_penetrator: f.is_penetrator }),
        }
    }
    s
}
