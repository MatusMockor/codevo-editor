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

## Editor keybinding bridge (QA-fix round)
- Only the main EditorSurface Monaco editor gets the Codevo keymap bridge, context-menu twins and command-layer routing. Other Monaco instances (diff editors, previews, agent-mode editors) still let Monaco defaults such as Cmd+K chords, F8 and Cmd+E shadow Codevo shortcuts while they have focus. Give them the same bridge.
- Cmd+J in agent mode is not plain VS Code parity: if the bottom panel shows a view other than the terminal (for example, Problems or Search in the drawer), Cmd+J switches to the terminal instead of closing the panel. This keeps the terminal reachable in agent mode. Decide whether to keep this exception or split terminal and drawer toggles into separate commands.
