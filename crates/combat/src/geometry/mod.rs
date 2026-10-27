//! X1 geometry diagnostics. Audit-pending manifests do not authorize gameplay damage.
pub mod bvh;
pub mod combat_scene;
pub mod manifest;
pub mod ray;
pub mod surface;
#[cfg(test)]
mod tests;
use bvh::{Bounds, Bvh};
use manifest::{HitMeshManifestV1, InstanceRecord, MeshData};
use ray::{multiply, transform, Affine, Point};
use std::{collections::HashMap, sync::Arc};
use surface::{QueryContext, SurfaceCrossingV1};
pub const MAX_MESH_BYTES: usize = 32 * 1024 * 1024;
pub const MAX_TRIANGLES: usize = 1_000_000;
pub const MAX_CROSSINGS: usize = 262_144;
pub const MAX_OCCUPANCY_TRIANGLE_TESTS: u64 = 8_000_000;
pub const MAX_OCCUPANCY_PREDICATE_PRODUCTS: u64 = 16_000_000;
#[cfg(test)]
std::thread_local! {
    static SURFACE_TRIANGLE_VISITS: std::cell::Cell<u64> = const { std::cell::Cell::new(0) };
    static SURFACE_KEY_COMPARISONS: std::cell::Cell<u64> = const { std::cell::Cell::new(0) };
}
#[cfg(test)]
pub(crate) fn surface_triangle_visits_for_test() -> u64 {
    SURFACE_TRIANGLE_VISITS.with(std::cell::Cell::get)
}
#[cfg(test)]
pub(crate) fn surface_key_comparisons_for_test() -> u64 {
    SURFACE_KEY_COMPARISONS.with(std::cell::Cell::get)
}
#[derive(Clone, Debug, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryStats {
    pub tlas_node_visits: u64,
    pub blas_node_visits: u64,
    pub tlas_bounds_tests: u64,
    pub blas_bounds_tests: u64,
    pub candidate_instances: u64,
    pub candidate_triangles: u64,
    pub triangle_tests: u64,
    pub raw_crossings: u64,
    pub crossings: u64,
    pub event_capacity: usize,
    pub occupancy_triangle_tests: u64,
    pub occupancy_point_tests: u64,
    pub occupancy_ray_attempts: u64,
    pub occupancy_predicate_products: u64,
}
#[derive(Clone, Debug, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreMemoryStats {
    pub immutable_meshes: usize,
    pub payload_bytes: usize,
    pub vertex_index_array_bytes: usize,
    pub blas_nodes: usize,
    pub blas_array_bytes: usize,
    pub pointer_bytes: usize,
}
#[derive(Clone, Debug, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneMemoryStats {
    pub instances: usize,
    pub instance_array_bytes: usize,
    pub surface_index_array_bytes: usize,
    pub tlas_nodes: usize,
    pub tlas_array_bytes: usize,
    pub query_array_bytes: usize,
}
fn bvh_array_bytes(b: &Bvh) -> usize {
    b.nodes.capacity() * std::mem::size_of::<bvh::BvhNode>()
        + b.order.capacity() * std::mem::size_of::<u32>()
}
#[derive(Debug)]
pub struct ImmutableMesh {
    pub data: MeshData,
    pub bvh: Bvh,
}
#[derive(Default)]
pub struct MeshStore {
    meshes: HashMap<String, Arc<ImmutableMesh>>,
    payloads: HashMap<String, Arc<ImmutableMesh>>,
    bytes: usize,
}
impl MeshStore {
    pub fn install(&mut self, bytes: &[u8], expected: &str) -> Result<Arc<ImmutableMesh>, String> {
        if let Some(m) = self.payloads.get(expected) {
            manifest::check_hash(bytes, expected)?;
            return Ok(m.clone());
        }
        let data = MeshData::load(bytes, expected)?;
        // The full position stream and original triangle indices define immutable acceleration.
        let key = format!("{}:{}", data.position_hash, data.payload_hash);
        let mesh = if let Some(m) = self.meshes.get(&key) {
            m.clone()
        } else {
            if self.meshes.len() >= 4096
                || self
                    .bytes
                    .checked_add(bytes.len())
                    .ok_or("mesh-store size overflow")?
                    > 256 * 1024 * 1024
            {
                return Err("mesh-store capacity exceeded".into());
            }
            let bvh = Bvh::build(&data.triangle_bounds())?;
            let m = Arc::new(ImmutableMesh { data, bvh });
            self.bytes += bytes.len();
            self.meshes.insert(key, m.clone());
            m
        };
        self.payloads.insert(expected.into(), mesh.clone());
        Ok(mesh)
    }
    pub fn get(&self, hash: &str) -> Option<Arc<ImmutableMesh>> {
        self.payloads.get(hash).cloned()
    }
    pub fn stats(&self) -> (usize, usize) {
        (self.meshes.len(), self.bytes)
    }
    pub fn memory_stats(&self) -> StoreMemoryStats {
        StoreMemoryStats {
            immutable_meshes: self.meshes.len(),
            payload_bytes: self.bytes,
            vertex_index_array_bytes: self
                .meshes
                .values()
                .map(|m| {
                    m.data.positions.capacity() * std::mem::size_of::<[f32; 3]>()
                        + m.data.indices.capacity() * std::mem::size_of::<[u32; 3]>()
                })
                .sum(),
            blas_nodes: self.meshes.values().map(|m| m.bvh.nodes.len()).sum(),
            blas_array_bytes: self.meshes.values().map(|m| bvh_array_bytes(&m.bvh)).sum(),
            pointer_bytes: std::mem::size_of::<usize>(),
        }
    }
    pub fn collect_unused(&mut self) {
        self.payloads.retain(|_, m| Arc::strong_count(m) > 2);
        self.meshes.retain(|_, m| Arc::strong_count(m) > 1);
        self.bytes = self
            .meshes
            .values()
            .map(|m| 32 + m.data.positions.len() * 12 + m.data.indices.len() * 12)
            .sum();
    }
}
#[derive(Clone)]
struct Instance {
    record: InstanceRecord,
    mesh: Arc<ImmutableMesh>,
    mesh_record: usize,
    affine: Affine,
    bounds: Bounds,
}
fn world_bounds(local: Bounds, m: &Affine) -> Result<Bounds, String> {
    let mut b = Bounds::empty();
    for i in 0..8 {
        let p = std::array::from_fn(|k| {
            if i & (1 << k) == 0 {
                local.lo[k]
            } else {
                local.hi[k]
            }
        });
        b = b.union(Bounds::point(transform(&m.forward, p)));
    }
    if !b.valid() {
        return Err("world bounds overflow".into());
    }
    Ok(b)
}
pub struct Geometry {
    manifest_file_hash: String,
    pub manifest: HitMeshManifestV1,
    instances: Vec<Instance>,
    range_surface_ordinals: Vec<Vec<usize>>,
    tlas: Bvh,
    stack: Vec<u32>,
    candidates: Vec<u32>,
    blas_stack: Vec<u32>,
    triangles: Vec<u32>,
    events: Vec<SurfaceCrossingV1>,
    occupancy_contacts: Vec<(u32, f64)>,
    query_stats: QueryStats,
}
impl Geometry {
    pub fn register(bytes: &[u8], expected: &str, store: &MeshStore) -> Result<Self, String> {
        let manifest = HitMeshManifestV1::load(bytes, expected)?;
        // Manifest validation pins unique surface keys and complete, nonempty
        // mesh ranges. Index once per mesh/range, never per instance or burst.
        let surface_ordinals:HashMap<_,_>=manifest.surfaces.iter().enumerate().map(|(i,s)|(s.key.as_str(),i)).collect();
        let range_surface_ordinals=manifest.meshes.iter().map(|mesh|mesh.ranges.iter()
            .map(|range|surface_ordinals.get(range.surface_key.as_str()).copied().ok_or("surface missing"))
            .collect::<Result<Vec<_>,_>>()).collect::<Result<Vec<_>,_>>()?;
        let mut instances = Vec::with_capacity(manifest.mesh_instances.len());
        for (mi, m) in manifest.meshes.iter().enumerate() {
            let mesh = store
                .get(&m.payload_hash)
                .ok_or("mesh payload not installed")?;
            if mesh.data.position_hash != m.positions_hash
                || mesh.data.positions.len() != m.vertex_count as usize
                || mesh.data.indices.len() != m.triangle_count as usize
                || mesh.data.bounds != m.bounds
            {
                return Err(format!(
                    "manifest mesh payload/bounds mismatch for {}: payload {:?}, record {:?}",
                    m.key, mesh.data.bounds, m.bounds
                ));
            }
            if let Some(bvh) = &m.bvh {
                bvh.validate(&mesh.data.triangle_bounds())?;
            }
            for r in manifest
                .mesh_instances
                .iter()
                .filter(|i| i.mesh_key == m.key)
            {
                let affine = Affine::new(multiply(
                    r.world_bits.map(|b| f32::from_bits(b) as f64),
                    r.instance_bits.map(|b| f32::from_bits(b) as f64),
                ))?;
                let bounds = world_bounds(mesh.data.bounds, &affine)?;
                instances.push(Instance {
                    record: r.clone(),
                    mesh: mesh.clone(),
                    mesh_record: mi,
                    affine,
                    bounds,
                });
            }
        }
        let tlas = Bvh::build(&instances.iter().map(|i| i.bounds).collect::<Vec<_>>())?;
        Ok(Self {
            manifest_file_hash: expected.into(),
            manifest,
            instances,
            range_surface_ordinals,
            tlas,
            stack: Vec::new(),
            candidates: Vec::new(),
            blas_stack: Vec::new(),
            triangles: Vec::new(),
            events: Vec::new(),
            occupancy_contacts: Vec::new(),
            query_stats: QueryStats::default(),
        })
    }
    pub fn manifest_file_hash(&self)->&str {&self.manifest_file_hash}
    /// Only an extent for candidate/travel bounds; never proof of a contact.
    pub fn bounds(&self)->Option<Bounds>{self.tlas.nodes.first().map(|n|n.bounds)}
    #[cfg(test)]
    pub(crate) fn visit_surface_triangles(&self,mut visit:impl FnMut(&str,&manifest::Surface,[Point;3]))->Result<(),String>{
        self.visit_surface_triangles_selected(None,|_,_|Some(()),|instance,surface,(),vertices|visit(instance,surface,vertices))
    }
    /// Select complete instance/surface ranges before transforming vertices.
    /// Selection only limits candidate construction; exact occlusion traces
    /// continue to consume the full registered geometry, including unknowns.
    pub(crate) fn visit_surface_triangles_selected<T:Copy>(&self,
        sphere:Option<(Point,f64)>,
        mut select:impl FnMut(&str,&manifest::Surface)->Option<T>,
        mut visit:impl FnMut(&str,&manifest::Surface,T,[Point;3]))->Result<(),String>{
        let mut work=0u64;
        for instance in &self.instances {
            // This is only a candidate rejection against the exact posed
            // instance's bounds. Preserve full range/membership/work checks
            // below, and leave all admitted contacts to the triangle predicate.
            let in_radius=sphere.map_or(true,|(center,radius)|{
                if !ray::finite(center)||!radius.is_finite()||radius<0. {return true;}
                let local=instance.mesh.data.bounds;
                let mut scale=radius.max(1.);
                for k in 0..3 {
                    let mut terms=instance.affine.forward[12+k].abs();
                    for axis in 0..3 {terms+=instance.affine.forward[axis*4+k].abs()*local.lo[axis].abs().max(local.hi[axis].abs());}
                    scale=scale.max(terms).max(center[k].abs()).max(instance.bounds.lo[k].abs()).max(instance.bounds.hi[k].abs());
                }
                if !scale.is_finite(){return true;}
                // Outward arithmetic error only, including absolute affine
                // terms before cancellation and the distance subtraction.
                let pad=128.*f64::EPSILON*scale;
                let distance2=(0..3).map(|k|{
                    let d=(instance.bounds.lo[k]-center[k]).max(center[k]-instance.bounds.hi[k]).max(0.);
                    (d-pad).max(0.).powi(2)
                }).sum::<f64>();
                let radius2=(radius+pad).powi(2);
                !distance2.is_finite()||!radius2.is_finite()||distance2<=radius2
            });
            let mesh=&self.manifest.meshes[instance.mesh_record];
            let ordinals=self.range_surface_ordinals.get(instance.mesh_record)
                .filter(|indices|indices.len()==mesh.ranges.len()).ok_or("registered surface ranges changed")?;
            for (range,ordinal) in mesh.ranges.iter().zip(ordinals) {
                // The diagnostic manifest is publicly readable. An unregistered
                // membership/order edit cannot silently reuse another surface's
                // ordinal; only a fresh registration can rebuild this identity.
                let surface=self.manifest.surfaces.get(*ordinal)
                    .filter(|surface|surface.key==range.surface_key).ok_or("registered surface membership changed")?;
                // Preserve the existing manifest-wide work rejection even for
                // rejected ranges; the filter does not admit oversized scenes.
                work=work.checked_add(range.count as u64).ok_or("anatomy surface work limit")?;
                if work>MAX_OCCUPANCY_TRIANGLE_TESTS {return Err("anatomy surface work limit".into());}
                let Some(selected)=select(&instance.record.key,surface) else {continue;};
                if !in_radius {continue;}
                for triangle in range.first..range.first+range.count {
                    #[cfg(test)]
                    SURFACE_TRIANGLE_VISITS.with(|count| count.set(count.get() + 1));
                    let vertices=instance.mesh.data.triangle(triangle as usize).map(|p|transform(&instance.affine.forward,p));
                    visit(&instance.record.key,surface,selected,vertices);
                }
            }
        }Ok(())
    }
    pub fn refit(&mut self, updates: &[(String, [f64; 16])]) -> Result<(), String> {
        let mut changes = Vec::with_capacity(updates.len());
        let mut seen = std::collections::HashSet::new();
        for (key, m) in updates {
            if !seen.insert(key) {
                return Err("duplicate instance update".into());
            }
            let i = self
                .instances
                .iter()
                .position(|i| i.record.key == *key)
                .ok_or("unknown instance update")?;
            let affine = Affine::new(*m)?;
            let bounds = world_bounds(self.instances[i].mesh.data.bounds, &affine)?;
            changes.push((i, affine, bounds));
        }
        for (i, affine, bounds) in changes {
            self.instances[i].affine = affine;
            self.instances[i].bounds = bounds;
        }
        self.tlas
            .refit(&self.instances.iter().map(|i| i.bounds).collect::<Vec<_>>())
    }
    pub fn trace(
        &mut self,
        a: Point,
        b: Point,
        ctx: &QueryContext,
        limit: usize,
    ) -> Result<&[SurfaceCrossingV1], String> {
        self.events.clear();
        self.query_stats = QueryStats::default();
        if !ray::finite(a) || !ray::finite(b) || !ray::finite(ray::sub(b, a)) {
            return Err("nonfinite segment".into());
        }
        if ctx.build_hash != self.manifest.build_hash
            || ctx.entity_id.is_empty()
            || ctx.entity_id.len() > 1024
        {
            return Err("query context/build mismatch".into());
        }
        if limit == 0 || limit > MAX_CROSSINGS {
            return Err("crossing capacity limit".into());
        }
        self.events
            .try_reserve(limit.saturating_sub(self.events.len()))
            .map_err(|_| "crossing buffer allocation failed")?;
        let result = self.trace_inner(a, b, ctx, limit);
        if let Err(e) = result {
            self.events.clear();
            return Err(e);
        }
        Ok(&self.events)
    }
    fn trace_inner(
        &mut self,
        a: Point,
        b: Point,
        ctx: &QueryContext,
        limit: usize,
    ) -> Result<(), String> {
        let tlas_stats =
            self.tlas
                .candidates(a, b, &mut self.stack, &mut self.candidates, 32768)?;
        self.query_stats.tlas_node_visits = tlas_stats.pop_visits;
        self.query_stats.tlas_bounds_tests = tlas_stats.bounds_tests;
        self.query_stats.candidate_instances = self.candidates.len() as u64;
        for &ii in &self.candidates {
            let inst = &self.instances[ii as usize];
            let aa = ray::transform_query(&inst.affine.inverse, a)?;
            let bb = ray::transform_query(&inst.affine.inverse, b)?;
            if !ray::finite(aa) || !ray::finite(bb) || !ray::finite(ray::sub(bb, aa)) {
                return Err("local segment transform overflow".into());
            }
            let blas_stats = inst.mesh.bvh.candidates(
                aa,
                bb,
                &mut self.blas_stack,
                &mut self.triangles,
                MAX_TRIANGLES,
            )?;
            self.query_stats.blas_node_visits += blas_stats.pop_visits;
            self.query_stats.blas_bounds_tests += blas_stats.bounds_tests;
            self.query_stats.candidate_triangles += self.triangles.len() as u64;
            let mr = &self.manifest.meshes[inst.mesh_record];
            for &ti in &self.triangles {
                self.query_stats.triangle_tests += 1;
                let v = inst.mesh.data.triangle(ti as usize);
                if let Some(contact) = ray::triangle(aa, bb, v)? {
                    if self.events.len() == limit {
                        return Err("crossing buffer overflow; increase explicit capacity".into());
                    }
                    let range = mr
                        .ranges
                        .iter()
                        .find(|r| ti >= r.first && ti - r.first < r.count)
                        .ok_or("triangle range missing")?;
                    let surface = self
                        .manifest
                        .surfaces
                        .iter()
                        .find(|s| s.key == range.surface_key)
                        .ok_or("surface missing")?;
                    let v = v.map(|p| transform(&inst.affine.forward, p));
                    let n = ray::cross(ray::sub(v[1], v[0]), ray::sub(v[2], v[0]));
                    let n2 = ray::dot(n, n);
                    if !ray::finite(n) || !n2.is_finite() || n2 == 0.0 {
                        return Err("geometric normal overflow/underflow".into());
                    }
                    ray::certify_world_contact(a, b, v, contact)?;
                    self.events.push(SurfaceCrossingV1::contact(
                        ctx,
                        &inst.record.assembly_key,
                        &inst.record.key,
                        &mr.key,
                        ti,
                        range,
                        surface,
                        contact,
                        v,
                        a,
                        b,
                        inst.affine.orientation,
                    ));
                }
            }
        }
        self.query_stats.raw_crossings = self.events.len() as u64;
        self.events.sort_by(|a, b| {
            a.t.total_cmp(&b.t)
                .then_with(|| a.instance_id.cmp(&b.instance_id))
                .then_with(|| a.solid_id.cmp(&b.solid_id))
                .then_with(|| a.triangle_id.cmp(&b.triangle_id))
                .then_with(|| a.surface_id.cmp(&b.surface_id))
        });
        // Deduplicate exact shared topology features only within certified surface/solid IDs.
        let mut kept: Vec<(String, String, Option<String>, Vec<[u32; 3]>, f64, bool)> = Vec::new();
        self.events.retain(|e| {
            if e.topology_pending {
                return true;
            }
            let zero: Vec<usize> = e
                .barycentric
                .iter()
                .enumerate()
                .filter_map(|(i, &v)| if v == 0.0 { Some(i) } else { None })
                .collect();
            if zero.is_empty() {
                return true;
            }
            let closed_event =
                self.manifest.surfaces.iter().any(|s| {
                    s.key == e.surface_id && s.topology == manifest::Topology::ClosedSolid
                });
            let inst = self
                .instances
                .iter()
                .find(|i| i.record.key == e.instance_id)
                .unwrap();
            let tri = inst.mesh.data.indices[e.triangle_id as usize];
            let mut feature: Vec<[u32; 3]> = (0..3)
                .filter(|i| !zero.contains(i))
                .map(|i| {
                    inst.mesh.data.positions[tri[i] as usize].map(|f| {
                        if f == 0.0 {
                            0
                        } else {
                            f.to_bits()
                        }
                    })
                })
                .collect();
            feature.sort_unstable();
            if kept.iter().any(|(instance, surface, solid, f, t, closed)| {
                *instance == e.instance_id
                    && (*surface == e.surface_id || (*closed && closed_event))
                    && *solid == e.solid_id
                    && *f == feature
                    && (*t - e.t).abs() <= 4.0 * f64::EPSILON * t.abs().max(1.0)
            }) {
                false
            } else {
                kept.push((
                    e.instance_id.clone(),
                    e.surface_id.clone(),
                    e.solid_id.clone(),
                    feature,
                    e.t,
                    closed_event,
                ));
                true
            }
        });
        for event in &mut self.events {
            let s = self
                .manifest
                .surfaces
                .iter()
                .find(|s| s.key == event.surface_id)
                .ok_or("surface missing")?;
            if s.topology != manifest::Topology::ClosedSolid {
                continue;
            }
            let solid = event
                .solid_id
                .as_deref()
                .ok_or("closed solid identity missing")?;
            let inst = self
                .instances
                .iter()
                .find(|i| i.record.key == event.instance_id)
                .ok_or("closed instance missing")?;
            let aa = ray::transform_query(&inst.affine.inverse, a)?;
            let bb = ray::transform_query(&inst.affine.inverse, b)?;
            let d = ray::sub(bb, aa);
            if d.iter().all(|&v| v == 0.0) {
                event.crossing = "touch";
                continue;
            }
            let axis = (0..3)
                .max_by(|&i, &j| d[i].abs().total_cmp(&d[j].abs()))
                .unwrap();
            let dir = d.map(|v| v / d[axis]);
            let bounds = inst.mesh.data.bounds;
            let span = (bounds.hi[axis] - bounds.lo[axis]).max(1.0);
            let lo = bounds.lo[axis] - span;
            let hi = bounds.hi[axis] + span;
            let mut left = std::array::from_fn(|k| aa[k] + dir[k] * (lo - aa[axis]));
            left[axis] = lo;
            let mut right = std::array::from_fn(|k| aa[k] + dir[k] * (hi - aa[axis]));
            right[axis] = hi;
            if !ray::finite(left) || !ray::finite(right) || !ray::finite(ray::sub(right, left)) {
                return Err("closed occupancy support-line arithmetic overflow".into());
            }
            let ranges = surface::solid_ranges(
                &self.manifest.meshes[inst.mesh_record].ranges,
                &self.manifest.surfaces,
                solid,
            );
            self.occupancy_contacts.clear();
            for range in &ranges {
                for ti in range.first..range.first + range.count {
                    surface::occupancy_work(&mut self.query_stats)?;
                    let v = inst.mesh.data.triangle(ti as usize);
                    if let Some(c) = ray::triangle(left, right, v)? {
                        self.occupancy_contacts.push((ti, c.t));
                    }
                }
            }
            let &(_, t) = self
                .occupancy_contacts
                .iter()
                .find(|&&(ti, _)| ti == event.triangle_id)
                .ok_or("closed occupancy support line lost actual contact")?;
            for &(ti, x) in &self.occupancy_contacts {
                if x == t && ti != event.triangle_id {
                    surface::occupancy_work(&mut self.query_stats)?;
                    surface::occupancy_work(&mut self.query_stats)?;
                    if !surface::same_line_contact(
                        inst.mesh.data.triangle(event.triangle_id as usize),
                        inst.mesh.data.triangle(ti as usize),
                        left,
                        right,
                        &mut self.query_stats,
                    )? {
                        return Err(
                            "closed occupancy distinct contact intervals lost parameter precision"
                                .into(),
                        );
                    }
                }
            }
            let previous = self
                .occupancy_contacts
                .iter()
                .map(|&(_, x)| x)
                .filter(|&x| x < t)
                .fold(0.0, f64::max);
            let next = self
                .occupancy_contacts
                .iter()
                .map(|&(_, x)| x)
                .filter(|&x| x > t)
                .fold(1.0, f64::min);
            let before = previous + (t - previous) * 0.5;
            let after = t + (next - t) * 0.5;
            if !(previous < before && before < t && t < after && after < next) {
                return Err(
                    "closed occupancy interval has no representable interior parameter".into(),
                );
            }
            let p = ray::point_at(left, right, before);
            let q = ray::point_at(left, right, after);
            let mut was_inside = surface::solid_membership(
                &inst.mesh.data,
                &ranges,
                p,
                left,
                right,
                &mut self.query_stats,
            )?;
            let mut now_inside = surface::solid_membership(
                &inst.mesh.data,
                &ranges,
                q,
                left,
                right,
                &mut self.query_stats,
            )?;
            if d[axis] < 0.0 {
                std::mem::swap(&mut was_inside, &mut now_inside);
            }
            event.crossing = match (was_inside, now_inside) {
                (false, true) => "enter",
                (true, false) => "exit",
                _ => "touch",
            };
        }
        self.query_stats.crossings = self.events.len() as u64;
        self.query_stats.event_capacity = self.events.capacity();
        Ok(())
    }
    pub fn instance_count(&self) -> usize {
        self.instances.len()
    }
    pub fn query_stats(&self) -> &QueryStats {
        &self.query_stats
    }
    pub fn memory_stats(&self) -> SceneMemoryStats {
        SceneMemoryStats {
            instances: self.instances.len(),
            instance_array_bytes: self.instances.capacity() * std::mem::size_of::<Instance>(),
            surface_index_array_bytes: self.range_surface_ordinals.capacity() * std::mem::size_of::<Vec<usize>>()
                + self.range_surface_ordinals.iter().map(|indices|indices.capacity()*std::mem::size_of::<usize>()).sum::<usize>(),
            tlas_nodes: self.tlas.nodes.len(),
            tlas_array_bytes: bvh_array_bytes(&self.tlas),
            query_array_bytes: (self.stack.capacity()
                + self.candidates.capacity()
                + self.blas_stack.capacity()
                + self.triangles.capacity())
                * std::mem::size_of::<u32>()
                + self.events.capacity() * std::mem::size_of::<SurfaceCrossingV1>()
                + self.occupancy_contacts.capacity() * std::mem::size_of::<(u32, f64)>(),
        }
    }
}
