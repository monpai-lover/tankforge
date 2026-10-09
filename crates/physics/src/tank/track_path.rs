//! TrackPathSystem: the visual track as one continuous closed path in the hull's z-y plane:
//! along the ground under every road wheel (rear to front, lying over the ground where the ground
//! rises above the straight run between two wheels), up round the front road wheel to the front
//! sprocket / idler and round it, back along the top (hanging between its supports), down round
//! the rear sprocket / idler and back under the rear road wheel. Rebuilt from where the wheels are
//! every frame, it keeps the length the track was made with: when the ground run takes up more
//! track the top pulls tight and the idler's tensioner gives a little; when the wheels close up
//! the slack hangs on top. Links are placed by arc length along the path, each along its tangent.
//! (client/web/src/gfx/track.js mirrors this file.)
use super::road_wheel::{GearGeometry, Wheel};
use std::f64::consts::TAU;

/// How far the idler's tensioner can give, m.
pub const MAX_TENSION: f64 = 0.08;

#[derive(Clone, Copy, Debug)]
struct Circle {
    z: f64,
    y: f64,
    r: f64,
}

/// One track's centre line: points [z, y] (closed), running length at each point.
#[derive(Clone, Debug, Default)]
pub struct TrackLoop {
    pub pts: Vec<[f64; 2]>,
    pub cum: Vec<f64>,
    pub length: f64,
    /// Droop chosen for the upper run (1/m), and how far the idler moved (+ forward).
    pub sag: f64,
    pub idler_shift: f64,
    pub sprocket_front: bool,
    front: [f64; 3],
    rear: [f64; 3],
}

/// Direction (angle in the z-y plane) of the belt running from circle a to circle b, both on its left.
fn tangent_angle(a: Circle, b: Circle) -> f64 {
    let (dz, dy) = (b.z - a.z, b.y - a.y);
    let len = dz.hypot(dy).max(1e-6);
    dy.atan2(dz) + ((a.r - b.r) / len).clamp(-1.0, 1.0).asin()
}

fn on_circle(c: Circle, travel: f64) -> [f64; 2] {
    [c.z + c.r * travel.sin(), c.y - c.r * travel.cos()]
}

/// The loop for wheels lifted by `lifts` (per station, from static), upper-run droop `sag`, the
/// ground under this track as a function of hull-frame z (optional), and the idler moved by
/// `idler_shift` along z.
pub fn build_loop(g: &GearGeometry, lifts: &[f64], sag: f64, ground: Option<&dyn Fn(f64) -> f64>, idler_shift: f64) -> TrackLoop {
    let h = g.thickness / 2.0;
    let circle = |c: &Wheel, lift: f64| Circle { z: c.z, y: c.y + lift, r: c.r + h };
    let wheels: Vec<Circle> = g.stations.iter().enumerate().map(|(i, s)| circle(s, lifts.get(i).copied().unwrap_or(0.0))).collect();
    let idler = Wheel { z: g.idler.z + idler_shift, ..g.idler };
    let sprocket_front = g.sprocket.z > idler.z;
    let front = circle(if sprocket_front { &g.sprocket } else { &idler }, 0.0);
    let rear = circle(if sprocket_front { &idler } else { &g.sprocket }, 0.0);
    let first_w = wheels[0];
    let last_w = wheels[wheels.len() - 1];
    // what the upper run rests on: return rollers, or the tops of the road wheels (slack track)
    let mut supports: Vec<Circle> = if g.rollers.is_empty() { wheels.clone() } else { g.rollers.iter().map(|r| circle(r, 0.0)).collect() };
    supports.retain(|c| c.z < front.z - 0.05 && c.z > rear.z + 0.05);
    supports.sort_by(|a, b| b.z.total_cmp(&a.z));
    let supports: Vec<Circle> = supports.iter().map(|c| Circle { z: c.z, y: c.y + c.r, r: 0.0 }).collect();

    let mut pts: Vec<[f64; 2]> = Vec::with_capacity(256);
    let arc = |pts: &mut Vec<[f64; 2]>, c: Circle, from: f64, to: f64| {
        // belt direction turns from `from` to `to`, counter-clockwise
        let mut d = (to - from) % TAU;
        if d < 0.0 {
            d += TAU;
        }
        if d > TAU - 1e-3 {
            d = 0.0;
        }
        let n = ((d / 0.2).ceil() as usize).max(1);
        for i in 1..=n {
            pts.push(on_circle(c, from + d * i as f64 / n as f64));
        }
    };
    let hang = |pts: &mut Vec<[f64; 2]>, a: [f64; 2], b: [f64; 2]| {
        // free span from a to b, drooping as a parabola
        let span = (b[0] - a[0]).hypot(b[1] - a[1]);
        let depth = (sag * span * span).min(span * 0.2);
        let n = ((span / 0.14).ceil() as usize).max(1);
        for i in 1..=n {
            let u = i as f64 / n as f64;
            pts.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u - 4.0 * depth * u * (1.0 - u)]);
        }
    };
    // straight run from the last point to b, draped over the ground where the ground is higher
    let drape = |pts: &mut Vec<[f64; 2]>, b: [f64; 2]| {
        let a = *pts.last().unwrap();
        let span = (b[0] - a[0]).hypot(b[1] - a[1]);
        let n = if ground.is_some() { ((span / 0.11).ceil() as usize).max(1) } else { 1 };
        for i in 1..=n {
            let u = i as f64 / n as f64;
            let z = a[0] + (b[0] - a[0]) * u;
            let mut y = a[1] + (b[1] - a[1]) * u;
            if let Some(gf) = ground {
                if i < n {
                    y = y.max(gf(z) + h);
                }
            }
            pts.push([z, y]);
        }
    };

    // ground run: under every road wheel, rear to front
    pts.push([last_w.z, last_w.y - last_w.r]);
    for w in wheels.iter().rev().skip(1) {
        drape(&mut pts, [w.z, w.y - w.r]);
    }
    // up round the front road wheel, across to the front sprocket / idler and round it
    let up = tangent_angle(first_w, front);
    arc(&mut pts, first_w, 0.0, up);
    drape(&mut pts, on_circle(front, up));
    let first_top = supports.first().copied().unwrap_or(rear);
    let top_out = tangent_angle(front, first_top);
    arc(&mut pts, front, up, top_out);
    // upper run, front to rear
    let mut prev = on_circle(front, top_out);
    for s in &supports {
        hang(&mut pts, prev, [s.z, s.y]);
        prev = [s.z, s.y];
    }
    let last_top = supports.last().copied().unwrap_or(front);
    let top_in = tangent_angle(last_top, rear);
    hang(&mut pts, prev, on_circle(rear, top_in));
    // down round the rear sprocket / idler and back under the rear road wheel
    let down = tangent_angle(rear, last_w);
    arc(&mut pts, rear, top_in, down);
    drape(&mut pts, on_circle(last_w, down));
    arc(&mut pts, last_w, down, TAU);

    let n = pts.len();
    let mut cum = vec![0.0; n + 1];
    for i in 0..n {
        let j = (i + 1) % n;
        cum[i + 1] = cum[i] + (pts[j][0] - pts[i][0]).hypot(pts[j][1] - pts[i][1]);
    }
    let length = cum[n];
    TrackLoop { pts, cum, length, sag, idler_shift, sprocket_front, front: [front.z, front.y, front.r], rear: [rear.z, rear.y, rear.r] }
}

/// The loop with the upper run's droop chosen so the whole track has `length`: pulled tight, the
/// idler's tensioner takes up to `max_tension`; slack, the top hangs lower. `bias` shifts the
/// droop a little (drive tension, swing).
pub fn fit_loop(g: &GearGeometry, lifts: &[f64], ground: Option<&dyn Fn(f64) -> f64>, length: f64, bias: f64, max_tension: f64) -> TrackLoop {
    let (mut lo, mut hi) = (0.0f64, 0.3f64);
    let tight = build_loop(g, lifts, lo, ground, 0.0);
    if tight.length >= length {
        let excess = tight.length - length;
        let shift = (excess / 2.0).min(max_tension);
        if shift > 1e-4 {
            let inward = if g.idler.z > 0.0 { -1.0 } else { 1.0 };
            return build_loop(g, lifts, lo, ground, inward * shift);
        }
        return tight;
    }
    for _ in 0..7 {
        let mid = 0.5 * (lo + hi);
        if build_loop(g, lifts, mid, ground, 0.0).length < length {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    let sag = (0.5 * (lo + hi) * bias).min(0.3);
    build_loop(g, lifts, sag, ground, 0.0)
}

/// A link placed on the loop: pin-to-pin midpoint (z, y) and its pitch angle (rad, nose up +).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LinkPose {
    pub z: f64,
    pub y: f64,
    pub angle: f64,
}

impl TrackLoop {
    /// Point at arc length `s` (wrapped) and the segment index.
    pub fn point_at(&self, s: f64) -> [f64; 2] {
        let s = s.rem_euclid(self.length.max(1e-9));
        let n = self.pts.len();
        let mut seg = match self.cum.binary_search_by(|c| c.total_cmp(&s)) {
            Ok(i) => i,
            Err(i) => i.saturating_sub(1),
        };
        seg = seg.min(n - 1);
        let (a, b) = (self.pts[seg], self.pts[(seg + 1) % n]);
        let l = self.cum[seg + 1] - self.cum[seg];
        let k = if l > 1e-9 { (s - self.cum[seg]) / l } else { 0.0 };
        [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]
    }

    /// `count` links, pin to pin, after the track has run `offset` metres.
    pub fn place_links(&self, count: usize, offset: f64) -> (Vec<[f64; 2]>, Vec<LinkPose>) {
        let pitch = self.length / count as f64;
        let s0 = offset.rem_euclid(pitch);
        let pins: Vec<[f64; 2]> = (0..count).map(|i| self.point_at(s0 + pitch * i as f64)).collect();
        let links = (0..count)
            .map(|i| {
                let (a, b) = (pins[i], pins[(i + 1) % count]);
                LinkPose { z: (a[0] + b[0]) / 2.0, y: (a[1] + b[1]) / 2.0, angle: (b[1] - a[1]).atan2(b[0] - a[0]) }
            })
            .collect();
        (pins, links)
    }

    /// Rotation that puts a sprocket tooth into the link sitting on the middle of its wrap.
    pub fn sprocket_phase(&self, pins: &[[f64; 2]], teeth: usize) -> f64 {
        let c = if self.sprocket_front { self.front } else { self.rear };
        let count = pins.len();
        let mid = |i: usize| {
            let (a, b) = (pins[i], pins[(i + 1) % count]);
            ((a[0] + b[0]) / 2.0 - c[0], (a[1] + b[1]) / 2.0 - c[1])
        };
        let mut best = None;
        let mut best_d = f64::INFINITY;
        for i in 0..count {
            let (z, y) = mid(i);
            let outward = if self.sprocket_front { z } else { -z };
            let d = (z.hypot(y) - c[2]).abs() - outward * 0.2;
            if d < best_d {
                best_d = d;
                best = Some(i);
            }
        }
        let Some(b) = best else { return 0.0 };
        let (z, y) = mid(b);
        let step = TAU / teeth.max(1) as f64;
        (std::f64::consts::FRAC_PI_2 - y.atan2(z)).rem_euclid(step)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gear() -> GearGeometry {
        let stations = (0..5).map(|i| Wheel { z: 1.6 - 0.8 * i as f64, y: 0.4, r: 0.33 }).collect();
        GearGeometry { stations, track_x: 1.2, track_width: 0.5, thickness: 0.08, sprocket: Wheel { z: 2.5, y: 0.7, r: 0.32 }, idler: Wheel { z: -2.4, y: 0.6, r: 0.3 }, rollers: vec![], sag: 0.03 }
    }

    #[test]
    fn the_track_keeps_its_length_whatever_the_wheels_do() {
        let g = gear();
        let level = vec![0.0; 5];
        let made = build_loop(&g, &level, 0.03, None, 0.0).length;
        let fitted = fit_loop(&g, &level, None, made, 1.0, MAX_TENSION);
        assert!((fitted.length - made).abs() < 0.01 && (fitted.sag - 0.03).abs() < 0.005, "{} {}", fitted.length, fitted.sag);
        // wheels pushed up and down: the fitted loop keeps the made length (within the tensioner)
        for lifts in [vec![0.12, 0.0, -0.05, 0.08, 0.0], vec![-0.06; 5], vec![0.15; 5]] {
            let l = fit_loop(&g, &lifts, None, made, 1.0, MAX_TENSION);
            assert!((l.length - made).abs() < 0.03 || l.idler_shift.abs() > 0.0, "{} vs {made}", l.length);
            // one closed path: no segment longer than the longest straight run, the end meets the start
            for w in l.pts.windows(2) {
                assert!((w[1][0] - w[0][0]).hypot(w[1][1] - w[0][1]) < 1.2);
            }
            let (a, b) = (l.pts[0], l.pts[l.pts.len() - 1]);
            assert!((a[0] - b[0]).hypot(a[1] - b[1]) < 0.25);
        }
        // wheels hanging down pull the track tight: the tensioner lets the (rear) idler in
        let tight = fit_loop(&g, &[-0.1; 5], None, made, 1.0, MAX_TENSION);
        assert!(tight.idler_shift > 0.0 && tight.idler_shift <= MAX_TENSION && tight.sag == 0.0, "{}", tight.idler_shift);
        // wheels pushed up leave slack: the top hangs lower
        let slack = fit_loop(&g, &[0.1; 5], None, made, 1.0, MAX_TENSION);
        assert!(slack.sag > 0.03 && slack.idler_shift == 0.0);
        // the ground run lies over a hump between two wheels
        let hump = |z: f64| if (z - 1.2).abs() < 0.1 { 0.06 } else { -1.0 };
        let l = build_loop(&g, &level, 0.03, Some(&hump), 0.0);
        let bottom = g.stations[0].y - g.stations[0].r - 0.04;
        assert!(l.pts.iter().any(|p| (p[0] - 1.2).abs() < 0.06 && p[1] > bottom + 0.05));
    }

    #[test]
    fn links_sit_pin_to_pin_along_the_tangent() {
        let g = gear();
        let l = build_loop(&g, &[0.0; 5], 0.03, None, 0.0);
        let count = (l.length / 0.15).round() as usize;
        let (pins, links) = l.place_links(count, 0.37);
        assert_eq!(pins.len(), count);
        let pitch = l.length / count as f64;
        for (i, k) in links.iter().enumerate() {
            let (a, b) = (pins[i], pins[(i + 1) % count]);
            let d = (b[0] - a[0]).hypot(b[1] - a[1]);
            assert!(d <= pitch + 1e-6 && d > 0.85 * pitch, "link {i} {d} {pitch}");
            assert!((k.angle - (b[1] - a[1]).atan2(b[0] - a[0])).abs() < 1e-9);
        }
        // the ground run links lie flat, the ones round the sprocket turn
        let flat = links.iter().filter(|k| k.y < 0.1 && k.z.abs() < 1.0).all(|k| k.angle.abs() < 0.05);
        assert!(flat);
        // running on by one pitch gives the same picture; by a quarter pitch every pin moves on a
        // quarter pitch along the path
        let (same, _) = l.place_links(count, 0.37 + pitch);
        assert!((same[0][0] - pins[0][0]).abs() < 1e-6 && (same[0][1] - pins[0][1]).abs() < 1e-6);
        let (moved, _) = l.place_links(count, 0.37 + pitch / 4.0);
        let d = (moved[0][0] - pins[0][0]).hypot(moved[0][1] - pins[0][1]);
        assert!((d - pitch / 4.0).abs() < 1e-6, "{d}");
        let ph = l.sprocket_phase(&pins, 20);
        assert!((0.0..TAU / 20.0).contains(&ph));
    }
}
