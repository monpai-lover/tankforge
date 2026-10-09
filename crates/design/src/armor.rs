//! Face armour: main plate thickness anywhere on a face (uniform, per-corner or map),
//! the face's layer stack, wall depth, and mass integrated over the real face area.
use crate::mesh::{mean_value_weights, GFace, Geo};
use crate::model::{ArmorFaceDef, ArmorLayerDef, ArmorStackDef, Body, VehicleDesign};
use crate::v3::V3;
use std::collections::HashMap;
use tg_armor::{Material, MaterialDb};

/// Armour assigned to one face: main plate plus optional outer layers.
#[derive(Clone, Debug)]
pub struct FaceArmor<'a> {
    pub main: &'a ArmorFaceDef,
    pub outer: &'a [ArmorLayerDef],
}

pub struct ArmorTable<'a> {
    map: HashMap<(Body, u32), FaceArmor<'a>>,
}

impl<'a> ArmorTable<'a> {
    pub fn new(d: &'a VehicleDesign) -> Self {
        let mut map = HashMap::new();
        let stacks: HashMap<(Body, u32), &ArmorStackDef> = d.armor_layers.iter().map(|s| ((s.body, s.face), s)).collect();
        for a in &d.armor_faces {
            let outer = stacks.get(&(a.body, a.face)).map(|s| s.layers.as_slice()).unwrap_or(&[]);
            map.insert((a.body, a.face), FaceArmor { main: a, outer });
        }
        ArmorTable { map }
    }
    pub fn get(&self, body: Body, face: u32) -> Option<&FaceArmor<'a>> {
        self.map.get(&(body, face))
    }
}

/// One plate of a stack at a particular point of the face, outermost first.
#[derive(Clone, Debug)]
pub struct LayerAt {
    pub material: String,
    pub thickness_mm: f64,
    /// Depth of the layer's outer surface below the face, measured along the face normal.
    pub depth_mm: f64,
    /// Depth occupied along the face normal (thickness / cos(tilt)).
    pub span_mm: f64,
    /// Outward normal of the plate itself (face normal tilted by the layer angle).
    pub normal: V3,
    pub main: bool,
    pub index: usize,
}

fn bilinear(map: &crate::model::ThicknessMap, s: f64, t: f64) -> f64 {
    let (nu, nv) = (map.nu.max(1) as usize, map.nv.max(1) as usize);
    let get = |i: usize, j: usize| map.values_mm.get(j * nu + i).copied().unwrap_or(0.0);
    if nu == 1 && nv == 1 {
        return get(0, 0);
    }
    let x = (s.clamp(0.0, 1.0)) * (nu - 1) as f64;
    let y = (t.clamp(0.0, 1.0)) * (nv - 1) as f64;
    let (i0, j0) = (x.floor() as usize, y.floor() as usize);
    let (i1, j1) = ((i0 + 1).min(nu - 1), (j0 + 1).min(nv - 1));
    let (fx, fy) = (x - i0 as f64, y - j0 as f64);
    let a = get(i0, j0) * (1.0 - fx) + get(i1, j0) * fx;
    let b = get(i0, j1) * (1.0 - fx) + get(i1, j1) * fx;
    a * (1.0 - fy) + b * fy
}

/// Main-plate thickness (mm) at point p on face f.
pub fn main_thickness_at(g: &Geo, f: &GFace, a: &ArmorFaceDef, p: V3) -> f64 {
    if let Some(vm) = &a.vertex_mm {
        if vm.len() == f.idx.len() {
            let poly = f.corners_2d(g);
            let w = mean_value_weights(&poly, f.to_2d(p));
            return w.iter().zip(vm.iter()).map(|(w, t)| w * t).sum::<f64>();
        }
    }
    if let Some(map) = &a.map {
        let poly = f.corners_2d(g);
        let (mut u0, mut u1, mut v0, mut v1) = (f64::INFINITY, f64::NEG_INFINITY, f64::INFINITY, f64::NEG_INFINITY);
        for (u, v) in &poly {
            u0 = u0.min(*u);
            u1 = u1.max(*u);
            v0 = v0.min(*v);
            v1 = v1.max(*v);
        }
        let (u, v) = f.to_2d(p);
        return bilinear(map, (u - u0) / (u1 - u0).max(1e-9), (v - v0) / (v1 - v0).max(1e-9));
    }
    a.thickness_mm
}

/// The whole stack at p, outermost first, with depths along the face normal.
pub fn stack_at(g: &Geo, f: &GFace, fa: &FaceArmor, p: V3) -> Vec<LayerAt> {
    let mut out = Vec::with_capacity(fa.outer.len() + 1);
    let mut depth = 0.0;
    for (i, l) in fa.outer.iter().enumerate() {
        let tilt = l.angle_deg.to_radians();
        let span = l.thickness_mm / tilt.cos().abs().max(0.2);
        // tilt about the face's horizontal axis u: the plate normal leans towards v
        let n = (f.normal * tilt.cos() + f.v * tilt.sin()).norm();
        out.push(LayerAt { material: l.material.clone(), thickness_mm: l.thickness_mm, depth_mm: depth, span_mm: span, normal: n, main: false, index: i });
        depth += span + l.spacing_mm.max(0.0);
    }
    let t = main_thickness_at(g, f, fa.main, p).max(0.0);
    out.push(LayerAt { material: fa.main.material.clone(), thickness_mm: t, depth_mm: depth, span_mm: t, normal: f.normal, main: true, index: fa.outer.len() });
    out
}

pub fn wall_depth_mm(g: &Geo, f: &GFace, fa: &FaceArmor, p: V3) -> f64 {
    stack_at(g, f, fa, p).last().map(|l| l.depth_mm + l.span_mm).unwrap_or(0.0)
}

/// Integration points over a face: (point, area weight). Each triangle is split into 16.
pub fn face_samples(g: &Geo, f: &GFace) -> Vec<(V3, f64)> {
    let mut out = Vec::with_capacity(f.tris.len() * 16);
    const N: usize = 4;
    for t in 0..f.tris.len() {
        let [a, b, c] = f.tri_points(g, t);
        let area = (b - a).cross(c - a).len() * 0.5;
        let w = area / (N * N) as f64;
        // regular subdivision into N^2 small triangles, sampled at their centroids
        for i in 0..N {
            for j in 0..N - i {
                let p = |i: f64, j: f64| a + (b - a) * (i / N as f64) + (c - a) * (j / N as f64);
                let (fi, fj) = (i as f64, j as f64);
                out.push(((p(fi, fj) + p(fi + 1.0, fj) + p(fi, fj + 1.0)) / 3.0, w));
                if i + j + 1 < N {
                    out.push(((p(fi + 1.0, fj) + p(fi + 1.0, fj + 1.0) + p(fi, fj + 1.0)) / 3.0, w));
                }
            }
        }
    }
    out
}

#[derive(Clone, Debug, Default)]
pub struct FaceMass {
    pub mass_kg: f64,
    pub com: V3,
    pub main_mean_mm: f64,
    pub main_min_mm: f64,
    pub main_max_mm: f64,
    pub wall_mean_mm: f64,
    pub wall_max_mm: f64,
    /// LOS-equivalent RHA of the stack straight through (kinetic factors), mm.
    pub rha_equiv_mm: f64,
}

/// Mass of every layer of the face, integrated over the face area (thin-shell: each layer's
/// volume is area x thickness, placed at its depth under the surface).
pub fn face_mass(g: &Geo, f: &GFace, fa: &FaceArmor, mats: &MaterialDb) -> FaceMass {
    let samples = face_samples(g, f);
    let mut m = FaceMass { main_min_mm: f64::INFINITY, main_max_mm: 0.0, ..Default::default() };
    let mut moment = V3::ZERO;
    let mut area = 0.0;
    let mut rha = 0.0;
    for (p, w) in &samples {
        let stack = stack_at(g, f, fa, *p);
        let mut wall = 0.0;
        for l in &stack {
            let rho = mats.get(&l.material).map(|m| m.density_kg_m3 as f64).unwrap_or(7850.0);
            let kg = rho * w * l.span_mm * 0.001;
            let mid = *p - f.normal * ((l.depth_mm + l.span_mm * 0.5) * 0.001);
            m.mass_kg += kg;
            moment += mid * kg;
            wall = l.depth_mm + l.span_mm;
            if l.main {
                m.main_mean_mm += l.thickness_mm * w;
                m.main_min_mm = m.main_min_mm.min(l.thickness_mm);
                m.main_max_mm = m.main_max_mm.max(l.thickness_mm);
            }
            let kf = mats.get(&l.material).map(|m| m.kinetic_factor as f64).unwrap_or(1.0);
            rha += l.span_mm * kf * w;
        }
        m.wall_mean_mm += wall * w;
        m.wall_max_mm = m.wall_max_mm.max(wall);
        area += w;
    }
    if area > 0.0 {
        m.main_mean_mm /= area;
        m.wall_mean_mm /= area;
        rha /= area;
    }
    if !m.main_min_mm.is_finite() {
        m.main_min_mm = 0.0;
    }
    m.rha_equiv_mm = rha;
    m.com = if m.mass_kg > 0.0 { moment / m.mass_kg } else { f.centroid };
    m
}

pub fn material<'a>(mats: &'a MaterialDb, id: &str) -> Option<&'a Material> {
    mats.get(id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mesh::tests::box_mesh;
    use crate::model::ThicknessMap;
    use crate::v3::v3;

    fn mats() -> MaterialDb {
        MaterialDb::from_vec(serde_json::from_str(include_str!("../../../data/materials.json")).unwrap())
    }

    fn face_def(t: f64) -> ArmorFaceDef {
        ArmorFaceDef { body: Body::Hull, face: 0, material: "rha".into(), thickness_mm: t, vertex_mm: None, map: None }
    }

    #[test]
    fn uniform_plate_mass_is_area_times_thickness_times_density() {
        let g = Geo::build(&box_mesh(v3(-1.0, 0.0, -1.0), v3(1.0, 1.0, 1.0)), |p| p);
        let f = g.face(0).unwrap(); // 2 m x 1 m front
        let a = face_def(100.0);
        let m = face_mass(&g, f, &FaceArmor { main: &a, outer: &[] }, &mats());
        assert!((m.mass_kg - 2.0 * 0.1 * 7850.0).abs() < 1e-6, "{}", m.mass_kg);
        // centre of the plate's volume lies 50 mm inside the face
        assert!((m.com.z - 0.95).abs() < 1e-9);
    }

    #[test]
    fn per_corner_thickness_interpolates_and_integrates() {
        let g = Geo::build(&box_mesh(v3(-1.0, 0.0, -1.0), v3(1.0, 1.0, 1.0)), |p| p);
        let f = g.face(0).unwrap();
        let mut a = face_def(0.0);
        // front face corners: (-1,0) (1,0) (1,1) (-1,1): 60 mm at the bottom, 120 mm at the top
        a.vertex_mm = Some(vec![60.0, 60.0, 120.0, 120.0]);
        let mid = main_thickness_at(&g, f, &a, v3(0.0, 0.5, 1.0));
        assert!((mid - 90.0).abs() < 1e-6, "{}", mid);
        assert!((main_thickness_at(&g, f, &a, v3(1.0, 1.0, 1.0)) - 120.0).abs() < 1e-6);
        let m = face_mass(&g, f, &FaceArmor { main: &a, outer: &[] }, &mats());
        assert!((m.mass_kg - 2.0 * 0.09 * 7850.0).abs() < 2.0, "{}", m.mass_kg);
    }

    #[test]
    fn thickness_map_is_bilinear_over_the_face() {
        let g = Geo::build(&box_mesh(v3(-1.0, 0.0, -1.0), v3(1.0, 1.0, 1.0)), |p| p);
        let f = g.face(0).unwrap();
        let mut a = face_def(0.0);
        // 3 x 1 map across the face: 100 at the edges, 200 in the middle
        a.map = Some(ThicknessMap { nu: 3, nv: 1, values_mm: vec![100.0, 200.0, 100.0] });
        assert!((main_thickness_at(&g, f, &a, v3(0.0, 0.5, 1.0)) - 200.0).abs() < 1e-6);
        assert!((main_thickness_at(&g, f, &a, v3(-1.0, 0.5, 1.0)) - 100.0).abs() < 1e-6);
        assert!((main_thickness_at(&g, f, &a, v3(0.5, 0.5, 1.0)) - 150.0).abs() < 1e-6);
    }

    #[test]
    fn stack_depths_include_gaps_and_tilt() {
        let g = Geo::build(&box_mesh(v3(-1.0, 0.0, -1.0), v3(1.0, 1.0, 1.0)), |p| p);
        let f = g.face(2).unwrap();
        let a = face_def(80.0);
        let outer = vec![ArmorLayerDef { material: "rha".into(), thickness_mm: 20.0, spacing_mm: 100.0, angle_deg: 0.0 }];
        let s = stack_at(&g, f, &FaceArmor { main: &a, outer: &outer }, f.centroid);
        assert_eq!(s.len(), 2);
        assert!((s[1].depth_mm - 120.0).abs() < 1e-9);
        assert!((wall_depth_mm(&g, f, &FaceArmor { main: &a, outer: &outer }, f.centroid) - 200.0).abs() < 1e-9);
    }
}
