# Reusable loading-stage runtime checkpoint — 2026-10-12

Root authorized this isolated runtime slice after the detailed-audio design and authoring plan. Work stays in `tankforge-elevenlabs-sfx-20261012` at `5c17ced`; the gameplay/V3 tree, Root's status/completion documents, frozen thirteen authoring sources and two weapon/engine catalog sources are outside this writer's boundary. No commit, push, browser, Cargo, provider request or credential access.

## Binding and asset state before source edits

At the initial design read, the nine regional clips had no subjective approval; their immutable decode receipts say `subjectiveAudition: NOT RUN` and `readyForGame: false`. Before source edits, Root relayed the direct human response **「裝填聲合適」**, accepting the three German/Soviet/US grab-load-lock sets. This authorizes a new reviewed selection manifest for exactly nine processed manual clips after technical/hash checks. Original raw/candidate files and receipts remain unchanged. The automatic demonstration and seven weapon/engine clips have no approval from this answer and stay unbound/pending. Only the nine new reviewed exports may be enabled by default after Root integrates this slice.

Bindings use the installed gun definition and the actual round, independently of the host vehicle/entity or reload duration:

| Gun definition | Regional prototype | Compatible existing round IDs | Source |
|---|---|---|---|
| `kwk36_88_l56` | `de_manual_grab/load/lock` | `apcbc_88_l56`, `he_88_sprgr`, `apcr_88_pzgr40` | `data/vehicles/de_tiger_e/weapons.json:3`, crew loader at `crew.json:43`; regional catalog |
| `zis_s_53_85` | `su_manual_grab/load/lock` | `aphe_85_br365`, `he_85_o365k`, `apcr_85_br365p` | `data/vehicles/su_t34_85/weapons.json:3`, crew loader at `crew.json:43`; regional catalog |
| `m3_75` | `us_manual_grab/load/lock` | `apcbc_75_m61_m3`, `he_75_m48`, `ap_75_m72` | `data/vehicles/us_m4a2/weapons.json:3`, crew loader at `crew.json:43`; same definition/ammo in `us_m4a3_75w` |

The approved authoring spec identifies these as unitary manual prototypes, not authentic recordings or measured breech subevents. Unknown/designed guns, unknown rounds, separate charge, MG belts/discs, automatic feed, rockets and missile launchers receive no binding. The generic automatic demonstration stays unmapped. Definition identity survives source weapon transplantation (`loadout.js` retains `g.def`); neither host nationality, zero loaders, `reload_s` nor an independent loading clock identifies a mechanism. No wider gun mapping will be invented.

## Concrete runtime design

Use a pure bounded `audioReload` owner and a production adapter that reads the real `loading` queue and installed gun/ammo state. Queue wait is silent. Grab emits once on observed assignment to `loading` with positive work rate. Load emits once when actual completed work reaches one half of the assigned work; this is an explicit presentation milestone because simulation has no measured grab/insertion subevents. The short one-shot remains normal pitch, never a looped completed ramming stroke or a full-duration file. Rate changes, casual mode and very long work reuse the same stages. Zero work rate stops active handling and suppresses new handling; resume does not repeat completed stages.

Lock follows the post-refill game state `ready` and a loaded, positive-count, compatible round. Nominal time, queue completion before ammo resolution, `empty` and a failed prediction cannot create a lock. Identity/ammo replacement, waiting restart, cancellation, garage/select, pause/hidden/death and session exit stop owned sources. Scope is local player loading only; no remote activity is inferred.

`Sound` remains the existing facade. New buffers and cancellable one-shot nodes belong to this stage bank, separate from the old eleven sample slots and existing synthesis. Missing/disabled/unreviewed assets are silent. Existing reload completion feedback remains when the new bank does not own that completion; no wholesale replacement of legacy audio moments and no oscillator fallback for the new bank.

The build consumes a reviewed export allowlist with exact cue IDs, local paths, SHA256, byte limit, selection provenance and the direct human acceptance. The default manifest contains only the nine reviewed selections. Unreviewed entries are rejected; no raw take, automatic demo or weapon/engine candidate enters the default payload.

## Implementation and verification plan

- [x] Write failing Node tests against real loading and loadout production adapters: queue/start/work/ready, incompatible mechanisms/ammo, zero-rate and duration changes, empty completion, identity replacement, bounded owners and cancellation.
- [x] Implement the pure scheduler/binding adapter, then connect the Sound facade with fake WebAudio nodes only at the unavoidable browser boundary. Verify normal pitch, source cleanup, missing-asset silence and review gating.
- [x] Write failing export tests, implement reviewed allowlist validation, create nine reviewed selections with new approval provenance, and add the smallest build/main integration. Use syntax/bundle checks without invoking Cargo.
- [x] Run the relevant existing loader/online ammo tests, preserve protected authoring/source hashes and inspect the narrow diff. Record RED/GREEN receipts and freeze exact candidate paths/hashes for Root's independent review. Fresh browser/runtime acceptance and final publish/enablement remain Root-owned.

## Implemented handoff

The actual `loading.tick` rate callback observes grab and work after loader assignment; `reloadReady` runs after `refillBelt`, `nextAmmo`, `syncGunShell`, `refillLauncher` and completion-to-empty resolution. Fire and manual unloading cancel the old owner before entering waiting. Each online prediction records `reloadCycle: loading.clock`; rejection cancels that exact cycle, and an older rejection cannot replace a newer blocked cycle. Pause/visibility suspends active voices while real progress consumes milestones, preventing catch-up playback; replacement/garage/death cancels jobs. Completed owned lock nodes disconnect on end.

Twenty-three new loading/export tests plus five existing live online-fire tests pass. Independent review found and verified fixes for delayed rejection, waiting-restart cleanup and the extracted Sound dependency; a second review caught and verified the reversed rejection-order guard. Existing extracted-main fixtures now use the real Sound facade with their legacy moment stubs preserved. No simulation/native source was changed.

The expanded run recorded 175/180 passing tests. Five `aps_pose` tests fail solely because this isolated tree lacks `target/weapon-control-gameplay-network.json`. A read-only comparison substituting unmodified HEAD main reproduces exactly those five missing-receipt failures. Do not call this a full green native/web gate. Root owns the native receipt and final integration validation.

The review build used esbuild 0.24.2 and a verified nonexistent `CARGO` executable path; `build.mjs` now honors that explicit executable override and retained the committed WASM `18a27ae78002ac872fff88ca90992ce59afd778cd5837cf3a64c0b8bb79e6989`. No Cargo/native executable ran. The nine reviewed WAV selections produce about 1.03 MB of encoded bank data. All previous named game pages, provider raw/receipts and fifteen frozen authoring files are preserved.

Root relayed a separate subsequent human instruction to use automatic loading on a real autoloader vehicle. This manual checkpoint is frozen before that work; the three historical generic automatic entries remain unmapped here. Genuine vehicle/mechanism evidence and a separate new selection/binding belong to the follow-up owner. No automatic or weapon/engine asset is included in this nine-stage export.

The requested whole detailed audio system and the prior user requirements remain broader than this slice. This checkpoint cannot mark them complete.
