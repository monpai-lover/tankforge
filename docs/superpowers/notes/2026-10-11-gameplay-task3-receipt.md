# Gameplay Task3 acceptance

TankForge isolated worktree, 2026-10-11. Room-rule implementation `567593c`;
final runtime repair `0cbcc35c5935fe265cc5437e85dda064b700a760`. Fresh SPEC
PASS (39 tests) then fresh QUALITY APPROVE (29 tests), as accepted by Root.
Task1/2 acceptance remains in the separate receipts. Overall delivery review
and integration are still pending.

Actual server handlers and socket dispatch cover numeric rules version1,
strict Hello/Create/join/start/resume/respawn profiles, immutable room ownership,
two differing local preferences, native room missile/rocket/APS timing and
existing coarse anti-abuse allowances. Browser owner probes cover the actual
NetClient → main/session/selection → HUD path, legal fire, reconnect/respawn,
same-profile weapon/ammunition preservation and leave-to-local restoration.

Review found expired-seat reconnect retaining an old browser `battleProfile`,
and an online Start waiting on a map still starting after the room was left.
`0cbcc35` retires stale profiles and associates pending map callbacks with the
current sortie. Fresh SPEC then QUALITY accepted those repairs. No source
data/models, physical thresholds or B2 content changed.

Root's complete tests on this frozen runtime are recorded in
`target/modes-full-node-fixed.tap`: 549 PASS, 0 FAIL, 0 SKIP, and
`target/modes-full-native.log`: 364 PASS, 0 FAIL, 4 existing ignored diagnostic
tests. Task4 regenerates and verifies the mandatory source-tagged native
receipt before its fresh focused Node bridge checks.

Scope remains room policy plus the existing coarse abuse checks. It does not
establish full movement/reload authority, server spotting isolation, a historical
fleet-data audit, B2 acceptance, or the planned Oplot23 variant.
