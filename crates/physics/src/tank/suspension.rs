//! SuspensionSystem: one spring-damper unit per road-wheel station (or per bogie of two
//! neighbouring wheels). Each unit pushes on the hull along the hull's up axis at its own mount
//! point, so the hull's heave, pitch and roll come out of the sum of the unit forces
//! (AddForceAtPosition), never from the ground's slope directly.
//!
//! Per station: rest position, wheel radius, compression (wheel height against the hull, from
//! static), vertical velocity, contact point, grounded, load. Per unit: spring rate, damping
//! (lighter in compression than in rebound), static preload, a stiff bump stop past full travel
//! and a rebound stop below the static position.
//! (client/web/src/sim/tank/suspension.js mirrors this file.)
use super::math::*;
use super::running_gear_dynamics::WheelBlend;
use super::rigid_body::{VehicleRigidBody, GRAVITY};
use super::road_wheel::{si, support_under, support_under_mode, GearGeometry, GroundProfile, Station};

pub const BOGIE_KINDS: [&str; 3] = ["volute", "hvss", "leaf_bogie"];
const BUMP_STOP: f64 = 30.0;
/// Compression damping is lighter than rebound damping (shares of the data value).
const DAMP_COMPRESSION: f64 = 0.7;
const DAMP_REBOUND: f64 = 1.35;

#[derive(Clone, Debug, Default)]
pub struct SuspensionOpts {
    pub mass: f64,
    /// Centre of mass z in the hull frame (static load distribution).
    pub cg_z: f64,
    pub travel: Option<f64>,
    /// Spring rate (N/m) and damping (N s/m) of one station; 0 = from the ride frequency.
    pub stiffness: f64,
    pub damping: f64,
    pub kind: String,
    pub freq_hz: Option<f64>,
    pub damping_ratio: Option<f64>,
}

/// A springing unit: one station, or a bogie of two neighbours.
#[derive(Clone, Debug)]
pub struct Unit {
    pub members: Vec<usize>,
    /// Hull-frame point the spring pushes at.
    pub mount: V3,
    pub side: i8,
    pub k: f64,
    pub c: f64,
    /// Static load, N.
    pub p: f64,
    /// Bogie arm swing either way (0 for a single wheel).
    pub lim: f64,
    pub heave: WheelBlend,
    pub rock: WheelBlend,
    pub rock_k: f64,
    pub rock_c: f64,
}

#[derive(Clone, Debug)]
pub struct SuspensionSystem {
    /// Right side first, front first on each side.
    pub stations: Vec<Station>,
    pub units: Vec<Unit>,
    /// Spring rate and damping of one station.
    pub k: f64,
    pub c: f64,
    pub freq: f64,
    pub zeta: f64,
    /// Static load of each station of one side, N.
    pub preload: Vec<f64>,
    pub travel: f64,
    pub rebound: f64,
    pub sag: f64,
    /// How far along the track the ground can lift a wheel.
    pub window: f64,
    pub thickness: f64,
}

#[derive(Clone, Debug)]
pub struct SuspensionState {
    /// Wheel height against the hull, from static (+ up = compression).
    pub comp: Vec<f64>,
    pub grounded: Vec<bool>,
    /// World height of the track under each wheel.
    pub support: Vec<f64>,
    /// World point where each wheel's track meets the ground.
    pub contact: Vec<V3>,
    /// N carried by each wheel.
    pub load: Vec<f64>,
    normals: Vec<V3>,
    pub unit_x: Vec<f64>,
    /// Vertical velocity of each unit against the hull (+ compressing).
    pub unit_v: Vec<f64>,
    pub spring: Vec<f64>,
    pub damper: Vec<f64>,
    pub force: Vec<f64>,
    support_available: Vec<bool>,
}

impl SuspensionSystem {
    pub fn new(gear: &GearGeometry, o: &SuspensionOpts) -> Self {
        let per = gear.stations.len();
        let n = (per * 2) as f64;
        let m = o.mass;
        let mut stations = Vec::with_capacity(per * 2);
        for side in [1i8, -1] {
            for s in &gear.stations {
                stations.push(Station { z: s.z, y: s.y, r: s.r, x: side as f64 * gear.track_x, side });
            }
        }
        let tau = 2.0 * std::f64::consts::PI;
        let mut k = o.stiffness;
        let mut c = o.damping;
        if o.freq_hz.is_some() || !(k > 0.0) {
            let k_tot = m * (tau * o.freq_hz.unwrap_or(1.4)).powi(2);
            k = k_tot / n;
            c = 2.0 * o.damping_ratio.unwrap_or(0.35) * (k_tot * m).sqrt() / n;
        }
        // keep the ride in the band real tracked vehicles ride in, whatever the data says
        let freq = ((k * n / m).sqrt() / tau).clamp(0.9, 2.4);
        k = m * (tau * freq).powi(2) / n;
        let zeta_wanted = if c > 0.0 { c * n / (2.0 * (k * n * m).sqrt()) } else { o.damping_ratio.unwrap_or(0.35) };
        let zeta = zeta_wanted.clamp(0.15, 0.7);
        c = 2.0 * zeta * (k * n * m).sqrt() / n;

        // static load of each station: the hull rests level with the centre of gravity where it is
        let zm = gear.stations.iter().map(|s| s.z).sum::<f64>() / per as f64;
        let zz = gear.stations.iter().map(|s| (s.z - zm).powi(2)).sum::<f64>();
        let zz = if zz > 0.0 { zz } else { 1.0 };
        let mean = m * GRAVITY / n;
        let mut preload: Vec<f64> = gear.stations.iter().map(|s| (0.25 * mean).max(mean + mean * per as f64 * (o.cg_z - zm) * (s.z - zm) / zz)).collect();
        let sc = m * GRAVITY / (2.0 * preload.iter().sum::<f64>());
        for p in &mut preload {
            *p *= sc;
        }

        let travel = o.travel.unwrap_or(0.18);
        let sag = mean / k;
        let rebound = sag.min((0.45 * travel).max(0.04));

        let bogie = BOGIE_KINDS.contains(&o.kind.as_str());
        let mut units = Vec::new();
        for side in [1i8, -1] {
            let base = if side > 0 { 0 } else { per };
            let mut i = 0;
            while i < per {
                let pair = bogie && i + 1 < per;
                let members: Vec<usize> = if pair { vec![base + i, base + i + 1] } else { vec![base + i] };
                let cnt = members.len() as f64;
                let mz = members.iter().map(|&j| stations[j].z).sum::<f64>() / cnt;
                let my = members.iter().map(|&j| stations[j].y).sum::<f64>() / cnt;
                units.push(Unit {
                    mount: [side as f64 * gear.track_x, my, mz],
                    side,
                    k: k * cnt,
                    c: c * cnt,
                    p: members.iter().map(|&j| preload[j % per]).sum(),
                    lim: if pair { (0.6 * travel).max(0.06) } else { 0.0 },
                    heave: if pair { WheelBlend::pair(base + i, 0.5, base + i + 1, 0.5) } else { WheelBlend::single(base + i, 1.0) },
                    rock: if pair { WheelBlend::pair(base + i, 0.5, base + i + 1, -0.5) } else { WheelBlend::default() },
                    rock_k: if pair { 0.05 * k * cnt } else { 0.0 },
                    rock_c: if pair { 0.05f64.sqrt() * c * cnt } else { 0.0 },
                    members,
                });
                i += if pair { 2 } else { 1 };
            }
        }
        let fw = gear.stations[0];
        let rw = gear.stations[per - 1];
        let spacing = if per > 1 { (fw.z - rw.z) / (per - 1) as f64 } else { 1.0 };
        Self { stations, units, k, c, freq, zeta, preload, travel, rebound, sag, window: (0.75 * spacing).max(fw.r), thickness: gear.thickness }
    }

    pub fn per_side(&self) -> usize {
        self.stations.len() / 2
    }

    pub fn new_state(&self) -> SuspensionState {
        let n = self.stations.len();
        let u = self.units.len();
        SuspensionState {
            comp: vec![0.0; n],
            grounded: vec![false; n],
            support: vec![0.0; n],
            contact: vec![[0.0; 3]; n],
            load: vec![0.0; n],
            normals: vec![[0.0, 1.0, 0.0]; n],
            unit_x: vec![0.0; u],
            unit_v: vec![0.0; u],
            spring: vec![0.0; u],
            damper: vec![0.0; u],
            force: vec![0.0; u],
            support_available: vec![true; n],
        }
    }

    /// How far station `s` must rise (+) from static to stand on its ground, along the hull's up.
    pub fn wanted(&self, prof: &GroundProfile, body: &VehicleRigidBody, s: &Station) -> Option<(f64, f64)> {
        let up_y = body.ey[1].max(0.2);
        let sup = support_under(self.window, prof, s)?;
        let h = body.world_point([s.x, s.y, s.z])[1];
        Some((sup, (sup + s.r + self.thickness - h) / up_y))
    }

    pub fn sync_pose(&self, st: &mut SuspensionState, body: &VehicleRigidBody, broken: [bool; 2]) {
        let rg = body.running_gear.as_ref().unwrap();
        for (i, s) in self.stations.iter().enumerate() {
            st.comp[i] = rg.q[i];
            let thickness = if broken[si(s.side)] { 0.0 } else { self.thickness };
            st.contact[i] = body.world_point([s.x, s.y + rg.q[i] - s.r - thickness, s.z]);
        }
    }

    fn spring_impulse(&self, st: &mut SuspensionState, body: &mut VehicleRigidBody, u: &Unit, ui: usize, blend: WheelBlend, rock: bool, dt: f64) {
        let rg = body.running_gear.as_ref().unwrap();
        let mut x = 0.0; let mut v = 0.0;
        for k in 0..2 { if blend.w[k] != 0.0 { x += blend.w[k] * rg.q[blend.i[k]]; v += blend.w[k] * rg.qv[blend.i[k]]; } }
        let mut k = if rock { u.rock_k } else { u.k };
        let mut c = if rock { u.rock_c } else { u.c * if v > 0.0 { DAMP_COMPRESSION } else { DAMP_REBOUND } };
        let mut p = if rock { 0.0 } else { u.p };
        let limit = if rock { u.lim } else { self.travel };
        let low = if rock { -u.lim } else { -self.rebound };
        let predicted = x + dt * v;
        if predicted > limit { p -= BUMP_STOP * u.k * limit; k += BUMP_STOP * u.k; c += 3.0 * u.c; }
        if predicted < low { p -= BUMP_STOP * u.k * low; k += BUMP_STOP * u.k; c += 3.0 * u.c; }
        let prev = if rock { rg.rock_impulse[ui] } else { rg.spring_impulse[ui] };
        let response_index = 2 * ui + usize::from(rock);
        let inv = rg.relative_responses[response_index].inv_mass;
        let d = (-prev - dt * (p + k * x + (c + dt * k) * v)) / (1.0 + dt * (c + dt * k) * inv);
        let rg = body.running_gear.as_mut().unwrap();
        if rock { rg.rock_impulse[ui] += d; } else { rg.spring_impulse[ui] += d; }
        body.apply_relative_cached(response_index, d);
        if !rock {
            st.unit_x[ui] = x; st.unit_v[ui] = v; st.spring[ui] = p + k * x;
            st.force[ui] = -(prev + d) / dt; st.damper[ui] = st.force[ui] - st.spring[ui];
        }
    }

    /// Relative spring energy and unilateral terrain contacts solved together with current velocity.
    pub fn apply(&self, st: &mut SuspensionState, body: &mut VehicleRigidBody, profiles: &[GroundProfile; 2], dt: f64, broken: [bool; 2]) -> [f64; 2] {
        let rg = body.running_gear.as_mut().unwrap();
        rg.normal_impulse.fill(0.0); rg.spring_impulse.fill(0.0); rg.rock_impulse.fill(0.0);
        self.sync_pose(st, body, broken);
        for (i, s) in self.stations.iter().enumerate() {
            let support = support_under_mode(self.window, &profiles[si(s.side)], s, broken[si(s.side)]);
            st.support_available[i] = support.is_some();
            st.support[i] = support.unwrap_or(0.0);
            st.normals[i] = station_normal(profiles, body, s);
            st.load[i] = 0.0; st.grounded[i] = false;
            if st.support_available[i] { body.prepare_normal_response(i, st.normals[i], st.contact[i], WheelBlend::single(i, 1.0)); }
        }
        for (ui, u) in self.units.iter().enumerate() {
            let rg = body.running_gear.as_mut().unwrap();
            rg.prepare_relative(2 * ui, u.heave);
            if u.members.len() > 1 { rg.prepare_relative(2 * ui + 1, u.rock); }
        }
        for _ in 0..12 {
            for (ui, u) in self.units.iter().enumerate() {
                self.spring_impulse(st, body, u, ui, u.heave, false, dt);
                if u.members.len() > 1 { self.spring_impulse(st, body, u, ui, u.rock, true, dt); }
            }
            for i in 0..self.stations.len() {
                if !st.support_available[i] { continue; }
                let p = st.contact[i]; let n = st.normals[i]; let blend = WheelBlend::single(i, 1.0);
                let pen = (st.support[i] - p[1]) * n[1];
                let vn = dot(body.coupled_point_velocity(p, blend), n);
                if body.running_gear.as_ref().unwrap().normal_impulse[i] == 0.0 && pen < -0.00001 && pen - vn * dt < 0.0 { body.running_gear.as_mut().unwrap().normal_impulse[i] = 0.0; continue; }
                let target = if pen >= 0.0 { 0.25 * pen / dt } else { pen / dt };
                let inv = body.running_gear.as_ref().unwrap().normal_responses[i].inv_mass;
                let prev = body.running_gear.as_ref().unwrap().normal_impulse[i];
                let want = (prev + (target - vn) / inv).max(0.0);
                body.running_gear.as_mut().unwrap().normal_impulse[i] = want;
                body.apply_normal_cached(i, want - prev);
            }
        }
        let mut side_load = [0.0; 2];
        for i in 0..self.stations.len() {
            st.load[i] = body.running_gear.as_ref().unwrap().normal_impulse[i] / dt;
            st.grounded[i] = st.load[i] > 0.0;
            side_load[si(self.stations[i].side)] += st.load[i];
        }
        side_load
    }
}

fn station_normal(profiles: &[GroundProfile; 2], body: &VehicleRigidBody, s: &Station) -> V3 {
    let a = &profiles[si(s.side)]; let o = &profiles[si(-s.side)];
    let mut k = 1;
    while k < a.zs.len() - 2 && a.zs[k] < s.z { k += 1; }
    let along = a.along_slope(k);
    let across = if a.supported_at(k) && o.supported_at(k) { (if s.side > 0 { a.h[k] - o.h[k] } else { o.h[k] - a.h[k] }) / (2.0 * s.x.abs()) } else { 0.0 };
    let f = norm([body.ez[0], 0.0, body.ez[2]]);
    norm([-along * f[0] - across * f[2], 1.0, -along * f[2] + across * f[0]])
}
