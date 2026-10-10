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

/// A foldable wall's hinge, authored in the hull frame.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ArmorHinge {
    pub a: [f32; 3],
    pub b: [f32; 3],
    /// Outward folding rotation around a -> b, in degrees. Hull-mounted plates only.
    pub angle: f32,
}

/// A rectangular armor plate in vehicle-local space. MVP geometry; the full
/// `ArmorVolume` replaces this later behind the same `intersect` contract.
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hinge: Option<ArmorHinge>,
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
    /// Same hull hinge as the visible wall. The plate outline and protection values retain
    /// their identities; only its center and orthonormal surface axes move.
    pub fn folded(&self, fraction: f32) -> Self {
        let (center, normal, axis_u) = self.folded_geometry(fraction);
        Self { center, normal, axis_u, ..self.clone() }
    }

    /// Current fold geometry without cloning strings or polygon storage.
    pub fn folded_geometry(&self, fraction: f32) -> (Vec3, Vec3, Vec3) {
        let unchanged = (self.center, self.normal, self.axis_u);
        let Some(h) = &self.hinge else { return unchanged };
        let t = if fraction.is_finite() { fraction.clamp(0.0, 1.0) } else { 0.0 };
        if t == 0.0 || !h.angle.is_finite() || !h.a.iter().chain(&h.b).all(|v| v.is_finite()) { return unchanged; }
        let a = Vec3::new(h.a[0], h.a[1], h.a[2]);
        let edge = Vec3::new(h.b[0], h.b[1], h.b[2]) - a;
        let length = edge.length();
        if !length.is_finite() || length < 1e-6 { return unchanged; }
        let axis = edge * (1.0 / length);
        let (s, c) = (h.angle.to_radians() * t).sin_cos();
        let turn = |v: Vec3| v * c + axis.cross(v) * s + axis * (axis.dot(v) * (1.0 - c));
        (a + turn(self.center - a), turn(self.normal).normalized(), turn(self.axis_u).normalized())
    }

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
            hinge: None,
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

    #[test]
    fn a_hull_hinge_moves_the_armor_surface_and_its_ray_intersections() {
        let mut p = plate();
        p.center = Vec3::new(0.0, 1.0, 1.0);
        p.hinge = Some(ArmorHinge { a: [-1.0, 0.0, 1.0], b: [1.0, 0.0, 1.0], angle: 90.0 });
        let q = p.folded(1.0);
        assert!((q.center - Vec3::new(0.0, 0.0, 2.0)).length() < 1e-5);
        assert!((q.normal - Vec3::new(0.0, -1.0, 0.0)).length() < 1e-5);
        assert!(p.intersect(Vec3::new(0.0, 1.0, 10.0), Vec3::new(0.0, 0.0, -1.0)).is_some());
        assert!(q.intersect(Vec3::new(0.0, 1.0, 10.0), Vec3::new(0.0, 0.0, -1.0)).is_none());
        assert!(q.intersect(Vec3::new(0.0, 10.0, 2.0), Vec3::new(0.0, -1.0, 0.0)).is_some());
        let halfway = p.folded(0.5);
        assert!((halfway.center - Vec3::new(0.0, 0.5f32.sqrt(), 1.0 + 0.5f32.sqrt())).length() < 1e-5);
        assert_eq!(q.id, p.id);
        assert_eq!(q.thickness_mm, p.thickness_mm);
        assert_eq!(q.polygon, p.polygon);
    }

    #[test]
    fn hinge_fraction_and_bad_axes_cannot_create_nonfinite_armor() {
        let mut p = plate();
        p.center = Vec3::new(0.0, 1.0, 1.0);
        p.hinge = Some(ArmorHinge { a: [-1.0, 0.0, 1.0], b: [1.0, 0.0, 1.0], angle: 90.0 });
        assert_eq!(p.folded(f32::NAN).center, p.center);
        assert_eq!(p.folded(-1.0).center, p.center);
        assert_eq!(p.folded(2.0).center, p.folded(1.0).center);
        let a = p.hinge.as_ref().unwrap().a;
        p.hinge.as_mut().unwrap().b = a;
        assert_eq!(p.folded(1.0).center, p.center);
        assert_eq!(p.folded(1.0).normal, p.normal);
    }
}
