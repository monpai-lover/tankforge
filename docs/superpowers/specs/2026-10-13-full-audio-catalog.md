# Full game audio catalog — 2026-10-13

User instruction:「同時完成所有的音效生成和替換」. This extends the approved 2026-10-12 detailed design on `84033dd`. The authoring catalog is `tools/audio/banks/full-game-v1.json`; the binding and selection manifest is `full-game-bindings-v1.json`. Existing manual/AZ bytes and old pilot manifests are retained. The provider model is `eleven_text_to_sound_v2`. The catalog agent made no provider call.

The 48 firing identities and 56 cues cover 44 vehicles, 40 gun/launcher IDs, 50 gun mounts, 12 MG catalog IDs, 47 secondary mounts, two rotary/APS installations and four missile families. Only documented KwK39, KDA, KPVT and TT250 sharing is used. T72/2A46-1, PKT and NSVT have distinct identities. Three clipped cannon pilots are rejected; no candidate receives an invented subjective PASS.

The new bank contains 216 first-take requests, 495.35 requested seconds and an estimated 19,814 credits at 40/s. Returned provider cost is recorded separately. Twelve installed loading cues are reused through their exact existing manifests and hashes.

The separate immutable `full-ui-tones-v1.json` adds seven first takes for the existing on/off/detect/lock/overheat/empty/fault control tones: 3.5 requested seconds and an estimated 140 credits. Its companion `full-ui-tones-bindings-v1.json` uses `tone:<state>` selectors and the `tone` cue role. The combined new generation scope is 223 first takes, 498.85 seconds and an estimated 19,954 credits. Actual typed state owners and timing remain authoritative.

| Group | New cues | Seconds |
|---|---:|---:|
| firing | 56 | 104.4 |
| engines | 96 | 288 |
| runningGear | 6 | 30 |
| impacts | 15 | 17 |
| explosions | 6 | 18.75 |
| flight | 8 | 9 |
| ui | 5 | 2.5 |
| customWeapons | 2 | 4 |
| loading | 22 | 21.7 |

## Engine and running gear

Retain the fifteen evidence-labelled engine families. E16 is the sourced V-46-6 diesel on T72: 780 hp and 600–2000 RPM. Each family has idle/mid/high four-second loops, a three-second load loop, a two-second start and a one-second stop. E14/E15 remain neutral because fuel metadata is missing or conflicting. Each stock vehicle is bound exactly once and retains its actual RPM/load parameters.

The actual `visual.running_gear.kind` marks eight wheeled and 36 tracked vehicles. Light/medium/heavy track texture is an explicit art category based on authored hull mass. Wheel road and soft/gravel surface beds are distinct.

## Impact, flight and explosions

There are 88 loaded projectile records, 76 referenced by garage weapons, and nine kind strings. T72 adds APFSDS, HEAT-FS and HE. Gun caliber is separate from projectile core caliber: 3BM22 fires from a 125 mm gun while its projectile field is 44 mm.

Actual outcomes and contacted layers drive attacks and material tails; actual fragments drive spall/debris. HEAT and filler require confirmed bursts with inside/mass data. Explosive mass classes span 0.006–125 kg; confirmed cookoff is separate. Supersonic cracks require actual velocity and a near trajectory. Pass-by and ricochet use actual paths. Motors end at actual burnout, interception or detonation. ERA material names, HUD kills and shell kinds cannot create an unreported burst.

The approved burst-mass thresholds are micro below 0.05 kg, small 0.05–0.25 kg, medium 0.25–1 kg, large 1–5 kg and very heavy at least 5 kg. Zero filler creates no explosive cue.

## Loading

Reuse nine reviewed regional stages and three user-directed fitted AZ stages. Generic manual unitary bindings retain weapon source identity; UK/prototype reuse of the US style is an explicit artistic texture choice.

Separate loading uses `projectileGrab`, `projectileLoad`, `chargeGrab`, `chargeLoad` and the existing Soviet lock. M46 notes explicitly state separate loading. D25/M62 use a generic two-piece presentation interpretation with no powered-assistance claim. Belt, disc and compact carrier each have generic grab/load/lock actions; numeric capacity alone does not establish an authentic mechanism. Guided launcher assemblies use actual tube exhaustion and available reserves. TT250 has no normal reserve reload and receives no fake one-second action. New stages are presentation milestones of actual work.

## Manifest

The manifest has schema version 1, user-directed adoption, and a profiles array of `{id, kind, bindings, cues: role → cueId}`. Profile kinds are `weapon`, `mg`, `missile`, `engine`, `runningGear`, `surface`, `impact`, `blast`, `flight`, `loading` and `ui`. Authoring bank bindings permit only `gun:`, `mg:`, `engine:` and `missile:`. Shared physical effects use empty bindings and selector metadata; APS associations are metadata.

Runtime cue fields are `{url, sha256, loop, durationSeconds, level}`. Planned selections use `file`, `sha256: null` and `readyForGame: false` until Root verifies selected bytes. Subjective audition stays `NOT RUN` when unperformed. Direct adoption does not become a subjective PASS. Missing migrated cues remain silent.

## Batches

Every cue has `takes: [1]`. Each exact selection contains at most eleven requests and 60 requested seconds, with no repeated cue. Use a fresh unique destination per batch and no silent paid retry.

| Selection | Requests | Seconds | Estimate credits |
|---|---:|---:|---:|
| full-firing-01 | 11 | 23 | 920 |
| full-firing-02 | 11 | 21.7 | 868 |
| full-firing-03 | 11 | 21.9 | 876 |
| full-firing-04 | 11 | 23.4 | 936 |
| full-firing-05 | 11 | 13.2 | 528 |
| full-firing-06 | 1 | 1.2 | 48 |
| full-engines-01 | 11 | 35 | 1400 |
| full-engines-02 | 11 | 34 | 1360 |
| full-engines-03 | 11 | 33 | 1320 |
| full-engines-04 | 11 | 32 | 1280 |
| full-engines-05 | 11 | 32 | 1280 |
| full-engines-06 | 11 | 32 | 1280 |
| full-engines-07 | 11 | 35 | 1400 |
| full-engines-08 | 11 | 34 | 1360 |
| full-engines-09 | 8 | 21 | 840 |
| full-running-gear-01 | 6 | 30 | 1200 |
| full-impacts-01 | 11 | 12 | 480 |
| full-impacts-02 | 4 | 5 | 200 |
| full-explosions-01 | 6 | 18.75 | 750 |
| full-flight-01 | 8 | 9 | 360 |
| full-ui-01 | 5 | 2.5 | 100 |
| full-custom-weapons-01 | 2 | 4 | 160 |
| full-loading-01 | 11 | 10.3 | 412 |
| full-loading-02 | 11 | 11.4 | 456 |

Validation passed: `node tools/audio/full-game-catalog.test.mjs` and PowerShell `Read-SfxBank` on the new bank. Tests cover actual stock loadout coverage, explicit identity sharing, all sixteen engine families, provider/prompt bounds, unique bounded batches and existing loading asset presence. Generation-ready describes authoring readiness; it does not establish semantic audition or runtime admission.

Supplement validation: `node tools/audio/full-ui-tones-catalog.test.mjs` covers seven typed state selectors, one 3.5-second batch and the approved burst-mass thresholds.
