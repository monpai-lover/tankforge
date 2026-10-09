//! Armor data model + plate/ray geometry. Pure data and geometry, no ballistics.
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tg_shared::Vec3;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ArmorKind {
    Rha,
    Cha,
    HighHardnessSteel,
    Aluminium,
    Spaced,
    Composite,
    Applied,
    Skirt,
    Era,
}

/// Material properties. `kinetic_factor` / `chemical_factor` are multipliers on the
/// line-of-sight thickness relative to RHA (1.0 = RHA). All values are data.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Material {
    pub id: String,
    pub kind: ArmorKind,
    pub density_kg_m3: f32,
    pub hardness_bhn: f32,
    pub kinetic_factor: f32,
    pub chemical_factor: f32,
}

#[derive(Clone, Debug, Default)]
pub struct MaterialDb {
    map: HashMap<String, Material>,
}

impl MaterialDb {
    pub fn from_vec(v: Vec<Material>) -> Self {
        Self { map: v.into_iter().map(|m| (m.id.clone(), m)).collect() }
    }
    pub fn get(&self, id: &str) -> Option<&Material> {
        self.map.get(id)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ArmorZone {
    HullUpperFront,
    HullLowerFront,
    HullSide,
    HullRear,
    HullRoof,
    HullFloor,
    TurretFront,
    TurretSide,
    TurretRear,
    TurretRoof,
    GunMantlet,
    Skirt,
    Other,
}

/// A rectangular armor plate in vehicle-local space. MVP geometry; the full
/// `ArmorVolume` (convex mesh with per-face thickness) replaces this later behind
/// the same `intersect` contract.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ArmorPlate {
    pub id: String,
    pub zone: ArmorZone,
    pub material: String,
    pub thickness_mm: f32,
    pub center: Vec3,
    /// Outward unit normal.
    pub normal: Vec3,
    /// Unit vector in the plane; v axis = normal x axis_u.
    pub axis_u: Vec3,
    pub half_u: f32,
    pub half_v: f32,
    /// Reserved: curvature (1/m) for cast/curved plates. Not yet used by penetration.
    #[serde(default)]
    pub curvature: f32,
    /// The plate's exact outline as a polygon in its own (u, v) coordinates (from the centre,
    /// along axis_u and normal x axis_u), for plates that are not rectangles (imported damage
    /// models); the rectangle half_u x half_v must contain it. Empty: the full rectangle.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub polygon: Vec<[f32; 2]>,
}

/// Point-in-polygon (even-odd rule) in the plate's (u, v) plane.
pub fn inside_polygon(poly: &[[f32; 2]], u: f32, v: f32) -> bool {
    let mut inside = false;
    let n = poly.len();
    let mut j = n.wrapping_sub(1);
    for i in 0..n {
        let (a, b) = (poly[i], poly[j]);
        if (a[1] > v) != (b[1] > v) && u < (b[0] - a[0]) * (v - a[1]) / (b[1] - a[1]) + a[0] {
            inside = !inside;
        }
        j = i;
    }
    inside
}

#[derive(Clone, Copy, Debug)]
pub struct PlateHit {
    pub distance: f32,
    pub point: Vec3,
    /// Normal flipped to face the incoming ray.
    pub facing_normal: Vec3,
    pub incidence_deg: f32,
}

impl ArmorPlate {
    /// Ray vs plate. `dir` must be unit length.
    pub fn intersect(&self, origin: Vec3, dir: Vec3) -> Option<PlateHit> {
        let denom = self.normal.dot(dir);
        if denom.abs() < 1e-6 {
            return None;
        }
        let t = (self.center - origin).dot(self.normal) / denom;
        if t <= 0.0 {
            return None;
        }
        let point = origin + dir * t;
        let rel = point - self.center;
        let u = rel.dot(self.axis_u);
        let v = rel.dot(self.normal.cross(self.axis_u));
        if u.abs() > self.half_u || v.abs() > self.half_v {
            return None;
        }
        if self.polygon.len() >= 3 && !inside_polygon(&self.polygon, u, v) {
            return None;
        }
        let facing_normal = if denom > 0.0 { -self.normal } else { self.normal };
        let cos = (-dir).dot(facing_normal).clamp(0.0, 1.0);
        Some(PlateHit { distance: t, point, facing_normal, incidence_deg: cos.acos().to_degrees() })
    }
}

/// Nearest plate hit along the segment `origin + dir * [0, max_dist]`.
pub fn first_hit(plates: &[ArmorPlate], origin: Vec3, dir: Vec3, max_dist: f32) -> Option<(usize, PlateHit)> {
    let mut best: Option<(usize, PlateHit)> = None;
    for (i, p) in plates.iter().enumerate() {
        if let Some(h) = p.intersect(origin, dir) {
            if h.distance <= max_dist && best.map_or(true, |(_, b)| h.distance < b.distance) {
                best = Some((i, h));
            }
        }
    }
    best
}

/// Line-of-sight thickness: t / cos(theta), theta measured from the plate normal.
pub fn los_thickness_mm(thickness_mm: f32, incidence_deg: f32) -> f32 {
    thickness_mm / incidence_deg.to_radians().cos().max(0.01)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plate() -> ArmorPlate {
        ArmorPlate {
            id: "p".into(),
            zone: ArmorZone::HullSide,
            material: "rha".into(),
            thickness_mm: 80.0,
            center: Vec3::new(0.0, 0.0, 1.0),
            normal: Vec3::new(0.0, 0.0, 1.0),
            axis_u: Vec3::new(1.0, 0.0, 0.0),
            half_u: 1.0,
            half_v: 1.0,
            curvature: 0.0,
            polygon: Vec::new(),
        }
    }

    #[test]
    fn los_60_degrees_doubles_thickness() {
        assert!((los_thickness_mm(80.0, 60.0) - 160.0).abs() < 0.01);
        assert!((los_thickness_mm(100.0, 0.0) - 100.0).abs() < 1e-4);
    }

    #[test]
    fn head_on_hit_has_zero_incidence() {
        let h = plate().intersect(Vec3::new(0.0, 0.0, 10.0), Vec3::new(0.0, 0.0, -1.0)).unwrap();
        assert!(h.incidence_deg < 0.01);
        assert!((h.distance - 9.0).abs() < 1e-4);
    }

    #[test]
    fn out_of_bounds_misses() {
        assert!(plate().intersect(Vec3::new(5.0, 0.0, 10.0), Vec3::new(0.0, 0.0, -1.0)).is_none());
    }

    #[test]
    fn sixty_degree_incidence_measured_from_normal() {
        let d = Vec3::new(60f32.to_radians().sin(), 0.0, -60f32.to_radians().cos());
        let origin = Vec3::new(0.0, 0.0, 1.0) - d * 10.0;
        let h = plate().intersect(origin, d).unwrap();
        assert!((h.incidence_deg - 60.0).abs() < 0.01);
    }
}
