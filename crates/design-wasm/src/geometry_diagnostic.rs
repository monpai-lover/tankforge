//! Explicitly opt-in CPU geometry handles; these never register abstract combat targets.
use serde_json::{json, Value};
use std::{collections::HashMap, sync::Arc};
use tg_combat::geometry::{surface::QueryContext, Geometry, ImmutableMesh, MeshStore};
#[derive(Default)]
pub(crate) struct Diagnostics {
    store: MeshStore,
    meshes: HashMap<u32, Arc<ImmutableMesh>>,
    scenes: HashMap<u32, Geometry>,
}
thread_local! {static SERIAL:std::cell::Cell<u32>=const{std::cell::Cell::new(1)};}
fn handle() -> Result<u32, String> {
    SERIAL.with(|s| {
        let n = s.get();
        s.set(n.checked_add(1).ok_or("geometry handle exhausted")?);
        Ok(n)
    })
}
impl Diagnostics {
    pub(crate) fn call(&mut self, op: &str, req: &Value) -> Result<Value, String> {
        if req.get("diagnostic").and_then(Value::as_bool) != Some(true) {
            return Err("geometry diagnostics require explicit opt-in".into());
        }
        match op {
            "combat_geometry_install" => {
                if self.meshes.len() >= 4096 {
                    return Err("geometry mesh handle capacity exceeded".into());
                }
                let values = req
                    .get("payload")
                    .and_then(Value::as_array)
                    .ok_or("binary payload required")?;
                if values.len() > tg_combat::geometry::MAX_MESH_BYTES {
                    return Err("geometry install byte limit".into());
                }
                let mut bytes = Vec::with_capacity(values.len());
                for v in values {
                    let n = v
                        .as_u64()
                        .filter(|n| *n <= 255)
                        .ok_or("invalid binary payload byte")?;
                    bytes.push(n as u8);
                }
                let expected = req
                    .get("expectedHash")
                    .and_then(Value::as_str)
                    .ok_or("independent expected payload hash required")?;
                let mesh = self.store.install(&bytes, expected)?;
                let id = handle()?;
                let out = json!({"handle":id,"payloadHash":mesh.data.payload_hash,"positionsHash":mesh.data.position_hash,"triangles":mesh.data.indices.len()});
                self.meshes.insert(id, mesh);
                Ok(out)
            }
            "combat_geometry_register" => {
                if self.scenes.len() >= 64 {
                    return Err("geometry scene handle capacity exceeded".into());
                }
                let text = req
                    .get("manifest")
                    .and_then(Value::as_str)
                    .ok_or("manifest bytes as UTF-8 text required")?;
                let expected = req
                    .get("expectedHash")
                    .and_then(Value::as_str)
                    .ok_or("independent expected manifest hash required")?;
                let handles: Vec<u32> = super::field(req, "meshHandles")?;
                if handles.len() > 4096 || handles.iter().any(|h| !self.meshes.contains_key(h)) {
                    return Err("missing or released mesh handle".into());
                }
                let scene = Geometry::register(text.as_bytes(), expected, &self.store)?;
                // A caller must name the live installed lease for every used payload.
                for m in &scene.manifest.meshes {
                    if !handles
                        .iter()
                        .any(|h| self.meshes[h].data.payload_hash == m.payload_hash)
                    {
                        return Err("manifest payload has no named live mesh lease".into());
                    }
                }
                let id = handle()?;
                let out = json!({"handle":id,"buildHash":scene.manifest.build_hash,"instances":scene.instance_count(),"memory":scene.memory_stats(),"storeMemory":self.store.memory_stats(),"certification":"audit_pending_diagnostic"});
                self.scenes.insert(id, scene);
                Ok(out)
            }
            "combat_geometry_trace" => {
                let id = super::field(req, "handle")?;
                let scene = self
                    .scenes
                    .get_mut(&id)
                    .ok_or("missing or released geometry scene handle")?;
                let a = super::field(req, "a")?;
                let b = super::field(req, "b")?;
                let context: QueryContext = super::field(req, "context")?;
                let capacity = req.get("capacity").and_then(Value::as_u64).unwrap_or(4096);
                let capacity =
                    usize::try_from(capacity).map_err(|_| "geometry capacity overflow")?;
                let crossings = serde_json::to_value(scene.trace(a, b, &context, capacity)?)
                    .map_err(|e| e.to_string())?;
                Ok(
                    json!({"crossings":crossings,"stats":scene.query_stats(),"memory":scene.memory_stats(),"certification":"audit_pending_diagnostic"}),
                )
            }
            "combat_geometry_release" => {
                let id = super::field(req, "handle")?;
                let removed =
                    self.scenes.remove(&id).is_some() || self.meshes.remove(&id).is_some();
                if !removed {
                    return Err("missing or already released geometry handle".into());
                }
                self.store.collect_unused();
                let (meshes, bytes) = self.store.stats();
                Ok(
                    json!({"released":true,"immutableMeshes":meshes,"payloadBytes":bytes,"storeMemory":self.store.memory_stats(),"sceneArrayBytes":self.scenes.values().map(|s|{let m=s.memory_stats();m.instance_array_bytes+m.tlas_array_bytes+m.query_array_bytes}).sum::<usize>(),"sceneHandles":self.scenes.len(),"meshHandles":self.meshes.len()}),
                )
            }
            _ => Err("unknown geometry diagnostic operation".into()),
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn geometry_opt_in_hash_failure_lease_release_and_stale_handle_ownership() {
        let root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
        let index: Value = serde_json::from_slice(
            &std::fs::read(root.join("data/hit-meshes/index.json")).unwrap(),
        )
        .unwrap();
        let text = std::fs::read_to_string(
            root.join("data/hit-meshes")
                .join(index["fixtures"]["tube"]["manifestFile"].as_str().unwrap()),
        )
        .unwrap();
        let manifest: Value = serde_json::from_str(&text).unwrap();
        let hash = manifest["meshes"][0]["payloadHash"].as_str().unwrap();
        let bytes =
            std::fs::read(root.join("data/hit-meshes").join(format!("{hash}.bin"))).unwrap();
        let mut d = Diagnostics::default();
        assert!(d
            .call(
                "combat_geometry_install",
                &json!({"payload":bytes,"expectedHash":hash})
            )
            .is_err());
        assert!(d
            .call(
                "combat_geometry_install",
                &json!({"diagnostic":true,"payload":bytes,"expectedHash":"0".repeat(64)})
            )
            .is_err());
        assert_eq!(d.store.stats(), (0, 0));
        let a = d
            .call(
                "combat_geometry_install",
                &json!({"diagnostic":true,"payload":bytes,"expectedHash":hash}),
            )
            .unwrap()["handle"]
            .as_u64()
            .unwrap();
        let b = d
            .call(
                "combat_geometry_install",
                &json!({"diagnostic":true,"payload":bytes,"expectedHash":hash}),
            )
            .unwrap()["handle"]
            .as_u64()
            .unwrap();
        assert_ne!(a, b);
        assert_eq!(d.store.stats().0, 1);
        let expected = index["fixtures"]["tube"]["manifestHash"].as_str().unwrap();
        assert!(d
            .call(
                "combat_geometry_register",
                &json!({"diagnostic":true,"manifest":text,"expectedHash":expected,"meshHandles":[]})
            )
            .is_err());
        let scene=d.call("combat_geometry_register",&json!({"diagnostic":true,"manifest":text,"expectedHash":expected,"meshHandles":[a]})).unwrap()["handle"].as_u64().unwrap();
        let ctx = json!({"entityId":"native-wasm","spawnEpoch":1,"buildHash":manifest["buildHash"],"poseRevision":1});
        let req = json!({"diagnostic":true,"handle":scene,"a":[0.534,1.44,3.015],"b":[0.38,1.44,3.015],"context":ctx,"capacity":1});
        assert!(d.call("combat_geometry_trace", &req).is_err());
        let mut req = req;
        req["capacity"] = json!(4);
        assert_eq!(
            d.call("combat_geometry_trace", &req).unwrap()["crossings"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
        for h in [a, b, scene] {
            d.call(
                "combat_geometry_release",
                &json!({"diagnostic":true,"handle":h}),
            )
            .unwrap();
        }
        assert_eq!(d.store.stats(), (0, 0));
        assert!(d.call("combat_geometry_trace", &req).is_err());
        assert!(d
            .call(
                "combat_geometry_release",
                &json!({"diagnostic":true,"handle":scene})
            )
            .is_err());
    }
}
