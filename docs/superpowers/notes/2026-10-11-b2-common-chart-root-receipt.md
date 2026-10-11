# B2 common directional chart — final independent guard receipt

Root-owned verification, 2026-10-11. Target worktree:
`C:/Users/24908/.codex/scratch/tankforge-suspension-tracks-v7`.
This checks the final metadata guards in the implementer's common-chart
checkpoint, including the added material-phase guard.

Fresh runs after inspecting the checkpoint and exact test names:

- `node --test client/web/test/track-mechanical-chart.test.mjs`: exit0,
  **3 PASS /0 FAIL /0 SKIP**.
- `cargo test -p tg-physics fixed_track_mechanical_chart -- --nocapture`:
  exit0, **3 PASS /0 FAIL /0 IGNORED**,93 filtered tests. Used the established
  scratch cargo/rustup homes, serialized native build ownership and no
  `CARGO_TARGET_DIR`.
- External unchanged
  `C:/Users/24908/.codex/scratch/tankforge-root-chart-transition-grid-probe.mjs`:
  exit0. The original node2+10µm corruption is rejected with
  `semanticFeatureMismatch`; count and grid indices stay unchanged. Every
  one of176 interior-node perturbations is rejected (`acceptedMutations=[]`).

Covered boundaries: joint q/material/control derivatives from one coherent
chain/cone, common-boundary agreement, rejection of assembled incompatible
columns, stale trusted-grid source/transition metadata, phase-index mismatch
and actual nonlinear roof crossing. Native3 and JS3 are fresh focused runs;
the earlier combined JS40/native29 checkpoint is historical and was not
rerun here.

This is helper/domain evidence. `mechanicalValid` remains false. Actual
source R/S rows, shared-hull normal and reciprocal traction, applied
impulses, loaded correspondence, production activation, full-fleet and
native-lockstep acceptance remain required. B2 is incomplete. No WASM,
browser, baseline overwrite or vehicle dynamics fleet run occurred.

Root returned the native build resource to `b2_resume_impl` immediately
after these checks; the sole runtime implementer may resume frozen files.
