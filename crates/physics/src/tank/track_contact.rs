//! TrackContactSystem: 8-16 contact samples along each track's ground run. Each carries the load
//! of the road wheels near it and the friction between the track and the ground: the slip between
//! the track's own speed and the ground under it decides how much force the ground gives, along
//! the track and across it, inside a friction ellipse (lateral grip falls away while a track
//! spins, and a fast turn slides). Soil needs some slip to carry thrust (Janosi-Hanamoto); hard
//! ground grips at once. The friction is solved as impulses (projected Gauss-Seidel) together with
//! the drivetrain's velocity motors and the brakes, so a braked tank holds on a slope without
//! creeping and nothing overshoots at any stiffness.
//! (client/web/src/sim/tank/contacts.js mirrors this file and terrain.rs.)
use super::math::*;
use super::rigid_body::VehicleRigidBody;
use super::road_wheel::si;
use super::suspension::{SuspensionState, SuspensionSystem};
use super::terrain::{ContactGeometry, ContactState, Ground};
use crate::TerrainDef;

/// A track skids sideways more easily than it grips along (grousers cut the ground across, links pivot).
pub const TRACK_LATERAL: f64 = 0.6;
/// Rolling drag of bare road wheels on the ground (a thrown track), as a friction coefficient.
pub const BARE_ROLL: f64 = 0.06;
/// What is left of the drive with one track: a share of the speed and of the push.
pub const ONE_TRACK_SPEED: f64 = 0.2;
pub const ONE_TRACK_FORCE: f64 = 0.12;
/// Contact length the soil shear curve is evaluated over, m.
const SHEAR_LENGTH: f64 = 3.6;
/// The share of the soil's grip available before any slip (keeps the solve well behaved).
const SHEAR_FLOOR: f64 = 0.15;

/// Friction of one contact's ground.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Grip {
    pub traction_mu: f64,
    pub lateral_mu: f64,
    /// Shear deformation modulus K of soft ground (m); None on hard ground.
    pub shear_k: Option<f64>,
}

impl Grip {
    pub fn of(t: &TerrainDef) -> Self {
        Self { traction_mu: t.traction_mu as f64, lateral_mu: t.lateral_mu as f64, shear_k: t.soil.as_ref().map(|s| s.k as f64) }
    }
}

/// One friction contact. `side`: +1 right track, -1 left track, 0 the hull (belly).
#[derive(Clone, Debug)]
pub struct Contact {
    pub p: V3,
    pub n: V3,
    /// Normal load, N.
    pub load: f64,
    pub side: i8,
    pub grip: Grip,
    /// Hull-frame z of a track sample.
    pub z: Option<f64>,
    /// Tangents: along the hull and across it, in the ground plane.
    pub tl: V3,
    pub tt: V3,
    kl: f64,
    kt: f64,
    ll: f64,
    lt: f64,
    jl: f64,
    jt: f64,
    /// Slip along the track before the solve (ground minus track), m/s.
    pub slip: f64,
    /// Friction force solved, along and across, N.
    pub fl: f64,
    pub ft: f64,
}

impl Contact {
    pub fn new(p: V3, n: V3, load: f64, side: i8, grip: Grip, z: Option<f64>) -> Self {
        Self { p, n, load, side, grip, z, tl: [0.0; 3], tt: [0.0; 3], kl: 0.0, kt: 0.0, ll: 0.0, lt: 0.0, jl: 0.0, jt: 0.0, slip: 0.0, fl: 0.0, ft: 0.0 }
    }
}

/// One track as a 1-DOF body: its ground run moves backwards relative to the hull at `v`.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Belt {
    pub v: f64,
    pub m: f64,
}

/// The drivetrain's two velocity motors: the engine holds the tracks' mean speed, the steering
/// mechanism their difference (left minus right), each up to its force cap.
#[derive(Clone, Copy, Debug, Default)]
pub struct Motor {
    pub mean: f64,
    pub mean_cap: f64,
    pub diff: f64,
    pub diff_cap: f64,
    pub pushing: bool,
    /// Tracks shot off [left, right]: the bare wheels roll, the engine drives the other track alone.
    pub broken: [bool; 2],
    /// Forces solved.
    pub f_mean: f64,
    pub f_steer: f64,
}

/// Friction contacts along each track's ground run, carrying the loads of the wheels near them.
pub fn track_contacts(ct: &ContactGeometry, cs: &ContactState, body: &VehicleRigidBody, sp: &SuspensionSystem, ss: &SuspensionState, terrain: &dyn Ground) -> Vec<Contact> {
    let mut out = Vec::with_capacity(ct.cz.len() * 2);
    let per = sp.per_side();
    for side in [1i8, -1] {
        let base = if side > 0 { 0 } else { per };
        let st = &sp.stations[base..base + per];
        let bottom: Vec<f64> = st.iter().enumerate().map(|(i, s)| s.y + ss.comp[base + i] - s.r - sp.thickness).collect();
        let spacing = if per > 1 { (st[0].z - st[per - 1].z) / (per - 1) as f64 } else { 1.0 };
        // tent weights: each wheel's load goes to the samples within one wheel spacing of it
        let w: Vec<Vec<f64>> = ct.cz.iter().map(|z| st.iter().map(|s| (1.0 - (z - s.z).abs() / spacing).max(0.0)).collect()).collect();
        let wsum: Vec<f64> = (0..per)
            .map(|i| {
                let t: f64 = w.iter().map(|row| row[i]).sum();
                if t > 0.0 {
                    t
                } else {
                    1.0
                }
            })
            .collect();
        for (k, &z) in ct.cz.iter().enumerate() {
            let mut load = 0.0;
            for i in 0..per {
                load += ss.load[base + i] * w[k][i] / wsum[i];
            }
            // the track's lower run between the wheels
            let mut j = 0;
            while per >= 2 && j < per - 2 && st[j + 1].z > z {
                j += 1;
            }
            let a = st[j];
            let (b, bb) = if j + 1 < per { (st[j + 1], bottom[j + 1]) } else { (a, bottom[j]) };
            let u = if j + 1 < per { ((a.z - z) / (a.z - b.z)).clamp(0.0, 1.0) } else { 0.0 };
            let y = bottom[j] + (bb - bottom[j]) * u;
            let p = body.world_point([side as f64 * ct.track_x, y, z]);
            let n = ct.ground_normal(cs, body, side, z);
            out.push(Contact::new(p, n, load, side, Grip::of(terrain.surface(p[0], p[2])), Some(z)));
        }
    }
    out
}

fn shear_ratio(slip: f64, k: f64, l: f64) -> f64 {
    let x = slip * l / k;
    if x < 1e-6 {
        0.0
    } else {
        1.0 - (1.0 - (-x).exp()) / x
    }
}

/// Friction as impulses (projected Gauss-Seidel). belts [left, right]; brakes: brake force on
/// each track, N. Each contact's longitudinal friction moves both the hull (+J) and its track
/// (-J / m_belt). Contacts without load are dropped; the solved forces are left in each contact.
pub fn solve_friction(contacts: &mut Vec<Contact>, body: &mut VehicleRigidBody, belts: &mut [Belt; 2], brakes: [f64; 2], dt: f64, iterations: usize, mut motor: Option<&mut Motor>) {
    contacts.retain(|c| c.load > 0.0);
    let broken = motor.as_deref().map(|m| m.broken).unwrap_or([false; 2]);
    let bare = |side: i8| side != 0 && broken[si(side)];
    for c in contacts.iter_mut() {
        let tl = norm(sub(body.ez, scale(c.n, dot(body.ez, c.n))));
        c.tl = tl;
        c.tt = cross(c.n, tl);
        let belt = if c.side != 0 && !bare(c.side) { Some(belts[si(c.side)]) } else { None };
        c.kl = 1.0 / (body.inv_mass_along(tl, c.p) + belt.map_or(0.0, |b| 1.0 / b.m));
        c.kt = 1.0 / body.inv_mass_along(c.tt, c.p);
        let vp = body.point_velocity(c.p);
        let vl = dot(vp, tl) - belt.map_or(0.0, |b| b.v);
        let mut mul = c.grip.traction_mu;
        if let (Some(k), Some(b)) = (c.grip.shear_k, belt) {
            let i = vl.abs() / b.v.abs().max(dot(vp, tl).abs()).max(0.5);
            mul *= shear_ratio(i, k, SHEAR_LENGTH).max(SHEAR_FLOOR);
        }
        // bare wheels roll: only their rolling drag holds them along the hull
        c.ll = if bare(c.side) { BARE_ROLL } else { mul } * c.load * dt;
        c.lt = c.grip.lateral_mu * if belt.is_some() { TRACK_LATERAL } else { 1.0 } * c.load * dt;
        c.jl = 0.0;
        c.jt = 0.0;
        c.slip = vl;
    }
    let mut jb = [0.0f64; 2];
    let (mut jm, mut js) = (0.0f64, 0.0f64);
    let one_track = broken[0] || broken[1];
    for _ in 0..iterations {
        if let (Some(mo), true) = (motor.as_deref_mut(), one_track) {
            // one track (or none) left: the drive line's free shaft on the broken side takes most
            // of the engine's effort, so the good track pushes weakly and slowly
            for i in 0..2 {
                if broken[i] {
                    continue;
                }
                let b = &mut belts[i];
                let target = (mo.mean + if i == 0 { 0.5 } else { -0.5 } * mo.diff) * ONE_TRACK_SPEED;
                let cap = mo.mean_cap * ONE_TRACK_FORCE * dt;
                let prev = if i == 0 { js } else { jm };
                let want = (prev + (target - b.v) * b.m).clamp(-cap, cap);
                b.v += (want - prev) / b.m;
                if i == 0 {
                    js = want;
                } else {
                    jm = want;
                }
            }
        } else if let Some(mo) = motor.as_deref_mut() {
            let [l, r] = &mut *belts;
            // engine: both tracks together towards the mean target (impulse split between them)
            let mean = (l.v + r.v) / 2.0;
            let cap_m = mo.mean_cap * dt;
            let want_m = (jm + (mo.mean - mean) * (l.m + r.m)).clamp(-cap_m, cap_m);
            l.v += (want_m - jm) / (l.m + r.m);
            r.v += (want_m - jm) / (l.m + r.m);
            jm = want_m;
            // steering gear: a force pair holding the difference between the tracks
            let diff = l.v - r.v;
            let cap_s = mo.diff_cap * dt;
            let m_pair = 1.0 / (1.0 / l.m + 1.0 / r.m);
            let want_s = (js + (mo.diff - diff) * m_pair).clamp(-cap_s, cap_s);
            l.v += (want_s - js) / l.m;
            r.v -= (want_s - js) / r.m;
            js = want_s;
        }
        // brakes hold each track against the hull
        for i in 0..2 {
            let b = &mut belts[i];
            let lim = brakes[i] * dt;
            if lim > 0.0 {
                let want = (jb[i] - b.v * b.m).clamp(-lim, lim);
                b.v += (want - jb[i]) / b.m;
                jb[i] = want;
            }
        }
        for c in contacts.iter_mut() {
            let bi = if c.side != 0 && !bare(c.side) { Some(si(c.side)) } else { None };
            let vp = body.point_velocity(c.p);
            let vl = dot(vp, c.tl) - bi.map_or(0.0, |i| belts[i].v);
            let vt = dot(vp, c.tt);
            let mut jl = c.jl - vl * c.kl;
            let mut jt = c.jt - vt * c.kt;
            // inside the friction ellipse the contact sticks; outside it slides, and sliding
            // friction opposes the way it slides (not the way it would have liked to stop)
            if (jl / c.ll).powi(2) + (jt / c.lt).powi(2) > 1.0 {
                let sv = vl.hypot(vt);
                if sv > 1e-6 {
                    jl = -c.ll * vl / sv;
                    jt = -c.lt * vt / sv;
                    // the slide may not reverse within the step: take the smaller change on each axis
                    if (jl - c.jl).abs() > (vl * c.kl).abs() {
                        jl = c.jl - vl * c.kl;
                    }
                    if (jt - c.jt).abs() > (vt * c.kt).abs() {
                        jt = c.jt - vt * c.kt;
                    }
                } else {
                    let k = 1.0 / ((jl / c.ll).powi(2) + (jt / c.lt).powi(2)).sqrt();
                    jl *= k;
                    jt *= k;
                }
            }
            let (dl, dtt) = (jl - c.jl, jt - c.jt);
            c.jl = jl;
            c.jt = jt;
            body.apply_impulse_at(add(scale(c.tl, dl), scale(c.tt, dtt)), c.p);
            if let Some(i) = bi {
                belts[i].v -= dl / belts[i].m;
            }
        }
    }
    for c in contacts.iter_mut() {
        c.fl = c.jl / dt;
        c.ft = c.jt / dt;
    }
    if let Some(mo) = motor {
        if one_track {
            // reported as the usual pair: what the good track pushes, split as mean and steer
            let (fl, fr) = (js / dt, jm / dt);
            mo.f_mean = fl + fr;
            mo.f_steer = (fl - fr) / 2.0;
        } else {
            mo.f_mean = jm / dt;
            mo.f_steer = js / dt;
        }
    }
}
