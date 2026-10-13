//! Hash-pinned immutable mesh payload and binding manifest validation.
use super::{bvh::Bounds, ray::Point, MAX_MESH_BYTES, MAX_TRIANGLES};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
pub fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
pub fn check_hash(bytes: &[u8], expected: &str) -> Result<(), String> {
    if expected.len() != 64
        || !expected
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
        || sha256(bytes) != expected
    {
        Err("SHA-256 mismatch or invalid expected hash".into())
    } else {
        Ok(())
    }
}
#[derive(Clone, Debug)]
pub struct MeshData {
    pub positions: Vec<[f32; 3]>,
    pub indices: Vec<[u32; 3]>,
    pub position_hash: String,
    pub payload_hash: String,
    pub bounds: Bounds,
}
impl MeshData {
    pub fn load(bytes: &[u8], expected: &str) -> Result<Self, String> {
        if bytes.len() < 32 || bytes.len() > MAX_MESH_BYTES {
            return Err("mesh payload byte limit".into());
        }
        check_hash(bytes, expected)?;
        if &bytes[..8] != b"THMESH1\0" {
            return Err("mesh magic".into());
        }
        let word = |off| u32::from_le_bytes(bytes[off..off + 4].try_into().unwrap());
        if word(8) != 1 || word(28) != 0 {
            return Err("mesh version/reserved flags".into());
        }
        let nv = word(12) as usize;
        let nt = word(16) as usize;
        let np = word(20) as usize;
        let ni = word(24) as usize;
        if nv == 0 || nt == 0 || nt > MAX_TRIANGLES || nv > MAX_TRIANGLES * 3 {
            return Err("mesh vertex/triangle count limit".into());
        }
        let pbytes = nv.checked_mul(12).ok_or("position size overflow")?;
        let ibytes = nt.checked_mul(12).ok_or("index size overflow")?;
        let total = 32usize
            .checked_add(pbytes)
            .and_then(|n| n.checked_add(ibytes))
            .ok_or("payload size overflow")?;
        if np != pbytes || ni != ibytes || total != bytes.len() {
            return Err("mesh payload length/count mismatch".into());
        }
        let mut positions = Vec::with_capacity(nv);
        let mut bounds = Bounds::empty();
        for chunk in bytes[32..32 + pbytes].chunks_exact(12) {
            let p = std::array::from_fn(|i| {
                f32::from_le_bytes(chunk[i * 4..i * 4 + 4].try_into().unwrap())
            });
            if p.iter().any(|v| !v.is_finite()) {
                return Err("nonfinite mesh position".into());
            }
            bounds = bounds.union(Bounds::point(p.map(f64::from)));
            positions.push(p);
        }
        let mut indices = Vec::with_capacity(nt);
        for chunk in bytes[32 + pbytes..].chunks_exact(12) {
            let tri = std::array::from_fn(|i| {
                u32::from_le_bytes(chunk[i * 4..i * 4 + 4].try_into().unwrap())
            });
            if tri.iter().any(|&i| i as usize >= nv) {
                return Err("mesh index out of bounds".into());
            }
            indices.push(tri);
        }
        Ok(Self {
            positions,
            indices,
            position_hash: sha256(&bytes[32..32 + pbytes]),
            payload_hash: expected.into(),
            bounds,
        })
    }
    pub fn triangle(&self, i: usize) -> [Point; 3] {
        self.indices[i].map(|j| self.positions[j as usize].map(f64::from))
    }
    pub fn triangle_bounds(&self) -> Vec<Bounds> {
        (0..self.indices.len())
            .map(|i| {
                self.triangle(i)
                    .into_iter()
                    .fold(Bounds::empty(), |b, p| b.union(Bounds::point(p)))
            })
            .collect()
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TriangleRange {
    pub first: u32,
    pub count: u32,
    pub source_key: String,
    pub surface_key: String,
    pub solid_key: Option<String>,
    pub binding_key: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MeshRecord {
    pub key: String,
    pub payload_hash: String,
    pub positions_hash: String,
    pub render_buffer_hash: String,
    pub vertex_count: u32,
    pub triangle_count: u32,
    pub bounds: Bounds,
    pub ranges: Vec<TriangleRange>,
    pub bvh: Option<super::bvh::Bvh>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Assembly {
    pub key: String,
    pub parent: Option<String>,
    pub base_transform_bits: [u32; 16],
    pub pivot: Point,
    pub joint: serde_json::Value,
    pub allowed_motion_fields: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InstanceRecord {
    pub key: String,
    pub mesh_key: String,
    pub assembly_key: String,
    pub source_key: String,
    pub world_bits: [u32; 16],
    pub instance_bits: [u32; 16],
    pub material_feature: serde_json::Value,
    pub activity_policy: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Topology {
    AuditPending,
    BoundaryShell,
    OpenSheet,
    ClosedSolid,
    DecorativeSurface,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Surface {
    pub key: String,
    pub role: String,
    pub topology: Topology,
    pub winding: String,
    pub response_ref: Option<String>,
    pub armor_layer_key: Option<String>,
    pub module_key: Option<String>,
    pub crew_key: Option<String>,
    pub fuse_eligible: Option<bool>,
    pub contact_eligible: Option<bool>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HitMeshManifestV1 {
    pub schema: String,
    pub format: String,
    pub endianness: String,
    pub generator: serde_json::Value,
    pub build_recipe_hash: String,
    pub spec_id: String,
    pub build_hash: String,
    pub manifest_hash: String,
    pub render_geometry_hash: String,
    pub anatomy_data_hash: String,
    pub sources: serde_json::Value,
    pub meshes: Vec<MeshRecord>,
    pub assemblies: Vec<Assembly>,
    pub mesh_instances: Vec<InstanceRecord>,
    pub bindings: Vec<serde_json::Value>,
    pub surfaces: Vec<Surface>,
    pub audits: serde_json::Value,
}
impl HitMeshManifestV1 {
    pub fn load(bytes: &[u8], expected: &str) -> Result<Self, String> {
        if bytes.len() > 4 * 1024 * 1024 {
            return Err("manifest byte limit".into());
        }
        check_hash(bytes, expected)?;
        let value: serde_json::Value =
            serde_json::from_slice(bytes).map_err(|e| format!("manifest JSON: {e}"))?;
        let declared = value
            .get("manifestHash")
            .and_then(|v| v.as_str())
            .ok_or("manifestHash required")?
            .to_owned();
        // Hash the exact canonical UTF-8 body with the top-level manifestHash member omitted.
        // Avoid JS/Rust number reserialization (1e-6 versus .000001) changing byte identity.
        let member = format!("\"manifestHash\":\"{}\",", declared);
        let needle = member.as_bytes();
        let starts: Vec<usize> = bytes
            .windows(needle.len())
            .enumerate()
            .filter_map(|(i, w)| if w == needle { Some(i) } else { None })
            .collect();
        if starts.len() != 1 {
            return Err("manifestHash must be one canonical top-level member".into());
        }
        let at = starts[0];
        let mut body = Vec::with_capacity(bytes.len() - needle.len());
        body.extend_from_slice(&bytes[..at]);
        body.extend_from_slice(&bytes[at + needle.len()..]);
        check_hash(&body, &declared)?;
        let manifest: Self =
            serde_json::from_slice(bytes).map_err(|e| format!("manifest contract: {e}"))?;
        manifest.validate()?;
        Ok(manifest)
    }
    pub fn validate(&self) -> Result<(), String> {
        if self.schema != "HitMeshManifestV1" || self.format != "THMESH1" || self.endianness != "LE"
        {
            return Err("unsupported manifest schema/format/endianness".into());
        }
        if self.meshes.is_empty()
            || self.meshes.len() > 4096
            || self.assemblies.len() > 16384
            || self.mesh_instances.len() > 32768
            || self.surfaces.len() > 8192
            || self.bindings.len() > 16384
        {
            return Err("manifest count limit".into());
        }
        let key = |s: &str| !s.is_empty() && s.len() <= 1024;
        let nullable_key = |s: &Option<String>| s.as_deref().map(key).unwrap_or(true);
        let hash = |s: &str| {
            s.len() == 64
                && s.bytes()
                    .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
        };
        if !key(&self.spec_id)
            || ![
                &self.build_recipe_hash,
                &self.build_hash,
                &self.manifest_hash,
                &self.render_geometry_hash,
                &self.anatomy_data_hash,
            ]
            .into_iter()
            .all(|s| hash(s))
        {
            return Err("invalid manifest identity/hash".into());
        }
        if !self.generator.is_object() || !self.sources.is_object() || !self.audits.is_object() {
            return Err("required manifest metadata object".into());
        }
        if !self
            .generator
            .get("revision")
            .and_then(|v| v.as_str())
            .map(key)
            .unwrap_or(false)
            || !self
                .generator
                .get("sha256")
                .and_then(|v| v.as_str())
                .map(hash)
                .unwrap_or(false)
        {
            return Err("generator identity/hash invalid".into());
        }
        let assets = self
            .sources
            .get("assets")
            .and_then(|v| v.as_array())
            .ok_or("source asset inventory required")?;
        if assets.len() > 1024 {
            return Err("source asset inventory limit".into());
        }
        for a in assets {
            let kind = a
                .get("kind")
                .and_then(|v| v.as_str())
                .ok_or("asset kind missing")?;
            if !key(kind) {
                return Err("invalid asset kind".into());
            }
            if kind == "donor_selection" {
                continue;
            }
            let status = a
                .get("status")
                .and_then(|v| v.as_str())
                .ok_or("asset status missing")?;
            match status {
                "available" => {
                    if !a
                        .get("sha256")
                        .and_then(|v| v.as_str())
                        .map(hash)
                        .unwrap_or(false)
                    {
                        return Err("available asset hash missing".into());
                    }
                }
                "missing" | "not_declared" | "different_source_format" => {
                    if !a.get("sha256").map(|v| v.is_null()).unwrap_or(false) {
                        return Err("unavailable asset must not invent hash".into());
                    }
                }
                _ => return Err("unknown asset status".into()),
            }
        }
        let unique = |keys: Vec<&str>| -> Result<HashSet<String>, String> {
            let mut set = HashSet::new();
            for k in keys {
                if !key(k) || !set.insert(k.to_owned()) {
                    return Err("empty, oversized or duplicate manifest key".into());
                }
            }
            Ok(set)
        };
        let meshes = unique(self.meshes.iter().map(|m| m.key.as_str()).collect())?;
        let assemblies = unique(self.assemblies.iter().map(|m| m.key.as_str()).collect())?;
        unique(self.mesh_instances.iter().map(|m| m.key.as_str()).collect())?;
        let surfaces = unique(self.surfaces.iter().map(|m| m.key.as_str()).collect())?;
        let bindings = unique(
            self.bindings
                .iter()
                .map(|v| v.get("key").and_then(|v| v.as_str()).unwrap_or(""))
                .collect(),
        )?;
        for surface in &self.surfaces {
            if ![
                &surface.response_ref,
                &surface.armor_layer_key,
                &surface.module_key,
                &surface.crew_key,
            ]
            .into_iter()
            .all(nullable_key)
            {
                return Err("empty or oversized nullable surface key".into());
            }
            if ![
                "audit_pending",
                "armor",
                "module",
                "crew",
                "running_gear",
                "decoration",
            ]
            .contains(&surface.role.as_str())
                || surface.winding != "emitted"
            {
                return Err("invalid surface role/winding".into());
            }
            if surface.topology == Topology::AuditPending && surface.role != "audit_pending" {
                return Err("pending topology cannot certify role".into());
            }
            for r in [
                &surface.armor_layer_key,
                &surface.module_key,
                &surface.crew_key,
            ]
            .into_iter()
            .flatten()
            {
                if !bindings.contains(r) {
                    return Err("surface anatomy binding missing".into());
                }
            }
        }
        let mut total = 0usize;
        for m in &self.meshes {
            if !hash(&m.payload_hash)
                || !hash(&m.positions_hash)
                || !hash(&m.render_buffer_hash)
                || !m.bounds.valid()
                || m.triangle_count == 0
                || m.triangle_count as usize > MAX_TRIANGLES
                || m.vertex_count == 0
            {
                return Err("invalid mesh record".into());
            }
            total = total
                .checked_add(m.triangle_count as usize)
                .ok_or("triangle inventory overflow")?;
            if total > 8 * MAX_TRIANGLES {
                return Err("manifest triangle inventory limit".into());
            }
            let mut cursor = 0u32;
            for r in &m.ranges {
                if !nullable_key(&r.solid_key) || !nullable_key(&r.binding_key) {
                    return Err("empty or oversized nullable triangle key".into());
                }
                if r.first != cursor
                    || r.count == 0
                    || !key(&r.source_key)
                    || !surfaces.contains(&r.surface_key)
                    || r.binding_key
                        .as_ref()
                        .map(|s| !bindings.contains(s))
                        .unwrap_or(false)
                {
                    return Err("triangle coverage or binding invalid".into());
                }
                cursor = cursor
                    .checked_add(r.count)
                    .ok_or("triangle range overflow")?;
            }
            if cursor != m.triangle_count {
                return Err("incomplete triangle coverage".into());
            }
        }
        for k in [
            "triangleCoverage",
            "unclassifiedPhysicalTriangles",
            "degenerateCount",
            "boundaryEdges",
            "nonmanifoldEdges",
            "missingBindings",
            "ambiguousBindings",
            "renderPositionDifferences",
        ] {
            if self.audits.get(k).and_then(|v| v.as_u64()).is_none() {
                return Err(format!("audit count missing: {k}"));
            }
        }
        if self.audits["triangleCoverage"].as_u64() != Some(total as u64)
            || self.audits["renderPositionDifferences"].as_u64() != Some(0)
            || self.audits["certification"].as_str() != Some("audit_pending_diagnostic")
        {
            return Err("audit coverage/difference/certification invalid".into());
        }
        for a in &self.assemblies {
            if !super::ray::finite(a.pivot)
                || a.allowed_motion_fields.len() > 32
                || a.allowed_motion_fields.iter().any(|s| !key(s))
                || a.parent
                    .as_ref()
                    .map(|k| !assemblies.contains(k))
                    .unwrap_or(false)
            {
                return Err("assembly reference/bounds invalid".into());
            }
            super::ray::Affine::new(a.base_transform_bits.map(|b| f32::from_bits(b) as f64))?;
        }
        // One index plus iterative colors visits every parent edge once, including long chains.
        let lookup: std::collections::HashMap<&str, usize> = self
            .assemblies
            .iter()
            .enumerate()
            .map(|(i, a)| (a.key.as_str(), i))
            .collect();
        let parents: Vec<Option<usize>> = self
            .assemblies
            .iter()
            .map(|a| a.parent.as_deref().map(|k| lookup[k]))
            .collect();
        let mut colors = vec![0u8; self.assemblies.len()];
        let mut path = Vec::new();
        for start in 0..colors.len() {
            if colors[start] != 0 {
                continue;
            }
            path.clear();
            let mut current = Some(start);
            while let Some(i) = current {
                match colors[i] {
                    0 => {
                        colors[i] = 1;
                        path.push(i);
                        current = parents[i];
                    }
                    1 => return Err("assembly cycle".into()),
                    _ => break,
                }
            }
            for &i in &path {
                colors[i] = 2;
            }
        }
        for i in &self.mesh_instances {
            if !meshes.contains(&i.mesh_key)
                || !assemblies.contains(&i.assembly_key)
                || !key(&i.source_key)
                || !key(&i.activity_policy)
            {
                return Err("instance reference/activity invalid".into());
            }
            super::ray::Affine::new(i.world_bits.map(|b| f32::from_bits(b) as f64))?;
            super::ray::Affine::new(i.instance_bits.map(|b| f32::from_bits(b) as f64))?;
        }
        Ok(())
    }
}
