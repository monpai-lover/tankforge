//! TerrainContactSystem: what the tank model needs from the ground ([`Ground`]: height and
//! surface at a world point), the ground rows sampled under both tracks (one row per side, every
//! 0.1 m in the hull frame), and the rigid contacts: where the ground reaches the runs of track
//! rising to the sprocket and idler, or the hull's belly, it pushes back (penalty forces that only
//! push, capped so a buried hull is lifted out, not launched).
//! (client/web/src/sim/tank/contacts.js mirrors this file and track_contact.rs.)
use super::math::*;
use super::running_gear_dynamics::{ResponsePair, WheelBlend};
use super::rigid_body::VehicleRigidBody;
use super::road_wheel::{si, GearGeometry, GroundProfile};
use super::suspension::{SuspensionState, SuspensionSystem};
use super::track_contact::{Contact, Grip};
use crate::TerrainDef;

/// In units of one station's spring rate: the idler and the run of track to it are nearly rigid.
const RUN_K: f64 = 6.0;
const RUN_C: f64 = 4.0;
const BELLY_K: f64 = 25.0;
pub const BELLY_MU: f64 = 0.45;

/// The ground under the tank: world height (ruts and all) and what it is made of.
pub trait Ground {
    fn height(&self, x: f64, z: f64) -> f64;
    fn surface(&self, x: f64, z: f64) -> &TerrainDef;
    /// A known height (e.g. a water plane for flight) need not support a tank.
    /// Existing grounds retain exactly their original height/contact behavior.
    fn has_support(&self, _x: f64, _z: f64) -> bool { true }
    fn support_height(&self, x: f64, z: f64) -> Option<f64> {
        if self.has_support(x, z) { Some(self.height(x, z)) } else { None }
    }
}

/// Ground made of a height function and one surface (tests, tools).
pub struct FnGround<'a, F: Fn(f64, f64) -> f64> {
    pub height: F,
    pub surface: &'a TerrainDef,
}

impl<F: Fn(f64, f64) -> f64> Ground for FnGround<'_, F> {
    fn height(&self, x: f64, z: f64) -> f64 {
        (self.height)(x, z)
    }
    fn surface(&self, _x: f64, _z: f64) -> &TerrainDef {
        self.surface
    }
}

/// The wheel the track wraps at one end: centre z, radius, height of the track's run there above
/// the static ground line.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct EndWheel {
    pub z: f64,
    pub r: f64,
    pub h: f64,
}

#[derive(Clone, Debug)]
pub struct ContactGeometry {
    /// Ground rows: hull-frame z (rear to front) and the track's height above the ground line.
    pub zs: Vec<f64>,
    pub run: Vec<f64>,
    /// Static track bottom, hull frame y.
    pub ground: f64,
    pub front: EndWheel,
    pub rear: EndWheel,
    /// Hull-frame z of the friction contact samples of each track (8..16 per side).
    pub cz: Vec<f64>,
    pub contact_length: f64,
    pub track_width: f64,
    pub track_x: f64,
    pub station_count: usize,
    /// Points on the hull floor between the tracks.
    pub belly: Vec<V3>,
    pub run_k: f64,
    pub run_c: f64,
    pub belly_k: f64,
    pub belly_c: f64,
}

#[derive(Clone, Debug)]
pub struct ContactState {
    /// Ground rows [left, right].
    pub prof: [GroundProfile; 2],
    pub run_prev: [Vec<f64>; 2],
    pub belly_prev: Vec<f64>,
    /// Total belly load, N.
    pub belly: f64,
    pub response_pool: Vec<ResponsePair>,
}

impl ContactGeometry {
    pub fn new(gear: &GearGeometry, sp: &SuspensionSystem, belly_y: f64, contacts_per_side: usize) -> Self {
        let st = &gear.stations;
        let per = st.len();
        let fw = st[0];
        let rw = st[per - 1];
        let ground = st.iter().map(|s| s.y - s.r).fold(f64::INFINITY, f64::min) - gear.thickness;
        let end = |c: &super::road_wheel::Wheel| EndWheel { z: c.z, r: c.r, h: (c.y - c.r - gear.thickness / 2.0 - ground).max(0.02) };
        let sprocket_front = gear.sprocket.z > gear.idler.z;
        let front = end(if sprocket_front { &gear.sprocket } else { &gear.idler });
        let rear = end(if sprocket_front { &gear.idler } else { &gear.sprocket });
        let z0 = rear.z - rear.r * 0.8;
        let z1 = front.z + front.r * 0.8;
        let count = (((z1 - z0) / 0.1).ceil() as usize + 1).max(8);
        let run_at = |z: f64, wheel: &super::road_wheel::Wheel, e: &EndWheel, dir: f64| -> f64 {
            let start = wheel.z + dir * wheel.r * 0.35;
            if (z - start) * dir <= 0.0 {
                return -1.0;
            }
            let d = (e.z - z) * dir;
            if d >= 0.0 {
                return e.h * (z - start) / (e.z - start);
            }
            let q = (-d).min(e.r * 0.95);
            e.h + e.r - (e.r * e.r - q * q).sqrt()
        };
        let mut zs = vec![0.0; count];
        let mut run = vec![-1.0; count];
        for i in 0..count {
            let z = z0 + (z1 - z0) * i as f64 / (count - 1) as f64;
            zs[i] = z;
            if z > fw.z {
                run[i] = run_at(z, &fw, &front, 1.0);
            } else if z < rw.z {
                run[i] = run_at(z, &rw, &rear, -1.0);
            }
        }
        let nc = contacts_per_side.clamp(8, 16);
        let cz = (0..nc).map(|i| rw.z + (fw.z - rw.z) * (i as f64 + 0.5) / nc as f64).collect();
        // belly: a grid between the tracks, on the hull floor
        let inner = (gear.track_x - gear.track_width / 2.0 - 0.05).max(0.2);
        let mut belly = Vec::new();
        for x in [-inner, 0.0, inner] {
            for i in 0..5 {
                belly.push([x, belly_y, rw.z + (fw.z - rw.z) * i as f64 / 4.0]);
            }
        }
        let run_samples = (run.iter().filter(|h| **h >= 0.0).count() as f64 / 2.0).max(1.0);
        let share = (6.0 / run_samples).min(1.0);
        Self {
            zs,
            run,
            ground,
            front,
            rear,
            cz,
            contact_length: fw.z - rw.z + (fw.r + rw.r) * 0.5,
            track_width: gear.track_width,
            track_x: gear.track_x,
            station_count: gear.stations.len() * 2,
            belly,
            run_k: RUN_K * sp.k * share,
            run_c: RUN_C * sp.c * share,
            belly_k: BELLY_K * sp.k,
            belly_c: 4.0 * sp.c,
        }
    }

    pub fn new_state(&self) -> ContactState {
        let n = self.zs.len();
        let row = || GroundProfile { zs: self.zs.clone(), run: self.run.clone(), h: vec![0.0; n], pts: vec![[0.0; 3]; n], supported: vec![true; n] };
        ContactState { prof: [row(), row()], run_prev: [vec![0.0; n], vec![0.0; n]], belly_prev: vec![0.0; self.belly.len()], belly: 0.0, response_pool: (0..2 * self.cz.len() + 2 * self.zs.len() + self.belly.len()).map(|_| ResponsePair::new(self.station_count)).collect() }
    }

    /// Samples the ground under both tracks.
    pub fn sample_ground(&self, cs: &mut ContactState, body: &VehicleRigidBody, terrain: &dyn Ground) {
        for side in [1i8, -1] {
            let prof = &mut cs.prof[si(side)];
            let x = side as f64 * self.track_x;
            for k in 0..self.zs.len() {
                let h = if self.run[k] >= 0.0 { self.ground + self.run[k] } else { self.ground };
                let p = body.world_point([x, h, self.zs[k]]);
                prof.pts[k] = p;
                let support = terrain.support_height(p[0], p[2]);
                prof.supported[k] = support.is_some();
                prof.h[k] = support.unwrap_or(0.0);
            }
        }
    }

    /// Ground normal under `side` at hull-frame z, from the two ground rows.
    pub fn ground_normal(&self, cs: &ContactState, body: &VehicleRigidBody, side: i8, z: f64) -> V3 {
        let a = &cs.prof[si(side)];
        let o = &cs.prof[si(-side)];
        let zs = &self.zs;
        let mut k = 1;
        while k < zs.len() - 2 && zs[k] < z {
            k += 1;
        }
        let along = a.along_slope(k);
        let across = if a.supported_at(k) && o.supported_at(k) { (if side > 0 { a.h[k] - o.h[k] } else { o.h[k] - a.h[k] }) / (2.0 * self.track_x) } else { 0.0 };
        // horizontal forward / right of the hull
        let f = norm([body.ez[0], 0.0, body.ez[2]]);
        let r = [f[2], 0.0, -f[0]];
        norm([-along * f[0] - across * r[0], 1.0, -along * f[2] - across * r[2]])
    }

    /// Soft implicit normal impulses using current contact velocity and the coupled mass operator.
    pub fn apply_rigid_contacts(&self, cs: &mut ContactState, body: &mut VehicleRigidBody, terrain: &dyn Ground, dt: f64, sp: &SuspensionSystem, ss: &SuspensionState, broken: [bool; 2]) -> Vec<Contact> {
        let mut extra = Vec::new(); let per = sp.per_side();
        for side in [1i8, -1] {
            if broken[si(side)] { cs.run_prev[si(side)].fill(0.0); continue; }
            let base = if side > 0 { 0 } else { per };
            let fw = sp.stations[base]; let rw = sp.stations[base + per - 1];
            for k in 0..self.zs.len() {
                if self.run[k] < 0.0 { continue; }
                let z = self.zs[k]; let front = z > 0.0;
                let (w, e) = if front { (fw, self.front) } else { (rw, self.rear) };
                let u = ((z - w.z) / (e.z - w.z)).clamp(0.0, 1.0);
                let i = if front { base } else { base + per - 1 };
                let blend = WheelBlend::single(i, 1.0 - u);
                let p = body.world_point([side as f64 * self.track_x, self.ground + self.run[k] + ss.comp[i] * (1.0 - u), z]);
                if !cs.prof[si(side)].supported_at(k) || !terrain.has_support(p[0], p[2]) { cs.run_prev[si(side)][k] = 0.0; continue; }
                let pen = cs.prof[si(side)].h[k] - p[1]; cs.run_prev[si(side)][k] = pen;
                let n = self.ground_normal(cs, body, side, z);
                let load = normal_impulse(body, p, n, pen * n[1], self.run_k, self.run_c, self.run_k * 0.3, dt, blend);
                if load > 0.0 {
                    let mut c = Contact::new(p, n, load, side, Grip::of(terrain.surface(p[0], p[2])), None); c.wheels = blend; extra.push(c);
                }
            }
        }
        let mut belly = 0.0;
        for (i, b) in self.belly.iter().enumerate() {
            let p = body.world_point(*b);
            let Some(height) = terrain.support_height(p[0], p[2]) else { cs.belly_prev[i] = 0.0; continue; };
            let pen = height - p[1]; cs.belly_prev[i] = pen;
            let load = normal_impulse(body, p, [0.0, 1.0, 0.0], pen, self.belly_k, self.belly_c, self.belly_k * 0.15, dt, WheelBlend::default());
            belly += load;
            if load > 0.0 { extra.push(Contact::new(p, [0.0, 1.0, 0.0], load, 0, Grip { traction_mu: BELLY_MU, lateral_mu: BELLY_MU, shear_k: None }, None)); }
        }
        cs.belly = belly; extra
    }
}

fn normal_impulse(body: &mut VehicleRigidBody, p: V3, n: V3, pen: f64, k: f64, c: f64, cap: f64, dt: f64, blend: WheelBlend) -> f64 {
    if pen <= 0.0 { return 0.0; }
    let inv = body.coupled_inv_mass_along(n, p, blend); let vn = dot(body.coupled_point_velocity(p, blend), n);
    let j = (dt * (k * pen - (c + dt * k) * vn) / (1.0 + dt * (c + dt * k) * inv)).clamp(0.0, cap * dt);
    body.coupled_apply_impulse_at(scale(n, j), p, blend); j / dt
}

#[cfg(test)]
#[path = "terrain_support_tests.rs"]
mod support_tests;
