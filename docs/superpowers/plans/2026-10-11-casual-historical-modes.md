# Casual / Historical Modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. One runtime implementer at a time; fresh SPEC review then fresh QUALITY review per checkpoint. User approved scheme A, so proceed without another implementation-choice question.

**Goal:** Add playable casual and historical rules in single-player and online rooms, with effective performance and historical enemy-marker suppression driven by one versioned registry.

**Architecture:** A JSON registry feeds a dependency-light Rust `tg-gameplay` crate and a pure JS rules owner. Simulation/weapon owners derive effective parameters once from original inputs; the browser owns local preference and the server owns room mode. UI reads effective performance, while workshop exports retain source values. Isolate this feature from unfinished B2.

**Tech Stack:** Existing JS/WebGL2/Node, Rust/serde/WASM/WebSocket. Worktree `C:/Users/24908/.codex/scratch/tankforge-gameplay-modes`; branch `codex/casual-historical-modes`; accepted source baseline `c5350a4`. Existing sight/weapon baseline freshly passes39/39. No new npm install or browser execution is required.

Accepted specification: `docs/superpowers/specs/2026-10-11-casual-historical-modes-design.md`.

## Task 1 — shared rules and pure effective-performance owners

**Create:** `config/gameplay-modes.json`; `crates/gameplay/Cargo.toml`; `crates/gameplay/src/lib.rs`; `client/web/src/game/gameplayRules.js`; `client/web/src/game/gameplayPerformance.js`; `client/web/test/gameplay-rules.test.mjs`; `client/web/test/gameplay-performance.test.mjs`; `crates/physics/src/gameplay.rs`.

**Modify:** root `Cargo.toml`; `crates/physics/Cargo.toml`, `crates/physics/src/lib.rs`; focused test-module hookup if needed; `client/web/src/game/loadout.js` only for a backward-compatible optional launch-interval hook. Keep new rules out of the math-only `tg-shared` crate. Do not touch original data or models.

- [ ] Write RED tests using real T-34-85/T-10M/Puma inputs and `loadData()`: source snapshots unchanged; historical effective values equal stock; casual forward/reverse speed ratios1.15, matched-engine-rpm tractive force1.25, turn1.25; no geometry/mass/inertia/grip changes; deriving from the same source after repeated selections never compounds. Weapon tests exercise actual loader cycles including layout-based reload, autocannon spin/belt cycles, MG timing and independent missile slots.

```js
const historical = deriveVehicleParams(stock, 'historical');
const casual = deriveVehicleParams(stock, 'casual');
assert.deepEqual(historical, stock);
assert.equal(casual.vTop / stock.vTop, 1.15);
assert.equal(casual.maxReverseSpeed / stock.maxReverseSpeed, 1.15);
assert.equal(casual.mass, stock.mass);
assert.equal(casual.minTurnRadius, stock.minTurnRadius);
assert.deepEqual(sourceBundle, sourceBefore);
assert.deepEqual(deriveVehicleParams(stock, 'casual'), casual);
```

- [ ] Run `node --test client/web/test/gameplay-rules.test.mjs client/web/test/gameplay-performance.test.mjs` and `cargo test -p tg-gameplay -p tg-physics gameplay`; record genuine missing-owner/behavior RED before implementation. Cargo requires the scratch Rust homes and a claimed native lane.
- [ ] Create the exact shared registry:

```json
{
  "version": 1,
  "modes": {
  "casual": {
    "speed": 1.15, "drive": 1.25, "steer": 1.25,
    "traverse": 1.30, "elevate": 1.20, "fire": 1.20,
    "show_enemy_markers": true
  },
  "historical": {
    "speed": 1, "drive": 1, "steer": 1,
    "traverse": 1, "elevate": 1, "fire": 1,
    "show_enemy_markers": false
  }
  }
}
```

JS exports `GAMEPLAY_RULES_VERSION`, `gameplayRules(mode)` and `isGameplayMode(mode)`. The supported IDs are exactly `casual` and `historical`; strict room parsing rejects any other ID/version. Rust defines serde enum `GameplayMode`, typed `GameplayRules`, `rules(mode)` and the same version. Parse/validate the registry once; freeze cached JS rules; retain the same original JSON bytes in both build paths.

- [ ] Implement `deriveVehicleParams(stock, mode)` and the Rust counterpart taking original `VehicleParams` as input. Historical is the exact identity. To raise real speed without retaining the old gearing limit, use the runtime final drive divided by `speed`, source torque values multiplied by `drive*speed`, derived horsepower/power multiplied by the same factor, speed limits multiplied by `speed`, and max turn rate multiplied by `steer`. This preserves ×1.25 tractive output at matched engine rpm while extending speed by ×1.15; document that it is a casual drivetrain transform, with derived power following force times speed.

```js
const r = gameplayRules(mode);
const torqueFactor = r.drive * r.speed;
const trans = {...stock.trans, final_drive_ratio: stock.trans.final_drive_ratio / r.speed};
const engine = {...stock.engine,
  horsepower: stock.engine.horsepower * torqueFactor,
  torque_curve: stock.engine.torque_curve.map(([rpm, torque]) => [rpm, torque * torqueFactor])};
```

Use the existing parameter field names above, including `vTop`, `maxReverseSpeed`, `maxTurnRate`, `power`, `engine` and `trans`. Preserve all other fields; source inputs are read-only. Rust operates on corresponding `VehicleParams` names (`v_top`, `max_reverse_speed`, `max_turn_rate`, `power_w`) and owned cloned engine/transmission.

- [ ] Implement a cached source-derived loadout helper `deriveLoadoutPerformance(source, mode)` and `effectiveReloadSeconds(seconds, mode)`. Scale turret traverse and individual gun elevation; scale MG `slew` and carry a separate elevation scale if required by its current API. For timing, choose one path per owner: manual/layout reloads use the final `reloadTime` result divided by `fire`; autocannon/MG derived cyclic rates multiply by `fire` and belt reload periods divide by it; missile inter-launch and refill timing divide by it. Avoid also multiplying the same timer's dt. Clone mutable weapon definitions, preserve projectile/table references, ammunition state and independent-loader rules. Source-derived APS rate/range/traverse/elevation get matching factors without changing radar, projectile or damage fields.

```js
export function effectiveReloadSeconds(seconds, mode) {
  return seconds / gameplayRules(mode).fire;
}
```

- [ ] Verify actual physical force/speed and actual emitted round counts/ready times, not only copied numbers. Add Rust/JS same-registry and tracked drivetrain comparisons using existing thresholds. Run the focused group plus existing loading, launcher, weapon and wheeled groups. Commit only Task1; new SPEC PASS then new QUALITY APPROVE, repairing any findings before proceeding.

The actual launcher owner previously set cooldown to0.25 unconditionally. Add
an optional fourth argument to `fireLauncherRound(g,L,gi,launchIntervalSeconds=g.launchIntervalSeconds??0.25)`;
validate a finite positive supplied interval before consuming ammunition and use
it for cooldown. Historical/default retains0.25. Tests must pass the derived
interval into this real function and verify two-tube timing; they must not
overwrite cooldown afterward to make a dormant helper appear integrated.

## Task 2 — single-player controls, active performance and historical HUD

**Create:** `client/web/src/game/gameplaySession.js`; `client/web/test/gameplay-session.test.mjs`; `client/web/test/gameplay-hud.test.mjs`; `client/web/test/gameplay-runtime.test.mjs`.

**Modify:** `client/web/src/main.js`; `client/web/template.html`; `client/web/src/game/hud.js`, `game/vehicle.js`, `game/loadout.js`; `sim/tank/tank.js`, `sim/tank/drive.js` and `sim/wheeled/wheeled.js` only for optional mode/steering plumbing. Use Task1 owners instead of scattered multipliers.

- [ ] Write RED against the actual main selection/vehicle/aiming/loader/MG paths, using the existing real-data/fake-renderer test style in `weapon-control.test.mjs`. Capture emitted timestamps/ammo, real turret and MG poses, actual tracked/wheeled motion, and HUD Canvas calls. The historical drawing probe must include enemies/wrecks, friends, a same-spec different player, fixed targets, self and ABC. Verify transition clears stale cached enemy markers.
- [ ] Add `gameplaySession.js` with local selected preference, locked battle profile, optional server room profile and strict resolution. The public transitions are `chooseLocal(mode)`, `beginBattle(roomRules = null)`, `endBattle()` and `activeMode()`. Reject changing a locked battle; after leaving a room restore local preference. Persist local preference under `tankforge.gameplay.v1`; first-use casual. All low-level simulation/loadout helpers default historical to preserve stock consumers.

```js
const session = new GameplaySession('casual');
session.beginBattle({mode:'historical', version:GAMEPLAY_RULES_VERSION});
assert.equal(session.activeMode(), 'historical');
assert.equal(session.chooseLocal('casual'), false);
session.endBattle();
assert.equal(session.activeMode(), 'casual');
```

- [ ] Add the existing-style garage toolbar control, `id="gameplay-btn"`, with text `玩法：休閒` or `玩法：歷史`; use existing language conventions. Add a brief selected-rule display on deploy/battle presentation. Keep `G.mode` as the existing screen mode and use `G.gameplayMode` for rules. On selection/deploy derive parameters/loadout from original bundle, supply mode to `VehicleSim`, and use effective parameters in shown stats. Show the distinction between original and selected-mode performance. Workshop save/export remains source-valued.
- [ ] Connect player, local enemy missile/APS actors and remote/respawn context to the locked profile. Apply mode once in aim/loading/MG/autocannon/missile/APS paths; keep damage and actual overheat gates. For wheeled steering, replace the fixed steering actuator rate's use with `STEER_RATE*rules.steer`, retaining original geometry, max steering angles and tyre forces. Simplified/native tracked parameters consume the same Task1 transform.
- [ ] Filter historical `drawVehicleTags` by actual team before projection. Filter `others`/`enemies` for both map APIs and hide training vehicle name/range tags. Preserve fixed range-board targets, self, validated allies and objective glyphs. Map redraw resets immediately at mode/battle transitions; do not leave one cached enemy-map frame. Direct model rendering, manually measured range, Hit and replay remain.

```js
const visible = gameplayRules(activeMode).show_enemy_markers
  ? vehicles
  : vehicles.filter(e => e.friend === true);
```

Apply this only to auxiliary markers, not the rendered scene or damage targets. Resolve `friend` from valid room-team identity; no room/opposing/unknown team is an ally.

- [ ] Run `node --test client/web/test/gameplay-session.test.mjs client/web/test/gameplay-hud.test.mjs client/web/test/gameplay-runtime.test.mjs` plus the established39 sight/weapon baseline, vehicle-actions, launcher, folding, rangefinder and wheeled regressions. Verify source assets and user preference/export round trips. Commit Task2 after fresh SPEC then QUALITY; retain source timings and original suspension rules.

## Task 3 — authoritative room rules and online weapon-world consistency

**Create:** `crates/server/src/gameplay.rs`; `client/web/test/gameplay-network.test.mjs`; focused server gameplay tests in a separate module when appropriate.

**Modify:** `crates/server/Cargo.toml`, `src/lib.rs`, `src/lobby.rs`, `src/missiles.rs`, `src/server.rs` for the actual hello/resume socket dispatch; `client/web/src/game/lobbyui.js`, `game/net.js`, `src/main.js`; missile-world definition derivation if an owner is required. This is room-rule integration, not a new movement-authority or full per-weapon reload anti-cheat implementation.

- [ ] Write RED exercising actual `Lobby::handle` room creation/list/join/start/state/resume/deploy/fire/MG/missile handlers, not only serialized struct constructors. Use two clients with different local preferences; historical room stays historical. Assert unknown ID/version and midbattle changes are rejected; members with unsupported rule versions cannot silently join a new mode room. Update existing fixture literals only for required protocol metadata; retain every old behavioral assertion.
- [ ] Add `gameplay_mode` and `gameplay_rules_version` to create/room/start/resume/deploy rule envelopes. New clients advertise supported version in hello; the server stores compatibility on Player. Old/missing/invalid capability attempting a new-mode room gets the clear update-needed error. New browser with unsupported server disables the new room-start path and displays that update message instead of pretending rules synced. Do not silently treat an invalid room rule as casual.

```json
{"t":"create","name":"歷史房","map":"coast","max":8,"deploy":true,
 "gameplay_mode":"historical","gameplay_rules_version":1}
```

- [ ] Keep one immutable profile per Room. Every room/list/start/resume response carries that profile; client session consumes server values before reconstructing selected vehicles/weapons. Room UI creation selector and badges display the two labels. Mode is not a client's per-state performance field; incoming state cannot switch it.

The socket owner in `server.rs` matches resume Hello before normal `Lobby::handle`.
Validate the reconnecting socket's rules capability before restoring the old seat
or sending room/start messages; do not inherit the old socket's supported version
for an incompatible replacement connection. Include a real socket-dispatch or
shared dispatch-owner regression, not only a RoomInfo serialization test.
- [ ] Derive room APS and missile/rocket weapon timing from original definitions plus room rules. Keep original automatic/manual ownership, per-instance damage health and shared ammo gates. Adjust existing firing quotas, the socket message bucket and rate-dependent bounded queue allowances consistently with increased legal throughput; historical keeps original quotas. Scale the existing global state-jump speed limit with the room speed factor so it does not reject new legal casual motion; this remains the original coarse check, not new movement authority. Source definition maps are never mutated between rooms. Missile guidance/G/warhead and radar cycles remain original. Explicitly exercise two rooms with different profiles in the same server.
- [ ] Test legal confirmed main/MG fire, rejection of damaged/empty/invalid/duplicate/overquota requests, independent double-tube cooldown and manual/automatic Oplot. Verify lobby→NetClient→actual runtime session→HUD context, reconnect/respawn and leave-to-local preference. Run focused server/Node groups then complete existing server tests. Commit Task3 after fresh SPEC and fresh QUALITY reviews.

## Task 4 — final verification, matching artifacts and precise integration

**Modify/create:** `docs/gameplay-modes-2026-10-11.md`, relevant README instructions and a distinctly named built preview/page; no browser operation or automatic production publish. Oplot23 is a separate additional task after the user's barrel-layout answer, not a fake replacement by rules scaling.

- [x] First regenerate the mandatory Rust-to-Node protocol receipt with `TG_GAMEPLAY_NETWORK_RECEIPT=target/gameplay-network.json cargo test -p tg-server browser_protocol_receipt_from_actual_handlers --lib`. Its tags include the actual server handlers, gameplay crate, manifests and registry bytes. Then run full Node suite and complete native workspace tests with the default stack/target, no concurrent Cargo. A missing or stale receipt is a failure, never an optional skip. Record all failures; never relax prior tolerances or silently skip new runtime paths. Source baseline in this isolated branch excludes uncommitted B2, so don't copy B2 tests/code or its old failing heavy fleet probes into this feature.
- [x] Verify original source hashes/empty diffs for `data/vehicles`, `data/projectiles`, engine/weapon/armor files and all imported/packed models. Verify mode config and `tg-gameplay` source bytes are present and equal in JS/Rust build consumers. Run actual release `tg-design-wasm` compile before web build; fail if the bundle uses stale core fallback.

```powershell
cargo build -p tg-design-wasm --release --target wasm32-unknown-unknown
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
node client/web/build.mjs
```

- [x] Check generated target WASM, asset and exactly one HTML `designCore` embed are byte-identical. Validate that built UI contains both mode controls, room protocol/schema and versioned rule values; run actual runtime/HUD tests against the matching artifact inputs. CPU/build acceptance is separate from browser visual acceptance, which remains restricted by the prior automatic rejection.
- [x] Write the user-facing combined result MD with real multipliers, historic-marker scope, multiplayer compatibility, artifact path, verification and remaining B/replay boundary. Copy the reviewed page under a new name without overwriting original pages. Preserve the prior sight preview.
- [x] Final fresh SPEC→QUALITY review of the integrated mode feature, source diff and tests at `6853c5c`: SPEC independently passed 72 checks and the actual bundled registry probes; QUALITY independently verified provenance, unchanged sources and strict negative receipt cases. No actionable findings remain.
- [ ] Precisely integrate with the authorized development branch while preserving all frozen uncommitted B2 runtime hunks. Do not stage generated assets or unrelated dirty work wholesale. Push/integration decisions use existing user authorization and the required overall acceptance boundary; do not claim B2/wheels/exact-hitbox/projectile stages complete.

## Execution checklist

- [x] Task1 rules/performance source accepted at `f1353d6`; fresh SPEC PASS and QUALITY APPROVE.
- [x] Task2 active single-player and actual HUD accepted at `8a658cc`; fresh SPEC PASS and QUALITY APPROVE.
- [x] Task3 room authority and online weapon-world accepted at `0cbcc35`; fresh SPEC PASS (39) then QUALITY APPROVE (29), including expired-seat profile and cancelled-map-start repairs.
- [x] Task4 receipt, tests, matching named page and documentation accepted at `6853c5c`; fresh integrated SPEC PASS then QUALITY APPROVE.
- [ ] Precise integration/push after the separately approved Oplot23 addition and combined delivery are accepted.

Task4 delivery receipt: `docs/superpowers/notes/2026-10-11-gameplay-task4-receipt.md`.
Root's full checks on the same frozen `0cbcc35` runtime are Node 549 PASS/0 FAIL/
0 SKIP and native 364 PASS/0 FAIL/4 existing ignored, recorded in
`target/modes-full-node-fixed.tap` and `target/modes-full-native.log`. Task4
regenerated the actual-handler receipt and freshly ran 62 focused tests, then 72
including actual rebuilt WASM kinetic-impact after release/web build. Missing
and stale receipts both fail as required. All 448 protected sources (except the
intentional rebuilt WASM) and B2's 13+2 frozen files are unchanged. Original range
and sight-dot pages have separate verified hashes; generated HTML is not staged.

Native environment uses `C:/Users/24908/.codex/scratch/tankforge-rust/rustup`
and `.../cargo`, with `.../cargo/bin` on PATH. Never set `CARGO_TARGET_DIR` or
increase stack to claim success. Keep one native job and one runtime writer.
