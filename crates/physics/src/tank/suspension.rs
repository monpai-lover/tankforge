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
use super::rigid_body::{VehicleRigidBody, GRAVITY};
use super::road_wheel::{si, support_under, GearGeometry, GroundProfile, Station};

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
    pub unit_x: Vec<f64>,
    /// Vertical velocity of each unit against the hull (+ compressing).
    pub unit_v: Vec<f64>,
    pub unit_prev: Vec<Option<f64>>,
    pub spring: Vec<f64>,
    pub damper: Vec<f64>,
    pub force: Vec<f64>,
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
            unit_x: vec![0.0; u],
            unit_v: vec![0.0; u],
            unit_prev: vec![None; u],
            spring: vec![0.0; u],
            damper: vec![0.0; u],
            force: vec![0.0; u],
        }
    }

    /// How far station `s` must rise (+) from static to stand on its ground, along the hull's up.
    pub fn wanted(&self, prof: &GroundProfile, body: &VehicleRigidBody, s: &Station) -> (f64, f64) {
        let up_y = body.ey[1].max(0.2);
        let sup = support_under(self.window, prof, s);
        let h = body.world_point([s.x, s.y, s.z])[1];
        (sup, (sup + s.r + self.thickness - h) / up_y)
    }

    /// One substep: every station finds its ground, every unit pushes the hull at its mount.
    /// profiles: [left, right]. Returns the total vertical load per side [left, right].
    pub fn apply(&self, st: &mut SuspensionState, body: &mut VehicleRigidBody, profiles: &[GroundProfile; 2], dt: f64) -> [f64; 2] {
        let xc: Vec<f64> = self
            .stations
            .iter()
            .enumerate()
            .map(|(i, s)| {
                let (sup, x) = self.wanted(&profiles[si(s.side)], body, s);
                st.support[i] = sup;
                x
            })
            .collect();
        let mut side_load = [0.0; 2];
        for (ui, u) in self.units.iter().enumerate() {
            let m = &u.members;
            let a = xc[m[0]];
            let b = if m.len() > 1 { xc[m[1]] } else { a };
            // a bogie arm takes the mean of its two wheels, until one of them reaches the end of its swing
            let want = if m.len() > 1 { ((a + b) / 2.0).max(a.max(b) - u.lim) } else { a };
            let prev = st.unit_prev[ui].unwrap_or(want);
            st.unit_prev[ui] = Some(want);
            let grounded = want >= -self.rebound;
            let x = if grounded { want } else { -self.rebound };
            let xv = if grounded { (want - prev) / dt } else { 0.0 };
            let mut spring = 0.0;
            let mut damper = 0.0;
            if grounded {
                spring = u.p + u.k * x;
                damper = u.c * xv * if xv > 0.0 { DAMP_COMPRESSION } else { DAMP_REBOUND };
                if x > self.travel {
                    spring += BUMP_STOP * u.k * (x - self.travel);
                    damper += 3.0 * u.c * xv.max(0.0);
                }
            }
            // a stop is stiff, not infinite: a wheel can be thrown hard, but not launch the hull
            let f = (spring + damper).max(0.0).min(30.0 * u.p);
            st.unit_x[ui] = x;
            st.unit_v[ui] = xv;
            st.spring[ui] = if grounded { spring } else { 0.0 };
            st.damper[ui] = if f > 0.0 { f - spring } else { 0.0 };
            st.force[ui] = f;
            if f > 0.0 {
                let at = body.world_point(u.mount);
                body.add_force_at(scale(body.ey, f), at);
            }
            side_load[si(u.side)] += f;
            // where each wheel sits: on its ground, or hanging from the rebound stop
            let mut swing = 0.0;
            if m.len() > 1 {
                if grounded {
                    swing = ((a - b) / 2.0).clamp(-u.lim, u.lim);
                } else {
                    // a hanging bogie still pivots: the higher wheel rests on its ground, the other drops
                    let hi = a.max(b);
                    let up = (hi - x).min(u.lim).max(0.0);
                    swing = if a >= b { up } else { -up };
                }
            }
            for (j, &i) in m.iter().enumerate() {
                let wx = if m.len() > 1 || grounded { x + if j == 0 { swing } else { -swing } } else { -self.rebound };
                st.comp[i] = wx;
                st.grounded[i] = xc[i] >= wx - 0.02;
                st.load[i] = if st.grounded[i] { f / m.len() as f64 } else { 0.0 };
                let s = &self.stations[i];
                st.contact[i] = body.world_point([s.x, s.y + wx - s.r - self.thickness, s.z]);
            }
            if m.len() > 1 {
                // the arm shares its load by where the wheels stand
                let (i0, i1) = (m[0], m[1]);
                let (g0, g1) = (st.grounded[i0], st.grounded[i1]);
                if g0 != g1 {
                    st.load[i0] = if g0 { f } else { 0.0 };
                    st.load[i1] = if g1 { f } else { 0.0 };
                }
            }
        }
        side_load
    }
}
