# Full generated audio replacement implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development to implement the tasks with independent source/quality checks. The user has already authorized the detailed design and now explicitly requests all sound generation and replacement; no additional approval gate is needed.

**Goal:** Replace every existing game sound category with an identity-aware ElevenLabs V2 bank, preserving actual simulation timing and the accepted regional/AZ loading audio.

**Architecture:** Root owns paid generation, durable provider receipts, mastering and final selections. The catalog worker owns new authoring JSON and actual-source coverage. The runtime worker owns the bounded Sound adapter, build loader and event wiring. Each event reads actual accepted firing, loading, movement or impact state; audio never controls those states.

**Tech Stack:** Existing dependency-free JS/WebAudio, Node tests, PowerShell ElevenLabs schema-2 CLI, bundled local FFmpeg. No game browser automation or native changes in this audio slice.

## Task 1: Complete catalog and coverage

Files: new `tools/audio/banks/full-game-v1.json`, `tools/audio/banks/full-game-bindings-v1.json`, a new catalog test, and an inventory document. The catalog worker must preserve all existing authoring files.

- [ ] Enumerate all actual `loadData()` and fitted loadout guns/MGs/APS/missiles, including T-72A, PKT and NSVT. Retain 48 actual firing identities with only already documented related-identity sharing; preserve explicit custom/designer generic profiles.
- [ ] Define one first-take cue per required moment: 56 firing/launch/rotary cues, all 16 actual engine families with RPM/load/start/stop, track/wheel/surfaces, impact verdict/material/spall/debris, HEAT/internal filler/explosive mass/cookoff, approach/recede/crack/ricochet, every existing UI tone, separate-charge/belt/disc/clip loading. Existing nine regional manual and three AZ clips remain exact bytes.
- [ ] Add coverage assertions before implementation. Validate every actual source binding, cue reference, duration, safe ID and prompt length. Run the existing schema-2 dry-run parser; split generation selections into at most 11 calls/60 seconds each.

The shared binding contract is a list of profiles `{id,kind,bindings,cues}` with role-to-cue IDs. Runtime and catalog workers coordinate the exact role names before writes. Selection is explicit user-directed adoption; new sounds retain `subjectiveAudition: NOT RUN`, never an invented human PASS.

## Task 2: Bounded runtime and actual events

Files: `client/web/src/game/audio.js`, new focused bank/profile owner modules, `client/web/src/main.js`, `client/web/src/game/audioReload.js` only where expanded loading requires it, `client/web/build.mjs`, new `client/web/tools/load-full-audio.mjs`, and new behavior tests. Old fixture changes only supply real production dependencies; never remove assertions.

- [ ] First reproduce two simultaneous real MG reports being collapsed into one. Add RED tests through actual main firing for distinct mounted identities, transplanted guns, simultaneous guns/MGs, real emission timing, failed/empty/rejected fire and rotary `res.fired` authorization. Add actual engine/movement, impacts, flight and loading tests with only the WebAudio boundary faked.
- [ ] Add `Sound.loadFullBank(bank)` and a reusable bounded decoder/voice/loop owner. Bank input is `{schemaVersion:1,selectionState:'user-directed',adoption,profiles,cues}`. Each runtime cue contains embedded `url`, exact `sha256`, `loop`, `durationSeconds` and level metadata. Validate authored category/identity binding, decode lazily with two workers, release one-shot nodes on ended/failure and bound loops/voices/decoded memory. Cancel stale decode generations and dispose at bank/session/context changes.
- [ ] Add weapon identity/context to existing Sound entry points or an explicit event method. Preserve numerical simulation cadence; schedule additive actual emission offsets for MG rounds. Do not mutate weapon rates or create one AudioBufferSource for every 133/167 Hz rotary round. Start/stop rotary layers only from actual firing/spin and emitted bullets, with per-emitter ownership rather than one global throttle.
- [ ] Drive actual vehicle engine profile with idle/mid/high/load beds, limited pitch variation and smooth crossfades. Start/stop follows engine/vehicle life, not a repeating timer. Add wheel/track and actual terrain layer. Preserve authored unknown/designer engine identity as an explicit neutral profile.
- [ ] Wire physically resolved impact verdict, material and actual explosive mass into layered events; distinguish ground/armor, stop/penetration/ricochet/shatter, HEAT/filler and confirmed cookoff. Add approach/recede/supersonic crossing/ricochet events from actual projectile sweeps and listener position. Deduplicate per projectile/crossing and bound nearby-flight owners; no whole-path fictitious whistle.
- [ ] Extend loading across the explicitly classified remaining manual, separate-charge, automatic-feed and MG belt/disc actions. Use actual consumed work/replenishment state; work fractions remain presentation estimates. Preserve the existing fitted AZ stages and per-gun positive-ammo ready lock. Do not create TT-250 reload from its normally unreachable nominal clock.
- [ ] Route every current confirmation/control/protection tone to authored UI cues. When the new bank owns a moment, missing/decoding/failed clips are silent; no oscillator, unrelated sound or legacy fallback substitutes for them. Do not change existing deterministic game state.
- [ ] Build-loader tests reject escaped paths, linked files, wrong SHA, unselected exports, duplicate IDs, dangling profile references and oversized payloads. `build.mjs` embeds only verified production selections, including all referenced profile metadata.

Example behavioral assertion for the existing defect:

```js
sound.mg(7.62, {weaponId:'mg34', emitterId:'player/mg0', time:1});
sound.mg(12.7, {weaponId:'m2hb', emitterId:'player/mg1', time:1});
assert.deepEqual(playedIds, ['report_mg34', 'report_m2hb']);
```

## Task 3: Generate, master, verify and publish

Files: Root-owned new `client/web/assets/full-audio.json`, selected `client/web/assets/full-audio/*`, local provider/decode/mastering receipts and new named offline HTML.

- [ ] Root reviews the complete catalog and bounded batch totals, then invokes the existing fixed-endpoint schema-2 `-Generate` CLI with explicit limits. Keep durable attempt receipts, no silent retry or overwrite, key remains only in the existing DPAPI helper process.
- [ ] Decode raw MP3 to local floating-point audio before measuring peaks, prepare normalized/faded exports with concrete receipts, verify source/output hashes and loop boundaries. Raw failures remain preserved. Subjective quality remains untested until listened to; objective QA must not invent auditory acceptance.
- [ ] Independently review runtime and complete actual-source coverage. Run the joined unfiltered Node suite with the valid matched native receipts, required catalog/tool tests and a fixed-commit build with Cargo explicitly disabled for this JS/audio slice.
- [ ] Export a new offline HTML from accepted source, remove only optional external font dependency, verify all selected cues/profile references/core payload and JS syntax. Preserve all older named pages. Root performs exact staging and authorized non-force public integration; no production deployment.

The broader execution checklist still includes V3 full cutover without legacy outline and with MG bodies, startup/shift diagnosis, exact model hitboxes and thickness crosshair, eight suspensions/Christie/history pivot, blast compartment topology, projectile mechanisms and vehicle geometry. Audio completion does not certify those independent systems.
