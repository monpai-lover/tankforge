# Detailed Audio Authoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver reusable grab/load/lock manual stages in German, Soviet and US styles through safe offline authoring tools, then a bounded listening set before runtime work; retain the broader weapon/engine/impact/flight scope.

**Architecture:** Retain the schema-1 pilot unchanged and add a strictly validated schema-2 catalog with dynamic cue IDs, per-cue influence and 0.5–30-second requests. Reuse the private DPAPI/fixed-endpoint/attempt-lock safeguards; add numeric provider cost and local decode/composition/QA receipts. Runtime integration is a separate later checkpoint owned by root after the exclusive gameplay lane clears.

**Tech Stack:** Windows PowerShell/.NET local authoring; JSON catalogs; existing Node test runner for pure data/recipe tests; an explicitly selected local decoder/encoder for audio QA. No Cargo or browser in Task 1.

---

Spec: [2026-10-12-detailed-audio-design.md](../specs/2026-10-12-detailed-audio-design.md). Inventory: [audio-detailed-inventory-2026-10-12.md](../../audio-detailed-inventory-2026-10-12.md). User authorization already covers implementation; root performs internal review and selects each paid batch. This plan does not ask for another user permission gate.

## Task 1 — Authoring tools, catalog and QA only

**Writer boundary:** existing isolated `codex/elevenlabs-sfx-prepare` tree. May edit `tools/audio/**`, this design/plan, audio documentation and the existing authoring-output ignore. Must not edit `client/web/src/game/audio.js`, `main.js`, other gameplay sources, `build.mjs`, server/native code, or the schema-1 `sfx-manifest.json` / pilot receipts. No API call by the tool writer; root runs the specific batch after review.

**Files:**

- Create `tools/audio/elevenlabs-bank-core.ps1`, reusing schema-1 helpers without changing their bytes, for schema-2 validation and returned numeric cost.
- Create `tools/audio/elevenlabs-bank.ps1` as a separate default-dry-run entry point.
- Preserve `tools/audio/banks/detailed-v1.json` byte-identically as a held historical demo; create `tools/audio/banks/regional-reloads-v1.json` for the current nine short manual stages and blocked separate-charge concepts.
- Create `tools/audio/reload-recipe.mjs`, `compose-reload.mjs` and `audio-qa.mjs` for optional offline WAV audition/test rendering, exact frame counts, immutable composition receipts and level/onset/seam reports. Full-cycle files are not required production exports. MP3 decoding is a separately supplied local QA input, never falsely claimed by a WAV reader. Do not silently fetch a dependency.
- Create `tools/audio/listening-set.mjs` for a labelled local audition page; missing files are explicitly pending, not fabricated audio.
- Add `tools/audio/elevenlabs-bank.test.ps1` and `tools/audio/reload-recipe.test.mjs`; retain all 15 existing safety tests.

- [x] **1. Add failing safety tests before expanding the core.** Cases: schema-1 remains unchanged; schema-2 accepts safe cue IDs but rejects slash/dot/duplicate/unknown selection, prompt >450, nonfinite influence/duration, duration <0.5 or >30, and total batch >11 requests / >60 seconds. Dry-run proves zero credential reads/HTTP/writes. Inject malformed/error HTTP bodies, unsafe request IDs and invalid `character-cost`; confirm only coarse output and numeric/null cost survive. Durable pre-request locks and no-overwrite remain mandatory. Original RED/GREEN covered the missing core and scalar coercion. SPEC-1 added RED/GREEN totals 60.0000004 against 60 and 2.0000004000000002 against 2 before credential access; raw duration now enforces the cap while display/credits remain rounded. Exact legacy 20.7-second acceptance stays covered.
- [x] **2. Implement schema 2.** Stable field contract:

```json
{
  "schemaVersion": 2,
  "bankId": "regional-reloads-v1",
  "provider": "ElevenLabs",
  "modelId": "eleven_text_to_sound_v2",
  "outputFormat": "mp3_44100_128",
  "cues": [{
    "id": "de_manual_grab",
    "kind": "manual_reload",
    "durationSeconds": 0.9,
    "loop": false,
    "promptInfluence": 0.45,
    "takes": [1],
    "prompt": "One-shot of a human loader taking one heavy tank round from its rack inside a confined steel turret: restrained rack contact and a weighty lift. No insertion, no breech slam, no firing, no engine, no music, no voices.",
    "sourceEvidence": "de_tiger_e/weapons.json: kwk36_88_l56; crew loader present; human-approved manual style, not an authentic recording or universal German breech mechanism",
    "bindings": ["gun:kwk36_88_l56"],
    "demoOnly": true,
    "generationReady": true
  }]
}
```

The evidence string is authoring metadata and is not executed. Fixed bank/model/endpoint and generated safe output basenames prevent path or credential routing from catalog content. Schema-2 CLI accepts validated selected IDs/takes plus explicit request/second budgets, not a raw prompt/key/endpoint parameter. Output goes to a new bank/batch path under `artifacts/audio/elevenlabs`, with no silent reuse of pilot paths.

- [x] **3. Preserve the historical demonstration catalog:** `detailed-v1` contains manual open/work/lock, unmapped automatic drive/ram/lock, MG 42, E03/E09 and the blocked 72-K concept. Its nine ready cues / 20.7 seconds are a compatibility fixture; the previous first batch is held and superseded. No historical catalog bytes change. Optional automatic machinery is a separate later 3-request / 4-second / estimated 160-credit audition with no vehicle assignment.
- [x] **3a. Add current regional manual stages:** `de_manual_grab/load/lock`, `su_manual_grab/load/lock`, `us_manual_grab/load/lock`, durations 0.9/1.4/0.7 seconds per style, one take each, `loop:false`, influence 0.45, `demoOnly:true`. Representative bindings are `kwk36_88_l56`, `zis_s_53_85`, `m3_75`; no claim that every regional gun shares a breech. `recipes:[]` avoids required full-duration files. Three unbound separate-charge concepts remain `generationReady:false` pending physical sequence/assist evidence. Nine ready cues total 9 seconds / estimated 360 credits. Catalog checks cover exact ready IDs, duration budget acceptance and deferred rejection before reader/transport invocation.
- [x] **4. Preserve the blocked automatic-feed replenishment example:** `feed_72k_replenish_0p75` remains `generationReady:false` in the historical catalog. Numeric capacity alone does not establish physical clip operation. It is outside the regional manual batch and rejects before credentials.
- [x] **5. Capture real provider cost safely.** Read only the official `character-cost` response header into a numeric `reportedCharacterCost` after strict finite nonnegative numeric parsing; absent/invalid => null. Keep `estimatedCredits=duration*40` separate. Never emit the header collection, error body, account information, exceptions or a key-derived value. Preserve known response-rejection versus transport-unknown result codes and all request locks. Implemented and tested synthetically; real header validation awaits root's batch.
- [x] **6. Implement optional staged audition composition.** The existing pure tool renders exact target frames with source hashes, phase offsets, sustainable work and overlaps, no generation or overwrite. Eighteen Node tests cover normal/arbitrary/long targets, malformed inputs and coarse CLI failures. The old 7.5/6.25/4-second outputs are test examples, not required production files. Runtime stage reuse does not depend on a full-duration render for every mode or weapon.

Meaningful recipe tests:

```js
import assert from 'node:assert/strict';
import { planReloadRecipe } from '../../../tools/audio/reload-recipe.mjs';
const recipe = { targetSeconds: 72, sampleRate: 44100, openingFrames: 22050,
  closingFrames: 22050, workFrames: 1278900, workLoopable: true, crossfadeFrames: 220 };
assert.equal(planReloadRecipe(recipe).targetFrames, 3175200);
assert.equal(planReloadRecipe({ ...recipe, targetSeconds: 7.5 }).targetFrames, 330750);
assert.equal(planReloadRecipe({ ...recipe, targetSeconds: 6.25 }).targetFrames, 275625);
assert.throws(() => planReloadRecipe({ ...recipe, workLoopable: false }));
```

Define that API in a small pure recipe module under `tools/audio` so tests require no playback/native build. Add boundary fixtures for source-frame gaps, 20 ms overlaps and final-frame trimming. Dynamic runtime pause/rate behavior is specified for Task 3, not faked in the authoring compositor.

Implemented APIs: `composeReload({repositoryRoot,output,targetSeconds,sampleRate,crossfadeSeconds,opening:{path},work:{path,loopable},closing:{path}})` and `analyzeWav(buffer)`. Recipe JSON for `node tools/audio/compose-reload.mjs --recipe <artifact-json>` must refer to WAVs already decoded locally under `artifacts/audio/elevenlabs`. The historical manual work source is loopable. The optional 4-second demo uses `crossfadeSeconds:0` and non-loopable ram work, so source durations remain exactly 1+2+1 without looping a ram stroke. Every receipt retains actual decoded source frames/rate/channels/hash and final output frames. WAV reading is not MP3 decoding; none of the initial regional actions is a loopable bed.

- [x] **7. Implement QA and audition scaffolding.** WAV metrics remain diagnostic, not subjective approval, semantic voice detection or true-peak metering. The new explicit regional-bank page shows nine pending actions and 0/9 raw takes; the old pending page remains history. Real decoded-file QA/audition follows Task 2; HTTP 200 alone never approves a sound.
- [x] **8. Run final fresh verification and hand off.** Original safety 15, bank 15 including fractional boundaries/regional compatibility, and composer 18 passed: 48 distinct tests, with both PowerShell versions passing their suites. Parse/check source syntax and inspect the scoped diff and protected hashes before the final 13-file freeze, which also pins the regional listening page. Root performs fresh SPEC then QUALITY once before actual calls. Preserve failed c69c3ddd and repaired 6b9d7e6e checkpoints and their evidence.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\audio\elevenlabs-sfx.test.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\audio\elevenlabs-bank.test.ps1
pwsh.exe -NoProfile -File .\tools\audio\elevenlabs-bank.test.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\audio\elevenlabs-bank.ps1 -BankId regional-reloads-v1 -BatchId regional-reloads-pilot-20261012 -ReadyOnly
node --test tools/audio/reload-recipe.test.mjs
node tools/audio/listening-set.mjs --bank regional-reloads-v1 --batch regional-reloads-pilot-20261012 --output-name pending-listening.html
git diff --check
```

For the regional bank, `-ReadyOnly` selects nine manual cues and excludes all three blocked separate-charge concepts. Expected dry-run: **9 requests, 9 seconds, estimated 360 credits, generationRequests=0**, zero credentials/HTTP/generation artifacts. Listening scaffolding writes only a new local HTML page. Keep bank/batch explicit: CLI defaults retain the old historical demo for compatibility. Review the final candidate and pending batch before Root calls `-Generate`.

## Task 2 — Root-owned bounded actual generation / audition

- [ ] Root selects only the nine ready regional manual cues after SPEC and QUALITY PASS. Explicit bank `regional-reloads-v1`, new batch `regional-reloads-pilot-20261012`, `-ReadyOnly`, `MaxRequests=9`, `MaxDurationSeconds=9`; no automatic second take. Separate-charge concepts and historical 72-K/auto/MG/engine candidates are outside this batch.
- [ ] Root makes the actual calls and retains request IDs / numeric character-cost / safe outcome receipts. Unknown charged outcome is reconciled with provider history, never blindly retried.
- [ ] Locally decode and audition grab/load/lock semantics, onset/tail and useful regional variation at equal headroom, plus the original gun pilot. All remain prototypes until listening/QA. No fixed whole-reload production files are required. Optional automatic machinery is a separate later three-cue batch, always unmapped until an actual mechanism is established.
- [ ] If a stage has poor timing/silence, fix the prompt/recipe after two same-defect failures rather than buying more blind takes. Exact-duration audition WAV does not prove live readiness alignment: future actual-ready triggers the separate lock attack/tail; stalled loading must never play the lock from a nominal clock.
- [ ] Reuse the approved regional actions across compatible manual weapons and modes. Verify separate-charge/assisted mechanisms before exception banks; never infer autoloading from nationality, independent clocks or loader absence. Select feed/MG/launcher and wider weapon/engine/impact/flight work in separate bounded batches. The historical 46-duration-take envelope is superseded; do not generate TT-250 reload without a reachable loading transition.

## Task 3 — Later exclusive runtime owner

- [ ] After the gameplay writer releases its lane, add pure `audioProfiles`, `audioEvents`, `audioFlight`, `audioReload` and cache/lifecycle helpers; keep `audio.js` as the owner facade during migration.
- [ ] Preserve gun provenance / designer engine kind and validate all 43 garage / packed / custom bindings. Source identity is separate from entity ID.
- [ ] Wire grab once on loader assignment; own presentation load milestones relative to actual work; lock only on actual per-gun ready with ammunition. Grab/insertion are not currently measured simulation subevents. Reuse handling variants, appropriate waits or separately verified beds at normal pitch for long cycles; never loop completed ramming or globally stretch transients. Silence waiting/empty/stalled work and cancel replaced jobs, gun changes, failed online prediction and session exit. Test different baseline/casual durations, 52.8/72-second damage, >132-second custom work, indefinite stalls and completion-to-empty without extra generation.
- [ ] Wire resolved contacts, reported bursts, actual missile motors/flight segments and separate replay ownership. Add network presentation identity/discharge where absent through the protocol owner; do not guess remote gun or MG events from snapshots.
- [ ] Implement consistent 3D listener, propagation scheduling, subsonic Doppler and actual supersonic cone pass; enforce budgets and owner teardown.
- [ ] Modify asset embedding to allowlist only reviewed exports, with hash/ID/dedup/payload checks. Runtime remains keyless. Appropriate Node, exclusive native and browser checks are run by their owners after this lane is available.

## Preparation freeze

The final checkpoint combines the narrow raw-budget repair with the user's reusable-stage direction. The failed and intermediate repaired freezes stay preserved in ignored archives. The schema-1 pilot and original `detailed-v1` history remain unchanged. No new billable call, credential import, gameplay source edit, native/browser command, commit or push occurred. Root reviews the final current candidate once; runtime remains separate.
