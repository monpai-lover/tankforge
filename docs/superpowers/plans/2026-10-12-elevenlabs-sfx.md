# ElevenLabs Offline SFX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare a bounded local authoring CLI and the eleven existing game sound prompts without generating or installing audio during preparation.

**Architecture:** The CLI fixes its manifest and authoring output root, defaults to dry-run, and passes a validated plan to isolated generation helpers. Production helpers decrypt the existing DPAPI credential only for explicitly selected generation, call one fixed HTTPS endpoint per take, write a durable receipt before each attempt, and publish only MP3-shaped audio through a same-directory atomic move. Offline tests inject synthetic credentials and responses without touching the real key or network.

**Tech Stack:** Windows PowerShell 5.1, .NET HttpClient/SecureString/DPAPI, JSON; no added dependencies.

---

Session authorization covers preparation and implementation; root must approve a specific batch before any billable API call. Runtime `audio.js`, `build.mjs`, shared main and gameplay worktrees are outside this change. No commit or push during this preparation lane.

## Task 1: Isolate and define the contract

**Files:** `tools/audio/elevenlabs-local.ps1`, `docs/elevenlabs-local-setup.md`, `client/web/src/game/audio.js`, `client/web/build.mjs` (read only).

- [x] Create `codex/elevenlabs-sfx-prepare` at the requested scratch path from shared main `0f5dc77`.
- [x] Read the setup helper and current runtime slot / embedding contracts.
- [x] Confirm official convert parameters: `text`, `duration_seconds`, `loop`, `prompt_influence`, `model_id`, MP3 output format, and `xi-api-key`.

## Task 2: Add offline safety tests before the implementation

**Create:** `tools/audio/elevenlabs-sfx.test.ps1`.

- [x] Add a missing-core assertion and run it: `FAIL: generator core is missing`, exit 1.
- [x] Define injected credential / transport tests covering zero credential / HTTP dry-run, caller budgets, manifest and path rejection, no overwrite, durable uncertain-attempt receipts, MP3 publication, and no synthetic-secret output.
- [x] Reproduce malformed output shape and non-finite budget failures before fixing those boundaries.

Run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\audio\elevenlabs-sfx.test.ps1
```

Expected final result: all offline tests pass; real HTTP calls 0.

## Task 3: Implement the manifest and generator

**Create:** `tools/audio/sfx-manifest.json`, `tools/audio/elevenlabs-sfx-core.ps1`, `tools/audio/elevenlabs-sfx.ps1`.

- [x] Provide one take for each exact runtime slot: 24 seconds total; loop only engine / track.
- [x] Default CLI to a full dry-run; expose only batch ID, selected slots / takes, generation switch and request / duration budgets.
- [x] Fix provider endpoint and output format; no credential parameter, environment override, redirects, account query or automatic retry.
- [x] Validate all destinations before credentials; reject linked ancestors and existing takes / receipts.
- [x] Create and flush the attempt receipt before calling transport; preserve it on unknown outcomes.
- [x] Validate 200 / MIME / complete MP3 frames; write audio atomically and store provider provenance without license assertions.
- [x] Convert local, transport, output-shape and filesystem failures to coarse safe results.

## Task 4: Document and verify the concrete pilot

**Create:** `docs/elevenlabs-sfx-generation.md`. **Modify:** `.gitignore` only for the authoring output folder.

- [x] Document exact dry-run and one-request / two-second pilot commands, receipt recovery rules, audition criteria and official terms references.
- [x] Keep authoring outputs outside `client/web/assets/sfx`; do not change the runtime or perform a build.
- [x] Run fresh offline tests, CLI dry-runs, PowerShell parse checks, and `git diff --check`.
- [x] Obtain independent read-only code review and resolve concrete defects. Review found no must-fix defects; no live API / credential / audio-quality validation was performed.
- [x] Report source paths, verification evidence and the ready `shot_medium / take 1 / 2 seconds` pilot proposal to root; do not generate it automatically.

Verification: 15 offline tests passed; real HTTP calls 0. Three PowerShell files parsed with zero errors. Full dry-run returned 11 requests / 24 seconds; pilot dry-run returned 1 request / 2 seconds; both returned `generationRequests=0`. Runtime sources match `0f5dc77`. No authoring-output folder, commit, push, build or generation was created during preparation.
