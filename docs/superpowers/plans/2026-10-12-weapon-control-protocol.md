# Weapon control protocol repair implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. One implementation writer, then fresh SPEC and QUALITY reviewers. Root owns commit, build adoption and publication.

**Goal:** Reject pre-G peers before they can enter an APS ownership contract they cannot complete.

**Architecture:** Use the existing exact gameplay-version negotiation, upgrading its three owners to numeric 2. Make initial Welcome validation as strict as reconnect; retain the pose ACK fence and ammo protocol 1.

**Tech Stack:** JavaScript/Node, Rust workspace, release WASM, actual server handler receipts.

## Task 7: Exact-version admission and fixture migration

**Runtime files:**
- `config/gameplay-modes.json`: version only; no multiplier changes.
- `client/web/src/game/gameplayRules.js`: `GAMEPLAY_RULES_VERSION` only.
- `crates/gameplay/src/lib.rs`: constant and focused config/version tests.
- `client/web/src/game/net.js`: initial/resumed Welcome validation only.

**Test files:**
- `client/web/test/gameplay-network.test.mjs`: initial open/rejection, current Welcome and strict profile scenarios.
- `client/web/test/gameplay-rules.test.mjs`, `gameplay-session.test.mjs`, `gameplay-runtime.test.mjs`, `live-network-rig.mjs`, `range-vehicles.test.mjs`, `oplot23-variant.test.mjs`: migrate only positive version inputs/expectations and meaningful invalid-version cases if present.
- `crates/server/src/gameplay_tests.rs`, `ammo_tests.rs`, the test module of `lobby.rs`, and `crates/server/tests/socket.rs`: actual handlers/sockets, current positive version inputs, old 1/future/malformed negative cases, strict serialized output.

- [ ] Add meaningful REDs before changing runtime. With a valid ammo header, feed real NetClient `_open` a Welcome with numeric gameplay 1 and assert rejection, closed socket, no accepted welcome/token/admitted battle. Add actual native old-1 Hello/Create/Join/resume rejections; snapshot held token/away/life/stock before rejected resume. Preserve the existing initial-open positive case and all old assertions. Record behavioural failures rather than an import failure.

Client test implementation uses the existing `socket()` helper and packet owner:

```js
const Socket=socket(), net=new NetClient(), accepted=[], errors=[];
net.on('welcome',m=>accepted.push(m));net.on('error',m=>errors.push(m.msg));
const opening=net.connect('ws://fixture/ws','local').catch(e=>e);
const ws=Socket.last;ws.onopen();
ws.receive({...packet('welcome_a',receipt.a,'welcome'),gameplay_rules_version:1});
const result=await opening;
assert.ok(result instanceof Error);assert.match(result.message,/更新/);
assert.equal(ws.readyState,3);assert.equal(accepted.length,0);
assert.equal(net.gameplaySupported,false);assert.equal(net.token,null);
net.close();
```

Check the real constructor's empty-token representation before using the final
token assertion; assert unchanged token rather than invent a new lifecycle.

- [ ] Apply the minimum runtime repair:

```js
export const GAMEPLAY_RULES_VERSION = 2;
// In NetClient._receive, removing only the conditional battleProfile gate:
if (msg.t === 'welcome' && msg.gameplay_rules_version !== GAMEPLAY_RULES_VERSION) {
  this.gameplaySupported = false;
  return this._rejectGameplay();
}
```

```rust
pub const GAMEPLAY_RULES_VERSION: u32 = 2;
```

Set JSON `version` to 2. Keep ammo 1. Do not change `_rejectGameplay` semantics
for other messages without a demonstrated failure and root discussion.

- [ ] Migrate positive fixtures to the current exported constant. Negative
  lists explicitly include numeric 1 and numeric current+1, missing/null,
  strings and wrong types. Do not blindly replace `1`: battle/life, ammo version,
  sequence and multiplier values remain unchanged. In native invalid-mode
  cases use the current version so invalid mode remains the reason under test.
  Keep local gameplay preference storage keys unchanged.
- [ ] Run focused Node/client RED then GREEN and native `cargo test -p tg-server
  --lib` while generating only the two current weapon-control receipt paths.
  No parallel Cargo, target-directory or stack override. Keep every source tag
  and existing native receipt scenario; do not touch protected old receipts.
- [ ] Sequentially run `cargo test --workspace`, `cargo check --workspace`,
  `cargo build -p tg-design-wasm --target wasm32-unknown-unknown --release`.
  Full Node suite uses the two new receipts and source-built WASM. Commands:
  `node --test client/web/test/*.test.mjs`,
  `node --test target/weapon-control-legacy-protocol-probe.mjs`,
  `node target/weapon-control-verify.mjs --guards-only`, `git diff --check`.
- [ ] Self-review exact diff and preservation. Write handoff and candidate hashes
  under `target/weapon-control-task7-*`, freeze all candidate bytes and release
  native lane. Do not stage, commit, copy WASM to assets, build pages or publish.
- [ ] Root dispatches fresh SPEC then QUALITY against this contract, independently
  runs verification, and commits only accepted exact paths. Required failures
  return to the same writer before review resumes.

## Environment and protected boundaries

Use the existing worktree `C:/Users/24908/.codex/scratch/tankforge-gameplay-modes`.
The Rust runtime is under `C:/Users/24908/.codex/scratch/tankforge-rust/{rustup,cargo}`.
Set `TG_GAMEPLAY_NETWORK_RECEIPT` to this worktree's
`target/weapon-control-gameplay-network.json`, `TG_AMMO_RESUPPLY_RECEIPT` to
`target/weapon-control-ammo-network.json`, and `TG_TEST_WASM` to its release WASM.
Root-owned `docs/user-request-status-2026-10-11.md` is already dirty. Leave it.
No data/schema/models, old pages, B2 tree, shared reference files, historical
receipts or default-page edits belong in this task. Browser regression may be
inspected but no browser automation execution is authorized by this plan.
