# Full generated sound bank

This bank implements the user's instruction to generate and replace all requested game sound categories using ElevenLabs sound effects. The selected assets contain 224 newly generated clips and reuse the nine accepted regional manual-loading stages and three fitted T-72A AZ stages. The production selection is `client/web/assets/full-audio.json`; raw provider outputs remain separate from the selected exports.

## Coverage

The source-backed catalog covers all 44 loaded stock vehicles, 40 gun/launcher IDs, the 12 machine-gun definitions and 48 firing identities after explicitly documented sharing. It includes 56 firing/launch/rotary clips, 16 engine families with idle, medium RPM, high RPM, load, start and stop stages, running gear and terrain, impact verdicts and material tails, explosive mass classes, projectile approach/recede and supersonic crossing, loading mechanisms, and the seven existing electronic control-tone states. Custom and fictional equipment uses an explicitly classified interpreted profile.

The authoring inputs are `tools/audio/banks/full-game-v1.json`, `full-game-bindings-v1.json`, `full-ui-tones-v1.json` and `full-ui-tones-bindings-v1.json`. A final source audit also found the existing tree-fall collision sound; `full-world-supplement-v1.json` and its binding supplement supply that distinct wood impact. These are distinct from the adopted production manifest. Their planned export paths and readiness fields are not runtime selections.

## Generation and processing

The model is `eleven_text_to_sound_v2`, checked against the provider's sound-effects endpoint on 2026-10-12. The source catalogs request 500.35 seconds across 224 first takes. Their planning estimate at 40 credits per second is 20,014 credits; reported response cost headers are retained separately and are not asserted to be the final invoice.

There are 224 known successful selected generations. One additional original `engine_hl157_start` attempt has an unresolved transport outcome. Its receipt was preserved, and a separately selected replacement candidate supplies that cue. Nothing asserts that the unresolved attempt was free. There were no automatic retries or overwritten purchase runs.

Raw MP3s were decoded to floating-point audio with FFmpeg. Processing records the stereo-to-mono choice, removes DC, trims onset for one-shots or crossfades loop seams, preserves headroom, exports mono 44.1 kHz MP3, then decodes that export again to check finite samples and a peak below 0.99. Source over-unity diagnostics remain in the local receipts; normalization does not claim to repair any source clipping.

Each production cue pins the export, raw audio, provider receipt and mastering receipt hashes. The selection retains `subjectiveAudition: NOT RUN` for all new clips. These are interpreted game sounds, with no claim of authentic historical recordings. Only the nine previously accepted manual-loading clips retain their actual human listening acceptance.

## Runtime boundaries

Audio consumes accepted discharge, projectile sweeps, resolved impacts, loading work and vehicle state. It must never authorize a shot or change reload timing, damage, ammunition, engine force or weapon cadence. The first loading stage starts approximately 1.5 seconds after discharge; late stages follow actual remaining work and cancel when their owning cycle or vehicle ends.

The build loader checks exact bytes, adoption, cue/profile references, allowed paths and encoded payload limits. The bank contributes 6,990,012 bytes of encoded new audio, or 8,550,192 bytes including the separately accepted loading payload. Missing or undecodable migrated cues remain silent instead of substituting unrelated or synthetic sounds.

## Reproducible checks and remaining acceptance

Run `node tools/audio/full-game-catalog.test.mjs`, `node tools/audio/full-ui-tones-catalog.test.mjs` and `node --test client/web/test/audio-full-exports.test.mjs`. `loadFullAudio()` reads the actual selected manifest and verifies all export hashes. Local generation, decode and selection proofs are preserved under ignored `artifacts/audio/elevenlabs/` and `target/full-audio-mastering-20261013/`; `target/full-audio-root-selection-20261013.json` preserves the original selection and `target/full-audio-root-selection-r2-20261013.json` records the world supplement.

The whole runtime and matching native source receipts require their final independent review and joined game build before publication. Browser playback and listening of the new complete bank have not been performed. This audio bank does not certify completion of the separate V3 replay, suspension, exact hitbox or blast-damage requirements.
