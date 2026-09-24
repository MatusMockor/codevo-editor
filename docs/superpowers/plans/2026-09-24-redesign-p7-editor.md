# Redesign P7 - Editor and Debugging Surfaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the editor a right-panel surface with maximize/focus mode as its only presentation, and redesign what goes with it to match `docs/redesign/v3-editor.html`. That covers tabs in the panel strip (dirty dot, italic preview), a breadcrumb sub-header with hover actions, the gutter, hover/completion/peek/find widgets, a Problems / Debug console drawer, and Node debugging (toolbar, variables, watch, call stack, breakpoints, console, inline values). P7 also removes the legacy editor-expanded layout without losing any capability.

**Architecture:** Editor documents become the `"editor"` kind of P6's right-panel surface union. Their tabs are fed into P6's `AgentRightPanelTabStrip` through a context, which replaces the tabs portal. The single `EditorRuntimeHost` stays in the frame's `editor` slot and is overlaid on the editor kind's body, so the Monaco models, runtime and cursor store are unchanged. The editor slot gets a new inner layout:
- per-group sub-header (breadcrumbs plus actions from `EditorChromeContext`);
- Monaco;
- a drawer that hosts every non-terminal workbench panel view;
- in focus mode, a debug side column.

The Debug UI is split out of the 1650-line `DebugPanel.tsx` into region components that are fed by the same `DebugPanelProps`. Pure policies live in `src/domain/`: drawer placement, debug focus, exception rows, breadcrumb segments and panel document tabs.

**Tech Stack:** React 19, TypeScript 5.8 strict, Vite 8, Vitest 4 + jsdom 29, Monaco 0.53 (`@monaco-editor/react`), Shiki 4 palette themes (P1), lucide-react, plain CSS with `--cv-*` tokens, foundation components in `src/ui/foundation/**`.

**Spec:** `docs/superpowers/specs/2026-09-23-codevo-redesign-design.md` (§3.1.9 Editor, §4 boundaries, §5 P7, §6 testing, §7 decisions). Mockup: `docs/redesign/v3-editor.html`. States: `panel`, `focus`, `hover`, `completion`, `refs`, `problems`, `debug`, `find`.

## Global Constraints

- Spec §3.1.9: "editor in the right panel with maximize/focus mode; tabs (dirty dot, preview italic), breadcrumb subheader with hover actions, gutter (breakpoints, git markers, folds), hover cards with quick fix, completion, references peek with rename, Problems drawer, find widget, Node debugging (debug toolbar, variables, watch, call stack, breakpoints, debug console, inline values) in focus mode."
- Lead decision (P2 plan "Lead decisions" 5): "P7 removes the standalone editor layout: the editor lives in the right panel with maximize/focus mode as its only presentation; P7 moves the editor status group into the editor sub-header and keeps bottom panel / Problems / debug reachable from focus mode." Nothing may be lost.
- Lead decisions 2-4: the collapsed sidebar state is global. There is no default maximize shortcut (P5 palette command `panel.toggleMaximized`). The right panel stays on Cmd+Alt+R. P7 must not claim Cmd+B, Cmd+Alt+R or Cmd+J.
- Spec §1: "no existing capability is lost (agent workflows, editor, debugging, git, scripts, terminals, settings, remote execution)"; all 6 palettes x dark/light.
- Spec §4: "Hotspot limits: `App.tsx`, `useWorkbenchController.ts`, `AgentThreadSession.tsx` and other large files must shrink or stay flat; new surfaces get their own focused modules." "Old styles are removed as each surface is migrated; no long-lived dual styling." "no feature component defines its own colors."
- Spec §6: "Performance: no regression in typing latency, transcript scrolling or large-file editing; measured before/after on the conversation and editor surfaces."
- Spec §7.1: implementation and review agents are Opus 5.5 only. UI QA uses Codex Computer Use against the QA bundle `dev.mockor.editor.qa`.
- CLAUDE.md: work on `main`; no CodeRabbit; independent read-only review; do not raise hotspot baselines to silence growth; keep TS contracts `readonly` and closed; exhaustive switches with `never`; no `any`; React tests use `act`/`waitFor`; no code comments except tooling annotations; never `prettier --write` a directory (memory rule).
- CLAUDE.md large files: detect them by measured bytes and lines. Keep essential editing, save, search, go-to-line and basic navigation working. Disable or reduce expensive semantic features explicitly and show a bounded reason. Never do per-keystroke work that scales with the workspace.
- Tokens: use only `--cv-*` (P1). The editor extras already exist: `--cv-git-mod`, `--cv-breakpoint`, `--cv-match`, `--cv-match-current`. Sizes come from the mockup: tabs 24px high and max 144px wide, sub-header 40px, code line 20px, gutter columns 20/30/12/16px, drawer 224px (236px while debugging), debug side column 304px, find widget 36px, hover card 404px, completion 372px, peek 540x192px.

## Review Focus

1. **Terminal and drawer switch.** A running terminal, then Problems (⇧⌘M), then the terminal again (Cmd+J) must give back the same terminal session. That is how hiding the bottom panel behaves today. Nothing may be killed just because the drawer and the terminal now live in different hosts. Pinned in Task 9 (`workbenchPanelPlacement` plus the `WorkbenchBottomPanelHost` mounting test).
2. **Debug focus with hand-made layout changes.** Start debugging with the panel docked: focus mode is entered once. If the user restores the panel during the session, a later pause in the same session must not maximize again. When the session ends, the panel is restored only if P7 maximized it and the user did not change the layout in between. Workspace A -> B -> A must never apply A's pending restore to B. Pinned in Task 3 (`editorDebugFocusReducer` tests) and Task 10 (coordinator test).
3. **Typing in a large or dirty document.** Each keystroke replaces the document objects. The strip value, the chrome context and the sub-header must not re-render the tab strip or all surfaces per keystroke. Only a dirty flip, a tab change or an active change may produce a new value. A 5,000+ line / 256 KB file shows the large-file reason in the sub-header row and skips symbol crumbs. Pinned in Task 4 (`editorPanelDocumentsEqual`), Task 7 (render-count test) and Task 14 (measurement).
4. **Remote thread selected.** The editor kind is local-only. With a remote thread active, the editor tab is not served, the editor slot stays hidden, and file-open intents coming from a remote pane never paint a local editor over it. Pinned in Task 1 (`agentSurfaceServes` / `agentSurfaceEditorSlot`).
5. **Exception policy rows.** "All exceptions" and "Uncaught exceptions" must map to exactly `none | uncaught | all` with no unrepresentable "caught-only" state. They must not send a request while `exceptionPausePending` is true. Pinned in Task 3 (`nextExceptionPauseMode`) and Task 10 (component test).

---

## Current Code Summary (mapped 2026-09-24, before P2-P6 land)

- **Frame.** `WorkbenchShellFrame.tsx` (140) + `workbenchShellFrame.css` (326).
  - Slots: `chrome`, `agent`, `surface`, `editor`, `bottom`, `settings`. Placement comes from `workbenchShellPlacement.ts`.
  - The single editor host (`LazyWorkbenchEditorRuntimeHost` -> `WorkbenchEditorHost` (154) -> `EditorArea` (91) -> `EditorGroupView` (180) / `EditorSplit` (127) -> `ScopedEditorSurface` (143) -> `EditorSurface` (2499, hotspot 10301 tokens)) sits in `[data-slot="editor"]`.
  - In the agent layout, CSS overlays that slot on the right panel's Files surface body: `padding-top: var(--agent-surface-header-height)`, `padding-left: var(--agent-surface-tree-width)`, and `display: none` when `.agent-surface[data-editor-slot="none"]`.
- **Editor tabs.** `EditorTabs.tsx` (305) supports dirty (`content !== savedContent`), preview (`group.previewPath && !dirty`, italic), drag/reorder and MRU. The active group's tabs are portaled into `WorkbenchEditorTabsPortalTarget` (`workbenchEditorTabsPortal.tsx`) inside the right-panel header. Non-active split groups render tabs inline. Split editing exists (`domain/editorGroups.ts`, `EditorSplit.tsx`).
- **Breadcrumbs.**
  - `Breadcrumbs.tsx` (219) shows only the file name plus symbol segments with sibling menus.
  - `CursorAwareBreadcrumbs.tsx` (74) is fed by the cursor store.
  - Both are rendered by `editorSurfaceCore/useEditorSurfacePresentation.tsx` (529).
  - That file also renders the large-file notice (`.editor-large-file-notice`) and the Monaco options (`glyphMargin: true`, folding via `largeDocumentMonacoOptions`).
- **Monaco widgets.** Hover (marker hover already has "View Problem" / "Quick Fix..."), completion, references peek, rename and find are Monaco built-ins. They are styled in `App.css` 6575-6810. Gutter/decoration classes are at `App.css` 2471-2886, tabs at 4348-4485, breadcrumbs at 2383-2470. Palette Monaco themes come from P1: `paletteSyntaxThemes.ts` -> `buildShikiTheme` (`shikiHighlighter.ts:101`).
- **Large files.** `domain/largeDocumentPolicy.ts` (256 KB / 5,000 lines by default, configurable). JS/TS has a 6 MB hard limit in `javaScriptTypeScriptLargeDocumentCapability.ts`. `largeDocumentMonacoOptions` turns features off. `largeDocumentFeatureNotice` supplies the reason text.
- **Bottom panel.** `BottomPanel.tsx` (843).
  - Views: problems, index, runtime, history, terminal, debug, search, plus conditional routes, expressRoutes, packages, nette, symfony and testResults.
  - `viewScope="agent"` shows only Terminal, so in the agent layout Problems, Debug, Search, Tests and the others are unreachable today.
  - `renderActivePanel` (BottomPanel.tsx:643-843) is already a separate function.
  - State: `useWorkbenchController.ts:309-310` `bottomPanelView` / `bottomPanelVisible`. `showBottomPanelView` / `hideBottomPanel` / `toggleBottomPanel` are in `useTerminalTestRunner.ts:234-249`.
  - Mounted from `App.tsx:1082` via `WorkbenchBottomPanelHost` (38) + `workbenchBottomPanelHostPresenter.ts` (128).
- **Debug.** `DebugPanel.tsx` (1650) is a monolith with inline styles.
  - Toolbar (continue/pause/restart/step/stop/disconnect, launch selector, run-without-debugging, launch configurations), then call stack, variables, breakpoints (bulk actions, "Pause on exceptions" select `none|uncaught|all`, `ExceptionTypeFilter`, `FunctionBreakpoints`), then watches (`DebugWatchesPanel`), then the console (`DebugConsolePanel`), then `NodeDebugConfigurationPicker`.
  - Props: `DebugPanelProps` (lines 130-227), built by `useDebugPanelProps.ts` and wrapped by `usePrivateDebugPanelElement.tsx`. `useAppTestDebugPanels.ts` returns `debugPanel`.
  - Inline values: `useDebugInlineValueDecorations.ts`. Stopped line: `useDebugStoppedLineDecoration.ts`. Breakpoint glyphs: `useEditorBreakpointDecorations.ts`.
  - State: `DebuggerState` in `domain/debug.ts:250` (`inactive | starting | running | stopped | terminated`).
- **Status bar (P2 state).** P2 turns `StatusBar.tsx` (430) into a `.editor-status` group inside `WorkbenchToolbar` (editor-expanded only) and ships `useEditorStatusPresentation.ts` plus `statusBarRelocation.test.tsx`. Items: problems, branch, path, workspace info, IDE activity, node run + Stop, trust, mode, large file, cursor, language, unsaved, messages, visibility menu.
- **Editor-expanded layout.**
  - `AgentWorkbenchLayout.layout: "agent" | "editor-expanded"` with the actions `expandEditor` / `collapseEditor` / `toggleEditorExpanded`.
  - It is reachable only without an agent root lease gateway (tests) or through the perf bridge (`usePerfScenarioBridgeInstall.ts:53`).
  - Pieces used only there: `WorkbenchNavigationChrome` (activity bar + `WorkbenchSidebar` with the Files/Git/PHP/Scripts views), `ProjectTabs`, `WorkbenchToolbar` (IDE Mode switch, progress, index label, Trust, Collapse), `useAgentEditorCollapse.ts`, the `StatusBar` group.
- **Keyboard.** `domain/keymap.ts` (1497).
  - Defined: `debug.start` F5, `debug.stop` ⇧F5, `debug.stepOver` F10, `debug.stepInto` F11, `debug.stepOut` ⇧F11, `debug.restart` ⇧⌘F5, `editor.splitRight` ⌘\, `editor.gotoLine` Cmd+L.
  - `panel.showProblems` has no shortcut, and Cmd+Shift+M is free.
  - Cmd+F in the editor is Monaco's own action. `agent.findInThread` takes Cmd+F only while a thread has focus.
- **Hotspots.** `App.tsx` 7188 tokens (P2 lowers it), `useWorkbenchController.ts` 9874, `EditorSurface.tsx` 10301. No debug or bottom-panel file is tracked; the limit for untracked files is 2000 lines / 10000 tokens. `useDebugSession.ts` is at 1914 lines, so do not add to it.

## Key Decisions

1. **The editor is the `"editor"` surface kind.** Local-only (never served for remote threads), not in the add-surface menu (the strip's "+ Open file ⌘P" button and file-open intents reveal it), persisted like other non-transient kinds. The existing single `EditorRuntimeHost` stays in the frame `editor` slot and is overlaid on the kind's body. No new Monaco instance, no model duplication.
2. **Tabs through context, not a portal.** `EditorPanelDocumentsContext` is provided by `App.tsx` and consumed by `AgentSurfaceHost`, which passes P6's `editorDocuments` to `AgentSurfacePanel`. The value is memoized by structural equality, so a keystroke never changes it. The active group's tabs render in P6's strip. Non-active split groups keep inline tabs (`tabsPlacement="inline"`). `WorkbenchEditorTabsPortal*` is deleted.
3. **Maximize belongs to the frame.** It is P2's `AgentPanelWindowControls` ("Maximize panel" / "Restore panel") on `AgentWorkbenchLayout.rightPanelMaximized`. P7 renders no second maximize button. "Focus mode" means `rightPanelMaximized === true` with the editor kind active.
4. **One panel-view state, two hosts.** The controller keeps `bottomPanelView` + `bottomPanelVisible` unchanged. The pure `workbenchPanelPlacement(view, visible)` routes `"terminal"` to the frame bottom slot and every other view to the editor drawer. Showing a drawer view also reveals the editor surface. The drawer tabs are Problems, Debug console, the active secondary view (transient), and a "More views" menu for the rest (Search, Tests, Index, Runtime, History, Routes, Express routes, Packages, Nette, Symfony, PHP structure).
5. **Debug regions.** `DebugPanelProps` stays the one contract. New region components:
   - `DebugToolbarRegion`: the sub-header `.dbar` while a session exists.
   - `DebugSectionsRegion`: Variables, Watch, Call stack and Breakpoints, including exception rows and function breakpoints, in the 304px side column.
   - `DebugConsoleRegion`: the drawer "Debug console" tab, with the launch selector and clear button in the drawer header.
   `DebugPanel` stays as a compositor of the three for its existing tests.
6. **Debug focus policy.** The pure `editorDebugFocusReducer`:
   - maximizes once per debug session when the session starts and the panel is not maximized;
   - restores on session end only if P7 maximized and the layout was untouched since;
   - is keyed by workspace owner key.
   The side column is shown when the panel is maximized and either a session is not idle or the Debug console drawer view is open. So "Show debug views" (More menu, and the Debug console header button) is simply: open the Debug console, then maximize. No new command or toggle state is needed. With the panel docked, the toolbar and the console stay reachable, and breakpoint/watch management is one click away.
7. **Status items get new homes:**

   | Item | New home |
   |---|---|
   | Cursor position | Sub-header `pos` |
   | Problems counts | Sub-header `diag` button |
   | Active path | Folder crumbs |
   | IDE activity (index/LSP) | Sub-header activity indicator, visible only while not idle; click opens the Runtime view |
   | Node run-without-debugging | Sub-header run chip with Stop |
   | Transient messages | Foundation `Toast`, bottom-right of the editor panel |
   | Workspace info, language, trust, mode + IDE Mode toggle, large-file mode, unsaved count, git branch | "Editor status" section of the sub-header "More editor actions" menu |
   | Large-file reason | Stays as a quiet row under the sub-header |

   The `workspaceSettings.statusBar` visibility map keeps controlling the inline items (`cursorPosition`, `index` / `languageServer` for the activity indicator). P9 renames the settings copy to "Editor header items".
8. **Monaco widgets stay native and are restyled.** Hover (with its native "View Problem" and "Quick Fix..." actions), suggest, references peek, rename and find are restyled with tokens in `editorWidgets.css`, and theme colours are set in `buildShikiTheme`. The one addition is a "Rename F2" action in the peek header, done by a scoped DOM decorator that degrades to absent if Monaco's DOM changes. F2 keeps working.
9. **Editor-expanded removal.**
   - Removed: the `layout` field and its three actions, `WorkbenchNavigationChrome`, `WorkbenchActivityBar`, `WorkbenchSidebar`, `WorkbenchToolbar`, `StatusBar`, `useAgentEditorCollapse` and the `ProjectTabs` mount.
   - Each sidebar view gets a new home:

     | Former view or action | New home |
     |---|---|
     | Files | P6 Files surface |
     | Git | P6 Git surface |
     | Scripts | P6 Scripts surface |
     | PHP | Drawer view `phpTree` |
     | TODO | Existing overlay + Cmd+Shift+T |
     | Git history | P6 History surface + drawer History view |
     | Commands | Palette |
     | Settings | Sidebar footer |
     | Open workspace | P8 |

   - When no agent root lease gateway exists (unit tests only), the placement derives `layout: "editor-only"`. The editor slot then spans the frame with inline tabs. This is not a user-reachable mode.
10. **No `App.tsx` growth.** The panel host props move to `useWorkbenchPanelHostProps.ts`, the chrome value to `useEditorChromeValue.ts` and the debug regions to `useAppTestDebugPanels.ts`. The removed chrome (toolbar, status bar, project tabs, navigation chrome) makes `App.tsx` shrink. Lower the baseline with `npm run size:hotspots:update` only after it shrinks.

## Ownership (agreed with sibling planners)

- **P2 (app shell), agreed with the P2 planner:**
  - The frame state is `AgentWorkbenchLayout` in `src/domain/agentWorkbenchLayout.ts`: `rightPanel`, `rightPanelWidth` (360-1200, per workspace owner), `rightPanelMaximized` (reset when the panel closes; per workspace owner).
  - Actions: `toggleMaximized`, `maximizeRightPanel`, `toggleRightPanel`, `resizeRightPanel`. UI: `useAgentSurfaceLayout()` (`toggleMaximized`, `toggleRightPanel`, `resizeRightPanel`).
  - The placement attribute is `data-right-panel="docked|overlay|maximized"` on `.workbench-frame`.
  - When the panel is maximized, the conversation column collapses to width 0 with `visibility: hidden` and `inert`, but stays mounted.
  - The panel top bar is P2's `<TopBar region="panel">`, and its trailing slot is P2's `AgentPanelWindowControls` ("Maximize panel" / "Restore panel", "Close panel"). P7 renders no maximize button.
  - After P2, P7 owns `StatusBar.tsx`, the `.editor-status` rules, `WorkbenchToolbar.tsx` and `src/components/statusBarRelocation.test.tsx`. P7 deletes the first three and rewrites the inventory test to the new homes.
  - P7 does not touch `TopBar.tsx`, `AgentPanelLayoutControls.tsx`, `useAgentSurfaceLayout.ts` or the sidebar/top-bar files.
  - P7 edits `workbenchShellFrame.css` only in the `[data-slot="editor"]` and `[data-layout="editor-expanded"]` rules, and `workbenchShellPlacement.ts` only for the layout derivation (Task 13).
- **P6 (right panel), agreed with the P6 planner:**
  - P6 owns the surface union, `AGENT_RIGHT_PANEL_SURFACE_CATALOG` (`src/components/agentMode/rightPanel/agentRightPanelSurfaceCatalog.ts`), the strip `AgentRightPanelTabStrip`, the presenter `agentRightPanelTabEntries` (it already has the `editorDocument` entry variant) and the body switch `AgentRightPanelSurfaceBody.tsx`.
  - P7 adds exactly:
    - one `"editor"` union entry;
    - one catalog entry;
    - one body case;
    - the compiler-flagged exhaustive-switch cases (`agentSurfaceMask`, `agentSurfaceServes`, and so on);
    - the value for `AgentSurfacePanel`'s optional `editorDocuments?: AgentRightPanelEditorDocuments | null`, from `AgentSurfaceHost`;
    - the move of `agentSurfaceEditorSlot` to the editor kind;
    - the deletion of `WorkbenchEditorTabsPortalTarget`;
    - removal of the editor slot from P6's `AgentFilesSurface` (the tree then fills the surface).
  - P7 reroutes the existing callbacks `onPreviewFile`, `onOpenFile`, `agents.openChangedFile`, `openChangedFileDiff` and the project diff `onOpenChange` to open and reveal the editor kind. It does not edit P6's diff, git, scripts, PR or terminal files.
  - P6 owns `TerminalTabsPanel.tsx` and `terminalTabSet.ts`. P7 owns `TerminalPanel.tsx`, `BottomPanel.tsx`, `GitDiffPreview.tsx` and all Monaco/editor files.
- **P5 (palette), agreed:**
  - Every palette file open goes through `openPaletteFile(workbench, result, location?)` in `src/components/commandPalette/WorkbenchCommandPalette.tsx`. P7 adds one hunk there: after `await workbench.openSearchResult(result, location);` it reveals the editor surface.
  - P7's `panel.showProblems` (⇧⌘M) appears in the palette through the command registry, with no P5 work. The earlier `debug.toggleViews` idea was dropped: the existing `debug.openPanel` plus P5's `panel.toggleMaximized` cover it, and P5 was told.
- **P9 (settings), agreed:** P9 renames the `general.statusBar` row copy to "Editor header items" / "Choose which readouts the editor header shows." in `settingsRegistryRows.ts` and `GeneralStatusBarRows.tsx`. P7 does not touch those files.
- **P3, P4, P8:** no shared files. P7 does not edit `AgentModeView.tsx`, `AgentThreadSession.tsx`, `AgentThreadHeader.tsx` or `AgentWorkbenchScreen.tsx`, except one reveal-helper hunk in `AgentWorkbenchScreen.tsx` (Task 8). P7 renames `revealFilesSurface` to `revealEditorSurface` and makes it dispatch `openSurface("editor")`. P2's plan lists `AgentWorkbenchScreen.tsx` as modified by P2 and P6, and P7 lands after both.

### Files P7 creates

| Path | Responsibility |
|---|---|
| `src/domain/editorDrawer.ts` (+ test) | `EditorDrawerView`, `workbenchPanelPlacement`, drawer tabs, "More views", labels. |
| `src/domain/editorDebugFocus.ts` (+ test) | Debug focus reducer (auto-maximize / restore) and debug-views placement. |
| `src/domain/debugExceptionRows.ts` (+ test) | Exception rows <-> `DebugExceptionPauseMode`. |
| `src/domain/editorBreadcrumbSegments.ts` (+ test) | Bounded workspace-relative path crumbs. |
| `src/components/editorPanel/editorPanelDocuments.ts` (+ test) | Pure strip entries from editor group state; structural equality. |
| `src/components/editorPanel/EditorPanelDocumentsContext.ts` | Context + `useEditorPanelDocumentsValue` hook. |
| `src/components/editorPanel/EditorSurfaceSlot.tsx` | Body placeholder for the `"editor"` kind. |
| `src/components/editorPanel/EditorChromeContext.ts` | `EditorChrome` value type + context + `useEditorChrome`. |
| `src/components/editorPanel/useEditorChromeValue.ts` (+ test) | Builds the chrome value from the workbench (keeps `App.tsx` flat). |
| `src/components/editorPanel/EditorSubheader.tsx` (+ test) | 40px sub-header: path crumbs, symbol crumbs, actions or debug bar. |
| `src/components/editorPanel/EditorPathCrumbs.tsx` | Folder/file crumbs. |
| `src/components/editorPanel/EditorSubheaderActions.tsx` (+ test) | pos, diag, activity, run chip, find, split, more. |
| `src/components/editorPanel/EditorCursorPosition.tsx` | Cursor store readout (moved from `StatusBar.tsx`). |
| `src/components/editorPanel/EditorMoreMenu.tsx` (+ test) | "More editor actions": debug entries, split down, Editor status section. |
| `src/components/editorPanel/EditorPanelLayout.tsx` (+ test) | Column (editor area + drawer) + debug side column + message toast. |
| `src/components/editorPanel/EditorDrawer.tsx` (+ test) | Drawer header (tabs, filter/launch slot, close) + view body. |
| `src/components/editorPanel/useEditorSurfaceReveal.ts` (+ test) | `revealEditorSurface` + drawer-intent reveal coordinator. |
| `src/components/editorPanel/useEditorDebugFocus.ts` (+ test) | Dispatches the debug focus reducer's effects. |
| `src/components/editorPanel/editorPanel.css` | Sub-header, crumbs, actions, drawer, side column, layout. |
| `src/components/editorPanel/editorGutter.css` | Gutter, breakpoints, git markers, folds, paused line, inline values. |
| `src/components/editorPanel/editorWidgets.css` | Monaco hover, suggest, peek, rename, find, menus. |
| `src/components/editorPanel/editorPanelStyles.test.ts` | Style contract (sizes, tokens only, no legacy selectors). |
| `src/components/editorPanel/referencesPeekRename.ts` (+ test) | Peek header "Rename F2" DOM decorator. |
| `src/components/workbenchPanelViews.tsx` | `WorkbenchPanelViewContent` (moved from `BottomPanel.renderActivePanel`). |
| `src/components/useWorkbenchPanelHostProps.ts` | Shared panel host props for the terminal bottom slot and the drawer. |
| `src/components/debug/DebugToolbarRegion.tsx` (+ test) | `.dbar` toolbar. |
| `src/components/debug/DebugSectionsRegion.tsx` (+ test) | Variables / Watch / Call stack / Breakpoints sections. |
| `src/components/debug/DebugSection.tsx` | Collapsible section header (`.dsh`). |
| `src/components/debug/DebugCallStack.tsx` | `CallStack` moved out of `DebugPanel.tsx`. |
| `src/components/debug/DebugBreakpoints.tsx` | `Breakpoints` + condition/hit/log inputs moved out of `DebugPanel.tsx`. |
| `src/components/debug/DebugExceptionRows.tsx` | Two exception rows. |
| `src/components/debug/DebugConsoleRegion.tsx` (+ test) | Console body for the drawer, header actions. |
| `src/components/debug/debugPanelStatus.ts` (+ test) | `debuggerStatusLabel` moved out, plus `debugSessionPhase`. |
| `src/components/debug/debug.css` | Debug region styles (replaces inline `styles` objects). |

### Files P7 modifies

- `src/domain/agentWorkbenchLayout.ts` (+ test)
- `src/domain/agentSurfaceActivation.ts` (+ test)
- `src/domain/keymap.ts` (+ test)
- `src/domain/artisanRoutes.ts` (only `WorkbenchBottomPanelView`)
- `src/domain/bottomPanel.ts`
- `src/application/useAgentWorkbenchLayout.ts` (+ test)
- `src/application/workbenchPanelCommands.ts`
- `src/application/workbenchDebugCommands.ts`
- `src/application/workbenchAgentCommands.ts` (+ test)
- `src/App.tsx`
- `src/App.css`: only removing the editor/tab/breadcrumb/gutter/widget/bottom-panel/problems/status rules listed per task
- `src/App.commandRouting.test.tsx`, `src/App.dockedTextSearch.integration.test.tsx`, `src/App.gitDiffBoundary.test.tsx`, `src/App.gitDiffClick.test.tsx`, `src/App.quickOpen.integration.test.tsx`
- `src/components/EditorSurface.tsx`: prop pass-through only; must shrink or stay flat
- `src/components/editorSurfaceCore/useEditorSurfacePresentation.tsx`
- `src/components/EditorGroupView.tsx` (+ test)
- `src/components/EditorArea.tsx`
- `src/components/EditorTabs.tsx` (+ test)
- `src/components/WorkbenchEditorHost.tsx` (+ test)
- `src/components/workbenchEditorHostPresenter.ts` (+ test)
- `src/components/CursorAwareBreadcrumbs.tsx`, `src/components/Breadcrumbs.tsx` (+ tests)
- `src/components/BottomPanel.tsx` (+ test)
- `src/components/WorkbenchBottomPanelHost.tsx`
- `src/components/workbenchBottomPanelHostPresenter.ts` (+ test)
- `src/components/ProblemsPanel.tsx` (+ test)
- `src/components/DebugPanel.tsx` (+ tests)
- `src/components/DebugConsolePanel.tsx`, `src/components/DebugVariableTree.tsx`, `src/components/DebugWatchesPanel.tsx`: class names only, inline styles -> `debug.css`
- `src/components/usePrivateDebugPanelElement.tsx` (+ test)
- `src/components/useAppTestDebugPanels.ts`
- `src/components/TerminalPanel.tsx`: tokens only
- `src/components/GitDiffPreview.tsx`: tokens only
- `src/components/WorkbenchShellFrame.tsx` (+ test)
- `src/components/workbenchShellFrame.css`: editor slot rules only
- `src/components/workbenchShellPlacement.ts` (+ test)
- `src/components/usePerfScenarioBridgeInstall.ts` (+ test)
- `src/components/statusBarRelocation.test.tsx`
- `src/infrastructure/shikiHighlighter.ts` (+ test): `buildShikiTheme` widget colours only
- `src/components/agentMode/rightPanel/agentRightPanelSurfaceCatalog.ts`, `AgentRightPanelSurfaceBody.tsx`
- `src/components/agentMode/AgentSurfaceHost.tsx`: one context read
- `src/components/agentMode/AgentSurfacePanel.tsx`: portal target removal
- `src/components/agentMode/rightPanel/files/AgentFilesSurface.tsx`: editor slot removal
- `src/components/agentMode/AgentWorkbenchScreen.tsx`: reveal helper rename
- `src/components/commandPalette/WorkbenchCommandPalette.tsx`: one reveal line
- `scripts/hotspot-size-baseline.json`: lowered only

### Files P7 deletes

Each file is deleted only after `rg` shows no remaining importer.

- `src/components/workbenchEditorTabsPortal.tsx`, `src/components/workbenchEditorTabsPortalContext.ts`
- `src/components/WorkbenchNavigationChrome.tsx`, `src/components/WorkbenchActivityBar.tsx`, `src/components/WorkbenchSidebar.tsx` (+ `WorkbenchSidebar.nodePackageScripts.test.ts`, whose assertions move to P6's Scripts surface tests only if they are not already covered there; otherwise keep the file and report it)
- `src/components/WorkbenchToolbar.tsx` (+ test)
- `src/components/StatusBar.tsx` (+ `StatusBar.test.tsx`, `StatusBar.cursorStore.test.tsx`; their cursor-store assertions move to `EditorSubheaderActions.test.tsx`)
- `src/application/useAgentEditorCollapse.ts`

`ProjectTabs.tsx` stays only if `rg` finds another importer after the `App.tsx` mount is removed; otherwise it is deleted together with its test.

## Execution Order and Streams

P7 starts after P6 is committed to `main` (P6 depends on P2). Streams run in parallel with disjoint write scopes. Shared files (`App.tsx`, `AgentSurfaceHost.tsx`, `EditorSurface.tsx`, `useEditorSurfacePresentation.tsx`, `workbenchShellFrame.css`, `App.css`) are changed only in each task's final **Integration** step. The lead applies those steps one at a time in task-number order and reruns that task's focused tests after each.

| Stream | Tasks | Write scope |
|---|---|---|
| A - pure policies | 1, 2, 3, 4 (parallel) | `src/domain/*` listed above, `editorPanelDocuments.ts`, surface catalog/body |
| B - editor chrome | 5 -> 6 | `src/components/editorPanel/EditorSubheader*`, `EditorPathCrumbs`, `EditorCursorPosition`, `EditorMoreMenu`, `EditorChromeContext`, `useEditorChromeValue`, breadcrumbs |
| C - panel integration | 7 -> 8 (needs 1, 4) | strip context, `EditorGroupView`, `EditorArea`, portal removal, slot CSS, reveal |
| D - drawer | 9 (needs 2) | `workbenchPanelViews.tsx`, `EditorDrawer`, `EditorPanelLayout`, `BottomPanel`, `ProblemsPanel`, `useWorkbenchPanelHostProps`, keymap |
| E - debug | 10 (needs 3, 5, 9) | `src/components/debug/**`, `DebugPanel.tsx`, debug component class names, `useEditorDebugFocus` |
| F - look | 11, 12 (parallel, need 5) | `editorGutter.css`, `editorWidgets.css`, `shikiHighlighter.ts`, Monaco options hunk, peek decorator |
| G - removal | 13 (needs 6-10) | editor-expanded removal, dead chrome, App tests, perf bridge, relocation inventory |
| Wrap-up (lead) | 14 perf -> 15 gates -> 16 review -> 17 QA -> 18 commit | - |

---

### Task 1: The `"editor"` surface kind (domain, activation, catalog, body)

**Files:**
- Modify: `src/domain/agentWorkbenchLayout.ts`, `src/domain/agentWorkbenchLayout.test.ts`
- Modify: `src/domain/agentSurfaceActivation.ts`, `src/domain/agentSurfaceActivation.test.ts`
- Modify: `src/components/agentMode/rightPanel/agentRightPanelSurfaceCatalog.ts`
- Modify: `src/components/agentMode/rightPanel/AgentRightPanelSurfaceBody.tsx`
- Modify: every exhaustive switch or record that `npm run check` flags after the union changes (for example `agentSurfaceMask` in `src/components/agentMode/AgentSurfacePanel.tsx`, `agentSurfaceHotkeys.ts`)
- Create: `src/components/editorPanel/EditorSurfaceSlot.tsx`

**Interfaces:**
- Consumes (P6): `AGENT_SURFACE_KINDS`, `AGENT_TRANSIENT_SURFACE_KINDS`, `AGENT_RIGHT_PANEL_SURFACE_CATALOG: Readonly<Record<AgentSurfaceKind, AgentRightPanelSurfaceDescriptor>>` where `AgentRightPanelSurfaceDescriptor = { label: string; icon: LucideIcon; addMenuShortcut: string | null }`, and the body switch in `AgentRightPanelSurfaceBody.tsx`.
- Produces:
  - `AgentSurfaceKind` now includes `"editor"` (persisted, not transient).
  - `agentSurfaceServes(activation, "editor") === !activation.remote`.
  - `agentSurfaceEditorSlot(activation, activeSurface)` is `"open"` only for an effective `"editor"` surface.
  - `EditorSurfaceSlot(): JSX.Element` renders `<div className="cv-editor-slot" data-editor-slot="open" />`.

- [ ] **Step 1: Write the failing domain tests**

Append to `src/domain/agentWorkbenchLayout.test.ts`:

```ts
describe("editor surface kind", () => {
  it("opens the editor surface in the right panel and makes it active", () => {
    const next = agentWorkbenchLayoutReducer(initialAgentWorkbenchLayout, {
      kind: "openSurface",
      surface: "editor",
    });

    expect(next.rightPanel).toBe("open");
    expect(next.activeSurface).toBe("editor");
    expect(next.openSurfaces).toContain("editor");
  });

  it("persists and restores the editor surface", () => {
    const opened = agentWorkbenchLayoutReducer(initialAgentWorkbenchLayout, {
      kind: "openSurface",
      surface: "editor",
    });
    const restored = parseAgentWorkbenchLayout(
      JSON.parse(JSON.stringify(serializeAgentWorkbenchLayout(opened, false))),
    );

    expect(restored.openSurfaces).toContain("editor");
    expect(restored.activeSurface).toBe("editor");
  });

  it("closing the editor tab keeps a neighbour active and drops maximize when nothing is left", () => {
    const maximized = agentWorkbenchLayoutReducer(
      agentWorkbenchLayoutReducer(initialAgentWorkbenchLayout, {
        kind: "openSurface",
        surface: "editor",
      }),
      { kind: "maximizeRightPanel" },
    );
    const closed = agentWorkbenchLayoutReducer(maximized, {
      kind: "closeSurfaceTab",
      surface: "editor",
    });

    expect(closed.openSurfaces).not.toContain("editor");
    expect(closed.rightPanelMaximized).toBe(false);
  });
});
```

Append to `src/domain/agentSurfaceActivation.test.ts`:

```ts
describe("editor surface activation", () => {
  const remoteWithEverything: AgentSurfaceActivation = {
    remote: true,
    threadPresent: true,
    remoteCapabilities: { files: true, history: true, terminal: true },
    unavailable: false,
    hidden: false,
  };

  it("serves the editor only for local threads", () => {
    expect(agentSurfaceServes(LOCAL_AGENT_SURFACE_ACTIVATION, "editor")).toBe(true);
    expect(agentSurfaceServes(remoteWithEverything, "editor")).toBe(false);
  });

  it("opens the editor slot only for the editor kind", () => {
    expect(agentSurfaceEditorSlot(LOCAL_AGENT_SURFACE_ACTIVATION, "editor")).toBe("open");
    expect(agentSurfaceEditorSlot(LOCAL_AGENT_SURFACE_ACTIVATION, "files")).toBe("none");
    expect(agentSurfaceEditorSlot(LOCAL_AGENT_SURFACE_ACTIVATION, null)).toBe("none");
    expect(agentSurfaceEditorSlot(remoteWithEverything, "editor")).toBe("none");
  });
});
```

If P6 extended `RemoteSurfaceCapabilities` with more keys, add them to `remoteWithEverything` with the value `true`. The assertion must hold even when every remote capability is open.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/domain/agentWorkbenchLayout.test.ts src/domain/agentSurfaceActivation.test.ts`
Expected: FAIL. TypeScript/Vitest reports `"editor"` is not assignable to `AgentSurfaceKind`, and `agentSurfaceEditorSlot(..., "editor")` returns `"none"`.

- [ ] **Step 3: Add the kind and the activation rules**

In `src/domain/agentWorkbenchLayout.ts`, append `"editor"` as the last element of `AGENT_SURFACE_KINDS` (after P6's `"agents"`). Do not add it to `AGENT_TRANSIENT_SURFACE_KINDS`.

In `src/domain/agentSurfaceActivation.ts`:
- Add `| "editor"` to the `Exclude<AgentSurfaceKind, ...>` of `AgentRemoteSurfaceKind`.
- Make `agentSurfaceServes` start with the editor rule.
- Change the slot rule:

```ts
export function agentSurfaceServes(
  activation: AgentSurfaceActivation,
  kind: AgentSurfaceKind,
): boolean {
  if (kind === "editor") return !activation.remote;
  if (!activation.remote) return true;
  if (kind === "diff") return activation.threadPresent;
  return remoteSurfaceCapabilityOpen(activation.remoteCapabilities, kind);
}

export function agentSurfaceEditorSlot(
  activation: AgentSurfaceActivation,
  activeSurface: AgentSurfaceKind | null,
): AgentSurfaceEditorSlot {
  if (activation.hidden) return "none";
  if (activation.unavailable) return "none";
  if (activation.remote) return "none";
  if (effectiveAgentSurface(activation, activeSurface) !== "editor") return "none";
  return "open";
}
```

Keep any P6 branches that sit between the `remote` check and the capability lookup (for example `git`, `scripts`, `pullRequest`, `agents`) exactly where P6 put them. Only the first line and the `"editor"` comparison change.

- [ ] **Step 4: Create the slot placeholder and register the kind**

Create `src/components/editorPanel/EditorSurfaceSlot.tsx`:

```tsx
export function EditorSurfaceSlot() {
  return <div className="cv-editor-slot" data-editor-slot="open" />;
}
```

In `agentRightPanelSurfaceCatalog.ts`, add the entry (import `FileCode2` from `lucide-react`):

```ts
  editor: { label: "Editor", icon: FileCode2, addMenuShortcut: null },
```

If the catalog file has an add-menu order array, do not add `"editor"` to it. The strip's "+ Open file ⌘P" button is the entry point.

In `AgentRightPanelSurfaceBody.tsx`, add to the exhaustive switch:

```tsx
    case "editor":
      return <EditorSurfaceSlot />;
```

Run `npm run check`. For every exhaustive switch or `Record<AgentSurfaceKind, ...>` it reports, add the `"editor"` case using these rules:
- `agentSurfaceMask`: the next free bit (`1 << n`).
- Hotkey tables: no hotkey (`null`).
- Remote capability lookups: unreachable, because `agentSurfaceServes` returns early.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/domain/agentWorkbenchLayout.test.ts src/domain/agentSurfaceActivation.test.ts src/components/agentMode && npm run check`
Expected: PASS, and `tsc --noEmit` reports 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/domain/agentWorkbenchLayout.ts src/domain/agentWorkbenchLayout.test.ts src/domain/agentSurfaceActivation.ts src/domain/agentSurfaceActivation.test.ts src/components/editorPanel/EditorSurfaceSlot.tsx src/components/agentMode
git commit -m "feat(editor): add the editor right-panel surface kind"
```

---

### Task 2: Drawer placement and tabs policy (`editorDrawer.ts`)

**Files:**
- Modify: `src/domain/artisanRoutes.ts` (`WorkbenchBottomPanelView` gains `"phpTree"`)
- Modify: `src/domain/bottomPanel.ts` (no behaviour change; labels move)
- Create: `src/domain/editorDrawer.ts`, `src/domain/editorDrawer.test.ts`

**Interfaces:**
- Produces:
  - `type EditorDrawerView = Exclude<WorkbenchBottomPanelView, "terminal">`
  - `interface WorkbenchPanelPlacement { readonly terminal: boolean; readonly drawer: EditorDrawerView | null }`
  - `workbenchPanelPlacement(view: WorkbenchBottomPanelView, visible: boolean): WorkbenchPanelPlacement`
  - `interface EditorDrawerAvailability { readonly artisan: boolean; readonly expressRoutes: boolean; readonly javaScriptWorkspace: boolean; readonly nette: boolean; readonly symfony: boolean; readonly phpWorkspace: boolean }`
  - `interface EditorDrawerTab { readonly view: EditorDrawerView; readonly label: string; readonly transient: boolean }`
  - `editorDrawerTabs(active: EditorDrawerView, availability: EditorDrawerAvailability): ReadonlyArray<EditorDrawerTab>`
  - `editorDrawerMoreViews(availability: EditorDrawerAvailability): ReadonlyArray<EditorDrawerTab>`
  - `editorDrawerViewLabel(view: EditorDrawerView): string`
  - `editorDrawerViewAvailable(view: EditorDrawerView, availability: EditorDrawerAvailability): boolean`

- [ ] **Step 1: Write the failing test**

Create `src/domain/editorDrawer.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  editorDrawerMoreViews,
  editorDrawerTabs,
  editorDrawerViewAvailable,
  editorDrawerViewLabel,
  workbenchPanelPlacement,
  type EditorDrawerAvailability,
} from "./editorDrawer";

const NOTHING: EditorDrawerAvailability = {
  artisan: false,
  expressRoutes: false,
  javaScriptWorkspace: false,
  nette: false,
  symfony: false,
  phpWorkspace: false,
};

const JS: EditorDrawerAvailability = { ...NOTHING, expressRoutes: true, javaScriptWorkspace: true };

describe("workbenchPanelPlacement", () => {
  it("routes the terminal to the bottom slot and every other view to the drawer", () => {
    expect(workbenchPanelPlacement("terminal", true)).toEqual({ terminal: true, drawer: null });
    expect(workbenchPanelPlacement("problems", true)).toEqual({ terminal: false, drawer: "problems" });
    expect(workbenchPanelPlacement("debug", true)).toEqual({ terminal: false, drawer: "debug" });
  });

  it("shows nothing while the panel is hidden", () => {
    expect(workbenchPanelPlacement("terminal", false)).toEqual({ terminal: false, drawer: null });
    expect(workbenchPanelPlacement("problems", false)).toEqual({ terminal: false, drawer: null });
  });
});

describe("editorDrawerTabs", () => {
  it("always shows Problems and Debug console, in that order", () => {
    expect(editorDrawerTabs("problems", NOTHING).map((tab) => tab.label)).toEqual([
      "Problems",
      "Debug console",
    ]);
  });

  it("adds the active secondary view as a transient third tab", () => {
    const tabs = editorDrawerTabs("search", JS);

    expect(tabs.map((tab) => [tab.view, tab.transient])).toEqual([
      ["problems", false],
      ["debug", false],
      ["search", true],
    ]);
  });

  it("falls back to Problems when the active view is not available in this workspace", () => {
    expect(editorDrawerTabs("symfony", NOTHING).map((tab) => tab.view)).toEqual([
      "problems",
      "debug",
    ]);
  });
});

describe("editorDrawerMoreViews", () => {
  it("lists the always-available secondary views for a plain workspace", () => {
    expect(editorDrawerMoreViews(NOTHING).map((tab) => tab.view)).toEqual([
      "search",
      "index",
      "runtime",
      "history",
    ]);
  });

  it("adds framework and test views by availability", () => {
    expect(editorDrawerMoreViews(JS).map((tab) => tab.view)).toEqual([
      "search",
      "testResults",
      "index",
      "runtime",
      "history",
      "expressRoutes",
      "packages",
    ]);
    expect(
      editorDrawerMoreViews({ ...NOTHING, artisan: true, phpWorkspace: true }).map(
        (tab) => tab.view,
      ),
    ).toEqual(["search", "testResults", "index", "runtime", "history", "routes", "phpTree"]);
  });
});

describe("editorDrawerViewLabel", () => {
  it("names every view the way the old bottom panel did, with the new console and PHP labels", () => {
    expect(editorDrawerViewLabel("debug")).toBe("Debug console");
    expect(editorDrawerViewLabel("testResults")).toBe("Tests");
    expect(editorDrawerViewLabel("routes")).toBe("Routes");
    expect(editorDrawerViewLabel("expressRoutes")).toBe("Express routes");
    expect(editorDrawerViewLabel("phpTree")).toBe("PHP structure");
  });

  it("treats Problems and Debug console as always available", () => {
    expect(editorDrawerViewAvailable("problems", NOTHING)).toBe(true);
    expect(editorDrawerViewAvailable("debug", NOTHING)).toBe(true);
    expect(editorDrawerViewAvailable("nette", NOTHING)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/domain/editorDrawer.test.ts`
Expected: FAIL with `Failed to resolve import "./editorDrawer"`.

- [ ] **Step 3: Implement**

In `src/domain/artisanRoutes.ts`, change the union to:

```ts
export type WorkbenchBottomPanelView = BottomPanelView | "routes" | "testResults" | "phpTree";
```

Create `src/domain/editorDrawer.ts`:

```ts
import type { WorkbenchBottomPanelView } from "./artisanRoutes";

export type EditorDrawerView = Exclude<WorkbenchBottomPanelView, "terminal">;

export interface WorkbenchPanelPlacement {
  readonly terminal: boolean;
  readonly drawer: EditorDrawerView | null;
}

export interface EditorDrawerAvailability {
  readonly artisan: boolean;
  readonly expressRoutes: boolean;
  readonly javaScriptWorkspace: boolean;
  readonly nette: boolean;
  readonly symfony: boolean;
  readonly phpWorkspace: boolean;
}

export interface EditorDrawerTab {
  readonly view: EditorDrawerView;
  readonly label: string;
  readonly transient: boolean;
}

const HIDDEN: WorkbenchPanelPlacement = Object.freeze({ terminal: false, drawer: null });
const TERMINAL: WorkbenchPanelPlacement = Object.freeze({ terminal: true, drawer: null });
const PRIMARY_VIEWS: ReadonlyArray<EditorDrawerView> = ["problems", "debug"];
const SECONDARY_VIEWS: ReadonlyArray<EditorDrawerView> = [
  "search",
  "testResults",
  "index",
  "runtime",
  "history",
  "routes",
  "expressRoutes",
  "packages",
  "nette",
  "symfony",
  "phpTree",
];

export function workbenchPanelPlacement(
  view: WorkbenchBottomPanelView,
  visible: boolean,
): WorkbenchPanelPlacement {
  if (!visible) return HIDDEN;
  if (view === "terminal") return TERMINAL;
  return { terminal: false, drawer: view };
}

export function editorDrawerViewLabel(view: EditorDrawerView): string {
  switch (view) {
    case "problems":
      return "Problems";
    case "debug":
      return "Debug console";
    case "search":
      return "Search";
    case "testResults":
      return "Tests";
    case "index":
      return "Index";
    case "runtime":
      return "Runtime";
    case "history":
      return "History";
    case "routes":
      return "Routes";
    case "expressRoutes":
      return "Express routes";
    case "packages":
      return "Packages";
    case "nette":
      return "Nette";
    case "symfony":
      return "Symfony";
    case "phpTree":
      return "PHP structure";
    default:
      return unsupportedDrawerView(view);
  }
}

export function editorDrawerViewAvailable(
  view: EditorDrawerView,
  availability: EditorDrawerAvailability,
): boolean {
  switch (view) {
    case "problems":
    case "debug":
    case "search":
    case "index":
    case "runtime":
    case "history":
      return true;
    case "testResults":
      return availability.artisan || availability.phpWorkspace || availability.javaScriptWorkspace;
    case "routes":
      return availability.artisan;
    case "expressRoutes":
      return availability.expressRoutes;
    case "packages":
      return availability.javaScriptWorkspace;
    case "nette":
      return availability.nette;
    case "symfony":
      return availability.symfony;
    case "phpTree":
      return availability.phpWorkspace;
    default:
      return unsupportedDrawerView(view);
  }
}

export function editorDrawerTabs(
  active: EditorDrawerView,
  availability: EditorDrawerAvailability,
): ReadonlyArray<EditorDrawerTab> {
  const primary = PRIMARY_VIEWS.map((view) => drawerTab(view, false));
  if (PRIMARY_VIEWS.includes(active)) return primary;
  if (!editorDrawerViewAvailable(active, availability)) return primary;
  return [...primary, drawerTab(active, true)];
}

export function editorDrawerMoreViews(
  availability: EditorDrawerAvailability,
): ReadonlyArray<EditorDrawerTab> {
  return SECONDARY_VIEWS.filter((view) => editorDrawerViewAvailable(view, availability)).map(
    (view) => drawerTab(view, false),
  );
}

function drawerTab(view: EditorDrawerView, transient: boolean): EditorDrawerTab {
  return { view, label: editorDrawerViewLabel(view), transient };
}

function unsupportedDrawerView(view: never): never {
  throw new TypeError(`Unsupported editor drawer view: ${String(view)}.`);
}
```

Run `npm run check`. Any exhaustive switch over `WorkbenchBottomPanelView` that now misses `"phpTree"` (for example in `BottomPanel.tsx` or `workbenchBottomPanelHostPresenter.ts`) gets a `"phpTree"` branch that renders nothing until Task 9 wires `PhpTreePanel`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/domain/editorDrawer.test.ts && npm run check`
Expected: PASS, 0 type errors.

- [ ] **Step 5: Commit**

```bash
git add src/domain/editorDrawer.ts src/domain/editorDrawer.test.ts src/domain/artisanRoutes.ts src/domain/bottomPanel.ts
git commit -m "feat(editor): add the drawer placement and tab policy"
```

---

### Task 3: Debug focus policy and exception rows (pure)

**Files:**
- Create: `src/domain/editorDebugFocus.ts`, `src/domain/editorDebugFocus.test.ts`
- Create: `src/domain/debugExceptionRows.ts`, `src/domain/debugExceptionRows.test.ts`

**Interfaces:**
- Produces:
  - `type DebugSessionPhase = "idle" | "active"`
  - `interface EditorDebugFocusState { readonly ownerKey: string | null; readonly sessionId: number | null; readonly maximizedByDebug: boolean; readonly layoutTouched: boolean }`
  - `type EditorDebugFocusEvent = { kind: "owner"; ownerKey: string | null } | { kind: "session"; sessionId: number | null; maximized: boolean } | { kind: "layoutChanged" }`
  - `type EditorDebugFocusEffect = "none" | "maximize" | "restore"`
  - `initialEditorDebugFocusState: EditorDebugFocusState`
  - `editorDebugFocusReducer(state, event): { readonly state: EditorDebugFocusState; readonly effect: EditorDebugFocusEffect }`
  - `debugViewsPlacement(input: { maximized: boolean; phase: DebugSessionPhase; drawerView: EditorDrawerView | null }): "side" | "hidden"`
  - `type DebugExceptionRowId = "all" | "uncaught"`
  - `interface DebugExceptionRow { readonly id: DebugExceptionRowId; readonly label: string; readonly checked: boolean; readonly implied: boolean }`
  - `debugExceptionRows(mode: DebugExceptionPauseMode): ReadonlyArray<DebugExceptionRow>`
  - `nextExceptionPauseMode(mode: DebugExceptionPauseMode, row: DebugExceptionRowId): DebugExceptionPauseMode`

- [ ] **Step 1: Write the failing tests**

Create `src/domain/editorDebugFocus.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  debugViewsPlacement,
  editorDebugFocusReducer,
  initialEditorDebugFocusState,
  type EditorDebugFocusEvent,
  type EditorDebugFocusState,
} from "./editorDebugFocus";

function run(events: ReadonlyArray<EditorDebugFocusEvent>) {
  let state: EditorDebugFocusState = initialEditorDebugFocusState;
  const effects: string[] = [];
  for (const event of events) {
    const step = editorDebugFocusReducer(state, event);
    state = step.state;
    effects.push(step.effect);
  }
  return { state, effects };
}

describe("editorDebugFocusReducer", () => {
  it("maximizes once when a session starts in a docked panel and restores when it ends", () => {
    const { effects } = run([
      { kind: "owner", ownerKey: "/a" },
      { kind: "session", sessionId: 7, maximized: false },
      { kind: "session", sessionId: 7, maximized: true },
      { kind: "session", sessionId: null, maximized: true },
    ]);

    expect(effects).toEqual(["none", "maximize", "none", "restore"]);
  });

  it("does nothing when the panel was already maximized", () => {
    const { effects } = run([
      { kind: "owner", ownerKey: "/a" },
      { kind: "session", sessionId: 7, maximized: true },
      { kind: "session", sessionId: null, maximized: true },
    ]);

    expect(effects).toEqual(["none", "none", "none"]);
  });

  it("never re-maximizes a session the user restored and never restores after a manual change", () => {
    const { effects } = run([
      { kind: "owner", ownerKey: "/a" },
      { kind: "session", sessionId: 7, maximized: false },
      { kind: "layoutChanged" },
      { kind: "session", sessionId: 7, maximized: false },
      { kind: "session", sessionId: null, maximized: false },
    ]);

    expect(effects).toEqual(["none", "maximize", "none", "none", "none"]);
  });

  it("drops a pending restore when the workspace changes (A -> B -> A)", () => {
    const { effects, state } = run([
      { kind: "owner", ownerKey: "/a" },
      { kind: "session", sessionId: 7, maximized: false },
      { kind: "owner", ownerKey: "/b" },
      { kind: "session", sessionId: null, maximized: true },
      { kind: "owner", ownerKey: "/a" },
      { kind: "session", sessionId: null, maximized: true },
    ]);

    expect(effects).toEqual(["none", "maximize", "none", "none", "none", "none"]);
    expect(state.maximizedByDebug).toBe(false);
  });

  it("treats a new session id as a new session", () => {
    const { effects } = run([
      { kind: "owner", ownerKey: "/a" },
      { kind: "session", sessionId: 7, maximized: false },
      { kind: "layoutChanged" },
      { kind: "session", sessionId: 8, maximized: false },
    ]);

    expect(effects).toEqual(["none", "maximize", "none", "maximize"]);
  });
});

describe("debugViewsPlacement", () => {
  it("shows the side column only in focus mode while debugging or while the Debug console is open", () => {
    expect(debugViewsPlacement({ maximized: true, phase: "active", drawerView: null })).toBe("side");
    expect(debugViewsPlacement({ maximized: true, phase: "idle", drawerView: "debug" })).toBe("side");
    expect(debugViewsPlacement({ maximized: true, phase: "idle", drawerView: "problems" })).toBe("hidden");
    expect(debugViewsPlacement({ maximized: false, phase: "active", drawerView: "debug" })).toBe("hidden");
  });
});
```

Create `src/domain/debugExceptionRows.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { debugExceptionRows, nextExceptionPauseMode } from "./debugExceptionRows";

describe("debugExceptionRows", () => {
  it("shows two rows with implied uncaught when all exceptions pause", () => {
    expect(debugExceptionRows("none")).toEqual([
      { id: "all", label: "All exceptions", checked: false, implied: false },
      { id: "uncaught", label: "Uncaught exceptions", checked: false, implied: false },
    ]);
    expect(debugExceptionRows("uncaught").map((row) => row.checked)).toEqual([false, true]);
    expect(debugExceptionRows("all")).toEqual([
      { id: "all", label: "All exceptions", checked: true, implied: false },
      { id: "uncaught", label: "Uncaught exceptions", checked: true, implied: true },
    ]);
  });
});

describe("nextExceptionPauseMode", () => {
  it.each([
    ["none", "uncaught", "uncaught"],
    ["uncaught", "uncaught", "none"],
    ["all", "uncaught", "none"],
    ["none", "all", "all"],
    ["uncaught", "all", "all"],
    ["all", "all", "uncaught"],
  ] as const)("%s + toggle %s -> %s", (mode, row, expected) => {
    expect(nextExceptionPauseMode(mode, row)).toBe(expected);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/domain/editorDebugFocus.test.ts src/domain/debugExceptionRows.test.ts`
Expected: FAIL with unresolved imports.

- [ ] **Step 3: Implement**

Create `src/domain/editorDebugFocus.ts`:

```ts
import type { EditorDrawerView } from "./editorDrawer";

export type DebugSessionPhase = "idle" | "active";
export type EditorDebugFocusEffect = "none" | "maximize" | "restore";

export interface EditorDebugFocusState {
  readonly ownerKey: string | null;
  readonly sessionId: number | null;
  readonly maximizedByDebug: boolean;
  readonly layoutTouched: boolean;
}

export type EditorDebugFocusEvent =
  | { readonly kind: "owner"; readonly ownerKey: string | null }
  | { readonly kind: "session"; readonly sessionId: number | null; readonly maximized: boolean }
  | { readonly kind: "layoutChanged" };

export interface EditorDebugFocusStep {
  readonly state: EditorDebugFocusState;
  readonly effect: EditorDebugFocusEffect;
}

export const initialEditorDebugFocusState: EditorDebugFocusState = Object.freeze({
  ownerKey: null,
  sessionId: null,
  maximizedByDebug: false,
  layoutTouched: false,
});

export function editorDebugFocusReducer(
  state: EditorDebugFocusState,
  event: EditorDebugFocusEvent,
): EditorDebugFocusStep {
  switch (event.kind) {
    case "owner":
      return ownerChanged(state, event.ownerKey);
    case "layoutChanged":
      return { state: { ...state, layoutTouched: true }, effect: "none" };
    case "session":
      return sessionChanged(state, event.sessionId, event.maximized);
    default:
      return unsupportedEvent(event);
  }
}

export function debugViewsPlacement(input: {
  readonly maximized: boolean;
  readonly phase: DebugSessionPhase;
  readonly drawerView: EditorDrawerView | null;
}): "side" | "hidden" {
  if (!input.maximized) return "hidden";
  if (input.phase === "active") return "side";
  return input.drawerView === "debug" ? "side" : "hidden";
}

function ownerChanged(state: EditorDebugFocusState, ownerKey: string | null): EditorDebugFocusStep {
  if (state.ownerKey === ownerKey) return { state, effect: "none" };
  return { state: { ...initialEditorDebugFocusState, ownerKey }, effect: "none" };
}

function sessionChanged(
  state: EditorDebugFocusState,
  sessionId: number | null,
  maximized: boolean,
): EditorDebugFocusStep {
  if (sessionId === null) return sessionEnded(state);
  if (state.sessionId === sessionId) return { state, effect: "none" };
  const started: EditorDebugFocusState = {
    ...state,
    sessionId,
    maximizedByDebug: !maximized,
    layoutTouched: false,
  };
  return { state: started, effect: maximized ? "none" : "maximize" };
}

function sessionEnded(state: EditorDebugFocusState): EditorDebugFocusStep {
  if (state.sessionId === null) return { state, effect: "none" };
  const restore = state.maximizedByDebug && !state.layoutTouched;
  return {
    state: { ...initialEditorDebugFocusState, ownerKey: state.ownerKey },
    effect: restore ? "restore" : "none",
  };
}

function unsupportedEvent(event: never): never {
  throw new TypeError(`Unsupported editor debug focus event: ${JSON.stringify(event)}.`);
}
```

The "owner" test expects `ownerChanged` to drop a pending restore: `ownerKey /a -> /b` resets `sessionId` to `null`, so the later `session null` in `/b` returns `none`.

Create `src/domain/debugExceptionRows.ts`:

```ts
import type { DebugExceptionPauseMode } from "./debug";

export type DebugExceptionRowId = "all" | "uncaught";

export interface DebugExceptionRow {
  readonly id: DebugExceptionRowId;
  readonly label: string;
  readonly checked: boolean;
  readonly implied: boolean;
}

export function debugExceptionRows(
  mode: DebugExceptionPauseMode,
): ReadonlyArray<DebugExceptionRow> {
  return [
    { id: "all", label: "All exceptions", checked: mode === "all", implied: false },
    {
      id: "uncaught",
      label: "Uncaught exceptions",
      checked: mode !== "none",
      implied: mode === "all",
    },
  ];
}

export function nextExceptionPauseMode(
  mode: DebugExceptionPauseMode,
  row: DebugExceptionRowId,
): DebugExceptionPauseMode {
  if (row === "all") return mode === "all" ? "uncaught" : "all";
  return mode === "none" ? "uncaught" : "none";
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/domain/editorDebugFocus.test.ts src/domain/debugExceptionRows.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domain/editorDebugFocus.ts src/domain/editorDebugFocus.test.ts src/domain/debugExceptionRows.ts src/domain/debugExceptionRows.test.ts
git commit -m "feat(debug): add the debug focus policy and exception rows"
```

---

### Task 4: Breadcrumb segments and panel document tabs (pure)

**Files:**
- Create: `src/domain/editorBreadcrumbSegments.ts`, `src/domain/editorBreadcrumbSegments.test.ts`
- Create: `src/components/editorPanel/editorPanelDocuments.ts`, `src/components/editorPanel/editorPanelDocuments.test.ts`

**Interfaces:**
- Consumes: `EditorGroup` (`domain/editorGroups.ts`), `EditorGroupDocument` (`components/EditorGroupView.tsx`), `visibleEditorPaths` (`domain/workspace.ts`), `workspaceRelativePath` (`domain/pathDerivation.ts`).
- Produces:
  - `MAX_EDITOR_BREADCRUMB_FOLDERS = 4`
  - `interface EditorBreadcrumbSegment { readonly kind: "folder" | "file" | "overflow"; readonly label: string; readonly path: string }`
  - `editorBreadcrumbSegments(rootPath: string | null, filePath: string): ReadonlyArray<EditorBreadcrumbSegment>`
  - `interface EditorPanelDocumentEntry { readonly documentId: string; readonly title: string; readonly path: string; readonly dirty: boolean; readonly preview: boolean }`
  - `interface EditorPanelDocumentsSnapshot { readonly documents: ReadonlyArray<EditorPanelDocumentEntry>; readonly activeDocumentId: string | null }`
  - `editorPanelDocuments(group: EditorGroup, documents: ReadonlyArray<EditorGroupDocument>): EditorPanelDocumentsSnapshot`
  - `editorPanelDocumentsEqual(left: EditorPanelDocumentsSnapshot, right: EditorPanelDocumentsSnapshot): boolean`

- [ ] **Step 1: Write the failing tests**

Create `src/domain/editorBreadcrumbSegments.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { editorBreadcrumbSegments } from "./editorBreadcrumbSegments";

describe("editorBreadcrumbSegments", () => {
  it("splits a workspace-relative path into folder crumbs and the file", () => {
    expect(editorBreadcrumbSegments("/w/orders-api", "/w/orders-api/src/routes/orders.ts")).toEqual([
      { kind: "folder", label: "src", path: "/w/orders-api/src" },
      { kind: "folder", label: "routes", path: "/w/orders-api/src/routes" },
      { kind: "file", label: "orders.ts", path: "/w/orders-api/src/routes/orders.ts" },
    ]);
  });

  it("collapses leading folders beyond the bound into one overflow crumb", () => {
    const segments = editorBreadcrumbSegments("/w", "/w/a/b/c/d/e/f/g.ts");

    expect(segments.map((segment) => segment.label)).toEqual(["…", "c", "d", "e", "f", "g.ts"]);
    expect(segments[0]).toEqual({ kind: "overflow", label: "…", path: "/w/a/b" });
  });

  it("shows only the file for paths outside the workspace or without a workspace", () => {
    expect(editorBreadcrumbSegments("/w", "/tmp/scratch.ts")).toEqual([
      { kind: "file", label: "scratch.ts", path: "/tmp/scratch.ts" },
    ]);
    expect(editorBreadcrumbSegments(null, "/w/src/a.ts")).toEqual([
      { kind: "file", label: "a.ts", path: "/w/src/a.ts" },
    ]);
  });
});
```

Create `src/components/editorPanel/editorPanelDocuments.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { EditorGroup } from "../../domain/editorGroups";
import type { EditorDocument } from "../../domain/workspace";
import { editorPanelDocuments, editorPanelDocumentsEqual } from "./editorPanelDocuments";

function doc(path: string, content = "a", savedContent = "a"): EditorDocument {
  return { path, name: path.split("/").pop() ?? path, content, savedContent, language: "typescript" };
}

const group: EditorGroup = {
  activePath: "/w/src/orders.ts",
  openPaths: ["/w/src/orders.ts", "/w/src/idempotency.ts"],
  previewPath: "/w/test/orders.test.ts",
};

describe("editorPanelDocuments", () => {
  it("lists open tabs then the preview tab, with dirty and preview flags", () => {
    const snapshot = editorPanelDocuments(group, [
      doc("/w/src/orders.ts"),
      doc("/w/src/idempotency.ts", "changed", "saved"),
      doc("/w/test/orders.test.ts"),
    ]);

    expect(snapshot).toEqual({
      activeDocumentId: "/w/src/orders.ts",
      documents: [
        { documentId: "/w/src/orders.ts", title: "orders.ts", path: "/w/src/orders.ts", dirty: false, preview: false },
        { documentId: "/w/src/idempotency.ts", title: "idempotency.ts", path: "/w/src/idempotency.ts", dirty: true, preview: false },
        { documentId: "/w/test/orders.test.ts", title: "orders.test.ts", path: "/w/test/orders.test.ts", dirty: false, preview: true },
      ],
    });
  });

  it("drops the preview flag once the preview document is dirty", () => {
    const snapshot = editorPanelDocuments(group, [
      doc("/w/src/orders.ts"),
      doc("/w/src/idempotency.ts"),
      doc("/w/test/orders.test.ts", "edited", "saved"),
    ]);

    expect(snapshot.documents[2]).toMatchObject({ dirty: true, preview: false });
  });

  it("skips paths without a loaded document and never reports markdown previews as dirty", () => {
    const snapshot = editorPanelDocuments(
      { activePath: "/w/README.md", openPaths: ["/w/README.md", "/w/missing.ts"], previewPath: null },
      [{ content: "# x", html: "<h1>x</h1>", name: "README.md", path: "/w/README.md", sourcePath: "/w/README.md" }],
    );

    expect(snapshot.documents.map((entry) => [entry.path, entry.dirty])).toEqual([["/w/README.md", false]]);
  });
});

describe("editorPanelDocumentsEqual", () => {
  it("is true for a keystroke that does not flip dirty state", () => {
    const before = editorPanelDocuments(group, [doc("/w/src/orders.ts", "a1", "a")]);
    const after = editorPanelDocuments(group, [doc("/w/src/orders.ts", "a12", "a")]);

    expect(editorPanelDocumentsEqual(before, after)).toBe(true);
  });

  it("is false when dirty, preview, order or the active document changes", () => {
    const base = editorPanelDocuments(group, [doc("/w/src/orders.ts"), doc("/w/src/idempotency.ts")]);
    const dirty = editorPanelDocuments(group, [doc("/w/src/orders.ts", "b", "a"), doc("/w/src/idempotency.ts")]);
    const active = editorPanelDocuments({ ...group, activePath: "/w/src/idempotency.ts" }, [
      doc("/w/src/orders.ts"),
      doc("/w/src/idempotency.ts"),
    ]);

    expect(editorPanelDocumentsEqual(base, dirty)).toBe(false);
    expect(editorPanelDocumentsEqual(base, active)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/domain/editorBreadcrumbSegments.test.ts src/components/editorPanel/editorPanelDocuments.test.ts`
Expected: FAIL with unresolved imports.

- [ ] **Step 3: Implement**

Create `src/domain/editorBreadcrumbSegments.ts`:

```ts
import { workspaceRelativePath } from "./pathDerivation";

export const MAX_EDITOR_BREADCRUMB_FOLDERS = 4;

export interface EditorBreadcrumbSegment {
  readonly kind: "folder" | "file" | "overflow";
  readonly label: string;
  readonly path: string;
}

export function editorBreadcrumbSegments(
  rootPath: string | null,
  filePath: string,
): ReadonlyArray<EditorBreadcrumbSegment> {
  const relative = rootPath === null ? null : workspaceRelativePath(rootPath, filePath);
  if (relative === null || relative === "") return [fileSegment(filePath)];

  const parts = relative.split("/").filter((part) => part.length > 0);
  const folders = parts.slice(0, -1);
  const base = rootPath === null ? "" : rootPath.replace(/\/+$/, "");
  const folderSegments = folders.map<EditorBreadcrumbSegment>((label, index) => ({
    kind: "folder",
    label,
    path: `${base}/${folders.slice(0, index + 1).join("/")}`,
  }));
  return [...boundFolders(folderSegments), fileSegment(filePath)];
}

function boundFolders(
  folders: ReadonlyArray<EditorBreadcrumbSegment>,
): ReadonlyArray<EditorBreadcrumbSegment> {
  if (folders.length <= MAX_EDITOR_BREADCRUMB_FOLDERS) return folders;
  const hidden = folders.length - MAX_EDITOR_BREADCRUMB_FOLDERS;
  const lastHidden = folders[hidden - 1];
  const overflow: EditorBreadcrumbSegment = {
    kind: "overflow",
    label: "…",
    path: lastHidden === undefined ? "" : lastHidden.path,
  };
  return [overflow, ...folders.slice(hidden)];
}

function fileSegment(filePath: string): EditorBreadcrumbSegment {
  const label = filePath.slice(filePath.lastIndexOf("/") + 1) || filePath;
  return { kind: "file", label, path: filePath };
}
```

Create `src/components/editorPanel/editorPanelDocuments.ts`:

```ts
import type { EditorGroup } from "../../domain/editorGroups";
import { visibleEditorPaths } from "../../domain/workspace";
import type { EditorGroupDocument } from "../EditorGroupView";

export interface EditorPanelDocumentEntry {
  readonly documentId: string;
  readonly title: string;
  readonly path: string;
  readonly dirty: boolean;
  readonly preview: boolean;
}

export interface EditorPanelDocumentsSnapshot {
  readonly documents: ReadonlyArray<EditorPanelDocumentEntry>;
  readonly activeDocumentId: string | null;
}

export function editorPanelDocuments(
  group: EditorGroup,
  documents: ReadonlyArray<EditorGroupDocument>,
): EditorPanelDocumentsSnapshot {
  const byPath = new Map(documents.map((document) => [document.path, document]));
  const entries = visibleEditorPaths(group.openPaths, group.previewPath).flatMap((path) => {
    const document = byPath.get(path);
    if (document === undefined) return [];
    const dirty = documentDirty(document);
    return [
      {
        documentId: path,
        title: document.name,
        path,
        dirty,
        preview: path === group.previewPath && !dirty,
      },
    ];
  });
  return { documents: entries, activeDocumentId: group.activePath };
}

export function editorPanelDocumentsEqual(
  left: EditorPanelDocumentsSnapshot,
  right: EditorPanelDocumentsSnapshot,
): boolean {
  if (left.activeDocumentId !== right.activeDocumentId) return false;
  if (left.documents.length !== right.documents.length) return false;
  return left.documents.every((entry, index) => entriesEqual(entry, right.documents[index]));
}

function entriesEqual(
  left: EditorPanelDocumentEntry,
  right: EditorPanelDocumentEntry | undefined,
): boolean {
  if (right === undefined) return false;
  return (
    left.documentId === right.documentId &&
    left.title === right.title &&
    left.dirty === right.dirty &&
    left.preview === right.preview
  );
}

function documentDirty(document: EditorGroupDocument): boolean {
  if (!("savedContent" in document)) return false;
  return document.content !== document.savedContent;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/domain/editorBreadcrumbSegments.test.ts src/components/editorPanel/editorPanelDocuments.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/editorBreadcrumbSegments.ts src/domain/editorBreadcrumbSegments.test.ts src/components/editorPanel/editorPanelDocuments.ts src/components/editorPanel/editorPanelDocuments.test.ts
git commit -m "feat(editor): add breadcrumb segments and panel document tab snapshots"
```

---
### Task 5: Editor chrome context and the breadcrumb sub-header

**Files:**
- Create: `src/components/editorPanel/EditorChromeContext.ts`
- Create: `src/components/editorPanel/editorStatusRows.ts`, `src/components/editorPanel/editorStatusRows.test.ts`
- Create: `src/components/editorPanel/EditorCursorPosition.tsx`
- Create: `src/components/editorPanel/EditorPathCrumbs.tsx`
- Create: `src/components/editorPanel/EditorSubheader.tsx`, `src/components/editorPanel/EditorSubheader.test.tsx`
- Create: `src/components/editorPanel/EditorSubheaderActions.tsx`, `src/components/editorPanel/EditorSubheaderActions.test.tsx`
- Create: `src/components/editorPanel/editorPanel.css`
- Modify: `src/components/Breadcrumbs.tsx`, `src/components/Breadcrumbs.test.tsx`, `src/components/CursorAwareBreadcrumbs.tsx`
- Integration: `src/components/editorSurfaceCore/useEditorSurfacePresentation.tsx`, `src/App.css` (delete `.breadcrumbs`, `.breadcrumb-*` rules at the old lines 2383-2470, keep `.editor-large-file-notice` until Task 11 moves it)

**Interfaces:**
- Consumes: `EditorCursorStorePort`, `EditorCursorAuthority` (`application/editorCursorStore.ts`), `useActiveEditorCursorSnapshot` (`application/useEditorCursorSnapshot.ts`), `cursorSnapshotMatchesAuthority` (`application/editorCursorAuthority.ts`), `editorBreadcrumbSegments` (Task 4), `IconButton`, `Kbd`, `Menu`, `MenuItem`, `MenuLabel`, `MenuSeparator` (foundation), `NodeRunStatusPresentation`, `IdeActivityState`, `IntelligenceMode`, `LargeSmartDocumentStatus`.
- Produces:

```ts
export type EditorDebugEntry =
  | "start"
  | "runWithoutDebugging"
  | "launchConfigurations"
  | "attach"
  | "showViews";

export interface EditorChromeActivity {
  readonly label: string;
  readonly state: IdeActivityState;
  readonly detail: string | null;
}

export interface EditorStatusRow {
  readonly id: "language" | "project" | "branch" | "trust" | "mode" | "largeFile" | "unsaved";
  readonly label: string;
  readonly value: string;
}

export interface EditorChrome {
  readonly activeGroupId: string | null;
  readonly diagnostics: { readonly errors: number; readonly warnings: number };
  readonly problemsOpen: boolean;
  readonly cursorVisible: boolean;
  readonly cursorStore: EditorCursorStorePort | null;
  readonly cursorAuthority: EditorCursorAuthority | null;
  readonly activity: EditorChromeActivity | null;
  readonly nodeRun: NodeRunStatusPresentation | null;
  readonly debugToolbar: ReactNode;
  readonly statusRows: ReadonlyArray<EditorStatusRow>;
  readonly ideModeOn: boolean;
  readonly trustNeeded: boolean;
  readonly shortcuts: {
    readonly problems: string;
    readonly find: string;
    readonly split: string;
  };
  toggleProblems(): void;
  showGoToLine(): void;
  openRuntimeView(): void;
  stopNodeRun(): void;
  splitRight(): void;
  splitDown(): void;
  toggleIdeMode(): void;
  trustWorkspace(): void;
  revealInFiles(): void;
  runDebugEntry(entry: EditorDebugEntry): void;
}
```

  - `EditorChromeContext: React.Context<EditorChrome | null>`, `useEditorChrome(): EditorChrome | null`
  - `editorStatusRows(input: EditorStatusRowsInput): ReadonlyArray<EditorStatusRow>` (input below)
  - `EditorSubheader(props: { readonly groupId: string | null; readonly rootPath: string | null; readonly documentPath: string; readonly symbols: ReactNode; onFind(): void })`
  - `Breadcrumbs` / `CursorAwareBreadcrumbs` gain `readonly showFileName?: boolean` (default `true`).

- [ ] **Step 1: Write the failing tests**

Create `src/components/editorPanel/editorStatusRows.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { editorStatusRows } from "./editorStatusRows";

const BASE = {
  activeLanguage: "TypeScript",
  workspaceLabel: "orders-api · TS 5.8",
  gitBranch: "feat/idempotency-keys",
  workspaceTrustLabel: "Trusted",
  intelligenceMode: "fullSmart" as const,
  largeDocumentStatus: null,
  dirtyCount: 0,
};

describe("editorStatusRows", () => {
  it("lists the former status bar readouts in a stable order", () => {
    expect(editorStatusRows({ ...BASE, dirtyCount: 2, largeDocumentStatus: { label: "Large file", title: "t" } })).toEqual([
      { id: "language", label: "Language", value: "TypeScript" },
      { id: "project", label: "Project", value: "orders-api · TS 5.8" },
      { id: "branch", label: "Branch", value: "feat/idempotency-keys" },
      { id: "trust", label: "Trust", value: "Trusted" },
      { id: "mode", label: "Mode", value: "IDE Mode" },
      { id: "largeFile", label: "Large file", value: "Large file" },
      { id: "unsaved", label: "Unsaved", value: "2 files" },
    ]);
  });

  it("omits empty readouts and names every intelligence mode", () => {
    const rows = editorStatusRows({
      ...BASE,
      activeLanguage: null,
      gitBranch: null,
      workspaceTrustLabel: null,
      workspaceLabel: null,
      intelligenceMode: "basic",
    });

    expect(rows).toEqual([{ id: "mode", label: "Mode", value: "Editor Mode" }]);
    expect(editorStatusRows({ ...BASE, intelligenceMode: "lightSmart" }).find((row) => row.id === "mode")?.value).toBe("Smart Index");
    expect(editorStatusRows({ ...BASE, dirtyCount: 1 }).find((row) => row.id === "unsaved")?.value).toBe("1 file");
  });
});
```

Create `src/components/editorPanel/EditorSubheader.test.tsx`:

```tsx
// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { click, mountUi, type MountedUi } from "../../ui/foundation/foundationTestSupport";
import { EditorChromeContext, type EditorChrome } from "./EditorChromeContext";
import { EditorSubheader } from "./EditorSubheader";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

export function chromeFixture(overrides: Partial<EditorChrome> = {}): EditorChrome {
  return {
    activeGroupId: "editor-main",
    diagnostics: { errors: 1, warnings: 1 },
    problemsOpen: false,
    cursorVisible: true,
    cursorStore: null,
    cursorAuthority: null,
    activity: null,
    nodeRun: null,
    debugToolbar: null,
    statusRows: [],
    ideModeOn: true,
    trustNeeded: false,
    shortcuts: { problems: "⇧⌘M", find: "⌘F", split: "⌘\\" },
    toggleProblems: vi.fn(),
    showGoToLine: vi.fn(),
    openRuntimeView: vi.fn(),
    stopNodeRun: vi.fn(),
    splitRight: vi.fn(),
    splitDown: vi.fn(),
    toggleIdeMode: vi.fn(),
    trustWorkspace: vi.fn(),
    revealInFiles: vi.fn(),
    runDebugEntry: vi.fn(),
    ...overrides,
  };
}

let mounted: MountedUi | null = null;

afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

function renderSubheader(chrome: EditorChrome, onFind = vi.fn()) {
  mounted = mountUi();
  mounted.render(
    <EditorChromeContext.Provider value={chrome}>
      <EditorSubheader
        documentPath="/w/orders-api/src/routes/orders.ts"
        groupId="editor-main"
        onFind={onFind}
        rootPath="/w/orders-api"
        symbols={<span data-testid="symbols">router.post("/orders")</span>}
      />
    </EditorChromeContext.Provider>,
  );
  return mounted.host;
}

describe("EditorSubheader", () => {
  it("renders folder and file crumbs, then the symbol crumbs", () => {
    const host = renderSubheader(chromeFixture());
    const crumbs = host.querySelector('nav[aria-label="Breadcrumbs"]');

    expect([...(crumbs?.querySelectorAll("button") ?? [])].map((b) => b.textContent)).toEqual([
      "src",
      "routes",
      "orders.ts",
    ]);
    expect(crumbs?.querySelector('[data-testid="symbols"]')).not.toBeNull();
    expect(host.querySelector(".cv-esub")?.getAttribute("data-debug")).toBe("off");
  });

  it("reveals the file in the Files surface from a crumb", () => {
    const chrome = chromeFixture();
    const host = renderSubheader(chrome);
    click(host.querySelector('nav[aria-label="Breadcrumbs"] button') as Element);

    expect(chrome.revealInFiles).toHaveBeenCalledTimes(1);
  });

  it("replaces the hover actions with the debug toolbar while a session exists", () => {
    const host = renderSubheader(
      chromeFixture({ debugToolbar: <div role="toolbar" aria-label="Debug session" /> }),
    );

    expect(host.querySelector('[role="toolbar"][aria-label="Debug session"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Find in file"]')).toBeNull();
    expect(host.querySelector(".cv-esub")?.getAttribute("data-debug")).toBe("on");
  });
});
```

Create `src/components/editorPanel/EditorSubheaderActions.test.tsx`:

```tsx
// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { EditorCursorStore } from "../../application/editorCursorStore";
import { click, mountUi, type MountedUi } from "../../ui/foundation/foundationTestSupport";
import { EditorChromeContext, type EditorChrome } from "./EditorChromeContext";
import { EditorSubheaderActions } from "./EditorSubheaderActions";
import { chromeFixture } from "./EditorSubheader.test";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let mounted: MountedUi | null = null;

afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

function renderActions(chrome: EditorChrome, onFind = vi.fn()) {
  mounted = mountUi();
  mounted.render(
    <EditorChromeContext.Provider value={chrome}>
      <EditorSubheaderActions groupId="editor-main" onFind={onFind} />
    </EditorChromeContext.Provider>,
  );
  return mounted.host;
}

describe("EditorSubheaderActions", () => {
  it("labels the problems counts and toggles the Problems drawer", () => {
    const chrome = chromeFixture({ diagnostics: { errors: 1, warnings: 4 } });
    const host = renderActions(chrome);
    const diag = host.querySelector<HTMLButtonElement>('button[aria-label="1 error, 4 warnings. Show problems"]');

    expect(diag?.textContent).toBe("14");
    expect(diag?.title).toBe("Problems ⇧⌘M");
    click(diag as Element);
    expect(chrome.toggleProblems).toHaveBeenCalledTimes(1);
  });

  it("pins the actions while Problems is open and marks the button pressed", () => {
    const host = renderActions(chromeFixture({ problemsOpen: true }));

    expect(host.querySelector(".cv-esub__acts")?.classList.contains("cv-esub__acts--pinned")).toBe(true);
    expect(host.querySelector('button[aria-pressed="true"][title="Problems ⇧⌘M"]')).not.toBeNull();
  });

  it("shows the cursor position from the store for the exact authority and opens Go to Line", () => {
    const store = new EditorCursorStore();
    const authority = { documentPath: "/w/a.ts", groupId: "editor-main", ownerKey: "owner-a" as never };
    const lease = store.activate(authority);
    const chrome = chromeFixture({ cursorStore: store, cursorAuthority: authority });
    const host = renderActions(chrome);

    act(() => {
      if (lease) store.publish(lease, { lineNumber: 25, column: 16 });
    });
    const pos = host.querySelector<HTMLButtonElement>('button[aria-label="Ln 25, Col 16"]');
    expect(pos?.textContent).toBe("Ln 25, Col 16");
    click(pos as Element);
    expect(chrome.showGoToLine).toHaveBeenCalledTimes(1);
  });

  it("hides the cursor position when the visibility setting is off", () => {
    const host = renderActions(chromeFixture({ cursorVisible: false }));

    expect(host.querySelector(".cv-esub__pos")).toBeNull();
  });

  it("shows IDE activity only while it is not idle and opens the Runtime view", () => {
    const chrome = chromeFixture({ activity: { label: "Indexing 40%", state: "scanning", detail: "PHPactor: Off" } });
    const host = renderActions(chrome);
    const activity = host.querySelector<HTMLButtonElement>('button[aria-label="Indexing 40%"]');

    expect(activity?.title).toBe("Indexing 40%\nPHPactor: Off");
    click(activity as Element);
    expect(chrome.openRuntimeView).toHaveBeenCalledTimes(1);
  });

  it("shows a running Node program with Stop", () => {
    const chrome = chromeFixture({
      nodeRun: { canStop: true, label: "Running dev", phase: "running", stopLabel: "Stop dev" },
    });
    const host = renderActions(chrome);
    click(host.querySelector('button[aria-label="Stop dev"]') as Element);

    expect(host.textContent).toContain("Running dev");
    expect(chrome.stopNodeRun).toHaveBeenCalledTimes(1);
  });

  it("finds in the file and splits the editor", () => {
    const onFind = vi.fn();
    const chrome = chromeFixture();
    const host = renderActions(chrome, onFind);
    click(host.querySelector('button[aria-label="Find in file"]') as Element);
    click(host.querySelector('button[aria-label="Split editor"]') as Element);

    expect(onFind).toHaveBeenCalledTimes(1);
    expect(chrome.splitRight).toHaveBeenCalledTimes(1);
  });

  it("renders nothing for a group that is not active", () => {
    mounted = mountUi();
    mounted.render(
      <EditorChromeContext.Provider value={chromeFixture({ activeGroupId: "editor-2" })}>
        <EditorSubheaderActions groupId="editor-main" onFind={vi.fn()} />
      </EditorChromeContext.Provider>,
    );

    expect(mounted.host.querySelector(".cv-esub__acts")).toBeNull();
  });
});
```

If `NodeRunStatusPhase` does not include `"running"`, use the phase value that `presentOptionalNodeRunWithoutDebugging` returns for a live run (read `application/nodeRunWithoutDebuggingPresentation.ts`). If `EditorSessionOwnerKey` is a branded string type, build the authority with the same helper `App.tsx` uses (`editorCursorAuthority(...)`) instead of the `as never` cast.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/editorPanel`
Expected: FAIL with unresolved imports (`./EditorChromeContext`, `./editorStatusRows`, `./EditorSubheader`, `./EditorSubheaderActions`).

- [ ] **Step 3: Implement the context and the status rows**

Create `src/components/editorPanel/EditorChromeContext.ts` with the `EditorDebugEntry`, `EditorChromeActivity`, `EditorStatusRow` and `EditorChrome` declarations from **Interfaces** (import types from `react`, `../../application/editorCursorStore`, `../../application/nodeRunWithoutDebuggingPresentation`, `../../domain/ideActivity`), then:

```ts
export const EditorChromeContext = createContext<EditorChrome | null>(null);

export function useEditorChrome(): EditorChrome | null {
  return useContext(EditorChromeContext);
}
```

Create `src/components/editorPanel/editorStatusRows.ts`:

```ts
import type { LargeSmartDocumentStatus } from "../../domain/largeDocumentPolicy";
import type { IntelligenceMode } from "../../domain/workspace";
import type { EditorStatusRow } from "./EditorChromeContext";

export interface EditorStatusRowsInput {
  readonly activeLanguage: string | null;
  readonly workspaceLabel: string | null;
  readonly gitBranch: string | null;
  readonly workspaceTrustLabel: string | null;
  readonly intelligenceMode: IntelligenceMode;
  readonly largeDocumentStatus: LargeSmartDocumentStatus | null;
  readonly dirtyCount: number;
}

export function editorStatusRows(input: EditorStatusRowsInput): ReadonlyArray<EditorStatusRow> {
  const rows: EditorStatusRow[] = [];
  pushRow(rows, "language", "Language", input.activeLanguage);
  pushRow(rows, "project", "Project", input.workspaceLabel);
  pushRow(rows, "branch", "Branch", input.gitBranch);
  pushRow(rows, "trust", "Trust", input.workspaceTrustLabel);
  pushRow(rows, "mode", "Mode", intelligenceModeLabel(input.intelligenceMode));
  pushRow(rows, "largeFile", "Large file", input.largeDocumentStatus?.label ?? null);
  pushRow(rows, "unsaved", "Unsaved", unsavedLabel(input.dirtyCount));
  return rows;
}

export function intelligenceModeLabel(mode: IntelligenceMode): string {
  if (mode === "lightSmart") return "Smart Index";
  if (mode === "fullSmart") return "IDE Mode";
  return "Editor Mode";
}

function unsavedLabel(count: number): string | null {
  if (count <= 0) return null;
  return count === 1 ? "1 file" : `${count} files`;
}

function pushRow(
  rows: EditorStatusRow[],
  id: EditorStatusRow["id"],
  label: string,
  value: string | null,
): void {
  if (value === null || value.length === 0) return;
  rows.push({ id, label, value });
}
```

- [ ] **Step 4: Implement the crumbs, cursor position and sub-header**

Create `src/components/editorPanel/EditorCursorPosition.tsx`. It moves `CursorPositionStoreItem` / `CursorPositionItem` / `cursorPositionLabel` out of `StatusBar.tsx`. `StatusBar.tsx` keeps its own copies until Task 13 deletes the file.

```tsx
import type { EditorCursorAuthority, EditorCursorStorePort } from "../../application/editorCursorStore";
import { cursorSnapshotMatchesAuthority } from "../../application/editorCursorAuthority";
import { useActiveEditorCursorSnapshot } from "../../application/useEditorCursorSnapshot";
import type { EditorPosition } from "../../domain/languageServerFeatures";

export interface EditorCursorPositionProps {
  readonly store: EditorCursorStorePort;
  readonly authority: EditorCursorAuthority | null;
  onShowGoToLine(): void;
}

export function EditorCursorPosition({ authority, onShowGoToLine, store }: EditorCursorPositionProps) {
  const snapshot = useActiveEditorCursorSnapshot(store);
  const position =
    authority !== null &&
    snapshot.status === "available" &&
    cursorSnapshotMatchesAuthority(snapshot, authority)
      ? snapshot.position
      : null;
  if (position === null) return null;
  const label = cursorPositionLabel(position);
  return (
    <button
      aria-label={label}
      className="cv-esub__pos"
      onClick={onShowGoToLine}
      title="Go to Line/Column"
      type="button"
    >
      {label}
    </button>
  );
}

export function cursorPositionLabel(position: Readonly<EditorPosition>): string {
  return `Ln ${position.lineNumber}, Col ${position.column}`;
}
```

Create `src/components/editorPanel/EditorPathCrumbs.tsx`:

```tsx
import { ChevronRight } from "lucide-react";
import { Fragment } from "react";
import { editorBreadcrumbSegments } from "../../domain/editorBreadcrumbSegments";

export interface EditorPathCrumbsProps {
  readonly rootPath: string | null;
  readonly documentPath: string;
  onReveal(): void;
}

export function EditorPathCrumbs({ documentPath, onReveal, rootPath }: EditorPathCrumbsProps) {
  const segments = editorBreadcrumbSegments(rootPath, documentPath);
  return (
    <>
      {segments.map((segment, index) => (
        <Fragment key={segment.path}>
          {index === 0 ? null : <ChevronRight aria-hidden="true" className="cv-esub__sep" size={12} />}
          <button
            className={segment.kind === "file" ? "cv-esub__crumb cv-esub__crumb--current" : "cv-esub__crumb"}
            onClick={onReveal}
            title={segment.path}
            type="button"
          >
            {segment.label}
          </button>
        </Fragment>
      ))}
    </>
  );
}
```

Create `src/components/editorPanel/EditorSubheader.tsx`:

```tsx
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { useEditorChrome } from "./EditorChromeContext";
import { EditorPathCrumbs } from "./EditorPathCrumbs";
import { EditorSubheaderActions } from "./EditorSubheaderActions";
import "./editorPanel.css";

export interface EditorSubheaderProps {
  readonly groupId: string | null;
  readonly rootPath: string | null;
  readonly documentPath: string;
  readonly symbols: ReactNode;
  onFind(): void;
}

export function EditorSubheader({ documentPath, groupId, onFind, rootPath, symbols }: EditorSubheaderProps) {
  const chrome = useEditorChrome();
  const debugToolbar = chrome !== null && chrome.activeGroupId === groupId ? chrome.debugToolbar : null;
  const revealInFiles = chrome === null ? noop : chrome.revealInFiles;
  return (
    <div className="cv-esub" data-debug={debugToolbar === null ? "off" : "on"}>
      <nav aria-label="Breadcrumbs" className="cv-esub__crumbs">
        <EditorPathCrumbs documentPath={documentPath} onReveal={revealInFiles} rootPath={rootPath} />
        {symbols === null ? null : <ChevronRight aria-hidden="true" className="cv-esub__sep" size={12} />}
        {symbols}
      </nav>
      {debugToolbar === null ? <EditorSubheaderActions groupId={groupId} onFind={onFind} /> : debugToolbar}
    </div>
  );
}

function noop(): void {}
```

Create `src/components/editorPanel/EditorSubheaderActions.tsx`:

```tsx
import { CircleX, LoaderCircle, MoreHorizontal, Search, SquareSplitHorizontal, TriangleAlert } from "lucide-react";
import { useRef, useState } from "react";
import { IconButton } from "../../ui/foundation/IconButton";
import { cx } from "../../ui/foundation/classNames";
import { useEditorChrome } from "./EditorChromeContext";
import { EditorCursorPosition } from "./EditorCursorPosition";
import { EditorMoreMenu } from "./EditorMoreMenu";

export interface EditorSubheaderActionsProps {
  readonly groupId: string | null;
  onFind(): void;
}

export function EditorSubheaderActions({ groupId, onFind }: EditorSubheaderActionsProps) {
  const chrome = useEditorChrome();
  const moreRef = useRef<HTMLButtonElement | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  if (chrome === null || chrome.activeGroupId !== groupId) return null;
  const { errors, warnings } = chrome.diagnostics;
  const diagLabel = `${countLabel(errors, "error")}, ${countLabel(warnings, "warning")}. Show problems`;
  return (
    <div className={cx("cv-esub__acts", (chrome.problemsOpen || moreOpen) && "cv-esub__acts--pinned")}>
      {chrome.nodeRun === null ? null : (
        <span className="cv-esub__run">
          <span className="cv-esub__run-dot" aria-hidden="true" />
          {chrome.nodeRun.label}
          <button
            aria-label={chrome.nodeRun.stopLabel}
            className="cv-esub__run-stop"
            disabled={!chrome.nodeRun.canStop}
            onClick={chrome.stopNodeRun}
            type="button"
          >
            Stop
          </button>
        </span>
      )}
      {chrome.activity === null ? null : (
        <button
          aria-label={chrome.activity.label}
          aria-live="polite"
          className={cx("cv-esub__activity", `cv-esub__activity--${chrome.activity.state}`)}
          onClick={chrome.openRuntimeView}
          title={chrome.activity.detail === null ? chrome.activity.label : `${chrome.activity.label}\n${chrome.activity.detail}`}
          type="button"
        >
          {chrome.activity.state === "problem" ? <TriangleAlert size={14} /> : <LoaderCircle className="cv-esub__spin" size={14} />}
        </button>
      )}
      {chrome.cursorVisible && chrome.cursorStore !== null ? (
        <EditorCursorPosition authority={chrome.cursorAuthority} onShowGoToLine={chrome.showGoToLine} store={chrome.cursorStore} />
      ) : null}
      <button
        aria-label={diagLabel}
        aria-pressed={chrome.problemsOpen}
        className="cv-esub__diag"
        onClick={chrome.toggleProblems}
        title={`Problems ${chrome.shortcuts.problems}`}
        type="button"
      >
        <span className="cv-esub__diag-e"><CircleX aria-hidden="true" size={12} />{errors}</span>
        <span className="cv-esub__diag-w"><TriangleAlert aria-hidden="true" size={12} />{warnings}</span>
      </button>
      <IconButton icon={<Search size={14} />} label="Find in file" onClick={onFind} size="xs" title={`Find ${chrome.shortcuts.find}`} />
      <IconButton icon={<SquareSplitHorizontal size={14} />} label="Split editor" onClick={chrome.splitRight} size="xs" title={`Split editor ${chrome.shortcuts.split}`} />
      <IconButton
        aria-expanded={moreOpen}
        aria-haspopup="menu"
        icon={<MoreHorizontal size={14} />}
        label="More editor actions"
        onClick={() => setMoreOpen((open) => !open)}
        ref={moreRef}
        size="xs"
      />
      <EditorMoreMenu anchorRef={moreRef} chrome={chrome} onClose={() => setMoreOpen(false)} open={moreOpen} />
    </div>
  );
}

function countLabel(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
```

`IconButton` does not forward refs today. React 19 passes `ref` as a normal prop, so add `readonly ref?: Ref<HTMLButtonElement>` to `IconButtonProps` and pass `ref={ref}` to the `<button>`. This is the only foundation edit in P7, and it is additive. If P6 or P5 already added it, reuse theirs. `EditorMoreMenu` is created in Task 6. For this task, create it as the minimal file below and complete it in Task 6:

```tsx
import type { RefObject } from "react";
import { Menu } from "../../ui/foundation/Menu";
import type { EditorChrome } from "./EditorChromeContext";

export interface EditorMoreMenuProps {
  readonly open: boolean;
  readonly anchorRef: RefObject<HTMLElement | null>;
  readonly chrome: EditorChrome;
  onClose(): void;
}

export function EditorMoreMenu({ anchorRef, onClose, open }: EditorMoreMenuProps) {
  return <Menu anchorRef={anchorRef} label="More editor actions" onClose={onClose} open={open}>{null}</Menu>;
}
```

In `Breadcrumbs.tsx`, add `showFileName?: boolean` to `BreadcrumbsProps` (default `true`) and render the file-name segment only when it is `true`. In `CursorAwareBreadcrumbs.tsx`, add the same prop and pass it through. Add one test to `Breadcrumbs.test.tsx`:

```tsx
  it("omits the file name segment when the sub-header already shows the path", () => {
    render(<Breadcrumbs fileName="orders.ts" onNavigate={() => undefined} path={[]} showFileName={false} symbols={[]} />);

    expect(screenHost().textContent).not.toContain("orders.ts");
  });
```

Adapt `render` / `screenHost` to the helpers that `Breadcrumbs.test.tsx` already uses.

Create `src/components/editorPanel/editorPanel.css` with the sub-header rules. The values come from mockup `.esub`, `.bc`, `.acts`, `.pos` and `.diag`.

```css
.cv-esub {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--cv-space-4);
  height: 40px;
  padding: 0 var(--cv-space-4) 0 var(--cv-space-5);
  box-shadow: var(--cv-edge-bottom-hair);
}

.cv-esub__crumbs {
  display: flex;
  align-items: center;
  gap: 1px;
  min-width: 0;
  overflow: hidden;
  color: var(--cv-fg-subtle);
  font: var(--cv-t-xs) / var(--cv-lh-xs) var(--cv-font-ui);
  white-space: nowrap;
}

.cv-esub__crumb {
  display: inline-flex;
  align-items: center;
  gap: var(--cv-space-2);
  padding: 0 3px;
  border: 0;
  border-radius: var(--cv-r-xs);
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.cv-esub__crumb:hover {
  background: var(--cv-tint-2);
  color: var(--cv-fg-strong);
}

.cv-esub__crumb--current {
  color: var(--cv-fg-strong);
  font-weight: 500;
}

.cv-esub__sep {
  flex: none;
  opacity: 0.7;
}

.cv-esub__crumbs .breadcrumbs {
  display: contents;
}

.cv-esub__crumbs .breadcrumb-segment {
  color: var(--cv-fg-muted);
  font: 11.5px / var(--cv-lh-xs) var(--cv-font-mono);
}

.cv-esub__acts {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-left: auto;
  opacity: 0;
  transition: opacity var(--cv-motion-base) var(--cv-ease);
}

.cv-editor-panel:hover .cv-esub__acts,
.cv-esub__acts:focus-within,
.cv-esub__acts--pinned {
  opacity: 1;
}

.cv-esub__pos,
.cv-esub__diag,
.cv-esub__activity {
  display: inline-flex;
  align-items: center;
  gap: var(--cv-space-4);
  height: 24px;
  padding: 0 6px;
  border: 0;
  border-radius: var(--cv-r-sm);
  background: transparent;
  color: var(--cv-fg-subtle);
  font: var(--cv-t-xs) / 1 var(--cv-font-ui);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  cursor: pointer;
}

.cv-esub__pos:hover,
.cv-esub__diag:hover,
.cv-esub__diag[aria-pressed="true"],
.cv-esub__activity:hover {
  background: var(--cv-tint-2);
  color: var(--cv-fg-strong);
}

.cv-esub__diag span {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.cv-esub__diag-e svg {
  color: var(--cv-danger);
}

.cv-esub__diag-w svg {
  color: var(--cv-warn);
}

.cv-esub__activity--problem {
  color: var(--cv-warn);
}

.cv-esub__spin {
  animation: cv-esub-spin var(--cv-motion-spin) linear infinite;
}

.cv-esub__run {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 4px 0 6px;
  color: var(--cv-fg-muted);
  font: var(--cv-t-xs) / 1 var(--cv-font-ui);
  white-space: nowrap;
}

.cv-esub__run-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--cv-ok);
}

.cv-esub__run-stop {
  height: 22px;
  padding: 0 6px;
  border: 0;
  border-radius: var(--cv-r-sm);
  background: transparent;
  color: var(--cv-danger);
  font: inherit;
  cursor: pointer;
}

.cv-esub__run-stop:hover {
  background: var(--cv-tint-2);
}

@keyframes cv-esub-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .cv-esub__spin {
    animation: none;
  }
}
```

The `.breadcrumb-segment` selector above must match the class that `Breadcrumbs.tsx` uses for symbol buttons. If that class is named differently, rename the class in `Breadcrumbs.tsx` to `cv-esub__symbol` and target that instead. Do not keep two names.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/components/editorPanel src/components/Breadcrumbs.test.tsx src/components/CursorAwareBreadcrumbs.test.tsx`
Expected: PASS.

- [ ] **Step 6: Integration - mount the sub-header in the editor surface (lead)**

In `src/components/editorSurfaceCore/useEditorSurfacePresentation.tsx`, replace the `activeDocument ? (cursorStore && ... ? <CursorAwareBreadcrumbs .../> : <Breadcrumbs .../>) : null` block with:

```tsx
      {activeDocument ? (
        <EditorSubheader
          documentPath={activeDocument.path}
          groupId={runtimeMembershipGroupId ?? null}
          onFind={openFindWidget}
          rootPath={workspaceRoot}
          symbols={
            cursorStore && editorSessionOwnerKey && runtimeMembershipGroupId !== undefined ? (
              <CursorAwareBreadcrumbs
                documentPath={activeDocument.path}
                fileName={activeDocument.name}
                groupId={runtimeMembershipGroupId}
                onNavigate={navigateToBreadcrumbSymbol}
                ownerKey={editorSessionOwnerKey}
                showFileName={false}
                store={cursorStore}
                symbols={breadcrumbSymbols}
                trackingActive={cursorTrackingActive}
              />
            ) : (
              <Breadcrumbs
                fileName={activeDocument.name}
                onNavigate={navigateToBreadcrumbSymbol}
                path={cursorStore === undefined ? breadcrumbPath : EMPTY_BREADCRUMB_PATH}
                showFileName={false}
                symbols={breadcrumbSymbols}
              />
            )
          }
        />
      ) : null}
```

Add this callback to the same hook, next to `navigateToBreadcrumbSymbol`:

```tsx
  const openFindWidget = useCallback(() => {
    void editor?.getAction("actions.find")?.run();
  }, [editor]);
```

If `runtimeMembershipGroupId` is typed as `EditorGroupId | undefined` and `EditorGroupId` is not `string`, keep the prop type `EditorGroupId | null` in `EditorSubheaderProps` and `EditorChrome.activeGroupId`.

Run: `npx vitest run src/components/EditorSurface.test.tsx src/components/editorSurfaceCore`
Expected: PASS. Breadcrumb assertions that looked for the file-name segment inside `nav.breadcrumbs` must now find it as the `cv-esub__crumb--current` button. Update only those selectors.

- [ ] **Step 7: Commit**

```bash
git add src/components/editorPanel src/components/Breadcrumbs.tsx src/components/Breadcrumbs.test.tsx src/components/CursorAwareBreadcrumbs.tsx src/components/editorSurfaceCore/useEditorSurfacePresentation.tsx src/components/EditorSurface.test.tsx src/ui/foundation/IconButton.tsx src/App.css
git commit -m "feat(editor): add the breadcrumb sub-header with hover actions"
```

---

### Task 6: "More editor actions" menu, chrome value, message toast

**Files:**
- Modify: `src/components/editorPanel/EditorMoreMenu.tsx`
- Create: `src/components/editorPanel/EditorMoreMenu.test.tsx`
- Create: `src/components/editorPanel/useEditorChromeValue.ts`, `src/components/editorPanel/useEditorChromeValue.test.tsx`

**Interfaces:**
- Consumes: `EditorChrome`, `editorStatusRows` (Task 5); `useEditorStatusPresentation(workbench, activeLanguage)` (P2, in the working tree at `src/components/useEditorStatusPresentation.ts`), which returns `EditorStatusPresentation { readonly workspaceLabel: string | null; readonly ideActivityLabel: string | null; readonly ideActivityState: IdeActivityState | null; readonly ideActivityDetail: string }`; `StatusBarItemVisibility` (`domain/settings.ts`); `workbenchPanelPlacement` (Task 2).
- Produces:
  - `interface EditorChromeInput` (below) and `useEditorChromeValue(input: EditorChromeInput): EditorChrome`. The result is referentially stable while its inputs are equal.

```ts
export interface EditorChromeActions {
  showBottomPanelView(view: WorkbenchBottomPanelView): void;
  hideBottomPanel(): void;
  maximizePanel(): void;
  showGoToLine(): void;
  stopNodeRun(): void;
  runCommand(id: string): void;
  toggleIdeMode(): void;
  trustWorkspace(): void;
  revealInFiles(): void;
}

export interface EditorChromeInput {
  readonly activeGroupId: string | null;
  readonly diagnostics: { readonly errors: number; readonly warnings: number };
  readonly panelView: WorkbenchBottomPanelView;
  readonly panelVisible: boolean;
  readonly statusBar: StatusBarItemVisibility;
  readonly status: EditorStatusPresentation;
  readonly activeLanguage: string | null;
  readonly gitBranch: string | null;
  readonly intelligenceMode: IntelligenceMode;
  readonly largeDocumentStatus: LargeSmartDocumentStatus | null;
  readonly dirtyCount: number;
  readonly workspaceTrustLabel: string | null;
  readonly workspaceRoot: string | null;
  readonly workspaceTrusted: boolean;
  readonly nodeRun: NodeRunStatusPresentation | null;
  readonly debugToolbar: ReactNode;
  readonly cursorStore: EditorCursorStorePort | null;
  readonly cursorAuthority: EditorCursorAuthority | null;
  readonly shortcuts: EditorChrome["shortcuts"];
  readonly actions: EditorChromeActions;
}
```

- [ ] **Step 1: Write the failing tests**

Create `src/components/editorPanel/EditorMoreMenu.test.tsx`:

```tsx
// @vitest-environment jsdom

import { createRef } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { click, mountUi, type MountedUi } from "../../ui/foundation/foundationTestSupport";
import { EditorMoreMenu } from "./EditorMoreMenu";
import { chromeFixture } from "./EditorSubheader.test";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let mounted: MountedUi | null = null;

afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

function openMenu(chrome = chromeFixture()) {
  const anchor = document.createElement("button");
  document.body.append(anchor);
  const anchorRef = createRef<HTMLElement>();
  (anchorRef as { current: HTMLElement | null }).current = anchor;
  mounted = mountUi();
  mounted.render(<EditorMoreMenu anchorRef={anchorRef} chrome={chrome} onClose={() => undefined} open />);
  return { chrome, menu: document.body.querySelector('[role="menu"][aria-label="More editor actions"]') };
}

describe("EditorMoreMenu", () => {
  it("offers the debug entry points", () => {
    const { chrome, menu } = openMenu();
    const items = [...(menu?.querySelectorAll('[role="menuitem"]') ?? [])].map((item) => item.textContent ?? "");

    expect(items.some((text) => text.startsWith("Start debugging"))).toBe(true);
    expect(items.some((text) => text.startsWith("Run without debugging"))).toBe(true);
    expect(items.some((text) => text.startsWith("Launch configurations"))).toBe(true);
    expect(items.some((text) => text.startsWith("Attach to Node process"))).toBe(true);
    click([...(menu?.querySelectorAll('[role="menuitem"]') ?? [])].find((item) => item.textContent?.startsWith("Start debugging")) as Element);
    expect(chrome.runDebugEntry).toHaveBeenCalledWith("start");
  });

  it("lists every editor status readout in the Editor status section", () => {
    const { menu } = openMenu(
      chromeFixture({
        statusRows: [
          { id: "language", label: "Language", value: "TypeScript" },
          { id: "branch", label: "Branch", value: "main" },
        ],
      }),
    );

    expect(menu?.textContent).toContain("Editor status");
    expect(menu?.textContent).toContain("LanguageTypeScript");
    expect(menu?.textContent).toContain("Branchmain");
  });

  it("toggles IDE mode and offers Trust only when the workspace is untrusted", () => {
    const chrome = chromeFixture({ trustNeeded: true });
    const { menu } = openMenu(chrome);
    const ideMode = [...(menu?.querySelectorAll('[role="menuitemcheckbox"]') ?? [])].find((item) => item.textContent?.startsWith("IDE mode"));

    expect(ideMode?.getAttribute("aria-checked")).toBe("true");
    click(ideMode as Element);
    expect(chrome.toggleIdeMode).toHaveBeenCalledTimes(1);
    expect(menu?.textContent).toContain("Trust workspace…");
  });
});
```

Before writing the next test, read `MenuItem.tsx`. If `MenuItem` renders `role="menuitemcheckbox"` only when `checked` is defined, keep the IDE mode item `checked={chrome.ideModeOn}` and all other items without `checked`.

Create `src/components/editorPanel/useEditorChromeValue.test.tsx`:

```tsx
// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultStatusBarItemVisibility } from "../../domain/settings";
import { mountUi, type MountedUi } from "../../ui/foundation/foundationTestSupport";
import type { EditorChrome } from "./EditorChromeContext";
import { useEditorChromeValue, type EditorChromeInput } from "./useEditorChromeValue";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const results: EditorChrome[] = [];
let mounted: MountedUi | null = null;

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  results.length = 0;
});

function Probe({ input }: { readonly input: EditorChromeInput }) {
  results.push(useEditorChromeValue(input));
  return null;
}

function input(overrides: Partial<EditorChromeInput> = {}): EditorChromeInput {
  return {
    activeGroupId: "editor-main",
    diagnostics: { errors: 0, warnings: 0 },
    panelView: "problems",
    panelVisible: false,
    statusBar: defaultStatusBarItemVisibility(),
    status: { workspaceLabel: "orders-api", ideActivityLabel: null, ideActivityState: "idle", ideActivityDetail: "" },
    activeLanguage: "TypeScript",
    gitBranch: "main",
    intelligenceMode: "fullSmart",
    largeDocumentStatus: null,
    dirtyCount: 0,
    workspaceTrustLabel: "Trusted",
    workspaceRoot: "/w",
    workspaceTrusted: true,
    nodeRun: null,
    debugToolbar: null,
    cursorStore: null,
    cursorAuthority: null,
    shortcuts: { problems: "⇧⌘M", find: "⌘F", split: "⌘\\" },
    actions: {
      showBottomPanelView: vi.fn(),
      hideBottomPanel: vi.fn(),
      maximizePanel: vi.fn(),
      showGoToLine: vi.fn(),
      stopNodeRun: vi.fn(),
      runCommand: vi.fn(),
      toggleIdeMode: vi.fn(),
      trustWorkspace: vi.fn(),
      revealInFiles: vi.fn(),
    },
    ...overrides,
  };
}

describe("useEditorChromeValue", () => {
  it("is stable while inputs are equal", () => {
    const shared = input();
    mounted = mountUi();
    mounted.render(<Probe input={shared} />);
    mounted.render(<Probe input={{ ...shared, diagnostics: { ...shared.diagnostics } }} />);

    expect(results[1]).toBe(results[0]);
  });

  it("toggles Problems: shows the drawer view, or hides it when Problems is already open", () => {
    const closed = input();
    mounted = mountUi();
    mounted.render(<Probe input={closed} />);
    results[0]?.toggleProblems();
    expect(closed.actions.showBottomPanelView).toHaveBeenCalledWith("problems");

    const open = input({ panelVisible: true });
    mounted.render(<Probe input={open} />);
    expect(results[1]?.problemsOpen).toBe(true);
    results[1]?.toggleProblems();
    expect(open.actions.hideBottomPanel).toHaveBeenCalledTimes(1);
  });

  it("hides IDE activity when idle or when both index and IDE engine readouts are switched off", () => {
    mounted = mountUi();
    mounted.render(<Probe input={input()} />);
    expect(results[0]?.activity).toBeNull();

    const busy = { workspaceLabel: null, ideActivityLabel: "Indexing 40%", ideActivityState: "scanning" as const, ideActivityDetail: "" };
    mounted.render(<Probe input={input({ status: busy })} />);
    expect(results[1]?.activity?.label).toBe("Indexing 40%");

    mounted.render(<Probe input={input({ status: busy, statusBar: { ...defaultStatusBarItemVisibility(), index: false, languageServer: false } })} />);
    expect(results[2]?.activity).toBeNull();
  });

  it("maps debug entries to workbench commands and shows debug views in focus mode", () => {
    const value = input();
    mounted = mountUi();
    mounted.render(<Probe input={value} />);
    results[0]?.runDebugEntry("start");
    results[0]?.runDebugEntry("runWithoutDebugging");
    results[0]?.runDebugEntry("launchConfigurations");
    results[0]?.runDebugEntry("attach");
    results[0]?.runDebugEntry("showViews");

    expect(value.actions.runCommand).toHaveBeenNthCalledWith(1, "debug.start");
    expect(value.actions.runCommand).toHaveBeenNthCalledWith(2, "debug.runWithoutDebugging");
    expect(value.actions.runCommand).toHaveBeenNthCalledWith(3, "debug.configureNodeLaunchConfigurations");
    expect(value.actions.runCommand).toHaveBeenNthCalledWith(4, "debug.attachNode");
    expect(value.actions.showBottomPanelView).toHaveBeenCalledWith("debug");
    expect(value.actions.maximizePanel).toHaveBeenCalledTimes(1);
  });
});
```

The first test only passes if `useEditorChromeValue` memoizes on primitive fields, not on object identity. That is deliberate: `App.tsx` rebuilds objects on every render.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/editorPanel/EditorMoreMenu.test.tsx src/components/editorPanel/useEditorChromeValue.test.tsx`
Expected: FAIL. The menu renders no items, and `./useEditorChromeValue` does not exist.

- [ ] **Step 3: Implement the menu**

Replace `src/components/editorPanel/EditorMoreMenu.tsx`:

```tsx
import { Bug, Columns2, Play, Rows2, ShieldCheck, Settings2, Unplug, PanelRightOpen } from "lucide-react";
import type { RefObject } from "react";
import { Menu } from "../../ui/foundation/Menu";
import { MenuItem, MenuLabel, MenuSeparator } from "../../ui/foundation/MenuItem";
import type { EditorChrome } from "./EditorChromeContext";

export interface EditorMoreMenuProps {
  readonly open: boolean;
  readonly anchorRef: RefObject<HTMLElement | null>;
  readonly chrome: EditorChrome;
  onClose(): void;
}

export function EditorMoreMenu({ anchorRef, chrome, onClose, open }: EditorMoreMenuProps) {
  return (
    <Menu anchorRef={anchorRef} label="More editor actions" onClose={onClose} open={open} placement="bottom-end">
      <MenuItem icon={<Bug size={14} />} onSelect={() => chrome.runDebugEntry("start")} shortcut="F5">
        Start debugging
      </MenuItem>
      <MenuItem icon={<Play size={14} />} onSelect={() => chrome.runDebugEntry("runWithoutDebugging")} shortcut="⌃F5">
        Run without debugging
      </MenuItem>
      <MenuItem icon={<Settings2 size={14} />} onSelect={() => chrome.runDebugEntry("launchConfigurations")}>
        Launch configurations
      </MenuItem>
      <MenuItem icon={<Unplug size={14} />} onSelect={() => chrome.runDebugEntry("attach")}>
        Attach to Node process
      </MenuItem>
      <MenuItem icon={<PanelRightOpen size={14} />} onSelect={() => chrome.runDebugEntry("showViews")}>
        Show debug views
      </MenuItem>
      <MenuSeparator />
      <MenuItem icon={<Columns2 size={14} />} onSelect={chrome.splitRight} shortcut={chrome.shortcuts.split}>
        Split right
      </MenuItem>
      <MenuItem icon={<Rows2 size={14} />} onSelect={chrome.splitDown}>
        Split down
      </MenuItem>
      <MenuItem checked={chrome.ideModeOn} onSelect={chrome.toggleIdeMode}>
        IDE mode
      </MenuItem>
      {chrome.trustNeeded ? (
        <MenuItem icon={<ShieldCheck size={14} />} onSelect={chrome.trustWorkspace}>
          Trust workspace…
        </MenuItem>
      ) : null}
      {chrome.statusRows.length === 0 ? null : (
        <>
          <MenuSeparator />
          <MenuLabel>Editor status</MenuLabel>
          {chrome.statusRows.map((row) => (
            <div className="cv-esub-status-row" key={row.id} role="presentation">
              <span className="cv-esub-status-row__label">{row.label}</span>
              <span className="cv-esub-status-row__value">{row.value}</span>
            </div>
          ))}
        </>
      )}
    </Menu>
  );
}
```

Append these rules to `editorPanel.css`:

```css
.cv-esub-status-row {
  display: flex;
  align-items: center;
  gap: var(--cv-space-5);
  height: 24px;
  padding: 0 var(--cv-space-4);
  font: var(--cv-t-xs) / 1 var(--cv-font-ui);
}

.cv-esub-status-row__label {
  color: var(--cv-fg-subtle);
}

.cv-esub-status-row__value {
  margin-left: auto;
  overflow: hidden;
  color: var(--cv-fg);
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

- [ ] **Step 4: Implement the chrome value hook**

Create `src/components/editorPanel/useEditorChromeValue.ts`:

```ts
import { useMemo, useRef, type ReactNode } from "react";
import type { EditorCursorAuthority, EditorCursorStorePort } from "../../application/editorCursorStore";
import type { NodeRunStatusPresentation } from "../../application/nodeRunWithoutDebuggingPresentation";
import type { WorkbenchBottomPanelView } from "../../domain/artisanRoutes";
import type { LargeSmartDocumentStatus } from "../../domain/largeDocumentPolicy";
import type { StatusBarItemVisibility } from "../../domain/settings";
import type { IntelligenceMode } from "../../domain/workspace";
import type { EditorStatusPresentation } from "../useEditorStatusPresentation";
import type { EditorChrome, EditorChromeActivity, EditorDebugEntry } from "./EditorChromeContext";
import { editorStatusRows } from "./editorStatusRows";

export interface EditorChromeActions {
  showBottomPanelView(view: WorkbenchBottomPanelView): void;
  hideBottomPanel(): void;
  maximizePanel(): void;
  showGoToLine(): void;
  stopNodeRun(): void;
  runCommand(id: string): void;
  toggleIdeMode(): void;
  trustWorkspace(): void;
  revealInFiles(): void;
}

export interface EditorChromeInput {
  readonly activeGroupId: string | null;
  readonly diagnostics: { readonly errors: number; readonly warnings: number };
  readonly panelView: WorkbenchBottomPanelView;
  readonly panelVisible: boolean;
  readonly statusBar: StatusBarItemVisibility;
  readonly status: EditorStatusPresentation;
  readonly activeLanguage: string | null;
  readonly gitBranch: string | null;
  readonly intelligenceMode: IntelligenceMode;
  readonly largeDocumentStatus: LargeSmartDocumentStatus | null;
  readonly dirtyCount: number;
  readonly workspaceTrustLabel: string | null;
  readonly workspaceRoot: string | null;
  readonly workspaceTrusted: boolean;
  readonly nodeRun: NodeRunStatusPresentation | null;
  readonly debugToolbar: ReactNode;
  readonly cursorStore: EditorCursorStorePort | null;
  readonly cursorAuthority: EditorCursorAuthority | null;
  readonly shortcuts: EditorChrome["shortcuts"];
  readonly actions: EditorChromeActions;
}

const DEBUG_COMMANDS: Readonly<Record<Exclude<EditorDebugEntry, "showViews">, string>> = {
  start: "debug.start",
  runWithoutDebugging: "debug.runWithoutDebugging",
  launchConfigurations: "debug.configureNodeLaunchConfigurations",
  attach: "debug.attachNode",
};

export function useEditorChromeValue(input: EditorChromeInput): EditorChrome {
  const actionsRef = useRef(input.actions);
  actionsRef.current = input.actions;
  const problemsOpen = input.panelVisible && input.panelView === "problems";
  const activityVisible =
    input.status.ideActivityLabel !== null &&
    input.status.ideActivityState !== "idle" &&
    (input.statusBar.index || input.statusBar.languageServer);
  const activityLabel = activityVisible ? input.status.ideActivityLabel : null;
  const activityState = input.status.ideActivityState ?? "active";
  const activityDetail = input.status.ideActivityDetail === "" ? null : input.status.ideActivityDetail;
  const statusRowsCache = useRef<StatusRowsCache | null>(null);
  const statusRows = cachedStatusRows(statusRowsCache, {
    activeLanguage: input.activeLanguage,
    workspaceLabel: input.status.workspaceLabel,
    gitBranch: input.gitBranch,
    workspaceTrustLabel: input.workspaceTrustLabel,
    intelligenceMode: input.intelligenceMode,
    largeDocumentStatus: input.largeDocumentStatus,
    dirtyCount: input.dirtyCount,
  });
  const { errors, warnings } = input.diagnostics;
  const { find, problems, split } = input.shortcuts;
  return useMemo<EditorChrome>(() => {
    const activity: EditorChromeActivity | null =
      activityLabel === null ? null : { label: activityLabel, state: activityState, detail: activityDetail };
    return {
      activeGroupId: input.activeGroupId,
      diagnostics: { errors, warnings },
      problemsOpen,
      cursorVisible: input.statusBar.cursorPosition,
      cursorStore: input.cursorStore,
      cursorAuthority: input.cursorAuthority,
      activity,
      nodeRun: input.nodeRun,
      debugToolbar: input.debugToolbar,
      statusRows,
      ideModeOn: input.intelligenceMode === "fullSmart",
      trustNeeded: input.workspaceRoot !== null && !input.workspaceTrusted,
      shortcuts: { find, problems, split },
      toggleProblems: () =>
        problemsOpen ? actionsRef.current.hideBottomPanel() : actionsRef.current.showBottomPanelView("problems"),
      showGoToLine: () => actionsRef.current.showGoToLine(),
      openRuntimeView: () => actionsRef.current.showBottomPanelView("runtime"),
      stopNodeRun: () => actionsRef.current.stopNodeRun(),
      splitRight: () => actionsRef.current.runCommand("editor.splitRight"),
      splitDown: () => actionsRef.current.runCommand("editor.splitDown"),
      toggleIdeMode: () => actionsRef.current.toggleIdeMode(),
      trustWorkspace: () => actionsRef.current.trustWorkspace(),
      revealInFiles: () => actionsRef.current.revealInFiles(),
      runDebugEntry: (entry) => runDebugEntry(actionsRef.current, entry),
    };
  }, [
    activityDetail,
    activityLabel,
    activityState,
    errors,
    find,
    input.activeGroupId,
    input.cursorAuthority,
    input.cursorStore,
    input.debugToolbar,
    input.intelligenceMode,
    input.nodeRun,
    input.statusBar.cursorPosition,
    input.workspaceRoot,
    input.workspaceTrusted,
    problems,
    problemsOpen,
    split,
    statusRows,
    warnings,
  ]);
}

interface StatusRowsCache {
  readonly key: string;
  readonly rows: ReadonlyArray<EditorStatusRow>;
}

function cachedStatusRows(
  cache: { current: StatusRowsCache | null },
  rowsInput: EditorStatusRowsInput,
): ReadonlyArray<EditorStatusRow> {
  const key = [
    rowsInput.activeLanguage,
    rowsInput.workspaceLabel,
    rowsInput.gitBranch,
    rowsInput.workspaceTrustLabel,
    rowsInput.intelligenceMode,
    rowsInput.largeDocumentStatus?.label ?? null,
    rowsInput.dirtyCount,
  ].join("\u0001");
  if (cache.current !== null && cache.current.key === key) return cache.current.rows;
  const rows = editorStatusRows(rowsInput);
  cache.current = { key, rows };
  return rows;
}

function runDebugEntry(actions: EditorChromeActions, entry: EditorDebugEntry): void {
  if (entry === "showViews") {
    actions.showBottomPanelView("debug");
    actions.maximizePanel();
    return;
  }
  actions.runCommand(DEBUG_COMMANDS[entry]);
}
```

Add `EditorStatusRow` to the `./EditorChromeContext` type import, and `type EditorStatusRowsInput` to the `./editorStatusRows` import. The hook contains no lint suppression, so it passes `npm run lint:exhaustive-deps` unchanged.

The command ids above are the ones registered today in `src/application/workbenchDebugCommands.ts` (`debug.start`, `debug.configureNodeLaunchConfigurations`, `debug.attachNode`) and `src/application/workbenchNodeRunCommands.ts` (`debug.runWithoutDebugging`). "Show debug views" needs no new command. It opens the Debug console drawer view and maximizes, and `debugViewsPlacement` then shows the side column.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/components/editorPanel && npm run lint:exhaustive-deps`
Expected: PASS; the exhaustive-deps budget is unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/components/editorPanel
git commit -m "feat(editor): add the editor actions menu and chrome value"
```

---
### Task 7: Editor tabs in the panel strip (context replaces the portal)

**Files:**
- Create: `src/components/editorPanel/EditorPanelDocumentsContext.ts`, `src/components/editorPanel/EditorPanelDocumentsContext.test.tsx`
- Modify: `src/components/EditorGroupView.tsx`, `src/components/EditorGroupView.test.tsx`
- Modify: `src/components/EditorArea.tsx`, `src/components/WorkbenchEditorHost.tsx`, `src/components/workbenchEditorHostPresenter.ts` (+ test)
- Modify: `src/components/WorkbenchShellFrame.tsx` (remove `WorkbenchEditorTabsPortalProvider`), `src/components/WorkbenchShellFrame.test.tsx`
- Modify: `src/components/agentMode/AgentSurfacePanel.tsx` (remove `WorkbenchEditorTabsPortalTarget`)
- Modify: `src/components/agentMode/rightPanel/agentRightPanelTabEntries.ts` (+ test): the editor kind is represented by its document entries
- Delete: `src/components/workbenchEditorTabsPortal.tsx`, `src/components/workbenchEditorTabsPortalContext.ts`
- Integration: `src/components/agentMode/AgentSurfaceHost.tsx` (one context read), `src/App.tsx` (provider)

**Interfaces:**
- Consumes: `editorPanelDocuments`, `editorPanelDocumentsEqual` (Task 4); P6's `AgentRightPanelEditorDocuments = { documents: ReadonlyArray<{ documentId: string; title: string; path: string; dirty: boolean; preview: boolean }>; activeDocumentId: string | null; surfaceActive: boolean; onActivate(documentId: string): void; onClose(documentId: string): void; onOpenFile(): void }`; `AgentRightPanelTabEntry` variant `{ kind: "editorDocument"; id; documentId; label; path; dirty; preview; active }`. P6 marks an entry active when `surfaceActive && activeDocumentId === documentId`, and today places document entries before all surfaces. P7 moves them to the editor kind's position.
- Produces:
  - `type EditorPanelDocumentsValue = Omit<AgentRightPanelEditorDocuments, "surfaceActive">`
  - `EditorPanelDocumentsContext: React.Context<EditorPanelDocumentsValue | null>`
  - `interface EditorPanelDocumentsInput { readonly group: EditorGroup | null; readonly documents: ReadonlyArray<EditorGroupDocument>; onActivate(path: string): void; onClose(path: string): void; onOpenFile(): void; onEmpty(): void }`
  - `useEditorPanelDocumentsValue(input: EditorPanelDocumentsInput): EditorPanelDocumentsValue | null`
  - `EditorGroupViewProps.tabsPlacement: "inline" | "strip"` (`"strip"` means the active group renders no tab row)
  - `WorkbenchEditorHostProps.activeTabsInStrip: boolean`

- [ ] **Step 1: Write the failing tests**

Create `src/components/editorPanel/EditorPanelDocumentsContext.test.tsx`:

```tsx
// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditorDocument } from "../../domain/workspace";
import { mountUi, type MountedUi } from "../../ui/foundation/foundationTestSupport";
import {
  useEditorPanelDocumentsValue,
  type EditorPanelDocumentsInput,
  type EditorPanelDocumentsValue,
} from "./EditorPanelDocumentsContext";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const values: Array<EditorPanelDocumentsValue | null> = [];
let mounted: MountedUi | null = null;

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  values.length = 0;
});

function Probe({ input }: { readonly input: EditorPanelDocumentsInput }) {
  values.push(useEditorPanelDocumentsValue(input));
  return null;
}

function doc(content: string): EditorDocument {
  return { path: "/w/a.ts", name: "a.ts", content, savedContent: "a", language: "typescript" };
}

function input(content: string, handlers = { onActivate: vi.fn(), onClose: vi.fn(), onOpenFile: vi.fn(), onEmpty: vi.fn() }): EditorPanelDocumentsInput {
  return {
    group: { activePath: "/w/a.ts", openPaths: ["/w/a.ts"], previewPath: null },
    documents: [doc(content)],
    ...handlers,
  };
}

describe("useEditorPanelDocumentsValue", () => {
  it("keeps the same value across keystrokes that do not change tab state", () => {
    mounted = mountUi();
    mounted.render(<Probe input={input("a1")} />);
    mounted.render(<Probe input={input("a12")} />);
    mounted.render(<Probe input={input("a123")} />);

    expect(values[1]).toBe(values[0]);
    expect(values[2]).toBe(values[0]);
  });

  it("publishes a new value when the dirty flag flips", () => {
    mounted = mountUi();
    mounted.render(<Probe input={input("a")} />);
    mounted.render(<Probe input={input("a1")} />);

    expect(values[1]).not.toBe(values[0]);
    expect(values[1]?.documents[0]?.dirty).toBe(true);
  });

  it("calls the latest handlers without changing the value", () => {
    const first = { onActivate: vi.fn(), onClose: vi.fn(), onOpenFile: vi.fn(), onEmpty: vi.fn() };
    const second = { onActivate: vi.fn(), onClose: vi.fn(), onOpenFile: vi.fn(), onEmpty: vi.fn() };
    mounted = mountUi();
    mounted.render(<Probe input={input("a1", first)} />);
    mounted.render(<Probe input={input("a12", second)} />);
    values[0]?.onActivate("/w/a.ts");

    expect(values[1]).toBe(values[0]);
    expect(second.onActivate).toHaveBeenCalledWith("/w/a.ts");
    expect(first.onActivate).not.toHaveBeenCalled();
  });

  it("closes the editor surface when the last document closes", () => {
    const handlers = { onActivate: vi.fn(), onClose: vi.fn(), onOpenFile: vi.fn(), onEmpty: vi.fn() };
    mounted = mountUi();
    mounted.render(<Probe input={input("a", handlers)} />);
    mounted.render(<Probe input={{ ...input("a", handlers), group: { activePath: null, openPaths: [], previewPath: null }, documents: [] }} />);

    expect(handlers.onEmpty).toHaveBeenCalledTimes(1);
  });

  it("is null without a group", () => {
    mounted = mountUi();
    mounted.render(<Probe input={{ ...input("a"), group: null }} />);

    expect(values[0]).toBeNull();
  });
});
```

If P6 exported `AgentRightPanelEditorDocuments` from another module (for example `AgentSurfacePanel.tsx`), import it from there. Do not redeclare it.

Append to `src/components/EditorGroupView.test.tsx`:

```tsx
  it("renders no tab row for the active group when tabs live in the panel strip", () => {
    const host = renderGroup({ active: true, tabsPlacement: "strip" });

    expect(host.querySelector('[role="tablist"]')).toBeNull();
    expect(host.querySelector(".editor-panel")?.getAttribute("aria-label")).toBe("orders.ts");
  });

  it("keeps an inline tab row for a non-active split group", () => {
    const host = renderGroup({ active: false, tabsPlacement: "strip" });

    expect(host.querySelector('[role="tablist"]')).not.toBeNull();
  });
```

`renderGroup` is the render helper the file already has. If it has a different name, use that helper and pass `tabsPlacement` through its props override, with a single open document `orders.ts`.

Append to P6's `agentRightPanelTabEntries.test.ts`:

```ts
  it("represents the editor kind by its document entries at the kind's position", () => {
    const entries = agentRightPanelTabEntries({
      ...baseInput,
      openSurfaces: ["files", "editor", "diff"],
      activeSurface: "editor",
      editorDocuments: {
        documents: [
          { documentId: "/w/a.ts", title: "a.ts", path: "/w/a.ts", dirty: true, preview: false },
          { documentId: "/w/b.ts", title: "b.ts", path: "/w/b.ts", dirty: false, preview: true },
        ],
        activeDocumentId: "/w/b.ts",
        surfaceActive: true,
        onActivate: () => undefined,
        onClose: () => undefined,
        onOpenFile: () => undefined,
      },
    });

    expect(entries.map((entry) => entry.kind === "editorDocument" ? `doc:${entry.label}:${entry.active}` : entry.kind)).toEqual([
      "files",
      "doc:a.ts:false",
      "doc:b.ts:true",
      "diff",
    ]);
  });
```

`baseInput` is P6's existing fixture. Use that name, and map non-document entries to whatever discriminant P6 uses (`entry.kind` or `entry.surface`).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/editorPanel/EditorPanelDocumentsContext.test.tsx src/components/EditorGroupView.test.tsx src/components/agentMode/rightPanel/agentRightPanelTabEntries.test.ts`
Expected: FAIL. The module is missing, `tabsPlacement` is unknown, and the editor kind still yields a surface entry.

- [ ] **Step 3: Implement the context hook**

Create `src/components/editorPanel/EditorPanelDocumentsContext.ts`:

```ts
import { createContext, useEffect, useMemo, useRef } from "react";
import type { EditorGroup } from "../../domain/editorGroups";
import type { AgentRightPanelEditorDocuments } from "../agentMode/rightPanel/agentRightPanelTabEntries";
import type { EditorGroupDocument } from "../EditorGroupView";
import {
  editorPanelDocuments,
  editorPanelDocumentsEqual,
  type EditorPanelDocumentsSnapshot,
} from "./editorPanelDocuments";

export type EditorPanelDocumentsValue = Omit<AgentRightPanelEditorDocuments, "surfaceActive">;

export const EditorPanelDocumentsContext = createContext<EditorPanelDocumentsValue | null>(null);

export interface EditorPanelDocumentsInput {
  readonly group: EditorGroup | null;
  readonly documents: ReadonlyArray<EditorGroupDocument>;
  onActivate(path: string): void;
  onClose(path: string): void;
  onOpenFile(): void;
  onEmpty(): void;
}

export function useEditorPanelDocumentsValue(
  input: EditorPanelDocumentsInput,
): EditorPanelDocumentsValue | null {
  const handlersRef = useRef(input);
  handlersRef.current = input;
  const snapshotRef = useRef<EditorPanelDocumentsSnapshot | null>(null);
  const next = input.group === null ? null : editorPanelDocuments(input.group, input.documents);
  const previous = snapshotRef.current;
  const snapshot =
    next !== null && previous !== null && editorPanelDocumentsEqual(previous, next) ? previous : next;
  snapshotRef.current = snapshot;
  const empty = snapshot !== null && snapshot.documents.length === 0;
  const hadDocumentsRef = useRef(false);

  useEffect(() => {
    if (snapshot === null) return;
    if (!empty) {
      hadDocumentsRef.current = true;
      return;
    }
    if (!hadDocumentsRef.current) return;
    hadDocumentsRef.current = false;
    handlersRef.current.onEmpty();
  }, [empty, snapshot]);

  return useMemo(() => {
    if (snapshot === null) return null;
    return {
      documents: snapshot.documents,
      activeDocumentId: snapshot.activeDocumentId,
      onActivate: (documentId: string) => handlersRef.current.onActivate(documentId),
      onClose: (documentId: string) => handlersRef.current.onClose(documentId),
      onOpenFile: () => handlersRef.current.onOpenFile(),
    };
  }, [snapshot]);
}
```

The hook writes to refs during render (`handlersRef.current = input`, `snapshotRef.current = snapshot`). That is the same latest-value pattern as `usePrivateDebugPanelElement.tsx`. If the repository's lint rules flag ref writes during render, move the two assignments into a `useLayoutEffect` and compute `previous` from a `useState`-held snapshot. Keep the test expectations unchanged.

- [ ] **Step 4: Tabs placement in the editor group, portal removal**

In `src/components/EditorGroupView.tsx`:
- Remove the imports of `createPortal` and `useWorkbenchEditorTabsPortalTarget`.
- Add `tabsPlacement: "inline" | "strip"` to `EditorGroupViewProps` and to `editorGroupViewPropsEqual`.
- Compute `const tabsInline = tabsPlacement === "inline" || !active;`.
- Render `{tabsInline ? tabs : null}` in place of the portal ternary.
- On the `.editor-panel` element:
  - set `aria-labelledby` only when `tabsInline`;
  - otherwise set `aria-label={activeDocument?.name}`.

In `EditorArea.tsx` and `WorkbenchEditorHost.tsx`, thread a new required prop `activeTabsInStrip: boolean` down to every `EditorGroupView` as `tabsPlacement={activeTabsInStrip ? "strip" : "inline"}`. In `workbenchEditorHostPresenter.ts`, add `activeTabsInStrip` to the input and output of `workbenchEditorHostProps`. Pin it in `workbenchEditorHostPresenter.test.ts`:

```ts
  it("passes the strip placement through to the editor host", () => {
    expect(workbenchEditorHostProps({ ...baseInput, activeTabsInStrip: true }).activeTabsInStrip).toBe(true);
  });
```

In `WorkbenchShellFrame.tsx`, delete the `<WorkbenchEditorTabsPortalProvider>` wrapper and keep its children. In `AgentSurfacePanel.tsx`, delete `<WorkbenchEditorTabsPortalTarget />` and its import. Delete the two portal modules. Then run `rg -n "WorkbenchEditorTabsPortal|workbenchEditorTabsPortal" src`, which must print nothing. In tests that asserted the portal, including `WorkbenchShellFrame.test.tsx` and `EditorGroupView.test.tsx`, delete only those assertions.

In P6's `agentRightPanelTabEntries.ts`, when iterating `openSurfaces`:
- Move P6's existing `editorDocument` entry emission, which today sits before all surfaces, into the loop at the `"editor"` kind's position. Keep P6's entry shape and its `active` rule (`surfaceActive && activeDocumentId === documentId`).
- Emit nothing for the kind itself.
- If `editorDocuments` is null or empty, emit nothing.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/components/editorPanel src/components/EditorGroupView.test.tsx src/components/EditorArea.test.tsx src/components/WorkbenchEditorHost.test.tsx src/components/workbenchEditorHostPresenter.test.ts src/components/WorkbenchShellFrame.test.tsx src/components/agentMode && npm run check`
Expected: PASS, 0 type errors.

- [ ] **Step 6: Integration (lead)**

In `src/components/agentMode/AgentSurfaceHost.tsx`, read the context and add `surfaceActive` with a memo, so the value only changes when the context value or the active surface changes:

```tsx
  const editorDocumentsValue = useContext(EditorPanelDocumentsContext);
  const editorSurfaceActive = layout.activeSurface === "editor";
  const editorDocuments = useMemo(
    () =>
      editorDocumentsValue === null || activation.remote
        ? null
        : { ...editorDocumentsValue, surfaceActive: editorSurfaceActive },
    [activation.remote, editorDocumentsValue, editorSurfaceActive],
  );
```

Pass `editorDocuments={editorDocuments}` to `<AgentSurfacePanel>`. `layout` and `activation` are the layout state and the `AgentSurfaceActivation` the host already computes. If the host names them differently, use its names.

In `src/App.tsx`, after `editorGroupsState` is computed:

```tsx
  const activeEditorGroup = editorGroupsState.groups[editorGroupsState.activeGroupId] ?? null;
  const editorPanelDocumentsValue = useEditorPanelDocumentsValue({
    group: activeEditorGroup,
    documents: editorAreaDocuments,
    onActivate: (path) => {
      editorHost.activateEditorGroupTab(editorGroupsState.activeGroupId, path);
      workbench.agentWorkbench.dispatch({ kind: "activateSurface", surface: "editor" });
    },
    onClose: (path) => editorHost.closeDocumentInEditorGroup(editorGroupsState.activeGroupId, path),
    onOpenFile: () => editorHost.setQuickOpenOpen(true),
    onEmpty: () => workbench.agentWorkbench.dispatch({ kind: "closeSurfaceTab", surface: "editor" }),
  });
```

Wrap the returned `<main>` element's children in `<EditorPanelDocumentsContext.Provider value={editorPanelDocumentsValue}>`. Pass `activeTabsInStrip: workbench.agentModeActive` into `workbenchEditorHostProps({...})`.

Run: `npx vitest run src/App.commandRouting.test.tsx src/App.quickOpen.integration.test.tsx src/components/agentMode`
Expected: PASS. Assertions that relied on the old tabs portal, if any, now find the tabs in `.cv-tabs` inside the right panel. Update those selectors only.

- [ ] **Step 7: Commit**

```bash
git add src/components/editorPanel src/components/EditorGroupView.tsx src/components/EditorGroupView.test.tsx src/components/EditorArea.tsx src/components/WorkbenchEditorHost.tsx src/components/workbenchEditorHostPresenter.ts src/components/workbenchEditorHostPresenter.test.ts src/components/WorkbenchShellFrame.tsx src/components/WorkbenchShellFrame.test.tsx src/components/agentMode src/App.tsx
git rm src/components/workbenchEditorTabsPortal.tsx src/components/workbenchEditorTabsPortalContext.ts
git commit -m "feat(editor): show editor tabs in the right panel strip"
```

---

### Task 8: Editor slot in the editor kind and file-open reveal

**Files:**
- Create: `src/components/editorPanel/useEditorSurfaceReveal.ts`, `src/components/editorPanel/useEditorSurfaceReveal.test.tsx`
- Modify: `src/components/workbenchShellFrame.css` (editor slot rules only), `src/components/workbenchShellFrame.expanded.test.ts` if it pins the tree offset
- Modify: `src/components/agentMode/rightPanel/files/AgentFilesSurface.tsx` (+ test): remove the editor slot; the tree fills the surface
- Integration: `src/components/agentMode/AgentWorkbenchScreen.tsx` (reveal helper), `src/components/commandPalette/WorkbenchCommandPalette.tsx` (one line)

**Interfaces:**
- Consumes: `AgentWorkbenchLayoutAction`, `WorkbenchPanelPlacement` / `workbenchPanelPlacement` (Task 2).
- Produces:
  - `useEditorSurfaceReveal(dispatch: (action: AgentWorkbenchLayoutAction) => void): () => void`: a stable callback that dispatches `{ kind: "openSurface", surface: "editor" }`.
  - `useEditorDrawerReveal(input: { readonly ownerKey: string | null; readonly drawerView: EditorDrawerView | null; reveal(): void }): void`: calls `reveal()` when `drawerView` changes from `null` to a view within the same owner key. It never fires on an owner change or on the first observation.

- [ ] **Step 1: Write the failing test**

Create `src/components/editorPanel/useEditorSurfaceReveal.test.tsx`:

```tsx
// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditorDrawerView } from "../../domain/editorDrawer";
import { mountUi, type MountedUi } from "../../ui/foundation/foundationTestSupport";
import { useEditorDrawerReveal, useEditorSurfaceReveal } from "./useEditorSurfaceReveal";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let mounted: MountedUi | null = null;

afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

function DrawerProbe(props: { readonly ownerKey: string | null; readonly drawerView: EditorDrawerView | null; reveal(): void }) {
  useEditorDrawerReveal(props);
  return null;
}

describe("useEditorDrawerReveal", () => {
  it("reveals the editor when a drawer view opens, once per opening", () => {
    const reveal = vi.fn();
    mounted = mountUi();
    mounted.render(<DrawerProbe drawerView={null} ownerKey="/a" reveal={reveal} />);
    mounted.render(<DrawerProbe drawerView="problems" ownerKey="/a" reveal={reveal} />);
    mounted.render(<DrawerProbe drawerView="debug" ownerKey="/a" reveal={reveal} />);
    mounted.render(<DrawerProbe drawerView={null} ownerKey="/a" reveal={reveal} />);
    mounted.render(<DrawerProbe drawerView="search" ownerKey="/a" reveal={reveal} />);

    expect(reveal).toHaveBeenCalledTimes(2);
  });

  it("does not reveal on first observation or on a workspace switch that restores an open drawer", () => {
    const reveal = vi.fn();
    mounted = mountUi();
    mounted.render(<DrawerProbe drawerView="problems" ownerKey="/a" reveal={reveal} />);
    mounted.render(<DrawerProbe drawerView={null} ownerKey="/b" reveal={reveal} />);
    mounted.render(<DrawerProbe drawerView="problems" ownerKey="/a" reveal={reveal} />);

    expect(reveal).not.toHaveBeenCalled();
  });
});

describe("useEditorSurfaceReveal", () => {
  it("dispatches openSurface editor through a stable callback", () => {
    const dispatch = vi.fn();
    const callbacks: Array<() => void> = [];
    function Probe() {
      callbacks.push(useEditorSurfaceReveal(dispatch));
      return null;
    }
    mounted = mountUi();
    mounted.render(<Probe />);
    mounted.render(<Probe />);
    callbacks[1]?.();

    expect(callbacks[1]).toBe(callbacks[0]);
    expect(dispatch).toHaveBeenCalledWith({ kind: "openSurface", surface: "editor" });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/editorPanel/useEditorSurfaceReveal.test.tsx`
Expected: FAIL with unresolved import.

- [ ] **Step 3: Implement**

Create `src/components/editorPanel/useEditorSurfaceReveal.ts`:

```ts
import { useCallback, useEffect, useRef } from "react";
import type { AgentWorkbenchLayoutAction } from "../../domain/agentWorkbenchLayout";
import type { EditorDrawerView } from "../../domain/editorDrawer";

export function useEditorSurfaceReveal(
  dispatch: (action: AgentWorkbenchLayoutAction) => void,
): () => void {
  const dispatchRef = useRef(dispatch);
  useEffect(() => {
    dispatchRef.current = dispatch;
  }, [dispatch]);
  return useCallback(() => {
    dispatchRef.current({ kind: "openSurface", surface: "editor" });
  }, []);
}

export interface EditorDrawerRevealInput {
  readonly ownerKey: string | null;
  readonly drawerView: EditorDrawerView | null;
  reveal(): void;
}

interface ObservedDrawer {
  readonly ownerKey: string | null;
  readonly open: boolean;
}

export function useEditorDrawerReveal({ drawerView, ownerKey, reveal }: EditorDrawerRevealInput): void {
  const observedRef = useRef<ObservedDrawer | null>(null);
  const revealRef = useRef(reveal);
  useEffect(() => {
    revealRef.current = reveal;
  }, [reveal]);
  const open = drawerView !== null;
  useEffect(() => {
    const previous = observedRef.current;
    observedRef.current = { ownerKey, open };
    if (previous === null || previous.ownerKey !== ownerKey) return;
    if (previous.open || !open) return;
    revealRef.current();
  }, [open, ownerKey]);
}
```

In the first `useEditorSurfaceReveal` test render the callback must not have run yet. `dispatchRef` is initialised from the first argument, so the callback works even before the effect runs.

- [ ] **Step 4: Move the editor slot to the editor kind**

In `src/components/workbenchShellFrame.css`, change the agent editor slot rule to:

```css
.workbench-frame[data-layout="agent"] > [data-slot="editor"] {
  z-index: 1;
  padding-top: var(--agent-surface-header-height);
  background: var(--cv-canvas);
  background-clip: content-box;
  clip-path: inset(var(--agent-surface-header-height) 0 0 0);
  grid-column: 3;
  grid-row: 1 / -1;
  pointer-events: none;
}
```

Delete the rule `.workbench-frame[data-layout="agent"][data-editor="empty"][data-tree="visible"] > [data-slot="editor"] { display: none; }`. The editor kind has no tree. Keep the `:has(... [data-editor-slot="none"])` rule unchanged. It now hides the overlay for every non-editor surface, because `agentSurfaceEditorSlot` returns `"open"` only for `"editor"` (Task 1).

If `--agent-surface-header-height` no longer matches P2's panel `TopBar` height, set it to P2's token (`var(--cv-topbar-h)`) at its declaration in `workbenchShellFrame.css`. Do not hard-code 52px.

In P6's `AgentFilesSurface.tsx` (props `{ fileTree; treeShown; activePath; editorSlot }`):
- drop the `editorSlot` prop, the editor-slot column and the crumb row (Copy path / Open in editor), so the tree and search fill the surface;
- update the caller in `AgentRightPanelSurfaceBody.tsx` to stop passing `editorSlot`.

The editor sub-header now shows the path. Opening a file from the tree opens it in the editor kind (Step 6), which replaces "Open in editor". "Copy path" must stay reachable. Run `rg -n "Copy path|Copy Path" src/components/FileTree* src/components/agentMode`. If the file-tree context menu offers it, nothing else is needed. If not, add a `Copy path` item to `EditorMoreMenu` (Task 6 file). It calls a new `EditorChrome.copyActivePath()`, which `useEditorChromeValue` maps to `actions.runCommand` with the id that `rg -n '"[a-z.]*[cC]opy[A-Za-z]*[pP]ath"' src/application` finds for copying the active file path. Add a test case to `EditorMoreMenu.test.tsx` that clicks it and expects that command.

In its test, replace the editor-slot and crumb assertions with `expect(host.querySelector("[data-agent-editor-slot]")).toBeNull();`.

If `workbenchShellFrame.expanded.test.ts` pins `padding-left: var(--agent-surface-tree-width)`, change that expectation to the absence of `padding-left` in the rule.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/components/editorPanel/useEditorSurfaceReveal.test.tsx src/components/workbenchShellFrame.expanded.test.ts src/components/agentMode/rightPanel/files`
Expected: PASS.

- [ ] **Step 6: Integration - route file opens to the editor kind (lead)**

In `src/components/agentMode/AgentWorkbenchScreen.tsx`, replace:

```tsx
  const revealFilesSurface = useCallback(() => {
    dispatchAgentWorkbench({ kind: "openSurface", surface: "files" });
  }, [dispatchAgentWorkbench]);
```

with:

```tsx
  const revealEditorSurface = useEditorSurfaceReveal(dispatchAgentWorkbench);
```

Rename every use of `revealFilesSurface` in that file to `revealEditorSurface`. These are the artifact `openFile`, `openTerminalLink`, `openFileLocation` and every file-tree chrome callback. P6's surfaces reach file opening through `AgentRightPanelContext` (`src/components/agentMode/rightPanel/agentRightPanelContext.ts`), and its `openFile(absolutePath)` / `previewFile(absolutePath)` call `chrome.fileTree.onOpenFile` / `onPreviewFile`. Wrapping those two chrome callbacks where they are built, in `AgentWorkbenchScreen.tsx` / `agentWorkbenchChrome.ts`, as `openThenRevealFiles(() => <open>, revealEditorSurface)` therefore reroutes every P6 "open in editor" path at once. Then run:

`rg -n "onPreviewFile|onOpenFile|openChangedFile|openChangedFileDiff|onOpenChange" src/components/agentMode src/application/useWorkbenchControllerAgents.ts`

At each agent-mode call site that opens a document in the editor, wrap the open in the existing helper: `openThenRevealFiles(() => <open>, revealEditorSurface)`. P6 surfaces pass their callbacks through `AgentWorkbenchScreen` / `agentWorkbenchChrome.ts`, so wrap them there. Do not edit P6's surface components.

In `src/components/commandPalette/WorkbenchCommandPalette.tsx`, `openPaletteFile` becomes:

```tsx
export async function openPaletteFile(
  workbench: Workbench,
  result: FileSearchResult,
  location?: QuickOpenLocation,
): Promise<void> {
  await workbench.openSearchResult(result, location);
  if (workbench.activePath !== null) {
    workbench.agentWorkbench.dispatch({ kind: "openSurface", surface: "editor" });
  }
}
```

`openSearchResult` resolves `void`. Revealing is harmless when the open failed, because the editor then shows its empty state. The `activePath` guard only avoids popping an empty panel open when nothing was ever opened. Mounting `useEditorDrawerReveal` happens in Task 9.

Run: `npx vitest run src/components/agentMode/AgentWorkbenchScreen.test.tsx src/components/commandPalette src/App.quickOpen.integration.test.tsx`
Expected: PASS. Tests that expected `openSurface` with `surface: "files"` after opening a file now expect `surface: "editor"`. Update those expectations only.

- [ ] **Step 7: Commit**

```bash
git add src/components/editorPanel src/components/workbenchShellFrame.css src/components/workbenchShellFrame.expanded.test.ts src/components/agentMode src/components/commandPalette/WorkbenchCommandPalette.tsx
git commit -m "feat(editor): host the editor in its own surface and reveal it on file open"
```

---
### Task 9: Problems / panel-views drawer inside the editor

**Files:**
- Create: `src/components/workbenchPanelViews.tsx` (moved `renderActivePanel` -> `WorkbenchPanelViewContent`)
- Create: `src/components/editorPanel/EditorDrawer.tsx`, `src/components/editorPanel/EditorDrawer.test.tsx`
- Create: `src/components/editorPanel/EditorDrawerExtrasContext.ts`
- Create: `src/components/editorPanel/WorkbenchEditorDrawerHost.tsx`, `src/components/editorPanel/WorkbenchEditorDrawerHost.test.tsx`
- Create: `src/components/editorPanel/EditorPanelLayout.tsx`, `src/components/editorPanel/EditorPanelLayout.test.tsx`
- Modify: `src/ui/foundation/ResizeHandle.tsx`, `src/ui/foundation/panels.test.tsx`, `src/ui/foundation/panels.css` (additive `axis` prop)
- Modify: `src/components/BottomPanel.tsx`, `src/components/BottomPanel.test.tsx` (terminal-only; non-terminal assertions move to `WorkbenchEditorDrawerHost.test.tsx`)
- Modify: `src/components/WorkbenchBottomPanelHost.tsx`
- Modify: `src/components/ProblemsPanel.tsx`, `src/components/ProblemsPanel.test.tsx` (toolbar portal + mockup rows)
- Modify: `src/domain/keymap.ts`, `src/domain/keymap.test.ts`, `src/application/workbenchPanelCommands.ts` (⇧⌘M)
- Integration: `src/App.tsx`, `src/App.css` (delete `.bottom-panel-tab*`, `.problems-*` and `.problem-row*` rule blocks; keep `.bottom-panel`, `.bottom-panel-header` and `.bottom-panel-resize-handle` used by the terminal)

**Interfaces:**
- Consumes: `workbenchPanelPlacement`, `editorDrawerTabs`, `editorDrawerMoreViews`, `editorDrawerViewLabel`, `EditorDrawerAvailability`, `EditorDrawerView` (Task 2); `useEditorDrawerReveal`, `useEditorSurfaceReveal` (Task 8); `WorkbenchBottomPanelHostProps`, `workbenchBottomPanelHostProps` (existing); `PhpTreePanel` (existing).
- Produces:
  - `WorkbenchPanelViewContent(props: WorkbenchPanelViewContentProps): ReactNode`, where `WorkbenchPanelViewContentProps` is the old `RenderActivePanelOptions` plus `readonly search: ReactNode; readonly phpTree: ReactNode` and `activeView: WorkbenchBottomPanelView`
  - `ResizeHandleProps.axis?: "x" | "y"` (default `"x"`)
  - `EditorDrawerExtrasContext: React.Context<HTMLElement | null>`
  - `interface EditorDrawerFrame { readonly height: number; onResize(height: number): void }`
  - `EditorDrawer(props: EditorDrawerProps)`
  - `editorDrawerAvailabilityFromPanel(props: BottomPanelHostProps): EditorDrawerAvailability`
  - `WorkbenchEditorDrawerHost(props: WorkbenchBottomPanelHostProps & { readonly view: EditorDrawerView; readonly frame: EditorDrawerFrame; readonly consoleHeader: ReactNode })`
  - `EditorPanelLayout(props: { readonly area: ReactNode; readonly renderDrawer: ((frame: EditorDrawerFrame) => ReactNode) | null; readonly debugViews: ReactNode; readonly message: string | null })`
  - `DEFAULT_EDITOR_DRAWER_HEIGHT = 224`, `MIN_EDITOR_DRAWER_HEIGHT = 120`, `MAX_EDITOR_DRAWER_HEIGHT = 640`

- [ ] **Step 1: Write the failing tests**

Append to `src/ui/foundation/panels.test.tsx`:

```tsx
describe("ResizeHandle on the y axis", () => {
  it("grows a bottom drawer when dragged up and with ArrowUp", () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    mounted = mountUi();
    mounted.render(
      <ResizeHandle axis="y" edge="start" label="Resize" max={640} min={120} onChange={onChange} onCommit={onCommit} value={224} />,
    );
    const handle = mounted.host.querySelector('[role="separator"]') as HTMLElement;

    expect(handle.getAttribute("aria-orientation")).toBe("horizontal");
    pointer(handle, "pointerdown", { button: 0, clientX: 0, clientY: 500, pointerId: 1 });
    pointer(handle, "pointermove", { clientX: 0, clientY: 460, pointerId: 1 });
    expect(onChange).toHaveBeenLastCalledWith(264);
    press(handle, "ArrowUp");
    expect(onCommit).toHaveBeenLastCalledWith(240);
    press(handle, "ArrowLeft");
    expect(onCommit).toHaveBeenCalledTimes(1);
  });
});
```

`mounted`, `pointer` and `press` are the helpers `panels.test.tsx` already imports from `foundationTestSupport`. If the file uses different local names, use those.

Create `src/components/editorPanel/EditorDrawer.test.tsx`:

```tsx
// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditorDrawerAvailability } from "../../domain/editorDrawer";
import { click, mountUi, type MountedUi } from "../../ui/foundation/foundationTestSupport";
import { EditorDrawer, type EditorDrawerProps } from "./EditorDrawer";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const JS: EditorDrawerAvailability = {
  artisan: false,
  expressRoutes: true,
  javaScriptWorkspace: true,
  nette: false,
  symfony: false,
  phpWorkspace: false,
};

let mounted: MountedUi | null = null;

afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

function renderDrawer(overrides: Partial<EditorDrawerProps> = {}) {
  const props: EditorDrawerProps = {
    view: "problems",
    availability: JS,
    problemCount: 3,
    headerExtras: null,
    height: 224,
    onSelectView: vi.fn(),
    onClose: vi.fn(),
    onResize: vi.fn(),
    children: <div data-testid="body">body</div>,
    ...overrides,
  };
  mounted = mountUi();
  mounted.render(<EditorDrawer {...props} />);
  return { host: mounted.host, props };
}

describe("EditorDrawer", () => {
  it("shows Problems with its count and Debug console, Problems selected", () => {
    const { host } = renderDrawer();
    const tabs = [...host.querySelectorAll('[role="tab"]')];

    expect(tabs.map((tab) => tab.textContent)).toEqual(["Problems3", "Debug console"]);
    expect(tabs[0]?.getAttribute("aria-selected")).toBe("true");
    expect(host.querySelector('[role="tabpanel"][aria-label="Problems"] [data-testid="body"]')).not.toBeNull();
  });

  it("selects a view, lists the other views in More views, and closes", () => {
    const { host, props } = renderDrawer();
    click(host.querySelectorAll('[role="tab"]')[1] as Element);
    click(host.querySelector('button[aria-label="More views"]') as Element);
    const menu = document.body.querySelector('[role="menu"][aria-label="More views"]');
    const labels = [...(menu?.querySelectorAll('[role="menuitem"]') ?? [])].map((item) => item.textContent);
    click([...(menu?.querySelectorAll('[role="menuitem"]') ?? [])].find((item) => item.textContent === "Search") as Element);
    click(host.querySelector('button[aria-label="Close panel views"]') as Element);

    expect(props.onSelectView).toHaveBeenNthCalledWith(1, "debug");
    expect(labels).toEqual(["Search", "Tests", "Index", "Runtime", "History", "Express routes", "Packages"]);
    expect(props.onSelectView).toHaveBeenNthCalledWith(2, "search");
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("adds the active secondary view as a third tab and uses the given height", () => {
    const { host } = renderDrawer({ view: "search" });

    expect([...host.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent)).toEqual([
      "Problems3",
      "Debug console",
      "Search",
    ]);
    expect((host.querySelector(".cv-edrawer") as HTMLElement).style.height).toBe("224px");
  });
});
```

Create `src/components/editorPanel/WorkbenchEditorDrawerHost.test.tsx`. It pins the availability mapping and moves the non-terminal view assertions out of `BottomPanel.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { editorDrawerAvailabilityFromPanel } from "./WorkbenchEditorDrawerHost";

describe("editorDrawerAvailabilityFromPanel", () => {
  it("mirrors the old bottom panel's conditional tabs", () => {
    expect(
      editorDrawerAvailabilityFromPanel({
        hasArtisan: true,
        hasExpressRoutes: false,
        hasJsWorkspace: false,
        hasNette: true,
        hasPhpWorkspace: true,
        hasSymfony: false,
      }),
    ).toEqual({
      artisan: true,
      expressRoutes: false,
      javaScriptWorkspace: false,
      nette: true,
      symfony: false,
      phpWorkspace: true,
    });
  });

  it("defaults express routes to the JavaScript workspace signal like BottomPanel did", () => {
    expect(editorDrawerAvailabilityFromPanel({ hasJsWorkspace: true }).expressRoutes).toBe(true);
    expect(editorDrawerAvailabilityFromPanel({}).javaScriptWorkspace).toBe(false);
  });
});
```

Also, for every `it(...)` in `BottomPanel.test.tsx` that renders a non-terminal view (problems, index, runtime, history, debug, search, routes, expressRoutes, packages, nette, symfony, testResults):
- move it into `WorkbenchEditorDrawerHost.test.tsx`;
- render `<WorkbenchPanelViewContent {...sameProps} activeView="<view>" search={null} phpTree={null} />` from `../workbenchPanelViews`, using the same fixture props;
- keep the assertions on the rendered view content;
- delete the tab-bar assertions. `EditorDrawer.test.tsx` covers the tab bar.

`BottomPanel.test.tsx` keeps only the terminal cases.

Create `src/components/editorPanel/EditorPanelLayout.test.tsx`:

```tsx
// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { mountUi, type MountedUi } from "../../ui/foundation/foundationTestSupport";
import { DEFAULT_EDITOR_DRAWER_HEIGHT, EditorPanelLayout, type EditorDrawerFrame } from "./EditorPanelLayout";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let mounted: MountedUi | null = null;

afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe("EditorPanelLayout", () => {
  it("stacks the editor area and the drawer and keeps the drawer height across reopenings", () => {
    const frames: EditorDrawerFrame[] = [];
    const renderDrawer = (frame: EditorDrawerFrame) => {
      frames.push(frame);
      return <div data-testid="drawer" />;
    };
    mounted = mountUi();
    mounted.render(<EditorPanelLayout area={<div data-testid="area" />} debugViews={null} message={null} renderDrawer={renderDrawer} />);

    expect(frames[0]?.height).toBe(DEFAULT_EDITOR_DRAWER_HEIGHT);
    act(() => frames[0]?.onResize(300));
    mounted.render(<EditorPanelLayout area={<div data-testid="area" />} debugViews={null} message={null} renderDrawer={null} />);
    mounted.render(<EditorPanelLayout area={<div data-testid="area" />} debugViews={null} message={null} renderDrawer={renderDrawer} />);

    expect(frames[frames.length - 1]?.height).toBe(300);
    expect(mounted.host.querySelector(".cv-editor-panel__column [data-testid='area']")).not.toBeNull();
  });

  it("renders the debug side column and marks the layout", () => {
    mounted = mountUi();
    mounted.render(<EditorPanelLayout area={null} debugViews={<aside data-testid="dside" />} message={null} renderDrawer={null} />);

    expect(mounted.host.querySelector(".cv-editor-panel")?.getAttribute("data-debug-views")).toBe("side");
    expect(mounted.host.querySelector("[data-testid='dside']")).not.toBeNull();
  });

  it("shows a transient message as a toast", () => {
    mounted = mountUi();
    mounted.render(<EditorPanelLayout area={null} debugViews={null} message="Saved app.ts" renderDrawer={null} />);

    expect(mounted.host.textContent).toContain("Saved app.ts");
  });
});
```

Append to `src/domain/keymap.test.ts`:

```ts
  it("binds Show Problems to Cmd+Shift+M without colliding", () => {
    const entry = DEFAULT_KEYBINDINGS.find((binding) => binding.id === "panel.showProblems");

    expect(entry?.defaultShortcut).toBe("Cmd+Shift+M");
    expect(DEFAULT_KEYBINDINGS.filter((binding) => binding.defaultShortcut === "Cmd+Shift+M")).toHaveLength(1);
  });
```

Use the name that `keymap.ts` exports for the default binding list (read the top of `keymap.test.ts`). If it is not `DEFAULT_KEYBINDINGS`, rename it in the test only.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/ui/foundation/panels.test.tsx src/components/editorPanel src/domain/keymap.test.ts`
Expected: FAIL. The `axis` prop is unknown, `./EditorDrawer`, `./WorkbenchEditorDrawerHost` and `./EditorPanelLayout` are missing, and there is no `panel.showProblems` binding.

- [ ] **Step 3: Foundation resize axis**

In `src/ui/foundation/ResizeHandle.tsx`, add `readonly axis?: "x" | "y"` (default `"x"`):
- The drag origin and move read `event.clientY` when `axis === "y"`. Rename `originX` to `origin` and keep the other names.
- `aria-orientation` is `axis === "y" ? "horizontal" : "vertical"`.
- Add `cv-resize--y` to the class list when `axis === "y"`.
- The keyboard handler maps keys before calling `keyboardValue`:

```ts
function axisKey(axis: "x" | "y", key: string): string {
  if (axis === "x") return key;
  if (key === "ArrowUp") return "ArrowLeft";
  if (key === "ArrowDown") return "ArrowRight";
  if (key === "ArrowLeft" || key === "ArrowRight") return "";
  return key;
}
```

Append to `panels.css`:

```css
.cv-resize--y {
  width: auto;
  height: 6px;
  cursor: row-resize;
}
```

If `.cv-resize` sets positional properties (`top`, `bottom`, `inset-block`), override them for `--y` so the handle sits on the top edge: `inset: -3px 0 auto 0`.

- [ ] **Step 4: Move the view renderer out of `BottomPanel` and make the bottom panel terminal-only**

Create `src/components/workbenchPanelViews.tsx`. Move `renderActivePanel`, its `RenderActivePanelOptions` type and every helper it alone uses out of `BottomPanel.tsx` verbatim. Rename them to `WorkbenchPanelViewContent` / `WorkbenchPanelViewContentProps`. Add two props:
- `readonly search: ReactNode`, returned for `activeView === "search"` (today's `null` return becomes `return search;`);
- `readonly phpTree: ReactNode`, returned for `activeView === "phpTree"`.

Export `WorkbenchPanelViewContent` as a function component. Its body is the old function body.

In `BottomPanel.tsx`:
- Delete the tab list, the non-terminal views and the problems header actions.
- Keep the resize handle, the terminal title, the terminal profile/toolbar host and the lazy `TerminalTabsPanel` exactly as they are.
- Keep the props interface. Unused non-terminal props become optional and are ignored.

`BottomPanel` always renders the terminal. `bottomPanelViews` and `agentHiddenBottomPanelViews` are deleted.

In `WorkbenchBottomPanelHost.tsx`, drop the `search` element (search now renders in the drawer) and the `viewScope` prop.

- [ ] **Step 5: Drawer components**

Create `src/components/editorPanel/EditorDrawerExtrasContext.ts`:

```ts
import { createContext } from "react";

export const EditorDrawerExtrasContext = createContext<HTMLElement | null>(null);
```

Create `src/components/editorPanel/EditorDrawer.tsx`:

```tsx
import { ChevronDown, X } from "lucide-react";
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  editorDrawerMoreViews,
  editorDrawerTabs,
  editorDrawerViewLabel,
  type EditorDrawerAvailability,
  type EditorDrawerView,
} from "../../domain/editorDrawer";
import { IconButton } from "../../ui/foundation/IconButton";
import { Menu } from "../../ui/foundation/Menu";
import { MenuItem } from "../../ui/foundation/MenuItem";
import { ResizeHandle } from "../../ui/foundation/ResizeHandle";
import { rovingIndex } from "../../ui/foundation/roving";
import { EditorDrawerExtrasContext } from "./EditorDrawerExtrasContext";
import { MAX_EDITOR_DRAWER_HEIGHT, MIN_EDITOR_DRAWER_HEIGHT } from "./editorDrawerSize";

export interface EditorDrawerProps {
  readonly view: EditorDrawerView;
  readonly availability: EditorDrawerAvailability;
  readonly problemCount: number;
  readonly headerExtras: ReactNode;
  readonly height: number;
  readonly children: ReactNode;
  onSelectView(view: EditorDrawerView): void;
  onClose(): void;
  onResize(height: number): void;
}

export function EditorDrawer(props: EditorDrawerProps) {
  const { availability, children, headerExtras, height, onClose, onResize, onSelectView, problemCount, view } = props;
  const tabs = editorDrawerTabs(view, availability);
  const more = editorDrawerMoreViews(availability);
  const moreRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [extrasHost, setExtrasHost] = useState<HTMLDivElement | null>(null);
  const selectedIndex = tabs.findIndex((tab) => tab.view === view);
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const next = rovingIndex(event.key, selectedIndex, tabs.length, "horizontal");
    if (next === null) return;
    const tab = tabs[next];
    if (tab === undefined) return;
    event.preventDefault();
    onSelectView(tab.view);
    listRef.current?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
  };
  return (
    <section aria-label="Panel views" className="cv-edrawer" data-view={view} style={{ height: `${height}px` }}>
      <ResizeHandle
        axis="y"
        edge="start"
        label="Resize panel views"
        max={MAX_EDITOR_DRAWER_HEIGHT}
        min={MIN_EDITOR_DRAWER_HEIGHT}
        onChange={onResize}
        value={height}
      />
      <div className="cv-edrawer__head">
        <div aria-label="Panel views" className="cv-edrawer__tabs" onKeyDown={handleKeyDown} ref={listRef} role="tablist">
          {tabs.map((tab) => (
            <button
              aria-selected={tab.view === view}
              className="cv-edrawer__tab"
              key={tab.view}
              onClick={() => onSelectView(tab.view)}
              role="tab"
              tabIndex={tab.view === view ? 0 : -1}
              type="button"
            >
              {tab.label}
              {tab.view === "problems" && problemCount > 0 ? <span className="cv-edrawer__count">{problemCount}</span> : null}
            </button>
          ))}
        </div>
        <IconButton
          aria-expanded={moreOpen}
          aria-haspopup="menu"
          icon={<ChevronDown size={14} />}
          label="More views"
          onClick={() => setMoreOpen((open) => !open)}
          ref={moreRef}
          size="xs"
        />
        <Menu anchorRef={moreRef} label="More views" onClose={() => setMoreOpen(false)} open={moreOpen}>
          {more.map((item) => (
            <MenuItem key={item.view} onSelect={() => onSelectView(item.view)}>
              {item.label}
            </MenuItem>
          ))}
        </Menu>
        <div className="cv-edrawer__end">
          <div className="cv-edrawer__extras" ref={setExtrasHost} />
          {headerExtras}
          <IconButton icon={<X size={14} />} label="Close panel views" onClick={onClose} size="xs" title="Close" />
        </div>
      </div>
      <div aria-label={editorDrawerViewLabel(view)} className="cv-edrawer__body" role="tabpanel">
        <EditorDrawerExtrasContext.Provider value={extrasHost}>{children}</EditorDrawerExtrasContext.Provider>
      </div>
    </section>
  );
}
```

Create `src/components/editorPanel/editorDrawerSize.ts`:

```ts
export const DEFAULT_EDITOR_DRAWER_HEIGHT = 224;
export const MIN_EDITOR_DRAWER_HEIGHT = 120;
export const MAX_EDITOR_DRAWER_HEIGHT = 640;

export function clampEditorDrawerHeight(height: number): number {
  if (!Number.isFinite(height)) return DEFAULT_EDITOR_DRAWER_HEIGHT;
  return Math.round(Math.min(Math.max(height, MIN_EDITOR_DRAWER_HEIGHT), MAX_EDITOR_DRAWER_HEIGHT));
}
```

Create `src/components/editorPanel/EditorPanelLayout.tsx`:

```tsx
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Toast } from "../../ui/foundation/Toast";
import { clampEditorDrawerHeight, DEFAULT_EDITOR_DRAWER_HEIGHT } from "./editorDrawerSize";
import "./editorPanel.css";

export { DEFAULT_EDITOR_DRAWER_HEIGHT };

export interface EditorDrawerFrame {
  readonly height: number;
  onResize(height: number): void;
}

export interface EditorPanelLayoutProps {
  readonly area: ReactNode;
  readonly renderDrawer: ((frame: EditorDrawerFrame) => ReactNode) | null;
  readonly debugViews: ReactNode;
  readonly message: string | null;
}

export function EditorPanelLayout({ area, debugViews, message, renderDrawer }: EditorPanelLayoutProps) {
  const [height, setHeight] = useState(DEFAULT_EDITOR_DRAWER_HEIGHT);
  const [dismissedMessage, setDismissedMessage] = useState<string | null>(null);
  const onResize = useCallback((next: number) => setHeight(clampEditorDrawerHeight(next)), []);
  const frame = useMemo<EditorDrawerFrame>(() => ({ height, onResize }), [height, onResize]);
  const visibleMessage = message !== null && message !== dismissedMessage ? message : null;
  return (
    <div className="cv-editor-panel" data-debug-views={debugViews === null ? "hidden" : "side"}>
      <div className="cv-editor-panel__column">
        <div className="cv-editor-panel__area">{area}</div>
        {renderDrawer === null ? null : renderDrawer(frame)}
      </div>
      {debugViews}
      {visibleMessage === null ? null : (
        <div className="cv-editor-panel__toast">
          <Toast durationMs={5000} message={visibleMessage} onDismiss={() => setDismissedMessage(visibleMessage)} />
        </div>
      )}
    </div>
  );
}
```

Create `src/components/editorPanel/WorkbenchEditorDrawerHost.tsx`:

```tsx
import type { ReactNode } from "react";
import type { EditorDrawerAvailability, EditorDrawerView } from "../../domain/editorDrawer";
import { dockedTextSearchProps } from "../dockedTextSearchProps";
import { PhpTreePanel } from "../PhpTreePanel";
import { TextSearch } from "../TextSearch";
import type { WorkbenchBottomPanelHostProps } from "../WorkbenchBottomPanelHost";
import { workbenchBottomPanelHostProps, type BottomPanelHostProps } from "../workbenchBottomPanelHostPresenter";
import { WorkbenchPanelViewContent } from "../workbenchPanelViews";
import { EditorDrawer } from "./EditorDrawer";
import type { EditorDrawerFrame } from "./EditorPanelLayout";

export interface WorkbenchEditorDrawerHostProps extends WorkbenchBottomPanelHostProps {
  readonly view: EditorDrawerView;
  readonly frame: EditorDrawerFrame;
  readonly consoleHeader: ReactNode;
}

type AvailabilityFlags = Pick<
  BottomPanelHostProps,
  "hasArtisan" | "hasExpressRoutes" | "hasJsWorkspace" | "hasNette" | "hasPhpWorkspace" | "hasSymfony"
>;

export function editorDrawerAvailabilityFromPanel(flags: Partial<AvailabilityFlags>): EditorDrawerAvailability {
  const javaScriptWorkspace = flags.hasJsWorkspace === true;
  return {
    artisan: flags.hasArtisan === true,
    expressRoutes: flags.hasExpressRoutes ?? javaScriptWorkspace,
    javaScriptWorkspace,
    nette: flags.hasNette === true,
    symfony: flags.hasSymfony === true,
    phpWorkspace: flags.hasPhpWorkspace === true,
  };
}

export function WorkbenchEditorDrawerHost({
  consoleHeader,
  frame,
  onSetDockedTextSearchOpen,
  view,
  workbench,
  ...input
}: WorkbenchEditorDrawerHostProps) {
  const search = <TextSearch {...dockedTextSearchProps({ setOpen: onSetDockedTextSearchOpen, workbench })} />;
  const panel = workbenchBottomPanelHostProps({
    ...input,
    onCloseSearch: () => onSetDockedTextSearchOpen(false),
    search,
    workbench,
  });
  const phpTree =
    view === "phpTree" ? (
      <PhpTreePanel
        activePath={workbench.activePath}
        expandedNodeIds={workbench.phpTreeExpandedNodeIds}
        isLoading={workbench.phpTreeLoading}
        onOpenNode={workbench.openPhpTreeNode}
        onToggleNode={workbench.togglePhpTreeNode}
        rootPath={workbench.workspaceRoot}
        tree={workbench.phpTree}
      />
    ) : null;
  return (
    <EditorDrawer
      availability={editorDrawerAvailabilityFromPanel(panel)}
      headerExtras={view === "debug" ? consoleHeader : null}
      height={frame.height}
      onClose={panel.onClose}
      onResize={frame.onResize}
      onSelectView={panel.onSelectView}
      problemCount={panel.notices.length}
      view={view}
    >
      <WorkbenchPanelViewContent {...panel} activeView={view} phpTree={phpTree} search={search} />
    </EditorDrawer>
  );
}
```

`WorkbenchPanelViewContentProps` must be satisfiable from `BottomPanelHostProps`. If a prop name differs between the two (the renderer takes `hasExpressRoutes` after BottomPanel's `showExpressRoutes` default), compute it in the host exactly as `BottomPanel` did before the move.

In `ProblemsPanel.tsx`:
- read `const toolbarHost = useContext(EditorDrawerExtrasContext);`;
- when it is non-null, render the existing filter row (`.problems-filter` plus the severity/grouping controls) through `createPortal(toolbar, toolbarHost)`;
- otherwise render it in place.

Restyle rows to the mockup:
- file group row: `.cv-problems__file`, 26px, chevron, file icon, name, dimmed dir, trailing count;
- item row: `.cv-problems__item`, 26px, 28px left inset, severity icon, message ellipsis, source, trailing `line:col`;
- selection: `aria-selected` with `--cv-tint-2`.

Put the rules in `editorPanel.css` under a `/* problems */` block. Delete the `.problems-*` and `.problem-row*` rules from `App.css`. Keep the element structure and roles that `ProblemsPanel.test.tsx` queries. Update class-name selectors in that test to the new classes. Add one test:

```tsx
  it("portals its filter into the drawer header when a host is provided", () => {
    const host = document.createElement("div");
    document.body.append(host);
    renderPanel({ wrapper: (children) => <EditorDrawerExtrasContext.Provider value={host}>{children}</EditorDrawerExtrasContext.Provider> });

    expect(host.querySelector('input[aria-label="Filter problems"]')).not.toBeNull();
    host.remove();
  });
```

`renderPanel` is the file's existing render helper. Extend it with an optional `wrapper`. The filter input's accessible name is whatever `ProblemsPanel` already uses: read it and use that exact label.

- [ ] **Step 6: Keybinding**

In `src/domain/keymap.ts`, append after the `panel.toggleTodo` entry:

```ts
  {
    category: "Workbench",
    defaultShortcut: "Cmd+Shift+M",
    id: "panel.showProblems",
    label: "Show Problems",
  },
```

In `src/application/workbenchPanelCommands.ts`, give the `panel.showProblems` command the shortcut, following the same pattern the other entries in that file use (`shortcut: shortcut("panel.showProblems")`). If that file has no `shortcut` helper, add the field in the form `workbenchFloatingSurfaceCommands.ts` uses for `file.quickOpen`.

- [ ] **Step 7: Drawer styles**

Append to `editorPanel.css`. Values come from mockup `.bdrawer`, `.dtab`, `.pfilter`, `.plist`, `.pf` and `.pi`.

```css
.cv-editor-panel {
  position: relative;
  display: flex;
  height: 100%;
  min-width: 0;
  min-height: 0;
}

.cv-editor-panel__column {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.cv-editor-panel__area {
  flex: 1;
  min-height: 0;
}

.cv-editor-panel__toast {
  position: absolute;
  right: var(--cv-space-6);
  bottom: var(--cv-space-6);
  z-index: var(--cv-z-toast);
}

.cv-edrawer {
  position: relative;
  display: flex;
  flex: none;
  flex-direction: column;
  min-height: 0;
  background: var(--cv-canvas);
  box-shadow: var(--cv-edge-top-hair);
}

.cv-edrawer__head {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--cv-space-2);
  height: 36px;
  padding: 0 var(--cv-space-4);
}

.cv-edrawer__tabs {
  display: flex;
  align-items: center;
  gap: var(--cv-space-2);
  min-width: 0;
}

.cv-edrawer__tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 var(--cv-space-4);
  border: 0;
  border-radius: var(--cv-r-sm);
  background: transparent;
  color: var(--cv-fg-subtle);
  font: var(--cv-t-xs) / 1 var(--cv-font-ui);
  white-space: nowrap;
  cursor: pointer;
}

.cv-edrawer__tab:hover {
  background: var(--cv-tint-2);
  color: var(--cv-fg-strong);
}

.cv-edrawer__tab[aria-selected="true"] {
  background: var(--cv-tint-3);
  color: var(--cv-fg-strong);
}

.cv-edrawer__tab:focus-visible {
  outline: 2px solid var(--cv-focus);
  outline-offset: -2px;
}

.cv-edrawer__count {
  color: var(--cv-fg-subtle);
  font-variant-numeric: tabular-nums;
}

.cv-edrawer__end,
.cv-edrawer__extras {
  display: flex;
  align-items: center;
  gap: 2px;
}

.cv-edrawer__end {
  margin-left: auto;
}

.cv-edrawer__body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0 var(--cv-space-4) var(--cv-space-4);
  font: var(--cv-t-xs) / var(--cv-lh-xs) var(--cv-font-ui);
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run src/ui/foundation src/components/editorPanel src/components/BottomPanel.test.tsx src/components/ProblemsPanel.test.tsx src/components/workbenchBottomPanelHostPresenter.test.ts src/domain/keymap.test.ts src/application/workbenchPanelCommands.test.ts && npm run check`
Expected: PASS, 0 type errors.

- [ ] **Step 9: Integration - mount the drawer and route panel views (lead)**

In `src/App.tsx`:
1. Collect the props object that is passed to `<WorkbenchBottomPanelHost ...>` today into `const panelHostProps: WorkbenchBottomPanelHostProps = { ... }`, with the same values.
2. Compute `const panelPlacement = workbenchPanelPlacement(workbench.bottomPanelView, workbench.bottomPanelVisible);`.
3. `bottom={panelPlacement.terminal ? <WorkbenchBottomPanelHost {...panelHostProps} /> : null}`.
4. Pass `panelPlacement.terminal` instead of `workbench.bottomPanelVisible` wherever the frame placement (`workbenchShellPlacement` input) and `useAgentWorkbenchLayout`'s bottom-panel persistence read the bottom panel's visibility. Only the terminal occupies the frame bottom slot now.
5. Mount the reveal: `const revealEditorSurface = useEditorSurfaceReveal(workbench.agentWorkbench.dispatch); useEditorDrawerReveal({ ownerKey: workspaceId, drawerView: panelPlacement.drawer, reveal: revealEditorSurface });`.
6. Replace the `editor={...}` slot element with:

```tsx
        editor={
          <EditorPanelLayout
            area={<LazyWorkbenchEditorRuntimeHost active={!shellPlacement.editorHidden} {...editorHostSlotProps} />}
            debugViews={null}
            message={workbench.message}
            renderDrawer={
              panelPlacement.drawer === null
                ? null
                : (frame) => (
                    <WorkbenchEditorDrawerHost {...panelHostProps} consoleHeader={null} frame={frame} view={panelPlacement.drawer} />
                  )
            }
          />
        }
```

`editorHostSlotProps` is the existing `workbenchEditorHostProps({...})` result, hoisted into a `const` above the JSX. In the closure, narrow `panelPlacement.drawer` into a local `const drawerView` first so TypeScript sees a non-null `EditorDrawerView`. `debugViews` and `consoleHeader` are filled by Task 10.

Add an App-level regression test to `src/App.commandRouting.test.tsx` (Review Focus 1). It uses the file's existing render helper and its fake terminal gateway's session-creation spy:

```tsx
  it("keeps the terminal session when switching Terminal -> Problems -> Terminal, like hide/show", async () => {
    const app = await renderApp();
    await app.runCommand("panel.toggle");
    const createdAfterOpen = app.terminalSessionsCreated();
    await app.runCommand("panel.showProblems");
    expect(app.host.querySelector('.cv-edrawer [role="tab"][aria-selected="true"]')?.textContent).toContain("Problems");
    await app.runCommand("panel.toggle");

    expect(app.terminalSessionsCreated()).toBe(createdAfterOpen);
  });
```

Map `renderApp`, `runCommand` and `terminalSessionsCreated` to that file's existing helpers:
- the command runner it already uses;
- the fake `TerminalGateway`'s create/start spy call count.

If the file has no terminal fake, add `terminalGateway: fakeTerminalGateway()` from `src/test/workbenchControllerTestHarness.tsx` (or the fake `TerminalPanel.test.tsx` uses) and count its session-start calls. The expectation is that switching views never creates a second session beyond what plain hide/show does. If hide/show also recreates sessions today, assert equality with that baseline instead.

Run: `npx vitest run src/App.commandRouting.test.tsx src/App.dockedTextSearch.integration.test.tsx src/components/editorPanel`
Expected: PASS. The docked text search test now finds the search view inside `.cv-edrawer` after `search.text` (Cmd+Shift+F). Update its container selector only.

- [ ] **Step 10: Commit**

```bash
git add src/ui/foundation/ResizeHandle.tsx src/ui/foundation/panels.test.tsx src/ui/foundation/panels.css src/components/workbenchPanelViews.tsx src/components/editorPanel src/components/BottomPanel.tsx src/components/BottomPanel.test.tsx src/components/WorkbenchBottomPanelHost.tsx src/components/ProblemsPanel.tsx src/components/ProblemsPanel.test.tsx src/domain/keymap.ts src/domain/keymap.test.ts src/application/workbenchPanelCommands.ts src/App.tsx src/App.css src/App.commandRouting.test.tsx src/App.dockedTextSearch.integration.test.tsx
git commit -m "feat(editor): move Problems and panel views into the editor drawer"
```

---
### Task 10: Debug regions - toolbar, side column, console - and debug focus

**Files:**
- Create: `src/components/debug/debugPanelStatus.ts`, `src/components/debug/debugPanelStatus.test.ts`
- Create: `src/components/debug/DebugSection.tsx`
- Create: `src/components/debug/DebugToolbarRegion.tsx`, `src/components/debug/DebugToolbarRegion.test.tsx`
- Create: `src/components/debug/DebugExceptionRows.tsx`
- Create: `src/components/debug/DebugCallStack.tsx`, `src/components/debug/DebugVariables.tsx`, `src/components/debug/DebugBreakpoints.tsx` (moved code)
- Create: `src/components/debug/DebugSectionsRegion.tsx`, `src/components/debug/DebugSectionsRegion.test.tsx`
- Create: `src/components/debug/DebugConsoleRegion.tsx`, `src/components/debug/DebugConsoleRegion.test.tsx`
- Create: `src/components/debug/debug.css`
- Create: `src/components/editorPanel/useEditorDebugFocus.ts`, `src/components/editorPanel/useEditorDebugFocus.test.tsx`
- Modify: `src/components/DebugPanel.tsx` (compositor only), `src/components/DebugPanel.test.tsx`, `src/components/DebugPanel.breakpointGroups.test.tsx`
- Modify: `src/components/usePrivateDebugPanelElement.tsx` (+ test), `src/components/useAppTestDebugPanels.ts`
- Modify: `src/components/DebugVariableTree.tsx`, `src/components/DebugWatchesPanel.tsx`, `src/components/DebugConsolePanel.tsx` (inline colours -> classes in `debug.css`; no behaviour change)
- Integration: `src/App.tsx` (chrome `debugToolbar`, `debugViews`, drawer `consoleHeader`, focus hook), `src/App.css` (delete debug rules that moved; keep gutter glyph rules for Task 11)

**Interfaces:**
- Consumes: `DebugPanelProps` (`DebugPanel.tsx:130-227`), `debugExceptionRows`, `nextExceptionPauseMode` (Task 3), `editorDebugFocusReducer`, `debugViewsPlacement`, `initialEditorDebugFocusState` (Task 3), `DebuggerSessionSnapshot` (`domain/debugSessionState.ts`), `DebuggerState` (`domain/debug.ts:250`).
- Produces:
  - `debuggerStatusLabel(snapshot, startPending, stopPending, startBlockedByOtherOwner): string` (moved verbatim from `DebugPanel.tsx:899`)
  - `debugSessionActive(props: Pick<DebugPanelProps, "snapshot" | "debugStartPending" | "debugStartBlockedByOtherOwner" | "debugCompoundStartPending">): boolean`
  - `debugSessionIdOf(snapshot: DebuggerSessionSnapshot): number | null`
  - `DebugToolbarRegion(props: DebugPanelProps)`: `role="toolbar"`, `aria-label="Debug session"`
  - `DebugSectionsRegion(props: DebugPanelProps)`: `<aside className="cv-dside" aria-label="Debug">`
  - `DebugConsoleRegion(props: DebugPanelProps)`: console body. `DebugConsoleHeader(props: DebugPanelProps & { readonly onShowDebugViews: (() => void) | null })`: launch selector, run without debugging, launch configurations, clear console, "Show debug views"
  - `interface PrivateDebugRegions { readonly toolbar: ReactElement; readonly sections: ReactElement; readonly console: ReactElement; readonly consoleHeader: ReactElement }`
  - `usePrivateDebugRegions(props, surfaces, setVariableSurface?, addToWatchSurface?, onShowDebugViews?): PrivateDebugRegions`
  - `useAppTestDebugPanels(...)` additionally returns `debugRegions: PrivateDebugRegions`, `debugSessionActive: boolean` and `debugSessionId: number | null`
  - `useEditorDebugFocus(input: { readonly ownerKey: string | null; readonly sessionId: number | null; readonly maximized: boolean; dispatch(action: AgentWorkbenchLayoutAction): void }): void`

- [ ] **Step 1: Write the failing tests**

Create `src/components/debug/debugPanelStatus.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { debugSessionActive, debugSessionIdOf, debuggerStatusLabel } from "./debugPanelStatus";

const inactive = { state: { kind: "inactive" as const }, lastSeq: 0 };
const running = { state: { kind: "running" as const, sessionId: 4 }, lastSeq: 1 };

describe("debug session status", () => {
  it("is active while starting, running, stopped or pending and idle otherwise", () => {
    expect(debugSessionActive({ snapshot: inactive })).toBe(false);
    expect(debugSessionActive({ snapshot: inactive, debugStartPending: true })).toBe(true);
    expect(debugSessionActive({ snapshot: inactive, debugStartBlockedByOtherOwner: true })).toBe(true);
    expect(debugSessionActive({ snapshot: running })).toBe(true);
    expect(debugSessionActive({ snapshot: { state: { kind: "terminated", sessionId: 4, exitCode: 0 }, lastSeq: 2 } })).toBe(false);
  });

  it("exposes the session id only for a live session", () => {
    expect(debugSessionIdOf(inactive)).toBeNull();
    expect(debugSessionIdOf(running)).toBe(4);
    expect(debugSessionIdOf({ state: { kind: "starting", sessionId: 9 }, lastSeq: 0 })).toBe(9);
  });

  it("keeps the old status labels", () => {
    expect(debuggerStatusLabel(running, false, false, false)).toBe("Running");
    expect(debuggerStatusLabel(inactive, true, false, false)).toBe("Starting");
    expect(debuggerStatusLabel(inactive, false, false, true)).toBe("Waiting for another debug session");
  });
});
```

If the `terminated` variant of `DebuggerState` has other required fields, add them with neutral values from `domain/debug.ts`.

Create `src/components/debug/DebugToolbarRegion.test.tsx`. It reuses the `DebugPanel.test.tsx` props fixture. Extract that fixture into `src/components/debug/debugPanelTestProps.ts` as `debugPanelTestProps(overrides?: Partial<DebugPanelProps>): DebugPanelProps`, and make `DebugPanel.test.tsx` import it.

```tsx
// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { click, mountUi, type MountedUi } from "../../ui/foundation/foundationTestSupport";
import { DebugToolbarRegion } from "./DebugToolbarRegion";
import { debugPanelTestProps } from "./debugPanelTestProps";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let mounted: MountedUi | null = null;

afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

const stopped = {
  state: { kind: "stopped" as const, sessionId: 3, reason: "breakpoint" as const, frames: [], topFrame: null },
  lastSeq: 5,
};

describe("DebugToolbarRegion", () => {
  it("shows the paused status and the stepping controls with their shortcuts", () => {
    const props = debugPanelTestProps({ snapshot: stopped });
    mounted = mountUi();
    mounted.render(<DebugToolbarRegion {...props} />);
    const toolbar = mounted.host.querySelector('[role="toolbar"][aria-label="Debug session"]');

    expect(toolbar?.textContent).toContain("Paused (breakpoint)");
    for (const [label, title] of [
      ["Continue", "Continue F5"],
      ["Step over", "Step over F10"],
      ["Step into", "Step into F11"],
      ["Step out", "Step out ⇧F11"],
      ["Restart debugging", "Restart ⇧⌘F5"],
      ["Stop debugging", "Stop ⇧F5"],
    ]) {
      expect(toolbar?.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)?.title, label).toBe(title);
    }
    click(toolbar?.querySelector('button[aria-label="Step over"]') as Element);
    expect(props.onStep).toHaveBeenCalledWith("stepOver");
  });

  it("offers Pause instead of Continue while running and Disconnect for attached sessions", () => {
    mounted = mountUi();
    mounted.render(
      <DebugToolbarRegion {...debugPanelTestProps({ snapshot: { state: { kind: "running", sessionId: 3 }, lastSeq: 1 }, debugSessionAttached: true })} />,
    );

    expect(mounted.host.querySelector('button[aria-label="Pause"]')).not.toBeNull();
    expect(mounted.host.querySelector('button[aria-label="Continue"]')).toBeNull();
    expect(mounted.host.querySelector('button[aria-label="Disconnect debugging"]')).not.toBeNull();
  });
});
```

Adjust `reason: "breakpoint"` if `DebugStopReason` spells it differently. Use a value from `domain/debug.ts` and the matching label.

Create `src/components/debug/DebugSectionsRegion.test.tsx`:

```tsx
// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { click, mountUi, type MountedUi } from "../../ui/foundation/foundationTestSupport";
import { DebugSectionsRegion } from "./DebugSectionsRegion";
import { debugPanelTestProps } from "./debugPanelTestProps";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let mounted: MountedUi | null = null;

afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe("DebugSectionsRegion", () => {
  it("renders Variables, Watch, Call stack and Breakpoints as collapsible sections in that order", () => {
    mounted = mountUi();
    mounted.render(<DebugSectionsRegion {...debugPanelTestProps()} />);
    const headers = [...mounted.host.querySelectorAll(".cv-dside__head")];

    expect(headers.map((header) => header.textContent?.replace(/\d+$/, ""))).toEqual([
      "Variables",
      "Watch",
      "Call stack",
      "Breakpoints",
    ]);
    click(headers[0] as Element);
    expect(headers[0]?.getAttribute("aria-expanded")).toBe("false");
    expect(mounted.host.querySelector('[aria-label="Variables"][role="tree"]')).toBeNull();
  });

  it("maps the exception rows to the pause mode and blocks while a change is pending", () => {
    const props = debugPanelTestProps({ exceptionPauseMode: "uncaught", hasJavaScriptTypeScriptWorkspace: true });
    mounted = mountUi();
    mounted.render(<DebugSectionsRegion {...props} />);
    click(mounted.host.querySelector('[role="checkbox"][aria-label="All exceptions"]') as Element);
    expect(props.onSetExceptionPauseMode).toHaveBeenCalledWith("all");

    const pending = debugPanelTestProps({ exceptionPauseMode: "uncaught", exceptionPausePending: true, hasJavaScriptTypeScriptWorkspace: true });
    mounted.render(<DebugSectionsRegion {...pending} />);
    click(mounted.host.querySelector('[role="checkbox"][aria-label="Uncaught exceptions"]') as Element);
    expect(pending.onSetExceptionPauseMode).not.toHaveBeenCalled();
  });
});
```

Create `src/components/debug/DebugConsoleRegion.test.tsx`:

```tsx
// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { click, mountUi, type MountedUi } from "../../ui/foundation/foundationTestSupport";
import { DebugConsoleHeader, DebugConsoleRegion } from "./DebugConsoleRegion";
import { debugPanelTestProps } from "./debugPanelTestProps";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let mounted: MountedUi | null = null;

afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe("DebugConsoleRegion", () => {
  it("renders the console log and the last start error", () => {
    mounted = mountUi();
    mounted.render(<DebugConsoleRegion {...debugPanelTestProps({ lastStartError: "Cannot find module" })} />);

    expect(mounted.host.querySelector('[role="alert"]')?.textContent).toBe("Cannot find module");
    expect(mounted.host.querySelector('[aria-label="Debug console"]')).not.toBeNull();
  });

  it("puts clear console and Show debug views in the drawer header", () => {
    const onShowDebugViews = vi.fn();
    const props = debugPanelTestProps({ canClearConsole: true });
    mounted = mountUi();
    mounted.render(<DebugConsoleHeader {...props} onShowDebugViews={onShowDebugViews} />);
    click(mounted.host.querySelector('button[aria-label="Clear console"]') as Element);
    click(mounted.host.querySelector('button[aria-label="Show debug views"]') as Element);

    expect(props.onClearConsole).toHaveBeenCalledTimes(1);
    expect(onShowDebugViews).toHaveBeenCalledTimes(1);
  });

  it("hides Show debug views when the views are already visible", () => {
    mounted = mountUi();
    mounted.render(<DebugConsoleHeader {...debugPanelTestProps()} onShowDebugViews={null} />);

    expect(mounted.host.querySelector('button[aria-label="Show debug views"]')).toBeNull();
  });
});
```

Create `src/components/editorPanel/useEditorDebugFocus.test.tsx`:

```tsx
// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentWorkbenchLayoutAction } from "../../domain/agentWorkbenchLayout";
import { mountUi, type MountedUi } from "../../ui/foundation/foundationTestSupport";
import { useEditorDebugFocus } from "./useEditorDebugFocus";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let mounted: MountedUi | null = null;

afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

function Probe(props: { readonly ownerKey: string | null; readonly sessionId: number | null; readonly maximized: boolean; dispatch(action: AgentWorkbenchLayoutAction): void }) {
  useEditorDebugFocus(props);
  return null;
}

describe("useEditorDebugFocus", () => {
  it("maximizes on session start, ignores its own maximize, restores on end", () => {
    const dispatch = vi.fn();
    mounted = mountUi();
    mounted.render(<Probe dispatch={dispatch} maximized={false} ownerKey="/a" sessionId={null} />);
    mounted.render(<Probe dispatch={dispatch} maximized={false} ownerKey="/a" sessionId={5} />);
    mounted.render(<Probe dispatch={dispatch} maximized ownerKey="/a" sessionId={5} />);
    mounted.render(<Probe dispatch={dispatch} maximized ownerKey="/a" sessionId={null} />);

    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      { kind: "openSurface", surface: "editor" },
      { kind: "maximizeRightPanel" },
      { kind: "toggleMaximized" },
    ]);
  });

  it("does not restore after the user restored the panel during the session", () => {
    const dispatch = vi.fn();
    mounted = mountUi();
    mounted.render(<Probe dispatch={dispatch} maximized={false} ownerKey="/a" sessionId={null} />);
    mounted.render(<Probe dispatch={dispatch} maximized={false} ownerKey="/a" sessionId={5} />);
    mounted.render(<Probe dispatch={dispatch} maximized ownerKey="/a" sessionId={5} />);
    mounted.render(<Probe dispatch={dispatch} maximized={false} ownerKey="/a" sessionId={5} />);
    mounted.render(<Probe dispatch={dispatch} maximized={false} ownerKey="/a" sessionId={null} />);

    expect(dispatch).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/debug src/components/editorPanel/useEditorDebugFocus.test.tsx`
Expected: FAIL with unresolved imports.

- [ ] **Step 3: Status helpers and focus hook**

Create `src/components/debug/debugPanelStatus.ts`. Move `debuggerStatusLabel` from `DebugPanel.tsx` verbatim (export it), then add:

```ts
import type { DebuggerSessionSnapshot } from "../../domain/debugSessionState";
import type { DebugPanelProps } from "../DebugPanel";

export function debugSessionActive(
  props: Pick<
    Partial<DebugPanelProps>,
    "debugStartPending" | "debugStartBlockedByOtherOwner" | "debugCompoundStartPending"
  > & { readonly snapshot: DebuggerSessionSnapshot },
): boolean {
  const kind = props.snapshot.state.kind;
  if (kind === "running" || kind === "stopped" || kind === "starting") return true;
  return (
    props.debugStartPending === true ||
    props.debugStartBlockedByOtherOwner === true ||
    props.debugCompoundStartPending === true
  );
}

export function debugSessionIdOf(snapshot: DebuggerSessionSnapshot): number | null {
  const state = snapshot.state;
  if (state.kind === "running" || state.kind === "stopped" || state.kind === "starting") {
    return state.sessionId;
  }
  return null;
}
```

Create `src/components/editorPanel/useEditorDebugFocus.ts`:

```ts
import { useEffect, useRef } from "react";
import type { AgentWorkbenchLayoutAction } from "../../domain/agentWorkbenchLayout";
import {
  editorDebugFocusReducer,
  initialEditorDebugFocusState,
  type EditorDebugFocusEffect,
  type EditorDebugFocusEvent,
  type EditorDebugFocusState,
} from "../../domain/editorDebugFocus";

export interface EditorDebugFocusInput {
  readonly ownerKey: string | null;
  readonly sessionId: number | null;
  readonly maximized: boolean;
  dispatch(action: AgentWorkbenchLayoutAction): void;
}

export function useEditorDebugFocus({ dispatch, maximized, ownerKey, sessionId }: EditorDebugFocusInput): void {
  const stateRef = useRef<EditorDebugFocusState>(initialEditorDebugFocusState);
  const expectedMaximizedRef = useRef<boolean | null>(null);
  const lastMaximizedRef = useRef(maximized);
  const dispatchRef = useRef(dispatch);
  useEffect(() => {
    dispatchRef.current = dispatch;
  }, [dispatch]);

  useEffect(() => {
    const apply = (event: EditorDebugFocusEvent): EditorDebugFocusEffect => {
      const step = editorDebugFocusReducer(stateRef.current, event);
      stateRef.current = step.state;
      return step.effect;
    };
    apply({ kind: "owner", ownerKey });
    if (maximized !== lastMaximizedRef.current) {
      lastMaximizedRef.current = maximized;
      if (expectedMaximizedRef.current === maximized) {
        expectedMaximizedRef.current = null;
      } else {
        apply({ kind: "layoutChanged" });
      }
    }
    const effect = apply({ kind: "session", sessionId, maximized });
    if (effect === "maximize") {
      expectedMaximizedRef.current = true;
      dispatchRef.current({ kind: "openSurface", surface: "editor" });
      dispatchRef.current({ kind: "maximizeRightPanel" });
      return;
    }
    if (effect === "restore" && maximized) {
      expectedMaximizedRef.current = false;
      dispatchRef.current({ kind: "toggleMaximized" });
    }
  }, [maximized, ownerKey, sessionId]);
}
```

Walk the second test through by hand before running it:
- The session starts, so the hook maximizes and sets expected = true.
- `maximized` turns true, which matches expected, so there is no `layoutChanged`.
- `maximized` turns false. That was not expected, so a `layoutChanged` is recorded.
- The session ends, and the reducer returns `none` because the layout was touched.

That gives exactly two dispatches.

- [ ] **Step 4: Split `DebugPanel` into regions**

Mechanical rules. Every moved block keeps its JSX, handlers and `aria-*` exactly as it is.
1. Move `CallStack`, `canRestartFrame`, `frameAllowsInlineActions` and `activateFrame` to `debug/DebugCallStack.tsx`. Move `Variables` to `debug/DebugVariables.tsx`. Move `Breakpoints`, `BreakpointLogMessageInput`, `BreakpointHitConditionInput`, `BreakpointConditionInput`, `displayPath` and `breakpointLocationLabel` to `debug/DebugBreakpoints.tsx`. Move `ToolbarButton` to `DebugToolbarRegion.tsx` and export it.
2. Replace each `style={styles.<key>}` with `className="cv-debug__<kebab-key>"`. Add one rule per key to `debug.css` with the same declarations, converting colours as follows:

   | Old value | New value |
   |---|---|
   | `var(--border-subtle)` | `var(--cv-hair)` |
   | `var(--text-muted)` | `var(--cv-fg-subtle)` |
   | `var(--background-active, ...)` in `frameActive` | `var(--cv-tint-2)` |
   | `var(--background-active, ...)` in `breakpointGroupHeader` | `var(--cv-tint-1)` |
   | `var(--status-error, #ef4444)` | `var(--cv-danger)` |

   Keep inline `style` only for computed values (the windowed list `maxHeight` / absolute row `top`). Do the same for the inline colour styles in `DebugVariableTree.tsx`, `DebugWatchesPanel.tsx` and `DebugConsolePanel.tsx`; `rg -n "var\(--(border-subtle|text-muted|background-active|status-error)" src/components` must print nothing afterwards.
3. Create `DebugToolbarRegion.tsx`. It renders the old toolbar's session controls with mockup titles, inside `<div className="cv-dbar" role="toolbar" aria-label="Debug session">`:
   - `<span className="cv-dbar__status"><i className="cv-dbar__dot" aria-hidden="true" />{debuggerStatusLabel(...)}</span>` (keep `data-testid="debug-status"`);
   - then `Continue` (only when not `running`; title "Continue F5") or `Pause` (when `running`; title "Pause F6");
   - then Step over / Step into / Step out (titles "Step over F10", "Step into F11", "Step out ⇧F11");
   - then a separator, then Restart (label "Restart debugging", title "Restart ⇧⌘F5") and Stop / Disconnect (title "Stop ⇧F5" or "Disconnect ⇧F5").

   Keep every `disabled` / `busy` expression from the old toolbar. `NodeDebugLaunchSelector`, `NodeRunWithoutDebuggingPickerAction`, `NodeLaunchConfigurationsAction` and `lastStartError` do not go here.
4. Create `DebugExceptionRows.tsx`. It renders `debugExceptionRows(exceptionPauseMode)` as `role="checkbox"` rows (`aria-checked`, `aria-label` = row label, class `cv-dside__bp`, dot `cv-dside__dot` / `cv-dside__dot--off`). Each row is disabled when the old `exceptionPauseDisabled` expression is true. On toggle it calls `onSetExceptionPauseMode(nextExceptionPauseMode(mode, row.id))` unless disabled. `exceptionPauseError` renders under the rows as `role="alert"`.
5. Create `DebugSection.tsx`:

```tsx
import { ChevronRight } from "lucide-react";
import { useState, type ReactNode } from "react";

export interface DebugSectionProps {
  readonly title: string;
  readonly count?: string | number;
  readonly actions?: ReactNode;
  readonly children: ReactNode;
}

export function DebugSection({ actions, children, count, title }: DebugSectionProps) {
  const [open, setOpen] = useState(true);
  return (
    <section aria-label={title} className="cv-dside__sec">
      <div className="cv-dside__bar">
        <button aria-expanded={open} className="cv-dside__head" onClick={() => setOpen((value) => !value)} type="button">
          <ChevronRight aria-hidden="true" className="cv-dside__chev" size={12} />
          {title}
          {count === undefined ? null : <span className="cv-dside__count">{count}</span>}
        </button>
        {actions === undefined ? null : <span className="cv-dside__actions">{actions}</span>}
      </div>
      {open ? children : null}
    </section>
  );
}
```

6. Create `DebugSectionsRegion.tsx`. It returns `<aside aria-label="Debug" className="cv-dside">` containing, in order:
   - `DebugSection "Variables"`: the moved `Variables`, whose tree keeps `role="tree"` and `aria-label="Variables"`;
   - `"Watch"` with count = number of watch definitions: `DebugWatchesPanel` with the same props the old panel passed;
   - `"Call stack"` with count "Paused" while stopped: the moved `CallStack`, plus the copy-stack-trace action in `actions`;
   - `"Breakpoints"` with count = `breakpoints.length`: the bulk actions (enable/disable/remove/activate) in `actions`, then `DebugExceptionRows`, `ExceptionTypeFilter` (only for node), the moved `Breakpoints` and `FunctionBreakpoints`, each rendered under the same conditions as before.
7. Create `DebugConsoleRegion.tsx`:
   - `DebugConsoleRegion` renders the old `lastStartError` alert (`role="alert"`, class `cv-debug__stderr`), the `DebugConsolePanel` with the same props mapping as the old console section (`aria-label="Debug console"` stays on its wrapper), and `NodeDebugConfigurationPicker` under the old `nodeConfigurationPickerVisible` condition.
   - `DebugConsoleHeader` renders `NodeDebugLaunchSelector`, `NodeRunWithoutDebuggingPickerAction` and `NodeLaunchConfigurationsAction` under the old conditions. It then adds `IconButton` "Clear console" (`Trash2`, disabled unless `canClearConsole`), and `IconButton` "Show debug views" (`PanelRightOpen`) when `onShowDebugViews !== null`.
8. Reduce `DebugPanel.tsx` to the props types plus:

```tsx
export function DebugPanel(props: DebugPanelProps) {
  return (
    <div aria-label="Debug" className="cv-debug" role="tabpanel">
      <DebugToolbarRegion {...props} />
      <DebugConsoleHeader {...props} onShowDebugViews={null} />
      <DebugSectionsRegion {...props} />
      <DebugConsoleRegion {...props} />
    </div>
  );
}
```

   Keep the old default values (`breakpointBulkMutationPending = false` and so on) by applying them in each region's destructuring. `DebugPanel.test.tsx` and `DebugPanel.breakpointGroups.test.tsx` keep passing through the compositor, with these changes only:
   - replace queries for the `<select aria-label="Pause on exceptions">` with the checkbox rows (for example selecting "uncaught" becomes clicking `[aria-label="Uncaught exceptions"]` from mode `none`);
   - replace section title text `"Call Stack"` with `"Call stack"`.
9. In `usePrivateDebugPanelElement.tsx`, add `usePrivateDebugRegions`. It uses the same latest-ref `Boundary` technique, once per region, and injects `debugAddToWatch`, `debugCopyValue` and `debugSetVariable` the same way. `consoleHeader` receives `onShowDebugViews`. In `useAppTestDebugPanels.ts`, call it next to the existing `usePrivateDebugPanelElement`. Return:
   - `debugRegions`;
   - `debugSessionActive: debugSessionActive(publicProps)`;
   - `debugSessionId: debugSessionIdOf(publicProps.snapshot)`.

   Keep `debugPanel` until Task 13 confirms no importer; then delete it.

Styles for the side column and the toolbar go in `debug.css`, with values from mockup `.dside`, `.dsh`, `.dv`, `.fr`, `.bpr` and `.dbar`:

```css
.cv-dside {
  flex: none;
  width: 304px;
  overflow: auto;
  padding: 4px 4px 12px;
  box-shadow: inset 1px 0 0 var(--cv-hair);
  font: var(--cv-t-xs) / var(--cv-lh-xs) var(--cv-font-ui);
}

.cv-dside__sec + .cv-dside__sec {
  margin-top: 4px;
  padding-top: 4px;
  box-shadow: var(--cv-edge-top-hair);
}

.cv-dside__bar {
  display: flex;
  align-items: center;
}

.cv-dside__head {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 8px;
  border: 0;
  border-radius: var(--cv-r-sm);
  background: transparent;
  color: var(--cv-fg-muted);
  font: 500 var(--cv-t-xs) / 1 var(--cv-font-ui);
  cursor: pointer;
}

.cv-dside__head:hover {
  color: var(--cv-fg-strong);
}

.cv-dside__chev {
  color: var(--cv-fg-subtle);
  transition: transform var(--cv-motion-base) var(--cv-ease);
}

.cv-dside__head[aria-expanded="true"] .cv-dside__chev {
  transform: rotate(90deg);
}

.cv-dside__count {
  margin-left: auto;
  color: var(--cv-fg-subtle);
  font-weight: 400;
}

.cv-dside__bp {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 24px;
  padding: 0 8px 0 26px;
  border: 0;
  border-radius: var(--cv-r-sm);
  background: transparent;
  color: var(--cv-fg);
  font: inherit;
  white-space: nowrap;
  cursor: pointer;
}

.cv-dside__bp:hover {
  background: var(--cv-tint-1);
}

.cv-dside__bp[aria-disabled="true"] {
  color: var(--cv-fg-disabled);
  cursor: default;
}

.cv-dside__dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--cv-breakpoint);
}

.cv-dside__dot--off {
  background: none;
  box-shadow: inset 0 0 0 1.5px var(--cv-fg-subtle);
}

.cv-dbar {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-left: auto;
}

.cv-dbar__status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px 0 4px;
  color: var(--cv-fg-muted);
  font: var(--cv-t-xs) / 1 var(--cv-font-ui);
  white-space: nowrap;
}

.cv-dbar__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--cv-warn);
}

.cv-dbar [aria-label="Continue"] {
  color: var(--cv-accent);
}

.cv-dbar [aria-label="Stop debugging"],
.cv-dbar [aria-label="Disconnect debugging"] {
  color: var(--cv-danger);
}

.cv-debug__stderr {
  color: var(--cv-danger);
}
```

Also restyle the moved rows to the mockup:
- call stack frames: `.cv-debug__frame`, 24px, 26px left inset, `aria-current` frame with a `--cv-warn` 5px triangle via `::before` and a `--cv-tint-2` background;
- variables: `DebugVariableTree` rows 22px, depth indent `calc(8px + var(--depth) * 14px)`, name `--cv-fg-strong` followed by a colon in `--cv-fg-subtle`;
- console input row: 32px, `--cv-r-control`, `--cv-tint-1` background, prompt `›` in `--cv-accent`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/components/debug src/components/DebugPanel.test.tsx src/components/DebugPanel.breakpointGroups.test.tsx src/components/DebugVariableTree.test.tsx src/components/DebugWatchesPanel.test.tsx src/components/DebugConsolePanel.test.tsx src/components/usePrivateDebugPanelElement.test.tsx src/components/useDebugPanelProps.test.tsx src/components/editorPanel && npm run check`
Expected: PASS, 0 type errors. `DebugPanel.tsx` is under 400 lines.

- [ ] **Step 6: Integration - place the regions (lead)**

In `src/App.tsx`, using the values returned by `useAppTestDebugPanels`:

```tsx
  const maximized = shellPlacement.rightPanelMaximized;
  useEditorDebugFocus({
    dispatch: workbench.agentWorkbench.dispatch,
    maximized,
    ownerKey: workspaceId,
    sessionId: debugSessionId,
  });
  const debugViewsVisible =
    debugViewsPlacement({
      maximized,
      phase: debugSessionActive ? "active" : "idle",
      drawerView: panelPlacement.drawer,
    }) === "side";
```

- `useEditorChromeValue({... debugToolbar: debugSessionActive ? debugRegions.toolbar : null ...})`.
- The layout's `debugViews={debugViewsVisible ? debugRegions.sections : null}`.
- The drawer host's `consoleHeader={debugRegions.consoleHeader}`.
- `panelHostProps.debugPanel = debugRegions.console`, so the drawer's "Debug console" view shows the console only.
- `onShowDebugViews` (passed into `useAppTestDebugPanels`) is `() => { workbench.showBottomPanelView("debug"); workbench.agentWorkbench.dispatch({ kind: "maximizeRightPanel" }); }` when not `debugViewsVisible`, else `null`.

`shellPlacement` is the existing `workbenchShellPlacement(...)` result in `App.tsx`. Its `rightPanelMaximized` is `true` in the editor-only fallback after Task 13, so the side column shows while debugging there too, and the focus hook never dispatches in that mode.

Run: `npx vitest run src/App.commandRouting.test.tsx src/components/editorPanel src/components/debug src/application/useDebugSession.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/debug src/components/DebugPanel.tsx src/components/DebugPanel.test.tsx src/components/DebugPanel.breakpointGroups.test.tsx src/components/DebugVariableTree.tsx src/components/DebugWatchesPanel.tsx src/components/DebugConsolePanel.tsx src/components/usePrivateDebugPanelElement.tsx src/components/usePrivateDebugPanelElement.test.tsx src/components/useAppTestDebugPanels.ts src/components/editorPanel src/App.tsx src/App.css
git commit -m "feat(debug): split the debug UI into toolbar, side column and console regions"
```

---
### Task 11: Gutter, inline values, Monaco widgets and theme colours

**Files:**
- Create: `src/components/editorPanel/editorGutter.css`, `src/components/editorPanel/editorWidgets.css`, `src/components/editorPanel/editorPanelStyles.test.ts`
- Create: `src/domain/appearanceEditorColors.ts`, `src/domain/appearanceEditorColors.test.ts`
- Modify: `src/components/editorChangeMonacoMappings.ts` (+ test): the change hunk marker moves from the glyph margin to the line-decorations bar
- Modify: `src/components/editorSurfaceCore/useEditorMouseInteractions.ts` (+ its test in `EditorSurface.test.tsx`): open the change popover from the bar
- Modify: `src/components/editorSurfaceCore/useEditorSurfacePresentation.tsx` (Monaco options only)
- Modify: `src/infrastructure/shikiHighlighter.ts`, `src/infrastructure/shikiHighlighter.test.ts`, `src/infrastructure/paletteSyntaxThemes.ts`, `src/infrastructure/paletteSyntaxThemes.test.ts`, `src/components/themePalettes.ts` (optional `ThemePalette` fields)
- Modify: `src/components/TerminalPanel.tsx`, `src/components/GitDiffPreview.tsx` (replace any hard-coded colour with `--cv-*`; no layout change)
- Integration: `src/App.css`. Delete the rules moved here: `.monaco-editor .editor-change-*`, `.breakpoint-glyph*`, `.inline-breakpoint-marker*`, `.debug-stopped-line`, `.debug-inline-value`, `.editor-large-file-notice`, `.editor-panel*`, `.editor-empty-overlay`, the editor tab rules at the old lines 4348-4485 (`.editor-tabs`, `.editor-tab*`, `.tab-main`, `.tab-close`, `.dirty-dot`), and the widget overrides at the old lines 6575-6810.

**Interfaces:**
- Consumes: `cssColorToHex` (`domain/cssColor.ts`), `paletteSyntaxTheme` (`infrastructure/paletteSyntaxThemes.ts`), `buildShikiTheme` (`infrastructure/shikiHighlighter.ts:101`).
- Produces:
  - `EDITOR_EXTRA_COLORS: Readonly<Record<ResolvedColorScheme, { readonly gitModified: string; readonly breakpoint: string; readonly match: string; readonly matchCurrent: string }>>`, whose values are the literals of `--cv-git-mod`, `--cv-breakpoint`, `--cv-match` and `--cv-match-current` in `semantic.css`
  - `ThemePalette` gains optional `findMatch?`, `findMatchHighlight?`, `peekBackground?`, `peekBorder?`, `gutterModified?` (hex)
  - Monaco options: `glyphMargin: true`, `lineDecorationsWidth: 12`, `lineNumbersMinChars: 3`, `folding: !large`, `showFoldingControls: "mouseover"`, `renderLineHighlight: "all"`, `lineHeight: 20`, `fontSize` unchanged (user setting)

- [ ] **Step 1: Write the failing tests**

Create `src/domain/appearanceEditorColors.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { EDITOR_EXTRA_COLORS } from "./appearanceEditorColors";

const semantic = readFileSync(resolve(import.meta.dirname, "../ui/tokens/semantic.css"), "utf8");

function schemeBlock(scheme: "dark" | "light"): string {
  const marker = scheme === "dark" ? ':root[data-cv-scheme="dark"] {' : ':root[data-cv-scheme="light"] {';
  const start = semantic.indexOf(marker);
  return semantic.slice(start, semantic.indexOf("}", start));
}

describe("EDITOR_EXTRA_COLORS", () => {
  it.each(["dark", "light"] as const)("matches the %s editor tokens in semantic.css", (scheme) => {
    const block = schemeBlock(scheme);
    const colors = EDITOR_EXTRA_COLORS[scheme];

    expect(block).toContain(`--cv-git-mod: ${colors.gitModified};`);
    expect(block).toContain(`--cv-breakpoint: ${colors.breakpoint};`);
    expect(block).toContain(`--cv-match: ${colors.match};`);
    expect(block).toContain(`--cv-match-current: ${colors.matchCurrent};`);
  });
});
```

The dark block in `semantic.css` starts with `:root,\n:root[data-cv-scheme="dark"] {`. `indexOf` on the second line still finds it.

Append to `src/infrastructure/paletteSyntaxThemes.test.ts`:

```ts
  it("gives every palette theme the find-match and peek colours of its scheme", () => {
    for (const palette of PALETTE_IDS) {
      for (const scheme of RESOLVED_COLOR_SCHEMES) {
        const theme = paletteSyntaxTheme(palette, scheme);

        expect(theme.findMatch).toBe(cssColorToHex(EDITOR_EXTRA_COLORS[scheme].matchCurrent));
        expect(theme.findMatchHighlight).toBe(cssColorToHex(EDITOR_EXTRA_COLORS[scheme].match));
        expect(theme.peekBackground).toMatch(/^#[0-9a-f]{6,8}$/i);
      }
    }
  });
```

Append to `src/infrastructure/shikiHighlighter.test.ts`:

```ts
  it("maps the optional editor extras into Monaco colours and omits them for classic themes", () => {
    const withExtras = buildShikiTheme({ ...calmDark, findMatch: "#edbb4e61", findMatchHighlight: "#edbb4e29", peekBackground: "#151616", peekBorder: "#ffffff1f" });
    const classic = buildShikiTheme(calmDark);

    expect(withExtras.colors?.["editor.findMatchBackground"]).toBe("#edbb4e61");
    expect(withExtras.colors?.["editor.findMatchHighlightBackground"]).toBe("#edbb4e29");
    expect(withExtras.colors?.["peekViewEditor.background"]).toBe("#151616");
    expect(withExtras.colors?.["peekView.border"]).toBe("#ffffff1f");
    expect(classic.colors?.["editor.findMatchBackground"]).toBeUndefined();
  });
```

Use the name under which the test file already imports the classic dark palette (`calmDark` in `components/themePalettes.ts`).

Append to `src/components/editorChangeMonacoMappings.test.ts`:

```ts
  it("draws change hunks as a line-decorations bar, leaving the glyph margin to breakpoints", () => {
    const [decoration] = changeHunkDecorations([{ kind: "modified", startLineNumber: 3, endLineNumber: 4 }]);

    expect(decoration?.options.glyphMarginClassName).toBeUndefined();
    expect(decoration?.options.linesDecorationsClassName).toBe("editor-change-line editor-change-line-modified");
  });
```

Use the mapping function and the hunk fixture shape that this test file already uses for change hunks.

Create `src/components/editorPanel/editorPanelStyles.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const dir = resolve(import.meta.dirname);
const sheets = ["editorPanel.css", "editorGutter.css", "editorWidgets.css", "../debug/debug.css"].map((name) =>
  readFileSync(resolve(dir, name), "utf8"),
);
const app = readFileSync(resolve(dir, "../../App.css"), "utf8");

describe("editor panel style contract", () => {
  it("uses tokens only: no hex, rgb or hsl colour literals", () => {
    for (const sheet of sheets) {
      expect(sheet).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(sheet).not.toMatch(/\b(rgb|rgba|hsl|hsla)\(/);
    }
  });

  it("keeps the mockup sizes", () => {
    const [panel, gutter, widgets, debug] = sheets;

    expect(panel).toMatch(/\.cv-esub \{[^}]*height: 40px;/);
    expect(panel).toMatch(/\.cv-edrawer__head \{[^}]*height: 36px;/);
    expect(debug).toMatch(/\.cv-dside \{[^}]*width: 304px;/);
    expect(gutter).toMatch(/\.editor-change-line \{[^}]*width: 3px;/);
    expect(widgets).toMatch(/\.find-widget \{[^}]*height: 36px/);
    expect(widgets).toMatch(/\.suggest-widget \{[^}]*width: 372px/);
  });

  it("leaves no migrated editor rule behind in App.css", () => {
    for (const selector of [".editor-tab", ".breadcrumb", ".breakpoint-glyph", ".debug-inline-value", ".problems-", ".suggest-widget", ".editor-change-glyph"]) {
      expect(app, selector).not.toContain(selector);
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/domain/appearanceEditorColors.test.ts src/infrastructure/paletteSyntaxThemes.test.ts src/infrastructure/shikiHighlighter.test.ts src/components/editorChangeMonacoMappings.test.ts src/components/editorPanel/editorPanelStyles.test.ts`
Expected: FAIL on the missing module, the undefined theme fields, the glyph class and the missing stylesheets.

- [ ] **Step 3: Colours and theme**

Create `src/domain/appearanceEditorColors.ts`:

```ts
import type { ResolvedColorScheme } from "./appearance";

export interface EditorExtraColors {
  readonly gitModified: string;
  readonly breakpoint: string;
  readonly match: string;
  readonly matchCurrent: string;
}

export const EDITOR_EXTRA_COLORS: Readonly<Record<ResolvedColorScheme, EditorExtraColors>> = {
  dark: {
    gitModified: "#6aa8f7",
    breakpoint: "#e5534b",
    match: "rgba(237, 187, 78, 0.16)",
    matchCurrent: "rgba(237, 187, 78, 0.38)",
  },
  light: {
    gitModified: "#2f6bd1",
    breakpoint: "#d1242f",
    match: "rgba(180, 120, 0, 0.14)",
    matchCurrent: "rgba(180, 120, 0, 0.32)",
  },
};
```

In `components/themePalettes.ts`, add to `ThemePalette`:

```ts
  readonly findMatch?: string;
  readonly findMatchHighlight?: string;
  readonly peekBackground?: string;
  readonly peekBorder?: string;
```

In `paletteSyntaxThemes.ts`, set these fields for every palette theme:
- `findMatch: cssColorToHex(EDITOR_EXTRA_COLORS[scheme].matchCurrent)`;
- `findMatchHighlight: cssColorToHex(EDITOR_EXTRA_COLORS[scheme].match)`;
- `peekBackground` = the palette's `raised` surface hex (`surfaceColor(palette, scheme, "raised")` or the P1 accessor it already uses for `widgetBg`);
- `peekBorder` = the hex of `--cv-hair-strong` for that palette.

`widgetBg` must already be the palette `pop-bg`. If P1 mapped it to something else, change it to the `pop-bg` value, and set `selectedBg` to the `tint-3` composite, so hover/suggest/menus match mockup `.pop`. If `cssColorToHex` does not accept `rgba()`, extend it: parse `rgba(r, g, b, a)` into `#rrggbbaa`, and add a test case to `cssColor.test.ts`.

In `buildShikiTheme`, append the optional keys only when defined:

```ts
      ...optionalColor("editor.findMatchBackground", p.findMatch),
      ...optionalColor("editor.findMatchHighlightBackground", p.findMatchHighlight),
      ...optionalColor("peekViewEditor.background", p.peekBackground),
      ...optionalColor("peekViewResult.background", p.peekBackground),
      ...optionalColor("peekViewTitle.background", p.peekBackground),
      ...optionalColor("peekView.border", p.peekBorder),
```

with

```ts
function optionalColor(key: string, value: string | undefined): Record<string, string> {
  return value === undefined ? {} : { [key]: value };
}
```

- [ ] **Step 4: Gutter and Monaco options**

In `editorChangeMonacoMappings.ts`, remove `glyphMarginClassName` from the change-hunk decoration (line 44). Keep `linesDecorationsClassName`. In `useEditorMouseInteractions.ts`, the handler that opens the change popover for a click on the change glyph (`MouseTargetType.GUTTER_GLYPH_MARGIN` on a changed line) must also accept `MouseTargetType.GUTTER_LINE_DECORATIONS` on a changed line. Keep the glyph-margin branch for breakpoints unchanged. Update the existing popover test in `EditorSurface.test.tsx` so it clicks the line-decorations target.

In `useEditorSurfacePresentation.tsx`, add these fields to `editorOptions` (existing fields unchanged):

```ts
      lineDecorationsWidth: 12,
      lineNumbersMinChars: 3,
      renderLineHighlight: "all",
      showFoldingControls: "mouseover",
```

Keep `lineHeight: 0`. It follows the user's font setting, and 20px at the default font size comes from Monaco's ratio. Changing it would override a user setting.

Create `src/components/editorPanel/editorGutter.css`. Values come from mockup `.ln .bp`, `.g`, `.fd`, `.iv`, `.paused` and `.sq-*`.

```css
.monaco-editor .editor-change-line {
  width: 3px !important;
  margin-left: 4px;
}

.monaco-editor .editor-change-line-added {
  background: var(--cv-ok);
}

.monaco-editor .editor-change-line-modified {
  background: var(--cv-git-mod);
}

.monaco-editor .editor-change-line-deleted {
  width: 0 !important;
  height: 0 !important;
  margin-top: 16px;
  border-top: 4px solid transparent;
  border-bottom: 4px solid transparent;
  border-left: 5px solid var(--cv-danger);
}

.monaco-editor .breakpoint-glyph::before {
  content: "";
  display: block;
  width: 9px;
  height: 9px;
  margin: 5px auto 0;
  border-radius: 50%;
  background: var(--cv-breakpoint);
}

.monaco-editor .breakpoint-glyph-unverified::before,
.monaco-editor .breakpoint-glyph-disabled::before {
  background: none;
  box-shadow: inset 0 0 0 1.5px var(--cv-fg-subtle);
}

.monaco-editor .breakpoint-glyph-conditional::before {
  box-shadow: inset 0 0 0 2px var(--cv-canvas);
}

.monaco-editor .breakpoint-glyph-logpoint::before {
  border-radius: 2px;
  transform: rotate(45deg) scale(0.85);
}

.monaco-editor .debug-stopped-line {
  background: var(--cv-warn-soft);
}

.monaco-editor .debug-inline-value {
  margin-left: 24px;
  color: var(--cv-fg-subtle);
  font-style: italic;
}

.monaco-editor .margin-view-overlays .cldr.codicon-folding-expanded,
.monaco-editor .margin-view-overlays .cldr.codicon-folding-collapsed {
  color: var(--cv-fg-subtle);
}

.monaco-editor .squiggly-error {
  text-decoration: underline wavy var(--cv-danger) 1px;
  text-underline-offset: 3px;
  background: none;
}

.monaco-editor .squiggly-warning {
  text-decoration: underline wavy var(--cv-warn) 1px;
  text-underline-offset: 3px;
  background: none;
}

.monaco-editor .lightBulbWidget {
  color: var(--cv-warn);
}
```

Port every other moved gutter rule (implementation, test-run, bookmark, coverage, conflict markers, inline breakpoint markers, js-test problem, git blame) from `App.css` into `editorGutter.css` with the same selectors. Change only their colours to tokens: `--cv-ok` / `--cv-danger` / `--cv-warn` / `--cv-accent` / `--cv-fg-subtle` / `--cv-breakpoint`, and the `*-soft` backgrounds.

Create `src/components/editorPanel/editorWidgets.css` from mockup `.pop`, `.hovercard`, `.cmp`, `.ci`, `.cdoc`, `.peek` and `.find`:

```css
.monaco-editor .monaco-hover,
.monaco-editor .suggest-widget,
.monaco-editor .suggest-details,
.monaco-editor .find-widget,
.monaco-editor .rename-box,
.monaco-editor .action-widget {
  border: 0 !important;
  border-radius: var(--cv-r-card) !important;
  background: var(--cv-popover) !important;
  box-shadow: var(--cv-shadow-pop) !important;
  color: var(--cv-fg);
  font: var(--cv-t-xs) / 18px var(--cv-font-ui);
}

.monaco-editor .monaco-hover {
  max-width: 404px;
}

.monaco-editor .monaco-hover .hover-row.status-bar {
  border-top: 1px solid var(--cv-hair);
  background: transparent;
}

.monaco-editor .monaco-hover .hover-row.status-bar .action-container .action {
  color: var(--cv-fg-muted);
}

.monaco-editor .monaco-hover .hover-row.status-bar .action-container .action:hover {
  color: var(--cv-fg-strong);
}

.monaco-editor .suggest-widget {
  width: 372px;
  padding: 4px;
}

.monaco-editor .suggest-widget .monaco-list .monaco-list-row {
  height: 24px;
  border-radius: var(--cv-r-sm);
  font-family: var(--cv-font-mono);
  font-size: 12px;
}

.monaco-editor .suggest-widget .monaco-list .monaco-list-row.focused {
  background: var(--cv-tint-3) !important;
  color: var(--cv-fg-strong) !important;
}

.monaco-editor .suggest-widget .monaco-highlighted-label .highlight {
  color: var(--cv-accent);
  font-weight: 600;
}

.monaco-editor .suggest-details {
  color: var(--cv-fg-muted);
}

.monaco-editor .find-widget {
  height: 36px;
  top: 6px !important;
  right: 18px;
  padding: 0 4px 0 2px;
}

.monaco-editor .find-widget .monaco-inputbox {
  border-radius: var(--cv-r-sm) !important;
  background: var(--cv-tint-1) !important;
  box-shadow: inset 0 0 0 1px var(--cv-focus);
}

.monaco-editor .find-widget .monaco-custom-toggle.checked {
  background: var(--cv-accent-soft) !important;
  color: var(--cv-accent) !important;
}

.monaco-editor .find-widget .matchesCount {
  min-width: 52px;
  color: var(--cv-fg-muted);
  font-variant-numeric: tabular-nums;
}

.monaco-editor .peekview-widget {
  border-radius: var(--cv-r-card);
  overflow: hidden;
  box-shadow: var(--cv-shadow-pop);
}

.monaco-editor .peekview-widget .head {
  height: 34px;
  border-bottom: 1px solid var(--cv-hair);
  background: var(--cv-raised);
}

.monaco-editor .peekview-widget .head .peekview-title .filename {
  color: var(--cv-fg-strong);
  font: 500 12px / 1 var(--cv-font-mono);
}

.monaco-editor .peekview-widget .head .peekview-title .dirname,
.monaco-editor .peekview-widget .head .peekview-title .meta {
  color: var(--cv-fg-subtle);
}

.monaco-editor .reference-zone-widget .ref-tree .monaco-list-row {
  border-radius: var(--cv-r-sm);
  font-size: 11.5px;
}

.monaco-editor .reference-zone-widget .ref-tree .monaco-list-row.focused {
  background: var(--cv-tint-3) !important;
}

.cv-peek-rename {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  margin-right: 2px;
  padding: 0 8px;
  border: 0;
  border-radius: var(--cv-r-sm);
  background: transparent;
  color: var(--cv-fg-muted);
  font: var(--cv-t-xs) / 1 var(--cv-font-ui);
  cursor: pointer;
}

.cv-peek-rename:hover {
  background: var(--cv-tint-2);
  color: var(--cv-fg-strong);
}
```

Port the moved tab rules (`.editor-tabs`, `.editor-tab*`, `.tab-main`, `.tab-close`, `.editor-tab-status*`, `.dirty-dot`) into `editorPanel.css`. Non-active split groups and the editor-only fallback still render `EditorTabs` inline. Restyle them to mockup `.ptab`:
- 24px high, max 144px wide, `--cv-r-sm`, `--cv-t-xs`, colour `--cv-fg-subtle`;
- hover `--cv-tint-2`, selected `--cv-tint-3` with `--cv-fg-strong`;
- preview `font-style: italic`;
- the dirty dot is 6px `currentColor` with `box-shadow: var(--cv-ring-canvas)`;
- the close glyph replaces the file icon on hover.

The `!important` flags override Monaco's own inline widget styles, which are applied as element styles. Port the remaining suggest codicon colour rules from `App.css` to `var(--cv-syn-kw)`, `var(--cv-syn-num)`, `var(--cv-syn-str)` and `var(--cv-accent)`, keeping the same kind-to-colour pairing. Import `editorGutter.css` and `editorWidgets.css` from `EditorPanelLayout.tsx`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/domain/appearanceEditorColors.test.ts src/domain/cssColor.test.ts src/infrastructure src/components/editorChangeMonacoMappings.test.ts src/components/editorPanel src/components/EditorSurface.test.tsx src/components/themePalettes.test.ts src/ui/tokens`
Expected: PASS. Token contrast and sync tests stay green.

- [ ] **Step 6: Commit**

```bash
git add src/components/editorPanel src/domain/appearanceEditorColors.ts src/domain/appearanceEditorColors.test.ts src/domain/cssColor.ts src/domain/cssColor.test.ts src/components/editorChangeMonacoMappings.ts src/components/editorChangeMonacoMappings.test.ts src/components/editorSurfaceCore src/components/EditorSurface.test.tsx src/infrastructure src/components/themePalettes.ts src/components/TerminalPanel.tsx src/components/GitDiffPreview.tsx src/App.css
git commit -m "feat(editor): restyle gutter, inline values and Monaco widgets with palette tokens"
```

---

### Task 12: "Rename F2" in the references peek header

**Files:**
- Create: `src/components/editorPanel/referencesPeekRename.ts`, `src/components/editorPanel/referencesPeekRename.test.ts`
- Integration: `src/components/editorSurfaceCore/useEditorSurfacePresentation.tsx` (install on mount, dispose on unmount)

**Interfaces:**
- Produces: `installReferencesPeekRename(root: HTMLElement, onRename: () => void, observe?: (target: Node, callback: MutationCallback) => { disconnect(): void }): () => void`. The optional `observe` parameter lets tests inject a synchronous observer. `onRename` runs `editor.getAction("editor.action.rename")?.run()` on the main editor, after closing the peek with `editor.trigger("peek", "closeReferenceSearch", null)`.

- [ ] **Step 1: Write the failing test**

Create `src/components/editorPanel/referencesPeekRename.test.ts`:

```ts
// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { installReferencesPeekRename } from "./referencesPeekRename";

function peekDom(): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML =
    '<div class="peekview-widget reference-zone-widget"><div class="head"><div class="peekview-actions"><ul class="actions-container"></ul></div></div></div>';
  document.body.append(root);
  return root;
}

describe("installReferencesPeekRename", () => {
  it("adds one Rename button to an open references peek and runs rename", () => {
    const root = peekDom();
    const onRename = vi.fn();
    const dispose = installReferencesPeekRename(root, onRename);
    const button = root.querySelector<HTMLButtonElement>(".peekview-actions .cv-peek-rename");

    expect(button?.textContent).toBe("RenameF2");
    expect(button?.getAttribute("aria-keyshortcuts")).toBe("F2");
    button?.click();
    expect(onRename).toHaveBeenCalledTimes(1);
    dispose();
    expect(root.querySelector(".cv-peek-rename")).toBeNull();
    root.remove();
  });

  it("decorates a peek that opens later exactly once and ignores other peek kinds", () => {
    const root = document.createElement("div");
    document.body.append(root);
    let trigger: MutationCallback = () => undefined;
    const dispose = installReferencesPeekRename(root, vi.fn(), (_target, callback) => {
      trigger = callback;
      return { disconnect: () => undefined };
    });
    root.innerHTML =
      '<div class="peekview-widget reference-zone-widget"><div class="head"><div class="peekview-actions"></div></div></div>' +
      '<div class="peekview-widget"><div class="head"><div class="peekview-actions"></div></div></div>';
    trigger([], {} as MutationObserver);
    trigger([], {} as MutationObserver);

    expect(root.querySelectorAll(".cv-peek-rename")).toHaveLength(1);
    dispose();
    root.remove();
  });

  it("does nothing when Monaco's peek DOM has no actions container", () => {
    const root = document.createElement("div");
    root.innerHTML = '<div class="peekview-widget reference-zone-widget"><div class="head"></div></div>';
    const dispose = installReferencesPeekRename(root, vi.fn());

    expect(root.querySelector(".cv-peek-rename")).toBeNull();
    dispose();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/editorPanel/referencesPeekRename.test.ts`
Expected: FAIL with unresolved import.

- [ ] **Step 3: Implement**

Create `src/components/editorPanel/referencesPeekRename.ts`:

```ts
const BUTTON_CLASS = "cv-peek-rename";
const PEEK_ACTIONS = ".peekview-widget.reference-zone-widget .peekview-actions";

type Observe = (target: Node, callback: MutationCallback) => { disconnect(): void };

const defaultObserve: Observe = (target, callback) => {
  const observer = new MutationObserver(callback);
  observer.observe(target, { childList: true, subtree: true });
  return observer;
};

export function installReferencesPeekRename(
  root: HTMLElement,
  onRename: () => void,
  observe: Observe = defaultObserve,
): () => void {
  const decorate = (): void => {
    for (const actions of root.querySelectorAll<HTMLElement>(PEEK_ACTIONS)) {
      if (actions.querySelector(`.${BUTTON_CLASS}`) !== null) continue;
      actions.prepend(renameButton(onRename));
    }
  };
  decorate();
  const subscription = observe(root, decorate);
  return () => {
    subscription.disconnect();
    for (const button of root.querySelectorAll(`.${BUTTON_CLASS}`)) button.remove();
  };
}

function renameButton(onRename: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = BUTTON_CLASS;
  button.setAttribute("aria-keyshortcuts", "F2");
  button.append("Rename");
  const kbd = document.createElement("kbd");
  kbd.className = "cv-kbd";
  kbd.textContent = "F2";
  button.append(kbd);
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onRename();
  });
  return button;
}
```

The observer watches only the editor's own DOM node, not `document`, so the cost is bounded to that editor's subtree mutations. `decorate` is idempotent.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/editorPanel/referencesPeekRename.test.ts`
Expected: PASS.

- [ ] **Step 5: Integration (lead)**

In `useEditorSurfacePresentation.tsx`, add an effect keyed on `editor`:

```tsx
  useEffect(() => {
    const node = editor?.getDomNode();
    if (!editor || !node) return;
    return installReferencesPeekRename(node, () => {
      editor.trigger("peek", "closeReferenceSearch", null);
      void editor.getAction("editor.action.rename")?.run();
    });
  }, [editor]);
```

Run: `npx vitest run src/components/EditorSurface.test.tsx src/components/editorPanel`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/editorPanel/referencesPeekRename.ts src/components/editorPanel/referencesPeekRename.test.ts src/components/editorSurfaceCore/useEditorSurfacePresentation.tsx
git commit -m "feat(editor): add Rename to the references peek header"
```

---
### Task 13: Remove the editor-expanded layout, the legacy chrome and the status bar

This task starts only after Tasks 5-10 are integrated. At that point every capability of the editor-expanded workbench already has a home in the agent layout. The P2 working tree state this task builds on:
- `WorkbenchToolbar` has a `status` slot, and `App.tsx:1031-1079` passes it a `<StatusBar ...>` element (`role="group"`, `aria-label="Editor status"`).
- `useEditorStatusPresentation.ts` exists.
- `statusBarRelocation.test.tsx` maps every item to `editorToolbarStatus`.
- `ProjectTabs`, `WorkbenchNavigationChrome` and `WorkbenchToolbar` are mounted only for `!agentModeActive`.

**Files:**
- Modify: `src/domain/agentWorkbenchLayout.ts`, `src/domain/agentWorkbenchLayout.test.ts`
- Modify: `src/application/useAgentWorkbenchLayout.ts`, `src/application/useAgentWorkbenchLayout.test.tsx`
- Modify: `src/components/workbenchShellPlacement.ts`, `src/components/workbenchShellPlacement.test.ts`
- Modify: `src/components/workbenchShellFrame.css`, `src/components/WorkbenchShellFrame.test.tsx`, `src/components/agentMode/agentModeResponsiveStyles.test.ts`
- Modify: `src/components/usePerfScenarioBridgeInstall.ts`, `src/components/usePerfScenarioBridgeInstall.test.tsx`
- Modify: `src/application/workbenchAgentCommands.test.ts`, `src/application/useWorkbenchSidebarDataRefresh.test.tsx`
- Modify: `src/components/statusBarRelocation.test.tsx` (new homes)
- Modify: `src/App.tsx`, `src/App.css` (drop the activity-bar/sidebar grid columns, `.activity-bar*`, `.sidebar*`, `.workbench-toolbar*`, `.editor-status*`, `.project-tabs*` blocks)
- Modify: `src/components/appShellClassName.ts` (+ test, if present)
- Modify: the five `src/App.*.test.tsx` files
- Modify: `src/components/editorPanel/EditorMoreMenu.tsx`, `EditorChromeContext.ts`, `useEditorChromeValue.ts` (+ tests): branch row opens branches, repository label, live unsaved count
- Delete: `src/application/useAgentEditorCollapse.ts`, `src/components/WorkbenchNavigationChrome.tsx`, `src/components/WorkbenchActivityBar.tsx`, `src/components/WorkbenchSidebar.tsx`, `src/components/WorkbenchSidebar.nodePackageScripts.test.ts` (see Step 5), `src/components/WorkbenchToolbar.tsx`, `src/components/WorkbenchToolbar.test.tsx`, `src/components/StatusBar.tsx`, `src/components/StatusBar.test.tsx`, `src/components/StatusBar.cursorStore.test.tsx`, `src/components/ProjectTabs.tsx` + `src/components/ProjectTabs.test.tsx` (only if `rg` finds no other importer)
- Modify: `scripts/hotspot-size-baseline.json` (lowered by `npm run size:hotspots:update` only if `App.tsx` shrank)

**Interfaces:**
- Produces:
  - `AGENT_WORKBENCH_LAYOUT_MODES = ["agent", "editor-only"] as const`. The mode is derived, never stored.
  - `AgentWorkbenchLayout` loses `layout`.
  - `AgentWorkbenchLayoutAction` loses `expandEditor` / `collapseEditor` / `toggleEditorExpanded`.
  - `AgentWorkbenchLayoutState.effectiveLayout: AgentWorkbenchLayoutMode` = `"agent"` when the agent layout is available, else `"editor-only"`.
  - `EditorChrome` gains `openBranches(): void` and `readonly branchRepositoryLabel: string | null`. `EditorStatusRow` `branch` shows `"<branch> · <repository label>"` when the label is non-null. `EditorChromeInput` gains `branchRepositoryLabel` and `actions.openBranches`, and takes `dirtyCount` from the live `ownerDirtyCountProjection` snapshot (below).

- [ ] **Step 1: Write the failing tests**

Replace the editor-expanded cases in `src/domain/agentWorkbenchLayout.test.ts` with:

```ts
describe("layout without an editor-expanded mode", () => {
  it("has no layout field and ignores a legacy persisted editor-expanded snapshot", () => {
    const restored = parseAgentWorkbenchLayout({
      layout: "editor-expanded",
      rightPanel: "closed",
      openSurfaces: ["editor"],
      activeSurface: "editor",
    });

    expect("layout" in restored).toBe(false);
    expect(restored.rightPanel).toBe("closed");
    expect(restored.openSurfaces).toEqual(["editor"]);
  });

  it("does not serialize a layout field", () => {
    expect("layout" in serializeAgentWorkbenchLayout(initialAgentWorkbenchLayout, false)).toBe(false);
  });

  it("toggling the right panel only opens and closes it", () => {
    const opened = agentWorkbenchLayoutReducer(initialAgentWorkbenchLayout, { kind: "toggleRightPanel" });
    const closed = agentWorkbenchLayoutReducer(opened, { kind: "toggleRightPanel" });

    expect(opened.rightPanel).toBe("open");
    expect(closed.rightPanel).toBe("closed");
  });
});
```

Delete every test that dispatches `expandEditor`, `collapseEditor` or `toggleEditorExpanded` or asserts `layout: "editor-expanded"` from `agentWorkbenchLayout.test.ts`, `useAgentWorkbenchLayout.test.tsx`, `workbenchShellPlacement.test.ts`, `WorkbenchShellFrame.test.tsx`, `agentModeResponsiveStyles.test.ts`, `workbenchAgentCommands.test.ts` and `useWorkbenchSidebarDataRefresh.test.tsx`. For each deleted test, check that its subject is either gone (the actions) or covered by the `"editor-only"` placement test below. In `useAgentWorkbenchLayout.test.tsx`, change the unavailable-agent expectation from `"editor-expanded"` to `"editor-only"`.

Add to `src/components/workbenchShellPlacement.test.ts`:

```ts
  it("places the editor across the whole frame when the agent layout is unavailable", () => {
    const placement = workbenchShellPlacement({
      bottomPanelVisible: false,
      effectiveLayout: "editor-only",
      layout: initialAgentWorkbenchLayout,
    });

    expect(placement).toMatchObject({
      layout: "editor-only",
      editorHidden: false,
      rightPanelHidden: true,
      rightPanelMaximized: true,
    });
  });
```

Replace `usePerfScenarioBridgeInstall.test.tsx`'s expand-editor case with:

```tsx
  it("opens the editor surface maximized once per agent workbench under perf autorun", () => {
    const firstDispatch = vi.fn();
    render({ ...silentHost(), agentWorkbench: { effectiveLayout: "agent", dispatch: firstDispatch } });

    expect(firstDispatch.mock.calls.map(([action]) => action)).toEqual([
      { kind: "openSurface", surface: "editor" },
      { kind: "maximizeRightPanel" },
    ]);
  });
```

Keep the file's existing setup that enables perf autorun for that case.

Rewrite `src/components/statusBarRelocation.test.tsx`:
- Replace `"editorToolbarStatus"` in `StatusItemHome` with `"editorSubheader" | "editorMoreMenu" | "composerBranch" | "editorToast"`.
- Map the editor items as follows:

  | Item | Homes |
  |---|---|
  | problems | `editorSubheader` |
  | git branch | `editorMoreMenu`, `composerBranch` |
  | active path | `editorSubheader` |
  | workspace info | `editorMoreMenu` |
  | ide activity | `editorSubheader` |
  | node run | `editorSubheader` |
  | trust | `editorMoreMenu` |
  | mode | `editorMoreMenu` |
  | large file | `editorMoreMenu` |
  | cursor | `editorSubheader` |
  | language | `editorMoreMenu` |
  | unsaved | `editorMoreMenu` |
  | messages | `editorToast` |

- Replace the `it("renders every editor item inside the editor toolbar status group", ...)` case with the test below. It renders the sub-header and opens the More menu, so every editor item is proven to render in its new home:

```tsx
  it("renders every editor item in the editor sub-header or its More menu", () => {
    const chrome = chromeFixture({
      diagnostics: { errors: 1, warnings: 4 },
      activity: { label: "Indexing 40%", state: "scanning", detail: null },
      nodeRun: { canStop: true, label: "Running dev", phase: "running", stopLabel: "Stop dev" },
      statusRows: editorStatusRows({
        activeLanguage: "TypeScript",
        workspaceLabel: "orders-api · TS 5.8",
        gitBranch: "main",
        workspaceTrustLabel: "Trusted",
        intelligenceMode: "fullSmart",
        largeDocumentStatus: { label: "Large file", title: "Large file mode" },
        dirtyCount: 2,
      }),
    });
    mounted = mountUi();
    mounted.render(
      <EditorChromeContext.Provider value={chrome}>
        <EditorSubheader documentPath="/w/src/app.ts" groupId="editor-main" onFind={vi.fn()} rootPath="/w" symbols={null} />
      </EditorChromeContext.Provider>,
    );
    const subheader = mounted.host.querySelector(".cv-esub");

    expect(subheader?.textContent).toContain("src");
    expect(subheader?.textContent).toContain("app.ts");
    expect(subheader?.textContent).toContain("Running dev");
    expect(subheader?.querySelector('button[aria-label="1 error, 4 warnings. Show problems"]')).not.toBeNull();
    expect(subheader?.querySelector('button[aria-label="Indexing 40%"]')).not.toBeNull();
    click(subheader?.querySelector('button[aria-label="More editor actions"]') as Element);
    const menu = document.body.querySelector('[role="menu"][aria-label="More editor actions"]');
    for (const expected of ["TypeScript", "orders-api · TS 5.8", "main", "Trusted", "IDE Mode", "Large file", "2 files"]) {
      expect(menu?.textContent, expected).toContain(expected);
    }
    expect(mounted.host.querySelector("footer")).toBeNull();
  });
```

Add imports for `click` from `foundationTestSupport`, `EditorChromeContext` and `EditorSubheader`, `editorStatusRows`, and `chromeFixture` from `./editorPanel/EditorSubheader.test`. Remove the `StatusBar` and `WorkbenchToolbar` imports.

- Extend the last case ("leaves no status bar row, stylesheet or component behind") with:

```tsx
    for (const removed of [
      "src/components/StatusBar.tsx",
      "src/components/WorkbenchToolbar.tsx",
      "src/components/WorkbenchNavigationChrome.tsx",
      "src/components/WorkbenchActivityBar.tsx",
      "src/components/WorkbenchSidebar.tsx",
      "src/application/useAgentEditorCollapse.ts",
    ]) {
      expect(existsSync(resolve(root, removed)), removed).toBe(false);
    }
    expect(appCss).not.toContain(".editor-status");
    expect(appCss).not.toContain(".activity-bar");
    expect(appCss).not.toContain(".workbench-toolbar");
```

Append to `src/components/editorPanel/EditorMoreMenu.test.tsx`:

```tsx
  it("opens the branch picker from the Branch row", () => {
    const chrome = chromeFixture({ statusRows: [{ id: "branch", label: "Branch", value: "main · api" }] });
    const { menu } = openMenu(chrome);
    click([...(menu?.querySelectorAll('[role="menuitem"]') ?? [])].find((item) => item.textContent?.includes("main · api")) as Element);

    expect(chrome.openBranches).toHaveBeenCalledTimes(1);
  });
```

Add `openBranches: vi.fn()` and `branchRepositoryLabel: null` to `chromeFixture` in `EditorSubheader.test.tsx`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/domain/agentWorkbenchLayout.test.ts src/components/workbenchShellPlacement.test.ts src/components/usePerfScenarioBridgeInstall.test.tsx src/components/statusBarRelocation.test.tsx src/components/editorPanel/EditorMoreMenu.test.tsx`
Expected: FAIL. `layout` is still present, the `"editor-only"` mode is unknown, the perf bridge dispatches `expandEditor`, the removed files still exist, and the Branch row is not a menu item.

- [ ] **Step 3: Domain and placement**

In `src/domain/agentWorkbenchLayout.ts`:
- `AGENT_WORKBENCH_LAYOUT_MODES = ["agent", "editor-only"] as const`.
- Remove the `layout` field from `AgentWorkbenchLayout`, `initialAgentWorkbenchLayout`, `serializeAgentWorkbenchLayout` and `agentWorkbenchLayoutsEqual`.
- Remove the three actions, their reducer cases, `expandEditor` and `collapseEditor`.
- Remove the `state.layout === "agent" &&` guards in `openSurface`, `showSurfaceChooser`, `openRightPanel`, `toggleRightPanel` and `toggleMaximized`, and every `layout: "agent"` spread.
- `parseAgentWorkbenchLayout` no longer reads `value.layout`: `rightPanel` is always `parseRightPanel(value.rightPanel, openSurfaces)`.

For example, `toggleRightPanel` becomes:

```ts
function toggleRightPanel(state: AgentWorkbenchLayout): AgentWorkbenchLayout {
  if (state.rightPanel === "open") return { ...state, ...CLOSED_RIGHT_PANEL };
  return openRightPanel(state);
}
```

and `openRightPanel`:

```ts
function openRightPanel(state: AgentWorkbenchLayout): AgentWorkbenchLayout {
  if (state.rightPanel === "open") return state;
  const activeSurface = state.activeSurface ?? state.openSurfaces[0] ?? null;
  return { ...state, rightPanel: "open", activeSurface };
}
```

In `src/application/useAgentWorkbenchLayout.ts`:
- line 145 becomes `const layout: AgentWorkbenchLayout = parseAgentWorkbenchLayout(hydration.layout);`;
- line 160-163 becomes `const effectiveLayout: AgentWorkbenchLayoutMode = agentLayoutAvailable ? "agent" : "editor-only";`.

In `src/components/workbenchShellPlacement.ts`, the early return becomes:

```ts
  if (effectiveLayout === "editor-only") {
    return {
      layout: effectiveLayout,
      editorHidden: false,
      rightPanelHidden: true,
      surfacesMounted: false,
      rightPanelMaximized: true,
      responsiveMaximized: false,
      rightPanelOverlay: false,
      responsiveRestore: "none",
      rail: "collapsed",
      railWidth: DEFAULT_AGENT_RAIL_WIDTH,
      rightPanelWidth: 0,
      bottomPanelHeight: bottomPanelVisible ? layout.bottomPanelHeight : 0,
    };
  }
```

and `agentSurfaceHostPlacement({ ...layout, layout: effectiveLayout })` becomes `agentSurfaceHostPlacement(layout)`. Adjust `agentSurfaceHostPlacement`'s parameter type if it read `layout`. `rightPanelMaximized: true` is what Task 10's `debugViewsPlacement` reads, so the debug side column works in the fallback too.

In `src/components/workbenchShellFrame.css`, rename the two `[data-layout="editor-expanded"]` selectors to `[data-layout="editor-only"]`. Add, next to them:

```css
.workbench-frame[data-layout="editor-only"] > [data-slot="editor"] {
  grid-column: 1 / -1;
  grid-row: 1 / -1;
}
```

- [ ] **Step 4: Perf bridge**

In `src/components/usePerfScenarioBridgeInstall.ts`, the autorun effect becomes:

```ts
  useEffect(() => {
    if (perfAutorunEnabled() && agentWorkbench?.effectiveLayout === "agent") {
      agentWorkbench.dispatch({ kind: "openSurface", surface: "editor" });
      agentWorkbench.dispatch({ kind: "maximizeRightPanel" });
    }
  }, [agentWorkbench]);
```

The comment above the effect in the source is removed per CLAUDE.md. Search the perf scripts with `rg -n "expandEditor|editor-expanded" scripts src` and update any remaining reference to use the same two dispatches.

- [ ] **Step 5: Remove the legacy chrome from `App.tsx`**

Delete from `App.tsx`:
- the `<WorkbenchNavigationChrome ... />` element and its import;
- the `ProjectTabs` block;
- the whole `<WorkbenchToolbar ... status={<StatusBar .../>} />` element and its imports;
- `useAgentEditorCollapse` / `collapseEditor`;
- `startSidebarResize` if its only consumer was the navigation chrome;
- any variable that becomes unused (`ideProgress`, `showProgressPanel`, `openWorkspace`, `showCommands`, `openSettings`, `showGit`, and so on). Remove each one only after `npm run check` and `npm run lint` report it unused.

Keep `ExternalFileConflictBar` in the `chrome` slot.

Wire the relocated status inputs into `useEditorChromeValue` (built in Task 6 and placed in Task 5/10), reusing the exact expressions the deleted `<StatusBar>` received:

| Chrome input | Source expression |
|---|---|
| `gitBranch` | `workbench.gitBranch ?? workbench.gitStatus?.branch ?? null` |
| `branchRepositoryLabel` | `workbench.gitBranchRepositoryLabel ?? null` |
| `largeDocumentStatus` | `activeEditorDegradedStatus` |
| `nodeRun` | `presentOptionalNodeRunWithoutDebugging(workbench.nodeRunWithoutDebugging.state)` |
| `actions.stopNodeRun` | `workbench.nodeRunWithoutDebugging.stop` |
| `actions.openBranches` | `workbench.openGitBranchPanel` |
| `actions.showGoToLine` | `showGoToLine` |
| `actions.toggleIdeMode` | `toggleSmartMode` |
| `actions.trustWorkspace` | `trustWorkspace` |
| `workspaceTrustLabel` | `workbench.workspaceRoot ? (workspaceTrusted ? "Trusted" : "Untrusted") : null` |
| `status` | `editorStatus` |
| `statusBar` | `workbench.workspaceSettings.statusBar` |

`dirtyCount` is the live projection. Call `useEditorOwnerDirtyCountSnapshot(workbench.documentSessionAuthorityRevision.ownerDirtyCountProjection)` in `App.tsx` exactly as `StatusBar.tsx` did (read its `effectiveDirtyCount` computation and copy that expression), and pass the resulting number.

In `EditorMoreMenu.tsx`, the Editor status rows stay presentational. The one exception is the `branch` row, which renders as a `MenuItem` (`onSelect={chrome.openBranches}`) whose content is the same `label`/`value` pair. In `editorStatusRows`, add `branchRepositoryLabel: string | null` to the input and join the value as `branch · label` when the label is non-null. Extend the `editorStatusRows` test with that case.

Delete the files listed under **Delete**. Then `rg -n "WorkbenchNavigationChrome|WorkbenchActivityBar|WorkbenchSidebar|WorkbenchToolbar|StatusBar\b|useAgentEditorCollapse|ProjectTabs" src` must print only `statusBarRelocation.test.tsx` string literals and the `StatusBarItemVisibility` type name. For `WorkbenchSidebar.nodePackageScripts.test.ts`, read it first. If it tests `WorkbenchSidebar` wiring only, delete it. If it tests `useNodePackageScriptWorkbench` behaviour through the sidebar, move those assertions onto P6's `AgentScriptsSurface.test.tsx` fixture (P6 owns that file, so add them as a new `describe` block at its end and record the hunk in the commit message). If `ProjectTabs.tsx` has another importer, keep it.

In `App.css`:
- Change `.app-shell`'s grid so it no longer reserves the activity-bar/sidebar columns (read the current P2 `grid-template-columns` rules at `.app-shell`, `.app-shell--agent-mode` and `.app-shell--settings:not(.app-shell--agent-mode)`). Every layout now uses a single `minmax(0, 1fr)` column.
- Delete `.activity-bar*`, `.sidebar*` (only the workbench sidebar blocks; the agent rail uses `agentRail.css`), `.workbench-toolbar*`, `.toolbar-*`, `.smart-mode-switch*`, `.editor-status*`, `.status-*` and `.project-tabs*` / `.project-tab*`.

`appShellClassName` keeps only the settings and mac modifiers. Update its test to match.

- [ ] **Step 6: Migrate the App integration tests**

The five `src/App.*.test.tsx` files render `App` without an agent root lease gateway. They then relied on the classic layout's inline tabs, activity bar and status bar. After this task they run in `"editor-only"`. Update them as follows:
- Queries for tabs stay valid, because inline `EditorTabs` render in editor-only. Selectors that targeted `.editor-tab` now target the restyled class if it changed in Task 11.
- Queries for the status bar (`footer.status-bar`, `.editor-status`) move to the sub-header (`.cv-esub`) or the More menu.
- Clicks on activity-bar buttons are replaced by the equivalent command (`runCommand("git.show")`, `runCommand("commands.show")`, and so on).
- Tests that opened the Files sidebar tab to open a file use the command palette or `workbench.openFile` path they already have access to. If a test's purpose was the sidebar itself, delete it and name the P6 test that now covers the Files surface.

Every changed test keeps its behavioural assertion. Only the route to the UI changes.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/domain src/application/useAgentWorkbenchLayout.test.tsx src/components/workbenchShellPlacement.test.ts src/components/WorkbenchShellFrame.test.tsx src/components/usePerfScenarioBridgeInstall.test.tsx src/components/statusBarRelocation.test.tsx src/components/editorPanel src/components/agentMode src/App.commandRouting.test.tsx src/App.dockedTextSearch.integration.test.tsx src/App.gitDiffBoundary.test.tsx src/App.gitDiffClick.test.tsx src/App.quickOpen.integration.test.tsx && npm run check && npm run lint -- --max-warnings 0 && npm run size:hotspots`
Expected: all PASS; `size:hotspots` passes. If `App.tsx` shrank below its baseline, run `npm run size:hotspots:update` and confirm with `git diff scripts/hotspot-size-baseline.json` that only decreases appear. Otherwise leave the baseline untouched.

- [ ] **Step 8: Commit**

```bash
git add -A src/domain/agentWorkbenchLayout.ts src/domain/agentWorkbenchLayout.test.ts src/application src/components src/App.tsx src/App.css src/App.commandRouting.test.tsx src/App.dockedTextSearch.integration.test.tsx src/App.gitDiffBoundary.test.tsx src/App.gitDiffClick.test.tsx src/App.quickOpen.integration.test.tsx scripts/hotspot-size-baseline.json
git commit -m "refactor(editor): remove the editor-expanded layout and the status bar"
```

Before `git add -A` on directories, run `git status --short src scripts` and add only the paths this task changed. Unrelated working-tree changes, for example another phase's uncommitted files, must stay unstaged.

---

### Task 14: Performance evidence (large files, typing, tab strip)

**Files:**
- Create: `src/components/editorPanel/editorPanelRenderWork.perf.test.tsx`
- No production files. If a regression is found, fix it in the task that owns the file and rerun this task.

- [ ] **Step 1: Write the render-work test**

Create `src/components/editorPanel/editorPanelRenderWork.perf.test.tsx`:

```tsx
// @vitest-environment jsdom

import { memo, useContext } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditorDocument } from "../../domain/workspace";
import { mountUi, type MountedUi } from "../../ui/foundation/foundationTestSupport";
import { EditorPanelDocumentsContext, useEditorPanelDocumentsValue } from "./EditorPanelDocumentsContext";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let mounted: MountedUi | null = null;

afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

const StripConsumer = memo(function StripConsumer({ onRender }: { onRender(): void }) {
  useContext(EditorPanelDocumentsContext);
  onRender();
  return null;
});

function Host({ content, onStripRender }: { readonly content: string; onStripRender(): void }) {
  const value = useEditorPanelDocumentsValue({
    group: { activePath: "/w/large.ts", openPaths: ["/w/large.ts", "/w/b.ts"], previewPath: null },
    documents: [
      { path: "/w/large.ts", name: "large.ts", content, savedContent: "x", language: "typescript" } satisfies EditorDocument,
      { path: "/w/b.ts", name: "b.ts", content: "b", savedContent: "b", language: "typescript" } satisfies EditorDocument,
    ],
    onActivate: () => undefined,
    onClose: () => undefined,
    onOpenFile: () => undefined,
    onEmpty: () => undefined,
  });
  return (
    <EditorPanelDocumentsContext.Provider value={value}>
      <StripConsumer onRender={onStripRender} />
    </EditorPanelDocumentsContext.Provider>
  );
}

describe("editor panel render work per keystroke", () => {
  it("re-renders the tab strip consumer once for the first dirty flip and never for 200 further keystrokes", () => {
    const onStripRender = vi.fn();
    const base = "x".repeat(300_000);
    mounted = mountUi();
    mounted.render(<Host content="x" onStripRender={onStripRender} />);
    for (let index = 0; index < 200; index += 1) {
      mounted.render(<Host content={`${base}${index}`} onStripRender={onStripRender} />);
    }

    expect(onStripRender).toHaveBeenCalledTimes(2);
  });
});
```


- [ ] **Step 2: Run it**

Run: `npx vitest run src/components/editorPanel/editorPanelRenderWork.perf.test.tsx`
Expected: PASS: 2 renders (mount plus the dirty flip). If it fails, the fix is in `useEditorPanelDocumentsValue` (Task 7), not in the test.

- [ ] **Step 3: Measure typing and tab switching before and after**

Run the autorun smoke lane twice. The first run uses the commit before P7 (`git stash` is not allowed, so use a detached worktree: `git worktree add /tmp/codevo-p7-base <sha-before-P7>`, then `npm ci && npm run perf:fixtures && npm run perf:autorun:smoke` there). The second run uses the P7 tip (`npm run perf:autorun:smoke` in the main checkout). Remove the worktree afterwards with `git worktree remove /tmp/codevo-p7-base`.

Expected: `typing-large-5k` and `tab-switch-cycle` p95 within 10% of the base run, or within the lane's documented noise band in `docs/PERFORMANCE.md`. Record both tables, which the lane writes to `perf/results/`, in the final report. Do not commit `perf/results/*`.

If the autorun lane cannot run on this machine (no GUI session), record that as an unverified gap in the final report and run `npm run perf:smoke` only if a CDP listener is available.

- [ ] **Step 4: Large-file behaviour check (manual, in QA)**

Task 17's QA prompt step 9 opens the `large-20k.ts` fixture. It must show the large-file notice under the sub-header, no symbol crumbs, a responsive caret, and working find and go-to-line.

- [ ] **Step 5: Commit**

```bash
git add src/components/editorPanel/editorPanelRenderWork.perf.test.tsx
git commit -m "test(editor): pin tab strip render work per keystroke"
```

---

### Task 15: Full repository gates (lead)

- [ ] **Step 1: Frontend gates**

Run each command separately and check its exit code (`echo $?`), never through a pipe:

```bash
npm run check
npm run lint -- --max-warnings 0
npm run lint:exhaustive-deps
npm run build
npm run size:hotspots
npm run format:check
npm run format:check:changed
npm test -- --run
```

Expected: every exit code is 0. `npm run build` is listed in CLAUDE.md's completion gates for this repository, so it runs here even though it is slow. For `format:check:changed` failures, run `npx prettier --write <each changed file>` on the listed files only, never on a directory.

- [ ] **Step 2: Rust gates**

P7 changes no Rust code, but the gates are required:

```bash
cd src-tauri
cargo check --all-targets
cargo test --lib
cargo test --tests
cargo fmt --all -- --check
cargo clippy --all-targets -- -D warnings
```

Expected: exit 0 for each. If Node watch tests are flaky under load, the memory note applies: run them sequentially, and free port 9229 before a rerun.

- [ ] **Step 3: Diff hygiene**

Run: `git diff --check` and `rg -n "WorkbenchEditorTabsPortal|editor-expanded|expandEditor|collapseEditor|footer.status-bar|var\(--(border-subtle|text-muted|background-active|status-error)" src`
Expected: no output from either.

---

### Task 16: Independent read-only review (Opus 5.5)

- [ ] **Step 1: Dispatch the reviewer**

Spawn a separate agent (model `opus`, read-only: it runs no git mutations and edits no files) with this prompt:

```text
You are reviewing phase P7 (editor and debugging surfaces) of the Codevo redesign in /Users/matusmockor/Developer/editor. Read CLAUDE.md, docs/superpowers/specs/2026-09-23-codevo-redesign-design.md (§3.1.9, §4, §6), docs/redesign/v3-editor.html and docs/superpowers/plans/2026-09-24-redesign-p7-editor.md. Review the P7 commits (git log --oneline main, the commits whose messages start with feat(editor), feat(debug), refactor(editor), test(editor)) with git show / git diff. Do not edit files or run git commands that change state.
Check, with file:line evidence:
1. Nothing was lost by removing the editor-expanded layout: every former sidebar view, activity-bar action, toolbar control, status bar item and bottom-panel view is reachable in the agent layout (list each with its new route).
2. Workspace isolation: A -> B -> A for debug focus (useEditorDebugFocus), drawer reveal (useEditorDrawerReveal), panel documents context, cursor authority; remote threads never get the editor surface.
3. Per-keystroke work: the strip context, chrome value and sub-header must not re-render on keystrokes that do not change tab/dirty/active state; no unbounded work per edit; large-file degraded mode still shown.
4. Terminal session survival when switching Terminal <-> drawer views; drawer and bottom slot never both claim the same view.
5. Debug region split: every DebugPanel control still rendered under the same enable/disable conditions; exception rows map exactly to none/uncaught/all and respect pending/trust.
6. Tokens only in new CSS, reduced motion respected, keyboard access (tabs, drawer tabs roving, menus, resize handle y-axis), focus-visible rings.
7. Hotspots: App.tsx, useWorkbenchController.ts and EditorSurface.tsx did not grow in structural tokens; baseline only lowered.
8. Tests: behavioural assertions preserved when migrated; no suppressed warnings; no eslint-disable added.
Report P0/P1/P2 findings with file:line and a concrete fix, then a list of verified-OK items.
```

- [ ] **Step 2: Resolve findings**

Verify each finding in code before fixing it, because audits in this repository tend to overstate (memory rule). Fix real P0/P1 findings through the owning task's files, rerun that task's focused tests, then rerun Task 15. For rejected findings, record the reason in the final report.

---

### Task 17: QA build and Codex computer-use QA

- [ ] **Step 1: Build the QA app**

Run: `npx tauri build --debug --bundles app --config '{"identifier":"dev.mockor.editor.qa","productName":"Codevo QA"}'`
Expected: `src-tauri/target/debug/bundle/macos/Codevo QA.app` exists. An exit code of 1 caused only by the missing updater signing key is acceptable. A compile error is not.

- [ ] **Step 2: Start it in the user's GUI session**

Run: `open "src-tauri/target/debug/bundle/macos/Codevo QA.app" && sleep 3 && osascript -e 'tell application "Codevo QA" to activate'`
Expected: the "Codevo QA" window is frontmost. Do not use `npm run debug`, and never touch the "Codevo Editor" app.

- [ ] **Step 3: Write the QA prompt**

```bash
mkdir -p ~/tmp/codevo-qa && cat > ~/tmp/codevo-qa/qa_prompt_p7.txt <<'QA'
You are a UI QA tester with Computer Use. First action: take a screenshot. If Computer Use is unavailable, reply only COMPUTER_USE_UNAVAILABLE and stop.
ATTACH ONLY to the already running app "Codevo QA". Never launch, quit or open any app, never touch the app named "Codevo Editor", never edit files. Before EVERY screenshot run: osascript -e 'tell application "Codevo QA" to activate'. Compare against the mockup description given per step. For each step report: worked / failed, what you saw, and attach the screenshot.
Setup: a project with TypeScript files is open (use the Express API project if present). Palette Graphite · Teal, Dark.
1. Open src/**/any .ts file with Cmd+P. Expected: the right panel opens with an editor tab in the panel tab strip (24px tab, file icon, name), a 40px sub-header with folder crumbs > file > symbol, and the code below.
2. Hover the editor. Expected: sub-header actions fade in on the right: "Ln x, Col y", error/warning counts, Find, Split, More (three dots). Click the error/warning counts: a drawer opens under the code with tabs "Problems (n)" and "Debug console", a Filter field, and file-grouped problem rows. Press Escape or click X to close it. Press Cmd+Shift+M: Problems opens again.
3. Type a character in the file. Expected: the tab shows a small dot (unsaved). Single-click a different file in the Files surface: it opens as a preview tab with an italic name. Double-click it: the name is no longer italic.
4. Hover a symbol with a type error (introduce one if needed, e.g. assign a number to a string const). Expected: a hover card with the error text, source code like ts(2322), and "View Problem" / "Quick Fix..." actions. Type "res." inside an Express handler: a completion list (about 372px wide) with matched letters highlighted in the accent colour.
5. Right-click a function name > Find All References or press Shift+F12. Expected: an inline peek with a file list on the right and a "Rename F2" button in its header. Click Rename: the rename box appears on the original symbol. Press Escape.
6. Press Cmd+F. Expected: a find widget at the top right of the code (about 36px high) with Aa, ab, .* toggles, "n of m", previous/next/close, and matches highlighted in amber.
7. Click in the gutter left of a line number. Expected: a red breakpoint dot appears. Hover a line of changed code: a thin blue (modified) or green (added) bar left of the code.
8. Click "Maximize panel" in the panel top bar. Expected: the conversation column disappears and the editor fills the window (focus mode). Click "Restore panel": the conversation comes back.
9. Open the large fixture file (perf/fixtures large-20k.ts, or any file over 5,000 lines). Expected: a quiet large-file notice under the sub-header, typing stays responsive, Cmd+F and Cmd+L (go to line) still work.
10. Start debugging a Node script with F5 (pick a launch configuration if asked; a script that hits a breakpoint on line with a variable). Expected: the panel enters focus mode automatically; the sub-header shows "Paused on breakpoint" with Continue, Step over, Step into, Step out, Restart, Stop; a 304px side column shows Variables, Watch, Call stack, Breakpoints (with "All exceptions" / "Uncaught exceptions" rows); the drawer shows "Debug console" with an input row; inline values appear in italic after code lines; the paused line has an amber background. Press F10 once: the paused line moves. Type an expression in the console input and press Enter: a result line appears. Press Shift+F5: the session stops and the panel returns to its previous size.
11. Press Cmd+J. Expected: the terminal opens at the bottom and the Problems/Debug drawer closes. Run "echo p7". Press Cmd+Shift+M, then Cmd+J again: the same terminal with "p7" in its history is shown.
12. Open the three-dots More menu in the sub-header. Expected: Start debugging, Run without debugging, Launch configurations, Attach to Node process, Show debug views, Split right, Split down, IDE mode (checked), and an "Editor status" section with Language, Project, Branch, Trust, Mode rows.
13. Switch Settings > Appearance to Light, then to palette Ink · Mint, Dark, and repeat screenshots of steps 1, 2 and 10 in both. Expected: no low-contrast text, drawer/side column/popovers follow the palette.
Final: list every failed step with a one-line description.
QA
```

- [ ] **Step 4: Run the orchestrator**

Run in the background, with a 45 minute cap inside the orchestrator: `python3 ~/tmp/codevo-qa/qa_orchestrator_v2.py ~/tmp/codevo-qa/qa_prompt_p7.txt > /tmp/qa-p7.log 2>&1`
Expected: the log ends with the tester's report. Watch only the final or error lines (`COMPUTER_USE_UNAVAILABLE`, `TIMEOUT`, `ERROR`, the final agent message). If the permission classifier blocks the run, ask the user to run the same command with the `!` prefix, or to paste the prompt into their own interactive `codex` session and paste the report back.

- [ ] **Step 5: Fix loop**

For each failed step:
1. Confirm the root cause in code.
2. Fix it in the owning task's files.
3. Rerun that task's focused tests and Task 15.
4. Get a short reviewer pass on the fix.
5. Rebuild the QA app and rerun only the failed steps (a new prompt file containing only those steps).

- [ ] **Step 6: Clean up**

Run: `osascript -e 'quit app "Codevo QA"'; rm -f /tmp/qa-p7.log ~/tmp/codevo-qa/qa_prompt_p7.txt`
Expected: exit 0.

---

### Task 18: Commit to `main`

Per the lead's instruction for this program, commit without waiting for the owner once Tasks 15-17 pass. Do not push or tag.

- [ ] **Step 1: Verify the tree**

Run: `git status --short` and `git log --oneline -20`
Expected:
- every P7 change is committed by its task, or staged for this final commit;
- no unrelated working-tree changes (other phases, user edits, `perf/results`, QA logs) are staged;
- the commit messages contain no AI, Claude, Anthropic or co-author attribution.

- [ ] **Step 2: Commit any remaining review/QA fixes**

```bash
git add <each file changed by review or QA fixes>
git commit -m "fix(editor): address P7 review and QA findings"
```

Expected: exit 0. Skip this step if there is nothing left to commit. No `git push`, no `git tag`.

---

## Self-Review

**1. Spec coverage** (§3.1.9 and the lead decision -> task):

| Requirement | Task(s) |
|---|---|
| Editor in the right panel | 1, 7, 8 |
| Maximize/focus mode | P2's control; 8 slot, 10 auto-focus, 13 only presentation |
| Tabs with dirty dot and italic preview | 4, 7, 11 |
| Breadcrumb sub-header with hover actions | 5, 6 |
| Gutter: breakpoints, git markers, folds | 11 |
| Hover cards with quick fix | 11 (native marker hover actions restyled) |
| Completion | 11 |
| References peek with rename | 11, 12 |
| Problems drawer | 2, 9 |
| Find widget | 5 (Find action), 11 (style) |
| Node debugging: toolbar, variables, watch, call stack, breakpoints, console, inline values, in focus mode | 3, 10, 11 |
| Standalone editor chrome (lead decision: removed) | 13 |
| Status group moved to the sub-header | 5, 6, 13 |
| Bottom panel / Problems / debug reachable from focus mode | 9, 10 |
| Large-file rules | 5 (notice row kept), 14 |
| Tokens in 6 palettes x 2 schemes | 11, 17 |
| Gates, review, QA, commit | 15-18 |

Gap reported rather than planned: the mockup's split-editor button in the panel works through the existing editor groups, and non-active groups keep inline tabs. The mockup shows no second group, so there is nothing further to match.

**2. Placeholder scan:** No "TBD", "TODO" or "similar to Task N" remains. Where a sibling phase's final name was not yet known, the step names the exact file and the rule for choosing, plus the P6/P5 names confirmed by message:
- P6 fixture names in `agentRightPanelTabEntries.test.ts`;
- the ProblemsPanel filter label;
- the keymap export name;
- `DebugStopReason` spelling.

**3. Type consistency:** These names are used consistently across tasks:
- `EditorChrome` (5) is consumed in 6, 10 and 13, and `openBranches` / `branchRepositoryLabel` are added in 13 together with their fixture fields.
- `EditorDrawerView` / `workbenchPanelPlacement` (2) are used in 8, 9 and 10.
- `debugViewsPlacement({ maximized, phase, drawerView })` (3) is used in 10.
- `EditorPanelDocumentsValue` (7) plus `surfaceActive`, added in `AgentSurfaceHost` to form P6's `AgentRightPanelEditorDocuments`.
- `EditorDrawerFrame` (9) is used by `WorkbenchEditorDrawerHost` and `EditorPanelLayout`.
- `PrivateDebugRegions` (10) is used in the App integration.
- `AgentWorkbenchLayoutMode = "agent" | "editor-only"` (13) replaces `"editor-expanded"` in placement, CSS and tests.

`EditorDebugEntry` uses `"showViews"` everywhere (no leftover `toggleViews`).

**4. Review Focus -> tests:**

| Review Focus | Pinned by |
|---|---|
| 1. Terminal survival | Task 9 Step 9 `App.commandRouting.test.tsx` case plus the `workbenchPanelPlacement` tests |
| 2. Debug focus with manual layout changes / A -> B -> A | Task 3 reducer tests and the Task 10 `useEditorDebugFocus` tests |
| 3. Per-keystroke render work and large files | Task 4 equality tests, Task 7 context tests, the Task 14 perf test and QA step 9 |
| 4. Remote threads | Task 1 activation tests and the Task 7 `AgentSurfaceHost` hunk |
| 5. Exception rows and pending | Task 3 mapping table and the Task 10 `DebugSectionsRegion` test |

**Residual risks (for the final report):**
- The references-peek Rename button depends on Monaco's peek DOM classes. It degrades to absent if they change (tested); F2 keeps working.
- Task 13 migrates five App integration tests. They are the largest review surface of the phase.
- Tasks 9 and 10 rely on P6's final prop names (`editorDocuments`, `AgentFilesSurface` props, `AgentRightPanelContext`), as confirmed by the P6 planner. If P6's implementation drifts from its plan, the integration steps must follow the implemented names.
- Performance evidence depends on the autorun lane being runnable in a GUI session. If it cannot run, the gap is reported instead of being claimed as covered.
