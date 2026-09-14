# Handoff: agent turn steering and Codex app-server migration

## Continuation state — 2026-09-14

The implementation is integrated in the dirty working tree on `main`, HEAD
`6fe19dc7`. Preserve all existing changes. No commit, push, or release is authorized
for this continuation. The old snapshot describing unfinished S1–S4 and Tasks
A–G is superseded by this document.

Read `CLAUDE.md` first, then the steering and app-server specs and plans in
`docs/superpowers/`. The lead owns final integration and the truth about completion.
Implementation slices and the latest Stop changes have separate clean reviews.
Final repository gates and rebuilt native verification passed after the
rollout-loss fallback repair. Actual CLI upgrade was unavailable; distinguish
automated update admission from a live upgrade.

## Implemented behavior

- Claude retains bounded serialized stdin with an initial-frame gate. Stop and
  terminal settlement close admission without waiting for an in-flight writer;
  shutdown paths close input before signalling. Workspace and thread ownership
  are validated for every steer.
- Codex uses the app-server transport with typed bounded protocol handling,
  workspace/provider-generation host ownership, retained directory identity,
  startup and shutdown cleanup, and authority checks around asynchronous work.
  Legacy exec remains a separate transport. Host lifetime and turn lifetime are
  distinct.
- The existing composer and thread design are retained. Enter steers a running
  eligible local turn; Shift+Enter adds a newline. Stop remains available, launch
  controls are read-only while steering, and accepted messages appear as ordinary
  bubbles in the same turn. App-server subagents have collapsible groups inside
  the existing output stream.
- Application admission, IPC, event projection, persistence, and settings are
  integrated. Persisted turns record the actual Codex transport. Settings default
  to app-server and validate the bounded configuration. Token usage retains the
  distinction between last-turn and cumulative thread usage.
- Rejected `turn/start` now unsubscribes the newly created or resumed thread before
  returning the original failure; unsuccessful cleanup retires the host.
- Remote runner steering is outside this slice. No Linux runner deployment or
  changes to its separate repository are part of this continuation.

Deliberate decisions reflected in the updated specs:

- `notSteerable` uses a local bounded FIFO, submitting an ordinary follow-up only
  after terminal settlement. There is no server prequeue/adoption implementation.
- Refused attachment submissions retain exact-owner claims and staged bytes for
  retry. Cross-thread claims are rejected.
- Closing admission cannot retract bytes already being written. A completed write
  is not automatically replayed.
- The encoded frame budget includes base64 expansion of the 40 MiB raw image
  budget, worst-case prompt escaping, and framing overhead.

## Verification already obtained

After the PC restart, frontend verification passed: type checking, lint with zero
warnings, exhaustive-deps at 0/0, build, hotspot checks, formatting checks, and
`git diff --check` at the checked snapshot. Full frontend coverage passed **23,972
tests in 1,578 files**. Coverage: statements 88.58%, branches 83.21%, functions
93.23%, lines 89.88%. These are frontend results, not proof of native cleanup.

Final Rust validation passed: `cargo check --all-targets`, **3,565 library tests**,
**1,193 integration tests**, Clippy with warnings denied, and formatting. Two
library tests are explicitly ignored. The fallback repair also received a clean
independent review. Exact final native checks are recorded below.

Persistent logs (outside the repository):

`/Users/matusmockor/.codex/task-logs/steering-takeover/`

- `frontend-coverage-final.log` and `frontend-build-final.log`
- `rust-check-final.log`, `rust-lib-final.log`, and `rust-tests-final.log`
- `clippy-final.log` and `rustfmt-final.log`
- `clippy.log` — historical failed run
- `codex-final.log` — 116 passing focused tests after the Stop failure repair

The `*-final` logs contain the completed passing runs after the last code change.

Earlier `/tmp` logs disappeared during the PC restart. Do not cite them as current
artifacts or assume surviving logs include newer source changes.

## Native QA evidence and discovered Stop defect

QA app:

`/Users/matusmockor/Developer/editor/src-tauri/target/debug/bundle/macos/Codevo Editor QA.app`

Bundle identifier: `dev.mockor.editor.qa`. It is a separate debug build, not a
release. The final build including the fallback repair passed; see
`native-build-final.log`. Native fallback and its follow-up passed in that build.

Disposable QA repository:

`/Users/matusmockor/Developer/.agent/codevo-steering-qa`

Observed in the native app and saved QA history:

- Codex accepted a mid-turn steer and wrote `codex-native.txt` with
  `STEERED-9427`. The turn had one result and one steering `userMessage`.
- A Codex follow-up recalled that marker without reading files and wrote
  `codex-resume.txt`. It retained the same provider session. Two subagent groups
  were displayed and expanded within the thread.
- Claude accepted a mid-turn steer in the same turn and wrote
  `claude-native.txt` with `CLAUDE-STEERED-9427`. The ordinary bubble and completed
  output were visible. A six-second follow-up (`agt-mu1cj3hf-577b`) recalled
  the same marker without reading files and wrote `claude-resume.txt`, with one
  result and the same provider session. No QA-owned child processes remained
  after idle completion.
- Restarting the QA app restored both histories, the steering bubbles, and the
  expanded Codex subagent group with its own usage and result.
- The first real Codex Stop check **failed process cleanup**: the UI became stopped
  while its `sleep 60` tool process remained alive. UI settlement alone was not
  accepted as success.

The verified Stop repair uses exact-thread app-server background-terminal APIs:
`thread/backgroundTerminals/clean`, then bounded
`thread/backgroundTerminals/list` verification, followed by unsubscribe. It covers
captured root and known attached subagent threads under a total cleanup deadline.
Experimental API negotiation is required. Normal completion must retain legitimate
background development servers. `thread/unsubscribe` alone does not prove tool
termination. Failure reporting now retains cleanup errors across repeated and concurrent
reaping so unconfirmed cleanup cannot be silently presented as successful Stop.

QA saved histories are under:

`/Users/matusmockor/Library/Application Support/dev.mockor.editor.qa/agent-threads/de9ef00dd970fc21/`

Only inspect these self-created QA histories for this check:

- Codex local thread `agt-mu1c5jwf-2476`, provider session
  `01a0a04f-8988-78f2-b370-1f54547c6e0a`.
- Claude local thread `agt-mu1ccqzi-78c8`, provider session
  `accfd300-dfea-43a9-9008-79599e7b6ea6`. Its file is in the QA repository worktree
  `.worktrees/agt-mu1ccqzi-78c8/`.

## Final native cleanup proof

The rebuilt app passed the repeated Stop check. Turn `agt-mu1cv2pu-8dd5`
ran `sleep 60` as PID 1102 under QA-owned host 245. Stop settled in roughly one
second and the process no longer existed well before 60 seconds elapsed. The
host remained available, as designed. The before/after process snapshots are
`native-stop-before.json` and `native-stop-after.json` in the persistent log folder.

Closing the app during another `sleep 60` (turn `agt-mu1cvzdw-e151`, PID 1454)
also passed: the QA app, app-server, terminal process, and all captured helper
processes were gone. See `native-quit-before.json` and `native-quit-after.json`.
After reopening, the interrupted turn and previous history were retained.

Known pre-existing presentation issue found during QA: an existing worktree
thread footer can display Local checkout after restart. Its persisted target and
follow-up execution path remain the exact worktree. The same display computation
exists in HEAD; it was not changed as part of steering.

## Further native evidence and fallback repair

- Read-only mode blocked a real `apply_patch` attempt. The provider rollout
  recorded an explicit denial and the target file was absent.
- Switching A → B → A during 20 seconds of output showed no A output in B;
  returning to A showed `PROJECT-A-ONLY`.
- Killing the live host produced a failed task. A subsequent exec-transport turn
  resumed and recalled the same marker; app-server was restored as the default.
- Rollout-loss fallback exposed a session adoption defect: the frontend retained
  the old provider session. The repair adds a strict transient `sessionFallback`
  envelope carrying old/new session IDs, validated against exact authority in Rust
  and TypeScript. Independent review and rebuilt native fallback plus the next
  turn passed.

## Final verification

All applicable automated gates passed after the fallback repair:

- Frontend: 23,972 tests in 1,578 files; coverage lines 89.88%, statements 88.58%,
  branches 83.21%, functions 93.23%.
- Rust: 3,565 library tests (two explicitly ignored) and 1,193 integration tests.
- Type checking, lint, exhaustive-deps, hotspots, formatting, build, Clippy with
  warnings denied, Rust formatting, and `git diff --check` passed.
- The final native debug app build passed (`native-build-final.log`).

The final fallback test `agt-mu1dl0e2-dad1` adopted and persisted session
`01a0a074-29c2-74f1-b6c8-10be6cd7e57d`. Next turn `agt-mu1dlksf-a470` recalled
`FALLBACK-REAL-9427` without tools, keeping that new session and emitting no
additional fallback warning. The original QA rollout was restored. See
`native-fallback-session.json` in the log directory.

Idle host PID 5647 was absent after 376 seconds of observed inactivity; the next
native request resumed the original conversation and returned `STEERED-9427`.
See `native-idle-start.json` and `native-idle-after.json`. Earlier live read-only,
project switching, exec resume, Stop, shutdown, and host-failure checks are recorded
above. Actual CLI upgrade was not exercised: the installed version was current.
Automated update-admission tests passed, but are not a live upgrade claim.

Implementation and verification are complete for this slice. Preserve uncommitted
work. No release was produced; commit, push, and publishing remain user decisions.
