# P1 shared kinetic kernel handoff

Readonly preparation by `impact_p1_preparation`; Root persisted its findings after L dual approval. No implementation is implied. P1 needs bounded kernel plus active adapters for all five owners, not a dormant helper. P2–P5/B/X/W remain required.

## Current owner changes

| Owner | Required active adaptation |
|---|---|
| penetration/lib.rs::resolve | Add resolve_with_state; old resolve compatibility wrapper; shared residual transition, authored verdict inputs retained. |
| penetration/stack.rs::resolve_stack | Add resolve_stack_with_state carrying output each layer; remove final total-used/initial-pen speed reconstruction. |
| combat/lib.rs::shoot | Initialize after penetration roll; replace mutable pen/speed/core/energy ownership. Plate transition, spall from allocation, module/crew local deposition with carried state. impact_report.rs handles conversion. |
| design/trace.rs::Scene::crossings/shoot | Declared layer identity/state; remove speed_fraction→energy reconstruction; never resplit all residual energy in generate_fragments or teleport auxiliary-plate spall into cabin. |
| sim-slice/lib.rs::run_shot | Initialize from actual BallisticState.vel and actively carry through subsequent contacts; current owner stops at first plate. |
| damage/lib.rs | Allocation-consuming generator, old generator explicit legacy wrapper. Extend physical provenance/trace constructors. Active new propagation must consume local deposition/carry residual, not damage-only repeated-energy claims. |
| replay/lib.rs | Defaulted provenance/mechanism fields, real old/new JSON serialization tests (old roundtrip did not serialize). |
| game/projectileReplay.js::designReplayReport | Preserve events/revision/timing/budgets/source IDs/physical values; missing provenance unknown_legacy, not spall. |

## Proposed pure API shape

```rust
enum FragmentSource { Core, ProjectilePiece, ArmourSpall, CasingFragment, JetFragment, UnknownLegacy }
struct EnergyBudget {
    input_j: f64, core_out_j: f64, projectile_pieces_j: f64,
    armour_debris_j: f64, target_deposition_j: f64,
    deformation_fracture_j: f64, unresolved_loss_j: f64,
}
struct ComponentReservoirs { core_kg: f64, casing_kg: f64, cap_kg: f64, liner_kg: f64, filler_kg: f64 }
struct ImpactState {
    body_id: String, mass_kg: f64, velocity_m_s: Vec3,
    remaining_pen_mm: f64, remaining_length_m: f64, effective_diameter_m: f64,
    integrity: f64, deformation: f64, cap_state: CapState, elapsed_s: f64,
    fuse: FuseState, components: ComponentReservoirs, charge: Option<ChargeOwnership>,
    traversal: Option<LayerTraversalCursor>, profile: ProfileReference,
}
struct LayerTraversalCursor {
    layer_id: String, traversal_id: u32, entry: ImpactSnapshot,
    cumulative_required_mm: f64, cumulative_work_j: f64, cumulative_pen_used_mm: f64,
}
struct PhysicalFragment { mass_kg: f64, energy_j: f64, area_m2: Option<f64>, velocity_m_s: Vec3 }
struct FragmentProvenance {
    fragment_id: String, parent_event_id: String, source: FragmentSource,
    source_layer_or_module: Option<String>, physical: Option<PhysicalFragment>,
    weight: f64, start_s: Option<f64>, profile: Option<ProfileReference>,
}
fn initialize_impact(shell: &ProjectileDef, velocity: Vec3, available_pen_mm: f64,
    identity: ImpactIdentity, profile: &ImpactProfile) -> Result<ImpactState, ImpactError>;
fn advance_kinetic_layer(state: &mut ImpactState, contact: &DeclaredLayerContact,
    allocation: &AllocationProfile) -> Result<ImpactTransition, ImpactError>;
fn deposit_contact_energy(state: &mut ImpactState, outgoing_energy_j: f64,
    target: ContactIdentity) -> Result<ImpactTransition, ImpactError>;
```

These are proposed names, not existing code. ImpactSnapshot copies body/components/fuse/profile but excludes traversal (no recursive state). ImpactTransition contains entry/output snapshots, verdict, ledger and finite source allocations, consumed by report adapters.

Reservoirs are disjoint remaining inventory owned by current body, not full shell mass copied into each component. Unknown component partition remains unknown/unallocated. core_out means surviving forward carrier energy, not exclusively core_kg. APCR .35/APDS .6 are versioned old compatibility admitted-mass estimates, not measured universal fractions. One charge owner transfers filler/fuse atomically; P1 unresolved_legacy old distance fuse is pending P3, not completed explosion physics.

For one declared traversal, keep E_entry/pen_entry fixed. Cumulative W=E_entry*clamp(required_cumulative/pen_entry,0,1)^2; consume only new minus previous W and penetration. Duplicate boundary update is zero work. Real exit/re-entry gets a new traversal; distinct physical plates differ even at zero gap. A100mm layer retains5/9 KE, two50mm retain2/3; splitting the same100mm into updates25/50/100 retains5/9. No triangle/primitive/substep duplicates. Trusted old combat plate.id or design source/layer supplies identity; final X gives union bindings. Local event IDs can be plate:id/traversal:0; seed alone is not a globally unique shot ID, P5 supplies world namespace.

Apply old family shares .12/.15/.30 as named estimated allocation of plate WORK, not newly created post-core energy. Finite local target mass uses existing density/thickness plus labelled estimated damaged footprint. No BHN→toughness claim. Residual piece allocations debit carrier. Physical per-fragment properties are separate from sample weight. P1 weight1 and unknown nonkinetic/legacy physicalNone retain a contract; P2 distributions, weighted grouping, convergence and richer penetration stay pending.

Module/crew: preserve named absorption constants, send E_in−E_out local deposition to damage response, then carry E_out. Freeze absorption inputs from pre-hit health to remove damage→destroyed→resistance feedback. Remove zero-energy crew damage floor and speed_ms.max(1) manufacturing energy. Investigate balance test failures rather than silently reintroducing energy duplication or broadly weakening tests.

## Dependency graph

Promote tg-shared to normal tg-penetration dependency. Add tg-penetration to tg-combat, tg-damage and tg-replay; penetration never imports consumers. Replay uses serde_json dev dependency for real compatibility tests. Design and sim-slice already depend on penetration/damage/replay. Cross-owner test crate may use combat/design dev dependencies where acyclic.

## Actual existing-WASM RED

Source inspected HEAD2410313; committed WASM SHA256 `6f542f80e38ea9c65f059eb1f3a489658dbabe26e51cae883021414e4e542ce3`. No source freshness/build claim. Synthetic input E0=.5*.1kg*100²=500J, actual reported pen150, required[50,50]: combat carried KE/E0=.6666662597426339, design/stack sum(fragment.energy_j)/E0=.5555555305480957; mismatch55.55536459726909J, intentional assertion exited1.

```js
const shell = {
  id:'p1_synthetic', name:'P1 synthetic', kind:'ap', caliber_mm:10,
  mass_kg:.1, muzzle_velocity_ms:100, explosive_mass_kg:0, explosive_type:'none',
  penetrator_material:'steel', length_mm:100, drag_coefficient:0,
  penetration_curve:[{distance_m:0,pen_mm:150}], ricochet_angle_deg:89,
  normalization_deg:0, shatter_angle_deg:90, fuse_delay_s:0, fuse_sensitivity_mm:0,
};
const plate=(id,z)=>({id,zone:'hull_side',material:'rha',thickness_mm:50,
  center:[0,1,z],normal:[0,0,-1],axis_u:[1,0,0],half_u:1,half_v:1,curvature:0});
// Combat: plates at z0/.2, no crew, downstream tiny radio witness at [0,1,.5],
// half_extents1e-6, health=max_health1000; origin[0,1,-2],dir+Z,speed100,dist0,seed1.
// Observe report.pen_mm=P then raw curve=150*150/P with same seed -> reported150.
// Cal10 suppresses old combat spall. Direct kind shell/hit witness damage unsaturated:
// Ecarry=1000*(damage/7)^(1/.6).
// Design: cloned catalog penetration.sigma_fraction0; closedbox[-1,0,-1]..[1,2,2],
// rearface1, main50+outer50 spacing_mm100; no modules/crew/weapons,
// same unadjusted shell/shot. Sum event.fragments.energy_j reveals old stack KE.
```

Green uses explicit transition/core pre-contact state rather than pretending the old inverse-damage equation remains valid after local deposition changes. Both actual owners and all5 raw-contact adapters need evidence.

Tests: actual2-layer parity; active work-spall budget; serial module→crew/crew→crew deposition; zero energy; same-layer split/duplicate; genuine two layers; real re-entry; atomic mass/charge transfer; nonfinite input rejection; real old/new serde/source preservation; all5 active contact adapters; stable input/IDs/seed. Native packages penetration/damage/combat/replay/design/sim-slice; JS projectile/design replay plus actual newly rebuilt WASM parity. Original source bytes and B untouched.

Risks: LOS cosine floors .01/.05/.02 and fresh-impact gates currently differ; canonical contact inputs needed before claiming grazing parity. Design post-stack fragments and sim-slice firstplate-only need actual adaptation. Spall cannot teleport from addon layer into cabin. Old nonkinetic chemical/fuse helpers remain explicitly pending P3, no fake P1 chemical ledger. Avoid known oldall35 B heavyRED and baseline overwrite.
