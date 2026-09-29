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

## Git ship flow
- `integrate` and `removeWorktree` in useAgentShipFlow.ts still report authorityLost after their side effect has already succeeded, when the owner changed mid-flight. Commit and push were fixed; decide the same truthful-success policy for these two.
- Settings: the selected palette card now uses the same ring as keyboard focus, so a selected card looks focused. It needs a distinct selected style.

## Settings / archive
- Settings > Archive lists only local threads; remote threads (useUnifiedAgentThreads) are not included.
- Bulk "Unarchive" in the rail selection bar is unreachable now that archived threads aren't in the rail. Add bulk unarchive to Settings > Archive, or remove the dead code.
- The slim archived row variant in agentSidebarPresentation.ts / AgentThreadRow is dead code in the rail.

## Clone
- Server-sent `remote:` lines can steer the clone failure classifier, causing wrong advice text only. Classify on git's own `fatal:`/`error:` lines, ignore `remote:` apart from known host messages, and make the `ssl` pattern specific.
- The clone trust revoke doesn't stop runtimes the way set_workspace_trust does. That's fine for a freshly created folder, but note it.
- If the core.sshCommand lookup fails or times out, the app's batch SSH command overrides the user's.
- The persisted `revoked_roots` in trust.rs grows by one entry per clone and has no cap. Add bounded eviction, e.g. drop entries whose folder no longer exists, or cap it with deterministic eviction.
- The trust revoked refusal is matched by an exact string pinned in contracts/workspace-trust-errors.json. A typed error code would be sturdier, but it needs the command error shape to change.

## Editor chrome (after P7 Task 13)
- `workspaceSettings.statusBar` visibility keys other than cursorPosition/index/languageServer no longer control anything. Remove the settings rows or map them to the new editor sub-header items. Toggles that do nothing are untruthful.
- `sidebarView` / `setSidebarView` still live in the controller and session cache. Remove them in a separate controller slice.
- AgentSurfacePanel still sets `data-tree`, which has no CSS consumer (only P6 tests read it).
- Done (2026-09-25): the right-panel Git surface has amend and per-file discard again. "Amend last commit" lives in the commit box options menu (the chevron next to Commit). It prefills the full last message, shows an "Amending <sha>" strip with a way to stop, and restores the previous draft when turned off. It is disabled with a reason when there is no commit, when HEAD is already in any remote-tracking ref, when the message is over 4 KB, while a merge, rebase, cherry-pick or revert is in progress, or in agent threads. The backend (`amend_git_head`) checks HEAD against the sha the user saw, builds the tree in scratch indexes inside the git dir, commits through the pinned, bounded runner, and updates the real index in one `update-index --index-info` with a bounded retry on index.lock. Each selected row is sent with its intended index state (stage the worktree or stage a deletion), so a staged deletion stays a deletion even when the file is back on disk. A staged delete and a recreated untracked file are two separate rows. Staging is batched (`add --pathspec-from-file`, one removal batch, one `ls-files`) under a 60 s deadline, and the reflog gets "amend: <subject>". The legacy `amend_git_commit` command is unregistered, and the history reword uses the same pushed check (HEAD in any remote-tracking ref). If that last step still fails, the UI leaves amend mode and says the staged files could not be updated. Each row has a Discard or Delete action behind an alertdialog. `prepare_git_discard` fingerprints the file when the dialog opens. `discard_git_file` re-reads status for the exact paths (including ignored files), checks each parent folder with `fstatat` (no symlink follow), checks that nothing has taken the place of a deleted file, refuses submodules, and refuses if the fingerprint changed. The fingerprint covers the file content (or size, mtime, ctime, inode and device for files over 32 MB) and the index entry. Deleted files and a rename's old path are checked out into a folder under the git dir and moved in with a no-clobber rename. If that folder is on another volume, the move falls back to an exclusive copy (or a new symlink), so an existing file is never overwritten. Both commands are trust-gated, bounded, no-shell, use literal pathspecs and pin the repository directory.
- Still open from the old sidebar Git view: per-file stage/unstage. The surface uses an include-selection model where commit stages every included file, so a separate staging toggle would be overridden and would mislead. The backend commands (`stage_git_files`/`unstage_git_files`) exist if the model changes.
- Amend in agent threads needs the ship flow to follow the rewritten HEAD (receipt `lastCommitSha`). It is disabled with a reason for now.
- Amend at a `rebase -i` "edit" stop is allowed (no rebase marker blocks it, same as `git commit --amend`). The rebase then continues from the amended commit. Decide whether the Git surface should detect an interactive rebase stop and explain it.
- Discarding a case-only rename (`tracked.txt` -> `Tracked.txt`) on case-insensitive macOS volumes is not covered by a test and may fail closed or restore the wrong spelling. Verify on APFS and handle explicitly.
- Commit and amend selections are keyed by path and tracked/untracked side, not by status. A row that changes from M to D between rendering and committing is not treated as stale, so the deletion is committed without a new review. Include the status in the selection key or re-check it before committing.
- The amend backend maps any failure where HEAD differs from the expected commit to the generic "last commit changed" message, which hides the more specific "Git could not confirm the amend and the last commit changed in the meantime" message after an uncertain ref update.
- Discard restore checks parent folders through the pinned root descriptor but then creates missing folders and renames by path. A folder swapped for a symlink in that window is still followed. Move the create/rename to `mkdirat`/`renameat` relative to a descriptor.
- A killed `update-ref` during amend can leave `refs/heads/<branch>.lock` behind, which blocks the next commit until it is removed. Detect and report a stale ref lock after an uncertain update.
- bounded_process reads stderr through a bounded reader. A git process that writes more stderr than the cap can get SIGPIPE, and the result is reported as a generic failure. Drain and discard stderr past the cap instead.
- Submodule rows are refused by the backend when the discard dialog opens (the dialog closes with "Submodules can't be discarded here."). The row itself can't be disabled up front because the status wire has no gitlink flag.
- Clone auto-open only starts from the visible clone composer. If the user navigates away before the clone finishes, the project waits until they click the clone row. The sidebar also keeps the default-scope highlight while the clone composer is shown.
- Editor change markers compare the buffer to the saved file, not to git HEAD. A file that is changed in git but saved shows no markers, unlike VS Code. After a tab switch, unsaved edits show no markers until the next keystroke; the snapshot broker should capture unedited buffers.
- Narrow editor drawer: the Problems filter is partly scrolled out of view at a window width of 1100px or less. The Package grouping and filter only appear when the header is wider than 720px.

- Files surface: a single click starts the preview at once and switches to the Editor tab after a 250 ms double-click window. A double-click inside the window pins the file and switches once. The pending switch is scoped to its owner (workspace, thread, generation, token) and is cancelled on unmount or on a thread/workspace switch. Open items:
  - The macOS double-click interval is about 500 ms, so a slow double-click can still land in Monaco.
  - Clicking a folder inside the window doesn't cancel the pending switch.
- Editor groups: closing the last tab in a non-main group closes that group (VS Code closeEmptyGroups). The remaining group takes the full width, becomes active, and gets keyboard focus if focus was lost; a Git diff tab there loads. The main group and the last remaining group always stay. Empty side groups are collapsed on restore (session and cached), independent of the previous workspace. Open items:
  - A deliberately empty split is also collapsed after switching A→B→A.
  - A restored split whose files are unreadable is collapsed silently.
  - The id-collision case has no test.

## Editor keybinding bridge (QA-fix round)
- Done (2026-09-25): secondary Monaco editors now get the Codevo keymap bridge. Every diff editor host (GitDiffPreview, including its agent-mode and remote history uses, LocalHistoryPanel, FileHistoryPanel, ExternalFileCompareDialog and RemoteFileComparison) installs `installDiffEditorKeymapBridge` on both inner editors through `useDiffEditorKeymapBridge`. The bridge is disposed on unmount or editor disposal and re-registered when a shortcut is rebound. Global shortcuts go through the command registry with a context that has no active document. Main-editor document commands (rename, format, go to definition, references, quick fix, refactor and similar) are swallowed there so they cannot act on the main document. Selection, fold and Go to Line (the Monaco picker) run on the diff editor's own model. Next/previous change maps to the host's diff navigation, and Close Tab closes only a GitDiffPreview tab. Monaco's own diff keys (for example F7) are left alone. The Codevo context-menu twins are still main-editor only, and Cmd+click definition in diff editors is still Monaco's behavior.
- Cmd+J in agent mode is not plain VS Code parity: if the bottom panel shows a view other than the terminal (for example, Problems or Search in the drawer), Cmd+J switches to the terminal instead of closing the panel. This keeps the terminal reachable in agent mode. Decide whether to keep this exception or split terminal and drawer toggles into separate commands.

## Provider errors
- Done (2026-09-29): run failures now tell usage limits, temporary capacity problems and sign-in problems apart. The owner saw a false-looking "Claude Code needs you to sign in again" card. That sign-in had really expired: two fresh CLI runs got `authentication_failed` ("OAuth session expired and could not be refreshed"), and the next run worked after `/login`. The weekly limit was an earlier turn, and it only showed its raw text with no advice. `usageLimited` shows "<Provider> usage limit reached. Resets <time>." and tells you to wait or switch model or provider. `temporarilyOverCapacity` covers the transient Claude 429, 529/Overloaded, "is experiencing high load" and Codex "Selected model is at capacity", and says "Try again in a moment." (plus "or switch to another model" when only one model is overloaded). Claude resets keep their timezone. `authenticationRequired` now says whether the sign-in expired or was rejected, and the advice names the exact command (`claude` + /login, `codex login`). The thread banner (with Retry) now classifies the last reported error of a turn that exited with a non-zero code.
- The structured provider error is dropped in Rust. The Claude stream `error` field (`rate_limit`, `authentication_failed`, `overloaded`, ...) and the Codex `codex_error_info` (`usage_limit_exceeded`, `server_overloaded`, ...) never reach the frontend, so classification relies on matching the message text. Pass the closed error code through the Claude stream parser and the Codex turn events, and classify on it first.
- Claude `billing_error`, `oauth_org_not_allowed` and `account_on_hold` are still `unknown`, so the card shows the raw provider text with no advice. Give each its own variant with truthful advice (check plan or billing, use an API key or ask the org admin, see account status).

## Persistent Claude session
- Background-turn events (`agent-session://background-turn`) have no id. A duplicate or replayed delivery cannot be deduplicated on the frontend, and the frontend mints the background turn id itself. Give each event a backend-assigned id (session generation + per-session sequence), carry it into the recorded turn, and drop duplicates by id.
- A held background reply can land after the user's next message. The frontend holds an unprompted reply until the turn it arrived during settles, but it cannot tell whether the reply belongs before or after a message sent in the meantime. Carry a backend turn id or per-session sequence on the background-turn event and order the recorded turn by it.
- A withdrawn interrupt can race the turn's own result. If an interrupt is armed and its stdin write then fails (lock timeout, rolled back within ~2 s), a natural result arriving in that window can label the turn Interrupted (shown as stopped) although no interrupt reached Claude. Closing it needs the settle decision to know whether the interrupt frame was actually written.

## Provider updates
- A failed health probe stops the periodic update checks for that provider. The periodic timer only runs the lightweight update check, and that check needs ready health with a known installed version. After a probe fails (including the re-probe that now follows a self-updated CLI), health stays failed and every later tick does nothing until something else re-probes (settings change, discovery, manual refresh). This predates the self-update fix. Let the timer retry a bounded health probe with backoff while health is failed.
- Provider update fingerprint: `provider_entry_point` takes the first PATH hit, while discovery skips entries whose identity fails (for example a bad shebang). In that case the fingerprint is never current, so every periodic check re-probes health. This is bounded by the check interval. Share discovery's "identity must succeed" rule. Wrapper shims that are not symlinks (asdf, volta) don't change on update, so a stale version isn't detected; this is not a regression.
- Claude background-task level signal: `background_tasks_changed` now ends a listed local_bash or monitor task once a later frame drops it. This assumes the CLI only drops finished tasks, and the only evidence is one real log. `ambient: true` tasks are ignored on both sides. Nobody has probed whether the CLI would mark a monitor the user explicitly asked for as ambient. The frontend doesn't read the level frame; it relies on Rust settling the turn.
- Claude stream `command_lifecycle` frames are saved as "Unsupported Claude stream frame" on every turn. This predates the persistent session. Parse them as ignorable.
- Flaky test: `clean_exit_grace::untracked_nohup_child_survives_a_clean_exit_only_for_the_grace_window` sometimes fails under full-suite load ("killed before the grace window ended") and passes when run alone. Widen its timing margin or make it deterministic.
- Launch admission normalises Claude effort against the bundled model catalog, not the live one, because the live catalog only exists in React state. Pass the live catalog into the admission dependencies at the composition root, so a model whose effort levels change in the live catalog can't dead-end again.
- The halt mark ("stopping") is only set by the user's Stop/Esc. Project and root stops, the stop after a failed steer write, and stops started by the backend don't set it, so they can still briefly show "run failed" before `stopped` arrives. Also add a test that `serializeAgentHistoryThread` leaves `haltRequested` out.
- Esc to stop: a brand-new thread can't be stopped while it is starting, because it is registered only after it starts and there is no Stop or Esc yet. Adding this needs a cancel path for dispatches. If a non-modal floating surface (for example the git diff preview) is open while the last click was in the conversation, one Esc can stop the agent and close the surface.
- Stopped tool rows: only the CLI rejection prefix "The user doesn't want to proceed with this tool use." counts as stopped. Other interrupt texts ("[Request interrupted by user for tool use]", "The user doesn't want to take this action right now") still show red "Failed". Add them once a probe confirms them. A rejection inside a subagent's own tools still counts as failed in the subagent summary. A permission denied in the approval UI during a turn that was later stopped reads "stopped" rather than "denied".
- Perf (autorun smoke, 2026-09-29): tab-switch-cycle p95 is 81-90 ms at HEAD, versus 43-46 ms for HEAD without the Monaco `edcore.main.js` contributions and 56-58 ms for the base (2102179f5, which had no contributions). The whole difference is about 2 frames when switching into files with full JS/TS features (huge-union.ts, large-5k.ts): CodeLens and inlay hints re-apply on model change, plus links, folding, sticky scroll and word highlight. Candidate optimisation: defer or de-prioritise the decorative contributions on model switch (render first, decorate after the first frame). Profile before optimising.
