# Independent default-stack constructor experiment

2026-10-11, production-source observation at `bc6a86c`. This is an external
experiment, not acceptance of the unfinished B2 contact solver or a release.
The existing sole runtime writer retains production ownership.

## Reproduced cause and narrow candidate

Root copied the current `tg-physics` source into
`C:/Users/24908/.codex/scratch/tankforge-root-stack-constructor-lab`. The small
workspace uses the original locked dependencies and original vehicle data;
only the fixture's data path is redirected. No production source, vehicle
definition, model asset, stack size or Cargo target override was changed.

The unchanged copied constructor has SHA-256
`570fb3261406aca7ee74584291f2ee368137b7f70b4fb9a0074d7a4e2c0a9f70`, identical
to the worktree source. The exact test
`tank::tests::fixed_track_source_spin_is_reciprocal_and_frozen_total_travel_is_validated`
reproduced `STATUS_STACK_OVERFLOW` at the default stack with one test thread.
The initial short name combined with `--exact` selected zero tests; that run
is explicitly excluded from evidence.

Root then replaced only `array::from_fn` in the copied `Tank::new` with an
explicit two-element array containing the same two `TrackState::new` calls
and descriptor `Arc::clone`s. The same exact test passed **1/1**, at the
default stack, in 0.04 s. The copied constructor's new SHA-256 is
`3e11184a48b8c8079175a742d3f4dd53ca4b96be391e9e2fa942608b9c4a590b`.

## Preserved behavior

An additional external test passed **1/1** over M56, T-34-85 and T-10M.
It compares complete initialized `TrackState` debug values with independently
performed original initialization operations on each side. It also checks
that descriptor Arcs remain shared, cloned pin buffers do not alias, and
changing left-side travel does not mutate the right side. This verifies the
constructor candidate without changing the contact equations.

The x64 debug unwind probe reports a potential source-spin call-path allocation
of 1,578,720 bytes, versus the earlier 2,178,048 bytes. `Tank::new` itself now
has a larger local frame; removal of the nested generic array wrappers reduces
the whole candidate path. The call scanner is not instruction decoding and
does not prove executed peak stack usage; the reproduced default-stack test
is the behavioral evidence. No release/WASM stack claim follows.

Probe and hashed binary receipt:
`C:/Users/24908/.codex/scratch/tankforge-root-constructor-lab-unwind.mjs/.json`.
The native lane was released to the sole writer after the experiment. The
production change, fresh specification and quality reviews, and production
default-stack test remain separate checkpoints.

## Production-source checkpoint, independently reviewed

The sole writer applied the same constructor expression in the current B2
worktree and added a test-only `constructor_tests` module. The scoped change
contains no other runtime edits. Root freshly ran the real worktree's new
constructor test **1/1 PASS** (0.19 s) and unchanged exact source-spin test
**1/1 PASS** (0.04 s), at the default stack and target.

Fresh `constructor_spec_review` returned **PASS** after inspecting the exact
before/after change, regression and frozen hashes. Fresh
`constructor_quality_review` returned **APPROVE**, independently rerunning
both exact tests at the default stack and target with **1/1 PASS** each.
No Critical or Important finding remains in this narrow checkpoint.

Both reviewers and Root verified constructor **2/2** hashes and the separate
contact freeze's **13/13** hashes unchanged. Original vehicle data and model
assets still have an empty diff against `145e327`.

| Frozen production-source file | SHA-256 |
|---|---|
| `crates/physics/src/tank/mod.rs` | `11c5ed1581abdb770d98ef2c619a6fce234e6d164f08519b1d4263dab8abfd49` |
| `crates/physics/src/tank/constructor_tests.rs` | `854dd8f5932d82f9b53e27a32369bf8b970a50831dd21f4df3a5943c5ceb6067` |

Manifest and exact snapshot are `tankforge-b2-constructor-freeze-hashes.json`
and `tankforge-b2-constructor-freeze-source/` under scratch. The repaired
constructor depends on the existing uncommitted B2 TrackState ownership;
HEAD has no such constructor yet. Therefore the runtime/test stay unstaged
with B2, and only this receipt is committed separately. Neither review
approves the rejected contact solver, source owner, fleet or release. No HTML,
WASM, browser or publication check was performed for this checkpoint.
