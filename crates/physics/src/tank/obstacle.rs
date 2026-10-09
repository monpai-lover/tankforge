//! Obstacles: boxes standing on the ground (walls, buildings, other vehicles). The tracks and the
//! hull are solid against them: points along the outline of each track belt (ground run, the
//! curve round the sprocket and idler, the upper run, at both edges of the track) and round the
//! hull box are tested against every box near the vehicle. A point inside a box is pushed out
//! through the nearest face by a stiff spring-damper force at that point, with friction along the
//! face, so the rigid body does the rest: a track scraping a wall turns the hull, a head-on wall
//! stops the vehicle.
//! (client/web/src/sim/tank/obstacles.js mirrors this file.)
use super::math::*;
use super::rigid_body::{VehicleRigidBody, GRAVITY};
use super::road_wheel::GearGeometry;

/// Spring of one point, in vehicle weights per metre of penetration.
const K: f64 = 120.0;
const ZETA: f64 = 0.9;
const MU: f64 = 0.4;
const SPACING: f64 = 0.45;

/// A box on the ground: centre (x, z), heading clockwise from +z, half extents across (hx) and
/// along (hz), bottom and top heights.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Obstacle {
    pub x: f64,
    pub z: f64,
    pub yaw: f64,
    pub hx: f64,
    pub hz: f64,
    pub y0: f64,
    pub y1: f64,
}

/// The hull box the outline includes: half width, floor, deck, half length.
#[derive(Clone, Copy, Debug)]
pub struct HullBox {
    pub hw: f64,
    pub y0: f64,
    pub y1: f64,
    pub hl: f64,
}

/// Hull-frame points of the vehicle's outline: both track belts and the hull box.
pub fn collision_points(gear: &GearGeometry, hull: HullBox) -> Vec<V3> {
    let st = &gear.stations;
    let (front, rear) = if gear.sprocket.z > gear.idler.z { (gear.sprocket, gear.idler) } else { (gear.idler, gear.sprocket) };
    let bottom = st.iter().map(|s| s.y - s.r).fold(f64::INFINITY, f64::min) - gear.thickness * 0.5 + 0.06;
    let top = st.iter().map(|s| s.y + s.r).fold(front.y + front.r, f64::max).max(rear.y + rear.r) + gear.thickness * 0.5;
    let mut outline: Vec<[f64; 2]> = Vec::new();
    let mut z = rear.z;
    while z <= front.z + 1e-6 {
        outline.push([bottom, z]);
        outline.push([top, z]);
        z += SPACING;
    }
    for (w, dir) in [(front, 1.0), (rear, -1.0)] {
        let r = w.r + gear.thickness * 0.5;
        let mut a = -std::f64::consts::FRAC_PI_2;
        while a <= std::f64::consts::FRAC_PI_2 + 1e-6 {
            outline.push([w.y + r * a.sin(), w.z + dir * r * a.cos()]);
            a += std::f64::consts::PI / 6.0;
        }
    }
    let mut pts = Vec::new();
    for side in [1.0, -1.0] {
        for edge in [-0.5, 0.5] {
            let x = side * (gear.track_x + edge * gear.track_width);
            for [y, z] in &outline {
                pts.push([x, *y, *z]);
            }
        }
    }
    for x in [-hull.hw, 0.0, hull.hw] {
        for y in [hull.y0, (hull.y0 + hull.y1) / 2.0, hull.y1] {
            let mut z = -hull.hl;
            while z <= hull.hl + 1e-6 {
                let inner = x == 0.0 && y != hull.y1 && y != hull.y0 && z.abs() < hull.hl - 1e-6;
                if !inner {
                    pts.push([x, y, z]);
                }
                z += hull.hl / 3.0;
            }
        }
    }
    pts
}

/// Pushes the hull out of the boxes; returns how many points touched.
pub fn apply_obstacles(points: &[V3], body: &mut VehicleRigidBody, boxes: &[Obstacle], dt: f64) -> usize {
    if boxes.is_empty() {
        return 0;
    }
    let mass = body.mass;
    let o = body.origin();
    let k = K * mass * GRAVITY;
    let c = 2.0 * ZETA * (k * mass / 8.0).sqrt();
    let cap = 4.0 * mass * GRAVITY;
    let mut touched = 0;
    for b in boxes {
        let reach = b.hx.hypot(b.hz) + 8.0;
        if (b.x - o[0]).powi(2) + (b.z - o[2]).powi(2) > reach * reach {
            continue;
        }
        let (sn, cs) = b.yaw.sin_cos();
        for lp in points {
            let p = body.world_point(*lp);
            if p[1] < b.y0 || p[1] > b.y1 {
                continue;
            }
            let (dx, dz) = (p[0] - b.x, p[2] - b.z);
            let u = dx * cs - dz * sn;
            let w = dx * sn + dz * cs;
            let pu = b.hx - u.abs();
            let pw = b.hz - w.abs();
            if pu <= 0.0 || pw <= 0.0 {
                continue;
            }
            let py = b.y1 - p[1];
            let (n, depth) = if py < pu && py < pw {
                ([0.0, 1.0, 0.0], py)
            } else if pu < pw {
                let s = if u >= 0.0 { 1.0 } else { -1.0 };
                ([s * cs, 0.0, -s * sn], pu)
            } else {
                let s = if w >= 0.0 { 1.0 } else { -1.0 };
                ([s * sn, 0.0, s * cs], pw)
            };
            let v = body.point_velocity(p);
            let vn = dot(v, n);
            let fn_ = (k * depth - c * vn).max(0.0).min(cap);
            if fn_ <= 0.0 {
                continue;
            }
            let vt = sub(v, scale(n, vn));
            let st = len(vt);
            let mut f = scale(n, fn_);
            if st > 1e-4 {
                let ft = (MU * fn_).min(st * mass / (8.0 * dt));
                f = madd(f, vt, -ft / st);
            }
            body.add_force_at(f, p);
            touched += 1;
        }
    }
    touched
}
