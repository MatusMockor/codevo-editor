# Agent Workbench Chrome Design (Slice 5)

Date: 2026-08-25

Status: Proposed design, awaiting approval

## Goal

Make the agent layout the primary workbench chrome, the way T3 Code presents
it: a thread rail, a thread column with a T3-style header and a clean chat
body, an optional bottom terminal, and an optional right panel that hosts a
"surface" (Files, Diff, Terminal). The Files surface hosts the real editor
(the existing Monaco editor groups and a file tree scoped to the thread's
checkout), and its expand control replaces today's "Code | Agents" switch by
turning the editor into the full-screen layout the user knows as Code mode.

Builds on slices 1-4 (`2026-08-24-agent-conversational-threads-design.md`,
`2026-08-25-agent-git-flow-design.md`, `2026-08-25-agent-composer-sidebar-design.md`,
`2026-08-25-agent-sidebar-t3-parity-design.md`, latest commit `4ebbaa0a`).
It supersedes the composer context row and the thread-body Changes/Ship
sections of slices 2 and 3, and removes the mode switch from slice 3.

Binding user decisions (not open for redesign): remove the mode switch; T3
thread header with `[Run script ▾] [Open ▾] [Commit ▾]` plus the two panel
toggles; right panel with Files/Diff/Terminal cards only (no Browser, no
Agents placeholders); Files is the real editor; Expand turns Files into the
full-screen editor and a collapse control returns; composer loses the
"Starting in" row, gains a Local checkout picker and a Claude effort picker;
thread body is turns only.

## Non-goals

- Browser and Agents surfaces, multi-surface tabs beyond one surface at a
  time, per-thread surface memory, surface split/maximize inside the panel.
- A second, independent set of editor tabs for the panel. The panel shows
  the workspace's editor groups; it does not fork document state.
- Terminal splits, terminal groups, more than the existing `MAX_TERMINAL_TABS`.
- Opening an external editor (T3's `OpenInPicker` lists Cursor, Zed, and
  the JetBrains family). Our Open menu is Finder, terminal, copy path.
- Pull-request creation, commit message generation, branch selection in the
  composer (T3 `BranchToolbarBranchSelector`).
- Codex effort/reasoning options. `codex exec --help` on this machine exposes
  no `--effort`; T3 derives its "traits" from provider descriptors at
  runtime, we keep the closed enum per provider.
- Persisting rail width or thread selection (unchanged from slice 4).
- Any change to `git.rs`, `useWorkbenchController.ts` growth, or the hotspot
  baseline.

## T3 reference inventory (v0.0.33, source verified)

Fetched raw from `pingdotgg/t3code` at tag `v0.0.33`; no 404s. Component
names differ from the brief: there is no `ThreadHeader`/`Surface*`; the real
files are `apps/web/src/components/chat/ChatHeader.tsx`, `WorkspaceBreadcrumb.tsx`,
`ProjectScriptsControl.tsx`, `chat/OpenInPicker.tsx`, `GitActionsControl.tsx`,
`chat/PanelLayoutControls.tsx`, `RightPanelTabs.tsx` (with `RightPanelEmptyState`),
`preview/PreviewPanelShell.tsx`, `preview/RightPanelResizeHandle.tsx`,
`ThreadTerminalDrawer.tsx`, `files/FileBrowserPanel.tsx`, `DiffPanel.tsx`,
`chat/ChatComposer.tsx`, `BranchToolbarEnvModeSelector.tsx`, `chat/TraitsPicker.tsx`,
`rightPanelStore.ts`, `terminalUiStateStore.ts`, `packages/shared/src/keybindings.ts`.

### Header (`ChatHeader.tsx`)

`<header data-chat-header className="... workspace-topbar drag-region relative px-3 sm:px-5">`
containing `<div className="@container/header-actions flex min-w-0 flex-1 items-center gap-2 sm:gap-3">`:

- `WorkspaceBreadcrumb` (`<nav><ol className="m-0 flex min-w-0 list-none items-center gap-2 p-0 text-sm sm:gap-3">`):
  project item is a button `aria-label="New thread in {project}"`
  (`inline-flex min-w-0 cursor-pointer items-center gap-1.5 rounded-sm text-muted-foreground transition-colors hover:text-foreground`)
  with the project favicon `size-3.5` and `<span className="max-w-40 truncate">`;
  separator `<li aria-hidden className="flex shrink-0 items-center text-icon-muted">/</li>`;
  current item (`aria-current="page"`, `text-foreground`) is either the rename
  input (`min-w-0 flex-1 rounded-sm bg-transparent text-sm font-medium ... ring-1 ring-ring/50`)
  or a menu button `aria-label="Thread actions for {title}" aria-haspopup="menu"`
  wrapping `<h2 className="min-w-0 truncate">` and a `ChevronDownIcon size-3.5`
  that is `opacity-0` until hover/focus. Right-click on the breadcrumb area
  opens the thread action menu.
- `<div data-chat-header-actions className="flex shrink-0 items-center justify-end gap-2 @3xl/header-actions:gap-3">`
  with `ProjectScriptsControl`, `OpenInPicker`, `GitActionsControl`, each a
  split `Group`: primary `Button size="xs" variant="outline"` (icon +
  `<span className="sr-only @3xl/header-actions:not-sr-only ...">` label,
  so labels collapse to icons below the `3xl` container width),
  `GroupSeparator`, then a `Menu` trigger `Button size="icon-xs" variant="outline"`
  with `ChevronDownIcon size-4` and `MenuPopup align="end"`.
  - Scripts: primary `aria-label="Run {name}"`, menu lists every script, the
    preferred script is the last invoked per project, else the primary
    script; trailing `PlusIcon` "Add action".
  - Open: `Open` label, menu of editors plus "Finder"/"Explorer"/"Files"
    (`FolderClosedIcon`). No copy-path item in T3.
  - Git: quick action label from `GitActionsControl.logic.ts` (`Commit`,
    `Commit & push`, `Push`, `Publish repository`, `Pull`, ...), disabled
    variant is a hover popover with the reason; menu items `Commit`, `Push`,
    `Create PR` / `View PR`, warnings in `text-xs text-warning`
    ("Detached HEAD: ...", "Behind upstream. Pull/rebase first.").
- `PanelLayoutControls` (`<div data-panel-layout-controls className="flex h-full shrink-0 items-center gap-1">`):
  `Toggle variant="ghost" size="sm"` with `PanelBottomIcon size-3.5`,
  `aria-label="Toggle terminal drawer"`, tooltip `Toggle terminal drawer (⌘J)`;
  `Toggle` with `PanelRightIcon size-3.5`, `aria-label="Toggle right panel"`,
  tooltip `Toggle right panel (⌥⌘B)`. `RightPanelMaximizeControl`
  (`Maximize2Icon`/`Minimize2Icon`, "Maximize panel"/"Restore panel size")
  is shown only while the panel is open inline. When the right panel is
  open the controls move out of the chat header into the panel tab bar
  (`{rightPanelOpen && !sheet ? panelLayoutControls : null}`).

### Right panel (`RightPanelTabs.tsx`, `PreviewPanelShell.tsx`)

Shell `<div className="relative flex h-full min-h-0 min-w-0 flex-col self-stretch bg-background shrink-0 border-l border-border" style={{width}}>`
with `RightPanelResizeHandle` (`role="separator" aria-orientation="vertical"`,
`absolute inset-y-0 -left-1 z-20 w-2 cursor-col-resize`). Width from
`useResizableWidth({ storageKey: "t3code:preview-panel-width", defaultWidth: 540, minWidth: 360, maxWidth: floor(vw * 0.7), edge: "left" })`,
persisted on pointer-up. Below 980 px the panel becomes a sheet.

Tab bar `<div className="workspace-topbar gap-1 pl-2 pr-28" data-right-panel-tabbar>`:
tabs `cursor-pointer group/tab flex h-6 max-w-36 shrink-0 items-center gap-0.5 rounded-md pr-2 pl-1.5 text-xs`
(active `bg-accent text-foreground`, rest `text-muted-foreground hover:bg-accent/60 hover:text-foreground`),
icon `size-3` swapped for `X` on hover, add button `aria-label="Add panel surface"`
(`PlusIcon size-3.5`). Body `<div className="flex min-h-0 flex-1 flex-col" data-right-panel-surface-content>`.

Empty state (`RightPanelEmptyState`):

```
<div className="flex min-h-0 flex-1 items-center justify-center p-6"><div className="w-full max-w-xl">
  <div className="mb-5 text-center">
    <h3 className="text-sm font-medium text-foreground">Open a surface</h3>
    <p className="mt-1 text-xs text-muted-foreground">Choose what to show in the right panel.</p>
  </div>
  <div className="grid grid-cols-2 gap-2">
    <button className="cursor-pointer flex min-h-28 w-full flex-col items-start rounded-lg border border-border/80 bg-card p-4 text-left transition hover:border-border hover:bg-accent/60 dark:border-transparent dark:shadow-none dark:inset-ring-1 dark:inset-ring-white/5">
      <span className="relative mb-3 inline-flex"><Icon className="size-5"/></span>
      <span className="text-sm font-medium">{label}</span>
      <span className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</span>
```

T3 cards: Browser "Open a local app or URL.", Terminal "Start a shell in this
workspace.", Files "Browse and read workspace files.", Diff "Review changes
in this thread.", Agents "Watch subagents and workflows run.". We render
Files, Diff, Terminal only, in that order.

Files surface (`FileBrowserPanel.tsx`): `surface-subheader` with a refresh
button (`aria-label="Refresh workspace files"`) and a `type="search"` input
`placeholder="Search files"`, then `FileTree` at 12 px. Diff surface
(`DiffPanel.tsx`): `surface-subheader` with a scope dropdown
(`aria-label="Diff scope: {label}"`; Working tree / Branch changes / Latest
turn / Turn N), refresh, expand/collapse all, stacked/split toggle, word
wrap; truncation banner `shrink-0 border-b border-border/70 bg-muted/40 px-3 py-1.5 text-[11px] text-muted-foreground`.

Store (`rightPanelStore.ts`): zustand `persist`, key `t3code:right-panel-state:v2`,
`byThreadKey: { isOpen, activeSurfaceId, surfaces[] }`. T3 persists per
thread; we persist per workspace (binding decision).

### Bottom terminal drawer (`ThreadTerminalDrawer.tsx`)

`<aside data-terminal-owner="drawer" className="thread-terminal-drawer relative flex min-w-0 flex-col overflow-hidden bg-background shrink-0 border-t border-border/80" style={{height}}>`
with a `h-1.5 cursor-row-resize` grip. `DEFAULT_THREAD_TERMINAL_HEIGHT = 280`,
`MIN_DRAWER_HEIGHT = 180`, `MAX_DRAWER_HEIGHT_RATIO = 0.75`. Persisted in
`t3code:terminal-state:v1` per thread (`terminalOpen`, `terminalHeight`).
Toggle is `terminal.toggle` (`mod+j`). No maximize.

### Composer footer (`ChatComposer.tsx`, `BranchToolbarEnvModeSelector.tsx`, `TraitsPicker.tsx`)

Context strip above the footer holds the isolation `Select`
(`aria-label="Workspace"`, `FolderGit2Icon` "New worktree" / `FolderIcon`
"Current checkout"); once the thread exists it is a static label
(`inline-flex h-7 shrink-0 items-center gap-1 ... text-sm font-medium text-muted-foreground/70 sm:h-6 sm:text-xs`
reading "Local checkout" or "Worktree"). Footer
`<div data-chat-composer-footer className="flex min-w-0 flex-nowrap items-center justify-between gap-2 px-3 pb-3 sm:px-4 sm:pb-4">`:
left group with `ProviderModelPicker` (`ComposerControl` `h-7 min-h-7 gap-1.5 px-2.5 text-secondary-label hover:text-foreground`,
provider glyph `size-4`, truncated model, `ChevronDownIcon -mx-0.5 size-3.5`),
`Separator vertical mx-0.5 h-4`, `TraitsPicker` (reasoning effort radio
group with a `DefaultBadge`), runtime mode `Select` (`aria-label="Runtime mode"`,
items `min-w-64 py-2` with icon, label, description), plan/build toggle;
right group with the context meter and send/stop. Below 620 px the pickers
collapse into `CompactComposerControlsMenu` (`EllipsisIcon`,
`aria-label="More composer controls"`).

### Keybindings (`packages/shared/src/keybindings.ts`)

`mod+b sidebar.toggle`, `mod+j terminal.toggle`, `mod+alt+b rightPanel.toggle`,
`mod+d diff.toggle`, `mod+shift+j preview.toggle`, `mod+n chat.new`,
`mod+shift+n chat.newLocal`, `mod+shift+m modelPicker.toggle`,
`mod+o editor.openFavorite`, `mod+shift+[ / ]` thread previous/next,
`mod+1..9` thread jump. Several of these collide with our keymap (see below).

## Verified starting point

### Shell composition (`src/App.tsx`, 1564 lines / 7856 tokens, exact baseline)

- `App.tsx:1129-1133`: `<main className={agentModeActive ? "app-shell app-shell--agent-mode" : "app-shell"}>`;
  `.app-shell` is a grid `46px minmax(180px, var(--sidebar-width, 300px)) minmax(0, 1fr)` x
  `var(--window-chrome-height) minmax(0, 1fr) 28px` (`App.css:716-726`);
  `.app-shell--agent-mode { grid-template-columns: minmax(0, 1fr); }` (`App.css:738`).
- `WorkbenchNavigationChrome.tsx:32` returns `null` in agent mode (activity
  bar, sidebar, resize handle vanish). `ProjectTabs` is skipped (`App.tsx:1157`).
- `WorkbenchToolbar.tsx:39-54` renders only `WorkbenchModeSwitch` + Trust in
  agent mode; `WorkbenchModeSwitch` (`:114-142`) is the `Code`/`Agents`
  `role="group"` with `aria-pressed`; "Agents" is disabled without a root.
- `App.tsx:1195-1202`: `AgentModeScreen` is mounted beside
  `<div className="editor-mode-surface" hidden={agentModeActive} aria-hidden>`
  which wraps `WorkbenchEditorHost` (`:1203-1216`) and `BottomPanel`
  (`:1218-1279`, about 60 props). The editor stays mounted while hidden.
  This is the existing anti-double-mount device and the spec keeps it.
- `App.tsx:1288-1295`: `AgentStatusBarHost` vs `StatusBar`.
- `App.tsx:193-194`: `sidebarWidth` (300) and `bottomPanelHeight` (152) are
  unpersisted component state exposed as `--sidebar-width` /
  `--bottom-panel-height` (`:702-705`) with drag handlers `:711-755`.
- `useAgentModeState.ts` (80 lines): React state keyed by
  `editorSessionOwnerKey`, force-reset to `false` on owner change, never
  persisted. Consumed by `useWorkbenchControllerAgents.ts:104-147`
  (`agentModeActive`, `setAgentModeActive`, `toggleAgentMode`), by
  `workbenchAgentCommands.ts` (`panel.showAgents`), by the window title
  (`App.tsx:406-416`) and by the editor bridge `leaveAgentMode()`
  (`useWorkbenchControllerAgents.ts:150-163`).

### Editor runtime (single owner, hard constraint)

- One `EditorRuntimeHost` (`EditorRuntimeHost.tsx:105`) provides
  `EditorRuntimeContext`; `EditorSurface.tsx:2489-2501` silently creates a
  private host when rendered outside that context. Any editor rendered in
  the panel must be a descendant of the App host.
- `admittedWorkspaceRoot` is single-valued per host, first writer wins
  (`EditorRuntimeHost.tsx:1530-1540`); surfaces on another root lose
  markers and LSP routing. Agent worktrees live at
  `<repositoryRoot>/.worktrees/<threadId>` (`git_worktree.rs:160-170`), inside
  the workspace root, so they are admitted by the existing root.
- `EditorArea.tsx:46` keys every group on `editorSessionOwnerKey`; changing
  the key remounts all groups and drops Monaco view state.
- One Monaco `<Editor>` per leaf group (`useEditorSurfacePresentation.tsx:395-414`,
  `keepCurrentModel`); diff views are separate `DiffEditor` instances
  (`GitDiffPreview.tsx`).
- Document state lives only in `useEditorSessionState` (`useEditorSessionState.ts:72-141`);
  the open entry point is `useWorkbenchDocumentTabs.openFile(entry, { pin, recordNavigation })`
  (`:113-131`), which refuses only paths belonging to another open workspace
  tab (`:229-237`).

### File tree, diff, terminal, scripts

- `FileTree.tsx:28-47` is data-driven (`rootPath`, `entriesByDirectory`,
  `expandedDirectories`, `loadingDirectories`, `onToggleDirectory`,
  `onOpenFile`, `onPreviewFile`); it never reads the filesystem and accepts
  any `rootPath`. `WorkbenchSidebar.tsx:117-136` feeds it from the whole
  `workbench` controller. Rust `ensure_path_in_workspace`
  (`workspace_facade.rs:713-725`) admits any path under the canonical root,
  which covers `.worktrees/<threadId>`.
- `useGitDiffWorkspace.previewGitChange(change, { pin, repositoryRoot })`
  (`useGitDiffWorkspace.ts:340`) already targets a worktree root;
  `useAgentEditorBridge.ts:76-136` uses it with `targetPath = worktreePath ?? repositoryRoot`
  and then calls `leaveAgentMode()`. `GitChangesPanel` (`:57-73`) and
  `GitDiffPreview` (`:28-50`, `MAX_DIFF_CONTENT_BYTES = 2_000_000`,
  `MAX_DIFF_LINE_COUNT = 50_000`) are the reusable diff UI.
- `TerminalTabsPanel.tsx:27-40` takes `ownerKey`, `rootPath`, `profileId`,
  `terminalGateway`; `BottomPanel.tsx:476,508` keys it on
  `terminalTabsOwnerKey(workspaceId, workspaceRoot)`. Rust
  `start_terminal_session(root_path, ...)` (`terminal_commands.rs:42-81`)
  requires a registered, trusted workspace root and spawns with the retained
  root directory handle: **a terminal cannot start in a worktree today**.
- `useNodePackageScriptWorkbench.run(script)` (`:444-540`) acquires the
  active bottom-panel terminal session via `requestTerminalSession` and
  starts `workspace_start_node_package_task` bound to that `sessionId`;
  output is the PTY, problems go to the Problems panel. VS Code tasks use
  `workspace_start_vscode_process_task` through the same terminal session.
  Both are listed by `WorkbenchScriptsTasksPanel` (`scripts`/`tasks` tabs).
- `bottomPanelVisible` is `useState(false)` (`useWorkbenchController.ts:615`);
  `showBottomPanelView`, `hideBottomPanel`, `toggleBottomPanel` live in
  `useTerminalTestRunner.ts:235-247`; `panel.toggle` is `Cmd+J`
  (`keymap.ts:693`), `terminal.show` is `` Ctrl+` `` (`:861`).

### Persistence

- `BrowserSettingsGateway` (localStorage, `editor.settings.workspace:canonical:<key>`),
  `WorkspaceSessionStateV1` (`settings.ts:206-234`: `version`, `editor`,
  `bottomPanelView`, `sidebarView`, `navigation?`, `viewStates?`) normalised
  by `normalizeWorkspaceSession` (`:640-670`) with hard byte caps. Sidebar
  width, bottom panel height and visibility are not persisted today.
- Agent threads persist through the Rust store (`agent_thread_store.rs`,
  `deny_unknown_fields`, schema 1); the legacy localStorage pin key is only
  erased.

### Launch options

- `src/domain/agentLaunch.ts`: `ClaudeLaunchOptions { provider: "claudeCode"; model; mode }`,
  `CodexLaunchOptions`, `parseAgentLaunchOptions` with
  `exactKeys(options, ["provider", "model", "mode"])`, no argv on the TS side.
- `src-tauri/src/agent_launch.rs:51-147`: serde tagged enum
  (`deny_unknown_fields`), `claude_model_args`, `claude_mode_args`,
  `codex_model_args`, `codex_mode_args(mode, resumed)`; argv assembled in
  `agent_task_spawner.rs:117-143` as template + `model_args()` + `mode_args()`
  - resume + `--` + prompt. Wire pins:
    `serde_uses_the_documented_wire_names` (Rust) and
    `tauriAgentTaskIpcContract.test.ts:78-128` (TS). Stored turns carry
    `launch: Option<AgentLaunchOptions>` (`agent_thread_store.rs:133`).
- `claude --help` on this machine (Claude Code 2.1.245) prints:

  ```
  --effort <level>                      Effort level for the current session
                                        (low, medium, high, xhigh, max)
  ```

  There is no `default` token; "default" means the flag is omitted. The
  brief's list lacked `xhigh`; the verified enum is used. `codex exec --help`
  has no effort flag.

### Agent-mode UI to change

- `AgentModeView.tsx` (792 lines) owns selection, rail scope, composer
  state and renders `.agent-mode__grid` = rail | center (`AgentThreadSession`
  - `AgentComposer`) | `AgentThreadInfoColumn` (`agentMode.css:110-113`,
    `--agent-info-width: 296px`).
- `AgentThreadSession.tsx:129-186`: `.agent-session__head` (repo, title,
  status) then turns, then `AgentThreadChanges` and `AgentShipPanel` as the
  last two children of `.agent-session__body`.
- `AgentComposer.tsx:146-225`: the `.agent-composer__context` row
  ("Starting in" chip, project/repository `<select>`, isolation checkbox);
  `AgentLaunchControls` renders the model/mode `AgentPickerMenu` pair.
- `AgentPickerMenu.tsx` is the anchored listbox primitive reused for every
  new dropdown; `AgentThreadRowMenu.tsx` is the portal context menu.

## Architecture

```text
App.tsx (composition root, shrinks)
  WorkbenchShellFrame            grid placement of: nav chrome, agent screen,
                                 surface header, editor host, bottom panel
  AgentWorkbenchScreen           rail + thread column (+ surface panel frame)
    AgentThreadHeader            breadcrumb, Run/Open/Commit, panel toggles
    AgentThreadSession           turns only
    AgentComposer                textarea + footer pickers
    AgentSurfacePanel            empty state | Files | Diff | Terminal
  WorkbenchEditorHost            unchanged, placed by CSS (never remounted)
  WorkbenchBottomPanelHost       BottomPanel props presenter (extracted)
        |
application
  useAgentWorkbenchLayout        reducer + persistence (replaces useAgentModeState)
  useAgentSurfaceFileTree        bounded directory cache for the Files surface
  useAgentThreadScripts          scripts/tasks projection + run-in-bottom-terminal
  useAgentEditorBridge           opens Files surface instead of leaving agent mode
        |
domain
  agentWorkbenchLayout           state machine, parser, persistence shape
  agentLaunch (+effort)          closed enum, exactKeys per provider
  keymap (+agent.* commands)
        |
Rust
  agent_launch.rs (+ClaudeEffortChoice, claude_effort_args)
  terminal_commands.rs (+TerminalLaunchTarget::AgentWorktree)
```

Dependency direction is unchanged: components depend on application hooks,
hooks on domain and ports. No new Tauri command family; one existing command
gains a closed variant.

## Layout state machine

`src/domain/agentWorkbenchLayout.ts` (new, pure):

```ts
export const AGENT_SURFACE_KINDS = ["files", "diff", "terminal"] as const;
export type AgentSurfaceKind = (typeof AGENT_SURFACE_KINDS)[number];

export interface AgentWorkbenchLayout {
  readonly layout: "agent" | "editor-expanded";
  readonly rightSurface: AgentSurfaceKind | null;
  readonly lastSurface: AgentSurfaceKind;
  readonly bottomPanel: boolean;
  readonly rightPanelWidth: number; // px, clamped [360, 1200]
  readonly bottomPanelHeight: number; // px, clamped [120, 900]
}

export type AgentWorkbenchLayoutAction =
  | { kind: "openSurface"; surface: AgentSurfaceKind }
  | { kind: "closeSurface" }
  | { kind: "toggleRightPanel" } // reopens lastSurface, default "files"
  | { kind: "toggleBottomPanel" }
  | { kind: "showBottomPanel" }
  | { kind: "expandEditor" }
  | { kind: "collapseEditor" }
  | { kind: "resizeRightPanel"; width: number }
  | { kind: "resizeBottomPanel"; height: number };

export const initialAgentWorkbenchLayout: AgentWorkbenchLayout = {
  layout: "agent",
  rightSurface: null,
  lastSurface: "files",
  bottomPanel: false,
  rightPanelWidth: 540,
  bottomPanelHeight: 280,
};
export function agentWorkbenchLayoutReducer(state, action): AgentWorkbenchLayout;
export function parseAgentWorkbenchLayout(value: unknown): AgentWorkbenchLayout; // fail-closed to defaults
export function serializeAgentWorkbenchLayout(state): Record<string, unknown>;
```

S0 landed the file with these exact names plus `AGENT_SURFACE_KINDS`,
`AGENT_WORKBENCH_LAYOUT_MODES`, the `MIN_/MAX_/DEFAULT_` size constants,
`isAgentSurfaceKind`, `isAgentWorkbenchLayoutMode`,
`clampAgentRightPanelWidth`, `clampAgentBottomPanelHeight`, and a
`hideBottomPanel` action alongside `showBottomPanel`. `lastSurface` is a real
readonly field of `AgentWorkbenchLayout` (it has to be, for a pure reducer);
it is not persisted. Stream B adds `parseAgentWorkbenchLayout` /
`serializeAgentWorkbenchLayout` and the persistence wiring.

Rules:

- `toggleRightPanel` closes when open, otherwise opens `lastSurface`
  (a private field of the reducer state, default `"files"`); `openSurface`
  while another surface is open replaces it (one surface at a time).
- `expandEditor` is legal from any `rightSurface` (including `null` via the
  command palette). It sets `layout: "editor-expanded"` and remembers the
  surface; `collapseEditor` restores the remembered surface. Diff and
  Terminal surfaces map onto the expanded layout as follows: Diff expands
  with the sidebar `git` view revealed, Terminal expands with the bottom
  panel `terminal` view shown; both still use the shared editor groups.
- `layout` is forced to `"editor-expanded"` while `workspaceRoot === null`
  (the welcome/open-workspace flow) and while the workspace is untrusted
  and has no leased agent projects; the reducer stays pure, the hook applies
  the override in its projection (`effectiveLayout`).
- Sizes are clamped in the reducer; the viewport cap (70 % width, 75 %
  height, as in T3) is applied by the resize handler before dispatch.

`agentModeActive` (used by title, commands, status bar) becomes a derived
boolean `effectiveLayout === "agent"`; the name is kept to keep `App.tsx`
churn near zero.

### Persistence

`WorkspaceSessionStateV1` gains an optional field `agentWorkbench?: AgentWorkbenchLayoutPersisted`
(`{ layout, rightSurface, bottomPanel, rightPanelWidth, bottomPanelHeight }`).
Adding an optional key keeps `WORKSPACE_SESSION_VERSION = 1`; the normaliser
runs `parseAgentWorkbenchLayout` and drops the key on any invalid value
(fail closed to defaults, never throws). Bounds: five scalar fields, no
strings besides the two enums, so no byte cap is needed beyond the existing
session caps. Persisted through the existing
`saveWorkspaceSettings` debounce path used for `editor`/`viewStates`; the
hook writes only after the layout actually changes (snapshot ref compare,
as `useAgentThreadPins` did).

Owner isolation: `useAgentWorkbenchLayout(workspaceOwnerKey, session, persist)`
holds `{ ownerKey, state }`; a different owner key rehydrates from that
workspace's session (A -> B -> A reloads A's layout, not B's, and the
in-flight persist for B is dropped if the owner changed after the `await`).
Per-thread differences are not persisted: the Files scope follows the
selected thread at render time.

### Keymap

Existing `Cmd+J` (`panel.toggle`) drives the bottom panel in both layouts.
`Cmd+B`, `Cmd+Alt+B`, `Cmd+D`, `Cmd+Shift+J`, `Cmd+E` are taken
(`goToDefinition`, `goToImplementation`, `editor.duplicate`, `joinLines`,
`recentFiles`), so T3's bindings cannot be copied. Free chords chosen (all
verified absent from `keymap.ts` defaults):

| id                           | default     | label                     | category |
| ---------------------------- | ----------- | ------------------------- | -------- |
| `agent.toggleRightPanel`     | `Cmd+Alt+R` | Toggle Right Panel        | Agents   |
| `agent.openFilesSurface`     | `Cmd+Alt+F` | Show Files Surface        | Agents   |
| `agent.openDiffSurface`      | `Cmd+Alt+D` | Show Diff Surface         | Agents   |
| `agent.openTerminalSurface`  | `Cmd+Alt+J` | Show Terminal Surface     | Agents   |
| `agent.toggleEditorExpanded` | `Cmd+Alt+E` | Expand or Collapse Editor | Agents   |
| `agent.runPreferredScript`   | `` (none)   | Run Thread Script         | Agents   |
| `agent.openCommitMenu`       | `` (none)   | Commit Thread Changes     | Agents   |

S0 landed all seven ids under the existing `"Agent"` category (the file has
no `"Agents"` category). `keymapCommands` is now 156 entries / 154 default
settings; `Cmd+Alt+R/F/D/J/E` are free on mac and map to `Ctrl+Alt+...` on
linux and windows with no `findKeymapSequenceConflicts` hits, and `Cmd+J`
(`panel.toggle`) is untouched and distinct from `Cmd+Alt+J`.

`panel.showAgents` ("Toggle Agent Mode") is renamed to
`agent.toggleEditorExpanded` semantics; the old id is removed together with
the mode switch (no alias: the keymap conflict finder treats unknown ids as
errors, and no shortcut was bound to it by default). `terminal.show`
(`` Ctrl+` ``) shows the bottom terminal in both layouts.

## Shell placement without remounting

`WorkbenchShellFrame.tsx` (new, <= 160 lines) renders the `.editor-workbench`
section as a grid and assigns `data-slot` attributes; App.tsx passes the
already-built children. CSS (new block in `App.css` under a
`/* Agent workbench frame */` banner, replacing `.app-shell--agent-mode`):

```css
.editor-workbench[data-layout="agent"] {
  display: grid;
  grid-template-columns: minmax(0, 1fr) var(--agent-right-panel-width, 0px);
  grid-template-rows: minmax(0, 1fr) var(--agent-bottom-panel-height, 0px);
}
.editor-workbench[data-layout="agent"] > [data-slot="agent"] {
  grid-column: 1;
  grid-row: 1;
}
.editor-workbench[data-layout="agent"] > [data-slot="bottom"] {
  grid-column: 1;
  grid-row: 2;
}
.editor-workbench[data-layout="agent"] > [data-slot="surface"] {
  grid-column: 2;
  grid-row: 1 / -1;
}
.editor-workbench[data-layout="editor-expanded"] > [data-slot="agent"] {
  display: none;
}
```

- `[data-slot="surface"]` is the `AgentSurfacePanel` frame (header + body).
  Its body contains the surface-specific content **except** for Files: for
  Files the body is an empty well and the editor host DOM node
  (`.editor-mode-surface`, a sibling slot `[data-slot="editor"]`) is placed
  over it with `grid-column: 2; grid-row: 1 / -1; padding-top: var(--agent-surface-header-height)`.
  The editor host therefore has exactly one React position for its whole
  life; only CSS grid placement changes between Files-in-panel, hidden, and
  expanded. `hidden` is applied when `layout === "agent"` and
  `rightSurface !== "files"`, identical to today's behaviour.
- `[data-slot="bottom"]` is `BottomPanel`, moved out of `.editor-mode-surface`
  to its own slot so it can sit under the thread column in agent layout and
  under the editor in expanded layout. It remains one React instance; the
  terminal session survives layout switches (same `ownerKey`).
- In `editor-expanded` the outer `.app-shell` grid regains its three columns,
  `WorkbenchNavigationChrome` and `ProjectTabs` render again, `StatusBar`
  replaces `AgentStatusBarHost`. `WorkbenchToolbar` loses
  `WorkbenchModeSwitch` and gains a leading "Back to threads" icon button
  (`Minimize2`, `aria-label="Collapse editor (⌥⌘E)"`) in expanded layout.
- Resize handles: the panel handle (`role="separator"`, 8 px hit area, left
  edge) and the bottom handle reuse the pointer capture pattern of
  `startSidebarResize` but live in `useWorkbenchResizeHandles.ts` (new,
  extracted from `App.tsx:711-755` together with the existing two handlers)
  and write CSS variables on `.editor-workbench` only; React state updates
  once on pointer-up (dispatch `resizeRightPanel`), so dragging never
  rerenders the workbench.

Monaco layout: `EditorSurface` already observes its container with
`ResizeObserver`; moving from the panel to full width triggers one relayout.
A test asserts the Monaco mount count stays 1 across
agent -> files -> expanded -> collapsed -> closed.

## Thread header

`src/components/agentMode/AgentThreadHeader.tsx` (new, <= 240 lines) replaces
`.agent-session__head`; it is rendered by `AgentWorkbenchScreen` as the first
row of `.agent-mode__center` (rows: header, optional find bar, session,
composer). Markup:

```tsx
<header className="agent-thread-head" data-agent-thread-head>
  <nav aria-label="Thread breadcrumb" className="agent-crumbs">
    <button className="agent-crumbs__project" aria-label={`New thread in ${project}`}>
      <Folder size={14} /> <span className="agent-crumbs__label">{projectLabel}</span>
    </button>
    <span aria-hidden className="agent-crumbs__sep">
      /
    </span>
    <button
      className="agent-crumbs__title"
      aria-haspopup="menu"
      aria-label={`Thread actions for ${title}`}
    >
      <h2>{title}</h2> <ChevronDown size={14} className="agent-crumbs__chevron" />
    </button>{" "}
    {/* rename swaps in RenameInput from AgentThreadRowParts */}
    <span className={`agent-thread-head__status agent-thread-head__status--${tone}`}>…</span>
  </nav>
  <div className="agent-thread-head__actions">
    <AgentScriptRunControl /> {/* [▷ dev ▾] */}
    <AgentOpenMenu /> {/* [Open ▾] */}
    <AgentCommitMenu /> {/* [Commit ▾] */}
    {rightSurface === null ? <AgentPanelLayoutControls /> : null}
  </div>
</header>
```

- Breadcrumb: the project button starts a new thread scoped to that project
  (calls the existing `onNewThread(projectRootKey, repositoryRoot)`); the
  title button opens `AgentThreadRowMenu` anchored below it (same entries as
  the rail row: rename, pin, archive, remove, copy); right-click on the
  breadcrumb does the same. Status label and dot move here from the old
  session head. With no thread selected the header shows project crumb +
  "New thread" and only the layout toggles.
- `AgentScriptRunControl` (<= 160 lines): split control built from two
  buttons and one `AgentPickerMenu`-style listbox (`agent-split`):
  primary `aria-label={`Run ${scriptName}`}` runs the preferred entry, the
  chevron opens the list. Entries come from
  `useAgentThreadScripts(threadTarget)`: node package scripts filtered to
  the thread's repository (`packageRootRelativePath` resolved against
  `repositoryRoot`), then VS Code tasks, capped at 64 entries, with a
  trailing "Open Scripts and Tasks" that expands the editor with the sidebar
  `scripts` view. Preferred = last run in this repository, remembered
  in memory by `useAgentThreadScripts` for the life of the agent view (it is
  not persisted with the layout; the runner exposes no stable script key to
  persist and the workspace settings write is not worth the extra owner
  round-trip), else the first `dev`/`start`/`test` script, else the first
  entry. Running: call `showBottomPanelView("terminal")` on the controller,
  then the existing `run(script)`; the runner's `requestTerminalSession`
  binds to the bottom panel session exactly as in the expanded layout. The
  primary becomes Stop (`Square` icon) only for a run this thread's control
  started: `useAgentThreadScripts` binds the runner's `runId` to the
  originating `threadId`, so a script started from another thread (or from
  the expanded layout) renders as `{name} (running elsewhere)`, disabled,
  and every entry is blocked with `AGENT_SCRIPT_BUSY_REASON`. Worktree threads: scripts
  execute in the repository root's package (the discovery is workspace-id
  keyed); the menu shows a hint "Runs in the main checkout" until the Rust
  task cwd supports worktrees (open question 3).
- `AgentOpenMenu` (<= 120 lines): items "Reveal in Finder" (the
  `reveal_item_in_dir` command behind `reveal_path_in_workspace`, reached
  through a `RevealPathGateway` port injected from `AgentWorkbenchScreen`,
  never a direct `@tauri-apps/plugin-opener` import in presentation code;
  the screen resolves the owning agent project root for `targetPath` and
  fails closed for anything outside them, and a rejection is surfaced in the
  agent notice bar), "Open in Terminal" (opens the Terminal surface for the
  thread), "Open in Editor" (`expandEditor` with the Files scope), "Copy
  path" (`navigator.clipboard.writeText(targetPath)`; the same clipboard
  path used by the existing copy actions in `agentThreadMenuEntries`).
  `targetPath = worktreePath ?? repositoryRoot`; disabled with
  `worktreeMissing`.
- `AgentCommitMenu` (<= 140 lines): trigger label is the ship quick action
  computed from `agentShipPolicy` (`Commit N files`, `Push branch`,
  `Integrate`, `Nothing to commit`, disabled with the blocked reason as
  `title`); the chevron opens a popover (`agent-popover`, anchored, focus
  trapped, Escape closes) that hosts the existing `AgentShipPanel`
  unchanged in content. In-place threads hide integrate/remove exactly as
  today. The popover is closed on thread change and while a ship step
  completes it stays open to show the receipt.
- `AgentPanelLayoutControls` (<= 60 lines): two `aria-pressed` icon toggles,
  `PanelBottom` "Toggle terminal panel (⌘J)" and `PanelRight`
  "Toggle right panel (⌥⌘R)". Rendered in the thread header while the
  right panel is closed, in the surface header while it is open (one
  instance at a time, as T3 does).

## Right panel and surfaces

`src/components/agentMode/AgentSurfacePanel.tsx` (<= 200 lines) is the
frame: `<aside aria-label="Thread surface" className="agent-surface" data-surface={kind}>`
with a resize handle, a header `agent-surface__head` (tabs area, `⤢` expand
button `aria-label="Expand to editor (⌥⌘E)"`, the layout toggles, close),
and a body `agent-surface__body`.

### Empty state

`AgentSurfaceEmptyState.tsx` (<= 80 lines): "Open a surface" / "Choose what
to show in the right panel." and three cards (`agent-surface-card`):
Files "Browse and edit the thread's checkout.", Diff "Review changes in this
thread.", Terminal "Start a shell in the thread's checkout." A card is
disabled with a reason when the thread has no target (no selected thread and
no scoped project: "Select a thread first"), when `worktreeMissing`
("The worktree no longer exists"), or for Terminal when the workspace is
untrusted ("Trust the workspace to start a terminal", with the Trust
action).

### Files surface

Two panes inside the surface: `AgentSurfaceFileTree` (left, 220 px, hidden
below 900 px panel width via a toggle in the surface header) and the shared
editor host (right, placed by CSS as described above). Header tabs area
shows nothing extra: the editor groups already render their own tab strip,
and duplicating it would create two tab authorities.

- `useAgentSurfaceFileTree(target)` (application, <= 220 lines): owns
  `entriesByDirectory`, `expandedDirectories`, `loadingDirectories`,
  `failedDirectories` for `rootPath = worktreePath ?? repositoryRoot`, keyed
  by `{ workspaceId, threadId }`; reads through
  `workspaceGateways.files.readDirectory` (descriptor-scoped, so containment
  and trust are enforced by `ensure_path_in_workspace`). Bounds: 4 000
  entries per directory (surplus shown as a "N more entries" row), 200
  cached directories per thread with LRU eviction, depth 32. Cache is
  dropped on thread change, worktree removal and workspace owner change;
  refresh button re-reads expanded directories only. The file watcher
  events already delivered for the workspace root (`workspaceGateways.fileChanges`)
  invalidate the affected directory when it is under `rootPath`.
- Opening: `onOpenFile` -> `openFileRef.current(entry, { pin: true, recordNavigation: true })`,
  `onPreviewFile` -> `previewFile(entry)`; both go through the ordinary
  workspace document store. The editor bridge's `openChangedFile` now calls
  `openSurface("files")` instead of `leaveAgentMode()`, and
  `openChangedFileDiff` opens the diff document in the shared groups and
  also shows the Files surface (the Diff surface is for review, the editor
  diff document is for tooling).
- Tabs are workspace tabs, not thread tabs. Closing the surface hides the
  editor; documents stay open and dirty state is untouched. Selecting
  another thread rescopes the tree and leaves tabs alone; a tab from another
  thread's worktree is still valid (same workspace root). The breadcrumb
  inside `EditorSurface` keeps showing paths relative to the workspace
  root, which makes the `.worktrees/<id>/` prefix visible; the tree strips
  it. No per-thread tab filter is faked.
- Expand: `expandEditor` keeps the same groups and active document; the
  sidebar `files` view of the expanded layout is the workspace explorer
  (root = workspace root) with the active file revealed
  (`activeFileRevealSignal`), so the user lands on the same file.

### Diff surface

`AgentSurfaceDiff.tsx` (<= 220 lines): header subrow with scope label
(`Working tree` only; turn scopes are a non-goal), refresh, stacked/split
toggle; left list = the change rows moved out of `AgentThreadChanges`
(status glyph, path relative to `targetPath`, Open/Diff actions); right =
`GitDiffPreview` fed by `useAgentChangeSummary.showFileDiff` results
(`AgentTaskFileDiff` -> `GitFileDiff` projection in `agentModePresentation.ts`).
`GitDiffPreview` is rendered with `previewIdentity = `${threadId}:${path}``
so React swaps the `DiffEditor` model instead of reusing a stale one. The
`DiffEditor` here is a separate Monaco instance from the editor groups, as
the sidebar git preview is today; it is unmounted with the surface. Revert
and hunk staging props are not passed (agent worktree changes are committed
whole through the Commit menu; hunk staging stays a non-goal).
Truncation from `MAX_DIFF_CONTENT_BYTES` / `MAX_DIFF_LINE_COUNT` shows the
existing banner text.

### Terminal surface

`AgentSurfaceTerminal.tsx` (<= 120 lines): lazily imports `TerminalTabsPanel`
with `ownerKey = `${workspaceId}:agent-surface:${threadId}``, `rootPath =
targetPath`, the workspace terminal theme and profile. The panel is
remounted per thread (key = ownerKey), which tears sessions down through
the existing unmount path; closing the surface also unmounts it. Sessions
never outlive the thread selection (open question 2 covers keeping them).

Rust change (`terminal_commands.rs`, `terminal_session.rs`): `start_terminal_session`
gains a closed `target` argument:

```rust
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum TerminalLaunchTarget {
    WorkspaceRoot,
    AgentWorktree { thread_id: String },
}
```

`AgentWorktree` resolves `<canonical root>/.worktrees/<thread_id>` through the
existing `ensure_worktree_path_in_base` and `ensure_path_bounds` from
`git_worktree.rs`, requires the root to be registered and trusted exactly as
today (`while_workspace_trusted`, `retain_terminal_launch_workspace`), opens
the worktree directory with `O_NOFOLLOW`/`O_DIRECTORY` relative to the
retained root handle, and passes that handle as the cwd; a missing or
non-directory worktree is a definite error ("The agent worktree no longer
exists."). `thread_id` is validated with the thread-id rule already used by
`agent_thread_store.rs`. The TS `TerminalGateway.startSession` gains the
matching `target` field, defaulting to `{ kind: "workspaceRoot" }` so every
existing caller is unchanged; contract tests on both sides pin the wire
shape. `stop_terminal_sessions_for_root` keeps working because sessions stay
registered under the workspace root.

### Bottom panel

The existing `BottomPanel` (Problems, Terminal, Search, Debug, ...) is the
bottom panel of both layouts; in agent layout it opens on the `terminal`
view. The agent layout does not get a second terminal component. Height in
agent layout comes from `agentWorkbench.bottomPanelHeight`; the expanded
layout keeps its current unpersisted `bottomPanelHeight` state (persisting
it is trivial but out of scope). `bottomPanelVisible` in
`useTerminalTestRunner` stays the single visibility authority. The agent
chrome never dispatches panel visibility itself: `AgentWorkbenchScreen` runs
one owner-scoped effect (`agentBottomPanelSync`) that mirrors every
controller transition into the layout reducer (`showBottomPanel` /
`hideBottomPanel`), so `Cmd+J` through `panel.toggle` and the header toggle
converge on the same state. The persisted flag is applied exactly once per
owner at hydration: when the hydrated layout has `bottomPanel: true` and the
controller panel is closed, the screen calls
`showBottomPanelView("terminal")`. Opening the panel while the bottom view
is unchanged (a plain `Cmd+J` toggle) also reveals the `terminal` view; an
explicit `panel.show*` command keeps the view it selected. The sync state is
keyed by workspace root, so A -> B -> A cannot leak one workspace's
persisted panel into another.

## Composer

`AgentComposer.tsx` changes:

- Remove `.agent-composer__context` (lines 146-225) and the
  `selectedProjectRootKey`/`onSelectProject` props. The composer target is
  supplied by `AgentWorkbenchScreen`: selected thread's owner for follow-ups;
  otherwise the rail scope's project when scoped; otherwise the project with
  `origin === "active-tab"`; otherwise the composer is disabled with the
  reason "Choose a project in the rail to start a thread". Multi-repo
  projects render a repository `AgentPickerMenu` in the footer only when
  `repositories.length > 1`.
- Follow-up mode keeps the "Replying in {title}" hint as the textarea
  placeholder and a "New thread" link at the footer's right, instead of the
  removed context row.
- Footer (`.agent-composer__row`, new order): `[Model ▾] [Effort ▾ (Claude only)] [Mode ▾] | [Checkout ▾] [Repo ▾ if >1]  …  bytes  [Send ⌘⏎]`.
  The checkout picker (`AgentPickerMenu id="agent-checkout"`, prefix folder
  glyph) has options `Worktree` ("Runs in a new git worktree") and
  `In place` ("Runs in the main checkout"), reflects `isolationReason` as
  the option detail, disables `In place` when `worktreeOnly` with
  `worktreeOnlyReason`, and in follow-up mode renders as a static locked
  chip (`Worktree` / `Local checkout`) like T3. The unsafe in-place
  confirmation block stays as it is.
- Below 620 px the pickers collapse into one "More controls" menu
  (`AgentComposerCompactMenu`, <= 120 lines) mirroring T3's
  `CompactComposerControlsMenu`; the responsive block in `agentMode.css`
  replaces the current full-width picker rules.

### Effort option (TypeScript)

`src/domain/agentLaunch.ts`:

```ts
export const CLAUDE_EFFORT_CHOICES = ["default", "low", "medium", "high", "xhigh", "max"] as const;
export type ClaudeEffortChoice = (typeof CLAUDE_EFFORT_CHOICES)[number];
export interface ClaudeLaunchOptions {
  readonly provider: "claudeCode";
  readonly model: ClaudeModelChoice;
  readonly mode: ClaudePermissionMode;
  readonly effort: ClaudeEffortChoice;
}
```

`CodexLaunchOptions` is unchanged. `parseAgentLaunchOptions` reads
`provider` first, then applies `exactKeys` per provider
(`["provider","model","mode","effort"]` for Claude, `["provider","model","mode"]`
for Codex); a Codex object carrying `effort` is rejected, a Claude object
missing `effort` is accepted only through `parseStoredAgentLaunchOptions`
(used by `agentThreadWire.ts` for persisted turns) which fills `"default"`;
the IPC path uses the strict parser. `serializeAgentLaunchOptions` always
writes `effort`. `DEFAULT_AGENT_LAUNCH_OPTIONS.claudeCode.effort = "default"`,
`agentLaunchOptionsEqual` compares it, `agentLaunchIsDangerous` ignores it.
`agentLaunchPresentation.ts` adds `agentLaunchEffortChoices()`, labels
(`Default`, `Low`, `Medium`, `High`, `Extra high`, `Max`), hints ("Lets the
CLI pick", "Faster, shallower", ..., "Slowest, most thorough") and
`agentLaunchMetaLabel` appends `· xhigh` when not default.

### Effort option (Rust, `agent_launch.rs`)

```rust
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ClaudeEffortChoice { #[default] Default, Low, Medium, High, Xhigh, Max }

// in AgentLaunchOptions::ClaudeCode
#[serde(default)] effort: ClaudeEffortChoice,

fn claude_effort_args(effort: ClaudeEffortChoice) -> &'static [&'static str] {
    match effort {
        ClaudeEffortChoice::Default => &[],
        ClaudeEffortChoice::Low    => &["--effort", "low"],
        ClaudeEffortChoice::Medium => &["--effort", "medium"],
        ClaudeEffortChoice::High   => &["--effort", "high"],
        ClaudeEffortChoice::Xhigh  => &["--effort", "xhigh"],
        ClaudeEffortChoice::Max    => &["--effort", "max"],
    }
}
```

`AgentLaunchOptions::effort_args()` returns the table for Claude and `&[]`
for Codex; `agent_task_spawner::agent_invocation_args` appends
`launch.effort_args()` after `mode_args(resumed)` (effort is passed on
resume too; `claude --resume --effort` is accepted per `--help`, which lists
it as a session flag). `#[serde(default)]` keeps schema 1 thread documents
readable; `deny_unknown_fields` on the enum still rejects `effort` on the
Codex variant. Tests: table exhaustiveness, `serde_uses_the_documented_wire_names`
extended with `{"provider":"claudeCode","model":"sonnet","mode":"bypassPermissions","effort":"xhigh"}`,
rejection of `"effort":"ultra"` and of Codex+effort, `agent_task_spawner`
argv matrix extended by the six effort values, and the TS
`tauriAgentTaskIpcContract.test.ts` forwarding test extended.

## Thread body cleanup

`AgentThreadSession.tsx` loses the header (moved to `AgentThreadHeader`),
`AgentThreadChanges` and `AgentShipPanel` rendering and their props
(`shipActions`, `onHideChanges`, `onHideFileDiff`, `onRefreshChanges`,
`onShowFileDiff`, `onOpenChangedFile`, `onOpenChangedFileDiff`). It renders
turns, truncation and worktree notes only; after the last turn a single
compact line "N files changed · Review in Diff" (`agent-session__changes-cue`,
button opens the Diff surface) replaces the inline list when
`changeSummary` is present. `AgentThreadChanges.tsx` is reduced to the row
list component used by the Diff surface (the inline two-pane
`AgentThreadDiff` is deleted; `GitDiffPreview` replaces it).
`AgentThreadInfoColumn.tsx` is removed: status lives in the header, launch
and isolation facts in the composer footer, worktree path in the Open menu,
Stop/Archive/Remove/Pin in the title menu, changed-file count in the cue
line. Its tests are deleted with it; the equivalent assertions move to the
header and Commit menu tests. `--agent-info-width` and the `1180px`
responsive rule that hid the column are removed from `agentMode.css`.

## Composition root and controller extraction

`App.tsx` must end below its baseline (1564 / 7856). Extractions:

- `src/components/WorkbenchBottomPanelHost.tsx` + `workbenchBottomPanelHostPresenter.ts`:
  the 60-prop `BottomPanel` element (`App.tsx:1218-1279`) becomes
  `<WorkbenchBottomPanelHost {...bottomPanelHostProps(...)} />` following the
  `workbenchEditorHostPresenter.ts` pattern (about -55 lines in App.tsx).
- `src/application/useWorkbenchResizeHandles.ts`: `sidebarWidth`,
  `bottomPanelHeight`, both `start*Resize` handlers and the new panel handle
  (about -50 lines).
- `src/components/WorkbenchShellFrame.tsx`: the `.editor-workbench` grid,
  `data-layout`, slot wrappers and the `hidden`/`aria-hidden` logic
  (about -20 lines).
- `WorkbenchToolbar.tsx`: `WorkbenchModeSwitch` and the agent branch are
  deleted; `onSelectAgentMode`/`agentModeActive` props become
  `onCollapseEditor` + `collapseAvailable`.
- `useWorkbenchControllerAgents.ts`: `useAgentModeState` is replaced by
  `useAgentWorkbenchLayout`; the surface exposes `agentWorkbench: { layout, effectiveLayout, dispatch }`
  plus the derived `agentModeActive`; `toggleAgentMode` is removed.
  `useWorkbenchController.ts` only loses the `toggleAgentMode` plumbing
  (lines 1704, 7382, 8172) and must not grow.
- `AgentModeScreen.tsx` is renamed `AgentWorkbenchScreen.tsx` and gains the
  layout surface, the scripts projection and the terminal/file gateways it
  passes down; `AgentModeView.tsx` keeps selection and composer state but
  hands header/surface rendering to the new components and must not exceed
  its current 792 lines (target <= 700 after the info column removal).

## Failure modes

- Thread deleted, archived or worktree removed while a surface is open: the
  Files tree clears and shows "This thread's checkout is gone"; the Diff
  surface shows the same; the Terminal surface unmounts (sessions stopped
  through the existing unmount path); the editor groups keep their tabs,
  and a save into a removed worktree fails through the existing save error
  path ("Path is outside the workspace root." or ENOENT) without corrupting
  the document.
- Workspace switch A -> B -> A: `AgentWorkbenchScreen` still remounts on
  `workspaceRoot`; the layout hook rehydrates per owner key; terminal panels
  keyed on `workspaceId` remount; the editor host runs its existing
  workspace lease handoff. No layout, tree cache or terminal session may
  survive an owner change (tests).
- Untrusted workspace: Terminal surface and Run script are disabled with
  the Trust action (the Rust gate is authoritative); Files and Diff remain
  read-and-edit capable as they are today in the expanded layout.
- Persisted layout referencing an unknown surface or a width outside bounds:
  defaults; never throws; a debug log entry only.
- Right panel width larger than the viewport after a window resize: the
  frame clamps `--agent-right-panel-width` to `min(persisted, 70vw)` at
  render time; below 720 px viewport width the panel is hidden and the
  toggle is disabled with "Widen the window to open a surface" (no sheet
  mode this slice).
- Expand while no workspace or while the editor session is not current:
  the reducer accepts, the projection forces `editor-expanded` and the
  welcome screen shows; collapsing is possible once a workspace is open.
- Script run when the bottom terminal cannot start (untrusted, profile
  missing): the existing runner reports through `reportError`; the header
  primary returns to its idle state; no phantom "running" state.
- Effort mismatch (Codex with effort, unknown level): rejected at the TS
  parser before IPC and at serde in Rust; both surface the definite
  rejection through `DEFINITE_AGENT_TASK_START_REJECTIONS`.
- Terminal launch target for a worktree of a different repository or a
  symlinked `.worktrees` entry: rejected by `ensure_worktree_path_in_base`
  and `O_NOFOLLOW`; the surface shows the error text and a Retry.

## Performance

- Monaco: exactly one editor group tree for the whole app; no `EditorSurface`
  is ever rendered outside the App `EditorRuntimeHost`; a test wraps
  `@monaco-editor/react` and asserts mount count 1 across all layout
  transitions and thread switches. Diff and terminal surfaces are lazy
  (`React.lazy`) and unmount with the surface.
- Layout transitions change only `data-layout`, `hidden` and two CSS
  variables; `AgentThreadSession` and `EditorGroupView` must not rerender on
  a toggle (render-count assertions with the existing probe pattern).
- Resizing writes CSS variables directly during drag and dispatches once on
  pointer-up; Monaco relayout is driven by its own `ResizeObserver`, which
  is throttled by the browser to one layout per frame.
- File tree: directory reads are bounded (4 000 entries, 200 directories),
  cached, and never scan recursively; expanding a directory is one IPC call.
- Scripts projection is memoised on the discovery snapshot and the thread
  target; it does no IPC of its own.
- Persistence writes go through the existing debounced session save; the
  hook short-circuits identical snapshots.
- Benchmarks: toggle right panel 50 times with a 5 000-line document open,
  median < 16 ms scripting per toggle in the jsdom probe; drag 200 pointer
  moves without a React commit (assert commit count via the profiler API).

## Testing plan

Domain (vitest): reducer transitions incl. remembered surface and expand
from each surface; parser rejects bad shapes and clamps sizes; effort enum
parse/serialize/equality/danger; keymap free-shortcut and conflict tests
(`findKeymapSequenceConflicts` on the new defaults).

Application: `useAgentWorkbenchLayout` hydration per owner key, A -> B -> A,
persist snapshot short-circuit, late persist after owner change dropped;
`useAgentSurfaceFileTree` bounds, eviction, invalidation on file-change
events, thread change reset; `useAgentThreadScripts` filtering by repository
and preferred-script rules; editor bridge now opening the Files surface.

Components: `AgentThreadHeader` (breadcrumb actions, rename, menus, toggle
placement), `AgentScriptRunControl` (run/stop, disabled reasons),
`AgentCommitMenu` (popover hosts ship panel, closes on thread change),
`AgentSurfacePanel` (empty state cards and disabled reasons, expand/close,
layout controls relocation), `AgentSurfaceDiff` (row selection, truncation
banner), `AgentSurfaceTerminal` (owner key per thread, unmount on close),
`AgentComposer` (context row gone, checkout picker states, effort picker
only for Claude, compact menu below 620 px), `AgentThreadSession` (turns
only, cue line), `WorkbenchShellFrame` (slot placement per layout,
`hidden` on the editor slot), `WorkbenchToolbar` (no mode switch, collapse
button).

Integration (App-level, existing patterns in `App.*.test.tsx`): Monaco
single-mount across transitions; opening a changed file from the Diff
surface opens it in the shared groups and shows Files; expand keeps the
active document; collapse restores the surface; `Cmd+J` toggles the bottom
panel in both layouts; window title follows the layout.

Rust: `agent_launch.rs` effort tables, wire names, rejections; spawner argv
matrix with effort; `terminal_commands.rs` `AgentWorktree` target happy
path, missing worktree, symlinked worktree, foreign path, untrusted root,
replaced registered root.

CSS tests (`agentModeTokens.test.ts` style): the new tokens exist, the
`1180px` rule is gone, the compact composer rule exists.

## Implementation streams (disjoint write scopes)

S0 (lead, sequential, first): create `src/domain/agentWorkbenchLayout.ts`
with types and stub reducer, add the keymap ids, extend `agentLaunch.ts`
types with `effort` (parser tolerant stub), add the `TerminalLaunchTarget`
TS type with the default, rename `AgentModeScreen` -> `AgentWorkbenchScreen`
(re-export kept for one commit), so `npm run check` passes before parallel
work starts.

Then in parallel:

- **A: Domain and Rust effort + terminal target** (gpt-5.6-sol or opus-5).
  Files: `src/domain/agentLaunch.ts` (+test), `src/domain/agentThreadWire.ts`
  (stored parser), `src/components/agentMode/agentLaunchPresentation.ts` (+test),
  `src-tauri/src/agent_launch.rs`, `src-tauri/src/agent_task_spawner.rs` (tests),
  `src-tauri/src/lib_composition/agent_task_commands.rs` (tests),
  `src-tauri/src/terminal_commands.rs`, `src-tauri/src/terminal_session.rs`,
  `src/domain/terminal.ts` (gateway type), `src/infrastructure/tauriTerminalGateway.ts` (+test),
  `src/infrastructure/tauriAgentTaskIpcContract.test.ts`. Forbidden:
  components, App.tsx, controller. Validate: `npx vitest run src/domain/agentLaunch src/infrastructure/tauriTerminalGateway src/infrastructure/tauriAgentTaskIpcContract`,
  `cd src-tauri && cargo test --lib agent_launch terminal_commands && cargo clippy --all-targets -- -D warnings`.
- **B: Layout state, persistence, keymap** (opus-5). Files:
  `src/domain/agentWorkbenchLayout.ts` (+test), `src/domain/settings.ts`
  (`agentWorkbench?` field + normaliser + tests), `src/domain/keymap.ts`
  (+test), `src/application/useAgentWorkbenchLayout.ts` (+test, replaces
  `useAgentModeState.ts`), `src/application/useWorkbenchControllerAgents.ts`,
  `src/application/workbenchAgentCommands.ts` (+test),
  `src/application/useWorkbenchResizeHandles.ts` (+test). Forbidden:
  components, App.tsx body beyond the resize-handle removal agreed with F.
  Validate: `npx vitest run src/domain/agentWorkbenchLayout src/domain/settings src/domain/keymap src/application/useAgentWorkbenchLayout src/application/workbenchAgentCommands`, `npm run check`.
- **C: Header and menus** (taste >= 7: fable-5 or opus-5). Files:
  `AgentThreadHeader.tsx`, `AgentScriptRunControl.tsx`, `AgentOpenMenu.tsx`,
  `AgentCommitMenu.tsx`, `AgentPanelLayoutControls.tsx`, `agentPopover.ts`
  (anchoring helper shared with the picker), `src/application/useAgentThreadScripts.ts`
  (+test), header/menu block appended to `agentMode.css` under
  `/* Thread header */`, tests for each. Forbidden: `AgentModeView.tsx`,
  session, composer, surface files. Validate:
  `npx vitest run src/components/agentMode/AgentThreadHeader src/components/agentMode/AgentScriptRunControl src/components/agentMode/AgentOpenMenu src/components/agentMode/AgentCommitMenu src/application/useAgentThreadScripts`.
- **D: Right panel host and surfaces** (fable-5; the Monaco hosting is the
  risk centre). Files: `AgentSurfacePanel.tsx`, `AgentSurfaceEmptyState.tsx`,
  `AgentSurfaceFileTree.tsx`, `AgentSurfaceDiff.tsx`, `AgentSurfaceTerminal.tsx`,
  `src/application/useAgentSurfaceFileTree.ts` (+test), the
  `AgentThreadChanges.tsx` reduction, `agentModePresentation.ts` diff
  projection, `useAgentEditorBridge.ts` (open surface instead of leave),
  surface block appended to `agentMode.css` under `/* Surfaces */`, tests.
  Forbidden: header files, composer, App.tsx. Validate:
  `npx vitest run src/components/agentMode/AgentSurface src/application/useAgentSurfaceFileTree src/application/useAgentEditorBridge`.
- **E: Composer** (taste >= 7). Files: `AgentComposer.tsx` (+test),
  `AgentComposerCompactMenu.tsx` (+test), `AgentLaunchControls.tsx` (+test,
  effort picker), composer block of `agentMode.css` (edit in place; C and D
  only append). Forbidden: everything else. Validate:
  `npx vitest run src/components/agentMode/AgentComposer src/components/agentMode/AgentLaunchControls`.
- **F: Shell frame and composition root** (lead or opus-5 with lead
  review). Files: `App.tsx`, `App.css` frame block, `WorkbenchShellFrame.tsx`
  (+test), `WorkbenchBottomPanelHost.tsx` + presenter (+test),
  `WorkbenchToolbar.tsx` (+test), `WorkbenchNavigationChrome.tsx`,
  `appPresentation.ts` (title), `AgentWorkbenchScreen.tsx`, `AgentModeView.tsx`
  (wiring header/surface/composer target, info column removal),
  `AgentThreadSession.tsx` (turn-only body, cue line), deletion of
  `AgentThreadInfoColumn*`, `src/preview/agentPreview.tsx` update.
  Runs after A-E land (it consumes their contracts) and owns integration
  tests in `App.*.test.tsx`. Validate: full gate list.
- **G: Review (read-only, different model from every author)**: adversarial
  review against this spec with emphasis on Monaco single-mount, owner
  isolation on A -> B -> A, worktree containment in the Rust terminal target,
  hotspot budgets, and the removal of every mode-switch reference
  (`grep -rn "agentModeActive\|setAgentModeActive\|toggleAgentMode\|panel.showAgents\|WorkbenchModeSwitch" src`
  must return only the derived boolean).

Full gates before "done": `npm run check`, `npm run lint -- --max-warnings 0`,
`npm run size:hotspots` (App.tsx and useWorkbenchController.ts must report
reductions or equality, never growth; new files < 2000 lines / 10000
tokens), `npm run format:check`, `npm run format:check:changed`,
`npm test -- --run`, `git diff --check`, and in `src-tauri`:
`cargo check --all-targets`, `cargo test --lib`, `cargo test --tests`,
`cargo fmt --all -- --check`, `cargo clippy --all-targets -- -D warnings`.
`npm run build` is run once at the end because the shell grid and lazy
surfaces change the bundle graph.

## Open questions (defaults apply unless overruled)

Lead ruling: every default below applies unless a numbered entry says
"RESOLVED" with a different outcome.

1. Expand from Diff/Terminal surfaces: map to the expanded layout with the
   git sidebar view / bottom terminal (default), or disable `⤢` on those
   surfaces and keep it Files-only as the brief literally says.
2. Terminal surface sessions across thread switches: unmount and stop
   (default, bounded and simple) versus keeping up to N thread terminals
   alive like T3's `PersistentThreadTerminalPanel`.
3. RESOLVED: scripts for worktree threads run with `cwd` = the worktree when
   the runner can accept a cwd; where it cannot, the entry is marked
   unsupported (not silently redirected to the main checkout). Stream C owns
   this in `useAgentThreadScripts`.
4. Effort on resumed Claude turns: RESOLVED (verified 2026-08-25, Claude Code
   2.1.245, temp dir outside the repo). `claude -p --output-format stream-json
--verbose --effort low -- "reply ok"` exits 0, and
   `claude -p --output-format stream-json --verbose --resume <session_id>
--effort high -- "reply ok"` also exits 0 with no stderr, so `--effort` is
   accepted on resume. An unknown level (`--effort ultra`) does not fail: the
   CLI prints `Warning: Unknown --effort value 'ultra' - ignoring it and using
the default effort. Valid values: low, medium, high, xhigh, max.` and exits
   0, which confirms the closed enum and means the _caller_ must reject unknown
   levels (both parsers do). Decision: pass `--effort` on every turn, resume
   included; `agent_invocation_args` appends `effort_args()` after
   `mode_args(resumed)` and before `--resume`.
5. Persisting the expanded layout's `sidebarWidth`/`bottomPanelHeight` in the
   same `agentWorkbench` block: default no (unchanged behaviour).
6. Below 720 px viewport: hide the right panel (default) or implement the
   T3 sheet mode.
7. RESOLVED: remove `AgentThreadInfoColumn` entirely (the default). Stream F
   owns the deletion of `AgentThreadInfoColumn.tsx` and its test.
