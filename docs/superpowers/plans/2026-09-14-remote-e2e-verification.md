# Remote execution verification

This is a separate verification slice from local steering/app-server migration.
Do not treat passing local tests as evidence of remote steering support.

## Environment

- Editor: current uncommitted main, rebuilt native `Codevo Editor QA`.
- Server: `codex@192.168.1.110`, Linux, existing user systemd runner service.
- Runner checkout: `/home/codex/Developer/codevo-runner`, base `14045f7`.
- Provider versions: server Codex 0.148.0 and Claude 2.1.270.
- Disposable project: `live-e2e`. Worktrees remain under
  `/home/codex/Developer/.agent/codevo-runner/workspaces/`.

## Proven live behavior

- Native editor start and Claude continuation preserved provider session
  `441f4c03-9b4c-4c27-9a1f-671c9610faa7`. Continuation
  `0c61e18f-4c3f-42e1-a098-2faef199fb79` recalled `SERVER-MEMORY-8516`
  and wrote it with `codex-ubuntu` into the server worktree.
- Native Codex continuation `035410e4-5f68-4670-8f24-402f10e092c5`
  was started, then the QA editor was quit while the task was running.
  The server completed its foreground wait and created `codex-disconnected.txt`
  with remembered marker `CODEX-SERVER-6284` and `codex-ubuntu`.
  Reopening and reconnecting restored both turns and their persisted work output.
- The fixed SSH bridge uploaded and downloaded an 8,395-byte PNG with identical
  SHA-256. Claude continuation `5f1355e9-465e-44a4-8367-3178ed73f8da`
  read `REMOTE-7349`, white text on green, and recalled the previous marker.
  This proves image transport and provider perception, not the native file chooser.
- After deploying the runner fix, API continuation
  `9c70c6dd-ae9b-4f8d-8cdd-84531b958616` resumed the same Codex session
  and started a real foreground `sleep 120`. Cancelling through the same runner
  API used by the editor removed all six observed provider/tool processes,
  including nested sandbox groups; the runner process remained unchanged.
  This is post-fix API proof, not a repeated native-button proof.

The first Claude wait attempt returned before creating its requested file because
the provider moved the wait into a background command and ended its turn. It is
explicitly not counted as a successful disconnection test.

## Defects found and changes

1. Remote paperclip selection previously produced local paths that the remote
   attachment store rejected. The editor now obtains user-selected image bytes
   through the native HTML file input, retaining exact owner and cancellation
   authority. Local picker behavior is unchanged. Native remote path drag/drop
   remains unsupported with explicit paperclip/paste guidance.
2. Codex exec completion emits an empty success result. The work fold selected
   that empty result and hid the actual final answer inside collapsed work.
   Only nonblank success results now establish that boundary. A remote
   parser-to-presentation regression reproduced the failure before the fix.
3. Native Stop of `a5f1a976-a616-4132-aeac-5bfa77427452` killed the
   primary Codex process but left nested detached sandbox processes alive.
   The runner now tracks Linux descendants using PID/start-time identities,
   freezes discovered parents before traversing their children, and cleans up
   descendants across process groups. Cleanup failures remain visible even if
   cancellation was already persisted. The original leftover test group was
   manually terminated.

The runner source fixes were copied into the existing server checkout, built and
tested, and the systemd service restarted. These are uncommitted source changes
in both local and server runner checkouts; no release or push was performed.
Backups of the two replaced production files are under
`/home/codex/Developer/.agent/runner-e2e-backup/`.

## Automated validation

- Editor: 23,982 tests in 1,579 files passed with coverage. Lines 89.85%,
  statements 88.55%, branches 83.19%, functions 93.18%.
- Editor check, lint, exhaustive-deps, hotspot budget, formatting, changed-file
  formatting, production/native debug build and diff checks passed.
- No new Rust changes in this slice; the preceding complete Rust gates are
  recorded in `2026-09-14-steering-handoff.md`.
- Runner on Linux: all 164 tests passed, none skipped, plus type checking.
  Regression coverage includes detached grandchildren, cancellation, timeout,
  parent exit, unrelated-process survival and cleanup failure persistence.
- Both editor fixes and the runner fix received independent read-only reviews.

## Remaining proof and limitations

- Native image selection is not yet proven: macOS previewed the correct PNG,
  but Open remained disabled. Later native automation calls timed out, including
  after resetting the tool connection. Do not claim this E2E route passed.
- Rebuilt native final-answer visibility and native Stop after the runner fix
  still need UI confirmation after native automation becomes available.
- Remote active steering, remote session import, and automatic fresh-session
  fallback on missing remote provider history are not implemented by this slice.
- Periodic process-tree observation does not guarantee containment of arbitrary
  rapid daemonization between observations. Strong universal containment needs
  a per-task cgroup design; do not claim that guarantee from these tests.

Detailed own-test evidence and logs are outside the repository at
`/Users/matusmockor/.codex/task-logs/remote-e2e/`.
