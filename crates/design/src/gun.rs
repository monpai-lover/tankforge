//! Space checks for the gun and turret: the breech (and its recoil stroke) must stay inside the
//! turret or the basket below the ring at every elevation; the barrel must clear the hull when
//! depressed; the turret must clear the hull when it turns.
use crate::layout::Model;
use crate::mesh::{segment_tri, tri_tri};
use crate::v3::{v3, Aabb, V3};
use serde::Serialize;

const STEP_DEG: f64 = 0.25;
pub const YAW_STEPS: usize = 36;

#[derive(Clone, Debug, Default, Serialize)]
pub struct GunClearance {
    /// Breech with its full recoil stroke fits at 0 degrees.
    pub recoil_fits: bool,
    /// Breech without recoil fits at 0 degrees (the gun could at least be mounted).
    pub breech_fits: bool,
    pub requested_max_elevation_deg: f64,
    pub requested_max_depression_deg: f64,
    pub max_elevation_deg: f64,
    /// Positive degrees below horizontal.
    pub max_depression_deg: f64,
    pub elevation_limited_by: Option<String>,
    pub depression_limited_by: Option<String>,
    /// Depression allowed by barrel/hull clearance, every 10 degrees of turret yaw from the front.
    pub depression_by_yaw: Vec<f64>,
    /// Smallest depression over the frontal +-30 degrees.
    pub frontal_depression_deg: f64,
    /// Turret yaws (deg) where the level barrel runs into the hull.
    pub barrel_blocked_yaws: Vec<f64>,
    /// Box swept by the breech and recoil over the elevation range, turret space.
    pub breech_sweep: Option<Aabb>,
}

fn breech_points(m: &Model, recoil: f64) -> Vec<V3> {
    let g = m.gun.as_ref().unwrap();
    let mut pts = vec![];
    let zs = [-0.05, -(g.rear + recoil) / 3.0, -2.0 * (g.rear + recoil) / 3.0, -(g.rear + recoil)];
    for &x in &[-g.width * 0.5, 0.0, g.width * 0.5] {
        for &y in &[-g.height * 0.5, 0.0, g.height * 0.5] {
            for &z in &zs {
                pts.push(v3(x, y, z));
            }
        }
    }
    pts
}

fn at_elevation(trunnion: V3, p: V3, e_deg: f64) -> V3 {
    trunnion + p.rot_x(e_deg.to_radians())
}

/// Which part of the turret space the first escaping point of the breech hits.
fn escape_reason(m: &Model, pts: &[V3], trunnion: V3, e: f64) -> Option<String> {
    for p in pts {
        let q = at_elevation(trunnion, *p, e);
        if !m.in_turret_space(q) {
            let r = m.ring.as_ref().map(|r| r.d * 0.5).unwrap_or(0.0);
            let g = m.gun.as_ref().unwrap();
            let reason = if q.y < 0.0 && (q.x * q.x + q.z * q.z).sqrt() > r - 0.02 {
                "breech_ring"
            } else if q.y < 0.0 {
                "breech_floor"
            } else if q.y > trunnion.y + g.height * 0.5 {
                "breech_roof"
            } else if p.z < -g.rear {
                "recoil_rear_wall"
            } else {
                "breech_wall"
            };
            return Some(reason.into());
        }
    }
    None
}

fn fits(m: &Model, pts: &[V3], trunnion: V3, e: f64) -> bool {
    pts.iter().all(|p| m.in_turret_space(at_elevation(trunnion, *p, e)))
}

fn barrel_hits_hull(m: &Model, yaw: f64, e: f64) -> bool {
    let g = m.gun.as_ref().unwrap();
    let a = m.turret_to_hull(at_elevation(g.trunnion, v3(0.0, 0.0, 0.2), e), yaw);
    let b = m.turret_to_hull(at_elevation(g.trunnion, v3(0.0, 0.0, g.muzzle), e), yaw);
    let mut bb = Aabb::EMPTY;
    bb.add(a);
    bb.add(b);
    if !bb.overlaps(&m.hull.bounds, -1e-6) {
        return false;
    }
    m.hull.triangles().any(|(_, [p, q, r])| segment_tri(a, b, p, q, r).is_some())
}

pub fn gun_clearance(m: &Model) -> Option<GunClearance> {
    let g = m.gun.as_ref()?;
    m.ring.as_ref()?;
    let req_up = g.mount.max_elevation_deg.max(0.0);
    let req_down = (-g.mount.min_elevation_deg).max(0.0);
    let mut c = GunClearance { requested_max_elevation_deg: req_up, requested_max_depression_deg: req_down, ..Default::default() };
    let with_recoil = breech_points(m, g.recoil);
    let bare = breech_points(m, 0.0);
    c.breech_fits = fits(m, &bare, g.trunnion, 0.0);
    c.recoil_fits = fits(m, &with_recoil, g.trunnion, 0.0);
    let pts = if c.recoil_fits { &with_recoil } else { &bare };
    if !c.breech_fits {
        c.elevation_limited_by = escape_reason(m, &bare, g.trunnion, 0.0);
        c.depression_limited_by = c.elevation_limited_by.clone();
        c.depression_by_yaw = vec![0.0; YAW_STEPS];
        return Some(c);
    }
    // elevating swings the breech down towards the floor / basket
    let mut e = 0.0;
    while e + STEP_DEG <= req_up + 1e-9 {
        if !fits(m, pts, g.trunnion, e + STEP_DEG) {
            c.elevation_limited_by = escape_reason(m, pts, g.trunnion, e + STEP_DEG);
            break;
        }
        e += STEP_DEG;
    }
    c.max_elevation_deg = e;
    // depressing swings the breech up into the roof
    let mut e = 0.0;
    while e + STEP_DEG <= req_down + 1e-9 {
        if !fits(m, pts, g.trunnion, -(e + STEP_DEG)) {
            c.depression_limited_by = escape_reason(m, pts, g.trunnion, -(e + STEP_DEG));
            break;
        }
        e += STEP_DEG;
    }
    c.max_depression_deg = e;
    // barrel over the hull, all round
    for k in 0..YAW_STEPS {
        let yaw = (k as f64 * 360.0 / YAW_STEPS as f64).to_radians();
        if barrel_hits_hull(m, yaw, 0.0) {
            c.barrel_blocked_yaws.push(k as f64 * 360.0 / YAW_STEPS as f64);
            c.depression_by_yaw.push(0.0);
            continue;
        }
        let mut e = 0.0;
        while e + STEP_DEG <= c.max_depression_deg + 1e-9 {
            if barrel_hits_hull(m, yaw, -(e + STEP_DEG)) {
                break;
            }
            e += STEP_DEG;
        }
        c.depression_by_yaw.push(e);
    }
    let frontal: Vec<f64> = c.depression_by_yaw.iter().enumerate().filter(|(k, _)| { let a = *k as f64 * 10.0; a <= 30.0 || a >= 330.0 }).map(|(_, v)| *v).collect();
    c.frontal_depression_deg = frontal.iter().cloned().fold(c.max_depression_deg, f64::min);
    if c.frontal_depression_deg < c.max_depression_deg - 1e-9 && c.depression_limited_by.is_none() {
        c.depression_limited_by = Some("barrel_hull".into());
    }
    // swept breech box over the usable range
    let mut sweep = Aabb::EMPTY;
    let mut e = -c.max_depression_deg;
    while e <= c.max_elevation_deg + 1e-9 {
        for p in pts {
            sweep.add(at_elevation(g.trunnion, *p, e));
        }
        e += 1.0;
    }
    c.breech_sweep = Some(sweep);
    Some(c)
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct TurretSweep {
    /// Largest horizontal distance of the turret from its axis.
    pub swept_radius_m: f64,
    /// Turret yaws (deg) at which turret and hull intersect.
    pub blocked_yaws: Vec<f64>,
}

pub fn turret_sweep(m: &Model) -> Option<TurretSweep> {
    let (tl, r) = (m.turret_local.as_ref()?, m.ring.as_ref()?);
    let swept = tl.verts.iter().map(|p| (p.x * p.x + p.z * p.z).sqrt()).fold(0.0, f64::max);
    // only hull triangles that rise above the ring plane near the turret can be in the way
    let near: Vec<[V3; 3]> = m
        .hull
        .triangles()
        .map(|(_, t)| t)
        .filter(|t| t.iter().any(|p| p.y > r.pos.y + 0.005))
        .filter(|t| t.iter().any(|p| ((p.x - r.pos.x).powi(2) + (p.z - r.pos.z).powi(2)).sqrt() < swept + 0.05))
        .collect();
    let mut out = TurretSweep { swept_radius_m: swept, blocked_yaws: vec![] };
    if near.is_empty() {
        return Some(out);
    }
    let local_tris: Vec<[V3; 3]> = tl.triangles().map(|(_, t)| t).collect();
    for k in 0..72 {
        let yaw = (k as f64 * 5.0).to_radians();
        let hit = local_tris.iter().any(|t| {
            let w = [m.turret_to_hull(t[0], yaw), m.turret_to_hull(t[1], yaw), m.turret_to_hull(t[2], yaw)];
            near.iter().any(|h| tri_tri(w, *h))
        });
        if hit {
            out.blocked_yaws.push(k as f64 * 5.0);
        }
    }
    Some(out)
}
