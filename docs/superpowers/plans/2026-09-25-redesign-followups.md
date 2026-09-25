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
- The Git amend action (and stage/unstage/revert from the old sidebar Git view) is no longer reachable anywhere after P7 removed the legacy chrome. Decide whether the P6 Git surface needs amend.
