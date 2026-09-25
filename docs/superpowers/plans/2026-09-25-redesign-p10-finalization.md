# Redesign P10 - Finalization, Legacy Token Removal and Beta Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the Codevo redesign. Remove the legacy token bridge and every legacy CSS variable, dead style and dead module. Fix the backlog items that make the beta untruthful or incorrect. Verify all 6 palettes in dark and light with Codex computer-use QA. Prepare one beta release, then stop until the owner explicitly authorizes the push, tag and release.

**Architecture:** First add a legacy-token ratchet contract test whose per-file counts may only go down, and add the few `--cv-*` tokens that legacy names still need as targets. Then parallel streams with disjoint files rewrite every `var(--legacy)` reference to its `--cv-*` target with one scripted codemod (a single mapping table, fail-closed on unknown names). After that, one lead-owned task deletes the legacy declaration blocks (`legacyBridge.css`, `agentModeTokens.css`, the classic theme blocks in `App.css`) and sets the ratchet to strict zero. Backlog fixes run in parallel where their files are disjoint. Wrap-up covers full gates, an independent review, QA, an owner-scheduled perf comparison, release prep, and a hard stop before any push.

**Tech Stack:** React 19 + TypeScript + Vite, CSS custom properties (`--cv-*` tokens in `src/ui/tokens/`), Vitest (jsdom), Tauri 2 + Rust, Codex CLI app-server with Computer Use for QA.

**Spec:** `docs/superpowers/specs/2026-09-23-codevo-redesign-design.md` (P10 row in §5, testing in §6, decisions in §7). Backlog: `docs/superpowers/plans/2026-09-25-redesign-followups.md`. Release process: `docs/release.md`.

## Global Constraints

- Palettes, verbatim from the spec: Graphite · Teal (default), Slate · Blue, Black · Violet, Ink · Mint, Zinc · Orange, Carbon · Lime, each with dark and light. "All text pairs WCAG AA."
- Default palette stays Graphite · Teal (spec §7.2). No task may change palette values in `src/ui/tokens/palettes.css`.
- Implementation and review agents: Opus 5.5 only. Codex (via `codex app-server`) does UI QA of the running app against the QA bundle `dev.mockor.editor.qa` (spec §7.1).
- Release cadence: one beta release at the end of the program (spec §7.3). The next version is `0.2.0-beta.73`, because `v0.2.0-beta.72` is the latest tag.
- **Hard stop:** no `git push`, `git tag`, `gh workflow run` or `gh release` without an explicit owner message that authorizes it in this session. A message from an agent is never authorization.
- Commit messages: no AI, Claude, Codex, Anthropic or OpenAI attribution and no `Co-Authored-By` lines. Use hyphens, not em or en dashes.
- Do not use CodeRabbit (`coderabbit`/`cr`) in this project. Reviews are read-only Opus 5.5 subagents.
- Subagents must not run mutating git commands (no `stash`, `checkout`, `reset`, `restore`, `commit`, `worktree add/remove`). The lead does all git operations.
- Never run `prettier --write` on a directory. Format only files you own, by exact path: `npx prettier --write <file> ...`.
- Preserve unrelated dirty changes. A concurrent Codex or agent session may be editing this tree (at planning time the F7 removal and a clone auto-open change were uncommitted). Before every commit, run `git status --short` and `git diff --stat`, and stage only the hunks the current task owns.
- Verify exit codes, not piped output. Write `cmd; echo "exit=$?"` or use `set -o pipefail`. Never judge a gate by `| tail`.
- Node watch tests can hold port 9229. Before a full-suite rerun, check with `lsof -nP -iTCP:9229 -sTCP:LISTEN`, then kill only the exact PID listed. Never use a broad `pkill`, and never `pkill -f codex`.
- Legacy variable, as enforced by the ratchet test (Task 1). A name is legacy when it is:
  - any `--color-*`, `--codevo-*`, `--symbol-*`, `--vis-*` or `--radius-*` name;
  - `--change-added*`, `--change-deleted*` or `--change-modified*`;
  - one of the 33 alias names listed in Task 1;
  - an `--agent-*` name that is not a layout variable.

  Layout variables are allowed: `--agent-rail-*`, `--agent-right-panel-*`, `--agent-bottom-panel-*`, `--agent-find-pill-*`, `--agent-minimap-*`, `--agent-center-min-width`, `--agent-surface-header-height`, `--agent-surface-editor-gutter`, `--agent-surface-focus-gutter`, `--agent-session-gutter`, `--agent-find-inset`, `--agent-turn-gap` and `--agent-row-pad`. Component-local variables (`--toast-*`, `--provider-pill-*`, `--history-lane-*`, `--settings-wire-*`, `--change-popover-*`, `--window-*`, `--minimap-pitch`, `--terminal-surface-background`) are allowed, as long as their values resolve to `--cv-*` tokens.
- Baselines only decrease. That covers `scripts/hotspot-size-baseline.json` (only through `node scripts/check-hotspot-size-budget.mjs --update`, which refuses growth), `scripts/react-hooks-exhaustive-deps-baseline.json` and `src/ui/tokens/legacyTokenBaseline.json`.
- Do not commit `perf/results/*`, build output, logs, coverage, QA prompts or scratch scripts. Scratch lives in `$HOME/tmp/codevo-p10/` (create it with `mkdir -p "$HOME/tmp/codevo-p10"`). It must never be under `/tmp`, where files are executed.
- Scope is presentation cleanup and truthfulness. Do not add features that the backlog triage defers.

## Review Focus

1. **Portaled surfaces lose tokens.** Dialogs, toasts, menus and Monaco overflow widgets render outside `.app-shell` and `.workbench-frame`. The old `--codevo-*` tokens were declared on `.app-shell` and the old `--agent-*` tokens on `.workbench-frame`, so a mapping that points at a scoped variable would paint these surfaces transparent. Expected: every `var(--cv-*)` reference resolves to a declaration in `src/ui/tokens/*.css` at `:root` level. Pinned by the "every palette reference is declared" test in Task 8.
2. **Palette scheme and classic syntax theme disagree.** Examples: a light palette with the Dracula syntax theme, or a dark palette with One Light. Expected: native scrollbars and inputs (`color-scheme`), rail tints and soft fills follow the palette scheme (`data-cv-scheme`), never the classic `data-theme`. Pinned by the `color-scheme` test in Task 2 and the "no `data-theme` selector" test in Task 8.
3. **Non-default thread font size.** With the Settings thread font size set above 100%, surfaces migrated from `--codevo-fs-*`/`--agent-fs-*` must still scale. Pinned by the type-scale test in Task 2, the codemod mapping check in Task 3 and QA step R4 in Task 22.
4. **The owner changes while integrate or remove-worktree is in flight** (project generation A → B → A, or the thread moves to another worktree). Expected: a side effect that already succeeded is reported as success without publishing into the new owner, and a failure is reported as `authorityLost`. Pinned by the Task 12 tests.
5. **A multibyte character split across terminal reads.** This covers Slovak diacritics and emoji split at every byte boundary. Expected: the interactive terminal never shows U+FFFD for valid UTF-8. Pinned by the boundary-sweep test in Task 15.

---

## Measured state at planning time (HEAD 493916e74 plus the dirty tree)

Measurement script: `$HOME/tmp/codevo-p10/legacy-token-counts.mjs` from Task 3. It uses the same predicate as the ratchet test.

**Totals.** There are 3,344 legacy-name occurrences in 88 files under `src/`, counting declarations, `var()` references, TS string literals and test expectations. Of these, 1,868 are `var()` references in 58 production files and 182 are `var()` references in 18 test files. There are 850 legacy declarations: `App.css` 623, `agentModeTokens.css` 190 and `legacyBridge.css` 37. The code references 192 distinct legacy names.

**References by family (production `var()` uses):**

| Family | Uses | Files |
|---|---|---|
| `--color-*` | 753 | 26 |
| `--change-*` | 35 | 1 |
| `--agent-*` | 471 | 18 |
| `--codevo-*` | 610 | 32 |

The alias tier includes `--border-subtle` (45 uses), `--text-muted` (35), `--background-active` (3) and `--status-error` (4). `--radius-*` has 60 uses, `--symbol-*` 11 and `--vis-*` 3.

**Occurrences per file (the Task 1 baseline, `src/`-relative):**

| File | Count | File | Count |
|---|---|---|---|
| App.css | 1366 | components/agentMode/agentModeTokens.css | 312 |
| components/cssTokenContract.test.ts | 158 | components/agentMode/agentModeTokens.test.ts | 146 |
| domain/themeContrast.test.ts | 133 | components/agentMode/agentMode.css | 121 |
| components/agentMode/agentThread.css | 113 | components/agentMode/remoteAddProject/remoteAddProject.css | 98 |
| components/agentMode/agentTerminalSessionsPalette.css | 83 | components/agentMode/agentSurface.css | 75 |
| components/agentMode/agentOutputArtifacts.css | 59 | components/agentMode/agentRail.css | 50 |
| components/agentMode/agentHistory.css | 49 | ui/tokens/legacyBridge.test.ts | 41 |
| ui/tokens/legacyBridge.css | 37 | components/agentMode/agentThreadStyles.test.ts | 33 |
| components/ExternalFileConflict.css | 29 | components/toastNotification.css | 27 |
| components/PhpChangeSignatureDialog.css | 26 | components/DirtyCloseDecisionDialogHost.css | 24 |
| components/agentMode/projectRepositoryPicker.css | 19 | components/monacoWidgetStyles.test.ts | 18 |
| components/agentMode/AgentThreadsSidebar.test.tsx | 18 | components/fileTypeGlyph.css | 15 |
| components/QuickInputDialogHost.css | 15 | components/PackageDependenciesPanel.tsx | 15 |
| components/agentMode/AgentSurfacePanel.test.tsx | 13 | components/agentMode/conversation/agentProse.css | 12 |
| components/terminalPanel.css | 11 | components/workbenchShellFrame.css | 10 |
| components/remoteRunner/remoteRunnerTaskPanel.css | 10 | components/TestResultsPanel.tsx | 9 |
| components/SymfonyWorkspacePanel.tsx | 9 | components/agentMode/agentImportedHistory.css | 9 |
| components/FunctionBreakpoints.tsx | 8 | components/NetteWorkspacePanel.tsx | 8 |
| components/textEntryFocusContract.test.ts | 8 | components/workbenchShellFrame.expanded.test.ts | 8 |
| components/NodeLaunchConfigurationPicker.tsx | 7 | components/NetteWorkspacePresentersPanel.tsx | 7 |
| components/NetteWorkspaceRoutesPanel.tsx | 7 | components/VscodeProcessTasksPanel.tsx | 7 |
| components/NodeDebugAttachProcessPicker.tsx | 6 | components/agentMode/agentModeResponsiveStyles.test.ts | 6 |
| components/NodePackageScriptsPanel.tsx | 5 | components/cssContractTestSupport.ts | 5 |
| components/agentMode/AgentSurfaceEmptyState.test.tsx | 5 | components/agentMode/projectMachinePicker.css | 5 |
| components/agentMode/conversation/conversation.css | 5 | components/agentMode/conversation/conversationStyles.test.ts | 5 |
| components/remoteRunner/remoteSurfacePanels.css | 5 | components/GitHistoryPanel.tsx | 4 |
| components/JsTestOutputView.tsx | 4 | components/NodeLaunchConfigurationsDialog.tsx | 4 |
| components/AgentFrameFallback.test.tsx | 3 | components/ExpressRoutesPanel.tsx | 3 |
| components/FunctionBreakpoints.test.tsx | 3 | components/JsTestExplorerPanel.tsx | 3 |
| components/agentMode/AgentThreadSession.minimap.test.tsx | 3 | components/agentMode/conversation/agentWorkRows.css | 3 |
| components/remoteRunner/remoteProjectCloneForm.css | 3 | domain/terminalCommandDecoration.test.ts | 3 |
| components/ArtisanRoutesPanel.tsx | 2 | components/ExceptionTypeFilter.tsx | 2 |
| components/NodeDebugLaunchSelector.tsx | 2 | components/VscodeProcessTasksPanel.test.tsx | 2 |
| components/appShellTypeScale.test.ts | 2 | components/htmlEditorPreview.css | 2 |
| components/monacoPaletteParity.test.ts | 2 | components/terminalSession.test.ts | 2 |
| components/agentMode/composer/agentComposerFrame.css | 2 | components/remoteRunner/remoteInstructionSource.css | 2 |
| domain/fileTypeGlyph.test.ts | 2 | domain/terminalCommandDecoration.ts | 2 |
| components/JsTestCoverageReport.tsx | 1 | components/PhpTestResultsPanel.tsx | 1 |
| components/TerminalPanel.test.tsx | 1 | components/appShellTypeScale.ts | 1 |
| components/cssBorderContract.test.ts | 1 | components/workbenchPanelViews.tsx | 1 |
| components/agentMode/agentQuestionCard.css | 1 | components/agentMode/agentShellFrame.test.ts | 1 |
| components/agentMode/agentUsage.css | 1 | components/agentMode/useAgentComposerAutosize.test.tsx | 1 |
| components/agentMode/conversation/agentTurnChangesRow.css | 1 | components/agentMode/remoteAddProject/remoteCloneDestination.css | 1 |
| components/remoteRunner/remoteTerminalPanel.css | 1 | startupDocument.test.ts | 1 |

**Components that still rely on the bridge:**

- **Direct.** These files reference `--color-*`/`--change-*`, which only `legacyBridge.css` maps to palette tokens:
  - `App.css`, `agentModeTokens.css`, `agentMode.css`;
  - `ExternalFileConflict.css`, `DirtyCloseDecisionDialogHost.css`, `QuickInputDialogHost.css`, `terminalPanel.css`, `htmlEditorPreview.css`;
  - `remoteRunnerTaskPanel.css`, `remoteSurfacePanels.css`, `remoteProjectCloneForm.css`, `remoteInstructionSource.css`, `remoteTerminalPanel.css`;
  - `VscodeProcessTasksPanel.tsx`, `FunctionBreakpoints.tsx`, `GitHistoryPanel.tsx`, `domain/terminalCommandDecoration.ts`.
- **Transitive through `agentModeTokens.css`.** `--codevo-*` maps to `--color-*` and then to the bridge, and `--agent-*` maps to `--codevo-*`. This covers every agentMode sheet, `toastNotification.css`, `fileTypeGlyph.css` and `workbenchShellFrame.css`.
- **Transitive through the App.css alias tier.** `--border-subtle`, `--text-muted`, `--background-active` and the rest map to `--color-*`. This covers the inline styles in:
  - `NodeLaunchConfigurationPicker`, `NodeDebugAttachProcessPicker`, `NodeDebugLaunchSelector`, `NodeLaunchConfigurationsDialog`, `FunctionBreakpoints`, `ExceptionTypeFilter`;
  - `TestResultsPanel`, `JsTestOutputView`, `JsTestExplorerPanel`, `JsTestCoverageReport`, `PackageDependenciesPanel`, `NodePackageScriptsPanel`, `ExpressRoutesPanel`, `workbenchPanelViews`;
  - the Nette, Symfony, Artisan and PhpTestResults panels, and `PhpChangeSignatureDialog.css`.

  So all 58 production files with legacy references depend on the bridge, directly or transitively.

**Latent bugs found while measuring (fixed by Tasks 2 and 8):**

- `color-scheme` is set only by the classic `data-theme` blocks, plus a hard-coded `color-scheme: dark` on `.app-shell` at `App.css:770`. A light palette therefore gets dark native scrollbars and inputs.
- The rail muted/strong overrides in `agentRail.css` and the soft-tint and shadow overrides in `agentModeTokens.css` key on the classic syntax theme (`data-theme="light|catppuccinLatte|oneLight|system"`) instead of the palette scheme.

**Dead styles (heuristic: class never appears as a token in non-test TS/TSX):** about 60 candidates outside Monaco/xterm-owned classes:

- `agentThread.css`: `agent-subagents*`, `agent-subagent*`, `agent-reasoning`, `agent-changes__head`, `agent-diff*`, `agent-menu__item--danger`, `agent-menu__item--armed`.
- `agentMode.css`: `agent-dot*`, `workbench-mode-switch`, `smart-mode-switch`, `agent-rail__head`, `agent-session__head`, `toolbar-status`, `toolbar-progress`, `agent-session__status--archived`, `agent-row__rename`.
- `agentSurface.css`: `agent-session__changes-cue`, `agent-session__changes-sep`.
- `remoteAddProject.css`: `agent-remote-add-project__prefixed`, `agent-remote-add-project__prefix`, `agent-project-source__environment`, `agent-project-source__environment-label`.
- `App.css`: `breakpoint-editor-error`, `breakpoint-editor-actions`, `setup-manual-install*`.
- One each in `settings.css` (`settings-screen__title`), `remoteSurfacePanels.css` (`remote-surface-patch`), `projectRepositoryPicker.css` (`project-repository-picker__host-value`) and `agentHistory.css` (`agent-history-pager`).

`todo-tag` modifiers (`xxx`, `fixme`, `hack`) are dynamic (`TodoPanel.tsx:145`) and are not dead.

**Dead modules (unimported, or imported only by tests), to verify in Task 10:**

- `application/legacyJavaScriptTypeScriptDocumentSave.ts`
- `components/JsTestResultsPanel.tsx`
- `components/PhpFileOutlineRows.tsx`
- `components/agentMode/useTouchComposerLayout.ts`
- `components/nettePhpLinkMonacoProviders.ts`
- `components/GitChangesPanel.tsx`
- `components/NodeRunStatusAction.tsx`
- `components/WorkbenchScriptsTasksPanel.tsx`
- `components/remoteRunner/RemoteRunnerTaskPanel.tsx`
- `components/appSmartModeSummary.ts`
- `application/useAgentCliVersion.ts`, `application/useAgentSettingsCliVersions.ts` and `infrastructure/tauriAgentCliVersionGateway.ts`

Worker files (`*.worker.ts`) and `settings/primitives/index.ts` are false positives, because they are imported by URL or by directory.

---

## Backlog triage

(a) = fix in P10, (b) = defer past the beta. Every (b) item that users can notice goes into the CHANGELOG "Known issues" (Task 23).

| # | Item (followups doc section) | Decision | Reason / owning task |
|---|---|---|---|
| W1 | Adoption that never settles leaves the old token; close returns staleOwner (Workspace registration) | (b) | Needs backend fault injection over ~1.85 s. It belongs in a dedicated admission slice with deterministic fault tests and is not reachable in normal use. |
| W2 | Rollback dropped when the compensation queue (16) is full is never retried | (b) | Same admission slice. A retry queue needs its own bound and proof, which is too risky before a release. |
| W3 | Post-await adopt re-check rolls back the new token after the backend adopted | (b) | Same slice. It only tears down the workspace when a second same-root open is also abandoned. |
| W4 | Lease restored on `Releasing` | (b) | It self-heals on the next release, with no leak. |
| W5 | Single `cleanupTransportReserved` slot fails a concurrent unregister immediately | (b) | Fails closed with no leak. Queueing is a UX improvement. |
| W6 | Poisoned-lock recovery in `UnpublishedAdmission::drop` has no deterministic test | (b) | Test debt only, with no behavior change. |
| W7 | `dispose_workspace_root` stops runtimes without consulting other owners | (b) | Needs an owner-registry design. Listed as an open risk. |
| W8 | Degraded `ignoreRules` truncation is on the wire but not shown | (b) | Not cheap: `startWatching` returns `Promise<void>`, so it needs a port contract change, owner-scoped state and a UI surface. First post-beta item, and a CHANGELOG known issue. |
| T1 | Output split mid-character renders garbled | (a) | Verified. `terminal_session_events.rs:67` decodes each PTY read with `from_utf8_lossy`. Package-task tagged output already uses an incremental decoder. **Task 15.** |
| T2 | Script outcomes live in AgentModeView state and are lost on unmount | (b) | Only the displayed exit state is lost. Process ownership is in Rust. Moving the state to an application store is a separate slice. |
| T3 | Scripts: no port detection, no per-row More menu | (b) | Feature work. |
| R1 | Cmd+P opens global Quick Open instead of focusing Files search | (b) | Matches VS Code. Revisit after K1 (binding-scoped focus). |
| R2 | Files breadcrumb segments are plain text | (b) | Feature (reveal buttons). Plain text is truthful and accessible. |
| R3 | Files git markers refresh after a commit only while Diff/Git/PR is open | (a) | Stale markers are untruthful. Cheap: extend the git-status demand to the visible Files surface. **Task 16.** |
| R4 | Push from a non-agent branch in a managed worktree fails | (b) | Fails with a visible error. Needs an investigation of the upstream policy. CHANGELOG known issue. |
| R5 | Commit messages are heuristic, not model-generated | (b) | Feature. |
| R6 | A thread can't be opened in an existing worktree | (b) | Feature. |
| R7 | Large diffs aren't virtualized | (b) | Already bounded (500 files, 12 expanded, 2000 lines/file) with truncation state. Virtualization needs perf evidence. |
| K1 | Focus scope is attached to the command, not the binding | (b) | Keymap model change. It only affects a rebound `palette.open`. |
| K2 | Default conflicts Shift+F5, F2 (non-mac), Cmd+Shift+K | (b) | The pairs are separated by focus scope (`editorText` vs `outsideEditorText`) or debug-session context, as in VS Code. Verified in QA step R6, not changed. |
| K3 | Palette Files-page footer cramped | (a) verify-only | `CommandPalettePage.tsx` no longer renders a syntax line (HEAD shows 4 hints). Confirmed in QA step R7. No code task unless QA fails. |
| K4 | Projects/threads/branches use token substring, not fuzzy | (b) | Matching works. Ranking improvement later. |
| C1 | Cmd+F highlight misses rows loaded via "Load earlier activity" | (b) | Needs a find index over paged log rows with a bounded memory design. |
| C2 | Codex subagent timer undercounts when opened mid-run | (b) | Needs a start time on the wire (TS and Rust contract change). |
| C3 | Selected thread marked read when agent mode isn't visible | (b) | Since P2 the agent workbench is always the main screen. Only the Settings overlay triggers this. Low impact. |
| C4 | Inline find bar lifts with a shadow and has an accent magnifier on focus | (a) | Cheap CSS. It sits in the same sheet as the migration. **Task 6.** |
| G1 | `integrate`/`removeWorktree` report authorityLost after a successful side effect | (a) | Truthfulness bug. Apply the commit/push policy: success settles without publishing. **Task 12.** |
| G2 | Selected palette card uses the focus ring | Resolved in P9 | `settingsStyles.test.ts` ("marks the selected palette card with the selection ring, not the focus ring") and a check glyph in `AppearancePaletteSwatches.tsx`. Verified in QA step R5 only. |
| S1 | Settings > Archive lists only local threads | (b) | Merging the remote store into Archive is a feature. CHANGELOG known issue. |
| S2 | Bulk Unarchive in the rail selection bar is unreachable | (a) | Dead code: no caller passes `archivedCount`. Remove it rather than add bulk unarchive to Archive. **Task 17.** |
| S3 | Slim archived row variant is dead in the rail | (a) | Dead code. **Task 17** (verify, then remove). |
| CL1 | Server `remote:` lines steer the clone failure classifier; `ssl` is too broad | (a) | Cheap, pure function, table-tested. **Task 14.** |
| CL2 | Clone trust revoke doesn't stop runtimes | (b) | No action: a freshly created folder has no runtimes. Documented only. |
| CL3 | A failed `core.sshCommand` lookup lets the batch SSH command override the user's | (b) | Rare (only when the git config lookup fails or times out). Needs a fail-closed error-path design. |
| CL4 | Persisted `revoked_roots` grows without bound | (a) | Unbounded persisted state. Cap it with deterministic FIFO eviction. **Task 13.** |
| CL5 | Exact-string refusal instead of a typed error code | (b) | The string is pinned on both sides by `contracts/workspace-trust-errors.json`. A typed code changes the command error shape. |
| E1 | `statusBar` keys other than cursorPosition/index/languageServer do nothing | (a) | Dead toggles are untruthful. There are 9 dead chips. **Task 11.** |
| E2 | `sidebarView`/`setSidebarView` still in the controller and session cache | (b) partial | Full removal changes the persisted session schema and the PHP-tree drawer refresh coupling. That is a controller slice after the beta. The truthfulness part is (a): the "Show Git Changes" palette command sets a sidebar view that no longer renders. **Task 16.** |
| E3 | AgentSurfacePanel sets `data-tree` with no CSS consumer | (a) | Dead attribute. **Task 6** (same test file as the migration). |
| E4 | Git amend / stage / unstage / revert from the old sidebar are unreachable | (b), **owner decision** | This is a capability lost relative to spec §1. Recommendation: ship the beta with a CHANGELOG known issue and make "Git surface: amend and discard" the first post-beta slice. The dead `GitChangesPanel.tsx` is removed in Task 10 (history keeps it). If the owner rejects this, stop before Task 23 and plan the slice. |
| N1 | Clone auto-open only starts from the visible clone composer; sidebar keeps the default-scope highlight (new entry, added during planning) | (b) | Owned by the in-flight clone change in the dirty tree. Re-triage when that lands. The highlight is visual only. |
| N2 | `phpTree.show` also targets the retired sidebar view (found while measuring) | (b) | PHP is out of priority (CLAUDE.md). Bundle with E2. |
| N3 | Light tints and native `color-scheme` follow the classic syntax theme, not the palette scheme (found while measuring) | (a) | Cross-scheme visual bug. **Tasks 2 and 8.** |

---

## File Structure and Ownership

The parallel streams have disjoint write sets. The lead owns integration, baselines, commits and every task marked "lead".

| Task | Owner / stream | Creates | Modifies | Deletes |
|---|---|---|---|---|
| 1 | Lead | `src/ui/tokens/legacyTokenRatchet.test.ts`, `src/ui/tokens/legacyTokenBaseline.json` | - | - |
| 2 | Lead | `src/ui/tokens/replacementTokens.test.ts` | `src/ui/tokens/semantic.css`, `src/components/appShellTypeScale.ts`, `src/components/appShellTypeScale.test.ts`, `src/components/agentMode/agentModeTokens.css` (one transitional line) | - |
| 3 | Lead (scratch only) | `$HOME/tmp/codevo-p10/legacy-token-codemod.mjs`, `$HOME/tmp/codevo-p10/legacy-token-counts.mjs` | - | - |
| 4 | Stream A | - | the 22 inline-styled TSX panels listed in Task 4, `src/domain/terminalCommandDecoration.ts`, `src/components/PhpChangeSignatureDialog.css`, their tests | - |
| 5 | Stream B | - | `src/App.css` (references only, not the token blocks) | - |
| 6 | Stream C | - | every `src/components/agentMode/**/*.css` except `agentModeTokens.css`, the agentMode tests listed in Task 6, `AgentSurfacePanel.tsx` (`data-tree`) | - |
| 7 | Stream D | - | the 15 remaining component sheets and tests listed in Task 7 | - |
| 8 | Lead (after 4-7) | - | `src/App.css`, `src/ui/tokens/tokens.css`, `src/components/workbenchShellFrame.css`, `src/components/cssContractTestSupport.ts`, `src/components/cssTokenContract.test.ts`, `src/domain/themeContrast.test.ts`, the ratchet files | `src/ui/tokens/legacyBridge.css`, `legacyBridge.test.ts`, `src/components/agentMode/agentModeTokens.css`, `agentModeTokens.test.ts` |
| 9 | Stream C owner (after 8) | `src/ui/tokens/deadStyleGuard.test.ts` | the sheets that contain the dead classes | - |
| 10 | Stream A owner (after 8) | - | importers found during verification, `scripts/hotspot-size-baseline.json` (`--update` only) | the verified dead modules and their tests |
| 11 | Stream E | - | `src/domain/settings.ts`, `settings.test.ts`, `GeneralStatusBarRows.tsx`, `GeneralSettingsPage.test.tsx`, `browserSettingsGateway.test.ts` | - |
| 12 | Stream E | - | `src/application/useAgentShipFlow.ts`, `useAgentShipFlow.test.tsx` | - |
| 13 | Stream F (Rust) | `src-tauri/src/trust/revoked_roots.rs` | `src-tauri/src/trust.rs` | - |
| 14 | Stream F (Rust) | - | `src-tauri/src/local_clone/failure.rs`, `progress_tests.rs` | - |
| 15 | Stream F (Rust) | `src-tauri/src/incremental_utf8.rs` | `terminal_session_events.rs`, `node_package_tagged_utf8.rs`, `terminal_module_registration.rs` | - |
| 16 | Stream E | `src/application/agentGitStatusDemand.ts` | `workbenchGitSidebarCommands.ts` (+test), `useWorkbenchCommandRegistry.ts` (one hunk), `useWorkbenchController.ts` (import hunk), `useWorkbenchSidebarDataRefresh.test.tsx` | `src/application/agentDiffStatusDemand.ts` |
| 17 | Stream C owner (after 6) | - | `AgentThreadSelectionBar.tsx`, `domain/agentThreadBulkAction.ts` (+test), `useAgentThreadMenuCommands.ts`, `agentSidebarPresentation.ts`, `AgentThreadRow.tsx`, their tests | - |
| 19-24 | Lead | QA prompts and release prompt in `$HOME/tmp/codevo-qa/` | `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/tauri.conf.json`, `CHANGELOG.md` | - |

Order:

1. Tasks 1 → 2 → 3 (lead, sequential).
2. Tasks 4, 5, 6 and 7 in parallel (one Opus 5.5 agent each), together with Tasks 11-16 (Streams E and F, one agent each).
3. Task 8 (lead) once 4-7 are accepted.
4. Tasks 9, 10 and 17 in parallel.
5. Wrap-up 18-24. Task 19 (perf) runs whenever the owner grants a hands-off window after Task 8.

Contested files and how they are resolved:
- **`AgentSurfacePanel.test.tsx`** has migration edits and the `data-tree` removal, so both go to Stream C in Task 6.
- **`agentRail.css`** has migration edits, `data-theme` rewrites and dead slim-row selectors. Stream C does the migration and the `data-theme` rewrite (Task 6). The slim selectors fall to Task 9's dead-style sweep after Task 17 removes the producer.
- **`useWorkbenchController.ts`** gets only the one-line import change in Task 16. No other P10 task touches it.
- **`legacyTokenBaseline.json`** is lead-only. Streams never edit it. The lead lowers it after accepting each stream (Task 3, Step 4). This avoids write collisions on the shared file.

---

## Preconditions (lead, before Task 1)

- [ ] **P-1: Settle the dirty tree.** Run:

```bash
cd /Users/matusmockor/Developer/editor
git status --short
git diff --stat
```

At planning time the tree held uncommitted work from another session: the F7 update-channel removal (43 files), the spec and followups edits, and `AgentModeView.tsx`. Do not start P10 on top of unowned hunks. Ask the owner whether that work is finished and committed. Proceed only once `git status --short` is empty, or contains only files the owner has handed to P10.

- [ ] **P-2: Record the starting commit.**

```bash
git rev-parse HEAD > "$HOME/tmp/codevo-p10/base-sha.txt"; echo "exit=$?"
```

(Create the directory first with `mkdir -p "$HOME/tmp/codevo-p10"`.)

---

### Task 1: Legacy-token ratchet contract test

**Files:**
- Create: `src/ui/tokens/legacyTokenRatchet.test.ts`
- Create: `src/ui/tokens/legacyTokenBaseline.json`

**Interfaces:**
- Consumes: `SRC_ROOT` from `src/components/cssContractTestSupport.ts`.
- Produces: the legacy predicate, as the exact regexes and alias set below, which Task 3 copies. Also `legacyTokenBaseline.json` (`Record<string, number>` keyed by `src/`-relative path), which only the lead lowers.

- [ ] **Step 1: Write the test**

```ts
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { SRC_ROOT } from "../../components/cssContractTestSupport";

const SCANNED_EXTENSIONS = [".css", ".ts", ".tsx"] as const;
const SELF = "ui/tokens/legacyTokenRatchet.test.ts";
const BASELINE = "ui/tokens/legacyTokenBaseline.json";
const MAX_FILES = 6000;
const MAX_DEPTH = 12;
const TOKEN = /(?<![\w-])--[a-z][a-z0-9-]*/g;
const LEGACY_FAMILY =
  /^--(?:color-|codevo-|symbol-|vis-|radius-|change-(?:added|deleted|modified))/;
const LAYOUT_VARIABLE =
  /^--agent-(?:rail-|right-panel-|bottom-panel-|find-pill-|minimap-|center-min-width$|surface-header-height$|surface-editor-gutter$|surface-focus-gutter$|session-gutter$|find-inset$|turn-gap$|row-pad$)/;
const LEGACY_ALIASES: ReadonlySet<string> = new Set([
  "--accent",
  "--background-active",
  "--background-primary",
  "--border-color",
  "--border-strong",
  "--border-subtle",
  "--button-primary-bg",
  "--danger-border",
  "--danger-surface",
  "--danger-text",
  "--editor-background",
  "--editor-bg",
  "--input-background",
  "--panel-background",
  "--panel-bg",
  "--selection-background",
  "--selection-bg",
  "--status-error",
  "--status-success",
  "--success",
  "--surface-control",
  "--surface-input",
  "--surface-raised",
  "--text-danger",
  "--text-muted",
  "--text-primary",
  "--text-secondary",
  "--warning",
  "--shadow-pop",
  "--focus-ring",
  "--motion-fast",
  "--motion-base",
  "--ease-standard",
]);

function isLegacyTokenName(name: string): boolean {
  if (name.endsWith("-")) return false;
  if (LEGACY_FAMILY.test(name) || LEGACY_ALIASES.has(name)) return true;
  return name.startsWith("--agent-") && !LAYOUT_VARIABLE.test(name);
}

function sourceFiles(directory: string, depth: number, found: string[]): string[] {
  expect(depth, directory).toBeLessThanOrEqual(MAX_DEPTH);
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      sourceFiles(path, depth + 1, found);
      continue;
    }
    if (!SCANNED_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) continue;
    found.push(relative(SRC_ROOT, path).split(sep).join("/"));
  }
  expect(found.length).toBeLessThanOrEqual(MAX_FILES);
  return found;
}

function legacyTokenCounts(): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const file of sourceFiles(SRC_ROOT, 0, []).sort()) {
    if (file === SELF) continue;
    const source = readFileSync(join(SRC_ROOT, file), "utf8");
    const count = (source.match(TOKEN) ?? []).filter(isLegacyTokenName).length;
    if (count > 0) counts[file] = count;
  }
  return counts;
}

function baseline(): Readonly<Record<string, number>> {
  const parsed: unknown = JSON.parse(readFileSync(join(SRC_ROOT, BASELINE), "utf8"));
  expect(parsed).toBeTypeOf("object");
  expect(Array.isArray(parsed)).toBe(false);
  return parsed as Readonly<Record<string, number>>;
}

describe("legacy token ratchet", () => {
  it("never lets a file gain legacy token names", () => {
    const allowed = baseline();
    const grown = Object.entries(legacyTokenCounts())
      .filter(([file, count]) => count > (allowed[file] ?? 0))
      .map(([file, count]) => `${file}: ${count} > ${allowed[file] ?? 0}`);

    expect(grown).toEqual([]);
  });

  it("classifies legacy families and leaves palette, layout and vendor variables alone", () => {
    const legacy = [
      "--color-text",
      "--change-added-soft",
      "--codevo-fg",
      "--agent-text-muted",
      "--text-muted",
      "--radius-sm",
      "--symbol-method",
    ];
    const allowed = [
      "--cv-fg",
      "--agent-rail-width",
      "--agent-right-panel-committed",
      "--change-popover-accent",
      "--vscode-editor-background",
      "--toast-surface",
      "--color-",
    ];

    expect(legacy.filter((name) => !isLegacyTokenName(name))).toEqual([]);
    expect(allowed.filter(isLegacyTokenName)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails (no baseline yet)**

Run: `npx vitest run src/ui/tokens/legacyTokenRatchet.test.ts; echo "exit=$?"`
Expected: FAIL with `ENOENT ... legacyTokenBaseline.json`.

- [ ] **Step 3: Create the baseline from the measured state**

Write `src/ui/tokens/legacyTokenBaseline.json` with the per-file counts from "Measured state", as sorted keys, 2-space JSON and a trailing newline. If HEAD moved since planning, regenerate the file with `node "$HOME/tmp/codevo-p10/legacy-token-counts.mjs" > src/ui/tokens/legacyTokenBaseline.json` (the script is in Task 3). Regenerating is allowed only in this step, before any migration.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/ui/tokens/legacyTokenRatchet.test.ts; echo "exit=$?"`
Expected: PASS (2 tests), `exit=0`.

- [ ] **Step 5: Commit**

```bash
npx prettier --check src/ui/tokens/legacyTokenRatchet.test.ts src/ui/tokens/legacyTokenBaseline.json
git add src/ui/tokens/legacyTokenRatchet.test.ts src/ui/tokens/legacyTokenBaseline.json
git commit -m "test(tokens): ratchet legacy CSS variable usage per file"
```

---

### Task 2: Replacement palette tokens, type scale and native color-scheme

**Files:**
- Modify: `src/ui/tokens/semantic.css` (the `:root` block, the dark block `:root,\n:root[data-cv-scheme="dark"]` and the light block `:root[data-cv-scheme="light"]`)
- Modify: `src/components/appShellTypeScale.ts:4`
- Modify: `src/components/appShellTypeScale.test.ts`
- Modify: `src/components/agentMode/agentModeTokens.css` (one transitional line; the file is deleted in Task 8)
- Create: `src/ui/tokens/replacementTokens.test.ts`

**Interfaces:**
- Produces the tokens Task 3 maps to:
  - `--cv-type-scale` (default `1`; set inline on `.app-shell` from `agentThreadFontSize`);
  - per-scheme `--cv-ok-soft`, `--cv-danger-soft`, `--cv-shadow-card`;
  - `--cv-ft-{ts,tsx,js,json,npm,md,css,sh,docker,git,env,lock}`;
  - `--cv-sym-{method,property,const,class,interface,enum,function,trait,variable,keyword}` and `--cv-vis-{public,private,protected}`;
  - scheme-independent `--cv-sym-icon-fg` (#000000) and `--cv-sym-badge-fg` (#ffffff).
- `AGENT_TYPE_SCALE_VARIABLE` becomes `"--cv-type-scale"`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { contrastRatio } from "../../domain/themeContrast";
import {
  buildTokenTable,
  lastOf,
  parseAllStyleSheets,
  selectorParts,
  type TokenTable,
} from "../../components/cssContractTestSupport";
import { AGENT_TYPE_SCALE_VARIABLE } from "../../components/appShellTypeScale";

const SHEET = "ui/tokens/semantic.css";
const SCHEMES = ["dark", "light"] as const;
const FILE_TYPES = ["ts", "tsx", "js", "json", "npm", "md", "css", "sh", "docker", "git", "env", "lock"];
const SYMBOLS = ["method", "property", "const", "class", "interface", "enum", "function", "trait", "variable", "keyword"];
const VISIBILITIES = ["public", "private", "protected"];
const SCHEMED_TOKENS = [
  "--cv-ok-soft",
  "--cv-danger-soft",
  "--cv-shadow-card",
  ...FILE_TYPES.map((kind) => `--cv-ft-${kind}`),
  ...SYMBOLS.map((kind) => `--cv-sym-${kind}`),
  ...VISIBILITIES.map((kind) => `--cv-vis-${kind}`),
];
const MINIMUM_ICON_CONTRAST = 3;

const parsed = parseAllStyleSheets();

function rules(scheme: (typeof SCHEMES)[number] | "root") {
  return parsed.rules.filter(
    (rule) =>
      rule.sheet === SHEET &&
      rule.context.length === 0 &&
      (scheme === "root"
        ? rule.selector === ":root"
        : selectorParts(rule.selector).includes(`:root[data-cv-scheme="${scheme}"]`)),
  );
}

function table(scheme: (typeof SCHEMES)[number] | "root"): TokenTable {
  return buildTokenTable(rules(scheme));
}

describe("replacement tokens for retired legacy variables", () => {
  it("declares every schemed replacement in both palette schemes", () => {
    const missing = SCHEMES.flatMap((scheme) => {
      const declared = table(scheme);
      return SCHEMED_TOKENS.filter((name) => !declared.has(name)).map((name) => `${scheme} ${name}`);
    });

    expect(missing).toEqual([]);
  });

  it("drives the thread type scale from the app shell with a neutral default", () => {
    expect(AGENT_TYPE_SCALE_VARIABLE).toBe("--cv-type-scale");
    expect(lastOf(table("root").get("--cv-type-scale"))).toBe("1");
  });

  it("paints native controls in the palette scheme, not the classic syntax theme", () => {
    for (const scheme of SCHEMES) {
      const values = rules(scheme)
        .flatMap((rule) => rule.declarations)
        .filter((declaration) => declaration.property === "color-scheme")
        .map((declaration) => declaration.value);
      expect(values, scheme).toEqual([scheme]);
    }
  });

  it("keeps symbol badge glyphs readable on every symbol colour in both schemes", () => {
    const foreground = lastOf(table("root").get("--cv-sym-icon-fg")) ?? "";
    const unreadable = SCHEMES.flatMap((scheme) =>
      SYMBOLS.map((kind) => ({ kind, color: lastOf(table(scheme).get(`--cv-sym-${kind}`)) ?? "" }))
        .filter(({ color }) => contrastRatio(foreground, color) < MINIMUM_ICON_CONTRAST)
        .map(({ kind, color }) => `${scheme} ${kind} ${color}`),
    );

    expect(foreground).toBe("#000000");
    expect(unreadable).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/ui/tokens/replacementTokens.test.ts; echo "exit=$?"`
Expected: FAIL. The missing-token list is non-empty and `AGENT_TYPE_SCALE_VARIABLE` is `"--codevo-fs-scale"`.

- [ ] **Step 3: Add the tokens**

Append to the end of the existing `:root {` block in `src/ui/tokens/semantic.css` (the first block, which holds `--cv-font-ui`):

```css
  --cv-type-scale: 1;
  --cv-sym-icon-fg: #000000;
  --cv-sym-badge-fg: #ffffff;
```

Append inside the dark block (`:root,\n:root[data-cv-scheme="dark"] {`):

```css
  color-scheme: dark;
  --cv-ok-soft: color-mix(in srgb, var(--cv-ok) 14%, transparent);
  --cv-danger-soft: color-mix(in srgb, var(--cv-danger) 14%, transparent);
  --cv-shadow-card: none;
  --cv-ft-ts: #3b8eea;
  --cv-ft-tsx: #38bdf8;
  --cv-ft-js: #e8d44d;
  --cv-ft-json: #e5a33b;
  --cv-ft-npm: #d64a3a;
  --cv-ft-md: #8fa3b8;
  --cv-ft-css: #7f9cf5;
  --cv-ft-sh: #4cc38a;
  --cv-ft-docker: #3aa0e6;
  --cv-ft-git: #f0603f;
  --cv-ft-env: #d7c26b;
  --cv-ft-lock: #8a8f98;
  --cv-sym-method: #b48ead;
  --cv-sym-property: #d08770;
  --cv-sym-const: #5e9cd0;
  --cv-sym-class: #a3be8c;
  --cv-sym-interface: #5fb3b3;
  --cv-sym-enum: #ebcb8b;
  --cv-sym-function: #b48ead;
  --cv-sym-trait: #6cb6c9;
  --cv-sym-variable: #8b94a3;
  --cv-sym-keyword: #b48ead;
  --cv-vis-public: #8fbf7f;
  --cv-vis-private: #d07f7f;
  --cv-vis-protected: #d8b977;
```

Append inside the light block (`:root[data-cv-scheme="light"] {`):

```css
  color-scheme: light;
  --cv-ok-soft: color-mix(in srgb, var(--cv-ok) 12%, transparent);
  --cv-danger-soft: color-mix(in srgb, var(--cv-danger) 10%, transparent);
  --cv-shadow-card: 0 1px 2px rgba(18, 20, 30, 0.05), 0 6px 20px rgba(18, 20, 30, 0.05);
  --cv-ft-ts: #2f6fd0;
  --cv-ft-tsx: #0e8ec2;
  --cv-ft-js: #b39a12;
  --cv-ft-json: #c07d1a;
  --cv-ft-npm: #c53b2c;
  --cv-ft-md: #5f7389;
  --cv-ft-css: #4d6ee0;
  --cv-ft-sh: #1f9d5f;
  --cv-ft-docker: #1f7fc4;
  --cv-ft-git: #d9502f;
  --cv-ft-env: #9c8a2b;
  --cv-ft-lock: #7a7f88;
  --cv-sym-method: #8250c4;
  --cv-sym-property: #c25a3a;
  --cv-sym-const: #2f6fb0;
  --cv-sym-class: #3f7a3f;
  --cv-sym-interface: #1d7a86;
  --cv-sym-enum: #9a7016;
  --cv-sym-function: #8250c4;
  --cv-sym-trait: #2a7d6f;
  --cv-sym-variable: #6b727d;
  --cv-sym-keyword: #8a5c8f;
  --cv-vis-public: #3f8a3f;
  --cv-vis-private: #c2484a;
  --cv-vis-protected: #b07d18;
```

These values are copied verbatim from `agentModeTokens.css` (`.app-shell` dark and the light-theme block) and from `App.css` (`:root` dark and the `prefers-color-scheme: light` system block), so the migration keeps visual parity.

- [ ] **Step 4: Rename the type-scale variable with a transitional alias**

In `src/components/appShellTypeScale.ts` change line 4 to:

```ts
export const AGENT_TYPE_SCALE_VARIABLE = "--cv-type-scale";
```

In `src/components/agentMode/agentModeTokens.css`, replace `  --codevo-fs-scale: 1;` with:

```css
  --codevo-fs-scale: var(--cv-type-scale);
```

This alias keeps existing `var(--codevo-fs-scale)` consumers scaling until the streams rewrite them. Task 8 deletes it. In `src/components/appShellTypeScale.test.ts`, replace every `"--codevo-fs-scale"` expectation with `"--cv-type-scale"`, so the file's legacy count drops from 2 to 0.

- [ ] **Step 5: Run the focused tests**

Run: `npx vitest run src/ui/tokens src/components/appShellTypeScale.test.ts src/components/cssTokenContract.test.ts src/domain/themeContrast.test.ts; echo "exit=$?"`
Expected: PASS, `exit=0`. If `tokenCss.test.ts` or `tokenContrast.test.ts` pins an exact token list, add the new names to that list. Never remove an existing assertion.

- [ ] **Step 6: Lower the ratchet for the touched files and commit**

Run `node "$HOME/tmp/codevo-p10/legacy-token-counts.mjs" --lower src/ui/tokens/legacyTokenBaseline.json` (Task 3 creates the script; if Task 3 is not done yet, lower `components/appShellTypeScale.test.ts` from 2 to 0 by hand). The `agentModeTokens.css` count stays at 312 because the line is replaced, not added.

```bash
npx vitest run src/ui/tokens/legacyTokenRatchet.test.ts; echo "exit=$?"
npx prettier --check src/ui/tokens/semantic.css src/ui/tokens/replacementTokens.test.ts src/components/appShellTypeScale.ts src/components/appShellTypeScale.test.ts
git add src/ui/tokens/semantic.css src/ui/tokens/replacementTokens.test.ts src/components/appShellTypeScale.ts src/components/appShellTypeScale.test.ts src/components/agentMode/agentModeTokens.css src/ui/tokens/legacyTokenBaseline.json
git commit -m "feat(tokens): add palette replacements for retired legacy variables"
```

---

### Task 3: Codemod and counting scripts (lead, scratch, not committed)

**Files:**
- Create: `$HOME/tmp/codevo-p10/legacy-token-codemod.mjs`
- Create: `$HOME/tmp/codevo-p10/legacy-token-counts.mjs`

**Interfaces:**
- `node legacy-token-codemod.mjs --check <file>...` prints `file: N replacements` and every unknown legacy name, and exits 1 if any legacy `var()` has no mapping.
- `node legacy-token-codemod.mjs --write <file>...` rewrites in place. It is idempotent and refuses to write if anything is unknown.
- `node legacy-token-counts.mjs` prints the baseline JSON to stdout.
- `node legacy-token-counts.mjs --lower <baseline.json>` rewrites the baseline to `min(old, current)` per file, drops zeros, and exits 1 without writing if any file grew.

- [ ] **Step 1: Write the shared predicate module**

`$HOME/tmp/codevo-p10/legacy-predicate.mjs`:

```js
export const LEGACY_FAMILY =
  /^--(?:color-|codevo-|symbol-|vis-|radius-|change-(?:added|deleted|modified))/;
export const LAYOUT_VARIABLE =
  /^--agent-(?:rail-|right-panel-|bottom-panel-|find-pill-|minimap-|center-min-width$|surface-header-height$|surface-editor-gutter$|surface-focus-gutter$|session-gutter$|find-inset$|turn-gap$|row-pad$)/;
export const LEGACY_ALIASES = new Set([
  "--accent", "--background-active", "--background-primary", "--border-color",
  "--border-strong", "--border-subtle", "--button-primary-bg", "--danger-border",
  "--danger-surface", "--danger-text", "--editor-background", "--editor-bg",
  "--input-background", "--panel-background", "--panel-bg", "--selection-background",
  "--selection-bg", "--status-error", "--status-success", "--success", "--surface-control",
  "--surface-input", "--surface-raised", "--text-danger", "--text-muted", "--text-primary",
  "--text-secondary", "--warning", "--shadow-pop", "--focus-ring", "--motion-fast",
  "--motion-base", "--ease-standard",
]);

export function isLegacyTokenName(name) {
  if (name.endsWith("-")) return false;
  if (LEGACY_FAMILY.test(name) || LEGACY_ALIASES.has(name)) return true;
  return name.startsWith("--agent-") && !LAYOUT_VARIABLE.test(name);
}
```

- [ ] **Step 2: Write the codemod with the complete mapping table**

`$HOME/tmp/codevo-p10/legacy-token-codemod.mjs`:

```js
#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { isLegacyTokenName } from "./legacy-predicate.mjs";

const cv = (name) => `var(--cv-${name})`;
const scaled = (size) => `calc(${size} * var(--cv-type-scale))`;

export const LEGACY_TO_CV = new Map(
  Object.entries({
    "--color-accent": cv("accent"),
    "--color-accent-bar": cv("accent"),
    "--color-accent-soft": cv("accent-soft"),
    "--color-accent-text": cv("on-accent"),
    "--color-active": cv("s3"),
    "--color-active-muted": cv("s2"),
    "--color-active-text": cv("fg-strong"),
    "--color-app": cv("canvas"),
    "--color-bg": cv("canvas"),
    "--color-border": cv("hair"),
    "--color-border-strong": cv("hair-strong"),
    "--color-border-subtle": cv("hair"),
    "--color-control": cv("raised"),
    "--color-danger": cv("danger"),
    "--color-disabled": cv("fg-disabled"),
    "--color-editor": cv("canvas"),
    "--color-error": cv("danger"),
    "--color-focus": cv("focus"),
    "--color-hover": cv("tint-2"),
    "--color-hover-strong": cv("row-active"),
    "--color-input-background": cv("raised"),
    "--color-modal": cv("popover"),
    "--color-panel": cv("side"),
    "--color-panel-deep": cv("side"),
    "--color-panel-soft": cv("tint-2"),
    "--color-shadow": cv("s0"),
    "--color-sidebar": cv("side"),
    "--color-status": cv("side"),
    "--color-success": cv("ok"),
    "--color-surface": cv("raised"),
    "--color-surface-hover": cv("tint-2"),
    "--color-surface-raised": cv("popover"),
    "--color-surface-strong": cv("side"),
    "--color-tab": cv("canvas"),
    "--color-tab-active": cv("raised"),
    "--color-tabs": cv("canvas"),
    "--color-text": cv("fg"),
    "--color-text-muted": cv("fg-muted"),
    "--color-text-strong": cv("fg-strong"),
    "--color-text-subtle": cv("fg-subtle"),
    "--color-warning": cv("warn"),
    "--color-white": cv("sym-badge-fg"),
    "--change-added": cv("ok"),
    "--change-added-soft": cv("add-bg"),
    "--change-added-strong": cv("ok"),
    "--change-deleted": cv("danger"),
    "--change-deleted-soft": cv("del-bg"),
    "--change-deleted-strong": cv("danger"),
    "--change-modified": cv("warn"),
    "--change-modified-soft": cv("warn-soft"),
    "--change-modified-strong": cv("warn"),
    "--accent": cv("accent"),
    "--background-active": cv("accent-soft"),
    "--background-primary": cv("side"),
    "--border-color": cv("hair"),
    "--border-strong": cv("hair-strong"),
    "--border-subtle": cv("hair"),
    "--button-primary-bg": cv("accent"),
    "--danger-border": cv("danger"),
    "--danger-surface": cv("del-bg"),
    "--danger-text": cv("danger"),
    "--editor-background": cv("canvas"),
    "--editor-bg": cv("canvas"),
    "--input-background": cv("raised"),
    "--panel-background": cv("side"),
    "--panel-bg": cv("popover"),
    "--selection-background": cv("accent-soft"),
    "--selection-bg": cv("accent-soft"),
    "--status-error": cv("danger"),
    "--status-success": cv("ok"),
    "--success": cv("ok"),
    "--surface-control": cv("raised"),
    "--surface-input": cv("raised"),
    "--surface-raised": cv("popover"),
    "--text-danger": cv("danger"),
    "--text-muted": cv("fg-muted"),
    "--text-primary": cv("fg"),
    "--text-secondary": cv("fg-muted"),
    "--warning": cv("warn"),
    "--shadow-pop": cv("shadow-pop"),
    "--focus-ring": cv("ring-focus"),
    "--motion-fast": cv("motion-fast"),
    "--motion-base": cv("motion-base"),
    "--ease-standard": cv("ease"),
    "--radius-sm": cv("r-control"),
    "--radius-md": cv("r-card"),
    "--radius-lg": cv("r-group"),
    "--radius-xl": cv("r-group"),
    "--radius-pill": cv("r-pill"),
    "--symbol-method": cv("sym-method"),
    "--symbol-property": cv("sym-property"),
    "--symbol-const": cv("sym-const"),
    "--symbol-class": cv("sym-class"),
    "--symbol-interface": cv("sym-interface"),
    "--symbol-enum": cv("sym-enum"),
    "--symbol-function": cv("sym-function"),
    "--symbol-trait": cv("sym-trait"),
    "--symbol-variable": cv("sym-variable"),
    "--symbol-keyword": cv("sym-keyword"),
    "--symbol-icon-foreground": cv("sym-icon-fg"),
    "--vis-public": cv("vis-public"),
    "--vis-private": cv("vis-private"),
    "--vis-protected": cv("vis-protected"),
    "--codevo-active": cv("s3"),
    "--codevo-canvas": cv("canvas"),
    "--codevo-danger": cv("danger"),
    "--codevo-danger-soft": cv("danger-soft"),
    "--codevo-diff-add": cv("add-bg"),
    "--codevo-diff-del": cv("del-bg"),
    "--codevo-fg": cv("fg"),
    "--codevo-fg-disabled": cv("fg-disabled"),
    "--codevo-fg-muted": cv("fg-muted"),
    "--codevo-fg-strong": cv("fg-strong"),
    "--codevo-fg-subtle": cv("fg-subtle"),
    "--codevo-focus-ring": cv("ring-focus"),
    "--codevo-fs-scale": "var(--cv-type-scale)",
    "--codevo-fs-label": scaled("var(--cv-t-2xs)"),
    "--codevo-fs-small": scaled("var(--cv-t-xs)"),
    "--codevo-fs-meta": scaled("var(--cv-t-md)"),
    "--codevo-fs-ui": scaled("var(--cv-t-sm)"),
    "--codevo-fs-body": scaled("var(--cv-t-lg)"),
    "--codevo-fs-heading": scaled("17px"),
    "--codevo-fs-title": scaled("22px"),
    "--codevo-fs-hero": scaled("28px"),
    "--codevo-ft-css": cv("ft-css"),
    "--codevo-ft-docker": cv("ft-docker"),
    "--codevo-ft-env": cv("ft-env"),
    "--codevo-ft-git": cv("ft-git"),
    "--codevo-ft-js": cv("ft-js"),
    "--codevo-ft-json": cv("ft-json"),
    "--codevo-ft-lock": cv("ft-lock"),
    "--codevo-ft-md": cv("ft-md"),
    "--codevo-ft-npm": cv("ft-npm"),
    "--codevo-ft-sh": cv("ft-sh"),
    "--codevo-ft-ts": cv("ft-ts"),
    "--codevo-ft-tsx": cv("ft-tsx"),
    "--codevo-hover": cv("tint-2"),
    "--codevo-hover-soft": cv("tint-2"),
    "--codevo-line": cv("hair"),
    "--codevo-line-strong": cv("hair-strong"),
    "--codevo-mono": cv("font-mono"),
    "--codevo-ok": cv("ok"),
    "--codevo-ok-soft": cv("ok-soft"),
    "--codevo-primary": cv("accent"),
    "--codevo-primary-fg": cv("on-accent"),
    "--codevo-primary-soft": cv("accent-soft"),
    "--codevo-prose": cv("fg"),
    "--codevo-prose-subtle": cv("fg-subtle"),
    "--codevo-r-sm": cv("r-control"),
    "--codevo-r-md": cv("r-card"),
    "--codevo-r-lg": cv("r-group"),
    "--codevo-r-xl": cv("r-group"),
    "--codevo-r-pill": cv("r-pill"),
    "--codevo-raised": cv("raised"),
    "--codevo-sans": cv("font-ui"),
    "--codevo-selected": cv("row-active"),
    "--codevo-separator-inset": cv("edge-bottom-hair"),
    "--codevo-shadow-card": cv("shadow-card"),
    "--codevo-shadow-float": cv("shadow-pop"),
    "--codevo-shadow-window": cv("shadow-dialog"),
    "--codevo-side": cv("side"),
    "--codevo-thread": cv("canvas"),
    "--codevo-warn": cv("warn"),
    "--codevo-warn-soft": cv("warn-soft"),
    "--codevo-well": cv("raised"),
    "--codevo-well-soft": cv("tint-1"),
    "--agent-accent": cv("accent"),
    "--agent-attention": cv("warn"),
    "--agent-danger": cv("danger"),
    "--agent-fill": cv("s3"),
    "--agent-focus-ring": cv("ring-focus"),
    "--agent-fs-2xs": scaled("var(--cv-t-xs)"),
    "--agent-fs-xs": scaled("var(--cv-t-md)"),
    "--agent-fs-sm": scaled("var(--cv-t-md)"),
    "--agent-fs-md": scaled("var(--cv-t-sm)"),
    "--agent-fs-lg": scaled("17px"),
    "--agent-fs-xl": scaled("22px"),
    "--agent-glow-danger": cv("danger-soft"),
    "--agent-hairline": cv("hair"),
    "--agent-hairline-strong": cv("hair-strong"),
    "--agent-hover": cv("tint-2"),
    "--agent-lh-prose": cv("lh-prose"),
    "--agent-live": cv("accent"),
    "--agent-live-contrast": cv("on-accent"),
    "--agent-live-soft": cv("accent-soft"),
    "--agent-mono": cv("font-mono"),
    "--agent-motion-enter": cv("motion-base"),
    "--agent-motion-hover": cv("motion-fast"),
    "--agent-motion-select": cv("motion-base"),
    "--agent-ok": cv("ok"),
    "--agent-outline-button-bg": cv("raised"),
    "--agent-outline-button-hover": cv("tint-2"),
    "--agent-radius-sm": cv("r-control"),
    "--agent-radius-md": cv("r-card"),
    "--agent-radius-lg": cv("r-group"),
    "--agent-radius-xl": cv("r-group"),
    "--agent-radius-pill": cv("r-pill"),
    "--agent-raised": cv("raised"),
    "--agent-row-active": cv("s3"),
    "--agent-row-hover": cv("tint-2"),
    "--agent-sans": cv("font-ui"),
    "--agent-shade": cv("side"),
    "--agent-shadow-raised": cv("shadow-card"),
    "--agent-space-1": cv("space-1"),
    "--agent-space-2": cv("space-2"),
    "--agent-space-3": cv("space-4"),
    "--agent-space-4": cv("space-5"),
    "--agent-space-5": cv("space-6"),
    "--agent-space-6": cv("space-7"),
    "--agent-space-7": cv("space-8"),
    "--agent-text": cv("fg"),
    "--agent-text-disabled": cv("fg-disabled"),
    "--agent-text-muted": cv("fg-muted"),
    "--agent-text-strong": cv("fg-strong"),
    "--agent-text-subtle": cv("fg-subtle"),
    "--agent-thread-column": cv("column"),
    "--agent-well": cv("tint-1"),
  }),
);

function closingParen(text, open) {
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === "(") depth += 1;
    if (text[index] !== ")") continue;
    depth -= 1;
    if (depth === 0) return index;
  }
  return -1;
}

export function rewriteLegacyVars(source, file, problems) {
  const pattern = /var\(\s*(--[A-Za-z0-9-]+)/g;
  let output = "";
  let cursor = 0;
  let replacements = 0;
  let match = pattern.exec(source);
  while (match !== null) {
    const name = match[1];
    const start = match.index;
    const replacement = LEGACY_TO_CV.get(name);
    const close = closingParen(source, start + 3);
    if (!isLegacyTokenName(name)) {
      match = pattern.exec(source);
      continue;
    }
    if (replacement === undefined || close < 0) {
      problems.push(`${file}: ${close < 0 ? "unbalanced var()" : "unmapped"} ${name}`);
      match = pattern.exec(source);
      continue;
    }
    output += source.slice(cursor, start) + replacement;
    cursor = close + 1;
    pattern.lastIndex = close + 1;
    replacements += 1;
    match = pattern.exec(source);
  }
  return { output: output + source.slice(cursor), replacements };
}

const [mode, ...files] = process.argv.slice(2);
if (mode !== "--check" && mode !== "--write") {
  console.error("usage: legacy-token-codemod.mjs --check|--write <file>...");
  process.exit(2);
}
const problems = [];
const results = files.map((file) => {
  const source = readFileSync(file, "utf8");
  return { file, source, ...rewriteLegacyVars(source, file, problems) };
});
for (const { file, replacements } of results) console.log(`${file}: ${replacements} replacements`);
if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  process.exit(1);
}
if (mode === "--write") {
  for (const { file, source, output } of results) {
    if (output !== source) writeFileSync(file, output);
  }
}
```

The script rewrites only `var()` references. A legacy `var()` is replaced as a whole, together with any fallback it carries: `var(--status-error, #ef4444)` becomes `var(--cv-danger)`. Legacy names inside the fallback of a non-legacy `var()` are still visited and rewritten. It deliberately leaves alone legacy declarations (`--color-x: ...`, which Task 8 deletes), TS string literals and test arrays that name tokens. The owning stream edits those by hand.

- [ ] **Step 3: Write the counting and lowering script**

`$HOME/tmp/codevo-p10/legacy-token-counts.mjs`:

```js
#!/usr/bin/env node
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { isLegacyTokenName } from "./legacy-predicate.mjs";

const ROOT = "/Users/matusmockor/Developer/editor/src";
const SELF = "ui/tokens/legacyTokenRatchet.test.ts";
const TOKEN = /(?<![\w-])--[a-z][a-z0-9-]*/g;

function files(directory, found = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files(path, found);
    else if (/\.(css|ts|tsx)$/.test(entry.name)) found.push(relative(ROOT, path).split(sep).join("/"));
  }
  return found;
}

const current = {};
for (const file of files(ROOT).sort()) {
  if (file === SELF) continue;
  const count = (readFileSync(join(ROOT, file), "utf8").match(TOKEN) ?? []).filter(isLegacyTokenName).length;
  if (count > 0) current[file] = count;
}

const lowerIndex = process.argv.indexOf("--lower");
if (lowerIndex < 0) {
  process.stdout.write(`${JSON.stringify(current, null, 2)}\n`);
  process.exit(0);
}
const baselinePath = process.argv[lowerIndex + 1];
const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
const grown = Object.entries(current).filter(([file, count]) => count > (baseline[file] ?? 0));
if (grown.length > 0) {
  for (const [file, count] of grown) console.error(`${file}: ${count} > ${baseline[file] ?? 0}`);
  process.exit(1);
}
const lowered = Object.fromEntries(
  Object.keys(baseline).sort().map((file) => [file, current[file] ?? 0]).filter(([, count]) => count > 0),
);
writeFileSync(baselinePath, `${JSON.stringify(lowered, null, 2)}\n`);
console.log(`total ${Object.values(lowered).reduce((sum, count) => sum + count, 0)} in ${Object.keys(lowered).length} files`);
```

- [ ] **Step 4: Dry-run across all of src and confirm the mapping is complete**

Run:

```bash
cd /Users/matusmockor/Developer/editor
node "$HOME/tmp/codevo-p10/legacy-token-codemod.mjs" --check $(grep -rlE --include='*.css' --include='*.ts' --include='*.tsx' -e 'var\(\s*--' src) > "$HOME/tmp/codevo-p10/dry-run.txt"; echo "exit=$?"
grep -c "replacements" "$HOME/tmp/codevo-p10/dry-run.txt"
node "$HOME/tmp/codevo-p10/legacy-token-codemod.mjs" --check src/components/agentMode/conversation/conversation.css | grep -c replacements
grep -n "fs-scale\|type-scale" "$HOME/tmp/codevo-p10/legacy-token-codemod.mjs"
```

Expected: `exit=0` with no `unmapped` lines. The `--codevo-fs-*` and `--agent-fs-*` mappings all contain `--cv-type-scale` (Review Focus 3). If a name is reported as `unmapped`, add it to `LEGACY_TO_CV` with the transitive target from `agentModeTokens.css` → `legacyBridge.css`, and rerun.

**Lead routine after accepting each stream (used by Tasks 4-7):**

```bash
node "$HOME/tmp/codevo-p10/legacy-token-counts.mjs" --lower src/ui/tokens/legacyTokenBaseline.json; echo "exit=$?"
npx vitest run src/ui/tokens/legacyTokenRatchet.test.ts; echo "exit=$?"
```

---

### Task 4: Stream A - inline-styled panels (debug-adjacent and workspace panels)

**Files (modify only these, plus the tests named):**
- `src/components/NodeLaunchConfigurationPicker.tsx`
- `src/components/NodeDebugAttachProcessPicker.tsx`
- `src/components/NodeDebugLaunchSelector.tsx`
- `src/components/NodeLaunchConfigurationsDialog.tsx`
- `src/components/FunctionBreakpoints.tsx` and `FunctionBreakpoints.test.tsx`
- `src/components/ExceptionTypeFilter.tsx`
- `src/components/TestResultsPanel.tsx`
- `src/components/JsTestOutputView.tsx`
- `src/components/JsTestExplorerPanel.tsx`
- `src/components/JsTestCoverageReport.tsx`
- `src/components/PackageDependenciesPanel.tsx`
- `src/components/NodePackageScriptsPanel.tsx`
- `src/components/ExpressRoutesPanel.tsx`
- `src/components/workbenchPanelViews.tsx`
- `src/components/VscodeProcessTasksPanel.tsx` and `VscodeProcessTasksPanel.test.tsx`
- `src/components/GitHistoryPanel.tsx`
- `src/components/SymfonyWorkspacePanel.tsx`
- `src/components/NetteWorkspacePanel.tsx`
- `src/components/NetteWorkspacePresentersPanel.tsx`
- `src/components/NetteWorkspaceRoutesPanel.tsx`
- `src/components/ArtisanRoutesPanel.tsx`
- `src/components/PhpTestResultsPanel.tsx`
- `src/components/PhpChangeSignatureDialog.css`
- `src/domain/terminalCommandDecoration.ts` and `terminalCommandDecoration.test.ts`

**Forbidden:** every other file, and above all `App.css`, the agentMode sheets and the ratchet baseline.

**Interfaces:**
- Consumes the Task 3 codemod and the Task 2 tokens.
- Produces files with zero legacy names.

- [ ] **Step 1: Write the failing test**

Add to `src/components/FunctionBreakpoints.test.tsx` (add `import { readFileSync } from "node:fs";` at the top):

```tsx
describe("function breakpoint styles", () => {
  it("use palette tokens only", () => {
    const source = readFileSync(new URL("./FunctionBreakpoints.tsx", import.meta.url), "utf8");

    expect(source).not.toMatch(/var\(--(?:color|text|border|status|background)-/);
    expect(source).toContain("var(--cv-danger)");
  });
});
```

Run: `npx vitest run src/components/FunctionBreakpoints.test.tsx; echo "exit=$?"`
Expected: FAIL, because the markup contains `var(--color-error)`.

- [ ] **Step 2: Apply the codemod to the owned files**

```bash
F="src/components/NodeLaunchConfigurationPicker.tsx src/components/NodeDebugAttachProcessPicker.tsx src/components/NodeDebugLaunchSelector.tsx src/components/NodeLaunchConfigurationsDialog.tsx src/components/FunctionBreakpoints.tsx src/components/FunctionBreakpoints.test.tsx src/components/ExceptionTypeFilter.tsx src/components/TestResultsPanel.tsx src/components/JsTestOutputView.tsx src/components/JsTestExplorerPanel.tsx src/components/JsTestCoverageReport.tsx src/components/PackageDependenciesPanel.tsx src/components/NodePackageScriptsPanel.tsx src/components/ExpressRoutesPanel.tsx src/components/workbenchPanelViews.tsx src/components/VscodeProcessTasksPanel.tsx src/components/VscodeProcessTasksPanel.test.tsx src/components/GitHistoryPanel.tsx src/components/SymfonyWorkspacePanel.tsx src/components/NetteWorkspacePanel.tsx src/components/NetteWorkspacePresentersPanel.tsx src/components/NetteWorkspaceRoutesPanel.tsx src/components/ArtisanRoutesPanel.tsx src/components/PhpTestResultsPanel.tsx src/components/PhpChangeSignatureDialog.css src/domain/terminalCommandDecoration.ts src/domain/terminalCommandDecoration.test.ts"
node "$HOME/tmp/codevo-p10/legacy-token-codemod.mjs" --write $F; echo "exit=$?"
node "$HOME/tmp/codevo-p10/legacy-token-counts.mjs" | grep -E "Picker|Launch|Breakpoints|ExceptionType|TestResults|JsTest|Package|Express|workbenchPanelViews|VscodeProcess|GitHistory|Symfony|Nette|Artisan|PhpTestResults|PhpChangeSignature|terminalCommandDecoration"; echo "grep-exit=$?"
```

Expected: codemod `exit=0`, and `grep-exit=1` (no owned file left in the counts). Fallback literals such as `rgba(127, 127, 127, 0.2)` and `#ef4444` disappear with the fallbacks, because every `--cv-*` target is declared at `:root`.

- [ ] **Step 3: Fix the expectations that name tokens**

Update the assertions in `FunctionBreakpoints.test.tsx`, `VscodeProcessTasksPanel.test.tsx` and `terminalCommandDecoration.test.ts` that still expect `var(--color-…)` strings. The codemod already rewrote their `var()` literals. Fix any remaining names by hand to the `LEGACY_TO_CV` targets (for example `var(--color-success)` → `var(--cv-ok)`).

- [ ] **Step 4: Run the owned tests and typecheck**

Run:

```bash
npx vitest run src/components/FunctionBreakpoints.test.tsx src/components/VscodeProcessTasksPanel.test.tsx src/domain/terminalCommandDecoration.test.ts src/components/TestResultsPanel.test.tsx src/components/NodeLaunchConfigurationPicker.test.tsx src/components/ExceptionTypeFilter.test.tsx; echo "exit=$?"
npm run check; echo "exit=$?"
npx prettier --check $F; echo "exit=$?"
```

Expected: all `exit=0`. A test file in this list that does not exist is not an error: Vitest reports "No test files found" only when none match. Remove missing paths from the command instead of creating tests.

- [ ] **Step 5: Hand back to the lead**

Report the file list and the zero counts. The lead runs the Task 3 lowering routine, reviews the diff and commits:

```bash
git add $F src/ui/tokens/legacyTokenBaseline.json
git commit -m "refactor(ui): move inline-styled panels to palette tokens"
```

---

### Task 5: Stream B - `App.css` references

**Files:**
- Modify: `src/App.css`. Rewrite all `var()` references. Do not delete the legacy declaration blocks at lines 17-712; Task 8 deletes them.

**Forbidden:** everything else.

- [ ] **Step 1: Write the failing test**

Create `src/appCssTokens.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseAllStyleSheets, varReferences } from "./components/cssContractTestSupport";

const LEGACY_REFERENCE = /^--(?:color-|change-(?:added|deleted|modified)|radius-|symbol-|vis-|codevo-)/;

describe("App.css rules", () => {
  it("reference palette tokens instead of legacy variables outside the token blocks", () => {
    const offenders = parseAllStyleSheets()
      .rules.filter((rule) => rule.sheet === "App.css")
      .flatMap((rule) =>
        rule.declarations
          .filter((declaration) => !declaration.property.startsWith("--"))
          .flatMap((declaration) =>
            varReferences(declaration.value)
              .filter((name) => LEGACY_REFERENCE.test(name))
              .map((name) => `${rule.selector} { ${declaration.property}: ${name} }`),
          ),
      );

    expect(offenders).toEqual([]);
  });
});
```

Run: `npx vitest run src/appCssTokens.test.ts; echo "exit=$?"`
Expected: FAIL with hundreds of offenders.

- [ ] **Step 2: Apply the codemod and hand-fix the four special cases**

```bash
node "$HOME/tmp/codevo-p10/legacy-token-codemod.mjs" --write src/App.css; echo "exit=$?"
grep -n "cv-s0) 45%\|cv-sym-badge-fg\|--cv-accent, var(--cv-accent)" src/App.css
```

Then check these four spots by hand:
- `App.css:~1970`: `color-mix(in srgb, var(--cv-s0) 45%, transparent)` inside a box-shadow. Replace the whole `box-shadow` value with `var(--cv-shadow-pop)`.
- `App.css:~3129`: `.symbol-icon` `color: var(--cv-sym-badge-fg)`. Keep it.
- `App.css:~4672` and `~4751`: the codemod already turned `var(--color-accent-bar, var(--color-accent))` into `var(--cv-accent)`. Confirm there is no leftover fallback.
- `.app-shell { color-scheme: dark; }` near line 770: delete that single line. The palette scheme now sets `color-scheme` through `:root` in `semantic.css` (Task 2), and `.app-shell` inherits it.

- [ ] **Step 3: Run the tests**

Run:

```bash
npx vitest run src/appCssTokens.test.ts src/components/cssTokenContract.test.ts src/components/cssBorderContract.test.ts src/startupDocument.test.ts; echo "exit=$?"
npx prettier --check src/App.css src/appCssTokens.test.ts; echo "exit=$?"
```

Expected: `appCssTokens.test.ts` PASS. `cssTokenContract.test.ts` may fail wherever it pins legacy `App.css` values. Record those failures in the hand-back report, do not edit that file (Task 8 owns it), and let the lead decide whether to fold the Task 5 commit into Task 8.

- [ ] **Step 4: Hand back to the lead** (the lowering routine, then `git commit -m "refactor(ui): point App.css rules at palette tokens"`).

---

### Task 6: Stream C - agentMode sheets, find bar and `data-tree`

**Files:**
- Modify every sheet under `src/components/agentMode/` except `agentModeTokens.css`:
  - `agentMode.css`, `agentThread.css`, `agentSurface.css`, `agentRail.css`, `agentHistory.css`, `agentImportedHistory.css`, `agentTerminalSessionsPalette.css`, `agentOutputArtifacts.css`, `agentUsage.css`, `agentQuestionCard.css`, `projectRepositoryPicker.css`, `projectMachinePicker.css`;
  - `remoteAddProject/remoteAddProject.css`, `remoteAddProject/remoteCloneDestination.css`;
  - `conversation/agentProse.css`, `conversation/conversation.css`, `conversation/agentWorkRows.css`, `conversation/agentTurnChangesRow.css`;
  - `composer/agentComposerFrame.css`.
- Tests: `agentThreadStyles.test.ts`, `AgentThreadsSidebar.test.tsx`, `AgentSurfacePanel.test.tsx`, `AgentSurfaceEmptyState.test.tsx`, `agentModeResponsiveStyles.test.ts`, `conversation/conversationStyles.test.ts`, `AgentThreadSession.minimap.test.tsx`, `agentShellFrame.test.ts`, `useAgentComposerAutosize.test.tsx`.
- `src/components/agentMode/AgentSurfacePanel.tsx`: remove `data-tree` (E3).

**Forbidden:** `agentModeTokens.css`, `agentModeTokens.test.ts`, `workbenchShellFrame.css`, `App.css`, any TSX other than `AgentSurfacePanel.tsx`.

- [ ] **Step 1: Write the failing tests**

Append to `src/components/agentMode/agentThreadStyles.test.ts` (it already imports the CSS helpers; add `parseAllStyleSheets` and `selectorParts` to the import if they are missing):

```ts
describe("inline find bar stays calm", () => {
  const rules = parseAllStyleSheets().rules.filter(
    (rule) => rule.sheet === "components/agentMode/agentMode.css",
  );

  it("does not lift with a heavier shadow or recolour its glyph on focus", () => {
    const focusRules = rules.filter((rule) =>
      selectorParts(rule.selector).some((part) => part.startsWith(".agent-find:focus-within")),
    );

    expect(focusRules.map((rule) => rule.selector)).toEqual([]);
  });

  it("keeps rail light-scheme overrides keyed on the palette scheme", () => {
    const classic = parseAllStyleSheets()
      .rules.filter((rule) => rule.sheet.startsWith("components/agentMode/"))
      .filter((rule) => rule.sheet !== "components/agentMode/agentModeTokens.css")
      .filter((rule) => rule.selector.includes("data-theme"))
      .map((rule) => `${rule.sheet} ${rule.selector}`);

    expect(classic).toEqual([]);
  });
});
```

In `src/components/agentMode/AgentSurfacePanel.test.tsx`, delete the six `getAttribute("data-tree")` assertions at lines 198, 212, 267, 273, 277 and 651. Keep the `[data-agent-surface-tree]` presence assertions next to them, which prove the same behavior. Then add, in the "fills the Files surface with the tree" test:

```tsx
    expect(aside?.hasAttribute("data-tree")).toBe(false);
```

Run: `npx vitest run src/components/agentMode/agentThreadStyles.test.ts src/components/agentMode/AgentSurfacePanel.test.tsx; echo "exit=$?"`
Expected: FAIL on the find-bar focus rules, the `data-theme` rules in `agentRail.css` and the present `data-tree` attribute.

- [ ] **Step 2: Codemod the owned sheets and tests**

```bash
C=$(ls src/components/agentMode/*.css src/components/agentMode/*/*.css | grep -v agentModeTokens.css)
T="src/components/agentMode/agentThreadStyles.test.ts src/components/agentMode/AgentThreadsSidebar.test.tsx src/components/agentMode/AgentSurfacePanel.test.tsx src/components/agentMode/AgentSurfaceEmptyState.test.tsx src/components/agentMode/agentModeResponsiveStyles.test.ts src/components/agentMode/conversation/conversationStyles.test.ts src/components/agentMode/AgentThreadSession.minimap.test.tsx src/components/agentMode/agentShellFrame.test.ts src/components/agentMode/useAgentComposerAutosize.test.tsx"
node "$HOME/tmp/codevo-p10/legacy-token-codemod.mjs" --write $C $T; echo "exit=$?"
```

- [ ] **Step 3: Hand edits**

1. `agentMode.css`: delete the `.agent-find:focus-within { box-shadow: … }` rule and the `.agent-find:focus-within .agent-find__glyph { color: … }` rule. The `.agent-find` base keeps `box-shadow: var(--cv-shadow-pop)`, which the codemod produced from `--codevo-shadow-float`.
2. `agentRail.css:592-640`: rewrite the four `.app-shell:is([data-theme="light"], [data-theme="catppuccinLatte"], [data-theme="oneLight"])` rules and the two `@media (prefers-color-scheme: light) .app-shell[data-theme="system"]` rules into two rules keyed on `:root[data-cv-scheme="light"]`, with the same `:is(...)` lists and declarations. Delete the `@media` wrappers. `data-cv-scheme` already resolves "system" at runtime.
3. `AgentSurfacePanel.tsx:165`: delete the `data-tree={treeShown ? "visible" : "hidden"}` line. Keep `treeShown`, because line 268 still uses it.
4. In the owned test files, replace every remaining token-name string (for example `"--agent-text-muted"` in arrays or `toBe("var(--agent-…)")`) with the `LEGACY_TO_CV` target. Delete assertions whose only purpose was to pin a legacy alias chain (for example "maps `--agent-x` to `--codevo-y`"); `agentModeTokens.test.ts` covers those chains and is deleted in Task 8.

- [ ] **Step 4: Run and verify**

```bash
npx vitest run src/components/agentMode; echo "exit=$?"
node "$HOME/tmp/codevo-p10/legacy-token-counts.mjs" | grep "components/agentMode/" | grep -v "agentModeTokens"; echo "grep-exit=$?"
npx prettier --check $C $T src/components/agentMode/AgentSurfacePanel.tsx; echo "exit=$?"
```

Expected: vitest `exit=0`, `grep-exit=1`, prettier `exit=0`.

- [ ] **Step 5: Hand back** (the lowering routine, then `git commit -m "refactor(agents): move agent surfaces to palette tokens and calm the find bar"`).

---

### Task 7: Stream D - remaining component sheets

**Files:**
- Sheets:
  - `src/components/ExternalFileConflict.css`, `DirtyCloseDecisionDialogHost.css`, `QuickInputDialogHost.css`, `terminalPanel.css`, `htmlEditorPreview.css`, `toastNotification.css`, `fileTypeGlyph.css`, `workbenchShellFrame.css`;
  - `src/components/remoteRunner/remoteRunnerTaskPanel.css`, `remoteSurfacePanels.css`, `remoteProjectCloneForm.css`, `remoteInstructionSource.css`, `remoteTerminalPanel.css`.
- Tests: `src/components/workbenchShellFrame.expanded.test.ts`, `terminalSession.test.ts`, `TerminalPanel.test.tsx`, `textEntryFocusContract.test.ts`, `monacoWidgetStyles.test.ts`, `monacoPaletteParity.test.ts`, `cssBorderContract.test.ts`, `AgentFrameFallback.test.tsx`, `src/domain/fileTypeGlyph.test.ts`, `src/startupDocument.test.ts`.

**Forbidden:** the layout `--agent-*` declarations in `workbenchShellFrame.css` (lines 23-67 and 234-242) must stay; they are layout variables. `cssContractTestSupport.ts` and `cssTokenContract.test.ts` belong to Task 8.

- [ ] **Step 1: Write the failing test**

Append to `src/components/workbenchShellFrame.expanded.test.ts`:

```ts
describe("dialog, toast and terminal chrome", () => {
  it("resolve only palette tokens so portaled surfaces never go transparent", () => {
    const sheets = new Set([
      "components/ExternalFileConflict.css",
      "components/DirtyCloseDecisionDialogHost.css",
      "components/QuickInputDialogHost.css",
      "components/terminalPanel.css",
      "components/toastNotification.css",
      "components/fileTypeGlyph.css",
    ]);
    const legacy = parseAllStyleSheets()
      .rules.filter((rule) => sheets.has(rule.sheet))
      .flatMap((rule) => rule.declarations.map((declaration) => `${rule.sheet} ${declaration.value}`))
      .filter((entry) => /var\(--(?:color|codevo|agent)-/.test(entry));

    expect(legacy).toEqual([]);
  });
});
```

(Import `parseAllStyleSheets` from `./cssContractTestSupport` if it is not already imported.)

Run: `npx vitest run src/components/workbenchShellFrame.expanded.test.ts; echo "exit=$?"`. Expected: FAIL.

- [ ] **Step 2: Codemod, then hand-fix the name strings in the tests**

```bash
D="src/components/ExternalFileConflict.css src/components/DirtyCloseDecisionDialogHost.css src/components/QuickInputDialogHost.css src/components/terminalPanel.css src/components/htmlEditorPreview.css src/components/toastNotification.css src/components/fileTypeGlyph.css src/components/workbenchShellFrame.css src/components/remoteRunner/remoteRunnerTaskPanel.css src/components/remoteRunner/remoteSurfacePanels.css src/components/remoteRunner/remoteProjectCloneForm.css src/components/remoteRunner/remoteInstructionSource.css src/components/remoteRunner/remoteTerminalPanel.css"
DT="src/components/workbenchShellFrame.expanded.test.ts src/components/terminalSession.test.ts src/components/TerminalPanel.test.tsx src/components/textEntryFocusContract.test.ts src/components/monacoWidgetStyles.test.ts src/components/monacoPaletteParity.test.ts src/components/cssBorderContract.test.ts src/components/AgentFrameFallback.test.tsx src/domain/fileTypeGlyph.test.ts src/startupDocument.test.ts"
node "$HOME/tmp/codevo-p10/legacy-token-codemod.mjs" --write $D $DT; echo "exit=$?"
```

In `agentHistory.css`, `--history-lane-1: var(--cv-ft-ts)` and its neighbours are component-local and already resolve through Task 2 tokens. That file belongs to Stream C.

- [ ] **Step 3: Run and verify**

```bash
npx vitest run src/components/workbenchShellFrame.expanded.test.ts src/components/terminalSession.test.ts src/components/TerminalPanel.test.tsx src/components/textEntryFocusContract.test.ts src/components/monacoWidgetStyles.test.ts src/components/monacoPaletteParity.test.ts src/components/cssBorderContract.test.ts src/components/AgentFrameFallback.test.tsx src/domain/fileTypeGlyph.test.ts src/startupDocument.test.ts; echo "exit=$?"
npx prettier --check $D $DT; echo "exit=$?"
```

Expected: `exit=0`. A test that asserts a legacy name exists (for example "toast tokens remap `--codevo-*`") is rewritten to assert the `--cv-*` target. It is never deleted without a replacement assertion.

- [ ] **Step 4: Hand back** (the lowering routine, then `git commit -m "refactor(ui): move dialogs, toasts, terminal and remote panels to palette tokens"`).

---

### Task 8: Remove the bridge, the agent token sheet and the classic theme blocks (lead)

**Precondition:** Tasks 4-7 accepted. `node "$HOME/tmp/codevo-p10/legacy-token-counts.mjs"` lists only declaration-bearing files and test files owned here: `App.css`, `agentModeTokens.css`, `agentModeTokens.test.ts`, `legacyBridge.css`, `legacyBridge.test.ts`, `cssTokenContract.test.ts`, `cssContractTestSupport.ts` and `domain/themeContrast.test.ts`. Any other file listed goes back to its stream.

**Files:**
- Delete: `src/ui/tokens/legacyBridge.css`, `src/ui/tokens/legacyBridge.test.ts`, `src/components/agentMode/agentModeTokens.css`, `src/components/agentMode/agentModeTokens.test.ts`
- Modify: `src/ui/tokens/tokens.css`, `src/App.css`, `src/components/workbenchShellFrame.css`, `src/components/cssContractTestSupport.ts`, `src/components/cssTokenContract.test.ts`, `src/domain/themeContrast.test.ts`, `src/ui/tokens/legacyTokenRatchet.test.ts`, `src/ui/tokens/legacyTokenBaseline.json`, `src/appCssTokens.test.ts` (fold into the ratchet and delete)

- [ ] **Step 1: Make the ratchet strict and add the resolution guards (failing)**

In `src/ui/tokens/legacyTokenRatchet.test.ts`:
- replace the whole `"never lets a file gain legacy token names"` test and the `baseline()`/`BASELINE` helpers with the block below;
- delete `src/ui/tokens/legacyTokenBaseline.json`;
- add `parseAllStyleSheets` to the import from `../../components/cssContractTestSupport`.

```ts
  it("contains no legacy CSS variable anywhere in src", () => {
    expect(legacyTokenCounts()).toEqual({});
  });

  it("never selects on the classic syntax theme attribute", () => {
    const classic = parseAllStyleSheets()
      .rules.filter((rule) => rule.selector.includes("data-theme"))
      .map((rule) => `${rule.sheet} ${rule.selector}`);

    expect(classic).toEqual([]);
  });

  it("declares every referenced palette token at the document root", () => {
    const declared = new Set(
      parseAllStyleSheets()
        .rules.filter((rule) => rule.sheet.startsWith("ui/tokens/"))
        .filter((rule) => rule.selector.split(",").some((part) => part.trim().startsWith(":root")))
        .flatMap((rule) => rule.declarations.map((declaration) => declaration.property)),
    );
    const referenced = new Set(
      sourceFiles(SRC_ROOT, 0, [])
        .filter((file) => file !== SELF)
        .flatMap((file) => [...readFileSync(join(SRC_ROOT, file), "utf8").matchAll(/var\(\s*(--cv-[a-z0-9-]+)/g)])
        .map((match) => match[1] ?? ""),
    );

    expect([...referenced].filter((name) => !declared.has(name)).sort()).toEqual([]);
  });
```

`--cv-shell-window-inset` is set on `.app-shell` in `App.css`, not in `ui/tokens`. If the resolution test reports it (or another intentionally shell-scoped `--cv-*` variable), rename it in the same step to a non-`--cv-` component-local name, for example `--shell-window-inset`, together with its references. The `--cv-` prefix is reserved for root tokens.

Run: `npx vitest run src/ui/tokens/legacyTokenRatchet.test.ts; echo "exit=$?"`. Expected: FAIL (legacy declarations remain and `data-theme` selectors exist).

- [ ] **Step 2: Move the layout variables out of `agentModeTokens.css`**

Copy the layout declarations from the `.workbench-frame` block of `agentModeTokens.css` into the existing `.workbench-frame` block in `src/components/workbenchShellFrame.css`, right after `--agent-rail-committed`:

```css
  --agent-row-pad: 8px 10px;
  --agent-surface-focus-gutter: 4px;
  --agent-rail-min-width: 208px;
  --agent-rail-row-inset: 10px;
  --agent-rail-gap: 8px;
  --agent-rail-row-py: 8px;
  --agent-rail-row-px: 30px;
  --agent-session-gutter: 24px;
  --agent-find-pill-top: 6px;
  --agent-find-pill-height: 34px;
  --agent-find-inset: 34px;
  --agent-minimap-rail: 40px;
  --agent-minimap-inset: 12px;
  --agent-minimap-persistent-gutter: 48px;
  --agent-turn-gap: 30px;
```

Move the trailing rule `.agent-mode, .agent-surface-host { font-family: … }` into `workbenchShellFrame.css` as `font-family: var(--cv-font-ui);`.

- [ ] **Step 3: Delete the legacy sheets and imports**

- `src/ui/tokens/tokens.css`: delete the line `@import "./legacyBridge.css";`.
- `src/App.css`: delete the line `@import "./components/agentMode/agentModeTokens.css";`.
- Delete the four files with `git rm`. This is a lead operation:

```bash
git rm src/ui/tokens/legacyBridge.css src/ui/tokens/legacyBridge.test.ts src/components/agentMode/agentModeTokens.css src/components/agentMode/agentModeTokens.test.ts src/appCssTokens.test.ts
```

- [ ] **Step 4: Replace the `App.css` token blocks**

Delete everything from the first `:root {` block (currently line 17) through the closing `}` of the `@media (prefers-color-scheme: light) { .app-shell[data-theme="system"] { … } }` block that ends right before `* {` (currently line ~712). That covers:
- `:root`;
- the 9 classic `.app-shell[data-theme=…]` blocks;
- the alias-tier block;
- the system-light media block.

Put this block in its place:

```css
:root {
  color: var(--cv-fg);
  background: var(--cv-canvas);
  font-family: var(--cv-font-ui);
  font-size: 14px;
  font-synthesis: none;
  line-height: 1.4;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
```

Then run `grep -n "data-theme" src/App.css`. Expected: no output. If a component rule outside the deleted range still uses `data-theme`, rewrite it to `:root[data-cv-scheme="light"] …` or `…="dark"`. Keep the `data-theme` attribute in `App.tsx:883`: `startupAppearanceHandoff.test.tsx` observes it, and no CSS consumes it any more.

- [ ] **Step 5: Retarget the CSS contract tests**

- `src/components/cssContractTestSupport.ts`:
  - `TOKEN_SHEETS` becomes `["ui/tokens/semantic.css", "ui/tokens/palettes.css", "components/settings/settings.css", "components/toastNotification.css"]`;
  - delete `LIGHT_THEME_SELECTORS`, `SYSTEM_LIGHT_CONTEXT` and `SYSTEM_THEME_SELECTOR`, and fix their importers;
  - in `REMAP_PREFIXES` and the `SHADOW_TOKEN_ROOTS` list, replace every `--codevo-*` name with its `LEGACY_TO_CV` target. Drop `--agent-` from `REMAP_PREFIXES`.
- `src/components/cssTokenContract.test.ts`:
  - delete the suites that pin `APP_THEME_SELECTORS`, `CODEVO_LADDER` and the `agentModeTokens.css` remaps;
  - keep and retarget the suites that assert behavior. Examples: "no colour literals outside token sheets", "focus-visible uses the focus ring", "shadows come from allowed roots". Rewrite them against `--cv-*`;
  - end with zero legacy names.
- `src/domain/themeContrast.test.ts`:
  - keep `describe("contrastRatio")` and `describe("Monaco popup chrome")`;
  - delete `describe("calm design tokens")`, which reads the classic theme blocks. The symbol-badge readability it covered now lives in `replacementTokens.test.ts` (Task 2), and AA text pairs live in `tokenContrast.test.ts`.

- [ ] **Step 6: Run the token, contract and full CSS suites**

```bash
npx vitest run src/ui src/components/cssTokenContract.test.ts src/components/cssBorderContract.test.ts src/domain/themeContrast.test.ts src/startupDocument.test.ts src/startupAppearanceHandoff.test.tsx; echo "exit=$?"
npm run check; echo "exit=$?"
wc -l src/App.css
```

Expected: `exit=0` for both, with `App.css` about 700 lines shorter (about 4,870).

- [ ] **Step 7: Commit**

```bash
npx prettier --check src/App.css src/ui/tokens/tokens.css src/components/workbenchShellFrame.css src/components/cssContractTestSupport.ts src/components/cssTokenContract.test.ts src/domain/themeContrast.test.ts src/ui/tokens/legacyTokenRatchet.test.ts
git add -A src/App.css src/ui/tokens src/components/workbenchShellFrame.css src/components/cssContractTestSupport.ts src/components/cssTokenContract.test.ts src/domain/themeContrast.test.ts
git status --short
git commit -m "refactor(tokens): remove the legacy token bridge and classic theme blocks"
```

(`git status --short` must show nothing staged outside the listed paths. The deletions are already staged by `git rm`.)

---

### Task 9: Dead styles and a dead-class guard

**Files:**
- Create: `src/ui/tokens/deadStyleGuard.test.ts`
- Modify: the sheets that hold the dead rules (see "Measured state"), plus the `agent-row--slim` selectors in `agentRail.css` once Task 17 has landed.

- [ ] **Step 1: Write the failing guard**

```ts
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SRC_ROOT, parseAllStyleSheets } from "../../components/cssContractTestSupport";

const VENDOR_CLASS = /^(?:monaco-|codicon|xterm-|mtk\d)/;
const VENDOR_CLASSES: ReadonlySet<string> = new Set([
  "cldr",
  "margin-view-overlays",
  "lightBulbWidget",
  "action-widget",
  "context-view",
  "suggest-details",
  "hover-row",
  "action-container",
]);
const DYNAMIC_CLASSES: ReadonlySet<string> = new Set(["xxx", "fixme", "hack", "todo", "note"]);
const MAX_DEPTH = 12;

function productionSource(directory: string, depth: number, parts: string[]): string[] {
  expect(depth).toBeLessThanOrEqual(MAX_DEPTH);
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) productionSource(path, depth + 1, parts);
    else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.includes(".test.")) {
      parts.push(readFileSync(path, "utf8"));
    }
  }
  return parts;
}

describe("stylesheets", () => {
  it("style only classes that production code can render", () => {
    const source = productionSource(SRC_ROOT, 0, []).join("\n");
    const tokens = new Set(source.match(/[A-Za-z_][\w-]*/g) ?? []);
    const dynamicPrefixes = [...source.matchAll(/([A-Za-z][\w-]*-)\$\{/g)].map((match) => match[1] ?? "");
    const dead = new Set<string>();
    for (const rule of parseAllStyleSheets().rules) {
      for (const [, name] of rule.selector.matchAll(/\.([A-Za-z_][\w-]*)/g)) {
        if (name === undefined || tokens.has(name) || VENDOR_CLASSES.has(name)) continue;
        if (VENDOR_CLASS.test(name) || DYNAMIC_CLASSES.has(name)) continue;
        if (dynamicPrefixes.some((prefix) => prefix.length > 0 && name.startsWith(prefix))) continue;
        dead.add(`${rule.sheet} .${name}`);
      }
    }

    expect([...dead].sort()).toEqual([]);
  });
});
```

`DYNAMIC_CLASSES` lists the `todo-tag` modifiers that `TodoPanel.tsx:145` produces from the tag text. Check the list against `TodoPanel`'s tag set and add any missing tag before relying on the guard.

Run: `npx vitest run src/ui/tokens/deadStyleGuard.test.ts; echo "exit=$?"`. Expected: FAIL, listing roughly the ~60 classes from "Measured state".

- [ ] **Step 2: Triage the list**

Before deleting any entry, check it with `grep -rn "<class>" src --include='*.tsx' --include='*.ts'`:
- **Monaco or xterm DOM class.** Add it to `VENDOR_CLASSES`, with the vendor noted in the commit message.
- **Built dynamically.** Add a `DYNAMIC_CLASSES` entry and name the producing file in the commit message.
- **Otherwise dead.** Delete the rule. If the selector is a list, delete only the dead part.

- [ ] **Step 3: Rerun until green, then run the agentMode and settings suites**

```bash
npx vitest run src/ui/tokens/deadStyleGuard.test.ts src/components/agentMode src/components/settings; echo "exit=$?"
```

Expected: `exit=0`.

- [ ] **Step 4: Commit** `git commit -m "chore(ui): remove dead styles and guard against new ones"` (stage only the guard and the edited sheets).

---

### Task 10: Dead modules

**Files:** the candidates listed in "Measured state", their tests, and `scripts/hotspot-size-baseline.json` through `--update`.

- [ ] **Step 1: Verify each candidate**

For each `<Name>`:

```bash
grep -rnE "from ['\"][^'\"]*/<Name>['\"]|import\(['\"][^'\"]*/<Name>['\"]" src --include='*.ts' --include='*.tsx' | grep -v "\.test\."
```

Delete the module only when this prints nothing, or only its own test files. For `GitChangesPanel.tsx`, also delete sub-components that nothing else imports, verified the same way. The E4 capability decision stays with the owner, and git history keeps the file.

- [ ] **Step 2: Delete with `git rm` (lead) and run typecheck, lint and the related suites**

```bash
git rm <verified files and their tests>
npm run check; echo "exit=$?"
npm run lint -- --max-warnings 0; echo "exit=$?"
npx vitest run src/components src/application --reporter=dot; echo "exit=$?"
node scripts/check-hotspot-size-budget.mjs --update; echo "exit=$?"
npm run size:hotspots; echo "exit=$?"
```

Expected: all `exit=0`. `--update` only lowers entries.

- [ ] **Step 3: Commit** `git commit -m "chore: remove modules left unreachable by the redesign"`.

---

### Task 11: Editor header items show only readouts that exist (E1)

**Files:** `src/domain/settings.ts` (`StatusBarItemVisibility`, `defaultStatusBarItemVisibility`, `normalizeStatusBarItemVisibility`), `src/domain/settings.test.ts`, `src/components/settings/pages/GeneralStatusBarRows.tsx`, `src/components/settings/pages/GeneralSettingsPage.test.tsx`, `src/infrastructure/browserSettingsGateway.test.ts`.

**Interfaces:** `StatusBarItemVisibility` becomes `{ agentAttention; cursorPosition; index; languageServer }`, all `boolean`. The consumers (`useEditorChromeValue.ts:96,158` and `AgentWorkbenchScreen.tsx:571`) already use only these keys.

- [ ] **Step 1: Write the failing tests**

In `src/domain/settings.test.ts`:

```ts
  it("keeps only the editor header readouts that still exist when reading old settings", () => {
    expect(
      normalizeStatusBarItemVisibility({
        activePath: false,
        gitBranch: false,
        cursorPosition: false,
        message: true,
        index: false,
      }),
    ).toEqual({ agentAttention: true, cursorPosition: false, index: false, languageServer: true });
  });
```

In `GeneralSettingsPage.test.tsx`, replace the test "offers cursor position and git branch status bar chips" with:

```tsx
  it("offers only the header readouts the editor renders", async () => {
    const onSave = await render({});
    const labels = [
      ...rowElement("general.statusBar").querySelectorAll<HTMLButtonElement>(".settings-chip"),
    ].map((candidate) => candidate.textContent);

    expect(labels).toEqual(["Index", "IDE engine", "Cursor position"]);

    act(() => chip("Cursor position").click());

    expect(onSave).toHaveBeenLastCalledWith({
      appSettings: defaultAppSettings(),
      trusted: true,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        statusBar: { ...defaultWorkspaceSettings().statusBar, cursorPosition: false },
      },
    });
  });
```

Also update `GeneralSettingsPage.test.tsx:481` (`message: false`) to use `index: false` instead.

Run: `npx vitest run src/domain/settings.test.ts src/components/settings/pages/GeneralSettingsPage.test.tsx; echo "exit=$?"`. Expected: FAIL.

- [ ] **Step 2: Implement**

`src/domain/settings.ts`:

```ts
export interface StatusBarItemVisibility {
  agentAttention: boolean;
  cursorPosition: boolean;
  index: boolean;
  languageServer: boolean;
}
```

```ts
export function defaultStatusBarItemVisibility(): StatusBarItemVisibility {
  return { agentAttention: true, cursorPosition: true, index: true, languageServer: true };
}
```

```ts
export function normalizeStatusBarItemVisibility(value: unknown): StatusBarItemVisibility {
  const defaults = defaultStatusBarItemVisibility();

  if (!isRecord(value)) {
    return defaults;
  }

  return {
    agentAttention: normalizeBoolean(value.agentAttention, defaults.agentAttention),
    cursorPosition: normalizeBoolean(value.cursorPosition, defaults.cursorPosition),
    index: normalizeBoolean(value.index, defaults.index),
    languageServer: normalizeBoolean(value.languageServer, defaults.languageServer),
  };
}
```

In `GeneralStatusBarRows.tsx`, set `STATUS_BAR_CHIPS` to:

```ts
const STATUS_BAR_CHIPS: ReadonlyArray<{
  readonly value: keyof StatusBarItemVisibility;
  readonly label: string;
}> = [
  { value: "index", label: "Index" },
  { value: "languageServer", label: "IDE engine" },
  { value: "cursorPosition", label: "Cursor position" },
];
```

Then fix every fixture that `npm run check` reports (for example `browserSettingsGateway.test.ts`) by removing the retired keys.

- [ ] **Step 3: Verify and commit**

```bash
npx vitest run src/domain/settings.test.ts src/components/settings src/infrastructure/browserSettingsGateway.test.ts; echo "exit=$?"
npm run check; echo "exit=$?"
git add src/domain/settings.ts src/domain/settings.test.ts src/components/settings/pages/GeneralStatusBarRows.tsx src/components/settings/pages/GeneralSettingsPage.test.tsx src/infrastructure/browserSettingsGateway.test.ts
git commit -m "fix(settings): list only editor header readouts that exist"
```

---

### Task 12: Truthful success for integrate and remove-worktree (G1)

**Files:** `src/application/useAgentShipFlow.ts` (`integrate` about lines 555-600, `removeWorktree` about lines 605-680), `src/application/useAgentShipFlow.test.tsx`.

**Policy (same as commit/push):**
- A side effect that completed while the owner changed settles through `settledWithoutOwner`. It clears the ship state, returns success, persists no receipt, calls no `onShipStepCompleted`/`onWorktreeRemoved` and shows no notice.
- A side effect that failed or was refused while the owner changed reports `authorityLost`.

- [ ] **Step 1: Write the failing tests**

Replace the test "discards an integration result after the owner changed" (line ~813) with:

```tsx
  it("settles a completed integration without publishing when the owner changed", async () => {
    const integrated = deferred<GitIntegrationOutcome>();
    const harness = renderFlow();
    harness.gitIntegrationGateway.integrateWorktreeBranch.mockReturnValueOnce(integrated.promise);

    const pending = harness.hook().integrate(THREAD_ID, "fastForward");
    await waitForReact(() =>
      expect(harness.gitIntegrationGateway.integrateWorktreeBranch).toHaveBeenCalledTimes(1),
    );
    harness.set({ projects: [project({ ownerId: "agent-root:other" })] });
    await act(async () => {
      integrated.resolve({ kind: "integrated", mergeSha: SHA_M, intoBranch: "main" });
      await pending;
    });

    expect(harness.state()).toBeUndefined();
    expect(receipts(harness.actions)).toEqual([]);
    expect(harness.onShipStepCompleted).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("still reports authority loss when an integration was refused after the owner changed", async () => {
    const integrated = deferred<GitIntegrationOutcome>();
    const harness = renderFlow();
    harness.gitIntegrationGateway.integrateWorktreeBranch.mockReturnValueOnce(integrated.promise);

    const pending = harness.hook().integrate(THREAD_ID, "fastForward");
    await waitForReact(() =>
      expect(harness.gitIntegrationGateway.integrateWorktreeBranch).toHaveBeenCalledTimes(1),
    );
    harness.set({ projects: [project({ generation: 2 })] });
    await act(async () => {
      integrated.resolve({ kind: "notFastForward" });
      await pending;
    });

    expect(harness.state()).toMatchObject({
      kind: "failed",
      failure: { step: "integrate", reason: "authorityLost" },
    });
    harness.unmount();
  });

  it("settles a completed worktree removal without publishing when the owner changed", async () => {
    const removed = deferred<undefined>();
    const harness = renderFlow();
    harness.gitWorktreeGateway.removeWorktree.mockReturnValueOnce(removed.promise);

    const pending = harness.hook().removeWorktree(THREAD_ID, { deleteBranch: false });
    await waitForReact(() =>
      expect(harness.gitWorktreeGateway.removeWorktree).toHaveBeenCalledTimes(1),
    );
    harness.set({ projects: [project({ generation: 2 })] });
    await act(async () => {
      removed.resolve(undefined);
      await pending;
    });

    expect(harness.state()).toBeUndefined();
    expect(harness.onWorktreeRemoved).not.toHaveBeenCalled();
    expect(receipts(harness.actions)).toEqual([]);
    harness.unmount();
  });

  it("settles a deleted branch without publishing when the owner changed during deletion", async () => {
    const deleted = deferred<undefined>();
    const harness = renderFlow();
    harness.gitGateway.deleteBranch.mockReturnValueOnce(deleted.promise);

    const pending = harness.hook().removeWorktree(THREAD_ID, { deleteBranch: true });
    await waitForReact(() => expect(harness.gitGateway.deleteBranch).toHaveBeenCalledTimes(1));
    harness.set({ projects: [project({ ownerId: "agent-root:other" })] });
    await act(async () => {
      deleted.resolve(undefined);
      await pending;
    });

    expect(harness.state()).toBeUndefined();
    expect(receipts(harness.actions)).toEqual([]);
    harness.unmount();
  });
```

If the harness's `deleteBranch`/`removeWorktree` mocks are typed with a different resolved type, match `deferred<…>` to it. `vi.fn(async () => undefined)` resolves `undefined`.

Run: `npx vitest run src/application/useAgentShipFlow.test.tsx; echo "exit=$?"`. Expected: FAIL. The first, third and fourth tests get `authorityLost` instead.

- [ ] **Step 2: Implement**

In `integrate`, replace

```ts
        if (!owns(target)) return authorityLost(threadId, "integrate");
        if (outcome.kind !== "integrated") {
```

with

```ts
        if (!owns(target)) {
          if (outcome.kind === "integrated") return settledWithoutOwner(threadId);
          return authorityLost(threadId, "integrate");
        }
        if (outcome.kind !== "integrated") {
```

and, after `const refreshed = await attempt(() => loadStatus(target));`, replace `if (!owns(target)) return authorityLost(threadId, "integrate");` with `if (!owns(target)) return settledWithoutOwner(threadId);`.

In `removeWorktree`, after the `removeWorktree(...)` await, replace `if (!owns(target)) return authorityLost(threadId, "removeWorktree");` with `if (!owns(target)) return settledWithoutOwner(threadId);`. After the `deleteBranch` attempt, replace the owner check with:

```ts
        if (!owns(target)) {
          if (deleted.ok) return settledWithoutOwner(threadId);
          return authorityLost(threadId, "removeWorktree");
        }
```

Add `settledWithoutOwner` to both `useCallback` dependency arrays.

- [ ] **Step 3: Verify and commit**

```bash
npx vitest run src/application/useAgentShipFlow.test.tsx; echo "exit=$?"
npm run lint:exhaustive-deps; echo "exit=$?"
git add src/application/useAgentShipFlow.ts src/application/useAgentShipFlow.test.tsx
git commit -m "fix(git): report completed integrate and worktree removal truthfully after owner change"
```

---

### Task 13: Bounded revoked trust roots (CL4)

**Files:** Create `src-tauri/src/trust/revoked_roots.rs`. Modify `src-tauri/src/trust.rs` (field type, `load`, `set_canonical`, `grant_opened_canonical_root`, `save`, tests).

**Interfaces:** `RevokedRoots::{from_persisted, contains, insert -> RevokedInsertion, remove -> Option<usize>, restore(root, position), undo_insert(root, insertion), persisted -> Vec<String>}` and `MAX_REVOKED_ROOTS = 256`. Eviction is FIFO by insertion order and deterministic. An evicted root is forgotten: a later explicit Open Folder may trust it again, like any new folder. Persistence switches from sorted to insertion order. Old sorted files load in their stored order.

- [ ] **Step 1: Write the failing tests** (append inside `mod tests` in `trust.rs`, and add `use super::revoked_roots::MAX_REVOKED_ROOTS;`)

```rust
    #[test]
    fn revoked_roots_keep_only_the_newest_entries_in_insertion_order() {
        let root = create_temp_dir("trust-revoked-cap");
        let storage = root.join("trust.json");
        let mut service = WorkspaceTrustService::load(storage.clone()).unwrap();
        for index in 0..(MAX_REVOKED_ROOTS + 3) {
            service
                .revoke_canonical_root(&format!("/revoked/{index:04}"))
                .unwrap();
        }
        drop(service);

        let persisted: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&storage).unwrap()).unwrap();
        let revoked = persisted["revokedRoots"].as_array().unwrap();
        assert_eq!(revoked.len(), MAX_REVOKED_ROOTS);
        assert_eq!(revoked[0], "/revoked/0003");
        assert_eq!(
            revoked[MAX_REVOKED_ROOTS - 1],
            format!("/revoked/{:04}", MAX_REVOKED_ROOTS + 2)
        );

        let mut reloaded = WorkspaceTrustService::load(storage).unwrap();
        assert!(reloaded.grant_opened_canonical_root("/revoked/0000").unwrap().trusted);
        let refusal = reloaded
            .grant_opened_canonical_root("/revoked/0003")
            .unwrap_err();
        assert_eq!(refusal.kind(), std::io::ErrorKind::PermissionDenied);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_failed_save_restores_the_evicted_revoked_root() {
        let root = create_temp_dir("trust-revoked-rollback");
        let storage = root.join("trust.json");
        let mut service = WorkspaceTrustService::load(storage.clone()).unwrap();
        for index in 0..MAX_REVOKED_ROOTS {
            service
                .revoke_canonical_root(&format!("/revoked/{index:04}"))
                .unwrap();
        }
        fs::remove_file(&storage).unwrap();
        fs::create_dir(&storage).unwrap();

        assert!(service.revoke_canonical_root("/revoked/new").is_err());
        let still_revoked = service
            .grant_opened_canonical_root("/revoked/0000")
            .unwrap_err();
        assert_eq!(still_revoked.kind(), std::io::ErrorKind::PermissionDenied);
        let not_revoked = service
            .grant_opened_canonical_root("/revoked/new")
            .unwrap_err();
        assert_ne!(not_revoked.kind(), std::io::ErrorKind::PermissionDenied);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn an_oversized_persisted_list_loads_its_newest_entries() {
        let root = create_temp_dir("trust-revoked-load");
        let storage = root.join("trust.json");
        let revoked: Vec<String> = (0..(MAX_REVOKED_ROOTS + 10))
            .map(|index| format!("/old/{index:04}"))
            .collect();
        fs::write(
            &storage,
            serde_json::json!({ "trustedRoots": [], "revokedRoots": revoked }).to_string(),
        )
        .unwrap();

        let mut service = WorkspaceTrustService::load(storage).unwrap();
        assert!(service.grant_opened_canonical_root("/old/0009").unwrap().trusted);
        assert!(service.grant_opened_canonical_root("/old/0010").is_err());
        fs::remove_dir_all(root).unwrap();
    }
```

In the last test, `grant_opened_canonical_root("/old/0009")` persists a trusted grant; the save goes to a regular file and succeeds.

Run: `cd src-tauri && cargo test --lib trust::tests; echo "exit=$?"`. Expected: FAIL. `MAX_REVOKED_ROOTS` is not defined, and after defining it the cap is not enforced.

- [ ] **Step 2: Implement `src-tauri/src/trust/revoked_roots.rs`**

```rust
use std::collections::{HashSet, VecDeque};

pub(crate) const MAX_REVOKED_ROOTS: usize = 256;

#[derive(Default)]
pub(crate) struct RevokedRoots {
    order: VecDeque<String>,
    members: HashSet<String>,
}

pub(crate) struct RevokedInsertion {
    inserted: bool,
    evicted: Option<String>,
}

impl RevokedInsertion {
    pub(crate) fn inserted(&self) -> bool {
        self.inserted
    }
}

impl RevokedRoots {
    pub(crate) fn from_persisted(roots: Vec<String>) -> Self {
        let mut revoked = Self::default();
        for root in roots {
            revoked.remove(&root);
            revoked.insert(root);
        }
        revoked
    }

    pub(crate) fn contains(&self, root: &str) -> bool {
        self.members.contains(root)
    }

    pub(crate) fn insert(&mut self, root: String) -> RevokedInsertion {
        if self.members.contains(&root) {
            return RevokedInsertion { inserted: false, evicted: None };
        }
        self.members.insert(root.clone());
        self.order.push_back(root);
        if self.order.len() <= MAX_REVOKED_ROOTS {
            return RevokedInsertion { inserted: true, evicted: None };
        }
        let evicted = self.order.pop_front();
        if let Some(evicted) = &evicted {
            self.members.remove(evicted);
        }
        RevokedInsertion { inserted: true, evicted }
    }

    pub(crate) fn remove(&mut self, root: &str) -> Option<usize> {
        if !self.members.remove(root) {
            return None;
        }
        let position = self.order.iter().position(|entry| entry == root)?;
        self.order.remove(position);
        Some(position)
    }

    pub(crate) fn restore(&mut self, root: String, position: usize) {
        if !self.members.insert(root.clone()) {
            return;
        }
        let position = position.min(self.order.len());
        self.order.insert(position, root);
    }

    pub(crate) fn undo_insert(&mut self, root: &str, insertion: RevokedInsertion) {
        if insertion.inserted {
            self.remove(root);
        }
        let Some(evicted) = insertion.evicted else {
            return;
        };
        self.members.insert(evicted.clone());
        self.order.push_front(evicted);
    }

    pub(crate) fn persisted(&self) -> Vec<String> {
        self.order.iter().cloned().collect()
    }
}
```

- [ ] **Step 3: Wire it into `trust.rs`**

- Add `mod revoked_roots;` and `use revoked_roots::RevokedRoots;`.
- Change the field `revoked_roots: HashSet<String>` to `revoked_roots: RevokedRoots`.
- `load`: `RevokedRoots::default()` for a missing file, and `RevokedRoots::from_persisted(persisted.revoked_roots)` otherwise.
- `set_canonical` trusted branch: `let was_revoked = self.revoked_roots.remove(&normalized_path);`. On save error: `if let Some(position) = was_revoked { self.revoked_roots.restore(normalized_path.clone(), position); }`.
- `set_canonical` revoke branch: `let insertion = self.revoked_roots.insert(normalized_path.clone());`. On save error: `self.revoked_roots.undo_insert(&normalized_path, insertion);`. The existing `newly_revoked` checks become `insertion.inserted()`, used only where the old code read the flag.
- `grant_opened_canonical_root`: `self.revoked_roots.contains(root)` stays as is.
- `save`: `let revoked_roots = self.revoked_roots.persisted();`. Do not sort it.

- [ ] **Step 4: Verify and commit**

```bash
cd src-tauri
cargo test --lib trust; echo "exit=$?"
cargo test --lib workspace_opened_project_trust; echo "exit=$?"
cargo fmt --all -- --check; echo "exit=$?"
cargo clippy --all-targets -- -D warnings; echo "exit=$?"
cd ..
git add src-tauri/src/trust.rs src-tauri/src/trust/revoked_roots.rs
git commit -m "fix(trust): bound persisted revoked roots with deterministic eviction"
```

---

### Task 14: Clone failure classifier ignores server chatter (CL1)

**Files:** `src-tauri/src/local_clone/failure.rs`, `src-tauri/src/local_clone/progress_tests.rs`.

- [ ] **Step 1: Write the failing cases.** Add to the `cases` array in the classifier test in `progress_tests.rs`, before `(&["error: something unexpected"], …)`:

```rust
        (
            &[
                "remote: ssl is deprecated on this mirror",
                "fatal: couldn't find remote ref refs/heads/nope",
            ],
            CloneFailure::Other,
        ),
        (
            &[
                "remote: permission denied (publickey) is logged for bots",
                "fatal: the remote end hung up unexpectedly",
            ],
            CloneFailure::Network,
        ),
        (
            &["fatal: unable to access 'https://example.com/a.git/': ssl certificate problem: self-signed certificate"],
            CloneFailure::Network,
        ),
        (
            &[
                "remote: http basic: access denied",
                "fatal: authentication failed for 'https://gitlab.com/a/b.git/'",
            ],
            CloneFailure::Authentication,
        ),
        (&["remote: repository not found."], CloneFailure::NotFound),
```

Run: `cd src-tauri && cargo test --lib local_clone; echo "exit=$?"`. Expected: FAIL. The first case classifies as `Network` because of `ssl`, and the second as `Authentication`.

- [ ] **Step 2: Implement.** In `failure.rs`:
  1. Replace the `"ssl",` needle with `"ssl certificate problem", "ssl_connect", "ssl_error", "ssl routines", "tls handshake", "gnutls_handshake", "schannel",`. Change the array type annotation to `[(CloneFailure, &[&str]); 5]`, which is unchanged apart from the needle list.
  2. Add:

```rust
const KNOWN_REMOTE_HOST_MESSAGES: [&str; 4] = [
    "remote: repository not found",
    "remote: invalid username or password",
    "remote: http basic: access denied",
    "remote: the project you were looking for could not be found",
];

fn classifiable(line: &str) -> bool {
    if !line.starts_with("remote:") {
        return true;
    }
    KNOWN_REMOTE_HOST_MESSAGES
        .iter()
        .any(|message| line.starts_with(message))
}
```

  3. In `classify_failure`, change `.any(|line| needles.iter().any(|needle| line.contains(needle)))` to `.any(|line| classifiable(line) && needles.iter().any(|needle| line.contains(needle)))`.

- [ ] **Step 3: Verify and commit**

```bash
cd src-tauri && cargo test --lib local_clone; echo "exit=$?"; cargo fmt --all -- --check; echo "exit=$?"; cd ..
git add src-tauri/src/local_clone/failure.rs src-tauri/src/local_clone/progress_tests.rs
git commit -m "fix(clone): classify failures from git's own lines, not server chatter"
```

---

### Task 15: Terminal output keeps multibyte characters split across reads (T1)

**Files:**
- Create: `src-tauri/src/incremental_utf8.rs` (moved `IncrementalUtf8Decoder`)
- Modify: `src-tauri/src/node_package_tagged_utf8.rs` (use the shared decoder), `src-tauri/src/terminal_module_registration.rs` (add `mod incremental_utf8;`), `src-tauri/src/terminal_session_events.rs` (decoder in the reader loop, plus tests)

- [ ] **Step 1: Confirm the path first.** Run `grep -n "from_utf8_lossy" src-tauri/src/terminal_session_events.rs`. Expected: line 67, inside `spawn_terminal_reader`, which `terminal_session/start.rs:138` uses for every interactive PTY session, including scripts run in a terminal. If the Scripts surface turns out to run through a different reader, apply Step 3 there as well and name it in the commit.

- [ ] **Step 2: Write the failing test** (append to `terminal_session_events.rs`):

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::terminal::{TerminalOutputEvent, TerminalRuntimeStatus};
    use std::{collections::VecDeque, io, sync::Mutex};

    struct ChunkedReader(VecDeque<Vec<u8>>);

    impl Read for ChunkedReader {
        fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
            let Some(chunk) = self.0.pop_front() else {
                return Ok(0);
            };
            buffer[..chunk.len()].copy_from_slice(&chunk);
            Ok(chunk.len())
        }
    }

    #[derive(Default)]
    struct RecordingSink(Mutex<String>);

    impl TerminalEventSink for RecordingSink {
        fn emit_output(&self, event: TerminalOutputEvent) {
            self.0.lock().unwrap().push_str(&event.data);
        }

        fn emit_status(&self, _status: TerminalRuntimeStatus) {}
    }

    #[test]
    fn multibyte_text_split_at_every_boundary_is_emitted_losslessly() {
        let text = "ASCII žltý kôň 🦀 koniec";
        for split in 0..=text.len() {
            let bytes = text.as_bytes();
            let chunks = [bytes[..split].to_vec(), bytes[split..].to_vec()]
                .into_iter()
                .filter(|chunk| !chunk.is_empty())
                .collect::<VecDeque<_>>();
            let reader = ChunkedReader(chunks);
            let sink = Arc::new(RecordingSink::default());
            let gate = Arc::new(TerminalStartGate::new());
            gate.release();
            let handle = spawn_terminal_reader(
                Box::new(reader),
                Arc::clone(&sink) as Arc<dyn TerminalEventSink>,
                gate,
                Arc::new(AtomicBool::new(false)),
                7,
            )
            .unwrap();
            handle.join().unwrap();

            assert_eq!(*sink.0.lock().unwrap(), text, "split at byte {split}");
        }
    }
}
```

Run: `cd src-tauri && cargo test --lib terminal_session_events; echo "exit=$?"`. Expected: FAIL at the first split that falls inside `ž`, where the output contains `�`.

- [ ] **Step 3: Implement**

1. Move `IncrementalUtf8Decoder` (the struct, `push`, `finish` and its three unit tests) from `node_package_tagged_utf8.rs` into the new `src-tauri/src/incremental_utf8.rs`. Declare it `pub(crate) struct IncrementalUtf8Decoder` with `pub(crate) fn push` and `pub(crate) fn finish`, and keep `#[derive(Default)]`. Keep the tests' `decoder.pending` access by leaving the tests inside the new module.
2. In `node_package_tagged_utf8.rs`, replace the removed struct with `use crate::incremental_utf8::IncrementalUtf8Decoder;`.
3. In `terminal_module_registration.rs`, add `mod incremental_utf8;` (alphabetical position: first).
4. In `spawn_terminal_reader`, change the loop to:

```rust
            let mut buffer = [0_u8; 8192];
            let mut decoder = IncrementalUtf8Decoder::default();
            loop {
                if stop_requested.load(Ordering::SeqCst) {
                    return;
                }
                match reader.read(&mut buffer) {
                    Ok(0) => {
                        emit_terminal_text(&*sink, decoder.finish(), session_id);
                        return;
                    }
                    Ok(count) => {
                        emit_terminal_text(&*sink, decoder.push(&buffer[..count]), session_id);
                    }
                    Err(error) => {
                        emit_terminal_text(&*sink, decoder.finish(), session_id);
                        if !stop_requested.load(Ordering::SeqCst) {
                            sink.emit_status(TerminalRuntimeStatus::Crashed {
                                message: format!("Terminal output stream failed: {error}"),
                                session_id,
                            });
                        }
                        return;
                    }
                }
            }
```

   Add these imports: `use crate::incremental_utf8::IncrementalUtf8Decoder;` and `use crate::terminal_line_endings::emit_terminal_text;`. `emit_terminal_text` already skips empty strings.

- [ ] **Step 4: Verify and commit**

```bash
cd src-tauri
cargo test --lib terminal_session; echo "exit=$?"
cargo test --lib node_package; echo "exit=$?"
cargo test --lib incremental_utf8; echo "exit=$?"
cargo fmt --all -- --check; echo "exit=$?"
cargo clippy --all-targets -- -D warnings; echo "exit=$?"
cd ..
git add src-tauri/src/incremental_utf8.rs src-tauri/src/node_package_tagged_utf8.rs src-tauri/src/terminal_module_registration.rs src-tauri/src/terminal_session_events.rs
git commit -m "fix(terminal): decode multibyte output split across reads"
```

---

### Task 16: "Show Git Changes" opens the Git surface; Files keeps git markers fresh (E2 partial, R3)

**Files:**
- Create: `src/application/agentGitStatusDemand.ts`
- Delete: `src/application/agentDiffStatusDemand.ts`
- Modify: `src/application/workbenchGitSidebarCommands.ts` (+ its test), `src/application/useWorkbenchCommandRegistry.ts` (the `workbenchGitSidebarCommands({...})` call at ~1012), `src/application/useWorkbenchController.ts` (import line 1 and line ~1759), `src/application/useWorkbenchSidebarDataRefresh.test.tsx`

**Interfaces:**
- `agentGitStatusDemand(workbench: AgentWorkbenchLayoutState): boolean` is true when the layout is `agent`, the right panel is open and the active open surface is `diff` or `files`.
- `workbenchGitSidebarCommands({ agentLayout: AgentWorkbenchLayoutCommandPort, refreshGitStatus })`.

- [ ] **Step 1: Write the failing tests**

In `workbenchGitSidebarCommands.test.ts`, replace `showGitSidebar: vi.fn(),` in every call with `agentLayout: recordingLayout(),`. Add this helper (imports: `initialAgentWorkbenchLayout` and `type AgentWorkbenchLayoutAction` from `../domain/agentWorkbenchLayout`, and `type AgentWorkbenchLayoutCommandPort` from `./workbenchAgentCommands`):

```ts
function recordingLayout(): AgentWorkbenchLayoutCommandPort & {
  readonly actions: AgentWorkbenchLayoutAction[];
} {
  const actions: AgentWorkbenchLayoutAction[] = [];
  return { actions, layout: initialAgentWorkbenchLayout, dispatch: (action) => actions.push(action) };
}
```

and the test:

```ts
  it("opens the Git surface in the right panel", () => {
    const agentLayout = recordingLayout();
    const show = workbenchGitSidebarCommands({ agentLayout, refreshGitStatus: vi.fn() }).find(
      (command) => command.id === "git.show",
    );

    show?.run(enabledContext);

    expect(agentLayout.actions).toEqual([{ kind: "openSurface", surface: "git" }]);
  });
```

If `Command["run"]` takes no argument, call `show?.run()`. If `AgentWorkbenchLayoutAction` is exported from `useAgentWorkbenchLayout.ts` instead, import it from there.

In `useWorkbenchSidebarDataRefresh.test.tsx`:
- change the import to `import { agentGitStatusDemand } from "./agentGitStatusDemand";` and the call site;
- in the `it.each` "does not demand refresh while otherSurface" branch, change `activeSurface: "files", openSurfaces: ["diff", "files"]` to `activeSurface: "terminal", openSurfaces: ["diff", "terminal"]`;
- add:

```tsx
  it("refreshes git markers while the Files surface is visible", () => {
    layout = { ...layout, activeSurface: "files", openSurfaces: ["files"] };
    render();
    expect(refresh).toHaveBeenCalledOnce();
  });
```

Run: `npx vitest run src/application/workbenchGitSidebarCommands.test.ts src/application/useWorkbenchSidebarDataRefresh.test.tsx; echo "exit=$?"`. Expected: FAIL (module and option missing).

- [ ] **Step 2: Implement**

`src/application/agentGitStatusDemand.ts`:

```ts
import type { AgentSurfaceKind } from "../domain/agentWorkbenchLayout";
import type { AgentWorkbenchLayoutState } from "./useAgentWorkbenchLayout";

const GIT_STATUS_SURFACES: ReadonlyArray<AgentSurfaceKind> = ["diff", "files"];

export function agentGitStatusDemand(workbench: AgentWorkbenchLayoutState): boolean {
  const { layout } = workbench;
  return (
    workbench.effectiveLayout === "agent" &&
    layout.rightPanel === "open" &&
    GIT_STATUS_SURFACES.includes(layout.activeSurface) &&
    layout.openSurfaces.includes(layout.activeSurface)
  );
}
```

(If `layout.activeSurface` can be `null`, guard it with `layout.activeSurface !== null &&` before `includes`. Check the type in `domain/agentWorkbenchLayout.ts`.)

`workbenchGitSidebarCommands.ts`:

```ts
import type { Command } from "./commandRegistry";
import type { AgentWorkbenchLayoutCommandPort } from "./workbenchAgentCommands";

interface WorkbenchGitSidebarCommandsOptions {
  agentLayout: AgentWorkbenchLayoutCommandPort;
  refreshGitStatus: Command["run"];
}

export function workbenchGitSidebarCommands({
  agentLayout,
  refreshGitStatus,
}: WorkbenchGitSidebarCommandsOptions): Command[] {
  return [
    {
      id: "git.show",
      title: "Show Git Changes",
      category: "Git",
      isEnabled: (context) => context.hasWorkspace,
      run: () => agentLayout.dispatch({ kind: "openSurface", surface: "git" }),
    },
    {
      id: "git.refresh",
      title: "Refresh Git Changes",
      category: "Git",
      isEnabled: (context) => context.hasWorkspace,
      run: refreshGitStatus,
    },
  ];
}
```

`useWorkbenchCommandRegistry.ts`: change `showGitSidebar: () => setSidebarView("git"),` to `agentLayout: agents.agentWorkbench,`. `useWorkbenchController.ts`: update the import and `const agentDiffVisible = agentGitStatusDemand(agents.agentWorkbench);`. Delete `agentDiffStatusDemand.ts` with `git rm`.

- [ ] **Step 3: Verify and commit**

```bash
npx vitest run src/application/workbenchGitSidebarCommands.test.ts src/application/useWorkbenchSidebarDataRefresh.test.tsx src/application/useWorkbenchCommandRegistry.test.tsx; echo "exit=$?"
npm run check; echo "exit=$?"
npm run size:hotspots; echo "exit=$?"
git add src/application/agentGitStatusDemand.ts src/application/workbenchGitSidebarCommands.ts src/application/workbenchGitSidebarCommands.test.ts src/application/useWorkbenchCommandRegistry.ts src/application/useWorkbenchController.ts src/application/useWorkbenchSidebarDataRefresh.test.tsx
git commit -m "fix(git): open the Git surface from Show Git Changes and keep Files markers fresh"
```

(`git rm src/application/agentDiffStatusDemand.ts` was already staged in Step 2. If `useWorkbenchCommandRegistry.test.tsx` does not exist, drop it from the command.)

---

### Task 17: Remove bulk unarchive and the slim archived row (S2, S3)

**Precondition:** Task 6 accepted (`AgentThreadsSidebar.test.tsx` is migrated).

**Files:** `src/components/agentMode/AgentThreadSelectionBar.tsx`, `src/domain/agentThreadBulkAction.ts` (+ `agentThreadBulkAction.test.ts`), `src/components/agentMode/useAgentThreadMenuCommands.ts`, `src/components/agentMode/agentSidebarPresentation.ts` (+ test), `src/components/agentMode/AgentThreadRow.tsx` (+ test), `src/components/agentMode/AgentThreadsSidebar.test.tsx`.

- [ ] **Step 1: Verify there are no producers**

```bash
grep -rn "archivedCount" src --include='*.tsx' --include='*.ts' | grep -v "\.test\."
grep -rn "agentRailViews\|agentRowVariant" src --include='*.tsx' --include='*.ts' | grep -v "\.test\."
```

Expected: `archivedCount` appears only inside `AgentThreadSelectionBar.tsx`. Then run `npx vitest run src/components/agentMode/agentSidebarPresentation.test.ts -t archived` and check whether any test proves archived views reach rail sections. If archived threads can still be rendered as rail rows (for example through a search surface that uses `AgentThreadRow`), stop, record the finding, and remove only the selection-bar code (S2).

- [ ] **Step 2: Write the failing tests**

In `src/domain/agentThreadBulkAction.test.ts`:

```ts
  it("offers only archive and delete as bulk actions", () => {
    const actions: ReadonlyArray<AgentThreadBulkAction> = ["archive", "delete"];
    expect(actions.map((action) => agentThreadBulkConfirmLabel(action, 2))).toEqual([
      "Confirm archive of 2 threads",
      "Confirm delete of 2 threads",
    ]);
  });
```

In `agentSidebarPresentation.test.ts`, add a case to the rail-views tests: a repo group whose `archived` list holds one view yields `agentRailViews(groups)` without that view. Build it with the file's existing view fixture, e.g. `expect(agentRailViews(groups).map((view) => view.thread.threadId)).toEqual([activeId])`.

In `AgentThreadsSidebar.test.tsx`, add: selecting two threads shows the selection bar with Archive and Delete and no "Unarchive" button (`expect(screenText()).not.toContain("Unarchive")`, using the file's existing text helper).

Run: `npx vitest run src/domain/agentThreadBulkAction.test.ts src/components/agentMode/agentSidebarPresentation.test.ts src/components/agentMode/AgentThreadsSidebar.test.tsx; echo "exit=$?"`. Expected: FAIL on the rail-views case. The type test compiles either way; it pins the narrowed union for the next step.

- [ ] **Step 3: Implement**

1. In `agentThreadBulkAction.ts`:
   - `export type AgentThreadBulkAction = "archive" | "delete";`;
   - remove `"notArchived"` from `AgentThreadBulkSkipReason` and from `SKIP_REASON_RANK`/`SKIP_REASON_LABEL`;
   - remove the `unarchive` branches in `appliedVerb` and `blockedReason`. The exhaustive `never` calls remain.
2. In `AgentThreadSelectionBar.tsx`: remove the `archivedCount` prop, the `unarchive` handler, the Unarchive button and the `ArchiveRestore` import. Render Archive unconditionally.
3. In `useAgentThreadMenuCommands.ts`: remove the bulk `case "unarchive"` that `tsc` now flags. Keep the single-thread context-menu "Unarchive thread" (`agentThreadContextMenuModel.ts:126`); it stays reachable for an archived thread opened from Settings > Archive.
4. In `agentSidebarPresentation.ts`: `agentRailViews` pushes only `...repo.threads`. Delete `AgentRowVariant`, `agentRowVariant`, `slimRowClassName` and the `variant` field. In `AgentThreadRow.tsx`, delete the `model.variant === "slim"` branch (`agent-slim-slot`). The now-dead `.agent-row--slim` and `.agent-slim-slot` CSS falls to Task 9's guard, so rerun Task 9 Step 3 after this task if it already landed.

- [ ] **Step 4: Verify and commit**

```bash
npx vitest run src/domain/agentThreadBulkAction.test.ts src/components/agentMode; echo "exit=$?"
npm run check; echo "exit=$?"
git add src/domain/agentThreadBulkAction.ts src/domain/agentThreadBulkAction.test.ts src/components/agentMode/AgentThreadSelectionBar.tsx src/components/agentMode/useAgentThreadMenuCommands.ts src/components/agentMode/agentSidebarPresentation.ts src/components/agentMode/agentSidebarPresentation.test.ts src/components/agentMode/AgentThreadRow.tsx src/components/agentMode/AgentThreadsSidebar.test.tsx
git commit -m "chore(agents): remove unreachable bulk unarchive and slim archived rows"
```

---

### Task 18: Full repository gates (lead)

- [ ] **Step 1: Free port 9229, then run every gate, one at a time, checking each exit code**

```bash
cd /Users/matusmockor/Developer/editor
lsof -nP -iTCP:9229 -sTCP:LISTEN
npm run check; echo "check=$?"
npm run lint -- --max-warnings 0; echo "lint=$?"
npm run lint:exhaustive-deps; echo "deps=$?"
npm run build; echo "build=$?"
npm run size:hotspots; echo "hotspots=$?"
npm run format:check; echo "format=$?"
npm run format:check:changed; echo "format-changed=$?"
npm test -- --run; echo "test=$?"
cd src-tauri
cargo check --all-targets; echo "cargo-check=$?"
cargo test --lib; echo "cargo-lib=$?"
cargo test --tests; echo "cargo-tests=$?"
cargo fmt --all -- --check; echo "fmt=$?"
cargo clippy --all-targets -- -D warnings; echo "clippy=$?"
cd ..
git diff --check; echo "diff-check=$?"
```

Expected: every value is `0`. `npm run build` is a CLAUDE.md gate for this project and overrides the global "no build" preference. If a Node watch test fails with `EADDRINUSE 9229`, kill only the listed PID and rerun `npm test -- --run` alone. Do not rerun it in parallel with other suites.

- [ ] **Step 2: Coverage.** If the changed surface is part of the coverage workflow, run `npx vitest run --coverage` and confirm that thresholds hold. Do not commit `coverage/`.

---

### Task 19: Performance comparison (OWNER-SCHEDULED)

**Why owner-scheduled:** the autorun lane launches and drives a dev app, so it needs about 40 minutes with no keyboard or mouse use and no other heavy processes. Ask the owner for a window. Do not start without their explicit go-ahead.

**Base:** `/tmp/codevo-p7-base`, a detached worktree at `2102179f5` that already exists. **Head:** the P10 tip in `/Users/matusmockor/Developer/editor`.

- [ ] **Step 1: Prepare both trees**

```bash
git -C /tmp/codevo-p7-base log --oneline -1
cd /tmp/codevo-p7-base && { test -d node_modules || npm ci; } && npm run perf:fixtures; echo "exit=$?"
cd /Users/matusmockor/Developer/editor && npm run perf:fixtures; echo "exit=$?"
```

Expected: the log shows `2102179f5`, and both commands exit `0`.

- [ ] **Step 2: Run the smoke autorun lane (`typing-large-5k` + `tab-switch-cycle`, per `docs/PERFORMANCE.md:115`) alternately, two runs per side**

```bash
cd /tmp/codevo-p7-base && npm run perf:autorun:smoke; echo "base1=$?"
cd /Users/matusmockor/Developer/editor && npm run perf:autorun:smoke; echo "head1=$?"
cd /tmp/codevo-p7-base && npm run perf:autorun:smoke; echo "base2=$?"
cd /Users/matusmockor/Developer/editor && npm run perf:autorun:smoke; echo "head2=$?"
```

- [ ] **Step 3: Compare.** Collect p50 and p95 for each scenario from the four newest JSON files in each tree's `perf/results/`. Acceptance: for both scenarios, head p95 ≤ 1.10 × base p95 (median of the two runs), or within the lane's documented noise band in `docs/PERFORMANCE.md`. Record this table in the final report:

| Scenario | Base p50/p95 (runs 1, 2) | Head p50/p95 (runs 1, 2) | Verdict |
|---|---|---|---|
| typing-large-5k | measured | measured | pass/fail |
| tab-switch-cycle | measured | measured | pass/fail |

A regression beyond the band blocks the release. Profile it before optimizing, as in the memory note "Perf: profile before optimizing". Never commit `perf/results/*`. Removing `/tmp/codevo-p7-base` is a lead git operation and happens only with the owner's OK.

---

### Task 20: Independent read-only review (Opus 5.5)

- [ ] **Step 1: Dispatch one read-only reviewer.** Model: Opus 5.5. Tools: read and search only, with no edits and no git mutations. Prompt:

> Review the P10 range `$(cat $HOME/tmp/codevo-p10/base-sha.txt)..HEAD` in /Users/matusmockor/Developer/editor against docs/superpowers/plans/2026-09-25-redesign-p10-finalization.md and CLAUDE.md. Do not edit anything. Focus on:
> - (1) any legacy variable, `data-theme` selector or `--cv-*` reference that is not declared at `:root`;
> - (2) visual-parity risks in the mapping table, especially `--color-accent-text` → `--cv-on-accent`, `--codevo-thread` → `--cv-canvas` and `--radius-xl` → `--cv-r-group`;
> - (3) portaled surfaces (dialogs, toasts, menus, Monaco widgets) losing tokens;
> - (4) useAgentShipFlow owner-change semantics (no receipts or notices after owner loss; failure still `authorityLost`);
> - (5) RevokedRoots rollback correctness and deterministic eviction;
> - (6) the incremental UTF-8 decoder on EOF and error paths in the PTY reader;
> - (7) deleted modules or styles that are still reachable;
> - (8) baselines that grew.
>
> Report P0/P1/P2 findings with file:line and a concrete fix. Say explicitly when a category has no findings.

- [ ] **Step 2: Verify each finding in code before fixing it** (memory: audits here overstate). Fix the valid P0/P1 findings in the owning task's files, rerun the affected gates from Task 18, and record any rejected finding with its reason in the final report.

---

### Task 21: QA build (lead)

- [ ] **Step 1: Sync the detached QA worktree to the reviewed tip and build.** The lead does the git operation:

```bash
P10_SHA="$(git -C /Users/matusmockor/Developer/editor rev-parse HEAD)"
git -C "$HOME/tmp/codevo-qa/tree" checkout --detach "$P10_SHA"; echo "exit=$?"
cd "$HOME/tmp/codevo-qa/tree" && npm ci; echo "exit=$?"
npx tauri build --debug --bundles app --config '{"identifier":"dev.mockor.editor.qa","productName":"Codevo QA"}'; echo "exit=$?"
```

Expected: `src-tauri/target/debug/bundle/macos/Codevo QA.app` exists. An exit code of 1 caused only by the missing updater signing key is acceptable; a compile error is not.

- [ ] **Step 2: Replace the installed QA app, addressing it only by its full path**

```bash
osascript -e 'tell application "/Users/matusmockor/tmp/codevo-qa/app/Codevo QA.app" to quit'
rm -rf "$HOME/tmp/codevo-qa/app/Codevo QA.app"
ditto "$HOME/tmp/codevo-qa/tree/src-tauri/target/debug/bundle/macos/Codevo QA.app" "$HOME/tmp/codevo-qa/app/Codevo QA.app"
open "$HOME/tmp/codevo-qa/app/Codevo QA.app"
osascript -e 'tell application "/Users/matusmockor/tmp/codevo-qa/app/Codevo QA.app" to activate'
```

Never address "Codevo Editor" (`dev.mockor.editor`), the owner's live session. In the QA app, open the trusted git project `~/tmp/codevo-qa-p2`. Make sure it has at least one JS file with a `launch.json` configuration, one test file, one thread with a finished Codex turn and one archived thread.

---

### Task 22: Codex computer-use QA in 6 palettes × dark/light

Three runs of about 55 minutes each, four palette/scheme combinations per run. Each prompt starts with the shared rules file, which already contains ATTACH-ONLY, full-app-path targeting, the frontmost-before-every-screenshot rule, the never-touch-"Codevo Editor" rule and the cheapest-OpenAI-model rule.

- [ ] **Step 1: Write the per-combination checklist once**

```bash
cat > "$HOME/tmp/codevo-qa/qa_p10_combo.txt" <<'QA'
For the palette and scheme named in the step, do this sequence and record PASS/FAIL per item with a screenshot:
C1 Settings (Cmd+,) > General > Theme: click the palette card, then pick the scheme (Dark or Light) in the segmented control. The whole window recolours; the selected card shows a check and a selection ring.
C2 Back to the thread view. Sidebar, conversation, composer and top bar: text readable, borders visible, no element with a white or black browser-default background, no transparent popover.
C3 Open the model picker in the composer footer, then Escape. Popover opaque with visible separators.
C4 Cmd+K command palette: rows, highlights, footer hints on one line. Escape.
C5 Right panel: open Diff, Files, Git and Terminal tabs in turn. In Terminal run: printf 'zltý kôn 🦀\n%.0s' {1..400}  (no replacement characters). Scrollbars match the scheme (light scrollbars in Light).
C6 Open a .js file in the editor (focus mode). Open the debug view: the launch configuration picker, Function Breakpoints and Exception filters sections, and the test results panel (use Cmd+K and search "launch", "breakpoint", "test" if needed). Text, borders and selected rows readable; no unstyled rows.
C7 Type one character into the open editor, then close its tab: the unsaved-changes dialog is opaque and readable. Choose Cancel.
Report any low-contrast text, invisible borders, controls that merge with the background, or anything that looks unstyled, with the item id (C1-C7).
QA
```

- [ ] **Step 2: Write the three run prompts**

```bash
for RUN in a b c; do
  cat "$HOME/tmp/codevo-qa/qa_common_rules.txt" > "$HOME/tmp/codevo-qa/qa_prompt_p10$RUN.txt"
  printf '\nTime budget about 55 minutes.\nCONTEXT: P10 finalization QA. Project codevo-qa-p2 is trusted and open. Reference design: docs/redesign/v3-*.html in the repository.\n\n' >> "$HOME/tmp/codevo-qa/qa_prompt_p10$RUN.txt"
  cat "$HOME/tmp/codevo-qa/qa_p10_combo.txt" >> "$HOME/tmp/codevo-qa/qa_prompt_p10$RUN.txt"
done
printf '\nSTEPS\n1. Graphite · Teal Dark: run C1-C7.\n2. Graphite · Teal Light: run C1-C7.\n3. Slate · Blue Dark: run C1-C7.\n4. Slate · Blue Light: run C1-C7.\n' >> "$HOME/tmp/codevo-qa/qa_prompt_p10a.txt"
printf '\nSTEPS\n1. Black · Violet Dark: run C1-C7.\n2. Black · Violet Light: run C1-C7.\n3. Ink · Mint Dark: run C1-C7.\n4. Ink · Mint Light: run C1-C7.\n' >> "$HOME/tmp/codevo-qa/qa_prompt_p10b.txt"
cat >> "$HOME/tmp/codevo-qa/qa_prompt_p10c.txt" <<'QA'

STEPS
1. Zinc · Orange Dark: run C1-C7.
2. Zinc · Orange Light: run C1-C7.
3. Carbon · Lime Dark: run C1-C7.
4. Carbon · Lime Light: run C1-C7.
R1 Settings > General > Editor header items: exactly three chips - Index, IDE engine, Cursor position. Toggle Cursor position off: the cursor readout disappears from the editor sub-header; toggle it back on.
R2 Cmd+K, type "Show Git Changes", Enter: the right panel opens on the Git tab.
R3 In the Git tab, stage and commit one small change in codevo-qa-p2 with message "qa p10". Switch to the Files tab: the committed file no longer shows a modified marker within a few seconds.
R4 Settings > General > Text & editor: set the thread font size to the largest value. The conversation text, sidebar row text and composer text grow; set it back to the default.
R5 Settings > General > Theme: Tab onto a non-selected palette card - its focus ring differs from the selected card's ring and check.
R6 In the editor, place the cursor on a line and press Cmd+Shift+K: the line is deleted (then Cmd+Z). Outside the editor (click the sidebar) press Cmd+Shift+K: thread search opens; Escape.
R7 Cmd+P: the files page footer hints fit on one line.
R8 Select two threads in the sidebar (Cmd+click): the selection bar shows Archive and Delete, and no Unarchive. Press Escape.
R9 Finally select Graphite · Teal Dark again.
QA
```

- [ ] **Step 3: Run the three QA passes sequentially (one Codex app-server at a time) and collect the reports**

```bash
QA_MINUTES=55 python3 "$HOME/tmp/codevo-qa/qa_orchestrator_v2.py" "$HOME/tmp/codevo-qa/qa_prompt_p10a.txt" "$HOME/tmp/codevo-qa-import" > "$HOME/tmp/codevo-qa/qa_p10a.log" 2>&1; echo "exit=$?"
```

Repeat for `b` and `c`. Run each in the background and poll the log for `===== QA REPORT =====` or `TIMEOUT`. If a log shows `COMPUTER_USE_UNAVAILABLE`, stop: it is structural, so give the owner the prompt to paste into their own interactive `codex` session and do not retry headless. Never kill Codex broadly; kill only the orchestrator's exact PID.

- [ ] **Step 4: Fix loop.**
  1. Verify every FAIL in code before fixing it.
  2. Map it to a mapping-table entry or a component rule.
  3. Fix it in the owning file with a regression assertion. For a token mapping issue, add the expectation to `replacementTokens.test.ts` or the owning style test.
  4. Rerun the focused tests and Task 18's JS gates, rebuild (Task 21), and re-run only the failed combinations.
  5. Commit each fix separately, e.g. `fix(ui): <what> in <palette> <scheme>`.
  6. Delete the scratch QA prompts after the final pass. They live outside the repo and are never committed.

---

### Task 23: Release preparation commit (lead), then HARD STOP

- [ ] **Step 1: Preconditions.**
  - Tasks 18 and 20-22 are green.
  - Task 19 passed, or the owner has explicitly waived it in writing for this release.
  - The owner has answered the E4 decision (amend/discard as a known issue).
  - `git status --short` is empty.
  - `git log origin/main..HEAD --oneline` lists only reviewed P0-P10 commits.
  - `git fetch origin` and then `git merge-base --is-ancestor origin/main HEAD; echo "exit=$?"` gives `exit=0`.

- [ ] **Step 2: Bump the version.** Change `0.2.0-beta.72` to `0.2.0-beta.73` in:
  - `package.json`;
  - `package-lock.json` (the root `version` and `packages[""].version`);
  - `src-tauri/Cargo.toml`;
  - `src-tauri/Cargo.lock` (the `codevo-editor` package entry only);
  - `src-tauri/tauri.conf.json`.

  Follow the pattern of `git show a5fb1e5d5 --stat`. Then:

```bash
npm run check; echo "exit=$?"
node --test scripts/release-manifest-notes.test.mjs scripts/release-quality-gates.test.mjs; echo "exit=$?"
cd src-tauri && cargo check; echo "exit=$?"; cd ..
```

- [ ] **Step 3: CHANGELOG.** Under `## [Unreleased]`, add a `## [0.2.0-beta.73] - <release date YYYY-MM-DD>` section in the existing format. Move any bullets already under Unreleased into it. Keep the section under 3,000 characters (the workflow caps release notes at 4,096). Start from this draft, and change a bullet only to match verified shipped behavior:

```markdown
## [0.2.0-beta.73] - YYYY-MM-DD

### Added

- A calm new interface with six palettes - Graphite · Teal (default), Slate · Blue,
  Black · Violet, Ink · Mint, Zinc · Orange and Carbon · Lime - each in dark and light,
  with a System, Dark or Light appearance setting.
- One thread list across all projects with a project filter, pinned, active and settled
  sections, search with highlighted matches, inline rename and a full context menu.
- Command palette (Cmd+K) with files (Cmd+P), branches, scripts, threads and projects,
  and a keyboard shortcuts cheatsheet (Cmd+/).
- Right panel with Diff, Files, Terminal, Git, Scripts and Pull request tabs, a pull
  request form and a composer branch picker that can start new worktrees.
- Add projects from the command palette (folder, Git URL, GitHub, GitLab, recent
  folders), a one-step clone form with live validation and progress, and a workspace
  trust dialog.
- Retry after a provider error, and load earlier activity of long turns.

### Changed

- Conversation, composer, sidebar, editor, debugger panels, settings and pickers follow
  the new layout. The status bar is gone; its readouts moved to the editor header,
  tooltips, the command palette and settings.
- Codex subagents appear as batch rows and in the Agents panel, like Claude subagents.
- Editor header items in Settings list only the readouts the header shows.

### Fixed

- HTML previews of agent-linked files, sidebar background-label flicker, queued-message
  image thumbnails and Codex usage totals.
- Terminal output no longer garbles characters split across reads.
- Merging and removing a worktree report success when they finished while the project
  changed.
- "Show Git Changes" opens the Git tab, and Files git markers refresh after a commit.
- Clone error advice is no longer misled by server messages; the list of folders whose
  trust was revoked after a clone is bounded.
- Native scrollbars and controls follow the palette's dark or light scheme.

### Known issues

- Amending a commit and discarding changes are not available in the Git tab yet.
- Settings > Archive lists threads from this computer only.
- When file watching hits its limits, the app does not say so yet.
- Pushing from a non-agent branch in a managed worktree fails with an error.
```

- [ ] **Step 4: Commit the release prep (local only)**

```bash
npx prettier --check package.json CHANGELOG.md
git add package.json package-lock.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json CHANGELOG.md
git commit -m "chore(release): prepare beta.73"
git log --oneline -3
```

- [ ] **Step 5: HARD STOP.** Report to the owner:
  - the commit list since `origin/main`;
  - the gate results;
  - the QA verdicts;
  - the perf table;
  - the known issues.

  Ask for explicit authorization to push `main`, create and push tag `v0.2.0-beta.73`, and run the beta workflow. Do nothing further until the owner replies in this session.

---

### Task 24: Beta release by Codex (only after explicit owner authorization)

- [ ] **Step 1: Write the release prompt** at `$HOME/tmp/codevo-qa/release_prompt_beta73.txt`. Model it on `release_prompt.txt`, updated as follows:

```text
You are releasing Codevo Editor beta 0.2.0-beta.73 from /Users/matusmockor/Developer/editor. The owner explicitly authorized in this session: push main to origin, create and push the annotated tag v0.2.0-beta.73, and run the beta release workflow. Follow docs/release.md exactly.

Facts verified by the lead on this exact commit: all CLAUDE.md gates exit 0; independent review findings resolved; Codex computer-use QA passed in 6 palettes x dark/light; version synchronized at 0.2.0-beta.73; CHANGELOG has the 0.2.0-beta.73 section; the release-prep commit is HEAD.

RULES
- Branch main only. No force push, rebase, reset, amend or history rewrite. No new commits.
- Commit/tag messages contain no AI/Claude/Codex/Anthropic/OpenAI attribution and no Co-Authored-By.
- Stop and report on any unexpected state or failure. Do not retry a failed workflow and do not change anything.

STEPS
1. `git status --short` must be empty. `git fetch origin`. `git merge-base --is-ancestor origin/main HEAD` must succeed (main is ahead, not behind). Confirm `git log -1 --format=%s` is "chore(release): prepare beta.73" and package.json version is 0.2.0-beta.73.
2. `npm run check`.
3. `git push origin main`.
4. `git tag -a v0.2.0-beta.73 -m "Codevo Editor 0.2.0-beta.73"` and `git push origin v0.2.0-beta.73`.
5. Dispatch and watch exactly as in docs/release.md with release_tag=v0.2.0-beta.73 and release_mode=beta (fresh uuid dispatch_id, find exactly one run by displayTitle, `gh run watch "$run_id" --exit-status`). On failure: `gh run view "$run_id" --log-failed | tail -200` and report the failing step.
6. On success report: pushed range, tag, run id/URL, `gh release view v0.2.0-beta.73 --json url,isPrerelease,assets` output, asset names.
```

- [ ] **Step 2: Run it through Codex.** Use the codex-implementation route (`codex exec` with the prompt file) in the background. Poll for completion, verify the reported URLs with `gh release view v0.2.0-beta.73 --json url,isPrerelease`, and relay the result. After a successful release, the lead may remove `/tmp/codevo-p7-base` with `git worktree remove /tmp/codevo-p7-base`, with the owner's OK.

---

## Open risks

1. **Concurrent session in the tree.** At planning time another session had 43 uncommitted files (F7 removal, the clone auto-open work and `AgentModeView.tsx`). P10 must not start until that work is committed or handed over (P-1). The ratchet baseline must be regenerated at Task 1 if HEAD moved.
2. **Visual drift from token consolidation.** Four collapses are deliberate simplifications that QA must judge in all 12 combinations:
   - `--codevo-thread` (a side/well mix) becomes `--cv-canvas`;
   - `--radius-xl`/`--codevo-r-xl` (14px) becomes 12px;
   - `--color-accent-soft` (accent mixed 14% into the panel) becomes `--cv-accent-soft`;
   - the App.css root font moves from Inter to `--cv-font-ui` (system).
3. **Contract-test rewrite scope in Task 8.** `cssTokenContract.test.ts` (158 legacy names) and `themeContrast.test.ts` pin legacy behavior in detail. The rule is to retarget behavioral assertions and delete only the alias-chain pins. The reviewer must check that no behavioral guard was lost.
4. **Dead-class guard heuristic.** It is token-based, so it misses dead classes whose names appear elsewhere in TS. The vendor allowlist may need a few more Monaco/xterm names. It is a floor, not full coverage.
5. **E4 capability loss.** Amend, stage/unstage and discard from the old sidebar are unreachable, which contradicts spec §1 "no existing capability is lost". The owner decides whether the beta ships with it as a known issue. That is the recommendation, with "Git surface: amend and discard" as the first post-beta slice.
6. **W7 multi-owner runtime stop** in `dispose_workspace_root` is not fixed in P10. It is limited to the single-active switch path.
7. **Perf window.** Task 19 needs the owner's hands-off time. Without it (or a written waiver), Task 23 does not proceed.
8. **Headless Codex computer use** can fail structurally (no GUI session). The fallback is an owner-run interactive Codex session with the same prompts.
9. **Version.** `0.2.0-beta.73` assumes nobody else tags beta.73 first. Step 1 of the release prompt fails closed if the state differs.

## Self-review

- **Spec coverage.** Every P10 spec requirement maps to a task:
  - QA in all 6 palettes × dark/light: Tasks 21-22.
  - Removal of dead styles and legacy variables, including the inline debug-adjacent styles: Tasks 1-9.
  - Dead code: Tasks 10 and 17.
  - The single beta release gated on owner authorization: Tasks 23-24.
  - §6 testing: component and contract tests per task, AA contrast through `tokenContrast.test.ts` and `replacementTokens.test.ts`, keyboard checks in QA steps R5, R6 and R8, and perf in Task 19.
  - §7 decisions: Opus-only reviewer (Task 20), Codex QA (Task 22), Graphite · Teal default kept (Global Constraints, QA step R9).
- **Placeholder scan.** Scripts, tests and code are written out. The steps that depend on existing helpers (the `FunctionBreakpoints` render helper and the `AgentThreadsSidebar` text helper) say to reuse that file's helper, because their names differ per file. Measured numbers ("measured", "pass/fail") appear only in the Task 19 report table, which is filled at run time.
- **Type consistency.** These names are used identically everywhere:
  - `isLegacyTokenName` (Tasks 1 and 3);
  - `LEGACY_TO_CV` (Tasks 3-7, 20);
  - `--cv-type-scale` and `AGENT_TYPE_SCALE_VARIABLE` (Tasks 2, 3, 22);
  - `RevokedRoots`/`MAX_REVOKED_ROOTS` (Task 13);
  - `IncrementalUtf8Decoder` (Task 15);
  - `agentGitStatusDemand` and `workbenchGitSidebarCommands({ agentLayout, refreshGitStatus })` (Task 16);
  - `AgentThreadBulkAction = "archive" | "delete"` (Task 17).
- **Review Focus.** Each item maps to a test:
  1. Portaled surfaces: the Task 8 root-declaration test.
  2. Scheme vs classic theme: the Task 2 `color-scheme` test and the Task 8 `data-theme` test.
  3. Font scale: Task 2 and the Task 3 mapping check, plus QA R4.
  4. Owner change: the four Task 12 tests.
  5. UTF-8 splits: the Task 15 boundary sweep.
