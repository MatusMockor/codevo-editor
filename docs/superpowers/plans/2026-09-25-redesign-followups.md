# Redesign follow-ups (collected during P2-P6)

Items that were reviewed and knowingly deferred. Handle in P10 or a dedicated slice.

## Workspace registration (owner-scoped admissions)
- Adoption that never settles (~1.85 s of backend faults) leaves the tab on the old token; closing it then returns staleOwner, which surfaces as runtime-stop-incomplete on every attempt.
- A rollback that is dropped because the compensation queue (16) is full is never retried. If that admission is newer and on the same path, the owning tab can't close until restart.
- The post-await adopt re-check can reject after the backend already adopted. That rolls back the new token while the tab holds the old one. It only tears the workspace down if a second same-root open is also abandoned.
- When an agent lease release returns Releasing, the lease is restored even though the workspace is about to disappear. The next release clears it.
- The gateway's single cleanupTransportReserved slot makes a concurrent unregister fail immediately instead of queueing.
- Poisoned-lock recovery in UnpublishedAdmission::drop has no deterministic test.
- dispose_workspace_root (single-active switch) still stops runtimes without consulting other owners.
- The degraded ignore-rules state (ignoreRules truncated) is on the wire but not shown in the UI.

## Terminal / scripts
- Piped script output is decoded per chunk, so a multibyte UTF-8 character split across reads can render garbled.
- Script outcomes live in AgentModeView state and are lost when the view unmounts.
- Scripts surface: no port detection, no per-row More menu.

## Right panel
- Pressing Cmd+P doesn't focus the Files inline search; it opens the global Quick Open.
- Files breadcrumb segments are plain text, not reveal buttons.
- Files git markers refresh after a commit only while a Diff, Git or Pull request tab is open.
- Pushing from a non-agent branch in a managed worktree fails.
- Commit messages are generated heuristically, not by a model.
- A thread can't be opened in an existing worktree.
- Large diffs aren't virtualized (limits: 500 files, 12 expanded, 2000 lines/file).

## Palette / keymap
- Focus scope is attached to the command, not to the binding. A rebound palette.open can't fire from the editor.
- Pre-existing default conflicts: Shift+F5 (debug.stop/disconnect), F2 (rename/setVariable, non-mac), Cmd+Shift+K (deleteLine/searchThreads).
- The palette Files-page footer is cramped (hint text wraps to 3 lines). The mockup has no syntax line there.
- The spec says projects/threads/branches are "fuzzy", but they use token substring matching.

## Conversation / sidebar
- Cmd+F highlight doesn't cover rows loaded via "Load earlier activity" in log mode.
- A Codex subagent's live timer undercounts if the thread is opened mid-run (no start time on the wire).
- The selected thread is marked read even when agent mode isn't the visible screen.
- The inline find bar still lifts with a shadow and has an accent magnifier on focus.
