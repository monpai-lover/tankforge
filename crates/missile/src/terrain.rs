//! The ground as a height grid: what missiles fly into and what blocks the radar's view.
//! Read exactly as client/web/src/game/battlemap.js reads it (bilinear between texel centres,
//! clamped at the edges), so the server and the browser agree on where the ground is.
use crate::v::V3;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct HeightGrid {
    /// West/south corner (m) and side length of the square it covers.
    pub x0: f64,
    pub z0: f64,
    pub size: f64,
    /// Samples per side.
    pub res: usize,
    /// res * res heights (m), row by row from z0.
    pub heights: Vec<f32>,
}

impl HeightGrid {
    pub fn flat() -> HeightGrid {
        HeightGrid { x0: -1.0, z0: -1.0, size: 2.0, res: 2, heights: vec![0.0; 4] }
    }

    pub fn height(&self, x: f64, z: f64) -> f64 {
        let n = self.res;
        if n < 2 || self.heights.len() < n * n {
            return 0.0;
        }
        let nf = n as f64;
        let u = (((x - self.x0) / self.size) * nf - 0.5).clamp(0.0, nf - 1.001);
        let v = (((z - self.z0) / self.size) * nf - 0.5).clamp(0.0, nf - 1.001);
        let i = u.floor() as usize;
        let j = v.floor() as usize;
        let fu = u - i as f64;
        let fv = v - j as f64;
        let h = &self.heights;
        let a = h[j * n + i] as f64;
        let b = h[j * n + i + 1] as f64;
        let c = h[(j + 1) * n + i] as f64;
        let d = h[(j + 1) * n + i + 1] as f64;
        (a * (1.0 - fu) + b * fu) * (1.0 - fv) + (c * (1.0 - fu) + d * fu) * fv
    }

    /// The ground does not rise within `clear` m of the straight line a -> b.
    pub fn line_clear(&self, a: V3, b: V3, clear: f64) -> bool {
        let d = ((b[0] - a[0]).powi(2) + (b[2] - a[2]).powi(2)).sqrt();
        let cell = (self.size / self.res.max(1) as f64).max(1.0);
        let n = ((d / cell).ceil() as usize).clamp(2, 4000);
        // the ends sit on vehicles and missiles: only the stretch between them counts
        for k in 1..n {
            let t = k as f64 / n as f64;
            let p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
            if self.height(p[0], p[2]) > p[1] - clear {
                return false;
            }
        }
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bilinear_between_texel_centres_and_a_hill_blocks_the_view() {
        // 4 x 4 samples over 40 m: texel centres at 5, 15, 25, 35 m from the corner
        let mut h = vec![0.0f32; 16];
        h[1 * 4 + 1] = 10.0;
        let g = HeightGrid { x0: 0.0, z0: 0.0, size: 40.0, res: 4, heights: h };
        assert!((g.height(15.0, 15.0) - 10.0).abs() < 1e-9);
        assert!((g.height(20.0, 15.0) - 5.0).abs() < 1e-9);
        assert_eq!(g.height(-100.0, -100.0), 0.0);
        assert!(!g.line_clear([0.0, 2.0, 15.0], [40.0, 2.0, 15.0], 0.3));
        assert!(g.line_clear([0.0, 12.0, 15.0], [40.0, 12.0, 15.0], 0.3));
    }
}
