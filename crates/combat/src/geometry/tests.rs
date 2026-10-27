use super::*;
use serde_json::{json, Value};
use std::{fs, path::PathBuf};
fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}
fn hit_triangle(a: ray::Point, b: ray::Point, v: [ray::Point; 3]) -> Option<ray::Contact> {
    ray::triangle(a, b, v).unwrap()
}
#[test]
fn coplanar_finite_outside_endpoints_never_round_into_a_touch() {
    // The represented endpoints have x < 0 throughout the finite segment.
    // This affine half-space proof does not use production intersection arithmetic.
    for scale_exponent in [-40, 0, 40] {
        let scale = 2f64.powi(scale_exponent);
        for power in [-52, -53, -55, -100, -200] {
            let small = scale * 2f64.powi(power);
            for order in [
                [0, 1, 2],
                [0, 2, 1],
                [1, 0, 2],
                [1, 2, 0],
                [2, 0, 1],
                [2, 1, 0],
            ] {
                let points = [[0., 0., 0.], [scale, 0., 0.], [0., scale, 0.]];
                let v = order.map(|i| points[i]);
                for (a, b) in [
                    ([-scale * 0.5, scale * 0.25, 0.], [-small, scale * 0.25, 0.]),
                    ([scale * 0.25, -scale * 0.5, 0.], [scale * 0.25, -small, 0.]),
                    ([scale * 0.5, scale, 0.], [small, scale, 0.]),
                ] {
                    for (start, end) in [(a, b), (b, a)] {
                        match ray::triangle(start, end, v) {
                            Ok(c) => assert!(c.is_none(), "false coplanar contact: scale={scale_exponent}, power={power}, order={order:?}, {start:?}->{end:?}, {c:?}"),
                            Err(e) => assert!(e.contains("precision") || e.contains("underflow") || e.contains("overflow"), "{e}"),
                        }
                    }
                }
            }
        }
    }
}
#[test]
fn coplanar_finite_genuine_entry_endpoint_and_vertex_touch_remain_contacts() {
    for v in [
        [[0., 0., 0.], [1., 0., 0.], [0., 1., 0.]],
        [[0., 1., 0.], [1., 0., 0.], [0., 0., 0.]],
    ] {
        for (a, b, t) in [
            ([-0.5, 0.25, 0.], [0.25, 0.25, 0.], 2. / 3.),
            ([-0.5, 0.25, 0.], [0., 0.25, 0.], 1.),
            ([0., 0.25, 0.], [-0.5, 0.25, 0.], 0.),
            ([-1., 1., 0.], [1., -1., 0.], 0.5),
            ([0.25, 0.25, 0.], [0.25, 0.25, 0.], 0.),
        ] {
            let c = ray::triangle(a, b, v).unwrap().unwrap();
            assert_eq!(c.t, t);
            assert!(c.coplanar);
            assert!(c.barycentric.iter().all(|&b| (0.0..=1.0).contains(&b)));
        }
    }
}
#[test]
fn coplanar_finite_competing_halfspaces_compare_unrounded_roots() {
    // q-4q^2 > 0 proves that x-entry is after y-exit, even though both
    // correctly rounded roots are 0.5+q. The b.y+q companion really overlaps.
    let q = 2f64.powi(-53);
    for exponent in [-40, 0, 40] {
        let s = 2f64.powi(exponent);
        for order in [
            [0, 1, 2],
            [0, 2, 1],
            [1, 0, 2],
            [1, 2, 0],
            [2, 0, 1],
            [2, 1, 0],
        ] {
            let points = [[0., 0., 0.], [s, 0., 0.], [0., s, 0.]];
            let v = order.map(|i| points[i]);
            let a = [(-1. - 4. * q) * s, (1. + 2. * q) * s, 0.];
            let b = [s, (-1. + q) * s, 0.];
            for (start, end) in [(a, b), (b, a)] {
                match ray::triangle(start, end, v) {
                    Ok(c) => assert!(
                        c.is_none(),
                        "disjoint exact clipping interval rounded into {c:?}"
                    ),
                    Err(e) => assert!(
                        e.contains("precision")
                            || e.contains("underflow")
                            || e.contains("overflow"),
                        "{e}"
                    ),
                }
            }
            let b = [s, (-1. + 2. * q) * s, 0.];
            for (start, end) in [(a, b), (b, a)] {
                match ray::triangle(start, end, v) {
                    Ok(Some(c)) => {
                        assert!(c.coplanar);
                        assert!(c.barycentric.iter().all(|&b| (0.0..=1.0).contains(&b)));
                    }
                    Ok(None) => panic!("a genuine narrow clipping overlap was silently lost"),
                    Err(e) => assert!(
                        e.contains("precision")
                            || e.contains("underflow")
                            || e.contains("overflow"),
                        "{e}"
                    ),
                }
            }
        }
    }
}
#[test]
fn coplanar_finite_projected_shear_tilt_and_all_axes_preserve_empty_and_tangent_intervals() {
    let q = 2f64.powi(-53);
    let fixtures = [
        (
            [[0., 0., 0.], [1., 0., 0.], [0., 1., 0.]],
            [-1. - 4. * q, 1. + 2. * q, 0.],
            [1., -1. + q, 0.],
            [-1. - 4. * q, 1. + 4. * q, 0.],
            [1., -1., 0.],
        ),
        (
            [[0., 0., 0.], [1., 0., 0.], [1., 1., 0.]],
            [-2. * q, 1. + 2. * q, 0.],
            [q, -1. + q, 0.],
            [0., 1. + 4. * q, 0.],
            [0., -1., 0.],
        ),
        (
            [[0., 0., 0.], [1., 0., 1.], [0., 1., 1.]],
            [-1. - 4. * q, 1. + 2. * q, -2. * q],
            [1., -1. + q, q],
            [-1. - 4. * q, 1. + 4. * q, 0.],
            [1., -1., 0.],
        ),
    ];
    for exponent in [-40, 0, 40] {
        let s = 2f64.powi(exponent);
        for rotation in 0..3 {
            let project = |p: Point| std::array::from_fn(|k| p[(k + rotation) % 3] * s);
            for (vertices, a, b, tangent_a, tangent_b) in fixtures {
                let points = vertices.map(project);
                for order in [
                    [0, 1, 2],
                    [0, 2, 1],
                    [1, 0, 2],
                    [1, 2, 0],
                    [2, 0, 1],
                    [2, 1, 0],
                ] {
                    let v = order.map(|i| points[i]);
                    for (start, end) in [(project(a), project(b)), (project(b), project(a))] {
                        match ray::triangle(start, end, v) {
                            Ok(c) => assert!(c.is_none(), "false projected finite touch: {c:?}"),
                            Err(e) => assert!(
                                e.contains("precision")
                                    || e.contains("underflow")
                                    || e.contains("overflow"),
                                "{e}"
                            ),
                        }
                    }
                    for (start, end) in [
                        (project(tangent_a), project(tangent_b)),
                        (project(tangent_b), project(tangent_a)),
                    ] {
                        let c = ray::triangle(start, end, v).unwrap().unwrap();
                        assert!(c.coplanar);
                        assert_eq!(c.barycentric.iter().filter(|&&x| x == 1.).count(), 1);
                        assert_eq!(c.barycentric.iter().filter(|&&x| x == 0.).count(), 2);
                    }
                }
            }
        }
    }
}
#[test]
fn finite_axis_plane_outside_endpoints_never_round_into_a_sideface_touch() {
    for exponent in [-40, 0, 40] {
        let s = 2f64.powi(exponent);
        for power in [-55, -100, -200] {
            let a = [-0.5 * s, 0.25 * s, 0.];
            let b = [-s * 2f64.powi(power), 0.25 * s, 0.];
            for rotation in 0..3 {
                let project = |p: Point| std::array::from_fn(|k| p[(k + rotation) % 3]);
                let points = [[0., 0., 0.], [0., s, 0.], [0., 0., -s]].map(project);
                for v in [points, [points[2], points[1], points[0]]] {
                    for (start, end) in [(project(a), project(b)), (project(b), project(a))] {
                        match ray::triangle(start, end, v) {
                            Ok(c) => assert!(
                                c.is_none(),
                                "entire segment lies outside the original axis plane: {c:?}"
                            ),
                            Err(e) => assert!(
                                e.contains("precision")
                                    || e.contains("underflow")
                                    || e.contains("overflow"),
                                "{e}"
                            ),
                        }
                    }
                }
            }
        }
    }
}
#[test]
fn finite_axis_plane_interior_fraction_matches_independent_integer_nearest_even_rounding() {
    let n = 1u128 << 52;
    let rounded = |numerator: u128, denominator: u128, shift: u32| {
        let scaled = numerator << shift;
        let mut q = scaled / denominator;
        let remainder = scaled % denominator;
        if remainder * 2 > denominator || (remainder * 2 == denominator && q & 1 == 1) {
            q += 1;
        }
        q as f64 * 2f64.powi(-(shift as i32))
    };
    for exponent in [-120, -40, 0, 40, 120] {
        let s = 2f64.powi(exponent);
        for rotation in 0..3 {
            let project = |p: Point| std::array::from_fn(|k| p[(k + rotation) % 3]);
            let points = [[0., 0., 0.], [s, 0., 0.], [0., s, 0.]].map(project);
            for order in [
                [0, 1, 2],
                [0, 2, 1],
                [1, 0, 2],
                [1, 2, 0],
                [2, 0, 1],
                [2, 1, 0],
            ] {
                let v = order.map(|i| points[i]);
                for m in [1u128, 2, 3, 5, 7, 15, 31, 63] {
                    let a = project([s * 0.25, s * 0.25, -s]);
                    let b = project([s * 0.25, s * 0.25, s * (1. + m as f64 * f64::EPSILON)]);
                    let den = 2 * n + m;
                    for (start, end, expected) in
                        [(a, b, rounded(n, den, 54)), (b, a, rounded(n + m, den, 53))]
                    {
                        let c = ray::triangle(start, end, v).unwrap().unwrap();
                        assert_eq!(
                            c.t.to_bits(),
                            expected.to_bits(),
                            "axis={rotation} scale={exponent} m={m} {start:?}->{end:?}"
                        );
                        assert!(!c.coplanar);
                    }
                }
            }
        }
    }
}
#[test]
fn finite_axis_plane_minimum_subnormal_and_direct_subnormal_roots_remain_half() {
    for magnitude in [
        f64::from_bits(1),
        f64::from_bits(2),
        f64::from_bits(3),
        f64::from_bits(137),
        1e-310,
    ] {
        for rotation in 0..3 {
            let project = |p: Point| std::array::from_fn(|k| p[(k + rotation) % 3]);
            let v = [[0., 0., 0.], [1., 0., 0.], [0., 1., 0.]].map(project);
            let a = project([0.25, 0.25, -magnitude]);
            let b = project([0.25, 0.25, magnitude]);
            for (start, end) in [(a, b), (b, a)] {
                let c = ray::triangle(start, end, v).unwrap().unwrap();
                assert_eq!(c.t, 0.5);
                assert!(!c.coplanar);
            }
        }
    }
}
fn context(g: &Geometry) -> QueryContext {
    QueryContext {
        entity_id: "test-actor".into(),
        spawn_epoch: 7,
        build_hash: g.manifest.build_hash.clone(),
        pose_revision: 19,
        geometry_revision: 0,
        shape_hash: None,
    }
}
fn register_file(file: &str) -> Geometry {
    let bytes = fs::read(root().join("data/hit-meshes").join(file)).unwrap();
    let m: HitMeshManifestV1 = serde_json::from_slice(&bytes).unwrap();
    let mut store = MeshStore::default();
    for mesh in &m.meshes {
        let b = fs::read(
            root()
                .join("data/hit-meshes")
                .join(format!("{}.bin", mesh.payload_hash)),
        )
        .unwrap();
        store.install(&b, &mesh.payload_hash).unwrap();
    }
    Geometry::register(&bytes, &manifest::sha256(&bytes), &store).unwrap()
}
fn index() -> Value {
    serde_json::from_slice(&fs::read(root().join("data/hit-meshes/index.json")).unwrap()).unwrap()
}
fn payload(positions: &[[f32; 3]], indices: &[[u32; 3]]) -> Vec<u8> {
    let mut out = b"THMESH1\0".to_vec();
    for w in [
        1,
        positions.len() as u32,
        indices.len() as u32,
        positions.len() as u32 * 12,
        indices.len() as u32 * 12,
        0,
    ] {
        out.extend_from_slice(&w.to_le_bytes());
    }
    for p in positions {
        for f in p {
            out.extend_from_slice(&f.to_le_bytes());
        }
    }
    for t in indices {
        for i in t {
            out.extend_from_slice(&i.to_le_bytes());
        }
    }
    out
}
fn identity() -> [u32; 16] {
    [
        1f32, 0., 0., 0., 0., 1., 0., 0., 0., 0., 1., 0., 0., 0., 0., 1.,
    ]
    .map(f32::to_bits)
}
fn seal(mut m: Value) -> Vec<u8> {
    m.as_object_mut().unwrap().remove("manifestHash");
    let hash = manifest::sha256(&serde_json::to_vec(&m).unwrap());
    m["manifestHash"] = json!(hash);
    serde_json::to_vec(&m).unwrap()
}
fn synthetic(
    positions: &[[f32; 3]],
    indices: &[[u32; 3]],
    copies: usize,
    split_layer: bool,
) -> (Geometry, Vec<u8>, MeshStore) {
    let bytes = payload(positions, indices);
    let hash = manifest::sha256(&bytes);
    let mut store = MeshStore::default();
    let mesh = store.install(&bytes, &hash).unwrap();
    let surfaces = if split_layer {
        vec![
            json!({"key":"surface-a","role":"decoration","topology":"open_sheet","winding":"emitted","responseRef":null,"armorLayerKey":null,"moduleKey":null,"crewKey":null,"fuseEligible":null,"contactEligible":null}),
            json!({"key":"surface-b","role":"decoration","topology":"open_sheet","winding":"emitted","responseRef":null,"armorLayerKey":null,"moduleKey":null,"crewKey":null,"fuseEligible":null,"contactEligible":null}),
        ]
    } else {
        vec![
            json!({"key":"surface-a","role":"audit_pending","topology":"audit_pending","winding":"emitted","responseRef":null,"armorLayerKey":null,"moduleKey":null,"crewKey":null,"fuseEligible":null,"contactEligible":null}),
        ]
    };
    let ranges = if split_layer {
        vec![
            json!({"first":0,"count":2,"sourceKey":"packed:a:part:0","surfaceKey":"surface-a","solidKey":"layer-a","bindingKey":null}),
            json!({"first":2,"count":2,"sourceKey":"packed:a:part:1","surfaceKey":"surface-b","solidKey":"layer-b","bindingKey":null}),
        ]
    } else {
        vec![
            json!({"first":0,"count":indices.len(),"sourceKey":"fixture-source","surfaceKey":"surface-a","solidKey":null,"bindingKey":null}),
        ]
    };
    let z = "0".repeat(64);
    let m = json!({"schema":"HitMeshManifestV1","format":"THMESH1","endianness":"LE","generator":{"revision":"test","sha256":z},"buildRecipeHash":z,"specId":"test","buildHash":z,"renderGeometryHash":z,"anatomyDataHash":z,"sources":{},"meshes":[{"key":"mesh","payloadHash":hash,"positionsHash":mesh.data.position_hash,"renderBufferHash":z,"vertexCount":positions.len(),"triangleCount":indices.len(),"bounds":mesh.data.bounds,"ranges":ranges,"bvh":null}],"assemblies":[{"key":"root","parent":null,"baseTransformBits":identity(),"pivot":[0,0,0],"joint":{},"allowedMotionFields":[]}],"meshInstances":(0..copies).map(|i|json!({"key":format!("instance-{i}"),"meshKey":"mesh","assemblyKey":"root","sourceKey":"fixture-source","worldBits":identity(),"instanceBits":identity(),"materialFeature":{},"activityPolicy":"static_fixture"})).collect::<Vec<_>>(),"bindings":[],"surfaces":surfaces,"audits":{"certification":"audit_pending_diagnostic"}});
    let mut m = m;
    m["sources"] = json!({"assets":[]});
    m["audits"] = json!({"certification":"audit_pending_diagnostic","triangleCoverage":indices.len(),"unclassifiedPhysicalTriangles":indices.len(),"degenerateCount":0,"boundaryEdges":0,"nonmanifoldEdges":0,"missingBindings":indices.len(),"ambiguousBindings":0,"renderPositionDifferences":0,"topologyPending":!split_layer,"declaredOpenBoundaries":null,"shaderDeformation":"none","activity":"static_fixture"});
    let text = seal(m);
    let geometry = Geometry::register(&text, &manifest::sha256(&text), &store).unwrap();
    (geometry, text, store)
}
fn closed_fixture(positions: &[[f32; 3]], indices: &[[u32; 3]]) -> Geometry {
    let (_, text, store) = synthetic(positions, indices, 1, false);
    let mut m: Value = serde_json::from_slice(&text).unwrap();
    m["surfaces"][0]["role"] = json!("decoration");
    m["surfaces"][0]["topology"] = json!("closed_solid");
    m["meshes"][0]["ranges"][0]["solidKey"] = json!("certified-solid");
    let text = seal(m);
    Geometry::register(&text, &manifest::sha256(&text), &store).unwrap()
}
fn cube_fixture(reordered: bool) -> Geometry {
    let p = [
        [-1., -1., -1.],
        [1., -1., -1.],
        [1., 1., -1.],
        [-1., 1., -1.],
        [-1., -1., 1.],
        [1., -1., 1.],
        [1., 1., 1.],
        [-1., 1., 1.],
    ];
    let mut t = vec![
        [0, 3, 2],
        [0, 2, 1],
        [4, 5, 6],
        [4, 6, 7],
        [0, 4, 7],
        [0, 7, 3],
        [1, 2, 6],
        [1, 6, 5],
        [0, 1, 5],
        [0, 5, 4],
        [3, 7, 6],
        [3, 6, 2],
    ];
    if reordered {
        let right = t.remove(6);
        t.insert(0, right);
    }
    closed_fixture(&p, &t)
}

#[test]
fn selected_surface_visit_preserves_exact_posed_vertices_and_instance_range_identity() {
    let positions = [[-1., -1., 0.], [1., -1., 0.], [1., 1., 0.], [-1., 1., 0.],
        [-1., -1., 1.], [1., -1., 1.], [1., 1., 1.], [-1., 1., 1.]];
    let indices = [[0, 2, 1], [0, 3, 2], [4, 6, 5], [4, 7, 6]];
    let (mut geometry, _, _) = synthetic(&positions, &indices, 2, true);
    geometry.refit(&[("instance-1".into(), [-2.,0.,0.,0.,0.,3.,0.,0.,0.,0.,0.5,0.,7.,-4.,2.,1.])]).unwrap();
    let mut reference = vec![];
    geometry.visit_surface_triangles(|instance, surface, vertices| {
        if instance == "instance-1" && surface.key == "surface-b" { reference.push(vertices); }
    }).unwrap();
    let before = surface_triangle_visits_for_test();
    let mut selections = 0;
    let mut selected = vec![];
    geometry.visit_surface_triangles_selected(|instance, surface| {
        selections += 1;
        (instance == "instance-1" && surface.key == "surface-b").then_some(17usize)
    }, |instance, surface, owner, vertices| {
        assert_eq!(instance, "instance-1"); assert_eq!(surface.key, "surface-b"); assert_eq!(owner, 17);
        selected.push(vertices);
    }).unwrap();
    assert_eq!(selections, 4, "resolve ownership once per instance/range, not once per triangle");
    assert_eq!(surface_triangle_visits_for_test() - before, 2, "only selected triangles are transformed");
    assert_eq!(selected, reference, "selection preserves the exact original world vertex bits and triangle order under reflected, nonuniform, translated poses");
}

#[test]
fn surface_lookup_visit_uses_registered_ordinals_without_linear_key_search() {
    let positions = [[-1., -1., 0.], [1., -1., 0.], [1., 1., 0.], [-1., 1., 0.],
        [-1., -1., 1.], [1., -1., 1.], [1., 1., 1.], [-1., 1., 1.]];
    let indices = [[0, 2, 1], [0, 3, 2], [4, 6, 5], [4, 7, 6]];
    let (geometry, _, _) = synthetic(&positions, &indices, 2, true);
    let before = surface_key_comparisons_for_test();
    let mut visited = 0;
    geometry.visit_surface_triangles_selected(|_,_|Some(()),|_,_,(),_|visited+=1).unwrap();
    assert_eq!(visited, 8, "the cost optimization must retain every requested triangle");
    assert_eq!(surface_key_comparisons_for_test() - before, 0,
        "surface keys are pinned at registration; a blast must not repeat a linear key search for every mesh range");
}

#[test]
fn surface_lookup_rebuilds_on_registration_and_rejects_in_place_surface_reorder() {
    let positions = [[-1., -1., 0.], [1., -1., 0.], [1., 1., 0.], [-1., 1., 0.],
        [-1., -1., 1.], [1., -1., 1.], [1., 1., 1.], [-1., 1., 1.]];
    let indices = [[0, 2, 1], [0, 3, 2], [4, 6, 5], [4, 7, 6]];
    let (mut geometry, bytes, store) = synthetic(&positions, &indices, 2, true);
    let mut original = vec![];
    geometry.visit_surface_triangles(|instance,surface,vertices|original.push((instance.to_owned(),surface.key.clone(),vertices))).unwrap();
    // A freshly validated manifest may store the same surfaces in a different
    // order. Its new registration must own its new cache, with exact parity.
    let mut manifest:Value=serde_json::from_slice(&bytes).unwrap();
    manifest["surfaces"].as_array_mut().unwrap().reverse();
    let rebuilt_bytes=seal(manifest);
    let rebuilt=Geometry::register(&rebuilt_bytes,&manifest::sha256(&rebuilt_bytes),&store).unwrap();
    let mut next=vec![];
    rebuilt.visit_surface_triangles(|instance,surface,vertices|next.push((instance.to_owned(),surface.key.clone(),vertices))).unwrap();
    assert_eq!(next,original,"re-registration derives the exact new surface ordinals instead of retaining another scene's cache");
    // The public diagnostic manifest must not permit a stale ordinal to
    // select another surface after an unregistered membership/order change.
    geometry.manifest.surfaces.swap(0,1);
    assert!(geometry.visit_surface_triangles_selected(|_,_|Some(()),|_,_,(),_|{}).is_err(),
        "in-place surface reordering must fail closed; rebuild through Geometry::register");
}

#[test]
fn surface_lookup_storage_is_per_mesh_range_and_released_with_scene() {
    let positions = [[-1., -1., 0.], [1., -1., 0.], [1., 1., 0.], [-1., 1., 0.],
        [-1., -1., 1.], [1., -1., 1.], [1., 1., 1.], [-1., 1., 1.]];
    let indices = [[0, 2, 1], [0, 3, 2], [4, 6, 5], [4, 7, 6]];
    let (one, _, _) = synthetic(&positions, &indices, 1, true);
    let (many, _, mut store) = synthetic(&positions, &indices, 64, true);
    assert_eq!(many.range_surface_ordinals.len(), many.manifest.meshes.len());
    assert_eq!(many.range_surface_ordinals.iter().map(Vec::len).sum::<usize>(),
        many.manifest.meshes.iter().map(|mesh|mesh.ranges.len()).sum::<usize>(),
        "one bounded ordinal is stored for each validated mesh range");
    assert_eq!(one.memory_stats().surface_index_array_bytes,many.memory_stats().surface_index_array_bytes,
        "instances reuse their mesh's immutable range index instead of multiplying cache storage");
    store.collect_unused();
    assert_eq!(store.memory_stats().immutable_meshes,1);
    drop(many);
    store.collect_unused();
    assert_eq!(store.memory_stats().immutable_meshes,0,
        "scene release drops its mesh references; the owned ordinal arrays cannot retain geometry");
}
fn assert_cube_tangent(reordered: bool, end: Point) {
    let mut g = cube_fixture(reordered);
    let ctx = context(&g);
    let hits = g.trace([2., 0., 0.], end, &ctx, 32).unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].t, 0.5);
    assert_eq!(
        hits[0].crossing, "touch",
        "both adjacent intervals are outside the actual closed cube"
    );
}
#[test]
fn closed_tangent_edge_is_touch() {
    assert_cube_tangent(false, [0., 2., 0.]);
}
#[test]
fn closed_tangent_vertex_is_touch() {
    assert_cube_tangent(false, [0., 2., 2.]);
}
#[test]
fn closed_tangent_vertex_kind_survives_triangle_reordering() {
    assert_cube_tangent(true, [0., 2., 2.]);
}
#[test]
fn closed_nonconvex_reentrant_vertex_is_enter_and_reversed_exit() {
    let p = [
        [-2., -2., -2.],
        [2., -2., -2.],
        [2., 0., -2.],
        [0., 0., -2.],
        [0., 2., -2.],
        [-2., 2., -2.],
        [-2., -2., 0.],
        [2., -2., 0.],
        [2., 0., 0.],
        [0., 0., 0.],
        [0., 2., 0.],
        [-2., 2., 0.],
    ];
    let mut t = vec![
        [0, 3, 1],
        [1, 3, 2],
        [0, 5, 3],
        [3, 5, 4],
        [6, 7, 9],
        [7, 8, 9],
        [6, 9, 11],
        [9, 10, 11],
        [0, 1, 7],
        [0, 7, 6],
        [1, 2, 8],
        [1, 8, 7],
        [2, 3, 9],
        [2, 9, 8],
        [3, 4, 10],
        [3, 10, 9],
        [4, 5, 11],
        [4, 11, 10],
        [5, 0, 6],
        [5, 6, 11],
    ];
    for _ in 0..2 {
        let mut g = closed_fixture(&p, &t);
        let ctx = context(&g);
        let a = [1., -1., 1.];
        let b = [-1., 1., -1.];
        let h = g.trace(a, b, &ctx, 64).unwrap();
        assert_eq!(h.len(), 1);
        assert_eq!((h[0].t, h[0].crossing), (0.5, "enter"));
        let h = g.trace(b, a, &ctx, 64).unwrap();
        assert_eq!(h.len(), 1);
        assert_eq!((h[0].t, h[0].crossing), (0.5, "exit"));
        assert!(g.query_stats().occupancy_triangle_tests > 0);
        t.reverse();
    }
}
fn nested_shells(inward: bool, distinct: bool, copies: usize) -> Geometry {
    let p = [
        [-1., -1., -1.],
        [1., -1., -1.],
        [1., 1., -1.],
        [-1., 1., -1.],
        [-1., -1., 1.],
        [1., -1., 1.],
        [1., 1., 1.],
        [-1., 1., 1.],
    ];
    let cube = [
        [0, 3, 2],
        [0, 2, 1],
        [4, 5, 6],
        [4, 6, 7],
        [0, 4, 7],
        [0, 7, 3],
        [1, 2, 6],
        [1, 6, 5],
        [0, 1, 5],
        [0, 5, 4],
        [3, 7, 6],
        [3, 6, 2],
    ];
    let points: Vec<[f32; 3]> = p.iter().map(|p| p.map(|x| x * 2.)).chain(p).collect();
    let mut triangles = cube.to_vec();
    triangles.extend(cube.map(|t| {
        let mut t = t.map(|i| i + 8);
        if inward {
            t.swap(1, 2);
        }
        t
    }));
    let (_, text, store) = synthetic(&points, &triangles, copies, false);
    let mut m: Value = serde_json::from_slice(&text).unwrap();
    m["surfaces"][0]["role"] = json!("decoration");
    m["surfaces"][0]["topology"] = json!("closed_solid");
    let first = m["meshes"][0]["ranges"][0].clone();
    let mut outer = first.clone();
    outer["count"] = json!(12);
    outer["solidKey"] = json!("outer");
    let mut inner = first;
    inner["first"] = json!(12);
    inner["count"] = json!(12);
    inner["solidKey"] = json!(if distinct { "inner" } else { "outer" });
    m["meshes"][0]["ranges"] = json!([outer, inner]);
    let text = seal(m);
    Geometry::register(&text, &manifest::sha256(&text), &store).unwrap()
}
#[test]
fn closed_cavity_and_nested_outward_overlap_use_signed_union_occupancy() {
    for (inward, kinds) in [
        (true, ["enter", "exit", "enter", "exit"]),
        (false, ["enter", "touch", "touch", "exit"]),
    ] {
        let mut g = nested_shells(inward, false, 1);
        let ctx = context(&g);
        let h = g.trace([-3., 0.2, 0.1], [3., 0.2, 0.1], &ctx, 64).unwrap();
        assert_eq!(h.len(), 4);
        assert_eq!(h.iter().map(|h| h.crossing).collect::<Vec<_>>(), kinds);
        for (h, t) in h.iter().zip([1. / 6., 1. / 3., 2. / 3., 5. / 6.]) {
            assert!((h.t - t).abs() < 1e-14);
        }
    }
}
#[test]
fn closed_distinct_solids_and_instances_keep_independent_occupancy() {
    let mut g = nested_shells(false, true, 2);
    let ctx = context(&g);
    let h = g.trace([-3., 0.2, 0.1], [3., 0.2, 0.1], &ctx, 64).unwrap();
    assert_eq!(h.len(), 8);
    for instance in ["instance-0", "instance-1"] {
        assert_eq!(
            h.iter()
                .filter(|h| h.instance_id == instance)
                .map(|h| h.crossing)
                .collect::<Vec<_>>(),
            ["enter", "enter", "exit", "exit"]
        );
    }
}
#[test]
fn closed_endpoint_coplanar_mirror_and_zero_length_keep_boundary_semantics() {
    let mut g = cube_fixture(false);
    let ctx = context(&g);
    for (a, b, t, kind) in [
        ([1., 0.2, 0.1], [0., 0.2, 0.1], 0., "enter"),
        ([0., 0.2, 0.1], [1., 0.2, 0.1], 1., "exit"),
        ([1., 1., 0.], [0., 2., 0.], 0., "touch"),
        ([2., 1., 0.], [0., 1., 0.], 0.5, "touch"),
        ([1., 0., 0.], [1., 0., 0.], 0., "touch"),
    ] {
        let h = g.trace(a, b, &ctx, 32).unwrap();
        assert!(!h.is_empty());
        assert_eq!(h[0].t, t);
        assert!(
            h.iter().all(|h| h.crossing == kind),
            "a={a:?} b={b:?} expected={kind} actual={h:?}"
        );
    }
    g.refit(&[(
        "instance-0".into(),
        [
            -1., 0., 0., 0., 0., 1., 0., 0., 0., 0., 1., 0., 0., 0., 0., 1.,
        ],
    )])
    .unwrap();
    let h = g.trace([-2., 0., 0.], [0., 2., 0.], &ctx, 32).unwrap();
    assert_eq!(h.len(), 1);
    assert_eq!(h[0].crossing, "touch");
}
#[test]
fn closed_occupancy_work_limit_is_explicit_and_counted() {
    let g = cube_fixture(false);
    let mesh = &g.instances[0].mesh.data;
    let ranges = surface::solid_ranges(
        &g.manifest.meshes[0].ranges,
        &g.manifest.surfaces,
        "certified-solid",
    );
    let mut stats = QueryStats {
        occupancy_triangle_tests: MAX_OCCUPANCY_TRIANGLE_TESTS,
        ..Default::default()
    };
    assert!(surface::solid_membership(
        mesh,
        &ranges,
        [0., 0., 0.],
        [-2., 0., 0.],
        [2., 0., 0.],
        &mut stats
    )
    .unwrap_err()
    .contains("work limit"));
    assert_eq!(stats.occupancy_triangle_tests, MAX_OCCUPANCY_TRIANGLE_TESTS);
    assert_eq!(stats.occupancy_point_tests, 1);
    let mut stats = QueryStats {
        occupancy_predicate_products: MAX_OCCUPANCY_PREDICATE_PRODUCTS,
        ..Default::default()
    };
    assert!(surface::same_line_contact(
        mesh.triangle(0),
        mesh.triangle(2),
        [0., 0., -2.],
        [0., 0., 2.],
        &mut stats
    )
    .unwrap_err()
    .contains("product-work limit"));
    assert_eq!(
        stats.occupancy_predicate_products,
        MAX_OCCUPANCY_PREDICATE_PRODUCTS
    );
}
#[test]
fn closed_unrepresentable_distinct_contact_intervals_return_explicit_error() {
    let cube = cube_fixture(false);
    let tiny = f32::from_bits(1);
    let p: Vec<[f32; 3]> = cube.instances[0]
        .mesh
        .data
        .positions
        .iter()
        .map(|p| [p[0] * tiny, p[1], p[2]])
        .collect();
    let mut g = closed_fixture(&p, &cube.instances[0].mesh.data.indices);
    let ctx = context(&g);
    assert!(g
        .trace([-1., 0.2, 0.1], [1., 0.2, 0.1], &ctx, 32)
        .unwrap_err()
        .contains("interval"));
}
#[test]
fn closed_surface_partitions_share_one_solid_feature_crossing() {
    let cube = cube_fixture(false);
    let mesh = &cube.instances[0].mesh.data;
    let (_, text, store) = synthetic(&mesh.positions, &mesh.indices, 1, false);
    let mut m: Value = serde_json::from_slice(&text).unwrap();
    m["surfaces"][0]["role"] = json!("decoration");
    m["surfaces"][0]["topology"] = json!("closed_solid");
    let mut second = m["surfaces"][0].clone();
    second["key"] = json!("surface-b");
    m["surfaces"].as_array_mut().unwrap().push(second);
    let mut first = m["meshes"][0]["ranges"][0].clone();
    first["count"] = json!(7);
    first["solidKey"] = json!("cube");
    let mut second = first.clone();
    second["first"] = json!(7);
    second["count"] = json!(5);
    second["surfaceKey"] = json!("surface-b");
    m["meshes"][0]["ranges"] = json!([first, second]);
    let text = seal(m);
    let mut g = Geometry::register(&text, &manifest::sha256(&text), &store).unwrap();
    let ctx = context(&g);
    let h = g.trace([2., 0., 0.], [0., 2., 0.], &ctx, 32).unwrap();
    assert_eq!(h.len(), 1);
    assert_eq!(h[0].crossing, "touch");
}
#[test]
fn closed_internal_overlap_coplanar_sheet_does_not_remove_outer_occupancy() {
    let mut g = nested_shells(false, false, 1);
    let ctx = context(&g);
    let h = g.trace([-3., 1., 0.1], [3., 1., 0.1], &ctx, 64).unwrap();
    assert_eq!(h.first().unwrap().crossing, "enter");
    assert_eq!(h.last().unwrap().crossing, "exit");
    assert!(
        h[1..h.len() - 1].iter().all(|h| h.crossing == "touch"),
        "internal overlapping boundary is still inside the outer volume: {h:?}"
    );
}
#[test]
fn closed_cancellation_does_not_certify_a_false_coplanar_boundary() {
    let g = closed_fixture(
        &[[0., 0., 0.], [1., 0., 1.], [0., 1., 1.], [0., 0., -1.]],
        &[[0, 1, 2], [0, 3, 1], [0, 2, 3], [1, 3, 2]],
    );
    let mesh = &g.instances[0].mesh.data;
    let ranges = surface::solid_ranges(
        &g.manifest.meshes[0].ranges,
        &g.manifest.surfaces,
        "certified-solid",
    );
    let tiny = 2f64.powi(-56);
    let mut stats = QueryStats::default();
    assert!(
        surface::solid_membership(
            mesh,
            &ranges,
            [0.25, tiny, 0.25],
            [0.125, tiny, 0.125],
            [0.375, tiny, 0.375],
            &mut stats
        )
        .is_err(),
        "rounded plane zero must not certify an exterior boundary for an actual interior point"
    );
}
#[test]
fn closed_isolated_plane_cancellation_cannot_skip_an_actual_interior_face() {
    let g = closed_fixture(
        &[[-2., -2., -4.], [2., -2., 0.], [0., 2., 2.], [0., 0., -2.]],
        &[[0, 1, 2], [0, 3, 1], [0, 2, 3], [1, 3, 2]],
    );
    let mesh = &g.instances[0].mesh.data;
    let ranges = surface::solid_ranges(
        &g.manifest.meshes[0].ranges,
        &g.manifest.surfaces,
        "certified-solid",
    );
    let tiny = 2f64.powi(-56);
    let mut stats = QueryStats::default();
    let result = surface::solid_membership(
        mesh,
        &ranges,
        [0.25, tiny, 0.25],
        [0.125, tiny, 0.125],
        [0.375, tiny, 0.375],
        &mut stats,
    );
    assert!(result.is_err()||result==Ok(true),"actual strict interior cannot become a false exterior from rounded subtraction: {result:?}");
}
#[test]
fn closed_sheared_subnormal_slab_reports_collapsed_oblique_intervals() {
    let cube = cube_fixture(false);
    let tiny = f32::from_bits(1);
    let p: Vec<[f32; 3]> = cube.instances[0]
        .mesh
        .data
        .positions
        .iter()
        .map(|p| [p[0], tiny * (p[0] + p[1]), p[2]])
        .collect();
    let mut g = closed_fixture(&p, &cube.instances[0].mesh.data.indices);
    let ctx = context(&g);
    assert!(g
        .trace([0., -1., 0.1], [0., 1., 0.1], &ctx, 32)
        .unwrap_err()
        .contains("interval"));
}
#[test]
fn closed_diamond_edge_boundary_skips_exact_incident_plane_cuts() {
    let cube = cube_fixture(false);
    let p: Vec<[f32; 3]> = cube.instances[0]
        .mesh
        .data
        .positions
        .iter()
        .map(|p| [p[0] - p[1], p[0] + p[1], p[2]])
        .collect();
    let mut g = closed_fixture(&p, &cube.instances[0].mesh.data.indices);
    let ctx = context(&g);
    let h = g.trace([2., 0., -2.], [2., 0., 2.], &ctx, 32).unwrap();
    assert!(!h.is_empty());
    assert!(h.iter().all(|h| h.crossing == "touch"));
}
#[test]
fn actual_renderer_hetzer_and_hollow_tube_recorded_oracles() {
    let i = index();
    let full = i["entries"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["specId"] == "de_hetzer")
        .unwrap()["manifestFile"]
        .as_str()
        .unwrap();
    let mut g = register_file(full);
    let ctx = context(&g);
    assert!(g
        .trace([-3., 0.15, -1.9], [3., 0.15, -1.9], &ctx, 4096)
        .unwrap()
        .is_empty());
    let mut tube = register_file(i["fixtures"]["tube"]["manifestFile"].as_str().unwrap());
    let ctx = context(&tube);
    assert_eq!(
        tube.manifest.meshes[0].positions_hash,
        "d514cca1fd4a062ecdc172eddcf665960e11490a8a52d31574d98988094536f5"
    );
    assert_eq!(
        tube.manifest.meshes[0].render_buffer_hash,
        "9bdaffb74fedb4d48e4159b8c3c48ac0615e1bd06d1a081e406cc0161d062a11"
    );
    assert!(tube
        .trace([0.38, 1.44, 3.83], [0.38, 1.44, 3.63], &ctx, 4096)
        .unwrap()
        .is_empty());
    let hits = tube
        .trace([0.534, 1.44, 3.015], [0.38, 1.44, 3.015], &ctx, 4096)
        .unwrap();
    assert_eq!(hits.len(), 2);
    assert_eq!((hits[0].triangle_id, hits[1].triangle_id), (41, 47));
    assert!((hits[0].t - 0.6720780188743095).abs() < 2e-12);
    assert!((hits[1].t - 0.7564935915346532).abs() < 2e-12);
    assert!(hits
        .iter()
        .all(|h| h.topology_pending && h.crossing == "touch"));
    let side = serde_json::to_value(hits).unwrap();
    macro_rules! pin {
        ($p:literal) => {
            (
                $p,
                manifest::sha256(include_bytes!(concat!("../../../../", $p))),
            )
        };
    }
    let pins = [
        pin!("Cargo.toml"),
        pin!("Cargo.lock"),
        pin!("crates/combat/Cargo.toml"),
        pin!("crates/combat/src/lib.rs"),
        pin!("crates/combat/src/geometry/mod.rs"),
        pin!("crates/combat/src/geometry/manifest.rs"),
        pin!("crates/combat/src/geometry/bvh.rs"),
        pin!("crates/combat/src/geometry/ray.rs"),
        pin!("crates/combat/src/geometry/surface.rs"),
        pin!("crates/combat/src/geometry/tests.rs"),
        pin!("crates/combat/src/geometry/combat_scene.rs"),
        pin!("crates/design-wasm/src/lib.rs"),
        pin!("crates/design-wasm/src/geometry_diagnostic.rs"),
        pin!("crates/design-wasm/src/surface_runtime.rs"),
        pin!("client/web/src/design/core.js"),
        pin!("client/web/src/gfx/imported.js"),
        pin!("client/web/tools/export-hit-mesh.mjs"),
        pin!("client/web/tools/hit-mesh-capture.mjs"),
        pin!("client/web/tools/fleet-authored-bindings.mjs"),
        pin!("client/web/tools/fleet-additional-authored-bindings.mjs"),
        pin!("client/web/src/collision/physicalNodeKey.js"),
        pin!("client/web/src/game/barrelShapeComposition.js"),
        pin!("schemas/hit-mesh.schema.json"),
        pin!("client/web/tools/hit-binding-catalog.mjs"),
        pin!("schemas/hit-binding-catalog.schema.json"),
        pin!("client/web/test/hit-binding-catalog.test.mjs"),
        pin!("client/web/test/exact-hit-mesh.test.mjs"),
        pin!("client/web/test/fixtures/exact-hit-x1-oracle-witness.json"),
        pin!("client/web/test/exact-hit-source-receipt.test.mjs"),
        pin!("client/web/tools/measure-hit-mesh.mjs"),
        pin!("client/web/test/exact-hit-static-cost.test.mjs"),
        pin!("client/web/src/gfx/tankmodel.js"),
        pin!("client/web/src/gfx/geo.js"),
        pin!("client/web/src/gfx/interior.js"),
        pin!("client/web/src/gfx/mgmodel.js"),
        pin!("client/web/src/gfx/track.js"),
        pin!("client/web/src/sim/tank/trackChain.js"),
        pin!("client/web/src/gfx/gearSupports.js"),
        pin!("client/web/src/game/loadout.js"),
        pin!("client/web/src/game/workshopImported.js"),
        pin!("client/web/src/gfx/math.js"),
        pin!("client/web/src/game/combat.js"),
        pin!("client/web/src/game/localSurfaceCombat.js"),
        pin!("client/web/tools/load-surface-catalog.mjs"),
        pin!("client/web/src/game/workshopBuild.js"),
        pin!("client/web/tools/load-data.mjs"),
        pin!("client/web/src/gfx/renderer.js"),
        pin!("client/web/src/game/turretSeat.js"),
        pin!("client/web/src/game/rangefinderEquipment.js"),
        pin!("client/web/src/gfx/t72aModel.js"),
        pin!("client/web/src/collision/meshHitbox.js"),
    ];
    let source_pins: std::collections::BTreeMap<_, _> = pins.into_iter().collect();
    let file = i["fixtures"]["tube"]["manifestFile"].as_str().unwrap();
    let receipt = json!({"schema":"ExactHitGeometryNativeReceiptV1","manifestFile":file,"manifestHash":i["fixtures"]["tube"]["manifestHash"],"positionHash":tube.manifest.meshes[0].positions_hash,"renderBufferHash":tube.manifest.meshes[0].render_buffer_hash,"empty":[],"axial":[],"side":side,"context":ctx,"sourcePins":source_pins});
    let destination = std::env::var_os("TG_GEOMETRY_RECEIPT")
        .map(PathBuf::from)
        .unwrap_or_else(|| root().join("target/exact-hit-geometry-native.json"));
    fs::write(destination, serde_json::to_vec_pretty(&receipt).unwrap()).unwrap();
}
#[test]
fn all_exported_manifests_are_structurally_valid_and_not_damage_certified() {
    let i = index();
    let mut store = MeshStore::default();
    let mut declared_meshes = 0;
    for e in i["entries"]
        .as_array()
        .unwrap()
        .iter()
        .chain(i["workshop"].as_array().unwrap())
    {
        let bytes = fs::read(
            root()
                .join("data/hit-meshes")
                .join(e["manifestFile"].as_str().unwrap()),
        )
        .unwrap();
        let m: HitMeshManifestV1 = serde_json::from_slice(&bytes).unwrap();
        declared_meshes += m.meshes.len();
        for mesh in &m.meshes {
            let b = fs::read(
                root()
                    .join("data/hit-meshes")
                    .join(format!("{}.bin", mesh.payload_hash)),
            )
            .unwrap();
            store.install(&b, &mesh.payload_hash).unwrap();
        }
        let g = Geometry::register(&bytes, &manifest::sha256(&bytes), &store).unwrap();
        assert!(g
            .manifest
            .surfaces
            .iter()
            .all(|s| s.topology == manifest::Topology::AuditPending));
        assert!(g.instance_count() > 0);
    }
    assert!(
        store.stats().0 < declared_meshes,
        "identical immutable crew/wheel/track meshes are shared across fleet builds"
    );
}
#[test]
fn finite_watertight_edges_vertices_coplanar_nearparallel_and_reversed() {
    let tri = [[0., 0., 0.], [1., 0., 0.], [0., 1., 0.]];
    for p in [[0.2, 0.3, 0.], [0., 0., 0.], [0.5, 0.5, 0.], [1., 0., 0.]] {
        let a = [p[0], p[1], -1.];
        let b = [p[0], p[1], 1.];
        let h = hit_triangle(a, b, tri).unwrap();
        assert_eq!(h.t, 0.5);
        assert_eq!(hit_triangle(b, a, tri).unwrap().t, 0.5);
    }
    assert!(
        hit_triangle([-1e-10, 0.5, -1.], [-1e-10, 0.5, 1.], tri).is_none(),
        "no gameplay inflation"
    );
    let h = hit_triangle([-1., 0.25, 0.], [1., 0.25, 0.], tri).unwrap();
    assert!(h.coplanar);
    assert_eq!(h.t, 0.5);
    assert!(hit_triangle([-1., 2., 0.], [1., 2., 0.], tri).is_none());
    assert!(
        (hit_triangle([0.2, 0.2, -1e-15], [0.21, 0.2, 1e-15], tri)
            .unwrap()
            .t
            - 0.5)
            .abs()
            < 1e-12
    );
    assert_eq!(
        hit_triangle([0.2, 0.2, 0.], [0.2, 0.2, 0.], tri).unwrap().t,
        0.0
    );
    assert!(hit_triangle([0.2, 0.2, 1.], [0.2, 0.2, 2.], tri).is_none());
}
fn dyadic_plane(p: Point, signs: [i128; 3]) -> i128 {
    // Independent analytic plane oracle: integer dyadics, no production dot/cross.
    (0..3)
        .map(|k| (p[k] * 2f64.powi(56)) as i128 * signs[k])
        .sum()
}
fn numerical_error(error: &str) -> bool {
    [
        "precision",
        "uncertainty",
        "underflow",
        "overflow",
        "certified",
        "interval",
        "lost actual contact",
    ]
    .iter()
    .any(|word| error.contains(word))
}
#[test]
fn triangle_plane_cancellation_parallel_outside_is_empty_or_explicit_error() {
    let d = 2f64.powi(-55);
    let a = [-0.25, d, 0.25];
    let b = [0.25, d, -0.25];
    assert_eq!(dyadic_plane(a, [1, 1, 1]), 2);
    assert_eq!(dyadic_plane(b, [1, 1, 1]), 2);
    match ray::triangle(a, b, [[-1., 0., 1.], [0., 1., -1.], [1., -1., 0.]]) {
        Ok(None) => {}
        Err(e) => assert!(numerical_error(&e), "{e}"),
        other => panic!("outside analytic plane returned {other:?}"),
    }
}
#[test]
fn triangle_noncoplanar_original_edge_cancellation_cannot_grant_outside_contact() {
    let d = 2f64.powi(-55);
    let a = [-d, 0., -1.];
    let b = [-d, 0., 1.];
    assert_eq!(
        (a[0] * 2f64.powi(56)) as i128 + (a[1] * 2f64.powi(56)) as i128,
        -2
    );
    for v in [
        [[1., -1., 0.], [-1., 1., 0.], [1., 1., 0.]],
        [[-1., 1., 0.], [1., -1., 0.], [1., 1., 0.]],
    ] {
        for (a, b) in [(a, b), (b, a)] {
            match ray::triangle(a, b, v) {
                Ok(None) => {}
                Err(e) => assert!(numerical_error(&e), "{e}"),
                other => panic!("outside analytic x+y edge returned {other:?}"),
            }
        }
    }
}
#[test]
fn triangle_t72_cancelled_projected_edge_certifies_actual_outside_candidate() {
    // Captured unchanged from the real T72 breech transit's local triangle
    // query. Both segment endpoints lie above every represented vertex.
    let v = [
        [
            -0.1420000046491623,
            -1.9471884559057475e-17,
            -0.2619999945163727,
        ],
        [
            -0.12200000137090683,
            0.06681809574365616,
            -0.24674920737743378,
        ],
        [
            -0.12200000137090683,
            -1.8247237044727817e-17,
            -0.2619999945163727,
        ],
    ];
    let a = [
        2.6100000143051147,
        0.10000002384185791,
        -0.25999999046325684,
    ];
    let b = [
        -3.3899999856948853,
        0.10000002384185791,
        -0.25999999046325684,
    ];
    assert!(v.iter().all(|p| p[1] < a[1]));
    for order in [
        [0, 1, 2],
        [0, 2, 1],
        [1, 0, 2],
        [1, 2, 0],
        [2, 0, 1],
        [2, 1, 0],
    ] {
        for (start, end) in [(a, b), (b, a)] {
            assert!(ray::triangle(start, end, order.map(|i| v[i]))
                .unwrap()
                .is_none());
        }
    }
}
#[test]
fn triangle_cancelled_projected_edge_certifies_positive_interior_weight() {
    // The independent half-space x+y=d proves a strict interior crossing,
    // with the third vertex's weight d/2. Its projected edge rounds to zero.
    for exponent in [-40, 0, 40] {
        let s = 2f64.powi(exponent);
        let d = s * 2f64.powi(-55);
        for rotation in 0..3 {
            let project = |p: Point| std::array::from_fn(|k| p[(k + rotation) % 3] * s);
            let vertices = [[1., -1., 0.], [-1., 1., 0.], [1., 1., 0.]].map(project);
            let a = project([d / s, 0., -1.]);
            let b = project([d / s, 0., 1.]);
            for order in [
                [0, 1, 2],
                [0, 2, 1],
                [1, 0, 2],
                [1, 2, 0],
                [2, 0, 1],
                [2, 1, 0],
            ] {
                for (start, end) in [(a, b), (b, a)] {
                    let c = ray::triangle(start, end, order.map(|i| vertices[i]))
                        .unwrap()
                        .unwrap();
                    assert_eq!(c.t, 0.5);
                    assert!(!c.coplanar);
                    assert_eq!(
                        c.barycentric[order.iter().position(|&i| i == 2).unwrap()],
                        2f64.powi(-56)
                    );
                    assert!(c
                        .barycentric
                        .iter()
                        .all(|&weight| weight > 0.0 && weight <= 1.0));
                }
            }
        }
    }
}
#[test]
fn triangle_exact_oblique_endpoint_is_not_lost_by_weighted_distance_rounding() {
    let v = [[-1., 0., 1.], [0., 1., -1.], [1., -1., 0.]];
    let a = [0.25, 0.25, -0.5];
    let b = [1.25, 0.25, -0.5];
    assert_eq!(dyadic_plane(a, [1, 1, 1]), 0);
    assert_eq!(dyadic_plane(b, [1, 1, 1]), 1i128 << 56);
    for (a, b, expected) in [(a, b, 0.), (b, a, 1.)] {
        match ray::triangle(a, b, v) {
            Ok(Some(c)) => {
                assert_eq!(c.t, expected);
                assert!(!c.coplanar);
            }
            Err(e) => assert!(numerical_error(&e), "{e}"),
            other => panic!("exact analytic endpoint lost: {other:?}"),
        }
    }
}
#[test]
fn triangle_rounded_zero_normal_cannot_silently_certify_exact_f32_degeneracy() {
    let large = 2f32.powi(80) as f64;
    let tiny = 2f32.powi(-80) as f64;
    assert_eq!(large * tiny, 1.0);
    let v = [
        [large, large, 0.],
        [2. * large, 2. * large, 0.],
        [0., tiny, 0.],
    ];
    let a = [0., tiny, -1.];
    let b = [0., tiny, 1.];
    match ray::triangle(a, b, v) {
        Ok(Some(c)) => assert_eq!(c.t, 0.5),
        Err(e) => assert!(numerical_error(&e), "{e}"),
        other => panic!("exact nondegenerate vertex contact lost: {other:?}"),
    }
}
#[test]
fn triangle_plane_cancellation_center_root_is_half_or_explicit_error() {
    let d = 2f64.powi(-55);
    let a = [-0.25, -d, 0.25];
    let b = [0.25, d, -0.25];
    assert_eq!(dyadic_plane(a, [1, 1, 1]), -2);
    assert_eq!(dyadic_plane(b, [1, 1, 1]), 2);
    match ray::triangle(a, b, [[-1., 0., 1.], [0., 1., -1.], [1., -1., 0.]]) {
        Ok(Some(c)) => {
            assert_eq!(c.t, 0.5);
            assert!(!c.coplanar);
        }
        Err(e) => assert!(numerical_error(&e), "{e}"),
        other => panic!("true analytic center crossing returned {other:?}"),
    }
}
#[test]
fn triangle_plane_cancellation_same_side_oblique_is_empty_or_explicit_error() {
    let d = 2f64.powi(-55);
    let a = [-0.25, d, 0.25];
    let b = [0.25, 2. * d, -0.25];
    assert_eq!(dyadic_plane(a, [1, 1, 1]), 2);
    assert_eq!(dyadic_plane(b, [1, 1, 1]), 4);
    match ray::triangle(a, b, [[-1., 0., 1.], [0., 1., -1.], [1., -1., 0.]]) {
        Ok(None) => {}
        Err(e) => assert!(numerical_error(&e), "{e}"),
        other => panic!("same-side analytic plane returned {other:?}"),
    }
}
#[test]
fn triangle_coplanar_original_coordinate_edge_cancellation_cannot_grant_an_outside_point() {
    let d = 2f64.powi(-55);
    let p = [d, 1., 0.];
    // The edge x+2*y=2 has strictly positive residual d: p is outside.
    let residual =
        (p[0] * 2f64.powi(56)) as i128 + 2 * ((p[1] * 2f64.powi(56)) as i128) - (2i128 << 56);
    assert_eq!(residual, 2);
    for v in [
        [[1., 0., 0.], [2., 0., 0.], [0., 1., 0.]],
        [[2., 0., 0.], [1., 0., 0.], [0., 1., 0.]],
    ] {
        match ray::triangle(p, p, v) {
            Ok(None) => {}
            Err(e) => assert!(numerical_error(&e), "{e}"),
            other => panic!("outside analytic edge returned {other:?}"),
        }
    }
}
#[test]
fn triangle_affine_inverse_cancellation_cannot_silently_miss_a_true_world_crossing() {
    let p = [[-1f32, 0., 0.], [0., 1., 0.], [1., -1., 0.], [0., 0., -2.]];
    let matrix = [
        1., 0., -3., 0., 0., 1., -3., 0., 0., 0., 1., 0., 0., 0., 0., 1.,
    ];
    let q = 2f64.powi(-54);
    for exponent in [-100, -40] {
        let d = 2f64.powi(exponent);
        let a = [0.25 + q, -0.25 + q, -6. * q - d];
        let b = [a[0], a[1], -6. * q + d];
        let residual = |p: Point| {
            3 * (p[0] * 2f64.powi(100)) as i128
                + 3 * (p[1] * 2f64.powi(100)) as i128
                + (p[2] * 2f64.powi(100)) as i128
        };
        assert_eq!(residual(a), -(1i128 << (100 + exponent)));
        assert_eq!(residual(b), 1i128 << (100 + exponent));
        for topology in [
            "audit_pending",
            "open_sheet",
            "boundary_shell",
            "decorative_surface",
            "closed_solid",
        ] {
            let indices = if topology == "closed_solid" {
                vec![[0, 1, 2], [0, 3, 1], [0, 2, 3], [1, 3, 2]]
            } else {
                vec![[0, 1, 2]]
            };
            let (_, text, store) = synthetic(&p, &indices, 1, false);
            let mut m: Value = serde_json::from_slice(&text).unwrap();
            if topology != "audit_pending" {
                m["surfaces"][0]["role"] = json!("decoration");
                m["surfaces"][0]["topology"] = json!(topology);
            }
            if topology == "closed_solid" {
                m["meshes"][0]["ranges"][0]["solidKey"] = json!("analytic-tetrahedron");
            }
            let text = seal(m);
            let mut g = Geometry::register(&text, &manifest::sha256(&text), &store).unwrap();
            g.refit(&[("instance-0".into(), matrix)]).unwrap();
            let ctx = context(&g);
            for (a, b) in [(a, b), (b, a)] {
                match g.trace(a, b, &ctx, 32) {
                    Ok(h) => {
                        assert_eq!(h.len(), 1, "silent affine miss for {topology}");
                        assert_eq!(h[0].t, 0.5);
                    }
                    Err(e) => assert!(numerical_error(&e), "{e}"),
                }
            }
        }
    }
}
#[test]
fn triangle_inverse_translation_cancellation_cannot_preserve_a_biased_shear_origin() {
    let q = 2f64.powi(-54);
    let d = 2f64.powi(-55);
    let matrix = [
        1.,
        0.,
        -3.,
        0.,
        0.,
        1.,
        -3.,
        0.,
        0.,
        0.,
        1.,
        0.,
        0.25 + q,
        -0.25 + q,
        -6. * q,
        1.,
    ];
    let (mut g, _, _) = synthetic(
        &[[-0.25, 0.25, 0.], [-0.125, 0.125, 0.], [-0.25, 0.125, 0.]],
        &[[0, 1, 2]],
        1,
        false,
    );
    g.refit(&[("instance-0".into(), matrix)]).unwrap();
    let ctx = context(&g);
    let a = [0.03125 + q, -0.0625 + q, 0.09375 - 6. * q - d];
    let b = [a[0], a[1], 0.09375 - 6. * q + d];
    assert_eq!(dyadic_plane(a, [3, 3, 1]), -2);
    assert_eq!(dyadic_plane(b, [3, 3, 1]), 2);
    for (a, b) in [(a, b), (b, a)] {
        match g.trace(a, b, &ctx, 32) {
            Ok(h) => {
                assert_eq!(h.len(), 1, "biased stored inverse caused silent miss");
                assert_eq!(h[0].t, 0.5);
            }
            Err(e) => assert!(numerical_error(&e), "{e}"),
        }
    }
}
#[test]
fn triangle_cancellation_all_topologies_winding_reverse_affine_and_recovery_use_dyadic_oracle() {
    let canonical = [[-1f32, 0., 1.], [0., 1., -1.], [1., -1., 0.], [0., 0., -2.]];
    let xy = [[-1f32, 0., 0.], [0., 1., 0.], [1., -1., 0.], [0., 0., -2.]];
    let id = identity().map(|x| f32::from_bits(x) as f64);
    let mut mirror = id;
    mirror[0] = -1.;
    let mut translated = id;
    translated[12] = 4.;
    translated[14] = -4.;
    let shear = [
        1., 0., -1., 0., 0., 1., -1., 0., 0., 0., 1., 0., 0., 0., 0., 1.,
    ];
    let mut mirror_shear = shear;
    mirror_shear[0] = -1.;
    let variants = [
        ("identity", canonical, id, [1, 1, 1], false, false),
        ("mirror", canonical, mirror, [-1, 1, 1], true, false),
        ("translated", canonical, translated, [1, 1, 1], false, true),
        ("shear", xy, shear, [1, 1, 1], false, false),
        ("mirror-shear", xy, mirror_shear, [-1, 1, 1], true, false),
    ];
    let orders = [
        [0u32, 1, 2],
        [0, 2, 1],
        [1, 0, 2],
        [1, 2, 0],
        [2, 0, 1],
        [2, 1, 0],
    ];
    let mut failures = Vec::new();
    let mut queries = 0;
    for topology in [
        "audit_pending",
        "open_sheet",
        "boundary_shell",
        "decorative_surface",
        "closed_solid",
    ] {
        for (name, positions, matrix, signs, reflect, translate) in variants {
            for order in orders {
                let indices = if topology == "closed_solid" {
                    vec![
                        order,
                        [order[0], 3, order[1]],
                        [order[0], order[2], 3],
                        [order[1], 3, order[2]],
                    ]
                } else {
                    vec![order]
                };
                let (_, text, store) = synthetic(&positions, &indices, 1, false);
                let mut m: Value = serde_json::from_slice(&text).unwrap();
                if topology != "audit_pending" {
                    m["surfaces"][0]["role"] = json!("decoration");
                    m["surfaces"][0]["topology"] = json!(topology);
                }
                if topology == "closed_solid" {
                    m["meshes"][0]["ranges"][0]["solidKey"] = json!("analytic-tetrahedron");
                }
                let text = seal(m);
                let mut g = Geometry::register(&text, &manifest::sha256(&text), &store).unwrap();
                g.refit(&[("instance-0".into(), matrix)]).unwrap();
                let ctx = context(&g);
                let world = |mut p: Point| {
                    if reflect {
                        p[0] = -p[0];
                    }
                    if translate {
                        p[0] += 4.;
                        p[2] -= 4.;
                    }
                    p
                };
                for exponent in [-55, -56, -40] {
                    let d = 2f64.powi(exponent);
                    for (label, a, b, center) in [
                        ("parallel", [-0.25, d, 0.25], [0.25, d, -0.25], false),
                        ("center", [-0.25, -d, 0.25], [0.25, d, -0.25], true),
                        ("oblique", [-0.25, d, 0.25], [0.25, 2. * d, -0.25], false),
                    ] {
                        let a = world(a);
                        let b = world(b);
                        let ra = dyadic_plane(a, signs);
                        let rb = dyadic_plane(b, signs);
                        assert_ne!(ra, 0);
                        assert_ne!(rb, 0);
                        assert_eq!(ra == -rb, center);
                        for (a, b) in [(a, b), (b, a)] {
                            queries += 1;
                            match g.trace(a, b, &ctx, 32) {
                                Err(e) => assert!(numerical_error(&e), "unexpected error: {e}"),
                                Ok(h) => {
                                    let correct = if center {
                                        h.len() == 1 && h[0].t == 0.5
                                    } else {
                                        h.is_empty()
                                    };
                                    if !correct {
                                        failures.push(format!(
                                            "{topology}/{name}/{order:?}/{exponent}/{label}: {h:?}"
                                        ));
                                    }
                                }
                            }
                        }
                    }
                }
                // Error recovery and genuine representable coplanarity must still work.
                let h = g
                    .trace(
                        world([-0.25, -0.125, 0.25]),
                        world([0.25, 0.125, -0.25]),
                        &ctx,
                        32,
                    )
                    .unwrap();
                assert_eq!(h.len(), 1);
                assert!((h[0].t - 0.5).abs() <= 2. * f64::EPSILON);
                if topology != "closed_solid" {
                    let h = g
                        .trace(world([-0.25, 0., 0.25]), world([0.25, 0., -0.25]), &ctx, 32)
                        .unwrap();
                    assert_eq!(h.len(), 1);
                    assert_eq!(h[0].t, 0.);
                }
            }
        }
    }
    assert_eq!(queries, 2700);
    assert!(
        failures.is_empty(),
        "{} wrong successful results; first: {:?}",
        failures.len(),
        failures.first()
    );
}
#[test]
fn declared_shared_edge_is_single_crossing_but_coincident_layers_and_instances_survive() {
    let p = [[0f32, 0., 0.], [1., 0., 0.], [1., 1., 0.], [0., 1., 0.]];
    let t = [[0, 1, 2], [0, 2, 3], [0, 1, 2], [0, 2, 3]];
    let (mut g, _, _) = synthetic(&p, &t, 2, true);
    let ctx = context(&g);
    let h = g.trace([0.5, 0.5, -1.], [0.5, 0.5, 1.], &ctx, 16).unwrap();
    assert_eq!(h.len(), 4);
    assert_eq!(
        h.iter()
            .map(|h| (h.instance_id.as_str(), h.solid_id.as_deref(), h.triangle_id))
            .collect::<Vec<_>>(),
        vec![
            ("instance-0", Some("layer-a"), 0),
            ("instance-0", Some("layer-b"), 2),
            ("instance-1", Some("layer-a"), 0),
            ("instance-1", Some("layer-b"), 2)
        ]
    );
}
#[test]
fn source_triangle_identity_survives_split_and_reordered_classification() {
    let p = [
        [0f32, 0., 0.],
        [1., 0., 0.],
        [0., 1., 0.],
        [0., 0., 1.],
        [1., 0., 1.],
        [0., 1., 1.],
        [0., 0., 2.],
        [1., 0., 2.],
        [0., 1., 2.],
        [0., 0., 3.],
        [1., 0., 3.],
        [0., 1., 3.],
    ];
    let indices = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [9, 10, 11]];
    let (_, original, store) = synthetic(&p, &indices, 1, true);
    let source = "packed:fixture:part:roadwheel";
    let mut previous = None;
    for boundary in [2, 1, 3] {
        let mut value: Value = serde_json::from_slice(&original).unwrap();
        value["meshes"][0]["ranges"] = json!([
            {"first":0,"count":boundary,"sourceKey":source,"sourceTriangleFirst":0,"surfaceKey":"surface-a","solidKey":null,"bindingKey":null},
            {"first":boundary,"count":4-boundary,"sourceKey":source,"sourceTriangleFirst":boundary,"surfaceKey":"surface-b","solidKey":null,"bindingKey":null}
        ]);
        if boundary != 2 {
            value["surfaces"].as_array_mut().unwrap().reverse();
            value["meshes"][0]["ranges"][0]["surfaceKey"] = json!("surface-b");
            value["meshes"][0]["ranges"][1]["surfaceKey"] = json!("surface-a");
        }
        let bytes = seal(value);
        let mut g = Geometry::register(&bytes, &manifest::sha256(&bytes), &store).unwrap();
        let ctx = context(&g);
        let hits = g.trace([0.2, 0.2, -1.], [0.2, 0.2, 4.], &ctx, 8).unwrap();
        let keys = hits
            .iter()
            .map(|h| h.source_triangle_key.clone())
            .collect::<Vec<_>>();
        assert_eq!(
            keys,
            (0..4)
                .map(|ordinal| format!("{source}:triangle:{ordinal}"))
                .collect::<Vec<_>>()
        );
        assert_eq!(
            keys.iter().collect::<std::collections::HashSet<_>>().len(),
            4
        );
        if let Some(previous) = &previous {
            assert_eq!(
                &keys, previous,
                "classification cannot rename a source triangle"
            );
        }
        previous = Some(keys);
    }
}
#[test]
fn source_triangle_identity_legacy_offset_defaults_to_zero() {
    let (_, text, store) = synthetic(
        &[[0f32, 0., 0.], [1., 0., 0.], [0., 1., 0.]],
        &[[0, 1, 2]],
        1,
        false,
    );
    let mut g = Geometry::register(&text, &manifest::sha256(&text), &store).unwrap();
    let ctx = context(&g);
    let hits = g.trace([0.2, 0.2, -1.], [0.2, 0.2, 1.], &ctx, 4).unwrap();
    assert_eq!(hits[0].source_triangle_key, "fixture-source:triangle:0");
}
#[test]
fn source_triangle_identity_rejects_overflow_and_out_of_inventory_offsets() {
    let (_, text, store) = synthetic(
        &[[0f32, 0., 0.], [1., 0., 0.], [0., 1., 0.]],
        &[[0, 1, 2]],
        1,
        false,
    );
    for first in [u32::MAX, MAX_TRIANGLES as u32] {
        let mut value: Value = serde_json::from_slice(&text).unwrap();
        value["meshes"][0]["ranges"][0]["sourceTriangleFirst"] = json!(first);
        let bytes = seal(value);
        assert!(Geometry::register(&bytes, &manifest::sha256(&bytes), &store).is_err());
    }
    let mut value: Value = serde_json::from_slice(&text).unwrap();
    value["meshes"][0]["ranges"][0]["sourceTriangleFirst"] = json!(MAX_TRIANGLES - 1);
    let bytes = seal(value);
    let mut g = Geometry::register(&bytes, &manifest::sha256(&bytes), &store).unwrap();
    let ctx = context(&g);
    let hits = g.trace([0.2, 0.2, -1.], [0.2, 0.2, 1.], &ctx, 4).unwrap();
    assert_eq!(
        hits[0].source_triangle_key,
        format!("fixture-source:triangle:{}", MAX_TRIANGLES - 1)
    );
}
#[test]
fn mirrored_scaled_affine_refit_is_atomic_and_normals_follow_transformed_edges() {
    let p = [[0f32, 0., 0.], [1., 0., 0.], [0., 1., 0.]];
    let (mut g, _, _) = synthetic(&p, &[[0, 1, 2]], 1, false);
    let ctx = context(&g);
    let m = [
        -2., 0., 0., 0., 0., 3., 0., 0., 0., 0., 0.5, 0., 5., 7., 11., 1.,
    ];
    g.refit(&[("instance-0".into(), m)]).unwrap();
    let h = g.trace([4.5, 7.5, 10.], [4.5, 7.5, 12.], &ctx, 8).unwrap();
    assert_eq!(h.len(), 1);
    assert_eq!(h[0].geometric_normal, [0., 0., -1.]);
    assert_eq!(h[0].t, 0.5);
    assert!(g.refit(&[("instance-0".into(), [0.; 16])]).is_err());
    assert_eq!(
        g.trace([4.5, 7.5, 10.], [4.5, 7.5, 12.], &ctx, 8)
            .unwrap()
            .len(),
        1
    );
    let mut projective = m;
    projective[3] = 1.;
    assert!(ray::Affine::new(projective).is_err());
}
#[test]
fn declared_closed_fixture_inside_exit_and_mirrored_occupancy_use_actual_faces() {
    let p = [
        [-1f32, -1., -1.],
        [1., -1., -1.],
        [1., 1., -1.],
        [-1., 1., -1.],
        [-1., -1., 1.],
        [1., -1., 1.],
        [1., 1., 1.],
        [-1., 1., 1.],
    ];
    let t = [
        [0, 3, 2],
        [0, 2, 1],
        [4, 5, 6],
        [4, 6, 7],
        [0, 4, 7],
        [0, 7, 3],
        [1, 2, 6],
        [1, 6, 5],
        [0, 1, 5],
        [0, 5, 4],
        [3, 7, 6],
        [3, 6, 2],
    ];
    let (_, text, store) = synthetic(&p, &t, 1, false);
    let mut value: Value = serde_json::from_slice(&text).unwrap();
    value["surfaces"][0]["role"] = json!("decoration");
    value["surfaces"][0]["topology"] = json!("closed_solid");
    value["meshes"][0]["ranges"][0]["solidKey"] = json!("cube");
    let text = seal(value);
    let mut g = Geometry::register(&text, &manifest::sha256(&text), &store).unwrap();
    let ctx = context(&g);
    let h = g.trace([-2., 0.2, 0.1], [2., 0.2, 0.1], &ctx, 16).unwrap();
    assert_eq!(h.len(), 2);
    assert_eq!(
        (h[0].crossing, h[0].t, h[1].crossing, h[1].t),
        ("enter", 0.25, "exit", 0.75)
    );
    let h = g.trace([0., 0.2, 0.1], [2., 0.2, 0.1], &ctx, 16).unwrap();
    assert_eq!(h.len(), 1);
    assert_eq!((h[0].crossing, h[0].t), ("exit", 0.5));
    let reflected = [
        -1., 0., 0., 0., 0., 1., 0., 0., 0., 0., 1., 0., 0., 0., 0., 1.,
    ];
    g.refit(&[("instance-0".into(), reflected)]).unwrap();
    let h = g.trace([0., 0.2, 0.1], [2., 0.2, 0.1], &ctx, 16).unwrap();
    assert_eq!(h.len(), 1);
    assert_eq!(h[0].crossing, "exit");
    assert_eq!(h[0].geometric_normal, [-1., 0., 0.]);
}
#[test]
fn deterministic_sah_zero_centroid_extent_bounded_leaves_and_corrupt_tree_rejection() {
    let items = vec![Bounds::point([0., 0., 0.]); 257];
    let b = Bvh::build(&items).unwrap();
    assert!(b
        .nodes
        .iter()
        .filter(|n| n.left.is_none())
        .all(|n| n.count <= 8));
    assert_eq!(
        serde_json::to_string(&b).unwrap(),
        serde_json::to_string(&Bvh::build(&items).unwrap()).unwrap()
    );
    let mut bad = b.clone();
    bad.nodes[0].left = Some(0);
    assert!(bad.validate(&items).is_err());
    let mut bad = b.clone();
    bad.order[0] = bad.order[1];
    assert!(bad.validate(&items).is_err());
    let mut bad = b.clone();
    bad.nodes[0].bounds.lo = [1.; 3];
    assert!(bad.validate(&items).is_err());
    let mut bad = b.clone();
    let leaf = bad.nodes.iter_mut().find(|n| n.left.is_none()).unwrap();
    leaf.count = 9;
    assert!(bad.validate(&items).is_err());
}
#[test]
fn independent_moller_bvh_oracle_preserves_triangle_ids() {
    let mut p = Vec::new();
    let mut ts = Vec::new();
    for i in 0..64 {
        let k = p.len() as u32;
        let z = i as f32 * 0.03125;
        p.extend([[0., 0., z], [1., 0., z], [0., 1., z]]);
        ts.push([k, k + 1, k + 2]);
    }
    let (mut g, _, _) = synthetic(&p, &ts, 1, false);
    let ctx = context(&g);
    for (a, b) in [
        ([0.23, 0.37, -1.], [0.23, 0.37, 3.]),
        ([0.1, 0.2, 0.2], [0.13, 0.24, 1.2]),
        ([0.23, 0.37, 3.], [0.23, 0.37, -1.]),
        ([-0.1, 0.2, -1.], [-0.1, 0.2, 3.]),
    ] {
        let d = ray::sub(b, a);
        let mut expected = Vec::new();
        for (i, t) in ts.iter().enumerate() {
            let v = t.map(|j| p[j as usize].map(f64::from));
            let e1 = ray::sub(v[1], v[0]);
            let e2 = ray::sub(v[2], v[0]);
            let q = ray::cross(d, e2);
            let det = ray::dot(e1, q);
            if det == 0. {
                continue;
            }
            let s = ray::sub(a, v[0]);
            let u = ray::dot(s, q) / det;
            let q2 = ray::cross(s, e1);
            let w = ray::dot(d, q2) / det;
            let t = ray::dot(e2, q2) / det;
            if u >= 0. && w >= 0. && u + w <= 1. && (0.0..=1.0).contains(&t) {
                expected.push((i as u32, t));
            }
        }
        expected.sort_by(|a, b| a.1.total_cmp(&b.1));
        let hits = g.trace(a, b, &ctx, 128).unwrap();
        assert_eq!(hits.len(), expected.len());
        for (h, (id, t)) in hits.iter().zip(expected) {
            assert_eq!(h.triangle_id, id);
            assert!((h.t - t).abs() < 1e-13);
        }
    }
}
#[test]
fn hashes_malformed_payload_manifest_limits_cache_and_explicit_overflow() {
    let p = [[-0f32, 0., 0.], [1., 0., 0.], [0., 1., 0.]];
    let bytes = payload(&p, &[[0, 1, 2]]);
    let hash = manifest::sha256(&bytes);
    let mut store = MeshStore::default();
    let a = store.install(&bytes, &hash).unwrap();
    let b = store.install(&bytes, &hash).unwrap();
    assert!(Arc::ptr_eq(&a, &b));
    assert_eq!(a.data.positions[0][0].to_bits(), (-0f32).to_bits());
    assert!(store.install(&bytes, &"0".repeat(64)).is_err());
    for offset in [0, 8, 12, 16, 20, 24, 28, 32, bytes.len() - 4] {
        let mut corrupt = bytes.clone();
        corrupt[offset..offset + 4].copy_from_slice(&u32::MAX.to_le_bytes());
        assert!(
            MeshData::load(&corrupt, &manifest::sha256(&corrupt)).is_err(),
            "offset {offset}"
        );
    }
    let (mut g, text, store) = synthetic(&p, &[[0, 1, 2]], 2, false);
    let ctx = context(&g);
    assert!(g.trace([0.2, 0.2, -1.], [0.2, 0.2, 1.], &ctx, 1).is_err());
    assert_eq!(
        g.trace([0.2, 0.2, -1.], [0.2, 0.2, 1.], &ctx, 4)
            .unwrap()
            .len(),
        2
    );
    assert!(g.trace([f64::NAN, 0., 0.], [0.; 3], &ctx, 4).is_err());
    assert!(Geometry::register(&text, &"0".repeat(64), &store).is_err());
    let mut value: Value = serde_json::from_slice(&text).unwrap();
    value["assemblies"][0]["parent"] = json!("root");
    let invalid = seal(value);
    assert!(Geometry::register(&invalid, &manifest::sha256(&invalid), &store).is_err());
}
#[test]
fn long_assembly_chains_validate_linearly_and_deep_cycles_reject_without_recursion() {
    let (_, text, store) = synthetic(
        &[[0f32, 0., 0.], [1., 0., 0.], [0., 1., 0.]],
        &[[0, 1, 2]],
        1,
        false,
    );
    let mut value: Value = serde_json::from_slice(&text).unwrap();
    let prototype = value["assemblies"][0].clone();
    let mut assemblies = Vec::new();
    for i in 0..2048 {
        let mut a = prototype.clone();
        a["key"] = json!(if i == 0 {
            "root".to_string()
        } else {
            format!("joint-{i}")
        });
        a["parent"] = if i == 2047 {
            Value::Null
        } else {
            json!(format!("joint-{}", i + 1))
        };
        assemblies.push(a);
    }
    value["assemblies"] = json!(assemblies);
    let bytes = seal(value.clone());
    assert!(Geometry::register(&bytes, &manifest::sha256(&bytes), &store).is_ok());
    value["assemblies"][2047]["parent"] = json!("joint-1024");
    let bytes = seal(value);
    assert!(
        Geometry::register(&bytes, &manifest::sha256(&bytes), &store)
            .err()
            .unwrap()
            .contains("cycle")
    );
}

#[test]
fn nullable_keys_obey_schema_empty_and_1025_boundary() {
    let (_, text, store) = synthetic(
        &[[0f32, 0., 0.], [1., 0., 0.], [0., 1., 0.]],
        &[[0, 1, 2]],
        1,
        false,
    );
    for field in ["responseRef", "solidKey"] {
        for bad in [String::new(), "x".repeat(1025)] {
            let mut value: Value = serde_json::from_slice(&text).unwrap();
            if field == "responseRef" {
                value["surfaces"][0][field] = json!(bad);
            } else {
                value["meshes"][0]["ranges"][0][field] = json!(bad);
            }
            let bytes = seal(value);
            assert!(
                Geometry::register(&bytes, &manifest::sha256(&bytes), &store).is_err(),
                "invalid {field} accepted"
            );
        }
    }
}
#[test]
fn finite_subnormal_segment_crosses_actual_triangle_instead_of_silent_miss() {
    let (mut g, _, _) = synthetic(
        &[[0f32, 0., 0.], [1., 0., 0.], [0., 1., 0.]],
        &[[0, 1, 2]],
        1,
        false,
    );
    let ctx = context(&g);
    let hit = g
        .trace([0.25, 0.25, 1e-310], [0.25, 0.25, -1e-310], &ctx, 8)
        .unwrap();
    assert_eq!(hit.len(), 1);
    assert_eq!(hit[0].t, 0.5);
    let tiny = f32::from_bits(1);
    let (mut g, _, _) = synthetic(
        &[[0f32, 0., 0.], [tiny, 0., 0.], [0., tiny, 0.]],
        &[[0, 1, 2]],
        1,
        false,
    );
    let ctx = context(&g);
    let q = tiny as f64 * 0.25;
    let hit = g.trace([q, q, 1e-310], [q, q, -1e-310], &ctx, 8).unwrap();
    assert_eq!(hit.len(), 1);
    assert_eq!(hit[0].t, 0.5);
}
#[test]
fn query_fraction_zero_is_canonical_while_emitted_negative_zero_bits_survive() {
    let p = [
        [0f32, 0., 0.],
        [1., 0., 0.],
        [0., 1., 0.],
        [0., 0., -0.],
        [1., 0., -0.],
        [0., 1., -0.],
    ];
    let (mut g, _, _) = synthetic(&p, &[[0, 1, 2], [3, 4, 5]], 1, false);
    let ctx = context(&g);
    let hit = g
        .trace([0.25, 0.25, 0.], [0.25, 0.25, 1.], &ctx, 8)
        .unwrap();
    assert_eq!(
        hit.iter().map(|h| h.triangle_id).collect::<Vec<_>>(),
        vec![0, 1]
    );
    assert!(hit.iter().all(|h| h.t.to_bits() == 0));
    assert_eq!(
        g.instances[0].mesh.data.positions[3][2].to_bits(),
        (-0f32).to_bits()
    );
}
#[test]
fn explicit_crossing_capacity_growth_reserves_even_on_an_empty_query() {
    let (mut g, _, _) = synthetic(
        &[[0f32, 0., 0.], [1., 0., 0.], [0., 1., 0.]],
        &[[0, 1, 2]],
        1,
        false,
    );
    let ctx = context(&g);
    g.trace([2., 2., -1.], [2., 2., 1.], &ctx, 8).unwrap();
    let first = g.events.capacity();
    let requested = first * 2;
    g.trace([2., 2., -1.], [2., 2., 1.], &ctx, requested)
        .unwrap();
    assert!(
        g.events.capacity() >= requested,
        "reserve must use additional relative to len, not capacity"
    );
}

#[test]
fn static_cold_warm_costs_and_shared_actor_disposal_receipt() {
    use std::time::Instant;
    let ids = ["de_hetzer", "us_m901_itv", "su_att_m46", "xp_bmp_k64"];
    let queries = [
        ("side", [-10., 1., 0.], [10., 1., 0.]),
        ("longitudinal", [0., 1., -10.], [0., 1., 10.]),
        ("oblique", [-8., 2., -8.], [8., 0.5, 8.]),
        ("outside", [10., 10., 10.], [11., 11., 11.]),
    ];
    let index = index();
    let mut cases = Vec::new();
    for id in ids {
        let entry = index["entries"]
            .as_array()
            .unwrap()
            .iter()
            .find(|e| e["specId"] == id)
            .unwrap();
        let file = entry["manifestFile"].as_str().unwrap();
        let bytes = fs::read(root().join("data/hit-meshes").join(file)).unwrap();
        let m: HitMeshManifestV1 = serde_json::from_slice(&bytes).unwrap();
        let mut hashes = std::collections::BTreeSet::new();
        let payloads: Vec<_> = m
            .meshes
            .iter()
            .filter(|p| hashes.insert(p.payload_hash.clone()))
            .map(|p| {
                (
                    p.payload_hash.clone(),
                    fs::read(
                        root()
                            .join("data/hit-meshes")
                            .join(format!("{}.bin", p.payload_hash)),
                    )
                    .unwrap(),
                )
            })
            .collect();
        let mut store = MeshStore::default();
        let start = Instant::now();
        for (hash, bytes) in &payloads {
            store.install(bytes, hash).unwrap();
        }
        let install_ms = start.elapsed().as_secs_f64() * 1000.;
        let start = Instant::now();
        let mut g =
            Geometry::register(&bytes, entry["manifestHash"].as_str().unwrap(), &store).unwrap();
        let register_ms = start.elapsed().as_secs_f64() * 1000.;
        let store_memory = store.memory_stats();
        let ctx = QueryContext {
            entity_id: format!("cost:{id}:0"),
            spawn_epoch: 1,
            build_hash: m.build_hash.clone(),
            pose_revision: 1,
            geometry_revision: 0,
            shape_hash: None,
        };
        let mut query_evidence = Vec::new();
        for (key, a, b) in queries {
            let start = Instant::now();
            let count = g.trace(a, b, &ctx, 4096).unwrap().len();
            let cold_query_ms = start.elapsed().as_secs_f64() * 1000.;
            query_evidence.push(json!({"key":key,"coldQueryMs":cold_query_ms,"crossings":count,"stats":g.query_stats(),"memory":g.memory_stats()}));
        }
        let scene_memory = g.memory_stats();
        let mut samples = Vec::new();
        let mut warm_work = std::collections::BTreeMap::from([
            ("samples", 0u64),
            ("tlasNodeVisits", 0),
            ("blasNodeVisits", 0),
            ("tlasBoundsTests", 0),
            ("blasBoundsTests", 0),
            ("triangleTests", 0),
            ("rawCrossings", 0),
            ("crossings", 0),
            ("occupancyTriangleTests", 0),
            ("occupancyPointTests", 0),
            ("occupancyRayAttempts", 0),
            ("occupancyPredicateProducts", 0),
        ]);
        for _ in 0..25 {
            for (_, a, b) in queries {
                let start = Instant::now();
                std::hint::black_box(g.trace(a, b, &ctx, 4096).unwrap().len());
                samples.push(start.elapsed().as_secs_f64() * 1000.);
                let stats = serde_json::to_value(g.query_stats()).unwrap();
                *warm_work.get_mut("samples").unwrap() += 1;
                for key in [
                    "tlasNodeVisits",
                    "blasNodeVisits",
                    "tlasBoundsTests",
                    "blasBoundsTests",
                    "triangleTests",
                    "rawCrossings",
                    "crossings",
                    "occupancyTriangleTests",
                    "occupancyPointTests",
                    "occupancyRayAttempts",
                    "occupancyPredicateProducts",
                ] {
                    *warm_work.get_mut(key).unwrap() += stats[key].as_u64().unwrap();
                }
            }
        }
        samples.sort_by(f64::total_cmp);
        let warm = json!({"samples":samples.len(),"minMs":samples[0],"p50Ms":samples[samples.len()/2],"p95Ms":samples[samples.len()*95/100],"maxMs":samples[samples.len()-1],"meanMs":samples.iter().sum::<f64>()/samples.len()as f64});
        let mut scenes = vec![g];
        let mut actors = Vec::new();
        for actor in 1..8 {
            let start = Instant::now();
            let mut scene =
                Geometry::register(&bytes, entry["manifestHash"].as_str().unwrap(), &store)
                    .unwrap();
            let register_ms = start.elapsed().as_secs_f64() * 1000.;
            let ctx = QueryContext {
                entity_id: format!("cost:{id}:{actor}"),
                ..ctx.clone()
            };
            let start = Instant::now();
            let h = scene.trace(queries[0].1, queries[0].2, &ctx, 4096).unwrap();
            assert!(h.iter().all(|h| h.entity_id == ctx.entity_id));
            let trace_ms = start.elapsed().as_secs_f64() * 1000.;
            actors.push(json!({"actor":actor,"registerMs":register_ms,"traceMs":trace_ms,"stats":scene.query_stats(),"storeMemory":store.memory_stats()}));
            scenes.push(scene);
        }
        let possible_triangles: u64 = m
            .mesh_instances
            .iter()
            .map(|i| {
                m.meshes
                    .iter()
                    .find(|m| m.key == i.mesh_key)
                    .unwrap()
                    .triangle_count as u64
            })
            .sum();
        drop(scenes);
        store.collect_unused();
        let dispose = store.memory_stats();
        assert_eq!(
            (
                dispose.immutable_meshes,
                dispose.payload_bytes,
                dispose.blas_array_bytes,
                dispose.vertex_index_array_bytes
            ),
            (0, 0, 0, 0)
        );
        cases.push(json!({"specId":id,"manifestHash":entry["manifestHash"],"manifestBytes":bytes.len(),"serializedPayloadBytes":payloads.iter().map(|(_,b)|b.len()).sum::<usize>(),"declaredMeshes":m.meshes.len(),"physicalInstances":m.mesh_instances.len(),"possibleTriangles":possible_triangles,"coldInstallMs":install_ms,"coldRegisterMs":register_ms,"storeMemory":store_memory,"sceneMemory":scene_memory,"queryEvidence":query_evidence,"warm":warm,"warmWork":warm_work,"sameManifestActors":actors,"dispose":{"immutableMeshes":dispose.immutable_meshes,"payloadBytes":dispose.payload_bytes,"blasArrayBytes":dispose.blas_array_bytes,"vertexIndexArrayBytes":dispose.vertex_index_array_bytes,"sceneArrayBytes":0,"sceneHandles":0,"meshHandles":0}}));
    }
    macro_rules! pin {
        ($p:literal) => {
            (
                $p,
                manifest::sha256(include_bytes!(concat!("../../../../", $p))),
            )
        };
    }
    let pins: std::collections::BTreeMap<_, _> = [
        pin!("Cargo.toml"),
        pin!("Cargo.lock"),
        pin!("crates/combat/Cargo.toml"),
        pin!("crates/combat/src/lib.rs"),
        pin!("crates/combat/src/geometry/mod.rs"),
        pin!("crates/combat/src/geometry/manifest.rs"),
        pin!("crates/combat/src/geometry/bvh.rs"),
        pin!("crates/combat/src/geometry/ray.rs"),
        pin!("crates/combat/src/geometry/surface.rs"),
        pin!("crates/combat/src/geometry/tests.rs"),
        pin!("crates/combat/src/geometry/combat_scene.rs"),
        pin!("crates/design-wasm/src/lib.rs"),
        pin!("crates/design-wasm/src/geometry_diagnostic.rs"),
        pin!("crates/design-wasm/src/surface_runtime.rs"),
        pin!("client/web/src/design/core.js"),
        pin!("client/web/src/gfx/imported.js"),
        pin!("client/web/tools/export-hit-mesh.mjs"),
        pin!("client/web/tools/hit-mesh-capture.mjs"),
        pin!("client/web/tools/fleet-authored-bindings.mjs"),
        pin!("client/web/tools/fleet-additional-authored-bindings.mjs"),
        pin!("client/web/src/collision/physicalNodeKey.js"),
        pin!("client/web/src/game/barrelShapeComposition.js"),
        pin!("schemas/hit-mesh.schema.json"),
        pin!("client/web/tools/hit-binding-catalog.mjs"),
        pin!("schemas/hit-binding-catalog.schema.json"),
        pin!("client/web/test/hit-binding-catalog.test.mjs"),
        pin!("client/web/test/exact-hit-mesh.test.mjs"),
        pin!("client/web/test/fixtures/exact-hit-x1-oracle-witness.json"),
        pin!("client/web/test/exact-hit-source-receipt.test.mjs"),
        pin!("client/web/tools/measure-hit-mesh.mjs"),
        pin!("client/web/test/exact-hit-static-cost.test.mjs"),
        pin!("client/web/src/gfx/tankmodel.js"),
        pin!("client/web/src/gfx/geo.js"),
        pin!("client/web/src/gfx/interior.js"),
        pin!("client/web/src/gfx/mgmodel.js"),
        pin!("client/web/src/gfx/track.js"),
        pin!("client/web/src/sim/tank/trackChain.js"),
        pin!("client/web/src/gfx/gearSupports.js"),
        pin!("client/web/src/game/loadout.js"),
        pin!("client/web/src/game/workshopImported.js"),
        pin!("client/web/src/gfx/math.js"),
        pin!("client/web/src/game/combat.js"),
        pin!("client/web/src/game/localSurfaceCombat.js"),
        pin!("client/web/tools/load-surface-catalog.mjs"),
        pin!("client/web/src/game/workshopBuild.js"),
        pin!("client/web/tools/load-data.mjs"),
        pin!("client/web/src/gfx/renderer.js"),
        pin!("client/web/src/game/turretSeat.js"),
        pin!("client/web/src/game/rangefinderEquipment.js"),
        pin!("client/web/src/gfx/t72aModel.js"),
        pin!("client/web/src/collision/meshHitbox.js"),
    ]
    // Match the exporter source table, including the T72 opt-in geometry component.
    .into_iter()
    .collect();
    let receipt = json!({"schema":"ExactHitStaticCostV1","backend":"actual_native","profile":if cfg!(debug_assertions){"debug"}else{"release"},"kernelPins":pins,"timingScope":"MeshStore::install, Geometry::register and Geometry::trace; disk reads and JSON receipt serialization excluded","memoryScope":"actual Vec capacities and element sizes for geometry arrays; excludes allocator/maps/strings/JSON scratch; live arrays and all immutable leases return to zero","queries":queries.iter().map(|(key,a,b)|json!({"key":key,"a":a,"b":b})).collect::<Vec<_>>(),"cases":cases});
    let mut receipt = receipt;
    receipt["visitDefinition"]=json!("node visits are actual traversal stack pops including rejected nodes; boundsTests also counts child ordering tests; structural node counts are separate");
    let destination = std::env::var_os("TG_HIT_NATIVE_COST_RECEIPT")
        .map(PathBuf::from)
        .unwrap_or_else(|| root().join("target/exact-hit-static-native-cost.json"));
    fs::write(destination, serde_json::to_vec_pretty(&receipt).unwrap()).unwrap();
}
