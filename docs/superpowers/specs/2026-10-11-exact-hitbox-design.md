# Exact rendered-model hitbox design

2026-10-11. User requires hitboxes matching vehicle models, including provided GLB models, openings and modeled internals. The detailed inspected contracts, CPU fixtures, hashes and constraints are in `docs/exact-hitbox-research-2026-10-11.md`; they form this specification's implementation contract.

## Accepted approach

Use exact emitted float32 render triangles and instances, with a trusted versioned manifest, stable material/anatomy bindings, shared Rust native/WASM queries and one accepted semantic pose. AABB/OBB remain candidate filters only. No final fallback to hull box, module OBB, crew sphere, barrel cylinder or intact track circle. Preserve original geometry/data bytes; create derivatives and sidecar metadata only.

A client-only nearest-triangle fix would leave server damage abstract and trust client yaw; a separately recreated collision model would drift at holes and quantization. The common manifest/query approach fixes both while reusing mesh BVHs across shoes, wheels and crew. It has a material metadata cost: every surface needs a declared role, and a merged imported hull needs a reviewed, hash-pinned patch partition. Zero unclassified surfaces and zero ambiguous anatomy references are certification gates.

## Geometry, bindings and pose

Implement `HitMeshManifestV1`, `AcceptedHitPoseV1` and `SurfaceCrossingV1` exactly as the research defines. Preserve position bits/triangle order; include packed/emitted hashes and honest missing status for unavailable raw GLBs. Use deterministic flat 16-bin SAH BLAS with at most8 triangles/leaf and refittable per-instance TLAS. Use shared watertight, double-sided segment tests with f64 robust edge fallback, sorted crossings and topology-aware shared-edge dedupe. Do not grow triangles by gameplay epsilon to fill holes.

Roles distinguish compartment boundary shells, open sheets, closed material solids and decoration. Existing authored armor thickness/material is separate from geometry. A closed hull envelope is not a full solid block of steel; open sheets have no invented10mm exit, decor does not inherit nearby main armor, and declared distinct coincident layers remain distinct. Existing real internal/crew triangles replace proxy final contact. Hidden X-ray/LOD/scope nodes remain physically active; spent payload/rack occupancy comes from trusted equipment state. Health0 alone does not delete visible metal.

Accepted pose includes hull frame, all parented turret/gun/MG/APS joints and recoil, folds, wheels, idler and each rigid shoe, B frozen shape/world open-chain state, crew motion phase and payload activity. Update matrices/bounds atomically; render and query parity names the same pose sample. Remote interpolation can be a different presentation time, so authority reports identify their accepted sample. Reject stale spawn/pose/topology revisions and unsupported shader-only deformation. Current fixed-pose per-ballistic-substep sweep is an explicitly limited time approximation, not continuous-time exact moving collision.

## Trust and integration

Stock manifests are build-generated and hash-pinned in the native allowed catalog; server startup checks manifest and anatomy data hashes. Client mesh uploads/roles/matrices cannot grant authority. Workshop local builds are compiled through trusted catalog selections and the existing builder; online custom publication stays unavailable until its own server normalization/receipt path exists, preserving the current stock-only room boundary.

Rust tg-combat owns graphics-free geometry and bindings; design-wasm exposes it. Native/server and browser use the same records. Replace every final hit/fragment/blast-line query in active combat, browser vehicle/self/missile/bullet candidate owners and relevant analysis tools. The caller's finite segment/contact cursor is preserved; no two-meter backshift followed by infinite full-vehicle line. P1 impact state consumes exact crossings without repeating an old armor-plane raycast.

Server derives accepted poses from validated defender motion/input/fire/reload state; recoil/readiness cannot come from client matrices. P5 fire records supply trusted shot speed/direction/distance. B accepted dynamic shape/topology and per-wheel deformation are required for final running-gear certification. Imported wheel-ground physics proxies remain distinct from exact imported wheel hit geometry.

## Completion

First deliver manifest extraction and actual BVH queries on bounded fixtures, then complete bindings, full pose, damage integration and server/B certification. An audit-pending manifest can support diagnostic geometry queries but cannot be announced as final damage geometry. Finish the research regression matrix, original-byte preservation, actual native/WASM same-pose parity, bounded cost/memory, final build and independent SPEC/QUALITY reviews. The previous browser approval rejection remains effective; CPU geometry receipts do not certify rendered appearance.
