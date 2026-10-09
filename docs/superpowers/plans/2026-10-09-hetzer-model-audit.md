# Hetzer Model Integration and Fleet Audit Implementation Plan

> **For agentic workers:** Use the current session's scoped read-only audit agents and execute integration sequentially in the primary worktree.

**Goal:** Add the user-approved custom Hetzer variant and report evidence-backed fleet geometry and historical discrepancies.

**Architecture:** Reuse the current vehicle registry, Hetzer family and GLB-to-packed-model converter. Keep source geometry provenance, neutralize the display gun pose at import, and separate static hull, turret, elevation and recoil ownership. Audit outputs distinguish confirmed errors from geometric candidates and uncertain history.

**Tech Stack:** Python/NumPy/Pillow import pipeline; JavaScript/WebGL2 client; Node tests; Rust shared vehicle data.

## Tasks

- [x] Inspect source, approve the new variant, extract and hash-verify the GLB in an isolated worktree.
- [x] Add a failing registration/articulation regression test before implementation.
- [x] Inspect the GLB component bounds, calibrate running gear, pivot, trunnion and muzzle.
- [x] Add a reproducible vehicle builder, import configuration and neutral-pose conversion if required.
- [x] Generate only the new vehicle, add registry/family/localization entries, preserve old vehicles.
- [x] Run focused tests and the existing numeric suite; run available browser render checks.
- [x] Collect independent geometry and reality audits; verify high-impact findings and write a reviewed report.
- [ ] Review the final diff, integrate and push the completed changes, verify remote commit.

## Additional user-reported bugs

- [x] Fix circular HUD fitting, original Hetzer / Flak assembly and measured exhaust attachment.
- [x] Add bounded autocannon brake jets and cyclic recoil.
- [x] Repair BMP-K-64 wheel ownership, neutral gun poses, closed hatches and shared T-64A armour coverage; archive recoverable source and deterministic rebuild tool.
- [x] Add twin launcher tube state and consecutive launch / AI guidance tests.
- [x] Repair abrupt driveline engagement with real startup and existing traction checks.
- [x] Add individual MG selection/fire and the fifth keyboard ammunition slot, including scope zeroing and damaged-cannon regression.
- [x] Complete acknowledgement-driven online launch consumption and rejection / retry tests.
- [x] Fold the complete high M46 cab walls and both bed board groups, and MK103 casemate panels, with measured arcs, moving armour and server consistency.
- [x] Move the original M46 front tool, keepers and chain to low right-side horizontal storage and verify all six panels throughout their sweep.
- [ ] Run final aggregate tests and WebGL regressions, update research/audit/rebuild documentation, integrate and push.
