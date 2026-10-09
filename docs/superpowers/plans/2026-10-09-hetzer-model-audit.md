# Hetzer Model Integration and Fleet Audit Implementation Plan

> **For agentic workers:** Use the current session's scoped read-only audit agents and execute integration sequentially in the primary worktree.

**Goal:** Add the user-approved custom Hetzer variant and report evidence-backed fleet geometry and historical discrepancies.

**Architecture:** Reuse the current vehicle registry, Hetzer family and GLB-to-packed-model converter. Keep source geometry provenance, neutralize the display gun pose at import, and separate static hull, turret, elevation and recoil ownership. Audit outputs distinguish confirmed errors from geometric candidates and uncertain history.

**Tech Stack:** Python/NumPy/SciPy/Pillow import pipeline; JavaScript/WebGL2 client; Node tests; Rust shared vehicle data.

## Tasks

- [x] Inspect source, approve the new variant, extract and hash-verify the GLB in an isolated worktree.
- [ ] Add a failing registration/articulation regression test before implementation.
- [ ] Inspect the GLB component bounds, calibrate running gear, pivot, trunnion and muzzle.
- [ ] Add a reproducible vehicle builder, import configuration and neutral-pose conversion if required.
- [ ] Generate only the new vehicle, add registry/family/localization entries, preserve old vehicles.
- [ ] Run focused tests and the existing numeric suite; run available browser render checks.
- [ ] Collect independent geometry and reality audits; verify high-impact findings and write a reviewed report.
- [ ] Review the final diff, integrate and push the completed changes, verify remote commit.
