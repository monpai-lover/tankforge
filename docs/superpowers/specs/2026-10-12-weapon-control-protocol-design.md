# G control protocol admission repair

This is a required integration repair inside the user's authorized G control and
bug-fix scope. It does not reopen gameplay choices or change ammunition policy.

## Evidence and cause

At `02b958279f7d9c398868723bda91be1a60781f20`, both current peers and genuine
pre-G C2 peers advertise gameplay version 1 and ammo version 1. The current APS
owner contract additionally requires exact State scope/instance and an owner
`aps_pose` ACK before adopting automatic snapshots. The protected historical
C2 handler receipts contain no ACK. The actual live-client mixed-peer probe
fails in both modes: legacy peers are admitted and pose adoption stays pending.
See `target/weapon-control-g-protocol-quality-finding.md` and the legacy probe.

## Selected contract

Increment the existing gameplay rules version to numeric 2 in the JSON, JS and
Rust owners. Preserve every gameplay multiplier, ammo protocol version 1, stock,
scope, reload, joint limits and ACK barrier. All initial and resumed Welcome
messages require the exact current gameplay version and existing ammo version;
reject mismatch through the existing update-needed path before emitting an
accepted Welcome, assigning a token, resolving the open promise or admission.

Current server admission already compares the exact gameplay version. Its
Hello/Create/Join/resume paths must reject old numeric 1 before a held seat is
transferred or its token rotated. No old-peer pose fallback, new lifecycle,
capability boolean or changed stock ledger is introduced. A separate capability
would duplicate the existing negotiation; legacy fallback cannot supply trusted
pose ownership and is therefore unsuitable.

## Acceptance

1. Genuine protected old C2 outputs are rejected by the real current client in
   casual and historical mode, with update feedback and no permanently pending
   admitted life. The historical receipt bytes remain unchanged.
2. Initial `_open` rejects and closes for numeric 1, missing/null, strings,
   fractions and a future version even with valid ammo support; current numeric
   2 succeeds. Existing reconnect profile fences remain intact.
3. Actual current server handlers reject legacy Hello/Create/Join/resume without
   room admission, life/stock mutation, held-seat theft or token rotation.
4. Current/current native receipts retain all 20 exact mandatory source tags and
   all APS handoff/readiness/recovery/quantization and C2 scenarios. Full native
   and Node suites pass; no fixture weakens stock, pose or lifecycle assertions.
5. Original assets/data, old named pages, frozen B2 experiments, shared source
   references and historical C2 receipts remain byte-identical. Source/WASM/page
   publication is a later root-owned step; no browser driving is claimed here.
