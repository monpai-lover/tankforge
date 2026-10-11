# Gameplay Task4 delivery freeze

2026-10-11, isolated worktree
`C:/Users/24908/.codex/scratch/tankforge-gameplay-modes`, branch
`codex/casual-historical-modes`. Runtime source remains
`0cbcc35c5935fe265cc5437e85dda064b700a760`; no Task4 runtime changes. Tasks1–3
have accepted independent SPEC then QUALITY reviews. The build/documentation
delivery is ready for fresh integrated SPEC → QUALITY; final overall acceptance,
integration and public push remain pending. No browser or production publish.

## Fresh receipt, artifact and focused checks

1. Set absolute `TG_GAMEPLAY_NETWORK_RECEIPT` to this worktree's
   `target/gameplay-network.json`. Run actual native owner
   `cargo test -p tg-server browser_protocol_receipt_from_actual_handlers --lib`:
   **1 PASS / 0 FAIL / 0 ignored / exit0**. The receipt includes the ten mandatory
   raw source/config tags listed below, not only serialized protocol constructors.
2. Fresh six-suite Node rules/performance/session/runtime/HUD/network group:
   **62 PASS / 0 FAIL / 0 SKIP / exit0**. After release/web builds, rerun those
   six suites plus kinetic-impact against the rebuilt asset:
   **72 PASS / 0 FAIL / 0 SKIP / exit0**, `target/modes-task4-artifact-tests.tap`.
   HTML's serialized inputs exactly equal `loadData()` inputs used by these
   actual runtime/HUD tests; kinetic-impact exercises the actual WASM asset.
3. Missing receipt and a separate receipt with stale config bytes both correctly
   fail the real `gameplay-network.test.mjs` at its mandatory assertions, **exit1**.
   The original receipt and sources remain intact. Negative-probe driver exits0,
   `target/modes-task4-negative.log`.
4. `cargo build -p tg-design-wasm --release --target wasm32-unknown-unknown`:
   **exit0**, `target/modes-task4-wasm-build.log`. Then
   `node client/web/build.mjs`: **exit0**, `target/modes-task4-web-build.log`;
   explicit log guard confirms no committed-core fallback.
5. Offline source/artifact checker: **exit0**. It compares every mandatory raw
   receipt tag, strict rule registry values, serialized source data, built mode
   and lobby controls, decoded compatibility error, and bundle syntax. It parses
   the bundles without executing the game or opening a browser. Every output
   has exactly one `tf-data` and one `designCore`; decoded core equals release
   target and committed asset byte-for-byte.
6. `git diff --check`: **exit0** before staging. No runtime, data, tolerance,
   B2, stack or target-directory change. The precise staged whitelist is README,
   result/Task3/Task4/plan documents and the intentionally matching WASM only.

Native environment was `RUSTUP_HOME=C:/Users/24908/.codex/scratch/tankforge-rust/rustup`,
`CARGO_HOME=.../cargo`, with `.../cargo/bin` on PATH. No `CARGO_TARGET_DIR` or
stack override was set. Esbuild used
`C:/Users/24908/Documents/ChatGPT/tankforge/client/web/node_modules/@esbuild/win32-x64/esbuild.exe`.
Builds were serial; native lane is released at this delivery freeze.

## Full-suite evidence on the same frozen runtime

Root already ran full Node and native workspace checks before delegation; this
Task4 consumed and independently verified those retained summaries and log hashes
instead of repeating unchanged-source suites. Fresh targeted checks above follow
the regenerated native receipt and matching artifact.

| Evidence | Result | SHA-256 |
|---|---|---|
| `target/modes-full-node-fixed.tap` | 549 PASS, 0 FAIL, 0 SKIP | `9ff2e3d6d29da72686f7d911c050eeb8a54eed223fcc693fe92d97ba240bb4da` |
| `target/modes-full-native.log` | 364 PASS, 0 FAIL, 4 existing ignored | `d6bf872e3f9a11c3b2975b974b008d7ddaa2697dfa414a899d4e18da9702a9ed` |
| `target/modes-task4-artifact-tests.tap` | Fresh 72 PASS, 0 FAIL, 0 SKIP | `352bc94999334e86ca8a3d1a2bf32fd8285d5db5ee39aeae94ed7365b2b35ccd` |
| `target/gameplay-network.json` | Actual server-handler receipt, ten current tags | `97a0ad61fd1b782c80aba36fa56e04fcf504d11ce4620a4008364903e71f3e2c` |
| `target/modes-task4-source-build-receipt.json` | Full guards/page/core manifest | `243b27da9ac82f155b0c9389f4ad348605508354cc5fd54a690f4bbae1baac33` |

The four ignored tests are pre-existing diagnostic helpers:
`tg-design::tests::print_sample_summary` and `tg-missile::tests::{debug_trace_rocket,
debug_trace_single_tow,debug_two_sides}`. No gameplay bridge/runtime test is skipped.
Missing/stale receipt remains a hard failure. Logs and generated manifests/pages
stay in ignored target/dist directories and are not staged.

## Receipt source identities

Every raw tag was compared with its actual file after native generation; JS and
native Rust consume the original registry file. The built JS registry's exact
version, IDs, factors and marker booleans equal this source. This does not claim
the designer WASM itself owns network policy; it is the separately source-matched
designer/physics/combat core used by the page.

| File | SHA-256 |
|---|---|
| `Cargo.toml` | `834d4c1026720239add504f72a1f50939a8c0b0e9ecd1471b8820e0ad454d643` |
| `config/gameplay-modes.json` | `fe506e2994589a49afa9372dd1807d3362d70bbb5bc04bfec2654b90905aba66` |
| `crates/gameplay/Cargo.toml` | `2637674a8fb2a87895e204faadab9bc40210d1f273ae98dd22172c5cee30c486` |
| `crates/gameplay/src/lib.rs` | `a35877f899d6e4c6b01f4039004478b88d9a69c3774fdf8a4711bba3cddd5e3e` |
| `crates/server/Cargo.toml` | `bd04141d8f29da4bbabb997f9b51a7e4b054e9ecae801410eb3d7d37ac0c751d` |
| `crates/server/src/gameplay.rs` | `b5760a5923dcd9a4b49a57afb7b120cc0fdc7fb42e467e8fbcbd98dad407bafa` |
| `crates/server/src/gameplay_tests.rs` | `1b1a888e6d88a4205f1867dae75a9ce2f03168ac504001284424ecb419af0c4d` |
| `crates/server/src/lobby.rs` | `6c8fcd2e09b206bce7766c8a61a7c584b91d93df3636428d2fa039d2ded49fe0` |
| `crates/server/src/missiles.rs` | `e696381bfb79407cdabb4b62e09c563ea84441990136460bb3c7c09f46396724` |
| `crates/server/src/server.rs` | `636594796be9e4dfe08d05cd53e0522d4c891410173bb4bfa06df536d00d99c9` |

## Byte-matched delivery and preserved pages

| Output | Bytes | SHA-256 |
|---|---:|---|
| Release target `target/wasm32-unknown-unknown/release/tg_design_wasm.wasm`, asset `client/web/assets/tg_design.wasm`, each decoded `designCore` | 1643249 | `173c6c970f1d51ddcd86e819a1b4bc80b31af4f277a41466045cd7e68de08fd7` |
| Scratch `client/web/dist/artifact.html` | 35021359 | `d1b18d725cddd84ee336425229398117b93263b6b77e772cced67fd7fb0fa30f` |
| Scratch range output, scratch named modes page, exact shared named copy | 35021548 | `2bc7cc6cca74655ee12e8f34d103a94a4123cc5b2f16f7094c09f6d2f9f23c80` |
| Preserved shared `tankforge-range.html` | 34840387 | `95130c2a34dbb8bb8bfcf1c01662f2769f951b517e592ef8db312ab6bedc8ea1` |
| Preserved shared `tankforge-sight-dot-preview-20261011.html` | 35004089 | `db2520bb1d249e7b2c79daca3f8fdbac362be6f069a1548b5162152b49eaa950` |

Named copies:

- `C:/Users/24908/.codex/scratch/tankforge-gameplay-modes/client/web/dist/tankforge-gameplay-modes-20261011.html`
- `C:/Users/24908/Documents/ChatGPT/tankforge/client/web/dist/tankforge-gameplay-modes-20261011.html`

The two old shared pages were hashed before copying and rechecked afterward.
Only the new distinct named page was copied into the shared dist directory.
The `db2520…aa950` identity specifically belongs to the sight-dot preview, not
the ordinary range. No generated HTML is committed.

## Original sources and frozen B2 boundary

`git diff --exit-code c5350a4 -- data client/web/assets
':(exclude)client/web/assets/tg_design.wasm'` passes. All **448** tracked paths
under those owners have an empty baseline diff: original vehicle, engine, weapon,
armor, projectile, imported and packed model/assets included. The intentionally
rebuilt WASM is the sole exception. Sorted path → lowercase SHA-256 hashes,
encoded as compact JSON, have aggregate
`e117187c12d8dd16de6ed89d38590ee4d2b415c8b0667a94929d8635da9d8f4c`;
the full 448-entry map is in the generated source/build manifest above.

Independently read the frozen manifests and compare their paths against
`C:/Users/24908/.codex/scratch/tankforge-suspension-tracks-v7`:

- `tankforge-b2-direct-increment-freeze-hashes.json`: **13/13 unchanged**;
  manifest SHA-256 `5fcabf3594b651eef8faa0dd6328c78b7d52e2b9f0e5d44bd665e542642cb971`.
- `tankforge-b2-constructor-freeze-hashes.json`: **2/2 unchanged**;
  manifest SHA-256 `07f648824112dad05c4fc39f00cf2f48ff10d94a2b9923437ea631a95f99207f`.

These are preservation checks, not acceptance of B2. No B2 sources/tests were
copied or staged, no physical threshold changed, and the adjacent `tank` reference
project was not edited. B2 lower contact/loaded traction, physical broken tracks
and tyres, exact hitboxes, P2–P5, barrel visuals and V3 multi-hit death replay
remain unfinished. The separately approved six-barrel Oplot23 plan is not yet
implemented. Room coarse anti-abuse and historical identity are not full native
authority or a historical fleet-data audit.

User-facing behavior and reproduction steps:
[`docs/gameplay-modes-2026-10-11.md`](../../gameplay-modes-2026-10-11.md).
