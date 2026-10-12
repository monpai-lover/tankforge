# T-72A Autoloader Implementation Plan

> For agentic workers: use superpowers:executing-plans with the Root checkpoint;
> integration, staging and commits are withheld until Root SPEC/QUALITY approval.

**Goal:** Add a real T-72A with a fitted 22-round AZ owner and two-piece loading.

**Architecture:** A mount-specific recipe feeds an independent existing queue
worker. Mechanical timing and damage distinguish it from human loaders, belts
and launchers. C2 owns the unchanged 22-round stock/resupply projection.

**Tech Stack:** Ordinary JSON, dependency-free browser JS, Node production
tests, mirrored Rust vehicle/weapon/combat data owners and native C2 tests.

## 1. Production RED

- [ ] Create `client/web/test/t72a-autoloader.test.mjs` with real imports from
  `load-data.mjs`, `loadout.js`, `loading.js`, `tankmodel.js`, `vehicle.js`,
  `ammoInventory.js` and `gameplayPerformance.js`.
- [ ] Run `node --test test/t72a-autoloader.test.mjs`. Missing stock vehicle and
  absent fitted worker must fail actual assertions before code edits.
- [ ] Tests construct `makeLoadout('su_t72a', data.vehicles.su_t72a, ...)`,
  call `newLoading(1, 0, [true], [g.mechanizedLoading])`, fire the queue and
  assert `tick(..., 7.99, ...)` remains loading and completion occurs at 8 s.
  Event expectations are `['select_lift','projectile_ram','charge_ram']`.

## 2. First-party source data and model

- [ ] Create a deterministic, narrowly scoped builder
  `tools/build_t72a.mjs`; it writes only seven `data/vehicles/su_t72a/*.json`
  files and three explicitly named 125 mm projectile definitions.
- [ ] Register only `su_t72a` in `client/web/tools/load-data.mjs`.
- [ ] Model uses 6 wheels/side, front idler/rear sprocket, low cast loft,
  long 125 mm tube with thermal cover and bore evacuator; every mount follows
  existing world-meter/local +Z schema. No model.glb or unrelated source art.
- [ ] Pin evidence/estimates in `docs/t72a-autoloader-research-2026-10-12.json`.

## 3. JS production owner

- [ ] Add `client/web/src/sim/mechanizedLoading.js` to resolve/validate fitted
  mount recipe. `makeLoadout` sets explicit owner and capacity.
- [ ] Extend `loading.newLoading` with optional per-gun mechanism recipe.
  The corresponding independent worker uses no gunner 1.6 multiplier and
  reports its immutable cycle and stages from consumed work.
- [ ] `reloadTime` returns `effectiveReloadSeconds(g.mechanizedLoading.cycle_s,
  mode)` before manual layout math; no second gameplay multiplier.
- [ ] Update main's three queue constructors with explicit mechanism arrays;
  keep audio hooks untouched. Mechanical damage reads named real module
  health using a small adapter and preserves rack/repair/destruction behavior.
- [ ] Rerun target and existing workshop/ammo/damage/selection Node tests.

## 4. Rust parity (source edits only until Root grants native lane)

- [ ] Add typed mount-specific `MechanizedLoadingDef` and recipe checks in
  `crates/vehicle/src/files.rs` / `validate.rs` and the one design constructor.
- [ ] Mirror independent dedicated workers in `crates/weapon/src/loading.rs`;
  retain `Loading::new` manual behavior and add fitted constructor coverage.
- [ ] Register fitted mechanics in mounted combat bindings; distinguish
  mechanical rack/module damage from human-loader availability.
- [ ] Add tests loading real `su_t72a` data and exercising C2 selected capacity,
  stock debits and five-second empty-stock refill through actual server paths.
- [ ] Once granted: run focused native tests, full Node suite and matched
  native/WASM/client build, then record commands, exact source hashes and
  pending browser/audio acceptance in a frozen checkpoint manifest.

## 5. Handoff

- [ ] Give Root exact file list, diff, receipt hashes, uncertainties and tests.
- [ ] Do not stage, commit, push or touch Root completion/status documents.
