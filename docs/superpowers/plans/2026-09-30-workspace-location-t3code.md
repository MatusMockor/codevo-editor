# Workspace location, the t3code way

Source design: `docs/superpowers/mockups/workspace-location-variants.html`, sections
"How t3code does it" and "C + t3code". Owner decision: "exactly like t3code". Behavioral
reference: t3code `c2fa9fc` (`BranchToolbar*.tsx`, `BranchToolbar.logic.ts`,
`Sidebar.tsx` project scope, `ChatView.tsx` branch-mismatch banner).

The plain-C sidebar workspace card is dropped (t3code has none). Codevo keeps only two
additions over t3code: remote runners are named by server, and the right panel shows one
location line.

## Current state (mapped)

- `AgentRailHeader` renders `AgentProjectFilterMenu`: a 16px monogram ("E"). Picking a
  project calls `onChangeFilter` and `onChangeScope` -> `AgentModeView.changeProjectScope`
  -> `navigation.setProjectScope` (reopens the project's last thread) +
  `onSelectProjectEnvironment` (switches the remote server) -> the `selectWorkspace`
  effect then switches the IDE workspace behind the right panel.
- `useAgentThreadNavigation.selectThread` and `setProjectScope` move the filter with
  `agentRailFilterFollowingProject`. The filter lives only in the in-memory
  `navigationSession` ref.
- New thread button / Cmd+N create immediately in `railScope`'s project.
- Composer footer: `AgentComposerDrawerStart` -> `AgentEnvironmentCheckoutPicker` (one menu
  mixing Run on + Checkout, trigger "server · Local checkout") before sending;
  `AgentComposerLockedCheckout` after sending, which says "New worktree" for a worktree
  that exists. `AgentComposerBranchPicker` hides once locked.
- Sidebar row line 3: ship branch or "in place" / "worktree".
- Right panel (`AgentSurfaceHost` / `AgentSurfacePanel`): follows the selected thread
  through `selectWorkspace` (owner id + generation) and `agentSurfaceTreeTarget`
  (workspace id + thread id + project owner), but never says what it shows.
- Thread header is already `project / title` (no change).

## Behavior changes

1. Project filter: a named text trigger ("All projects ⌄" / "<project> ⌄"). Choosing only
   sets the filter. It never calls `setProjectScope`, `onSelectProjectEnvironment` or
   `selectWorkspace`, never selects a thread, and never follows the selected thread
   (`agentRailFilterFollowingProject` is removed). Persisted per app in local storage
   (`editor.agentSidebar.projectFilter.v1`) through a port + browser adapter.
2. New thread button / Cmd+N: with more than one project it opens the command palette on
   the existing "New thread in…" page (t3code: `openCommandPalette({open:"new-thread-in"})`).
   Shift-click creates directly in the current project (t3code
   `shouldCreateNewThreadInCurrentProject`). With one project it creates directly. The
   palette's "New thread in…" item creates directly (never reopens the picker).
3. Composer strip (t3code `BranchToolbar`): `Run on` machine picker only when a server is
   configured or the thread runs on a server | checkout picker … branch on the right.
   Words: "Local checkout", "New worktree", "Worktree", "Previous worktree (<branch>)",
   the server name, "Server checkout". "In place" is gone from the UI. After the first
   message the checkout is a muted label with the real state: "Worktree" once the
   worktree exists, "New worktree" only while it is being created.
4. Branch after start: for an in-place local thread the branch picker stays live and
   switches the checkout through the existing typed, bounded, trust-gated
   `switchBranch` / `checkoutRemoteBranch` gateway and `agentBranchCheckoutGuardReason`
   (blocked while a thread runs there or a document is dirty). Worktree threads show the
   worktree branch read-only; server threads show no branch (not known here).
5. "Branch changed — was <branch>" notice with "Restore branch" (t3code copy, tooltip
   "This thread last ran on X. Sending will continue on Y.", dismissable) for an in-place
   local thread whose checkout moved. Restore goes through the same typed command.
6. "Previous worktree": the pre-send checkout picker offers the project's most recently
   used live worktree (t3code `resolvePreviousWorktreeSeed`); sending starts the new
   thread in that worktree without creating one.
7. Right panel location line: `<project> ▸ <machine> · <checkout> · <branch>` plus the
   folder path, in the strip's exact words. It follows the selected thread (draft: the
   chosen project) by exact identity.
8. Sidebar rows: line 3 shows the kind glyph and the branch when known, else the checkout
   word; remote rows name the server.

## Shared contracts (lead-owned, written first)

- `src/domain/agentWorkspaceLocation.ts`: pure presenter. Closed unions for machine and
  checkout, label functions, and the thread/draft -> location mapping used by the strip,
  the rows and the panel line.
- `src/domain/agentThreadBranchMemory.ts` + port + browser adapter +
  `useAgentThreadBranchMemory`: last-run branch per exact thread identity
  (`threadId` + `rootKey` + `ownerId`), bounded (256 entries, deterministic LRU), strict
  parse, unknown or malformed payloads fail closed to empty.

## Migration

- Persisted filter: the old filter only lived in the in-memory navigation session, so there
  is nothing on disk to migrate. First launch starts on "All projects". A persisted
  project that no longer exists falls back to "All projects" once projects have loaded
  (t3code rule); before load it is kept.
- Navigation session: `railFilter` is no longer written to or read from the session; the
  preference is the only source.
- Workspace state: no persisted workspace state changes. The IDE workspace behind the
  right panel keeps following the selected thread / draft project through the existing
  owner-validated `selectWorkspace` effect. The filter simply stops driving it.
- Existing threads: no schema change. `AgentThreadTarget` stays `{isolation,
worktreePath}`. Branch memory is empty for existing threads, so no "Branch changed"
  notice appears until an in-place thread runs again and its branch is recorded. Rows
  show the checkout word until then.
- Previous worktree: threads started this way record the existing worktree path as their
  target, like a follow-up turn. Removing a worktree that another live thread still
  targets is refused.

## Ownership (parallel streams)

- Lead: shared contracts, plan, integration, gates.
- Sidebar: filter, New thread picker, rows, navigation, `AgentModeView` /
  `AgentWorkbenchScreen` composition wiring for all streams.
- Composer strip: Run on / checkout / branch pickers, locked labels, branch notice.
- Previous worktree: composer state + dispatch + worktree removal guard.
- Right panel: location line and identity-follow tests.
- Independent read-only review at the end.

## Known gaps (accepted)

- No keyboard twin for "new thread in current project" (t3code `chat.newLocal`); only
  shift-click.
- Worktree threads cannot switch branches from the strip (Codevo's ship flow owns the
  `agent/<task>` branch).
- Remote threads show no branch.
- Git panel commit, push and merge are not guarded for a worktree shared through "Previous
  worktree"; a second thread in the same worktree sees the first thread's commits.
- Removing a worktree whose only other user is archived is allowed; unarchiving that
  thread later shows it with a missing worktree.
- The thread header's "New thread in <project>" crumb creates directly in that project,
  as t3code's ChatHeader does; only the sidebar button, the collapsed-rail button and
  Cmd+N open the "New thread in…" picker.
- The right panel path is shown in full (truncated from the start); there is no cheap
  home-directory source for a `~` prefix.
