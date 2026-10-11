# Oplot23 Task2 combined delivery freeze

This is the original delivery-freeze receipt. Final independent acceptance,
main integration, default-page synchronization and source publication subsequently
completed at `ff96373`; see [Root final receipt](2026-10-11-oplot23-final-acceptance.md).

2026-10-11, isolated worktree `C:/Users/24908/.codex/scratch/tankforge-gameplay-modes`,
branch `codex/casual-historical-modes`. Accepted runtime/data/tool source is
`c361d0c320081f815f99f9bdea6ca21c84848695`. Task1 fresh SPEC→QUALITY accepted
that source; mode delivery `6853c5c` was already accepted, recorded by Root in
`8762daa`. Task2 changes documentation only: the actual rebuilt WASM bytes equal
the existing committed asset, so no binary mutation is staged. Final fresh combined
SPEC→QUALITY, precise integration/default-page synchronization and public push
are pending Root. No push, merge, runtime edits or production deployment here.

## Fresh serial builds and checks

1. Set absolute `TG_GAMEPLAY_NETWORK_RECEIPT` to this worktree's
   `target/gameplay-network.json`; run
   `cargo test -p tg-server browser_protocol_receipt_from_actual_handlers --lib`:
   **1 PASS/0 FAIL/0 ignored/exit0**. All 10 required raw source/config/manifest tags
   exactly match current files. This uses actual handlers, not constructed packets.
2. Run `cargo build -p tg-design-wasm --release --target wasm32-unknown-unknown`:
   **exit0**. Run `node client/web/build.mjs`: **exit0**, explicitly no fallback.
   Target, asset and every decoded page core are byte-identical. Rust dependencies
   are unchanged, so Cargo correctly reuses its exact source-matched release output;
   no unrelated cached core is substituted. Default target and stack were retained.
3. Post-build real focused tests: Oplot variant 9 + mandatory bridge 14 + actual WASM
   kinetic 10 = **33 PASS/0 FAIL/0 SKIP/exit0**, including nominal world-axis recoil
   on tilted parents and actual isolated author output. No canonical regeneration.
4. Fresh mandatory negatives use independent receipt copies: missing receipt,
   stale registry bytes and omitted `Cargo.toml` source tag each correctly fail
   the real bridge suite with **exit1**. Negative driver exits0. Sources and the
   actual regenerated receipt remain intact; no assertions were relaxed.
5. `node target/oplot23-task2-verify.mjs`: **exit0**. Each new output has exactly
   one `tf-data` and one `designCore`, parsable JS, serialized current `loadData`,
   original registry values, strict/frozen bundled room rules and current FAMILIES.
   Built validation rejects missing/unknown modes and missing/null/string/0/2
   versions. Actual Mods/loadout/import decoder/buildTank CPU geometry and the
   page's embedded WASM APS registration consume the delivered data offline.
6. All 448 original source data/assets and all 13 + 2 external frozen B2 entries match
   expected hashes. Only 10 new JSON additions differ from `c5350a4`. No B2 code,
   tests, thresholds or unrelated work is staged. `git diff --check` passes before
   the precise documentation whitelist is staged; staged diff is inspected and
   checked again before commit.

Native environment: `RUSTUP_HOME=C:/Users/24908/.codex/scratch/tankforge-rust/rustup`,
`CARGO_HOME=.../cargo`, `.../cargo/bin` PATH. No `CARGO_TARGET_DIR`, stack override
or concurrent native job. Esbuild is
`C:/Users/24908/Documents/ChatGPT/tankforge/client/web/node_modules/@esbuild/win32-x64/esbuild.exe`.
Native lane was released after these native operations; subsequent work is docs
and offline checks only. No browser, HTTP, CDP or Playwright operation occurred.
The prior automatic browser refusal remains a separate visual-acceptance limit.

## Full groups and provenance

Root full suites were already run after the new data addition. Task2 independently
parses their entire retained summaries, hashes their bytes and proves relevant
inputs unchanged, then runs fresh targeted checks above. Repeating unchanged full
groups is unnecessary. Exact Rust/config/data/schema/manifests have no diff from
`3d73ac3`; Node source/tests/tools/config inputs have no diff from `c361d0c`.
Current verification-input map covers 811 files with aggregate
`45836123a48d4c470905c6f2d4cb38e4bb54f1ea6c6a198a65a26f0c1ba39463`.

| Evidence | Result | SHA-256 |
|---|---|---|
| `target/oplot23-root-full-node.tap` at c361d0c | 558 PASS,0 FAIL,0 SKIP | `3e7df238796a30d7ff132c9b34bc531c54dded88f1c1253170b4ff4252f761da` |
| `target/oplot23-full-native.log` at3d73ac3 | 366 PASS,0 FAIL,4 old ignored | `f37ef97d89aa06dde5fa07b191f61755989194ac60c4e99c75957790f1131190` |
| `target/oplot23-task2-fresh-tests.tap` | Fresh33 PASS,0 FAIL,0 SKIP | `6cb27e79b1c91f6d2f7fb96fe38ce9984e6a35b1036831b2736c1c3a01d6a8e6` |
| `target/gameplay-network.json` | Actual-handler receipt,10 current tags | `008bf177adec0ff13e68939af0eb37377002e971972c0208063cf5d226c71205` |
| `target/oplot23-task2-wasm-build.log` | release exit0 | `79e296fce4d35f79ac182a5e1106bf770f89d308ec49d8901b09be6e6beb9bf0` |
| `target/oplot23-task2-web-build.log` | web exit0,no fallback | `e260b66099dce5be1d2b312462329871973946bce9e8ff1c25339c32ca127078` |
| `target/oplot23-task2-negative.log` | 3 required exit1 cases,driver exit0 | `36b7d937bc77d48a26b5a527e16d890186be1e716c64d1dd2f0f7930ec32db89` |
| `target/oplot23-task2-verify.mjs` | Offline checker,default integration flag | `9a0d47f9593f37593b14c43a6974ca847a485ea70b1ec547def18f90b8cf6b3e` |
| `target/oplot23-task2-source-build-receipt.json` | Initial freeze at verificationHead c361d0c | `33d2a88eead313dc25a6145252ba3250848a0c34b997692cfc70174b9f207892` |

The four ignored native tests are existing diagnostics:
`tg-design::tests::print_sample_summary` and
`tg-missile::tests::{debug_trace_rocket,debug_trace_single_tow,debug_two_sides}`.
No new variant/bridge/runtime path is skipped. Generated evidence stays ignored.
The manifest records current `verificationHead` when rerun; after a docs-only
commit that metadata can change without altering source, logs or artifact bytes.
After Root synchronizes the default page its recorded state/hash also changes as
described below; the preserved source and named-page hashes remain fixed.

## Actual handler source tags

| Raw input | SHA-256 |
|---|---|
| `Cargo.toml` | `834d4c1026720239add504f72a1f50939a8c0b0e9ecd1471b8820e0ad454d643` |
| `config/gameplay-modes.json` | `fe506e2994589a49afa9372dd1807d3362d70bbb5bc04bfec2654b90905aba66` |
| `crates/gameplay/Cargo.toml` | `2637674a8fb2a87895e204faadab9bc40210d1f273ae98dd22172c5cee30c486` |
| `crates/gameplay/src/lib.rs` | `a35877f899d6e4c6b01f4039004478b88d9a69c3774fdf8a4711bba3cddd5e3e` |
| `crates/server/Cargo.toml` | `bd04141d8f29da4bbabb997f9b51a7e4b054e9ecae801410eb3d7d37ac0c751d` |
| `crates/server/src/gameplay.rs` | `b5760a5923dcd9a4b49a57afb7b120cc0fdc7fb42e467e8fbcbd98dad407bafa` |
| `crates/server/src/gameplay_tests.rs` | `dc856318a6970e85e6247d5dbf9b14e2e72118843086f71cead534a64d72d9e2` |
| `crates/server/src/lobby.rs` | `6c8fcd2e09b206bce7766c8a61a7c584b91d93df3636428d2fa039d2ded49fe0` |
| `crates/server/src/missiles.rs` | `e696381bfb79407cdabb4b62e09c563ea84441990136460bb3c7c09f46396724` |
| `crates/server/src/server.rs` | `636594796be9e4dfe08d05cd53e0522d4c891410173bb4bfa06df536d00d99c9` |

## Byte-matched named artifact and default-page handoff

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| Release target/asset/decoded core | 1643249 | `173c6c970f1d51ddcd86e819a1b4bc80b31af4f277a41466045cd7e68de08fd7` |
| Scratch `dist/artifact.html` | 35055672 | `c254a8acae5e56f2d3e8f4bf6acd514657653c02d64b08cb44c1d659301e680c` |
| Scratch range and named combined page; exact shared named page | 35055861 | `365b79764d17821a8f99ee297af9905204414299c3132ad1104936ff4474e3ad` |
| Preserved shared ordinary range and new pre-modes backup | 34840387 | `95130c2a34dbb8bb8bfcf1c01662f2769f951b517e592ef8db312ab6bedc8ea1` |
| Preserved old named modes page | 35021548 | `2bc7cc6cca74655ee12e8f34d103a94a4123cc5b2f16f7094c09f6d2f9f23c80` |
| Preserved sight-dot preview | 35004089 | `db2520bb1d249e7b2c79daca3f8fdbac362be6f069a1548b5162152b49eaa950` |

Combined page paths:

- `C:/Users/24908/.codex/scratch/tankforge-gameplay-modes/client/web/dist/tankforge-modes-oplot23-20261011.html`
- `C:/Users/24908/Documents/ChatGPT/tankforge/client/web/dist/tankforge-modes-oplot23-20261011.html`

Only the distinct combined page and exact old-range backup were copied into shared
dist. Existing ordinary range/mode/sight pages were checked before and after copy.
The default ordinary range remains old at this freeze. Because tg-server serves
it by default and old Hello lacks mode version, Root must synchronize the accepted
combined bytes to the default `tankforge-range.html` after final two reviews and
precise main integration. Existing old-mode and sight files, plus
`tankforge-range-pre-modes-20261011.html`, remain fixed. Before that, the existing
server `--page` option can explicitly select the combined page with current data.

Checker invocation before synchronization: `node target/oplot23-task2-verify.mjs`.
After synchronization: `node target/oplot23-task2-verify.mjs --expect-new-default`.
The latter requires exact combined default hash while still checking all old
named pages and old-range backup. Necessary default delivery is not source drift.
Do not use old modes-only checker expecting current embedded data to equal its
older snapshot. No generated HTML is staged or committed.

## Original source/B2 boundary and final scope

448 baseline tracked data/assets (WASM excluded) aggregate:
`e117187c12d8dd16de6ed89d38590ee4d2b415c8b0667a94929d8635da9d8f4c`.
Full path/hash map and ten addition hashes are in the generated manifest. Source
imported/packed model bytes are protected; absent legacy raw GLB is not falsely
hashed. B2 manifests are checked relative to
`C:/Users/24908/.codex/scratch/tankforge-suspension-tracks-v7`:

- Direct increment13/13, manifest
  `5fcabf3594b651eef8faa0dd6328c78b7d52e2b9f0e5d44bd665e542642cb971`.
- Constructor2/2, manifest
  `07f648824112dad05c4fc39f00cf2f48ff10d94a2b9923437ea631a95f99207f`.

The staged whitelist is README, latest combined result MD, old modes MD's pointer,
Oplot plan/checklist and Task1/Task2 receipt documents only. WASM hash is unchanged.
Old accepted mode receipt/root documents are not rewritten. B2 lower physical
contact/traction, physical broken tracks/tyres, exact hitboxes, P2–P5/projectile
deformation/full ammo effects, barrel visuals and V3 multi-hit/death replay remain
unfinished. APS uses API description/shared total, not per-type HEI fuze simulation;
installation/mass/curves are estimates, not full realism or historic installation.

Latest user-facing single combined result:
[`docs/gameplay-oplot23-2026-10-11.md`](../../gameplay-oplot23-2026-10-11.md).
Final independent combined acceptance and integration/push are intentionally still
pending at this delivery freeze.
