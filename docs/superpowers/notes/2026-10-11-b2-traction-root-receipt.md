# B2 reciprocal traction helper — independent Root receipt

Root verification on 2026-10-11 in
`C:/Users/24908/.codex/scratch/tankforge-suspension-tracks-v7`.
This is a frozen helper checkpoint, not B2 completion or production approval.

The original external 600-case prescribed KKT probe previously found 247
sticking failures (183 sweep-limit, 63 line and one velocity mismatch), while
all 300 sliding cases passed. Its known feasible equilibrium residual was
at most 1.3877787807814457e-15 and complementarity was zero. The fix adds
joint sticking using original row/force variables, an original hard-normal
and permitted-tangent rank certificate and relative response scaling; it
retains original normal constraints, friction law and solver gates.

Root inspected the frozen files, checked their hashes, and independently ran:

| Verification | Result |
| --- | --- |
| JS normal bundle + reciprocal traction tests | 17 PASS, 0 FAIL |
| Native `fixed_track_traction_` | 11 PASS, 0 FAIL |
| Native `fixed_track_bundle_` | 6 PASS, 0 FAIL |
| Unchanged external prescribed KKT probe | 600 PASS; maximum velocity error 3.5019338540109857e-9 |
| Separate derived physical-scale x10000 probe | 600 PASS; maximum velocity error 8.417155861195624e-13 |
| Unchanged scalar normal probe | 4000 PASS; indefinite mass rejected |
| Unchanged multi-shape normal probe | 1500 PASS; maximum error 9.343220641611083e-14 |

Every command exited zero. JS17 and serial native11+6 were also freshly
rerun after context recovery with identical frozen hashes. Native runs used
the established scratch cargo/rustup homes without `CARGO_TARGET_DIR`.

Frozen SHA256 values:

| File | SHA256 |
| --- | --- |
| `client/web/src/sim/tank/trackTractionBundle.js` | `37a22bb5669b50a08b8e9c19e2e95009b5f469d84e9a7175f43eb97164fa5230` |
| `client/web/test/track-traction-bundle.test.mjs` | `33859416181776dd0bde026045ccad471207f886e730173845f38c8fe3858006` |
| `crates/physics/src/tank/track_traction_bundle.rs` | `d9b6dbdc429d2ab77bbb4dccae64846a1cd35f56a0a44af5f21ed9b2bac6f276` |
| `crates/physics/src/tank/tests.rs` | `60952cd80d9043eab720a0f9b2b7c4eb4edfd416c6c7c174619df867c68629e5` |
| `client/web/src/sim/tank/trackBundle.js` | `87000f09b930a813d1ce1591bcd085598bb6709ca78b698ae53de1adfe143f82` |
| `crates/physics/src/tank/track_bundle.rs` | `5f202c3e3eacf3e6eea384139a59a183c9c7640409ec69af18b16bc3ed62b928` |

External probes and their receipts are in `C:/Users/24908/.codex/scratch/`:
`tankforge-root-traction-multi-ground-probe`,
`tankforge-root-traction-multi-ground-scaled10000-probe`,
`tankforge-root-bundle-probe` and `tankforge-root-bundle-multishape-probe`.
The old stick-diagnosis script expects the former RED JSON and must not be
rerun against the now GREEN receipt without restoring its original input.

Fresh SPEC review by `b2_traction_spec` reports PASS after independent code
inspection and fresh JS17/default600/scaled600/normal4000+1500 checks, with
all four traction checkpoint hashes unchanged. Fresh QUALITY review is
APPROVE by fresh `b2_traction_quality`: no Critical/Important issues. It
independently reran JS17 and serial native11+6 and verified all six hashes;
additional in-memory 875 unloaded-ground/repeated cases and nine order,
capacity, input and zero-ground checks passed. Its only Minor observation
is transient JS options/failure closures, tracked for owner hot-loop work.
This approval is only the frozen helper checkpoint. Actual
finite-source normal and traction assembly, nonlinear chart/source rebuilds,
vehicle impulses, final continuous/decoded correspondence, full-fleet loaded
and native-lockstep gates remain required. Production `lowerGraph.enabled`
is still false. Source-scale quadratic scratch cost and memory have not been
certified. No runtime commit, WASM build, browser validation or publication
occurred at this boundary.
