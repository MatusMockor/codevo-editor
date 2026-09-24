# Redesign P2 - App Shell (window chrome, top bar, sidebar frame, right panel frame, no status bar) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the agent-mode home screen frame to the approved v3 mockups - macOS window chrome with the traffic lights in a 52px top bar, a 256px collapsible and resizable sidebar frame, a conversation column container, a collapsible/resizable/maximizable right panel frame that remembers its width per workspace, and no status bar (every status bar item relocated and inventoried) - plus the three P1 carry-overs (hover/active tint contrast, light-palette native window flash, faint panel borders).

**Architecture:** One shell primitive (`src/ui/shell/TopBar.tsx` + `shell.css`, `--cv-*` tokens only) renders all three 52px bars (sidebar, main, panel); the existing layout reducer (`src/domain/agentWorkbenchLayout.ts`) and frame placement (`WorkbenchShellFrame` / `workbenchShellPlacement.ts`) stay the single source of frame state, with the collapsed sidebar now taking a 0px track. Status bar data moves to its new homes (sidebar thread activity, tooltips, the editor-mode toolbar) and an inventory test pins that every former item has a home. Native window flash is removed by a hidden-until-revealed window whose native background is set to the resolved palette before `show()`, with a Rust fallback reveal.

**Tech Stack:** React 19, TypeScript 5.8 strict, Vite 8, Vitest 4 + jsdom, lucide-react, plain CSS, Tauri 2.11 (`@tauri-apps/api` 2.11: `Window.show`, `Window.setBackgroundColor`, `Webview.setBackgroundColor`), Rust 2021 + tokio.

**Spec:** `docs/superpowers/specs/2026-09-23-codevo-redesign-design.md` (§3.1 item 3, §4, §5 P2 incl. P1 carry-overs, §6, §7). Visual source of truth: `docs/redesign/v3-monolith-clean.html` (base shell), `docs/redesign/v3-sidebar-agents.html` (collapsed sidebar state), `docs/redesign/v3-right-panel.html` (panel frame, tabs row, resize handle, wide), `docs/redesign/v3-editor.html` (maximize/focus mode). P1 foundation: `src/ui/tokens/**`, `src/ui/foundation/**`, `src/domain/appearance.ts` (commit b1f0f249d).

## Global Constraints

- App shell (spec §3.1.3): "macOS window chrome, 52px top bar (breadcrumb, minimal actions), 256px sidebar, conversation column max 768px, collapsible right panel (default closed, resizable), no status bar (its information moves to hover/tooltips, command palette and settings)."
- Scope: P2 changes the frame only. Conversation, composer and sidebar CONTENT stay as they are (P3/P4 restyle them) but must render correctly inside the new frame.
- Placement (spec §4): tokens and base components in `src/ui/`; this plan adds `src/ui/shell/` for the shell primitive. No feature component defines its own colours; new CSS uses `--cv-*` tokens only.
- Presentation only (spec §4): domain/application/Rust change only where required - here: the collapsed sidebar track (domain), one keymap entry (domain) + its command (application), a native-window port (application), and a Rust startup reveal fallback.
- Hotspots (spec §4): `App.tsx` (baseline 7188 structural tokens), `useWorkbenchController.ts`, `AgentThreadSession.tsx` must shrink or stay flat. `App.tsx` shrinks in Task 11; lower its baseline with `npm run size:hotspots:update` only after the shrink (never raise it). New production files stay far below 2000 lines / 10000 tokens.
- Old styles (spec §4): "Old styles are removed as each surface is migrated; no long-lived dual styling." Every CSS block replaced by the shell primitive is deleted in the same task.
- Agents (spec §7.1): implementation and review agents are Opus 5.5; UI QA is Codex with Computer Use via `codex app-server` against the QA bundle `dev.mockor.editor.qa`.
- Default palette (spec §7.2): Graphite · Teal. Release (spec §7.3): no release, tag or push in P2.
- Accessibility (spec §6): AA (4.5:1) for every text pair, >= 3:1 for separators that are the only boundary between two panels, keyboard access to every control, visible focus rings, `prefers-reduced-motion` honoured (motion only through `--cv-motion-*`).
- Git (CLAUDE.md): work on `main`; subagents never run mutating git commands; the lead commits after review and full gates; commit messages carry no AI/Claude/Anthropic/co-author attribution.
- Review (CLAUDE.md): never run `coderabbit` or `cr`; review is a separate read-only Opus agent.
- Code style (user rules): no code comments (bare tooling annotations only); guard clauses, no `else`; exhaustive unions; no `any`.
- Tests (user rules): real collaborators, no mocks of internal modules (existing App tests keep their existing module mocks); React tests use `act`; tests never `throw`.
- Formatting (repo memory): `npx prettier --write` only on files you created; for modified files run `npm run format:check:changed` and prettier-write only files it lists. Never prettier a directory.
- Token scan (P1 lesson): `src/domain/themeContrast.test.ts` treats every `var(--name` text in `src` as a use that must be declared in a stylesheet. Never write a literal `var(--...` for an undeclared name, not even in a test string.
- Tauri: the window is created hidden (`"visible": false`) and revealed by the frontend; a Rust fallback reveals it after 2.5 s. Never leave a code path that can keep the window hidden.

## Review Focus

- Cmd+B while the caret is in a Monaco editor inside the right panel: Go to Definition must run, the sidebar must not toggle; outside the editor in agent mode Cmd+B toggles the sidebar; in the editor-expanded workbench Cmd+B stays Go to Definition. Pinned in Task 3 (dispatcher collision test + `editorTextFocused` test).
- Keyboard user collapses the sidebar while focus is inside it (Collapse button, or Cmd+B from a thread row): focus lands on "Expand sidebar", never on `<body>`; expanding returns focus to "Collapse sidebar"; focus elsewhere (composer) is never stolen. Pinned in Task 6 (`useSidebarFocusHandoff` tests).
- Cold start in a light palette: no dark native frame before the first paint; if the frontend never reveals the window (script error, slow disk), the window still appears within 2.5 s. Pinned in Task 2 (`revealStartupWindow` order/failure tests, Rust `reveal_needed` tests, config tests).
- The attention indicator is hidden and nothing is running (idle): the user must still be able to turn it back on - the thread-activity group stays focusable and right-clickable (ContextMenu key / Shift+F10) even when empty. Pinned in Task 10.
- Maximized panel with a collapsed sidebar: the panel bar clears the traffic lights and offers "Expand sidebar"; maximizing keeps the conversation mounted (composer draft and scroll survive) and makes it inert. Pinned in Task 8.

---

## Current Shell Architecture (as mapped before this plan)

- `src/App.tsx` (1453 lines, tracked hotspot) is the composition root: `<main class="app-shell ...">` grid with rows `var(--window-chrome-height) minmax(0,1fr) 28px` (the 28px row is the status bar) and columns activity bar / sidebar / main in the editor workbench, a single column in agent mode. Children: `WindowChrome` (36px row; hidden with height 0 on macOS in agent mode, `.app-shell--agent-mode.app-shell--mac`), `WorkbenchNavigationChrome` (activity bar + file sidebar, editor mode only), `WorkbenchShellFrame`, then either `AgentStatusBarHost` (agent mode) or `StatusBar` (editor mode), then overlays.
- `src/components/WorkbenchShellFrame.tsx` + `workbenchShellFrame.css` own the frame grid: `.editor-workbench > .workbench-frame[data-layout][data-rail][data-right-panel][data-tree][data-editor]` with slots `agent` (AgentModeView: rail + center), `surface` (right panel host), `editor` (single Monaco host overlaid on the Files surface), `bottom`, `settings`. Placement comes from `workbenchShellPlacement.ts` + `src/domain/agentWorkbenchResponsiveLayout.ts` (overlay below the docking threshold, 1180px compact rail, 720px stacked).
- `src/domain/agentWorkbenchLayout.ts` is the frame state reducer: `layout: "agent" | "editor-expanded"`, `rightPanel: "open" | "closed"` (default closed), `openSurfaces`, `activeSurface`, `rightPanelMaximized`, `rail: "expanded" | "collapsed"`, `railWidth` (200..420, default 256), `rightPanelWidth` (360..1200, default 540), `bottomPanelHeight`. `src/application/useAgentWorkbenchLayout.ts` persists it per workspace owner key (A -> B -> A is already tested), so "remembers width per workspace" already holds.
- `src/components/agentMode/AgentModeView.tsx` (1190 lines) renders `.agent-mode__grid` (rail track + center), the rail (`AgentThreadsSidebar` with its own `.agent-rail__chrome` 44px row and Collapse button, or a 48px collapsed chrome with an Expand button), `AgentRailResizeHandle`, the center (`AgentThreadHeader` + session + composer) and, as a sibling, `AgentSurfaceHost` -> `AgentSurfacePanel` (resize separator, 40px header with tabs + `AgentPanelLayoutControls`).
- `AgentThreadHeader.tsx` is the current top bar (48px x scale, crumbs project / title, split buttons Run / Open / Commit, terminal sessions, panel toggles only while the panel is closed).
- Status bars: agent mode `AgentStatusBarHost` -> `AgentStatusBar` (+ `AgentStatusBarMenu`, `agentStatusBar.css`); editor mode `StatusBar.tsx` with 12 items and a visibility context menu (`workspaceSettings.statusBar`).
- Window: `tauri.conf.json` + `tauri.macos.conf.json` (`titleBarStyle: Overlay`, `hiddenTitle`, `trafficLightPosition {x:14,y:20}`, `backgroundColor #151616`), visible immediately -> dark flash before a light palette paints. Startup skeleton (`index.html`, `public/startup.css`) still paints a 28px status row.
- Keybindings: `panel.toggle` Cmd+J (bottom/terminal panel), `agent.toggleRightPanel` Cmd+Alt+R, `editor.goToDefinition` Cmd+B, `editor.goToImplementation` Cmd+Alt+B. The Collapse sidebar button already advertises "(⌘B)" but no command is bound.
- The editor-expanded layout is reachable only when the agent layout is unavailable (no `agentRootLeaseGateway`) or through the perf bridge; `useAgentWorkbenchLayout` forces hydration back to `"agent"`.
- Hotspots today (`npm run size:hotspots`): `src/App.tsx` 7188 tokens tracked; `AgentModeView.tsx` 6762, `AgentThreadsSidebar.tsx` 3770, `AgentWorkbenchScreen.tsx` 3644 tokens (untracked, under 10000).

## Status Bar Inventory and New Homes

| # | Former item (source) | Visibility key | New home after P2 |
|---|---|---|---|
| A1 | "N/M threads running" / "Threads idle · up to M" (agent bar) | - | Sidebar footer thread activity: "N running" with tooltip "N of M thread slots in use" (shown only while N > 0); collapsed sidebar: appended to the "Expand sidebar" tooltip; the limit M lives in Settings > Agents > Max concurrent tasks (existing row `agents.maxConcurrentTasks`). |
| A2 | "N need attention" + explanation tooltip (agent bar) | `agentAttention` | Sidebar footer thread activity (warn tone, explanation tooltip) and the "Expand sidebar" tooltip when collapsed. |
| A3 | Right-click menu "Thread status" visibility toggle (agent bar) | `agentAttention` | Context menu (right-click, ContextMenu key, Shift+F10) on the always-present thread-activity group in the sidebar footer. A Settings row is a P9 follow-up. |
| A4 | Last-used launch label "model · access · effort" (agent bar) | - | Composer launch controls (`AgentLaunchControls`: model, access, effort pickers) - already shows the same launch for the next turn; no new UI. |
| A5 | CLI version "claude 2.1.x" (agent bar) | - | Sidebar footer settings button tooltip (`providerSettingsTitle`: "Settings > Agents · Claude Code v2.1.x") and Settings > Providers card version (existing). |
| A6 | Workspace name (agent bar) | - | Main top bar breadcrumb project label (with project favicon) and the sidebar project rows. |
| E1 | Problems counts, click -> Problems (editor bar) | - | Editor-mode toolbar status group (`.workbench-toolbar .editor-status`); command "Show Problems" (existing `panel.showProblems`). P7 moves it into the editor sub-header. |
| E2 | Git branch (+ nested repo label), click -> branches (editor bar) | `gitBranch` | Editor-mode toolbar status group. Agent mode: composer branch drawer (existing, P9/F8 redesigns it). |
| E3 | Active file path | `activePath` | Editor-mode toolbar status group. |
| E4 | Workspace info (package · PHP / TS version) | `workspaceInfo` | Editor-mode toolbar status group. |
| E5 | IDE activity (index/LSP) with runtime detail tooltip, click -> Runtime panel | `index`, `languageServer` | Editor-mode toolbar status group (tooltip unchanged). |
| E6 | Node "run without debugging" status + Stop | - | Editor-mode toolbar status group (`NodeRunStatusAction`). |
| E7 | Workspace trust label | `workspaceTrust` | Editor-mode toolbar status group; the toolbar also keeps its Trust button. |
| E8 | Intelligence mode | `mode` | Editor-mode toolbar status group (next to the existing IDE Mode switch). |
| E9 | Large file mode | `largeFileMode` | Editor-mode toolbar status group. |
| E10 | Cursor position, click -> Go to Line | `cursorPosition` | Editor-mode toolbar status group; P7 moves it to the editor sub-header (`.esub .pos`). |
| E11 | Language | `language` | Editor-mode toolbar status group. |
| E12 | Unsaved files count | `dirtyCount` | Editor-mode toolbar status group. |
| E13 | Transient messages (5 s) | `message` | Editor-mode toolbar status group (same 5 s auto-hide). Agent mode never showed them; unchanged. |
| E14 | Visibility context menu for E2-E13 | all editor keys | Right-click on the editor-mode toolbar status group (same menu). |
| U1 | App / CLI update notices | - | Not in the status bar today: `AppUpdateToast`, `AgentProviderUpdateToast(s)` and the provider pills in the sidebar footer - unchanged. |

Task 11 ships `src/components/statusBarRelocation.test.tsx`, which fails if a `StatusBarItemVisibility` key or an agent item lacks a home, renders the new homes, and asserts no status bar row remains.

## Key Decisions

1. **One top bar primitive.** `TopBar` (`region: "sidebar" | "main" | "panel"`, slots `leading`, title children, hover-revealed `actions`, `trailing`, `windowEdge`) replaces `.agent-rail__chrome`, `.agent-thread-head` layout and `.agent-surface__head` layout. Traffic-light clearance is pure CSS: `padding-left: max(pad, var(--cv-shell-window-inset) - var(--cv-shell-sidebar-track))`.
2. **Traffic lights** move to `{x: 20, y: 20}` (mockup `.topbar` 20px inset); `--cv-traffic-light-inset: 84px` (20 + 52 cluster + 12 gap), shared by the agent bars and the editor-mode `WindowChrome` spacer.
3. **Collapsed sidebar = 0px track** (mockup `v3-sidebar-agents` "collapsed"): the 48px collapsed chrome is removed; the main top bar shows [Expand sidebar, New thread, separator] after the traffic lights. In maximized mode the same cluster appears in the panel bar.
4. **Keyboard:** new `agent.toggleSidebar` = Cmd+B, an intentional, focus-scoped collision with `editor.goToDefinition` (disabled while focus is in `.monaco-editor`). Right panel stays Cmd+Alt+R and the bottom panel Cmd+J (VS Code's Cmd+Alt+B is Go to Implementation here; no rebinding). No maximize shortcut in P2 (P5 palette command).
5. **Right panel frame:** default closed (existing), width persisted per workspace (existing), keyboard-resizable separator (new), header = `TopBar region="panel"` with tabs (P6 content) + `AgentPanelWindowControls` (Maximize/Restore + Close). Main top bar always shows the terminal and right-panel toggles with `aria-pressed`. Maximized: conversation column collapses to width 0, `visibility: hidden`, `inert`, but stays mounted (P7 agreement).
6. **Surfaces:** sidebar `--cv-side`, conversation and panel `--cv-canvas` (mockup), panel edges via new box-shadow tokens `--cv-edge-{start,end,top,bottom}-divider` over `--cv-divider` (>= 3:1 against both adjacent surfaces).
7. **Tint contrast:** dark `--cv-tint-3` 0.09 -> 0.07 (the only change needed: at 0.07 every neutral text token stays >= 4.57:1 on every tint over every surface in all 12 combinations, and status text on sidebar row hover/active >= 5.19:1). Light tints unchanged (neutral text passes; light row hover/active are solid `canvas`/`raised`).
8. **Divider strength:** `--cv-divider` dark `rgba(255, 255, 255, 0.38)`, light `rgba(20, 24, 30, 0.52)` (minimum alphas measured for >= 3:1 against s0/s1/s2 in all palettes are 0.37 / 0.51). This is visibly stronger than the mockup hairline (1.13-1.21:1) - see Open Question 1.
9. **Native window flash:** window created hidden; `main.tsx` sets window + webview background to the resolved `side` tone, then `show()`; runtime appearance changes keep the native background in sync; Rust reveals after 2.5 s if still hidden.
10. **Status bar:** agent status bar deleted; editor `StatusBar` component survives as an in-toolbar group for the editor-expanded workbench only (minimal P7 bridge); the `.app-shell` 28px row and the startup skeleton status row are removed.
11. **Editor mode (editor-expanded):** keeps its activity bar, file sidebar, project tabs and 36px `WindowChrome`; only the status row moves into its toolbar and the macOS spacer follows the new 84px inset. P7 follow-ups listed below.

## P7 Follow-ups (editor mode)

1. Move cursor position and diagnostics counts from the editor-mode toolbar status group into the editor sub-header (`.esub`) and remove them from `StatusBar` (update `statusBarRelocation.test.tsx`).
2. Decide whether the editor-expanded workbench survives the redesign (today reachable only without an agent root lease gateway or through the perf bridge); if it does, restyle its activity bar, project tabs, legacy sidebar and 36px chrome to the shell tokens.
3. Rename the persisted `workspaceSettings.statusBar` visibility map (with migration) once no status bar concept remains (P7 or P9).
4. P9: a Settings row for the thread-attention indicator; P5: palette commands "Toggle Maximized Panel" and entries for the relocated editor status actions.

## Ownership Agreements with Parallel Phase Plans

- P3 (conversation/composer): P2 deletes only the shell-owned header rule blocks from `agentThread.css` (`.agent-thread-head*`, `.agent-crumbs*`, `.agent-layout-controls`, `.agent-icon-toggle*`) and edits only the header `it` block of `agentThreadStyles.test.ts`. P3 owns replacing `max-width: 768px` literals in its sheets with `var(--cv-column)`. P2 keeps `.agent-mode__center` a flex column whose direct children are, in order, the header TopBar, `AgentThreadSession`, plain notice siblings, `AgentThreadQuestions`, `AgentComposerController`; P3 later replaces the questions + controller pair with `AgentComposerController interactions={...}`.
- P4 (sidebar): P2 changes `AgentThreadsSidebar.tsx` only at its chrome row (-> `TopBar region="sidebar"`, prop `collapseShortcut`) and adds a pass-through `footerActivity` prop (-> `AgentProviderRailFooter` prop `activity`). In `agentRail.css` P2 rewrites `.agent-rail` and `.agent-rail-resize*` and deletes `.agent-rail__chrome*`. P2 adds `trailingExtras?: ReactNode` to `AgentThreadHeader` for P4's "Toggle agents panel" button; the agents panel itself should become a right-panel surface kind agreed with P6.
- P6 (right panel): P2 wraps the `AgentSurfacePanel` header in `TopBar region="panel"` (tabs remain P6 content), adds `leadingControls` and `onResizeWidth` props and keyboard resizing, rewrites `.agent-surface` / `.agent-surface__resize*` and deletes `.agent-surface__head` layout + `.agent-surface__layout-controls*` rules.
- P7 (editor): frame state stays `AgentWorkbenchLayout` (`rightPanel`, `rightPanelWidth`, `rightPanelMaximized`; actions `toggleMaximized`, `maximizeRightPanel`, `toggleRightPanel`, `resizeRightPanel`); the maximize button is P2's `AgentPanelWindowControls` in the panel bar; after P2, P7 owns `StatusBar.tsx` and the `.editor-status` rules.
- P8 (projects): P2 does not move the dialog block or the center-column ternary in `AgentModeView.tsx`; P2 lowers the `App.tsx` hotspot baseline, so P8 mounts its trust dialog host inside `WorkbenchOverlayHosts.tsx`, not in `App.tsx`.
- P9 (settings): settings slot API unchanged (`surface="settings"`, `settingsRef`); P9 reuses `TopBar` (`region="sidebar"` for its nav column, `region="main"` without `windowEdge`).
- P5 (palette): P2 adds `agent.toggleSidebar` (Cmd+B) to `keymap.ts` after `agent.toggleRightPanel`; `AgentPanelLayoutShortcuts` gains `sidebar` and `newThread`.
- Reserved hunks for later phases (P2 must leave these anchors in place): P3 replaces the `AgentThreadQuestions` + `AgentComposerController` sibling pair in `AgentModeView.tsx` with `AgentComposerController interactions={...}`; P4 (a) edits the `<AgentThreadsSidebar>` prop list (keeping `collapseShortcut` and `footerActivity`), (b) mounts an error banner between the header and the session, (c) adds `agentsPanel` to `<AgentSurfaceHost>`, (d) wraps the view in its agents-panel provider and passes `trailingExtras` to `<AgentThreadHeader>`, (e) adds one `useAgentPendingInteractions(...)` hook line next to the other hooks plus an `awaiting={...}` prop on P3's `<AgentThreadSession>` (hunk (a) also carries `pendingInteractions` on `<AgentThreadsSidebar>`); P5 adds one `useAgentCommandPaletteProvider(...)` call right after `useAgentViewCommands(viewCommands, commandHandlers);` and appends `panel.toggleMaximized` after P2's `agent.toggleSidebar` in `workbenchAgentCommands.ts`, and replaces the command palette / Quick Open mounts in `App.tsx` (P2 does not move them); P6 replaces `AgentCommitMenu` (first element of the header `trailing` slot) with a Commit button opening the Git surface and deletes `AgentScriptRunControl` (first element of the `actions` slot), adds `toggleSurface`/`isSurfaceOpen` to `useAgentSurfaceLayout.ts` next to P2's `resizeRightPanel`, and owns every `agentSurface.css` rule P2 does not rewrite. P2 does not edit `src/domain/agentWorkbenchLayout.ts`.

## File Structure

Created:

| Path | Responsibility |
|---|---|
| `src/domain/appearanceShellStates.ts` | Typed tint/divider values per scheme, macOS traffic-light geometry, `compositeOver`. |
| `src/ui/tokens/shellStateContrast.test.ts` | AA gate for text on tints/row states, 3:1 gate for dividers, CSS sync with the typed values. |
| `src/domain/nativeWindowBackground.ts` | `nativeWindowBackground(appearance)` -> the resolved `side` hex. |
| `src/application/nativeWindowPort.ts` | `NativeWindowPort` (setBackgroundColor, show). |
| `src/infrastructure/tauriNativeWindow.ts` | Tauri adapter for `NativeWindowPort` (null outside Tauri). |
| `src/startupWindowReveal.ts` | Pre-React reveal: background first, then show; failures never throw. |
| `src/components/useNativeWindowBackground.ts` | Keeps the native background in sync with runtime appearance changes. |
| `src-tauri/src/startup_window_reveal.rs` | Rust fallback reveal after 2.5 s (+ unit tests). |
| `src/components/agentMode/editorTextFocus.ts` | `editorTextFocused(document)` for the Cmd+B focus scope. |
| `src/ui/shell/TopBar.tsx`, `src/ui/shell/ProjectFavicon.tsx`, `src/ui/shell/shell.css` | Shell top bar primitive, separator, project favicon, crumb styles. |
| `src/ui/shell/TopBar.test.tsx`, `src/ui/shell/shellStyles.test.ts` | Component and style-contract tests. |
| `src/components/agentMode/AgentSidebarReveal.tsx` (+ test) | Expand sidebar / New thread / separator cluster for a collapsed sidebar. |
| `src/components/agentMode/useSidebarFocusHandoff.ts` (+ test) | Moves focus between Collapse and Expand when the rail state changes and focus was lost. |
| `src/components/agentMode/agentSurfaceResize.ts` (+ test) | `panelWidthForKey` keyboard policy for the right panel separator. |
| `src/components/agentMode/agentThreadActivityPresentation.ts` (+ test) | Running/attention summary, labels, tooltip detail. |
| `src/components/agentMode/AgentThreadActivity.tsx`, `AgentThreadActivityMenu.tsx` (+ test) | Sidebar-footer thread activity with its visibility menu (replaces the agent status bar). |
| `src/components/agentMode/agentShellFrame.test.ts` | Contract test for the agent frame surfaces and center column. |
| `src/components/useEditorStatusPresentation.ts` (+ test) | Status-only presentation extracted from `App.tsx`. |
| `src/components/statusBarRelocation.test.tsx` | Status bar removal inventory test. |

Modified: `src/ui/tokens/semantic.css`, `src/ui/tokens/tokenCss.test.ts`, `src/components/cssContractTestSupport.ts`, `src/domain/startupTheme.ts`, `src/startupTheme.ts`, `src/startupTheme.test.ts`, `src/main.tsx`, `src/workbenchComposition.ts`, `src/components/useAppWorkbenchThemes.ts`, `src/App.tsx`, `src/App.css`, `src/App.commandRouting.test.tsx`, `index.html`, `public/startup.css`, `src/startupDocument.test.ts`, `src-tauri/tauri.conf.json`, `src-tauri/tauri.macos.conf.json`, `src-tauri/capabilities/default.json`, `src-tauri/src/lib_composition/command_facades.rs`, `src-tauri/src/lib_composition/runtime.rs`, `src/domain/keymap.ts`, `src/domain/keymap.test.ts`, `src/application/agentViewCommandBridge.ts`, `src/application/workbenchAgentCommands.ts` (+ test), `src/application/workbenchShortcutCommandDispatcher.ts` (+ test), `src/components/agentMode/useAgentViewCommands.ts`, `src/components/agentMode/agentThreadHeaderPresentation.ts`, `src/components/agentMode/AgentWorkbenchScreen.tsx`, `src/components/agentMode/agentWorkbenchChrome.ts`, `src/domain/agentWorkbenchResponsiveLayout.ts` (+ test), `src/components/workbenchShellFrame.css`, `src/components/workbenchShellFrame.expanded.test.ts`, `src/components/agentMode/agentMode.css`, `src/components/agentMode/agentModeResponsiveStyles.test.ts`, `src/components/agentMode/AgentThreadsSidebar.tsx` (+ test), `src/components/agentMode/AgentProviderRailFooter.tsx`, `src/components/agentMode/agentRail.css`, `src/components/agentMode/AgentModeView.tsx` (+ test), `src/components/agentMode/AgentThreadHeader.tsx` (+ test), `src/components/agentMode/AgentPanelLayoutControls.tsx` (+ test), `src/components/agentMode/agentThread.css`, `src/components/agentMode/agentThreadStyles.test.ts`, `src/components/agentMode/AgentSurfacePanel.tsx`, `src/components/agentMode/AgentSurfaceHost.tsx`, `src/components/agentMode/useAgentSurfaceLayout.ts`, `src/components/agentMode/agentSurface.css`, `src/components/agentMode/agentModeTokens.css`, `src/components/agentMode/agentModeTokens.test.ts`, `src/components/agentMode/agentModeCssTestSupport.ts`, `src/components/agentMode/agentAttentionPresentation.ts`, `src/components/windowChromeStyles.test.ts`, `src/components/StatusBar.tsx` (+ test), `src/components/WorkbenchToolbar.tsx` (+ test), `scripts/hotspot-size-baseline.json` (lowered only).

Deleted: `src/components/agentMode/AgentStatusBar.tsx`, `AgentStatusBar.test.tsx`, `AgentStatusBarHost.tsx`, `AgentStatusBarHost.test.tsx`, `AgentStatusBarMenu.tsx` (moved to `AgentThreadActivityMenu.tsx`), `agentStatusBar.css`.

## Execution Order and Ownership

- Stream A: Task 1 -> Task 2 (Task 2 reads `MAC_TRAFFIC_LIGHTS` from Task 1). Task 3 and Task 4 run in parallel with Stream A (disjoint files).
- Task 5 after Tasks 1 and 2 (both touch `App.css`, different rules; run sequentially).
- Stream B (strictly sequential, shared `AgentModeView.tsx` and agent CSS): Task 6 (needs 3, 4, 5) -> Task 7 -> Task 8 -> Task 9 -> Task 10 -> Task 11.
- Wrap-up (lead): Task 12 gates -> Task 13 independent review -> Task 14 QA build and Codex QA -> Task 15 commit.
- Every implementer reports changed files and the exact focused test output; the lead reruns the focused tests before dispatching a dependent task. No plan dry run was performed for P2: implementers must run every named suite and adapt only the listed legacy contract assertions.

---
### Task 1: Shell state tokens and contrast gate (P1 carry-overs: tint contrast, panel dividers)

**Files:**
- Create: `src/domain/appearanceShellStates.ts`
- Create: `src/ui/tokens/shellStateContrast.test.ts`
- Modify: `src/ui/tokens/semantic.css`
- Modify: `src/components/cssContractTestSupport.ts` (`SHADOW_TOKEN_ROOTS`)
- Modify: `src/ui/tokens/tokenCss.test.ts` (root count 15 -> 19)

**Interfaces:**
- Consumes: `PALETTE_IDS`, `RESOLVED_COLOR_SCHEMES`, `ResolvedColorScheme` (`src/domain/appearance.ts`); `paletteTokens`, `surfaceColor`, `PaletteTokenName`, `SurfaceRole` (`src/domain/appearancePalettes.ts`); `contrastRatio` (`src/domain/themeContrast.ts`).
- Produces:
  - `interface SchemeShellStates { tint1; tint2; tint3; divider }` (CSS colour strings), `SCHEME_SHELL_STATES: Record<ResolvedColorScheme, SchemeShellStates>`, `type ShellTintName = "tint1" | "tint2" | "tint3"`, `SHELL_TINT_NAMES`.
  - `MAC_TRAFFIC_LIGHTS = { x: 20, y: 20, clusterWidth: 52, trailingGap: 12 }`, `macTrafficLightInset(): number` (= 84).
  - `compositeOver(overlay: string, backdrop: string): string` (six-digit lowercase hex).
  - CSS tokens: `--cv-divider` (per scheme), `--cv-edge-start-divider`, `--cv-edge-end-divider`, `--cv-edge-top-divider`, `--cv-edge-bottom-divider`, `--cv-traffic-light-inset: 84px`; dark `--cv-tint-3` becomes `rgba(255, 255, 255, 0.07)`.

- [ ] **Step 1: Write the failing test**

Create `src/ui/tokens/shellStateContrast.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  PALETTE_IDS,
  RESOLVED_COLOR_SCHEMES,
  type PaletteId,
  type ResolvedColorScheme,
} from "../../domain/appearance";
import {
  paletteTokens,
  surfaceColor,
  type PaletteTokenName,
  type SurfaceRole,
} from "../../domain/appearancePalettes";
import {
  MAC_TRAFFIC_LIGHTS,
  SCHEME_SHELL_STATES,
  SHELL_TINT_NAMES,
  compositeOver,
  macTrafficLightInset,
} from "../../domain/appearanceShellStates";
import { contrastRatio } from "../../domain/themeContrast";
import {
  buildTokenTable,
  lastOf,
  parseAllStyleSheets,
  selectorParts,
  type CssRule,
} from "../../components/cssContractTestSupport";

const AA_TEXT = 4.5;
const NON_TEXT = 3;
const NEUTRAL_TEXT: readonly PaletteTokenName[] = ["fgStrong", "fg", "fgMuted", "fgSubtle"];
const STATUS_TEXT: readonly PaletteTokenName[] = ["accent", "ok", "danger", "warn"];
const TINTED_ROLES: readonly SurfaceRole[] = ["canvas", "side", "raised", "popover"];
const PANEL_ROLES: readonly SurfaceRole[] = ["canvas", "side", "raised"];
const SEMANTIC_SHEET = "ui/tokens/semantic.css";
const parsed = parseAllStyleSheets();

interface Backdrop {
  readonly label: string;
  readonly color: string;
}

function combinations(): ReadonlyArray<readonly [PaletteId, ResolvedColorScheme]> {
  return PALETTE_IDS.flatMap((palette) =>
    RESOLVED_COLOR_SCHEMES.map((scheme) => [palette, scheme] as const),
  );
}

function tintedBackdrops(palette: PaletteId, scheme: ResolvedColorScheme): readonly Backdrop[] {
  return TINTED_ROLES.flatMap((role) =>
    SHELL_TINT_NAMES.map((tint) => ({
      label: `${tint} over ${role}`,
      color: compositeOver(SCHEME_SHELL_STATES[scheme][tint], surfaceColor(palette, scheme, role)),
    })),
  );
}

function rowBackdrops(palette: PaletteId, scheme: ResolvedColorScheme): readonly Backdrop[] {
  if (scheme === "light") {
    return [
      { label: "row hover (canvas)", color: surfaceColor(palette, scheme, "canvas") },
      { label: "row active (raised)", color: surfaceColor(palette, scheme, "raised") },
    ];
  }
  return (["side", "canvas"] as const).flatMap((role) =>
    (["tint2", "tint3"] as const).map((tint) => ({
      label: `${tint} over ${role}`,
      color: compositeOver(SCHEME_SHELL_STATES.dark[tint], surfaceColor(palette, scheme, role)),
    })),
  );
}

function failures(
  foregrounds: readonly PaletteTokenName[],
  backdrops: (palette: PaletteId, scheme: ResolvedColorScheme) => readonly Backdrop[],
  minimum: number,
): readonly string[] {
  return combinations().flatMap(([palette, scheme]) => {
    const tokens = paletteTokens(palette, scheme);
    return backdrops(palette, scheme).flatMap((backdrop) =>
      foregrounds
        .map((name) => ({ name, ratio: contrastRatio(tokens[name], backdrop.color) }))
        .filter((entry) => entry.ratio < minimum)
        .map(
          (entry) =>
            `${palette} ${scheme}: ${entry.name} on ${backdrop.label} = ${entry.ratio.toFixed(2)}`,
        ),
    );
  });
}

function schemeRules(scheme: ResolvedColorScheme): readonly CssRule[] {
  return parsed.rules.filter(
    (rule) =>
      rule.sheet === SEMANTIC_SHEET &&
      rule.context.length === 0 &&
      selectorParts(rule.selector).includes(`:root[data-cv-scheme="${scheme}"]`),
  );
}

function rootRules(): readonly CssRule[] {
  return parsed.rules.filter(
    (rule) =>
      rule.sheet === SEMANTIC_SHEET &&
      rule.context.length === 0 &&
      selectorParts(rule.selector).length === 1 &&
      selectorParts(rule.selector)[0] === ":root",
  );
}

function declared(rules: readonly CssRule[], name: string): string | undefined {
  return lastOf(buildTokenTable(rules, "--cv-").get(name));
}

describe("shell state contrast gate", () => {
  it("keeps neutral text at AA on every hover and active tint over every surface", () => {
    expect(failures(NEUTRAL_TEXT, tintedBackdrops, AA_TEXT)).toEqual([]);
  });

  it("keeps status and neutral text at AA on sidebar row hover and active states", () => {
    expect(failures([...NEUTRAL_TEXT, ...STATUS_TEXT], rowBackdrops, AA_TEXT)).toEqual([]);
  });

  it("keeps panel dividers at 3:1 against both sides of every panel edge", () => {
    const weak = combinations().flatMap(([palette, scheme]) =>
      PANEL_ROLES.flatMap((drawnOn) =>
        PANEL_ROLES.map((neighbour) => ({
          label: `${palette} ${scheme}: divider on ${drawnOn} vs ${neighbour}`,
          ratio: contrastRatio(
            compositeOver(SCHEME_SHELL_STATES[scheme].divider, surfaceColor(palette, scheme, drawnOn)),
            surfaceColor(palette, scheme, neighbour),
          ),
        })),
      ),
    )
      .filter((entry) => entry.ratio < NON_TEXT)
      .map((entry) => `${entry.label} = ${entry.ratio.toFixed(2)}`);

    expect(weak).toEqual([]);
  });

  it("fails on the previous tint and the mockup hairline so the gate is not vacuous", () => {
    const previousTint = compositeOver(
      "rgba(255, 255, 255, 0.09)",
      surfaceColor("ink-mint", "dark", "popover"),
    );
    expect(contrastRatio(paletteTokens("ink-mint", "dark").fgSubtle, previousTint)).toBeLessThan(
      AA_TEXT,
    );
    const hairline = compositeOver(
      paletteTokens("graphite-teal", "light").hair,
      surfaceColor("graphite-teal", "light", "canvas"),
    );
    expect(
      contrastRatio(hairline, surfaceColor("graphite-teal", "light", "canvas")),
    ).toBeLessThan(NON_TEXT);
  });

  it("composites translucent colours over a backdrop and passes solid colours through", () => {
    expect(compositeOver("rgba(255, 255, 255, 0.5)", "#000000")).toBe("#808080");
    expect(compositeOver("rgba(0, 0, 0, 0)", "#123456")).toBe("#123456");
    expect(compositeOver("#ABCDEF", "#000000")).toBe("#ABCDEF");
  });

  it("declares the typed tint and divider values in semantic.css", () => {
    for (const scheme of RESOLVED_COLOR_SCHEMES) {
      const rules = schemeRules(scheme);
      const states = SCHEME_SHELL_STATES[scheme];
      expect(declared(rules, "--cv-tint-1"), scheme).toBe(states.tint1);
      expect(declared(rules, "--cv-tint-2"), scheme).toBe(states.tint2);
      expect(declared(rules, "--cv-tint-3"), scheme).toBe(states.tint3);
      expect(declared(rules, "--cv-divider"), scheme).toBe(states.divider);
    }
  });

  it("declares the divider edges and the traffic-light inset on the root", () => {
    const rules = rootRules();
    expect(declared(rules, "--cv-edge-start-divider")).toBe("inset 1px 0 0 var(--cv-divider)");
    expect(declared(rules, "--cv-edge-end-divider")).toBe("inset -1px 0 0 var(--cv-divider)");
    expect(declared(rules, "--cv-edge-top-divider")).toBe("inset 0 1px 0 var(--cv-divider)");
    expect(declared(rules, "--cv-edge-bottom-divider")).toBe("inset 0 -1px 0 var(--cv-divider)");
    expect(macTrafficLightInset()).toBe(
      MAC_TRAFFIC_LIGHTS.x + MAC_TRAFFIC_LIGHTS.clusterWidth + MAC_TRAFFIC_LIGHTS.trailingGap,
    );
    expect(declared(rules, "--cv-traffic-light-inset")).toBe(`${macTrafficLightInset()}px`);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/ui/tokens/shellStateContrast.test.ts`
Expected: FAIL - `Failed to resolve import "../../domain/appearanceShellStates"`.

- [ ] **Step 3: Implement the domain module**

Create `src/domain/appearanceShellStates.ts`:

```ts
import type { ResolvedColorScheme } from "./appearance";

export interface SchemeShellStates {
  readonly tint1: string;
  readonly tint2: string;
  readonly tint3: string;
  readonly divider: string;
}

export type ShellTintName = "tint1" | "tint2" | "tint3";

export const SHELL_TINT_NAMES: readonly ShellTintName[] = ["tint1", "tint2", "tint3"];

export const SCHEME_SHELL_STATES: Readonly<Record<ResolvedColorScheme, SchemeShellStates>> = {
  dark: {
    tint1: "rgba(255, 255, 255, 0.03)",
    tint2: "rgba(255, 255, 255, 0.05)",
    tint3: "rgba(255, 255, 255, 0.07)",
    divider: "rgba(255, 255, 255, 0.38)",
  },
  light: {
    tint1: "rgba(20, 24, 30, 0.035)",
    tint2: "rgba(20, 24, 30, 0.055)",
    tint3: "rgba(20, 24, 30, 0.09)",
    divider: "rgba(20, 24, 30, 0.52)",
  },
};

export const MAC_TRAFFIC_LIGHTS = {
  x: 20,
  y: 20,
  clusterWidth: 52,
  trailingGap: 12,
} as const;

export function macTrafficLightInset(): number {
  return MAC_TRAFFIC_LIGHTS.x + MAC_TRAFFIC_LIGHTS.clusterWidth + MAC_TRAFFIC_LIGHTS.trailingGap;
}

const HEX6 = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;
const RGBA = /^rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(0|1|0?\.\d+)\s*\)$/i;

export function compositeOver(overlay: string, backdrop: string): string {
  const trimmed = overlay.trim();
  if (HEX6.test(trimmed)) return trimmed;
  const match = RGBA.exec(trimmed);
  if (match === null) throw new TypeError(`Unsupported overlay colour: ${overlay}`);
  const alpha = Number(match[4]);
  const below = hexChannels(backdrop);
  const above = [match[1], match[2], match[3]].map((channel) => Number(channel));
  const mixed = above.map((channel, index) =>
    Math.round(channel * alpha + (below[index] ?? 0) * (1 - alpha)),
  );
  return `#${mixed.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function hexChannels(value: string): readonly number[] {
  const match = HEX6.exec(value.trim());
  if (match === null) throw new TypeError(`Expected a six-digit hex backdrop, received ${value}`);
  return [match[1], match[2], match[3]].map((channel) => Number.parseInt(channel ?? "0", 16));
}
```

- [ ] **Step 4: Update the stylesheet**

In `src/ui/tokens/semantic.css`:

1. In the first `:root {` block, after `--cv-switch-knob: #ffffff;`, add:

```css
  --cv-traffic-light-inset: 84px;
  --cv-edge-start-divider: inset 1px 0 0 var(--cv-divider);
  --cv-edge-end-divider: inset -1px 0 0 var(--cv-divider);
  --cv-edge-top-divider: inset 0 1px 0 var(--cv-divider);
  --cv-edge-bottom-divider: inset 0 -1px 0 var(--cv-divider);
```

2. In the `:root,\n:root[data-cv-scheme="dark"] {` block replace `--cv-tint-3: rgba(255, 255, 255, 0.09);` with `--cv-tint-3: rgba(255, 255, 255, 0.07);` and add after `--cv-tint-3`: `  --cv-divider: rgba(255, 255, 255, 0.38);`
3. In the `:root[data-cv-scheme="light"] {` block add after `--cv-tint-3: rgba(20, 24, 30, 0.09);`: `  --cv-divider: rgba(20, 24, 30, 0.52);`

- [ ] **Step 5: Register the divider edges with the border contract**

In `src/components/cssContractTestSupport.ts`, extend `SHADOW_TOKEN_ROOTS` right after `"--cv-edge-bottom-hair",`:

```ts
  "--cv-edge-start-divider",
  "--cv-edge-end-divider",
  "--cv-edge-top-divider",
  "--cv-edge-bottom-divider",
```

In `src/ui/tokens/tokenCss.test.ts`, in "declares every foundation shadow root the border contract allows", change `expect(roots).toHaveLength(15);` to `expect(roots).toHaveLength(19);`.

- [ ] **Step 6: Run the focused tests**

Run: `npx vitest run src/ui/tokens src/ui/foundation src/domain/themeContrast.test.ts`
Expected: PASS (all). If a foundation test pinned the old dark `tint-3` value, it is wrong to keep; update it to `rgba(255, 255, 255, 0.07)`.

- [ ] **Step 7: Format the new files**

Run: `npx prettier --write src/domain/appearanceShellStates.ts src/ui/tokens/shellStateContrast.test.ts && npm run format:check:changed`
Expected: exit 0 (prettier-write only a modified file the checker lists).

---

### Task 2: Native window - hidden until revealed, runtime background sync, traffic-light position

**Files:**
- Create: `src/domain/nativeWindowBackground.ts`, `src/domain/nativeWindowBackground.test.ts`
- Create: `src/application/nativeWindowPort.ts`
- Create: `src/infrastructure/tauriNativeWindow.ts`
- Create: `src/startupWindowReveal.ts`, `src/startupWindowReveal.test.ts`
- Create: `src/components/useNativeWindowBackground.ts`, `src/components/useNativeWindowBackground.test.tsx`
- Create: `src-tauri/src/startup_window_reveal.rs`
- Modify: `src/startupTheme.ts`, `src/startupTheme.test.ts`, `src/main.tsx`, `src/workbenchComposition.ts`, `src/components/useAppWorkbenchThemes.ts`, `src/App.tsx` (two lines), `src/App.css` (macOS spacer rules), `src/components/windowChromeStyles.test.ts`, `src/startupDocument.test.ts` ("native window background" block), `src-tauri/tauri.conf.json`, `src-tauri/tauri.macos.conf.json`, `src-tauri/capabilities/default.json`, `src-tauri/src/lib_composition/command_facades.rs`, `src-tauri/src/lib_composition/runtime.rs`

**Interfaces:**
- Consumes: `DocumentAppearance` (`src/domain/startupTheme.ts`), `surfaceColor` (`appearancePalettes.ts`), `MAC_TRAFFIC_LIGHTS`, `macTrafficLightInset` (Task 1), `DEFAULT_APPEARANCE` (`appearance.ts`).
- Produces:
  - `nativeWindowBackground(appearance: DocumentAppearance): string`
  - `interface NativeWindowPort { setBackgroundColor(color: string): Promise<void>; show(): Promise<void> }`
  - `createTauriNativeWindow(): NativeWindowPort | null`
  - `revealStartupWindow(port: NativeWindowPort | null, appearance: DocumentAppearance): Promise<void>`
  - `useNativeWindowBackground(port: NativeWindowPort | null, palette: PaletteId, colorScheme: ResolvedColorScheme): void`
  - `applyStartupTheme(environment): DocumentAppearance`, `applyBrowserStartupTheme(): DocumentAppearance`, `FALLBACK_STARTUP_APPEARANCE`
  - `useAppWorkbenchThemes(appearance, prefersLightTheme, nativeWindow?: NativeWindowPort | null)`
  - `workbenchComposition.nativeWindow: NativeWindowPort | null`
  - Rust: `startup_window_reveal::schedule_startup_reveal_fallback(app: &AppHandle<R>)`, `reveal_needed(visible: tauri::Result<bool>) -> bool`, `STARTUP_REVEAL_FALLBACK: Duration` (2.5 s)

- [ ] **Step 1: Write the failing TypeScript tests**

Create `src/domain/nativeWindowBackground.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { PALETTE_IDS, RESOLVED_COLOR_SCHEMES } from "./appearance";
import { surfaceColor } from "./appearancePalettes";
import { nativeWindowBackground } from "./nativeWindowBackground";

describe("nativeWindowBackground", () => {
  it("paints the native window with the side tone of every palette and scheme", () => {
    for (const palette of PALETTE_IDS) {
      for (const colorScheme of RESOLVED_COLOR_SCHEMES) {
        expect(nativeWindowBackground({ palette, colorScheme }), `${palette} ${colorScheme}`).toBe(
          surfaceColor(palette, colorScheme, "side"),
        );
      }
    }
  });

  it("uses a light tone for a light palette so a cold start cannot flash dark", () => {
    expect(nativeWindowBackground({ palette: "graphite-teal", colorScheme: "light" })).toBe(
      "#EDEEEF",
    );
    expect(nativeWindowBackground({ palette: "graphite-teal", colorScheme: "dark" })).toBe(
      "#151616",
    );
  });
});
```

Create `src/startupWindowReveal.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { NativeWindowPort } from "./application/nativeWindowPort";
import { revealStartupWindow } from "./startupWindowReveal";

interface RecordingPort extends NativeWindowPort {
  readonly calls: string[];
}

function recordingPort(
  options: { readonly failBackground?: boolean; readonly failShow?: boolean } = {},
): RecordingPort {
  const calls: string[] = [];
  return {
    calls,
    setBackgroundColor(color) {
      calls.push(`background:${color}`);
      return options.failBackground === true
        ? Promise.reject(new Error("no permission"))
        : Promise.resolve();
    },
    show() {
      calls.push("show");
      return options.failShow === true ? Promise.reject(new Error("gone")) : Promise.resolve();
    },
  };
}

describe("revealStartupWindow", () => {
  it("paints the native background before it shows the window", async () => {
    const port = recordingPort();

    await revealStartupWindow(port, { palette: "ink-mint", colorScheme: "light" });

    expect(port.calls).toEqual(["background:#E9EEF6", "show"]);
  });

  it("still shows the window when the background cannot be set", async () => {
    const port = recordingPort({ failBackground: true });

    await revealStartupWindow(port, { palette: "graphite-teal", colorScheme: "dark" });

    expect(port.calls).toEqual(["background:#151616", "show"]);
  });

  it("settles without an error when show fails", async () => {
    const port = recordingPort({ failShow: true });

    await expect(
      revealStartupWindow(port, { palette: "graphite-teal", colorScheme: "dark" }),
    ).resolves.toBeUndefined();
  });

  it("does nothing outside the desktop shell", async () => {
    await expect(
      revealStartupWindow(null, { palette: "graphite-teal", colorScheme: "dark" }),
    ).resolves.toBeUndefined();
  });
});
```

Create `src/components/useNativeWindowBackground.test.tsx`:

```tsx
// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NativeWindowPort } from "../application/nativeWindowPort";
import type { PaletteId, ResolvedColorScheme } from "../domain/appearance";
import { useNativeWindowBackground } from "./useNativeWindowBackground";

function Probe(props: {
  readonly port: NativeWindowPort | null;
  readonly palette: PaletteId;
  readonly scheme: ResolvedColorScheme;
}) {
  useNativeWindowBackground(props.port, props.palette, props.scheme);
  return null;
}

describe("useNativeWindowBackground", () => {
  let host: HTMLDivElement;
  let root: Root;
  const colors: string[] = [];
  const port: NativeWindowPort = {
    setBackgroundColor(color) {
      colors.push(color);
      return Promise.resolve();
    },
    show: () => Promise.resolve(),
  };

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    colors.length = 0;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("follows runtime palette and scheme changes", () => {
    act(() => root.render(<Probe palette="graphite-teal" port={port} scheme="dark" />));
    act(() => root.render(<Probe palette="graphite-teal" port={port} scheme="light" />));
    act(() => root.render(<Probe palette="graphite-teal" port={port} scheme="light" />));

    expect(colors).toEqual(["#151616", "#EDEEEF"]);
  });

  it("stays silent without a native window", () => {
    act(() => root.render(<Probe palette="graphite-teal" port={null} scheme="light" />));

    expect(colors).toEqual([]);
  });
});
```

Append to `src/startupTheme.test.ts` (inside its top-level `describe`, reusing its existing environment helper if one exists; otherwise this standalone block):

```ts
describe("applyStartupTheme result", () => {
  it("returns the resolved appearance it stamped on the document", () => {
    const stamped = new Map<string, string>();
    const appearance = applyStartupTheme({
      prefersLight: () => true,
      readSetting: () => JSON.stringify({ appearance: { palette: "ink-mint", colorScheme: "system" } }),
      setDocumentAttribute: (name, value) => stamped.set(name, value),
    });

    expect(appearance).toEqual({ palette: "ink-mint", colorScheme: "light" });
    expect(stamped.get("data-cv-palette")).toBe("ink-mint");
    expect(stamped.get("data-cv-scheme")).toBe("light");
  });
});
```

(Import `applyStartupTheme` from `./startupTheme` if the file does not already.)

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/domain/nativeWindowBackground.test.ts src/startupWindowReveal.test.ts src/components/useNativeWindowBackground.test.tsx src/startupTheme.test.ts`
Expected: FAIL - unresolved imports `./nativeWindowBackground`, `./startupWindowReveal`, `./useNativeWindowBackground`, and `applyStartupTheme` returns `undefined`.

- [ ] **Step 3: Implement the TypeScript side**

Create `src/domain/nativeWindowBackground.ts`:

```ts
import { surfaceColor } from "./appearancePalettes";
import type { DocumentAppearance } from "./startupTheme";

export function nativeWindowBackground(appearance: DocumentAppearance): string {
  return surfaceColor(appearance.palette, appearance.colorScheme, "side");
}
```

Create `src/application/nativeWindowPort.ts`:

```ts
export interface NativeWindowPort {
  setBackgroundColor(color: string): Promise<void>;
  show(): Promise<void>;
}
```

Create `src/infrastructure/tauriNativeWindow.ts`:

```ts
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { NativeWindowPort } from "../application/nativeWindowPort";

export function createTauriNativeWindow(): NativeWindowPort | null {
  if (!isTauri()) return null;
  return {
    async setBackgroundColor(color) {
      await Promise.all([
        getCurrentWindow().setBackgroundColor(color),
        getCurrentWebview().setBackgroundColor(color),
      ]);
    },
    async show() {
      await getCurrentWindow().show();
    },
  };
}
```

Create `src/startupWindowReveal.ts`:

```ts
import type { NativeWindowPort } from "./application/nativeWindowPort";
import { nativeWindowBackground } from "./domain/nativeWindowBackground";
import type { DocumentAppearance } from "./domain/startupTheme";

export async function revealStartupWindow(
  port: NativeWindowPort | null,
  appearance: DocumentAppearance,
): Promise<void> {
  if (port === null) return;
  await port.setBackgroundColor(nativeWindowBackground(appearance)).catch(() => undefined);
  await port.show().catch(() => undefined);
}
```

Create `src/components/useNativeWindowBackground.ts`:

```ts
import { useEffect } from "react";
import type { NativeWindowPort } from "../application/nativeWindowPort";
import type { PaletteId, ResolvedColorScheme } from "../domain/appearance";
import { nativeWindowBackground } from "../domain/nativeWindowBackground";

export function useNativeWindowBackground(
  port: NativeWindowPort | null,
  palette: PaletteId,
  colorScheme: ResolvedColorScheme,
): void {
  useEffect(() => {
    if (port === null) return;
    void port
      .setBackgroundColor(nativeWindowBackground({ palette, colorScheme }))
      .catch(() => undefined);
  }, [colorScheme, palette, port]);
}
```

In `src/startupTheme.ts` replace `applyStartupTheme` and `applyBrowserStartupTheme` with:

```ts
export const FALLBACK_STARTUP_APPEARANCE: DocumentAppearance = {
  palette: DEFAULT_APPEARANCE.palette,
  colorScheme: "dark",
};

export function applyStartupTheme(environment: StartupThemeEnvironment): DocumentAppearance {
  const appearance = resolveStartupAppearance(
    readSettingSafely(environment),
    prefersLightSafely(environment),
  );
  environment.setDocumentAttribute(PALETTE_ATTRIBUTE, appearance.palette);
  environment.setDocumentAttribute(COLOR_SCHEME_ATTRIBUTE, appearance.colorScheme);
  return appearance;
}

export function applyBrowserStartupTheme(): DocumentAppearance {
  try {
    return applyStartupTheme(browserStartupThemeEnvironment());
  } catch {
    return FALLBACK_STARTUP_APPEARANCE;
  }
}
```

and update its imports to:

```ts
import { COLOR_SCHEME_ATTRIBUTE, DEFAULT_APPEARANCE, PALETTE_ATTRIBUTE } from "./domain/appearance";
import {
  resolveStartupAppearance,
  STARTUP_APP_SETTINGS_KEY,
  type DocumentAppearance,
} from "./domain/startupTheme";
```

In `src/main.tsx` replace the line `applyBrowserStartupTheme();` with:

```ts
void revealStartupWindow(createTauriNativeWindow(), applyBrowserStartupTheme());
```

and add the imports:

```ts
import { createTauriNativeWindow } from "./infrastructure/tauriNativeWindow";
import { revealStartupWindow } from "./startupWindowReveal";
```

In `src/components/useAppWorkbenchThemes.ts` change the signature and body:

```ts
export function useAppWorkbenchThemes(
  appearance: AppearanceSettings,
  prefersLightTheme: boolean,
  nativeWindow: NativeWindowPort | null = null,
): AppWorkbenchThemes {
  const themes = useMemo(
    () => resolveEditorColorThemes(appearance, prefersLightTheme),
    [appearance, prefersLightTheme],
  );
  useDocumentAppearance(appearance.palette, themes.colorScheme);
  useNativeWindowBackground(nativeWindow, appearance.palette, themes.colorScheme);
  return themes;
}
```

with imports `import type { NativeWindowPort } from "../application/nativeWindowPort";` and `import { useNativeWindowBackground } from "./useNativeWindowBackground";`.

In `src/workbenchComposition.ts` import `createTauriNativeWindow` from `./infrastructure/tauriNativeWindow` and add `nativeWindow: createTauriNativeWindow(),` to the object returned by `createWorkbenchComposition()` (next to `systemFontGateway`).

In `src/App.tsx` add `nativeWindow,` to the `workbenchComposition` destructuring (alphabetical position after `liveDocumentRuntime,`/`localHistoryGateway,`) and change the theme call to:

```ts
  const { colorScheme, monacoTheme, terminalTheme } = useAppWorkbenchThemes(
    workbench.appSettings.appearance,
    prefersLightTheme,
    nativeWindow,
  );
```

- [ ] **Step 4: Run the TypeScript tests to verify they pass**

Run: `npx vitest run src/domain/nativeWindowBackground.test.ts src/startupWindowReveal.test.ts src/components/useNativeWindowBackground.test.tsx src/startupTheme.test.ts src/startupAppearanceHandoff.test.tsx src/startupMount.test.tsx`
Expected: PASS.

- [ ] **Step 5: Window configuration, capabilities and traffic lights (failing config tests first)**

In `src/startupDocument.test.ts` replace the whole `describe("native window background", ...)` block with:

```ts
describe("native window", () => {
  const configs = ["tauri.conf.json", "tauri.macos.conf.json"].map((file) => {
    const config: unknown = JSON.parse(
      readFileSync(resolve(REPOSITORY_ROOT, "src-tauri", file), "utf8"),
    );
    const windows = (config as { app?: { windows?: readonly Record<string, unknown>[] } }).app
      ?.windows;
    return { file, main: windows?.find((entry) => entry.label === "main") };
  });

  it("keeps the dark side tone as the pre-reveal native background in both configurations", () => {
    const darkSide = startupTone("graphite-teal", "dark", "--startup-side");
    for (const { file, main } of configs) {
      expect(main, file).toBeDefined();
      expect(main?.backgroundColor, file).toBe(darkSide);
    }
  });

  it("creates the window hidden so the frontend reveals it after painting the palette tone", () => {
    for (const { file, main } of configs) {
      expect(main?.visible, file).toBe(false);
    }
  });

  it("lets the frontend set the window and webview background and show the window", () => {
    const capability = JSON.parse(
      readFileSync(resolve(REPOSITORY_ROOT, "src-tauri/capabilities/default.json"), "utf8"),
    ) as { permissions: readonly string[] };
    expect(capability.permissions).toEqual(
      expect.arrayContaining([
        "core:window:allow-show",
        "core:window:allow-set-background-color",
        "core:webview:allow-set-webview-background-color",
      ]),
    );
  });

  it("places the macOS traffic lights where the 52px top bars expect them", () => {
    const mac = configs.find((entry) => entry.file === "tauri.macos.conf.json")?.main;
    expect(mac?.trafficLightPosition).toEqual({
      x: MAC_TRAFFIC_LIGHTS.x,
      y: MAC_TRAFFIC_LIGHTS.y,
    });
  });
});
```

and add `import { MAC_TRAFFIC_LIGHTS } from "./domain/appearanceShellStates";` to its imports.

In `src/components/windowChromeStyles.test.ts`, in "drops the app title row only for the macOS agent workbench", replace `expect(macAgent).toContain("--window-native-controls-inset: 78px;");` with `expect(macAgent).toContain("--window-native-controls-inset: var(--cv-traffic-light-inset);");`, and in "centers the macOS native traffic-light spacer within the title bar" add:

```ts
    expect(cssRule(css, ".window-native-control-space")).toContain(
      "width: var(--cv-traffic-light-inset);",
    );
```

Run: `npx vitest run src/startupDocument.test.ts src/components/windowChromeStyles.test.ts`
Expected: FAIL on `visible`, the capability list, `trafficLightPosition` and the two CSS assertions.

Then:
- `src-tauri/tauri.conf.json` and `src-tauri/tauri.macos.conf.json`: add `"visible": false,` after `"backgroundColor": "#151616",` in the `main` window.
- `src-tauri/tauri.macos.conf.json`: `"trafficLightPosition": { "x": 20, "y": 20 }`.
- `src-tauri/capabilities/default.json`: add `"core:window:allow-set-background-color",` after `"core:window:allow-minimize",` and `"core:webview:allow-set-webview-background-color",` after `"core:window:allow-unminimize",`.
- `src/App.css`: in `.app-shell--agent-mode.app-shell--mac` replace `--window-native-controls-inset: 78px;` with `--window-native-controls-inset: var(--cv-traffic-light-inset);`; in `.window-native-control-space` replace `width: 78px;` with `width: var(--cv-traffic-light-inset);` and `flex: 0 0 78px;` with `flex: 0 0 var(--cv-traffic-light-inset);`.

Run: `npx vitest run src/startupDocument.test.ts src/components/windowChromeStyles.test.ts`
Expected: PASS.

- [ ] **Step 6: Rust fallback reveal (test first)**

Create `src-tauri/src/startup_window_reveal.rs`:

```rust
use std::time::Duration;

use tauri::{AppHandle, Manager, Runtime};

pub(crate) const MAIN_WINDOW_LABEL: &str = "main";
pub(crate) const STARTUP_REVEAL_FALLBACK: Duration = Duration::from_millis(2_500);

pub(crate) fn schedule_startup_reveal_fallback<R: Runtime>(app: &AppHandle<R>) {
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(STARTUP_REVEAL_FALLBACK).await;
        let Some(window) = handle.get_webview_window(MAIN_WINDOW_LABEL) else {
            return;
        };
        if reveal_needed(window.is_visible()) {
            let _ = window.show();
        }
    });
}

pub(crate) fn reveal_needed(visible: tauri::Result<bool>) -> bool {
    !matches!(visible, Ok(true))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reveals_a_window_the_frontend_never_showed() {
        assert!(reveal_needed(Ok(false)));
    }

    #[test]
    fn leaves_a_window_the_frontend_already_revealed() {
        assert!(!reveal_needed(Ok(true)));
    }

    #[test]
    fn reveals_when_visibility_cannot_be_read() {
        assert!(reveal_needed(Err(tauri::Error::WindowNotFound)));
    }

    #[test]
    fn waits_past_a_normal_first_paint_but_under_a_noticeable_hang() {
        assert!(STARTUP_REVEAL_FALLBACK >= Duration::from_secs(2));
        assert!(STARTUP_REVEAL_FALLBACK <= Duration::from_secs(5));
    }
}
```

In `src-tauri/src/lib_composition/command_facades.rs`, next to the `startup_metrics` declaration, add:

```rust
#[path = "../startup_window_reveal.rs"]
mod startup_window_reveal;
```

In `src-tauri/src/lib_composition/runtime.rs`, as the first statement inside `.setup(move |app| {`, add:

```rust
            startup_window_reveal::schedule_startup_reveal_fallback(app.handle());
```

Run: `cd src-tauri && cargo test --lib startup_window_reveal && cd ..`
Expected: 4 tests pass. Then `cd src-tauri && cargo clippy --all-targets -- -D warnings && cd ..` exits 0.

- [ ] **Step 7: Format**

Run: `npx prettier --write src/domain/nativeWindowBackground.ts src/domain/nativeWindowBackground.test.ts src/application/nativeWindowPort.ts src/infrastructure/tauriNativeWindow.ts src/startupWindowReveal.ts src/startupWindowReveal.test.ts src/components/useNativeWindowBackground.ts src/components/useNativeWindowBackground.test.tsx && npm run format:check:changed && (cd src-tauri && cargo fmt --all -- --check)`
Expected: exit 0.

---

### Task 3: Toggle Sidebar keybinding (Cmd+B) with an editor-text focus scope

**Files:**
- Create: `src/components/agentMode/editorTextFocus.ts`, `src/components/agentMode/editorTextFocus.test.ts`
- Modify: `src/domain/keymap.ts`, `src/domain/keymap.test.ts`
- Modify: `src/application/agentViewCommandBridge.ts`
- Modify: `src/application/workbenchAgentCommands.ts`, `src/application/workbenchAgentCommands.test.ts`
- Modify: `src/application/workbenchShortcutCommandDispatcher.ts`, `src/application/workbenchShortcutCommandDispatcher.test.ts`
- Modify: `src/components/agentMode/useAgentViewCommands.ts`
- Modify: `src/components/agentMode/agentThreadHeaderPresentation.ts`, `src/components/agentMode/AgentWorkbenchScreen.tsx` (`layoutShortcuts`), `src/components/agentMode/AgentPanelLayoutControls.test.tsx` and `src/components/agentMode/AgentThreadHeader.test.tsx` (`SHORTCUTS` fixtures)

**Interfaces:**
- Consumes: `ShortcutScopedCommand` (`workbenchShortcutCommandDispatcher.ts`), `AgentWorkbenchLayoutCommandPort`.
- Produces:
  - keymap command `agent.toggleSidebar` ("Toggle Sidebar", category "Agent", default `Cmd+B`)
  - `AgentViewCommandHandlers.editorTextFocused?(): boolean`, `AgentViewCommandBridge.editorTextFocused(): boolean`
  - command `agent.toggleSidebar` (Agents): `isEnabled` = agent view bound + workspace; `isShortcutEnabled` additionally requires `!editorTextFocused()`; `run` dispatches `{ kind: "toggleRail" }`
  - `EDITOR_TEXT_SELECTOR = ".monaco-editor"`, `editorTextFocused(doc: Document): boolean`
  - `AgentPanelLayoutShortcuts` gains `readonly sidebar: string; readonly newThread: string`

- [ ] **Step 1: Write the failing tests**

In `src/domain/keymap.test.ts`:
- In "keeps reserved commands out of the generated editable settings catalog" change `156` -> `157` and `154` -> `155`.
- In `defaultShortcutsWithoutIntentionalCollisions` add `id !== "agent.toggleSidebar" &&` next to `id !== "agent.searchThreads" &&`.
- Add after "reserves the agent-mode-scoped Search Threads collision with Delete Line":

```ts
  it("reserves the agent-mode Toggle Sidebar collision with Go to Definition", () => {
    expect(keymapCommands.find((command) => command.id === "agent.toggleSidebar")).toMatchObject({
      category: "Agent",
      defaultShortcut: "Cmd+B",
      label: "Toggle Sidebar",
    });
    for (const platform of ["mac", "linux", "windows"] as const) {
      const defaults = defaultKeymapSettings(platform);

      expect(defaults["agent.toggleSidebar"]).toBe(defaults["editor.goToDefinition"]);
      expect(
        keymapCommandIdsForShortcut(defaults, defaults["agent.toggleSidebar"], platform),
      ).toEqual(["agent.toggleSidebar", "editor.goToDefinition"]);
    }
  });
```

Create `src/components/agentMode/editorTextFocus.test.ts`:

```ts
// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { editorTextFocused } from "./editorTextFocus";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("editorTextFocused", () => {
  it("reports focus inside a Monaco editor text area", () => {
    document.body.innerHTML =
      '<div class="monaco-editor"><textarea aria-label="Editor content"></textarea></div>';
    document.querySelector("textarea")?.focus();

    expect(editorTextFocused(document)).toBe(true);
  });

  it("ignores the composer and other text fields", () => {
    document.body.innerHTML = '<textarea aria-label="Message"></textarea>';
    document.querySelector("textarea")?.focus();

    expect(editorTextFocused(document)).toBe(false);
  });

  it("ignores an unfocused document", () => {
    expect(editorTextFocused(document)).toBe(false);
  });
});
```

In `src/application/workbenchAgentCommands.test.ts`:
- Add `const SHELL_COMMAND_IDS = ["agent.toggleSidebar"] as const;` after `LAYOUT_COMMAND_IDS`.
- "returns the agent commands with registry metadata": both lists become `[...VIEW_COMMAND_IDS, ...LAYOUT_COMMAND_IDS, ...SHELL_COMMAND_IDS]`.
- "keeps the view commands disabled until an agent view is bound": both expected arrays become `[...VIEW_COMMAND_IDS.map(() => false), ...LAYOUT_COMMAND_IDS.map(() => true), ...SHELL_COMMAND_IDS.map(() => false)]`.
- Add:

```ts
  it("toggles the sidebar only in agent mode and yields the shortcut to a focused editor", async () => {
    let editorFocused = false;
    const bridge = createAgentViewCommandBridge();
    const agentLayout = recordingLayout();
    const commands = workbenchAgentCommands({ agentLayout, viewCommands: bridge });
    const toggle = commands.find(
      (command) => command.id === "agent.toggleSidebar",
    ) as ShortcutScopedCommand;

    expect(toggle.isEnabled(enabledContext)).toBe(false);
    expect(toggle.isShortcutEnabled(enabledContext)).toBe(false);

    bridge.bind({ ...handlers(), editorTextFocused: () => editorFocused });

    expect(toggle.isEnabled(enabledContext)).toBe(true);
    expect(toggle.isShortcutEnabled(enabledContext)).toBe(true);
    expect(toggle.isEnabled(disabledContext)).toBe(false);

    editorFocused = true;

    expect(toggle.isEnabled(enabledContext)).toBe(true);
    expect(toggle.isShortcutEnabled(enabledContext)).toBe(false);

    await toggle.run();

    expect(agentLayout.actions).toEqual([{ kind: "toggleRail" }]);
  });
```

In `src/application/workbenchShortcutCommandDispatcher.test.ts` add inside `describe("dispatchWorkbenchShortcutCommand", ...)`:

```ts
  it("hands Cmd+B to Go to Definition while editor text owns focus and to Toggle Sidebar otherwise", () => {
    let editorFocused = true;
    const toggleSidebar = vi.fn();
    const goToDefinition = vi.fn();
    const sidebarCommand: ShortcutScopedCommand = {
      category: "Agents",
      id: "agent.toggleSidebar",
      isEnabled: () => true,
      isShortcutEnabled: () => !editorFocused,
      run: toggleSidebar,
      title: "Toggle Sidebar",
    };
    const commandRegistry = registry({
      "agent.toggleSidebar": sidebarCommand,
      "editor.goToDefinition": command({ id: "editor.goToDefinition", run: goToDefinition }),
    });
    const dispatch = () =>
      dispatchWorkbenchShortcutCommand({
        commandContext,
        commandRegistry,
        event: keyboardEvent({ key: "b", metaKey: true }),
        keymap: defaultKeymapSettings("mac"),
        runCommand: registryRunner(commandRegistry),
      });

    expect(dispatch()).toBe(true);
    expect(goToDefinition).toHaveBeenCalledTimes(1);
    expect(toggleSidebar).not.toHaveBeenCalled();

    editorFocused = false;

    expect(dispatch()).toBe(true);
    expect(toggleSidebar).toHaveBeenCalledTimes(1);
    expect(goToDefinition).toHaveBeenCalledTimes(1);
  });
```

In `src/components/agentMode/AgentPanelLayoutControls.test.tsx` and `src/components/agentMode/AgentThreadHeader.test.tsx` change the fixture to:

```ts
const SHORTCUTS = {
  bottomPanel: "Cmd+J",
  rightPanel: "Cmd+Alt+R",
  sidebar: "Cmd+B",
  newThread: "Cmd+N",
};
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/domain/keymap.test.ts src/components/agentMode/editorTextFocus.test.ts src/application/workbenchAgentCommands.test.ts src/application/workbenchShortcutCommandDispatcher.test.ts`
Expected: FAIL - unknown command `agent.toggleSidebar`, missing module `./editorTextFocus`, wrong command list length, and Cmd+B always running Go to Definition.

- [ ] **Step 3: Implement**

`src/domain/keymap.ts`: insert right after the `agent.toggleRightPanel` entry:

```ts
  {
    category: "Agent",
    defaultShortcut: "Cmd+B",
    id: "agent.toggleSidebar",
    label: "Toggle Sidebar",
  },
```

Create `src/components/agentMode/editorTextFocus.ts`:

```ts
export const EDITOR_TEXT_SELECTOR = ".monaco-editor";

export function editorTextFocused(doc: Document): boolean {
  const active = doc.activeElement;
  if (active === null) return false;
  return active.closest(EDITOR_TEXT_SELECTOR) !== null;
}
```

`src/application/agentViewCommandBridge.ts`:
- `AgentViewCommandHandlers`: add `editorTextFocused?(): boolean;` after `threadFindFocused?(): boolean;`.
- `AgentViewCommandBridge`: add `editorTextFocused(): boolean;` after `threadFindFocused(): boolean;`.
- In `createAgentViewCommandBridge` add `editorTextFocused: () => current?.editorTextFocused?.() ?? false,` after the `threadFindFocused` member.

`src/application/workbenchAgentCommands.ts`: before `return [`, add:

```ts
  const sidebarCommand: ShortcutScopedCommand = {
    id: "agent.toggleSidebar",
    title: "Toggle Sidebar",
    category: "Agents",
    shortcut: shortcut?.("agent.toggleSidebar"),
    isEnabled: inAgentMode,
    isShortcutEnabled: (context) => inAgentMode(context) && !viewCommands.editorTextFocused(),
    run: () => agentLayout?.dispatch({ kind: "toggleRail" }),
  };
```

and append `sidebarCommand,` as the last element of the returned array (after the `SURFACE_COMMANDS.map(...)` spread).

`src/application/workbenchShortcutCommandDispatcher.ts`: add `"agent.toggleSidebar",` to `FOCUS_SCOPED_COMMAND_IDS`.

`src/components/agentMode/useAgentViewCommands.ts`: import `import { editorTextFocused } from "./editorTextFocus";` and add `editorTextFocused: () => editorTextFocused(document),` to the object passed to `bridge.bind`.

`src/components/agentMode/agentThreadHeaderPresentation.ts`:

```ts
export interface AgentPanelLayoutShortcuts {
  readonly bottomPanel: string;
  readonly rightPanel: string;
  readonly sidebar: string;
  readonly newThread: string;
}
```

```ts
export function defaultAgentPanelLayoutShortcuts(): AgentPanelLayoutShortcuts {
  return {
    bottomPanel: defaultShortcutForCommand("panel.toggle"),
    rightPanel: defaultShortcutForCommand("agent.toggleRightPanel"),
    sidebar: defaultShortcutForCommand("agent.toggleSidebar"),
    newThread: defaultShortcutForCommand("agent.newThread"),
  };
}
```

`src/components/agentMode/AgentWorkbenchScreen.tsx`, function `layoutShortcuts`:

```ts
function layoutShortcuts(keymap: KeymapSettings): AgentPanelLayoutShortcuts {
  return {
    bottomPanel: shortcutForCommand(keymap, "panel.toggle") ?? "",
    rightPanel: shortcutForCommand(keymap, "agent.toggleRightPanel") ?? "",
    sidebar: shortcutForCommand(keymap, "agent.toggleSidebar") ?? "",
    newThread: shortcutForCommand(keymap, "agent.newThread") ?? "",
  };
}
```

- [ ] **Step 4: Run the focused tests**

Run: `npx vitest run src/domain/keymap.test.ts src/components/agentMode/editorTextFocus.test.ts src/application/workbenchAgentCommands.test.ts src/application/workbenchShortcutCommandDispatcher.test.ts src/components/agentMode/AgentPanelLayoutControls.test.tsx src/components/agentMode/AgentThreadHeader.test.tsx src/components/agentMode/AgentModeView.test.tsx src/components/settings`
Expected: PASS. If a settings keybindings test counts rows of the "Agent" category, raise its expected count by exactly one for "Toggle Sidebar" (nothing else).

Run: `npm run check`
Expected: exit 0 (every `AgentPanelLayoutShortcuts` literal now carries `sidebar` and `newThread`).

- [ ] **Step 5: Format**

Run: `npx prettier --write src/components/agentMode/editorTextFocus.ts src/components/agentMode/editorTextFocus.test.ts && npm run format:check:changed`
Expected: exit 0.

---

### Task 4: Collapsed sidebar frees its whole track

**Files:**
- Modify: `src/domain/agentWorkbenchResponsiveLayout.ts`, `src/domain/agentWorkbenchResponsiveLayout.test.ts`
- Modify: `src/components/workbenchShellFrame.css`
- Modify: `src/components/agentMode/agentMode.css` (720px stacked rule)
- Modify: `src/components/agentMode/agentModeResponsiveStyles.test.ts`

**Interfaces:**
- Produces: `AGENT_COLLAPSED_RAIL_WIDTH = 0`; `agentWorkbenchRailWidth("collapsed", w) === 0`; CSS `--agent-rail-collapsed-width: 0px`.

- [ ] **Step 1: Write the failing tests**

Append to `describe` in `src/domain/agentWorkbenchResponsiveLayout.test.ts` (import `agentWorkbenchRailWidth` and `AGENT_COLLAPSED_RAIL_WIDTH` from `./agentWorkbenchResponsiveLayout` if not yet imported):

```ts
  it("gives a collapsed sidebar no track at any window width", () => {
    expect(AGENT_COLLAPSED_RAIL_WIDTH).toBe(0);
    expect(agentWorkbenchRailWidth("collapsed", 1_440)).toBe(0);
    expect(agentWorkbenchRailWidth("collapsed", 1_000)).toBe(0);
    expect(agentWorkbenchRailWidth("expanded", 1_440)).toBe(256);
  });

  it("hands the collapsed sidebar's width to the docked panel", () => {
    expect(
      responsiveAgentPanelPlacement({
        hidden: false,
        maximized: false,
        rail: "collapsed",
        requestedWidth: 540,
        viewportWidth: 1_000,
      }),
    ).toEqual({ overlay: false, restore: "none", width: 440 });
  });
```

Append to the `describe` in `src/components/agentMode/agentModeResponsiveStyles.test.ts` (the file already declares `appCss` = all agent-mode sheets, `shellCss` = `workbenchShellFrame.css`, and the helpers `block(source, marker)` / `rule(selector, source = appCss)`):

```ts
  it("collapses the sidebar to a zero track and never leaves an empty stacked row", () => {
    expect(rule('.workbench-frame[data-layout="agent"] {', shellCss)).toContain(
      "--agent-rail-collapsed-width: 0px",
    );
    const stacked = block(appCss, "@media (max-width: 720px)");
    expect(rule('.workbench-frame[data-rail="collapsed"] .agent-mode__grid', stacked)).toContain(
      "grid-template-rows: minmax(0, 1fr)",
    );
    expect(rule('.workbench-frame[data-rail="collapsed"] .agent-mode__center', stacked)).toContain(
      "grid-row: 1",
    );
  });
```


- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/domain/agentWorkbenchResponsiveLayout.test.ts src/components/agentMode/agentModeResponsiveStyles.test.ts`
Expected: FAIL - collapsed width 48, placement width 392, missing CSS.

- [ ] **Step 3: Implement**

- `src/domain/agentWorkbenchResponsiveLayout.ts`: `export const AGENT_COLLAPSED_RAIL_WIDTH = 0;`
- `src/components/workbenchShellFrame.css`, rule `.workbench-frame[data-layout="agent"]`: replace `--agent-rail-collapsed-width: calc(32px + 2 * var(--agent-rail-inset));` with `--agent-rail-collapsed-width: 0px;`.
- `src/components/agentMode/agentMode.css`, inside the existing `@media (max-width: 720px) {` block, append:

```css
  .workbench-frame[data-rail="collapsed"] .agent-mode__grid {
    grid-template-rows: minmax(0, 1fr);
  }

  .workbench-frame[data-rail="collapsed"] .agent-mode__center {
    grid-row: 1;
  }
```

- [ ] **Step 4: Run the focused tests**

Run: `npx vitest run src/domain/agentWorkbenchResponsiveLayout.test.ts src/components/agentMode/agentModeResponsiveStyles.test.ts src/components/workbenchShellPlacement.test.ts src/components/WorkbenchShellFrame.test.tsx src/application/useWorkbenchResizeHandles.test.tsx`
Expected: PASS. Any existing assertion that hard-codes the 48px collapsed track (e.g. an overlay threshold computed with `48`) must be recomputed with `0`; change nothing else.

- [ ] **Step 5: Format**

Run: `npm run format:check:changed`
Expected: exit 0.

---
### Task 5: Shell top bar primitive

**Files:**
- Create: `src/ui/shell/TopBar.tsx`, `src/ui/shell/ProjectFavicon.tsx`, `src/ui/shell/shell.css`
- Create: `src/ui/shell/TopBar.test.tsx`, `src/ui/shell/shellStyles.test.ts`
- Modify: `src/App.css` (`.app-shell` rule: one custom property), `src/components/workbenchShellFrame.css` (`.workbench-frame[data-layout="agent"]`: one custom property)

**Interfaces:**
- Consumes: `cx` (`src/ui/foundation/classNames.ts`), `mountUi` (`src/ui/foundation/foundationTestSupport.ts`), tokens from Task 1.
- Produces:
  - `type TopBarRegion = "sidebar" | "main" | "panel"`
  - `interface TopBarProps extends Omit<HTMLAttributes<HTMLElement>, "children" | "className" | "aria-label"> { region; label: string; windowEdge?: boolean; leading?: ReactNode; actions?: ReactNode; trailing?: ReactNode; className?: string; children?: ReactNode }`
  - `TopBar(props)`: `<header class="cv-topbar cv-topbar--{region} [cv-topbar--window-edge]" data-tauri-drag-region="deep">` with slots `.cv-topbar__leading`, `.cv-topbar__title`, `.cv-topbar__actions` (hover/focus revealed), `.cv-topbar__trailing`; empty slots are not rendered.
  - `TopBarSeparator()` -> `<span aria-hidden="true" class="cv-topbar__separator">`
  - `projectInitial(label: string): string`, `ProjectFavicon({ label })` -> `<span aria-hidden="true" class="cv-favicon">`
  - CSS classes `cv-crumb`, `cv-crumb__project`, `cv-crumb__label`, `cv-crumb__sep`, `cv-crumb__here`, `cv-crumb__heading`, `cv-crumb__chevron`, `cv-panel-toggles`, `cv-panel-window-controls`
  - Custom properties `--cv-shell-window-inset` (on `.app-shell`, = `var(--window-native-controls-inset)`; 84px on macOS in agent mode, else 0px) and `--cv-shell-sidebar-track` (on the agent frame, = `var(--agent-rail-track)`).

- [ ] **Step 1: Write the failing tests**

Create `src/ui/shell/TopBar.test.tsx`:

```tsx
// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { mountUi, type MountedUi } from "../foundation/foundationTestSupport";
import { ProjectFavicon, projectInitial } from "./ProjectFavicon";
import { TopBar, TopBarSeparator } from "./TopBar";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let mounted: MountedUi | null = null;

afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

function mount(): MountedUi {
  mounted = mountUi();
  return mounted;
}

describe("TopBar", () => {
  it("renders a labelled drag-region header with only the slots it was given", () => {
    const view = mount();
    view.render(
      <TopBar label="Thread" region="main">
        <span>Title</span>
      </TopBar>,
    );

    const header = view.host.querySelector("header");
    expect(header?.getAttribute("aria-label")).toBe("Thread");
    expect(header?.getAttribute("data-tauri-drag-region")).toBe("deep");
    expect(header?.className).toBe("cv-topbar cv-topbar--main");
    expect(view.host.querySelector(".cv-topbar__title")?.textContent).toBe("Title");
    expect(view.host.querySelector(".cv-topbar__leading")).toBeNull();
    expect(view.host.querySelector(".cv-topbar__actions")).toBeNull();
    expect(view.host.querySelector(".cv-topbar__trailing")).toBeNull();
  });

  it("orders leading, title, hover actions and trailing and keeps controls out of the drag region", () => {
    const view = mount();
    view.render(
      <TopBar
        actions={<button type="button">Open</button>}
        label="Thread"
        leading={<button type="button">Expand</button>}
        region="main"
        trailing={<button type="button">Toggle</button>}
      >
        <span>Title</span>
      </TopBar>,
    );

    const slots = [...(view.host.querySelector("header")?.children ?? [])].map(
      (child) => child.className,
    );
    expect(slots).toEqual([
      "cv-topbar__leading",
      "cv-topbar__title",
      "cv-topbar__actions",
      "cv-topbar__trailing",
    ]);
    for (const button of view.host.querySelectorAll("button")) {
      expect(button.hasAttribute("data-tauri-drag-region")).toBe(false);
      expect(button.closest("[data-tauri-drag-region]")?.tagName).toBe("HEADER");
    }
  });

  it("marks the window edge and forwards data attributes and extra classes", () => {
    const view = mount();
    view.render(
      <TopBar
        className="agent-surface__head"
        data-agent-surface-head=""
        label="Right panel"
        region="panel"
        windowEdge
      />,
    );

    const header = view.host.querySelector("header");
    expect(header?.className).toBe(
      "cv-topbar cv-topbar--panel cv-topbar--window-edge agent-surface__head",
    );
    expect(header?.hasAttribute("data-agent-surface-head")).toBe(true);
  });

  it("hides the separator from assistive technology", () => {
    const view = mount();
    view.render(<TopBarSeparator />);

    expect(view.host.querySelector(".cv-topbar__separator")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
  });
});

describe("ProjectFavicon", () => {
  it("shows the upper-cased first character of the project label", () => {
    expect(projectInitial("orders-api")).toBe("O");
    expect(projectInitial("  web-dashboard")).toBe("W");
    expect(projectInitial("")).toBe("?");
    expect(projectInitial("   ")).toBe("?");
    expect(projectInitial("\u{1F680}rocket")).toBe("\u{1F680}");
  });

  it("renders a decorative favicon", () => {
    const view = mount();
    view.render(<ProjectFavicon label="orders-api" />);

    const favicon = view.host.querySelector(".cv-favicon");
    expect(favicon?.textContent).toBe("O");
    expect(favicon?.getAttribute("aria-hidden")).toBe("true");
  });
});
```

Create `src/ui/shell/shellStyles.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  COLOR_LITERAL,
  buildTokenTable,
  lastOf,
  parseAllStyleSheets,
  selectorParts,
  varReferences,
  type CssRule,
} from "../../components/cssContractTestSupport";

const parsed = parseAllStyleSheets();
const shellRules = parsed.rules.filter((rule) => rule.sheet === "ui/shell/shell.css");
const declared = new Set(
  parsed.rules
    .flatMap((rule) => rule.declarations.map((declaration) => declaration.property))
    .filter((property) => property.startsWith("--cv-")),
);
const LEGACY_TOKEN = /var\(\s*--(color|agent|codevo|settings|toast|change|window)-/;
const MOTION_PROPERTIES = new Set(["transition", "transition-duration", "animation"]);
const MOTION_TOKEN = /var\(--cv-motion-(fast|base|slow|spin)\)/;
const CLASS_NAME = /\.(-?[_a-zA-Z][\w-]*)/g;

function declaration(rules: readonly CssRule[], selector: string, property: string) {
  return lastOf(
    buildTokenTable(
      rules.filter((rule) => rule.context.length === 0 && selectorParts(rule.selector).includes(selector)),
      "",
    ).get(property),
  );
}

describe("shell stylesheet", () => {
  it("parses and paints only through declared --cv tokens", () => {
    expect(parsed.issues).toEqual([]);
    expect(shellRules.length).toBeGreaterThan(0);
    const literals = shellRules.flatMap((rule) =>
      rule.declarations
        .filter((entry) => COLOR_LITERAL.test(entry.value))
        .map((entry) => `${rule.selector} ${entry.property}`),
    );
    const undeclared = shellRules.flatMap((rule) =>
      rule.declarations.flatMap((entry) =>
        varReferences(entry.value)
          .filter((name) => name.startsWith("--cv-") && !declared.has(name))
          .map((name) => `${rule.selector} ${name}`),
      ),
    );
    const legacy = shellRules.flatMap((rule) =>
      rule.declarations
        .filter((entry) => LEGACY_TOKEN.test(entry.value))
        .map((entry) => `${rule.selector} ${entry.property}`),
    );

    expect(literals).toEqual([]);
    expect(undeclared).toEqual([]);
    expect(legacy).toEqual([]);
  });

  it("animates only through motion tokens and namespaces every class", () => {
    const motion = shellRules.flatMap((rule) =>
      rule.declarations
        .filter((entry) => MOTION_PROPERTIES.has(entry.property) && entry.value !== "none")
        .filter((entry) => !MOTION_TOKEN.test(entry.value))
        .map((entry) => `${rule.selector}: ${entry.value}`),
    );
    const foreign = shellRules
      .flatMap((rule) => selectorParts(rule.selector))
      .flatMap((part) => [...part.matchAll(CLASS_NAME)].map((match) => match[1] ?? ""))
      .filter((name) => !name.startsWith("cv-"));

    expect(motion).toEqual([]);
    expect(foreign).toEqual([]);
  });

  it("sizes every bar at the 52px top bar token and clears the traffic lights at the window edge", () => {
    expect(declaration(shellRules, ".cv-topbar", "height")).toBe("var(--cv-topbar-h)");
    expect(
      (declaration(shellRules, ".cv-topbar--window-edge", "padding-left") ?? "").replace(/\s+/g, ""),
    ).toBe(
      "max(var(--cv-topbar-pad),calc(var(--cv-shell-window-inset,0px)-var(--cv-shell-sidebar-track,0px)))",
    );
    expect(declaration(shellRules, ".cv-topbar__actions", "opacity")).toBe("0");
    const reveal = shellRules.find((rule) =>
      selectorParts(rule.selector).includes(".cv-topbar:focus-within .cv-topbar__actions"),
    );
    expect(reveal?.declarations.find((entry) => entry.property === "opacity")?.value).toBe("1");
  });

  it("feeds the window inset and the sidebar track from the app shell and the agent frame", () => {
    const appShell = parsed.rules.filter((rule) => rule.sheet === "App.css");
    const frame = parsed.rules.filter((rule) => rule.sheet === "components/workbenchShellFrame.css");

    expect(declaration(appShell, ".app-shell", "--cv-shell-window-inset")).toBe(
      "var(--window-native-controls-inset)",
    );
    expect(
      declaration(frame, '.workbench-frame[data-layout="agent"]', "--cv-shell-sidebar-track"),
    ).toBe("var(--agent-rail-track)");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/ui/shell`
Expected: FAIL - unresolved `./TopBar` / `./ProjectFavicon` and no `ui/shell/shell.css` rules.

- [ ] **Step 3: Implement**

Create `src/ui/shell/TopBar.tsx`:

```tsx
import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../foundation/classNames";
import "./shell.css";

export type TopBarRegion = "sidebar" | "main" | "panel";

export interface TopBarProps
  extends Omit<HTMLAttributes<HTMLElement>, "children" | "className" | "aria-label"> {
  readonly region: TopBarRegion;
  readonly label: string;
  readonly windowEdge?: boolean;
  readonly leading?: ReactNode;
  readonly actions?: ReactNode;
  readonly trailing?: ReactNode;
  readonly className?: string;
  readonly children?: ReactNode;
}

export function TopBar({
  actions,
  children,
  className,
  label,
  leading,
  region,
  trailing,
  windowEdge = false,
  ...rest
}: TopBarProps) {
  return (
    <header
      {...rest}
      aria-label={label}
      className={cx(
        "cv-topbar",
        `cv-topbar--${region}`,
        windowEdge && "cv-topbar--window-edge",
        className,
      )}
      data-tauri-drag-region="deep"
    >
      <TopBarSlot name="leading">{leading}</TopBarSlot>
      <div className="cv-topbar__title">{children}</div>
      <TopBarSlot name="actions">{actions}</TopBarSlot>
      <TopBarSlot name="trailing">{trailing}</TopBarSlot>
    </header>
  );
}

export function TopBarSeparator() {
  return <span aria-hidden="true" className="cv-topbar__separator" />;
}

type TopBarSlotName = "leading" | "actions" | "trailing";

function TopBarSlot({
  children,
  name,
}: {
  readonly children: ReactNode;
  readonly name: TopBarSlotName;
}) {
  if (children === undefined || children === null || children === false) return null;
  return <div className={`cv-topbar__${name}`}>{children}</div>;
}
```

Create `src/ui/shell/ProjectFavicon.tsx`:

```tsx
import "./shell.css";

const MAX_INITIAL_SCAN = 8;

export function projectInitial(label: string): string {
  const first = Array.from(label.trim().slice(0, MAX_INITIAL_SCAN))[0];
  if (first === undefined) return "?";
  return first.toLocaleUpperCase();
}

export function ProjectFavicon({ label }: { readonly label: string }) {
  return (
    <span aria-hidden="true" className="cv-favicon">
      {projectInitial(label)}
    </span>
  );
}
```

Create `src/ui/shell/shell.css`:

```css
.cv-topbar {
  --cv-topbar-pad: var(--cv-space-5);
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--cv-space-4);
  min-width: 0;
  height: var(--cv-topbar-h);
  padding: 0 var(--cv-space-5) 0 var(--cv-topbar-pad);
  color: var(--cv-fg);
  font-family: var(--cv-font-ui);
  font-size: var(--cv-t-sm);
  line-height: var(--cv-lh-sm);
  user-select: none;
}

.cv-topbar--sidebar,
.cv-topbar--main {
  --cv-topbar-pad: 20px;
}

.cv-topbar--panel {
  --cv-topbar-pad: var(--cv-space-4);
  padding-right: var(--cv-space-4);
}

.cv-topbar--window-edge {
  padding-left: max(
    var(--cv-topbar-pad),
    calc(var(--cv-shell-window-inset, 0px) - var(--cv-shell-sidebar-track, 0px))
  );
}

.cv-topbar__title {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  gap: var(--cv-space-4);
  min-width: 0;
}

.cv-topbar__leading,
.cv-topbar__actions,
.cv-topbar__trailing {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--cv-space-2);
}

.cv-topbar__actions {
  opacity: 0;
  transition: opacity var(--cv-motion-fast) var(--cv-ease);
}

.cv-topbar:hover .cv-topbar__actions,
.cv-topbar:focus-within .cv-topbar__actions,
.cv-topbar__actions:has([aria-expanded="true"]) {
  opacity: 1;
}

@media (hover: none) {
  .cv-topbar__actions {
    opacity: 1;
  }
}

.cv-topbar__separator {
  flex: none;
  width: 1px;
  height: 16px;
  margin: 0 var(--cv-space-3);
  background: var(--cv-hair-strong);
}

.cv-panel-toggles,
.cv-panel-window-controls {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: var(--cv-space-1);
}

.cv-favicon {
  display: inline-grid;
  flex: none;
  place-items: center;
  width: 16px;
  height: 16px;
  border-radius: var(--cv-r-xs);
  background: var(--cv-tint-3);
  color: var(--cv-fg-strong);
  font-size: 10px;
  font-weight: 600;
  line-height: 1;
}

.cv-crumb {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  gap: var(--cv-space-3);
  min-width: 0;
  font-size: var(--cv-t-sm);
}

.cv-crumb__project,
.cv-crumb__here {
  display: inline-flex;
  align-items: center;
  gap: var(--cv-space-3);
  min-width: 0;
  height: 28px;
  padding: 0 var(--cv-space-2);
  border: 0;
  border-radius: var(--cv-r-sm);
  background: transparent;
  font: inherit;
  cursor: pointer;
  transition:
    background-color var(--cv-motion-fast) var(--cv-ease),
    color var(--cv-motion-fast) var(--cv-ease);
}

.cv-crumb__project {
  flex: none;
  max-width: 180px;
  color: var(--cv-fg-subtle);
}

.cv-crumb__here {
  flex: 0 1 auto;
  max-width: min(48ch, 60%);
  color: var(--cv-fg-strong);
  font-weight: 500;
}

.cv-crumb__project:hover:not(:disabled),
.cv-crumb__here:hover:not(:disabled) {
  background: var(--cv-tint-2);
  color: var(--cv-fg-strong);
}

.cv-crumb__project:disabled,
.cv-crumb__here:disabled {
  cursor: default;
}

.cv-crumb__project:focus-visible,
.cv-crumb__here:focus-visible {
  outline: 2px solid var(--cv-focus);
  outline-offset: 2px;
}

.cv-crumb__label,
.cv-crumb__heading {
  overflow: hidden;
  min-width: 0;
  margin: 0;
  font: inherit;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cv-crumb__sep {
  flex: none;
  color: var(--cv-fg-subtle);
}

.cv-crumb__chevron {
  flex: none;
  opacity: 0;
  transition: opacity var(--cv-motion-fast) var(--cv-ease);
}

.cv-crumb__here:hover .cv-crumb__chevron,
.cv-crumb__here:focus-visible .cv-crumb__chevron,
.cv-crumb__here[aria-expanded="true"] .cv-crumb__chevron {
  opacity: 1;
}
```

In `src/App.css`, inside the `.app-shell {` rule that declares `--window-native-controls-inset: 0px;`, add:

```css
  --cv-shell-window-inset: var(--window-native-controls-inset);
```

In `src/components/workbenchShellFrame.css`, inside `.workbench-frame[data-layout="agent"] {`, add after `--agent-rail-track: var(--agent-rail-width);`:

```css
  --cv-shell-sidebar-track: var(--agent-rail-track);
```

- [ ] **Step 4: Run the focused tests**

Run: `npx vitest run src/ui/shell src/ui/foundation src/domain/themeContrast.test.ts src/components/windowChromeStyles.test.ts`
Expected: PASS.

- [ ] **Step 5: Format**

Run: `npx prettier --write src/ui/shell/TopBar.tsx src/ui/shell/ProjectFavicon.tsx src/ui/shell/shell.css src/ui/shell/TopBar.test.tsx src/ui/shell/shellStyles.test.ts && npm run format:check:changed`
Expected: exit 0.

---

### Task 6: Sidebar frame - top bar, side surface, zero-width collapse, reveal cluster, focus hand-off

**Files:**
- Create: `src/components/agentMode/AgentSidebarReveal.tsx`, `src/components/agentMode/AgentSidebarReveal.test.tsx`
- Create: `src/components/agentMode/useSidebarFocusHandoff.ts`, `src/components/agentMode/useSidebarFocusHandoff.test.tsx`
- Modify: `src/components/agentMode/AgentThreadsSidebar.tsx`, `src/components/agentMode/AgentThreadsSidebar.test.tsx`
- Modify: `src/components/agentMode/AgentThreadHeader.tsx` (new `leading` prop only; Task 7 rebuilds the header)
- Modify: `src/components/agentMode/AgentModeView.tsx`, `src/components/agentMode/AgentModeView.test.tsx`
- Modify: `src/components/agentMode/agentRail.css`, `src/components/agentMode/agentMode.css`, `src/components/workbenchShellFrame.css`
- Modify: `src/components/agentMode/agentModeResponsiveStyles.test.ts`, `src/components/windowChromeStyles.test.ts`

**Interfaces:**
- Consumes: `TopBar`, `TopBarSeparator` (Task 5), `IconButton` (P1), `agentControlTooltip`, `defaultAgentPanelLayoutShortcuts`, `AgentPanelLayoutShortcuts` with `sidebar`/`newThread` (Task 3), `AgentRailState`.
- Produces:
  - `EXPAND_SIDEBAR_LABEL = "Expand sidebar"`, `COLLAPSE_SIDEBAR_LABEL = "Collapse sidebar"`, `NEW_THREAD_LABEL = "New thread"` (exported from `AgentSidebarReveal.tsx`)
  - `AgentSidebarReveal({ shortcuts, detail?, onExpand, onNewThread })`
  - `useSidebarFocusHandoff(rail: AgentRailState, anchor: RefObject<HTMLElement | null>): void`
  - `AgentThreadsSidebarProps.collapseShortcut?: string | null`
  - `AgentThreadHeaderProps.leading?: ReactNode`

- [ ] **Step 1: Write the failing tests**

Create `src/components/agentMode/AgentSidebarReveal.test.tsx`:

```tsx
// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { click, mountUi, type MountedUi } from "../../ui/foundation/foundationTestSupport";
import { AgentSidebarReveal } from "./AgentSidebarReveal";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const SHORTCUTS = {
  bottomPanel: "Cmd+J",
  rightPanel: "Cmd+Alt+R",
  sidebar: "Cmd+B",
  newThread: "Cmd+N",
};

let mounted: MountedUi | null = null;

afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe("AgentSidebarReveal", () => {
  it("offers Expand sidebar and New thread with their chords, then a separator", () => {
    const onExpand = vi.fn();
    const onNewThread = vi.fn();
    mounted = mountUi();
    mounted.render(
      <AgentSidebarReveal onExpand={onExpand} onNewThread={onNewThread} shortcuts={SHORTCUTS} />,
    );

    const expand = mounted.host.querySelector<HTMLButtonElement>(
      'button[aria-label="Expand sidebar"]',
    );
    const newThread = mounted.host.querySelector<HTMLButtonElement>(
      'button[aria-label="New thread"]',
    );
    expect(expand?.title).toBe("Expand sidebar (⌘B)");
    expect(expand?.getAttribute("aria-expanded")).toBe("false");
    expect(newThread?.title).toBe("New thread (⌘N)");
    expect(mounted.host.querySelector(".cv-topbar__separator")).not.toBeNull();

    click(expand as HTMLButtonElement);
    click(newThread as HTMLButtonElement);

    expect(onExpand).toHaveBeenCalledTimes(1);
    expect(onNewThread).toHaveBeenCalledTimes(1);
  });

  it("appends a live detail to the expand tooltip", () => {
    mounted = mountUi();
    mounted.render(
      <AgentSidebarReveal
        detail="2 running · 1 needs attention"
        onExpand={vi.fn()}
        onNewThread={vi.fn()}
        shortcuts={SHORTCUTS}
      />,
    );

    expect(
      mounted.host.querySelector<HTMLButtonElement>('button[aria-label="Expand sidebar"]')?.title,
    ).toBe("Expand sidebar (⌘B) · 2 running · 1 needs attention");
  });
});
```

Create `src/components/agentMode/useSidebarFocusHandoff.test.tsx`:

```tsx
// @vitest-environment jsdom

import { useRef } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { mountUi, type MountedUi } from "../../ui/foundation/foundationTestSupport";
import type { AgentRailState } from "../../domain/agentWorkbenchLayout";
import { useSidebarFocusHandoff } from "./useSidebarFocusHandoff";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function Harness({ rail }: { readonly rail: AgentRailState }) {
  const anchor = useRef<HTMLElement | null>(null);
  useSidebarFocusHandoff(rail, anchor);
  return (
    <section ref={anchor}>
      {rail === "expanded" ? (
        <button aria-label="Collapse sidebar" type="button" />
      ) : (
        <button aria-label="Expand sidebar" type="button" />
      )}
      <textarea aria-label="Message" />
    </section>
  );
}

let mounted: MountedUi | null = null;

afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

function button(label: string): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
}

describe("useSidebarFocusHandoff", () => {
  it("moves lost focus from Collapse to Expand and back", () => {
    mounted = mountUi();
    mounted.render(<Harness rail="expanded" />);
    button("Collapse sidebar")?.focus();

    mounted.render(<Harness rail="collapsed" />);
    expect(document.activeElement).toBe(button("Expand sidebar"));

    mounted.render(<Harness rail="expanded" />);
    expect(document.activeElement).toBe(button("Collapse sidebar"));
  });

  it("never steals focus that is still on a live element", () => {
    mounted = mountUi();
    mounted.render(<Harness rail="expanded" />);
    const message = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]');
    message?.focus();

    mounted.render(<Harness rail="collapsed" />);

    expect(document.activeElement).toBe(message);
  });

  it("does nothing on the first render", () => {
    mounted = mountUi();
    mounted.render(<Harness rail="collapsed" />);

    expect(document.activeElement).toBe(document.body);
  });
});
```

In `src/components/agentMode/AgentModeView.test.tsx`:
- Replace the whole test "keeps the collapsed rail chrome a drag region and drops the rail separator" with:

```tsx
  it("drops the rail and its separator when collapsed and reveals it from the top bar", () => {
    const layout = recordedLayoutState({ rail: "collapsed" });
    render({
      agents: surface({ threads: [threadView({ threadId: "agt-1" })] }),
      chrome: chromeFixture({ layout }),
    });

    expect(host.querySelector('[aria-label="Resize thread rail"]')).toBeNull();
    expect(host.querySelector('aside[aria-label="Agent threads"]')).toBeNull();
    const expand = host.querySelector<HTMLButtonElement>(
      '[data-agent-thread-head] button[aria-label="Expand sidebar"]',
    );
    expect(expand).not.toBeNull();
    expect(host.querySelector('[data-agent-thread-head] button[aria-label="New thread"]')).not.toBeNull();

    click('[data-agent-thread-head] button[aria-label="Expand sidebar"]');

    expect(layout.actions).toEqual([{ kind: "toggleRail" }]);
  });
```

- In "collapses the rail behind a slim expand affordance", after the first `click('[aria-label="Collapse sidebar"]');` + re-render, add `expect(document.activeElement).toBe(host.querySelector('button[aria-label="Expand sidebar"]'));` and after the expand re-render add `expect(document.activeElement).toBe(host.querySelector('button[aria-label="Collapse sidebar"]'));`.

In `src/components/agentMode/AgentThreadsSidebar.test.tsx`:
- "hands the rail chrome row to the window as a drag region": replace `host.querySelector(".agent-rail__chrome")` with `host.querySelector(".cv-topbar--sidebar")` and `.toBe("")` with `.toBe("deep")`.
- "pins the Airy rail metrics ...": replace `expect(cssRule("\n.agent-rail {")).toContain("background: var(--codevo-canvas)");` with `expect(cssRule("\n.agent-rail {")).toContain("background: var(--cv-side)");`, replace `expect(cssRule("\n.agent-rail {")).not.toContain("border");` with `expect(cssRule("\n.agent-rail {")).toContain("box-shadow: var(--cv-edge-end-divider)");`, and replace `expect(cssRule("\n.agent-rail__chrome {")).toContain("height: 44px");` with `expect(AGENT_MODE_CSS).not.toContain(".agent-rail__chrome");` (rename the test to "pins the rail frame and the scaled 78px cards").
- Add to the default `render` props `collapseShortcut: "Cmd+B",` and a new test:

```tsx
  it("puts the collapse control in the sidebar top bar with its chord", () => {
    render();

    const collapse = host.querySelector<HTMLButtonElement>(
      '.cv-topbar--sidebar button[aria-label="Collapse sidebar"]',
    );
    expect(collapse?.title).toBe("Collapse sidebar (⌘B)");
    expect(collapse?.getAttribute("aria-expanded")).toBe("true");
  });
```

In `src/components/agentMode/agentModeResponsiveStyles.test.ts` replace every selector string `".agent-mode__grid > .agent-rail,\n  .agent-mode__grid > .agent-rail__chrome"` and `".agent-mode__grid > .agent-rail,\n.agent-mode__grid > .agent-rail__chrome"` with `".agent-mode__grid > .agent-rail"`, and the `{`-suffixed variant with `".agent-mode__grid > .agent-rail {"`.

In `src/components/windowChromeStyles.test.ts`, in "reserves the traffic-light space in the rail, the header and the settings sidebar", delete the two `railCss` assertions and the `railCss` constant (the header and settings assertions stay until Task 7).

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/components/agentMode/AgentSidebarReveal.test.tsx src/components/agentMode/useSidebarFocusHandoff.test.tsx src/components/agentMode/AgentThreadsSidebar.test.tsx src/components/agentMode/AgentModeView.test.tsx`
Expected: FAIL - missing modules, no `.cv-topbar--sidebar`, collapsed layout still renders `.agent-rail__chrome`.

- [ ] **Step 3: Implement the reveal cluster and the focus hand-off**

Create `src/components/agentMode/AgentSidebarReveal.tsx`:

```tsx
import { PanelLeftOpen, SquarePen } from "lucide-react";
import { IconButton } from "../../ui/foundation/IconButton";
import { TopBarSeparator } from "../../ui/shell/TopBar";
import {
  agentControlTooltip,
  defaultAgentPanelLayoutShortcuts,
  type AgentPanelLayoutShortcuts,
} from "./agentThreadHeaderPresentation";

export const EXPAND_SIDEBAR_LABEL = "Expand sidebar";
export const COLLAPSE_SIDEBAR_LABEL = "Collapse sidebar";
export const NEW_THREAD_LABEL = "New thread";

export interface AgentSidebarRevealProps {
  readonly shortcuts: AgentPanelLayoutShortcuts | null;
  readonly detail?: string | null;
  onExpand(): void;
  onNewThread(): void;
}

export function AgentSidebarReveal({
  detail = null,
  onExpand,
  onNewThread,
  shortcuts,
}: AgentSidebarRevealProps) {
  const chords = shortcuts ?? defaultAgentPanelLayoutShortcuts();
  const expandTitle = agentControlTooltip(EXPAND_SIDEBAR_LABEL, chords.sidebar);
  return (
    <>
      <IconButton
        aria-expanded={false}
        icon={<PanelLeftOpen size={16} />}
        label={EXPAND_SIDEBAR_LABEL}
        onClick={onExpand}
        title={detail === null ? expandTitle : `${expandTitle} · ${detail}`}
      />
      <IconButton
        icon={<SquarePen size={16} />}
        label={NEW_THREAD_LABEL}
        onClick={onNewThread}
        title={agentControlTooltip(NEW_THREAD_LABEL, chords.newThread)}
      />
      <TopBarSeparator />
    </>
  );
}
```

Create `src/components/agentMode/useSidebarFocusHandoff.ts`:

```ts
import { useLayoutEffect, useRef, type RefObject } from "react";
import type { AgentRailState } from "../../domain/agentWorkbenchLayout";
import { COLLAPSE_SIDEBAR_LABEL, EXPAND_SIDEBAR_LABEL } from "./AgentSidebarReveal";

export function useSidebarFocusHandoff(
  rail: AgentRailState,
  anchor: RefObject<HTMLElement | null>,
): void {
  const previous = useRef(rail);

  useLayoutEffect(() => {
    if (previous.current === rail) return;
    previous.current = rail;
    const doc = anchor.current?.ownerDocument;
    if (doc === undefined) return;
    const active = doc.activeElement;
    if (active !== null && active !== doc.body && active.isConnected) return;
    const label = rail === "collapsed" ? EXPAND_SIDEBAR_LABEL : COLLAPSE_SIDEBAR_LABEL;
    doc.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)?.focus();
  }, [anchor, rail]);
}
```

- [ ] **Step 4: Wire the sidebar top bar**

In `src/components/agentMode/AgentThreadsSidebar.tsx`:
- Imports: add `import { IconButton } from "../../ui/foundation/IconButton";`, `import { TopBar } from "../../ui/shell/TopBar";`, `import { COLLAPSE_SIDEBAR_LABEL } from "./AgentSidebarReveal";`, `import { agentControlTooltip, defaultAgentPanelLayoutShortcuts } from "./agentThreadHeaderPresentation";`.
- Props interface: add `readonly collapseShortcut?: string | null;` and destructure `collapseShortcut = null`.
- Replace the whole `<div className="agent-rail__chrome" data-tauri-drag-region="">...</div>` block with:

```tsx
      <TopBar
        label="Sidebar"
        region="sidebar"
        trailing={
          <IconButton
            aria-expanded
            icon={<PanelLeftClose size={16} />}
            label={COLLAPSE_SIDEBAR_LABEL}
            onClick={() => onCollapseSidebar?.()}
            title={agentControlTooltip(
              COLLAPSE_SIDEBAR_LABEL,
              collapseShortcut ?? defaultAgentPanelLayoutShortcuts().sidebar,
            )}
          />
        }
      />
```

In `src/components/agentMode/AgentThreadHeader.tsx` (interim; Task 7 rebuilds it): add `readonly leading?: ReactNode;` to `AgentThreadHeaderProps` (import `type ReactNode` from `react`) and render `{props.leading}` as the first child of the `<header>` element, before `<nav>`.

- [ ] **Step 5: Wire AgentModeView**

In `src/components/agentMode/AgentModeView.tsx`:
- Imports: remove `PanelLeftOpen` from `lucide-react`; add `import { AgentSidebarReveal } from "./AgentSidebarReveal";` and `import { useSidebarFocusHandoff } from "./useSidebarFocusHandoff";`; add `useRef` to the React import.
- After `const { layout, openSurface, toggleMaximized, toggleRail, toggleRightPanel } = surface;` add:

```tsx
  const sectionRef = useRef<HTMLElement | null>(null);
  useSidebarFocusHandoff(layout.rail, sectionRef);
  const sidebarReveal = (
    <AgentSidebarReveal
      onExpand={toggleRail}
      onNewThread={newProjectThread}
      shortcuts={chrome.shortcuts}
    />
  );
```

  (place it after `newProjectThread` is declared.)
- Add `ref={sectionRef}` to `<section aria-label="Agent mode" ...>`.
- Replace the rail ternary `{layout.rail === "collapsed" ? (<div className="agent-rail__chrome" ...>...</div>) : (<AgentThreadsSidebar ... />)}` with `{layout.rail === "collapsed" ? null : (<AgentThreadsSidebar ... />)}` keeping every existing `AgentThreadsSidebar` prop and adding `collapseShortcut={chrome.shortcuts?.sidebar ?? null}`.
- On `<AgentThreadHeader ...>` add `leading={layout.rail === "collapsed" && !layout.rightPanelMaximized ? sidebarReveal : null}`.

- [ ] **Step 6: Rail CSS**

In `src/components/agentMode/agentRail.css`:
- Replace the `.agent-rail {` rule with:

```css
.agent-rail {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: min(var(--agent-rail-min-width), 100%);
  min-height: 0;
  padding: 0 6px 8px;
  background: var(--cv-side);
  box-shadow: var(--cv-edge-end-divider);
}

.agent-rail > .cv-topbar--sidebar {
  margin: 0 -6px;
}
```

- Delete the rules `.agent-rail__chrome { ... }`, `.agent-rail > .agent-rail__chrome { ... }` and `.agent-mode__grid > .agent-rail__chrome { ... }`; change the selector `.agent-mode__grid > .agent-rail,\n.agent-mode__grid > .agent-rail__chrome` to `.agent-mode__grid > .agent-rail`.
- In `.agent-rail-resize::before` set `left: 3px;` and `width: 2px;`; replace the body of `.agent-rail-resize:hover::before, .agent-rail-resize:active::before, .agent-rail-resize:focus-visible::before` with `background: var(--cv-accent);`, and in its `transition` use `background-color var(--cv-motion-base) var(--cv-ease)`.

In `src/components/agentMode/agentMode.css` change both selector lists `.agent-mode__grid > .agent-rail,\n.agent-mode__grid > .agent-rail__chrome` (top level and inside `@media (max-width: 720px)`) to `.agent-mode__grid > .agent-rail`.

In `src/components/workbenchShellFrame.css`, in the last `@media (max-width: 720px)` block, change the selector list to only `.workbench-frame[data-layout="agent"][data-right-panel="overlay"] .agent-rail`.

- [ ] **Step 7: Run the focused tests**

Run: `npx vitest run src/components/agentMode src/components/windowChromeStyles.test.ts src/components/workbenchShellFrame.expanded.test.ts src/startupDocument.test.ts`
Expected: PASS. Any remaining failure that only names `.agent-rail__chrome` must be updated to the TopBar (`.cv-topbar--sidebar`); nothing else.

- [ ] **Step 8: Format**

Run: `npx prettier --write src/components/agentMode/AgentSidebarReveal.tsx src/components/agentMode/AgentSidebarReveal.test.tsx src/components/agentMode/useSidebarFocusHandoff.ts src/components/agentMode/useSidebarFocusHandoff.test.tsx && npm run format:check:changed`
Expected: exit 0.

---

### Task 7: Main top bar - breadcrumb, hover actions, always-visible panel toggles

**Files:**
- Modify: `src/components/agentMode/AgentThreadHeader.tsx`, `src/components/agentMode/AgentThreadHeader.test.tsx`
- Modify: `src/components/agentMode/AgentPanelLayoutControls.tsx`, `src/components/agentMode/AgentPanelLayoutControls.test.tsx`
- Modify: `src/components/agentMode/agentThread.css` (delete header blocks), `src/components/agentMode/agentThreadStyles.test.ts` (header `it` block only)
- Modify: `src/components/agentMode/agentMode.css` (crumb glue), `src/components/windowChromeStyles.test.ts`, `src/components/agentMode/agentModeResponsiveStyles.test.ts`, `src/components/agentMode/AgentModeView.test.tsx`

**Interfaces:**
- Consumes: `TopBar`, `TopBarSeparator`, `ProjectFavicon` (Task 5), `IconButton`.
- Produces:
  - `AgentThreadHeaderProps.leading?: ReactNode`, `AgentThreadHeaderProps.trailingExtras?: ReactNode` (P4 agents toggle)
  - `AgentPanelLayoutControlsProps { bottomPanelOpen; rightPanelOpen; shortcuts; onToggleBottomPanel(); onToggleRightPanel() }` (no `maximize` any more)
  - `AgentPanelWindowControls({ maximize: AgentPanelMaximizeControl; onClose(): void })`, `AGENT_PANEL_CLOSE_LABEL = "Close panel"`

- [ ] **Step 1: Write the failing tests**

`src/components/agentMode/AgentPanelLayoutControls.test.tsx`: replace the test "shows the maximize toggle only when a maximize control is given" with a new `describe`:

```tsx
describe("AgentPanelWindowControls", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("maximizes, restores and closes the panel", () => {
    const onToggle = vi.fn();
    const onClose = vi.fn();
    act(() =>
      root.render(
        <AgentPanelWindowControls maximize={{ maximized: false, onToggle }} onClose={onClose} />,
      ),
    );
    const maximize = host.querySelector<HTMLButtonElement>('button[aria-label="Maximize panel"]');
    expect(maximize?.getAttribute("aria-pressed")).toBe("false");
    act(() => maximize?.click());
    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Close panel"]')?.click());

    act(() =>
      root.render(
        <AgentPanelWindowControls maximize={{ maximized: true, onToggle }} onClose={onClose} />,
      ),
    );
    const restore = host.querySelector<HTMLButtonElement>('button[aria-label="Restore panel"]');
    expect(restore?.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector('button[aria-label="Maximize panel"]')).toBeNull();
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
```

(import `AgentPanelWindowControls` next to `AgentPanelLayoutControls`.)

`src/components/agentMode/AgentThreadHeader.test.tsx`:
- In "hands blank breadcrumb and action areas to the native window ..." replace the selector list with `['[aria-label="Thread breadcrumb"]', ".agent-crumbs__sep", ".cv-topbar__title", ".cv-topbar__actions", ".cv-topbar__trailing", "[data-panel-layout-controls]"]`.
- Replace "shows the layout toggles only while the right panel is closed" with:

```tsx
  it("keeps the layout toggles visible and mirrors the panel states in aria-pressed", () => {
    render({});
    expect(button("Toggle terminal panel (⌘J)").getAttribute("aria-pressed")).toBe("false");
    expect(button("Toggle right panel (⌥⌘R)").getAttribute("aria-pressed")).toBe("false");

    render({ bottomPanelOpen: true });
    expect(button("Toggle terminal panel (⌘J)").getAttribute("aria-pressed")).toBe("true");

    render({
      layout: {
        ...initialAgentWorkbenchLayout,
        rightPanel: "open",
        openSurfaces: ["files"],
        activeSurface: "files",
      },
    });
    expect(host.querySelector("[data-panel-layout-controls]")).not.toBeNull();
    expect(button("Toggle right panel (⌥⌘R)").getAttribute("aria-pressed")).toBe("true");
  });
```

- In "keeps the terminal sessions entry in the New thread state, left of the layout toggles" delete the line asserting `.agent-thread-head__divider`.
- Replace "keeps the terminal sessions entry while the layout toggles move to the right panel" with:

```tsx
  it("keeps the terminal sessions entry and the toggles while the right panel is open", () => {
    render({ layout: { ...initialAgentWorkbenchLayout, rightPanel: "open" } });

    expect(button("Terminal sessions").disabled).toBe(false);
    expect(host.querySelector("[data-panel-layout-controls]")).not.toBeNull();
  });
```

- Add:

```tsx
  it("shows the project favicon, hides secondary actions until hover and keeps Commit visible", () => {
    render({});

    expect(host.querySelector(".agent-crumbs__project .cv-favicon")?.textContent).toBe("A");
    const actions = host.querySelector(".cv-topbar__actions");
    expect(actions?.contains(button("Run dev"))).toBe(true);
    expect(actions?.contains(button("Open in Editor"))).toBe(true);
    expect(actions?.contains(button("Terminal sessions"))).toBe(true);
    expect(host.querySelector(".cv-topbar__trailing")?.contains(button("Commit"))).toBe(true);
    expect(host.querySelector("header")?.className).toContain("cv-topbar--window-edge");
  });

  it("renders the leading cluster and trailing extras in their slots", () => {
    render({
      leading: <button aria-label="Expand sidebar" type="button" />,
      trailingExtras: <button aria-label="Toggle agents panel" type="button" />,
    });

    expect(host.querySelector(".cv-topbar__leading")?.contains(button("Expand sidebar"))).toBe(
      true,
    );
    const trailing = host.querySelector(".cv-topbar__trailing");
    const extras = button("Toggle agents panel");
    expect(trailing?.contains(extras)).toBe(true);
    expect(
      extras.compareDocumentPosition(host.querySelector("[data-panel-layout-controls]") as Node),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });
```

`src/components/agentMode/AgentModeView.test.tsx`, line with `expect(host.querySelector("[data-agent-thread-head] [data-panel-layout-controls]")).toBeNull();`: replace with

```tsx
    expect(
      host
        .querySelector('[data-agent-thread-head] button[aria-label^="Toggle right panel"]')
        ?.getAttribute("aria-pressed"),
    ).toBe("true");
```

and line `'.agent-thread-head button[aria-label="Terminal sessions"]'` -> `'[data-agent-thread-head] button[aria-label="Terminal sessions"]'`.

`src/components/agentMode/agentThreadStyles.test.ts`: replace the five `.agent-thread-head` assertions (border-bottom, border, box-shadow, min-height, padding) with:

```ts
    expect(winningDeclaration(".agent-thread-head", "padding")).toBeNull();
    expect(winningDeclaration(".agent-thread-head", "min-height")).toBeNull();
```

`src/components/windowChromeStyles.test.ts`: in "reserves the traffic-light space ..." delete the `threadCss` constant and its `.agent-thread-head` assertion (the TopBar formula is pinned in `src/ui/shell/shellStyles.test.ts`); rename the test to "reserves the traffic-light space in the settings sidebar".

`src/components/agentMode/agentModeResponsiveStyles.test.ts`: delete the two assertions that read `rule(".agent-thread-head", ...)` padding under the narrow container queries (lines asserting `padding-left: 8px` and `padding-inline: 8px`).

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/components/agentMode/AgentThreadHeader.test.tsx src/components/agentMode/AgentPanelLayoutControls.test.tsx`
Expected: FAIL - `AgentPanelWindowControls` not exported, toggles hidden when open, no `.cv-topbar__*` slots.

- [ ] **Step 3: Rebuild AgentPanelLayoutControls**

Replace the body of `src/components/agentMode/AgentPanelLayoutControls.tsx` with:

```tsx
import { Maximize2, Minimize2, PanelBottom, PanelRight, X } from "lucide-react";
import { IconButton } from "../../ui/foundation/IconButton";
import {
  agentControlTooltip,
  defaultAgentPanelLayoutShortcuts,
  type AgentPanelLayoutShortcuts,
} from "./agentThreadHeaderPresentation";

export type { AgentPanelLayoutShortcuts } from "./agentThreadHeaderPresentation";

export const AGENT_PANEL_MAXIMIZE_LABEL = "Maximize panel";
export const AGENT_PANEL_RESTORE_LABEL = "Restore panel";
export const AGENT_PANEL_CLOSE_LABEL = "Close panel";

export interface AgentPanelMaximizeControl {
  readonly maximized: boolean;
  onToggle(): void;
}

export interface AgentPanelLayoutControlsProps {
  readonly bottomPanelOpen: boolean;
  readonly rightPanelOpen: boolean;
  readonly shortcuts: AgentPanelLayoutShortcuts | null;
  onToggleBottomPanel(): void;
  onToggleRightPanel(): void;
}

export function AgentPanelLayoutControls({
  bottomPanelOpen,
  onToggleBottomPanel,
  onToggleRightPanel,
  rightPanelOpen,
  shortcuts,
}: AgentPanelLayoutControlsProps) {
  const chords = shortcuts ?? defaultAgentPanelLayoutShortcuts();
  return (
    <div className="cv-panel-toggles" data-panel-layout-controls="">
      <IconButton
        icon={<PanelBottom size={16} />}
        label={agentControlTooltip("Toggle terminal panel", chords.bottomPanel)}
        onClick={onToggleBottomPanel}
        pressed={bottomPanelOpen}
      />
      <IconButton
        icon={<PanelRight size={16} />}
        label={agentControlTooltip("Toggle right panel", chords.rightPanel)}
        onClick={onToggleRightPanel}
        pressed={rightPanelOpen}
      />
    </div>
  );
}

export interface AgentPanelWindowControlsProps {
  readonly maximize: AgentPanelMaximizeControl;
  onClose(): void;
}

export function AgentPanelWindowControls({ maximize, onClose }: AgentPanelWindowControlsProps) {
  const label = maximize.maximized ? AGENT_PANEL_RESTORE_LABEL : AGENT_PANEL_MAXIMIZE_LABEL;
  const Icon = maximize.maximized ? Minimize2 : Maximize2;
  return (
    <div className="cv-panel-window-controls" data-panel-window-controls="">
      <IconButton
        icon={<Icon size={16} />}
        label={label}
        onClick={maximize.onToggle}
        pressed={maximize.maximized}
      />
      <IconButton icon={<X size={16} />} label={AGENT_PANEL_CLOSE_LABEL} onClick={onClose} />
    </div>
  );
}
```

- [ ] **Step 4: Rebuild the header on TopBar**

In `src/components/agentMode/AgentThreadHeader.tsx`:
- Imports: drop `Folder`; keep `ChevronDown`, `History`; add `type ReactNode` to the React import; add `import { IconButton } from "../../ui/foundation/IconButton";`, `import { ProjectFavicon } from "../../ui/shell/ProjectFavicon";`, `import { TopBar, TopBarSeparator } from "../../ui/shell/TopBar";`.
- Props: keep `leading?: ReactNode` (Task 6) and add `readonly trailingExtras?: ReactNode;`.
- Replace everything from `return (` to the end of the component's JSX with:

```tsx
  const terminalSessions = (
    <TerminalSessionsButton onOpen={remote ? null : props.onOpenTerminalSessions} remote={remote} />
  );
  const actions =
    thread === null ? (
      terminalSessions
    ) : (
      <>
        <AgentScriptRunControl onOpenScriptsView={props.onOpenScriptsView} scripts={props.scripts} />
        <AgentOpenMenu
          onCopyPath={() =>
            onThreadMenuCommand(thread.thread.threadId, { kind: "copy", detail: "path" })
          }
          onOpenSurface={props.onOpenSurface}
          onRevealFailed={props.onRevealFailed}
          onRevealPath={props.onRevealPath}
          target={{
            path: thread.thread.target.worktreePath ?? thread.thread.owner.repositoryRoot,
            missing: thread.worktreeMissing,
            blockedReason: remote ? AGENT_OPEN_REMOTE_REASON : null,
          }}
        />
        {terminalSessions}
      </>
    );
  const trailing = (
    <>
      {thread === null ? null : (
        <>
          <AgentCommitMenu
            actions={props.shipActions}
            openSignal={props.commitMenuOpenSignal}
            thread={thread}
          />
          <TopBarSeparator />
        </>
      )}
      {props.trailingExtras ?? null}
      <AgentPanelLayoutControls
        bottomPanelOpen={props.bottomPanelOpen}
        onToggleBottomPanel={props.onToggleBottomPanel}
        onToggleRightPanel={props.onToggleRightPanel}
        rightPanelOpen={layout.rightPanel === "open"}
        shortcuts={props.shortcuts}
      />
    </>
  );

  return (
    <TopBar
      actions={actions}
      className="agent-thread-head"
      data-agent-thread-head=""
      label="Thread"
      leading={props.leading}
      region="main"
      trailing={trailing}
      windowEdge
    >
      <nav
        aria-label="Thread breadcrumb"
        className="agent-crumbs cv-crumb"
        onContextMenu={onContextMenu}
      >
        <button
          aria-label={projectLabel === null ? "New thread" : `New thread in ${projectLabel}`}
          className="agent-crumbs__project cv-crumb__project"
          disabled={project === null}
          onClick={startNewThread}
          title={project?.repositoryRoot ?? undefined}
          type="button"
        >
          <ProjectFavicon label={projectLabel ?? ""} />
          <span className="agent-crumbs__label cv-crumb__label">{projectLabel ?? "No project"}</span>
        </button>
        <span aria-hidden="true" className="agent-crumbs__sep cv-crumb__sep">
          /
        </span>
        {thread !== null && renaming ? (
          <RenameInput
            initial={thread.thread.title}
            onCancel={() => setRenaming(false)}
            onCommit={commitRename}
          />
        ) : (
          <button
            aria-current="page"
            aria-expanded={menuAnchor !== null}
            aria-haspopup="menu"
            aria-label={`Thread actions for ${title}`}
            className="agent-crumbs__title cv-crumb__here"
            disabled={thread === null}
            onClick={openMenuBelowTitle}
            ref={titleRef}
            title={title}
            type="button"
          >
            <h2 className="agent-crumbs__heading cv-crumb__heading">{title}</h2>
            <ChevronDown
              aria-hidden="true"
              className="agent-crumbs__chevron cv-crumb__chevron"
              size={14}
            />
          </button>
        )}
        {remote && <RemoteThreadIndicator />}
        {importedLabel !== null && (
          <span className="agent-microlabel" title="Imported terminal session">
            {importedLabel}
          </span>
        )}
      </nav>
      {thread !== null && menuAnchor !== null && (
        <AgentThreadRowMenu
          archived={thread.thread.archived}
          snoozed={(thread.thread.snoozedUntil ?? 0) > Date.now()}
          settled={thread.thread.settledAt != null}
          canMarkUnread={agentViewCanMarkUnread(thread)}
          branch={agentShipBranchLabel(thread.ship)}
          onClose={closeMenu}
          onCommand={(command) => onThreadMenuCommand(thread.thread.threadId, command)}
          onRename={() => setRenaming(true)}
          pinned={thread.thread.pinned}
          position={menuAnchor}
          running={runningTurn(thread.thread) !== null}
          threadId={thread.thread.threadId}
        />
      )}
    </TopBar>
  );
```

Replace `TerminalSessionsButton` with:

```tsx
function TerminalSessionsButton({
  onOpen,
  remote,
}: {
  readonly onOpen: (() => void) | null;
  readonly remote: boolean;
}) {
  return (
    <IconButton
      disabled={onOpen === null}
      icon={<History size={16} />}
      label={AGENT_TERMINAL_SESSIONS_LABEL}
      onClick={onOpen ?? undefined}
      title={
        remote
          ? "Importing terminal sessions from this server is not available yet"
          : AGENT_TERMINAL_SESSIONS_LABEL
      }
    />
  );
}
```

In `src/components/agentMode/AgentModeView.tsx` update the `layoutControls` memo to the window controls (the header now renders its own toggles):

```tsx
  const layoutControls = useMemo(
    () => (
      <AgentPanelWindowControls
        maximize={{
          maximized: layout.rightPanelMaximized || responsivePanelRestore !== "none",
          onToggle: toggleResponsivePanel,
        }}
        onClose={toggleRightPanel}
      />
    ),
    [layout.rightPanelMaximized, responsivePanelRestore, toggleResponsivePanel, toggleRightPanel],
  );
```

and change the import `AgentPanelLayoutControls` -> `AgentPanelWindowControls`.

- [ ] **Step 5: Delete the legacy header CSS and add the crumb glue**

In `src/components/agentMode/agentThread.css` delete these rule blocks completely: `.agent-thread-head`, `.agent-crumbs`, `.agent-crumbs__project, .agent-crumbs__title`, `.agent-crumbs__project`, `.agent-crumbs__project:hover...`, `.agent-crumbs__project:disabled...`, `.agent-crumbs__project:focus-visible...`, `.agent-crumbs__label, .agent-crumbs__heading`, `.agent-crumbs__sep`, `.agent-crumbs__title`, `.agent-crumbs__heading`, `.agent-crumbs__chevron`, `.agent-crumbs__title:hover .agent-crumbs__chevron...`, `.agent-crumbs .agent-row__rename`, `.agent-thread-head__actions`, `.agent-thread-head__tools`, `.agent-thread-head__tools .agent-layout-controls`, `.agent-thread-head__divider`, `.agent-layout-controls`, `.agent-icon-toggle` and every `.agent-icon-toggle:*` rule; inside `@container agent-center (max-width: 600px)` delete the `.agent-thread-head` and `.agent-thread-head__actions` rules (drop the at-rule if it becomes empty); inside `@container agent-center (max-width: 420px)` delete the `.agent-crumbs__label, .agent-crumbs__sep` and `.agent-crumbs__project` rules (drop the at-rule if empty).

In `src/components/agentMode/agentSurface.css` delete `.agent-surface__layout-controls .agent-icon-toggle { ... }` (its only user is gone).

Append to `src/components/agentMode/agentMode.css`:

```css
.cv-crumb .agent-row__rename {
  flex: 1;
  min-width: 120px;
  max-width: 420px;
}

@container agent-center (max-width: 420px) {
  .cv-crumb__label,
  .cv-crumb__sep {
    display: none;
  }
}
```

In `src/components/agentMode/AgentSurfacePanel.test.tsx`, delete the assertion that reads `.agent-surface__layout-controls .agent-icon-toggle {` (around line 629).

- [ ] **Step 6: Run the focused tests**

Run: `npx vitest run src/components/agentMode src/components/windowChromeStyles.test.ts src/ui/shell`
Expected: PASS.

- [ ] **Step 7: Format**

Run: `npm run format:check:changed`
Expected: exit 0 (prettier-write only listed files).

---

### Task 8: Right panel frame - panel top bar, keyboard resize, maximize keeps the conversation mounted

**Files:**
- Create: `src/components/agentMode/agentSurfaceResize.ts`, `src/components/agentMode/agentSurfaceResize.test.ts`
- Modify: `src/components/agentMode/AgentSurfacePanel.tsx`, `src/components/agentMode/AgentSurfacePanel.test.tsx`
- Modify: `src/components/agentMode/AgentSurfaceHost.tsx`
- Modify: `src/components/agentMode/useAgentSurfaceLayout.ts`
- Modify: `src/components/agentMode/AgentModeView.tsx`, `src/components/agentMode/AgentModeView.test.tsx`
- Modify: `src/components/agentMode/agentSurface.css`, `src/components/workbenchShellFrame.css`, `src/components/workbenchShellFrame.expanded.test.ts`, `src/components/windowChromeStyles.test.ts`, `src/components/agentMode/agentModeResponsiveStyles.test.ts`

**Interfaces:**
- Consumes: `TopBar` (Task 5), `AgentPanelWindowControls` (Task 7), `AgentSidebarReveal` (Task 6), `MIN/MAX/DEFAULT_AGENT_RIGHT_PANEL_WIDTH`.
- Produces:
  - `AGENT_PANEL_RESIZE_STEP = 16`, `panelWidthForKey(key: string, width: number): number | null`
  - `AgentSurfaceLayout.resizeRightPanel(width: number): void`
  - `AgentSurfaceHostProps.leadingControls?: ReactNode`, `AgentSurfaceHostProps.onResizeWidth?: (width: number) => void` (same names on `AgentSurfacePanelProps`)
  - `--agent-surface-header-height: var(--cv-topbar-h)`

- [ ] **Step 1: Write the failing tests**

Create `src/components/agentMode/agentSurfaceResize.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  DEFAULT_AGENT_RIGHT_PANEL_WIDTH,
  MAX_AGENT_RIGHT_PANEL_WIDTH,
  MIN_AGENT_RIGHT_PANEL_WIDTH,
} from "../../domain/agentWorkbenchLayout";
import { AGENT_PANEL_RESIZE_STEP, panelWidthForKey } from "./agentSurfaceResize";

describe("panelWidthForKey", () => {
  it("grows the right-docked panel with ArrowLeft and shrinks it with ArrowRight", () => {
    expect(panelWidthForKey("ArrowLeft", 540)).toBe(540 + AGENT_PANEL_RESIZE_STEP);
    expect(panelWidthForKey("ArrowRight", 540)).toBe(540 - AGENT_PANEL_RESIZE_STEP);
  });

  it("jumps to the bounds and resets to the default", () => {
    expect(panelWidthForKey("Home", 700)).toBe(MIN_AGENT_RIGHT_PANEL_WIDTH);
    expect(panelWidthForKey("End", 700)).toBe(MAX_AGENT_RIGHT_PANEL_WIDTH);
    expect(panelWidthForKey("Enter", 700)).toBe(DEFAULT_AGENT_RIGHT_PANEL_WIDTH);
    expect(panelWidthForKey(" ", 700)).toBe(DEFAULT_AGENT_RIGHT_PANEL_WIDTH);
  });

  it("ignores other keys", () => {
    expect(panelWidthForKey("ArrowUp", 540)).toBeNull();
    expect(panelWidthForKey("a", 540)).toBeNull();
  });
});
```

Add to `src/components/agentMode/AgentSurfacePanel.test.tsx` (inside its `describe`, using its `render` and `open(surfaces, active)` helpers; add `onResizeWidth` and `leadingControls` to the helper's accepted overrides if its props type is narrower):

```tsx
  it("resizes from the keyboard and exposes the committed width", () => {
    const onResizeWidth = vi.fn();
    render({ layout: { ...open(["diff"], "diff"), rightPanelWidth: 600 }, onResizeWidth });

    const separator = host.querySelector<HTMLElement>('[role="separator"][aria-label="Resize right panel"]');
    expect(separator?.tabIndex).toBe(0);
    expect(separator?.getAttribute("aria-valuenow")).toBe("600");
    expect(separator?.getAttribute("aria-valuemin")).toBe("360");
    expect(separator?.getAttribute("aria-valuemax")).toBe("1200");

    act(() => {
      separator?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowLeft" }));
      separator?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "End" }));
      separator?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowUp" }));
    });

    expect(onResizeWidth.mock.calls.map(([width]) => width)).toEqual([616, 1200]);
  });

  it("clears the traffic lights and hosts the sidebar reveal only when maximized", () => {
    render({
      layout: { ...open(["diff"], "diff"), rightPanelMaximized: true },
      leadingControls: <button aria-label="Expand sidebar" type="button" />,
    });

    const header = host.querySelector("[data-agent-surface-head]");
    expect(header?.className).toContain("cv-topbar--panel");
    expect(header?.className).toContain("cv-topbar--window-edge");
    expect(header?.querySelector('.cv-topbar__leading button[aria-label="Expand sidebar"]')).not.toBeNull();

    render({ layout: open(["diff"], "diff") });
    expect(host.querySelector("[data-agent-surface-head]")?.className).not.toContain(
      "cv-topbar--window-edge",
    );
  });
```

In the same file change `host.querySelector(".agent-surface__layout-controls [data-layout-control]")` to `host.querySelector(".cv-topbar__trailing [data-layout-control]")`.

Add to `src/components/agentMode/AgentModeView.test.tsx`:

```tsx
  it("keeps the conversation mounted but inert while the panel is maximized", () => {
    const layout = recordedLayoutState({
      rightPanel: "open",
      openSurfaces: ["diff"],
      activeSurface: "diff",
      rightPanelMaximized: true,
    });
    render({
      agents: surface({ threads: [threadView({ threadId: "agt-1" })] }),
      chrome: chromeFixture({ layout }),
    });

    const center = host.querySelector(".agent-mode__center");
    expect(center).not.toBeNull();
    expect(center?.hasAttribute("inert")).toBe(true);
    expect(center?.querySelector("[data-agent-thread-head]")).not.toBeNull();
  });

  it("moves the sidebar reveal into the panel bar when the collapsed sidebar meets a maximized panel", () => {
    const layout = recordedLayoutState({
      rail: "collapsed",
      rightPanel: "open",
      openSurfaces: ["diff"],
      activeSurface: "diff",
      rightPanelMaximized: true,
    });
    render({
      agents: surface({ threads: [threadView({ threadId: "agt-1" })] }),
      chrome: chromeFixture({ layout }),
    });

    expect(host.querySelectorAll('button[aria-label="Expand sidebar"]')).toHaveLength(1);
    expect(
      document.querySelector('[data-agent-surface-head] button[aria-label="Expand sidebar"]'),
    ).not.toBeNull();
  });
```

(If `AgentSurfaceHost` renders outside `host` in that test harness, query `document` in both assertions.)

- `src/components/workbenchShellFrame.expanded.test.ts`: `expect(tokens.get("--agent-surface-header-height")).toBe("40px");` -> `.toBe("var(--cv-topbar-h)")`; in "paints the surfaces with tone steps only" `.toBe("var(--codevo-canvas)")` for `.agent-surface` -> `.toBe("var(--cv-canvas)")`.
- `src/components/windowChromeStyles.test.ts`: delete the test "keeps the maximized surface header clear of the traffic lights" (pinned now by the TopBar formula and the AgentSurfacePanel test above).
- `src/components/agentMode/agentModeResponsiveStyles.test.ts`, in "composes the collapsed rail with the maximized panel ...": replace `.toContain("display: none")` for `.agent-mode__center` with `.toContain("visibility: hidden")` and the grid expectation with `.toContain("grid-template-columns: var(--agent-rail-track) 0px")`.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/components/agentMode/agentSurfaceResize.test.ts src/components/agentMode/AgentSurfacePanel.test.tsx src/components/agentMode/AgentModeView.test.tsx src/components/workbenchShellFrame.expanded.test.ts src/components/agentMode/agentModeResponsiveStyles.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/components/agentMode/agentSurfaceResize.ts`:

```ts
import {
  DEFAULT_AGENT_RIGHT_PANEL_WIDTH,
  MAX_AGENT_RIGHT_PANEL_WIDTH,
  MIN_AGENT_RIGHT_PANEL_WIDTH,
} from "../../domain/agentWorkbenchLayout";

export const AGENT_PANEL_RESIZE_STEP = 16;

export function panelWidthForKey(key: string, width: number): number | null {
  if (key === "ArrowLeft") return width + AGENT_PANEL_RESIZE_STEP;
  if (key === "ArrowRight") return width - AGENT_PANEL_RESIZE_STEP;
  if (key === "Home") return MIN_AGENT_RIGHT_PANEL_WIDTH;
  if (key === "End") return MAX_AGENT_RIGHT_PANEL_WIDTH;
  if (key === "Enter" || key === " ") return DEFAULT_AGENT_RIGHT_PANEL_WIDTH;
  return null;
}
```

`src/components/agentMode/useAgentSurfaceLayout.ts`: add `resizeRightPanel(width: number): void;` to `AgentSurfaceLayout`, and

```ts
  const resizeRightPanel = useCallback(
    (width: number) => dispatchLayout({ kind: "resizeRightPanel", width }),
    [dispatchLayout],
  );
```

returned as `resizeRightPanel,`.

`src/components/agentMode/AgentSurfacePanel.tsx`:
- Props: add `readonly leadingControls?: ReactNode;` and `readonly onResizeWidth?: (width: number) => void;` (import `type ReactNode`), destructure `leadingControls = null, onResizeWidth`.
- Imports: `import { TopBar } from "../../ui/shell/TopBar";`, `import { MAX_AGENT_RIGHT_PANEL_WIDTH, MIN_AGENT_RIGHT_PANEL_WIDTH } from "../../domain/agentWorkbenchLayout";`, `import { panelWidthForKey } from "./agentSurfaceResize";`.
- Replace the resize `<div ... className="agent-surface__resize" .../>` with:

```tsx
      <div
        aria-label="Resize right panel"
        aria-orientation="vertical"
        aria-valuemax={MAX_AGENT_RIGHT_PANEL_WIDTH}
        aria-valuemin={MIN_AGENT_RIGHT_PANEL_WIDTH}
        aria-valuenow={layout.rightPanelWidth}
        className="agent-surface__resize"
        onKeyDown={(event) => {
          if (onResizeWidth === undefined) return;
          const next = panelWidthForKey(event.key, layout.rightPanelWidth);
          if (next === null) return;
          event.preventDefault();
          onResizeWidth(next);
        }}
        onPointerDown={onResizeStart}
        role="separator"
        tabIndex={0}
      />
```

- Replace `<header className="agent-surface__head" data-agent-surface-head data-tauri-drag-region="deep">` with

```tsx
      <TopBar
        className="agent-surface__head"
        data-agent-surface-head=""
        label="Right panel"
        leading={leadingControls}
        region="panel"
        trailing={layoutControls}
        windowEdge={layout.rightPanelMaximized}
      >
```

  keep the tab strip, `WorkbenchEditorTabsPortalTarget`, the spacer and the tree toggle as children, delete the `<div className="agent-surface__layout-controls">{layoutControls}</div>` line, and close with `</TopBar>` instead of `</header>`.

`src/components/agentMode/AgentSurfaceHost.tsx`: add `leadingControls?: ReactNode` and `onResizeWidth?: (width: number) => void` to its props interface, destructure them, and pass `leadingControls={leadingControls}` and `onResizeWidth={onResizeWidth}` to `<AgentSurfacePanel>`.

`src/components/agentMode/AgentModeView.tsx`:
- On `<AgentSurfaceHost ...>` add `leadingControls={layout.rail === "collapsed" && layout.rightPanelMaximized ? sidebarReveal : null}` and `onResizeWidth={surface.resizeRightPanel}`.
- On `<div className="agent-mode__center" ref={navigation.centerRef}>` add `inert={layout.rightPanelMaximized || undefined}`.

`src/components/workbenchShellFrame.css`:
- `.app-shell { --agent-surface-header-height: 40px; ...}` -> `--agent-surface-header-height: var(--cv-topbar-h);`
- Replace

```css
.workbench-frame[data-right-panel="maximized"] .agent-mode__grid {
  grid-template-columns: var(--agent-rail-track);
}

.workbench-frame[data-right-panel="maximized"] .agent-mode__center {
  display: none;
}
```

with

```css
.workbench-frame[data-right-panel="maximized"] .agent-mode__grid {
  grid-template-columns: var(--agent-rail-track) 0px;
}

.workbench-frame[data-right-panel="maximized"] .agent-mode__center {
  overflow: hidden;
  visibility: hidden;
}
```

`src/components/agentMode/agentSurface.css`:
- `.agent-surface`: `background: var(--cv-canvas);` and add `box-shadow: var(--cv-edge-start-divider);`.
- After `.agent-surface__resize { ... }` add:

```css
.agent-surface__resize::after {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  left: 3px;
  width: 2px;
  background: transparent;
  transition: background-color var(--cv-motion-base) var(--cv-ease);
}

.agent-surface__resize:hover::after,
.agent-surface__resize:active::after,
.agent-surface__resize:focus-visible::after {
  background: var(--cv-accent);
}

.agent-surface__resize:focus-visible {
  outline: none;
}
```

- Delete `.agent-surface__head { ... }` and `.workbench-frame[data-right-panel="maximized"] .agent-surface__head { ... }`; change the selector `.agent-surface__head > .agent-iconbutton` to `.agent-surface__head .cv-topbar__title > .agent-iconbutton`.

- [ ] **Step 4: Run the focused tests**

Run: `npx vitest run src/components/agentMode src/components/workbenchShellFrame.expanded.test.ts src/components/WorkbenchShellFrame.test.tsx src/components/windowChromeStyles.test.ts src/ui/shell`
Expected: PASS.

- [ ] **Step 5: Format**

Run: `npx prettier --write src/components/agentMode/agentSurfaceResize.ts src/components/agentMode/agentSurfaceResize.test.ts && npm run format:check:changed`
Expected: exit 0.

---

### Task 9: Conversation column container and frame surfaces

**Files:**
- Create: `src/components/agentMode/agentShellFrame.test.ts`
- Modify: `src/components/agentMode/agentMode.css`, `src/components/agentMode/agentModeTokens.css`, `src/components/agentMode/agentModeResponsiveStyles.test.ts`

**Interfaces:**
- Produces: `.agent-mode__center` = flex column on `--cv-canvas` (P3 invariant: direct children header, `AgentThreadSession`, notice siblings, `AgentThreadQuestions`, `AgentComposerController`); `--agent-thread-column: var(--cv-column)`.

- [ ] **Step 1: Write the failing contract test**

Create `src/components/agentMode/agentShellFrame.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  buildTokenTable,
  lastOf,
  parseAllStyleSheets,
  selectorParts,
  type CssRule,
} from "../cssContractTestSupport";

const parsed = parseAllStyleSheets();
const agentRules = parsed.rules.filter((rule) => rule.sheet.startsWith("components/agentMode/"));
const RETIRED_SELECTORS = [
  ".agent-rail__chrome",
  ".agent-thread-head",
  ".agent-crumbs",
  ".agent-layout-controls",
  ".agent-icon-toggle",
  ".agent-surface__layout-controls",
  ".status-bar--agent",
] as const;

function value(rules: readonly CssRule[], selector: string, property: string): string | undefined {
  return lastOf(
    buildTokenTable(
      rules.filter(
        (rule) => rule.context.length === 0 && selectorParts(rule.selector).includes(selector),
      ),
      "",
    ).get(property),
  );
}

describe("agent shell frame surfaces", () => {
  it("paints the sidebar on the side tone and the panel and conversation on the canvas", () => {
    expect(value(agentRules, ".agent-rail", "background")).toBe("var(--cv-side)");
    expect(value(agentRules, ".agent-rail", "box-shadow")).toBe("var(--cv-edge-end-divider)");
    expect(value(agentRules, ".agent-surface", "background")).toBe("var(--cv-canvas)");
    expect(value(agentRules, ".agent-surface", "box-shadow")).toBe("var(--cv-edge-start-divider)");
    expect(value(agentRules, ".agent-mode__center", "background")).toBe("var(--cv-canvas)");
  });

  it("keeps the conversation column a flex column so the session and composer stack", () => {
    expect(value(agentRules, ".agent-mode__center", "display")).toBe("flex");
    expect(value(agentRules, ".agent-mode__center", "flex-direction")).toBe("column");
    expect(value(agentRules, ".agent-mode__center", "min-height")).toBe("0");
    expect(value(agentRules, ".workbench-frame", "--agent-thread-column")).toBe("var(--cv-column)");
  });

  it("retires every rule the shell primitive replaced", () => {
    const leftovers = agentRules
      .flatMap((rule) => selectorParts(rule.selector).map((part) => `${rule.sheet} ${part}`))
      .filter((entry) => RETIRED_SELECTORS.some((selector) => entry.includes(selector)));

    expect(leftovers).toEqual([]);
  });
});
```

Run: `npx vitest run src/components/agentMode/agentShellFrame.test.ts`
Expected: FAIL on the center background/display and `--agent-thread-column` (and on `.status-bar--agent`, which Task 10 removes - that single leftover is expected until Task 10; keep the assertion).

- [ ] **Step 2: Implement**

`src/components/agentMode/agentMode.css`:
- In `.agent-mode, .agent-surface-host {` replace `background: var(--agent-ambient), var(--agent-canvas);` with `background: var(--cv-canvas);`.
- Replace the `.agent-mode__center {` rule with:

```css
.agent-mode__center {
  display: flex;
  flex-direction: column;
  grid-column: 2;
  grid-row: 1;
  min-width: 0;
  min-height: 0;
  background: var(--cv-canvas);
  container-name: agent-center;
  container-type: inline-size;
}
```

`src/components/agentMode/agentModeTokens.css`: `--agent-thread-column: 768px;` -> `--agent-thread-column: var(--cv-column);`.

`src/components/agentMode/agentModeResponsiveStyles.test.ts`, "keeps the composer in a real non-overlapping center layout row": replace `expect(rule(".agent-mode__center")).toContain("grid-template-rows: auto minmax(0, 1fr) auto");` with

```ts
    expect(rule(".agent-mode__center")).toContain("display: flex");
    expect(rule(".agent-mode__center")).toContain("flex-direction: column");
```

- [ ] **Step 3: Run the focused tests**

Run: `npx vitest run src/components/agentMode src/components/workbenchShellFrame.expanded.test.ts`
Expected: PASS except `agentShellFrame.test.ts` "retires every rule ..." listing only `components/agentMode/agentModeTokens.css .status-bar--agent` (fixed in Task 10).

- [ ] **Step 4: Format**

Run: `npx prettier --write src/components/agentMode/agentShellFrame.test.ts && npm run format:check:changed`
Expected: exit 0.

---
### Task 10: Thread activity replaces the agent status bar

**Files:**
- Create: `src/components/agentMode/agentThreadActivityPresentation.ts`, `src/components/agentMode/agentThreadActivityPresentation.test.ts`
- Create: `src/components/agentMode/AgentThreadActivity.tsx`, `src/components/agentMode/AgentThreadActivityMenu.tsx`, `src/components/agentMode/AgentThreadActivity.test.tsx`
- Delete: `src/components/agentMode/AgentStatusBar.tsx`, `AgentStatusBar.test.tsx`, `AgentStatusBarHost.tsx`, `AgentStatusBarHost.test.tsx`, `AgentStatusBarMenu.tsx`, `agentStatusBar.css` (use `git rm` only in the lead's commit step; implementers delete with `rm`)
- Modify: `src/components/agentMode/agentAttentionPresentation.ts`, `src/components/agentMode/AgentProviderRailFooter.tsx`, `src/components/agentMode/AgentThreadsSidebar.tsx`, `src/components/agentMode/agentWorkbenchChrome.ts`, `src/components/agentMode/AgentWorkbenchScreen.tsx`, `src/components/agentMode/AgentModeView.tsx`, `src/components/agentMode/agentMode.css`, `src/components/agentMode/agentModeTokens.css`, `src/components/agentMode/agentModeTokens.test.ts`, `src/components/agentMode/agentModeCssTestSupport.ts`, `src/components/workbenchShellFrame.expanded.test.ts`, `src/App.tsx`, `src/App.css` (import line), `src/App.commandRouting.test.tsx`

**Interfaces:**
- Consumes: `agentAttentionCount` (`agentModePresentation.ts`), `agentAttentionExplanation`, `AgentSidebarReveal.detail` (Task 6), `StatusBarItemVisibility.agentAttention`.
- Produces:
  - `interface AgentThreadActivitySummary { live: number; capacity: number; attention: number; attentionExplanation: string }`
  - `agentThreadActivitySummary(threads, liveTaskCount, maxConcurrentAgentTasks)`, `agentThreadActivitySlotsTitle(summary)`, `agentThreadAttentionLabel(count)`, `agentThreadActivityDetail(summary, attentionVisible): string | null`, `agentThreadActivityGroupLabel(summary, attentionVisible): string`
  - `AgentThreadActivity({ summary, attentionVisible, ownerKey, onChangeAttentionVisible })`
  - `AgentThreadActivityMenu({ position, visible, disabled, onToggle, onClose })`
  - `interface AgentWorkbenchThreadActivityChrome { attentionVisible: boolean; onChangeAttentionVisible: ((visible: boolean) => void) | null }`, `AgentWorkbenchChrome.threadActivity?`
  - `AgentThreadsSidebarProps.footerActivity?: ReactNode`, `AgentProviderRailFooterProps.activity?: ReactNode`

- [ ] **Step 1: Write the failing tests**

Create `src/components/agentMode/agentThreadActivityPresentation.test.ts` (copy the `threadView` and `turn` helpers verbatim from the bottom of `AgentStatusBarHost.test.tsx` before deleting that file, with the same imports they need):

```ts
import { describe, expect, it } from "vitest";
import {
  agentThreadActivityDetail,
  agentThreadActivityGroupLabel,
  agentThreadActivitySlotsTitle,
  agentThreadActivitySummary,
  agentThreadAttentionLabel,
} from "./agentThreadActivityPresentation";

describe("agent thread activity presentation", () => {
  it("counts only threads that need attention and explains failed and interrupted runs", () => {
    const summary = agentThreadActivitySummary(
      [
        threadView({ threadId: "failed", attention: "attention", status: { kind: "failed", message: "private error" } }),
        threadView({ threadId: "exited", attention: "attention", status: { kind: "exited", exitCode: 2 } }),
        threadView({ threadId: "stopped", attention: "attention", status: { kind: "stopped" } }),
        threadView({ threadId: "interrupted", attention: "attention", status: { kind: "interrupted" } }),
        threadView({ threadId: "running", attention: "running" }),
      ],
      2,
      4,
    );

    expect(summary.live).toBe(2);
    expect(summary.capacity).toBe(4);
    expect(summary.attention).toBe(4);
    expect(summary.attentionExplanation).toContain("2 failed · 1 interrupted.");
    expect(summary.attentionExplanation).not.toContain("private error");
    expect(summary.attentionExplanation).toContain("Right-click the thread activity");
    expect(summary.attentionExplanation).not.toContain("status bar");
  });

  it("labels slots, attention and the tooltip detail", () => {
    const summary = { live: 2, capacity: 4, attention: 1, attentionExplanation: "why" };

    expect(agentThreadActivitySlotsTitle(summary)).toBe("2 of 4 thread slots in use");
    expect(agentThreadAttentionLabel(1)).toBe("1 needs attention");
    expect(agentThreadAttentionLabel(3)).toBe("3 need attention");
    expect(agentThreadActivityDetail(summary, true)).toBe("2 running · 1 needs attention");
    expect(agentThreadActivityDetail(summary, false)).toBe("2 running");
    expect(agentThreadActivityDetail({ ...summary, live: 0, attention: 0 }, true)).toBeNull();
    expect(agentThreadActivityGroupLabel({ ...summary, live: 0, attention: 0 }, true)).toBe(
      "Thread activity: idle",
    );
    expect(agentThreadActivityGroupLabel(summary, true)).toBe(
      "Thread activity: 2 running · 1 needs attention",
    );
  });

  it("never reports negative counts from a corrupt surface", () => {
    const summary = agentThreadActivitySummary([], -3, -1);

    expect(summary.live).toBe(0);
    expect(summary.capacity).toBe(0);
  });
});
```

Create `src/components/agentMode/AgentThreadActivity.test.tsx`:

```tsx
// @vitest-environment jsdom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountUi, press, type MountedUi } from "../../ui/foundation/foundationTestSupport";
import { AgentThreadActivity, type AgentThreadActivityProps } from "./AgentThreadActivity";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const IDLE = { live: 0, capacity: 4, attention: 0, attentionExplanation: "why" };

let mounted: MountedUi | null = null;

afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

function render(overrides: Partial<AgentThreadActivityProps> = {}): MountedUi {
  mounted = mounted ?? mountUi();
  mounted.render(
    <AgentThreadActivity
      attentionVisible
      onChangeAttentionVisible={vi.fn()}
      ownerKey="/workspace/app"
      summary={IDLE}
      {...overrides}
    />,
  );
  return mounted;
}

function group(view: MountedUi): HTMLElement {
  const element = view.host.querySelector<HTMLElement>('[role="group"]');
  expect(element).not.toBeNull();
  return element as HTMLElement;
}

describe("AgentThreadActivity", () => {
  it("stays a quiet, focusable group while idle", () => {
    const view = render();

    expect(group(view).getAttribute("aria-label")).toBe("Thread activity: idle");
    expect(group(view).tabIndex).toBe(0);
    expect(group(view).textContent).toBe("");
  });

  it("shows running slots with their capacity on hover", () => {
    const view = render({ summary: { ...IDLE, live: 2 } });

    const running = view.host.querySelector<HTMLElement>(".agent-thread-activity__running");
    expect(running?.textContent).toBe("2 running");
    expect(running?.title).toBe("2 of 4 thread slots in use");
  });

  it("shows attention with its explanation and hides it when the user turned it off", () => {
    const view = render({ summary: { ...IDLE, attention: 1, attentionExplanation: "1 failed." } });

    const attention = view.host.querySelector<HTMLElement>(".agent-thread-activity__attention");
    expect(attention?.textContent).toBe("1 needs attention");
    expect(attention?.title).toBe("1 failed.");

    render({ attentionVisible: false, summary: { ...IDLE, attention: 1 } });
    expect(view.host.querySelector(".agent-thread-activity__attention")).toBeNull();
  });

  it("re-enables a hidden indicator from the idle group's context menu", () => {
    const onChangeAttentionVisible = vi.fn();
    const view = render({ attentionVisible: false, onChangeAttentionVisible });

    act(() => {
      group(view).dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }),
      );
    });
    const item = document.querySelector<HTMLButtonElement>('[role="menuitemcheckbox"]');
    expect(item?.getAttribute("aria-checked")).toBe("false");
    act(() => item?.click());

    expect(onChangeAttentionVisible).toHaveBeenCalledWith(true);
    expect(document.querySelector('[role="menuitemcheckbox"]')).toBeNull();
    expect(document.activeElement).toBe(group(view));
  });

  it("opens the menu from the keyboard and closes it on an owner change", () => {
    const view = render();

    press(group(view), "F10", { shiftKey: true });
    expect(document.querySelector('[role="menuitemcheckbox"]')).not.toBeNull();

    render({ ownerKey: "/workspace/other" });
    expect(document.querySelector('[role="menuitemcheckbox"]')).toBeNull();
  });

  it("offers no menu when visibility cannot change", () => {
    const view = render({ onChangeAttentionVisible: null });

    press(group(view), "ContextMenu");

    expect(document.querySelector('[role="menuitemcheckbox"]')).toBeNull();
  });
});
```

In `src/App.commandRouting.test.tsx`, in "gives the agent layout the full window and restores the IDE chrome when expanded", replace `expect(host.querySelector(".status-bar--agent")?.textContent).toContain("1/3 threads running");` with `expect(host.querySelector(".status-bar--agent")).toBeNull();` (the later `toBeNull()` assertion stays).

In `src/components/agentMode/agentModeTokens.test.ts` ("stamps the agent surfaces with the codevo sans stack"): look the rule up by `.agent-usage-layer` instead of `.status-bar--agent` and expect the selector parts `[".agent-mode", ".agent-surface-host", ".agent-usage-layer"]`.

In `src/components/workbenchShellFrame.expanded.test.ts` delete the `STATUS_BAR_SHEET` constant and drop it from the `[SHELL_SHEET, SURFACE_SHEET, STATUS_BAR_SHEET]` list.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/components/agentMode/agentThreadActivityPresentation.test.ts src/components/agentMode/AgentThreadActivity.test.tsx`
Expected: FAIL - missing modules.

- [ ] **Step 3: Implement presentation, component and menu**

In `src/components/agentMode/agentAttentionPresentation.ts` change the sentence `Right-click the status bar to hide this indicator.` to `Right-click the thread activity in the sidebar footer to hide this indicator.`

Create `src/components/agentMode/agentThreadActivityPresentation.ts`:

```ts
import type { AgentThreadView } from "../../application/agentThreadPorts";
import { agentAttentionExplanation } from "./agentAttentionPresentation";
import { agentAttentionCount } from "./agentModePresentation";

export interface AgentThreadActivitySummary {
  readonly live: number;
  readonly capacity: number;
  readonly attention: number;
  readonly attentionExplanation: string;
}

export function agentThreadActivitySummary(
  threads: ReadonlyArray<AgentThreadView>,
  liveTaskCount: number,
  maxConcurrentAgentTasks: number,
): AgentThreadActivitySummary {
  return {
    live: Math.max(0, liveTaskCount),
    capacity: Math.max(0, maxConcurrentAgentTasks),
    attention: agentAttentionCount(threads),
    attentionExplanation: agentAttentionExplanation(threads),
  };
}

export function agentThreadActivitySlotsTitle(summary: AgentThreadActivitySummary): string {
  return `${summary.live} of ${summary.capacity} thread slots in use`;
}

export function agentThreadAttentionLabel(count: number): string {
  return `${count} ${count === 1 ? "needs" : "need"} attention`;
}

export function agentThreadActivityDetail(
  summary: AgentThreadActivitySummary,
  attentionVisible: boolean,
): string | null {
  const parts = [
    summary.live > 0 ? `${summary.live} running` : null,
    attentionVisible && summary.attention > 0 ? agentThreadAttentionLabel(summary.attention) : null,
  ].filter((part): part is string => part !== null);
  if (parts.length === 0) return null;
  return parts.join(" · ");
}

export function agentThreadActivityGroupLabel(
  summary: AgentThreadActivitySummary,
  attentionVisible: boolean,
): string {
  return `Thread activity: ${agentThreadActivityDetail(summary, attentionVisible) ?? "idle"}`;
}
```

Create `src/components/agentMode/AgentThreadActivityMenu.tsx` by moving `AgentStatusBarMenu.tsx` unchanged except: component name `AgentThreadActivityMenu`, exported position type `AgentThreadActivityMenuPosition`, `aria-label="Thread activity items"`, disabled title `"Open a project to change thread activity."`, item text `Threads needing attention`.

Create `src/components/agentMode/AgentThreadActivity.tsx`:

```tsx
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import {
  AgentThreadActivityMenu,
  type AgentThreadActivityMenuPosition,
} from "./AgentThreadActivityMenu";
import {
  agentThreadActivityGroupLabel,
  agentThreadActivitySlotsTitle,
  agentThreadAttentionLabel,
  type AgentThreadActivitySummary,
} from "./agentThreadActivityPresentation";

export interface AgentThreadActivityProps {
  readonly summary: AgentThreadActivitySummary;
  readonly attentionVisible: boolean;
  readonly ownerKey: string | null;
  readonly onChangeAttentionVisible: ((visible: boolean) => void) | null;
}

interface OwnedMenu extends AgentThreadActivityMenuPosition {
  readonly owner: string | null;
}

export function AgentThreadActivity({
  attentionVisible,
  onChangeAttentionVisible,
  ownerKey,
  summary,
}: AgentThreadActivityProps) {
  const groupRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<OwnedMenu | null>(null);
  useLayoutEffect(() => setMenu(null), [ownerKey]);
  const closeMenu = useCallback((restoreFocus: boolean) => {
    setMenu(null);
    if (restoreFocus) groupRef.current?.focus();
  }, []);

  const openAt = (x: number, y: number): void => {
    if (onChangeAttentionVisible === null) return;
    setMenu({ x, y, owner: ownerKey });
  };
  const onContextMenu = (event: MouseEvent<HTMLDivElement>): void => {
    if (onChangeAttentionVisible === null) return;
    event.preventDefault();
    openAt(event.clientX, event.clientY);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
    if (onChangeAttentionVisible === null) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    openAt(rect.left + 8, rect.top);
  };
  const attentionShown = attentionVisible && summary.attention > 0;

  return (
    <div
      aria-label={agentThreadActivityGroupLabel(summary, attentionVisible)}
      className="agent-thread-activity"
      onContextMenu={onContextMenu}
      onKeyDown={onKeyDown}
      ref={groupRef}
      role="group"
      tabIndex={0}
    >
      {summary.live > 0 ? (
        <span
          className="agent-thread-activity__running"
          title={agentThreadActivitySlotsTitle(summary)}
        >
          <span aria-hidden="true" className="agent-thread-activity__dot" />
          {`${summary.live} running`}
        </span>
      ) : null}
      {attentionShown ? (
        <span className="agent-thread-activity__attention" title={summary.attentionExplanation}>
          {agentThreadAttentionLabel(summary.attention)}
        </span>
      ) : null}
      {menu !== null && menu.owner === ownerKey && onChangeAttentionVisible !== null ? (
        <AgentThreadActivityMenu
          disabled={ownerKey === null}
          onClose={closeMenu}
          onToggle={() => onChangeAttentionVisible(!attentionVisible)}
          position={menu}
          visible={attentionVisible}
        />
      ) : null}
    </div>
  );
}
```

Note: the running span renders the dot and the text as siblings, so `textContent` is exactly `"2 running"`.

Append to `src/components/agentMode/agentMode.css`:

```css
.agent-thread-activity {
  display: flex;
  flex: 1 1 0;
  align-items: center;
  justify-content: flex-end;
  gap: var(--cv-space-4);
  min-width: 0;
  min-height: 28px;
  padding: 0 var(--cv-space-2);
  border-radius: var(--cv-r-sm);
  color: var(--cv-fg-subtle);
  font-size: var(--cv-t-xs);
  font-variant-numeric: tabular-nums;
}

.agent-thread-activity:focus-visible {
  outline: 2px solid var(--cv-focus);
  outline-offset: 2px;
}

.agent-thread-activity__running {
  display: inline-flex;
  align-items: center;
  gap: var(--cv-space-3);
  white-space: nowrap;
}

.agent-thread-activity__dot {
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--cv-ok);
}

.agent-thread-activity__attention {
  color: var(--cv-warn);
  white-space: nowrap;
}
```

- [ ] **Step 4: Wire the footer, chrome and view; retire the agent status bar**

- `AgentProviderRailFooter.tsx`: add `readonly activity?: ReactNode;` to its props (import `type ReactNode`), destructure `activity = null`, and render `{activity}` right after the closing `</nav>` inside `<footer>`.
- `AgentThreadsSidebar.tsx`: add `readonly footerActivity?: ReactNode;` to props, destructure `footerActivity = null`, pass `activity={footerActivity}` to `<AgentProviderRailFooter>`.
- `agentWorkbenchChrome.ts`: add

```ts
export interface AgentWorkbenchThreadActivityChrome {
  readonly attentionVisible: boolean;
  readonly onChangeAttentionVisible: ((visible: boolean) => void) | null;
}
```

  and `readonly threadActivity?: AgentWorkbenchThreadActivityChrome;` to `AgentWorkbenchChrome`.
- `AgentWorkbenchScreen.tsx`: add `| "setStatusBarItemVisibility"` to the `Partial<Pick<Workbench, ...>>` list of `AgentWorkbenchScreenWorkbench`; before the `chrome` memo add

```tsx
  const setStatusBarItemVisibility = workbench.setStatusBarItemVisibility;
  const attentionVisible = workbench.workspaceSettings.statusBar.agentAttention;
  const threadActivity = useMemo<AgentWorkbenchThreadActivityChrome>(
    () => ({
      attentionVisible,
      onChangeAttentionVisible:
        setStatusBarItemVisibility === undefined
          ? null
          : (visible) => setStatusBarItemVisibility("agentAttention", visible),
    }),
    [attentionVisible, setStatusBarItemVisibility],
  );
```

  and add `threadActivity,` to the chrome object and to its dependency list (import the type from `./agentWorkbenchChrome`).
- `AgentModeView.tsx`: import `AgentThreadActivity` and `agentThreadActivityDetail`, `agentThreadActivitySummary`; before `sidebarReveal` add

```tsx
  const threadActivitySummary = useMemo(
    () =>
      agentThreadActivitySummary(
        agents.threads,
        agents.liveTaskCount,
        agents.maxConcurrentAgentTasks,
      ),
    [agents.liveTaskCount, agents.maxConcurrentAgentTasks, agents.threads],
  );
  const attentionVisible = chrome.threadActivity?.attentionVisible ?? true;
```

  give `<AgentSidebarReveal>` the prop `detail={agentThreadActivityDetail(threadActivitySummary, attentionVisible)}`, and on `<AgentThreadsSidebar>` add

```tsx
                footerActivity={
                  <AgentThreadActivity
                    attentionVisible={attentionVisible}
                    onChangeAttentionVisible={chrome.threadActivity?.onChangeAttentionVisible ?? null}
                    ownerKey={workspaceRoot}
                    summary={threadActivitySummary}
                  />
                }
```

- `src/App.tsx`: delete `import { AgentStatusBarHost } from "./components/agentMode/AgentStatusBarHost";` and replace `{workbench.agentModeActive ? (<AgentStatusBarHost workbench={workbench} />) : (<StatusBar ... />)}` with `{workbench.agentModeActive ? null : (<StatusBar ... />)}` (Task 11 moves it into the toolbar).
- `src/App.css`: delete `@import "./components/agentMode/agentStatusBar.css";`.
- `agentModeTokens.css`: remove `.status-bar--agent` from the selector list of the `font-family: var(--codevo-sans)` rule (last rule of the file).
- `agentModeCssTestSupport.ts`: remove `"agentStatusBar.css",` from `AGENT_MODE_STYLE_SHEETS`.
- Delete the six retired files listed above.

- [ ] **Step 5: Run the focused tests**

Run: `npx vitest run src/components/agentMode src/components/workbenchShellFrame.expanded.test.ts src/App.commandRouting.test.tsx src/domain/themeContrast.test.ts`
Expected: PASS, including `agentShellFrame.test.ts` "retires every rule ...".

Run: `npm run check && npm run lint -- --max-warnings 0 && npm run lint:exhaustive-deps`
Expected: each exits 0.

- [ ] **Step 6: Format**

Run: `npx prettier --write src/components/agentMode/agentThreadActivityPresentation.ts src/components/agentMode/agentThreadActivityPresentation.test.ts src/components/agentMode/AgentThreadActivity.tsx src/components/agentMode/AgentThreadActivityMenu.tsx src/components/agentMode/AgentThreadActivity.test.tsx && npm run format:check:changed`
Expected: exit 0.

---

### Task 11: Editor status moves into the editor toolbar; no status row anywhere; inventory test

**Files:**
- Create: `src/components/useEditorStatusPresentation.ts`, `src/components/useEditorStatusPresentation.test.tsx`
- Create: `src/components/statusBarRelocation.test.tsx`
- Modify: `src/components/StatusBar.tsx`, `src/components/StatusBar.test.tsx`
- Modify: `src/components/WorkbenchToolbar.tsx`, `src/components/WorkbenchToolbar.test.tsx`
- Modify: `src/App.tsx`, `src/App.css`, `src/App.commandRouting.test.tsx`
- Modify: `index.html`, `public/startup.css`, `src/startupDocument.test.ts`
- Modify: `scripts/hotspot-size-baseline.json` (lowered by the update script only)

**Interfaces:**
- Consumes: `workspaceInfoLabel`, `ideActivityStatus`, `ideActivityDetail`, `phpLanguageServerActivityLabel`, `languageServerStatusLabel`; `AgentThreadActivity`, `AgentSidebarReveal`, `agentThreadActivityDetail`.
- Produces:
  - `EditorStatusWorkbench`, `EditorStatusPresentation { workspaceLabel; ideActivityLabel; ideActivityState; ideActivityDetail }`, `useEditorStatusPresentation(workbench, activeLanguage)`
  - `WorkbenchToolbarProps.status?: ReactNode` rendered in `.workbench-toolbar__status`
  - `StatusBar` root: `<div role="group" aria-label="Editor status" class="editor-status">`
  - `.app-shell` rows `var(--window-chrome-height) minmax(0, 1fr)`; startup skeleton rows `minmax(0, 1fr)`, rail on `--startup-side`, centre on `--startup-canvas`.

- [ ] **Step 1: Write the failing tests**

Create `src/components/useEditorStatusPresentation.test.tsx`:

```tsx
// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { mountUi, type MountedUi } from "../ui/foundation/foundationTestSupport";
import { ideActivityDetail, ideActivityStatus, phpLanguageServerActivityLabel } from "../domain/ideActivity";
import { initialIndexProgress } from "../domain/indexProgress";
import { languageServerStatusLabel } from "../domain/languageServerRuntime";
import { defaultWorkspaceSettings } from "../domain/settings";
import { workspaceInfoLabel } from "./appPresentation";
import {
  useEditorStatusPresentation,
  type EditorStatusPresentation,
  type EditorStatusWorkbench,
} from "./useEditorStatusPresentation";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const ROOT = "/workspace/app";
const results: EditorStatusPresentation[] = [];

function Probe({ workbench }: { readonly workbench: EditorStatusWorkbench }) {
  results.push(useEditorStatusPresentation(workbench, "typescript"));
  return null;
}

function fixture(): EditorStatusWorkbench {
  return {
    activeFrameworkActivityLabel: null,
    indexProgress: initialIndexProgress(),
    intelligenceMode: "basic",
    javaScriptTypeScriptLanguageServerRuntimeStatus: null,
    languageServerPlan: null,
    languageServerRuntimeStatus: null,
    phpTools: null,
    workspaceDescriptor: null,
    workspaceRoot: ROOT,
    workspaceSettings: defaultWorkspaceSettings(),
  };
}

let mounted: MountedUi | null = null;

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  results.length = 0;
});

describe("useEditorStatusPresentation", () => {
  it("composes the same labels the status bar showed", () => {
    const workbench = fixture();
    mounted = mountUi();
    mounted.render(<Probe workbench={workbench} />);

    const combined =
      [
        phpLanguageServerActivityLabel("basic", null, ROOT, null),
        languageServerStatusLabel(null, "TS Server", { workspaceRoot: ROOT }),
      ]
        .filter(Boolean)
        .join(" · ") || null;
    const activity = ideActivityStatus(ROOT, null, null, workbench.indexProgress, combined, null);
    const latest = results[results.length - 1];

    expect(latest?.ideActivityLabel).toBe(activity.label);
    expect(latest?.ideActivityState).toBe(activity.state);
    expect(latest?.ideActivityDetail).toBe(ideActivityDetail(ROOT, null, null, workbench.indexProgress));
    expect(latest?.workspaceLabel).toBe(
      workspaceInfoLabel({
        activeLanguage: "typescript",
        javaScriptTypeScriptVersion: workbench.workspaceSettings.javaScriptTypeScriptVersion,
        phpTools: null,
        phpVersionOverride: workbench.workspaceSettings.phpVersionOverride,
        workspaceDescriptor: null,
      }),
    );
  });

  it("keeps a stable result while its inputs do not change", () => {
    const workbench = fixture();
    mounted = mountUi();
    mounted.render(<Probe workbench={workbench} />);
    mounted.render(<Probe workbench={{ ...workbench }} />);

    expect(results).toHaveLength(2);
    expect(results[1]).toBe(results[0]);
  });
});
```

(If `tsc` reports that a fixture field is not nullable, use that field's initial value from the controller instead of `null`; do not widen the hook's types.)

Create `src/components/statusBarRelocation.test.tsx`:

```tsx
// @vitest-environment jsdom

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountUi, type MountedUi } from "../ui/foundation/foundationTestSupport";
import { initialIndexProgress } from "../domain/indexProgress";
import { defaultStatusBarItemVisibility, type StatusBarItemVisibility } from "../domain/settings";
import { AgentSidebarReveal } from "./agentMode/AgentSidebarReveal";
import { AgentThreadActivity } from "./agentMode/AgentThreadActivity";
import { agentThreadActivityDetail } from "./agentMode/agentThreadActivityPresentation";
import { StatusBar } from "./StatusBar";
import { WorkbenchToolbar } from "./WorkbenchToolbar";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

type StatusItemHome =
  | "editorToolbarStatus"
  | "sidebarThreadActivity"
  | "expandSidebarTooltip"
  | "threadActivityMenu"
  | "providerSettingsTooltip"
  | "settingsProviders"
  | "settingsAgents"
  | "composerLaunchControls"
  | "topBarBreadcrumb"
  | "toasts";

interface RelocatedItem {
  readonly item: string;
  readonly source: "editor" | "agent";
  readonly visibilityKeys: ReadonlyArray<keyof StatusBarItemVisibility>;
  readonly homes: ReadonlyArray<StatusItemHome>;
}

const INVENTORY: ReadonlyArray<RelocatedItem> = [
  { item: "thread slots", source: "agent", visibilityKeys: [], homes: ["sidebarThreadActivity", "expandSidebarTooltip", "settingsAgents"] },
  { item: "attention", source: "agent", visibilityKeys: ["agentAttention"], homes: ["sidebarThreadActivity", "expandSidebarTooltip"] },
  { item: "visibility menu", source: "agent", visibilityKeys: ["agentAttention"], homes: ["threadActivityMenu"] },
  { item: "launch label", source: "agent", visibilityKeys: [], homes: ["composerLaunchControls"] },
  { item: "cli version", source: "agent", visibilityKeys: [], homes: ["providerSettingsTooltip", "settingsProviders"] },
  { item: "workspace name", source: "agent", visibilityKeys: [], homes: ["topBarBreadcrumb"] },
  { item: "problems", source: "editor", visibilityKeys: [], homes: ["editorToolbarStatus"] },
  { item: "git branch", source: "editor", visibilityKeys: ["gitBranch"], homes: ["editorToolbarStatus"] },
  { item: "active path", source: "editor", visibilityKeys: ["activePath"], homes: ["editorToolbarStatus"] },
  { item: "workspace info", source: "editor", visibilityKeys: ["workspaceInfo"], homes: ["editorToolbarStatus"] },
  { item: "ide activity", source: "editor", visibilityKeys: ["index", "languageServer"], homes: ["editorToolbarStatus"] },
  { item: "node run", source: "editor", visibilityKeys: [], homes: ["editorToolbarStatus"] },
  { item: "trust", source: "editor", visibilityKeys: ["workspaceTrust"], homes: ["editorToolbarStatus"] },
  { item: "mode", source: "editor", visibilityKeys: ["mode"], homes: ["editorToolbarStatus"] },
  { item: "large file", source: "editor", visibilityKeys: ["largeFileMode"], homes: ["editorToolbarStatus"] },
  { item: "cursor", source: "editor", visibilityKeys: ["cursorPosition"], homes: ["editorToolbarStatus"] },
  { item: "language", source: "editor", visibilityKeys: ["language"], homes: ["editorToolbarStatus"] },
  { item: "unsaved", source: "editor", visibilityKeys: ["dirtyCount"], homes: ["editorToolbarStatus"] },
  { item: "messages", source: "editor", visibilityKeys: ["message"], homes: ["editorToolbarStatus"] },
  { item: "update notices", source: "agent", visibilityKeys: [], homes: ["toasts"] },
];

let mounted: MountedUi | null = null;

afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe("status bar removal inventory", () => {
  it("gives every former status bar item and every visibility key a home", () => {
    const covered = new Set(INVENTORY.flatMap((entry) => entry.visibilityKeys));
    const keys = Object.keys(defaultStatusBarItemVisibility()) as Array<keyof StatusBarItemVisibility>;

    expect(keys.filter((key) => !covered.has(key))).toEqual([]);
    expect(INVENTORY.filter((entry) => entry.homes.length === 0)).toEqual([]);
    expect(new Set(INVENTORY.map((entry) => entry.item)).size).toBe(INVENTORY.length);
  });

  it("renders every editor item inside the editor toolbar status group", () => {
    mounted = mountUi();
    mounted.render(
      <WorkbenchToolbar
        collapseAvailable
        ideProgress={{ busy: false, state: "idle", text: null }}
        indexProgress={initialIndexProgress()}
        intelligenceMode="fullSmart"
        languageServerPlan={null}
        languageServerRuntimeStatus={null}
        layout="editor-expanded"
        onCollapseEditor={vi.fn()}
        onShowProgressPanel={vi.fn()}
        onToggleSmartMode={vi.fn()}
        onTrustWorkspace={vi.fn()}
        status={
          <StatusBar
            activeLanguage="TypeScript"
            activePath="/w/src/app.ts"
            cursorPosition={{ lineNumber: 3, column: 7 }}
            dirtyCount={2}
            errorCount={1}
            gitBranch="main"
            ideActivityDetail="PHPactor: Off"
            ideActivityLabel="Indexing 40%"
            ideActivityState="scanning"
            intelligenceMode="fullSmart"
            largeDocumentStatus={{ label: "Large file", title: "Large file mode" }}
            message="Saved app.ts"
            onChangeVisibility={vi.fn()}
            statusBar={defaultStatusBarItemVisibility()}
            warningCount={4}
            workspaceInfoLabel="orders-api · TS 5.8"
            workspaceRoot="/w"
            workspaceTrustLabel="Trusted"
          />
        }
        workspaceRoot="/w"
        workspaceTrusted
      />,
    );

    const group = mounted.host.querySelector(
      '.workbench-toolbar .editor-status[role="group"][aria-label="Editor status"]',
    );
    const text = group?.textContent ?? "";
    for (const expected of [
      "main",
      "src/app.ts",
      "orders-api · TS 5.8",
      "Indexing 40%",
      "Trusted",
      "IDE Mode",
      "Large file",
      "Ln 3, Col 7",
      "TypeScript",
      "2 unsaved",
      "Saved app.ts",
    ]) {
      expect(text, expected).toContain(expected);
    }
    expect(group?.querySelector('button[aria-label="1 error, 4 warnings"]')).not.toBeNull();
    expect(mounted.host.querySelector("footer")).toBeNull();
  });

  it("shows running and attention in the sidebar footer activity and the expand tooltip", () => {
    const summary = { live: 2, capacity: 4, attention: 1, attentionExplanation: "1 failed." };
    mounted = mountUi();
    mounted.render(
      <>
        <AgentThreadActivity
          attentionVisible
          onChangeAttentionVisible={vi.fn()}
          ownerKey="/w"
          summary={summary}
        />
        <AgentSidebarReveal
          detail={agentThreadActivityDetail(summary, true)}
          onExpand={vi.fn()}
          onNewThread={vi.fn()}
          shortcuts={{ bottomPanel: "Cmd+J", rightPanel: "Cmd+Alt+R", sidebar: "Cmd+B", newThread: "Cmd+N" }}
        />
      </>,
    );

    expect(mounted.host.querySelector(".agent-thread-activity")?.textContent).toContain("2 running");
    expect(mounted.host.querySelector(".agent-thread-activity")?.textContent).toContain(
      "1 needs attention",
    );
    expect(
      mounted.host.querySelector<HTMLButtonElement>('button[aria-label="Expand sidebar"]')?.title,
    ).toContain("2 running · 1 needs attention");
  });

  it("leaves no status bar row, stylesheet or component behind", () => {
    const root = resolve(import.meta.dirname, "..");
    const appCss = readFileSync(resolve(root, "src/App.css"), "utf8");
    const skeleton = readFileSync(resolve(root, "index.html"), "utf8");

    expect(existsSync(resolve(root, "src/components/agentMode/agentStatusBar.css"))).toBe(false);
    expect(existsSync(resolve(root, "src/components/agentMode/AgentStatusBar.tsx"))).toBe(false);
    expect(existsSync(resolve(root, "src/components/agentMode/AgentStatusBarHost.tsx"))).toBe(false);
    expect(appCss).not.toMatch(/\.status-bar\s*\{/);
    expect(appCss).not.toContain("status-bar--agent");
    expect(skeleton).not.toContain("startup-skeleton__status");
  });
});
```

In `src/components/StatusBar.test.tsx` replace the three `host.querySelector("footer.status-bar")` / `host.querySelector<HTMLElement>("footer.status-bar")` with `host.querySelector<HTMLElement>('[role="group"][aria-label="Editor status"]')`.

In `src/components/WorkbenchToolbar.test.tsx` add:

```tsx
  it("hosts the editor status group at the end of the toolbar and never in the agent layout", () => {
    render({ status: <span data-testid="editor-status">status</span> });
    const status = host.querySelector(".workbench-toolbar__status");
    expect(status?.querySelector('[data-testid="editor-status"]')).not.toBeNull();
    expect(host.querySelector(".workbench-toolbar")?.lastElementChild).toBe(status);

    render({ layout: "agent", status: <span data-testid="editor-status">status</span> });
    expect(host.querySelector('[data-testid="editor-status"]')).toBeNull();
  });
```

In `src/App.commandRouting.test.tsx`, "gives the agent layout the full window ...": both `expect(host.querySelector('[data-testid="status-bar"]')).not.toBeNull();` become `expect(host.querySelector('.workbench-toolbar [data-testid="status-bar"]')).not.toBeNull();`.

In `src/startupDocument.test.ts` replace the body of "matches the real shell geometry so mounting React does not move the frame" with:

```ts
    const chromeHeight = startupDeclaration(":root", "--startup-chrome-height");
    expect(chromeHeight).toBe("36px");
    expect(chromeHeight).toBe(appShellDeclaration("--window-chrome-height"));

    expect(appShellDeclaration("grid-template-rows")).toBe(
      "var(--window-chrome-height) minmax(0, 1fr)",
    );
    expect(startupDeclaration(":root", "--startup-status-height")).toBeUndefined();
    expect(startupDocument.querySelector(".startup-skeleton__status")).toBeNull();

    expect(startupDeclaration(":root", "--startup-rail-width")).toBe(
      `${DEFAULT_AGENT_RAIL_WIDTH}px`,
    );
    expect(railTrackBreakpoints()).toEqual(startupRailBreakpoints());
    expect(startupDeclaration(".startup-skeleton", "grid-template-columns")).toBe(
      `${cssVar("--startup-rail-width")} minmax(0, 1fr)`,
    );
    expect(startupDeclaration(".startup-skeleton", "grid-template-rows")).toBe("minmax(0, 1fr)");
    expect(startupDeclaration(".startup-skeleton__rail", "background")).toBe(
      cssVar("--startup-side"),
    );
    expect(startupDeclaration(".startup-skeleton__centre", "background")).toBe(
      cssVar("--startup-canvas"),
    );
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/components/useEditorStatusPresentation.test.tsx src/components/statusBarRelocation.test.tsx src/components/StatusBar.test.tsx src/components/WorkbenchToolbar.test.tsx src/startupDocument.test.ts`
Expected: FAIL - missing hook module, `status` prop unknown, footer root, 28px rows.

- [ ] **Step 3: Implement the presentation hook**

Create `src/components/useEditorStatusPresentation.ts`:

```ts
import { useMemo } from "react";
import type { useWorkbenchController } from "../application/useWorkbenchController";
import {
  ideActivityDetail,
  ideActivityStatus,
  phpLanguageServerActivityLabel,
  type IdeActivityState,
} from "../domain/ideActivity";
import { languageServerStatusLabel } from "../domain/languageServerRuntime";
import { workspaceInfoLabel } from "./appPresentation";

type Workbench = ReturnType<typeof useWorkbenchController>;

export type EditorStatusWorkbench = Pick<
  Workbench,
  | "activeFrameworkActivityLabel"
  | "indexProgress"
  | "intelligenceMode"
  | "javaScriptTypeScriptLanguageServerRuntimeStatus"
  | "languageServerPlan"
  | "languageServerRuntimeStatus"
  | "phpTools"
  | "workspaceDescriptor"
  | "workspaceRoot"
  | "workspaceSettings"
>;

export interface EditorStatusPresentation {
  readonly workspaceLabel: string | null;
  readonly ideActivityLabel: string | null;
  readonly ideActivityState: IdeActivityState | null;
  readonly ideActivityDetail: string;
}

export function useEditorStatusPresentation(
  workbench: EditorStatusWorkbench,
  activeLanguage: string | null,
): EditorStatusPresentation {
  const {
    activeFrameworkActivityLabel,
    indexProgress,
    intelligenceMode,
    javaScriptTypeScriptLanguageServerRuntimeStatus: typeScriptRuntimeStatus,
    languageServerPlan,
    languageServerRuntimeStatus: phpRuntimeStatus,
    phpTools,
    workspaceDescriptor,
    workspaceRoot,
    workspaceSettings,
  } = workbench;
  const { javaScriptTypeScriptVersion, phpVersionOverride } = workspaceSettings;
  const workspaceLabel = useMemo(
    () =>
      workspaceInfoLabel({
        activeLanguage,
        javaScriptTypeScriptVersion,
        phpTools,
        phpVersionOverride,
        workspaceDescriptor,
      }),
    [activeLanguage, javaScriptTypeScriptVersion, phpTools, phpVersionOverride, workspaceDescriptor],
  );
  const languageServerLabel = useMemo(
    () =>
      [
        phpLanguageServerActivityLabel(
          intelligenceMode,
          phpRuntimeStatus,
          workspaceRoot,
          languageServerPlan,
        ),
        languageServerStatusLabel(typeScriptRuntimeStatus, "TS Server", { workspaceRoot }),
      ]
        .filter(Boolean)
        .join(" · ") || null,
    [intelligenceMode, languageServerPlan, phpRuntimeStatus, typeScriptRuntimeStatus, workspaceRoot],
  );
  const activity = useMemo(
    () =>
      ideActivityStatus(
        workspaceRoot,
        phpRuntimeStatus,
        typeScriptRuntimeStatus,
        indexProgress,
        languageServerLabel,
        activeFrameworkActivityLabel,
      ),
    [
      activeFrameworkActivityLabel,
      indexProgress,
      languageServerLabel,
      phpRuntimeStatus,
      typeScriptRuntimeStatus,
      workspaceRoot,
    ],
  );
  const detail = useMemo(
    () => ideActivityDetail(workspaceRoot, phpRuntimeStatus, typeScriptRuntimeStatus, indexProgress),
    [indexProgress, phpRuntimeStatus, typeScriptRuntimeStatus, workspaceRoot],
  );
  return useMemo(
    () => ({
      workspaceLabel,
      ideActivityLabel: activity.label,
      ideActivityState: activity.state,
      ideActivityDetail: detail,
    }),
    [activity, detail, workspaceLabel],
  );
}
```

- [ ] **Step 4: Move the status group into the toolbar**

`src/components/StatusBar.tsx`: replace `<footer className="status-bar" onContextMenu={openMenu}>` with `<div aria-label="Editor status" className="editor-status" onContextMenu={openMenu} role="group">` and the matching `</footer>` with `</div>`.

`src/components/WorkbenchToolbar.tsx`: add `import type { ReactNode } from "react";`, `readonly status?: ReactNode;` to the props, destructure `status = null`, and render as the last child of `<header className="workbench-toolbar">`:

```tsx
      {status === null ? null : <div className="workbench-toolbar__status">{status}</div>}
```

`src/App.tsx`:
- Add `import { useEditorStatusPresentation } from "./components/useEditorStatusPresentation";`.
- Delete the `workspaceLabel`, `languageServerLabel`, `javaScriptTypeScriptLanguageServerLabel`, `combinedLanguageServerLabel`, `ideActivity` and `ideActivityChipDetail` memos and the now-unused imports (`workspaceInfoLabel`, `languageServerStatusLabel`, `ideActivityDetail`, `ideActivityStatus`, `phpLanguageServerActivityLabel`); in their place add:

```tsx
  const editorStatus = useEditorStatusPresentation(workbench, activeLanguage);
```

- Delete the `{workbench.agentModeActive ? null : (<StatusBar ... />)}` block and pass the same element to `<WorkbenchToolbar>` as `status={<StatusBar ... />}`, with every prop unchanged except `workspaceInfoLabel={editorStatus.workspaceLabel}`, `ideActivityDetail={editorStatus.ideActivityDetail}`, `ideActivityLabel={editorStatus.ideActivityLabel}`, `ideActivityState={editorStatus.ideActivityState}`.

`src/App.css`:
- `.app-shell`: `grid-template-rows: var(--window-chrome-height) minmax(0, 1fr) 28px;` -> `grid-template-rows: var(--window-chrome-height) minmax(0, 1fr);`
- Replace the `.status-bar { ... }` rule with

```css
.editor-status {
  display: flex;
  min-width: 0;
  flex: 0 1 auto;
  align-items: center;
  overflow: hidden;
  color: var(--color-text-muted);
  font-size: 11.5px;
}
```

  and the `.status-bar span { ... }` selector with `.editor-status span { ... }` (same body).
- After `.workbench-toolbar { ... }` add:

```css
.workbench-toolbar__status {
  display: flex;
  min-width: 0;
  flex: 0 1 auto;
  margin-left: auto;
}
```

- [ ] **Step 5: Startup skeleton without a status row**

`index.html`: delete `<div class="startup-skeleton__status"></div>`.

`public/startup.css`:
- In `:root` delete `--startup-status-height: 28px;` and `--startup-thread: ...;`.
- `.startup-skeleton`: `grid-template-rows: minmax(0, 1fr);`
- `.startup-skeleton__rail`: `background: var(--startup-side);`
- `.startup-skeleton__centre`: `background: var(--startup-canvas);`
- Delete the `.startup-skeleton__status { ... }` rule.

- [ ] **Step 6: Run the focused tests**

Run: `npx vitest run src/components src/App.commandRouting.test.tsx src/App.dockedTextSearch.integration.test.tsx src/App.quickOpen.integration.test.tsx src/App.test.ts src/startupDocument.test.ts src/startupMount.test.tsx`
Expected: PASS.

- [ ] **Step 7: Hotspot baseline (App.tsx only shrank)**

Run: `npm run size:hotspots`
Expected: exit 1 listing only a reduction for `src/App.tsx` (below 7188 tokens) and no growth. Then run `npm run size:hotspots:update` and `npm run size:hotspots`.
Expected: the update lowers only `src/App.tsx`; the second run exits 0. `git diff scripts/hotspot-size-baseline.json` shows only the `src/App.tsx` numbers decreasing.

- [ ] **Step 8: Format**

Run: `npx prettier --write src/components/useEditorStatusPresentation.ts src/components/useEditorStatusPresentation.test.tsx src/components/statusBarRelocation.test.tsx && npm run format:check:changed && npm run format:check`
Expected: exit 0.

---

### Task 12: Full repository gates (lead)

**Files:** none (verification only).

- [ ] **Step 1: Free the Node inspector port**

Run: `lsof -ti tcp:9229 | xargs -r kill`
Expected: exit 0.

- [ ] **Step 2: TypeScript gates, one by one, checking each exit code with `echo $?` (never through `| tail`)**

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

Expected: every command exits 0. If only Node watch/debug tests fail, free port 9229 again and rerun just those files sequentially before treating it as a regression.

- [ ] **Step 3: Rust gates**

```bash
cd src-tauri
cargo check --all-targets
cargo test --lib
cargo test --tests
cargo fmt --all -- --check
cargo clippy --all-targets -- -D warnings
cd ..
```

Expected: every command exits 0.

- [ ] **Step 4: Whitespace, scope and coverage**

Run: `git diff --check && git status --porcelain && npm run test:coverage`
Expected: no whitespace errors; only the files listed in File Structure are changed/added/deleted (plus pre-existing owner files such as `docs/superpowers/specs/2026-09-23-codevo-redesign-design.md` and other phase plans, which are not P2's); coverage thresholds pass.

---

### Task 13: Independent read-only review (Opus 5.5)

**Files:** none.

- [ ] **Step 1: Dispatch the reviewer**

Dispatch a fresh general-purpose agent with `model: "opus"` and this prompt:

```text
You are an independent, read-only reviewer for phase P2 (app shell) of the Codevo redesign in /Users/matusmockor/Developer/editor. Do not edit files, do not run git commands that change state, do not run coderabbit. Read CLAUDE.md, the spec docs/superpowers/specs/2026-09-23-codevo-redesign-design.md (sections 3.1.3, 4, 5 P2, 6, 7), the plan docs/superpowers/plans/2026-09-24-redesign-p2-app-shell.md and the mockups docs/redesign/v3-monolith-clean.html, v3-sidebar-agents.html (collapsed state), v3-right-panel.html, v3-editor.html (focus mode). Review the working-tree diff (`git diff`, `git status`, untracked files).

Report findings as P0 (wrong behaviour, data loss, a window that can stay hidden), P1 (spec/CLAUDE.md violation, missing test for a risky path), P2 (quality). For each: file:line, what is wrong, a concrete failing scenario, the fix. Verify every claim in the code before reporting it.

Focus on:
1. Window reveal: `visible: false` in both Tauri configs; every startup path (normal, startup error screen, thrown module error, non-Tauri browser) either reveals the window or is covered by the Rust 2.5 s fallback; background set before show; capability permissions minimal; runtime background follows palette/scheme changes.
2. Cmd+B: `agent.toggleSidebar` only acts in agent mode and never while focus is inside `.monaco-editor`; Go to Definition still works in the editor-expanded workbench and inside the right-panel editor; no other default shortcut collides.
3. Sidebar: collapsed = 0px track in the domain, CSS and responsive placement; Collapse/Expand focus hand-off; no duplicate Expand buttons in the DOM (header vs panel bar); resize handle still keyboard-accessible; the traffic lights never overlap a control in any combination of rail collapsed/expanded, panel docked/maximized/overlay.
4. Right panel: width persisted per workspace (A -> B -> A), keyboard resize bounds, maximize keeps the conversation mounted and inert (composer draft survives), close button, toggles' aria-pressed.
5. Status bar removal: every former item has a working home (compare with the inventory table in the plan), the attention indicator can be re-enabled when idle, no leftover `.status-bar` row, startup skeleton geometry matches the shell.
6. Tokens: dark tint-3 change and the divider tokens meet the gates; no colour literals in new CSS; only `--cv-*` tokens in `src/ui/shell`; old header/rail/surface rules deleted, not overridden.
7. Hotspots: App.tsx shrank and its baseline only went down; no new file near the limits; no business logic in App.tsx or WorkbenchShellFrame.
8. Anything contradicting the plan, the spec, or the ownership agreements in the plan.

End with a verdict: SHIP, SHIP AFTER FIXES (list), or DO NOT SHIP.
```

- [ ] **Step 2: Triage**

Verify each P0/P1 in code (audits over-report). Fix real ones through a scoped implementer task, rerun the focused tests and Task 12, and re-dispatch the reviewer on the fix diff. Record rejected findings with a one-line reason for the final report.

---

### Task 14: QA build and Codex computer-use QA

**Files:** `~/tmp/codevo-qa/qa_prompt_p2.txt`, `~/tmp/codevo-qa/qa_prompt_p2_restart.txt` (scratch, deleted at the end).

- [ ] **Step 1: Build the QA bundle**

Run: `npx tauri build --debug --bundles app --config '{"identifier":"dev.mockor.editor.qa","productName":"Codevo QA"}'`
Expected: `src-tauri/target/debug/bundle/macos/Codevo QA.app` exists. Exit code 1 caused only by the missing updater signing key is acceptable; any compile error is not.

- [ ] **Step 2: Start and focus the QA app in the user's GUI session**

Run: `open "src-tauri/target/debug/bundle/macos/Codevo QA.app" && sleep 3 && osascript -e 'tell application "Codevo QA" to activate'`
Expected: a "Codevo QA" window appears (hidden-until-revealed, so it may take a moment) and is frontmost.

- [ ] **Step 3: Write the QA prompt**

```bash
mkdir -p ~/tmp/codevo-qa && cat > ~/tmp/codevo-qa/qa_prompt_p2.txt <<'QA'
You are a UI QA tester with Computer Use. First action: run `osascript -e 'tell application "Codevo QA" to activate'`, then take a screenshot. If Computer Use is unavailable, reply only COMPUTER_USE_UNAVAILABLE and stop.

Rules:
- Work ONLY in the already running app window "Codevo QA" (bundle id dev.mockor.editor.qa). Never interact with "Codevo Editor" or any other app. Do not build, launch, quit or restart any app. Do not edit files. The only shell command you may run is the osascript activate command above.
- BEFORE EVERY SCREENSHOT run `osascript -e 'tell application "Codevo QA" to activate'` so the window is frontmost; screenshots of other apps are invalid.
- Do not change macOS system settings.
- Reference: 52px top bars, 256px sidebar, conversation column max 768px, right panel closed by default, no status bar at the bottom.

Steps (record worked/failed and a screenshot path for every step):
1. Default screen in Graphite · Teal Dark (Settings Cmd+, > Appearance if needed, then close Settings). Confirm: traffic lights sit inside the sidebar's top bar, vertically centred in it, with nothing overlapping them; the sidebar is a slightly different tone than the conversation with a visible thin divider between them; the main top bar shows "project favicon + project name / thread title" on the left and, on the right, Commit (when a thread with changes is open), a thin separator, a terminal toggle and a right-panel toggle; there is NO status bar at the bottom of the window.
2. Hover the main top bar: secondary actions (Run script, Open, Terminal sessions) appear only while hovering or when one of them has keyboard focus.
3. Press Cmd+B with focus in the conversation or composer: the sidebar collapses completely (no slim rail); the main top bar now shows, right after the traffic lights, an "Expand sidebar" button, a "New thread" button and a separator; hover "Expand sidebar" and read its tooltip (it may list running/attention counts). Press Cmd+B again: the sidebar comes back.
4. Collapse the sidebar with its own top-bar button using the keyboard (Tab to it, press Enter): keyboard focus lands on "Expand sidebar" (visible focus ring). Press Enter: the sidebar expands and focus lands on "Collapse sidebar".
5. Drag the sidebar's right edge: it resizes and stops at a minimum and maximum; a thin accent line shows on hover.
6. Open the right panel with its top-bar toggle (or Cmd+Alt+R): it opens at its remembered width with a 52px bar holding tabs, a Maximize button and a Close (X) button; the panel has a visible divider against the conversation. Drag its left edge to make it wider; then Tab to the resize handle and press ArrowLeft three times: it grows. Close it with X, reopen: the width is kept.
7. Maximize the panel: the conversation disappears, the sidebar stays; click Restore: the conversation is back with the same scroll position and any text typed in the composer before maximizing is still there (type "draft" into the composer before maximizing).
8. Collapse the sidebar and maximize the panel: the panel bar clears the traffic lights and shows "Expand sidebar"; nothing overlaps the traffic lights.
9. Open a TypeScript file in the Files surface, place the caret on an identifier and press Cmd+B: it performs Go to Definition (or does nothing if there is no definition) and must NOT collapse the sidebar.
10. Sidebar footer: while an agent thread is running, the footer shows "N running" (hover: "N of M thread slots in use"); right-click the empty footer area right of the footer icons: a menu with "Threads needing attention" appears; toggle it off and on.
11. Repeat steps 1, 6 and 7 in Graphite · Teal Light and in Zinc · Orange Light: dividers between sidebar, conversation and panel are clearly visible; hovered/selected rows and buttons keep readable text; no dark frame or flash is visible around the window.
12. Leave the app in Ink · Mint Light, sidebar expanded, panel closed, Settings closed.

Final report:
- One line per step: "Step N: worked" or "Step N: failed - <what you saw>", each with a screenshot path.
- A list of every visual defect (palette, scheme, location), especially overlaps with the traffic lights, missing dividers, unreadable text, clipped content, or anything that looks like a leftover status bar.
QA
```

- [ ] **Step 4: Run the tester and wait for the report**

Run in the background with a 45 minute cap: `python3 ~/tmp/codevo-qa/qa_orchestrator_v2.py ~/tmp/codevo-qa/qa_prompt_p2.txt > /tmp/qa-p2.log 2>&1`
Expected: the log ends with the tester's report. Watch only final or error lines (`COMPUTER_USE_UNAVAILABLE`, `TIMEOUT`, `ERROR`, the final message). If the permission classifier blocks the run, ask the user to run the same command with the `!` prefix, or to paste the prompt into their own Codex desktop thread and paste the report back.

- [ ] **Step 5: Cold-start check (native window flash) after a restart**

Run: `osascript -e 'quit app "Codevo QA"' && sleep 2 && open "src-tauri/target/debug/bundle/macos/Codevo QA.app" && sleep 3 && osascript -e 'tell application "Codevo QA" to activate'`, then:

```bash
cat > ~/tmp/codevo-qa/qa_prompt_p2_restart.txt <<'QA'
You are a UI QA tester with Computer Use. First action: run `osascript -e 'tell application "Codevo QA" to activate'`, then take a screenshot. If Computer Use is unavailable, reply only COMPUTER_USE_UNAVAILABLE and stop. Before every screenshot run the same osascript activate command. Work only in the running "Codevo QA" window; do not launch, quit or edit anything.
1. Confirm the window shows Ink · Mint in Light: light surfaces, sidebar expanded, right panel closed, no status bar, traffic lights inside the sidebar top bar.
2. Open Settings > Appearance, set Palette Graphite · Teal and Appearance Dark, close Settings, and confirm the whole window including its edges turned dark (resize the window slightly by dragging its bottom-right corner and confirm no light edge appears).
Report each step as worked/failed with a screenshot path.
QA
python3 ~/tmp/codevo-qa/qa_orchestrator_v2.py ~/tmp/codevo-qa/qa_prompt_p2_restart.txt > /tmp/qa-p2-restart.log 2>&1
```

Expected: both steps "worked". The flash itself is too fast for screenshots: additionally ask the user once, in the final report, to confirm they saw no dark flash when the QA app reopened in Light.

- [ ] **Step 6: Fix loop**

For each QA failure: confirm the root cause in code, fix via a scoped implementer task, rerun focused tests, Task 12 and a reviewer pass on the fix, rebuild the QA app and re-run only the failed QA steps. A vertically off-centre traffic-light cluster is fixed by adjusting only `MAC_TRAFFIC_LIGHTS.y` and `tauri.macos.conf.json` together (the config test keeps them in sync).

- [ ] **Step 7: Clean up**

Run: `osascript -e 'quit app "Codevo QA"'; rm -f /tmp/qa-p2.log /tmp/qa-p2-restart.log ~/tmp/codevo-qa/qa_prompt_p2.txt ~/tmp/codevo-qa/qa_prompt_p2_restart.txt`
Expected: exit 0.

---

### Task 15: Commit to `main` (lead, after explicit owner authorization)

**Files:** all P2 files.

- [ ] **Step 1: Confirm the tree**

Run: `git branch --show-current && git status --porcelain && git log --oneline -5`
Expected: branch `main`; only P2 files changed plus the owner's own pending files. Check for foreign hunks from a concurrent Codex session (repo memory) before staging; stage nothing that is not P2.

- [ ] **Step 2: Commit**

```bash
git add -A -- src/domain src/application src/infrastructure src/ui src/components src/App.tsx src/App.css src/App.commandRouting.test.tsx src/main.tsx src/startupTheme.ts src/startupTheme.test.ts src/startupWindowReveal.ts src/startupWindowReveal.test.ts src/startupDocument.test.ts src/workbenchComposition.ts index.html public/startup.css src-tauri/tauri.conf.json src-tauri/tauri.macos.conf.json src-tauri/capabilities/default.json src-tauri/src/startup_window_reveal.rs src-tauri/src/lib_composition/command_facades.rs src-tauri/src/lib_composition/runtime.rs scripts/hotspot-size-baseline.json docs/superpowers/plans/2026-09-24-redesign-p2-app-shell.md
git diff --cached --stat
git commit -F - <<'MSG'
feat(shell): redesigned app shell without a status bar

- 52px top bars (sidebar, conversation, panel) on one TopBar primitive with
  the macOS traffic lights in the sidebar bar
- Sidebar frame on the side tone, collapsible to zero width (Cmd+B, scoped
  away from the editor), resizable, with focus hand-off
- Right panel frame with keyboard resizing, maximize that keeps the
  conversation mounted, close button and per-workspace width
- Status bar removed: thread activity in the sidebar footer and tooltips,
  editor status in the editor toolbar, inventory test for every item
- Window created hidden and revealed on the palette background, with a
  Rust fallback; AA tints and 3:1 panel dividers
MSG
git status --porcelain
```

Expected: one commit; the final `git status` shows only the owner's untouched files. No push, no tag, no release.

---

## Open Questions for the Owner

1. **Divider strength.** A 3:1 separator needs `rgba(255,255,255,0.38)` in dark and `rgba(20,24,30,0.52)` in light (the mockup hairline is about 1.2:1). This plan applies it only to the three panel edges (sidebar | conversation | right panel), not to component borders. Accept, apply it to light only, or treat panel edges as decorative (keep the hairline)?
2. **Collapsed sidebar is per workspace** (it lives in the persisted per-workspace layout). t3code keeps it global. Keep per workspace?
3. **No keyboard shortcut for maximizing the panel** in P2 (VS Code has none by default). P5 adds a palette command; want a default chord?
4. **Right panel shortcut** stays Cmd+Alt+R because Cmd+Alt+B (VS Code) is Go to Implementation here. OK?
5. **Editor-expanded workbench** keeps its legacy chrome with the status items moved into its toolbar. Should P7 remove this layout entirely instead of restyling it?
6. **Hover-only actions.** Run script, Open and Terminal sessions are hidden until the top bar is hovered or focused (Commit and the panel toggles stay visible, as in the mockup). OK, or keep Run script always visible?

## Self-Review

**Spec coverage.**
- §3.1.3 macOS window chrome: traffic lights in the sidebar top bar (Tasks 2, 5, 6), editor-mode spacer (Task 2). 52px top bar with breadcrumb and minimal actions: Tasks 5, 7. 256px sidebar, collapsible (collapsed variant = zero track + reveal cluster), resizable, Cmd+B: Tasks 3, 4, 6. Conversation column max 768px: container in Task 9 (`--agent-thread-column` = `--cv-column`); literal replacements in P3 sheets are P3's by agreement. Right panel default closed (existing), resizable (pointer existing + keyboard Task 8), remembers width per workspace (existing, proven by `useAgentWorkbenchLayout.test.tsx` "restores workspace A and never leaks workspace B across A to B to A"), maximize/focus mode (Task 8). No status bar with every item relocated: Tasks 10, 11 + inventory table and test.
- §5 P2 carry-overs: tint contrast (Task 1), light native window flash (Task 2), faint light panel borders (Task 1 tokens + Tasks 6/8 usage).
- §4: shell primitive under `src/ui/shell`, `--cv-*` only (Task 5 contract test); only the layout constant, one keymap entry + command, a native-window port and a Rust fallback change outside presentation; App.tsx shrinks (Task 11 Step 7); replaced CSS is deleted (Task 9 retirement test).
- §6: component tests with `act`, scripted AA/3:1 checks (Task 1), keyboard access (Tasks 3, 6, 8, 10), full gates (Task 12), QA build + Computer Use QA in Graphite · Teal dark and light and one more palette (Task 14).
- §7: Opus reviewer (Task 13), Codex app-server QA against `dev.mockor.editor.qa` (Task 14), no release (Task 15).

**Placeholder scan.** No TBD/TODO/"similar to". Two instructions depend on fixture types the plan could not dry-run (the `useEditorStatusPresentation` fixture fields and the settings keybinding row counts); both state the exact allowed adjustment.

**Type consistency.** `SCHEME_SHELL_STATES`, `MAC_TRAFFIC_LIGHTS`, `macTrafficLightInset`, `compositeOver` (Task 1) are used in Tasks 1-2. `NativeWindowPort`, `nativeWindowBackground`, `revealStartupWindow`, `useNativeWindowBackground` (Task 2). `AgentPanelLayoutShortcuts.sidebar/newThread`, `editorTextFocused` (Task 3) are used in Tasks 6 and 7. `TopBar`, `TopBarSeparator`, `ProjectFavicon` (Task 5) in Tasks 6-8. `AgentSidebarReveal` (`detail`), `EXPAND_SIDEBAR_LABEL`, `COLLAPSE_SIDEBAR_LABEL`, `useSidebarFocusHandoff` (Task 6) in Tasks 8, 10, 11. `AgentPanelWindowControls` (Task 7) in Task 8. `resizeRightPanel`, `panelWidthForKey`, `leadingControls`, `onResizeWidth` (Task 8). `AgentThreadActivity`, `agentThreadActivityDetail`, `AgentWorkbenchThreadActivityChrome` (Task 10) in Task 11.

**Review Focus.** Cmd+B scope -> Task 3 dispatcher + `editorTextFocused` tests; focus hand-off -> Task 6 hook tests + AgentModeView test; cold start / hidden window -> Task 2 reveal, config and Rust tests; hidden idle attention indicator -> Task 10 "re-enables a hidden indicator from the idle group's context menu"; maximized + collapsed -> Task 8 AgentModeView tests.

**Dry run.** Not performed for P2 (unlike P1). Implementers must run every named suite; the plan lists every legacy CSS contract assertion expected to change and forbids changing others.

## Lead decisions on open questions (2026-09-24)

1. Panel-edge dividers: keep the mockup's quiet hairlines; surfaces already separate by tone. Light
   scheme gets a modestly stronger divider than dark (the QA note "light panel borders very faint"),
   but panel edges are exempt from the 3:1 non-text rule because tone stepping is the primary
   separator. Keep the contrast test for the tone step between adjacent surfaces instead.
2. Collapsed-sidebar state is global (like t3code), not per workspace.
3. No default shortcut for maximize; the P5 palette command is enough.
4. Right panel stays on Cmd+Alt+R.
5. P7 removes the standalone editor layout: the editor lives in the right panel with maximize/focus
   mode as its only presentation; P7 moves the editor status group into the editor sub-header and
   keeps bottom panel / Problems / debug reachable from focus mode. P2 still relocates the status
   items into the editor toolbar group so nothing is lost before P7.
6. Run script stays always visible in the top bar; Open and Terminal sessions reveal on hover/focus.
   Implementation note: Run script lives in the `AgentThreadHeader` TopBar `trailing` group (always visible); P6's Commit button anchors directly after it in `trailing`.
