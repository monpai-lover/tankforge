# Oplot23 combined delivery: final Root acceptance

2026-10-11. Project: TankForge. Runtime/data/tool snapshot remains
`c361d0c320081f815f99f9bdea6ca21c84848695`; combined delivery freeze is
`e4dbe0fb8d9f7a6e46875e2fd973b35675195e9c`. Final docs-only protocol correction
and independently accepted freeze is `ff9637321f4b9a778642c8e9004b975ad4b8e6f5`.

## Independent review

- Fresh Task2 SPEC PASS at e4dbe0f: verifier exit0; 33 post-build tests pass;
  missing/stale/omitted receipt negatives correctly fail; full retained groups
  and exact unchanged inputs checked.
- Fresh Task2 QUALITY identified one P3 documentation error: protocol summary
  conflated version-only Hello/Welcome with room mode fields and error messages.
  Root independently confirmed it against actual owners; original delivery writer
  corrected only that paragraph at ff96373.
- Original SPEC re-review PASS, then original QUALITY re-review APPROVE at ff96373.
  Both confirmed no remaining finding. No runtime, artifact or test change in repair.
- Root independently inspected both commit diffs and ran the offline verifier.
  Source/WASM/page identity and all frozen guards passed.

## Main integration and publication

Remote main was `145e327da45a1bca56fc7a71f9a93874e8be715f`, matching local main.
Integration used a fast-forward to the accepted ff96373 source; no forced push,
rebase, wholesale staging, stash or reset. The one untracked research document
`docs/tracks-v7-research-2026-10-11.md` initially prevented integration. Its Git
blob was byte-identical to the incoming tracked document:
`9fe18eef9aabee8d483b2a6f089202cbc5551b08`.

Root moved only that explicit file to a preserved backup, completed the
fast-forward, then confirmed the incoming document had the exact original hash:
`fc76b71eda233085fd193a90bd1b0aceee3e9dc3d78ff85698334bb27777945c`.
Backup: `C:/Users/24908/.codex/scratch/tankforge-tracks-v7-research-preserved-ff96373.md`.
Main was clean afterward. The unrelated dirty B2 worktree remained untouched.

After verifying the existing old-range backup, Root copied the accepted named
combined page to the shared default `client/web/dist/tankforge-range.html`.
Both default and named page are 35,055,861 bytes with SHA-256
`365b79764d17821a8f99ee297af9905204414299c3132ad1104936ff4474e3ad`.
The exact old-range backup, old modes page and sight-dot preview remain preserved.

Fresh Root post-integration checks:

- Main checkout: actual variant 9 + mandatory bridge 14 + WASM kinetic 10 =
  **33 PASS / 0 FAIL / 0 SKIP**, exit0; log `target/oplot23-main-integration.tap`.
  The absolute actual-handler receipt path points to the source-identical accepted
  worktree receipt; the real bridge suite verifies all current raw tags.
- `node target/oplot23-task2-verify.mjs --expect-new-default`: exit0; default
  matches accepted bytes, target/asset/embedded core match, 448 original guards
  and external B2 13+2 guards match. Log `target/oplot23-root-integrated-verify.log`.
- Retained full inputs remain unchanged: **558 Node PASS / 0 FAIL / 0 SKIP**;
  **366 native PASS / 0 FAIL / 4 existing ignored**. No redundant broad rerun.
- Whitespace/scope checks passed. Source push succeeded:
  `145e327..ff96373 main -> main`; `git ls-remote` independently confirmed
  `ff9637321f4b9a778642c8e9004b975ad4b8e6f5` on remote main.

Public repository: <https://github.com/monpai-lover/tankforge>.
This final status update changes documentation only and follows the source push.
Generated HTML, build logs and target manifests are local artifacts, not staged.

## Accepted scope and limits

Accepted: single-player and immutable online casual/historical rules, historical
enemy auxiliary-marker display policy, and an independent hypothetical six-barrel
23 mm Oplot variant preserving the original 14.5 mm vehicle. Installation,
ammunition dimensions/curves and inherited vehicle mass remain documented estimates;
APS uses the existing API descriptor/shared total rounds, not per-type HEI fuzes.

B2 lower contacts/traction, physical track/tire damage, exact hitboxes, P2–P5,
barrel destruction visuals and V3 multi-hit/lethal-victim replay remain pending.
CPU geometry and build checks do not constitute rendered visual acceptance.
Earlier automatic approval review rejected browser verification; the rejection
reason was not retained. No browser/HTTP/CDP/Playwright workaround or production
deployment occurred.
