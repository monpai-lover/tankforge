//! Authoritative 2.5D naval actors. Authored Float32 triangle lists are emitted to
//! the client and queried here, including the cargo hatch and bridge apertures.
//! Hull strength, blast coupling and gun tuning are game-authored abstractions,
//! not historical armor or internal-compartment measurements.
use crate::frontline::UnitRef;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;
use tg_combat::geometry::{
    manifest::sha256,
    ray::{self, cross, dot, sub},
};
use tg_weapon::{ProjectileDef, ProjectileKind};

type Point = [f64; 3];
const FIXED_DT: f64 = 1.0 / 120.0;
const ACCEL: f64 = 0.8;
const TURN_RATE: f64 = 0.22;
const GUN_RATE: f64 = 0.8;
const COOLDOWN: f64 = 6.0;
// Source: data/projectiles/he_76_m42a1.json. Shell identity is also checked by
// the caller's trusted projectile catalog before a returned shot is admitted.
const MUZZLE_SPEED: f64 = 820.0;
const MAX_RANGE: f64 = 1800.0;

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NavalConfig {
    #[serde(default)]
    pub vessels: Vec<VesselSpec>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VesselSpec {
    pub id: String,
    pub team: u8,
    pub role: String,
    pub model: String,
    pub pos: Point,
    pub yaw: f64,
    #[serde(default)]
    pub route: Vec<[f64; 2]>,
    pub speed_mps: f64,
    pub ammo: u32,
    pub shell_id: String,
}
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct VesselView {
    pub id: String,
    pub unit: UnitRef,
    pub team: u8,
    pub role: String,
    pub model: String,
    pub pos: Point,
    pub yaw: f64,
    pub velocity: Point,
    pub alive: bool,
    pub health: f64,
    pub max_health: f64,
    pub ammo: u32,
    pub ammo_revision: u64,
    pub unloading_s: f64,
    pub gun_yaw: f64,
    pub gun_pitch: f64,
    pub geometry_id: String,
    pub geometry_hash: String,
    pub geometry_revision: u64,
    pub pose_revision: u64,
}
#[derive(Clone, Debug, Serialize)]
pub struct NavalContact {
    pub unit: UnitRef,
    pub team: u8,
    pub fraction: f64,
    pub pos: Point,
    pub normal: Point,
    pub barycentric: Point,
    pub part_id: String,
    pub triangle_index: usize,
    pub geometry_hash: String,
    pub geometry_revision: u64,
    pub pose_revision: u64,
}
#[derive(Clone, Debug, Serialize)]
pub struct NavalShot {
    pub shooter: UnitRef,
    pub target: UnitRef,
    pub team: u8,
    pub shell_id: String,
    pub pos: Point,
    pub velocity: Point,
    pub ammo_revision: u64,
}
#[derive(Clone, Debug, Serialize)]
struct Part {
    id: String,
    role: String,
    color: [f32; 3],
    pose_group: String,
    pivot: [f32; 3],
    triangles: Vec<[f32; 9]>,
}
impl Part {
    fn new(id: &str, role: &str, color: [f32; 3], pivot: [f32; 3], gun: bool) -> Self {
        Self {
            id: id.into(),
            role: role.into(),
            color,
            pivot,
            pose_group: if gun { "gun" } else { "body" }.into(),
            triangles: vec![],
        }
    }
    fn triangle(&self, index: usize) -> [Point; 3] {
        let t = self.triangles[index];
        std::array::from_fn(|i| std::array::from_fn(|j| t[3 * i + j] as f64))
    }
    fn tri(&mut self, a: [f32; 3], b: [f32; 3], c: [f32; 3]) {
        self.triangles
            .push([a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]]);
    }
    fn quad(&mut self, a: [f32; 3], b: [f32; 3], c: [f32; 3], d: [f32; 3]) {
        self.tri(a, b, c);
        self.tri(a, c, d);
    }
    fn cuboid(&mut self, lo: [f32; 3], hi: [f32; 3]) {
        let [x, y, z] = lo;
        let [u, v, w] = hi;
        self.quad([x, y, z], [x, y, w], [x, v, w], [x, v, z]);
        self.quad([u, y, w], [u, y, z], [u, v, z], [u, v, w]);
        self.quad([x, y, z], [u, y, z], [u, y, w], [x, y, w]);
        self.quad([x, v, w], [u, v, w], [u, v, z], [x, v, z]);
        self.quad([u, y, z], [x, y, z], [x, v, z], [u, v, z]);
        self.quad([x, y, w], [u, y, w], [u, v, w], [x, v, w]);
    }
}
#[derive(Clone, Debug)]
struct Geometry {
    id: String,
    hash: String,
    parts: Vec<Part>,
    length: f64,
    max_speed: f64,
    health: f64,
    gun_pivot: Point,
}
#[derive(Clone, Debug)]
struct Vessel {
    view: VesselView,
    route: Vec<[f64; 2]>,
    waypoint: usize,
    speed: f64,
    cruise: f64,
    cooldown: f64,
    shell_id: String,
}
#[derive(Clone, Debug)]
pub struct NavalWorld {
    units: BTreeMap<u64, Vessel>,
    geometries: Arc<BTreeMap<String, Geometry>>,
    accumulator: f64,
}
impl NavalWorld {
    pub fn new(config: &NavalConfig, battle: u64, next_unit: &mut u64) -> Result<Self, String> {
        let geometries = Arc::new(build_geometries());
        if config.vessels.len() > 64 {
            return Err("too many naval vessels".into());
        }
        let mut ids = BTreeSet::new();
        // Validate the whole authored document before consuming any accepted IDs.
        for s in &config.vessels {
            if s.id.is_empty() || !ids.insert(s.id.clone()) {
                return Err("empty or duplicate naval vessel id".into());
            }
            if !geometries.contains_key(&s.model) {
                return Err(format!("unknown naval model {}", s.model));
            }
            if s.team > 1 || !["transport", "escort", "interceptor"].contains(&s.role.as_str()) {
                return Err("invalid naval team or role".into());
            }
            if !valid_point(s.pos)
                || !s.yaw.is_finite()
                || !s.speed_mps.is_finite()
                || !(0.0..=25.0).contains(&s.speed_mps)
                || s.route.len() > 256
                || s.route
                    .iter()
                    .any(|p| p.iter().any(|v| !v.is_finite() || v.abs() > 1.0e7))
            {
                return Err("invalid naval route or motion values".into());
            }
            if s.shell_id != "he_76_m42a1" || s.ammo > 10000 {
                return Err("unregistered naval shell or ammo count".into());
            }
        }
        next_unit
            .checked_add(config.vessels.len() as u64)
            .ok_or("naval unit id overflow")?;
        let mut specs: Vec<_> = config.vessels.iter().collect();
        specs.sort_by(|a, b| a.id.cmp(&b.id));
        let mut units = BTreeMap::new();
        for s in specs {
            let g = &geometries[&s.model];
            let unit = UnitRef {
                battle,
                unit: *next_unit,
                life: 1,
            };
            *next_unit += 1;
            let view = VesselView {
                id: s.id.clone(),
                unit,
                team: s.team,
                role: s.role.clone(),
                model: s.model.clone(),
                pos: s.pos,
                yaw: wrap(s.yaw),
                velocity: [0.0; 3],
                alive: true,
                health: g.health,
                max_health: g.health,
                ammo: s.ammo,
                ammo_revision: 0,
                unloading_s: 0.0,
                gun_yaw: 0.0,
                gun_pitch: 0.0,
                geometry_id: g.id.clone(),
                geometry_hash: g.hash.clone(),
                geometry_revision: 1,
                pose_revision: 1,
            };
            units.insert(
                unit.unit,
                Vessel {
                    view,
                    route: s.route.clone(),
                    waypoint: 0,
                    speed: 0.0,
                    cruise: s.speed_mps.min(g.max_speed),
                    cooldown: 0.0,
                    shell_id: s.shell_id.clone(),
                },
            );
        }
        Ok(Self {
            units,
            geometries,
            accumulator: 0.0,
        })
    }
    pub fn views(&self) -> Vec<VesselView> {
        self.units.values().map(|u| u.view.clone()).collect()
    }
    pub fn geometry_catalog(&self) -> Vec<Value> {
        self.geometries
            .values()
            .map(|g| {
                json!({"id":g.id,"hash":g.hash,"geometry_revision":1,
            "source":"authored_procedural_naval_v1","coordinate_type":"float32","forward":"+Z",
            "gun_rotation_order":"pitch_then_yaw_about_pivot_then_body_yaw","parts":g.parts})
            })
            .collect()
    }
    pub fn first_contact(
        &self,
        a: Point,
        b: Point,
        exclude_id: Option<u64>,
    ) -> Option<NavalContact> {
        first_contact_scene(
            self.units.values().map(|u| &u.view),
            &self.geometries,
            a,
            b,
            exclude_id,
        )
    }
    pub fn impact(
        &mut self,
        contact: &NavalContact,
        shell: &ProjectileDef,
        velocity: Point,
        shooter_team: u8,
        friendly_damage: bool,
    ) -> bool {
        let Some(u) = self.units.get(&contact.unit.unit) else {
            return false;
        };
        if !u.view.alive
            || u.view.unit != contact.unit
            || (!friendly_damage && u.view.team == shooter_team)
            || !valid_point(velocity)
            || !shell.mass_kg.is_finite()
            || shell.mass_kg < 0.0
            || !shell.explosive_mass_kg.is_finite()
            || shell.explosive_mass_kg < 0.0
        {
            return false;
        }
        let g = &self.geometries[&u.view.model];
        if contact.geometry_hash != g.hash
            || contact.geometry_revision != 1
            || contact.pose_revision != u.view.pose_revision
            || !contact.fraction.is_finite()
            || !(0.0..=1.0).contains(&contact.fraction)
        {
            return false;
        }
        let Some(p) = g.parts.iter().find(|p| p.id == contact.part_id) else {
            return false;
        };
        if contact.triangle_index >= p.triangles.len()
            || !ray::finite(contact.barycentric)
            || contact
                .barycentric
                .iter()
                .any(|x| *x < -1e-8 || *x > 1.0 + 1e-8)
            || (contact.barycentric.iter().sum::<f64>() - 1.0).abs() > 1e-7
        {
            return false;
        }
        let tri = p.triangle(contact.triangle_index);
        let local =
            std::array::from_fn(|i| (0..3).map(|j| tri[j][i] * contact.barycentric[j]).sum());
        let exact = part_world(&u.view, p, local);
        if !ray::finite(contact.pos) || dot(sub(exact, contact.pos), sub(exact, contact.pos)) > 1e-8
        {
            return false;
        }
        let relative = sub(velocity, u.view.velocity);
        let energy = 0.5 * shell.mass_kg as f64 * dot(relative, relative);
        let strength = match p.role.as_str() {
            "bridge" => 0.55,
            "gun" => 0.3,
            _ => 1.0,
        };
        let immediate_tnt = if matches!(shell.kind, ProjectileKind::He | ProjectileKind::Hesh) {
            shell.tnt_equivalent_kg() as f64
        } else {
            0.0
        };
        let amount = (energy / 200_000.0 + immediate_tnt * 8.0) * strength;
        self.apply_damage(contact.unit.unit, amount)
    }
    /// Blast coupling samples actual emitted surface triangles. Each sample is
    /// admitted only when its finite ray reaches that vessel first. All exposure
    /// is measured before applying damage, so a newly sunk shield still blocks
    /// this same detonation. No sphere overlap is treated as a contact or kill.
    pub fn blast(
        &mut self,
        at: Point,
        tnt_kg: f64,
        shooter_team: u8,
        friendly_damage: bool,
        exclude: Option<u64>,
    ) -> Vec<u64> {
        self.blast_with_los(
            at,
            tnt_kg,
            shooter_team,
            friendly_damage,
            exclude,
            |_, _| true,
        )
    }
    pub fn blast_with_los(
        &mut self,
        at: Point,
        tnt_kg: f64,
        shooter_team: u8,
        friendly_damage: bool,
        exclude: Option<u64>,
        mut can_see: impl FnMut(Point, Point) -> bool,
    ) -> Vec<u64> {
        if !valid_point(at) || !tnt_kg.is_finite() || tnt_kg <= 0.0 {
            return vec![];
        }
        let mut pending = vec![];
        let radius = tnt_kg.cbrt() * 18.0;
        for u in self.units.values().filter(|u| {
            u.view.alive
                && exclude != Some(u.view.unit.unit)
                && (friendly_damage || u.view.team != shooter_team)
        }) {
            let v = &u.view;
            let g = &self.geometries[&v.model];
            if dot(sub(v.pos, at), sub(v.pos, at)).sqrt() > radius + g.length {
                continue;
            }
            let mut coupling = 0.0;
            for p in &g.parts {
                for i in 0..p.triangles.len() {
                    let t = p.triangle(i).map(|pnt| part_world(v, p, pnt));
                    let center = std::array::from_fn(|j| (t[0][j] + t[1][j] + t[2][j]) / 3.0);
                    let delta = sub(center, at);
                    let d = dot(delta, delta).sqrt();
                    if d > radius {
                        continue;
                    }
                    let end = std::array::from_fn(|j| center[j] + delta[j] * 1e-6);
                    if !self.first_contact(at, end, None).is_some_and(|c| {
                        c.unit == v.unit && c.part_id == p.id && c.triangle_index == i
                    }) {
                        continue;
                    }
                    if !can_see(at, center) {
                        continue;
                    }
                    let n = cross(sub(t[1], t[0]), sub(t[2], t[0]));
                    let area = dot(n, n).sqrt() * 0.5;
                    let facing = dot(normalize(n), normalize(delta)).abs();
                    coupling += area * facing / (4.0 * std::f64::consts::PI * d.max(0.25).powi(2));
                }
            }
            let amount = tnt_kg * 8.0 * coupling.min(1.0);
            if amount > 1e-8 {
                pending.push((v.unit.unit, amount));
            }
        }
        pending
            .into_iter()
            .filter_map(|(id, d)| self.apply_damage(id, d).then_some(id))
            .collect()
    }
    fn apply_damage(&mut self, id: u64, amount: f64) -> bool {
        if !amount.is_finite() || amount <= 1e-8 {
            return false;
        }
        let Some(u) = self.units.get_mut(&id) else {
            return false;
        };
        if !u.view.alive {
            return false;
        }
        u.view.health = (u.view.health - amount).max(0.0);
        if u.view.health == 0.0 {
            u.view.alive = false;
            u.view.velocity = [0.0; 3];
            u.speed = 0.0;
        }
        true
    }
    pub fn step(
        &mut self,
        dt: f64,
        mut can_see: impl FnMut(u64, u64, Point, Point) -> bool,
    ) -> Vec<NavalShot> {
        if !dt.is_finite() || dt <= 0.0 || dt > 1.0 {
            return vec![];
        }
        self.accumulator += dt;
        let mut shots = vec![];
        while self.accumulator + 1e-12 >= FIXED_DT {
            self.accumulator = (self.accumulator - FIXED_DT).max(0.0);
            let traffic: Vec<_> = self
                .units
                .values()
                .filter(|u| u.view.alive)
                .map(|u| {
                    (
                        u.view.unit.unit,
                        u.view.pos,
                        u.view.velocity,
                        self.geometries[&u.view.model].length * 0.53 + 2.0,
                    )
                })
                .collect();
            for u in self.units.values_mut().filter(|u| u.view.alive) {
                move_vessel(
                    u,
                    &traffic,
                    self.geometries[&u.view.model].length * 0.53 + 2.0,
                );
            }
            // Snapshot after all movement; target choice cannot depend on update order.
            let targets: Vec<_> = self
                .units
                .values()
                .filter(|u| u.view.alive)
                .map(|u| u.view.clone())
                .collect();
            for u in self.units.values_mut().filter(|u| u.view.alive) {
                let v = &mut u.view;
                u.cooldown = (u.cooldown - FIXED_DT).max(0.0);
                if v.ammo == 0 {
                    continue;
                }
                let g = &self.geometries[&v.model];
                let muzzle_point = muzzle(v, g);
                let target = targets
                    .iter()
                    .filter(|t| t.team != v.team)
                    .filter_map(|t| {
                        let target = [t.pos[0], t.pos[1] + 0.8, t.pos[2]];
                        let d = dot(sub(target, muzzle_point), sub(target, muzzle_point));
                        (d <= MAX_RANGE * MAX_RANGE
                            && can_see(v.unit.unit, t.unit.unit, muzzle_point, target)
                            && first_contact_scene(
                                targets.iter(),
                                &self.geometries,
                                muzzle_point,
                                target,
                                Some(v.unit.unit),
                            )
                            .is_some_and(|c| c.unit == t.unit))
                        .then_some((d, t, target))
                    })
                    .min_by(|a, b| a.0.total_cmp(&b.0).then(a.1.unit.cmp(&b.1.unit)));
                let Some((d, target, point)) = target else {
                    continue;
                };
                let time = d.sqrt() / MUZZLE_SPEED;
                let aim = std::array::from_fn(|i| {
                    point[i]
                        + target.velocity[i] * time
                        + if i == 1 {
                            0.5 * 9.80665 * time * time
                        } else {
                            0.0
                        }
                });
                let delta = rotate_y(sub(aim, muzzle_point), -v.yaw);
                let desired_yaw = delta[0].atan2(delta[2]);
                let desired_pitch = delta[1].atan2(delta[0].hypot(delta[2])).clamp(-0.2, 0.7);
                let old = [v.gun_yaw, v.gun_pitch];
                v.gun_yaw = wrap(
                    v.gun_yaw
                        + wrap(desired_yaw - v.gun_yaw)
                            .clamp(-GUN_RATE * FIXED_DT, GUN_RATE * FIXED_DT),
                );
                v.gun_pitch +=
                    (desired_pitch - v.gun_pitch).clamp(-GUN_RATE * FIXED_DT, GUN_RATE * FIXED_DT);
                if old != [v.gun_yaw, v.gun_pitch] {
                    v.pose_revision += 1;
                }
                if u.cooldown > 1e-9
                    || wrap(desired_yaw - v.gun_yaw).abs() > 0.02
                    || (desired_pitch - v.gun_pitch).abs() > 0.02
                {
                    continue;
                }
                v.ammo -= 1;
                v.ammo_revision += 1;
                u.cooldown = COOLDOWN;
                let dir = rotate_y(
                    rotate_pitch([0.0, 0.0, 1.0], v.gun_pitch),
                    v.yaw + v.gun_yaw,
                );
                shots.push(NavalShot {
                    shooter: v.unit,
                    target: target.unit,
                    team: v.team,
                    shell_id: u.shell_id.clone(),
                    pos: muzzle(v, g),
                    velocity: std::array::from_fn(|i| dir[i] * MUZZLE_SPEED + v.velocity[i]),
                    ammo_revision: v.ammo_revision,
                });
            }
        }
        shots
    }
}
fn first_contact_scene<'a>(
    views: impl Iterator<Item = &'a VesselView>,
    geometries: &BTreeMap<String, Geometry>,
    a: Point,
    b: Point,
    exclude_id: Option<u64>,
) -> Option<NavalContact> {
    if !valid_point(a) || !valid_point(b) {
        return None;
    }
    let mut best: Option<NavalContact> = None;
    for v in views.filter(|v| v.alive && exclude_id != Some(v.unit.unit)) {
        let g = &geometries[&v.model];
        // A sphere is only candidate rejection; every accepted contact below
        // is a finite intersection with the exact serialized f32 triangle.
        if segment_distance_sq(a, b, v.pos) > (g.length * 0.65 + 10.0).powi(2) {
            continue;
        }
        for p in &g.parts {
            let lo = part_local(v, p, a);
            let hi = part_local(v, p, b);
            for i in 0..p.triangles.len() {
                let t = p.triangle(i);
                let Some(c) = ray::triangle(lo, hi, t).ok().flatten() else {
                    continue;
                };
                if best.as_ref().is_some_and(|old| c.t >= old.fraction) {
                    continue;
                }
                let n = normalize(cross(sub(t[1], t[0]), sub(t[2], t[0])));
                let mut n = part_direction(v, p, n);
                if dot(n, sub(b, a)) > 0.0 {
                    n = n.map(|x| -x);
                }
                best = Some(NavalContact {
                    unit: v.unit,
                    team: v.team,
                    fraction: c.t,
                    pos: ray::point_at(a, b, c.t),
                    normal: n,
                    barycentric: c.barycentric,
                    part_id: p.id.clone(),
                    triangle_index: i,
                    geometry_hash: g.hash.clone(),
                    geometry_revision: 1,
                    pose_revision: v.pose_revision,
                });
            }
        }
    }
    best
}
fn move_vessel(u: &mut Vessel, traffic: &[(u64, Point, Point, f64)], radius: f64) {
    let old = (u.view.pos, u.view.yaw);
    let p = u.view.pos;
    while u.waypoint < u.route.len() {
        let target = u.route[u.waypoint];
        let d = (target[0] - p[0]).hypot(target[1] - p[2]);
        if d <= 0.2 && (u.waypoint + 1 < u.route.len() || u.speed <= ACCEL * FIXED_DT) {
            u.waypoint += 1;
        } else {
            break;
        }
    }
    let mut desired_speed = 0.0;
    if let Some(target) = u.route.get(u.waypoint) {
        let dx = target[0] - p[0];
        let dz = target[1] - p[2];
        let d = dx.hypot(dz);
        let turn = wrap(dx.atan2(dz) - u.view.yaw);
        u.view.yaw = wrap(u.view.yaw + turn.clamp(-TURN_RATE * FIXED_DT, TURN_RATE * FIXED_DT));
        desired_speed =
            u.cruise.min((2.0 * ACCEL * (d - 0.1).max(0.0)).sqrt()) * turn.cos().max(0.0);
    }
    desired_speed = desired_speed.min(traffic_speed_cap(&u.view, radius, traffic));
    u.speed += (desired_speed - u.speed).clamp(-ACCEL * FIXED_DT, ACCEL * FIXED_DT);
    let (s, c) = u.view.yaw.sin_cos();
    u.view.velocity = [s * u.speed, 0.0, c * u.speed];
    u.view.pos[0] += u.view.velocity[0] * FIXED_DT;
    u.view.pos[2] += u.view.velocity[2] * FIXED_DT;
    if old != (u.view.pos, u.view.yaw) {
        u.view.pose_revision += 1;
    }
}
// Navigation uses conservative horizontal clearance disks, never for damage.
// A following ship retains sufficient distance to brake at the same bounded
// deceleration as the ship ahead. Opposing ships share the stopping distance.
// Every limit is computed from the same pre-movement sample, independent of IDs.
fn traffic_speed_cap(v: &VesselView, radius: f64, traffic: &[(u64, Point, Point, f64)]) -> f64 {
    let (s, c) = v.yaw.sin_cos();
    let forward = [s, 0.0, c];
    let mut limit = f64::INFINITY;
    for &(id, pos, velocity, other_radius) in traffic {
        if id == v.unit.unit {
            continue;
        }
        let delta = sub(pos, v.pos);
        let along = dot(delta, forward);
        if along <= 0.0 {
            continue;
        }
        let lateral = (delta[0] * c - delta[2] * s).abs();
        let clearance = radius + other_radius;
        if lateral >= clearance {
            continue;
        }
        let gap = (along - (clearance * clearance - lateral * lateral).sqrt() - 0.25).max(0.0);
        let ahead_speed = dot(velocity, forward);
        let allowed = if ahead_speed < 0.0 {
            (ACCEL * gap).sqrt()
        } else {
            (ahead_speed * ahead_speed + 2.0 * ACCEL * gap).sqrt()
        };
        limit = limit.min(allowed);
    }
    limit
}
fn valid_point(p: Point) -> bool {
    p.iter().all(|v| v.is_finite() && v.abs() <= 1.0e7)
}
fn wrap(a: f64) -> f64 {
    (a + std::f64::consts::PI).rem_euclid(std::f64::consts::TAU) - std::f64::consts::PI
}
fn normalize(a: Point) -> Point {
    let l = dot(a, a).sqrt();
    if l > 0.0 {
        a.map(|v| v / l)
    } else {
        [0.0; 3]
    }
}
fn rotate_y(p: Point, a: f64) -> Point {
    let (s, c) = a.sin_cos();
    [c * p[0] + s * p[2], p[1], -s * p[0] + c * p[2]]
}
fn rotate_pitch(p: Point, a: f64) -> Point {
    let (s, c) = a.sin_cos();
    [p[0], c * p[1] + s * p[2], -s * p[1] + c * p[2]]
}
fn part_direction(v: &VesselView, p: &Part, local: Point) -> Point {
    let d = if p.pose_group == "gun" {
        rotate_y(rotate_pitch(local, v.gun_pitch), v.gun_yaw)
    } else {
        local
    };
    rotate_y(d, v.yaw)
}
fn part_world(v: &VesselView, p: &Part, local: Point) -> Point {
    let pivot = p.pivot.map(|x| x as f64);
    let body = if p.pose_group == "gun" {
        let d = rotate_y(rotate_pitch(sub(local, pivot), v.gun_pitch), v.gun_yaw);
        std::array::from_fn(|i| pivot[i] + d[i])
    } else {
        local
    };
    let d = rotate_y(body, v.yaw);
    std::array::from_fn(|i| v.pos[i] + d[i])
}
fn part_local(v: &VesselView, p: &Part, world: Point) -> Point {
    let body = rotate_y(sub(world, v.pos), -v.yaw);
    if p.pose_group == "gun" {
        let pivot = p.pivot.map(|x| x as f64);
        let d = rotate_pitch(rotate_y(sub(body, pivot), -v.gun_yaw), -v.gun_pitch);
        std::array::from_fn(|i| pivot[i] + d[i])
    } else {
        body
    }
}
fn muzzle(v: &VesselView, g: &Geometry) -> Point {
    let d = rotate_y(rotate_pitch([0.0, 0.0, 3.5], v.gun_pitch), v.gun_yaw);
    let p = rotate_y(std::array::from_fn(|i| g.gun_pivot[i] + d[i]), v.yaw);
    std::array::from_fn(|i| v.pos[i] + p[i])
}
fn segment_distance_sq(a: Point, b: Point, p: Point) -> f64 {
    let d = sub(b, a);
    let l = dot(d, d);
    let t = if l > 0.0 { dot(sub(p, a), d) / l } else { 0.0 };
    let q = ray::point_at(a, b, t.clamp(0.0, 1.0));
    dot(sub(p, q), sub(p, q))
}
fn build_geometries() -> BTreeMap<String, Geometry> {
    [
        ("generic_transport", 36.0, 9.0, 100.0, 8.0),
        ("generic_escort", 28.0, 6.0, 75.0, 12.0),
        ("generic_interceptor", 18.0, 4.0, 50.0, 18.0),
    ]
    .into_iter()
    .map(|(id, l, w, h, s)| {
        let g = build_geometry(id, l, w, h, s);
        (id.into(), g)
    })
    .collect()
}
fn build_geometry(id: &str, length: f32, width: f32, health: f64, max_speed: f64) -> Geometry {
    let w = width * 0.5;
    let aft = -length * 0.5;
    let shoulder = length * 0.3;
    let bow = length * 0.5;
    let top = 1.7;
    let bottom = -2.0;
    let ring = [
        [-w, aft],
        [w, aft],
        [w, shoulder],
        [0.0, bow],
        [-w, shoulder],
    ];
    let lower = ring.map(|p| [p[0] * 0.68, p[1] * 0.95]);
    let mut hull = Part::new("hull", "hull", [0.22, 0.28, 0.28], [0.0; 3], false);
    for i in 0..5 {
        let j = (i + 1) % 5;
        hull.quad(
            [ring[i][0], top, ring[i][1]],
            [lower[i][0], bottom, lower[i][1]],
            [lower[j][0], bottom, lower[j][1]],
            [ring[j][0], top, ring[j][1]],
        );
        hull.tri(
            [0.0, bottom, 0.0],
            [lower[j][0], bottom, lower[j][1]],
            [lower[i][0], bottom, lower[i][1]],
        );
    }
    let mut deck = Part::new("deck", "deck", [0.36, 0.37, 0.33], [0.0; 3], false);
    let hatch = if id == "generic_transport" { 0.95 } else { 0.6 };
    for (x0, x1, z0, z1) in [
        (-w, -hatch, aft, shoulder),
        (hatch, w, aft, shoulder),
        (-hatch, hatch, aft, -1.8),
        (-hatch, hatch, 1.8, shoulder),
    ] {
        deck.quad([x0, top, z0], [x1, top, z0], [x1, top, z1], [x0, top, z1]);
    }
    deck.tri([-w, top, shoulder], [w, top, shoulder], [0.0, top, bow]);
    let scale = width / 9.0;
    let bw = (2.5 * scale).max(1.2);
    let bz = -length * 0.2;
    let base = 5.0 * scale.max(0.65);
    let window = base + 1.0 * scale.max(0.65);
    let bridge_half = 3.0 * scale;
    let front = bz + bridge_half;
    let back = bz - bridge_half;
    let mut bridge = Part::new("bridge", "bridge", [0.48, 0.51, 0.48], [0.0; 3], false);
    bridge.cuboid([-bw, top, back], [bw, base, front]);
    bridge.cuboid([-bw, window, back], [bw, window + 0.45, front]);
    bridge.cuboid([-bw, base, back], [bw, window, back + 0.15]);
    bridge.cuboid([-bw, base, back], [-bw + 0.15, window, front]);
    bridge.cuboid([bw - 0.15, base, back], [bw, window, front]);
    bridge.cuboid([-bw, base, front - 0.15], [-0.85 * scale, window, front]);
    bridge.cuboid([0.85 * scale, base, front - 0.15], [bw, window, front]);
    let pivot = [0.0, 2.35, length * 0.20];
    let mut gun = Part::new("gun_mount", "gun", [0.35, 0.4, 0.37], pivot, true);
    gun.cuboid([-0.6, 1.7, pivot[2] - 0.65], [0.6, 2.8, pivot[2] + 0.65]);
    let mut barrel = Part::new("gun_barrel", "gun", [0.22, 0.25, 0.24], pivot, true);
    for i in 0..8 {
        let a = i as f32 * std::f32::consts::TAU / 8.0;
        let b = (i + 1) as f32 * std::f32::consts::TAU / 8.0;
        let at = |angle: f32, r: f32, z: f32| {
            [angle.cos() * r, pivot[1] + angle.sin() * r, pivot[2] + z]
        };
        barrel.quad(
            at(a, 0.16, 0.5),
            at(b, 0.16, 0.5),
            at(b, 0.16, 3.5),
            at(a, 0.16, 3.5),
        );
        barrel.quad(
            at(a, 0.09, 3.5),
            at(b, 0.09, 3.5),
            at(b, 0.09, 0.5),
            at(a, 0.09, 0.5),
        );
        barrel.quad(
            at(a, 0.16, 3.5),
            at(b, 0.16, 3.5),
            at(b, 0.09, 3.5),
            at(a, 0.09, 3.5),
        );
    }
    for part in [&mut hull, &mut deck] {
        for t in &mut part.triangles {
            for j in 0..3 {
                t.swap(3 + j, 6 + j);
            }
        }
    }
    let mut parts = vec![hull, deck, bridge, gun, barrel];
    if id == "generic_transport" {
        let mut cargo = Part::new("cargo_crates", "cargo", [0.43, 0.38, 0.29], [0.0; 3], false);
        for side in [-1.0, 1.0] {
            cargo.cuboid([side * 2.8 - 0.6, top, -0.8], [side * 2.8 + 0.6, 3.0, 2.0]);
        }
        parts.push(cargo);
    }
    if id == "generic_escort" {
        let mut mast = Part::new("mast", "fitting", [0.36, 0.4, 0.39], [0.0; 3], false);
        mast.cuboid(
            [-0.12, window + 0.45, bz - 0.12],
            [0.12, window + 3.0, bz + 0.12],
        );
        parts.push(mast);
    }
    let hash = sha256(
        &serde_json::to_vec(&json!({"id":id,"parts":parts}))
            .expect("finite authored naval geometry"),
    );
    Geometry {
        id: id.into(),
        hash,
        parts,
        length: length as f64,
        max_speed,
        health,
        gun_pivot: pivot.map(|x| x as f64),
    }
}

#[cfg(test)]
#[path = "frontline_naval_tests.rs"]
mod tests;
