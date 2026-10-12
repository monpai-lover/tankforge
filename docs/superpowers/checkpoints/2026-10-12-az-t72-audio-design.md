# Fitted T-72A automatic loading audio — authorized design and execution checkpoint

Root explicitly authorized this extension in the joined tree at `59ef175af60ec0919f61be70bc2a453dec1ecaf8`, containing accepted T-72A and manual R3 sources. The human instruction is **“自动装弹的 也用上 找个现实里用自动装弹的车”**. The concrete contract is `target/root-az-audio-integration-handoff-20261012.md`; no further design or implementation approval is needed. No staging, commit, push, provider/secret access, Cargo/native game execution, game browser/HTTP/CDP/Playwright, primary-tree modification or Root status-document write is authorized.

## Architecture and selection policy

Reuse the current bounded `ReloadAudio` jobs, prediction-cycle blocks, eight-voice admission and 32 MiB/two-worker decode limits. A separate automatic audio owner would duplicate cancellation and life state; nominal duration-based playback would disagree with consumed work. The selected approach adds a mount-aware profile and actual stage-event observation to the existing owner, preserving all manual behavior.

Only a real installed, validated `az_t72` mechanism on `2a46_1_125` with the authored APFSDS/HEAT/HE identities is eligible. The APFSDS flight body is 44 mm, so cartridge identity rather than shell body calibre controls binding. A transplanted gun without its mounted mechanism, another gun, a wrong physical module kind or invented ammo receives no AZ binding. No Rust/data changes are needed.

Build input gains a separate strict `az-t72-audio.json` manifest and directory with exactly three existing selected exports: `az_t72_drive`, `az_t72_ram`, `az_t72_lock`. Their source IDs remain `autoloader_demo_*`. The provenance is interpreted machine textures, not authentic AZ recordings. This manifest records explicit user-directed adoption and `subjectiveAudition: NOT RUN`; it cannot claim a separate auditory PASS. The original nine-only manually approved manifest and every raw/provider/decode record remain exact bytes. The build combines the validated automatic subset with the unchanged manual subset under the existing `data.reloadAudio` input.

## Runtime contract

The real mounted rate callback creates/updates the same job and stops its voices at zero work. It emits no manual cues for a mechanical profile. The actual fifth `loading.tick` callback passes `select_lift`, `projectile_ram`, `charge_ram`, immutable cycle and consumed-work fractions to `Sound.reloadStage`. Validate current gun, fitted mechanism, cycle, stage order and consumed milestone before playing. Drive emits once, the same ram texture emits separately for projectile and charge, and each cue plays at normal pitch as a one-shot. Stage consumption remains monotonic when inaudible; resume has no catch-up strokes.

`reloadReady` remains after actual refill/next-ammo/empty resolution. A lock requires the same valid job and actual ready with a compatible positive-count loaded round. Per-gun binding ownership is independent of jobs, decoding, audibility or voice admission: owned but unavailable completions stay silent, and separate unbound guns retain their own existing click.

Reuse the existing cancellation route for current/older/reordered rejection, pause/visibility, damage stall/resume, empty/22-set exhaustion, selected resupply, replacement, death and session exit. WebAudio setup/start/teardown failures remain contained within Sound and cannot affect simulation. No stock, resupply, loading timing or mode rule owner is added.

## Execution plan and file ownership

- [ ] Add failing production automatic tests in `client/web/test/audio-az-t72.test.mjs` through actual main fire/loading/refill/Sound, with only the unavoidable WebAudio boundary faked. Cover both modes, two ram strokes, 22-shot exhaustion, five-second selected refill followed by real cycle, each named mechanism damage stall, gun-only transplant, mixed completion ownership, prediction rejection and partial audio failures.
- [ ] Add failing export tests in `client/web/test/audio-az-t72-exports.test.mjs`, then extend `client/web/tools/load-reload-audio.mjs` with separate automatic adoption validation and the existing path/hash/payload guards. Copy only verified selected WAV bytes and create the new automatic manifest/proof; original manual selection stays unchanged.
- [ ] Extend `client/web/src/game/audioReload.js` with a fitted profile and actual mechanical event consumption; extend `client/web/src/game/audio.js` with the same bank/decode/voice owner and mounted completion profile; add the fifth callback in `client/web/src/main.js` while preserving `mountedReloadRate` in the observation callback.
- [ ] Independently reproduce and repair JS wrong-kind mechanism module acceptance in `client/web/src/sim/mechanizedLoading.js`, with a new focused production regression through actual loadout creation. Replace the exposed internal mechanism key with `AZ 自動裝彈機構` in `client/web/src/game/weaponDamage.js`. A delegated worker owns only these two files and its new test.
- [ ] Update extracted-main fixtures only with the actual mounted adapter and Sound dependencies. Preserve every prior stock/progress/ready/damage assertion. Run focused RED/GREEN then full unfiltered Node with `TG_T72A_RECEIPT=target/t72a-r2-c2-native.json` and the actual R2 network receipt, verifying their source tags. No manual-tree missing-five filter may appear in the final full result.
- [ ] Verify all selected/raw/provider/decode hashes, immutable failed manual/T72 archives, accepted freezes and all earlier named pages. Build using the matched T-72A WASM and verified nonexistent Cargo executable, make a new named page and freeze exact candidate files/receipts for fresh SPEC then QUALITY and Root acceptance.

Root owns final source integration, publication and status updates. Actual browser pixels/playback, public acceptance and the full detailed-audio system remain outside this checkpoint's completion claim.
