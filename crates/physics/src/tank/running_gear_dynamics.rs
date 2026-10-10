//! Coupled hull/unsprung dynamics. The engineering wheel/arm estimate is split FROM the
//! original assembly, including its COM and full tensor; the pose retains that original anchor.
//! (client/web/src/sim/tank/runningGearDynamics.js mirrors this file.)
use super::math::*;
use super::road_wheel::Station;
use std::sync::Arc;

pub type V6 = [f64; 6];
type M6 = [f64; 36];

#[derive(Clone, Copy, Debug, Default)]
pub struct WheelBlend {
    pub i: [usize; 2],
    pub w: [f64; 2],
}
impl WheelBlend {
    pub fn single(i: usize, w: f64) -> Self { Self { i: [i, 0], w: [w, 0.0] } }
    pub fn pair(a: usize, wa: f64, b: usize, wb: f64) -> Self { Self { i: [a, b], w: [wa, wb] } }
}

#[derive(Clone, Debug)]
pub struct MassResponse {
    pub delta: Vec<f64>,
    pub inv_mass: f64,
    version: u64,
    owner: Option<Arc<()>>,
}
impl MassResponse {
    pub fn new(stations: usize) -> Self { Self { delta: vec![0.0; 6 + stations], inv_mass: 0.0, version: 0, owner: None } }
}
#[derive(Clone, Debug)]
pub struct ResponsePair {
    pub l: MassResponse,
    pub t: MassResponse,
}
impl ResponsePair {
    pub fn new(stations: usize) -> Self { Self { l: MassResponse::new(stations), t: MassResponse::new(stations) } }
}

fn write_response(l: &M6, r: &[V3], model: &RunningGearModel, owner: &Arc<()>, version: u64, hull: V6, blend: WheelBlend, q_scale: f64, cache: &mut MassResponse) {
    let mut rhs = hull; let mut diagonal = 0.0;
    for k in 0..2 {
        if blend.w[k] == 0.0 { continue; }
        let i = blend.i[k]; let q = blend.w[k] * q_scale;
        diagonal += q * q / model.wheel_mass[i];
        rhs[1] -= q; rhs[3] += r[i][2] * q; rhs[5] -= r[i][0] * q;
    }
    let response = solve(l, rhs);
    cache.inv_mass = diagonal + (0..6).map(|a| rhs[a] * response[a]).sum::<f64>();
    cache.delta[..6].copy_from_slice(&response);
    for i in 0..r.len() {
        let q = (0..2).filter(|&k| blend.i[k] == i).map(|k| blend.w[k] * q_scale).sum::<f64>();
        cache.delta[6 + i] = q / model.wheel_mass[i] - response[1] + r[i][2] * response[3] - r[i][0] * response[5];
    }
    cache.version = version;
    if !cache.owner.as_ref().is_some_and(|o| Arc::ptr_eq(o, owner)) { cache.owner = Some(Arc::clone(owner)); }
}

fn response_impulse(qv: &mut [f64], cache: &MassResponse, owner: &Arc<()>, version: u64, impulse: f64) -> (V3, V3) {
    assert_eq!(cache.version, version, "stale running gear response");
    assert!(cache.owner.as_ref().is_some_and(|o| Arc::ptr_eq(o, owner)), "stale running gear response owner");
    for (i, v) in qv.iter_mut().enumerate() { *v += cache.delta[6 + i] * impulse; }
    ([cache.delta[0] * impulse, cache.delta[1] * impulse, cache.delta[2] * impulse], [cache.delta[3] * impulse, cache.delta[4] * impulse, cache.delta[5] * impulse])
}

fn factor(a: &[f64], l: &mut [f64], n: usize) -> bool {
    l.fill(0.0);
    for i in 0..n { for j in 0..=i {
        let mut v = a[i * n + j];
        for k in 0..j { v -= l[i * n + k] * l[j * n + k]; }
        if i == j {
            if v <= 1e-9 || !v.is_finite() { return false; }
            l[i * n + j] = v.sqrt();
        } else { l[i * n + j] = v / l[j * n + j]; }
    }}
    true
}

fn solve(l: &M6, rhs: V6) -> V6 {
    let mut out = [0.0; 6];
    for i in 0..6 {
        let mut x = rhs[i];
        for j in 0..i { x -= l[i * 6 + j] * out[j]; }
        out[i] = x / l[i * 6 + i];
    }
    for i in (0..6).rev() {
        let mut x = out[i];
        for j in i + 1..6 { x -= l[j * 6 + i] * out[j]; }
        out[i] = x / l[i * 6 + i];
    }
    out
}

fn point_matrix(a: &mut M6, m: f64, r: V3) {
    let [x, y, z] = r;
    let rows = [[1.0, 0.0, 0.0, 0.0, z, -y], [0.0, 1.0, 0.0, -z, 0.0, x], [0.0, 0.0, 1.0, y, -x, 0.0]];
    for row in rows { for i in 0..6 { for j in 0..6 { a[i * 6 + j] += m * row[i] * row[j]; } } }
}

#[derive(Clone, Debug)]
pub struct RunningGearModel {
    pub mass: f64,
    pub com: V3,
    pub points: Vec<V3>,
    pub wheel_mass: Vec<f64>,
    pub sprung_mass: f64,
    pub sprung_com: V3,
    pub sprung_inertia: [f64; 9],
    pub spatial: M6,
    /// Actual deterministic estimate (shrunk if the original tensor requires it); zero for overrides.
    pub estimated_ratio: f64,
    pub unsprung_ratio: f64,
    pub explicit_masses: bool,
    pub q_min: f64,
    pub q_max: f64,
    pub qv_limit: f64,
}

impl RunningGearModel {
    pub fn new(mass: f64, com: V3, inertia: V3, stations: &[Station], proxies: &[f64], overrides: Option<&[f32]>, travel: f64, rebound: f64) -> Self {
        let n = stations.len();
        let per = n / 2;
        let points: Vec<V3> = stations.iter().map(|s| [s.x, s.y, s.z]).collect();
        let weights: Vec<f64> = stations.iter().enumerate().map(|(i, s)| proxies.get(i % per).copied().filter(|x| *x > 0.0).unwrap_or(s.r.powi(3))).collect();
        let sum: f64 = weights.iter().sum();
        if let Some(o) = overrides { assert!(o.len() == per && o.iter().all(|m| m.is_finite() && *m > 0.0), "station_mass_kg requires one positive mass per axle and side"); }
        let mut ratio = 0.06;
        loop {
            let wheel_mass: Vec<f64> = (0..n).map(|i| overrides.map_or(ratio * mass * weights[i] / sum, |o| o[i % per] as f64)).collect();
            let sprung_mass = mass - wheel_mass.iter().sum::<f64>();
            let mut moment = [0.0; 3];
            for i in 0..n { for k in 0..3 { moment[k] += wheel_mass[i] * (points[i][k] - com[k]); } }
            let r = moment.map(|x| -x / sprung_mass);
            let sprung_com = add(com, r);
            let mut sprung_inertia = [inertia[0], 0.0, 0.0, 0.0, inertia[1], 0.0, 0.0, 0.0, inertia[2]];
            let mut subtract_point = |m: f64, d: V3| {
                let d2 = dot(d, d);
                for a in 0..3 { for b in 0..3 { sprung_inertia[a * 3 + b] -= m * (if a == b { d2 } else { 0.0 } - d[a] * d[b]); } }
            };
            for i in 0..n { subtract_point(wheel_mass[i], sub(points[i], com)); }
            subtract_point(sprung_mass, r);
            if sprung_mass > 0.0 && factor(&sprung_inertia, &mut [0.0; 9], 3) {
                let mut spatial = [0.0; 36];
                point_matrix(&mut spatial, sprung_mass, r);
                for a in 0..3 { for b in 0..3 { spatial[(a + 3) * 6 + b + 3] += sprung_inertia[a * 3 + b]; } }
                return Self { mass, com, points, wheel_mass, sprung_mass, sprung_com, sprung_inertia, spatial, estimated_ratio: if overrides.is_some() { 0.0 } else { ratio }, unsprung_ratio: 1.0 - sprung_mass / mass, explicit_masses: overrides.is_some(), q_min: -rebound - 0.3, q_max: travel + 0.3, qv_limit: 30.0 };
            }
            assert!(overrides.is_none(), "station masses leave a non-positive sprung inertia");
            ratio *= 0.5;
            assert!(ratio >= 1e-10, "assembly inertia is not positive");
        }
    }
}

#[derive(Debug)]
pub struct RunningGearState {
    pub model: Arc<RunningGearModel>,
    /// Single authoritative relative displacement and velocity for every station.
    pub q: Vec<f64>,
    pub qv: Vec<f64>,
    pub normal_impulse: Vec<f64>,
    pub spring_impulse: Vec<f64>,
    pub rock_impulse: Vec<f64>,
    pub remote_pose: bool,
    pub relative_responses: Vec<MassResponse>,
    pub normal_responses: Vec<MassResponse>,
    version: u64,
    identity: Arc<()>,
    pub a: M6,
    pub s: M6,
    l: M6,
    b: Vec<V6>,
    r: Vec<V3>,
    wheel_force: Vec<f64>,
}

impl Clone for RunningGearState {
    fn clone(&self) -> Self {
        let n = self.q.len();
        // Physics is copied; prepared responses belong to the original entity and cannot be
        // copied as valid caches, even when the clone later has the same refresh count.
        Self {
            model: Arc::clone(&self.model), q: self.q.clone(), qv: self.qv.clone(),
            normal_impulse: self.normal_impulse.clone(), spring_impulse: self.spring_impulse.clone(), rock_impulse: self.rock_impulse.clone(),
            remote_pose: self.remote_pose,
            relative_responses: self.relative_responses.iter().map(|_| MassResponse::new(n)).collect(),
            normal_responses: self.normal_responses.iter().map(|_| MassResponse::new(n)).collect(),
            version: self.version, identity: Arc::new(()), a: self.a, s: self.s, l: self.l,
            b: self.b.clone(), r: self.r.clone(), wheel_force: self.wheel_force.clone(),
        }
    }
}

impl RunningGearState {
    pub fn new(model: Arc<RunningGearModel>) -> Self {
        let n = model.wheel_mass.len();
        let mut st = Self { model, q: vec![0.0; n], qv: vec![0.0; n], normal_impulse: vec![0.0; n], spring_impulse: vec![0.0; n], rock_impulse: vec![0.0; n], remote_pose: false, relative_responses: (0..2 * n).map(|_| MassResponse::new(n)).collect(), normal_responses: (0..n).map(|_| MassResponse::new(n)).collect(), version: 0, identity: Arc::new(()), a: [0.0; 36], s: [0.0; 36], l: [0.0; 36], b: vec![[0.0; 6]; n], r: vec![[0.0; 3]; n], wheel_force: vec![0.0; n] };
        st.refresh(); st
    }

    pub fn reset(&mut self) {
        self.q.fill(0.0); self.qv.fill(0.0); self.normal_impulse.fill(0.0); self.spring_impulse.fill(0.0); self.rock_impulse.fill(0.0); self.remote_pose = false; self.refresh();
    }

    pub fn refresh(&mut self) {
        self.version = self.version.wrapping_add(1);
        self.a = self.model.spatial;
        for i in 0..self.q.len() {
            self.r[i] = sub(self.model.points[i], self.model.com); self.r[i][1] += self.q[i];
            let m = self.model.wheel_mass[i]; let r = self.r[i];
            point_matrix(&mut self.a, m, r);
            self.b[i] = [0.0, m, 0.0, -m * r[2], 0.0, m * r[0]];
        }
        self.s = self.a;
        for i in 0..self.q.len() { for a in 0..6 { for b in 0..6 { self.s[a * 6 + b] -= self.b[i][a] * self.b[i][b] / self.model.wheel_mass[i]; } } }
        assert!(factor(&self.s, &mut self.l, 6), "running gear mass operator is not positive");
    }

    pub fn prepare_response(&self, hull: V6, blend: WheelBlend, q_scale: f64, cache: &mut MassResponse) {
        write_response(&self.l, &self.r, &self.model, &self.identity, self.version, hull, blend, q_scale, cache);
    }
    pub fn prepare_relative(&mut self, index: usize, blend: WheelBlend) {
        write_response(&self.l, &self.r, &self.model, &self.identity, self.version, [0.0; 6], blend, 1.0, &mut self.relative_responses[index]);
    }
    pub fn prepare_normal(&mut self, index: usize, hull: V6, blend: WheelBlend, q_scale: f64) {
        write_response(&self.l, &self.r, &self.model, &self.identity, self.version, hull, blend, q_scale, &mut self.normal_responses[index]);
    }
    pub fn apply_response(&mut self, cache: &MassResponse, impulse: f64) -> (V3, V3) {
        response_impulse(&mut self.qv, cache, &self.identity, self.version, impulse)
    }
    pub fn apply_relative_cache(&mut self, index: usize, impulse: f64) -> (V3, V3) {
        response_impulse(&mut self.qv, &self.relative_responses[index], &self.identity, self.version, impulse)
    }
    pub fn apply_normal_cache(&mut self, index: usize, impulse: f64) -> (V3, V3) {
        response_impulse(&mut self.qv, &self.normal_responses[index], &self.identity, self.version, impulse)
    }

    pub fn inverse_mass(&self, hull: V6, blend: WheelBlend, q_scale: f64) -> f64 {
        let mut rhs = hull; let mut diagonal = 0.0;
        for k in 0..2 {
            if blend.w[k] == 0.0 { continue; }
            let i = blend.i[k]; let q = blend.w[k] * q_scale; let m = self.model.wheel_mass[i];
            diagonal += q * q / m;
            for a in 0..6 { rhs[a] -= self.b[i][a] * q / m; }
        }
        let response = solve(&self.l, rhs);
        diagonal + (0..6).map(|a| rhs[a] * response[a]).sum::<f64>()
    }

    pub fn impulse(&mut self, hull: V6, blend: WheelBlend, q_scale: f64) -> (V3, V3) {
        self.wheel_force.fill(0.0);
        for k in 0..2 { if blend.w[k] != 0.0 { self.wheel_force[blend.i[k]] += blend.w[k] * q_scale; } }
        self.apply_prepared(hull)
    }

    fn apply_prepared(&mut self, hull: V6) -> (V3, V3) {
        let mut rhs = hull;
        for i in 0..self.q.len() { for a in 0..6 { rhs[a] -= self.b[i][a] * self.wheel_force[i] / self.model.wheel_mass[i]; } }
        let response = solve(&self.l, rhs);
        for i in 0..self.q.len() {
            let coupling = (0..6).map(|a| self.b[i][a] * response[a]).sum::<f64>();
            self.qv[i] += (self.wheel_force[i] - coupling) / self.model.wheel_mass[i];
        }
        ([response[0], response[1], response[2]], [response[3], response[4], response[5]])
    }

    pub fn integrate_velocity(&mut self, f: V3, t: V3, w: V3, g: V3, dt: f64) -> (V3, V3) {
        let mut force = f; let mut torque = t;
        let mut add_mass = |mass: f64, r: V3, qv: f64| {
            let bias = cross(w, cross(w, r)); let coriolis = cross(w, [0.0, 2.0 * qv, 0.0]);
            let actual = scale(sub(sub(g, bias), coriolis), mass);
            force = add(force, actual); torque = add(torque, cross(r, actual));
            mass * (g[1] - bias[1])
        };
        add_mass(self.model.sprung_mass, sub(self.model.sprung_com, self.model.com), 0.0);
        for i in 0..self.q.len() { self.wheel_force[i] = add_mass(self.model.wheel_mass[i], self.r[i], self.qv[i]) * dt; }
        let inertia = self.model.sprung_inertia;
        let iw = [0, 1, 2].map(|a| inertia[a * 3] * w[0] + inertia[a * 3 + 1] * w[1] + inertia[a * 3 + 2] * w[2]);
        torque = sub(torque, cross(w, iw));
        let hull = [force[0] * dt, force[1] * dt, force[2] * dt, torque[0] * dt, torque[1] * dt, torque[2] * dt];
        self.apply_prepared(hull)
    }

    pub fn damp(&mut self, v: V3, w: V3, linear: f64, angular: f64, inertia: V3, dt: f64) -> (V3, V3) {
        if linear <= 0.0 && angular <= 0.0 { return ([0.0; 3], [0.0; 3]); }
        let velocity = [v[0], v[1], v[2], w[0], w[1], w[2]];
        let mut matrix = self.s; let mut l = [0.0; 36]; let mut rhs = [0.0; 6]; let mut damping = [0.0; 6];
        for a in 0..6 {
            damping[a] = dt * if a < 3 { linear.max(0.0) * self.model.mass } else { angular.max(0.0) * inertia[a - 3] };
            matrix[a * 6 + a] += damping[a];
            for b in 0..6 { rhs[a] += self.s[a * 6 + b] * velocity[b]; }
        }
        assert!(factor(&matrix, &mut l, 6));
        let response = solve(&l, rhs);
        self.impulse([0, 1, 2, 3, 4, 5].map(|a| -damping[a] * response[a]), WheelBlend::default(), 0.0)
    }
}
