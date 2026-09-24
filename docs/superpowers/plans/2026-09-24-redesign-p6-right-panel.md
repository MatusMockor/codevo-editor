# Redesign P6 - Right Panel Surfaces (Diff, Files, Terminal, Git, Pull request, Scripts, F9, B4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the content of the agent right panel with the redesigned surfaces from `docs/redesign/v3-right-panel.html`:
- a tab strip where terminal sessions are tabs and a "+" menu adds surfaces;
- a Diff surface with scope, layout, wrap, whitespace and file-tree controls, which never clips long lines (B4);
- a Files surface with search, a git-marked tree and a preview;
- Terminal sessions with a floating toolbar;
- a Git surface with include checkboxes, commit message + Generate, Commit / Commit & push, and a branch picker with create + worktree;
- a Pull request creation form behind a closed, typed forge command (F9);
- a Scripts surface with run/stop, running/exit state and project actions.

**Architecture:** The right-panel frame (TopBar header, resize, open/close, maximize) is P2's. P6 owns everything inside it:
- the surface-kind union and its catalog;
- the tab strip (foundation `PanelTabs`);
- the body switch;
- every surface body, plus the application hooks and ports each surface needs.

Diff rendering moves from a single Monaco `DiffEditor` to a pure, bounded line-diff model (`src/domain/diffView/*`), computed in a Web Worker and rendered as HTML hunks, so unified/split, wrap and whitespace are data-level choices. New Git data (line stats, unpushed commits, upstream, branch-vs-base diff), branch worktrees and pull-request creation are closed Tauri commands with `deny_unknown_fields` requests, hard workspace-trust gates, bounded no-shell process plans, and TS contract validators, with tests on both sides.

**Tech Stack:**
- Frontend: React 19, TypeScript 5.8 strict, Vitest 4 + jsdom, lucide-react, plain CSS with `--cv-*` tokens, foundation components in `src/ui/foundation/`, Web Worker (Vite `new URL(..., import.meta.url)`).
- Backend: Rust (Tauri 2) with `git` and `gh` / `glab` CLIs run through the existing bounded process runner in `src-tauri/src/repository_lookup/process.rs`.

**Spec:** `docs/superpowers/specs/2026-09-23-codevo-redesign-design.md` (§3.1.8, §3.2 B4, §3.3 F9, §4 contracts, §5 P6, §6, §7). Mockup: `docs/redesign/v3-right-panel.html` (states Diff, Split, Files, Terminal, Commit, Branches, Pull request, Scripts, Wide). Where the mockup clips (`.hunk { overflow: hidden }`, `.hs .cd { overflow: hidden }`), the spec wins: long lines scroll or wrap, never clip.

## Global Constraints

- Spec §3.1.8 verbatim: "Diff (scope: latest turn / turn N / working tree / branch; unified/split; wrap; whitespace; file tree), Files (search, tree with git markers, preview), Terminal (sessions as tabs, floating toolbar), Git (changes with include checkboxes, message with generate, Commit / Commit & push, branch picker with create and worktree), Pull request creation form, Scripts (run/stop, running/exit state, project actions). Long lines scroll or wrap, never clip."
- Spec B4: "Diff in the narrow right panel is cramped and clips file names/content" -> "Resolved by the redesigned resizable panel and diff layout (§3.1.8)".
- Spec F9: "Git, Scripts and Pull request as right-panel tabs; PR creation form." §4: "F9 PR creation uses a closed typed command through the existing git/forge boundary".
- Spec §1: "no existing capability is lost (agent workflows, editor, debugging, git, scripts, terminals, settings, remote execution)". The History surface, ship integrate/cleanup, per-file "open diff in editor", remote server panels and the bottom-panel terminal keep working.
- Spec §4: "no feature component defines its own colors" - every new CSS value is a `--cv-*` token (or `var(--cv-*)` expression); no hex, rgb or named colors.
- Spec §4 hotspots: `AgentModeView.tsx` (1190 lines) must shrink or stay flat. `AgentThreadSession.tsx`, `App.tsx` and `useWorkbenchController.ts` are not touched. New production files stay below 400 lines each.
- Spec §4: "Old styles are removed as each surface is migrated" - the replaced diff, ship, commit-menu and script-control styles are deleted in the task that replaces them.
- Spec §7.1: implementation and review agents are Opus 5.5; UI QA is Codex Computer Use via `codex app-server` against bundle `dev.mockor.editor.qa`.
- CLAUDE.md: work on `main`; subagents never run mutating git commands; the lead commits once after review and full gates, only after explicit owner authorization; no AI attribution; no push, no tag.
- CLAUDE.md: never run `coderabbit`/`cr`; review is a separate read-only agent.
- CLAUDE.md security:
  - no user-derived shell strings;
  - forge CLIs run as `Command::new(resolved_executable).args(argv)` with a cleared environment, a timeout, and bounded stdout/stderr;
  - every new Tauri command rejects unknown fields and is trust-gated at the Rust boundary (repo memory "New exec surfaces need trust gate").
- CLAUDE.md performance: no line diff on the UI thread (worker); bounded inputs (128 KB per side from the sources, `MAX_DIFF_VIEW_LINES_PER_SIDE = 20_000`, `MAX_DIFF_VIEW_EDIT_DISTANCE = 1_500`); the file list is capped at 500 rows; at most 12 expanded diff files render at once; terminal session tabs are capped at 16 (existing `MAX_TERMINAL_TABS`).
- Code style (user rules):
  - no code comments except bare tooling annotations;
  - guard clauses, never `else` / `else if`;
  - closed unions with exhaustive `switch` + `never`;
  - no `any`;
  - no `throw` in test code.
- Tests (user rules): real collaborators; only true third-party boundaries (the Tauri `invoke`, the forge CLI, `Worker`) are faked; React tests settle with `act` / `waitForReact`.
- Formatting (repo memory): `npx prettier --write` only on files you created; for modified files run `npm run format:check:changed` and prettier-write only the files it lists. Never prettier a directory.
- Token scan: never write a literal `var(--name` for a name no stylesheet declares, not even in a test string.
- Node watch tests (repo memory): if a full `npm test -- --run` fails only in Node watch / port 9229 suites under load, rerun those files sequentially after freeing port 9229 before treating it as a regression.

## Review Focus

1. **The owner switches thread or workspace (A -> B -> A) while a diff, git status, PR context or file search request is in flight.** A late result must never appear under the new owner. Pinned in Task 5 (`useAgentDiffSurface` stale-generation test), Task 11 (`useAgentGitSurface` thread-switch test), Task 13 (`useAgentPullRequest` switch test) and Task 15 (`useAgentFilesSearch` superseded-query test).
2. **The working tree changes between showing the include checkboxes and pressing Commit.** Files may be added, reverted or committed elsewhere in between. The commit must include exactly the selected paths that still have changes. If a selected path vanished, it fails closed with "The change list changed. Review the selection and commit again." and commits nothing. Pinned in Task 10 (`selectCommitChanges` and the ship-flow selection test).
3. **Very long lines, deep paths and huge or binary files in a 360px panel.** Code scrolls horizontally, or wraps when wrap is on. File names stay fully readable (the directory part may shorten from the left, and the full path is in `title` / `aria-label`). Binary or oversized files show a truthful "Open in editor" row instead of a partial diff. Pinned in Task 4 (limits), Task 6 (B4 CSS contract + long-line DOM test) and Task 5 (binary/large source mapping).
4. **The PR form receives hostile or odd input:**
   - a title with newlines or only spaces, or a 70 KB body;
   - a base branch named `--help` or `a..b`;
   - a remote that is not GitHub or GitLab;
   - a missing or unauthenticated `gh`/`glab`.

   Each must yield a closed, readable failure and never run the CLI with unvalidated arguments. Pinned in Task 8 (Rust `pull_request` validation + argv tests, TS contract tests) and Task 13 (form validation test).
5. **Terminal session tabs and the lifecycle of the terminal surface.** Closing the last session tab closes the Terminal surface. Restart replaces the session without leaking the old process. An exited session loses its live dot. Switching threads never shows the previous owner's sessions. Pinned in Task 3 (TerminalTabsPanel external-strip tests) and Task 2 (tab-entry presenter test).

---

## Current Code Summary (mapped before this plan)

- **Surface model.**
  - `src/domain/agentWorkbenchLayout.ts`: `AGENT_SURFACE_KINDS = ["files","diff","terminal","history"]`, reducer, persistence parser.
  - `src/domain/agentSurfaceActivation.ts`: remote serving; `AgentRemoteSurfaceKind = Exclude<AgentSurfaceKind,"diff">` indexes `RemoteSurfaceCapabilities {files,history,terminal}`.
  - `src/components/agentMode/useAgentSurfaceLayout.ts`: per-remote-pane selection, open / activate / close.
- **Panel.** `AgentSurfaceHost.tsx` (292 lines) builds props and calls `AgentSurfacePanel.tsx` (466 lines). The panel holds:
  - the resize separator;
  - a header with hand-made tabs (`TABS` Files/Diff/Terminal/History), the editor-tabs portal target and the file-tree toggle;
  - the body `SurfaceBody` switch;
  - the chooser `AgentSurfaceEmptyState.tsx`;
  - hotkeys in `agentSurfaceHotkeys.ts`.
- **Diff.** There is no multi-file view and no line stats for the working tree.
  - `AgentSurfaceDiff.tsx`: working tree = file list + one Monaco `GitDiffPreview`, 180-260px list column that never collapses (the main B4 cause at `agentSurface.css:522`).
  - `AgentSurfaceProjectDiff.tsx`: no-thread project changes.
  - `AgentRecordedTurnDiff.tsx`: a turn = `AgentTurnChangesCard` tree + one Monaco diff.
  - `GitDiffPreview.tsx` hard-codes side-by-side, no wrap, and `ignoreTrimWhitespace: false`.
  - Recorded turn changes come from `agents.getTurnChanges` / `getTurnFileDiff` (with line counts); the working tree from `GitGateway.getStatus` / `getDiff`. No branch-vs-base diff API exists.
- **Git / ship.**
  - `AgentCommitMenu.tsx` (top bar split button) hosts `AgentShipPanel.tsx`: status, commit all, push, compare URL, integrate, remove / discard worktree.
  - `useAgentShipFlow.ts` commits all changes (`stageFiles(all)` + `commit(all)`).
  - `GitGateway.commit(root, message, changes)` already commits a subset: the Rust side builds a temp index from the selected staged paths.
  - Push is `GitIntegrationGateway.pushBranchUpstream`.
  - Missing today: commit message generator, unpushed-commit list, PR command, and a worktree for an arbitrary branch (`addAgentWorktree` only makes `agent/<task>` from HEAD).
- **Scripts.**
  - `AgentScriptRunControl.tsx` (top-bar split button) over `useAgentThreadScripts` + `AgentThreadScriptRunner` (adapted from `useNodePackageScriptWorkbench` in `AgentWorkbenchScreen.tsx:311`). Runs go to the bottom-panel terminal, one at a time, and there is no exit state in the agent surface.
  - Project actions = VS Code `tasks.json` process tasks (`useVscodeProcessTasks`, `VscodeProcessTasksPanel.tsx`), today only in the workbench sidebar.
- **Terminal.**
  - `AgentSurfaceTerminal.tsx` mounts `TerminalTabsPanel.tsx`: its own reducer `terminalTabSet.ts`, an internal session tablist shown when there are 2 or more tabs, and a toolbar with Split / New / Close.
  - There is no live/exit status per tab and no stop/restart.
  - `AgentTerminalSessionsPalette.tsx` is the external agent-session importer. It is not terminal tabs, and P6 leaves it alone.
- **Files.**
  - `AgentSurfaceFileTree.tsx` (tree + Refresh + "Search files" button that fires quick open) sits next to an editor slot where the workbench Monaco editor is positioned.
  - Preview uses `onPreviewFile` (a preview tab in the real editor).
  - Git markers come from `fileStatusesByPath`.

## Key Decisions

1. **Surface kinds.** The union becomes `files | diff | terminal | history | git | scripts | pullRequest | agents`:
   - `pullRequest` and `agents` are transient (never persisted);
   - `agents` is P4's body passed in as a node;
   - `editor` is added later by P7.
   History is kept (not in the mockup's add menu order, appended last) because spec §1 forbids losing capabilities.
2. **Terminal sessions as tabs.** `TerminalTabsPanel` keeps owning session state. In the new optional "external strip" mode it publishes a bounded snapshot (`TerminalTabsSnapshot`) and accepts commands through a ref. The right-panel strip renders one tab per session in the terminal kind's position. The bottom panel is unchanged (it does not pass the prop).
3. **Diff model.**
   - Build one pure Myers line diff with a bounded edit distance, whitespace-insensitive keys, 3-line context hunks and split pairing.
   - Run it in a worker per expanded file.
   - Sources are strategies behind `AgentDiffSource`: turn, working tree, branch.
   - The Monaco `GitDiffPreview` stays for editor-side diffs (P7) and for "Open diff in editor".
4. **Diff scope state** lives in a new hook `useAgentDiffScopeSelection` called by `AgentModeView`. It replaces the 40-line recorded-diff block, so `AgentModeView` shrinks. The conversation row opens `{ kind: "turn", turnId }`.
5. **Git surface.**
   - Thread scope reuses the ship flow (`AgentShipActions`) with a new closed `AgentCommitSelection`.
   - Project scope (no thread) uses `GitGateway` directly through `projectGitCommitPort`.
   - The ship-only actions (push, integrate, compare page, remove / discard worktree, history) move to the Git surface's "More Git actions" menu and failure banner.
   - `AgentCommitMenu`, `AgentShipPanel` and `AgentScriptRunControl` are deleted, and the top bar shows the mockup's "Commit" button, which opens the Git surface.
6. **Generate commit message** is deterministic and local (conventional type from paths and status, scope from the common directory, subject from the thread title or the changed file names). Model-based generation is reported as a gap: it needs a provider one-shot API that does not exist.
7. **Pull request (F9).** New Rust module `pull_request.rs` + commands:
   - `get_pull_request_context`: head, default base, commits and files vs base, unpushed count, forge kind, CLI availability, commit subjects.
   - `create_pull_request`: validate, push first if needed, run `gh pr create` or `glab mr create` with a closed argv, parse the created URL.
   The supported hosts are `github.com` and `gitlab.com` or `gitlab.*`. Others fail closed with the compare-URL fallback.
8. **Branch picker** uses a shared pure `src/domain/gitBranchPicker.ts` (P9 consumes it for the composer). "Check out in a new worktree" creates the branch in a new managed worktree under the existing worktree base (`add_git_branch_worktree`) and shows its path with "Copy path". Opening a thread inside an existing worktree is a reported gap (agreed with P9).
9. **Scripts surface.**
   - Package scripts are grouped by `package.json` (picker when there is more than one manifest).
   - Run/stop goes through the existing runner (runs still execute in the bottom-panel terminal). "Running" links to that terminal.
   - The last exit code per script is shown ("Exit 1").
   - Project actions = `tasks.json` process tasks; "Add action" = the existing configure action.
10. **Files surface.** The inline search runs `FileSearchGateway.searchFiles` (debounced, generation-guarded) and replaces the tree while a query is set. The tree keeps git markers (A/M/…) as trailing mono letters. Preview stays the real editor preview tab in the editor slot (P7 later moves it). P6 adds the mockup crumb row with Copy path / Open in editor above the slot.
11. **Gateways composition.** A new `AgentRightPanelGateways` (defaults = Tauri adapters) is passed to `AgentWorkbenchScreen` as an optional prop, like the existing `DEFAULT_*` gateways, so `App.tsx` is untouched.

## Ownership Agreements (recorded with sibling planners)

- **P2 (app shell), agreed:**
  - P2 lands first. It wraps the `AgentSurfacePanel` header in `<TopBar region="panel" ... leading={leadingControls} trailing={layoutControls}>`, adds `onResizeWidth` + keyboard resize (`agentSurfaceResize.ts`), and rewrites `.agent-surface` / `.agent-surface__resize*` / deletes `.agent-surface__head` layout and `.agent-surface__layout-controls*` in `agentSurface.css`. `layoutControls` becomes P2's `AgentPanelWindowControls`.
  - P6 owns the TopBar children (tab strip, add menu, editor-tabs portal target, tree toggle) and every other rule in `agentSurface.css`. New P6 styles go to new files under `src/components/agentMode/rightPanel/`.
  - P6 owns two hunks in `AgentThreadHeader.tsx` after P6 Task 1:
    - in the TopBar `trailing` slot, replace `<AgentCommitMenu/>` with a "Commit" button that calls `props.onOpenSurface("git")` (new optional prop `gitSurfaceActive?: boolean`);
    - in the `actions` slot, delete `<AgentScriptRunControl/>`.
  - Update after P2 review (Lead decision 6): Run script now lives in the `AgentThreadHeader` TopBar `trailing` group, not in `actions`; P6's Commit button anchors directly after Run script in `trailing`, and P6 does not delete `<AgentScriptRunControl/>`.
  - In `useAgentSurfaceLayout.ts`, P2 adds only `resizeRightPanel`; P6 adds only `toggleSurface` / `isSurfaceOpen`.
  - P2 does not edit `src/domain/agentWorkbenchLayout.ts`.
- **P3 (conversation), agreed:**
  - P3 renders the "N changed files +a -d · Open diff" row and calls the existing `onOpenTurnDiff(threadId, summary)` unchanged. P6 owns what it opens (Diff surface, scope `{kind:"turn", turnId}`).
  - P3 adds the optional `AgentThreadSession` prop `activeDiffTurnId?: string | null`. P6 adds the `AgentModeView` hunk passing `diffScopeSelection.activeDiffTurnId`.
  - P3 stops importing `AgentTurnChangesCard`. P6 deletes `AgentTurnChangesCard.tsx`, `AgentTurnChangesCard.test.tsx`, `agentTurnChangesCard.css` and `agentRecordedTurnChanges.css` in Task 6, together with `AgentRecordedTurnDiff.tsx`, their last consumer.
  - P6 never edits `AgentThreadSession.tsx` or P3's conversation folder.
- **P4 (sidebar / agents), agreed:**
  - P6 adds the `"agents"` kind: transient, label "Agents", lucide `Users`, closable, not in the add menu, not served for remote threads.
  - `AgentSurfaceHost` / `AgentSurfacePanel` get an optional `agentsPanel?: ReactNode`. P4's hunk in `AgentModeView` passes `agentsPanel={<AgentAgentsPanelSurface />}` on the existing `<AgentSurfaceHost>`.
  - Openers come from the `surface` object in `AgentModeView`: `openSurface(kind)`, `closeSurfaceTab(kind)`, and the new `toggleSurface(kind)` and `isSurfaceOpen(kind)`.
- **P7 (editor), agreed:**
  - P6 owns the surface union, the catalog `AGENT_RIGHT_PANEL_SURFACE_CATALOG`, the strip `AgentRightPanelTabStrip`, the presenter `agentRightPanelTabEntries` (which already has the `editorDocument` entry variant) and the body switch `AgentRightPanelSurfaceBody`.
  - P7 later adds the `"editor"` kind (one union entry, one catalog entry, one body case) and feeds `editorDocuments?: AgentRightPanelEditorDocuments | null` on `AgentSurfacePanel`. P7 also removes the `WorkbenchEditorTabsPortalTarget` and moves the editor slot (`agentSurfaceEditorSlot`) to its kind.
  - Opening files from P6 surfaces uses the existing callbacks (`onPreviewFile`, `onOpenFile`, `agents.openChangedFile`, `agents.openChangedFileDiff`), which P7 may reroute.
  - P6 owns `TerminalTabsPanel.tsx` and `terminalTabSet.ts`. P7 owns `TerminalPanel.tsx`, `BottomPanel.tsx`, `GitDiffPreview.tsx` and all Monaco/editor files.
  - P7 (runs after P6) later edits the P6 files it needs:
    - in `agentRightPanelTabEntries.ts`, the `editor` kind yields no surface tab of its own; its documents are placed at the kind's position;
    - `AgentFilesSurface.tsx` becomes tree-only when P7 removes the editor-expanded layout and moves the editor slot.

    These are P7's hunks, recorded here so P6 does not optimize those spots.
- **P9 (settings / pickers, F8), agreed:**
  - P9 consumes P6's `src/domain/gitBranchPicker.ts` unchanged.
  - P6 adds `pub(crate) fn resolve_worktree_start_point(root: &Path, reference: &str) -> Result<String, String>` to `src-tauri/src/git_worktree.rs` for P9's `addAgentWorktree` base. P6 touches only new functions there plus the new `add_branch_worktree` command wiring, and does not change `addAgentWorktree`.
  - Threads cannot target a pre-existing worktree; this is a reported gap.
- **P8 (projects / repository lookup), not contacted, minimal hunk:** P6 adds only `pub(crate) use` re-exports to `src-tauri/src/repository_lookup/mod.rs` (`CliProgram`, `plan_command`, `run_bounded`, `ProcessLimits`, `ProcessError`, `ProcessKillSwitch`, `ExecutableResolver`, `DiscoveryExecutableResolver`) and changes no behavior there. If P8 edits the same file, the lead merges the re-export lines.
- **P5 (palette):** no shared files. P5 may call `surface.openSurface("git" | "scripts" | "pullRequest")` from palette commands.

## File Structure

Created (all new files stay below 400 lines):

| Path | Responsibility |
|---|---|
| `src/components/agentMode/rightPanel/agentRightPanelSurfaceCatalog.ts` | Label, tab label, icon, add-menu shortcut and description per surface kind; add-menu order. |
| `src/components/agentMode/rightPanel/agentRightPanelTabEntries.ts` (+ test) | Pure presenter: open surfaces + terminal sessions + editor documents -> ordered tab entries. |
| `src/components/agentMode/rightPanel/AgentRightPanelTabStrip.tsx` (+ test) | `PanelTabs` strip, "+" add-surface menu, optional "Open file" button (P7). |
| `src/components/agentMode/rightPanel/AgentRightPanelSurfaceBody.tsx` | Exhaustive body switch per surface kind (replaces `SurfaceBody`). |
| `src/components/agentMode/rightPanel/useAgentTerminalStrip.ts` (+ test) | Holds the terminal snapshot and command ref for the strip. |
| `src/components/agentMode/rightPanel/rightPanel.css` | Strip and shared surface chrome (`.cv-rp-*`). |
| `src/components/agentMode/rightPanel/agentRightPanelGateways.ts` | `AgentRightPanelGateways` port bag + Tauri defaults. |
| `src/components/agentMode/rightPanel/useAgentRightPanelChrome.ts` | Builds `AgentRightPanelChrome` for `AgentWorkbenchScreen`. |
| `src/components/TerminalFloatingToolbar.tsx`, `src/components/terminalFloatingToolbar.css` | Floating Stop / Restart / Split / New toolbar. |
| `src/domain/diffView/lineDiff.ts` (+ test) | Bounded Myers line diff, whitespace keys, counts. |
| `src/domain/diffView/diffHunks.ts` (+ test) | Context hunks, headers, split-row pairing. |
| `src/domain/diffView/agentDiffScope.ts` (+ test) | `AgentDiffScope` union, turn options, labels, active turn. |
| `src/application/diffViewComputation.ts` | `DiffViewComputationGateway` port. |
| `src/infrastructure/diffView.worker.ts`, `src/infrastructure/browserDiffViewGateway.ts` (+ test), `src/infrastructure/inlineDiffViewGateway.ts` | Worker adapter; synchronous adapter for tests and non-worker hosts. |
| `src/application/rightPanel/agentDiffSources.ts` (+ test) | `AgentDiffSource` strategies: turn, working tree, branch. |
| `src/application/rightPanel/useAgentDiffSurface.ts` (+ test) | File list, expansion, per-file hunks with generation guard. |
| `src/components/agentMode/useAgentDiffScopeSelection.ts` (+ test) | Diff scope state per thread, opener callbacks, `activeDiffTurnId`. |
| `src/components/agentMode/rightPanel/diff/AgentDiffSurface.tsx` (+ test) | Diff surface layout. |
| `src/components/agentMode/rightPanel/diff/AgentDiffToolbar.tsx` | Scope button, stats, refresh, collapse, layout, wrap, whitespace, tree toggles. |
| `src/components/agentMode/rightPanel/diff/AgentDiffScopeMenu.tsx` | Scope menu (working tree, branch, latest turn, turns). |
| `src/components/agentMode/rightPanel/diff/AgentDiffFileSection.tsx` | Collapsible file row + body. |
| `src/components/agentMode/rightPanel/diff/AgentDiffHunks.tsx` | Unified and split hunk grids. |
| `src/components/agentMode/rightPanel/diff/AgentDiffFileTree.tsx` | Changed-files tree (uses `buildAgentTurnDiffTree`). |
| `src/components/agentMode/rightPanel/diff/agentDiff.css` (+ `agentDiffStyles.test.ts`) | Diff styles, B4 contract. |
| `src/domain/gitCommitSelection.ts` (+ test) | `AgentCommitSelection`, include state, `selectCommitChanges`. |
| `src/domain/commitMessageDraft.ts` (+ test) | Deterministic commit message generator. |
| `src/domain/gitSurfaceStatus.ts` (+ test) | Line stats, unpushed commits, upstream: types + wire parser. |
| `src/domain/gitBranchDiff.ts` (+ test) | Branch-vs-base changes and file sides: types + wire parser. |
| `src/domain/pullRequest.ts` (+ test) | PR context / request / receipt types, validation, failure classification, form defaults. |
| `src/domain/gitBranchPicker.ts` (+ test) | Branch picker items, badges, filtering, new-branch validation (shared with P9). |
| `src/infrastructure/tauriGitSurfaceIpcContract.ts` (+ test), `src/infrastructure/tauriGitSurfaceGateway.ts` | Surface status + branch diff IPC. |
| `src/infrastructure/tauriPullRequestIpcContract.ts` (+ test), `src/infrastructure/tauriPullRequestGateway.ts` | PR IPC. |
| `src/application/rightPanel/useAgentGitSurface.ts` (+ test) | Git surface state: status, include set, message, commit / commit & push, generate. |
| `src/application/rightPanel/projectGitCommitPort.ts` (+ test) | Project-scope commit port over `GitGateway`. |
| `src/application/rightPanel/useAgentPullRequest.ts` (+ test) | PR context + form + submit state machine. |
| `src/application/rightPanel/useAgentFilesSearch.ts` (+ test) | Debounced, generation-guarded file search. |
| `src/application/rightPanel/agentScriptsSurfaceModel.ts` (+ test) | Script rows by manifest, run / exit state, project action rows. |
| `src/components/agentMode/rightPanel/git/AgentGitSurface.tsx` (+ test) | Git surface layout. |
| `src/components/agentMode/rightPanel/git/AgentGitChangesList.tsx` | Include checkboxes + file rows + totals. |
| `src/components/agentMode/rightPanel/git/AgentGitCommitBox.tsx` | Message box, Generate, Commit, Commit & push, next-step hint. |
| `src/components/agentMode/rightPanel/git/AgentGitMoreMenu.tsx` | Push, integrate, compare page, remove / discard worktree, history. |
| `src/components/agentMode/rightPanel/git/AgentGitShipBanner.tsx` | Busy / failure banner with retry / dismiss and conflicted files. |
| `src/components/agentMode/rightPanel/git/AgentGitBranchPicker.tsx` (+ test) | Search refs, badges, create branch, worktree switch. |
| `src/components/agentMode/rightPanel/git/agentGit.css` | Git + branch picker styles. |
| `src/components/agentMode/rightPanel/pullRequest/AgentPullRequestSurface.tsx` (+ test), `agentPullRequest.css` | PR form. |
| `src/components/agentMode/rightPanel/scripts/AgentScriptsSurface.tsx` (+ test), `agentScripts.css` | Scripts surface. |
| `src/components/agentMode/rightPanel/files/AgentFilesSurface.tsx` (+ test), `agentFiles.css` | Files surface with search, tree, crumbs, editor slot. |
| `src-tauri/src/git_surface_status.rs` | Line stats, unpushed commits, upstream (+ unit tests). |
| `src-tauri/src/git_branch_diff.rs` | Branch-vs-base changes and file sides (+ unit tests). |
| `src-tauri/src/pull_request.rs` | Forge detection, request validation, argv plan, URL parse, failure classification (+ unit tests). |
| `src-tauri/src/lib_composition/git_surface_commands.rs` | Tauri commands for surface status, branch diff, PR context, PR create (+ command tests). |

Modified:
- `src/domain/agentWorkbenchLayout.ts` (+ test)
- `src/domain/agentSurfaceActivation.ts` (+ test)
- `src/domain/gitWorktree.ts`
- `src/infrastructure/tauriGitWorktreeGateway.ts`
- `src/infrastructure/tauriGitWorktreeIpcContract.ts` (+ test)
- `src/application/agentThreadPorts.ts`
- `src/application/useAgentShipFlow.ts` (+ test)
- `src/application/useAgentThreadScripts.ts` (+ test)
- `src/components/TerminalTabsPanel.tsx` (+ test)
- `src/components/agentMode/`: `AgentSurfacePanel.tsx` (+ test), `AgentSurfaceHost.tsx` (+ test), `AgentSurfaceEmptyState.tsx` (+ test), `agentSurfacePolicy.ts` (+ test), `agentSurfaceHotkeys.ts`, `useAgentSurfaceLayout.ts` (+ test), `AgentSurfaceTerminal.tsx` (+ test), `AgentSurfaceFileTree.tsx` (+ test), `useAgentShipActions.ts` (+ test), `agentWorkbenchChrome.ts`, `AgentWorkbenchScreen.tsx`, `AgentModeView.tsx`, `AgentThreadHeader.tsx` (+ test), `agentSurface.css`, `agentRemoteSurface.ts`, `agentThreadsSurfaceTestFixtures.ts`
- `src-tauri/src/git_integration.rs`
- `src-tauri/src/git_worktree.rs`
- `src-tauri/src/lib_composition/git_worktree_commands.rs`
- `src-tauri/src/lib_composition/command_facades.rs`
- `src-tauri/src/lib_composition/runtime.rs`
- `src-tauri/src/repository_lookup/mod.rs` (re-exports only)

Also created (containers, hooks and helpers named in the tasks):
- `src/components/agentMode/rightPanel/agentRightPanelContext.ts` (Task 7)
- `src/components/agentMode/rightPanel/agentRightPanelTestSupport.tsx` (Task 7)
- `src/application/rightPanel/agentBranchDiffSource.ts` (+ test, Task 7)
- `src/application/rightPanel/useGitSurfaceStatus.ts` (+ test, Task 7)
- `src/components/agentMode/rightPanel/diff/useAgentDiffSurfaceSource.ts` and `AgentDiffSurfaceContainer.tsx` (Task 6)
- `src/components/agentMode/rightPanel/git/threadGitCommitPort.ts`, `AgentGitSurfaceContainer.tsx` (Task 11) and `useAgentGitBranchActions.ts` (+ test, Task 12)
- `src/components/agentMode/rightPanel/pullRequest/AgentPullRequestSurfaceContainer.tsx` (Task 13)
- `src/components/agentMode/rightPanel/scripts/AgentScriptsSurfaceContainer.tsx` (Task 14)

Deleted:
- `src/components/agentMode/`: `AgentSurfaceProjectDiff.tsx`, `agentSurfaceProjectDiff.css`, `useAgentProjectDiffChrome.ts`, `useAgentProjectDiffChrome.test.tsx`, `AgentRecordedTurnDiff.tsx`, `AgentRecordedTurnDiff.test.tsx`, `AgentTurnChangesCard.tsx`, `AgentTurnChangesCard.test.tsx`, `agentTurnChangesCard.css`, `agentRecordedTurnChanges.css`, `AgentThreadChangesCue.tsx`, `AgentCommitMenu.tsx`, `AgentCommitMenu.test.tsx`, `AgentShipPanel.tsx`, `AgentShipPanel.test.tsx`, `AgentScriptRunControl.tsx`, `AgentScriptRunControl.test.tsx`.
- Each deletion happens in the task that replaces the file, after `rg` confirms no remaining importer.
- `AgentSurfaceDiff.tsx` and `AgentThreadChanges.tsx` are kept (trimmed in Task 6) as the remote-thread working-tree body. P10 retires them.

Additional modified files (integration hunks): `src/domain/agentShip.ts`, `src/components/agentMode/agentModePresentation.ts` (none expected; only if `agentShipFailureLabel` needs the new reason), `src/components/FileTree.tsx` (only if Task 15 needs a letter status style), `src/components/agentMode/AgentSurfaceDiff.tsx` (+ test).

## Execution Order and Ownership

P6 starts after P2 is committed. Four streams run in parallel with disjoint write scopes. A task that lists a hunk in a shared file (`AgentSurfaceHost.tsx`, `AgentRightPanelSurfaceBody.tsx`, `AgentModeView.tsx`, `AgentWorkbenchScreen.tsx`, `agentWorkbenchChrome.ts`, `useAgentRightPanelChrome.ts`, `agentRightPanelGateways.ts`) delivers it as its final "Integration" step. The lead applies integration steps one at a time, in task-number order, and reruns that task's focused tests after each.

| Stream | Tasks (in order) | Write scope |
|---|---|---|
| A - panel model | 1 -> 2 -> 3 | layout domain, activation, catalog, strip, body switch, terminal strip, `TerminalTabsPanel` |
| B - diff | 4 -> 5 -> 6 (Task 6 needs 2, 3 and 7) | `src/domain/diffView`, worker gateway, diff sources/hook/UI, scope selection hook |
| C - backend (Rust + contracts) | 7 -> 8 -> 9 | `src-tauri`, new TS domain parsers, IPC contracts and gateways |
| D - git/pr/scripts/files UI | 10 (any time) -> 11 (needs 2, 7, 10) -> 12 (needs 9, 11) -> 13 (needs 8, 11) -> 14 (needs 2, 7) -> 15 (needs 2, 7) | commit selection, ship flow, git/pr/scripts/files surfaces |
| Wrap-up (lead) | 16 gates -> 17 review -> 18 QA -> 19 commit | - |

---
### Task 1: Surface kinds, transient kinds, remote serving, catalog and blocked reasons

**Files:**
- Modify: `src/domain/agentWorkbenchLayout.ts` (kind constants, `parseOpenSurfaces`, `serializeAgentWorkbenchLayout`)
- Modify: `src/domain/agentSurfaceActivation.ts`
- Create: `src/components/agentMode/rightPanel/agentRightPanelSurfaceCatalog.ts`
- Modify: `src/components/agentMode/agentSurfaceHotkeys.ts`, `src/components/agentMode/agentSurfacePolicy.ts`, `src/components/agentMode/AgentSurfaceEmptyState.tsx`, `src/components/agentMode/AgentSurfacePanel.tsx` (`agentSurfaceMask`, `RemoteSurfaceBody` kind type, temporary guard in `SurfaceBody`), `src/components/agentMode/AgentSurfaceHost.tsx` (remote guard line), `src/components/agentMode/useAgentSurfaceLayout.ts` (`surfaceBlocked` guard)
- Test: `src/domain/agentWorkbenchLayout.test.ts`, `src/domain/agentSurfaceActivation.test.ts`, `src/components/agentMode/agentSurfacePolicy.test.ts`, `src/components/agentMode/AgentSurfaceEmptyState.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `AGENT_SURFACE_KINDS = ["files","diff","terminal","history","git","scripts","pullRequest","agents"] as const`, `type AgentSurfaceKind`
  - `AGENT_TRANSIENT_SURFACE_KINDS: ReadonlyArray<AgentSurfaceKind>` (`pullRequest`, `agents`), `isAgentTransientSurfaceKind(kind: AgentSurfaceKind): boolean`
  - `AGENT_REMOTE_SURFACE_KINDS = ["files","history","terminal"] as const`, `type AgentRemoteSurfaceKind`, `isAgentRemoteSurfaceKind(kind: AgentSurfaceKind | null): kind is AgentRemoteSurfaceKind`
  - `interface AgentRightPanelSurfaceDescriptor { label; tabLabel; icon: LucideIcon; addMenuShortcut: string | null; description }`, `AGENT_RIGHT_PANEL_SURFACE_CATALOG: Readonly<Record<AgentSurfaceKind, AgentRightPanelSurfaceDescriptor>>`, `AGENT_RIGHT_PANEL_ADD_MENU_ORDER: ReadonlyArray<AgentSurfaceKind>`
  - `AGENT_SURFACE_HOTKEYS: Readonly<Record<AgentSurfaceKind, string | null>>`, `agentSurfaceForHotkey(key: string): AgentSurfaceKind | null`
  - `SURFACE_UNTRUSTED_GIT_REASON = "Trust this project to use Git, scripts and pull requests."`

- [ ] **Step 1: Write the failing domain tests**

Append to `src/domain/agentWorkbenchLayout.test.ts`:

```ts
describe("right panel surface kinds", () => {
  it("lists the redesigned surfaces in catalog order", () => {
    expect(AGENT_SURFACE_KINDS).toEqual([
      "files",
      "diff",
      "terminal",
      "history",
      "git",
      "scripts",
      "pullRequest",
      "agents",
    ]);
    expect(MAX_AGENT_OPEN_SURFACES).toBe(8);
  });

  it("never serializes the pull request or agents surfaces", () => {
    const withGit = agentWorkbenchLayoutReducer(initialAgentWorkbenchLayout, {
      kind: "openSurface",
      surface: "git",
    });
    const withPullRequest = agentWorkbenchLayoutReducer(withGit, {
      kind: "openSurface",
      surface: "pullRequest",
    });
    const withAgents = agentWorkbenchLayoutReducer(withPullRequest, {
      kind: "openSurface",
      surface: "agents",
    });

    const persisted = serializeAgentWorkbenchLayout(withAgents, false);

    expect(withAgents.openSurfaces).toEqual(["git", "pullRequest", "agents"]);
    expect(persisted.openSurfaces).toEqual(["git"]);
    expect(persisted.activeSurface).toBe("git");
  });

  it("drops transient kinds from persisted input, including the legacy single surface", () => {
    const parsed = parseAgentWorkbenchLayout({
      openSurfaces: ["agents", "files", "pullRequest", "scripts"],
      activeSurface: "agents",
      rightPanel: "open",
    });
    const legacy = parseAgentWorkbenchLayout({ rightSurface: "pullRequest" });

    expect(parsed.openSurfaces).toEqual(["files", "scripts"]);
    expect(parsed.activeSurface).toBeNull();
    expect(legacy.openSurfaces).toEqual([]);
    expect(isAgentTransientSurfaceKind("agents")).toBe(true);
    expect(isAgentTransientSurfaceKind("git")).toBe(false);
  });
});
```

Add `isAgentTransientSurfaceKind`, `parseAgentWorkbenchLayout` and `serializeAgentWorkbenchLayout` to the file's import list if missing.

Append to `src/domain/agentSurfaceActivation.test.ts`:

```ts
describe("redesigned surfaces on remote threads", () => {
  const remote: AgentSurfaceActivation = {
    remote: true,
    threadPresent: true,
    remoteCapabilities: { files: true, history: true, terminal: true },
    unavailable: false,
    hidden: false,
  };

  it("serves only the remote-capable kinds and diff", () => {
    expect(
      AGENT_SURFACE_KINDS.filter((kind) => agentSurfaceServes(remote, kind)),
    ).toEqual(["files", "diff", "terminal", "history"]);
  });

  it("serves every kind locally", () => {
    expect(
      AGENT_SURFACE_KINDS.every((kind) =>
        agentSurfaceServes(LOCAL_AGENT_SURFACE_ACTIVATION, kind),
      ),
    ).toBe(true);
  });

  it("narrows remote kinds", () => {
    expect(isAgentRemoteSurfaceKind("history")).toBe(true);
    expect(isAgentRemoteSurfaceKind("git")).toBe(false);
    expect(isAgentRemoteSurfaceKind(null)).toBe(false);
  });
});
```

Import `AGENT_SURFACE_KINDS` from `./agentWorkbenchLayout` and `isAgentRemoteSurfaceKind`, `LOCAL_AGENT_SURFACE_ACTIVATION`, `agentSurfaceServes`, `type AgentSurfaceActivation` from `./agentSurfaceActivation`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/domain/agentWorkbenchLayout.test.ts src/domain/agentSurfaceActivation.test.ts`
Expected: FAIL. `AGENT_SURFACE_KINDS` has 4 entries, and `isAgentTransientSurfaceKind` / `isAgentRemoteSurfaceKind` are not exported.

- [ ] **Step 3: Implement the layout domain change**

In `src/domain/agentWorkbenchLayout.ts` replace the first two lines with:

```ts
export const AGENT_SURFACE_KINDS = [
  "files",
  "diff",
  "terminal",
  "history",
  "git",
  "scripts",
  "pullRequest",
  "agents",
] as const;
export type AgentSurfaceKind = (typeof AGENT_SURFACE_KINDS)[number];

export const AGENT_TRANSIENT_SURFACE_KINDS: ReadonlyArray<AgentSurfaceKind> = Object.freeze([
  "pullRequest",
  "agents",
]);

export function isAgentTransientSurfaceKind(kind: AgentSurfaceKind): boolean {
  return AGENT_TRANSIENT_SURFACE_KINDS.includes(kind);
}
```

Replace `serializeAgentWorkbenchLayout` with:

```ts
export function serializeAgentWorkbenchLayout(
  state: AgentWorkbenchLayout,
  bottomPanel: boolean,
): AgentWorkbenchLayoutPersisted {
  const openSurfaces = state.openSurfaces.filter((kind) => !isAgentTransientSurfaceKind(kind));
  const activeSurface =
    state.activeSurface !== null && openSurfaces.includes(state.activeSurface)
      ? state.activeSurface
      : (openSurfaces[0] ?? null);
  return {
    layout: state.layout,
    rightPanel: state.rightPanel,
    openSurfaces,
    activeSurface,
    rightPanelMaximized: state.rightPanelMaximized,
    rail: state.rail,
    railWidth: state.railWidth,
    rightPanelWidth: state.rightPanelWidth,
    bottomPanelHeight: state.bottomPanelHeight,
    bottomPanel,
  };
}
```

Replace `parseOpenSurfaces` with:

```ts
function parseOpenSurfaces(value: Record<string, unknown>): ReadonlyArray<AgentSurfaceKind> {
  if (value.openSurfaces === undefined) {
    return isPersistableSurface(value.rightSurface) ? [value.rightSurface] : NO_SURFACES;
  }
  if (!Array.isArray(value.openSurfaces)) return NO_SURFACES;

  const surfaces: AgentSurfaceKind[] = [];
  for (const candidate of value.openSurfaces) {
    if (surfaces.length >= MAX_AGENT_OPEN_SURFACES) break;
    if (!isPersistableSurface(candidate) || surfaces.includes(candidate)) continue;
    surfaces.push(candidate);
  }
  return surfaces.length === 0 ? NO_SURFACES : surfaces;
}

function isPersistableSurface(value: unknown): value is AgentSurfaceKind {
  return isAgentSurfaceKind(value) && !isAgentTransientSurfaceKind(value);
}
```

`parseActiveSurface` already requires membership in `openSurfaces`, so a transient active kind parses to `null`.

- [ ] **Step 4: Implement remote serving**

In `src/domain/agentSurfaceActivation.ts` replace the `AgentRemoteSurfaceKind` line and `agentSurfaceServes` with:

```ts
export const AGENT_REMOTE_SURFACE_KINDS = ["files", "history", "terminal"] as const;
export type AgentRemoteSurfaceKind = (typeof AGENT_REMOTE_SURFACE_KINDS)[number];

export function isAgentRemoteSurfaceKind(
  kind: AgentSurfaceKind | null,
): kind is AgentRemoteSurfaceKind {
  return kind !== null && (AGENT_REMOTE_SURFACE_KINDS as ReadonlyArray<string>).includes(kind);
}

export function agentSurfaceServes(
  activation: AgentSurfaceActivation,
  kind: AgentSurfaceKind,
): boolean {
  if (!activation.remote) return true;
  if (kind === "diff") return activation.threadPresent;
  if (!isAgentRemoteSurfaceKind(kind)) return false;
  return remoteSurfaceCapabilityOpen(activation.remoteCapabilities, kind);
}
```

Update the three callers that relied on `Exclude<AgentSurfaceKind, "diff">`:
- `src/components/agentMode/AgentSurfaceHost.tsx`, in `remoteActiveAvailable`: replace `layout.activeSurface !== "diff" &&` with `isAgentRemoteSurfaceKind(layout.activeSurface) &&` (import it from `../../domain/agentSurfaceActivation`).
- `src/components/agentMode/useAgentSurfaceLayout.ts`, in `surfaceBlocked`: replace `surface !== "diff" && remoteSurfaceSupports(remoteSurface, surface)` with `isAgentRemoteSurfaceKind(surface) && remoteSurfaceSupports(remoteSurface, surface)`.
- `src/components/agentMode/AgentSurfacePanel.tsx`:
  - replace `server && kind !== "diff" && remoteSurface?.gateway` with `server && isAgentRemoteSurfaceKind(kind) && remoteSurface?.gateway`;
  - type `RemoteSurfaceBody`'s `kind` as `AgentRemoteSurfaceKind`.

- [ ] **Step 5: Create the surface catalog**

Create `src/components/agentMode/rightPanel/agentRightPanelSurfaceCatalog.ts`:

```ts
import {
  FileDiff,
  Files,
  GitBranch,
  GitPullRequest,
  History,
  Play,
  SquareTerminal,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { AgentSurfaceKind } from "../../../domain/agentWorkbenchLayout";

export interface AgentRightPanelSurfaceDescriptor {
  readonly label: string;
  readonly tabLabel: string;
  readonly icon: LucideIcon;
  readonly addMenuShortcut: string | null;
  readonly description: string;
}

export const AGENT_RIGHT_PANEL_SURFACE_CATALOG: Readonly<
  Record<AgentSurfaceKind, AgentRightPanelSurfaceDescriptor>
> = Object.freeze({
  terminal: {
    label: "Terminal",
    tabLabel: "Terminal",
    icon: SquareTerminal,
    addMenuShortcut: "T",
    description: "Start a shell in the thread's checkout.",
  },
  files: {
    label: "Files",
    tabLabel: "Files",
    icon: Files,
    addMenuShortcut: "F",
    description: "Browse and edit the thread's checkout.",
  },
  diff: {
    label: "Diff",
    tabLabel: "Diff",
    icon: FileDiff,
    addMenuShortcut: "D",
    description: "Review changes in this thread.",
  },
  git: {
    label: "Git",
    tabLabel: "Git",
    icon: GitBranch,
    addMenuShortcut: "G",
    description: "Commit, push and switch branches.",
  },
  scripts: {
    label: "Scripts",
    tabLabel: "Scripts",
    icon: Play,
    addMenuShortcut: "S",
    description: "Run package scripts and project actions.",
  },
  pullRequest: {
    label: "Pull request",
    tabLabel: "New pull request",
    icon: GitPullRequest,
    addMenuShortcut: "P",
    description: "Open a pull request for this branch.",
  },
  history: {
    label: "History",
    tabLabel: "History",
    icon: History,
    addMenuShortcut: "H",
    description: "Browse commits and file changes across your repositories.",
  },
  agents: {
    label: "Agents",
    tabLabel: "Agents",
    icon: Users,
    addMenuShortcut: null,
    description: "Subagents working in this thread.",
  },
});

export const AGENT_RIGHT_PANEL_ADD_MENU_ORDER: ReadonlyArray<AgentSurfaceKind> = Object.freeze([
  "terminal",
  "files",
  "diff",
  "git",
  "scripts",
  "pullRequest",
  "history",
]);
```

- [ ] **Step 6: Derive hotkeys from the catalog**

Replace `src/components/agentMode/agentSurfaceHotkeys.ts` with:

```ts
import { AGENT_SURFACE_KINDS, type AgentSurfaceKind } from "../../domain/agentWorkbenchLayout";
import { AGENT_RIGHT_PANEL_SURFACE_CATALOG } from "./rightPanel/agentRightPanelSurfaceCatalog";

export const AGENT_SURFACE_HOTKEYS: Readonly<Record<AgentSurfaceKind, string | null>> =
  Object.freeze(
    Object.fromEntries(
      AGENT_SURFACE_KINDS.map((kind) => [
        kind,
        AGENT_RIGHT_PANEL_SURFACE_CATALOG[kind].addMenuShortcut,
      ]),
    ) as Record<AgentSurfaceKind, string | null>,
  );

export function agentSurfaceForHotkey(key: string): AgentSurfaceKind | null {
  if (key.length !== 1) return null;
  const upper = key.toUpperCase();
  return AGENT_SURFACE_KINDS.find((kind) => AGENT_SURFACE_HOTKEYS[kind] === upper) ?? null;
}
```

- [ ] **Step 7: Write the failing policy and chooser tests**

Append to `src/components/agentMode/agentSurfacePolicy.test.ts`:

```ts
describe("git, scripts and pull request surfaces", () => {
  it("require a trusted workspace for a thread", () => {
    const thread = surfaceThreadView();
    for (const kind of ["git", "scripts", "pullRequest"] as const) {
      expect(agentSurfaceBlockedReason(kind, thread, false, SURFACE_FIXTURE_ROOT)).toBe(
        SURFACE_UNTRUSTED_GIT_REASON,
      );
      expect(agentSurfaceBlockedReason(kind, thread, true, SURFACE_FIXTURE_ROOT)).toBeNull();
    }
  });

  it("never blocks the agents surface", () => {
    expect(agentSurfaceBlockedReason("agents", null, false, null)).toBeNull();
  });

  it("blocks them for remote threads", () => {
    const remote = surfaceThreadView({ threadId: "remote:srv:thread-1" });
    expect(agentSurfaceBlockedReason("git", remote, true, SURFACE_FIXTURE_ROOT)).toBe(
      SURFACE_REMOTE_UNAVAILABLE_REASON,
    );
  });
});
```

Use the fixture helpers already imported in that file (`surfaceThreadView`, and the root constant it uses today; if the constant has another name, use that name). If `surfaceThreadView` does not accept a `threadId` override, build the remote view the same way the file's existing remote test does.

Append to `src/components/agentMode/AgentSurfaceEmptyState.test.tsx` a test that renders the chooser for a trusted local thread and asserts the card labels in order:

```ts
it("offers the redesigned surfaces in add-menu order", () => {
  const host = renderChooser({ thread: surfaceThreadView(), workspaceTrusted: true });
  expect(
    [...host.querySelectorAll(".agent-surface-card__label")].map((node) => node.textContent),
  ).toEqual(["Terminal", "Files", "Diff", "Git", "Scripts", "Pull request", "History"]);
});
```

`renderChooser` stands for the file's existing mount helper. Use its real name and argument shape.

- [ ] **Step 8: Run to verify they fail**

Run: `npx vitest run src/components/agentMode/agentSurfacePolicy.test.ts src/components/agentMode/AgentSurfaceEmptyState.test.tsx`
Expected: FAIL (`SURFACE_UNTRUSTED_GIT_REASON` missing; cards list 4 kinds).

- [ ] **Step 9: Implement the policy**

In `src/components/agentMode/agentSurfacePolicy.ts` add the constant and replace `agentSurfaceBlockedReason`:

```ts
export const SURFACE_UNTRUSTED_GIT_REASON =
  "Trust this project to use Git, scripts and pull requests.";

export function agentSurfaceBlockedReason(
  kind: AgentSurfaceKind,
  thread: AgentThreadView | null,
  workspaceTrusted: boolean,
  workspaceRoot: string | null,
  scope: AgentSurfaceScope = NO_AGENT_SURFACE_SCOPE,
): string | null {
  if (kind === "agents") return null;
  if (isRemoteAgentSurfaceThread(thread))
    return kind === "diff" ? null : SURFACE_REMOTE_UNAVAILABLE_REASON;
  if (kind === "files" || kind === "history") return filesSurfaceBlockedReason(thread);
  if (thread === null) {
    if (scope.kind !== "repository" || scope.rootPath !== workspaceRoot) {
      return SURFACE_NO_PROJECT_REASON;
    }
    if (!workspaceTrusted) return SURFACE_UNTRUSTED_TERMINAL_REASON;
    return null;
  }
  if (agentSurfaceTargetGone(thread)) return SURFACE_WORKTREE_GONE_REASON;
  if (kind === "git" || kind === "scripts" || kind === "pullRequest") {
    return workspaceTrusted ? null : SURFACE_UNTRUSTED_GIT_REASON;
  }
  if (kind !== "terminal") return null;
  if (agentSurfaceTerminalRootMismatch(thread, workspaceRoot)) {
    return SURFACE_FOREIGN_ROOT_TERMINAL_REASON;
  }
  if (!workspaceTrusted) return SURFACE_UNTRUSTED_TERMINAL_REASON;
  return null;
}
```

- [ ] **Step 10: Drive the chooser from the catalog**

In `src/components/agentMode/AgentSurfaceEmptyState.tsx`:
- delete `SurfaceCard`, `CARDS` and the `lucide-react` import;
- import `AGENT_RIGHT_PANEL_ADD_MENU_ORDER`, `AGENT_RIGHT_PANEL_SURFACE_CATALOG` from `./rightPanel/agentRightPanelSurfaceCatalog` and `isAgentRemoteSurfaceKind` from `../../domain/agentSurfaceActivation`;
- replace the `blockedReason` helper, the hotkey guard and the list source as below.

```ts
const remoteServes = (kind: AgentSurfaceKind): boolean =>
  kind === "diff"
    ? thread !== null
    : isAgentRemoteSurfaceKind(kind) && remoteSurfaceSupports(remoteSurface, kind);
const blockedReason = (kind: AgentSurfaceKind): string | null =>
  server && kind !== "diff" && remoteServes(kind)
    ? null
    : agentSurfaceBlockedReason(kind, thread, workspaceTrusted, workspaceRoot, scope);
```

```ts
if (surface === null || (server && !remoteServes(surface)) || blockedReason(surface) !== null)
  return;
```

```tsx
{AGENT_RIGHT_PANEL_ADD_MENU_ORDER.filter((kind) => !server || remoteServes(kind)).map((kind) => {
  const card = AGENT_RIGHT_PANEL_SURFACE_CATALOG[kind];
  const reason = blockedReason(kind);
  const Icon = card.icon;
  const shortcut = AGENT_SURFACE_HOTKEYS[kind];
```

Keep the rest of the card JSX. Change `aria-keyshortcuts={AGENT_SURFACE_HOTKEYS[kind]}` to `aria-keyshortcuts={shortcut ?? undefined}`, and render the `<kbd>` only when `shortcut !== null`. In `AgentSurfaceEmptyState.tsx` keep `(["files", "terminal", "history"] as const)` for `unavailableSurfaces` (these are the remote kinds).

- [ ] **Step 11: Keep the panel compiling until Task 2**

In `src/components/agentMode/AgentSurfacePanel.tsx`:
- Replace `agentSurfaceMask` with the exhaustive version:

```ts
function agentSurfaceMask(surface: AgentSurfaceKind): number {
  switch (surface) {
    case "files":
      return 1;
    case "diff":
      return 2;
    case "terminal":
      return 4;
    case "history":
      return 8;
    case "git":
      return 16;
    case "scripts":
      return 32;
    case "pullRequest":
      return 64;
    case "agents":
      return 128;
  }
}
```

- Change `return hidden ? openMask | 16 : openMask;` to `return hidden ? openMask | 256 : openMask;`.
- Replace `const tab = TABS.find((candidate) => candidate.kind === kind) ?? TABS[0];` with `const tab = { ...AGENT_RIGHT_PANEL_SURFACE_CATALOG[kind], kind };`, and delete `TABS` and `SurfaceTab`.
- At the top of `SurfaceBody` add:

```tsx
if (kind === "git" || kind === "scripts" || kind === "pullRequest" || kind === "agents") {
  return <p className="agent-note">{AGENT_RIGHT_PANEL_SURFACE_CATALOG[kind].label} opens here.</p>;
}
```

(This guard is deleted in Task 2.)

- [ ] **Step 12: Run the focused suites**

Run: `npx vitest run src/domain/agentWorkbenchLayout.test.ts src/domain/agentSurfaceActivation.test.ts src/components/agentMode/agentSurfacePolicy.test.ts src/components/agentMode/AgentSurfaceEmptyState.test.tsx src/components/agentMode/AgentSurfacePanel.test.tsx src/components/agentMode/AgentSurfaceHost.test.tsx src/components/agentMode/useAgentSurfaceLayout.test.tsx && npm run check`
Expected: PASS, and `tsc` exit 0. If an existing test asserted exactly four chooser cards or the old `History` first-card order, update that assertion to the catalog order: the catalog is now the product order (mockup add menu + History).

- [ ] **Step 13: Hand off (no commit)**

Report the changed files and the command output.

---

### Task 2: Tab strip, add menu, body switch, agents slot and surface toggles

**Files:**
- Create: `src/components/agentMode/rightPanel/agentRightPanelTabEntries.ts`, `src/components/agentMode/rightPanel/AgentRightPanelTabStrip.tsx`, `src/components/agentMode/rightPanel/AgentRightPanelSurfaceBody.tsx`, `src/components/agentMode/rightPanel/rightPanel.css`
- Modify: `src/components/agentMode/AgentSurfacePanel.tsx`, `src/components/agentMode/AgentSurfaceHost.tsx` (prop pass-through `agentsPanel`), `src/components/agentMode/useAgentSurfaceLayout.ts` (`toggleSurface`, `isSurfaceOpen`)
- Test: `src/components/agentMode/rightPanel/agentRightPanelTabEntries.test.ts`, `src/components/agentMode/rightPanel/AgentRightPanelTabStrip.test.tsx`, `src/components/agentMode/useAgentSurfaceLayout.test.tsx`, `src/components/agentMode/AgentSurfacePanel.test.tsx`

**Interfaces:**
- Consumes: Task 1 catalog, `AgentSurfaceKind`.
- Produces:
  - `interface AgentTerminalStripSession { id: string; title: string; live: boolean; closable: boolean }`, `interface AgentTerminalStripState { sessions: ReadonlyArray<AgentTerminalStripSession>; activeSessionId: string | null }`
  - `interface AgentRightPanelEditorDocument { documentId; title; path; dirty; preview }`, `interface AgentRightPanelEditorDocuments { documents; activeDocumentId; surfaceActive: boolean; onActivate(documentId): void; onClose(documentId): void; onOpenFile(): void }` (P7 fills it)
  - `type AgentRightPanelTabEntry` (`surface` | `terminalSession` | `editorDocument`), `agentRightPanelTabEntries(input: AgentRightPanelTabEntriesInput): ReadonlyArray<AgentRightPanelTabEntry>`, `selectedAgentRightPanelTabId(entries): string | null`, `agentSurfacePanelId(kind): string`
  - `AgentRightPanelTabStrip(props: AgentRightPanelTabStripProps)`
  - `AgentRightPanelSurfaceBody(props: AgentRightPanelSurfaceBodyProps)`: exhaustive per-kind body, with the `agentsPanel?: ReactNode` slot
  - `useAgentSurfaceLayout` returns additionally `toggleSurface(kind: AgentSurfaceKind): void`, `isSurfaceOpen(kind: AgentSurfaceKind): boolean`
  - `AgentSurfacePanelProps` gains `agentsPanel?: ReactNode`, `editorDocuments?: AgentRightPanelEditorDocuments | null`, `terminalStrip?: AgentTerminalStripState | null`, `onTerminalSessionCommand?(command: AgentTerminalSessionCommand): void`. Task 3 sets the last two from `useAgentTerminalStrip`.
  - `type AgentTerminalSessionCommand = { kind: "activate"; sessionId: string } | { kind: "close"; sessionId: string } | { kind: "create" }`

- [ ] **Step 1: Write the failing presenter test**

Create `src/components/agentMode/rightPanel/agentRightPanelTabEntries.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  agentRightPanelTabEntries,
  selectedAgentRightPanelTabId,
  type AgentRightPanelEditorDocuments,
} from "./agentRightPanelTabEntries";

const noEditor = null;

describe("agentRightPanelTabEntries", () => {
  it("lists open surfaces in order with the active one selected", () => {
    const entries = agentRightPanelTabEntries({
      openSurfaces: ["diff", "files", "git"],
      activeSurface: "files",
      terminal: null,
      editorDocuments: noEditor,
    });

    expect(entries.map((entry) => entry.label)).toEqual(["Diff", "Files", "Git"]);
    expect(selectedAgentRightPanelTabId(entries)).toBe("surface:files");
  });

  it("expands the terminal surface into one tab per session in its position", () => {
    const entries = agentRightPanelTabEntries({
      openSurfaces: ["diff", "terminal", "git"],
      activeSurface: "terminal",
      terminal: {
        sessions: [
          { id: "terminal-0", title: "dev", live: true, closable: true },
          { id: "terminal-1", title: "zsh", live: false, closable: true },
        ],
        activeSessionId: "terminal-1",
      },
      editorDocuments: noEditor,
    });

    expect(entries.map((entry) => entry.id)).toEqual([
      "surface:diff",
      "terminal:terminal-0",
      "terminal:terminal-1",
      "surface:git",
    ]);
    expect(selectedAgentRightPanelTabId(entries)).toBe("terminal:terminal-1");
    expect(entries[1]).toMatchObject({ kind: "terminalSession", live: true });
  });

  it("falls back to one Terminal tab before the sessions are known", () => {
    const entries = agentRightPanelTabEntries({
      openSurfaces: ["terminal"],
      activeSurface: "terminal",
      terminal: { sessions: [], activeSessionId: null },
      editorDocuments: noEditor,
    });

    expect(entries).toEqual([
      expect.objectContaining({ id: "surface:terminal", label: "Terminal", active: true }),
    ]);
  });

  it("places editor documents first and marks only the active one", () => {
    const editorDocuments: AgentRightPanelEditorDocuments = {
      documents: [
        { documentId: "a", title: "orders.ts", path: "/r/src/orders.ts", dirty: false, preview: false },
        { documentId: "b", title: "app.ts", path: "/r/src/app.ts", dirty: true, preview: true },
      ],
      activeDocumentId: "b",
      surfaceActive: true,
      onActivate: () => undefined,
      onClose: () => undefined,
      onOpenFile: () => undefined,
    };

    const entries = agentRightPanelTabEntries({
      openSurfaces: ["diff"],
      activeSurface: null,
      terminal: null,
      editorDocuments,
    });

    expect(entries.map((entry) => entry.id)).toEqual(["editor:a", "editor:b", "surface:diff"]);
    expect(selectedAgentRightPanelTabId(entries)).toBe("editor:b");
    expect(entries[1]).toMatchObject({ dirty: true, preview: true });
  });

  it("uses the tab label for the pull request surface", () => {
    const entries = agentRightPanelTabEntries({
      openSurfaces: ["pullRequest"],
      activeSurface: "pullRequest",
      terminal: null,
      editorDocuments: noEditor,
    });
    expect(entries[0]?.label).toBe("New pull request");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/agentMode/rightPanel/agentRightPanelTabEntries.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the presenter**

Create `src/components/agentMode/rightPanel/agentRightPanelTabEntries.ts`:

```ts
import type { AgentSurfaceKind } from "../../../domain/agentWorkbenchLayout";
import { AGENT_RIGHT_PANEL_SURFACE_CATALOG } from "./agentRightPanelSurfaceCatalog";

export const MAX_AGENT_RIGHT_PANEL_EDITOR_TABS = 32;
export const AGENT_EDITOR_DOCUMENT_PANEL_ID = "agent-surface-panel-editor";

export interface AgentTerminalStripSession {
  readonly id: string;
  readonly title: string;
  readonly live: boolean;
  readonly closable: boolean;
}

export interface AgentTerminalStripState {
  readonly sessions: ReadonlyArray<AgentTerminalStripSession>;
  readonly activeSessionId: string | null;
}

export type AgentTerminalSessionCommand =
  | { readonly kind: "activate"; readonly sessionId: string }
  | { readonly kind: "close"; readonly sessionId: string }
  | { readonly kind: "create" };

export interface AgentRightPanelEditorDocument {
  readonly documentId: string;
  readonly title: string;
  readonly path: string;
  readonly dirty: boolean;
  readonly preview: boolean;
}

export interface AgentRightPanelEditorDocuments {
  readonly documents: ReadonlyArray<AgentRightPanelEditorDocument>;
  readonly activeDocumentId: string | null;
  readonly surfaceActive: boolean;
  onActivate(documentId: string): void;
  onClose(documentId: string): void;
  onOpenFile(): void;
}

export type AgentRightPanelTabEntry =
  | {
      readonly kind: "surface";
      readonly id: string;
      readonly surface: AgentSurfaceKind;
      readonly label: string;
      readonly active: boolean;
      readonly panelId: string;
    }
  | {
      readonly kind: "terminalSession";
      readonly id: string;
      readonly sessionId: string;
      readonly label: string;
      readonly live: boolean;
      readonly closable: boolean;
      readonly active: boolean;
      readonly panelId: string;
    }
  | {
      readonly kind: "editorDocument";
      readonly id: string;
      readonly documentId: string;
      readonly label: string;
      readonly path: string;
      readonly dirty: boolean;
      readonly preview: boolean;
      readonly active: boolean;
      readonly panelId: string;
    };

export interface AgentRightPanelTabEntriesInput {
  readonly openSurfaces: ReadonlyArray<AgentSurfaceKind>;
  readonly activeSurface: AgentSurfaceKind | null;
  readonly terminal: AgentTerminalStripState | null;
  readonly editorDocuments: AgentRightPanelEditorDocuments | null;
}

export function agentSurfacePanelId(kind: AgentSurfaceKind): string {
  return `agent-surface-panel-${kind}`;
}

export function agentRightPanelTabEntries(
  input: AgentRightPanelTabEntriesInput,
): ReadonlyArray<AgentRightPanelTabEntry> {
  return [
    ...editorEntries(input.editorDocuments),
    ...input.openSurfaces.flatMap((surface) => surfaceEntries(surface, input)),
  ];
}

export function selectedAgentRightPanelTabId(
  entries: ReadonlyArray<AgentRightPanelTabEntry>,
): string | null {
  return entries.find((entry) => entry.active)?.id ?? null;
}

function editorEntries(
  documents: AgentRightPanelEditorDocuments | null,
): ReadonlyArray<AgentRightPanelTabEntry> {
  if (documents === null) return [];
  return documents.documents.slice(0, MAX_AGENT_RIGHT_PANEL_EDITOR_TABS).map((document) => ({
    kind: "editorDocument",
    id: `editor:${document.documentId}`,
    documentId: document.documentId,
    label: document.title,
    path: document.path,
    dirty: document.dirty,
    preview: document.preview,
    active: documents.surfaceActive && documents.activeDocumentId === document.documentId,
    panelId: AGENT_EDITOR_DOCUMENT_PANEL_ID,
  }));
}

function surfaceEntries(
  surface: AgentSurfaceKind,
  input: AgentRightPanelTabEntriesInput,
): ReadonlyArray<AgentRightPanelTabEntry> {
  const active = input.activeSurface === surface;
  const terminal = input.terminal;
  if (surface === "terminal" && terminal !== null && terminal.sessions.length > 0) {
    return terminal.sessions.map((session) => ({
      kind: "terminalSession",
      id: `terminal:${session.id}`,
      sessionId: session.id,
      label: session.title,
      live: session.live,
      closable: session.closable,
      active: active && terminal.activeSessionId === session.id,
      panelId: agentSurfacePanelId("terminal"),
    }));
  }
  return [
    {
      kind: "surface",
      id: `surface:${surface}`,
      surface,
      label: AGENT_RIGHT_PANEL_SURFACE_CATALOG[surface].tabLabel,
      active,
      panelId: agentSurfacePanelId(surface),
    },
  ];
}
```

- [ ] **Step 4: Run the presenter test**

Run: `npx vitest run src/components/agentMode/rightPanel/agentRightPanelTabEntries.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing strip test**

Create `src/components/agentMode/rightPanel/AgentRightPanelTabStrip.test.tsx`:

```tsx
// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { click, mountUi, press, type MountedUi } from "../../../ui/foundation/foundationTestSupport";
import { AgentRightPanelTabStrip, type AgentRightPanelTabStripProps } from "./AgentRightPanelTabStrip";
import { agentRightPanelTabEntries } from "./agentRightPanelTabEntries";

let ui: MountedUi | null = null;

afterEach(() => {
  ui?.unmount();
  ui = null;
});

function props(overrides: Partial<AgentRightPanelTabStripProps> = {}): AgentRightPanelTabStripProps {
  return {
    entries: agentRightPanelTabEntries({
      openSurfaces: ["diff", "terminal", "git"],
      activeSurface: "diff",
      terminal: {
        sessions: [
          { id: "terminal-0", title: "dev", live: true, closable: true },
          { id: "terminal-1", title: "zsh", live: false, closable: true },
        ],
        activeSessionId: "terminal-0",
      },
      editorDocuments: null,
    }),
    addableSurfaces: ["terminal", "files", "diff", "git", "scripts", "pullRequest", "history"],
    editorDocuments: null,
    onActivateSurface: vi.fn(),
    onCloseSurface: vi.fn(),
    onTerminalSessionCommand: vi.fn(),
    onAddSurface: vi.fn(),
    ...overrides,
  };
}

function mount(value: AgentRightPanelTabStripProps): HTMLElement {
  ui = mountUi();
  ui.render(<AgentRightPanelTabStrip {...value} />);
  return ui.host;
}

describe("AgentRightPanelTabStrip", () => {
  it("renders one tab per surface and per terminal session with a live dot", () => {
    const host = mount(props());
    const tabs = [...host.querySelectorAll<HTMLElement>('[role="tab"]')];

    expect(tabs.map((tab) => tab.title)).toEqual(["Diff", "dev", "zsh", "Git"]);
    expect(tabs[0]?.getAttribute("aria-selected")).toBe("true");
    expect(tabs[1]?.querySelector('[aria-label="Running"]')).not.toBeNull();
    expect(tabs[2]?.querySelector('[aria-label="Running"]')).toBeNull();
  });

  it("activates a terminal session through the terminal surface", () => {
    const value = props();
    const host = mount(value);
    click(host.querySelectorAll('[role="tab"]')[2] as Element);

    expect(value.onActivateSurface).toHaveBeenCalledWith("terminal");
    expect(value.onTerminalSessionCommand).toHaveBeenCalledWith({
      kind: "activate",
      sessionId: "terminal-1",
    });
  });

  it("closes a session with Delete and a surface with its close glyph", () => {
    const value = props();
    const host = mount(value);
    const tabs = host.querySelectorAll<HTMLElement>('[role="tab"]');
    click(tabs[1] as Element);
    press(tabs[1] as Element, "Delete");
    click(tabs[3]?.querySelector(".cv-tab__close") as Element);

    expect(value.onTerminalSessionCommand).toHaveBeenCalledWith({
      kind: "close",
      sessionId: "terminal-0",
    });
    expect(value.onCloseSurface).toHaveBeenCalledWith("git");
  });

  it("adds surfaces from the + menu with their shortcut letters", () => {
    const value = props();
    const host = mount(value);
    click(host.querySelector('[aria-label="Add panel surface"]') as Element);
    const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];

    expect(items.map((item) => item.textContent)).toEqual([
      "TerminalT",
      "FilesF",
      "DiffD",
      "GitG",
      "ScriptsS",
      "Pull requestP",
      "HistoryH",
    ]);
    click(items[3] as Element);
    expect(value.onAddSurface).toHaveBeenCalledWith("git");
  });

  it("shows the Open file button only when editor documents are provided", () => {
    const onOpenFile = vi.fn();
    const host = mount(
      props({
        editorDocuments: {
          documents: [],
          activeDocumentId: null,
          surfaceActive: false,
          onActivate: vi.fn(),
          onClose: vi.fn(),
          onOpenFile,
        },
      }),
    );
    click(host.querySelector('[aria-label="Open file"]') as Element);
    expect(onOpenFile).toHaveBeenCalledOnce();
  });
});
```

If `MenuItem` renders the shortcut in a `Kbd` element, `textContent` concatenates the label and the letter as above. If the markup inserts separators, assert with `toContain` per item instead.

- [ ] **Step 6: Run to verify it fails**

Run: `npx vitest run src/components/agentMode/rightPanel/AgentRightPanelTabStrip.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 7: Implement the strip**

Create `src/components/agentMode/rightPanel/AgentRightPanelTabStrip.tsx`:

```tsx
import { FileDiff, FilePlus, Plus, SquareTerminal, FileText } from "lucide-react";
import { useRef, useState } from "react";
import type { AgentSurfaceKind } from "../../../domain/agentWorkbenchLayout";
import { Menu } from "../../../ui/foundation/Menu";
import { MenuItem } from "../../../ui/foundation/MenuItem";
import { PanelTabs, type PanelTabItem } from "../../../ui/foundation/PanelTabs";
import { AGENT_RIGHT_PANEL_SURFACE_CATALOG } from "./agentRightPanelSurfaceCatalog";
import {
  selectedAgentRightPanelTabId,
  type AgentRightPanelEditorDocuments,
  type AgentRightPanelTabEntry,
  type AgentTerminalSessionCommand,
} from "./agentRightPanelTabEntries";
import "./rightPanel.css";

export interface AgentRightPanelTabStripProps {
  readonly entries: ReadonlyArray<AgentRightPanelTabEntry>;
  readonly addableSurfaces: ReadonlyArray<AgentSurfaceKind>;
  readonly editorDocuments: AgentRightPanelEditorDocuments | null;
  onActivateSurface(kind: AgentSurfaceKind): void;
  onCloseSurface(kind: AgentSurfaceKind): void;
  onTerminalSessionCommand(command: AgentTerminalSessionCommand): void;
  onAddSurface(kind: AgentSurfaceKind): void;
}

export function AgentRightPanelTabStrip(props: AgentRightPanelTabStripProps) {
  const addRef = useRef<HTMLButtonElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const byId = new Map(props.entries.map((entry) => [entry.id, entry]));

  const select = (id: string): void => {
    const entry = byId.get(id);
    if (entry === undefined) return;
    activateEntry(entry, props);
  };
  const close = (id: string): void => {
    const entry = byId.get(id);
    if (entry === undefined) return;
    closeEntry(entry, props);
  };
  const add = (kind: AgentSurfaceKind): void => {
    setMenuOpen(false);
    props.onAddSurface(kind);
  };

  return (
    <div className="cv-rp-strip">
      <div className="cv-rp-strip__tabs">
        <PanelTabs
          label="Panel surfaces"
          onClose={close}
          onSelect={select}
          selectedId={selectedAgentRightPanelTabId(props.entries)}
          tabs={props.entries.map(panelTab)}
        />
      </div>
      {props.editorDocuments !== null && (
        <button
          aria-label="Open file"
          className="cv-icon-button cv-icon-button--xs"
          onClick={props.editorDocuments.onOpenFile}
          title="Open file ⌘P"
          type="button"
        >
          <span aria-hidden="true" className="cv-icon-button__glyph">
            <FilePlus size={14} />
          </span>
        </button>
      )}
      <button
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        aria-label="Add panel surface"
        className="cv-icon-button cv-icon-button--xs"
        onClick={() => setMenuOpen((open) => !open)}
        ref={addRef}
        title="Add surface"
        type="button"
      >
        <span aria-hidden="true" className="cv-icon-button__glyph">
          <Plus size={14} />
        </span>
      </button>
      <Menu anchorRef={addRef} label="Add panel surface" onClose={() => setMenuOpen(false)} open={menuOpen}>
        {props.addableSurfaces.map((kind) => {
          const descriptor = AGENT_RIGHT_PANEL_SURFACE_CATALOG[kind];
          const Icon = descriptor.icon;
          return (
            <MenuItem
              icon={<Icon size={14} />}
              key={kind}
              onSelect={() => add(kind)}
              shortcut={descriptor.addMenuShortcut ?? undefined}
            >
              {descriptor.label}
            </MenuItem>
          );
        })}
      </Menu>
    </div>
  );
}

function panelTab(entry: AgentRightPanelTabEntry): PanelTabItem {
  switch (entry.kind) {
    case "surface": {
      const Icon = AGENT_RIGHT_PANEL_SURFACE_CATALOG[entry.surface].icon;
      return { id: entry.id, title: entry.label, icon: <Icon size={14} />, panelId: entry.panelId };
    }
    case "terminalSession":
      return {
        id: entry.id,
        title: entry.label,
        icon: <SquareTerminal size={14} />,
        panelId: entry.panelId,
        live: entry.live,
        closable: entry.closable,
      };
    case "editorDocument":
      return {
        id: entry.id,
        title: entry.label,
        icon: entry.preview ? <FileText size={14} /> : <FileDiff size={14} />,
        panelId: entry.panelId,
        dirty: entry.dirty,
        preview: entry.preview,
      };
  }
}

function activateEntry(entry: AgentRightPanelTabEntry, props: AgentRightPanelTabStripProps): void {
  switch (entry.kind) {
    case "surface":
      props.onActivateSurface(entry.surface);
      return;
    case "terminalSession":
      props.onActivateSurface("terminal");
      props.onTerminalSessionCommand({ kind: "activate", sessionId: entry.sessionId });
      return;
    case "editorDocument":
      props.editorDocuments?.onActivate(entry.documentId);
      return;
  }
}

function closeEntry(entry: AgentRightPanelTabEntry, props: AgentRightPanelTabStripProps): void {
  switch (entry.kind) {
    case "surface":
      props.onCloseSurface(entry.surface);
      return;
    case "terminalSession":
      props.onTerminalSessionCommand({ kind: "close", sessionId: entry.sessionId });
      return;
    case "editorDocument":
      props.editorDocuments?.onClose(entry.documentId);
      return;
  }
}
```

Replace the editor-document icon choice with a neutral file glyph if the reviewer prefers. The mockup editor tabs use a file icon; `FileText` for both is acceptable. Keep one icon import in that case.

Create `src/components/agentMode/rightPanel/rightPanel.css`:

```css
.cv-rp-strip {
  flex: 1;
  min-width: 0;
  height: 100%;
  display: flex;
  align-items: center;
  gap: var(--cv-space-1);
}

.cv-rp-strip__tabs {
  flex: 1;
  min-width: 0;
  height: 100%;
  display: flex;
  align-items: center;
  overflow-x: auto;
  scrollbar-width: none;
}

.cv-rp-strip__tabs::-webkit-scrollbar {
  display: none;
}

.cv-rp-sub {
  height: 40px;
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--cv-space-2);
  padding: 0 var(--cv-space-3) 0 var(--cv-space-2);
  border-bottom: 1px solid var(--cv-hair);
}

.cv-rp-sub__grow {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--cv-space-2);
  overflow: hidden;
}

.cv-rp-sub__tools {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 2px;
}

.cv-rp-stat {
  display: inline-flex;
  gap: var(--cv-space-1);
  font-family: var(--cv-font-mono);
  font-size: var(--cv-t-xs);
}

.cv-rp-stat__add {
  color: var(--cv-ok);
}

.cv-rp-stat__del {
  color: var(--cv-danger);
}

.cv-rp-note {
  margin: var(--cv-space-4);
  font-size: var(--cv-t-xs);
  color: var(--cv-fg-subtle);
}

.cv-rp-note--warning {
  color: var(--cv-warn);
}
```

- [ ] **Step 8: Run the strip test**

Run: `npx vitest run src/components/agentMode/rightPanel/AgentRightPanelTabStrip.test.tsx`
Expected: PASS.

- [ ] **Step 9: Write the failing layout toggle test**

Append to `src/components/agentMode/useAgentSurfaceLayout.test.tsx` (use the file's existing harness that renders the hook with a chrome whose `layout.dispatch` drives `agentWorkbenchLayoutReducer`):

```tsx
it("toggles a surface closed when it is the active tab and open otherwise", async () => {
  const harness = renderSurfaceLayout();
  act(() => harness.current().toggleSurface("agents"));
  expect(harness.current().layout.activeSurface).toBe("agents");
  expect(harness.current().isSurfaceOpen("agents")).toBe(true);

  act(() => harness.current().openSurface("git"));
  act(() => harness.current().toggleSurface("agents"));
  expect(harness.current().layout.activeSurface).toBe("agents");

  act(() => harness.current().toggleSurface("agents"));
  expect(harness.current().isSurfaceOpen("agents")).toBe(false);
  expect(harness.current().layout.activeSurface).toBe("git");
});
```

`renderSurfaceLayout` stands for the file's existing harness. Use its real name and return shape.

- [ ] **Step 10: Implement the toggles**

In `src/components/agentMode/useAgentSurfaceLayout.ts` add to the interface:

```ts
  toggleSurface(surface: AgentSurfaceKind): void;
  isSurfaceOpen(surface: AgentSurfaceKind): boolean;
```

and in the hook, after `closeSurfaceTab`:

```ts
  const toggleSurface = useCallback(
    (surface: AgentSurfaceKind) => {
      if (
        layout.rightPanel === "open" &&
        layout.activeSurface === surface &&
        layout.openSurfaces.includes(surface)
      ) {
        dispatchLayout({ kind: "closeSurfaceTab", surface });
        return;
      }
      setChooserRequested(false);
      dispatchLayout({ kind: "openSurface", surface });
    },
    [dispatchLayout, layout.activeSurface, layout.openSurfaces, layout.rightPanel],
  );
  const isSurfaceOpen = useCallback(
    (surface: AgentSurfaceKind) =>
      layout.rightPanel === "open" && layout.openSurfaces.includes(surface),
    [layout.openSurfaces, layout.rightPanel],
  );
```

Add both to the returned object. Do not touch P2's `resizeRightPanel` member.

- [ ] **Step 11: Create the body switch**

Create `src/components/agentMode/rightPanel/AgentRightPanelSurfaceBody.tsx`. It receives exactly what the old `SurfaceBody` received plus the agents slot, and it is the only place that maps a kind to a body:

```tsx
import { Suspense, lazy, type ReactNode } from "react";
import type { AgentThreadView } from "../../../application/agentThreadPorts";
import type { AgentSurfaceKind } from "../../../domain/agentWorkbenchLayout";
import type { AgentSurfaceHistoryProps } from "../AgentSurfaceHistory";
import { AgentSurfaceFileTree, type AgentSurfaceFileTreeProps } from "../AgentSurfaceFileTree";
import type { AgentSurfaceTerminalProps } from "../AgentSurfaceTerminal";
import { agentSurfaceBlockedReason, type AgentSurfaceScope } from "../agentSurfacePolicy";
import { AGENT_RIGHT_PANEL_SURFACE_CATALOG } from "./agentRightPanelSurfaceCatalog";

export const AGENT_SURFACE_EDITOR_SLOT_ATTRIBUTE = "data-agent-editor-slot";

const LazyAgentSurfaceHistory = lazy(() =>
  import("../AgentSurfaceHistory").then((module) => ({ default: module.AgentSurfaceHistory })),
);
const LazyAgentSurfaceTerminal = lazy(() =>
  import("../AgentSurfaceTerminal").then((module) => ({ default: module.AgentSurfaceTerminal })),
);

export type AgentSurfaceTerminalPanelProps = Omit<
  AgentSurfaceTerminalProps,
  "isActive" | "layoutRevision" | "thread"
>;

export interface AgentRightPanelSurfaceBodyProps {
  readonly kind: AgentSurfaceKind;
  readonly scope: AgentSurfaceScope;
  readonly thread: AgentThreadView | null;
  readonly workspaceRoot: string | null;
  readonly workspaceTrusted: boolean;
  readonly active: boolean;
  readonly treeShown: boolean;
  readonly fileTree: AgentSurfaceFileTreeProps | null;
  readonly history: AgentSurfaceHistoryProps | null;
  readonly terminal: AgentSurfaceTerminalPanelProps | null;
  readonly terminalLayoutRevision: number;
  readonly diffBody: ReactNode;
  readonly agentsPanel: ReactNode;
}

export function AgentRightPanelSurfaceBody(props: AgentRightPanelSurfaceBodyProps) {
  switch (props.kind) {
    case "files":
      return (
        <div className="agent-surface__files">
          {props.treeShown && props.fileTree !== null && <AgentSurfaceFileTree {...props.fileTree} />}
          <div className="agent-surface__editor-slot" {...{ [AGENT_SURFACE_EDITOR_SLOT_ATTRIBUTE]: "" }} />
        </div>
      );
    case "history":
      if (!props.active) return null;
      if (props.history === null) return <p className="cv-rp-note">Git history is unavailable.</p>;
      return (
        <Suspense fallback={<p className="cv-rp-note">Loading Git history…</p>}>
          <LazyAgentSurfaceHistory {...props.history} />
        </Suspense>
      );
    case "agents":
      return props.agentsPanel ?? <p className="cv-rp-note">Agents are unavailable.</p>;
    case "diff":
      return blockedOr(props, props.diffBody);
    case "terminal":
      return blockedOr(
        props,
        props.terminal === null ? null : (
          <Suspense fallback={<p className="cv-rp-note">Loading the terminal…</p>}>
            <LazyAgentSurfaceTerminal
              {...props.terminal}
              isActive={props.active}
              layoutRevision={props.terminalLayoutRevision}
              thread={props.thread}
            />
          </Suspense>
        ),
      );
    case "git":
    case "scripts":
    case "pullRequest":
      return blockedOr(
        props,
        <p className="cv-rp-note">{AGENT_RIGHT_PANEL_SURFACE_CATALOG[props.kind].label} opens here.</p>,
      );
  }
}

function blockedOr(props: AgentRightPanelSurfaceBodyProps, body: ReactNode): ReactNode {
  const reason = agentSurfaceBlockedReason(
    props.kind,
    props.thread,
    props.workspaceTrusted,
    props.workspaceRoot,
    props.scope,
  );
  if (reason !== null) return <p className="cv-rp-note cv-rp-note--warning">{reason}</p>;
  return body;
}
```

The `git` / `scripts` / `pullRequest` case bodies are replaced by Tasks 11, 14 and 13 (integration steps). `diffBody` is built by `AgentSurfacePanel` from the current diff components until Task 6 replaces it.

- [ ] **Step 12: Wire the strip and body into `AgentSurfacePanel`**

In `src/components/agentMode/AgentSurfacePanel.tsx` (after P2's TopBar change):
1. Replace the `export const AGENT_SURFACE_EDITOR_SLOT_ATTRIBUTE = ...` line with `export { AGENT_SURFACE_EDITOR_SLOT_ATTRIBUTE } from "./rightPanel/AgentRightPanelSurfaceBody";`. Replace `export type AgentSurfaceTerminalPanelProps = ...` with a re-export from the same module. Delete `nextAgentSurfaceTabIndex`, `tabRefs`, `onTabKeyDown`, `SurfaceBody`, `SurfaceBodyProps`, the lazy History/Terminal constants, and the `lucide-react` icon imports that are no longer used.
2. Add props:

```ts
  readonly agentsPanel?: ReactNode;
  readonly editorDocuments?: AgentRightPanelEditorDocuments | null;
  readonly terminalStrip?: AgentTerminalStripState | null;
  onTerminalSessionCommand?(command: AgentTerminalSessionCommand): void;
```

3. Inside the TopBar children, replace the whole `{openSurfaces.length > 0 && (<div aria-label="Surfaces" ... role="tablist">…</div>)}` block with:

```tsx
<AgentRightPanelTabStrip
  addableSurfaces={AGENT_RIGHT_PANEL_ADD_MENU_ORDER.filter((kind) =>
    agentSurfaceServes(activation, kind),
  )}
  editorDocuments={editorDocuments}
  entries={agentRightPanelTabEntries({
    openSurfaces,
    activeSurface,
    terminal: terminalStrip,
    editorDocuments,
  })}
  onActivateSurface={onActivateSurface}
  onAddSurface={(kind) =>
    kind === "terminal" && openSurfaces.includes("terminal")
      ? onTerminalSessionCommand({ kind: "create" })
      : onOpenSurface(kind)
  }
  onCloseSurface={onCloseSurfaceTab}
  onTerminalSessionCommand={onTerminalSessionCommand}
/>
```

with defaults `editorDocuments = null`, `terminalStrip = null`, `agentsPanel = null`, `onTerminalSessionCommand = ignoreTerminalCommand`, where `const ignoreTerminalCommand = (): void => undefined;` is module-level. Import `agentSurfaceServes` from `../../domain/agentSurfaceActivation`. Keep the `WorkbenchEditorTabsPortalTarget`, spacer and tree toggle exactly where P2 left them.

4. Replace the non-remote body branch `<SurfaceBody …/>` with:

```tsx
<AgentRightPanelSurfaceBody
  active={!hidden && activeSurface === kind}
  agentsPanel={agentsPanel}
  diffBody={legacyDiffBody}
  fileTree={fileTree}
  history={history}
  kind={kind}
  scope={scope}
  terminal={terminal}
  terminalLayoutRevision={terminalLayoutRevision}
  thread={thread}
  treeShown={treeShown}
  workspaceRoot={workspaceRoot}
  workspaceTrusted={workspaceTrusted}
/>
```

where `legacyDiffBody` is computed once above the return with the old diff logic moved verbatim (thread null → project diff lazy component, otherwise `LazyAgentSurfaceDiff`). Task 6 deletes it.

5. `AgentSurfaceHost.tsx`: add `readonly agentsPanel?: ReactNode;` to `AgentSurfaceHostProps`, destructure it with default `null`, and pass `agentsPanel={agentsPanel}` to `AgentSurfacePanel`.

- [ ] **Step 13: Update the panel tests**

In `src/components/agentMode/AgentSurfacePanel.test.tsx`, the old hand-made tab markup is gone. Replace selectors `.agent-surface__tab` / `.agent-surface__tab-close` with `[role="tab"]` / `.cv-tab__close`, and the tab-name assertions with the tab `title` attributes. Add:

```tsx
it("renders the agents slot for the agents surface", () => {
  const host = renderPanel({
    layout: open(["agents"], "agents"),
    agentsPanel: <p data-testid="agents-slot">agents</p>,
  });
  expect(host.querySelector('[data-testid="agents-slot"]')).not.toBeNull();
});
```

(`renderPanel` is the file's existing mount helper; use its real name.)

- [ ] **Step 14: Run the focused suites and typecheck**

Run: `npx vitest run src/components/agentMode/rightPanel src/components/agentMode/AgentSurfacePanel.test.tsx src/components/agentMode/AgentSurfaceHost.test.tsx src/components/agentMode/useAgentSurfaceLayout.test.tsx src/components/agentMode/AgentModeView.test.tsx && npm run check`
Expected: PASS, and `tsc` exit 0.

- [ ] **Step 15: Hand off (no commit)**

---

### Task 3: Terminal sessions as panel tabs with a floating toolbar

**Files:**
- Modify: `src/components/TerminalTabsPanel.tsx`
- Create: `src/components/TerminalFloatingToolbar.tsx`, `src/components/terminalFloatingToolbar.css`, `src/components/agentMode/rightPanel/useAgentTerminalStrip.ts`
- Modify: `src/components/agentMode/AgentSurfaceTerminal.tsx` (pass `externalStrip`), `src/components/agentMode/AgentSurfacePanel.tsx` (use the hook, feed the strip)
- Test: `src/components/TerminalTabsPanel.test.tsx`, `src/components/agentMode/rightPanel/useAgentTerminalStrip.test.tsx`, `src/components/agentMode/AgentSurfaceTerminal.test.tsx`

**Interfaces:**
- Consumes: Task 2 `AgentTerminalStripState`, `AgentTerminalSessionCommand`.
- Produces (exported from `src/components/TerminalTabsPanel.tsx`):
  - `interface TerminalTabsSnapshot { tabs: ReadonlyArray<{ id: string; title: string; live: boolean; closable: boolean }>; activeTabId: string | null; canCreate: boolean; split: boolean }`
  - `interface TerminalTabsCommands { activate(id: string): void; close(id: string): void; create(): void; toggleSplit(): void; stopActive(): void; restartActive(): void }`
  - `interface TerminalTabsExternalStrip { onSnapshot(snapshot: TerminalTabsSnapshot | null): void; readonly commandsRef: { current: TerminalTabsCommands | null } }`
  - `TerminalTabsPanelProps.externalStrip?: TerminalTabsExternalStrip`
  - `AgentSurfaceTerminalProps.externalStrip?: TerminalTabsExternalStrip`
  - `useAgentTerminalStrip(): { state: AgentTerminalStripState | null; externalStrip: TerminalTabsExternalStrip; command(command: AgentTerminalSessionCommand, closeSurface: () => void): void }`

- [ ] **Step 1: Write the failing TerminalTabsPanel tests**

Append to `src/components/TerminalTabsPanel.test.tsx`, reusing the file's fake gateway and xterm mocks. The fake gateway must support `subscribeStatus`: if the existing fake lacks it, add a `statusListeners` array and an `emitStatus(status)` helper to the test's local fake.

```tsx
describe("external strip mode", () => {
  it("publishes snapshots instead of rendering its own session list", async () => {
    const snapshots: Array<TerminalTabsSnapshot | null> = [];
    const commandsRef: { current: TerminalTabsCommands | null } = { current: null };
    const host = renderTabs({
      externalStrip: { onSnapshot: (snapshot) => snapshots.push(snapshot), commandsRef },
    });

    await waitForReact(() => expect(lastSnapshot(snapshots)?.tabs).toHaveLength(1));
    expect(host.querySelector('[aria-label="Terminal sessions"]')).toBeNull();

    act(() => commandsRef.current?.create());
    await waitForReact(() => expect(lastSnapshot(snapshots)?.tabs).toHaveLength(2));
    expect(lastSnapshot(snapshots)?.activeTabId).toBe(lastSnapshot(snapshots)?.tabs[1]?.id);
  });

  it("marks a session live until the backend reports it exited", async () => {
    const snapshots: Array<TerminalTabsSnapshot | null> = [];
    const gateway = fakeGatewayWithStatus();
    renderTabs({
      terminalGateway: gateway,
      externalStrip: { onSnapshot: (s) => snapshots.push(s), commandsRef: { current: null } },
    });

    await waitForReact(() => expect(lastSnapshot(snapshots)?.tabs[0]?.live).toBe(true));
    act(() => gateway.emitStatus({ kind: "exited", sessionId: gateway.lastSessionId(), exitCode: 0 }));
    await waitForReact(() => expect(lastSnapshot(snapshots)?.tabs[0]?.live).toBe(false));
  });

  it("stops and restarts the active session through commands", async () => {
    const commandsRef: { current: TerminalTabsCommands | null } = { current: null };
    const gateway = fakeGatewayWithStatus();
    renderTabs({ terminalGateway: gateway, externalStrip: { onSnapshot: () => undefined, commandsRef } });
    await waitForReact(() => expect(gateway.startedSessionIds()).toHaveLength(1));

    act(() => commandsRef.current?.stopActive());
    await waitForReact(() => expect(gateway.stoppedSessionIds()).toContain(gateway.startedSessionIds()[0]));

    act(() => commandsRef.current?.restartActive());
    await waitForReact(() => expect(gateway.startedSessionIds()).toHaveLength(2));
  });

  it("renders the floating toolbar with Stop, Restart, Split and New", () => {
    const host = renderTabs({
      externalStrip: { onSnapshot: () => undefined, commandsRef: { current: null } },
    });
    expect(
      [...host.querySelectorAll('[role="toolbar"] button')].map((b) => b.getAttribute("aria-label")),
    ).toEqual(["Stop terminal", "Restart terminal", "Split terminal", "New terminal"]);
  });

  it("publishes null on unmount so the strip forgets the previous owner", async () => {
    const snapshots: Array<TerminalTabsSnapshot | null> = [];
    const ui = renderTabsUi({
      externalStrip: { onSnapshot: (s) => snapshots.push(s), commandsRef: { current: null } },
    });
    await waitForReact(() => expect(snapshots.length).toBeGreaterThan(0));
    ui.unmount();
    expect(lastSnapshot(snapshots)).toBeNull();
  });
});
```

Add this module-level helper to the test file (the project targets ES2020, so `Array.prototype.at` is unavailable):

```ts
function lastSnapshot(
  snapshots: ReadonlyArray<TerminalTabsSnapshot | null>,
): TerminalTabsSnapshot | null | undefined {
  return snapshots[snapshots.length - 1];
}
```

`renderTabs`, `renderTabsUi` and `fakeGatewayWithStatus` stand for the file's existing mount helper and fake. Extend the fake with `emitStatus`, `lastSessionId`, `startedSessionIds` and `stoppedSessionIds` backed by arrays, with no `throw`. Import `TerminalTabsSnapshot` and `TerminalTabsCommands` from `./TerminalTabsPanel`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/components/TerminalTabsPanel.test.tsx`
Expected: FAIL (no `externalStrip` behaviour).

- [ ] **Step 3: Create the floating toolbar**

Create `src/components/TerminalFloatingToolbar.tsx`:

```tsx
import { Columns2, Plus, RotateCcw, Square } from "lucide-react";
import "./terminalFloatingToolbar.css";

export interface TerminalFloatingToolbarProps {
  readonly canStop: boolean;
  readonly canRestart: boolean;
  readonly split: boolean;
  readonly canCreate: boolean;
  onStop(): void;
  onRestart(): void;
  onToggleSplit(): void;
  onCreate(): void;
}

export function TerminalFloatingToolbar(props: TerminalFloatingToolbarProps) {
  return (
    <div aria-label="Terminal actions" className="cv-term-toolbar" role="toolbar">
      <button aria-label="Stop terminal" disabled={!props.canStop} onClick={props.onStop} title="Stop" type="button">
        <Square aria-hidden="true" size={12} />
        Stop
      </button>
      <button aria-label="Restart terminal" disabled={!props.canRestart} onClick={props.onRestart} title="Restart" type="button">
        <RotateCcw aria-hidden="true" size={12} />
      </button>
      <span aria-hidden="true" className="cv-term-toolbar__sep" />
      <button
        aria-label="Split terminal"
        aria-pressed={props.split}
        disabled={!props.split && !props.canCreate}
        onClick={props.onToggleSplit}
        title="Split"
        type="button"
      >
        <Columns2 aria-hidden="true" size={12} />
      </button>
      <span aria-hidden="true" className="cv-term-toolbar__sep" />
      <button aria-label="New terminal" disabled={!props.canCreate} onClick={props.onCreate} title="New terminal" type="button">
        <Plus aria-hidden="true" size={12} />
      </button>
    </div>
  );
}
```

Create `src/components/terminalFloatingToolbar.css`:

```css
.cv-term-toolbar {
  position: absolute;
  top: var(--cv-space-2);
  right: 10px;
  z-index: 3;
  display: inline-flex;
  align-items: center;
  border-radius: var(--cv-r-sm);
  background: var(--cv-canvas);
  box-shadow: 0 0 0 1px var(--cv-hair-strong);
  overflow: hidden;
}

.cv-term-toolbar button {
  height: 24px;
  min-width: 24px;
  padding: 0 6px;
  display: inline-flex;
  align-items: center;
  gap: var(--cv-space-1);
  border: 0;
  background: none;
  font: inherit;
  font-size: var(--cv-t-2xs);
  color: var(--cv-fg-muted);
}

.cv-term-toolbar button:hover:not(:disabled),
.cv-term-toolbar button[aria-pressed="true"] {
  background: var(--cv-tint-2);
  color: var(--cv-fg-strong);
}

.cv-term-toolbar button:disabled {
  color: var(--cv-fg-disabled);
}

.cv-term-toolbar button:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 1px var(--cv-focus);
}

.cv-term-toolbar__sep {
  width: 1px;
  height: 14px;
  background: var(--cv-hair-strong);
}
```

- [ ] **Step 4: Implement external-strip mode in `TerminalTabsPanel`**

In `src/components/TerminalTabsPanel.tsx`:

1. Export the three interfaces from **Interfaces** above and add `readonly externalStrip?: TerminalTabsExternalStrip;` to `TerminalTabsPanelProps`.
2. Add state and refs after `runtime`:

```tsx
const [exitedSessions, setExitedSessions] = useState<ReadonlySet<number>>(() => new Set());
const [paneGenerations, setPaneGenerations] = useState<ReadonlyMap<string, number>>(() => new Map());
```

3. Subscribe to status (after the mount effect):

```tsx
useEffect(() => {
  const subscribe = props.terminalGateway.subscribeStatus;
  if (subscribe === undefined) return;
  let disposed = false;
  let unsubscribe: (() => void) | null = null;
  void subscribe
    .call(props.terminalGateway, (status) => {
      if (status.kind !== "exited" && status.kind !== "crashed" && status.kind !== "stopped") return;
      setExitedSessions((current) => boundedSessionSet(current, status.sessionId));
    })
    .then((dispose) => {
      if (disposed) {
        dispose();
        return;
      }
      unsubscribe = dispose;
    });
  return () => {
    disposed = true;
    unsubscribe?.();
  };
}, [props.terminalGateway]);
```

with module-level:

```ts
const MAX_TRACKED_EXITED_SESSIONS = 64;

function boundedSessionSet(current: ReadonlySet<number>, sessionId: number): ReadonlySet<number> {
  if (current.has(sessionId)) return current;
  const next = [...current, sessionId];
  return new Set(next.slice(Math.max(0, next.length - MAX_TRACKED_EXITED_SESSIONS)));
}
```

4. Add the two commands next to `close`:

```tsx
const stopActive = () => {
  const tabId = activeTabIdRef.current;
  if (!tabId) return;
  const sessionId = runtimeRef.current.get(tabId)?.sessionId ?? null;
  if (sessionId === null) return;
  void props.terminalGateway.stop(sessionId).then(
    () => setExitedSessions((current) => boundedSessionSet(current, sessionId)),
    () => undefined,
  );
};
const restartActive = () => {
  const tabId = activeTabIdRef.current;
  if (!tabId || !liveTabIdsRef.current.has(tabId)) return;
  const current = runtimeRef.current.get(tabId);
  if (current === undefined || current.signInIntent !== undefined) return;
  updateRuntime(tabId, (previous) => (previous ? { ...previous, cwd: null, sessionId: null } : undefined));
  onActiveSessionReadyRef.current?.(null);
  setPaneGenerations((generations) => new Map(generations).set(tabId, (generations.get(tabId) ?? 0) + 1));
};
```

The old pane unmounts because its React key changes (step 6). `TerminalPanel` stops its session on teardown, so the old process is reaped before the new one starts.

5. Publish snapshots and commands when `props.externalStrip` is set:

```tsx
const externalStrip = props.externalStrip;
const snapshot: TerminalTabsSnapshot = {
  tabs: tabs.tabs.map((tab) => {
    const sessionId = runtime.get(tab.id)?.sessionId ?? null;
    return {
      id: tab.id,
      title: tab.title,
      live: sessionId !== null && !exitedSessions.has(sessionId),
      closable: !signInTabIsAwaitingSession(runtime.get(tab.id), props.providerSignIn),
    };
  }),
  activeTabId: tabs.activeTabId,
  canCreate: tabs.tabs.length < MAX_TERMINAL_TABS,
  split: splitIds !== null,
};
const snapshotKey = JSON.stringify(snapshot);
useEffect(() => {
  if (externalStrip === undefined) return;
  externalStrip.onSnapshot(JSON.parse(snapshotKey) as TerminalTabsSnapshot);
}, [externalStrip, snapshotKey]);
useEffect(() => {
  if (externalStrip === undefined) return;
  return () => externalStrip.onSnapshot(null);
}, [externalStrip]);
useLayoutEffect(() => {
  if (externalStrip === undefined) return;
  externalStrip.commandsRef.current = {
    activate,
    close: (id) => {
      if (tabs.tabs.length === 1) return;
      close(id);
    },
    create: () => {
      setSplitIds(null);
      create();
    },
    toggleSplit,
    stopActive,
    restartActive,
  };
});
```

Add `useLayoutEffect` to the React import. The snapshot holds at most 16 tabs of bounded titles, so the JSON key stays small.

6. In the pane map, change `key={tab.id}` to `key={`${tab.id}:${paneGenerations.get(tab.id) ?? 0}`}`.
7. Rendering: when `externalStrip` is set, render

```tsx
<TerminalFloatingToolbar
  canCreate={tabs.tabs.length < MAX_TERMINAL_TABS}
  canRestart={activeRuntime !== undefined && activeRuntime.signInIntent === undefined}
  canStop={activeSessionLive}
  onCreate={() => {
    setSplitIds(null);
    create();
  }}
  onRestart={restartActive}
  onStop={stopActive}
  onToggleSplit={toggleSplit}
  split={splitIds !== null}
/>
```

inside `.terminal-tabs-body` (which gets `position: relative` via an inline style), and skip both `toolbar` and `sessionList`. Here `activeRuntime = runtime.get(tabs.activeTabId ?? "")` and `activeSessionLive = activeRuntime?.sessionId != null && !exitedSessions.has(activeRuntime.sessionId)`. Without `externalStrip` the existing toolbar and session list render unchanged (bottom panel).

- [ ] **Step 5: Run the TerminalTabsPanel suite**

Run: `npx vitest run src/components/TerminalTabsPanel.test.tsx`
Expected: PASS (old cases unchanged, new cases pass).

- [ ] **Step 6: Write the failing strip hook test**

Create `src/components/agentMode/rightPanel/useAgentTerminalStrip.test.tsx`:

```tsx
// @vitest-environment jsdom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountUi, type MountedUi } from "../../../ui/foundation/foundationTestSupport";
import type { TerminalTabsCommands } from "../../TerminalTabsPanel";
import { useAgentTerminalStrip } from "./useAgentTerminalStrip";

let ui: MountedUi | null = null;
afterEach(() => {
  ui?.unmount();
  ui = null;
});

function harness() {
  const box: { current: ReturnType<typeof useAgentTerminalStrip> | null } = { current: null };
  function Probe() {
    box.current = useAgentTerminalStrip();
    return null;
  }
  ui = mountUi();
  ui.render(<Probe />);
  return box;
}

function commands(): TerminalTabsCommands {
  return {
    activate: vi.fn(),
    close: vi.fn(),
    create: vi.fn(),
    toggleSplit: vi.fn(),
    stopActive: vi.fn(),
    restartActive: vi.fn(),
  };
}

describe("useAgentTerminalStrip", () => {
  it("maps snapshots to strip state and forwards commands", () => {
    const box = harness();
    const fake = commands();
    act(() => {
      box.current?.externalStrip.onSnapshot({
        tabs: [
          { id: "terminal-0", title: "dev", live: true, closable: true },
          { id: "terminal-1", title: "zsh", live: false, closable: true },
        ],
        activeTabId: "terminal-1",
        canCreate: true,
        split: false,
      });
    });
    if (box.current !== null) box.current.externalStrip.commandsRef.current = fake;

    expect(box.current?.state).toEqual({
      sessions: [
        { id: "terminal-0", title: "dev", live: true, closable: true },
        { id: "terminal-1", title: "zsh", live: false, closable: true },
      ],
      activeSessionId: "terminal-1",
    });
    const closeSurface = vi.fn();
    box.current?.command({ kind: "close", sessionId: "terminal-0" }, closeSurface);
    expect(fake.close).toHaveBeenCalledWith("terminal-0");
    expect(closeSurface).not.toHaveBeenCalled();
  });

  it("closes the terminal surface when the last session tab is closed", () => {
    const box = harness();
    const fake = commands();
    act(() => {
      box.current?.externalStrip.onSnapshot({
        tabs: [{ id: "terminal-0", title: "Terminal 1", live: true, closable: true }],
        activeTabId: "terminal-0",
        canCreate: true,
        split: false,
      });
    });
    if (box.current !== null) box.current.externalStrip.commandsRef.current = fake;
    const closeSurface = vi.fn();

    box.current?.command({ kind: "close", sessionId: "terminal-0" }, closeSurface);

    expect(closeSurface).toHaveBeenCalledOnce();
    expect(fake.close).not.toHaveBeenCalled();
  });

  it("forgets sessions when the panel publishes null", () => {
    const box = harness();
    act(() => box.current?.externalStrip.onSnapshot(null));
    expect(box.current?.state).toBeNull();
  });
});
```

- [ ] **Step 7: Implement the hook**

Create `src/components/agentMode/rightPanel/useAgentTerminalStrip.ts`:

```ts
import { useCallback, useMemo, useRef, useState } from "react";
import type {
  TerminalTabsCommands,
  TerminalTabsExternalStrip,
  TerminalTabsSnapshot,
} from "../../TerminalTabsPanel";
import type { AgentTerminalSessionCommand, AgentTerminalStripState } from "./agentRightPanelTabEntries";

export interface AgentTerminalStrip {
  readonly state: AgentTerminalStripState | null;
  readonly externalStrip: TerminalTabsExternalStrip;
  command(command: AgentTerminalSessionCommand, closeSurface: () => void): void;
}

export function useAgentTerminalStrip(): AgentTerminalStrip {
  const [snapshot, setSnapshot] = useState<TerminalTabsSnapshot | null>(null);
  const snapshotRef = useRef<TerminalTabsSnapshot | null>(null);
  const commandsRef = useRef<TerminalTabsCommands | null>(null);
  const onSnapshot = useCallback((next: TerminalTabsSnapshot | null) => {
    snapshotRef.current = next;
    setSnapshot(next);
  }, []);
  const externalStrip = useMemo<TerminalTabsExternalStrip>(
    () => ({ onSnapshot, commandsRef }),
    [onSnapshot],
  );
  const command = useCallback(
    (request: AgentTerminalSessionCommand, closeSurface: () => void) => {
      const commands = commandsRef.current;
      if (commands === null) return;
      switch (request.kind) {
        case "activate":
          commands.activate(request.sessionId);
          return;
        case "create":
          commands.create();
          return;
        case "close":
          if ((snapshotRef.current?.tabs.length ?? 0) <= 1) {
            closeSurface();
            return;
          }
          commands.close(request.sessionId);
          return;
      }
    },
    [],
  );
  const state = useMemo<AgentTerminalStripState | null>(
    () =>
      snapshot === null
        ? null
        : { sessions: snapshot.tabs, activeSessionId: snapshot.activeTabId },
    [snapshot],
  );
  return { state, externalStrip, command };
}
```

- [ ] **Step 8: Wire it through the panel**

- `AgentSurfaceTerminal.tsx`: add `readonly externalStrip?: TerminalTabsExternalStrip;` to the props, destructure it, and pass `externalStrip={externalStrip}` to `LazyTerminalTabsPanel`. Add a test to `AgentSurfaceTerminal.test.tsx` that asserts the snapshot callback receives one tab once the lazy panel mounts (use `waitForReact`).
- `AgentSurfacePanel.tsx`:
  - call `const terminalStrip = useAgentTerminalStrip();` at the top of the component (hook order is stable);
  - pass `terminal={terminal === null ? null : { ...terminal, externalStrip: terminalStrip.externalStrip }}` to `AgentRightPanelSurfaceBody`;
  - feed the strip with `terminal: terminalStrip.state` (instead of the `terminalStrip` prop, which is removed again from the props added in Task 2);
  - pass `onTerminalSessionCommand={(command) => terminalStrip.command(command, () => onCloseSurfaceTab("terminal"))}`.

  Remove the Task 2 `terminalStrip?` / `onTerminalSessionCommand?` props from `AgentSurfacePanelProps`, since the panel now owns the hook.

- [ ] **Step 9: Run the focused suites**

Run: `npx vitest run src/components/TerminalTabsPanel.test.tsx src/components/agentMode/rightPanel src/components/agentMode/AgentSurfaceTerminal.test.tsx src/components/agentMode/AgentSurfacePanel.test.tsx src/components/BottomPanel.test.tsx && npm run check`
Expected: PASS. The `BottomPanel` suite proves the bottom panel is unchanged.

- [ ] **Step 10: Hand off (no commit)**

---
### Task 4: Bounded line diff, hunks, split rows and the worker gateway

**Files:**
- Create: `src/domain/diffView/lineDiff.ts`, `src/domain/diffView/diffHunks.ts`, `src/application/diffViewComputation.ts`, `src/infrastructure/diffView.worker.ts`, `src/infrastructure/browserDiffViewGateway.ts`, `src/infrastructure/inlineDiffViewGateway.ts`
- Test: `src/domain/diffView/lineDiff.test.ts`, `src/domain/diffView/diffHunks.test.ts`, `src/infrastructure/browserDiffViewGateway.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `MAX_DIFF_VIEW_LINES_PER_SIDE = 20_000`, `MAX_DIFF_VIEW_EDIT_DISTANCE = 1_500`
  - `type DiffLineKind = "context" | "add" | "del"`, `interface DiffLine { kind; oldLine: number | null; newLine: number | null; text: string }`
  - `interface LineDiffOptions { ignoreWhitespace: boolean }`, `type LineDiffResult = { kind: "ready"; lines; added; deleted } | { kind: "tooLarge"; reason: "lines" | "editDistance" }`
  - `splitDiffText(text: string): string[]`, `computeLineDiff(original: string, modified: string, options: LineDiffOptions): LineDiffResult`
  - `DIFF_HUNK_CONTEXT_LINES = 3`, `MAX_RENDERED_DIFF_LINES_PER_FILE = 2_000`, `interface DiffHunk { header: string; lines: ReadonlyArray<DiffLine> }`, `groupDiffHunks(lines, context?): ReadonlyArray<DiffHunk>`, `limitDiffHunks(hunks, maxLines): { hunks; hiddenLines: number }`
  - `interface SplitDiffCell { line: number; text: string; kind: DiffLineKind }`, `interface SplitDiffRow { left: SplitDiffCell | null; right: SplitDiffCell | null }`, `splitDiffRows(hunk: DiffHunk): ReadonlyArray<SplitDiffRow>`
  - `interface DiffViewComputationInput { original; modified; ignoreWhitespace }`, `interface DiffViewComputationGateway { compute(input, signal: AbortSignal): Promise<LineDiffResult> }`, `DiffViewWorkerRequest`, `DiffViewWorkerResponse`
  - `BrowserDiffViewGateway` (worker-backed), `inlineDiffViewGateway` (synchronous, for tests and hosts without workers)

- [ ] **Step 1: Write the failing line-diff tests**

Create `src/domain/diffView/lineDiff.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  MAX_DIFF_VIEW_LINES_PER_SIDE,
  computeLineDiff,
  splitDiffText,
  type DiffLine,
} from "./lineDiff";

function kinds(lines: ReadonlyArray<DiffLine>): string {
  return lines.map((line) => (line.kind === "context" ? " " : line.kind === "add" ? "+" : "-")).join("");
}

describe("splitDiffText", () => {
  it("normalizes CRLF and drops the final newline terminator", () => {
    expect(splitDiffText("a\r\nb\n")).toEqual(["a", "b"]);
    expect(splitDiffText("")).toEqual([]);
    expect(splitDiffText("a\n\n")).toEqual(["a", ""]);
  });
});

describe("computeLineDiff", () => {
  it("returns only context for identical text", () => {
    const result = computeLineDiff("a\nb\n", "a\nb\n", { ignoreWhitespace: false });
    expect(result).toEqual({
      kind: "ready",
      added: 0,
      deleted: 0,
      lines: [
        { kind: "context", oldLine: 1, newLine: 1, text: "a" },
        { kind: "context", oldLine: 2, newLine: 2, text: "b" },
      ],
    });
  });

  it("emits a deletion followed by an insertion for a changed line", () => {
    const result = computeLineDiff("a\nb\nc\n", "a\nB\nc\n", { ignoreWhitespace: false });
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(kinds(result.lines)).toBe(" -+ ");
    expect(result.lines[1]).toEqual({ kind: "del", oldLine: 2, newLine: null, text: "b" });
    expect(result.lines[2]).toEqual({ kind: "add", oldLine: null, newLine: 2, text: "B" });
    expect([result.added, result.deleted]).toEqual([1, 1]);
  });

  it("numbers lines on both sides across insertions in the middle", () => {
    const result = computeLineDiff("1\n2\n3\n4\n", "1\n2\nx\ny\n3\n4\n", { ignoreWhitespace: false });
    if (result.kind !== "ready") {
      expect(result.kind).toBe("ready");
      return;
    }
    expect(result.lines.map((line) => [line.oldLine, line.newLine])).toEqual([
      [1, 1],
      [2, 2],
      [null, 3],
      [null, 4],
      [3, 5],
      [4, 6],
    ]);
  });

  it("handles files that were created or deleted", () => {
    const created = computeLineDiff("", "a\nb\n", { ignoreWhitespace: false });
    const deleted = computeLineDiff("a\n", "", { ignoreWhitespace: false });
    expect(created.kind === "ready" && kinds(created.lines)).toBe("++");
    expect(deleted.kind === "ready" && kinds(deleted.lines)).toBe("-");
  });

  it("treats whitespace-only changes as context when ignoring whitespace", () => {
    const strict = computeLineDiff("if (a) {\n  b();\n}\n", "if (a) {\n    b();\n}\n", {
      ignoreWhitespace: false,
    });
    const relaxed = computeLineDiff("if (a) {\n  b();\n}\n", "if (a) {\n    b();\n}\n", {
      ignoreWhitespace: true,
    });
    expect(strict.kind === "ready" && strict.added).toBe(1);
    expect(relaxed.kind === "ready" && kinds(relaxed.lines)).toBe("   ");
    expect(relaxed.kind === "ready" && relaxed.lines[1]?.text).toBe("    b();");
  });

  it("refuses inputs above the line bound", () => {
    const large = "x\n".repeat(MAX_DIFF_VIEW_LINES_PER_SIDE + 1);
    expect(computeLineDiff(large, "", { ignoreWhitespace: false })).toEqual({
      kind: "tooLarge",
      reason: "lines",
    });
  });

  it("refuses edits above the edit-distance bound instead of freezing", () => {
    const left = Array.from({ length: 1_000 }, (_, index) => `left ${index}`).join("\n");
    const right = Array.from({ length: 1_000 }, (_, index) => `right ${index}`).join("\n");
    expect(computeLineDiff(left, right, { ignoreWhitespace: false })).toEqual({
      kind: "tooLarge",
      reason: "editDistance",
    });
  });

  it("keeps very long lines intact", () => {
    const longLine = "y".repeat(5_000);
    const result = computeLineDiff("a\n", `a\n${longLine}\n`, { ignoreWhitespace: false });
    expect(result.kind === "ready" && result.lines[1]?.text.length).toBe(5_000);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/domain/diffView/lineDiff.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the line diff**

Create `src/domain/diffView/lineDiff.ts`:

```ts
export const MAX_DIFF_VIEW_LINES_PER_SIDE = 20_000;
export const MAX_DIFF_VIEW_EDIT_DISTANCE = 1_500;

export type DiffLineKind = "context" | "add" | "del";

export interface DiffLine {
  readonly kind: DiffLineKind;
  readonly oldLine: number | null;
  readonly newLine: number | null;
  readonly text: string;
}

export interface LineDiffOptions {
  readonly ignoreWhitespace: boolean;
}

export type LineDiffResult =
  | {
      readonly kind: "ready";
      readonly lines: ReadonlyArray<DiffLine>;
      readonly added: number;
      readonly deleted: number;
    }
  | { readonly kind: "tooLarge"; readonly reason: "lines" | "editDistance" };

type EditOp = "equal" | "delete" | "insert";

export function splitDiffText(text: string): string[] {
  if (text.length === 0) return [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

export function computeLineDiff(
  original: string,
  modified: string,
  options: LineDiffOptions,
): LineDiffResult {
  const oldLines = splitDiffText(original);
  const newLines = splitDiffText(modified);
  if (oldLines.length > MAX_DIFF_VIEW_LINES_PER_SIDE || newLines.length > MAX_DIFF_VIEW_LINES_PER_SIDE) {
    return { kind: "tooLarge", reason: "lines" };
  }
  const key = options.ignoreWhitespace ? whitespaceInsensitiveKey : exactKey;
  const oldKeys = oldLines.map(key);
  const newKeys = newLines.map(key);
  const prefix = commonPrefixLength(oldKeys, newKeys);
  const suffix = commonSuffixLength(oldKeys, newKeys, prefix);
  const script = shortestEditScript(
    oldKeys.slice(prefix, oldKeys.length - suffix),
    newKeys.slice(prefix, newKeys.length - suffix),
    MAX_DIFF_VIEW_EDIT_DISTANCE,
  );
  if (script === null) return { kind: "tooLarge", reason: "editDistance" };

  const lines: DiffLine[] = [];
  const context = (oldIndex: number, newIndex: number): DiffLine => ({
    kind: "context",
    oldLine: oldIndex + 1,
    newLine: newIndex + 1,
    text: newLines[newIndex] ?? "",
  });
  for (let index = 0; index < prefix; index += 1) lines.push(context(index, index));
  let oldIndex = prefix;
  let newIndex = prefix;
  let added = 0;
  let deleted = 0;
  for (const op of script) {
    if (op === "equal") {
      lines.push(context(oldIndex, newIndex));
      oldIndex += 1;
      newIndex += 1;
      continue;
    }
    if (op === "delete") {
      lines.push({ kind: "del", oldLine: oldIndex + 1, newLine: null, text: oldLines[oldIndex] ?? "" });
      oldIndex += 1;
      deleted += 1;
      continue;
    }
    lines.push({ kind: "add", oldLine: null, newLine: newIndex + 1, text: newLines[newIndex] ?? "" });
    newIndex += 1;
    added += 1;
  }
  for (let index = 0; index < suffix; index += 1) lines.push(context(oldIndex + index, newIndex + index));
  return { kind: "ready", lines, added, deleted };
}

function exactKey(line: string): string {
  return line;
}

function whitespaceInsensitiveKey(line: string): string {
  return line.replace(/\s+/g, "");
}

function commonPrefixLength(left: ReadonlyArray<string>, right: ReadonlyArray<string>): number {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left[index] === right[index]) index += 1;
  return index;
}

function commonSuffixLength(
  left: ReadonlyArray<string>,
  right: ReadonlyArray<string>,
  prefix: number,
): number {
  const limit = Math.min(left.length, right.length) - prefix;
  let length = 0;
  while (length < limit && left[left.length - 1 - length] === right[right.length - 1 - length]) {
    length += 1;
  }
  return length;
}

function shortestEditScript(
  left: ReadonlyArray<string>,
  right: ReadonlyArray<string>,
  maxDistance: number,
): EditOp[] | null {
  const n = left.length;
  const m = right.length;
  if (n === 0) return new Array<EditOp>(m).fill("insert");
  if (m === 0) return new Array<EditOp>(n).fill("delete");
  const limit = Math.min(maxDistance, n + m);
  const offset = limit + 1;
  const frontier = new Int32Array(2 * limit + 3);
  const trace: Int32Array[] = [];
  for (let distance = 0; distance <= limit; distance += 1) {
    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      const down =
        diagonal === -distance ||
        (diagonal !== distance && frontier[offset + diagonal - 1] < frontier[offset + diagonal + 1]);
      let x = down ? frontier[offset + diagonal + 1] : frontier[offset + diagonal - 1] + 1;
      let y = x - diagonal;
      while (x < n && y < m && left[x] === right[y]) {
        x += 1;
        y += 1;
      }
      frontier[offset + diagonal] = x;
      if (x >= n && y >= m) {
        trace.push(frontier.slice(offset - distance, offset + distance + 1));
        return backtrack(trace, n, m);
      }
    }
    trace.push(frontier.slice(offset - distance, offset + distance + 1));
  }
  return null;
}

function backtrack(trace: ReadonlyArray<Int32Array>, n: number, m: number): EditOp[] {
  const ops: EditOp[] = [];
  let x = n;
  let y = m;
  for (let distance = trace.length - 1; distance > 0; distance -= 1) {
    const previous = trace[distance - 1];
    const at = (diagonal: number): number => previous[diagonal + distance - 1];
    const diagonal = x - y;
    const previousDiagonal =
      diagonal === -distance || (diagonal !== distance && at(diagonal - 1) < at(diagonal + 1))
        ? diagonal + 1
        : diagonal - 1;
    const previousX = at(previousDiagonal);
    const previousY = previousX - previousDiagonal;
    while (x > previousX && y > previousY) {
      ops.push("equal");
      x -= 1;
      y -= 1;
    }
    ops.push(previousDiagonal === diagonal + 1 ? "insert" : "delete");
    x = previousX;
    y = previousY;
  }
  while (x > 0 && y > 0) {
    ops.push("equal");
    x -= 1;
    y -= 1;
  }
  return ops.reverse();
}
```

Memory stays bounded: the trace holds at most `sum(2d+1)` for d ≤ 1,500, which is about 2.25 M 32-bit integers (≈ 9 MB). This runs only inside the worker.

- [ ] **Step 4: Run the line-diff tests**

Run: `npx vitest run src/domain/diffView/lineDiff.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing hunk tests**

Create `src/domain/diffView/diffHunks.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { groupDiffHunks, limitDiffHunks, splitDiffRows } from "./diffHunks";
import { computeLineDiff, type DiffLine } from "./lineDiff";

function ready(original: string, modified: string): ReadonlyArray<DiffLine> {
  const result = computeLineDiff(original, modified, { ignoreWhitespace: false });
  return result.kind === "ready" ? result.lines : [];
}

const numbered = (count: number, change: number | null = null): string =>
  Array.from({ length: count }, (_, index) => (index + 1 === change ? "changed" : `line ${index + 1}`)).join("\n");

describe("groupDiffHunks", () => {
  it("keeps three lines of context and writes a git-style header", () => {
    const hunks = groupDiffHunks(ready(numbered(20), numbered(20, 10)));
    expect(hunks).toHaveLength(1);
    expect(hunks[0]?.header).toBe("@@ -7,7 +7,7 @@");
    expect(hunks[0]?.lines).toHaveLength(8);
  });

  it("merges changes whose context overlaps and splits distant ones", () => {
    const near = groupDiffHunks(ready(numbered(30), numbered(30, 10).replace("line 14", "x")));
    const far = groupDiffHunks(ready(numbered(40), numbered(40, 5).replace("line 30", "x")));
    expect(near).toHaveLength(1);
    expect(far).toHaveLength(2);
  });

  it("uses the preceding line number for an empty old side", () => {
    const hunks = groupDiffHunks(ready("", "a\nb\n"));
    expect(hunks[0]?.header).toBe("@@ -0,0 +1,2 @@");
  });

  it("returns no hunks for identical input", () => {
    expect(groupDiffHunks(ready("a\n", "a\n"))).toEqual([]);
  });
});

describe("limitDiffHunks", () => {
  it("cuts rendered lines at the limit and reports the hidden count", () => {
    const hunks = groupDiffHunks(ready("", Array.from({ length: 50 }, (_, i) => `n${i}`).join("\n")));
    const limited = limitDiffHunks(hunks, 20);
    expect(limited.hunks.reduce((total, hunk) => total + hunk.lines.length, 0)).toBe(20);
    expect(limited.hiddenLines).toBe(30);
  });
});

describe("splitDiffRows", () => {
  it("pairs deletions with insertions and pads the shorter side", () => {
    const [hunk] = groupDiffHunks(ready("a\nb\nc\nd\n", "a\nB\nC\nX\nd\n"));
    const rows = hunk === undefined ? [] : splitDiffRows(hunk);
    expect(
      rows.map((row) => [row.left?.kind ?? null, row.left?.text ?? null, row.right?.kind ?? null, row.right?.text ?? null]),
    ).toEqual([
      ["context", "a", "context", "a"],
      ["del", "b", "add", "B"],
      ["del", "c", "add", "C"],
      [null, null, "add", "X"],
      ["context", "d", "context", "d"],
    ]);
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `npx vitest run src/domain/diffView/diffHunks.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 7: Implement hunks**

Create `src/domain/diffView/diffHunks.ts`:

```ts
import type { DiffLine, DiffLineKind } from "./lineDiff";

export const DIFF_HUNK_CONTEXT_LINES = 3;
export const MAX_RENDERED_DIFF_LINES_PER_FILE = 2_000;

export interface DiffHunk {
  readonly header: string;
  readonly lines: ReadonlyArray<DiffLine>;
}

export interface SplitDiffCell {
  readonly line: number;
  readonly text: string;
  readonly kind: DiffLineKind;
}

export interface SplitDiffRow {
  readonly left: SplitDiffCell | null;
  readonly right: SplitDiffCell | null;
}

type LineField = "oldLine" | "newLine";

export function groupDiffHunks(
  lines: ReadonlyArray<DiffLine>,
  context: number = DIFF_HUNK_CONTEXT_LINES,
): ReadonlyArray<DiffHunk> {
  const ranges: Array<{ start: number; end: number }> = [];
  lines.forEach((line, index) => {
    if (line.kind === "context") return;
    const start = Math.max(0, index - context);
    const end = Math.min(lines.length - 1, index + context);
    const last = ranges[ranges.length - 1];
    if (last !== undefined && start <= last.end + 1) {
      last.end = Math.max(last.end, end);
      return;
    }
    ranges.push({ start, end });
  });
  return ranges.map(({ start, end }) => hunkFor(lines, start, end));
}

export function limitDiffHunks(
  hunks: ReadonlyArray<DiffHunk>,
  maxLines: number,
): { readonly hunks: ReadonlyArray<DiffHunk>; readonly hiddenLines: number } {
  const kept: DiffHunk[] = [];
  let budget = maxLines;
  let hiddenLines = 0;
  for (const hunk of hunks) {
    if (budget <= 0) {
      hiddenLines += hunk.lines.length;
      continue;
    }
    if (hunk.lines.length <= budget) {
      kept.push(hunk);
      budget -= hunk.lines.length;
      continue;
    }
    kept.push({ header: hunk.header, lines: hunk.lines.slice(0, budget) });
    hiddenLines += hunk.lines.length - budget;
    budget = 0;
  }
  return { hunks: kept, hiddenLines };
}

export function splitDiffRows(hunk: DiffHunk): ReadonlyArray<SplitDiffRow> {
  const rows: SplitDiffRow[] = [];
  const lines = hunk.lines;
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (line === undefined) break;
    if (line.kind === "context") {
      rows.push({ left: cell(line, "oldLine"), right: cell(line, "newLine") });
      index += 1;
      continue;
    }
    const deletions: DiffLine[] = [];
    const additions: DiffLine[] = [];
    while (index < lines.length && lines[index]?.kind === "del") {
      deletions.push(lines[index] as DiffLine);
      index += 1;
    }
    while (index < lines.length && lines[index]?.kind === "add") {
      additions.push(lines[index] as DiffLine);
      index += 1;
    }
    const count = Math.max(deletions.length, additions.length);
    for (let row = 0; row < count; row += 1) {
      const left = deletions[row];
      const right = additions[row];
      rows.push({
        left: left === undefined ? null : cell(left, "oldLine"),
        right: right === undefined ? null : cell(right, "newLine"),
      });
    }
  }
  return rows;
}

function hunkFor(lines: ReadonlyArray<DiffLine>, start: number, end: number): DiffHunk {
  const slice = lines.slice(start, end + 1);
  const oldCount = slice.filter((line) => line.oldLine !== null).length;
  const newCount = slice.filter((line) => line.newLine !== null).length;
  const oldStart = firstLine(slice, "oldLine") ?? lineBefore(lines, start, "oldLine");
  const newStart = firstLine(slice, "newLine") ?? lineBefore(lines, start, "newLine");
  return { header: `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`, lines: slice };
}

function firstLine(lines: ReadonlyArray<DiffLine>, field: LineField): number | null {
  for (const line of lines) {
    const value = line[field];
    if (value !== null) return value;
  }
  return null;
}

function lineBefore(lines: ReadonlyArray<DiffLine>, start: number, field: LineField): number {
  for (let index = start - 1; index >= 0; index -= 1) {
    const value = lines[index]?.[field] ?? null;
    if (value !== null) return value;
  }
  return 0;
}

function cell(line: DiffLine, field: LineField): SplitDiffCell {
  return { line: line[field] ?? 0, text: line.text, kind: line.kind };
}
```

- [ ] **Step 8: Run the hunk tests**

Run: `npx vitest run src/domain/diffView`
Expected: PASS.

- [ ] **Step 9: Write the failing worker-gateway test**

Create `src/infrastructure/browserDiffViewGateway.test.ts`:

```ts
// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import type { DiffViewWorkerRequest, DiffViewWorkerResponse } from "../application/diffViewComputation";
import { computeLineDiff } from "../domain/diffView/lineDiff";
import { BrowserDiffViewGateway } from "./browserDiffViewGateway";

class FakeWorker {
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessage: ((event: MessageEvent<DiffViewWorkerResponse>) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  readonly posted: DiffViewWorkerRequest[] = [];
  terminated = false;

  postMessage(request: DiffViewWorkerRequest): void {
    this.posted.push(request);
  }

  terminate(): void {
    this.terminated = true;
  }

  reply(index: number): void {
    const request = this.posted[index];
    if (request === undefined) return;
    const result = computeLineDiff(request.original, request.modified, {
      ignoreWhitespace: request.ignoreWhitespace,
    });
    this.onmessage?.(new MessageEvent("message", { data: { requestId: request.requestId, result } }));
  }
}

function gateway(timeoutMs = 5_000) {
  const workers: FakeWorker[] = [];
  const instance = new BrowserDiffViewGateway(() => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker as unknown as Worker;
  }, timeoutMs);
  return { instance, workers };
}

describe("BrowserDiffViewGateway", () => {
  it("routes responses to the request that sent them, out of order", async () => {
    const { instance, workers } = gateway();
    const first = instance.compute({ original: "a", modified: "b", ignoreWhitespace: false }, new AbortController().signal);
    const second = instance.compute({ original: "x", modified: "x", ignoreWhitespace: false }, new AbortController().signal);
    workers[0]?.reply(1);
    workers[0]?.reply(0);

    await expect(second).resolves.toMatchObject({ kind: "ready", added: 0 });
    await expect(first).resolves.toMatchObject({ kind: "ready", added: 1, deleted: 1 });
  });

  it("rejects an aborted request and ignores its late response", async () => {
    const { instance, workers } = gateway();
    const controller = new AbortController();
    const pending = instance.compute({ original: "a", modified: "b", ignoreWhitespace: false }, controller.signal);
    controller.abort();
    workers[0]?.reply(0);

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("terminates a hung worker on timeout and starts a fresh one", async () => {
    const { instance, workers } = gateway(10);
    const hung = instance.compute({ original: "a", modified: "b", ignoreWhitespace: false }, new AbortController().signal);
    await expect(hung).rejects.toThrow("Diff calculation timed out.");
    expect(workers[0]?.terminated).toBe(true);

    const next = instance.compute({ original: "a", modified: "a", ignoreWhitespace: false }, new AbortController().signal);
    workers[1]?.reply(0);
    await expect(next).resolves.toMatchObject({ kind: "ready" });
  });
});
```

- [ ] **Step 10: Implement the port, worker and gateways**

Create `src/application/diffViewComputation.ts`:

```ts
import type { LineDiffResult } from "../domain/diffView/lineDiff";

export interface DiffViewComputationInput {
  readonly original: string;
  readonly modified: string;
  readonly ignoreWhitespace: boolean;
}

export interface DiffViewWorkerRequest extends DiffViewComputationInput {
  readonly requestId: number;
}

export interface DiffViewWorkerResponse {
  readonly requestId: number;
  readonly result: LineDiffResult;
}

export interface DiffViewComputationGateway {
  compute(input: DiffViewComputationInput, signal: AbortSignal): Promise<LineDiffResult>;
}
```

Create `src/infrastructure/diffView.worker.ts`:

```ts
/// <reference lib="webworker" />

import type { DiffViewWorkerRequest, DiffViewWorkerResponse } from "../application/diffViewComputation";
import { computeLineDiff } from "../domain/diffView/lineDiff";

const workerScope: DedicatedWorkerGlobalScope = self as DedicatedWorkerGlobalScope;

workerScope.onmessage = (event: MessageEvent<DiffViewWorkerRequest>) => {
  const request = event.data;
  const response: DiffViewWorkerResponse = {
    requestId: request.requestId,
    result: computeLineDiff(request.original, request.modified, {
      ignoreWhitespace: request.ignoreWhitespace,
    }),
  };
  workerScope.postMessage(response);
};

export {};
```

Create `src/infrastructure/browserDiffViewGateway.ts`:

```ts
import type {
  DiffViewComputationGateway,
  DiffViewComputationInput,
  DiffViewWorkerResponse,
} from "../application/diffViewComputation";
import type { LineDiffResult } from "../domain/diffView/lineDiff";

export const DIFF_VIEW_TIMEOUT_MS = 5_000;
export const MAX_PENDING_DIFF_VIEW_REQUESTS = 32;

type DiffViewWorker = Pick<Worker, "onerror" | "onmessage" | "onmessageerror" | "postMessage" | "terminate">;

interface PendingRequest {
  resolve(result: LineDiffResult): void;
  reject(error: unknown): void;
  readonly timeout: number;
  cleanup(): void;
}

type Settlement =
  | { readonly kind: "resolve"; readonly result: LineDiffResult }
  | { readonly kind: "reject"; readonly error: unknown };

export class BrowserDiffViewGateway implements DiffViewComputationGateway {
  private worker: DiffViewWorker | null = null;
  private nextRequestId = 1;
  private readonly pending = new Map<number, PendingRequest>();

  constructor(
    private readonly createWorker: () => DiffViewWorker = defaultWorkerFactory,
    private readonly timeoutMs = DIFF_VIEW_TIMEOUT_MS,
  ) {}

  compute(input: DiffViewComputationInput, signal: AbortSignal): Promise<LineDiffResult> {
    if (signal.aborted) return Promise.reject(abortError());
    if (this.pending.size >= MAX_PENDING_DIFF_VIEW_REQUESTS) {
      return Promise.reject(new Error("Too many diff calculations are pending."));
    }
    let worker: DiffViewWorker;
    try {
      worker = this.ensureWorker();
    } catch (error) {
      return Promise.reject(error);
    }
    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    return new Promise<LineDiffResult>((resolve, reject) => {
      const onAbort = () => this.settle(requestId, { kind: "reject", error: abortError() });
      const timeout = window.setTimeout(
        () => this.failAll(new Error("Diff calculation timed out.")),
        Math.max(1, this.timeoutMs),
      );
      this.pending.set(requestId, {
        resolve,
        reject,
        timeout,
        cleanup: () => signal.removeEventListener("abort", onAbort),
      });
      signal.addEventListener("abort", onAbort, { once: true });
      try {
        worker.postMessage({ requestId, ...input });
      } catch (error) {
        this.settle(requestId, { kind: "reject", error });
      }
    });
  }

  private ensureWorker(): DiffViewWorker {
    if (this.worker !== null) return this.worker;
    const worker = this.createWorker();
    worker.onmessage = (event: MessageEvent<DiffViewWorkerResponse>) =>
      this.settle(event.data.requestId, { kind: "resolve", result: event.data.result });
    worker.onerror = (event) =>
      this.failAll(new Error(event.message || "Diff calculation worker failed."));
    worker.onmessageerror = () =>
      this.failAll(new Error("Diff calculation returned an unreadable response."));
    this.worker = worker;
    return worker;
  }

  private settle(requestId: number, settlement: Settlement): void {
    const entry = this.pending.get(requestId);
    if (entry === undefined) return;
    this.pending.delete(requestId);
    window.clearTimeout(entry.timeout);
    entry.cleanup();
    if (settlement.kind === "resolve") {
      entry.resolve(settlement.result);
      return;
    }
    entry.reject(settlement.error);
  }

  private failAll(error: Error): void {
    const worker = this.worker;
    this.worker = null;
    worker?.terminate();
    for (const requestId of [...this.pending.keys()]) {
      this.settle(requestId, { kind: "reject", error });
    }
  }
}

function defaultWorkerFactory(): DiffViewWorker {
  return new Worker(new URL("./diffView.worker.ts", import.meta.url), { type: "module" });
}

function abortError(): DOMException {
  return new DOMException("Diff calculation was cancelled.", "AbortError");
}
```

Create `src/infrastructure/inlineDiffViewGateway.ts`:

```ts
import type { DiffViewComputationGateway } from "../application/diffViewComputation";
import { computeLineDiff } from "../domain/diffView/lineDiff";

export const inlineDiffViewGateway: DiffViewComputationGateway = {
  compute(input, signal) {
    if (signal.aborted) {
      return Promise.reject(new DOMException("Diff calculation was cancelled.", "AbortError"));
    }
    return Promise.resolve(
      computeLineDiff(input.original, input.modified, { ignoreWhitespace: input.ignoreWhitespace }),
    );
  },
};
```

- [ ] **Step 11: Run the Task 4 suites**

Run: `npx vitest run src/domain/diffView src/infrastructure/browserDiffViewGateway.test.ts && npm run check`
Expected: PASS, and `tsc` exit 0.

- [ ] **Step 12: Measure (performance evidence)**

Run this once and paste the output into the task report:

```bash
npx tsx -e 'import { computeLineDiff } from "./src/domain/diffView/lineDiff.ts"; const a = Array.from({length: 4000}, (_, i) => `const value${i} = ${i};`).join("\n"); const b = a.split("\n").map((l, i) => (i % 7 === 0 ? l + " // edited" : l)).join("\n"); const t = performance.now(); const r = computeLineDiff(a, b, { ignoreWhitespace: false }); console.log(r.kind, Math.round(performance.now() - t), "ms");'
```

Expected: `ready`, well under the 5 s worker timeout (typically < 200 ms). If `tsx` is not installed, run the same code as a temporary Vitest `it` in a scratch file under `/tmp`, never in the repo.

- [ ] **Step 13: Hand off (no commit)**

---
### Task 5: Diff scope, diff sources and the diff surface state hook

**Files:**
- Create: `src/domain/diffView/agentDiffScope.ts`, `src/application/rightPanel/agentDiffSources.ts`, `src/application/rightPanel/useAgentDiffSurface.ts`
- Test: `src/domain/diffView/agentDiffScope.test.ts`, `src/application/rightPanel/agentDiffSources.test.ts`, `src/application/rightPanel/useAgentDiffSurface.test.tsx`

**Interfaces:**
- Consumes: Task 4 `DiffViewComputationGateway`, `groupDiffHunks`, `limitDiffHunks`, `MAX_RENDERED_DIFF_LINES_PER_FILE`, `inlineDiffViewGateway` (tests). Existing `GitGateway` (`getStatus`, `getDiff`), `AgentTurnChangeSummary`, `AgentTurnFileDiff`, `AgentTurn`.
- Produces:
  - `type AgentDiffScope = { kind: "latestTurn" } | { kind: "turn"; turnId: string } | { kind: "workingTree" } | { kind: "branch"; baseRef: string }`
  - `DEFAULT_THREAD_DIFF_SCOPE`, `DEFAULT_PROJECT_DIFF_SCOPE`, `MAX_AGENT_DIFF_TURN_OPTIONS = 50`
  - `interface AgentDiffTurnOption { turnId; label; endedAtEpochMs }`, `agentDiffTurnOptions(turns)`, `type ResolvedAgentDiffScope`, `resolveAgentDiffScope(scope, turns)`, `agentDiffScopeLabel(scope, turns): string`, `agentDiffScopeActiveTurnId(scope, turns): string | null`, `agentDiffScopesEqual(a, b): boolean`
  - `MAX_AGENT_DIFF_FILES = 500`
  - `interface AgentDiffFile { repositoryRoot: string; relativePath: string; displayPath: string; oldRelativePath: string | null; status: GitChangeStatus; added: number | null; deleted: number | null }`
  - `interface AgentDiffFileList { files; truncated: boolean; unavailableReason: string | null }`
  - `type AgentDiffSidesUnavailable = "binary" | "large" | "missing"`, `interface AgentDiffSides { original; modified; truncated: boolean; unavailableReason: AgentDiffSidesUnavailable | null }`
  - `interface AgentDiffSource { key: string; listFiles(): Promise<AgentDiffFileList>; readSides(file: AgentDiffFile): Promise<AgentDiffSides> }`
  - `interface AgentDiffLineStatsPort { lineStats(repositoryRoot: string, worktreePath: string | null): Promise<ReadonlyArray<{ relativePath: string; added: number | null; deleted: number | null }>> }`
  - `agentDiffRevisionKey(revision: object | undefined): number`
  - `turnDiffSource(input: TurnDiffSourceInput): AgentDiffSource`, `workingTreeDiffSource(input: WorkingTreeDiffSourceInput): AgentDiffSource`
  - `type AgentDiffFileBody = { kind: "collapsed" } | { kind: "loading" } | { kind: "ready"; hunks; added; deleted; truncated: boolean; hiddenLines: number } | { kind: "unavailable"; reason: string }`
  - `interface AgentDiffFileView { file; body }`, `type AgentDiffListStatus`
  - `useAgentDiffSurface(options: { source: AgentDiffSource | null; computation: DiffViewComputationGateway; ignoreWhitespace: boolean }): AgentDiffSurfaceState` with `{ status; files: ReadonlyArray<AgentDiffFileView>; toggleFile(displayPath); revealFile(displayPath); collapseAll(); refresh() }`

- [ ] **Step 1: Write the failing scope test**

Create `src/domain/diffView/agentDiffScope.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  agentDiffScopeActiveTurnId,
  agentDiffScopeLabel,
  agentDiffScopesEqual,
  agentDiffTurnOptions,
  resolveAgentDiffScope,
} from "./agentDiffScope";

const turns = [
  { turnId: "t1", endedAtEpochMs: 1_000 },
  { turnId: "t2", endedAtEpochMs: 2_000 },
  { turnId: "t3", endedAtEpochMs: null },
];

describe("agent diff scope", () => {
  it("offers finished turns newest first with their 1-based position", () => {
    expect(agentDiffTurnOptions(turns)).toEqual([
      { turnId: "t2", label: "Turn 2", endedAtEpochMs: 2_000 },
      { turnId: "t1", label: "Turn 1", endedAtEpochMs: 1_000 },
    ]);
  });

  it("resolves the latest turn to the newest finished turn", () => {
    expect(resolveAgentDiffScope({ kind: "latestTurn" }, turns)).toEqual({
      kind: "turn",
      turnId: "t2",
      label: "Turn 2",
    });
    expect(resolveAgentDiffScope({ kind: "latestTurn" }, [])).toEqual({ kind: "noTurns" });
  });

  it("labels every scope for the toolbar", () => {
    expect(agentDiffScopeLabel({ kind: "latestTurn" }, turns)).toBe("Latest turn");
    expect(agentDiffScopeLabel({ kind: "turn", turnId: "t1" }, turns)).toBe("Turn 1");
    expect(agentDiffScopeLabel({ kind: "workingTree" }, turns)).toBe("Working tree");
    expect(agentDiffScopeLabel({ kind: "branch", baseRef: "main" }, turns)).toBe("Branch changes");
  });

  it("reports the active turn only for turn scopes", () => {
    expect(agentDiffScopeActiveTurnId({ kind: "latestTurn" }, turns)).toBe("t2");
    expect(agentDiffScopeActiveTurnId({ kind: "turn", turnId: "gone" }, turns)).toBeNull();
    expect(agentDiffScopeActiveTurnId({ kind: "workingTree" }, turns)).toBeNull();
  });

  it("compares scopes structurally", () => {
    expect(agentDiffScopesEqual({ kind: "branch", baseRef: "main" }, { kind: "branch", baseRef: "main" })).toBe(true);
    expect(agentDiffScopesEqual({ kind: "turn", turnId: "a" }, { kind: "turn", turnId: "b" })).toBe(false);
  });
});
```

- [ ] **Step 2: Implement the scope module**

Create `src/domain/diffView/agentDiffScope.ts`:

```ts
import type { AgentTurn } from "../agentThread";

export type AgentDiffScope =
  | { readonly kind: "latestTurn" }
  | { readonly kind: "turn"; readonly turnId: string }
  | { readonly kind: "workingTree" }
  | { readonly kind: "branch"; readonly baseRef: string };

export type ResolvedAgentDiffScope =
  | { readonly kind: "turn"; readonly turnId: string; readonly label: string }
  | { readonly kind: "workingTree" }
  | { readonly kind: "branch"; readonly baseRef: string }
  | { readonly kind: "noTurns" };

export interface AgentDiffTurnOption {
  readonly turnId: string;
  readonly label: string;
  readonly endedAtEpochMs: number;
}

export type AgentDiffTurn = Pick<AgentTurn, "turnId" | "endedAtEpochMs">;

export const MAX_AGENT_DIFF_TURN_OPTIONS = 50;
export const DEFAULT_THREAD_DIFF_SCOPE: AgentDiffScope = Object.freeze({ kind: "latestTurn" });
export const DEFAULT_PROJECT_DIFF_SCOPE: AgentDiffScope = Object.freeze({ kind: "workingTree" });

export function agentDiffTurnOptions(
  turns: ReadonlyArray<AgentDiffTurn>,
): ReadonlyArray<AgentDiffTurnOption> {
  const options: AgentDiffTurnOption[] = [];
  turns.forEach((turn, index) => {
    if (turn.endedAtEpochMs === null) return;
    options.push({ turnId: turn.turnId, label: `Turn ${index + 1}`, endedAtEpochMs: turn.endedAtEpochMs });
  });
  return options.reverse().slice(0, MAX_AGENT_DIFF_TURN_OPTIONS);
}

export function resolveAgentDiffScope(
  scope: AgentDiffScope,
  turns: ReadonlyArray<AgentDiffTurn>,
): ResolvedAgentDiffScope {
  switch (scope.kind) {
    case "latestTurn": {
      const latest = agentDiffTurnOptions(turns)[0];
      if (latest === undefined) return { kind: "noTurns" };
      return { kind: "turn", turnId: latest.turnId, label: latest.label };
    }
    case "turn": {
      const index = turns.findIndex((turn) => turn.turnId === scope.turnId);
      if (index < 0) return { kind: "noTurns" };
      return { kind: "turn", turnId: scope.turnId, label: `Turn ${index + 1}` };
    }
    case "workingTree":
      return { kind: "workingTree" };
    case "branch":
      return { kind: "branch", baseRef: scope.baseRef };
  }
}

export function agentDiffScopeLabel(
  scope: AgentDiffScope,
  turns: ReadonlyArray<AgentDiffTurn>,
): string {
  switch (scope.kind) {
    case "latestTurn":
      return "Latest turn";
    case "turn": {
      const resolved = resolveAgentDiffScope(scope, turns);
      return resolved.kind === "turn" ? resolved.label : "Turn";
    }
    case "workingTree":
      return "Working tree";
    case "branch":
      return "Branch changes";
  }
}

export function agentDiffScopeActiveTurnId(
  scope: AgentDiffScope,
  turns: ReadonlyArray<AgentDiffTurn>,
): string | null {
  const resolved = resolveAgentDiffScope(scope, turns);
  return resolved.kind === "turn" ? resolved.turnId : null;
}

export function agentDiffScopesEqual(left: AgentDiffScope, right: AgentDiffScope): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "turn" && right.kind === "turn") return left.turnId === right.turnId;
  if (left.kind === "branch" && right.kind === "branch") return left.baseRef === right.baseRef;
  return true;
}
```

Run: `npx vitest run src/domain/diffView/agentDiffScope.test.ts`
Expected: PASS.

- [ ] **Step 3: Write the failing source tests**

Create `src/application/rightPanel/agentDiffSources.test.ts`. The sources are adapters over ports. The test gives them in-memory port implementations (turn reader, `GitGateway` subset) that behave like the backends: no mocks of internal modules.

```ts
import { describe, expect, it } from "vitest";
import type { AgentTurnChangeSummary, AgentTurnFileDiff } from "../../domain/agentTurnChanges";
import type { GitChangedFile, GitFileDiff, GitStatus } from "../../domain/git";
import {
  agentDiffRevisionKey,
  turnDiffSource,
  workingTreeDiffSource,
  type AgentDiffLineStatsPort,
} from "./agentDiffSources";

function change(relativePath: string, status: GitChangedFile["status"] = "modified"): GitChangedFile {
  return {
    isStaged: false,
    isUnversioned: status === "untracked",
    oldPath: null,
    oldRelativePath: null,
    path: `/repo/${relativePath}`,
    relativePath,
    status,
  };
}

describe("turnDiffSource", () => {
  it("lists recorded files with their line counts and reads both sides", async () => {
    const summary: AgentTurnChangeSummary = {
      turnId: "t1",
      state: "ready",
      truncated: false,
      reason: null,
      files: [
        { relativePath: "src/a.ts", oldRelativePath: null, status: "modified", addedLines: 3, deletedLines: 1 },
      ],
    };
    const fileDiff: AgentTurnFileDiff = {
      relativePath: "src/a.ts",
      original: { text: "a\n", truncated: false },
      modified: { text: "b\n", truncated: true },
      unavailableReason: null,
    };
    const source = turnDiffSource({
      threadId: "thread-1",
      turnId: "t1",
      repositoryRoot: "/repo",
      revision: 1,
      getTurnChanges: async () => summary,
      getTurnFileDiff: async () => fileDiff,
    });

    const list = await source.listFiles();
    expect(list.files).toEqual([
      {
        repositoryRoot: "/repo",
        relativePath: "src/a.ts",
        displayPath: "src/a.ts",
        oldRelativePath: null,
        status: "modified",
        added: 3,
        deleted: 1,
      },
    ]);
    const first = list.files[0];
    if (first === undefined) return;
    await expect(source.readSides(first)).resolves.toEqual({
      original: "a\n",
      modified: "b\n",
      truncated: true,
      unavailableReason: null,
    });
  });

  it("reports an unavailable recorded turn truthfully", async () => {
    const source = turnDiffSource({
      threadId: "thread-1",
      turnId: "t1",
      repositoryRoot: "/repo",
      revision: 1,
      getTurnChanges: async () => ({
        turnId: "t1",
        state: "unavailable",
        files: [],
        truncated: false,
        reason: "Recorded changes were pruned.",
      }),
      getTurnFileDiff: async () => ({
        relativePath: "",
        original: { text: "", truncated: false },
        modified: { text: "", truncated: false },
        unavailableReason: null,
      }),
    });
    await expect(source.listFiles()).resolves.toMatchObject({
      files: [],
      unavailableReason: "Recorded changes were pruned.",
    });
  });
});

describe("workingTreeDiffSource", () => {
  const status = (root: string, changes: GitChangedFile[]): GitStatus => ({
    branch: "main",
    changes,
    isRepository: true,
    rootPath: root,
  });

  it("merges line stats, prefixes nested repositories and reads through getDiff", async () => {
    const git = {
      getStatus: async (root: string) =>
        root === "/repo"
          ? status(root, [change("src/a.ts")])
          : status(root, [change("index.ts", "untracked")]),
      getDiff: async (_root: string, file: GitChangedFile): Promise<GitFileDiff> => ({
        change: file,
        language: "typescript",
        originalContent: "old\n",
        modifiedContent: "new\n",
        previewUnavailableReason: null,
      }),
    };
    const lineStats: AgentDiffLineStatsPort = {
      lineStats: async () => [{ relativePath: "src/a.ts", added: 4, deleted: 2 }],
    };
    const source = workingTreeDiffSource({
      repositories: [
        { root: "/repo", prefix: "" },
        { root: "/repo/packages/api", prefix: "packages/api/" },
      ],
      worktreePath: null,
      revision: 0,
      git,
      lineStats,
    });

    const list = await source.listFiles();
    expect(list.files.map((file) => [file.displayPath, file.added, file.deleted])).toEqual([
      ["src/a.ts", 4, 2],
      ["packages/api/index.ts", null, null],
    ]);
    const nested = list.files[1];
    if (nested === undefined) return;
    await expect(source.readSides(nested)).resolves.toEqual({
      original: "old\n",
      modified: "new\n",
      truncated: false,
      unavailableReason: null,
    });
  });

  it("marks a file that disappeared since listing as missing", async () => {
    const source = workingTreeDiffSource({
      repositories: [{ root: "/repo", prefix: "" }],
      worktreePath: null,
      revision: 0,
      git: {
        getStatus: async () => status("/repo", []),
        getDiff: async (_root: string, file: GitChangedFile) => ({
          change: file,
          language: "text",
          originalContent: "",
          modifiedContent: "",
        }),
      },
      lineStats: null,
    });
    await expect(
      source.readSides({
        repositoryRoot: "/repo",
        relativePath: "gone.ts",
        displayPath: "gone.ts",
        oldRelativePath: null,
        status: "modified",
        added: null,
        deleted: null,
      }),
    ).resolves.toMatchObject({ unavailableReason: "missing" });
  });

  it("keeps working when line stats fail", async () => {
    const source = workingTreeDiffSource({
      repositories: [{ root: "/repo", prefix: "" }],
      worktreePath: null,
      revision: 0,
      git: {
        getStatus: async () => status("/repo", [change("a.ts")]),
        getDiff: async (_root: string, file: GitChangedFile) => ({
          change: file,
          language: "text",
          originalContent: "",
          modifiedContent: "",
        }),
      },
      lineStats: { lineStats: () => Promise.reject(new Error("offline")) },
    });
    await expect(source.listFiles()).resolves.toMatchObject({ files: [{ added: null }] });
  });
});

describe("agentDiffRevisionKey", () => {
  it("gives each revision object a stable distinct number", () => {
    const a = {};
    const b = {};
    expect(agentDiffRevisionKey(a)).toBe(agentDiffRevisionKey(a));
    expect(agentDiffRevisionKey(a)).not.toBe(agentDiffRevisionKey(b));
    expect(agentDiffRevisionKey(undefined)).toBe(0);
  });
});
```

If `GitFileDiff` requires other fields in this codebase, add them to the literals with their real names. Do not use casts.

- [ ] **Step 4: Implement the sources**

Create `src/application/rightPanel/agentDiffSources.ts`:

```ts
import type { AgentTurnChangeSummary, AgentTurnFileDiff } from "../../domain/agentTurnChanges";
import type { GitChangeStatus, GitChangedFile, GitGateway } from "../../domain/git";

export const MAX_AGENT_DIFF_FILES = 500;

export interface AgentDiffFile {
  readonly repositoryRoot: string;
  readonly relativePath: string;
  readonly displayPath: string;
  readonly oldRelativePath: string | null;
  readonly status: GitChangeStatus;
  readonly added: number | null;
  readonly deleted: number | null;
}

export interface AgentDiffFileList {
  readonly files: ReadonlyArray<AgentDiffFile>;
  readonly truncated: boolean;
  readonly unavailableReason: string | null;
}

export type AgentDiffSidesUnavailable = "binary" | "large" | "missing";

export interface AgentDiffSides {
  readonly original: string;
  readonly modified: string;
  readonly truncated: boolean;
  readonly unavailableReason: AgentDiffSidesUnavailable | null;
}

export interface AgentDiffSource {
  readonly key: string;
  listFiles(): Promise<AgentDiffFileList>;
  readSides(file: AgentDiffFile): Promise<AgentDiffSides>;
}

export interface AgentDiffLineStat {
  readonly relativePath: string;
  readonly added: number | null;
  readonly deleted: number | null;
}

export interface AgentDiffLineStatsPort {
  lineStats(repositoryRoot: string, worktreePath: string | null): Promise<ReadonlyArray<AgentDiffLineStat>>;
}

export interface TurnDiffSourceInput {
  readonly threadId: string;
  readonly turnId: string;
  readonly repositoryRoot: string;
  readonly revision: number;
  getTurnChanges(threadId: string, turnId: string): Promise<AgentTurnChangeSummary>;
  getTurnFileDiff(threadId: string, turnId: string, relativePath: string): Promise<AgentTurnFileDiff>;
}

export interface WorkingTreeRepository {
  readonly root: string;
  readonly prefix: string;
}

export interface WorkingTreeDiffSourceInput {
  readonly repositories: ReadonlyArray<WorkingTreeRepository>;
  readonly worktreePath: string | null;
  readonly revision: number;
  readonly git: Pick<GitGateway, "getStatus" | "getDiff">;
  readonly lineStats: AgentDiffLineStatsPort | null;
}

const revisionKeys = new WeakMap<object, number>();
let nextRevisionKey = 1;

export function agentDiffRevisionKey(revision: object | undefined): number {
  if (revision === undefined) return 0;
  const known = revisionKeys.get(revision);
  if (known !== undefined) return known;
  const key = nextRevisionKey;
  nextRevisionKey += 1;
  revisionKeys.set(revision, key);
  return key;
}

export function turnDiffSource(input: TurnDiffSourceInput): AgentDiffSource {
  return {
    key: JSON.stringify(["turn", input.threadId, input.turnId, input.revision]),
    async listFiles() {
      const summary = await input.getTurnChanges(input.threadId, input.turnId);
      if (summary.state !== "ready") {
        return {
          files: [],
          truncated: false,
          unavailableReason: summary.reason ?? "Changes for this turn are unavailable.",
        };
      }
      return {
        files: summary.files.slice(0, MAX_AGENT_DIFF_FILES).map((file) => ({
          repositoryRoot: input.repositoryRoot,
          relativePath: file.relativePath,
          displayPath: file.relativePath,
          oldRelativePath: file.oldRelativePath,
          status: file.status,
          added: file.addedLines,
          deleted: file.deletedLines,
        })),
        truncated: summary.truncated || summary.files.length > MAX_AGENT_DIFF_FILES,
        unavailableReason: null,
      };
    },
    async readSides(file) {
      const diff = await input.getTurnFileDiff(input.threadId, input.turnId, file.relativePath);
      return {
        original: diff.original.text,
        modified: diff.modified.text,
        truncated: diff.original.truncated || diff.modified.truncated,
        unavailableReason: diff.unavailableReason,
      };
    },
  };
}

export function workingTreeDiffSource(input: WorkingTreeDiffSourceInput): AgentDiffSource {
  const changes = new Map<string, GitChangedFile>();
  return {
    key: JSON.stringify([
      "workingTree",
      input.repositories.map((repository) => repository.root),
      input.worktreePath,
      input.revision,
    ]),
    async listFiles() {
      const lists = await Promise.all(
        input.repositories.map((repository) => listRepository(input, repository)),
      );
      changes.clear();
      const files: AgentDiffFile[] = [];
      let total = 0;
      for (const list of lists) {
        total += list.length;
        for (const entry of list) {
          if (files.length >= MAX_AGENT_DIFF_FILES) break;
          changes.set(changeKey(entry.file.repositoryRoot, entry.file.relativePath), entry.change);
          files.push(entry.file);
        }
      }
      return { files, truncated: total > MAX_AGENT_DIFF_FILES, unavailableReason: null };
    },
    async readSides(file) {
      const known = changes.get(changeKey(file.repositoryRoot, file.relativePath));
      if (known === undefined) {
        return { original: "", modified: "", truncated: false, unavailableReason: "missing" };
      }
      const diff = await input.git.getDiff(file.repositoryRoot, known);
      return {
        original: diff.originalContent,
        modified: diff.modifiedContent,
        truncated: false,
        unavailableReason: diff.previewUnavailableReason ?? null,
      };
    },
  };
}

async function listRepository(
  input: WorkingTreeDiffSourceInput,
  repository: WorkingTreeRepository,
): Promise<ReadonlyArray<{ readonly file: AgentDiffFile; readonly change: GitChangedFile }>> {
  const [status, stats] = await Promise.all([
    input.git.getStatus(repository.root),
    lineStatsFor(input, repository.root),
  ]);
  return status.changes.map((change) => {
    const stat = stats.get(change.relativePath);
    return {
      change,
      file: {
        repositoryRoot: repository.root,
        relativePath: change.relativePath,
        displayPath: `${repository.prefix}${change.relativePath}`,
        oldRelativePath: change.oldRelativePath,
        status: change.status,
        added: stat?.added ?? null,
        deleted: stat?.deleted ?? null,
      },
    };
  });
}

async function lineStatsFor(
  input: WorkingTreeDiffSourceInput,
  root: string,
): Promise<ReadonlyMap<string, AgentDiffLineStat>> {
  if (input.lineStats === null) return new Map();
  try {
    const stats = await input.lineStats.lineStats(root, input.worktreePath);
    return new Map(stats.map((stat) => [stat.relativePath, stat]));
  } catch {
    return new Map();
  }
}

function changeKey(root: string, relativePath: string): string {
  return JSON.stringify([root, relativePath]);
}
```

Run: `npx vitest run src/application/rightPanel/agentDiffSources.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing hook test**

Create `src/application/rightPanel/useAgentDiffSurface.test.tsx`:

```tsx
// @vitest-environment jsdom

import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { waitForReact } from "../../test/reactTestLifecycle";
import { mountUi, type MountedUi } from "../../ui/foundation/foundationTestSupport";
import { inlineDiffViewGateway } from "../../infrastructure/inlineDiffViewGateway";
import type { AgentDiffFile, AgentDiffFileList, AgentDiffSides, AgentDiffSource } from "./agentDiffSources";
import { useAgentDiffSurface, type AgentDiffSurfaceState } from "./useAgentDiffSurface";

let ui: MountedUi | null = null;
afterEach(() => {
  ui?.unmount();
  ui = null;
});

function file(displayPath: string): AgentDiffFile {
  return {
    repositoryRoot: "/repo",
    relativePath: displayPath,
    displayPath,
    oldRelativePath: null,
    status: "modified",
    added: 1,
    deleted: 1,
  };
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function memorySource(
  key: string,
  files: ReadonlyArray<AgentDiffFile>,
  sides: (file: AgentDiffFile) => AgentDiffSides,
  list: Promise<AgentDiffFileList> = Promise.resolve({ files, truncated: false, unavailableReason: null }),
): AgentDiffSource {
  return { key, listFiles: () => list, readSides: async (target) => sides(target) };
}

function render(source: AgentDiffSource | null, ignoreWhitespace = false) {
  const box: { current: AgentDiffSurfaceState | null } = { current: null };
  function Probe(props: { readonly source: AgentDiffSource | null; readonly ignoreWhitespace: boolean }) {
    box.current = useAgentDiffSurface({
      source: props.source,
      computation: inlineDiffViewGateway,
      ignoreWhitespace: props.ignoreWhitespace,
    });
    return null;
  }
  ui = ui ?? mountUi();
  ui.render(<Probe ignoreWhitespace={ignoreWhitespace} source={source} />);
  return box;
}

const plainSides = (): AgentDiffSides => ({
  original: "a\nb\n",
  modified: "a\nB\n",
  truncated: false,
  unavailableReason: null,
});

describe("useAgentDiffSurface", () => {
  it("expands the first three files and computes their hunks", async () => {
    const files = ["a.ts", "b.ts", "c.ts", "d.ts"].map(file);
    const box = render(memorySource("s1", files, plainSides));

    await waitForReact(() => expect(box.current?.status.kind).toBe("ready"));
    await waitForReact(() => expect(box.current?.files[0]?.body.kind).toBe("ready"));
    expect(box.current?.files.map((view) => view.body.kind)).toEqual(["ready", "ready", "ready", "collapsed"]);
  });

  it("ignores a late file list from a superseded source", async () => {
    const late = deferred<AgentDiffFileList>();
    render(memorySource("old", [], plainSides, late.promise));
    const box = render(memorySource("new", [file("fresh.ts")], plainSides));

    await waitForReact(() => expect(box.current?.files.map((view) => view.file.displayPath)).toEqual(["fresh.ts"]));
    await act(async () => late.resolve({ files: [file("stale.ts")], truncated: false, unavailableReason: null }));
    expect(box.current?.files.map((view) => view.file.displayPath)).toEqual(["fresh.ts"]);
  });

  it("shows binary and oversized files as unavailable with a reason", async () => {
    const box = render(
      memorySource("s2", [file("image.png")], () => ({
        original: "",
        modified: "",
        truncated: false,
        unavailableReason: "binary",
      })),
    );
    await waitForReact(() =>
      expect(box.current?.files[0]?.body).toEqual({
        kind: "unavailable",
        reason: "Binary file. Open it in the editor to inspect it.",
      }),
    );
  });

  it("recomputes with whitespace ignored without refetching the list", async () => {
    let listCalls = 0;
    const source: AgentDiffSource = {
      key: "ws",
      listFiles: async () => {
        listCalls += 1;
        return { files: [file("a.ts")], truncated: false, unavailableReason: null };
      },
      readSides: async () => ({ original: "  x\n", modified: "    x\n", truncated: false, unavailableReason: null }),
    };
    const box = render(source, false);
    await waitForReact(() => expect(box.current?.files[0]?.body).toMatchObject({ kind: "ready", added: 1 }));

    render(source, true);
    await waitForReact(() => expect(box.current?.files[0]?.body).toMatchObject({ kind: "ready", added: 0 }));
    expect(listCalls).toBe(1);
  });

  it("toggles, reveals and collapses files", async () => {
    const box = render(memorySource("s3", ["a.ts", "b.ts", "c.ts", "d.ts"].map(file), plainSides));
    await waitForReact(() => expect(box.current?.status.kind).toBe("ready"));

    act(() => box.current?.toggleFile("a.ts"));
    act(() => box.current?.revealFile("d.ts"));
    expect(box.current?.files.map((view) => view.body.kind === "collapsed")).toEqual([true, false, false, false]);
    act(() => box.current?.collapseAll());
    expect(box.current?.files.every((view) => view.body.kind === "collapsed")).toBe(true);
  });

  it("surfaces a failed list with its message", async () => {
    const box = render({
      key: "broken",
      listFiles: () => Promise.reject(new Error("git status failed")),
      readSides: async () => plainSides(),
    });
    await waitForReact(() =>
      expect(box.current?.status).toEqual({ kind: "failed", message: "git status failed" }),
    );
  });
});
```

- [ ] **Step 6: Implement the hook**

Create `src/application/rightPanel/useAgentDiffSurface.ts`:

```ts
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MAX_RENDERED_DIFF_LINES_PER_FILE,
  groupDiffHunks,
  limitDiffHunks,
  type DiffHunk,
} from "../../domain/diffView/diffHunks";
import { useLatest } from "../../ui/foundation/useLatest";
import type { DiffViewComputationGateway } from "../diffViewComputation";
import type { AgentDiffFile, AgentDiffSidesUnavailable, AgentDiffSource } from "./agentDiffSources";

export const MAX_EXPANDED_DIFF_FILES = 12;
export const INITIALLY_EXPANDED_DIFF_FILES = 3;
export const DIFF_TOO_LARGE_REASON = "This diff is too large to show here. Open it in the editor.";

const UNAVAILABLE_REASONS: Readonly<Record<AgentDiffSidesUnavailable, string>> = {
  binary: "Binary file. Open it in the editor to inspect it.",
  large: "This file is too large to show here. Open it in the editor.",
  missing: "This file no longer has changes. Refresh the diff.",
};

export type AgentDiffFileBody =
  | { readonly kind: "collapsed" }
  | { readonly kind: "loading" }
  | {
      readonly kind: "ready";
      readonly hunks: ReadonlyArray<DiffHunk>;
      readonly added: number;
      readonly deleted: number;
      readonly truncated: boolean;
      readonly hiddenLines: number;
    }
  | { readonly kind: "unavailable"; readonly reason: string };

export interface AgentDiffFileView {
  readonly file: AgentDiffFile;
  readonly body: AgentDiffFileBody;
}

export type AgentDiffListStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly truncated: boolean }
  | { readonly kind: "unavailable"; readonly reason: string }
  | { readonly kind: "failed"; readonly message: string };

export interface AgentDiffSurfaceState {
  readonly status: AgentDiffListStatus;
  readonly files: ReadonlyArray<AgentDiffFileView>;
  toggleFile(displayPath: string): void;
  revealFile(displayPath: string): void;
  collapseAll(): void;
  refresh(): void;
}

export interface UseAgentDiffSurfaceOptions {
  readonly source: AgentDiffSource | null;
  readonly computation: DiffViewComputationGateway;
  readonly ignoreWhitespace: boolean;
}

interface ListState {
  readonly key: string | null;
  readonly status: AgentDiffListStatus;
  readonly files: ReadonlyArray<AgentDiffFile>;
}

const IDLE_LIST: ListState = { key: null, status: { kind: "idle" }, files: [] };

export function useAgentDiffSurface({
  computation,
  ignoreWhitespace,
  source,
}: UseAgentDiffSurfaceOptions): AgentDiffSurfaceState {
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [list, setList] = useState<ListState>(IDLE_LIST);
  const [expanded, setExpanded] = useState<ReadonlyArray<string>>([]);
  const [bodies, setBodies] = useState<ReadonlyMap<string, AgentDiffFileBody>>(() => new Map());
  const generationRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const sourceRef = useLatest(source);
  const computationRef = useLatest(computation);
  const requestedRef = useRef(new Set<string>());
  const sourceKey = source?.key ?? null;

  useEffect(() => {
    generationRef.current += 1;
    const generation = generationRef.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    requestedRef.current = new Set();
    setBodies(new Map());
    const current = sourceRef.current;
    if (current === null || sourceKey === null) {
      setList(IDLE_LIST);
      setExpanded([]);
      return () => controller.abort();
    }
    setList({ key: sourceKey, status: { kind: "loading" }, files: [] });
    current.listFiles().then(
      (result) => {
        if (generationRef.current !== generation) return;
        if (result.unavailableReason !== null) {
          setList({ key: sourceKey, status: { kind: "unavailable", reason: result.unavailableReason }, files: [] });
          setExpanded([]);
          return;
        }
        setList({ key: sourceKey, status: { kind: "ready", truncated: result.truncated }, files: result.files });
        setExpanded(result.files.slice(0, INITIALLY_EXPANDED_DIFF_FILES).map((entry) => entry.displayPath));
      },
      (error: unknown) => {
        if (generationRef.current !== generation) return;
        setList({ key: sourceKey, status: { kind: "failed", message: errorMessage(error) }, files: [] });
      },
    );
    return () => controller.abort();
  }, [sourceKey, refreshNonce, sourceRef]);

  useEffect(() => {
    const current = sourceRef.current;
    const controller = controllerRef.current;
    if (current === null || controller === null || current.key !== list.key) return;
    const generation = generationRef.current;
    const byPath = new Map(list.files.map((entry) => [entry.displayPath, entry]));
    for (const displayPath of expanded) {
      const target = byPath.get(displayPath);
      const key = bodyKey(displayPath, ignoreWhitespace);
      if (target === undefined || requestedRef.current.has(key)) continue;
      requestedRef.current.add(key);
      void loadBody(current, computationRef.current, target, ignoreWhitespace, controller.signal).then((body) => {
        if (generationRef.current !== generation || controller.signal.aborted) return;
        setBodies((previous) => new Map(previous).set(key, body));
      });
    }
  }, [computationRef, expanded, ignoreWhitespace, list, sourceRef]);

  const toggleFile = useCallback((displayPath: string) => {
    setExpanded((current) =>
      current.includes(displayPath)
        ? current.filter((path) => path !== displayPath)
        : [...current, displayPath].slice(-MAX_EXPANDED_DIFF_FILES),
    );
  }, []);
  const revealFile = useCallback((displayPath: string) => {
    setExpanded((current) =>
      current.includes(displayPath) ? current : [...current, displayPath].slice(-MAX_EXPANDED_DIFF_FILES),
    );
  }, []);
  const collapseAll = useCallback(() => setExpanded([]), []);
  const refresh = useCallback(() => setRefreshNonce((value) => value + 1), []);

  const files = useMemo(
    () =>
      list.files.map((entry): AgentDiffFileView => {
        if (!expanded.includes(entry.displayPath)) return { file: entry, body: { kind: "collapsed" } };
        return {
          file: entry,
          body: bodies.get(bodyKey(entry.displayPath, ignoreWhitespace)) ?? { kind: "loading" },
        };
      }),
    [bodies, expanded, ignoreWhitespace, list.files],
  );

  return { status: list.status, files, toggleFile, revealFile, collapseAll, refresh };
}

async function loadBody(
  source: AgentDiffSource,
  computation: DiffViewComputationGateway,
  file: AgentDiffFile,
  ignoreWhitespace: boolean,
  signal: AbortSignal,
): Promise<AgentDiffFileBody> {
  try {
    const sides = await source.readSides(file);
    if (sides.unavailableReason !== null) {
      return { kind: "unavailable", reason: UNAVAILABLE_REASONS[sides.unavailableReason] };
    }
    const result = await computation.compute(
      { original: sides.original, modified: sides.modified, ignoreWhitespace },
      signal,
    );
    if (result.kind === "tooLarge") return { kind: "unavailable", reason: DIFF_TOO_LARGE_REASON };
    const limited = limitDiffHunks(groupDiffHunks(result.lines), MAX_RENDERED_DIFF_LINES_PER_FILE);
    return {
      kind: "ready",
      hunks: limited.hunks,
      added: result.added,
      deleted: result.deleted,
      truncated: sides.truncated,
      hiddenLines: limited.hiddenLines,
    };
  } catch (error) {
    return { kind: "unavailable", reason: errorMessage(error) };
  }
}

function bodyKey(displayPath: string, ignoreWhitespace: boolean): string {
  return JSON.stringify([displayPath, ignoreWhitespace]);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  return "The diff could not be loaded.";
}
```

The two effects use refs for the source and the computation gateway. Their dependency arrays list every reactive value they read, so `npm run lint:exhaustive-deps` stays within budget. If the budget script flags a new entry, fix the dependency list; never raise the budget.

- [ ] **Step 7: Run the Task 5 suites**

Run: `npx vitest run src/domain/diffView src/application/rightPanel && npm run check && npm run lint:exhaustive-deps`
Expected: PASS, and both commands exit 0.

- [ ] **Step 8: Hand off (no commit)**

---
### Task 6: Diff surface UI, scope selection and B4 layout

**Files:**
- Create: `src/components/agentMode/useAgentDiffScopeSelection.ts`, `src/components/agentMode/rightPanel/diff/useAgentDiffSurfaceSource.ts`, `src/components/agentMode/rightPanel/diff/AgentDiffSurfaceContainer.tsx`, `src/components/agentMode/rightPanel/diff/AgentDiffSurface.tsx`, `src/components/agentMode/rightPanel/diff/AgentDiffToolbar.tsx`, `src/components/agentMode/rightPanel/diff/AgentDiffScopeMenu.tsx`, `src/components/agentMode/rightPanel/diff/AgentDiffFileSection.tsx`, `src/components/agentMode/rightPanel/diff/AgentDiffHunks.tsx`, `src/components/agentMode/rightPanel/diff/AgentDiffFileTree.tsx`, `src/components/agentMode/rightPanel/diff/agentDiff.css`
- Modify (integration, applied by the lead in order):
  - `src/components/agentMode/AgentModeView.tsx`: replace the recorded-diff block with `useAgentDiffScopeSelection`, pass `diffScope` / `onDiffScopeChange` to `AgentSurfaceHost`, and pass `activeDiffTurnId` to `AgentThreadSession` when P3's prop exists;
  - `src/components/agentMode/rightPanel/AgentRightPanelSurfaceBody.tsx`: the `diff` case renders `<AgentDiffSurfaceContainer />`;
  - `src/components/agentMode/AgentSurfacePanel.tsx`: delete `legacyDiffBody`, `projectDiff` and the lazy project / recorded diff constants;
  - `src/components/agentMode/AgentSurfaceHost.tsx`: delete `recordedDiff`, `onCloseRecordedDiff` and `projectDiff`; widen `AgentSurfaceHostAgents`;
  - `src/components/agentMode/AgentSurfaceDiff.tsx`: remove the `recorded` branch; keep it only as the remote working-tree body;
  - `src/components/agentMode/AgentWorkbenchScreen.tsx` and `agentWorkbenchChrome.ts`: delete `projectDiff`.
- Delete: `AgentSurfaceProjectDiff.tsx`, `agentSurfaceProjectDiff.css`, `useAgentProjectDiffChrome.ts` (+ test), `AgentRecordedTurnDiff.tsx` (+ test), `AgentTurnChangesCard.tsx` (+ test), `agentTurnChangesCard.css`, `agentRecordedTurnChanges.css`, `AgentThreadChangesCue.tsx`. `AgentSurfaceDiff.tsx` and `AgentThreadChanges.tsx` stay: they are the remote-thread working-tree view (capability kept), and P10 retires them together with the remote change summary.
- Test: `src/components/agentMode/useAgentDiffScopeSelection.test.tsx`, `src/components/agentMode/rightPanel/diff/AgentDiffSurface.test.tsx`, `src/components/agentMode/rightPanel/diff/agentDiffStyles.test.ts`, `src/components/agentMode/AgentSurfaceDiff.test.tsx` (drop the recorded cases, keep the working-tree cases)

**Interfaces:**
- Consumes:
  - Task 5: `AgentDiffScope`, sources, `useAgentDiffSurface`, `agentDiffScopeLabel`, `agentDiffTurnOptions`, `resolveAgentDiffScope`, `agentDiffScopeActiveTurnId`, `agentDiffRevisionKey`.
  - Task 4: `splitDiffRows`, `DiffHunk`.
  - Task 7:
    - `useAgentRightPanelContext(): AgentRightPanelContextValue`, which provides `thread`, `scope`, `target`, `checkoutRoot`, `chrome`, `gitStatus`, `agents`, `diffScope`, `onDiffScopeChange`, `legacyWorkingTreeDiff`, `openFile(path)`;
    - `branchDiffSource`;
    - `gitSurfaceStatusValue(load)`.
  - Existing: `buildAgentTurnDiffTree`, foundation `IconButton`, `SegmentedControl`, `Menu`, `MenuItem`, `MenuSeparator`, `TreeRow`, `Spinner`.
- Produces:
  - `useAgentDiffScopeSelection(options: { threadId: string | null; turns: ReadonlyArray<AgentDiffTurn>; diffActive: boolean; openDiff(): void }): AgentDiffScopeSelection`, returning `{ scope; activeDiffTurnId: string | null; setScope(scope); openTurnDiff(threadId, summary: AgentTurnChangeSummary, relativePath?: string); reviewWorkingTree(threadId); resetScope() }`
  - `interface AgentDiffScopeChoices { turns: ReadonlyArray<AgentDiffTurnOption>; workingTree: boolean; branch: { head: string; bases: ReadonlyArray<string>; defaultBase: string } | null }`
  - `AgentDiffSurface(props: AgentDiffSurfaceProps)`, `AgentDiffSurfaceContainer()`

- [ ] **Step 1: Write the failing scope-selection test**

Create `src/components/agentMode/useAgentDiffScopeSelection.test.tsx`:

```tsx
// @vitest-environment jsdom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountUi, type MountedUi } from "../../ui/foundation/foundationTestSupport";
import { useAgentDiffScopeSelection, type AgentDiffScopeSelection } from "./useAgentDiffScopeSelection";

let ui: MountedUi | null = null;
afterEach(() => {
  ui?.unmount();
  ui = null;
});

const TURNS = [
  { turnId: "t1", endedAtEpochMs: 1 },
  { turnId: "t2", endedAtEpochMs: 2 },
];

function render(props: { threadId: string | null; diffActive: boolean; openDiff?: () => void }) {
  const box: { current: AgentDiffScopeSelection | null } = { current: null };
  function Probe(value: { threadId: string | null; diffActive: boolean }) {
    box.current = useAgentDiffScopeSelection({
      threadId: value.threadId,
      turns: TURNS,
      diffActive: value.diffActive,
      openDiff: props.openDiff ?? (() => undefined),
    });
    return null;
  }
  ui = ui ?? mountUi();
  ui.render(<Probe diffActive={props.diffActive} threadId={props.threadId} />);
  return box;
}

describe("useAgentDiffScopeSelection", () => {
  it("defaults to the latest turn for a thread and the working tree for a project", () => {
    expect(render({ threadId: "a", diffActive: true }).current?.scope).toEqual({ kind: "latestTurn" });
    expect(render({ threadId: null, diffActive: true }).current?.scope).toEqual({ kind: "workingTree" });
  });

  it("opens a recorded turn and reports it as the active diff turn", () => {
    const openDiff = vi.fn();
    const box = render({ threadId: "a", diffActive: true, openDiff });
    act(() =>
      box.current?.openTurnDiff("a", { turnId: "t1", state: "ready", files: [], truncated: false, reason: null }),
    );
    expect(box.current?.scope).toEqual({ kind: "turn", turnId: "t1" });
    expect(box.current?.activeDiffTurnId).toBe("t1");
    expect(openDiff).toHaveBeenCalledOnce();
  });

  it("ignores requests for another thread and forgets the scope on thread switch", () => {
    const box = render({ threadId: "a", diffActive: true });
    act(() =>
      box.current?.openTurnDiff("b", { turnId: "t1", state: "ready", files: [], truncated: false, reason: null }),
    );
    expect(box.current?.scope).toEqual({ kind: "latestTurn" });
    act(() => box.current?.setScope({ kind: "workingTree" }));
    render({ threadId: "b", diffActive: true });
    expect(box.current?.scope).toEqual({ kind: "latestTurn" });
  });

  it("reports no active turn while the diff surface is hidden", () => {
    expect(render({ threadId: "a", diffActive: false }).current?.activeDiffTurnId).toBeNull();
  });
});
```

- [ ] **Step 2: Implement the hook**

Create `src/components/agentMode/useAgentDiffScopeSelection.ts`:

```ts
import { useCallback, useState } from "react";
import type { AgentTurnChangeSummary } from "../../domain/agentTurnChanges";
import {
  DEFAULT_PROJECT_DIFF_SCOPE,
  DEFAULT_THREAD_DIFF_SCOPE,
  agentDiffScopeActiveTurnId,
  type AgentDiffScope,
  type AgentDiffTurn,
} from "../../domain/diffView/agentDiffScope";

export interface AgentDiffScopeSelectionOptions {
  readonly threadId: string | null;
  readonly turns: ReadonlyArray<AgentDiffTurn>;
  readonly diffActive: boolean;
  openDiff(): void;
}

export interface AgentDiffScopeSelection {
  readonly scope: AgentDiffScope;
  readonly activeDiffTurnId: string | null;
  setScope(scope: AgentDiffScope): void;
  openTurnDiff(threadId: string, summary: AgentTurnChangeSummary, relativePath?: string): void;
  reviewWorkingTree(threadId: string): void;
  resetScope(): void;
}

interface ScopedSelection {
  readonly threadId: string | null;
  readonly scope: AgentDiffScope;
}

export function useAgentDiffScopeSelection({
  diffActive,
  openDiff,
  threadId,
  turns,
}: AgentDiffScopeSelectionOptions): AgentDiffScopeSelection {
  const [selection, setSelection] = useState<ScopedSelection | null>(null);
  const fallback = threadId === null ? DEFAULT_PROJECT_DIFF_SCOPE : DEFAULT_THREAD_DIFF_SCOPE;
  const scope = selection !== null && selection.threadId === threadId ? selection.scope : fallback;
  const setScope = useCallback(
    (next: AgentDiffScope) => setSelection({ threadId, scope: next }),
    [threadId],
  );
  const openTurnDiff = useCallback(
    (requestThreadId: string, summary: AgentTurnChangeSummary) => {
      if (requestThreadId !== threadId) return;
      setSelection({ threadId, scope: { kind: "turn", turnId: summary.turnId } });
      openDiff();
    },
    [openDiff, threadId],
  );
  const reviewWorkingTree = useCallback(
    (requestThreadId: string) => {
      if (requestThreadId !== threadId) return;
      setSelection({ threadId, scope: { kind: "workingTree" } });
      openDiff();
    },
    [openDiff, threadId],
  );
  const resetScope = useCallback(() => setSelection(null), []);
  return {
    scope,
    activeDiffTurnId: diffActive ? agentDiffScopeActiveTurnId(scope, turns) : null,
    setScope,
    openTurnDiff,
    reviewWorkingTree,
    resetScope,
  };
}
```

Run: `npx vitest run src/components/agentMode/useAgentDiffScopeSelection.test.tsx`
Expected: PASS.

- [ ] **Step 3: Write the failing surface test (including B4)**

Create `src/components/agentMode/rightPanel/diff/AgentDiffSurface.test.tsx`:

```tsx
// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { inlineDiffViewGateway } from "../../../../infrastructure/inlineDiffViewGateway";
import { waitForReact } from "../../../../test/reactTestLifecycle";
import { click, mountUi, type MountedUi } from "../../../../ui/foundation/foundationTestSupport";
import type { AgentDiffFile, AgentDiffSource } from "../../../../application/rightPanel/agentDiffSources";
import { AgentDiffSurface, type AgentDiffSurfaceProps } from "./AgentDiffSurface";

let ui: MountedUi | null = null;
afterEach(() => {
  ui?.unmount();
  ui = null;
});

const LONG_LINE = `const reallyLongIdentifier = "${"x".repeat(600)}";`;

function file(displayPath: string, added = 1, deleted = 1): AgentDiffFile {
  return { repositoryRoot: "/repo", relativePath: displayPath, displayPath, oldRelativePath: null, status: "modified", added, deleted };
}

const source: AgentDiffSource = {
  key: "turn-2",
  listFiles: async () => ({
    files: [file("src/routes/orders.ts", 4, 1), file("src/middleware/very/deep/path/idempotency.ts", 29, 0)],
    truncated: false,
    unavailableReason: null,
  }),
  readSides: async () => ({ original: "a\nb\n", modified: `a\n${LONG_LINE}\n`, truncated: false, unavailableReason: null }),
};

function props(overrides: Partial<AgentDiffSurfaceProps> = {}): AgentDiffSurfaceProps {
  return {
    scope: { kind: "latestTurn" },
    scopeLabel: "Latest turn",
    choices: {
      turns: [
        { turnId: "t2", label: "Turn 2", endedAtEpochMs: 2 },
        { turnId: "t1", label: "Turn 1", endedAtEpochMs: 1 },
      ],
      workingTree: true,
      branch: { head: "feat/idempotency-keys", bases: ["main", "develop"], defaultBase: "main" },
    },
    source,
    computation: inlineDiffViewGateway,
    emptyReason: null,
    replacementBody: null,
    onScopeChange: vi.fn(),
    onOpenFile: vi.fn(),
    onRefresh: vi.fn(),
    ...overrides,
  };
}

function mount(value: AgentDiffSurfaceProps): HTMLElement {
  ui = mountUi();
  ui.render(<AgentDiffSurface {...value} />);
  return ui.host;
}

describe("AgentDiffSurface", () => {
  it("renders file rows with totals and full paths available", async () => {
    const host = mount(props());
    await waitForReact(() => expect(host.querySelectorAll(".cv-diff-file__row")).toHaveLength(2));
    const rows = [...host.querySelectorAll<HTMLElement>(".cv-diff-file__row")];

    expect(rows[1]?.title).toBe("src/middleware/very/deep/path/idempotency.ts");
    expect(rows[1]?.querySelector(".cv-diff-file__name")?.textContent).toBe("idempotency.ts");
    expect(host.querySelector(".cv-diff-toolbar .cv-rp-stat")?.textContent).toBe("+33−1");
  });

  it("never truncates code text and switches between scroll and wrap (B4)", async () => {
    const host = mount(props());
    await waitForReact(() => expect(host.querySelector(".cv-diff-code--add")).not.toBeNull());
    const code = [...host.querySelectorAll(".cv-diff-code")].map((node) => node.textContent);

    expect(code).toContain(LONG_LINE);
    expect(host.querySelector(".cv-diff")?.getAttribute("data-wrap")).toBe("false");
    click(host.querySelector('[aria-label="Enable diff line wrapping"]') as Element);
    expect(host.querySelector(".cv-diff")?.getAttribute("data-wrap")).toBe("true");
  });

  it("renders a split grid with both sides in split layout", async () => {
    const host = mount(props());
    await waitForReact(() => expect(host.querySelector(".cv-diff-grid--unified")).not.toBeNull());
    click(host.querySelector('[aria-label="Split diff view"]') as Element);
    await waitForReact(() => expect(host.querySelector(".cv-diff-grid--split")).not.toBeNull());
    expect(host.querySelectorAll(".cv-diff-grid--split .cv-diff-code--del").length).toBeGreaterThan(0);
  });

  it("changes scope from the scope menu", async () => {
    const value = props();
    const host = mount(value);
    click(host.querySelector('[aria-label="Diff scope: Latest turn"]') as Element);
    const items = [...document.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]')];
    expect(items.map((item) => item.textContent?.replace(/\d{1,2}:\d{2}.*$/, "").trim())).toEqual([
      "Working tree",
      "Branch changes",
      "Latest turn",
      "Turn 2",
      "Turn 1",
    ]);
    click(items[1] as Element);
    expect(value.onScopeChange).toHaveBeenCalledWith({ kind: "branch", baseRef: "main" });
  });

  it("shows the file tree and reveals a file from it", async () => {
    const host = mount(props());
    await waitForReact(() => expect(host.querySelectorAll(".cv-diff-file__row")).toHaveLength(2));
    click(host.querySelector('[aria-label="Show file tree"]') as Element);
    expect(host.querySelector('[aria-label="Changed files"]')).not.toBeNull();
  });

  it("shows the empty reason when there is no source", () => {
    const host = mount(props({ source: null, emptyReason: "This thread has no finished turns yet." }));
    expect(host.textContent).toContain("This thread has no finished turns yet.");
  });
});
```

The `−` in `"+33−1"` is U+2212, the same minus sign the mockup uses. `DiffStat` renders `−` with a Unicode escape in source (`"−"`) to avoid ambiguous characters.

- [ ] **Step 4: Implement the components**

Create `src/components/agentMode/rightPanel/diff/AgentDiffHunks.tsx`:

```tsx
import { Fragment } from "react";
import { splitDiffRows, type DiffHunk, type SplitDiffCell } from "../../../../domain/diffView/diffHunks";
import type { DiffLineKind } from "../../../../domain/diffView/lineDiff";

export type AgentDiffLayout = "unified" | "split";

export interface AgentDiffHunksProps {
  readonly label: string;
  readonly hunks: ReadonlyArray<DiffHunk>;
  readonly layout: AgentDiffLayout;
}

export function AgentDiffHunks({ hunks, label, layout }: AgentDiffHunksProps) {
  return (
    <div aria-label={label} className="cv-diff-hunk" role="group">
      {hunks.map((hunk, index) =>
        layout === "split" ? <SplitHunk hunk={hunk} key={index} /> : <UnifiedHunk hunk={hunk} key={index} />,
      )}
    </div>
  );
}

function UnifiedHunk({ hunk }: { readonly hunk: DiffHunk }) {
  return (
    <div className="cv-diff-grid cv-diff-grid--unified">
      <span className="cv-diff-cell cv-diff-cell--head">{hunk.header}</span>
      {hunk.lines.map((line, index) => (
        <Fragment key={index}>
          <span className={cellClass("cv-diff-ln", line.kind)}>{line.oldLine ?? ""}</span>
          <span className={cellClass("cv-diff-ln", line.kind)}>{line.newLine ?? ""}</span>
          <span className={cellClass("cv-diff-sign", line.kind)}>{sign(line.kind)}</span>
          <span className={cellClass("cv-diff-code", line.kind)}>{line.text.length === 0 ? " " : line.text}</span>
        </Fragment>
      ))}
    </div>
  );
}

function SplitHunk({ hunk }: { readonly hunk: DiffHunk }) {
  return (
    <div className="cv-diff-grid cv-diff-grid--split">
      <span className="cv-diff-cell cv-diff-cell--head">{hunk.header}</span>
      {splitDiffRows(hunk).map((row, index) => (
        <Fragment key={index}>
          <SplitSide cell={row.left} start={false} />
          <SplitSide cell={row.right} start />
        </Fragment>
      ))}
    </div>
  );
}

function SplitSide({ cell, start }: { readonly cell: SplitDiffCell | null; readonly start: boolean }) {
  const edge = start ? " cv-diff-cell--split-start" : "";
  if (cell === null) {
    return (
      <>
        <span className={`cv-diff-cell cv-diff-ln cv-diff-cell--empty${edge}`} />
        <span className="cv-diff-cell cv-diff-sign cv-diff-cell--empty" />
        <span className="cv-diff-cell cv-diff-code cv-diff-cell--empty" />
      </>
    );
  }
  return (
    <>
      <span className={`${cellClass("cv-diff-ln", cell.kind)}${edge}`}>{cell.line}</span>
      <span className={cellClass("cv-diff-sign", cell.kind)}>{sign(cell.kind)}</span>
      <span className={cellClass("cv-diff-code", cell.kind)}>{cell.text.length === 0 ? " " : cell.text}</span>
    </>
  );
}

function cellClass(role: string, kind: DiffLineKind): string {
  return `cv-diff-cell ${role} ${role}--${kind} cv-diff-cell--${kind}`;
}

function sign(kind: DiffLineKind): string {
  switch (kind) {
    case "add":
      return "+";
    case "del":
      return "−";
    case "context":
      return "";
  }
}
```

Create `src/components/agentMode/rightPanel/diff/AgentDiffFileSection.tsx`:

```tsx
import { ChevronRight, ExternalLink, FileDiff, FilePlus, FileMinus } from "lucide-react";
import type { AgentDiffFile } from "../../../../application/rightPanel/agentDiffSources";
import type { AgentDiffFileView } from "../../../../application/rightPanel/useAgentDiffSurface";
import { IconButton } from "../../../../ui/foundation/IconButton";
import { Spinner } from "../../../../ui/foundation/Spinner";
import { AgentDiffHunks, type AgentDiffLayout } from "./AgentDiffHunks";

export interface AgentDiffFileSectionProps {
  readonly view: AgentDiffFileView;
  readonly layout: AgentDiffLayout;
  onToggle(): void;
  onOpen(file: AgentDiffFile): void;
  sectionRef(node: HTMLDivElement | null): void;
}

export function AgentDiffFileSection({ layout, onOpen, onToggle, sectionRef, view }: AgentDiffFileSectionProps) {
  const { body, file } = view;
  const expanded = body.kind !== "collapsed";
  const { directory, name } = splitDisplayPath(file.displayPath);
  return (
    <div className="cv-diff-file" ref={sectionRef}>
      <div className="cv-diff-file__head">
        <button
          aria-expanded={expanded}
          className="cv-diff-file__row"
          onClick={onToggle}
          title={file.displayPath}
          type="button"
        >
          <ChevronRight aria-hidden="true" className="cv-diff-file__chev" size={12} />
          <StatusGlyph status={file.status} />
          <span className="cv-diff-file__path">
            {directory.length > 0 && (
              <span className="cv-diff-file__dir">
                <bdi dir="ltr">{directory}</bdi>
              </span>
            )}
            <span className="cv-diff-file__name">{name}</span>
          </span>
          <DiffStat added={file.added} deleted={file.deleted} />
        </button>
        <IconButton icon={<ExternalLink size={14} />} label={`Open ${name} in editor`} onClick={() => onOpen(file)} size="xs" />
      </div>
      {body.kind === "loading" && (
        <p className="cv-diff-file__note">
          <Spinner label="Loading diff" />
        </p>
      )}
      {body.kind === "unavailable" && <p className="cv-diff-file__note">{body.reason}</p>}
      {body.kind === "ready" && (
        <>
          <AgentDiffHunks hunks={body.hunks} label={`${file.displayPath} diff`} layout={layout} />
          {body.truncated && (
            <p className="cv-diff-file__note">Showing the first 128 KB of this file. Open it in the editor for the rest.</p>
          )}
          {body.hiddenLines > 0 && (
            <p className="cv-diff-file__note">
              {body.hiddenLines} more changed lines are not shown here. Open the diff in the editor.
            </p>
          )}
        </>
      )}
    </div>
  );
}

export function DiffStat({ added, deleted }: { readonly added: number | null; readonly deleted: number | null }) {
  if (added === null && deleted === null) return null;
  return (
    <span className="cv-rp-stat">
      <span className="cv-rp-stat__add">+{added ?? 0}</span>
      <span className="cv-rp-stat__del">{"−"}{deleted ?? 0}</span>
    </span>
  );
}

function StatusGlyph({ status }: { readonly status: AgentDiffFile["status"] }) {
  if (status === "added" || status === "untracked") {
    return <FilePlus aria-label="Added" className="cv-diff-file__glyph cv-diff-file__glyph--added" size={14} />;
  }
  if (status === "deleted") {
    return <FileMinus aria-label="Deleted" className="cv-diff-file__glyph cv-diff-file__glyph--deleted" size={14} />;
  }
  return <FileDiff aria-label="Modified" className="cv-diff-file__glyph" size={14} />;
}

function splitDisplayPath(path: string): { readonly directory: string; readonly name: string } {
  const slash = path.lastIndexOf("/");
  if (slash < 0) return { directory: "", name: path };
  return { directory: path.slice(0, slash + 1), name: path.slice(slash + 1) };
}
```

Create `src/components/agentMode/rightPanel/diff/AgentDiffScopeMenu.tsx`:

```tsx
import type { RefObject } from "react";
import type { AgentDiffScope, AgentDiffTurnOption } from "../../../../domain/diffView/agentDiffScope";
import { agentDiffScopesEqual } from "../../../../domain/diffView/agentDiffScope";
import { Menu } from "../../../../ui/foundation/Menu";
import { MenuItem, MenuSeparator } from "../../../../ui/foundation/MenuItem";
import type { AgentDiffScopeChoices } from "./AgentDiffSurface";

export interface AgentDiffScopeMenuProps {
  readonly open: boolean;
  readonly anchorRef: RefObject<HTMLElement | null>;
  readonly scope: AgentDiffScope;
  readonly choices: AgentDiffScopeChoices;
  onSelect(scope: AgentDiffScope): void;
  onClose(): void;
}

export function AgentDiffScopeMenu({ anchorRef, choices, onClose, onSelect, open, scope }: AgentDiffScopeMenuProps) {
  const pick = (next: AgentDiffScope) => {
    onClose();
    onSelect(next);
  };
  const branch = choices.branch;
  return (
    <Menu anchorRef={anchorRef} label="Diff scope" onClose={onClose} open={open}>
      {choices.workingTree && (
        <MenuItem checked={scope.kind === "workingTree"} onSelect={() => pick({ kind: "workingTree" })}>
          Working tree
        </MenuItem>
      )}
      {branch !== null && (
        <MenuItem checked={scope.kind === "branch"} onSelect={() => pick({ kind: "branch", baseRef: branch.defaultBase })}>
          Branch changes
        </MenuItem>
      )}
      {choices.turns.length > 0 && (
        <MenuItem checked={scope.kind === "latestTurn"} onSelect={() => pick({ kind: "latestTurn" })}>
          Latest turn
        </MenuItem>
      )}
      {choices.turns.length > 0 && <MenuSeparator />}
      {choices.turns.map((turn) => (
        <MenuItem
          checked={agentDiffScopesEqual(scope, { kind: "turn", turnId: turn.turnId })}
          key={turn.turnId}
          onSelect={() => pick({ kind: "turn", turnId: turn.turnId })}
          shortcut={turnTime(turn)}
        >
          {turn.label}
        </MenuItem>
      ))}
    </Menu>
  );
}

function turnTime(turn: AgentDiffTurnOption): string {
  return new Date(turn.endedAtEpochMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
```

Create `src/components/agentMode/rightPanel/diff/AgentDiffToolbar.tsx`:

```tsx
import { ChevronDown, ChevronsDownUp, Columns2, FolderTree, Pilcrow, RefreshCw, Rows3, WrapText, ArrowRight } from "lucide-react";
import { useRef, useState } from "react";
import type { AgentDiffScope } from "../../../../domain/diffView/agentDiffScope";
import { IconButton } from "../../../../ui/foundation/IconButton";
import { Menu } from "../../../../ui/foundation/Menu";
import { MenuItem } from "../../../../ui/foundation/MenuItem";
import { SegmentedControl } from "../../../../ui/foundation/SegmentedControl";
import type { AgentDiffLayout } from "./AgentDiffHunks";
import { DiffStat } from "./AgentDiffFileSection";
import { AgentDiffScopeMenu } from "./AgentDiffScopeMenu";
import type { AgentDiffScopeChoices } from "./AgentDiffSurface";

export interface AgentDiffToolbarProps {
  readonly scope: AgentDiffScope;
  readonly scopeLabel: string;
  readonly choices: AgentDiffScopeChoices;
  readonly added: number | null;
  readonly deleted: number | null;
  readonly layout: AgentDiffLayout;
  readonly wrap: boolean;
  readonly ignoreWhitespace: boolean;
  readonly treeVisible: boolean;
  onScopeChange(scope: AgentDiffScope): void;
  onRefresh(): void;
  onCollapseAll(): void;
  onLayoutChange(layout: AgentDiffLayout): void;
  onWrapChange(wrap: boolean): void;
  onIgnoreWhitespaceChange(ignore: boolean): void;
  onTreeVisibleChange(visible: boolean): void;
}

export function AgentDiffToolbar(props: AgentDiffToolbarProps) {
  const scopeRef = useRef<HTMLButtonElement | null>(null);
  const baseRef = useRef<HTMLButtonElement | null>(null);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [baseOpen, setBaseOpen] = useState(false);
  const branch = props.choices.branch;
  const scope = props.scope;
  return (
    <div className="cv-rp-sub cv-diff-toolbar">
      <div className="cv-rp-sub__grow">
        <button
          aria-expanded={scopeOpen}
          aria-haspopup="menu"
          aria-label={`Diff scope: ${props.scopeLabel}`}
          className="cv-rp-ctl"
          onClick={() => setScopeOpen((open) => !open)}
          ref={scopeRef}
          type="button"
        >
          {props.scopeLabel}
          <ChevronDown aria-hidden="true" size={12} />
        </button>
        {scope.kind === "branch" && branch !== null && (
          <span className="cv-diff-compare" title={`Comparing ${branch.head} against ${scope.baseRef}`}>
            <span className="cv-diff-compare__head">{branch.head}</span>
            <ArrowRight aria-hidden="true" size={12} />
            <button
              aria-haspopup="menu"
              aria-label={`Base branch: ${scope.baseRef}`}
              className="cv-rp-ctl cv-rp-ctl--quiet"
              onClick={() => setBaseOpen((open) => !open)}
              ref={baseRef}
              type="button"
            >
              {scope.baseRef}
              <ChevronDown aria-hidden="true" size={12} />
            </button>
          </span>
        )}
      </div>
      <div className="cv-rp-sub__tools">
        <DiffStat added={props.added} deleted={props.deleted} />
        <IconButton icon={<RefreshCw size={14} />} label="Refresh diff" onClick={props.onRefresh} size="xs" />
        <IconButton icon={<ChevronsDownUp size={14} />} label="Collapse all files" onClick={props.onCollapseAll} size="xs" />
        <SegmentedControl
          iconOnly
          label="Diff layout"
          onChange={props.onLayoutChange}
          options={[
            { value: "unified", label: "Stacked diff view", icon: <Rows3 size={14} /> },
            { value: "split", label: "Split diff view", icon: <Columns2 size={14} /> },
          ]}
          value={props.layout}
        />
        <IconButton
          icon={<WrapText size={14} />}
          label={props.wrap ? "Disable diff line wrapping" : "Enable diff line wrapping"}
          onClick={() => props.onWrapChange(!props.wrap)}
          pressed={props.wrap}
          size="xs"
        />
        <IconButton
          icon={<Pilcrow size={14} />}
          label={props.ignoreWhitespace ? "Show whitespace changes" : "Hide whitespace changes"}
          onClick={() => props.onIgnoreWhitespaceChange(!props.ignoreWhitespace)}
          pressed={props.ignoreWhitespace}
          size="xs"
        />
        <IconButton
          icon={<FolderTree size={14} />}
          label={props.treeVisible ? "Hide file tree" : "Show file tree"}
          onClick={() => props.onTreeVisibleChange(!props.treeVisible)}
          pressed={props.treeVisible}
          size="xs"
        />
      </div>
      <AgentDiffScopeMenu
        anchorRef={scopeRef}
        choices={props.choices}
        onClose={() => setScopeOpen(false)}
        onSelect={props.onScopeChange}
        open={scopeOpen}
        scope={scope}
      />
      {branch !== null && scope.kind === "branch" && (
        <Menu anchorRef={baseRef} label="Base branch" onClose={() => setBaseOpen(false)} open={baseOpen}>
          {branch.bases.map((base) => (
            <MenuItem
              checked={base === scope.baseRef}
              key={base}
              onSelect={() => {
                setBaseOpen(false);
                props.onScopeChange({ kind: "branch", baseRef: base });
              }}
            >
              {base}
            </MenuItem>
          ))}
        </Menu>
      )}
    </div>
  );
}
```

If `SegmentedControl` renders its options with `aria-label` = the option `label` (icon-only mode), the test selector `[aria-label="Split diff view"]` matches. If it uses `title` instead, change the test selector to `[title="Split diff view"]`.

Create `src/components/agentMode/rightPanel/diff/AgentDiffFileTree.tsx`:

```tsx
import { File, Folder } from "lucide-react";
import type { AgentDiffFile } from "../../../../application/rightPanel/agentDiffSources";
import { buildAgentTurnDiffTree, type TurnDiffTreeNode } from "../../../../domain/agentTurnDiffTree";
import { TreeRow } from "../../../../ui/foundation/TreeRow";
import { DiffStat } from "./AgentDiffFileSection";

export interface AgentDiffFileTreeProps {
  readonly files: ReadonlyArray<AgentDiffFile>;
  readonly currentPath: string | null;
  onSelect(displayPath: string): void;
}

export function AgentDiffFileTree({ currentPath, files, onSelect }: AgentDiffFileTreeProps) {
  const tree = buildAgentTurnDiffTree(
    files.map((file) => ({
      relativePath: file.displayPath,
      oldRelativePath: file.oldRelativePath,
      status: file.status,
      addedLines: file.added,
      deletedLines: file.deleted,
    })),
  );
  return (
    <nav aria-label="Changed files" className="cv-diff-tree">
      {flatten(tree.nodes, 0).map(({ depth, node }) => (
        <TreeRow
          current={node.kind === "file" && node.path === currentPath}
          depth={depth}
          expanded={node.kind === "directory" ? true : undefined}
          icon={node.kind === "directory" ? <Folder size={14} /> : <File size={14} />}
          key={node.path}
          label={node.name}
          onActivate={() => {
            if (node.kind === "file") onSelect(node.path);
          }}
          trailing={
            node.kind === "file" ? <DiffStat added={node.stats.addedLines} deleted={node.stats.deletedLines} /> : undefined
          }
        />
      ))}
    </nav>
  );
}

function flatten(
  nodes: ReadonlyArray<TurnDiffTreeNode>,
  depth: number,
): ReadonlyArray<{ readonly depth: number; readonly node: TurnDiffTreeNode }> {
  return nodes.flatMap((node) =>
    node.kind === "directory"
      ? [{ depth, node }, ...flatten(node.children, depth + 1)]
      : [{ depth, node }],
  );
}
```

If `buildAgentTurnDiffTree` requires more `AgentTurnChangedFile` fields, map them from `AgentDiffFile` explicitly (no casts).

Create `src/components/agentMode/rightPanel/diff/AgentDiffSurface.tsx`:

```tsx
import { useRef, useState, type ReactNode } from "react";
import type { DiffViewComputationGateway } from "../../../../application/diffViewComputation";
import type { AgentDiffFile, AgentDiffSource } from "../../../../application/rightPanel/agentDiffSources";
import { useAgentDiffSurface, type AgentDiffFileView } from "../../../../application/rightPanel/useAgentDiffSurface";
import type { AgentDiffScope, AgentDiffTurnOption } from "../../../../domain/diffView/agentDiffScope";
import { AgentDiffFileSection } from "./AgentDiffFileSection";
import { AgentDiffFileTree } from "./AgentDiffFileTree";
import type { AgentDiffLayout } from "./AgentDiffHunks";
import { AgentDiffToolbar } from "./AgentDiffToolbar";
import "./agentDiff.css";

export interface AgentDiffScopeChoices {
  readonly turns: ReadonlyArray<AgentDiffTurnOption>;
  readonly workingTree: boolean;
  readonly branch: {
    readonly head: string;
    readonly bases: ReadonlyArray<string>;
    readonly defaultBase: string;
  } | null;
}

export interface AgentDiffSurfaceProps {
  readonly scope: AgentDiffScope;
  readonly scopeLabel: string;
  readonly choices: AgentDiffScopeChoices;
  readonly source: AgentDiffSource | null;
  readonly computation: DiffViewComputationGateway;
  readonly emptyReason: string | null;
  readonly replacementBody: ReactNode;
  onScopeChange(scope: AgentDiffScope): void;
  onOpenFile(file: AgentDiffFile): void;
  onRefresh(): void;
}

export function AgentDiffSurface(props: AgentDiffSurfaceProps) {
  const [layout, setLayout] = useState<AgentDiffLayout>("unified");
  const [wrap, setWrap] = useState(false);
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(false);
  const [treeVisible, setTreeVisible] = useState(false);
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const sections = useRef(new Map<string, HTMLDivElement>());
  const diff = useAgentDiffSurface({ source: props.source, computation: props.computation, ignoreWhitespace });
  const totals = diffTotals(diff.files);

  const reveal = (displayPath: string) => {
    setCurrentPath(displayPath);
    diff.revealFile(displayPath);
    sections.current.get(displayPath)?.scrollIntoView({ block: "start" });
  };

  return (
    <section aria-label="Diff" className="cv-diff" data-layout={layout} data-wrap={wrap}>
      <AgentDiffToolbar
        added={totals.added}
        choices={props.choices}
        deleted={totals.deleted}
        ignoreWhitespace={ignoreWhitespace}
        layout={layout}
        onCollapseAll={diff.collapseAll}
        onIgnoreWhitespaceChange={setIgnoreWhitespace}
        onLayoutChange={setLayout}
        onRefresh={() => {
          props.onRefresh();
          diff.refresh();
        }}
        onScopeChange={props.onScopeChange}
        onTreeVisibleChange={setTreeVisible}
        onWrapChange={setWrap}
        scope={props.scope}
        scopeLabel={props.scopeLabel}
        treeVisible={treeVisible}
        wrap={wrap}
      />
      <div className="cv-diff__body">
        <div className="cv-diff__files">
          {props.replacementBody ?? (
            <DiffFiles
              diff={diff}
              emptyReason={props.source === null ? props.emptyReason : null}
              layout={layout}
              onOpenFile={props.onOpenFile}
              sections={sections.current}
            />
          )}
        </div>
        {treeVisible && props.replacementBody === null && (
          <AgentDiffFileTree currentPath={currentPath} files={diff.files.map((view) => view.file)} onSelect={reveal} />
        )}
      </div>
    </section>
  );
}

function DiffFiles(props: {
  readonly diff: ReturnType<typeof useAgentDiffSurface>;
  readonly emptyReason: string | null;
  readonly layout: AgentDiffLayout;
  readonly sections: Map<string, HTMLDivElement>;
  onOpenFile(file: AgentDiffFile): void;
}) {
  const { diff } = props;
  if (props.emptyReason !== null) return <p className="cv-rp-note">{props.emptyReason}</p>;
  switch (diff.status.kind) {
    case "idle":
      return <p className="cv-rp-note">Select changes to review.</p>;
    case "loading":
      return <p className="cv-rp-note">Loading changes…</p>;
    case "unavailable":
      return <p className="cv-rp-note">{diff.status.reason}</p>;
    case "failed":
      return (
        <p className="cv-rp-note cv-rp-note--warning">
          {diff.status.message}{" "}
          <button className="cv-rp-link" onClick={diff.refresh} type="button">
            Retry
          </button>
        </p>
      );
    case "ready":
      if (diff.files.length === 0) return <p className="cv-rp-note">No changes.</p>;
      return (
        <>
          {diff.files.map((view) => (
            <AgentDiffFileSection
              key={view.file.displayPath}
              layout={props.layout}
              onOpen={props.onOpenFile}
              onToggle={() => diff.toggleFile(view.file.displayPath)}
              sectionRef={(node) => {
                if (node === null) {
                  props.sections.delete(view.file.displayPath);
                  return;
                }
                props.sections.set(view.file.displayPath, node);
              }}
              view={view}
            />
          ))}
          {diff.status.truncated && <p className="cv-rp-note">Showing the first 500 changed files.</p>}
        </>
      );
  }
}

function diffTotals(files: ReadonlyArray<AgentDiffFileView>): { readonly added: number | null; readonly deleted: number | null } {
  const known = files.filter((view) => view.file.added !== null || view.file.deleted !== null);
  if (known.length === 0) return { added: null, deleted: null };
  return {
    added: known.reduce((total, view) => total + (view.file.added ?? 0), 0),
    deleted: known.reduce((total, view) => total + (view.file.deleted ?? 0), 0),
  };
}
```

Create `src/components/agentMode/rightPanel/diff/agentDiff.css`:

```css
.cv-diff {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.cv-diff__body {
  flex: 1;
  min-height: 0;
  display: flex;
}

.cv-diff__files {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: var(--cv-space-1) var(--cv-space-2) var(--cv-space-4);
}

.cv-diff-compare {
  display: inline-flex;
  align-items: center;
  gap: var(--cv-space-1);
  min-width: 0;
  font-size: var(--cv-t-xs);
  color: var(--cv-fg-subtle);
}

.cv-diff-compare__head {
  min-width: 0;
  overflow-wrap: anywhere;
}

.cv-diff-file__head {
  display: flex;
  align-items: center;
  gap: 2px;
}

.cv-diff-file__row {
  flex: 1;
  min-width: 0;
  min-height: 32px;
  display: flex;
  align-items: center;
  gap: var(--cv-space-2);
  padding: var(--cv-space-1) var(--cv-space-2);
  border: 0;
  border-radius: var(--cv-r-control);
  background: none;
  font: inherit;
  font-size: var(--cv-t-xs);
  color: var(--cv-fg-strong);
  text-align: left;
}

.cv-diff-file__row:hover {
  background: var(--cv-tint-1);
}

.cv-diff-file__row:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 1px var(--cv-focus);
}

.cv-diff-file__chev {
  flex: none;
  color: var(--cv-fg-subtle);
  transition: transform var(--cv-motion-fast) var(--cv-ease);
}

.cv-diff-file__row[aria-expanded="true"] .cv-diff-file__chev {
  transform: rotate(90deg);
}

.cv-diff-file__glyph {
  flex: none;
  color: var(--cv-fg-subtle);
}

.cv-diff-file__glyph--added {
  color: var(--cv-ok);
}

.cv-diff-file__glyph--deleted {
  color: var(--cv-danger);
}

.cv-diff-file__path {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: baseline;
}

.cv-diff-file__dir {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  direction: rtl;
  color: var(--cv-fg-subtle);
}

.cv-diff-file__name {
  flex: 0 1 auto;
  min-width: 0;
  overflow-wrap: anywhere;
}

.cv-diff-file__note {
  margin: var(--cv-space-1) var(--cv-space-2) var(--cv-space-2);
  font-size: var(--cv-t-xs);
  color: var(--cv-fg-subtle);
}

.cv-diff-hunk {
  margin: 2px 0 var(--cv-space-2);
  border: 1px solid var(--cv-hair);
  border-radius: var(--cv-r-card);
  overflow-x: auto;
  font-family: var(--cv-font-mono);
  font-size: var(--cv-t-xs);
  line-height: 20px;
}

.cv-diff-grid {
  display: grid;
  width: max-content;
  min-width: 100%;
}

.cv-diff-grid--unified {
  grid-template-columns: auto auto 16px minmax(max-content, 1fr);
}

.cv-diff-grid--split {
  grid-template-columns: auto 16px minmax(max-content, 1fr) auto 16px minmax(max-content, 1fr);
}

.cv-diff[data-wrap="true"] .cv-diff-grid {
  width: 100%;
}

.cv-diff[data-wrap="true"] .cv-diff-grid--unified {
  grid-template-columns: auto auto 16px minmax(0, 1fr);
}

.cv-diff[data-wrap="true"] .cv-diff-grid--split {
  grid-template-columns: auto 16px minmax(0, 1fr) auto 16px minmax(0, 1fr);
}

.cv-diff-cell {
  min-height: 20px;
  white-space: pre;
  color: var(--cv-fg);
}

.cv-diff[data-wrap="true"] .cv-diff-code {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.cv-diff-cell--head {
  grid-column: 1 / -1;
  padding: 0 var(--cv-space-2);
  background: var(--cv-tint-1);
  color: var(--cv-fg-subtle);
}

.cv-diff-ln {
  min-width: 28px;
  padding: 0 var(--cv-space-2) 0 6px;
  text-align: right;
  color: var(--cv-fg-subtle);
  font-variant-numeric: tabular-nums;
  user-select: none;
}

.cv-diff-sign {
  text-align: center;
  color: var(--cv-fg-subtle);
  user-select: none;
}

.cv-diff-code {
  padding-right: var(--cv-space-3);
}

.cv-diff-cell--add {
  background: var(--cv-add-bg);
}

.cv-diff-sign--add {
  color: var(--cv-ok);
}

.cv-diff-cell--del {
  background: var(--cv-del-bg);
}

.cv-diff-sign--del {
  color: var(--cv-danger);
}

.cv-diff-cell--empty {
  background: var(--cv-tint-1);
}

.cv-diff-cell--split-start {
  border-left: 1px solid var(--cv-hair);
}

.cv-diff-tree {
  width: min(16rem, 40%);
  min-width: 160px;
  flex: none;
  border-left: 1px solid var(--cv-hair);
  overflow: auto;
  padding: 6px;
}
```

Add these shared rules to `src/components/agentMode/rightPanel/rightPanel.css` (Task 2 file; this task owns the addition):

```css
.cv-rp-ctl {
  height: 28px;
  display: inline-flex;
  align-items: center;
  gap: var(--cv-space-1);
  min-width: 0;
  padding: 0 var(--cv-space-2);
  border: 0;
  border-radius: var(--cv-r-control);
  background: none;
  font: inherit;
  font-size: var(--cv-t-xs);
  font-weight: 500;
  color: var(--cv-fg-strong);
}

.cv-rp-ctl:hover {
  background: var(--cv-tint-2);
}

.cv-rp-ctl:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 1px var(--cv-focus);
}

.cv-rp-ctl--quiet {
  font-weight: 400;
  color: var(--cv-fg-muted);
}

.cv-rp-link {
  border: 0;
  background: none;
  padding: 0;
  font: inherit;
  color: var(--cv-accent);
  text-decoration: underline;
  text-underline-offset: 2px;
}
```

- [ ] **Step 5: Write the B4 style-contract test**

Create `src/components/agentMode/rightPanel/diff/agentDiffStyles.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseCssRules, readStyleSheet } from "../../../cssContractTestSupport";

const sheet = "components/agentMode/rightPanel/diff/agentDiff.css";
const rules = parseCssRules(readStyleSheet(sheet).source, sheet).rules;

function declarations(selector: string): ReadonlyMap<string, string> {
  const rule = rules.find((candidate) => candidate.selector === selector);
  return new Map(rule?.declarations.map((declaration) => [declaration.property, declaration.value]) ?? []);
}

describe("diff layout never clips code (B4)", () => {
  it("scrolls hunks horizontally", () => {
    expect(declarations(".cv-diff-hunk").get("overflow-x")).toBe("auto");
    expect(declarations(".cv-diff-hunk").has("overflow")).toBe(false);
  });

  it("sizes rows to their content without wrap and to the panel with wrap", () => {
    expect(declarations(".cv-diff-grid").get("width")).toBe("max-content");
    expect(declarations(".cv-diff-grid").get("min-width")).toBe("100%");
    expect(declarations('.cv-diff[data-wrap="true"] .cv-diff-code').get("white-space")).toBe("pre-wrap");
    expect(declarations('.cv-diff[data-wrap="true"] .cv-diff-code').get("overflow-wrap")).toBe("anywhere");
  });

  it("never hides overflowing code cells or file names", () => {
    for (const rule of rules) {
      if (!/cv-diff-(code|cell|grid|hunk)|cv-diff-file__name/.test(rule.selector)) continue;
      const overflow = rule.declarations.find((declaration) => declaration.property === "overflow");
      expect(overflow?.value ?? "visible", rule.selector).not.toBe("hidden");
      const textOverflow = rule.declarations.find((declaration) => declaration.property === "text-overflow");
      expect(textOverflow, rule.selector).toBeUndefined();
    }
  });

  it("lets a long file name wrap instead of clipping it", () => {
    expect(declarations(".cv-diff-file__name").get("overflow-wrap")).toBe("anywhere");
  });
});
```

The import resolves to `src/components/cssContractTestSupport.ts` (three levels up from this test).

- [ ] **Step 6: Build the source model and the container**

Create `src/components/agentMode/rightPanel/diff/useAgentDiffSurfaceSource.ts`:

```ts
import { useMemo } from "react";
import {
  agentDiffRevisionKey,
  turnDiffSource,
  workingTreeDiffSource,
  type AgentDiffLineStatsPort,
  type AgentDiffSource,
} from "../../../../application/rightPanel/agentDiffSources";
import { branchDiffSource } from "../../../../application/rightPanel/agentBranchDiffSource";
import { gitSurfaceStatusValue } from "../../../../application/rightPanel/useGitSurfaceStatus";
import {
  agentDiffScopeLabel,
  agentDiffTurnOptions,
  resolveAgentDiffScope,
  type AgentDiffTurn,
} from "../../../../domain/diffView/agentDiffScope";
import type { GitSurfaceStatusGateway, GitSurfaceTarget } from "../../../../domain/gitSurfaceStatus";
import { isRemoteAgentSurfaceThread } from "../../agentSurfacePolicy";
import type { AgentRightPanelContextValue } from "../agentRightPanelContext";
import type { AgentDiffScopeChoices } from "./AgentDiffSurface";

const NO_TURNS: ReadonlyArray<AgentDiffTurn> = [];
const MAX_BASE_CHOICES = 50;

export interface AgentDiffSurfaceSourceModel {
  readonly source: AgentDiffSource | null;
  readonly choices: AgentDiffScopeChoices;
  readonly scopeLabel: string;
  readonly emptyReason: string | null;
  readonly remoteWorkingTree: boolean;
}

export function useAgentDiffSurfaceSource(context: AgentRightPanelContextValue): AgentDiffSurfaceSourceModel {
  const { agents, checkoutRoot, chrome, diffScope, target, thread } = context;
  const turns = thread?.thread.turns ?? NO_TURNS;
  const remote = isRemoteAgentSurfaceThread(thread);
  const threadId = thread?.thread.threadId ?? null;
  const revisionObject =
    threadId === null ? undefined : (agents.getTurnChangesRevision?.(threadId) ?? agents.turnChangesRevision);
  const turnRevision = agentDiffRevisionKey(revisionObject);
  const status = gitSurfaceStatusValue(context.gitStatus.load);
  const resolved = resolveAgentDiffScope(diffScope, turns);
  const getTurnChanges = agents.getTurnChanges;
  const getTurnFileDiff = agents.getTurnFileDiff;

  const source = useMemo<AgentDiffSource | null>(() => {
    switch (resolved.kind) {
      case "noTurns":
        return null;
      case "turn":
        if (threadId === null || getTurnChanges === undefined || getTurnFileDiff === undefined) return null;
        return turnDiffSource({
          threadId,
          turnId: resolved.turnId,
          repositoryRoot: checkoutRoot ?? "",
          revision: turnRevision,
          getTurnChanges: (id, turnId) => getTurnChanges(id, turnId),
          getTurnFileDiff: (id, turnId, path) => getTurnFileDiff(id, turnId, path),
        });
      case "workingTree":
        if (remote || chrome === null || checkoutRoot === null) return null;
        return workingTreeDiffSource({
          repositories: thread === null ? chrome.projectRepositories : [{ root: checkoutRoot, prefix: "" }],
          worktreePath: target?.worktreePath ?? null,
          revision: 0,
          git: chrome.gateways.git,
          lineStats: surfaceLineStats(chrome.gateways.surfaceStatus, target),
        });
      case "branch":
        if (remote || chrome === null || target === null) return null;
        return branchDiffSource({
          repositoryRoot: target.repositoryRoot,
          worktreePath: target.worktreePath,
          baseRef: resolved.baseRef,
          revision: 0,
          gateway: chrome.gateways.branchDiff,
        });
    }
  }, [checkoutRoot, chrome, getTurnChanges, getTurnFileDiff, remote, resolved, target, thread, threadId, turnRevision]);

  const head = status?.branch ?? null;
  const defaultBase = status?.defaultBase ?? null;
  const choices: AgentDiffScopeChoices = {
    turns: threadId !== null && getTurnChanges !== undefined ? agentDiffTurnOptions(turns) : [],
    workingTree: remote ? context.legacyWorkingTreeDiff !== null : chrome !== null,
    branch:
      remote || head === null || defaultBase === null || head === defaultBase
        ? null
        : {
            head,
            defaultBase,
            bases: (status?.localBranches ?? []).filter((branch) => branch !== head).slice(0, MAX_BASE_CHOICES),
          },
  };
  return {
    source,
    choices,
    scopeLabel: agentDiffScopeLabel(diffScope, turns),
    emptyReason: resolved.kind === "noTurns" ? "No finished turns yet. Switch to Working tree to see current changes." : null,
    remoteWorkingTree: remote && diffScope.kind === "workingTree",
  };
}

function surfaceLineStats(gateway: GitSurfaceStatusGateway, target: GitSurfaceTarget | null): AgentDiffLineStatsPort {
  return {
    async lineStats(repositoryRoot, worktreePath) {
      const request = worktreePath !== null && target !== null ? target : { repositoryRoot, worktreePath: null };
      return (await gateway.getSurfaceStatus(request)).lineStats;
    },
  };
}
```

`resolved` is a fresh object each render, so memoize it first: `const resolved = useMemo(() => resolveAgentDiffScope(diffScope, turns), [diffScope, turns]);` (replace the plain call above).

Create `src/components/agentMode/rightPanel/diff/AgentDiffSurfaceContainer.tsx`:

```tsx
import { Suspense, lazy } from "react";
import type { AgentDiffFile } from "../../../../application/rightPanel/agentDiffSources";
import type { GitChangedFile } from "../../../../domain/git";
import { inlineDiffViewGateway } from "../../../../infrastructure/inlineDiffViewGateway";
import { useAgentRightPanelContext } from "../agentRightPanelContext";
import { AgentDiffSurface } from "./AgentDiffSurface";
import { useAgentDiffSurfaceSource } from "./useAgentDiffSurfaceSource";

const LazyAgentSurfaceDiff = lazy(() =>
  import("../../AgentSurfaceDiff").then((module) => ({ default: module.AgentSurfaceDiff })),
);

export function AgentDiffSurfaceContainer() {
  const context = useAgentRightPanelContext();
  const model = useAgentDiffSurfaceSource(context);
  const { agents, chrome, legacyWorkingTreeDiff, thread } = context;
  const openFile = (file: AgentDiffFile) => {
    if (thread === null) {
      context.openFile(joinPath(file.repositoryRoot, file.relativePath));
      return;
    }
    const change = gitChange(file);
    if (context.diffScope.kind === "workingTree") {
      void agents.openChangedFileDiff(thread.thread.threadId, change);
      return;
    }
    void agents.openChangedFile(thread.thread.threadId, change);
  };
  return (
    <AgentDiffSurface
      choices={model.choices}
      computation={chrome?.gateways.diffComputation ?? inlineDiffViewGateway}
      emptyReason={model.emptyReason}
      onOpenFile={openFile}
      onRefresh={context.gitStatus.refresh}
      onScopeChange={context.onDiffScopeChange}
      replacementBody={
        model.remoteWorkingTree && legacyWorkingTreeDiff !== null && thread !== null ? (
          <Suspense fallback={<p className="cv-rp-note">Loading the diff…</p>}>
            <LazyAgentSurfaceDiff {...legacyWorkingTreeDiff} thread={thread} />
          </Suspense>
        ) : null
      }
      scope={context.diffScope}
      scopeLabel={model.scopeLabel}
      source={model.source}
    />
  );
}

function gitChange(file: AgentDiffFile): GitChangedFile {
  return {
    isStaged: false,
    isUnversioned: file.status === "untracked",
    oldPath: file.oldRelativePath === null ? null : joinPath(file.repositoryRoot, file.oldRelativePath),
    oldRelativePath: file.oldRelativePath,
    path: joinPath(file.repositoryRoot, file.relativePath),
    relativePath: file.relativePath,
    status: file.status,
  };
}

function joinPath(root: string, relativePath: string): string {
  return `${root.replace(/\/+$/, "")}/${relativePath}`;
}
```

- [ ] **Step 7: Integration (lead, in order)**

1. `AgentRightPanelSurfaceBody.tsx`: the `diff` case becomes `return blockedOr(props, <AgentDiffSurfaceContainer />);`. Remove the `diffBody` prop from the props and from `AgentSurfacePanel`.
2. `AgentSurfacePanel.tsx`: delete `legacyDiffBody`, `LazyAgentSurfaceDiff`, `LazyAgentSurfaceProjectDiff`, the `diff` / `projectDiff` props and their types.
3. `AgentSurfaceHost.tsx`:
   - Delete `recordedDiff`, `onCloseRecordedDiff` and the `projectDiff` expression.
   - Keep the existing `diff` memo, renamed `legacyWorkingTreeDiff`, and compute it only for remote threads (`remote && thread !== null`) without `recorded` / `onCloseRecorded`. Pass it into the Task 7 context value.
   - Widen `AgentSurfaceHostAgents` to `Pick<AgentThreadsSurface, "showChanges" | "showFileDiff" | "hideFileDiff" | "openChangedFile" | "openChangedFileDiff" | "getTurnChanges" | "getTurnFileDiff" | "turnChangesRevision" | "getTurnChangesRevision">`.
4. `AgentSurfaceDiff.tsx`: delete the `recorded` / `onCloseRecorded` props and the branch rendering `AgentRecordedTurnDiff`. Delete the recorded cases from `AgentSurfaceDiff.test.tsx` and the project-diff cases (their component is deleted).
5. `AgentModeView.tsx`:
   - Replace the block from `const [recordedDiff, setRecordedDiff] = useState…` through `reviewInDiff` with:

```tsx
const diffScopes = useAgentDiffScopeSelection({
  threadId: selectedRecordedThreadId,
  turns: sessionThread?.thread.turns ?? NO_DIFF_TURNS,
  diffActive: layout.rightPanel === "open" && layout.activeSurface === "diff",
  openDiff: openDiffSurface,
});
const openRecordedDiff = diffScopes.openTurnDiff;
const showChanges = agents.showChanges;
const reviewInDiff = useCallback(
  (threadId: string) => {
    void showChanges(threadId);
    diffScopes.reviewWorkingTree(threadId);
  },
  [diffScopes, showChanges],
);
```

     with `const openDiffSurface = useCallback(() => openSurface("diff"), [openSurface]);` above it and module-level `const NO_DIFF_TURNS: ReadonlyArray<AgentDiffTurn> = [];`.
   - In `closeSurfaceTab` and `openSurfaceCommand`, replace `setRecordedDiff(null)` with `diffScopes.resetScope()`, and delete `closeRecordedDiff`.
   - On `<AgentSurfaceHost>`, replace `recordedDiff` / `onCloseRecordedDiff` with `diffScope={diffScopes.scope}` and `onDiffScopeChange={diffScopes.setScope}`.
   - If `AgentThreadSession` already declares P3's optional prop `activeDiffTurnId`, pass `activeDiffTurnId={diffScopes.activeDiffTurnId}`. If P3 has not landed yet, skip this line and list it in the task report as a P3 follow-up.
   - Remove the now-unused imports (`AgentRecordedTurnSelection`, `AgentTurnChangeSummary` if unused).
   - Record `wc -l` before and after; the file must shrink.
6. `AgentWorkbenchScreen.tsx`: delete `useAgentProjectDiffChrome` and the `projectDiff` chrome field. In `agentWorkbenchChrome.ts`, delete `projectDiff`.
7. Delete the files listed under **Delete** after `rg -n "AgentSurfaceProjectDiff|useAgentProjectDiffChrome|AgentRecordedTurnDiff|AgentTurnChangesCard|agentTurnChangesCard.css|agentRecordedTurnChanges.css|AgentThreadChangesCue" src` shows only the files being deleted. If P3's `AgentRecordedTurnChanges.tsx` still imports `agentRecordedTurnChanges.css` or `AgentTurnChangesCard`, stop and report instead of deleting (P3 agreed to drop those imports).
8. Delete the `.agent-surface-diff*` rules from `agentSurface.css`, except the ones `AgentSurfaceDiff.tsx` still uses for the remote working tree (`rg` the class names used in `AgentSurfaceDiff.tsx` first).

- [ ] **Step 8: Run the focused suites and gates for this slice**

Run: `npx vitest run src/components/agentMode/rightPanel src/components/agentMode/useAgentDiffScopeSelection.test.tsx src/components/agentMode/AgentSurfaceDiff.test.tsx src/components/agentMode/AgentSurfacePanel.test.tsx src/components/agentMode/AgentSurfaceHost.test.tsx src/components/agentMode/AgentModeView.test.tsx src/ui/tokens && npm run check && npm run lint -- --max-warnings 0 && npm run size:hotspots`
Expected: PASS, and every command exits 0. `size:hotspots` must not report `AgentModeView.tsx` growth.

- [ ] **Step 9: Hand off (no commit)**

---
### Task 7: Git surface data backend (line stats, unpushed commits, branches, branch diff), gateways bag and right-panel context

**Files:**
- Create (Rust): `src-tauri/src/git_surface_status.rs`, `src-tauri/src/git_branch_diff.rs`, `src-tauri/src/lib_composition/git_surface_commands.rs`
- Modify (Rust):
  - `src-tauri/src/lib_composition/command_facades.rs`: one `#[path] mod` pair;
  - `src-tauri/src/lib_composition/runtime.rs`: three handler entries;
  - `src-tauri/src/git_integration.rs`: make `current_branch` `pub(crate)`.
- Create (TS):
  - domain: `src/domain/wireValue.ts`, `src/domain/gitSurfaceStatus.ts`, `src/domain/gitBranchDiff.ts`;
  - infrastructure: `src/infrastructure/tauriGitSurfaceIpcContract.ts`, `src/infrastructure/tauriGitSurfaceGateway.ts`;
  - application: `src/application/rightPanel/agentBranchDiffSource.ts`, `src/application/rightPanel/useGitSurfaceStatus.ts`;
  - components: `src/components/agentMode/rightPanel/agentRightPanelGateways.ts`, `src/components/agentMode/rightPanel/useAgentRightPanelChrome.ts`, `src/components/agentMode/rightPanel/agentRightPanelContext.ts`, `src/components/agentMode/rightPanel/agentRightPanelTestSupport.tsx`.
- Modify (TS, integration):
  - `src/components/agentMode/agentWorkbenchChrome.ts`: `rightPanel` field;
  - `src/components/agentMode/AgentWorkbenchScreen.tsx`: `rightPanelGateways` prop + chrome field;
  - `src/components/agentMode/AgentSurfaceHost.tsx`: `diffScope`, `onDiffScopeChange`, `shipActions` props, target computation, `useGitSurfaceStatus`, context provider.
- Test:
  - `src/domain/wireValue.test.ts`, `src/domain/gitSurfaceStatus.test.ts`, `src/domain/gitBranchDiff.test.ts`;
  - `src/infrastructure/tauriGitSurfaceIpcContract.test.ts`;
  - `src/application/rightPanel/agentBranchDiffSource.test.ts`, `src/application/rightPanel/useGitSurfaceStatus.test.tsx`;
  - Rust unit tests inside the three new Rust files.

**Interfaces:**
- Consumes: Task 5 `AgentDiffSource` types, Task 4 `BrowserDiffViewGateway`. Existing `git_integration::{run_integration_command, INTEGRATION_LOCAL_TIMEOUT, resolve_ship_targets, safe_object_id}`, `canonicalize_workspace_root`, `trusted_for`, `GitTrustState`, `TauriGitGateway`, `TauriWorkspaceGateway`, `BrowserTextClipboardGateway`.
- Produces:
  - Tauri commands:
    - `get_git_surface_status({ request: { repositoryRoot, worktreePath } }) -> GitSurfaceStatus`;
    - `get_git_branch_changes({ request: { repositoryRoot, worktreePath, baseRef } }) -> BranchChanges`;
    - `get_git_branch_file_diff({ request: { repositoryRoot, worktreePath, mergeBase, relativePath, oldRelativePath } }) -> BranchFileSides`.
  - TS domain:
    - `interface GitSurfaceTarget { repositoryRoot: string; worktreePath: string | null }`;
    - `interface GitSurfaceStatus { branch; defaultBase; hasRemote; upstream: { name; ahead; behind } | null; unpushed: ReadonlyArray<GitUnpushedCommit>; unpushedTruncated; lineStats: ReadonlyArray<GitLineStat>; lineStatsTruncated; localBranches; remoteBranches; worktreeBranches; branchesTruncated }`;
    - `interface GitSurfaceStatusGateway { getSurfaceStatus(target: GitSurfaceTarget): Promise<GitSurfaceStatus> }`;
    - `parseGitSurfaceStatus(value: unknown): GitSurfaceStatus`.
  - `interface GitBranchDiffGateway { getBranchChanges(request): Promise<GitBranchChanges>; getBranchFileSides(request): Promise<GitBranchFileSides> }`, `parseGitBranchChanges`, `parseGitBranchFileSides`, `validateGitBaseRef(value): string`
  - `class TauriGitSurfaceGateway implements GitSurfaceStatusGateway, GitBranchDiffGateway`
  - `branchDiffSource(input: { repositoryRoot; worktreePath; baseRef; revision; gateway }): AgentDiffSource`
  - `type GitSurfaceStatusLoad`, `interface GitSurfaceStatusSnapshot { load; refresh(): void }`, `useGitSurfaceStatus({ gateway, target, enabled }): GitSurfaceStatusSnapshot`, `gitSurfaceStatusValue(load): GitSurfaceStatus | null`
  - `interface AgentRightPanelGateways { git; surfaceStatus; branchDiff; diffComputation; fileSearch }` (Task 8 adds `pullRequest`, Task 9 adds `worktrees`), `createDefaultAgentRightPanelGateways(): AgentRightPanelGateways`
  - `interface AgentRightPanelChrome { gateways; projectRepositories: ReadonlyArray<WorkingTreeRepository>; copyText(text: string): Promise<void> }`, `useAgentRightPanelChrome(input): AgentRightPanelChrome`
  - `interface AgentRightPanelContextValue` (fields listed in Step 10), `AgentRightPanelContext`, `useAgentRightPanelContext()`, test helpers `rightPanelTestContext(overrides?, gateways?)` and `WithRightPanelContext`

- [ ] **Step 1: Write the failing Rust tests for surface status**

Create `src-tauri/src/git_surface_status.rs` with only the test module first. The implementation is added in Step 3.

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use std::process::Command;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static NONCE: AtomicUsize = AtomicUsize::new(0);

    struct TempRepository {
        root: PathBuf,
    }

    impl TempRepository {
        fn create(label: &str) -> Self {
            let nonce = NONCE.fetch_add(1, Ordering::SeqCst);
            let root = std::env::temp_dir().join(format!(
                "git-surface-unit-{label}-{}-{nonce}",
                std::process::id()
            ));
            fs::create_dir_all(&root).expect("create repository directory");
            let repository = Self {
                root: root.canonicalize().expect("canonical root"),
            };
            repository.git(&["init", "--initial-branch=main"]);
            repository.git(&["config", "user.name", "Test"]);
            repository.git(&["config", "user.email", "test@example.com"]);
            fs::write(repository.root.join("a.txt"), "one\ntwo\n").expect("seed file");
            repository.git(&["add", "a.txt"]);
            repository.git(&["commit", "-m", "initial"]);
            repository
        }

        fn git(&self, arguments: &[&str]) {
            let output = Command::new("git")
                .env("GIT_CONFIG_GLOBAL", "/dev/null")
                .env("GIT_CONFIG_SYSTEM", "/dev/null")
                .arg("-C")
                .arg(&self.root)
                .args(arguments)
                .output()
                .expect("run git fixture command");
            assert!(output.status.success(), "git {arguments:?} failed: {}", String::from_utf8_lossy(&output.stderr));
        }
    }

    impl Drop for TempRepository {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn parses_numstat_records_including_renames_and_binary_files() {
        let output = "3\t1\tsrc/a.ts\0-\t-\timage.png\0\
                      2\t0\t\0old/name.ts\0new/name.ts\0";
        let (stats, truncated) = parse_numstat_z(output, 10);
        assert!(!truncated);
        assert_eq!(
            stats,
            vec![
                LineStat { relative_path: "src/a.ts".into(), added: Some(3), deleted: Some(1) },
                LineStat { relative_path: "image.png".into(), added: None, deleted: None },
                LineStat { relative_path: "new/name.ts".into(), added: Some(2), deleted: Some(0) },
            ]
        );
    }

    #[test]
    fn caps_numstat_records() {
        let output = "1\t1\ta\0".repeat(5);
        let (stats, truncated) = parse_numstat_z(&output, 3);
        assert_eq!(stats.len(), 3);
        assert!(truncated);
    }

    #[test]
    fn rejects_commit_lines_without_a_hex_object_id() {
        let separator = '\u{1f}';
        let valid = format!("{}{separator}abc1234{separator}1700000000{separator}feat: x", "a".repeat(40));
        assert_eq!(parse_commit_line(&valid).map(|commit| commit.subject), Some("feat: x".to_string()));
        assert!(parse_commit_line(&format!("zz{separator}zz{separator}1{separator}x")).is_none());
    }

    #[test]
    fn reports_branch_default_base_line_stats_and_no_unpushed_without_remotes() {
        let repository = TempRepository::create("status");
        repository.git(&["checkout", "-b", "feat/x"]);
        fs::write(repository.root.join("a.txt"), "one\nTWO\nthree\n").expect("edit file");

        let status = git_surface_status(&repository.root).expect("surface status");

        assert_eq!(status.branch.as_deref(), Some("feat/x"));
        assert_eq!(status.default_base.as_deref(), Some("main"));
        assert!(!status.has_remote);
        assert!(status.unpushed.is_empty());
        assert_eq!(
            status.line_stats,
            vec![LineStat { relative_path: "a.txt".into(), added: Some(2), deleted: Some(1) }]
        );
        assert_eq!(status.local_branches, vec!["feat/x".to_string(), "main".to_string()]);
    }

    #[test]
    fn lists_commits_that_no_remote_contains() {
        let repository = TempRepository::create("unpushed");
        let remote = TempRepository::create("unpushed-remote");
        repository.git(&["remote", "add", "origin", remote.root.to_str().expect("utf8 path")]);
        repository.git(&["fetch", "origin"]);
        repository.git(&["commit", "--allow-empty", "-m", "local only"]);

        let status = git_surface_status(&repository.root).expect("surface status");

        assert!(status.has_remote);
        assert_eq!(status.unpushed.first().map(|commit| commit.subject.as_str()), Some("local only"));
    }
}
```

The newest unpushed commit must be the local-only one; the shared seed commit may or may not be byte-identical to the remote one, so the test pins only the head of the list (`--not --remotes` semantics).

- [ ] **Step 2: Declare the module and run to verify it fails**

In `src-tauri/src/lib_composition/command_facades.rs`, add next to `git_integration_commands`:

```rust
#[path = "git_surface_commands.rs"]
mod git_surface_commands;
```

Create `src-tauri/src/lib_composition/git_surface_commands.rs` with:

```rust
use super::git_integration_commands::git_integration;

#[path = "../git_surface_status.rs"]
pub(crate) mod git_surface_status;
#[path = "../git_branch_diff.rs"]
pub(crate) mod git_branch_diff;
```

and create an empty `src-tauri/src/git_branch_diff.rs`.

Run: `cd src-tauri && cargo test --lib git_surface_status`
Expected: FAIL to compile (`parse_numstat_z`, `git_surface_status`, `LineStat` not found).

- [ ] **Step 3: Implement surface status**

Prepend to `src-tauri/src/git_surface_status.rs` (above the test module):

```rust
use serde::Serialize;
use std::ffi::OsStr;
use std::path::Path;

use super::git_integration::{run_integration_command, INTEGRATION_LOCAL_TIMEOUT};

pub(crate) const MAX_SURFACE_UNPUSHED_COMMITS: usize = 20;
pub(crate) const MAX_SURFACE_LINE_STATS: usize = 2_000;
pub(crate) const MAX_SURFACE_BRANCHES: usize = 200;
pub(crate) const MAX_SURFACE_WORKTREE_BRANCHES: usize = 64;
pub(crate) const MAX_SURFACE_SUBJECT_BYTES: usize = 200;
const DEFAULT_BASE_CANDIDATES: [&str; 4] = ["main", "master", "trunk", "develop"];
const FIELD_SEPARATOR: char = '\u{1f}';

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SurfaceUpstream {
    pub(crate) name: String,
    pub(crate) ahead: usize,
    pub(crate) behind: usize,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UnpushedCommit {
    pub(crate) sha: String,
    pub(crate) short_sha: String,
    pub(crate) subject: String,
    pub(crate) authored_at_epoch_seconds: i64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LineStat {
    pub(crate) relative_path: String,
    pub(crate) added: Option<u32>,
    pub(crate) deleted: Option<u32>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitSurfaceStatus {
    pub(crate) branch: Option<String>,
    pub(crate) default_base: Option<String>,
    pub(crate) has_remote: bool,
    pub(crate) upstream: Option<SurfaceUpstream>,
    pub(crate) unpushed: Vec<UnpushedCommit>,
    pub(crate) unpushed_truncated: bool,
    pub(crate) line_stats: Vec<LineStat>,
    pub(crate) line_stats_truncated: bool,
    pub(crate) local_branches: Vec<String>,
    pub(crate) remote_branches: Vec<String>,
    pub(crate) worktree_branches: Vec<String>,
    pub(crate) branches_truncated: bool,
}

pub(crate) fn git_surface_status(root: &Path) -> Result<GitSurfaceStatus, String> {
    let branch = current_branch(root)?;
    let has_remote = has_remote(root);
    let (unpushed, unpushed_truncated) = match has_remote {
        true => unpushed_commits(root),
        false => (Vec::new(), false),
    };
    let (line_stats, line_stats_truncated) = line_stats(root);
    let (local_branches, local_truncated) = refs(root, "refs/heads")?;
    let (remote_branches, remote_truncated) = refs(root, "refs/remotes")?;
    let default_base = default_base(root, &local_branches);
    Ok(GitSurfaceStatus {
        branch,
        default_base,
        has_remote,
        upstream: upstream(root),
        unpushed,
        unpushed_truncated,
        line_stats,
        line_stats_truncated,
        local_branches,
        remote_branches,
        worktree_branches: worktree_branches(root),
        branches_truncated: local_truncated || remote_truncated,
    })
}

pub(crate) fn default_base(root: &Path, local_branches: &[String]) -> Option<String> {
    let remote_head = git(root, &["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]).ok();
    let remote_head = remote_head.as_deref().map(str::trim).filter(|value| !value.is_empty());
    if let Some(remote_head) = remote_head {
        let local = remote_head.strip_prefix("origin/").unwrap_or(remote_head);
        if local_branches.iter().any(|branch| branch == local) {
            return Some(local.to_string());
        }
        return Some(remote_head.to_string());
    }
    DEFAULT_BASE_CANDIDATES
        .iter()
        .find(|candidate| local_branches.iter().any(|branch| branch == *candidate))
        .map(|candidate| candidate.to_string())
}

pub(crate) fn refs(root: &Path, namespace: &str) -> Result<(Vec<String>, bool), String> {
    let count = format!("--count={}", MAX_SURFACE_BRANCHES + 1);
    let output = git(root, &["for-each-ref", "--format=%(refname:short)", count.as_str(), namespace])?;
    let remote = namespace == "refs/remotes";
    let mut names: Vec<String> = output
        .lines()
        .map(str::trim)
        .filter(|name| !name.is_empty() && !name.chars().any(char::is_control))
        .filter(|name| !remote || (name.contains('/') && !name.ends_with("/HEAD")))
        .map(str::to_string)
        .collect();
    let truncated = names.len() > MAX_SURFACE_BRANCHES;
    names.truncate(MAX_SURFACE_BRANCHES);
    Ok((names, truncated))
}

pub(crate) fn parse_numstat_z(output: &str, limit: usize) -> (Vec<LineStat>, bool) {
    let mut records = output.split('\0');
    let mut stats = Vec::new();
    while let Some(record) = records.next() {
        if record.is_empty() {
            continue;
        }
        let mut columns = record.splitn(3, '\t');
        let (Some(added), Some(deleted), Some(path)) = (columns.next(), columns.next(), columns.next()) else {
            continue;
        };
        let relative_path = match path.is_empty() {
            true => {
                records.next();
                records.next().unwrap_or_default()
            }
            false => path,
        };
        if relative_path.is_empty() {
            continue;
        }
        if stats.len() >= limit {
            return (stats, true);
        }
        stats.push(LineStat {
            relative_path: relative_path.to_string(),
            added: added.parse().ok(),
            deleted: deleted.parse().ok(),
        });
    }
    (stats, false)
}

pub(crate) fn parse_commit_line(line: &str) -> Option<UnpushedCommit> {
    let mut fields = line.splitn(4, FIELD_SEPARATOR);
    let sha = fields.next()?;
    let short_sha = fields.next()?;
    let authored_at_epoch_seconds = fields.next()?.parse::<i64>().ok()?;
    let subject = fields.next().unwrap_or_default();
    if !is_object_id(sha) {
        return None;
    }
    Some(UnpushedCommit {
        sha: sha.to_string(),
        short_sha: short_sha.chars().take(12).collect(),
        subject: clip_utf8(subject.trim(), MAX_SURFACE_SUBJECT_BYTES),
        authored_at_epoch_seconds,
    })
}

pub(crate) fn clip_utf8(value: &str, max_bytes: usize) -> String {
    if value.len() <= max_bytes {
        return value.to_string();
    }
    let mut end = max_bytes;
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    value[..end].to_string()
}

pub(crate) fn git(root: &Path, arguments: &[&str]) -> Result<String, String> {
    let arguments: Vec<&OsStr> = arguments.iter().map(OsStr::new).collect();
    run_integration_command(root, &arguments, INTEGRATION_LOCAL_TIMEOUT).map_err(String::from)
}

fn current_branch(root: &Path) -> Result<Option<String>, String> {
    let output = git(root, &["branch", "--show-current"])?;
    let name = output.trim();
    if name.is_empty() {
        return Ok(None);
    }
    Ok(Some(name.to_string()))
}

fn has_remote(root: &Path) -> bool {
    git(root, &["remote"]).map(|output| !output.trim().is_empty()).unwrap_or(false)
}

fn upstream(root: &Path) -> Option<SurfaceUpstream> {
    let name = git(root, &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]).ok()?;
    let counts = git(root, &["rev-list", "--left-right", "--count", "@{u}...HEAD"]).ok()?;
    let mut parts = counts.split_whitespace();
    let behind = parts.next()?.parse().ok()?;
    let ahead = parts.next()?.parse().ok()?;
    Some(SurfaceUpstream { name: name.trim().to_string(), ahead, behind })
}

fn unpushed_commits(root: &Path) -> (Vec<UnpushedCommit>, bool) {
    let limit = format!("--max-count={}", MAX_SURFACE_UNPUSHED_COMMITS + 1);
    let Ok(output) = git(
        root,
        &["log", "--format=%H%x1f%h%x1f%at%x1f%s", limit.as_str(), "HEAD", "--not", "--remotes"],
    ) else {
        return (Vec::new(), false);
    };
    let mut commits: Vec<UnpushedCommit> = output.lines().filter_map(parse_commit_line).collect();
    let truncated = commits.len() > MAX_SURFACE_UNPUSHED_COMMITS;
    commits.truncate(MAX_SURFACE_UNPUSHED_COMMITS);
    (commits, truncated)
}

fn line_stats(root: &Path) -> (Vec<LineStat>, bool) {
    let Ok(output) = git(root, &["diff", "--numstat", "-z", "-M", "HEAD"]) else {
        return (Vec::new(), false);
    };
    parse_numstat_z(&output, MAX_SURFACE_LINE_STATS)
}

fn worktree_branches(root: &Path) -> Vec<String> {
    let Ok(output) = git(root, &["worktree", "list", "--porcelain"]) else {
        return Vec::new();
    };
    output
        .lines()
        .filter_map(|line| line.strip_prefix("branch refs/heads/"))
        .map(str::to_string)
        .take(MAX_SURFACE_WORKTREE_BRANCHES)
        .collect()
}

fn is_object_id(value: &str) -> bool {
    (value.len() == 40 || value.len() == 64) && value.chars().all(|character| character.is_ascii_hexdigit())
}
```

`run_integration_command` already applies the hardened git environment (hooks disabled, env allowlist, bounded output and timeout). `--numstat` against `HEAD` fails in an unborn repository; that path yields an empty list, not an error.

Run: `cd src-tauri && cargo test --lib git_surface_status`
Expected: PASS.

- [ ] **Step 4: Write and implement the branch diff (Rust)**

Write `src-tauri/src/git_branch_diff.rs`:

```rust
use serde::Serialize;
use std::path::Path;

use super::git_integration::safe_object_id;
use super::git_surface_status::{git, parse_numstat_z};

pub(crate) const MAX_BRANCH_DIFF_FILES: usize = 500;
pub(crate) const MAX_BRANCH_DIFF_SIDE_BYTES: usize = 128 * 1024;
pub(crate) const MAX_BRANCH_DIFF_PATH_BYTES: usize = 4_096;
pub(crate) const MAX_BASE_REF_BYTES: usize = 256;
pub(crate) const INVALID_BASE_REF_ERROR: &str = "Choose a valid base branch.";
pub(crate) const INVALID_DIFF_PATH_ERROR: &str = "The file path is not valid for this repository.";

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BranchChangedFile {
    pub(crate) relative_path: String,
    pub(crate) old_relative_path: Option<String>,
    pub(crate) status: &'static str,
    pub(crate) added: Option<u32>,
    pub(crate) deleted: Option<u32>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BranchChanges {
    pub(crate) merge_base: String,
    pub(crate) files: Vec<BranchChangedFile>,
    pub(crate) truncated: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BranchSide {
    pub(crate) text: String,
    pub(crate) truncated: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BranchFileSides {
    pub(crate) original: BranchSide,
    pub(crate) modified: BranchSide,
    pub(crate) unavailable_reason: Option<&'static str>,
}

enum SideRead {
    Text(String),
    Missing,
    TooLarge,
    Binary,
}

pub(crate) fn safe_base_ref(candidate: &str) -> Result<String, String> {
    let invalid = candidate.is_empty()
        || candidate.len() > MAX_BASE_REF_BYTES
        || candidate.starts_with('-')
        || candidate.starts_with('/')
        || candidate.ends_with('/')
        || candidate.ends_with(".lock")
        || candidate.contains("..")
        || candidate.contains("@{")
        || candidate
            .chars()
            .any(|character| character.is_whitespace() || character.is_control() || "~^:?*[\\".contains(character));
    if invalid {
        return Err(INVALID_BASE_REF_ERROR.to_string());
    }
    Ok(candidate.to_string())
}

pub(crate) fn safe_relative_path(candidate: &str) -> Result<String, String> {
    let invalid = candidate.is_empty()
        || candidate.len() > MAX_BRANCH_DIFF_PATH_BYTES
        || candidate.starts_with('/')
        || candidate.chars().any(char::is_control)
        || candidate.split('/').any(|segment| segment == ".." || segment == "." || segment.is_empty());
    if invalid {
        return Err(INVALID_DIFF_PATH_ERROR.to_string());
    }
    Ok(candidate.to_string())
}

pub(crate) fn branch_changes(root: &Path, base_ref: &str) -> Result<BranchChanges, String> {
    let base = safe_base_ref(base_ref)?;
    let merge_base = git(root, &["merge-base", base.as_str(), "HEAD"])
        .map_err(|_| format!("{base} has no common history with this branch."))?;
    let merge_base = safe_object_id(merge_base.trim())?;
    let name_status = git(root, &["diff", "--name-status", "-z", "-M", merge_base.as_str(), "HEAD"])?;
    let numstat = git(root, &["diff", "--numstat", "-z", "-M", merge_base.as_str(), "HEAD"])?;
    let (stats, _) = parse_numstat_z(&numstat, usize::MAX);
    let (entries, truncated) = parse_name_status_z(&name_status, MAX_BRANCH_DIFF_FILES);
    let files = entries
        .into_iter()
        .map(|entry| {
            let stat = stats.iter().find(|stat| stat.relative_path == entry.relative_path);
            BranchChangedFile {
                added: stat.and_then(|stat| stat.added),
                deleted: stat.and_then(|stat| stat.deleted),
                ..entry
            }
        })
        .collect();
    Ok(BranchChanges { merge_base, files, truncated })
}

pub(crate) fn parse_name_status_z(output: &str, limit: usize) -> (Vec<BranchChangedFile>, bool) {
    let mut records = output.split('\0');
    let mut files = Vec::new();
    while let Some(code) = records.next() {
        if code.is_empty() {
            continue;
        }
        let renamed = code.starts_with('R') || code.starts_with('C');
        let first = records.next().unwrap_or_default();
        let (old_relative_path, relative_path) = match renamed {
            true => (Some(first.to_string()), records.next().unwrap_or_default()),
            false => (None, first),
        };
        if relative_path.is_empty() {
            continue;
        }
        if files.len() >= limit {
            return (files, true);
        }
        files.push(BranchChangedFile {
            relative_path: relative_path.to_string(),
            old_relative_path,
            status: status_name(code),
            added: None,
            deleted: None,
        });
    }
    (files, false)
}

pub(crate) fn branch_file_sides(
    root: &Path,
    merge_base: &str,
    relative_path: &str,
    old_relative_path: Option<&str>,
) -> Result<BranchFileSides, String> {
    let merge_base = safe_object_id(merge_base)?;
    let path = safe_relative_path(relative_path)?;
    let old_path = match old_relative_path {
        Some(old) => safe_relative_path(old)?,
        None => path.clone(),
    };
    let original = read_side(root, &merge_base, &old_path)?;
    let modified = read_side(root, "HEAD", &path)?;
    Ok(sides(original, modified))
}

fn sides(original: SideRead, modified: SideRead) -> BranchFileSides {
    if matches!(original, SideRead::Binary) || matches!(modified, SideRead::Binary) {
        return unavailable("binary");
    }
    if matches!(original, SideRead::TooLarge) || matches!(modified, SideRead::TooLarge) {
        return unavailable("large");
    }
    BranchFileSides {
        original: BranchSide { text: side_text(original), truncated: false },
        modified: BranchSide { text: side_text(modified), truncated: false },
        unavailable_reason: None,
    }
}

fn unavailable(reason: &'static str) -> BranchFileSides {
    BranchFileSides {
        original: BranchSide { text: String::new(), truncated: false },
        modified: BranchSide { text: String::new(), truncated: false },
        unavailable_reason: Some(reason),
    }
}

fn side_text(side: SideRead) -> String {
    match side {
        SideRead::Text(text) => text,
        SideRead::Missing | SideRead::TooLarge | SideRead::Binary => String::new(),
    }
}

fn read_side(root: &Path, revision: &str, path: &str) -> Result<SideRead, String> {
    let spec = format!("{revision}:{path}");
    let Ok(size) = git(root, &["cat-file", "-s", spec.as_str()]) else {
        return Ok(SideRead::Missing);
    };
    let size: usize = size.trim().parse().map_err(|_| "Git reported an unreadable file size.".to_string())?;
    if size > MAX_BRANCH_DIFF_SIDE_BYTES {
        return Ok(SideRead::TooLarge);
    }
    let text = git(root, &["cat-file", "blob", spec.as_str()])?;
    if text.contains('\0') {
        return Ok(SideRead::Binary);
    }
    Ok(SideRead::Text(text))
}

fn status_name(code: &str) -> &'static str {
    match code.chars().next() {
        Some('A') | Some('C') => "added",
        Some('D') => "deleted",
        Some('R') => "renamed",
        _ => "modified",
    }
}
```

Add a `#[cfg(test)] mod tests` to it, with the same `TempRepository` helper as Step 1 (copy it; the fixture stays test-only). Tests:
- `safe_base_ref` rejects `"--help"`, `"a..b"`, `"main "`, `"x@{1}"`, `""` and 257 bytes, and accepts `"main"` / `"origin/release/1.4"`;
- `safe_relative_path` rejects `"../x"`, `"/abs"`, `"a//b"`, `"a/./b"`;
- `parse_name_status_z("M\0a.ts\0R100\0old.ts\0new.ts\0A\0b.ts\0", 10)` yields modified / renamed (with old path) / added;
- a real repository with branch `feat` adding `b.txt` and modifying `a.txt` from `main`:
  - `branch_changes(root, "main")` lists both, with numstat counts and a 40-hex `merge_base`;
  - `branch_file_sides` returns the base text for `a.txt` and an empty original for `b.txt`;
- a 200 KB file yields `unavailable_reason == Some("large")`, and a file containing a NUL byte written with `fs::write(path, [0u8, 1, 2])` yields `Some("binary")`;
- `branch_changes(root, "does-not-exist")` returns `Err`.

In `src-tauri/src/git_integration.rs` confirm `safe_object_id` is `pub` (it is: `pub fn safe_object_id`).

Run: `cd src-tauri && cargo test --lib git_branch_diff git_surface_status`
Expected: PASS.

- [ ] **Step 5: Add the trust-gated commands**

Complete `src-tauri/src/lib_composition/git_surface_commands.rs`:

```rust
use super::git_integration_commands::git_integration;
use super::{canonicalize_workspace_root, trusted_for, GitTrustState};
use crate::run_blocking_command;
use git_branch_diff::{branch_changes, branch_file_sides, BranchChanges, BranchFileSides};
use git_surface_status::{git_surface_status, GitSurfaceStatus};
use serde::Deserialize;
use std::path::{Path, PathBuf};

#[path = "../git_surface_status.rs"]
pub(crate) mod git_surface_status;
#[path = "../git_branch_diff.rs"]
pub(crate) mod git_branch_diff;

pub(crate) const UNTRUSTED_GIT_SURFACE_ERROR: &str =
    "Git in the right panel requires a trusted repository.";

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct GitSurfaceTargetRequest {
    repository_root: String,
    worktree_path: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct GitBranchChangesRequest {
    repository_root: String,
    worktree_path: Option<String>,
    base_ref: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct GitBranchFileDiffRequest {
    repository_root: String,
    worktree_path: Option<String>,
    merge_base: String,
    relative_path: String,
    old_relative_path: Option<String>,
}

pub(crate) fn ensure_git_surface_trusted(
    trust: &GitTrustState<'_>,
    repository_root: &str,
    worktree_path: Option<&str>,
) -> Result<(), String> {
    if !trusted_for(trust, repository_root)? {
        return Err(UNTRUSTED_GIT_SURFACE_ERROR.to_string());
    }
    let Some(worktree_path) = worktree_path else {
        return Ok(());
    };
    if !trusted_for(trust, worktree_path)? {
        return Err(UNTRUSTED_GIT_SURFACE_ERROR.to_string());
    }
    Ok(())
}

pub(crate) fn git_surface_root(repository_root: &str, worktree_path: Option<&str>) -> Result<PathBuf, String> {
    let root = canonicalize_workspace_root(repository_root)?;
    let targets = git_integration::resolve_ship_targets(&root, worktree_path.map(Path::new))?;
    Ok(targets.worktree)
}

#[tauri::command]
pub(crate) async fn get_git_surface_status(
    request: GitSurfaceTargetRequest,
    trust: GitTrustState<'_>,
) -> Result<GitSurfaceStatus, String> {
    ensure_git_surface_trusted(&trust, &request.repository_root, request.worktree_path.as_deref())?;
    run_blocking_command(move || {
        let root = git_surface_root(&request.repository_root, request.worktree_path.as_deref())?;
        git_surface_status(&root)
    })
    .await
}

#[tauri::command]
pub(crate) async fn get_git_branch_changes(
    request: GitBranchChangesRequest,
    trust: GitTrustState<'_>,
) -> Result<BranchChanges, String> {
    ensure_git_surface_trusted(&trust, &request.repository_root, request.worktree_path.as_deref())?;
    run_blocking_command(move || {
        let root = git_surface_root(&request.repository_root, request.worktree_path.as_deref())?;
        branch_changes(&root, &request.base_ref)
    })
    .await
}

#[tauri::command]
pub(crate) async fn get_git_branch_file_diff(
    request: GitBranchFileDiffRequest,
    trust: GitTrustState<'_>,
) -> Result<BranchFileSides, String> {
    ensure_git_surface_trusted(&trust, &request.repository_root, request.worktree_path.as_deref())?;
    run_blocking_command(move || {
        let root = git_surface_root(&request.repository_root, request.worktree_path.as_deref())?;
        branch_file_sides(
            &root,
            &request.merge_base,
            &request.relative_path,
            request.old_relative_path.as_deref(),
        )
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unknown_request_fields() {
        let parsed = serde_json::from_value::<GitSurfaceTargetRequest>(serde_json::json!({
            "repositoryRoot": "/tmp/x",
            "worktreePath": null,
            "shell": "rm -rf /"
        }));
        assert!(parsed.is_err());
    }

    #[test]
    fn refuses_untrusted_repositories_before_running_git() {
        let request = GitSurfaceTargetRequest {
            repository_root: std::env::temp_dir().to_string_lossy().to_string(),
            worktree_path: None,
        };
        let result = tauri::async_runtime::block_on(get_git_surface_status(request, false));
        assert_eq!(result, Err(UNTRUSTED_GIT_SURFACE_ERROR.to_string()));
    }
}
```

In test builds `GitTrustState` is `bool` and `trusted_for(&false, …)` returns `Ok(false)`. If `trusted_for`'s test implementation differs, adapt the untrusted test to it (see `git_integration_commands.rs` tests for the pattern).

In `src-tauri/src/lib_composition/runtime.rs`, add after `git_integration_commands::integrate_git_worktree_branch,`:

```rust
            git_surface_commands::get_git_surface_status,
            git_surface_commands::get_git_branch_changes,
            git_surface_commands::get_git_branch_file_diff,
```

(and re-export through `command_facades.rs` the same way `git_integration_commands` commands are reachable from `runtime.rs`).

Run: `cd src-tauri && cargo test --lib git_surface && cargo clippy --all-targets -- -D warnings`
Expected: PASS, and clippy is clean.

- [ ] **Step 6: Write the failing TS wire tests**

Create `src/domain/wireValue.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { wireBoolean, wireCount, wireExactRecord, wireNullableString, wireString, wireStringArray } from "./wireValue";

describe("wire values", () => {
  it("accepts exact records and rejects unknown or missing keys", () => {
    expect(wireExactRecord({ a: 1 }, ["a"], "value")).toEqual({ a: 1 });
    expect(() => wireExactRecord({ a: 1, b: 2 }, ["a"], "value")).toThrow("Invalid value");
    expect(() => wireExactRecord({}, ["a"], "value")).toThrow("Invalid value");
    expect(() => wireExactRecord([], ["a"], "value")).toThrow("Invalid value");
  });

  it("bounds strings by UTF-8 bytes and rejects non-strings", () => {
    expect(wireString("é", "s", 2)).toBe("é");
    expect(() => wireString("é", "s", 1)).toThrow("Invalid s");
    expect(() => wireString(1, "s", 10)).toThrow("Invalid s");
    expect(wireNullableString(null, "s", 1)).toBeNull();
  });

  it("bounds counts and arrays", () => {
    expect(wireCount(3, "n", 3)).toBe(3);
    expect(() => wireCount(-1, "n", 3)).toThrow();
    expect(() => wireCount(1.5, "n", 3)).toThrow();
    expect(wireStringArray(["a"], "list", 1, 10)).toEqual(["a"]);
    expect(() => wireStringArray(["a", "b"], "list", 1, 10)).toThrow();
    expect(wireBoolean(false, "flag")).toBe(false);
  });
});
```

Create `src/domain/gitSurfaceStatus.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseGitSurfaceStatus } from "./gitSurfaceStatus";

const wire = {
  branch: "feat/x",
  defaultBase: "main",
  hasRemote: true,
  upstream: { name: "origin/feat/x", ahead: 2, behind: 0 },
  unpushed: [
    { sha: "a".repeat(40), shortSha: "aaaaaaa", subject: "test: cover retry", authoredAtEpochSeconds: 1_700_000_000 },
  ],
  unpushedTruncated: false,
  lineStats: [{ relativePath: "src/a.ts", added: 3, deleted: null }],
  lineStatsTruncated: false,
  localBranches: ["feat/x", "main"],
  remoteBranches: ["origin/main"],
  worktreeBranches: ["fix/payments"],
  branchesTruncated: false,
};

describe("parseGitSurfaceStatus", () => {
  it("parses the Rust wire shape", () => {
    expect(parseGitSurfaceStatus(wire)).toEqual(wire);
  });

  it("rejects unknown keys, bad shas and oversized lists", () => {
    expect(() => parseGitSurfaceStatus({ ...wire, extra: 1 })).toThrow();
    expect(() => parseGitSurfaceStatus({ ...wire, unpushed: [{ ...wire.unpushed[0], sha: "zz" }] })).toThrow();
    expect(() =>
      parseGitSurfaceStatus({ ...wire, localBranches: Array.from({ length: 201 }, (_, i) => `b${i}`) }),
    ).toThrow();
  });
});
```

Create `src/domain/gitBranchDiff.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseGitBranchChanges, parseGitBranchFileSides, validateGitBaseRef } from "./gitBranchDiff";

describe("git branch diff wire", () => {
  it("parses changes and sides", () => {
    const changes = {
      mergeBase: "b".repeat(40),
      files: [{ relativePath: "a.ts", oldRelativePath: null, status: "modified", added: 1, deleted: 2 }],
      truncated: false,
    };
    expect(parseGitBranchChanges(changes)).toEqual(changes);
    const sides = {
      original: { text: "a", truncated: false },
      modified: { text: "b", truncated: false },
      unavailableReason: null,
    };
    expect(parseGitBranchFileSides(sides)).toEqual(sides);
  });

  it("rejects unknown statuses and reasons", () => {
    expect(() =>
      parseGitBranchChanges({
        mergeBase: "b".repeat(40),
        files: [{ relativePath: "a", oldRelativePath: null, status: "exploded", added: null, deleted: null }],
        truncated: false,
      }),
    ).toThrow();
    expect(() =>
      parseGitBranchFileSides({
        original: { text: "", truncated: false },
        modified: { text: "", truncated: false },
        unavailableReason: "huge",
      }),
    ).toThrow();
  });

  it("validates base refs like the Rust side", () => {
    expect(validateGitBaseRef("origin/release/1.4")).toBe("origin/release/1.4");
    for (const bad of ["", "--help", "a..b", "main ", "x@{1}", "a:b", "/main", "main/", "x".repeat(257)]) {
      expect(() => validateGitBaseRef(bad), bad).toThrow();
    }
  });
});
```

Create `src/infrastructure/tauriGitSurfaceIpcContract.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  GET_GIT_BRANCH_CHANGES_IPC_COMMAND,
  GET_GIT_SURFACE_STATUS_IPC_COMMAND,
  invokeGetGitBranchChangesIpc,
  invokeGetGitSurfaceStatusIpc,
  validateGitBranchFileDiffRequest,
  validateGitSurfaceTargetRequest,
} from "./tauriGitSurfaceIpcContract";

describe("git surface IPC contract", () => {
  it("sends exactly the validated request under the documented command", async () => {
    const calls: Array<{ command: string; args: unknown }> = [];
    await invokeGetGitSurfaceStatusIpc(
      async (command, args) => {
        calls.push({ command, args });
        return {
          branch: null,
          defaultBase: null,
          hasRemote: false,
          upstream: null,
          unpushed: [],
          unpushedTruncated: false,
          lineStats: [],
          lineStatsTruncated: false,
          localBranches: [],
          remoteBranches: [],
          worktreeBranches: [],
          branchesTruncated: false,
        };
      },
      { repositoryRoot: "/repo", worktreePath: null },
    );
    expect(calls).toEqual([
      {
        command: GET_GIT_SURFACE_STATUS_IPC_COMMAND,
        args: { request: { repositoryRoot: "/repo", worktreePath: null } },
      },
    ]);
  });

  it("rejects relative roots and hostile paths before invoking", () => {
    expect(() => validateGitSurfaceTargetRequest({ repositoryRoot: "repo", worktreePath: null })).toThrow();
    expect(() =>
      validateGitBranchFileDiffRequest({
        repositoryRoot: "/repo",
        worktreePath: null,
        mergeBase: "c".repeat(40),
        relativePath: "../secret",
        oldRelativePath: null,
      }),
    ).toThrow();
  });

  it("rejects an invalid base ref without invoking", async () => {
    let invoked = false;
    await expect(
      invokeGetGitBranchChangesIpc(
        async () => {
          invoked = true;
          return null;
        },
        { repositoryRoot: "/repo", worktreePath: null, baseRef: "--output=/tmp/x" },
      ),
    ).rejects.toThrow();
    expect(invoked).toBe(false);
    expect(GET_GIT_BRANCH_CHANGES_IPC_COMMAND).toBe("get_git_branch_changes");
  });
});
```

- [ ] **Step 7: Implement the TS wire modules**

Create `src/domain/wireValue.ts`:

```ts
const encoder = new TextEncoder();

export function wireRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid(path, "an object");
  return value as Record<string, unknown>;
}

export function wireExactRecord(
  value: unknown,
  keys: ReadonlyArray<string>,
  path: string,
): Record<string, unknown> {
  const record = wireRecord(value, path);
  const actual = Object.keys(record);
  if (actual.length !== keys.length || !keys.every((key) => Object.prototype.hasOwnProperty.call(record, key))) {
    invalid(path, `exactly the keys ${keys.join(", ")}`);
  }
  return record;
}

export function wireString(value: unknown, path: string, maxBytes: number): string {
  if (typeof value !== "string" || encoder.encode(value).length > maxBytes) {
    invalid(path, `a string of at most ${maxBytes} bytes`);
  }
  return value;
}

export function wireNullableString(value: unknown, path: string, maxBytes: number): string | null {
  if (value === null) return null;
  return wireString(value, path, maxBytes);
}

export function wireCount(value: unknown, path: string, maximum: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > maximum) {
    invalid(path, `an integer between 0 and ${maximum}`);
  }
  return value;
}

export function wireNullableCount(value: unknown, path: string, maximum: number): number | null {
  if (value === null) return null;
  return wireCount(value, path, maximum);
}

export function wireBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") invalid(path, "a boolean");
  return value;
}

export function wireArray(value: unknown, path: string, maxItems: number): ReadonlyArray<unknown> {
  if (!Array.isArray(value) || value.length > maxItems) invalid(path, `an array of at most ${maxItems} items`);
  return value;
}

export function wireStringArray(
  value: unknown,
  path: string,
  maxItems: number,
  maxBytes: number,
): ReadonlyArray<string> {
  return wireArray(value, path, maxItems).map((item, index) => wireString(item, `${path}[${index}]`, maxBytes));
}

export function wireEnum<T extends string>(value: unknown, path: string, allowed: ReadonlyArray<T>): T {
  if (typeof value !== "string" || !(allowed as ReadonlyArray<string>).includes(value)) {
    invalid(path, `one of ${allowed.join(", ")}`);
  }
  return value as T;
}

export function wireAbsolutePath(value: unknown, path: string): string {
  const text = wireString(value, path, 4_096);
  if (!text.startsWith("/") || text.includes("\u0000")) invalid(path, "an absolute path");
  return text;
}

export function wireRelativePath(value: unknown, path: string): string {
  const text = wireString(value, path, 4_096);
  const segments = text.split("/");
  if (
    text.length === 0 ||
    text.startsWith("/") ||
    /[\u0000-\u001f\u007f]/.test(text) ||
    segments.some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    invalid(path, "a repository-relative path");
  }
  return text;
}

export function wireObjectId(value: unknown, path: string): string {
  const text = wireString(value, path, 64);
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(text)) invalid(path, "a git object id");
  return text;
}

function invalid(path: string, expectation: string): never {
  throw new TypeError(`Invalid ${path}: expected ${expectation}.`);
}
```

(The regex uses `\u0000` escapes, never a literal NUL byte.)

Create `src/domain/gitSurfaceStatus.ts`:

```ts
import {
  wireArray,
  wireBoolean,
  wireCount,
  wireExactRecord,
  wireNullableCount,
  wireNullableString,
  wireObjectId,
  wireRelativePath,
  wireString,
  wireStringArray,
} from "./wireValue";

export const MAX_GIT_SURFACE_UNPUSHED = 20;
export const MAX_GIT_SURFACE_LINE_STATS = 2_000;
export const MAX_GIT_SURFACE_BRANCHES = 200;
export const MAX_GIT_SURFACE_WORKTREE_BRANCHES = 64;
const MAX_REF_BYTES = 512;
const MAX_COUNT = 1_000_000;

export interface GitSurfaceTarget {
  readonly repositoryRoot: string;
  readonly worktreePath: string | null;
}

export interface GitUnpushedCommit {
  readonly sha: string;
  readonly shortSha: string;
  readonly subject: string;
  readonly authoredAtEpochSeconds: number;
}

export interface GitLineStat {
  readonly relativePath: string;
  readonly added: number | null;
  readonly deleted: number | null;
}

export interface GitSurfaceStatus {
  readonly branch: string | null;
  readonly defaultBase: string | null;
  readonly hasRemote: boolean;
  readonly upstream: { readonly name: string; readonly ahead: number; readonly behind: number } | null;
  readonly unpushed: ReadonlyArray<GitUnpushedCommit>;
  readonly unpushedTruncated: boolean;
  readonly lineStats: ReadonlyArray<GitLineStat>;
  readonly lineStatsTruncated: boolean;
  readonly localBranches: ReadonlyArray<string>;
  readonly remoteBranches: ReadonlyArray<string>;
  readonly worktreeBranches: ReadonlyArray<string>;
  readonly branchesTruncated: boolean;
}

export interface GitSurfaceStatusGateway {
  getSurfaceStatus(target: GitSurfaceTarget): Promise<GitSurfaceStatus>;
}

const STATUS_KEYS = [
  "branch",
  "defaultBase",
  "hasRemote",
  "upstream",
  "unpushed",
  "unpushedTruncated",
  "lineStats",
  "lineStatsTruncated",
  "localBranches",
  "remoteBranches",
  "worktreeBranches",
  "branchesTruncated",
] as const;

export function parseGitSurfaceStatus(value: unknown, path = "gitSurfaceStatus"): GitSurfaceStatus {
  const record = wireExactRecord(value, STATUS_KEYS, path);
  return {
    branch: wireNullableString(record.branch, `${path}.branch`, MAX_REF_BYTES),
    defaultBase: wireNullableString(record.defaultBase, `${path}.defaultBase`, MAX_REF_BYTES),
    hasRemote: wireBoolean(record.hasRemote, `${path}.hasRemote`),
    upstream: parseUpstream(record.upstream, `${path}.upstream`),
    unpushed: wireArray(record.unpushed, `${path}.unpushed`, MAX_GIT_SURFACE_UNPUSHED).map((item, index) =>
      parseCommit(item, `${path}.unpushed[${index}]`),
    ),
    unpushedTruncated: wireBoolean(record.unpushedTruncated, `${path}.unpushedTruncated`),
    lineStats: wireArray(record.lineStats, `${path}.lineStats`, MAX_GIT_SURFACE_LINE_STATS).map((item, index) =>
      parseLineStat(item, `${path}.lineStats[${index}]`),
    ),
    lineStatsTruncated: wireBoolean(record.lineStatsTruncated, `${path}.lineStatsTruncated`),
    localBranches: wireStringArray(record.localBranches, `${path}.localBranches`, MAX_GIT_SURFACE_BRANCHES, MAX_REF_BYTES),
    remoteBranches: wireStringArray(record.remoteBranches, `${path}.remoteBranches`, MAX_GIT_SURFACE_BRANCHES, MAX_REF_BYTES),
    worktreeBranches: wireStringArray(
      record.worktreeBranches,
      `${path}.worktreeBranches`,
      MAX_GIT_SURFACE_WORKTREE_BRANCHES,
      MAX_REF_BYTES,
    ),
    branchesTruncated: wireBoolean(record.branchesTruncated, `${path}.branchesTruncated`),
  };
}

function parseUpstream(value: unknown, path: string): GitSurfaceStatus["upstream"] {
  if (value === null) return null;
  const record = wireExactRecord(value, ["name", "ahead", "behind"], path);
  return {
    name: wireString(record.name, `${path}.name`, MAX_REF_BYTES),
    ahead: wireCount(record.ahead, `${path}.ahead`, MAX_COUNT),
    behind: wireCount(record.behind, `${path}.behind`, MAX_COUNT),
  };
}

function parseCommit(value: unknown, path: string): GitUnpushedCommit {
  const record = wireExactRecord(value, ["sha", "shortSha", "subject", "authoredAtEpochSeconds"], path);
  return {
    sha: wireObjectId(record.sha, `${path}.sha`),
    shortSha: wireString(record.shortSha, `${path}.shortSha`, 12),
    subject: wireString(record.subject, `${path}.subject`, 200),
    authoredAtEpochSeconds: wireCount(record.authoredAtEpochSeconds, `${path}.authoredAtEpochSeconds`, Number.MAX_SAFE_INTEGER),
  };
}

function parseLineStat(value: unknown, path: string): GitLineStat {
  const record = wireExactRecord(value, ["relativePath", "added", "deleted"], path);
  return {
    relativePath: wireRelativePath(record.relativePath, `${path}.relativePath`),
    added: wireNullableCount(record.added, `${path}.added`, MAX_COUNT * 100),
    deleted: wireNullableCount(record.deleted, `${path}.deleted`, MAX_COUNT * 100),
  };
}
```

Create `src/domain/gitBranchDiff.ts`:

```ts
import type { GitChangeStatus } from "./git";
import {
  wireArray,
  wireBoolean,
  wireEnum,
  wireExactRecord,
  wireNullableCount,
  wireObjectId,
  wireRelativePath,
  wireString,
} from "./wireValue";

export const MAX_GIT_BRANCH_DIFF_FILES = 500;
export const MAX_GIT_BRANCH_DIFF_SIDE_BYTES = 128 * 1024;
export const MAX_GIT_BASE_REF_BYTES = 256;

const BRANCH_STATUSES = ["added", "deleted", "modified", "renamed"] as const;
const UNAVAILABLE_REASONS = ["binary", "large"] as const;

export interface GitBranchChangesRequest {
  readonly repositoryRoot: string;
  readonly worktreePath: string | null;
  readonly baseRef: string;
}

export interface GitBranchFileSidesRequest {
  readonly repositoryRoot: string;
  readonly worktreePath: string | null;
  readonly mergeBase: string;
  readonly relativePath: string;
  readonly oldRelativePath: string | null;
}

export interface GitBranchChangedFile {
  readonly relativePath: string;
  readonly oldRelativePath: string | null;
  readonly status: Extract<GitChangeStatus, (typeof BRANCH_STATUSES)[number]>;
  readonly added: number | null;
  readonly deleted: number | null;
}

export interface GitBranchChanges {
  readonly mergeBase: string;
  readonly files: ReadonlyArray<GitBranchChangedFile>;
  readonly truncated: boolean;
}

export interface GitBranchFileSides {
  readonly original: { readonly text: string; readonly truncated: boolean };
  readonly modified: { readonly text: string; readonly truncated: boolean };
  readonly unavailableReason: (typeof UNAVAILABLE_REASONS)[number] | null;
}

export interface GitBranchDiffGateway {
  getBranchChanges(request: GitBranchChangesRequest): Promise<GitBranchChanges>;
  getBranchFileSides(request: GitBranchFileSidesRequest): Promise<GitBranchFileSides>;
}

export function validateGitBaseRef(value: unknown): string {
  const text = wireString(value, "baseRef", MAX_GIT_BASE_REF_BYTES);
  const invalid =
    text.length === 0 ||
    text.startsWith("-") ||
    text.startsWith("/") ||
    text.endsWith("/") ||
    text.endsWith(".lock") ||
    text.includes("..") ||
    text.includes("@{") ||
    /[\s\u0000-\u001f\u007f~^:?*[\\]/.test(text);
  if (invalid) throw new TypeError("Invalid baseRef: expected a branch name.");
  return text;
}

export function parseGitBranchChanges(value: unknown, path = "branchChanges"): GitBranchChanges {
  const record = wireExactRecord(value, ["mergeBase", "files", "truncated"], path);
  return {
    mergeBase: wireObjectId(record.mergeBase, `${path}.mergeBase`),
    files: wireArray(record.files, `${path}.files`, MAX_GIT_BRANCH_DIFF_FILES).map((item, index) => {
      const file = wireExactRecord(item, ["relativePath", "oldRelativePath", "status", "added", "deleted"], `${path}.files[${index}]`);
      return {
        relativePath: wireRelativePath(file.relativePath, `${path}.files[${index}].relativePath`),
        oldRelativePath:
          file.oldRelativePath === null
            ? null
            : wireRelativePath(file.oldRelativePath, `${path}.files[${index}].oldRelativePath`),
        status: wireEnum(file.status, `${path}.files[${index}].status`, BRANCH_STATUSES),
        added: wireNullableCount(file.added, `${path}.files[${index}].added`, 100_000_000),
        deleted: wireNullableCount(file.deleted, `${path}.files[${index}].deleted`, 100_000_000),
      };
    }),
    truncated: wireBoolean(record.truncated, `${path}.truncated`),
  };
}

export function parseGitBranchFileSides(value: unknown, path = "branchFileSides"): GitBranchFileSides {
  const record = wireExactRecord(value, ["original", "modified", "unavailableReason"], path);
  return {
    original: parseSide(record.original, `${path}.original`),
    modified: parseSide(record.modified, `${path}.modified`),
    unavailableReason:
      record.unavailableReason === null
        ? null
        : wireEnum(record.unavailableReason, `${path}.unavailableReason`, UNAVAILABLE_REASONS),
  };
}

function parseSide(value: unknown, path: string): GitBranchFileSides["original"] {
  const record = wireExactRecord(value, ["text", "truncated"], path);
  return {
    text: wireString(record.text, `${path}.text`, MAX_GIT_BRANCH_DIFF_SIDE_BYTES * 3),
    truncated: wireBoolean(record.truncated, `${path}.truncated`),
  };
}
```

(`MAX_GIT_BRANCH_DIFF_SIDE_BYTES * 3` accounts for lossy UTF-8 replacement growth of a 128 KB side.)

Create `src/infrastructure/tauriGitSurfaceIpcContract.ts`:

```ts
import {
  parseGitBranchChanges,
  parseGitBranchFileSides,
  validateGitBaseRef,
  type GitBranchChanges,
  type GitBranchChangesRequest,
  type GitBranchFileSides,
  type GitBranchFileSidesRequest,
} from "../domain/gitBranchDiff";
import { parseGitSurfaceStatus, type GitSurfaceStatus, type GitSurfaceTarget } from "../domain/gitSurfaceStatus";
import { wireAbsolutePath, wireObjectId, wireRelativePath } from "../domain/wireValue";

export const GET_GIT_SURFACE_STATUS_IPC_COMMAND = "get_git_surface_status" as const;
export const GET_GIT_BRANCH_CHANGES_IPC_COMMAND = "get_git_branch_changes" as const;
export const GET_GIT_BRANCH_FILE_DIFF_IPC_COMMAND = "get_git_branch_file_diff" as const;

export type InvokeGitSurfaceCommand = (command: string, args: Readonly<Record<string, unknown>>) => Promise<unknown>;

export function validateGitSurfaceTargetRequest(request: GitSurfaceTarget): GitSurfaceTarget {
  return {
    repositoryRoot: wireAbsolutePath(request.repositoryRoot, "request.repositoryRoot"),
    worktreePath:
      request.worktreePath === null ? null : wireAbsolutePath(request.worktreePath, "request.worktreePath"),
  };
}

export function validateGitBranchChangesRequest(request: GitBranchChangesRequest): GitBranchChangesRequest {
  return { ...validateGitSurfaceTargetRequest(request), baseRef: validateGitBaseRef(request.baseRef) };
}

export function validateGitBranchFileDiffRequest(request: GitBranchFileSidesRequest): GitBranchFileSidesRequest {
  return {
    ...validateGitSurfaceTargetRequest(request),
    mergeBase: wireObjectId(request.mergeBase, "request.mergeBase"),
    relativePath: wireRelativePath(request.relativePath, "request.relativePath"),
    oldRelativePath:
      request.oldRelativePath === null ? null : wireRelativePath(request.oldRelativePath, "request.oldRelativePath"),
  };
}

export async function invokeGetGitSurfaceStatusIpc(
  invoke: InvokeGitSurfaceCommand,
  request: GitSurfaceTarget,
): Promise<GitSurfaceStatus> {
  const validated = validateGitSurfaceTargetRequest(request);
  return parseGitSurfaceStatus(await invoke(GET_GIT_SURFACE_STATUS_IPC_COMMAND, { request: validated }));
}

export async function invokeGetGitBranchChangesIpc(
  invoke: InvokeGitSurfaceCommand,
  request: GitBranchChangesRequest,
): Promise<GitBranchChanges> {
  const validated = validateGitBranchChangesRequest(request);
  return parseGitBranchChanges(await invoke(GET_GIT_BRANCH_CHANGES_IPC_COMMAND, { request: validated }));
}

export async function invokeGetGitBranchFileDiffIpc(
  invoke: InvokeGitSurfaceCommand,
  request: GitBranchFileSidesRequest,
): Promise<GitBranchFileSides> {
  const validated = validateGitBranchFileDiffRequest(request);
  return parseGitBranchFileSides(await invoke(GET_GIT_BRANCH_FILE_DIFF_IPC_COMMAND, { request: validated }));
}
```

The request objects are rebuilt from known fields only, so an extra property on the caller's object never reaches Rust.

Create `src/infrastructure/tauriGitSurfaceGateway.ts`:

```ts
import { invoke } from "@tauri-apps/api/core";
import type { GitBranchChangesRequest, GitBranchDiffGateway, GitBranchFileSidesRequest } from "../domain/gitBranchDiff";
import type { GitSurfaceStatusGateway, GitSurfaceTarget } from "../domain/gitSurfaceStatus";
import {
  invokeGetGitBranchChangesIpc,
  invokeGetGitBranchFileDiffIpc,
  invokeGetGitSurfaceStatusIpc,
  type InvokeGitSurfaceCommand,
} from "./tauriGitSurfaceIpcContract";

const invokeCommand: InvokeGitSurfaceCommand = (command, args) => invoke<unknown>(command, args);

export class TauriGitSurfaceGateway implements GitSurfaceStatusGateway, GitBranchDiffGateway {
  constructor(private readonly invokeGitSurface: InvokeGitSurfaceCommand = invokeCommand) {}

  getSurfaceStatus(target: GitSurfaceTarget) {
    return invokeGetGitSurfaceStatusIpc(this.invokeGitSurface, target);
  }

  getBranchChanges(request: GitBranchChangesRequest) {
    return invokeGetGitBranchChangesIpc(this.invokeGitSurface, request);
  }

  getBranchFileSides(request: GitBranchFileSidesRequest) {
    return invokeGetGitBranchFileDiffIpc(this.invokeGitSurface, request);
  }
}
```

If `src/infrastructure/tauriIpcContractArchitecture.test.ts` enforces a registry of command constants or a naming rule, add the three constants to it in the same way the git integration constants are registered.

Run: `npx vitest run src/domain/wireValue.test.ts src/domain/gitSurfaceStatus.test.ts src/domain/gitBranchDiff.test.ts src/infrastructure/tauriGitSurfaceIpcContract.test.ts src/infrastructure/tauriIpcContractArchitecture.test.ts`
Expected: PASS.

- [ ] **Step 8: Branch diff source + status hook (tests first)**

Create `src/application/rightPanel/agentBranchDiffSource.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { GitBranchDiffGateway, GitBranchFileSidesRequest } from "../../domain/gitBranchDiff";
import { branchDiffSource } from "./agentBranchDiffSource";

describe("branchDiffSource", () => {
  it("lists branch files and reads sides against the merge base it listed", async () => {
    const reads: GitBranchFileSidesRequest[] = [];
    const gateway: GitBranchDiffGateway = {
      getBranchChanges: async () => ({
        mergeBase: "d".repeat(40),
        files: [{ relativePath: "new.ts", oldRelativePath: "old.ts", status: "renamed", added: 1, deleted: 0 }],
        truncated: false,
      }),
      getBranchFileSides: async (request) => {
        reads.push(request);
        return {
          original: { text: "a", truncated: false },
          modified: { text: "b", truncated: false },
          unavailableReason: null,
        };
      },
    };
    const source = branchDiffSource({ repositoryRoot: "/repo", worktreePath: "/repo/.worktrees/t", baseRef: "main", revision: 0, gateway });

    const list = await source.listFiles();
    const first = list.files[0];
    if (first === undefined) {
      expect(list.files).toHaveLength(1);
      return;
    }
    await source.readSides(first);

    expect(first).toMatchObject({ displayPath: "new.ts", oldRelativePath: "old.ts", status: "renamed" });
    expect(reads).toEqual([
      {
        repositoryRoot: "/repo",
        worktreePath: "/repo/.worktrees/t",
        mergeBase: "d".repeat(40),
        relativePath: "new.ts",
        oldRelativePath: "old.ts",
      },
    ]);
  });

  it("reports a missing merge base as unavailable", async () => {
    const source = branchDiffSource({
      repositoryRoot: "/repo",
      worktreePath: null,
      baseRef: "orphan",
      revision: 0,
      gateway: {
        getBranchChanges: () => Promise.reject(new Error("orphan has no common history with this branch.")),
        getBranchFileSides: () => Promise.reject(new Error("unused")),
      },
    });
    await expect(source.listFiles()).resolves.toEqual({
      files: [],
      truncated: false,
      unavailableReason: "orphan has no common history with this branch.",
    });
  });
});
```

Create `src/application/rightPanel/agentBranchDiffSource.ts`:

```ts
import type { GitBranchDiffGateway } from "../../domain/gitBranchDiff";
import type { AgentDiffSource } from "./agentDiffSources";

export interface BranchDiffSourceInput {
  readonly repositoryRoot: string;
  readonly worktreePath: string | null;
  readonly baseRef: string;
  readonly revision: number;
  readonly gateway: GitBranchDiffGateway;
}

export function branchDiffSource(input: BranchDiffSourceInput): AgentDiffSource {
  let mergeBase: string | null = null;
  return {
    key: JSON.stringify(["branch", input.repositoryRoot, input.worktreePath, input.baseRef, input.revision]),
    async listFiles() {
      try {
        const changes = await input.gateway.getBranchChanges({
          repositoryRoot: input.repositoryRoot,
          worktreePath: input.worktreePath,
          baseRef: input.baseRef,
        });
        mergeBase = changes.mergeBase;
        return {
          files: changes.files.map((file) => ({
            repositoryRoot: input.worktreePath ?? input.repositoryRoot,
            relativePath: file.relativePath,
            displayPath: file.relativePath,
            oldRelativePath: file.oldRelativePath,
            status: file.status,
            added: file.added,
            deleted: file.deleted,
          })),
          truncated: changes.truncated,
          unavailableReason: null,
        };
      } catch (error) {
        return {
          files: [],
          truncated: false,
          unavailableReason: error instanceof Error ? error.message : "Branch changes are unavailable.",
        };
      }
    },
    async readSides(file) {
      if (mergeBase === null) return { original: "", modified: "", truncated: false, unavailableReason: "missing" };
      const sides = await input.gateway.getBranchFileSides({
        repositoryRoot: input.repositoryRoot,
        worktreePath: input.worktreePath,
        mergeBase,
        relativePath: file.relativePath,
        oldRelativePath: file.oldRelativePath,
      });
      return {
        original: sides.original.text,
        modified: sides.modified.text,
        truncated: sides.original.truncated || sides.modified.truncated,
        unavailableReason: sides.unavailableReason,
      };
    },
  };
}
```

Create `src/application/rightPanel/useGitSurfaceStatus.test.tsx` covering:
- (a) `enabled: false` stays `idle` and never calls the gateway;
- (b) a load resolves to `ready`;
- (c) switching the target while the first request is pending shows only the second result (deferred promises as in Task 5);
- (d) `refresh()` reloads and keeps the previous value visible while loading (`gitSurfaceStatusValue(load)` returns the previous status during `loading`);
- (e) a rejected load becomes `failed` with the message.

Use an in-memory `GitSurfaceStatusGateway` object returning fixture statuses (the Rust boundary is the only fake).

Create `src/application/rightPanel/useGitSurfaceStatus.ts`:

```ts
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GitSurfaceStatus, GitSurfaceStatusGateway, GitSurfaceTarget } from "../../domain/gitSurfaceStatus";
import { useLatest } from "../../ui/foundation/useLatest";

export type GitSurfaceStatusLoad =
  | { readonly kind: "idle" }
  | { readonly kind: "loading"; readonly previous: GitSurfaceStatus | null }
  | { readonly kind: "ready"; readonly status: GitSurfaceStatus }
  | { readonly kind: "failed"; readonly message: string; readonly previous: GitSurfaceStatus | null };

export interface GitSurfaceStatusSnapshot {
  readonly load: GitSurfaceStatusLoad;
  refresh(): void;
}

export interface UseGitSurfaceStatusOptions {
  readonly gateway: GitSurfaceStatusGateway | null;
  readonly target: GitSurfaceTarget | null;
  readonly enabled: boolean;
}

const IDLE: GitSurfaceStatusLoad = { kind: "idle" };

export function gitSurfaceStatusValue(load: GitSurfaceStatusLoad): GitSurfaceStatus | null {
  switch (load.kind) {
    case "idle":
      return null;
    case "loading":
      return load.previous;
    case "ready":
      return load.status;
    case "failed":
      return load.previous;
  }
}

export function useGitSurfaceStatus({ enabled, gateway, target }: UseGitSurfaceStatusOptions): GitSurfaceStatusSnapshot {
  const targetKey = target === null ? null : JSON.stringify([target.repositoryRoot, target.worktreePath]);
  const [state, setState] = useState<{ readonly key: string | null; readonly load: GitSurfaceStatusLoad }>({
    key: null,
    load: IDLE,
  });
  const [nonce, setNonce] = useState(0);
  const generation = useRef(0);
  const gatewayRef = useLatest(gateway);
  const targetRef = useLatest(target);

  useEffect(() => {
    generation.current += 1;
    const current = generation.current;
    const activeGateway = gatewayRef.current;
    const activeTarget = targetRef.current;
    if (!enabled || activeGateway === null || activeTarget === null || targetKey === null) {
      setState({ key: targetKey, load: IDLE });
      return;
    }
    setState((previous) => ({
      key: targetKey,
      load: { kind: "loading", previous: previous.key === targetKey ? gitSurfaceStatusValue(previous.load) : null },
    }));
    activeGateway.getSurfaceStatus(activeTarget).then(
      (status) => {
        if (generation.current !== current) return;
        setState({ key: targetKey, load: { kind: "ready", status } });
      },
      (error: unknown) => {
        if (generation.current !== current) return;
        setState((previous) => ({
          key: targetKey,
          load: {
            kind: "failed",
            message: error instanceof Error ? error.message : "Git status is unavailable.",
            previous: previous.key === targetKey ? gitSurfaceStatusValue(previous.load) : null,
          },
        }));
      },
    );
  }, [enabled, gatewayRef, nonce, targetKey, targetRef]);

  const refresh = useCallback(() => setNonce((value) => value + 1), []);
  const load = state.key === targetKey ? state.load : IDLE;
  return useMemo(() => ({ load, refresh }), [load, refresh]);
}
```

Run: `npx vitest run src/application/rightPanel`
Expected: PASS.

- [ ] **Step 9: Gateways bag and chrome**

Create `src/components/agentMode/rightPanel/agentRightPanelGateways.ts`:

```ts
import type { DiffViewComputationGateway } from "../../../application/diffViewComputation";
import type { GitGateway, GitStatus } from "../../../domain/git";
import type { GitBranchDiffGateway } from "../../../domain/gitBranchDiff";
import type { GitSurfaceStatusGateway } from "../../../domain/gitSurfaceStatus";
import type { FileSearchGateway } from "../../../domain/workspace";
import { BrowserDiffViewGateway } from "../../../infrastructure/browserDiffViewGateway";
import { TauriGitGateway } from "../../../infrastructure/tauriGitGateway";
import { TauriGitSurfaceGateway } from "../../../infrastructure/tauriGitSurfaceGateway";
import { TauriWorkspaceGateway } from "../../../infrastructure/tauriWorkspaceGateway";

export interface AgentRightPanelGateways {
  readonly git: Pick<
    GitGateway,
    "getStatus" | "getDiff" | "stageFiles" | "commit" | "push" | "createBranch" | "switchBranch"
  > & { fetch(rootPath: string): Promise<GitStatus> };
  readonly surfaceStatus: GitSurfaceStatusGateway;
  readonly branchDiff: GitBranchDiffGateway;
  readonly diffComputation: DiffViewComputationGateway;
  readonly fileSearch: FileSearchGateway;
}

export function createDefaultAgentRightPanelGateways(): AgentRightPanelGateways {
  const surface = new TauriGitSurfaceGateway();
  return {
    git: new TauriGitGateway(),
    surfaceStatus: surface,
    branchDiff: surface,
    diffComputation: new BrowserDiffViewGateway(),
    fileSearch: new TauriWorkspaceGateway(),
  };
}
```

`BrowserDiffViewGateway` creates its worker lazily on the first `compute`, so constructing the default bag has no side effect. `TauriWorkspaceGateway`'s constructor argument is optional; confirm `searchFiles` works without it.

Create `src/components/agentMode/rightPanel/useAgentRightPanelChrome.ts`:

```ts
import { useMemo } from "react";
import type { WorkingTreeRepository } from "../../../application/rightPanel/agentDiffSources";
import type { GitRepositoryStatus } from "../../../domain/gitRepositoryMapping";
import type { TextClipboardGateway } from "../../../domain/textClipboard";
import type { AgentRightPanelGateways } from "./agentRightPanelGateways";

export interface AgentRightPanelChrome {
  readonly gateways: AgentRightPanelGateways;
  readonly projectRepositories: ReadonlyArray<WorkingTreeRepository>;
  copyText(text: string): Promise<void>;
}

export interface AgentRightPanelChromeInput {
  readonly gateways: AgentRightPanelGateways;
  readonly workspaceRoot: string | null;
  readonly repositoryStatuses: ReadonlyArray<GitRepositoryStatus> | null | undefined;
  readonly clipboard: TextClipboardGateway;
}

export function useAgentRightPanelChrome({
  clipboard,
  gateways,
  repositoryStatuses,
  workspaceRoot,
}: AgentRightPanelChromeInput): AgentRightPanelChrome | null {
  return useMemo(() => {
    if (workspaceRoot === null) return null;
    return {
      gateways,
      projectRepositories: projectRepositories(workspaceRoot, repositoryStatuses ?? []),
      copyText: (text: string) => clipboard.writeText(text),
    };
  }, [clipboard, gateways, repositoryStatuses, workspaceRoot]);
}

function projectRepositories(
  workspaceRoot: string,
  statuses: ReadonlyArray<GitRepositoryStatus>,
): ReadonlyArray<WorkingTreeRepository> {
  const roots = statuses.filter((status) => !status.failed).map((status) => status.root);
  const unique = roots.length === 0 ? [workspaceRoot] : [...new Set(roots)];
  return unique.map((root) => ({
    root,
    prefix: root === workspaceRoot || !root.startsWith(`${workspaceRoot}/`) ? "" : `${root.slice(workspaceRoot.length + 1)}/`,
  }));
}
```

If `workbench.gitRepositoryStatuses` has a different element type, adapt the parameter type to it (it is the value `useAgentProjectDiffChrome` consumed).

Integration:
- `agentWorkbenchChrome.ts`: add `readonly rightPanel?: AgentRightPanelChrome | null;` to `AgentWorkbenchChrome`.
- `AgentWorkbenchScreen.tsx`:
  - add the prop `readonly rightPanelGateways?: AgentRightPanelGateways;` with the module-level default `const DEFAULT_RIGHT_PANEL_GATEWAYS = createDefaultAgentRightPanelGateways();`;
  - call `const rightPanel = useAgentRightPanelChrome({ gateways: rightPanelGateways, workspaceRoot: workbench.workspaceRoot, repositoryStatuses: workbench.gitRepositoryStatuses, clipboard: textClipboard });`;
  - add `rightPanel` to the chrome memo (field and deps).
  - Do not touch `App.tsx`.

- [ ] **Step 10: Right-panel context and host provider**

Create `src/components/agentMode/rightPanel/agentRightPanelContext.ts`:

```ts
import { createContext, useContext } from "react";
import type { AgentThreadView } from "../../../application/agentThreadPorts";
import type { GitSurfaceStatusSnapshot } from "../../../application/rightPanel/useGitSurfaceStatus";
import type { AgentSurfaceKind } from "../../../domain/agentWorkbenchLayout";
import type { AgentDiffScope } from "../../../domain/diffView/agentDiffScope";
import type { GitSurfaceTarget } from "../../../domain/gitSurfaceStatus";
import type { AgentSurfaceDiffProps } from "../AgentSurfaceDiff";
import type { AgentSurfaceHostAgents } from "../AgentSurfaceHost";
import type { AgentShipActions } from "../AgentShipPanel";
import type { AgentSurfaceScope } from "../agentSurfacePolicy";
import type { AgentRightPanelChrome } from "./useAgentRightPanelChrome";

export interface AgentRightPanelContextValue {
  readonly thread: AgentThreadView | null;
  readonly scope: AgentSurfaceScope;
  readonly workspaceRoot: string | null;
  readonly workspaceTrusted: boolean;
  readonly target: GitSurfaceTarget | null;
  readonly checkoutRoot: string | null;
  readonly chrome: AgentRightPanelChrome | null;
  readonly gitStatus: GitSurfaceStatusSnapshot;
  readonly agents: AgentSurfaceHostAgents;
  readonly shipActions: AgentShipActions | null;
  readonly diffScope: AgentDiffScope;
  readonly legacyWorkingTreeDiff: Omit<AgentSurfaceDiffProps, "thread"> | null;
  onDiffScopeChange(scope: AgentDiffScope): void;
  openSurface(kind: AgentSurfaceKind): void;
  closeSurface(kind: AgentSurfaceKind): void;
  openFile(absolutePath: string): void;
  previewFile(absolutePath: string): void;
  revealPath(path: string): Promise<void>;
  copyText(text: string): Promise<void>;
}

export const AgentRightPanelContext = createContext<AgentRightPanelContextValue | null>(null);

export function useAgentRightPanelContext(): AgentRightPanelContextValue {
  const value = useContext(AgentRightPanelContext);
  if (value === null) throw new Error("Right panel surfaces must render inside AgentSurfaceHost.");
  return value;
}
```

`AgentShipActions` still lives in `AgentShipPanel.tsx` at this point. Task 11 moves it to `useAgentShipActions.ts` and updates this import (one-line hunk, owned by Task 11).

In `AgentSurfaceHost.tsx` (integration):
- Add the props:

```ts
  readonly diffScope?: AgentDiffScope;
  onDiffScopeChange?(scope: AgentDiffScope): void;
  readonly shipActions?: AgentShipActions | null;
```

- Compute the target:

```ts
const target = useMemo<GitSurfaceTarget | null>(() => {
  if (!available) return null;
  if (thread !== null)
    return { repositoryRoot: thread.thread.owner.repositoryRoot, worktreePath: thread.thread.target.worktreePath };
  if (scope.kind !== "repository") return null;
  return { repositoryRoot: scope.repositoryRoot, worktreePath: null };
}, [available, scope, thread]);
const gitStatus = useGitSurfaceStatus({
  gateway: chrome.rightPanel?.gateways.surfaceStatus ?? null,
  target,
  enabled:
    !hidden &&
    workspaceTrustedForGit(chrome.workspaceTrusted) &&
    layout.openSurfaces.some((kind) => kind === "diff" || kind === "git" || kind === "pullRequest"),
});
```

  where `workspaceTrustedForGit = (trusted: boolean) => trusted` keeps the intent readable; inline `chrome.workspaceTrusted` if the reviewer prefers.
- Build `const contextValue = useMemo<AgentRightPanelContextValue>(() => ({ … }), [ … ])` with:
  - `checkoutRoot: thread === null ? (scope.kind === "repository" ? scope.repositoryRoot : null) : threadRootPath`;
  - `diffScope: diffScope ?? (thread === null ? DEFAULT_PROJECT_DIFF_SCOPE : DEFAULT_THREAD_DIFF_SCOPE)`;
  - `openFile: (path) => chrome.fileTree?.onOpenFile(fileEntry(path))`, `previewFile` the same with `onPreviewFile`, where `fileEntry(path) = { name: path.slice(path.lastIndexOf("/") + 1), path, kind: "file" }`;
  - `revealPath: chrome.revealPath`;
  - `copyText: chrome.rightPanel?.copyText ?? rejectCopy`, where `rejectCopy = () => Promise.reject(new Error("Copy is unavailable."))`;
  - `openSurface: onOpenSurface`, `closeSurface: onCloseSurfaceTab`;
  - `legacyWorkingTreeDiff: null` (Task 6 sets it);
  - `shipActions: shipActions ?? null`;
  - `onDiffScopeChange: onDiffScopeChange ?? ignoreScope`, with a module-level no-op `ignoreScope`.
- Wrap the returned `<AgentSurfacePanel …/>` in `<AgentRightPanelContext.Provider value={contextValue}>`.

Create `src/components/agentMode/rightPanel/agentRightPanelTestSupport.tsx`:

```tsx
import type { ReactNode } from "react";
import { inlineDiffViewGateway } from "../../../infrastructure/inlineDiffViewGateway";
import type { AgentRightPanelGateways } from "./agentRightPanelGateways";
import { AgentRightPanelContext, type AgentRightPanelContextValue } from "./agentRightPanelContext";

export function rightPanelTestContext(
  overrides: Partial<AgentRightPanelContextValue> = {},
  gateways: Partial<AgentRightPanelGateways> = {},
): AgentRightPanelContextValue {
  const value: AgentRightPanelContextValue = {
    thread: null,
    scope: { kind: "none" },
    workspaceRoot: "/repo",
    workspaceTrusted: true,
    target: { repositoryRoot: "/repo", worktreePath: null },
    checkoutRoot: "/repo",
    chrome: {
      gateways: {
        git: unusedGit(),
        surfaceStatus: { getSurfaceStatus: () => Promise.reject(new Error("no status in this test")) },
        branchDiff: {
          getBranchChanges: () => Promise.reject(new Error("no branch diff in this test")),
          getBranchFileSides: () => Promise.reject(new Error("no branch diff in this test")),
        },
        diffComputation: inlineDiffViewGateway,
        fileSearch: { searchFiles: async () => [] },
        ...gateways,
      } as AgentRightPanelGateways,
      projectRepositories: [{ root: "/repo", prefix: "" }],
      copyText: async () => undefined,
    },
    gitStatus: { load: { kind: "idle" }, refresh: () => undefined },
    agents: {
      showChanges: async () => undefined,
      showFileDiff: async () => undefined,
      hideFileDiff: () => undefined,
      openChangedFile: async () => undefined,
      openChangedFileDiff: async () => undefined,
    },
    shipActions: null,
    diffScope: { kind: "workingTree" },
    legacyWorkingTreeDiff: null,
    onDiffScopeChange: () => undefined,
    openSurface: () => undefined,
    closeSurface: () => undefined,
    openFile: () => undefined,
    previewFile: () => undefined,
    revealPath: async () => undefined,
    copyText: async () => undefined,
    ...overrides,
  };
  return value;
}

export function WithRightPanelContext(props: {
  readonly value: AgentRightPanelContextValue;
  readonly children: ReactNode;
}) {
  return <AgentRightPanelContext.Provider value={props.value}>{props.children}</AgentRightPanelContext.Provider>;
}

function unusedGit(): AgentRightPanelGateways["git"] {
  const reject = () => Promise.reject(new Error("git is not used in this test"));
  return {
    getStatus: reject,
    getDiff: reject,
    stageFiles: reject,
    commit: reject,
    push: reject,
    fetch: reject,
    createBranch: reject,
    switchBranch: reject,
  };
}
```

The single `as AgentRightPanelGateways` cast exists because later tasks (8, 9) add required gateway fields that individual tests override. When Task 9 lands, replace the cast by listing defaults for `pullRequest` and `worktrees` so the helper type-checks without it (Task 9 owns that change).

- [ ] **Step 11: Run the task gates**

Run:

```bash
npx vitest run src/domain/wireValue.test.ts src/domain/gitSurfaceStatus.test.ts src/domain/gitBranchDiff.test.ts src/infrastructure/tauriGitSurfaceIpcContract.test.ts src/application/rightPanel src/components/agentMode/AgentSurfaceHost.test.tsx
npm run check
cd src-tauri && cargo test --lib git_surface && cargo test --lib git_branch_diff && cargo fmt --all -- --check && cargo clippy --all-targets -- -D warnings
```

Expected: all PASS, exit 0.

- [ ] **Step 12: Hand off (no commit)**

---
### Task 8: Pull request forge command (F9 backend) and its TS contract

**Files:**
- Create: `src-tauri/src/pull_request.rs` (pure validation, argv plan, URL parsing, failure classification + tests)
- Modify:
  - `src-tauri/src/lib_composition/git_surface_commands.rs`: `PullRequestService`, `get_pull_request_context`, `create_pull_request` + tests;
  - `src-tauri/src/git_integration.rs`: make `parse_hosted_remote`, `discover_remote` and `current_branch` `pub(crate)`;
  - `src-tauri/src/git_surface_status.rs`: make `upstream` `pub(crate)`;
  - `src-tauri/src/repository_lookup/mod.rs`: `pub(crate) use` re-exports only;
  - `src-tauri/src/lib_composition/runtime.rs`: `app.manage(PullRequestService)` + two handlers.
- Create (TS): `src/domain/pullRequest.ts`, `src/infrastructure/tauriPullRequestIpcContract.ts`, `src/infrastructure/tauriPullRequestGateway.ts`
- Modify (TS): `src/components/agentMode/rightPanel/agentRightPanelGateways.ts` (`pullRequest` field + default), `src/components/agentMode/rightPanel/agentRightPanelTestSupport.tsx` (default rejecting `pullRequest`)
- Test: `src/domain/pullRequest.test.ts`, `src/infrastructure/tauriPullRequestIpcContract.test.ts`, Rust tests in `pull_request.rs` and `git_surface_commands.rs`

**Interfaces:**
- Consumes:
  - Task 7: `git_surface_status::{git, refs, default_base, upstream}`, `git_branch_diff::safe_base_ref`, `git_surface_root`, `ensure_git_surface_trusted`, `wireValue` helpers.
  - Existing: `git_integration::{push_branch_upstream, compare_url, resolve_ship_targets, ShipTargets}`, `repository_lookup` process runner and resolver.
- Produces:
  - Tauri `get_pull_request_context({ request: { repositoryRoot, worktreePath, base: string | null } }) -> PullRequestContext`
  - Tauri `create_pull_request({ request: { repositoryRoot, worktreePath, base, title, body, draft } }) -> { url, forge }`. On failure the error string is `"<kind>:<message>"` with kind ∈ `noRemote | unsupportedHost | cliMissing | authRequired | alreadyExists | pushFailed | forgeError | invalid | untrusted`.
  - TS:
    - `type ForgeKind = "github" | "gitlab"`, `interface PullRequestContext`, `interface PullRequestContextRequest`, `interface CreatePullRequestRequest`, `interface PullRequestReceipt { url: string; forge: ForgeKind }`;
    - `type PullRequestFailureKind`, `interface PullRequestFailure { kind; message; url: string | null }`, `classifyPullRequestError(error: unknown): PullRequestFailure`;
    - `validatePullRequestTitle(title): { kind: "ok"; title } | { kind: "invalid"; reason }`, `validatePullRequestBody(body)` (same shape);
    - `pullRequestDraftDefaults(context: PullRequestContext, threadTitle: string | null): { title: string; body: string }`;
    - `interface PullRequestGateway { getContext(request): Promise<PullRequestContext>; create(request): Promise<PullRequestReceipt> }`, `TauriPullRequestGateway`;
    - constants `MAX_PULL_REQUEST_TITLE_BYTES = 256`, `MAX_PULL_REQUEST_BODY_BYTES = 65_536`.
  - `AgentRightPanelGateways.pullRequest: PullRequestGateway`

- [ ] **Step 1: Write the failing pure Rust tests**

Create `src-tauri/src/pull_request.rs` with the test module:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn github() -> HostedRepository {
        hosted_repository("github.com", "acme", "orders-api").expect("github host")
    }

    #[test]
    fn detects_supported_forges_only() {
        assert_eq!(github().forge, ForgeKind::Github);
        assert_eq!(hosted_repository("gitlab.com", "acme", "api").map(|repo| repo.forge), Some(ForgeKind::Gitlab));
        assert!(hosted_repository("bitbucket.org", "acme", "api").is_none());
        assert!(hosted_repository("git.example.com", "acme", "api").is_none());
    }

    #[test]
    fn validates_title_and_body() {
        assert_eq!(validate_pull_request("  Add keys  ", "## Why\n\tbecause", false).map(|pr| pr.title), Ok("Add keys".to_string()));
        assert!(validate_pull_request("   ", "", false).is_err());
        assert!(validate_pull_request("line\nbreak", "", false).is_err());
        assert!(validate_pull_request(&"t".repeat(257), "", false).is_err());
        assert!(validate_pull_request("ok", "nul\u{0}byte", false).is_err());
        assert!(validate_pull_request("ok", &"b".repeat(65_537), false).is_err());
    }

    #[test]
    fn plans_a_closed_github_argv_with_equals_form_values() {
        let request = validate_pull_request("-rf title", "--body text", true).expect("valid");
        let argv = pull_request_argv(&github(), "feat/keys", "main", &request);
        assert_eq!(
            argv,
            vec![
                "pr", "create", "--repo=github.com/acme/orders-api", "--head=feat/keys", "--base=main",
                "--title=-rf title", "--body=--body text", "--draft",
            ]
        );
    }

    #[test]
    fn plans_a_gitlab_merge_request() {
        let repository = hosted_repository("gitlab.com", "acme", "api").expect("gitlab");
        let request = validate_pull_request("Title", "Body", false).expect("valid");
        assert_eq!(
            pull_request_argv(&repository, "feat/x", "main", &request),
            vec![
                "mr", "create", "--repo=https://gitlab.com/acme/api", "--source-branch=feat/x",
                "--target-branch=main", "--title=Title", "--description=Body", "--yes",
            ]
        );
    }

    #[test]
    fn finds_the_created_url_on_the_forge_host_only() {
        let stdout = "Creating pull request\nhttps://evil.example/x\nhttps://github.com/acme/orders-api/pull/12\n";
        assert_eq!(created_url(stdout, "github.com"), Some("https://github.com/acme/orders-api/pull/12".to_string()));
        assert_eq!(created_url("done\n", "github.com"), None);
    }

    #[test]
    fn classifies_forge_failures() {
        let existing = "a pull request for branch \"feat\" into branch \"main\" already exists:\nhttps://github.com/acme/orders-api/pull/3\n";
        assert_eq!(
            classify_forge_failure(existing, "github.com").into_error_string(),
            "alreadyExists:https://github.com/acme/orders-api/pull/3"
        );
        assert!(classify_forge_failure("To get started with GitHub CLI, please run:  gh auth login", "github.com")
            .into_error_string()
            .starts_with("authRequired:"));
        assert!(classify_forge_failure("GraphQL: Base ref must be a branch", "github.com")
            .into_error_string()
            .starts_with("forgeError:"));
    }
}
```

Run: `cd src-tauri && cargo test --lib pull_request` (after adding `#[path = "../pull_request.rs"] pub(crate) mod pull_request;` to `git_surface_commands.rs`).
Expected: FAIL to compile.

- [ ] **Step 2: Implement `pull_request.rs`**

Prepend:

```rust
use serde::Serialize;

pub(crate) const MAX_PULL_REQUEST_TITLE_BYTES: usize = 256;
pub(crate) const MAX_PULL_REQUEST_BODY_BYTES: usize = 65_536;
pub(crate) const MAX_PULL_REQUEST_URL_BYTES: usize = 2_048;
pub(crate) const MAX_PULL_REQUEST_MESSAGE_BYTES: usize = 1_024;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ForgeKind {
    Github,
    Gitlab,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct HostedRepository {
    pub(crate) forge: ForgeKind,
    pub(crate) host: String,
    pub(crate) owner: String,
    pub(crate) repository: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ValidatedPullRequest {
    pub(crate) title: String,
    pub(crate) body: String,
    pub(crate) draft: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PullRequestReceipt {
    pub(crate) url: String,
    pub(crate) forge: ForgeKind,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum PullRequestFailure {
    NoRemote,
    UnsupportedHost,
    CliMissing(ForgeKind),
    AuthRequired(String),
    AlreadyExists(Option<String>),
    PushFailed(String),
    ForgeError(String),
    Invalid(String),
    Untrusted,
}

impl PullRequestFailure {
    pub(crate) fn into_error_string(self) -> String {
        match self {
            Self::NoRemote => "noRemote:No remote is configured for this repository.".to_string(),
            Self::UnsupportedHost => {
                "unsupportedHost:Pull requests can be created for github.com and gitlab.com remotes.".to_string()
            }
            Self::CliMissing(ForgeKind::Github) => "cliMissing:Install the GitHub CLI (gh) to create pull requests.".to_string(),
            Self::CliMissing(ForgeKind::Gitlab) => "cliMissing:Install the GitLab CLI (glab) to create merge requests.".to_string(),
            Self::AuthRequired(message) => format!("authRequired:{}", clip(&message)),
            Self::AlreadyExists(url) => format!("alreadyExists:{}", url.unwrap_or_default()),
            Self::PushFailed(message) => format!("pushFailed:{}", clip(&message)),
            Self::ForgeError(message) => format!("forgeError:{}", clip(&message)),
            Self::Invalid(message) => format!("invalid:{}", clip(&message)),
            Self::Untrusted => "untrusted:Creating pull requests requires a trusted repository.".to_string(),
        }
    }
}

pub(crate) fn hosted_repository(host: &str, owner: &str, repository: &str) -> Option<HostedRepository> {
    let forge = match host {
        "github.com" => ForgeKind::Github,
        "gitlab.com" => ForgeKind::Gitlab,
        _ => return None,
    };
    Some(HostedRepository {
        forge,
        host: host.to_string(),
        owner: owner.to_string(),
        repository: repository.to_string(),
    })
}

pub(crate) fn validate_pull_request(title: &str, body: &str, draft: bool) -> Result<ValidatedPullRequest, String> {
    let title = title.trim();
    if title.is_empty() {
        return Err("Enter a pull request title.".to_string());
    }
    if title.len() > MAX_PULL_REQUEST_TITLE_BYTES || title.chars().any(char::is_control) {
        return Err(format!("Use a single-line title of at most {MAX_PULL_REQUEST_TITLE_BYTES} bytes."));
    }
    if body.len() > MAX_PULL_REQUEST_BODY_BYTES {
        return Err(format!("The description is longer than {MAX_PULL_REQUEST_BODY_BYTES} bytes."));
    }
    if body.chars().any(|character| character.is_control() && !matches!(character, '\n' | '\r' | '\t')) {
        return Err("The description contains unsupported control characters.".to_string());
    }
    Ok(ValidatedPullRequest { title: title.to_string(), body: body.to_string(), draft })
}

pub(crate) fn pull_request_argv(
    repository: &HostedRepository,
    head: &str,
    base: &str,
    request: &ValidatedPullRequest,
) -> Vec<String> {
    let mut argv = match repository.forge {
        ForgeKind::Github => vec![
            "pr".to_string(),
            "create".to_string(),
            format!("--repo={}/{}/{}", repository.host, repository.owner, repository.repository),
            format!("--head={head}"),
            format!("--base={base}"),
            format!("--title={}", request.title),
            format!("--body={}", request.body),
        ],
        ForgeKind::Gitlab => vec![
            "mr".to_string(),
            "create".to_string(),
            format!("--repo=https://{}/{}/{}", repository.host, repository.owner, repository.repository),
            format!("--source-branch={head}"),
            format!("--target-branch={base}"),
            format!("--title={}", request.title),
            format!("--description={}", request.body),
            "--yes".to_string(),
        ],
    };
    if request.draft {
        argv.push("--draft".to_string());
    }
    argv
}

pub(crate) fn created_url(output: &str, host: &str) -> Option<String> {
    let prefix = format!("https://{host}/");
    output
        .lines()
        .rev()
        .map(str::trim)
        .find(|line| {
            line.starts_with(&prefix)
                && line.len() <= MAX_PULL_REQUEST_URL_BYTES
                && !line.chars().any(|character| character.is_whitespace() || character.is_control())
        })
        .map(str::to_string)
}

pub(crate) fn classify_forge_failure(stderr: &str, host: &str) -> PullRequestFailure {
    let lower = stderr.to_ascii_lowercase();
    if lower.contains("already exists") {
        return PullRequestFailure::AlreadyExists(created_url(stderr, host));
    }
    if lower.contains("auth login") || lower.contains("not logged") || lower.contains("authentication") || lower.contains("401") {
        return PullRequestFailure::AuthRequired(stderr.trim().to_string());
    }
    PullRequestFailure::ForgeError(stderr.trim().to_string())
}

fn clip(message: &str) -> String {
    let trimmed = message.trim();
    if trimmed.len() <= MAX_PULL_REQUEST_MESSAGE_BYTES {
        return trimmed.to_string();
    }
    let mut end = MAX_PULL_REQUEST_MESSAGE_BYTES;
    while !trimmed.is_char_boundary(end) {
        end -= 1;
    }
    trimmed[..end].to_string()
}
```

Every value is passed as a single `--flag=value` argv element to `Command::args` (no shell), so a title or body beginning with `-` can never be read as a separate flag.

Run: `cd src-tauri && cargo test --lib pull_request`
Expected: PASS.

- [ ] **Step 3: Expose the reused helpers**

- `src-tauri/src/git_integration.rs`: change `fn parse_hosted_remote`, `fn discover_remote` and `fn current_branch` to `pub(crate) fn`. No behavior change.
- `src-tauri/src/git_surface_status.rs`: change `fn upstream` to `pub(crate) fn upstream`.
- `src-tauri/src/repository_lookup/mod.rs`: add, next to the existing `pub(crate) use service::RepositoryLookupService;` and under the same `cfg` attributes as the modules they come from:

```rust
pub(crate) use plan::CliProgram;
pub(crate) use process::{plan_command, run_bounded, ProcessError, ProcessLimits, ProcessOutput};
pub(crate) use process_guard::ProcessKillSwitch;
pub(crate) use resolver::{DiscoveryExecutableResolver, ExecutableResolver, ResolvedExecutable};
```

- [ ] **Step 4: Write the failing command-level tests**

Append to the `tests` module in `src-tauri/src/lib_composition/git_surface_commands.rs`:

```rust
    use super::pull_request::ForgeKind;
    use super::super::repository_lookup::{CliProgram, ExecutableResolver, ResolvedExecutable};
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::process::Command;
    use std::sync::Arc;

    struct FixedResolver(Option<PathBuf>);

    impl ExecutableResolver for FixedResolver {
        fn resolve(&self, _program: CliProgram) -> Option<ResolvedExecutable> {
            self.0.clone().map(|path| ResolvedExecutable { path, search_path: "/usr/bin:/bin".to_string() })
        }
    }

    fn git(root: &Path, arguments: &[&str]) {
        let status = Command::new("git")
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_CONFIG_SYSTEM", "/dev/null")
            .arg("-C")
            .arg(root)
            .args(arguments)
            .status()
            .expect("git");
        assert!(status.success(), "git {arguments:?}");
    }

    fn repository_with_remote(label: &str, remote_url: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("pr-command-{label}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("mkdir");
        git(&root, &["init", "--initial-branch=main"]);
        git(&root, &["config", "user.name", "Test"]);
        git(&root, &["config", "user.email", "t@example.com"]);
        git(&root, &["commit", "--allow-empty", "-m", "initial"]);
        git(&root, &["checkout", "-b", "feat/keys"]);
        git(&root, &["commit", "--allow-empty", "-m", "feat: keys"]);
        git(&root, &["remote", "add", "origin", remote_url]);
        git(&root, &["update-ref", "refs/remotes/origin/feat/keys", "HEAD"]);
        git(&root, &["update-ref", "refs/remotes/origin/main", "main"]);
        git(&root, &["config", "branch.feat/keys.remote", "origin"]);
        git(&root, &["config", "branch.feat/keys.merge", "refs/heads/feat/keys"]);
        root.canonicalize().expect("canonical")
    }

    fn fake_cli(label: &str, script: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("pr-fake-cli-{label}-{}", std::process::id()));
        fs::write(&path, script).expect("write fake cli");
        fs::set_permissions(&path, fs::Permissions::from_mode(0o700)).expect("chmod");
        path
    }

    #[test]
    fn creates_a_pull_request_without_pushing_when_the_branch_is_published() {
        let root = repository_with_remote("ok", "https://github.com/acme/orders-api.git");
        let cli = fake_cli("ok", "#!/bin/sh\necho \"https://github.com/acme/orders-api/pull/42\"\n");
        let service = PullRequestService::with_resolver(Arc::new(FixedResolver(Some(cli))), std::env::temp_dir());

        let receipt = create_pull_request_blocking(
            &service,
            CreatePullRequestRequest::for_test(&root, "main", "Add keys", "Body", false),
        );

        assert_eq!(
            receipt,
            Ok(PullRequestReceipt { url: "https://github.com/acme/orders-api/pull/42".to_string(), forge: ForgeKind::Github })
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn reports_missing_cli_and_unsupported_hosts() {
        let github = repository_with_remote("missing", "https://github.com/acme/orders-api.git");
        let bitbucket = repository_with_remote("bitbucket", "https://bitbucket.org/acme/orders-api.git");
        let none = PullRequestService::with_resolver(Arc::new(FixedResolver(None)), std::env::temp_dir());

        let missing = create_pull_request_blocking(&none, CreatePullRequestRequest::for_test(&github, "main", "T", "", false));
        let unsupported = create_pull_request_blocking(&none, CreatePullRequestRequest::for_test(&bitbucket, "main", "T", "", false));

        assert!(missing.unwrap_err().starts_with("cliMissing:"));
        assert!(unsupported.unwrap_err().starts_with("unsupportedHost:"));
        let _ = fs::remove_dir_all(github);
        let _ = fs::remove_dir_all(bitbucket);
    }

    #[test]
    fn rejects_invalid_input_before_running_anything() {
        let root = repository_with_remote("invalid", "https://github.com/acme/orders-api.git");
        let cli = fake_cli("invalid", "#!/bin/sh\ntouch \"$HOME/ran\"\n");
        let service = PullRequestService::with_resolver(Arc::new(FixedResolver(Some(cli))), root.clone());

        let bad_base = create_pull_request_blocking(&service, CreatePullRequestRequest::for_test(&root, "--help", "T", "", false));
        let bad_title = create_pull_request_blocking(&service, CreatePullRequestRequest::for_test(&root, "main", "a\nb", "", false));
        let same_branch = create_pull_request_blocking(&service, CreatePullRequestRequest::for_test(&root, "feat/keys", "T", "", false));

        assert!(bad_base.unwrap_err().starts_with("invalid:"));
        assert!(bad_title.unwrap_err().starts_with("invalid:"));
        assert!(same_branch.unwrap_err().starts_with("invalid:"));
        assert!(!root.join("ran").exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn describes_the_branch_for_the_form() {
        let root = repository_with_remote("context", "https://github.com/acme/orders-api.git");
        let none = PullRequestService::with_resolver(Arc::new(FixedResolver(None)), std::env::temp_dir());

        let context = pull_request_context_blocking(&none, PullRequestContextRequest::for_test(&root, None)).expect("context");

        assert_eq!(context.head_branch.as_deref(), Some("feat/keys"));
        assert_eq!(context.base.as_deref(), Some("main"));
        assert_eq!(context.commits_ahead, 1);
        assert_eq!(context.commit_subjects, vec!["feat: keys".to_string()]);
        assert_eq!(context.forge, Some(ForgeKind::Github));
        assert!(!context.cli_available);
        let _ = fs::remove_dir_all(root);
    }
```

The fake CLI is the only stand-in, and it replaces the true third-party boundary (`gh`); no network request is made. `for_test` constructors are `#[cfg(test)]` helpers on the request structs.

- [ ] **Step 5: Implement the service and commands**

Add to `git_surface_commands.rs`:

```rust
#[path = "../pull_request.rs"]
pub(crate) mod pull_request;

use super::repository_lookup::{
    plan_command, run_bounded, CliProgram, DiscoveryExecutableResolver, ExecutableResolver, ProcessError, ProcessKillSwitch,
    ProcessLimits, ProcessOutput,
};
use crate::agent_cli_discovery::AgentCliDiscovery;
use pull_request::{
    classify_forge_failure, created_url, hosted_repository, pull_request_argv, validate_pull_request, ForgeKind,
    HostedRepository, PullRequestFailure, PullRequestReceipt,
};
use serde::Serialize;
use std::sync::Arc;
use std::time::Duration;
use tauri::State;

const PULL_REQUEST_TIMEOUT: Duration = Duration::from_secs(90);
const PULL_REQUEST_STDOUT_BYTES: usize = 64 * 1024;
const PULL_REQUEST_STDERR_BYTES: usize = 8 * 1024;
const MAX_CONTEXT_SUBJECTS: usize = 50;

pub(crate) struct PullRequestService {
    executables: Arc<dyn ExecutableResolver>,
    home: PathBuf,
}

impl PullRequestService {
    pub(crate) fn new(discovery: Arc<AgentCliDiscovery>) -> Self {
        Self::with_resolver(Arc::new(DiscoveryExecutableResolver::new(discovery)), forge_home())
    }

    pub(crate) fn with_resolver(executables: Arc<dyn ExecutableResolver>, home: PathBuf) -> Self {
        Self { executables, home }
    }

    fn cli_available(&self, forge: ForgeKind) -> bool {
        self.executables.resolve(program(forge)).is_some()
    }

    fn run(&self, forge: ForgeKind, argv: &[String], cwd: &Path) -> Result<ProcessOutput, PullRequestFailure> {
        let executable = self.executables.resolve(program(forge)).ok_or(PullRequestFailure::CliMissing(forge))?;
        let mut command = plan_command(&executable.path, argv, &self.home, &executable.search_path);
        command.current_dir(cwd);
        let limits = ProcessLimits {
            timeout: PULL_REQUEST_TIMEOUT,
            stdout_bytes: PULL_REQUEST_STDOUT_BYTES,
            stderr_bytes: PULL_REQUEST_STDERR_BYTES,
        };
        run_bounded(command, limits, &ProcessKillSwitch::default()).map_err(|error| match error {
            ProcessError::TimedOut => PullRequestFailure::ForgeError("The forge did not answer in time.".to_string()),
            ProcessError::OutputTooLarge => PullRequestFailure::ForgeError("The forge answered with too much output.".to_string()),
            ProcessError::Io => PullRequestFailure::ForgeError("The forge CLI could not be started.".to_string()),
        })
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PullRequestContextRequest {
    repository_root: String,
    worktree_path: Option<String>,
    base: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CreatePullRequestRequest {
    repository_root: String,
    worktree_path: Option<String>,
    base: String,
    title: String,
    body: String,
    draft: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PullRequestContext {
    pub(crate) head_branch: Option<String>,
    pub(crate) default_base: Option<String>,
    pub(crate) base: Option<String>,
    pub(crate) commits_ahead: usize,
    pub(crate) files_changed: usize,
    pub(crate) unpushed_commits: usize,
    pub(crate) has_upstream: bool,
    pub(crate) forge: Option<ForgeKind>,
    pub(crate) cli_available: bool,
    pub(crate) commit_subjects: Vec<String>,
    pub(crate) compare_url: Option<String>,
}

pub(crate) fn pull_request_context_blocking(
    service: &PullRequestService,
    request: PullRequestContextRequest,
) -> Result<PullRequestContext, String> {
    let root = canonicalize_workspace_root(&request.repository_root)?;
    let targets = git_integration::resolve_ship_targets(&root, request.worktree_path.as_deref().map(Path::new))?;
    let worktree = targets.worktree.as_path();
    let head = git_integration::current_branch(worktree)?;
    let (local, _) = git_surface_status::refs(worktree, "refs/heads")?;
    let default_base = git_surface_status::default_base(worktree, &local);
    let base = match request.base {
        Some(base) => Some(git_branch_diff::safe_base_ref(&base)?),
        None => default_base.clone(),
    };
    let hosted = head.as_deref().and_then(|head| hosted_remote(worktree, head));
    let upstream = git_surface_status::upstream(worktree);
    let (commits_ahead, files_changed, commit_subjects) = match base.as_deref() {
        Some(base) => branch_summary(worktree, base),
        None => (0, 0, Vec::new()),
    };
    let compare_url = match (hosted.as_ref(), base.as_deref(), head.as_deref()) {
        (Some((_, url)), Some(base), Some(head)) => git_integration::compare_url(url, base, head),
        _ => None,
    };
    Ok(PullRequestContext {
        head_branch: head,
        default_base,
        base,
        commits_ahead,
        files_changed,
        unpushed_commits: upstream.as_ref().map(|upstream| upstream.ahead).unwrap_or(commits_ahead),
        has_upstream: upstream.is_some(),
        forge: hosted.as_ref().map(|(repository, _)| repository.forge),
        cli_available: hosted.as_ref().is_some_and(|(repository, _)| service.cli_available(repository.forge)),
        commit_subjects,
        compare_url,
    })
}

pub(crate) fn create_pull_request_blocking(
    service: &PullRequestService,
    request: CreatePullRequestRequest,
) -> Result<PullRequestReceipt, String> {
    create_pull_request_inner(service, request).map_err(PullRequestFailure::into_error_string)
}

fn create_pull_request_inner(
    service: &PullRequestService,
    request: CreatePullRequestRequest,
) -> Result<PullRequestReceipt, PullRequestFailure> {
    let base = git_branch_diff::safe_base_ref(&request.base).map_err(PullRequestFailure::Invalid)?;
    let validated =
        validate_pull_request(&request.title, &request.body, request.draft).map_err(PullRequestFailure::Invalid)?;
    let root = canonicalize_workspace_root(&request.repository_root).map_err(PullRequestFailure::Invalid)?;
    let targets = git_integration::resolve_ship_targets(&root, request.worktree_path.as_deref().map(Path::new))
        .map_err(PullRequestFailure::Invalid)?;
    let head = git_integration::current_branch(&targets.worktree)
        .map_err(PullRequestFailure::ForgeError)?
        .ok_or_else(|| PullRequestFailure::Invalid("The checkout is on a detached HEAD.".to_string()))?;
    if head == base {
        return Err(PullRequestFailure::Invalid("Choose a base branch different from the current branch.".to_string()));
    }
    let remote = git_integration::discover_remote(&targets.worktree, &head)
        .map_err(PullRequestFailure::ForgeError)?
        .ok_or(PullRequestFailure::NoRemote)?;
    let (repository, _) = hosted_remote_named(&targets.worktree, &remote).ok_or(PullRequestFailure::UnsupportedHost)?;
    if !service.cli_available(repository.forge) {
        return Err(PullRequestFailure::CliMissing(repository.forge));
    }
    let needs_push = git_surface_status::upstream(&targets.worktree).map_or(true, |upstream| upstream.ahead > 0);
    if needs_push {
        git_integration::push_branch_upstream(&targets)
            .map_err(|failure| PullRequestFailure::PushFailed(failure.into_error_string()))?;
    }
    let argv = pull_request_argv(&repository, &head, &base, &validated);
    let output = service.run(repository.forge, &argv, &targets.worktree)?;
    if !output.success {
        return Err(classify_forge_failure(&String::from_utf8_lossy(&output.stderr), &repository.host));
    }
    let url = created_url(&String::from_utf8_lossy(&output.stdout), &repository.host).ok_or_else(|| {
        PullRequestFailure::ForgeError("The forge CLI did not report the pull request address.".to_string())
    })?;
    Ok(PullRequestReceipt { url, forge: repository.forge })
}

fn hosted_remote(worktree: &Path, head: &str) -> Option<(HostedRepository, String)> {
    let remote = git_integration::discover_remote(worktree, head).ok().flatten()?;
    hosted_remote_named(worktree, &remote)
}

fn hosted_remote_named(worktree: &Path, remote: &str) -> Option<(HostedRepository, String)> {
    let url = git_surface_status::git(worktree, &["remote", "get-url", "--push", "--", remote]).ok()?;
    let url = url.trim().to_string();
    let (host, owner, repository) = git_integration::parse_hosted_remote(&url)?;
    Some((hosted_repository(&host, &owner, &repository)?, url))
}

fn branch_summary(worktree: &Path, base: &str) -> (usize, usize, Vec<String>) {
    let range = format!("{base}..HEAD");
    let symmetric = format!("{base}...HEAD");
    let limit = format!("--max-count={MAX_CONTEXT_SUBJECTS}");
    let commits = git_surface_status::git(worktree, &["rev-list", "--count", range.as_str()])
        .ok()
        .and_then(|output| output.trim().parse().ok())
        .unwrap_or(0);
    let files = git_surface_status::git(worktree, &["diff", "--name-only", "-z", symmetric.as_str()])
        .map(|output| output.split('\0').filter(|name| !name.is_empty()).count())
        .unwrap_or(0);
    let subjects = git_surface_status::git(worktree, &["log", "--format=%s", limit.as_str(), range.as_str()])
        .map(|output| output.lines().map(|line| git_surface_status::clip_utf8(line.trim(), 200)).collect())
        .unwrap_or_default();
    (commits, files, subjects)
}

fn program(forge: ForgeKind) -> CliProgram {
    match forge {
        ForgeKind::Github => CliProgram::Gh,
        ForgeKind::Gitlab => CliProgram::Glab,
    }
}

fn forge_home() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("/"))
}

#[tauri::command]
pub(crate) async fn get_pull_request_context(
    request: PullRequestContextRequest,
    trust: GitTrustState<'_>,
    service: State<'_, Arc<PullRequestService>>,
) -> Result<PullRequestContext, String> {
    ensure_git_surface_trusted(&trust, &request.repository_root, request.worktree_path.as_deref())
        .map_err(|_| PullRequestFailure::Untrusted.into_error_string())?;
    let service = Arc::clone(&service);
    run_blocking_command(move || pull_request_context_blocking(&service, request)).await
}

#[tauri::command]
pub(crate) async fn create_pull_request(
    request: CreatePullRequestRequest,
    trust: GitTrustState<'_>,
    service: State<'_, Arc<PullRequestService>>,
) -> Result<PullRequestReceipt, String> {
    ensure_git_surface_trusted(&trust, &request.repository_root, request.worktree_path.as_deref())
        .map_err(|_| PullRequestFailure::Untrusted.into_error_string())?;
    let service = Arc::clone(&service);
    run_blocking_command(move || create_pull_request_blocking(&service, request)).await
}
```

Add `#[cfg(test)] impl CreatePullRequestRequest { pub(crate) fn for_test(root: &Path, base: &str, title: &str, body: &str, draft: bool) -> Self { … } }` and the same for `PullRequestContextRequest::for_test(root, base: Option<&str>)`.

If `parse_hosted_remote` returns `(String, String, String)` for hosts outside `COMPARE_URL_HOSTS` as `None`, a `gitlab.com` or `github.com` remote is still accepted (both are in that list), and everything else is `unsupportedHost`, which is the intended closed set. Self-hosted GitLab / GitHub Enterprise are a reported gap.

`runtime.rs`:
- after the `RepositoryLookupService` manage call (before `app.manage(agent_cli_discovery)` moves the `Arc`), add `app.manage(Arc::new(git_surface_commands::PullRequestService::new(Arc::clone(&agent_cli_discovery))));`;
- add `git_surface_commands::get_pull_request_context, git_surface_commands::create_pull_request,` to the handler list.

Run: `cd src-tauri && cargo test --lib git_surface pull_request && cargo clippy --all-targets -- -D warnings && cargo fmt --all -- --check`
Expected: PASS.

- [ ] **Step 6: TS domain and contract (tests first)**

Create `src/domain/pullRequest.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  classifyPullRequestError,
  parsePullRequestContext,
  parsePullRequestReceipt,
  pullRequestDraftDefaults,
  validatePullRequestBody,
  validatePullRequestTitle,
  type PullRequestContext,
} from "./pullRequest";

const context: PullRequestContext = {
  headBranch: "feat/idempotency-keys",
  defaultBase: "main",
  base: "main",
  commitsAhead: 3,
  filesChanged: 3,
  unpushedCommits: 2,
  hasUpstream: true,
  forge: "github",
  cliAvailable: true,
  commitSubjects: ["test(orders): cover retry", "feat(orders): replay responses"],
  compareUrl: "https://github.com/acme/orders-api/compare/main...feat/idempotency-keys?expand=1",
};

describe("pull request domain", () => {
  it("parses the context and receipt wire shapes exactly", () => {
    expect(parsePullRequestContext(context)).toEqual(context);
    expect(() => parsePullRequestContext({ ...context, token: "x" })).toThrow();
    expect(parsePullRequestReceipt({ url: "https://github.com/acme/orders-api/pull/7", forge: "github" })).toEqual({
      url: "https://github.com/acme/orders-api/pull/7",
      forge: "github",
    });
    expect(() => parsePullRequestReceipt({ url: "javascript:alert(1)", forge: "github" })).toThrow();
  });

  it("classifies prefixed backend errors and keeps an existing PR url", () => {
    expect(classifyPullRequestError(new Error("alreadyExists:https://github.com/acme/orders-api/pull/3"))).toEqual({
      kind: "alreadyExists",
      message: "A pull request for this branch already exists.",
      url: "https://github.com/acme/orders-api/pull/3",
    });
    expect(classifyPullRequestError("cliMissing:Install the GitHub CLI (gh) to create pull requests.")).toMatchObject({
      kind: "cliMissing",
      url: null,
    });
    expect(classifyPullRequestError(new Error("boom")).kind).toBe("forgeError");
  });

  it("validates title and body like the Rust side", () => {
    expect(validatePullRequestTitle("  Add keys ")).toEqual({ kind: "ok", title: "Add keys" });
    expect(validatePullRequestTitle(" ").kind).toBe("invalid");
    expect(validatePullRequestTitle("a\nb").kind).toBe("invalid");
    expect(validatePullRequestTitle("t".repeat(257)).kind).toBe("invalid");
    expect(validatePullRequestBody("## Why\n\tok").kind).toBe("ok");
    expect(validatePullRequestBody("b".repeat(65_537)).kind).toBe("invalid");
  });

  it("drafts a title from the thread and a body from the commits", () => {
    expect(pullRequestDraftDefaults(context, "Idempotency keys for POST /orders")).toEqual({
      title: "Idempotency keys for POST /orders",
      body: "## Changes\n\n- feat(orders): replay responses\n- test(orders): cover retry\n",
    });
    expect(pullRequestDraftDefaults({ ...context, commitSubjects: [] }, null).title).toBe("feat/idempotency-keys");
  });
});
```

Create `src/domain/pullRequest.ts`:

```ts
import {
  wireBoolean,
  wireCount,
  wireEnum,
  wireExactRecord,
  wireNullableString,
  wireString,
  wireStringArray,
} from "./wireValue";

export const MAX_PULL_REQUEST_TITLE_BYTES = 256;
export const MAX_PULL_REQUEST_BODY_BYTES = 65_536;
const MAX_URL_BYTES = 2_048;
const FORGES = ["github", "gitlab"] as const;
const FORGE_HOSTS: Readonly<Record<ForgeKind, string>> = { github: "github.com", gitlab: "gitlab.com" };

export type ForgeKind = (typeof FORGES)[number];

export const PULL_REQUEST_FAILURE_KINDS = [
  "noRemote",
  "unsupportedHost",
  "cliMissing",
  "authRequired",
  "alreadyExists",
  "pushFailed",
  "forgeError",
  "invalid",
  "untrusted",
] as const;
export type PullRequestFailureKind = (typeof PULL_REQUEST_FAILURE_KINDS)[number];

export interface PullRequestContextRequest {
  readonly repositoryRoot: string;
  readonly worktreePath: string | null;
  readonly base: string | null;
}

export interface CreatePullRequestRequest {
  readonly repositoryRoot: string;
  readonly worktreePath: string | null;
  readonly base: string;
  readonly title: string;
  readonly body: string;
  readonly draft: boolean;
}

export interface PullRequestContext {
  readonly headBranch: string | null;
  readonly defaultBase: string | null;
  readonly base: string | null;
  readonly commitsAhead: number;
  readonly filesChanged: number;
  readonly unpushedCommits: number;
  readonly hasUpstream: boolean;
  readonly forge: ForgeKind | null;
  readonly cliAvailable: boolean;
  readonly commitSubjects: ReadonlyArray<string>;
  readonly compareUrl: string | null;
}

export interface PullRequestReceipt {
  readonly url: string;
  readonly forge: ForgeKind;
}

export interface PullRequestFailure {
  readonly kind: PullRequestFailureKind;
  readonly message: string;
  readonly url: string | null;
}

export interface PullRequestGateway {
  getContext(request: PullRequestContextRequest): Promise<PullRequestContext>;
  create(request: CreatePullRequestRequest): Promise<PullRequestReceipt>;
}

export type FieldValidation<T extends string> =
  | ({ readonly kind: "ok" } & Readonly<Record<T, string>>)
  | { readonly kind: "invalid"; readonly reason: string };

const encoder = new TextEncoder();
const CONTROL = /[\u0000-\u001f\u007f]/;
const BODY_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

export function validatePullRequestTitle(title: string): FieldValidation<"title"> {
  const trimmed = title.trim();
  if (trimmed.length === 0) return { kind: "invalid", reason: "Enter a pull request title." };
  if (encoder.encode(trimmed).length > MAX_PULL_REQUEST_TITLE_BYTES || CONTROL.test(trimmed)) {
    return { kind: "invalid", reason: `Use a single-line title of at most ${MAX_PULL_REQUEST_TITLE_BYTES} bytes.` };
  }
  return { kind: "ok", title: trimmed };
}

export function validatePullRequestBody(body: string): FieldValidation<"body"> {
  if (encoder.encode(body).length > MAX_PULL_REQUEST_BODY_BYTES) {
    return { kind: "invalid", reason: "The description is too long." };
  }
  if (BODY_CONTROL.test(body)) return { kind: "invalid", reason: "The description contains unsupported characters." };
  return { kind: "ok", body };
}

export function parsePullRequestContext(value: unknown, path = "pullRequestContext"): PullRequestContext {
  const record = wireExactRecord(
    value,
    [
      "headBranch",
      "defaultBase",
      "base",
      "commitsAhead",
      "filesChanged",
      "unpushedCommits",
      "hasUpstream",
      "forge",
      "cliAvailable",
      "commitSubjects",
      "compareUrl",
    ],
    path,
  );
  return {
    headBranch: wireNullableString(record.headBranch, `${path}.headBranch`, 512),
    defaultBase: wireNullableString(record.defaultBase, `${path}.defaultBase`, 512),
    base: wireNullableString(record.base, `${path}.base`, 512),
    commitsAhead: wireCount(record.commitsAhead, `${path}.commitsAhead`, 10_000_000),
    filesChanged: wireCount(record.filesChanged, `${path}.filesChanged`, 10_000_000),
    unpushedCommits: wireCount(record.unpushedCommits, `${path}.unpushedCommits`, 10_000_000),
    hasUpstream: wireBoolean(record.hasUpstream, `${path}.hasUpstream`),
    forge: record.forge === null ? null : wireEnum(record.forge, `${path}.forge`, FORGES),
    cliAvailable: wireBoolean(record.cliAvailable, `${path}.cliAvailable`),
    commitSubjects: wireStringArray(record.commitSubjects, `${path}.commitSubjects`, 50, 200),
    compareUrl: record.compareUrl === null ? null : httpsUrl(record.compareUrl, `${path}.compareUrl`),
  };
}

export function parsePullRequestReceipt(value: unknown, path = "pullRequestReceipt"): PullRequestReceipt {
  const record = wireExactRecord(value, ["url", "forge"], path);
  const forge = wireEnum(record.forge, `${path}.forge`, FORGES);
  const url = httpsUrl(record.url, `${path}.url`);
  if (new URL(url).hostname !== FORGE_HOSTS[forge]) throw new TypeError(`Invalid ${path}.url: expected a ${forge} address.`);
  return { url, forge };
}

export function classifyPullRequestError(error: unknown): PullRequestFailure {
  const text = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const separator = text.indexOf(":");
  const kind = text.slice(0, Math.max(0, separator));
  const detail = separator < 0 ? "" : text.slice(separator + 1).trim();
  if (!(PULL_REQUEST_FAILURE_KINDS as ReadonlyArray<string>).includes(kind)) {
    return { kind: "forgeError", message: text.length > 0 ? text : "The pull request could not be created.", url: null };
  }
  const known = kind as PullRequestFailureKind;
  if (known === "alreadyExists") {
    return {
      kind: known,
      message: "A pull request for this branch already exists.",
      url: detail.startsWith("https://") ? detail : null,
    };
  }
  return { kind: known, message: detail.length > 0 ? detail : "The pull request could not be created.", url: null };
}

export function pullRequestDraftDefaults(
  context: PullRequestContext,
  threadTitle: string | null,
): { readonly title: string; readonly body: string } {
  const subjects = [...context.commitSubjects].reverse();
  const titleCandidate = threadTitle?.trim() || subjects[subjects.length - 1] || context.headBranch || "";
  const validated = validatePullRequestTitle(titleCandidate);
  const title = validated.kind === "ok" ? validated.title : "";
  const body = subjects.length === 0 ? "" : `## Changes\n\n${subjects.map((subject) => `- ${subject}`).join("\n")}\n`;
  return { title, body };
}

function httpsUrl(value: unknown, path: string): string {
  const text = wireString(value, path, MAX_URL_BYTES);
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    throw new TypeError(`Invalid ${path}: expected an https address.`);
  }
  if (parsed.protocol !== "https:") throw new TypeError(`Invalid ${path}: expected an https address.`);
  return text;
}
```

`git log` lists newest first, so `reverse()` gives chronological bullets. The fallback title is the oldest commit subject when there is no thread title, which matches the test.

Create `src/infrastructure/tauriPullRequestIpcContract.ts` with:
- `GET_PULL_REQUEST_CONTEXT_IPC_COMMAND = "get_pull_request_context"`, `CREATE_PULL_REQUEST_IPC_COMMAND = "create_pull_request"`;
- `validatePullRequestContextRequest(request)`, which uses `validateGitSurfaceTargetRequest` from Task 7, plus `base` = `null` or `validateGitBaseRef`;
- `validateCreatePullRequestRequest(request)`: target + `validateGitBaseRef(base)`; `validatePullRequestTitle`/`Body` must be `ok`, otherwise throw a `TypeError` carrying the reason, with no invoke; `draft` a boolean;
- `invokeGetPullRequestContextIpc(invoke, request)`, which parses with `parsePullRequestContext`, and `invokeCreatePullRequestIpc(invoke, request)`, which parses with `parsePullRequestReceipt`.

Both send `{ request: <validated> }`, in the same shape as Task 7's contract.

Create `src/infrastructure/tauriPullRequestGateway.ts` with `TauriPullRequestGateway implements PullRequestGateway`, mirroring `TauriGitSurfaceGateway`.

Create `src/infrastructure/tauriPullRequestIpcContract.test.ts` with:
- (a) the exact command name and payload for create, including a trimmed title;
- (b) a title with a newline rejects without invoking;
- (c) a base `--help` rejects without invoking;
- (d) a response with an extra key rejects.

Modify `agentRightPanelGateways.ts`:
- add `readonly pullRequest: PullRequestGateway;`;
- add `pullRequest: new TauriPullRequestGateway()` to the default factory.

Modify `agentRightPanelTestSupport.tsx`: add a default `pullRequest` gateway whose methods reject with "no pull request gateway in this test".

Run: `npx vitest run src/domain/pullRequest.test.ts src/infrastructure/tauriPullRequestIpcContract.test.ts src/infrastructure/tauriIpcContractArchitecture.test.ts && npm run check`
Expected: PASS.

- [ ] **Step 7: Hand off (no commit)**

---

### Task 9: Branch worktrees (`add_git_branch_worktree`) and the shared start-point resolver

**Files:**
- Modify: `src-tauri/src/git_worktree.rs` (new free functions `resolve_worktree_start_point`, `branch_worktree_directory_name`, `add_branch_worktree` + tests), `src-tauri/src/lib_composition/git_worktree_commands.rs` (command `add_git_branch_worktree` + test), `src-tauri/src/lib_composition/runtime.rs` (handler)
- Modify (TS): `src/domain/gitWorktree.ts` (`BranchWorktreeRequest`, `BranchWorktreeReceipt`, `parseBranchWorktreeReceipt`, `GitWorktreeGateway.addBranchWorktree?`), `src/infrastructure/tauriGitWorktreeIpcContract.ts` (+ test), `src/infrastructure/tauriGitWorktreeGateway.ts`, `src/components/agentMode/rightPanel/agentRightPanelGateways.ts` (`worktrees`), `src/components/agentMode/rightPanel/agentRightPanelTestSupport.tsx` (remove the cast)

**Interfaces:**
- Consumes: existing worktree internals (`canonical_repository_root`, `ensure_agent_worktree_base`, `ensure_agent_worktree_excluded`, `ensure_path_bounds`, `ensure_branch_bounds`, `local_branch_head`, `compensate_failed_worktree_add`, `run_worktree_command`, `MAX_WORKTREES_PER_REPOSITORY`, `ensure_worktree_path_in_base`, `WORKTREE_BASE_DIR_NAME`), Task 7 `safe_base_ref` (TS: `validateGitBaseRef`).
- Produces:
  - Rust `pub(crate) fn resolve_worktree_start_point(root: &Path, reference: &str) -> Result<String, String>` (agreed with P9)
  - Rust `pub(crate) fn add_branch_worktree(repository_root: &Path, branch: &str, start_point: Option<&str>) -> Result<CreatedBranchWorktree, String>` where `CreatedBranchWorktree { worktree_path: PathBuf, branch: String }`
  - Tauri `add_git_branch_worktree({ request: { repositoryRoot, branch, startPoint: string | null } }) -> { worktreePath, branch }` (trust-gated with `ensure_worktree_repository_trusted`)
  - TS `interface BranchWorktreeRequest { repositoryRoot; branch; startPoint: string | null }`, `interface BranchWorktreeReceipt { worktreePath; branch }`, `GitWorktreeGateway.addBranchWorktree(request): Promise<BranchWorktreeReceipt>`, `ADD_GIT_BRANCH_WORKTREE_IPC_COMMAND = "add_git_branch_worktree"`
  - `AgentRightPanelGateways.worktrees: Pick<Required<GitWorktreeGateway>, "addBranchWorktree">`

- [ ] **Step 1: Write the failing Rust tests** (inside the existing `#[cfg(test)] mod tests` of `git_worktree.rs`, reusing its `TempRepository` and `run_git`):

```rust
    #[test]
    fn resolves_branch_and_remote_start_points_to_full_shas() {
        let repository = TempRepository::create("start-point", false, true);
        let head = local_branch_head(&repository.root, "main").expect("head").expect("main exists");

        assert_eq!(resolve_worktree_start_point(&repository.root, "main"), Ok(head.clone()));
        assert_eq!(resolve_worktree_start_point(&repository.root, "refs/heads/main"), Ok(head));
        for bad in ["-x", "a..b", "", "main lock", "refs/tags/v1", "does-not-exist"] {
            assert!(resolve_worktree_start_point(&repository.root, bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn creates_a_new_branch_in_a_managed_worktree() {
        let repository = TempRepository::create("branch-worktree", false, true);

        let created = add_branch_worktree(&repository.root, "feat/idempotency-ttl", Some("main")).expect("created");

        assert_eq!(created.branch, "feat/idempotency-ttl");
        assert!(created.worktree_path.starts_with(repository.root.join(WORKTREE_BASE_DIR_NAME)));
        assert!(created.worktree_path.join("README.md").exists());
        assert!(local_branch_head(&repository.root, "feat/idempotency-ttl").expect("lookup").is_some());
    }

    #[test]
    fn checks_out_an_existing_branch_and_refuses_duplicates_and_bad_names() {
        let repository = TempRepository::create("existing-branch", false, true);
        run_git(&repository.root, &["branch", "fix/payments"]);

        assert!(add_branch_worktree(&repository.root, "fix/payments", None).is_ok());
        assert!(add_branch_worktree(&repository.root, "fix/payments", None).is_err());
        assert!(add_branch_worktree(&repository.root, "--force", None).is_err());
        assert!(add_branch_worktree(&repository.root, "main", None).is_err());
    }
```

The last case refuses a worktree for the branch checked out in the primary (git itself refuses; the function must return `Err`, not panic).

Run: `cd src-tauri && cargo test --lib git_worktree` and expect a compile failure.

- [ ] **Step 2: Implement (Rust)**

Add to `git_worktree.rs` (below `agent_worktree_path`):

```rust
pub(crate) const BRANCH_WORKTREE_PREFIX: &str = "branch-";

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct CreatedBranchWorktree {
    pub(crate) worktree_path: PathBuf,
    pub(crate) branch: String,
}

pub(crate) fn resolve_worktree_start_point(root: &Path, reference: &str) -> Result<String, String> {
    let invalid = reference.is_empty()
        || reference.len() > 256
        || reference.starts_with('-')
        || reference.contains("..")
        || reference.chars().any(|character| character.is_whitespace() || character.is_control());
    if invalid {
        return Err("Choose a valid branch to start from.".to_string());
    }
    let qualified = reference.starts_with("refs/heads/") || reference.starts_with("refs/remotes/");
    if !qualified {
        ensure_branch_bounds(reference)?;
        run_worktree_command(root, &[OsStr::new("check-ref-format"), OsStr::new("--branch"), OsStr::new(reference)])
            .map_err(|_| "Choose a valid branch to start from.".to_string())?;
    }
    let target = format!("{reference}^{{commit}}");
    let output = run_worktree_command(
        root,
        &[OsStr::new("rev-parse"), OsStr::new("--verify"), OsStr::new("--quiet"), OsStr::new("--end-of-options"), OsStr::new(target.as_str())],
    )
    .map_err(|_| format!("{reference} does not exist."))?;
    let sha = output.trim().to_string();
    let hex = (sha.len() == 40 || sha.len() == 64) && sha.chars().all(|character| character.is_ascii_hexdigit());
    if !hex {
        return Err("Git reported an unusable start point.".to_string());
    }
    Ok(sha)
}

pub(crate) fn branch_worktree_directory_name(branch: &str) -> String {
    let sanitized: String = branch
        .chars()
        .map(|character| match character.is_ascii_alphanumeric() || character == '-' || character == '_' {
            true => character,
            false => '-',
        })
        .collect();
    format!("{BRANCH_WORKTREE_PREFIX}{}", sanitized.trim_matches('-'))
}

pub(crate) fn add_branch_worktree(
    repository_root: &Path,
    branch: &str,
    start_point: Option<&str>,
) -> Result<CreatedBranchWorktree, String> {
    let root = canonical_repository_root(repository_root)?;
    if branch.starts_with('-') {
        return Err("Choose a valid branch name.".to_string());
    }
    ensure_branch_bounds(branch)?;
    run_worktree_command(&root, &[OsStr::new("check-ref-format"), OsStr::new("--branch"), OsStr::new(branch)])
        .map_err(|_| "Choose a valid branch name.".to_string())?;
    ensure_agent_worktree_excluded(&root)?;
    let base = ensure_agent_worktree_base(&root)?;
    let target = base.join(branch_worktree_directory_name(branch));
    ensure_path_bounds(&target)?;
    let existing = GitWorktreeCommandGateway::new().list_worktrees(&root)?;
    if existing.len() >= MAX_WORKTREES_PER_REPOSITORY {
        return Err(format!("Repository already holds the maximum of {MAX_WORKTREES_PER_REPOSITORY} worktrees."));
    }
    if target.symlink_metadata().is_ok() {
        return Err("A worktree for this branch already exists.".to_string());
    }
    let existing_head = local_branch_head(&root, branch)?;
    let result = match (existing_head.as_deref(), start_point) {
        (Some(_), Some(_)) => return Err("A branch with this name already exists.".to_string()),
        (Some(_), None) => run_worktree_command(&root, &[OsStr::new("worktree"), OsStr::new("add"), target.as_os_str(), OsStr::new(branch)]),
        (None, start) => {
            let start = resolve_worktree_start_point(&root, start.unwrap_or("HEAD"))?;
            run_worktree_command(
                &root,
                &[OsStr::new("worktree"), OsStr::new("add"), OsStr::new("-b"), OsStr::new(branch), target.as_os_str(), OsStr::new(start.as_str())],
            )
        }
    };
    if let Err(error) = result {
        let _ = fs::remove_dir(&target);
        return Err(sanitize_git_failure_reason(&error));
    }
    let worktree_path = ensure_worktree_path_in_base(&root, &target)?;
    Ok(CreatedBranchWorktree { worktree_path, branch: branch.to_string() })
}
```

Adapt `GitWorktreeCommandGateway::new().list_worktrees` to the real name of the command gateway type at `git_worktree.rs:273` (the `impl … { pub fn new() … }` block). `resolve_worktree_start_point("HEAD")` is valid because `HEAD` passes `check-ref-format --branch`? It does not. Special-case it: when `start` is `None`, resolve with `repository_head(&root)?` instead of calling `resolve_worktree_start_point`. Replace the `(None, start)` arm body accordingly:

```rust
        (None, start) => {
            let start = match start {
                Some(reference) => resolve_worktree_start_point(&root, reference)?,
                None => repository_head(&root)?,
            };
```

In `lib_composition/git_worktree_commands.rs` add:

```rust
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AddBranchWorktreeRequest {
    repository_root: String,
    branch: String,
    start_point: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BranchWorktreeReceipt {
    worktree_path: String,
    branch: String,
}

#[tauri::command]
pub(crate) async fn add_git_branch_worktree(
    request: AddBranchWorktreeRequest,
    trust: GitTrustState<'_>,
) -> Result<BranchWorktreeReceipt, String> {
    ensure_worktree_repository_trusted(trusted_for(&trust, &request.repository_root)?)?;
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&request.repository_root)?;
        let created = git_worktree::add_branch_worktree(&root, &request.branch, request.start_point.as_deref())?;
        Ok(BranchWorktreeReceipt {
            worktree_path: created.worktree_path.to_string_lossy().to_string(),
            branch: created.branch,
        })
    })
    .await
}
```

Follow the file's existing import style for `trusted_for`, `GitTrustState`, `canonicalize_workspace_root`, `run_blocking_command` and the `git_worktree` module path. Also mirror what `add_git_worktree` does after creation for trust (`set_worktree_trust`, if it marks the new worktree trusted), so a later thread in that worktree is not blocked. Register `git_worktree_commands::add_git_branch_worktree` in `runtime.rs`. Add a command test: an unknown field is rejected; untrusted → `UNTRUSTED_WORKTREE_REPOSITORY_ERROR`.

Run: `cd src-tauri && cargo test --lib git_worktree && cargo test --lib git_worktree_commands && cargo clippy --all-targets -- -D warnings`
Expected: PASS.

- [ ] **Step 3: TS contract (tests first)**

Append to `src/infrastructure/tauriGitWorktreeIpcContract.test.ts`:

```ts
describe("add_git_branch_worktree", () => {
  it("sends the validated request and parses the receipt", async () => {
    const calls: Array<{ command: string; args: unknown }> = [];
    const receipt = await invokeAddBranchWorktreeIpc(
      async (command, args) => {
        calls.push({ command, args });
        return { worktreePath: "/repo/.codevo-worktrees/branch-feat-x", branch: "feat/x" };
      },
      { repositoryRoot: "/repo", branch: "feat/x", startPoint: "main" },
    );
    expect(calls).toEqual([
      {
        command: ADD_GIT_BRANCH_WORKTREE_IPC_COMMAND,
        args: { request: { repositoryRoot: "/repo", branch: "feat/x", startPoint: "main" } },
      },
    ]);
    expect(receipt.branch).toBe("feat/x");
  });

  it("rejects option-like branch names before invoking", async () => {
    let invoked = false;
    await expect(
      invokeAddBranchWorktreeIpc(
        async () => {
          invoked = true;
          return null;
        },
        { repositoryRoot: "/repo", branch: "--force", startPoint: null },
      ),
    ).rejects.toThrow();
    expect(invoked).toBe(false);
  });
});
```

Use the real worktree base directory name from `WORKTREE_BASE_DIR_NAME` in the fixture path if the parser checks it. Implement:
- `BranchWorktreeRequest`, `BranchWorktreeReceipt`, `parseBranchWorktreeReceipt` (exact keys, absolute path, branch validated like `validateGitBaseRef`), and the optional gateway method `addBranchWorktree?(request: BranchWorktreeRequest): Promise<BranchWorktreeReceipt>` in `src/domain/gitWorktree.ts` (optional, so other implementers of the interface stay valid);
- `ADD_GIT_BRANCH_WORKTREE_IPC_COMMAND`, `validateBranchWorktreeRequest` and `invokeAddBranchWorktreeIpc` in the contract;
- `addBranchWorktree` in `TauriGitWorktreeGateway`.

Then:
- in `agentRightPanelGateways.ts`: `readonly worktrees: { addBranchWorktree(request: BranchWorktreeRequest): Promise<BranchWorktreeReceipt> };` with default `new TauriGitWorktreeGateway()` (its method is defined, so it satisfies the required shape);
- in `agentRightPanelTestSupport.tsx`: add rejecting defaults for `pullRequest` and `worktrees` and delete the `as AgentRightPanelGateways` cast.

Run: `npx vitest run src/infrastructure/tauriGitWorktreeIpcContract.test.ts src/domain && npm run check`
Expected: PASS.

- [ ] **Step 4: Tell P9**

The lead forwards the final signature of `resolve_worktree_start_point` to the P9 implementer if P9 runs later. It is unchanged from the agreement.

- [ ] **Step 5: Hand off (no commit)**

---
### Task 10: Commit selection, generated commit messages and selective ship commits

**Files:**
- Create: `src/domain/gitCommitSelection.ts`, `src/domain/commitMessageDraft.ts`
- Modify:
  - `src/domain/agentShip.ts`: commit failure reason adds `"staleSelection"`;
  - `src/application/useAgentShipFlow.ts`: `commit(threadId, message, selection?)`;
  - `src/application/agentThreadPorts.ts`: `commitThreadChanges(threadId, message, selection?)`;
  - `src/components/agentMode/useAgentShipActions.ts`: move the `AgentShipActions` type here, change `onCommit` / `onPush` to return `Promise<void>`, and add the `selection` parameter to `onCommit`;
  - `src/components/agentMode/agentThreadsSurfaceTestFixtures.ts`: the fixture signature.
- Test: `src/domain/gitCommitSelection.test.ts`, `src/domain/commitMessageDraft.test.ts`, `src/application/useAgentShipFlow.test.tsx`, `src/components/agentMode/useAgentShipActions.test.ts`

**Interfaces:**
- Consumes: `GitChangedFile`, `GitChangeStatus`, `MAX_AGENT_SHIP_COMMIT_MESSAGE_BYTES`.
- Produces:
  - `type AgentCommitSelection = { kind: "all" } | { kind: "paths"; relativePaths: ReadonlyArray<string> }`, `ALL_CHANGES: AgentCommitSelection`
  - `STALE_COMMIT_SELECTION_MESSAGE = "The change list changed. Review the selection and commit again."`
  - `selectCommitChanges(changes, selection): { kind: "ok"; changes } | { kind: "empty" } | { kind: "stale"; missing: ReadonlyArray<string> }`
  - `includeSelection(paths, excluded): AgentCommitSelection`, `includeSummary(paths, excluded): { included; total; checked: boolean | "mixed" }`, `setIncluded(excluded, path, include): ReadonlySet<string>`, `setAllIncluded(paths, include): ReadonlySet<string>`, `pruneExcluded(excluded, paths): ReadonlySet<string>`
  - `interface CommitMessageFile { relativePath: string; status: GitChangeStatus }`, `generateCommitMessage(input: { files: ReadonlyArray<CommitMessageFile>; threadTitle: string | null }): string`
  - `AgentShipActions` (now exported from `useAgentShipActions.ts`) with `onCommit(threadId: string, message: string, selection?: AgentCommitSelection): Promise<void>` and `onPush(threadId: string): Promise<void>`

- [ ] **Step 1: Write the failing domain tests**

Create `src/domain/gitCommitSelection.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { GitChangedFile } from "./git";
import {
  ALL_CHANGES,
  includeSelection,
  includeSummary,
  pruneExcluded,
  selectCommitChanges,
  setAllIncluded,
  setIncluded,
} from "./gitCommitSelection";

function change(relativePath: string): GitChangedFile {
  return { isStaged: false, isUnversioned: false, oldPath: null, oldRelativePath: null, path: `/r/${relativePath}`, relativePath, status: "modified" };
}

describe("commit selection", () => {
  const changes = [change("a.ts"), change("b.ts"), change(".env.example")];

  it("commits everything for the all selection", () => {
    expect(selectCommitChanges(changes, ALL_CHANGES)).toEqual({ kind: "ok", changes });
  });

  it("commits exactly the selected paths that still changed", () => {
    expect(selectCommitChanges(changes, { kind: "paths", relativePaths: ["b.ts", "a.ts"] })).toEqual({
      kind: "ok",
      changes: [changes[0], changes[1]],
    });
  });

  it("fails closed when a selected path no longer has changes", () => {
    expect(selectCommitChanges(changes, { kind: "paths", relativePaths: ["a.ts", "gone.ts"] })).toEqual({
      kind: "stale",
      missing: ["gone.ts"],
    });
  });

  it("reports nothing to commit", () => {
    expect(selectCommitChanges([], ALL_CHANGES)).toEqual({ kind: "empty" });
    expect(selectCommitChanges(changes, { kind: "paths", relativePaths: [] })).toEqual({ kind: "empty" });
  });

  it("tracks include checkboxes as an excluded set", () => {
    const paths = changes.map((item) => item.relativePath);
    const excluded = setIncluded(new Set(), ".env.example", false);
    expect(includeSummary(paths, excluded)).toEqual({ included: 2, total: 3, checked: "mixed" });
    expect(includeSelection(paths, excluded)).toEqual({ kind: "paths", relativePaths: ["a.ts", "b.ts"] });
    expect(includeSelection(paths, new Set())).toEqual(ALL_CHANGES);
    expect(includeSummary(paths, setAllIncluded(paths, false))).toEqual({ included: 0, total: 3, checked: false });
    expect(pruneExcluded(new Set(["gone.ts", "a.ts"]), paths)).toEqual(new Set(["a.ts"]));
  });
});
```

Create `src/domain/commitMessageDraft.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { generateCommitMessage } from "./commitMessageDraft";

describe("generateCommitMessage", () => {
  it("uses the thread title as subject and infers a feat with a shared scope", () => {
    expect(
      generateCommitMessage({
        files: [
          { relativePath: "src/orders/idempotency.ts", status: "added" },
          { relativePath: "src/orders/routes.ts", status: "modified" },
        ],
        threadTitle: "Replay responses for repeated Idempotency-Key.",
      }),
    ).toBe("feat(orders): replay responses for repeated Idempotency-Key");
  });

  it("detects test-only and docs-only changes", () => {
    expect(
      generateCommitMessage({ files: [{ relativePath: "test/orders.test.ts", status: "modified" }], threadTitle: "Cover retries" }),
    ).toBe("test(orders): cover retries");
    expect(generateCommitMessage({ files: [{ relativePath: "README.md", status: "modified" }], threadTitle: null })).toBe(
      "docs: update README.md",
    );
  });

  it("falls back to a file summary without a title", () => {
    expect(
      generateCommitMessage({
        files: [
          { relativePath: "src/a.ts", status: "modified" },
          { relativePath: "lib/b.ts", status: "modified" },
        ],
        threadTitle: "  ",
      }),
    ).toBe("fix: update 2 files");
  });

  it("keeps the subject within 72 characters on one line", () => {
    const message = generateCommitMessage({
      files: [{ relativePath: "src/a.ts", status: "modified" }],
      threadTitle: `Title\nwith newline ${"x".repeat(200)}`,
    });
    expect(message.includes("\n")).toBe(false);
    expect(message.length).toBeLessThanOrEqual(90);
  });
});
```

The scope for `test/orders.test.ts` is the file stem without `.test` (`orders`). The rules are defined in Step 2.

- [ ] **Step 2: Implement the domain modules**

Create `src/domain/gitCommitSelection.ts`:

```ts
import type { GitChangedFile } from "./git";

export type AgentCommitSelection =
  | { readonly kind: "all" }
  | { readonly kind: "paths"; readonly relativePaths: ReadonlyArray<string> };

export const ALL_CHANGES: AgentCommitSelection = Object.freeze({ kind: "all" });
export const MAX_COMMIT_SELECTION_PATHS = 2_000;
export const STALE_COMMIT_SELECTION_MESSAGE = "The change list changed. Review the selection and commit again.";

export type CommitChangesSelection =
  | { readonly kind: "ok"; readonly changes: ReadonlyArray<GitChangedFile> }
  | { readonly kind: "empty" }
  | { readonly kind: "stale"; readonly missing: ReadonlyArray<string> };

export function selectCommitChanges(
  changes: ReadonlyArray<GitChangedFile>,
  selection: AgentCommitSelection,
): CommitChangesSelection {
  if (selection.kind === "all") return changes.length === 0 ? { kind: "empty" } : { kind: "ok", changes };
  const wanted = new Set(selection.relativePaths.slice(0, MAX_COMMIT_SELECTION_PATHS));
  if (wanted.size === 0) return { kind: "empty" };
  const present = new Set(changes.map((change) => change.relativePath));
  const missing = [...wanted].filter((path) => !present.has(path));
  if (missing.length > 0) return { kind: "stale", missing };
  return { kind: "ok", changes: changes.filter((change) => wanted.has(change.relativePath)) };
}

export function includeSelection(paths: ReadonlyArray<string>, excluded: ReadonlySet<string>): AgentCommitSelection {
  const effective = pruneExcluded(excluded, paths);
  if (effective.size === 0) return ALL_CHANGES;
  return { kind: "paths", relativePaths: paths.filter((path) => !effective.has(path)) };
}

export function includeSummary(
  paths: ReadonlyArray<string>,
  excluded: ReadonlySet<string>,
): { readonly included: number; readonly total: number; readonly checked: boolean | "mixed" } {
  const included = paths.length - pruneExcluded(excluded, paths).size;
  if (included === 0) return { included, total: paths.length, checked: false };
  if (included === paths.length) return { included, total: paths.length, checked: true };
  return { included, total: paths.length, checked: "mixed" };
}

export function setIncluded(excluded: ReadonlySet<string>, path: string, include: boolean): ReadonlySet<string> {
  const next = new Set(excluded);
  if (include) {
    next.delete(path);
    return next;
  }
  next.add(path);
  return next;
}

export function setAllIncluded(paths: ReadonlyArray<string>, include: boolean): ReadonlySet<string> {
  return include ? new Set() : new Set(paths);
}

export function pruneExcluded(excluded: ReadonlySet<string>, paths: ReadonlyArray<string>): ReadonlySet<string> {
  const present = new Set(paths);
  return new Set([...excluded].filter((path) => present.has(path)));
}
```

Create `src/domain/commitMessageDraft.ts`:

```ts
import type { GitChangeStatus } from "./git";

export interface CommitMessageFile {
  readonly relativePath: string;
  readonly status: GitChangeStatus;
}

const MAX_SUBJECT_CHARACTERS = 72;
const SOURCE_ROOTS = new Set(["src", "lib", "app", "test", "tests", "__tests__", "spec"]);
const TEST_FILE = /(^|\/)(test|tests|__tests__|spec)\/|\.(test|spec)\.[cm]?[jt]sx?$/;
const DOC_FILE = /(^|\/)docs\/|\.(md|mdx|txt|rst)$/i;
const CONFIG_FILE =
  /(^|\/)(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|tsconfig[^/]*\.json|\.github\/.*|[^/]*\.config\.[cm]?[jt]s|\.env[^/]*)$/;

export function generateCommitMessage(input: {
  readonly files: ReadonlyArray<CommitMessageFile>;
  readonly threadTitle: string | null;
}): string {
  const type = commitType(input.files);
  const scope = commitScope(input.files);
  const subject = commitSubject(input.files, input.threadTitle);
  return `${type}${scope === null ? "" : `(${scope})`}: ${subject}`;
}

function commitType(files: ReadonlyArray<CommitMessageFile>): string {
  if (files.length > 0 && files.every((file) => TEST_FILE.test(file.relativePath))) return "test";
  if (files.length > 0 && files.every((file) => DOC_FILE.test(file.relativePath))) return "docs";
  if (files.length > 0 && files.every((file) => CONFIG_FILE.test(file.relativePath))) return "chore";
  if (files.some((file) => file.status === "added" || file.status === "untracked")) return "feat";
  return "fix";
}

function commitScope(files: ReadonlyArray<CommitMessageFile>): string | null {
  const scopes = new Set(files.map((file) => fileScope(file.relativePath)));
  if (scopes.size !== 1) return null;
  const [scope] = [...scopes];
  return scope === undefined || scope.length === 0 ? null : scope;
}

function fileScope(relativePath: string): string {
  const segments = relativePath.split("/");
  const meaningful = segments.slice(0, -1).filter((segment) => !SOURCE_ROOTS.has(segment));
  if (meaningful.length > 0) return sanitizeScope(meaningful[0] ?? "");
  if (DOC_FILE.test(relativePath) || CONFIG_FILE.test(relativePath)) return "";
  const name = segments[segments.length - 1] ?? "";
  return sanitizeScope(name.replace(/\.(test|spec)(?=\.)/, "").replace(/\.[^.]+$/, ""));
}

function sanitizeScope(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
}

function commitSubject(files: ReadonlyArray<CommitMessageFile>, threadTitle: string | null): string {
  const title = (threadTitle ?? "").replace(/\s+/g, " ").trim().replace(/[.。]+$/, "");
  if (title.length > 0) return clipSubject(title.charAt(0).toLowerCase() + title.slice(1));
  if (files.length === 1) return clipSubject(`update ${files[0]?.relativePath.split("/").pop() ?? "file"}`);
  return `update ${files.length} files`;
}

function clipSubject(subject: string): string {
  if (subject.length <= MAX_SUBJECT_CHARACTERS) return subject;
  return subject.slice(0, MAX_SUBJECT_CHARACTERS).trimEnd();
}
```

Check the tests against these rules:
- `test/orders.test.ts`: `test` is a source root, so no directory scope, and the stem gives `orders`. Result `test(orders)`.
- `README.md`: docs-only gives type `docs`. `fileScope` gives `""` because a root doc has no scope, so `commitScope` returns `null`. The subject is `update README.md`.
- `src/orders/*`: scope `orders`, type `feat` (an added file).
- `src/a.ts` + `lib/b.ts`: the scopes are `a` and `b`, so there is no scope; type `fix`.

Run: `npx vitest run src/domain/gitCommitSelection.test.ts src/domain/commitMessageDraft.test.ts`
Expected: PASS.

- [ ] **Step 3: Write the failing ship-flow tests**

Append to `src/application/useAgentShipFlow.test.tsx` (use the file's `renderFlow` harness and its `change(index)` fixture, whose relative paths the implementer reads from the fixture):

```tsx
it("commits only the selected paths", async () => {
  const harness = renderFlow({ changeCount: 3 });
  const selected = [change(0).relativePath, change(2).relativePath];
  await act(() => harness.hook().commit(THREAD_ID, "Pick two", { kind: "paths", relativePaths: selected }));
  expect(harness.gitGateway.stageFiles).toHaveBeenCalledWith(WORKTREE, [change(0), change(2)]);
  expect(harness.gitGateway.commit).toHaveBeenCalledWith(WORKTREE, "Pick two", [change(0), change(2)]);
});

it("fails closed with a stale selection and commits nothing", async () => {
  const harness = renderFlow({ changeCount: 1 });
  await act(() =>
    harness.hook().commit(THREAD_ID, "Stale", { kind: "paths", relativePaths: ["no/longer/changed.ts"] }),
  );
  expect(harness.gitGateway.commit).not.toHaveBeenCalled();
  expect(harness.shipState(THREAD_ID)).toMatchObject({
    kind: "failed",
    failure: { step: "commit", reason: "staleSelection" },
  });
});
```

`harness.shipState` stands for however the harness exposes the reducer state today. Use its real accessor.

- [ ] **Step 4: Implement the selection in the flow**

- `src/domain/agentShip.ts`: commit failure reason becomes `"nothingToCommit" | "gitError" | "staleSelection"`. If a persisted-state parser in that file validates the reason list, add the value there too.
- `src/application/agentThreadPorts.ts`: `commitThreadChanges(threadId: string, message: string, selection?: AgentCommitSelection): Promise<void>;`
- `src/application/useAgentShipFlow.ts`: change the `commit` callback signature to `(threadId: string, message: string, selection: AgentCommitSelection = ALL_CHANGES)`, and replace the block from `if (status.changes.length === 0) {` through the `commit(...)` call with:

```ts
        const selected = selectCommitChanges(status.changes, selection);
        if (selected.kind === "empty") {
          apply(threadId, {
            kind: "stepFailed",
            failure: { step: "commit", reason: "nothingToCommit", message: "Nothing to commit." },
          });
          void refreshShipStatus(threadId);
          return;
        }
        if (selected.kind === "stale") {
          apply(threadId, {
            kind: "stepFailed",
            failure: { step: "commit", reason: "staleSelection", message: STALE_COMMIT_SELECTION_MESSAGE },
          });
          void refreshShipStatus(threadId);
          return;
        }
        const changes = [...selected.changes];
        await dependenciesRef.current.gitGateway.stageFiles(target.targetPath, changes);
        if (!owns(target)) return authorityLost(threadId, "commit");
        await dependenciesRef.current.gitGateway.commit(target.targetPath, bounded, changes);
```

  `useAgentThreads.ts` forwards `ship.commit` by reference, so the new parameter reaches it without an edit.
- `src/components/agentMode/useAgentShipActions.ts`: move `export interface AgentShipActions` here from `AgentShipPanel.tsx`, and in `AgentShipPanel.tsx` replace the definition with `export type { AgentShipActions } from "./useAgentShipActions";` so the panel keeps compiling until Task 11 deletes it. Update the types:

```ts
  onCommit(threadId: string, message: string, selection?: AgentCommitSelection): Promise<void>;
  onPush(threadId: string): Promise<void>;
```

  and the implementations:

```ts
      onCommit: async (threadId, message, selection) => {
        if (!allowed(threadId)) return;
        await commitThreadChanges(threadId, message, selection);
      },
      onPush: async (threadId) => {
        if (!allowed(threadId)) return;
        await pushThreadBranch(threadId);
      },
```

  Update `agentThreadsSurfaceTestFixtures.ts` if its `commitThreadChanges` fixture is typed with two parameters (an `async () => undefined` stays valid).

Run: `npx vitest run src/domain src/application/useAgentShipFlow.test.tsx src/components/agentMode/useAgentShipActions.test.ts src/components/agentMode/AgentShipPanel.test.tsx src/components/agentMode/AgentCommitMenu.test.tsx && npm run check`
Expected: PASS.

- [ ] **Step 5: Hand off (no commit)**

---

### Task 11: Git surface (changes with include checkboxes, commit box, Commit / Commit & push, unpushed list, more menu, ship banner) and the top-bar Commit button

**Files:**
- Create:
  - application: `src/application/rightPanel/projectGitCommitPort.ts`, `src/application/rightPanel/useAgentGitSurface.ts`;
  - components (`src/components/agentMode/rightPanel/git/`): `threadGitCommitPort.ts`, `AgentGitSurfaceContainer.tsx`, `AgentGitSurface.tsx`, `AgentGitChangesList.tsx`, `AgentGitCommitBox.tsx`, `AgentGitMoreMenu.tsx`, `AgentGitShipBanner.tsx`, `agentGit.css`.
- Modify (integration):
  - `AgentRightPanelSurfaceBody.tsx`: the `git` case;
  - `agentRightPanelContext.ts`: import `AgentShipActions` from `../useAgentShipActions`;
  - `AgentModeView.tsx`: pass `shipActions` to `AgentSurfaceHost`, drop it from `AgentThreadHeader`;
  - `AgentThreadHeader.tsx`: replace `<AgentCommitMenu/>` with the Commit button, and add the `gitSurfaceActive` prop.
- Delete: `AgentCommitMenu.tsx` (+ test), `AgentShipPanel.tsx` (+ test), and their `.agent-ship*` / `.agent-commit-menu*` rules (in whichever sheets `rg` finds them).
- Test: `src/application/rightPanel/projectGitCommitPort.test.ts`, `src/application/rightPanel/useAgentGitSurface.test.tsx`, `src/components/agentMode/rightPanel/git/AgentGitSurface.test.tsx`, `src/components/agentMode/AgentThreadHeader.test.tsx`

**Interfaces:**
- Consumes:
  - Task 10: selection, message generator, `AgentShipActions`.
  - Task 7: context, `gitSurfaceStatusValue`, `GitSurfaceStatus`.
  - Existing: `agentShipAvailability`, `agentShipStatus`, `agentShipStepLabel`, `agentShipFailureLabel`, `agentShipFailureActions`, `agentShipConflictFiles`, `agentShipRetryLabel`, `agentShipDefaultIntegrationMode`.
- Produces:
  - `interface AgentGitCommitPort { commit(message, selection): Promise<AgentGitCommitOutcome>; commitAndPush(message, selection): Promise<AgentGitCommitOutcome> }`
  - `type AgentGitCommitOutcome = { kind: "committed" } | { kind: "pushed" } | { kind: "failed"; message: string }`
  - `projectGitCommitPort(git, rootPath): AgentGitCommitPort` (application), `threadGitCommitPort(actions, threadId, readShip: () => AgentShipState): AgentGitCommitPort` (component layer, `git/threadGitCommitPort.ts`)
  - `interface AgentGitChangeRow { relativePath; status; added; deleted; included }`
  - `useAgentGitSurface(options): AgentGitSurfaceState`
  - `AgentGitSurfaceProps.branchControl: ReactNode`: Task 12 renders the picker there; this task renders a static branch label.

- [ ] **Step 1: Write the failing port and hook tests**

Create `src/application/rightPanel/projectGitCommitPort.test.ts`. The fake is a `GitGateway` subset, which stands in for the Tauri boundary:

```ts
import { describe, expect, it } from "vitest";
import type { GitChangedFile, GitStatus } from "../../domain/git";
import { projectGitCommitPort } from "./projectGitCommitPort";

function change(relativePath: string, isStaged = false): GitChangedFile {
  return { isStaged, isUnversioned: false, oldPath: null, oldRelativePath: null, path: `/r/${relativePath}`, relativePath, status: "modified" };
}

function gateway(changes: GitChangedFile[]) {
  const calls: string[] = [];
  const status = (): GitStatus => ({ branch: "main", changes, isRepository: true, rootPath: "/r" });
  return {
    calls,
    git: {
      getStatus: async () => status(),
      stageFiles: async (_root: string, files: GitChangedFile[]) => {
        calls.push(`stage:${files.map((file) => file.relativePath).join(",")}`);
        return status();
      },
      commit: async (_root: string, message: string, files: GitChangedFile[]) => {
        calls.push(`commit:${message}:${files.map((file) => file.relativePath).join(",")}`);
        return status();
      },
      push: async () => {
        calls.push("push");
        return status();
      },
    },
  };
}

describe("projectGitCommitPort", () => {
  it("stages only unstaged selected files, commits them and pushes on request", async () => {
    const fake = gateway([change("a.ts"), change("b.ts", true), change("c.ts")]);
    const port = projectGitCommitPort(fake.git, "/r");

    await expect(port.commitAndPush("msg", { kind: "paths", relativePaths: ["a.ts", "b.ts"] })).resolves.toEqual({ kind: "pushed" });
    expect(fake.calls).toEqual(["stage:a.ts", "commit:msg:a.ts,b.ts", "push"]);
  });

  it("returns a failure for stale or empty selections without committing", async () => {
    const fake = gateway([change("a.ts")]);
    const port = projectGitCommitPort(fake.git, "/r");
    await expect(port.commit("m", { kind: "paths", relativePaths: ["x.ts"] })).resolves.toMatchObject({ kind: "failed" });
    await expect(projectGitCommitPort(gateway([]).git, "/r").commit("m", { kind: "all" })).resolves.toEqual({
      kind: "failed",
      message: "Nothing to commit.",
    });
    expect(fake.calls).toEqual([]);
  });

  it("reports a gateway error as a failure", async () => {
    const fake = gateway([change("a.ts")]);
    const port = projectGitCommitPort({ ...fake.git, commit: () => Promise.reject(new Error("hook rejected")) }, "/r");
    await expect(port.commit("m", { kind: "all" })).resolves.toEqual({ kind: "failed", message: "hook rejected" });
  });
});
```

Create `src/application/rightPanel/useAgentGitSurface.test.tsx` covering:
- (a) rows from `getStatus` merged with line stats;
- (b) toggling a row excludes it and the header summary becomes `mixed`;
- (c) `commit()` with an empty message calls the port with the generated message and the exact `paths` selection;
- (d) an owner switch while the port is pending ignores the late outcome (no notice, no draft reset for the new owner);
- (e) drafts are kept per owner (type in A, switch to B then back to A, draft restored);
- (f) a failed outcome shows the error notice and keeps the draft.

Use `projectGitCommitPort` over the same in-memory gateway for (a)-(c), and a deferred-promise port object (an implementation of the application port) for (d).

- [ ] **Step 2: Implement the ports and hook**

Create `src/application/rightPanel/projectGitCommitPort.ts`:

```ts
import type { GitGateway } from "../../domain/git";
import { STALE_COMMIT_SELECTION_MESSAGE, selectCommitChanges, type AgentCommitSelection } from "../../domain/gitCommitSelection";

export type AgentGitCommitOutcome =
  | { readonly kind: "committed" }
  | { readonly kind: "pushed" }
  | { readonly kind: "failed"; readonly message: string };

export interface AgentGitCommitPort {
  commit(message: string, selection: AgentCommitSelection): Promise<AgentGitCommitOutcome>;
  commitAndPush(message: string, selection: AgentCommitSelection): Promise<AgentGitCommitOutcome>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.length > 0 ? error.message : "Git reported an error.";
}
```

Create `src/components/agentMode/rightPanel/git/threadGitCommitPort.ts`. It stays in the component layer because it reads the component presenter `agentShipFailureLabel`, which covers failure variants without a `message`:

```ts
import type { AgentGitCommitOutcome, AgentGitCommitPort } from "../../../../application/rightPanel/projectGitCommitPort";
import type { AgentShipState } from "../../../../domain/agentShip";
import type { AgentCommitSelection } from "../../../../domain/gitCommitSelection";
import { agentShipFailureLabel } from "../../agentModePresentation";

export interface AgentShipCommitActions {
  onCommit(threadId: string, message: string, selection?: AgentCommitSelection): Promise<void>;
  onPush(threadId: string): Promise<void>;
}

export function threadGitCommitPort(
  actions: AgentShipCommitActions,
  threadId: string,
  readShip: () => AgentShipState,
): AgentGitCommitPort {
  const outcome = (success: AgentGitCommitOutcome): AgentGitCommitOutcome => {
    const ship = readShip();
    if (ship.kind === "failed") return { kind: "failed", message: agentShipFailureLabel(ship.failure) };
    return success;
  };
  return {
    async commit(message, selection) {
      await actions.onCommit(threadId, message, selection);
      return outcome({ kind: "committed" });
    },
    async commitAndPush(message, selection) {
      await actions.onCommit(threadId, message, selection);
      const committed = outcome({ kind: "committed" });
      if (committed.kind !== "committed") return committed;
      await actions.onPush(threadId);
      return outcome({ kind: "pushed" });
    },
  };
}
```

If `AgentShipState` names its failed variant differently (check `src/domain/agentShip.ts`), adapt the `ship.kind === "failed"` guard to the real discriminant.

Create `src/application/rightPanel/useAgentGitSurface.ts`:

```ts
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { generateCommitMessage } from "../../domain/commitMessageDraft";
import type { GitChangedFile, GitChangeStatus, GitGateway } from "../../domain/git";
import {
  includeSelection,
  includeSummary,
  pruneExcluded,
  setAllIncluded,
  setIncluded,
} from "../../domain/gitCommitSelection";
import type { GitLineStat } from "../../domain/gitSurfaceStatus";
import { useLatest } from "../../ui/foundation/useLatest";
import type { AgentGitCommitPort } from "./projectGitCommitPort";

export const MAX_COMMIT_MESSAGE_DRAFTS = 32;

export interface AgentGitChangeRow {
  readonly relativePath: string;
  readonly status: GitChangeStatus;
  readonly added: number | null;
  readonly deleted: number | null;
  readonly included: boolean;
}

export type AgentGitBusy = "idle" | "committing" | "pushing";

export interface AgentGitSurfaceState {
  readonly rows: ReadonlyArray<AgentGitChangeRow>;
  readonly loading: boolean;
  readonly error: string | null;
  readonly summary: { readonly included: number; readonly total: number; readonly checked: boolean | "mixed" };
  readonly message: string;
  readonly busy: AgentGitBusy;
  readonly notice: { readonly kind: "ok" | "error"; readonly text: string } | null;
  setMessage(message: string): void;
  setRowIncluded(relativePath: string, include: boolean): void;
  setAllIncluded(include: boolean): void;
  generate(): void;
  commit(): void;
  commitAndPush(): void;
  refresh(): void;
}

export interface UseAgentGitSurfaceOptions {
  readonly ownerKey: string | null;
  readonly rootPath: string | null;
  readonly git: Pick<GitGateway, "getStatus"> | null;
  readonly lineStats: ReadonlyArray<GitLineStat>;
  readonly port: AgentGitCommitPort | null;
  readonly threadTitle: string | null;
  onCommitted(): void;
}

export function useAgentGitSurface(options: UseAgentGitSurfaceOptions): AgentGitSurfaceState {
  const { git, lineStats, ownerKey, rootPath, threadTitle } = options;
  const [changes, setChanges] = useState<{ readonly key: string | null; readonly files: ReadonlyArray<GitChangedFile> }>({ key: null, files: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(() => new Set());
  const [drafts, setDrafts] = useState<ReadonlyMap<string, string>>(() => new Map());
  const [busy, setBusy] = useState<AgentGitBusy>("idle");
  const [notice, setNotice] = useState<AgentGitSurfaceState["notice"]>(null);
  const [nonce, setNonce] = useState(0);
  const generation = useRef(0);
  const ownerRef = useLatest(ownerKey);
  const gitRef = useLatest(git);
  const portRef = useLatest(options.port);
  const onCommittedRef = useLatest(options.onCommitted);
  const statusKey = ownerKey === null || rootPath === null ? null : JSON.stringify([ownerKey, rootPath]);

  useEffect(() => {
    generation.current += 1;
    const current = generation.current;
    setExcluded(new Set());
    setNotice(null);
    setBusy("idle");
    const gateway = gitRef.current;
    if (statusKey === null || rootPath === null || gateway === null) {
      setChanges({ key: statusKey, files: [] });
      return;
    }
    setLoading(true);
    gateway.getStatus(rootPath).then(
      (status) => {
        if (generation.current !== current) return;
        setChanges({ key: statusKey, files: status.changes });
        setError(null);
        setLoading(false);
      },
      (reason: unknown) => {
        if (generation.current !== current) return;
        setError(reason instanceof Error ? reason.message : "Git status is unavailable.");
        setLoading(false);
      },
    );
  }, [gitRef, rootPath, statusKey, nonce]);

  const files = changes.key === statusKey ? changes.files : [];
  const paths = useMemo(() => files.map((file) => file.relativePath), [files]);
  const effectiveExcluded = useMemo(() => pruneExcluded(excluded, paths), [excluded, paths]);
  const stats = useMemo(() => new Map(lineStats.map((stat) => [stat.relativePath, stat])), [lineStats]);
  const rows = useMemo(
    () =>
      files.map((file) => ({
        relativePath: file.relativePath,
        status: file.status,
        added: stats.get(file.relativePath)?.added ?? null,
        deleted: stats.get(file.relativePath)?.deleted ?? null,
        included: !effectiveExcluded.has(file.relativePath),
      })),
    [effectiveExcluded, files, stats],
  );
  const message = ownerKey === null ? "" : (drafts.get(ownerKey) ?? "");

  const setMessage = useCallback(
    (next: string) => {
      const owner = ownerRef.current;
      if (owner === null) return;
      setDrafts((current) => boundedDrafts(current, owner, next));
    },
    [ownerRef],
  );

  const generated = () =>
    generateCommitMessage({
      files: rows.filter((row) => row.included).map((row) => ({ relativePath: row.relativePath, status: row.status })),
      threadTitle,
    });

  const run = (push: boolean) => {
    const owner = ownerRef.current;
    const port = portRef.current;
    if (owner === null || port === null || busy !== "idle") return;
    const selection = includeSelection(paths, effectiveExcluded);
    const text = message.trim().length > 0 ? message.trim() : generated();
    setBusy(push ? "pushing" : "committing");
    setNotice(null);
    const pending = push ? port.commitAndPush(text, selection) : port.commit(text, selection);
    void pending.then((outcome) => {
      if (ownerRef.current !== owner) return;
      setBusy("idle");
      if (outcome.kind === "failed") {
        setNotice({ kind: "error", text: outcome.message });
        return;
      }
      setDrafts((current) => boundedDrafts(current, owner, ""));
      setExcluded(new Set());
      setNotice({ kind: "ok", text: outcome.kind === "pushed" ? "Committed and pushed." : "Committed." });
      setNonce((value) => value + 1);
      onCommittedRef.current();
    });
  };

  return {
    rows,
    loading,
    error,
    summary: includeSummary(paths, effectiveExcluded),
    message,
    busy,
    notice,
    setMessage,
    setRowIncluded: (relativePath, include) => setExcluded((current) => setIncluded(current, relativePath, include)),
    setAllIncluded: (include) => setExcluded(setAllIncluded(paths, include)),
    generate: () => setMessage(generated()),
    commit: () => run(false),
    commitAndPush: () => run(true),
    refresh: () => setNonce((value) => value + 1),
  };
}

function boundedDrafts(current: ReadonlyMap<string, string>, owner: string, value: string): ReadonlyMap<string, string> {
  const next = new Map(current);
  next.delete(owner);
  if (value.length > 0) next.set(owner, value);
  while (next.size > MAX_COMMIT_MESSAGE_DRAFTS) next.delete(next.keys().next().value as string);
  return next;
}
```

Run: `npx vitest run src/application/rightPanel/projectGitCommitPort.test.ts src/application/rightPanel/useAgentGitSurface.test.tsx`
Expected: PASS.

- [ ] **Step 3: Write the failing surface test**

Create `src/components/agentMode/rightPanel/git/AgentGitSurface.test.tsx`. It renders `AgentGitSurface` with explicit props: rows, summary, unpushed commits, ahead/behind, notice, callbacks via `vi.fn()`, and `branchControl` set to a `<span>` label. It asserts:
- the header shows `3 of 4 files` with a `mixed` "Include all files" checkbox (`aria-checked="mixed"`), and totals `+42−7`;
- an excluded row shows `Excluded` instead of counts, with its path in the muted style class `cv-git-row--off`;
- clicking a row checkbox calls `onRowIncludedChange(path, false)`;
- Commit and Commit & push call their callbacks; both buttons are disabled while `busy !== "idle"` or when `summary.included === 0`;
- the textarea placeholder is `Leave empty to auto-generate`, and Generate calls `onGenerate`;
- the "Unpushed" section lists subject, short sha and relative age for each commit (fixed `nowMs` prop);
- "Create pull request" in the hint calls `onOpenPullRequest`, and appears only when `unpushedCount > 0 || aheadCount > 0`;
- the error notice renders with `role="alert"`, the ok notice with `role="status"`.

- [ ] **Step 4: Implement the Git surface components**

Create `src/components/agentMode/rightPanel/git/AgentGitSurface.tsx`:

```tsx
import { GitPullRequest, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import type { AgentGitChangeRow, AgentGitSurfaceState } from "../../../../application/rightPanel/useAgentGitSurface";
import type { GitUnpushedCommit } from "../../../../domain/gitSurfaceStatus";
import { IconButton } from "../../../../ui/foundation/IconButton";
import { AgentGitChangesList } from "./AgentGitChangesList";
import { AgentGitCommitBox } from "./AgentGitCommitBox";
import "./agentGit.css";

export interface AgentGitSurfaceProps {
  readonly branchControl: ReactNode;
  readonly moreMenu: ReactNode;
  readonly banner: ReactNode;
  readonly aheadCount: number | null;
  readonly behindCount: number | null;
  readonly upstreamName: string | null;
  readonly unpushed: ReadonlyArray<GitUnpushedCommit>;
  readonly nowMs: number;
  readonly state: Pick<AgentGitSurfaceState, "rows" | "loading" | "error" | "summary" | "message" | "busy" | "notice">;
  onRowIncludedChange(relativePath: string, include: boolean): void;
  onAllIncludedChange(include: boolean): void;
  onMessageChange(message: string): void;
  onGenerate(): void;
  onCommit(): void;
  onCommitAndPush(): void;
  onFetch(): void;
  onOpenPullRequest(): void;
}

export function AgentGitSurface(props: AgentGitSurfaceProps) {
  const unpublished = props.unpushed.length > 0 || (props.aheadCount ?? 0) > 0;
  return (
    <section aria-label="Git" className="cv-git">
      <div className="cv-rp-sub">
        <div className="cv-rp-sub__grow">{props.branchControl}</div>
        <div className="cv-rp-sub__tools">
          {props.aheadCount !== null && props.behindCount !== null && (
            <span
              className="cv-git-sync"
              title={`${props.aheadCount} ahead, ${props.behindCount} behind ${props.upstreamName ?? "upstream"}`}
            >
              ↑{props.aheadCount} ↓{props.behindCount}
            </span>
          )}
          <IconButton icon={<RefreshCw size={14} />} label="Fetch" onClick={props.onFetch} size="xs" />
          {props.moreMenu}
        </div>
      </div>
      <div className="cv-git__body">
        {props.banner}
        <AgentGitChangesList
          error={props.state.error}
          loading={props.state.loading}
          onAllIncludedChange={props.onAllIncludedChange}
          onRowIncludedChange={props.onRowIncludedChange}
          rows={props.state.rows}
          summary={props.state.summary}
        />
        {props.unpushed.length > 0 && (
          <div className="cv-git-history">
            <div className="cv-git-head">Unpushed</div>
            {props.unpushed.map((commit) => (
              <div className="cv-git-commit" key={commit.sha} title={commit.subject}>
                <span aria-hidden="true" className="cv-git-commit__dot" />
                <span className="cv-git-commit__msg">{commit.subject}</span>
                <span className="cv-git-commit__sha">{commit.shortSha}</span>
                <span className="cv-git-commit__ago">{relativeAge(commit.authoredAtEpochSeconds, props.nowMs)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="cv-git__foot">
        <AgentGitCommitBox
          busy={props.state.busy}
          canCommit={props.state.summary.included > 0}
          message={props.state.message}
          onCommit={props.onCommit}
          onCommitAndPush={props.onCommitAndPush}
          onGenerate={props.onGenerate}
          onMessageChange={props.onMessageChange}
        />
        {props.state.notice !== null && (
          <p
            className={`cv-git-notice cv-git-notice--${props.state.notice.kind}`}
            role={props.state.notice.kind === "error" ? "alert" : "status"}
          >
            {props.state.notice.text}
          </p>
        )}
        {unpublished && (
          <p className="cv-git-hint">
            Next:
            <button className="cv-git-hint__action" onClick={props.onOpenPullRequest} type="button">
              <GitPullRequest aria-hidden="true" size={12} />
              Create pull request
            </button>
          </p>
        )}
      </div>
    </section>
  );
}

export function relativeAge(epochSeconds: number, nowMs: number): string {
  const seconds = Math.max(0, Math.round(nowMs / 1000 - epochSeconds));
  if (seconds < 60) return "now";
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h`;
  return `${Math.floor(seconds / 86_400)}d`;
}

export type { AgentGitChangeRow };
```

Create `AgentGitChangesList.tsx` (header checkbox with the foundation `Checkbox` labelled "Include all files", then `<b>{included} of {total}</b> files` and totals via Task 6's `DiffStat`). Each row has:
- a `Checkbox` labelled `Include ${relativePath}`;
- a status letter `A/M/D/R/U/C` from a closed `switch` over `GitChangeStatus` (added→A, modified→M, deleted→D, renamed→R, untracked→U, conflicted→C);
- the path as a muted dir + name span with `title`;
- counts, or `Excluded` when not included; the row gets `cv-git-row--off` when excluded.

Loading renders `Loading changes…`; error renders the message with the warning note class; no rows renders `No changes to commit.`

Create `AgentGitCommitBox.tsx`: a `.cv-git-box` with:
- a `<textarea aria-label="Commit message" placeholder="Leave empty to auto-generate" rows={3}>`;
- a foot with a `Generate` text button (sparkle icon);
- `Button` "Commit";
- `Button variant="primary"` "Commit & push" (cloud-upload icon).

Both action buttons are disabled when `busy !== "idle" || !canCommit`. While busy, the primary label becomes `Committing…` / `Pushing…`.

Create `AgentGitMoreMenu.tsx` (thread scope only; project scope renders only Refresh and Show history). It uses an `IconButton` anchor "More Git actions" + `Menu`, with items driven by `agentShipAvailability(thread)`:
- `Push branch` → `actions.onPush`
- `Open compare page on {host}` when the ship status has a compare URL → `actions.onOpenCompareUrl`
- `Integrate into {primary} (fast-forward)` / `(merge commit)` → `actions.onIntegrate(threadId, "fastForward" | "merge")`
- `Remove worktree` / `Remove worktree and branch` → `actions.onRemoveWorktree(threadId, { deleteBranch })`
- `Discard worktree` (tone `danger`) → `actions.onDiscardWorktree`
- `Refresh status` → `actions.onRefreshShipStatus` + `refresh()`
- `Show history` → `openSurface("history")`

Blocked items are `disabled` with the reason as `title`. Worktree-only items are hidden for local threads. The ship flow's existing prompter confirms destructive actions, as today.

Create `AgentGitShipBanner.tsx`, which renders:
- `agentShipStepLabel(ship)` with a `StatusLabel kind="work" spinner` while a step runs;
- for `ship.kind === "failed"`: `agentShipFailureLabel`, the conflicted files from `agentShipConflictFiles` (bounded list with "+N more"), and `Retry` (label `agentShipRetryLabel`, action per `agentShipFailureActions`) / `Dismiss` (`actions.onDismissFailure`) buttons;
- the relation label (`agentShipRelationLabel(status)`) as quiet text.

This keeps every capability of the deleted `AgentShipPanel` status and failure sections.

Create `AgentGitSurfaceContainer.tsx`:

```tsx
import { GitBranch } from "lucide-react";
import { useMemo, useRef } from "react";
import { projectGitCommitPort } from "../../../../application/rightPanel/projectGitCommitPort";
import { useAgentGitSurface } from "../../../../application/rightPanel/useAgentGitSurface";
import { gitSurfaceStatusValue } from "../../../../application/rightPanel/useGitSurfaceStatus";
import { agentThreadDisplayTitle } from "../../agentModePresentation";
import { useAgentRightPanelContext } from "../agentRightPanelContext";
import { AgentGitMoreMenu } from "./AgentGitMoreMenu";
import { AgentGitShipBanner } from "./AgentGitShipBanner";
import { AgentGitSurface } from "./AgentGitSurface";
import { threadGitCommitPort } from "./threadGitCommitPort";

export function AgentGitSurfaceContainer() {
  const context = useAgentRightPanelContext();
  const { chrome, shipActions, target, thread } = context;
  const status = gitSurfaceStatusValue(context.gitStatus.load);
  const threadRef = useRef(thread);
  threadRef.current = thread;
  const port = useMemo(() => {
    if (chrome === null || target === null) return null;
    if (thread === null) return projectGitCommitPort(chrome.gateways.git, target.repositoryRoot);
    if (shipActions === null) return null;
    const threadId = thread.thread.threadId;
    return threadGitCommitPort(shipActions, threadId, () => threadRef.current?.ship ?? { kind: "idle", status: null });
  }, [chrome, shipActions, target, thread]);
  const git = useAgentGitSurface({
    ownerKey: thread?.thread.threadId ?? target?.repositoryRoot ?? null,
    rootPath: context.checkoutRoot,
    git: chrome?.gateways.git ?? null,
    lineStats: status?.lineStats ?? [],
    port,
    threadTitle: thread === null ? null : agentThreadDisplayTitle(thread.thread),
    onCommitted: context.gitStatus.refresh,
  });
  const fetch = () => {
    if (chrome === null || context.checkoutRoot === null) return;
    void chrome.gateways.git.fetch(context.checkoutRoot).then(context.gitStatus.refresh, context.gitStatus.refresh);
  };
  return (
    <AgentGitSurface
      aheadCount={status?.upstream?.ahead ?? null}
      banner={thread === null || shipActions === null ? null : <AgentGitShipBanner actions={shipActions} thread={thread} />}
      behindCount={status?.upstream?.behind ?? null}
      branchControl={
        <span className="cv-rp-ctl cv-rp-ctl--static">
          <GitBranch aria-hidden="true" size={14} />
          {status?.branch ?? "Detached HEAD"}
        </span>
      }
      moreMenu={
        <AgentGitMoreMenu
          actions={shipActions}
          onRefresh={() => {
            git.refresh();
            context.gitStatus.refresh();
          }}
          onShowHistory={() => context.openSurface("history")}
          thread={thread}
        />
      }
      nowMs={Date.now()}
      onAllIncludedChange={git.setAllIncluded}
      onCommit={git.commit}
      onCommitAndPush={git.commitAndPush}
      onFetch={fetch}
      onGenerate={git.generate}
      onMessageChange={git.setMessage}
      onOpenPullRequest={() => context.openSurface("pullRequest")}
      onRowIncludedChange={git.setRowIncluded}
      state={git}
      unpushed={status?.unpushed ?? []}
      upstreamName={status?.upstream?.name ?? null}
    />
  );
}
```

Replace the `threadRef.current = thread` render assignment with `const threadRef = useLatest(thread);` (foundation), for consistency with Task 5.

Create `agentGit.css` with `.cv-git*` rules mirroring the mockup's `screen-right-panel` git block. Every mockup variable maps to its `--cv-*` twin (`--tint-1` → `--cv-tint-1`, `--hair` → `--cv-hair`, `--r-control` → `--cv-r-control`, `--warn` → `--cv-warn`, `--ok` → `--cv-ok`, `--raised` → `--cv-raised`, `--lift` → `--cv-lift`, `--edge-top` → `--cv-edge-top`). The rules are:
- `.cv-git` (flex column, `min-height: 0`);
- `.cv-git__body` (`flex: 1; overflow: auto; padding: 8px 8px 12px`);
- `.cv-git__foot` (`flex: none; padding: 0 12px 12px`);
- `.cv-git-head`, `.cv-git-row` (30px min-height, `min-width: 0`), `.cv-git-row__path` (`min-width: 0; overflow-wrap: anywhere`, so long paths wrap instead of clipping), `.cv-git-row--off`;
- `.cv-git-status--added|modified|...`;
- `.cv-git-box` (14px radius, `var(--cv-raised)`, `border: 1px solid var(--cv-hair)`, `box-shadow: var(--cv-edge-top), var(--cv-lift)`);
- `.cv-git-box textarea` (min-height 76px, `resize: none`);
- `.cv-git-commit*`, `.cv-git-hint*`, `.cv-git-notice--error` (`color: var(--cv-danger)`), `.cv-git-sync` (mono, `var(--cv-t-2xs)`), `.cv-rp-ctl--static` (`cursor: default`).

No literal colors.

- [ ] **Step 5: Integration (lead, in order)**

1. `AgentRightPanelSurfaceBody.tsx`: split the `git` case out of the shared placeholder case: `case "git": return blockedOr(props, <AgentGitSurfaceContainer />);`.
2. `agentRightPanelContext.ts`: `import type { AgentShipActions } from "../useAgentShipActions";`.
3. `AgentModeView.tsx`: pass `shipActions={shipActions}` to `<AgentSurfaceHost>`; remove `shipActions` from `<AgentThreadHeader>`; pass `gitSurfaceActive={layout.rightPanel === "open" && layout.activeSurface === "git"}` to the header.
4. `AgentThreadHeader.tsx` (P2 structure): in the TopBar `trailing` slot, replace `<AgentCommitMenu … />` with:

```tsx
{thread !== null && (
  <Button
    aria-pressed={props.gitSurfaceActive === true}
    icon={<GitCommitHorizontal aria-hidden="true" size={14} />}
    onClick={() => props.onOpenSurface("git")}
    size="sm"
  >
    Commit
  </Button>
)}
```

   Delete the `shipActions` / `commitMenuOpenSignal` props and add `readonly gitSurfaceActive?: boolean;`. If something still sets `commitMenuOpenSignal` (a keyboard command opening the commit menu), `rg commitMenuOpenSignal` and re-route that command to `openSurface("git")` in the same hunk. Update `AgentThreadHeader.test.tsx`: the Commit button opens the git surface and reflects `aria-pressed`.
5. Delete `AgentCommitMenu.tsx`, `AgentCommitMenu.test.tsx`, `AgentShipPanel.tsx`, `AgentShipPanel.test.tsx` after `rg -n "AgentCommitMenu|AgentShipPanel" src` shows no other importers. Delete their CSS rule blocks (`rg -n "agent-ship|agent-commit-menu" src/components --glob "*.css"`) unless a remaining component uses the class.

- [ ] **Step 6: Run the focused suites**

Run: `npx vitest run src/application/rightPanel src/components/agentMode/rightPanel src/components/agentMode/AgentThreadHeader.test.tsx src/components/agentMode/AgentModeView.test.tsx src/application/useAgentShipFlow.test.tsx && npm run check && npm run lint -- --max-warnings 0`
Expected: PASS.

- [ ] **Step 7: Hand off (no commit)**

---
### Task 12: Branch picker with search, create branch and "Check out in a new worktree"

**Files:**
- Create: `src/domain/gitBranchPicker.ts` (shared with P9), `src/components/agentMode/rightPanel/git/AgentGitBranchPicker.tsx`, `src/components/agentMode/rightPanel/git/useAgentGitBranchActions.ts`
- Modify (integration):
  - `agentRightPanelContext.ts`: add `checkout` and `historyTarget`;
  - `AgentSurfaceHost.tsx`: pass the existing `checkout` memo and `historyScope` target into the context;
  - `AgentGitSurfaceContainer.tsx`: `branchControl` renders the picker;
  - `agentGit.css`: picker rules.
- Test: `src/domain/gitBranchPicker.test.ts`, `src/components/agentMode/rightPanel/git/AgentGitBranchPicker.test.tsx`, `src/components/agentMode/rightPanel/git/useAgentGitBranchActions.test.tsx`

**Interfaces:**
- Consumes: Task 7 `GitSurfaceStatus` (`branch`, `defaultBase`, `localBranches`, `remoteBranches`, `worktreeBranches`), Task 9 `worktrees.addBranchWorktree`, existing `AgentBranchCheckoutGateway` + `guard(target)` from `AgentSurfaceHost`'s `checkout` memo, `AgentGitHistoryTarget`.
- Produces (P9 consumes the domain module unchanged):
  - `type GitBranchPickerBadge = "current" | "default" | "worktree" | "remote"`, `interface GitBranchPickerItem { name: string; kind: "local" | "remote"; badge: GitBranchPickerBadge | null }`
  - `gitBranchPickerItems(branches: ReadonlyArray<string>, remotes: ReadonlyArray<string>, worktrees: ReadonlyArray<string>, current: string | null, defaultBranch: string | null, query: string, limit?: number): ReadonlyArray<GitBranchPickerItem>`
  - `validateNewBranchName(name: string): { kind: "ok"; name: string } | { kind: "invalid"; reason: string }`
  - `AgentGitBranchPicker(props)`, `useAgentGitBranchActions(context): { switchTo(item): void; create(name, options: { worktree: boolean }): void; notice; busy }`
  - Context additions: `readonly checkout: { gateway: AgentBranchCheckoutGateway; guard(target: AgentGitHistoryTarget): string | null } | null; readonly historyTarget: AgentGitHistoryTarget | null;`

- [ ] **Step 1: Write the failing domain test**

Create `src/domain/gitBranchPicker.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { gitBranchPickerItems, validateNewBranchName } from "./gitBranchPicker";

const local = ["chore/deps-2026-09", "feat/idempotency-keys", "feat/order-webhooks", "fix/payments-timeout", "main"];
const remote = ["origin/feat/rate-limit", "origin/main", "origin/release/1.4"];

describe("gitBranchPickerItems", () => {
  it("orders current, default, locals, then remotes that have no local twin", () => {
    expect(
      gitBranchPickerItems(local, remote, ["fix/payments-timeout"], "feat/idempotency-keys", "main", ""),
    ).toEqual([
      { name: "feat/idempotency-keys", kind: "local", badge: "current" },
      { name: "main", kind: "local", badge: "default" },
      { name: "chore/deps-2026-09", kind: "local", badge: null },
      { name: "feat/order-webhooks", kind: "local", badge: null },
      { name: "fix/payments-timeout", kind: "local", badge: "worktree" },
      { name: "origin/feat/rate-limit", kind: "remote", badge: "remote" },
      { name: "origin/release/1.4", kind: "remote", badge: "remote" },
    ]);
  });

  it("filters case-insensitively and caps the list", () => {
    expect(gitBranchPickerItems(local, remote, [], null, null, "FEAT").map((item) => item.name)).toEqual([
      "feat/idempotency-keys",
      "feat/order-webhooks",
      "origin/feat/rate-limit",
    ]);
    expect(gitBranchPickerItems(local, remote, [], null, null, "", 2)).toHaveLength(2);
  });
});

describe("validateNewBranchName", () => {
  it("accepts ordinary names and trims them", () => {
    expect(validateNewBranchName("  feat/idempotency-ttl ")).toEqual({ kind: "ok", name: "feat/idempotency-ttl" });
  });

  it("rejects names git would reject or read as options", () => {
    for (const bad of ["", "-x", "/a", "a/", "a..b", "a b", "a~1", "a^", "a:b", "a?", "a*", "a[", "a\\b", "x.lock", "a//b", "a@{1}", "a."]) {
      expect(validateNewBranchName(bad).kind, bad).toBe("invalid");
    }
  });
});
```

- [ ] **Step 2: Implement the domain module**

Create `src/domain/gitBranchPicker.ts`:

```ts
export type GitBranchPickerBadge = "current" | "default" | "worktree" | "remote";

export interface GitBranchPickerItem {
  readonly name: string;
  readonly kind: "local" | "remote";
  readonly badge: GitBranchPickerBadge | null;
}

export const MAX_GIT_BRANCH_PICKER_ITEMS = 100;
export const MAX_NEW_BRANCH_NAME_BYTES = 200;
const INVALID_BRANCH_CHARACTER = /[\s\u0000-\u001f\u007f~^:?*[\\]/;

export function gitBranchPickerItems(
  branches: ReadonlyArray<string>,
  remotes: ReadonlyArray<string>,
  worktrees: ReadonlyArray<string>,
  current: string | null,
  defaultBranch: string | null,
  query: string,
  limit: number = MAX_GIT_BRANCH_PICKER_ITEMS,
): ReadonlyArray<GitBranchPickerItem> {
  const needle = query.trim().toLowerCase();
  const matches = (name: string) => needle.length === 0 || name.toLowerCase().includes(needle);
  const localSet = new Set(branches);
  const worktreeSet = new Set(worktrees);
  const pinned = [current, defaultBranch].filter(
    (name, index, all): name is string => name !== null && localSet.has(name) && all.indexOf(name) === index,
  );
  const locals: GitBranchPickerItem[] = [
    ...pinned,
    ...[...branches].sort().filter((name) => !pinned.includes(name)),
  ].map((name) => ({ name, kind: "local", badge: localBadge(name, current, defaultBranch, worktreeSet) }));
  const remoteItems: GitBranchPickerItem[] = [...remotes]
    .sort()
    .filter((name) => !localSet.has(name.slice(name.indexOf("/") + 1)))
    .map((name) => ({ name, kind: "remote", badge: "remote" }));
  return [...locals, ...remoteItems].filter((item) => matches(item.name)).slice(0, Math.max(0, limit));
}

export function validateNewBranchName(
  name: string,
): { readonly kind: "ok"; readonly name: string } | { readonly kind: "invalid"; readonly reason: string } {
  const trimmed = name.trim();
  const invalid =
    trimmed.length === 0 ||
    new TextEncoder().encode(trimmed).length > MAX_NEW_BRANCH_NAME_BYTES ||
    trimmed.startsWith("-") ||
    trimmed.startsWith("/") ||
    trimmed.endsWith("/") ||
    trimmed.endsWith(".") ||
    trimmed.endsWith(".lock") ||
    trimmed.includes("..") ||
    trimmed.includes("//") ||
    trimmed.includes("@{") ||
    INVALID_BRANCH_CHARACTER.test(trimmed);
  if (invalid) return { kind: "invalid", reason: "Use a branch name without spaces or special characters." };
  return { kind: "ok", name: trimmed };
}

function localBadge(
  name: string,
  current: string | null,
  defaultBranch: string | null,
  worktrees: ReadonlySet<string>,
): GitBranchPickerBadge | null {
  if (name === current) return "current";
  if (name === defaultBranch) return "default";
  if (worktrees.has(name)) return "worktree";
  return null;
}
```

Run: `npx vitest run src/domain/gitBranchPicker.test.ts`
Expected: PASS.

- [ ] **Step 3: Write the failing component and action tests**

`AgentGitBranchPicker.test.tsx` mounts the picker with the mockup data and asserts:
- the trigger `aria-haspopup="dialog"` and `aria-expanded` toggle;
- the dialog is labelled "Switch branch" with a "Search refs" input;
- options render with their badges (`current`, `default`, `worktree`, `remote`);
- typing `feat` filters them;
- choosing `main` calls `onSwitch({ name: "main", kind: "local", badge: "default" })` and closes;
- the create row pre-fills nothing; typing `feat/idempotency-ttl` and pressing Create calls `onCreate("feat/idempotency-ttl", { worktree: false })`;
- turning on the "Check out in a new worktree" switch passes `{ worktree: true }`;
- an invalid name shows the validation reason and disables Create;
- `switchDisabledReason` set to a string disables every option and shows the reason;
- Escape closes and returns focus to the trigger.

`useAgentGitBranchActions.test.tsx` covers:
- (a) switching calls the checkout guard first, and a non-null guard result becomes the notice with no switch;
- (b) a remote item calls `checkoutRemoteBranch`;
- (c) create without worktree calls `createBranch` then the guarded switch;
- (d) create with worktree calls `addBranchWorktree({ repositoryRoot, branch, startPoint: currentBranch })` and sets the notice `Created a worktree at <path>` with a `copyPath` action;
- (e) an owner switch during a pending call drops the result.

Use in-memory gateway objects for the git / worktree boundaries.

- [ ] **Step 4: Implement**

`AgentGitBranchPicker.tsx`: the trigger is a native `button.cv-rp-ctl` (branch icon, current name, chevron) with a ref for the foundation `Popover` (`label="Switch branch"`, placement `bottom-start`). Inside:
- `.cv-bpick__q`: search icon + `<input aria-label="Search refs" placeholder="Search refs…">`, autofocused;
- `.cv-bpick__list` (`role="listbox" aria-label="Branches"`, max-height 224px, overflow auto): `button role="option" aria-selected={item.badge === "current"}` per item, with the name span (`overflow-wrap: anywhere`) and the badge text, disabled when `switchDisabledReason !== null` (reason in `title`);
- `.cv-bpick__new`: an input `aria-label="New branch name"` (mono), `Button variant="primary"` "Create" (disabled on invalid / busy / empty), `from <b>{current}</b>`, and the foundation `Switch` labelled "Check out in a new worktree".

Enter in the search box selects the first option; Enter in the name input creates. The items come from `gitBranchPickerItems(status.localBranches, status.remoteBranches, status.worktreeBranches, status.branch, status.defaultBase, query)`.

`useAgentGitBranchActions.ts`, sketched below. It keeps the owner guard of Task 11 via `useLatest(ownerKey)` and ignores results whose owner changed.

```ts
export interface AgentGitBranchActionsInput {
  readonly ownerKey: string | null;
  readonly rootPath: string | null;
  readonly repositoryRoot: string | null;
  readonly currentBranch: string | null;
  readonly git: Pick<GitGateway, "createBranch"> | null;
  readonly checkout: AgentRightPanelContextValue["checkout"];
  readonly historyTarget: AgentGitHistoryTarget | null;
  readonly worktrees: AgentRightPanelGateways["worktrees"] | null;
  onChanged(): void;
}

export type AgentGitBranchNotice =
  | { readonly kind: "error"; readonly text: string }
  | { readonly kind: "worktree"; readonly text: string; readonly path: string };
```

`switchTo(item)`:
1. If `checkout`, `historyTarget` or `rootPath` is null, return.
2. Compute `const blocked = checkout.guard(historyTarget)`. If it is non-null, set notice `{ kind: "error", text: blocked }` and stop.
3. Otherwise call `checkout.gateway.switchBranch(rootPath, item.name)` for local items, or `checkout.gateway.checkoutRemoteBranch?.(rootPath, item.name)` for remote ones. A missing `checkoutRemoteBranch` gives the notice "This repository cannot check out remote branches here."
4. Then call `onChanged()`.

`create(name, { worktree })`:
- validate first;
- with `worktree` → `worktrees.addBranchWorktree({ repositoryRoot, branch: name, startPoint: currentBranch })` → the `worktree` notice;
- without → `git.createBranch(rootPath, name)`, then the same guarded switch as `switchTo({ name, kind: "local", badge: null })`.

Every call is wrapped in try/catch, which sets `{ kind: "error", text: error.message }`.

Container integration (`AgentGitSurfaceContainer.tsx`): `branchControl` becomes `<AgentGitBranchPicker … switchDisabledReason={switchDisabledReason} />`, where `switchDisabledReason = thread !== null && thread.thread.target.isolation === "worktree" ? "This thread's worktree stays on its own branch. Create a new branch in a new worktree instead." : null`. Switching an agent worktree's branch would break the ship flow's branch identity. Render the branch notice below the picker trigger inside the surface banner area, with a "Copy path" `Button` calling `context.copyText(notice.path)`.

Context and host integration:
- add `checkout` and `historyTarget` to `AgentRightPanelContextValue` and to `rightPanelTestContext` (defaults `null`);
- in `AgentSurfaceHost.tsx`, set `checkout: checkout` (the existing memo) and `historyTarget: historyScope.kind === "available" ? historyScope.target : null`.

CSS: append the `.cv-bpick*` rules to `agentGit.css`, mirroring the mockup `.bpick` block with `--cv-*` tokens (320px width, 36px search row with a bottom hair, list padding `6px 4px 4px`, create block with a top hair, `.cv-bpick__badge` at `10px` `var(--cv-fg-subtle)`).

- [ ] **Step 5: Run the focused suites**

Run: `npx vitest run src/domain/gitBranchPicker.test.ts src/components/agentMode/rightPanel/git && npm run check`
Expected: PASS.

- [ ] **Step 6: Hand off (no commit)**

---

### Task 13: Pull request creation form (F9 UI)

**Files:**
- Create: `src/application/rightPanel/useAgentPullRequest.ts`, `src/components/agentMode/rightPanel/pullRequest/AgentPullRequestSurface.tsx`, `src/components/agentMode/rightPanel/pullRequest/AgentPullRequestSurfaceContainer.tsx`, `src/components/agentMode/rightPanel/pullRequest/agentPullRequest.css`
- Modify (integration):
  - `AgentRightPanelSurfaceBody.tsx`: the `pullRequest` case;
  - `agentRightPanelGateways.ts`: `externalUrl` (a forge URL opener);
  - `src/infrastructure/tauriPullRequestGateway.ts`: `TauriForgeUrlOpener`;
  - `agentRightPanelTestSupport.tsx`: default `externalUrl`.
- Test: `src/application/rightPanel/useAgentPullRequest.test.tsx`, `src/components/agentMode/rightPanel/pullRequest/AgentPullRequestSurface.test.tsx`, `src/infrastructure/tauriPullRequestGateway.test.ts`

**Interfaces:**
- Consumes: Task 8 `PullRequestGateway`, `PullRequestContext`, `pullRequestDraftDefaults`, `validatePullRequestTitle`, `validatePullRequestBody`, `classifyPullRequestError`; Task 7 context (`target`, `thread`, `gitStatus`), Task 12 `gitBranchPickerItems` (base menu uses local branches).
- Produces:
  - `type AgentPullRequestContextLoad = { kind: "idle" } | { kind: "loading" } | { kind: "ready"; value: PullRequestContext } | { kind: "failed"; message: string }`
  - `type AgentPullRequestSubmit = { kind: "idle" } | { kind: "submitting" } | { kind: "created"; receipt: PullRequestReceipt } | { kind: "failed"; failure: PullRequestFailure }`
  - `useAgentPullRequest(options: { ownerKey; target; gateway; threadTitle }): AgentPullRequestState` with `{ context; base; title; body; draft; titleError; bodyError; submit; setBase; setTitle; setBody; setDraft; create(); reload() }`
  - `interface ForgeUrlOpener { openExternal(url: string): Promise<void> }`, `TauriForgeUrlOpener` (https on `github.com` / `gitlab.com` only)
  - `AgentRightPanelGateways.externalUrl: ForgeUrlOpener`

- [ ] **Step 1: Write the failing hook test**

`useAgentPullRequest.test.tsx` with an in-memory `PullRequestGateway` (the Tauri/forge boundary) covering:
- (a) on mount it loads the context and fills title/body from `pullRequestDraftDefaults` and base from `context.base`;
- (b) editing the title then receiving a reloaded context (base change) keeps the edited title;
- (c) `setBase("develop")` reloads the context with `base: "develop"`;
- (d) `create()` with a title containing a newline sets `titleError` and does not call the gateway;
- (e) a successful create yields `{ kind: "created", receipt }`;
- (f) a gateway rejection `alreadyExists:https://github.com/acme/orders-api/pull/3` yields `failed` with `url` set;
- (g) switching `ownerKey` while `create` is pending ignores the late receipt and resets the form for the new owner;
- (h) a `null` target stays `idle` and never calls the gateway.

- [ ] **Step 2: Implement the hook**

`useAgentPullRequest.ts` follows the generation / owner pattern of Task 7's `useGitSurfaceStatus`:
- context loads are keyed by `JSON.stringify([ownerKey, target.repositoryRoot, target.worktreePath, base])`;
- form fields live in state keyed by `ownerKey`, with `touched` flags so a reload never overwrites edited fields;
- `create()` validates title and body with the domain validators, sets `submitting`, calls `gateway.create({ ...target, base, title, body, draft })`, checks `ownerRef.current === owner` after the await, and maps rejections through `classifyPullRequestError`;
- `base === null` (no default base found) blocks `create()` with `titleError` untouched and a `baseError: "Choose a base branch."` (add `baseError` to the state).

- [ ] **Step 3: Write the failing surface test**

`AgentPullRequestSurface.test.tsx` renders the presentational component with a ready context and asserts:
- the sub header reads `feat/idempotency-keys → main ▾` (the base is a menu button) and `3 commits · 3 files`;
- the Title input (`label` Title) and the Description textarea (`label` Description) show the values;
- the "Create as draft" `Switch` toggles `onDraftChange`;
- the footer note reads `Pushes 2 commits to origin first` when `unpushedCommits > 0` and is absent otherwise;
- Cancel calls `onCancel`;
- "Create pull request" calls `onCreate` and is disabled while submitting;
- a `created` submit renders `Pull request created` with an "Open pull request" button calling `onOpen(url)`;
- `failed` with kind `cliMissing` renders the message plus, when `compareUrl` exists, an "Open compare page" button;
- `alreadyExists` renders "Open existing pull request";
- `unsupportedHost` renders the message and the compare fallback;
- `forge === null` in context renders `Pull requests need a github.com or gitlab.com remote.` and disables Create.

- [ ] **Step 4: Implement the surface**

`AgentPullRequestSurface.tsx`:
- a `.cv-rp-sub` with the compare label (branch icon, strong head name, arrow, base `button.cv-rp-ctl` opening a `Menu` of `gitBranchPickerItems(local, [], [], head, defaultBase, "")` names), and on the right `N commits · M files`;
- a `form.cv-pr` (`onSubmit` prevents default) with the foundation `TextField` (label "Title") and `TextArea` (label "Description", flex 1, min-height 160px);
- a `Switch` row "Create as draft";
- a `.cv-pr__foot` with the note, `Button` Cancel and `Button variant="primary" icon={<GitPullRequest/>}` "Create pull request";
- the submit result as a `role="status"` / `role="alert"` block above the footer.

Every string is from the mockup or listed above.

`AgentPullRequestSurfaceContainer.tsx` reads the context (`target`, `thread`, `chrome.gateways.pullRequest`, `chrome.gateways.externalUrl`), calls `useAgentPullRequest`, and wires:
- `onCancel` → `context.openSurface("git")`;
- `onOpen(url)` → `externalUrl.openExternal(url)` (errors become a notice);
- success → `context.gitStatus.refresh()`.

`TauriForgeUrlOpener` in `tauriPullRequestGateway.ts`:

```ts
const FORGE_HOSTS = new Set(["github.com", "gitlab.com"]);

export interface ForgeUrlOpener {
  openExternal(url: string): Promise<void>;
}

export class TauriForgeUrlOpener implements ForgeUrlOpener {
  constructor(private readonly openUrl: (url: string) => Promise<void> = openWithTauri) {}

  async openExternal(url: string): Promise<void> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error("This address cannot be opened.");
    }
    if (parsed.protocol !== "https:" || !FORGE_HOSTS.has(parsed.hostname) || url.length > 2_048) {
      throw new Error("Only github.com and gitlab.com addresses can be opened here.");
    }
    await this.openUrl(url);
  }
}

async function openWithTauri(url: string): Promise<void> {
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(url);
}
```

`tauriPullRequestGateway.test.ts` checks that a `javascript:`, an `http:` and a `https://evil.example` URL reject without calling the injected `openUrl`, and that a GitHub PR URL is passed through.

CSS `agentPullRequest.css` mirrors the mockup `.form/.lab/.inp/.ta/.prmeta/.pfoot` rules with `--cv-*` tokens (the foundation field components already provide inputs, so the file only lays out `.cv-pr` as a column with `gap: 14px; padding: 16px; overflow: auto`, `.cv-pr__desc` flex 1, and `.cv-pr__foot` as a top-hair footer).

Integration: in `AgentRightPanelSurfaceBody.tsx`, add `case "pullRequest": return blockedOr(props, <AgentPullRequestSurfaceContainer />);`.

- [ ] **Step 5: Run the focused suites**

Run: `npx vitest run src/application/rightPanel/useAgentPullRequest.test.tsx src/components/agentMode/rightPanel/pullRequest src/infrastructure/tauriPullRequestGateway.test.ts && npm run check`
Expected: PASS.

- [ ] **Step 6: Hand off (no commit)**

---

### Task 14: Scripts surface (run/stop, running/exit state, package picker, project actions)

**Files:**
- Create: `src/application/rightPanel/agentScriptsSurfaceModel.ts`, `src/components/agentMode/rightPanel/scripts/AgentScriptsSurface.tsx`, `src/components/agentMode/rightPanel/scripts/AgentScriptsSurfaceContainer.tsx`, `src/components/agentMode/rightPanel/scripts/agentScripts.css`
- Modify:
  - `src/application/useAgentThreadScripts.ts`: expose `lastOutcome`;
  - `src/components/agentMode/AgentWorkbenchScreen.tsx`: the runner exposes `lastOutcome`, and the chrome passes `vscodeProcessTasks` + `openScriptTerminal`;
  - `src/components/agentMode/agentWorkbenchChrome.ts`: `scriptsSurface` field;
  - `src/components/agentMode/AgentModeView.tsx`: pass `scripts` to `AgentSurfaceHost`, drop it from the header;
  - `agentRightPanelContext.ts` + `AgentSurfaceHost.tsx`: `scripts` in the context;
  - `AgentRightPanelSurfaceBody.tsx`: the `scripts` case;
  - `AgentThreadHeader.tsx`: delete the `<AgentScriptRunControl/>` mount and the `scripts` / `onOpenScriptsView` props.
- Delete: `src/components/agentMode/AgentScriptRunControl.tsx` (+ test) and its CSS rules.
- Test: `src/application/rightPanel/agentScriptsSurfaceModel.test.ts`, `src/components/agentMode/rightPanel/scripts/AgentScriptsSurface.test.tsx`, `src/application/useAgentThreadScripts.test.ts`

**Interfaces:**
- Consumes:
  - `AgentThreadScriptsSurface` (entries, run state, `runScript(key)`, `stopScript()`);
  - `NodePackageScript` (`manifestRelativePath`, `scriptName`, `key`);
  - `NodePackageTaskState` (`exited { exitCode }`, `failed`, `stopped`);
  - `VscodeProcessTasksState` (`tasks`, `start(identity)`, `stop()`, `running`, `activeLabel`, `configure()`, `configurationAction`).
- Produces:
  - `AgentThreadScriptsSurface.lastOutcome: { key: string; outcome: { kind: "exited"; exitCode: number | null } | { kind: "failed"; message: string } | { kind: "stopped" } } | null`
  - `interface AgentScriptRow { key; name; command: string | null; state: { kind: "idle" } | { kind: "running"; stoppable: boolean } | { kind: "exited"; exitCode: number | null } | { kind: "failed"; message: string }; blockedReason: string | null }`
  - `interface AgentScriptsManifest { relativePath: string; label: string }`
  - `agentScriptRows(surface, manifest): ReadonlyArray<AgentScriptRow>`, `agentScriptManifests(entries): ReadonlyArray<AgentScriptsManifest>`, `agentProjectActionRows(tasks): ReadonlyArray<AgentProjectActionRow>`
  - `interface AgentScriptsChrome { vscodeProcessTasks: VscodeProcessTasksPanelProps | null; openScriptTerminal(): void; refreshScripts(): void }`

- [ ] **Step 1: Write the failing model test**

`agentScriptsSurfaceModel.test.ts` covers:
- (a) manifests are grouped from entries' `detail` / manifest path, ordered with the root `package.json` first, labelled by relative path;
- (b) rows for the selected manifest show the running state for the active key and `exited` with the code from `lastOutcome` for another key, where `Exit 1` comes from `exitCode: 1`;
- (c) exit code 0 shows no status (idle), matching the mockup, where only failures show;
- (d) blocked entries carry their reason and cannot run;
- (e) project-action rows come from `tasks.json` process tasks (label, detail = command summary), with the running state from `activeLabel`.

The command string for a script row comes from the entry's `detail`. If `detail` is the manifest path rather than the script command, extend `AgentThreadScriptEntry` with `command: string | null`, filled from `NodePackageScript` when the discovery result carries the command text. If discovery does not read script bodies, show the script name only and record "script command preview" as a gap. Do not read `package.json` again in the UI layer.

- [ ] **Step 2: Expose the last outcome**

- `useAgentThreadScripts.ts`: add `readonly lastOutcome: AgentThreadScriptLastOutcome | null` to `AgentThreadScriptRunner` and pass it through to `AgentThreadScriptsSurface` only when the outcome's key belongs to the current thread's scoped scripts.
- `AgentWorkbenchScreen.tsx`: derive `lastOutcome` from `nodePackageScripts.task` when `task.status` is `exited` / `failed` / `stopped`, using `task.key` (or `manifestRelativePath` + `scriptName` mapped to the `NodePackageScript.key`). Name the fields exactly as `NodePackageTaskState` defines them (`src/application/nodePackageTaskLifecycle.ts`).
- Add a `useAgentThreadScripts.test.ts` case: after a run exits with code 1, `lastOutcome` reports `{ kind: "exited", exitCode: 1 }` for that key.

- [ ] **Step 3: Write the failing surface test**

`AgentScriptsSurface.test.tsx` renders the mockup data and asserts:
- the `package.json ▾` manifest button (a menu when there are 2 or more manifests, static text otherwise) and Reload (`aria-label="Reload scripts"`);
- one row per script with `aria-label="Run dev"` / `aria-label="Stop dev"` on the leading button;
- a running row shows `Running` and a link button `Show output` that calls `onShowOutput`;
- `lint` shows `Exit 1` in the failure style;
- the rows have name and command columns, with the command clipped only visually via ellipsis and the full command in `title` (the full text stays in the DOM);
- a "Project actions" group lists tasks with Run / Stop;
- "Add action" calls `onConfigureActions` and is hidden when `configurationAction === null`;
- blocked rows are disabled with the reason as `title`.

The mockup's `:3000` port link needs port detection, which does not exist. The link text is `Show output` and opens the terminal where the script runs. Record port detection as a gap.

- [ ] **Step 4: Implement**

`AgentScriptsSurface.tsx` renders `.cv-rp-sub` (manifest control + Reload) and `.cv-scripts` (list). Each row is a `.cv-script-row` with:
- a 28px leading `button.cv-script-row__go` (play or stop icon);
- `.cv-script-row__name` (500 weight);
- `.cv-script-row__cmd` (mono 2xs, `flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap`, with `title` = the full command; the command stays fully selectable in the DOM);
- the status (`StatusLabel kind="work"` "Running" + `Show output`, or `StatusLabel kind="fail"` `Exit N`).

The "Project actions" group header (`.cv-scripts__group`) is followed by task rows and the `.cv-scripts__add` row.

`AgentScriptsSurfaceContainer.tsx` reads `context.scripts` (the thread scripts surface from `AgentModeView`) and `chrome.scriptsSurface`, with the selected manifest in local state (default: the root manifest). It wires:
- run: `scripts.runScript(key)`;
- stop: `scripts.stopScript()`;
- Show output: `scriptsSurface.openScriptTerminal()`, which calls the existing `onShowTerminalPanel`;
- Reload: `scriptsSurface.refreshScripts()`, which calls `nodePackageScripts.refresh`;
- project actions: `vscodeProcessTasks.start(identity)` / `stop()`;
- Add action: `vscodeProcessTasks.configure()`.

When there is no thread (project scope), use a project-scope `AgentThreadScriptsSurface` built by `useAgentThreadScripts` with a target from the scope's repository root. If `useAgentThreadScripts` requires a thread target, add a `project` target variant in the same file (same Step 2 hunk).

`agentWorkbenchChrome.ts`: add `readonly scriptsSurface?: AgentScriptsChrome | null;`. `AgentWorkbenchScreen.tsx`: add `"vscodeProcessTasks"` to the `AgentWorkbenchScreenWorkbench` pick and build `scriptsSurface` from:
- `workbench.vscodeProcessTasks` (+ the configuration props the sidebar passes today: read `WorkbenchSidebar.tsx`, which passes `vscodeProcessTasks={workbench.vscodeProcessTasks}`, and reuse the same object);
- `showTerminalPanel`;
- `nodePackageScripts.refresh`.

`AgentModeView.tsx`: pass `scripts={scripts}` to `AgentSurfaceHost` (added to the host props and context as `scripts: AgentThreadScriptsSurface | null`); stop passing `scripts`, `headerScripts` and `onOpenScriptsView` to the header; delete `useAgentThreadScriptPresentation` if nothing else uses it (`rg`). `AgentThreadHeader.tsx`: delete the `AgentScriptRunControl` mount and props.

In `AgentRightPanelSurfaceBody.tsx`, add `case "scripts": return blockedOr(props, <AgentScriptsSurfaceContainer />);`. Now remove the Task 2 placeholder note case entirely; every kind has a real body.

Delete `AgentScriptRunControl.tsx` and its test after `rg -n AgentScriptRunControl src` shows no importers, and delete their CSS rules.

- [ ] **Step 5: Run the focused suites**

Run: `npx vitest run src/application/rightPanel src/application/useAgentThreadScripts.test.ts src/components/agentMode/rightPanel src/components/agentMode/AgentThreadHeader.test.tsx src/components/agentMode/AgentModeView.test.tsx && npm run check && npm run size:hotspots`
Expected: PASS; `AgentModeView.tsx` does not grow.

- [ ] **Step 6: Hand off (no commit)**

---

### Task 15: Files surface (inline search, tree with git markers, preview crumbs)

**Files:**
- Create: `src/application/rightPanel/useAgentFilesSearch.ts`, `src/components/agentMode/rightPanel/files/AgentFilesSurface.tsx`, `src/components/agentMode/rightPanel/files/agentFiles.css`
- Modify:
  - `src/components/agentMode/AgentSurfaceFileTree.tsx`: remove the "Search files" button (the surface header owns search), keep Refresh + tree, and render git markers as trailing letters;
  - `src/components/FileTree.tsx`: only if the status rendering needs a `statusStyle="letter"` prop; otherwise untouched;
  - `AgentRightPanelSurfaceBody.tsx`: the `files` case renders `AgentFilesSurface`.
- Test: `src/application/rightPanel/useAgentFilesSearch.test.tsx`, `src/components/agentMode/rightPanel/files/AgentFilesSurface.test.tsx`, `src/components/agentMode/AgentSurfaceFileTree.test.tsx`

**Interfaces:**
- Consumes: Task 7 context (`chrome.gateways.fileSearch`, `checkoutRoot`, `openFile`, `previewFile`, `copyText`), `AgentSurfaceFileTreeProps`, existing `activePath`, `FileSearchResult`.
- Produces:
  - `useAgentFilesSearch(options: { gateway: FileSearchGateway | null; root: string | null; query: string }): { status: "idle" | "searching" | "ready" | "failed"; results: ReadonlyArray<FileSearchResult>; truncated: boolean; message: string | null }`, with a 150 ms debounce, `MAX_FILES_SEARCH_RESULTS = 200`, and generation-guarded results
  - `AgentFilesSurface(props: { fileTree: AgentSurfaceFileTreeProps | null; treeShown: boolean; activePath: string | null; editorSlot: ReactNode })`

- [ ] **Step 1: Write the failing search-hook test**

`useAgentFilesSearch.test.tsx` uses fake timers and an in-memory `FileSearchGateway`:
- (a) an empty query stays `idle` and never calls the gateway;
- (b) typing `idem` searches once after 150 ms with limit 201, and results are capped at 200 with `truncated: true` when 201 come back;
- (c) a slower earlier query resolving after a later one is ignored;
- (d) a root change clears results;
- (e) a rejection sets `failed` with the message.

- [ ] **Step 2: Implement the hook**

Implement with a `setTimeout` debounce inside `useEffect` (cleared on change) and a generation ref (the pattern of Task 7), calling `gateway.searchFiles(root, trimmedQuery, MAX_FILES_SEARCH_RESULTS + 1)`.

- [ ] **Step 3: Write the failing surface test**

`AgentFilesSurface.test.tsx` renders inside `WithRightPanelContext` with a `fileSearch` gateway returning results and asserts:
- the search field (`aria-label="Search files"`, placeholder `Search files`, a `⌘P` `Kbd`);
- while the query is empty, the tree renders (the `AgentSurfaceFileTree` test double is the real component with an in-memory tree surface fixture from `agentSurfaceTestFixtures.tsx`);
- with a query, a results list (`role="listbox"`, `aria-label="Matching files"`) replaces the tree, and each option shows name + muted directory with the full relative path in `title`;
- clicking a result calls `context.previewFile(path)` and double-click / Enter calls `context.openFile(path)`;
- the crumb row above the editor slot shows the active path segments relative to `checkoutRoot`, with "Copy path" (calls `copyText(activePath)`) and "Open in editor" (calls `openFile(activePath)`);
- the crumb row is hidden when there is no active path under the checkout;
- git markers render as `A` / `M` letters with the `cv-files-status--added|modified` classes.

- [ ] **Step 4: Implement**

`AgentFilesSurface.tsx` layout (`.cv-files`):
- `.cv-rp-sub` with a `label.cv-files__search` (search icon, input, `Kbd` `⌘P`) and tools (Refresh, "Collapse all folders"; the latter only if `AgentSurfaceFileTreeSurface` exposes a collapse action, otherwise omitted);
- `.cv-files__split` with the tree column (`width: 212px; flex: none; overflow: auto; border-right: 1px solid var(--cv-hair)`) or the results list;
- `.cv-files__preview` with the crumb row (`.cv-files__crumbs`, 36px, segments as quiet buttons that reveal the folder in the tree via the existing `revealActivePathSignal`, the last segment strong) and the editor slot `div` carrying `AGENT_SURFACE_EDITOR_SLOT_ATTRIBUTE` (unchanged mechanism; P7 replaces it later).

Crumb segments never clip: the row scrolls horizontally with `overflow-x: auto; scrollbar-width: none`, and the full path is the row's `title`.

In `AgentSurfaceFileTree.tsx`, drop the `searchFiles` button (the `SEARCH_FILES_COMMAND` quick open stays reachable through ⌘P and the palette) and update its test. Keep `searchFiles` in `AgentWorkbenchFileTreeChrome` only if another consumer uses it (`rg onSearchFiles`); otherwise delete the field and its wiring in `AgentWorkbenchScreen.tsx`.

`AgentRightPanelSurfaceBody.tsx` `files` case:

```tsx
case "files":
  return (
    <AgentFilesSurface
      activePath={props.activePath}
      editorSlot={<div className="agent-surface__editor-slot" {...{ [AGENT_SURFACE_EDITOR_SLOT_ATTRIBUTE]: "" }} />}
      fileTree={props.fileTree}
      treeShown={props.treeShown}
    />
  );
```

Add `activePath: string | null` to `AgentRightPanelSurfaceBodyProps` (from `chrome.fileTree?.activePath` via `AgentSurfacePanel`).

- [ ] **Step 5: Run the focused suites**

Run: `npx vitest run src/application/rightPanel/useAgentFilesSearch.test.tsx src/components/agentMode/rightPanel/files src/components/agentMode/AgentSurfaceFileTree.test.tsx src/components/agentMode/AgentSurfacePanel.test.tsx src/components/FileTree.test.tsx && npm run check`
Expected: PASS.

- [ ] **Step 6: Hand off (no commit)**

---
### Task 16: Full repository gates (lead)

**Files:** none new. If a gate fails, fix it in the owning task's files.

- [ ] **Step 1: Confirm the tree and the absence of leftovers**

Run: `git status --porcelain && rg -n "AgentCommitMenu|AgentShipPanel|AgentScriptRunControl|AgentRecordedTurnDiff|AgentSurfaceProjectDiff|useAgentProjectDiffChrome|AgentTurnChangesCard|opens here\\." src`
Expected: no matches from `rg` (the `opens here.` placeholder string from Tasks 1-2 must be gone), and `git status` shows only P6 files plus the owner's untracked `docs/redesign/` and spec edits. Check for foreign hunks from a concurrent Codex session (repo memory) and leave them alone.

- [ ] **Step 2: Run every gate from CLAUDE.md, checking exit codes (not piped tails)**

```bash
set -o pipefail
npm run check
npm run lint -- --max-warnings 0
npm run lint:exhaustive-deps
npm run build
npm run size:hotspots
npm run format:check
npm run format:check:changed
npm test -- --run
git diff --check
cd src-tauri
cargo check --all-targets
cargo test --lib
cargo test --tests
cargo fmt --all -- --check
cargo clippy --all-targets -- -D warnings
```

Expected: every command exits 0.
- Project CLAUDE.md lists `npm run build` as a required gate, which overrides the global "no build for verification" preference.
- If `format:check:changed` lists files, run `npx prettier --write <each listed file>` only for files this phase created or modified, never a directory.
- If `npm test` fails only in Node watch / port 9229 suites, free the port (`lsof -ti :9229 | xargs kill`) and rerun those files sequentially before treating it as a regression.
- Do not raise `scripts/hotspot-size-baseline.json` or the exhaustive-deps budget.

- [ ] **Step 3: Performance evidence**

Record in the phase report:
- (a) the Task 4 Step 12 timing;
- (b) opening the Diff surface on a 4,000-line modified file in the QA app: the diff appears without a frozen UI (Codex QA step 3 below measures that scrolling and typing in the composer stay responsive while the diff computes);
- (c) the file list stays at 500 rows and at most 12 files render expanded, measured from `useAgentDiffSurface` constants and asserted by tests.

- [ ] **Step 4: Coverage**

If the changed surface is part of the repository coverage workflow (`.github/workflows/*coverage*`), run the same coverage command locally and report the numbers for the new modules.

---

### Task 17: Independent read-only review (Opus 5.5)

- [ ] **Step 1: Dispatch the reviewer**

Launch a separate read-only Opus 5.5 agent (no edits, no git mutations) with the full diff (`git diff` + untracked P6 files), this plan and the spec. Instructions:
- Review against spec §3.1.8, B4, F9, §4 and CLAUDE.md layering/security/performance rules.
- Specifically check:
  1. every new Tauri command is trust-gated, rejects unknown fields, and runs `git` / `gh` / `glab` only through the bounded, no-shell runners;
  2. PR argv values cannot be read as flags (`--flag=value` form) and the created URL is host-checked on both sides;
  3. workspace A → B → A and thread switches cannot leak a diff, git status, PR context, search result or terminal snapshot across owners (generation / owner guards after every await);
  4. the commit selection fails closed on stale paths and never commits unselected files;
  5. no code cell or file name is clipped in the diff (B4), and wrap/scroll work in a 360px panel;
  6. no line diff runs on the UI thread in production;
  7. no capability of the deleted components (ship panel, commit menu, script control, recorded/project diff) is lost without being listed as a gap;
  8. no literal colors, no `else`, no comments, no `any`, and no `throw` in tests;
  9. `AgentModeView.tsx` did not grow.
- Report P0/P1/P2 findings with file:line and a concrete fix.

- [ ] **Step 2: Resolve findings**

Verify each finding in the code first (repo memory: audits overstate). Fix every real P0/P1 through a scoped implementer task on the owning files, rerun that task's focused tests and Task 16, then send the fix diff back to the same reviewer for confirmation. Record rejected findings with the reasoning in the phase report.

---

### Task 18: QA build and Codex computer-use QA

**Files:** `~/tmp/codevo-qa/qa_prompt_p6.txt` (scratch, deleted at the end).

- [ ] **Step 1: Build and start the QA bundle**

Run: `npx tauri build --debug --bundles app --config '{"identifier":"dev.mockor.editor.qa","productName":"Codevo QA"}'`
Expected: `src-tauri/target/debug/bundle/macos/Codevo QA.app` exists. An exit code of 1 caused only by the missing updater signing key is acceptable; a compile error is not.

Run: `open "src-tauri/target/debug/bundle/macos/Codevo QA.app" && sleep 3 && osascript -e 'tell application "Codevo QA" to activate'`
Expected: the "Codevo QA" window is frontmost.

Preconditions:
- open a trusted Express test project that is a git repository with a GitHub `origin` remote URL, at least one agent thread with a finished turn that changed files, an uncommitted edit that contains a line longer than 300 characters, a second local branch, and a `package.json` with `dev`, `lint` and `test` scripts (the lint script exits 1);
- `gh` may be unauthenticated. The QA expects the readable `authRequired` / `cliMissing` failure, never a crash.

- [ ] **Step 2: Write the QA prompt**

```bash
mkdir -p ~/tmp/codevo-qa && cat > ~/tmp/codevo-qa/qa_prompt_p6.txt <<'QA'
You are a UI QA tester with Computer Use. First action: bring the window "Codevo QA" to the front and take a screenshot. Before EVERY screenshot, make sure "Codevo QA" is the frontmost window. If Computer Use is unavailable, reply only COMPUTER_USE_UNAVAILABLE and stop.

Rules:
- ATTACH ONLY to the already running app "Codevo QA" (bundle id dev.mockor.editor.qa). Never launch, quit, restart or rebuild any app. Never touch "Codevo Editor" or any other app.
- Do not edit files in an editor outside the app, do not run shell commands, do not change macOS settings. Do not push, and do not create a real pull request: stop at the pull request result message.
- Reference design: the right panel of the Codevo v3 mockup (tabs with icons, a small + button, subheaders of 40px, calm palette colors).

Steps (report worked/failed with a screenshot path for each):
1. Open the agent thread with a finished turn. Open the right panel. Click "+" in the panel tab strip: the menu lists Terminal T, Files F, Diff D, Git G, Scripts S, Pull request P, History H.
2. Click the "N changed files · Open diff" row in the conversation. The Diff tab opens with scope "Latest turn" or "Turn N"; the row in the conversation looks active. Change the scope to "Working tree", then "Branch changes" (base main), then back to a turn. Each shows files with +/- counts.
3. Narrow the right panel to its minimum width by dragging its left edge. Open the file with the very long line. Confirm the long line is NOT cut off: scroll the code horizontally and see its end. Turn on line wrapping (wrap button): the line wraps inside the panel. Switch to split view: both sides visible, scrollable, nothing cut off. Toggle whitespace and the file tree. While the diff loads, type in the composer: typing stays smooth.
4. Terminal: open Terminal from "+". The terminal appears as its own tab. Open a second terminal from the floating toolbar "New terminal"; a second tab appears. Run `sleep 30` in one; its tab shows a small running dot. Use Stop and Restart from the floating toolbar. Close tabs until none is left: the Terminal surface closes.
5. Git: click "Commit" in the top bar: the Git tab opens. Uncheck one file: the header shows "N of M files" with a mixed checkbox. Leave the message empty and press Generate: a conventional commit message appears. Do NOT commit. Open the branch picker: search "main", see badges (current/default/worktree/remote). Type a new branch name, turn on "Check out in a new worktree", press Create, and confirm a message with the worktree path and a Copy path button. Close the picker with Escape.
6. Pull request: open "Create pull request" from the Git surface hint or the + menu. The form shows head → base, commit/file counts, title and description prefilled, a draft switch, and a note about pushing if needed. Press "Create pull request" ONLY if the note says nothing needs pushing and gh is not authenticated; otherwise press Cancel. Report the exact message shown.
7. Scripts: open Scripts. Run "dev" (it shows Running and "Show output"), stop it. Run "lint" and wait: it shows "Exit 1". Project actions group and "Add action" are visible.
8. Files: open Files. Type "server" in Search files: a results list replaces the tree; click a result: the preview opens with a breadcrumb row with Copy path and Open in editor. Clear the search: the tree returns with A/M letters on changed files.
9. Repeat steps 2, 3 and 5 quickly in palette Graphite · Teal Light and in Zinc · Orange Dark (Settings > Appearance). Report unreadable text, clipped text, overlapping controls or leftover old colors.
10. Switch to another project/workspace tab and back: the right panel shows the original thread's data only (no content from the other project).

Final report: one line per step (worked / failed - what you saw), screenshot paths, and a list of visual differences from the calm mockup style.
QA
```

- [ ] **Step 3: Run the tester**

Run in the background: `python3 ~/tmp/codevo-qa/qa_orchestrator_v2.py ~/tmp/codevo-qa/qa_prompt_p6.txt > /tmp/qa-p6.log 2>&1`, then watch only for `COMPUTER_USE_UNAVAILABLE`, `TIMEOUT`, `ERROR` or the final report lines. If the permission classifier blocks the run, ask the owner to run the same command with the `!` prefix, or to paste the prompt into their own interactive Codex session and return the report.

- [ ] **Step 4: Fix loop**

For each failure: confirm the root cause in code, fix it through a scoped implementer task, rerun the focused tests, Task 16, and a reviewer pass on the fix. Rebuild the QA app and rerun only the failed steps.

- [ ] **Step 5: Clean up**

Run: `osascript -e 'quit app "Codevo QA"'; rm -f /tmp/qa-p6.log ~/tmp/codevo-qa/qa_prompt_p6.txt`
Remove the QA worktree the tester created in step 5 with `git worktree remove` in the QA project, never in the editor repository.

---

### Task 19: Commit to `main` (lead, after explicit owner authorization)

- [ ] **Step 1: Confirm the tree**

Run: `git branch --show-current && git status --porcelain && git log --oneline -5`
Expected: branch `main`; only P6 files staged (check for foreign hunks from a concurrent session; stage nothing else, never `docs/redesign/` or the spec).

- [ ] **Step 2: Commit the backend slice**

```bash
git add -- src-tauri/src/git_surface_status.rs src-tauri/src/git_branch_diff.rs src-tauri/src/pull_request.rs src-tauri/src/lib_composition/git_surface_commands.rs src-tauri/src/lib_composition/command_facades.rs src-tauri/src/lib_composition/runtime.rs src-tauri/src/lib_composition/git_worktree_commands.rs src-tauri/src/git_worktree.rs src-tauri/src/git_integration.rs src-tauri/src/repository_lookup/mod.rs src/domain/wireValue.ts src/domain/wireValue.test.ts src/domain/gitSurfaceStatus.ts src/domain/gitSurfaceStatus.test.ts src/domain/gitBranchDiff.ts src/domain/gitBranchDiff.test.ts src/domain/pullRequest.ts src/domain/pullRequest.test.ts src/domain/gitWorktree.ts src/infrastructure/tauriGitSurfaceIpcContract.ts src/infrastructure/tauriGitSurfaceIpcContract.test.ts src/infrastructure/tauriGitSurfaceGateway.ts src/infrastructure/tauriPullRequestIpcContract.ts src/infrastructure/tauriPullRequestIpcContract.test.ts src/infrastructure/tauriPullRequestGateway.ts src/infrastructure/tauriPullRequestGateway.test.ts src/infrastructure/tauriGitWorktreeIpcContract.ts src/infrastructure/tauriGitWorktreeIpcContract.test.ts src/infrastructure/tauriGitWorktreeGateway.ts
git diff --cached --stat
git commit -F - <<'MSG'
feat(git): surface status, branch diff, branch worktrees and pull request command

- Trust-gated commands for line stats, unpushed commits, branches, branch-vs-base
  diff, branch worktrees and pull request context/creation
- Pull requests go through gh/glab with a closed argv, bounded output and a
  host-checked result URL; failures map to a closed set of kinds
- Strict TS contracts with exact-key parsing on both sides
MSG
```

- [ ] **Step 3: Commit the right panel slice**

```bash
git add -A -- src/domain src/application src/infrastructure src/components src/ui
git diff --cached --stat
git commit -F - <<'MSG'
feat(right-panel): redesigned diff, files, terminal, git, pull request and scripts surfaces

- Panel tab strip with terminal sessions as tabs and an add-surface menu
- Diff with latest turn / turn / working tree / branch scopes, unified and split
  layouts, wrap, whitespace and file tree; long lines scroll or wrap (B4)
- Git surface with include checkboxes, generated messages, Commit and Commit &
  push, unpushed commits and a branch picker with worktree creation
- Pull request form, Scripts surface with exit states and project actions,
  Files surface with inline search
MSG
git status --porcelain
```

Expected: two commits; no AI attribution; no push, no tag. `git status` afterwards shows only the owner's untracked files.

---

## Reported Gaps and Residual Risks (to restate in the phase report)

- Model-based commit message generation: Generate is deterministic (type / scope / subject heuristics). A provider one-shot API does not exist yet.
- Pull requests support `github.com` and `gitlab.com` remotes with `owner/repo` paths. GitHub Enterprise, self-hosted GitLab, GitLab subgroups and Bitbucket fall back to the compare page when one exists. Reviewers, labels and PR templates are not in the form.
- Opening an agent thread inside an existing worktree is not supported (agreed with P9). The branch picker creates the worktree and offers Copy path.
- Script runs stay in the bottom-panel terminal (single runner); the Scripts surface links to it with "Show output". There is no port detection (mockup `:3000`). Script command text needs discovery support (Task 14 Step 1 decides).
- The Git surface commits in the target repository only. Nested repositories of a multi-repo project remain served by the workbench Git view.
- Remote (server) threads keep the legacy working-tree diff body (`AgentSurfaceDiff`) under the new toolbar. Branch scope and the Git / Scripts / PR surfaces are not served for remote threads.
- Diff hunks render without syntax highlighting (tokens only; P7 may add highlighting through the editor theme).
- Files preview uses the real editor slot until P7 moves the editor to its own surface kind.

## Self-Review

1. **Spec coverage:**
   - §3.1.8 Diff: Tasks 4-6 cover scopes, layouts, wrap, whitespace and file tree.
   - Files: search, tree markers and preview in Task 15.
   - Terminal: sessions as tabs and the floating toolbar in Task 3.
   - Git: include checkboxes, message + generate, Commit / Commit & push in Tasks 10-11; branch picker with create + worktree in Tasks 9 and 12.
   - PR form: Tasks 8 and 13. Scripts: run/stop, running/exit, project actions in Task 14.
   - Long lines never clip: Task 6 B4 contract + DOM test.
   - F9 (Git, Scripts, PR as tabs): Tasks 1-2. B4: Task 6.
   - §4 PR as a closed typed command: Task 8.
   - §1 no capability lost: History kept, ship actions moved (Task 11), remote diff kept (Task 6); gaps listed above.
   - §6 tests on both sides of every wire change: Tasks 7-9. QA per palette: Task 18. Performance evidence: Tasks 4 and 16.
2. **Placeholder scan:** the temporary "opens here." body notes in Tasks 1-2 are deliberately removed by Task 14 and checked by Task 16 Step 1. Steps that reference "the file's existing harness" name the file and what to reuse; the implementer reads the real name there.
3. **Type consistency:**
   - `AgentSurfaceKind` values (`pullRequest` camelCase) are used everywhere.
   - `AgentDiffFile.displayPath` is the key in hooks, tree and sections.
   - `GitSurfaceTarget { repositoryRoot, worktreePath }` is shared by status, branch diff and PR context.
   - `AgentShipActions` moved to `useAgentShipActions.ts` in Task 10 and is imported from there in Tasks 7 (updated by 11) and 11.
   - `AgentTerminalSessionCommand` / `sessionId` naming is used by the presenter, strip and hook.
   - `AgentRightPanelGateways` grows only in Tasks 7 → 8 → 9 → 13 (sequential owners).
4. **Review Focus:** each of the five lines has a pinning test in the named task.

## Lead decisions (2026-09-24)

1. Execute as two milestones: P6a (Tasks 1-7: panel model, terminal tabs, diff + B4) and P6b (Tasks 8-15:
   git, pull request, scripts, files), each with its own gates/review/QA/commit.
2. Task 19 commits without waiting for the owner once gates, review and QA pass (no push, no tag).
3. Accept the listed gaps for now: heuristic commit-message generation, GitHub/GitLab owner/repo PRs only,
   scripts stay in the bottom terminal without port detection, single-repository git tab, remote threads
   keep the working-tree diff, no syntax highlighting in diff hunks (P10 follow-up if cheap via the
   existing Shiki highlighter).
4. Add a second split-row test for Myers ordering (deletion+insertion blocks, multiple hunks).
